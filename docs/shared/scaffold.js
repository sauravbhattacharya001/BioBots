'use strict';

var _vRound = require('./validation').round;

/**
 * Scaffold Geometry Calculator for bioprinting.
 *
 * Computes porosity, pore dimensions, surface area, strut volume,
 * and mechanical estimates for common scaffold architectures used
 * in tissue engineering: grid, honeycomb, and gyroid.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var scaffold = biobots.createScaffoldCalculator();
 *   var result = scaffold.analyze({
 *     architecture: 'grid',
 *     dimensions: { x: 10, y: 10, z: 5 },
 *     strutWidth: 0.4,
 *     poreSize: 0.5,
 *     layerHeight: 0.2
 *   });
 */

var _sanitize = require('./sanitize');
var _isDangerousKey = _sanitize.isDangerousKey;

var ARCHITECTURES = {
    grid: {
        name: 'Rectilinear Grid',
        description: 'Orthogonal strut pattern, alternating 0°/90° layers',
        porosityModel: 'analytical',
        minPorosity: 0.20,
        maxPorosity: 0.90
    },
    honeycomb: {
        name: 'Honeycomb',
        description: 'Hexagonal pore pattern for isotropic in-plane stiffness',
        porosityModel: 'analytical',
        minPorosity: 0.30,
        maxPorosity: 0.95
    },
    gyroid: {
        name: 'Gyroid (TPMS)',
        description: 'Triply periodic minimal surface for high interconnectivity',
        porosityModel: 'approximation',
        minPorosity: 0.15,
        maxPorosity: 0.95
    }
};

var MATERIAL_PRESETS = {
    'gelma-5': { name: 'GelMA 5%', modulusKPa: 3.5, poissonRatio: 0.45, densityGPerMl: 1.04 },
    'gelma-10': { name: 'GelMA 10%', modulusKPa: 15, poissonRatio: 0.42, densityGPerMl: 1.06 },
    'alginate-2': { name: 'Alginate 2%', modulusKPa: 8, poissonRatio: 0.48, densityGPerMl: 1.02 },
    'alginate-4': { name: 'Alginate 4%', modulusKPa: 25, poissonRatio: 0.45, densityGPerMl: 1.04 },
    'collagen-6': { name: 'Collagen 6mg/mL', modulusKPa: 1.2, poissonRatio: 0.49, densityGPerMl: 1.01 },
    'pcl': { name: 'PCL', modulusKPa: 400000, poissonRatio: 0.38, densityGPerMl: 1.15 },
    'pla': { name: 'PLA', modulusKPa: 3500000, poissonRatio: 0.36, densityGPerMl: 1.25 },
    'custom': { name: 'Custom', modulusKPa: null, poissonRatio: 0.40, densityGPerMl: 1.00 }
};

var TISSUE_TARGETS = {
    bone: { porosity: [0.50, 0.90], poreUm: [200, 500], modulusKPa: [100000, 20000000] },
    cartilage: { porosity: [0.70, 0.90], poreUm: [100, 300], modulusKPa: [500, 2000] },
    skin: { porosity: [0.60, 0.90], poreUm: [100, 250], modulusKPa: [10, 100] },
    liver: { porosity: [0.70, 0.95], poreUm: [150, 300], modulusKPa: [5, 50] },
    vascular: { porosity: [0.60, 0.80], poreUm: [100, 200], modulusKPa: [50, 500] },
    neural: { porosity: [0.80, 0.95], poreUm: [50, 200], modulusKPa: [0.5, 10] }
};

/**
 * Round a numeric value to the specified number of decimal places.
 *
 * @param {number} val - Value to round.
 * @param {number} [decimals=4] - Number of decimal places.
 * @returns {number} Rounded value, or 0 if the input is not a finite number.
 * @private
 */
function _round(val, decimals) {
    if (typeof val !== 'number' || isNaN(val)) return 0;
    return _vRound(val, decimals || 4);
}

/**
 * Compute analytical porosity for a rectilinear grid scaffold.
 *
 * Models alternating 0°/90° strut layers. Solid fraction is derived
 * from two orthogonal strut contributions minus their overlap region.
 *
 * @param {number} strutWidth - Strut cross-section width (mm).
 * @param {number} poreSize - Target pore opening size (mm).
 * @returns {number} Porosity as a fraction (0–1).
 * @private
 */
function _gridPorosity(strutWidth, poreSize) {
    var pitch = strutWidth + poreSize;
    var solidFraction = (2 * strutWidth / pitch) - Math.pow(strutWidth / pitch, 2);
    return 1 - solidFraction;
}

