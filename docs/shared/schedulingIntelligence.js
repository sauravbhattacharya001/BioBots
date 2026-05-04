'use strict';

/**
 * Lab Scheduling Intelligence Engine
 *
 * Autonomous experiment scheduling optimizer that learns from historical
 * timing data to predict optimal scheduling windows, detect conflicts,
 * and recommend time slots that maximize success probability.
 *
 * 7 Engines:
 *   1. Schedule Recorder — logs experiment scheduling events with outcomes
 *   2. Temporal Pattern Analyzer — discovers time-of-day/day-of-week success patterns
 *   3. Conflict Detector — identifies resource/equipment/operator scheduling conflicts
 *   4. Optimal Window Predictor — recommends best time slots for experiment types
 *   5. Workload Balancer — detects overloaded periods and suggests redistribution
 *   6. Health Scorer — composite scheduling efficiency score 0-100
 *   7. Insight Generator — autonomous pattern discovery and recommendations
 *
 * Agentic capabilities:
 *   - Autonomous discovery of optimal scheduling windows from outcomes
 *   - Proactive conflict detection before scheduling
 *   - Workload imbalance alerts with redistribution suggestions
 *   - Learning from historical success/failure timing patterns
 *   - Cross-resource contention awareness
 *
 * @example
 *   var si = createSchedulingIntelligence();
 *   si.recordScheduledExperiment({
 *     id: 'exp-001', protocol: 'bioprint-cartilage',
 *     operator: 'alice', equipment: ['printer-1', 'incubator-2'],
 *     scheduledStart: '2025-06-15T09:00:00Z',
 *     scheduledEnd: '2025-06-15T12:00:00Z',
 *     actualStart: '2025-06-15T09:15:00Z',
 *     actualEnd: '2025-06-15T11:45:00Z',
 *     outcome: 'success', metrics: { cellViability: 0.92 }
 *   });
 *   var windows = si.predictOptimalWindows('bioprint-cartilage');
 *   var conflicts = si.detectConflicts('2025-06-16T09:00:00Z', '2025-06-16T12:00:00Z', ['printer-1']);
 *   var dashboard = si.dashboard();
 */

var _stats = require('./stats');
var mean = _stats.mean;
var stddev = _stats.stddev;
var linearRegression = _stats.linearRegression;

var _isDangerousKey = require('./sanitize').isDangerousKey;
var round = require('./validation').round;

// ── Constants ──────────────────────────────────────────────────────

var HEALTH_TIERS = [
    { min: 0, max: 20, label: 'Critical' },
    { min: 21, max: 40, label: 'Poor' },
    { min: 41, max: 60, label: 'Fair' },
    { min: 61, max: 80, label: 'Good' },
    { min: 81, max: 100, label: 'Excellent' }
];

var DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

var TIME_SLOTS = [
    { label: 'Early Morning', startHour: 6, endHour: 9 },
    { label: 'Morning', startHour: 9, endHour: 12 },
    { label: 'Afternoon', startHour: 12, endHour: 15 },
    { label: 'Late Afternoon', startHour: 15, endHour: 18 },
    { label: 'Evening', startHour: 18, endHour: 21 },
    { label: 'Night', startHour: 21, endHour: 6 }
];

var MAX_EXPERIMENTS = 5000;

// ── Factory ────────────────────────────────────────────────────────

