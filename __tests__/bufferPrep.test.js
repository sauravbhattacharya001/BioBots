'use strict';

var bufferPrep = require('../docs/shared/bufferPrep');

describe('Buffer Preparation Calculator', function () {
    var calc;

    beforeEach(function () {
        calc = bufferPrep.createBufferPrepCalculator();
    });

    describe('listBuffers', function () {
        it('returns all supported buffers', function () {
            var list = calc.listBuffers();
            expect(list.length).toBeGreaterThanOrEqual(8);
            var keys = list.map(function (b) { return b.key; });
            expect(keys).toContain('PBS');
            expect(keys).toContain('TRIS');
            expect(keys).toContain('HEPES');
        });
    });

    describe('prepare', function () {
        it('prepares 1X PBS from 10X stock', function () {
            var recipe = calc.prepare({ buffer: 'PBS', targetVolume: 1000, concentration: '1X' });
            expect(recipe.buffer).toBe('PBS');
            expect(recipe.concentration).toBe('1X');
            expect(recipe.ingredients.length).toBe(2);
            expect(recipe.ingredients[0].amount).toBe(100); // 1000 * 1/10
            expect(recipe.ingredients[1].name).toBe('Distilled water');
            expect(recipe.ingredients[1].amount).toBe(900);
        });

        it('uses default pH when not specified', function () {
            var recipe = calc.prepare({ buffer: 'TRIS', targetVolume: 500 });
            expect(recipe.targetpH).toBe(7.5);
        });

        it('rejects pH outside buffer range', function () {
            expect(function () {
                calc.prepare({ buffer: 'PBS', targetVolume: 500, targetpH: 5.0 });
            }).toThrow(/outside this range/);
        });

        it('rejects unknown buffer', function () {
            expect(function () {
                calc.prepare({ buffer: 'FAKE', targetVolume: 500 });
            }).toThrow(/Unknown buffer/);
        });

        it('rejects missing volume', function () {
            expect(function () {
                calc.prepare({ buffer: 'PBS' });
            }).toThrow(/targetVolume/);
        });

        it('includes temperature warning for Tris buffers', function () {
            var recipe = calc.prepare({ buffer: 'TBS', targetVolume: 500 });
            expect(recipe.warnings.some(function (w) { return w.indexOf('temperature') >= 0; })).toBe(true);
        });

        it('includes filter-sterilize warning for HEPES', function () {
            var recipe = calc.prepare({ buffer: 'HEPES', targetVolume: 500 });
            expect(recipe.warnings.some(function (w) { return w.indexOf('filter-sterilize') >= 0; })).toBe(true);
        });

        it('prepares from powder for high concentration', function () {
            var recipe = calc.prepare({ buffer: 'PBS', targetVolume: 1000, concentration: '10X' });
            // 10X from 10X stock => dilutionRatio = 1 => stock path
            expect(recipe.ingredients.length).toBe(2);
        });

        it('handles case-insensitive buffer names', function () {
            var recipe = calc.prepare({ buffer: 'pbs', targetVolume: 100 });
            expect(recipe.buffer).toBe('PBS');
        });

        it('prepares TAE from 50X stock', function () {
            var recipe = calc.prepare({ buffer: 'TAE', targetVolume: 1000, concentration: '1X' });
            expect(recipe.ingredients[0].amount).toBe(20); // 1000 * 1/50
        });
    });

    describe('dilute', function () {
        it('calculates C1V1=C2V2 correctly', function () {
            var result = calc.dilute({
                stockConcentration: 10,
                targetConcentration: 1,
                targetVolume: 500
            });
            expect(result.stockVolume).toBe(50);
            expect(result.solventVolume).toBe(450);
        });

        it('rejects target >= stock', function () {
            expect(function () {
                calc.dilute({ stockConcentration: 5, targetConcentration: 10, targetVolume: 100 });
            }).toThrow(/less than/);
        });
    });

    describe('hendersonHasselbalch', function () {
        it('calculates ratio at pKa', function () {
            var result = calc.hendersonHasselbalch({ buffer: 'PBS', targetpH: 7.2 });
            expect(result.ratio).toBeCloseTo(1, 0);
            expect(result.percentConjugateBase).toBeCloseTo(50, 0);
        });

        it('warns about poor buffering capacity', function () {
            var result = calc.hendersonHasselbalch({ buffer: 'TRIS', targetpH: 6.5 });
            expect(result.capacityNote).toMatch(/Poor buffering/);
        });

        it('confirms good capacity near pKa', function () {
            var result = calc.hendersonHasselbalch({ buffer: 'HEPES', targetpH: 7.4 });
            expect(result.capacityNote).toMatch(/Good buffering/);
        });
    });
});
