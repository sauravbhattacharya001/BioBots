'use strict';

/**
 * Experiment Outcome Predictor
 *
 * Predicts bioprinting experiment success probability based on
 * historical outcomes and current experiment parameters. Uses
 * Bayesian-inspired scoring across key factors (material, temperature,
 * cell density, speed, etc.) to estimate success likelihood, flag
 * risk factors, and recommend parameter adjustments.
 *
 * Agentic capability: learns from past experiments to proactively
 * warn about high-failure-risk configurations before they run.
 *
 * @example
 *   var predictor = createOutcomePredictor();
 *   predictor.recordOutcome({ material: 'alginate', temperature: 37, cellDensity: 1e6, speed: 10, pressure: 25, success: true });
 *   predictor.recordOutcome({ material: 'alginate', temperature: 42, cellDensity: 1e6, speed: 10, pressure: 25, success: false });
 *   var prediction = predictor.predict({ material: 'alginate', temperature: 37, cellDensity: 1e6, speed: 10, pressure: 25 });
 *   // prediction.probability ≈ high, prediction.confidence, prediction.risks, prediction.suggestions
 */

// ── Default parameter ranges (optimal windows) ─────────────────────
var PARAM_PROFILES = {
    alginate: {
        temperature: { min: 20, max: 37, unit: '°C' },
        cellDensity: { min: 5e5, max: 5e6, unit: 'cells/mL' },
        speed: { min: 5, max: 20, unit: 'mm/s' },
        pressure: { min: 10, max: 40, unit: 'kPa' },
        layerHeight: { min: 0.1, max: 0.4, unit: 'mm' },
        nozzleDiameter: { min: 0.2, max: 0.6, unit: 'mm' }
    },
    gelatin: {
        temperature: { min: 25, max: 37, unit: '°C' },
        cellDensity: { min: 1e6, max: 1e7, unit: 'cells/mL' },
        speed: { min: 3, max: 15, unit: 'mm/s' },
        pressure: { min: 15, max: 50, unit: 'kPa' },
        layerHeight: { min: 0.15, max: 0.5, unit: 'mm' },
        nozzleDiameter: { min: 0.25, max: 0.8, unit: 'mm' }
    },
    collagen: {
        temperature: { min: 4, max: 25, unit: '°C' },
        cellDensity: { min: 1e6, max: 8e6, unit: 'cells/mL' },
        speed: { min: 2, max: 12, unit: 'mm/s' },
        pressure: { min: 5, max: 30, unit: 'kPa' },
        layerHeight: { min: 0.1, max: 0.3, unit: 'mm' },
        nozzleDiameter: { min: 0.15, max: 0.5, unit: 'mm' }
    },
    fibrin: {
        temperature: { min: 20, max: 37, unit: '°C' },
        cellDensity: { min: 1e6, max: 1e7, unit: 'cells/mL' },
        speed: { min: 5, max: 15, unit: 'mm/s' },
        pressure: { min: 10, max: 35, unit: 'kPa' },
        layerHeight: { min: 0.1, max: 0.35, unit: 'mm' },
        nozzleDiameter: { min: 0.2, max: 0.5, unit: 'mm' }
    },
    hyaluronic_acid: {
        temperature: { min: 20, max: 37, unit: '°C' },
        cellDensity: { min: 5e5, max: 5e6, unit: 'cells/mL' },
        speed: { min: 3, max: 10, unit: 'mm/s' },
        pressure: { min: 20, max: 60, unit: 'kPa' },
        layerHeight: { min: 0.15, max: 0.4, unit: 'mm' },
        nozzleDiameter: { min: 0.2, max: 0.6, unit: 'mm' }
    }
};

var PARAM_WEIGHTS = {
    temperature: 0.20,
    cellDensity: 0.20,
    speed: 0.15,
    pressure: 0.20,
    layerHeight: 0.10,
    nozzleDiameter: 0.15
};

// Hoisted outside predict() to avoid re-creating on every call.
var SIMILAR_CHECK_KEYS = ['temperature', 'cellDensity', 'speed', 'pressure'];

var CONFIDENCE_LEVELS = [
    { min: 0, label: 'very low', description: 'Insufficient data — treat as rough estimate' },
    { min: 5, label: 'low', description: 'Limited data — moderate uncertainty' },
    { min: 15, label: 'moderate', description: 'Reasonable data — fair confidence' },
    { min: 30, label: 'high', description: 'Strong data support' },
    { min: 50, label: 'very high', description: 'Extensive historical validation' }
];

