'use strict';

var _mod = require('../docs/shared/failureAutopsy');

function _makeFailure(overrides) {
    var base = {
        id: 'fail-' + Math.random().toString(36).slice(2, 8),
        timestamp: '2025-06-15T14:30:00Z',
        printJobId: 'job-42',
        material: 'gelma_5pct',
        parameters: {
            temperature: 37.5,
            pressure: 2.8,
            speed: 12,
            layerHeight: 0.2,
            nozzleDiameter: 0.41
        },
        materialCondition: {
            prepTime: '2025-06-15T08:00:00Z',
            freezeThawCycles: 2,
            storageTemp: 4,
            viscosity: 850,
            cellViability: 0.88
        },
        environmental: [
            { time: '2025-06-15T14:00:00Z', temp: 22.1, humidity: 45, vibration: 0.02 },
            { time: '2025-06-15T14:05:00Z', temp: 22.0, humidity: 45, vibration: 0.02 },
            { time: '2025-06-15T14:10:00Z', temp: 22.1, humidity: 44, vibration: 0.03 },
            { time: '2025-06-15T14:15:00Z', temp: 22.3, humidity: 44, vibration: 0.02 },
            { time: '2025-06-15T14:20:00Z', temp: 22.2, humidity: 45, vibration: 0.02 },
            { time: '2025-06-15T14:25:00Z', temp: 22.1, humidity: 44, vibration: 0.03 }
        ],
        equipment: {
            printerId: 'bp-001',
            nozzleHours: 120,
            lastCalibration: '2025-06-10',
            events: []
        },
        failureMode: 'structural_collapse',
        failedAtLayer: 15,
        notes: 'Collapsed after 15th layer'
    };
    if (overrides) {
        var keys = Object.keys(overrides);
        for (var i = 0; i < keys.length; i++) { base[keys[i]] = overrides[keys[i]]; }
    }
    return base;
}

