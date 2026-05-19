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

        it('clamps points below 2 up to 2', function () {
            var s = calc.suggestStandards({ maxConcentration: 1.0, points: 1 });
            expect(s.count).toBe(2);
            expect(s.concentrations.length).toBe(2);
        });

        it('clamps points above 12 down to 12', function () {
            var s = calc.suggestStandards({ maxConcentration: 1.0, points: 50 });
            expect(s.count).toBe(12);
            expect(s.concentrations.length).toBe(12);
        });

        it('defaults to 6 points when not specified', function () {
            var s = calc.suggestStandards({ maxConcentration: 1.0 });
            expect(s.count).toBe(6);
        });

        it('throws when options missing', function () {
            expect(function () { calc.suggestStandards(); }).toThrow(/options required/);
        });

        it('throws when max <= min', function () {
            expect(function () {
                calc.suggestStandards({ minConcentration: 1, maxConcentration: 1 });
            }).toThrow(/maxConcentration/);
        });

        it('includes a serial dilution tip referencing the stock', function () {
            var s = calc.suggestStandards({ maxConcentration: 4.0 });
            expect(s.tip).toContain('4');
            expect(s.tip.toLowerCase()).toContain('dilution');
        });
    });

    // -- Additional edge-case coverage --------------------------------

    describe('fitCurve - edge cases', function () {
        it('throws when opts missing', function () {
            expect(function () { calc.fitCurve(); }).toThrow(/standards/);
        });

        it('throws when standards is not an array', function () {
            expect(function () { calc.fitCurve({ standards: 'nope' }); })
                .toThrow(/standard/);
        });

        it('throws when all X (concentration) values are identical', function () {
            // Exercises the all-X-same guard in the linear regression adapter.
            var degenerate = [
                { concentration: 1, signal: 0.5 },
                { concentration: 1, signal: 0.6 },
                { concentration: 1, signal: 0.7 }
            ];
            expect(function () { calc.fitCurve({ standards: degenerate }); })
                .toThrow(/identical/);
        });

        it('reports rSquared = 1 for a perfect line', function () {
            var perfect = [
                { concentration: 0, signal: 0 },
                { concentration: 1, signal: 2 },
                { concentration: 2, signal: 4 },
                { concentration: 3, signal: 6 }
            ];
            var c = calc.fitCurve({ standards: perfect });
            expect(c.slope).toBeCloseTo(2, 6);
            expect(c.intercept).toBeCloseTo(0, 6);
            expect(c.rSquared).toBeCloseTo(1, 6);
            expect(c.quality).toBe('excellent');
        });

        it('classifies quality buckets based on rSquared', function () {
            // Build a noisy curve and verify the quality string is one of the
            // four buckets and matches the threshold logic.
            var noisy = [
                { concentration: 0, signal: 0.1 },
                { concentration: 1, signal: 1.4 },
                { concentration: 2, signal: 1.8 },
                { concentration: 3, signal: 3.5 }
            ];
            var c = calc.fitCurve({ standards: noisy });
            expect(['excellent','good','acceptable','poor']).toContain(c.quality);
            if (c.rSquared >= 0.99) expect(c.quality).toBe('excellent');
            else if (c.rSquared >= 0.95) expect(c.quality).toBe('good');
            else if (c.rSquared >= 0.90) expect(c.quality).toBe('acceptable');
            else expect(c.quality).toBe('poor');
        });

        it('reports the concentration range', function () {
            var c = calc.fitCurve({ standards: stds });
            expect(c.range.min).toBe(0);
            expect(c.range.max).toBe(2.0);
            expect(c.n).toBe(stds.length);
        });
    });

    describe('interpolate - edge cases', function () {
        it('warns below the standard range', function () {
            var curve = calc.fitCurve({ standards: stds });
            var r = calc.interpolate({ curve: curve, signal: -10 });
            expect(r.withinRange).toBe(false);
            expect(r.warning).toMatch(/[Bb]elow/);
        });

        it('throws when curve missing', function () {
            expect(function () { calc.interpolate({ signal: 0.5 }); }).toThrow(/curve/);
        });

        it('throws when signal is not a number', function () {
            var curve = calc.fitCurve({ standards: stds });
            expect(function () { calc.interpolate({ curve: curve, signal: 'abc' }); })
                .toThrow(/number/);
        });

        it('throws when slope is zero', function () {
            var flatCurve = { slope: 0, intercept: 0.5, range: { min: 0, max: 1 } };
            expect(function () { calc.interpolate({ curve: flatCurve, signal: 0.5 }); })
                .toThrow(/[Ss]lope/);
        });

        it('round-trips: interpolating a standards signal recovers concentration', function () {
            var perfect = [
                { concentration: 0, signal: 0.0 },
                { concentration: 1, signal: 1.0 },
                { concentration: 2, signal: 2.0 }
            ];
            var curve = calc.fitCurve({ standards: perfect });
            var r = calc.interpolate({ curve: curve, signal: 1.5 });
            expect(r.concentration).toBeCloseTo(1.5, 4);
            expect(r.signal).toBe(1.5);
            expect(r.withinRange).toBe(true);
        });
    });

    describe('interpolateBatch - edge cases', function () {
        it('throws when curve missing', function () {
            expect(function () { calc.interpolateBatch({ signals: [0.1] }); })
                .toThrow(/curve/);
        });

        it('throws when signals not an array', function () {
            var curve = calc.fitCurve({ standards: stds });
            expect(function () { calc.interpolateBatch({ curve: curve, signals: 'nope' }); })
                .toThrow(/signals/);
        });

        it('returns empty array for empty input', function () {
            var curve = calc.fitCurve({ standards: stds });
            expect(calc.interpolateBatch({ curve: curve, signals: [] })).toEqual([]);
        });
    });

    describe('residuals - edge cases', function () {
        it('throws when curve or standards missing', function () {
            expect(function () { calc.residuals({ standards: stds }); }).toThrow();
            expect(function () { calc.residuals({ curve: {} }); }).toThrow();
        });

        it('residuals on a perfect line are ~0', function () {
            var perfect = [
                { concentration: 0, signal: 0 },
                { concentration: 1, signal: 2 },
                { concentration: 2, signal: 4 }
            ];
            var curve = calc.fitCurve({ standards: perfect });
            var res = calc.residuals({ curve: curve, standards: perfect });
            res.forEach(function (r) { expect(Math.abs(r.residual)).toBeLessThan(1e-6); });
        });
    });

    describe('detectionLimits - edge cases', function () {
        it('LOQ is always >= LOD', function () {
            var curve = calc.fitCurve({ standards: stds });
            var lim = calc.detectionLimits({
                curve: curve,
                blankSignals: [0.048, 0.051, 0.053, 0.049, 0.050, 0.047, 0.052]
            });
            expect(lim.LOQ).toBeGreaterThanOrEqual(lim.LOD);
            expect(lim.blankMean).toBeGreaterThan(0);
            expect(lim.blankSD).toBeGreaterThanOrEqual(0);
        });

        it('uses absolute slope so a negative slope still yields positive LOD/LOQ', function () {
            var curve = { slope: -2, intercept: 1, range: { min: 0, max: 1 } };
            var lim = calc.detectionLimits({ curve: curve, blankSignals: [0.1, 0.2, 0.15] });
            expect(lim.LOD).toBeGreaterThan(0);
            expect(lim.LOQ).toBeGreaterThan(0);
        });

        it('throws when curve missing', function () {
            expect(function () { calc.detectionLimits({ blankSignals: [0.1, 0.2] }); })
                .toThrow(/curve/);
        });

        it('throws on zero slope', function () {
            var flatCurve = { slope: 0, intercept: 0.5, range: { min: 0, max: 1 } };
            expect(function () {
                calc.detectionLimits({ curve: flatCurve, blankSignals: [0.1, 0.2, 0.15] });
            }).toThrow(/[Ss]lope/);
        });
    });
});
