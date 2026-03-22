'use strict';

var mediaPrep = require('../docs/shared/mediaPrep');

describe('Media Preparation Calculator', function () {
    var calc;

    beforeEach(function () {
        calc = mediaPrep.createMediaPrepCalculator();
    });

    describe('listMedia', function () {
        it('returns all common media formulations', function () {
            var list = calc.listMedia();
            expect(list.length).toBeGreaterThanOrEqual(5);
            var ids = list.map(function (m) { return m.id; });
            expect(ids).toContain('DMEM');
            expect(ids).toContain('RPMI');
        });
    });

    describe('listSupplements', function () {
        it('returns common supplements', function () {
            var list = calc.listSupplements();
            expect(list.length).toBeGreaterThanOrEqual(5);
            var ids = list.map(function (s) { return s.id; });
            expect(ids).toContain('FBS');
            expect(ids).toContain('Pen-Strep');
        });
    });

    describe('prepare', function () {
        it('throws on missing targetVolume', function () {
            expect(function () { calc.prepare({}); }).toThrow(/targetVolume/);
        });

        it('calculates basic DMEM + 10% FBS recipe', function () {
            var recipe = calc.prepare({
                baseMedia: 'DMEM',
                targetVolume: 500,
                supplements: [
                    { name: 'FBS', percentage: 10 },
                    { name: 'Pen-Strep', percentage: 1 }
                ]
            });

            expect(recipe.targetVolume).toBe(500);
            expect(recipe.baseMediaVolume).toBe(445);
            expect(recipe.totalSupplementVolume).toBe(55);
            expect(recipe.supplements).toHaveLength(2);
            expect(recipe.supplements[0].volumeToAdd).toBe(50);
            expect(recipe.supplements[1].volumeToAdd).toBe(5);
            expect(recipe.steps.length).toBeGreaterThan(3);
        });

        it('calculates dilution-based supplements', function () {
            var recipe = calc.prepare({
                baseMedia: 'RPMI',
                targetVolume: 100,
                supplements: [
                    { name: 'L-Glutamine', concentration: 2, unit: 'mM', stockConcentration: 200, stockUnit: 'mM' }
                ]
            });

            expect(recipe.supplements[0].dilutionFactor).toBe(100);
            expect(recipe.supplements[0].volumeToAdd).toBe(1);
        });

        it('supports powder preparation', function () {
            var recipe = calc.prepare({
                baseMedia: 'DMEM',
                targetVolume: 1000,
                fromPowder: true,
                supplements: []
            });

            expect(recipe.fromPowder).toBe(true);
            expect(recipe.powder.mass).toBe(13.4);
            expect(recipe.sodiumBicarbonate.mass).toBe(3.7);
        });

        it('warns on high supplement percentage', function () {
            var recipe = calc.prepare({
                baseMedia: 'DMEM',
                targetVolume: 100,
                supplements: [
                    { name: 'FBS', percentage: 30 }
                ]
            });

            expect(recipe.warnings.length).toBeGreaterThan(0);
            expect(recipe.warnings[0]).toContain('25%');
        });
    });

    describe('scale', function () {
        it('scales a recipe proportionally', function () {
            var recipe = calc.prepare({
                baseMedia: 'DMEM',
                targetVolume: 500,
                supplements: [{ name: 'FBS', percentage: 10 }]
            });

            var scaled = calc.scale(recipe, 1000);
            expect(scaled.targetVolume).toBe(1000);
            expect(scaled.baseMediaVolume).toBe(900);
            expect(scaled.supplements[0].volumeToAdd).toBe(100);
            expect(scaled.scaleFactor).toBe(2);
        });
    });

    describe('estimateShelfLife', function () {
        it('estimates shorter shelf life with glutamine', function () {
            var recipe = calc.prepare({
                baseMedia: 'DMEM',
                targetVolume: 500,
                supplements: [
                    { name: 'FBS', percentage: 10 },
                    { name: 'L-Glutamine', concentration: 2, unit: 'mM', stockConcentration: 200, stockUnit: 'mM' }
                ]
            });

            var shelf = calc.estimateShelfLife(recipe);
            expect(shelf.shelfLifeDays).toBeLessThanOrEqual(14);
            expect(shelf.hasGlutamine).toBe(true);
            expect(shelf.recommendation).toContain('GlutaMAX');
        });
    });
});
