// tests/viability.test.js — Cell Viability Estimator Tests
'use strict';

const { createViabilityEstimator } = require('../docs/shared/viability.js');
const assert = require('assert');

const est = createViabilityEstimator();

// ── Helper ──────────────────────────────────────────────────

function approx(actual, expected, tolerance, msg) {
    const diff = Math.abs(actual - expected);
    assert.ok(diff <= tolerance,
        (msg || '') + ' expected ~' + expected + ' ±' + tolerance + ', got ' + actual);
}

function throws(fn, pattern, msg) {
    let threw = false;
    try { fn(); } catch (e) {
        threw = true;
        if (pattern) {
            assert.ok(e.message.includes(pattern) || (typeof pattern === 'object' && pattern.test(e.message)),
                msg + ': expected error matching "' + pattern + '", got "' + e.message + '"');
        }
    }
    assert.ok(threw, msg || 'Expected function to throw');
}

// ── Individual Damage Models ────────────────────────────────

// Shear survival
test("shear survival zero", function() {
    assert.strictEqual(est.shearSurvival(0), 1.0, 'zero shear = full survival');
});

test("shear survival negative", function() {
    assert.strictEqual(est.shearSurvival(-10), 1.0, 'negative shear = full survival');
});

test("shear survival at critical", function() {
    const s = est.shearSurvival(500);  // gammaCrit = 500
    assert.ok(s > 0 && s < 1, 'at critical shear, survival between 0 and 1');
    approx(s, Math.exp(-0.5), 0.001, 'S(γ_crit) = exp(-alpha)');
});

test("shear survival high rate", function() {
    const s = est.shearSurvival(2000);
    assert.ok(s < 0.01, 'very high shear rate should kill most cells');
});

test("shear survival monotonic", function() {
    const s1 = est.shearSurvival(100);
    const s2 = est.shearSurvival(200);
    const s3 = est.shearSurvival(500);
    assert.ok(s1 > s2 && s2 > s3, 'shear survival decreases with rate');
});

test("shear survival custom params", function() {
    const s = est.shearSurvival(100, { alpha: 1, beta: 1, gammaCrit: 100 });
    approx(s, Math.exp(-1), 0.001, 'custom params');
});

// Pressure survival
test("pressure survival zero", function() {
    assert.strictEqual(est.pressureSurvival(0), 1.0, 'zero pressure = full survival');
});

test("pressure survival negative", function() {
    assert.strictEqual(est.pressureSurvival(-50), 1.0, 'negative pressure = full survival');
});

test("pressure survival at p50", function() {
    const s = est.pressureSurvival(150);  // p50 = 150
    approx(s, 0.5, 0.001, 'at p50, survival should be 0.5');
});

test("pressure survival low", function() {
    const s = est.pressureSurvival(50);
    assert.ok(s > 0.95, 'low pressure = high survival');
});

test("pressure survival high", function() {
    const s = est.pressureSurvival(300);
    assert.ok(s < 0.05, 'very high pressure = low survival');
});

test("pressure survival monotonic", function() {
    const s1 = est.pressureSurvival(50);
    const s2 = est.pressureSurvival(100);
    const s3 = est.pressureSurvival(200);
    assert.ok(s1 > s2 && s2 > s3, 'pressure survival decreases monotonically');
});

// Crosslink survival
test("crosslink survival zero duration", function() {
    assert.strictEqual(est.crosslinkSurvival(0, 50), 1.0, 'zero duration = no UV damage');
});

test("crosslink survival zero intensity", function() {
    assert.strictEqual(est.crosslinkSurvival(5000, 0), 1.0, 'zero intensity = no UV damage');
});

test("crosslink survival at e c50", function() {
    // EC50 = 15000, dose = duration * intensity
    // dose = 15000 → 50% damage → 50% survival
    const s = est.crosslinkSurvival(1500, 10);  // dose = 15000
    approx(s, 0.5, 0.001, 'at EC50 dose, survival = 0.5');
});

test("crosslink survival high dose", function() {
    const s = est.crosslinkSurvival(30000, 100);  // dose = 3M
    assert.ok(s < 0.01, 'massive UV dose kills nearly all cells');
});

test("crosslink survival moderate", function() {
    const s = est.crosslinkSurvival(500, 10);  // dose = 5000
    assert.ok(s > 0.5, 'moderate dose should leave majority alive');
});

// Thermal survival
test("thermal optimal", function() {
    approx(est.thermalSurvival(37), 1.0, 0.001, '37°C is optimal');
});

test("thermal cold", function() {
    const s = est.thermalSurvival(25);
    assert.ok(s < 1 && s > 0, 'cold = reduced but nonzero');
});

