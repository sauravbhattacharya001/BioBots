/**
 * pH Adjustment Calculator
 *
 * Calculates the volume of acid or base stock solution needed to shift
 * a given solution from its current pH to a target pH. Supports common
 * lab acids (HCl, H2SO4, acetic acid) and bases (NaOH, KOH, NH4OH),
 * accounts for buffer capacity when a buffer system is specified, and
 * provides step-by-step titration guidance.
 *
 * @example
 *   var phAdj = require('./phAdjustment');
 *   var calc = phAdj.createPhAdjustmentCalculator();
 *   var result = calc.calculate({
 *     currentPh: 6.8,
 *     targetPh: 7.4,
 *     solutionVolume: 500,     // mL
 *     reagent: 'NaOH',
 *     reagentConcentration: 1  // M
 *   });
 */

'use strict';

var round = require('./validation').round;

/* ------------------------------------------------------------------ */
/*  Reagent Database                                                   */
/* ------------------------------------------------------------------ */

var REAGENTS = {
    HCl: {
        fullName: 'Hydrochloric acid',
        type: 'acid',
        valence: 1,
        strong: true,
        mw: 36.46,
        commonConcentrations: [0.1, 0.5, 1.0, 6.0, 12.1],
        hazards: ['Corrosive', 'Irritant'],
        storageTemp: 'Room temperature'
    },
    H2SO4: {
        fullName: 'Sulfuric acid',
        type: 'acid',
        valence: 2,
        strong: true,
        mw: 98.08,
        commonConcentrations: [0.1, 0.5, 1.0, 9.0, 18.0],
        hazards: ['Corrosive', 'Oxidizer', 'Exothermic on dilution'],
        storageTemp: 'Room temperature'
    },
    AceticAcid: {
        fullName: 'Acetic acid',
        type: 'acid',
        valence: 1,
        strong: false,
        pKa: 4.76,
        mw: 60.05,
        commonConcentrations: [0.1, 1.0, 17.4],
        hazards: ['Flammable', 'Corrosive at high conc.'],
        storageTemp: 'Room temperature'
    },
    NaOH: {
        fullName: 'Sodium hydroxide',
        type: 'base',
        valence: 1,
        strong: true,
        mw: 40.0,
        commonConcentrations: [0.1, 0.5, 1.0, 5.0, 10.0],
        hazards: ['Corrosive'],
        storageTemp: 'Room temperature, sealed'
    },
    KOH: {
        fullName: 'Potassium hydroxide',
        type: 'base',
        valence: 1,
        strong: true,
        mw: 56.11,
        commonConcentrations: [0.1, 0.5, 1.0, 5.0],
        hazards: ['Corrosive'],
        storageTemp: 'Room temperature, sealed'
    },
    NH4OH: {
        fullName: 'Ammonium hydroxide',
        type: 'base',
        valence: 1,
        strong: false,
        pKb: 4.75,
        mw: 35.04,
        commonConcentrations: [0.1, 1.0, 14.8],
        hazards: ['Irritant', 'Strong odor'],
        storageTemp: 'Cool, ventilated area'
    }
};

/* ------------------------------------------------------------------ */
/*  Common Buffer Systems (for buffer-capacity adjustment)             */
/* ------------------------------------------------------------------ */

