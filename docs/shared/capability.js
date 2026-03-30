'use strict';

/**
 * Process Capability Analyzer — Six Sigma Cp/Cpk/Pp/Ppk computation.
 *
 * Computes short-term (within-batch) and long-term (overall) process capability
 * indices for bioprinting quality assessment.
 *
 * @example
 *   var capability = createCapabilityAnalyzer();
 *   var result = capability.analyze({
 *     measurements: [2.1, 2.3, 2.2, 2.0, 2.4],
 *     lsl: 1.5,
 *     usl: 3.0,
 *     target: 2.25
 *   });
 */

/**
 * Standard normal CDF approximation (Abramowitz & Stegun 26.2.17).
 * Accurate to ~1.5e-7.
 */
function normalCDF(x) {
    if (x < -8) return 0;
    if (x > 8) return 1;

    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);

    var t = 1 / (1 + 0.2316419 * x);
    var d = 0.3989422804014327; // 1/sqrt(2*PI)
    var p = d * Math.exp(-0.5 * x * x);
    var poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));

    return sign === 1 ? 1 - p * poly : p * poly;
}

var _stats = require('./stats');
var mean = _stats.mean;
var stddev = _stats.pstddev;   // population stddev for Cp/Cpk
var sampleStddev = _stats.stddev; // sample stddev (Bessel-corrected) for Pp/Ppk


/**
 * Estimate within-subgroup sigma using average range method.
 * Uses d2 constants for subgroup sizes 2-10.
 */
function withinGroupSigma(batches) {
    var d2Table = {
        2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326,
        6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078
    };

    // Compute per-batch R/d2 estimates to handle variable subgroup sizes
    // (e.g. the last auto-grouped batch may be smaller than the rest).
    var sigmaEstimates = [];
    for (var i = 0; i < batches.length; i++) {
        var batch = batches[i];
        if (batch.length < 2) continue;
        var min = batch[0], max = batch[0];
        for (var j = 1; j < batch.length; j++) {
            if (batch[j] < min) min = batch[j];
            if (batch[j] > max) max = batch[j];
        }
        var n = Math.min(batch.length, 10);
        var d2 = d2Table[n] || d2Table[10];
        sigmaEstimates.push((max - min) / d2);
    }

    if (sigmaEstimates.length === 0) return 0;

    return mean(sigmaEstimates);
}

/**
 * Create a capability analyzer instance.
 */
