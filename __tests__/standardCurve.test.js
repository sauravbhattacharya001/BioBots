'use strict';

var sc = require('../docs/shared/standardCurve');

describe('Standard Curve Calculator', function () {
    var calc;
    beforeEach(function () { calc = sc.createStandardCurveCalculator(); });

    var stds = [
        { concentration: 0, signal: 0.05 },
        { concentration: 0.25, signal: 0.18 },
        { concentration: 0.5, signal: 0.34 },
        { concentration: 1.0, signal: 0.65 },
        { concentration: 2.0, signal: 1.28 }
    ];

    describe('fitCurve', function () {
        it('returns slope, intercept, rSquared', function () {
            var c = calc.fitCurve({ standards: stds });
            expect(c.slope).toBeGreaterThan(0);
            expect(c.rSquared).toBeGreaterThan(0.95);
            expect(c.equation).toContain('signal');
            expect(['excellent','good','acceptable','poor']).toContain(c.quality);
        });

        it('rejects less than 2 points', function () {
            expect(function () { calc.fitCurve({ standards: [stds[0]] }); }).toThrow();
        });

        it('rejects missing fields', function () {
            expect(function () { calc.fitCurve({ standards: [{ concentration: 1 }, { concentration: 2 }] }); }).toThrow();
        });
    });

    describe('interpolate', function () {
        it('returns concentration within range', function () {
            var curve = calc.fitCurve({ standards: stds });
            var r = calc.interpolate({ curve: curve, signal: 0.50 });
            expect(r.concentration).toBeGreaterThan(0);
            expect(r.withinRange).toBe(true);
        });

        it('warns when out of range', function () {
            var curve = calc.fitCurve({ standards: stds });
            var r = calc.interpolate({ curve: curve, signal: 5.0 });
            expect(r.withinRange).toBe(false);
            expect(r.warning).toBeDefined();
        });
    });

    describe('interpolateBatch', function () {
        it('processes multiple signals', function () {
            var curve = calc.fitCurve({ standards: stds });
            var results = calc.interpolateBatch({ curve: curve, signals: [0.20, 0.50, 1.00] });
            expect(results.length).toBe(3);
            results.forEach(function (r) { expect(typeof r.concentration).toBe('number'); });
        });
    });

    describe('residuals', function () {
        it('returns one residual per standard', function () {
            var curve = calc.fitCurve({ standards: stds });
            var res = calc.residuals({ curve: curve, standards: stds });
            expect(res.length).toBe(stds.length);
            res.forEach(function (r) { expect(typeof r.residual).toBe('number'); });
        });
    });

    describe('detectionLimits', function () {
        it('calculates LOD and LOQ', function () {
            var curve = calc.fitCurve({ standards: stds });
            var lim = calc.detectionLimits({ curve: curve, blankSignals: [0.048, 0.051, 0.053, 0.049, 0.050] });
            expect(lim.LOD).toBeGreaterThan(0);
            expect(lim.LOQ).toBeGreaterThan(lim.LOD);
        });

        it('rejects fewer than 2 blanks', function () {
            var curve = calc.fitCurve({ standards: stds });
            expect(function () { calc.detectionLimits({ curve: curve, blankSignals: [0.05] }); }).toThrow();
        });
    });

    describe('suggestStandards', function () {
        it('returns evenly spaced concentrations', function () {
            var s = calc.suggestStandards({ minConcentration: 0, maxConcentration: 2.0, points: 5 });
            expect(s.concentrations.length).toBe(5);
            expect(s.concentrations[0]).toBe(0);
            expect(s.concentrations[4]).toBe(2.0);
        });
    });
});
