'use strict';

/**
 * Contamination Early Warning System
 *
 * Proactive monitoring module that analyzes environmental sensor reading
 * trends over time to detect deteriorating conditions BEFORE contamination
 * occurs. Uses exponential moving averages (EMA), rate-of-change analysis,
 * and multi-signal correlation to issue tiered warnings.
 *
 * Key capabilities:
 * - Continuous ingestion of environmental readings (temperature, humidity,
 *   particle count, air changes, personnel count, etc.)
 * - EMA-based trend detection with configurable sensitivity
 * - Rate-of-change alerts when conditions deteriorate rapidly
 * - Multi-signal correlation (e.g. rising particles + falling air changes)
 * - Tiered warning levels: WATCH → ADVISORY → WARNING → ALERT
 * - Proactive mitigation recommendations with urgency scoring
 * - Historical trend summary and forecast
 *
 * @example
 *   var ew = createContaminationEarlyWarning();
 *   ew.ingest({ temperature: 23, humidity: 45, particleCount: 2000 });
 *   // ... more readings over time ...
 *   ew.ingest({ temperature: 26, humidity: 68, particleCount: 4500 });
 *   var status = ew.assess();
 *   // status.level => 'WARNING', status.signals => [...]
 */

// ── Monitored parameters & thresholds ──────────────────────────────

var PARAMS = {
    temperature:      { unit: '°C',           safe: { min: 20, max: 25 }, warn: { min: 18, max: 28 }, critical: { min: 15, max: 32 } },
    humidity:         { unit: '%RH',          safe: { min: 30, max: 60 }, warn: { min: 20, max: 70 }, critical: { min: 10, max: 85 } },
    particleCount:    { unit: 'particles/m³', safe: { min: 0, max: 3520 }, warn: { min: 0, max: 10000 }, critical: { min: 0, max: 35200 } },
    airChangesPerHour:{ unit: 'ACH',          safe: { min: 20, max: 600 }, warn: { min: 12, max: 600 }, critical: { min: 6, max: 600 } },
    personnelCount:   { unit: 'people',       safe: { min: 0, max: 2 }, warn: { min: 0, max: 4 }, critical: { min: 0, max: 8 } },
    gowningCompliance:{ unit: '%',            safe: { min: 90, max: 100 }, warn: { min: 70, max: 100 }, critical: { min: 50, max: 100 } },
    mediaAge:         { unit: 'days',         safe: { min: 0, max: 14 }, warn: { min: 0, max: 21 }, critical: { min: 0, max: 30 } }
};

var WARNING_LEVELS = [
    { level: 'CLEAR',    priority: 0, color: '#22c55e', label: 'All Clear'  },
    { level: 'WATCH',    priority: 1, color: '#eab308', label: 'Watch'      },
    { level: 'ADVISORY', priority: 2, color: '#f97316', label: 'Advisory'   },
    { level: 'WARNING',  priority: 3, color: '#ef4444', label: 'Warning'    },
    { level: 'ALERT',    priority: 4, color: '#dc2626', label: 'Alert'      }
];

var MITIGATIONS = {
    temperature:       { action: 'Check HVAC setpoints and room seals', urgencyMultiplier: 1.0 },
    humidity:          { action: 'Inspect humidifier/dehumidifier and condensation traps', urgencyMultiplier: 1.0 },
    particleCount:     { action: 'Verify HEPA filter integrity; check for unsealed ports', urgencyMultiplier: 1.5 },
    airChangesPerHour: { action: 'Inspect blower performance and duct obstructions', urgencyMultiplier: 1.2 },
    personnelCount:    { action: 'Reduce non-essential personnel; enforce access schedule', urgencyMultiplier: 0.8 },
    gowningCompliance: { action: 'Conduct gowning refresher; check garment stock', urgencyMultiplier: 1.3 },
    mediaAge:          { action: 'Prepare fresh media batch; dispose of expired stock', urgencyMultiplier: 0.9 }
};

// ── Helpers ────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function classifyValue(value, param) {
    var p = PARAMS[param];
    if (!p) return 'UNKNOWN';
    if (value >= p.safe.min && value <= p.safe.max) return 'SAFE';
    if (value >= p.warn.min && value <= p.warn.max) return 'WARN';
    return 'CRITICAL';
};

function ema(prev, curr, alpha) {
    return prev === null ? curr : alpha * curr + (1 - alpha) * prev;
}

function rateOfChange(series, windowSize) {
    if (series.length < 2) return 0;
    var start = Math.max(0, series.length - windowSize);
    var first = series[start];
    var last = series[series.length - 1];
    var steps = series.length - 1 - start;
    return steps > 0 ? (last - first) / steps : 0;
}

function linearForecast(series, stepsAhead) {
    var n = series.length;
    if (n < 2) return series.length ? series[0] : 0;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
        sumX += i; sumY += series[i];
        sumXY += i * series[i]; sumX2 += i * i;
    }
    var denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return series[n - 1];
    var slope = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;
    return intercept + slope * (n - 1 + stepsAhead);
}

