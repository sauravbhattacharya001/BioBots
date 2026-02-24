/**
 * BioBots Shared Utilities
 *
 * Common functions used across dashboard pages. Import after constants.js.
 * All functions use sample standard deviation (n-1) per statistical convention:
 * recorded bioprints are a sample from a larger potential population.
 */

/** Shared DOM element for HTML entity escaping. */
const _escapeEl = document.createElement('div');

/**
 * Escape a string for safe HTML insertion (prevents XSS).
 * @param {*} str - Value to escape.
 * @returns {string} HTML-safe string.
 */
function escapeHtml(str) {
    if (str == null) return '';
    _escapeEl.textContent = String(str);
    return _escapeEl.innerHTML;
}

/**
 * Extract a metric value from a print record by metric key.
 * Handles nested property paths (print_data.*, print_info.*).
 * @param {object} print - A print record from bioprint-data.json.
 * @param {string} metric - Metric key (e.g., 'livePercent', 'cl_duration').
 * @returns {number|null} The metric value, or null if unavailable.
 */
function getMetricValue(print, metric) {
    const paths = {
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
    try { return paths[metric] ? paths[metric](print) : null; }
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
 * Compute descriptive statistics for an array of numeric values.
 * Uses sample standard deviation (n-1) since bioprint data is a sample.
 * @param {number[]} values - Array of numbers.
 * @returns {{ mean: number, std: number, q1: number, q3: number, iqr: number, median: number }}
 */
function computeStats(values) {
    const n = values.length;
    if (n === 0) return { mean: 0, std: 0, q1: 0, q3: 0, iqr: 0, median: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const std = n > 1
        ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
        : 0;
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const median = n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[Math.floor(n / 2)];
    return { mean, std, q1, q3, iqr: q3 - q1, median };
}
