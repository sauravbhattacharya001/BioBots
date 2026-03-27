'use strict';

/**
 * BioBots Data Export Manager
 *
 * Provides CSV and JSON export functionality for bioprint data.
 * Supports tabular data, nested objects, custom column mapping,
 * Excel-compatible CSV (UTF-8 BOM), and browser download triggering.
 *
 * Usage:
 *   const exporter = createDataExporter();
 *   exporter.downloadCSV(data, columns, 'bioprints.csv');
 *   exporter.downloadJSON(data, 'bioprints.json');
 */

var _sanitize = require('./sanitize');

/**
 * Create a data exporter instance.
 * @returns {object} Exporter with toCSV, toJSON, downloadCSV, downloadJSON, formatFilename methods.
 */
function createDataExporter() {
    var MAX_ROWS = 100000;
    var MAX_FILENAME_LENGTH = 200;
    var CSV_BOM = '\uFEFF'; // UTF-8 BOM for Excel compatibility

    /**
     * Escape a value for CSV. Wraps in quotes if it contains comma, quote, or newline.
     * @param {*} value - The value to escape.
     * @returns {string} CSV-safe string.
     */
    function escapeCSVValue(value) {
        if (value == null) return '';
        var str = String(value);

        // CSV formula injection defense: if the string starts with a
        // character that spreadsheet applications (Excel, Google Sheets,
        // LibreOffice Calc) interpret as a formula or special command,
        // prefix with a single-quote to force text mode.  The dangerous
        // leader set is: = + - @ \t \r  (OWASP recommendation).
        //
        // However, we must not corrupt legitimate numeric values like
        // negative numbers (-3.14) or positive numbers with leading +
        // (+1.5). Only apply the prefix to non-numeric strings.
        var firstChar = str.charAt(0);
        if (firstChar === '=' || firstChar === '+' || firstChar === '-' ||
            firstChar === '@' || firstChar === '\t' || firstChar === '\r') {
            // Skip prefix for values that are valid numbers (e.g. -3.14, +1.5)
            if (!((firstChar === '-' || firstChar === '+') && str.length > 1 && isFinite(Number(str)))) {
                str = "'" + str;
            }
        }

        // Must quote if contains comma, double-quote, newline, or leading/trailing whitespace
        if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || 
            str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1 ||
            str !== str.trim()) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    /**
     * Resolve a nested property path (e.g., 'print_data.livePercent').
     * Delegates to the shared sanitize module to prevent prototype pollution.
     * @param {object} obj - Source object.
     * @param {string} path - Dot-separated path.
     * @returns {*} Resolved value or null.
     */
    var resolvePath = _sanitize.safeResolvePath;

    /**
     * Convert an array of objects to CSV string.
     * @param {object[]} data - Array of data objects.
     * @param {Array<{key: string, label?: string, format?: function}>} columns - Column definitions.
     *   - key: property path (supports dot notation)
     *   - label: header label (defaults to key)
     *   - format: optional formatter function(value) → string
     * @param {object} [options] - Options.
     * @param {boolean} [options.includeBOM=true] - Include UTF-8 BOM for Excel.
     * @param {string} [options.lineEnding='\r\n'] - Line ending (CRLF for Windows/Excel compat).
     * @returns {string} CSV string.
     * @throws {Error} If data exceeds MAX_ROWS or columns is empty.
     */
    function toCSV(data, columns, options) {
        if (!Array.isArray(data)) throw new Error('Data must be an array');
        if (!Array.isArray(columns) || columns.length === 0) throw new Error('Columns must be a non-empty array');
        if (data.length > MAX_ROWS) throw new Error('Data exceeds maximum of ' + MAX_ROWS + ' rows');

        var opts = options || {};
        var includeBOM = opts.includeBOM !== false;
        var lineEnding = opts.lineEnding || '\r\n';

        // Header row
        var headers = columns.map(function(col) {
            return escapeCSVValue(col.label || col.key);
        });

        var lines = [headers.join(',')];

        // Data rows
        for (var i = 0; i < data.length; i++) {
            var row = columns.map(function(col) {
                var value = resolvePath(data[i], col.key);
                if (col.format && value != null) {
                    value = col.format(value);
                }
                return escapeCSVValue(value);
            });
            lines.push(row.join(','));
        }

        var csv = lines.join(lineEnding);
        return includeBOM ? CSV_BOM + csv : csv;
    }

    /**
     * Convert data to formatted JSON string.
     * @param {*} data - Data to serialize.
     * @param {object} [options] - Options.
     * @param {boolean} [options.pretty=true] - Pretty-print with 2-space indent.
     * @param {Array<string>} [options.fields] - If provided, only include these top-level fields.
     * @returns {string} JSON string.
     */
    function toJSON(data, options) {
        var opts = options || {};
        var pretty = opts.pretty !== false;
        var indent = pretty ? 2 : 0;

        var exportData = data;
        if (opts.fields && Array.isArray(data)) {
            exportData = data.map(function(item) {
                var filtered = {};
                opts.fields.forEach(function(field) {
                    var val = resolvePath(item, field);
                    if (val !== null) {
                        // Preserve nested structure — skip dangerous keys
                        var parts = field.split('.');
                        var hasDangerous = false;
                        for (var j = 0; j < parts.length; j++) {
                            if (DANGEROUS_KEYS[parts[j]]) { hasDangerous = true; break; }
                        }
                        if (hasDangerous) return;
                        var target = filtered;
                        for (var i = 0; i < parts.length - 1; i++) {
                            if (!target[parts[i]]) target[parts[i]] = {};
                            target = target[parts[i]];
                        }
                        target[parts[parts.length - 1]] = val;
                    }
                });
                return filtered;
            });
        }

        return JSON.stringify(exportData, null, indent);
    }

    /**
     * Generate a safe filename with timestamp.
     * @param {string} base - Base filename (without extension).
     * @param {string} extension - File extension (e.g., 'csv', 'json').
     * @returns {string} Formatted filename like 'bioprints_2026-02-24T12-30-00.csv'.
     */
    function formatFilename(base, extension) {
        if (!base || typeof base !== 'string') base = 'export';
        if (!extension || typeof extension !== 'string') extension = 'csv';
        
        // Sanitize: only allow alphanumeric, dash, underscore, dot
        var safe = base.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
        if (safe.length === 0) safe = 'export';
        
        var timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        var filename = safe + '_' + timestamp + '.' + extension;
        
        if (filename.length > MAX_FILENAME_LENGTH) {
            filename = safe.substring(0, 50) + '_' + timestamp + '.' + extension;
        }
        
        return filename;
    }

    /**
     * Trigger a file download in the browser.
     * @param {string} content - File content.
     * @param {string} filename - Download filename.
     * @param {string} mimeType - MIME type (e.g., 'text/csv').
     */
    function triggerDownload(content, filename, mimeType) {
        var blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        // Clean up after brief delay
        setTimeout(function() {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    /**
     * Export data as CSV and trigger download.
     * @param {object[]} data - Data array.
     * @param {Array<{key: string, label?: string, format?: function}>} columns - Column defs.
     * @param {string} [filename] - Custom filename (auto-generated if omitted).
     * @param {object} [options] - CSV options (passed to toCSV).
     * @returns {string} The generated CSV string.
     */
    function downloadCSV(data, columns, filename, options) {
        var csv = toCSV(data, columns, options);
        var fname = filename || formatFilename('biobots_export', 'csv');
        triggerDownload(csv, fname, 'text/csv');
        return csv;
    }

    /**
     * Export data as JSON and trigger download.
     * @param {*} data - Data to export.
     * @param {string} [filename] - Custom filename (auto-generated if omitted).
     * @param {object} [options] - JSON options (passed to toJSON).
     * @returns {string} The generated JSON string.
     */
    function downloadJSON(data, filename, options) {
        var json = toJSON(data, options);
        var fname = filename || formatFilename('biobots_export', 'json');
        triggerDownload(json, fname, 'application/json');
        return json;
    }

    /**
     * Create column definitions from BioBots METRIC_DESCRIPTORS.
     * Useful for exporting metric data using the shared constants.
     * @param {Array<{key: string, label: string, unit: string}>} descriptors - Metric descriptors.
     * @returns {Array<{key: string, label: string}>} Column definitions for toCSV.
     */
    function columnsFromDescriptors(descriptors) {
        if (!Array.isArray(descriptors)) return [];
        return descriptors.map(function(d) {
            return {
                key: d.key,
                label: d.label + (d.unit ? ' (' + d.unit + ')' : '')
            };
        });
    }

    /**
     * Get summary statistics for export metadata.
     * @param {object[]} data - Data array.
     * @param {string} datasetName - Name of the dataset.
     * @returns {object} Summary with count, exportDate, datasetName.
     */
    function getExportSummary(data, datasetName) {
        return {
            datasetName: datasetName || 'BioBots Export',
            recordCount: Array.isArray(data) ? data.length : 0,
            exportDate: new Date().toISOString(),
            format: 'BioBots Data Export v1.0'
        };
    }

    return {
        toCSV: toCSV,
        toJSON: toJSON,
        downloadCSV: downloadCSV,
        downloadJSON: downloadJSON,
        formatFilename: formatFilename,
        triggerDownload: triggerDownload,
        escapeCSVValue: escapeCSVValue,
        resolvePath: resolvePath,
        columnsFromDescriptors: columnsFromDescriptors,
        getExportSummary: getExportSummary,
        MAX_ROWS: MAX_ROWS,
        MAX_FILENAME_LENGTH: MAX_FILENAME_LENGTH
    };
}

// CommonJS export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createDataExporter: createDataExporter };
}
