'use strict';

/**
 * Cross-linking Kinetics Analyzer for BioBots
 *
 * Models photo/chemical cross-linking behavior in hydrogel bioprinting:
 *   - First-order kinetics: α(t) = 1 - exp(-k·t)
 *   - Hill equation dose-response: R(I) = R_max·I^n / (EC50^n + I^n)
 *   - Gel point estimation (percolation threshold)
 *   - Optimal dose window (maximize viability, minimize under-curing)
 *   - Multi-parameter response surface (duration × intensity)
 *
 * Cross-linking parameters directly control cell viability: too little
 * produces mechanically weak constructs, too much causes UV/radical
 * damage to encapsulated cells. Finding the sweet spot is critical.
 */
function createCrosslinkAnalyzer() {

    // ── Constants ────────────────────────────────────────────────

    /** Minimum cross-linking degree for structural integrity (Flory gel point). */
    const GEL_POINT_THRESHOLD = 0.632;

    /** Default Hill coefficient for dose-response (typical for UV curing). */
    const DEFAULT_HILL_COEFF = 2.0;

    /** Default maximum viability achievable (%) */
    const DEFAULT_MAX_VIABILITY = 95;

    // ── First-Order Kinetics ────────────────────────────────────

    /**
     * Compute degree of cross-linking using first-order kinetics.
     *   α(t) = 1 - exp(-k · t)
     *
     * @param {number} k - Rate constant (1/s), must be > 0
     * @param {number} t - Duration (s), must be >= 0
     * @returns {number} Degree of cross-linking α ∈ [0, 1]
     */
    function crosslinkDegree(k, t) {
        if (typeof k !== 'number' || typeof t !== 'number') {
            throw new Error('Rate constant and time must be numbers');
        }
        if (k <= 0) throw new Error('Rate constant k must be positive');
        if (t < 0) throw new Error('Time must be non-negative');
        if (t === 0) return 0;
        return 1 - Math.exp(-k * t);
    }

    /**
     * Generate a cross-linking progression curve over time.
     *
     * @param {number} k - Rate constant (1/s)
     * @param {number} maxTime - Maximum time (s)
     * @param {number} [points=50] - Number of data points
     * @returns {{ time: number, degree: number }[]}
     */
    function crosslinkCurve(k, maxTime, points) {
        if (typeof k !== 'number' || typeof maxTime !== 'number') {
            throw new Error('Parameters must be numbers');
        }
        if (k <= 0) throw new Error('Rate constant k must be positive');
        if (maxTime <= 0) throw new Error('Max time must be positive');
        points = points || 50;
        if (points < 2) throw new Error('Points must be at least 2');

        var result = [];
        for (var i = 0; i < points; i++) {
            var t = (i / (points - 1)) * maxTime;
            result.push({ time: t, degree: crosslinkDegree(k, t) });
        }
        return result;
    }

    /**
     * Estimate time to reach a target degree of cross-linking.
     *   t = -ln(1 - α) / k
     *
     * @param {number} k - Rate constant (1/s), must be > 0
     * @param {number} targetDegree - Target α ∈ (0, 1)
     * @returns {number} Time in seconds
     */
    function timeToTarget(k, targetDegree) {
        if (typeof k !== 'number' || typeof targetDegree !== 'number') {
            throw new Error('Parameters must be numbers');
        }
        if (k <= 0) throw new Error('Rate constant k must be positive');
        if (targetDegree <= 0 || targetDegree >= 1) {
            throw new Error('Target degree must be in (0, 1)');
        }
        return -Math.log(1 - targetDegree) / k;
    }

    /**
     * Estimate time to reach the gel point (percolation threshold).
     * Uses α = 0.632 (1 - 1/e) as the critical conversion.
     *
     * @param {number} k - Rate constant (1/s)
     * @returns {number} Gel time in seconds
     */
    function gelTime(k) {
        return timeToTarget(k, GEL_POINT_THRESHOLD);
    }

    // ── Dose-Response (Hill Equation) ───────────────────────────

    /**
     * Hill equation for dose-response modeling.
     *   R(I) = Rmax · I^n / (EC50^n + I^n)
     *
     * Models how cell response (viability, protein expression, etc.)
     * varies with cross-linker intensity/concentration.
     *
     * @param {number} intensity - Cross-linker intensity/dose (arbitrary units), >= 0
     * @param {number} ec50 - Half-maximal effective concentration (same units), > 0
     * @param {number} [hillCoeff=2] - Hill coefficient (steepness)
     * @param {number} [rMax=100] - Maximum response
     * @returns {number} Predicted response
     */
    function hillResponse(intensity, ec50, hillCoeff, rMax) {
        if (typeof intensity !== 'number' || typeof ec50 !== 'number') {
            throw new Error('Intensity and EC50 must be numbers');
        }
        if (intensity < 0) throw new Error('Intensity must be non-negative');
        if (ec50 <= 0) throw new Error('EC50 must be positive');
        hillCoeff = (hillCoeff != null) ? hillCoeff : DEFAULT_HILL_COEFF;
        rMax = (rMax != null) ? rMax : 100;
        if (intensity === 0) return 0;

        var In = Math.pow(intensity, hillCoeff);
        var ec50n = Math.pow(ec50, hillCoeff);
        return rMax * In / (ec50n + In);
    }

    /**
     * Generate a dose-response curve.
     *
     * @param {number} ec50 - Half-maximal effective concentration
     * @param {number} [hillCoeff=2] - Hill coefficient
     * @param {number} [rMax=100] - Maximum response
     * @param {number} [maxDose] - Maximum dose (default: 5 × EC50)
     * @param {number} [points=50] - Number of points
     * @returns {{ dose: number, response: number }[]}
     */
    function doseResponseCurve(ec50, hillCoeff, rMax, maxDose, points) {
        if (typeof ec50 !== 'number') throw new Error('EC50 must be a number');
        if (ec50 <= 0) throw new Error('EC50 must be positive');
        hillCoeff = (hillCoeff != null) ? hillCoeff : DEFAULT_HILL_COEFF;
        rMax = (rMax != null) ? rMax : 100;
        maxDose = maxDose || ec50 * 5;
        points = points || 50;
        if (points < 2) throw new Error('Points must be at least 2');

        var result = [];
        for (var i = 0; i < points; i++) {
            var dose = (i / (points - 1)) * maxDose;
            result.push({ dose: dose, response: hillResponse(dose, ec50, hillCoeff, rMax) });
        }
        return result;
    }

    // ── Viability Model ─────────────────────────────────────────

    /**
     * Model cell viability as a function of cross-linking dose.
     *
     * Viability follows a bell-shaped curve: increases with cross-linking
     * (structural integrity) but decreases at high doses (radical/UV damage).
     *
     *   V(d) = Vmax · [benefit(d) - damage(d)]
     *   benefit(d) = 1 - exp(-k_benefit · d)
     *   damage(d)  = 1 - exp(-k_damage · d^2)
     *
     * @param {number} dose - Total dose = intensity × duration
     * @param {Object} [params] - Model parameters
     * @param {number} [params.vMax=95] - Maximum achievable viability (%)
     * @param {number} [params.kBenefit=0.005] - Benefit rate constant
     * @param {number} [params.kDamage=0.000005] - Damage rate constant (quadratic)
     * @returns {{ viability: number, benefit: number, damage: number }}
     */
    function viabilityModel(dose, params) {
        if (typeof dose !== 'number') throw new Error('Dose must be a number');
        if (dose < 0) throw new Error('Dose must be non-negative');

        params = params || {};
        var vMax = (params.vMax != null) ? params.vMax : DEFAULT_MAX_VIABILITY;
        var kBenefit = (params.kBenefit != null) ? params.kBenefit : 0.005;
        var kDamage = (params.kDamage != null) ? params.kDamage : 0.000005;

        if (dose === 0) return { viability: 0, benefit: 0, damage: 0 };

        var benefit = 1 - Math.exp(-kBenefit * dose);
        var damage = 1 - Math.exp(-kDamage * dose * dose);
        var viability = vMax * Math.max(0, benefit - damage);

        return {
            viability: Math.round(viability * 100) / 100,
            benefit: Math.round(benefit * 10000) / 10000,
            damage: Math.round(damage * 10000) / 10000
        };
    }

    /**
     * Find the optimal cross-linking dose that maximizes cell viability.
     * Uses golden-section search over [0, maxDose].
     *
     * @param {Object} [params] - Viability model parameters (see viabilityModel)
     * @param {number} [maxDose=50000] - Upper dose bound for search
     * @param {number} [tolerance=0.1] - Convergence tolerance
     * @returns {{ optimalDose: number, maxViability: number, benefit: number, damage: number }}
     */
    function findOptimalDose(params, maxDose, tolerance) {
        maxDose = maxDose || 50000;
        tolerance = tolerance || 0.1;

        var phi = (1 + Math.sqrt(5)) / 2;
        var resphi = 2 - phi;

        var a = 0;
        var b = maxDose;
        var x1 = a + resphi * (b - a);
        var x2 = b - resphi * (b - a);
        var f1 = viabilityModel(x1, params).viability;
        var f2 = viabilityModel(x2, params).viability;

        while (Math.abs(b - a) > tolerance) {
            if (f1 < f2) {
                a = x1;
                x1 = x2;
                f1 = f2;
                x2 = b - resphi * (b - a);
                f2 = viabilityModel(x2, params).viability;
            } else {
                b = x2;
                x2 = x1;
                f2 = f1;
                x1 = a + resphi * (b - a);
                f1 = viabilityModel(x1, params).viability;
            }
        }

        var optDose = (a + b) / 2;
        var result = viabilityModel(optDose, params);
        return {
            optimalDose: Math.round(optDose * 10) / 10,
            maxViability: result.viability,
            benefit: result.benefit,
            damage: result.damage
        };
    }

    // ── Response Surface ────────────────────────────────────────

    /**
     * Generate a 2D response surface mapping (duration, intensity) → viability.
     *
     * @param {Object} [options] - Configuration
     * @param {number} [options.minDuration=0] - Min duration (s)
     * @param {number} [options.maxDuration=30000] - Max duration (s)
     * @param {number} [options.minIntensity=0] - Min intensity
     * @param {number} [options.maxIntensity=50] - Max intensity
     * @param {number} [options.durationSteps=20] - Grid resolution (duration axis)
     * @param {number} [options.intensitySteps=20] - Grid resolution (intensity axis)
     * @param {Object} [options.viabilityParams] - Parameters for viabilityModel
     * @returns {{ grid: { duration: number, intensity: number, dose: number, viability: number }[], durations: number[], intensities: number[], peak: { duration: number, intensity: number, viability: number } }}
     */
    function responseSurface(options) {
        options = options || {};
        var minD = (options.minDuration != null) ? options.minDuration : 0;
        var maxD = (options.maxDuration != null) ? options.maxDuration : 30000;
        var minI = (options.minIntensity != null) ? options.minIntensity : 0;
        var maxI = (options.maxIntensity != null) ? options.maxIntensity : 50;
        var dSteps = options.durationSteps || 20;
        var iSteps = options.intensitySteps || 20;
        var vParams = options.viabilityParams || {};

        if (dSteps < 2 || iSteps < 2) throw new Error('Steps must be at least 2');

        var grid = [];
        var durations = [];
        var intensities = [];
        var peak = { duration: 0, intensity: 0, viability: -1 };

        for (var di = 0; di < dSteps; di++) {
            var dur = minD + (di / (dSteps - 1)) * (maxD - minD);
            durations.push(Math.round(dur));
        }
        for (var ii = 0; ii < iSteps; ii++) {
            var inten = minI + (ii / (iSteps - 1)) * (maxI - minI);
            intensities.push(Math.round(inten * 100) / 100);
        }

        for (var d = 0; d < durations.length; d++) {
            for (var i = 0; i < intensities.length; i++) {
                var dose = durations[d] * intensities[i];
                var result = viabilityModel(dose, vParams);
                var point = {
                    duration: durations[d],
                    intensity: intensities[i],
                    dose: Math.round(dose),
                    viability: result.viability
                };
                grid.push(point);
                if (result.viability > peak.viability) {
                    peak = {
                        duration: durations[d],
                        intensity: intensities[i],
                        viability: result.viability
                    };
                }
            }
        }

        return { grid: grid, durations: durations, intensities: intensities, peak: peak };
    }

    // ── Data Analysis ───────────────────────────────────────────

    /**
     * Analyze cross-linking effectiveness from print data.
     * Groups prints by cross-linking parameters and computes statistics.
     *
     * @param {Object[]} prints - Array of print records from bioprint-data.json
     * @returns {{ summary: Object, bins: Object[], rateEstimate: number|null, recommendations: string[] }}
     */
    function analyzePrintData(prints) {
        if (!Array.isArray(prints)) throw new Error('Prints must be an array');
        if (prints.length === 0) {
            return { summary: { total: 0, crosslinked: 0, uncrosslinked: 0 }, bins: [], rateEstimate: null, recommendations: [] };
        }

        var crosslinked = [];
        var uncrosslinked = [];
        // Single-pass: partition AND accumulate summary stats to avoid
        // three redundant .map() calls over crosslinked later.
        var sumViability = 0, sumDuration = 0, sumIntensity = 0;

        for (var i = 0; i < prints.length; i++) {
            var p = prints[i];
            if (!p || !p.print_info || !p.print_info.crosslinking) continue;
            if (p.print_info.crosslinking.cl_enabled) {
                crosslinked.push(p);
                sumViability += p.print_data.livePercent;
                sumDuration += p.print_info.crosslinking.cl_duration;
                sumIntensity += p.print_info.crosslinking.cl_intensity;
            } else {
                uncrosslinked.push(p);
            }
        }

        var clLen = crosslinked.length;
        var avgViability = clLen > 0 ? Math.round((sumViability / clLen) * 100) / 100 : 0;
        var avgDuration = clLen > 0 ? Math.round((sumDuration / clLen) * 100) / 100 : 0;
        var avgIntensity = clLen > 0 ? Math.round((sumIntensity / clLen) * 100) / 100 : 0;

        // Bin by intensity ranges
        var bins = _binByIntensity(crosslinked);

        // Estimate effective rate constant from data
        var rateEstimate = _estimateRateConstant(crosslinked);

        // Generate recommendations (pass pre-computed avgViability
        // so _generateRecommendations doesn't re-scan crosslinked)
        var recommendations = _generateRecommendations(crosslinked, uncrosslinked, bins, avgViability);

        return {
            summary: {
                total: prints.length,
                crosslinked: clLen,
                uncrosslinked: uncrosslinked.length,
                avgViability: avgViability,
                avgDuration: avgDuration,
                avgIntensity: avgIntensity
            },
            bins: bins,
            rateEstimate: rateEstimate,
            recommendations: recommendations
        };
    }

    /**
     * Bin crosslinked prints by intensity ranges and compute stats per bin.
     * @private
     */
    function _binByIntensity(prints) {
        if (prints.length === 0) return [];

        // Single pass: find intensity range
        var minI = Infinity, maxI = -Infinity;
        for (var i = 0; i < prints.length; i++) {
            var inten = prints[i].print_info.crosslinking.cl_intensity;
            if (inten < minI) minI = inten;
            if (inten > maxI) maxI = inten;
        }

        if (minI === maxI) {
            // All same intensity — compute stats in one pass
            var sumV = 0, sumD = 0, sumE = 0;
            for (var i = 0; i < prints.length; i++) {
                sumV += prints[i].print_data.livePercent;
                sumD += prints[i].print_info.crosslinking.cl_duration;
                sumE += prints[i].print_data.elasticity;
            }
            var n = prints.length;
            return [{
                range: [minI, maxI],
                label: 'Intensity ' + minI,
                count: n,
                avgViability: Math.round((sumV / n) * 100) / 100,
                avgDuration: Math.round((sumD / n) * 100) / 100,
                avgElasticity: Math.round((sumE / n) * 100) / 100
            }];
        }

        var numBins = Math.min(5, Math.ceil(Math.sqrt(prints.length)));
        var binWidth = (maxI - minI) / numBins;

        // Pre-allocate bin accumulators — single pass O(n) instead of
        // O(n*k) from filter() per bin + 3 map() calls per bin.
        var binCounts = new Array(numBins);
        var binSumV = new Array(numBins);
        var binSumD = new Array(numBins);
        var binSumE = new Array(numBins);
        for (var b = 0; b < numBins; b++) {
            binCounts[b] = 0;
            binSumV[b] = 0;
            binSumD[b] = 0;
            binSumE[b] = 0;
        }

        // Single pass: assign each print to its bin
        for (var i = 0; i < prints.length; i++) {
            var p = prints[i];
            var v = p.print_info.crosslinking.cl_intensity;
            var idx = Math.floor((v - minI) / binWidth);
            // Last bin is inclusive of maxI
            if (idx >= numBins) idx = numBins - 1;
            binCounts[idx]++;
            binSumV[idx] += p.print_data.livePercent;
            binSumD[idx] += p.print_info.crosslinking.cl_duration;
            binSumE[idx] += p.print_data.elasticity;
        }

        // Build result bins (only non-empty)
        var bins = [];
        for (var b = 0; b < numBins; b++) {
            if (binCounts[b] === 0) continue;
            var lo = minI + b * binWidth;
            var hi = (b === numBins - 1) ? maxI : minI + (b + 1) * binWidth;
            var n = binCounts[b];
            bins.push({
                range: [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100],
                label: Math.round(lo) + '-' + Math.round(hi),
                count: n,
                avgViability: Math.round((binSumV[b] / n) * 100) / 100,
                avgDuration: Math.round((binSumD[b] / n) * 100) / 100,
                avgElasticity: Math.round((binSumE[b] / n) * 100) / 100
            });
        }

        return bins;
    }

    /**
     * Estimate effective first-order rate constant from print data.
     * Uses the relationship: dose = intensity × duration,
     * and fits α ≈ livePercent/100 to the kinetics model.
     *
     * @private
     * @param {Object[]} prints - Crosslinked prints only
     * @returns {number|null} Estimated k, or null if insufficient data
     */
    function _estimateRateConstant(prints) {
        if (prints.length < 3) return null;

        // Use least-squares on linearized form: -ln(1-α) = k·dose
        var sumXY = 0, sumXX = 0, validCount = 0;
        for (var i = 0; i < prints.length; i++) {
            var p = prints[i];
            var alpha = p.print_data.livePercent / 100;
            // Clamp to avoid log(0) or log(negative)
            if (alpha <= 0.01 || alpha >= 0.99) continue;
            var dose = p.print_info.crosslinking.cl_duration * p.print_info.crosslinking.cl_intensity;
            if (dose <= 0) continue;

            var y = -Math.log(1 - alpha);
            sumXY += dose * y;
            sumXX += dose * dose;
            validCount++;
        }

        if (validCount < 3 || sumXX === 0) return null;
        var k = sumXY / sumXX;
        return Math.round(k * 1e8) / 1e8;  // 8 decimal places
    }

    /**
     * Generate actionable recommendations from print data analysis.
     * @private
     */
    function _generateRecommendations(crosslinked, uncrosslinked, bins, precomputedAvgViability) {
        var recs = [];

        if (uncrosslinked.length > crosslinked.length) {
            recs.push('Most prints lack cross-linking — enable it to improve construct integrity');
        }

        if (crosslinked.length === 0) {
            recs.push('No cross-linked prints found — unable to analyze kinetics');
            return recs;
        }

        // Use pre-computed avgViability from analyzePrintData to avoid
        // redundant .map() + _mean() over the full crosslinked array.
        var avgViability = (precomputedAvgViability != null)
            ? precomputedAvgViability
            : _mean(crosslinked.map(function (p) { return p.print_data.livePercent; }));
        if (avgViability < 30) {
            recs.push('Average viability is low (' + avgViability.toFixed(1) + '%) — consider reducing cross-linking intensity or duration');
        }

        // Check for viability variation across bins
        if (bins.length >= 2) {
            var viabilities = bins.map(function (b) { return b.avgViability; });
            var maxV = Math.max.apply(null, viabilities);
            var minV = Math.min.apply(null, viabilities);
            if (maxV - minV > 20) {
                var bestBin = bins[viabilities.indexOf(maxV)];
                recs.push('Viability varies significantly across intensity ranges — best results at intensity ' + bestBin.label);
            }
        }

        // Check duration spread
        var durations = crosslinked.map(function (p) { return p.print_info.crosslinking.cl_duration; });
        var dStd = _std(durations);
        var dMean = _mean(durations);
        if (dMean > 0 && dStd / dMean > 0.5) {
            recs.push('High variation in cross-linking duration (CV=' + ((dStd / dMean) * 100).toFixed(0) + '%) — standardize protocol for reproducibility');
        }

        return recs;
    }

    // ── Dose Window ─────────────────────────────────────────────

    /**
     * Compute the therapeutic dose window where viability exceeds a threshold.
     *
     * @param {number} [threshold=50] - Minimum acceptable viability (%)
     * @param {Object} [params] - Viability model parameters
     * @param {number} [maxDose=100000] - Upper search bound
     * @param {number} [steps=1000] - Search resolution
     * @returns {{ lowerBound: number|null, upperBound: number|null, width: number, optimalDose: number, peakViability: number }}
     */
    function doseWindow(threshold, params, maxDose, steps) {
        threshold = (threshold != null) ? threshold : 50;
        maxDose = maxDose || 100000;
        steps = steps || 1000;

        var lowerBound = null;
        var upperBound = null;
        var peakViability = -1;
        var optimalDose = 0;

        for (var i = 0; i <= steps; i++) {
            var dose = (i / steps) * maxDose;
            var v = viabilityModel(dose, params).viability;

            if (v > peakViability) {
                peakViability = v;
                optimalDose = dose;
            }

            if (v >= threshold) {
                if (lowerBound === null) lowerBound = dose;
                upperBound = dose;
            }
        }

        return {
            lowerBound: lowerBound !== null ? Math.round(lowerBound) : null,
            upperBound: upperBound !== null ? Math.round(upperBound) : null,
            width: (lowerBound !== null && upperBound !== null) ? Math.round(upperBound - lowerBound) : 0,
            optimalDose: Math.round(optimalDose),
            peakViability: Math.round(peakViability * 100) / 100
        };
    }

    // ── Photo-initiator Efficiency ──────────────────────────────

    /**
     * Calculate photo-initiator efficiency metrics.
     *
     * Models the relationship between UV intensity, exposure time,
     * and radical generation for photo-crosslinking systems.
     *
     * @param {number} intensity - UV intensity (mW/cm²), > 0
     * @param {number} duration - Exposure time (s), > 0
     * @param {Object} [params] - Configuration
     * @param {number} [params.quantumYield=0.6] - Radical generation efficiency (0-1)
     * @param {number} [params.absorptivity=0.1] - Photo-initiator molar absorptivity
     * @param {number} [params.concentration=0.05] - Photo-initiator concentration (% w/v)
     * @returns {{ totalDose: number, effectiveDose: number, radicalYield: number, efficiency: number }}
     */
    function photoInitiatorEfficiency(intensity, duration, params) {
        if (typeof intensity !== 'number' || typeof duration !== 'number') {
            throw new Error('Intensity and duration must be numbers');
        }
        if (intensity <= 0) throw new Error('Intensity must be positive');
        if (duration <= 0) throw new Error('Duration must be positive');

        params = params || {};
        var qy = (params.quantumYield != null) ? params.quantumYield : 0.6;
        var abs = (params.absorptivity != null) ? params.absorptivity : 0.1;
        var conc = (params.concentration != null) ? params.concentration : 0.05;

        if (qy < 0 || qy > 1) throw new Error('Quantum yield must be in [0, 1]');

        var totalDose = intensity * duration;
        var absorbedFraction = 1 - Math.exp(-abs * conc * 1); // Beer-Lambert, path=1cm
        var effectiveDose = totalDose * absorbedFraction;
        var radicalYield = effectiveDose * qy;
        var efficiency = (totalDose > 0) ? (radicalYield / totalDose) * 100 : 0;

        return {
            totalDose: Math.round(totalDose * 100) / 100,
            effectiveDose: Math.round(effectiveDose * 100) / 100,
            radicalYield: Math.round(radicalYield * 100) / 100,
            efficiency: Math.round(efficiency * 100) / 100
        };
    }

    // ── Utilities ────────────────────────────────────────────────

    function _mean(arr) {
        if (arr.length === 0) return 0;
        var sum = 0;
        for (var i = 0; i < arr.length; i++) sum += arr[i];
        return Math.round((sum / arr.length) * 100) / 100;
    }

    function _std(arr) {
        if (arr.length < 2) return 0;
        var m = _mean(arr);
        var sumSq = 0;
        for (var i = 0; i < arr.length; i++) {
            var d = arr[i] - m;
            sumSq += d * d;
        }
        return Math.sqrt(sumSq / (arr.length - 1));
    }

    // ── Public API ──────────────────────────────────────────────

    return {
        // Constants
        GEL_POINT_THRESHOLD: GEL_POINT_THRESHOLD,

        // First-order kinetics
        crosslinkDegree: crosslinkDegree,
        crosslinkCurve: crosslinkCurve,
        timeToTarget: timeToTarget,
        gelTime: gelTime,

        // Dose-response
        hillResponse: hillResponse,
        doseResponseCurve: doseResponseCurve,

        // Viability
        viabilityModel: viabilityModel,
        findOptimalDose: findOptimalDose,
        doseWindow: doseWindow,

        // Response surface
        responseSurface: responseSurface,

        // Data analysis
        analyzePrintData: analyzePrintData,

        // Photo-initiator
        photoInitiatorEfficiency: photoInitiatorEfficiency
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createCrosslinkAnalyzer: createCrosslinkAnalyzer };
}
