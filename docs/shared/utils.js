/**
 * BioBots Shared Utilities
 *
 * Common functions used across dashboard pages. Import after constants.js.
 * All functions use sample standard deviation (n-1) per statistical convention:
 * recorded bioprints are a sample from a larger potential population.
 *
 * NOTE: escapeHtml is provided by constants.js (loaded first via <script>).
 * Prototype-pollution stripping for Node modules lives in sanitize.js.
 * This file focuses on metric extraction, statistics, and formatting.
 */

/**
 * Metric accessor lookup — built from METRIC_DESCRIPTORS (constants.js)
 * so accessor definitions live in exactly one place. Falls back to a
 * static map if constants.js hasn't been loaded (shouldn't happen in
 * normal use, but guards against reorder).
 * @private
 */
const _metricAccessors = (typeof METRIC_DESCRIPTORS !== 'undefined')
    ? METRIC_DESCRIPTORS.reduce(function (acc, d) { acc[d.key] = d.get; return acc; }, {})
    : {
        livePercent:  p => p.print_data.livePercent,
        deadPercent:  p => p.print_data.deadPercent,
        elasticity:   p => p.print_data.elasticity,
        cl_duration:  p => p.print_info.crosslinking.cl_duration,
        cl_intensity: p => p.print_info.crosslinking.cl_intensity,
        extruder1:    p => p.print_info.pressure.extruder1,
        extruder2:    p => p.print_info.pressure.extruder2,
        layerHeight:  p => p.print_info.resolution.layerHeight,
        layerNum:     p => p.print_info.resolution.layerNum,
    };

/**
 * Extract a metric value from a print record by metric key.
 * Handles nested property paths (print_data.*, print_info.*).
 * @param {object} print - A print record from bioprint-data.json.
 * @param {string} metric - Metric key (e.g., 'livePercent', 'cl_duration').
 * @returns {number|null} The metric value, or null if unavailable.
 */
function getMetricValue(print, metric) {
    const fn = _metricAccessors[metric];
    if (!fn) return null;
    try { return fn(print); }
    catch { return null; }
}

/**
 * Format a number for display with smart precision.
 * @param {number|null} n - Number to format.
 * @returns {string} Formatted string, or '-' if null/undefined.
 */
function formatNum(n) {
    if (n == null) return '-';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(2);
}

/**
 * Compute a percentile value from a pre-sorted array using linear
 * interpolation.  Matches the backend (PrintsController.Percentile)
 * so the dashboard and API return identical quartile / median values.
 *
 * @param {number[]} sorted - Ascending-sorted numeric array.
 * @param {number} p - Percentile in [0, 1].
 * @returns {number}
 */
function percentile(sorted, p) {
    const n = sorted.length;
    if (n === 0) return 0;
    if (n === 1) return sorted[0];
    const rank = p * (n - 1);
    const lower = Math.floor(rank);
    const upper = lower + 1;
    if (upper >= n) return sorted[n - 1];
    const frac = rank - lower;
    return sorted[lower] + frac * (sorted[upper] - sorted[lower]);
}

/**
 * Compute descriptive statistics for an array of numeric values.
 * Uses sample standard deviation (n-1) since bioprint data is a sample.
 *
 * Performance: mean and variance are computed in a single pass using
 * Welford's online algorithm, avoiding a second full iteration.
 * Sorting (for quartiles/median) is done in-place on the input array
 * to avoid allocating a copy — callers should pass a disposable array
 * or pre-copy if they need the original order.
 *
 * @param {number[]} values - Array of numbers (will be sorted in-place).
 * @returns {{ mean: number, std: number, q1: number, q3: number, iqr: number, median: number }}
 */
function computeStats(values) {
    const n = values.length;
    if (n === 0) return { mean: 0, std: 0, q1: 0, q3: 0, iqr: 0, median: 0 };

    // Single-pass mean + variance (Welford's algorithm)
    let mean = 0;
    let m2 = 0;
    for (let i = 0; i < n; i++) {
        const delta = values[i] - mean;
        mean += delta / (i + 1);
        m2 += delta * (values[i] - mean);
    }
    const std = n > 1 ? Math.sqrt(m2 / (n - 1)) : 0;

    // Sort in-place (avoids cloning an array that may have 300K+ elements)
    values.sort((a, b) => a - b);

    const q1 = percentile(values, 0.25);
    const q3 = percentile(values, 0.75);
    const median = percentile(values, 0.50);
    return { mean, std, q1, q3, iqr: q3 - q1, median };
}

// ── Validation Helpers ──────────────────────────────────────────

/**
 * Assert that a value is a finite number.
 * @param {*} value - Value to check.
 * @param {string} name - Parameter name for error messages.
 * @returns {number} The validated number.
 * @throws {Error} If value is not a finite number.
 */
function requireNumber(value, name) {
    if (typeof value !== 'number' || !isFinite(value)) {
        throw new Error(name + ' must be a finite number, got: ' + value);
    }
    return value;
}

/**
 * Assert that a value is a finite number within a range.
 * @param {*} value - Value to check.
 * @param {string} name - Parameter name for error messages.
 * @param {number} [min] - Minimum allowed value (inclusive).
 * @param {number} [max] - Maximum allowed value (inclusive).
 * @returns {number} The validated number.
 * @throws {Error} If value is out of range or not a number.
 */
function requireNumberInRange(value, name, min, max) {
    requireNumber(value, name);
    if (min !== undefined && value < min) {
        throw new Error(name + ' must be >= ' + min + ', got: ' + value);
    }
    if (max !== undefined && value > max) {
        throw new Error(name + ' must be <= ' + max + ', got: ' + value);
    }
    return value;
}

/**
 * Assert that a value is a positive number (> 0).
 * @param {*} value - Value to check.
 * @param {string} name - Parameter name for error messages.
 * @returns {number} The validated number.
 * @throws {Error} If value is not positive.
 */
function requirePositive(value, name) {
    requireNumber(value, name);
    if (value <= 0) {
        throw new Error(name + ' must be positive, got: ' + value);
    }
    return value;
}

/**
 * Assert that a value is a non-negative number (>= 0).
 * @param {*} value - Value to check.
 * @param {string} name - Parameter name for error messages.
 * @returns {number} The validated number.
 * @throws {Error} If value is negative.
 */
function requireNonNegative(value, name) {
    requireNumber(value, name);
    if (value < 0) {
        throw new Error(name + ' must be non-negative, got: ' + value);
    }
    return value;
}


// -- Module Exports (Node.js / CommonJS) --
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        escapeHtml: escapeHtml,
        getMetricValue: getMetricValue,
        stripDangerousKeys: stripDangerousKeys,
        formatNum: formatNum,
        percentile: percentile,
        computeStats: computeStats,
        requireNumber: requireNumber,
        requireNumberInRange: requireNumberInRange,
        requirePositive: requirePositive,
        requireNonNegative: requireNonNegative
    };
}
