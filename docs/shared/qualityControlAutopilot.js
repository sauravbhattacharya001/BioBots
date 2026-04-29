'use strict';

var round = require('./validation').round;
var _isDangerousKey = require('./sanitize').isDangerousKey;

/**
 * Quality Control Autopilot
 *
 * Autonomous statistical process control (SPC) engine for bioprinting.
 * Monitors print quality metrics in real time, detects out-of-control
 * conditions using Western Electric rules, computes process capability
 * indices (Cp/Cpk), identifies trends and shifts, and generates
 * autonomous pass/fail verdicts with corrective action plans.
 *
 * Agentic capabilities:
 * - Self-monitoring: ingests metrics and autonomously evaluates control state
 * - Proactive detection: flags out-of-control conditions before defects occur
 * - Trend awareness: identifies gradual drifts via run/trend rules
 * - Decision-making: autonomous pass/hold/fail verdicts with confidence
 * - Corrective guidance: generates prioritized action plans per violation
 * - Learning: tracks violation history to detect chronic vs transient issues
 *
 * @example
 *   var qc = createQualityControlAutopilot();
 *   qc.configure({ metrics: { lineWidth: { target: 0.4, lsl: 0.35, usl: 0.45, unit: 'mm' } } });
 *   qc.ingest({ lineWidth: 0.41 });
 *   qc.ingest({ lineWidth: 0.39 });
 *   // ... more samples ...
 *   var report = qc.evaluate();
 *   // report.verdict => 'PASS' | 'HOLD' | 'FAIL'
 *   // report.metrics.lineWidth.controlStatus => 'IN_CONTROL' | 'WARNING' | 'OUT_OF_CONTROL'
 *   // report.metrics.lineWidth.capability => { cp: 1.33, cpk: 1.2 }
 *   // report.actions => [{ action: '...', priority: 'HIGH' }]
 */

// ── Control status levels ──────────────────────────────────────────

var CONTROL_STATUS = {
    IN_CONTROL:     { level: 0, label: 'In Control',     color: '#22c55e' },
    WARNING:        { level: 1, label: 'Warning',        color: '#eab308' },
    OUT_OF_CONTROL: { level: 2, label: 'Out of Control', color: '#ef4444' }
};

// ── Default metric profiles ────────────────────────────────────────

var DEFAULT_METRICS = {
    lineWidth: {
        target: 0.4, lsl: 0.35, usl: 0.45, unit: 'mm',
        label: 'Line Width'
    },
    layerHeight: {
        target: 0.2, lsl: 0.15, usl: 0.25, unit: 'mm',
        label: 'Layer Height'
    },
    cellViability: {
        target: 95, lsl: 85, usl: 100, unit: '%',
        label: 'Cell Viability'
    },
    porosity: {
        target: 60, lsl: 50, usl: 70, unit: '%',
        label: 'Porosity'
    },
    filamentDiameter: {
        target: 0.4, lsl: 0.32, usl: 0.48, unit: 'mm',
        label: 'Filament Diameter'
    },
    printAccuracy: {
        target: 95, lsl: 88, usl: 100, unit: '%',
        label: 'Print Accuracy'
    }
};

// ── Western Electric rules ─────────────────────────────────────────
// Standard SPC rules for detecting out-of-control conditions

/**
 * Rule 1: One point beyond 3-sigma
 */
function rule1_beyond3sigma(values, mean, sigma) {
    if (values.length < 1) return [];
    var violations = [];
    var ucl = mean + 3 * sigma;
    var lcl = mean - 3 * sigma;
    for (var i = 0; i < values.length; i++) {
        if (values[i] > ucl || values[i] < lcl) {
            violations.push({ index: i, value: values[i], rule: 'WE1', severity: 'OUT_OF_CONTROL',
                description: 'Point beyond 3-sigma limit' });
        }
    }
    return violations;
}

/**
 * Rule 2: Nine consecutive points on same side of center
 */
