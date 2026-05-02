'use strict';

var round = require('./validation').round;
var _isDangerousKey = require('./sanitize').isDangerousKey;

/**
 * Lab Entropy Monitor
 *
 * Autonomous lab disorder and chaos detection engine for bioprinting labs.
 * Monitors entropy across 7 lab dimensions (equipment, inventory, protocol,
 * experiment, environmental, personnel, data), computes composite chaos
 * scores with exponential recency decay, detects entropy acceleration,
 * discovers cross-dimension correlations, and generates prioritized
 * remediation recommendations.
 *
 * Agentic capabilities:
 * - Autonomous entropy scoring with severity weighting and recency decay
 * - Acceleration detection via linear regression on rolling windows
 * - Cross-dimension correlation discovery within 48h co-occurrence windows
 * - Hotspot ranking to identify top entropy sources
 * - Autonomous remediation priority generation
 * - Insight generation from entropy patterns
 * - Composite dashboard with all analytics
 *
 * @example
 *   var mon = createLabEntropyMonitor();
 *   mon.recordEvent({ dimension: 'equipment', severity: 'high',
 *     source: 'bioprinter-02', description: 'Nozzle clog during print' });
 *   mon.recordEvent({ dimension: 'inventory', severity: 'medium',
 *     source: 'alginate-lot-44', description: 'Lot nearing expiration' });
 *   var score = mon.getEntropyScore();
 *   // score.score => 34.2, score.label => 'structured'
 *   var dash = mon.getDashboard();
 *   // dash.insights => ['Equipment entropy dominates...']
 */

// ── Constants ──────────────────────────────────────────────────────

var DIMENSIONS = ['equipment', 'inventory', 'protocol', 'experiment', 'environmental', 'personnel', 'data'];

var DIMENSION_SET = Object.create(null);
for (var _d = 0; _d < DIMENSIONS.length; _d++) {
    DIMENSION_SET[DIMENSIONS[_d]] = true;
}

var SEVERITY_WEIGHTS = { low: 1, medium: 3, high: 7, critical: 15 };

var DIMENSION_WEIGHTS = {
    equipment: 0.18,
    inventory: 0.14,
    protocol: 0.16,
    experiment: 0.18,
    environmental: 0.14,
    personnel: 0.10,
    data: 0.10
};

var DECAY_HALF_LIFE = 604800000; // 7 days in ms
var DECAY_LAMBDA = Math.LN2 / DECAY_HALF_LIFE;

var HEALTH_LABELS = [
    { min: 81, label: 'critical',   color: '#ef4444' },
    { min: 61, label: 'chaotic',    color: '#f97316' },
    { min: 41, label: 'disordered', color: '#eab308' },
    { min: 21, label: 'structured', color: '#84cc16' },
    { min: 0,  label: 'ordered',    color: '#22c55e' }
];

var SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

var REMEDIATION_ACTIONS = {
    equipment: [
        'Schedule immediate maintenance audit for all flagged equipment',
        'Implement predictive maintenance based on failure patterns',
        'Increase calibration frequency for high-drift instruments',
        'Create equipment redundancy plan for critical devices'
    ],
    inventory: [
        'Audit and dispose of all expired materials',
        'Set up automated reorder triggers for low-stock items',
        'Standardize lot tracking across all consumables',
        'Implement first-in-first-out material rotation'
    ],
    protocol: [
        'Conduct protocol compliance review with all lab personnel',
        'Freeze unapproved protocol modifications pending review',
        'Update protocols to latest versions and retire deprecated ones',
        'Implement mandatory protocol sign-off before experiment start'
    ],
    experiment: [
        'Investigate root causes of recent experiment failures',
        'Review reproducibility controls and add replication checks',
        'Close or archive abandoned experiments to reduce noise',
        'Implement pre-experiment checklists to catch setup errors'
    ],
    environmental: [
        'Inspect and recalibrate environmental monitoring sensors',
        'Review HVAC and temperature control systems',
        'Increase contamination surveillance frequency',
        'Implement real-time environmental alerting thresholds'
    ],
    personnel: [
        'Schedule refresher training sessions for flagged procedures',
        'Cross-train personnel to reduce single-point-of-failure risks',
        'Review onboarding procedures for new lab members',
        'Implement competency assessments before solo operation'
    ],
    data: [
        'Audit data records for completeness and consistency',
        'Standardize naming conventions across all datasets',
        'Archive or link orphaned datasets to parent experiments',
        'Implement automated data validation on entry'
    ]
};

