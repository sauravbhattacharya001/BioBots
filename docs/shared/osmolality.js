/**
 * Osmolality Calculator
 *
 * Calculates and predicts osmolality of cell culture media and solutions
 * used in bioprinting workflows. Supports common solutes, multi-component
 * mixtures, and provides guidance on adjusting osmolality to target ranges.
 *
 * Osmolality is critical for cell viability — deviations outside the
 * 270–330 mOsm/kg range for mammalian cells can cause lysis or crenation.
 *
 * @example
 *   var osmo = require('./osmolality');
 *   var calc = osmo.createOsmolalityCalculator();
 *   var result = calc.calculate({
 *     solutes: [
 *       { name: 'NaCl', concentration: 0.9, unit: 'percent_w_v' },
 *       { name: 'glucose', concentration: 5.5, unit: 'mM' }
 *     ]
 *   });
 */

'use strict';

/* ------------------------------------------------------------------ */
/*  Solute Database                                                    */
/* ------------------------------------------------------------------ */

var SOLUTES = {
    NaCl: {
        fullName: 'Sodium Chloride',
        mw: 58.44,
        ions: 2,           // Na+ + Cl-
        phi: 0.93,         // osmotic coefficient
        density: 2.16
    },
    KCl: {
        fullName: 'Potassium Chloride',
        mw: 74.55,
        ions: 2,
        phi: 0.92,
        density: 1.98
    },
    glucose: {
        fullName: 'D-Glucose',
        mw: 180.16,
        ions: 1,           // non-electrolyte
        phi: 1.01,
        density: 1.54
    },
    sucrose: {
        fullName: 'Sucrose',
        mw: 342.30,
        ions: 1,
        phi: 1.02,
        density: 1.59
    },
    mannitol: {
        fullName: 'D-Mannitol',
        mw: 182.17,
        ions: 1,
        phi: 1.00,
        density: 1.52
    },
    sorbitol: {
        fullName: 'D-Sorbitol',
        mw: 182.17,
        ions: 1,
        phi: 1.00,
        density: 1.49
    },
    CaCl2: {
        fullName: 'Calcium Chloride',
        mw: 110.98,
        ions: 3,           // Ca2+ + 2Cl-
        phi: 0.86,
        density: 2.15
    },
    Na2HPO4: {
        fullName: 'Disodium Hydrogen Phosphate',
        mw: 141.96,
        ions: 3,           // 2Na+ + HPO4 2-
        phi: 0.74,
        density: 1.70
    },
    KH2PO4: {
        fullName: 'Potassium Dihydrogen Phosphate',
        mw: 136.09,
        ions: 2,
        phi: 0.87,
        density: 2.34
    },
    NaHCO3: {
        fullName: 'Sodium Bicarbonate',
        mw: 84.01,
        ions: 2,
        phi: 0.96,
        density: 2.20
    },
    urea: {
        fullName: 'Urea',
        mw: 60.06,
        ions: 1,
        phi: 1.02,
        density: 1.32
    },
    HEPES: {
        fullName: 'HEPES Buffer',
        mw: 238.30,
        ions: 1,
        phi: 0.95,
        density: 1.24
    },
    trehalose: {
        fullName: 'Trehalose',
        mw: 342.30,
        ions: 1,
        phi: 1.01,
        density: 1.58
    },
    glycerol: {
        fullName: 'Glycerol',
        mw: 92.09,
        ions: 1,
        phi: 1.00,
        density: 1.26
    },
    DMSO: {
        fullName: 'Dimethyl Sulfoxide',
        mw: 78.13,
        ions: 1,
        phi: 1.00,
        density: 1.10
    }
};

/* ------------------------------------------------------------------ */
/*  Common Media Presets (approximate osmolality in mOsm/kg)          */
/* ------------------------------------------------------------------ */

var MEDIA_PRESETS = {
    DMEM:         { fullName: "Dulbecco's Modified Eagle Medium", osmolality: 320 },
    'DMEM/F12':   { fullName: 'DMEM/F-12 (1:1 mix)', osmolality: 300 },
    RPMI1640:     { fullName: 'RPMI 1640', osmolality: 275 },
    MEM:          { fullName: "Minimum Essential Medium", osmolality: 290 },
    PBS:          { fullName: 'Phosphate Buffered Saline', osmolality: 280 },
    'saline_0.9': { fullName: '0.9% Normal Saline', osmolality: 308 },
    HBSS:         { fullName: "Hanks' Balanced Salt Solution", osmolality: 290 },
    Leibovitz:    { fullName: "Leibovitz L-15 Medium", osmolality: 310 }
};

