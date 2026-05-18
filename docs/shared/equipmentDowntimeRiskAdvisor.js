'use strict';

/**
 * Equipment Downtime Risk Advisor — agentic next-N-day downtime risk advisor.
 *
 * Sibling to BatchReleaseAdvisor (per-batch disposition), ShiftHandoffSynthesizer
 * (between-shift carryover), PerishableWasteForecaster (inventory waste) and
 * ReagentSubstitutionAdvisor (substitution). This module looks at a fleet of
 * lab equipment (bioprinters, incubators, biosafety cabinets, centrifuges,
 * autoclaves, pipettes, microscopes, etc.) and predicts which units are most
 * likely to cause downtime over the next N days, then synthesizes a ranked
 * P0/P1/P2/P3 maintenance + mitigation playbook with owner / blast / reversibility
 * metadata, cross-fleet insights, and text / markdown / json renderers.
 *
 * Pure JS, CommonJS, zero deps, deterministic given an injected now(), never
 * mutates inputs.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var advisor = biobots.createEquipmentDowntimeRiskAdvisor({
 *       now: function () { return new Date('2026-05-18T20:00:00Z'); }
 *   });
 *   var report = advisor.evaluate({
 *       horizonDays: 7,
 *       equipment: [{
 *           id: 'BP-01', name: 'Bioprinter #1', type: 'bioprinter',
 *           criticality: 'critical', hoursSinceLastService: 1200,
 *           serviceIntervalHours: 1000, errorsLast7d: 4,
 *       }],
 *       context: { upcomingHighStakesBatches: 1, activeMaintenanceCrew: 1 },
 *   });
 *   console.log(advisor.formatMarkdown(report));
 */

var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
var RISK_APPETITES = { cautious: 'cautious', balanced: 'balanced', aggressive: 'aggressive' };

var VERDICTS = {
    OFFLINE_RISK_IMMINENT: 'OFFLINE_RISK_IMMINENT',
    PREVENTIVE_SERVICE_URGENT: 'PREVENTIVE_SERVICE_URGENT',
    WATCH_AND_INSPECT: 'WATCH_AND_INSPECT',
    CONSUMABLES_RESTOCK: 'CONSUMABLES_RESTOCK',
    SCHEDULED_SERVICE_SOON: 'SCHEDULED_SERVICE_SOON',
    STABLE_OK: 'STABLE_OK',
};

// Per-type default intervals (hours); used when not supplied by caller.
var TYPE_DEFAULTS = {
    bioprinter:         { service: 1000, calibration: 500 },
    incubator:          { service: 2000, calibration: 720 },
    biosafety_cabinet:  { service: 1500, calibration: 720 },
    centrifuge:         { service: 1500, calibration: 1000 },
    autoclave:          { service: 1000, calibration: 720 },
    pipette:            { service: 4000, calibration: 720 },
    microscope:         { service: 3000, calibration: 1500 },
    other:              { service: 2000, calibration: 1000 },
};

var CRITICALITY_MULT = { critical: 1.20, high: 1.10, medium: 1.0, low: 0.85 };
var APPETITE_MULT = { cautious: 1.15, balanced: 1.0, aggressive: 0.85 };

// Risk-delta weights for simulate().
var ACTION_DELTA = {
    TAKE_OFFLINE_AND_SERVICE: -0.45,
    ENGAGE_BACKUP_OR_RESCHEDULE_BATCHES: -0.15,
    SCHEDULE_PREVENTIVE_SERVICE: -0.25,
    CALIBRATE: -0.18,
    RESTOCK_CONSUMABLES: -0.10,
    INSPECT_AND_LOG: -0.05,
    INVESTIGATE_VIBRATION_OR_TEMP: -0.12,
    EXPAND_MAINTENANCE_CAPACITY: -0.08,
    FLEET_HEALTHY: 0,
    SCHEDULE_FLEET_AUDIT: -0.03,
};

// ── helpers ─────────────────────────────────────────────────────

function _isFiniteNum(n) { return typeof n === 'number' && isFinite(n); }
function _num(n, d) { return _isFiniteNum(n) ? n : (d || 0); }
function _str(s) { return typeof s === 'string' ? s : ''; }
function _bool(b) { return b === true; }
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _ratioBand(ratio) {
    // map usage ratio to 0..100 score (1.0 -> 80, >=1.2 -> 100, 0.5 -> 40, <=0.2 -> 5)
    if (!_isFiniteNum(ratio) || ratio <= 0) return 0;
    if (ratio >= 1.2) return 100;
    if (ratio >= 1.0) return 80 + (ratio - 1.0) * 100;          // 80..100
    if (ratio >= 0.5) return 40 + (ratio - 0.5) * 80;           // 40..80
    if (ratio >= 0.2) return 5 + (ratio - 0.2) * (35 / 0.3);    // 5..40
    return Math.max(0, ratio * 25);                             // 0..5
}

