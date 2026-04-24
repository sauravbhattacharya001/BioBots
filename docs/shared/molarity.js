'use strict';

/**
 * Molarity Calculator — convert between mass, volume, concentration,
 * and molecular weight for solution preparation.
 *
 * Common use-cases:
 *  - "I need 250 mL of 0.5 M NaCl — how many grams?"
 *  - "I dissolved 10 g of glucose in 500 mL — what's the molarity?"
 *  - C1V1 = C2V2 dilution calculations
 *
 * @example
 *   var calc = createMolarityCalculator();
 *
 *   // How many grams of NaCl for 250 mL of 0.5 M?
 *   calc.massRequired({ molarity: 0.5, volumeMl: 250, mw: 58.44 });
 *   // => { massG: 7.305, formula: 'mass = M × V × MW' }
 *
 *   // What molarity is 10 g glucose in 500 mL?
 *   calc.molarityFromMass({ massG: 10, volumeMl: 500, mw: 180.16 });
 *   // => { molarity: 0.1110, formula: 'M = mass / (MW × V)' }
 *
 *   // C1V1 = C2V2
 *   calc.dilution({ c1: 1.0, v1Ml: null, c2: 0.1, v2Ml: 500 });
 *   // => { c1: 1.0, v1Ml: 50, c2: 0.1, v2Ml: 500 }
 */

// ── Common reagent molecular weights ───────────────────────────────
var REAGENT_DB = {
    'nacl':       { name: 'Sodium Chloride',          mw: 58.44  },
    'kcl':        { name: 'Potassium Chloride',       mw: 74.55  },
    'cacl2':      { name: 'Calcium Chloride',         mw: 110.98 },
    'glucose':    { name: 'D-Glucose',                mw: 180.16 },
    'sucrose':    { name: 'Sucrose',                  mw: 342.30 },
    'tris':       { name: 'Tris Base',                mw: 121.14 },
    'edta':       { name: 'EDTA (disodium, dihydrate)', mw: 372.24 },
    'sds':        { name: 'Sodium Dodecyl Sulfate',   mw: 288.38 },
    'hepes':      { name: 'HEPES',                    mw: 238.30 },
    'naoh':       { name: 'Sodium Hydroxide',         mw: 40.00  },
    'hcl':        { name: 'Hydrochloric Acid',        mw: 36.46  },
    'ethanol':    { name: 'Ethanol',                  mw: 46.07  },
    'methanol':   { name: 'Methanol',                 mw: 32.04  },
    'dmso':       { name: 'DMSO',                     mw: 78.13  },
    'mgcl2':      { name: 'Magnesium Chloride',       mw: 95.21  },
    'na2hpo4':    { name: 'Disodium Hydrogen Phosphate', mw: 141.96 },
    'kh2po4':     { name: 'Potassium Dihydrogen Phosphate', mw: 136.09 },
    'urea':       { name: 'Urea',                     mw: 60.06  },
    'glycerol':   { name: 'Glycerol',                 mw: 92.09  },
    'bsa':        { name: 'Bovine Serum Albumin',     mw: 66430  },
};

var round = require('./validation').round;

function resolveMw(opts) {
    if (typeof opts.mw === 'number' && opts.mw > 0) return opts.mw;
    if (typeof opts.reagent === 'string') {
        var key = opts.reagent.toLowerCase().replace(/[\s\-]/g, '');
        var entry = REAGENT_DB[key];
        if (!entry) throw new Error('Unknown reagent "' + opts.reagent + '". Use mw parameter or call listReagents().');
        return entry.mw;
    }
    throw new Error('Provide either mw (molecular weight in g/mol) or reagent name.');
}

