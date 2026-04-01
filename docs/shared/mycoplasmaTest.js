'use strict';

/**
 * Mycoplasma Test Logger
 *
 * Tracks mycoplasma contamination testing for cell lines.
 * Mycoplasma is the most common cell culture contaminant (~15-35% of
 * cell lines are infected). Regular testing is critical for data integrity.
 *
 * Features:
 * - Log test results (PCR, ELISA, Hoechst staining, MycoAlert, culture)
 * - Track testing schedules per cell line
 * - Flag overdue cell lines (configurable interval, default 30 days)
 * - Generate compliance reports
 * - Quarantine recommendations for positive results
 *
 * @example
 *   var logger = createMycoplasmaTestLogger();
 *   logger.logTest({ cellLine: 'HeLa', method: 'PCR', result: 'negative', date: '2026-03-29', operator: 'JD' });
 *   logger.logTest({ cellLine: 'HEK293', method: 'MycoAlert', result: 'positive', date: '2026-03-20', operator: 'AS' });
 *   var overdue = logger.getOverdue();
 *   var report = logger.complianceReport();
 */

var VALID_METHODS = ['PCR', 'ELISA', 'Hoechst', 'MycoAlert', 'culture', 'DAPI', 'Luminescence'];
var VALID_RESULTS = ['negative', 'positive', 'equivocal', 'invalid'];

var DEFAULT_TEST_INTERVAL_DAYS = 30;

