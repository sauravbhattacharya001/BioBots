'use strict';

/**
 * Shared utility functions for BioBots simulation modules.
 *
 * Extracted from degradation.js, compatibility.js, parameterOptimizer.js,
 * and maturation.js to eliminate duplication.
 */

/**
 * Clamp a value between lo and hi (inclusive).
 * @param {number} v - Value to clamp.
 * @param {number} lo - Lower bound.
 * @param {number} hi - Upper bound.
 * @returns {number} Clamped value.
 */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Validate that a value is a positive finite number.
 * @param {number} val - Value to check.
 * @param {string} name - Parameter name for error messages.
 * @throws {Error} If val is not a positive finite number.
 */
function validatePositive(val, name) {
  if (typeof val !== 'number' || !isFinite(val) || val <= 0) {
    throw new Error(`${name} must be a positive finite number, got ${val}`);
  }
}

/**
 * Validate that a value is a non-negative finite number.
 * @param {number} val - Value to check.
 * @param {string} name - Parameter name for error messages.
 * @throws {Error} If val is not a non-negative finite number.
 */
function validateNonNegative(val, name) {
  if (typeof val !== 'number' || !isFinite(val) || val < 0) {
    throw new Error(`${name} must be a non-negative finite number, got ${val}`);
  }
}

/**
 * Arithmetic mean of an array of numbers.
 * @param {number[]} arr - Values.
 * @returns {number} Mean, or 0 for empty input.
 */
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/**
 * Sample standard deviation (Bessel-corrected, N−1).
 * @param {number[]} arr - Values.
 * @returns {number} Standard deviation, or 0 when fewer than 2 values.
 */
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

/**
 * Median of an array (sorts a copy, no mutation).
 * @param {number[]} arr - Values.
 * @returns {number} Median, or 0 for empty input.
 */
function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Linear-interpolation percentile (p ∈ 0-100).
 * @param {number[]} arr - Values (unsorted OK — copied internally).
 * @param {number} p - Percentile (0-100).
 * @returns {number} Interpolated value, or 0 for empty input.
 */
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Round a number to a fixed number of decimal places.
 * @param {number} n - Value to round.
 * @param {number} decimals - Number of decimal places.
 * @returns {number} Rounded value.
 */
function round(n, decimals) {
  var factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

module.exports = { clamp, validatePositive, validateNonNegative, mean, stddev, median, percentile, round };
