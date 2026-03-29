'use strict';

var molarity = require('../docs/shared/molarity');

describe('MolarityCalculator', function () {
    var calc;

    beforeEach(function () {
        calc = molarity.createMolarityCalculator();
    });

    // ── massRequired ──────────────────────────────────────────────

    describe('massRequired', function () {
        it('calculates mass for NaCl by MW', function () {
            // 0.5 M × 0.25 L × 58.44 g/mol = 7.305 g
            var r = calc.massRequired({ molarity: 0.5, volumeMl: 250, mw: 58.44 });
            expect(r.massG).toBeCloseTo(7.305, 3);
            expect(r.formula).toContain('mass');
        });

        it('resolves reagent name instead of mw', function () {
            var r = calc.massRequired({ molarity: 1, volumeMl: 1000, reagent: 'nacl' });
            expect(r.massG).toBeCloseTo(58.44, 2);
            expect(r.mw).toBe(58.44);
        });

        it('handles small volumes', function () {
            var r = calc.massRequired({ molarity: 0.01, volumeMl: 10, mw: 180.16 });
            // 0.01 × 0.01 × 180.16 = 0.018016
            expect(r.massG).toBeCloseTo(0.018, 2);
        });

        it('throws for unknown reagent', function () {
            expect(function () {
                calc.massRequired({ molarity: 1, volumeMl: 100, reagent: 'unobtanium' });
            }).toThrow(/Unknown reagent/);
        });

        it('throws when neither mw nor reagent given', function () {
            expect(function () {
                calc.massRequired({ molarity: 1, volumeMl: 100 });
            }).toThrow(/Provide either mw/);
        });
    });

    // ── molarityFromMass ──────────────────────────────────────────

    describe('molarityFromMass', function () {
        it('calculates molarity from dissolved mass', function () {
            // 10g glucose in 500mL: 10 / (180.16 × 0.5) = 0.11099
            var r = calc.molarityFromMass({ massG: 10, volumeMl: 500, mw: 180.16 });
            expect(r.molarity).toBeCloseTo(0.111, 2);
        });

        it('uses reagent name lookup', function () {
            var r = calc.molarityFromMass({ massG: 58.44, volumeMl: 1000, reagent: 'nacl' });
            expect(r.molarity).toBeCloseTo(1, 3);
        });
    });

    // ── volumeRequired ────────────────────────────────────────────

    describe('volumeRequired', function () {
        it('calculates volume to achieve target molarity', function () {
            // dissolve 58.44g NaCl at 1M: V = 58.44/(58.44 × 1) = 1 L = 1000 mL
            var r = calc.volumeRequired({ massG: 58.44, molarity: 1, mw: 58.44 });
            expect(r.volumeMl).toBeCloseTo(1000, 0);
        });
    });

    // ── dilution (C1V1 = C2V2) ────────────────────────────────────

    describe('dilution', function () {
        it('solves for v1', function () {
            var r = calc.dilution({ c1: 1.0, v1Ml: null, c2: 0.1, v2Ml: 500 });
            expect(r.v1Ml).toBeCloseTo(50, 1);
            expect(r.diluentMl).toBeCloseTo(450, 1);
        });

        it('solves for c1', function () {
            var r = calc.dilution({ c1: null, v1Ml: 50, c2: 0.1, v2Ml: 500 });
            expect(r.c1).toBeCloseTo(1, 2);
        });

        it('solves for c2', function () {
            var r = calc.dilution({ c1: 1, v1Ml: 50, c2: null, v2Ml: 500 });
            expect(r.c2).toBeCloseTo(0.1, 2);
        });

        it('solves for v2', function () {
            var r = calc.dilution({ c1: 1, v1Ml: 50, c2: 0.1, v2Ml: null });
            expect(r.v2Ml).toBeCloseTo(500, 0);
        });

        it('throws if not exactly one null', function () {
            expect(function () {
                calc.dilution({ c1: 1, v1Ml: 50, c2: 0.1, v2Ml: 500 });
            }).toThrow(/exactly one/);
        });

        it('throws if two nulls', function () {
            expect(function () {
                calc.dilution({ c1: null, v1Ml: null, c2: 0.1, v2Ml: 500 });
            }).toThrow(/exactly one/);
        });
    });

    // ── convertUnits ──────────────────────────────────────────────

    describe('convertUnits', function () {
        it('converts M to mM', function () {
            var r = calc.convertUnits({ value: 0.5, from: 'M', to: 'mM', mw: 58.44 });
            expect(r.value).toBeCloseTo(500, 0);
        });

        it('converts mM to µM', function () {
            var r = calc.convertUnits({ value: 1, from: 'mM', to: 'µM', mw: 100 });
            expect(r.value).toBeCloseTo(1000, 0);
        });

        it('converts M to mg/mL', function () {
            // 1 M NaCl = 58.44 mg/mL
            var r = calc.convertUnits({ value: 1, from: 'M', to: 'mg/mL', mw: 58.44 });
            expect(r.value).toBeCloseTo(58.44, 1);
        });

        it('converts %(w/v) to M', function () {
            // 10% w/v NaCl: (10 × 10) / 58.44 = 1.711 M
            var r = calc.convertUnits({ value: 10, from: '%(w/v)', to: 'M', mw: 58.44 });
            expect(r.value).toBeCloseTo(1.711, 2);
        });

        it('round-trips M → nM → M', function () {
            var r1 = calc.convertUnits({ value: 0.001, from: 'M', to: 'nM', mw: 100 });
            var r2 = calc.convertUnits({ value: r1.value, from: 'nM', to: 'M', mw: 100 });
            expect(r2.value).toBeCloseTo(0.001, 6);
        });

        it('throws for unknown unit', function () {
            expect(function () {
                calc.convertUnits({ value: 1, from: 'X', to: 'M', mw: 100 });
            }).toThrow(/Unknown unit/);
        });
    });

    // ── listReagents ──────────────────────────────────────────────

    describe('listReagents', function () {
        it('returns a non-empty sorted array', function () {
            var list = calc.listReagents();
            expect(list.length).toBeGreaterThan(10);
            // Check sorted
            for (var i = 1; i < list.length; i++) {
                expect(list[i].key >= list[i - 1].key).toBe(true);
            }
        });

        it('each entry has key, name, mw', function () {
            var list = calc.listReagents();
            list.forEach(function (r) {
                expect(r.key).toBeTruthy();
                expect(r.name).toBeTruthy();
                expect(r.mw).toBeGreaterThan(0);
            });
        });
    });

    // ── recipe ────────────────────────────────────────────────────

    describe('recipe', function () {
        it('calculates multiple solutions at once', function () {
            var results = calc.recipe([
                { reagent: 'nacl', molarity: 0.5, volumeMl: 100 },
                { reagent: 'glucose', molarity: 0.1, volumeMl: 500 }
            ]);
            expect(results).toHaveLength(2);
            expect(results[0].massG).toBeCloseTo(2.922, 2);  // 0.5 × 0.1 × 58.44
            expect(results[1].massG).toBeCloseTo(9.008, 2);  // 0.1 × 0.5 × 180.16
        });
    });
});
