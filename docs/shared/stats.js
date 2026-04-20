/**
 * Shared statistical utilities for BioBots SDK modules.
 *
 * Centralizes mean/stddev helpers previously duplicated across
 * cellViability, capability, environmentalMonitor, spectrophotometer,
 * and westernBlot modules.
 *
 * @module stats
 */
'use strict';

/**
 * Arithmetic mean of a numeric array.
 * Uses Kahan compensated summation for improved numerical stability
 * when accumulating many floating-point values.
 *
 * @param {number[]} arr - Array of numbers.
 * @returns {number} Mean value, or 0 for empty arrays.
 */
function mean(arr) {
    if (!arr.length) return 0;
    var sum = 0;
    var compensation = 0;
    for (var i = 0; i < arr.length; i++) {
        var y = arr[i] - compensation;
        var t = sum + y;
        compensation = (t - sum) - y;
        sum = t;
    }
    return sum / arr.length;
}

/**
 * Median of a numeric array (returns the average of the two middle
 * values for even-length arrays).
 *
 * @param {number[]} arr - Array of numbers (not modified).
 * @returns {number} Median value, or 0 for empty arrays.
 */
function median(arr) {
    if (!arr.length) return 0;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Coefficient of variation (CV) as a percentage: (stddev / mean) * 100.
 * Returns 0 when mean is zero to avoid division by zero.
 *
 * @param {number[]} arr - Array of numbers.
 * @returns {number} CV percentage, or 0 for degenerate inputs.
 */
function cv(arr) {
    var m = mean(arr);
    if (m === 0) return 0;
    return (stddev(arr, m) / Math.abs(m)) * 100;
}

/**
 * Sample standard deviation (Bessel-corrected, n-1 denominator).
 *
 * @param {number[]} arr - Array of numbers.
 * @param {number} [avg] - Pre-computed mean (optional; computed if omitted).
 * @returns {number} Standard deviation, or 0 for arrays with fewer than 2 elements.
 */
function stddev(arr, avg) {
    if (arr.length < 2) return 0;
    var m = typeof avg === 'number' ? avg : mean(arr);
    var ss = 0;
    for (var i = 0; i < arr.length; i++) ss += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(ss / (arr.length - 1));
}

/**
 * Population standard deviation (n denominator, no Bessel correction).
 *
 * @param {number[]} arr - Array of numbers.
 * @param {number} [avg] - Pre-computed mean (optional; computed if omitted).
 * @returns {number} Population standard deviation, or 0 for arrays with fewer than 2 elements.
 */
function pstddev(arr, avg) {
    if (arr.length < 2) return 0;
    var m = typeof avg === 'number' ? avg : mean(arr);
    var ss = 0;
    for (var i = 0; i < arr.length; i++) ss += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(ss / arr.length);
}

/**
 * Linear-interpolation percentile (p ∈ 0–100).
 *
 * @param {number[]} arr - Array of numbers (not modified).
 * @param {number} p - Percentile (0–100).
 * @returns {number} Interpolated value, or 0 for empty arrays.
 */
function percentile(arr, p) {
    if (!arr.length) return 0;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var idx = (p / 100) * (sorted.length - 1);
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Ordinary least-squares linear regression (single-pass).
 *
 * Computes slope, intercept, and R² from running accumulators in one
 * O(n) pass instead of the traditional multi-pass approach.  Uses the
 * algebraic identity for R² to avoid recomputing predicted values.
 *
 * @param {number[]} xs - Independent variable values.
 * @param {number[]} ys - Dependent variable values (same length as xs).
 * @returns {{ slope: number, intercept: number, r2: number }}
 */
function linearRegression(xs, ys) {
    var n = xs.length;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (var i = 0; i < n; i++) {
        sumX  += xs[i];
        sumY  += ys[i];
        sumXY += xs[i] * ys[i];
        sumX2 += xs[i] * xs[i];
        sumY2 += ys[i] * ys[i];
    }
    var denom = n * sumX2 - sumX * sumX;
    var slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;
    var ssTot = sumY2 - (sumY * sumY) / n;
    var ssRes = sumY2 - 2 * slope * sumXY - 2 * intercept * sumY
              + slope * slope * sumX2 + 2 * slope * intercept * sumX
              + n * intercept * intercept;
    var r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
    return { slope: slope, intercept: intercept, r2: r2 };
}

/**
 * Descriptive statistics in a single pass: count, mean, stddev, min, max, CV.
 *
 * Combines min/max/mean/stddev/cv into one O(n) pass so callers don't need
 * to re-iterate or hand-roll the same loop.
 *
 * Uses sample standard deviation (n-1) consistent with stddev().
 *
 * @param {number[]} values - Array of numbers.
 * @returns {{ count: number, mean: number, stdDev: number, min: number, max: number, cv: number }}
 */
function descriptiveStats(values) {
    if (!values || values.length === 0) {
        return { count: 0, mean: 0, stdDev: 0, min: 0, max: 0, cv: 0 };
    }
    var n = values.length;
    var sum = 0;
    var lo = Infinity;
    var hi = -Infinity;
    for (var i = 0; i < n; i++) {
        sum += values[i];
        if (values[i] < lo) lo = values[i];
        if (values[i] > hi) hi = values[i];
    }
    var avg = sum / n;
    var sumSqDiff = 0;
    for (var j = 0; j < n; j++) {
        var d = values[j] - avg;
        sumSqDiff += d * d;
    }
    var sd = n > 1 ? Math.sqrt(sumSqDiff / (n - 1)) : 0;
    var coefficient = avg !== 0 ? (sd / Math.abs(avg)) * 100 : 0;
    return {
        count: n,
        mean: Math.round(avg * 10000) / 10000,
        stdDev: Math.round(sd * 10000) / 10000,
        min: lo,
        max: hi,
        cv: Math.round(coefficient * 100) / 100
    };
}

exports.mean = mean;
exports.median = median;
exports.cv = cv;
exports.stddev = stddev;
exports.pstddev = pstddev;
exports.percentile = percentile;
exports.linearRegression = linearRegression;
exports.descriptiveStats = descriptiveStats;
