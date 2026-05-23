'use strict';

/**
 * Reagent Lot Recall Readiness Advisor - agentic per-lot recall/traceability
 * readiness triage.
 *
 * Distinct from siblings:
 *   - supplierQualityScorecardAdvisor.js -> per-supplier triage across time
 *   - reagentSubstitutionAdvisor.js      -> mid-run "swap this lot"
 *   - contaminationPropagationAdvisor.js -> downstream from a *confirmed*
 *                                            contamination
 *   - smartReorder.js                    -> when/how-much to reorder
 *   - shelfLife.js                       -> expiry tracking
 *
 * This advisor answers a different question: **"If a recall notice
 * arrives today for any one of our in-use reagent lots, how fast and how
 * cleanly can we identify every affected downstream batch and pull it?"**
 * It surfaces per-lot documentation, chain-of-custody, storage, and
 * lineage gaps that would slow a real-world recall response.
 *
 * INPUTS
 *   evaluate({
 *     lots: [{
 *       id, reagent, supplierId?, lotNumber?,
 *       receivedAt, expiresAt?,
 *       qcStatus? ('pass'|'fail'|'pending'|'unknown'),
 *       coaOnFile? (bool),
 *       receivingInspectionAt? (Date|ISO),
 *       chainOfCustodyComplete? (bool),
 *       storageTempLogGapsHours? (number),
 *       storageExcursionCount? (number),
 *       inUse? (bool),
 *       criticality? (1..5, default 3),
 *       downstreamBatchIds? (string[]),
 *       lastUsedAt? (Date|ISO),
 *       supplierRecallHistory? (number)  // recalls from this supplier in last 12 mo
 *     }],
 *     openInvestigations?: [{ lotId, severity }],
 *     options: { riskAppetite }
 *   })
 *
 * OUTPUT
 *   perLot: [{ id, reagent, score 0..100, grade A-F, verdict, priority P0-P3,
 *              reasons[], suggestedAction, traceBreadth, recallHorizonHours,
 *              gaps[] }]
 *   portfolio: { score, grade, readyCount, gapCount, blindCount, totalLots,
 *                worstTraceBreadth, weightedRecallHorizonHours }
 *   playbook:  [{ id, priority, label, reason, owner, blastRadius, reversibility,
 *                 lotIds }]
 *   insights:  string[]
 *   headline:  string
 *
 * Pure CommonJS, zero deps, deterministic given injectable now(), never
 * mutates inputs (entry-by-entry deep frozen copy).
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var advisor = biobots.createReagentLotRecallReadinessAdvisor({
 *       now: function () { return new Date('2026-05-23T10:00:00Z'); }
 *   });
 *   var report = advisor.evaluate({
 *       lots: [
 *           { id: 'L-001', reagent: 'FBS', inUse: true, coaOnFile: true,
 *             chainOfCustodyComplete: true, downstreamBatchIds: ['B-1','B-2'],
 *             receivedAt: '2026-05-01T00:00:00Z', qcStatus: 'pass' }
 *       ]
 *   });
 *   console.log(report.headline);
 */

// ---- Verdict catalogue (worst -> best ordering matters) ----
var V = {
    TRACE_BLIND:         'TRACE_BLIND',          // no downstream batch list at all
    EXPIRED_IN_USE:      'EXPIRED_IN_USE',       // past expiry and still in use
    UNDER_INVESTIGATION: 'UNDER_INVESTIGATION',  // open recall/contamination probe
    DOCUMENTATION_GAP:   'DOCUMENTATION_GAP',    // missing COA / inspection / chain
    STORAGE_RISK:        'STORAGE_RISK',         // temp log gaps / excursions
    HIGH_SUPPLIER_RISK:  'HIGH_SUPPLIER_RISK',   // supplier with recent recall history
    RECALL_READY:        'RECALL_READY',         // fully documented, narrow blast
    OK:                  'OK',
    INSUFFICIENT_DATA:   'INSUFFICIENT_DATA'
};

var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

