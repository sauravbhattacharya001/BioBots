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
 *
 * @param {number[]} arr - Array of numbers.
 * @returns {number} Mean value, or 0 for empty arrays.
 */
function mean(arr) {
    if (!arr.length) return 0;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
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
exports.stddev = stddev;
exports.pstddev = pstddev;