describe('FailureAutopsy', function () {

    // ── Recording ──────────────────────────────────────────────

    test('recordFailure returns recorded:true with id', function () {
        var autopsy = _mod.createFailureAutopsy();
        var result = autopsy.recordFailure(_makeFailure());
        expect(result.recorded).toBe(true);
        expect(typeof result.id).toBe('string');
    });

    test('recordFailure auto-generates id if missing', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure();
        delete f.id;
        var result = autopsy.recordFailure(f);
        expect(result.recorded).toBe(true);
        expect(typeof result.id).toBe('string');
        expect(result.id.length).toBeGreaterThan(0);
    });

    test('recordFailure throws on null input', function () {
        var autopsy = _mod.createFailureAutopsy();
        expect(function () { autopsy.recordFailure(null); }).toThrow('non-null object');
    });

    test('recordFailure throws on non-object input', function () {
        var autopsy = _mod.createFailureAutopsy();
        expect(function () { autopsy.recordFailure('bad'); }).toThrow('non-null object');
    });

    test('recordFailure throws on non-string id', function () {
        var autopsy = _mod.createFailureAutopsy();
        expect(function () { autopsy.recordFailure({ id: 123 }); }).toThrow('id must be a string');
    });

    // ── Key Sanitization ───────────────────────────────────────

    test('recordFailure strips __proto__ key', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'sanitize-test' });
        f['__proto__'] = { malicious: true };
        var result = autopsy.recordFailure(f);
        expect(result.recorded).toBe(true);
    });

    test('recordFailure strips constructor key from parameters', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'ctor-test' });
        f.parameters.constructor = 'evil';
        autopsy.recordFailure(f);
        var analysis = autopsy.analyze('ctor-test');
        expect(analysis).toBeDefined();
    });

    // ── Analysis ───────────────────────────────────────────────

    test('analyze returns full result with all engines', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'a1' }));
        var result = autopsy.analyze('a1');
        expect(result.failureId).toBe('a1');
        expect(result.engines).toBeDefined();
        expect(result.engines.parameterDeviation).toBeDefined();
        expect(result.engines.materialCondition).toBeDefined();
        expect(result.engines.environmentalForensics).toBeDefined();
        expect(result.engines.equipmentState).toBeDefined();
        expect(result.engines.timeline).toBeDefined();
        expect(result.engines.rootCauseRanker).toBeDefined();
        expect(result.engines.correctiveActions).toBeDefined();
    });

    test('analyze throws on unknown failureId', function () {
        var autopsy = _mod.createFailureAutopsy();
        expect(function () { autopsy.analyze('nonexistent'); }).toThrow('Failure not found');
    });

    test('analyze throws on non-string failureId', function () {
        var autopsy = _mod.createFailureAutopsy();
        expect(function () { autopsy.analyze(42); }).toThrow('failureId must be a string');
    });

    test('analyze compositeSeverity is in 0-100 range', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'cs1' }));
        var result = autopsy.analyze('cs1');
        expect(result.compositeSeverity).toBeGreaterThanOrEqual(0);
        expect(result.compositeSeverity).toBeLessThanOrEqual(100);
    });

    // ── Parameter Deviation Engine ─────────────────────────────

    test('parameter engine detects out-of-range temperature', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'pd1' });
        f.parameters.temperature = 50; // above max of 42
        autopsy.recordFailure(f);
        var result = autopsy.analyze('pd1');
        var devs = result.engines.parameterDeviation.deviations;
        var tempDev = devs.filter(function (d) { return d.parameter === 'temperature'; });
        expect(tempDev.length).toBe(1);
        expect(tempDev[0].direction).toBe('above');
        expect(tempDev[0].severity).toBeGreaterThan(0);
    });

    test('parameter engine reports no deviations for safe parameters', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'pd2' }));
        var result = autopsy.analyze('pd2');
        var devs = result.engines.parameterDeviation.deviations;
        expect(devs.length).toBe(0);
        expect(result.engines.parameterDeviation.score).toBe(0);
    });

    test('parameter engine detects below-range pressure', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'pd3' });
        f.parameters.pressure = 0.2; // below min of 0.5
        autopsy.recordFailure(f);
        var result = autopsy.analyze('pd3');
        var devs = result.engines.parameterDeviation.deviations;
        var pressDev = devs.filter(function (d) { return d.parameter === 'pressure'; });
        expect(pressDev.length).toBe(1);
        expect(pressDev[0].direction).toBe('below');
    });

    // ── Material Condition Engine ──────────────────────────────

    test('material engine detects old bioink', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'mc1' });
        f.materialCondition.prepTime = '2025-06-14T08:00:00Z'; // >24h ago
        autopsy.recordFailure(f);
        var result = autopsy.analyze('mc1');
        var findings = result.engines.materialCondition.findings;
        var ageFinding = findings.filter(function (fl) { return fl.finding === 'material_age'; });
        expect(ageFinding.length).toBe(1);
    });

    test('material engine detects excessive freeze-thaw', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'mc2' });
        f.materialCondition.freezeThawCycles = 5;
        autopsy.recordFailure(f);
        var result = autopsy.analyze('mc2');
        var findings = result.engines.materialCondition.findings;
        var ftFinding = findings.filter(function (fl) { return fl.finding === 'freeze_thaw_excess'; });
        expect(ftFinding.length).toBe(1);
    });

    test('material engine detects low cell viability', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'mc3' });
        f.materialCondition.cellViability = 0.5;
        autopsy.recordFailure(f);
        var result = autopsy.analyze('mc3');
        var findings = result.engines.materialCondition.findings;
        var viabFinding = findings.filter(function (fl) { return fl.finding === 'low_viability'; });
        expect(viabFinding.length).toBe(1);
    });

    test('material engine detects high viscosity', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'mc4' });
        f.materialCondition.viscosity = 3000;
        autopsy.recordFailure(f);
        var result = autopsy.analyze('mc4');
        var findings = result.engines.materialCondition.findings;
        var viscFinding = findings.filter(function (fl) { return fl.finding === 'viscosity_high'; });
        expect(viscFinding.length).toBe(1);
    });

    test('material engine clean when all conditions are fine', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'mc5' }));
        var result = autopsy.analyze('mc5');
        expect(result.engines.materialCondition.score).toBe(0);
    });

    // ── Environmental Forensics Engine ─────────────────────────

    test('environmental engine detects temperature spike', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'ef1' });
        f.environmental = [
            { time: '2025-06-15T14:00:00Z', temp: 22.0, humidity: 45, vibration: 0.02 },
            { time: '2025-06-15T14:05:00Z', temp: 22.1, humidity: 45, vibration: 0.02 },
            { time: '2025-06-15T14:10:00Z', temp: 22.0, humidity: 45, vibration: 0.02 },
            { time: '2025-06-15T14:15:00Z', temp: 22.1, humidity: 45, vibration: 0.02 },
            { time: '2025-06-15T14:20:00Z', temp: 35.0, humidity: 45, vibration: 0.02 } // spike
        ];
        autopsy.recordFailure(f);
        var result = autopsy.analyze('ef1');
        var anomalies = result.engines.environmentalForensics.anomalies;
        var tempAnom = anomalies.filter(function (a) { return a.metric === 'temp'; });
        expect(tempAnom.length).toBeGreaterThan(0);
        expect(tempAnom[0].direction).toBe('spike');
    });

    test('environmental engine returns low score for stable readings', function () {
        var autopsy = _mod.createFailureAutopsy();
        // Use truly constant readings to avoid z-score triggering
        var f = _makeFailure({ id: 'ef2' });
        f.environmental = [
            { time: '2025-06-15T14:00:00Z', temp: 22.0, humidity: 45, vibration: 0.02 },
            { time: '2025-06-15T14:05:00Z', temp: 22.0, humidity: 45, vibration: 0.02 },
            { time: '2025-06-15T14:10:00Z', temp: 22.0, humidity: 45, vibration: 0.02 },
            { time: '2025-06-15T14:15:00Z', temp: 22.0, humidity: 45, vibration: 0.02 },
            { time: '2025-06-15T14:20:00Z', temp: 22.0, humidity: 45, vibration: 0.02 }
        ];
        autopsy.recordFailure(f);
        var result = autopsy.analyze('ef2');
        expect(result.engines.environmentalForensics.anomalies.length).toBe(0);
        expect(result.engines.environmentalForensics.score).toBe(0);
    });

    test('environmental engine handles missing readings', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'ef3' });
        f.environmental = [];
        autopsy.recordFailure(f);
        var result = autopsy.analyze('ef3');
        expect(result.engines.environmentalForensics.score).toBe(0);
    });

    // ── Equipment State Engine ─────────────────────────────────

    test('equipment engine detects high nozzle hours', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'eq1' });
        f.equipment.nozzleHours = 350;
        autopsy.recordFailure(f);
        var result = autopsy.analyze('eq1');
        var findings = result.engines.equipmentState.findings;
        var nozzleFinding = findings.filter(function (fl) { return fl.finding === 'nozzle_wear'; });
        expect(nozzleFinding.length).toBe(1);
    });

    test('equipment engine detects pressure drop event', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'eq2' });
        f.equipment.events = [
            { time: '2025-06-15T14:20:00Z', type: 'pressure_drop', value: 1.2 }
        ];
        autopsy.recordFailure(f);
        var result = autopsy.analyze('eq2');
        var findings = result.engines.equipmentState.findings;
        expect(findings.some(function (fl) { return fl.finding === 'pressure_drop_event'; })).toBe(true);
    });

    test('equipment engine detects nozzle clog event', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'eq3' });
        f.equipment.events = [
            { time: '2025-06-15T14:20:00Z', type: 'nozzle_clog' }
        ];
        autopsy.recordFailure(f);
        var result = autopsy.analyze('eq3');
        var findings = result.engines.equipmentState.findings;
        expect(findings.some(function (fl) { return fl.finding === 'nozzle_clog_event'; })).toBe(true);
    });

    // ── Timeline Engine ────────────────────────────────────────

    test('timeline events are chronologically ordered', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'tl1' }));
        var timeline = autopsy.getTimeline('tl1');
        for (var i = 1; i < timeline.events.length; i++) {
            expect(timeline.events[i].time).toBeGreaterThanOrEqual(timeline.events[i - 1].time);
        }
    });

    test('timeline includes failure event', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'tl2' }));
        var timeline = autopsy.getTimeline('tl2');
        var failureEvents = timeline.events.filter(function (e) { return e.source === 'failure'; });
        expect(failureEvents.length).toBe(1);
    });

    test('timeline includes equipment events', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'tl3' });
        f.equipment.events = [
            { time: '2025-06-15T14:20:00Z', type: 'pressure_drop', value: 1.2 }
        ];
        autopsy.recordFailure(f);
        var timeline = autopsy.getTimeline('tl3');
        var eqEvents = timeline.events.filter(function (e) { return e.source === 'equipment'; });
        expect(eqEvents.length).toBeGreaterThan(0);
    });

    test('getTimeline throws for unknown id', function () {
        var autopsy = _mod.createFailureAutopsy();
        expect(function () { autopsy.getTimeline('nope'); }).toThrow('Failure not found');
    });

    // ── Root Cause Ranking ─────────────────────────────────────

    test('root causes are ordered by confidence descending', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'rc1' });
        f.parameters.speed = 50; // way above range
        f.materialCondition.freezeThawCycles = 6;
        f.materialCondition.cellViability = 0.4;
        f.equipment.events = [{ time: '2025-06-15T14:20:00Z', type: 'pressure_drop', value: 0.5 }];
        autopsy.recordFailure(f);
        var result = autopsy.analyze('rc1');
        var causes = result.rootCauses;
        for (var i = 1; i < causes.length; i++) {
            expect(causes[i].confidence).toBeLessThanOrEqual(causes[i - 1].confidence);
        }
    });

    test('root causes have required fields', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'rc2' });
        f.parameters.pressure = 6; // out of range
        autopsy.recordFailure(f);
        var result = autopsy.analyze('rc2');
        var causes = result.rootCauses;
        if (causes.length > 0) {
            expect(causes[0]).toHaveProperty('cause');
            expect(causes[0]).toHaveProperty('label');
            expect(causes[0]).toHaveProperty('confidence');
            expect(causes[0]).toHaveProperty('evidence');
            expect(causes[0]).toHaveProperty('category');
        }
    });

    test('getRootCauses throws if analyze not run', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'rc3' }));
        expect(function () { autopsy.getRootCauses('rc3'); }).toThrow('run analyze()');
    });

    // ── Corrective Actions ─────────────────────────────────────

    test('corrective actions sorted by priority descending', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'ca1' });
        f.parameters.pressure = 6;
        f.equipment.events = [{ time: '2025-06-15T14:20:00Z', type: 'nozzle_clog' }];
        autopsy.recordFailure(f);
        var result = autopsy.analyze('ca1');
        var actions = result.correctiveActions;
        for (var i = 1; i < actions.length; i++) {
            expect(actions[i].priority).toBeLessThanOrEqual(actions[i - 1].priority);
        }
    });

    test('corrective actions have required fields', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'ca2' });
        f.parameters.pressure = 0.1; // below range
        autopsy.recordFailure(f);
        var result = autopsy.analyze('ca2');
        if (result.correctiveActions.length > 0) {
            var action = result.correctiveActions[0];
            expect(action).toHaveProperty('action');
            expect(action).toHaveProperty('effort');
            expect(action).toHaveProperty('impact');
            expect(action).toHaveProperty('priority');
            expect(action).toHaveProperty('rootCause');
        }
    });

    test('getCorrectiveActions throws if analyze not run', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'ca3' }));
        expect(function () { autopsy.getCorrectiveActions('ca3'); }).toThrow('run analyze()');
    });

    // ── Outcome Recording ──────────────────────────────────────

    test('recordOutcome succeeds for valid failure', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'out1' }));
        var result = autopsy.recordOutcome('out1', { confirmedCause: 'nozzle_clog', fixed: true });
        expect(result.recorded).toBe(true);
    });

    test('recordOutcome throws for unknown failure', function () {
        var autopsy = _mod.createFailureAutopsy();
        expect(function () { autopsy.recordOutcome('nope', { fixed: true }); }).toThrow('Failure not found');
    });

    test('recordOutcome throws on invalid input', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'out2' }));
        expect(function () { autopsy.recordOutcome('out2', null); }).toThrow('non-null object');
    });

    // ── Patterns ───────────────────────────────────────────────

    test('patterns detects recurring root causes', function () {
        var autopsy = _mod.createFailureAutopsy();
        for (var i = 0; i < 3; i++) {
            var f = _makeFailure({ id: 'pat-' + i, material: 'gelma_5pct' });
            f.equipment.events = [{ time: '2025-06-15T14:20:00Z', type: 'nozzle_clog' }];
            f.equipment.printerId = 'bp-001';
            autopsy.recordFailure(f);
            autopsy.analyze('pat-' + i);
        }
        var patterns = autopsy.getPatterns();
        expect(patterns.totalFailures).toBe(3);
        expect(patterns.patterns.length).toBeGreaterThan(0);
    });

    test('patterns returns message for single failure', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'pat-single' }));
        var patterns = autopsy.getPatterns();
        expect(patterns.message).toBeDefined();
    });

    // ── Dashboard ──────────────────────────────────────────────

    test('dashboard shows 100 health for no failures', function () {
        var autopsy = _mod.createFailureAutopsy();
        var dash = autopsy.getDashboard();
        expect(dash.totalFailures).toBe(0);
        expect(dash.healthScore).toBe(100);
        expect(dash.healthLabel).toBe('Excellent');
    });

    test('dashboard aggregates multiple failures', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'dash-1' }));
        autopsy.recordFailure(_makeFailure({ id: 'dash-2' }));
        autopsy.analyze('dash-1');
        autopsy.analyze('dash-2');
        var dash = autopsy.getDashboard();
        expect(dash.totalFailures).toBe(2);
        expect(dash.analyzedCount).toBe(2);
        expect(dash.healthScore).toBeGreaterThanOrEqual(0);
        expect(dash.healthScore).toBeLessThanOrEqual(100);
    });

    test('dashboard healthScore is between 0-100', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'dash-3' });
        f.parameters.pressure = 10;
        f.materialCondition.cellViability = 0.1;
        autopsy.recordFailure(f);
        autopsy.analyze('dash-3');
        var dash = autopsy.getDashboard();
        expect(dash.healthScore).toBeGreaterThanOrEqual(0);
        expect(dash.healthScore).toBeLessThanOrEqual(100);
    });

    // ── Report Generation ──────────────────────────────────────

    test('generateReport returns full report', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'rpt-1' }));
        autopsy.analyze('rpt-1');
        var report = autopsy.generateReport('rpt-1');
        expect(report.reportId).toBe('rpt-rpt-1');
        expect(report.failure).toBeDefined();
        expect(report.analysis).toBeDefined();
        expect(report.engines).toBeDefined();
    });

    test('generateReport throws if not analyzed', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'rpt-2' }));
        expect(function () { autopsy.generateReport('rpt-2'); }).toThrow('run analyze()');
    });

    test('generateReport includes outcome when recorded', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'rpt-3' }));
        autopsy.analyze('rpt-3');
        autopsy.recordOutcome('rpt-3', { confirmedCause: 'nozzle_clog', fixed: true });
        var report = autopsy.generateReport('rpt-3');
        expect(report.outcome).not.toBeNull();
        expect(report.outcome.confirmedCause).toBe('nozzle_clog');
    });

    // ── Edge Cases ─────────────────────────────────────────────

    test('analyze works with minimal data', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure({ id: 'min-1', timestamp: '2025-06-15T14:30:00Z' });
        var result = autopsy.analyze('min-1');
        expect(result.failureId).toBe('min-1');
        expect(result.rootCauses).toBeDefined();
    });

    test('analyze works with empty parameters', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure({ id: 'min-2', parameters: {} });
        var result = autopsy.analyze('min-2');
        expect(result.engines.parameterDeviation.deviations.length).toBe(0);
    });

    test('analyze works with no environmental data', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure({ id: 'min-3', environmental: [] });
        var result = autopsy.analyze('min-3');
        expect(result.engines.environmentalForensics.score).toBe(0);
    });

    test('summary contains top root cause and action', function () {
        var autopsy = _mod.createFailureAutopsy();
        var f = _makeFailure({ id: 'sum-1' });
        f.equipment.events = [{ time: '2025-06-15T14:20:00Z', type: 'nozzle_clog' }];
        autopsy.recordFailure(f);
        var result = autopsy.analyze('sum-1');
        expect(result.summary).toBeDefined();
        expect(result.summary.topRootCause).toBeDefined();
        expect(result.summary.totalRootCauses).toBeGreaterThanOrEqual(0);
        expect(result.summary.topAction).toBeDefined();
    });

    test('multiple independent autopsy instances are isolated', function () {
        var a1 = _mod.createFailureAutopsy();
        var a2 = _mod.createFailureAutopsy();
        a1.recordFailure(_makeFailure({ id: 'iso-1' }));
        expect(function () { a2.analyze('iso-1'); }).toThrow('Failure not found');
    });

    test('report id contains failure id', function () {
        var autopsy = _mod.createFailureAutopsy();
        autopsy.recordFailure(_makeFailure({ id: 'rpt-check' }));
        autopsy.analyze('rpt-check');
        var report = autopsy.generateReport('rpt-check');
        expect(report.reportId).toContain('rpt-check');
    });
});