function createMolarityCalculator() {
    return {
        /**
         * Calculate mass (grams) needed for a solution.
         * mass = M × V(L) × MW
         */
        massRequired: function (opts) {
            var mw = resolveMw(opts);
            var volL = opts.volumeMl / 1000;
            var mass = opts.molarity * volL * mw;
            return {
                massG: round(mass),
                molarity: opts.molarity,
                volumeMl: opts.volumeMl,
                mw: mw,
                formula: 'mass = M × V(L) × MW',
                unit: 'grams'
            };
        },

        /**
         * Calculate molarity from dissolved mass.
         * M = mass / (MW × V(L))
         */
        molarityFromMass: function (opts) {
            var mw = resolveMw(opts);
            var volL = opts.volumeMl / 1000;
            var mol = opts.massG / (mw * volL);
            return {
                molarity: round(mol),
                massG: opts.massG,
                volumeMl: opts.volumeMl,
                mw: mw,
                formula: 'M = mass / (MW × V(L))',
                unit: 'mol/L'
            };
        },

        /**
         * Calculate volume (mL) needed to dissolve a mass to target molarity.
         * V(mL) = (mass / (MW × M)) × 1000
         */
        volumeRequired: function (opts) {
            var mw = resolveMw(opts);
            var volL = opts.massG / (mw * opts.molarity);
            return {
                volumeMl: round(volL * 1000),
                massG: opts.massG,
                molarity: opts.molarity,
                mw: mw,
                formula: 'V(mL) = (mass / (MW × M)) × 1000',
                unit: 'mL'
            };
        },

        /**
         * C1V1 = C2V2 dilution. Provide three of four values; set the
         * unknown to null.
         */
        dilution: function (opts) {
            var c1 = opts.c1, v1 = opts.v1Ml, c2 = opts.c2, v2 = opts.v2Ml;
            var nullCount = (c1 === null ? 1 : 0) + (v1 === null ? 1 : 0) +
                            (c2 === null ? 1 : 0) + (v2 === null ? 1 : 0);
            if (nullCount !== 1) throw new Error('Set exactly one of c1, v1Ml, c2, v2Ml to null.');

            if (c1 === null)  c1 = round((c2 * v2) / v1);
            if (v1 === null)  v1 = round((c2 * v2) / c1);
            if (c2 === null)  c2 = round((c1 * v1) / v2);
            if (v2 === null)  v2 = round((c1 * v1) / c2);

            return {
                c1: c1, v1Ml: v1,
                c2: c2, v2Ml: v2,
                formula: 'C1 × V1 = C2 × V2',
                diluentMl: round(v2 - v1)
            };
        },

        /**
         * Convert between concentration units.
         * Supports: M (mol/L), mM, µM, nM, mg/mL, µg/mL, % (w/v)
         */
        convertUnits: function (opts) {
            var mw = resolveMw(opts);
            var value = opts.value;
            var from = opts.from;
            var to = opts.to;

            // Normalize everything to mol/L first
            var molar;
            switch (from) {
                case 'M':      molar = value; break;
                case 'mM':     molar = value / 1e3; break;
                case 'uM':
                case 'µM':     molar = value / 1e6; break;
                case 'nM':     molar = value / 1e9; break;
                case 'mg/mL':  molar = (value / mw); break;
                case 'ug/mL':
                case 'µg/mL':  molar = (value / 1e3) / mw; break;
                case '%(w/v)': molar = (value * 10) / mw; break;
                default: throw new Error('Unknown unit: ' + from);
            }

            // Convert from mol/L to target
            var result;
            switch (to) {
                case 'M':      result = molar; break;
                case 'mM':     result = molar * 1e3; break;
                case 'uM':
                case 'µM':     result = molar * 1e6; break;
                case 'nM':     result = molar * 1e9; break;
                case 'mg/mL':  result = molar * mw; break;
                case 'ug/mL':
                case 'µg/mL':  result = molar * mw * 1e3; break;
                case '%(w/v)': result = (molar * mw) / 10; break;
                default: throw new Error('Unknown unit: ' + to);
            }

            return {
                value: round(result, 6),
                from: from,
                to: to,
                mw: mw,
                molarEquivalent: round(molar, 6)
            };
        },

        /**
         * List all built-in reagents with molecular weights.
         */
        listReagents: function () {
            var result = [];
            var keys = Object.keys(REAGENT_DB).sort();
            for (var i = 0; i < keys.length; i++) {
                var e = REAGENT_DB[keys[i]];
                result.push({ key: keys[i], name: e.name, mw: e.mw });
            }
            return result;
        },

        /**
         * Recipe: prepare N solutions at once. Returns a table of masses/volumes.
         */
        recipe: function (solutions) {
            var results = [];
            for (var i = 0; i < solutions.length; i++) {
                var s = solutions[i];
                var mw = resolveMw(s);
                var volL = s.volumeMl / 1000;
                var mass = s.molarity * volL * mw;
                results.push({
                    reagent: s.reagent || ('MW=' + mw),
                    molarity: s.molarity,
                    volumeMl: s.volumeMl,
                    mw: mw,
                    massG: round(mass)
                });
            }
            return results;
        }
    };
}

exports.createMolarityCalculator = createMolarityCalculator;
