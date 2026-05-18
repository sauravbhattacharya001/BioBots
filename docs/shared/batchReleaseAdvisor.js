'use strict';

/**
 * Batch Release Advisor — agentic per-batch final-disposition advisor.
 *
 * Sibling to ShiftHandoffSynthesizer (carryover triage), ReagentSubstitutionAdvisor
 * (substitution), PerishableWasteForecaster (waste) and SmartReorderAdvisor (reorder).
 * Where those modules look forward across the lab, this one focuses on a single
 * completed bioprint batch and answers: do we RELEASE it, hold it, rework it, or
 * destroy it — and why?
 *
 * Input is a plain BatchRecord describing the print run plus any combination of
 * optional QC evidence (print quality score, environmental excursions during the
 * run, protocol deviations, sterility / mycoplasma test results, post-print
 * viability, lineage links and intended end-use). Output is a deterministic
 * disposition report with a verdict, 0–100 release score, A–F grade, ranked
 * structured reasons, P0/P1/P2 playbook (with owner / blast radius / reversibility),
 * cross-signal insights, and text / markdown / json renderers.
 *
 * Verdict ladder (highest match wins):
 *   - REJECT_DESTROY         — fatal signals (contamination_positive, sterility_failed)
 *   - QUARANTINE_HOLD        — high risk pending review (mycoplasma pending +
 *                              implant_or_in_vivo intent / failed protocol step /
 *                              critical environmental excursion / severe deviation /
 *                              score < quarantineThreshold)
 *   - REWORK                 — recoverable failure (print quality < reworkThreshold
 *                              AND no fatal signal, OR viability low but salvageable)
 *   - RELEASE_WITH_NOTE      — minor issues that don't block release (downgraded
 *                              from RELEASE when minor reasons present)
 *   - RELEASE                — clean
 *
 * Pure JS, zero deps, deterministic given an injected now(), never mutates inputs.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var advisor = biobots.createBatchReleaseAdvisor({
 *       now: function () { return new Date('2026-05-17T19:00:00Z'); }
 *   });
 *   var report = advisor.evaluate({
 *       batchId: 'B-2026-0517-A',
 *       intendedUse: 'research',
 *       printQualityScore: 88,
 *       environmentalExcursions: [{ severity: 'low', durationMin: 4 }],
 *       deviations: [],
 *       sterilityTest: { status: 'passed' },
 *       viability: { percent: 92 },
 *   });
 *   console.log(advisor.formatMarkdown(report));
 */

var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
var RISK_APPETITES = { cautious: 'cautious', balanced: 'balanced', aggressive: 'aggressive' };

var VERDICTS = {
    RELEASE: 'RELEASE',
    RELEASE_WITH_NOTE: 'RELEASE_WITH_NOTE',
    REWORK: 'REWORK',
    QUARANTINE_HOLD: 'QUARANTINE_HOLD',
    REJECT_DESTROY: 'REJECT_DESTROY',
};

var INTENDED_USE = {
    research: { riskMultiplier: 1.0, criticalIntent: false },
    in_vitro: { riskMultiplier: 1.1, criticalIntent: false },
    pre_clinical: { riskMultiplier: 1.25, criticalIntent: true },
    implant: { riskMultiplier: 1.5, criticalIntent: true },
    in_vivo: { riskMultiplier: 1.5, criticalIntent: true },
    teaching: { riskMultiplier: 0.85, criticalIntent: false },
};

function _isFiniteNum(n) { return typeof n === 'number' && isFinite(n); }

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _sevWeight(sev) {
    sev = String(sev || 'low').toLowerCase();
    if (sev === 'critical') return 35;
    if (sev === 'high') return 20;
    if (sev === 'medium') return 10;
    if (sev === 'low') return 4;
    return 2;
}

function _appetiteShift(appetite) {
    if (appetite === RISK_APPETITES.cautious) return 8;
    if (appetite === RISK_APPETITES.aggressive) return -8;
    return 0;
}

