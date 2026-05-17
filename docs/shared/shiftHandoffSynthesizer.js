'use strict';

/**
 * Shift Handoff Synthesizer — Agentic shift-to-shift briefing generator.
 *
 * Crosses signals from any combination of overnight subsystems (alerts,
 * print runs, anomaly events, environmental excursions, pending tasks,
 * open blockers) and synthesizes a unified briefing for the incoming
 * shift: ranked carryovers, per-item verdict, owner suggestion,
 * cross-signal "hot zone" insights, P0–P3 playbook, and an A–F handoff
 * health grade.
 *
 * Designed to be input-agnostic — accepts plain records the way
 * `alertRoutingAdvisor` does on the WinSentinel side. Drop-in friendly
 * with any of the existing BioBots modules:
 *   - print runs (printSessionLogger / jobEstimator)
 *   - environmental excursions (environmentalMonitor)
 *   - contamination alerts (contaminationEarlyWarning / contaminationRisk)
 *   - anomalies (anomalyCorrelator / driftDetector)
 *   - pending tasks (workflowOrchestrator / equipmentScheduler)
 *   - blockers (failureAutopsy / incidentReplay)
 *
 * Pure JS, deterministic given an injected now(), zero deps, never
 * mutates inputs.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var sh = biobots.createShiftHandoffSynthesizer({
 *       now: function () { return new Date('2026-05-17T07:00:00Z'); }
 *   });
 *   var briefing = sh.synthesize({
 *       shiftLabel: 'Day shift 2026-05-17',
 *       alerts: [...], runs: [...], anomalies: [...],
 *       environmental: [...], pendingTasks: [...], blockers: [...]
 *   });
 *   console.log(sh.formatMarkdown(briefing));
 */

var SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
var RISK_APPETITES = { cautious: 'cautious', balanced: 'balanced', aggressive: 'aggressive' };

function _isFiniteNum(n) {
    return typeof n === 'number' && isFinite(n);
}

function _coerceDate(d, fallback) {
    if (!d) return fallback;
    var t;
    if (d instanceof Date) t = d.getTime();
    else if (typeof d === 'string' || typeof d === 'number') t = new Date(d).getTime();
    else return fallback;
    return isFinite(t) ? new Date(t) : fallback;
}

function _hoursBetween(later, earlier) {
    return (later.getTime() - earlier.getTime()) / 3600000;
}

function _sevWeight(sev) {
    sev = (sev || 'info').toLowerCase();
    if (sev === 'critical') return 100;
    if (sev === 'high') return 70;
    if (sev === 'medium') return 40;
    if (sev === 'low') return 20;
    return 5;
}

function _priorityFromScore(s) {
    if (s >= 75) return 'P0';
    if (s >= 50) return 'P1';
    if (s >= 25) return 'P2';
    return 'P3';
}

function _ownerForKind(kind) {
    switch (kind) {
        case 'alert': return 'shift_lead';
        case 'run': return 'print_operator';
        case 'anomaly': return 'qa_analyst';
        case 'environmental': return 'facilities';
        case 'pendingTask': return 'shift_lead';
        case 'blocker': return 'lab_manager';
        default: return 'shift_lead';
    }
}

function _appetiteShift(appetite) {
    if (appetite === RISK_APPETITES.cautious) return 8;
    if (appetite === RISK_APPETITES.aggressive) return -8;
    return 0;
}

