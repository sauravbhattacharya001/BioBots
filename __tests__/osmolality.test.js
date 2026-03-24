'use strict';

var osmolality = require('../docs/shared/osmolality');

describe('Osmolality Calculator', function () {
    var calc;

    beforeEach(function () {
        calc = osmolality.createOsmolalityCalculator();
    });

    describe('calculate', function () {
        it('should calculate osmolality for 0.9% NaCl (normal saline ~308 mOsm/kg)', function () {
            var result = calc.calculate({
                solutes: [{ name: 'NaCl', concentration: 0.9, unit: 'percent_w_v' }]
            });
            expect(result.totalOsmolality).toBeGreaterThan(280);
            expect(result.totalOsmolality).toBeLessThan(320);
            expect(result.status).toBe('ISOTONIC');
        });

        it('should flag hypertonic solutions', function () {
            var result = calc.calculate({
                solutes: [{ name: 'NaCl', concentration: 3, unit: 'percent_w_v' }]
            });
            expect(result.status).toBe('HYPERTONIC');
            expect(result.totalOsmolality).toBeGreaterThan(330);
        });

        it('should flag hypotonic solutions', function () {
            var result = calc.calculate({
                solutes: [{ name: 'glucose', concentration: 10, unit: 'mM' }]
            });
            expect(result.status).toBe('HYPOTONIC');
            expect(result.totalOsmolality).toBeLessThan(270);
        });

        it('should add base media osmolality', function () {
            var result = calc.calculate({
                baseMedia: 'DMEM',
                solutes: [{ name: 'NaCl', concentration: 10, unit: 'mM' }]
            });
            expect(result.baseOsmolality).toBe(320);
            expect(result.totalOsmolality).toBeGreaterThan(320);
        });

        it('should provide breakdown per solute', function () {
            var result = calc.calculate({
                solutes: [
                    { name: 'NaCl', concentration: 100, unit: 'mM' },
                    { name: 'glucose', concentration: 5, unit: 'mM' }
                ]
            });
            expect(result.breakdown.length).toBe(2);
            expect(result.breakdown[0].solute).toBe('NaCl');
            expect(result.breakdown[1].solute).toBe('glucose');
        });

        it('should support custom solutes', function () {
            var result = calc.calculate({
                solutes: [{ name: 'CustomSolute', concentration: 100, unit: 'mM', mw: 100, ions: 1, phi: 1.0 }]
            });
            expect(result.totalOsmolality).toBe(100);
        });

        it('should throw for missing solutes array', function () {
            expect(function () { calc.calculate({}); }).toThrow();
        });
    });

    describe('adjustTo', function () {
        it('should calculate solute needed to reach target', function () {
            var result = calc.adjustTo({
                currentOsmolality: 250,
                targetOsmolality: 300,
                solute: 'NaCl',
                volumeL: 1
            });
            expect(result.delta).toBe(50);
            expect(result.requiredMass.grams).toBeGreaterThan(0);
        });

        it('should return dilute message when already at target', function () {
            var result = calc.adjustTo({
                currentOsmolality: 320,
                targetOsmolality: 300,
                solute: 'NaCl'
            });
            expect(result.action).toBe('none_or_dilute');
        });
    });

    describe('getMediaOsmolality', function () {
        it('should return DMEM osmolality', function () {
            var result = calc.getMediaOsmolality('DMEM');
            expect(result.osmolality).toBe(320);
        });

        it('should throw for unknown media', function () {
            expect(function () { calc.getMediaOsmolality('FAKE'); }).toThrow();
        });
    });

    describe('getTargetRange', function () {
        it('should return mammalian range', function () {
            var result = calc.getTargetRange('mammalian');
            expect(result.min).toBe(270);
            expect(result.max).toBe(330);
        });
    });

    describe('listSolutes', function () {
        it('should return all solutes', function () {
            var result = calc.listSolutes();
            expect(result.length).toBeGreaterThan(10);
            expect(result[0]).toHaveProperty('key');
            expect(result[0]).toHaveProperty('mw');
        });
    });

    describe('mix', function () {
        it('should calculate weighted average', function () {
            var result = calc.mix({
                solution1: { osmolality: 300, volumeL: 0.5 },
                solution2: { osmolality: 100, volumeL: 0.5 }
            });
            expect(result.mixedOsmolality).toBe(200);
        });

        it('should handle unequal volumes', function () {
            var result = calc.mix({
                solution1: { osmolality: 300, volumeL: 0.75 },
                solution2: { osmolality: 100, volumeL: 0.25 }
            });
            expect(result.mixedOsmolality).toBe(250);
        });
    });
});