function rule2_nineSameSide(values, mean) {
    if (values.length < 9) return [];
    var violations = [];
    for (var i = 8; i < values.length; i++) {
        var allAbove = true, allBelow = true;
        for (var j = i - 8; j <= i; j++) {
            if (values[j] <= mean) allAbove = false;
            if (values[j] >= mean) allBelow = false;
        }
        if (allAbove || allBelow) {
            violations.push({ index: i, value: values[i], rule: 'WE2', severity: 'OUT_OF_CONTROL',
                description: '9 consecutive points on same side of center line' });
        }
    }
    return violations;
}

/**
 * Rule 3: Six consecutive points steadily increasing or decreasing
 */
function rule3_sixTrend(values) {
    if (values.length < 6) return [];
    var violations = [];
    for (var i = 5; i < values.length; i++) {
        var inc = true, dec = true;
        for (var j = i - 4; j <= i; j++) {
            if (values[j] <= values[j - 1]) inc = false;
            if (values[j] >= values[j - 1]) dec = false;
        }
        if (inc || dec) {
            violations.push({ index: i, value: values[i], rule: 'WE3', severity: 'WARNING',
                description: '6 consecutive points steadily ' + (inc ? 'increasing' : 'decreasing') });
        }
    }
    return violations;
}

/**
 * Rule 4: Two out of three consecutive points beyond 2-sigma (same side)
 */
function rule4_twoOfThreeBeyond2sigma(values, mean, sigma) {
    if (values.length < 3) return [];
    var violations = [];
    var upper2 = mean + 2 * sigma;
    var lower2 = mean - 2 * sigma;
    for (var i = 2; i < values.length; i++) {
        var aboveCount = 0, belowCount = 0;
        for (var j = i - 2; j <= i; j++) {
            if (values[j] > upper2) aboveCount++;
            if (values[j] < lower2) belowCount++;
        }
        if (aboveCount >= 2 || belowCount >= 2) {
            violations.push({ index: i, value: values[i], rule: 'WE4', severity: 'WARNING',
                description: '2 of 3 consecutive points beyond 2-sigma' });
        }
    }
    return violations;
}

/**
 * Rule 5: Fourteen consecutive points alternating up and down
 */
function rule5_fourteenAlternating(values) {
    if (values.length < 14) return [];
    var violations = [];
    for (var i = 13; i < values.length; i++) {
        var alternating = true;
        for (var j = i - 12; j <= i; j++) {
            var d1 = values[j] - values[j - 1];
            var d2 = values[j + 1 !== undefined ? j : j] - values[j];
            if (j < i) {
                d2 = values[j + 1] - values[j];
                if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0) || d1 === 0 || d2 === 0) {
                    alternating = false;
                    break;
                }
            }
        }
        if (alternating) {
            violations.push({ index: i, value: values[i], rule: 'WE5', severity: 'WARNING',
                description: '14 consecutive points alternating up and down (stratification)' });
        }
    }
    return violations;
}

// ── Statistical helpers ────────────────────────────────────────────

function computeMean(arr) {
    if (arr.length === 0) return 0;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
}

function computeStdDev(arr, mean) {
    if (arr.length < 2) return 0;
    var sumSq = 0;
    for (var i = 0; i < arr.length; i++) {
        var d = arr[i] - mean;
        sumSq += d * d;
    }
    return Math.sqrt(sumSq / (arr.length - 1));
}

/**
 * Process Capability: Cp = (USL - LSL) / (6 * sigma)
 * Cpk = min((USL - mean) / (3 * sigma), (mean - LSL) / (3 * sigma))
 */
function computeCapability(mean, sigma, lsl, usl) {
    if (sigma === 0) {
        return { cp: Infinity, cpk: Infinity, rating: 'EXCELLENT' };
    }
    var cp = round((usl - lsl) / (6 * sigma), 3);
    var cpk = round(Math.min((usl - mean) / (3 * sigma), (mean - lsl) / (3 * sigma)), 3);
    var rating;
    if (cpk >= 1.67) rating = 'EXCELLENT';
    else if (cpk >= 1.33) rating = 'GOOD';
    else if (cpk >= 1.0) rating = 'ADEQUATE';
    else if (cpk >= 0.67) rating = 'POOR';
    else rating = 'INADEQUATE';
    return { cp: cp, cpk: cpk, rating: rating };
}

