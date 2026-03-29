'use strict';

var _stripDangerous = require('./sanitize').stripDangerousKeys;
var _sharedMaterials = require('./materials');
var _v = require('./validation');
var round = _v.round;
var clamp = _v.clamp;

/**
 * Print Job Estimator for BioBots
 *
 * Unified print planning module that produces comprehensive job estimates
 * from high-level specifications. Combines geometry, material, timing,
 * viability, and cost projections into a single actionable report.
 *
 * Features:
 *   - Time estimation (per-layer, total, with calibration/cleanup overhead)
 *   - Material consumption with waste factor
 *   - Cell seeding density and expected yield after printing
 *   - Viability prediction using stress models
 *   - Cost breakdown (material, cells, time, consumables)
 *   - Multi-job batch planning with shared setup costs
 *   - Risk assessment with go/no-go recommendation
 *   - Comparison of parameter alternatives
 *
 * Usage:
 *   const estimator = require('./jobEstimator');
 *   const planner = estimator.createJobEstimator();
 *   const estimate = planner.estimate({
 *     geometry: { type: 'wellplate', wellplate: 24, layers: 10, layerHeight: 0.2 },
 *     material: 'alginate',
 *     cells: { type: 'HEK293', density: 1e6, volumeMl: 2 },
 *     environment: { temperature: 25, humidity: 80 }
 *   });
 */

// ── Constants ──────────────────────────────────────────────────

// Material, cell, and wellplate profiles imported from shared module.
// Domain-specific extensions (printSpeedFactor) are merged in below.
var _baseMaterials = _sharedMaterials.MATERIAL_PROFILES;
var CELL_PROFILES = _sharedMaterials.CELL_PROFILES;
var WELLPLATE_SPECS = _sharedMaterials.WELLPLATE_SPECS;

// Extend base material profiles with job-estimation-specific fields.
var PRINT_SPEED_FACTORS = {
    'gelatin-methacrylate': 1.0,
    'alginate':             1.2,
    'collagen-type-1':      0.7,
    'pluronic-f127':        1.0,
    'pcl':                  0.6,
    'hyaluronic-acid':      1.1,
    'fibrin':               1.15,
    'silk-fibroin':         0.9
};

var MATERIAL_PROFILES = {};
var _matKeys = Object.keys(_baseMaterials);
for (var _mk = 0; _mk < _matKeys.length; _mk++) {
    var _key = _matKeys[_mk];
    MATERIAL_PROFILES[_key] = Object.assign({}, _baseMaterials[_key], {
        printSpeedFactor: PRINT_SPEED_FACTORS[_key] || 1.0
    });
}

var RISK_THRESHOLDS = {
    viability: { critical: 0.5, warning: 0.7, good: 0.85 },
    duration:  { critical: 180, warning: 120, good: 60 },    // minutes
    cost:      { critical: 5000, warning: 2000, good: 500 },  // dollars
    waste:     { critical: 0.35, warning: 0.20, good: 0.10 }
};

var DEFAULT_TIMING = {
    calibrationMin: 15,
    layerSettleSeconds: 10,
    cleanupMin: 10,
    crosslinkSecondsPerLayer: 30,
    basePrintSpeedMmPerSec: 5
};

// ── Helpers ────────────────────────────────────────────────────

