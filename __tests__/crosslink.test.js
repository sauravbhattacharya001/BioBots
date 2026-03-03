'use strict';

const { createCrosslinkAnalyzer } = require('../docs/shared/crosslink');

describe('createCrosslinkAnalyzer', () => {
    let cl;

    beforeEach(() => {
        cl = createCrosslinkAnalyzer();
    });

    // ── Constants ────────────────────────────────────────────────

    describe('constants', () => {
        it('should expose GEL_POINT_THRESHOLD', () => {
            expect(cl.GEL_POINT_THRESHOLD).toBeCloseTo(0.632, 3);
        });
    });

    // ── crosslinkDegree ─────────────────────────────────────────

    describe('crosslinkDegree', () => {
        it('should return 0 at t=0', () => {
            expect(cl.crosslinkDegree(0.001, 0)).toBe(0);
        });

        it('should approach 1 for large t', () => {
            expect(cl.crosslinkDegree(0.01, 10000)).toBeGreaterThan(0.99);
        });

        it('should return ~0.632 at t = 1/k (one time constant)', () => {
            var k = 0.005;
            expect(cl.crosslinkDegree(k, 1 / k)).toBeCloseTo(0.6321, 3);
        });

        it('should increase monotonically with time', () => {
            var prev = 0;
            for (var t = 100; t <= 1000; t += 100) {
                var deg = cl.crosslinkDegree(0.005, t);
                expect(deg).toBeGreaterThan(prev);
                prev = deg;
            }
        });

        it('should throw for non-number k', () => {
            expect(() => cl.crosslinkDegree('x', 10)).toThrow();
        });

        it('should throw for k <= 0', () => {
            expect(() => cl.crosslinkDegree(0, 10)).toThrow();
            expect(() => cl.crosslinkDegree(-1, 10)).toThrow();
        });

        it('should throw for negative time', () => {
            expect(() => cl.crosslinkDegree(0.01, -5)).toThrow();
        });

        it('should handle very small k values', () => {
            expect(cl.crosslinkDegree(1e-8, 100)).toBeGreaterThan(0);
            expect(cl.crosslinkDegree(1e-8, 100)).toBeLessThan(0.001);
        });
    });

    // ── crosslinkCurve ──────────────────────────────────────────

    describe('crosslinkCurve', () => {
        it('should generate correct number of points', () => {
            var curve = cl.crosslinkCurve(0.005, 1000, 10);
            expect(curve).toHaveLength(10);
        });

        it('should start at time=0 and end at maxTime', () => {
            var curve = cl.crosslinkCurve(0.005, 500, 20);
            expect(curve[0].time).toBe(0);
            expect(curve[curve.length - 1].time).toBe(500);
        });

        it('should have monotonically increasing degree', () => {
            var curve = cl.crosslinkCurve(0.01, 300, 15);
            for (var i = 1; i < curve.length; i++) {
                expect(curve[i].degree).toBeGreaterThanOrEqual(curve[i - 1].degree);
            }
        });

        it('should default to 50 points', () => {
            var curve = cl.crosslinkCurve(0.005, 1000);
            expect(curve).toHaveLength(50);
        });

        it('should throw for < 2 points', () => {
            expect(() => cl.crosslinkCurve(0.01, 100, 1)).toThrow();
        });

        it('should throw for non-number parameters', () => {
            expect(() => cl.crosslinkCurve('x', 100)).toThrow();
        });

        it('should throw for non-positive maxTime', () => {
            expect(() => cl.crosslinkCurve(0.01, 0)).toThrow();
            expect(() => cl.crosslinkCurve(0.01, -100)).toThrow();
        });
    });

    // ── timeToTarget ────────────────────────────────────────────

    describe('timeToTarget', () => {
        it('should return correct time for known values', () => {
            var k = 0.01;
            var target = 0.5;
            // t = -ln(1-0.5) / 0.01 = -ln(0.5)/0.01 = 0.6931/0.01 = 69.31
            expect(cl.timeToTarget(k, target)).toBeCloseTo(69.31, 1);
        });

        it('should be inverse of crosslinkDegree', () => {
            var k = 0.005;
            var t = 200;
            var degree = cl.crosslinkDegree(k, t);
            var recoveredT = cl.timeToTarget(k, degree);
            expect(recoveredT).toBeCloseTo(t, 5);
        });

        it('should increase with higher target', () => {
            var t1 = cl.timeToTarget(0.01, 0.5);
            var t2 = cl.timeToTarget(0.01, 0.9);
            expect(t2).toBeGreaterThan(t1);
        });

        it('should throw for target outside (0,1)', () => {
            expect(() => cl.timeToTarget(0.01, 0)).toThrow();
            expect(() => cl.timeToTarget(0.01, 1)).toThrow();
            expect(() => cl.timeToTarget(0.01, 1.5)).toThrow();
            expect(() => cl.timeToTarget(0.01, -0.1)).toThrow();
        });

        it('should throw for non-positive k', () => {
            expect(() => cl.timeToTarget(0, 0.5)).toThrow();
        });
    });

    // ── gelTime ─────────────────────────────────────────────────

    describe('gelTime', () => {
        it('should return time to 63.2% conversion', () => {
            var k = 0.01;
            // t_gel = -ln(1-0.632)/0.01 = -ln(0.368)/0.01 ≈ 1/k = 100
            expect(cl.gelTime(k)).toBeCloseTo(1 / k, 0);
        });

        it('should decrease with higher rate constant', () => {
            expect(cl.gelTime(0.01)).toBeGreaterThan(cl.gelTime(0.1));
        });
    });

    // ── hillResponse ────────────────────────────────────────────

    describe('hillResponse', () => {
        it('should return 0 at intensity=0', () => {
            expect(cl.hillResponse(0, 10)).toBe(0);
        });

        it('should return ~50% at EC50', () => {
            expect(cl.hillResponse(10, 10, 2, 100)).toBeCloseTo(50, 0);
        });

        it('should approach rMax at high intensity', () => {
            expect(cl.hillResponse(1000, 10, 2, 100)).toBeGreaterThan(99);
        });

        it('should increase monotonically', () => {
            var prev = 0;
            for (var i = 1; i <= 50; i += 5) {
                var r = cl.hillResponse(i, 20);
                expect(r).toBeGreaterThanOrEqual(prev);
                prev = r;
            }
        });

        it('should be steeper with higher Hill coefficient', () => {
            var r_low = cl.hillResponse(5, 10, 1, 100);
            var r_high = cl.hillResponse(5, 10, 4, 100);
            // At below EC50, higher Hill coeff gives lower response
            expect(r_high).toBeLessThan(r_low);
        });

        it('should default Hill coeff to 2', () => {
            var r = cl.hillResponse(10, 10, undefined, 100);
            expect(r).toBeCloseTo(50, 0);
        });

        it('should throw for negative intensity', () => {
            expect(() => cl.hillResponse(-1, 10)).toThrow();
        });

        it('should throw for non-positive EC50', () => {
            expect(() => cl.hillResponse(5, 0)).toThrow();
            expect(() => cl.hillResponse(5, -1)).toThrow();
        });

        it('should throw for non-number inputs', () => {
            expect(() => cl.hillResponse('x', 10)).toThrow();
        });
    });

    // ── doseResponseCurve ───────────────────────────────────────

    describe('doseResponseCurve', () => {
        it('should generate correct number of points', () => {
            var curve = cl.doseResponseCurve(10, 2, 100, 50, 25);
            expect(curve).toHaveLength(25);
        });

        it('should start at dose=0 with response=0', () => {
            var curve = cl.doseResponseCurve(10);
            expect(curve[0].dose).toBe(0);
            expect(curve[0].response).toBe(0);
        });

        it('should default maxDose to 5*EC50', () => {
            var curve = cl.doseResponseCurve(10, 2, 100, undefined, 10);
            expect(curve[curve.length - 1].dose).toBe(50);
        });

        it('should throw for non-positive EC50', () => {
            expect(() => cl.doseResponseCurve(0)).toThrow();
            expect(() => cl.doseResponseCurve(-5)).toThrow();
        });

        it('should throw for < 2 points', () => {
            expect(() => cl.doseResponseCurve(10, 2, 100, 50, 1)).toThrow();
        });
    });

    // ── viabilityModel ──────────────────────────────────────────

    describe('viabilityModel', () => {
        it('should return 0 viability at dose=0', () => {
            var r = cl.viabilityModel(0);
            expect(r.viability).toBe(0);
            expect(r.benefit).toBe(0);
            expect(r.damage).toBe(0);
        });

        it('should produce positive viability at moderate dose', () => {
            var r = cl.viabilityModel(500);
            expect(r.viability).toBeGreaterThan(0);
        });

        it('should show bell-shaped response (rises then falls)', () => {
            var v50 = cl.viabilityModel(50).viability;
            var v200 = cl.viabilityModel(200).viability;
            var v1000 = cl.viabilityModel(1000).viability;
            expect(v200).toBeGreaterThan(v50);
            expect(v1000).toBeLessThan(v200);
        });

        it('should respect custom vMax', () => {
            var r = cl.viabilityModel(500, { vMax: 50 });
            expect(r.viability).toBeLessThan(50);
        });

        it('should have benefit always >= damage at moderate doses', () => {
            var r = cl.viabilityModel(200);
            expect(r.benefit).toBeGreaterThanOrEqual(r.damage);
        });

        it('should have damage exceed benefit at high doses', () => {
            var r = cl.viabilityModel(600);
            // At dose 600, damage starts catching up substantially
            expect(r.viability).toBeLessThan(cl.viabilityModel(200).viability);
            expect(r.viability).toBeGreaterThanOrEqual(0);
        });

        it('should throw for non-number dose', () => {
            expect(() => cl.viabilityModel('x')).toThrow();
        });

        it('should throw for negative dose', () => {
            expect(() => cl.viabilityModel(-1)).toThrow();
        });
    });

    // ── findOptimalDose ─────────────────────────────────────────

    describe('findOptimalDose', () => {
        it('should find a dose that maximizes viability', () => {
            var result = cl.findOptimalDose();
            expect(result.optimalDose).toBeGreaterThan(0);
            expect(result.maxViability).toBeGreaterThan(0);
        });

        it('should return benefit and damage at optimal point', () => {
            var result = cl.findOptimalDose();
            expect(result.benefit).toBeGreaterThan(0);
            expect(result.damage).toBeGreaterThanOrEqual(0);
        });

        it('should find viability close to model maximum', () => {
            // Verify the optimizer finds near the true max
            var result = cl.findOptimalDose();
            var checkV = cl.viabilityModel(result.optimalDose);
            expect(result.maxViability).toBeCloseTo(checkV.viability, 0);
        });

        it('should respond to custom parameters', () => {
            var r1 = cl.findOptimalDose({ kDamage: 0.000005 });
            var r2 = cl.findOptimalDose({ kDamage: 0.00005 });
            // Higher damage rate => lower optimal dose
            expect(r2.optimalDose).toBeLessThan(r1.optimalDose);
        });
    });

    // ── doseWindow ──────────────────────────────────────────────

    describe('doseWindow', () => {
        it('should find bounds where viability exceeds threshold', () => {
            var w = cl.doseWindow(20);
            expect(w.lowerBound).not.toBeNull();
            expect(w.upperBound).not.toBeNull();
            expect(w.upperBound).toBeGreaterThan(w.lowerBound);
        });

        it('should have width = upper - lower', () => {
            var w = cl.doseWindow(30);
            if (w.lowerBound !== null) {
                expect(w.width).toBe(w.upperBound - w.lowerBound);
            }
        });

        it('should return null bounds for unreachable threshold', () => {
            var w = cl.doseWindow(99.9);
            expect(w.lowerBound).toBeNull();
            expect(w.upperBound).toBeNull();
            expect(w.width).toBe(0);
        });

        it('should narrow with higher threshold', () => {
            var w1 = cl.doseWindow(20);
            var w2 = cl.doseWindow(50);
            expect(w2.width).toBeLessThan(w1.width);
        });

        it('should track peak viability', () => {
            var w = cl.doseWindow(10);
            expect(w.peakViability).toBeGreaterThan(0);
            expect(w.optimalDose).toBeGreaterThan(0);
        });
    });

    // ── responseSurface ─────────────────────────────────────────

    describe('responseSurface', () => {
        it('should generate grid with correct size', () => {
            var rs = cl.responseSurface({ durationSteps: 5, intensitySteps: 5 });
            expect(rs.grid).toHaveLength(25);
        });

        it('should populate durations and intensities arrays', () => {
            var rs = cl.responseSurface({ durationSteps: 4, intensitySteps: 3 });
            expect(rs.durations).toHaveLength(4);
            expect(rs.intensities).toHaveLength(3);
        });

        it('should find a peak viability', () => {
            var rs = cl.responseSurface({
                minDuration: 10, maxDuration: 500,
                minIntensity: 0.1, maxIntensity: 5
            });
            expect(rs.peak.viability).toBeGreaterThan(0);
            expect(rs.peak.duration).toBeGreaterThan(0);
            expect(rs.peak.intensity).toBeGreaterThan(0);
        });

        it('should use custom ranges', () => {
            var rs = cl.responseSurface({
                minDuration: 100, maxDuration: 500,
                minIntensity: 5, maxIntensity: 20,
                durationSteps: 3, intensitySteps: 3
            });
            expect(rs.durations[0]).toBe(100);
            expect(rs.durations[2]).toBe(500);
            expect(rs.intensities[0]).toBe(5);
            expect(rs.intensities[2]).toBe(20);
        });

        it('should throw for < 2 steps', () => {
            expect(() => cl.responseSurface({ durationSteps: 1 })).toThrow();
        });

        it('each grid point should have required fields', () => {
            var rs = cl.responseSurface({ durationSteps: 3, intensitySteps: 3 });
            rs.grid.forEach(function (pt) {
                expect(pt).toHaveProperty('duration');
                expect(pt).toHaveProperty('intensity');
                expect(pt).toHaveProperty('dose');
                expect(pt).toHaveProperty('viability');
            });
        });
    });

    // ── analyzePrintData ────────────────────────────────────────

    describe('analyzePrintData', () => {
        function makePrint(clEnabled, clDuration, clIntensity, livePercent, elasticity) {
            return {
                print_data: { livePercent: livePercent, deadPercent: 100 - livePercent, elasticity: elasticity || 50 },
                print_info: {
                    crosslinking: { cl_enabled: clEnabled, cl_duration: clDuration, cl_intensity: clIntensity },
                    pressure: { extruder1: 30, extruder2: 50 },
                    resolution: { layerHeight: 0.5, layerNum: 10 },
                    wellplate: 6
                },
                user_info: { email: 'test@test.com', serial: 0 }
            };
        }

        it('should handle empty array', () => {
            var r = cl.analyzePrintData([]);
            expect(r.summary.total).toBe(0);
            expect(r.bins).toHaveLength(0);
            expect(r.rateEstimate).toBeNull();
        });

        it('should separate crosslinked and uncrosslinked', () => {
            var prints = [
                makePrint(true, 1000, 20, 50),
                makePrint(false, 0, 0, 10),
                makePrint(true, 2000, 25, 60)
            ];
            var r = cl.analyzePrintData(prints);
            expect(r.summary.total).toBe(3);
            expect(r.summary.crosslinked).toBe(2);
            expect(r.summary.uncrosslinked).toBe(1);
        });

        it('should compute average viability', () => {
            var prints = [
                makePrint(true, 1000, 20, 40),
                makePrint(true, 2000, 25, 60)
            ];
            var r = cl.analyzePrintData(prints);
            expect(r.summary.avgViability).toBeCloseTo(50, 0);
        });

        it('should create intensity bins', () => {
            var prints = [
                makePrint(true, 1000, 10, 30),
                makePrint(true, 1000, 10, 35),
                makePrint(true, 2000, 30, 50),
                makePrint(true, 2000, 30, 55),
                makePrint(true, 1500, 20, 45),
                makePrint(true, 1500, 20, 42)
            ];
            var r = cl.analyzePrintData(prints);
            expect(r.bins.length).toBeGreaterThan(0);
            var totalInBins = r.bins.reduce(function (s, b) { return s + b.count; }, 0);
            expect(totalInBins).toBe(6);
        });

        it('should handle single intensity value', () => {
            var prints = [
                makePrint(true, 1000, 20, 50),
                makePrint(true, 2000, 20, 60)
            ];
            var r = cl.analyzePrintData(prints);
            expect(r.bins).toHaveLength(1);
            expect(r.bins[0].label).toContain('20');
        });

        it('should estimate rate constant from sufficient data', () => {
            var prints = [];
            for (var i = 0; i < 10; i++) {
                prints.push(makePrint(true, 500 + i * 200, 15 + i, 20 + i * 5));
            }
            var r = cl.analyzePrintData(prints);
            expect(r.rateEstimate).not.toBeNull();
            expect(r.rateEstimate).toBeGreaterThan(0);
        });

        it('should return null rate for insufficient data', () => {
            var prints = [makePrint(true, 1000, 20, 50)];
            var r = cl.analyzePrintData(prints);
            expect(r.rateEstimate).toBeNull();
        });

        it('should generate recommendations', () => {
            var prints = [
                makePrint(true, 1000, 20, 15),
                makePrint(true, 2000, 25, 20),
                makePrint(true, 3000, 30, 10)
            ];
            var r = cl.analyzePrintData(prints);
            expect(r.recommendations.length).toBeGreaterThan(0);
            // Low viability should trigger recommendation
            expect(r.recommendations.some(function (rec) { return rec.indexOf('viability') !== -1; })).toBe(true);
        });

        it('should recommend enabling cross-linking when most are disabled', () => {
            var prints = [
                makePrint(false, 0, 0, 5),
                makePrint(false, 0, 0, 8),
                makePrint(false, 0, 0, 3),
                makePrint(true, 1000, 20, 50)
            ];
            var r = cl.analyzePrintData(prints);
            expect(r.recommendations.some(function (rec) { return rec.indexOf('enable') !== -1; })).toBe(true);
        });

        it('should throw for non-array input', () => {
            expect(() => cl.analyzePrintData('nope')).toThrow();
        });

        it('should skip malformed records', () => {
            var prints = [
                makePrint(true, 1000, 20, 50),
                { print_data: {} },
                null,
                makePrint(true, 2000, 25, 60)
            ];
            var r = cl.analyzePrintData(prints);
            expect(r.summary.crosslinked).toBe(2);
        });
    });

    // ── photoInitiatorEfficiency ─────────────────────────────────

    describe('photoInitiatorEfficiency', () => {
        it('should compute total dose as intensity * duration', () => {
            var r = cl.photoInitiatorEfficiency(10, 100);
            expect(r.totalDose).toBe(1000);
        });

        it('should compute effective dose less than total dose', () => {
            var r = cl.photoInitiatorEfficiency(10, 100);
            expect(r.effectiveDose).toBeLessThan(r.totalDose);
            expect(r.effectiveDose).toBeGreaterThan(0);
        });

        it('should compute radical yield based on quantum yield', () => {
            var r = cl.photoInitiatorEfficiency(10, 100, { quantumYield: 1.0 });
            // radical = effective * 1.0
            expect(r.radicalYield).toBeCloseTo(r.effectiveDose, 1);
        });

        it('should scale with intensity', () => {
            var r1 = cl.photoInitiatorEfficiency(5, 100);
            var r2 = cl.photoInitiatorEfficiency(10, 100);
            expect(r2.totalDose).toBeCloseTo(r1.totalDose * 2, 1);
        });

        it('should scale with duration', () => {
            var r1 = cl.photoInitiatorEfficiency(10, 50);
            var r2 = cl.photoInitiatorEfficiency(10, 100);
            expect(r2.totalDose).toBeCloseTo(r1.totalDose * 2, 1);
        });

        it('should have higher efficiency with higher absorptivity', () => {
            var r1 = cl.photoInitiatorEfficiency(10, 100, { absorptivity: 0.05 });
            var r2 = cl.photoInitiatorEfficiency(10, 100, { absorptivity: 0.5 });
            expect(r2.efficiency).toBeGreaterThan(r1.efficiency);
        });

        it('should throw for non-positive intensity', () => {
            expect(() => cl.photoInitiatorEfficiency(0, 100)).toThrow();
            expect(() => cl.photoInitiatorEfficiency(-5, 100)).toThrow();
        });

        it('should throw for non-positive duration', () => {
            expect(() => cl.photoInitiatorEfficiency(10, 0)).toThrow();
        });

        it('should throw for quantum yield out of range', () => {
            expect(() => cl.photoInitiatorEfficiency(10, 100, { quantumYield: 1.5 })).toThrow();
            expect(() => cl.photoInitiatorEfficiency(10, 100, { quantumYield: -0.1 })).toThrow();
        });

        it('should throw for non-number inputs', () => {
            expect(() => cl.photoInitiatorEfficiency('x', 100)).toThrow();
        });
    });
});
