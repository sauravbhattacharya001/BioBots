'use strict';

/**
 * Operator Competency Advisor - Agentic per-operator training & supervision triage.
 *
 * Sibling to operatorFatigueAdvisor.js (today-only fatigue) but answers a
 * different question: across the operators on the team, who needs training,
 * supervision, recertification, or coaching, and where are the bench-depth
 * gaps that put the lab at risk?
 *
 * INPUTS
 *   operators: [{
 *       id, name,
 *       role? (e.g. 'tech', 'senior_tech', 'pi'),
 *       hireDate? (Date|ISO),
 *       certifications? [{ id, name, equipmentId?|protocolId?,
 *           issuedAt (Date|ISO), expiresAt (Date|ISO), level? (1..5) }],
 *       skills? { equipmentId|protocolId: level 1..5 },
 *       runs? [{ id, protocolId?, equipmentId?, ts (Date|ISO),
 *           outcome 'success'|'failure'|'rework', operatorErrorBlamed? bool }],
 *       supervisedRunsLastMonth? number,
 *       trainingHoursLastQuarter? number
 *   }]
 *
 *   requirements: [{
 *       targetId (equipmentId|protocolId),
 *       kind 'equipment'|'protocol',
 *       label?,
 *       minLevel? (default 3),
 *       criticality? (1..5, default 3),
 *       requiresCertification? bool,
 *       minCertifiedHeads? (default 2, fleet-bench-depth target)
 *   }]
 *
 * Optional options: { now, risk_appetite 'cautious'|'balanced'|'aggressive' }.
 *
 * OUTPUT (report)
 *   - perOperator: [{ id, name, score 0..100, grade A-F, verdict,
 *       priority P0-P3, reasons[], gaps[], expiringCerts[], topFailedTarget?,
 *       supervisionRecommendation 'NONE'|'BUDDY'|'DIRECT' }]
 *   - playbook: [{ id, priority, label, reason, owner, blastRadius, reversibility,
 *       operatorIds, targetId? }]
 *   - portfolio: { grade, score, totalOperators, untrainedTargets[],
 *       singleCertifiedTargets[], expiringCertCount }
 *   - insights: string[]
 *   - headline
 *
 * Pure CommonJS, zero deps, deterministic via injectable now(), never mutates
 * inputs (deep copy entry-by-entry).
 */

var V = {
    NEEDS_RECERTIFICATION: 'NEEDS_RECERTIFICATION',
    NEEDS_TRAINING: 'NEEDS_TRAINING',
    NEEDS_SUPERVISION: 'NEEDS_SUPERVISION',
    COACHING_RECOMMENDED: 'COACHING_RECOMMENDED',
    READY_TO_MENTOR: 'READY_TO_MENTOR',
    COMPETENT: 'COMPETENT',
    INSUFFICIENT_DATA: 'INSUFFICIENT_DATA'
};

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function isDate(d) { return d instanceof Date && !isNaN(d.getTime()); }
function toDate(v) {
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}
function daysBetween(a, b) {
    return (b.getTime() - a.getTime()) / 86400000;
}
function gradeFromScore(s) {
    if (s >= 85) return 'A';
    if (s >= 70) return 'B';
    if (s >= 55) return 'C';
    if (s >= 40) return 'D';
    return 'F';
}

function appetiteMult(appetite) {
    if (appetite === 'cautious') return 1.15;
    if (appetite === 'aggressive') return 0.85;
    return 1.0;
}

function safeArray(x) { return Array.isArray(x) ? x : []; }
function safeObject(x) { return (x && typeof x === 'object') ? x : {}; }

function deepCopyOperators(ops) {
    return safeArray(ops).map(function (o) {
        return {
            id: String(o.id),
            name: o.name ? String(o.name) : String(o.id),
            role: o.role ? String(o.role) : 'tech',
            hireDate: toDate(o.hireDate),
            certifications: safeArray(o.certifications).map(function (c) {
                return {
                    id: c.id ? String(c.id) : '',
                    name: c.name ? String(c.name) : '',
                    equipmentId: c.equipmentId || null,
                    protocolId: c.protocolId || null,
                    issuedAt: toDate(c.issuedAt),
                    expiresAt: toDate(c.expiresAt),
                    level: typeof c.level === 'number' ? c.level : null
                };
            }),
            skills: Object.assign({}, safeObject(o.skills)),
            runs: safeArray(o.runs).map(function (r) {
                return {
                    id: r.id ? String(r.id) : '',
                    protocolId: r.protocolId || null,
                    equipmentId: r.equipmentId || null,
                    ts: toDate(r.ts),
                    outcome: r.outcome || 'success',
                    operatorErrorBlamed: !!r.operatorErrorBlamed
                };
            }),
            supervisedRunsLastMonth: Number(o.supervisedRunsLastMonth) || 0,
            trainingHoursLastQuarter: Number(o.trainingHoursLastQuarter) || 0
        };
    });
}