/**
 * Trend detection via least-squares linear regression
 */
function computeTrend(values) {
    var n = values.length;
    if (n < 3) return { slope: 0, direction: 'STABLE', strength: 0 };
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
        sumX += i;
        sumY += values[i];
        sumXY += i * values[i];
        sumX2 += i * i;
    }
    var denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return { slope: 0, direction: 'STABLE', strength: 0 };
    var slope = (n * sumXY - sumX * sumY) / denom;
    // Compute R² for strength
    var meanY = sumY / n;
    var ssTot = 0, ssRes = 0;
    var intercept = (sumY - slope * sumX) / n;
    for (var j = 0; j < n; j++) {
        var predicted = intercept + slope * j;
        ssTot += (values[j] - meanY) * (values[j] - meanY);
        ssRes += (values[j] - predicted) * (values[j] - predicted);
    }
    var r2 = ssTot === 0 ? 0 : round(1 - ssRes / ssTot, 3);
    var direction = Math.abs(slope) < 1e-10 ? 'STABLE' : (slope > 0 ? 'INCREASING' : 'DECREASING');
    return { slope: round(slope, 6), direction: direction, strength: r2 };
}

// ── Corrective action generation ───────────────────────────────────

var ACTION_CATALOG = {
    WE1: [
        { action: 'Investigate immediate assignable cause for the outlier point', priority: 'CRITICAL', category: 'investigation' },
        { action: 'Check for equipment malfunction or material batch change', priority: 'HIGH', category: 'equipment' },
        { action: 'Quarantine affected samples for re-inspection', priority: 'HIGH', category: 'quality' }
    ],
    WE2: [
        { action: 'Process mean has shifted — recalibrate equipment', priority: 'HIGH', category: 'calibration' },
        { action: 'Review material lot consistency', priority: 'MEDIUM', category: 'materials' },
        { action: 'Update control chart center line if shift is intentional', priority: 'LOW', category: 'documentation' }
    ],
    WE3: [
        { action: 'Trend detected — investigate progressive wear or degradation', priority: 'HIGH', category: 'maintenance' },
        { action: 'Check environmental conditions (temperature, humidity drift)', priority: 'MEDIUM', category: 'environment' },
        { action: 'Schedule preventive maintenance', priority: 'MEDIUM', category: 'maintenance' }
    ],
    WE4: [
        { action: 'Process variability increasing — check for loose components', priority: 'HIGH', category: 'equipment' },
        { action: 'Verify measurement system repeatability', priority: 'MEDIUM', category: 'measurement' }
    ],
    WE5: [
        { action: 'Stratification detected — check for systematic alternating sources', priority: 'MEDIUM', category: 'investigation' },
        { action: 'Review if two alternating streams are being mixed', priority: 'MEDIUM', category: 'process' }
    ],
    CAPABILITY_LOW: [
        { action: 'Process not capable — reduce variation through tighter controls', priority: 'HIGH', category: 'process' },
        { action: 'Consider wider specification limits if scientifically justified', priority: 'MEDIUM', category: 'specification' },
        { action: 'Invest in equipment upgrade for better precision', priority: 'LOW', category: 'equipment' }
    ],
    TREND_DRIFT: [
        { action: 'Gradual drift detected — schedule calibration before next batch', priority: 'HIGH', category: 'calibration' },
        { action: 'Increase sampling frequency to monitor drift rate', priority: 'MEDIUM', category: 'monitoring' }
    ]
};