var BUFFER_SYSTEMS = {
    phosphate: { pKa: 7.20, typicalConcentration: 0.1, name: 'Phosphate' },
    tris:      { pKa: 8.06, typicalConcentration: 0.05, name: 'Tris' },
    hepes:     { pKa: 7.55, typicalConcentration: 0.025, name: 'HEPES' },
    mes:       { pKa: 6.15, typicalConcentration: 0.05, name: 'MES' },
    mops:      { pKa: 7.20, typicalConcentration: 0.05, name: 'MOPS' },
    acetate:   { pKa: 4.76, typicalConcentration: 0.1, name: 'Acetate' },
    citrate:   { pKa: 4.76, typicalConcentration: 0.05, name: 'Citrate' },
    bicarbonate: { pKa: 6.35, typicalConcentration: 0.025, name: 'Bicarbonate' }
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Calculate buffer capacity (β) at a given pH for a single pKa system.
 * β = 2.303 * C * Ka * [H+] / (Ka + [H+])^2
 */
function bufferCapacity(concentration, pKa, pH) {
    var Ka = Math.pow(10, -pKa);
    var H  = Math.pow(10, -pH);
    return 2.303 * concentration * Ka * H / Math.pow(Ka + H, 2);
}

/**
 * Estimate moles of strong acid/base needed to shift pH in a buffered solution.
 * Uses numerical integration (trapezoidal) of buffer capacity over the pH range.
 */
function molesForBufferedShift(volumeL, bufferConc, pKa, fromPh, toPh) {
    var steps = 200;
    var dPh = (toPh - fromPh) / steps;
    var total = 0;
    for (var i = 0; i < steps; i++) {
        var ph1 = fromPh + i * dPh;
        var ph2 = ph1 + dPh;
        var b1 = bufferCapacity(bufferConc, pKa, ph1);
        var b2 = bufferCapacity(bufferConc, pKa, ph2);
        // Also include water self-ionization contribution
        var w1 = Math.pow(10, -ph1) + Math.pow(10, ph1 - 14);
        var w2 = Math.pow(10, -ph2) + Math.pow(10, ph2 - 14);
        total += 0.5 * ((b1 + w1) + (b2 + w2)) * Math.abs(dPh);
    }
    return Math.abs(total * volumeL);
}

/**
 * Estimate moles for unbuffered (pure water-like) pH shift.
 */
function molesForUnbufferedShift(volumeL, fromPh, toPh) {
    // Change in [H+] or [OH-] depending on direction
    if (toPh < fromPh) {
        // Acidifying: need moles H+
        return Math.abs(Math.pow(10, -toPh) - Math.pow(10, -fromPh)) * volumeL;
    } else {
        // Basifying: need moles OH-
        return Math.abs(Math.pow(10, (toPh - 14)) - Math.pow(10, (fromPh - 14))) * volumeL;
    }
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

function validate(opts) {
    var errors = [];
    if (typeof opts.currentPh !== 'number' || opts.currentPh < 0 || opts.currentPh > 14) {
        errors.push('currentPh must be a number between 0 and 14');
    }
    if (typeof opts.targetPh !== 'number' || opts.targetPh < 0 || opts.targetPh > 14) {
        errors.push('targetPh must be a number between 0 and 14');
    }
    if (typeof opts.solutionVolume !== 'number' || opts.solutionVolume <= 0) {
        errors.push('solutionVolume must be a positive number (mL)');
    }
    if (typeof opts.reagentConcentration !== 'number' || opts.reagentConcentration <= 0) {
        errors.push('reagentConcentration must be a positive number (M)');
    }
    if (opts.reagent && !REAGENTS[opts.reagent]) {
        errors.push('Unknown reagent "' + opts.reagent + '". Available: ' + Object.keys(REAGENTS).join(', '));
    }
    if (opts.bufferSystem && !BUFFER_SYSTEMS[opts.bufferSystem]) {
        errors.push('Unknown buffer system "' + opts.bufferSystem + '". Available: ' + Object.keys(BUFFER_SYSTEMS).join(', '));
    }
    return errors;
}

/* ------------------------------------------------------------------ */
/*  Main Calculator                                                    */
/* ------------------------------------------------------------------ */

function createPhAdjustmentCalculator() {

    /**
     * Calculate volume of reagent needed to adjust pH.
     *
     * @param {Object} opts
     * @param {number} opts.currentPh         - Current pH of solution
     * @param {number} opts.targetPh          - Desired pH
     * @param {number} opts.solutionVolume    - Volume in mL
     * @param {string} opts.reagent           - Reagent key (e.g. 'NaOH', 'HCl')
     * @param {number} opts.reagentConcentration - Molarity of reagent stock (M)
     * @param {string} [opts.bufferSystem]    - Optional buffer system key
     * @param {number} [opts.bufferConcentration] - Buffer concentration (M), defaults to system typical
     * @returns {Object} Calculation result
     */
    function calculate(opts) {
        var errors = validate(opts);
        if (errors.length > 0) {
            return { success: false, errors: errors };
        }

        var reagentInfo = REAGENTS[opts.reagent];
        var direction = opts.targetPh > opts.currentPh ? 'up' : 'down';

        // Sanity: direction must match reagent type
        if (direction === 'up' && reagentInfo.type === 'acid') {
            return {
                success: false,
                errors: ['Cannot raise pH with an acid (' + opts.reagent + '). Use a base instead.']
            };
        }
        if (direction === 'down' && reagentInfo.type === 'base') {
            return {
                success: false,
                errors: ['Cannot lower pH with a base (' + opts.reagent + '). Use an acid instead.']
            };
        }
        if (opts.currentPh === opts.targetPh) {
            return {
                success: true,
                reagentVolume: 0,
                unit: 'mL',
                message: 'pH is already at target. No adjustment needed.'
            };
        }

        var volumeL = opts.solutionVolume / 1000;
        var moles;

        if (opts.bufferSystem) {
            var buf = BUFFER_SYSTEMS[opts.bufferSystem];
            var bufConc = opts.bufferConcentration || buf.typicalConcentration;
            moles = molesForBufferedShift(volumeL, bufConc, buf.pKa, opts.currentPh, opts.targetPh);
        } else {
            moles = molesForUnbufferedShift(volumeL, opts.currentPh, opts.targetPh);
        }

        // Account for reagent valence (e.g. H2SO4 provides 2 H+ per mole)
        var effectiveMoles = moles / reagentInfo.valence;
        var reagentVolumeL = effectiveMoles / opts.reagentConcentration;
        var reagentVolumeMl = reagentVolumeL * 1000;

        // Build titration steps (incremental approach)
        var steps = [];
        var totalAdded = 0;
        var increments = [0.25, 0.25, 0.25, 0.25];
        for (var i = 0; i < increments.length; i++) {
            var portion = round(reagentVolumeMl * increments[i], 2);
            totalAdded += portion;
            steps.push({
                step: i + 1,
                action: 'Add ' + portion + ' mL of ' + opts.reagentConcentration + ' M ' + opts.reagent,
                cumulativeVolume: round(totalAdded, 2),
                instruction: i < increments.length - 1
                    ? 'Mix thoroughly, wait 1-2 min, measure pH'
                    : 'Mix thoroughly, verify final pH is ~' + opts.targetPh
            });
        }

        // Determine recommended unit for small volumes
        var displayVolume = reagentVolumeMl;
        var displayUnit = 'mL';
        if (reagentVolumeMl < 0.01) {
            displayVolume = round(reagentVolumeMl * 1000, 4);
            displayUnit = 'µL';
        } else if (reagentVolumeMl < 1) {
            displayVolume = round(reagentVolumeMl * 1000, 2);
            displayUnit = 'µL';
        } else {
            displayVolume = round(reagentVolumeMl, 4);
        }

        var warnings = [];
        if (Math.abs(opts.targetPh - opts.currentPh) > 3) {
            warnings.push('Large pH shift (>' + 3 + ' units). Add reagent slowly and monitor continuously.');
        }
        if (reagentVolumeMl > opts.solutionVolume * 0.1) {
            warnings.push('Reagent volume exceeds 10% of solution volume. Final volume and concentrations will change significantly.');
        }
        if (reagentInfo.hazards && reagentInfo.hazards.length > 0) {
            warnings.push('Safety: ' + reagentInfo.hazards.join(', ') + '. Wear appropriate PPE.');
        }

        return {
            success: true,
            currentPh: opts.currentPh,
            targetPh: opts.targetPh,
            direction: direction === 'up' ? 'alkalinize' : 'acidify',
            reagent: {
                name: reagentInfo.fullName,
                key: opts.reagent,
                concentration: opts.reagentConcentration,
                concentrationUnit: 'M',
                type: reagentInfo.type
            },
            solutionVolume: opts.solutionVolume,
            bufferSystem: opts.bufferSystem
                ? { name: BUFFER_SYSTEMS[opts.bufferSystem].name, concentration: opts.bufferConcentration || BUFFER_SYSTEMS[opts.bufferSystem].typicalConcentration }
                : null,
            result: {
                molesRequired: round(moles, 6),
                reagentVolume: displayVolume,
                unit: displayUnit,
                reagentVolumeMl: round(reagentVolumeMl, 4)
            },
            titrationSteps: steps,
            warnings: warnings,
            finalVolumeEstimate: round(opts.solutionVolume + reagentVolumeMl, 2)
        };
    }

    /**
     * Suggest which reagent to use for a given pH shift.
     */
    function suggestReagent(currentPh, targetPh) {
        var direction = targetPh > currentPh ? 'base' : 'acid';
        var suggestions = [];
        var keys = Object.keys(REAGENTS);
        for (var i = 0; i < keys.length; i++) {
            var r = REAGENTS[keys[i]];
            if (r.type === direction) {
                suggestions.push({
                    key: keys[i],
                    name: r.fullName,
                    strong: r.strong,
                    commonConcentrations: r.commonConcentrations,
                    recommendation: r.strong
                        ? 'Good for large pH shifts; add slowly'
                        : 'Gentler adjustment; better for fine-tuning near pKa'
                });
            }
        }
        return {
            direction: direction === 'base' ? 'alkalinize' : 'acidify',
            phShift: round(Math.abs(targetPh - currentPh), 2),
            suggestions: suggestions
        };
    }

    /**
     * List all available reagents.
     */
    function listReagents() {
        var result = {};
        var keys = Object.keys(REAGENTS);
        for (var i = 0; i < keys.length; i++) {
            result[keys[i]] = {
                name: REAGENTS[keys[i]].fullName,
                type: REAGENTS[keys[i]].type,
                strong: REAGENTS[keys[i]].strong,
                commonConcentrations: REAGENTS[keys[i]].commonConcentrations
            };
        }
        return result;
    }

    /**
     * List available buffer systems.
     */
    function listBufferSystems() {
        var result = {};
        var keys = Object.keys(BUFFER_SYSTEMS);
        for (var i = 0; i < keys.length; i++) {
            result[keys[i]] = BUFFER_SYSTEMS[keys[i]];
        }
        return result;
    }

    return {
        calculate: calculate,
        suggestReagent: suggestReagent,
        listReagents: listReagents,
        listBufferSystems: listBufferSystems
    };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

exports.createPhAdjustmentCalculator = createPhAdjustmentCalculator;
