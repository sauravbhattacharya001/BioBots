'use strict';

/**
 * Shared sanitization utilities for prototype-pollution prevention.
 *
 * Centralizes the dangerous-key stripping logic that was previously
 * duplicated across jobEstimator, mediaPrep, sampleTracker, shelfLife,
 * printResolution, and other modules.
 *
 * @module sanitize
 */

/** Keys that must never be accepted from untrusted input. */
var DANGEROUS_KEYS = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };

/**
 * Strip prototype-pollution keys from an untrusted object.
 *
 * Returns a shallow copy with __proto__, constructor, and prototype
 * keys removed. Does NOT deep-clean nested objects — callers should
 * apply this at each merge/spread site.
 *
 * @param {Object} obj - Untrusted input object.
 * @returns {Object} Cleaned shallow copy (empty object if input is falsy).
 */
function stripDangerousKeys(obj) {
    if (!obj || typeof obj !== 'object') return {};
    var out = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
        if (!DANGEROUS_KEYS[keys[i]]) {
            out[keys[i]] = obj[keys[i]];
        }
    }
    return out;
}

/**
 * Check whether a property name is dangerous (prototype pollution vector).
 *
 * @param {string} key - Property name to check.
 * @returns {boolean} True if the key is dangerous.
 */
function isDangerousKey(key) {
    return DANGEROUS_KEYS[key] === 1;
}

/**
 * Resolve a dot-separated property path on an object, rejecting
 * dangerous keys at any level.
 *
 * @param {Object} obj - Source object.
 * @param {string} path - Dot-separated path (e.g. 'print_data.livePercent').
 * @returns {*} Resolved value, or null if path is invalid/dangerous.
 */
function safeResolvePath(obj, path) {
    if (obj == null || !path) return null;
    var parts = path.split('.');
    var current = obj;
    for (var i = 0; i < parts.length; i++) {
        if (DANGEROUS_KEYS[parts[i]]) return null;
        if (current == null || typeof current !== 'object') return null;
        if (!Object.prototype.hasOwnProperty.call(current, parts[i])) return null;
        current = current[parts[i]];
    }
    return current === undefined ? null : current;
}

module.exports = {
    DANGEROUS_KEYS: DANGEROUS_KEYS,
    stripDangerousKeys: stripDangerousKeys,
    isDangerousKey: isDangerousKey,
    safeResolvePath: safeResolvePath
};
