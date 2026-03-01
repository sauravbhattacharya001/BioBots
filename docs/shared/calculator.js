'use strict';

/**
 * Material Usage Calculator for BioBots 1 bioprinter.
 * Estimates bioink/material consumption based on print parameters.
 */
function createMaterialCalculator() {
    var MATERIAL_PROFILES = {
        'gelatin-methacrylate': { name: 'GelMA', density: 1.05, costPerMl: 12.50, viscosity: 'medium' },
        'alginate': { name: 'Alginate', density: 1.02, costPerMl: 3.80, viscosity: 'low' },
        'collagen-type-1': { name: 'Collagen Type I', density: 1.08, costPerMl: 45.00, viscosity: 'high' },
        'pluronic-f127': { name: 'Pluronic F-127', density: 1.06, costPerMl: 8.20, viscosity: 'medium' },
        'custom': { name: 'Custom', density: 1.00, costPerMl: 0, viscosity: 'medium' }
    };

    var WELLPLATE_SPECS = {
        6:  { wells: 6,  diameter: 34.8, area: 951.1 },
        12: { wells: 12, diameter: 22.1, area: 383.5 },
        24: { wells: 24, diameter: 15.6, area: 191.1 },
        48: { wells: 48, diameter: 11.05, area: 95.9 },
        96: { wells: 96, diameter: 6.35, area: 31.7 }
    };

    function volumePerLayer(wellArea, layerHeight) {
        if (!wellArea || wellArea <= 0 || !layerHeight || layerHeight <= 0) return 0;
        return wellArea * layerHeight;
    }

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

    function getMaterials() {
        return JSON.parse(JSON.stringify(MATERIAL_PROFILES));
    }

    function getWellplates() {
        return JSON.parse(JSON.stringify(WELLPLATE_SPECS));
    }

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

    function round(val, decimals) {
        var factor = Math.pow(10, decimals);
        return Math.round(val * factor) / factor;
    }

    function formatDuration(minutes) {
        if (minutes < 1) return Math.round(minutes * 60) + 's';
        var h = Math.floor(minutes / 60);
        var m = Math.round(minutes % 60);
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
