/**
 * Media Preparation Calculator
 *
 * Calculates volumes and masses needed to prepare cell culture media
 * from stock solutions and powdered reagents. Supports common media
 * formulations (DMEM, RPMI, MEM, etc.) with supplement calculations.
 *
 * @example
 *   var media = require('./mediaPrep');
 *   var calc = media.createMediaPrepCalculator();
 *   var recipe = calc.prepare({
 *     baseMedia: 'DMEM',
 *     targetVolume: 500,
 *     supplements: [
 *       { name: 'FBS', percentage: 10 },
 *       { name: 'Pen-Strep', percentage: 1 },
 *       { name: 'L-Glutamine', concentration: 2, unit: 'mM', stockConcentration: 200, stockUnit: 'mM' }
 *     ]
 *   });
 */

'use strict';

var _stripDangerous = require('./sanitize').stripDangerousKeys;

var COMMON_MEDIA = {
    DMEM: {
        fullName: 'Dulbecco\'s Modified Eagle Medium',
        powderPerLiter: 13.4,
        bicarbonatePerLiter: 3.7,
        ph: 7.4,
        osmolality: 330
    },
    RPMI: {
        fullName: 'RPMI 1640',
        powderPerLiter: 10.4,
        bicarbonatePerLiter: 2.0,
        ph: 7.4,
        osmolality: 290
    },
    MEM: {
        fullName: 'Minimum Essential Medium',
        powderPerLiter: 9.6,
        bicarbonatePerLiter: 2.2,
        ph: 7.4,
        osmolality: 290
    },
    F12: {
        fullName: 'Ham\'s F-12',
        powderPerLiter: 10.6,
        bicarbonatePerLiter: 1.176,
        ph: 7.4,
        osmolality: 300
    },
    'DMEM/F12': {
        fullName: 'DMEM/F-12 (1:1)',
        powderPerLiter: 12.0,
        bicarbonatePerLiter: 2.438,
        ph: 7.4,
        osmolality: 310
    },
    L15: {
        fullName: 'Leibovitz\'s L-15',
        powderPerLiter: 13.8,
        bicarbonatePerLiter: 0,
        ph: 7.4,
        osmolality: 320
    }
};

var COMMON_SUPPLEMENTS = {
    FBS: { fullName: 'Fetal Bovine Serum', typicalPercentage: 10, unit: '%' },
    'Pen-Strep': { fullName: 'Penicillin-Streptomycin', typicalPercentage: 1, unit: '%', stockConcentration: '100x' },
    'L-Glutamine': { fullName: 'L-Glutamine', typicalConcentration: 2, unit: 'mM', stockConcentration: 200, stockUnit: 'mM' },
    'GlutaMAX': { fullName: 'GlutaMAX Supplement', typicalPercentage: 1, unit: '%', stockConcentration: '100x' },
    'HEPES': { fullName: 'HEPES Buffer', typicalConcentration: 10, unit: 'mM', stockConcentration: 1000, stockUnit: 'mM' },
    'NEAA': { fullName: 'Non-Essential Amino Acids', typicalPercentage: 1, unit: '%', stockConcentration: '100x' },
    'Sodium Pyruvate': { fullName: 'Sodium Pyruvate', typicalConcentration: 1, unit: 'mM', stockConcentration: 100, stockUnit: 'mM' },
    '2-ME': { fullName: '2-Mercaptoethanol', typicalConcentration: 55, unit: 'µM', stockConcentration: 55, stockUnit: 'mM' }
};

function _validateInput(opts) {
    if (!opts || typeof opts !== 'object') {
        throw new Error('Options object is required');
    }
    if (!opts.targetVolume || typeof opts.targetVolume !== 'number' || opts.targetVolume <= 0) {
        throw new Error('targetVolume must be a positive number (in mL)');
    }
    if (opts.targetVolume > 50000) {
        throw new Error('targetVolume exceeds 50L maximum');
    }
}

