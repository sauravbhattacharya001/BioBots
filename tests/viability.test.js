// tests/viability.test.js — Cell Viability Estimator Tests
// Converted from IIFE/assert to Jest describe/test blocks so Jest
// can discover, count, and report each test individually.
'use strict';

const { createViabilityEstimator } = require('../docs/shared/viability.js');

const est = createViabilityEstimator();

// ── Helpers ─────────────────────────────────────────────────

function approx(actual, expected, tolerance, msg) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

// ── Individual Damage Models ────────────────────────────────

describe('shearSurvival', () => {
    test('zero shear = full survival', () => {
        expect(est.shearSurvival(0)).toBe(1.0);
    });

    test('negative shear = full survival', () => {
        expect(est.shearSurvival(-10)).toBe(1.0);
    });

    test('at critical shear, survival between 0 and 1', () => {
        const s = est.shearSurvival(500);  // gammaCrit = 500
        expect(s).toBeGreaterThan(0);
        expect(s).toBeLessThan(1);
        approx(s, Math.exp(-0.5), 0.001);
    });

    test('very high shear rate kills most cells', () => {
        expect(est.shearSurvival(2000)).toBeLessThan(0.01);
    });

    test('monotonically decreasing', () => {
        const s1 = est.shearSurvival(100);
        const s2 = est.shearSurvival(200);
        const s3 = est.shearSurvival(500);
        expect(s1).toBeGreaterThan(s2);
        expect(s2).toBeGreaterThan(s3);
    });

    test('custom params', () => {
        const s = est.shearSurvival(100, { alpha: 1, beta: 1, gammaCrit: 100 });
        approx(s, Math.exp(-1), 0.001);
    });
});

describe('pressureSurvival', () => {
    test('zero pressure = full survival', () => {
        expect(est.pressureSurvival(0)).toBe(1.0);
    });

    test('negative pressure = full survival', () => {
        expect(est.pressureSurvival(-50)).toBe(1.0);
    });

    test('at p50, survival should be 0.5', () => {
        approx(est.pressureSurvival(150), 0.5, 0.001);
    });

    test('low pressure = high survival', () => {
        expect(est.pressureSurvival(50)).toBeGreaterThan(0.95);
    });

    test('very high pressure = low survival', () => {
        expect(est.pressureSurvival(300)).toBeLessThan(0.05);
    });

    test('monotonically decreasing', () => {
        const s1 = est.pressureSurvival(50);
        const s2 = est.pressureSurvival(100);
        const s3 = est.pressureSurvival(200);
        expect(s1).toBeGreaterThan(s2);
        expect(s2).toBeGreaterThan(s3);
    });
});

describe('crosslinkSurvival', () => {
    test('zero duration = no UV damage', () => {
        expect(est.crosslinkSurvival(0, 50)).toBe(1.0);
    });

    test('zero intensity = no UV damage', () => {
        expect(est.crosslinkSurvival(5000, 0)).toBe(1.0);
    });

    test('at EC50 dose, survival = 0.5', () => {
        // EC50 = 15000, dose = duration * intensity
        approx(est.crosslinkSurvival(1500, 10), 0.5, 0.001);
    });

    test('massive UV dose kills nearly all cells', () => {
        expect(est.crosslinkSurvival(30000, 100)).toBeLessThan(0.01);
    });

    test('moderate dose leaves majority alive', () => {
        expect(est.crosslinkSurvival(500, 10)).toBeGreaterThan(0.5);
    });
});

describe('thermalSurvival', () => {
    test('37°C is optimal', () => {
        approx(est.thermalSurvival(37), 1.0, 0.001);
    });

    test('cold = reduced but nonzero', () => {
        const s = est.thermalSurvival(25);
        expect(s).toBeLessThan(1);
        expect(s).toBeGreaterThan(0);
    });

    test('very hot = significant damage', () => {
        expect(est.thermalSurvival(50)).toBeLessThan(0.5);
    });

    test('symmetric around 37°C', () => {
        approx(est.thermalSurvival(32), est.thermalSurvival(42), 0.001);
    });
});

describe('durationSurvival', () => {
    test('zero time = full survival', () => {
        expect(est.durationSurvival(0)).toBe(1.0);
    });

    test('negative time = full survival', () => {
        expect(est.durationSurvival(-10)).toBe(1.0);
    });

    test('500s = 50% survival', () => {
        approx(est.durationSurvival(500), 0.5, 0.001);
    });

    test('1000s = 0% survival', () => {
        expect(est.durationSurvival(1000)).toBe(0);
    });

    test('beyond max = clamped to 0', () => {
        expect(est.durationSurvival(2000)).toBe(0);
    });
});