function _errorBand(e7) {
    if (e7 <= 0) return 0;
    if (e7 === 1) return 25;
    if (e7 === 2) return 50;
    if (e7 === 3) return 70;
    return 90; // >=4
}

function _runtimeAgeBand(hrs) {
    if (hrs > 10000) return 30;
    if (hrs > 5000) return 15;
    if (hrs > 2000) return 5;
    return 0;
}

function _coerceDate(maybe, fallback) {
    if (maybe instanceof Date && !isNaN(maybe.getTime())) return maybe;
    if (typeof maybe === 'string' || typeof maybe === 'number') {
        var d = new Date(maybe);
        if (!isNaN(d.getTime())) return d;
    }
    return fallback;
}

function _normalizeEquipment(raw) {
    var type = _str(raw.type) || 'other';
    if (!TYPE_DEFAULTS[type]) type = 'other';
    var defaults = TYPE_DEFAULTS[type];
    var crit = _str(raw.criticality).toLowerCase();
    if (!CRITICALITY_MULT[crit]) crit = 'medium';
    var consumables = Array.isArray(raw.consumablesLowFlags) ? raw.consumablesLowFlags.slice() : [];
    var vibration = _str(raw.vibrationTrend).toLowerCase();
    if (vibration && vibration !== 'stable' && vibration !== 'rising' && vibration !== 'critical') vibration = '';
    return {
        id: _str(raw.id),
        name: _str(raw.name) || _str(raw.id) || '(unnamed)',
        type: type,
        criticality: crit,
        runtimeHours: Math.max(0, _num(raw.runtimeHours, 0)),
        hoursSinceLastService: Math.max(0, _num(raw.hoursSinceLastService, 0)),
        hoursSinceLastCalibration: Math.max(0, _num(raw.hoursSinceLastCalibration, 0)),
        serviceIntervalHours: Math.max(1, _num(raw.serviceIntervalHours, defaults.service)),
        calibrationIntervalHours: Math.max(1, _num(raw.calibrationIntervalHours, defaults.calibration)),
        errorsLast30d: Math.max(0, Math.floor(_num(raw.errorsLast30d, 0))),
        errorsLast7d: Math.max(0, Math.floor(_num(raw.errorsLast7d, 0))),
        consumablesLowFlags: consumables.filter(function (x) { return typeof x === 'string' && x.length > 0; }),
        vibrationTrend: vibration,
        temperatureDriftCelsius: _isFiniteNum(raw.temperatureDriftCelsius) ? raw.temperatureDriftCelsius : null,
        noiseDb: _isFiniteNum(raw.noiseDb) ? raw.noiseDb : null,
        lastIncidentDaysAgo: _isFiniteNum(raw.lastIncidentDaysAgo) ? Math.max(0, raw.lastIncidentDaysAgo) : null,
        backupAvailable: _bool(raw.backupAvailable),
        scheduledServiceInDays: _isFiniteNum(raw.scheduledServiceInDays) ? Math.max(0, raw.scheduledServiceInDays) : null,
    };
}

// ── scoring ─────────────────────────────────────────────────────

