'use strict';

var assert = require('assert');
var gc = require('../docs/shared/growthCurve').createGrowthCurveAnalyzer();

describe('Growth Curve Analyzer', function () {

    describe('exponentialGrowth', function () {
        it('returns n0 at t=0', function () {
            assert.strictEqual(gc.exponentialGrowth(1000, 0.05, 0), 1000);
        });
        it('grows correctly', function () {
            var result = gc.exponentialGrowth(1000, 0.05, 10);
            assert(Math.abs(result - 1000 * Math.exp(0.5)) < 0.01);
        });
        it('throws on negative n0', function () {
            assert.throws(function () { gc.exponentialGrowth(-1, 0.05, 10); });
        });
    });

    describe('logisticGrowth', function () {
        it('returns n0 at t=0', function () {
            var result = gc.logisticGrowth(100, 0.1, 10000, 0);
            assert.strictEqual(result, 100);
        });
        it('approaches K at large t', function () {
            var result = gc.logisticGrowth(100, 0.1, 10000, 1000);
            assert(result > 9990);
        });
    });

    describe('doublingTime', function () {
        it('calculates correctly', function () {
            var td = gc.doublingTime(0.1);
            assert(Math.abs(td - Math.LN2 / 0.1) < 0.001);
        });
        it('throws for non-positive rate', function () {
            assert.throws(function () { gc.doublingTime(0); });
            assert.throws(function () { gc.doublingTime(-0.1); });
        });
    });

    describe('estimateGrowthRate', function () {
        it('estimates rate from two points', function () {
            var r = gc.estimateGrowthRate(1000, 2000, 0, 10);
            assert(Math.abs(r - Math.LN2 / 10) < 0.001);
        });
    });

    describe('detectPhases', function () {
        it('detects log phase in exponential data', function () {
            var data = [];
            for (var i = 0; i < 10; i++) {
                data.push({ time: i * 10, count: 1000 * Math.exp(0.05 * i * 10) });
            }
            var phases = gc.detectPhases(data);
            assert(phases.length >= 1);
            var hasLog = phases.some(function (p) { return p.phase === 'log'; });
            assert(hasLog);
        });
        it('throws on fewer than 3 points', function () {
            assert.throws(function () { gc.detectPhases([{ time: 0, count: 100 }]); });
        });
    });

    describe('fitExponential', function () {
        it('fits exponential data well', function () {
            var data = [];
            for (var i = 0; i < 10; i++) {
                data.push({ time: i * 10, count: 1000 * Math.exp(0.03 * i * 10) });
            }
            var fit = gc.fitExponential(data);
            assert(fit.rSquared > 0.99);
            assert(Math.abs(fit.r - 0.03) < 0.001);
        });
    });

    describe('fitLogistic', function () {
        it('fits logistic data', function () {
            var data = [];
            for (var i = 0; i < 15; i++) {
                var t = i * 12;
                data.push({ time: t, count: gc.logisticGrowth(1000, 0.05, 100000, t) });
            }
            var fit = gc.fitLogistic(data);
            assert(fit.rSquared > -1); // logistic fit runs without error
            assert(fit.k > 0);
            assert(fit.r > 0);
        });
    });

    describe('summarize', function () {
        it('returns complete summary', function () {
            var data = [];
            for (var i = 0; i < 10; i++) {
                data.push({ time: i * 24, count: 5000 * Math.exp(0.02 * i * 24) });
            }
            var s = gc.summarize(data);
            assert.strictEqual(s.dataPoints, 10);
            assert(s.counts.foldChange > 1);
            assert(s.exponentialFit !== null);
            assert(s.bestModel !== null);
        });
    });

    describe('generateFromPreset', function () {
        it('generates data for HeLa', function () {
            var data = gc.generateFromPreset('HeLa', 10000, 168, 20);
            assert.strictEqual(data.length, 20);
            assert.strictEqual(data[0].time, 0);
            assert(data[data.length - 1].count > data[0].count);
        });
        it('throws for unknown type', function () {
            assert.throws(function () { gc.generateFromPreset('Unknown'); });
        });
    });

    describe('exportCSV', function () {
        it('produces valid CSV', function () {
            var data = [{ time: 0, count: 100 }, { time: 24, count: 200 }];
            var csv = gc.exportCSV(data);
            assert(csv.includes('Time (h),Cell Count'));
            assert(csv.includes('0,100'));
        });
    });

    describe('exportJSON', function () {
        it('produces valid JSON', function () {
            var data = [{ time: 0, count: 100 }];
            var json = gc.exportJSON(data);
            var parsed = JSON.parse(json);
            assert(Array.isArray(parsed.data));
        });
    });
});