describe('estimateShearRate', () => {
    test('pressure-based produces positive shear rate', () => {
        const gamma = est.estimateShearRate({ pressure: 100, nozzleDiameter: 0.4, flowRate: null });
        expect(gamma).toBeGreaterThan(0);
        expect(isFinite(gamma)).toBe(true);
    });

    test('flow-rate based produces positive shear', () => {
        const gamma = est.estimateShearRate({ pressure: 100, nozzleDiameter: 0.4, flowRate: 1.0 });
        expect(gamma).toBeGreaterThan(0);
    });

    test('higher pressure = higher shear rate', () => {
        const p1 = { pressure: 50, nozzleDiameter: 0.4, flowRate: null };
        const p2 = { pressure: 150, nozzleDiameter: 0.4, flowRate: null };
        expect(est.estimateShearRate(p2)).toBeGreaterThan(est.estimateShearRate(p1));
    });

    test('smaller nozzle at constant flow = higher shear rate', () => {
        const p1 = { pressure: 100, nozzleDiameter: 0.8, flowRate: 1.0 };
        const p2 = { pressure: 100, nozzleDiameter: 0.2, flowRate: 1.0 };
        expect(est.estimateShearRate(p2)).toBeGreaterThan(est.estimateShearRate(p1));
    });

    test('larger nozzle at constant pressure = higher flow = higher shear', () => {
        const p1 = { pressure: 100, nozzleDiameter: 0.2, flowRate: null };
        const p2 = { pressure: 100, nozzleDiameter: 0.8, flowRate: null };
        expect(est.estimateShearRate(p2)).toBeGreaterThan(est.estimateShearRate(p1));
    });
});

// ── Combined Estimation ─────────────────────────────────────

