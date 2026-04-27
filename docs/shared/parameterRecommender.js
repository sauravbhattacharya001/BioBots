'use strict';

var round = require('./validation').round;

/**
 * Print Parameter Recommender
 *
 * Autonomous multi-objective parameter optimizer for bioprinting.
 * Given desired goals (cell viability, resolution, structural integrity,
 * print time budget), recommends optimal parameter combinations by
 * evaluating a parameter space grid and computing Pareto-optimal
 * trade-off frontiers.
 *
 * Agentic capabilities:
 * - Goal-oriented: user specifies desired outcomes, system figures out parameters
 * - Autonomous exploration: searches parameter space without manual tuning
 * - Learning: records experiment feedback to refine future recommendations
 * - Proactive warnings: flags constraint violations and trade-off tensions
 *
 * @example
 *   var recommender = createPrintParameterRecommender();
 *   var result = recommender.recommend({
 *     material: 'alginate',
 *     goals: { viability: 0.9, resolution: 0.8, integrity: 0.7 },
 *     constraints: { maxPrintTimeMin: 60 }
 *   });
 *   // result.recommendations - ranked parameter sets
 *   // result.paretoFront - non-dominated solutions
 *   // result.warnings - trade-off tensions and constraint issues
 */

// ── Material parameter spaces ──────────────────────────────────────
// Defines the searchable parameter ranges per material, with scoring
// models for how each parameter affects viability/resolution/integrity.