test("thermal hot", function() {
    const s = est.thermalSurvival(50);
    assert.ok(s < 0.5, 'very hot = significant damage');
});

test("thermal symmetric", function() {
    const cold = est.thermalSurvival(32);
    const hot = est.thermalSurvival(42);
    approx(cold, hot, 0.001, 'symmetric around 37°C');
});

// Duration survival
test("duration zero", function() {
    assert.strictEqual(est.durationSurvival(0), 1.0, 'zero time = full survival');
});

test("duration negative", function() {
    assert.strictEqual(est.durationSurvival(-10), 1.0, 'negative time = full survival');
});

test("duration linear", function() {
    approx(est.durationSurvival(500), 0.5, 0.001, '500s = 50% survival');
});

test("duration max", function() {
    assert.strictEqual(est.durationSurvival(1000), 0, '1000s = 0% survival');
});

test("duration beyond max", function() {
    assert.strictEqual(est.durationSurvival(2000), 0, 'beyond max = clamped to 0');
});

// Shear rate estimation
test("shear rate from pressure", function() {
    const params = { pressure: 100, nozzleDiameter: 0.4, flowRate: null };
    const gamma = est.estimateShearRate(params);
    assert.ok(gamma > 0, 'should produce positive shear rate');
    assert.ok(isFinite(gamma), 'should be finite');
});

test("shear rate from flow rate", function() {
    const params = { pressure: 100, nozzleDiameter: 0.4, flowRate: 1.0 };
    const gamma = est.estimateShearRate(params);
    assert.ok(gamma > 0, 'flow-rate based should produce positive shear');
});

test("shear rate higher pressure", function() {
    const p1 = { pressure: 50, nozzleDiameter: 0.4, flowRate: null };
    const p2 = { pressure: 150, nozzleDiameter: 0.4, flowRate: null };
    assert.ok(est.estimateShearRate(p2) > est.estimateShearRate(p1),
        'higher pressure = higher shear rate');
});

test("shear rate nozzle size with flow rate", function() {
    // At constant flow rate, smaller nozzle = higher shear rate
    const p1 = { pressure: 100, nozzleDiameter: 0.8, flowRate: 1.0 };
    const p2 = { pressure: 100, nozzleDiameter: 0.2, flowRate: 1.0 };
    assert.ok(est.estimateShearRate(p2) > est.estimateShearRate(p1),
        'smaller nozzle at constant flow = higher shear rate');
});

test("shear rate nozzle size with pressure", function() {
    // At constant pressure, Hagen-Poiseuille: Q ∝ D⁴, γ ∝ Q/D³ ∝ D
    // So larger nozzle = higher shear rate (more flow, net positive)
    const p1 = { pressure: 100, nozzleDiameter: 0.2, flowRate: null };
    const p2 = { pressure: 100, nozzleDiameter: 0.8, flowRate: null };
    assert.ok(est.estimateShearRate(p2) > est.estimateShearRate(p1),
        'larger nozzle at constant pressure = higher flow = higher shear');
});

// ── Combined Estimation ─────────────────────────────────────

test("estimate basic", function() {
    const result = est.estimate({ pressure: 80 });
    assert.ok(result.viabilityPercent > 0 && result.viabilityPercent <= 95,
        'viability in valid range');
    assert.ok(['excellent', 'good', 'acceptable', 'poor', 'critical'].includes(result.quality));
    assert.ok(result.breakdown);
    assert.strictEqual(result.breakdown.baseline, 0.95);
    assert.ok(result.estimatedShearRate > 0);
});

test("estimate with all params", function() {
    const result = est.estimate({
        pressure: 80,
        crosslinkDuration: 5000,
        crosslinkIntensity: 20,
        layerHeight: 0.4,
        nozzleDiameter: 0.4,
        temperature: 37,
        printDuration: 300,
    });
    assert.ok(result.viabilityPercent > 0);
    assert.notStrictEqual(result.breakdown.thermal, null);
    assert.notStrictEqual(result.breakdown.duration, null);
});

test("estimate limiting factor", function() {
    // Very high crosslink dose should make crosslink the limiting factor
    const result = est.estimate({
        pressure: 50,
        crosslinkDuration: 20000,
        crosslinkIntensity: 80,
    });
    assert.strictEqual(result.limitingFactor, 'crosslink', 'crosslink should be limiting');
});

