'use strict';

/**
 * Plate Map Generator — well plate layout planning for bioprinting experiments.
 *
 * Generates well plate maps (6, 12, 24, 48, 96, 384-well) with:
 *   - Sample/control/blank assignment
 *   - Randomization (Fisher-Yates) to reduce positional bias
 *   - Edge-effect avoidance (optional blank borders)
 *   - Replicate grouping
 *   - Visual ASCII plate rendering
 *   - CSV/JSON export
 *
 * @example
 *   var pm = require('./plateMap');
 *   var gen = pm.createPlateMapGenerator();
 *   var map = gen.generate({
 *     plateSize: 96,
 *     samples: [{ name: 'BioinkA', replicates: 3 }, { name: 'BioinkB', replicates: 3 }],
 *     controls: { positive: 3, negative: 3 },
 *     blanks: 6,
 *     randomize: true,
 *     edgeBlanks: true
 *   });
 *   console.log(gen.render(map));
 *   console.log(gen.toCSV(map));
 */

// Plate format definitions: { rows, cols }
var PLATE_FORMATS = {
    6:   { rows: 2, cols: 3 },
    12:  { rows: 3, cols: 4 },
    24:  { rows: 4, cols: 6 },
    48:  { rows: 6, cols: 8 },
    96:  { rows: 8, cols: 12 },
    384: { rows: 16, cols: 24 }
};

var ROW_LABELS = 'ABCDEFGHIJKLMNOP'.split('');

/**
 * Fisher-Yates shuffle (in-place).
 */
function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}

/**
 * Check if a well position is on the edge of the plate.
 */
function isEdge(r, c, rows, cols) {
    return r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
}

/**
 * Create a Plate Map Generator instance.
 */