function _scoreItem(item, ctx) {
    var reasons = [];

    // usageStress
    var usageRatio = item.hoursSinceLastService / item.serviceIntervalHours;
    var usageStress = _ratioBand(usageRatio);
    if (usageStress >= 60) reasons.push({ code: 'SERVICE_OVERDUE', label: 'Hours-since-service at ' + Math.round(usageRatio * 100) + '% of interval.', weight: Math.round(usageStress) });

    // calibrationDrift
    var calRatio = item.hoursSinceLastCalibration / item.calibrationIntervalHours;
    var calibrationDrift = _ratioBand(calRatio);
    if (calibrationDrift >= 60) reasons.push({ code: 'CALIBRATION_DRIFT', label: 'Hours-since-calibration at ' + Math.round(calRatio * 100) + '% of interval.', weight: Math.round(calibrationDrift) });

    // error rate
    var errorRate = _errorBand(item.errorsLast7d);
    if (item.errorsLast30d > 0) errorRate = Math.min(100, errorRate + Math.min(15, item.errorsLast30d * 2));
    if (item.errorsLast7d >= 2) reasons.push({ code: 'RECENT_ERROR_SPIKE', label: item.errorsLast7d + ' errors in last 7 days.', weight: Math.round(errorRate) });
    else if (item.errorsLast30d >= 3) reasons.push({ code: 'MONTHLY_ERROR_TREND', label: item.errorsLast30d + ' errors in last 30 days.', weight: Math.round(errorRate) });

    // consumables
    var consumablesGap = Math.min(100, item.consumablesLowFlags.length * 25);
    if (item.consumablesLowFlags.length > 0) {
        reasons.push({
            code: 'CONSUMABLES_LOW',
            label: 'Low: ' + item.consumablesLowFlags.slice(0, 5).join(', ') + '.',
            weight: consumablesGap,
        });
    }

    // env signal: vibration + temperature + recent incident
    var envSignal = 0;
    if (item.vibrationTrend === 'rising') { envSignal += 30; reasons.push({ code: 'VIBRATION_RISING', label: 'Vibration trend rising.', weight: 60 }); }
    if (item.vibrationTrend === 'critical') { envSignal += 60; reasons.push({ code: 'VIBRATION_CRITICAL', label: 'Vibration trend critical.', weight: 95 }); }
    if (_isFiniteNum(item.temperatureDriftCelsius)) {
        var absT = Math.abs(item.temperatureDriftCelsius);
        if (absT >= 2) { envSignal += 35; reasons.push({ code: 'TEMP_DRIFT', label: 'Temperature drift ' + absT.toFixed(1) + '°C.', weight: 80 }); }
        else if (absT >= 1) { envSignal += 15; reasons.push({ code: 'TEMP_DRIFT', label: 'Temperature drift ' + absT.toFixed(1) + '°C.', weight: 50 }); }
    }
    if (item.lastIncidentDaysAgo !== null) {
        if (item.lastIncidentDaysAgo <= 3) { envSignal += 30; reasons.push({ code: 'RECENT_INCIDENT', label: 'Incident ' + item.lastIncidentDaysAgo + ' days ago.', weight: 70 }); }
        else if (item.lastIncidentDaysAgo <= 7) { envSignal += 15; reasons.push({ code: 'RECENT_INCIDENT', label: 'Incident ' + item.lastIncidentDaysAgo + ' days ago.', weight: 45 }); }
    }
    envSignal = Math.min(100, envSignal);

    // runtime age
    var runtimeAge = _runtimeAgeBand(item.runtimeHours);
    if (runtimeAge > 0) reasons.push({ code: 'HIGH_USAGE_AGE', label: 'Cumulative runtime ' + Math.round(item.runtimeHours) + 'h.', weight: 30 + runtimeAge });

    // criticality / backup / scheduled relief notes
    if (item.criticality === 'critical') reasons.push({ code: 'CRITICAL_ASSET', label: 'Critical asset.', weight: 20 });
    if (item.backupAvailable) reasons.push({ code: 'BACKUP_AVAILABLE', label: 'Backup unit available.', weight: 5 });
    if (item.scheduledServiceInDays !== null && item.scheduledServiceInDays <= ctx.horizonDays) {
        reasons.push({
            code: 'SCHEDULED_SERVICE_INCOMING',
            label: 'Service scheduled in ' + item.scheduledServiceInDays + ' day(s).',
            weight: 10,
        });
    }

    // weighted blend
    var weighted = (usageStress * 0.25)
        + (calibrationDrift * 0.15)
        + (errorRate * 0.25)
        + (consumablesGap * 0.10)
        + (envSignal * 0.15)
        + (runtimeAge * 0.10);
    weighted = _clamp(weighted, 0, 100);

    // criticality bump + appetite multiplier
    weighted = weighted * CRITICALITY_MULT[item.criticality] * APPETITE_MULT[ctx.riskAppetite];
    weighted = _clamp(weighted, 0, 100);

    // upcoming high-stakes batches: small bump on critical/high assets (max +5)
    if (ctx.upcomingHighStakesBatches > 0 && (item.criticality === 'critical' || item.criticality === 'high')) {
        weighted = _clamp(weighted + Math.min(5, ctx.upcomingHighStakesBatches * 2), 0, 100);
    }

    // dampeners
    if (item.scheduledServiceInDays !== null && item.scheduledServiceInDays <= ctx.horizonDays) weighted *= 0.7;
    if (item.backupAvailable) weighted *= 0.9;

    var risk = _clamp(Math.round(weighted), 0, 100);

    // dedupe + sort reasons
    var seen = {};
    var deduped = [];
    reasons.forEach(function (r) {
        if (seen[r.code] !== undefined) {
            if (r.weight > seen[r.code].weight) seen[r.code].weight = r.weight;
            return;
        }
        seen[r.code] = r;
        deduped.push(r);
    });
    deduped.sort(function (a, b) {
        if (b.weight !== a.weight) return b.weight - a.weight;
        return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    });

    // verdict
    var verdict;
    if (risk >= 75 || item.errorsLast7d >= 4 || item.vibrationTrend === 'critical') verdict = VERDICTS.OFFLINE_RISK_IMMINENT;
    else if (risk >= 60 || usageStress >= 90 || calibrationDrift >= 90) verdict = VERDICTS.PREVENTIVE_SERVICE_URGENT;
    else if (risk >= 40) verdict = VERDICTS.WATCH_AND_INSPECT;
    else if (item.consumablesLowFlags.length >= 2) verdict = VERDICTS.CONSUMABLES_RESTOCK;
    else if (item.scheduledServiceInDays !== null && item.scheduledServiceInDays <= ctx.horizonDays) verdict = VERDICTS.SCHEDULED_SERVICE_SOON;
    else verdict = VERDICTS.STABLE_OK;

    var priority;
    switch (verdict) {
        case VERDICTS.OFFLINE_RISK_IMMINENT: priority = 'P0'; break;
        case VERDICTS.PREVENTIVE_SERVICE_URGENT: priority = 'P1'; break;
        case VERDICTS.WATCH_AND_INSPECT: priority = 'P2'; break;
        case VERDICTS.CONSUMABLES_RESTOCK: priority = 'P2'; break;
        case VERDICTS.SCHEDULED_SERVICE_SOON: priority = 'P3'; break;
        default: priority = 'P3';
    }

    // predicted downtime window days
    var predicted = 0;
    if (risk >= 75) predicted = Math.max(1, Math.round(ctx.horizonDays * 0.4));
    else if (risk >= 50) predicted = Math.max(1, Math.round(ctx.horizonDays * 0.2));
    else if (risk >= 25) predicted = 1;

    return {
        id: item.id,
        name: item.name,
        type: item.type,
        criticality: item.criticality,
        downtimeRisk: risk,
        verdict: verdict,
        priority: priority,
        predictedDowntimeWindowDays: predicted,
        backupAvailable: item.backupAvailable,
        scheduledServiceInDays: item.scheduledServiceInDays,
        components: {
            usageStress: Math.round(usageStress),
            calibrationDrift: Math.round(calibrationDrift),
            errorRate: Math.round(errorRate),
            consumablesGap: Math.round(consumablesGap),
            envSignal: Math.round(envSignal),
            runtimeAge: Math.round(runtimeAge),
        },
        reasons: deduped,
    };
}