test("estimate high pressure limiting", function() {
    const result = est.estimate({
        pressure: 200,
        crosslinkDuration: 0,
        crosslinkIntensity: 0,
    });
    // With very high pressure, either pressure or shear should be limiting
    assert.ok(result.limitingFactor === 'pressure' || result.limitingFactor === 'shear',
        'high pressure: limiting should be pressure or shear');
});

test("estimate warnings", function() {
    const result = est.estimate({
        pressure: 200,
        crosslinkDuration: 25000,
        crosslinkIntensity: 90,
        temperature: 50,
        printDuration: 800,
    });
    assert.ok(result.warnings.length > 0, 'extreme params should generate warnings');
});

test("estimate no warnings", function() {
    const result = est.estimate({
        pressure: 30,
        crosslinkDuration: 0,
        crosslinkIntensity: 0,
    });
    // Low pressure, no crosslinking — should be mostly fine
    assert.ok(result.warnings.length === 0 || result.quality === 'excellent' || result.quality === 'good',
        'gentle params should have few/no warnings');
});

// ── Input Validation ────────────────────────────────────────

test("estimate null params", function() {
    throws(function() { est.estimate(null); }, 'non-null object', 'null params');
});

test("estimate string params", function() {
    throws(function() { est.estimate('hello'); }, 'non-null object', 'string params');
});

test("estimate negative pressure", function() {
    throws(function() { est.estimate({ pressure: -10 }); }, '>= 0', 'negative pressure');
});

test("estimate na n pressure", function() {
    throws(function() { est.estimate({ pressure: NaN }); }, 'finite number', 'NaN pressure');
});

test("estimate infinity pressure", function() {
    throws(function() { est.estimate({ pressure: Infinity }); }, 'finite number', 'infinite pressure');
});

test("estimate crosslink intensity over100", function() {
    throws(function() { est.estimate({ pressure: 50, crosslinkIntensity: 150 }); },
        '<= 100', 'intensity over 100');
});

// ── Sensitivity Analysis ────────────────────────────────────

test("sensitivity basic", function() {
    const sa = est.sensitivityAnalysis({ pressure: 80 }, { steps: 5 });
    assert.ok(sa.pressure, 'should have pressure analysis');
    assert.ok(sa.crosslinkDuration, 'should have crosslink analysis');
    assert.ok(sa._ranking, 'should have ranking');
    assert.ok(Array.isArray(sa._ranking));
    assert.ok(sa.pressure.curve.length > 0, 'should have curve points');
    assert.ok(sa.pressure.sensitivityIndex >= 0, 'index should be non-negative');
});

test("sensitivity ranking", function() {
    const sa = est.sensitivityAnalysis({ pressure: 80 }, { steps: 10 });
    // Ranking should be sorted by decreasing sensitivity index
    for (var i = 1; i < sa._ranking.length; i++) {
        var prev = sa[sa._ranking[i - 1]].sensitivityIndex;
        var curr = sa[sa._ranking[i]].sensitivityIndex;
        assert.ok(prev >= curr, 'ranking should be sorted by sensitivity');
    }
});

test("sensitivity invalid steps", function() {
    throws(function() { est.sensitivityAnalysis({ pressure: 80 }, { steps: 1 }); },
        'between 2 and 200', 'steps too low');
    throws(function() { est.sensitivityAnalysis({ pressure: 80 }, { steps: 201 }); },
        'between 2 and 200', 'steps too high');
});

// ── Optimal Window Finder ───────────────────────────────────

const sampleData = [
    { print_data: { livePercent: 85, deadPercent: 10, elasticity: 50 },
      print_info: { pressure: { extruder1: 60, extruder2: 40 },
                    crosslinking: { cl_duration: 3000, cl_intensity: 15, cl_enabled: true },
                    resolution: { layerHeight: 0.3, layerNum: 20 }, wellplate: 6 },
      user_info: { serial: 0 } },
    { print_data: { livePercent: 70, deadPercent: 25, elasticity: 45 },
      print_info: { pressure: { extruder1: 100, extruder2: 80 },
                    crosslinking: { cl_duration: 8000, cl_intensity: 30, cl_enabled: true },
                    resolution: { layerHeight: 0.4, layerNum: 30 }, wellplate: 12 },
      user_info: { serial: 1 } },
    { print_data: { livePercent: 40, deadPercent: 55, elasticity: 30 },
      print_info: { pressure: { extruder1: 150, extruder2: 120 },
                    crosslinking: { cl_duration: 20000, cl_intensity: 80, cl_enabled: true },
                    resolution: { layerHeight: 0.8, layerNum: 10 }, wellplate: 24 },
      user_info: { serial: 2 } },
    { print_data: { livePercent: 90, deadPercent: 5, elasticity: 55 },
      print_info: { pressure: { extruder1: 40, extruder2: 30 },
                    crosslinking: { cl_duration: 1000, cl_intensity: 10, cl_enabled: true },
                    resolution: { layerHeight: 0.2, layerNum: 40 }, wellplate: 6 },
      user_info: { serial: 3 } },
    { print_data: { livePercent: 55, deadPercent: 40, elasticity: 35 },
      print_info: { pressure: { extruder1: 120, extruder2: 100 },
                    crosslinking: { cl_duration: 15000, cl_intensity: 50, cl_enabled: true },
                    resolution: { layerHeight: 0.5, layerNum: 25 }, wellplate: 48 },
      user_info: { serial: 4 } },
    { print_data: { livePercent: 78, deadPercent: 18, elasticity: 48 },
      print_info: { pressure: { extruder1: 75, extruder2: 60 },
                    crosslinking: { cl_duration: 5000, cl_intensity: 20, cl_enabled: true },
                    resolution: { layerHeight: 0.35, layerNum: 28 }, wellplate: 12 },
      user_info: { serial: 5 } },
];

