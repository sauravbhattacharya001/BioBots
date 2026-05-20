'use strict';

/**
 * Batch Queue Prioritization Advisor — agentic per-pending-batch scheduler
 * sibling to operatorFatigueAdvisor, equipmentDowntimeRiskAdvisor,
 * shiftHandoffSynthesizer, batchReleaseAdvisor, etc.
 *
 * Given a queue of pending bioprint batches and the current shift context
 * (equipment + operator availability, completed upstream batch IDs, current
 * fleet load), emits a structured 0-100 priorityScore per batch, a 7-tier
 * verdict, P0-P3 bucket, a deterministic recommendedRunOrder, deduped
 * portfolio playbook with owner/blast/reversibility metadata, always-on
 * insight codes, an A-F grade, and text / markdown / JSON renderers.
 *
 * Pure CommonJS, zero deps, deterministic given an injected now(), never
 * mutates inputs.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var advisor = biobots.createBatchQueuePrioritizationAdvisor({
 *       now: function () { return new Date('2026-05-20T13:00:00Z'); }
 *   });
 *   var report = advisor.prioritize({
 *       batches: [{ id: 'B1', estimatedRuntimeHours: 4,
 *           slaDeadlineISO: '2026-05-20T16:00:00Z',
 *           customerTier: 'platinum' }],
 *       context: { currentLoadHours: 20 }
 *   });
 *   console.log(advisor.formatMarkdown(report));
 */

var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

var VERDICTS = {
    RUN_NOW: 'RUN_NOW',
    SCHEDULE_NEXT_SLOT: 'SCHEDULE_NEXT_SLOT',
    HOLD_FOR_RESOURCES: 'HOLD_FOR_RESOURCES',
    ESCALATE_SLA: 'ESCALATE_SLA',
    RECOMMEND_REWORK_BATCH_LATER: 'RECOMMEND_REWORK_BATCH_LATER',
    DEFER: 'DEFER',
    BLOCKED_BY_DEPENDENCY: 'BLOCKED_BY_DEPENDENCY',
};

var APPETITE_MULT = { cautious: 1.10, balanced: 1.0, aggressive: 0.90 };

var TIER_BONUS = { platinum: 15, gold: 10, silver: 5, standard: 0 };

// ── helpers ─────────────────────────────────────────────────────

