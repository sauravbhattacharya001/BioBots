'use strict';

var round = require('./validation').round;
var _sanitize = require('./sanitize');
var _isDangerousKey = _sanitize.isDangerousKey;

/**
 * Protocol Deviation Tracker
 *
 * Autonomous deviation detection and management for bioprinting protocols.
 * Monitors process parameters against defined protocol specifications,
 * detects deviations in real-time, classifies severity, tracks trends,
 * and recommends corrective/preventive actions (CAPA).
 *
 * Agency features:
 * - Proactive deviation detection against protocol bounds
 * - Severity auto-classification (minor/major/critical)
 * - Trend analysis with recurring deviation detection
 * - CAPA recommendation engine
 * - Risk escalation when deviation patterns emerge
 */

var DEVIATION_CATEGORIES = {
    temperature: { unit: '°C', label: 'Temperature Excursion' },
    pressure: { unit: 'kPa', label: 'Pressure Deviation' },
    speed: { unit: 'mm/s', label: 'Print Speed Deviation' },
    flowRate: { unit: 'µL/min', label: 'Flow Rate Deviation' },
    layerHeight: { unit: 'µm', label: 'Layer Height Deviation' },
    exposureTime: { unit: 's', label: 'UV Exposure Time Deviation' },
    cellDensity: { unit: 'cells/mL', label: 'Cell Density Deviation' },
    timing: { unit: 'min', label: 'Process Timing Deviation' },
    ph: { unit: 'pH', label: 'pH Deviation' },
    humidity: { unit: '%', label: 'Humidity Deviation' }
};

var SEVERITY_LEVELS = {
    MINOR: { threshold: 0.10, score: 1, color: 'yellow', label: 'Minor',
        description: 'Within acceptable tolerance but outside optimal range' },
    MAJOR: { threshold: 0.25, score: 3, color: 'orange', label: 'Major',
        description: 'Exceeds acceptable tolerance; may affect quality' },
    CRITICAL: { threshold: 0.50, score: 5, color: 'red', label: 'Critical',
        description: 'Far outside specification; likely compromises results' }
};

var CAPA_TEMPLATES = {
    temperature: {
        corrective: 'Recalibrate temperature controller; verify thermocouple placement',
        preventive: 'Install redundant temperature sensor; add automated alert at ±2°C'
    },
    pressure: {
        corrective: 'Inspect pneumatic lines for leaks; recalibrate pressure regulator',
        preventive: 'Schedule quarterly pressure system maintenance; add inline pressure monitor'
    },
    speed: {
        corrective: 'Verify motor calibration; check for mechanical binding',
        preventive: 'Implement closed-loop speed control; lubricate linear rails'
    },
    flowRate: {
        corrective: 'Purge and recalibrate syringe pump; check for nozzle clog',
        preventive: 'Use inline flow sensor; implement pre-print priming protocol'
    },
    layerHeight: {
        corrective: 'Re-level build platform; verify Z-axis calibration',
        preventive: 'Install displacement sensor for closed-loop Z control'
    },
    exposureTime: {
        corrective: 'Verify UV source intensity; recalibrate timer circuit',
        preventive: 'Install radiometer for real-time dose monitoring'
    },
    cellDensity: {
        corrective: 'Recount cells; remix bioink suspension thoroughly',
        preventive: 'Use automated cell counter before each run; set homogeneity check step'
    },
    timing: {
        corrective: 'Review operator procedure adherence; identify delay source',
        preventive: 'Implement timed step prompts in protocol software'
    },
    ph: {
        corrective: 'Adjust buffer; recalibrate pH meter with fresh standards',
        preventive: 'Use inline pH probe; add buffer capacity check to pre-run'
    },
    humidity: {
        corrective: 'Adjust humidifier/dehumidifier; check HVAC dampers',
        preventive: 'Install humidity data logger with automated alerts'
    }
};

function classifySeverity(actual, target, tolerance) {
    if (target === 0) return 'MINOR';
    var deviation = Math.abs(actual - target) / Math.abs(target);
    if (deviation >= SEVERITY_LEVELS.CRITICAL.threshold) return 'CRITICAL';
    if (deviation >= SEVERITY_LEVELS.MAJOR.threshold) return 'MAJOR';
    if (deviation >= SEVERITY_LEVELS.MINOR.threshold) return 'MINOR';
    return null; // within spec
}

