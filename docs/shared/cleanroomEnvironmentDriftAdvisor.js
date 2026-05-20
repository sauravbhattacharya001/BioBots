'use strict';

/**
 * Cleanroom Environment Drift Advisor - agentic per-zone environmental drift
 * watcher for ISO-classified cleanroom areas (Class 5..8). Sibling to
 * ContaminationEarlyWarning / ContaminationPropagationAdvisor /
 * EnvironmentalMonitor / OperatorFatigueAdvisor: catches T / RH / particle
 * count / differential-pressure drift BEFORE it turns into a contamination
 * event so cells, batches, and patients aren't downstream of an out-of-spec
 * environment.
 *
 * Inputs:
 *   zones[]: {
 *     id, name, isoClass (5..8), role ('aseptic'|'process'|'storage'|'support'|...),
 *     samples[]: {
 *       ts (ISO/Date), temperatureC, humidityPct,
 *       particles05umPerM3, particles5umPerM3,
 *       diffPressurePa,                  // vs adjacent zone (target > 0)
 *       co2Ppm?, hepaRuntimeHours?       // optional
 *     },
 *     spec? overrides default ISO spec
 *     hasOpenActivity? (boolean - cells exposed during sample window?)
 *     batchIds? (string[] - active batches in this zone)
 *   }
 *   context: {
 *     upcomingHighStakesBatches?, recentContaminationEvents?, validationDueDays?
 *   }
 *   options: { riskAppetite, now }
 *
 * Per-zone verdicts: SHUT_DOWN / QUARANTINE_AND_REVALIDATE / HOLD_BATCHES /
 *   INVESTIGATE_NOW / TIGHTEN_MONITORING / WATCH / IN_CONTROL.
 * Portfolio: A-F grade, P0..P3 deduped playbook, insight codes, simulate().
 *
 * Pure CommonJS, zero deps, deterministic given injected now(), never mutates
 * inputs.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var advisor = biobots.createCleanroomEnvironmentDriftAdvisor({
 *       now: function () { return new Date('2026-05-20T20:00:00Z'); }
 *   });
 *   var report = advisor.evaluate({ zones: [...], context: {...} });
 *   console.log(advisor.formatMarkdown(report));
 */

var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
var APPETITES = { cautious: 'cautious', balanced: 'balanced', aggressive: 'aggressive' };
var APPETITE_MULT = { cautious: 1.15, balanced: 1.0, aggressive: 0.85 };
var APPETITE_VERDICT_SHIFT = { cautious: 1, balanced: 0, aggressive: -1 };

var VERDICTS = {
    SHUT_DOWN: 'SHUT_DOWN',
    QUARANTINE_AND_REVALIDATE: 'QUARANTINE_AND_REVALIDATE',
    HOLD_BATCHES: 'HOLD_BATCHES',
    INVESTIGATE_NOW: 'INVESTIGATE_NOW',
    TIGHTEN_MONITORING: 'TIGHTEN_MONITORING',
    WATCH: 'WATCH',
    IN_CONTROL: 'IN_CONTROL',
};

var VERDICT_PRIORITY = {
    SHUT_DOWN: 'P0',
    QUARANTINE_AND_REVALIDATE: 'P0',
    HOLD_BATCHES: 'P1',
    INVESTIGATE_NOW: 'P1',
    TIGHTEN_MONITORING: 'P2',
    WATCH: 'P2',
    IN_CONTROL: 'P3',
};

// Verdict ladder ordered most-severe -> least-severe for shift math.
var VERDICT_LADDER = [
    VERDICTS.SHUT_DOWN,
    VERDICTS.QUARANTINE_AND_REVALIDATE,
    VERDICTS.HOLD_BATCHES,
    VERDICTS.INVESTIGATE_NOW,
    VERDICTS.TIGHTEN_MONITORING,
    VERDICTS.WATCH,
    VERDICTS.IN_CONTROL,
];

/**
 * ISO 14644-1 in-operation particle limits (counts per m^3).
 * Plus typical bioprinting cleanroom T/RH/pressure operating bands.
 */
