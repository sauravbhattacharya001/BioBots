'use strict';

/**
 * Experiment Outcome Oracle Engine
 *
 * Autonomous pre-experiment outcome prediction system that uses historical
 * experiment data to forecast outcomes of planned experiments using
 * k-nearest-neighbor parameter similarity, distance-weighted voting,
 * and confidence calibration.
 *
 * 7 Engines:
 *   1. Historical Knowledge Base — experiment recording and retrieval
 *   2. Similarity Engine — normalized Euclidean distance matching
 *   3. Outcome Predictor — distance-weighted voting prediction
 *   4. Metric Forecaster — weighted average metric forecasting with CI
 *   5. Risk Assessor — multi-category risk analysis
 *   6. Oracle Health Scorer — composite health 0-100
 *   7. Insight Generator — autonomous pattern discovery
 *
 * Agentic features:
 *   - Proactive risk detection before experiment execution
 *   - Autonomous golden/danger parameter identification
 *   - Parameter sensitivity analysis and trending detection
 *   - Confidence-calibrated predictions with influencer tracing
 *   - Self-monitoring knowledge base health scoring
 */

var _stats = require('./stats');
var mean = _stats.mean;
var stddev = _stats.stddev;
var linearRegression = _stats.linearRegression;

var _isDangerousKey = require('./sanitize').isDangerousKey;

// ── Tiers ──────────────────────────────────────────────────────────

var TIERS = [
    { min: 0,  max: 20, label: 'Critical' },
    { min: 21, max: 40, label: 'Poor' },
    { min: 41, max: 60, label: 'Fair' },
    { min: 61, max: 80, label: 'Good' },
    { min: 81, max: 100, label: 'Excellent' }
];

var RISK_TIERS = [
    { min: 0,  max: 25, label: 'Low' },
    { min: 26, max: 50, label: 'Moderate' },
    { min: 51, max: 75, label: 'High' },
    { min: 76, max: 100, label: 'Critical' }
];

var VALID_OUTCOMES = { success: true, partial: true, failure: true };

function tierLabel(score, tiers) {
    for (var i = 0; i < tiers.length; i++) {
        if (score >= tiers[i].min && score <= tiers[i].max) return tiers[i].label;
    }
    return 'Unknown';
}

// ── Helpers ────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function toEpoch(ts) {
    if (ts == null) return Date.now();
    if (typeof ts === 'number') return ts;
    var d = new Date(ts);
    return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

function objectKeys(obj) {
    if (!obj || typeof obj !== 'object') return [];
    return Object.keys(obj);
}

function euclideanDistance(a, b, paramKeys, ranges) {
    var sumSq = 0;
    var count = 0;
    for (var i = 0; i < paramKeys.length; i++) {
        var k = paramKeys[i];
        if (typeof a[k] === 'number' && typeof b[k] === 'number') {
            var range = ranges[k] || 1;
            var normA = range === 0 ? 0 : (a[k] - ranges[k + '_min']) / range;
            var normB = range === 0 ? 0 : (b[k] - ranges[k + '_min']) / range;
            var diff = normA - normB;
            sumSq += diff * diff;
            count++;
        }
    }
    if (count === 0) return Infinity;
    return Math.sqrt(sumSq / count);
}

// ── Factory ────────────────────────────────────────────────────────

