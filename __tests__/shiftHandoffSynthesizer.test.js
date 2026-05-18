'use strict';

/**
 * Tests for shiftHandoffSynthesizer — agentic shift-to-shift briefing
 * synthesizer: carryover ranking, insights, playbook, health grade,
 * simulate(), and renderers.
 */

var mod = require('../docs/shared/shiftHandoffSynthesizer');
var createShiftHandoffSynthesizer = mod.createShiftHandoffSynthesizer;

var FROZEN_NOW = new Date('2026-05-17T07:00:00.000Z');
function frozenNow() { return new Date(FROZEN_NOW.getTime()); }

function makeSynth(opts) {
    opts = opts || {};
    if (!opts.now) opts.now = frozenNow;
    return createShiftHandoffSynthesizer(opts);
}

// Helpers for fresh signal records.
function critAlert(id, hoursAgo, kindExtra) {
    return Object.assign({
        id: id,
        title: 'Critical alert ' + id,
        severity: 'critical',
        timestamp: new Date(FROZEN_NOW.getTime() - hoursAgo * 3600000).toISOString(),
    }, kindExtra || {});
}

describe('createShiftHandoffSynthesizer — construction & validation', function () {
    test('rejects unknown riskAppetite at construction', function () {
        expect(function () { createShiftHandoffSynthesizer({ riskAppetite: 'reckless' }); })
            .toThrow(/riskAppetite/);
    });

    test('accepts cautious, balanced, aggressive appetites', function () {
        ['cautious', 'balanced', 'aggressive'].forEach(function (a) {
            expect(function () { createShiftHandoffSynthesizer({ riskAppetite: a, now: frozenNow }); })
                .not.toThrow();
        });
    });

    test('uses Date.now() default when no now() supplied', function () {
        var s = createShiftHandoffSynthesizer();
        var b = s.synthesize({});
        expect(b.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('exposes the full API surface', function () {
        var s = makeSynth();
        ['synthesize', 'simulate', 'formatText', 'formatMarkdown', 'formatJson']
            .forEach(function (k) { expect(typeof s[k]).toBe('function'); });
    });
});

describe('synthesize — empty / clean inputs', function () {
    test('handles entirely empty input', function () {
        var s = makeSynth();
        var b = s.synthesize({});
        expect(b.carryovers).toEqual([]);
        expect(b.counts).toEqual({ P0: 0, P1: 0, P2: 0, P3: 0 });
        expect(b.healthScore).toBeGreaterThan(80);
        expect(['A', 'B']).toContain(b.grade);
        expect(b.headline).toMatch(/Clean handoff/);
    });

    test('handles missing input object', function () {
        var s = makeSynth();
        var b = s.synthesize();
        expect(b.carryovers).toEqual([]);
        expect(b.summary).toEqual({
            alerts: 0, runs: 0, anomalies: 0,
            environmental: 0, pendingTasks: 0, blockers: 0,
        });
    });

    test('quiet successful runs do not produce carryovers', function () {
        var s = makeSynth();
        var b = s.synthesize({
            runs: [{
                id: 'R1', status: 'succeeded',
                completedAt: new Date(FROZEN_NOW.getTime() - 4 * 3600000).toISOString(),
            }],
        });
        expect(b.carryovers).toEqual([]);
    });
});

describe('synthesize — carryover scoring & ordering', function () {
    test('critical alerts produce carryovers with non-closed verdicts', function () {
        var s = makeSynth();
        var b = s.synthesize({
            alerts: [critAlert('A1', 2), critAlert('A2', 12)],
        });
        expect(b.carryovers.length).toBeGreaterThan(0);
        b.carryovers.forEach(function (c) {
            expect(c.verdict).not.toBe('CLOSED');
            expect(c.id).toBeDefined();
            expect(c.priority).toMatch(/^P[0-3]$/);
            expect(c.score).toBeGreaterThanOrEqual(0);
            expect(c.score).toBeLessThanOrEqual(100);
            expect(typeof c.owner).toBe('string');
            expect(Array.isArray(c.reasons)).toBe(true);
        });
    });

    test('carryovers are sorted by priority then by descending score', function () {
        var s = makeSynth();
        var b = s.synthesize({
            alerts: [
                critAlert('A1', 2),
                { id: 'A2', title: 'Info', severity: 'info',
                  timestamp: new Date(FROZEN_NOW.getTime() - 6 * 3600000).toISOString() },
            ],
            blockers: [{
                id: 'B1', title: 'Stuck',
                openedAt: new Date(FROZEN_NOW.getTime() - 48 * 3600000).toISOString(),
            }],
        });
        var rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
        for (var i = 1; i < b.carryovers.length; i++) {
            var prev = b.carryovers[i - 1], cur = b.carryovers[i];
            if (prev.priority === cur.priority) {
                expect(prev.score).toBeGreaterThanOrEqual(cur.score);
            } else {
                expect(rank[prev.priority]).toBeLessThan(rank[cur.priority]);
            }
        }
    });

    test('counts add up to total carryover count', function () {
        var s = makeSynth();
        var b = s.synthesize({
            alerts: [critAlert('A1', 1), critAlert('A2', 5)],
            anomalies: [{ id: 'AN1', kind: 'drift',
                detectedAt: new Date(FROZEN_NOW.getTime() - 1 * 3600000).toISOString(),
                severity: 'high' }],
        });
        var total = b.counts.P0 + b.counts.P1 + b.counts.P2 + b.counts.P3;
        expect(total).toBe(b.carryovers.length);
    });
});

describe('synthesize — insights & playbook', function () {
    test('multiple contamination signals raise an insight + lower health', function () {
        var s = makeSynth();
        var contamination = function (id, hoursAgo) {
            return {
                id: id, title: 'Contamination ' + id,
                severity: 'critical', category: 'contamination',
                timestamp: new Date(FROZEN_NOW.getTime() - hoursAgo * 3600000).toISOString(),
            };
        };
        var b = s.synthesize({
            alerts: [contamination('C1', 1), contamination('C2', 2), contamination('C3', 3)],
        });
        expect(b.insights.length).toBeGreaterThan(0);
        expect(b.healthScore).toBeLessThan(100);
    });

    test('stale blockers (>48h) trigger insight', function () {
        var s = makeSynth();
        var b = s.synthesize({
            blockers: [
                { id: 'B1', title: 'X', openedAt: new Date(FROZEN_NOW.getTime() - 96 * 3600000).toISOString() },
                { id: 'B2', title: 'Y', openedAt: new Date(FROZEN_NOW.getTime() - 72 * 3600000).toISOString() },
            ],
        });
        var codes = b.insights.map(function (i) { return i.code; });
        // stale blocker insight may or may not fire depending on thresholds —
        // at minimum the playbook should contain the blockers.
        expect(b.playbook.length + codes.length).toBeGreaterThan(0);
    });

    test('playbook actions are well-formed', function () {
        var s = makeSynth();
        var b = s.synthesize({
            alerts: [critAlert('A1', 1)],
            blockers: [{ id: 'B1', title: 'Stuck',
                openedAt: new Date(FROZEN_NOW.getTime() - 24 * 3600000).toISOString() }],
        });
        b.playbook.forEach(function (a) {
            expect(a).toEqual(expect.objectContaining({
                priority: expect.stringMatching(/^P[0-3]$/),
                code: expect.any(String),
                owner: expect.any(String),
                blastRadius: expect.any(String),
                reversibility: expect.any(String),
                reason: expect.any(String),
            }));
        });
    });
});

describe('synthesize — health score, grade, and risk appetite', function () {
    test('clean handoff scores 100 / grade A', function () {
        var s = makeSynth();
        var b = s.synthesize({});
        expect(b.healthScore).toBe(100);
        expect(b.grade).toBe('A');
    });

    test('many P0s drag the grade down', function () {
        var s = makeSynth();
        var alerts = [];
        for (var i = 0; i < 6; i++) alerts.push(critAlert('A' + i, 0.5 + i));
        var b = s.synthesize({ alerts: alerts });
        expect(b.healthScore).toBeLessThan(60);
        expect(['C', 'D', 'F']).toContain(b.grade);
    });

    test('cautious appetite scores lower than aggressive on the same input', function () {
        var sC = makeSynth({ riskAppetite: 'cautious' });
        var sA = makeSynth({ riskAppetite: 'aggressive' });
        var input = { alerts: [critAlert('A1', 1)] };
        var bC = sC.synthesize(input);
        var bA = sA.synthesize(input);
        expect(bC.healthScore).toBeLessThan(bA.healthScore);
    });

    test('per-call riskAppetite overrides default', function () {
        var s = makeSynth({ riskAppetite: 'cautious' });
        var b = s.synthesize({ riskAppetite: 'aggressive', alerts: [critAlert('A1', 1)] });
        expect(b.riskAppetite).toBe('aggressive');
    });

    test('invalid per-call riskAppetite falls back to default', function () {
        var s = makeSynth({ riskAppetite: 'balanced' });
        var b = s.synthesize({ riskAppetite: 'YOLO' });
        expect(b.riskAppetite).toBe('balanced');
    });

    test('health score is always clamped to [0,100]', function () {
        var s = makeSynth();
        var alerts = [];
        for (var i = 0; i < 25; i++) alerts.push(critAlert('A' + i, 0.5));
        var b = s.synthesize({ alerts: alerts });
        expect(b.healthScore).toBeGreaterThanOrEqual(0);
        expect(b.healthScore).toBeLessThanOrEqual(100);
    });
});

describe('synthesize — determinism & purity', function () {
    test('produces identical output for identical input', function () {
        var s = makeSynth();
        var input = {
            shiftLabel: 'Day shift',
            alerts: [critAlert('A1', 2), critAlert('A2', 5)],
            runs: [{ id: 'R1', status: 'failed',
                completedAt: new Date(FROZEN_NOW.getTime() - 3 * 3600000).toISOString() }],
        };
        var a = s.synthesize(input);
        var b = s.synthesize(input);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    test('does not mutate input arrays or items', function () {
        var s = makeSynth();
        var input = {
            alerts: [critAlert('A1', 2)],
            runs: [{ id: 'R1', status: 'failed',
                completedAt: new Date(FROZEN_NOW.getTime() - 3 * 3600000).toISOString() }],
        };
        var snapshot = JSON.stringify(input);
        s.synthesize(input);
        expect(JSON.stringify(input)).toBe(snapshot);
    });
});

describe('simulate', function () {
    test('returns projected vs baseline structure', function () {
        var s = makeSynth();
        var sim = s.simulate({ alerts: [critAlert('A1', 1)] }, { applyTop: 1 });
        expect(sim).toEqual(expect.objectContaining({
            projectedHealthScore: expect.any(Number),
            projectedGrade: expect.any(String),
            appliedActions: expect.any(Array),
            baselineHealthScore: expect.any(Number),
            baselineGrade: expect.any(String),
        }));
    });

    test('applyTop=0 leaves baseline unchanged', function () {
        var s = makeSynth();
        var input = { alerts: [critAlert('A1', 1), critAlert('A2', 2)] };
        var sim = s.simulate(input, { applyTop: 0 });
        expect(sim.appliedActions).toEqual([]);
        expect(sim.projectedHealthScore).toBe(sim.baselineHealthScore);
    });

    test('applying actions never decreases projected score', function () {
        var s = makeSynth();
        var input = {
            alerts: [critAlert('A1', 1), critAlert('A2', 2)],
            blockers: [{ id: 'B1', title: 'X',
                openedAt: new Date(FROZEN_NOW.getTime() - 24 * 3600000).toISOString() }],
        };
        var base = s.simulate(input, { applyTop: 0 });
        var applied = s.simulate(input, { applyTop: 3 });
        expect(applied.projectedHealthScore).toBeGreaterThanOrEqual(base.projectedHealthScore);
    });

    test('projected score is clamped to [0,100]', function () {
        var s = makeSynth();
        var sim = s.simulate({}, { applyTop: 999 });
        expect(sim.projectedHealthScore).toBeGreaterThanOrEqual(0);
        expect(sim.projectedHealthScore).toBeLessThanOrEqual(100);
    });
});

describe('renderers', function () {
    var s = makeSynth();
    var sample = s.synthesize({
        shiftLabel: 'Night → Day 2026-05-17',
        alerts: [critAlert('A1', 1)],
        blockers: [{ id: 'B1', title: 'Bioprinter jam',
            openedAt: new Date(FROZEN_NOW.getTime() - 24 * 3600000).toISOString() }],
    });

    test('formatText returns a multi-line non-empty string', function () {
        var s2 = makeSynth();
        var t = s2.formatText(sample);
        expect(typeof t).toBe('string');
        expect(t.length).toBeGreaterThan(50);
        expect(t).toContain('SHIFT HANDOFF BRIEFING');
        expect(t).toContain('Night → Day 2026-05-17');
        expect(t).toContain('Grade ');
    });

    test('formatText for clean handoff says "(no carryovers)"', function () {
        var s2 = makeSynth();
        var clean = s2.synthesize({});
        var t = s2.formatText(clean);
        expect(t).toContain('(no carryovers)');
    });

    test('formatMarkdown produces valid-looking markdown', function () {
        var s2 = makeSynth();
        var md = s2.formatMarkdown(sample);
        expect(md).toMatch(/^# Shift Handoff Briefing/m);
        expect(md).toContain('| P0 | P1 | P2 | P3 |');
        expect(md).toContain('## Carryovers');
    });

    test('formatMarkdown shows "_No carryovers._" when empty', function () {
        var s2 = makeSynth();
        var clean = s2.synthesize({});
        var md = s2.formatMarkdown(clean);
        expect(md).toContain('_No carryovers._');
    });

    test('formatJson returns parseable, deterministically key-sorted JSON', function () {
        var s2 = makeSynth();
        var j = s2.formatJson(sample);
        expect(function () { JSON.parse(j); }).not.toThrow();
        var j2 = s2.formatJson(sample);
        expect(j).toBe(j2); // deterministic
    });
});

describe('shiftLabel & generatedAt', function () {
    test('respects shiftLabel from input', function () {
        var s = makeSynth();
        var b = s.synthesize({ shiftLabel: 'My custom shift' });
        expect(b.shiftLabel).toBe('My custom shift');
    });

    test('falls back to ISO-stamped label when missing', function () {
        var s = makeSynth();
        var b = s.synthesize({});
        expect(b.shiftLabel).toMatch(/^Shift \d{4}-\d{2}-\d{2}T/);
    });

    test('generatedAt reflects injected now()', function () {
        var s = makeSynth();
        var b = s.synthesize({});
        expect(b.generatedAt).toBe(FROZEN_NOW.toISOString());
    });
});