/**
 * Compute analytical porosity for a honeycomb scaffold.
 *
 * Uses a hexagonal cell model where solid fraction depends on strut
 * width relative to cell size scaled by √3 (hexagonal geometry).
 *
 * @param {number} strutWidth - Strut width (mm).
 * @param {number} poreSize - Pore opening size (mm).
 * @returns {number} Porosity as a fraction (0–1).
 * @private
 */
function _honeycombPorosity(strutWidth, poreSize) {
    var cellSize = strutWidth + poreSize;
    var solidFraction = (2 * strutWidth) / (Math.sqrt(3) * cellSize);
    return 1 - solidFraction;
}

/**
 * Approximate porosity for a gyroid (TPMS) scaffold.
 *
 * Gyroid porosity doesn't have a simple closed-form solution; this
 * uses a linear approximation based on the strut-to-pitch ratio,
 * clamped to [0.05, 0.98] to avoid degenerate values.
 *
 * @param {number} strutWidth - Strut width (mm).
 * @param {number} poreSize - Pore opening size (mm).
 * @returns {number} Porosity as a fraction, clamped to [0.05, 0.98].
 * @private
 */
function _gyroidPorosity(strutWidth, poreSize) {
    var pitch = strutWidth + poreSize;
    var ratio = strutWidth / pitch;
    var porosity = 1 - 1.05 * ratio;
    return Math.max(0.05, Math.min(0.98, porosity));
}

/**
 * Estimate the surface-area-to-volume ratio (1/mm) for a scaffold architecture.
 *
 * Higher SA:V ratios promote cell attachment and nutrient exchange.
 * Gyroid structures typically achieve the highest ratios due to their
 * triply periodic minimal surface geometry.
 *
 * @param {string} architecture - One of 'grid', 'honeycomb', or 'gyroid'.
 * @param {number} strutWidth - Strut width (mm).
 * @param {number} poreSize - Pore opening size (mm).
 * @returns {number} Surface-area-to-volume ratio (mm⁻¹).
 * @private
 */
function _surfaceAreaToVolume(architecture, strutWidth, poreSize) {
    var pitch = strutWidth + poreSize;
    switch (architecture) {
        case 'grid': return 4 / strutWidth;
        case 'honeycomb': return (2 * Math.sqrt(3)) / strutWidth;
        case 'gyroid': return (2 * Math.PI) / (pitch * Math.sqrt(strutWidth / pitch));
        default: return 4 / strutWidth;
    }
}

/**
 * Estimate effective (apparent) elastic modulus using the Gibson-Ashby model.
 *
 * E_eff = E_bulk × (1 − φ)², where φ is porosity. This power-law
 * relationship captures how cellular solids lose stiffness with
 * increasing void fraction.
 *
 * @param {number} bulkModulusKPa - Bulk material modulus (kPa).
 * @param {number} porosity - Scaffold porosity (0–1).
 * @returns {number} Effective modulus (kPa).
 * @private
 */
function _effectiveModulus(bulkModulusKPa, porosity) {
    var relativeDensity = 1 - porosity;
    return bulkModulusKPa * Math.pow(relativeDensity, 2);
}

/**
 * Estimate intrinsic permeability using the Kozeny-Carman equation.
 *
 * k = d²ε³ / (180(1−ε)²), where d is pore diameter and ε is porosity.
 * This governs how easily fluid (culture media) flows through the scaffold.
 *
 * @param {number} poreSizeMm - Pore diameter (mm).
 * @param {number} porosity - Scaffold porosity (0–1).
 * @returns {number} Intrinsic permeability (mm²). Returns 0 for degenerate inputs.
 * @private
 */
function _permeability(poreSizeMm, porosity) {
    var eps = porosity;
    var d = poreSizeMm;
    if (eps >= 1 || eps <= 0) return 0;
    return (d * d * Math.pow(eps, 3)) / (180 * Math.pow(1 - eps, 2));
}

