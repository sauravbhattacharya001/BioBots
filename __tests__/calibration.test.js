/**
 * @jest-environment jsdom
 */

describe('Calibration Wizard', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    // ── Objective value computation ──────────────────────

    describe('Objective scoring', () => {
        function getObjectiveValue(p, objective) {
            if (objective === 'balanced') {
                var v = p.print_data.livePercent;
                var e = p.print_data.elasticity;
                return Math.sqrt(Math.max(0, v) * Math.max(0, e));
            }
            return p.print_data[objective] || 0;
        }

        const print = {
            print_data: { livePercent: 80, deadPercent: 20, elasticity: 45 }
        };

        test('livePercent objective returns live cell %', () => {
            expect(getObjectiveValue(print, 'livePercent')).toBe(80);
        });

        test('elasticity objective returns elasticity', () => {
            expect(getObjectiveValue(print, 'elasticity')).toBe(45);
        });

        test('balanced objective is geometric mean', () => {
            const expected = Math.sqrt(80 * 45);
            expect(getObjectiveValue(print, 'balanced')).toBeCloseTo(expected, 5);
        });

        test('balanced handles zero viability', () => {
            const p = { print_data: { livePercent: 0, elasticity: 100 } };
            expect(getObjectiveValue(p, 'balanced')).toBe(0);
        });

        test('balanced handles negative clipped to zero', () => {
            const p = { print_data: { livePercent: -5, elasticity: 100 } };
            expect(getObjectiveValue(p, 'balanced')).toBe(0);
        });
    });

    // ── Pearson correlation ──────────────────────────────

    describe('Pearson R', () => {
        function pearsonR(pairs) {
            var n = pairs.length;
            var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
            for (var i = 0; i < n; i++) {
                sumX += pairs[i].x;
                sumY += pairs[i].y;
                sumXY += pairs[i].x * pairs[i].y;
                sumX2 += pairs[i].x * pairs[i].x;
                sumY2 += pairs[i].y * pairs[i].y;
            }
            var denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
            if (denom === 0) return 0;
            return (n * sumXY - sumX * sumY) / denom;
        }

        test('perfect positive correlation', () => {
            const pairs = [{ x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 6 }];
            expect(pearsonR(pairs)).toBeCloseTo(1.0, 5);
        });

        test('perfect negative correlation', () => {
            const pairs = [{ x: 1, y: 6 }, { x: 2, y: 4 }, { x: 3, y: 2 }];
            expect(pearsonR(pairs)).toBeCloseTo(-1.0, 5);
        });

        test('no correlation (constant Y)', () => {
            const pairs = [{ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }];
            expect(pearsonR(pairs)).toBe(0);
        });

        test('no correlation (constant X)', () => {
            const pairs = [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }];
            expect(pearsonR(pairs)).toBe(0);
        });

        test('moderate positive correlation', () => {
            const pairs = [
                { x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 5 },
                { x: 4, y: 4 }, { x: 5, y: 7 }
            ];
            const r = pearsonR(pairs);
            expect(r).toBeGreaterThan(0.8);
            expect(r).toBeLessThan(1.0);
        });
    });

    // ── Calibration plan generation ──────────────────────

    describe('Plan generation', () => {
        function generatePlan(baseline) {
            var paramDefs = [
                { key: 'ext1', label: 'Extruder 1', field: 'ext1' },
                { key: 'ext2', label: 'Extruder 2', field: 'ext2' },
                { key: 'clDur', label: 'CL Duration', field: 'clDur' },
                { key: 'clInt', label: 'CL Intensity', field: 'clInt' },
                { key: 'layers', label: 'Layer Count', field: 'layers' },
                { key: 'height', label: 'Layer Height', field: 'height' }
            ];

            var plan = [];
            var id = 1;
            var round2 = n => Math.round(n * 100) / 100;

            plan.push({
                id: id++, varyParam: 'Baseline',
                ext1: round2(baseline.ext1), ext2: round2(baseline.ext2),
                clDur: Math.round(baseline.clDur), clInt: Math.round(baseline.clInt),
                layers: Math.round(baseline.layers), height: round2(baseline.height),
                result: null
            });

            paramDefs.forEach(param => {
                var base = baseline[param.key];
                if (base == null || isNaN(base)) return;

                var low = param.key === 'layers' ? Math.max(1, Math.round(base * 0.7)) : round2(base * 0.7);
                var high = param.key === 'layers' ? Math.round(base * 1.3) : round2(base * 1.3);
                if (low === high) return;

                var lowTest = {
                    id: id++, varyParam: param.label + ' ↓',
                    ext1: round2(baseline.ext1), ext2: round2(baseline.ext2),
                    clDur: Math.round(baseline.clDur), clInt: Math.round(baseline.clInt),
                    layers: Math.round(baseline.layers), height: round2(baseline.height),
                    result: null
                };
                lowTest[param.field] = low;
                plan.push(lowTest);

                var highTest = {
                    id: id++, varyParam: param.label + ' ↑',
                    ext1: round2(baseline.ext1), ext2: round2(baseline.ext2),
                    clDur: Math.round(baseline.clDur), clInt: Math.round(baseline.clInt),
                    layers: Math.round(baseline.layers), height: round2(baseline.height),
                    result: null
                };
                highTest[param.field] = high;
                plan.push(highTest);
            });

            return plan;
        }

        const baseline = {
            ext1: 50, ext2: 30, clDur: 1000, clInt: 80, layers: 10, height: 0.5
        };

        test('generates baseline as first test', () => {
            const plan = generatePlan(baseline);
            expect(plan[0].varyParam).toBe('Baseline');
            expect(plan[0].ext1).toBe(50);
            expect(plan[0].layers).toBe(10);
        });

        test('generates 13 tests (1 baseline + 2 per 6 params)', () => {
            const plan = generatePlan(baseline);
            expect(plan.length).toBe(13);
        });

        test('low variants are 70% of baseline', () => {
            const plan = generatePlan(baseline);
            const ext1Low = plan.find(t => t.varyParam === 'Extruder 1 ↓');
            expect(ext1Low.ext1).toBeCloseTo(35, 1);
            // Other params should be at baseline
            expect(ext1Low.ext2).toBe(30);
            expect(ext1Low.clDur).toBe(1000);
        });

        test('high variants are 130% of baseline', () => {
            const plan = generatePlan(baseline);
            const ext1High = plan.find(t => t.varyParam === 'Extruder 1 ↑');
            expect(ext1High.ext1).toBeCloseTo(65, 1);
        });

        test('layers are rounded to integers', () => {
            const plan = generatePlan(baseline);
            const layerLow = plan.find(t => t.varyParam === 'Layer Count ↓');
            const layerHigh = plan.find(t => t.varyParam === 'Layer Count ↑');
            expect(Number.isInteger(layerLow.layers)).toBe(true);
            expect(Number.isInteger(layerHigh.layers)).toBe(true);
            expect(layerLow.layers).toBe(7);
            expect(layerHigh.layers).toBe(13);
        });

        test('layers clamped to minimum 1', () => {
            // layers=2: low=max(1,round(2*0.7))=1, high=round(2*1.3)=3
            const plan = generatePlan({ ...baseline, layers: 2 });
            const layerLow = plan.find(t => t.varyParam === 'Layer Count ↓');
            expect(layerLow).toBeDefined();
            expect(layerLow.layers).toBeGreaterThanOrEqual(1);
        });

        test('all results start as null', () => {
            const plan = generatePlan(baseline);
            plan.forEach(t => expect(t.result).toBeNull());
        });

        test('each test has a unique id', () => {
            const plan = generatePlan(baseline);
            const ids = plan.map(t => t.id);
            expect(new Set(ids).size).toBe(ids.length);
        });

        test('skips parameter if low == high', () => {
            // With layers: 1, 0.7→1 and 1.3→1, so low==high. Plan should skip it.
            const smallBaseline = { ext1: 50, ext2: 30, clDur: 1000, clInt: 80, layers: 1, height: 0.5 };
            const plan = generatePlan(smallBaseline);
            // Should be 11 (1 baseline + 2 per 5 remaining params, layers skipped since 1*0.7=1 and 1*1.3=1)
            const layerTests = plan.filter(t => t.varyParam.startsWith('Layer Count'));
            expect(layerTests.length).toBe(0);
        });
    });

    // ── Result ranking ───────────────────────────────────

    describe('Result ranking', () => {
        test('ranks completed tests by result descending', () => {
            const tests = [
                { id: 1, result: 75 },
                { id: 2, result: 90 },
                { id: 3, result: 60 },
                { id: 4, result: null },
            ];
            const completed = tests.filter(t => t.result != null);
            const ranked = completed.sort((a, b) => b.result - a.result);
            expect(ranked[0].id).toBe(2);
            expect(ranked[1].id).toBe(1);
            expect(ranked[2].id).toBe(3);
        });

        test('computes improvement over baseline', () => {
            const baseline = 70;
            const best = 84;
            const improvement = ((best - baseline) / baseline) * 100;
            expect(improvement).toBeCloseTo(20, 1);
        });

        test('handles negative improvement', () => {
            const baseline = 80;
            const worst = 60;
            const improvement = ((worst - baseline) / baseline) * 100;
            expect(improvement).toBeCloseTo(-25, 1);
        });
    });

    // ── Confidence scoring ───────────────────────────────

    describe('Confidence', () => {
        test('full completion gives 100%', () => {
            const conf = Math.min(100, Math.round(13 / 13 * 100));
            expect(conf).toBe(100);
        });

        test('half completion gives ~50%', () => {
            const conf = Math.min(100, Math.round(7 / 13 * 100));
            expect(conf).toBe(54);
        });

        test('minimum 3 tests gives ~23%', () => {
            const conf = Math.min(100, Math.round(3 / 13 * 100));
            expect(conf).toBe(23);
        });

        test('per-param confidence caps at 100%', () => {
            // 3 tests (baseline + low + high) out of 3 expected
            const conf = Math.min(100, Math.round(3 / 3 * 100));
            expect(conf).toBe(100);
        });

        test('per-param confidence with just baseline', () => {
            const conf = Math.min(100, Math.round(1 / 3 * 100));
            expect(conf).toBe(33);
        });
    });

    // ── Percentile calculation ───────────────────────────

    describe('Historical percentile', () => {
        test('calculates percentile correctly', () => {
            const allVals = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
            const predicted = 75;
            const belowCount = allVals.filter(v => v < predicted).length;
            const percentile = Math.round(belowCount / allVals.length * 100);
            expect(percentile).toBe(70); // 7 out of 10 are below 75
        });

        test('best result is 100th percentile', () => {
            const allVals = [10, 20, 30, 40, 50];
            const predicted = 55;
            const belowCount = allVals.filter(v => v < predicted).length;
            const percentile = Math.round(belowCount / allVals.length * 100);
            expect(percentile).toBe(100);
        });

        test('worst result is 0th percentile', () => {
            const allVals = [10, 20, 30, 40, 50];
            const predicted = 5;
            const belowCount = allVals.filter(v => v < predicted).length;
            const percentile = Math.round(belowCount / allVals.length * 100);
            expect(percentile).toBe(0);
        });
    });

    // ── State persistence ────────────────────────────────

    describe('State persistence', () => {
        const STORAGE_KEY = 'biobots_calibration';

        test('saves state to localStorage', () => {
            const state = { step: 3, objective: 'livePercent', wellplate: 24, plan: [], ts: Date.now() };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            const restored = JSON.parse(localStorage.getItem(STORAGE_KEY));
            expect(restored.step).toBe(3);
            expect(restored.objective).toBe('livePercent');
            expect(restored.wellplate).toBe(24);
        });

        test('restores plan data', () => {
            const plan = [{ id: 1, varyParam: 'Baseline', result: 82.5 }];
            const state = { step: 3, objective: 'elasticity', plan: plan, ts: Date.now() };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            const restored = JSON.parse(localStorage.getItem(STORAGE_KEY));
            expect(restored.plan[0].result).toBe(82.5);
        });

        test('expires after 7 days', () => {
            const oldTs = Date.now() - 8 * 24 * 60 * 60 * 1000;
            const state = { step: 3, objective: 'livePercent', ts: oldTs };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
            const expired = Date.now() - raw.ts > 7 * 24 * 60 * 60 * 1000;
            expect(expired).toBe(true);
        });
    });

    // ── Export structure ─────────────────────────────────

    describe('Export', () => {
        test('builds correct export structure', () => {
            const best = { id: 1, ext1: 50, ext2: 30, clDur: 1000, clInt: 80, layers: 10, height: 0.5, result: 92.5 };
            const objective = 'livePercent';

            const exportData = {
                calibration: {
                    objective: objective,
                    objectiveLabel: 'Live Cell %',
                    wellplate: 'any',
                    timestamp: new Date().toISOString(),
                    testsCompleted: 13,
                    totalPlanned: 13
                },
                recommendedSettings: {
                    extruder1: best.ext1,
                    extruder2: best.ext2,
                    crosslinking: { duration_ms: best.clDur, intensity_pct: best.clInt },
                    resolution: { layers: best.layers, layerHeight_mm: best.height }
                },
                bestResult: {
                    value: best.result,
                    unit: '%',
                    testId: best.id,
                    variation: 'Baseline'
                }
            };

            expect(exportData.calibration.objective).toBe('livePercent');
            expect(exportData.recommendedSettings.extruder1).toBe(50);
            expect(exportData.recommendedSettings.crosslinking.duration_ms).toBe(1000);
            expect(exportData.bestResult.value).toBe(92.5);
        });
    });

    // ── Round helper ─────────────────────────────────────

    describe('round2', () => {
        const round2 = n => Math.round(n * 100) / 100;

        test('rounds to 2 decimal places', () => {
            expect(round2(3.14159)).toBe(3.14);
        });

        test('preserves integers', () => {
            expect(round2(50)).toBe(50);
        });

        test('handles small fractions', () => {
            expect(round2(0.005)).toBe(0.01);
        });

        test('handles negative numbers', () => {
            expect(round2(-1.236)).toBe(-1.24);
        });
    });
});
