/**
 * Shared validation and rounding utilities for BioBots SDK modules.
 *
 * Centralizes the `validatePositive` and `round` helpers that were
 * previously duplicated across 10+ modules.  Importing from a single
 * source reduces maintenance burden and ensures consistent behavior.
 *
 * @module validation
 */
'use strict';

/**
 * Validate that a value is a positive finite number.
 *
 * @param {*} val - Value to check.
 * @param {string} name - Parameter name for error messages.
 * @throws {Error} If val is not a positive finite number.
 */
function validatePositive(val, name) {
  if (typeof val !== 'number' || val <= 0 || !isFinite(val)) {
    throw new Error(name + ' must be a positive finite number, got ' + val);
  }
}

/**
 * Validate that a value is a non-negative finite number.
 *
 * @param {*} val - Value to check.
 * @param {string} name - Parameter name for error messages.
 * @throws {Error} If val is not a non-negative finite number.
 */
function validateNonNegative(val, name) {
  if (typeof val !== 'number' || val < 0 || !isFinite(val)) {
    throw new Error(name + ' must be a non-negative finite number, got ' + val);
  }
}

/**
 * Round a number to a given number of decimal places.
 *
 * Uses a pre-computed lookup table for common decimal counts (0–10)
 * to avoid repeated Math.pow(10, n) calls on the hot path.  This
 * function is invoked thousands of times per analysis run across
 * most SDK modules.
 *
 * @param {number} val - Number to round.
 * @param {number} [decimals=2] - Decimal places (0–10 use fast path).
 * @returns {number} Rounded value.
 */
var _powTable = [1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10];

function round(val, decimals) {
  var d = decimals != null ? decimals : 2;
  var factor = d >= 0 && d <= 10 ? _powTable[d] : Math.pow(10, d);
  return Math.round(val * factor) / factor;
}

/**
 * Clamp a number between a minimum and maximum value.
 *
 * @param {number} val - Value to clamp.
 * @param {number} lo - Minimum bound.
 * @param {number} hi - Maximum bound.
 * @returns {number} Clamped value.
 */
function clamp(val, lo, hi) {
  return val < lo ? lo : val > hi ? hi : val;
}

/**
 * Escape a string for safe insertion into HTML.
 * Prevents XSS when rendering user-supplied data.
 *
 * @param {*} str - Value to escape (coerced to string).
 * @returns {string} HTML-safe string with &, <, >, ", ' escaped.
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

exports.validatePositive = validatePositive;
exports.validateNonNegative = validateNonNegative;
exports.round = round;
exports.clamp = clamp;
exports.escapeHtml = escapeHtml;
