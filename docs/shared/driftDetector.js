'use strict';

/**
 * Parameter Drift Detector
 *
 * Autonomous monitoring module that detects statistical drift in bioprinting
 * process parameters over time. Uses sliding-window analysis with multiple
 * detection algorithms to identify when parameters are shifting away from
 * their established baselines — even when individual readings are still
 * within spec.
 *
 * Key capabilities:
 * - Continuous ingestion of parameter time-series data
 * - CUSUM (Cumulative Sum) control chart for mean-shift detection
 * - Sliding-window variance analysis for dispersion drift
 * - Trend slope estimation via least-squares regression
 * - Severity classification: STABLE → DRIFTING → DIVERGING → CRITICAL
 * - Probable root cause inference from drift patterns
 * - Corrective action recommendations with urgency scoring
 * - Multi-parameter correlation for systemic drift detection
 * - Drift forecast: estimated time until parameter exits safe range
 *
 * @example
 *   var dd = createDriftDetector();
 *   // Feed baseline readings
 *   dd.ingest({ temperature: 23.1, pressure: 101.2, flowRate: 5.0 });
 *   dd.ingest({ temperature: 23.0, pressure: 101.3, flowRate: 5.1 });
 *   // ... many readings later, temperature starts creeping up ...
 *   dd.ingest({ temperature: 23.8, pressure: 101.2, flowRate: 5.0 });
 *   var report = dd.analyze();
 *   // report.parameters.temperature.status => 'DRIFTING'
 *   // report.parameters.temperature.forecast => { hitsLimit: '~45 min' }
 *   // report.recommendations => [{ action: '...', urgency: 7 }]
 */

// ── Drift severity levels ──────────────────────────────────────────

var SEVERITY_LEVELS = [
    { level: 'STABLE',    priority: 0, color: '#22c55e', label: 'Stable'    },
    { level: 'DRIFTING',  priority: 1, color: '#eab308', label: 'Drifting'  },
    { level: 'DIVERGING', priority: 2, color: '#f97316', label: 'Diverging' },
    { level: 'CRITICAL',  priority: 3, color: '#ef4444', label: 'Critical'  }
];

// ── Default parameter profiles ─────────────────────────────────────
// Users can override these or add custom parameters via configure()

var DEFAULT_PROFILES = {
    temperature:     { unit: '°C',    safeMin: 20, safeMax: 25, cusumThreshold: 3.0, varianceMultiplier: 2.5 },
    pressure:        { unit: 'kPa',   safeMin: 95, safeMax: 110, cusumThreshold: 4.0, varianceMultiplier: 2.5 },
    flowRate:        { unit: 'mL/min', safeMin: 0.5, safeMax: 20, cusumThreshold: 2.5, varianceMultiplier: 3.0 },
    humidity:        { unit: '%RH',   safeMin: 30, safeMax: 60, cusumThreshold: 3.5, varianceMultiplier: 2.5 },
    nozzleDiameter:  { unit: 'µm',    safeMin: 100, safeMax: 500, cusumThreshold: 2.0, varianceMultiplier: 2.0 },
    layerHeight:     { unit: 'µm',    safeMin: 50, safeMax: 400, cusumThreshold: 2.0, varianceMultiplier: 2.0 },
    cellViability:   { unit: '%',     safeMin: 70, safeMax: 100, cusumThreshold: 3.0, varianceMultiplier: 2.5 },
    printSpeed:      { unit: 'mm/s',  safeMin: 1, safeMax: 50, cusumThreshold: 3.0, varianceMultiplier: 2.5 },
    crosslinkTime:   { unit: 's',     safeMin: 10, safeMax: 300, cusumThreshold: 3.0, varianceMultiplier: 2.5 },
    viscosity:       { unit: 'Pa·s',  safeMin: 0.1, safeMax: 100, cusumThreshold: 3.5, varianceMultiplier: 3.0 }
};

// ── Root cause patterns ────────────────────────────────────────────

