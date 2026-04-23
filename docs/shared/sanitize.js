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
// Use Object.defineProperty for '__proto__' — object literal syntax
// `{ '__proto__': 1 }` sets the object's prototype instead of creating
// a regular enumerable property, so `DANGEROUS_KEYS['__proto__']` would
// return Object.prototype (truthy but !== 1), making isDangerousKey()
// silently fail to detect the most critical prototype-pollution vector.
var DANGEROUS_KEYS = Object.create(null);
DANGEROUS_KEYS['__proto__'] = 1;
DANGEROUS_KEYS['constructor'] = 1;
DANGEROUS_KEYS['prototype'] = 1;

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

module.exports = {
    DANGEROUS_KEYS: DANGEROUS_KEYS,
    stripDangerousKeys: stripDangerousKeys,
    isDangerousKey: isDangerousKey,
    safeResolvePath: safeResolvePath
};