// ── Helpers ────────────────────────────────────────────────────────

function _now() { return Date.now(); }

function _classifyLabel(score) {
    for (var i = 0; i < HEALTH_LABELS.length; i++) {
        if (score >= HEALTH_LABELS[i].min) return HEALTH_LABELS[i];
    }
    return HEALTH_LABELS[HEALTH_LABELS.length - 1];
}

function _decayWeight(eventTs, referenceTs) {
    var age = referenceTs - eventTs;
    if (age < 0) age = 0;
    return Math.exp(-DECAY_LAMBDA * age);
}

function _mean(arr) {
    if (!arr || arr.length === 0) return 0;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
}

function _linearRegression(xs, ys) {
    var n = xs.length;
    if (n < 2) return { slope: 0, intercept: _mean(ys) };
    var mx = _mean(xs);
    var my = _mean(ys);
    var num = 0, den = 0;
    for (var i = 0; i < n; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        den += (xs[i] - mx) * (xs[i] - mx);
    }
    var slope = den === 0 ? 0 : num / den;
    return { slope: slope, intercept: my - slope * mx };
}

function _generateId() {
    return 'ent-' + _now() + '-' + Math.random().toString(36).slice(2, 8);
}

// ── Factory ────────────────────────────────────────────────────────

function createLabEntropyMonitor() {
    var events = [];
    var insights = [];

    // ── recordEvent ────────────────────────────────────────────

    function recordEvent(opts) {
        if (!opts) return { success: false, error: 'opts is required' };
        if (!opts.dimension || !DIMENSION_SET[opts.dimension]) {
            return { success: false, error: 'Unknown or missing dimension. Valid: ' + DIMENSIONS.join(', ') };
        }
        if (!opts.severity || !SEVERITY_WEIGHTS[opts.severity]) {
            return { success: false, error: 'Unknown or missing severity. Valid: ' + SEVERITY_ORDER.join(', ') };
        }
        if (!opts.source || typeof opts.source !== 'string') {
            return { success: false, error: 'source (string) is required' };
        }
        if (!opts.description || typeof opts.description !== 'string') {
            return { success: false, error: 'description (string) is required' };
        }
        if (_isDangerousKey(opts.source)) {
            return { success: false, error: 'source contains dangerous key pattern' };
        }
        var eventId = _generateId();
        if (_isDangerousKey(eventId)) {
            eventId = 'ent-safe-' + Math.random().toString(36).slice(2, 10);
        }
        var ev = {
            id: eventId,
            dimension: opts.dimension,
            severity: opts.severity,
            source: opts.source,
            description: opts.description,
            timestamp: typeof opts.timestamp === 'number' && isFinite(opts.timestamp) ? opts.timestamp : _now()
        };
        events.push(ev);
        return { success: true, eventId: ev.id };
    }

    // ── _computeDimensionScore ─────────────────────────────────

    function _computeDimensionScore(dimension, refTs) {
        var now = refTs || _now();
        var dimEvents = [];
        for (var i = 0; i < events.length; i++) {
            if (events[i].dimension === dimension) dimEvents.push(events[i]);
        }
        if (dimEvents.length === 0) return { score: 0, eventCount: 0, rawScore: 0 };

        var rawScore = 0;
        for (var j = 0; j < dimEvents.length; j++) {
            var w = SEVERITY_WEIGHTS[dimEvents[j].severity] || 1;
            var decay = _decayWeight(dimEvents[j].timestamp, now);
            rawScore += w * decay;
        }
        // Normalize: score 0-100, using a logistic curve for saturation
        // Score = 100 * (1 - e^(-rawScore/20))
        var score = 100 * (1 - Math.exp(-rawScore / 20));
        score = Math.min(100, Math.max(0, score));
        return { score: round(score, 2), eventCount: dimEvents.length, rawScore: round(rawScore, 2) };
    }

    // ── _computeTrend ──────────────────────────────────────────

    function _computeTrend(dimension, refTs) {
        // Compare recent 7 days vs previous 7 days
        var now = refTs || _now();
        var oneWeek = 604800000;
        var recentScore = 0, olderScore = 0;
        for (var i = 0; i < events.length; i++) {
            if (events[i].dimension !== dimension) continue;
            var age = now - events[i].timestamp;
            var w = SEVERITY_WEIGHTS[events[i].severity] || 1;
            if (age <= oneWeek) recentScore += w;
            else if (age <= 2 * oneWeek) olderScore += w;
        }
        if (recentScore > olderScore * 1.2) return 'increasing';
        if (recentScore < olderScore * 0.8) return 'decreasing';
        return 'stable';
    }

    // ── getEntropyScore ────────────────────────────────────────

    function getEntropyScore(dimension) {
        if (dimension !== undefined && dimension !== null) {
            if (!DIMENSION_SET[dimension]) {
                return { success: false, error: 'Unknown dimension: ' + dimension };
            }
            var ds = _computeDimensionScore(dimension);
            var lbl = _classifyLabel(ds.score);
            return {
                score: ds.score,
                label: lbl.label,
                dimension: dimension,
                eventCount: ds.eventCount,
                trend: _computeTrend(dimension)
            };
        }
        // Composite — use a single reference timestamp so all dimensions
        // are scored against the same point in time.
        var refTs = _now();
        var composite = 0;
        var totalEvents = 0;
        for (var d = 0; d < DIMENSIONS.length; d++) {
            var dimScore = _computeDimensionScore(DIMENSIONS[d], refTs);
            composite += dimScore.score * DIMENSION_WEIGHTS[DIMENSIONS[d]];
            totalEvents += dimScore.eventCount;
        }
        composite = round(Math.min(100, Math.max(0, composite)), 2);
        var clbl = _classifyLabel(composite);
        // Composite trend: weighted average of dimension trends
        var trendNum = 0;
        for (var d2 = 0; d2 < DIMENSIONS.length; d2++) {
            var t = _computeTrend(DIMENSIONS[d2], refTs);
            trendNum += (t === 'increasing' ? 1 : t === 'decreasing' ? -1 : 0) * DIMENSION_WEIGHTS[DIMENSIONS[d2]];
        }
        var compositeTrend = trendNum > 0.1 ? 'increasing' : trendNum < -0.1 ? 'decreasing' : 'stable';
        return {
            score: composite,
            label: clbl.label,
            dimension: 'composite',
            eventCount: totalEvents,
            trend: compositeTrend
        };
    }

    // ── detectAcceleration ─────────────────────────────────────

    function detectAcceleration() {
        var now = _now();
        var oneWeek = 604800000;
        var results = [];

        for (var d = 0; d < DIMENSIONS.length; d++) {
            var dim = DIMENSIONS[d];
            // Compute weekly scores for last 4 weeks
            var weekScores = [];
            var weekTimes = [];
            for (var w = 3; w >= 0; w--) {
                var windowEnd = now - w * oneWeek;
                var windowScore = 0;
                for (var i = 0; i < events.length; i++) {
                    if (events[i].dimension !== dim) continue;
                    var age = windowEnd - events[i].timestamp;
                    if (age >= 0 && age < oneWeek) {
                        windowScore += SEVERITY_WEIGHTS[events[i].severity] || 1;
                    }
                }
                weekScores.push(windowScore);
                weekTimes.push(w);
            }

            // Velocity: slope of score over time (weeks, reversed so recent = higher x)
            var reg = _linearRegression([0, 1, 2, 3], weekScores);
            var velocity = round(reg.slope, 2);

            // Acceleration: compare velocity of last 2 weeks vs first 2 weeks
            var firstHalf = weekScores[1] - weekScores[0];
            var secondHalf = weekScores[3] - weekScores[2];
            var acceleration = round(secondHalf - firstHalf, 2);

            // Forecast: current score + velocity * 1 week
            var currentScore = _computeDimensionScore(dim).score;
            var forecast7d = round(Math.min(100, Math.max(0, currentScore + velocity * 5)), 2);

            results.push({
                dimension: dim,
                velocity: velocity,
                acceleration: acceleration,
                alert: velocity > 2 || acceleration > 3,
                forecast7d: forecast7d
            });
        }
        return results;
    }

    // ── getHotspots ────────────────────────────────────────────

    function getHotspots(opts) {
        opts = opts || {};
        var limit = opts.limit || 10;
        var filterDim = opts.dimension || null;

        var hotspotsNow = _now();
        var oneWeek = 604800000;
        var sourceMap = Object.create(null);
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            if (filterDim && ev.dimension !== filterDim) continue;
            var key = ev.source + '|' + ev.dimension;
            if (!sourceMap[key]) {
                sourceMap[key] = {
                    source: ev.source,
                    dimension: ev.dimension,
                    eventCount: 0,
                    totalSeverityWeight: 0,
                    lastSeen: 0,
                    recentCount: 0,
                    olderCount: 0
                };
            }
            sourceMap[key].eventCount++;
            sourceMap[key].totalSeverityWeight += SEVERITY_WEIGHTS[ev.severity] || 1;
            if (ev.timestamp > sourceMap[key].lastSeen) sourceMap[key].lastSeen = ev.timestamp;

            if (hotspotsNow - ev.timestamp <= oneWeek) sourceMap[key].recentCount++;
            else if (hotspotsNow - ev.timestamp <= 2 * oneWeek) sourceMap[key].olderCount++;
        }

        var hotspots = [];
        var keys = Object.keys(sourceMap);
        for (var j = 0; j < keys.length; j++) {
            var h = sourceMap[keys[j]];
            var trend = 'stable';
            if (h.recentCount > h.olderCount * 1.2) trend = 'increasing';
            else if (h.recentCount < h.olderCount * 0.8) trend = 'decreasing';
            hotspots.push({
                source: h.source,
                dimension: h.dimension,
                eventCount: h.eventCount,
                totalSeverityWeight: h.totalSeverityWeight,
                lastSeen: h.lastSeen,
                trend: trend
            });
        }

        hotspots.sort(function (a, b) { return b.totalSeverityWeight - a.totalSeverityWeight; });
        return hotspots.slice(0, limit);
    }

    // ── generateRemediation ────────────────────────────────────

    function generateRemediation() {
        var priorities = [];
        for (var d = 0; d < DIMENSIONS.length; d++) {
            var dim = DIMENSIONS[d];
            var ds = _computeDimensionScore(dim);
            if (ds.score > 40) {
                var urgency = ds.score >= 81 ? 'immediate' : ds.score >= 61 ? 'high' : 'moderate';
                var actions = REMEDIATION_ACTIONS[dim] || [];
                // Estimated impact: how much the score could drop
                var estimatedImpact = round(Math.min(ds.score * 0.4, 30), 2);
                priorities.push({
                    dimension: dim,
                    score: ds.score,
                    urgency: urgency,
                    actions: actions.slice(),
                    estimatedImpact: estimatedImpact
                });
            }
        }
        priorities.sort(function (a, b) { return b.score - a.score; });

        var strategy = 'No dimensions require remediation — lab entropy is under control.';
        if (priorities.length > 0) {
            var topDim = priorities[0].dimension;
            if (priorities.length === 1) {
                strategy = 'Focus remediation on ' + topDim + ' (score: ' + priorities[0].score + '). Other dimensions are within acceptable bounds.';
            } else if (priorities.length <= 3) {
                var names = [];
                for (var p = 0; p < priorities.length; p++) names.push(priorities[p].dimension);
                strategy = 'Multi-front remediation needed across ' + names.join(', ') + '. Prioritize ' + topDim + ' first (highest entropy).';
            } else {
                strategy = 'Systemic entropy detected across ' + priorities.length + ' dimensions. Consider a lab-wide audit and remediation sprint. Start with ' + topDim + '.';
            }
        }

        return { priorities: priorities, overallStrategy: strategy };
    }

    // ── getTimeline ────────────────────────────────────────────

    function getTimeline(opts) {
        opts = opts || {};
        var filterDim = opts.dimension || null;
        var since = opts.since || 0;
        var limit = opts.limit || 50;

        var filtered = [];
        for (var i = 0; i < events.length; i++) {
            if (filterDim && events[i].dimension !== filterDim) continue;
            if (events[i].timestamp < since) continue;
            filtered.push({
                id: events[i].id,
                dimension: events[i].dimension,
                severity: events[i].severity,
                source: events[i].source,
                description: events[i].description,
                timestamp: events[i].timestamp
            });
        }
        filtered.sort(function (a, b) { return b.timestamp - a.timestamp; });
        return filtered.slice(0, limit);
    }

    // ── getCorrelations ────────────────────────────────────────

    function getCorrelations() {
        var window = 48 * 60 * 60 * 1000; // 48 hours
        var pairs = [];

        for (var i = 0; i < DIMENSIONS.length; i++) {
            for (var j = i + 1; j < DIMENSIONS.length; j++) {
                var dimA = DIMENSIONS[i];
                var dimB = DIMENSIONS[j];
                var eventsA = [];
                var eventsB = [];
                var sourcesA = Object.create(null);
                var sourcesB = Object.create(null);

                for (var k = 0; k < events.length; k++) {
                    if (events[k].dimension === dimA) {
                        eventsA.push(events[k]);
                        sourcesA[events[k].source] = true;
                    } else if (events[k].dimension === dimB) {
                        eventsB.push(events[k]);
                        sourcesB[events[k].source] = true;
                    }
                }

                if (eventsA.length === 0 || eventsB.length === 0) continue;

                // Count co-occurrences within window
                var coOccurrences = 0;
                for (var a = 0; a < eventsA.length; a++) {
                    for (var b = 0; b < eventsB.length; b++) {
                        if (Math.abs(eventsA[a].timestamp - eventsB[b].timestamp) <= window) {
                            coOccurrences++;
                        }
                    }
                }

                var maxPossible = eventsA.length * eventsB.length;
                if (maxPossible === 0) continue;
                var correlation = round(coOccurrences / maxPossible, 2);
                if (correlation < 0.1) continue;

                // Shared sources
                var shared = [];
                var srcKeys = Object.keys(sourcesA);
                for (var s = 0; s < srcKeys.length; s++) {
                    if (sourcesB[srcKeys[s]]) shared.push(srcKeys[s]);
                }

                var insight = '';
                if (correlation >= 0.7) {
                    insight = dimA + ' and ' + dimB + ' entropy are strongly correlated (r=' + correlation + ') — ' +
                        (shared.length > 0 ? 'shared sources (' + shared.join(', ') + ') suggest a common root cause' : 'co-occurring events suggest systemic issues');
                } else if (correlation >= 0.4) {
                    insight = dimA + ' and ' + dimB + ' show moderate correlation (r=' + correlation + ') — worth investigating shared triggers';
                } else {
                    insight = dimA + ' and ' + dimB + ' have weak correlation (r=' + correlation + ') — likely independent sources of entropy';
                }

                pairs.push({
                    dimensions: [dimA, dimB],
                    correlation: correlation,
                    sharedSources: shared,
                    insight: insight
                });
            }
        }

        pairs.sort(function (a, b) { return b.correlation - a.correlation; });
        return pairs;
    }

    // ── _generateInsights ──────────────────────────────────────

    function _generateInsights() {
        var ins = [];
        var scores = {};
        var maxDim = null, minDim = null;
        var maxScore = -1, minScore = 101;

        for (var d = 0; d < DIMENSIONS.length; d++) {
            var dim = DIMENSIONS[d];
            var ds = _computeDimensionScore(dim);
            scores[dim] = ds.score;
            if (ds.score > maxScore) { maxScore = ds.score; maxDim = dim; }
            if (ds.score < minScore) { minScore = ds.score; minDim = dim; }
        }

        // Dominance insight
        if (maxScore > 0 && minScore >= 0 && minScore < maxScore) {
            if (minScore > 0) {
                var ratio = round(maxScore / minScore, 1);
                if (ratio >= 2) {
                    ins.push(maxDim.charAt(0).toUpperCase() + maxDim.slice(1) + ' entropy is ' + ratio + 'x higher than ' + minDim + ' entropy — ' + maxDim + ' should be prioritized for remediation');
                }
            } else {
                ins.push(maxDim.charAt(0).toUpperCase() + maxDim.slice(1) + ' entropy dominates while ' + minDim + ' has zero entropy');
            }
        }

        // Strength insight
        if (minScore <= 20 && minDim) {
            ins.push(minDim.charAt(0).toUpperCase() + minDim.slice(1) + ' entropy is the lowest dimension (score: ' + minScore + ') — ' + minDim + ' practices are a strength');
        }

        // Correlation insights
        var corrs = getCorrelations();
        for (var c = 0; c < corrs.length && c < 2; c++) {
            if (corrs[c].correlation >= 0.5) {
                ins.push(corrs[c].dimensions[0].charAt(0).toUpperCase() + corrs[c].dimensions[0].slice(1) +
                    ' and ' + corrs[c].dimensions[1] + ' entropy are correlated (r=' + corrs[c].correlation +
                    ') — investigate shared root causes');
            }
        }

        // Acceleration insights
        var accel = detectAcceleration();
        for (var a = 0; a < accel.length; a++) {
            if (accel[a].alert) {
                ins.push(accel[a].dimension.charAt(0).toUpperCase() + accel[a].dimension.slice(1) +
                    ' entropy accelerating (velocity: +' + accel[a].velocity + '/week) — intervention needed');
            }
        }

        // All-clear
        if (maxScore <= 20 && ins.length === 0) {
            ins.push('All dimensions are in the ordered range — lab entropy is well-controlled');
        }

        return ins;
    }

    // ── getDashboard ───────────────────────────────────────────

    function getDashboard() {
        var dimensionScores = {};
        for (var d = 0; d < DIMENSIONS.length; d++) {
            dimensionScores[DIMENSIONS[d]] = getEntropyScore(DIMENSIONS[d]);
        }
        var composite = getEntropyScore();
        var hotspots = getHotspots({ limit: 5 });
        var acceleration = detectAcceleration();
        var alerts = [];
        for (var a = 0; a < acceleration.length; a++) {
            if (acceleration[a].alert) alerts.push(acceleration[a]);
        }
        var remediation = generateRemediation();
        var insightsArr = _generateInsights();

        return {
            compositeScore: composite,
            dimensionScores: dimensionScores,
            hotspots: hotspots,
            alerts: alerts,
            acceleration: acceleration,
            remediation: remediation,
            insights: insightsArr,
            eventCount: events.length,
            generatedAt: _now()
        };
    }

    // ── reset ──────────────────────────────────────────────────

    function reset() {
        events.length = 0;
        insights.length = 0;
    }

    return {
        recordEvent: recordEvent,
        getEntropyScore: getEntropyScore,
        detectAcceleration: detectAcceleration,
        getHotspots: getHotspots,
        generateRemediation: generateRemediation,
        getTimeline: getTimeline,
        getCorrelations: getCorrelations,
        getDashboard: getDashboard,
        reset: reset
    };
}

module.exports = { createLabEntropyMonitor: createLabEntropyMonitor };