function _isFiniteNum(n) { return typeof n === 'number' && isFinite(n); }
function _num(n, d) { return _isFiniteNum(n) ? n : (d || 0); }
function _str(s) { return typeof s === 'string' ? s : ''; }
function _bool(b) { return b === true; }
function _arr(a) { return Array.isArray(a) ? a : []; }
function _obj(o) { return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _parseIso(s) {
    if (!s || typeof s !== 'string') return null;
    var t = Date.parse(s);
    return isFinite(t) ? new Date(t) : null;
}

function _isoOrNull(d) {
    return (d && d instanceof Date && isFinite(d.getTime())) ? d.toISOString() : null;
}

function _normalizeBatch(raw) {
    var r = _obj(raw);
    var tier = _str(r.customerTier).toLowerCase();
    if (!(tier in TIER_BONUS)) tier = 'standard';
    var hint = _str(r.priorityHint).toLowerCase();
    if (hint !== 'rush' && hint !== 'normal' && hint !== 'low') hint = 'normal';
    return {
        id: _str(r.id),
        name: _str(r.name) || _str(r.id) || '(unnamed)',
        customerTier: tier,
        slaDeadlineISO: _str(r.slaDeadlineISO),
        estimatedRuntimeHours: Math.max(0, _num(r.estimatedRuntimeHours, 0)),
        reagentExpiryISO: _str(r.reagentExpiryISO),
        requiredEquipmentId: _str(r.requiredEquipmentId),
        requiredOperatorIds: _arr(r.requiredOperatorIds).map(_str).filter(Boolean),
        submittedAtISO: _str(r.submittedAtISO),
        dependencyBatchIds: _arr(r.dependencyBatchIds).map(_str).filter(Boolean),
        estimatedRevenueUsd: Math.max(0, _num(r.estimatedRevenueUsd, 0)),
        complexityScore: _clamp(_num(r.complexityScore, 0), 0, 10),
        priorityHint: hint,
        isRework: _bool(r.isRework),
    };
}

function _normalizeContext(raw) {
    var c = _obj(raw);
    return {
        equipmentAvailability: _obj(c.equipmentAvailability),
        operatorAvailability: _obj(c.operatorAvailability),
        completedBatchIds: _arr(c.completedBatchIds).map(_str).filter(Boolean),
        currentLoadHours: Math.max(0, _num(c.currentLoadHours, 0)),
    };
}

function _resolveAppetite(opts) {
    var ra = _str((opts || {}).risk_appetite).toLowerCase();
    if (ra === 'cautious' || ra === 'aggressive') return ra;
    return 'balanced';
}

// ── core ────────────────────────────────────────────────────────

/**
 * Build a new BatchQueuePrioritizationAdvisor.
 *
 * The advisor is a pure factory: it captures only an injected `now()`
 * clock so callers can produce deterministic output in tests / replays.
 * The returned object exposes `prioritize`, `formatText`,
 * `formatMarkdown`, `formatJson`, and the `VERDICTS` enum.
 *
 * @param {Object} [config]
 * @param {Function} [config.now] - Override clock; defaults to `new Date()`.
 * @returns {{
 *   prioritize: function(Object, Object=): Object,
 *   formatText: function(Object): string,
 *   formatMarkdown: function(Object): string,
 *   formatJson: function(Object): string,
 *   VERDICTS: Object
 * }}
 */
function createBatchQueuePrioritizationAdvisor(config) {
    config = _obj(config);
    var now = typeof config.now === 'function' ? config.now : function () { return new Date(); };

    /**
     * Score and rank a pending batch queue.
     *
     * Inputs are loose plain records; missing fields are treated as
     * neutral. Output is a deterministic report containing per-batch
     * scores/verdicts/priorities, a `recommendedRunOrder` (id list)
     * sorted by priority → score → SLA deadline → id, a deduped
     * playbook, cross-portfolio insights, and a risk-appetite stamp.
     *
     * @param {Object} [input]
     * @param {Array<Object>} [input.batches] - Pending batch records.
     * @param {Object} [input.context] - Shift context (equipment +
     *   operator availability, completed dependencies, fleet load).
     * @param {Object} [options]
     * @param {('cautious'|'balanced'|'aggressive')} [options.risk_appetite]
     *   Multiplier on scores; unknown values fall back to 'balanced'.
     * @returns {Object} Prioritization report.
     */
    function prioritize(input, options) {
        var nowDate = now();
        if (!(nowDate instanceof Date) || !isFinite(nowDate.getTime())) {
            nowDate = new Date();
        }
        var appetite = _resolveAppetite(options);
        var mult = APPETITE_MULT[appetite];

        var batchesIn = _arr((input || {}).batches);
        var context = _normalizeContext((input || {}).context);
        var batches = batchesIn.map(_normalizeBatch);

        var completedSet = Object.create(null);
        context.completedBatchIds.forEach(function (id) { completedSet[id] = true; });

        var assessments = batches.map(function (b) {
            return _assessBatch(b, context, completedSet, nowDate, mult, appetite);
        });

        var order = assessments.slice().sort(function (a, x) {
            var pa = PRIORITY_RANK[a.priority] - PRIORITY_RANK[x.priority];
            if (pa !== 0) return pa;
            if (x.priorityScore !== a.priorityScore) return x.priorityScore - a.priorityScore;
            var ad = a.slaDeadlineMs == null ? Infinity : a.slaDeadlineMs;
            var xd = x.slaDeadlineMs == null ? Infinity : x.slaDeadlineMs;
            if (ad !== xd) return ad - xd;
            return a.id < x.id ? -1 : a.id > x.id ? 1 : 0;
        });
        var recommendedRunOrder = order.map(function (a) { return a.id; });

        var summary = _summarize(assessments, context, appetite);
        var playbook = _buildPlaybook(assessments, summary, context, appetite);
        var insights = _buildInsights(assessments, batches, summary);

        // Strip internal fields from final report
        var publicAssessments = assessments.map(function (a) {
            var copy = {};
            Object.keys(a).forEach(function (k) {
                if (k === 'slaDeadlineMs') return;
                copy[k] = a[k];
            });
            return copy;
        });

        return {
            generatedAtISO: nowDate.toISOString(),
            risk_appetite: appetite,
            summary: summary,
            batches: publicAssessments,
            recommendedRunOrder: recommendedRunOrder,
            playbook: playbook,
            insights: insights,
        };
    }

    function _assessBatch(b, context, completedSet, nowDate, mult, appetite) {
        var reasons = [];
        var blockers = [];
        var score = 30;

        // Dependencies
        var unfinishedDeps = b.dependencyBatchIds.filter(function (id) { return !completedSet[id]; });
        var dependencyBlocked = unfinishedDeps.length > 0;
        if (dependencyBlocked) {
            score -= 50;
            reasons.push('DEPENDENCY_PENDING');
            unfinishedDeps.forEach(function (id) { blockers.push('dependency:' + id); });
        }

        // SLA pressure
        var slaDeadline = _parseIso(b.slaDeadlineISO);
        var slaDeadlineMs = slaDeadline ? slaDeadline.getTime() : null;
        var hoursToDeadline = slaDeadline
            ? (slaDeadline.getTime() - nowDate.getTime()) / 3600000
            : null;
        var slaImminent = false;
        var alreadyLate = false;
        if (hoursToDeadline != null) {
            if (hoursToDeadline < 0) {
                score += 40;
                reasons.push('ALREADY_LATE');
                alreadyLate = true;
            } else if (hoursToDeadline <= b.estimatedRuntimeHours + 2) {
                score += 35;
                reasons.push('SLA_BREACH_IMMINENT');
                slaImminent = true;
            } else if (b.estimatedRuntimeHours > 0 && hoursToDeadline <= b.estimatedRuntimeHours * 2) {
                score += 20;
                reasons.push('SLA_BREACH_RISK');
            }
        }

        // Tier
        var tb = TIER_BONUS[b.customerTier];
        if (tb > 0) {
            score += tb;
            if (b.customerTier === 'platinum') reasons.push('PLATINUM_CUSTOMER');
        }

        // Hint
        if (b.priorityHint === 'rush') { score += 15; reasons.push('RUSH_HINT'); }
        else if (b.priorityHint === 'low') { score -= 10; }

        // Revenue
        if (b.estimatedRevenueUsd >= 10000) { score += 10; reasons.push('HIGH_REVENUE'); }
        else if (b.estimatedRevenueUsd >= 1000) { score += 5; }

        // Compute earliest start window for reagent + start-window timing
        var earliest = _earliestStart(b, context, nowDate, dependencyBlocked);
        var startMs = earliest ? earliest.getTime() : nowDate.getTime();

        // Reagent expiry pressure (relative to start)
        var reagentExpiry = _parseIso(b.reagentExpiryISO);
        if (reagentExpiry) {
            var hoursToExpiry = (reagentExpiry.getTime() - startMs) / 3600000;
            if (hoursToExpiry <= 24) {
                score += 12;
                reasons.push('REAGENT_EXPIRY_PRESSURE');
            } else if (hoursToExpiry <= 72) {
                score += 6;
            }
        }

        // Complexity
        if (b.complexityScore > 0) {
            score += b.complexityScore;
            if (b.complexityScore >= 7) reasons.push('HIGH_COMPLEXITY');
        }

        // Runtime
        if (b.estimatedRuntimeHours >= 8) reasons.push('LONG_RUNTIME');

        // Rework
        if (b.isRework) {
            score -= 10;
            reasons.push('REWORK_LOWER_PRIORITY');
        }

        // Equipment availability
        var equipBlocked = false;
        if (b.requiredEquipmentId) {
            var eq = _obj(context.equipmentAvailability)[b.requiredEquipmentId];
            if (eq) {
                if (eq.healthyOk === false) {
                    score -= 15; reasons.push('EQUIPMENT_UNAVAILABLE');
                    equipBlocked = true;
                    blockers.push('equipment:' + b.requiredEquipmentId);
                } else {
                    var avail = _parseIso(_str(eq.availableAtISO));
                    if (avail && avail.getTime() > nowDate.getTime() + 12 * 3600000) {
                        score -= 15; reasons.push('EQUIPMENT_UNAVAILABLE');
                        equipBlocked = true;
                        blockers.push('equipment:' + b.requiredEquipmentId);
                    }
                }
            }
        }

        // Operator availability
        var operatorBlocked = false;
        var operatorFatigued = false;
        if (b.requiredOperatorIds.length > 0) {
            var anyAvailable = false;
            var anyFatigued = false;
            b.requiredOperatorIds.forEach(function (oid) {
                var op = _obj(context.operatorAvailability)[oid];
                if (!op) { anyAvailable = true; return; }
                var avail = _parseIso(_str(op.availableAtISO));
                var availSoon = !avail || avail.getTime() <= nowDate.getTime() + 12 * 3600000;
                if (availSoon) anyAvailable = true;
                if (op.fatigued === true) anyFatigued = true;
            });
            if (!anyAvailable) {
                score -= 15; reasons.push('OPERATOR_UNAVAILABLE');
                operatorBlocked = true;
                blockers.push('operator:none-available');
            }
            if (anyFatigued) {
                score -= 8;
                reasons.push('OPERATOR_FATIGUED');
                operatorFatigued = true;
            }
        }

        // Newly submitted (last 2h)
        var submitted = _parseIso(b.submittedAtISO);
        if (submitted && (nowDate.getTime() - submitted.getTime()) <= 2 * 3600000) {
            reasons.push('NEW_SUBMISSION');
        }

        // Appetite multiplier + clamp
        score = Math.round(_clamp(score, 0, 100) * mult);
        score = _clamp(score, 0, 100);

        // Verdict ladder
        var verdict;
        var priority;
        var recommendedStartWindow;
        var resourceBlocked = equipBlocked || operatorBlocked;

        if (dependencyBlocked) {
            verdict = VERDICTS.BLOCKED_BY_DEPENDENCY;
            priority = 'P2';
            recommendedStartWindow = 'on_hold';
        } else if (slaImminent || alreadyLate) {
            verdict = VERDICTS.ESCALATE_SLA;
            priority = 'P0';
            recommendedStartWindow = 'now';
        } else if (resourceBlocked) {
            verdict = VERDICTS.HOLD_FOR_RESOURCES;
            priority = score >= 60 ? 'P1' : 'P2';
            recommendedStartWindow = 'on_hold';
        } else if (b.isRework && !slaImminent) {
            verdict = VERDICTS.RECOMMEND_REWORK_BATCH_LATER;
            priority = 'P3';
            recommendedStartWindow = 'this_week';
        } else if (score >= 75) {
            verdict = VERDICTS.RUN_NOW;
            priority = 'P1';
            recommendedStartWindow = 'now';
        } else if (score >= 50) {
            verdict = VERDICTS.SCHEDULE_NEXT_SLOT;
            priority = 'P2';
            recommendedStartWindow = 'today';
        } else {
            verdict = VERDICTS.DEFER;
            priority = 'P3';
            recommendedStartWindow = 'tomorrow';
        }

        return {
            id: b.id,
            name: b.name,
            priorityScore: score,
            verdict: verdict,
            priority: priority,
            reasons: reasons,
            recommendedStartWindow: recommendedStartWindow,
            earliestStartISO: _isoOrNull(earliest),
            blockers: blockers,
            slaDeadlineMs: slaDeadlineMs,
        };
    }

    function _earliestStart(b, context, nowDate, dependencyBlocked) {
        if (dependencyBlocked) return null;
        var ms = nowDate.getTime();
        if (b.requiredEquipmentId) {
            var eq = _obj(context.equipmentAvailability)[b.requiredEquipmentId];
            if (eq) {
                if (eq.healthyOk === false) return null;
                var ea = _parseIso(_str(eq.availableAtISO));
                if (ea && ea.getTime() > ms) ms = ea.getTime();
            }
        }
        if (b.requiredOperatorIds.length > 0) {
            // earliest time any operator becomes available
            var bestOp = Infinity;
            var anyKnown = false;
            b.requiredOperatorIds.forEach(function (oid) {
                var op = _obj(context.operatorAvailability)[oid];
                if (!op) { bestOp = ms; anyKnown = true; return; }
                var oa = _parseIso(_str(op.availableAtISO));
                anyKnown = true;
                var t = oa ? oa.getTime() : ms;
                if (t < bestOp) bestOp = t;
            });
            if (anyKnown && bestOp > ms) ms = bestOp;
        }
        return new Date(ms);
    }

    function _summarize(assessments, context, appetite) {
        var total = assessments.length;
        var runNow = 0;
        var blocked = 0;
        var escalate = 0;
        var sumScore = 0;
        var throughput = 0;
        assessments.forEach(function (a) {
            if (a.verdict === VERDICTS.RUN_NOW) runNow++;
            if (a.verdict === VERDICTS.BLOCKED_BY_DEPENDENCY ||
                a.verdict === VERDICTS.HOLD_FOR_RESOURCES) blocked++;
            if (a.verdict === VERDICTS.ESCALATE_SLA) escalate++;
            sumScore += a.priorityScore;
        });
        // Estimated throughput hours = sum of runtime for non-blocked, non-deferred
        assessments.forEach(function (a) {
            if (a.verdict === VERDICTS.RUN_NOW ||
                a.verdict === VERDICTS.SCHEDULE_NEXT_SLOT ||
                a.verdict === VERDICTS.ESCALATE_SLA) {
                // Find batch runtime (id-matched) — use 0 fallback handled via map below
            }
        });
        // Score
        var portfolioScore = total > 0 ? Math.round(sumScore / total) : 100;

        // Grade
        var grade;
        if (escalate >= 1 || blocked >= 3 || (total > 0 && portfolioScore < 35)) grade = 'F';
        else if (escalate === 0 && blocked >= 2) grade = 'D';
        else if (portfolioScore < 50) grade = 'C';
        else if (portfolioScore < 70) grade = 'B';
        else grade = 'A';
        // Cautious doesn't auto-upgrade; aggressive doesn't auto-downgrade — appetite already shifted score.

        return {
            totalBatches: total,
            runNowCount: runNow,
            blockedCount: blocked,
            escalateSlaCount: escalate,
            currentLoadHours: context.currentLoadHours,
            portfolioScore: portfolioScore,
            grade: grade,
        };
    }

    function _buildPlaybook(assessments, summary, context, appetite) {
        var actions = [];
        function add(act) { actions.push(act); }

        // Per-batch contributions
        var escalateBatches = assessments
            .filter(function (a) { return a.verdict === VERDICTS.ESCALATE_SLA; })
            .map(function (a) { return a.id; });
        var blockedDeps = assessments
            .filter(function (a) { return a.verdict === VERDICTS.BLOCKED_BY_DEPENDENCY; })
            .map(function (a) { return a.id; });
        var equipHeld = assessments
            .filter(function (a) {
                return a.verdict === VERDICTS.HOLD_FOR_RESOURCES &&
                    a.reasons.indexOf('EQUIPMENT_UNAVAILABLE') !== -1;
            })
            .map(function (a) { return a.id; });
        var operatorHeld = assessments
            .filter(function (a) {
                return a.verdict === VERDICTS.HOLD_FOR_RESOURCES &&
                    a.reasons.indexOf('OPERATOR_UNAVAILABLE') !== -1;
            })
            .map(function (a) { return a.id; });
        var reworkBatches = assessments
            .filter(function (a) { return a.verdict === VERDICTS.RECOMMEND_REWORK_BATCH_LATER; })
            .map(function (a) { return a.id; });
        var reagentPressure = assessments
            .filter(function (a) { return a.reasons.indexOf('REAGENT_EXPIRY_PRESSURE') !== -1; })
            .map(function (a) { return a.id; });

        if (escalateBatches.length > 0) {
            add({
                id: 'ESCALATE_SLA_BREACH',
                priority: 'P0',
                label: 'Escalate SLA breach for ' + escalateBatches.length + ' batch(es)',
                reason: 'SLA deadline imminent or already missed for: ' + escalateBatches.join(', '),
                owner: 'customer_success',
                blastRadius: 4,
                reversibility: 'low',
                relatedBatchIds: escalateBatches.slice(),
            });
        }
        if (blockedDeps.length > 0) {
            add({
                id: 'EXPEDITE_BLOCKED_DEPENDENCIES',
                priority: 'P0',
                label: 'Expedite upstream dependencies for ' + blockedDeps.length + ' batch(es)',
                reason: 'Downstream batches cannot start until upstream completes',
                owner: 'scheduler',
                blastRadius: 3,
                reversibility: 'medium',
                relatedBatchIds: blockedDeps.slice(),
            });
        }
        if (equipHeld.length > 0) {
            add({
                id: 'FREE_UP_EQUIPMENT',
                priority: 'P1',
                label: 'Free up equipment blocking ' + equipHeld.length + ' batch(es)',
                reason: 'Required equipment unavailable or unhealthy',
                owner: 'maintenance',
                blastRadius: 3,
                reversibility: 'medium',
                relatedBatchIds: equipHeld.slice(),
            });
        }
        if (operatorHeld.length > 0) {
            add({
                id: 'CALL_IN_BACKUP_OPERATOR',
                priority: 'P1',
                label: 'Call in backup operator(s) for ' + operatorHeld.length + ' batch(es)',
                reason: 'All required operators unavailable for the next slot',
                owner: 'operator',
                blastRadius: 2,
                reversibility: 'high',
                relatedBatchIds: operatorHeld.slice(),
            });
        }
        if (escalateBatches.length > 0) {
            add({
                id: 'NEGOTIATE_DEADLINE_EXTENSION',
                priority: 'P1',
                label: 'Negotiate deadline extension where feasible',
                reason: 'SLA at risk; some customers may accept a slip',
                owner: 'customer_success',
                blastRadius: 3,
                reversibility: 'medium',
                relatedBatchIds: escalateBatches.slice(),
            });
        }
        if (reagentPressure.length > 0) {
            add({
                id: 'CONSUME_EXPIRING_REAGENTS_FIRST',
                priority: 'P1',
                label: 'Sequence ' + reagentPressure.length + ' expiring-reagent batch(es) first',
                reason: 'Reagent expiry within 24h of planned start',
                owner: 'scheduler',
                blastRadius: 2,
                reversibility: 'high',
                relatedBatchIds: reagentPressure.slice(),
            });
        }
        if (reworkBatches.length > 0) {
            add({
                id: 'BATCH_REWORK_SEPARATELY',
                priority: 'P2',
                label: 'Group ' + reworkBatches.length + ' rework batch(es) into a dedicated slot',
                reason: 'Reworks lower priority and benefit from isolation',
                owner: 'scheduler',
                blastRadius: 2,
                reversibility: 'high',
                relatedBatchIds: reworkBatches.slice(),
            });
        }
        if (context.currentLoadHours > 60) {
            add({
                id: 'THROTTLE_NEW_INTAKE',
                priority: 'P2',
                label: 'Throttle new batch intake while load > 60h',
                reason: 'Current load ' + context.currentLoadHours + 'h risks queue blow-out',
                owner: 'scheduler',
                blastRadius: 4,
                reversibility: 'high',
                relatedBatchIds: [],
            });
        }
        if (appetite === 'cautious' &&
            (summary.grade === 'C' || summary.grade === 'D' || summary.grade === 'F')) {
            add({
                id: 'SCHEDULE_QUEUE_REVIEW',
                priority: 'P2',
                label: 'Schedule a queue review with shift lead',
                reason: 'Cautious appetite + queue grade ' + summary.grade,
                owner: 'scheduler',
                blastRadius: 1,
                reversibility: 'high',
                relatedBatchIds: [],
            });
        }
        if (actions.length === 0) {
            add({
                id: 'MAINTAIN_QUEUE_OK',
                priority: 'P3',
                label: 'Queue healthy — maintain current cadence',
                reason: 'No urgent intervention required',
                owner: 'scheduler',
                blastRadius: 1,
                reversibility: 'high',
                relatedBatchIds: [],
            });
        }

        // Aggressive trims P3
        if (appetite === 'aggressive' && actions.length > 1) {
            actions = actions.filter(function (a) { return a.priority !== 'P3'; });
            if (actions.length === 0) {
                actions = [{
                    id: 'MAINTAIN_QUEUE_OK',
                    priority: 'P3',
                    label: 'Queue healthy — maintain current cadence',
                    reason: 'No urgent intervention required',
                    owner: 'scheduler',
                    blastRadius: 1,
                    reversibility: 'high',
                    relatedBatchIds: [],
                }];
            }
        }

        // Dedupe by id (keep first)
        var seen = Object.create(null);
        var out = [];
        actions.forEach(function (a) {
            if (seen[a.id]) return;
            seen[a.id] = true;
            out.push(a);
        });
        out.sort(function (a, b) {
            var pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
            if (pr !== 0) return pr;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        return out;
    }

    function _buildInsights(assessments, batches, summary) {
        var insights = [];

        if (summary.escalateSlaCount >= 2) insights.push('SLA_PRESSURE_CLUSTER');
        var blockedDepCount = 0;
        assessments.forEach(function (a) {
            if (a.verdict === VERDICTS.BLOCKED_BY_DEPENDENCY) blockedDepCount++;
        });
        if (blockedDepCount >= 2) insights.push('DEPENDENCY_CHAIN_BLOCKER');

        // Equipment bottleneck: >=2 share unavailable equipment
        var equipCounts = Object.create(null);
        assessments.forEach(function (a, idx) {
            if (a.reasons.indexOf('EQUIPMENT_UNAVAILABLE') !== -1) {
                var eqId = batches[idx].requiredEquipmentId || '__unknown__';
                equipCounts[eqId] = (equipCounts[eqId] || 0) + 1;
            }
        });
        var bottleneck = false;
        Object.keys(equipCounts).forEach(function (k) { if (equipCounts[k] >= 2) bottleneck = true; });
        if (bottleneck) insights.push('EQUIPMENT_BOTTLENECK');

        var opUnavailCount = 0;
        assessments.forEach(function (a) {
            if (a.reasons.indexOf('OPERATOR_UNAVAILABLE') !== -1) opUnavailCount++;
        });
        if (opUnavailCount >= 2) insights.push('OPERATOR_BENCH_THIN');

        var reagentCount = 0;
        assessments.forEach(function (a) {
            if (a.reasons.indexOf('REAGENT_EXPIRY_PRESSURE') !== -1) reagentCount++;
        });
        if (reagentCount >= 1) insights.push('EXPIRING_REAGENTS_DRIVING_PRIORITY');

        var highValueAtRisk = false;
        assessments.forEach(function (a, idx) {
            if (a.verdict === VERDICTS.ESCALATE_SLA && batches[idx].estimatedRevenueUsd >= 10000) {
                highValueAtRisk = true;
            }
        });
        if (highValueAtRisk) insights.push('HIGH_VALUE_AT_RISK');

        if (insights.length === 0) insights.push('HEALTHY_QUEUE');
        return insights;
    }

    // ── renderers ──────────────────────────────────────────────

    function formatText(report) {
        var out = [];
        out.push('Batch Queue Prioritization Report');
        out.push('Generated: ' + report.generatedAtISO + ' (appetite=' + report.risk_appetite + ')');
        out.push('Grade: ' + report.summary.grade +
            ' | score=' + report.summary.portfolioScore +
            ' | batches=' + report.summary.totalBatches +
            ' | run-now=' + report.summary.runNowCount +
            ' | blocked=' + report.summary.blockedCount +
            ' | escalate-SLA=' + report.summary.escalateSlaCount);
        out.push('');
        out.push('Recommended run order: ' + (report.recommendedRunOrder.join(', ') || '(none)'));
        out.push('');
        report.batches.forEach(function (b) {
            out.push('[' + b.priority + '] ' + b.id + ' "' + b.name + '" — ' +
                b.verdict + ' (score=' + b.priorityScore + ', window=' + b.recommendedStartWindow + ')');
            if (b.reasons.length) out.push('    reasons: ' + b.reasons.join(', '));
            if (b.blockers.length) out.push('    blockers: ' + b.blockers.join(', '));
        });
        out.push('');
        out.push('Playbook:');
        report.playbook.forEach(function (p) {
            out.push('  [' + p.priority + '] ' + p.id + ' — ' + p.label + ' (owner=' + p.owner + ')');
        });
        out.push('');
        out.push('Insights: ' + report.insights.join(', '));
        return out.join('\n');
    }

    function _esc(s) { return String(s).replace(/\|/g, '\\|'); }

    function formatMarkdown(report) {
        var out = [];
        out.push('# Batch Queue Prioritization Report');
        out.push('');
        out.push('_Generated: ' + report.generatedAtISO + ' · appetite: ' + report.risk_appetite + '_');
        out.push('');
        out.push('## Summary');
        out.push('');
        out.push('| Metric | Value |');
        out.push('|---|---|');
        out.push('| Grade | ' + report.summary.grade + ' |');
        out.push('| Portfolio score | ' + report.summary.portfolioScore + ' |');
        out.push('| Total batches | ' + report.summary.totalBatches + ' |');
        out.push('| Run now | ' + report.summary.runNowCount + ' |');
        out.push('| Blocked | ' + report.summary.blockedCount + ' |');
        out.push('| Escalate SLA | ' + report.summary.escalateSlaCount + ' |');
        out.push('| Current load (h) | ' + report.summary.currentLoadHours + ' |');
        out.push('');
        out.push('Recommended run order: ' +
            (report.recommendedRunOrder.length ? '`' + report.recommendedRunOrder.join('` → `') + '`' : '(none)'));
        out.push('');
        out.push('## Batches');
        out.push('');
        out.push('| Priority | ID | Verdict | Score | Window | Reasons |');
        out.push('|---|---|---|---|---|---|');
        if (report.batches.length === 0) {
            out.push('| — | — | — | — | — | (no batches) |');
        } else {
            report.batches.forEach(function (b) {
                out.push('| ' + b.priority + ' | ' + _esc(b.id) + ' | ' + b.verdict + ' | ' +
                    b.priorityScore + ' | ' + b.recommendedStartWindow + ' | ' +
                    _esc(b.reasons.join(', ') || '—') + ' |');
            });
        }
        out.push('');
        out.push('## Playbook');
        out.push('');
        out.push('| Priority | ID | Owner | Label | Reason |');
        out.push('|---|---|---|---|---|');
        report.playbook.forEach(function (p) {
            out.push('| ' + p.priority + ' | ' + p.id + ' | ' + p.owner + ' | ' +
                _esc(p.label) + ' | ' + _esc(p.reason) + ' |');
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
            if (v === null || v === undefined) return 'null';
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
                var kparts = keys.map(function (k) {
                    return padInner + JSON.stringify(k) + ': ' + _rec(v[k], depth + 1);
                });
                return '{\n' + kparts.join(',\n') + '\n' + pad + '}';
            }
            return 'null';
        }
        return _rec(value, 0);
    }

    function formatJson(report) { return _stableStringify(report, 2); }

    return {
        prioritize: prioritize,
        formatText: formatText,
        formatMarkdown: formatMarkdown,
        formatJson: formatJson,
        VERDICTS: VERDICTS,
    };
}

module.exports = {
    createBatchQueuePrioritizationAdvisor: createBatchQueuePrioritizationAdvisor,
    VERDICTS: VERDICTS,
};
