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

module.exports = { clamp, validatePositive, validateNonNegative };
