'use strict';

var si = require('../docs/shared/schedulingIntelligence');

describe('Lab Scheduling Intelligence Engine', function () {
    var engine;

    beforeEach(function () {
        engine = si.createSchedulingIntelligence();
    });

    // ── Engine 1: Schedule Recorder ────────────────────────────────

    describe('recordScheduledExperiment', function () {
        it('records a valid experiment', function () {
            var result = engine.recordScheduledExperiment({
                id: 'exp-001',
                protocol: 'bioprint-cartilage',
                operator: 'alice',
                equipment: ['printer-1', 'incubator-2'],
                scheduledStart: '2025-06-15T09:00:00Z',
                scheduledEnd: '2025-06-15T12:00:00Z',
                outcome: 'success'
            });
            expect(result.id).toBe('exp-001');
            expect(result.protocol).toBe('bioprint-cartilage');
            expect(result.equipment).toEqual(['printer-1', 'incubator-2']);
        });

        it('throws on null entry', function () {
            expect(function () { engine.recordScheduledExperiment(null); }).toThrow();
        });

        it('throws on missing id', function () {
            expect(function () {
                engine.recordScheduledExperiment({ scheduledStart: '2025-01-01T00:00:00Z' });
            }).toThrow();
        });

        it('throws on missing scheduledStart', function () {
            expect(function () {
                engine.recordScheduledExperiment({ id: 'x' });
            }).toThrow();
        });

        it('defaults protocol to unknown', function () {
            var r = engine.recordScheduledExperiment({ id: 'x', scheduledStart: '2025-01-01T00:00:00Z' });
            expect(r.protocol).toBe('unknown');
        });

        it('respects capacity limit', function () {
            for (var i = 0; i < 5001; i++) {
                engine.recordScheduledExperiment({
                    id: 'exp-' + i,
                    scheduledStart: '2025-01-01T00:00:00Z'
                });
            }
            var all = engine.getExperiments();
            expect(all.length).toBe(5000);
            expect(all[0].id).toBe('exp-1');
        });

        it('stores tags array', function () {
            var r = engine.recordScheduledExperiment({
                id: 'x', scheduledStart: '2025-01-01T00:00:00Z', tags: ['urgent', 'pilot']
            });
            expect(r.tags).toEqual(['urgent', 'pilot']);
        });
    });

    // ── Engine 1b: getExperiments ──────────────────────────────────

    describe('getExperiments', function () {
        beforeEach(function () {
            engine.recordScheduledExperiment({ id: 'e1', protocol: 'p1', operator: 'alice', equipment: ['eq1'], scheduledStart: '2025-01-01T09:00:00Z', outcome: 'success' });
            engine.recordScheduledExperiment({ id: 'e2', protocol: 'p2', operator: 'bob', equipment: ['eq2'], scheduledStart: '2025-01-02T10:00:00Z', outcome: 'failure' });
            engine.recordScheduledExperiment({ id: 'e3', protocol: 'p1', operator: 'alice', equipment: ['eq1', 'eq2'], scheduledStart: '2025-01-03T14:00:00Z', outcome: 'success' });
        });

        it('returns all without filter', function () {
            expect(engine.getExperiments().length).toBe(3);
        });

        it('filters by protocol', function () {
            expect(engine.getExperiments({ protocol: 'p1' }).length).toBe(2);
        });

        it('filters by operator', function () {
            expect(engine.getExperiments({ operator: 'bob' }).length).toBe(1);
        });

        it('filters by outcome', function () {
            expect(engine.getExperiments({ outcome: 'failure' }).length).toBe(1);
        });

        it('filters by equipment', function () {
            expect(engine.getExperiments({ equipment: 'eq2' }).length).toBe(2);
        });
    });

    // ── Engine 2: Temporal Pattern Analyzer ────────────────────────

    describe('analyzeTemporalPatterns', function () {
        it('returns empty for no data', function () {
            var p = engine.analyzeTemporalPatterns();
            expect(p.sampleSize).toBe(0);
        });

        it('computes hourly success rates', function () {
            // 9am successes, 14:00 failures
            for (var i = 0; i < 5; i++) {
                engine.recordScheduledExperiment({ id: 's' + i, scheduledStart: '2025-06-' + (10 + i) + 'T09:00:00Z', outcome: 'success' });
                engine.recordScheduledExperiment({ id: 'f' + i, scheduledStart: '2025-06-' + (10 + i) + 'T14:00:00Z', outcome: 'failure' });
            }
            var p = engine.analyzeTemporalPatterns();
            expect(p.hourlySuccessRate['9']).toBe(1);
            expect(p.hourlySuccessRate['14']).toBe(0);
        });

        it('filters by protocol', function () {
            engine.recordScheduledExperiment({ id: 'a', protocol: 'p1', scheduledStart: '2025-06-10T09:00:00Z', outcome: 'success' });
            engine.recordScheduledExperiment({ id: 'b', protocol: 'p2', scheduledStart: '2025-06-10T09:00:00Z', outcome: 'failure' });
            var p = engine.analyzeTemporalPatterns('p1');
            expect(p.sampleSize).toBe(1);
            expect(p.hourlySuccessRate['9']).toBe(1);
        });

        it('computes daily success rates', function () {
            // Sunday success, Monday failure
            engine.recordScheduledExperiment({ id: 'a', scheduledStart: '2025-06-15T09:00:00Z', outcome: 'success' }); // Sunday
            engine.recordScheduledExperiment({ id: 'b', scheduledStart: '2025-06-16T09:00:00Z', outcome: 'failure' }); // Monday
            var p = engine.analyzeTemporalPatterns();
            expect(p.dailySuccessRate['Sunday']).toBe(1);
            expect(p.dailySuccessRate['Monday']).toBe(0);
        });

        it('ignores pending outcomes', function () {
            engine.recordScheduledExperiment({ id: 'a', scheduledStart: '2025-06-10T09:00:00Z', outcome: 'pending' });
            var p = engine.analyzeTemporalPatterns();
            expect(Object.keys(p.hourlySuccessRate).length).toBe(0);
        });
    });

    // ── Engine 3: Conflict Detector ────────────────────────────────

    describe('detectConflicts', function () {
        beforeEach(function () {
            engine.recordScheduledExperiment({
                id: 'existing-1',
                operator: 'alice',
                equipment: ['printer-1', 'incubator-2'],
                scheduledStart: '2025-06-15T09:00:00Z',
                scheduledEnd: '2025-06-15T12:00:00Z',
                outcome: 'pending'
            });
        });

        it('throws on missing times', function () {
            expect(function () { engine.detectConflicts(null, '2025-06-15T10:00:00Z'); }).toThrow();
        });

        it('throws on invalid range', function () {
            expect(function () { engine.detectConflicts('2025-06-15T12:00:00Z', '2025-06-15T09:00:00Z'); }).toThrow();
        });

        it('detects equipment conflict', function () {
            var c = engine.detectConflicts('2025-06-15T10:00:00Z', '2025-06-15T11:00:00Z', ['printer-1']);
            expect(c.length).toBe(1);
            expect(c[0].sharedResources).toContain('printer-1');
        });

        it('detects operator conflict', function () {
            var c = engine.detectConflicts('2025-06-15T10:00:00Z', '2025-06-15T11:00:00Z', [], 'alice');
            expect(c.length).toBe(1);
            expect(c[0].operatorConflict).toBe(true);
        });

        it('returns empty when no overlap', function () {
            var c = engine.detectConflicts('2025-06-15T13:00:00Z', '2025-06-15T14:00:00Z', ['printer-1']);
            expect(c.length).toBe(0);
        });

        it('returns empty for different resources', function () {
            var c = engine.detectConflicts('2025-06-15T10:00:00Z', '2025-06-15T11:00:00Z', ['printer-99']);
            expect(c.length).toBe(0);
        });

        it('calculates overlap minutes', function () {
            var c = engine.detectConflicts('2025-06-15T10:00:00Z', '2025-06-15T11:00:00Z', ['printer-1']);
            expect(c[0].overlapMinutes).toBe(60);
        });

        it('assigns high severity for multiple shared resources', function () {
            var c = engine.detectConflicts('2025-06-15T10:00:00Z', '2025-06-15T11:00:00Z', ['printer-1', 'incubator-2']);
            expect(c[0].severity).toBe('high');
        });

        it('ignores cancelled experiments', function () {
            engine.recordScheduledExperiment({
                id: 'cancelled-1', equipment: ['printer-1'],
                scheduledStart: '2025-06-15T10:00:00Z', scheduledEnd: '2025-06-15T11:00:00Z',
                outcome: 'cancelled'
            });
            var c = engine.detectConflicts('2025-06-15T10:00:00Z', '2025-06-15T11:00:00Z', ['printer-1']);
            // Only the first non-cancelled experiment should conflict
            expect(c.length).toBe(1);
            expect(c[0].experimentId).toBe('existing-1');
        });
    });

    // ── Engine 4: Optimal Window Predictor ─────────────────────────

    describe('predictOptimalWindows', function () {
        it('returns low confidence with insufficient data', function () {
            engine.recordScheduledExperiment({ id: 'a', scheduledStart: '2025-06-10T09:00:00Z', outcome: 'success' });
            var w = engine.predictOptimalWindows('unknown-protocol');
            expect(w.confidence).toBe('low');
            expect(w.recommendations.length).toBe(0);
        });

        it('recommends morning when morning success rate is high', function () {
            for (var i = 0; i < 10; i++) {
                engine.recordScheduledExperiment({ id: 's' + i, protocol: 'p1', scheduledStart: '2025-06-' + (10 + i) + 'T09:30:00Z', outcome: 'success' });
                engine.recordScheduledExperiment({ id: 'f' + i, protocol: 'p1', scheduledStart: '2025-06-' + (10 + i) + 'T20:00:00Z', outcome: 'failure' });
            }
            var w = engine.predictOptimalWindows('p1');
            expect(w.recommendations.length).toBeGreaterThan(0);
            expect(w.recommendations[0].successRate).toBeGreaterThan(0.5);
        });

        it('returns best days', function () {
            for (var i = 0; i < 5; i++) {
                engine.recordScheduledExperiment({ id: 'sun' + i, scheduledStart: '2025-06-15T09:00:00Z', outcome: 'success' }); // Sunday
                engine.recordScheduledExperiment({ id: 'mon' + i, scheduledStart: '2025-06-16T09:00:00Z', outcome: 'failure' }); // Monday
            }
            var w = engine.predictOptimalWindows();
            expect(w.bestDays.length).toBeGreaterThan(0);
            expect(w.bestDays[0].day).toBe('Sunday');
        });

        it('applies excludeHours constraint', function () {
            for (var i = 0; i < 10; i++) {
                engine.recordScheduledExperiment({ id: 'e' + i, scheduledStart: '2025-06-' + (10 + i) + 'T09:00:00Z', outcome: 'success' });
            }
            var w = engine.predictOptimalWindows(null, { excludeHours: [9] });
            var hasNine = w.recommendations.some(function (r) { return r.startHour === 9; });
            expect(hasNine).toBe(false);
        });

        it('confidence is medium for 10-19 experiments', function () {
            for (var i = 0; i < 15; i++) {
                engine.recordScheduledExperiment({ id: 'e' + i, scheduledStart: '2025-06-' + (10 + i % 20) + 'T10:00:00Z', outcome: 'success' });
            }
            var w = engine.predictOptimalWindows();
            expect(w.confidence).toBe('medium');
        });

        it('confidence is high for 20+ experiments', function () {
            for (var i = 0; i < 25; i++) {
                engine.recordScheduledExperiment({ id: 'e' + i, scheduledStart: '2025-06-' + (10 + i % 20) + 'T10:00:00Z', outcome: 'success' });
            }
            var w = engine.predictOptimalWindows();
            expect(w.confidence).toBe('high');
        });
    });

    // ── Engine 5: Workload Balancer ────────────────────────────────

    describe('analyzeWorkload', function () {
        it('returns empty for no data', function () {
            var w = engine.analyzeWorkload();
            expect(w.operatorLoad).toEqual({});
        });

        it('computes day distribution', function () {
            var now = new Date();
            for (var i = 0; i < 5; i++) {
                var d = new Date(now.getTime() - i * 86400000);
                engine.recordScheduledExperiment({ id: 'e' + i, operator: 'alice', scheduledStart: d.toISOString(), outcome: 'success' });
            }
            var w = engine.analyzeWorkload(7);
            expect(w.totalExperiments).toBe(5);
        });

        it('detects operator overload', function () {
            var now = new Date();
            // alice gets 10, bob/carol/dave get 1 each — clear imbalance
            for (var i = 0; i < 10; i++) {
                engine.recordScheduledExperiment({ id: 'a' + i, operator: 'alice', scheduledStart: new Date(now.getTime() - i * 3600000).toISOString() });
            }
            engine.recordScheduledExperiment({ id: 'b1', operator: 'bob', scheduledStart: now.toISOString() });
            engine.recordScheduledExperiment({ id: 'c1', operator: 'carol', scheduledStart: now.toISOString() });
            engine.recordScheduledExperiment({ id: 'd1', operator: 'dave', scheduledStart: now.toISOString() });
            var w = engine.analyzeWorkload(7);
            var overload = w.imbalances.filter(function (im) { return im.type === 'operator_overload'; });
            expect(overload.length).toBeGreaterThan(0);
            expect(overload[0].target).toBe('alice');
        });

        it('computes equipment load', function () {
            var now = new Date();
            engine.recordScheduledExperiment({ id: 'e1', equipment: ['printer-1'], scheduledStart: now.toISOString() });
            engine.recordScheduledExperiment({ id: 'e2', equipment: ['printer-1', 'incubator'], scheduledStart: now.toISOString() });
            var w = engine.analyzeWorkload(7);
            expect(w.equipmentLoad['printer-1']).toBe(2);
            expect(w.equipmentLoad['incubator']).toBe(1);
        });
    });

    // ── Engine 6: Health Scorer ─────────────────────────────────────

    describe('computeHealthScore', function () {
        it('returns default 50 with no data', function () {
            var h = engine.computeHealthScore();
            expect(h.score).toBe(50);
            expect(h.tier).toBe('Fair');
        });

        it('gives high score for all successes on time', function () {
            for (var i = 0; i < 10; i++) {
                engine.recordScheduledExperiment({
                    id: 'e' + i,
                    scheduledStart: '2025-06-' + (10 + i) + 'T09:00:00Z',
                    actualStart: '2025-06-' + (10 + i) + 'T09:00:00Z',
                    outcome: 'success'
                });
            }
            var h = engine.computeHealthScore();
            expect(h.score).toBeGreaterThanOrEqual(80);
            expect(h.tier).toBe('Excellent');
        });

        it('gives lower score for failures', function () {
            for (var i = 0; i < 10; i++) {
                engine.recordScheduledExperiment({
                    id: 'e' + i,
                    scheduledStart: '2025-06-' + (10 + i) + 'T09:00:00Z',
                    actualStart: '2025-06-' + (10 + i) + 'T09:00:00Z',
                    outcome: 'failure'
                });
            }
            var h = engine.computeHealthScore();
            expect(h.score).toBeLessThan(80);
        });

        it('penalizes late starts', function () {
            for (var i = 0; i < 5; i++) {
                engine.recordScheduledExperiment({
                    id: 'e' + i,
                    scheduledStart: '2025-06-' + (10 + i) + 'T09:00:00Z',
                    actualStart: '2025-06-' + (10 + i) + 'T10:30:00Z', // 90 min late
                    outcome: 'success'
                });
            }
            var h = engine.computeHealthScore();
            expect(h.components.punctuality).toBeLessThan(15);
        });

        it('has all component keys', function () {
            engine.recordScheduledExperiment({ id: 'e1', scheduledStart: '2025-06-10T09:00:00Z', actualStart: '2025-06-10T09:00:00Z', outcome: 'success' });
            var h = engine.computeHealthScore();
            expect(h.components).toHaveProperty('successRate');
            expect(h.components).toHaveProperty('punctuality');
            expect(h.components).toHaveProperty('conflictFreedom');
            expect(h.components).toHaveProperty('workloadBalance');
        });
    });

    // ── Engine 7: Insight Generator ────────────────────────────────

    describe('generateInsights', function () {
        it('returns info insight with insufficient data', function () {
            var insights = engine.generateInsights();
            expect(insights.length).toBe(1);
            expect(insights[0].type).toBe('info');
        });

        it('generates opportunity insight for high-success hour', function () {
            for (var i = 0; i < 10; i++) {
                engine.recordScheduledExperiment({ id: 's' + i, scheduledStart: '2025-06-' + (10 + i) + 'T09:00:00Z', outcome: 'success' });
            }
            // Add a few failures at another time to ensure contrast
            for (var j = 0; j < 3; j++) {
                engine.recordScheduledExperiment({ id: 'f' + j, scheduledStart: '2025-06-' + (10 + j) + 'T20:00:00Z', outcome: 'failure' });
            }
            var insights = engine.generateInsights();
            var opp = insights.filter(function (i) { return i.type === 'opportunity'; });
            expect(opp.length).toBeGreaterThan(0);
        });

        it('generates warning for low-success hour', function () {
            for (var i = 0; i < 5; i++) {
                engine.recordScheduledExperiment({ id: 'f' + i, scheduledStart: '2025-06-' + (10 + i) + 'T03:00:00Z', outcome: 'failure' });
                engine.recordScheduledExperiment({ id: 's' + i, scheduledStart: '2025-06-' + (10 + i) + 'T09:00:00Z', outcome: 'success' });
                engine.recordScheduledExperiment({ id: 'x' + i, scheduledStart: '2025-06-' + (10 + i) + 'T15:00:00Z', outcome: 'success' });
            }
            var insights = engine.generateInsights();
            var warn = insights.filter(function (i) { return i.type === 'warning'; });
            expect(warn.length).toBeGreaterThan(0);
        });

        it('generates strength insight for high-performing operator', function () {
            for (var i = 0; i < 10; i++) {
                engine.recordScheduledExperiment({ id: 'e' + i, operator: 'alice', scheduledStart: '2025-06-' + (10 + i) + 'T09:00:00Z', outcome: 'success' });
            }
            var insights = engine.generateInsights();
            var strength = insights.filter(function (i) { return i.type === 'strength'; });
            expect(strength.length).toBe(1);
            expect(strength[0].message).toContain('alice');
        });
    });

    // ── Dashboard ──────────────────────────────────────────────────

    describe('dashboard', function () {
        it('returns all sections', function () {
            engine.recordScheduledExperiment({ id: 'e1', scheduledStart: '2025-06-10T09:00:00Z', outcome: 'success' });
            var d = engine.dashboard();
            expect(d).toHaveProperty('health');
            expect(d).toHaveProperty('workload');
            expect(d).toHaveProperty('temporalPatterns');
            expect(d).toHaveProperty('insights');
            expect(d).toHaveProperty('recentConflicts');
            expect(d).toHaveProperty('experimentCount');
        });

        it('experimentCount matches recorded', function () {
            engine.recordScheduledExperiment({ id: 'a', scheduledStart: '2025-06-10T09:00:00Z' });
            engine.recordScheduledExperiment({ id: 'b', scheduledStart: '2025-06-11T09:00:00Z' });
            expect(engine.dashboard().experimentCount).toBe(2);
        });
    });
});
