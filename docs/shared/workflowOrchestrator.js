'use strict';

/**
 * workflowOrchestrator.js — Lab Workflow Orchestrator
 *
 * Autonomous multi-step bioprinting pipeline engine with parameter
 * propagation, anomaly detection, and auto-optimization.
 */

/* ── Helpers ──────────────────────────────────────────────────────── */

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function randNorm(mean, sd) {
    // Box-Muller
    var u1 = Math.random() || 1e-10;
    var u2 = Math.random();
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

var STEP_TYPES = [
    'bioink-prep', 'rheology-check', 'cell-seeding',
    'print-execution', 'crosslink', 'viability-check', 'quality-assessment'
];

/* ── Step Simulators ──────────────────────────────────────────────── */

var simulators = {
    'bioink-prep': function (params, _prev) {
        var concentration = params.concentration || 3;
        var temperature = params.temperature || 25;
        var mixing_time = params.mixing_time || 10;
        var viscosity = concentration * 120 + mixing_time * 5 - (temperature - 25) * 8;
        viscosity = clamp(randNorm(viscosity, viscosity * 0.05), 50, 5000);
        var homogeneity = clamp(randNorm(0.7 + mixing_time * 0.015, 0.03), 0, 1);
        return { viscosity: Math.round(viscosity * 10) / 10, homogeneity: Math.round(homogeneity * 1000) / 1000 };
    },
    'rheology-check': function (params, prev) {
        var viscosity = params.viscosity || (prev && prev.viscosity) || 400;
        var sti = clamp(randNorm(0.3 + viscosity * 0.0005, 0.04), 0, 1);
        var ys = clamp(randNorm(viscosity * 0.15, viscosity * 0.02), 0, 2000);
        var ps = clamp(randNorm(0.5 + sti * 0.4, 0.05), 0, 1);
        return {
            shear_thinning_index: Math.round(sti * 1000) / 1000,
            yield_stress: Math.round(ys * 10) / 10,
            printability_score: Math.round(ps * 1000) / 1000
        };
    },
    'cell-seeding': function (params, _prev) {
        var density = params.cell_density || 1e6;
        var volume = params.volume || 1;
        var seeded = Math.round(randNorm(density * volume, density * volume * 0.08));
        var uniformity = clamp(randNorm(0.85, 0.05), 0, 1);
        return { seeded_count: seeded, distribution_uniformity: Math.round(uniformity * 1000) / 1000 };
    },
    'print-execution': function (params, _prev) {
        var layers = params.layers || 20;
        var speed = params.speed || 10;
        var pressure = params.pressure || 200;
        var completed = Math.round(layers * clamp(randNorm(0.97, 0.02), 0.8, 1));
        var accuracy = clamp(randNorm(0.92 - speed * 0.003 + pressure * 0.0001, 0.03), 0, 1);
        return {
            layers_completed: completed,
            layers_target: layers,
            dimensional_accuracy: Math.round(accuracy * 1000) / 1000
        };
    },
    'crosslink': function (params, _prev) {
        var intensity = params.uv_intensity || 10;
        var duration = params.duration || 60;
        var cd = clamp(randNorm(0.4 + intensity * 0.03 + duration * 0.002, 0.05), 0, 1);
        var gs = clamp(randNorm(intensity * 5 + duration * 0.8, 8), 0, 500);
        return { crosslink_density: Math.round(cd * 1000) / 1000, gel_strength: Math.round(gs * 10) / 10 };
    },
    'viability-check': function (params, prev) {
        var base = 0.88;
        if (prev && prev.crosslink_density) base -= (prev.crosslink_density - 0.5) * 0.15;
        if (prev && prev.dimensional_accuracy) base += (prev.dimensional_accuracy - 0.9) * 0.1;
        var viability = clamp(randNorm(base, 0.04), 0, 1);
        var metabolic = clamp(randNorm(viability * 0.95, 0.03), 0, 1);
        return {
            viability_pct: Math.round(viability * 1000) / 1000,
            metabolic_activity: Math.round(metabolic * 1000) / 1000
        };
    },
    'quality-assessment': function (params, prev) {
        var scores = [];
        if (prev && prev.viability_pct) scores.push(prev.viability_pct);
        if (prev && prev.dimensional_accuracy) scores.push(prev.dimensional_accuracy);
        if (prev && prev.printability_score) scores.push(prev.printability_score);
        if (prev && prev.homogeneity) scores.push(prev.homogeneity);
        var avg = scores.length ? scores.reduce(function (a, b) { return a + b; }, 0) / scores.length : 0.75;
        var overall = clamp(randNorm(avg, 0.03), 0, 1);
        var defects = [];
        if (overall < 0.7) defects.push('structural-weakness');
        if (prev && prev.viability_pct && prev.viability_pct < 0.8) defects.push('low-viability');
        if (prev && prev.homogeneity && prev.homogeneity < 0.75) defects.push('poor-mixing');
        return {
            overall_score: Math.round(overall * 1000) / 1000,
            pass_fail: overall >= 0.7 ? 'PASS' : 'FAIL',
            defect_list: defects
        };
    }
};

/* ── Core API ─────────────────────────────────────────────────────── */

function createPipeline(name, steps) {
    if (!name || typeof name !== 'string') throw new Error('Pipeline name required');
    if (!Array.isArray(steps) || steps.length === 0) throw new Error('At least one step required');
    for (var i = 0; i < steps.length; i++) {
        var s = steps[i];
        if (!s.id || !s.name || !s.type) throw new Error('Step must have id, name, type');
        if (STEP_TYPES.indexOf(s.type) === -1) throw new Error('Unknown step type: ' + s.type);
    }
    return { name: name, steps: steps, created: new Date().toISOString() };
}

function detectAnomalies(stepResult, expectedRange) {
    var anomalies = [];
    if (!expectedRange) return anomalies;
    var keys = Object.keys(expectedRange);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (stepResult[k] === undefined) continue;
        var range = expectedRange[k];
        var val = stepResult[k];
        if (typeof val === 'number' && (val < range.min || val > range.max)) {
            var severity = 'warning';
            if (val < range.min * 0.8 || val > range.max * 1.2) severity = 'critical';
            anomalies.push({ metric: k, value: val, expected: range, severity: severity });
        }
    }
    return anomalies;
}