// ── Helpers ─────────────────────────────────────────────────────────

function clamp(val, lo, hi) { return Math.max(lo, Math.min(hi, val)); }

/**
 * Score how well a value fits within an optimal range.
 * Returns 0 (perfect) to 1 (far outside).
 */
function rangeDeviation(value, range) {
    if (value >= range.min && value <= range.max) return 0;
    var span = range.max - range.min || 1;
    if (value < range.min) return Math.min((range.min - value) / span, 1);
    return Math.min((value - range.max) / span, 1);
}

function getConfidenceLevel(n) {
    var level = CONFIDENCE_LEVELS[0];
    for (var i = 0; i < CONFIDENCE_LEVELS.length; i++) {
        if (n >= CONFIDENCE_LEVELS[i].min) level = CONFIDENCE_LEVELS[i];
    }
    return level;
}

function round2(v) { return Math.round(v * 100) / 100; }

// ── Factory ─────────────────────────────────────────────────────────

function createOutcomePredictor() {
    var outcomes = [];          // Array of recorded experiments
    var materialStats = {};     // per-material success rates
    // Index outcomes by material for O(1) lookup in predict()
    var outcomesByMaterial = {}; // material -> array of outcome records

    // Incrementally update stats instead of re-scanning all outcomes
    // on every recordOutcome call.  Previous implementation was O(n)
    // per insert, making bulk loads O(n²).
    function updateMaterialStats(material, success) {
        if (!materialStats[material]) {
            materialStats[material] = { total: 0, successes: 0, rate: null };
        }
        materialStats[material].total++;
        if (success) materialStats[material].successes++;
        materialStats[material].rate = materialStats[material].successes / materialStats[material].total;
    }

    /**
     * Record a completed experiment outcome.
     * @param {Object} exp - Experiment data
     * @param {string} exp.material - Bioink material name
     * @param {number} [exp.temperature] - Print temperature (°C)
     * @param {number} [exp.cellDensity] - Cell density (cells/mL)
     * @param {number} [exp.speed] - Print speed (mm/s)
     * @param {number} [exp.pressure] - Extrusion pressure (kPa)
     * @param {number} [exp.layerHeight] - Layer height (mm)
     * @param {number} [exp.nozzleDiameter] - Nozzle diameter (mm)
     * @param {boolean} exp.success - Whether the experiment succeeded
     * @param {string} [exp.notes] - Optional notes
     * @returns {Object} Updated material statistics
     */
    function recordOutcome(exp) {
        if (!exp || typeof exp.success !== 'boolean') {
            throw new Error('recordOutcome requires {success: boolean}');
        }
        var mat = (exp.material || 'unknown').toLowerCase().replace(/\s+/g, '_');
        var record = {
            material: mat,
            temperature: exp.temperature != null ? Number(exp.temperature) : null,
            cellDensity: exp.cellDensity != null ? Number(exp.cellDensity) : null,
            speed: exp.speed != null ? Number(exp.speed) : null,
            pressure: exp.pressure != null ? Number(exp.pressure) : null,
            layerHeight: exp.layerHeight != null ? Number(exp.layerHeight) : null,
            nozzleDiameter: exp.nozzleDiameter != null ? Number(exp.nozzleDiameter) : null,
            success: exp.success,
            notes: exp.notes || '',
            timestamp: Date.now()
        };
        outcomes.push(record);
        if (!outcomesByMaterial[mat]) outcomesByMaterial[mat] = [];
        outcomesByMaterial[mat].push(record);
        updateMaterialStats(mat, record.success);
        return { recorded: true, materialStats: materialStats[mat] };
    }

    /**
     * Predict success probability for a proposed experiment.
     * Combines profile-based parameter scoring with historical outcome data.
     *
     * @param {Object} params - Proposed experiment parameters
     * @returns {Object} Prediction result with probability, confidence, risks, suggestions
     */
    function predict(params) {
        if (!params) throw new Error('predict requires experiment parameters');
        var mat = (params.material || 'unknown').toLowerCase().replace(/\s+/g, '_');
        var profile = PARAM_PROFILES[mat] || null;

        // ── Profile-based score (how well params fit known optimal ranges) ──
        var profileScore = 1.0;
        var risks = [];
        var suggestions = [];

        if (profile) {
            var totalWeight = 0;
            var weightedDeviation = 0;
            var paramKeys = Object.keys(PARAM_WEIGHTS);
            for (var i = 0; i < paramKeys.length; i++) {
                var key = paramKeys[i];
                if (params[key] != null && profile[key]) {
                    var dev = rangeDeviation(params[key], profile[key]);
                    weightedDeviation += dev * PARAM_WEIGHTS[key];
                    totalWeight += PARAM_WEIGHTS[key];
                    if (dev > 0.3) {
                        risks.push({
                            parameter: key,
                            value: params[key],
                            optimalRange: profile[key].min + '–' + profile[key].max + ' ' + profile[key].unit,
                            severity: dev > 0.7 ? 'critical' : 'warning',
                            deviation: round2(dev)
                        });
                        var midpoint = (profile[key].min + profile[key].max) / 2;
                        suggestions.push(
                            'Adjust ' + key + ' closer to ' + round2(midpoint) + ' ' + profile[key].unit +
                            ' (optimal: ' + profile[key].min + '–' + profile[key].max + ')'
                        );
                    }
                }
            }
            if (totalWeight > 0) {
                profileScore = clamp(1 - (weightedDeviation / totalWeight), 0, 1);
            }
        } else {
            risks.push({
                parameter: 'material',
                value: mat,
                severity: 'info',
                deviation: 0,
                optimalRange: 'N/A — no profile for this material'
            });
            suggestions.push('Consider adding a parameter profile for "' + mat + '" to improve predictions');
        }

        // ── Historical score (Bayesian-like: use material success rate as prior) ──
        var stats = materialStats[mat];
        var historicalScore = 0.5; // uninformative prior
        var matchingOutcomes = 0;
        var confidence;

        if (stats && stats.total > 0) {
            // Base rate from material
            historicalScore = stats.rate;
            matchingOutcomes = stats.total;

            // Refine with similar-parameter experiments (within 20% of each param).
            // Uses the per-material index instead of scanning all outcomes,
            // reducing search space from O(total) to O(material-count).
            // Counts similar experiments and successes in a single pass
            // instead of collecting into an array then filtering again.
            var materialOutcomes = outcomesByMaterial[mat] || [];
            var similarCount = 0;
            var similarSuccesses = 0;
            for (var si = 0; si < materialOutcomes.length; si++) {
                var o = materialOutcomes[si];
                var close = true;
                for (var j = 0; j < SIMILAR_CHECK_KEYS.length; j++) {
                    var k = SIMILAR_CHECK_KEYS[j];
                    if (params[k] != null && o[k] != null) {
                        var ref = Math.abs(params[k]) || 1;
                        if (Math.abs(o[k] - params[k]) / ref > 0.2) {
                            close = false;
                            break;
                        }
                    }
                }
                if (close) {
                    similarCount++;
                    if (o.success) similarSuccesses++;
                }
            }

            if (similarCount >= 3) {
                historicalScore = similarSuccesses / similarCount;
                matchingOutcomes = similarCount;
            }
        }

        confidence = getConfidenceLevel(matchingOutcomes);

        // ── Combined probability ──
        // Weight historical data more as sample size grows
        var histWeight = clamp(matchingOutcomes / 20, 0.1, 0.7);
        var profWeight = 1 - histWeight;
        var probability = round2(clamp(profileScore * profWeight + historicalScore * histWeight, 0, 1));

        // ── Risk level ──
        var riskLevel;
        if (probability >= 0.8) riskLevel = 'LOW';
        else if (probability >= 0.6) riskLevel = 'MODERATE';
        else if (probability >= 0.4) riskLevel = 'ELEVATED';
        else if (probability >= 0.2) riskLevel = 'HIGH';
        else riskLevel = 'CRITICAL';

        // Sort risks by severity
        risks.sort(function (a, b) {
            var order = { critical: 0, warning: 1, info: 2 };
            return (order[a.severity] || 3) - (order[b.severity] || 3);
        });

        return {
            probability: probability,
            percentage: round2(probability * 100) + '%',
            riskLevel: riskLevel,
            confidence: confidence.label,
            confidenceDescription: confidence.description,
            matchingExperiments: matchingOutcomes,
            profileAvailable: !!profile,
            risks: risks,
            suggestions: suggestions,
            breakdown: {
                profileScore: round2(profileScore),
                historicalScore: round2(historicalScore),
                profileWeight: round2(profWeight),
                historicalWeight: round2(histWeight)
            }
        };
    }

    /**
     * Get summary statistics across all recorded experiments.
     * @returns {Object} Overall and per-material stats
     */
    function getStats() {
        var total = outcomes.length;
        var successes = outcomes.filter(function (o) { return o.success; }).length;
        var materials = Object.keys(materialStats).map(function (m) {
            return {
                material: m,
                total: materialStats[m].total,
                successes: materialStats[m].successes,
                rate: materialStats[m].rate != null ? round2(materialStats[m].rate * 100) + '%' : 'N/A'
            };
        });
        return {
            totalExperiments: total,
            overallSuccessRate: total ? round2((successes / total) * 100) + '%' : 'N/A',
            materials: materials
        };
    }

    /**
     * Identify the top risk factors from recent failures.
     * Proactively surfaces patterns that lead to failures.
     * @param {number} [recentN=20] - How many recent experiments to analyze
     * @returns {Object} Risk factor analysis with recommendations
     */
    function analyzeFailurePatterns(recentN) {
        var n = recentN || 20;
        var recent = outcomes.slice(-n);
        // Single-pass split into failures and successes (previously 2 filter passes)
        var failures = [];
        var successes = [];
        for (var r = 0; r < recent.length; r++) {
            if (recent[r].success) successes.push(recent[r]);
            else failures.push(recent[r]);
        }
        if (failures.length === 0) {
            return { patterns: [], message: 'No failures in recent ' + recent.length + ' experiments' };
        }
        var paramKeys = ['temperature', 'cellDensity', 'speed', 'pressure', 'layerHeight', 'nozzleDiameter'];
        var patterns = [];

        // Compute per-parameter averages in a single pass per group
        // instead of creating intermediate arrays with .map().filter()
        for (var i = 0; i < paramKeys.length; i++) {
            var key = paramKeys[i];
            var failSum = 0, failCount = 0;
            for (var fi = 0; fi < failures.length; fi++) {
                if (failures[fi][key] != null) { failSum += failures[fi][key]; failCount++; }
            }
            var succSum = 0, succCount = 0;
            for (var si2 = 0; si2 < successes.length; si2++) {
                if (successes[si2][key] != null) { succSum += successes[si2][key]; succCount++; }
            }
            if (failCount < 2 || succCount < 2) continue;

            var failAvg = failSum / failCount;
            var succAvg = succSum / succCount;
            var ref = Math.abs(succAvg) || 1;
            var drift = Math.abs(failAvg - succAvg) / ref;

            if (drift > 0.15) {
                patterns.push({
                    parameter: key,
                    failureAvg: round2(failAvg),
                    successAvg: round2(succAvg),
                    driftPercent: round2(drift * 100) + '%',
                    direction: failAvg > succAvg ? 'too high' : 'too low',
                    recommendation: 'Keep ' + key + ' closer to ' + round2(succAvg) + ' (failure avg: ' + round2(failAvg) + ')'
                });
            }
        }

        patterns.sort(function (a, b) { return parseFloat(b.driftPercent) - parseFloat(a.driftPercent); });

        return {
            recentExperiments: recent.length,
            failures: failures.length,
            failureRate: round2((failures.length / recent.length) * 100) + '%',
            patterns: patterns,
            message: patterns.length
                ? 'Found ' + patterns.length + ' parameter drift(s) correlated with failures'
                : 'No clear parameter patterns in failures — consider reviewing procedural factors'
        };
    }

    /**
     * Get list of supported material profiles.
     * @returns {string[]}
     */
    function getSupportedMaterials() {
        return Object.keys(PARAM_PROFILES);
    }

    /**
     * Bulk-load historical experiments.
     * @param {Array<Object>} experiments - Array of experiment records
     * @returns {Object} Load summary
     */
    function loadHistory(experiments) {
        if (!Array.isArray(experiments)) throw new Error('loadHistory requires an array');
        var loaded = 0;
        for (var i = 0; i < experiments.length; i++) {
            try {
                recordOutcome(experiments[i]);
                loaded++;
            } catch (e) { /* skip invalid */ }
        }
        return { loaded: loaded, total: experiments.length, skipped: experiments.length - loaded };
    }

    return {
        recordOutcome: recordOutcome,
        predict: predict,
        getStats: getStats,
        analyzeFailurePatterns: analyzeFailurePatterns,
        getSupportedMaterials: getSupportedMaterials,
        loadHistory: loadHistory
    };
}

module.exports = { createOutcomePredictor: createOutcomePredictor };
