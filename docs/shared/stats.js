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

exports.mean = mean;
exports.median = median;
exports.cv = cv;
exports.stddev = stddev;
exports.pstddev = pstddev;