var MATERIAL_PROFILES = {
    alginate: {
        label: 'Alginate',
        parameters: {
            pressure:       { min: 10, max: 50, step: 5, unit: 'kPa' },
            speed:          { min: 3,  max: 25, step: 2, unit: 'mm/s' },
            temperature:    { min: 20, max: 37, step: 1, unit: '°C' },
            nozzleDiameter: { min: 0.2, max: 0.8, step: 0.1, unit: 'mm' },
            layerHeight:    { min: 0.1, max: 0.5, step: 0.05, unit: 'mm' }
        },
        // Scoring models: how parameters map to objectives (0-1)
        viabilityModel: {
            // Lower pressure, lower speed, moderate temp → better viability
            pressure:    { optimal: 20, sigma: 15 },
            speed:       { optimal: 8,  sigma: 8  },
            temperature: { optimal: 37, sigma: 5  }
        },
        resolutionModel: {
            // Smaller nozzle, lower layer height, slower speed → better resolution
            nozzleDiameter: { optimal: 0.2, sigma: 0.2 },
            layerHeight:    { optimal: 0.1, sigma: 0.15 },
            speed:          { optimal: 5,   sigma: 8 }
        },
        integrityModel: {
            // Higher pressure, moderate speed, thicker layers → better structural integrity
            pressure:    { optimal: 40, sigma: 12 },
            layerHeight: { optimal: 0.35, sigma: 0.15 },
            speed:       { optimal: 12,  sigma: 6 }
        }
    },
    gelatin: {
        label: 'Gelatin / GelMA',
        parameters: {
            pressure:       { min: 15, max: 60, step: 5, unit: 'kPa' },
            speed:          { min: 2,  max: 20, step: 2, unit: 'mm/s' },
            temperature:    { min: 25, max: 37, step: 1, unit: '°C' },
            nozzleDiameter: { min: 0.25, max: 0.8, step: 0.1, unit: 'mm' },
            layerHeight:    { min: 0.15, max: 0.5, step: 0.05, unit: 'mm' }
        },
        viabilityModel: {
            pressure:    { optimal: 25, sigma: 15 },
            speed:       { optimal: 6,  sigma: 6  },
            temperature: { optimal: 32, sigma: 4  }
        },
        resolutionModel: {
            nozzleDiameter: { optimal: 0.25, sigma: 0.2 },
            layerHeight:    { optimal: 0.15, sigma: 0.15 },
            speed:          { optimal: 4,    sigma: 6 }
        },
        integrityModel: {
            pressure:    { optimal: 45, sigma: 12 },
            layerHeight: { optimal: 0.35, sigma: 0.15 },
            speed:       { optimal: 10,  sigma: 5 }
        }
    },
    collagen: {
        label: 'Collagen',
        parameters: {
            pressure:       { min: 5, max: 35, step: 5, unit: 'kPa' },
            speed:          { min: 1, max: 15, step: 1, unit: 'mm/s' },
            temperature:    { min: 4, max: 25, step: 1, unit: '°C' },
            nozzleDiameter: { min: 0.15, max: 0.6, step: 0.05, unit: 'mm' },
            layerHeight:    { min: 0.1, max: 0.35, step: 0.05, unit: 'mm' }
        },
        viabilityModel: {
            pressure:    { optimal: 12, sigma: 10 },
            speed:       { optimal: 4,  sigma: 5  },
            temperature: { optimal: 10, sigma: 8  }
        },
        resolutionModel: {
            nozzleDiameter: { optimal: 0.15, sigma: 0.15 },
            layerHeight:    { optimal: 0.1,  sigma: 0.1  },
            speed:          { optimal: 3,    sigma: 5 }
        },
        integrityModel: {
            pressure:    { optimal: 25, sigma: 10 },
            layerHeight: { optimal: 0.25, sigma: 0.1 },
            speed:       { optimal: 6,   sigma: 4 }
        }
    },
    fibrin: {
        label: 'Fibrin',
        parameters: {
            pressure:       { min: 8,  max: 40, step: 4, unit: 'kPa' },
            speed:          { min: 3,  max: 18, step: 2, unit: 'mm/s' },
            temperature:    { min: 20, max: 37, step: 1, unit: '°C' },
            nozzleDiameter: { min: 0.2, max: 0.6, step: 0.1, unit: 'mm' },
            layerHeight:    { min: 0.1, max: 0.4, step: 0.05, unit: 'mm' }
        },
        viabilityModel: {
            pressure:    { optimal: 18, sigma: 12 },
            speed:       { optimal: 7,  sigma: 6  },
            temperature: { optimal: 37, sigma: 5  }
        },
        resolutionModel: {
            nozzleDiameter: { optimal: 0.2, sigma: 0.15 },
            layerHeight:    { optimal: 0.1, sigma: 0.12 },
            speed:          { optimal: 5,   sigma: 6 }
        },
        integrityModel: {
            pressure:    { optimal: 30, sigma: 10 },
            layerHeight: { optimal: 0.3, sigma: 0.12 },
            speed:       { optimal: 10,  sigma: 5 }
        }
    },
    hyaluronic_acid: {
        label: 'Hyaluronic Acid',
        parameters: {
            pressure:       { min: 8,  max: 40, step: 4, unit: 'kPa' },
            speed:          { min: 2,  max: 12, step: 1, unit: 'mm/s' },
            temperature:    { min: 20, max: 37, step: 1, unit: '°C' },
            nozzleDiameter: { min: 0.2, max: 0.5, step: 0.05, unit: 'mm' },
            layerHeight:    { min: 0.1, max: 0.35, step: 0.05, unit: 'mm' }
        },
        viabilityModel: {
            pressure:    { optimal: 15, sigma: 10 },
            speed:       { optimal: 5,  sigma: 4  },
            temperature: { optimal: 37, sigma: 5  }
        },
        resolutionModel: {
            nozzleDiameter: { optimal: 0.2, sigma: 0.12 },
            layerHeight:    { optimal: 0.1, sigma: 0.1  },
            speed:          { optimal: 3,   sigma: 4 }
        },
        integrityModel: {
            pressure:    { optimal: 30, sigma: 10 },
            layerHeight: { optimal: 0.25, sigma: 0.1 },
            speed:       { optimal: 8,   sigma: 4 }
        }
    }
};

