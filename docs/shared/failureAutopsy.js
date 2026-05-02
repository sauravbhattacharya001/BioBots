'use strict';

/**
 * Bioprint Failure Autopsy Engine
 *
 * Autonomous post-failure forensic analysis for bioprinting operations.
 * When a print fails, this engine analyzes parameters, material conditions,
 * environmental readings, and equipment state to determine root causes
 * and recommend corrective actions.
 *
 * 7 forensic analysis engines:
 * 1. Parameter Deviation Analyzer — flags print parameter deviations from safe ranges
 * 2. Material Condition Assessor — evaluates bioink freshness and degradation
 * 3. Environmental Forensics — detects environmental anomalies via z-score
 * 4. Equipment State Reconstructor — identifies mechanical failure signatures
 * 5. Timeline Reconstructor — builds chronological cause-effect chains
 * 6. Root Cause Ranker — weighted evidence aggregation with confidence scoring
 * 7. Corrective Action Generator — specific fixes with effort/impact estimates
 *
 * Agentic capabilities:
 * - Autonomous diagnosis: runs all 7 engines without manual prompting
 * - Pattern learning: detects recurring failure modes across history
 * - Outcome tracking: refines confidence based on recorded fix outcomes
 * - Fleet awareness: dashboard with failure rate trends and health scoring
 *
 * @example
 *   var autopsy = createFailureAutopsy();
 *   autopsy.recordFailure({
 *     id: 'fail-001', timestamp: '2025-06-15T14:30:00Z',
 *     printJobId: 'job-42', material: 'gelma_5pct',
 *     parameters: { temperature: 37.5, pressure: 2.8, speed: 12, layerHeight: 0.2, nozzleDiameter: 0.41 },
 *     materialCondition: { prepTime: '2025-06-15T08:00:00Z', freezeThawCycles: 2, storageTemp: 4, viscosity: 850, cellViability: 0.88 },
 *     environmental: [{ time: '2025-06-15T14:00:00Z', temp: 22.1, humidity: 45, vibration: 0.02 }],
 *     equipment: { printerId: 'bp-001', nozzleHours: 120, lastCalibration: '2025-06-10', events: [] },
 *     failureMode: 'structural_collapse'
 *   });
 *   var result = autopsy.analyze('fail-001');
 *   // result.rootCauses => [{ cause: '...', confidence: 82.5, evidence: [...] }]
 */

var round = require('./validation').round;
var _isDangerousKey = require('./sanitize').isDangerousKey;

// ── Constants ──────────────────────────────────────────────────────

var PARAMETER_SAFE_RANGES = {
    temperature:     { min: 4,   max: 42,  unit: '°C',   label: 'Nozzle Temperature' },
    pressure:        { min: 0.5, max: 5.0, unit: 'bar',  label: 'Extrusion Pressure' },
    speed:           { min: 1,   max: 30,  unit: 'mm/s', label: 'Print Speed' },
    layerHeight:     { min: 0.05,max: 0.5, unit: 'mm',   label: 'Layer Height' },
    nozzleDiameter:  { min: 0.1, max: 1.0, unit: 'mm',   label: 'Nozzle Diameter' }
};

var MATERIAL_THRESHOLDS = {
    maxHoursSincePrep: 8,
    maxFreezeThawCycles: 3,
    minCellViability: 0.7,
    minViscosity: 200,
    maxViscosity: 2000,
    maxStorageTemp: 8
};

var ANOMALY_Z_THRESHOLD = 2.0;
var ANOMALY_WINDOW = 10;

var FAILURE_SIGNATURES = [
    {
        id: 'nozzle_clog', label: 'Nozzle Clog',
        description: 'Pressure spike followed by flow reduction',
        indicators: ['pressure_spike', 'flow_drop'],
        severity: 85, category: 'equipment'
    },
    {
        id: 'material_degradation', label: 'Material Degradation',
        description: 'Bioink quality compromised by age or storage conditions',
        indicators: ['high_freeze_thaw', 'low_viability', 'viscosity_drift'],
        severity: 75, category: 'material'
    },
    {
        id: 'temperature_shock', label: 'Temperature Shock',
        description: 'Rapid environmental temperature change disrupted print',
        indicators: ['env_temp_spike', 'env_temp_drop'],
        severity: 70, category: 'environmental'
    },
    {
        id: 'structural_collapse', label: 'Structural Collapse',
        description: 'Layer adhesion failure causing structural integrity loss',
        indicators: ['layer_adhesion_fail', 'speed_too_high', 'low_crosslink'],
        severity: 90, category: 'parameter'
    },
    {
        id: 'uv_crosslink_failure', label: 'UV Crosslink Failure',
        description: 'Insufficient UV intensity for material crosslinking',
        indicators: ['low_uv_intensity', 'uv_source_degraded'],
        severity: 80, category: 'equipment'
    },
    {
        id: 'vibration_disruption', label: 'Vibration Disruption',
        description: 'External vibration disrupted layer deposition',
        indicators: ['vibration_spike'],
        severity: 65, category: 'environmental'
    },
    {
        id: 'over_extrusion', label: 'Over-Extrusion',
        description: 'Excessive material flow from high pressure for nozzle size',
        indicators: ['pressure_high', 'nozzle_small'],
        severity: 60, category: 'parameter'
    },
    {
        id: 'under_extrusion', label: 'Under-Extrusion',
        description: 'Insufficient material flow causing gaps in layers',
        indicators: ['pressure_low', 'flow_gap'],
        severity: 70, category: 'parameter'
    },
    {
        id: 'bioink_gelation', label: 'Bioink Premature Gelation',
        description: 'Material gelled in cartridge before extrusion',
        indicators: ['viscosity_high', 'long_idle_time'],
        severity: 75, category: 'material'
    },
    {
        id: 'contamination', label: 'Contamination Event',
        description: 'Environmental contamination compromised sterility',
        indicators: ['env_anomaly', 'sterility_breach'],
        severity: 95, category: 'environmental'
    }
];

