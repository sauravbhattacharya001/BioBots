'use strict';

/**
 * Smart Experiment Replicator
 *
 * Autonomous replication planner for bioprinting experiments.
 * Records completed experiments, generates systematic replication plans
 * with parameter variations, calculates statistical power, prioritises
 * experiments by replication urgency, and builds optimal schedules that
 * maximise information gain.
 *
 * Agentic capabilities:
 *  - Proactively identifies under-replicated parameter regions
 *  - Autonomously ranks replication urgency
 *  - Generates optimal schedules to maximise learning per experiment
 *  - Detects conflicting results that demand replication
 *
 * @example
 *   var rep = createExperimentReplicator();
 *   rep.recordExperiment({ material:'alginate', temperature:37, cellDensity:1e6, speed:10, pressure:25, success:true, viability:0.92 });
 *   var plan = rep.planReplication(1, { variations: 3 });
 *   var power = rep.calculatePower({ sampleSize: 30, effectSize: 'medium' });
 */

// ── Helpers ─────────────────────────────────────────────────────────

/** Standard normal CDF (Abramowitz & Stegun approximation). */
function phi(x) {
    var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    var a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.SQRT2;
    var t = 1.0 / (1.0 + p * x);
    var y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
}

/** Inverse normal CDF (rational approximation). */
function phiInv(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    if (p < 0.5) return -phiInv(1 - p);
    var t = Math.sqrt(-2 * Math.log(1 - p));
    var c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
    var d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
    return t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
}

var EFFECT_SIZES = { small: 0.2, medium: 0.5, large: 0.8 };

var NUMERIC_PARAMS = ['temperature', 'cellDensity', 'speed', 'pressure', 'layerHeight', 'nozzleDiameter'];

var MATERIALS = ['alginate', 'gelatin', 'collagen', 'fibrin', 'hyaluronic_acid'];

var PARAM_RANGES = {
    alginate:        { temperature:[20,37], cellDensity:[5e5,5e6], speed:[5,20],  pressure:[10,40], layerHeight:[0.1,0.4],  nozzleDiameter:[0.2,0.6] },
    gelatin:         { temperature:[25,37], cellDensity:[1e6,1e7], speed:[3,15],  pressure:[15,50], layerHeight:[0.15,0.5], nozzleDiameter:[0.25,0.8] },
    collagen:        { temperature:[4,25],  cellDensity:[1e6,8e6], speed:[2,12],  pressure:[5,30],  layerHeight:[0.1,0.3],  nozzleDiameter:[0.15,0.5] },
    fibrin:          { temperature:[20,37], cellDensity:[1e6,1e7], speed:[5,15],  pressure:[10,35], layerHeight:[0.1,0.35], nozzleDiameter:[0.2,0.5] },
    hyaluronic_acid: { temperature:[20,37], cellDensity:[5e5,5e6], speed:[3,10],  pressure:[10,35], layerHeight:[0.1,0.3],  nozzleDiameter:[0.2,0.5] }
};

var PARAM_UNITS = {
    temperature: '°C', cellDensity: 'cells/mL', speed: 'mm/s',
    pressure: 'kPa', layerHeight: 'mm', nozzleDiameter: 'mm'
};

var _stats = require('./stats');

function round(v, d) { var f = Math.pow(10, d || 2); return Math.round(v * f) / f; }

var mean = _stats.mean;

/** Sample variance derived from shared stddev (stddev² = variance). */
function variance(arr) { if (arr.length < 2) return 0; var sd = _stats.stddev(arr); return sd * sd; }

function uid() { return ++uid._c; } uid._c = 0;

// ── Factory ─────────────────────────────────────────────────────────