function generateActions(violations, capabilities) {
    var seen = {};
    var actions = [];

    // Actions from Western Electric violations
    for (var i = 0; i < violations.length; i++) {
        var rule = violations[i].rule;
        if (!seen[rule] && ACTION_CATALOG[rule]) {
            seen[rule] = true;
            var catalog = ACTION_CATALOG[rule];
            for (var j = 0; j < catalog.length; j++) {
                actions.push({
                    action: catalog[j].action,
                    priority: catalog[j].priority,
                    category: catalog[j].category,
                    trigger: rule + ': ' + violations[i].description
                });
            }
        }
    }

    // Actions from capability issues
    if (capabilities) {
        var keys = Object.keys(capabilities);
        for (var k = 0; k < keys.length; k++) {
            var cap = capabilities[keys[k]];
            if (cap.cpk < 1.0 && !seen['CAPABILITY_LOW_' + keys[k]]) {
                seen['CAPABILITY_LOW_' + keys[k]] = true;
                var capActions = ACTION_CATALOG.CAPABILITY_LOW;
                for (var m = 0; m < capActions.length; m++) {
                    actions.push({
                        action: capActions[m].action + ' (' + keys[k] + ', Cpk=' + cap.cpk + ')',
                        priority: capActions[m].priority,
                        category: capActions[m].category,
                        trigger: 'Low capability for ' + keys[k]
                    });
                }
            }
        }
    }

    // Sort by priority
    var priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    actions.sort(function(a, b) {
        var pa = priorityOrder[a.priority] !== undefined ? priorityOrder[a.priority] : 99;
        var pb = priorityOrder[b.priority] !== undefined ? priorityOrder[b.priority] : 99;
        return pa - pb;
    });

    return actions;
}

// ── Verdict logic ──────────────────────────────────────────────────

function computeVerdict(metricReports) {
    var hasOutOfControl = false;
    var hasWarning = false;
    var hasInadequateCap = false;
    var hasLowCap = false;

    var keys = Object.keys(metricReports);
    for (var i = 0; i < keys.length; i++) {
        var m = metricReports[keys[i]];
        if (m.controlStatus === 'OUT_OF_CONTROL') hasOutOfControl = true;
        if (m.controlStatus === 'WARNING') hasWarning = true;
        if (m.capability && m.capability.rating === 'INADEQUATE') hasInadequateCap = true;
        if (m.capability && m.capability.rating === 'POOR') hasLowCap = true;
    }

    if (hasOutOfControl || hasInadequateCap) {
        return { verdict: 'FAIL', confidence: round(0.85 + Math.random() * 0.1, 2),
            reason: hasOutOfControl ? 'Out-of-control condition detected' : 'Process capability inadequate' };
    }
    if (hasWarning || hasLowCap) {
        return { verdict: 'HOLD', confidence: round(0.7 + Math.random() * 0.15, 2),
            reason: hasWarning ? 'Warning signals detected — requires review' : 'Process capability marginal' };
    }
    return { verdict: 'PASS', confidence: round(0.9 + Math.random() * 0.08, 2),
        reason: 'All metrics within control limits with adequate capability' };
}

// ── Main factory ───────────────────────────────────────────────────

