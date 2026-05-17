const { createPrintParameterRecommender } = require('../docs/shared/parameterRecommender');

describe('createPrintParameterRecommender', () => {
    let rec;

    beforeEach(() => {
        rec = createPrintParameterRecommender();
    });

    describe('listMaterials', () => {
        test('returns the supported materials', () => {
            const mats = rec.listMaterials();
            expect(Array.isArray(mats)).toBe(true);
            expect(mats.length).toBeGreaterThanOrEqual(2);
            const keys = mats.map((m) => m.key);
            expect(keys).toContain('alginate');
            expect(keys).toContain('gelatin');
        });

        test('each material exposes parameter ranges with units', () => {
            const mats = rec.listMaterials();
            for (const m of mats) {
                expect(typeof m.key).toBe('string');
                expect(typeof m.label).toBe('string');
                expect(Array.isArray(m.parameters)).toBe(true);
                expect(m.parameters.length).toBeGreaterThan(0);
                for (const p of m.parameters) {
                    expect(typeof p.name).toBe('string');
                    expect(typeof p.min).toBe('number');
                    expect(typeof p.max).toBe('number');
                    expect(p.max).toBeGreaterThanOrEqual(p.min);
                    expect(typeof p.step).toBe('number');
                    expect(p.step).toBeGreaterThan(0);
                    expect(typeof p.unit).toBe('string');
                }
            }
        });
    });

    describe('recommend', () => {
        test('throws when material is missing', () => {
            expect(() => rec.recommend()).toThrow(/material is required/);
            expect(() => rec.recommend({})).toThrow(/material is required/);
        });

        test('throws on unknown material with a helpful message', () => {
            expect(() => rec.recommend({ material: 'unobtanium' })).toThrow(
                /Unknown material: unobtanium.*Available:/
            );
        });

        test('accepts material names case-insensitively and with separators', () => {
            const a = rec.recommend({ material: 'alginate' });
            const b = rec.recommend({ material: 'Alginate' });
            const c = rec.recommend({ material: 'ALGINATE' });
            expect(a.materialKey).toBe('alginate');
            expect(b.materialKey).toBe('alginate');
            expect(c.materialKey).toBe('alginate');
        });

        test('returns ranked recommendations and a pareto front', () => {
            const result = rec.recommend({ material: 'alginate' });
            expect(result.material).toBe('Alginate');
            expect(result.materialKey).toBe('alginate');
            expect(result.candidatesEvaluated).toBeGreaterThan(0);
            expect(Array.isArray(result.recommendations)).toBe(true);
            expect(result.recommendations.length).toBeGreaterThan(0);
            expect(result.recommendations.length).toBeLessThanOrEqual(5); // default topN
            expect(Array.isArray(result.paretoFront)).toBe(true);
            expect(result.paretoFront.length).toBeGreaterThan(0);
            expect(result.paretoFront.length).toBeLessThanOrEqual(10);
            expect(Array.isArray(result.warnings)).toBe(true);
            expect(Array.isArray(result.insights)).toBe(true);
            expect(result.feedbackRecordsUsed).toBe(0);
        });

        test('recommendations are sorted by compositeScore descending', () => {
            const result = rec.recommend({ material: 'gelatin' });
            for (let i = 1; i < result.recommendations.length; i++) {
                expect(result.recommendations[i - 1].compositeScore).toBeGreaterThanOrEqual(
                    result.recommendations[i].compositeScore
                );
            }
        });

        test('each recommendation includes parameter set and per-objective scores', () => {
            const result = rec.recommend({ material: 'alginate' });
            for (const r of result.recommendations) {
                expect(r.parameters).toBeDefined();
                expect(typeof r.parameters.pressure).toBe('number');
                expect(typeof r.parameters.speed).toBe('number');
                expect(typeof r.parameters.temperature).toBe('number');
                expect(typeof r.parameters.nozzleDiameter).toBe('number');
                expect(typeof r.parameters.layerHeight).toBe('number');

                expect(r.viabilityScore).toBeGreaterThanOrEqual(0);
                expect(r.viabilityScore).toBeLessThanOrEqual(1);
                expect(r.resolutionScore).toBeGreaterThanOrEqual(0);
                expect(r.resolutionScore).toBeLessThanOrEqual(1);
                expect(r.integrityScore).toBeGreaterThanOrEqual(0);
                expect(r.integrityScore).toBeLessThanOrEqual(1);
                expect(typeof r.compositeScore).toBe('number');
                expect(r.feedbackBonus).toBe(0); // no feedback recorded yet
            }
        });

        test('respects topN', () => {
            const result = rec.recommend({ material: 'alginate', topN: 3 });
            expect(result.recommendations.length).toBeLessThanOrEqual(3);
        });

        test('honors hard constraints (maxPressure)', () => {
            const cap = 20;
            const result = rec.recommend({
                material: 'alginate',
                constraints: { maxPressure: cap }
            });
            expect(result.candidatesEvaluated).toBeGreaterThan(0);
            for (const r of result.recommendations) {
                expect(r.parameters.pressure).toBeLessThanOrEqual(cap);
            }
        });

        test('honors hard constraints (maxSpeed, nozzle bounds)', () => {
            const result = rec.recommend({
                material: 'alginate',
                constraints: { maxSpeed: 10, minNozzle: 0.3, maxNozzle: 0.5 }
            });
            for (const r of result.recommendations) {
                expect(r.parameters.speed).toBeLessThanOrEqual(10);
                expect(r.parameters.nozzleDiameter).toBeGreaterThanOrEqual(0.3);
                expect(r.parameters.nozzleDiameter).toBeLessThanOrEqual(0.5);
            }
        });

        test('over-restrictive constraints yield zero candidates', () => {
            // Alginate pressure range starts at 10 kPa; cap below the floor
            // should reject every candidate. Note: 0 is falsy and would be
            // ignored by the implementation, so we use a small positive cap.
            const result = rec.recommend({
                material: 'alginate',
                constraints: { maxPressure: 1 }
            });
            expect(result.candidatesEvaluated).toBe(0);
            expect(result.recommendations).toEqual([]);
            expect(result.paretoFront).toEqual([]);
        });

        test('weights bias the ranking toward weighted objective', () => {
            const viaHeavy = rec.recommend({
                material: 'alginate',
                weights: { viability: 10, resolution: 0, integrity: 0 },
                goals: { viability: 1, resolution: 0.5, integrity: 0.5 }
            });
            const resHeavy = rec.recommend({
                material: 'alginate',
                weights: { viability: 0, resolution: 10, integrity: 0 },
                goals: { viability: 0.5, resolution: 1, integrity: 0.5 }
            });
            // Top viability-weighted pick should score viability at least as well
            // as the top resolution-weighted pick scores viability.
            expect(viaHeavy.recommendations[0].viabilityScore)
                .toBeGreaterThanOrEqual(resHeavy.recommendations[0].viabilityScore - 1e-9);
            expect(resHeavy.recommendations[0].resolutionScore)
                .toBeGreaterThanOrEqual(viaHeavy.recommendations[0].resolutionScore - 1e-9);
        });

        test('zero total weight is handled gracefully', () => {
            const result = rec.recommend({
                material: 'alginate',
                weights: { viability: 0, resolution: 0, integrity: 0 }
            });
            expect(result.recommendations.length).toBeGreaterThan(0);
            expect(Number.isFinite(result.recommendations[0].compositeScore)).toBe(true);
        });

        test('pareto front entries are not strictly dominated by other front entries', () => {
            const result = rec.recommend({ material: 'gelatin' });
            const pf = result.paretoFront;
            for (let i = 0; i < pf.length; i++) {
                for (let j = 0; j < pf.length; j++) {
                    if (i === j) continue;
                    const a = pf[j];
                    const b = pf[i];
                    const strictlyDominates =
                        a.viabilityScore >= b.viabilityScore &&
                        a.resolutionScore >= b.resolutionScore &&
                        a.integrityScore >= b.integrityScore &&
                        (a.viabilityScore > b.viabilityScore ||
                            a.resolutionScore > b.resolutionScore ||
                            a.integrityScore > b.integrityScore);
                    expect(strictlyDominates).toBe(false);
                }
            }
        });
    });

    describe('analyze', () => {
        test('throws when material or parameters are missing', () => {
            expect(() => rec.analyze()).toThrow(/material and parameters are required/);
            expect(() => rec.analyze({ material: 'alginate' })).toThrow(
                /material and parameters are required/
            );
            expect(() => rec.analyze({ parameters: {} })).toThrow(
                /material and parameters are required/
            );
        });

        test('throws on unknown material', () => {
            expect(() => rec.analyze({ material: 'mystery', parameters: {} })).toThrow(
                /Unknown material: mystery/
            );
        });

        test('returns predicted scores and detects in-range parameters', () => {
            const out = rec.analyze({
                material: 'alginate',
                parameters: {
                    pressure: 20,
                    speed: 8,
                    temperature: 37,
                    nozzleDiameter: 0.4,
                    layerHeight: 0.2
                }
            });
            expect(out.material).toBe('Alginate');
            expect(out.predictedScores.viability).toBeGreaterThan(0);
            expect(out.predictedScores.viability).toBeLessThanOrEqual(1);
            expect(out.predictedScores.resolution).toBeGreaterThan(0);
            expect(out.predictedScores.integrity).toBeGreaterThan(0);
            expect(out.predictedScores.overall).toBeCloseTo(
                (out.predictedScores.viability +
                    out.predictedScores.resolution +
                    out.predictedScores.integrity) / 3,
                3
            );
            expect(out.outOfRange).toEqual([]);
            expect(out.notes).toMatch(/within recommended range/);
        });

        test('flags out-of-range parameters with valid ranges and units', () => {
            const out = rec.analyze({
                material: 'alginate',
                parameters: { pressure: 999, speed: 8 }
            });
            expect(out.outOfRange.length).toBe(1);
            const oor = out.outOfRange[0];
            expect(oor.parameter).toBe('pressure');
            expect(oor.value).toBe(999);
            expect(oor.validRange).toEqual({ min: 10, max: 50 });
            expect(oor.unit).toBe('kPa');
            expect(out.notes).toMatch(/outside recommended range/);
        });

        test('ignores unknown parameter keys (no range to check)', () => {
            const out = rec.analyze({
                material: 'alginate',
                parameters: { pressure: 20, randomKey: 12345 }
            });
            expect(out.outOfRange).toEqual([]);
        });
    });

    describe('compare', () => {
        test('throws when required inputs are missing', () => {
            expect(() => rec.compare()).toThrow(/material, setA, and setB are required/);
            expect(() => rec.compare({ material: 'alginate' })).toThrow();
            expect(() => rec.compare({ material: 'alginate', setA: {} })).toThrow();
        });

        test('returns winners per objective and a recommendation string', () => {
            const result = rec.compare({
                material: 'alginate',
                setA: { pressure: 20, speed: 8, temperature: 37, nozzleDiameter: 0.2, layerHeight: 0.1 },
                setB: { pressure: 45, speed: 22, temperature: 25, nozzleDiameter: 0.7, layerHeight: 0.45 }
            });
            expect(result.setA).toBeDefined();
            expect(result.setB).toBeDefined();
            expect(result.winner).toBeDefined();
            expect(['A', 'B', 'tie']).toContain(result.winner.viability);
            expect(['A', 'B', 'tie']).toContain(result.winner.resolution);
            expect(['A', 'B', 'tie']).toContain(result.winner.integrity);
            expect(['A', 'B', 'tie']).toContain(result.winner.overall);
            expect(typeof result.recommendation).toBe('string');
            expect(result.recommendation.length).toBeGreaterThan(0);
        });

        test('identical sets produce overall tie', () => {
            const params = { pressure: 25, speed: 10, temperature: 35, nozzleDiameter: 0.4, layerHeight: 0.2 };
            const result = rec.compare({ material: 'alginate', setA: params, setB: params });
            expect(result.winner.viability).toBe('tie');
            expect(result.winner.resolution).toBe('tie');
            expect(result.winner.integrity).toBe('tie');
            expect(result.winner.overall).toBe('tie');
            expect(result.recommendation).toMatch(/similarly/i);
        });
    });

    describe('feedback learning', () => {
        test('feedback throws when material or parameters are missing', () => {
            expect(() => rec.feedback()).toThrow(/material and parameters are required/);
            expect(() => rec.feedback({ material: 'alginate' })).toThrow();
        });

        test('feedback records are counted per material', () => {
            const params = { pressure: 20, speed: 8, temperature: 35, nozzleDiameter: 0.4, layerHeight: 0.2 };
            const r1 = rec.feedback({ material: 'alginate', parameters: params, actualViability: 0.95 });
            expect(r1.recorded).toBe(true);
            expect(r1.totalFeedback).toBe(1);
            expect(r1.materialFeedback).toBe(1);

            const r2 = rec.feedback({ material: 'gelatin', parameters: params, actualViability: 0.8 });
            expect(r2.totalFeedback).toBe(2);
            expect(r2.materialFeedback).toBe(1);

            const r3 = rec.feedback({ material: 'alginate', parameters: params });
            expect(r3.totalFeedback).toBe(3);
            expect(r3.materialFeedback).toBe(2);
        });

        test('recommend reports feedbackRecordsUsed after feedback is recorded', () => {
            rec.feedback({
                material: 'alginate',
                parameters: { pressure: 20, speed: 8, temperature: 35, nozzleDiameter: 0.4, layerHeight: 0.2 },
                actualViability: 0.95,
                actualResolution: 0.9,
                actualIntegrity: 0.85
            });
            const result = rec.recommend({ material: 'alginate' });
            expect(result.feedbackRecordsUsed).toBe(1);
            // Recommendations near recorded params should pick up a bonus.
            const anyBonus = result.recommendations.some((r) => r.feedbackBonus !== 0);
            expect(anyBonus).toBe(true);
        });

        test('feedback for one material does not leak into another', () => {
            rec.feedback({
                material: 'alginate',
                parameters: { pressure: 20, speed: 8, temperature: 35, nozzleDiameter: 0.4, layerHeight: 0.2 },
                actualViability: 0.95
            });
            const other = rec.recommend({ material: 'gelatin' });
            expect(other.feedbackRecordsUsed).toBe(0);
            for (const r of other.recommendations) {
                expect(r.feedbackBonus).toBe(0);
            }
        });

        test('multiple instances keep independent feedback histories', () => {
            const a = createPrintParameterRecommender();
            const b = createPrintParameterRecommender();
            a.feedback({
                material: 'alginate',
                parameters: { pressure: 20, speed: 8, temperature: 35, nozzleDiameter: 0.4, layerHeight: 0.2 }
            });
            expect(a.recommend({ material: 'alginate' }).feedbackRecordsUsed).toBe(1);
            expect(b.recommend({ material: 'alginate' }).feedbackRecordsUsed).toBe(0);
        });
    });
});
