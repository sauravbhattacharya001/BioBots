'use strict';

/**
 * Operator Fatigue Advisor - agentic per-operator fatigue / burnout risk
 * advisor and 7th sibling to EquipmentDowntimeRiskAdvisor,
 * ContaminationPropagationAdvisor, ShiftHandoffSynthesizer,
 * BatchReleaseAdvisor, ReagentSubstitutionAdvisor and
 * PerishableWasteForecaster.
 *
 * The advisor takes a roster of operators with their recent workload signals
 * (rolling hours, consecutive days on, hours since last break, recent errors,
 * contamination incidents, night-shift count, sick days, planned role for the
 * next shift, backup availability, scheduled time off) plus context
 * (upcoming high-stakes batches, active staffing count, optional contractual
 * weekly hour cap) and emits a per-operator FatigueAssessment with a
 * structured 0-100 fatigueRisk score, a verdict from a 6-tier ladder, P0..P3
 * priority bucket, structured reason codes, a fleet-level playbook of ranked
 * actions with owner / blast / reversibility metadata, always-on insight
 * codes, an A-F shift-readiness grade and text / markdown / json renderers.
 *
 * Pure CommonJS, zero deps, deterministic given an injected now(), never
 * mutates inputs.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var advisor = biobots.createOperatorFatigueAdvisor({
 *       now: function () { return new Date('2026-05-19T20:00:00Z'); }
 *   });
 *   var report = advisor.evaluate({
 *       operators: [{
 *           id: 'OP-01', name: 'Alex', hoursLast24h: 14,
 *           consecutiveDaysWorked: 9, hoursSinceLastBreakMin: 360,
 *           errorsLast7d: 3, plannedRoleNext24h: 'deep',
 *       }],
 *       context: { upcomingHighStakesBatches: 2 },
 *   });
 *   console.log(advisor.formatMarkdown(report));
 */

var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
var RISK_APPETITES = { cautious: 'cautious', balanced: 'balanced', aggressive: 'aggressive' };

var VERDICTS = {
    BURNOUT_RISK_IMMINENT: 'BURNOUT_RISK_IMMINENT',
    MANDATORY_REST: 'MANDATORY_REST',
    REASSIGN_FROM_HIGH_STAKES: 'REASSIGN_FROM_HIGH_STAKES',
    WATCH_AND_PAIR: 'WATCH_AND_PAIR',
    OFFER_BREAK: 'OFFER_BREAK',
    READY_FOR_SHIFT: 'READY_FOR_SHIFT',
};

var ROLE_RISK = {
    deep: 1.20,    // deep-focus / high-stakes tasks
    standard: 1.00,
    training: 0.90,
    rest: 0.70,
};

var APPETITE_MULT = { cautious: 1.15, balanced: 1.0, aggressive: 0.85 };

// ── helpers ─────────────────────────────────────────────────────

function _isFiniteNum(n) { return typeof n === 'number' && isFinite(n); }
function _num(n, d) { return _isFiniteNum(n) ? n : (d || 0); }
function _str(s) { return typeof s === 'string' ? s : ''; }
function _bool(b) { return b === true; }
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _normalizeOperator(raw) {
    var role = _str(raw.plannedRoleNext24h).toLowerCase();
    if (!ROLE_RISK[role]) role = 'standard';
    return {
        id: _str(raw.id),
        name: _str(raw.name) || _str(raw.id) || '(unnamed)',
        hoursLast24h: _clamp(_num(raw.hoursLast24h, 0), 0, 24),
        hoursLast7d: Math.max(0, _num(raw.hoursLast7d, 0)),
        consecutiveDaysWorked: Math.max(0, Math.floor(_num(raw.consecutiveDaysWorked, 0))),
        hoursSinceLastBreakMin: Math.max(0, _num(raw.hoursSinceLastBreakMin, 0)),
        errorsLast7d: Math.max(0, Math.floor(_num(raw.errorsLast7d, 0))),
        contaminationIncidentsLast30d: Math.max(0, Math.floor(_num(raw.contaminationIncidentsLast30d, 0))),
        deepFocusTasksLast24h: Math.max(0, Math.floor(_num(raw.deepFocusTasksLast24h, 0))),
        nightShiftsLast7d: Math.max(0, Math.min(7, Math.floor(_num(raw.nightShiftsLast7d, 0)))),
        sickDaysLast30d: Math.max(0, Math.floor(_num(raw.sickDaysLast30d, 0))),
        plannedRoleNext24h: role,
        backupAvailable: _bool(raw.backupAvailable),
        scheduledTimeOffInDays: _isFiniteNum(raw.scheduledTimeOffInDays) ? Math.max(0, raw.scheduledTimeOffInDays) : null,
        weeklyHourCap: _isFiniteNum(raw.weeklyHourCap) && raw.weeklyHourCap > 0 ? raw.weeklyHourCap : null,
    };
}