var ISO_DEFAULT_SPEC = {
    5: { p05Max: 3520,    p5Max: 29,     tMin: 18, tMax: 24, rhMin: 30, rhMax: 65, dpMin: 12 },
    6: { p05Max: 35200,   p5Max: 293,    tMin: 18, tMax: 25, rhMin: 30, rhMax: 65, dpMin: 10 },
    7: { p05Max: 352000,  p5Max: 2930,   tMin: 18, tMax: 26, rhMin: 30, rhMax: 70, dpMin: 8 },
    8: { p05Max: 3520000, p5Max: 29300,  tMin: 18, tMax: 27, rhMin: 25, rhMax: 75, dpMin: 5 },
};

function _appetiteOk(a) {
    if (!a) return APPETITES.balanced;
    if (!APPETITES[a]) throw new Error('CleanroomEnvironmentDriftAdvisor: unknown riskAppetite "' + a + '"');
    return a;
}

function _toDate(x) {
    if (x instanceof Date) return x;
    var d = new Date(x);
    if (isNaN(d.getTime())) return null;
    return d;
}

function _num(x, def) {
    if (typeof x !== 'number' || !isFinite(x)) return def;
    return x;
}

function _mean(arr) {
    if (!arr.length) return 0;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
}

function _max(arr) {
    if (!arr.length) return 0;
    var m = arr[0];
    for (var i = 1; i < arr.length; i++) if (arr[i] > m) m = arr[i];
    return m;
}

function _min(arr) {
    if (!arr.length) return 0;
    var m = arr[0];
    for (var i = 1; i < arr.length; i++) if (arr[i] < m) m = arr[i];
    return m;
}

function _trend(arr) {
    // simple slope estimate via mean(first-half) vs mean(second-half)
    if (arr.length < 4) return 0;
    var mid = Math.floor(arr.length / 2);
    return _mean(arr.slice(mid)) - _mean(arr.slice(0, mid));
}

function _ladderShift(verdict, shift) {
    var idx = VERDICT_LADDER.indexOf(verdict);
    if (idx < 0) return verdict;
    var next = idx - shift; // positive shift = more severe (lower index)
    if (next < 0) next = 0;
    if (next >= VERDICT_LADDER.length) next = VERDICT_LADDER.length - 1;
    return VERDICT_LADDER[next];
}

function _normalizeZone(zone) {
    var isoClass = _num(zone.isoClass, 7);
    if (![5, 6, 7, 8].indexOf(isoClass) >= 0) isoClass = 7;
    var spec = Object.assign({}, ISO_DEFAULT_SPEC[isoClass] || ISO_DEFAULT_SPEC[7], zone.spec || {});
    var samplesIn = Array.isArray(zone.samples) ? zone.samples : [];
    var samples = [];
    for (var i = 0; i < samplesIn.length; i++) {
        var s = samplesIn[i] || {};
        var ts = _toDate(s.ts);
        if (!ts) continue;
        samples.push({
            ts: ts,
            temperatureC: _num(s.temperatureC, null),
            humidityPct: _num(s.humidityPct, null),
            particles05umPerM3: _num(s.particles05umPerM3, null),
            particles5umPerM3: _num(s.particles5umPerM3, null),
            diffPressurePa: _num(s.diffPressurePa, null),
            co2Ppm: _num(s.co2Ppm, null),
            hepaRuntimeHours: _num(s.hepaRuntimeHours, null),
        });
    }
    samples.sort(function (a, b) { return a.ts - b.ts; });
    return {
        id: String(zone.id || ''),
        name: String(zone.name || zone.id || 'zone'),
        isoClass: isoClass,
        role: String(zone.role || 'process'),
        hasOpenActivity: !!zone.hasOpenActivity,
        batchIds: Array.isArray(zone.batchIds) ? zone.batchIds.slice() : [],
        spec: spec,
        samples: samples,
    };
}