function _calculateSupplement(supp, targetVolumeMl) {
    var result = {
        name: supp.name,
        fullName: supp.fullName || supp.name
    };

    if (supp.percentage !== undefined && supp.percentage !== null) {
        // Percentage-based: v/v
        var volume = (supp.percentage / 100) * targetVolumeMl;
        result.volumeToAdd = Math.round(volume * 1000) / 1000;
        result.unit = 'mL';
        result.method = 'percentage';
        result.percentage = supp.percentage;
    } else if (supp.concentration !== undefined && supp.stockConcentration !== undefined) {
        // Concentration-based: C1V1 = C2V2
        var dilutionFactor = supp.stockConcentration / supp.concentration;
        var vol = targetVolumeMl / dilutionFactor;
        result.volumeToAdd = Math.round(vol * 1000) / 1000;
        result.unit = 'mL';
        result.method = 'dilution';
        result.finalConcentration = supp.concentration;
        result.finalUnit = supp.unit || 'mM';
        result.stockConcentration = supp.stockConcentration;
        result.stockUnit = supp.stockUnit || supp.unit || 'mM';
        result.dilutionFactor = Math.round(dilutionFactor * 10) / 10;
    } else if (supp.massPerLiter !== undefined) {
        // Mass-based: grams per liter
        var mass = (supp.massPerLiter * targetVolumeMl) / 1000;
        result.massToAdd = Math.round(mass * 10000) / 10000;
        result.unit = 'g';
        result.method = 'mass';
    } else {
        throw new Error('Supplement "' + supp.name + '" needs percentage, concentration+stockConcentration, or massPerLiter');
    }

    return result;
}

