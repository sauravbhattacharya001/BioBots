'use strict';

/**
 * Supplier Quality Scorecard Advisor - Agentic per-supplier procurement triage.
 *
 * Distinct from siblings:
 *   - supplyChainResilience.js     -> overall continuity / dependency risk
 *   - reagentSubstitutionAdvisor.js -> mid-run "I can't use this lot, swap"
 *   - perishableWasteForecaster.js  -> expiry vs consumption
 *   - smartReorder.js               -> when/how-much to reorder
 *
 * This advisor answers a different question: across the suppliers we already
 * buy from, which ones deserve more business, which need probation, which
 * should be retired, and which categories are dangerously single-sourced?
 *
 * INPUTS
 *   suppliers: [{
 *       id, name, category (reagent|consumable|equipment|service|other),
 *       lotsDelivered, lotsAccepted, lotsRejected,
 *       onTimeDeliveries, lateDeliveries,
 *       contaminationIncidents, recalls,
 *       avgLeadTimeDays, contractedLeadTimeDays?,
 *       priceIndex? (1.0 = market median, <1 cheaper, >1 pricier),
 *       criticality? (1..5, default 3),
 *       isPreferred? (bool),
 *       lastIncidentAt? (Date|ISO),
 *       certifications? (string[])
 *   }]
 *
 * Optionally provide `categorySupplierCounts` to enable single-source
 * detection across the whole portfolio (auto-derived from suppliers if
 * omitted).
 *
 * OUTPUT (report)
 *   - perSupplier: [{ id, score 0..100, grade A-F, verdict, priority P0-P3,
 *       reasons[], suggestedAction, defectRate, onTimeRate, monthlyIncidentRate,
 *       categoryShareWarning }]
 *   - playbook: [{ id, priority, label, reason, owner, blastRadius, reversibility,
 *       supplierIds, category? }]
 *   - insights: string[]
 *   - portfolio: { grade, score, preferredCount, probationCount, blacklistCount,
 *       singleSourcedCategories[], totalSuppliers }
 *   - headline
 *
 * Pure CommonJS, zero deps, deterministic via injectable now(), never mutates
 * inputs (deep copy entry-by-entry).
 */

// Verdicts (priority order matters for ladder selection)
var V = {
    BLACKLIST: 'BLACKLIST',
    PROBATION: 'PROBATION',
    DIVERSIFY_AWAY: 'DIVERSIFY_AWAY',     // single-sourced + risky
    EXPAND_USAGE: 'EXPAND_USAGE',         // preferred-tier candidate
    PREFERRED: 'PREFERRED',
    APPROVED: 'APPROVED',
    INSUFFICIENT_DATA: 'INSUFFICIENT_DATA'
};

// Priority bands
function priorityBand(score, verdict) {
    if (verdict === V.BLACKLIST) return 'P0';
    if (verdict === V.PROBATION) return 'P1';
    if (verdict === V.DIVERSIFY_AWAY) return 'P1';
    if (verdict === V.EXPAND_USAGE) return 'P2';
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

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function safeDiv(num, den) {
    if (!den || den <= 0) return 0;
    return num / den;
}

function monthsSince(date, now) {
    if (!date) return null;
    var d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return null;
    return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.0);
}

function deepFreezeCopy(obj) {
    return JSON.parse(JSON.stringify(obj));
}

function appetiteMult(appetite) {
    if (appetite === 'cautious') return 1.15;
    if (appetite === 'aggressive') return 0.85;
    return 1.0;
}