// ── portfolio rollup ────────────────────────────────────────────

function _bandShift(appetite) {
    if (appetite === 'cautious') return -5;
    if (appetite === 'aggressive') return 5;
    return 0;
}

function _portfolioBand(score, appetite) {
    var shift = _bandShift(appetite);
    if (score >= 80 + shift) return 'CRITICAL';
    if (score >= 65 + shift) return 'HIGH';
    if (score >= 45 + shift) return 'ELEVATED';
    if (score >= 25 + shift) return 'WATCH';
    return 'CALM';
}

function _portfolioGrade(items, portfolioRisk) {
    var anyCriticalP0 = items.some(function (it) { return it.priority === 'P0' && it.criticality === 'critical'; });
    if (anyCriticalP0 || portfolioRisk >= 80) return 'F';
    var p0 = items.filter(function (it) { return it.priority === 'P0'; }).length;
    var p1 = items.filter(function (it) { return it.priority === 'P1'; }).length;
    var p2 = items.filter(function (it) { return it.priority === 'P2'; }).length;
    if (p0 >= 1 || portfolioRisk >= 65) return 'D';
    if (p1 >= 1 || portfolioRisk >= 45) return 'C';
    if (p2 >= 1 || portfolioRisk >= 25) return 'B';
    return 'A';
}

// ── playbook ────────────────────────────────────────────────────

function _idsByRiskDesc(items) {
    return items.slice().sort(function (a, b) { return b.downtimeRisk - a.downtimeRisk; }).map(function (it) { return it.id; });
}

function _uniqueSorted(arr) {
    var seen = {};
    arr.forEach(function (x) { if (typeof x === 'string' && x.length > 0) seen[x] = true; });
    return Object.keys(seen).sort();
}