function _evaluateZone(zone, appetite, ctx) {
    var spec = zone.spec;
    var ss = zone.samples;
    var reasons = [];
    var risk = 0;
    var mult = APPETITE_MULT[appetite];

    if (!ss.length) {
        reasons.push({ code: 'NO_SAMPLES', weight: 20 });
        risk = 20 * mult;
        return _buildAssessment(zone, VERDICTS.WATCH, risk, reasons, ctx, appetite);
    }

    var temps = ss.map(function (s) { return s.temperatureC; }).filter(function (v) { return v !== null; });
    var rhs = ss.map(function (s) { return s.humidityPct; }).filter(function (v) { return v !== null; });
    var p05 = ss.map(function (s) { return s.particles05umPerM3; }).filter(function (v) { return v !== null; });
    var p5 = ss.map(function (s) { return s.particles5umPerM3; }).filter(function (v) { return v !== null; });
    var dps = ss.map(function (s) { return s.diffPressurePa; }).filter(function (v) { return v !== null; });

    // Particles - critical (cells exposed to particles == game over)
    if (p05.length) {
        var maxP05 = _max(p05);
        if (maxP05 > spec.p05Max * 2) { reasons.push({ code: 'PARTICLES_0_5UM_SEVERE_EXCEEDANCE', weight: 35 }); risk += 35; }
        else if (maxP05 > spec.p05Max) { reasons.push({ code: 'PARTICLES_0_5UM_EXCEEDANCE', weight: 22 }); risk += 22; }
        else if (maxP05 > spec.p05Max * 0.8) { reasons.push({ code: 'PARTICLES_0_5UM_NEAR_LIMIT', weight: 10 }); risk += 10; }
        var p05Trend = _trend(p05);
        if (p05Trend > spec.p05Max * 0.2) { reasons.push({ code: 'PARTICLES_RISING_TREND', weight: 10 }); risk += 10; }
    }
    if (p5.length) {
        var maxP5 = _max(p5);
        if (maxP5 > spec.p5Max * 2) { reasons.push({ code: 'PARTICLES_5UM_SEVERE_EXCEEDANCE', weight: 30 }); risk += 30; }
        else if (maxP5 > spec.p5Max) { reasons.push({ code: 'PARTICLES_5UM_EXCEEDANCE', weight: 18 }); risk += 18; }
    }

    // Differential pressure - positive cascade is non-negotiable for aseptic
    if (dps.length) {
        var minDp = _min(dps);
        var meanDp = _mean(dps);
        if (minDp <= 0) {
            reasons.push({ code: 'PRESSURE_INVERSION', weight: zone.role === 'aseptic' ? 35 : 25 });
            risk += zone.role === 'aseptic' ? 35 : 25;
        } else if (minDp < spec.dpMin * 0.5) {
            reasons.push({ code: 'PRESSURE_CRITICALLY_LOW', weight: 20 });
            risk += 20;
        } else if (meanDp < spec.dpMin) {
            reasons.push({ code: 'PRESSURE_BELOW_SPEC', weight: 12 });
            risk += 12;
        }
    } else {
        reasons.push({ code: 'PRESSURE_NOT_MONITORED', weight: 5 });
        risk += 5;
    }

    // Temperature
    if (temps.length) {
        var tMax = _max(temps);
        var tMin = _min(temps);
        if (tMax > spec.tMax + 2 || tMin < spec.tMin - 2) { reasons.push({ code: 'TEMPERATURE_OUT_OF_SPEC_HARD', weight: 18 }); risk += 18; }
        else if (tMax > spec.tMax || tMin < spec.tMin) { reasons.push({ code: 'TEMPERATURE_OUT_OF_SPEC', weight: 10 }); risk += 10; }
        if (tMax - tMin > 3) { reasons.push({ code: 'TEMPERATURE_OSCILLATION', weight: 6 }); risk += 6; }
    }

    // Humidity
    if (rhs.length) {
        var rhMax = _max(rhs);
        var rhMin = _min(rhs);
        if (rhMax > spec.rhMax + 10 || rhMin < spec.rhMin - 10) { reasons.push({ code: 'HUMIDITY_OUT_OF_SPEC_HARD', weight: 16 }); risk += 16; }
        else if (rhMax > spec.rhMax || rhMin < spec.rhMin) { reasons.push({ code: 'HUMIDITY_OUT_OF_SPEC', weight: 8 }); risk += 8; }
    }

    // Context-aware amplifiers
    if (zone.hasOpenActivity && risk > 0) {
        reasons.push({ code: 'OPEN_ACTIVITY_AMPLIFIER', weight: 10 });
        risk += 10;
    }
    if (zone.batchIds.length > 0 && risk >= 30) {
        reasons.push({ code: 'ACTIVE_BATCHES_AT_RISK', weight: 5 });
        risk += 5;
    }
    if (ctx.recentContaminationEvents > 0 && risk >= 20) {
        reasons.push({ code: 'PRIOR_CONTAMINATION_CONTEXT', weight: 5 });
        risk += 5;
    }

    risk = Math.max(0, Math.min(100, Math.round(risk * mult)));

    // Verdict selection by score, then context-driven shift.
    var verdict;
    if (risk >= 80) verdict = VERDICTS.SHUT_DOWN;
    else if (risk >= 65) verdict = VERDICTS.QUARANTINE_AND_REVALIDATE;
    else if (risk >= 50) verdict = VERDICTS.HOLD_BATCHES;
    else if (risk >= 35) verdict = VERDICTS.INVESTIGATE_NOW;
    else if (risk >= 20) verdict = VERDICTS.TIGHTEN_MONITORING;
    else if (risk >= 10) verdict = VERDICTS.WATCH;
    else verdict = VERDICTS.IN_CONTROL;

    // Aseptic zones with any pressure inversion are at least HOLD_BATCHES.
    if (zone.role === 'aseptic' && reasons.some(function (r) { return r.code === 'PRESSURE_INVERSION'; })) {
        if (VERDICT_LADDER.indexOf(verdict) > VERDICT_LADDER.indexOf(VERDICTS.HOLD_BATCHES)) {
            verdict = VERDICTS.HOLD_BATCHES;
        }
    }
    // Severe particle exceedance with open activity -> at least QUARANTINE.
    if (zone.hasOpenActivity && reasons.some(function (r) { return r.code === 'PARTICLES_0_5UM_SEVERE_EXCEEDANCE' || r.code === 'PARTICLES_5UM_SEVERE_EXCEEDANCE'; })) {
        if (VERDICT_LADDER.indexOf(verdict) > VERDICT_LADDER.indexOf(VERDICTS.QUARANTINE_AND_REVALIDATE)) {
            verdict = VERDICTS.QUARANTINE_AND_REVALIDATE;
        }
    }
    verdict = _ladderShift(verdict, APPETITE_VERDICT_SHIFT[appetite]);

    return _buildAssessment(zone, verdict, risk, reasons, ctx, appetite);
}