// ---------- Per-supplier analyzer ----------
function analyzeSupplier(supplier, ctx) {
    var crit = (typeof supplier.criticality === 'number') ? clamp(supplier.criticality, 1, 5) : 3;
    var lotsDelivered = supplier.lotsDelivered || 0;
    var lotsRejected = supplier.lotsRejected || 0;
    var lotsAccepted = (typeof supplier.lotsAccepted === 'number')
        ? supplier.lotsAccepted
        : Math.max(0, lotsDelivered - lotsRejected);
    var deliveries = (supplier.onTimeDeliveries || 0) + (supplier.lateDeliveries || 0);
    var defectRate = safeDiv(lotsRejected, lotsDelivered);
    var onTimeRate = deliveries > 0 ? safeDiv(supplier.onTimeDeliveries || 0, deliveries) : null;
    var contam = supplier.contaminationIncidents || 0;
    var recalls = supplier.recalls || 0;

    var reasons = [];

    // Insufficient data path
    if (lotsDelivered < 3 && deliveries < 3) {
        return {
            id: supplier.id || supplier.name,
            name: supplier.name || supplier.id,
            category: supplier.category || 'other',
            score: 50,
            grade: 'C',
            verdict: V.INSUFFICIENT_DATA,
            priority: 'P2',
            reasons: ['INSUFFICIENT_HISTORY'],
            defectRate: defectRate,
            onTimeRate: onTimeRate,
            monthlyIncidentRate: 0,
            suggestedAction: 'COLLECT_MORE_DATA',
            categoryShareWarning: false
        };
    }

    // ---- Score components (0..100, higher = better) ----
    // Quality 40% / Reliability 30% / Safety 20% / Cost 10%
    var qualityComp = clamp01(1 - defectRate) * 100;
    var reliabilityComp = (onTimeRate == null) ? 60 : clamp01(onTimeRate) * 100;

    // Safety: contamination + recalls weighted by recency
    var incidentLoad = contam * 8 + recalls * 18;
    var monthsAgo = monthsSince(supplier.lastIncidentAt, ctx.now);
    if (monthsAgo != null && monthsAgo < 3) incidentLoad *= 1.3;
    else if (monthsAgo != null && monthsAgo > 18) incidentLoad *= 0.5;
    var safetyComp = clamp(100 - incidentLoad, 0, 100);

    // Cost: closer to median = better (1.0 ideal), penalty for >1.3, bonus for <0.85 if quality holds
    var price = (typeof supplier.priceIndex === 'number') ? supplier.priceIndex : 1.0;
    var costComp = 100 - Math.min(60, Math.abs(price - 1.0) * 60);
    if (price < 0.85 && qualityComp >= 70) costComp = Math.min(100, costComp + 10);

    var score = qualityComp * 0.40 + reliabilityComp * 0.30 + safetyComp * 0.20 + costComp * 0.10;

    // Lead-time SLA penalty
    if (supplier.contractedLeadTimeDays && supplier.avgLeadTimeDays > supplier.contractedLeadTimeDays * 1.25) {
        score -= 8;
        reasons.push('LEAD_TIME_SLA_BREACH');
    }
    // Criticality amplifies bad scores
    if (crit >= 4 && score < 70) {
        score -= (crit - 3) * 4;
        reasons.push('CRITICAL_CATEGORY');
    }

    score = clamp(Math.round(score), 0, 100);

    // ---- Reason codes ----
    if (defectRate >= 0.10) reasons.push('HIGH_DEFECT_RATE');
    else if (defectRate >= 0.05) reasons.push('ELEVATED_DEFECT_RATE');
    if (onTimeRate != null && onTimeRate < 0.70) reasons.push('LOW_ON_TIME_RATE');
    if (contam > 0) reasons.push('CONTAMINATION_HISTORY');
    if (recalls > 0) reasons.push('RECALL_HISTORY');
    if (price > 1.3) reasons.push('PRICE_PREMIUM');
    if (price < 0.85 && qualityComp >= 70) reasons.push('COST_LEADER');
    if (monthsAgo != null && monthsAgo < 3) reasons.push('RECENT_INCIDENT');
    if (supplier.isPreferred) reasons.push('CURRENTLY_PREFERRED');

    // ---- Verdict ladder (worst → best) ----
    var verdict;
    var suggestedAction;
    if (recalls >= 2 || (recalls >= 1 && crit >= 4) || score < 35) {
        verdict = V.BLACKLIST;
        suggestedAction = 'REMOVE_FROM_APPROVED_LIST';
    } else if (defectRate >= 0.15 || (contam >= 2 && crit >= 3) || score < 50) {
        verdict = V.PROBATION;
        suggestedAction = 'RESTRICT_TO_AUDIT_LOTS_ONLY';
    } else if (score >= 85 && defectRate <= 0.02 && (onTimeRate == null || onTimeRate >= 0.90) && contam === 0) {
        verdict = supplier.isPreferred ? V.PREFERRED : V.EXPAND_USAGE;
        suggestedAction = supplier.isPreferred ? 'MAINTAIN_PREFERRED_STATUS' : 'PROMOTE_TO_PREFERRED';
    } else {
        verdict = V.APPROVED;
        suggestedAction = 'CONTINUE_STANDARD_USAGE';
    }

    // ---- Single-source flag ----
    var cat = supplier.category || 'other';
    var catCount = (ctx.categoryCounts && ctx.categoryCounts[cat]) || 1;
    var categoryShareWarning = false;
    if (catCount === 1 && crit >= 3) {
        categoryShareWarning = true;
        reasons.push('SOLE_SOURCE_FOR_CATEGORY');
        if (verdict !== V.BLACKLIST && score < 75) {
            verdict = V.DIVERSIFY_AWAY;
            suggestedAction = 'QUALIFY_SECOND_SOURCE';
        }
    }

    // monthly incident rate (per delivered lot heuristic)
    var monthlyIncidentRate = lotsDelivered > 0
        ? Math.round(((contam + recalls) / lotsDelivered) * 1000) / 1000
        : 0;

    var priority = priorityBand(score, verdict);

    return {
        id: supplier.id || supplier.name,
        name: supplier.name || supplier.id,
        category: cat,
        criticality: crit,
        score: score,
        grade: gradeFromScore(score),
        verdict: verdict,
        priority: priority,
        reasons: reasons.slice(),
        defectRate: Math.round(defectRate * 10000) / 10000,
        onTimeRate: onTimeRate == null ? null : Math.round(onTimeRate * 10000) / 10000,
        monthlyIncidentRate: monthlyIncidentRate,
        suggestedAction: suggestedAction,
        categoryShareWarning: categoryShareWarning,
        components: {
            quality: Math.round(qualityComp),
            reliability: Math.round(reliabilityComp),
            safety: Math.round(safetyComp),
            cost: Math.round(costComp)
        }
    };
}