describe('estimate', () => {
    test('basic estimation in valid range', () => {
        const result = est.estimate({ pressure: 80 });
        expect(result.viabilityPercent).toBeGreaterThan(0);
        expect(result.viabilityPercent).toBeLessThanOrEqual(95);
        expect(['excellent', 'good', 'acceptable', 'poor', 'critical']).toContain(result.quality);
        expect(result.breakdown).toBeDefined();
        expect(result.breakdown.baseline).toBe(0.95);
        expect(result.estimatedShearRate).toBeGreaterThan(0);
    });

    test('with all params', () => {
        const result = est.estimate({
            pressure: 80,
            crosslinkDuration: 5000,
            crosslinkIntensity: 20,
            layerHeight: 0.4,
            nozzleDiameter: 0.4,
            temperature: 37,
            printDuration: 300,
        });
        expect(result.viabilityPercent).toBeGreaterThan(0);
        expect(result.breakdown.thermal).not.toBeNull();
        expect(result.breakdown.duration).not.toBeNull();
    });

    test('crosslink limiting factor', () => {
        const result = est.estimate({
            pressure: 50,
            crosslinkDuration: 20000,
            crosslinkIntensity: 80,
        });
        expect(result.limitingFactor).toBe('crosslink');
    });

    test('high pressure limiting factor', () => {
        const result = est.estimate({
            pressure: 200,
            crosslinkDuration: 0,
            crosslinkIntensity: 0,
        });
        expect(['pressure', 'shear']).toContain(result.limitingFactor);
    });

    test('extreme params generate warnings', () => {
        const result = est.estimate({
            pressure: 200,
            crosslinkDuration: 25000,
            crosslinkIntensity: 90,
            temperature: 50,
            printDuration: 800,
        });
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    test('gentle params have few/no warnings', () => {
        const result = est.estimate({
            pressure: 30,
            crosslinkDuration: 0,
            crosslinkIntensity: 0,
        });
        expect(
            result.warnings.length === 0 ||
            result.quality === 'excellent' ||
            result.quality === 'good'
        ).toBe(true);
    });
});

// ── Input Validation ────────────────────────────────────────

describe('estimate input validation', () => {
    test('null params throws', () => {
        expect(() => est.estimate(null)).toThrow('non-null object');
    });

    test('string params throws', () => {
        expect(() => est.estimate('hello')).toThrow('non-null object');
    });

    test('negative pressure throws', () => {
        expect(() => est.estimate({ pressure: -10 })).toThrow('>= 0');
    });

    test('NaN pressure throws', () => {
        expect(() => est.estimate({ pressure: NaN })).toThrow('finite number');
    });

    test('Infinity pressure throws', () => {
        expect(() => est.estimate({ pressure: Infinity })).toThrow('finite number');
    });

    test('crosslinkIntensity over 100 throws', () => {
        expect(() => est.estimate({ pressure: 50, crosslinkIntensity: 150 })).toThrow('<= 100');
    });
});

// ── Sensitivity Analysis ────────────────────────────────────

describe('sensitivityAnalysis', () => {
    test('basic analysis', () => {
        const sa = est.sensitivityAnalysis({ pressure: 80 }, { steps: 5 });
        expect(sa.pressure).toBeDefined();
        expect(sa.crosslinkDuration).toBeDefined();
        expect(sa._ranking).toBeDefined();
        expect(Array.isArray(sa._ranking)).toBe(true);
        expect(sa.pressure.curve.length).toBeGreaterThan(0);
        expect(sa.pressure.sensitivityIndex).toBeGreaterThanOrEqual(0);
    });

    test('ranking sorted by decreasing sensitivity', () => {
        const sa = est.sensitivityAnalysis({ pressure: 80 }, { steps: 10 });
        for (let i = 1; i < sa._ranking.length; i++) {
            const prev = sa[sa._ranking[i - 1]].sensitivityIndex;
            const curr = sa[sa._ranking[i]].sensitivityIndex;
            expect(prev).toBeGreaterThanOrEqual(curr);
        }
    });

    test('invalid steps throws', () => {
        expect(() => est.sensitivityAnalysis({ pressure: 80 }, { steps: 1 })).toThrow('between 2 and 200');
        expect(() => est.sensitivityAnalysis({ pressure: 80 }, { steps: 201 })).toThrow('between 2 and 200');
    });
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

describe('findOptimalWindow', () => {
    test('basic optimal window', () => {
        const ow = est.findOptimalWindow(sampleData);
        expect(ow.totalRecords).toBe(6);
        expect(ow.topPercentileCount).toBeGreaterThan(0);
        expect(ow.optimalRanges.pressure).toBeDefined();
        expect(ow.recommendations.length).toBeGreaterThan(0);
    });

    test('with viability threshold', () => {
        const ow = est.findOptimalWindow(sampleData, { viabilityThreshold: 80 });
        expect(ow.aboveThresholdCount).toBeLessThanOrEqual(ow.totalRecords);
        expect(ow.viabilityThreshold).toBe(80);
    });

    test('with percentile', () => {
        const ow = est.findOptimalWindow(sampleData, { topPercentile: 50 });
        expect(ow.topPercentile).toBe(50);
        expect(ow.topPercentileCount).toBeGreaterThanOrEqual(Math.ceil(6 * 0.5));
    });

    test('empty data throws', () => {
        expect(() => est.findOptimalWindow([])).toThrow('non-empty array');
    });

    test('null data throws', () => {
        expect(() => est.findOptimalWindow(null)).toThrow('non-empty array');
    });
});

// ── Batch Analysis ──────────────────────────────────────────

describe('batchAnalyze', () => {
    test('basic batch analysis', () => {
        const batch = est.batchAnalyze(sampleData);
        expect(batch.count).toBe(6);
        expect(batch.accuracy.rmse).toBeGreaterThanOrEqual(0);
        expect(batch.accuracy.mae).toBeGreaterThanOrEqual(0);
        expect(batch.accuracy.correlation).toBeGreaterThanOrEqual(-1);
        expect(batch.accuracy.correlation).toBeLessThanOrEqual(1);
        expect(batch.results.length).toBe(6);
    });

    test('result fields', () => {
        const batch = est.batchAnalyze(sampleData);
        const r = batch.results[0];
        expect(r).toHaveProperty('predicted');
        expect(r).toHaveProperty('actual');
        expect(r).toHaveProperty('error');
        expect(r).toHaveProperty('absError');
        expect(r).toHaveProperty('quality');
        expect(r).toHaveProperty('limitingFactor');
    });

    test('quality distribution accounts for all records', () => {
        const batch = est.batchAnalyze(sampleData);
        const total = Object.values(batch.qualityDistribution).reduce((s, v) => s + v, 0);
        expect(total).toBe(6);
    });

    test('empty batch throws', () => {
        expect(() => est.batchAnalyze([])).toThrow('non-empty array');
    });

    test('skips invalid records', () => {
        const data = [null, { print_data: null }, sampleData[0]];
        const batch = est.batchAnalyze(data);
        expect(batch.count).toBe(1);
    });
});

// ── Parameter Sweep ─────────────────────────────────────────

describe('parameterSweep', () => {
    test('basic sweep', () => {
        const sweep = est.parameterSweep(
            { pressure: 80, nozzleDiameter: 0.4 },
            'pressure', { min: 20, max: 200 },
            'crosslinkIntensity', { min: 0, max: 100 },
            { resolution: 3 }
        );
        expect(sweep.param1).toBe('pressure');
        expect(sweep.param2).toBe('crosslinkIntensity');
        expect(sweep.resolution).toBe(3);
        expect(sweep.grid.length).toBe(4);  // resolution + 1
        expect(sweep.peak.viability).toBeGreaterThan(sweep.trough.viability);
    });

    test('peak at low pressure and low crosslink', () => {
        const sweep = est.parameterSweep(
            { pressure: 80, nozzleDiameter: 0.4 },
            'pressure', { min: 20, max: 200 },
            'crosslinkDuration', { min: 0, max: 30000 },
            { resolution: 5 }
        );
        expect(sweep.peak.pressure).toBeLessThanOrEqual(100);
        expect(sweep.peak.crosslinkDuration).toBeLessThanOrEqual(10000);
    });

    test('null range throws', () => {
        expect(() => {
            est.parameterSweep({pressure: 80}, 'pressure', null, 'crosslinkDuration', {min: 0, max: 100});
        }).toThrow('range1 must have numeric');
    });

    test('invalid resolution throws', () => {
        expect(() => {
            est.parameterSweep({pressure: 80}, 'pressure', {min: 0, max: 100},
                'crosslinkDuration', {min: 0, max: 100}, {resolution: 1});
        }).toThrow('between 2 and 50');
    });
});

// ── Calibration ─────────────────────────────────────────────

describe('calibrate', () => {
    test('basic calibration', () => {
        const cal = est.calibrate(sampleData, { steps: 2 });
        expect(cal.calibratedParams.pressure.p50).toBeGreaterThan(0);
        expect(cal.calibratedParams.crosslink.ec50).toBeGreaterThan(0);
        expect(cal.accuracy.rmse).toBeGreaterThanOrEqual(0);
        expect(cal.searchSpace.combinations).toBeGreaterThan(0);
    });

    test('too few records throws', () => {
        expect(() => est.calibrate(sampleData.slice(0, 3))).toThrow('at least 5 records');
    });
});

// ── Report Generation ───────────────────────────────────────

describe('generateReport', () => {
    test('basic report', () => {
        const report = est.generateReport({ pressure: 80 });
        expect(report.timestamp).toBeDefined();
        expect(report.estimation).toBeDefined();
        expect(Array.isArray(report.recommendations)).toBe(true);
        expect(report.sensitivity).toBeDefined();
    });

    test('excludes sensitivity when asked', () => {
        const report = est.generateReport({ pressure: 80 }, { includeSensitivity: false });
        expect(report.sensitivity).toBeFalsy();
    });

    test('extreme params trigger recommendations', () => {
        const report = est.generateReport({
            pressure: 200,
            crosslinkDuration: 25000,
            crosslinkIntensity: 80,
        }, { includeSensitivity: false });
        expect(report.recommendations.length).toBeGreaterThan(0);
        const hasShearOrPressure = report.recommendations.some(
            r => r.parameter === 'shear' || r.parameter === 'pressure'
        );
        expect(hasShearOrPressure).toBe(true);
    });
});

// ── Edge Cases ──────────────────────────────────────────────

describe('edge cases', () => {
    test('zero pressure gives near-max viability', () => {
        expect(est.estimate({ pressure: 0 }).viabilityPercent).toBeGreaterThan(90);
    });

    test('extreme pressure gives near-zero viability', () => {
        expect(est.estimate({ pressure: 500 }).viabilityPercent).toBeLessThan(10);
    });

    test('no crosslinking = 1.0 survival', () => {
        const result = est.estimate({ pressure: 80, crosslinkDuration: 0, crosslinkIntensity: 0 });
        expect(result.breakdown.crosslink).toBe(1);
    });

    test('multiplicative model check', () => {
        const result = est.estimate({ pressure: 80, crosslinkDuration: 5000, crosslinkIntensity: 20 });
        const expected = result.breakdown.baseline * result.breakdown.shear *
                         result.breakdown.pressure * result.breakdown.crosslink * 100;
        approx(result.viabilityPercent, expected, 0.1);
    });

    test('DEFAULT_PARAMS are frozen', () => {
        expect(Object.isFrozen(est.DEFAULT_PARAMS)).toBe(true);
        expect(Object.isFrozen(est.DEFAULT_PARAMS.shear)).toBe(true);
        expect(Object.isFrozen(est.DEFAULT_PARAMS.pressure)).toBe(true);
    });

    test('custom baseline with zero stress gives ~100%', () => {
        const result = est.estimate({ pressure: 0 }, { baseline: 1.0,
            shear: est.DEFAULT_PARAMS.shear,
            pressure: est.DEFAULT_PARAMS.pressure,
            crosslink: est.DEFAULT_PARAMS.crosslink });
        expect(result.viabilityPercent).toBeGreaterThan(95);
    });
});
