'use strict';

/** Strip prototype-polluting keys from a shallow object (CWE-1321). */
const _DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function _cleanObj(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const out = Object.create(null);
  for (const k of Object.keys(obj)) {
    if (!_DANGEROUS_KEYS.has(k)) out[k] = obj[k];
  }
  return out;
}

/**
 * Print Risk Assessor for BioBots
 *
 * Pre-print risk evaluation tool that analyzes planned print parameters
 * against multiple risk dimensions to produce a go/no-go recommendation.
 *
 * Risk dimensions:
 *   1. Nozzle Clogging — high pressure + large particles + narrow gauge
 *   2. Cell Viability — shear stress, UV exposure, temperature, duration
 *   3. Structural Collapse — insufficient crosslinking, tall unsupported spans
 *   4. Layer Adhesion — too-fast speed, low temperature, thick layers
 *   5. Over-Crosslinking — excessive UV/chemical exposure damages cells
 *   6. Dehydration — long print time at low humidity without hydration
 *   7. Contamination — non-sterile conditions, long ambient exposure
 *   8. Pressure Damage — excessive extrusion pressure causing cell lysis
 *
 * Usage:
 *   const assessor = createRiskAssessor();
 *   const result = assessor.assess({ pressure: 80, ... });
 *   const batch = assessor.batchAssess([params1, params2]);
 *   const comparison = assessor.compareConfigurations(params1, params2);
 */

