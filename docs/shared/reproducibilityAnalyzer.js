'use strict';

/**
 * Experiment Reproducibility Analyzer
 *
 * Autonomous reproducibility assessment system that analyzes repeated
 * experiments to detect variance, score consistency, and generate
 * actionable recommendations for improving experimental reproducibility.
 *
 * 7 Engines:
 *   1. Experiment Registry — record/retrieve/group experiments
 *   2. Repetition Matcher — find repeated experiments via protocol grouping
 *   3. Variance Decomposer — CV analysis, parameter sensitivity
 *   4. Reproducibility Scorer — composite 0-100 scoring with tiers
 *   5. Drift Detector — temporal reproducibility degradation tracking
 *   6. Improvement Recommender — ranked actionable recommendations
 *   7. Insight Generator — autonomous pattern discovery
 *
 * Agentic features:
 *   - Proactive reproducibility degradation detection
 *   - Golden parameter range identification
 *   - Operator and equipment variance attribution
 *   - Cross-protocol parameter importance learning
 *   - Self-monitoring health scoring
 */

var _stats = require('./stats');
var mean = _stats.mean;
var stddev = _stats.stddev;
var linearRegression = _stats.linearRegression;

var _isDangerousKey = require('./sanitize').isDangerousKey;

// ── Tiers ──────────────────────────────────────────────────────────

var REPRODUCIBILITY_TIERS = [
    { min: 0,  max: 20, label: 'Irreproducible' },
    { min: 21, max: 40, label: 'Poor' },
    { min: 41, max: 60, label: 'Fair' },
    { min: 61, max: 80, label: 'Good' },
    { min: 81, max: 100, label: 'Excellent' }
];

var HEALTH_TIERS = [
    { min: 0,  max: 20, label: 'Critical' },
    { min: 21, max: 40, label: 'Poor' },
    { min: 41, max: 60, label: 'Fair' },
    { min: 61, max: 80, label: 'Good' },
    { min: 81, max: 100, label: 'Excellent' }
];

var VALID_OUTCOMES = { success: true, partial: true, failure: true };

// ── Weights ────────────────────────────────────────────────────────

var WEIGHT_OUTCOME = 0.40;
var WEIGHT_METRIC_CV = 0.35;
var WEIGHT_PARAM_ADHERENCE = 0.25;

// ── Helpers ────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function tierLabel(score, tiers) {
    var s = Math.round(score);
    for (var i = 0; i < tiers.length; i++) {
        if (s >= tiers[i].min && s <= tiers[i].max) return tiers[i].label;
    }
    return 'Unknown';
}

function objectKeys(obj) {
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj);
}

function safeKeys(obj) {
    return objectKeys(obj).filter(function (k) { return !_isDangerousKey(k); });
}

