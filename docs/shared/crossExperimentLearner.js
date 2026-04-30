'use strict';

/**
 * Cross-Experiment Learning Engine
 *
 * Autonomous module that analyzes patterns across multiple bioprinting
 * experiments to discover hidden correlations, identify optimal parameter
 * combinations, and generate data-driven recommendations for future runs.
 *
 * Key capabilities:
 * - Ingest experiment records with parameters, outcomes, and metadata
 * - Pearson correlation discovery across all parameter-outcome pairs
 * - "Golden combination" identification — parameter sets that consistently
 *   produce above-threshold outcomes
 * - Parameter sensitivity ranking — which knobs matter most
 * - Recommendation engine — suggest parameter adjustments for target goals
 * - Failure pattern detection — recurring parameter combos that fail
 * - Learning curve tracking — how outcomes improve over successive experiments
 * - Confidence scoring based on sample size and consistency
 *
 * @example
 *   var learner = createCrossExperimentLearner();
 *   learner.ingest({
 *     id: 'EXP-001', parameters: { temperature: 23, pressure: 105, flowRate: 5.2 },
 *     outcomes: { viability: 92, structuralIntegrity: 88 }, tags: ['alginate']
 *   });
 *   // ... ingest many experiments ...
 *   var insights = learner.analyze();
 *   var rec = learner.recommend({ targetOutcome: 'viability', targetValue: 95 });
 */

// ── Constants ──────────────────────────────────────────────────────

var MIN_SAMPLES_FOR_CORRELATION = 5;
var MIN_SAMPLES_FOR_RECOMMENDATION = 8;
var GOLDEN_PERCENTILE = 0.80; // top 20% outcomes = "golden"
var FAILURE_PERCENTILE = 0.20; // bottom 20% = failure zone

var CONFIDENCE_LEVELS = [
    { label: 'LOW',      min: 0,   max: 0.4,  color: '#ef4444' },
    { label: 'MODERATE', min: 0.4, max: 0.7,  color: '#eab308' },
    { label: 'HIGH',     min: 0.7, max: 0.9,  color: '#22c55e' },
    { label: 'VERY_HIGH', min: 0.9, max: 1.0, color: '#059669' }
];

var SENSITIVITY_CLASSES = [
    { label: 'NEGLIGIBLE', threshold: 0.1 },
    { label: 'LOW',        threshold: 0.3 },
    { label: 'MODERATE',   threshold: 0.5 },
    { label: 'HIGH',       threshold: 0.7 },
    { label: 'CRITICAL',   threshold: 1.0 }
];

// ── Statistical helpers ────────────────────────────────────────────

function mean(arr) {
    if (!arr || arr.length === 0) return 0;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
}

function stddev(arr) {
    if (!arr || arr.length < 2) return 0;
    var m = mean(arr);
    var sumSq = 0;
    for (var i = 0; i < arr.length; i++) {
        var d = arr[i] - m;
        sumSq += d * d;
    }
    return Math.sqrt(sumSq / (arr.length - 1));
}

