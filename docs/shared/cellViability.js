'use strict';

var _v = require('./validation');
var round = _v.round;
var _s = require('./stats');
var mean = _s.mean;
var stddev = _s.stddev;

/**
 * Cell Viability Calculator — compute viability from live/dead counts,
 * absorbance readings, or fluorescence data across common assay types.
 *
 * Supported assays:
 *  - Trypan Blue exclusion (live/dead counts)
 *  - Calcein-AM / Ethidium homodimer (fluorescence)
 *  - MTT / XTT / WST (absorbance-based metabolic)
 *  - LDH release (cytotoxicity → viability)
 *
 * @example
 *   var calc = createCellViabilityCalculator();
 *
 *   // Trypan Blue: 180 live, 20 dead
 *   calc.fromCounts({ live: 180, dead: 20 });
 *   // => { viabilityPct: 90, totalCells: 200, live: 180, dead: 20 }
 *
 *   // MTT absorbance: treated vs control
 *   calc.fromAbsorbance({ treated: 0.45, control: 0.9, blank: 0.05 });
 *   // => { viabilityPct: 47.06, correctedTreated: 0.4, correctedControl: 0.85 }
 *
 *   // LDH release
 *   calc.fromLdh({ experimental: 0.8, spontaneous: 0.2, maximum: 1.5 });
 *   // => { cytotoxicityPct: 46.15, viabilityPct: 53.85 }
 *
 *   // Batch: multiple replicates
 *   calc.batchCounts([{ live: 90, dead: 10 }, { live: 85, dead: 15 }, { live: 92, dead: 8 }]);
 *   // => { mean: 89.0, sd: 2.94, n: 3, replicates: [...] }
 */

function validate(val, name) {
    if (typeof val !== 'number' || isNaN(val)) {
        throw new Error(name + ' must be a number');
    }
}

function validateNonNeg(val, name) {
    validate(val, name);
    if (val < 0) throw new Error(name + ' must be >= 0');
}

/**
 * @returns {object} Cell viability calculator instance
 */