function _gradeFromScore(score, hardF) {
    if (hardF) return 'F';
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 65) return 'C';
    if (score >= 50) return 'D';
    return 'F';
}

function _coerceDate(d, fallback) {
    if (!d) return fallback;
    var t;
    if (d instanceof Date) t = d.getTime();
    else if (typeof d === 'string' || typeof d === 'number') t = new Date(d).getTime();
    else return fallback;
    return isFinite(t) ? new Date(t) : fallback;
}

// ── Reasons catalogue ────────────────────────────────────────────
// Each reason: { code, severity (0–100 contribution), label, blocking? }

function _detectReasons(batch, ctx) {
    var out = [];
    var intent = INTENDED_USE[batch.intendedUse] || INTENDED_USE.research;

    // Fatal contamination / sterility signals — always block.
    if (batch.contaminationDetected === true ||
        (batch.contaminationTest && String(batch.contaminationTest.status).toLowerCase() === 'positive')) {
        out.push({ code: 'CONTAMINATION_POSITIVE', severity: 100, label: 'Contamination confirmed in batch', blocking: 'destroy' });
    }
    if (batch.sterilityTest && String(batch.sterilityTest.status).toLowerCase() === 'failed') {
        out.push({ code: 'STERILITY_FAILED', severity: 100, label: 'Sterility test failed', blocking: 'destroy' });
    }
    if (batch.mycoplasmaTest) {
        var ms = String(batch.mycoplasmaTest.status).toLowerCase();
        if (ms === 'positive') {
            out.push({ code: 'MYCOPLASMA_POSITIVE', severity: 100, label: 'Mycoplasma test positive', blocking: 'destroy' });
        } else if (ms === 'pending' && intent.criticalIntent) {
            out.push({ code: 'MYCOPLASMA_PENDING_CRITICAL_USE', severity: 70, label: 'Mycoplasma result pending for critical-use batch', blocking: 'hold' });
        } else if (ms === 'pending') {
            out.push({ code: 'MYCOPLASMA_PENDING', severity: 25, label: 'Mycoplasma result pending' });
        }
    } else if (intent.criticalIntent) {
        out.push({ code: 'MYCOPLASMA_MISSING_CRITICAL_USE', severity: 55, label: 'No mycoplasma test recorded for critical-use batch', blocking: 'hold' });
    }

    // Print quality
    if (_isFiniteNum(batch.printQualityScore)) {
        var pq = batch.printQualityScore;
        if (pq < 40) out.push({ code: 'PRINT_QUALITY_FAILED', severity: 60, label: 'Print quality below failure threshold (' + pq + ')', blocking: 'rework' });
        else if (pq < ctx.reworkThreshold) out.push({ code: 'PRINT_QUALITY_LOW', severity: 35, label: 'Print quality below rework threshold (' + pq + ')', blocking: 'rework' });
        else if (pq < 75) out.push({ code: 'PRINT_QUALITY_MARGINAL', severity: 12, label: 'Print quality marginal (' + pq + ')' });
    } else {
        out.push({ code: 'PRINT_QUALITY_MISSING', severity: 18, label: 'Print quality score not recorded' });
    }

    // Environmental excursions during the print
    var excursions = Array.isArray(batch.environmentalExcursions) ? batch.environmentalExcursions : [];
    var critEx = 0, highEx = 0, medEx = 0, lowEx = 0;
    excursions.forEach(function (e) {
        var sev = String(e && e.severity || 'low').toLowerCase();
        if (sev === 'critical') critEx++;
        else if (sev === 'high') highEx++;
        else if (sev === 'medium') medEx++;
        else lowEx++;
    });
    if (critEx > 0) out.push({ code: 'ENV_EXCURSION_CRITICAL', severity: 70, label: critEx + ' critical environmental excursion(s)', blocking: 'hold' });
    if (highEx > 0) out.push({ code: 'ENV_EXCURSION_HIGH', severity: 30 + Math.min(20, (highEx - 1) * 8), label: highEx + ' high-severity environmental excursion(s)' });
    if (medEx >= 2) out.push({ code: 'ENV_EXCURSION_MEDIUM_CLUSTER', severity: 18, label: medEx + ' medium-severity environmental excursions' });
    if (medEx === 1) out.push({ code: 'ENV_EXCURSION_MEDIUM', severity: 8, label: '1 medium-severity environmental excursion' });
    if (lowEx >= 3) out.push({ code: 'ENV_EXCURSION_LOW_CLUSTER', severity: 6, label: lowEx + ' low-severity environmental excursions' });

    // Deviations
    var deviations = Array.isArray(batch.deviations) ? batch.deviations : [];
    var sevDev = 0, modDev = 0, minDev = 0;
    deviations.forEach(function (d) {
        var sev = String(d && d.severity || 'minor').toLowerCase();
        if (sev === 'severe' || sev === 'critical') sevDev++;
        else if (sev === 'moderate' || sev === 'major') modDev++;
        else minDev++;
    });
    if (sevDev > 0) out.push({ code: 'DEVIATION_SEVERE', severity: 55 + Math.min(20, (sevDev - 1) * 10), label: sevDev + ' severe protocol deviation(s)', blocking: 'hold' });
    if (modDev > 0) out.push({ code: 'DEVIATION_MODERATE', severity: 25 + Math.min(15, (modDev - 1) * 6), label: modDev + ' moderate protocol deviation(s)' });
    if (minDev >= 3) out.push({ code: 'DEVIATION_MINOR_CLUSTER', severity: 15, label: minDev + ' minor protocol deviations' });
    else if (minDev > 0) out.push({ code: 'DEVIATION_MINOR', severity: 5, label: minDev + ' minor protocol deviation(s)' });

    // Failed protocol step (explicit)
    if (batch.protocolStepFailure) {
        out.push({ code: 'PROTOCOL_STEP_FAILED', severity: 75, label: 'Protocol step failure: ' + batch.protocolStepFailure, blocking: 'hold' });
    }

    // Viability
    if (batch.viability && _isFiniteNum(batch.viability.percent)) {
        var v = batch.viability.percent;
        if (v < 40) out.push({ code: 'VIABILITY_CRITICAL', severity: 60, label: 'Cell viability critical (' + v + '%)', blocking: 'rework' });
        else if (v < 70) out.push({ code: 'VIABILITY_LOW', severity: 30, label: 'Cell viability low (' + v + '%)', blocking: 'rework' });
        else if (v < 85) out.push({ code: 'VIABILITY_MARGINAL', severity: 10, label: 'Cell viability marginal (' + v + '%)' });
    } else if (intent.criticalIntent) {
        out.push({ code: 'VIABILITY_MISSING_CRITICAL_USE', severity: 30, label: 'No viability data for critical-use batch' });
    }

    // Reagent expiry / lineage hygiene
    if (Array.isArray(batch.expiredReagents) && batch.expiredReagents.length > 0) {
        out.push({ code: 'EXPIRED_REAGENT_USED', severity: 55, label: 'Used expired reagent(s): ' + batch.expiredReagents.join(', '), blocking: 'hold' });
    }
    if (batch.lineageBroken === true || (batch.lineage && batch.lineage.broken === true)) {
        out.push({ code: 'LINEAGE_BROKEN', severity: 35, label: 'Batch lineage incomplete or broken' });
    }

    // Operator certification / out-of-spec parameters
    if (batch.operatorUncertified === true) {
        out.push({ code: 'OPERATOR_UNCERTIFIED', severity: 25, label: 'Operator not certified for this protocol' });
    }
    if (Array.isArray(batch.outOfSpecParameters)) {
        batch.outOfSpecParameters.forEach(function (p) {
            out.push({ code: 'PARAM_OUT_OF_SPEC', severity: _sevWeight(p && p.severity), label: 'Parameter out of spec: ' + (p && p.name || 'unknown') });
        });
    }

    // Critical intent bump — escalate medium-band reasons under strict use
    if (intent.criticalIntent) {
        out.forEach(function (r) {
            if (r.severity >= 20 && r.severity < 70) r.severity = Math.min(95, Math.round(r.severity * 1.15));
        });
    }

    // Risk appetite tint
    var shift = _appetiteShift(ctx.riskAppetite);
    if (shift !== 0) {
        out.forEach(function (r) { r.severity = _clamp(r.severity + Math.round(shift * 0.5), 0, 100); });
    }

    return out;
}

