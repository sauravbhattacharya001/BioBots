'use strict';

const { createViabilityEstimator } = require('../docs/shared/viability');

describe('createViabilityEstimator', () => {
    let estimator;

    beforeEach(() => {
        estimator = createViabilityEstimator();
    });

    // ── Individual Damage Models ────────────────────────────────

    describe('estimateShearRate', () => {
        test('returns positive shear rate for typical pressure', () => {
            const rate = estimator.estimateShearRate({
                pressure: 80, nozzleDiameter: 0.4, flowRate: null
            });
            expect(rate).toBeGreaterThan(0);
            expect(typeof rate).toBe('number');
        });

        test('uses direct flow rate when provided', () => {
            const withFlow = estimator.estimateShearRate({
                pressure: 80, nozzleDiameter: 0.4, flowRate: 10
            });
            const withoutFlow = estimator.estimateShearRate({
                pressure: 80, nozzleDiameter: 0.4, flowRate: null
            });
            // Different calculation paths should give different results
            expect(withFlow).not.toBeCloseTo(withoutFlow, 0);
        });

        test('higher pressure yields higher shear rate', () => {
            const low = estimator.estimateShearRate({
                pressure: 40, nozzleDiameter: 0.4, flowRate: null
            });
            const high = estimator.estimateShearRate({
                pressure: 160, nozzleDiameter: 0.4, flowRate: null
            });
            expect(high).toBeGreaterThan(low);
        });

        test('smaller nozzle yields different shear rate (fixed pressure)', () => {
            const small = estimator.estimateShearRate({
                pressure: 80, nozzleDiameter: 0.2, flowRate: null
            });
            const large = estimator.estimateShearRate({
                pressure: 80, nozzleDiameter: 0.8, flowRate: null
            });
            // In pressure-based estimation, Hagen-Poiseuille gives Q ∝ R⁴
            // and γ̇ ∝ Q/D³ ∝ R⁴/D³ ∝ D, so larger nozzle → higher shear.
            // In flow-rate-based mode, γ̇ ∝ Q/D³ → smaller D → higher γ̇.
            expect(small).not.toBe(large);
        });
    });

    describe('shearSurvival', () => {
        test('returns 1.0 for zero shear rate', () => {
            expect(estimator.shearSurvival(0)).toBe(1.0);
        });

        test('returns 1.0 for negative shear rate', () => {
            expect(estimator.shearSurvival(-10)).toBe(1.0);
        });

        test('returns value between 0 and 1 for positive shear', () => {
            const s = estimator.shearSurvival(500);
            expect(s).toBeGreaterThan(0);
            expect(s).toBeLessThan(1);
        });

        test('decreases with increasing shear rate', () => {
            const low = estimator.shearSurvival(100);
            const high = estimator.shearSurvival(1000);
            expect(high).toBeLessThan(low);
        });

        test('accepts custom model parameters', () => {
            const defaultS = estimator.shearSurvival(500);
            const customS = estimator.shearSurvival(500, {
                alpha: 0.1, beta: 1.0, gammaCrit: 1000
            });
            expect(customS).not.toBeCloseTo(defaultS, 2);
        });
    });

    describe('pressureSurvival', () => {
        test('returns 1.0 for zero pressure', () => {
            expect(estimator.pressureSurvival(0)).toBe(1.0);
        });

        test('returns ~0.5 at p50 (150 kPa default)', () => {
            const s = estimator.pressureSurvival(150);
            expect(s).toBeCloseTo(0.5, 1);
        });

        test('decreases with increasing pressure', () => {
            const low = estimator.pressureSurvival(50);
            const high = estimator.pressureSurvival(250);
            expect(high).toBeLessThan(low);
        });

        test('returns value between 0 and 1', () => {
            const s = estimator.pressureSurvival(100);
            expect(s).toBeGreaterThan(0);
            expect(s).toBeLessThan(1);
        });
    });

    describe('crosslinkSurvival', () => {
        test('returns 1.0 for zero duration', () => {
            expect(estimator.crosslinkSurvival(0, 50)).toBe(1.0);
        });

        test('returns 1.0 for zero intensity', () => {
            expect(estimator.crosslinkSurvival(10000, 0)).toBe(1.0);
        });

        test('decreases with higher dose', () => {
            const low = estimator.crosslinkSurvival(5000, 10);
            const high = estimator.crosslinkSurvival(20000, 50);
            expect(high).toBeLessThan(low);
        });

        test('returns ~0.5 at EC50 dose', () => {
            // Default EC50=15000, n=2
            // Dose = duration * intensity = EC50 → 50% damage → 0.5 survival
            // With n=2: survival = 1 - EC50^2/(EC50^2 + EC50^2) = 0.5
            const s = estimator.crosslinkSurvival(150, 100);  // dose=15000
            expect(s).toBeCloseTo(0.5, 1);
        });
    });

    describe('thermalSurvival', () => {
        test('returns 1.0 at optimal temperature (37°C)', () => {
            const s = estimator.thermalSurvival(37);
            expect(s).toBeCloseTo(1.0, 4);
        });

        test('symmetric around optimal', () => {
            const below = estimator.thermalSurvival(32);
            const above = estimator.thermalSurvival(42);
            expect(below).toBeCloseTo(above, 4);
        });

        test('decreases further from optimal', () => {
            const near = estimator.thermalSurvival(35);
            const far = estimator.thermalSurvival(25);
            expect(far).toBeLessThan(near);
        });
    });

    describe('durationSurvival', () => {
        test('returns 1.0 for zero duration', () => {
            expect(estimator.durationSurvival(0)).toBe(1.0);
        });

        test('returns 1.0 for negative duration', () => {
            expect(estimator.durationSurvival(-10)).toBe(1.0);
        });

        test('decreases linearly with time', () => {
            const s1 = estimator.durationSurvival(200);
            const s2 = estimator.durationSurvival(400);
            // Linear: s2 should be approximately s1 - lambda*200
            expect(s2).toBeLessThan(s1);
        });

        test('bottoms out at 0', () => {
            const s = estimator.durationSurvival(2000);
            expect(s).toBe(0);
        });

        test('at maxTime (1000s) equals 0', () => {
            const s = estimator.durationSurvival(1000);
            expect(s).toBe(0);
        });
    });

    // ── Combined Estimation ─────────────────────────────────────

    describe('estimate', () => {
        test('returns viability for minimal params', () => {
            const result = estimator.estimate({ pressure: 80 });
            expect(result.viabilityPercent).toBeGreaterThan(0);
            expect(result.viabilityPercent).toBeLessThanOrEqual(100);
        });

        test('result has required fields', () => {
            const result = estimator.estimate({ pressure: 80 });
            expect(result).toHaveProperty('viabilityPercent');
            expect(result).toHaveProperty('quality');
            expect(result).toHaveProperty('breakdown');
            expect(result).toHaveProperty('estimatedShearRate');
            expect(result).toHaveProperty('limitingFactor');
            expect(result).toHaveProperty('limitingValue');
            expect(result).toHaveProperty('warnings');
            expect(result).toHaveProperty('params');
        });

        test('breakdown has all stressor components', () => {
            const result = estimator.estimate({
                pressure: 80,
                temperature: 37,
                printDuration: 300
            });
            expect(result.breakdown).toHaveProperty('baseline');
            expect(result.breakdown).toHaveProperty('shear');
            expect(result.breakdown).toHaveProperty('pressure');
            expect(result.breakdown).toHaveProperty('crosslink');
            expect(result.breakdown.thermal).not.toBeNull();
            expect(result.breakdown.duration).not.toBeNull();
        });

        test('thermal is null when temperature not provided', () => {
            const result = estimator.estimate({ pressure: 80 });
            expect(result.breakdown.thermal).toBeNull();
        });

        test('duration is null when printDuration not provided', () => {
            const result = estimator.estimate({ pressure: 80 });
            expect(result.breakdown.duration).toBeNull();
        });

        test('quality classification levels', () => {
            // Low pressure → high viability → excellent
            const excellent = estimator.estimate({ pressure: 10 });
            expect(['excellent', 'good']).toContain(excellent.quality);

            // Extreme pressure → low viability → poor/critical
            const poor = estimator.estimate({ pressure: 300 });
            expect(['poor', 'critical']).toContain(poor.quality);
        });

        test('generates warnings for extreme parameters', () => {
            const result = estimator.estimate({
                pressure: 250,
                crosslinkDuration: 25000,
                crosslinkIntensity: 80,
                temperature: 50,
                printDuration: 900
            });
            expect(result.warnings.length).toBeGreaterThan(0);
        });

        test('identifies limiting factor', () => {
            const result = estimator.estimate({
                pressure: 200,
                crosslinkDuration: 100,
                crosslinkIntensity: 5
            });
            // High pressure should make pressure or shear the limiting factor
            expect(['pressure', 'shear']).toContain(result.limitingFactor);
        });

        test('throws for missing parameters object', () => {
            expect(() => estimator.estimate(null)).toThrow();
        });

        test('throws for non-object parameters', () => {
            expect(() => estimator.estimate('invalid')).toThrow();
        });

        test('throws for negative pressure', () => {
            expect(() => estimator.estimate({ pressure: -10 })).toThrow();
        });

        test('throws for NaN pressure', () => {
            expect(() => estimator.estimate({ pressure: NaN })).toThrow();
        });

        test('defaults crosslink params when omitted', () => {
            const result = estimator.estimate({ pressure: 80 });
            // crosslink survival should be 1.0 (no crosslinking)
            expect(result.breakdown.crosslink).toBe(1);
        });

        test('custom model parameters override defaults', () => {
            const defaultResult = estimator.estimate({ pressure: 80 });
            const customResult = estimator.estimate({ pressure: 80 }, {
                baseline: 0.99,
                shear: { alpha: 0.1, beta: 1.0, gammaCrit: 1000 },
                pressure: { k: 0.02, p50: 200 },
                crosslink: { n: 2.0, ec50: 15000 },
                thermal: { optimal: 37, sigma: 5 },
                duration: { lambda: 0.001, maxTime: 1000 }
            });
            expect(customResult.viabilityPercent).not.toBeCloseTo(defaultResult.viabilityPercent, 0);
        });
    });

    // ── Sensitivity Analysis ────────────────────────────────────

    describe('sensitivityAnalysis', () => {
        test('returns curves for default parameters', () => {
            const result = estimator.sensitivityAnalysis({ pressure: 80 });
            expect(result).toHaveProperty('pressure');
            expect(result).toHaveProperty('crosslinkDuration');
            expect(result).toHaveProperty('crosslinkIntensity');
            expect(result).toHaveProperty('nozzleDiameter');
            expect(result).toHaveProperty('_ranking');
        });

        test('each parameter has curve and sensitivity index', () => {
            const result = estimator.sensitivityAnalysis({ pressure: 80 }, { steps: 5 });
            expect(result.pressure.curve.length).toBeGreaterThan(0);
            expect(typeof result.pressure.sensitivityIndex).toBe('number');
        });

        test('ranking is sorted by sensitivity', () => {
            const result = estimator.sensitivityAnalysis({ pressure: 80 }, { steps: 5 });
            const ranking = result._ranking;
            for (let i = 0; i < ranking.length - 1; i++) {
                expect(result[ranking[i]].sensitivityIndex)
                    .toBeGreaterThanOrEqual(result[ranking[i + 1]].sensitivityIndex);
            }
        });

        test('throws for invalid steps', () => {
            expect(() => estimator.sensitivityAnalysis({ pressure: 80 }, { steps: 1 })).toThrow();
            expect(() => estimator.sensitivityAnalysis({ pressure: 80 }, { steps: 201 })).toThrow();
        });
    });

    // ── Optimal Window Finder ───────────────────────────────────

    describe('findOptimalWindow', () => {
        const mockPrintData = [
            { print_data: { livePercent: 85 }, print_info: { pressure: { extruder1: 60, extruder2: 0 }, crosslinking: { cl_duration: 10000, cl_intensity: 30 }, resolution: { layerHeight: 0.4, layerNum: 10 } }, user_info: { serial: '001' } },
            { print_data: { livePercent: 72 }, print_info: { pressure: { extruder1: 100, extruder2: 0 }, crosslinking: { cl_duration: 15000, cl_intensity: 50 }, resolution: { layerHeight: 0.3, layerNum: 15 } }, user_info: { serial: '002' } },
            { print_data: { livePercent: 90 }, print_info: { pressure: { extruder1: 50, extruder2: 0 }, crosslinking: { cl_duration: 8000, cl_intensity: 25 }, resolution: { layerHeight: 0.5, layerNum: 8 } }, user_info: { serial: '003' } },
            { print_data: { livePercent: 65 }, print_info: { pressure: { extruder1: 120, extruder2: 0 }, crosslinking: { cl_duration: 20000, cl_intensity: 60 }, resolution: { layerHeight: 0.3, layerNum: 20 } }, user_info: { serial: '004' } },
            { print_data: { livePercent: 78 }, print_info: { pressure: { extruder1: 80, extruder2: 0 }, crosslinking: { cl_duration: 12000, cl_intensity: 40 }, resolution: { layerHeight: 0.4, layerNum: 12 } }, user_info: { serial: '005' } },
        ];

        test('returns optimal parameter ranges', () => {
            const result = estimator.findOptimalWindow(mockPrintData);
            expect(result.totalRecords).toBe(5);
            expect(result).toHaveProperty('optimalRanges');
            expect(result).toHaveProperty('viabilityStats');
            expect(result).toHaveProperty('recommendations');
        });

        test('top percentile count respects setting', () => {
            const result = estimator.findOptimalWindow(mockPrintData, { topPercentile: 50 });
            expect(result.topPercentileCount).toBeGreaterThanOrEqual(2);
        });

        test('above threshold count uses viability threshold', () => {
            const high = estimator.findOptimalWindow(mockPrintData, { viabilityThreshold: 90 });
            const low = estimator.findOptimalWindow(mockPrintData, { viabilityThreshold: 50 });
            expect(low.aboveThresholdCount).toBeGreaterThanOrEqual(high.aboveThresholdCount);
        });

        test('throws for empty array', () => {
            expect(() => estimator.findOptimalWindow([])).toThrow();
        });

        test('throws for non-array', () => {
            expect(() => estimator.findOptimalWindow('invalid')).toThrow();
        });

        test('generates recommendations', () => {
            const result = estimator.findOptimalWindow(mockPrintData);
            expect(result.recommendations.length).toBeGreaterThan(0);
        });
    });

    // ── Batch Analysis ──────────────────────────────────────────

    describe('batchAnalyze', () => {
        const mockPrintData = [
            { print_data: { livePercent: 85 }, print_info: { pressure: { extruder1: 60, extruder2: 0 }, crosslinking: { cl_duration: 10000, cl_intensity: 30 }, resolution: { layerHeight: 0.4 } }, user_info: { serial: '001' } },
            { print_data: { livePercent: 72 }, print_info: { pressure: { extruder1: 100, extruder2: 0 }, crosslinking: { cl_duration: 15000, cl_intensity: 50 }, resolution: { layerHeight: 0.3 } }, user_info: { serial: '002' } },
            { print_data: { livePercent: 90 }, print_info: { pressure: { extruder1: 50, extruder2: 0 }, crosslinking: { cl_duration: 8000, cl_intensity: 25 }, resolution: { layerHeight: 0.5 } }, user_info: { serial: '003' } },
        ];

        test('returns accuracy metrics', () => {
            const result = estimator.batchAnalyze(mockPrintData);
            expect(result.count).toBe(3);
            expect(result).toHaveProperty('accuracy');
            expect(result.accuracy).toHaveProperty('rmse');
            expect(result.accuracy).toHaveProperty('mae');
            expect(result.accuracy).toHaveProperty('correlation');
        });

        test('returns quality distribution', () => {
            const result = estimator.batchAnalyze(mockPrintData);
            expect(result).toHaveProperty('qualityDistribution');
            const dist = result.qualityDistribution;
            const total = dist.excellent + dist.good + dist.acceptable + dist.poor + dist.critical;
            expect(total).toBe(3);
        });

        test('returns limiting factor distribution', () => {
            const result = estimator.batchAnalyze(mockPrintData);
            expect(result).toHaveProperty('limitingFactorDistribution');
        });

        test('per-record results have expected fields', () => {
            const result = estimator.batchAnalyze(mockPrintData);
            const r = result.results[0];
            expect(r).toHaveProperty('serial');
            expect(r).toHaveProperty('predicted');
            expect(r).toHaveProperty('actual');
            expect(r).toHaveProperty('error');
            expect(r).toHaveProperty('absError');
            expect(r).toHaveProperty('quality');
            expect(r).toHaveProperty('limitingFactor');
        });

        test('skips records with missing data', () => {
            const dataWithBad = [
                ...mockPrintData,
                { print_data: null, print_info: null },
                null,
            ];
            const result = estimator.batchAnalyze(dataWithBad);
            expect(result.count).toBe(3);
        });

        test('throws for empty array', () => {
            expect(() => estimator.batchAnalyze([])).toThrow();
        });
    });

    // ── Parameter Sweep ─────────────────────────────────────────

    describe('parameterSweep', () => {
        test('produces grid with peak and trough', () => {
            const result = estimator.parameterSweep(
                { pressure: 80 },
                'pressure', { min: 20, max: 200 },
                'nozzleDiameter', { min: 0.1, max: 1.0 },
                { resolution: 5 }
            );
            expect(result).toHaveProperty('grid');
            expect(result).toHaveProperty('peak');
            expect(result).toHaveProperty('trough');
            expect(result.grid.length).toBe(6); // 6 rows for resolution=5
        });

        test('peak viability is higher than trough', () => {
            const result = estimator.parameterSweep(
                { pressure: 80 },
                'pressure', { min: 20, max: 200 },
                'nozzleDiameter', { min: 0.1, max: 1.0 },
                { resolution: 5 }
            );
            expect(result.peak.viability).toBeGreaterThan(result.trough.viability);
        });

        test('throws for invalid resolution', () => {
            expect(() => estimator.parameterSweep(
                { pressure: 80 },
                'pressure', { min: 20, max: 200 },
                'nozzleDiameter', { min: 0.1, max: 1.0 },
                { resolution: 1 }
            )).toThrow();
        });

        test('throws for invalid ranges', () => {
            expect(() => estimator.parameterSweep(
                { pressure: 80 },
                'pressure', 'invalid',
                'nozzleDiameter', { min: 0.1, max: 1.0 }
            )).toThrow();
        });
    });

    // ── Calibration ─────────────────────────────────────────────

    describe('calibrate', () => {
        const mockPrintData = [
            { print_data: { livePercent: 85 }, print_info: { pressure: { extruder1: 60, extruder2: 0 }, crosslinking: { cl_duration: 10000, cl_intensity: 30 }, resolution: { layerHeight: 0.4 } }, user_info: { serial: '001' } },
            { print_data: { livePercent: 72 }, print_info: { pressure: { extruder1: 100, extruder2: 0 }, crosslinking: { cl_duration: 15000, cl_intensity: 50 }, resolution: { layerHeight: 0.3 } }, user_info: { serial: '002' } },
            { print_data: { livePercent: 90 }, print_info: { pressure: { extruder1: 50, extruder2: 0 }, crosslinking: { cl_duration: 8000, cl_intensity: 25 }, resolution: { layerHeight: 0.5 } }, user_info: { serial: '003' } },
            { print_data: { livePercent: 65 }, print_info: { pressure: { extruder1: 120, extruder2: 0 }, crosslinking: { cl_duration: 20000, cl_intensity: 60 }, resolution: { layerHeight: 0.3 } }, user_info: { serial: '004' } },
            { print_data: { livePercent: 78 }, print_info: { pressure: { extruder1: 80, extruder2: 0 }, crosslinking: { cl_duration: 12000, cl_intensity: 40 }, resolution: { layerHeight: 0.4 } }, user_info: { serial: '005' } },
        ];

        test('returns calibrated parameters', () => {
            const result = estimator.calibrate(mockPrintData, { steps: 3 });
            expect(result).toHaveProperty('calibratedParams');
            expect(result.calibratedParams).toHaveProperty('pressure');
            expect(result.calibratedParams).toHaveProperty('crosslink');
        });

        test('returns accuracy metrics', () => {
            const result = estimator.calibrate(mockPrintData, { steps: 3 });
            expect(result.accuracy).toHaveProperty('rmse');
            expect(result.accuracy).toHaveProperty('mae');
            expect(result.accuracy).toHaveProperty('correlation');
        });

        test('returns search space info', () => {
            const result = estimator.calibrate(mockPrintData, { steps: 3 });
            expect(result.searchSpace.steps).toBe(3);
            expect(result.searchSpace.combinations).toBe(16); // (3+1)^2
        });

        test('throws for insufficient data', () => {
            expect(() => estimator.calibrate([
                mockPrintData[0], mockPrintData[1]
            ])).toThrow();
        });
    });

    // ── Report Generation ───────────────────────────────────────

    describe('generateReport', () => {
        test('includes estimation and recommendations', () => {
            const report = estimator.generateReport({ pressure: 80 });
            expect(report).toHaveProperty('timestamp');
            expect(report).toHaveProperty('estimation');
            expect(report).toHaveProperty('recommendations');
            expect(report.estimation).toHaveProperty('viabilityPercent');
        });

        test('includes sensitivity when not disabled', () => {
            const report = estimator.generateReport({ pressure: 80 });
            expect(report).toHaveProperty('sensitivity');
        });

        test('excludes sensitivity when disabled', () => {
            const report = estimator.generateReport({ pressure: 80 }, {
                includeSensitivity: false
            });
            expect(report.sensitivity).toBeUndefined();
        });

        test('generates recommendations for poor parameters', () => {
            const report = estimator.generateReport({
                pressure: 250,
                crosslinkDuration: 25000,
                crosslinkIntensity: 80
            });
            expect(report.recommendations.length).toBeGreaterThan(0);
        });
    });

    // ── Constants ───────────────────────────────────────────────

    describe('DEFAULT_PARAMS', () => {
        test('exposed and frozen', () => {
            const params = estimator.DEFAULT_PARAMS;
            expect(params).toHaveProperty('baseline');
            expect(params).toHaveProperty('shear');
            expect(params).toHaveProperty('pressure');
            expect(params).toHaveProperty('crosslink');
            expect(params).toHaveProperty('thermal');
            expect(params).toHaveProperty('duration');
            expect(Object.isFrozen(params)).toBe(true);
        });
    });

    // ── Edge Cases ──────────────────────────────────────────────

    describe('edge cases', () => {
        test('estimate with all optional params', () => {
            const result = estimator.estimate({
                pressure: 80,
                crosslinkDuration: 10000,
                crosslinkIntensity: 30,
                layerHeight: 0.4,
                nozzleDiameter: 0.4,
                temperature: 37,
                printDuration: 600,
                flowRate: 5
            });
            expect(result.viabilityPercent).toBeGreaterThan(0);
            expect(result.breakdown.thermal).not.toBeNull();
            expect(result.breakdown.duration).not.toBeNull();
        });

        test('very high pressure gives very low viability', () => {
            const result = estimator.estimate({ pressure: 500 });
            expect(result.viabilityPercent).toBeLessThan(20);
        });

        test('at optimal conditions viability is near baseline', () => {
            const result = estimator.estimate({
                pressure: 10,
                nozzleDiameter: 2.0,
                temperature: 37
            });
            // Low pressure, wide nozzle, optimal temp → near baseline (95%)
            expect(result.viabilityPercent).toBeGreaterThan(80);
        });

        test('multiplicative combination of stressors', () => {
            // Each stressor should reduce viability independently
            const noStress = estimator.estimate({ pressure: 10 });
            const withCrosslink = estimator.estimate({
                pressure: 10,
                crosslinkDuration: 15000,
                crosslinkIntensity: 50
            });
            expect(withCrosslink.viabilityPercent).toBeLessThan(noStress.viabilityPercent);
        });
    });
});