function createCellViabilityCalculator() {

    /**
     * Viability from live/dead cell counts (Trypan Blue, etc.)
     */
    function fromCounts(opts) {
        if (!opts) throw new Error('Options required');
        validateNonNeg(opts.live, 'live');
        validateNonNeg(opts.dead, 'dead');
        var total = opts.live + opts.dead;
        if (total === 0) throw new Error('Total cells must be > 0');
        var pct = round((opts.live / total) * 100);
        return {
            viabilityPct: pct,
            totalCells: total,
            live: opts.live,
            dead: opts.dead,
            method: 'count-based',
            formula: 'viability = (live / (live + dead)) × 100'
        };
    }

    /**
     * Viability from absorbance (MTT, XTT, WST assays).
     * Blank-corrected absorbance ratio.
     */
    function fromAbsorbance(opts) {
        if (!opts) throw new Error('Options required');
        validate(opts.treated, 'treated');
        validate(opts.control, 'control');
        var blank = typeof opts.blank === 'number' ? opts.blank : 0;
        var corrTreated = opts.treated - blank;
        var corrControl = opts.control - blank;
        if (corrControl <= 0) throw new Error('Corrected control absorbance must be > 0');
        var pct = round((corrTreated / corrControl) * 100);
        return {
            viabilityPct: pct,
            correctedTreated: round(corrTreated, 4),
            correctedControl: round(corrControl, 4),
            blank: round(blank, 4),
            method: 'absorbance-based',
            formula: 'viability = ((treated - blank) / (control - blank)) × 100'
        };
    }

    /**
     * Viability from LDH cytotoxicity assay.
     * cytotoxicity% = (experimental - spontaneous) / (maximum - spontaneous) × 100
     * viability% = 100 - cytotoxicity%
     */
    function fromLdh(opts) {
        if (!opts) throw new Error('Options required');
        validate(opts.experimental, 'experimental');
        validate(opts.spontaneous, 'spontaneous');
        validate(opts.maximum, 'maximum');
        var denom = opts.maximum - opts.spontaneous;
        if (denom <= 0) throw new Error('Maximum must be > spontaneous');
        var cyto = round(((opts.experimental - opts.spontaneous) / denom) * 100);
        return {
            cytotoxicityPct: cyto,
            viabilityPct: round(100 - cyto),
            method: 'LDH-release',
            formula: 'cytotoxicity = ((exp - spontaneous) / (max - spontaneous)) × 100'
        };
    }

    /**
     * Viability from fluorescence (Calcein-AM / EthD dual stain).
     */
    function fromFluorescence(opts) {
        if (!opts) throw new Error('Options required');
        validateNonNeg(opts.liveFluorescence, 'liveFluorescence');
        validateNonNeg(opts.deadFluorescence, 'deadFluorescence');
        var total = opts.liveFluorescence + opts.deadFluorescence;
        if (total === 0) throw new Error('Total fluorescence must be > 0');
        var pct = round((opts.liveFluorescence / total) * 100);
        return {
            viabilityPct: pct,
            liveFluorescence: opts.liveFluorescence,
            deadFluorescence: opts.deadFluorescence,
            method: 'fluorescence-based',
            formula: 'viability = (live_signal / (live_signal + dead_signal)) × 100'
        };
    }

    /**
     * Batch analysis: compute mean, SD from replicate count-based measurements.
     */
    function batchCounts(replicates) {
        if (!Array.isArray(replicates) || replicates.length === 0) {
            throw new Error('Replicates must be a non-empty array');
        }
        var results = [];
        var viabilities = [];
        for (var i = 0; i < replicates.length; i++) {
            var r = fromCounts(replicates[i]);
            results.push(r);
            viabilities.push(r.viabilityPct);
        }
        return {
            mean: round(mean(viabilities)),
            sd: round(stddev(viabilities)),
            n: replicates.length,
            replicates: results
        };
    }

    /**
     * Batch analysis for absorbance-based assays.
     */
    function batchAbsorbance(replicates) {
        if (!Array.isArray(replicates) || replicates.length === 0) {
            throw new Error('Replicates must be a non-empty array');
        }
        var results = [];
        var viabilities = [];
        for (var i = 0; i < replicates.length; i++) {
            var r = fromAbsorbance(replicates[i]);
            results.push(r);
            viabilities.push(r.viabilityPct);
        }
        return {
            mean: round(mean(viabilities)),
            sd: round(stddev(viabilities)),
            n: replicates.length,
            replicates: results
        };
    }

    /**
     * Dose-response: compute viability at multiple concentrations.
     * Input: array of { concentration, treated, control, blank? }
     * Returns sorted dose-response curve data.
     */
    function doseResponse(points) {
        if (!Array.isArray(points) || points.length === 0) {
            throw new Error('Points must be a non-empty array');
        }
        var curve = [];
        for (var i = 0; i < points.length; i++) {
            var p = points[i];
            validate(p.concentration, 'concentration');
            var v = fromAbsorbance({ treated: p.treated, control: p.control, blank: p.blank });
            curve.push({
                concentration: p.concentration,
                viabilityPct: v.viabilityPct
            });
        }
        curve.sort(function (a, b) { return a.concentration - b.concentration; });

        // Estimate IC50 by linear interpolation
        var ic50 = null;
        for (var j = 1; j < curve.length; j++) {
            var prev = curve[j - 1];
            var curr = curve[j];
            if ((prev.viabilityPct >= 50 && curr.viabilityPct <= 50) ||
                (prev.viabilityPct <= 50 && curr.viabilityPct >= 50)) {
                var frac = (50 - prev.viabilityPct) / (curr.viabilityPct - prev.viabilityPct);
                ic50 = round(prev.concentration + frac * (curr.concentration - prev.concentration), 4);
                break;
            }
        }

        return {
            curve: curve,
            ic50: ic50,
            ic50Note: ic50 !== null
                ? 'Estimated by linear interpolation between adjacent points'
                : 'IC50 not within measured concentration range'
        };
    }

    return {
        fromCounts: fromCounts,
        fromAbsorbance: fromAbsorbance,
        fromLdh: fromLdh,
        fromFluorescence: fromFluorescence,
        batchCounts: batchCounts,
        batchAbsorbance: batchAbsorbance,
        doseResponse: doseResponse
    };
}

module.exports = { createCellViabilityCalculator: createCellViabilityCalculator };