function _gradeFromScore(score, hardF) {
    if (hardF) return 'F';
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

function _normalizeAlert(a, now) {
    return {
        kind: 'alert',
        id: String(a.id != null ? a.id : ('alert-' + a.code || Math.random().toString(36).slice(2, 9))),
        title: a.title || a.code || 'Untitled alert',
        code: a.code || null,
        severity: (a.severity || 'medium').toLowerCase(),
        acknowledged: !!a.acknowledged,
        resolved: !!a.resolved,
        source: a.source || null,
        observedAt: _coerceDate(a.observedAt || a.firedAt || a.at, now),
        meta: a.meta || null,
    };
}

function _normalizeRun(r, now) {
    return {
        kind: 'run',
        id: String(r.id != null ? r.id : ('run-' + (r.jobName || Math.random().toString(36).slice(2, 9)))),
        title: r.jobName || r.title || ('Run ' + r.id),
        status: (r.status || 'unknown').toLowerCase(),         // succeeded / failed / aborted / running / queued
        printer: r.printer || null,
        operator: r.operator || null,
        startedAt: _coerceDate(r.startedAt, null),
        finishedAt: _coerceDate(r.finishedAt, null),
        durationMin: _isFiniteNum(r.durationMin) ? r.durationMin : null,
        failureReason: r.failureReason || null,
        observedAt: _coerceDate(r.finishedAt || r.startedAt, now),
    };
}

function _normalizeAnomaly(a, now) {
    return {
        kind: 'anomaly',
        id: String(a.id != null ? a.id : ('anom-' + Math.random().toString(36).slice(2, 9))),
        title: a.title || a.metric || 'Anomaly',
        metric: a.metric || null,
        severity: (a.severity || 'medium').toLowerCase(),
        observedAt: _coerceDate(a.observedAt, now),
        delta: a.delta || null,
        zone: a.zone || null,
    };
}

function _normalizeEnvironmental(e, now) {
    return {
        kind: 'environmental',
        id: String(e.id != null ? e.id : ('env-' + Math.random().toString(36).slice(2, 9))),
        title: e.title || (e.sensor ? (e.sensor + ' excursion') : 'Environmental excursion'),
        sensor: e.sensor || null,
        zone: e.zone || null,
        severity: (e.severity || 'medium').toLowerCase(),
        durationMin: _isFiniteNum(e.durationMin) ? e.durationMin : null,
        observedAt: _coerceDate(e.observedAt || e.startedAt, now),
        threshold: e.threshold || null,
        observedValue: _isFiniteNum(e.observedValue) ? e.observedValue : null,
    };
}

function _normalizePendingTask(t, now) {
    return {
        kind: 'pendingTask',
        id: String(t.id != null ? t.id : ('task-' + Math.random().toString(36).slice(2, 9))),
        title: t.title || 'Pending task',
        priority: (t.priority || 'medium').toLowerCase(),       // critical/high/medium/low
        owner: t.owner || null,
        dueAt: _coerceDate(t.dueAt, null),
        observedAt: _coerceDate(t.createdAt || t.queuedAt, now),
        blocking: !!t.blocking,
    };
}

function _normalizeBlocker(b, now) {
    return {
        kind: 'blocker',
        id: String(b.id != null ? b.id : ('block-' + Math.random().toString(36).slice(2, 9))),
        title: b.title || 'Open blocker',
        severity: (b.severity || 'high').toLowerCase(),
        owner: b.owner || null,
        ageHours: _isFiniteNum(b.ageHours) ? b.ageHours :
            (b.openedAt ? Math.max(0, _hoursBetween(now, _coerceDate(b.openedAt, now))) : null),
        observedAt: _coerceDate(b.openedAt, now),
        impacts: Array.isArray(b.impacts) ? b.impacts.slice() : [],
    };
}

// ── per-kind scoring ─────────────────────────────────────────────

function _scoreAlert(a, ctx) {
    if (a.resolved) return { score: 0, reasons: ['RESOLVED'], verdict: 'CLOSED' };
    var s = _sevWeight(a.severity);
    var reasons = ['SEV_' + a.severity.toUpperCase()];
    if (!a.acknowledged) { s += 8; reasons.push('UNACKED'); }
    var ageH = Math.max(0, _hoursBetween(ctx.now, a.observedAt));
    if (ageH >= 6) { s += 6; reasons.push('AGED_6H'); }
    if (ageH >= 12) { s += 6; reasons.push('AGED_12H'); }
    s += _appetiteShift(ctx.riskAppetite);
    var verdict = s >= 75 ? 'ESCALATE' : (s >= 50 ? 'ACTION_TODAY' : (s >= 25 ? 'MONITOR' : 'WATCH_ONLY'));
    return { score: Math.max(0, Math.min(100, Math.round(s))), reasons: reasons, verdict: verdict };
}

function _scoreRun(r, ctx) {
    var reasons = [];
    var s = 0;
    var status = r.status;
    if (status === 'succeeded') { s = 5; reasons.push('SUCCEEDED'); }
    else if (status === 'failed') { s = 75; reasons.push('FAILED'); }
    else if (status === 'aborted') { s = 65; reasons.push('ABORTED'); }
    else if (status === 'running') { s = 35; reasons.push('STILL_RUNNING'); }
    else if (status === 'queued') { s = 20; reasons.push('QUEUED'); }
    else { s = 15; reasons.push('UNKNOWN_STATUS'); }

    if (r.failureReason && /contamin/i.test(r.failureReason)) { s += 12; reasons.push('CONTAMINATION_HINT'); }
    if (r.failureReason && /nozzle|clog|jam/i.test(r.failureReason)) { s += 6; reasons.push('NOZZLE_HINT'); }
    if (r.durationMin && r.durationMin > 360) { s += 4; reasons.push('LONG_RUN'); }

    s += _appetiteShift(ctx.riskAppetite);
    var verdict = (status === 'failed' || status === 'aborted')
        ? (s >= 75 ? 'INVESTIGATE_TODAY' : 'TRIAGE')
        : (status === 'running' ? 'CHECK_PROGRESS' : (status === 'queued' ? 'CONFIRM_QUEUE' : 'CLOSE_OUT'));
    return { score: Math.max(0, Math.min(100, Math.round(s))), reasons: reasons, verdict: verdict };
}

function _scoreAnomaly(a, ctx) {
    var s = _sevWeight(a.severity);
    var reasons = ['SEV_' + a.severity.toUpperCase()];
    if (a.metric) reasons.push('METRIC_' + String(a.metric).toUpperCase());
    s += _appetiteShift(ctx.riskAppetite);
    var verdict = s >= 75 ? 'INVESTIGATE' : (s >= 50 ? 'CORRELATE' : 'LOG_AND_WATCH');
    return { score: Math.max(0, Math.min(100, Math.round(s))), reasons: reasons, verdict: verdict };
}

function _scoreEnvironmental(e, ctx) {
    var s = _sevWeight(e.severity);
    var reasons = ['SEV_' + e.severity.toUpperCase()];
    if (e.durationMin && e.durationMin >= 30) { s += 8; reasons.push('SUSTAINED_30M'); }
    if (e.durationMin && e.durationMin >= 120) { s += 8; reasons.push('SUSTAINED_2H'); }
    if (e.zone && /clean|cabinet|biosafety/i.test(e.zone)) { s += 8; reasons.push('CLEAN_ZONE_AFFECTED'); }
    s += _appetiteShift(ctx.riskAppetite);
    var verdict = s >= 75 ? 'QUARANTINE_ZONE' : (s >= 50 ? 'REVALIDATE' : 'MONITOR_TREND');
    return { score: Math.max(0, Math.min(100, Math.round(s))), reasons: reasons, verdict: verdict };
}

function _scorePendingTask(t, ctx) {
    var pri = (t.priority || 'medium');
    var s = pri === 'critical' ? 70 : pri === 'high' ? 50 : pri === 'medium' ? 30 : 15;
    var reasons = ['PRIORITY_' + pri.toUpperCase()];
    if (t.blocking) { s += 12; reasons.push('BLOCKING'); }
    if (t.dueAt) {
        var dueIn = _hoursBetween(t.dueAt, ctx.now);
        if (dueIn < 0) { s += 18; reasons.push('OVERDUE'); }
        else if (dueIn <= 4) { s += 10; reasons.push('DUE_4H'); }
        else if (dueIn <= 12) { s += 5; reasons.push('DUE_12H'); }
    }
    s += _appetiteShift(ctx.riskAppetite);
    var verdict = s >= 75 ? 'START_FIRST_THING' : (s >= 50 ? 'SCHEDULE_TODAY' : (s >= 25 ? 'PARK_FOR_NOW' : 'BACKLOG'));
    return { score: Math.max(0, Math.min(100, Math.round(s))), reasons: reasons, verdict: verdict };
}

function _scoreBlocker(b, ctx) {
    var s = _sevWeight(b.severity);
    var reasons = ['SEV_' + b.severity.toUpperCase()];
    if (b.ageHours != null) {
        if (b.ageHours >= 24) { s += 10; reasons.push('AGED_24H'); }
        if (b.ageHours >= 72) { s += 10; reasons.push('AGED_72H'); }
    }
    if (b.impacts && b.impacts.length >= 2) { s += 8; reasons.push('MULTI_IMPACT'); }
    s += _appetiteShift(ctx.riskAppetite);
    var verdict = s >= 75 ? 'UNBLOCK_NOW' : (s >= 50 ? 'OWNER_FOLLOWUP' : 'TRACK');
    return { score: Math.max(0, Math.min(100, Math.round(s))), reasons: reasons, verdict: verdict };
}

function _carryoverFor(item, scored) {
    return {
        id: item.id,
        kind: item.kind,
        title: item.title,
        verdict: scored.verdict,
        priority: _priorityFromScore(scored.score),
        score: scored.score,
        reasons: scored.reasons.slice(),
        owner: _ownerForKind(item.kind),
        observedAt: item.observedAt ? item.observedAt.toISOString() : null,
        meta: _carryoverMeta(item),
    };
}

function _carryoverMeta(item) {
    if (item.kind === 'run') return { status: item.status, printer: item.printer, failureReason: item.failureReason };
    if (item.kind === 'environmental') return { sensor: item.sensor, zone: item.zone, durationMin: item.durationMin };
    if (item.kind === 'anomaly') return { metric: item.metric, zone: item.zone };
    if (item.kind === 'pendingTask') return { dueAt: item.dueAt ? item.dueAt.toISOString() : null, blocking: item.blocking, priority: item.priority };
    if (item.kind === 'blocker') return { ageHours: item.ageHours, impacts: item.impacts };
    if (item.kind === 'alert') return { source: item.source, acknowledged: item.acknowledged };
    return null;
}

// ── cross-signal insights ────────────────────────────────────────

function _zoneTally(carryovers) {
    var map = {};
    carryovers.forEach(function (c) {
        var z = (c.meta && c.meta.zone) || null;
        if (!z) return;
        map[z] = (map[z] || 0) + 1;
    });
    return map;
}

function _buildInsights(carryovers, raw, ctx) {
    var insights = [];
    var p0 = carryovers.filter(function (c) { return c.priority === 'P0'; });
    if (p0.length >= 3) {
        insights.push({
            code: 'P0_CLUSTER',
            severity: 'P0',
            text: 'Inbound shift has ' + p0.length + ' P0 carryovers — protect the first 90 minutes for them.',
        });
    }
    var failedRuns = raw.runs.filter(function (r) { return r.status === 'failed' || r.status === 'aborted'; });
    if (failedRuns.length >= 2) {
        insights.push({
            code: 'PRINT_FAILURE_RATE',
            severity: 'P1',
            text: failedRuns.length + ' print runs ended badly overnight — pull a Pareto from failureAutopsy before the next start.',
        });
    }
    var contamHints = raw.runs.filter(function (r) { return r.failureReason && /contamin/i.test(r.failureReason); });
    if (contamHints.length > 0) {
        insights.push({
            code: 'CONTAMINATION_THREAD',
            severity: 'P0',
            text: 'Contamination implicated in ' + contamHints.length + ' run(s) — run contaminationEarlyWarning before the next inoculation.',
        });
    }
    var zoneCounts = _zoneTally(carryovers);
    Object.keys(zoneCounts).forEach(function (z) {
        if (zoneCounts[z] >= 3) {
            insights.push({
                code: 'HOT_ZONE',
                severity: 'P1',
                text: 'Zone "' + z + '" has ' + zoneCounts[z] + ' carryovers — likely a single root cause; investigate cluster.',
            });
        }
    });
    var unackedAlerts = raw.alerts.filter(function (a) { return !a.acknowledged && !a.resolved; });
    if (unackedAlerts.length >= 5) {
        insights.push({
            code: 'ALERT_FATIGUE',
            severity: 'P2',
            text: unackedAlerts.length + ' alerts left unacknowledged — review alertRoutingAdvisor batching thresholds.',
        });
    }
    var overdueTasks = raw.pendingTasks.filter(function (t) {
        return t.dueAt && _hoursBetween(t.dueAt, ctx.now) < 0;
    });
    if (overdueTasks.length > 0) {
        insights.push({
            code: 'OVERDUE_TASKS',
            severity: 'P1',
            text: overdueTasks.length + ' pending task(s) are overdue at handoff time.',
        });
    }
    var oldBlockers = raw.blockers.filter(function (b) { return (b.ageHours || 0) >= 72; });
    if (oldBlockers.length > 0) {
        insights.push({
            code: 'STALE_BLOCKERS',
            severity: 'P1',
            text: oldBlockers.length + ' blocker(s) open >=72h — escalate to lab manager.',
        });
    }
    var quietShift = (raw.alerts.length === 0 && raw.runs.length === 0 && raw.anomalies.length === 0
        && raw.environmental.length === 0 && raw.pendingTasks.length === 0 && raw.blockers.length === 0);
    if (quietShift) {
        insights.push({ code: 'QUIET_SHIFT', severity: 'P3', text: 'No signals from prior shift — confirm telemetry pipelines are alive.' });
    }
    return insights;
}

// ── playbook ─────────────────────────────────────────────────────

function _buildPlaybook(carryovers, insights, raw, ctx) {
    var actions = [];

    insights.forEach(function (i) {
        if (i.code === 'CONTAMINATION_THREAD') {
            actions.push({
                code: 'RUN_CONTAMINATION_EARLY_WARNING',
                priority: 'P0',
                owner: 'qa_analyst',
                blastRadius: 2,
                reversibility: 'high',
                reason: 'Contamination signature seen in overnight failures.',
            });
        }
        if (i.code === 'P0_CLUSTER') {
            actions.push({
                code: 'BLOCK_90_MIN_FOR_P0',
                priority: 'P0',
                owner: 'shift_lead',
                blastRadius: 1,
                reversibility: 'high',
                reason: 'Shift opens with a P0 cluster - protect focus time.',
            });
        }
        if (i.code === 'HOT_ZONE') {
            actions.push({
                code: 'INVESTIGATE_HOT_ZONE',
                priority: 'P1',
                owner: 'facilities',
                blastRadius: 2,
                reversibility: 'high',
                reason: 'Single zone has 3+ carryovers - probable common cause.',
            });
        }
        if (i.code === 'ALERT_FATIGUE') {
            actions.push({
                code: 'REVIEW_ALERT_BATCHING',
                priority: 'P2',
                owner: 'platform',
                blastRadius: 1,
                reversibility: 'high',
                reason: 'Many alerts left unacked overnight.',
            });
        }
        if (i.code === 'STALE_BLOCKERS') {
            actions.push({
                code: 'ESCALATE_STALE_BLOCKERS',
                priority: 'P1',
                owner: 'lab_manager',
                blastRadius: 2,
                reversibility: 'high',
                reason: 'Blockers > 72h need management attention.',
            });
        }
    });

    var p0Runs = carryovers.filter(function (c) { return c.kind === 'run' && c.priority === 'P0'; });
    if (p0Runs.length > 0) {
        actions.push({
            code: 'PRINT_FAILURE_RCA',
            priority: 'P0',
            owner: 'print_operator',
            blastRadius: 2,
            reversibility: 'high',
            reason: p0Runs.length + ' overnight run(s) need RCA before next start.',
        });
    }
    var p0Env = carryovers.filter(function (c) { return c.kind === 'environmental' && c.priority === 'P0'; });
    if (p0Env.length > 0) {
        actions.push({
            code: 'QUARANTINE_AFFECTED_ZONES',
            priority: 'P0',
            owner: 'facilities',
            blastRadius: 3,
            reversibility: 'medium',
            reason: 'Sustained or clean-zone environmental excursion(s) overnight.',
        });
    }
    var overdueP0 = carryovers.filter(function (c) {
        return c.kind === 'pendingTask' && c.priority === 'P0' && c.reasons.indexOf('OVERDUE') >= 0;
    });
    if (overdueP0.length > 0) {
        actions.push({
            code: 'OVERDUE_TASK_RECOVERY',
            priority: 'P0',
            owner: 'shift_lead',
            blastRadius: 1,
            reversibility: 'high',
            reason: overdueP0.length + ' P0 task(s) overdue at handoff.',
        });
    }

    if (ctx.riskAppetite === RISK_APPETITES.cautious) {
        actions.push({
            code: 'OPEN_HANDOFF_HUDDLE',
            priority: 'P1',
            owner: 'shift_lead',
            blastRadius: 1,
            reversibility: 'high',
            reason: 'Cautious appetite: 10-minute walk-through of carryovers before lab activity starts.',
        });
    }
    if (ctx.riskAppetite === RISK_APPETITES.aggressive) {
        actions = actions.filter(function (a) { return a.priority !== 'P3'; });
    }

    // dedup by code keeping highest priority (lowest rank).
    var byCode = {};
    actions.forEach(function (a) {
        var cur = byCode[a.code];
        if (!cur || PRIORITY_RANK[a.priority] < PRIORITY_RANK[cur.priority]) {
            byCode[a.code] = a;
        }
    });

    return Object.keys(byCode).map(function (k) { return byCode[k]; })
        .sort(function (x, y) {
            var p = PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority];
            if (p !== 0) return p;
            return x.code < y.code ? -1 : x.code > y.code ? 1 : 0;
        });
}