function isPositive(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

/**
 * Parse infill from geometry spec (0.05-1.0, default 100%).
 */
function parseInfill(geo) {
    var pct = (geo.infillPercent != null ? geo.infillPercent : 100) / 100;
    return clamp(pct, 0.05, 1);
}

/**
 * Set volumeUl and volumeMl on a geometry result from volumeMm3.
 * 1 mm³ = 1 µL.
 */
function applyVolumeUnits(result) {
    result.volumeUl = round(result.volumeMm3, 2);
    result.volumeMl = round(result.volumeUl / 1000, 4);
    return result;
}

function getMaterial(key) {
    if (!key) return null;
    var k = String(key).toLowerCase().replace(/\s+/g, '-');
    return MATERIAL_PROFILES[k] || null;
}

function getCellProfile(key) {
    if (!key) return null;
    var k = String(key);
    return CELL_PROFILES[k] || CELL_PROFILES[k.toUpperCase()] || null;
}

// ── Factory ────────────────────────────────────────────────────

function createJobEstimator(options) {
    var opts = options || {};
    var timingDefaults = Object.assign({}, DEFAULT_TIMING, _stripDangerous(opts.timing || {}));

    /**
     * Estimate geometry volumes.
     */
    function estimateGeometry(geo) {
        if (!geo || typeof geo !== 'object') throw new Error('geometry is required');

        var result = { type: 'custom', areaMm2: 0, volumeMm3: 0, volumeUl: 0, volumeMl: 0, layers: 1, units: 1 };

        if (geo.type === 'wellplate') {
            var spec = WELLPLATE_SPECS[geo.wellplate];
            if (!spec) throw new Error('Invalid wellplate: ' + geo.wellplate + '. Use 6, 12, 24, 48, or 96.');
            var layers = geo.layers || 1;
            var lh = geo.layerHeight || 0.2;
            if (layers < 1 || layers > 500) throw new Error('layers must be 1-500');
            if (lh <= 0 || lh > 5) throw new Error('layerHeight must be 0-5 mm');

            var wellCount = geo.wellCount || spec.wells;
            wellCount = Math.min(wellCount, spec.wells);

            var volPerWellMm3 = spec.areaMm2 * lh * layers;
            var infill = parseInfill(geo);
            volPerWellMm3 *= infill;

            result.type = 'wellplate';
            result.wellplate = geo.wellplate;
            result.wellCount = wellCount;
            result.areaMm2 = spec.areaMm2;
            result.layers = layers;
            result.layerHeight = lh;
            result.infill = infill;
            result.volumePerWellMm3 = round(volPerWellMm3, 3);
            result.volumeMm3 = round(volPerWellMm3 * wellCount, 3);
            applyVolumeUnits(result);
            result.units = wellCount;
        } else if (geo.type === 'cylinder') {
            var r = geo.radiusMm || geo.diameterMm / 2;
            var h = geo.heightMm;
            if (!isPositive(r) || !isPositive(h)) throw new Error('cylinder needs radiusMm/diameterMm and heightMm');
            var layers = geo.layers || Math.ceil(h / (geo.layerHeight || 0.2));
            var vol = Math.PI * r * r * h;
            var infill = parseInfill(geo);
            vol *= infill;

            result.type = 'cylinder';
            result.radiusMm = r;
            result.heightMm = h;
            result.layers = layers;
            result.infill = infill;
            result.areaMm2 = round(Math.PI * r * r, 2);
            result.volumeMm3 = round(vol, 3);
            applyVolumeUnits(result);
        } else if (geo.type === 'cuboid') {
            var w = geo.widthMm, l = geo.lengthMm, h = geo.heightMm;
            if (!isPositive(w) || !isPositive(l) || !isPositive(h)) throw new Error('cuboid needs widthMm, lengthMm, heightMm');
            var layers = geo.layers || Math.ceil(h / (geo.layerHeight || 0.2));
            var vol = w * l * h;
            var infill = parseInfill(geo);
            vol *= infill;

            result.type = 'cuboid';
            result.widthMm = w;
            result.lengthMm = l;
            result.heightMm = h;
            result.layers = layers;
            result.infill = infill;
            result.areaMm2 = round(w * l, 2);
            result.volumeMm3 = round(vol, 3);
            applyVolumeUnits(result);
        } else if (geo.type === 'custom' && isPositive(geo.volumeMl)) {
            result.type = 'custom';
            result.volumeMl = geo.volumeMl;
            result.volumeUl = round(geo.volumeMl * 1000, 2);
            result.volumeMm3 = result.volumeUl;
            result.layers = geo.layers || 1;
        } else {
            throw new Error('geometry.type must be wellplate, cylinder, cuboid, or custom (with volumeMl)');
        }

        return result;
    }

    /**
     * Estimate material costs and consumption.
     */
    function estimateMaterial(geometry, materialKey, wastePercent) {
        var mat = getMaterial(materialKey);
        if (!mat) throw new Error('Unknown material: ' + materialKey + '. Available: ' + Object.keys(MATERIAL_PROFILES).join(', '));

        var waste = (wastePercent != null ? wastePercent : 15) / 100;
        waste = clamp(waste, 0, 0.5);

        var netMl = geometry.volumeMl;
        var grossMl = netMl * (1 + waste);
        var massG = grossMl * mat.density;
        var cost = grossMl * mat.costPerMl;

        return {
            material: mat.name,
            materialKey: materialKey,
            netVolumeMl: round(netMl, 4),
            wastePercent: round(waste * 100, 1),
            grossVolumeMl: round(grossMl, 4),
            massG: round(massG, 3),
            costPerMl: mat.costPerMl,
            materialCost: round(cost, 2)
        };
    }

    /**
     * Estimate timing.
     */
    function estimateTiming(geometry, materialKey, env) {
        var mat = getMaterial(materialKey) || { printSpeedFactor: 1.0 };
        var timing = Object.assign({}, timingDefaults);

        var speedMmPerSec = timing.basePrintSpeedMmPerSec * mat.printSpeedFactor;

        // Temperature affects print speed (viscosity changes)
        var temp = (env && env.temperature) || 25;
        if (temp < 20) speedMmPerSec *= 0.8;
        else if (temp > 30) speedMmPerSec *= 1.1;

        // Estimate travel distance: approximate as perimeter * infill passes per layer
        var perimeterMm = geometry.areaMm2 ? Math.sqrt(geometry.areaMm2) * 4 : 40;
        var infill = geometry.infill || 1;
        var passesPerLayer = Math.ceil(Math.sqrt(geometry.areaMm2 || 100) / 0.4 * infill); // ~0.4mm line width
        var travelPerLayerMm = perimeterMm + passesPerLayer * Math.sqrt(geometry.areaMm2 || 100);

        var printTimePerLayerSec = travelPerLayerMm / speedMmPerSec;
        var units = geometry.units || 1;
        var layers = geometry.layers || 1;

        var totalPrintSec = printTimePerLayerSec * layers * units;
        var totalSettleSec = timing.layerSettleSeconds * layers * units;
        var totalCrosslinkSec = timing.crosslinkSecondsPerLayer * layers * units;
        var overheadMin = timing.calibrationMin + timing.cleanupMin;

        var totalMin = (totalPrintSec + totalSettleSec + totalCrosslinkSec) / 60 + overheadMin;

        return {
            printSpeedMmPerSec: round(speedMmPerSec, 2),
            printTimePerLayerSec: round(printTimePerLayerSec, 1),
            totalPrintMin: round(totalPrintSec / 60, 1),
            settleTimeMin: round(totalSettleSec / 60, 1),
            crosslinkTimeMin: round(totalCrosslinkSec / 60, 1),
            calibrationMin: timing.calibrationMin,
            cleanupMin: timing.cleanupMin,
            totalMin: round(totalMin, 1),
            totalHours: round(totalMin / 60, 2)
        };
    }

    /**
     * Estimate cell viability and yield.
     */
    function estimateCells(geometry, materialKey, cellSpec, timing, env) {
        if (!cellSpec) return null;

        var profile = getCellProfile(cellSpec.type);
        if (!profile && cellSpec.type) {
            profile = { name: cellSpec.type, viabilityBase: 0.90, costPer1M: 200, shearSensitivity: 1.0 };
        }
        if (!profile) return null;

        var density = cellSpec.density || 1e6;  // cells per mL
        var volumeMl = geometry.volumeMl;
        var totalCells = density * volumeMl;

        // Viability factors
        var baseViability = profile.viabilityBase;

        // Shear damage (increases with viscosity and sensitivity)
        var mat = getMaterial(materialKey) || {};
        var viscosityPenalty = mat.viscosity === 'high' ? 0.08 : mat.viscosity === 'medium' ? 0.04 : 0.02;
        var shearDamage = viscosityPenalty * profile.shearSensitivity;

        // Duration damage (longer prints = more cells outside incubator)
        var printMin = timing.totalMin || 30;
        var durationDamage = Math.min(0.2, printMin / 600); // max 20% loss at 10 hours

        // Temperature damage
        var temp = (env && env.temperature) || 25;
        var tempDev = Math.abs(temp - 37);
        var tempDamage = Math.min(0.15, tempDev * tempDev * 0.001);

        var finalViability = baseViability * (1 - shearDamage) * (1 - durationDamage) * (1 - tempDamage);
        finalViability = clamp(finalViability, 0, 1);

        var viableCells = totalCells * finalViability;
        var cellCost = (totalCells / 1e6) * profile.costPer1M;

        return {
            cellType: profile.name,
            seedingDensity: density,
            totalCellsSeeded: Math.round(totalCells),
            viabilityFactors: {
                baseline: round(baseViability, 3),
                shearDamage: round(shearDamage, 3),
                durationDamage: round(durationDamage, 3),
                temperatureDamage: round(tempDamage, 3)
            },
            predictedViability: round(finalViability, 3),
            viableCells: Math.round(viableCells),
            cellCost: round(cellCost, 2)
        };
    }

    /**
     * Assess overall risk.
     */
    function assessRisk(viability, timing, materialEst) {
        var risks = [];
        var score = 0; // 0 = great, higher = worse

        // Viability risk
        var v = viability ? viability.predictedViability : 1;
        if (v < RISK_THRESHOLDS.viability.critical) {
            risks.push({ factor: 'viability', level: 'critical', message: 'Predicted viability below ' + (RISK_THRESHOLDS.viability.critical * 100) + '%' });
            score += 3;
        } else if (v < RISK_THRESHOLDS.viability.warning) {
            risks.push({ factor: 'viability', level: 'warning', message: 'Predicted viability below ' + (RISK_THRESHOLDS.viability.warning * 100) + '% — consider optimizing parameters' });
            score += 1;
        }

        // Duration risk
        if (timing.totalMin > RISK_THRESHOLDS.duration.critical) {
            risks.push({ factor: 'duration', level: 'critical', message: 'Print time exceeds ' + RISK_THRESHOLDS.duration.critical + ' minutes — cell viability will suffer' });
            score += 3;
        } else if (timing.totalMin > RISK_THRESHOLDS.duration.warning) {
            risks.push({ factor: 'duration', level: 'warning', message: 'Print time over ' + RISK_THRESHOLDS.duration.warning + ' minutes — monitor cell health' });
            score += 1;
        }

        // Cost risk
        var totalCost = materialEst.materialCost + (viability ? viability.cellCost : 0);
        if (totalCost > RISK_THRESHOLDS.cost.critical) {
            risks.push({ factor: 'cost', level: 'warning', message: 'Total cost exceeds $' + RISK_THRESHOLDS.cost.critical + ' — verify parameters before printing' });
            score += 1;
        }

        var recommendation;
        if (score >= 4) recommendation = 'NO-GO';
        else if (score >= 2) recommendation = 'CAUTION';
        else recommendation = 'GO';

        return {
            recommendation: recommendation,
            riskScore: score,
            risks: risks,
            totalEstimatedCost: round(totalCost, 2)
        };
    }

    /**
     * Produce a full job estimate.
     *
     * @param {Object} params Job parameters
     * @param {Object} params.geometry Geometry specification (type: wellplate|cylinder|cuboid|custom)
     * @param {string} params.material Material key (e.g. 'alginate')
     * @param {Object} [params.cells] Cell specification { type, density }
     * @param {Object} [params.environment] Environment { temperature, humidity }
     * @param {number} [params.wastePercent=15] Expected waste percentage
     * @returns {Object} Comprehensive job estimate
     */
    function estimate(params) {
        if (!params || typeof params !== 'object') throw new Error('params must be an object');
        if (!params.geometry) throw new Error('params.geometry is required');
        if (!params.material) throw new Error('params.material is required');

        var geo = estimateGeometry(params.geometry);
        var mat = estimateMaterial(geo, params.material, params.wastePercent);
        var timing = estimateTiming(geo, params.material, params.environment);
        var cells = estimateCells(geo, params.material, params.cells, timing, params.environment);
        var risk = assessRisk(cells, timing, mat);

        return {
            summary: {
                recommendation: risk.recommendation,
                totalVolumeMl: geo.volumeMl,
                totalTimeMin: timing.totalMin,
                totalCost: risk.totalEstimatedCost,
                viability: cells ? cells.predictedViability : null
            },
            geometry: geo,
            material: mat,
            timing: timing,
            cells: cells,
            risk: risk,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Compare multiple parameter sets side-by-side.
     *
     * @param {Array<Object>} paramSets Array of estimate param objects
     * @returns {Object} Comparison with ranked alternatives
     */
    function compare(paramSets) {
        if (!Array.isArray(paramSets) || paramSets.length < 2) {
            throw new Error('compare requires an array of at least 2 parameter sets');
        }

        var estimates = paramSets.map(function(p, i) {
            try {
                var est = estimate(p);
                est._index = i;
                return est;
            } catch (e) {
                return { _index: i, error: e.message };
            }
        });

        var valid = estimates.filter(function(e) { return !e.error; });

        // Rank by: GO > CAUTION > NO-GO, then by cost, then by viability
        var rankOrder = { 'GO': 0, 'CAUTION': 1, 'NO-GO': 2 };
        valid.sort(function(a, b) {
            var ra = rankOrder[a.summary.recommendation] || 9;
            var rb = rankOrder[b.summary.recommendation] || 9;
            if (ra !== rb) return ra - rb;
            if (a.summary.totalCost !== b.summary.totalCost) return a.summary.totalCost - b.summary.totalCost;
            return (b.summary.viability || 0) - (a.summary.viability || 0);
        });

        return {
            estimates: estimates,
            ranking: valid.map(function(e) { return e._index; }),
            best: valid.length > 0 ? valid[0]._index : null
        };
    }

    /**
     * Plan a batch of jobs with shared setup costs.
     *
     * @param {Array<Object>} jobs Array of job param objects
     * @returns {Object} Batch plan with individual + aggregate estimates
     */
    function batchPlan(jobs) {
        if (!Array.isArray(jobs) || jobs.length === 0) {
            throw new Error('batchPlan requires a non-empty array of jobs');
        }

        var estimates = [];
        var totalCost = 0;
        var totalTimeMin = 0;
        var totalVolumeMl = 0;
        var warnings = [];

        // Shared calibration: only charge once
        var sharedCalibrationMin = timingDefaults.calibrationMin;

        jobs.forEach(function(job, i) {
            try {
                var est = estimate(job);
                // Track actual timing contribution: deduct shared calibration
                // for jobs after the first, but do NOT mutate the original estimate.
                var adjustedMin = est.timing.totalMin;
                if (i > 0) {
                    adjustedMin -= sharedCalibrationMin;
                }
                estimates.push(est);
                totalCost += est.risk.totalEstimatedCost;
                totalTimeMin += adjustedMin;
                totalVolumeMl += est.geometry.volumeMl;
                if (est.risk.recommendation === 'NO-GO') {
                    warnings.push('Job ' + (i + 1) + ': NO-GO recommendation');
                }
            } catch (e) {
                estimates.push({ error: e.message, jobIndex: i });
                warnings.push('Job ' + (i + 1) + ': ' + e.message);
            }
        });

        return {
            jobCount: jobs.length,
            estimates: estimates,
            aggregate: {
                totalCost: round(totalCost, 2),
                totalTimeMin: round(totalTimeMin, 1),
                totalTimeHours: round(totalTimeMin / 60, 2),
                totalVolumeMl: round(totalVolumeMl, 4),
                sharedCalibrationSavingsMin: round(sharedCalibrationMin * (jobs.length - 1), 1)
            },
            warnings: warnings
        };
    }

    // Public API
    return {
        estimate: estimate,
        compare: compare,
        batchPlan: batchPlan,
        getMaterials: function() { return Object.keys(MATERIAL_PROFILES); },
        getCellTypes: function() { return Object.keys(CELL_PROFILES); },
        getWellplates: function() { return Object.keys(WELLPLATE_SPECS).map(Number); }
    };
}

module.exports = {
    createJobEstimator: createJobEstimator
};