// ── Gaussian scoring function ──────────────────────────────────────
function gaussianScore(value, optimal, sigma) {
    var diff = value - optimal;
    return Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

// ── Parameter space grid generator ─────────────────────────────────
function generateGrid(params, maxCandidates) {
    var keys = Object.keys(params);
    var ranges = keys.map(function (k) {
        var p = params[k];
        var vals = [];
        for (var v = p.min; v <= p.max + p.step * 0.01; v += p.step) {
            vals.push(round(v, 3));
        }
        return vals;
    });

    // If full grid is too large, sample uniformly
    var totalSize = 1;
    for (var i = 0; i < ranges.length; i++) {
        totalSize *= ranges[i].length;
    }

    var candidates = [];
    if (totalSize <= (maxCandidates || 5000)) {
        // Full grid
        var indices = new Array(keys.length).fill(0);
        for (var c = 0; c < totalSize; c++) {
            var point = {};
            for (var j = 0; j < keys.length; j++) {
                point[keys[j]] = ranges[j][indices[j]];
            }
            candidates.push(point);
            // Increment indices (odometer style)
            for (var k = keys.length - 1; k >= 0; k--) {
                indices[k]++;
                if (indices[k] < ranges[k].length) break;
                indices[k] = 0;
            }
        }
    } else {
        // Random sampling
        var limit = maxCandidates || 5000;
        for (var s = 0; s < limit; s++) {
            var pt = {};
            for (var m = 0; m < keys.length; m++) {
                var arr = ranges[m];
                pt[keys[m]] = arr[Math.floor(Math.random() * arr.length)];
            }
            candidates.push(pt);
        }
    }
    return candidates;
}

// ── Objective scorer ───────────────────────────────────────────────
function scoreObjective(model, params) {
    var keys = Object.keys(model);
    if (keys.length === 0) return 0;
    var sum = 0;
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (params[k] !== undefined) {
            sum += gaussianScore(params[k], model[k].optimal, model[k].sigma);
        }
    }
    return sum / keys.length;
}

// ── Pareto front extraction ────────────────────────────────────────
function dominates(a, b) {
    // a dominates b if a is >= b in all objectives and > in at least one
    var dominated = false;
    var strictlyBetter = false;
    if (a.viabilityScore < b.viabilityScore) dominated = true;
    if (a.resolutionScore < b.resolutionScore) dominated = true;
    if (a.integrityScore < b.integrityScore) dominated = true;
    if (a.viabilityScore > b.viabilityScore) strictlyBetter = true;
    if (a.resolutionScore > b.resolutionScore) strictlyBetter = true;
    if (a.integrityScore > b.integrityScore) strictlyBetter = true;
    return !dominated && strictlyBetter;
}

function extractParetoFront(scored) {
    var front = [];
    for (var i = 0; i < scored.length; i++) {
        var dominated = false;
        for (var j = 0; j < scored.length; j++) {
            if (i !== j && dominates(scored[j], scored[i])) {
                dominated = true;
                break;
            }
        }
        if (!dominated) {
            front.push(scored[i]);
        }
    }
    return front;
}

// ── Main factory ───────────────────────────────────────────────────

/**
 * Create a Print Parameter Recommender instance.
 *
 * @returns {Object} Recommender with recommend(), feedback(), analyze(), listMaterials()
 */