function createSchedulingIntelligence(opts) {
    opts = opts || {};

    var experiments = [];
    var conflictLog = [];

    // ── Engine 1: Schedule Recorder ────────────────────────────────

    function recordScheduledExperiment(entry) {
        if (!entry || typeof entry !== 'object') {
            throw new Error('Entry must be a non-null object');
        }
        if (!entry.id || typeof entry.id !== 'string') {
            throw new Error('Entry must have a string id');
        }
        if (!entry.scheduledStart) {
            throw new Error('Entry must have scheduledStart');
        }
        if (_isDangerousKey && _isDangerousKey(entry.id)) {
            throw new Error('Invalid entry id');
        }

        var record = {
            id: entry.id,
            protocol: entry.protocol || 'unknown',
            operator: entry.operator || 'unknown',
            equipment: Array.isArray(entry.equipment) ? entry.equipment.slice() : [],
            scheduledStart: new Date(entry.scheduledStart).toISOString(),
            scheduledEnd: entry.scheduledEnd ? new Date(entry.scheduledEnd).toISOString() : null,
            actualStart: entry.actualStart ? new Date(entry.actualStart).toISOString() : null,
            actualEnd: entry.actualEnd ? new Date(entry.actualEnd).toISOString() : null,
            outcome: entry.outcome || 'pending',
            metrics: entry.metrics || {},
            tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
            recordedAt: new Date().toISOString()
        };

        // Enforce capacity
        if (experiments.length >= MAX_EXPERIMENTS) {
            experiments.shift();
        }
        experiments.push(record);
        return record;
    }

    function getExperiments(filter) {
        if (!filter) return experiments.slice();
        return experiments.filter(function (e) {
            if (filter.protocol && e.protocol !== filter.protocol) return false;
            if (filter.operator && e.operator !== filter.operator) return false;
            if (filter.outcome && e.outcome !== filter.outcome) return false;
            if (filter.equipment) {
                var hasEquip = false;
                for (var i = 0; i < e.equipment.length; i++) {
                    if (e.equipment[i] === filter.equipment) { hasEquip = true; break; }
                }
                if (!hasEquip) return false;
            }
            return true;
        });
    }

    // ── Engine 2: Temporal Pattern Analyzer ────────────────────────

    function analyzeTemporalPatterns(protocol) {
        var filtered = protocol
            ? experiments.filter(function (e) { return e.protocol === protocol; })
            : experiments;

        if (filtered.length === 0) {
            return { hourlySuccessRate: {}, dailySuccessRate: {}, sampleSize: 0 };
        }

        var hourBuckets = {};
        var dayBuckets = {};

        for (var i = 0; i < filtered.length; i++) {
            var e = filtered[i];
            if (e.outcome !== 'success' && e.outcome !== 'failure') continue;

            var dt = new Date(e.scheduledStart);
            var hour = dt.getUTCHours();
            var day = dt.getUTCDay();
            var success = e.outcome === 'success' ? 1 : 0;

            if (!hourBuckets[hour]) hourBuckets[hour] = { total: 0, successes: 0 };
            hourBuckets[hour].total++;
            hourBuckets[hour].successes += success;

            if (!dayBuckets[day]) dayBuckets[day] = { total: 0, successes: 0 };
            dayBuckets[day].total++;
            dayBuckets[day].successes += success;
        }

        var hourlySuccessRate = {};
        var keys = Object.keys(hourBuckets);
        for (var h = 0; h < keys.length; h++) {
            var k = keys[h];
            hourlySuccessRate[k] = round(hourBuckets[k].successes / hourBuckets[k].total, 3);
        }

        var dailySuccessRate = {};
        var dKeys = Object.keys(dayBuckets);
        for (var d = 0; d < dKeys.length; d++) {
            var dk = dKeys[d];
            dailySuccessRate[DAYS_OF_WEEK[dk]] = round(dayBuckets[dk].successes / dayBuckets[dk].total, 3);
        }

        return {
            hourlySuccessRate: hourlySuccessRate,
            dailySuccessRate: dailySuccessRate,
            sampleSize: filtered.length
        };
    }

    // ── Engine 3: Conflict Detector ────────────────────────────────

    function detectConflicts(startTime, endTime, resources, operator) {
        if (!startTime || !endTime) {
            throw new Error('startTime and endTime are required');
        }

        var start = new Date(startTime).getTime();
        var end = new Date(endTime).getTime();
        if (end <= start) {
            throw new Error('endTime must be after startTime');
        }

        resources = resources || [];
        var conflicts = [];

        for (var i = 0; i < experiments.length; i++) {
            var e = experiments[i];
            if (e.outcome === 'cancelled') continue;

            var eStart = new Date(e.scheduledStart).getTime();
            var eEnd = e.scheduledEnd ? new Date(e.scheduledEnd).getTime() : eStart + 3600000;

            // Check time overlap
            if (start < eEnd && end > eStart) {
                // Check resource overlap
                var sharedResources = [];
                for (var r = 0; r < resources.length; r++) {
                    for (var er = 0; er < e.equipment.length; er++) {
                        if (resources[r] === e.equipment[er]) {
                            sharedResources.push(resources[r]);
                        }
                    }
                }

                var operatorConflict = operator && e.operator === operator;

                if (sharedResources.length > 0 || operatorConflict) {
                    conflicts.push({
                        experimentId: e.id,
                        protocol: e.protocol,
                        operator: e.operator,
                        overlapMinutes: round(Math.min(end, eEnd) - Math.max(start, eStart)) / 60000,
                        sharedResources: sharedResources,
                        operatorConflict: !!operatorConflict,
                        severity: sharedResources.length > 1 ? 'high' : (operatorConflict ? 'medium' : 'low')
                    });
                }
            }
        }

        if (conflicts.length > 0) {
            conflictLog.push({
                timestamp: new Date().toISOString(),
                requestedWindow: { start: new Date(startTime).toISOString(), end: new Date(endTime).toISOString() },
                conflictsFound: conflicts.length
            });
        }

        return conflicts;
    }

    // ── Engine 4: Optimal Window Predictor ─────────────────────────

    function predictOptimalWindows(protocol, constraints) {
        constraints = constraints || {};
        var patterns = analyzeTemporalPatterns(protocol);

        if (patterns.sampleSize < 3) {
            return {
                recommendations: [],
                confidence: 'low',
                reason: 'Insufficient historical data (need at least 3 experiments)'
            };
        }

        // Score each time slot by historical success rate
        var slotScores = [];
        for (var s = 0; s < TIME_SLOTS.length; s++) {
            var slot = TIME_SLOTS[s];
            var slotSuccessRates = [];

            for (var h = slot.startHour; h !== slot.endHour; h = (h + 1) % 24) {
                if (patterns.hourlySuccessRate[h] !== undefined) {
                    slotSuccessRates.push(patterns.hourlySuccessRate[h]);
                }
            }

            if (slotSuccessRates.length > 0) {
                slotScores.push({
                    slot: slot.label,
                    startHour: slot.startHour,
                    endHour: slot.endHour,
                    successRate: round(mean(slotSuccessRates), 3),
                    dataPoints: slotSuccessRates.length
                });
            }
        }

        // Sort by success rate descending
        slotScores.sort(function (a, b) { return b.successRate - a.successRate; });

        // Add day-of-week recommendations
        var bestDays = [];
        var dayKeys = Object.keys(patterns.dailySuccessRate);
        for (var d = 0; d < dayKeys.length; d++) {
            bestDays.push({ day: dayKeys[d], successRate: patterns.dailySuccessRate[dayKeys[d]] });
        }
        bestDays.sort(function (a, b) { return b.successRate - a.successRate; });

        // Apply constraints (exclude certain hours/days)
        if (constraints.excludeHours) {
            slotScores = slotScores.filter(function (ss) {
                for (var i = 0; i < constraints.excludeHours.length; i++) {
                    if (ss.startHour === constraints.excludeHours[i]) return false;
                }
                return true;
            });
        }

        var confidence = patterns.sampleSize >= 20 ? 'high' : (patterns.sampleSize >= 10 ? 'medium' : 'low');

        return {
            recommendations: slotScores.slice(0, 3),
            bestDays: bestDays.slice(0, 3),
            confidence: confidence,
            basedOnExperiments: patterns.sampleSize
        };
    }

    // ── Engine 5: Workload Balancer ────────────────────────────────

    function analyzeWorkload(windowDays) {
        windowDays = windowDays || 7;
        var now = Date.now();
        var windowMs = windowDays * 86400000;

        var recent = experiments.filter(function (e) {
            return (now - new Date(e.scheduledStart).getTime()) < windowMs;
        });

        if (recent.length === 0) {
            return { dayDistribution: {}, operatorLoad: {}, equipmentLoad: {}, imbalances: [] };
        }

        // Distribution by day of week
        var dayDist = {};
        var operatorLoad = {};
        var equipmentLoad = {};

        for (var i = 0; i < recent.length; i++) {
            var e = recent[i];
            var day = DAYS_OF_WEEK[new Date(e.scheduledStart).getUTCDay()];

            dayDist[day] = (dayDist[day] || 0) + 1;
            operatorLoad[e.operator] = (operatorLoad[e.operator] || 0) + 1;

            for (var eq = 0; eq < e.equipment.length; eq++) {
                var eqName = e.equipment[eq];
                equipmentLoad[eqName] = (equipmentLoad[eqName] || 0) + 1;
            }
        }

        // Detect imbalances
        var imbalances = [];
        var dayValues = Object.keys(dayDist).map(function (k) { return dayDist[k]; });
        var dayMean = mean(dayValues);
        var dayStd = stddev(dayValues);

        if (dayStd > 0 && dayMean > 0) {
            var dayKeys2 = Object.keys(dayDist);
            for (var d = 0; d < dayKeys2.length; d++) {
                var zScore = (dayDist[dayKeys2[d]] - dayMean) / dayStd;
                if (zScore >= 1.5) {
                    imbalances.push({
                        type: 'overloaded_day',
                        target: dayKeys2[d],
                        load: dayDist[dayKeys2[d]],
                        zScore: round(zScore, 2),
                        recommendation: 'Consider redistributing experiments from ' + dayKeys2[d]
                    });
                }
            }
        }

        // Operator overload detection
        var opValues = Object.keys(operatorLoad).map(function (k) { return operatorLoad[k]; });
        var opMean = mean(opValues);
        var opStd = stddev(opValues);
        if (opStd > 0 && opMean > 0) {
            var opKeys = Object.keys(operatorLoad);
            for (var o = 0; o < opKeys.length; o++) {
                var opZ = (operatorLoad[opKeys[o]] - opMean) / opStd;
                if (opZ >= 1.5) {
                    imbalances.push({
                        type: 'operator_overload',
                        target: opKeys[o],
                        load: operatorLoad[opKeys[o]],
                        zScore: round(opZ, 2),
                        recommendation: 'Operator ' + opKeys[o] + ' is overloaded — consider delegation'
                    });
                }
            }
        }

        return {
            dayDistribution: dayDist,
            operatorLoad: operatorLoad,
            equipmentLoad: equipmentLoad,
            imbalances: imbalances,
            totalExperiments: recent.length,
            windowDays: windowDays
        };
    }

    // ── Engine 6: Health Scorer ─────────────────────────────────────

    function computeHealthScore() {
        if (experiments.length === 0) {
            return { score: 50, tier: 'Fair', components: {}, reason: 'No data' };
        }

        var completed = experiments.filter(function (e) {
            return e.outcome === 'success' || e.outcome === 'failure';
        });

        // Component 1: Overall success rate (0-25)
        var successRate = 0;
        if (completed.length > 0) {
            var successes = completed.filter(function (e) { return e.outcome === 'success'; }).length;
            successRate = successes / completed.length;
        }
        var successScore = round(successRate * 25, 1);

        // Component 2: Punctuality - how close actual start is to scheduled (0-25)
        var punctualityScores = [];
        for (var i = 0; i < completed.length; i++) {
            var e = completed[i];
            if (e.actualStart && e.scheduledStart) {
                var delayMin = Math.abs(new Date(e.actualStart).getTime() - new Date(e.scheduledStart).getTime()) / 60000;
                // 0 delay = 1.0, 60 min delay = 0.0
                punctualityScores.push(Math.max(0, 1 - delayMin / 60));
            }
        }
        var punctuality = punctualityScores.length > 0 ? mean(punctualityScores) : 0.5;
        var punctualityScore = round(punctuality * 25, 1);

        // Component 3: Conflict rate (0-25) — fewer conflicts = higher score
        var recentConflicts = conflictLog.length;
        var conflictPenalty = Math.min(1, recentConflicts / Math.max(1, experiments.length));
        var conflictScore = round((1 - conflictPenalty) * 25, 1);

        // Component 4: Workload balance (0-25)
        var workload = analyzeWorkload(14);
        var balanceScore = 25;
        if (workload.imbalances.length > 0) {
            balanceScore = round(Math.max(0, 25 - workload.imbalances.length * 5), 1);
        }

        var total = Math.min(100, Math.max(0, round(successScore + punctualityScore + conflictScore + balanceScore, 0)));

        var tier = 'Fair';
        for (var t = 0; t < HEALTH_TIERS.length; t++) {
            if (total >= HEALTH_TIERS[t].min && total <= HEALTH_TIERS[t].max) {
                tier = HEALTH_TIERS[t].label;
                break;
            }
        }

        return {
            score: total,
            tier: tier,
            components: {
                successRate: successScore,
                punctuality: punctualityScore,
                conflictFreedom: conflictScore,
                workloadBalance: balanceScore
            },
            experimentCount: experiments.length
        };
    }

    // ── Engine 7: Insight Generator ────────────────────────────────

    function generateInsights() {
        var insights = [];

        if (experiments.length < 3) {
            insights.push({
                type: 'info',
                message: 'Record more experiments to unlock scheduling intelligence (have ' + experiments.length + ', need 3+)'
            });
            return insights;
        }

        // Insight: Best time of day
        var patterns = analyzeTemporalPatterns();
        var hourKeys = Object.keys(patterns.hourlySuccessRate);
        if (hourKeys.length > 0) {
            var bestHour = hourKeys[0];
            for (var h = 1; h < hourKeys.length; h++) {
                if (patterns.hourlySuccessRate[hourKeys[h]] > patterns.hourlySuccessRate[bestHour]) {
                    bestHour = hourKeys[h];
                }
            }
            if (patterns.hourlySuccessRate[bestHour] > 0.7) {
                insights.push({
                    type: 'opportunity',
                    message: 'Hour ' + bestHour + ':00 UTC has the highest success rate (' +
                        round(patterns.hourlySuccessRate[bestHour] * 100, 0) + '%) — schedule critical experiments here'
                });
            }
        }

        // Insight: Worst time of day
        if (hourKeys.length > 2) {
            var worstHour = hourKeys[0];
            for (var w = 1; w < hourKeys.length; w++) {
                if (patterns.hourlySuccessRate[hourKeys[w]] < patterns.hourlySuccessRate[worstHour]) {
                    worstHour = hourKeys[w];
                }
            }
            if (patterns.hourlySuccessRate[worstHour] < 0.4) {
                insights.push({
                    type: 'warning',
                    message: 'Avoid scheduling at hour ' + worstHour + ':00 UTC — only ' +
                        round(patterns.hourlySuccessRate[worstHour] * 100, 0) + '% success rate'
                });
            }
        }

        // Insight: Workload imbalances
        var workload = analyzeWorkload(7);
        if (workload.imbalances.length > 0) {
            for (var im = 0; im < Math.min(2, workload.imbalances.length); im++) {
                insights.push({
                    type: 'alert',
                    message: workload.imbalances[im].recommendation
                });
            }
        }

        // Insight: Punctuality trend
        var completed = experiments.filter(function (e) {
            return e.actualStart && e.scheduledStart && (e.outcome === 'success' || e.outcome === 'failure');
        });
        if (completed.length >= 5) {
            var delays = completed.map(function (e) {
                return Math.abs(new Date(e.actualStart).getTime() - new Date(e.scheduledStart).getTime()) / 60000;
            });
            var recentDelays = delays.slice(-5);
            var avgRecentDelay = mean(recentDelays);
            if (avgRecentDelay > 30) {
                insights.push({
                    type: 'warning',
                    message: 'Recent experiments start an average of ' + round(avgRecentDelay, 0) +
                        ' minutes late — consider adding buffer time to schedules'
                });
            }
        }

        // Insight: Equipment bottleneck
        if (workload.equipmentLoad) {
            var eqKeys = Object.keys(workload.equipmentLoad);
            var maxEq = null;
            var maxLoad = 0;
            for (var eq = 0; eq < eqKeys.length; eq++) {
                if (workload.equipmentLoad[eqKeys[eq]] > maxLoad) {
                    maxLoad = workload.equipmentLoad[eqKeys[eq]];
                    maxEq = eqKeys[eq];
                }
            }
            if (maxEq && maxLoad > workload.totalExperiments * 0.5) {
                insights.push({
                    type: 'bottleneck',
                    message: 'Equipment "' + maxEq + '" is used in ' + round(maxLoad / workload.totalExperiments * 100, 0) +
                        '% of experiments — potential scheduling bottleneck'
                });
            }
        }

        // Insight: Operator success pattern
        var operators = {};
        for (var i = 0; i < experiments.length; i++) {
            var e = experiments[i];
            if (e.outcome !== 'success' && e.outcome !== 'failure') continue;
            if (!operators[e.operator]) operators[e.operator] = { success: 0, total: 0 };
            operators[e.operator].total++;
            if (e.outcome === 'success') operators[e.operator].success++;
        }
        var opKeys2 = Object.keys(operators);
        for (var op = 0; op < opKeys2.length; op++) {
            var opData = operators[opKeys2[op]];
            if (opData.total >= 5 && opData.success / opData.total > 0.9) {
                insights.push({
                    type: 'strength',
                    message: 'Operator "' + opKeys2[op] + '" has ' + round(opData.success / opData.total * 100, 0) +
                        '% success rate — assign critical experiments to them'
                });
            }
        }

        return insights;
    }

    // ── Dashboard ──────────────────────────────────────────────────

    function dashboard() {
        var health = computeHealthScore();
        var workload = analyzeWorkload(7);
        var insights = generateInsights();
        var patterns = analyzeTemporalPatterns();

        return {
            health: health,
            workload: workload,
            temporalPatterns: patterns,
            insights: insights,
            recentConflicts: conflictLog.slice(-10),
            experimentCount: experiments.length
        };
    }

    // ── Public API ─────────────────────────────────────────────────

    return {
        recordScheduledExperiment: recordScheduledExperiment,
        getExperiments: getExperiments,
        analyzeTemporalPatterns: analyzeTemporalPatterns,
        detectConflicts: detectConflicts,
        predictOptimalWindows: predictOptimalWindows,
        analyzeWorkload: analyzeWorkload,
        computeHealthScore: computeHealthScore,
        generateInsights: generateInsights,
        dashboard: dashboard
    };
}

module.exports = { createSchedulingIntelligence: createSchedulingIntelligence };
