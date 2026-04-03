'use strict';

var mod = require('../docs/shared/growthCurve');

describe('GrowthCurveAnalyzer', function () {
    var analyzer;
    beforeEach(function () {
        analyzer = mod.createGrowthCurveAnalyzer();
    });

    var sampleData = {
        timepoints: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24],
        counts:     [1e4, 1.1e4, 1.2e4, 2e4, 5e4, 1.5e5, 4e5, 9e5, 1.5e6, 1.8e6, 1.9e6, 1.9e6, 1.85e6],
        timeUnit: 'hours',
        label: 'HeLa 37°C'
    };

    test('analyze returns expected structure', function () {
        var result = analyzer.analyze(sampleData);
        expect(result.label).toBe('HeLa 37°C');
        expect(result.timeUnit).toBe('hours');
        expect(result.dataPoints).toBe(13);
        expect(result.summary.minCount).toBe(1e4);
        expect(result.summary.maxCount).toBe(1.9e6);
        expect(result.summary.foldChange).toBeGreaterThan(1);
        expect(result.phases.length).toBeGreaterThan(0);
        expect(result.growthRates.length).toBe(12);
        expect(result.logisticFit.r2).toBeDefined();
        expect(result.logisticFit.predicted.length).toBe(13);
    });

    test('detects log phase and doubling time', function () {
        var result = analyzer.analyze(sampleData);
        var logPhase = result.phases.find(function (p) { return p.name.indexOf('Log') === 0; });
        expect(logPhase).toBeDefined();
        if (result.summary.doublingTime !== null) {
            expect(result.summary.doublingTime).toBeGreaterThan(0);
        }
    });

    test('compare ranks datasets by doubling time', function () {
        var fast = {
            timepoints: [0, 2, 4, 6, 8],
            counts: [100, 400, 1600, 6400, 25600],
            label: 'Fast'
        };
        var slow = {
            timepoints: [0, 2, 4, 6, 8],
            counts: [100, 150, 225, 338, 506],
            label: 'Slow'
        };
        var cmp = analyzer.compare([fast, slow]);
        expect(cmp.count).toBe(2);
        expect(cmp.fastest).toBe('Fast');
        expect(cmp.slowest).toBe('Slow');
        expect(cmp.ranking.length).toBe(2);
    });

    test('toCSV returns CSV string', function () {
        var result = analyzer.analyze(sampleData);
        var csv = analyzer.toCSV(result);
        expect(csv).toContain('Time,Count,GrowthRate,Phase,LogisticFit');
        expect(csv.split('\n').length).toBeGreaterThan(1);
    });

    test('validates input', function () {
        expect(function () { analyzer.analyze({}); }).toThrow();
        expect(function () { analyzer.analyze({ timepoints: [1], counts: [1, 2] }); }).toThrow();
        expect(function () { analyzer.analyze({ timepoints: [1, 2], counts: [1, 2] }); }).toThrow('at least 3');
    });

    test('compare rejects fewer than 2 datasets', function () {
        expect(function () { analyzer.compare([sampleData]); }).toThrow('at least 2');
    });
});
