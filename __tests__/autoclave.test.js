'use strict';

var autoclave = require('../docs/shared/autoclave');

describe('Autoclave Cycle Logger', function () {
    var logger;

    beforeEach(function () {
        logger = autoclave.createAutoclaveLogger();
    });

    test('logCycle passes for valid gravity cycle', function () {
        var result = logger.logCycle({
            autoclaveId: 'AC-001',
            cycleType: 'gravity',
            temperature: 121,
            pressure: 15,
            duration: 30,
            items: ['media bottles'],
            operator: 'Test User'
        });
        expect(result.pass).toBe(true);
        expect(result.warnings).toHaveLength(0);
        expect(result.sterilizedItems).toBe(1);
    });

    test('logCycle fails when temperature is below minimum', function () {
        var result = logger.logCycle({
            cycleType: 'gravity',
            temperature: 100,
            pressure: 15,
            duration: 30
        });
        expect(result.pass).toBe(false);
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    test('logCycle warns when duration exceeds maximum', function () {
        var result = logger.logCycle({
            cycleType: 'gravity',
            temperature: 121,
            pressure: 15,
            duration: 90
        });
        expect(result.pass).toBe(true);
        expect(result.warnings.some(function (w) { return w.indexOf('exceeds') >= 0; })).toBe(true);
    });

    test('recordIndicator failure marks cycle as failed', function () {
        var cycle = logger.logCycle({
            cycleType: 'gravity',
            temperature: 121,
            pressure: 15,
            duration: 30
        });
        var ind = logger.recordIndicator({
            cycleId: cycle.cycleId,
            type: 'biological',
            result: 'fail'
        });
        expect(ind.cyclePass).toBe(false);
    });

    test('registerAutoclave and checkMaintenance', function () {
        logger.registerAutoclave({
            id: 'AC-001',
            model: 'Tuttnauer 3870',
            location: 'Lab B',
            lastMaintenance: new Date(Date.now() - 100 * 86400000).toISOString(),
            maintenanceIntervalDays: 90
        });
        var maint = logger.checkMaintenance();
        expect(maint.autoclaves).toHaveLength(1);
        expect(maint.autoclaves[0].status).toBe('overdue');
    });

    test('complianceReport returns stats', function () {
        logger.logCycle({ cycleType: 'gravity', temperature: 121, pressure: 15, duration: 30 });
        logger.logCycle({ cycleType: 'gravity', temperature: 100, pressure: 15, duration: 30 });
        var report = logger.complianceReport();
        expect(report.totalCycles).toBe(2);
        expect(report.passedCycles).toBe(1);
        expect(report.failedCycles).toBe(1);
        expect(report.passRate).toBe(50);
    });

    test('getCycles returns cycle history', function () {
        logger.logCycle({ cycleType: 'gravity', temperature: 121, pressure: 15, duration: 30 });
        var history = logger.getCycles();
        expect(history.count).toBe(1);
    });

    test('getProtocols returns all protocol definitions', function () {
        var protos = logger.getProtocols();
        expect(protos.gravity).toBeDefined();
        expect(protos.prevacuum).toBeDefined();
        expect(protos.liquid).toBeDefined();
        expect(protos.flash).toBeDefined();
        expect(protos.waste).toBeDefined();
    });

    test('throws on unknown cycle type', function () {
        expect(function () {
            logger.logCycle({ cycleType: 'unknown', temperature: 121, pressure: 15, duration: 30 });
        }).toThrow('Unknown cycle type');
    });
});