function createScaffoldCalculator() {

    /**
     * Analyze scaffold geometry and compute physical properties.
     *
     * Given an architecture type, bounding dimensions, strut width, pore
     * size, and layer height, computes porosity, pore geometry, surface
     * area, mechanical properties (Gibson-Ashby), transport properties
     * (Kozeny-Carman permeability), and print estimates.
     *
     * @param {Object} params - Scaffold parameters.
     * @param {string} params.architecture - Architecture type: 'grid', 'honeycomb', or 'gyroid'.
     * @param {Object} params.dimensions - Bounding box {x, y, z} in mm (each ≤500).
     * @param {number} params.strutWidth - Strut width in mm (0.05–5).
     * @param {number} params.poreSize - Target pore opening in mm (0.05–10).
     * @param {number} params.layerHeight - Print layer height in mm (0.01–2).
     * @param {string} [params.material='custom'] - Material preset key (e.g. 'gelma-5', 'pcl').
     * @param {number} [params.customModulusKPa] - Override bulk modulus (kPa).
     * @param {number} [params.customDensity] - Override material density (g/mL).
     * @returns {Object} Comprehensive scaffold analysis with architecture, dimensions,
     *   porosity, poreGeometry, surface, mechanical, transport, and printEstimates.
     * @throws {Error} If required parameters are missing or out of range.
     */
    function analyze(params) {
        if (!params || typeof params !== 'object') {
            throw new Error('Parameters must be an object');
        }
        var arch = params.architecture;
        if (!arch || !ARCHITECTURES[arch]) {
            throw new Error('Invalid architecture. Choose: ' + Object.keys(ARCHITECTURES).join(', '));
        }
        var dims = params.dimensions;
        if (!dims || typeof dims !== 'object' || !dims.x || !dims.y || !dims.z) {
            throw new Error('dimensions must be {x, y, z} in mm, all > 0');
        }
        if (dims.x <= 0 || dims.y <= 0 || dims.z <= 0) {
            throw new Error('All dimensions must be positive');
        }
        if (dims.x > 500 || dims.y > 500 || dims.z > 500) {
            throw new Error('Dimensions exceed maximum (500 mm)');
        }
        var sw = params.strutWidth;
        if (typeof sw !== 'number' || sw < 0.05 || sw > 5) {
            throw new Error('strutWidth must be 0.05\u20135 mm');
        }
        var ps = params.poreSize;
        if (typeof ps !== 'number' || ps < 0.05 || ps > 10) {
            throw new Error('poreSize must be 0.05\u201310 mm');
        }
        var lh = params.layerHeight;
        if (typeof lh !== 'number' || lh < 0.01 || lh > 2) {
            throw new Error('layerHeight must be 0.01\u20132 mm');
        }

        var matKey = params.material || 'custom';
        var mat = MATERIAL_PRESETS[matKey];
        if (!mat) {
            throw new Error('Unknown material: ' + matKey + '. Options: ' + Object.keys(MATERIAL_PRESETS).join(', '));
        }
        var bulkModulus = params.customModulusKPa || mat.modulusKPa || 10;
        var density = params.customDensity || mat.densityGPerMl;

        var totalVolumeMm3 = dims.x * dims.y * dims.z;
        var totalVolumeMl = totalVolumeMm3 / 1000;
        var numLayers = Math.ceil(dims.z / lh);
        var pitch = sw + ps;

        var porosity;
        switch (arch) {
            case 'grid': porosity = _gridPorosity(sw, ps); break;
            case 'honeycomb': porosity = _honeycombPorosity(sw, ps); break;
            case 'gyroid': porosity = _gyroidPorosity(sw, ps); break;
        }

        var archInfo = ARCHITECTURES[arch];
        porosity = Math.max(archInfo.minPorosity, Math.min(archInfo.maxPorosity, porosity));

        var solidVolumeMm3 = totalVolumeMm3 * (1 - porosity);
        var solidVolumeMl = solidVolumeMm3 / 1000;
        var poreVolumeMm3 = totalVolumeMm3 * porosity;
        var poreVolumeMl = poreVolumeMm3 / 1000;
        var massG = solidVolumeMl * density;

        var saToV = _surfaceAreaToVolume(arch, sw, ps);
        var totalSurfaceAreaMm2 = saToV * solidVolumeMm3;
        var permeabilityMm2 = _permeability(ps, porosity);

        var effectiveModulusKPa = _effectiveModulus(bulkModulus, porosity);

        var poresX = Math.floor(dims.x / pitch);
        var poresY = Math.floor(dims.y / pitch);
        var poresPerLayer = poresX * poresY;
        var totalPores = poresPerLayer * numLayers;

        return {
            architecture: { type: arch, name: archInfo.name, description: archInfo.description },
            dimensions: {
                x: dims.x, y: dims.y, z: dims.z, unit: 'mm',
                boundingVolumeMm3: _round(totalVolumeMm3, 2),
                boundingVolumeMl: _round(totalVolumeMl, 4)
            },
            porosity: {
                fraction: _round(porosity, 4),
                percent: _round(porosity * 100, 2),
                solidVolumeMm3: _round(solidVolumeMm3, 2),
                solidVolumeMl: _round(solidVolumeMl, 4),
                poreVolumeMm3: _round(poreVolumeMm3, 2),
                poreVolumeMl: _round(poreVolumeMl, 4)
            },
            poreGeometry: {
                targetPoreSizeMm: ps,
                targetPoreSizeUm: _round(ps * 1000, 0),
                strutWidthMm: sw,
                strutWidthUm: _round(sw * 1000, 0),
                pitchMm: _round(pitch, 4),
                poresPerLayer: poresPerLayer,
                estimatedTotalPores: totalPores
            },
            surface: {
                surfaceAreaToVolumeRatio: _round(saToV, 4),
                estimatedSurfaceAreaMm2: _round(totalSurfaceAreaMm2, 2),
                estimatedSurfaceAreaCm2: _round(totalSurfaceAreaMm2 / 100, 4)
            },
            mechanical: {
                materialPreset: mat.name,
                bulkModulusKPa: _round(bulkModulus, 2),
                effectiveModulusKPa: _round(effectiveModulusKPa, 2),
                effectiveModulusPa: _round(effectiveModulusKPa * 1000, 2),
                gibsonAshbyModel: 'E_eff = E_bulk \u00d7 (1 - \u03c6)\u00b2',
                note: 'Approximate \u2014 actual stiffness depends on architecture, crosslinking, hydration'
            },
            transport: {
                permeabilityMm2: _round(permeabilityMm2, 8),
                kozenyCarmanModel: 'k = d\u00b2\u03b5\u00b3 / (180(1-\u03b5)\u00b2)',
                note: 'Intrinsic permeability estimate; actual flow depends on fluid viscosity'
            },
            printEstimates: {
                layerHeight: lh,
                numberOfLayers: numLayers,
                materialMassG: _round(massG, 4),
                materialVolumeMl: _round(solidVolumeMl, 4)
            }
        };
    }

    /**
     * Check whether a scaffold analysis meets tissue-specific engineering targets.
     *
     * Evaluates porosity, pore size, and effective modulus against published
     * ranges for the target tissue type. Returns a scored compatibility
     * assessment with actionable recommendations.
     *
     * @param {string} tissueType - Target tissue: 'bone', 'cartilage', 'skin', 'liver', 'vascular', or 'neural'.
     * @param {Object} analysisResult - Output from {@link analyze}.
     * @returns {Object} Compatibility report with overallScore ('Excellent'|'Acceptable'|'Marginal'|'Poor'),
     *   per-criterion pass/fail, and an array of recommendations.
     * @throws {Error} If tissueType is unknown or analysisResult is invalid.
     */
    function checkTissueCompatibility(tissueType, analysisResult) {
        if (!tissueType || !TISSUE_TARGETS[tissueType]) {
            throw new Error('Unknown tissue type. Options: ' + Object.keys(TISSUE_TARGETS).join(', '));
        }
        if (!analysisResult || !analysisResult.porosity) {
            throw new Error('analysisResult must be output from analyze()');
        }

        var target = TISSUE_TARGETS[tissueType];
        var porosity = analysisResult.porosity.fraction;
        var poreSizeUm = analysisResult.poreGeometry.targetPoreSizeUm;
        var modulusKPa = analysisResult.mechanical.effectiveModulusKPa;

        var porosityOk = porosity >= target.porosity[0] && porosity <= target.porosity[1];
        var poreOk = poreSizeUm >= target.poreUm[0] && poreSizeUm <= target.poreUm[1];
        var modulusOk = modulusKPa >= target.modulusKPa[0] && modulusKPa <= target.modulusKPa[1];

        var passCount = (porosityOk ? 1 : 0) + (poreOk ? 1 : 0) + (modulusOk ? 1 : 0);
        var score;
        if (passCount === 3) score = 'Excellent';
        else if (passCount === 2) score = 'Acceptable';
        else if (passCount === 1) score = 'Marginal';
        else score = 'Poor';

        var recs = [];
        if (porosity < target.porosity[0]) recs.push('Increase pore size or reduce strut width to raise porosity');
        else if (porosity > target.porosity[1]) recs.push('Increase strut width or reduce pore size to lower porosity');
        if (poreSizeUm < target.poreUm[0]) recs.push('Increase pore size for better cell infiltration in ' + tissueType + ' scaffolds');
        else if (poreSizeUm > target.poreUm[1]) recs.push('Decrease pore size \u2014 large pores may reduce cell bridging for ' + tissueType);
        if (modulusKPa < target.modulusKPa[0]) recs.push('Scaffold too soft \u2014 use stiffer material or reduce porosity');
        else if (modulusKPa > target.modulusKPa[1]) recs.push('Scaffold too stiff \u2014 consider softer material or higher porosity');
        if (recs.length === 0) recs.push('Parameters are well-suited for ' + tissueType + ' tissue engineering');

        return {
            tissueType: tissueType,
            overallScore: score,
            criteria: {
                porosity: { pass: porosityOk, actual: _round(porosity * 100, 2) + '%', target: (target.porosity[0] * 100) + '\u2013' + (target.porosity[1] * 100) + '%' },
                poreSize: { pass: poreOk, actual: poreSizeUm + ' \u00b5m', target: target.poreUm[0] + '\u2013' + target.poreUm[1] + ' \u00b5m' },
                modulus: { pass: modulusOk, actual: _round(modulusKPa, 2) + ' kPa', target: target.modulusKPa[0] + '\u2013' + target.modulusKPa[1] + ' kPa' }
            },
            recommendations: recs
        };
    }

    /**
     * Sweep a single parameter across a range and collect scaffold metrics.
     *
     * Useful for exploring how strut width or pore size affects porosity,
     * modulus, material volume, and surface area. Results can be plotted
     * to identify optimal parameter windows.
     *
     * @param {Object} params - Base scaffold parameters (same as {@link analyze}).
     * @param {string} sweepParam - Parameter to sweep: 'strutWidth' or 'poreSize'.
     * @param {number} min - Minimum value for the swept parameter.
     * @param {number} max - Maximum value (must be > min).
     * @param {number} [steps=10] - Number of evaluation points (2–100).
     * @returns {Object[]} Array of result objects with value, porosity, effectiveModulusKPa,
     *   solidVolumeMl, and surfaceAreaMm2 — or {value, error} if analysis fails at that point.
     * @throws {Error} If sweepParam is invalid or min ≥ max.
     */
    function parameterSweep(params, sweepParam, min, max, steps) {
        if (sweepParam !== 'strutWidth' && sweepParam !== 'poreSize') {
            throw new Error('sweepParam must be "strutWidth" or "poreSize"');
        }
        if (typeof min !== 'number' || typeof max !== 'number' || min >= max) {
            throw new Error('min must be less than max');
        }
        steps = steps || 10;
        if (steps < 2 || steps > 100) throw new Error('steps must be 2\u2013100');

        var results = [];
        var step = (max - min) / (steps - 1);
        for (var i = 0; i < steps; i++) {
            var val = _round(min + i * step, 4);
            var p = {};
            for (var k in params) { if (!_isDangerousKey(k)) p[k] = params[k]; }
            p.dimensions = { x: params.dimensions.x, y: params.dimensions.y, z: params.dimensions.z };
            p[sweepParam] = val;
            try {
                var result = analyze(p);
                results.push({
                    value: val, porosity: result.porosity.fraction, porosityPercent: result.porosity.percent,
                    effectiveModulusKPa: result.mechanical.effectiveModulusKPa,
                    solidVolumeMl: result.porosity.solidVolumeMl, surfaceAreaMm2: result.surface.estimatedSurfaceAreaMm2
                });
            } catch (e) {
                results.push({ value: val, error: e.message });
            }
        }
        return results;
    }

    /**
     * List all available architectures, material presets, and tissue targets.
     *
     * Returns structured metadata for building UIs (dropdowns, option lists)
     * without hard-coding values on the client side.
     *
     * @returns {Object} Object with architectures, materials, and tissueTargets arrays.
     */
    function getOptions() {
        return {
            architectures: Object.keys(ARCHITECTURES).map(function(k) {
                return { key: k, name: ARCHITECTURES[k].name, description: ARCHITECTURES[k].description };
            }),
            materials: Object.keys(MATERIAL_PRESETS).map(function(k) {
                return { key: k, name: MATERIAL_PRESETS[k].name, modulusKPa: MATERIAL_PRESETS[k].modulusKPa };
            }),
            tissueTargets: Object.keys(TISSUE_TARGETS).map(function(k) {
                var t = TISSUE_TARGETS[k];
                return { key: k, porosityRange: t.porosity, poreSizeUm: t.poreUm, modulusKPa: t.modulusKPa };
            })
        };
    }

    return { analyze: analyze, checkTissueCompatibility: checkTissueCompatibility, parameterSweep: parameterSweep, getOptions: getOptions };
}

module.exports = { createScaffoldCalculator: createScaffoldCalculator };
