'use strict';

/**
 * Growth Curve Analyzer — fit cell/bacterial growth data to identify phases,
 * compute doubling time, and compare conditions.
 *
 * @example
 *   var analyzer = createGrowthCurveAnalyzer();
 *   var curve = analyzer.analyze({
 *     timepoints: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24],
 *     counts:     [1e4, 1.1e4, 1.2e4, 2e4, 5e4, 1.5e5, 4e5, 9e5, 1.5e6, 1.8e6, 1.9e6, 1.9e6, 1.85e6],
 *     timeUnit: 'hours',
 *     label: 'HeLa 37°C'
 *   });
 */

// ── helpers ────────────────────────────────────────────────────────

function mean(arr) {
    if (!arr.length) return 0;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
}

function linearRegression(xs, ys) {
    var n = xs.length;
    var mx = mean(xs), my = mean(ys);
    var num = 0, den = 0;
    for (var i = 0; i < n; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        den += (xs[i] - mx) * (xs[i] - mx);
    }
    var slope = den === 0 ? 0 : num / den;
    var intercept = my - slope * mx;
    // R²
    var ssTot = 0, ssRes = 0;
    for (var j = 0; j < n; j++) {
        var pred = slope * xs[j] + intercept;
        ssTot += (ys[j] - my) * (ys[j] - my);
        ssRes += (ys[j] - pred) * (ys[j] - pred);
    }
    var r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
    return { slope: slope, intercept: intercept, r2: r2 };
}

function round(v, d) {
    var f = Math.pow(10, d || 4);
    return Math.round(v * f) / f;
}

function validateInput(data) {
    if (!data || typeof data !== 'object') throw new Error('Input must be an object');
    if (!Array.isArray(data.timepoints) || !Array.isArray(data.counts))
        throw new Error('timepoints and counts must be arrays');
    if (data.timepoints.length !== data.counts.length)
        throw new Error('timepoints and counts must have same length');
    if (data.timepoints.length < 3)
        throw new Error('Need at least 3 data points');
    for (var i = 0; i < data.counts.length; i++) {
        if (typeof data.counts[i] !== 'number' || data.counts[i] < 0)
            throw new Error('counts must be non-negative numbers');
        if (typeof data.timepoints[i] !== 'number')
            throw new Error('timepoints must be numbers');
    }
}

// ── phase detection via growth rate changes ────────────────────────

function detectPhases(timepoints, counts) {
    // Compute specific growth rates between consecutive points
    var rates = [];
    var logCounts = [];
    for (var i = 0; i < counts.length; i++) {
        logCounts.push(counts[i] > 0 ? Math.log(counts[i]) : 0);
    }
    for (var j = 1; j < logCounts.length; j++) {
        var dt = timepoints[j] - timepoints[j - 1];
        rates.push(dt > 0 ? (logCounts[j] - logCounts[j - 1]) / dt : 0);
    }

    var maxRate = Math.max.apply(null, rates);
    var threshold = maxRate * 0.3; // 30% of max growth rate

    var phases = [];
    var lagEnd = 0;
    var logStart = -1, logEnd = -1;
    var stationaryStart = -1;
    var declineStart = -1;

    // Find log phase: contiguous region with rate > threshold
    for (var k = 0; k < rates.length; k++) {
        if (rates[k] > threshold && logStart === -1) {
            logStart = k;
            lagEnd = k;
        }
        if (logStart !== -1 && logEnd === -1 && rates[k] <= threshold) {
            logEnd = k;
        }
    }
    if (logStart !== -1 && logEnd === -1) logEnd = rates.length;

    // Find stationary: after log phase, rate near zero
    if (logEnd < rates.length) {
        stationaryStart = logEnd;
        for (var m = logEnd; m < rates.length; m++) {
            if (rates[m] < -threshold * 0.5) {
                declineStart = m;
                break;
            }
        }
    }

    // Build phase list
    if (lagEnd > 0) {
        phases.push({
            name: 'Lag',
            startTime: timepoints[0],
            endTime: timepoints[lagEnd],
            startIndex: 0,
            endIndex: lagEnd
        });
    }
    if (logStart !== -1) {
        phases.push({
            name: 'Log (Exponential)',
            startTime: timepoints[logStart],
            endTime: timepoints[Math.min(logEnd, timepoints.length - 1)],
            startIndex: logStart,
            endIndex: Math.min(logEnd, timepoints.length - 1)
        });
    }
    if (stationaryStart !== -1) {
        var stEnd = declineStart !== -1 ? declineStart : rates.length;
        phases.push({
            name: 'Stationary',
            startTime: timepoints[stationaryStart],
            endTime: timepoints[Math.min(stEnd, timepoints.length - 1)],
            startIndex: stationaryStart,
            endIndex: Math.min(stEnd, timepoints.length - 1)
        });
    }
    if (declineStart !== -1) {
        phases.push({
            name: 'Death/Decline',
            startTime: timepoints[declineStart],
            endTime: timepoints[timepoints.length - 1],
            startIndex: declineStart,
            endIndex: timepoints.length - 1
        });
    }

    return { phases: phases, rates: rates, logCounts: logCounts };
}