function deepCopyRequirements(reqs) {
    return safeArray(reqs).map(function (r) {
        return {
            targetId: String(r.targetId),
            kind: r.kind === 'protocol' ? 'protocol' : 'equipment',
            label: r.label ? String(r.label) : String(r.targetId),
            minLevel: typeof r.minLevel === 'number' ? r.minLevel : 3,
            criticality: typeof r.criticality === 'number' ? r.criticality : 3,
            requiresCertification: !!r.requiresCertification,
            minCertifiedHeads: typeof r.minCertifiedHeads === 'number' ? r.minCertifiedHeads : 2
        };
    });
}

function bucketRunsByTarget(runs) {
    var byTarget = {};
    runs.forEach(function (r) {
        var key = r.protocolId || r.equipmentId;
        if (!key) return;
        if (!byTarget[key]) byTarget[key] = { total: 0, failed: 0, opErrors: 0 };
        byTarget[key].total += 1;
        if (r.outcome === 'failure' || r.outcome === 'rework') byTarget[key].failed += 1;
        if (r.operatorErrorBlamed) byTarget[key].opErrors += 1;
    });
    return byTarget;
}

function analyzeOperator(op, requirements, now, options) {
    var appetite = options.risk_appetite || 'balanced';
    var mult = appetiteMult(appetite);
    var reasons = [];
    var gaps = [];
    var expiringCerts = [];

    // Index certs by target
    var certByTarget = {};
    op.certifications.forEach(function (c) {
        var key = c.equipmentId || c.protocolId;
        if (!key) return;
        // keep latest cert per target
        if (!certByTarget[key] || (c.expiresAt && certByTarget[key].expiresAt &&
                c.expiresAt > certByTarget[key].expiresAt)) {
            certByTarget[key] = c;
        }
    });

    // Expiry sweep (all certs, even non-required, since user listed them)
    op.certifications.forEach(function (c) {
        if (!c.expiresAt) return;
        var d = daysBetween(now, c.expiresAt);
        if (d < 0) {
            expiringCerts.push({ id: c.id, name: c.name || c.id, daysUntilExpiry: Math.round(d), status: 'EXPIRED' });
        } else if (d <= 30) {
            expiringCerts.push({ id: c.id, name: c.name || c.id, daysUntilExpiry: Math.round(d), status: 'EXPIRING_SOON' });
        }
    });

    // Per-requirement gap scoring
    var totalPenalty = 0;
    var maxComponentPenalty = 0;
    var topFailedTarget = null;
    var topFailRate = 0;
    var runsByTarget = bucketRunsByTarget(op.runs);
    var hasAnyData = (op.runs.length > 0) || (op.certifications.length > 0) || (Object.keys(op.skills).length > 0);

    requirements.forEach(function (req) {
        var level = Number(op.skills[req.targetId] || 0);
        var cert = certByTarget[req.targetId];
        var hasValidCert = !!(cert && cert.expiresAt && cert.expiresAt > now);
        var certExpired = !!(cert && cert.expiresAt && cert.expiresAt <= now);

        // Determine gap class
        var gapStatus = null;
        var gapPenalty = 0;

        if (req.requiresCertification && !cert) {
            gapStatus = 'UNCERTIFIED';
            gapPenalty = 18 * (req.criticality / 3);
        } else if (req.requiresCertification && certExpired) {
            gapStatus = 'CERT_EXPIRED';
            gapPenalty = 22 * (req.criticality / 3);
        } else if (level === 0) {
            gapStatus = 'UNTRAINED';
            gapPenalty = 14 * (req.criticality / 3);
        } else if (level < req.minLevel) {
            gapStatus = 'BELOW_MIN_LEVEL';
            gapPenalty = 8 * (req.criticality / 3) * (req.minLevel - level);
        }

        // Failure rate signal on this target
        var runStats = runsByTarget[req.targetId];
        var failRate = 0;
        if (runStats && runStats.total >= 3) {
            failRate = runStats.failed / runStats.total;
            if (failRate >= 0.30) {
                gapPenalty += 12 * (req.criticality / 3);
                if (!gapStatus) gapStatus = 'HIGH_FAILURE_RATE';
            } else if (failRate >= 0.15) {
                gapPenalty += 5;
            }
            if (failRate > topFailRate) {
                topFailRate = failRate;
                topFailedTarget = { targetId: req.targetId, label: req.label, failRate: failRate };
            }
        }

        if (gapStatus) {
            gaps.push({
                targetId: req.targetId,
                label: req.label,
                kind: req.kind,
                status: gapStatus,
                level: level,
                minLevel: req.minLevel,
                criticality: req.criticality,
                failRate: failRate,
                hasValidCertification: hasValidCert
            });
            totalPenalty += gapPenalty;
            if (gapPenalty > maxComponentPenalty) maxComponentPenalty = gapPenalty;
        }
    });

    // Expiring cert penalties
    expiringCerts.forEach(function (e) {
        var pen = e.status === 'EXPIRED' ? 18 : 8;
        totalPenalty += pen;
        if (pen > maxComponentPenalty) maxComponentPenalty = pen;
    });

    // Stale-training nudge: tech with 0 training hours in quarter and any gap
    if (gaps.length > 0 && op.trainingHoursLastQuarter === 0) {
        totalPenalty += 5;
        reasons.push('NO_RECENT_TRAINING');
    }

    // Overall operator-error rate across all runs
    if (op.runs.length >= 5) {
        var opErrorTotal = 0, runTotal = op.runs.length;
        op.runs.forEach(function (r) { if (r.operatorErrorBlamed) opErrorTotal++; });
        var opErrRate = opErrorTotal / runTotal;
        if (opErrRate >= 0.20) {
            totalPenalty += 20;
            maxComponentPenalty = Math.max(maxComponentPenalty, 20);
            reasons.push('HIGH_OPERATOR_ERROR_RATE');
        } else if (opErrRate >= 0.10) {
            totalPenalty += 8;
            reasons.push('ELEVATED_OPERATOR_ERROR_RATE');
        }
    }

    // Apply risk appetite
    totalPenalty *= mult;
    maxComponentPenalty *= mult;

    // Score = 100 - (max + 0.4*min(rest, 60))
    var rest = Math.min(60, totalPenalty - maxComponentPenalty);
    var rawScore = 100 - (maxComponentPenalty + 0.4 * rest);
    var score = clamp(Math.round(rawScore), 0, 100);

    // Verdict ladder
    var verdict, priority;
    var hasExpired = expiringCerts.some(function (e) { return e.status === 'EXPIRED'; });
    var hasCriticalGap = gaps.some(function (g) {
        return g.criticality >= 4 && (g.status === 'UNCERTIFIED' || g.status === 'CERT_EXPIRED' || g.status === 'UNTRAINED');
    });
    var hasHighFailure = gaps.some(function (g) { return g.status === 'HIGH_FAILURE_RATE'; });

    if (!hasAnyData) {
        verdict = V.INSUFFICIENT_DATA;
        priority = 'P2';
        reasons.push('NO_HISTORY');
    } else if (hasExpired) {
        verdict = V.NEEDS_RECERTIFICATION;
        priority = 'P0';
        reasons.push('CERT_EXPIRED');
    } else if (hasCriticalGap) {
        verdict = V.NEEDS_TRAINING;
        priority = 'P0';
        reasons.push('CRITICAL_GAP');
    } else if (hasHighFailure) {
        verdict = V.NEEDS_SUPERVISION;
        priority = 'P1';
        reasons.push('FAILURE_PATTERN');
    } else if (score < 55) {
        verdict = V.COACHING_RECOMMENDED;
        priority = 'P1';
    } else if (gaps.length > 0 || expiringCerts.length > 0) {
        verdict = V.COACHING_RECOMMENDED;
        priority = 'P2';
    } else if (op.role === 'senior_tech' || op.role === 'pi' || score >= 90) {
        verdict = V.READY_TO_MENTOR;
        priority = 'P3';
    } else {
        verdict = V.COMPETENT;
        priority = 'P3';
    }

    var supervision = 'NONE';
    if (verdict === V.NEEDS_TRAINING || verdict === V.NEEDS_RECERTIFICATION) supervision = 'DIRECT';
    else if (verdict === V.NEEDS_SUPERVISION || verdict === V.COACHING_RECOMMENDED) supervision = 'BUDDY';

    return {
        id: op.id,
        name: op.name,
        role: op.role,
        score: score,
        grade: gradeFromScore(score),
        verdict: verdict,
        priority: priority,
        reasons: reasons,
        gaps: gaps,
        expiringCerts: expiringCerts,
        topFailedTarget: topFailedTarget,
        supervisionRecommendation: supervision
    };
}

