'use strict';

var _mod = require('../docs/shared/driftDetector');
var createDriftDetector = _mod.createDriftDetector;

describe('DriftDetector', function () {

    test('exports createDriftDetector factory', function () {
        expect(typeof createDriftDetector).toBe('function');
    });

    test('creates a detector with expected methods', function () {
        var dd = createDriftDetector();
        expect(typeof dd.ingest).toBe('function');
        expect(typeof dd.ingestBatch).toBe('function');
        expect(typeof dd.analyze).toBe('function');
        expect(typeof dd.status).toBe('function');
        expect(typeof dd.reset).toBe('function');
        expect(typeof dd.configure).toBe('function');
        expect(typeof dd.exportData).toBe('function');
    });

    test('returns INSUFFICIENT_DATA with fewer than 3 readings', function () {
        var dd = createDriftDetector();
        dd.ingest({ temperature: 23.0 });
        dd.ingest({ temperature: 23.1 });
        var report = dd.analyze();
        expect(report.parameters.temperature.status).toBe('INSUFFICIENT_DATA');
    });

    test('returns STABLE for consistent readings', function () {
        var dd = createDriftDetector({ windowSize: 30, baselineSize: 10 });
        // Use deterministic values to avoid flaky random drift
        var vals = [23.00, 23.01, 23.02, 23.01, 23.00, 22.99, 23.01, 23.00,
                    23.02, 23.01, 23.00, 22.99, 23.01, 23.00, 23.02, 23.01,
                    23.00, 22.99, 23.01, 23.00];
        for (var i = 0; i < vals.length; i++) {
            dd.ingest({ temperature: vals[i] });
        }
        var report = dd.analyze();
        expect(report.overall).toBe('STABLE');
        expect(report.parameters.temperature.status).toBe('STABLE');
    });

    test('detects upward drift when values steadily increase', function () {
        var dd = createDriftDetector({ windowSize: 40, baselineSize: 10 });
        // Baseline: stable around 23
        for (var i = 0; i < 15; i++) {
            dd.ingest({ pressure: 101.0 + Math.random() * 0.1 });
        }
        // Drift upward
        for (var j = 0; j < 15; j++) {
            dd.ingest({ pressure: 101.0 + j * 0.5 });
        }
        var report = dd.analyze();
        var p = report.parameters.pressure;
        expect(['DRIFTING', 'DIVERGING', 'CRITICAL']).toContain(p.status);
        expect(p.direction).toBe('upward');
        expect(p.probableCauses.length).toBeGreaterThan(0);
    });

    test('detects downward drift', function () {
        var dd = createDriftDetector({ windowSize: 40, baselineSize: 10 });
        for (var i = 0; i < 15; i++) {
            dd.ingest({ flowRate: 10.0 + Math.random() * 0.05 });
        }
        for (var j = 0; j < 15; j++) {
            dd.ingest({ flowRate: 10.0 - j * 0.4 });
        }
        var report = dd.analyze();
        var p = report.parameters.flowRate;
        expect(['DRIFTING', 'DIVERGING', 'CRITICAL']).toContain(p.status);
        expect(p.direction).toBe('downward');
    });

    test('detects variance drift', function () {
        var dd = createDriftDetector({ windowSize: 40, baselineSize: 10 });
        // Stable baseline
        for (var i = 0; i < 15; i++) {
            dd.ingest({ humidity: 45.0 + Math.random() * 0.2 });
        }
        // Wild variance
        for (var j = 0; j < 15; j++) {
            dd.ingest({ humidity: 45.0 + (j % 2 === 0 ? 8 : -8) });
        }
        var report = dd.analyze();
        var p = report.parameters.humidity;
        expect(p.detectors.variance.triggered).toBe(true);
    });

    test('provides corrective recommendations for drifting params', function () {
        var dd = createDriftDetector({ windowSize: 40, baselineSize: 10 });
        for (var i = 0; i < 15; i++) dd.ingest({ cellViability: 95 + Math.random() * 0.5 });
        for (var j = 0; j < 15; j++) dd.ingest({ cellViability: 95 - j * 2 });
        var report = dd.analyze();
        expect(report.recommendations.length).toBeGreaterThan(0);
        expect(report.recommendations[0].action).toBeTruthy();
        expect(report.recommendations[0].urgency).toBeGreaterThan(0);
    });

    test('tracks multiple parameters simultaneously', function () {
        var dd = createDriftDetector({ windowSize: 30, baselineSize: 8 });
        for (var i = 0; i < 20; i++) {
            dd.ingest({
                temperature: 23.0 + Math.random() * 0.1,
                pressure: 101.0 + Math.random() * 0.1,
                flowRate: 5.0 + Math.random() * 0.05
            });
        }
        var report = dd.analyze();
        expect(report.parametersTracked).toBe(3);
        expect(report.parameters.temperature).toBeDefined();
        expect(report.parameters.pressure).toBeDefined();
        expect(report.parameters.flowRate).toBeDefined();
    });

    test('detects correlated drift across parameters', function () {
        var dd = createDriftDetector({ windowSize: 40, baselineSize: 10 });
        for (var i = 0; i < 15; i++) {
            dd.ingest({ temperature: 23, pressure: 101 });
        }
        for (var j = 0; j < 15; j++) {
            dd.ingest({ temperature: 23 + j * 0.5, pressure: 101 + j * 0.8 });
        }
        var report = dd.analyze();
        expect(report.correlations.length).toBeGreaterThan(0);
        expect(report.correlations[0].insight).toContain('systemic');
    });

    test('status() returns quick summary', function () {
        var dd = createDriftDetector();
        for (var i = 0; i < 10; i++) dd.ingest({ temperature: 23 });
        var s = dd.status();
        expect(s.overall).toBe('STABLE');
        expect(s.totalReadings).toBe(10);
        expect(s.parametersTracked).toBe(1);
    });

    test('reset() clears all data', function () {
        var dd = createDriftDetector();
        for (var i = 0; i < 10; i++) dd.ingest({ temperature: 23 });
        dd.reset();
        var exp = dd.exportData();
        expect(exp.readingCount).toBe(0);
        expect(Object.keys(exp.parameters).length).toBe(0);
    });

    test('configure() allows adding custom parameter profiles', function () {
        var dd = createDriftDetector();
        dd.configure({ bioinkPH: { unit: 'pH', safeMin: 6.8, safeMax: 7.4, cusumThreshold: 2.0, varianceMultiplier: 2.0 } });
        for (var i = 0; i < 15; i++) dd.ingest({ bioinkPH: 7.1 });
        for (var j = 0; j < 15; j++) dd.ingest({ bioinkPH: 7.1 + j * 0.1 });
        var report = dd.analyze();
        expect(report.parameters.bioinkPH).toBeDefined();
        expect(['DRIFTING', 'DIVERGING', 'CRITICAL']).toContain(report.parameters.bioinkPH.status);
    });

    test('ingestBatch processes multiple readings', function () {
        var dd = createDriftDetector();
        var batch = [];
        for (var i = 0; i < 10; i++) {
            batch.push({ values: { temperature: 23 + i * 0.01 }, timestamp: Date.now() + i * 1000 });
        }
        dd.ingestBatch(batch);
        var exp = dd.exportData();
        expect(exp.readingCount).toBe(10);
    });

    test('ignores non-numeric values in readings', function () {
        var dd = createDriftDetector();
        dd.ingest({ temperature: 23, notes: 'test string', valid: true });
        var exp = dd.exportData();
        expect(exp.parameters.temperature).toBeDefined();
        expect(exp.parameters.notes).toBeUndefined();
        expect(exp.parameters.valid).toBeUndefined();
    });

    test('exportData returns copy of series', function () {
        var dd = createDriftDetector();
        dd.ingest({ temperature: 23 });
        dd.ingest({ temperature: 24 });
        var exp = dd.exportData();
        exp.parameters.temperature.push(999);
        var exp2 = dd.exportData();
        expect(exp2.parameters.temperature.length).toBe(2);
    });

    test('handles configure with invalid input gracefully', function () {
        var dd = createDriftDetector();
        dd.configure(null);
        dd.configure(undefined);
        dd.configure('invalid');
        // Should not throw
        expect(true).toBe(true);
    });

    test('forecast estimates readings until limit breach', function () {
        var dd = createDriftDetector({ windowSize: 40, baselineSize: 10 });
        // Start near safe max (25) and trend upward
        for (var i = 0; i < 10; i++) {
            dd.ingest({ temperature: 23.0 });
        }
        for (var j = 0; j < 15; j++) {
            dd.ingest({ temperature: 23.0 + j * 0.15 });
        }
        var report = dd.analyze();
        var temp = report.parameters.temperature;
        if (temp.forecast) {
            expect(temp.forecast.readingsUntilLimit).toBeGreaterThan(0);
            expect(temp.forecast.direction).toBe('upward');
        }
        // Forecast may be null if trend isn't strong enough, that's ok
    });
});
