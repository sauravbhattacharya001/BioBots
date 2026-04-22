'use strict';

var tracker = require('../docs/shared/protocolDeviation');

describe('Protocol Deviation Tracker', function () {
    var t;

    beforeEach(function () {
        t = tracker.createProtocolDeviationTracker();
    });

    test('registerProtocol returns summary', function () {
        var res = t.registerProtocol('P-001', {
            temperature: { target: 37, tolerance: 2 },
            pressure: { target: 100, tolerance: 10, category: 'pressure' }
        });
        expect(res.protocolId).toBe('P-001');
        expect(res.parameterCount).toBe(2);
    });

    test('checkReadings detects no deviation when in spec', function () {
        t.registerProtocol('P-001', { temperature: { target: 37, tolerance: 2 } });
        var report = t.checkReadings('P-001', { temperature: 37.5 });
        expect(report.deviationsFound).toBe(0);
        expect(report.maxSeverity).toBe('NONE');
        expect(report.proceedRecommendation).toBe(true);
    });

    test('checkReadings detects minor deviation', function () {
        t.registerProtocol('P-001', { temperature: { target: 37, tolerance: 2 } });
        var report = t.checkReadings('P-001', { temperature: 41 }); // ~10.8% off
        expect(report.deviationsFound).toBe(1);
        expect(report.deviations[0].severity).toBe('MINOR');
        expect(report.proceedRecommendation).toBe(true);
    });

    test('checkReadings detects critical deviation', function () {
        t.registerProtocol('P-001', { temperature: { target: 37, tolerance: 2 } });
        var report = t.checkReadings('P-001', { temperature: 60 }); // ~62% off
        expect(report.deviationsFound).toBe(1);
        expect(report.deviations[0].severity).toBe('CRITICAL');
        expect(report.proceedRecommendation).toBe(false);
    });

    test('checkReadings includes CAPA recommendations', function () {
        t.registerProtocol('P-001', { temperature: { target: 37, tolerance: 2 } });
        var report = t.checkReadings('P-001', { temperature: 50 });
        expect(report.deviations[0].capa.corrective).toBeTruthy();
        expect(report.deviations[0].capa.preventive).toBeTruthy();
    });

    test('throws on unregistered protocol', function () {
        expect(function () { t.checkReadings('NOPE', {}); }).toThrow(/not registered/);
    });

    test('resolveDeviation updates status', function () {
        t.registerProtocol('P-001', { temperature: { target: 37, tolerance: 2 } });
        t.checkReadings('P-001', { temperature: 60 });
        var log = t.getLog();
        var resolved = t.resolveDeviation(log[0].id, 'Corrected', 'Recalibrated sensor');
        expect(resolved.status).toBe('RESOLVED');
        expect(resolved.disposition).toBe('Corrected');
    });

    test('analyzeTrends detects recurring deviations', function () {
        t.registerProtocol('P-001', { temperature: { target: 37, tolerance: 2 } });
        t.checkReadings('P-001', { temperature: 50 });
        t.checkReadings('P-001', { temperature: 48 });
        t.checkReadings('P-001', { temperature: 55 });
        var trends = t.analyzeTrends();
        expect(trends.totalDeviations).toBe(3);
        expect(trends.recurringDeviations.length).toBeGreaterThan(0);
    });

    test('getLog filters by severity', function () {
        t.registerProtocol('P-001', { temperature: { target: 37, tolerance: 2 } });
        t.checkReadings('P-001', { temperature: 41 }); // minor
        t.checkReadings('P-001', { temperature: 60 }); // critical
        var critical = t.getLog({ severity: 'CRITICAL' });
        expect(critical.length).toBe(1);
    });

    test('generateReport includes summary stats', function () {
        t.registerProtocol('P-001', { temperature: { target: 37, tolerance: 2 } });
        t.checkReadings('P-001', { temperature: 60 });
        t.resolveDeviation('DEV-0001', 'Fixed', 'Done');
        var report = t.generateReport('P-001');
        expect(report.totalDeviations).toBe(1);
        expect(report.resolvedDeviations).toBe(1);
        expect(report.resolutionRate).toBe(100);
    });
});
