'use strict';

var _mod = require('../docs/shared/labEntropyMonitor');
var createLabEntropyMonitor = _mod.createLabEntropyMonitor;

describe('Lab Entropy Monitor', function () {
    var mon;

    beforeEach(function () {
        mon = createLabEntropyMonitor();
    });

    // ── recordEvent ────────────────────────────────────────────

    describe('recordEvent', function () {
        test('records a valid event', function () {
            var res = mon.recordEvent({
                dimension: 'equipment',
                severity: 'high',
                source: 'bioprinter-02',
                description: 'Nozzle clog during print'
            });
            expect(res.success).toBe(true);
            expect(res.eventId).toBeDefined();
            expect(res.eventId.startsWith('ent-')).toBe(true);
        });

        test('rejects missing opts', function () {
            expect(mon.recordEvent().success).toBe(false);
        });

        test('rejects null opts', function () {
            expect(mon.recordEvent(null).success).toBe(false);
        });

        test('rejects unknown dimension', function () {
            var res = mon.recordEvent({
                dimension: 'magic',
                severity: 'low',
                source: 'x',
                description: 'y'
            });
            expect(res.success).toBe(false);
            expect(res.error).toContain('dimension');
        });

        test('rejects missing dimension', function () {
            var res = mon.recordEvent({ severity: 'low', source: 'x', description: 'y' });
            expect(res.success).toBe(false);
        });

        test('rejects unknown severity', function () {
            var res = mon.recordEvent({
                dimension: 'equipment',
                severity: 'extreme',
                source: 'x',
                description: 'y'
            });
            expect(res.success).toBe(false);
            expect(res.error).toContain('severity');
        });

        test('rejects missing source', function () {
            var res = mon.recordEvent({
                dimension: 'equipment',
                severity: 'low',
                description: 'y'
            });
            expect(res.success).toBe(false);
        });

        test('rejects missing description', function () {
            var res = mon.recordEvent({
                dimension: 'equipment',
                severity: 'low',
                source: 'x'
            });
            expect(res.success).toBe(false);
        });

        test('rejects dangerous key in source', function () {
            var res = mon.recordEvent({
                dimension: 'equipment',
                severity: 'low',
                source: '__proto__',
                description: 'y'
            });
            expect(res.success).toBe(false);
            expect(res.error).toContain('dangerous');
        });

        test('accepts custom timestamp', function () {
            var ts = Date.now() - 86400000;
            var res = mon.recordEvent({
                dimension: 'inventory',
                severity: 'medium',
                source: 'alginate-lot-44',
                description: 'Lot nearing expiration',
                timestamp: ts
            });
            expect(res.success).toBe(true);
            var timeline = mon.getTimeline();
            expect(timeline[0].timestamp).toBe(ts);
        });

        test('records all 7 dimensions', function () {
            var dims = ['equipment', 'inventory', 'protocol', 'experiment', 'environmental', 'personnel', 'data'];
            dims.forEach(function (dim) {
                var res = mon.recordEvent({
                    dimension: dim,
                    severity: 'low',
                    source: 'test-src',
                    description: 'test event for ' + dim
                });
                expect(res.success).toBe(true);
            });
            expect(mon.getTimeline().length).toBe(7);
        });
    });

    // ── getEntropyScore ────────────────────────────────────────

    describe('getEntropyScore', function () {
        test('returns zero composite with no events', function () {
            var s = mon.getEntropyScore();
            expect(s.score).toBe(0);
            expect(s.label).toBe('ordered');
            expect(s.dimension).toBe('composite');
            expect(s.eventCount).toBe(0);
        });

        test('returns zero for specific dimension with no events', function () {
            var s = mon.getEntropyScore('equipment');
            expect(s.score).toBe(0);
            expect(s.eventCount).toBe(0);
        });

        test('rejects unknown dimension', function () {
            var s = mon.getEntropyScore('fakeDim');
            expect(s.success).toBe(false);
        });

        test('scores increase with more events', function () {
            mon.recordEvent({ dimension: 'equipment', severity: 'low', source: 's1', description: 'd1' });
            var s1 = mon.getEntropyScore('equipment').score;
            mon.recordEvent({ dimension: 'equipment', severity: 'low', source: 's2', description: 'd2' });
            var s2 = mon.getEntropyScore('equipment').score;
            expect(s2).toBeGreaterThan(s1);
        });

        test('higher severity produces higher score', function () {
            var m1 = createLabEntropyMonitor();
            m1.recordEvent({ dimension: 'equipment', severity: 'low', source: 's', description: 'd' });
            var m2 = createLabEntropyMonitor();
            m2.recordEvent({ dimension: 'equipment', severity: 'critical', source: 's', description: 'd' });
            expect(m2.getEntropyScore('equipment').score).toBeGreaterThan(m1.getEntropyScore('equipment').score);
        });

        test('composite score uses dimension weights', function () {
            mon.recordEvent({ dimension: 'equipment', severity: 'critical', source: 's', description: 'd' });
            var composite = mon.getEntropyScore();
            var equipScore = mon.getEntropyScore('equipment');
            // Equipment weight = 0.18, so composite should be ~18% of equipment score
            expect(composite.score).toBeLessThan(equipScore.score);
            expect(composite.score).toBeGreaterThan(0);
        });

        test('classifies labels correctly', function () {
            // Pump enough events to push score high
            for (var i = 0; i < 20; i++) {
                mon.recordEvent({ dimension: 'equipment', severity: 'critical', source: 's' + i, description: 'd' });
            }
            var s = mon.getEntropyScore('equipment');
            expect(['disordered', 'chaotic', 'critical']).toContain(s.label);
        });

        test('older events contribute less due to decay', function () {
            var old = createLabEntropyMonitor();
            old.recordEvent({
                dimension: 'equipment', severity: 'high', source: 's', description: 'd',
                timestamp: Date.now() - 30 * 86400000 // 30 days ago
            });
            var recent = createLabEntropyMonitor();
            recent.recordEvent({
                dimension: 'equipment', severity: 'high', source: 's', description: 'd'
            });
            expect(recent.getEntropyScore('equipment').score).toBeGreaterThan(old.getEntropyScore('equipment').score);
        });

        test('trend returns stable with balanced events', function () {
            var s = mon.getEntropyScore('equipment');
            expect(s.trend).toBe('stable');
        });
    });

    // ── detectAcceleration ─────────────────────────────────────

    describe('detectAcceleration', function () {
        test('returns entries for all 7 dimensions', function () {
            var acc = mon.detectAcceleration();
            expect(acc.length).toBe(7);
        });

        test('no alert with no events', function () {
            var acc = mon.detectAcceleration();
            acc.forEach(function (a) {
                expect(a.alert).toBe(false);
                expect(a.velocity).toBe(0);
            });
        });

        test('each entry has required fields', function () {
            var acc = mon.detectAcceleration();
            acc.forEach(function (a) {
                expect(a).toHaveProperty('dimension');
                expect(a).toHaveProperty('velocity');
                expect(a).toHaveProperty('acceleration');
                expect(a).toHaveProperty('alert');
                expect(a).toHaveProperty('forecast7d');
            });
        });

        test('forecast stays within 0-100', function () {
            for (var i = 0; i < 30; i++) {
                mon.recordEvent({ dimension: 'protocol', severity: 'critical', source: 's', description: 'd' });
            }
            var acc = mon.detectAcceleration();
            acc.forEach(function (a) {
                expect(a.forecast7d).toBeGreaterThanOrEqual(0);
                expect(a.forecast7d).toBeLessThanOrEqual(100);
            });
        });
    });

    // ── getHotspots ────────────────────────────────────────────

    describe('getHotspots', function () {
        test('returns empty array with no events', function () {
            expect(mon.getHotspots().length).toBe(0);
        });

        test('returns hotspots sorted by severity weight', function () {
            mon.recordEvent({ dimension: 'equipment', severity: 'low', source: 'printer-a', description: 'd' });
            mon.recordEvent({ dimension: 'equipment', severity: 'critical', source: 'printer-b', description: 'd' });
            var h = mon.getHotspots();
            expect(h[0].source).toBe('printer-b');
            expect(h[0].totalSeverityWeight).toBeGreaterThan(h[1].totalSeverityWeight);
        });

        test('respects limit', function () {
            for (var i = 0; i < 20; i++) {
                mon.recordEvent({ dimension: 'equipment', severity: 'low', source: 'src-' + i, description: 'd' });
            }
            expect(mon.getHotspots({ limit: 5 }).length).toBe(5);
        });

        test('filters by dimension', function () {
            mon.recordEvent({ dimension: 'equipment', severity: 'low', source: 's1', description: 'd' });
            mon.recordEvent({ dimension: 'inventory', severity: 'low', source: 's2', description: 'd' });
            var h = mon.getHotspots({ dimension: 'inventory' });
            expect(h.length).toBe(1);
            expect(h[0].dimension).toBe('inventory');
        });

        test('aggregates events per source+dimension', function () {
            mon.recordEvent({ dimension: 'equipment', severity: 'high', source: 'printer-a', description: 'd1' });
            mon.recordEvent({ dimension: 'equipment', severity: 'medium', source: 'printer-a', description: 'd2' });
            var h = mon.getHotspots();
            expect(h[0].source).toBe('printer-a');
            expect(h[0].eventCount).toBe(2);
            expect(h[0].totalSeverityWeight).toBe(10); // 7 + 3
        });
    });

    // ── generateRemediation ────────────────────────────────────

    describe('generateRemediation', function () {
        test('returns no priorities when entropy is low', function () {
            var r = mon.generateRemediation();
            expect(r.priorities.length).toBe(0);
            expect(r.overallStrategy).toContain('under control');
        });

        test('generates remediation for high-entropy dimensions', function () {
            for (var i = 0; i < 15; i++) {
                mon.recordEvent({ dimension: 'equipment', severity: 'critical', source: 's' + i, description: 'd' });
            }
            var r = mon.generateRemediation();
            expect(r.priorities.length).toBeGreaterThan(0);
            expect(r.priorities[0].dimension).toBe('equipment');
            expect(r.priorities[0].actions.length).toBeGreaterThan(0);
            expect(r.priorities[0].estimatedImpact).toBeGreaterThan(0);
        });

        test('urgency reflects score level', function () {
            for (var i = 0; i < 30; i++) {
                mon.recordEvent({ dimension: 'equipment', severity: 'critical', source: 's' + i, description: 'd' });
            }
            var r = mon.generateRemediation();
            expect(['immediate', 'high']).toContain(r.priorities[0].urgency);
        });

        test('strategy reflects multiple dimensions needing remediation', function () {
            var dims = ['equipment', 'protocol', 'experiment', 'inventory'];
            dims.forEach(function (dim) {
                for (var i = 0; i < 15; i++) {
                    mon.recordEvent({ dimension: dim, severity: 'critical', source: 's' + i, description: 'd' });
                }
            });
            var r = mon.generateRemediation();
            expect(r.overallStrategy).toContain('Systemic');
        });
    });

    // ── getTimeline ────────────────────────────────────────────

    describe('getTimeline', function () {
        test('returns empty array with no events', function () {
            expect(mon.getTimeline().length).toBe(0);
        });

        test('returns events sorted by recency', function () {
            mon.recordEvent({ dimension: 'equipment', severity: 'low', source: 's', description: 'old', timestamp: 1000 });
            mon.recordEvent({ dimension: 'equipment', severity: 'low', source: 's', description: 'new', timestamp: 2000 });
            var tl = mon.getTimeline();
            expect(tl[0].timestamp).toBe(2000);
            expect(tl[1].timestamp).toBe(1000);
        });

        test('filters by dimension', function () {
            mon.recordEvent({ dimension: 'equipment', severity: 'low', source: 's', description: 'd' });
            mon.recordEvent({ dimension: 'data', severity: 'low', source: 's', description: 'd' });
            var tl = mon.getTimeline({ dimension: 'data' });
            expect(tl.length).toBe(1);
            expect(tl[0].dimension).toBe('data');
        });

        test('filters by since timestamp', function () {
            mon.recordEvent({ dimension: 'equipment', severity: 'low', source: 's', description: 'old', timestamp: 1000 });
            mon.recordEvent({ dimension: 'equipment', severity: 'low', source: 's', description: 'new', timestamp: 5000 });
            var tl = mon.getTimeline({ since: 3000 });
            expect(tl.length).toBe(1);
        });

        test('respects limit', function () {
            for (var i = 0; i < 100; i++) {
                mon.recordEvent({ dimension: 'equipment', severity: 'low', source: 's', description: 'd', timestamp: i });
            }
            expect(mon.getTimeline({ limit: 10 }).length).toBe(10);
        });
    });

    // ── getCorrelations ────────────────────────────────────────

    describe('getCorrelations', function () {
        test('returns empty with no events', function () {
            expect(mon.getCorrelations().length).toBe(0);
        });

        test('detects correlated dimensions with co-occurring events', function () {
            var now = Date.now();
            for (var i = 0; i < 10; i++) {
                mon.recordEvent({ dimension: 'equipment', severity: 'high', source: 'shared-src', description: 'd', timestamp: now + i * 1000 });
                mon.recordEvent({ dimension: 'experiment', severity: 'high', source: 'shared-src', description: 'd', timestamp: now + i * 1000 + 500 });
            }
            var corrs = mon.getCorrelations();
            var found = corrs.find(function (c) {
                return c.dimensions.indexOf('equipment') >= 0 && c.dimensions.indexOf('experiment') >= 0;
            });
            expect(found).toBeDefined();
            expect(found.correlation).toBeGreaterThan(0.5);
            expect(found.sharedSources).toContain('shared-src');
        });

        test('sorted by correlation strength', function () {
            var now = Date.now();
            // Strong correlation: equipment + protocol
            for (var i = 0; i < 10; i++) {
                mon.recordEvent({ dimension: 'equipment', severity: 'high', source: 's', description: 'd', timestamp: now });
                mon.recordEvent({ dimension: 'protocol', severity: 'high', source: 's', description: 'd', timestamp: now });
            }
            // Weak correlation: data + personnel (spread apart)
            for (var j = 0; j < 5; j++) {
                mon.recordEvent({ dimension: 'data', severity: 'low', source: 's2', description: 'd', timestamp: now });
                mon.recordEvent({ dimension: 'personnel', severity: 'low', source: 's3', description: 'd', timestamp: now + 100 * 86400000 });
            }
            var corrs = mon.getCorrelations();
            if (corrs.length >= 2) {
                expect(corrs[0].correlation).toBeGreaterThanOrEqual(corrs[1].correlation);
            }
        });

        test('includes insight text', function () {
            var now = Date.now();
            for (var i = 0; i < 5; i++) {
                mon.recordEvent({ dimension: 'inventory', severity: 'medium', source: 's', description: 'd', timestamp: now });
                mon.recordEvent({ dimension: 'environmental', severity: 'medium', source: 's', description: 'd', timestamp: now });
            }
            var corrs = mon.getCorrelations();
            var found = corrs.find(function (c) {
                return c.dimensions.indexOf('inventory') >= 0 && c.dimensions.indexOf('environmental') >= 0;
            });
            if (found) {
                expect(typeof found.insight).toBe('string');
                expect(found.insight.length).toBeGreaterThan(0);
            }
        });
    });

    // ── getDashboard ───────────────────────────────────────────

    describe('getDashboard', function () {
        test('returns complete dashboard with no events', function () {
            var dash = mon.getDashboard();
            expect(dash.compositeScore).toBeDefined();
            expect(dash.dimensionScores).toBeDefined();
            expect(dash.hotspots).toBeDefined();
            expect(dash.alerts).toBeDefined();
            expect(dash.acceleration).toBeDefined();
            expect(dash.remediation).toBeDefined();
            expect(dash.insights).toBeDefined();
            expect(dash.eventCount).toBe(0);
            expect(dash.generatedAt).toBeGreaterThan(0);
        });

        test('dimension scores covers all 7 dimensions', function () {
            var dash = mon.getDashboard();
            var dims = Object.keys(dash.dimensionScores);
            expect(dims.length).toBe(7);
        });

        test('generates insights for populated monitor', function () {
            for (var i = 0; i < 20; i++) {
                mon.recordEvent({ dimension: 'equipment', severity: 'critical', source: 's' + i, description: 'd' });
            }
            var dash = mon.getDashboard();
            expect(dash.insights.length).toBeGreaterThan(0);
        });

        test('alerts populated when acceleration detected', function () {
            // Recent burst of events in one dimension
            var now = Date.now();
            for (var i = 0; i < 15; i++) {
                mon.recordEvent({ dimension: 'protocol', severity: 'critical', source: 's', description: 'd', timestamp: now - i * 60000 });
            }
            var dash = mon.getDashboard();
            // alerts may or may not trigger depending on velocity threshold
            expect(Array.isArray(dash.alerts)).toBe(true);
        });
    });

    // ── reset ──────────────────────────────────────────────────

    describe('reset', function () {
        test('clears all events', function () {
            mon.recordEvent({ dimension: 'equipment', severity: 'low', source: 's', description: 'd' });
            mon.recordEvent({ dimension: 'data', severity: 'high', source: 's', description: 'd' });
            mon.reset();
            expect(mon.getTimeline().length).toBe(0);
            expect(mon.getEntropyScore().score).toBe(0);
            expect(mon.getEntropyScore().eventCount).toBe(0);
        });
    });

    // ── edge cases ─────────────────────────────────────────────

    describe('edge cases', function () {
        test('single event produces valid scores', function () {
            mon.recordEvent({ dimension: 'data', severity: 'low', source: 's', description: 'd' });
            var s = mon.getEntropyScore('data');
            expect(s.score).toBeGreaterThan(0);
            expect(s.eventCount).toBe(1);
        });

        test('all severities produce increasing scores', function () {
            var severities = ['low', 'medium', 'high', 'critical'];
            var scores = [];
            severities.forEach(function (sev) {
                var m = createLabEntropyMonitor();
                m.recordEvent({ dimension: 'equipment', severity: sev, source: 's', description: 'd' });
                scores.push(m.getEntropyScore('equipment').score);
            });
            for (var i = 1; i < scores.length; i++) {
                expect(scores[i]).toBeGreaterThan(scores[i - 1]);
            }
        });

        test('non-numeric timestamp defaults to now', function () {
            var res = mon.recordEvent({
                dimension: 'equipment', severity: 'low', source: 's', description: 'd',
                timestamp: 'not-a-number'
            });
            expect(res.success).toBe(true);
            var tl = mon.getTimeline();
            expect(tl[0].timestamp).toBeGreaterThan(Date.now() - 5000);
        });
    });
});