test("optimal window basic", function() {
    const ow = est.findOptimalWindow(sampleData);
    assert.strictEqual(ow.totalRecords, 6);
    assert.ok(ow.topPercentileCount > 0);
    assert.ok(ow.optimalRanges.pressure);
    assert.ok(ow.recommendations.length > 0);
});

test("optimal window threshold", function() {
    const ow = est.findOptimalWindow(sampleData, { viabilityThreshold: 80 });
    assert.ok(ow.aboveThresholdCount <= ow.totalRecords);
    assert.strictEqual(ow.viabilityThreshold, 80);
});

test("optimal window percentile", function() {
    const ow = est.findOptimalWindow(sampleData, { topPercentile: 50 });
    assert.strictEqual(ow.topPercentile, 50);
    assert.ok(ow.topPercentileCount >= Math.ceil(6 * 0.5));
});

test("optimal window empty", function() {
    throws(function() { est.findOptimalWindow([]); }, 'non-empty array', 'empty data');
});

test("optimal window invalid", function() {
    throws(function() { est.findOptimalWindow(null); }, 'non-empty array', 'null data');
});

// ── Batch Analysis ──────────────────────────────────────────

test("batch analyze basic", function() {
    const batch = est.batchAnalyze(sampleData);
    assert.strictEqual(batch.count, 6);
    assert.ok(batch.accuracy.rmse >= 0);
    assert.ok(batch.accuracy.mae >= 0);
    assert.ok(batch.accuracy.correlation >= -1 && batch.accuracy.correlation <= 1);
    assert.ok(batch.results.length === 6);
});

test("batch analyze result fields", function() {
    const batch = est.batchAnalyze(sampleData);
    const r = batch.results[0];
    assert.ok('predicted' in r);
    assert.ok('actual' in r);
    assert.ok('error' in r);
    assert.ok('absError' in r);
    assert.ok('quality' in r);
    assert.ok('limitingFactor' in r);
});

test("batch analyze quality dist", function() {
    const batch = est.batchAnalyze(sampleData);
    const total = Object.values(batch.qualityDistribution).reduce(function(s, v) { return s + v; }, 0);
    assert.strictEqual(total, 6, 'quality distribution should account for all records');
});

test("batch analyze empty", function() {
    throws(function() { est.batchAnalyze([]); }, 'non-empty array', 'empty batch');
});

test("batch analyze skips invalid", function() {
    const data = [null, { print_data: null }, sampleData[0]];
    const batch = est.batchAnalyze(data);
    assert.strictEqual(batch.count, 1, 'should skip invalid records');
});

// ── Parameter Sweep ─────────────────────────────────────────

test("parameter sweep basic", function() {
    const sweep = est.parameterSweep(
        { pressure: 80, nozzleDiameter: 0.4 },
        'pressure', { min: 20, max: 200 },
        'crosslinkIntensity', { min: 0, max: 100 },
        { resolution: 3 }
    );
    assert.strictEqual(sweep.param1, 'pressure');
    assert.strictEqual(sweep.param2, 'crosslinkIntensity');
    assert.strictEqual(sweep.resolution, 3);
    assert.strictEqual(sweep.grid.length, 4);  // resolution + 1
    assert.ok(sweep.peak.viability > sweep.trough.viability, 'peak > trough');
});

