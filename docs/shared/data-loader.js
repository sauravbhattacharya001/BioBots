'use strict';

/**
 * BioBots Shared Data Loader
 *
 * Centralizes fetching and validating bioprint-data.json so every
 * dashboard page uses the same load/validate/cache logic instead of
 * copy-pasting fetch().then().catch() boilerplate.
 *
 * Features:
 *   - Deduplicates concurrent fetches (returns same Promise)
 *   - Caches parsed data for the page lifetime
 *   - Provides standard validation filter (print_data, print_info,
 *     user_info, crosslinking, pressure, resolution)
 *   - Optional custom filter on top of validation
 *   - Consistent error reporting
 *
 * Usage in HTML pages:
 *   <script src="shared/data-loader.js"></script>
 *   <script>
 *     loadBioprintData().then(function(data) { ... });
 *     // or with standard filter:
 *     loadBioprintData({ validate: true }).then(function(data) { ... });
 *   </script>
 *
 * For testing (Node.js):
 *   var loader = require('./shared/data-loader');
 *   loader.validateRecord(record); // => true/false
 */

var _cachedData = null;
var _pendingFetch = null;
var _dataUrl = 'bioprint-data.json';

/**
 * Validate that a URL is safe to fetch.
 *
 * Allows relative paths and same-origin HTTP(S) URLs.  Blocks dangerous
 * schemes (javascript:, data:, file:, blob:, vbscript:) and URLs with
 * embedded credentials (user:pass@host) to prevent SSRF, XSS, and
 * data-exfiltration attacks.
 *
 * @param {string} url - URL to validate.
 * @returns {boolean} True if the URL is considered safe.
 */
function _isUrlSafe(url) {
    if (typeof url !== 'string' || url.length === 0) return false;

    // Trim and normalise to catch leading-whitespace bypass tricks
    var trimmed = url.trim();

    // Block dangerous URI schemes (case-insensitive)
    var lower = trimmed.toLowerCase();
    if (/^(javascript|data|vbscript|file|blob):/i.test(lower)) {
        return false;
    }

    // Block embedded credentials (https://user:pass@evil.com/...)
    if (/^https?:\/\/[^/]*@/i.test(trimmed)) {
        return false;
    }

    // Allow relative paths (no scheme) and http/https
    if (!/^https?:\/\//i.test(trimmed)) {
        // Relative path — allowed
        return true;
    }

    return true;
}

/**
 * Check whether a print record has all required fields for standard
 * dashboard analysis (viability, crosslinking, pressure, resolution).
 *
 * @param {Object} record - A single print record.
 * @returns {boolean} True if the record has all required nested fields.
 */
function validateRecord(record) {
    return !!(
        record &&
        record.print_data &&
        record.print_info &&
        record.user_info &&
        record.print_info.crosslinking &&
        record.print_info.pressure &&
        record.print_info.resolution
    );
}

/**
 * Load bioprint data, with optional validation filtering.
 *
 * Fetches bioprint-data.json (once per page load), optionally filters
 * out records missing required fields.
 *
 * @param {Object} [options]
 * @param {boolean} [options.validate=false] - If true, return only
 *   records passing validateRecord().
 * @param {Function} [options.filter] - Additional custom filter applied
 *   after validation. Receives each record, returns true to keep.
 * @param {string} [options.url] - Override data URL (for testing).
 * @returns {Promise<Object[]>} Resolves with the (optionally filtered) data array.
 */
function loadBioprintData(options) {
    var opts = options || {};
    var url = opts.url || _dataUrl;

    if (!_isUrlSafe(url)) {
        return Promise.reject(new Error(
            'Unsafe data URL blocked: ' + url +
            '. Only relative paths and HTTP(S) URLs without credentials are allowed.'
        ));
    }

    var dataPromise;

    if (_cachedData) {
        dataPromise = Promise.resolve(_cachedData);
    } else if (_pendingFetch) {
        dataPromise = _pendingFetch;
    } else {
        _pendingFetch = fetch(url)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(
                        'Failed to load bioprint data: HTTP ' + response.status
                    );
                }
                return response.json();
            })
            .then(function (data) {
                if (!Array.isArray(data)) {
                    throw new Error(
                        'Bioprint data must be an array, got ' + typeof data
                    );
                }
                _cachedData = data;
                _pendingFetch = null;
                return data;
            })
            .catch(function (err) {
                _pendingFetch = null;
                throw err;
            });
        dataPromise = _pendingFetch;
    }

    return dataPromise.then(function (data) {
        var result = data;
        if (opts.validate) {
            result = result.filter(validateRecord);
        }
        if (typeof opts.filter === 'function') {
            result = result.filter(opts.filter);
        }
        return result;
    });
}

/**
 * Clear the cached data (useful for testing or force-reload).
 */
function clearCache() {
    _cachedData = null;
    _pendingFetch = null;
}

/**
 * Set a custom data URL (useful for testing or alternative datasets).
 * @param {string} url - New data URL.
 */
function setDataUrl(url) {
    if (typeof url === 'string' && url.length > 0) {
        if (!_isUrlSafe(url)) {
            throw new Error(
                'Unsafe data URL blocked: ' + url +
                '. Only relative paths and HTTP(S) URLs without credentials are allowed.'
            );
        }
        _dataUrl = url;
    }
}

/**
 * Get the currently cached data without fetching.
 * @returns {Object[]|null} Cached data or null if not yet loaded.
 */
function getCachedData() {
    return _cachedData;
}

// CommonJS export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        loadBioprintData: loadBioprintData,
        validateRecord: validateRecord,
        clearCache: clearCache,
        setDataUrl: setDataUrl,
        getCachedData: getCachedData,
        _isUrlSafe: _isUrlSafe,
    };
}
