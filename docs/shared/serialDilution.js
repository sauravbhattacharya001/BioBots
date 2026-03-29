'use strict';

/**
 * Serial Dilution Calculator
 *
 * Plans serial dilution series for lab work. Given an initial concentration,
 * dilution factor, and number of steps, calculates the resulting concentrations,
 * volumes to transfer, and diluent volumes needed at each step.
 *
 * Supports common dilution schemes (1:2, 1:10, custom) and can work backwards
 * from a target final concentration.
 */

function createSerialDilutionCalculator() {
    return {
        /**
         * Calculate a serial dilution series.
         * @param {Object} opts
         * @param {number} opts.initialConcentration - Starting concentration (any unit).
         * @param {number} opts.dilutionFactor - Fold dilution per step (e.g. 2 for 1:2, 10 for 1:10).
         * @param {number} opts.steps - Number of dilution steps.
         * @param {number} opts.finalVolume - Desired final volume per tube (mL).
         * @param {string} [opts.unit='units/mL'] - Concentration unit label.
         * @returns {Object} Series with step details.
         */
        calculate: function (opts) {
            if (!opts || typeof opts.initialConcentration !== 'number') {
                throw new Error('initialConcentration is required and must be a number');
            }
            if (!opts.dilutionFactor || opts.dilutionFactor <= 1) {
                throw new Error('dilutionFactor must be greater than 1');
            }
            if (!opts.steps || opts.steps < 1 || !Number.isInteger(opts.steps)) {
                throw new Error('steps must be a positive integer');
            }
            if (!opts.finalVolume || opts.finalVolume <= 0) {
                throw new Error('finalVolume must be a positive number');
            }

            var unit = opts.unit || 'units/mL';
            var transferVolume = opts.finalVolume / opts.dilutionFactor;
            var diluentVolume = opts.finalVolume - transferVolume;
            var series = [];
            var conc = opts.initialConcentration;

            for (var i = 0; i < opts.steps; i++) {
                var stepConc = conc / opts.dilutionFactor;
                series.push({
                    step: i + 1,
                    concentration: round(stepConc, 6),
                    transferVolume: round(transferVolume, 4),
                    diluentVolume: round(diluentVolume, 4),
                    totalVolume: opts.finalVolume,
                    dilutionLabel: '1:' + opts.dilutionFactor
                });
                conc = stepConc;
            }

            return {
                initialConcentration: opts.initialConcentration,
                finalConcentration: series[series.length - 1].concentration,
                dilutionFactor: opts.dilutionFactor,
                totalDilution: Math.pow(opts.dilutionFactor, opts.steps),
                steps: series,
                unit: unit,
                summary: 'Serial dilution: ' + opts.initialConcentration + ' ' + unit +
                    ' → ' + series[series.length - 1].concentration + ' ' + unit +
                    ' in ' + opts.steps + ' steps (1:' + opts.dilutionFactor + ')'
            };
        },

        /**
         * Calculate dilution parameters needed to reach a target concentration.
         * @param {Object} opts
         * @param {number} opts.initialConcentration - Starting concentration.
         * @param {number} opts.targetConcentration - Desired final concentration.
         * @param {number} opts.dilutionFactor - Fold dilution per step.
         * @param {number} opts.finalVolume - Volume per tube (mL).
         * @param {string} [opts.unit='units/mL'] - Concentration unit label.
         * @returns {Object} Required steps and series.
         */
        calculateToTarget: function (opts) {
            if (!opts || typeof opts.initialConcentration !== 'number') {
                throw new Error('initialConcentration is required');
            }
            if (typeof opts.targetConcentration !== 'number' || opts.targetConcentration <= 0) {
                throw new Error('targetConcentration must be a positive number');
            }
            if (opts.targetConcentration >= opts.initialConcentration) {
                throw new Error('targetConcentration must be less than initialConcentration');
            }
            if (!opts.dilutionFactor || opts.dilutionFactor <= 1) {
                throw new Error('dilutionFactor must be greater than 1');
            }

            var ratio = opts.initialConcentration / opts.targetConcentration;
            var steps = Math.ceil(Math.log(ratio) / Math.log(opts.dilutionFactor));

            return this.calculate({
                initialConcentration: opts.initialConcentration,
                dilutionFactor: opts.dilutionFactor,
                steps: steps,
                finalVolume: opts.finalVolume || 1,
                unit: opts.unit
            });
        },

        /**
         * Generate a common dilution scheme.
         * @param {string} scheme - 'half' (1:2), 'tenth' (1:10), 'fifth' (1:5), 'third' (1:3).
         * @param {number} initialConcentration - Starting concentration.
         * @param {number} steps - Number of steps.
         * @param {number} finalVolume - Volume per tube (mL).
         * @param {string} [unit] - Concentration unit.
         * @returns {Object} Dilution series.
         */
        preset: function (scheme, initialConcentration, steps, finalVolume, unit) {
            var factors = { half: 2, third: 3, fifth: 5, tenth: 10 };
            var factor = factors[scheme];
            if (!factor) {
                throw new Error('Unknown scheme "' + scheme + '". Use: ' + Object.keys(factors).join(', '));
            }
            return this.calculate({
                initialConcentration: initialConcentration,
                dilutionFactor: factor,
                steps: steps,
                finalVolume: finalVolume || 1,
                unit: unit
            });
        },

        /**
         * Format a dilution series as a text table.
         * @param {Object} result - Output from calculate() or calculateToTarget().
         * @returns {string} Formatted table.
         */
        format: function (result) {
            var lines = [];
            lines.push(result.summary);
            lines.push('');
            lines.push('Step | Concentration (' + result.unit + ') | Transfer (mL) | Diluent (mL) | Total (mL)');
            lines.push('-----|' + '---'.repeat(4));
            for (var i = 0; i < result.steps.length; i++) {
                var s = result.steps[i];
                lines.push(
                    pad(s.step, 4) + ' | ' +
                    pad(s.concentration, 20) + ' | ' +
                    pad(s.transferVolume, 13) + ' | ' +
                    pad(s.diluentVolume, 12) + ' | ' +
                    s.totalVolume
                );
            }
            lines.push('');
            lines.push('Total dilution: 1:' + result.totalDilution);
            return lines.join('\n');
        }
    };
}

var round = require('./validation').round;

function pad(val, width) {
    var s = String(val);
    while (s.length < width) s = ' ' + s;
    return s;
}

exports.createSerialDilutionCalculator = createSerialDilutionCalculator;
