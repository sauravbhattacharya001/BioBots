'use strict';

var validatePositive = require('./validation').validatePositive;

/**
 * Nozzle Selection Advisor for BioBots bioprinter.
 * Recommends optimal nozzle sizes based on material properties, target resolution,
 * and cell diameter constraints. Calculates flow rates, shear stress estimates,
 * and compatibility scores.
 */
function createNozzleAdvisor() {
    var NOZZLE_CATALOG = [
        { gauge: 14, innerDiameterMm: 1.600, color: 'olive',    type: 'blunt' },
        { gauge: 16, innerDiameterMm: 1.194, color: 'grey',     type: 'blunt' },
        { gauge: 18, innerDiameterMm: 0.838, color: 'green',    type: 'blunt' },
        { gauge: 20, innerDiameterMm: 0.603, color: 'pink',     type: 'blunt' },
        { gauge: 21, innerDiameterMm: 0.514, color: 'purple',   type: 'blunt' },
        { gauge: 22, innerDiameterMm: 0.413, color: 'blue',     type: 'blunt' },
        { gauge: 23, innerDiameterMm: 0.337, color: 'orange',   type: 'blunt' },
        { gauge: 25, innerDiameterMm: 0.260, color: 'red',      type: 'blunt' },
        { gauge: 27, innerDiameterMm: 0.210, color: 'clear',    type: 'blunt' },
        { gauge: 30, innerDiameterMm: 0.159, color: 'lavender', type: 'blunt' },
        { gauge: 32, innerDiameterMm: 0.108, color: 'green',    type: 'blunt' },
        // Tapered nozzles (lower shear stress for cell-laden bioinks)
        { gauge: 22, innerDiameterMm: 0.413, color: 'blue',     type: 'tapered' },
        { gauge: 25, innerDiameterMm: 0.260, color: 'red',      type: 'tapered' },
        { gauge: 27, innerDiameterMm: 0.210, color: 'clear',    type: 'tapered' }
    ];

    var MATERIAL_VISCOSITY = {
        'low':    { paS: 0.05,  label: 'Low (e.g., alginate 2%)' },
        'medium': { paS: 0.5,   label: 'Medium (e.g., GelMA 5%)' },
        'high':   { paS: 5.0,   label: 'High (e.g., collagen)' },
        'paste':  { paS: 50.0,  label: 'Paste (e.g., PCL, PLGA)' }
    };

    // Max shear stress thresholds (Pa) for cell viability
    var SHEAR_THRESHOLDS = {
        'fragile':    500,   // stem cells, primary neurons
        'moderate':  2000,   // most mammalian cells
        'robust':    5000,   // bacteria, yeast, cell-free
        'acellular': Infinity
    };

    /**
     * Estimate wall shear stress for Poiseuille flow in a cylindrical nozzle.
     * τ = (4 * η * Q) / (π * r³)
     * @param {number} viscosityPaS - Dynamic viscosity in Pa·s
     * @param {number} flowRateMm3s - Volumetric flow rate in mm³/s
     * @param {number} radiusMm - Inner radius of nozzle in mm
     * @param {string} nozzleType - 'blunt' or 'tapered'
     * @returns {number} Estimated wall shear stress in Pa
     */
    function estimateShearStress(viscosityPaS, flowRateMm3s, radiusMm, nozzleType) {
        if (radiusMm <= 0) return Infinity;
        var r_m = radiusMm / 1000;
        var Q_m3s = flowRateMm3s / 1e9;
        var tau = (4 * viscosityPaS * Q_m3s) / (Math.PI * Math.pow(r_m, 3));
        // Tapered nozzles reduce shear by ~40% due to gradual contraction
        if (nozzleType === 'tapered') {
            tau *= 0.6;
        }
        return Math.round(tau * 100) / 100;
    }

    /**
     * Calculate volumetric flow rate for a target print speed and line width.
     * Q = speed * lineWidth * layerHeight
     * @param {number} printSpeedMms - Print speed in mm/s
     * @param {number} lineWidthMm - Extruded line width in mm
     * @param {number} layerHeightMm - Layer height in mm
     * @returns {number} Flow rate in mm³/s
     */
    function calculateFlowRate(printSpeedMms, lineWidthMm, layerHeightMm) {
        return printSpeedMms * lineWidthMm * layerHeightMm;
    }

    /**
     * Score a nozzle for a given set of requirements.
     * Higher is better (0-100).
     */
    function scoreNozzle(nozzle, opts) {
        var score = 100;
        var issues = [];
        var warnings = [];

        var targetResolution = opts.targetResolutionMm || 0.4;
        var viscosity = opts.viscosity || 'medium';
        var cellDiameterUm = opts.cellDiameterUm || 0;
        var cellSensitivity = opts.cellSensitivity || 'moderate';
        var printSpeedMms = opts.printSpeedMms || 5;
        var layerHeightMm = opts.layerHeightMm || 0.2;

        var viscData = MATERIAL_VISCOSITY[viscosity] || MATERIAL_VISCOSITY['medium'];
        var d = nozzle.innerDiameterMm;

        // Resolution match: line width ≈ 1.0–1.2× nozzle diameter
        var expectedLineWidth = d * 1.1;
        var resolutionRatio = expectedLineWidth / targetResolution;
        if (resolutionRatio > 2.0) {
            score -= 30;
            issues.push('Nozzle too large for target resolution');
        } else if (resolutionRatio > 1.5) {
            score -= 15;
            warnings.push('Nozzle slightly large for target resolution');
        } else if (resolutionRatio < 0.5) {
            score -= 25;
            issues.push('Nozzle too small — may clog or require excessive pressure');
        } else if (resolutionRatio < 0.7) {
            score -= 10;
            warnings.push('Nozzle slightly small — higher pressures needed');
        }

        // Cell diameter constraint: nozzle ID should be ≥ 5× cell diameter
        if (cellDiameterUm > 0) {
            var cellDiameterMm = cellDiameterUm / 1000;
            var diameterRatio = d / cellDiameterMm;
            if (diameterRatio < 3) {
                score -= 40;
                issues.push('Nozzle too narrow for cell diameter — will damage/block cells');
            } else if (diameterRatio < 5) {
                score -= 15;
                warnings.push('Nozzle diameter borderline for cell passage (recommend ≥5× cell diameter)');
            }
        }

        // Shear stress check
        var flowRate = calculateFlowRate(printSpeedMms, expectedLineWidth, layerHeightMm);
        var shear = estimateShearStress(viscData.paS, flowRate, d / 2, nozzle.type);
        var threshold = SHEAR_THRESHOLDS[cellSensitivity] || SHEAR_THRESHOLDS['moderate'];
        if (shear > threshold) {
            score -= 35;
            issues.push('Shear stress (' + shear.toFixed(0) + ' Pa) exceeds ' + cellSensitivity + ' cell threshold (' + threshold + ' Pa)');
        } else if (shear > threshold * 0.7) {
            score -= 10;
            warnings.push('Shear stress approaching cell damage threshold');
        }

        // Viscosity-nozzle match
        if (viscosity === 'paste' && d < 0.3) {
            score -= 25;
            issues.push('Paste-viscosity materials need larger nozzles (≥0.3mm)');
        } else if (viscosity === 'low' && d > 1.0) {
            score -= 10;
            warnings.push('Low-viscosity material may spread excessively with large nozzle');
        }

        // Tapered nozzle bonus for cell-laden work
        if (nozzle.type === 'tapered' && cellDiameterUm > 0) {
            score += 5;
        }

        score = Math.max(0, Math.min(100, score));

        return {
            nozzle: {
                gauge: nozzle.gauge,
                innerDiameterMm: d,
                color: nozzle.color,
                type: nozzle.type
            },
            score: score,
            grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D',
            metrics: {
                expectedLineWidthMm: Math.round(expectedLineWidth * 1000) / 1000,
                flowRateMm3s: Math.round(flowRate * 1000) / 1000,
                estimatedShearStressPa: shear
            },
            issues: issues,
            warnings: warnings
        };
    }

    /**
     * Recommend nozzles for given requirements.
     * Returns all nozzles sorted by score, with the top recommendation highlighted.
     *
     * @param {Object} opts
     * @param {number} [opts.targetResolutionMm=0.4] - Desired line width / resolution in mm
     * @param {string} [opts.viscosity='medium'] - Material viscosity class: low|medium|high|paste
     * @param {number} [opts.cellDiameterUm=0] - Cell diameter in micrometers (0 for acellular)
     * @param {string} [opts.cellSensitivity='moderate'] - Cell fragility: fragile|moderate|robust|acellular
     * @param {number} [opts.printSpeedMms=5] - Target print speed in mm/s
     * @param {number} [opts.layerHeightMm=0.2] - Layer height in mm
     * @param {string} [opts.nozzleType] - Filter by nozzle type: 'blunt'|'tapered' (optional, shows all)
     * @returns {Object} Recommendation results
     */
    function recommend(opts) {
        opts = opts || {};

        if (opts.targetResolutionMm !== undefined) {
            validatePositive(opts.targetResolutionMm, 'targetResolutionMm');
        }
        if (opts.viscosity && !MATERIAL_VISCOSITY[opts.viscosity]) {
            throw new Error('Unknown viscosity class: ' + opts.viscosity + '. Use: low, medium, high, or paste');
        }
        if (opts.cellSensitivity && !SHEAR_THRESHOLDS[opts.cellSensitivity]) {
            throw new Error('Unknown cellSensitivity: ' + opts.cellSensitivity + '. Use: fragile, moderate, robust, or acellular');
        }

        var catalog = NOZZLE_CATALOG;
        if (opts.nozzleType) {
            catalog = catalog.filter(function(n) { return n.type === opts.nozzleType; });
        }

        var results = catalog.map(function(nozzle) {
            return scoreNozzle(nozzle, opts);
        });

        results.sort(function(a, b) { return b.score - a.score; });

        var top = results[0] || null;

        return {
            recommendation: top,
            alternatives: results.slice(1),
            parameters: {
                targetResolutionMm: opts.targetResolutionMm || 0.4,
                viscosity: opts.viscosity || 'medium',
                cellDiameterUm: opts.cellDiameterUm || 0,
                cellSensitivity: opts.cellSensitivity || 'moderate',
                printSpeedMms: opts.printSpeedMms || 5,
                layerHeightMm: opts.layerHeightMm || 0.2
            },
            totalEvaluated: results.length
        };
    }

    /**
     * Get the full nozzle catalog.
     * @returns {Array} Array of nozzle specs
     */
    function getCatalog() {
        return NOZZLE_CATALOG.map(function(n) {
            return {
                gauge: n.gauge,
                innerDiameterMm: n.innerDiameterMm,
                color: n.color,
                type: n.type
            };
        });
    }

    /**
     * Get supported viscosity classes.
     * @returns {Object} Viscosity class definitions
     */
    function getViscosityClasses() {
        var result = {};
        Object.keys(MATERIAL_VISCOSITY).forEach(function(k) {
            result[k] = { paS: MATERIAL_VISCOSITY[k].paS, label: MATERIAL_VISCOSITY[k].label };
        });
        return result;
    }

    /**
     * Get shear stress thresholds for cell sensitivity levels.
     * @returns {Object} Threshold definitions
     */
    function getShearThresholds() {
        var result = {};
        Object.keys(SHEAR_THRESHOLDS).forEach(function(k) {
            result[k] = SHEAR_THRESHOLDS[k];
        });
        return result;
    }

    /**
     * Quick lookup: find the closest nozzle gauge to a target diameter.
     * @param {number} targetDiameterMm - Desired inner diameter in mm
     * @param {string} [type] - Optional filter: 'blunt'|'tapered'
     * @returns {Object} Closest matching nozzle
     */
    function findClosestNozzle(targetDiameterMm, type) {
        validatePositive(targetDiameterMm, 'targetDiameterMm');
        var catalog = NOZZLE_CATALOG;
        if (type) {
            catalog = catalog.filter(function(n) { return n.type === type; });
        }
        var best = null;
        var bestDiff = Infinity;
        catalog.forEach(function(n) {
            var diff = Math.abs(n.innerDiameterMm - targetDiameterMm);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = n;
            }
        });
        return best ? {
            gauge: best.gauge,
            innerDiameterMm: best.innerDiameterMm,
            color: best.color,
            type: best.type,
            differenceFromTargetMm: Math.round(bestDiff * 1000) / 1000
        } : null;
    }

    return {
        recommend: recommend,
        getCatalog: getCatalog,
        getViscosityClasses: getViscosityClasses,
        getShearThresholds: getShearThresholds,
        findClosestNozzle: findClosestNozzle,
        estimateShearStress: estimateShearStress,
        calculateFlowRate: calculateFlowRate
    };
}

module.exports = {
    createNozzleAdvisor: createNozzleAdvisor
};
