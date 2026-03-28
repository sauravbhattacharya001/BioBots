'use strict';

var mod = require('../docs/shared/molarity');

describe('molarityCalculator', function () {
    var calc;

    beforeEach(function () {
        calc = mod.createMolarityCalculator();
    });

    // ── massRequired ───────────────────────────────────────────────

    describe('massRequired', function () {
        it('calculates mass for NaCl solution by mw', function () {
            // 0.5 M × 0.25 L × 58.44 g/mol = 7.305 g
            var res = calc.massRequired({ molarity: 0.5, volumeMl: 250, mw: 58.44 });
            expect(res.massG).toBeCloseTo(7.305, 3);
            expect(res.unit).toBe('grams');
        });

        it('calculates mass using reagent name lookup', function () {
            var res = calc.massRequired({ molarity: 1.0, volumeMl: 1000, reagent: 'nacl' });
            expect(res.massG).toBeCloseTo(58.44, 2);
            expect(res.mw).toBe(58.44);
        });

        it('throws for unknown reagent', function () {
            expect(function () {
                calc.massRequired({ molarity: 1, volumeMl: 100, reagent: 'unobtanium' });
            }).toThrow(/Unknown reagent/);
        });

        it('throws when neither mw nor reagent provided', function () {
            expect(function () {
                calc.massRequired({ molarity: 1, volumeMl: 100 });
            }).toThrow(/Provide either mw/);
        });
    });

    // ── molarityFromMass ───────────────────────────────────────────

    describe('molarityFromMass', function () {
        it('calculates molarity from dissolved mass', function () {
            // 10 g glucose in 500 mL: M = 10 / (180.16 × 0.5) = 0.1110
            var res = calc.molarityFromMass({ massG: 10, volumeMl: 500, mw: 180.16 });
            expect(res.molarity).toBeCloseTo(0.1110, 3);
        });

        it('works with reagent name', function () {
            var res = calc.molarityFromMass({ massG: 58.44, volumeMl: 1000, reagent: 'nacl' });
            expect(res.molarity).toBeCloseTo(1.0, 3);
        });
    });

    // ── volumeRequired ─────────────────────────────────────────────

    describe('volumeRequired', function () {
        it('calculates volume to dissolve a mass', function () {
            // 58.44 g NaCl at 1 M → 1000 mL
            var res = calc.volumeRequired({ massG: 58.44, molarity: 1.0, mw: 58.44 });
            expect(res.volumeMl).toBeCloseTo(1000, 0);
        });
    });

    // ── dilution (C1V1 = C2V2) ─────────────────────────────────────

    describe('dilution', function () {
        it('solves for v1', function () {
            var res = calc.dilution({ c1: 1.0, v1Ml: null, c2: 0.1, v2Ml: 500 });
            expect(res.v1Ml).toBeCloseTo(50, 1);
            expect(res.diluentMl).toBeCloseTo(450, 1);
        });

        it('solves for c1', function () {
            var res = calc.dilution({ c1: null, v1Ml: 50, c2: 0.1, v2Ml: 500 });
            expect(res.c1).toBeCloseTo(1.0, 3);
        });

        it('solves for c2', function () {
            var res = calc.dilution({ c1: 1.0, v1Ml: 50, c2: null, v2Ml: 500 });
            expect(res.c2).toBeCloseTo(0.1, 3);
        });

        it('solves for v2', function () {
            var res = calc.dilution({ c1: 1.0, v1Ml: 50, c2: 0.1, v2Ml: null });
            expect(res.v2Ml).toBeCloseTo(500, 0);
        });

        it('throws when not exactly one null', function () {
            expect(function () {
                calc.dilution({ c1: 1, v1Ml: 50, c2: 0.1, v2Ml: 500 }); // zero nulls
            }).toThrow(/exactly one/);
            expect(function () {
                calc.dilution({ c1: null, v1Ml: null, c2: 0.1, v2Ml: 500 }); // two nulls
            }).toThrow(/exactly one/);
        });
    });

    // ── convertUnits ───────────────────────────────────────────────

    describe('convertUnits', function () {
        it('converts M to mM', function () {
            var res = calc.convertUnits({ value: 0.5, from: 'M', to: 'mM', mw: 58.44 });
            expect(res.value).toBeCloseTo(500, 0);
        });

        it('converts mg/mL to M', function () {
            // 58.44 mg/mL NaCl = 1 M
            var res = calc.convertUnits({ value: 58.44, from: 'mg/mL', to: 'M', mw: 58.44 });
            expect(res.value).toBeCloseTo(1.0, 3);
        });

        it('converts %(w/v) to M', function () {
            // 5.844 %(w/v) NaCl = 58.44 mg/mL / 58.44 = 1 M
            var res = calc.convertUnits({ value: 5.844, from: '%(w/v)', to: 'M', mw: 58.44 });
            expect(res.value).toBeCloseTo(1.0, 3);
        });

        it('round-trips µM → M → µM', function () {
            var res1 = calc.convertUnits({ value: 500, from: 'uM', to: 'M', mw: 100 });
            var res2 = calc.convertUnits({ value: res1.value, from: 'M', to: 'uM', mw: 100 });
            expect(res2.value).toBeCloseTo(500, 1);
        });

        it('throws for unknown unit', function () {
            expect(function () {
                calc.convertUnits({ value: 1, from: 'oz', to: 'M', mw: 100 });
            }).toThrow(/Unknown unit/);
        });
    });

    // ── listReagents ───────────────────────────────────────────────

    describe('listReagents', function () {
        it('returns sorted list of known reagents', function () {
            var list = calc.listReagents();
            expect(list.length).toBeGreaterThan(10);
            // Check sorted
            for (var i = 1; i < list.length; i++) {
                expect(list[i].key >= list[i - 1].key).toBe(true);
            }
            // Check NaCl present
            var nacl = list.find(function (r) { return r.key === 'nacl'; });
            expect(nacl).toBeDefined();
            expect(nacl.mw).toBe(58.44);
        });
    });

    // ── recipe ─────────────────────────────────────────────────────

    describe('recipe', function () {
        it('calculates masses for multiple solutions', function () {
            var results = calc.recipe([
                { reagent: 'nacl', molarity: 0.5, volumeMl: 500 },
                { reagent: 'tris', molarity: 0.05, volumeMl: 1000 }
            ]);
            expect(results.length).toBe(2);
            // 0.5 M × 0.5 L × 58.44 = 14.61 g
            expect(results[0].massG).toBeCloseTo(14.61, 2);
            // 0.05 M × 1 L × 121.14 = 6.057 g
            expect(results[1].massG).toBeCloseTo(6.057, 2);
        });
    });
});