function recommendFix(anomaly) {
    var fixes = {
        viscosity: { low: 'Increase polymer concentration or reduce temperature', high: 'Reduce concentration or increase temperature/mixing time' },
        homogeneity: { low: 'Increase mixing time or use vortex mixer', high: 'Acceptable — proceed' },
        printability_score: { low: 'Adjust rheology parameters; consider different bioink', high: 'Acceptable' },
        viability_pct: { low: 'Reduce crosslinking intensity or shorten UV exposure', high: 'Acceptable' },
        dimensional_accuracy: { low: 'Reduce print speed or increase pressure', high: 'Acceptable' },
        crosslink_density: { low: 'Increase UV intensity or exposure time', high: 'Reduce UV intensity to preserve cell viability' },
        gel_strength: { low: 'Increase crosslink duration', high: 'Reduce to avoid brittleness' },
        overall_score: { low: 'Review upstream steps for anomalies', high: 'Acceptable' },
        seeded_count: { low: 'Increase cell density or volume', high: 'Reduce cell density to avoid overcrowding' },
        distribution_uniformity: { low: 'Use agitation during seeding', high: 'Acceptable' }
    };
    var dir = anomaly.value < anomaly.expected.min ? 'low' : 'high';
    var fix = fixes[anomaly.metric];
    return fix ? fix[dir] : 'Review parameter and adjust ' + (dir === 'low' ? 'upward' : 'downward');
}

