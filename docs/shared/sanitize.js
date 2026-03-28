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
 * Returns a copy with __proto__, constructor, and prototype keys
 * removed. When `deep` is true (the default), nested objects and
 * arrays are recursively cleaned — this prevents attackers from
 * hiding pollution vectors inside nested payloads that bypass a
 * shallow-only strip.
 *
 * A `maxDepth` limit (default 32) prevents stack overflow from
 * circular or deeply-nested adversarial input.
 *
 * @param {Object} obj - Untrusted input object.
 * @param {Object} [opts] - Options.
 * @param {boolean} [opts.deep=true] - Recursively clean nested objects/arrays.
 * @param {number} [opts.maxDepth=32] - Maximum recursion depth.
 * @returns {Object} Cleaned copy (empty object if input is falsy).
 */
function stripDangerousKeys(obj, opts) {
    var deep = (!opts || opts.deep === undefined) ? true : !!opts.deep;
    var maxDepth = (opts && typeof opts.maxDepth === 'number') ? opts.maxDepth : 32;
    return _stripImpl(obj, deep, maxDepth, 0);
}

function _stripImpl(obj, deep, maxDepth, depth) {
    if (!obj || typeof obj !== 'object') return {};

    if (Array.isArray(obj)) {
        if (!deep || depth >= maxDepth) return obj.slice();
        var arr = [];
        for (var a = 0; a < obj.length; a++) {
            var item = obj[a];
            if (item && typeof item === 'object') {
                arr.push(Array.isArray(item)
                    ? _stripImpl(item, true, maxDepth, depth + 1)
                    : _stripImpl(item, true, maxDepth, depth + 1));
            } else {
                arr.push(item);
            }
        }
        return arr;
    }

    var out = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
        if (DANGEROUS_KEYS[keys[i]]) continue;
        var val = obj[keys[i]];
        if (deep && depth < maxDepth && val && typeof val === 'object') {
            out[keys[i]] = _stripImpl(val, true, maxDepth, depth + 1);
        } else {
            out[keys[i]] = val;
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

/**
 * Escape a value for safe CSV inclusion.
 *
 * Defends against CSV formula injection (OWASP): if the string starts
 * with a character that spreadsheet applications interpret as a formula
 * or command (= + - @ \t \r), it is prefixed with a single-quote to
 * force text mode.  Legitimate negative/positive numbers are preserved.
 *
 * Also handles RFC 4180 quoting for commas, double-quotes, newlines,
 * and leading/trailing whitespace.
 *
 * @param {*} value - The value to escape.
 * @returns {string} CSV-safe string.
 */
function escapeCSVField(value) {
    if (value == null) return '';
    var str = String(value);

    var firstChar = str.charAt(0);
    if (firstChar === '=' || firstChar === '+' || firstChar === '-' ||
        firstChar === '@' || firstChar === '\t' || firstChar === '\r') {
        // Preserve valid numbers like -3.14 or +1.5
        if (!((firstChar === '-' || firstChar === '+') && str.length > 1 && isFinite(Number(str)))) {
            str = "'" + str;
        }
    }

    if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 ||
        str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1 ||
        str !== str.trim()) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

module.exports = {
    DANGEROUS_KEYS: DANGEROUS_KEYS,
    stripDangerousKeys: stripDangerousKeys,
    isDangerousKey: isDangerousKey,
    safeResolvePath: safeResolvePath,
    escapeCSVField: escapeCSVField
};