// ── logistic fit (4-parameter via iterative refinement) ────────────

function fitLogistic(timepoints, counts) {
    // 4PL: y = D + (A - D) / (1 + (t/C)^B)
    // A = min, D = max, C = inflection, B = steepness
    var A = Math.min.apply(null, counts);
    var D = Math.max.apply(null, counts);
    var C = timepoints[Math.floor(timepoints.length / 2)];
    var B = 1;

    function predict(t, a, b, c, d) {
        var ratio = t / c;
        return d + (a - d) / (1 + Math.pow(Math.max(ratio, 1e-10), b));
    }

    function sse(a, b, c, d) {
        var s = 0;
        for (var i = 0; i < timepoints.length; i++) {
            var diff = counts[i] - predict(timepoints[i], a, b, c, d);
            s += diff * diff;
        }
        return s;
    }

    // Simple coordinate descent
    var step = 0.1;
    for (var iter = 0; iter < 200; iter++) {
        var best = sse(A, B, C, D);
        // Try adjusting each parameter
        var params = [A, B, C, D];
        var scales = [A || 1, 1, C || 1, D || 1];
        for (var p = 0; p < 4; p++) {
            var delta = scales[p] * step;
            var trial = params.slice();
            trial[p] += delta;
            var s1 = sse(trial[0], trial[1], trial[2], trial[3]);
            if (s1 < best) {
                params = trial;
                best = s1;
                continue;
            }
            trial = params.slice();
            trial[p] -= delta;
            if (trial[p] > 0 || p === 0) {
                var s2 = sse(trial[0], trial[1], trial[2], trial[3]);
                if (s2 < best) {
                    params = trial;
                    best = s2;
                }
            }
        }
        A = params[0]; B = params[1]; C = params[2]; D = params[3];
        if (iter % 50 === 49) step *= 0.5;
    }

    // R²
    var ssTot = 0, ssRes = 0;
    var my = mean(counts);
    for (var i = 0; i < counts.length; i++) {
        var pred = predict(timepoints[i], A, B, C, D);
        ssTot += (counts[i] - my) * (counts[i] - my);
        ssRes += (counts[i] - pred) * (counts[i] - pred);
    }

    return {
        parameters: { A: round(A), B: round(B), C: round(C), D: round(D) },
        r2: round(ssTot === 0 ? 1 : 1 - ssRes / ssTot),
        predicted: timepoints.map(function (t) { return round(predict(t, A, B, C, D)); })
    };
}

// ── main analyzer ──────────────────────────────────────────────────