function createRiskAssessor(customThresholds) {

    // ── Risk Thresholds ─────────────────────────────────────────

    const DEFAULT_THRESHOLDS = Object.freeze({
        nozzle: Object.freeze({
            maxPressure: 120,
            criticalPressure: 180,
            minGauge: 25,
            maxGauge: 32,
            riskGauge: 30,
        }),
        viability: Object.freeze({
            optimalTemp: 37,
            tempTolerance: 3,
            criticalTempLow: 20,
            criticalTempHigh: 42,
            maxShear: 1000,
            criticalShear: 5000,
        }),
        structure: Object.freeze({
            minCrosslinkIntensity: 10,
            minCrosslinkDuration: 5000,
            maxLayerHeight: 0.5,
            maxUnsupportedLayers: 10,
            minLayersForRisk: 30,
        }),
        adhesion: Object.freeze({
            maxLayerHeight: 0.8,
            criticalLayerHeight: 1.2,
            maxSpeed: 20,
            criticalSpeed: 35,
        }),
        overCrosslink: Object.freeze({
            maxIntensity: 80,
            criticalIntensity: 95,
            maxDuration: 60000,
            criticalDuration: 120000,
        }),
        dehydration: Object.freeze({
            safePrintTime: 30,
            riskyPrintTime: 60,
            criticalPrintTime: 120,
            minHumidity: 60,
        }),
        contamination: Object.freeze({
            safeAmbientMinutes: 15,
            riskyAmbientMinutes: 45,
            criticalAmbientMinutes: 90,
        }),
        pressure: Object.freeze({
            safePressure: 60,
            riskyPressure: 100,
            criticalPressure: 150,
        }),
    });

    const thresholds = mergeThresholds(DEFAULT_THRESHOLDS, customThresholds);

    function mergeThresholds(defaults, custom) {
        if (!custom) return defaults;
        const merged = {};
        for (const category of Object.keys(defaults)) {
            if (custom[category]) {
                merged[category] = Object.freeze(
                    Object.assign({}, defaults[category], _cleanObj(custom[category]))
                );
            } else {
                merged[category] = defaults[category];
            }
        }
        return Object.freeze(merged);
    }

    // ── Scoring Utilities ───────────────────────────────────────

    function linearRisk(value, safe, risky, critical) {
        if (value <= safe) return 0;
        if (value >= critical) return 100;
        if (value <= risky) {
            return 50 * (value - safe) / (risky - safe);
        }
        return 50 + 50 * (value - risky) / (critical - risky);
    }

    function riskLevel(score) {
        if (score <= 20) return 'LOW';
        if (score <= 50) return 'MODERATE';
        if (score <= 75) return 'HIGH';
        return 'CRITICAL';
    }

    // ── Individual Risk Calculators ─────────────────────────────

    function assessNozzleClogging(params) {
        var pressure = params.pressure || 0;
        var gauge = params.nozzleGauge || 25;
        var t = thresholds.nozzle;

        var pressureRisk = linearRisk(pressure, t.maxPressure * 0.6,
            t.maxPressure, t.criticalPressure);
        var gaugeRisk = linearRisk(gauge, t.minGauge, t.riskGauge, t.maxGauge);
        var combined = Math.min(100, pressureRisk * 0.6 + gaugeRisk * 0.4
            + (pressureRisk > 30 && gaugeRisk > 30 ? 15 : 0));

        var mitigations = [];
        if (pressureRisk > 40) mitigations.push('Reduce extrusion pressure');
        if (gaugeRisk > 40) mitigations.push('Use a wider gauge nozzle');
        if (combined > 60) mitigations.push('Pre-warm bioink to reduce viscosity');

        return {
            dimension: 'Nozzle Clogging',
            score: Math.round(combined),
            level: riskLevel(combined),
            factors: { pressureRisk: Math.round(pressureRisk), gaugeRisk: Math.round(gaugeRisk) },
            mitigations: mitigations,
        };
    }

    function assessViability(params) {
        var temp = params.temperature != null ? params.temperature : 37;
        var pressure = params.pressure || 0;
        var gauge = params.nozzleGauge || 25;
        var t = thresholds.viability;

        // Temperature risk
        var tempDev = Math.abs(temp - t.optimalTemp);
        var tempRisk;
        if (tempDev <= t.tempTolerance) {
            tempRisk = 0;
        } else if (temp < t.criticalTempLow || temp > t.criticalTempHigh) {
            tempRisk = 100;
        } else {
            var maxDev = Math.max(t.optimalTemp - t.criticalTempLow,
                t.criticalTempHigh - t.optimalTemp);
            tempRisk = Math.min(100, 100 * (tempDev - t.tempTolerance)
                / (maxDev - t.tempTolerance));
        }

        // Shear stress estimation: tau ~ P / d (simplified wall shear model)
        var nozzleDiameters = { 20: 0.6, 22: 0.41, 25: 0.26, 27: 0.21, 30: 0.16, 32: 0.11 };
        var diam = nozzleDiameters[gauge] || 0.26;
        var estimatedShear = pressure / diam;
        var shearRisk = linearRisk(estimatedShear, t.maxShear * 0.5,
            t.maxShear, t.criticalShear);

        var combined = Math.min(100, tempRisk * 0.4 + shearRisk * 0.6);

        var mitigations = [];
        if (tempRisk > 30) mitigations.push('Adjust temperature closer to 37\u00B0C');
        if (shearRisk > 30) mitigations.push('Reduce pressure or use wider nozzle to lower shear');
        if (shearRisk > 60) mitigations.push('Consider shear-thinning bioink formulation');

        return {
            dimension: 'Cell Viability',
            score: Math.round(combined),
            level: riskLevel(combined),
            factors: {
                tempRisk: Math.round(tempRisk),
                shearRisk: Math.round(shearRisk),
                estimatedShear: Math.round(estimatedShear),
            },
            mitigations: mitigations,
        };
    }

    function assessStructuralCollapse(params) {
        var crosslinkEnabled = params.crosslinkEnabled !== false;
        var crosslinkIntensity = params.crosslinkIntensity || 0;
        var crosslinkDuration = params.crosslinkDuration || 0;
        var layerHeight = params.layerHeight || 0.3;
        var layerCount = params.layerCount || 1;
        var t = thresholds.structure;

        var crosslinkRisk = 0;
        if (!crosslinkEnabled) {
            crosslinkRisk = layerCount > 5 ? 80 : 40;
        } else {
            if (crosslinkIntensity < t.minCrosslinkIntensity) crosslinkRisk = 60;
            if (crosslinkDuration < t.minCrosslinkDuration)
                crosslinkRisk = Math.max(crosslinkRisk, 50);
        }

        var heightRisk = layerCount > t.minLayersForRisk
            ? linearRisk(layerHeight, t.maxLayerHeight * 0.5,
                t.maxLayerHeight, t.maxLayerHeight * 1.5) + 20
            : linearRisk(layerHeight, t.maxLayerHeight * 0.8,
                t.maxLayerHeight, t.maxLayerHeight * 1.5);

        var combined = Math.min(100, crosslinkRisk * 0.6 + Math.min(100, heightRisk) * 0.4);

        var mitigations = [];
        if (!crosslinkEnabled && layerCount > 5) mitigations.push('Enable crosslinking for multi-layer prints');
        if (crosslinkIntensity < t.minCrosslinkIntensity && crosslinkEnabled)
            mitigations.push('Increase crosslink intensity above ' + t.minCrosslinkIntensity + '%');
        if (layerHeight > t.maxLayerHeight) mitigations.push('Reduce layer height for better structural support');
        if (layerCount > t.maxUnsupportedLayers) mitigations.push('Consider support structures for tall constructs');

        return {
            dimension: 'Structural Collapse',
            score: Math.round(combined),
            level: riskLevel(combined),
            factors: { crosslinkRisk: Math.round(crosslinkRisk), heightRisk: Math.round(Math.min(100, heightRisk)) },
            mitigations: mitigations,
        };
    }

    function assessLayerAdhesion(params) {
        var layerHeight = params.layerHeight || 0.3;
        var printSpeed = params.printSpeed || 10;
        var t = thresholds.adhesion;

        var heightRisk = linearRisk(layerHeight, t.maxLayerHeight * 0.5,
            t.maxLayerHeight, t.criticalLayerHeight);
        var speedRisk = linearRisk(printSpeed, t.maxSpeed * 0.5,
            t.maxSpeed, t.criticalSpeed);

        var combined = Math.min(100, heightRisk * 0.5 + speedRisk * 0.5);

        var mitigations = [];
        if (heightRisk > 40) mitigations.push('Reduce layer height for better inter-layer bonding');
        if (speedRisk > 40) mitigations.push('Slow print speed to allow proper layer fusion');

        return {
            dimension: 'Layer Adhesion',
            score: Math.round(combined),
            level: riskLevel(combined),
            factors: { heightRisk: Math.round(heightRisk), speedRisk: Math.round(speedRisk) },
            mitigations: mitigations,
        };
    }

    function assessOverCrosslinking(params) {
        var crosslinkEnabled = params.crosslinkEnabled !== false;
        var intensity = params.crosslinkIntensity || 0;
        var duration = params.crosslinkDuration || 0;

        if (!crosslinkEnabled || (intensity === 0 && duration === 0)) {
            return {
                dimension: 'Over-Crosslinking',
                score: 0, level: 'LOW',
                factors: { intensityRisk: 0, durationRisk: 0 },
                mitigations: [],
            };
        }

        var t = thresholds.overCrosslink;
        var intensityRisk = linearRisk(intensity, t.maxIntensity * 0.5,
            t.maxIntensity, t.criticalIntensity);
        var durationRisk = linearRisk(duration, t.maxDuration * 0.3,
            t.maxDuration, t.criticalDuration);

        var compounding = (intensityRisk > 40 && durationRisk > 40) ? 10 : 0;
        var combined = Math.min(100, intensityRisk * 0.55 + durationRisk * 0.45 + compounding);

        var mitigations = [];
        if (intensityRisk > 40) mitigations.push('Reduce crosslink intensity to limit cell damage');
        if (durationRisk > 40) mitigations.push('Shorten crosslink exposure time');
        if (combined > 60) mitigations.push('Consider pulsed crosslinking protocol');

        return {
            dimension: 'Over-Crosslinking',
            score: Math.round(combined),
            level: riskLevel(combined),
            factors: { intensityRisk: Math.round(intensityRisk), durationRisk: Math.round(durationRisk) },
            mitigations: mitigations,
        };
    }

    function assessDehydration(params) {
        var printTimeMinutes = params.printTimeMinutes || 0;
        var humidity = params.humidity != null ? params.humidity : 80;
        var t = thresholds.dehydration;

        var timeRisk = linearRisk(printTimeMinutes, t.safePrintTime,
            t.riskyPrintTime, t.criticalPrintTime);
        var humidityRisk = humidity < t.minHumidity
            ? linearRisk(t.minHumidity - humidity, 0, 15, 30)
            : 0;

        var combined = Math.min(100, timeRisk * 0.7 + humidityRisk * 0.3);

        var mitigations = [];
        if (timeRisk > 40) mitigations.push('Use humidified enclosure or periodic misting');
        if (humidityRisk > 30) mitigations.push('Increase ambient humidity above ' + t.minHumidity + '% RH');
        if (combined > 60) mitigations.push('Consider printing in shorter sessions with re-hydration');

        return {
            dimension: 'Dehydration',
            score: Math.round(combined),
            level: riskLevel(combined),
            factors: { timeRisk: Math.round(timeRisk), humidityRisk: Math.round(humidityRisk) },
            mitigations: mitigations,
        };
    }

    function assessContamination(params) {
        var ambientMinutes = params.ambientExposureMinutes || 0;
        var sterileEnvironment = params.sterileEnvironment !== false;
        var t = thresholds.contamination;

        var score;
        if (sterileEnvironment) {
            score = linearRisk(ambientMinutes, t.riskyAmbientMinutes,
                t.criticalAmbientMinutes, t.criticalAmbientMinutes * 2) * 0.3;
        } else {
            score = linearRisk(ambientMinutes, t.safeAmbientMinutes,
                t.riskyAmbientMinutes, t.criticalAmbientMinutes);
        }

        var mitigations = [];
        if (!sterileEnvironment && score > 20) mitigations.push('Use a laminar flow hood or biosafety cabinet');
        if (ambientMinutes > t.riskyAmbientMinutes) mitigations.push('Minimize time between bioink prep and printing');
        if (score > 50) mitigations.push('Add antibiotics/antimycotics to bioink formulation');

        return {
            dimension: 'Contamination',
            score: Math.round(score),
            level: riskLevel(score),
            factors: { ambientMinutes: ambientMinutes, sterile: sterileEnvironment },
            mitigations: mitigations,
        };
    }

    function assessPressureDamage(params) {
        var pressure = params.pressure || 0;
        var t = thresholds.pressure;
        var score = linearRisk(pressure, t.safePressure,
            t.riskyPressure, t.criticalPressure);

        var mitigations = [];
        if (score > 40) mitigations.push('Reduce extrusion pressure to protect cells');
        if (score > 60) mitigations.push('Use a conical nozzle to reduce shear at walls');
        if (score > 80) mitigations.push('Switch to lower-viscosity bioink requiring less pressure');

        return {
            dimension: 'Pressure Damage',
            score: Math.round(score),
            level: riskLevel(score),
            factors: { pressure: pressure },
            mitigations: mitigations,
        };
    }

    // ── Composite Assessment ────────────────────────────────────

    function assess(params) {
        if (!params || typeof params !== 'object') {
            throw new Error('assess requires a parameters object');
        }

        var dimensions = [
            assessNozzleClogging(params),
            assessViability(params),
            assessStructuralCollapse(params),
            assessLayerAdhesion(params),
            assessOverCrosslinking(params),
            assessDehydration(params),
            assessContamination(params),
            assessPressureDamage(params),
        ];

        var weights = {
            'Nozzle Clogging': 1.0,
            'Cell Viability': 1.5,
            'Structural Collapse': 1.2,
            'Layer Adhesion': 0.8,
            'Over-Crosslinking': 1.3,
            'Dehydration': 0.7,
            'Contamination': 0.9,
            'Pressure Damage': 1.2,
        };

        var weightedSum = 0, totalWeight = 0, maxScore = 0;
        for (var i = 0; i < dimensions.length; i++) {
            var w = weights[dimensions[i].dimension] || 1.0;
            weightedSum += dimensions[i].score * w;
            totalWeight += w;
            if (dimensions[i].score > maxScore) maxScore = dimensions[i].score;
        }

        var weightedAvg = weightedSum / totalWeight;
        var overallScore = Math.round(weightedAvg * 0.6 + maxScore * 0.4);

        // Collect deduplicated mitigations
        var allMitigations = [];
        var seen = new Set();
        for (var j = 0; j < dimensions.length; j++) {
            for (var k = 0; k < dimensions[j].mitigations.length; k++) {
                var m = dimensions[j].mitigations[k];
                if (!seen.has(m)) {
                    seen.add(m);
                    allMitigations.push({ dimension: dimensions[j].dimension, suggestion: m });
                }
            }
        }

        var dimScores = {};
        for (var d = 0; d < dimensions.length; d++) dimScores[dimensions[d].dimension] = dimensions[d].score;
        allMitigations.sort(function (a, b) {
            return (dimScores[b.dimension] || 0) - (dimScores[a.dimension] || 0);
        });

        var criticalDims = dimensions.filter(function (dim) { return dim.level === 'CRITICAL'; });
        var highDims = dimensions.filter(function (dim) { return dim.level === 'HIGH'; });

        var recommendation;
        if (criticalDims.length > 0) {
            recommendation = 'NO-GO';
        } else if (highDims.length >= 2) {
            recommendation = 'NO-GO';
        } else if (highDims.length === 1) {
            recommendation = 'CAUTION';
        } else if (overallScore > 40) {
            recommendation = 'CAUTION';
        } else {
            recommendation = 'GO';
        }

        return {
            overallScore: overallScore,
            overallLevel: riskLevel(overallScore),
            recommendation: recommendation,
            dimensions: dimensions,
            mitigations: allMitigations,
            criticalCount: criticalDims.length,
            highCount: highDims.length,
            params: Object.assign({}, _cleanObj(params)),
        };
    }

    function assessDimension(dimensionName, params) {
        var assessors = {
            'nozzle': assessNozzleClogging,
            'viability': assessViability,
            'structure': assessStructuralCollapse,
            'adhesion': assessLayerAdhesion,
            'crosslink': assessOverCrosslinking,
            'dehydration': assessDehydration,
            'contamination': assessContamination,
            'pressure': assessPressureDamage,
        };
        var fn = assessors[dimensionName];
        if (!fn) throw new Error('Unknown dimension: ' + dimensionName);
        return fn(params);
    }

    function batchAssess(paramsList) {
        if (!Array.isArray(paramsList)) throw new Error('batchAssess requires an array');
        return paramsList.map(function (p) { return assess(p); });
    }

    function compareConfigurations(paramsA, paramsB) {
        var resultA = assess(paramsA);
        var resultB = assess(paramsB);

        var dimensionComparison = [];
        for (var i = 0; i < resultA.dimensions.length; i++) {
            var dA = resultA.dimensions[i];
            var dB = resultB.dimensions[i];
            dimensionComparison.push({
                dimension: dA.dimension,
                scoreA: dA.score,
                scoreB: dB.score,
                delta: dB.score - dA.score,
                levelA: dA.level,
                levelB: dB.level,
                improved: dB.score < dA.score,
                worsened: dB.score > dA.score,
            });
        }

        return {
            configA: resultA,
            configB: resultB,
            overallDelta: resultB.overallScore - resultA.overallScore,
            dimensionComparison: dimensionComparison,
            improvedDimensions: dimensionComparison.filter(function (d) { return d.improved; }).length,
            worsenedDimensions: dimensionComparison.filter(function (d) { return d.worsened; }).length,
            recommendation: resultB.overallScore < resultA.overallScore
                ? 'Config B is lower risk'
                : resultB.overallScore > resultA.overallScore
                    ? 'Config A is lower risk'
                    : 'Configurations have equal overall risk',
        };
    }

    function suggestImprovements(params, targetScore) {
        if (targetScore == null) targetScore = 30;
        var current = assess(params);

        if (current.overallScore <= targetScore) {
            return { currentScore: current.overallScore, targetScore: targetScore,
                     alreadyMet: true, suggestions: [] };
        }

        var suggestions = [];
        for (var i = 0; i < current.dimensions.length; i++) {
            var dim = current.dimensions[i];
            if (dim.score > 30) {
                var suggestion = {
                    dimension: dim.dimension,
                    currentScore: dim.score,
                    currentLevel: dim.level,
                    parameterChanges: [],
                };

                if (dim.dimension === 'Pressure Damage' || dim.dimension === 'Nozzle Clogging') {
                    if ((params.pressure || 0) > thresholds.pressure.safePressure) {
                        suggestion.parameterChanges.push({
                            parameter: 'pressure', current: params.pressure,
                            suggested: thresholds.pressure.safePressure, unit: 'kPa',
                        });
                    }
                }
                if (dim.dimension === 'Cell Viability') {
                    if (params.temperature != null && Math.abs(params.temperature - 37) > 3) {
                        suggestion.parameterChanges.push({
                            parameter: 'temperature', current: params.temperature,
                            suggested: 37, unit: '\u00B0C',
                        });
                    }
                }
                if (dim.dimension === 'Layer Adhesion') {
                    if ((params.layerHeight || 0) > 0.4)
                        suggestion.parameterChanges.push({
                            parameter: 'layerHeight', current: params.layerHeight,
                            suggested: 0.3, unit: 'mm',
                        });
                    if ((params.printSpeed || 0) > 10)
                        suggestion.parameterChanges.push({
                            parameter: 'printSpeed', current: params.printSpeed,
                            suggested: 10, unit: 'mm/s',
                        });
                }
                if (dim.dimension === 'Over-Crosslinking') {
                    if ((params.crosslinkIntensity || 0) > 40)
                        suggestion.parameterChanges.push({
                            parameter: 'crosslinkIntensity', current: params.crosslinkIntensity,
                            suggested: 40, unit: '%',
                        });
                }
                if (dim.dimension === 'Dehydration') {
                    if ((params.printTimeMinutes || 0) > 30)
                        suggestion.parameterChanges.push({
                            parameter: 'printTimeMinutes', current: params.printTimeMinutes,
                            suggested: 30, unit: 'minutes',
                        });
                }

                if (suggestion.parameterChanges.length > 0 || dim.mitigations.length > 0) {
                    suggestion.mitigations = dim.mitigations;
                    suggestions.push(suggestion);
                }
            }
        }

        suggestions.sort(function (a, b) { return b.currentScore - a.currentScore; });

        return {
            currentScore: current.overallScore,
            targetScore: targetScore,
            alreadyMet: false,
            suggestions: suggestions,
        };
    }

    function analyzeHistorical(printData) {
        if (!Array.isArray(printData) || printData.length === 0) {
            return { sampleSize: 0, analyses: [] };
        }

        var successes = [], failures = [];
        for (var i = 0; i < printData.length; i++) {
            var entry = printData[i];
            var result = assess(entry.params);
            var record = { params: entry.params, outcome: entry.outcome, assessment: result };
            if (entry.outcome === 'success') successes.push(record);
            else failures.push(record);
        }

        function avgScore(records) {
            if (records.length === 0) return 0;
            var sum = 0;
            for (var j = 0; j < records.length; j++) sum += records[j].assessment.overallScore;
            return Math.round(sum / records.length);
        }

        var dimNames = ['Nozzle Clogging', 'Cell Viability', 'Structural Collapse',
            'Layer Adhesion', 'Over-Crosslinking', 'Dehydration',
            'Contamination', 'Pressure Damage'];

        var dimensionAnalysis = dimNames.map(function (name) {
            function dimAvg(records) {
                if (records.length === 0) return 0;
                var sum = 0;
                for (var k = 0; k < records.length; k++) {
                    var dims = records[k].assessment.dimensions;
                    for (var m = 0; m < dims.length; m++) {
                        if (dims[m].dimension === name) { sum += dims[m].score; break; }
                    }
                }
                return Math.round(sum / records.length);
            }
            return {
                dimension: name,
                avgScoreSuccess: dimAvg(successes),
                avgScoreFailure: dimAvg(failures),
                gap: dimAvg(failures) - dimAvg(successes),
            };
        });

        dimensionAnalysis.sort(function (a, b) { return b.gap - a.gap; });

        return {
            sampleSize: printData.length,
            successCount: successes.length,
            failureCount: failures.length,
            avgScoreSuccess: avgScore(successes),
            avgScoreFailure: avgScore(failures),
            dimensionAnalysis: dimensionAnalysis,
            mostPredictive: dimensionAnalysis.length > 0 ? dimensionAnalysis[0].dimension : null,
        };
    }

    function textReport(result) {
        var lines = [];
        lines.push('=== Print Risk Assessment ===');
        lines.push('Overall Score: ' + result.overallScore + '/100 (' + result.overallLevel + ')');
        lines.push('Recommendation: ' + result.recommendation);
        lines.push('');
        lines.push('--- Risk Dimensions ---');

        for (var i = 0; i < result.dimensions.length; i++) {
            var dim = result.dimensions[i];
            var bar = '';
            var blocks = Math.round(dim.score / 5);
            for (var b = 0; b < 20; b++) bar += b < blocks ? '#' : '.';
            lines.push('  ' + dim.dimension + ': ' + dim.score + '/100 [' + bar + '] ' + dim.level);
        }

        if (result.mitigations.length > 0) {
            lines.push('');
            lines.push('--- Recommended Mitigations ---');
            for (var j = 0; j < result.mitigations.length; j++) {
                var mit = result.mitigations[j];
                lines.push('  [' + mit.dimension + '] ' + mit.suggestion);
            }
        }

        return lines.join('\n');
    }

    return {
        assess: assess,
        assessDimension: assessDimension,
        batchAssess: batchAssess,
        compareConfigurations: compareConfigurations,
        suggestImprovements: suggestImprovements,
        analyzeHistorical: analyzeHistorical,
        textReport: textReport,
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createRiskAssessor: createRiskAssessor };
}