function _buildPlaybook(items, ctx, normalized) {
    var actions = [];

    var offline = items.filter(function (it) { return it.verdict === VERDICTS.OFFLINE_RISK_IMMINENT; });
    var preventive = items.filter(function (it) { return it.verdict === VERDICTS.PREVENTIVE_SERVICE_URGENT; });
    var watch = items.filter(function (it) { return it.verdict === VERDICTS.WATCH_AND_INSPECT; });
    var consumables = items.filter(function (it) {
        var raw = normalized.byId[it.id];
        return raw && raw.consumablesLowFlags.length >= 2 && it.verdict !== VERDICTS.OFFLINE_RISK_IMMINENT && it.verdict !== VERDICTS.PREVENTIVE_SERVICE_URGENT;
    });
    var calibrationHeavy = items.filter(function (it) { return it.components.calibrationDrift >= 80; });
    var envItems = items.filter(function (it) { return it.components.envSignal > 0; });

    if (offline.length) {
        actions.push({
            id: 'TAKE_OFFLINE_AND_SERVICE',
            priority: 'P0',
            label: 'Take at-risk equipment offline and service immediately.',
            reason: offline.length + ' unit(s) at imminent failure risk.',
            owner: 'maintenance',
            blastRadius: 4,
            reversibility: 'low',
            equipmentIds: _idsByRiskDesc(offline),
        });
    }

    var criticalOfflineNoBackup = offline.filter(function (it) {
        var raw = normalized.byId[it.id];
        return it.criticality === 'critical' && !(raw && raw.backupAvailable);
    });
    if (criticalOfflineNoBackup.length && ctx.upcomingHighStakesBatches > 0) {
        actions.push({
            id: 'ENGAGE_BACKUP_OR_RESCHEDULE_BATCHES',
            priority: 'P0',
            label: 'Engage backup capacity or reschedule upcoming high-stakes batches.',
            reason: criticalOfflineNoBackup.length + ' critical unit(s) at risk with no backup and ' + ctx.upcomingHighStakesBatches + ' high-stakes batch(es) imminent.',
            owner: 'lab_manager',
            blastRadius: 5,
            reversibility: 'low',
            equipmentIds: _idsByRiskDesc(criticalOfflineNoBackup),
        });
    }

    if (preventive.length) {
        var ids = _idsByRiskDesc(preventive);
        actions.push({
            id: 'SCHEDULE_PREVENTIVE_SERVICE',
            priority: 'P1',
            label: 'Schedule preventive service for over-due units.',
            reason: preventive.length + ' unit(s) past or near service interval.',
            owner: 'maintenance',
            blastRadius: 3,
            reversibility: 'high',
            equipmentIds: ids,
            suggestedValue: ids,
        });
    }

    if (calibrationHeavy.length) {
        actions.push({
            id: 'CALIBRATE',
            priority: 'P1',
            label: 'Calibrate drifting units.',
            reason: calibrationHeavy.length + ' unit(s) with calibration drift >= 80.',
            owner: 'operator',
            blastRadius: 2,
            reversibility: 'high',
            equipmentIds: _idsByRiskDesc(calibrationHeavy),
        });
    }

    // restock consumables: union of all flags across fleet
    var allConsumables = [];
    items.forEach(function (it) {
        var raw = normalized.byId[it.id];
        if (raw) allConsumables = allConsumables.concat(raw.consumablesLowFlags);
    });
    var consumablesUnion = _uniqueSorted(allConsumables);
    if (consumablesUnion.length) {
        var consumableIds = items.filter(function (it) {
            var raw = normalized.byId[it.id];
            return raw && raw.consumablesLowFlags.length > 0;
        }).map(function (it) { return it.id; }).sort();
        actions.push({
            id: 'RESTOCK_CONSUMABLES',
            priority: 'P1',
            label: 'Restock low consumables across the fleet.',
            reason: consumablesUnion.length + ' part type(s) low across ' + consumableIds.length + ' unit(s).',
            owner: 'procurement',
            blastRadius: 2,
            reversibility: 'high',
            equipmentIds: consumableIds,
            suggestedValue: consumablesUnion,
        });
    }

    if (watch.length) {
        actions.push({
            id: 'INSPECT_AND_LOG',
            priority: 'P2',
            label: 'Inspect watch-list units and log findings.',
            reason: watch.length + ' unit(s) in WATCH state.',
            owner: 'operator',
            blastRadius: 1,
            reversibility: 'high',
            equipmentIds: _idsByRiskDesc(watch),
        });
    }

    if (envItems.length) {
        actions.push({
            id: 'INVESTIGATE_VIBRATION_OR_TEMP',
            priority: 'P2',
            label: 'Investigate vibration / temperature anomalies.',
            reason: envItems.length + ' unit(s) with environmental signal.',
            owner: 'maintenance',
            blastRadius: 2,
            reversibility: 'high',
            equipmentIds: _idsByRiskDesc(envItems),
        });
    }

    if (consumables.length && !consumablesUnion.length) {
        // unreachable, but documented branch.
    }

    // Capacity gate
    if (_isFiniteNum(ctx.activeMaintenanceCrew) && ctx.activeMaintenanceCrew > 0) {
        var neededIds = {};
        actions.forEach(function (a) {
            if (a.id === 'TAKE_OFFLINE_AND_SERVICE' || a.id === 'SCHEDULE_PREVENTIVE_SERVICE') {
                a.equipmentIds.forEach(function (eid) { neededIds[eid] = true; });
            }
        });
        var needed = Object.keys(neededIds).length;
        var cap = ctx.activeMaintenanceCrew * 3;
        if (needed > cap) {
            actions.push({
                id: 'EXPAND_MAINTENANCE_CAPACITY',
                priority: 'P1',
                label: 'Bring in additional maintenance crew for this window.',
                reason: needed + ' unit(s) need hands-on attention vs current crew capacity of ' + cap + '.',
                owner: 'ops',
                blastRadius: 3,
                reversibility: 'high',
                equipmentIds: Object.keys(neededIds).sort(),
                suggestedValue: Math.ceil(needed / 3),
            });
        }
    }

    if (actions.length === 0) {
        actions.push({
            id: 'FLEET_HEALTHY',
            priority: 'P3',
            label: 'Fleet is healthy — continue normal monitoring.',
            reason: 'No equipment crossed risk thresholds.',
            owner: 'ops',
            blastRadius: 1,
            reversibility: 'high',
            equipmentIds: [],
        });
    }

    // Appetite knobs.
    if (ctx.riskAppetite === 'aggressive') {
        var hasHigher = actions.some(function (a) { return a.priority === 'P0' || a.priority === 'P1'; });
        if (hasHigher) {
            // trim FLEET_HEALTHY and lone P2 actions
            actions = actions.filter(function (a) { return a.id !== 'FLEET_HEALTHY'; });
            var p2Count = actions.filter(function (a) { return a.priority === 'P2'; }).length;
            if (p2Count === 1) {
                actions = actions.filter(function (a) { return a.priority !== 'P2'; });
            }
        }
    }
    // cautious adds SCHEDULE_FLEET_AUDIT on C/D/F grade — added in evaluate after grading.

    // dedupe by id, P0-first sort.
    var seen = {};
    var deduped = [];
    actions.forEach(function (a) {
        if (!seen[a.id]) { seen[a.id] = true; deduped.push(a); }
    });
    deduped.sort(function (a, b) {
        if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return deduped;
}

// ── insights ────────────────────────────────────────────────────

function _buildInsights(items, ctx, normalized) {
    var insights = [];
    var critRisk = items.filter(function (it) {
        return it.criticality === 'critical' && (it.verdict === VERDICTS.OFFLINE_RISK_IMMINENT || it.verdict === VERDICTS.PREVENTIVE_SERVICE_URGENT);
    });
    if (critRisk.length >= 2) insights.push('MULTIPLE_CRITICAL_ASSETS_AT_RISK');

    var calibrationHeavy = items.filter(function (it) { return it.components.calibrationDrift >= 70; });
    if (calibrationHeavy.length >= 3) insights.push('CALIBRATION_DEBT');

    var consumablesItems = items.filter(function (it) {
        var raw = normalized.byId[it.id];
        return raw && raw.consumablesLowFlags.length >= 1;
    });
    if (consumablesItems.length >= 3) insights.push('CONSUMABLES_PORTFOLIO_GAP');

    var backupGap = items.some(function (it) {
        var raw = normalized.byId[it.id];
        return it.verdict === VERDICTS.OFFLINE_RISK_IMMINENT && it.criticality === 'critical' && !(raw && raw.backupAvailable);
    });
    if (backupGap) insights.push('BACKUP_GAP');

    if (items.length > 0) {
        var errTrendCount = items.filter(function (it) {
            var raw = normalized.byId[it.id];
            return raw && raw.errorsLast30d >= 3;
        }).length;
        if (errTrendCount / items.length >= 0.5) insights.push('ERROR_TREND_FLEETWIDE');
    }

    if (items.some(function (it) { return it.verdict === VERDICTS.SCHEDULED_SERVICE_SOON; })) {
        insights.push('SCHEDULED_RELIEF_INCOMING');
    }

    var anyAction = items.some(function (it) { return it.priority === 'P0' || it.priority === 'P1' || it.priority === 'P2'; });
    if (!anyAction && items.length > 0) insights.push('HEALTHY_FLEET');

    return insights;
}

// ── factory ─────────────────────────────────────────────────────

function createEquipmentDowntimeRiskAdvisor(opts) {
    opts = opts || {};
    var nowFn = typeof opts.now === 'function' ? opts.now : function () { return new Date(); };
    var defaultAppetite = (opts.riskAppetite && RISK_APPETITES[opts.riskAppetite]) || RISK_APPETITES.balanced;

    function evaluate(payload, overrides) {
        payload = payload || {};
        overrides = overrides || {};
        var horizonDays = _clamp(Math.round(_num(payload.horizonDays, 7)), 1, 30);
        var appetite = (overrides.riskAppetite && RISK_APPETITES[overrides.riskAppetite]) || defaultAppetite;
        var context = payload.context || {};
        var ctx = {
            now: _coerceDate(overrides.now, nowFn()),
            horizonDays: horizonDays,
            riskAppetite: appetite,
            upcomingHighStakesBatches: Math.max(0, Math.floor(_num(context.upcomingHighStakesBatches, 0))),
            activeMaintenanceCrew: _isFiniteNum(context.activeMaintenanceCrew) ? Math.max(0, Math.floor(context.activeMaintenanceCrew)) : null,
        };

        var equipmentRaw = Array.isArray(payload.equipment) ? payload.equipment : [];
        var normalized = { list: [], byId: {} };
        equipmentRaw.forEach(function (e) {
            if (!e || typeof e !== 'object') return;
            var norm = _normalizeEquipment(e);
            if (!norm.id) return;
            normalized.list.push(norm);
            normalized.byId[norm.id] = norm;
        });

        var items = normalized.list.map(function (it) { return _scoreItem(it, ctx); });

        // sort items deterministically: risk desc then id asc
        items.sort(function (a, b) {
            if (b.downtimeRisk !== a.downtimeRisk) return b.downtimeRisk - a.downtimeRisk;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });

        // portfolio
        var portfolioRisk = 0;
        if (items.length > 0) {
            var maxRisk = items[0].downtimeRisk;
            var topN = items.slice(0, Math.min(3, items.length));
            var meanTop = topN.reduce(function (s, it) { return s + it.downtimeRisk; }, 0) / topN.length;
            portfolioRisk = Math.round(maxRisk * 0.7 + meanTop * 0.3);
        }

        var band = _portfolioBand(portfolioRisk, appetite);
        var grade = items.length === 0 ? 'A' : _portfolioGrade(items, portfolioRisk);

        var playbook = _buildPlaybook(items, ctx, normalized);

        // cautious: append SCHEDULE_FLEET_AUDIT when grade is C/D/F
        if (appetite === 'cautious' && (grade === 'C' || grade === 'D' || grade === 'F')) {
            if (!playbook.some(function (a) { return a.id === 'SCHEDULE_FLEET_AUDIT'; })) {
                playbook.push({
                    id: 'SCHEDULE_FLEET_AUDIT',
                    priority: 'P2',
                    label: 'Schedule a full fleet maintenance audit.',
                    reason: 'Cautious appetite at grade ' + grade + ' — broader audit recommended.',
                    owner: 'lab_manager',
                    blastRadius: 1,
                    reversibility: 'high',
                    equipmentIds: [],
                });
                // re-sort
                playbook.sort(function (a, b) {
                    if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
                    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
                });
            }
        }

        var insights = _buildInsights(items, ctx, normalized);
        if (items.length === 0) insights = ['HEALTHY_FLEET'];

        var counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
        playbook.forEach(function (a) { counts[a.priority] = (counts[a.priority] || 0) + 1; });

        var headline;
        if (items.length === 0) headline = 'No equipment in fleet — nothing to monitor.';
        else if (grade === 'F') headline = 'CRITICAL — immediate intervention required across fleet.';
        else if (grade === 'D') headline = 'HIGH RISK — preventive action this shift.';
        else if (grade === 'C') headline = 'ELEVATED — schedule maintenance in horizon window.';
        else if (grade === 'B') headline = 'WATCH — minor issues to track.';
        else headline = 'CALM — fleet healthy.';

        return {
            generatedAt: ctx.now.toISOString(),
            horizonDays: horizonDays,
            riskAppetite: appetite,
            portfolioRisk: portfolioRisk,
            portfolioBand: band,
            grade: grade,
            headline: headline,
            equipmentCount: items.length,
            equipment: items,
            playbook: playbook,
            insights: insights,
            counts: counts,
            context: {
                upcomingHighStakesBatches: ctx.upcomingHighStakesBatches,
                activeMaintenanceCrew: ctx.activeMaintenanceCrew,
            },
        };
    }

    function simulate(opts2, report) {
        opts2 = opts2 || {};
        if (!report || typeof report !== 'object') throw new TypeError('report required');
        var applyTop = Math.max(0, Math.min(report.playbook.length, opts2.applyTop || 0));
        var risk = report.portfolioRisk;
        var applied = [];
        for (var i = 0; i < applyTop; i++) {
            var a = report.playbook[i];
            var deltaPct = ACTION_DELTA[a.id] !== undefined ? ACTION_DELTA[a.id] : -0.05;
            // diminishing returns
            var effective = deltaPct * Math.pow(0.85, i);
            var delta = Math.round(risk * effective);
            applied.push({ id: a.id, deltaApplied: delta });
            risk = Math.max(5, risk + delta);
        }
        var projectedBand = _portfolioBand(risk, report.riskAppetite);
        // projected grade: re-bucket using risk; preserve hard-F when source had F + we still have P0 critical
        var projectedGrade;
        if (risk >= 80) projectedGrade = 'F';
        else if (risk >= 65) projectedGrade = 'D';
        else if (risk >= 45) projectedGrade = 'C';
        else if (risk >= 25) projectedGrade = 'B';
        else projectedGrade = 'A';
        return {
            baselinePortfolioRisk: report.portfolioRisk,
            baselineBand: report.portfolioBand,
            baselineGrade: report.grade,
            projectedPortfolioRisk: risk,
            projectedBand: projectedBand,
            projectedGrade: projectedGrade,
            appliedActions: applied,
        };
    }

    // ── renderers ───────────────────────────────────────────────

    function formatText(r) {
        var lines = [];
        lines.push('EQUIPMENT DOWNTIME RISK — horizon ' + r.horizonDays + 'd');
        lines.push('Grade ' + r.grade + ' | Portfolio risk ' + r.portfolioRisk + '/100 | Band ' + r.portfolioBand + ' | Appetite ' + r.riskAppetite);
        lines.push(r.headline);
        lines.push('Generated: ' + r.generatedAt + ' | Equipment: ' + r.equipmentCount);
        lines.push('-'.repeat(60));
        if (r.equipment.length === 0) lines.push('(no equipment)');
        else r.equipment.forEach(function (it) {
            lines.push('  [' + it.priority + '] ' + it.id + ' ' + it.name + ' — ' + it.verdict + ' (risk ' + it.downtimeRisk + ', est ' + it.predictedDowntimeWindowDays + 'd downtime)');
            it.reasons.slice(0, 3).forEach(function (rs) { lines.push('       · ' + rs.code + ': ' + rs.label); });
        });
        if (r.playbook.length) {
            lines.push('');
            lines.push('Playbook (P0=' + r.counts.P0 + ' P1=' + r.counts.P1 + ' P2=' + r.counts.P2 + ' P3=' + r.counts.P3 + '):');
            r.playbook.forEach(function (a) {
                lines.push('  [' + a.priority + '] ' + a.id + ' (owner=' + a.owner + ', blast=' + a.blastRadius + ', rev=' + a.reversibility + ')');
                lines.push('     ' + a.label + ' — ' + a.reason);
            });
        }
        lines.push('');
        lines.push('Insights: ' + (r.insights.length ? r.insights.join(', ') : '(none)'));
        return lines.join('\n');
    }

    function formatMarkdown(r) {
        var out = [];
        out.push('# Equipment Downtime Risk');
        out.push('');
        out.push('**Horizon:** ' + r.horizonDays + ' day(s) &nbsp; **Grade:** ' + r.grade + ' &nbsp; **Portfolio risk:** ' + r.portfolioRisk + '/100 &nbsp; **Band:** ' + r.portfolioBand);
        out.push('**Risk appetite:** ' + r.riskAppetite + ' &nbsp; **Equipment:** ' + r.equipmentCount);
        out.push('');
        out.push('> ' + r.headline);
        out.push('');
        out.push('## Summary');
        out.push('');
        out.push('| P0 | P1 | P2 | P3 |');
        out.push('|---:|---:|---:|---:|');
        out.push('| ' + r.counts.P0 + ' | ' + r.counts.P1 + ' | ' + r.counts.P2 + ' | ' + r.counts.P3 + ' |');
        out.push('');
        out.push('## Equipment');
        out.push('');
        if (r.equipment.length === 0) out.push('_No equipment in fleet._');
        else {
            out.push('| Priority | ID | Name | Type | Crit | Verdict | Risk | Est days down |');
            out.push('|----------|----|------|------|------|---------|-----:|--------------:|');
            r.equipment.forEach(function (it) {
                out.push('| ' + it.priority + ' | ' + it.id + ' | ' + it.name + ' | ' + it.type + ' | ' + it.criticality + ' | ' + it.verdict + ' | ' + it.downtimeRisk + ' | ' + it.predictedDowntimeWindowDays + ' |');
            });
        }
        out.push('');
        out.push('## Playbook');
        out.push('');
        if (r.playbook.length === 0) out.push('_No actions._');
        else {
            out.push('| Priority | Action | Owner | Blast | Rev | Reason |');
            out.push('|----------|--------|-------|------:|-----|--------|');
            r.playbook.forEach(function (a) {
                out.push('| ' + a.priority + ' | ' + a.id + ' | ' + a.owner + ' | ' + a.blastRadius + ' | ' + a.reversibility + ' | ' + a.reason + ' |');
            });
        }
        out.push('');
        out.push('## Insights');
        out.push('');
        if (r.insights.length === 0) out.push('- _(none)_');
        else r.insights.forEach(function (i) { out.push('- ' + i); });
        return out.join('\n');
    }

    function _sortKeys(value) {
        if (Array.isArray(value)) return value.map(_sortKeys);
        if (value && typeof value === 'object' && !(value instanceof Date)) {
            var keys = Object.keys(value).sort();
            var out = {};
            keys.forEach(function (k) { out[k] = _sortKeys(value[k]); });
            return out;
        }
        if (value instanceof Date) return value.toISOString();
        return value;
    }

    function formatJson(r) { return JSON.stringify(_sortKeys(r), null, 2); }

    return {
        evaluate: evaluate,
        simulate: simulate,
        formatText: formatText,
        formatMarkdown: formatMarkdown,
        formatJson: formatJson,
        VERDICTS: VERDICTS,
    };
}

module.exports = {
    createEquipmentDowntimeRiskAdvisor: createEquipmentDowntimeRiskAdvisor,
    VERDICTS: VERDICTS,
};