// ── Verdict resolution ───────────────────────────────────────────

function _resolveVerdict(reasons, score, ctx) {
    var hasFatalDestroy = reasons.some(function (r) { return r.blocking === 'destroy'; });
    if (hasFatalDestroy) return VERDICTS.REJECT_DESTROY;

    var hasHold = reasons.some(function (r) { return r.blocking === 'hold'; });
    if (hasHold || score < ctx.quarantineThreshold) return VERDICTS.QUARANTINE_HOLD;

    var hasRework = reasons.some(function (r) { return r.blocking === 'rework'; });
    if (hasRework) return VERDICTS.REWORK;

    if (score >= ctx.releaseThreshold && reasons.length === 0) return VERDICTS.RELEASE;
    if (score >= ctx.releaseThreshold) return VERDICTS.RELEASE_WITH_NOTE;

    // Score between release and quarantine threshold with no blocking → release with note
    return VERDICTS.RELEASE_WITH_NOTE;
}

// ── Playbook ────────────────────────────────────────────────────

function _buildPlaybook(verdict, reasons, batch) {
    var seen = Object.create(null);
    var out = [];
    function add(action) {
        if (seen[action.code]) return;
        seen[action.code] = true;
        out.push(action);
    }

    if (verdict === VERDICTS.REJECT_DESTROY) {
        add({ code: 'INCINERATE_BATCH', priority: 'P0', owner: 'biosafety', label: 'Incinerate batch per biosafety SOP', reason: 'Fatal contamination/sterility signal blocks any release.', blastRadius: 5, reversibility: 'low' });
        add({ code: 'OPEN_INVESTIGATION', priority: 'P0', owner: 'qa', label: 'Open NCR and root-cause investigation', reason: 'Mandatory post-destroy QA workflow.', blastRadius: 3, reversibility: 'medium' });
        add({ code: 'QUARANTINE_LINKED_BATCHES', priority: 'P0', owner: 'qa', label: 'Quarantine any batches sharing reagent lots or printer', reason: 'Contain potential lot-level contamination.', blastRadius: 4, reversibility: 'medium' });
    } else if (verdict === VERDICTS.QUARANTINE_HOLD) {
        add({ code: 'PLACE_ON_HOLD', priority: 'P0', owner: 'qa', label: 'Move batch to quarantine storage with HOLD label', reason: 'High-risk signals present; release requires QA review.', blastRadius: 2, reversibility: 'high' });
        reasons.forEach(function (r) {
            if (r.code === 'MYCOPLASMA_PENDING_CRITICAL_USE' || r.code === 'MYCOPLASMA_MISSING_CRITICAL_USE')
                add({ code: 'AWAIT_MYCOPLASMA_RESULT', priority: 'P0', owner: 'qa', label: 'Hold until mycoplasma test clears', reason: r.label, blastRadius: 2, reversibility: 'high' });
            if (r.code === 'PROTOCOL_STEP_FAILED')
                add({ code: 'INVESTIGATE_STEP_FAILURE', priority: 'P0', owner: 'lab_manager', label: 'Investigate failed protocol step', reason: r.label, blastRadius: 3, reversibility: 'medium' });
            if (r.code === 'ENV_EXCURSION_CRITICAL')
                add({ code: 'REVIEW_ENV_LOGS', priority: 'P1', owner: 'facilities', label: 'Pull environmental logs and assess impact', reason: r.label, blastRadius: 2, reversibility: 'high' });
            if (r.code === 'EXPIRED_REAGENT_USED')
                add({ code: 'TRACE_EXPIRED_REAGENT_IMPACT', priority: 'P1', owner: 'qa', label: 'Trace expired-reagent impact on batch', reason: r.label, blastRadius: 2, reversibility: 'high' });
            if (r.code === 'DEVIATION_SEVERE')
                add({ code: 'FILE_DEVIATION_REPORT', priority: 'P1', owner: 'qa', label: 'File deviation report and CAPA', reason: r.label, blastRadius: 2, reversibility: 'high' });
        });
    } else if (verdict === VERDICTS.REWORK) {
        add({ code: 'RETURN_TO_OPERATOR', priority: 'P0', owner: 'print_operator', label: 'Return batch for rework with QC feedback', reason: 'Print quality or viability salvageable but below release threshold.', blastRadius: 2, reversibility: 'high' });
        add({ code: 'ATTACH_REWORK_NOTE', priority: 'P1', owner: 'qa', label: 'Attach rework note with failure mode summary', reason: 'Required for traceability.', blastRadius: 1, reversibility: 'high' });
        reasons.forEach(function (r) {
            if (r.code === 'PRINT_QUALITY_FAILED' || r.code === 'PRINT_QUALITY_LOW')
                add({ code: 'REVIEW_PRINT_PARAMETERS', priority: 'P1', owner: 'print_operator', label: 'Review print parameters before rerun', reason: r.label, blastRadius: 1, reversibility: 'high' });
            if (r.code === 'VIABILITY_CRITICAL' || r.code === 'VIABILITY_LOW')
                add({ code: 'CHECK_CELL_HANDLING', priority: 'P1', owner: 'qa', label: 'Audit cell-handling step for thermal/shear stress', reason: r.label, blastRadius: 2, reversibility: 'high' });
        });
    } else if (verdict === VERDICTS.RELEASE_WITH_NOTE) {
        add({ code: 'RELEASE_WITH_QC_NOTE', priority: 'P1', owner: 'qa', label: 'Release with QC note attached to certificate', reason: 'Minor issues acknowledged; intended use unaffected.', blastRadius: 1, reversibility: 'high' });
        reasons.forEach(function (r) {
            if (r.code === 'PRINT_QUALITY_MARGINAL')
                add({ code: 'NOTE_PRINT_QUALITY', priority: 'P2', owner: 'qa', label: 'Note marginal print quality in batch record', reason: r.label, blastRadius: 1, reversibility: 'high' });
            if (r.code === 'VIABILITY_MARGINAL')
                add({ code: 'NOTE_VIABILITY', priority: 'P2', owner: 'qa', label: 'Note marginal viability for end user', reason: r.label, blastRadius: 1, reversibility: 'high' });
            if (r.code === 'DEVIATION_MINOR_CLUSTER' || r.code === 'DEVIATION_MINOR')
                add({ code: 'NOTE_MINOR_DEVIATIONS', priority: 'P2', owner: 'qa', label: 'Document minor deviations in batch record', reason: r.label, blastRadius: 1, reversibility: 'high' });
        });
    } else { // RELEASE
        add({ code: 'RELEASE_CLEAN', priority: 'P3', owner: 'qa', label: 'Release batch with clean certificate', reason: 'No issues detected.', blastRadius: 1, reversibility: 'high' });
    }

    // Lineage / linked-batch hygiene (applies across verdicts)
    var hasLineage = reasons.some(function (r) { return r.code === 'LINEAGE_BROKEN'; });
    if (hasLineage) add({ code: 'RECONCILE_LINEAGE', priority: 'P2', owner: 'qa', label: 'Reconcile batch lineage links', reason: 'Lineage record incomplete.', blastRadius: 1, reversibility: 'high' });

    out.sort(function (a, b) {
        var d = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        return d !== 0 ? d : (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    });
    return out;
}

// ── Insights (cross-signal) ─────────────────────────────────────

function _buildInsights(reasons, batch, verdict) {
    var out = [];
    var codes = Object.create(null);
    reasons.forEach(function (r) { codes[r.code] = r; });
    if (codes.CONTAMINATION_POSITIVE && codes.STERILITY_FAILED)
        out.push({ code: 'COMPOUND_FATAL', severity: 'critical', text: 'Both contamination and sterility failed — escalate to biosafety lead.' });
    if ((codes.EXPIRED_REAGENT_USED || codes.PARAM_OUT_OF_SPEC) && codes.PRINT_QUALITY_LOW)
        out.push({ code: 'PROCESS_DRIFT_SUSPECTED', severity: 'high', text: 'Out-of-spec inputs + low print quality suggests process drift, not random failure.' });
    if (codes.ENV_EXCURSION_CRITICAL && codes.VIABILITY_LOW)
        out.push({ code: 'ENV_LINKED_VIABILITY_LOSS', severity: 'high', text: 'Environmental excursion likely contributed to viability drop — root-cause facilities.' });
    if (codes.OPERATOR_UNCERTIFIED && (codes.DEVIATION_SEVERE || codes.DEVIATION_MODERATE))
        out.push({ code: 'TRAINING_GAP', severity: 'medium', text: 'Deviation by uncertified operator — training audit recommended.' });
    var intent = INTENDED_USE[batch.intendedUse] || INTENDED_USE.research;
    if (intent.criticalIntent && verdict === VERDICTS.RELEASE_WITH_NOTE)
        out.push({ code: 'CRITICAL_USE_DOWNGRADE', severity: 'medium', text: 'Critical-use batch released with note — confirm acceptability with end user.' });
    if (verdict === VERDICTS.RELEASE && reasons.length === 0)
        out.push({ code: 'CLEAN_RELEASE', severity: 'info', text: 'No reasons triggered; release certificate may be issued automatically.' });
    return out;
}

// ── Scoring ─────────────────────────────────────────────────────

function _computeScore(reasons, ctx) {
    // Start at 100, subtract weighted contributions.
    var penalty = 0;
    var sorted = reasons.slice().sort(function (a, b) { return b.severity - a.severity; });
    sorted.forEach(function (r, i) {
        // Top reason full weight, rest diminishing returns 0.65^i, capped 60.
        var contribution = r.severity * Math.pow(0.65, i);
        penalty += contribution;
    });
    penalty = Math.min(100, penalty);
    return Math.max(0, Math.round(100 - penalty));
}

// ── Factory ─────────────────────────────────────────────────────

function createBatchReleaseAdvisor(opts) {
    opts = opts || {};
    var nowFn = typeof opts.now === 'function' ? opts.now : function () { return new Date(); };
    var defaultAppetite = opts.riskAppetite && RISK_APPETITES[opts.riskAppetite] ? opts.riskAppetite : RISK_APPETITES.balanced;
    var releaseThreshold = _isFiniteNum(opts.releaseThreshold) ? opts.releaseThreshold : 75;
    var reworkThreshold = _isFiniteNum(opts.reworkThreshold) ? opts.reworkThreshold : 60;
    var quarantineThreshold = _isFiniteNum(opts.quarantineThreshold) ? opts.quarantineThreshold : 45;

    function evaluate(batch, overrides) {
        if (!batch || typeof batch !== 'object') throw new TypeError('batch object required');
        overrides = overrides || {};
        var ctx = {
            now: _coerceDate(overrides.now, nowFn()),
            riskAppetite: (overrides.riskAppetite && RISK_APPETITES[overrides.riskAppetite]) || defaultAppetite,
            releaseThreshold: releaseThreshold,
            reworkThreshold: reworkThreshold,
            quarantineThreshold: quarantineThreshold,
        };

        var reasons = _detectReasons(batch, ctx);
        var score = _computeScore(reasons, ctx);
        // Risk appetite final shift on score itself
        score = _clamp(score - _appetiteShift(ctx.riskAppetite), 0, 100);
        var verdict = _resolveVerdict(reasons, score, ctx);

        var hardF = verdict === VERDICTS.REJECT_DESTROY || verdict === VERDICTS.QUARANTINE_HOLD;
        var grade = _gradeFromScore(score, hardF);

        var playbook = _buildPlaybook(verdict, reasons, batch);
        var insights = _buildInsights(reasons, batch, verdict);

        var counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
        playbook.forEach(function (a) { counts[a.priority] = (counts[a.priority] || 0) + 1; });

        var headline;
        if (verdict === VERDICTS.REJECT_DESTROY) headline = 'REJECT/DESTROY — batch unsafe to release.';
        else if (verdict === VERDICTS.QUARANTINE_HOLD) headline = 'HOLD — quarantine pending QA review.';
        else if (verdict === VERDICTS.REWORK) headline = 'REWORK — return for rerun with QC feedback.';
        else if (verdict === VERDICTS.RELEASE_WITH_NOTE) headline = 'RELEASE WITH NOTE — minor issues documented.';
        else headline = 'RELEASE — clean batch.';

        var sortedReasons = reasons.slice().sort(function (a, b) {
            if (b.severity !== a.severity) return b.severity - a.severity;
            return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
        });

        return {
            batchId: batch.batchId || batch.id || null,
            intendedUse: batch.intendedUse || 'research',
            generatedAt: ctx.now.toISOString(),
            verdict: verdict,
            grade: grade,
            score: score,
            riskAppetite: ctx.riskAppetite,
            thresholds: {
                release: releaseThreshold,
                rework: reworkThreshold,
                quarantine: quarantineThreshold,
            },
            headline: headline,
            reasons: sortedReasons,
            insights: insights,
            playbook: playbook,
            counts: counts,
        };
    }

    function simulate(batch, opts2) {
        opts2 = opts2 || {};
        var baseline = evaluate(batch, opts2.overrides);
        var applyTop = Math.max(0, Math.min(baseline.playbook.length, opts2.applyTop || 0));
        var applied = baseline.playbook.slice(0, applyTop);
        // Diminishing returns: each applied action improves score by base * 0.85^i.
        var bonus = 0;
        applied.forEach(function (a, i) {
            var base = a.priority === 'P0' ? 18 : a.priority === 'P1' ? 9 : a.priority === 'P2' ? 4 : 1;
            bonus += base * Math.pow(0.85, i);
        });
        var projected = _clamp(Math.round(baseline.score + bonus), 0, 100);
        // Cannot un-trigger fatal destroy via simulation.
        var projectedVerdict = baseline.verdict;
        if (baseline.verdict === VERDICTS.QUARANTINE_HOLD && projected >= releaseThreshold && applyTop > 0)
            projectedVerdict = VERDICTS.RELEASE_WITH_NOTE;
        if (baseline.verdict === VERDICTS.REWORK && projected >= releaseThreshold && applyTop > 0)
            projectedVerdict = VERDICTS.RELEASE_WITH_NOTE;
        if (baseline.verdict === VERDICTS.RELEASE_WITH_NOTE && projected >= 95 && applied.length > 0)
            projectedVerdict = VERDICTS.RELEASE;
        return {
            baselineScore: baseline.score,
            baselineGrade: baseline.grade,
            baselineVerdict: baseline.verdict,
            projectedScore: projected,
            projectedGrade: _gradeFromScore(projected, baseline.verdict === VERDICTS.REJECT_DESTROY),
            projectedVerdict: projectedVerdict,
            appliedActions: applied,
        };
    }

    // ── Renderers ───────────────────────────────────────────────

    function formatText(r) {
        var lines = [];
        lines.push('BATCH RELEASE REPORT — ' + (r.batchId || '(unnamed)'));
        lines.push('Verdict: ' + r.verdict + ' | Grade ' + r.grade + ' | Score ' + r.score + '/100 | Appetite: ' + r.riskAppetite);
        lines.push(r.headline);
        lines.push('Intended use: ' + r.intendedUse + ' | Generated: ' + r.generatedAt);
        lines.push('-'.repeat(60));
        if (r.reasons.length === 0) lines.push('(no reasons triggered)');
        else r.reasons.forEach(function (x) { lines.push('  - [' + x.severity + '] ' + x.code + ': ' + x.label + (x.blocking ? ' (blocks: ' + x.blocking + ')' : '')); });
        if (r.insights.length) {
            lines.push('');
            lines.push('Insights:');
            r.insights.forEach(function (i) { lines.push('  * [' + i.severity + '] ' + i.code + ': ' + i.text); });
        }
        if (r.playbook.length) {
            lines.push('');
            lines.push('Playbook (P0=' + r.counts.P0 + ' P1=' + r.counts.P1 + ' P2=' + r.counts.P2 + ' P3=' + r.counts.P3 + '):');
            r.playbook.forEach(function (a) {
                lines.push('  [' + a.priority + '] ' + a.code + ' (owner=' + a.owner + ', blast=' + a.blastRadius + ', rev=' + a.reversibility + ')');
                lines.push('     ' + a.label + ' — ' + a.reason);
            });
        }
        return lines.join('\n');
    }

    function formatMarkdown(r) {
        var out = [];
        out.push('# Batch Release Report');
        out.push('');
        out.push('**Batch:** ' + (r.batchId || '_(unnamed)_'));
        out.push('**Verdict:** ' + r.verdict + ' &nbsp; **Grade:** ' + r.grade + ' &nbsp; **Score:** ' + r.score + '/100');
        out.push('**Intended use:** ' + r.intendedUse + ' &nbsp; **Risk appetite:** ' + r.riskAppetite);
        out.push('');
        out.push('> ' + r.headline);
        out.push('');
        out.push('| P0 | P1 | P2 | P3 |');
        out.push('|---:|---:|---:|---:|');
        out.push('| ' + r.counts.P0 + ' | ' + r.counts.P1 + ' | ' + r.counts.P2 + ' | ' + r.counts.P3 + ' |');
        out.push('');
        out.push('## Reasons');
        out.push('');
        if (r.reasons.length === 0) out.push('_No reasons triggered._');
        else {
            out.push('| Severity | Code | Detail | Blocks |');
            out.push('|---:|------|--------|--------|');
            r.reasons.forEach(function (x) {
                out.push('| ' + x.severity + ' | ' + x.code + ' | ' + x.label + ' | ' + (x.blocking || '—') + ' |');
            });
        }
        if (r.insights.length) {
            out.push('');
            out.push('## Insights');
            out.push('');
            r.insights.forEach(function (i) { out.push('- **[' + i.severity + '] ' + i.code + '** — ' + i.text); });
        }
        if (r.playbook.length) {
            out.push('');
            out.push('## Playbook');
            out.push('');
            out.push('| Priority | Code | Owner | Label | Reason |');
            out.push('|----------|------|-------|-------|--------|');
            r.playbook.forEach(function (a) {
                out.push('| ' + a.priority + ' | ' + a.code + ' | ' + a.owner + ' | ' + a.label + ' | ' + a.reason + ' |');
            });
        }
        return out.join('\n');
    }

    // Byte-stable JSON via recursive sort.
    function _sortKeys(value) {
        if (Array.isArray(value)) return value.map(_sortKeys);
        if (value && typeof value === 'object') {
            var keys = Object.keys(value).sort();
            var out = {};
            keys.forEach(function (k) { out[k] = _sortKeys(value[k]); });
            return out;
        }
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

module.exports = { createBatchReleaseAdvisor: createBatchReleaseAdvisor, VERDICTS: VERDICTS };