function createPrintParameterRecommender() {
    var feedbackHistory = [];

    /**
     * Recommend optimal print parameters for given goals.
     *
     * @param {Object} opts
     * @param {string} opts.material - Material key (alginate, gelatin, collagen, fibrin, hyaluronic_acid)
     * @param {Object} opts.goals - Target scores 0-1 for each objective
     * @param {number} [opts.goals.viability=0.8] - Cell viability target
     * @param {number} [opts.goals.resolution=0.7] - Print resolution target
     * @param {number} [opts.goals.integrity=0.7] - Structural integrity target
     * @param {Object} [opts.constraints] - Hard constraints
     * @param {number} [opts.constraints.maxPressure] - Max pressure kPa
     * @param {number} [opts.constraints.maxSpeed] - Max speed mm/s
     * @param {number} [opts.constraints.minNozzle] - Min nozzle diameter mm
     * @param {number} [opts.constraints.maxNozzle] - Max nozzle diameter mm
     * @param {Object} [opts.weights] - Objective weights (default equal)
     * @param {number} [opts.weights.viability=1]
     * @param {number} [opts.weights.resolution=1]
     * @param {number} [opts.weights.integrity=1]
     * @param {number} [opts.topN=5] - Number of top recommendations
     * @returns {Object} Recommendation result
     */
    function recommend(opts) {
        if (!opts || !opts.material) {
            throw new Error('material is required');
        }
        var materialKey = opts.material.toLowerCase().replace(/[\s-]/g, '_');
        var profile = MATERIAL_PROFILES[materialKey];
        if (!profile) {
            throw new Error(
                'Unknown material: ' + opts.material +
                '. Available: ' + Object.keys(MATERIAL_PROFILES).join(', ')
            );
        }

        var goals = opts.goals || {};
        var viabilityGoal = typeof goals.viability === 'number' ? goals.viability : 0.8;
        var resolutionGoal = typeof goals.resolution === 'number' ? goals.resolution : 0.7;
        var integrityGoal = typeof goals.integrity === 'number' ? goals.integrity : 0.7;

        var weights = opts.weights || {};
        var wV = typeof weights.viability === 'number' ? weights.viability : 1;
        var wR = typeof weights.resolution === 'number' ? weights.resolution : 1;
        var wI = typeof weights.integrity === 'number' ? weights.integrity : 1;
        var wTotal = wV + wR + wI;
        if (wTotal === 0) wTotal = 1;

        var constraints = opts.constraints || {};
        var topN = opts.topN || 5;

        // Generate candidate parameter grid
        var candidates = generateGrid(profile.parameters, 5000);

        // Score each candidate
        var scored = [];
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];

            // Apply hard constraints
            if (constraints.maxPressure && c.pressure > constraints.maxPressure) continue;
            if (constraints.maxSpeed && c.speed > constraints.maxSpeed) continue;
            if (constraints.minNozzle && c.nozzleDiameter < constraints.minNozzle) continue;
            if (constraints.maxNozzle && c.nozzleDiameter > constraints.maxNozzle) continue;

            var vScore = scoreObjective(profile.viabilityModel, c);
            var rScore = scoreObjective(profile.resolutionModel, c);
            var iScore = scoreObjective(profile.integrityModel, c);

            // Weighted composite score (goal-distance-weighted)
            var composite = (
                wV * (1 - Math.abs(vScore - viabilityGoal)) +
                wR * (1 - Math.abs(rScore - resolutionGoal)) +
                wI * (1 - Math.abs(iScore - integrityGoal))
            ) / wTotal;

            // Apply feedback learning bonus
            var feedbackBonus = computeFeedbackBonus(materialKey, c);

            scored.push({
                parameters: c,
                viabilityScore: round(vScore, 4),
                resolutionScore: round(rScore, 4),
                integrityScore: round(iScore, 4),
                compositeScore: round(composite + feedbackBonus, 4),
                feedbackBonus: round(feedbackBonus, 4)
            });
        }

        // Sort by composite score descending
        scored.sort(function (a, b) { return b.compositeScore - a.compositeScore; });

        // Extract Pareto front
        var paretoFront = extractParetoFront(scored);
        paretoFront.sort(function (a, b) { return b.compositeScore - a.compositeScore; });

        // Take top N recommendations
        var recommendations = scored.slice(0, Math.min(topN, scored.length));

        // Generate warnings
        var warnings = generateWarnings(
            recommendations, viabilityGoal, resolutionGoal, integrityGoal, profile
        );

        // Generate proactive insights
        var insights = generateInsights(
            recommendations, paretoFront, feedbackHistory, materialKey
        );

        return {
            material: profile.label,
            materialKey: materialKey,
            goals: {
                viability: viabilityGoal,
                resolution: resolutionGoal,
                integrity: integrityGoal
            },
            candidatesEvaluated: scored.length,
            recommendations: recommendations,
            paretoFront: paretoFront.slice(0, 10),
            warnings: warnings,
            insights: insights,
            feedbackRecordsUsed: feedbackHistory.filter(function (f) {
                return f.material === materialKey;
            }).length
        };
    }

    /**
     * Record experiment feedback to improve future recommendations.
     *
     * @param {Object} feedback
     * @param {string} feedback.material - Material used
     * @param {Object} feedback.parameters - Parameters used
     * @param {number} feedback.actualViability - Observed viability 0-1
     * @param {number} feedback.actualResolution - Observed resolution quality 0-1
     * @param {number} feedback.actualIntegrity - Observed structural integrity 0-1
     * @param {string} [feedback.notes] - Optional notes
     * @returns {Object} Confirmation with feedback count
     */
    function feedback(fb) {
        if (!fb || !fb.material || !fb.parameters) {
            throw new Error('material and parameters are required for feedback');
        }
        feedbackHistory.push({
            material: fb.material.toLowerCase().replace(/[\s-]/g, '_'),
            parameters: fb.parameters,
            actualViability: fb.actualViability || 0,
            actualResolution: fb.actualResolution || 0,
            actualIntegrity: fb.actualIntegrity || 0,
            notes: fb.notes || '',
            timestamp: Date.now()
        });
        return {
            recorded: true,
            totalFeedback: feedbackHistory.length,
            materialFeedback: feedbackHistory.filter(function (f) {
                return f.material === fb.material.toLowerCase().replace(/[\s-]/g, '_');
            }).length
        };
    }

    /**
     * Compute a small bonus/penalty based on prior feedback for similar parameters.
     */
    function computeFeedbackBonus(materialKey, params) {
        var relevant = feedbackHistory.filter(function (f) {
            return f.material === materialKey;
        });
        if (relevant.length === 0) return 0;

        var bonus = 0;
        var count = 0;
        for (var i = 0; i < relevant.length; i++) {
            var fb = relevant[i];
            var distance = parameterDistance(params, fb.parameters);
            if (distance < 0.3) {
                // Close parameters — use feedback as signal
                var avgActual = (fb.actualViability + fb.actualResolution + fb.actualIntegrity) / 3;
                var weight = 1 - distance; // closer → stronger weight
                bonus += (avgActual - 0.5) * 0.1 * weight;
                count++;
            }
        }
        return count > 0 ? bonus / count : 0;
    }

    /**
     * Normalized parameter distance (0-1 range).
     */
    function parameterDistance(a, b) {
        var keys = Object.keys(a);
        if (keys.length === 0) return 1;
        var sum = 0;
        var n = 0;
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (b[k] !== undefined) {
                // Normalize assuming reasonable ranges
                var range = Math.max(Math.abs(a[k]), Math.abs(b[k]), 1);
                sum += Math.abs(a[k] - b[k]) / range;
                n++;
            }
        }
        return n > 0 ? sum / n : 1;
    }

    /**
     * Generate warnings about trade-offs and goal tensions.
     */
    function generateWarnings(recommendations, vGoal, rGoal, iGoal, profile) {
        var warnings = [];

        if (recommendations.length === 0) {
            warnings.push({
                level: 'error',
                message: 'No valid parameter combinations found. Try relaxing constraints.'
            });
            return warnings;
        }

        var best = recommendations[0];

        // Check if goals are achievable
        if (best.viabilityScore < vGoal * 0.7) {
            warnings.push({
                level: 'warning',
                message: 'Viability goal (' + vGoal + ') may be difficult to achieve with ' +
                    profile.label + '. Best predicted: ' + best.viabilityScore
            });
        }
        if (best.resolutionScore < rGoal * 0.7) {
            warnings.push({
                level: 'warning',
                message: 'Resolution goal (' + rGoal + ') may be difficult to achieve. ' +
                    'Best predicted: ' + best.resolutionScore
            });
        }
        if (best.integrityScore < iGoal * 0.7) {
            warnings.push({
                level: 'warning',
                message: 'Integrity goal (' + iGoal + ') may be difficult to achieve. ' +
                    'Best predicted: ' + best.integrityScore
            });
        }

        // Detect trade-off tensions
        if (vGoal > 0.8 && iGoal > 0.8) {
            warnings.push({
                level: 'info',
                message: 'High viability + high integrity is a classic tension. ' +
                    'Viability prefers low pressure; integrity prefers high pressure. ' +
                    'Consider a moderate pressure compromise or multi-material approach.'
            });
        }
        if (rGoal > 0.8 && iGoal > 0.8) {
            warnings.push({
                level: 'info',
                message: 'High resolution + high integrity can conflict on layer height. ' +
                    'Resolution prefers thin layers; integrity prefers thicker ones.'
            });
        }

        return warnings;
    }

    /**
     * Generate proactive insights from the recommendation landscape.
     */
    function generateInsights(recommendations, paretoFront, history, materialKey) {
        var insights = [];

        if (paretoFront.length > 0) {
            // Pareto front diversity
            var vRange = spread(paretoFront, 'viabilityScore');
            var rRange = spread(paretoFront, 'resolutionScore');
            var iRange = spread(paretoFront, 'integrityScore');

            if (vRange > 0.3 || rRange > 0.3 || iRange > 0.3) {
                insights.push({
                    type: 'diversity',
                    message: 'The Pareto front shows wide trade-off space. ' +
                        'Multiple distinct strategies are available — ' +
                        'prioritize based on your most critical objective.'
                });
            } else {
                insights.push({
                    type: 'convergence',
                    message: 'The Pareto front is tight — most optimal solutions ' +
                        'converge on similar parameters. Strong consensus in the search space.'
                });
            }
        }

        // Sensitivity insight
        if (recommendations.length >= 2) {
            var top = recommendations[0];
            var second = recommendations[1];
            var scoreDiff = Math.abs(top.compositeScore - second.compositeScore);
            if (scoreDiff < 0.01) {
                insights.push({
                    type: 'sensitivity',
                    message: 'Top recommendations are nearly identical in score. ' +
                        'Parameters are robust — small variations won\'t significantly impact results.'
                });
            }
        }

        // Feedback insight
        var matFeedback = history.filter(function (f) { return f.material === materialKey; });
        if (matFeedback.length > 0) {
            var avgSuccess = matFeedback.reduce(function (sum, f) {
                return sum + (f.actualViability + f.actualResolution + f.actualIntegrity) / 3;
            }, 0) / matFeedback.length;
            insights.push({
                type: 'learning',
                message: 'Based on ' + matFeedback.length + ' feedback record(s) for this material, ' +
                    'average observed performance is ' + round(avgSuccess, 2) +
                    '. Recommendations are adjusted accordingly.'
            });
        } else {
            insights.push({
                type: 'learning',
                message: 'No feedback recorded yet for this material. ' +
                    'Use feedback() after experiments to improve future recommendations.'
            });
        }

        return insights;
    }

    /**
     * Calculate value spread (max - min) for a property in an array.
     */
    function spread(arr, prop) {
        if (arr.length === 0) return 0;
        var min = arr[0][prop];
        var max = arr[0][prop];
        for (var i = 1; i < arr.length; i++) {
            if (arr[i][prop] < min) min = arr[i][prop];
            if (arr[i][prop] > max) max = arr[i][prop];
        }
        return max - min;
    }

    /**
     * Analyze a specific parameter set without optimization.
     * Returns predicted scores for given parameters.
     *
     * @param {Object} opts
     * @param {string} opts.material - Material key
     * @param {Object} opts.parameters - Specific parameters to analyze
     * @returns {Object} Analysis result with predicted scores and notes
     */
    function analyze(opts) {
        if (!opts || !opts.material || !opts.parameters) {
            throw new Error('material and parameters are required');
        }
        var materialKey = opts.material.toLowerCase().replace(/[\s-]/g, '_');
        var profile = MATERIAL_PROFILES[materialKey];
        if (!profile) {
            throw new Error('Unknown material: ' + opts.material);
        }
        var p = opts.parameters;

        var vScore = scoreObjective(profile.viabilityModel, p);
        var rScore = scoreObjective(profile.resolutionModel, p);
        var iScore = scoreObjective(profile.integrityModel, p);

        // Parameter boundary check
        var outOfRange = [];
        var paramDefs = profile.parameters;
        var paramKeys = Object.keys(p);
        for (var i = 0; i < paramKeys.length; i++) {
            var k = paramKeys[i];
            if (paramDefs[k]) {
                if (p[k] < paramDefs[k].min || p[k] > paramDefs[k].max) {
                    outOfRange.push({
                        parameter: k,
                        value: p[k],
                        validRange: { min: paramDefs[k].min, max: paramDefs[k].max },
                        unit: paramDefs[k].unit
                    });
                }
            }
        }

        return {
            material: profile.label,
            parameters: p,
            predictedScores: {
                viability: round(vScore, 4),
                resolution: round(rScore, 4),
                integrity: round(iScore, 4),
                overall: round((vScore + rScore + iScore) / 3, 4)
            },
            outOfRange: outOfRange,
            notes: outOfRange.length > 0
                ? outOfRange.length + ' parameter(s) outside recommended range for ' + profile.label
                : 'All parameters within recommended range'
        };
    }

    /**
     * Compare two parameter sets side by side.
     *
     * @param {Object} opts
     * @param {string} opts.material - Material key
     * @param {Object} opts.setA - First parameter set
     * @param {Object} opts.setB - Second parameter set
     * @returns {Object} Comparison result
     */
    function compare(opts) {
        if (!opts || !opts.material || !opts.setA || !opts.setB) {
            throw new Error('material, setA, and setB are required');
        }
        var analysisA = analyze({ material: opts.material, parameters: opts.setA });
        var analysisB = analyze({ material: opts.material, parameters: opts.setB });

        var winner = {};
        var objectives = ['viability', 'resolution', 'integrity', 'overall'];
        for (var i = 0; i < objectives.length; i++) {
            var obj = objectives[i];
            var diff = analysisA.predictedScores[obj] - analysisB.predictedScores[obj];
            winner[obj] = diff > 0.01 ? 'A' : diff < -0.01 ? 'B' : 'tie';
        }

        return {
            setA: analysisA,
            setB: analysisB,
            winner: winner,
            recommendation: winner.overall === 'tie'
                ? 'Both sets perform similarly overall. Choose based on your priority objective.'
                : 'Set ' + winner.overall + ' is recommended for better overall performance.'
        };
    }

    /**
     * List available materials and their parameter ranges.
     *
     * @returns {Object[]} Material descriptions
     */
    function listMaterials() {
        return Object.keys(MATERIAL_PROFILES).map(function (key) {
            var p = MATERIAL_PROFILES[key];
            return {
                key: key,
                label: p.label,
                parameters: Object.keys(p.parameters).map(function (pk) {
                    return {
                        name: pk,
                        min: p.parameters[pk].min,
                        max: p.parameters[pk].max,
                        step: p.parameters[pk].step,
                        unit: p.parameters[pk].unit
                    };
                })
            };
        });
    }

    return {
        recommend: recommend,
        feedback: feedback,
        analyze: analyze,
        compare: compare,
        listMaterials: listMaterials
    };
}

module.exports = { createPrintParameterRecommender: createPrintParameterRecommender };