var CORRECTIVE_ACTIONS = {
    nozzle_clog: [
        { action: 'Clean or replace nozzle', effort: 'low', impact: 85 },
        { action: 'Reduce print pressure by 10-15%', effort: 'low', impact: 60 },
        { action: 'Pre-filter bioink before loading', effort: 'medium', impact: 70 }
    ],
    material_degradation: [
        { action: 'Prepare fresh bioink batch', effort: 'medium', impact: 90 },
        { action: 'Reduce freeze-thaw cycles — aliquot into single-use volumes', effort: 'medium', impact: 75 },
        { action: 'Verify cold-chain integrity during storage', effort: 'low', impact: 65 }
    ],
    temperature_shock: [
        { action: 'Stabilize room HVAC before printing', effort: 'low', impact: 80 },
        { action: 'Install thermal enclosure for print stage', effort: 'high', impact: 90 },
        { action: 'Add 15-min thermal equilibration step', effort: 'low', impact: 70 }
    ],
    structural_collapse: [
        { action: 'Reduce print speed by 20%', effort: 'low', impact: 75 },
        { action: 'Increase UV crosslink exposure per layer', effort: 'low', impact: 85 },
        { action: 'Optimize layer height for material viscosity', effort: 'medium', impact: 80 }
    ],
    uv_crosslink_failure: [
        { action: 'Replace UV source — hours exceeded', effort: 'medium', impact: 90 },
        { action: 'Calibrate UV intensity meter', effort: 'low', impact: 70 },
        { action: 'Increase exposure time per layer by 50%', effort: 'low', impact: 75 }
    ],
    vibration_disruption: [
        { action: 'Relocate printer to vibration-dampened surface', effort: 'high', impact: 90 },
        { action: 'Schedule prints during low-activity hours', effort: 'low', impact: 65 },
        { action: 'Add anti-vibration pads under printer', effort: 'low', impact: 70 }
    ],
    over_extrusion: [
        { action: 'Reduce extrusion pressure to match nozzle diameter', effort: 'low', impact: 85 },
        { action: 'Switch to larger nozzle for this material', effort: 'low', impact: 70 },
        { action: 'Recalibrate flow rate sensor', effort: 'medium', impact: 60 }
    ],
    under_extrusion: [
        { action: 'Increase extrusion pressure by 10-20%', effort: 'low', impact: 80 },
        { action: 'Check for partial nozzle blockage', effort: 'low', impact: 75 },
        { action: 'Warm bioink to reduce viscosity before loading', effort: 'low', impact: 65 }
    ],
    bioink_gelation: [
        { action: 'Reduce idle time — load bioink immediately before print', effort: 'low', impact: 85 },
        { action: 'Lower cartridge temperature to slow gelation', effort: 'low', impact: 75 },
        { action: 'Add gelation inhibitor to formulation', effort: 'high', impact: 80 }
    ],
    contamination: [
        { action: 'Full sterility audit of biosafety cabinet', effort: 'medium', impact: 90 },
        { action: 'Replace HEPA filter in laminar flow hood', effort: 'medium', impact: 85 },
        { action: 'Re-sterilize all contact surfaces and tubing', effort: 'low', impact: 80 }
    ]
};

var EVIDENCE_WEIGHTS = {
    parameter: 0.25,
    material: 0.25,
    environmental: 0.20,
    equipment: 0.20,
    timeline: 0.10
};

var HEALTH_THRESHOLDS = [
    { max: 20, label: 'Critical', color: '#ef4444' },
    { max: 40, label: 'Poor',     color: '#f97316' },
    { max: 60, label: 'Fair',     color: '#eab308' },
    { max: 80, label: 'Good',     color: '#84cc16' },
    { max: 100,label: 'Excellent',color: '#22c55e' }
];

// ── Helpers ────────────────────────────────────────────────────────

function _safeKeys(obj) {
    var keys = Object.keys(obj);
    var safe = [];
    for (var i = 0; i < keys.length; i++) {
        if (!_isDangerousKey(keys[i])) { safe.push(keys[i]); }
    }
    return safe;
}

function _sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') { return obj; }
    if (Array.isArray(obj)) {
        var arr = [];
        for (var a = 0; a < obj.length; a++) { arr.push(_sanitizeObject(obj[a])); }
        return arr;
    }
    var out = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
        if (!_isDangerousKey(keys[i])) {
            out[keys[i]] = _sanitizeObject(obj[keys[i]]);
        }
    }
    return out;
}

