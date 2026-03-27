'use strict';

var mod = require('../docs/shared/serialDilution');

describe('Serial Dilution Calculator', function () {
    var calc;

    beforeEach(function () {
        calc = mod.createSerialDilutionCalculator();
    });

    test('calculates 1:10 serial dilution', function () {
        var result = calc.calculate({
            initialConcentration: 1000,
            dilutionFactor: 10,
            steps: 3,
            finalVolume: 1
        });
        expect(result.steps).toHaveLength(3);
        expect(result.steps[0].concentration).toBe(100);
        expect(result.steps[1].concentration).toBe(10);
        expect(result.steps[2].concentration).toBe(1);
        expect(result.totalDilution).toBe(1000);
        expect(result.steps[0].transferVolume).toBe(0.1);
        expect(result.steps[0].diluentVolume).toBe(0.9);
    });

    test('calculates 1:2 serial dilution', function () {
        var result = calc.calculate({
            initialConcentration: 100,
            dilutionFactor: 2,
            steps: 4,
            finalVolume: 2
        });
        expect(result.steps[0].concentration).toBe(50);
        expect(result.steps[3].concentration).toBe(6.25);
        expect(result.steps[0].transferVolume).toBe(1);
        expect(result.steps[0].diluentVolume).toBe(1);
    });

    test('calculateToTarget finds correct steps', function () {
        var result = calc.calculateToTarget({
            initialConcentration: 10000,
            targetConcentration: 1,
            dilutionFactor: 10,
            finalVolume: 1
        });
        expect(result.steps).toHaveLength(4);
        expect(result.finalConcentration).toBe(1);
    });

    test('preset half scheme works', function () {
        var result = calc.preset('half', 64, 6, 1);
        expect(result.steps[5].concentration).toBe(1);
    });

    test('preset tenth scheme works', function () {
        var result = calc.preset('tenth', 1000000, 3, 1);
        expect(result.steps[2].concentration).toBe(1000);
    });

    test('format returns readable output', function () {
        var result = calc.calculate({
            initialConcentration: 100,
            dilutionFactor: 10,
            steps: 2,
            finalVolume: 1,
            unit: 'ng/mL'
        });
        var text = calc.format(result);
        expect(text).toContain('ng/mL');
        expect(text).toContain('1:100');
    });

    test('rejects invalid inputs', function () {
        expect(function () { calc.calculate({}); }).toThrow();
        expect(function () { calc.calculate({ initialConcentration: 100, dilutionFactor: 0.5, steps: 1, finalVolume: 1 }); }).toThrow();
        expect(function () { calc.calculateToTarget({ initialConcentration: 10, targetConcentration: 100, dilutionFactor: 2 }); }).toThrow();
        expect(function () { calc.preset('unknown', 100, 3, 1); }).toThrow();
    });
});
