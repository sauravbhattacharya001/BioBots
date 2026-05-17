'use strict';

var _mod = require('../docs/shared/shiftHandoffSynthesizer');
var createShiftHandoffSynthesizer = _mod.createShiftHandoffSynthesizer;

function fixedNow() { return new Date('2026-05-17T07:00:00Z'); }

describe('ShiftHandoffSynthesizer', function () {
    var sh;
    beforeEach(function () { sh = createShiftHandoffSynthesizer({ now: fixedNow }); });

    it('exposes the expected API surface', function () {
        expect(typeof sh.synthesize).toBe('function');
        expect(typeof sh.simulate).toBe('function');
        expect(typeof sh.formatText).toBe('function');
        expect(typeof sh.formatMarkdown).toBe('function');
        expect(typeof sh.formatJson).toBe('function');
    });

    it('returns a clean handoff when there are no signals', function () {
        var b = sh.synthesize({});
        expect(b.grade).toBe('A');
        expect(b.counts.P0).toBe(0);
        expect(b.carryovers.length).toBe(0);
        expect(b.headline).toMatch(/Clean handoff/);
        expect(b.insights.some(function (i) { return i.code === 'QUIET_SHIFT'; })).toBe(true);
    });

    it('rejects unknown risk appetite at construction', function () {
        expect(function () { createShiftHandoffSynthesizer({ riskAppetite: 'wild' }); }).toThrow();
    });

    it('promotes unacked critical alerts to P0', function () {
        var b = sh.synthesize({
            alerts: [{ id: 'a1', title: 'pH out of range', severity: 'critical', acknowledged: false, observedAt: '2026-05-17T00:00:00Z' }],
        });
        var item = b.carryovers.find(function (c) { return c.id === 'a1'; });
        expect(item.priority).toBe('P0');
        expect(item.verdict).toBe('ESCALATE');
        expect(item.reasons).toContain('UNACKED');
        expect(item.reasons).toContain('AGED_6H');
    });

    it('drops resolved alerts and quiet successful runs', function () {
        var b = sh.synthesize({
            alerts: [{ id: 'a1', title: 'x', severity: 'high', resolved: true }],
            runs: [{ id: 'r1', jobName: 'demo', status: 'succeeded', finishedAt: '2026-05-17T05:00:00Z' }],
        });
        expect(b.carryovers.length).toBe(0);
    });

    it('flags failed runs with contamination hint and emits contamination insight + playbook', function () {
        var b = sh.synthesize({
            runs: [
                { id: 'r1', jobName: 'gel-A', status: 'failed', failureReason: 'suspected contamination in well 3' },
                { id: 'r2', jobName: 'gel-B', status: 'aborted' },
            ],
        });
        var r1 = b.carryovers.find(function (c) { return c.id === 'r1'; });
        expect(r1.priority).toBe('P0');
        expect(r1.reasons).toContain('CONTAMINATION_HINT');
        expect(b.insights.some(function (i) { return i.code === 'CONTAMINATION_THREAD'; })).toBe(true);
        expect(b.insights.some(function (i) { return i.code === 'PRINT_FAILURE_RATE'; })).toBe(true);
        expect(b.playbook.some(function (a) { return a.code === 'RUN_CONTAMINATION_EARLY_WARNING' && a.priority === 'P0'; })).toBe(true);
        expect(b.playbook.some(function (a) { return a.code === 'PRINT_FAILURE_RCA' && a.priority === 'P0'; })).toBe(true);
    });

    it('detects hot zones when same zone has 3+ carryovers', function () {
        var b = sh.synthesize({
            environmental: [
                { id: 'e1', sensor: 'temp', zone: 'cleanroom-A', severity: 'medium' },
                { id: 'e2', sensor: 'rh', zone: 'cleanroom-A', severity: 'medium' },
                { id: 'e3', sensor: 'co2', zone: 'cleanroom-A', severity: 'medium' },
            ],
        });
        expect(b.insights.some(function (i) { return i.code === 'HOT_ZONE'; })).toBe(true);
        expect(b.playbook.some(function (a) { return a.code === 'INVESTIGATE_HOT_ZONE'; })).toBe(true);
    });

    it('flags overdue tasks as P0 and emits OVERDUE_TASK_RECOVERY', function () {
        var b = sh.synthesize({
            pendingTasks: [
                { id: 't1', title: 'Calibrate scope', priority: 'critical', dueAt: '2026-05-17T03:00:00Z', blocking: true },
            ],
        });
        var t = b.carryovers.find(function (c) { return c.id === 't1'; });
        expect(t.priority).toBe('P0');
        expect(t.reasons).toContain('OVERDUE');
        expect(t.reasons).toContain('BLOCKING');
        expect(b.playbook.some(function (a) { return a.code === 'OVERDUE_TASK_RECOVERY'; })).toBe(true);
        expect(b.insights.some(function (i) { return i.code === 'OVERDUE_TASKS'; })).toBe(true);
    });

    it('escalates blockers older than 72 hours', function () {
        var b = sh.synthesize({
            blockers: [{ id: 'b1', title: 'autoclave broken', severity: 'high', ageHours: 96, impacts: ['runs', 'sterilization'] }],
        });
        var bl = b.carryovers.find(function (c) { return c.id === 'b1'; });
        expect(bl.priority).toBe('P0');
        expect(bl.reasons).toContain('AGED_72H');
        expect(bl.reasons).toContain('MULTI_IMPACT');
        expect(b.insights.some(function (i) { return i.code === 'STALE_BLOCKERS'; })).toBe(true);
        expect(b.playbook.some(function (a) { return a.code === 'ESCALATE_STALE_BLOCKERS'; })).toBe(true);
    });

    it('flags P0 environmental excursions and emits zone quarantine playbook', function () {
        var b = sh.synthesize({
            environmental: [{ id: 'e1', sensor: 'temp', zone: 'biosafety-cabinet-2', severity: 'critical', durationMin: 150 }],
        });
        var e = b.carryovers.find(function (c) { return c.id === 'e1'; });
        expect(e.priority).toBe('P0');
        expect(e.verdict).toBe('QUARANTINE_ZONE');
        expect(e.reasons).toContain('CLEAN_ZONE_AFFECTED');
        expect(b.playbook.some(function (a) { return a.code === 'QUARANTINE_AFFECTED_ZONES'; })).toBe(true);
    });

    it('emits P0_CLUSTER insight + BLOCK_90_MIN_FOR_P0 playbook with >=3 P0', function () {
        var b = sh.synthesize({
            runs: [
                { id: 'r1', jobName: 'a', status: 'failed' },
                { id: 'r2', jobName: 'b', status: 'failed' },
            ],
            blockers: [{ id: 'b1', title: 'x', severity: 'critical', ageHours: 80 }],
        });
        expect(b.counts.P0).toBeGreaterThanOrEqual(3);
        expect(b.insights.some(function (i) { return i.code === 'P0_CLUSTER'; })).toBe(true);
        expect(b.playbook.some(function (a) { return a.code === 'BLOCK_90_MIN_FOR_P0'; })).toBe(true);
    });

    it('flags ALERT_FATIGUE when >=5 unacked alerts pile up', function () {
        var alerts = [];
        for (var i = 0; i < 6; i++) alerts.push({ id: 'a' + i, title: 't', severity: 'low', acknowledged: false });
        var b = sh.synthesize({ alerts: alerts });
        expect(b.insights.some(function (i) { return i.code === 'ALERT_FATIGUE'; })).toBe(true);
        expect(b.playbook.some(function (a) { return a.code === 'REVIEW_ALERT_BATCHING'; })).toBe(true);
    });

    it('respects per-call risk appetite override and applies cautious huddle action', function () {
        var b = sh.synthesize({
            riskAppetite: 'cautious',
            runs: [{ id: 'r1', jobName: 'x', status: 'failed' }],
        });
        expect(b.riskAppetite).toBe('cautious');
        expect(b.playbook.some(function (a) { return a.code === 'OPEN_HANDOFF_HUDDLE' && a.priority === 'P1'; })).toBe(true);
    });

    it('handoff health grade downgrades with P0 load and contamination', function () {
        var clean = sh.synthesize({});
        expect(clean.grade).toBe('A');
        var dirty = sh.synthesize({
            runs: [
                { id: 'r1', jobName: 'a', status: 'failed', failureReason: 'contamination cluster' },
                { id: 'r2', jobName: 'b', status: 'aborted' },
            ],
            blockers: [{ id: 'b1', title: 'x', severity: 'critical', ageHours: 80, impacts: ['x', 'y'] }],
        });
        expect(['F', 'D']).toContain(dirty.grade);
        expect(dirty.healthScore).toBeLessThan(clean.healthScore);
    });

    it('orders carryovers by priority then by score desc', function () {
        var b = sh.synthesize({
            runs: [{ id: 'r1', jobName: 'x', status: 'queued' }],
            blockers: [{ id: 'b1', title: 'y', severity: 'critical', ageHours: 80 }],
        });
        expect(b.carryovers[0].id).toBe('b1');
    });

    it('simulate() improves projected health with diminishing returns and never exceeds 100', function () {
        var input = {
            runs: [
                { id: 'r1', jobName: 'a', status: 'failed' },
                { id: 'r2', jobName: 'b', status: 'failed', failureReason: 'contamination!' },
            ],
        };
        var base = sh.synthesize(input);
        var simAll = sh.simulate(input, { applyTop: 99 });
        expect(simAll.projectedHealthScore).toBeGreaterThanOrEqual(base.healthScore);
        expect(simAll.projectedHealthScore).toBeLessThanOrEqual(100);
        expect(simAll.appliedActions.length).toBe(base.playbook.length);
    });

    it('renders text, markdown, and JSON without errors', function () {
        var b = sh.synthesize({
            shiftLabel: 'Day 2026-05-17',
            runs: [{ id: 'r1', jobName: 'a', status: 'failed' }],
        });
        var text = sh.formatText(b);
        var md = sh.formatMarkdown(b);
        var json = sh.formatJson(b);
        expect(text).toContain('SHIFT HANDOFF BRIEFING');
        expect(md).toContain('# Shift Handoff Briefing');
        // formatJson sorts keys recursively in objects.
        var parsed = JSON.parse(json);
        expect(parsed.grade).toBe(b.grade);
        expect(parsed.headline).toBe(b.headline);
        // sorted-keys: counts should be in alphabetical order
        var keys = Object.keys(parsed.counts);
        var sorted = keys.slice().sort();
        expect(keys).toEqual(sorted);
    });

    it('JSON output is byte-stable for repeated calls with the same input', function () {
        var input = { runs: [{ id: 'r1', jobName: 'a', status: 'failed' }] };
        var j1 = sh.formatJson(sh.synthesize(input));
        var j2 = sh.formatJson(sh.synthesize(input));
        expect(j1).toBe(j2);
    });

    it('is wired into the public BioBots index', function () {
        var biobots = require('../');
        expect(typeof biobots.createShiftHandoffSynthesizer).toBe('function');
        var s = biobots.createShiftHandoffSynthesizer({ now: fixedNow });
        expect(typeof s.synthesize).toBe('function');
    });
});