function createPlateMapGenerator() {

    /**
     * Generate a plate map.
     * @param {Object} opts
     * @param {number} opts.plateSize - 6, 12, 24, 48, 96, or 384
     * @param {Array}  opts.samples - [{ name: string, replicates: number, color?: string }]
     * @param {Object} [opts.controls] - { positive: number, negative: number }
     * @param {number} [opts.blanks] - number of blank wells
     * @param {boolean} [opts.randomize] - shuffle sample placement (default: false)
     * @param {boolean} [opts.edgeBlanks] - force edge wells to blanks (default: false)
     * @returns {Object} plateMap
     */
    function generate(opts) {
        if (!opts || !opts.plateSize) {
            throw new Error('plateSize is required (6, 12, 24, 48, 96, or 384)');
        }
        var fmt = PLATE_FORMATS[opts.plateSize];
        if (!fmt) {
            throw new Error('Unsupported plate size: ' + opts.plateSize + '. Use 6, 12, 24, 48, 96, or 384.');
        }

        var rows = fmt.rows;
        var cols = fmt.cols;
        var totalWells = rows * cols;
        var samples = opts.samples || [];
        var controls = opts.controls || {};
        var numBlanks = opts.blanks || 0;
        var doRandomize = opts.randomize || false;
        var doEdgeBlanks = opts.edgeBlanks || false;

        // Build assignment list
        var assignments = [];

        // Samples with replicates
        for (var i = 0; i < samples.length; i++) {
            var s = samples[i];
            var reps = s.replicates || 1;
            for (var r = 0; r < reps; r++) {
                assignments.push({
                    type: 'sample',
                    name: s.name,
                    replicate: r + 1,
                    color: s.color || null
                });
            }
        }

        // Controls
        var posCtrl = controls.positive || 0;
        var negCtrl = controls.negative || 0;
        for (var p = 0; p < posCtrl; p++) {
            assignments.push({ type: 'positive_control', name: 'POS_CTRL', replicate: p + 1, color: null });
        }
        for (var n = 0; n < negCtrl; n++) {
            assignments.push({ type: 'negative_control', name: 'NEG_CTRL', replicate: n + 1, color: null });
        }

        // Blanks
        for (var b = 0; b < numBlanks; b++) {
            assignments.push({ type: 'blank', name: 'BLANK', replicate: b + 1, color: null });
        }

        // Initialize grid
        var grid = [];
        for (var ri = 0; ri < rows; ri++) {
            var row = [];
            for (var ci = 0; ci < cols; ci++) {
                row.push(null);
            }
            grid.push(row);
        }

        // Edge blanks first
        var edgeCount = 0;
        if (doEdgeBlanks) {
            for (var ri2 = 0; ri2 < rows; ri2++) {
                for (var ci2 = 0; ci2 < cols; ci2++) {
                    if (isEdge(ri2, ci2, rows, cols)) {
                        grid[ri2][ci2] = { type: 'blank', name: 'BLANK', replicate: 0, well: ROW_LABELS[ri2] + (ci2 + 1) };
                        edgeCount++;
                    }
                }
            }
        }

        // Collect available (non-edge) positions
        var available = [];
        for (var ri3 = 0; ri3 < rows; ri3++) {
            for (var ci3 = 0; ci3 < cols; ci3++) {
                if (!grid[ri3][ci3]) {
                    available.push({ r: ri3, c: ci3 });
                }
            }
        }

        if (assignments.length > available.length) {
            throw new Error('Too many assignments (' + assignments.length + ') for available wells (' + available.length + '). Plate has ' + totalWells + ' wells' + (doEdgeBlanks ? ' (' + edgeCount + ' reserved for edge blanks)' : '') + '.');
        }

        // Randomize if requested
        if (doRandomize) {
            shuffle(assignments);
            shuffle(available);
        }

        // Place assignments
        for (var a = 0; a < assignments.length; a++) {
            var pos = available[a];
            var entry = assignments[a];
            entry.well = ROW_LABELS[pos.r] + (pos.c + 1);
            grid[pos.r][pos.c] = entry;
        }

        // Fill remaining as empty
        for (var e = assignments.length; e < available.length; e++) {
            var ep = available[e];
            grid[ep.r][ep.c] = { type: 'empty', name: '', replicate: 0, well: ROW_LABELS[ep.r] + (ep.c + 1) };
        }

        // Build stats
        var stats = { total: totalWells, samples: 0, positive_control: 0, negative_control: 0, blank: 0, empty: 0 };
        for (var ri4 = 0; ri4 < rows; ri4++) {
            for (var ci4 = 0; ci4 < cols; ci4++) {
                var cell = grid[ri4][ci4];
                if (cell) {
                    if (cell.type === 'sample') stats.samples++;
                    else if (cell.type === 'positive_control') stats.positive_control++;
                    else if (cell.type === 'negative_control') stats.negative_control++;
                    else if (cell.type === 'blank') stats.blank++;
                    else if (cell.type === 'empty') stats.empty++;
                }
            }
        }

        return {
            plateSize: opts.plateSize,
            rows: rows,
            cols: cols,
            grid: grid,
            stats: stats,
            edgeBlanks: doEdgeBlanks,
            randomized: doRandomize,
            createdAt: new Date().toISOString()
        };
    }

    /**
     * Render plate map as ASCII table.
     */
    function render(map) {
        var lines = [];
        var colWidth = 10;
        // Header row
        var hdr = '     ';
        for (var c = 0; c < map.cols; c++) {
            var lbl = '' + (c + 1);
            hdr += pad(lbl, colWidth);
        }
        lines.push(hdr);
        lines.push('     ' + repeat('-', map.cols * colWidth));

        for (var r = 0; r < map.rows; r++) {
            var line = ' ' + ROW_LABELS[r] + '  |';
            for (var c2 = 0; c2 < map.cols; c2++) {
                var cell = map.grid[r][c2];
                var label = '';
                if (!cell || cell.type === 'empty') {
                    label = '·';
                } else if (cell.type === 'blank') {
                    label = 'BLK';
                } else if (cell.type === 'positive_control') {
                    label = 'POS';
                } else if (cell.type === 'negative_control') {
                    label = 'NEG';
                } else {
                    label = truncate(cell.name, colWidth - 2);
                }
                line += pad(label, colWidth);
            }
            lines.push(line);
        }

        lines.push('');
        lines.push('Stats: ' + map.stats.samples + ' samples, ' +
            map.stats.positive_control + ' pos ctrl, ' +
            map.stats.negative_control + ' neg ctrl, ' +
            map.stats.blank + ' blanks, ' +
            map.stats.empty + ' empty');
        lines.push('Randomized: ' + (map.randomized ? 'Yes' : 'No') +
            ' | Edge blanks: ' + (map.edgeBlanks ? 'Yes' : 'No'));

        return lines.join('\n');
    }

    /**
     * Export plate map as CSV string.
     */
    function toCSV(map) {
        var lines = ['Well,Row,Column,Type,Name,Replicate'];
        for (var r = 0; r < map.rows; r++) {
            for (var c = 0; c < map.cols; c++) {
                var cell = map.grid[r][c];
                if (cell) {
                    lines.push(cell.well + ',' + ROW_LABELS[r] + ',' + (c + 1) + ',' +
                        cell.type + ',' + csvEscape(cell.name) + ',' + (cell.replicate || 0));
                }
            }
        }
        return lines.join('\n');
    }

    /**
     * Export plate map as JSON.
     */
    function toJSON(map) {
        var wells = [];
        for (var r = 0; r < map.rows; r++) {
            for (var c = 0; c < map.cols; c++) {
                var cell = map.grid[r][c];
                if (cell) {
                    wells.push({
                        well: cell.well,
                        row: ROW_LABELS[r],
                        column: c + 1,
                        type: cell.type,
                        name: cell.name,
                        replicate: cell.replicate || 0
                    });
                }
            }
        }
        return JSON.stringify({
            plateSize: map.plateSize,
            rows: map.rows,
            cols: map.cols,
            stats: map.stats,
            randomized: map.randomized,
            edgeBlanks: map.edgeBlanks,
            createdAt: map.createdAt,
            wells: wells
        }, null, 2);
    }

    /**
     * Get supported plate sizes.
     */
    function getSupportedSizes() {
        return Object.keys(PLATE_FORMATS).map(Number);
    }

    /**
     * Create a standard experiment template.
     * @param {string} type - 'dose_response', 'viability', 'bioink_comparison'
     * @param {number} plateSize
     */
    function template(type, plateSize) {
        var templates = {
            dose_response: {
                samples: [
                    { name: 'Dose_0.1uM', replicates: 3 },
                    { name: 'Dose_1uM', replicates: 3 },
                    { name: 'Dose_10uM', replicates: 3 },
                    { name: 'Dose_100uM', replicates: 3 },
                    { name: 'Dose_1000uM', replicates: 3 }
                ],
                controls: { positive: 3, negative: 3 },
                blanks: 3,
                randomize: true,
                edgeBlanks: false
            },
            viability: {
                samples: [
                    { name: 'Day1', replicates: 4 },
                    { name: 'Day3', replicates: 4 },
                    { name: 'Day7', replicates: 4 },
                    { name: 'Day14', replicates: 4 }
                ],
                controls: { positive: 4, negative: 4 },
                blanks: 4,
                randomize: true,
                edgeBlanks: true
            },
            bioink_comparison: {
                samples: [
                    { name: 'Alginate', replicates: 4 },
                    { name: 'GelMA', replicates: 4 },
                    { name: 'Collagen', replicates: 4 },
                    { name: 'Fibrin', replicates: 4 },
                    { name: 'PEGDA', replicates: 4 }
                ],
                controls: { positive: 3, negative: 3 },
                blanks: 6,
                randomize: true,
                edgeBlanks: true
            }
        };

        var t = templates[type];
        if (!t) {
            throw new Error('Unknown template: ' + type + '. Use: ' + Object.keys(templates).join(', '));
        }

        t.plateSize = plateSize || 96;
        return generate(t);
    }

    return {
        generate: generate,
        render: render,
        toCSV: toCSV,
        toJSON: toJSON,
        getSupportedSizes: getSupportedSizes,
        template: template
    };
}

// Helpers
function pad(str, width) {
    while (str.length < width) str += ' ';
    return str;
}

function repeat(ch, n) {
    var s = '';
    for (var i = 0; i < n; i++) s += ch;
    return s;
}

function truncate(str, max) {
    if (str.length <= max) return str;
    return str.substring(0, max - 1) + '…';
}

function csvEscape(str) {
    if (!str) return '';
    if (str.indexOf(',') >= 0 || str.indexOf('"') >= 0) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

module.exports = { createPlateMapGenerator: createPlateMapGenerator };
