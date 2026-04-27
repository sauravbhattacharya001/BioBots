'use strict';

/**
 * Sample Label Generator — creates formatted lab sample labels with
 * unique IDs, metadata, and optional barcode-ready strings.
 *
 * Generates standardized labels for tubes, plates, slides, and containers
 * used in bioprinting workflows. Supports batch generation, custom prefixes,
 * and multiple output formats (text, CSV, JSON).
 *
 * @example
 *   var gen = createSampleLabelGenerator();
 *   var labels = gen.generate({
 *     prefix: 'ALG',
 *     sampleType: 'tube',
 *     count: 10,
 *     project: 'Cartilage-v2',
 *     operator: 'JSmith'
 *   });
 *   console.log(labels[0].id);        // 'ALG-20260328-001'
 *   console.log(labels[0].barcode);   // '|ALG-20260328-001|'
 */

// ── Helpers ────────────────────────────────────────────────────────

function padZero(n, width) {
    var s = String(n);
    while (s.length < width) s = '0' + s;
    return s;
}

function dateStamp(date) {
    var d = date || new Date();
    return d.getFullYear().toString() +
        padZero(d.getMonth() + 1, 2) +
        padZero(d.getDate(), 2);
}

function generateCheckDigit(str) {
    var sum = 0;
    for (var i = 0; i < str.length; i++) {
        sum += str.charCodeAt(i) * (i + 1);
    }
    return sum % 10;
}

var SAMPLE_TYPES = {
    tube:      { abbrev: 'TB', description: 'Microcentrifuge tube' },
    plate:     { abbrev: 'PL', description: 'Well plate' },
    slide:     { abbrev: 'SL', description: 'Microscope slide' },
    flask:     { abbrev: 'FL', description: 'Culture flask' },
    cryovial:  { abbrev: 'CV', description: 'Cryogenic vial' },
    dish:      { abbrev: 'DS', description: 'Petri dish' },
    scaffold:  { abbrev: 'SC', description: 'Bioprinted scaffold' },
    cartridge: { abbrev: 'CG', description: 'Print cartridge' }
};

// ── Factory ────────────────────────────────────────────────────────

function createSampleLabelGenerator() {
    var _counter = 0;
    var _history = [];

    function generate(opts) {
        if (!opts) throw new Error('Options object is required');

        var count = opts.count || 1;
        if (count < 1 || count > 500) {
            throw new Error('Count must be between 1 and 500');
        }

        var prefix = (opts.prefix || 'SAM').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (prefix.length === 0 || prefix.length > 8) {
            throw new Error('Prefix must be 1-8 alphanumeric characters');
        }

        var sampleType = opts.sampleType || 'tube';
        if (!SAMPLE_TYPES[sampleType]) {
            throw new Error('Unknown sample type: ' + sampleType +
                '. Valid types: ' + Object.keys(SAMPLE_TYPES).join(', '));
        }

        var stamp = dateStamp(opts.date);
        var project = opts.project || '';
        var operator = opts.operator || '';
        var notes = opts.notes || '';
        var startNum = opts.startNumber || (_counter + 1);
        var digitWidth = count > 99 ? 4 : 3;

        var labels = [];
        for (var i = 0; i < count; i++) {
            var seqNum = startNum + i;
            var id = prefix + '-' + stamp + '-' + padZero(seqNum, digitWidth);
            var checkDigit = generateCheckDigit(id);
            var fullId = id + '-' + checkDigit;

            var label = {
                id: fullId,
                prefix: prefix,
                sequenceNumber: seqNum,
                date: stamp,
                sampleType: sampleType,
                sampleTypeDescription: SAMPLE_TYPES[sampleType].description,
                sampleTypeAbbrev: SAMPLE_TYPES[sampleType].abbrev,
                project: project,
                operator: operator,
                notes: notes,
                barcode: '|' + fullId + '|',
                createdAt: new Date().toISOString(),
                line1: fullId + '  ' + SAMPLE_TYPES[sampleType].abbrev,
                line2: project ? project : stamp,
                line3: operator ? 'Op: ' + operator : ''
            };
            labels.push(label);
            _history.push(label);
        }
        _counter = startNum + count - 1;
        return labels;
    }

    /**
     * Escape a value for safe CSV inclusion, defending against formula
     * injection (CWE-1236).  Characters that spreadsheet applications
     * interpret as formula leaders (= + - @ \t \r) are prefixed with a
     * single-quote to force text mode — unless the value is a valid
     * number (e.g. -3.14).
     */
    function csvSafe(value) {
        if (value == null) return '';
        var str = String(value);
        var first = str.charAt(0);
        if (first === '=' || first === '+' || first === '-' ||
            first === '@' || first === '\t' || first === '\r' ||
            first === '|') {
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

    function toCSV(labels) {
        if (!labels || labels.length === 0) return '';
        var headers = ['ID', 'Type', 'Project', 'Operator', 'Date', 'Notes', 'Barcode'];
        var rows = [headers.join(',')];
        for (var i = 0; i < labels.length; i++) {
            var l = labels[i];
            rows.push([
                csvSafe(l.id),
                csvSafe(l.sampleType),
                csvSafe(l.project),
                csvSafe(l.operator),
                csvSafe(l.date),
                csvSafe(l.notes),
                csvSafe(l.barcode)
            ].join(','));
        }
        return rows.join('\n');
    }

    function toText(labels) {
        if (!labels || labels.length === 0) return '';
        var lines = [];
        for (var i = 0; i < labels.length; i++) {
            var l = labels[i];
            lines.push('┌─────────────────────────────────┐');
            lines.push('│ ' + l.line1.substring(0, 32).padEnd(32) + '│');
            if (l.line2) {
                lines.push('│ ' + l.line2.substring(0, 32).padEnd(32) + '│');
            }
            if (l.line3) {
                lines.push('│ ' + l.line3.substring(0, 32).padEnd(32) + '│');
            }
            lines.push('│ ' + l.barcode.substring(0, 32).padEnd(32) + '│');
            lines.push('└─────────────────────────────────┘');
        }
        return lines.join('\n');
    }

    function getHistory() {
        return _history.slice();
    }

    function resetCounter(value) {
        _counter = value || 0;
    }

    function getSampleTypes() {
        var result = {};
        var keys = Object.keys(SAMPLE_TYPES);
        for (var i = 0; i < keys.length; i++) {
            result[keys[i]] = Object.assign({}, SAMPLE_TYPES[keys[i]]);
        }
        return result;
    }

    function parseId(id) {
        if (!id || typeof id !== 'string') return null;
        var parts = id.split('-');
        if (parts.length < 4) return null;
        return {
            prefix: parts[0],
            date: parts[1],
            sequenceNumber: parseInt(parts[2], 10),
            checkDigit: parseInt(parts[3], 10),
            valid: generateCheckDigit(parts[0] + '-' + parts[1] + '-' + parts[2]) === parseInt(parts[3], 10)
        };
    }

    return {
        generate: generate,
        toCSV: toCSV,
        toText: toText,
        getHistory: getHistory,
        resetCounter: resetCounter,
        getSampleTypes: getSampleTypes,
        parseId: parseId
    };
}

module.exports = { createSampleLabelGenerator: createSampleLabelGenerator };
