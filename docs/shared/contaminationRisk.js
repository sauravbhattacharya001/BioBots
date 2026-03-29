'use strict';

/**
 * Contamination Risk Scorer
 *
 * Evaluates contamination risk for bioprinting sessions based on
 * environmental conditions, procedural factors, and historical data.
 * Returns a risk score (0-100) with categorized risk level and
 * actionable recommendations.
 */

var RISK_FACTORS = {
    temperature: { weight: 0.10, ideal: { min: 20, max: 25 }, unit: '°C' },
    humidity: { weight: 0.10, ideal: { min: 30, max: 60 }, unit: '%' },
    particleCount: { weight: 0.15, ideal: { min: 0, max: 3520 }, unit: 'particles/m³' },
    airChangesPerHour: { weight: 0.10, ideal: { min: 20, max: 600 }, unit: 'ACH' },
    lastCleaningHoursAgo: { weight: 0.10, ideal: { min: 0, max: 4 }, unit: 'hours' },
    openContainerMinutes: { weight: 0.10, ideal: { min: 0, max: 15 }, unit: 'minutes' },
    personnelCount: { weight: 0.05, ideal: { min: 1, max: 2 }, unit: 'people' },
    gowningCompliance: { weight: 0.10, ideal: { min: 90, max: 100 }, unit: '%' },
    mediaAge: { weight: 0.10, ideal: { min: 0, max: 14 }, unit: 'days' },
    priorIncidents30d: { weight: 0.10, ideal: { min: 0, max: 0 }, unit: 'count' }
};

var RISK_LEVELS = [
    { max: 20, level: 'LOW', color: 'green', action: 'Proceed normally' },
    { max: 40, level: 'MODERATE', color: 'yellow', action: 'Review conditions before proceeding' },
    { max: 60, level: 'ELEVATED', color: 'orange', action: 'Address risk factors before starting' },
    { max: 80, level: 'HIGH', color: 'red', action: 'Do not proceed without mitigation' },
    { max: 100, level: 'CRITICAL', color: 'darkred', action: 'Stop — immediate remediation required' }
];

var RECOMMENDATIONS = {
    temperature: 'Adjust HVAC to maintain 20-25°C in the clean room',
    humidity: 'Calibrate humidifier/dehumidifier to maintain 30-60% RH',
    particleCount: 'Check HEPA filters; consider additional air purification',
    airChangesPerHour: 'Increase ventilation rate or verify HVAC performance',
    lastCleaningHoursAgo: 'Perform surface decontamination before starting',
    openContainerMinutes: 'Minimize open-container exposure; use laminar flow hood',
    personnelCount: 'Reduce non-essential personnel in the clean room',
    gowningCompliance: 'Enforce full gowning protocol for all personnel',
    mediaAge: 'Prepare fresh media; discard expired reagents',
    priorIncidents30d: 'Investigate root cause of recent contamination events'
};

function scoreFactor(value, ideal) {
    if (value >= ideal.min && value <= ideal.max) return 0;
    var distance;
    if (value < ideal.min) {
        distance = (ideal.min - value) / Math.max(ideal.min, 1);
    } else {
        distance = (value - ideal.max) / Math.max(ideal.max, 1);
    }
    return Math.min(distance * 100, 100);
}

function createContaminationRiskScorer() {
    var history = [];

    return {
        /**
         * Score contamination risk.
         * @param {Object} conditions - Key-value pairs matching RISK_FACTORS keys.
         * @returns {Object} { score, level, color, action, factors, recommendations, timestamp }
         */
        score: function score(conditions) {
            if (!conditions || typeof conditions !== 'object') {
                throw new Error('conditions must be an object with environmental parameters');
            }

            var totalScore = 0;
            var totalWeight = 0;
            var factors = [];
            var recommendations = [];

            var keys = Object.keys(RISK_FACTORS);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (conditions[key] == null) continue;

                var factor = RISK_FACTORS[key];
                var raw = scoreFactor(conditions[key], factor.ideal);
                var weighted = raw * factor.weight;
                totalScore += weighted;
                totalWeight += factor.weight;

                var entry = {
                    name: key,
                    value: conditions[key],
                    unit: factor.unit,
                    idealRange: factor.ideal.min + '-' + factor.ideal.max,
                    rawScore: Math.round(raw * 10) / 10,
                    contribution: Math.round(weighted * 10) / 10
                };
                factors.push(entry);

                if (raw > 30) {
                    recommendations.push(RECOMMENDATIONS[key]);
                }
            }

            if (totalWeight === 0) {
                throw new Error('At least one recognized condition parameter is required');
            }

            // Normalize to 0-100
            var finalScore = Math.min(Math.round((totalScore / totalWeight) * 10) / 10, 100);

            var riskLevel = RISK_LEVELS[RISK_LEVELS.length - 1];
            for (var j = 0; j < RISK_LEVELS.length; j++) {
                if (finalScore <= RISK_LEVELS[j].max) {
                    riskLevel = RISK_LEVELS[j];
                    break;
                }
            }

            // Sort factors by contribution (highest risk first)
            factors.sort(function (a, b) { return b.contribution - a.contribution; });

            var result = {
                score: finalScore,
                level: riskLevel.level,
                color: riskLevel.color,
                action: riskLevel.action,
                factorsEvaluated: factors.length,
                factors: factors,
                recommendations: recommendations,
                timestamp: new Date().toISOString()
            };

            history.push({ score: finalScore, level: riskLevel.level, timestamp: result.timestamp });

            return result;
        },

        /**
         * Compare two sets of conditions side-by-side.
         * @param {Object} before - Conditions before mitigation.
         * @param {Object} after - Conditions after mitigation.
         * @returns {Object} { before, after, improvement, improved }
         */
        compare: function compare(before, after) {
            var resultBefore = this.score(before);
            var resultAfter = this.score(after);
            return {
                before: resultBefore,
                after: resultAfter,
                improvement: Math.round((resultBefore.score - resultAfter.score) * 10) / 10,
                improved: resultAfter.score < resultBefore.score
            };
        },

        /**
         * Get scoring history from this session.
         * @returns {Array} Array of { score, level, timestamp }
         */
        getHistory: function getHistory() {
            return history.slice();
        },

        /**
         * List all recognized risk factor names and their weights.
         * @returns {Object[]}
         */
        listFactors: function listFactors() {
            return Object.keys(RISK_FACTORS).map(function (key) {
                var f = RISK_FACTORS[key];
                return {
                    name: key,
                    weight: f.weight,
                    idealRange: f.ideal.min + '-' + f.ideal.max + ' ' + f.unit
                };
            });
        },

        /**
         * Reset scoring history.
         */
        reset: function reset() {
            history = [];
        }
    };
}

exports.createContaminationRiskScorer = createContaminationRiskScorer;