function createGrowthCurveAnalyzer() {
    return {
        /**
         * Analyze a growth curve dataset.
         * @param {Object} data
         * @param {number[]} data.timepoints - Time values
         * @param {number[]} data.counts - Cell/colony counts
         * @param {string} [data.timeUnit='hours'] - Unit label
         * @param {string} [data.label='Unnamed'] - Dataset label
         * @returns {Object} Analysis results
         */
        analyze: function (data) {
            validateInput(data);
            var timeUnit = data.timeUnit || 'hours';
            var label = data.label || 'Unnamed';
            var tp = data.timepoints;
            var cts = data.counts;

            var detection = detectPhases(tp, cts);
            var logistic = fitLogistic(tp, cts);

            // Doubling time from log phase
            var doublingTime = null;
            var logPhase = null;
            for (var i = 0; i < detection.phases.length; i++) {
                if (detection.phases[i].name.indexOf('Log') === 0) {
                    logPhase = detection.phases[i];
                    break;
                }
            }
            if (logPhase) {
                var logTp = [];
                var logLn = [];
                for (var j = logPhase.startIndex; j <= logPhase.endIndex && j < tp.length; j++) {
                    logTp.push(tp[j]);
                    logLn.push(detection.logCounts[j]);
                }
                if (logTp.length >= 2) {
                    var reg = linearRegression(logTp, logLn);
                    if (reg.slope > 0) {
                        doublingTime = round(Math.LN2 / reg.slope);
                    }
                }
            }

            // Basic stats
            var maxCount = Math.max.apply(null, cts);
            var minCount = Math.min.apply(null, cts);
            var foldChange = minCount > 0 ? round(maxCount / minCount) : null;

            return {
                label: label,
                timeUnit: timeUnit,
                dataPoints: tp.length,
                summary: {
                    minCount: minCount,
                    maxCount: maxCount,
                    foldChange: foldChange,
                    doublingTime: doublingTime,
                    doublingTimeUnit: timeUnit
                },
                phases: detection.phases,
                growthRates: detection.rates.map(function (r) { return round(r, 6); }),
                logisticFit: logistic
            };
        },

        /**
         * Compare multiple growth curves side by side.
         * @param {Object[]} datasets - Array of data objects (same format as analyze)
         * @returns {Object} Comparative analysis
         */
        compare: function (datasets) {
            if (!Array.isArray(datasets) || datasets.length < 2)
                throw new Error('Need at least 2 datasets to compare');

            var results = [];
            for (var i = 0; i < datasets.length; i++) {
                results.push(this.analyze(datasets[i]));
            }

            // Rank by doubling time (faster = better)
            var ranked = results.slice().sort(function (a, b) {
                var da = a.summary.doublingTime || Infinity;
                var db = b.summary.doublingTime || Infinity;
                return da - db;
            });

            return {
                count: datasets.length,
                analyses: results,
                ranking: ranked.map(function (r, idx) {
                    return {
                        rank: idx + 1,
                        label: r.label,
                        doublingTime: r.summary.doublingTime,
                        foldChange: r.summary.foldChange,
                        maxCount: r.summary.maxCount
                    };
                }),
                fastest: ranked[0].label,
                slowest: ranked[ranked.length - 1].label
            };
        },

        /**
         * Export analysis results as CSV string.
         * @param {Object} analysis - Result from analyze()
         * @returns {string} CSV content
         */
        toCSV: function (analysis) {
            var lines = ['Time,Count,GrowthRate,Phase,LogisticFit'];
            var tp = [];
            // Reconstruct timepoints from phases/rates length
            // Use logistic predicted length as proxy
            var n = analysis.logisticFit.predicted.length;
            for (var i = 0; i < n; i++) {
                var phase = '';
                for (var p = 0; p < analysis.phases.length; p++) {
                    var ph = analysis.phases[p];
                    if (i >= ph.startIndex && i <= ph.endIndex) {
                        phase = ph.name;
                        break;
                    }
                }
                var rate = i > 0 && i - 1 < analysis.growthRates.length ? analysis.growthRates[i - 1] : '';
                lines.push(i + ',' + (analysis.logisticFit.predicted[i] || '') + ',' + rate + ',' + phase + ',' + analysis.logisticFit.predicted[i]);
            }
            return lines.join('\n');
        }
    };
}

module.exports = { createGrowthCurveAnalyzer: createGrowthCurveAnalyzer };