function _shiftHoursBand(h24) {
    // map last-24h hours-on-shift to 0..100
    if (h24 <= 6) return 0;
    if (h24 <= 8) return 10;
    if (h24 <= 10) return 30;
    if (h24 <= 12) return 55;
    if (h24 <= 14) return 80;
    return 100;
}

function _weeklyHoursBand(h7, cap) {
    var effectiveCap = cap || 60;
    var ratio = h7 / effectiveCap;
    if (ratio <= 0.5) return 0;
    if (ratio <= 0.75) return 20;
    if (ratio <= 1.0) return 50;
    if (ratio <= 1.15) return 75;
    return 100;
}

function _consecutiveDaysBand(d) {
    if (d <= 3) return 0;
    if (d <= 5) return 20;
    if (d <= 7) return 45;
    if (d <= 10) return 70;
    return 95;
}

function _breakBand(min) {
    if (min <= 120) return 0;
    if (min <= 240) return 25;
    if (min <= 360) return 50;
    if (min <= 480) return 75;
    return 95;
}

function _errorBand(e7) {
    if (e7 <= 0) return 0;
    if (e7 === 1) return 25;
    if (e7 === 2) return 50;
    if (e7 === 3) return 70;
    return 90;
}

function _nightBand(n7) {
    if (n7 <= 1) return 0;
    if (n7 === 2) return 20;
    if (n7 === 3) return 45;
    if (n7 >= 4) return 70;
    return 0;
}

// ── scoring ─────────────────────────────────────────────────────