// ── Factory ────────────────────────────────────────────────────────

function createContaminationEarlyWarning(options) {
    var opts = options || {};
    var emaAlpha = opts.emaAlpha || 0.3;
    var rocWindow = opts.rocWindow || 5;
    var forecastSteps = opts.forecastSteps || 3;
    var maxHistory = opts.maxHistory || 200;

    // Per-parameter state
    var state = {};
    var keys = Object.keys(PARAMS);
    for (var k = 0; k < keys.length; k++) {
        state[keys[k]] = { raw: [], ema: null, lastClassification: 'SAFE' };
    }

    var readingCount = 0;
    var warnings = [];
    var correlationLog = [];

    // ── ingest ─────────────────────────────────────────────────────

    function ingest(reading) {
        if (!reading || typeof reading !== 'object') {
            throw new Error('ingest() requires a reading object');
        }
        readingCount++;
        var ts = reading.timestamp || Date.now();
        var signals = [];

        for (var p in reading) {
            if (!PARAMS[p]) continue;
            var val = Number(reading[p]);
            if (isNaN(val)) continue;

            var s = state[p];
            s.raw.push(val);
            if (s.raw.length > maxHistory) s.raw.shift();
            s.ema = ema(s.ema, val, emaAlpha);
            s.lastClassification = classifyValue(val, p);

            var roc = rateOfChange(s.raw, rocWindow);
            var forecast = linearForecast(s.raw, forecastSteps);
            var forecastClass = classifyValue(forecast, p);

            // Detect deterioration: currently safe but trending toward warn/critical
            if (s.lastClassification === 'SAFE' && forecastClass !== 'SAFE') {
                signals.push({
                    param: p,
                    type: 'TREND_DETERIORATION',
                    current: val,
                    ema: Math.round(s.ema * 100) / 100,
                    roc: Math.round(roc * 1000) / 1000,
                    forecast: Math.round(forecast * 100) / 100,
                    forecastClass: forecastClass,
                    message: p + ' trending toward ' + forecastClass + ' (forecast: ' + (Math.round(forecast * 100) / 100) + ' ' + PARAMS[p].unit + ')'
                });
            }

            // Already in warn/critical
            if (s.lastClassification === 'WARN' || s.lastClassification === 'CRITICAL') {
                signals.push({
                    param: p,
                    type: s.lastClassification === 'CRITICAL' ? 'CRITICAL_VALUE' : 'WARN_VALUE',
                    current: val,
                    ema: Math.round(s.ema * 100) / 100,
                    roc: Math.round(roc * 1000) / 1000,
                    forecast: Math.round(forecast * 100) / 100,
                    forecastClass: forecastClass,
                    message: p + ' is ' + s.lastClassification + ' (' + val + ' ' + PARAMS[p].unit + ')'
                });
            }

            // Rapid rate-of-change alert (deteriorating fast)
            var absRoc = Math.abs(roc);
            var range = PARAMS[p].safe.max - PARAMS[p].safe.min;
            if (range > 0 && absRoc / range > 0.15) {
                signals.push({
                    param: p,
                    type: 'RAPID_CHANGE',
                    current: val,
                    roc: Math.round(roc * 1000) / 1000,
                    message: p + ' changing rapidly (rate: ' + (Math.round(roc * 1000) / 1000) + ' per reading)'
                });
            }
        }

        // Multi-signal correlation: particles rising + air changes falling
        if (state.particleCount.raw.length >= rocWindow && state.airChangesPerHour.raw.length >= rocWindow) {
            var particleRoc = rateOfChange(state.particleCount.raw, rocWindow);
            var achRoc = rateOfChange(state.airChangesPerHour.raw, rocWindow);
            if (particleRoc > 0 && achRoc < 0) {
                correlationLog.push({ ts: ts, type: 'PARTICLE_ACH_DIVERGENCE', particleRoc: particleRoc, achRoc: achRoc });
                signals.push({
                    param: 'particleCount+airChangesPerHour',
                    type: 'CORRELATED_DETERIORATION',
                    message: 'Particles rising while air changes falling — possible HEPA or blower issue'
                });
            }
        }

        // Humidity + temperature combined
        if (state.humidity.raw.length >= 2 && state.temperature.raw.length >= 2) {
            var lastHum = state.humidity.raw[state.humidity.raw.length - 1];
            var lastTemp = state.temperature.raw[state.temperature.raw.length - 1];
            if (lastHum > 65 && lastTemp > 26) {
                signals.push({
                    param: 'humidity+temperature',
                    type: 'CORRELATED_DETERIORATION',
                    message: 'High humidity (' + lastHum + '%) combined with high temperature (' + lastTemp + '°C) — elevated microbial growth risk'
                });
            }
        }

        if (signals.length > 0) {
            warnings.push({ ts: ts, readingIndex: readingCount, signals: signals });
        }

        return { readingIndex: readingCount, signalCount: signals.length, signals: signals };
    }

    // ── assess ─────────────────────────────────────────────────────

    function assess() {
        var criticalCount = 0;
        var warnCount = 0;
        var trendCount = 0;
        var correlatedCount = 0;
        var activeSignals = [];
        var mitigations = [];

        for (var p in state) {
            var s = state[p];
            if (s.lastClassification === 'CRITICAL') { criticalCount++; }
            if (s.lastClassification === 'WARN') { warnCount++; }

            if (s.raw.length >= 2) {
                var fc = linearForecast(s.raw, forecastSteps);
                var fcClass = classifyValue(fc, p);
                if (s.lastClassification === 'SAFE' && fcClass !== 'SAFE') {
                    trendCount++;
                    activeSignals.push({ param: p, type: 'TREND', forecast: Math.round(fc * 100) / 100, forecastClass: fcClass });
                }
            }

            if (s.lastClassification !== 'SAFE' && MITIGATIONS[p]) {
                var urgency = (s.lastClassification === 'CRITICAL' ? 10 : 5) * (MITIGATIONS[p].urgencyMultiplier || 1);
                mitigations.push({ param: p, action: MITIGATIONS[p].action, urgency: Math.round(urgency * 10) / 10, classification: s.lastClassification });
            }
        }

        // Check recent correlations
        var recentCorrelations = correlationLog.slice(-5);
        correlatedCount = recentCorrelations.length;

        // Determine overall level
        var priority = 0;
        if (criticalCount >= 2 || (criticalCount >= 1 && correlatedCount >= 1)) priority = 4; // ALERT
        else if (criticalCount >= 1 || warnCount >= 3) priority = 3; // WARNING
        else if (warnCount >= 1 || correlatedCount >= 1) priority = 2; // ADVISORY
        else if (trendCount >= 1) priority = 1; // WATCH
        // else CLEAR

        var levelInfo = WARNING_LEVELS[priority];

        // Sort mitigations by urgency desc
        mitigations.sort(function(a, b) { return b.urgency - a.urgency; });

        return {
            level: levelInfo.level,
            priority: levelInfo.priority,
            color: levelInfo.color,
            label: levelInfo.label,
            summary: {
                criticalParams: criticalCount,
                warnParams: warnCount,
                deterioratingTrends: trendCount,
                correlatedSignals: correlatedCount,
                totalReadings: readingCount
            },
            mitigations: mitigations,
            activeSignals: activeSignals,
            recentCorrelations: recentCorrelations
        };
    }

    // ── trendReport ────────────────────────────────────────────────

    function trendReport() {
        var report = {};
        for (var p in state) {
            var s = state[p];
            if (s.raw.length === 0) continue;
            var last = s.raw[s.raw.length - 1];
            var fc = linearForecast(s.raw, forecastSteps);
            report[p] = {
                current: last,
                ema: s.ema !== null ? Math.round(s.ema * 100) / 100 : null,
                classification: s.lastClassification,
                rateOfChange: Math.round(rateOfChange(s.raw, rocWindow) * 1000) / 1000,
                forecast: Math.round(fc * 100) / 100,
                forecastClassification: classifyValue(fc, p),
                readings: s.raw.length,
                min: Math.min.apply(null, s.raw),
                max: Math.max.apply(null, s.raw),
                unit: PARAMS[p].unit
            };
        }
        return report;
    }

    // ── getWarnings ────────────────────────────────────────────────

    function getWarnings(opts2) {
        var o = opts2 || {};
        var since = o.since || 0;
        var minPriority = o.minType || null;
        var result = [];
        for (var i = 0; i < warnings.length; i++) {
            var w = warnings[i];
            if (w.ts < since) continue;
            if (minPriority) {
                var hasPriority = false;
                for (var j = 0; j < w.signals.length; j++) {
                    if (w.signals[j].type === minPriority || w.signals[j].type === 'CRITICAL_VALUE' || w.signals[j].type === 'CORRELATED_DETERIORATION') {
                        hasPriority = true; break;
                    }
                }
                if (!hasPriority) continue;
            }
            result.push(w);
        }
        return result;
    }

    // ── reset ──────────────────────────────────────────────────────

    function reset() {
        for (var p in state) {
            state[p] = { raw: [], ema: null, lastClassification: 'SAFE' };
        }
        readingCount = 0;
        warnings = [];
        correlationLog = [];
    }

    // ── Public API ─────────────────────────────────────────────────

    return {
        ingest: ingest,
        assess: assess,
        trendReport: trendReport,
        getWarnings: getWarnings,
        reset: reset,
        PARAMS: PARAMS,
        WARNING_LEVELS: WARNING_LEVELS
    };
}

module.exports = { createContaminationEarlyWarning: createContaminationEarlyWarning };
