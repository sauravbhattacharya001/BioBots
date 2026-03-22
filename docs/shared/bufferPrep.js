/**
 * Buffer Preparation Calculator
 *
 * Calculates recipes for common laboratory buffers used in bioprinting
 * and cell culture workflows. Supports pH targeting with Henderson-Hasselbalch,
 * dilution from stock solutions, and multi-component buffer systems.
 *
 * @example
 *   var bufferPrep = require('./bufferPrep');
 *   var calc = bufferPrep.createBufferPrepCalculator();
 *   var recipe = calc.prepare({
 *     buffer: 'PBS',
 *     targetVolume: 1000,
 *     targetpH: 7.4,
 *     concentration: '1X'
 *   });
 */

'use strict';

/* ------------------------------------------------------------------ */
/*  Buffer Database                                                    */
/* ------------------------------------------------------------------ */

var BUFFERS = {
    PBS: {
        fullName: 'Phosphate Buffered Saline',
        pKa: [2.15, 7.20, 12.35],
        activePka: 7.20,
        components10X: [
            { name: 'NaCl', mw: 58.44, gPerLiter: 80.0 },
            { name: 'KCl', mw: 74.55, gPerLiter: 2.0 },
            { name: 'Na2HPO4', mw: 141.96, gPerLiter: 14.4 },
            { name: 'KH2PO4', mw: 136.09, gPerLiter: 2.4 }
        ],
        defaultpH: 7.4,
        phRange: [6.8, 8.0]
    },
    TRIS: {
        fullName: 'Tris(hydroxymethyl)aminomethane',
        pKa: [8.06],
        activePka: 8.06,
        components10X: [
            { name: 'Tris base', mw: 121.14, gPerLiter: 121.14 }
        ],
        acid: 'HCl',
        defaultpH: 7.5,
        phRange: [7.0, 9.0]
    },
    TBS: {
        fullName: 'Tris Buffered Saline',
        pKa: [8.06],
        activePka: 8.06,
        components10X: [
            { name: 'Tris base', mw: 121.14, gPerLiter: 24.2 },
            { name: 'NaCl', mw: 58.44, gPerLiter: 80.0 }
        ],
        acid: 'HCl',
        defaultpH: 7.6,
        phRange: [7.0, 9.0]
    },
    HEPES: {
        fullName: 'HEPES Buffer',
        pKa: [7.48],
        activePka: 7.48,
        components10X: [
            { name: 'HEPES', mw: 238.30, gPerLiter: 238.3 }
        ],
        defaultpH: 7.4,
        phRange: [6.8, 8.2]
    },
    MES: {
        fullName: 'MES Buffer',
        pKa: [6.15],
        activePka: 6.15,
        components10X: [
            { name: 'MES', mw: 195.24, gPerLiter: 195.24 }
        ],
        defaultpH: 6.0,
        phRange: [5.5, 6.7]
    },
    MOPS: {
        fullName: 'MOPS Buffer',
        pKa: [7.20],
        activePka: 7.20,
        components10X: [
            { name: 'MOPS', mw: 209.26, gPerLiter: 209.26 }
        ],
        defaultpH: 7.0,
        phRange: [6.5, 7.9]
    },
    TAE: {
        fullName: 'Tris-Acetate-EDTA',
        pKa: [8.06],
        activePka: 8.06,
        components50X: [
            { name: 'Tris base', mw: 121.14, gPerLiter: 242.0 },
            { name: 'Glacial acetic acid', mw: 60.05, mlPerLiter: 57.1 },
            { name: 'EDTA (0.5M, pH 8.0)', mw: 372.24, mlPerLiter: 100.0 }
        ],
        defaultpH: 8.0,
        phRange: [7.6, 8.6]
    },
    TBE: {
        fullName: 'Tris-Borate-EDTA',
        pKa: [8.06],
        activePka: 8.06,
        components10X: [
            { name: 'Tris base', mw: 121.14, gPerLiter: 108.0 },
            { name: 'Boric acid', mw: 61.83, gPerLiter: 55.0 },
            { name: 'EDTA (0.5M, pH 8.0)', mw: 372.24, mlPerLiter: 40.0 }
        ],
        defaultpH: 8.3,
        phRange: [8.0, 8.6]
    },
    CITRATE: {
        fullName: 'Sodium Citrate Buffer',
        pKa: [3.13, 4.76, 6.40],
        activePka: 4.76,
        components10X: [
            { name: 'Citric acid', mw: 192.12, gPerLiter: 21.01 },
            { name: 'Sodium citrate tribasic', mw: 294.10, gPerLiter: 29.41 }
        ],
        defaultpH: 6.0,
        phRange: [3.0, 6.5]
    }
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function roundTo(n, d) {
    var f = Math.pow(10, d);
    return Math.round(n * f) / f;
}

/**
 * Henderson-Hasselbalch ratio [A-]/[HA]
 */
function hhRatio(targetpH, pKa) {
    return Math.pow(10, targetpH - pKa);
}

function parseConcentration(conc) {
    if (typeof conc === 'number') return conc;
    var s = String(conc).trim().toUpperCase();
    var m = s.match(/^([\d.]+)\s*X$/);
    if (m) return parseFloat(m[1]);
    m = s.match(/^([\d.]+)\s*M$/i);
    if (m) return parseFloat(m[1]) * 1000; // treat as mM → scale later
    return parseFloat(s) || 1;
}

/* ------------------------------------------------------------------ */
/*  Core Calculator                                                    */
/* ------------------------------------------------------------------ */

function createBufferPrepCalculator() {
    return {
        /**
         * List all supported buffer systems.
         * @returns {Array<{key:string, fullName:string, defaultpH:number, phRange:number[]}>}
         */
        listBuffers: function () {
            return Object.keys(BUFFERS).map(function (k) {
                var b = BUFFERS[k];
                return {
                    key: k,
                    fullName: b.fullName,
                    defaultpH: b.defaultpH,
                    phRange: b.phRange
                };
            });
        },

        /**
         * Prepare a buffer recipe.
         *
         * @param {Object} opts
         * @param {string}  opts.buffer         - Buffer key (PBS, TRIS, etc.)
         * @param {number}  opts.targetVolume   - Final volume in mL
         * @param {number}  [opts.targetpH]     - Desired pH (default per buffer)
         * @param {string|number} [opts.concentration] - e.g. '1X', '10X' (default '1X')
         * @returns {Object} recipe
         */
        prepare: function (opts) {
            if (!opts || !opts.buffer) {
                throw new Error('opts.buffer is required');
            }
            var key = opts.buffer.toUpperCase();
            var buf = BUFFERS[key];
            if (!buf) {
                throw new Error('Unknown buffer: ' + opts.buffer + '. Supported: ' + Object.keys(BUFFERS).join(', '));
            }
            var targetVol = opts.targetVolume;
            if (!targetVol || targetVol <= 0) {
                throw new Error('opts.targetVolume must be > 0 (mL)');
            }
            var targetpH = opts.targetpH != null ? opts.targetpH : buf.defaultpH;
            if (targetpH < buf.phRange[0] || targetpH > buf.phRange[1]) {
                throw new Error(
                    key + ' effective pH range is ' + buf.phRange[0] + '-' + buf.phRange[1] +
                    '. Requested pH ' + targetpH + ' is outside this range.'
                );
            }
            var concFactor = parseConcentration(opts.concentration || '1X');

            // Determine stock concentration factor
            var stockFactor = buf.components50X ? 50 : 10;
            var stockComponents = buf.components50X || buf.components10X;

            var dilutionRatio = concFactor / stockFactor;

            var ingredients = [];
            var warnings = [];

            if (dilutionRatio <= 1) {
                // Diluting from a concentrated stock
                var stockVol = roundTo(targetVol * dilutionRatio, 2);
                ingredients.push({
                    name: stockFactor + 'X ' + key + ' stock solution',
                    amount: stockVol,
                    unit: 'mL',
                    note: 'Dilute ' + stockVol + ' mL of ' + stockFactor + 'X stock'
                });
                ingredients.push({
                    name: 'Distilled water',
                    amount: roundTo(targetVol - stockVol, 2),
                    unit: 'mL',
                    note: 'Bring to final volume'
                });
            } else {
                // Making from powder — scale components
                var scale = (concFactor / stockFactor) * (targetVol / 1000);
                stockComponents.forEach(function (comp) {
                    if (comp.gPerLiter) {
                        ingredients.push({
                            name: comp.name,
                            amount: roundTo(comp.gPerLiter * scale, 3),
                            unit: 'g',
                            mw: comp.mw
                        });
                    }
                    if (comp.mlPerLiter) {
                        ingredients.push({
                            name: comp.name,
                            amount: roundTo(comp.mlPerLiter * scale, 2),
                            unit: 'mL',
                            mw: comp.mw
                        });
                    }
                });
                ingredients.push({
                    name: 'Distilled water',
                    amount: targetVol,
                    unit: 'mL',
                    note: 'Dissolve components, then QS to final volume'
                });
            }

            // pH adjustment note
            var ratio = hhRatio(targetpH, buf.activePka);
            var phNote;
            if (targetpH > buf.activePka) {
                phNote = 'Add NaOH (or appropriate base) dropwise to reach pH ' + targetpH +
                         '. Henderson-Hasselbalch [A-]/[HA] ratio: ' + roundTo(ratio, 2);
            } else if (targetpH < buf.activePka) {
                phNote = 'Add HCl (or appropriate acid) dropwise to reach pH ' + targetpH +
                         '. Henderson-Hasselbalch [A-]/[HA] ratio: ' + roundTo(ratio, 2);
            } else {
                phNote = 'Buffer is at pKa; minimal adjustment expected.';
            }

            // Temperature warning for Tris-based buffers
            if (key === 'TRIS' || key === 'TBS' || key === 'TAE' || key === 'TBE') {
                warnings.push(
                    'Tris buffers are temperature-sensitive (ΔpKa ≈ -0.028/°C). ' +
                    'Adjust pH at the temperature of use.'
                );
            }

            // Autoclave warnings
            if (key === 'HEPES' || key === 'MES' || key === 'MOPS') {
                warnings.push(
                    key + ' should not be autoclaved — filter-sterilize with 0.22 µm filter.'
                );
            }

            return {
                buffer: key,
                fullName: buf.fullName,
                targetVolume: targetVol,
                targetVolumeUnit: 'mL',
                targetpH: targetpH,
                concentration: concFactor + 'X',
                pKa: buf.activePka,
                ingredients: ingredients,
                phAdjustment: phNote,
                warnings: warnings,
                storage: 'Store at room temperature unless supplements added. Use within 1-2 weeks for best results.'
            };
        },

        /**
         * Dilute an existing buffer stock solution.
         *
         * @param {Object} opts
         * @param {number} opts.stockConcentration  - e.g. 10 (for 10X)
         * @param {number} opts.targetConcentration - e.g. 1 (for 1X)
         * @param {number} opts.targetVolume        - final volume in mL
         * @returns {Object} dilution recipe
         */
        dilute: function (opts) {
            if (!opts) throw new Error('opts required');
            var c1 = opts.stockConcentration;
            var c2 = opts.targetConcentration;
            var v2 = opts.targetVolume;
            if (!c1 || !c2 || !v2) {
                throw new Error('stockConcentration, targetConcentration, and targetVolume are required');
            }
            if (c2 >= c1) {
                throw new Error('targetConcentration must be less than stockConcentration');
            }
            var v1 = roundTo((c2 * v2) / c1, 2);
            return {
                stockVolume: v1,
                stockVolumeUnit: 'mL',
                stockConcentration: c1 + 'X',
                solventVolume: roundTo(v2 - v1, 2),
                solventVolumeUnit: 'mL',
                targetVolume: v2,
                targetVolumeUnit: 'mL',
                targetConcentration: c2 + 'X',
                formula: 'C1×V1 = C2×V2 → ' + c1 + '×' + v1 + ' = ' + c2 + '×' + v2
            };
        },

        /**
         * Calculate Henderson-Hasselbalch details for educational use.
         *
         * @param {Object} opts
         * @param {string} opts.buffer   - Buffer key
         * @param {number} opts.targetpH - Desired pH
         * @returns {Object}
         */
        hendersonHasselbalch: function (opts) {
            if (!opts || !opts.buffer) throw new Error('opts.buffer required');
            var key = opts.buffer.toUpperCase();
            var buf = BUFFERS[key];
            if (!buf) throw new Error('Unknown buffer: ' + opts.buffer);
            var targetpH = opts.targetpH != null ? opts.targetpH : buf.defaultpH;
            var ratio = hhRatio(targetpH, buf.activePka);
            var percentBase = roundTo((ratio / (1 + ratio)) * 100, 1);
            var percentAcid = roundTo(100 - percentBase, 1);
            return {
                buffer: key,
                pKa: buf.activePka,
                targetpH: targetpH,
                ratio: roundTo(ratio, 4),
                percentConjugateBase: percentBase,
                percentAcid: percentAcid,
                capacityNote: Math.abs(targetpH - buf.activePka) <= 1
                    ? 'Good buffering capacity (within 1 pH unit of pKa).'
                    : 'WARNING: Poor buffering capacity — pH is > 1 unit from pKa.'
            };
        }
    };
}

module.exports = {
    createBufferPrepCalculator: createBufferPrepCalculator,
    BUFFERS: BUFFERS
};
