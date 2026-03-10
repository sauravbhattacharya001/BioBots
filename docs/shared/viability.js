'use strict';

/**
 * Cell Viability Estimator for BioBots
 *
 * Predicts cell survival through the bioprinting process by modeling
 * multiple stressors that affect encapsulated cells:
 *
 *   - Shear stress damage (extrusion through nozzle)
 *   - Cross-linking cytotoxicity (UV/radical exposure)
 *   - Pressure-induced cell lysis
 *   - Thermal damage (deviations from 37°C)
 *   - Print duration effects (time outside incubator)
 *
 * Models are based on published bioprinting literature:
 *   - Shear: exponential decay  S(γ) = exp(-α · (γ/γ_crit)^β)
 *   - UV:    Hill-type damage    U(d) = 1 - d^n / (EC50^n + d^n)
 *   - Pressure: logistic decay  P(p) = 1 / (1 + exp(k·(p - p_50)))
 *   - Thermal: Gaussian          T(t) = exp(-(t-37)²/(2σ²))
 *   - Duration: linear decay    D(t) = max(0, 1 - λ·t)
 *
 * Combines stressors multiplicatively (independent damage assumption):
 *   V_total = V_baseline · S · U · P · T · D
 *
 * Usage:
 *   const estimator = createViabilityEstimator();
 *   const result = estimator.estimate({ pressure: 80, ... });
 *   const optimal = estimator.findOptimalWindow(printData);
 */
