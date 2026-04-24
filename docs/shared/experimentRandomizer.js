'use strict';

var _sanitize = require('./sanitize');
var _isDangerousKey = _sanitize.isDangerousKey;

/**
 * Experiment Randomizer — randomized experimental design for bioprinting studies.
 *
 * Provides tools for unbiased experiment planning:
 *   - Complete randomization of treatment assignments
 *   - Randomized Complete Block Design (RCBD)
 *   - Latin Square Design
 *   - Balanced treatment allocation with configurable replicates
 *   - Blinding code generation for double-blind studies
 *   - Randomization audit trail with seed tracking
 *   - CSV/JSON export of randomization schedules
 *
 * @example
 *   var er = require('./experimentRandomizer');
 *   var rand = er.createExperimentRandomizer();
 *   var design = rand.completeRandomization({
 *     treatments: ['BioinkA', 'BioinkB', 'Control'],
 *     replicatesPerTreatment: 4,
 *     seed: 42
 *   });
 *   console.log(rand.renderSchedule(design));
 *   console.log(rand.toCSV(design));
 */

// ── Seeded PRNG (Mulberry32) ───────────────────────────────────────
function mulberry32(seed) {
    var state = seed | 0;
    return function () {
        state = (state + 0x6D2B79F5) | 0;
        var t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── Fisher-Yates shuffle ───────────────────────────────────────────
function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }
    return a;
}

// ── Blinding code generation ───────────────────────────────────────
function generateBlindingCodes(treatments, rng) {
    var codes = Object.create(null);
    var used = Object.create(null);
    for (var i = 0; i < treatments.length; i++) {
        // Reject prototype-pollution keys in treatment names (CWE-1321).
        // Treatment names are used as object property keys in the codes dict.
        if (_isDangerousKey(treatments[i])) continue;
        var code;
        do {
            code = String.fromCharCode(65 + Math.floor(rng() * 26)) +
                   String(100 + Math.floor(rng() * 900));
        } while (used[code]);
        used[code] = true;
        codes[treatments[i]] = code;
    }
    return codes;
}

// ── Timestamp helper ───────────────────────────────────────────────
function isoNow() {
    return new Date().toISOString();
}

/**
 * Create a new ExperimentRandomizer instance.
 * @returns {ExperimentRandomizer}
 */