function createOutcomeOracle() {
    var experiments = [];
    var experimentsById = Object.create(null);

    // ── Engine 1: Historical Knowledge Base ────────────────────────

    function recordExperiment(opts) {
        if (!opts || !opts.id) {
            return { success: false, error: 'id is required' };
        }
        if (_isDangerousKey(opts.id)) {
            return { success: false, error: 'Invalid experiment id' };
        }
        if (typeof opts.id !== 'string' || opts.id.trim() === '') {
            return { success: false, error: 'id must be a non-empty string' };
        }
        if (!opts.outcome || !VALID_OUTCOMES[opts.outcome]) {
            return { success: false, error: 'outcome must be success, partial, or failure' };
        }
        var exp = {
            id: opts.id,
            type: opts.type || 'general',
            parameters: (opts.parameters && typeof opts.parameters === 'object') ? opts.parameters : {},
            outcome: opts.outcome,
            metrics: (opts.metrics && typeof opts.metrics === 'object') ? opts.metrics : {},
            tags: Array.isArray(opts.tags) ? opts.tags.slice() : [],
            timestamp: toEpoch(opts.timestamp)
        };
        experiments.push(exp);
        experimentsById[exp.id] = exp;
        return { success: true, experiment: exp };
    }

    function getExperimentCount() {
        return experiments.length;
    }

    // ── Parameter Range Computation ────────────────────────────────

    function computeParamRanges(subset) {
        var ranges = Object.create(null);
        var allKeys = Object.create(null);
        var i, j, keys, k;
        for (i = 0; i < subset.length; i++) {
            keys = objectKeys(subset[i].parameters);
            for (j = 0; j < keys.length; j++) {
                k = keys[j];
                if (typeof subset[i].parameters[k] !== 'number') continue;
                if (!(k in allKeys)) {
                    allKeys[k] = true;
                    ranges[k + '_min'] = subset[i].parameters[k];
                    ranges[k + '_max'] = subset[i].parameters[k];
                } else {
                    if (subset[i].parameters[k] < ranges[k + '_min']) ranges[k + '_min'] = subset[i].parameters[k];
                    if (subset[i].parameters[k] > ranges[k + '_max']) ranges[k + '_max'] = subset[i].parameters[k];
                }
            }
        }
        var paramKeys = Object.keys(allKeys);
        for (i = 0; i < paramKeys.length; i++) {
            k = paramKeys[i];
            ranges[k] = ranges[k + '_max'] - ranges[k + '_min'];
        }
        ranges._paramKeys = paramKeys;
        return ranges;
    }

    function filterByType(type) {
        if (!type) return experiments;
        var result = [];
        for (var i = 0; i < experiments.length; i++) {
            if (experiments[i].type === type) result.push(experiments[i]);
        }
        return result;
    }

    // ── Engine 2: Similarity Engine ────────────────────────────────

    function findSimilar(opts) {
        if (!opts || !opts.parameters) {
            return { matches: [], count: 0 };
        }
        var subset = filterByType(opts.type);
        if (subset.length === 0) return { matches: [], count: 0 };

        var ranges = computeParamRanges(subset);
        var paramKeys = ranges._paramKeys;
        var limit = (typeof opts.limit === 'number' && opts.limit > 0) ? opts.limit : 5;

        var scored = [];
        for (var i = 0; i < subset.length; i++) {
            var dist = euclideanDistance(opts.parameters, subset[i].parameters, paramKeys, ranges);
            if (dist === Infinity) continue;
            scored.push({ experiment: subset[i], distance: Math.round(dist * 10000) / 10000, similarity: Math.round((1 / (1 + dist)) * 10000) / 10000 });
        }
        scored.sort(function (a, b) { return a.distance - b.distance; });
        var matches = scored.slice(0, limit);
        return { matches: matches, count: matches.length };
    }

    // ── Engine 3: Outcome Predictor ────────────────────────────────

    function predictOutcome(opts) {
        if (!opts || !opts.parameters) {
            return { prediction: 'failure', probabilities: { success: 0, partial: 0, failure: 1 }, confidence: 0, matchCount: 0, topInfluencers: [] };
        }
        var subset = filterByType(opts.type);
        if (subset.length === 0) {
            return { prediction: 'failure', probabilities: { success: 0, partial: 0, failure: 1 }, confidence: 0, matchCount: 0, topInfluencers: [] };
        }

        var ranges = computeParamRanges(subset);
        var paramKeys = ranges._paramKeys;
        var k = (typeof opts.k === 'number' && opts.k > 0) ? opts.k : 10;

        var scored = [];
        for (var i = 0; i < subset.length; i++) {
            var dist = euclideanDistance(opts.parameters, subset[i].parameters, paramKeys, ranges);
            if (dist === Infinity) continue;
            scored.push({ experiment: subset[i], distance: dist });
        }
        scored.sort(function (a, b) { return a.distance - b.distance; });

        var topK = scored.slice(0, k);
        if (topK.length === 0) {
            return { prediction: 'failure', probabilities: { success: 0, partial: 0, failure: 1 }, confidence: 0, matchCount: 0, topInfluencers: [] };
        }

        var votes = { success: 0, partial: 0, failure: 0 };
        var totalWeight = 0;
        for (i = 0; i < topK.length; i++) {
            var w = 1 / Math.pow(1 + topK[i].distance, 2);
            votes[topK[i].experiment.outcome] += w;
            totalWeight += w;
        }

        var probabilities = {
            success: totalWeight > 0 ? Math.round((votes.success / totalWeight) * 1000) / 1000 : 0,
            partial: totalWeight > 0 ? Math.round((votes.partial / totalWeight) * 1000) / 1000 : 0,
            failure: totalWeight > 0 ? Math.round((votes.failure / totalWeight) * 1000) / 1000 : 0
        };

        var prediction = 'failure';
        var maxProb = 0;
        var outcomeNames = ['success', 'partial', 'failure'];
        for (i = 0; i < outcomeNames.length; i++) {
            if (probabilities[outcomeNames[i]] > maxProb) {
                maxProb = probabilities[outcomeNames[i]];
                prediction = outcomeNames[i];
            }
        }

        // Confidence: based on match count and similarity concentration
        var avgSim = 0;
        for (i = 0; i < topK.length; i++) {
            avgSim += 1 / (1 + topK[i].distance);
        }
        avgSim = avgSim / topK.length;
        var countFactor = Math.min(topK.length / 5, 1);
        var confidence = Math.round(clamp(avgSim * countFactor * 100, 0, 100));

        var topInfluencers = [];
        var influencerLimit = Math.min(3, topK.length);
        for (i = 0; i < influencerLimit; i++) {
            topInfluencers.push({
                id: topK[i].experiment.id,
                outcome: topK[i].experiment.outcome,
                distance: Math.round(topK[i].distance * 10000) / 10000,
                similarity: Math.round((1 / (1 + topK[i].distance)) * 10000) / 10000
            });
        }

        return {
            prediction: prediction,
            probabilities: probabilities,
            confidence: confidence,
            matchCount: topK.length,
            topInfluencers: topInfluencers
        };
    }

    // ── Engine 4: Metric Forecaster ────────────────────────────────

    function forecastMetrics(opts) {
        if (!opts || !opts.parameters) {
            return { forecasts: {}, confidence: 0 };
        }
        var subset = filterByType(opts.type);
        if (subset.length === 0) return { forecasts: {}, confidence: 0 };

        var ranges = computeParamRanges(subset);
        var paramKeys = ranges._paramKeys;
        var k = (typeof opts.k === 'number' && opts.k > 0) ? opts.k : 10;

        var scored = [];
        for (var i = 0; i < subset.length; i++) {
            var dist = euclideanDistance(opts.parameters, subset[i].parameters, paramKeys, ranges);
            if (dist === Infinity) continue;
            scored.push({ experiment: subset[i], distance: dist, weight: 1 / Math.pow(1 + dist, 2) });
        }
        scored.sort(function (a, b) { return a.distance - b.distance; });
        var topK = scored.slice(0, k);

        if (topK.length === 0) return { forecasts: {}, confidence: 0 };

        // Collect all metric keys
        var metricKeys = Object.create(null);
        for (i = 0; i < topK.length; i++) {
            var mKeys = objectKeys(topK[i].experiment.metrics);
            for (var j = 0; j < mKeys.length; j++) {
                if (typeof topK[i].experiment.metrics[mKeys[j]] === 'number') {
                    metricKeys[mKeys[j]] = true;
                }
            }
        }

        var forecasts = {};
        var allMetricNames = Object.keys(metricKeys);
        for (i = 0; i < allMetricNames.length; i++) {
            var mName = allMetricNames[i];
            var vals = [];
            var weights = [];
            for (j = 0; j < topK.length; j++) {
                var mVal = topK[j].experiment.metrics[mName];
                if (typeof mVal === 'number') {
                    vals.push(mVal);
                    weights.push(topK[j].weight);
                }
            }
            if (vals.length === 0) continue;

            var totalW = 0;
            var weightedSum = 0;
            for (j = 0; j < vals.length; j++) {
                weightedSum += vals[j] * weights[j];
                totalW += weights[j];
            }
            var predicted = totalW > 0 ? weightedSum / totalW : mean(vals);
            var sd = stddev(vals);
            var margin = 1.96 * sd;

            forecasts[mName] = {
                predicted: Math.round(predicted * 100) / 100,
                stdDev: Math.round(sd * 100) / 100,
                range: [Math.round((predicted - margin) * 100) / 100, Math.round((predicted + margin) * 100) / 100],
                sampleSize: vals.length
            };
        }

        var avgSim = 0;
        for (i = 0; i < topK.length; i++) {
            avgSim += 1 / (1 + topK[i].distance);
        }
        avgSim = avgSim / topK.length;
        var confidence = Math.round(clamp(avgSim * Math.min(topK.length / 5, 1) * 100, 0, 100));

        return { forecasts: forecasts, confidence: confidence };
    }

    // ── Engine 5: Risk Assessor ────────────────────────────────────

    function assessRisk(opts) {
        if (!opts || !opts.parameters) {
            return { riskScore: 50, tier: 'Moderate', risks: [{ category: 'unknownTerritory', severity: 50, message: 'No parameters provided for risk assessment' }], mitigations: [] };
        }
        var subset = filterByType(opts.type);
        var risks = [];
        var mitigations = [];

        if (subset.length === 0) {
            return {
                riskScore: 75,
                tier: 'High',
                risks: [{ category: 'unknownTerritory', severity: 75, message: 'No historical data available — operating in unknown territory' }],
                mitigations: ['Start with a small-scale pilot experiment', 'Record outcomes to build knowledge base']
            };
        }

        var ranges = computeParamRanges(subset);
        var paramKeys = ranges._paramKeys;
        var inputKeys = objectKeys(opts.parameters);
        var i, j, k;

        // 1. Parameter Extremity — params near or beyond historical bounds
        var extremityScores = [];
        for (i = 0; i < inputKeys.length; i++) {
            k = inputKeys[i];
            if (typeof opts.parameters[k] !== 'number') continue;
            if (ranges[k] === undefined) continue;
            var range = ranges[k];
            if (range === 0) continue;
            var normalized = (opts.parameters[k] - ranges[k + '_min']) / range;
            if (normalized < 0 || normalized > 1) {
                var overshoot = normalized < 0 ? Math.abs(normalized) : normalized - 1;
                extremityScores.push(Math.min(overshoot * 100, 100));
                risks.push({ category: 'parameterExtremity', severity: Math.round(Math.min(overshoot * 100, 100)), message: 'Parameter "' + k + '" is outside historical range' });
                mitigations.push('Consider adjusting "' + k + '" to within tested range');
            } else if (normalized < 0.05 || normalized > 0.95) {
                extremityScores.push(30);
            }
        }
        var extremityScore = extremityScores.length > 0 ? mean(extremityScores) : 0;

        // 2. Failure Proximity — closeness to known failure experiments
        var failures = [];
        for (i = 0; i < subset.length; i++) {
            if (subset[i].outcome === 'failure') failures.push(subset[i]);
        }
        var failureProximityScore = 0;
        if (failures.length > 0) {
            var minFailDist = Infinity;
            for (i = 0; i < failures.length; i++) {
                var dist = euclideanDistance(opts.parameters, failures[i].parameters, paramKeys, ranges);
                if (dist < minFailDist) minFailDist = dist;
            }
            if (minFailDist < 0.2) {
                failureProximityScore = 80;
                risks.push({ category: 'failureProximity', severity: 80, message: 'Very close to known failure region (distance: ' + (Math.round(minFailDist * 1000) / 1000) + ')' });
                mitigations.push('Parameters are dangerously close to failed experiments — review and adjust');
            } else if (minFailDist < 0.5) {
                failureProximityScore = 40;
                risks.push({ category: 'failureProximity', severity: 40, message: 'Moderately close to failure region (distance: ' + (Math.round(minFailDist * 1000) / 1000) + ')' });
            }
        }

        // 3. Unknown Territory — input params not seen in history
        var unknownCount = 0;
        for (i = 0; i < inputKeys.length; i++) {
            if (typeof opts.parameters[inputKeys[i]] !== 'number') continue;
            var found = false;
            for (j = 0; j < paramKeys.length; j++) {
                if (paramKeys[j] === inputKeys[i]) { found = true; break; }
            }
            if (!found) unknownCount++;
        }
        var unknownTerritoryScore = 0;
        if (unknownCount > 0) {
            unknownTerritoryScore = Math.min(unknownCount * 30, 90);
            risks.push({ category: 'unknownTerritory', severity: Math.round(unknownTerritoryScore), message: unknownCount + ' parameter(s) have no historical data' });
            mitigations.push('Run pilot experiments to establish baselines for new parameters');
        }

        // 4. Parameter Interaction — check if specific param combos correlated with failures
        var interactionScore = 0;
        if (failures.length >= 3 && inputKeys.length >= 2) {
            // Check if input param combo is common among failures
            var failParamSim = 0;
            for (i = 0; i < failures.length; i++) {
                var d = euclideanDistance(opts.parameters, failures[i].parameters, paramKeys, ranges);
                if (d < 0.3) failParamSim++;
            }
            var failRatio = failParamSim / failures.length;
            if (failRatio > 0.5) {
                interactionScore = 60;
                risks.push({ category: 'parameterInteraction', severity: 60, message: 'Parameter combination frequently seen in failed experiments' });
                mitigations.push('Consider varying one parameter at a time to isolate the problematic interaction');
            } else if (failRatio > 0.2) {
                interactionScore = 30;
            }
        }

        // 5. Historical Volatility — outcome variance for similar params
        var volatilityScore = 0;
        var similar = findSimilar({ parameters: opts.parameters, type: opts.type, limit: 10 });
        if (similar.matches.length >= 3) {
            var outcomeCounts = { success: 0, partial: 0, failure: 0 };
            for (i = 0; i < similar.matches.length; i++) {
                outcomeCounts[similar.matches[i].experiment.outcome]++;
            }
            var total = similar.matches.length;
            // Shannon entropy as volatility proxy
            var entropy = 0;
            var outcomeNames = ['success', 'partial', 'failure'];
            for (i = 0; i < outcomeNames.length; i++) {
                var p = outcomeCounts[outcomeNames[i]] / total;
                if (p > 0) entropy -= p * Math.log(p) / Math.log(3); // normalize to 0-1
            }
            volatilityScore = Math.round(entropy * 70);
            if (volatilityScore > 30) {
                risks.push({ category: 'historicalVolatility', severity: volatilityScore, message: 'Similar experiments show mixed outcomes (entropy: ' + (Math.round(entropy * 100) / 100) + ')' });
                mitigations.push('High outcome variability — consider running multiple replicates');
            }
        }

        var riskScore = Math.round(clamp(
            extremityScore * 0.25 +
            failureProximityScore * 0.3 +
            unknownTerritoryScore * 0.2 +
            interactionScore * 0.15 +
            volatilityScore * 0.1,
            0, 100
        ));

        return {
            riskScore: riskScore,
            tier: tierLabel(riskScore, RISK_TIERS),
            risks: risks,
            mitigations: mitigations
        };
    }

    // ── Engine 6: Oracle Health Scorer ──────────────────────────────

    function getHealth() {
        if (experiments.length === 0) {
            return {
                score: 0,
                tier: 'Critical',
                dimensions: { volume: 0, coverage: 0, balance: 0, freshness: 0, diversity: 0 },
                insights: ['No experiments recorded — knowledge base is empty']
            };
        }

        var insights = [];

        // Volume: more data = better (log scale, 100 experiments = max)
        var volumeScore = Math.round(clamp(Math.log(experiments.length + 1) / Math.log(101) * 100, 0, 100));

        // Type coverage: how many distinct types
        var types = Object.create(null);
        var outcomeDistrib = { success: 0, partial: 0, failure: 0 };
        var allParamKeys = Object.create(null);
        var now = Date.now();
        var freshCount = 0;
        var MS_30_DAYS = 30 * 86400000;

        for (var i = 0; i < experiments.length; i++) {
            types[experiments[i].type] = true;
            outcomeDistrib[experiments[i].outcome]++;
            var pKeys = objectKeys(experiments[i].parameters);
            for (var j = 0; j < pKeys.length; j++) {
                allParamKeys[pKeys[j]] = true;
            }
            if (now - experiments[i].timestamp < MS_30_DAYS) freshCount++;
        }

        var typeCount = Object.keys(types).length;
        var paramCount = Object.keys(allParamKeys).length;
        var coverageScore = Math.round(clamp((typeCount * 15 + paramCount * 5), 0, 100));

        // Balance: outcome distribution evenness (Shannon entropy)
        var balanceEntropy = 0;
        var outcomeNames = ['success', 'partial', 'failure'];
        for (i = 0; i < outcomeNames.length; i++) {
            var p = outcomeDistrib[outcomeNames[i]] / experiments.length;
            if (p > 0) balanceEntropy -= p * Math.log(p) / Math.log(3);
        }
        var balanceScore = Math.round(balanceEntropy * 100);

        // Freshness: fraction of recent experiments
        var freshnessScore = Math.round(clamp((freshCount / experiments.length) * 100, 0, 100));

        // Diversity: tag diversity
        var allTags = Object.create(null);
        for (i = 0; i < experiments.length; i++) {
            for (j = 0; j < experiments[i].tags.length; j++) {
                allTags[experiments[i].tags[j]] = true;
            }
        }
        var tagCount = Object.keys(allTags).length;
        var diversityScore = Math.round(clamp(tagCount * 10, 0, 100));

        // Composite
        var score = Math.round(clamp(
            volumeScore * 0.25 +
            coverageScore * 0.2 +
            balanceScore * 0.2 +
            freshnessScore * 0.2 +
            diversityScore * 0.15,
            0, 100
        ));

        if (experiments.length < 10) insights.push('Low data volume — record more experiments for better predictions');
        if (balanceScore < 30) insights.push('Outcome distribution is imbalanced — predictions may be biased');
        if (freshnessScore < 30) insights.push('Most data is stale — recent experiments would improve accuracy');
        if (typeCount === 1) insights.push('Only one experiment type recorded — consider expanding coverage');
        if (paramCount < 3) insights.push('Few parameter dimensions tracked — richer parameter sets improve similarity matching');

        return {
            score: score,
            tier: tierLabel(score, TIERS),
            dimensions: {
                volume: volumeScore,
                coverage: coverageScore,
                balance: balanceScore,
                freshness: freshnessScore,
                diversity: diversityScore
            },
            insights: insights
        };
    }

    // ── Engine 7: Insight Generator ────────────────────────────────

    function generateInsights(opts) {
        var insights = [];
        var now = Date.now();

        if (experiments.length < 3) {
            insights.push({
                type: 'warning',
                severity: 'high',
                message: 'Insufficient data for meaningful analysis (need at least 3 experiments)',
                evidence: { count: experiments.length }
            });
            return { insights: insights, generatedAt: now };
        }

        var subset = opts && opts.type ? filterByType(opts.type) : experiments;
        if (subset.length < 3) {
            insights.push({
                type: 'warning',
                severity: 'medium',
                message: 'Insufficient data for type "' + opts.type + '"',
                evidence: { count: subset.length }
            });
            return { insights: insights, generatedAt: now };
        }

        var ranges = computeParamRanges(subset);
        var paramKeys = ranges._paramKeys;

        // Golden Parameters: params common in successful experiments
        var successes = [];
        var failures = [];
        for (var i = 0; i < subset.length; i++) {
            if (subset[i].outcome === 'success') successes.push(subset[i]);
            else if (subset[i].outcome === 'failure') failures.push(subset[i]);
        }

        if (successes.length >= 2) {
            for (i = 0; i < paramKeys.length; i++) {
                var k = paramKeys[i];
                var successVals = [];
                var failureVals = [];
                for (var j = 0; j < successes.length; j++) {
                    if (typeof successes[j].parameters[k] === 'number') successVals.push(successes[j].parameters[k]);
                }
                for (j = 0; j < failures.length; j++) {
                    if (typeof failures[j].parameters[k] === 'number') failureVals.push(failures[j].parameters[k]);
                }
                if (successVals.length >= 2) {
                    var sMean = mean(successVals);
                    var sDev = stddev(successVals);
                    if (sDev < (ranges[k] || 1) * 0.2) {
                        insights.push({
                            type: 'golden_parameters',
                            severity: 'low',
                            message: 'Parameter "' + k + '" clusters tightly in successful experiments around ' + (Math.round(sMean * 100) / 100),
                            evidence: { parameter: k, mean: Math.round(sMean * 100) / 100, stdDev: Math.round(sDev * 100) / 100, sampleSize: successVals.length }
                        });
                    }
                }

                // Danger Zone: params associated with failures
                if (failureVals.length >= 2) {
                    var fMean = mean(failureVals);
                    var fDev = stddev(failureVals);
                    if (fDev < (ranges[k] || 1) * 0.25) {
                        insights.push({
                            type: 'danger_zone',
                            severity: 'high',
                            message: 'Parameter "' + k + '" clusters in failure zone around ' + (Math.round(fMean * 100) / 100),
                            evidence: { parameter: k, mean: Math.round(fMean * 100) / 100, stdDev: Math.round(fDev * 100) / 100, sampleSize: failureVals.length }
                        });
                    }
                }

                // Sensitivity: high variance in outcome correlated with parameter value
                if (successVals.length >= 2 && failureVals.length >= 1) {
                    var overallMean = mean(successVals.concat(failureVals));
                    var successMean = mean(successVals);
                    var failureMean = mean(failureVals);
                    var separation = Math.abs(successMean - failureMean);
                    var range = ranges[k] || 1;
                    if (range > 0 && separation / range > 0.3) {
                        insights.push({
                            type: 'sensitivity',
                            severity: 'medium',
                            message: 'Parameter "' + k + '" shows strong outcome sensitivity (separation: ' + (Math.round(separation * 100) / 100) + ')',
                            evidence: { parameter: k, successMean: Math.round(successMean * 100) / 100, failureMean: Math.round(failureMean * 100) / 100, separation: Math.round(separation * 100) / 100 }
                        });
                    }
                }
            }
        }

        // Trending: outcome trend over time
        if (subset.length >= 5) {
            var sorted = subset.slice().sort(function (a, b) { return a.timestamp - b.timestamp; });
            var recentHalf = sorted.slice(Math.floor(sorted.length / 2));
            var earlyHalf = sorted.slice(0, Math.floor(sorted.length / 2));

            var recentSuccessRate = 0;
            for (i = 0; i < recentHalf.length; i++) {
                if (recentHalf[i].outcome === 'success') recentSuccessRate++;
            }
            recentSuccessRate = recentHalf.length > 0 ? recentSuccessRate / recentHalf.length : 0;

            var earlySuccessRate = 0;
            for (i = 0; i < earlyHalf.length; i++) {
                if (earlyHalf[i].outcome === 'success') earlySuccessRate++;
            }
            earlySuccessRate = earlyHalf.length > 0 ? earlySuccessRate / earlyHalf.length : 0;

            var trendDiff = recentSuccessRate - earlySuccessRate;
            if (Math.abs(trendDiff) > 0.15) {
                insights.push({
                    type: 'trending',
                    severity: trendDiff > 0 ? 'low' : 'high',
                    message: trendDiff > 0
                        ? 'Success rate is improving (' + (Math.round(earlySuccessRate * 100)) + '% → ' + (Math.round(recentSuccessRate * 100)) + '%)'
                        : 'Success rate is declining (' + (Math.round(earlySuccessRate * 100)) + '% → ' + (Math.round(recentSuccessRate * 100)) + '%)',
                    evidence: { earlySuccessRate: Math.round(earlySuccessRate * 100) / 100, recentSuccessRate: Math.round(recentSuccessRate * 100) / 100, trend: trendDiff > 0 ? 'improving' : 'declining' }
                });
            }
        }

        // Opportunity: under-explored parameter regions with potential
        if (successes.length >= 2 && paramKeys.length >= 1) {
            for (i = 0; i < paramKeys.length; i++) {
                k = paramKeys[i];
                var allVals = [];
                for (j = 0; j < subset.length; j++) {
                    if (typeof subset[j].parameters[k] === 'number') allVals.push(subset[j].parameters[k]);
                }
                if (allVals.length < 3) continue;
                var sd = stddev(allVals);
                var m = mean(allVals);
                var range = ranges[k] || 1;
                var explorationRatio = range > 0 ? sd / range : 0;
                if (explorationRatio < 0.15) {
                    insights.push({
                        type: 'opportunity',
                        severity: 'medium',
                        message: 'Parameter "' + k + '" is under-explored — experiments cluster narrowly around ' + (Math.round(m * 100) / 100),
                        evidence: { parameter: k, mean: Math.round(m * 100) / 100, explorationRatio: Math.round(explorationRatio * 100) / 100 }
                    });
                }
            }
        }

        return { insights: insights, generatedAt: now };
    }

    // ── Stats & Reset ──────────────────────────────────────────────

    function getStats() {
        var types = Object.create(null);
        var outcomes = { success: 0, partial: 0, failure: 0 };
        for (var i = 0; i < experiments.length; i++) {
            types[experiments[i].type] = (types[experiments[i].type] || 0) + 1;
            outcomes[experiments[i].outcome]++;
        }
        return {
            totalExperiments: experiments.length,
            types: types,
            outcomes: outcomes
        };
    }

    function reset() {
        experiments.length = 0;
        var keys = Object.keys(experimentsById);
        for (var i = 0; i < keys.length; i++) {
            delete experimentsById[keys[i]];
        }
    }

    return {
        recordExperiment: recordExperiment,
        getExperimentCount: getExperimentCount,
        findSimilar: findSimilar,
        predictOutcome: predictOutcome,
        forecastMetrics: forecastMetrics,
        assessRisk: assessRisk,
        getHealth: getHealth,
        generateInsights: generateInsights,
        getStats: getStats,
        reset: reset
    };
}

exports.createOutcomeOracle = createOutcomeOracle;