// ---------- Playbook ----------
function buildPlaybook(perSupplier, portfolio, opts) {
    var actions = [];
    var blacklists = perSupplier.filter(function (s) { return s.verdict === V.BLACKLIST; });
    var probations = perSupplier.filter(function (s) { return s.verdict === V.PROBATION; });
    var diversify  = perSupplier.filter(function (s) { return s.verdict === V.DIVERSIFY_AWAY; });
    var expand     = perSupplier.filter(function (s) { return s.verdict === V.EXPAND_USAGE; });
    var insuff     = perSupplier.filter(function (s) { return s.verdict === V.INSUFFICIENT_DATA; });

    if (blacklists.length) {
        actions.push({
            id: 'REMOVE_BLACKLISTED_SUPPLIERS',
            priority: 'P0',
            label: 'Remove blacklisted suppliers from approved vendor list',
            reason: blacklists.length + ' supplier(s) with recall pattern or critical-defect history',
            owner: 'procurement_lead',
            blastRadius: 4,
            reversibility: 'low',
            supplierIds: blacklists.map(function (s) { return s.id; })
        });
        actions.push({
            id: 'QUARANTINE_OPEN_LOTS_FROM_BLACKLIST',
            priority: 'P0',
            label: 'Quarantine open lots from blacklisted suppliers pending QA review',
            reason: 'Prevent in-flight contamination/defect propagation',
            owner: 'qa',
            blastRadius: 3,
            reversibility: 'medium',
            supplierIds: blacklists.map(function (s) { return s.id; })
        });
    }

    if (diversify.length) {
        actions.push({
            id: 'QUALIFY_SECOND_SOURCE',
            priority: 'P1',
            label: 'Qualify a second source for single-sourced critical categories',
            reason: 'Single-source dependency on under-performing supplier(s)',
            owner: 'procurement_lead',
            blastRadius: 3,
            reversibility: 'high',
            supplierIds: diversify.map(function (s) { return s.id; })
        });
    }

    if (probations.length) {
        actions.push({
            id: 'PLACE_SUPPLIERS_ON_PROBATION',
            priority: 'P1',
            label: 'Place under-performing suppliers on lot-by-lot audit probation',
            reason: probations.length + ' supplier(s) with elevated defect or contamination rate',
            owner: 'qa',
            blastRadius: 2,
            reversibility: 'high',
            supplierIds: probations.map(function (s) { return s.id; })
        });
        actions.push({
            id: 'NOTIFY_PROBATION_SUPPLIERS',
            priority: 'P2',
            label: 'Send corrective-action request (CAR) to probation suppliers',
            reason: 'Document quality expectations and require remediation plan',
            owner: 'procurement',
            blastRadius: 1,
            reversibility: 'high',
            supplierIds: probations.map(function (s) { return s.id; })
        });
    }

    if (expand.length) {
        actions.push({
            id: 'PROMOTE_TOP_PERFORMERS',
            priority: 'P2',
            label: 'Promote top performers to preferred tier and shift volume',
            reason: expand.length + ' supplier(s) at grade A with clean record',
            owner: 'procurement_lead',
            blastRadius: 2,
            reversibility: 'high',
            supplierIds: expand.map(function (s) { return s.id; })
        });
    }

    if (insuff.length) {
        actions.push({
            id: 'COLLECT_SUPPLIER_HISTORY',
            priority: 'P2',
            label: 'Run pilot orders / collect baseline metrics for new suppliers',
            reason: insuff.length + ' supplier(s) with <3 delivery history',
            owner: 'procurement',
            blastRadius: 1,
            reversibility: 'high',
            supplierIds: insuff.map(function (s) { return s.id; })
        });
    }

    if (portfolio.singleSourcedCategories.length >= 2) {
        actions.push({
            id: 'PORTFOLIO_DIVERSIFICATION_REVIEW',
            priority: 'P1',
            label: 'Schedule portfolio-wide supplier diversification review',
            reason: portfolio.singleSourcedCategories.length + ' categories are single-sourced',
            owner: 'procurement_lead',
            blastRadius: 4,
            reversibility: 'high',
            category: portfolio.singleSourcedCategories.slice()
        });
    }

    // Cautious adds standing audit cadence
    if (opts.risk_appetite === 'cautious' && (portfolio.grade === 'C' || portfolio.grade === 'D' || portfolio.grade === 'F')) {
        actions.push({
            id: 'SCHEDULE_QUARTERLY_SUPPLIER_AUDIT',
            priority: 'P2',
            label: 'Schedule quarterly supplier audit cadence',
            reason: 'Portfolio grade ' + portfolio.grade + ' warrants tighter review cycle',
            owner: 'qa',
            blastRadius: 2,
            reversibility: 'high',
            supplierIds: []
        });
    }

    if (actions.length === 0) {
        actions.push({
            id: 'MAINTAIN_SUPPLIER_HEALTH',
            priority: 'P3',
            label: 'Maintain current supplier base; no interventions required',
            reason: 'All suppliers within tolerance',
            owner: 'procurement',
            blastRadius: 1,
            reversibility: 'high',
            supplierIds: []
        });
    }

    // Aggressive trims P3 + lone P2 when higher priorities exist
    if (opts.risk_appetite === 'aggressive') {
        var hasUrgent = actions.some(function (a) { return a.priority === 'P0' || a.priority === 'P1'; });
        if (hasUrgent) {
            actions = actions.filter(function (a) {
                if (a.priority === 'P3') return false;
                if (a.priority === 'P2' && a.id === 'COLLECT_SUPPLIER_HISTORY') return false;
                if (a.priority === 'P2' && a.id === 'NOTIFY_PROBATION_SUPPLIERS') return false;
                return true;
            });
        }
    }

    // P0-first deduped sort
    var pOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
    actions.sort(function (a, b) {
        if (pOrder[a.priority] !== pOrder[b.priority]) return pOrder[a.priority] - pOrder[b.priority];
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return actions;
}

// ---------- Insights ----------
function buildInsights(perSupplier, portfolio) {
    var ins = [];
    var blacklisted = perSupplier.filter(function (s) { return s.verdict === V.BLACKLIST; }).length;
    var contamCount = perSupplier.filter(function (s) { return s.reasons.indexOf('CONTAMINATION_HISTORY') >= 0; }).length;
    var recallCount = perSupplier.filter(function (s) { return s.reasons.indexOf('RECALL_HISTORY') >= 0; }).length;
    var lateCount = perSupplier.filter(function (s) { return s.reasons.indexOf('LOW_ON_TIME_RATE') >= 0; }).length;
    var pricey = perSupplier.filter(function (s) { return s.reasons.indexOf('PRICE_PREMIUM') >= 0; }).length;

    if (blacklisted >= 2) ins.push('MULTI_SUPPLIER_FAILURE_PATTERN:' + blacklisted);
    if (contamCount >= 2) ins.push('CONTAMINATION_PATTERN_ACROSS_FLEET:' + contamCount);
    if (recallCount >= 1) ins.push('RECALL_ACTIVITY_DETECTED:' + recallCount);
    if (lateCount >= 2) ins.push('DELIVERY_RELIABILITY_DEGRADED:' + lateCount);
    if (pricey >= Math.ceil(perSupplier.length / 2)) ins.push('PORTFOLIO_PRICE_INFLATION');
    if (portfolio.singleSourcedCategories.length > 0) {
        ins.push('SINGLE_SOURCE_RISK:' + portfolio.singleSourcedCategories.join(','));
    }
    if (portfolio.preferredCount === 0 && perSupplier.length >= 3) {
        ins.push('NO_PREFERRED_TIER_ESTABLISHED');
    }
    if (perSupplier.length === 0) ins.push('EMPTY_SUPPLIER_BASE');
    if (ins.length === 0) ins.push('HEALTHY_SUPPLIER_PORTFOLIO');
    return ins;
}

// ---------- Renderers ----------
function _sortedJsonReplacer() {
    var seen = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;
    return function (_key, value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (seen) {
                if (seen.has(value)) return undefined;
                seen.add(value);
            }
            if (value instanceof Date) return value.toISOString();
            var sorted = {};
            Object.keys(value).sort().forEach(function (k) { sorted[k] = value[k]; });
            return sorted;
        }
        return value;
    };
}

function formatJson(report) {
    return JSON.stringify(report, _sortedJsonReplacer(), 2);
}

function formatText(report) {
    var lines = [];
    lines.push('SUPPLIER QUALITY SCORECARD');
    lines.push('==========================');
    lines.push('Headline: ' + report.headline);
    lines.push('');
    lines.push('Portfolio grade=' + report.portfolio.grade
        + ' score=' + report.portfolio.score
        + ' suppliers=' + report.portfolio.totalSuppliers
        + ' preferred=' + report.portfolio.preferredCount
        + ' probation=' + report.portfolio.probationCount
        + ' blacklist=' + report.portfolio.blacklistCount);
    lines.push('');
    lines.push('Suppliers:');
    report.perSupplier.forEach(function (s) {
        lines.push('  [' + s.priority + '] ' + s.name + ' (' + s.category + ') '
            + 'grade=' + s.grade + ' score=' + s.score + ' verdict=' + s.verdict
            + ' -> ' + s.suggestedAction);
        if (s.reasons.length) lines.push('      reasons: ' + s.reasons.join(', '));
    });
    lines.push('');
    lines.push('Playbook:');
    report.playbook.forEach(function (a) {
        lines.push('  [' + a.priority + '] ' + a.label + ' (' + a.owner + ', blast=' + a.blastRadius + ', rev=' + a.reversibility + ')');
        lines.push('      reason: ' + a.reason);
    });
    lines.push('');
    lines.push('Insights:');
    report.insights.forEach(function (i) { lines.push('  - ' + i); });
    return lines.join('\n');
}

function _md(s) {
    return String(s == null ? '' : s).replace(/\|/g, '\\|');
}

function formatMarkdown(report) {
    var out = [];
    out.push('# Supplier Quality Scorecard');
    out.push('');
    out.push('**Headline:** ' + report.headline);
    out.push('');
    out.push('## Summary');
    out.push('');
    out.push('| Metric | Value |');
    out.push('|---|---|');
    out.push('| Portfolio grade | ' + report.portfolio.grade + ' |');
    out.push('| Portfolio score | ' + report.portfolio.score + ' |');
    out.push('| Total suppliers | ' + report.portfolio.totalSuppliers + ' |');
    out.push('| Preferred | ' + report.portfolio.preferredCount + ' |');
    out.push('| Probation | ' + report.portfolio.probationCount + ' |');
    out.push('| Blacklist | ' + report.portfolio.blacklistCount + ' |');
    out.push('| Single-sourced categories | ' + (report.portfolio.singleSourcedCategories.join(', ') || 'none') + ' |');
    out.push('');
    out.push('## Suppliers');
    out.push('');
    out.push('| Priority | Supplier | Category | Grade | Score | Verdict | Action |');
    out.push('|---|---|---|---|---|---|---|');
    report.perSupplier.forEach(function (s) {
        out.push('| ' + s.priority + ' | ' + _md(s.name) + ' | ' + _md(s.category)
            + ' | ' + s.grade + ' | ' + s.score + ' | ' + s.verdict + ' | ' + _md(s.suggestedAction) + ' |');
    });
    out.push('');
    out.push('## Playbook');
    out.push('');
    out.push('| Priority | Action | Owner | Blast | Reason |');
    out.push('|---|---|---|---|---|');
    report.playbook.forEach(function (a) {
        out.push('| ' + a.priority + ' | ' + _md(a.label) + ' | ' + _md(a.owner)
            + ' | ' + a.blastRadius + ' | ' + _md(a.reason) + ' |');
    });
    out.push('');
    out.push('## Insights');
    out.push('');
    report.insights.forEach(function (i) { out.push('- ' + i); });
    return out.join('\n');
}

// ---------- Factory ----------
function createSupplierQualityScorecardAdvisor(options) {
    options = options || {};
    var nowFn = (typeof options.now === 'function') ? options.now : function () { return new Date(); };

    function analyze(input, runOpts) {
        runOpts = runOpts || {};
        var appetite = runOpts.risk_appetite || 'balanced';
        var appMult = appetiteMult(appetite);
        var now = (typeof runOpts.now === 'function') ? runOpts.now() : nowFn();
        if (!(now instanceof Date) || isNaN(now.getTime())) throw new Error('invalid now()');

        var suppliers = Array.isArray(input) ? input : (input && input.suppliers) || [];
        var explicitCatCounts = input && input.categorySupplierCounts;

        // Build categoryCounts (immutable, derived from input)
        var categoryCounts = {};
        if (explicitCatCounts && typeof explicitCatCounts === 'object') {
            Object.keys(explicitCatCounts).forEach(function (k) { categoryCounts[k] = explicitCatCounts[k]; });
        } else {
            suppliers.forEach(function (s) {
                var c = s && s.category ? s.category : 'other';
                categoryCounts[c] = (categoryCounts[c] || 0) + 1;
            });
        }

        var copies = suppliers.map(deepFreezeCopy);
        var ctx = { now: now, categoryCounts: categoryCounts };

        var perSupplier = copies.map(function (s) {
            var rec = analyzeSupplier(s, ctx);
            // appetite shaping: shift score modestly
            if (appetite === 'cautious') rec.score = clamp(Math.round(rec.score - 3), 0, 100);
            else if (appetite === 'aggressive') rec.score = clamp(Math.round(rec.score + 3), 0, 100);
            rec.grade = gradeFromScore(rec.score);
            // recompute priority after shaping
            rec.priority = priorityBand(rec.score, rec.verdict);
            return rec;
        });

        // Sort: priority asc, score asc (worst-first within priority), id asc
        var pOrder = { P0: 0, P1: 1, P2: 2, P3: 3 };
        perSupplier.sort(function (a, b) {
            if (pOrder[a.priority] !== pOrder[b.priority]) return pOrder[a.priority] - pOrder[b.priority];
            if (a.score !== b.score) return a.score - b.score;
            return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
        });

        // Portfolio summary
        var preferredCount = perSupplier.filter(function (s) {
            return s.verdict === V.PREFERRED || s.verdict === V.EXPAND_USAGE;
        }).length;
        var probationCount = perSupplier.filter(function (s) { return s.verdict === V.PROBATION; }).length;
        var blacklistCount = perSupplier.filter(function (s) { return s.verdict === V.BLACKLIST; }).length;

        // Single-sourced critical categories
        var singleSourced = [];
        Object.keys(categoryCounts).sort().forEach(function (cat) {
            if (categoryCounts[cat] === 1) {
                // Mark only if the lone supplier is critical (criticality>=3)
                var lone = perSupplier.find(function (s) { return s.category === cat; });
                if (lone && (lone.criticality || 3) >= 3) singleSourced.push(cat);
            }
        });

        // Portfolio score = mean of supplier scores weighted by criticality
        var totalWeight = 0;
        var weighted = 0;
        perSupplier.forEach(function (s) {
            var w = s.criticality || 3;
            totalWeight += w;
            weighted += s.score * w;
        });
        var portfolioScore = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;
        // Penalize portfolio for blacklists & single-source
        portfolioScore -= blacklistCount * 12;
        portfolioScore -= singleSourced.length * 5;
        portfolioScore = clamp(Math.round(portfolioScore * (2 - appMult) /* invert: cautious lowers, aggressive raises portfolio */ ), 0, 100);

        // Force grade F if any critical blacklist
        var hasCritBlacklist = perSupplier.some(function (s) {
            return s.verdict === V.BLACKLIST && (s.criticality || 3) >= 4;
        });
        var portfolioGrade = hasCritBlacklist ? 'F' : gradeFromScore(portfolioScore);

        var portfolio = {
            grade: portfolioGrade,
            score: portfolioScore,
            totalSuppliers: perSupplier.length,
            preferredCount: preferredCount,
            probationCount: probationCount,
            blacklistCount: blacklistCount,
            singleSourcedCategories: singleSourced
        };

        var playbook = buildPlaybook(perSupplier, portfolio, { risk_appetite: appetite });
        var insights = buildInsights(perSupplier, portfolio);

        var p0 = playbook.filter(function (a) { return a.priority === 'P0'; }).length;
        var p1 = playbook.filter(function (a) { return a.priority === 'P1'; }).length;
        var headline = 'VERDICT: grade=' + portfolio.grade
            + ' score=' + portfolio.score
            + ' N=' + portfolio.totalSuppliers
            + ' P0=' + p0 + ' P1=' + p1
            + ' blacklist=' + portfolio.blacklistCount
            + ' single_source=' + portfolio.singleSourcedCategories.length;

        return {
            generatedAt: now.toISOString(),
            risk_appetite: appetite,
            headline: headline,
            portfolio: portfolio,
            perSupplier: perSupplier,
            playbook: playbook,
            insights: insights
        };
    }

    function format(report, mode) {
        var m = (mode || 'text').toLowerCase();
        if (m === 'json') return formatJson(report);
        if (m === 'md' || m === 'markdown') return formatMarkdown(report);
        return formatText(report);
    }

    return {
        analyze: analyze,
        format: format,
        formatText: formatText,
        formatMarkdown: formatMarkdown,
        formatJson: formatJson
    };
}

module.exports = {
    createSupplierQualityScorecardAdvisor: createSupplierQualityScorecardAdvisor
};