function _mean(arr) {
    if (!arr || arr.length === 0) { return 0; }
    var sum = 0;
    for (var i = 0; i < arr.length; i++) { sum += arr[i]; }
    return sum / arr.length;
}

function _stdDev(arr, avg) {
    if (!arr || arr.length < 2) { return 0; }
    var sum = 0;
    for (var i = 0; i < arr.length; i++) {
        var d = arr[i] - avg;
        sum += d * d;
    }
    return Math.sqrt(sum / (arr.length - 1));
}

function _parseTime(t) {
    if (typeof t === 'number') { return t; }
    var d = new Date(t);
    return isNaN(d.getTime()) ? 0 : d.getTime();
}

function _hoursBetween(a, b) {
    return Math.abs(_parseTime(b) - _parseTime(a)) / 3600000;
}

function _clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function _generateId() {
    return 'fail-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

// ── Factory ────────────────────────────────────────────────────────

function createFailureAutopsy() {
    var _failures = {};
    var _analyses = {};
    var _outcomes = {};

    // ── Engine 1: Parameter Deviation Analyzer ─────────────────

    function _analyzeParameters(failure) {
        var deviations = [];
        var params = failure.parameters || {};
        var keys = _safeKeys(params);
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            var range = PARAMETER_SAFE_RANGES[k];
            if (!range) { continue; }
            var val = params[k];
            if (typeof val !== 'number' || !isFinite(val)) { continue; }
            var deviation = 0;
            var direction = 'within_range';
            if (val < range.min) {
                deviation = round(((range.min - val) / (range.max - range.min)) * 100, 2);
                direction = 'below';
            } else if (val > range.max) {
                deviation = round(((val - range.max) / (range.max - range.min)) * 100, 2);
                direction = 'above';
            }
            if (deviation > 0) {
                deviations.push({
                    parameter: k,
                    label: range.label,
                    value: val,
                    safeMin: range.min,
                    safeMax: range.max,
                    unit: range.unit,
                    deviation: deviation,
                    direction: direction,
                    severity: round(_clamp(deviation * 1.5, 0, 100), 2)
                });
            }
        }
        deviations.sort(function(a, b) { return b.severity - a.severity; });
        var score = deviations.length === 0 ? 0 :
            round(_mean(deviations.map(function(d) { return d.severity; })), 2);
        return { engine: 'parameter_deviation', deviations: deviations, score: score };
    }

    // ── Engine 2: Material Condition Assessor ──────────────────

    function _assessMaterial(failure) {
        var findings = [];
        var mc = failure.materialCondition || {};
        var indicators = [];

        // Freshness check
        if (mc.prepTime && failure.timestamp) {
            var hours = _hoursBetween(mc.prepTime, failure.timestamp);
            if (hours > MATERIAL_THRESHOLDS.maxHoursSincePrep) {
                findings.push({
                    finding: 'material_age',
                    label: 'Material too old',
                    detail: round(hours, 1) + 'h since prep (max ' + MATERIAL_THRESHOLDS.maxHoursSincePrep + 'h)',
                    severity: round(_clamp((hours - MATERIAL_THRESHOLDS.maxHoursSincePrep) / MATERIAL_THRESHOLDS.maxHoursSincePrep * 100, 0, 100), 2)
                });
                indicators.push('long_idle_time');
            }
        }

        // Freeze-thaw cycles
        if (typeof mc.freezeThawCycles === 'number' && mc.freezeThawCycles > MATERIAL_THRESHOLDS.maxFreezeThawCycles) {
            findings.push({
                finding: 'freeze_thaw_excess',
                label: 'Excessive freeze-thaw cycles',
                detail: mc.freezeThawCycles + ' cycles (max ' + MATERIAL_THRESHOLDS.maxFreezeThawCycles + ')',
                severity: round(_clamp((mc.freezeThawCycles - MATERIAL_THRESHOLDS.maxFreezeThawCycles) / MATERIAL_THRESHOLDS.maxFreezeThawCycles * 100, 0, 100), 2)
            });
            indicators.push('high_freeze_thaw');
        }

        // Cell viability
        if (typeof mc.cellViability === 'number' && mc.cellViability < MATERIAL_THRESHOLDS.minCellViability) {
            findings.push({
                finding: 'low_viability',
                label: 'Low cell viability',
                detail: round(mc.cellViability * 100, 1) + '% (min ' + round(MATERIAL_THRESHOLDS.minCellViability * 100, 1) + '%)',
                severity: round(_clamp((MATERIAL_THRESHOLDS.minCellViability - mc.cellViability) / MATERIAL_THRESHOLDS.minCellViability * 100, 0, 100), 2)
            });
            indicators.push('low_viability');
        }

        // Viscosity check
        if (typeof mc.viscosity === 'number') {
            if (mc.viscosity < MATERIAL_THRESHOLDS.minViscosity) {
                findings.push({
                    finding: 'viscosity_low',
                    label: 'Viscosity too low',
                    detail: mc.viscosity + ' mPa·s (min ' + MATERIAL_THRESHOLDS.minViscosity + ')',
                    severity: round(_clamp((MATERIAL_THRESHOLDS.minViscosity - mc.viscosity) / MATERIAL_THRESHOLDS.minViscosity * 100, 0, 100), 2)
                });
                indicators.push('viscosity_drift');
            } else if (mc.viscosity > MATERIAL_THRESHOLDS.maxViscosity) {
                findings.push({
                    finding: 'viscosity_high',
                    label: 'Viscosity too high',
                    detail: mc.viscosity + ' mPa·s (max ' + MATERIAL_THRESHOLDS.maxViscosity + ')',
                    severity: round(_clamp((mc.viscosity - MATERIAL_THRESHOLDS.maxViscosity) / MATERIAL_THRESHOLDS.maxViscosity * 100, 0, 100), 2)
                });
                indicators.push('viscosity_high');
            }
        }

        // Storage temperature
        if (typeof mc.storageTemp === 'number' && mc.storageTemp > MATERIAL_THRESHOLDS.maxStorageTemp) {
            findings.push({
                finding: 'storage_temp_high',
                label: 'Storage temperature too high',
                detail: mc.storageTemp + '°C (max ' + MATERIAL_THRESHOLDS.maxStorageTemp + '°C)',
                severity: round(_clamp((mc.storageTemp - MATERIAL_THRESHOLDS.maxStorageTemp) / 10 * 100, 0, 100), 2)
            });
        }

        findings.sort(function(a, b) { return b.severity - a.severity; });
        var score = findings.length === 0 ? 0 :
            round(_mean(findings.map(function(f) { return f.severity; })), 2);
        return { engine: 'material_condition', findings: findings, indicators: indicators, score: score };
    }

    // ── Engine 3: Environmental Forensics ──────────────────────

    function _analyzeEnvironment(failure) {
        var readings = failure.environmental || [];
        var anomalies = [];

        if (readings.length < 2) {
            return { engine: 'environmental_forensics', anomalies: anomalies, score: 0 };
        }

        var metrics = ['temp', 'humidity', 'vibration'];
        for (var m = 0; m < metrics.length; m++) {
            var metric = metrics[m];
            var values = [];
            for (var r = 0; r < readings.length; r++) {
                if (typeof readings[r][metric] === 'number') {
                    values.push({ value: readings[r][metric], time: readings[r].time, index: r });
                }
            }
            if (values.length < 2) { continue; }

            // Sliding window z-score analysis
            for (var i = 0; i < values.length; i++) {
                var windowStart = Math.max(0, i - ANOMALY_WINDOW);
                var window = [];
                for (var w = windowStart; w < i; w++) {
                    window.push(values[w].value);
                }
                if (window.length < 2) { continue; }
                var avg = _mean(window);
                var sd = _stdDev(window, avg);
                if (sd === 0) { continue; }
                var z = (values[i].value - avg) / sd;
                if (Math.abs(z) >= ANOMALY_Z_THRESHOLD) {
                    anomalies.push({
                        metric: metric,
                        time: values[i].time,
                        value: values[i].value,
                        zScore: round(z, 2),
                        direction: z > 0 ? 'spike' : 'drop',
                        severity: round(_clamp(Math.abs(z) / 4 * 100, 0, 100), 2)
                    });
                }
            }
        }

        anomalies.sort(function(a, b) { return b.severity - a.severity; });
        var score = anomalies.length === 0 ? 0 :
            round(_mean(anomalies.map(function(a) { return a.severity; })), 2);
        return { engine: 'environmental_forensics', anomalies: anomalies, score: score };
    }

    // ── Engine 4: Equipment State Reconstructor ────────────────

    function _reconstructEquipment(failure) {
        var eq = failure.equipment || {};
        var findings = [];
        var indicators = [];

        // Nozzle hours check
        if (typeof eq.nozzleHours === 'number' && eq.nozzleHours > 200) {
            findings.push({
                finding: 'nozzle_wear',
                label: 'High nozzle usage hours',
                detail: eq.nozzleHours + 'h (recommended replacement at 200h)',
                severity: round(_clamp((eq.nozzleHours - 200) / 200 * 100, 0, 100), 2)
            });
        }

        // Calibration age
        if (eq.lastCalibration && failure.timestamp) {
            var calAge = _hoursBetween(eq.lastCalibration, failure.timestamp) / 24; // days
            if (calAge > 14) {
                findings.push({
                    finding: 'calibration_overdue',
                    label: 'Calibration overdue',
                    detail: round(calAge, 0) + ' days since last calibration (max 14)',
                    severity: round(_clamp((calAge - 14) / 14 * 100, 0, 100), 2)
                });
            }
        }

        // Equipment events
        var events = eq.events || [];
        for (var i = 0; i < events.length; i++) {
            var evt = events[i];
            if (!evt || typeof evt !== 'object') { continue; }
            var type = evt.type;
            if (type === 'pressure_drop') {
                findings.push({
                    finding: 'pressure_drop_event',
                    label: 'Pressure drop detected',
                    detail: 'Pressure dropped to ' + evt.value + ' at ' + evt.time,
                    severity: 70
                });
                indicators.push('pressure_spike');
                indicators.push('flow_drop');
            } else if (type === 'motor_stall') {
                findings.push({
                    finding: 'motor_stall_event',
                    label: 'Motor stall detected',
                    detail: 'Motor stall at ' + evt.time,
                    severity: 80
                });
            } else if (type === 'uv_degradation') {
                findings.push({
                    finding: 'uv_degradation_event',
                    label: 'UV source degradation',
                    detail: 'UV intensity below threshold at ' + evt.time,
                    severity: 75
                });
                indicators.push('low_uv_intensity');
                indicators.push('uv_source_degraded');
            } else if (type === 'nozzle_clog') {
                findings.push({
                    finding: 'nozzle_clog_event',
                    label: 'Nozzle clog detected',
                    detail: 'Clog event at ' + evt.time,
                    severity: 85
                });
                indicators.push('pressure_spike');
                indicators.push('flow_drop');
            }
        }

        findings.sort(function(a, b) { return b.severity - a.severity; });
        var score = findings.length === 0 ? 0 :
            round(_mean(findings.map(function(f) { return f.severity; })), 2);
        return { engine: 'equipment_state', findings: findings, indicators: indicators, score: score };
    }

    // ── Engine 5: Timeline Reconstructor ───────────────────────

    function _reconstructTimeline(failure) {
        var events = [];

        // Add environmental readings as events
        var envReadings = failure.environmental || [];
        for (var i = 0; i < envReadings.length; i++) {
            var r = envReadings[i];
            events.push({
                time: _parseTime(r.time),
                timeStr: r.time,
                source: 'environmental',
                type: 'reading',
                detail: 'T=' + (r.temp || '?') + '°C H=' + (r.humidity || '?') + '% V=' + (r.vibration || '?')
            });
        }

        // Add equipment events
        var eqEvents = (failure.equipment || {}).events || [];
        for (var j = 0; j < eqEvents.length; j++) {
            var e = eqEvents[j];
            events.push({
                time: _parseTime(e.time),
                timeStr: e.time,
                source: 'equipment',
                type: e.type || 'unknown',
                detail: e.type + (e.value !== undefined ? ' (value: ' + e.value + ')' : '')
            });
        }

        // Add failure event
        if (failure.timestamp) {
            events.push({
                time: _parseTime(failure.timestamp),
                timeStr: failure.timestamp,
                source: 'failure',
                type: 'print_failure',
                detail: (failure.failureMode || 'unknown') +
                    (failure.failedAtLayer ? ' at layer ' + failure.failedAtLayer : '')
            });
        }

        // Sort chronologically
        events.sort(function(a, b) { return a.time - b.time; });

        // Find critical moment (first anomalous event before failure)
        var failureTime = _parseTime(failure.timestamp);
        var criticalMoment = null;
        for (var k = events.length - 1; k >= 0; k--) {
            if (events[k].source !== 'failure' && events[k].time <= failureTime) {
                if (events[k].type !== 'reading') {
                    criticalMoment = events[k];
                    break;
                }
            }
        }

        return {
            engine: 'timeline',
            events: events,
            criticalMoment: criticalMoment,
            totalEvents: events.length
        };
    }

    // ── Engine 6: Root Cause Ranker ────────────────────────────

    function _rankRootCauses(failure, paramResult, materialResult, envResult, equipResult) {
        var allIndicators = [];
        if (materialResult.indicators) {
            allIndicators = allIndicators.concat(materialResult.indicators);
        }
        if (equipResult.indicators) {
            allIndicators = allIndicators.concat(equipResult.indicators);
        }

        // Add parameter-derived indicators
        var paramDevs = paramResult.deviations || [];
        for (var p = 0; p < paramDevs.length; p++) {
            var dev = paramDevs[p];
            if (dev.parameter === 'pressure' && dev.direction === 'above') {
                allIndicators.push('pressure_high');
            }
            if (dev.parameter === 'pressure' && dev.direction === 'below') {
                allIndicators.push('pressure_low');
            }
            if (dev.parameter === 'speed' && dev.direction === 'above') {
                allIndicators.push('speed_too_high');
            }
            if (dev.parameter === 'nozzleDiameter' && dev.direction === 'below') {
                allIndicators.push('nozzle_small');
            }
        }

        // Add environmental indicators
        var envAnom = envResult.anomalies || [];
        for (var e = 0; e < envAnom.length; e++) {
            if (envAnom[e].metric === 'temp') {
                allIndicators.push(envAnom[e].direction === 'spike' ? 'env_temp_spike' : 'env_temp_drop');
            }
            if (envAnom[e].metric === 'vibration' && envAnom[e].direction === 'spike') {
                allIndicators.push('vibration_spike');
            }
            allIndicators.push('env_anomaly');
        }

        // If user reported failure mode, add matching indicators
        if (failure.failureMode === 'structural_collapse') {
            allIndicators.push('layer_adhesion_fail');
        }

        // Score each signature by indicator match
        var candidates = [];
        for (var s = 0; s < FAILURE_SIGNATURES.length; s++) {
            var sig = FAILURE_SIGNATURES[s];
            var matched = 0;
            var evidence = [];
            for (var ind = 0; ind < sig.indicators.length; ind++) {
                if (allIndicators.indexOf(sig.indicators[ind]) !== -1) {
                    matched++;
                    evidence.push(sig.indicators[ind]);
                }
            }
            if (matched === 0) { continue; }

            var matchRatio = matched / sig.indicators.length;
            // Weight by engine scores
            var engineBoost = 0;
            if (sig.category === 'parameter') { engineBoost = paramResult.score * EVIDENCE_WEIGHTS.parameter; }
            else if (sig.category === 'material') { engineBoost = materialResult.score * EVIDENCE_WEIGHTS.material; }
            else if (sig.category === 'environmental') { engineBoost = envResult.score * EVIDENCE_WEIGHTS.environmental; }
            else if (sig.category === 'equipment') { engineBoost = equipResult.score * EVIDENCE_WEIGHTS.equipment; }

            var confidence = round(_clamp(matchRatio * 60 + engineBoost * 0.4, 0, 100), 2);

            // Apply outcome learning boost
            var outcomeBoost = _getOutcomeBoost(sig.id);
            confidence = round(_clamp(confidence + outcomeBoost, 0, 100), 2);

            candidates.push({
                cause: sig.id,
                label: sig.label,
                description: sig.description,
                confidence: confidence,
                severity: sig.severity,
                category: sig.category,
                evidence: evidence,
                matchRatio: round(matchRatio * 100, 2)
            });
        }

        candidates.sort(function(a, b) { return b.confidence - a.confidence; });
        return { engine: 'root_cause_ranker', causes: candidates };
    }

    // ── Engine 7: Corrective Action Generator ──────────────────

    function _generateActions(rootCauses) {
        var actions = [];
        var causes = rootCauses.causes || [];
        for (var i = 0; i < causes.length; i++) {
            var causeId = causes[i].cause;
            var causeActions = CORRECTIVE_ACTIONS[causeId] || [];
            for (var j = 0; j < causeActions.length; j++) {
                actions.push({
                    rootCause: causeId,
                    rootCauseLabel: causes[i].label,
                    causeConfidence: causes[i].confidence,
                    action: causeActions[j].action,
                    effort: causeActions[j].effort,
                    impact: causeActions[j].impact,
                    priority: round(causes[i].confidence * causeActions[j].impact / 100, 2)
                });
            }
        }
        actions.sort(function(a, b) { return b.priority - a.priority; });
        return { engine: 'corrective_actions', actions: actions };
    }

    // ── Outcome Learning ───────────────────────────────────────

    function _getOutcomeBoost(signatureId) {
        var total = 0;
        var count = 0;
        var outcomeKeys = Object.keys(_outcomes);
        for (var i = 0; i < outcomeKeys.length; i++) {
            var o = _outcomes[outcomeKeys[i]];
            if (o.confirmedCause === signatureId) {
                total += o.fixed ? 5 : -3;
                count++;
            }
        }
        return count === 0 ? 0 : total / count;
    }

    // ── Public API ─────────────────────────────────────────────

    function recordFailure(event) {
        if (!event || typeof event !== 'object') {
            throw new Error('Failure event must be a non-null object');
        }
        var sanitized = _sanitizeObject(event);
        if (!sanitized.id) {
            sanitized.id = _generateId();
        }
        if (typeof sanitized.id !== 'string') {
            throw new Error('Failure id must be a string');
        }
        _failures[sanitized.id] = sanitized;
        return { id: sanitized.id, recorded: true };
    }

    function analyze(failureId) {
        if (typeof failureId !== 'string') {
            throw new Error('failureId must be a string');
        }
        var failure = _failures[failureId];
        if (!failure) {
            throw new Error('Failure not found: ' + failureId);
        }

        var paramResult = _analyzeParameters(failure);
        var materialResult = _assessMaterial(failure);
        var envResult = _analyzeEnvironment(failure);
        var equipResult = _reconstructEquipment(failure);
        var timeline = _reconstructTimeline(failure);
        var rootCauses = _rankRootCauses(failure, paramResult, materialResult, envResult, equipResult);
        var actions = _generateActions(rootCauses);

        // Composite severity
        var engineScores = [paramResult.score, materialResult.score, envResult.score, equipResult.score];
        var weights = [EVIDENCE_WEIGHTS.parameter, EVIDENCE_WEIGHTS.material, EVIDENCE_WEIGHTS.environmental, EVIDENCE_WEIGHTS.equipment];
        var weightedSum = 0;
        var totalWeight = 0;
        for (var i = 0; i < engineScores.length; i++) {
            weightedSum += engineScores[i] * weights[i];
            totalWeight += weights[i];
        }
        var compositeSeverity = totalWeight > 0 ? round(weightedSum / totalWeight, 2) : 0;

        var result = {
            failureId: failureId,
            timestamp: new Date().toISOString(),
            compositeSeverity: compositeSeverity,
            engines: {
                parameterDeviation: paramResult,
                materialCondition: materialResult,
                environmentalForensics: envResult,
                equipmentState: equipResult,
                timeline: timeline,
                rootCauseRanker: rootCauses,
                correctiveActions: actions
            },
            rootCauses: rootCauses.causes,
            correctiveActions: actions.actions,
            summary: _buildSummary(rootCauses, actions, compositeSeverity)
        };

        _analyses[failureId] = result;
        return result;
    }

    function _buildSummary(rootCauses, actions, severity) {
        var causes = rootCauses.causes || [];
        var topCause = causes.length > 0 ? causes[0].label : 'Unknown';
        var topAction = (actions.actions || []).length > 0 ? actions.actions[0].action : 'Further investigation needed';
        return {
            topRootCause: topCause,
            totalRootCauses: causes.length,
            topAction: topAction,
            totalActions: (actions.actions || []).length,
            severity: severity,
            severityLabel: _getSeverityLabel(severity)
        };
    }

    function _getSeverityLabel(score) {
        for (var i = 0; i < HEALTH_THRESHOLDS.length; i++) {
            if (score <= HEALTH_THRESHOLDS[i].max) {
                // Invert: low score = healthy, high score = severe
                return HEALTH_THRESHOLDS[HEALTH_THRESHOLDS.length - 1 - i].label;
            }
        }
        return 'Unknown';
    }

    function getTimeline(failureId) {
        if (typeof failureId !== 'string') {
            throw new Error('failureId must be a string');
        }
        var failure = _failures[failureId];
        if (!failure) {
            throw new Error('Failure not found: ' + failureId);
        }
        return _reconstructTimeline(failure);
    }

    function getRootCauses(failureId) {
        var analysis = _analyses[failureId];
        if (!analysis) {
            throw new Error('No analysis found for: ' + failureId + ' — run analyze() first');
        }
        return analysis.rootCauses;
    }

    function getCorrectiveActions(failureId) {
        var analysis = _analyses[failureId];
        if (!analysis) {
            throw new Error('No analysis found for: ' + failureId + ' — run analyze() first');
        }
        return analysis.correctiveActions;
    }

    function recordOutcome(failureId, outcome) {
        if (typeof failureId !== 'string') {
            throw new Error('failureId must be a string');
        }
        if (!outcome || typeof outcome !== 'object') {
            throw new Error('outcome must be a non-null object');
        }
        if (!_failures[failureId]) {
            throw new Error('Failure not found: ' + failureId);
        }
        var sanitized = _sanitizeObject(outcome);
        sanitized.failureId = failureId;
        sanitized.recordedAt = new Date().toISOString();
        _outcomes[failureId] = sanitized;
        return { recorded: true, failureId: failureId };
    }

    function getPatterns() {
        var failureIds = Object.keys(_failures);
        if (failureIds.length < 2) {
            return { patterns: [], totalFailures: failureIds.length, message: 'Need at least 2 failures for pattern detection' };
        }

        // Count root causes across all analyses
        var causeCounts = {};
        var materialCounts = {};
        var equipmentCounts = {};
        for (var i = 0; i < failureIds.length; i++) {
            var analysis = _analyses[failureIds[i]];
            if (!analysis) { continue; }
            var causes = analysis.rootCauses || [];
            for (var c = 0; c < causes.length; c++) {
                var id = causes[c].cause;
                causeCounts[id] = (causeCounts[id] || 0) + 1;
            }
            // Track materials
            var mat = _failures[failureIds[i]].material;
            if (mat) { materialCounts[mat] = (materialCounts[mat] || 0) + 1; }
            // Track equipment
            var eq = (_failures[failureIds[i]].equipment || {}).printerId;
            if (eq) { equipmentCounts[eq] = (equipmentCounts[eq] || 0) + 1; }
        }

        var patterns = [];

        // Recurring root causes
        var causeKeys = Object.keys(causeCounts);
        for (var j = 0; j < causeKeys.length; j++) {
            if (causeCounts[causeKeys[j]] >= 2) {
                patterns.push({
                    type: 'recurring_root_cause',
                    id: causeKeys[j],
                    count: causeCounts[causeKeys[j]],
                    frequency: round(causeCounts[causeKeys[j]] / failureIds.length * 100, 2),
                    label: _getSignatureLabel(causeKeys[j])
                });
            }
        }

        // Material hotspots
        var matKeys = Object.keys(materialCounts);
        for (var m = 0; m < matKeys.length; m++) {
            if (materialCounts[matKeys[m]] >= 2) {
                patterns.push({
                    type: 'material_hotspot',
                    material: matKeys[m],
                    count: materialCounts[matKeys[m]],
                    frequency: round(materialCounts[matKeys[m]] / failureIds.length * 100, 2)
                });
            }
        }

        // Equipment repeat offenders
        var eqKeys = Object.keys(equipmentCounts);
        for (var e = 0; e < eqKeys.length; e++) {
            if (equipmentCounts[eqKeys[e]] >= 2) {
                patterns.push({
                    type: 'equipment_repeat_offender',
                    equipmentId: eqKeys[e],
                    count: equipmentCounts[eqKeys[e]],
                    frequency: round(equipmentCounts[eqKeys[e]] / failureIds.length * 100, 2)
                });
            }
        }

        patterns.sort(function(a, b) { return b.count - a.count; });

        return { patterns: patterns, totalFailures: failureIds.length };
    }

    function _getSignatureLabel(id) {
        for (var i = 0; i < FAILURE_SIGNATURES.length; i++) {
            if (FAILURE_SIGNATURES[i].id === id) { return FAILURE_SIGNATURES[i].label; }
        }
        return id;
    }

    function getDashboard() {
        var failureIds = Object.keys(_failures);
        var totalFailures = failureIds.length;

        if (totalFailures === 0) {
            return {
                totalFailures: 0,
                analyzedCount: 0,
                healthScore: 100,
                healthLabel: 'Excellent',
                topRootCauses: [],
                equipmentRanking: [],
                materialRanking: [],
                recentFailures: []
            };
        }

        // Aggregate root causes
        var causeCounts = {};
        var analyzedCount = 0;
        var severitySum = 0;
        for (var i = 0; i < failureIds.length; i++) {
            var analysis = _analyses[failureIds[i]];
            if (analysis) {
                analyzedCount++;
                severitySum += analysis.compositeSeverity;
                var causes = analysis.rootCauses || [];
                for (var c = 0; c < causes.length; c++) {
                    var id = causes[c].cause;
                    if (!causeCounts[id]) { causeCounts[id] = { count: 0, label: causes[c].label, totalConfidence: 0 }; }
                    causeCounts[id].count++;
                    causeCounts[id].totalConfidence += causes[c].confidence;
                }
            }
        }

        // Top root causes
        var topCauses = Object.keys(causeCounts).map(function(k) {
            return {
                cause: k,
                label: causeCounts[k].label,
                count: causeCounts[k].count,
                avgConfidence: round(causeCounts[k].totalConfidence / causeCounts[k].count, 2)
            };
        }).sort(function(a, b) { return b.count - a.count; }).slice(0, 5);

        // Equipment ranking
        var eqCounts = {};
        for (var j = 0; j < failureIds.length; j++) {
            var eq = (_failures[failureIds[j]].equipment || {}).printerId;
            if (eq) { eqCounts[eq] = (eqCounts[eq] || 0) + 1; }
        }
        var equipmentRanking = Object.keys(eqCounts).map(function(k) {
            return { equipmentId: k, failureCount: eqCounts[k] };
        }).sort(function(a, b) { return b.failureCount - a.failureCount; });

        // Health score (inverse of failure severity)
        var avgSeverity = analyzedCount > 0 ? severitySum / analyzedCount : 0;
        var healthScore = round(_clamp(100 - avgSeverity, 0, 100), 2);
        var healthLabel = 'Excellent';
        for (var h = 0; h < HEALTH_THRESHOLDS.length; h++) {
            if (healthScore <= HEALTH_THRESHOLDS[h].max) {
                healthLabel = HEALTH_THRESHOLDS[h].label;
                break;
            }
        }

        // Recent failures (last 5)
        var sorted = failureIds.map(function(fid) {
            return { id: fid, timestamp: _failures[fid].timestamp || '' };
        }).sort(function(a, b) {
            return _parseTime(b.timestamp) - _parseTime(a.timestamp);
        }).slice(0, 5);

        return {
            totalFailures: totalFailures,
            analyzedCount: analyzedCount,
            healthScore: healthScore,
            healthLabel: healthLabel,
            avgSeverity: round(avgSeverity, 2),
            topRootCauses: topCauses,
            equipmentRanking: equipmentRanking,
            recentFailures: sorted
        };
    }

    function generateReport(failureId) {
        var analysis = _analyses[failureId];
        if (!analysis) {
            throw new Error('No analysis found for: ' + failureId + ' — run analyze() first');
        }
        var failure = _failures[failureId];
        var outcome = _outcomes[failureId] || null;

        return {
            reportId: 'rpt-' + failureId,
            generatedAt: new Date().toISOString(),
            failure: {
                id: failureId,
                timestamp: failure.timestamp,
                material: failure.material,
                failureMode: failure.failureMode || 'unspecified',
                failedAtLayer: failure.failedAtLayer || null,
                notes: failure.notes || null
            },
            analysis: {
                compositeSeverity: analysis.compositeSeverity,
                rootCauses: analysis.rootCauses,
                correctiveActions: analysis.correctiveActions,
                summary: analysis.summary
            },
            engines: {
                parameterDeviation: analysis.engines.parameterDeviation,
                materialCondition: analysis.engines.materialCondition,
                environmentalForensics: analysis.engines.environmentalForensics,
                equipmentState: analysis.engines.equipmentState,
                timeline: {
                    totalEvents: analysis.engines.timeline.totalEvents,
                    criticalMoment: analysis.engines.timeline.criticalMoment
                }
            },
            outcome: outcome
        };
    }

    return {
        recordFailure: recordFailure,
        analyze: analyze,
        getTimeline: getTimeline,
        getRootCauses: getRootCauses,
        getCorrectiveActions: getCorrectiveActions,
        recordOutcome: recordOutcome,
        getPatterns: getPatterns,
        getDashboard: getDashboard,
        generateReport: generateReport
    };
}

module.exports = { createFailureAutopsy: createFailureAutopsy };
