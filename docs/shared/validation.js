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
    throw new Error(name + ' must be a positive finite number');
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
    throw new Error(name + ' must be a non-negative finite number');
  }
}

/**
 * Round a number to a given number of decimal places.
 *
 * @param {number} val - Number to round.
 * @param {number} [decimals=4] - Decimal places.
 * @returns {number} Rounded value.
 */
function round(val, decimals) {
  var factor = Math.pow(10, decimals || 4);
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

exports.validatePositive = validatePositive;
exports.validateNonNegative = validateNonNegative;
exports.round = round;
exports.clamp = clamp;
