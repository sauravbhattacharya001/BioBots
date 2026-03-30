'use strict';

var _sharedMaterials = require('./materials');
var round = require('./validation').round;

/**
 * Material Usage Calculator for BioBots 1 bioprinter.
 * Estimates bioink/material consumption based on print parameters.
 */
function createMaterialCalculator() {
    var MATERIAL_PROFILES = _sharedMaterials.MATERIAL_PROFILES;
    var WELLPLATE_SPECS = _sharedMaterials.WELLPLATE_SPECS;

    /**
     * Compute the bioink volume for a single layer in one well.
     *
     * @param {number} wellArea   Well area in mm² (from WELLPLATE_SPECS)
     * @param {number} layerHeight Layer height in mm
     * @returns {number} Volume in mm³ (µL ÷ 1000), or 0 if inputs are invalid
     */
    function volumePerLayer(wellArea, layerHeight) {
        if (!wellArea || wellArea <= 0 || !layerHeight || layerHeight <= 0) return 0;
        return wellArea * layerHeight;
    }

    /**
     * Calculate total material usage for a bioprinting job.
     *
     * Accounts for wellplate geometry, layer count, infill density,
     * and waste factor to produce volume, mass, and cost estimates.
     *
     * @param {Object} params Print parameters
     * @param {number} params.wellplate Wellplate size (6, 12, 24, 48, or 96)
     * @param {number} params.layerHeight Layer height in mm (max 5)
     * @param {number} params.layerNum Number of layers (max 500)
     * @param {number} [params.wellCount] Wells to print (defaults to full plate)
     * @param {number} [params.infillPercent=100] Infill density 0-100%
     * @param {number} [params.wastePercent=15] Expected waste 0-100%
     * @param {string} [params.materialKey='custom'] Material profile key
     * @param {number} [params.customDensity] Override material density (g/mL)
     * @param {number} [params.customCost] Override cost per mL
     * @returns {Object} Usage report with volumePerWellUl, totalVolumeMl,
     *   totalMassG, estimatedCost, and print geometry details
     * @throws {Error} If parameters are missing or out of range
     */
    function calculateUsage(params) {
        if (!params || typeof params !== 'object') {
            throw new Error('Parameters must be an object');
        }

        var wellplate = params.wellplate;
        var spec = WELLPLATE_SPECS[wellplate];
        if (!spec) {
            throw new Error('Invalid wellplate: ' + wellplate + '. Use 6, 12, 24, 48, or 96.');
        }

        var layerHeight = parseFloat(params.layerHeight);
        var layerNum = parseInt(params.layerNum, 10);
        if (!layerHeight || layerHeight <= 0) throw new Error('Layer height must be positive');
        if (!layerNum || layerNum <= 0) throw new Error('Number of layers must be positive');
        if (layerHeight > 5) throw new Error('Layer height exceeds maximum (5 mm)');
        if (layerNum > 500) throw new Error('Number of layers exceeds maximum (500)');

        var wellCount = params.wellCount != null ? parseInt(params.wellCount, 10) : spec.wells;
        if (wellCount <= 0 || wellCount > spec.wells) {
            throw new Error('Well count must be between 1 and ' + spec.wells);
        }

        var infillPercent = params.infillPercent != null ? parseFloat(params.infillPercent) : 100;
        if (infillPercent < 0 || infillPercent > 100) throw new Error('Infill must be 0-100%');

        var wastePercent = params.wastePercent != null ? parseFloat(params.wastePercent) : 15;
        if (wastePercent < 0 || wastePercent > 100) throw new Error('Waste must be 0-100%');

        var material = MATERIAL_PROFILES[params.materialKey] || MATERIAL_PROFILES['custom'];
        var density = params.customDensity || material.density;
        var costPerMl = params.customCost != null ? params.customCost : material.costPerMl;

        var volPerLayer = volumePerLayer(spec.area, layerHeight);
        var infillFactor = infillPercent / 100;
        var volumePerWell = volPerLayer * layerNum * infillFactor;
        var netVolume = volumePerWell * wellCount;
        var wasteFactor = 1 + (wastePercent / 100);
        var totalVolume = netVolume * wasteFactor;
        var totalVolumeMl = totalVolume / 1000;
        var totalCost = totalVolumeMl * costPerMl;
        var printHeight = layerHeight * layerNum;

        return {
            material: material.name,
            wellplate: wellplate + '-well',
            wellCount: wellCount,
            layerHeight: layerHeight,
            layerNum: layerNum,
            printHeight: round(printHeight, 2),
            infillPercent: infillPercent,
            wastePercent: wastePercent,
            volumePerWellUl: round(volumePerWell, 1),
            netVolumeUl: round(netVolume, 1),
            totalVolumeUl: round(totalVolume, 1),
            totalVolumeMl: round(totalVolumeMl, 3),
            totalMassG: round(totalVolumeMl * density, 3),
            estimatedCost: round(totalCost, 2),
            wellDiameterMm: spec.diameter,
            wellAreaMm2: spec.area
        };
    }

    /**
     * Estimate total print duration including crosslinking pauses.
     *
     * Travel distance is approximated from well perimeter × layers × infill.
     * Crosslinking time (UV/photo curing) is added per-layer per-well.
     *
     * @param {Object} params Print parameters (same as calculateUsage, plus below)
     * @param {number} [params.extruderSpeed=5] Extruder speed in mm/s
     * @param {number} [params.clDuration=0] Crosslinking duration per layer in seconds
     * @returns {Object} Duration report with printTimeMinutes,
     *   crosslinkingTimeMinutes, totalTimeMinutes, totalTimeFormatted,
     *   and travelDistanceMm
     * @throws {Error} If speed is non-positive
     */
    function estimateDuration(params) {
        var usage = calculateUsage(params);
        var speed = params.extruderSpeed || 5;
        if (speed <= 0) throw new Error('Speed must be positive');

        var spec = WELLPLATE_SPECS[params.wellplate];
        var perimeter = Math.PI * spec.diameter;
        var travelDistance = perimeter * usage.layerNum * usage.wellCount * (usage.infillPercent / 100);
        var printTimeSeconds = travelDistance / speed;
        var printTimeMinutes = printTimeSeconds / 60;

        var clTime = params.clDuration || 0;
        var totalClTime = clTime * usage.layerNum * usage.wellCount;
        var totalTimeMinutes = printTimeMinutes + (totalClTime / 60);

        return {
            printTimeMinutes: round(printTimeMinutes, 1),
            crosslinkingTimeMinutes: round(totalClTime / 60, 1),
            totalTimeMinutes: round(totalTimeMinutes, 1),
            totalTimeFormatted: formatDuration(totalTimeMinutes),
            travelDistanceMm: round(travelDistance, 0)
        };
    }

    /**
     * Return a deep copy of all built-in material profiles.
     *
     * @returns {Object.<string, {name: string, density: number, costPerMl: number, viscosity: string}>}
     *   Material profiles keyed by slug (e.g. 'gelatin-methacrylate')
     */
    function getMaterials() {
        return JSON.parse(JSON.stringify(MATERIAL_PROFILES));
    }

    /**
     * Return a deep copy of all wellplate specifications.
     *
     * @returns {Object.<number, {wells: number, diameter: number, area: number}>}
     *   Wellplate specs keyed by well count (6, 12, 24, 48, 96)
     */
    function getWellplates() {
        return JSON.parse(JSON.stringify(WELLPLATE_SPECS));
    }

    /**
     * Compare multiple print configurations side by side.
     *
     * Runs calculateUsage and estimateDuration for each config.
     * Failed configs are reported with their error message rather
     * than throwing, so one bad config doesn't block the rest.
     *
     * @param {Object[]} configs Array of parameter objects (max 10)
     * @returns {Array<{index: number, success: boolean, usage?: Object, duration?: Object, error?: string}>}
     *   Per-config results with usage and duration if successful
     * @throws {Error} If configs is not a non-empty array or exceeds 10
     */
    function compareConfigs(configs) {
        if (!Array.isArray(configs) || configs.length === 0) {
            throw new Error('Configs must be a non-empty array');
        }
        if (configs.length > 10) {
            throw new Error('Maximum 10 configurations for comparison');
        }
        return configs.map(function(config, i) {
            try {
                var usage = calculateUsage(config);
                var duration = estimateDuration(config);
                return { index: i, success: true, usage: usage, duration: duration };
            } catch (e) {
                return { index: i, success: false, error: e.message };
            }
        });
    }

    /**
     * Round a number to a fixed number of decimal places.
     *
     * @param {number} val      Value to round
     * @param {number} decimals Number of decimal places
     * @returns {number} Rounded value
     */
    // round() imported from shared validation.js

    /**
     * Format a duration in minutes to a human-readable string.
     *
     * Under 1 minute: returns seconds (e.g. "45s").
     * Under 1 hour: returns minutes (e.g. "12min").
     * Otherwise: hours and minutes (e.g. "2h 30min").
     *
     * @param {number} minutes Duration in fractional minutes
     * @returns {string} Human-readable duration
     */
    function formatDuration(minutes) {
        if (minutes < 1) return Math.round(minutes * 60) + 's';
        // Round total minutes first to avoid edge cases where
        // Math.round(minutes % 60) = 60 (e.g. minutes = 59.6
        // would produce "60min" instead of "1h 0min").
        var totalMinutes = Math.round(minutes);
        var h = Math.floor(totalMinutes / 60);
        var m = totalMinutes % 60;
        if (h === 0) return m + 'min';
        return h + 'h ' + m + 'min';
    }

    return {
        MATERIAL_PROFILES: MATERIAL_PROFILES,
        WELLPLATE_SPECS: WELLPLATE_SPECS,
        volumePerLayer: volumePerLayer,
        calculateUsage: calculateUsage,
        estimateDuration: estimateDuration,
        getMaterials: getMaterials,
        getWellplates: getWellplates,
        compareConfigs: compareConfigs,
        round: round,
        formatDuration: formatDuration
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createMaterialCalculator: createMaterialCalculator };
}