/* ------------------------------------------------------------------ */
/*  Target Ranges (mOsm/kg)                                           */
/* ------------------------------------------------------------------ */

var TARGET_RANGES = {
    mammalian:     { min: 270, max: 330, ideal: 300, label: 'Mammalian cells' },
    insect:        { min: 340, max: 380, ideal: 360, label: 'Insect cells (Sf9, Hi5)' },
    plant:         { min: 250, max: 400, ideal: 300, label: 'Plant cells' },
    bacterial:     { min: 200, max: 600, ideal: 300, label: 'Bacterial culture' },
    cryopreserve:  { min: 1000, max: 2000, ideal: 1500, label: 'Cryopreservation' }
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function round(value, decimals) {
    var factor = Math.pow(10, decimals || 2);
    return Math.round(value * factor) / factor;
}

/**
 * Convert a concentration to molarity (mol/L).
 * Supported units: 'M', 'mM', 'percent_w_v', 'g_per_L', 'mg_per_mL'
 */
function toMolarity(concentration, unit, mw) {
    switch (unit) {
        case 'M':           return concentration;
        case 'mM':          return concentration / 1000;
        case 'percent_w_v': return (concentration * 10) / mw;  // g/100mL → g/L → mol/L
        case 'g_per_L':     return concentration / mw;
        case 'mg_per_mL':   return concentration / mw;          // mg/mL = g/L
        default:
            throw new Error('Unknown concentration unit: ' + unit + '. Use M, mM, percent_w_v, g_per_L, or mg_per_mL.');
    }
}

/* ------------------------------------------------------------------ */
/*  Core Calculator                                                    */
/* ------------------------------------------------------------------ */

function createOsmolalityCalculator() {

    /**
     * Calculate osmolality contribution from a list of solutes.
     * Formula: osmolality = Σ (phi_i × n_i × C_i × 1000)
     *   phi = osmotic coefficient
     *   n   = number of particles (van 't Hoff factor)
     *   C   = molarity in mol/L
     *   ×1000 → mOsm/kg
     */
    function calculate(options) {
        if (!options || !options.solutes || !Array.isArray(options.solutes)) {
            throw new Error('options.solutes must be an array of { name, concentration, unit }');
        }

        var baseOsmolality = 0;
        if (options.baseMedia && MEDIA_PRESETS[options.baseMedia]) {
            baseOsmolality = MEDIA_PRESETS[options.baseMedia].osmolality;
        }

        var breakdown = [];
        var totalOsmolality = 0;

        for (var i = 0; i < options.solutes.length; i++) {
            var s = options.solutes[i];
            var solute = SOLUTES[s.name];
            if (!solute) {
                if (s.mw && s.ions !== undefined) {
                    // Allow custom solutes
                    solute = { fullName: s.name, mw: s.mw, ions: s.ions, phi: s.phi || 1.0 };
                } else {
                    throw new Error('Unknown solute: ' + s.name + '. Provide mw and ions for custom solutes.');
                }
            }

            var molarity = toMolarity(s.concentration, s.unit || 'mM', solute.mw);
            var contribution = solute.phi * solute.ions * molarity * 1000;

            breakdown.push({
                solute: s.name,
                fullName: solute.fullName,
                molarity: round(molarity, 6),
                molarityMM: round(molarity * 1000, 4),
                contribution: round(contribution, 2)
            });

            totalOsmolality += contribution;
        }

        var finalOsmolality = round(baseOsmolality + totalOsmolality, 2);
        var cellType = options.cellType || 'mammalian';
        var range = TARGET_RANGES[cellType] || TARGET_RANGES.mammalian;

        var status;
        if (finalOsmolality < range.min) {
            status = 'HYPOTONIC';
        } else if (finalOsmolality > range.max) {
            status = 'HYPERTONIC';
        } else {
            status = 'ISOTONIC';
        }

        return {
            baseMedia: options.baseMedia || null,
            baseOsmolality: baseOsmolality,
            soluteContribution: round(totalOsmolality, 2),
            totalOsmolality: finalOsmolality,
            unit: 'mOsm/kg',
            status: status,
            targetRange: { min: range.min, max: range.max, ideal: range.ideal, cellType: range.label },
            deviation: round(finalOsmolality - range.ideal, 2),
            deviationPercent: round(((finalOsmolality - range.ideal) / range.ideal) * 100, 2),
            breakdown: breakdown
        };
    }

    /**
     * Determine how much of a solute to add to reach a target osmolality.
     */
    function adjustTo(options) {
        if (!options || !options.currentOsmolality || !options.targetOsmolality || !options.solute) {
            throw new Error('Required: currentOsmolality, targetOsmolality, solute');
        }

        var delta = options.targetOsmolality - options.currentOsmolality;
        if (delta <= 0) {
            return {
                action: 'none_or_dilute',
                message: 'Current osmolality is already at or above target. Dilute with water to lower.',
                delta: round(delta, 2)
            };
        }

        var solute = SOLUTES[options.solute];
        if (!solute) {
            throw new Error('Unknown solute: ' + options.solute);
        }

        var volume = options.volumeL || 1; // default 1 liter
        // delta = phi * n * C * 1000 → C = delta / (phi * n * 1000)
        var requiredMolarity = delta / (solute.phi * solute.ions * 1000);
        var requiredMoles = requiredMolarity * volume;
        var requiredGrams = requiredMoles * solute.mw;

        return {
            solute: options.solute,
            fullName: solute.fullName,
            delta: round(delta, 2),
            requiredConcentration: { M: round(requiredMolarity, 6), mM: round(requiredMolarity * 1000, 4) },
            requiredMass: { grams: round(requiredGrams, 4), mg: round(requiredGrams * 1000, 2) },
            forVolume: volume + ' L',
            resultingOsmolality: options.targetOsmolality,
            unit: 'mOsm/kg'
        };
    }

    /**
     * Look up a common media preset.
     */
    function getMediaOsmolality(mediaName) {
        var preset = MEDIA_PRESETS[mediaName];
        if (!preset) {
            var available = Object.keys(MEDIA_PRESETS);
            throw new Error('Unknown media: ' + mediaName + '. Available: ' + available.join(', '));
        }
        return { name: mediaName, fullName: preset.fullName, osmolality: preset.osmolality, unit: 'mOsm/kg' };
    }

    /**
     * Get target osmolality range for a cell type.
     */
    function getTargetRange(cellType) {
        var range = TARGET_RANGES[cellType];
        if (!range) {
            var available = Object.keys(TARGET_RANGES);
            throw new Error('Unknown cell type: ' + cellType + '. Available: ' + available.join(', '));
        }
        return { cellType: cellType, label: range.label, min: range.min, max: range.max, ideal: range.ideal, unit: 'mOsm/kg' };
    }

    /**
     * List all known solutes.
     */
    function listSolutes() {
        var result = [];
        var keys = Object.keys(SOLUTES);
        for (var i = 0; i < keys.length; i++) {
            var s = SOLUTES[keys[i]];
            result.push({ key: keys[i], fullName: s.fullName, mw: s.mw, ions: s.ions, phi: s.phi });
        }
        return result;
    }

    /**
     * Estimate osmolality change from mixing two solutions.
     */
    function mix(options) {
        if (!options || !options.solution1 || !options.solution2) {
            throw new Error('Required: solution1 { osmolality, volumeL }, solution2 { osmolality, volumeL }');
        }

        var s1 = options.solution1;
        var s2 = options.solution2;
        var totalVolume = s1.volumeL + s2.volumeL;

        if (totalVolume <= 0) {
            throw new Error('Total volume must be positive');
        }

        // Weighted average (approximation, valid for dilute solutions)
        var mixed = (s1.osmolality * s1.volumeL + s2.osmolality * s2.volumeL) / totalVolume;

        return {
            solution1: { osmolality: s1.osmolality, volume: s1.volumeL + ' L' },
            solution2: { osmolality: s2.osmolality, volume: s2.volumeL + ' L' },
            mixedOsmolality: round(mixed, 2),
            totalVolume: round(totalVolume, 4) + ' L',
            unit: 'mOsm/kg'
        };
    }

    return {
        calculate: calculate,
        adjustTo: adjustTo,
        getMediaOsmolality: getMediaOsmolality,
        getTargetRange: getTargetRange,
        listSolutes: listSolutes,
        mix: mix
    };
}

module.exports = {
    createOsmolalityCalculator: createOsmolalityCalculator
};
