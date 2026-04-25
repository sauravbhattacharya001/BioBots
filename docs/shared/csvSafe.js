'use strict';

/**
 * CSV-safe value escaping with formula-injection defense (CWE-1236).
 *
 * Shared utility extracted from 6+ inlined copies across the codebase
 * (sessionLogger, labAuditTrail, experimentTracker, environmentalMonitor,
 * mycoplasmaTest, sampleLabel). This canonical version merges the most
 * complete guards from all copies:
 *   - OWASP dangerous-leader set (=, +, -, @, \t, \r, |)
 *   - Preserves legitimate numeric values starting with +/-
 *   - RFC-4180 quoting for commas, double-quotes, newlines, leading/trailing whitespace
 *
 * @param {*} value — any value to be embedded in a CSV cell
 * @returns {string} escaped CSV cell
 */
function csvSafe(value) {
  if (value == null) return '';
  var str = String(value);
  var first = str.charAt(0);
  if (first === '=' || first === '+' || first === '-' ||
      first === '@' || first === '\t' || first === '\r' ||
      first === '|') {
    // Preserve legitimate negative/positive numbers (e.g. -3.14, +1.5)
    if (!((first === '-' || first === '+') && str.length > 1 && isFinite(Number(str)))) {
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

module.exports = { csvSafe: csvSafe };
