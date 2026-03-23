'use strict';

/**
 * Bioink Mixing Calculator for BioBots.
 *
 * Blends multiple bioinks by volume fraction and computes composite
 * properties: density, cost, viscosity (log-mixing rule), cell
 * compatibility scores, and printability assessment.
 *
 * @example
 *   var mixer = createBioinkMixer();
 *   var result = mixer.mix([
 *     { material: 'alginate', fraction: 0.6 },
 *     { material: 'gelatin-methacrylate', fraction: 0.4 }
 *   ], { totalVolumeMl: 10 });
 */

function createBioinkMixer() {

    var MATERIALS = {
        'gelatin-methacrylate': {
            name: 'GelMA', density: 1.05, costPerMl: 12.50,
            viscosity: 850, cellAdhesion: 0.9, degradability: 0.7,
            crosslinkable: true, tempSensitive: true,
            printTemp: { min: 20, max: 37 },
            color: '#e74c3c'
        },
        'alginate': {
            name: 'Alginate', density: 1.02, costPerMl: 3.80,
            viscosity: 200, cellAdhesion: 0.3, degradability: 0.4,
            crosslinkable: true, tempSensitive: false,
            printTemp: { min: 18, max: 40 },
            color: '#2ecc71'
        },
        'collagen-type-1': {
            name: 'Collagen Type I', density: 1.08, costPerMl: 45.00,
            viscosity: 3200, cellAdhesion: 0.95, degradability: 0.85,
            crosslinkable: false, tempSensitive: true,
            printTemp: { min: 4, max: 25 },
            color: '#3498db'
        },
        'pluronic-f127': {
            name: 'Pluronic F-127', density: 1.06, costPerMl: 8.20,
            viscosity: 1500, cellAdhesion: 0.15, degradability: 0.1,
            crosslinkable: false, tempSensitive: true,
            printTemp: { min: 20, max: 37 },
            color: '#9b59b6'
        },
        'hyaluronic-acid': {
            name: 'Hyaluronic Acid', density: 1.03, costPerMl: 28.00,
            viscosity: 600, cellAdhesion: 0.7, degradability: 0.6,
            crosslinkable: true, tempSensitive: false,
            printTemp: { min: 18, max: 37 },
            color: '#f39c12'
        },
        'fibrin': {
            name: 'Fibrin', density: 1.04, costPerMl: 35.00,
            viscosity: 150, cellAdhesion: 0.85, degradability: 0.9,
            crosslinkable: false, tempSensitive: true,
            printTemp: { min: 20, max: 37 },
            color: '#e67e22'
        },
        'silk-fibroin': {
            name: 'Silk Fibroin', density: 1.10, costPerMl: 22.00,
            viscosity: 1100, cellAdhesion: 0.6, degradability: 0.3,
            crosslinkable: true, tempSensitive: false,
            printTemp: { min: 18, max: 40 },
            color: '#1abc9c'
        },
        'pectin': {
            name: 'Pectin', density: 1.01, costPerMl: 2.50,
            viscosity: 350, cellAdhesion: 0.25, degradability: 0.5,
            crosslinkable: true, tempSensitive: false,
            printTemp: { min: 18, max: 45 },
            color: '#95a5a6'
        }
    };

    // Known compatibility modifiers between material pairs.
    // Values > 1 mean synergistic, < 1 means antagonistic.
    var COMPATIBILITY = {
        'alginate+gelatin-methacrylate': 1.2,
        'alginate+collagen-type-1': 1.1,
        'alginate+hyaluronic-acid': 1.15,
        'gelatin-methacrylate+hyaluronic-acid': 1.25,
        'collagen-type-1+fibrin': 1.3,
        'alginate+pluronic-f127': 0.85,
        'collagen-type-1+pluronic-f127': 0.7,
        'silk-fibroin+gelatin-methacrylate': 1.1,
        'pectin+alginate': 1.15
    };

    function getMaterials() {
        var result = {};
        for (var key in MATERIALS) {
            if (MATERIALS.hasOwnProperty(key)) {
                result[key] = Object.assign({}, MATERIALS[key]);
            }
        }
        return result;
    }

    function _compatKey(a, b) {
        var sorted = [a, b].sort();
        return sorted[0] + '+' + sorted[1];
    }

    /**
     * Compute the compatibility score for a blend.
     * Averages pairwise compatibility factors weighted by
     * the product of the two components' fractions.
     */
    function computeCompatibility(components) {
        if (components.length < 2) return { score: 1.0, pairs: [] };
        var pairs = [];
        var totalWeight = 0;
        var weightedSum = 0;
        for (var i = 0; i < components.length; i++) {
            for (var j = i + 1; j < components.length; j++) {
                var key = _compatKey(components[i].material, components[j].material);
                var factor = COMPATIBILITY[key] || 1.0;
                var weight = components[i].fraction * components[j].fraction;
                weightedSum += factor * weight;
                totalWeight += weight;
                pairs.push({
                    a: components[i].material,
                    b: components[j].material,
                    factor: factor,
                    synergy: factor > 1 ? 'synergistic' : factor < 1 ? 'antagonistic' : 'neutral'
                });
            }
        }
        return {
            score: totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : 1.0,
            pairs: pairs
        };
    }

    /**
     * Compute overlapping print temperature range.
     */
    function computeTempRange(components) {
        var minTemp = -Infinity;
        var maxTemp = Infinity;
        for (var i = 0; i < components.length; i++) {
            var mat = MATERIALS[components[i].material];
            if (mat && mat.printTemp) {
                if (mat.printTemp.min > minTemp) minTemp = mat.printTemp.min;
                if (mat.printTemp.max < maxTemp) maxTemp = mat.printTemp.max;
            }
        }
        if (minTemp > maxTemp) {
            return { feasible: false, min: minTemp, max: maxTemp, warning: 'No overlapping temperature range!' };
        }
        return { feasible: true, min: minTemp, max: maxTemp };
    }

    /**
     * Assess printability based on composite viscosity.
     * Returns a rating and nozzle gauge recommendation.
     */
    function assessPrintability(viscosity) {
        var rating, recommendation;
        if (viscosity < 100) {
            rating = 'poor';
            recommendation = 'Too runny — consider adding a thickener or higher-viscosity component.';
        } else if (viscosity < 300) {
            rating = 'acceptable';
            recommendation = 'Use fine nozzle (27-30G). Print at lower pressure.';
        } else if (viscosity < 1000) {
            rating = 'good';
            recommendation = 'Standard nozzle (22-25G). Good extrusion characteristics.';
        } else if (viscosity < 2500) {
            rating = 'good';
            recommendation = 'Use wider nozzle (18-22G). May need higher pressure.';
        } else {
            rating = 'challenging';
            recommendation = 'Very viscous — use large bore nozzle (16-18G) or raise temperature.';
        }
        return { rating: rating, viscosity: Math.round(viscosity), recommendation: recommendation };
    }

    /**
     * Mix bioinks and compute composite properties.
     *
     * @param {Array} components - Array of {material: string, fraction: number}
     *   Fractions must sum to 1.0 (±0.01 tolerance).
     * @param {Object} [options] - Optional parameters
     * @param {number} [options.totalVolumeMl=1] - Total blend volume in mL
     * @returns {Object} Composite blend report
     */
    function mix(components, options) {
        if (!Array.isArray(components) || components.length === 0) {
            throw new Error('Components must be a non-empty array');
        }

        var opts = options || {};
        var totalVolumeMl = opts.totalVolumeMl || 1;
        if (totalVolumeMl <= 0) throw new Error('Total volume must be positive');

        // Validate fractions
        var fractionSum = 0;
        for (var vi = 0; vi < components.length; vi++) {
            var vc = components[vi];
            if (!vc.material || !MATERIALS[vc.material]) {
                throw new Error('Unknown material at index ' + vi + ': ' + vc.material);
            }
            if (typeof vc.fraction !== 'number' || vc.fraction <= 0 || vc.fraction > 1) {
                throw new Error('Fraction at index ' + vi + ' must be between 0 and 1');
            }
            fractionSum += vc.fraction;
        }
        if (Math.abs(fractionSum - 1.0) > 0.01) {
            throw new Error('Fractions must sum to 1.0 (got ' + fractionSum.toFixed(3) + ')');
        }

        // Composite properties — single pass over components.
        // Previous implementation iterated 5 times (density, cost, viscosity,
        // cellAdhesion, degradability). Consolidating into one loop avoids
        // redundant iteration and repeated MATERIALS lookups.
        var density = 0;
        var costPerMl = 0;
        var logVisc = 0;
        var cellAdhesion = 0;
        var degradability = 0;

        for (var ci = 0; ci < components.length; ci++) {
            var comp = components[ci];
            var mat = MATERIALS[comp.material];
            var f = comp.fraction;
            density += f * mat.density;
            costPerMl += f * mat.costPerMl;
            logVisc += f * Math.log(mat.viscosity);
            cellAdhesion += f * mat.cellAdhesion;
            degradability += f * mat.degradability;
        }
        var viscosity = Math.exp(logVisc);

        var compatibility = computeCompatibility(components);
        var tempRange = computeTempRange(components);
        var printability = assessPrintability(viscosity);

        // Per-component breakdown
        var breakdown = components.map(function(c) {
            var mat = MATERIALS[c.material];
            return {
                material: c.material,
                name: mat.name,
                fraction: c.fraction,
                volumeMl: Math.round(c.fraction * totalVolumeMl * 1000) / 1000,
                costContribution: Math.round(c.fraction * mat.costPerMl * totalVolumeMl * 100) / 100,
                color: mat.color
            };
        });

        return {
            composite: {
                density: Math.round(density * 1000) / 1000,
                costPerMl: Math.round(costPerMl * 100) / 100,
                totalCost: Math.round(costPerMl * totalVolumeMl * 100) / 100,
                viscosity: Math.round(viscosity),
                cellAdhesion: Math.round(cellAdhesion * 100) / 100,
                degradability: Math.round(degradability * 100) / 100
            },
            printability: printability,
            compatibility: compatibility,
            temperatureRange: tempRange,
            totalVolumeMl: totalVolumeMl,
            breakdown: breakdown
        };
    }

    return {
        mix: mix,
        getMaterials: getMaterials,
        computeCompatibility: computeCompatibility,
        computeTempRange: computeTempRange,
        assessPrintability: assessPrintability
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createBioinkMixer: createBioinkMixer };
}