function executePipeline(pipeline, initialParams) {
    var results = [];
    var allAnomalies = [];
    var prevOutput = initialParams || {};
    var status = 'completed';
    var start = Date.now();

    for (var i = 0; i < pipeline.steps.length; i++) {
        var step = pipeline.steps[i];
        var sim = simulators[step.type];
        if (!sim) { status = 'error'; break; }

        var merged = {};
        var pk = Object.keys(prevOutput);
        for (var j = 0; j < pk.length; j++) merged[pk[j]] = prevOutput[pk[j]];
        if (step.params) {
            var sk = Object.keys(step.params);
            for (var j2 = 0; j2 < sk.length; j2++) merged[sk[j2]] = step.params[sk[j2]];
        }

        var output = sim(merged, prevOutput);
        var anomalies = detectAnomalies(output, step.expectedOutputRange);

        for (var a = 0; a < anomalies.length; a++) {
            anomalies[a].step = step.name;
            anomalies[a].stepIndex = i;
            anomalies[a].fix = recommendFix(anomalies[a]);
            allAnomalies.push(anomalies[a]);
        }

        var stepStatus = 'passed';
        for (var a2 = 0; a2 < anomalies.length; a2++) {
            if (anomalies[a2].severity === 'critical') { stepStatus = 'failed'; status = 'completed-with-issues'; }
            else if (stepStatus !== 'failed') stepStatus = 'warning';
        }

        results.push({ step: step, output: output, anomalies: anomalies, status: stepStatus });

        // Propagate outputs to next step
        var ok = Object.keys(output);
        for (var k = 0; k < ok.length; k++) prevOutput[ok[k]] = output[ok[k]];
    }

    var duration = Date.now() - start;
    var health = scorePipelineHealth(results);
    var recommendations = [];
    for (var r = 0; r < allAnomalies.length; r++) {
        recommendations.push('[' + allAnomalies[r].step + '] ' + allAnomalies[r].fix);
    }

    return {
        pipeline: pipeline.name,
        results: results,
        anomalies: allAnomalies,
        status: status,
        duration: duration,
        health: health,
        recommendations: recommendations,
        timestamp: new Date().toISOString()
    };
}

function scorePipelineHealth(results) {
    if (!results.length) return { score: 0, breakdown: {} };
    var total = 0;
    var breakdown = {};
    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var stepScore = r.status === 'passed' ? 100 : r.status === 'warning' ? 70 : 30;
        breakdown[r.step.name] = stepScore;
        total += stepScore;
    }
    return { score: Math.round(total / results.length), breakdown: breakdown };
}

function autoOptimize(pipeline, history) {
    if (!history || history.length < 2) {
        return { suggestions: [], message: 'Need at least 2 past runs to optimize' };
    }
    var suggestions = [];

    // Analyze recurring anomalies
    var anomalyCounts = {};
    for (var h = 0; h < history.length; h++) {
        var run = history[h];
        if (!run.anomalies) continue;
        for (var a = 0; a < run.anomalies.length; a++) {
            var key = run.anomalies[a].step + ':' + run.anomalies[a].metric;
            anomalyCounts[key] = (anomalyCounts[key] || 0) + 1;
        }
    }

    var keys = Object.keys(anomalyCounts);
    for (var k = 0; k < keys.length; k++) {
        if (anomalyCounts[keys[k]] >= 2) {
            var parts = keys[k].split(':');
            suggestions.push({
                step: parts[0],
                metric: parts[1],
                frequency: anomalyCounts[keys[k]] + '/' + history.length + ' runs',
                suggestion: 'Recurring anomaly — widen expected range or adjust parameters',
                priority: anomalyCounts[keys[k]] >= history.length * 0.7 ? 'high' : 'medium'
            });
        }
    }

    // Health trend
    var healthScores = [];
    for (var h2 = 0; h2 < history.length; h2++) {
        if (history[h2].health) healthScores.push(history[h2].health.score);
    }
    if (healthScores.length >= 2) {
        var trend = healthScores[healthScores.length - 1] - healthScores[0];
        if (trend < -10) {
            suggestions.push({
                step: 'pipeline',
                metric: 'health_trend',
                frequency: 'trending',
                suggestion: 'Health declining (' + healthScores[0] + ' → ' + healthScores[healthScores.length - 1] + '). Review process parameters.',
                priority: 'high'
            });
        }
    }

    return { suggestions: suggestions, message: suggestions.length ? suggestions.length + ' optimization(s) found' : 'Pipeline looks healthy' };
}