function createCapabilityAnalyzer() {
    return {
        /**
         * Analyze process capability.
         *
         * @param {Object} opts
         * @param {number[]} opts.measurements - Flat array of all measurements
         * @param {number[][]} [opts.batches] - Measurements grouped by batch (for Cp/Cpk)
         * @param {number} opts.lsl - Lower specification limit
         * @param {number} opts.usl - Upper specification limit
         * @param {number} [opts.target] - Target value (defaults to midpoint of LSL/USL)
         * @param {number} [opts.subgroupSize=5] - Subgroup size when auto-grouping
         * @returns {Object} Capability analysis results
         */
        analyze: function (opts) {
            if (!opts) throw new Error('Options required');
            if (typeof opts.lsl !== 'number' || typeof opts.usl !== 'number') {
                throw new Error('Both lsl and usl are required as numbers');
            }
            if (opts.usl <= opts.lsl) {
                throw new Error('usl must be greater than lsl');
            }

            var measurements = opts.measurements;
            var batches = opts.batches;

            // Flatten batches into measurements if only batches provided
            if (!measurements && batches) {
                measurements = [];
                for (var b = 0; b < batches.length; b++) {
                    for (var m = 0; m < batches[b].length; m++) {
                        measurements.push(batches[b][m]);
                    }
                }
            }

            if (!measurements || measurements.length < 2) {
                throw new Error('At least 2 measurements required');
            }

            var lsl = opts.lsl;
            var usl = opts.usl;
            var target = typeof opts.target === 'number' ? opts.target : (lsl + usl) / 2;
            var subgroupSize = opts.subgroupSize || 5;

            // Auto-create batches if not provided
            if (!batches) {
                batches = [];
                for (var i = 0; i < measurements.length; i += subgroupSize) {
                    var group = measurements.slice(i, i + subgroupSize);
                    if (group.length >= 2) {
                        batches.push(group);
                    }
                }
            }

            var overallMean = mean(measurements);
            var specRange = usl - lsl;

            // Long-term (overall) sigma — uses sample stddev of all measurements
            var overallSigma = sampleStddev(measurements, overallMean);

            // Short-term (within-subgroup) sigma
            var withinSigma = batches.length >= 2
                ? withinGroupSigma(batches)
                : overallSigma;

            // Prevent division by zero
            if (withinSigma === 0) withinSigma = 1e-10;
            if (overallSigma === 0) overallSigma = 1e-10;

            // Cp / Cpk (short-term, within-subgroup variation)
            var cp = specRange / (6 * withinSigma);
            var cpupper = (usl - overallMean) / (3 * withinSigma);
            var cplower = (overallMean - lsl) / (3 * withinSigma);
            var cpk = Math.min(cpupper, cplower);

            // Pp / Ppk (long-term, overall variation)
            var pp = specRange / (6 * overallSigma);
            var ppupper = (usl - overallMean) / (3 * overallSigma);
            var pplower = (overallMean - lsl) / (3 * overallSigma);
            var ppk = Math.min(ppupper, pplower);

            // Sigma level (based on Ppk for long-term)
            var sigmaLevel = 3 * ppk;

            // Percent out of spec (using overall sigma)
            var zUpper = (usl - overallMean) / overallSigma;
            var zLower = (overallMean - lsl) / overallSigma;
            var pctAboveUSL = 1 - normalCDF(zUpper);
            var pctBelowLSL = normalCDF(-zLower);
            var pctOutOfSpec = pctAboveUSL + pctBelowLSL;

            // Cpm (Taguchi capability index) — accounts for deviation from target
            var sumSqTarget = 0;
            for (var k = 0; k < measurements.length; k++) {
                var d = measurements[k] - target;
                sumSqTarget += d * d;
            }
            var sigmaTarget = Math.sqrt(sumSqTarget / measurements.length);
            var cpm = sigmaTarget > 0 ? specRange / (6 * sigmaTarget) : Infinity;

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
                cpm: round4(cpm),
                sigmaLevel: round4(sigmaLevel),
                pctOutOfSpec: round6(pctOutOfSpec * 100),
                pctAboveUSL: round6(pctAboveUSL * 100),
                pctBelowLSL: round6(pctBelowLSL * 100),
                verdict: verdict,
                stats: {
                    mean: round4(overallMean),
                    overallSigma: round6(overallSigma),
                    withinSigma: round6(withinSigma),
                    n: measurements.length,
                    nBatches: batches.length,
                    target: target,
                    lsl: lsl,
                    usl: usl
                }
            };
        },

        /**
         * Compare capability across multiple parameters.
         *
         * @param {Object[]} params - Array of {name, measurements, batches, lsl, usl, target}
         * @returns {Object[]} Array of results with name included
         */
        compareParameters: function (params) {
            var results = [];
            for (var i = 0; i < params.length; i++) {
                var r = this.analyze(params[i]);
                r.name = params[i].name || 'Parameter ' + (i + 1);
                results.push(r);
            }
            // Sort by Cpk ascending (worst first)
            results.sort(function (a, b) { return a.cpk - b.cpk; });
            return results;
        }
    };
}

function round4(n) {
    return Math.round(n * 10000) / 10000;
}

function round6(n) {
    return Math.round(n * 1000000) / 1000000;
}

module.exports = {
    createCapabilityAnalyzer: createCapabilityAnalyzer
};