function createProtocolDeviationTracker() {
    var deviations = [];
    var protocols = {};
    var nextId = 1;

    /**
     * Register a protocol specification.
     * @param {string} protocolId - Unique protocol identifier.
     * @param {Object} spec - Parameter specifications.
     * @param {string} [spec.<param>.category] - Deviation category key.
     * @param {number} spec.<param>.target - Target value.
     * @param {number} spec.<param>.tolerance - Acceptable ± tolerance.
     * @returns {Object} Registered protocol summary.
     */
    function registerProtocol(protocolId, spec) {
        if (!protocolId || typeof protocolId !== 'string') {
            throw new Error('protocolId must be a non-empty string');
        }
        // CWE-1321: reject prototype-pollution keys in protocolId
        if (_isDangerousKey(protocolId)) {
            throw new Error('protocolId contains a disallowed key name');
        }
        if (!spec || typeof spec !== 'object') {
            throw new Error('spec must be an object with parameter definitions');
        }
        var params = Object.create(null);
        var keys = Object.keys(spec);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            // CWE-1321: skip prototype-pollution keys in parameter spec
            if (_isDangerousKey(k)) continue;
            var s = spec[k];
            if (typeof s.target !== 'number' || typeof s.tolerance !== 'number') {
                throw new Error('Parameter "' + k + '" must have numeric target and tolerance');
            }
            params[k] = {
                category: s.category || k,
                target: s.target,
                tolerance: s.tolerance,
                lowerBound: s.target - s.tolerance,
                upperBound: s.target + s.tolerance
            };
        }
        protocols[protocolId] = { id: protocolId, params: params, registered: new Date().toISOString() };
        return { protocolId: protocolId, parameterCount: keys.length, parameters: Object.keys(params) };
    }

    /**
     * Check actual readings against a registered protocol.
     * Autonomously detects all deviations, classifies severity, and returns CAPA recommendations.
     * @param {string} protocolId - Registered protocol ID.
     * @param {Object} readings - Actual parameter readings { paramName: value }.
     * @param {Object} [meta] - Optional metadata (operator, batchId, equipment).
     * @returns {Object} Deviation report.
     */
    function checkReadings(protocolId, readings, meta) {
        // CWE-1321: reject prototype-pollution keys in protocolId lookup
        if (_isDangerousKey(protocolId)) {
            throw new Error('protocolId contains a disallowed key name');
        }
        var protocol = protocols[protocolId];
        if (!protocol) {
            throw new Error('Protocol "' + protocolId + '" not registered. Call registerProtocol first.');
        }
        if (!readings || typeof readings !== 'object') {
            throw new Error('readings must be an object');
        }

        var found = [];
        var paramKeys = Object.keys(protocol.params);
        var timestamp = new Date().toISOString();

        for (var i = 0; i < paramKeys.length; i++) {
            var pName = paramKeys[i];
            if (!(pName in readings)) continue;
            var actual = readings[pName];
            if (typeof actual !== 'number') continue;

            var spec = protocol.params[pName];
            var severity = classifySeverity(actual, spec.target, spec.tolerance);
            if (!severity) continue;

            var cat = spec.category;
            var catInfo = DEVIATION_CATEGORIES[cat] || { unit: '', label: cat };
            var sevInfo = SEVERITY_LEVELS[severity];
            var capa = CAPA_TEMPLATES[cat] || {
                corrective: 'Investigate root cause for ' + pName,
                preventive: 'Add monitoring for ' + pName
            };

            var deviation = {
                id: 'DEV-' + String(nextId++).padStart(4, '0'),
                timestamp: timestamp,
                protocolId: protocolId,
                parameter: pName,
                category: cat,
                categoryLabel: catInfo.label,
                target: spec.target,
                tolerance: spec.tolerance,
                actual: actual,
                delta: round(actual - spec.target, 4),
                deviationPct: round(Math.abs(actual - spec.target) / Math.abs(spec.target) * 100, 1),
                severity: severity,
                severityScore: sevInfo.score,
                severityLabel: sevInfo.label,
                description: sevInfo.description,
                capa: capa,
                meta: meta || {},
                status: 'OPEN'
            };

            found.push(deviation);
            deviations.push(deviation);
        }

        var maxSeverity = 'NONE';
        var totalScore = 0;
        for (var j = 0; j < found.length; j++) {
            totalScore += found[j].severityScore;
            if (found[j].severity === 'CRITICAL') maxSeverity = 'CRITICAL';
            else if (found[j].severity === 'MAJOR' && maxSeverity !== 'CRITICAL') maxSeverity = 'MAJOR';
            else if (found[j].severity === 'MINOR' && maxSeverity === 'NONE') maxSeverity = 'MINOR';
        }

        var proceed = maxSeverity !== 'CRITICAL';
        var recommendation = proceed
            ? (maxSeverity === 'NONE' ? 'All parameters within specification — proceed.'
                : 'Deviations detected but non-critical — proceed with documented deviations.')
            : 'CRITICAL deviation detected — STOP and remediate before proceeding.';

        return {
            protocolId: protocolId,
            timestamp: timestamp,
            parametersChecked: paramKeys.length,
            deviationsFound: found.length,
            maxSeverity: maxSeverity,
            totalSeverityScore: totalScore,
            proceedRecommendation: proceed,
            recommendation: recommendation,
            deviations: found
        };
    }

    /**
     * Analyze deviation trends across all recorded history.
     * Proactively identifies recurring issues, escalating patterns, and hotspots.
     * @returns {Object} Trend analysis report with proactive insights.
     */
    function analyzeTrends() {
        if (deviations.length === 0) {
            return { totalDeviations: 0, message: 'No deviations recorded yet.', insights: [] };
        }

        // Count by category — use null-prototype objects to prevent
        // prototype-pollution when keys come from user-registered data
        // (CWE-1321).
        var byCat = Object.create(null);
        var bySeverity = Object.create(null);
        bySeverity.MINOR = 0; bySeverity.MAJOR = 0; bySeverity.CRITICAL = 0;
        var byProtocol = Object.create(null);
        var byParam = Object.create(null);

        for (var i = 0; i < deviations.length; i++) {
            var d = deviations[i];
            byCat[d.category] = (byCat[d.category] || 0) + 1;
            bySeverity[d.severity] = (bySeverity[d.severity] || 0) + 1;
            byProtocol[d.protocolId] = (byProtocol[d.protocolId] || 0) + 1;
            var pk = d.protocolId + ':' + d.parameter;
            byParam[pk] = (byParam[pk] || 0) + 1;
        }

        // Detect recurring deviations (same parameter, 3+ times)
        var recurring = [];
        var paramKeys = Object.keys(byParam);
        for (var j = 0; j < paramKeys.length; j++) {
            if (byParam[paramKeys[j]] >= 3) {
                recurring.push({ key: paramKeys[j], count: byParam[paramKeys[j]] });
            }
        }
        recurring.sort(function(a, b) { return b.count - a.count; });

        // Top category
        var topCat = null;
        var topCatCount = 0;
        var catKeys = Object.keys(byCat);
        for (var c = 0; c < catKeys.length; c++) {
            if (byCat[catKeys[c]] > topCatCount) {
                topCat = catKeys[c];
                topCatCount = byCat[catKeys[c]];
            }
        }

        // Proactive insights
        var insights = [];
        if (recurring.length > 0) {
            insights.push({
                type: 'RECURRING_DEVIATION',
                severity: 'warning',
                message: recurring.length + ' parameter(s) have recurring deviations (3+). Root cause investigation recommended.',
                details: recurring
            });
        }
        if (bySeverity.CRITICAL > 0) {
            var critPct = round(bySeverity.CRITICAL / deviations.length * 100, 1);
            insights.push({
                type: 'CRITICAL_RATE',
                severity: critPct > 20 ? 'critical' : 'warning',
                message: critPct + '% of deviations are critical. Systemic issue possible.',
                criticalCount: bySeverity.CRITICAL
            });
        }
        if (topCat) {
            var catLabel = (DEVIATION_CATEGORIES[topCat] || {}).label || topCat;
            insights.push({
                type: 'TOP_CATEGORY',
                severity: 'info',
                message: '"' + catLabel + '" is the most frequent deviation category (' + topCatCount + ' occurrences).',
                category: topCat,
                count: topCatCount
            });
        }

        // Severity trend: check if recent deviations are more severe
        if (deviations.length >= 6) {
            var half = Math.floor(deviations.length / 2);
            var earlyAvg = 0, lateAvg = 0;
            for (var e = 0; e < half; e++) earlyAvg += deviations[e].severityScore;
            for (var l = half; l < deviations.length; l++) lateAvg += deviations[l].severityScore;
            earlyAvg /= half;
            lateAvg /= (deviations.length - half);
            if (lateAvg > earlyAvg * 1.3) {
                insights.push({
                    type: 'ESCALATING_SEVERITY',
                    severity: 'critical',
                    message: 'Deviation severity is escalating. Early avg: ' + round(earlyAvg, 2) + ', recent avg: ' + round(lateAvg, 2) + '. Immediate review recommended.',
                    earlyAvg: round(earlyAvg, 2),
                    recentAvg: round(lateAvg, 2)
                });
            }
        }

        return {
            totalDeviations: deviations.length,
            bySeverity: bySeverity,
            byCategory: byCat,
            byProtocol: byProtocol,
            recurringDeviations: recurring,
            insights: insights
        };
    }

    /**
     * Resolve a deviation by ID with disposition.
     * @param {string} devId - Deviation ID (e.g., 'DEV-0001').
     * @param {string} disposition - Resolution disposition.
     * @param {string} [notes] - Resolution notes.
     * @returns {Object} Updated deviation record.
     */
    function resolveDeviation(devId, disposition, notes) {
        for (var i = 0; i < deviations.length; i++) {
            if (deviations[i].id === devId) {
                deviations[i].status = 'RESOLVED';
                deviations[i].disposition = disposition;
                deviations[i].resolutionNotes = notes || '';
                deviations[i].resolvedAt = new Date().toISOString();
                return deviations[i];
            }
        }
        throw new Error('Deviation "' + devId + '" not found');
    }

    /**
     * Get the current deviation log (optionally filtered).
     * @param {Object} [filter] - Optional filters.
     * @param {string} [filter.severity] - Filter by severity.
     * @param {string} [filter.status] - Filter by status (OPEN/RESOLVED).
     * @param {string} [filter.protocolId] - Filter by protocol.
     * @returns {Object[]} Filtered deviation records.
     */
    function getLog(filter) {
        if (!filter) return deviations.slice();
        return deviations.filter(function(d) {
            if (filter.severity && d.severity !== filter.severity) return false;
            if (filter.status && d.status !== filter.status) return false;
            if (filter.protocolId && d.protocolId !== filter.protocolId) return false;
            return true;
        });
    }

    /**
     * Generate a summary report suitable for regulatory submission.
     * @param {string} [protocolId] - Optional filter to single protocol.
     * @returns {Object} Formatted summary report.
     */
    function generateReport(protocolId) {
        var subset = protocolId
            ? deviations.filter(function(d) { return d.protocolId === protocolId; })
            : deviations;

        var open = 0, resolved = 0;
        var severityCounts = { MINOR: 0, MAJOR: 0, CRITICAL: 0 };
        for (var i = 0; i < subset.length; i++) {
            if (subset[i].status === 'OPEN') open++;
            else resolved++;
            severityCounts[subset[i].severity]++;
        }

        var trends = analyzeTrends();

        return {
            reportDate: new Date().toISOString(),
            scope: protocolId || 'ALL_PROTOCOLS',
            totalDeviations: subset.length,
            openDeviations: open,
            resolvedDeviations: resolved,
            bySeverity: severityCounts,
            resolutionRate: subset.length > 0 ? round(resolved / subset.length * 100, 1) : 100,
            recurringIssues: trends.recurringDeviations,
            insights: trends.insights,
            deviations: subset
        };
    }

    return {
        registerProtocol: registerProtocol,
        checkReadings: checkReadings,
        analyzeTrends: analyzeTrends,
        resolveDeviation: resolveDeviation,
        getLog: getLog,
        generateReport: generateReport
    };
}

exports.createProtocolDeviationTracker = createProtocolDeviationTracker;