var ROOT_CAUSES = {
    temperature: {
        upward:   ['HVAC degradation', 'Exothermic reaction in nearby process', 'Lamp/UV source heat buildup', 'Room overcrowding'],
        downward: ['HVAC overcooling', 'Ambient temperature drop', 'Door left open', 'Coolant leak'],
        variance: ['Thermostat cycling failure', 'HVAC compressor short-cycling', 'Drafts from unsealed ports']
    },
    pressure: {
        upward:   ['Nozzle partial clog', 'Bioink viscosity increase', 'Filter buildup', 'Syringe plunger resistance'],
        downward: ['Leak in pressure line', 'Syringe running low', 'Air bubble in line', 'Seal degradation'],
        variance: ['Pulsatile pump artifact', 'Intermittent clog-clear cycle', 'Unstable pressure regulator']
    },
    flowRate: {
        upward:   ['Pressure compensation over-correcting', 'Viscosity drop due to warming', 'Air in line causing spurts'],
        downward: ['Nozzle clogging', 'Bioink gelation', 'Syringe depletion', 'Tubing kink'],
        variance: ['Heterogeneous bioink', 'Pump calibration drift', 'Cell aggregate blockage cycles']
    },
    humidity: {
        upward:   ['Water bath evaporation nearby', 'Humidifier malfunction', 'Wet cleaning residue', 'Autoclave steam leak'],
        downward: ['Dehumidifier overactive', 'Dry gas purge', 'HVAC dehumidification'],
        variance: ['Door opening cycles', 'Humidifier on-off cycling', 'Seasonal ambient swings']
    },
    viscosity: {
        upward:   ['Bioink evaporation/drying', 'Temperature drop', 'Crosslinking initiated prematurely', 'Cell settling increasing density'],
        downward: ['Bioink dilution', 'Temperature rise', 'Enzymatic degradation', 'Shear thinning'],
        variance: ['Heterogeneous mixing', 'Cell aggregate disruption', 'Temperature fluctuations']
    },
    cellViability: {
        upward:   ['Improved media formulation', 'Better handling technique', 'Recovery from prior stress'],
        downward: ['Shear stress damage', 'Temperature excursion', 'Contamination onset', 'Nutrient depletion', 'pH drift'],
        variance: ['Inconsistent counting technique', 'Heterogeneous cell suspension', 'Sample handling variation']
    },
    _default: {
        upward:   ['Process parameter increasing — investigate actuator or input changes'],
        downward: ['Process parameter decreasing — check for degradation or depletion'],
        variance: ['Increased variability — check for intermittent disturbances']
    }
};

// ── Corrective actions ─────────────────────────────────────────────

// ── Prototype Pollution Guard (CWE-1321) ──────────────────────────
var _sanitize = require('./sanitize');
var _isDangerousKey = _sanitize.isDangerousKey;

var CORRECTIVE_ACTIONS = {
    temperature:   { action: 'Check HVAC setpoints, verify room seals, inspect heat sources', urgencyBase: 6 },
    pressure:      { action: 'Inspect nozzle for clogs, check pressure lines and seals, verify bioink consistency', urgencyBase: 8 },
    flowRate:      { action: 'Prime nozzle, check for air bubbles, verify bioink homogeneity, recalibrate pump', urgencyBase: 8 },
    humidity:      { action: 'Check humidifier/dehumidifier, inspect room seals, verify HVAC balance', urgencyBase: 5 },
    nozzleDiameter:{ action: 'Clean nozzle, check for material buildup, verify calibration', urgencyBase: 7 },
    layerHeight:   { action: 'Recalibrate Z-axis, check substrate flatness, verify extrusion rate', urgencyBase: 7 },
    cellViability: { action: 'Check media freshness, verify temperature, test for contamination, reduce shear', urgencyBase: 9 },
    printSpeed:    { action: 'Check motor drivers, verify firmware settings, inspect mechanical linkage', urgencyBase: 6 },
    crosslinkTime: { action: 'Verify crosslinker concentration, check UV lamp intensity, test bioink batch', urgencyBase: 7 },
    viscosity:     { action: 'Test bioink temperature, check mixing, verify storage conditions, test fresh batch', urgencyBase: 8 },
    _default:      { action: 'Investigate parameter source and recent process changes', urgencyBase: 5 }
};

// ── Math helpers (delegated to shared stats module) ───────────────

var _stats = require('./stats');
var mean = _stats.mean;
var stddev = _stats.stddev;

/**
 * Index-based linear regression: treats array indices as x-values.
 * Delegates heavy lifting to shared stats.linearRegression.
 */
