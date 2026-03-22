'use strict';

var pipetteCalibration = require('../docs/shared/pipetteCalibration');

describe('PipetteCalibrationChecker', function () {
    var checker;

    beforeEach(function () {
        checker = pipetteCalibration.createPipetteCalibrationChecker();
    });

    test('passes for accurate 100 µL pipette', function () {
        var result = checker.check({
            nominalVolume: 100,
            measurements: [99.8, 100.1, 99.9, 100.0, 100.1, 99.9, 100.0, 100.1, 99.9, 100.0]
        });
        expect(result.pass).toBe(true);
        expect(result.grade).toBe('PASS');
        expect(result.n).toBe(10);
        expect(typeof result.mean).toBe('number');
        expect(typeof result.cv).toBe('number');
    });

    test('fails systematic error for biased pipette', function () {
        // All readings ~2% high
        var result = checker.check({
            nominalVolume: 100,
            measurements: [102.0, 102.1, 102.0, 101.9, 102.0, 102.1, 102.0, 101.9, 102.0, 102.1]
        });
        expect(result.passSystematic).toBe(false);
        expect(result.grade).toBe('FAIL');
        expect(result.recommendation).toMatch(/systematic/i);
    });

    test('fails random error for imprecise pipette', function () {
        var result = checker.check({
            nominalVolume: 100,
            measurements: [99.0, 101.0, 98.5, 101.5, 99.0, 101.0, 98.5, 101.5, 99.0, 101.0]
        });
        expect(result.passRandom).toBe(false);
        expect(result.grade).toBe('FAIL');
    });

    test('works with small volumes (10 µL)', function () {
        var result = checker.check({
            nominalVolume: 10,
            measurements: [9.95, 10.05, 9.98, 10.02, 10.00]
        });
        expect(result.pass).toBe(true);
        expect(result.iso8655.maxSystematicPct).toBe(1.2);
    });

    test('applies Z-factor for temperature', function () {
        var r22 = checker.check({ nominalVolume: 100, measurements: [100, 100, 100], waterTemperature: 22 });
        var r30 = checker.check({ nominalVolume: 100, measurements: [100, 100, 100], waterTemperature: 30 });
        // Higher temp → higher Z → slightly higher volume
        expect(r30.mean).toBeGreaterThan(r22.mean);
    });

    test('throws on invalid input', function () {
        expect(function () { checker.check({}); }).toThrow(/nominalVolume/);
        expect(function () { checker.check({ nominalVolume: 100, measurements: [1] }); }).toThrow(/at least 2/);
    });
});
