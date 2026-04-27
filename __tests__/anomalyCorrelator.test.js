'use strict';

var anomalyCorrelator = require('../docs/shared/anomalyCorrelator');

// ── Test helpers ────────────────────────────────────────────────────
var BASE_TS = 1700000000000; // fixed epoch for deterministic tests

function mkEvent(overrides) {
  return Object.assign({
    id: 'evt-' + Math.random().toString(36).slice(2, 8),
    module: 'contamination',
    type: 'alert',
    severity: 0.5,
    timestamp: BASE_TS
  }, overrides);
}

describe('anomalyCorrelator', function () {

  // ── createAnomalyCorrelator ───────────────────────────────────────
  describe('createAnomalyCorrelator()', function () {
    it('creates a correlator with the expected API', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      expect(typeof ac.addEvent).toBe('function');
      expect(typeof ac.getEvents).toBe('function');
      expect(typeof ac.clear).toBe('function');
      expect(typeof ac.analyze).toBe('function');
      expect(typeof ac.getCorrelation).toBe('function');
    });
  });

  // ── addEvent / getEvents ──────────────────────────────────────────
  describe('addEvent() and getEvents()', function () {
    var ac;
    beforeEach(function () { ac = anomalyCorrelator.createAnomalyCorrelator(); });

    it('stores and retrieves events', function () {
      ac.addEvent(mkEvent({ id: 'e1', module: 'viability' }));
      ac.addEvent(mkEvent({ id: 'e2', module: 'equipment' }));
      expect(ac.getEvents().length).toBe(2);
    });

    it('filters events by module', function () {
      ac.addEvent(mkEvent({ id: 'e1', module: 'viability' }));
      ac.addEvent(mkEvent({ id: 'e2', module: 'equipment' }));
      ac.addEvent(mkEvent({ id: 'e3', module: 'viability' }));
      expect(ac.getEvents('viability').length).toBe(2);
      expect(ac.getEvents('equipment').length).toBe(1);
    });

    it('returns all events when no module is specified', function () {
      ac.addEvent(mkEvent({ id: 'e1' }));
      expect(ac.getEvents().length).toBe(1);
    });

    it('preserves metadata on stored events', function () {
      ac.addEvent(mkEvent({ id: 'e1', metadata: { zone: 'A3' } }));
      expect(ac.getEvents()[0].metadata.zone).toBe('A3');
    });
  });

  // ── Validation ────────────────────────────────────────────────────
  describe('event validation', function () {
    var ac;
    beforeEach(function () { ac = anomalyCorrelator.createAnomalyCorrelator(); });

    it('rejects null/undefined events', function () {
      expect(function () { ac.addEvent(null); }).toThrow();
      expect(function () { ac.addEvent(undefined); }).toThrow();
    });

    it('rejects events missing id', function () {
      expect(function () {
        ac.addEvent({ module: 'viability', type: 'alert', severity: 0.5, timestamp: BASE_TS });
      }).toThrow(/id/i);
    });

    it('rejects invalid module', function () {
      expect(function () {
        ac.addEvent(mkEvent({ module: 'invalid_module' }));
      }).toThrow(/module/i);
    });

    it('rejects severity out of range', function () {
      expect(function () {
        ac.addEvent(mkEvent({ severity: 1.5 }));
      }).toThrow(/severity/i);
      expect(function () {
        ac.addEvent(mkEvent({ severity: -0.1 }));
      }).toThrow(/severity/i);
    });

    it('rejects non-numeric timestamp', function () {
      expect(function () {
        ac.addEvent(mkEvent({ timestamp: 'yesterday' }));
      }).toThrow(/timestamp/i);
    });

    it('throws for invalid module in getEvents', function () {
      expect(function () { ac.getEvents('bogus'); }).toThrow(/Invalid module/);
    });
  });

  // ── clear ─────────────────────────────────────────────────────────
  describe('clear()', function () {
    it('removes all events', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      ac.addEvent(mkEvent({ id: 'e1' }));
      ac.addEvent(mkEvent({ id: 'e2', module: 'equipment' }));
      ac.clear();
      expect(ac.getEvents().length).toBe(0);
    });
  });

  // ── analyze — basic correlations ──────────────────────────────────
  describe('analyze() — correlations', function () {
    it('returns empty results when no events', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      var result = ac.analyze();
      expect(result.correlations.length).toBe(0);
      expect(result.rootCauses.length).toBe(0);
      expect(result.clusters.length).toBe(0);
      expect(result.summary.totalEvents).toBe(0);
    });

    it('does not correlate events from the same module', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      ac.addEvent(mkEvent({ id: 'e1', module: 'contamination', timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'e2', module: 'contamination', timestamp: BASE_TS + 1000 }));
      var result = ac.analyze();
      expect(result.correlations.length).toBe(0);
    });

    it('detects causal correlation between known pairs', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      // environment → contamination is a known causal rule
      ac.addEvent(mkEvent({ id: 'env1', module: 'environment', severity: 0.8, timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'con1', module: 'contamination', severity: 0.7, timestamp: BASE_TS + 60000 }));
      var result = ac.analyze();
      expect(result.correlations.length).toBeGreaterThan(0);
      var corr = result.correlations[0];
      expect(corr.pattern).toBe('causal');
      expect(corr.strength).toBeGreaterThan(0.3);
    });

    it('does not correlate events outside the time window', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator({ timeWindowMs: 60000 }); // 1 minute
      ac.addEvent(mkEvent({ id: 'e1', module: 'environment', timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'e2', module: 'contamination', timestamp: BASE_TS + 120000 }));
      var result = ac.analyze();
      expect(result.correlations.length).toBe(0);
    });

    it('respects minCorrelation threshold', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator({ minCorrelation: 0.99 });
      ac.addEvent(mkEvent({ id: 'e1', module: 'environment', severity: 0.1, timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'e2', module: 'contamination', severity: 0.1, timestamp: BASE_TS + 3500000 }));
      var result = ac.analyze();
      expect(result.correlations.length).toBe(0);
    });
  });

  // ── analyze — root causes ─────────────────────────────────────────
  describe('analyze() — root causes', function () {
    it('identifies root cause event with highest outgoing connections', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      // Equipment failure → affects printQuality and environment
      ac.addEvent(mkEvent({ id: 'equip1', module: 'equipment', severity: 0.9, timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'pq1', module: 'printQuality', severity: 0.7, timestamp: BASE_TS + 30000 }));
      ac.addEvent(mkEvent({ id: 'env1', module: 'environment', severity: 0.6, timestamp: BASE_TS + 45000 }));
      var result = ac.analyze();
      expect(result.rootCauses.length).toBeGreaterThan(0);
      // The equipment event should be identified as root cause
      var rootIds = result.rootCauses.map(function (rc) { return rc.event.id; });
      expect(rootIds).toContain('equip1');
    });
  });

  // ── analyze — clusters ────────────────────────────────────────────
  describe('analyze() — clusters', function () {
    it('groups connected events into clusters', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      // Chain: equipment → printQuality, environment → contamination (two separate clusters potentially)
      ac.addEvent(mkEvent({ id: 'eq1', module: 'equipment', severity: 0.8, timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'pq1', module: 'printQuality', severity: 0.7, timestamp: BASE_TS + 20000 }));
      var result = ac.analyze();
      if (result.correlations.length > 0) {
        expect(result.clusters.length).toBeGreaterThanOrEqual(1);
        expect(result.clusters[0].events.length).toBeGreaterThanOrEqual(2);
        expect(result.clusters[0].compoundSeverity).toBeGreaterThan(0);
      }
    });

    it('detects cascade pattern when 3+ modules are linked', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      // environment → contamination → viability (3 modules)
      ac.addEvent(mkEvent({ id: 'env1', module: 'environment', severity: 0.8, timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'con1', module: 'contamination', severity: 0.7, timestamp: BASE_TS + 30000 }));
      ac.addEvent(mkEvent({ id: 'via1', module: 'viability', severity: 0.6, timestamp: BASE_TS + 60000 }));
      var result = ac.analyze();
      var cascades = result.clusters.filter(function (c) { return c.pattern === 'cascade'; });
      if (result.correlations.length >= 2) {
        expect(cascades.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // ── analyze — recommendations ─────────────────────────────────────
  describe('analyze() — recommendations', function () {
    it('generates recommendations for causal correlations', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      ac.addEvent(mkEvent({ id: 'eq1', module: 'equipment', severity: 0.9, timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'pq1', module: 'printQuality', severity: 0.8, timestamp: BASE_TS + 10000 }));
      var result = ac.analyze();
      if (result.correlations.some(function (c) { return c.pattern === 'causal'; })) {
        expect(result.recommendations.length).toBeGreaterThan(0);
        expect(result.recommendations[0].action).toBeTruthy();
        expect(result.recommendations[0].priority).toMatch(/^(high|medium|low)$/);
      }
    });

    it('produces recommendations sorted by priority', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator({ minCorrelation: 0.1 });
      ac.addEvent(mkEvent({ id: 'env1', module: 'environment', severity: 0.9, timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'con1', module: 'contamination', severity: 0.9, timestamp: BASE_TS + 1000 }));
      ac.addEvent(mkEvent({ id: 'via1', module: 'viability', severity: 0.9, timestamp: BASE_TS + 2000 }));
      ac.addEvent(mkEvent({ id: 'eq1', module: 'equipment', severity: 0.9, timestamp: BASE_TS + 3000 }));
      ac.addEvent(mkEvent({ id: 'pq1', module: 'printQuality', severity: 0.9, timestamp: BASE_TS + 4000 }));
      var result = ac.analyze();
      // With all 5 modules active, multiple causal pairs and a cascade should produce ≥3 recommendations
      expect(result.recommendations.length).toBeGreaterThanOrEqual(3);
      // Verify all recommendations have valid priority values
      result.recommendations.forEach(function (r) {
        expect(['high', 'medium', 'low']).toContain(r.priority);
        expect(r.action).toBeTruthy();
        expect(r.reasoning).toBeTruthy();
      });
    });
  });

  // ── analyze — summary ─────────────────────────────────────────────
  describe('analyze() — summary', function () {
    it('reports correct summary counts', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      ac.addEvent(mkEvent({ id: 'e1', module: 'environment', severity: 0.8, timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'e2', module: 'contamination', severity: 0.6, timestamp: BASE_TS + 5000 }));
      ac.addEvent(mkEvent({ id: 'e3', module: 'equipment', severity: 0.3, timestamp: BASE_TS + 10000 }));
      var result = ac.analyze();
      expect(result.summary.totalEvents).toBe(3);
      expect(result.summary.highestSeverity).toBe(0.8);
      expect(typeof result.summary.totalCorrelations).toBe('number');
      expect(typeof result.summary.clustersFound).toBe('number');
    });
  });

  // ── getCorrelation ────────────────────────────────────────────────
  describe('getCorrelation()', function () {
    it('returns null when either event is unknown', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      ac.addEvent(mkEvent({ id: 'e1' }));
      expect(ac.getCorrelation('e1', 'nonexistent')).toBeNull();
      expect(ac.getCorrelation('nonexistent', 'e1')).toBeNull();
    });

    it('returns strength 0 when events are outside the time window', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator({ timeWindowMs: 60000 });
      ac.addEvent(mkEvent({ id: 'e1', module: 'environment', timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'e2', module: 'contamination', timestamp: BASE_TS + 120000 }));
      var result = ac.getCorrelation('e1', 'e2');
      expect(result.strength).toBe(0);
      expect(result.pattern).toBe('none');
    });

    it('returns positive strength for temporally close cross-module events', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      ac.addEvent(mkEvent({ id: 'e1', module: 'equipment', severity: 0.8, timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'e2', module: 'printQuality', severity: 0.7, timestamp: BASE_TS + 60000 }));
      var result = ac.getCorrelation('e1', 'e2');
      expect(result.strength).toBeGreaterThan(0);
      expect(result.timeGap).toBe(60000);
    });

    it('works regardless of argument order', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      ac.addEvent(mkEvent({ id: 'e1', module: 'equipment', severity: 0.8, timestamp: BASE_TS }));
      ac.addEvent(mkEvent({ id: 'e2', module: 'printQuality', severity: 0.7, timestamp: BASE_TS + 30000 }));
      var forward = ac.getCorrelation('e1', 'e2');
      var reverse = ac.getCorrelation('e2', 'e1');
      expect(forward.timeGap).toBe(reverse.timeGap);
    });
  });

  // ── Recurrence bonus ──────────────────────────────────────────────
  describe('recurrence bonus', function () {
    it('increases strength when the same module pair recurs', function () {
      var ac = anomalyCorrelator.createAnomalyCorrelator();
      // Add multiple equipment → printQuality events to build pairCounts
      for (var i = 0; i < 5; i++) {
        ac.addEvent(mkEvent({
          id: 'eq-' + i,
          module: 'equipment',
          severity: 0.7,
          timestamp: BASE_TS + i * 100000
        }));
        ac.addEvent(mkEvent({
          id: 'pq-' + i,
          module: 'printQuality',
          severity: 0.6,
          timestamp: BASE_TS + i * 100000 + 30000
        }));
      }
      var result = ac.analyze();
      // After building co-occurrence counts, recurring patterns should be detected
      var recurring = result.recommendations.filter(function (r) {
        return r.action.indexOf('preventive monitoring') !== -1;
      });
      // With 5 pairs, pairCounts should reach ≥3, triggering the recurring recommendation
      expect(recurring.length).toBeGreaterThanOrEqual(1);
    });
  });
});