function linearRegression(values) {
    var n = values.length;
    if (n < 2) return { slope: 0, intercept: values[0] || 0, r2: 0 };
    var xs = new Array(n);
    for (var i = 0; i < n; i++) xs[i] = i;
    var result = _stats.linearRegression(xs, values);
    return { slope: result.slope, intercept: result.intercept, r2: Math.max(0, result.r2) };
}

// ── CUSUM calculation ──────────────────────────────────────────────

function computeCusum(values, targetMean, allowance) {
    var cusumHigh = 0;
    var cusumLow = 0;
    var maxHigh = 0;
    var maxLow = 0;
    for (var i = 0; i < values.length; i++) {
        cusumHigh = Math.max(0, cusumHigh + (values[i] - targetMean - allowance));
        cusumLow = Math.max(0, cusumLow + (targetMean - allowance - values[i]));
        if (cusumHigh > maxHigh) maxHigh = cusumHigh;
        if (cusumLow > maxLow) maxLow = cusumLow;
    }
    return { high: cusumHigh, low: cusumLow, maxHigh: maxHigh, maxLow: maxLow };
}

// ── Factory ────────────────────────────────────────────────────────

function createDriftDetector(options) {
    options = options || {};
    var windowSize = options.windowSize || 30;
    var baselineSize = options.baselineSize || 15;
    var profiles = {};
    var series = {};       // { paramName: [values] }
    var timestamps = [];   // parallel array of timestamps
    var readingCount = 0;

    // Merge default profiles with user overrides
    var keys = Object.keys(DEFAULT_PROFILES);
    for (var k = 0; k < keys.length; k++) {
        profiles[keys[k]] = Object.assign({}, DEFAULT_PROFILES[keys[k]]);
    }
    if (options.profiles) {
        var userKeys = Object.keys(options.profiles);
        for (var u = 0; u < userKeys.length; u++) {
            if (_isDangerousKey(userKeys[u])) continue;
            profiles[userKeys[u]] = Object.assign({}, DEFAULT_PROFILES[userKeys[u]] || {}, options.profiles[userKeys[u]]);
        }
    }

    /**
     * Configure or add parameter profiles dynamically.
     */
    function configure(newProfiles) {
        if (!newProfiles || typeof newProfiles !== 'object') return;
        var pkeys = Object.keys(newProfiles);
        for (var i = 0; i < pkeys.length; i++) {
            if (_isDangerousKey(pkeys[i])) continue;
            profiles[pkeys[i]] = Object.assign({}, profiles[pkeys[i]] || {}, newProfiles[pkeys[i]]);
        }
    }

    /**
     * Ingest a single reading. Each property in the reading object
     * is treated as a named parameter with a numeric value.
     */
    function ingest(reading, ts) {
        if (!reading || typeof reading !== 'object') return;
        ts = ts || Date.now();
        timestamps.push(ts);
        readingCount++;

        var rkeys = Object.keys(reading);
        for (var i = 0; i < rkeys.length; i++) {
            var name = rkeys[i];
            if (_isDangerousKey(name)) continue;
            var val = reading[name];
            if (typeof val !== 'number' || isNaN(val)) continue;
            if (!series[name]) series[name] = [];
            // Pad with NaN if this parameter was added late
            while (series[name].length < timestamps.length - 1) {
                series[name].push(NaN);
            }
            series[name].push(val);
        }

        // Trim to window size
        if (timestamps.length > windowSize * 2) {
            var trim = timestamps.length - windowSize * 2;
            timestamps = timestamps.slice(trim);
            var skeys = Object.keys(series);
            for (var s = 0; s < skeys.length; s++) {
                series[skeys[s]] = series[skeys[s]].slice(trim);
            }
        }
    }

    /**
     * Ingest an array of readings at once.
     */
    function ingestBatch(readings) {
        if (!Array.isArray(readings)) return;
        for (var i = 0; i < readings.length; i++) {
            var r = readings[i];
            ingest(r.values || r, r.timestamp || undefined);
        }
    }

    /**
     * Analyze all tracked parameters for drift.
     */
    function analyze() {
        var paramResults = {};
        var allDrifts = [];
        var correlations = [];
        var skeys = Object.keys(series);

        for (var i = 0; i < skeys.length; i++) {
            var name = skeys[i];
            var raw = series[name];
            // Filter out NaN
            var values = [];
            for (var v = 0; v < raw.length; v++) {
                if (!isNaN(raw[v])) values.push(raw[v]);
            }
            if (values.length < 3) {
                paramResults[name] = { status: 'INSUFFICIENT_DATA', readings: values.length };
                continue;
            }

            var profile = profiles[name] || {};
            var baseN = Math.min(baselineSize, Math.floor(values.length / 2));
            var baseline = values.slice(0, baseN);
            var recent = values.slice(-baseN);
            var baselineMean = mean(baseline);
            var baselineStd = stddev(baseline);
            if (baselineStd === 0) baselineStd = 0.001; // avoid division by zero

            var recentMean = mean(recent);
            var recentStd = stddev(recent);

            // 1. CUSUM analysis
            var allowance = baselineStd * 0.5;
            var cusum = computeCusum(values, baselineMean, allowance);
            var cusumThreshold = (profile.cusumThreshold || 3.0) * baselineStd;
            var cusumDrift = Math.max(cusum.high, cusum.low) > cusumThreshold;

            // 2. Variance change detection
            var varianceMultiplier = profile.varianceMultiplier || 2.5;
            var varianceDrift = recentStd > baselineStd * varianceMultiplier;

            // 3. Trend slope
            var reg = linearRegression(values);
            var normalizedSlope = reg.slope / baselineStd;
            var trendSignificant = Math.abs(normalizedSlope) > 0.15 && reg.r2 > 0.3;

            // 4. Mean shift (z-score of recent mean vs baseline)
            var zShift = (recentMean - baselineMean) / baselineStd;
            var meanShifted = Math.abs(zShift) > 1.5;

            // Classify severity
            var driftSignals = 0;
            if (cusumDrift) driftSignals++;
            if (varianceDrift) driftSignals++;
            if (trendSignificant) driftSignals++;
            if (meanShifted) driftSignals++;

            var status;
            if (driftSignals === 0) status = 'STABLE';
            else if (driftSignals === 1) status = 'DRIFTING';
            else if (driftSignals <= 3) status = 'DIVERGING';
            else status = 'CRITICAL';

            // Determine drift direction
            var direction = 'stable';
            if (reg.slope > 0 && (trendSignificant || zShift > 0.5)) direction = 'upward';
            else if (reg.slope < 0 && (trendSignificant || zShift < -0.5)) direction = 'downward';
            else if (varianceDrift) direction = 'variance';

            // Root cause inference
            var causeMap = ROOT_CAUSES[name] || ROOT_CAUSES._default;
            var dirKey = direction === 'upward' ? 'upward' : (direction === 'downward' ? 'downward' : 'variance');
            var probableCauses = (causeMap[dirKey] || causeMap.variance || []).slice(0, 3);

            // Forecast: when will it exit safe range at current trend?
            // Use recent-window regression slope (not full-buffer) so the forecast
            // reflects the *current* rate of drift rather than being diluted by
            // the stable baseline period (fixes #155).
            var forecast = null;
            if (trendSignificant && profile.safeMin !== undefined && profile.safeMax !== undefined) {
                var recentN = Math.min(baselineSize, values.length);
                var recentValues = values.slice(-recentN);
                var recentReg = linearRegression(recentValues);
                var forecastSlope = recentReg.slope;
                if (forecastSlope !== 0) {
                    var currentVal = values[values.length - 1];
                    var stepsToLimit;
                    if (forecastSlope > 0) {
                        stepsToLimit = (profile.safeMax - currentVal) / forecastSlope;
                    } else {
                        stepsToLimit = (profile.safeMin - currentVal) / forecastSlope;
                    }
                    if (stepsToLimit > 0 && stepsToLimit < windowSize * 5) {
                        forecast = {
                            readingsUntilLimit: Math.round(stepsToLimit),
                            limitValue: forecastSlope > 0 ? profile.safeMax : profile.safeMin,
                            direction: direction
                        };
                    }
                }
            }

            // Corrective action
            var actionInfo = CORRECTIVE_ACTIONS[name] || CORRECTIVE_ACTIONS._default;
            var urgency = Math.min(10, Math.round(actionInfo.urgencyBase * (driftSignals / 2)));
            if (status === 'CRITICAL') urgency = 10;

            var result = {
                status: status,
                direction: direction,
                readings: values.length,
                baseline: { mean: round4(baselineMean), stddev: round4(baselineStd) },
                recent: { mean: round4(recentMean), stddev: round4(recentStd) },
                detectors: {
                    cusum: { triggered: cusumDrift, high: round4(cusum.high), low: round4(cusum.low), threshold: round4(cusumThreshold) },
                    variance: { triggered: varianceDrift, ratio: round4(recentStd / baselineStd) },
                    trend: { triggered: trendSignificant, slope: round4(reg.slope), r2: round4(reg.r2), normalizedSlope: round4(normalizedSlope) },
                    meanShift: { triggered: meanShifted, zScore: round4(zShift) }
                },
                probableCauses: probableCauses,
                forecast: forecast,
                recommendation: status !== 'STABLE' ? { action: actionInfo.action, urgency: urgency } : null
            };

            paramResults[name] = result;
            if (status !== 'STABLE') {
                allDrifts.push({ parameter: name, status: status, direction: direction, urgency: urgency });
            }
        }

        // Multi-parameter correlation: find params drifting in the same direction
        if (allDrifts.length >= 2) {
            for (var a = 0; a < allDrifts.length; a++) {
                for (var b = a + 1; b < allDrifts.length; b++) {
                    if (allDrifts[a].direction === allDrifts[b].direction && allDrifts[a].direction !== 'stable') {
                        correlations.push({
                            parameters: [allDrifts[a].parameter, allDrifts[b].parameter],
                            direction: allDrifts[a].direction,
                            insight: 'Both ' + allDrifts[a].parameter + ' and ' + allDrifts[b].parameter +
                                     ' are drifting ' + allDrifts[a].direction + ' — possible systemic cause'
                        });
                    }
                }
            }
        }

        // Sort recommendations by urgency
        var recommendations = allDrifts
            .sort(function(x, y) { return y.urgency - x.urgency; })
            .map(function(d) {
                var ai = CORRECTIVE_ACTIONS[d.parameter] || CORRECTIVE_ACTIONS._default;
                return {
                    parameter: d.parameter,
                    action: ai.action,
                    urgency: d.urgency,
                    status: d.status
                };
            });

        // Overall status
        var worstPriority = 0;
        for (var w = 0; w < allDrifts.length; w++) {
            var p = SEVERITY_LEVELS.find(function(sl) { return sl.level === allDrifts[w].status; });
            if (p && p.priority > worstPriority) worstPriority = p.priority;
        }
        var overallLevel = SEVERITY_LEVELS[worstPriority] || SEVERITY_LEVELS[0];

        return {
            overall: overallLevel.level,
            overallLabel: overallLevel.label,
            overallColor: overallLevel.color,
            totalReadings: readingCount,
            parametersTracked: skeys.length,
            driftCount: allDrifts.length,
            parameters: paramResults,
            correlations: correlations,
            recommendations: recommendations,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Get a quick status summary without full analysis detail.
     */
    function status() {
        var report = analyze();
        return {
            overall: report.overall,
            driftCount: report.driftCount,
            parametersTracked: report.parametersTracked,
            totalReadings: report.totalReadings,
            drifting: report.recommendations.map(function(r) { return r.parameter + ' (' + r.status + ')'; })
        };
    }

    /**
     * Reset all tracked data.
     */
    function reset() {
        series = {};
        timestamps = [];
        readingCount = 0;
    }

    /**
     * Export the current time-series data for external analysis.
     */
    function exportData() {
        var result = {};
        var skeys = Object.keys(series);
        for (var i = 0; i < skeys.length; i++) {
            result[skeys[i]] = series[skeys[i]].slice();
        }
        return { parameters: result, timestamps: timestamps.slice(), readingCount: readingCount };
    }

    return {
        configure: configure,
        ingest: ingest,
        ingestBatch: ingestBatch,
        analyze: analyze,
        status: status,
        reset: reset,
        exportData: exportData
    };
}

function round4(n) {
    return Math.round(n * 10000) / 10000;
}

// ── Exports ────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createDriftDetector: createDriftDetector };
}