function deriveBenchDepth(operators, requirements, now) {
    var depth = {};
    requirements.forEach(function (r) { depth[r.targetId] = { req: r, certified: 0, trained: 0, operatorIds: [] }; });
    operators.forEach(function (op) {
        var certByTarget = {};
        op.certifications.forEach(function (c) {
            var key = c.equipmentId || c.protocolId;
            if (key) certByTarget[key] = c;
        });
        requirements.forEach(function (r) {
            var level = Number(op.skills[r.targetId] || 0);
            var cert = certByTarget[r.targetId];
            var hasValidCert = !!(cert && cert.expiresAt && cert.expiresAt > now);
            var meetsLevel = level >= r.minLevel;
            if (r.requiresCertification ? (hasValidCert && meetsLevel) : meetsLevel) {
                depth[r.targetId].certified += 1;
                depth[r.targetId].operatorIds.push(op.id);
            }
            if (level > 0) depth[r.targetId].trained += 1;
        });
    });
    return depth;
}

function buildPlaybook(perOperator, depth, opNameById, options) {
    var appetite = options.risk_appetite || 'balanced';
    var actions = [];
    var seen = {};
    function add(a) {
        if (seen[a.id]) return;
        seen[a.id] = true;
        actions.push(a);
    }

    // Recertification (P0)
    var recertOps = perOperator.filter(function (o) { return o.verdict === V.NEEDS_RECERTIFICATION; });
    if (recertOps.length) {
        add({
            id: 'SCHEDULE_RECERTIFICATION',
            priority: 'P0',
            label: 'Schedule recertification for expired-cert operators',
            reason: recertOps.length + ' operator(s) have at least one expired certification.',
            owner: 'training_lead',
            blastRadius: 3,
            reversibility: 'high',
            operatorIds: recertOps.map(function (o) { return o.id; })
        });
    }

    // Critical training gap (P0)
    var trainOps = perOperator.filter(function (o) { return o.verdict === V.NEEDS_TRAINING; });
    if (trainOps.length) {
        add({
            id: 'ASSIGN_DIRECT_TRAINING',
            priority: 'P0',
            label: 'Assign direct training for critical-gap operators',
            reason: trainOps.length + ' operator(s) have an untrained/uncertified critical-asset gap. Pair with a senior tech.',
            owner: 'lab_manager',
            blastRadius: 3,
            reversibility: 'high',
            operatorIds: trainOps.map(function (o) { return o.id; })
        });
    }

    // Bench-depth gaps
    var benchGaps = [];
    var untrained = [];
    Object.keys(depth).forEach(function (k) {
        var d = depth[k];
        if (d.certified === 0) untrained.push(k);
        else if (d.certified < d.req.minCertifiedHeads) benchGaps.push(k);
    });

    if (untrained.length) {
        add({
            id: 'CROSS_TRAIN_UNCERTIFIED_TARGETS',
            priority: 'P0',
            label: 'Cross-train operators on uncovered targets',
            reason: untrained.length + ' target(s) have zero certified operators: ' + untrained.slice(0, 5).join(', ') + '.',
            owner: 'lab_manager',
            blastRadius: 5,
            reversibility: 'medium',
            operatorIds: [],
            targetIds: untrained
        });
    }

    if (benchGaps.length) {
        add({
            id: 'EXPAND_BENCH_DEPTH',
            priority: 'P1',
            label: 'Expand bench depth for thinly-staffed targets',
            reason: benchGaps.length + ' target(s) below minimum certified-head count.',
            owner: 'lab_manager',
            blastRadius: 4,
            reversibility: 'medium',
            operatorIds: [],
            targetIds: benchGaps
        });
    }

    // Supervision (P1)
    var supervOps = perOperator.filter(function (o) { return o.verdict === V.NEEDS_SUPERVISION; });
    if (supervOps.length) {
        add({
            id: 'PAIR_FOR_SUPERVISION',
            priority: 'P1',
            label: 'Pair high-failure operators with a buddy',
            reason: supervOps.length + ' operator(s) show >=30% failure rate on a tracked target. Buddy-run next 5 sessions.',
            owner: 'shift_lead',
            blastRadius: 2,
            reversibility: 'high',
            operatorIds: supervOps.map(function (o) { return o.id; })
        });
    }

    // Coaching (P2)
    var coachOps = perOperator.filter(function (o) { return o.verdict === V.COACHING_RECOMMENDED; });
    if (coachOps.length) {
        add({
            id: 'SCHEDULE_COACHING',
            priority: 'P2',
            label: 'Schedule coaching session(s)',
            reason: coachOps.length + ' operator(s) have minor gaps or expiring certifications.',
            owner: 'training_lead',
            blastRadius: 2,
            reversibility: 'high',
            operatorIds: coachOps.map(function (o) { return o.id; })
        });
    }

    // Mentor utilisation
    var mentors = perOperator.filter(function (o) { return o.verdict === V.READY_TO_MENTOR; });
    if (mentors.length && (trainOps.length || benchGaps.length || untrained.length)) {
        add({
            id: 'DEPLOY_MENTORS_TO_GAPS',
            priority: 'P2',
            label: 'Deploy mentor-ready operators to cover gaps',
            reason: mentors.length + ' senior/expert operator(s) available to lead cross-training.',
            owner: 'lab_manager',
            blastRadius: 3,
            reversibility: 'high',
            operatorIds: mentors.map(function (o) { return o.id; })
        });
    }

    // Insufficient data
    var unknownOps = perOperator.filter(function (o) { return o.verdict === V.INSUFFICIENT_DATA; });
    if (unknownOps.length) {
        add({
            id: 'BACKFILL_OPERATOR_HISTORY',
            priority: 'P2',
            label: 'Backfill skill/run history for new operators',
            reason: unknownOps.length + ' operator(s) have no recorded skills, certs, or runs.',
            owner: 'data_steward',
            blastRadius: 1,
            reversibility: 'high',
            operatorIds: unknownOps.map(function (o) { return o.id; })
        });
    }

    // Cautious adds quarterly audit when grade <= C
    if (appetite === 'cautious') {
        add({
            id: 'SCHEDULE_COMPETENCY_AUDIT',
            priority: 'P2',
            label: 'Schedule quarterly competency audit',
            reason: 'Cautious mode: keep a recurring review to catch drift early.',
            owner: 'training_lead',
            blastRadius: 1,
            reversibility: 'high',
            operatorIds: []
        });
    }

    // Healthy fallback
    if (actions.length === 0) {
        add({
            id: 'MAINTAIN_COMPETENCY_PROGRAM',
            priority: 'P3',
            label: 'Maintain current competency program',
            reason: 'No notable gaps detected across the operator roster.',
            owner: 'training_lead',
            blastRadius: 1,
            reversibility: 'high',
            operatorIds: []
        });
    }

    // Aggressive trims lone P2 and P3 when P0/P1 present
    if (appetite === 'aggressive') {
        var hasP0orP1 = actions.some(function (a) { return a.priority === 'P0' || a.priority === 'P1'; });
        if (hasP0orP1) {
            actions = actions.filter(function (a) { return a.priority !== 'P3'; });
        }
    }

    // P0 first
    var rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
    actions.sort(function (a, b) {
        if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return actions;
}

function buildInsights(perOperator, depth) {
    var insights = [];
    if (perOperator.length === 0) {
        insights.push('EMPTY_ROSTER');
        return insights;
    }
    var hasExpired = perOperator.some(function (o) {
        return o.expiringCerts.some(function (e) { return e.status === 'EXPIRED'; });
    });
    if (hasExpired) insights.push('EXPIRED_CERTIFICATIONS_PRESENT');

    var critUnderTrained = 0;
    Object.keys(depth).forEach(function (k) {
        var d = depth[k];
        if (d.req.criticality >= 4 && d.certified === 0) critUnderTrained++;
    });
    if (critUnderTrained) insights.push('CRITICAL_TARGETS_UNCOVERED');

    var thin = 0;
    Object.keys(depth).forEach(function (k) {
        var d = depth[k];
        if (d.certified === 1) thin++;
    });
    if (thin >= 2) insights.push('SINGLE_OPERATOR_DEPENDENCIES');

    var mentors = perOperator.filter(function (o) { return o.verdict === V.READY_TO_MENTOR; }).length;
    if (mentors >= 1) insights.push('MENTOR_CAPACITY_AVAILABLE');

    var ratioTrained = perOperator.filter(function (o) { return o.verdict === V.COMPETENT || o.verdict === V.READY_TO_MENTOR; }).length / perOperator.length;
    if (ratioTrained >= 0.8) insights.push('STRONG_OVERALL_COMPETENCY');
    else if (ratioTrained <= 0.3) insights.push('TRAINING_DEBT_PORTFOLIO_WIDE');

    if (insights.length === 0) insights.push('NO_NOTABLE_SIGNALS');
    return insights;
}

function buildPortfolio(perOperator, depth) {
    var totalOps = perOperator.length;
    if (totalOps === 0) {
        return {
            grade: 'A',
            score: 100,
            totalOperators: 0,
            untrainedTargets: [],
            singleCertifiedTargets: [],
            expiringCertCount: 0
        };
    }
    var avg = perOperator.reduce(function (a, o) { return a + o.score; }, 0) / totalOps;
    var expCount = perOperator.reduce(function (a, o) { return a + o.expiringCerts.length; }, 0);
    var untrained = [];
    var single = [];
    Object.keys(depth).forEach(function (k) {
        var d = depth[k];
        if (d.certified === 0) untrained.push(k);
        else if (d.certified === 1) single.push(k);
    });

    // Portfolio grade: F if any critical target uncovered, else from avg score
    var critUncovered = Object.keys(depth).some(function (k) {
        return depth[k].req.criticality >= 4 && depth[k].certified === 0;
    });
    var grade = critUncovered ? 'F' : gradeFromScore(avg);

    return {
        grade: grade,
        score: Math.round(avg),
        totalOperators: totalOps,
        untrainedTargets: untrained,
        singleCertifiedTargets: single,
        expiringCertCount: expCount
    };
}

// ───── Renderers ─────────────────────────────────────────────────

function toText(report) {
    var lines = [];
    lines.push(report.headline);
    lines.push('');
    lines.push('Portfolio: grade=' + report.portfolio.grade + ' score=' + report.portfolio.score +
        ' operators=' + report.portfolio.totalOperators +
        ' expiring_certs=' + report.portfolio.expiringCertCount);
    lines.push('Untrained targets: ' + (report.portfolio.untrainedTargets.join(', ') || '(none)'));
    lines.push('Single-certified targets: ' + (report.portfolio.singleCertifiedTargets.join(', ') || '(none)'));
    lines.push('');
    lines.push('Operators:');
    report.perOperator.forEach(function (o) {
        lines.push('  - [' + o.priority + '] ' + o.name + ' (' + o.id + ') ' + o.verdict +
            ' score=' + o.score + ' grade=' + o.grade +
            (o.gaps.length ? ' gaps=' + o.gaps.length : '') +
            (o.expiringCerts.length ? ' expiring=' + o.expiringCerts.length : ''));
    });
    lines.push('');
    lines.push('Playbook:');
    report.playbook.forEach(function (a) {
        lines.push('  - [' + a.priority + '] ' + a.label + ' :: ' + a.reason);
    });
    lines.push('');
    lines.push('Insights: ' + report.insights.join(', '));
    return lines.join('\n');
}

function toMarkdown(report) {
    var out = [];
    out.push('# Operator Competency Report');
    out.push('');
    out.push(report.headline);
    out.push('');
    out.push('## Summary');
    out.push('');
    out.push('| Metric | Value |');
    out.push('| --- | --- |');
    out.push('| Grade | ' + report.portfolio.grade + ' |');
    out.push('| Score | ' + report.portfolio.score + ' |');
    out.push('| Operators | ' + report.portfolio.totalOperators + ' |');
    out.push('| Expiring certifications | ' + report.portfolio.expiringCertCount + ' |');
    out.push('| Untrained targets | ' + (report.portfolio.untrainedTargets.join(', ') || '_(none)_') + ' |');
    out.push('| Single-certified targets | ' + (report.portfolio.singleCertifiedTargets.join(', ') || '_(none)_') + ' |');
    out.push('');
    out.push('## Operators');
    out.push('');
    out.push('| ID | Name | Verdict | Priority | Score | Grade | Gaps | Expiring | Supervision |');
    out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    report.perOperator.forEach(function (o) {
        out.push('| ' + o.id + ' | ' + o.name + ' | ' + o.verdict + ' | ' + o.priority + ' | ' +
            o.score + ' | ' + o.grade + ' | ' + o.gaps.length + ' | ' + o.expiringCerts.length + ' | ' + o.supervisionRecommendation + ' |');
    });
    out.push('');
    out.push('## Playbook');
    out.push('');
    out.push('| Priority | Action | Owner | Blast | Reason |');
    out.push('| --- | --- | --- | --- | --- |');
    report.playbook.forEach(function (a) {
        out.push('| ' + a.priority + ' | ' + a.label + ' | ' + a.owner + ' | ' + a.blastRadius +
            ' | ' + a.reason.replace(/\|/g, '\\|') + ' |');
    });
    out.push('');
    out.push('## Insights');
    out.push('');
    report.insights.forEach(function (i) { out.push('- ' + i); });
    return out.join('\n');
}

function sortedJson(value) {
    function helper(v, seen) {
        if (v === null || typeof v !== 'object') return v;
        if (v instanceof Date) return v.toISOString();
        if (seen.has(v)) return null;
        seen.add(v);
        if (Array.isArray(v)) return v.map(function (x) { return helper(x, seen); });
        var out = {};
        Object.keys(v).sort().forEach(function (k) { out[k] = helper(v[k], seen); });
        return out;
    }
    return JSON.stringify(helper(value, new WeakSet()), null, 2);
}

function createOperatorCompetencyAdvisor(options) {
    options = options || {};
    var nowFn = typeof options.now === 'function' ? options.now : function () { return new Date(); };

    function analyze(operators, requirements, opts) {
        opts = opts || {};
        var nowVal = nowFn();
        if (!isDate(nowVal)) throw new Error('OperatorCompetencyAdvisor: now() returned invalid Date');
        var now = nowVal;

        var ops = deepCopyOperators(operators);
        var reqs = deepCopyRequirements(requirements);
        var opNameById = {};
        ops.forEach(function (o) { opNameById[o.id] = o.name; });

        var perOperator = ops.map(function (op) { return analyzeOperator(op, reqs, now, opts); });

        // Sort: priority asc, score asc (worst first), id asc
        var rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
        perOperator.sort(function (a, b) {
            if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
            if (a.score !== b.score) return a.score - b.score;
            return a.id < b.id ? -1 : 1;
        });

        var depth = deriveBenchDepth(ops, reqs, now);
        var portfolio = buildPortfolio(perOperator, depth);
        var playbook = buildPlaybook(perOperator, depth, opNameById, opts);
        var insights = buildInsights(perOperator, depth);

        var p0 = perOperator.filter(function (o) { return o.priority === 'P0'; }).length;
        var p1 = perOperator.filter(function (o) { return o.priority === 'P1'; }).length;
        var headline = 'VERDICT: grade=' + portfolio.grade + ' operators=' + portfolio.totalOperators +
            ' P0=' + p0 + ' P1=' + p1 + ' score=' + portfolio.score;

        return {
            generatedAt: now.toISOString(),
            headline: headline,
            portfolio: portfolio,
            perOperator: perOperator,
            playbook: playbook,
            insights: insights
        };
    }

    function format(report, kind) {
        kind = kind || 'text';
        if (kind === 'text') return toText(report);
        if (kind === 'md' || kind === 'markdown') return toMarkdown(report);
        if (kind === 'json') return sortedJson(report);
        throw new Error('OperatorCompetencyAdvisor: unknown format ' + kind);
    }

    return {
        analyze: analyze,
        format: format,
        formatText: function (r) { return toText(r); },
        formatMarkdown: function (r) { return toMarkdown(r); },
        formatJson: function (r) { return sortedJson(r); }
    };
}

module.exports = { createOperatorCompetencyAdvisor: createOperatorCompetencyAdvisor };