function _scoreItem(op, ctx) {
    var reasons = [];

    var shiftStress = _shiftHoursBand(op.hoursLast24h);
    if (shiftStress >= 55) reasons.push({ code: 'LONG_SHIFT_TODAY', label: op.hoursLast24h.toFixed(1) + 'h on shift in last 24h.', weight: Math.round(shiftStress) });

    var weeklyStress = _weeklyHoursBand(op.hoursLast7d, op.weeklyHourCap);
    if (weeklyStress >= 50) {
        var capLabel = op.weeklyHourCap ? '/' + op.weeklyHourCap + 'h cap' : '';
        reasons.push({ code: 'WEEKLY_HOURS_HIGH', label: Math.round(op.hoursLast7d) + 'h logged in last 7d' + capLabel + '.', weight: Math.round(weeklyStress) });
    }

    var consecutiveStress = _consecutiveDaysBand(op.consecutiveDaysWorked);
    if (consecutiveStress >= 45) reasons.push({ code: 'NO_REST_DAYS', label: op.consecutiveDaysWorked + ' consecutive days worked.', weight: Math.round(consecutiveStress) });

    var breakStress = _breakBand(op.hoursSinceLastBreakMin);
    if (breakStress >= 50) reasons.push({ code: 'BREAK_OVERDUE', label: 'No break for ' + Math.round(op.hoursSinceLastBreakMin) + ' min.', weight: Math.round(breakStress) });

    var errorRate = _errorBand(op.errorsLast7d);
    if (op.contaminationIncidentsLast30d > 0) errorRate = Math.min(100, errorRate + Math.min(30, op.contaminationIncidentsLast30d * 15));
    if (op.errorsLast7d >= 2) reasons.push({ code: 'RECENT_ERROR_SPIKE', label: op.errorsLast7d + ' error(s) in last 7 days.', weight: Math.round(errorRate) });
    if (op.contaminationIncidentsLast30d > 0) reasons.push({ code: 'CONTAMINATION_LINKED', label: op.contaminationIncidentsLast30d + ' contamination incident(s) in last 30 days.', weight: 85 });

    var nightStress = _nightBand(op.nightShiftsLast7d);
    if (nightStress >= 20) reasons.push({ code: 'NIGHT_SHIFT_CLUSTER', label: op.nightShiftsLast7d + ' night shift(s) in last 7d.', weight: Math.round(nightStress) });

    var sickStress = 0;
    if (op.sickDaysLast30d >= 3) { sickStress = 40; reasons.push({ code: 'SICK_DAYS_TREND', label: op.sickDaysLast30d + ' sick day(s) in last 30d.', weight: 60 }); }
    else if (op.sickDaysLast30d >= 1) { sickStress = 15; }

    // weighted blend
    var weighted = (shiftStress * 0.18)
        + (weeklyStress * 0.18)
        + (consecutiveStress * 0.18)
        + (breakStress * 0.10)
        + (errorRate * 0.20)
        + (nightStress * 0.10)
        + (sickStress * 0.06);
    weighted = _clamp(weighted, 0, 100);

    // role + appetite shaping
    weighted = weighted * ROLE_RISK[op.plannedRoleNext24h] * APPETITE_MULT[ctx.riskAppetite];
    weighted = _clamp(weighted, 0, 100);

    // upcoming high-stakes batches lift risk for deep-focus operators (max +6)
    if (ctx.upcomingHighStakesBatches > 0 && op.plannedRoleNext24h === 'deep') {
        weighted = _clamp(weighted + Math.min(6, ctx.upcomingHighStakesBatches * 2), 0, 100);
    }

    // dampeners
    if (op.plannedRoleNext24h === 'rest') weighted *= 0.7;
    if (op.scheduledTimeOffInDays !== null && op.scheduledTimeOffInDays <= 1) weighted *= 0.8;
    if (op.backupAvailable) weighted *= 0.9;

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

    // verdict ladder
    var verdict;
    var hardBurnout = (op.consecutiveDaysWorked >= 10) || (op.hoursLast24h >= 16) || (op.errorsLast7d >= 4 && op.contaminationIncidentsLast30d > 0);
    if (hardBurnout || risk >= 80) verdict = VERDICTS.BURNOUT_RISK_IMMINENT;
    else if (risk >= 65 || (op.hoursLast7d > 0 && op.weeklyHourCap && op.hoursLast7d > op.weeklyHourCap)) verdict = VERDICTS.MANDATORY_REST;
    else if (risk >= 50 && op.plannedRoleNext24h === 'deep') verdict = VERDICTS.REASSIGN_FROM_HIGH_STAKES;
    else if (risk >= 40) verdict = VERDICTS.WATCH_AND_PAIR;
    else if (op.hoursSinceLastBreakMin >= 240) verdict = VERDICTS.OFFER_BREAK;
    else verdict = VERDICTS.READY_FOR_SHIFT;

    var priority;
    switch (verdict) {
        case VERDICTS.BURNOUT_RISK_IMMINENT: priority = 'P0'; break;
        case VERDICTS.MANDATORY_REST: priority = 'P0'; break;
        case VERDICTS.REASSIGN_FROM_HIGH_STAKES: priority = 'P1'; break;
        case VERDICTS.WATCH_AND_PAIR: priority = 'P2'; break;
        case VERDICTS.OFFER_BREAK: priority = 'P2'; break;
        default: priority = 'P3';
    }

    // recommended rest hours next shift
    var recommendedRestHours = 0;
    if (verdict === VERDICTS.BURNOUT_RISK_IMMINENT) recommendedRestHours = 24;
    else if (verdict === VERDICTS.MANDATORY_REST) recommendedRestHours = 12;
    else if (verdict === VERDICTS.REASSIGN_FROM_HIGH_STAKES) recommendedRestHours = 4;
    else if (verdict === VERDICTS.WATCH_AND_PAIR) recommendedRestHours = 2;
    else if (verdict === VERDICTS.OFFER_BREAK) recommendedRestHours = 0.25;

    return {
        id: op.id,
        name: op.name,
        plannedRoleNext24h: op.plannedRoleNext24h,
        fatigueRisk: risk,
        verdict: verdict,
        priority: priority,
        recommendedRestHours: recommendedRestHours,
        backupAvailable: op.backupAvailable,
        scheduledTimeOffInDays: op.scheduledTimeOffInDays,
        components: {
            shiftStress: Math.round(shiftStress),
            weeklyStress: Math.round(weeklyStress),
            consecutiveStress: Math.round(consecutiveStress),
            breakStress: Math.round(breakStress),
            errorRate: Math.round(errorRate),
            nightStress: Math.round(nightStress),
            sickStress: Math.round(sickStress),
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
    var anyBurnout = items.some(function (it) { return it.verdict === VERDICTS.BURNOUT_RISK_IMMINENT; });
    if (anyBurnout || portfolioRisk >= 80) return 'F';
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
    return items.slice().sort(function (a, b) {
        if (b.fatigueRisk !== a.fatigueRisk) return b.fatigueRisk - a.fatigueRisk;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }).map(function (it) { return it.id; });
}

function _buildPlaybook(items, ctx, normalized) {
    var actions = [];

    var burnout = items.filter(function (it) { return it.verdict === VERDICTS.BURNOUT_RISK_IMMINENT; });
    var rest = items.filter(function (it) { return it.verdict === VERDICTS.MANDATORY_REST; });
    var reassign = items.filter(function (it) { return it.verdict === VERDICTS.REASSIGN_FROM_HIGH_STAKES; });
    var watch = items.filter(function (it) { return it.verdict === VERDICTS.WATCH_AND_PAIR; });
    var offerBreak = items.filter(function (it) { return it.verdict === VERDICTS.OFFER_BREAK; });
    var contaminationLinked = items.filter(function (it) {
        var raw = normalized.byId[it.id];
        return raw && raw.contaminationIncidentsLast30d > 0;
    });
    var nightCluster = items.filter(function (it) { return it.components.nightStress >= 45; });

    if (burnout.length) {
        actions.push({
            id: 'SEND_HOME_AND_LOG_INCIDENT',
            priority: 'P0',
            label: 'Send burnout-risk operators home and log a safety incident.',
            reason: burnout.length + ' operator(s) at imminent burnout risk.',
            owner: 'lab_manager',
            blastRadius: 5,
            reversibility: 'low',
            operatorIds: _idsByRiskDesc(burnout),
        });
    }

    if (rest.length) {
        actions.push({
            id: 'MANDATE_REST_PERIOD',
            priority: 'P0',
            label: 'Mandate a rest period before the next shift.',
            reason: rest.length + ' operator(s) over hour caps or at high fatigue.',
            owner: 'lab_manager',
            blastRadius: 3,
            reversibility: 'high',
            operatorIds: _idsByRiskDesc(rest),
        });
    }

    if (reassign.length && ctx.upcomingHighStakesBatches > 0) {
        actions.push({
            id: 'REASSIGN_FROM_HIGH_STAKES_TASKS',
            priority: 'P1',
            label: 'Reassign tired operators away from high-stakes deep-focus tasks.',
            reason: reassign.length + ' deep-focus operator(s) at elevated fatigue; ' + ctx.upcomingHighStakesBatches + ' high-stakes batch(es) ahead.',
            owner: 'shift_lead',
            blastRadius: 3,
            reversibility: 'high',
            operatorIds: _idsByRiskDesc(reassign),
        });
    }

    if (contaminationLinked.length) {
        actions.push({
            id: 'INVESTIGATE_OPERATOR_PROCESS',
            priority: 'P1',
            label: 'Investigate process compliance for operators linked to contamination incidents.',
            reason: contaminationLinked.length + ' operator(s) tied to recent contamination incidents.',
            owner: 'quality',
            blastRadius: 3,
            reversibility: 'high',
            operatorIds: _idsByRiskDesc(contaminationLinked),
        });
    }

    if (watch.length) {
        actions.push({
            id: 'PAIR_WITH_BUDDY',
            priority: 'P2',
            label: 'Pair watch-level operators with a buddy for the next shift.',
            reason: watch.length + ' operator(s) at elevated fatigue but cleared for work.',
            owner: 'shift_lead',
            blastRadius: 2,
            reversibility: 'high',
            operatorIds: _idsByRiskDesc(watch),
        });
    }

    if (offerBreak.length) {
        actions.push({
            id: 'OFFER_BREAK_NOW',
            priority: 'P2',
            label: 'Offer an immediate break to operators overdue for one.',
            reason: offerBreak.length + ' operator(s) overdue for a break.',
            owner: 'shift_lead',
            blastRadius: 1,
            reversibility: 'high',
            operatorIds: _idsByRiskDesc(offerBreak),
        });
    }

    if (nightCluster.length >= 2) {
        actions.push({
            id: 'REBALANCE_NIGHT_ROTATION',
            priority: 'P2',
            label: 'Rebalance the night-shift rotation across the roster.',
            reason: nightCluster.length + ' operator(s) carrying >=3 night shifts in last 7d.',
            owner: 'lab_manager',
            blastRadius: 3,
            reversibility: 'high',
            operatorIds: _idsByRiskDesc(nightCluster),
        });
    }

    // staffing thin warning when blocking many operators
    var blockedCount = burnout.length + rest.length;
    if (blockedCount > 0 && _isFiniteNum(ctx.activeStaffingCount) && ctx.activeStaffingCount > 0
        && (blockedCount / ctx.activeStaffingCount) >= 0.30) {
        actions.push({
            id: 'CALL_IN_RELIEF_STAFF',
            priority: 'P1',
            label: 'Call in relief staff - significant share of roster benched.',
            reason: blockedCount + ' of ' + ctx.activeStaffingCount + ' operators must rest.',
            owner: 'lab_manager',
            blastRadius: 4,
            reversibility: 'high',
            operatorIds: [],
        });
    }

    // cautious appends fleet audit when grade C/D/F-ish
    if (ctx.riskAppetite === 'cautious' && actions.some(function (a) { return a.priority === 'P0' || a.priority === 'P1'; })) {
        actions.push({
            id: 'SCHEDULE_FATIGUE_AUDIT',
            priority: 'P2',
            label: 'Schedule a fatigue / scheduling audit for the next month.',
            reason: 'Cautious risk appetite + active high-priority findings.',
            owner: 'lab_manager',
            blastRadius: 2,
            reversibility: 'high',
            operatorIds: [],
        });
    }

    // aggressive trims standalone P2 when P0/P1 exist
    if (ctx.riskAppetite === 'aggressive') {
        var hasHigh = actions.some(function (a) { return a.priority === 'P0' || a.priority === 'P1'; });
        if (hasHigh) {
            actions = actions.filter(function (a) {
                return a.priority !== 'P2' || a.id === 'OFFER_BREAK_NOW' || a.id === 'PAIR_WITH_BUDDY';
            });
        }
    }

    if (actions.length === 0) {
        actions.push({
            id: 'ROSTER_HEALTHY',
            priority: 'P3',
            label: 'Roster healthy - no fatigue intervention required.',
            reason: 'No operators above watch threshold.',
            owner: 'lab_manager',
            blastRadius: 1,
            reversibility: 'high',
            operatorIds: [],
        });
    }

    // P0-first, then code asc, dedup by id
    var seenIds = {};
    actions = actions.filter(function (a) {
        if (seenIds[a.id]) return false;
        seenIds[a.id] = true;
        return true;
    });
    actions.sort(function (a, b) {
        if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return actions;
}

// ── insights ────────────────────────────────────────────────────

function _buildInsights(items, normalized, portfolioRisk) {
    var out = [];
    if (items.some(function (it) { return it.verdict === VERDICTS.BURNOUT_RISK_IMMINENT; })) out.push('BURNOUT_CLUSTER_DETECTED');
    var nightHeavy = items.filter(function (it) { return it.components.nightStress >= 45; });
    if (nightHeavy.length >= 2) out.push('NIGHT_SHIFT_OVERLOAD');
    var contam = items.filter(function (it) {
        var raw = normalized.byId[it.id];
        return raw && raw.contaminationIncidentsLast30d > 0;
    });
    if (contam.length >= 1) out.push('CONTAMINATION_FATIGUE_LINK');
    if (items.length > 0 && items.every(function (it) { return it.verdict === VERDICTS.READY_FOR_SHIFT; })) out.push('HEALTHY_ROSTER');
    var caps = items.filter(function (it) {
        var raw = normalized.byId[it.id];
        return raw && raw.weeklyHourCap && raw.hoursLast7d > raw.weeklyHourCap;
    });
    if (caps.length >= 1) out.push('WEEKLY_HOUR_CAP_BREACHED');
    var noBreak = items.filter(function (it) { return it.components.breakStress >= 75; });
    if (noBreak.length >= 2) out.push('BREAK_DISCIPLINE_GAP');
    if (portfolioRisk >= 65) out.push('PORTFOLIO_FATIGUE_HIGH');
    if (items.length === 0) out.push('NO_OPERATORS_PROVIDED');
    if (out.length === 0) out.push('STEADY_BASELINE');
    return out.sort();
}

// ── public API ──────────────────────────────────────────────────

function createOperatorFatigueAdvisor(opts) {
    opts = opts || {};
    var defaultRiskAppetite = opts.riskAppetite ? String(opts.riskAppetite).toLowerCase() : 'balanced';
    if (!RISK_APPETITES[defaultRiskAppetite]) {
        throw new Error('createOperatorFatigueAdvisor: invalid riskAppetite "' + opts.riskAppetite + '"');
    }
    var nowFn = typeof opts.now === 'function' ? opts.now : function () { return new Date(); };

    function evaluate(input) {
        input = input || {};
        var riskAppetite = input.riskAppetite ? String(input.riskAppetite).toLowerCase() : defaultRiskAppetite;
        if (!RISK_APPETITES[riskAppetite]) {
            throw new Error('evaluate: invalid riskAppetite "' + input.riskAppetite + '"');
        }
        var rawOps = Array.isArray(input.operators) ? input.operators : [];
        var context = input.context || {};
        var ctx = {
            riskAppetite: riskAppetite,
            upcomingHighStakesBatches: Math.max(0, Math.floor(_num(context.upcomingHighStakesBatches, 0))),
            activeStaffingCount: _isFiniteNum(context.activeStaffingCount) ? Math.max(0, Math.floor(context.activeStaffingCount)) : null,
            now: nowFn(),
        };

        var normalized = { byId: {} };
        var byId = {};
        var items = rawOps.map(function (raw) {
            var n = _normalizeOperator(raw || {});
            normalized.byId[n.id] = n;
            byId[n.id] = true;
            var scored = _scoreItem(n, ctx);
            return scored;
        });

        // stable sort: priority asc then fatigueRisk desc then id asc
        items.sort(function (a, b) {
            if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
            if (b.fatigueRisk !== a.fatigueRisk) return b.fatigueRisk - a.fatigueRisk;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });

        var portfolioRisk = items.length === 0 ? 0 : Math.round(items.reduce(function (s, it) { return s + it.fatigueRisk; }, 0) / items.length);
        var band = _portfolioBand(portfolioRisk, riskAppetite);
        var grade = _portfolioGrade(items, portfolioRisk);
        var playbook = _buildPlaybook(items, ctx, normalized);
        var insights = _buildInsights(items, normalized, portfolioRisk);

        return {
            generatedAt: ctx.now.toISOString(),
            riskAppetite: riskAppetite,
            operatorCount: items.length,
            portfolioRisk: portfolioRisk,
            portfolioBand: band,
            grade: grade,
            operators: items,
            playbook: playbook,
            insights: insights,
            context: {
                upcomingHighStakesBatches: ctx.upcomingHighStakesBatches,
                activeStaffingCount: ctx.activeStaffingCount,
            },
        };
    }

    function simulate(input, report) {
        // Apply top-N P0/P1 actions; rough delta on portfolio risk.
        if (!report || !Array.isArray(report.operators)) throw new Error('simulate: report is required');
        input = input || {};
        var topN = _isFiniteNum(input.applyTop) ? Math.max(0, Math.floor(input.applyTop)) : report.playbook.length;
        var ACTION_DELTA = {
            SEND_HOME_AND_LOG_INCIDENT: -40,
            MANDATE_REST_PERIOD: -25,
            REASSIGN_FROM_HIGH_STAKES_TASKS: -15,
            INVESTIGATE_OPERATOR_PROCESS: -8,
            CALL_IN_RELIEF_STAFF: -10,
            PAIR_WITH_BUDDY: -6,
            OFFER_BREAK_NOW: -4,
            REBALANCE_NIGHT_ROTATION: -5,
            SCHEDULE_FATIGUE_AUDIT: -2,
            ROSTER_HEALTHY: 0,
        };
        var applied = [];
        var deltaSum = 0;
        var picked = report.playbook.slice(0, topN);
        picked.forEach(function (a, i) {
            var raw = ACTION_DELTA[a.id] || 0;
            var applied_i = Math.round(raw * Math.pow(0.85, i));
            deltaSum += applied_i;
            applied.push({ id: a.id, priority: a.priority, rawDelta: raw, appliedDelta: applied_i });
        });
        var projected = Math.max(5, Math.min(100, report.portfolioRisk + deltaSum));
        return {
            originalRisk: report.portfolioRisk,
            projectedRisk: projected,
            projectedBand: _portfolioBand(projected, report.riskAppetite),
            projectedGrade: _portfolioGrade(report.operators, projected),
            appliedActions: applied,
        };
    }

    // ── renderers ───────────────────────────────────────────────

    function formatText(report) {
        var lines = [];
        lines.push('OPERATOR FATIGUE REPORT');
        lines.push('Generated: ' + report.generatedAt + '  appetite=' + report.riskAppetite);
        lines.push('Operators: ' + report.operatorCount + '  risk=' + report.portfolioRisk + '  band=' + report.portfolioBand + '  grade=' + report.grade);
        lines.push('');
        if (report.operators.length) {
            lines.push('Top operators:');
            report.operators.slice(0, 10).forEach(function (it) {
                lines.push('  [' + it.priority + '] ' + it.name + ' (' + it.id + ') risk=' + it.fatigueRisk + ' verdict=' + it.verdict + ' role=' + it.plannedRoleNext24h + ' restH=' + it.recommendedRestHours);
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

    function _mdEscape(s) {
        return String(s).replace(/\|/g, '\\|');
    }

    function formatMarkdown(report) {
        var out = [];
        out.push('# Operator Fatigue Report');
        out.push('');
        out.push('- Generated: ' + report.generatedAt);
        out.push('- Risk appetite: ' + report.riskAppetite);
        out.push('- Operators: ' + report.operatorCount);
        out.push('- Portfolio risk: ' + report.portfolioRisk + ' (' + report.portfolioBand + ')');
        out.push('- Grade: ' + report.grade);
        out.push('');
        out.push('## Operators');
        out.push('');
        out.push('| Priority | ID | Name | Role | Risk | Verdict | Rest (h) |');
        out.push('|---|---|---|---|---:|---|---:|');
        report.operators.forEach(function (it) {
            out.push('| ' + it.priority + ' | ' + _mdEscape(it.id) + ' | ' + _mdEscape(it.name) + ' | ' + it.plannedRoleNext24h + ' | ' + it.fatigueRisk + ' | ' + it.verdict + ' | ' + it.recommendedRestHours + ' |');
        });
        if (report.operators.length === 0) out.push('| - | - | - | - | - | - | - |');
        out.push('');
        out.push('## Playbook');
        out.push('');
        out.push('| Priority | Action | Owner | Blast | Reversibility | Operators |');
        out.push('|---|---|---|---:|---|---|');
        report.playbook.forEach(function (a) {
            out.push('| ' + a.priority + ' | ' + _mdEscape(a.id) + ': ' + _mdEscape(a.label) + ' | ' + a.owner + ' | ' + a.blastRadius + ' | ' + a.reversibility + ' | ' + (a.operatorIds || []).join(', ') + ' |');
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

    function formatJson(report) {
        return _stableStringify(report, 2);
    }

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
    createOperatorFatigueAdvisor: createOperatorFatigueAdvisor,
    VERDICTS: VERDICTS,
};

// Browser/UMD attach
if (typeof window !== 'undefined') {
    window.OperatorFatigueAdvisor = { createOperatorFatigueAdvisor: createOperatorFatigueAdvisor, VERDICTS: VERDICTS };
}