function createMediaPrepCalculator() {
    return {
        /**
         * List available base media formulations.
         */
        listMedia: function () {
            return Object.keys(COMMON_MEDIA).map(function (key) {
                return {
                    id: key,
                    fullName: COMMON_MEDIA[key].fullName,
                    powderPerLiter: COMMON_MEDIA[key].powderPerLiter + ' g',
                    bicarbonatePerLiter: COMMON_MEDIA[key].bicarbonatePerLiter + ' g',
                    ph: COMMON_MEDIA[key].ph,
                    osmolality: COMMON_MEDIA[key].osmolality + ' mOsm/kg'
                };
            });
        },

        /**
         * List common supplements and their typical usage.
         */
        listSupplements: function () {
            return Object.keys(COMMON_SUPPLEMENTS).map(function (key) {
                var s = COMMON_SUPPLEMENTS[key];
                return {
                    id: key,
                    fullName: s.fullName,
                    typical: s.typicalPercentage
                        ? s.typicalPercentage + '%'
                        : s.typicalConcentration + ' ' + s.unit,
                    stockConcentration: s.stockConcentration || 'N/A'
                };
            });
        },

        /**
         * Calculate a complete media preparation recipe.
         *
         * @param {Object} opts
         * @param {string} [opts.baseMedia] - Media ID (e.g. 'DMEM'). Optional if using liquid media.
         * @param {number} opts.targetVolume - Final volume in mL.
         * @param {boolean} [opts.fromPowder=false] - Prepare from powder (vs liquid).
         * @param {Array} [opts.supplements] - Array of supplement objects.
         * @param {number} [opts.pH] - Target pH (default from media spec).
         * @param {boolean} [opts.filterSterilize=true] - Include filter sterilization step.
         * @returns {Object} Complete preparation recipe.
         */
        prepare: function (opts) {
            _validateInput(opts);

            var mediaSpec = opts.baseMedia ? COMMON_MEDIA[opts.baseMedia.toUpperCase()] || COMMON_MEDIA[opts.baseMedia] : null;
            var targetMl = opts.targetVolume;
            var fromPowder = opts.fromPowder || false;
            var filterSterilize = opts.filterSterilize !== false;

            var recipe = {
                targetVolume: targetMl,
                unit: 'mL',
                baseMedia: opts.baseMedia || 'Custom',
                mediaFullName: mediaSpec ? mediaSpec.fullName : 'Custom Media',
                fromPowder: fromPowder,
                supplements: [],
                totalSupplementVolume: 0,
                baseMediaVolume: 0,
                steps: [],
                warnings: []
            };

            // Calculate supplement volumes first
            var supplementsMl = 0;
            if (opts.supplements && opts.supplements.length > 0) {
                opts.supplements.forEach(function (supp) {
                    // Merge known supplement defaults
                    var known = COMMON_SUPPLEMENTS[supp.name];
                    var merged = Object.assign({}, known || {}, _stripDangerous(supp));
                    var calc = _calculateSupplement(merged, targetMl);
                    recipe.supplements.push(calc);
                    if (calc.volumeToAdd) {
                        supplementsMl += calc.volumeToAdd;
                    }
                });
            }

            recipe.totalSupplementVolume = Math.round(supplementsMl * 1000) / 1000;

            if (fromPowder && mediaSpec) {
                // From powder preparation
                var liters = targetMl / 1000;
                var powderMass = Math.round(mediaSpec.powderPerLiter * liters * 1000) / 1000;
                var bicarbonateMass = Math.round(mediaSpec.bicarbonatePerLiter * liters * 1000) / 1000;
                var waterVolume = Math.round((targetMl - supplementsMl) * 1000) / 1000;

                recipe.powder = { mass: powderMass, unit: 'g' };
                recipe.sodiumBicarbonate = { mass: bicarbonateMass, unit: 'g' };
                recipe.waterVolume = waterVolume;
                recipe.baseMediaVolume = waterVolume;

                recipe.steps.push('Measure ' + (waterVolume * 0.9).toFixed(1) + ' mL of ultrapure water into a clean container');
                recipe.steps.push('Add ' + powderMass + ' g of ' + (mediaSpec.fullName || opts.baseMedia) + ' powder while stirring');
                recipe.steps.push('Add ' + bicarbonateMass + ' g of sodium bicarbonate');
                recipe.steps.push('Stir until fully dissolved');
                recipe.steps.push('Adjust pH to ' + (opts.pH || mediaSpec.ph) + ' using 1N HCl or 1N NaOH');
                recipe.steps.push('Bring to final volume of ' + waterVolume.toFixed(1) + ' mL with ultrapure water');
            } else {
                // From liquid media
                recipe.baseMediaVolume = Math.round((targetMl - supplementsMl) * 1000) / 1000;
                recipe.steps.push('Measure ' + recipe.baseMediaVolume.toFixed(1) + ' mL of ' + (mediaSpec ? mediaSpec.fullName : 'base media'));
            }

            // Add supplement steps
            recipe.supplements.forEach(function (s) {
                if (s.volumeToAdd) {
                    recipe.steps.push('Add ' + s.volumeToAdd.toFixed(3) + ' mL of ' + s.fullName);
                } else if (s.massToAdd) {
                    recipe.steps.push('Weigh and add ' + s.massToAdd.toFixed(4) + ' g of ' + s.fullName);
                }
            });

            if (filterSterilize) {
                recipe.steps.push('Filter sterilize through 0.22 µm membrane filter');
                recipe.filterSize = '0.22 µm';
            }

            recipe.steps.push('Label with media name, date, and initials');
            recipe.steps.push('Store at 2-8°C, use within 4 weeks');

            // Warnings
            var supplementPercentage = (supplementsMl / targetMl) * 100;
            if (supplementPercentage > 25) {
                recipe.warnings.push('Supplements exceed 25% of total volume (' + supplementPercentage.toFixed(1) + '%). This may significantly alter osmolality.');
            }
            if (targetMl < 50) {
                recipe.warnings.push('Small volume preparation — consider pipetting accuracy for supplements < 0.5 mL.');
            }

            recipe.timestamp = new Date().toISOString();
            return recipe;
        },

        /**
         * Scale an existing recipe to a new volume.
         *
         * @param {Object} recipe - A recipe from prepare().
         * @param {number} newVolume - New target volume in mL.
         * @returns {Object} Scaled recipe.
         */
        scale: function (recipe, newVolume) {
            if (!recipe || !newVolume || newVolume <= 0) {
                throw new Error('Valid recipe and positive newVolume required');
            }
            var factor = newVolume / recipe.targetVolume;

            // Build the scaled recipe directly instead of
            // JSON.parse(JSON.stringify(recipe)) which serialises +
            // parses the entire object graph, then re-clones every
            // supplement a second time inside the .map() below.
            // Recipes are shallow-enough (flat scalars + one array of
            // flat supplement objects) that targeted copies are both
            // faster and allocation-lighter.
            var scaled = {
                targetVolume: newVolume,
                unit: recipe.unit,
                baseMedia: recipe.baseMedia,
                mediaFullName: recipe.mediaFullName,
                fromPowder: recipe.fromPowder,
                totalSupplementVolume: Math.round(recipe.totalSupplementVolume * factor * 1000) / 1000,
                baseMediaVolume: Math.round(recipe.baseMediaVolume * factor * 1000) / 1000,
                steps: recipe.steps.slice(),
                warnings: recipe.warnings.slice(),
                filterSize: recipe.filterSize
            };

            if (recipe.powder) {
                scaled.powder = { mass: Math.round(recipe.powder.mass * factor * 1000) / 1000, unit: recipe.powder.unit };
            }
            if (recipe.sodiumBicarbonate) {
                scaled.sodiumBicarbonate = { mass: Math.round(recipe.sodiumBicarbonate.mass * factor * 1000) / 1000, unit: recipe.sodiumBicarbonate.unit };
            }
            if (recipe.waterVolume) {
                scaled.waterVolume = Math.round(recipe.waterVolume * factor * 1000) / 1000;
            }

            // Shallow-copy each supplement object (flat scalar fields)
            // and scale the numeric quantities in one pass.
            scaled.supplements = recipe.supplements.map(function (s) {
                var ns = Object.assign({}, s);
                if (ns.volumeToAdd) ns.volumeToAdd = Math.round(s.volumeToAdd * factor * 1000) / 1000;
                if (ns.massToAdd) ns.massToAdd = Math.round(s.massToAdd * factor * 10000) / 10000;
                return ns;
            });

            scaled.scaleFactor = factor;
            scaled.timestamp = new Date().toISOString();
            return scaled;
        },

        /**
         * Estimate shelf life based on components.
         *
         * @param {Object} recipe - A recipe from prepare().
         * @returns {Object} Shelf life estimate.
         */
        estimateShelfLife: function (recipe) {
            var hasSerum = recipe.supplements.some(function (s) {
                return s.name === 'FBS' || (s.fullName && s.fullName.toLowerCase().indexOf('serum') >= 0);
            });
            var hasGlutamine = recipe.supplements.some(function (s) {
                return s.name === 'L-Glutamine';
            });
            var hasAntibiotics = recipe.supplements.some(function (s) {
                return s.name === 'Pen-Strep' || (s.fullName && s.fullName.toLowerCase().indexOf('antibiotic') >= 0);
            });

            var shelfDays = 42; // 6 weeks base for unopened liquid
            if (hasSerum) shelfDays = Math.min(shelfDays, 28);
            if (hasGlutamine) shelfDays = Math.min(shelfDays, 14);
            if (!hasAntibiotics) shelfDays = Math.min(shelfDays, 14);

            return {
                shelfLifeDays: shelfDays,
                storageTemp: '2-8°C',
                hasSerum: hasSerum,
                hasGlutamine: hasGlutamine,
                hasAntibiotics: hasAntibiotics,
                recommendation: hasGlutamine
                    ? 'L-Glutamine degrades at 2-8°C. Consider using GlutaMAX for longer stability, or prepare smaller batches.'
                    : 'Store at 2-8°C protected from light. Warm to 37°C before use.'
            };
        }
    };
}

module.exports = {
    createMediaPrepCalculator: createMediaPrepCalculator,
    COMMON_MEDIA: COMMON_MEDIA,
    COMMON_SUPPLEMENTS: COMMON_SUPPLEMENTS
};
