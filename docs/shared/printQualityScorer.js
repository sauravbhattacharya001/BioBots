'use strict';

/**
 * Print Quality Scorer — evaluates completed bioprint results and assigns
 * composite quality scores with detailed per-dimension breakdowns.
 *
 * Dimensions scored:
 *   1. Cell Viability — livePercent / deadPercent ratio
 *   2. Structural Integrity — elasticity relative to targets
 *   3. Crosslinking Quality — duration and intensity appropriateness
 *   4. Resolution Fidelity — layer height precision, layer count adequacy
 *   5. Pressure Consistency — extruder pressures within optimal ranges
 *
 * Each dimension produces a 0-100 sub-score. A weighted composite score
 * is computed, and a letter grade (A+ through F) is assigned.
 *
 * Usage:
 *   var scorer = createPrintQualityScorer();
 *   var result = scorer.score(printRecord);
 *   console.log(result.grade, result.composite);
 *
 *   // Batch scoring
 *   var batch = scorer.scoreBatch(printRecords);
 *   console.log(batch.summary);
 *
 *   // Compare two prints
 *   var diff = scorer.compare(printA, printB);
 *
 * @module printQualityScorer
 */
function createPrintQualityScorer(options) {
    options = options || {};

    // ── Configurable weights (must sum to 1.0) ──────────────────
    var weights = _normalizeWeights(options.weights || {
        viability: 0.35,
        structural: 0.20,
        crosslinking: 0.15,
        resolution: 0.15,
        pressure: 0.15
    });

    // ── Target parameters (configurable) ────────────────────────
    var targets = {
        viability: {
            idealLivePercent: _num(options.idealLivePercent, 85),
            criticalLivePercent: _num(options.criticalLivePercent, 50),
            idealDeadPercent: _num(options.idealDeadPercent, 10),
            maxAcceptableDead: _num(options.maxAcceptableDead, 40)
        },
        structural: {
            idealElasticity: _num(options.idealElasticity, 50),
            minElasticity: _num(options.minElasticity, 10),
            maxElasticity: _num(options.maxElasticity, 200)
        },
        crosslinking: {
            idealDuration: _num(options.idealDuration, 15000),
            minDuration: _num(options.minDuration, 5000),
            maxDuration: _num(options.maxDuration, 45000),
            idealIntensity: _num(options.idealIntensity, 50),
            minIntensity: _num(options.minIntensity, 10),
            maxIntensity: _num(options.maxIntensity, 90)
        },
        resolution: {
            idealLayerHeight: _num(options.idealLayerHeight, 0.2),
            maxLayerHeight: _num(options.maxLayerHeight, 1.0),
            minLayers: _num(options.minLayers, 10),
            idealLayers: _num(options.idealLayers, 30)
        },
        pressure: {
            idealPressure: _num(options.idealPressure, 80),
            minPressure: _num(options.minPressure, 20),
            maxPressure: _num(options.maxPressure, 150),
            maxImbalance: _num(options.maxImbalance, 30)
        }
    };

    // ── Helpers ──────────────────────────────────────────────────

    function _num(v, d) { return (v != null && typeof v === 'number' && !isNaN(v)) ? v : d; }
    function _r(v, d) { var f = Math.pow(10, d || 1); return Math.round(v * f) / f; }
    function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    /** Linear interpolation score: 0 at low, 100 at high */
    function _linearScore(value, low, high) {
        if (high === low) return value >= high ? 100 : 0;
        return _clamp((value - low) / (high - low) * 100, 0, 100);
    }

    /** Gaussian score: 100 at ideal, decays with distance */
    function _gaussianScore(value, ideal, sigma) {
        var diff = value - ideal;
        return 100 * Math.exp(-(diff * diff) / (2 * sigma * sigma));
    }

    /** Normalize weights to sum to 1.0 */
    function _normalizeWeights(w) {
        var keys = ['viability', 'structural', 'crosslinking', 'resolution', 'pressure'];
        var sum = 0;
        var result = {};
        for (var i = 0; i < keys.length; i++) {
            result[keys[i]] = w[keys[i]] || 0.2;
            sum += result[keys[i]];
        }
        if (sum > 0) {
            for (var j = 0; j < keys.length; j++) {
                result[keys[j]] /= sum;
            }
        }
        return result;
    }

    /** Assign letter grade from composite score */
    function _grade(score) {
        if (score >= 97) return 'A+';
        if (score >= 93) return 'A';
        if (score >= 90) return 'A-';
        if (score >= 87) return 'B+';
        if (score >= 83) return 'B';
        if (score >= 80) return 'B-';
        if (score >= 77) return 'C+';
        if (score >= 73) return 'C';
        if (score >= 70) return 'C-';
        if (score >= 67) return 'D+';
        if (score >= 63) return 'D';
        if (score >= 60) return 'D-';
        return 'F';
    }

    /** Map grade to qualitative descriptor */
    function _gradeLabel(grade) {
        if (grade.charAt(0) === 'A') return 'Excellent';
        if (grade.charAt(0) === 'B') return 'Good';
        if (grade.charAt(0) === 'C') return 'Acceptable';
        if (grade.charAt(0) === 'D') return 'Poor';
        return 'Failing';
    }

    // ── Dimension scorers ───────────────────────────────────────

    /**
     * Score cell viability outcome.
     * High livePercent → high score. High deadPercent → penalty.
     */
    function _scoreViability(printData) {
        var live = printData.livePercent;
        var dead = printData.deadPercent;

        if (live == null || dead == null) {
            return { score: 0, details: 'Missing viability data', flags: ['missing_data'] };
        }

        // Live cell score (0-100 linear from critical to ideal)
        var liveScore = _linearScore(live, targets.viability.criticalLivePercent, targets.viability.idealLivePercent);

        // Dead cell penalty (invert: low dead = high score)
        var deadPenalty = _linearScore(dead, targets.viability.idealDeadPercent, targets.viability.maxAcceptableDead);
        var deadScore = 100 - deadPenalty;

        // Combine: 70% live contribution, 30% dead penalty
        var combined = liveScore * 0.7 + deadScore * 0.3;

        var flags = [];
        if (live < targets.viability.criticalLivePercent) flags.push('low_viability');
        if (dead > targets.viability.maxAcceptableDead) flags.push('high_mortality');
        if (live + dead > 105) flags.push('data_inconsistency');

        return {
            score: _r(combined),
            livePercent: live,
            deadPercent: dead,
            liveScore: _r(liveScore),
            deadScore: _r(deadScore),
            details: live >= targets.viability.idealLivePercent ? 'Excellent viability' :
                     live >= targets.viability.criticalLivePercent ? 'Acceptable viability' :
                     'Below critical threshold',
            flags: flags
        };
    }

    /**
     * Score structural integrity from elasticity.
     * Uses Gaussian around ideal with asymmetric penalties.
     */
    function _scoreStructural(printData) {
        var e = printData.elasticity;

        if (e == null) {
            return { score: 0, details: 'Missing elasticity data', flags: ['missing_data'] };
        }

        var flags = [];

        // Gaussian centered on ideal, sigma based on range
        var sigma = (targets.structural.maxElasticity - targets.structural.minElasticity) / 4;
        var gaussScore = _gaussianScore(e, targets.structural.idealElasticity, sigma);

        // Additional penalty for out-of-range values
        if (e < targets.structural.minElasticity) {
            gaussScore *= 0.5;
            flags.push('too_soft');
        }
        if (e > targets.structural.maxElasticity) {
            gaussScore *= 0.5;
            flags.push('too_rigid');
        }

        return {
            score: _r(gaussScore),
            elasticity: e,
            idealElasticity: targets.structural.idealElasticity,
            deviation: _r(Math.abs(e - targets.structural.idealElasticity)),
            details: gaussScore >= 80 ? 'Good structural properties' :
                     gaussScore >= 50 ? 'Acceptable structure' :
                     'Structural concerns',
            flags: flags
        };
    }

    /**
     * Score crosslinking quality from duration and intensity.
     * Both must be in range; over-crosslinking is penalized.
     */
    function _scoreCrosslinking(printInfo) {
        var cl = printInfo.crosslinking;
        if (!cl) {
            return { score: 0, details: 'No crosslinking data', flags: ['missing_data'] };
        }

        // If crosslinking is disabled, neutral score
        if (!cl.cl_enabled) {
            return {
                score: 50,
                details: 'Crosslinking disabled — neutral score',
                durationScore: 50,
                intensityScore: 50,
                flags: ['crosslinking_disabled']
            };
        }

        var dur = cl.cl_duration;
        var inten = cl.cl_intensity;
        var flags = [];

        // Duration score: Gaussian around ideal
        var durSigma = (targets.crosslinking.maxDuration - targets.crosslinking.minDuration) / 4;
        var durScore = _gaussianScore(dur, targets.crosslinking.idealDuration, durSigma);
        if (dur < targets.crosslinking.minDuration) {
            durScore *= 0.6;
            flags.push('under_crosslinked');
        }
        if (dur > targets.crosslinking.maxDuration) {
            durScore *= 0.6;
            flags.push('over_crosslinked');
        }

        // Intensity score: Gaussian around ideal
        var intSigma = (targets.crosslinking.maxIntensity - targets.crosslinking.minIntensity) / 4;
        var intScore = _gaussianScore(inten, targets.crosslinking.idealIntensity, intSigma);
        if (inten < targets.crosslinking.minIntensity) {
            intScore *= 0.6;
            flags.push('low_intensity');
        }
        if (inten > targets.crosslinking.maxIntensity) {
            intScore *= 0.6;
            flags.push('high_intensity');
        }

        var combined = durScore * 0.5 + intScore * 0.5;

        return {
            score: _r(combined),
            duration: dur,
            intensity: inten,
            durationScore: _r(durScore),
            intensityScore: _r(intScore),
            details: combined >= 80 ? 'Good crosslinking parameters' :
                     combined >= 50 ? 'Acceptable crosslinking' :
                     'Crosslinking concerns',
            flags: flags
        };
    }

    /**
     * Score print resolution from layer height and layer count.
     * Finer layers and more layers → better fidelity.
     */
    function _scoreResolution(printInfo) {
        var res = printInfo.resolution;
        if (!res) {
            return { score: 0, details: 'Missing resolution data', flags: ['missing_data'] };
        }

        var height = res.layerHeight;
        var layers = res.layerNum;
        var flags = [];

        // Layer height score: lower is better (to a point)
        var heightScore = 100;
        if (height > targets.resolution.maxLayerHeight) {
            heightScore = 20;
            flags.push('coarse_layers');
        } else if (height > targets.resolution.idealLayerHeight) {
            heightScore = _linearScore(
                targets.resolution.maxLayerHeight - height,
                0,
                targets.resolution.maxLayerHeight - targets.resolution.idealLayerHeight
            );
        }
        // Extremely fine layers might also cause issues
        if (height < 0.05) {
            heightScore *= 0.8;
            flags.push('ultra_fine_layers');
        }

        // Layer count score
        var layerScore = 100;
        if (layers < targets.resolution.minLayers) {
            layerScore = _linearScore(layers, 0, targets.resolution.minLayers);
            flags.push('few_layers');
        } else if (layers < targets.resolution.idealLayers) {
            layerScore = _linearScore(layers, targets.resolution.minLayers, targets.resolution.idealLayers);
            layerScore = 60 + layerScore * 0.4; // base 60 if above min
        }

        var combined = heightScore * 0.6 + layerScore * 0.4;

        return {
            score: _r(combined),
            layerHeight: height,
            layerNum: layers,
            heightScore: _r(heightScore),
            layerScore: _r(layerScore),
            details: combined >= 80 ? 'Good resolution' :
                     combined >= 50 ? 'Acceptable resolution' :
                     'Resolution concerns',
            flags: flags
        };
    }

    /**
     * Score extruder pressure consistency.
     * Both extruders should be in optimal range and balanced.
     */
    function _scorePressure(printInfo) {
        var pressure = printInfo.pressure;
        if (!pressure) {
            return { score: 0, details: 'Missing pressure data', flags: ['missing_data'] };
        }

        var e1 = pressure.extruder1;
        var e2 = pressure.extruder2;
        var flags = [];

        // Score each extruder: Gaussian around ideal
        var pSigma = (targets.pressure.maxPressure - targets.pressure.minPressure) / 4;
        var e1Score = _gaussianScore(e1, targets.pressure.idealPressure, pSigma);
        var e2Score = _gaussianScore(e2, targets.pressure.idealPressure, pSigma);

        // Penalty for out of range
        if (e1 < targets.pressure.minPressure || e1 > targets.pressure.maxPressure) {
            e1Score *= 0.5;
            flags.push('extruder1_out_of_range');
        }
        if (e2 < targets.pressure.minPressure || e2 > targets.pressure.maxPressure) {
            e2Score *= 0.5;
            flags.push('extruder2_out_of_range');
        }

        // Imbalance penalty
        var imbalance = Math.abs(e1 - e2);
        var balanceScore = 100;
        if (imbalance > targets.pressure.maxImbalance) {
            balanceScore = _linearScore(
                targets.pressure.maxImbalance * 2 - imbalance,
                0,
                targets.pressure.maxImbalance
            );
            flags.push('pressure_imbalance');
        }

        var combined = (e1Score + e2Score) / 2 * 0.7 + balanceScore * 0.3;

        return {
            score: _r(combined),
            extruder1: e1,
            extruder2: e2,
            imbalance: _r(imbalance),
            e1Score: _r(e1Score),
            e2Score: _r(e2Score),
            balanceScore: _r(balanceScore),
            details: combined >= 80 ? 'Good pressure settings' :
                     combined >= 50 ? 'Acceptable pressure' :
                     'Pressure concerns',
            flags: flags
        };
    }

    // ── Public API ──────────────────────────────────────────────

    /**
     * Score a single print record.
     *
     * @param {Object} record - A print record with print_data and print_info
     * @returns {Object} Score result with composite, grade, and dimension breakdowns
     */
    function score(record) {
        if (!record || typeof record !== 'object') {
            throw new Error('Record must be a non-null object');
        }
        if (!record.print_data || typeof record.print_data !== 'object') {
            throw new Error('Record must have print_data object');
        }
        if (!record.print_info || typeof record.print_info !== 'object') {
            throw new Error('Record must have print_info object');
        }

        var viability = _scoreViability(record.print_data);
        var structural = _scoreStructural(record.print_data);
        var crosslinking = _scoreCrosslinking(record.print_info);
        var resolution = _scoreResolution(record.print_info);
        var pressure = _scorePressure(record.print_info);

        var composite = _r(
            viability.score * weights.viability +
            structural.score * weights.structural +
            crosslinking.score * weights.crosslinking +
            resolution.score * weights.resolution +
            pressure.score * weights.pressure
        );

        var allFlags = [].concat(
            viability.flags, structural.flags,
            crosslinking.flags, resolution.flags, pressure.flags
        );

        var g = _grade(composite);

        // Find weakest dimension
        var dimensions = [
            { name: 'viability', score: viability.score },
            { name: 'structural', score: structural.score },
            { name: 'crosslinking', score: crosslinking.score },
            { name: 'resolution', score: resolution.score },
            { name: 'pressure', score: pressure.score }
        ];
        dimensions.sort(function (a, b) { return a.score - b.score; });
        var weakest = dimensions[0];
        var strongest = dimensions[dimensions.length - 1];

        return {
            composite: composite,
            grade: g,
            label: _gradeLabel(g),
            weakest: { dimension: weakest.name, score: weakest.score },
            strongest: { dimension: strongest.name, score: strongest.score },
            flags: allFlags,
            dimensions: {
                viability: viability,
                structural: structural,
                crosslinking: crosslinking,
                resolution: resolution,
                pressure: pressure
            },
            weights: Object.assign({}, weights),
            recommendations: _generateRecommendations(viability, structural, crosslinking, resolution, pressure)
        };
    }

    /**
     * Generate actionable recommendations based on dimension scores.
     */
    function _generateRecommendations(viability, structural, crosslinking, resolution, pressure) {
        var recs = [];

        if (viability.score < 50) {
            recs.push({
                priority: 'high',
                dimension: 'viability',
                message: 'Cell viability is critically low (' + viability.livePercent + '%). Review print parameters, especially pressure and print speed.'
            });
        } else if (viability.score < 70) {
            recs.push({
                priority: 'medium',
                dimension: 'viability',
                message: 'Cell viability could be improved. Consider reducing pressure or optimizing crosslinking timing.'
            });
        }

        if (structural.score < 50) {
            recs.push({
                priority: 'high',
                dimension: 'structural',
                message: 'Structural integrity is poor (elasticity: ' + structural.elasticity + ' kPa). Adjust material concentration or crosslinking.'
            });
        }

        if (crosslinking.flags.indexOf('under_crosslinked') >= 0) {
            recs.push({
                priority: 'medium',
                dimension: 'crosslinking',
                message: 'Crosslinking duration (' + crosslinking.duration + ' ms) is below minimum. Increase exposure time.'
            });
        }
        if (crosslinking.flags.indexOf('over_crosslinked') >= 0) {
            recs.push({
                priority: 'medium',
                dimension: 'crosslinking',
                message: 'Crosslinking duration (' + crosslinking.duration + ' ms) is excessive. Reduce to avoid cytotoxicity.'
            });
        }

        if (resolution.flags.indexOf('coarse_layers') >= 0) {
            recs.push({
                priority: 'low',
                dimension: 'resolution',
                message: 'Layer height (' + resolution.layerHeight + ' mm) is coarse. Use finer layers for better fidelity.'
            });
        }

        if (pressure.flags.indexOf('pressure_imbalance') >= 0) {
            recs.push({
                priority: 'medium',
                dimension: 'pressure',
                message: 'Extruder pressure imbalance (' + pressure.imbalance + ' kPa). Calibrate both extruders for consistent output.'
            });
        }

        if (pressure.flags.indexOf('extruder1_out_of_range') >= 0 || pressure.flags.indexOf('extruder2_out_of_range') >= 0) {
            recs.push({
                priority: 'high',
                dimension: 'pressure',
                message: 'One or more extruders operating outside safe range. Check for blockages or calibration issues.'
            });
        }

        recs.sort(function (a, b) {
            var priorityOrder = { high: 0, medium: 1, low: 2 };
            var pa = priorityOrder[a.priority] != null ? priorityOrder[a.priority] : 2;
            var pb = priorityOrder[b.priority] != null ? priorityOrder[b.priority] : 2;
            return pa - pb;
        });

        return recs;
    }

    /**
     * Score multiple print records and produce aggregate statistics.
     *
     * @param {Array} records - Array of print records
     * @returns {Object} Batch results with individual scores, summary stats, and distribution
     */
    function scoreBatch(records) {
        if (!Array.isArray(records) || records.length === 0) {
            throw new Error('Records must be a non-empty array');
        }

        var results = [];
        var composites = [];
        var gradeCount = {};
        var flagCount = {};
        var dimSums = { viability: 0, structural: 0, crosslinking: 0, resolution: 0, pressure: 0 };

        for (var i = 0; i < records.length; i++) {
            try {
                var result = score(records[i]);
                results.push(result);
                composites.push(result.composite);

                gradeCount[result.grade] = (gradeCount[result.grade] || 0) + 1;

                for (var f = 0; f < result.flags.length; f++) {
                    flagCount[result.flags[f]] = (flagCount[result.flags[f]] || 0) + 1;
                }

                var dims = result.dimensions;
                dimSums.viability += dims.viability.score;
                dimSums.structural += dims.structural.score;
                dimSums.crosslinking += dims.crosslinking.score;
                dimSums.resolution += dims.resolution.score;
                dimSums.pressure += dims.pressure.score;
            } catch (e) {
                results.push({ error: e.message, index: i });
            }
        }

        var validCount = composites.length;
        var sorted = composites.slice().sort(function (a, b) { return a - b; });

        var mean = 0;
        for (var j = 0; j < sorted.length; j++) mean += sorted[j];
        mean = validCount > 0 ? mean / validCount : 0;

        var variance = 0;
        for (var k = 0; k < sorted.length; k++) variance += (sorted[k] - mean) * (sorted[k] - mean);
        var stddev = validCount > 1 ? Math.sqrt(variance / (validCount - 1)) : 0;

        var median = 0;
        if (sorted.length > 0) {
            var mid = Math.floor(sorted.length / 2);
            median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        }

        return {
            total: records.length,
            scored: validCount,
            failed: records.length - validCount,
            results: results,
            summary: {
                mean: _r(mean),
                median: _r(median),
                stddev: _r(stddev),
                min: sorted.length > 0 ? sorted[0] : 0,
                max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
                overallGrade: _grade(mean),
                overallLabel: _gradeLabel(_grade(mean))
            },
            dimensionAverages: {
                viability: _r(validCount > 0 ? dimSums.viability / validCount : 0),
                structural: _r(validCount > 0 ? dimSums.structural / validCount : 0),
                crosslinking: _r(validCount > 0 ? dimSums.crosslinking / validCount : 0),
                resolution: _r(validCount > 0 ? dimSums.resolution / validCount : 0),
                pressure: _r(validCount > 0 ? dimSums.pressure / validCount : 0)
            },
            gradeDistribution: gradeCount,
            commonFlags: flagCount
        };
    }

    /**
     * Compare two print records side-by-side.
     *
     * @param {Object} recordA - First print record
     * @param {Object} recordB - Second print record
     * @returns {Object} Comparison with per-dimension deltas and winner
     */
    function compare(recordA, recordB) {
        var a = score(recordA);
        var b = score(recordB);

        var dims = ['viability', 'structural', 'crosslinking', 'resolution', 'pressure'];
        var comparison = {};
        var aWins = 0;
        var bWins = 0;

        for (var i = 0; i < dims.length; i++) {
            var d = dims[i];
            var scoreA = a.dimensions[d].score;
            var scoreB = b.dimensions[d].score;
            var delta = _r(scoreA - scoreB);
            comparison[d] = {
                scoreA: scoreA,
                scoreB: scoreB,
                delta: delta,
                winner: delta > 0 ? 'A' : delta < 0 ? 'B' : 'tie'
            };
            if (delta > 0) aWins++;
            else if (delta < 0) bWins++;
        }

        return {
            compositeA: a.composite,
            compositeB: b.composite,
            gradeA: a.grade,
            gradeB: b.grade,
            compositeDelta: _r(a.composite - b.composite),
            overallWinner: a.composite > b.composite ? 'A' : a.composite < b.composite ? 'B' : 'tie',
            dimensionWins: { A: aWins, B: bWins, tie: dims.length - aWins - bWins },
            dimensions: comparison,
            recommendationsA: a.recommendations,
            recommendationsB: b.recommendations
        };
    }

    /**
     * Get the current scoring configuration.
     *
     * @returns {Object} Weights and target parameters
     */
    function getConfig() {
        return {
            weights: Object.assign({}, weights),
            targets: JSON.parse(JSON.stringify(targets))
        };
    }

    return {
        score: score,
        scoreBatch: scoreBatch,
        compare: compare,
        getConfig: getConfig
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createPrintQualityScorer: createPrintQualityScorer };
}