function createExperimentRandomizer() {

    /**
     * Complete Randomization — each experimental unit randomly assigned a treatment.
     * @param {Object} opts
     * @param {string[]} opts.treatments - Treatment/group names.
     * @param {number} opts.replicatesPerTreatment - Number of replicates per treatment.
     * @param {number} [opts.seed] - PRNG seed for reproducibility.
     * @param {boolean} [opts.blinded=false] - Generate blinding codes.
     * @returns {Object} Randomization design object.
     */
    function completeRandomization(opts) {
        if (!opts || !opts.treatments || !opts.treatments.length) {
            throw new Error('treatments array is required');
        }
        var reps = opts.replicatesPerTreatment || 1;
        var seed = opts.seed != null ? opts.seed : Date.now();
        var rng = mulberry32(seed);

        // Build pool
        var pool = [];
        for (var i = 0; i < opts.treatments.length; i++) {
            for (var r = 0; r < reps; r++) {
                pool.push(opts.treatments[i]);
            }
        }
        var randomized = shuffle(pool, rng);

        var assignments = [];
        for (var k = 0; k < randomized.length; k++) {
            assignments.push({
                unit: k + 1,
                treatment: randomized[k]
            });
        }

        var design = {
            type: 'CompleteRandomization',
            seed: seed,
            treatments: opts.treatments.slice(),
            replicatesPerTreatment: reps,
            totalUnits: randomized.length,
            assignments: assignments,
            timestamp: isoNow()
        };

        if (opts.blinded) {
            design.blindingCodes = generateBlindingCodes(opts.treatments, rng);
        }

        return design;
    }

    /**
     * Randomized Complete Block Design (RCBD).
     * Each block contains one replicate of every treatment, randomly ordered.
     * @param {Object} opts
     * @param {string[]} opts.treatments
     * @param {number} opts.blocks - Number of blocks.
     * @param {string[]} [opts.blockNames] - Custom block labels.
     * @param {number} [opts.seed]
     * @param {boolean} [opts.blinded=false]
     * @returns {Object}
     */
    function rcbd(opts) {
        if (!opts || !opts.treatments || !opts.treatments.length) {
            throw new Error('treatments array is required');
        }
        var numBlocks = opts.blocks || 1;
        var seed = opts.seed != null ? opts.seed : Date.now();
        var rng = mulberry32(seed);

        var blocks = [];
        var unitNum = 0;
        for (var b = 0; b < numBlocks; b++) {
            var blockName = (opts.blockNames && opts.blockNames[b]) || ('Block' + (b + 1));
            var order = shuffle(opts.treatments, rng);
            var blockAssignments = [];
            for (var t = 0; t < order.length; t++) {
                unitNum++;
                blockAssignments.push({
                    unit: unitNum,
                    block: blockName,
                    position: t + 1,
                    treatment: order[t]
                });
            }
            blocks.push({ name: blockName, assignments: blockAssignments });
        }

        var design = {
            type: 'RCBD',
            seed: seed,
            treatments: opts.treatments.slice(),
            blocks: numBlocks,
            totalUnits: unitNum,
            blockDetails: blocks,
            timestamp: isoNow()
        };

        if (opts.blinded) {
            design.blindingCodes = generateBlindingCodes(opts.treatments, rng);
        }

        return design;
    }

    /**
     * Latin Square Design — each treatment appears exactly once per row and column.
     * @param {Object} opts
     * @param {string[]} opts.treatments - Must have N treatments for an NxN square.
     * @param {number} [opts.seed]
     * @param {boolean} [opts.blinded=false]
     * @returns {Object}
     */
    function latinSquare(opts) {
        if (!opts || !opts.treatments || !opts.treatments.length) {
            throw new Error('treatments array is required');
        }
        var n = opts.treatments.length;
        var seed = opts.seed != null ? opts.seed : Date.now();
        var rng = mulberry32(seed);

        // Build standard Latin square then shuffle rows and columns
        var grid = [];
        for (var i = 0; i < n; i++) {
            var row = [];
            for (var j = 0; j < n; j++) {
                row.push(opts.treatments[(i + j) % n]);
            }
            grid.push(row);
        }

        // Shuffle rows
        var rowOrder = shuffle(Array.from({ length: n }, function (_, k) { return k; }), rng);
        var shuffledGrid = rowOrder.map(function (ri) { return grid[ri]; });

        // Shuffle columns
        var colOrder = shuffle(Array.from({ length: n }, function (_, k) { return k; }), rng);
        var finalGrid = shuffledGrid.map(function (row) {
            return colOrder.map(function (ci) { return row[ci]; });
        });

        var assignments = [];
        var unit = 0;
        for (var r = 0; r < n; r++) {
            for (var c = 0; c < n; c++) {
                unit++;
                assignments.push({
                    unit: unit,
                    row: r + 1,
                    column: c + 1,
                    treatment: finalGrid[r][c]
                });
            }
        }

        var design = {
            type: 'LatinSquare',
            seed: seed,
            treatments: opts.treatments.slice(),
            size: n,
            totalUnits: n * n,
            grid: finalGrid,
            assignments: assignments,
            timestamp: isoNow()
        };

        if (opts.blinded) {
            design.blindingCodes = generateBlindingCodes(opts.treatments, rng);
        }

        return design;
    }

    /**
     * Render a human-readable schedule from any design.
     * @param {Object} design
     * @returns {string}
     */
    function renderSchedule(design) {
        var lines = [];
        lines.push('═══ ' + design.type + ' Randomization Schedule ═══');
        lines.push('Seed: ' + design.seed + '  |  Generated: ' + design.timestamp);
        lines.push('Treatments: ' + design.treatments.join(', '));
        lines.push('Total units: ' + design.totalUnits);
        lines.push('');

        if (design.blindingCodes) {
            lines.push('── Blinding Codes ──');
            var codes = design.blindingCodes;
            for (var t in codes) {
                if (codes.hasOwnProperty(t)) {
                    lines.push('  ' + t + ' → ' + codes[t]);
                }
            }
            lines.push('');
        }

        if (design.type === 'LatinSquare' && design.grid) {
            lines.push('── Latin Square Grid ──');
            var hdr = '     ';
            for (var c = 0; c < design.size; c++) {
                hdr += padRight('Col' + (c + 1), 12);
            }
            lines.push(hdr);
            for (var r = 0; r < design.size; r++) {
                var row = 'Row' + (r + 1) + ' ';
                for (var ci = 0; ci < design.size; ci++) {
                    var val = design.blindingCodes ? design.blindingCodes[design.grid[r][ci]] : design.grid[r][ci];
                    row += padRight(val, 12);
                }
                lines.push(row);
            }
            lines.push('');
        }

        if (design.type === 'RCBD' && design.blockDetails) {
            for (var b = 0; b < design.blockDetails.length; b++) {
                var blk = design.blockDetails[b];
                lines.push('── ' + blk.name + ' ──');
                lines.push(padRight('Unit', 8) + padRight('Pos', 6) + 'Treatment');
                lines.push(repeat('─', 30));
                for (var a = 0; a < blk.assignments.length; a++) {
                    var asn = blk.assignments[a];
                    var treatLabel = design.blindingCodes ? design.blindingCodes[asn.treatment] : asn.treatment;
                    lines.push(padRight(String(asn.unit), 8) + padRight(String(asn.position), 6) + treatLabel);
                }
                lines.push('');
            }
        }

        if (design.type === 'CompleteRandomization') {
            lines.push('── Assignment Order ──');
            lines.push(padRight('Unit', 8) + 'Treatment');
            lines.push(repeat('─', 25));
            for (var i = 0; i < design.assignments.length; i++) {
                var item = design.assignments[i];
                var label = design.blindingCodes ? design.blindingCodes[item.treatment] : item.treatment;
                lines.push(padRight(String(item.unit), 8) + label);
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Export design as CSV string.
     * @param {Object} design
     * @returns {string}
     */
    function toCSV(design) {
        var rows = [];

        if (design.type === 'LatinSquare') {
            rows.push('Unit,Row,Column,Treatment' + (design.blindingCodes ? ',Code' : ''));
            for (var i = 0; i < design.assignments.length; i++) {
                var a = design.assignments[i];
                var line = a.unit + ',' + a.row + ',' + a.column + ',' + a.treatment;
                if (design.blindingCodes) { line += ',' + design.blindingCodes[a.treatment]; }
                rows.push(line);
            }
        } else if (design.type === 'RCBD') {
            rows.push('Unit,Block,Position,Treatment' + (design.blindingCodes ? ',Code' : ''));
            for (var b = 0; b < design.blockDetails.length; b++) {
                for (var j = 0; j < design.blockDetails[b].assignments.length; j++) {
                    var ba = design.blockDetails[b].assignments[j];
                    var bline = ba.unit + ',' + ba.block + ',' + ba.position + ',' + ba.treatment;
                    if (design.blindingCodes) { bline += ',' + design.blindingCodes[ba.treatment]; }
                    rows.push(bline);
                }
            }
        } else {
            rows.push('Unit,Treatment' + (design.blindingCodes ? ',Code' : ''));
            for (var k = 0; k < design.assignments.length; k++) {
                var ca = design.assignments[k];
                var cline = ca.unit + ',' + ca.treatment;
                if (design.blindingCodes) { cline += ',' + design.blindingCodes[ca.treatment]; }
                rows.push(cline);
            }
        }

        return rows.join('\n');
    }

    /**
     * Export design as JSON string.
     * @param {Object} design
     * @returns {string}
     */
    function toJSON(design) {
        return JSON.stringify(design, null, 2);
    }

    // ── Helpers ────────────────────────────────────────────────────
    function padRight(str, len) {
        while (str.length < len) { str += ' '; }
        return str;
    }

    function repeat(ch, n) {
        var s = '';
        for (var i = 0; i < n; i++) { s += ch; }
        return s;
    }

    return {
        completeRandomization: completeRandomization,
        rcbd: rcbd,
        latinSquare: latinSquare,
        renderSchedule: renderSchedule,
        toCSV: toCSV,
        toJSON: toJSON
    };
}

module.exports = {
    createExperimentRandomizer: createExperimentRandomizer
};