function pearsonCorrelation(xs, ys) {
    if (!xs || !ys || xs.length !== ys.length || xs.length < MIN_SAMPLES_FOR_CORRELATION) return null;
    var n = xs.length;
    var mx = mean(xs);
    var my = mean(ys);
    var num = 0, dx2 = 0, dy2 = 0;
    for (var i = 0; i < n; i++) {
        var dx = xs[i] - mx;
        var dy = ys[i] - my;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    var denom = Math.sqrt(dx2 * dy2);
    if (denom === 0) return 0;
    return num / denom;
}

function percentile(sortedArr, p) {
    if (!sortedArr || sortedArr.length === 0) return 0;
    var idx = p * (sortedArr.length - 1);
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    if (lo === hi) return sortedArr[lo];
    var frac = idx - lo;
    return sortedArr[lo] * (1 - frac) + sortedArr[hi] * frac;
}

function linearRegression(xs, ys) {
    var n = xs.length;
    if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
    var mx = mean(xs);
    var my = mean(ys);
    var num = 0, den = 0, ssTot = 0;
    for (var i = 0; i < n; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        den += (xs[i] - mx) * (xs[i] - mx);
        ssTot += (ys[i] - my) * (ys[i] - my);
    }
    var slope = den === 0 ? 0 : num / den;
    var intercept = my - slope * mx;
    var ssRes = 0;
    for (var i = 0; i < n; i++) {
        var pred = slope * xs[i] + intercept;
        ssRes += (ys[i] - pred) * (ys[i] - pred);
    }
    var r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
    return { slope: slope, intercept: intercept, r2: Math.max(0, r2) };
}

function getConfidenceLevel(score) {
    for (var i = CONFIDENCE_LEVELS.length - 1; i >= 0; i--) {
        if (score >= CONFIDENCE_LEVELS[i].min) return CONFIDENCE_LEVELS[i];
    }
    return CONFIDENCE_LEVELS[0];
}

function getSensitivityClass(absCorr) {
    for (var i = SENSITIVITY_CLASSES.length - 1; i >= 0; i--) {
        if (absCorr >= SENSITIVITY_CLASSES[i].threshold) return SENSITIVITY_CLASSES[i].label;
    }
    return SENSITIVITY_CLASSES[0].label;
}

// ── Factory ────────────────────────────────────────────────────────

function createCrossExperimentLearner(options) {
    var opts = options || {};
    var experiments = [];
    var parameterNames = {};
    var outcomeNames = {};
    var tagIndex = {}; // tag -> [experiment indices]

    // ── Ingest ─────────────────────────────────────────────────────

    function ingest(record) {
        if (!record || typeof record !== 'object') {
            throw new Error('Experiment record must be a non-null object');
        }
        if (!record.parameters || typeof record.parameters !== 'object') {
            throw new Error('Experiment record must have a parameters object');
        }
        if (!record.outcomes || typeof record.outcomes !== 'object') {
            throw new Error('Experiment record must have an outcomes object');
        }

        var entry = {
            id: record.id || 'EXP-' + (experiments.length + 1).toString().padStart(4, '0'),
            parameters: Object.assign({}, record.parameters),
            outcomes: Object.assign({}, record.outcomes),
            tags: Array.isArray(record.tags) ? record.tags.slice() : [],
            timestamp: record.timestamp || Date.now(),
            notes: record.notes || ''
        };

        var idx = experiments.length;
        experiments.push(entry);

        // Index parameter and outcome names
        Object.keys(entry.parameters).forEach(function(k) {
            parameterNames[k] = true;
        });
        Object.keys(entry.outcomes).forEach(function(k) {
            outcomeNames[k] = true;
        });

        // Index tags
        entry.tags.forEach(function(tag) {
            if (!tagIndex[tag]) tagIndex[tag] = [];
            tagIndex[tag].push(idx);
        });

        return entry.id;
    }

    function ingestBatch(records) {
        if (!Array.isArray(records)) throw new Error('ingestBatch requires an array');
        var ids = [];
        for (var i = 0; i < records.length; i++) {
            ids.push(ingest(records[i]));
        }
        return ids;
    }

    // ── Correlation Discovery ──────────────────────────────────────

    function discoverCorrelations(options) {
        var filterOpts = options || {};
        var subset = filterExperiments(filterOpts);
        if (subset.length < MIN_SAMPLES_FOR_CORRELATION) {
            return { correlations: [], sampleSize: subset.length, insufficient: true };
        }

        var params = Object.keys(parameterNames);
        var outcomes = Object.keys(outcomeNames);
        var correlations = [];

        // Pre-extract all numeric column vectors in a single pass over experiments
        // instead of re-scanning for every (param, outcome) pair — O(E) once vs O(P*O*E)
        var paramCols = {};  // paramName -> [{ idx, value }]
        var outcomeCols = {}; // outcomeName -> [{ idx, value }]
        for (var pi = 0; pi < params.length; pi++) paramCols[params[pi]] = [];
        for (var oi = 0; oi < outcomes.length; oi++) outcomeCols[outcomes[oi]] = [];

        for (var ei = 0; ei < subset.length; ei++) {
            var exp = subset[ei];
            for (var pi = 0; pi < params.length; pi++) {
                var pv = exp.parameters[params[pi]];
                if (typeof pv === 'number' && isFinite(pv)) {
                    paramCols[params[pi]].push({ idx: ei, value: pv });
                }
            }
            for (var oi = 0; oi < outcomes.length; oi++) {
                var ov = exp.outcomes[outcomes[oi]];
                if (typeof ov === 'number' && isFinite(ov)) {
                    outcomeCols[outcomes[oi]].push({ idx: ei, value: ov });
                }
            }
        }

        // Build outcome lookup arrays indexed by experiment position for O(1) access
        var outcomeLookups = {};
        for (var oi = 0; oi < outcomes.length; oi++) {
            var lookup = new Array(subset.length);
            var col = outcomeCols[outcomes[oi]];
            for (var c = 0; c < col.length; c++) {
                lookup[col[c].idx] = col[c].value;
            }
            outcomeLookups[outcomes[oi]] = lookup;
        }

        // Compute correlations using pre-extracted columns
        for (var pi = 0; pi < params.length; pi++) {
            var pCol = paramCols[params[pi]];
            if (pCol.length < MIN_SAMPLES_FOR_CORRELATION) continue;

            for (var oi = 0; oi < outcomes.length; oi++) {
                var oLookup = outcomeLookups[outcomes[oi]];
                var xs = [], ys = [];
                // Only iterate param column entries, check outcome existence via lookup
                for (var c = 0; c < pCol.length; c++) {
                    var oVal = oLookup[pCol[c].idx];
                    if (oVal !== undefined) {
                        xs.push(pCol[c].value);
                        ys.push(oVal);
                    }
                }
                var r = pearsonCorrelation(xs, ys);
                if (r !== null) {
                    correlations.push({
                        parameter: params[pi],
                        outcome: outcomes[oi],
                        correlation: Math.round(r * 1000) / 1000,
                        absCorrelation: Math.round(Math.abs(r) * 1000) / 1000,
                        direction: r > 0 ? 'positive' : r < 0 ? 'negative' : 'none',
                        sensitivity: getSensitivityClass(Math.abs(r)),
                        sampleSize: xs.length,
                        confidence: computeCorrelationConfidence(r, xs.length)
                    });
                }
            }
        }

        correlations.sort(function(a, b) { return b.absCorrelation - a.absCorrelation; });
        return { correlations: correlations, sampleSize: subset.length, insufficient: false };
    }

    function computeCorrelationConfidence(r, n) {
        // Based on sample size and effect size
        var sizeScore = Math.min(1, n / 30); // saturates at 30
        var effectScore = Math.min(1, Math.abs(r) * 1.5);
        var raw = sizeScore * 0.6 + effectScore * 0.4;
        return Math.round(raw * 100) / 100;
    }

    // ── Golden Combination Detection ───────────────────────────────

    function findGoldenCombinations(targetOutcome, options) {
        var filterOpts = options || {};
        var subset = filterExperiments(filterOpts);
        if (subset.length < MIN_SAMPLES_FOR_CORRELATION) {
            return { combinations: [], insufficient: true };
        }

        // Get outcome values and find threshold
        var outcomeValues = [];
        var validExps = [];
        for (var i = 0; i < subset.length; i++) {
            var val = subset[i].outcomes[targetOutcome];
            if (typeof val === 'number' && isFinite(val)) {
                outcomeValues.push(val);
                validExps.push(subset[i]);
            }
        }

        if (validExps.length < MIN_SAMPLES_FOR_CORRELATION) {
            return { combinations: [], insufficient: true };
        }

        var sorted = outcomeValues.slice().sort(function(a, b) { return a - b; });
        var goldenThreshold = percentile(sorted, GOLDEN_PERCENTILE);

        // Identify golden experiments
        var goldenExps = [];
        for (var i = 0; i < validExps.length; i++) {
            if (validExps[i].outcomes[targetOutcome] >= goldenThreshold) {
                goldenExps.push(validExps[i]);
            }
        }

        // Find common parameter ranges in golden experiments
        var params = Object.keys(parameterNames);
        var paramRanges = {};
        for (var pi = 0; pi < params.length; pi++) {
            var pName = params[pi];
            var values = [];
            for (var gi = 0; gi < goldenExps.length; gi++) {
                var v = goldenExps[gi].parameters[pName];
                if (typeof v === 'number' && isFinite(v)) values.push(v);
            }
            if (values.length >= 3) {
                values.sort(function(a, b) { return a - b; });
                paramRanges[pName] = {
                    min: values[0],
                    max: values[values.length - 1],
                    mean: Math.round(mean(values) * 1000) / 1000,
                    stddev: Math.round(stddev(values) * 1000) / 1000,
                    q25: percentile(values, 0.25),
                    q75: percentile(values, 0.75),
                    sampleCount: values.length
                };
            }
        }

        // Compute tightness score — how narrow the golden ranges are vs overall
        var combinations = [];
        Object.keys(paramRanges).forEach(function(pName) {
            var golden = paramRanges[pName];
            // Overall spread for same param
            var allValues = [];
            for (var i = 0; i < validExps.length; i++) {
                var v = validExps[i].parameters[pName];
                if (typeof v === 'number' && isFinite(v)) allValues.push(v);
            }
            if (allValues.length < 2) return;
            var overallRange = Math.max.apply(null, allValues) - Math.min.apply(null, allValues);
            var goldenRange = golden.max - golden.min;
            var tightness = overallRange === 0 ? 1 : 1 - (goldenRange / overallRange);
            tightness = Math.max(0, Math.min(1, tightness));

            combinations.push({
                parameter: pName,
                goldenRange: { min: golden.min, max: golden.max },
                sweetSpot: golden.mean,
                tightness: Math.round(tightness * 100) / 100,
                confidence: getConfidenceLevel(Math.min(1, golden.sampleCount / 10)).label,
                sampleCount: golden.sampleCount
            });
        });

        combinations.sort(function(a, b) { return b.tightness - a.tightness; });

        return {
            combinations: combinations,
            goldenThreshold: Math.round(goldenThreshold * 1000) / 1000,
            goldenCount: goldenExps.length,
            totalCount: validExps.length,
            targetOutcome: targetOutcome,
            insufficient: false
        };
    }

    // ── Failure Pattern Detection ──────────────────────────────────

    function detectFailurePatterns(targetOutcome, options) {
        var filterOpts = options || {};
        var subset = filterExperiments(filterOpts);
        if (subset.length < MIN_SAMPLES_FOR_CORRELATION) {
            return { patterns: [], insufficient: true };
        }

        var outcomeValues = [];
        var validExps = [];
        for (var i = 0; i < subset.length; i++) {
            var val = subset[i].outcomes[targetOutcome];
            if (typeof val === 'number' && isFinite(val)) {
                outcomeValues.push(val);
                validExps.push(subset[i]);
            }
        }

        var sorted = outcomeValues.slice().sort(function(a, b) { return a - b; });
        var failureThreshold = percentile(sorted, FAILURE_PERCENTILE);

        var failedExps = [];
        for (var i = 0; i < validExps.length; i++) {
            if (validExps[i].outcomes[targetOutcome] <= failureThreshold) {
                failedExps.push(validExps[i]);
            }
        }

        // Identify parameter patterns in failures
        var params = Object.keys(parameterNames);
        var patterns = [];

        for (var pi = 0; pi < params.length; pi++) {
            var pName = params[pi];
            var failValues = [];
            var allValues = [];
            for (var fi = 0; fi < failedExps.length; fi++) {
                var v = failedExps[fi].parameters[pName];
                if (typeof v === 'number' && isFinite(v)) failValues.push(v);
            }
            for (var i = 0; i < validExps.length; i++) {
                var v = validExps[i].parameters[pName];
                if (typeof v === 'number' && isFinite(v)) allValues.push(v);
            }

            if (failValues.length < 2 || allValues.length < 3) continue;

            var failMean = mean(failValues);
            var allMean = mean(allValues);
            var allStd = stddev(allValues);
            if (allStd === 0) continue;

            var zScore = (failMean - allMean) / allStd;
            if (Math.abs(zScore) > 0.8) {
                patterns.push({
                    parameter: pName,
                    failureMean: Math.round(failMean * 1000) / 1000,
                    overallMean: Math.round(allMean * 1000) / 1000,
                    zScore: Math.round(zScore * 100) / 100,
                    direction: zScore > 0 ? 'too_high' : 'too_low',
                    dangerZone: {
                        min: zScore < 0 ? Math.min.apply(null, failValues) : failMean - stddev(failValues),
                        max: zScore > 0 ? Math.max.apply(null, failValues) : failMean + stddev(failValues)
                    },
                    failureCount: failValues.length,
                    severity: Math.abs(zScore) > 2 ? 'CRITICAL' : Math.abs(zScore) > 1.5 ? 'HIGH' : 'MODERATE'
                });
            }
        }

        patterns.sort(function(a, b) { return Math.abs(b.zScore) - Math.abs(a.zScore); });

        return {
            patterns: patterns,
            failureThreshold: Math.round(failureThreshold * 1000) / 1000,
            failureCount: failedExps.length,
            totalCount: validExps.length,
            targetOutcome: targetOutcome,
            insufficient: false
        };
    }

    // ── Parameter Sensitivity Ranking ──────────────────────────────

    function rankParameterSensitivity(targetOutcome, options, precomputedCorrelations) {
        var corr = precomputedCorrelations || discoverCorrelations(options);
        if (corr.insufficient) return { rankings: [], insufficient: true };

        var rankings = corr.correlations
            .filter(function(c) { return c.outcome === targetOutcome; })
            .map(function(c) {
                return {
                    parameter: c.parameter,
                    sensitivity: c.absCorrelation,
                    direction: c.direction,
                    classification: c.sensitivity,
                    sampleSize: c.sampleSize,
                    actionability: c.absCorrelation > 0.5 ? 'ACTIONABLE' : c.absCorrelation > 0.3 ? 'MONITOR' : 'IGNORE'
                };
            });

        rankings.sort(function(a, b) { return b.sensitivity - a.sensitivity; });
        return { rankings: rankings, targetOutcome: targetOutcome, insufficient: false };
    }

    // ── Recommendation Engine ──────────────────────────────────────

    function recommend(goal) {
        if (!goal || !goal.targetOutcome) {
            throw new Error('Goal must specify targetOutcome');
        }
        var targetOutcome = goal.targetOutcome;
        var targetValue = goal.targetValue;
        var filterOpts = goal.filter || {};

        var subset = filterExperiments(filterOpts);
        if (subset.length < MIN_SAMPLES_FOR_RECOMMENDATION) {
            return { recommendations: [], insufficient: true, reason: 'Need at least ' + MIN_SAMPLES_FOR_RECOMMENDATION + ' experiments' };
        }

        var params = Object.keys(parameterNames);
        var recommendations = [];

        for (var pi = 0; pi < params.length; pi++) {
            var pName = params[pi];
            var xs = [], ys = [];
            for (var i = 0; i < subset.length; i++) {
                var pv = subset[i].parameters[pName];
                var ov = subset[i].outcomes[targetOutcome];
                if (typeof pv === 'number' && typeof ov === 'number' && isFinite(pv) && isFinite(ov)) {
                    xs.push(pv);
                    ys.push(ov);
                }
            }
            if (xs.length < MIN_SAMPLES_FOR_RECOMMENDATION) continue;

            var reg = linearRegression(xs, ys);
            var r = pearsonCorrelation(xs, ys);
            if (r === null || Math.abs(r) < 0.3) continue; // too weak

            var currentMean = mean(xs);
            var suggestedValue = currentMean;

            if (targetValue !== undefined && reg.slope !== 0) {
                // Solve for x: targetValue = slope*x + intercept
                suggestedValue = (targetValue - reg.intercept) / reg.slope;
                // Clamp to observed range ±20%
                var minObs = Math.min.apply(null, xs);
                var maxObs = Math.max.apply(null, xs);
                var rangeBuffer = (maxObs - minObs) * 0.2;
                suggestedValue = Math.max(minObs - rangeBuffer, Math.min(maxObs + rangeBuffer, suggestedValue));
            } else {
                // No target value — suggest direction
                if (reg.slope > 0) suggestedValue = percentile(xs.slice().sort(function(a,b){return a-b;}), 0.8);
                else suggestedValue = percentile(xs.slice().sort(function(a,b){return a-b;}), 0.2);
            }

            var confidence = Math.min(1, (Math.abs(r) * 0.6 + reg.r2 * 0.4) * Math.min(1, xs.length / 20));

            recommendations.push({
                parameter: pName,
                currentMean: Math.round(currentMean * 1000) / 1000,
                suggestedValue: Math.round(suggestedValue * 1000) / 1000,
                adjustmentDirection: suggestedValue > currentMean ? 'increase' : suggestedValue < currentMean ? 'decrease' : 'maintain',
                adjustmentMagnitude: Math.round(Math.abs(suggestedValue - currentMean) * 1000) / 1000,
                rationale: buildRationale(pName, targetOutcome, r, reg),
                confidence: Math.round(confidence * 100) / 100,
                confidenceLevel: getConfidenceLevel(confidence).label,
                r2: Math.round(reg.r2 * 1000) / 1000,
                correlation: Math.round(r * 1000) / 1000
            });
        }

        recommendations.sort(function(a, b) { return b.confidence - a.confidence; });

        return {
            recommendations: recommendations,
            targetOutcome: targetOutcome,
            targetValue: targetValue,
            sampleSize: subset.length,
            insufficient: false
        };
    }

    function buildRationale(param, outcome, r, reg) {
        var strength = Math.abs(r) > 0.7 ? 'strong' : Math.abs(r) > 0.5 ? 'moderate' : 'weak';
        var dir = r > 0 ? 'positive' : 'negative';
        return strength + ' ' + dir + ' correlation (r=' + (Math.round(r * 100) / 100) +
               ') between ' + param + ' and ' + outcome +
               '; linear model explains ' + Math.round(reg.r2 * 100) + '% of variance';
    }

    // ── Learning Curve ─────────────────────────────────────────────

    function getLearningCurve(targetOutcome, options) {
        var filterOpts = options || {};
        var subset = filterExperiments(filterOpts);
        if (subset.length < 3) {
            return { curve: [], insufficient: true };
        }

        // Sort by timestamp
        var sorted = subset.slice().sort(function(a, b) { return a.timestamp - b.timestamp; });

        var curve = [];
        var windowSize = Math.max(3, Math.floor(sorted.length / 10));

        for (var i = 0; i < sorted.length; i++) {
            var val = sorted[i].outcomes[targetOutcome];
            if (typeof val !== 'number' || !isFinite(val)) continue;

            // Running average
            var windowStart = Math.max(0, curve.length - windowSize + 1);
            var windowVals = [];
            for (var w = windowStart; w < curve.length; w++) {
                windowVals.push(curve[w].value);
            }
            windowVals.push(val);
            var runningAvg = mean(windowVals);

            curve.push({
                index: curve.length,
                experimentId: sorted[i].id,
                value: val,
                runningAverage: Math.round(runningAvg * 1000) / 1000,
                timestamp: sorted[i].timestamp
            });
        }

        // Compute improvement metrics
        if (curve.length < 3) return { curve: curve, insufficient: true };

        var firstQuarter = curve.slice(0, Math.ceil(curve.length / 4));
        var lastQuarter = curve.slice(Math.floor(curve.length * 3 / 4));
        var earlyAvg = mean(firstQuarter.map(function(p) { return p.value; }));
        var lateAvg = mean(lastQuarter.map(function(p) { return p.value; }));
        var improvement = earlyAvg === 0 ? 0 : ((lateAvg - earlyAvg) / Math.abs(earlyAvg)) * 100;

        // Trend via regression
        var indices = curve.map(function(p) { return p.index; });
        var values = curve.map(function(p) { return p.value; });
        var reg = linearRegression(indices, values);

        return {
            curve: curve,
            metrics: {
                totalExperiments: curve.length,
                earlyAverage: Math.round(earlyAvg * 1000) / 1000,
                lateAverage: Math.round(lateAvg * 1000) / 1000,
                improvementPercent: Math.round(improvement * 10) / 10,
                trend: reg.slope > 0 ? 'IMPROVING' : reg.slope < 0 ? 'DECLINING' : 'FLAT',
                trendSlope: Math.round(reg.slope * 1000) / 1000,
                trendR2: Math.round(reg.r2 * 1000) / 1000
            },
            targetOutcome: targetOutcome,
            insufficient: false
        };
    }

    // ── Full Analysis ──────────────────────────────────────────────

    function analyze(options) {
        var outcomes = Object.keys(outcomeNames);
        var filterOpts = options || {};

        // Compute correlations once and reuse for all per-outcome sensitivity rankings
        // Previously recomputed O(outcomes) additional times via rankParameterSensitivity
        var correlations = discoverCorrelations(filterOpts);

        var result = {
            experimentCount: experiments.length,
            parameterCount: Object.keys(parameterNames).length,
            outcomeCount: outcomes.length,
            tags: Object.keys(tagIndex),
            correlations: correlations,
            outcomeAnalyses: {}
        };

        for (var i = 0; i < outcomes.length; i++) {
            var oc = outcomes[i];
            result.outcomeAnalyses[oc] = {
                golden: findGoldenCombinations(oc, filterOpts),
                failures: detectFailurePatterns(oc, filterOpts),
                sensitivity: rankParameterSensitivity(oc, filterOpts, correlations),
                learningCurve: getLearningCurve(oc, filterOpts)
            };
        }

        return result;
    }

    // ── Tag-Based Comparison ───────────────────────────────────────

    function compareByTag(tagA, tagB, targetOutcome) {
        var expsA = (tagIndex[tagA] || []).map(function(i) { return experiments[i]; });
        var expsB = (tagIndex[tagB] || []).map(function(i) { return experiments[i]; });

        function summarize(exps) {
            var values = exps.map(function(e) { return e.outcomes[targetOutcome]; })
                .filter(function(v) { return typeof v === 'number' && isFinite(v); });
            if (values.length === 0) return null;
            values.sort(function(a, b) { return a - b; });
            return {
                count: values.length,
                mean: Math.round(mean(values) * 1000) / 1000,
                stddev: Math.round(stddev(values) * 1000) / 1000,
                min: values[0],
                max: values[values.length - 1],
                median: percentile(values, 0.5)
            };
        }

        var summA = summarize(expsA);
        var summB = summarize(expsB);

        var winner = null;
        if (summA && summB) {
            winner = summA.mean > summB.mean ? tagA : summB.mean > summA.mean ? tagB : 'tie';
        }

        return {
            tagA: { tag: tagA, stats: summA },
            tagB: { tag: tagB, stats: summB },
            targetOutcome: targetOutcome,
            winner: winner,
            difference: summA && summB ? Math.round((summA.mean - summB.mean) * 1000) / 1000 : null
        };
    }

    // ── Knowledge Summary (for other modules) ──────────────────────

    function getKnowledgeSummary() {
        return {
            totalExperiments: experiments.length,
            parameters: Object.keys(parameterNames),
            outcomes: Object.keys(outcomeNames),
            tags: Object.keys(tagIndex),
            tagCounts: Object.keys(tagIndex).reduce(function(acc, tag) {
                acc[tag] = tagIndex[tag].length;
                return acc;
            }, {}),
            dataHealth: {
                hasEnoughForCorrelation: experiments.length >= MIN_SAMPLES_FOR_CORRELATION,
                hasEnoughForRecommendation: experiments.length >= MIN_SAMPLES_FOR_RECOMMENDATION,
                coverageScore: computeDataCoverage()
            }
        };
    }

    function computeDataCoverage() {
        if (experiments.length === 0) return 0;
        var params = Object.keys(parameterNames);
        var outcomes = Object.keys(outcomeNames);
        var totalCells = params.length * experiments.length + outcomes.length * experiments.length;
        var filledCells = 0;
        for (var i = 0; i < experiments.length; i++) {
            for (var p = 0; p < params.length; p++) {
                if (typeof experiments[i].parameters[params[p]] === 'number') filledCells++;
            }
            for (var o = 0; o < outcomes.length; o++) {
                if (typeof experiments[i].outcomes[outcomes[o]] === 'number') filledCells++;
            }
        }
        return totalCells === 0 ? 0 : Math.round((filledCells / totalCells) * 100) / 100;
    }

    // ── Export / Reset ─────────────────────────────────────────────

    function exportData() {
        return {
            experiments: experiments.slice(),
            metadata: {
                exportedAt: new Date().toISOString(),
                totalExperiments: experiments.length,
                parameters: Object.keys(parameterNames),
                outcomes: Object.keys(outcomeNames)
            }
        };
    }

    function reset() {
        experiments.length = 0;
        parameterNames = {};
        outcomeNames = {};
        tagIndex = {};
    }

    // ── Internal helpers ───────────────────────────────────────────

    function filterExperiments(opts) {
        var subset = experiments;
        if (opts.tags && opts.tags.length > 0) {
            var tagSet = {};
            for (var t = 0; t < opts.tags.length; t++) {
                var indices = tagIndex[opts.tags[t]] || [];
                for (var i = 0; i < indices.length; i++) tagSet[indices[i]] = true;
            }
            subset = Object.keys(tagSet).map(function(idx) { return experiments[parseInt(idx)]; });
        }
        if (opts.since) {
            var since = typeof opts.since === 'number' ? opts.since : new Date(opts.since).getTime();
            subset = subset.filter(function(e) { return e.timestamp >= since; });
        }
        if (opts.until) {
            var until = typeof opts.until === 'number' ? opts.until : new Date(opts.until).getTime();
            subset = subset.filter(function(e) { return e.timestamp <= until; });
        }
        return subset;
    }

    // ── Public API ─────────────────────────────────────────────────

    return {
        ingest: ingest,
        ingestBatch: ingestBatch,
        analyze: analyze,
        discoverCorrelations: discoverCorrelations,
        findGoldenCombinations: findGoldenCombinations,
        detectFailurePatterns: detectFailurePatterns,
        rankParameterSensitivity: rankParameterSensitivity,
        recommend: recommend,
        getLearningCurve: getLearningCurve,
        compareByTag: compareByTag,
        getKnowledgeSummary: getKnowledgeSummary,
        exportData: exportData,
        reset: reset,
        get experimentCount() { return experiments.length; }
    };
}

module.exports = { createCrossExperimentLearner: createCrossExperimentLearner };