function createViabilityEstimator() {

    // ── Default Model Parameters ────────────────────────────────

    /** Default parameters for each damage model. */
    const DEFAULT_PARAMS = Object.freeze({
        baseline: 0.95,          // Max achievable viability (accounts for handling losses)

        // Shear stress model: S(γ) = exp(-alpha * (gamma / gammaCrit)^beta)
        shear: Object.freeze({
            alpha: 0.5,          // Damage scaling factor
            beta: 2.0,           // Damage exponent (superlinear)
            gammaCrit: 500,      // Critical shear rate (1/s)
        }),

        // Pressure model: P(p) = 1 / (1 + exp(k * (p - p50)))
        pressure: Object.freeze({
            k: 0.04,             // Steepness of transition
            p50: 150,            // Pressure at 50% survival (kPa)
        }),

        // Cross-linking UV model: U(dose) = 1 - dose^n / (EC50^n + dose^n)
        crosslink: Object.freeze({
            n: 2.0,              // Hill coefficient
            ec50: 15000,         // Dose at 50% damage (ms * intensity)
        }),

        // Thermal model: T(temp) = exp(-(temp - 37)^2 / (2 * sigma^2))
        thermal: Object.freeze({
            optimal: 37,         // Optimal temperature (°C)
            sigma: 5,            // Width of viable range (°C)
        }),

        // Duration model: D(t) = max(0, 1 - lambda * t)
        duration: Object.freeze({
            lambda: 0.001,       // Decay rate per second outside incubator
            maxTime: 1000,       // Time (s) at which viability reaches 0
        }),
    });

    // ── Input Validation ────────────────────────────────────────

    /**
     * Validate and normalize print parameters.
     * @param {Object} params - Print parameters
     * @returns {Object} Validated parameters with defaults applied
     */
    function _validateParams(params) {
        if (!params || typeof params !== 'object') {
            throw new Error('Print parameters must be a non-null object');
        }
        return {
            pressure: _requireNumber(params.pressure, 'pressure', 0),
            crosslinkDuration: _requireNumber(params.crosslinkDuration || 0, 'crosslinkDuration', 0),
            crosslinkIntensity: _requireNumber(params.crosslinkIntensity || 0, 'crosslinkIntensity', 0, 100),
            layerHeight: _requireNumber(params.layerHeight || 0.4, 'layerHeight', 0.01, 10),
            nozzleDiameter: _requireNumber(params.nozzleDiameter || 0.4, 'nozzleDiameter', 0.05, 5),
            temperature: params.temperature != null
                ? _requireNumber(params.temperature, 'temperature', 0, 60) : null,
            printDuration: params.printDuration != null
                ? _requireNumber(params.printDuration, 'printDuration', 0) : null,
            flowRate: params.flowRate != null
                ? _requireNumber(params.flowRate, 'flowRate', 0) : null,
        };
    }

    /**
     * Validate a single numeric parameter.
     * @param {*} value - Value to check
     * @param {string} name - Parameter name for error messages
     * @param {number} [min] - Minimum allowed value
     * @param {number} [max] - Maximum allowed value
     * @returns {number} The validated number
     */
    function _requireNumber(value, name, min, max) {
        if (typeof value !== 'number' || !isFinite(value)) {
            throw new Error(name + ' must be a finite number, got: ' + value);
        }
        if (min !== undefined && value < min) {
            throw new Error(name + ' must be >= ' + min + ', got: ' + value);
        }
        if (max !== undefined && value > max) {
            throw new Error(name + ' must be <= ' + max + ', got: ' + value);
        }
        return value;
    }

    // ── Individual Damage Models ────────────────────────────────

    /**
     * Estimate shear rate from nozzle geometry and flow parameters.
     *
     * Uses the Weissenberg-Rabinowitsch corrected wall shear rate for
     * a cylindrical nozzle: γ_w = (3n+1)/(4n) · (32Q)/(π·D³)
     *
     * When flow rate is not provided, estimates it from pressure using
     * a simplified Hagen-Poiseuille relationship.
     *
     * @param {Object} params - Validated print parameters
     * @returns {number} Estimated shear rate (1/s)
     */
    function estimateShearRate(params) {
        const D = params.nozzleDiameter / 1000;  // mm → m
        const R = D / 2;

        if (params.flowRate != null && params.flowRate > 0) {
            // Direct flow rate: Q in mm³/s → m³/s
            const Q = params.flowRate * 1e-9;
            const gammaApp = (32 * Q) / (Math.PI * Math.pow(D, 3));
            // Rabinowitsch correction for n=0.5 (typical shear-thinning bioink)
            const n = 0.5;
            return ((3 * n + 1) / (4 * n)) * gammaApp;
        }

        // Estimate from pressure using simplified Hagen-Poiseuille
        // Q = (π·R⁴·ΔP) / (8·η·L), assume η=10 Pa·s, L=20mm
        const eta = 10;  // Pa·s (typical bioink viscosity at low shear)
        const L = 0.02;  // m (typical nozzle length)
        const deltaP = params.pressure * 1000;  // kPa → Pa
        const Q = (Math.PI * Math.pow(R, 4) * deltaP) / (8 * eta * L);
        const gammaApp = (32 * Q) / (Math.PI * Math.pow(D, 3));
        const n = 0.5;
        return ((3 * n + 1) / (4 * n)) * gammaApp;
    }

    /**
     * Shear damage survival fraction.
     *   S(γ) = exp(-α · (γ/γ_crit)^β)
     *
     * @param {number} shearRate - Wall shear rate (1/s)
     * @param {Object} [modelParams] - Override default shear parameters
     * @returns {number} Survival fraction ∈ [0, 1]
     */
    function shearSurvival(shearRate, modelParams) {
        const p = modelParams || DEFAULT_PARAMS.shear;
        if (shearRate <= 0) return 1.0;
        const ratio = shearRate / p.gammaCrit;
        return Math.exp(-p.alpha * Math.pow(ratio, p.beta));
    }

    /**
     * Pressure damage survival fraction.
     *   P(p) = 1 / (1 + exp(k · (p - p50)))
     *
     * @param {number} pressure - Extrusion pressure (kPa)
     * @param {Object} [modelParams] - Override default pressure parameters
     * @returns {number} Survival fraction ∈ [0, 1]
     */
    function pressureSurvival(pressure, modelParams) {
        const p = modelParams || DEFAULT_PARAMS.pressure;
        if (pressure <= 0) return 1.0;
        return 1 / (1 + Math.exp(p.k * (pressure - p.p50)));
    }

    /**
     * Cross-linking cytotoxicity survival fraction.
     *   U(dose) = 1 - dose^n / (EC50^n + dose^n)
     *
     * Dose = duration_ms × intensity_percent
     *
     * @param {number} duration - Cross-linking duration (ms)
     * @param {number} intensity - Cross-linking intensity (%)
     * @param {Object} [modelParams] - Override default crosslink parameters
     * @returns {number} Survival fraction ∈ [0, 1]
     */
    function crosslinkSurvival(duration, intensity, modelParams) {
        const p = modelParams || DEFAULT_PARAMS.crosslink;
        if (duration <= 0 || intensity <= 0) return 1.0;
        const dose = duration * intensity;
        return 1 - Math.pow(dose, p.n) / (Math.pow(p.ec50, p.n) + Math.pow(dose, p.n));
    }

    /**
     * Thermal damage survival fraction.
     *   T(temp) = exp(-(temp - optimal)² / (2σ²))
     *
     * @param {number} temperature - Print temperature (°C)
     * @param {Object} [modelParams] - Override default thermal parameters
     * @returns {number} Survival fraction ∈ [0, 1]
     */
    function thermalSurvival(temperature, modelParams) {
        const p = modelParams || DEFAULT_PARAMS.thermal;
        const diff = temperature - p.optimal;
        return Math.exp(-(diff * diff) / (2 * p.sigma * p.sigma));
    }

    /**
     * Duration damage survival fraction.
     *   D(t) = max(0, 1 - λ·t)
     *
     * @param {number} duration - Time outside incubator (s)
     * @param {Object} [modelParams] - Override default duration parameters
     * @returns {number} Survival fraction ∈ [0, 1]
     */
    function durationSurvival(duration, modelParams) {
        const p = modelParams || DEFAULT_PARAMS.duration;
        if (duration <= 0) return 1.0;
        return Math.max(0, 1 - p.lambda * duration);
    }

    // ── Combined Estimation ─────────────────────────────────────

    /**
     * Estimate overall cell viability given print parameters.
     *
     * Combines individual stressor models multiplicatively under the
     * assumption of independent damage mechanisms.
     *
     * @param {Object} params - Print parameters:
     *   - pressure {number}: Extrusion pressure (kPa), required
     *   - crosslinkDuration {number}: UV duration (ms), default 0
     *   - crosslinkIntensity {number}: UV intensity (%), default 0
     *   - layerHeight {number}: Layer height (mm), default 0.4
     *   - nozzleDiameter {number}: Nozzle diameter (mm), default 0.4
     *   - temperature {number}: Print temperature (°C), optional
     *   - printDuration {number}: Total print time (s), optional
     *   - flowRate {number}: Volumetric flow (mm³/s), optional
     * @param {Object} [modelParams] - Override default model parameters
     * @returns {Object} Viability estimate with breakdown
     */
    function estimate(params, modelParams) {
        const vp = _validateParams(params);
        const mp = modelParams || DEFAULT_PARAMS;

        const shearRate = estimateShearRate(vp);
        const sShear = shearSurvival(shearRate, mp.shear);
        const sPressure = pressureSurvival(vp.pressure, mp.pressure);
        const sCrosslink = crosslinkSurvival(
            vp.crosslinkDuration, vp.crosslinkIntensity, mp.crosslink
        );
        const sThermal = vp.temperature != null
            ? thermalSurvival(vp.temperature, mp.thermal) : 1.0;
        const sDuration = vp.printDuration != null
            ? durationSurvival(vp.printDuration, mp.duration) : 1.0;

        const baseline = mp.baseline || DEFAULT_PARAMS.baseline;
        const combined = baseline * sShear * sPressure * sCrosslink * sThermal * sDuration;
        const viabilityPercent = combined * 100;

        // Classify overall quality
        let quality;
        if (viabilityPercent >= 90) quality = 'excellent';
        else if (viabilityPercent >= 75) quality = 'good';
        else if (viabilityPercent >= 60) quality = 'acceptable';
        else if (viabilityPercent >= 40) quality = 'poor';
        else quality = 'critical';

        // Identify limiting factor
        const factors = {
            shear: sShear,
            pressure: sPressure,
            crosslink: sCrosslink,
        };
        if (vp.temperature != null) factors.thermal = sThermal;
        if (vp.printDuration != null) factors.duration = sDuration;

        const limitingFactor = Object.entries(factors)
            .reduce((min, entry) => entry[1] < min[1] ? entry : min, ['none', 1.0]);

        // Generate warnings
        const warnings = [];
        if (sShear < 0.5) warnings.push('High shear stress — consider larger nozzle or lower pressure');
        if (sPressure < 0.5) warnings.push('Excessive pressure — risk of cell lysis');
        if (sCrosslink < 0.5) warnings.push('Cross-linking dose may be cytotoxic — reduce duration or intensity');
        if (sThermal < 0.8) warnings.push('Temperature outside optimal range (32-42°C)');
        if (sDuration < 0.7) warnings.push('Extended print time — cell viability declining');
        if (viabilityPercent < 40) warnings.push('CRITICAL: predicted viability below 40% — adjust parameters');

        return {
            viabilityPercent: Math.round(viabilityPercent * 100) / 100,
            quality: quality,
            breakdown: {
                baseline: baseline,
                shear: Math.round(sShear * 10000) / 10000,
                pressure: Math.round(sPressure * 10000) / 10000,
                crosslink: Math.round(sCrosslink * 10000) / 10000,
                thermal: vp.temperature != null ? Math.round(sThermal * 10000) / 10000 : null,
                duration: vp.printDuration != null ? Math.round(sDuration * 10000) / 10000 : null,
            },
            estimatedShearRate: Math.round(shearRate * 100) / 100,
            limitingFactor: limitingFactor[0],
            limitingValue: Math.round(limitingFactor[1] * 10000) / 10000,
            warnings: warnings,
            params: vp,
        };
    }

    // ── Sensitivity Analysis ────────────────────────────────────

    /**
     * Perform one-at-a-time sensitivity analysis.
     *
     * Varies each parameter across its range while holding others at
     * baseline values. Returns the viability curve for each parameter.
     *
     * @param {Object} baseParams - Baseline print parameters
     * @param {Object} [options] - Analysis options
     * @param {number} [options.steps=20] - Number of evaluation points per parameter
     * @param {Object} [options.ranges] - Custom parameter ranges
     * @param {Object} [options.modelParams] - Override model parameters
     * @returns {Object} Sensitivity curves per parameter
     */
    function sensitivityAnalysis(baseParams, options) {
        const opts = options || {};
        const steps = opts.steps || 20;
        if (steps < 2 || steps > 200) throw new Error('steps must be between 2 and 200');

        const ranges = opts.ranges || {
            pressure: { min: 10, max: 200, unit: 'kPa' },
            crosslinkDuration: { min: 0, max: 30000, unit: 'ms' },
            crosslinkIntensity: { min: 0, max: 100, unit: '%' },
            nozzleDiameter: { min: 0.1, max: 2.0, unit: 'mm' },
        };

        const result = {};

        for (const param of Object.keys(ranges)) {
            const range = ranges[param];
            const curve = [];
            for (let i = 0; i <= steps; i++) {
                const value = range.min + (range.max - range.min) * (i / steps);
                const testParams = Object.assign({}, baseParams);
                testParams[param] = value;
                try {
                    const est = estimate(testParams, opts.modelParams);
                    curve.push({
                        value: Math.round(value * 1000) / 1000,
                        viability: est.viabilityPercent,
                    });
                } catch (e) {
                    // Skip invalid parameter combinations
                }
            }

            // Compute sensitivity index: (max - min) viability across range
            const viabilities = curve.map(function(c) { return c.viability; });
            const sensitivityIndex = viabilities.length > 0
                ? Math.max.apply(null, viabilities) - Math.min.apply(null, viabilities)
                : 0;

            result[param] = {
                range: range,
                curve: curve,
                sensitivityIndex: Math.round(sensitivityIndex * 100) / 100,
            };
        }

        // Rank parameters by sensitivity
        const ranked = Object.keys(result)
            .filter(function(k) { return k !== '_ranking'; })
            .sort(function(a, b) { return result[b].sensitivityIndex - result[a].sensitivityIndex; });
        result._ranking = ranked;

        return result;
    }

    // ── Optimal Window Finder ───────────────────────────────────

    /**
     * Find optimal parameter windows from historical print data.
     *
     * Analyzes actual print outcomes to find parameter ranges that
     * yield the highest cell viability.
     *
     * @param {Array} printData - Array of print records (from bioprint-data.json)
     * @param {Object} [options]
     * @param {number} [options.viabilityThreshold=70] - Minimum acceptable viability (%)
     * @param {number} [options.topPercentile=25] - Top N% of prints to analyze
     * @returns {Object} Optimal parameter ranges with statistics
     */
    function findOptimalWindow(printData, options) {
        if (!Array.isArray(printData) || printData.length === 0) {
            throw new Error('printData must be a non-empty array');
        }

        const opts = options || {};
        const threshold = opts.viabilityThreshold != null ? opts.viabilityThreshold : 70;
        const topPct = opts.topPercentile != null ? opts.topPercentile : 25;

        // Extract and sort by viability
        const records = printData
            .filter(function(d) { return d && d.print_data && d.print_info; })
            .map(function(d) {
                return {
                    viability: d.print_data.livePercent || 0,
                    pressure: d.print_info.pressure
                        ? Math.max(d.print_info.pressure.extruder1 || 0, d.print_info.pressure.extruder2 || 0)
                        : 0,
                    clDuration: (d.print_info.crosslinking && d.print_info.crosslinking.cl_duration) || 0,
                    clIntensity: (d.print_info.crosslinking && d.print_info.crosslinking.cl_intensity) || 0,
                    layerHeight: (d.print_info.resolution && d.print_info.resolution.layerHeight) || 0,
                    layerNum: (d.print_info.resolution && d.print_info.resolution.layerNum) || 0,
                };
            })
            .sort(function(a, b) { return b.viability - a.viability; });

        if (records.length === 0) {
            throw new Error('No valid print records found');
        }

        // Select top percentile
        const topCount = Math.max(1, Math.ceil(records.length * topPct / 100));
        const topRecords = records.slice(0, topCount);

        // Prints meeting threshold
        const aboveThreshold = records.filter(function(r) { return r.viability >= threshold; });

        // Compute statistics for parameter ranges
        function _paramStats(arr, key) {
            var values = arr.map(function(r) { return r[key]; }).filter(function(v) { return v > 0; });
            if (values.length === 0) return { min: 0, max: 0, mean: 0, median: 0, count: 0 };
            values.sort(function(a, b) { return a - b; });
            var sum = values.reduce(function(s, v) { return s + v; }, 0);
            var mid = Math.floor(values.length / 2);
            return {
                min: Math.round(values[0] * 100) / 100,
                max: Math.round(values[values.length - 1] * 100) / 100,
                mean: Math.round((sum / values.length) * 100) / 100,
                median: Math.round((values.length % 2 === 0
                    ? (values[mid - 1] + values[mid]) / 2
                    : values[mid]) * 100) / 100,
                count: values.length,
            };
        }

        var paramKeys = ['pressure', 'clDuration', 'clIntensity', 'layerHeight', 'layerNum'];
        var optimalRanges = {};
        for (var ki = 0; ki < paramKeys.length; ki++) {
            var key = paramKeys[ki];
            optimalRanges[key] = {
                topPercentile: _paramStats(topRecords, key),
                aboveThreshold: _paramStats(aboveThreshold, key),
            };
        }

        return {
            totalRecords: records.length,
            topPercentileCount: topRecords.length,
            aboveThresholdCount: aboveThreshold.length,
            viabilityThreshold: threshold,
            topPercentile: topPct,
            viabilityStats: {
                topGroup: _paramStats(topRecords, 'viability'),
                overall: _paramStats(records, 'viability'),
            },
            optimalRanges: optimalRanges,
            recommendations: _generateRecommendations(optimalRanges, records.length),
        };
    }

    /**
     * Generate human-readable recommendations from optimal window analysis.
     * @param {Object} ranges - Optimal parameter ranges
     * @param {number} totalRecords - Total number of records analyzed
     * @returns {Array<string>} List of recommendation strings
     */
    function _generateRecommendations(ranges, totalRecords) {
        var recs = [];
        var pr = ranges.pressure.topPercentile;
        if (pr.count > 0) {
            recs.push('Target pressure range: ' + pr.min + '-' + pr.max +
                       ' kPa (median: ' + pr.median + ' kPa)');
        }
        var cl = ranges.clDuration.topPercentile;
        if (cl.count > 0 && cl.max > 0) {
            recs.push('Cross-linking duration: ' + cl.min + '-' + cl.max +
                       ' ms (median: ' + cl.median + ' ms)');
        }
        var ci = ranges.clIntensity.topPercentile;
        if (ci.count > 0 && ci.max > 0) {
            recs.push('Cross-linking intensity: ' + ci.min + '-' + ci.max +
                       '% (median: ' + ci.median + '%)');
        }
        var lh = ranges.layerHeight.topPercentile;
        if (lh.count > 0) {
            recs.push('Layer height: ' + lh.min + '-' + lh.max +
                       ' mm (median: ' + lh.median + ' mm)');
        }
        if (totalRecords >= 50) {
            recs.push('Analysis based on ' + totalRecords + ' historical prints — statistically significant');
        } else {
            recs.push('Limited data (' + totalRecords + ' prints) — expand dataset for higher confidence');
        }
        return recs;
    }

    // ── Batch Analysis ──────────────────────────────────────────

    /**
     * Analyze a batch of prints, estimating viability for each and
     * computing aggregate statistics.
     *
     * @param {Array} printData - Array of print records (bioprint-data.json format)
     * @param {Object} [modelParams] - Override model parameters
     * @returns {Object} Batch analysis with per-print estimates and aggregates
     */
    function batchAnalyze(printData, modelParams) {
        if (!Array.isArray(printData) || printData.length === 0) {
            throw new Error('printData must be a non-empty array');
        }

        var results = [];
        var totalPredicted = 0;
        var totalActual = 0;
        var sumSquaredError = 0;
        var count = 0;

        for (var ri = 0; ri < printData.length; ri++) {
            var record = printData[ri];
            if (!record || !record.print_data || !record.print_info) continue;

            var params = {
                pressure: Math.max(
                    record.print_info.pressure ? record.print_info.pressure.extruder1 || 0 : 0,
                    record.print_info.pressure ? record.print_info.pressure.extruder2 || 0 : 0
                ),
                crosslinkDuration: (record.print_info.crosslinking && record.print_info.crosslinking.cl_duration) || 0,
                crosslinkIntensity: (record.print_info.crosslinking && record.print_info.crosslinking.cl_intensity) || 0,
                layerHeight: (record.print_info.resolution && record.print_info.resolution.layerHeight) || 0.4,
                nozzleDiameter: 0.4,
            };

            try {
                var est = estimate(params, modelParams);
                var actual = record.print_data.livePercent || 0;
                var error = est.viabilityPercent - actual;

                results.push({
                    serial: record.user_info ? record.user_info.serial : null,
                    predicted: est.viabilityPercent,
                    actual: actual,
                    error: Math.round(error * 100) / 100,
                    absError: Math.round(Math.abs(error) * 100) / 100,
                    quality: est.quality,
                    limitingFactor: est.limitingFactor,
                    warnings: est.warnings,
                });

                totalPredicted += est.viabilityPercent;
                totalActual += actual;
                sumSquaredError += error * error;
                count++;
            } catch (e) {
                // Skip records with invalid data
            }
        }

        if (count === 0) {
            throw new Error('No valid records could be analyzed');
        }

        var meanPredicted = totalPredicted / count;
        var meanActual = totalActual / count;
        var rmse = Math.sqrt(sumSquaredError / count);
        var mae = results.reduce(function(s, r) { return s + r.absError; }, 0) / count;

        // Correlation coefficient
        var sumXY = 0, sumX2 = 0, sumY2 = 0;
        for (var ci2 = 0; ci2 < results.length; ci2++) {
            var r = results[ci2];
            var dx = r.predicted - meanPredicted;
            var dy = r.actual - meanActual;
            sumXY += dx * dy;
            sumX2 += dx * dx;
            sumY2 += dy * dy;
        }
        var correlation = (sumX2 > 0 && sumY2 > 0)
            ? sumXY / Math.sqrt(sumX2 * sumY2)
            : 0;

        // Quality distribution
        var qualityDist = { excellent: 0, good: 0, acceptable: 0, poor: 0, critical: 0 };
        for (var qi = 0; qi < results.length; qi++) qualityDist[results[qi].quality]++;

        // Limiting factor distribution
        var limitingDist = {};
        for (var li = 0; li < results.length; li++) {
            var lf = results[li].limitingFactor;
            limitingDist[lf] = (limitingDist[lf] || 0) + 1;
        }

        return {
            count: count,
            accuracy: {
                rmse: Math.round(rmse * 100) / 100,
                mae: Math.round(mae * 100) / 100,
                correlation: Math.round(correlation * 10000) / 10000,
                meanPredicted: Math.round(meanPredicted * 100) / 100,
                meanActual: Math.round(meanActual * 100) / 100,
            },
            qualityDistribution: qualityDist,
            limitingFactorDistribution: limitingDist,
            results: results,
        };
    }

    // ── Parameter Sweep ─────────────────────────────────────────

    /**
     * 2D parameter sweep to find viability landscape.
     *
     * Varies two parameters simultaneously to produce a 2D grid of
     * viability estimates. Useful for finding optimal combinations.
     *
     * @param {Object} baseParams - Fixed parameters
     * @param {string} param1 - First sweep parameter name
     * @param {Object} range1 - { min, max } for first parameter
     * @param {string} param2 - Second sweep parameter name
     * @param {Object} range2 - { min, max } for second parameter
     * @param {Object} [options]
     * @param {number} [options.resolution=10] - Grid points per axis
     * @param {Object} [options.modelParams] - Override model parameters
     * @returns {Object} 2D sweep results with grid, peak, and contours
     */
    function parameterSweep(baseParams, param1, range1, param2, range2, options) {
        var opts = options || {};
        var res = opts.resolution || 10;
        if (res < 2 || res > 50) throw new Error('resolution must be between 2 and 50');

        if (!range1 || typeof range1.min !== 'number' || typeof range1.max !== 'number') {
            throw new Error('range1 must have numeric min and max');
        }
        if (!range2 || typeof range2.min !== 'number' || typeof range2.max !== 'number') {
            throw new Error('range2 must have numeric min and max');
        }

        var grid = [];
        var peak = { value: -Infinity, p1: 0, p2: 0 };
        var trough = { value: Infinity, p1: 0, p2: 0 };

        for (var i = 0; i <= res; i++) {
            var v1 = range1.min + (range1.max - range1.min) * (i / res);
            var row = [];

            for (var j = 0; j <= res; j++) {
                var v2 = range2.min + (range2.max - range2.min) * (j / res);
                var testParams = Object.assign({}, baseParams);
                testParams[param1] = v1;
                testParams[param2] = v2;

                try {
                    var est = estimate(testParams, opts.modelParams);
                    var cell = {
                        viability: est.viabilityPercent,
                    };
                    cell[param1] = Math.round(v1 * 1000) / 1000;
                    cell[param2] = Math.round(v2 * 1000) / 1000;
                    row.push(cell);

                    if (est.viabilityPercent > peak.value) {
                        peak = { value: est.viabilityPercent, p1: v1, p2: v2 };
                    }
                    if (est.viabilityPercent < trough.value) {
                        trough = { value: est.viabilityPercent, p1: v1, p2: v2 };
                    }
                } catch (e) {
                    row.push(null);
                }
            }
            grid.push(row);
        }

        var result = {
            param1: param1,
            param2: param2,
            range1: range1,
            range2: range2,
            resolution: res,
            grid: grid,
            peak: { viability: Math.round(peak.value * 100) / 100 },
            trough: { viability: Math.round(trough.value * 100) / 100 },
        };
        result.peak[param1] = Math.round(peak.p1 * 1000) / 1000;
        result.peak[param2] = Math.round(peak.p2 * 1000) / 1000;
        result.trough[param1] = Math.round(trough.p1 * 1000) / 1000;
        result.trough[param2] = Math.round(trough.p2 * 1000) / 1000;

        return result;
    }

    // ── Model Calibration ───────────────────────────────────────

    /**
     * Calibrate model parameters from historical data using grid search.
     *
     * Adjusts the pressure p50 and crosslink EC50 parameters to minimize
     * RMSE between predicted and actual viability.
     *
     * @param {Array} printData - Historical print records
     * @param {Object} [options]
     * @param {number} [options.steps=5] - Grid search steps per parameter
     * @returns {Object} Calibrated parameters and accuracy metrics
     */
    function calibrate(printData, options) {
        if (!Array.isArray(printData) || printData.length < 5) {
            throw new Error('Need at least 5 records for calibration');
        }
        var opts = options || {};
        var steps = opts.steps || 5;
        var p50Min = 50, p50Max = 300;
        var ec50Min = 5000, ec50Max = 50000;

        // Pre-extract valid record params once instead of re-parsing in
        // every batchAnalyze() call. For a 5-step grid this eliminates
        // 35 redundant iterations over the full print dataset.
        var preExtracted = [];
        for (var ri = 0; ri < printData.length; ri++) {
            var record = printData[ri];
            if (!record || !record.print_data || !record.print_info) continue;
            preExtracted.push({
                params: {
                    pressure: Math.max(
                        record.print_info.pressure ? record.print_info.pressure.extruder1 || 0 : 0,
                        record.print_info.pressure ? record.print_info.pressure.extruder2 || 0 : 0
                    ),
                    crosslinkDuration: (record.print_info.crosslinking && record.print_info.crosslinking.cl_duration) || 0,
                    crosslinkIntensity: (record.print_info.crosslinking && record.print_info.crosslinking.cl_intensity) || 0,
                    layerHeight: (record.print_info.resolution && record.print_info.resolution.layerHeight) || 0.4,
                    nozzleDiameter: 0.4,
                },
                actual: record.print_data.livePercent || 0,
            });
        }

        if (preExtracted.length < 5) {
            throw new Error('Need at least 5 valid records for calibration');
        }

        var bestRmse = Infinity;
        var bestParams = null;

        for (var pi = 0; pi <= steps; pi++) {
            var p50 = p50Min + (p50Max - p50Min) * (pi / steps);
            for (var ei = 0; ei <= steps; ei++) {
                var ec50 = ec50Min + (ec50Max - ec50Min) * (ei / steps);

                var testModelParams = {
                    baseline: DEFAULT_PARAMS.baseline,
                    shear: DEFAULT_PARAMS.shear,
                    pressure: { k: DEFAULT_PARAMS.pressure.k, p50: p50 },
                    crosslink: { n: DEFAULT_PARAMS.crosslink.n, ec50: ec50 },
                    thermal: DEFAULT_PARAMS.thermal,
                    duration: DEFAULT_PARAMS.duration,
                };

                // Evaluate directly against pre-extracted params
                var sumSquaredError = 0;
                var sumAbsError = 0;
                var totalPredicted = 0;
                var totalActual = 0;
                var count = 0;
                var valid = true;

                // Store predictions for correlation if this turns
                // out to be the best grid point — avoids a redundant
                // second pass over all records (was O(2n) per improved
                // point, now O(n) total).
                var predictions = new Array(preExtracted.length);

                for (var xi = 0; xi < preExtracted.length; xi++) {
                    try {
                        var est = estimate(preExtracted[xi].params, testModelParams);
                        predictions[xi] = est.viabilityPercent;
                        var error = est.viabilityPercent - preExtracted[xi].actual;
                        sumSquaredError += error * error;
                        sumAbsError += Math.abs(error);
                        totalPredicted += est.viabilityPercent;
                        totalActual += preExtracted[xi].actual;
                        count++;
                    } catch (e) {
                        predictions[xi] = null;
                    }
                }

                if (count === 0) continue;

                var rmse = Math.sqrt(sumSquaredError / count);
                if (rmse < bestRmse) {
                    var meanP = totalPredicted / count;
                    var meanA = totalActual / count;
                    var mae = sumAbsError / count;

                    // Compute correlation from stored predictions
                    // (no second estimate() pass needed).
                    var sXY = 0, sX2 = 0, sY2 = 0;
                    for (var ci = 0; ci < preExtracted.length; ci++) {
                        if (predictions[ci] === null) continue;
                        var dx = predictions[ci] - meanP;
                        var dy = preExtracted[ci].actual - meanA;
                        sXY += dx * dy;
                        sX2 += dx * dx;
                        sY2 += dy * dy;
                    }
                    var corr = (sX2 > 0 && sY2 > 0) ? sXY / Math.sqrt(sX2 * sY2) : 0;

                    bestRmse = rmse;
                    bestParams = {
                        p50: p50,
                        ec50: ec50,
                        rmse: Math.round(rmse * 100) / 100,
                        mae: Math.round(mae * 100) / 100,
                        correlation: Math.round(corr * 10000) / 10000,
                    };
                }
            }
        }

        if (!bestParams) {
            throw new Error('Calibration failed — no valid parameter combinations found');
        }

        return {
            calibratedParams: {
                pressure: { k: DEFAULT_PARAMS.pressure.k, p50: bestParams.p50 },
                crosslink: { n: DEFAULT_PARAMS.crosslink.n, ec50: bestParams.ec50 },
            },
            accuracy: {
                rmse: bestParams.rmse,
                mae: bestParams.mae,
                correlation: bestParams.correlation,
            },
            searchSpace: {
                p50: { min: p50Min, max: p50Max },
                ec50: { min: ec50Min, max: ec50Max },
                steps: steps,
                combinations: (steps + 1) * (steps + 1),
            },
        };
    }

    // ── Report Generation ───────────────────────────────────────

    /**
     * Generate a comprehensive viability report for a set of print parameters.
     *
     * Combines estimation, sensitivity analysis, and recommendations
     * into a single structured report.
     *
     * @param {Object} params - Print parameters
     * @param {Object} [options]
     * @param {Object} [options.modelParams] - Override model parameters
     * @param {boolean} [options.includeSensitivity=true] - Include sensitivity analysis
     * @returns {Object} Comprehensive viability report
     */
    function generateReport(params, options) {
        var opts = options || {};
        var includeSensitivity = opts.includeSensitivity !== false;

        var est = estimate(params, opts.modelParams);
        var report = {
            timestamp: new Date().toISOString(),
            estimation: est,
            recommendations: [],
        };

        // Add parameter-specific recommendations
        if (est.breakdown.shear < 0.7) {
            report.recommendations.push({
                parameter: 'shear',
                severity: est.breakdown.shear < 0.3 ? 'critical' : 'warning',
                suggestion: 'Increase nozzle diameter or reduce pressure to lower shear stress',
                currentSurvival: est.breakdown.shear,
            });
        }
        if (est.breakdown.pressure < 0.7) {
            report.recommendations.push({
                parameter: 'pressure',
                severity: est.breakdown.pressure < 0.3 ? 'critical' : 'warning',
                suggestion: 'Reduce extrusion pressure — current level risks cell lysis',
                currentSurvival: est.breakdown.pressure,
            });
        }
        if (est.breakdown.crosslink < 0.7) {
            report.recommendations.push({
                parameter: 'crosslink',
                severity: est.breakdown.crosslink < 0.3 ? 'critical' : 'warning',
                suggestion: 'Reduce UV exposure — shorten duration or lower intensity',
                currentSurvival: est.breakdown.crosslink,
            });
        }

        if (includeSensitivity) {
            report.sensitivity = sensitivityAnalysis(params, { modelParams: opts.modelParams });
        }

        return report;
    }

    // ── Public API ──────────────────────────────────────────────

    return {
        // Individual damage models
        estimateShearRate: estimateShearRate,
        shearSurvival: shearSurvival,
        pressureSurvival: pressureSurvival,
        crosslinkSurvival: crosslinkSurvival,
        thermalSurvival: thermalSurvival,
        durationSurvival: durationSurvival,

        // Combined estimation
        estimate: estimate,

        // Analysis tools
        sensitivityAnalysis: sensitivityAnalysis,
        findOptimalWindow: findOptimalWindow,
        batchAnalyze: batchAnalyze,
        parameterSweep: parameterSweep,
        calibrate: calibrate,
        generateReport: generateReport,

        // Constants
        DEFAULT_PARAMS: DEFAULT_PARAMS,
    };
}

// ── Module Export ────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createViabilityEstimator };
}