function priorityBand(verdict, score) {
    if (verdict === V.TRACE_BLIND) return 'P0';
    if (verdict === V.EXPIRED_IN_USE) return 'P0';
    if (verdict === V.UNDER_INVESTIGATION) return 'P0';
    if (verdict === V.DOCUMENTATION_GAP) return 'P1';
    if (verdict === V.STORAGE_RISK) return 'P1';
    if (verdict === V.HIGH_SUPPLIER_RISK) return 'P2';
    if (verdict === V.INSUFFICIENT_DATA) return 'P2';
    if (score < 60) return 'P2';
    return 'P3';
}

function gradeFromScore(score) {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function toDate(d) {
    if (d == null) return null;
    if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
    var parsed = new Date(d);
    return isNaN(parsed.getTime()) ? null : parsed;
}

function hoursBetween(a, b) {
    if (!a || !b) return null;
    return Math.round(((b.getTime() - a.getTime()) / 3600000) * 10) / 10;
}

// Shallow defensive copy of one lot (never mutates input)
function copyLot(l) {
    if (!l || typeof l !== 'object') return {};
    var copy = {
        id: l.id || l.lotNumber || '',
        reagent: l.reagent || 'unknown',
        supplierId: l.supplierId || null,
        lotNumber: l.lotNumber || null,
        receivedAt: l.receivedAt || null,
        expiresAt: l.expiresAt || null,
        qcStatus: l.qcStatus || 'unknown',
        coaOnFile: l.coaOnFile === true,
        receivingInspectionAt: l.receivingInspectionAt || null,
        chainOfCustodyComplete: l.chainOfCustodyComplete === true,
        storageTempLogGapsHours: typeof l.storageTempLogGapsHours === 'number' ? l.storageTempLogGapsHours : 0,
        storageExcursionCount: typeof l.storageExcursionCount === 'number' ? l.storageExcursionCount : 0,
        inUse: l.inUse !== false,  // default true
        criticality: clamp(typeof l.criticality === 'number' ? l.criticality : 3, 1, 5),
        downstreamBatchIds: Array.isArray(l.downstreamBatchIds) ? l.downstreamBatchIds.slice() : null,
        lastUsedAt: l.lastUsedAt || null,
        supplierRecallHistory: typeof l.supplierRecallHistory === 'number' ? l.supplierRecallHistory : 0
    };
    return copy;
}

// Estimate how long a real recall response would take for this lot.
// Pure heuristic: 0.5h baseline + 1h per missing-document + 2h if trace-blind
// + 0.5h per downstream batch (with cap) + 1h per storage excursion.
function estimateRecallHorizonHours(lot, gaps) {
    var h = 0.5;
    if (gaps.indexOf('NO_COA') >= 0) h += 1;
    if (gaps.indexOf('NO_INSPECTION') >= 0) h += 1;
    if (gaps.indexOf('CHAIN_BROKEN') >= 0) h += 1.5;
    if (gaps.indexOf('TRACE_BLIND') >= 0) h += 4;
    if (gaps.indexOf('STORAGE_EXCURSION') >= 0) h += 1;
    if (gaps.indexOf('STORAGE_LOG_GAP') >= 0) h += 0.5;
    var n = lot.downstreamBatchIds ? lot.downstreamBatchIds.length : 0;
    // pulling each batch from inventory takes time, but capped
    h += Math.min(n * 0.25, 6);
    return Math.round(h * 10) / 10;
}

function analyzeLot(lot, ctx) {
    var now = ctx.now;
    var openMap = ctx.openInvestigationsByLotId;

    var receivedAt = toDate(lot.receivedAt);
    var expiresAt = toDate(lot.expiresAt);
    var inspectAt = toDate(lot.receivingInspectionAt);
    var lastUsedAt = toDate(lot.lastUsedAt);

    var gaps = [];
    var reasons = [];

    // ---- Documentation gaps ----
    if (!lot.coaOnFile) { gaps.push('NO_COA'); reasons.push('NO_CERTIFICATE_OF_ANALYSIS'); }
    if (!inspectAt) { gaps.push('NO_INSPECTION'); reasons.push('NO_RECEIVING_INSPECTION'); }
    if (!lot.chainOfCustodyComplete) { gaps.push('CHAIN_BROKEN'); reasons.push('CHAIN_OF_CUSTODY_INCOMPLETE'); }

    // ---- Storage signals ----
    if (lot.storageTempLogGapsHours >= 4) { gaps.push('STORAGE_LOG_GAP'); reasons.push('STORAGE_TEMP_LOG_GAPS'); }
    if (lot.storageExcursionCount >= 1) { gaps.push('STORAGE_EXCURSION'); reasons.push('STORAGE_TEMP_EXCURSION'); }

    // ---- Lineage / trace ----
    var traceBreadth = lot.downstreamBatchIds ? lot.downstreamBatchIds.length : 0;
    var traceProvided = lot.downstreamBatchIds !== null;
    if (lot.inUse && !traceProvided) {
        gaps.push('TRACE_BLIND');
        reasons.push('NO_DOWNSTREAM_BATCH_LIST');
    }
    if (traceBreadth >= 10) reasons.push('WIDE_BLAST_RADIUS');

    // ---- Expiry ----
    var expiredInUse = false;
    if (expiresAt && expiresAt.getTime() < now.getTime() && lot.inUse) {
        expiredInUse = true;
        reasons.push('EXPIRED_BUT_IN_USE');
    }

    // ---- QC ----
    if (lot.qcStatus === 'fail') reasons.push('QC_FAILED');
    else if (lot.qcStatus === 'pending') reasons.push('QC_PENDING');
    else if (lot.qcStatus === 'unknown') reasons.push('QC_STATUS_UNKNOWN');

    // ---- Open investigations ----
    var underInvestigation = false;
    var investigationSeverity = null;
    if (openMap && Object.prototype.hasOwnProperty.call(openMap, lot.id)) {
        underInvestigation = true;
        investigationSeverity = openMap[lot.id];
        reasons.push('OPEN_INVESTIGATION');
    }

    // ---- Supplier ----
    if (lot.supplierRecallHistory >= 1) reasons.push('SUPPLIER_RECENT_RECALL');

    // ---- Score (start at 100, subtract penalties) ----
    var score = 100;
    if (!lot.coaOnFile) score -= 14;
    if (!inspectAt) score -= 10;
    if (!lot.chainOfCustodyComplete) score -= 16;
    if (lot.storageTempLogGapsHours >= 4) score -= 8;
    if (lot.storageTempLogGapsHours >= 12) score -= 6; // additional penalty for big gaps
    score -= clamp(lot.storageExcursionCount * 6, 0, 24);
    if (lot.inUse && !traceProvided) score -= 25;
    if (traceBreadth >= 10) score -= 8;
    if (traceBreadth >= 25) score -= 7; // very wide blast
    if (expiredInUse) score -= 20;
    if (lot.qcStatus === 'fail') score -= 30;
    else if (lot.qcStatus === 'pending') score -= 6;
    else if (lot.qcStatus === 'unknown') score -= 4;
    if (underInvestigation) score -= (investigationSeverity === 'critical' ? 30 : 15);
    if (lot.supplierRecallHistory >= 1) score -= 6;
    if (lot.supplierRecallHistory >= 3) score -= 6;

    // criticality amplifies any deficit (gap from 100), capped
    var crit = lot.criticality;
    if (crit >= 4 && score < 100) {
        var deficit = 100 - score;
        score = clamp(100 - Math.round(deficit * 1.15), 0, 100);
    }

    score = clamp(Math.round(score), 0, 100);

    // ---- Insufficient data check ----
    var hasAnySignal = lot.coaOnFile || inspectAt || lot.chainOfCustodyComplete ||
        traceProvided || lot.qcStatus !== 'unknown' || lot.storageExcursionCount > 0 ||
        lot.storageTempLogGapsHours > 0 || expiresAt || receivedAt;
    var insufficient = !hasAnySignal && !underInvestigation;

    // ---- Verdict ladder ----
    var verdict;
    var suggestedAction;
    if (insufficient) {
        verdict = V.INSUFFICIENT_DATA;
        suggestedAction = 'BACKFILL_LOT_METADATA';
    } else if (lot.inUse && !traceProvided) {
        verdict = V.TRACE_BLIND;
        suggestedAction = 'REBUILD_DOWNSTREAM_BATCH_LIST_NOW';
    } else if (expiredInUse) {
        verdict = V.EXPIRED_IN_USE;
        suggestedAction = 'QUARANTINE_LOT_AND_AFFECTED_BATCHES';
    } else if (underInvestigation) {
        verdict = V.UNDER_INVESTIGATION;
        suggestedAction = 'HOLD_LOT_PENDING_INVESTIGATION';
    } else if (!lot.coaOnFile || !lot.chainOfCustodyComplete || !inspectAt) {
        verdict = V.DOCUMENTATION_GAP;
        suggestedAction = 'BACKFILL_MISSING_DOCUMENTS';
    } else if (lot.storageExcursionCount >= 1 || lot.storageTempLogGapsHours >= 4) {
        verdict = V.STORAGE_RISK;
        suggestedAction = 'REVIEW_STORAGE_RECORDS_AND_ASSESS_IMPACT';
    } else if (lot.supplierRecallHistory >= 2) {
        verdict = V.HIGH_SUPPLIER_RISK;
        suggestedAction = 'INCREASE_INCOMING_INSPECTION_RIGOR';
    } else if (score >= 85 && traceProvided && lot.qcStatus === 'pass') {
        verdict = V.RECALL_READY;
        suggestedAction = 'MAINTAIN_RECORDS';
    } else {
        verdict = V.OK;
        suggestedAction = 'CONTINUE_STANDARD_USAGE';
    }

    var recallHorizonHours = estimateRecallHorizonHours(lot, gaps);
    var priority = priorityBand(verdict, score);

    return {
        id: lot.id || 'unknown',
        reagent: lot.reagent,
        supplierId: lot.supplierId,
        criticality: lot.criticality,
        inUse: lot.inUse,
        score: score,
        grade: gradeFromScore(score),
        verdict: verdict,
        priority: priority,
        reasons: reasons.slice(),
        gaps: gaps.slice(),
        traceBreadth: traceBreadth,
        recallHorizonHours: recallHorizonHours,
        suggestedAction: suggestedAction,
        ageDays: receivedAt ? Math.round(hoursBetween(receivedAt, now) / 24 * 10) / 10 : null,
        daysUntilExpiry: expiresAt
            ? Math.round(hoursBetween(now, expiresAt) / 24 * 10) / 10
            : null,
        lastUsedDaysAgo: lastUsedAt
            ? Math.round(hoursBetween(lastUsedAt, now) / 24 * 10) / 10
            : null
    };
}

function buildPlaybook(perLot) {
    var actions = [];
    var blind = perLot.filter(function (l) { return l.verdict === V.TRACE_BLIND; });
    var expired = perLot.filter(function (l) { return l.verdict === V.EXPIRED_IN_USE; });
    var investig = perLot.filter(function (l) { return l.verdict === V.UNDER_INVESTIGATION; });
    var docGap = perLot.filter(function (l) { return l.verdict === V.DOCUMENTATION_GAP; });
    var storage = perLot.filter(function (l) { return l.verdict === V.STORAGE_RISK; });
    var supplier = perLot.filter(function (l) { return l.verdict === V.HIGH_SUPPLIER_RISK; });
    var insuff = perLot.filter(function (l) { return l.verdict === V.INSUFFICIENT_DATA; });

    if (blind.length) {
        actions.push({
            id: 'REBUILD_DOWNSTREAM_BATCH_LIST',
            priority: 'P0',
            label: 'Reconstruct downstream batch list for trace-blind in-use lots',
            reason: blind.length + ' in-use lot(s) have no downstream batch list; a recall would be untraceable',
            owner: 'qa',
            blastRadius: 4,
            reversibility: 'high',
            lotIds: blind.map(function (l) { return l.id; })
        });
    }
    if (expired.length) {
        actions.push({
            id: 'QUARANTINE_EXPIRED_IN_USE_LOTS',
            priority: 'P0',
            label: 'Quarantine expired lots still tagged as in-use',
            reason: expired.length + ' lot(s) past expiry but flagged in-use',
            owner: 'qa',
            blastRadius: 3,
            reversibility: 'medium',
            lotIds: expired.map(function (l) { return l.id; })
        });
    }
    if (investig.length) {
        actions.push({
            id: 'HOLD_LOTS_UNDER_INVESTIGATION',
            priority: 'P0',
            label: 'Place lots under open recall/contamination investigation on hold',
            reason: investig.length + ' lot(s) referenced by open investigation',
            owner: 'qa_director',
            blastRadius: 4,
            reversibility: 'high',
            lotIds: investig.map(function (l) { return l.id; })
        });
    }
    if (docGap.length) {
        actions.push({
            id: 'BACKFILL_MISSING_DOCUMENTATION',
            priority: 'P1',
            label: 'Backfill missing COA / receiving inspection / chain-of-custody documents',
            reason: docGap.length + ' lot(s) missing one or more recall-critical documents',
            owner: 'procurement_qa',
            blastRadius: 2,
            reversibility: 'high',
            lotIds: docGap.map(function (l) { return l.id; })
        });
    }
    if (storage.length) {
        actions.push({
            id: 'REVIEW_STORAGE_INTEGRITY',
            priority: 'P1',
            label: 'Review storage temperature logs and assess product impact',
            reason: storage.length + ' lot(s) with storage gaps or excursions',
            owner: 'metrology',
            blastRadius: 3,
            reversibility: 'high',
            lotIds: storage.map(function (l) { return l.id; })
        });
    }
    if (supplier.length) {
        actions.push({
            id: 'INCREASE_INSPECTION_FOR_HIGH_RISK_SUPPLIERS',
            priority: 'P2',
            label: 'Increase incoming-inspection rigor for high-recall-history suppliers',
            reason: supplier.length + ' lot(s) come from suppliers with recent recall history',
            owner: 'incoming_qa',
            blastRadius: 2,
            reversibility: 'high',
            lotIds: supplier.map(function (l) { return l.id; })
        });
    }
    if (insuff.length) {
        actions.push({
            id: 'BACKFILL_LOT_METADATA',
            priority: 'P2',
            label: 'Backfill missing lot metadata (receipt date, QC status, supplier)',
            reason: insuff.length + ' lot(s) lack baseline metadata for any scoring signal',
            owner: 'procurement_qa',
            blastRadius: 1,
            reversibility: 'high',
            lotIds: insuff.map(function (l) { return l.id; })
        });
    }

    // Drill: only fires when portfolio is mostly healthy and you want to keep it that way.
    var p0p1 = actions.filter(function (a) { return a.priority === 'P0' || a.priority === 'P1'; }).length;
    if (p0p1 === 0 && perLot.length >= 3) {
        actions.push({
            id: 'SCHEDULE_RECALL_DRILL',
            priority: 'P3',
            label: 'Schedule a quarterly recall drill using current lot metadata',
            reason: 'Portfolio is recall-ready; maintain readiness with rehearsal',
            owner: 'qa',
            blastRadius: 1,
            reversibility: 'high',
            lotIds: []
        });
    }

    // Deterministic ordering: priority asc, id asc
    actions.sort(function (a, b) {
        var pa = PRIORITY_RANK[a.priority], pb = PRIORITY_RANK[b.priority];
        if (pa !== pb) return pa - pb;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return actions;
}

function deriveInsights(perLot, portfolio) {
    var ins = [];
    if (perLot.length === 0) {
        ins.push('NO_LOTS_PROVIDED');
        return ins;
    }
    if (portfolio.blindCount > 0) ins.push('TRACE_BLIND_LOTS_PRESENT');
    if (portfolio.expiredInUseCount > 0) ins.push('EXPIRED_LOTS_STILL_IN_USE');
    if (portfolio.investigationCount > 0) ins.push('OPEN_INVESTIGATION_HOLDS');

    var docGap = perLot.filter(function (l) { return l.verdict === V.DOCUMENTATION_GAP; }).length;
    if (docGap >= Math.max(2, Math.ceil(perLot.length * 0.25))) {
        ins.push('SYSTEMIC_DOCUMENTATION_GAPS');
    }
    var storage = perLot.filter(function (l) { return l.verdict === V.STORAGE_RISK; }).length;
    if (storage >= 2) ins.push('STORAGE_CHAIN_DEGRADED');

    var wideTrace = perLot.filter(function (l) { return l.traceBreadth >= 10; }).length;
    if (wideTrace >= 1) ins.push('WIDE_BLAST_RADIUS_LOTS');

    var critGap = perLot.filter(function (l) {
        return l.criticality >= 4 && (l.priority === 'P0' || l.priority === 'P1');
    }).length;
    if (critGap > 0) ins.push('CRITICAL_REAGENT_GAPS');

    if (portfolio.readyCount === perLot.length && perLot.length >= 3) {
        ins.push('FULLY_RECALL_READY');
    }
    return ins;
}

// ---- Renderers ----
function fmtPct(n) { return (Math.round(n * 1000) / 10).toFixed(1) + '%'; }

function renderText(report) {
    var lines = [];
    lines.push(report.headline);
    lines.push('');
    lines.push('Portfolio: score=' + report.portfolio.score + ' grade=' + report.portfolio.grade +
        ' ready=' + report.portfolio.readyCount + '/' + report.portfolio.totalLots +
        ' weightedRecallHorizon=' + report.portfolio.weightedRecallHorizonHours + 'h' +
        ' worstTraceBreadth=' + report.portfolio.worstTraceBreadth);
    lines.push('');
    lines.push('Lots (priority sorted):');
    report.perLot.forEach(function (l) {
        lines.push('  [' + l.priority + '] ' + l.id + ' (' + l.reagent + ') ' +
            l.verdict + ' score=' + l.score + ' grade=' + l.grade +
            ' trace=' + l.traceBreadth + ' recallHorizon=' + l.recallHorizonHours + 'h');
        if (l.reasons.length) lines.push('         reasons: ' + l.reasons.join(', '));
        lines.push('         -> ' + l.suggestedAction);
    });
    lines.push('');
    lines.push('Playbook:');
    if (report.playbook.length === 0) lines.push('  (no actions)');
    report.playbook.forEach(function (a) {
        lines.push('  [' + a.priority + '] ' + a.label + ' (' + a.owner + ', blast=' + a.blastRadius + ')');
        lines.push('         ' + a.reason);
    });
    lines.push('');
    lines.push('Insights: ' + (report.insights.length ? report.insights.join(', ') : '(none)'));
    return lines.join('\n');
}

function escMd(s) { return String(s).replace(/\|/g, '\\|'); }

function renderMarkdown(report) {
    var out = [];
    out.push('# Reagent Lot Recall Readiness');
    out.push('');
    out.push('**' + report.headline + '**');
    out.push('');
    out.push('## Portfolio');
    out.push('');
    out.push('| Metric | Value |');
    out.push('|---|---|');
    out.push('| Score | ' + report.portfolio.score + ' (' + report.portfolio.grade + ') |');
    out.push('| Total lots | ' + report.portfolio.totalLots + ' |');
    out.push('| Recall-ready | ' + report.portfolio.readyCount + ' |');
    out.push('| Trace-blind | ' + report.portfolio.blindCount + ' |');
    out.push('| Doc / storage gaps | ' + report.portfolio.gapCount + ' |');
    out.push('| Expired in use | ' + report.portfolio.expiredInUseCount + ' |');
    out.push('| Under investigation | ' + report.portfolio.investigationCount + ' |');
    out.push('| Worst trace breadth | ' + report.portfolio.worstTraceBreadth + ' batches |');
    out.push('| Weighted recall horizon | ' + report.portfolio.weightedRecallHorizonHours + ' h |');
    out.push('');
    out.push('## Lots');
    out.push('');
    out.push('| Priority | Lot | Reagent | Verdict | Score | Trace breadth | Recall horizon | Suggested action |');
    out.push('|---|---|---|---|---|---|---|---|');
    report.perLot.forEach(function (l) {
        out.push('| ' + l.priority + ' | ' + escMd(l.id) + ' | ' + escMd(l.reagent) + ' | ' +
            l.verdict + ' | ' + l.score + ' (' + l.grade + ') | ' + l.traceBreadth +
            ' | ' + l.recallHorizonHours + 'h | ' + l.suggestedAction + ' |');
    });
    out.push('');
    out.push('## Playbook');
    out.push('');
    if (report.playbook.length === 0) {
        out.push('_No actions required._');
    } else {
        out.push('| Priority | Action | Owner | Blast | Lots |');
        out.push('|---|---|---|---|---|');
        report.playbook.forEach(function (a) {
            out.push('| ' + a.priority + ' | ' + escMd(a.label) + ' | ' + a.owner +
                ' | ' + a.blastRadius + ' | ' + (a.lotIds.length ? a.lotIds.join(', ') : '-') + ' |');
        });
    }
    out.push('');
    out.push('## Insights');
    out.push('');
    if (report.insights.length === 0) out.push('_None._');
    else report.insights.forEach(function (i) { out.push('- ' + i); });
    return out.join('\n');
}

// Byte-stable JSON: sorted keys, 2-space indent.
function stableStringify(value) {
    function sorted(v) {
        if (v === null || typeof v !== 'object') return v;
        if (Array.isArray(v)) return v.map(sorted);
        var keys = Object.keys(v).sort();
        var out = {};
        for (var i = 0; i < keys.length; i++) out[keys[i]] = sorted(v[keys[i]]);
        return out;
    }
    return JSON.stringify(sorted(value), null, 2);
}

function buildHeadline(portfolio) {
    if (portfolio.totalLots === 0) return 'No lots to assess';
    var verdict;
    if (portfolio.blindCount > 0 || portfolio.expiredInUseCount > 0 || portfolio.investigationCount > 0) {
        verdict = 'RECALL_RISK';
    } else if (portfolio.grade === 'A' && portfolio.gapCount === 0) {
        verdict = 'RECALL_READY';
    } else if (portfolio.grade === 'B' || portfolio.grade === 'C') {
        verdict = 'GAPS_TO_CLOSE';
    } else {
        verdict = 'NOT_RECALL_READY';
    }
    return verdict + ': ' + portfolio.readyCount + '/' + portfolio.totalLots +
        ' lots recall-ready, weighted response horizon ' +
        portfolio.weightedRecallHorizonHours + 'h';
}

// ---- Public factory ----
function createReagentLotRecallReadinessAdvisor(opts) {
    opts = opts || {};
    var nowFn = typeof opts.now === 'function' ? opts.now : function () { return new Date(); };

    function evaluate(input) {
        var now = nowFn();
        if (!(now instanceof Date) || isNaN(now.getTime())) throw new Error('invalid now()');
        input = input || {};
        var appetite = (input.options && input.options.riskAppetite) || opts.riskAppetite || 'balanced';
        if (appetite !== 'cautious' && appetite !== 'balanced' && appetite !== 'aggressive') {
            appetite = 'balanced';
        }

        var lotsIn = Array.isArray(input.lots) ? input.lots :
            (Array.isArray(input) ? input : []);

        // Build investigations map (deep copy keys/values only)
        var openMap = {};
        var openList = Array.isArray(input.openInvestigations) ? input.openInvestigations : [];
        for (var i = 0; i < openList.length; i++) {
            var rec = openList[i];
            if (rec && rec.lotId) openMap[rec.lotId] = rec.severity || 'high';
        }

        var ctx = { now: now, openInvestigationsByLotId: openMap };

        var perLot = lotsIn.map(copyLot).map(function (l) {
            var rec = analyzeLot(l, ctx);
            // Appetite shift: cautious -4, aggressive +4
            if (appetite === 'cautious') rec.score = clamp(rec.score - 4, 0, 100);
            else if (appetite === 'aggressive') rec.score = clamp(rec.score + 4, 0, 100);
            rec.grade = gradeFromScore(rec.score);
            // Recompute priority after shaping
            rec.priority = priorityBand(rec.verdict, rec.score);
            return rec;
        });

        // Sort: priority asc, score asc (worst first), id asc
        perLot.sort(function (a, b) {
            var pa = PRIORITY_RANK[a.priority], pb = PRIORITY_RANK[b.priority];
            if (pa !== pb) return pa - pb;
            if (a.score !== b.score) return a.score - b.score;
            return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
        });

        // Portfolio summary
        var readyCount = 0, gapCount = 0, blindCount = 0,
            expiredInUseCount = 0, investigationCount = 0;
        var totalWeight = 0, weightedScoreSum = 0, weightedHorizonSum = 0;
        var worstTrace = 0;
        for (var j = 0; j < perLot.length; j++) {
            var l = perLot[j];
            if (l.verdict === V.RECALL_READY || l.verdict === V.OK) readyCount++;
            if (l.verdict === V.DOCUMENTATION_GAP || l.verdict === V.STORAGE_RISK) gapCount++;
            if (l.verdict === V.TRACE_BLIND) blindCount++;
            if (l.verdict === V.EXPIRED_IN_USE) expiredInUseCount++;
            if (l.verdict === V.UNDER_INVESTIGATION) investigationCount++;
            var w = l.criticality || 3;
            totalWeight += w;
            weightedScoreSum += l.score * w;
            weightedHorizonSum += l.recallHorizonHours * w;
            if (l.traceBreadth > worstTrace) worstTrace = l.traceBreadth;
        }

        var portfolioScore = totalWeight > 0 ? Math.round(weightedScoreSum / totalWeight) : 0;
        // Penalize portfolio for show-stoppers
        portfolioScore -= blindCount * 10;
        portfolioScore -= expiredInUseCount * 8;
        portfolioScore -= investigationCount * 6;
        portfolioScore = clamp(Math.round(portfolioScore), 0, 100);

        var portfolioGrade = gradeFromScore(portfolioScore);
        // Force grade floor when any P0 condition exists
        if (blindCount > 0 || expiredInUseCount > 0 || investigationCount > 0) {
            if (portfolioGrade === 'A' || portfolioGrade === 'B') portfolioGrade = 'C';
        }

        var weightedRecallHorizon = totalWeight > 0
            ? Math.round((weightedHorizonSum / totalWeight) * 10) / 10
            : 0;

        var portfolio = {
            totalLots: perLot.length,
            score: portfolioScore,
            grade: portfolioGrade,
            readyCount: readyCount,
            gapCount: gapCount,
            blindCount: blindCount,
            expiredInUseCount: expiredInUseCount,
            investigationCount: investigationCount,
            worstTraceBreadth: worstTrace,
            weightedRecallHorizonHours: weightedRecallHorizon,
            riskAppetite: appetite
        };

        var playbook = buildPlaybook(perLot);
        var insights = deriveInsights(perLot, portfolio);

        var report = {
            generatedAt: now.toISOString(),
            perLot: perLot,
            portfolio: portfolio,
            playbook: playbook,
            insights: insights,
            headline: buildHeadline(portfolio)
        };
        return report;
    }

    function format(report, kind) {
        kind = kind || 'text';
        if (kind === 'text') return renderText(report);
        if (kind === 'md' || kind === 'markdown') return renderMarkdown(report);
        if (kind === 'json') return stableStringify(report);
        throw new Error('unknown format: ' + kind);
    }

    return {
        evaluate: evaluate,
        format: format,
        _verdicts: V
    };
}

module.exports = createReagentLotRecallReadinessAdvisor;
module.exports.createReagentLotRecallReadinessAdvisor = createReagentLotRecallReadinessAdvisor;