function createMycoplasmaTestLogger(options) {
    options = options || {};
    var testIntervalDays = options.testIntervalDays || DEFAULT_TEST_INTERVAL_DAYS;
    var records = [];
    var quarantined = {};  // cellLine → { since, reason }

    function _validate(entry) {
        if (!entry || typeof entry !== 'object') {
            throw new Error('Test entry must be an object');
        }
        if (!entry.cellLine || typeof entry.cellLine !== 'string') {
            throw new Error('cellLine is required and must be a string');
        }
        if (!entry.method || VALID_METHODS.indexOf(entry.method) === -1) {
            throw new Error('method must be one of: ' + VALID_METHODS.join(', '));
        }
        if (!entry.result || VALID_RESULTS.indexOf(entry.result) === -1) {
            throw new Error('result must be one of: ' + VALID_RESULTS.join(', '));
        }
        if (!entry.date) {
            throw new Error('date is required (ISO 8601 string)');
        }
    }

    function _daysBetween(d1, d2) {
        var ms = Math.abs(new Date(d2) - new Date(d1));
        return Math.floor(ms / 86400000);
    }

    function logTest(entry) {
        _validate(entry);
        var record = {
            id: records.length + 1,
            cellLine: entry.cellLine.trim(),
            method: entry.method,
            result: entry.result,
            date: entry.date,
            operator: entry.operator || 'unknown',
            lot: entry.lot || null,
            notes: entry.notes || null,
            timestamp: new Date().toISOString()
        };
        records.push(record);

        if (record.result === 'positive') {
            quarantined[record.cellLine] = {
                since: record.date,
                reason: 'Positive mycoplasma test (' + record.method + ')',
                testId: record.id
            };
        }

        if (record.result === 'negative' && quarantined[record.cellLine]) {
            // Require 2 consecutive negatives to release from quarantine
            var lineRecords = _getLineRecords(record.cellLine);
            var lastTwo = lineRecords.slice(-2);
            if (lastTwo.length >= 2 && lastTwo[0].result === 'negative' && lastTwo[1].result === 'negative') {
                delete quarantined[record.cellLine];
                record._quarantineReleased = true;
            }
        }

        return record;
    }

    function _getLineRecords(cellLine) {
        return records.filter(function (r) { return r.cellLine === cellLine; });
    }

    function getHistory(cellLine) {
        if (cellLine) {
            return _getLineRecords(cellLine);
        }
        return records.slice();
    }

    function getLastTest(cellLine) {
        var lineRecords = _getLineRecords(cellLine);
        return lineRecords.length > 0 ? lineRecords[lineRecords.length - 1] : null;
    }

    function getCellLines() {
        var lines = {};
        records.forEach(function (r) {
            if (!lines[r.cellLine]) {
                lines[r.cellLine] = { tests: 0, lastTest: null, lastResult: null, quarantined: false };
            }
            lines[r.cellLine].tests++;
            lines[r.cellLine].lastTest = r.date;
            lines[r.cellLine].lastResult = r.result;
            lines[r.cellLine].quarantined = !!quarantined[r.cellLine];
        });
        return lines;
    }

    function getOverdue(referenceDate) {
        var ref = referenceDate ? new Date(referenceDate) : new Date();
        var lines = getCellLines();
        var overdue = [];
        Object.keys(lines).forEach(function (name) {
            var info = lines[name];
            if (info.lastTest) {
                var daysSince = _daysBetween(info.lastTest, ref);
                if (daysSince > testIntervalDays) {
                    overdue.push({
                        cellLine: name,
                        lastTest: info.lastTest,
                        daysSince: daysSince,
                        daysOverdue: daysSince - testIntervalDays,
                        lastResult: info.lastResult,
                        quarantined: info.quarantined
                    });
                }
            }
        });
        overdue.sort(function (a, b) { return b.daysOverdue - a.daysOverdue; });
        return overdue;
    }

    function getQuarantined() {
        var result = [];
        Object.keys(quarantined).forEach(function (name) {
            result.push({
                cellLine: name,
                since: quarantined[name].since,
                reason: quarantined[name].reason,
                testId: quarantined[name].testId
            });
        });
        return result;
    }

    function complianceReport(referenceDate) {
        var ref = referenceDate ? new Date(referenceDate) : new Date();
        var lines = getCellLines();
        var cellLineNames = Object.keys(lines);
        var totalLines = cellLineNames.length;
        var overdue = getOverdue(ref);
        var overdueNames = overdue.map(function (o) { return o.cellLine; });
        var compliant = cellLineNames.filter(function (n) { return overdueNames.indexOf(n) === -1; });
        var positiveCount = records.filter(function (r) { return r.result === 'positive'; }).length;
        var totalTests = records.length;
        var positivityRate = totalTests > 0 ? ((positiveCount / totalTests) * 100).toFixed(1) : '0.0';

        return {
            reportDate: ref.toISOString().split('T')[0],
            testIntervalDays: testIntervalDays,
            totalCellLines: totalLines,
            compliantCount: compliant.length,
            overdueCount: overdue.length,
            quarantinedCount: Object.keys(quarantined).length,
            complianceRate: totalLines > 0 ? ((compliant.length / totalLines) * 100).toFixed(1) + '%' : 'N/A',
            totalTests: totalTests,
            positiveTests: positiveCount,
            positivityRate: positivityRate + '%',
            overdueLines: overdue,
            quarantinedLines: getQuarantined(),
            summary: _generateSummary(compliant.length, overdue.length, totalLines, positivityRate)
        };
    }

    function _generateSummary(compliantCount, overdueCount, totalLines, positivityRate) {
        var parts = [];
        parts.push(compliantCount + '/' + totalLines + ' cell lines compliant with ' + testIntervalDays + '-day testing schedule.');
        if (overdueCount > 0) {
            parts.push('⚠️ ' + overdueCount + ' cell line(s) overdue for testing.');
        }
        if (Object.keys(quarantined).length > 0) {
            parts.push('🔴 ' + Object.keys(quarantined).length + ' cell line(s) in quarantine.');
        }
        if (parseFloat(positivityRate) > 10) {
            parts.push('⚠️ High positivity rate (' + positivityRate + '%) — review lab practices.');
        }
        return parts.join(' ');
    }

    /**
     * Escape a string for safe CSV output.
     * - Prefixes formula-injection characters (=, +, -, @, \t, \r) with
     *   a single-quote to force text mode (OWASP CSV injection defense).
     * - Wraps in double-quotes and escapes internal quotes when the value
     *   contains commas, quotes, or newlines.
     * @param {string} str - Raw field value.
     * @returns {string} Safely escaped CSV field.
     */
    function csvSafe(str) {
        if (str == null) return '';
        str = String(str);
        if (str.length === 0) return '';

        // CSV formula injection defense (OWASP)
        var firstChar = str.charAt(0);
        if (firstChar === '=' || firstChar === '+' || firstChar === '-' ||
            firstChar === '@' || firstChar === '\t' || firstChar === '\r') {
            str = "'" + str;
        }

        // Quote if contains comma, double-quote, or newline
        if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 ||
            str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1 ||
            str !== str.trim()) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    function exportRecords(format) {
        format = format || 'json';
        if (format === 'json') {
            return JSON.stringify(records, null, 2);
        }
        if (format === 'csv') {
            var header = 'id,cellLine,method,result,date,operator,lot,notes';
            var rows = records.map(function (r) {
                return [
                    csvSafe(r.id),
                    csvSafe(r.cellLine),
                    csvSafe(r.method),
                    csvSafe(r.result),
                    csvSafe(r.date),
                    csvSafe(r.operator),
                    csvSafe(r.lot),
                    csvSafe(r.notes)
                ].join(',');
            });
            return [header].concat(rows).join('\n');
        }
        throw new Error('Unsupported format: ' + format + '. Use "json" or "csv".');
    }

    return {
        logTest: logTest,
        getHistory: getHistory,
        getLastTest: getLastTest,
        getCellLines: getCellLines,
        getOverdue: getOverdue,
        getQuarantined: getQuarantined,
        complianceReport: complianceReport,
        exportRecords: exportRecords
    };
}

module.exports = { createMycoplasmaTestLogger: createMycoplasmaTestLogger };