// ── public factory ───────────────────────────────────────────────

function createShiftHandoffSynthesizer(opts) {
    opts = opts || {};
    var nowFn = (typeof opts.now === 'function') ? opts.now : function () { return new Date(); };
    var defaultAppetite = opts.riskAppetite || RISK_APPETITES.balanced;
    if (!RISK_APPETITES[defaultAppetite]) {
        throw new Error('riskAppetite must be one of: cautious, balanced, aggressive');
    }

    function synthesize(input) {
        input = input || {};
        var ctx = {
            now: nowFn() instanceof Date ? nowFn() : new Date(nowFn()),
            riskAppetite: input.riskAppetite || defaultAppetite,
        };
        if (!RISK_APPETITES[ctx.riskAppetite]) ctx.riskAppetite = defaultAppetite;

        var raw = {
            alerts: (input.alerts || []).map(function (a) { return _normalizeAlert(a, ctx.now); }),
            runs: (input.runs || []).map(function (r) { return _normalizeRun(r, ctx.now); }),
            anomalies: (input.anomalies || []).map(function (a) { return _normalizeAnomaly(a, ctx.now); }),
            environmental: (input.environmental || []).map(function (e) { return _normalizeEnvironmental(e, ctx.now); }),
            pendingTasks: (input.pendingTasks || []).map(function (t) { return _normalizePendingTask(t, ctx.now); }),
            blockers: (input.blockers || []).map(function (b) { return _normalizeBlocker(b, ctx.now); }),
        };

        var carryovers = [];

        raw.alerts.forEach(function (a) {
            var s = _scoreAlert(a, ctx);
            if (s.verdict === 'CLOSED') return;
            carryovers.push(_carryoverFor(a, s));
        });
        raw.runs.forEach(function (r) {
            var s = _scoreRun(r, ctx);
            if (r.status === 'succeeded' && s.score < 25) return; // don't carry quiet successes
            carryovers.push(_carryoverFor(r, s));
        });
        raw.anomalies.forEach(function (a) { carryovers.push(_carryoverFor(a, _scoreAnomaly(a, ctx))); });
        raw.environmental.forEach(function (e) { carryovers.push(_carryoverFor(e, _scoreEnvironmental(e, ctx))); });
        raw.pendingTasks.forEach(function (t) { carryovers.push(_carryoverFor(t, _scorePendingTask(t, ctx))); });
        raw.blockers.forEach(function (b) { carryovers.push(_carryoverFor(b, _scoreBlocker(b, ctx))); });

        carryovers.sort(function (x, y) {
            var p = PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority];
            if (p !== 0) return p;
            if (y.score !== x.score) return y.score - x.score;
            return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
        });

        var insights = _buildInsights(carryovers, raw, ctx);
        var playbook = _buildPlaybook(carryovers, insights, raw, ctx);

        var counts = {
            P0: carryovers.filter(function (c) { return c.priority === 'P0'; }).length,
            P1: carryovers.filter(function (c) { return c.priority === 'P1'; }).length,
            P2: carryovers.filter(function (c) { return c.priority === 'P2'; }).length,
            P3: carryovers.filter(function (c) { return c.priority === 'P3'; }).length,
        };

        // Handoff health score: starts at 100, deduct for severity.
        var healthScore = 100
            - counts.P0 * 15
            - counts.P1 * 6
            - counts.P2 * 2;
        if (insights.some(function (i) { return i.code === 'CONTAMINATION_THREAD'; })) healthScore -= 15;
        if (insights.some(function (i) { return i.code === 'STALE_BLOCKERS'; })) healthScore -= 8;
        if (ctx.riskAppetite === RISK_APPETITES.cautious) healthScore -= 4;
        if (ctx.riskAppetite === RISK_APPETITES.aggressive) healthScore += 4;
        healthScore = Math.max(0, Math.min(100, healthScore));
        var hardF = counts.P0 >= 5 || insights.some(function (i) {
            return i.code === 'CONTAMINATION_THREAD' && counts.P0 >= 2;
        });
        var grade = _gradeFromScore(healthScore, hardF);

        var headline = (counts.P0 > 0)
            ? counts.P0 + ' P0 carryover(s), ' + counts.P1 + ' P1 — handoff grade ' + grade + '.'
            : (counts.P1 > 0)
                ? counts.P1 + ' P1 carryover(s), no P0 — handoff grade ' + grade + '.'
                : (carryovers.length > 0)
                    ? 'Routine carryover load (' + carryovers.length + ' items) — handoff grade ' + grade + '.'
                    : 'Clean handoff — no carryovers.';

        return {
            shiftLabel: input.shiftLabel || ('Shift ' + ctx.now.toISOString()),
            generatedAt: ctx.now.toISOString(),
            riskAppetite: ctx.riskAppetite,
            counts: counts,
            healthScore: healthScore,
            grade: grade,
            headline: headline,
            carryovers: carryovers,
            insights: insights,
            playbook: playbook,
            summary: {
                alerts: raw.alerts.length,
                runs: raw.runs.length,
                anomalies: raw.anomalies.length,
                environmental: raw.environmental.length,
                pendingTasks: raw.pendingTasks.length,
                blockers: raw.blockers.length,
            },
        };
    }

    function simulate(input, opts2) {
        opts2 = opts2 || {};
        var briefing = synthesize(input);
        var applyTop = Math.max(0, Math.min(briefing.playbook.length, opts2.applyTop || 0));
        var applied = briefing.playbook.slice(0, applyTop);
        // diminishing returns: each applied P0 returns 12 health, P1 6, P2 2; factor 0.85^i
        var bonus = 0;
        applied.forEach(function (a, i) {
            var base = a.priority === 'P0' ? 12 : a.priority === 'P1' ? 6 : a.priority === 'P2' ? 2 : 1;
            bonus += base * Math.pow(0.85, i);
        });
        var projected = Math.max(0, Math.min(100, Math.round(briefing.healthScore + bonus)));
        return {
            projectedHealthScore: projected,
            projectedGrade: _gradeFromScore(projected, false),
            appliedActions: applied,
            baselineHealthScore: briefing.healthScore,
            baselineGrade: briefing.grade,
        };
    }

    // ── renderers ────────────────────────────────────────────────

    function formatText(b) {
        var lines = [];
        lines.push('SHIFT HANDOFF BRIEFING - ' + (b.shiftLabel || ''));
        lines.push('Grade ' + b.grade + ' | Health ' + b.healthScore + '/100 | Appetite: ' + b.riskAppetite);
        lines.push(b.headline);
        lines.push('Generated: ' + b.generatedAt);
        lines.push('Carryovers: P0=' + b.counts.P0 + ' P1=' + b.counts.P1 + ' P2=' + b.counts.P2 + ' P3=' + b.counts.P3);
        lines.push('-'.repeat(60));
        if (b.carryovers.length === 0) {
            lines.push('(no carryovers)');
        } else {
            b.carryovers.forEach(function (c) {
                lines.push('[' + c.priority + '] ' + c.title + ' -- ' + c.verdict + ' (owner=' + c.owner + ', score=' + c.score + ')');
                if (c.reasons.length) lines.push('     reasons: ' + c.reasons.join(', '));
            });
        }
        if (b.insights.length) {
            lines.push('');
            lines.push('Insights:');
            b.insights.forEach(function (i) { lines.push('  * [' + i.severity + '] ' + i.code + ': ' + i.text); });
        }
        if (b.playbook.length) {
            lines.push('');
            lines.push('Playbook:');
            b.playbook.forEach(function (a) {
                lines.push('  [' + a.priority + '] ' + a.code + ' (owner=' + a.owner + ', blast=' + a.blastRadius + ', rev=' + a.reversibility + ')');
                lines.push('     why: ' + a.reason);
            });
        }
        return lines.join('\n');
    }

    function formatMarkdown(b) {
        var out = [];
        out.push('# Shift Handoff Briefing');
        out.push('');
        out.push('**Shift:** ' + (b.shiftLabel || ''));
        out.push('**Grade:** ' + b.grade + ' &nbsp; **Health:** ' + b.healthScore + '/100 &nbsp; **Appetite:** ' + b.riskAppetite);
        out.push('');
        out.push('> ' + b.headline);
        out.push('');
        out.push('| P0 | P1 | P2 | P3 |');
        out.push('|---:|---:|---:|---:|');
        out.push('| ' + b.counts.P0 + ' | ' + b.counts.P1 + ' | ' + b.counts.P2 + ' | ' + b.counts.P3 + ' |');
        out.push('');
        out.push('## Carryovers');
        out.push('');
        if (b.carryovers.length === 0) {
            out.push('_No carryovers._');
        } else {
            out.push('| Priority | Kind | Title | Verdict | Owner | Score | Reasons |');
            out.push('|----------|------|-------|---------|-------|------:|---------|');
            b.carryovers.forEach(function (c) {
                out.push('| ' + c.priority + ' | ' + c.kind + ' | ' + c.title + ' | ' + c.verdict + ' | ' + c.owner + ' | ' + c.score + ' | ' + c.reasons.join(', ') + ' |');
            });
        }
        if (b.insights.length) {
            out.push('');
            out.push('## Insights');
            out.push('');
            b.insights.forEach(function (i) { out.push('- **[' + i.severity + '] ' + i.code + '** — ' + i.text); });
        }
        if (b.playbook.length) {
            out.push('');
            out.push('## Playbook');
            out.push('');
            out.push('| Priority | Action | Owner | Blast | Reversibility | Reason |');
            out.push('|----------|--------|-------|------:|--------------:|--------|');
            b.playbook.forEach(function (a) {
                out.push('| ' + a.priority + ' | ' + a.code + ' | ' + a.owner + ' | ' + a.blastRadius + ' | ' + a.reversibility + ' | ' + a.reason + ' |');
            });
        }
        return out.join('\n');
    }

    function _sortedKeysReplacer(key, val) {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            var out = {};
            Object.keys(val).sort().forEach(function (k) { out[k] = val[k]; });
            return out;
        }
        return val;
    }

    function formatJson(b) {
        return JSON.stringify(b, _sortedKeysReplacer, 2);
    }

    return {
        synthesize: synthesize,
        simulate: simulate,
        formatText: formatText,
        formatMarkdown: formatMarkdown,
        formatJson: formatJson,
    };
}

module.exports = {
    createShiftHandoffSynthesizer: createShiftHandoffSynthesizer,
};
