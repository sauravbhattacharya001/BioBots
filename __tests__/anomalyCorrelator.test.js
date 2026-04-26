'use strict';

var ac = require('../docs/shared/anomalyCorrelator');

describe('anomalyCorrelator', function () {
    var correlator;
    var NOW = 1700000000000;

    beforeEach(function () {
        correlator = ac.createAnomalyCorrelator();
    });

    function mkEvent(overrides) {
        return Object.assign({
            id: 'e1',
            module: 'environment',
            type: 'temp_spike',
            severity: 0.7,
            timestamp: NOW
        }, overrides);
    }

    // ── addEvent validation ────────────────────────────────────────

    describe('addEvent', function () {
        it('accepts a valid event', function () {
            correlator.addEvent(mkEvent());
            expect(correlator.getEvents()).toHaveLength(1);
        });

        it('rejects null event', function () {
            expect(function () { correlator.addEvent(null); }).toThrow(/non-null object/);
        });

        it('rejects missing id', function () {
            expect(function () { correlator.addEvent(mkEvent({ id: '' })); }).toThrow(/non-empty string/);
        });

        it('rejects invalid module', function () {
            expect(function () { correlator.addEvent(mkEvent({ module: 'bogus' })); }).toThrow(/must be one of/);
        });

        it('rejects severity out of range', function () {
            expect(function () { correlator.addEvent(mkEvent({ severity: 1.5 })); }).toThrow(/between 0 and 1/);
        });

        it('rejects non-number timestamp', function () {
            expect(function () { correlator.addEvent(mkEvent({ timestamp: 'noon' })); }).toThrow(/valid number/);
        });
    });

    // ── getEvents ──────────────────────────────────────────────────

    describe('getEvents', function () {
        it('returns all events without filter', function () {
            correlator.addEvent(mkEvent({ id: 'e1', module: 'environment' }));
            correlator.addEvent(mkEvent({ id: 'e2', module: 'contamination' }));
            expect(correlator.getEvents()).toHaveLength(2);
        });

        it('filters by module', function () {
            correlator.addEvent(mkEvent({ id: 'e1', module: 'environment' }));
            correlator.addEvent(mkEvent({ id: 'e2', module: 'contamination' }));
            expect(correlator.getEvents('environment')).toHaveLength(1);
        });

        it('throws for invalid module filter', function () {
            expect(function () { correlator.getEvents('invalid'); }).toThrow(/Invalid module/);
        });

        it('returns copies (not internal array)', function () {
            correlator.addEvent(mkEvent({ id: 'e1' }));
            var events = correlator.getEvents();
            events.push({});
            expect(correlator.getEvents()).toHaveLength(1);
        });
    });

    // ── clear ──────────────────────────────────────────────────────

    describe('clear', function () {
        it('removes all events', function () {
            correlator.addEvent(mkEvent({ id: 'e1' }));
            correlator.addEvent(mkEvent({ id: 'e2', module: 'contamination' }));
            correlator.clear();
            expect(correlator.getEvents()).toHaveLength(0);
        });
    });

    // ── analyze ────────────────────────────────────────────────────

    describe('analyze', function () {
        it('returns empty results for no events', function () {
            var result = correlator.analyze();
            expect(result.correlations).toEqual([]);
            expect(result.rootCauses).toEqual([]);
            expect(result.clusters).toEqual([]);
            expect(result.summary.totalEvents).toBe(0);
        });

        it('detects causal correlation between environment and contamination', function () {
            correlator.addEvent(mkEvent({ id: 'env1', module: 'environment', timestamp: NOW, severity: 0.8 }));
            correlator.addEvent(mkEvent({ id: 'cont1', module: 'contamination', timestamp: NOW + 60000, severity: 0.7, type: 'detected' }));
            var result = correlator.analyze();
            expect(result.correlations.length).toBeGreaterThanOrEqual(1);
            var corr = result.correlations[0];
            expect(corr.pattern).toBe('causal');
            expect(corr.strength).toBeGreaterThan(0.3);
        });

        it('does not correlate events outside time window', function () {
            var c = ac.createAnomalyCorrelator({ timeWindowMs: 1000 });
            c.addEvent(mkEvent({ id: 'e1', module: 'environment', timestamp: NOW }));
            c.addEvent(mkEvent({ id: 'e2', module: 'contamination', timestamp: NOW + 5000 }));
            var result = c.analyze();
            expect(result.correlations).toEqual([]);
        });

        it('does not correlate events from the same module', function () {
            correlator.addEvent(mkEvent({ id: 'e1', module: 'environment', timestamp: NOW }));
            correlator.addEvent(mkEvent({ id: 'e2', module: 'environment', timestamp: NOW + 1000, type: 'humidity_spike' }));
            var result = correlator.analyze();
            expect(result.correlations).toEqual([]);
        });

        it('identifies root causes with high outgoing correlation', function () {
            correlator.addEvent(mkEvent({ id: 'eq1', module: 'equipment', timestamp: NOW, severity: 0.9, type: 'malfunction' }));
            correlator.addEvent(mkEvent({ id: 'pq1', module: 'printQuality', timestamp: NOW + 30000, severity: 0.8, type: 'defect' }));
            correlator.addEvent(mkEvent({ id: 'env1', module: 'environment', timestamp: NOW + 60000, severity: 0.6, type: 'drift' }));
            var result = correlator.analyze();
            expect(result.rootCauses.length).toBeGreaterThanOrEqual(1);
            expect(result.rootCauses[0].event.id).toBe('eq1');
        });

        it('creates clusters from connected correlated events', function () {
            correlator.addEvent(mkEvent({ id: 'env1', module: 'environment', timestamp: NOW, severity: 0.8 }));
            correlator.addEvent(mkEvent({ id: 'cont1', module: 'contamination', timestamp: NOW + 30000, severity: 0.7, type: 'detected' }));
            correlator.addEvent(mkEvent({ id: 'via1', module: 'viability', timestamp: NOW + 60000, severity: 0.6, type: 'drop' }));
            var result = correlator.analyze();
            expect(result.clusters.length).toBeGreaterThanOrEqual(1);
            expect(result.clusters[0].events.length).toBeGreaterThanOrEqual(2);
            expect(result.clusters[0].compoundSeverity).toBeGreaterThan(0);
        });

        it('generates recommendations for causal correlations', function () {
            correlator.addEvent(mkEvent({ id: 'eq1', module: 'equipment', timestamp: NOW, severity: 0.9, type: 'failure' }));
            correlator.addEvent(mkEvent({ id: 'pq1', module: 'printQuality', timestamp: NOW + 10000, severity: 0.8, type: 'defect' }));
            var result = correlator.analyze();
            expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
            var rec = result.recommendations.find(function (r) { return /maintenance/i.test(r.action); });
            expect(rec).toBeDefined();
        });

        it('detects cascade pattern with 3+ modules', function () {
            correlator.addEvent(mkEvent({ id: 'eq1', module: 'equipment', timestamp: NOW, severity: 0.9, type: 'failure' }));
            correlator.addEvent(mkEvent({ id: 'env1', module: 'environment', timestamp: NOW + 10000, severity: 0.7, type: 'drift' }));
            correlator.addEvent(mkEvent({ id: 'pq1', module: 'printQuality', timestamp: NOW + 20000, severity: 0.8, type: 'defect' }));
            var result = correlator.analyze();
            var cascade = result.clusters.find(function (c) { return c.pattern === 'cascade'; });
            expect(cascade).toBeDefined();
        });

        it('summary includes correct totals', function () {
            correlator.addEvent(mkEvent({ id: 'e1', module: 'environment', timestamp: NOW, severity: 0.9 }));
            correlator.addEvent(mkEvent({ id: 'e2', module: 'contamination', timestamp: NOW + 1000, severity: 0.5 }));
            var result = correlator.analyze();
            expect(result.summary.totalEvents).toBe(2);
            expect(result.summary.highestSeverity).toBe(0.9);
        });
    });

    // ── getCorrelation ─────────────────────────────────────────────

    describe('getCorrelation', function () {
        it('returns null for unknown event IDs', function () {
            expect(correlator.getCorrelation('x', 'y')).toBeNull();
        });

        it('returns strength 0 for events outside time window', function () {
            var c = ac.createAnomalyCorrelator({ timeWindowMs: 1000 });
            c.addEvent(mkEvent({ id: 'e1', module: 'environment', timestamp: NOW }));
            c.addEvent(mkEvent({ id: 'e2', module: 'contamination', timestamp: NOW + 5000 }));
            var corr = c.getCorrelation('e1', 'e2');
            expect(corr.strength).toBe(0);
        });

        it('returns positive strength for close causally-related events', function () {
            correlator.addEvent(mkEvent({ id: 'e1', module: 'environment', timestamp: NOW, severity: 0.8 }));
            correlator.addEvent(mkEvent({ id: 'e2', module: 'contamination', timestamp: NOW + 60000, severity: 0.7 }));
            var corr = correlator.getCorrelation('e1', 'e2');
            expect(corr.strength).toBeGreaterThan(0);
            expect(corr.timeGap).toBe(60000);
        });

        it('returns higher strength for closer events', function () {
            correlator.addEvent(mkEvent({ id: 'e1', module: 'environment', timestamp: NOW }));
            correlator.addEvent(mkEvent({ id: 'e2', module: 'contamination', timestamp: NOW + 60000 }));
            correlator.addEvent(mkEvent({ id: 'e3', module: 'contamination', timestamp: NOW + 600000 }));
            var close = correlator.getCorrelation('e1', 'e2');
            var far = correlator.getCorrelation('e1', 'e3');
            expect(close.strength).toBeGreaterThan(far.strength);
        });
    });

    // ── Custom options ─────────────────────────────────────────────

    describe('custom options', function () {
        it('respects custom timeWindowMs', function () {
            var c = ac.createAnomalyCorrelator({ timeWindowMs: 500 });
            c.addEvent(mkEvent({ id: 'e1', module: 'environment', timestamp: NOW }));
            c.addEvent(mkEvent({ id: 'e2', module: 'contamination', timestamp: NOW + 400 }));
            c.addEvent(mkEvent({ id: 'e3', module: 'viability', timestamp: NOW + 600 }));
            var result = c.analyze();
            // e1-e2 within window, e1-e3 outside
            var hasE1E2 = result.correlations.some(function (c) { return c.eventA === 'e1' && c.eventB === 'e2'; });
            var hasE1E3 = result.correlations.some(function (c) { return c.eventA === 'e1' && c.eventB === 'e3'; });
            expect(hasE1E2).toBe(true);
            expect(hasE1E3).toBe(false);
        });

        it('respects custom minCorrelation', function () {
            var c = ac.createAnomalyCorrelator({ minCorrelation: 0.99 });
            c.addEvent(mkEvent({ id: 'e1', module: 'environment', timestamp: NOW, severity: 0.3 }));
            c.addEvent(mkEvent({ id: 'e2', module: 'contamination', timestamp: NOW + 1000, severity: 0.3 }));
            var result = c.analyze();
            expect(result.correlations).toEqual([]);
        });
    });

    // ── Metadata preservation ──────────────────────────────────────

    describe('metadata', function () {
        it('preserves event metadata', function () {
            correlator.addEvent(mkEvent({ id: 'e1', metadata: { zone: 'A', sensor: 'T1' } }));
            var events = correlator.getEvents();
            expect(events[0].metadata).toEqual({ zone: 'A', sensor: 'T1' });
        });

        it('defaults metadata to empty object', function () {
            correlator.addEvent(mkEvent({ id: 'e1' }));
            var events = correlator.getEvents();
            expect(events[0].metadata).toEqual({});
        });
    });
});