test("parameter sweep peak location", function() {
    const sweep = est.parameterSweep(
        { pressure: 80, nozzleDiameter: 0.4 },
        'pressure', { min: 20, max: 200 },
        'crosslinkDuration', { min: 0, max: 30000 },
        { resolution: 5 }
    );
    // Peak should be at low pressure and low crosslink duration
    assert.ok(sweep.peak.pressure <= 100, 'optimal pressure should be low-moderate');
    assert.ok(sweep.peak.crosslinkDuration <= 10000, 'optimal crosslink should be low-moderate');
});

test("parameter sweep invalid range", function() {
    throws(function() {
        est.parameterSweep({pressure: 80}, 'pressure', null, 'crosslinkDuration', {min: 0, max: 100});
    }, 'range1 must have numeric', 'null range1');
});

test("parameter sweep invalid resolution", function() {
    throws(function() {
        est.parameterSweep({pressure: 80}, 'pressure', {min: 0, max: 100},
            'crosslinkDuration', {min: 0, max: 100}, {resolution: 1});
    }, 'between 2 and 50', 'resolution too low');
});

// ── Calibration ─────────────────────────────────────────────

test("calibrate basic", function() {
    const cal = est.calibrate(sampleData, { steps: 2 });
    assert.ok(cal.calibratedParams.pressure.p50 > 0);
    assert.ok(cal.calibratedParams.crosslink.ec50 > 0);
    assert.ok(cal.accuracy.rmse >= 0);
    assert.ok(cal.searchSpace.combinations > 0);
});

test("calibrate too few records", function() {
    throws(function() { est.calibrate(sampleData.slice(0, 3)); },
        'at least 5 records', 'too few records');
});

// ── Report Generation ───────────────────────────────────────

test("generate report basic", function() {
    const report = est.generateReport({ pressure: 80 });
    assert.ok(report.timestamp);
    assert.ok(report.estimation);
    assert.ok(Array.isArray(report.recommendations));
    assert.ok(report.sensitivity, 'should include sensitivity by default');
});

test("generate report no sensitivity", function() {
    const report = est.generateReport({ pressure: 80 }, { includeSensitivity: false });
    assert.ok(!report.sensitivity, 'sensitivity should be excluded');
});

test("generate report recommendations", function() {
    // High pressure and high UV should generate recommendations
    const report = est.generateReport({
        pressure: 200,
        crosslinkDuration: 25000,
        crosslinkIntensity: 80,
    }, { includeSensitivity: false });
    assert.ok(report.recommendations.length > 0, 'extreme params should trigger recommendations');
    var hasShearOrPressure = report.recommendations.some(function(r) {
        return r.parameter === 'shear' || r.parameter === 'pressure';
    });
    assert.ok(hasShearOrPressure, 'should recommend pressure/shear adjustment');
});

// ── Edge Cases ──────────────────────────────────────────────

test("estimate zero pressure", function() {
    var result = est.estimate({ pressure: 0 });
    assert.ok(result.viabilityPercent > 90, 'zero pressure should give near-max viability');
});

test("estimate very high pressure", function() {
    var result = est.estimate({ pressure: 500 });
    assert.ok(result.viabilityPercent < 10, 'extreme pressure should near-zero viability');
});

test("estimate no crosslinking", function() {
    var result = est.estimate({ pressure: 80, crosslinkDuration: 0, crosslinkIntensity: 0 });
    assert.strictEqual(result.breakdown.crosslink, 1, 'no crosslinking = 1.0 survival');
});

test("estimate multiplicative model", function() {
    // Verify multiplicative: V = baseline * shear * pressure * crosslink
    var result = est.estimate({ pressure: 80, crosslinkDuration: 5000, crosslinkIntensity: 20 });
    var expected = result.breakdown.baseline * result.breakdown.shear *
                   result.breakdown.pressure * result.breakdown.crosslink * 100;
    approx(result.viabilityPercent, expected, 0.1, 'multiplicative model check');
});

test("default params frozen", function() {
    assert.ok(Object.isFrozen(est.DEFAULT_PARAMS), 'DEFAULT_PARAMS should be frozen');
    assert.ok(Object.isFrozen(est.DEFAULT_PARAMS.shear), 'shear params should be frozen');
    assert.ok(Object.isFrozen(est.DEFAULT_PARAMS.pressure), 'pressure params should be frozen');
});

// ── Custom Model Params ─────────────────────────────────────

test("estimate custom baseline", function() {
    var result = est.estimate({ pressure: 0 }, { baseline: 1.0,
        shear: est.DEFAULT_PARAMS.shear,
        pressure: est.DEFAULT_PARAMS.pressure,
        crosslink: est.DEFAULT_PARAMS.crosslink });
    assert.ok(result.viabilityPercent > 95, 'baseline 1.0 with zero stress should give ~100%');
});