/* ── Presets ───────────────────────────────────────────────────────── */

function getPresetPipelines() {
    return [
        createPipeline('Standard Bioprint', [
            { id: 's1', name: 'Bioink Preparation', type: 'bioink-prep', params: { concentration: 3, temperature: 25, mixing_time: 10 }, expectedOutputRange: { viscosity: { min: 200, max: 800 }, homogeneity: { min: 0.8, max: 1 } } },
            { id: 's2', name: 'Rheology Check', type: 'rheology-check', params: {}, expectedOutputRange: { printability_score: { min: 0.6, max: 1 } } },
            { id: 's3', name: 'Cell Seeding', type: 'cell-seeding', params: { cell_density: 1e6, volume: 1 }, expectedOutputRange: { distribution_uniformity: { min: 0.75, max: 1 } } },
            { id: 's4', name: 'Print Execution', type: 'print-execution', params: { layers: 20, speed: 10, pressure: 200 }, expectedOutputRange: { dimensional_accuracy: { min: 0.85, max: 1 } } },
            { id: 's5', name: 'Crosslinking', type: 'crosslink', params: { uv_intensity: 10, duration: 60 }, expectedOutputRange: { crosslink_density: { min: 0.5, max: 0.9 } } },
            { id: 's6', name: 'Viability Check', type: 'viability-check', params: {}, expectedOutputRange: { viability_pct: { min: 0.8, max: 1 } } },
            { id: 's7', name: 'Quality Assessment', type: 'quality-assessment', params: {}, expectedOutputRange: { overall_score: { min: 0.7, max: 1 } } }
        ]),
        createPipeline('High-Viability Protocol', [
            { id: 'hv1', name: 'Gentle Bioink Prep', type: 'bioink-prep', params: { concentration: 2.5, temperature: 22, mixing_time: 15 }, expectedOutputRange: { viscosity: { min: 150, max: 600 }, homogeneity: { min: 0.85, max: 1 } } },
            { id: 'hv2', name: 'Rheology Validation', type: 'rheology-check', params: {}, expectedOutputRange: { printability_score: { min: 0.5, max: 1 } } },
            { id: 'hv3', name: 'Careful Seeding', type: 'cell-seeding', params: { cell_density: 5e5, volume: 1.5 }, expectedOutputRange: { distribution_uniformity: { min: 0.8, max: 1 } } },
            { id: 'hv4', name: 'Slow Print', type: 'print-execution', params: { layers: 15, speed: 5, pressure: 150 }, expectedOutputRange: { dimensional_accuracy: { min: 0.9, max: 1 } } },
            { id: 'hv5', name: 'Light Crosslink', type: 'crosslink', params: { uv_intensity: 6, duration: 30 }, expectedOutputRange: { crosslink_density: { min: 0.3, max: 0.7 } } },
            { id: 'hv6', name: 'Viability Check', type: 'viability-check', params: {}, expectedOutputRange: { viability_pct: { min: 0.85, max: 1 } } }
        ]),
        createPipeline('Fast Print', [
            { id: 'fp1', name: 'Quick Prep', type: 'bioink-prep', params: { concentration: 4, temperature: 28, mixing_time: 5 }, expectedOutputRange: { viscosity: { min: 300, max: 1200 } } },
            { id: 'fp2', name: 'Rapid Print', type: 'print-execution', params: { layers: 10, speed: 20, pressure: 300 }, expectedOutputRange: { dimensional_accuracy: { min: 0.75, max: 1 } } },
            { id: 'fp3', name: 'Fast Crosslink', type: 'crosslink', params: { uv_intensity: 15, duration: 30 }, expectedOutputRange: { crosslink_density: { min: 0.5, max: 1 } } },
            { id: 'fp4', name: 'Quality Check', type: 'quality-assessment', params: {}, expectedOutputRange: { overall_score: { min: 0.6, max: 1 } } }
        ]),
        createPipeline('Research Grade', [
            { id: 'rg1', name: 'Precise Bioink Prep', type: 'bioink-prep', params: { concentration: 3, temperature: 24, mixing_time: 20 }, expectedOutputRange: { viscosity: { min: 250, max: 700 }, homogeneity: { min: 0.9, max: 1 } } },
            { id: 'rg2', name: 'Full Rheology', type: 'rheology-check', params: {}, expectedOutputRange: { printability_score: { min: 0.7, max: 1 }, shear_thinning_index: { min: 0.3, max: 0.8 } } },
            { id: 'rg3', name: 'Dense Seeding', type: 'cell-seeding', params: { cell_density: 2e6, volume: 2 }, expectedOutputRange: { seeded_count: { min: 3e6, max: 5e6 }, distribution_uniformity: { min: 0.8, max: 1 } } },
            { id: 'rg4', name: 'Precision Print', type: 'print-execution', params: { layers: 30, speed: 8, pressure: 180 }, expectedOutputRange: { dimensional_accuracy: { min: 0.9, max: 1 } } },
            { id: 'rg5', name: 'Controlled Crosslink', type: 'crosslink', params: { uv_intensity: 8, duration: 90 }, expectedOutputRange: { crosslink_density: { min: 0.5, max: 0.85 } } },
            { id: 'rg6', name: 'Viability Assay', type: 'viability-check', params: {}, expectedOutputRange: { viability_pct: { min: 0.82, max: 1 }, metabolic_activity: { min: 0.75, max: 1 } } },
            { id: 'rg7', name: 'Full QA', type: 'quality-assessment', params: {}, expectedOutputRange: { overall_score: { min: 0.8, max: 1 } } }
        ]),
        createPipeline('Scaffold-First', [
            { id: 'sf1', name: 'Scaffold Bioink', type: 'bioink-prep', params: { concentration: 5, temperature: 30, mixing_time: 8 }, expectedOutputRange: { viscosity: { min: 400, max: 1500 } } },
            { id: 'sf2', name: 'Scaffold Print', type: 'print-execution', params: { layers: 40, speed: 6, pressure: 250 }, expectedOutputRange: { dimensional_accuracy: { min: 0.88, max: 1 } } },
            { id: 'sf3', name: 'Heavy Crosslink', type: 'crosslink', params: { uv_intensity: 12, duration: 120 }, expectedOutputRange: { gel_strength: { min: 100, max: 300 } } },
            { id: 'sf4', name: 'Post-Seed Cells', type: 'cell-seeding', params: { cell_density: 1.5e6, volume: 2 }, expectedOutputRange: { distribution_uniformity: { min: 0.7, max: 1 } } },
            { id: 'sf5', name: 'Viability Check', type: 'viability-check', params: {}, expectedOutputRange: { viability_pct: { min: 0.75, max: 1 } } }
        ])
    ];
}

/* ── Factory ──────────────────────────────────────────────────────── */

function createWorkflowOrchestrator() {
    return {
        createPipeline: createPipeline,
        executePipeline: executePipeline,
        detectAnomalies: detectAnomalies,
        recommendFix: recommendFix,
        getPresetPipelines: getPresetPipelines,
        scorePipelineHealth: scorePipelineHealth,
        autoOptimize: autoOptimize,
        STEP_TYPES: STEP_TYPES
    };
}

/* ── Export ────────────────────────────────────────────────────────── */

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        createWorkflowOrchestrator: createWorkflowOrchestrator,
        createPipeline: createPipeline,
        executePipeline: executePipeline,
        detectAnomalies: detectAnomalies,
        recommendFix: recommendFix,
        getPresetPipelines: getPresetPipelines,
        scorePipelineHealth: scorePipelineHealth,
        autoOptimize: autoOptimize,
        STEP_TYPES: STEP_TYPES
    };
}