function createQualityControlAutopilot() {
    var metrics = {};
    var data = {};          // metricName → [values]
    var timestamps = {};    // metricName → [timestamps]
    var violationHistory = [];
    var evaluationCount = 0;

    // Initialize with defaults
    var metricKeys = Object.keys(DEFAULT_METRICS);
    for (var i = 0; i < metricKeys.length; i++) {
        metrics[metricKeys[i]] = Object.assign({}, DEFAULT_METRICS[metricKeys[i]]);
        data[metricKeys[i]] = [];
        timestamps[metricKeys[i]] = [];
    }

    return {
        /**
         * Configure metric profiles. Merges with defaults.
         * @param {Object} opts - { metrics: { name: { target, lsl, usl, unit?, label? } } }
         */
        configure: function configure(opts) {
            if (!opts || typeof opts !== 'object') throw new Error('configure requires an options object');
            if (opts.metrics) {
                var keys = Object.keys(opts.metrics);
                for (var i = 0; i < keys.length; i++) {
                    var m = opts.metrics[keys[i]];
                    if (m.target === undefined || m.lsl === undefined || m.usl === undefined) {
                        throw new Error('Metric "' + keys[i] + '" requires target, lsl, and usl');
                    }
                    if (m.lsl >= m.usl) throw new Error('lsl must be less than usl for "' + keys[i] + '"');
                    if (m.target < m.lsl || m.target > m.usl) {
                        throw new Error('target must be between lsl and usl for "' + keys[i] + '"');
                    }
                    if (_isDangerousKey(keys[i])) continue;
                    metrics[keys[i]] = {
                        target: m.target,
                        lsl: m.lsl,
                        usl: m.usl,
                        unit: m.unit || '',
                        label: m.label || keys[i]
                    };
                    if (!data[keys[i]]) {
                        data[keys[i]] = [];
                        timestamps[keys[i]] = [];
                    }
                }
            }
        },

        /**
         * Ingest a sample with one or more metric values.
         * @param {Object} sample - { metricName: value, ... }
         * @param {number} [ts] - Optional timestamp (defaults to Date.now())
         * @returns {Object} Ingestion summary
         */
        ingest: function ingest(sample, ts) {
            if (!sample || typeof sample !== 'object') throw new Error('ingest requires a sample object');
            var timestamp = ts || Date.now();
            var accepted = 0;
            var rejected = 0;
            var keys = Object.keys(sample);
            for (var i = 0; i < keys.length; i++) {
                if (!metrics[keys[i]]) {
                    rejected++;
                    continue;
                }
                var val = sample[keys[i]];
                if (typeof val !== 'number' || isNaN(val)) {
                    rejected++;
                    continue;
                }
                data[keys[i]].push(val);
                timestamps[keys[i]].push(timestamp);
                accepted++;
            }
            return { accepted: accepted, rejected: rejected, timestamp: timestamp };
        },

        /**
         * Ingest multiple samples at once.
         * @param {Array} samples - Array of sample objects
         * @returns {Object} Batch ingestion summary
         */
        ingestBatch: function ingestBatch(samples) {
            if (!Array.isArray(samples)) throw new Error('ingestBatch requires an array');
            var totalAccepted = 0, totalRejected = 0;
            for (var i = 0; i < samples.length; i++) {
                var result = this.ingest(samples[i]);
                totalAccepted += result.accepted;
                totalRejected += result.rejected;
            }
            return { samplesProcessed: samples.length, accepted: totalAccepted, rejected: totalRejected };
        },

        /**
         * Run full SPC evaluation across all metrics.
         * @returns {Object} Complete quality report with verdict
         */
        evaluate: function evaluate() {
            evaluationCount++;
            var metricReports = {};
            var allViolations = [];
            var capabilities = {};

            var metricNames = Object.keys(metrics);
            for (var i = 0; i < metricNames.length; i++) {
                var name = metricNames[i];
                var values = data[name];
                var config = metrics[name];

                if (values.length < 2) {
                    metricReports[name] = {
                        label: config.label,
                        sampleCount: values.length,
                        controlStatus: 'IN_CONTROL',
                        message: 'Insufficient data for analysis (need ≥2 samples)',
                        capability: null,
                        trend: null,
                        violations: [],
                        controlLimits: null
                    };
                    continue;
                }

                var mean = computeMean(values);
                var sigma = computeStdDev(values, mean);
                var trend = computeTrend(values);
                var cap = computeCapability(mean, sigma, config.lsl, config.usl);
                capabilities[name] = cap;

                // Run Western Electric rules
                var violations = [];
                violations = violations.concat(rule1_beyond3sigma(values, mean, sigma));
                violations = violations.concat(rule2_nineSameSide(values, mean));
                violations = violations.concat(rule3_sixTrend(values));
                violations = violations.concat(rule4_twoOfThreeBeyond2sigma(values, mean, sigma));
                violations = violations.concat(rule5_fourteenAlternating(values));

                // Add trend-based violations
                if (trend.strength > 0.7 && trend.direction !== 'STABLE') {
                    violations.push({
                        index: values.length - 1,
                        value: values[values.length - 1],
                        rule: 'TREND_DRIFT',
                        severity: 'WARNING',
                        description: 'Strong ' + trend.direction.toLowerCase() + ' trend (R²=' + trend.strength + ')'
                    });
                }

                allViolations = allViolations.concat(violations);

                // Determine control status
                var controlStatus = 'IN_CONTROL';
                for (var v = 0; v < violations.length; v++) {
                    if (violations[v].severity === 'OUT_OF_CONTROL') {
                        controlStatus = 'OUT_OF_CONTROL';
                        break;
                    }
                    if (violations[v].severity === 'WARNING') {
                        controlStatus = 'WARNING';
                    }
                }

                metricReports[name] = {
                    label: config.label,
                    unit: config.unit,
                    sampleCount: values.length,
                    mean: round(mean, 4),
                    stdDev: round(sigma, 4),
                    min: round(Math.min.apply(null, values), 4),
                    max: round(Math.max.apply(null, values), 4),
                    controlStatus: controlStatus,
                    controlLimits: {
                        ucl: round(mean + 3 * sigma, 4),
                        lcl: round(mean - 3 * sigma, 4),
                        warnUpper: round(mean + 2 * sigma, 4),
                        warnLower: round(mean - 2 * sigma, 4),
                        centerLine: round(mean, 4)
                    },
                    capability: cap,
                    trend: trend,
                    violations: violations,
                    specLimits: { lsl: config.lsl, usl: config.usl, target: config.target }
                };
            }

            // Generate corrective actions
            var actions = generateActions(allViolations, capabilities);

            // Compute verdict
            var verdictResult = computeVerdict(metricReports);

            // Store violation history
            for (var h = 0; h < allViolations.length; h++) {
                violationHistory.push({
                    evaluationId: evaluationCount,
                    timestamp: Date.now(),
                    violation: allViolations[h]
                });
            }
            // Keep history bounded
            if (violationHistory.length > 500) {
                violationHistory = violationHistory.slice(violationHistory.length - 500);
            }

            // Compute overall process health score 0-100
            var healthScore = 100;
            var metricCount = 0;
            var reportKeys = Object.keys(metricReports);
            for (var s = 0; s < reportKeys.length; s++) {
                var mr = metricReports[reportKeys[s]];
                if (mr.sampleCount < 2) continue;
                metricCount++;
                if (mr.controlStatus === 'OUT_OF_CONTROL') healthScore -= 25;
                else if (mr.controlStatus === 'WARNING') healthScore -= 10;
                if (mr.capability) {
                    if (mr.capability.rating === 'INADEQUATE') healthScore -= 15;
                    else if (mr.capability.rating === 'POOR') healthScore -= 8;
                }
                if (mr.trend && mr.trend.strength > 0.7 && mr.trend.direction !== 'STABLE') {
                    healthScore -= 5;
                }
            }
            healthScore = Math.max(0, Math.min(100, healthScore));

            return {
                evaluationId: evaluationCount,
                timestamp: new Date().toISOString(),
                verdict: verdictResult,
                healthScore: round(healthScore, 0),
                metrics: metricReports,
                totalViolations: allViolations.length,
                actions: actions,
                summary: {
                    metricsMonitored: reportKeys.length,
                    metricsWithData: metricCount,
                    inControl: reportKeys.filter(function(k) { return metricReports[k].controlStatus === 'IN_CONTROL'; }).length,
                    warning: reportKeys.filter(function(k) { return metricReports[k].controlStatus === 'WARNING'; }).length,
                    outOfControl: reportKeys.filter(function(k) { return metricReports[k].controlStatus === 'OUT_OF_CONTROL'; }).length
                }
            };
        },

        /**
         * Get violation history across evaluations.
         * @param {Object} [opts] - { limit?, rule? }
         * @returns {Array} Violation history entries
         */
        getViolationHistory: function getViolationHistory(opts) {
            var result = violationHistory.slice();
            if (opts && opts.rule) {
                result = result.filter(function(v) { return v.violation.rule === opts.rule; });
            }
            if (opts && opts.limit) {
                result = result.slice(Math.max(0, result.length - opts.limit));
            }
            return result;
        },

        /**
         * Analyze chronic issues from violation history.
         * @returns {Object} Chronic issue analysis
         */
        analyzeChronicIssues: function analyzeChronicIssues() {
            var ruleCounts = {};
            for (var i = 0; i < violationHistory.length; i++) {
                var rule = violationHistory[i].violation.rule;
                ruleCounts[rule] = (ruleCounts[rule] || 0) + 1;
            }
            var chronic = [];
            var ruleKeys = Object.keys(ruleCounts);
            for (var j = 0; j < ruleKeys.length; j++) {
                if (ruleCounts[ruleKeys[j]] >= 3) {
                    chronic.push({
                        rule: ruleKeys[j],
                        occurrences: ruleCounts[ruleKeys[j]],
                        classification: ruleCounts[ruleKeys[j]] >= 10 ? 'SYSTEMIC' :
                                       ruleCounts[ruleKeys[j]] >= 5  ? 'CHRONIC' : 'RECURRING'
                    });
                }
            }
            chronic.sort(function(a, b) { return b.occurrences - a.occurrences; });
            return {
                totalEvaluations: evaluationCount,
                totalHistoricalViolations: violationHistory.length,
                chronicIssues: chronic,
                assessment: chronic.length === 0 ? 'No chronic issues detected' :
                    chronic.length + ' recurring issue(s) found — systemic investigation recommended'
            };
        },

        /**
         * Get raw data for a metric.
         * @param {string} metricName
         * @returns {Object} { values, timestamps, config }
         */
        getData: function getData(metricName) {
            if (!metrics[metricName]) throw new Error('Unknown metric: ' + metricName);
            return {
                values: data[metricName].slice(),
                timestamps: timestamps[metricName].slice(),
                config: Object.assign({}, metrics[metricName]),
                count: data[metricName].length
            };
        },

        /**
         * Reset all data (keep configuration).
         */
        reset: function reset() {
            var keys = Object.keys(data);
            for (var i = 0; i < keys.length; i++) {
                data[keys[i]] = [];
                timestamps[keys[i]] = [];
            }
            violationHistory = [];
            evaluationCount = 0;
        },

        /**
         * Get configured metrics summary.
         * @returns {Object} Metric configurations
         */
        getMetrics: function getMetrics() {
            var result = {};
            var keys = Object.keys(metrics);
            for (var i = 0; i < keys.length; i++) {
                result[keys[i]] = Object.assign({}, metrics[keys[i]]);
            }
            return result;
        },

        /**
         * Generate a text-based control chart for a metric.
         * @param {string} metricName
         * @param {Object} [opts] - { width?: number }
         * @returns {string} ASCII control chart
         */
        controlChart: function controlChart(metricName, opts) {
            if (!metrics[metricName]) throw new Error('Unknown metric: ' + metricName);
            var values = data[metricName];
            if (values.length < 2) return 'Insufficient data for control chart';
            var width = (opts && opts.width) || 60;
            var mean = computeMean(values);
            var sigma = computeStdDev(values, mean);
            var ucl = mean + 3 * sigma;
            var lcl = mean - 3 * sigma;
            var chartMin = Math.min(lcl, Math.min.apply(null, values)) - sigma * 0.5;
            var chartMax = Math.max(ucl, Math.max.apply(null, values)) + sigma * 0.5;
            var range = chartMax - chartMin;
            if (range === 0) range = 1;

            var lines = [];
            lines.push('Control Chart: ' + (metrics[metricName].label || metricName));
            lines.push('UCL=' + round(ucl, 3) + '  CL=' + round(mean, 3) + '  LCL=' + round(lcl, 3));
            lines.push('-'.repeat(width + 10));

            for (var i = 0; i < values.length; i++) {
                var pos = Math.round(((values[i] - chartMin) / range) * width);
                pos = Math.max(0, Math.min(width - 1, pos));
                var line = '';
                for (var c = 0; c < width; c++) {
                    var uclPos = Math.round(((ucl - chartMin) / range) * width);
                    var lclPos = Math.round(((lcl - chartMin) / range) * width);
                    var clPos = Math.round(((mean - chartMin) / range) * width);
                    if (c === pos) line += (values[i] > ucl || values[i] < lcl) ? 'X' : '*';
                    else if (c === uclPos || c === lclPos) line += '|';
                    else if (c === clPos) line += ':';
                    else line += ' ';
                }
                lines.push(round(values[i], 3).toString().padStart(8) + ' ' + line);
            }
            lines.push('-'.repeat(width + 10));
            return lines.join('\n');
        }
    };
}

module.exports = { createQualityControlAutopilot: createQualityControlAutopilot };
