/**
 * BioBots Process Capability Module
 *
 * Computes Six Sigma process capability indices (Cp, Cpk, Pp, Ppk),
 * sigma level, predicted % out of spec, and a capability verdict.
 *
 * Supports both flat measurement arrays and grouped (batch) data for
 * distinguishing within-batch (short-term) vs batch-to-batch (long-term) variation.
 *
 * @example
 *   var capability = require('./capability');
 *   var analyzer = capability.createCapabilityAnalyzer();
 *   var result = analyzer.analyze({
 *     measurements: [[2.1, 2.3, 2.2], [2.0, 2.4, 2.1]],
 *     lsl: 1.5,
 *     usl: 3.0,
 *     target: 2.25
 *   });
 */

'use strict';

/* ------------------------------------------------------------------ */
/*  Helper: standard normal CDF (Abramowitz & Stegun approximation)   */
/* ------------------------------------------------------------------ */

/**
 * Approximate the standard normal cumulative distribution function.
 * Max absolute error ≈ 7.5 × 10⁻⁸.
 * @param {number} x
 * @returns {number}
 */
function normalCDF(x) {
    if (x === Infinity) return 1;
    if (x === -Infinity) return 0;
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1.0 / (1.0 + 0.2316419 * x);
    var d = 0.3989422804014327; // 1 / sqrt(2π)
    var p = d * Math.exp(-0.5 * x * x) *
        (t * (0.319381530 +
            t * (-0.356563782 +
                t * (1.781477937 +
                    t * (-1.821255978 +
                        t * 1.330274429)))));
    return sign < 0 ? p : 1 - p;
}

/* ------------------------------------------------------------------ */
/*  Statistics helpers                                                 */
/* ------------------------------------------------------------------ */

function mean(arr) {
    if (!arr.length) return 0;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
}

function stdev(arr, ddof) {
    if (arr.length < 2) return 0;
    ddof = ddof == null ? 1 : ddof;
    var m = mean(arr);
    var ss = 0;
    for (var i = 0; i < arr.length; i++) ss += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(ss / (arr.length - ddof));
}

/**
 * Pooled within-subgroup standard deviation using the average-range method.
 * Uses d2 unbiasing constants for subgroup sizes 2-10.
 * @param {number[][]} groups
 * @returns {number}
 */
function pooledWithinSigma(groups) {
    // d2 constants for subgroup sizes 2–10
    var d2 = { 2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078 };

    var totalRange = 0;
    var count = 0;
    for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        if (g.length < 2) continue;
        var min = g[0], max = g[0];
        for (var j = 1; j < g.length; j++) {
            if (g[j] < min) min = g[j];
            if (g[j] > max) max = g[j];
        }
        totalRange += (max - min);
        count++;
    }
    if (count === 0) return 0;

    var avgRange = totalRange / count;
    var n = groups[0].length;
    var d2Val = d2[Math.min(n, 10)] || d2[10];
    return avgRange / d2Val;
}

/* ------------------------------------------------------------------ */
/*  Main analyzer                                                      */
/* ------------------------------------------------------------------ */

/**
 * Create a process capability analyzer.
 * @returns {{ analyze: function }}
 */
function createCapabilityAnalyzer() {
    return { analyze: analyze };
}

/**
 * Analyze process capability.
 *
 * @param {Object} opts
 * @param {number[]|number[][]} opts.measurements - Flat array or array of batch arrays.
 * @param {number} opts.lsl - Lower specification limit.
 * @param {number} opts.usl - Upper specification limit.
 * @param {number} [opts.target] - Target value (defaults to midpoint of LSL/USL).
 * @returns {Object} Capability results.
 */
function analyze(opts) {
    if (!opts || !opts.measurements || !opts.measurements.length) {
        throw new Error('measurements array is required and must not be empty');
    }
    if (opts.lsl == null || opts.usl == null) {
        throw new Error('Both lsl and usl are required');
    }
    if (opts.lsl >= opts.usl) {
        throw new Error('lsl must be less than usl');
    }

    var lsl = opts.lsl;
    var usl = opts.usl;
    var target = opts.target != null ? opts.target : (lsl + usl) / 2;

    // Determine if data is grouped (batches) or flat
    var isGrouped = Array.isArray(opts.measurements[0]);
    var allValues = [];
    var groups = null;

    if (isGrouped) {
        groups = opts.measurements;
        for (var i = 0; i < groups.length; i++) {
            for (var j = 0; j < groups[i].length; j++) {
                allValues.push(groups[i][j]);
            }
        }
    } else {
        allValues = opts.measurements;
    }

    if (allValues.length < 2) {
        throw new Error('At least 2 measurements are required');
    }

    var xbar = mean(allValues);
    var specWidth = usl - lsl;

    // Overall (long-term) standard deviation — sample stdev
    var sigmaOverall = stdev(allValues, 1);

    // Within-subgroup (short-term) standard deviation
    var sigmaWithin;
    if (groups && groups.length >= 2) {
        sigmaWithin = pooledWithinSigma(groups);
        if (sigmaWithin === 0) sigmaWithin = sigmaOverall; // fallback
    } else {
        // No subgroups — short-term ≈ long-term
        sigmaWithin = sigmaOverall;
    }

    // Cp / Cpk (short-term, within-subgroup variation)
    var cp = sigmaWithin > 0 ? specWidth / (6 * sigmaWithin) : Infinity;
    var cpupper = sigmaWithin > 0 ? (usl - xbar) / (3 * sigmaWithin) : Infinity;
    var cplower = sigmaWithin > 0 ? (xbar - lsl) / (3 * sigmaWithin) : Infinity;
    var cpk = Math.min(cpupper, cplower);

    // Pp / Ppk (long-term, overall variation)
    var pp = sigmaOverall > 0 ? specWidth / (6 * sigmaOverall) : Infinity;
    var ppupper = sigmaOverall > 0 ? (usl - xbar) / (3 * sigmaOverall) : Infinity;
    var pplower = sigmaOverall > 0 ? (xbar - lsl) / (3 * sigmaOverall) : Infinity;
    var ppk = Math.min(ppupper, pplower);

    // Sigma level (based on Cpk)
    var sigmaLevel = 3 * cpk;

    // Predicted % out of spec (using overall sigma for realistic prediction)
    var zUpper = sigmaOverall > 0 ? (usl - xbar) / sigmaOverall : Infinity;
    var zLower = sigmaOverall > 0 ? (xbar - lsl) / sigmaOverall : Infinity;
    var pctOutOfSpec = (1 - normalCDF(zUpper)) + (1 - normalCDF(zLower));

    // Verdict
    var verdict;
    if (cpk >= 1.33) {
        verdict = 'capable';
    } else if (cpk >= 1.0) {
        verdict = 'marginal';
    } else {
        verdict = 'incapable';
    }

    return {
        cp: round4(cp),
        cpk: round4(cpk),
        pp: round4(pp),
        ppk: round4(ppk),
        sigmaLevel: round4(sigmaLevel),
        pctOutOfSpec: round4(pctOutOfSpec),
        verdict: verdict,
        n: allValues.length,
        mean: round4(xbar),
        sigmaWithin: round4(sigmaWithin),
        sigmaOverall: round4(sigmaOverall),
        lsl: lsl,
        usl: usl,
        target: target
    };
}

function round4(v) {
    if (!isFinite(v)) return v;
    return Math.round(v * 10000) / 10000;
}

module.exports = {
    createCapabilityAnalyzer: createCapabilityAnalyzer
};