function _buildAssessment(zone, verdict, risk, reasons, ctx, appetite) {
    // Stable sort: weight desc, then code asc; dedupe by code (keep highest weight).
    var byCode = Object.create(null);
    reasons.forEach(function (r) {
        if (!byCode[r.code] || byCode[r.code].weight < r.weight) byCode[r.code] = r;
    });
    var deduped = Object.keys(byCode).map(function (k) { return byCode[k]; });
    deduped.sort(function (a, b) { return b.weight - a.weight || (a.code < b.code ? -1 : 1); });
    return {
        id: zone.id,
        name: zone.name,
        isoClass: zone.isoClass,
        role: zone.role,
        hasOpenActivity: zone.hasOpenActivity,
        batchIds: zone.batchIds.slice(),
        sampleCount: zone.samples.length,
        driftRisk: risk,
        verdict: verdict,
        priority: VERDICT_PRIORITY[verdict] || 'P3',
        reasons: deduped,
    };
}

function _buildPlaybook(assessments, ctx, appetite) {
    var actions = [];
    var byVerdict = Object.create(null);
    assessments.forEach(function (a) {
        (byVerdict[a.verdict] = byVerdict[a.verdict] || []).push(a);
    });

    function _idsFor(verdicts) {
        var ids = [];
        verdicts.forEach(function (v) {
            (byVerdict[v] || []).forEach(function (a) { ids.push(a.id); });
        });
        return ids;
    }

    // P0
    if (byVerdict[VERDICTS.SHUT_DOWN] && byVerdict[VERDICTS.SHUT_DOWN].length) {
        actions.push({
            id: 'SHUT_DOWN_AFFECTED_ZONES', priority: 'P0', owner: 'facility_lead',
            label: 'Shut down and lock out affected zones',
            reason: 'Multi-axis drift with critical exceedance.',
            blastRadius: 5, reversibility: 'medium', zoneIds: _idsFor([VERDICTS.SHUT_DOWN]),
            estRiskDelta: -40,
        });
    }
    if (byVerdict[VERDICTS.QUARANTINE_AND_REVALIDATE] && byVerdict[VERDICTS.QUARANTINE_AND_REVALIDATE].length) {
        actions.push({
            id: 'QUARANTINE_AND_REVALIDATE_ZONES', priority: 'P0', owner: 'quality_assurance',
            label: 'Quarantine zone and revalidate before reopening',
            reason: 'Significant particle / pressure deviation with open activity.',
            blastRadius: 4, reversibility: 'low', zoneIds: _idsFor([VERDICTS.QUARANTINE_AND_REVALIDATE]),
            estRiskDelta: -28,
        });
    }
    // Active batches in any P0/P1 zone -> recall hold.
    var atRiskBatches = [];
    assessments.forEach(function (a) {
        if ((a.priority === 'P0' || a.priority === 'P1') && a.batchIds.length) {
            a.batchIds.forEach(function (b) { atRiskBatches.push(b); });
        }
    });
    if (atRiskBatches.length) {
        actions.push({
            id: 'HOLD_DOWNSTREAM_BATCHES', priority: 'P0', owner: 'qa_release',
            label: 'Place active batches in environmental hold',
            reason: 'Batches were exposed to drifting environment; release blocked pending review.',
            blastRadius: 4, reversibility: 'medium', zoneIds: [], batchIds: atRiskBatches,
            estRiskDelta: -18,
        });
    }

    // P1
    if (byVerdict[VERDICTS.HOLD_BATCHES] && byVerdict[VERDICTS.HOLD_BATCHES].length) {
        actions.push({
            id: 'HOLD_BATCH_RELEASE', priority: 'P1', owner: 'qa_release',
            label: 'Hold batch release for impact assessment',
            reason: 'Zone is out of spec on at least one axis during processing.',
            blastRadius: 3, reversibility: 'high', zoneIds: _idsFor([VERDICTS.HOLD_BATCHES]),
            estRiskDelta: -15,
        });
    }
    if (byVerdict[VERDICTS.INVESTIGATE_NOW] && byVerdict[VERDICTS.INVESTIGATE_NOW].length) {
        actions.push({
            id: 'INVESTIGATE_DRIFT_ROOT_CAUSE', priority: 'P1', owner: 'facility_eng',
            label: 'Open deviation and investigate drift root cause',
            reason: 'Multiple drift signals trending out of control.',
            blastRadius: 2, reversibility: 'high', zoneIds: _idsFor([VERDICTS.INVESTIGATE_NOW]),
            estRiskDelta: -12,
        });
    }
    // HEPA / filtration sweep when several zones show rising particles.
    var risingParticleZones = assessments.filter(function (a) {
        return a.reasons.some(function (r) { return r.code === 'PARTICLES_RISING_TREND' || r.code.indexOf('PARTICLES_') === 0; });
    });
    if (risingParticleZones.length >= 2) {
        actions.push({
            id: 'SCHEDULE_HEPA_SWEEP', priority: 'P1', owner: 'facility_eng',
            label: 'Schedule HEPA filter / pre-filter inspection sweep',
            reason: 'Multiple zones show particle excursions or rising trend; common filter cause likely.',
            blastRadius: 2, reversibility: 'high', zoneIds: risingParticleZones.map(function (z) { return z.id; }),
            estRiskDelta: -10,
        });
    }
    var inversionZones = assessments.filter(function (a) {
        return a.reasons.some(function (r) { return r.code === 'PRESSURE_INVERSION'; });
    });
    if (inversionZones.length) {
        actions.push({
            id: 'REBALANCE_AIR_HANDLING', priority: 'P1', owner: 'facility_eng',
            label: 'Rebalance AHU / pressure cascade',
            reason: 'Differential pressure inversion detected vs adjacent zone.',
            blastRadius: 3, reversibility: 'medium', zoneIds: inversionZones.map(function (z) { return z.id; }),
            estRiskDelta: -14,
        });
    }

    // P2
    if (byVerdict[VERDICTS.TIGHTEN_MONITORING] && byVerdict[VERDICTS.TIGHTEN_MONITORING].length) {
        actions.push({
            id: 'TIGHTEN_MONITORING_CADENCE', priority: 'P2', owner: 'qa_monitoring',
            label: 'Increase sampling cadence and lower alert thresholds',
            reason: 'Zone is trending toward spec edge.',
            blastRadius: 1, reversibility: 'high', zoneIds: _idsFor([VERDICTS.TIGHTEN_MONITORING, VERDICTS.WATCH]),
            estRiskDelta: -6,
        });
    }
    var noPressureZones = assessments.filter(function (a) {
        return a.reasons.some(function (r) { return r.code === 'PRESSURE_NOT_MONITORED'; });
    });
    if (noPressureZones.length) {
        actions.push({
            id: 'INSTRUMENT_PRESSURE_SENSORS', priority: 'P2', owner: 'facility_eng',
            label: 'Add or repair differential pressure sensors',
            reason: 'Zone has no differential pressure telemetry; cannot prove cascade integrity.',
            blastRadius: 1, reversibility: 'high', zoneIds: noPressureZones.map(function (z) { return z.id; }),
            estRiskDelta: -4,
        });
    }

    // Always-include P3 fallback when nothing else applies.
    if (!actions.length) {
        actions.push({
            id: 'ENVIRONMENT_IN_CONTROL', priority: 'P3', owner: 'qa_monitoring',
            label: 'Environment in control - maintain monitoring cadence',
            reason: 'No drift signals exceeded thresholds.',
            blastRadius: 1, reversibility: 'high', zoneIds: assessments.map(function (a) { return a.id; }),
            estRiskDelta: 0,
        });
    }

    // Cautious adds a tuning review at C/D/F grades; aggressive trims P3 + lone P2.
    if (appetite === APPETITES.aggressive) {
        var hasP01 = actions.some(function (a) { return a.priority === 'P0' || a.priority === 'P1'; });
        if (hasP01) {
            actions = actions.filter(function (a) { return a.priority !== 'P3'; });
            var p2 = actions.filter(function (a) { return a.priority === 'P2'; });
            if (p2.length === 1) actions = actions.filter(function (a) { return a.priority !== 'P2'; });
        }
    }

    // Dedupe by id (already unique above) and stable sort.
    actions.sort(function (a, b) {
        var pa = PRIORITY_RANK[a.priority], pb = PRIORITY_RANK[b.priority];
        if (pa !== pb) return pa - pb;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return actions;
}

function _buildInsights(assessments, ctx) {
    var insights = [];
    if (!assessments.length) {
        insights.push('NO_ZONES_PROVIDED');
        return insights;
    }
    var p0 = assessments.filter(function (a) { return a.priority === 'P0'; }).length;
    var inversion = assessments.filter(function (a) { return a.reasons.some(function (r) { return r.code === 'PRESSURE_INVERSION'; }); }).length;
    var particles = assessments.filter(function (a) { return a.reasons.some(function (r) { return r.code.indexOf('PARTICLES_') === 0; }); }).length;
    var temp = assessments.filter(function (a) { return a.reasons.some(function (r) { return r.code.indexOf('TEMPERATURE_') === 0; }); }).length;
    var humidity = assessments.filter(function (a) { return a.reasons.some(function (r) { return r.code.indexOf('HUMIDITY_') === 0; }); }).length;
    var asepticHits = assessments.filter(function (a) { return a.role === 'aseptic' && a.priority !== 'P3'; }).length;

    if (p0 >= 1) insights.push('CRITICAL_DRIFT_PRESENT');
    if (inversion >= 1) insights.push('PRESSURE_CASCADE_BROKEN');
    if (particles >= 2) insights.push('PARTICLE_EXCURSION_CLUSTER');
    if (temp >= 2) insights.push('HVAC_THERMAL_DRIFT');
    if (humidity >= 2) insights.push('HUMIDITY_CONTROL_LOSS');
    if (asepticHits >= 1) insights.push('ASEPTIC_ZONE_AT_RISK');
    if (ctx.recentContaminationEvents > 0 && p0 + inversion > 0) insights.push('PRIOR_EVENT_PATTERN_REPEATING');
    if (!p0 && !inversion && !particles && !temp && !humidity) insights.push('ENVIRONMENT_STABLE');
    if (assessments.every(function (a) { return a.sampleCount === 0; })) insights.push('NO_TELEMETRY');
    return insights;
}

function _gradeFromRisk(risk, p0, anyInversionAseptic) {
    if (anyInversionAseptic || p0 >= 2 || risk >= 80) return 'F';
    if (p0 >= 1 || risk >= 60) return 'D';
    if (risk >= 40) return 'C';
    if (risk >= 20) return 'B';
    return 'A';
}

function _band(risk) {
    if (risk >= 80) return 'CRITICAL';
    if (risk >= 60) return 'HIGH';
    if (risk >= 40) return 'ELEVATED';
    if (risk >= 20) return 'WATCH';
    return 'CALM';
}

function createCleanroomEnvironmentDriftAdvisor(options) {
    options = options || {};
    var riskAppetite = _appetiteOk(options.riskAppetite || 'balanced');
    var nowFn = typeof options.now === 'function' ? options.now : function () { return new Date(); };

    function evaluate(input) {
        input = input || {};
        var zonesIn = Array.isArray(input.zones) ? input.zones : [];
        var ctx = input.context || {};
        ctx = {
            recentContaminationEvents: _num(ctx.recentContaminationEvents, 0),
            upcomingHighStakesBatches: _num(ctx.upcomingHighStakesBatches, 0),
            validationDueDays: _num(ctx.validationDueDays, null),
        };
        var generatedAt = nowFn().toISOString();
        var zones = zonesIn.map(_normalizeZone);
        var assessments = zones.map(function (z) { return _evaluateZone(z, riskAppetite, ctx); });

        // Stable sort: priority asc, risk desc, id asc.
        assessments.sort(function (a, b) {
            var pa = PRIORITY_RANK[a.priority], pb = PRIORITY_RANK[b.priority];
            if (pa !== pb) return pa - pb;
            if (b.driftRisk !== a.driftRisk) return b.driftRisk - a.driftRisk;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });

        var portfolioRisk = assessments.length ? Math.round(_mean(assessments.map(function (a) { return a.driftRisk; }))) : 0;
        var p0 = assessments.filter(function (a) { return a.priority === 'P0'; }).length;
        var anyAsepticInversion = assessments.some(function (a) {
            return a.role === 'aseptic' && a.reasons.some(function (r) { return r.code === 'PRESSURE_INVERSION'; });
        });
        var grade = _gradeFromRisk(portfolioRisk, p0, anyAsepticInversion);
        var playbook = _buildPlaybook(assessments, ctx, riskAppetite);
        var insights = _buildInsights(assessments, ctx);

        return {
            generatedAt: generatedAt,
            riskAppetite: riskAppetite,
            zoneCount: assessments.length,
            portfolioRisk: portfolioRisk,
            portfolioBand: _band(portfolioRisk),
            grade: grade,
            zones: assessments,
            playbook: playbook,
            insights: insights,
        };
    }

    function simulate(input, opts) {
        opts = opts || {};
        var applyTop = Math.max(0, Math.min(20, _num(opts.applyTop, 3)));
        var report = evaluate(input);
        var deltas = report.playbook.slice(0, applyTop);
        // 0.85^i diminishing-returns combined risk reduction.
        var projected = report.portfolioRisk;
        var applied = [];
        for (var i = 0; i < deltas.length; i++) {
            var d = _num(deltas[i].estRiskDelta, 0);
            projected += d * Math.pow(0.85, i);
            applied.push({ id: deltas[i].id, priority: deltas[i].priority, appliedDelta: Math.round(d * Math.pow(0.85, i)) });
        }
        projected = Math.max(0, Math.min(100, Math.round(projected)));
        return {
            generatedAt: report.generatedAt,
            baselineRisk: report.portfolioRisk,
            projectedRisk: projected,
            projectedBand: _band(projected),
            appliedActions: applied,
        };
    }

    function formatText(report) {
        var lines = [];
        lines.push('# Cleanroom Environment Drift Report');
        lines.push('Generated: ' + report.generatedAt);
        lines.push('Risk appetite: ' + report.riskAppetite);
        lines.push('Zones: ' + report.zoneCount + '  portfolio risk: ' + report.portfolioRisk + ' (' + report.portfolioBand + ')  grade: ' + report.grade);
        lines.push('');
        if (report.zones.length) {
            lines.push('Zones:');
            report.zones.slice(0, 12).forEach(function (z) {
                lines.push('  [' + z.priority + '] ' + z.name + ' (' + z.id + ') iso=' + z.isoClass + ' role=' + z.role + ' risk=' + z.driftRisk + ' verdict=' + z.verdict);
            });
            lines.push('');
        }
        lines.push('Playbook:');
        report.playbook.forEach(function (a) {
            lines.push('  [' + a.priority + '] ' + a.id + ' - ' + a.label);
            lines.push('     why: ' + a.reason + '  owner=' + a.owner + ' blast=' + a.blastRadius);
        });
        lines.push('');
        lines.push('Insights: ' + report.insights.join(', '));
        return lines.join('\n');
    }

    function _mdEscape(s) { return String(s).replace(/\|/g, '\\|'); }

    function formatMarkdown(report) {
        var out = [];
        out.push('# Cleanroom Environment Drift Report');
        out.push('');
        out.push('- Generated: ' + report.generatedAt);
        out.push('- Risk appetite: ' + report.riskAppetite);
        out.push('- Zones: ' + report.zoneCount);
        out.push('- Portfolio risk: ' + report.portfolioRisk + ' (' + report.portfolioBand + ')');
        out.push('- Grade: ' + report.grade);
        out.push('');
        out.push('## Zones');
        out.push('');
        out.push('| Priority | ID | Name | ISO | Role | Risk | Verdict | Open | Batches |');
        out.push('|---|---|---|---:|---|---:|---|---|---|');
        report.zones.forEach(function (z) {
            out.push('| ' + z.priority + ' | ' + _mdEscape(z.id) + ' | ' + _mdEscape(z.name) + ' | ' + z.isoClass + ' | ' + z.role + ' | ' + z.driftRisk + ' | ' + z.verdict + ' | ' + (z.hasOpenActivity ? 'yes' : 'no') + ' | ' + z.batchIds.join(', ') + ' |');
        });
        if (report.zones.length === 0) out.push('| - | - | - | - | - | - | - | - | - |');
        out.push('');
        out.push('## Playbook');
        out.push('');
        out.push('| Priority | Action | Owner | Blast | Reversibility | Zones |');
        out.push('|---|---|---|---:|---|---|');
        report.playbook.forEach(function (a) {
            out.push('| ' + a.priority + ' | ' + _mdEscape(a.id) + ': ' + _mdEscape(a.label) + ' | ' + a.owner + ' | ' + a.blastRadius + ' | ' + a.reversibility + ' | ' + (a.zoneIds || []).join(', ') + ' |');
        });
        out.push('');
        out.push('## Insights');
        out.push('');
        report.insights.forEach(function (i) { out.push('- ' + i); });
        return out.join('\n');
    }

    function _stableStringify(value, indent) {
        function _rec(v, depth) {
            var pad = new Array(depth + 1).join(' '.repeat(indent));
            var padInner = new Array(depth + 2).join(' '.repeat(indent));
            if (v === null) return 'null';
            if (typeof v === 'number') return isFinite(v) ? String(v) : 'null';
            if (typeof v === 'boolean') return v ? 'true' : 'false';
            if (typeof v === 'string') return JSON.stringify(v);
            if (v instanceof Date) return JSON.stringify(v.toISOString());
            if (Array.isArray(v)) {
                if (v.length === 0) return '[]';
                var parts = v.map(function (x) { return padInner + _rec(x, depth + 1); });
                return '[\n' + parts.join(',\n') + '\n' + pad + ']';
            }
            if (typeof v === 'object') {
                var keys = Object.keys(v).sort();
                if (keys.length === 0) return '{}';
                var kparts = keys.map(function (k) { return padInner + JSON.stringify(k) + ': ' + _rec(v[k], depth + 1); });
                return '{\n' + kparts.join(',\n') + '\n' + pad + '}';
            }
            return 'null';
        }
        return _rec(value, 0);
    }

    function formatJson(report) { return _stableStringify(report, 2); }

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
    createCleanroomEnvironmentDriftAdvisor: createCleanroomEnvironmentDriftAdvisor,
    VERDICTS: VERDICTS,
};

if (typeof window !== 'undefined') {
    window.CleanroomEnvironmentDriftAdvisor = {
        createCleanroomEnvironmentDriftAdvisor: createCleanroomEnvironmentDriftAdvisor,
        VERDICTS: VERDICTS,
    };
}