function createExperimentReplicator() {
    var experiments = [];

    // ── Shared Helpers ────────────────────────────────────────────

    /** Group experiments by material — O(n) single pass. */
    function _groupByMaterial() {
        var groups = {};
        for (var i = 0; i < experiments.length; i++) {
            var m = experiments[i].material;
            if (!groups[m]) groups[m] = [];
            groups[m].push(experiments[i]);
        }
        return groups;
    }

    /** Pre-compute per-material statistics: viability variance, success rate. */
    function _materialStats(byMaterial) {
        var stats = {};
        var materials = Object.keys(byMaterial);
        for (var i = 0; i < materials.length; i++) {
            var mat = materials[i];
            var group = byMaterial[mat];
            var viabs = [];
            var succCount = 0;
            for (var j = 0; j < group.length; j++) {
                if (group[j].viability != null) viabs.push(group[j].viability);
                if (group[j].success) succCount++;
            }
            stats[mat] = {
                viabilityVariance: viabs.length >= 2 ? variance(viabs) : 0,
                successRate: group.length ? succCount / group.length : 0.5,
                count: group.length
            };
        }
        return stats;
    }

    // ── Record ───────────────────────────────────────────────────────

    /**
     * Record a completed experiment.
     * @param {Object} params
     * @param {string} params.material
     * @param {number} [params.temperature]
     * @param {number} [params.cellDensity]
     * @param {number} [params.speed]
     * @param {number} [params.pressure]
     * @param {number} [params.layerHeight]
     * @param {number} [params.nozzleDiameter]
     * @param {boolean} params.success
     * @param {number} [params.viability] 0-1
     * @param {string} [params.notes]
     * @returns {Object} recorded experiment with id
     */
    function recordExperiment(params) {
        if (!params || !params.material) throw new Error('material is required');
        if (typeof params.success !== 'boolean') throw new Error('success (boolean) is required');
        var exp = {
            id: uid(),
            material: params.material,
            temperature: params.temperature != null ? +params.temperature : null,
            cellDensity: params.cellDensity != null ? +params.cellDensity : null,
            speed: params.speed != null ? +params.speed : null,
            pressure: params.pressure != null ? +params.pressure : null,
            layerHeight: params.layerHeight != null ? +params.layerHeight : null,
            nozzleDiameter: params.nozzleDiameter != null ? +params.nozzleDiameter : null,
            success: params.success,
            viability: params.viability != null ? +params.viability : null,
            notes: params.notes || '',
            timestamp: Date.now()
        };
        experiments.push(exp);
        return exp;
    }

    // ── Power calculation ────────────────────────────────────────────

    /**
     * Statistical power calculation (two-sample z-test approximation).
     * @param {Object} opts
     * @param {number} [opts.sampleSize]
     * @param {string|number} [opts.effectSize='medium'] Cohen's d or 'small'|'medium'|'large'
     * @param {number} [opts.significance=0.05]
     * @param {number} [opts.targetPower=0.8]
     * @returns {Object} { power, requiredSampleSize, effectSize, significance }
     */
    function calculatePower(opts) {
        opts = opts || {};
        var sig = opts.significance != null ? opts.significance : 0.05;
        var d = typeof opts.effectSize === 'string' ? (EFFECT_SIZES[opts.effectSize] || 0.5) : (opts.effectSize || 0.5);
        var targetPow = opts.targetPower != null ? opts.targetPower : 0.8;
        var zAlpha = phiInv(1 - sig / 2);

        // Calculate power for given sample size
        var power = null;
        if (opts.sampleSize) {
            var n = +opts.sampleSize;
            power = round(phi(d * Math.sqrt(n / 2) - zAlpha), 4);
        }

        // Calculate required sample size for target power
        var zBeta = phiInv(targetPow);
        var reqN = Math.ceil(2 * Math.pow((zAlpha + zBeta) / d, 2));

        // Power curve: power at various sample sizes
        var curve = [];
        for (var n2 = 5; n2 <= Math.max(reqN * 2, 100); n2 += Math.max(1, Math.floor(reqN / 20))) {
            curve.push({ n: n2, power: round(phi(d * Math.sqrt(n2 / 2) - zAlpha), 4) });
        }

        return {
            power: power,
            requiredSampleSize: reqN,
            effectSize: d,
            effectSizeLabel: d <= 0.2 ? 'small' : d <= 0.5 ? 'medium' : 'large',
            significance: sig,
            targetPower: targetPow,
            curve: curve
        };
    }

    // ── Replication plan ─────────────────────────────────────────────

    function findById(id) {
        for (var i = 0; i < experiments.length; i++) {
            if (experiments[i].id === id) return experiments[i];
        }
        return null;
    }

    function countSimilar(exp) {
        var count = 0;
        for (var i = 0; i < experiments.length; i++) {
            if (experiments[i].material === exp.material) count++;
        }
        return count;
    }

    /**
     * Generate replication plan for an experiment.
     * @param {number} experimentId
     * @param {Object} [options]
     * @param {number} [options.variations=3] variations per parameter
     * @param {number} [options.confidenceLevel=0.95]
     * @param {string|number} [options.effectSize='medium']
     * @returns {Object} replication plan
     */
    function planReplication(experimentId, options) {
        var exp = findById(experimentId);
        if (!exp) throw new Error('Experiment ' + experimentId + ' not found');
        options = options || {};
        var numVar = options.variations || 3;
        var confLevel = options.confidenceLevel || 0.95;
        var effSize = options.effectSize || 'medium';

        var ranges = PARAM_RANGES[exp.material] || PARAM_RANGES.alginate;
        var power = calculatePower({ significance: 1 - confLevel, effectSize: effSize });

        // One-at-a-time variations
        var oatVariations = [];
        for (var pi = 0; pi < NUMERIC_PARAMS.length; pi++) {
            var param = NUMERIC_PARAMS[pi];
            var baseVal = exp[param];
            if (baseVal == null) continue;
            var range = ranges[param];
            var lo = range[0], hi = range[1];
            var step = (hi - lo) / (numVar + 1);
            var variations = [];
            for (var vi = 1; vi <= numVar; vi++) {
                var val = round(lo + step * vi, 4);
                if (Math.abs(val - baseVal) > step * 0.1) {
                    var variation = {};
                    for (var k = 0; k < NUMERIC_PARAMS.length; k++) {
                        variation[NUMERIC_PARAMS[k]] = exp[NUMERIC_PARAMS[k]];
                    }
                    variation[param] = val;
                    variation.material = exp.material;
                    variation.variedParam = param;
                    variation.variedFrom = baseVal;
                    variation.variedTo = val;
                    variations.push(variation);
                }
            }
            if (variations.length) {
                oatVariations.push({ parameter: param, unit: PARAM_UNITS[param], baseline: baseVal, variations: variations });
            }
        }

        // Factorial pairs (2-param combinations, low/high only)
        var factorialPairs = [];
        for (var a = 0; a < NUMERIC_PARAMS.length; a++) {
            for (var b = a + 1; b < NUMERIC_PARAMS.length; b++) {
                var pa = NUMERIC_PARAMS[a], pb = NUMERIC_PARAMS[b];
                if (exp[pa] == null || exp[pb] == null) continue;
                var ra = ranges[pa], rb = ranges[pb];
                var combos = [
                    { desc: pa + '(low)+' + pb + '(low)' },
                    { desc: pa + '(low)+' + pb + '(high)' },
                    { desc: pa + '(high)+' + pb + '(low)' },
                    { desc: pa + '(high)+' + pb + '(high)' }
                ];
                var vals = [[ra[0], rb[0]], [ra[0], rb[1]], [ra[1], rb[0]], [ra[1], rb[1]]];
                for (var ci = 0; ci < 4; ci++) {
                    combos[ci][pa] = round(vals[ci][0], 4);
                    combos[ci][pb] = round(vals[ci][1], 4);
                }
                factorialPairs.push({ params: [pa, pb], combinations: combos });
                if (factorialPairs.length >= 6) break;
            }
            if (factorialPairs.length >= 6) break;
        }

        // Estimate success probability for replications
        var similarExps = [];
        for (var si = 0; si < experiments.length; si++) {
            if (experiments[si].material === exp.material) similarExps.push(experiments[si]);
        }
        var successRate = 0.5;
        if (similarExps.length) {
            var succCount = 0;
            for (var sc = 0; sc < similarExps.length; sc++) { if (similarExps[sc].success) succCount++; }
            successRate = round(succCount / similarExps.length, 3);
        }

        var totalExperiments = 0;
        for (var oi = 0; oi < oatVariations.length; oi++) totalExperiments += oatVariations[oi].variations.length;
        totalExperiments += factorialPairs.length * 4;
        totalExperiments += power.requiredSampleSize; // exact replications

        return {
            experimentId: experimentId,
            baseline: exp,
            confidenceLevel: confLevel,
            effectSize: power.effectSize,
            powerAnalysis: power,
            estimatedSuccessRate: successRate,
            totalExperimentsNeeded: totalExperiments,
            exactReplications: power.requiredSampleSize,
            oatVariations: oatVariations,
            factorialPairs: factorialPairs,
            recommendations: buildPlanRecommendations(exp, oatVariations, successRate, power)
        };
    }

    function buildPlanRecommendations(exp, oatVariations, successRate, power) {
        var recs = [];
        if (successRate < 0.5) recs.push({ level: 'warning', text: 'Low success rate (' + round(successRate * 100, 1) + '%) for ' + exp.material + '. Consider narrower parameter ranges.' });
        if (power.requiredSampleSize > 50) recs.push({ level: 'info', text: 'Large sample needed (n=' + power.requiredSampleSize + '). Consider a larger effect size or pilot study first.' });
        if (oatVariations.length < 3) recs.push({ level: 'info', text: 'Few parameters recorded. Add more parameters for comprehensive replication.' });
        recs.push({ level: 'tip', text: 'Start with exact replications before varying parameters to establish baseline reproducibility.' });
        return recs;
    }

    // ── Priority scoring ─────────────────────────────────────────────

    /**
     * Rank experiments by replication urgency.
     * @returns {Array} sorted by urgency (highest first)
     */
    function prioritize() {
        if (!experiments.length) return [];

        var byMaterial = _groupByMaterial();
        var matStats = _materialStats(byMaterial);

        // Pre-compute config counts: key = "material|temperature|speed"
        // Eliminates O(n²) inner loop that previously re-scanned all
        // experiments per experiment to count same-config replicates.
        var configCounts = {};
        for (var i = 0; i < experiments.length; i++) {
            var e = experiments[i];
            var key = e.material + '|' + e.temperature + '|' + e.speed;
            configCounts[key] = (configCounts[key] || 0) + 1;
        }

        var scored = [];
        for (var j = 0; j < experiments.length; j++) {
            var exp = experiments[j];
            var ms = matStats[exp.material];
            var score = 0;
            var reasons = [];

            // Single-run: highest priority — O(1) lookup via pre-computed map
            var cfgKey = exp.material + '|' + exp.temperature + '|' + exp.speed;
            var sameConfig = configCounts[cfgKey] || 0;
            if (sameConfig <= 1) { score += 40; reasons.push('single run (no replicates)'); }
            else if (sameConfig <= 2) { score += 20; reasons.push('only ' + sameConfig + ' replicates'); }

            // High variance in viability — use pre-computed per-material stat
            var v = ms.viabilityVariance;
            if (v > 0.02) { score += 25; reasons.push('high viability variance (' + round(v, 3) + ')'); }
            else if (v > 0.005) { score += 10; reasons.push('moderate viability variance'); }

            // Low success rate — use pre-computed per-material stat
            var succRate = ms.successRate;
            if (succRate < 0.5) { score += 20; reasons.push('low material success rate (' + round(succRate * 100, 0) + '%)'); }

            // Novel parameters (outside typical ranges)
            var ranges = PARAM_RANGES[exp.material];
            if (ranges) {
                for (var np = 0; np < NUMERIC_PARAMS.length; np++) {
                    var pName = NUMERIC_PARAMS[np];
                    var pVal = exp[pName];
                    if (pVal != null && ranges[pName]) {
                        if (pVal < ranges[pName][0] || pVal > ranges[pName][1]) {
                            score += 15;
                            reasons.push(pName + ' outside typical range');
                            break;
                        }
                    }
                }
            }

            // Conflicting results (same material, mixed success)
            if (ms.count >= 2 && succRate > 0.2 && succRate < 0.8) {
                score += 15; reasons.push('conflicting success/failure results');
            }

            scored.push({ experiment: exp, urgencyScore: Math.min(score, 100), reasons: reasons });
        }

        scored.sort(function(a, b) { return b.urgencyScore - a.urgencyScore; });
        return scored;
    }

    // ── Schedule ─────────────────────────────────────────────────────

    /**
     * Generate optimal replication schedule (greedy info-gain).
     * @param {Object} [options]
     * @param {number} [options.maxExperiments=10]
     * @returns {Array} ordered schedule entries
     */
    function generateSchedule(options) {
        options = options || {};
        var maxExp = options.maxExperiments || 10;
        var ranked = prioritize();
        if (!ranked.length) return [];

        var schedule = [];
        var scheduled = {};
        for (var i = 0; i < Math.min(ranked.length, maxExp); i++) {
            var entry = ranked[i];
            if (scheduled[entry.experiment.id]) continue;
            scheduled[entry.experiment.id] = true;

            var similar = countSimilar(entry.experiment);
            var infoGain = round(entry.urgencyScore / Math.max(similar, 1), 2);

            schedule.push({
                order: schedule.length + 1,
                experimentId: entry.experiment.id,
                material: entry.experiment.material,
                urgencyScore: entry.urgencyScore,
                informationGain: infoGain,
                reasons: entry.reasons,
                suggestedReplications: Math.max(3, Math.ceil(10 / Math.max(similar, 1)))
            });
        }

        // Sort by information gain descending
        schedule.sort(function(a, b) { return b.informationGain - a.informationGain; });
        for (var r = 0; r < schedule.length; r++) schedule[r].order = r + 1;

        return schedule;
    }

    // ── Insights ─────────────────────────────────────────────────────

    /**
     * Proactive insights about the experiment collection.
     * @returns {Object}
     */
    function getInsights() {
        if (!experiments.length) return { insights: [], summary: 'No experiments recorded yet.' };

        var insights = [];
        var byMaterial = _groupByMaterial();

        // Under-replicated materials
        var materials = Object.keys(byMaterial);
        for (var mi = 0; mi < materials.length; mi++) {
            var mat = materials[mi];
            var group = byMaterial[mat];
            if (group.length < 3) {
                insights.push({ type: 'under-replicated', severity: 'high', text: mat + ' has only ' + group.length + ' experiment(s). Need ≥3 for basic reproducibility.' });
            }
        }

        // Conflicting results
        for (var ci = 0; ci < materials.length; ci++) {
            var cMat = materials[ci];
            var cGroup = byMaterial[cMat];
            if (cGroup.length >= 2) {
                var succ = 0;
                for (var cs = 0; cs < cGroup.length; cs++) { if (cGroup[cs].success) succ++; }
                var rate = succ / cGroup.length;
                if (rate > 0.2 && rate < 0.8) {
                    insights.push({ type: 'conflict', severity: 'medium', text: cMat + ': mixed results (' + succ + '/' + cGroup.length + ' success). Replication needed to identify cause.' });
                }
            }
        }

        // Parameter sensitivity estimates
        for (var pi = 0; pi < NUMERIC_PARAMS.length; pi++) {
            var param = NUMERIC_PARAMS[pi];
            var succVals = [], failVals = [];
            for (var pj = 0; pj < experiments.length; pj++) {
                if (experiments[pj][param] != null) {
                    if (experiments[pj].success) succVals.push(experiments[pj][param]);
                    else failVals.push(experiments[pj][param]);
                }
            }
            if (succVals.length >= 2 && failVals.length >= 2) {
                var diff = Math.abs(mean(succVals) - mean(failVals));
                var pooledStd = Math.sqrt((variance(succVals) + variance(failVals)) / 2);
                if (pooledStd > 0) {
                    var sensitivity = round(diff / pooledStd, 2);
                    if (sensitivity > 0.5) {
                        insights.push({ type: 'sensitivity', severity: sensitivity > 1 ? 'high' : 'medium', text: param + ' shows significant sensitivity (d=' + sensitivity + '). Careful control recommended.' });
                    }
                }
            }
        }

        // Untested materials
        for (var um = 0; um < MATERIALS.length; um++) {
            if (!byMaterial[MATERIALS[um]]) {
                insights.push({ type: 'gap', severity: 'low', text: 'No experiments recorded for ' + MATERIALS[um] + '.' });
            }
        }

        return {
            insights: insights,
            totalExperiments: experiments.length,
            materialsUsed: materials.length,
            overallSuccessRate: round(experiments.filter(function(e) { return e.success; }).length / experiments.length, 3),
            summary: insights.length + ' insight(s) found across ' + experiments.length + ' experiment(s).'
        };
    }

    // ── Export ────────────────────────────────────────────────────────

    /**
     * Export replication plan in various formats.
     * @param {number} experimentId
     * @param {'json'|'markdown'|'csv'} [format='json']
     * @returns {string}
     */
    function exportPlan(experimentId, format) {
        var plan = planReplication(experimentId);
        format = format || 'json';

        if (format === 'json') return JSON.stringify(plan, null, 2);

        if (format === 'markdown') {
            var md = '# Replication Plan — Experiment #' + experimentId + '\n\n';
            md += '**Material:** ' + plan.baseline.material + '  \n';
            md += '**Estimated Success Rate:** ' + round(plan.estimatedSuccessRate * 100, 1) + '%  \n';
            md += '**Total Experiments Needed:** ' + plan.totalExperimentsNeeded + '  \n';
            md += '**Exact Replications:** ' + plan.exactReplications + '  \n\n';
            md += '## Power Analysis\n\n';
            md += '| Metric | Value |\n|--------|-------|\n';
            md += '| Effect Size | ' + plan.powerAnalysis.effectSize + ' (' + plan.powerAnalysis.effectSizeLabel + ') |\n';
            md += '| Required Sample Size | ' + plan.powerAnalysis.requiredSampleSize + ' |\n';
            md += '| Significance | ' + plan.powerAnalysis.significance + ' |\n\n';
            md += '## One-at-a-Time Variations\n\n';
            for (var oi = 0; oi < plan.oatVariations.length; oi++) {
                var oat = plan.oatVariations[oi];
                md += '### ' + oat.parameter + ' (' + oat.unit + ')\n\n';
                md += 'Baseline: ' + oat.baseline + '\n\n';
                for (var ovi = 0; ovi < oat.variations.length; ovi++) {
                    md += '- Variation ' + (ovi + 1) + ': ' + oat.variations[ovi].variedTo + '\n';
                }
                md += '\n';
            }
            md += '## Recommendations\n\n';
            for (var ri = 0; ri < plan.recommendations.length; ri++) {
                md += '- **' + plan.recommendations[ri].level + ':** ' + plan.recommendations[ri].text + '\n';
            }
            return md;
        }

        if (format === 'csv') {
            var csv = 'parameter,baseline,variation,value\n';
            for (var ci = 0; ci < plan.oatVariations.length; ci++) {
                var csvOat = plan.oatVariations[ci];
                for (var cvi = 0; cvi < csvOat.variations.length; cvi++) {
                    csv += csvOat.parameter + ',' + csvOat.baseline + ',' + (cvi + 1) + ',' + csvOat.variations[cvi].variedTo + '\n';
                }
            }
            return csv;
        }

        return JSON.stringify(plan, null, 2);
    }

    // ── Accessors ────────────────────────────────────────────────────

    function getExperiments() { return experiments.slice(); }

    function getStats() {
        if (!experiments.length) return { total: 0, materials: 0, successRate: 0 };
        var mats = {};
        var succ = 0;
        for (var i = 0; i < experiments.length; i++) {
            mats[experiments[i].material] = true;
            if (experiments[i].success) succ++;
        }
        return {
            total: experiments.length,
            materials: Object.keys(mats).length,
            successRate: round(succ / experiments.length, 3),
            avgViability: round(mean(experiments.filter(function(e) { return e.viability != null; }).map(function(e) { return e.viability; })), 3)
        };
    }

    return {
        recordExperiment: recordExperiment,
        planReplication: planReplication,
        calculatePower: calculatePower,
        prioritize: prioritize,
        generateSchedule: generateSchedule,
        getInsights: getInsights,
        exportPlan: exportPlan,
        getExperiments: getExperiments,
        getStats: getStats
    };
}

module.exports = { createExperimentReplicator: createExperimentReplicator };