function toEpoch(ts) {
    if (ts == null) return Date.now();
    if (typeof ts === 'number') return ts;
    var d = new Date(ts);
    return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

function numericValues(obj, keys) {
    var vals = [];
    for (var i = 0; i < keys.length; i++) {
        var v = obj[keys[i]];
        if (typeof v === 'number' && isFinite(v)) vals.push(v);
    }
    return vals;
}

function coefficientOfVariation(values) {
    if (values.length < 2) return 0;
    var m = mean(values);
    if (m === 0) return 0;
    var s = stddev(values);
    return Math.abs(s / m);
}

function computeCorrelation(xs, ys) {
    if (xs.length < 3) return 0;
    var mx = mean(xs);
    var my = mean(ys);
    var num = 0, dx2 = 0, dy2 = 0;
    for (var i = 0; i < xs.length; i++) {
        var dx = xs[i] - mx;
        var dy = ys[i] - my;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    var denom = Math.sqrt(dx2 * dy2);
    return denom === 0 ? 0 : num / denom;
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create a new Reproducibility Analyzer instance.
 *
 * @param {Object} [opts]
 * @param {number} [opts.similarityThreshold=0.85] - Parameter similarity threshold (0-1)
 * @param {number} [opts.minRepetitions=3] - Minimum repetitions for scoring
 * @returns {Object} Analyzer API
 */
function createReproducibilityAnalyzer(opts) {
    var options = Object.assign({
        similarityThreshold: 0.85,
        minRepetitions: 3
    }, opts);

    var experiments = [];

    // ── Engine 1: Experiment Registry ──────────────────────────────

    function record(exp) {
        if (!exp || typeof exp !== 'object') {
            throw new Error('Experiment must be a non-null object');
        }
        if (!exp.protocol || typeof exp.protocol !== 'string') {
            throw new Error('Experiment must have a string protocol name');
        }
        if (!exp.outcome || !VALID_OUTCOMES[exp.outcome]) {
            throw new Error('Experiment outcome must be one of: success, partial, failure');
        }

        // Sanitize parameters
        var params = {};
        if (exp.parameters && typeof exp.parameters === 'object') {
            var pkeys = Object.keys(exp.parameters);
            for (var i = 0; i < pkeys.length; i++) {
                if (_isDangerousKey(pkeys[i])) {
                    throw new Error('Dangerous key detected in parameters: ' + pkeys[i]);
                }
                params[pkeys[i]] = exp.parameters[pkeys[i]];
            }
        }

        // Sanitize metrics
        var metrics = {};
        if (exp.metrics && typeof exp.metrics === 'object') {
            var mkeys = Object.keys(exp.metrics);
            for (var j = 0; j < mkeys.length; j++) {
                if (_isDangerousKey(mkeys[j])) {
                    throw new Error('Dangerous key detected in metrics: ' + mkeys[j]);
                }
                metrics[mkeys[j]] = exp.metrics[mkeys[j]];
            }
        }

        var entry = {
            id: experiments.length + 1,
            protocol: exp.protocol,
            parameters: params,
            outcome: exp.outcome,
            metrics: metrics,
            timestamp: toEpoch(exp.timestamp),
            operator: exp.operator || 'unknown',
            equipment: exp.equipment || 'default'
        };

        experiments.push(entry);
        return entry;
    }

    function getByProtocol(protocol) {
        var result = [];
        for (var i = 0; i < experiments.length; i++) {
            if (experiments[i].protocol === protocol) result.push(experiments[i]);
        }
        return result;
    }

    function getProtocols() {
        var seen = Object.create(null);
        var result = [];
        for (var i = 0; i < experiments.length; i++) {
            var p = experiments[i].protocol;
            if (!seen[p]) {
                seen[p] = true;
                result.push(p);
            }
        }
        return result;
    }

    // ── Engine 2: Repetition Matcher ───────────────────────────────

    function findRepetitions() {
        var groups = Object.create(null);
        for (var i = 0; i < experiments.length; i++) {
            var p = experiments[i].protocol;
            if (!groups[p]) groups[p] = [];
            groups[p].push(experiments[i]);
        }
        return groups;
    }

    // ── Engine 3: Variance Decomposer ──────────────────────────────

    function decomposeVariance(group) {
        if (group.length < 2) return { metricCVs: {}, parameterSensitivity: {}, avgMetricCV: 0, avgParamCV: 0 };

        // Collect all metric keys
        var metricKeys = Object.create(null);
        var paramKeys = Object.create(null);
        for (var i = 0; i < group.length; i++) {
            var mk = safeKeys(group[i].metrics);
            for (var j = 0; j < mk.length; j++) metricKeys[mk[j]] = true;
            var pk = safeKeys(group[i].parameters);
            for (var k = 0; k < pk.length; k++) paramKeys[pk[k]] = true;
        }
        var mkeys = Object.keys(metricKeys);
        var pkeys = Object.keys(paramKeys);

        // Compute CV for each metric
        var metricCVs = {};
        var cvValues = [];
        for (var mi = 0; mi < mkeys.length; mi++) {
            var vals = [];
            for (var gi = 0; gi < group.length; gi++) {
                var v = group[gi].metrics[mkeys[mi]];
                if (typeof v === 'number' && isFinite(v)) vals.push(v);
            }
            var cv = coefficientOfVariation(vals);
            metricCVs[mkeys[mi]] = { cv: cv, n: vals.length, mean: mean(vals), stddev: vals.length > 1 ? stddev(vals) : 0 };
            if (vals.length >= 2) cvValues.push(cv);
        }

        // Parameter sensitivity: correlation between each parameter and each metric
        var parameterSensitivity = {};
        var paramCVValues = [];
        for (var pi = 0; pi < pkeys.length; pi++) {
            var pvals = [];
            for (var pgi = 0; pgi < group.length; pgi++) {
                var pv = group[pgi].parameters[pkeys[pi]];
                if (typeof pv === 'number' && isFinite(pv)) pvals.push(pv);
            }
            var paramCV = coefficientOfVariation(pvals);
            paramCVValues.push(paramCV);

            var correlations = {};
            for (var cmi = 0; cmi < mkeys.length; cmi++) {
                var mvals = [];
                var matchedPvals = [];
                for (var cgi = 0; cgi < group.length; cgi++) {
                    var cpv = group[cgi].parameters[pkeys[pi]];
                    var cmv = group[cgi].metrics[mkeys[cmi]];
                    if (typeof cpv === 'number' && isFinite(cpv) && typeof cmv === 'number' && isFinite(cmv)) {
                        matchedPvals.push(cpv);
                        mvals.push(cmv);
                    }
                }
                correlations[mkeys[cmi]] = computeCorrelation(matchedPvals, mvals);
            }
            parameterSensitivity[pkeys[pi]] = { cv: paramCV, correlations: correlations };
        }

        return {
            metricCVs: metricCVs,
            parameterSensitivity: parameterSensitivity,
            avgMetricCV: cvValues.length > 0 ? mean(cvValues) : 0,
            avgParamCV: paramCVValues.length > 0 ? mean(paramCVValues) : 0
        };
    }

    // ── Engine 4: Reproducibility Scorer ───────────────────────────

    function scoreProtocol(group) {
        if (group.length < 2) {
            return { score: 0, tier: 'Irreproducible', components: {}, reason: 'Insufficient repetitions' };
        }

        // Outcome consistency: fraction of most-common outcome
        var outcomeCounts = Object.create(null);
        for (var i = 0; i < group.length; i++) {
            var o = group[i].outcome;
            outcomeCounts[o] = (outcomeCounts[o] || 0) + 1;
        }
        var maxCount = 0;
        var oKeys = Object.keys(outcomeCounts);
        for (var oi = 0; oi < oKeys.length; oi++) {
            if (outcomeCounts[oKeys[oi]] > maxCount) maxCount = outcomeCounts[oKeys[oi]];
        }
        var outcomeConsistency = (maxCount / group.length) * 100;

        // Variance decomposition
        var variance = decomposeVariance(group);
        var metricScore = 100 - clamp(variance.avgMetricCV * 200, 0, 100);
        var paramScore = 100 - clamp(variance.avgParamCV * 200, 0, 100);

        var composite = outcomeConsistency * WEIGHT_OUTCOME +
                        metricScore * WEIGHT_METRIC_CV +
                        paramScore * WEIGHT_PARAM_ADHERENCE;

        composite = clamp(Math.round(composite * 10) / 10, 0, 100);

        return {
            score: composite,
            tier: tierLabel(composite, REPRODUCIBILITY_TIERS),
            components: {
                outcomeConsistency: Math.round(outcomeConsistency * 10) / 10,
                metricCV: Math.round(metricScore * 10) / 10,
                parameterAdherence: Math.round(paramScore * 10) / 10
            },
            variance: variance,
            experimentCount: group.length
        };
    }

    // ── Engine 5: Drift Detector ───────────────────────────────────

    function detectDrift(group) {
        if (group.length < 4) {
            return { drifting: false, reason: 'Insufficient data for drift analysis' };
        }

        // Sort by timestamp
        var sorted = group.slice().sort(function (a, b) { return a.timestamp - b.timestamp; });

        // Compute rolling reproducibility using sliding windows of 3
        var windowSize = Math.min(3, Math.floor(sorted.length / 2));
        if (windowSize < 2) return { drifting: false, reason: 'Window too small' };

        var scores = [];
        var timepoints = [];
        for (var i = 0; i <= sorted.length - windowSize; i++) {
            var window = sorted.slice(i, i + windowSize);
            var ws = scoreProtocol(window);
            scores.push(ws.score);
            timepoints.push(i);
        }

        if (scores.length < 2) return { drifting: false, reason: 'Not enough windows' };

        var reg = linearRegression(timepoints, scores);
        var slope = reg.slope || 0;

        return {
            drifting: slope < -2,
            slope: Math.round(slope * 100) / 100,
            direction: slope < -2 ? 'degrading' : slope > 2 ? 'improving' : 'stable',
            windowScores: scores,
            regression: reg
        };
    }

    // ── Engine 6: Improvement Recommender ──────────────────────────

    function recommend(protocolName) {
        var group = getByProtocol(protocolName);
        if (group.length < 2) return [];

        var result = scoreProtocol(group);
        var variance = result.variance;
        var recommendations = [];
        var priority = 1;

        // High metric CV → tighter measurement protocols
        if (result.components.metricCV < 60) {
            recommendations.push({
                priority: priority++,
                category: 'measurement',
                action: 'Standardize measurement protocols to reduce metric variability',
                impact: 'high',
                detail: 'Average metric CV is ' + (variance.avgMetricCV * 100).toFixed(1) + '%. Target < 10%.'
            });
        }

        // Low parameter adherence → tighter parameter control
        if (result.components.parameterAdherence < 60) {
            recommendations.push({
                priority: priority++,
                category: 'parameter_control',
                action: 'Implement tighter parameter controls to reduce input variability',
                impact: 'high',
                detail: 'Average parameter CV is ' + (variance.avgParamCV * 100).toFixed(1) + '%. Standardize settings.'
            });
        }

        // Low outcome consistency → protocol review
        if (result.components.outcomeConsistency < 80) {
            recommendations.push({
                priority: priority++,
                category: 'protocol',
                action: 'Review and standardize experiment protocol to improve outcome consistency',
                impact: 'high',
                detail: 'Outcome consistency is ' + result.components.outcomeConsistency + '%. Investigate failure causes.'
            });
        }

        // Identify highest-sensitivity parameters
        var sensKeys = safeKeys(variance.parameterSensitivity);
        for (var si = 0; si < sensKeys.length; si++) {
            var sens = variance.parameterSensitivity[sensKeys[si]];
            if (sens.cv > 0.1) {
                var corrKeys = safeKeys(sens.correlations);
                var maxCorr = 0;
                for (var ci = 0; ci < corrKeys.length; ci++) {
                    var absCorr = Math.abs(sens.correlations[corrKeys[ci]]);
                    if (absCorr > maxCorr) maxCorr = absCorr;
                }
                if (maxCorr > 0.5) {
                    recommendations.push({
                        priority: priority++,
                        category: 'calibration',
                        action: 'Calibrate and tightly control parameter: ' + sensKeys[si],
                        impact: maxCorr > 0.7 ? 'high' : 'medium',
                        detail: sensKeys[si] + ' has CV=' + (sens.cv * 100).toFixed(1) + '% and strong metric correlation (' + maxCorr.toFixed(2) + ')'
                    });
                }
            }
        }

        // Operator variation
        var operators = Object.create(null);
        for (var oi = 0; oi < group.length; oi++) {
            var op = group[oi].operator;
            if (!operators[op]) operators[op] = [];
            operators[op].push(group[oi]);
        }
        var opKeys = Object.keys(operators);
        if (opKeys.length > 1) {
            var opScores = [];
            for (var ok = 0; ok < opKeys.length; ok++) {
                if (operators[opKeys[ok]].length >= 2) {
                    opScores.push({ operator: opKeys[ok], score: scoreProtocol(operators[opKeys[ok]]).score });
                }
            }
            if (opScores.length > 1) {
                var scores_arr = opScores.map(function (o) { return o.score; });
                var scoreRange = Math.max.apply(null, scores_arr) - Math.min.apply(null, scores_arr);
                if (scoreRange > 15) {
                    recommendations.push({
                        priority: priority++,
                        category: 'training',
                        action: 'Standardize operator training — significant inter-operator variability detected',
                        impact: scoreRange > 30 ? 'high' : 'medium',
                        detail: 'Operator score range: ' + scoreRange.toFixed(1) + ' points across ' + opKeys.length + ' operators'
                    });
                }
            }
        }

        // Equipment variation
        var equipGroups = Object.create(null);
        for (var ei = 0; ei < group.length; ei++) {
            var eq = group[ei].equipment;
            if (!equipGroups[eq]) equipGroups[eq] = [];
            equipGroups[eq].push(group[ei]);
        }
        var eqKeys = Object.keys(equipGroups);
        if (eqKeys.length > 1) {
            recommendations.push({
                priority: priority++,
                category: 'equipment',
                action: 'Standardize equipment usage or cross-calibrate instruments',
                impact: 'medium',
                detail: eqKeys.length + ' different equipment units used. Consider single-equipment runs for critical experiments.'
            });
        }

        // Drift detection
        var drift = detectDrift(group);
        if (drift.drifting) {
            recommendations.push({
                priority: 1, // Highest priority if drifting
                category: 'urgent',
                action: 'URGENT: Reproducibility is degrading over time — investigate immediately',
                impact: 'critical',
                detail: 'Reproducibility slope: ' + drift.slope + ' points per window. Check for equipment wear, reagent degradation, or protocol drift.'
            });
        }

        recommendations.sort(function (a, b) { return a.priority - b.priority; });
        return recommendations;
    }

    // ── Engine 7: Insight Generator ────────────────────────────────

    function generateInsights() {
        var protocols = getProtocols();
        if (protocols.length === 0) return [];

        var insights = [];
        var allScores = [];

        for (var i = 0; i < protocols.length; i++) {
            var group = getByProtocol(protocols[i]);
            if (group.length >= 2) {
                var result = scoreProtocol(group);
                allScores.push({ protocol: protocols[i], score: result.score, tier: result.tier, count: group.length });
            }
        }

        if (allScores.length === 0) {
            insights.push({ type: 'info', message: 'No protocols with sufficient repetitions for analysis' });
            return insights;
        }

        // Best and worst protocols
        allScores.sort(function (a, b) { return b.score - a.score; });
        insights.push({
            type: 'best_protocol',
            message: 'Most reproducible: ' + allScores[0].protocol + ' (score: ' + allScores[0].score + ', ' + allScores[0].tier + ')',
            protocol: allScores[0].protocol,
            score: allScores[0].score
        });

        if (allScores.length > 1) {
            var worst = allScores[allScores.length - 1];
            insights.push({
                type: 'worst_protocol',
                message: 'Least reproducible: ' + worst.protocol + ' (score: ' + worst.score + ', ' + worst.tier + ')',
                protocol: worst.protocol,
                score: worst.score
            });
        }

        // Golden parameters: parameters in high-scoring protocols with low CV
        for (var gi = 0; gi < allScores.length; gi++) {
            if (allScores[gi].score >= 80) {
                var gGroup = getByProtocol(allScores[gi].protocol);
                var gVariance = decomposeVariance(gGroup);
                var goldenParams = [];
                var gpKeys = safeKeys(gVariance.parameterSensitivity);
                for (var gpi = 0; gpi < gpKeys.length; gpi++) {
                    if (gVariance.parameterSensitivity[gpKeys[gpi]].cv < 0.05) {
                        // Find the mean value of this parameter
                        var gvals = [];
                        for (var gvi = 0; gvi < gGroup.length; gvi++) {
                            var gv = gGroup[gvi].parameters[gpKeys[gpi]];
                            if (typeof gv === 'number' && isFinite(gv)) gvals.push(gv);
                        }
                        if (gvals.length > 0) {
                            goldenParams.push({ name: gpKeys[gpi], value: mean(gvals), cv: gVariance.parameterSensitivity[gpKeys[gpi]].cv });
                        }
                    }
                }
                if (goldenParams.length > 0) {
                    insights.push({
                        type: 'golden_parameters',
                        message: 'Golden parameters in ' + allScores[gi].protocol + ': ' + goldenParams.map(function (p) { return p.name + '≈' + p.value.toFixed(2); }).join(', '),
                        protocol: allScores[gi].protocol,
                        parameters: goldenParams
                    });
                }
            }
        }

        // Operator comparison across protocols
        var operatorStats = Object.create(null);
        for (var oi = 0; oi < experiments.length; oi++) {
            var op = experiments[oi].operator;
            if (op === 'unknown') continue;
            if (!operatorStats[op]) operatorStats[op] = { total: 0, success: 0 };
            operatorStats[op].total++;
            if (experiments[oi].outcome === 'success') operatorStats[op].success++;
        }
        var opStatKeys = Object.keys(operatorStats);
        if (opStatKeys.length > 1) {
            var opComparisons = opStatKeys.map(function (k) {
                return { operator: k, successRate: operatorStats[k].total > 0 ? operatorStats[k].success / operatorStats[k].total : 0, total: operatorStats[k].total };
            });
            opComparisons.sort(function (a, b) { return b.successRate - a.successRate; });
            insights.push({
                type: 'operator_comparison',
                message: 'Operator success rates: ' + opComparisons.map(function (o) { return o.operator + '=' + (o.successRate * 100).toFixed(0) + '%'; }).join(', '),
                operators: opComparisons
            });
        }

        // Overall health trend
        var avgScore = mean(allScores.map(function (s) { return s.score; }));
        insights.push({
            type: 'overall_health',
            message: 'Overall reproducibility: ' + avgScore.toFixed(1) + '/100 (' + tierLabel(avgScore, REPRODUCIBILITY_TIERS) + ') across ' + allScores.length + ' protocols',
            averageScore: Math.round(avgScore * 10) / 10
        });

        return insights;
    }

    // ── Public API ─────────────────────────────────────────────────

    function analyze() {
        var protocols = getProtocols();
        var results = {};
        for (var i = 0; i < protocols.length; i++) {
            var group = getByProtocol(protocols[i]);
            results[protocols[i]] = {
                score: scoreProtocol(group),
                drift: detectDrift(group),
                recommendations: recommend(protocols[i]),
                experimentCount: group.length
            };
        }

        return {
            protocols: results,
            insights: generateInsights(),
            health: getHealth(),
            totalExperiments: experiments.length,
            protocolCount: protocols.length
        };
    }

    function analyzeProtocol(protocolName) {
        var group = getByProtocol(protocolName);
        if (group.length === 0) return null;

        return {
            protocol: protocolName,
            score: scoreProtocol(group),
            drift: detectDrift(group),
            variance: decomposeVariance(group),
            recommendations: recommend(protocolName),
            experimentCount: group.length
        };
    }

    function getReproducibilityScore(protocolName) {
        var group = getByProtocol(protocolName);
        if (group.length < 2) return null;
        var result = scoreProtocol(group);
        return { score: result.score, tier: result.tier };
    }

    function getHealth() {
        var protocols = getProtocols();
        if (experiments.length === 0) {
            return { score: 0, tier: 'Critical', reason: 'No experiments recorded' };
        }

        var scores = [];
        var driftCount = 0;
        for (var i = 0; i < protocols.length; i++) {
            var group = getByProtocol(protocols[i]);
            if (group.length >= 2) {
                var result = scoreProtocol(group);
                scores.push(result.score);
                var drift = detectDrift(group);
                if (drift.drifting) driftCount++;
            }
        }

        if (scores.length === 0) {
            return { score: 30, tier: 'Poor', reason: 'No protocols with enough repetitions' };
        }

        var avgScore = mean(scores);
        // Penalize for drifting protocols
        var driftPenalty = driftCount * 10;
        var healthScore = clamp(Math.round((avgScore - driftPenalty) * 10) / 10, 0, 100);

        return {
            score: healthScore,
            tier: tierLabel(healthScore, HEALTH_TIERS),
            protocolsAnalyzed: scores.length,
            driftingProtocols: driftCount,
            averageReproducibility: Math.round(avgScore * 10) / 10
        };
    }

    return {
        record: record,
        analyze: analyze,
        analyzeProtocol: analyzeProtocol,
        getReproducibilityScore: getReproducibilityScore,
        recommend: recommend,
        generateInsights: generateInsights,
        getHealth: getHealth,
        getExperimentCount: function () { return experiments.length; },
        getProtocols: getProtocols,
        reset: function () { experiments = []; }
    };
}

module.exports = { createReproducibilityAnalyzer: createReproducibilityAnalyzer };
