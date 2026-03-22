'use strict';

const { createRheologyModeler } = require('../docs/shared/rheology');

describe('createRheologyModeler', () => {
    let rheo;

    beforeEach(() => {
        rheo = createRheologyModeler();
    });

    // ── Power Law Model ─────────────────────────────────────────

    describe('powerLawViscosity', () => {
        it('should compute Newtonian viscosity when n=1', () => {
            // η = K · γ̇^(1-1) = K
            expect(rheo.powerLawViscosity(10, 1, 100)).toBeCloseTo(10, 5);
        });

        it('should compute shear-thinning viscosity (n<1)', () => {
            // η = 50 · 100^(0.5-1) = 50 · 100^(-0.5) = 50/10 = 5
            expect(rheo.powerLawViscosity(50, 0.5, 100)).toBeCloseTo(5, 5);
        });

        it('should compute shear-thickening viscosity (n>1)', () => {
            // η = 10 · 100^(1.5-1) = 10 · 100^0.5 = 10 · 10 = 100
            expect(rheo.powerLawViscosity(10, 1.5, 100)).toBeCloseTo(100, 5);
        });

        it('should decrease with increasing shear rate for n<1', () => {
            const v1 = rheo.powerLawViscosity(50, 0.4, 10);
            const v2 = rheo.powerLawViscosity(50, 0.4, 100);
            expect(v1).toBeGreaterThan(v2);
        });

        it('should increase with increasing shear rate for n>1', () => {
            const v1 = rheo.powerLawViscosity(10, 1.3, 10);
            const v2 = rheo.powerLawViscosity(10, 1.3, 100);
            expect(v1).toBeLessThan(v2);
        });

        it('should throw for non-number K', () => {
            expect(() => rheo.powerLawViscosity('5', 1, 100)).toThrow('numbers');
        });

        it('should throw for K <= 0', () => {
            expect(() => rheo.powerLawViscosity(0, 1, 100)).toThrow('positive');
            expect(() => rheo.powerLawViscosity(-1, 1, 100)).toThrow('positive');
        });

        it('should throw for shearRate <= 0', () => {
            expect(() => rheo.powerLawViscosity(10, 1, 0)).toThrow('positive');
        });
    });

    describe('powerLawCurve', () => {
        it('should generate requested number of points', () => {
            const curve = rheo.powerLawCurve(50, 0.5, 1, 1000, 20);
            expect(curve.length).toBe(20);
        });

        it('should span min to max shear rate (log-spaced)', () => {
            const curve = rheo.powerLawCurve(50, 0.5, 0.1, 1000, 10);
            expect(curve[0].shearRate).toBeCloseTo(0.1, 5);
            expect(curve[curve.length - 1].shearRate).toBeCloseTo(1000, 2);
        });

        it('should use defaults for optional params', () => {
            const curve = rheo.powerLawCurve(50, 0.5);
            expect(curve.length).toBe(50);
            expect(curve[0].shearRate).toBeCloseTo(0.1, 5);
        });

        it('should throw if minRate >= maxRate', () => {
            expect(() => rheo.powerLawCurve(50, 0.5, 100, 10)).toThrow();
        });

        it('should throw if points < 2', () => {
            expect(() => rheo.powerLawCurve(50, 0.5, 1, 100, 1)).toThrow();
        });

        it('should show decreasing viscosity for shear-thinning', () => {
            const curve = rheo.powerLawCurve(50, 0.4, 1, 1000, 10);
            for (let i = 1; i < curve.length; i++) {
                expect(curve[i].viscosity).toBeLessThan(curve[i - 1].viscosity);
            }
        });
    });

    describe('fitPowerLaw', () => {
        it('should recover known K and n from synthetic data', () => {
            const trueK = 50, trueN = 0.5;
            const data = [1, 10, 100, 1000].map(r => ({
                shearRate: r,
                viscosity: trueK * Math.pow(r, trueN - 1)
            }));

            const fit = rheo.fitPowerLaw(data);
            expect(fit.K).toBeCloseTo(trueK, 2);
            expect(fit.n).toBeCloseTo(trueN, 5);
            expect(fit.rSquared).toBeCloseTo(1, 5);
        });

        it('should return rSquared < 1 for noisy data', () => {
            const data = [
                { shearRate: 1, viscosity: 50 },
                { shearRate: 10, viscosity: 18 },
                { shearRate: 100, viscosity: 3 },
                { shearRate: 1000, viscosity: 0.8 },
            ];
            const fit = rheo.fitPowerLaw(data);
            expect(fit.rSquared).toBeLessThan(1);
            expect(fit.rSquared).toBeGreaterThan(0.9);
        });

        it('should throw for < 2 data points', () => {
            expect(() => rheo.fitPowerLaw([{ shearRate: 1, viscosity: 10 }])).toThrow();
        });

        it('should throw for non-array', () => {
            expect(() => rheo.fitPowerLaw(null)).toThrow();
        });

        it('should throw for identical shear rates (degenerate data)', () => {
            const data = [
                { shearRate: 10, viscosity: 50 },
                { shearRate: 10, viscosity: 40 },
                { shearRate: 10, viscosity: 30 },
            ];
            expect(() => rheo.fitPowerLaw(data)).toThrow('Degenerate data');
        });

        it('should filter out invalid data points', () => {
            const data = [
                { shearRate: 1, viscosity: 50 },
                { shearRate: -1, viscosity: 10 },
                { shearRate: 10, viscosity: 0 },
                { shearRate: 100, viscosity: 5 },
            ];
            const fit = rheo.fitPowerLaw(data);
            expect(fit).toHaveProperty('K');
            expect(fit).toHaveProperty('n');
        });

        it('should detect Newtonian fluid (n ≈ 1)', () => {
            const data = [1, 10, 100, 1000].map(r => ({
                shearRate: r,
                viscosity: 25 // constant viscosity = Newtonian
            }));
            const fit = rheo.fitPowerLaw(data);
            expect(fit.n).toBeCloseTo(1, 3);
        });
    });

    // ── Cross Model ─────────────────────────────────────────────

    describe('crossViscosity', () => {
        it('should return eta0 at zero shear rate', () => {
            expect(rheo.crossViscosity(1000, 1, 0.1, 0.8, 0)).toBe(1000);
        });

        it('should approach etaInf at very high shear rate', () => {
            const v = rheo.crossViscosity(1000, 1, 0.1, 0.8, 1e8);
            expect(v).toBeCloseTo(1, 0);
        });

        it('should be between eta0 and etaInf for moderate rates', () => {
            const v = rheo.crossViscosity(1000, 1, 0.1, 0.8, 10);
            expect(v).toBeGreaterThan(1);
            expect(v).toBeLessThan(1000);
        });

        it('should decrease monotonically with shear rate', () => {
            const rates = [0.01, 0.1, 1, 10, 100, 1000];
            let prev = Infinity;
            for (const r of rates) {
                const v = rheo.crossViscosity(1000, 1, 0.1, 0.8, r);
                expect(v).toBeLessThanOrEqual(prev);
                prev = v;
            }
        });

        it('should throw for eta0 <= 0', () => {
            expect(() => rheo.crossViscosity(0, 1, 0.1, 0.8, 10)).toThrow('positive');
        });

        it('should throw for eta0 < etaInf', () => {
            expect(() => rheo.crossViscosity(1, 100, 0.1, 0.8, 10)).toThrow();
        });

        it('should throw for negative shear rate', () => {
            expect(() => rheo.crossViscosity(1000, 1, 0.1, 0.8, -5)).toThrow();
        });
    });

    describe('crossCurve', () => {
        it('should generate correct number of points', () => {
            const curve = rheo.crossCurve(1000, 1, 0.1, 0.8, 0.01, 10000, 30);
            expect(curve.length).toBe(30);
        });

        it('should show sigmoid-like drop in log-log space', () => {
            const curve = rheo.crossCurve(1000, 1, 0.1, 0.8, 0.01, 10000, 50);
            expect(curve[0].viscosity).toBeGreaterThan(curve[curve.length - 1].viscosity);
        });
    });

    // ── Herschel-Bulkley Model ──────────────────────────────────

    describe('herschelBulkleyStress', () => {
        it('should equal yield stress at zero shear rate', () => {
            expect(rheo.herschelBulkleyStress(50, 10, 0.5, 0)).toBe(50);
        });

        it('should increase with shear rate', () => {
            const s1 = rheo.herschelBulkleyStress(50, 10, 0.5, 10);
            const s2 = rheo.herschelBulkleyStress(50, 10, 0.5, 100);
            expect(s2).toBeGreaterThan(s1);
        });

        it('should reduce to Power Law when yieldStress=0', () => {
            // τ = 0 + K · γ̇^n = K · γ̇^n
            const stress = rheo.herschelBulkleyStress(0, 10, 0.5, 100);
            expect(stress).toBeCloseTo(10 * Math.pow(100, 0.5), 5);
        });

        it('should throw for negative yield stress', () => {
            expect(() => rheo.herschelBulkleyStress(-10, 10, 0.5, 100)).toThrow();
        });

        it('should throw for K <= 0', () => {
            expect(() => rheo.herschelBulkleyStress(50, 0, 0.5, 100)).toThrow();
        });
    });

    describe('herschelBulkleyViscosity', () => {
        it('should be high at low shear rate (yield stress dominates)', () => {
            const v = rheo.herschelBulkleyViscosity(100, 10, 0.5, 0.1);
            expect(v).toBeGreaterThan(500);
        });

        it('should approach power law viscosity at high shear rate', () => {
            // At high γ̇, τ_y/γ̇ → 0, so η_app → K · γ̇^(n-1)
            const vHB = rheo.herschelBulkleyViscosity(10, 50, 0.5, 10000);
            const vPL = rheo.powerLawViscosity(50, 0.5, 10000);
            expect(vHB).toBeCloseTo(vPL, 0);
        });

        it('should throw for shearRate <= 0', () => {
            expect(() => rheo.herschelBulkleyViscosity(50, 10, 0.5, 0)).toThrow();
        });
    });

    // ── Nozzle Shear Rate ───────────────────────────────────────

    describe('nozzleShearRate', () => {
        it('should compute Newtonian shear rate when n=1', () => {
            // Correction factor = (3+1)/(4) = 1 for n=1
            const rate = rheo.nozzleShearRate(0.1, 0.4, 1);
            expect(rate).toBeGreaterThan(0);
            expect(typeof rate).toBe('number');
        });

        it('should increase with higher flow rate', () => {
            const r1 = rheo.nozzleShearRate(0.1, 0.4, 0.5);
            const r2 = rheo.nozzleShearRate(0.5, 0.4, 0.5);
            expect(r2).toBeGreaterThan(r1);
        });

        it('should increase with smaller nozzle diameter', () => {
            const r1 = rheo.nozzleShearRate(0.1, 0.8, 0.5);
            const r2 = rheo.nozzleShearRate(0.1, 0.4, 0.5);
            expect(r2).toBeGreaterThan(r1);
        });

        it('should apply Weissenberg-Rabinowitsch correction for n<1', () => {
            const rNewtonian = rheo.nozzleShearRate(0.1, 0.4, 1);
            const rShearThin = rheo.nozzleShearRate(0.1, 0.4, 0.5);
            // Correction = (3*0.5+1)/(4*0.5) = 2.5/2 = 1.25 > 1
            expect(rShearThin).toBeGreaterThan(rNewtonian);
        });

        it('should default to n=1 if not provided', () => {
            const r1 = rheo.nozzleShearRate(0.1, 0.4);
            const r2 = rheo.nozzleShearRate(0.1, 0.4, 1);
            expect(r1).toBeCloseTo(r2, 5);
        });

        it('should throw for non-positive flow rate', () => {
            expect(() => rheo.nozzleShearRate(0, 0.4)).toThrow();
        });

        it('should throw for non-positive diameter', () => {
            expect(() => rheo.nozzleShearRate(0.1, 0)).toThrow();
        });
    });

    describe('estimateFlowRate', () => {
        it('should compute flow rate from print parameters', () => {
            // 10 mm/s × 0.4mm nozzle × 0.2mm layer = 0.8 mm³/s = 0.048 mL/min
            const q = rheo.estimateFlowRate(10, 0.4, 0.2);
            expect(q).toBeCloseTo(0.048, 3);
        });

        it('should scale linearly with print speed', () => {
            const q1 = rheo.estimateFlowRate(5, 0.4, 0.2);
            const q2 = rheo.estimateFlowRate(10, 0.4, 0.2);
            expect(q2).toBeCloseTo(q1 * 2, 5);
        });

        it('should throw for non-positive parameters', () => {
            expect(() => rheo.estimateFlowRate(0, 0.4, 0.2)).toThrow();
            expect(() => rheo.estimateFlowRate(10, 0, 0.2)).toThrow();
            expect(() => rheo.estimateFlowRate(10, 0.4, 0)).toThrow();
        });
    });

    // ── Temperature-Viscosity ───────────────────────────────────

    describe('arrheniusViscosity', () => {
        it('should return refViscosity at refTemp', () => {
            const v = rheo.arrheniusViscosity(100, 25, 30, 25);
            expect(v).toBeCloseTo(100, 5);
        });

        it('should decrease viscosity with increasing temperature', () => {
            const v25 = rheo.arrheniusViscosity(100, 25, 30, 25);
            const v37 = rheo.arrheniusViscosity(100, 25, 30, 37);
            expect(v37).toBeLessThan(v25);
        });

        it('should increase viscosity with decreasing temperature', () => {
            const v25 = rheo.arrheniusViscosity(100, 25, 30, 25);
            const v10 = rheo.arrheniusViscosity(100, 25, 30, 10);
            expect(v10).toBeGreaterThan(v25);
        });

        it('should be more sensitive with higher activation energy', () => {
            const vLow = rheo.arrheniusViscosity(100, 25, 20, 37);
            const vHigh = rheo.arrheniusViscosity(100, 25, 60, 37);
            // Both < 100, but higher Ea drops more
            expect(vHigh).toBeLessThan(vLow);
        });

        it('should throw for non-positive reference viscosity', () => {
            expect(() => rheo.arrheniusViscosity(0, 25, 30, 37)).toThrow();
        });

        it('should throw for non-positive activation energy', () => {
            expect(() => rheo.arrheniusViscosity(100, 25, 0, 37)).toThrow();
        });
    });

    describe('temperatureCurve', () => {
        it('should generate correct number of points', () => {
            const curve = rheo.temperatureCurve(100, 25, 30, 10, 40, 5);
            // 10, 15, 20, 25, 30, 35, 40 = 7 points
            expect(curve.length).toBe(7);
        });

        it('should span the requested range', () => {
            const curve = rheo.temperatureCurve(100, 25, 30, 20, 40, 2);
            expect(curve[0].temperature).toBe(20);
            expect(curve[curve.length - 1].temperature).toBe(40);
        });

        it('should show decreasing viscosity', () => {
            const curve = rheo.temperatureCurve(100, 25, 30, 10, 50, 5);
            for (let i = 1; i < curve.length; i++) {
                expect(curve[i].viscosity).toBeLessThan(curve[i - 1].viscosity);
            }
        });

        it('should throw if minTemp >= maxTemp', () => {
            expect(() => rheo.temperatureCurve(100, 25, 30, 40, 20)).toThrow();
        });
    });

    // ── Printability Analysis ───────────────────────────────────

    describe('analyzePrintability', () => {
        it('should score strongly shear-thinning bioink highly', () => {
            const result = rheo.analyzePrintability({
                K: 50, n: 0.35, yieldStress: 50
            });
            expect(result.score).toBeGreaterThanOrEqual(70);
            expect(result.printable).toBe(true);
            expect(result.flowBehavior).toBe('strongly shear-thinning');
        });

        it('should score Newtonian fluid poorly', () => {
            const result = rheo.analyzePrintability({
                K: 10, n: 1.0, yieldStress: 0
            });
            expect(result.score).toBeLessThan(50);
            expect(result.printable).toBe(false);
        });

        it('should flag shear-thickening as poor', () => {
            const result = rheo.analyzePrintability({
                K: 10, n: 1.3
            });
            expect(result.shearThinning).toBe(false);
            expect(result.flowBehavior).toBe('shear-thickening');
        });

        it('should include viscosity at print shear rate', () => {
            const result = rheo.analyzePrintability({
                K: 50, n: 0.5, printShearRate: 100
            });
            // η = 50 · 100^(0.5-1) = 5
            expect(result.viscosityAtPrint).toBeCloseTo(5, 2);
        });

        it('should produce 4 factors with yield stress', () => {
            const result = rheo.analyzePrintability({
                K: 50, n: 0.5, yieldStress: 50
            });
            expect(result.factors.length).toBe(4);
        });

        it('should produce 4 factors without yield stress (unknown)', () => {
            const result = rheo.analyzePrintability({
                K: 50, n: 0.5
            });
            expect(result.factors.length).toBe(4);
            const ysFactor = result.factors.find(f => f.name === 'Yield Stress');
            expect(ysFactor.status).toBe('unknown');
        });

        it('should respect custom viscosity bounds', () => {
            const result = rheo.analyzePrintability({
                K: 50, n: 0.5,
                printShearRate: 100,
                minViscosity: 10,
                maxViscosity: 50
            });
            // viscosity at 100 = 5, below min of 10
            const viscFactor = result.factors.find(f => f.name === 'Print Viscosity');
            expect(viscFactor.status).toBe('poor');
        });

        it('should throw for missing parameters', () => {
            expect(() => rheo.analyzePrintability(null)).toThrow();
            expect(() => rheo.analyzePrintability({})).toThrow();
            expect(() => rheo.analyzePrintability({ K: 50 })).toThrow();
        });

        it('should classify high yield stress as good', () => {
            const result = rheo.analyzePrintability({
                K: 50, n: 0.5, yieldStress: 600
            });
            const ysFactor = result.factors.find(f => f.name === 'Yield Stress');
            expect(ysFactor.status).toBe('good');
        });

        it('should classify very low yield stress as marginal', () => {
            const result = rheo.analyzePrintability({
                K: 50, n: 0.5, yieldStress: 3
            });
            const ysFactor = result.factors.find(f => f.name === 'Yield Stress');
            expect(ysFactor.status).toBe('marginal');
        });

        it('should classify zero yield stress as poor', () => {
            const result = rheo.analyzePrintability({
                K: 50, n: 0.5, yieldStress: 0
            });
            const ysFactor = result.factors.find(f => f.name === 'Yield Stress');
            expect(ysFactor.status).toBe('poor');
        });

        it('should score between 0 and 100', () => {
            // Test with various parameter combinations
            const combos = [
                { K: 1, n: 0.3, yieldStress: 50 },
                { K: 100, n: 1.5 },
                { K: 50, n: 0.5, yieldStress: 20 },
            ];
            for (const params of combos) {
                const r = rheo.analyzePrintability(params);
                expect(r.score).toBeGreaterThanOrEqual(0);
                expect(r.score).toBeLessThanOrEqual(100);
            }
        });
    });

    // ── Bioink Presets ──────────────────────────────────────────

    describe('getBioinkPresets', () => {
        it('should return an array of presets', () => {
            const presets = rheo.getBioinkPresets();
            expect(Array.isArray(presets)).toBe(true);
            expect(presets.length).toBeGreaterThanOrEqual(5);
        });

        it('should have required fields on each preset', () => {
            const presets = rheo.getBioinkPresets();
            for (const p of presets) {
                expect(p).toHaveProperty('id');
                expect(p).toHaveProperty('name');
                expect(p).toHaveProperty('K');
                expect(p).toHaveProperty('n');
                expect(typeof p.K).toBe('number');
                expect(typeof p.n).toBe('number');
                expect(p.K).toBeGreaterThan(0);
                expect(p.n).toBeGreaterThan(0);
                expect(p.n).toBeLessThan(1); // all presets should be shear-thinning
            }
        });

        it('should have unique IDs', () => {
            const presets = rheo.getBioinkPresets();
            const ids = presets.map(p => p.id);
            expect(new Set(ids).size).toBe(ids.length);
        });

        it('should produce printable results for all presets', () => {
            const presets = rheo.getBioinkPresets();
            for (const p of presets) {
                const result = rheo.analyzePrintability({
                    K: p.K, n: p.n, yieldStress: p.yieldStress
                });
                expect(result.score).toBeGreaterThan(0);
            }
        });
    });
});
