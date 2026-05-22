'use strict';

/**
 * Extended coverage for docs/shared/autoclave.js — targets the
 * branches that the original autoclave.test.js skipped:
 *   - registerAutoclave validation + defaults
 *   - recordIndicator error paths (missing args, unknown type, unknown cycle)
 *   - checkOverdue: shelf-life expired, unwrapped immediate-use, passing window
 *   - checkMaintenance: ok / due_soon / unknown branches
 *   - complianceReport: since filter, byType breakdown, biological indicator stats
 *   - getCycles: limit + autoclaveId filter
 *   - getIndicatorTypes reference
 *   - shelfLifeHours on the logCycle response
 *   - recordIndicator success path keeps cycle.pass true
 */

var autoclave = require('../docs/shared/autoclave');

describe('Autoclave Cycle Logger — extended coverage', function () {
    var logger;

    beforeEach(function () {
        logger = autoclave.createAutoclaveLogger();
    });

    // ---- registerAutoclave -------------------------------------------------
    describe('registerAutoclave', function () {
        test('throws when called without options', function () {
            expect(function () { logger.registerAutoclave(); }).toThrow('Autoclave id is required');
        });

        test('throws when id is missing', function () {
            expect(function () { logger.registerAutoclave({ model: 'X' }); }).toThrow('Autoclave id is required');
        });

        test('applies defaults for optional fields', function () {
            var res = logger.registerAutoclave({ id: 'AC-DEFAULTS' });
            expect(res.success).toBe(true);
            expect(res.autoclave.id).toBe('AC-DEFAULTS');
            expect(res.autoclave.model).toBe('Unknown');
            expect(res.autoclave.location).toBe('Unknown');
            expect(res.autoclave.lastMaintenance).toBeNull();
            expect(res.autoclave.maintenanceIntervalDays).toBe(90);
            expect(typeof res.autoclave.registeredAt).toBe('string');
        });

        test('preserves provided model/location/interval', function () {
            var res = logger.registerAutoclave({
                id: 'AC-2',
                model: 'Tuttnauer 5075',
                location: 'BSL-2 Room',
                lastMaintenance: new Date().toISOString(),
                maintenanceIntervalDays: 30
            });
            expect(res.autoclave.model).toBe('Tuttnauer 5075');
            expect(res.autoclave.location).toBe('BSL-2 Room');
            expect(res.autoclave.maintenanceIntervalDays).toBe(30);
        });
    });

    // ---- logCycle defaults + edge branches --------------------------------
    describe('logCycle defaults', function () {
        test('throws when options are missing', function () {
            expect(function () { logger.logCycle(); }).toThrow('Cycle options are required');
        });

        test('defaults cycleType to gravity and reports shelfLifeHours', function () {
            var res = logger.logCycle({ temperature: 121, pressure: 15, duration: 30 });
            expect(res.protocol).toBe('Gravity Displacement');
            // default wrapping = single_wrap = 30 days
            expect(res.shelfLifeHours).toBe(30 * 24);
        });

        test('shelfLifeHours reflects unwrapped (immediate-use) = 0', function () {
            var res = logger.logCycle({
                cycleType: 'flash',
                temperature: 132,
                pressure: 27,
                duration: 5,
                wrapping: 'unwrapped'
            });
            expect(res.shelfLifeHours).toBe(0);
        });

        test('non-numeric pressure produces a warning', function () {
            var res = logger.logCycle({ cycleType: 'gravity', temperature: 121, pressure: 'low', duration: 30 });
            expect(res.pass).toBe(false);
            expect(res.warnings.some(function (w) { return w.indexOf('Pressure') >= 0; })).toBe(true);
        });

        test('non-numeric duration produces a warning and fails the cycle', function () {
            var res = logger.logCycle({ cycleType: 'gravity', temperature: 121, pressure: 15, duration: null });
            expect(res.pass).toBe(false);
            expect(res.warnings.some(function (w) { return w.indexOf('Duration') >= 0; })).toBe(true);
        });
    });

    // ---- recordIndicator --------------------------------------------------
    describe('recordIndicator', function () {
        var cycleId;
        beforeEach(function () {
            cycleId = logger.logCycle({
                cycleType: 'gravity', temperature: 121, pressure: 15, duration: 30
            }).cycleId;
        });

        test('throws when no options provided', function () {
            expect(function () { logger.recordIndicator(); }).toThrow('cycleId and indicator type are required');
        });

        test('throws when cycleId missing', function () {
            expect(function () { logger.recordIndicator({ type: 'biological' }); }).toThrow('cycleId and indicator type are required');
        });

        test('throws when type missing', function () {
            expect(function () { logger.recordIndicator({ cycleId: cycleId }); }).toThrow('cycleId and indicator type are required');
        });

        test('throws on unknown indicator type', function () {
            expect(function () {
                logger.recordIndicator({ cycleId: cycleId, type: 'magic_dust', result: 'pass' });
            }).toThrow('Unknown indicator type');
        });

        test('throws when cycle id does not exist', function () {
            expect(function () {
                logger.recordIndicator({ cycleId: 'CYC-does-not-exist', type: 'biological', result: 'pass' });
            }).toThrow('Cycle not found');
        });

        test('successful indicator keeps cycle.pass = true and records metadata', function () {
            var res = logger.recordIndicator({
                cycleId: cycleId,
                type: 'biological',
                result: 'pass',
                lot: 'BI-LOT-42',
                notes: '24h incubation'
            });
            expect(res.cyclePass).toBe(true);
            expect(res.indicator.result).toBe('pass');
            expect(res.indicator.lot).toBe('BI-LOT-42');
            expect(res.indicator.notes).toBe('24h incubation');
            expect(res.indicator.name).toMatch(/Biological/);
        });

        test('treats any non-"pass" result as failure', function () {
            var res = logger.recordIndicator({ cycleId: cycleId, type: 'chemical_class5', result: 'unclear' });
            expect(res.indicator.result).toBe('fail');
            expect(res.cyclePass).toBe(false);
        });
    });

    // ---- checkOverdue -----------------------------------------------------
    describe('checkOverdue', function () {
        test('returns empty when no cycles have been logged', function () {
            expect(logger.checkOverdue()).toEqual({ overdueCount: 0, overdue: [] });
        });

        test('flags unwrapped cycles as immediate-use only', function () {
            logger.logCycle({
                cycleType: 'flash',
                temperature: 132,
                pressure: 27,
                duration: 5,
                wrapping: 'unwrapped',
                items: ['forceps']
            });
            var res = logger.checkOverdue();
            expect(res.overdueCount).toBe(1);
            expect(res.overdue[0].reason).toMatch(/immediate use/);
        });

        test('flags cycles whose shelf life has expired', function () {
            // Single-wrap shelf life is 30 days. Forge a 60-day-old timestamp.
            var sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
            logger.logCycle({
                cycleType: 'gravity',
                temperature: 121,
                pressure: 15,
                duration: 30,
                wrapping: 'single_wrap',
                items: ['pipette tips'],
                timestamp: sixtyDaysAgo
            });
            var res = logger.checkOverdue();
            expect(res.overdueCount).toBe(1);
            expect(res.overdue[0].reason).toMatch(/Shelf life expired/);
            expect(res.overdue[0].expiredHoursAgo).toBeGreaterThan(0);
        });

        test('does not flag fresh cycles inside their shelf-life window', function () {
            logger.logCycle({
                cycleType: 'gravity',
                temperature: 121,
                pressure: 15,
                duration: 30,
                wrapping: 'peel_pouch',
                items: ['scissors']
            });
            expect(logger.checkOverdue().overdueCount).toBe(0);
        });

        test('ignores failed cycles (already non-sterile, not "overdue")', function () {
            logger.logCycle({
                cycleType: 'gravity',
                temperature: 100,    // forces fail
                pressure: 15,
                duration: 30,
                wrapping: 'unwrapped'
            });
            expect(logger.checkOverdue().overdueCount).toBe(0);
        });
    });

    // ---- checkMaintenance -------------------------------------------------
    describe('checkMaintenance', function () {
        test('returns empty list when no autoclaves are registered', function () {
            expect(logger.checkMaintenance()).toEqual({ autoclaves: [] });
        });

        test('status = ok when well within maintenance interval', function () {
            logger.registerAutoclave({
                id: 'AC-OK',
                lastMaintenance: new Date(Date.now() - 10 * 86400000).toISOString(),
                maintenanceIntervalDays: 90
            });
            expect(logger.checkMaintenance().autoclaves[0].status).toBe('ok');
        });

        test('status = due_soon at >80% of interval', function () {
            // 80 / 90 = 88.8% > 80%
            logger.registerAutoclave({
                id: 'AC-SOON',
                lastMaintenance: new Date(Date.now() - 80 * 86400000).toISOString(),
                maintenanceIntervalDays: 90
            });
            expect(logger.checkMaintenance().autoclaves[0].status).toBe('due_soon');
        });

        test('status = unknown when lastMaintenance is null', function () {
            logger.registerAutoclave({ id: 'AC-NEW' });
            var entry = logger.checkMaintenance().autoclaves[0];
            expect(entry.status).toBe('unknown');
            expect(entry.daysSinceLastMaintenance).toBeNull();
        });
    });

    // ---- complianceReport -------------------------------------------------
    describe('complianceReport', function () {
        test('reports zero passRate when no cycles are present', function () {
            var rep = logger.complianceReport();
            expect(rep.totalCycles).toBe(0);
            expect(rep.passRate).toBe(0);
            expect(rep.period.since).toBe('all time');
        });

        test('aggregates by cycle type and counts biological indicators', function () {
            var c1 = logger.logCycle({ cycleType: 'gravity',  temperature: 121, pressure: 15, duration: 30 });
            var c2 = logger.logCycle({ cycleType: 'prevacuum', temperature: 132, pressure: 27, duration: 10 });
            logger.logCycle({ cycleType: 'gravity', temperature: 100, pressure: 15, duration: 30 }); // fails

            logger.recordIndicator({ cycleId: c1.cycleId, type: 'biological', result: 'pass' });
            logger.recordIndicator({ cycleId: c2.cycleId, type: 'biological', result: 'fail' });

            var rep = logger.complianceReport();
            expect(rep.totalCycles).toBe(3);
            expect(rep.byType.gravity.total).toBe(2);
            expect(rep.byType.gravity.passed).toBe(1);
            expect(rep.byType.prevacuum.total).toBe(1);
            // c2 failed because its BI failed
            expect(rep.byType.prevacuum.passed).toBe(0);
            expect(rep.biologicalIndicators.tested).toBe(2);
            expect(rep.biologicalIndicators.passed).toBe(1);
        });

        test('honors the `since` time filter', function () {
            // Stale cycle (yesterday)
            logger.logCycle({
                cycleType: 'gravity', temperature: 121, pressure: 15, duration: 30,
                timestamp: new Date(Date.now() - 86400000).toISOString()
            });
            // Fresh cycle
            logger.logCycle({ cycleType: 'gravity', temperature: 121, pressure: 15, duration: 30 });

            var since = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // last hour
            var rep = logger.complianceReport({ since: since });
            expect(rep.totalCycles).toBe(1);
            expect(rep.period.since).toBe(since);
        });
    });

    // ---- getCycles --------------------------------------------------------
    describe('getCycles', function () {
        beforeEach(function () {
            logger.logCycle({ autoclaveId: 'AC-A', cycleType: 'gravity', temperature: 121, pressure: 15, duration: 30 });
            logger.logCycle({ autoclaveId: 'AC-B', cycleType: 'gravity', temperature: 121, pressure: 15, duration: 30 });
            logger.logCycle({ autoclaveId: 'AC-A', cycleType: 'liquid',  temperature: 121, pressure: 15, duration: 25 });
        });

        test('returns most-recent-first ordering', function () {
            var hist = logger.getCycles();
            expect(hist.count).toBe(3);
            // most recent is the liquid cycle on AC-A
            expect(hist.cycles[0].cycleType).toBe('liquid');
        });

        test('respects limit', function () {
            var hist = logger.getCycles({ limit: 2 });
            expect(hist.count).toBe(2);
        });

        test('filters by autoclaveId', function () {
            var hist = logger.getCycles({ autoclaveId: 'AC-A' });
            expect(hist.count).toBe(2);
            hist.cycles.forEach(function (c) {
                expect(c.autoclaveId).toBe('AC-A');
            });
        });
    });

    // ---- getIndicatorTypes ------------------------------------------------
    test('getIndicatorTypes exposes all known indicators', function () {
        var types = logger.getIndicatorTypes();
        expect(types.biological).toBeDefined();
        expect(types.chemical_class1).toBeDefined();
        expect(types.chemical_class4).toBeDefined();
        expect(types.chemical_class5).toBeDefined();
        expect(types.chemical_class6).toBeDefined();
        // mutation of returned copy must not leak into the next call
        types.biological.name = 'mutated';
        expect(logger.getIndicatorTypes().biological.name).not.toBe('mutated');
    });

    test('getProtocols returns independent copies (no shared mutation)', function () {
        var protos = logger.getProtocols();
        protos.gravity.minTemp = 999;
        expect(logger.getProtocols().gravity.minTemp).toBe(121);
    });
});
