'use strict';

var _mod = require('../Try/scripts/contaminationTracker');
var createContaminationTracker = _mod.createContaminationTracker;

function mkEvent(type, severity, extra) {
  var base = { type: type || 'bacterial', severity: severity || 'medium' };
  if (extra) Object.assign(base, extra);
  return base;
}

function seedTracker(n) {
  var tracker = createContaminationTracker();
  var types = ['bacterial', 'fungal', 'mycoplasma', 'particulate', 'chemical'];
  var sevs = ['low', 'medium', 'high', 'critical'];
  var sources = ['nozzle_assembly', 'bioink', 'room_air', 'operator_contact', 'media'];
  var now = Date.now();
  for (var i = 0; i < n; i++) {
    tracker.logEvent({
      type: types[i % types.length],
      severity: sevs[i % sevs.length],
      source: sources[i % sources.length],
      operator: 'Dr. Test',
      timestamp: new Date(now - (n - i) * 3600000).toISOString(),
      environment: {
        tempC: 22 + (i % 10),
        humidityPct: 40 + (i % 30),
        airQualityIndex: 20 + (i % 40)
      }
    });
  }
  return tracker;
}

// ── logEvent ────────────────────────────────────────────────────

test('logEvent creates event with generated ID', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent('bacterial', 'high'));
  expect(evt.id).toBe('CONTAM-0001');
  expect(evt.type).toBe('bacterial');
  expect(evt.severity).toBe('high');
  expect(evt.resolved).toBe(false);
});

test('logEvent assigns sequential IDs', function () {
  var t = createContaminationTracker();
  var e1 = t.logEvent(mkEvent());
  var e2 = t.logEvent(mkEvent());
  expect(e1.id).toBe('CONTAM-0001');
  expect(e2.id).toBe('CONTAM-0002');
});

test('logEvent rejects invalid type', function () {
  var t = createContaminationTracker();
  expect(function () { t.logEvent({ type: 'magic', severity: 'low' }); }).toThrow(/Invalid contamination type/);
});

test('logEvent rejects invalid severity', function () {
  var t = createContaminationTracker();
  expect(function () { t.logEvent({ type: 'bacterial', severity: 'extreme' }); }).toThrow(/Invalid severity/);
});

test('logEvent rejects invalid detection method', function () {
  var t = createContaminationTracker();
  expect(function () {
    t.logEvent({ type: 'bacterial', severity: 'low', detectionMethod: 'magic_wand' });
  }).toThrow(/Invalid detection method/);
});

test('logEvent rejects null data', function () {
  var t = createContaminationTracker();
  expect(function () { t.logEvent(null); }).toThrow(/non-null object/);
});

test('logEvent stores environment data', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent({
    type: 'fungal', severity: 'medium',
    environment: { tempC: 25, humidityPct: 70, airQualityIndex: 35 }
  });
  expect(evt.environment.tempC).toBe(25);
  expect(evt.environment.humidityPct).toBe(70);
});

test('logEvent clamps humidity to 0-100', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent({
    type: 'bacterial', severity: 'low',
    environment: { humidityPct: 150 }
  });
  expect(evt.environment.humidityPct).toBe(100);
});

test('logEvent stores affected batches', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent({
    type: 'bacterial', severity: 'high',
    affectedBatches: ['B-001', 'B-002']
  });
  expect(evt.affectedBatches).toEqual(['B-001', 'B-002']);
});

test('logEvent accepts all valid detection methods', function () {
  var t = createContaminationTracker();
  t.DETECTION_METHODS.forEach(function (m) {
    var evt = t.logEvent({ type: 'bacterial', severity: 'low', detectionMethod: m });
    expect(evt.detectionMethod).toBe(m);
  });
});

test('logEvent accepts all contamination types', function () {
  var t = createContaminationTracker();
  t.CONTAMINATION_TYPES.forEach(function (ct) {
    var evt = t.logEvent({ type: ct, severity: 'low' });
    expect(evt.type).toBe(ct);
  });
});

test('logEvent stores organism field', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent({
    type: 'bacterial', severity: 'high',
    organism: 'E. coli', detectionMethod: 'culture'
  });
  expect(evt.organism).toBe('E. coli');
});

// ── resolveEvent ────────────────────────────────────────────────

test('resolveEvent marks event as resolved', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent());
  var resolved = t.resolveEvent(evt.id, 'Cleaned and retested');
  expect(resolved.resolved).toBe(true);
  expect(resolved.resolutionNotes).toBe('Cleaned and retested');
  expect(resolved.resolvedAt).toBeTruthy();
});

test('resolveEvent throws on unknown event', function () {
  var t = createContaminationTracker();
  expect(function () { t.resolveEvent('CONTAM-9999'); }).toThrow(/not found/);
});

test('resolveEvent throws on already resolved', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent());
  t.resolveEvent(evt.id);
  expect(function () { t.resolveEvent(evt.id); }).toThrow(/already resolved/);
});

// ── getEvent / listEvents ───────────────────────────────────────

test('getEvent returns event by ID', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent('fungal', 'high'));
  expect(t.getEvent(evt.id).type).toBe('fungal');
});

test('getEvent returns null for missing', function () {
  var t = createContaminationTracker();
  expect(t.getEvent('CONTAM-9999')).toBe(null);
});

test('listEvents returns all when no filters', function () {
  var t = seedTracker(5);
  expect(t.listEvents().length).toBe(5);
});

test('listEvents filters by type', function () {
  var t = seedTracker(10);
  var bacterial = t.listEvents({ type: 'bacterial' });
  bacterial.forEach(function (e) { expect(e.type).toBe('bacterial'); });
});

test('listEvents filters by severity', function () {
  var t = seedTracker(10);
  var high = t.listEvents({ severity: 'high' });
  high.forEach(function (e) { expect(e.severity).toBe('high'); });
});

test('listEvents filters by resolved', function () {
  var t = createContaminationTracker();
  var e1 = t.logEvent(mkEvent());
  t.logEvent(mkEvent());
  t.resolveEvent(e1.id);
  expect(t.listEvents({ resolved: true }).length).toBe(1);
  expect(t.listEvents({ resolved: false }).length).toBe(1);
});

test('listEvents filters by source', function () {
  var t = seedTracker(10);
  var nozzle = t.listEvents({ source: 'nozzle_assembly' });
  nozzle.forEach(function (e) { expect(e.source).toBe('nozzle_assembly'); });
});

// ── analyseEvent ────────────────────────────────────────────────

test('analyseEvent returns probable causes', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent('bacterial', 'high', { source: 'nozzle_assembly' }));
  var analysis = t.analyseEvent(evt.id);
  expect(analysis.eventId).toBe(evt.id);
  expect(analysis.probableCauses.length > 0).toBeTruthy();
  expect(analysis.topCause).toBeTruthy();
  expect(analysis.recommendedActions.length > 0).toBeTruthy();
});

test('analyseEvent boosts reported source', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent('bacterial', 'high', { source: 'nozzle_assembly' }));
  var analysis = t.analyseEvent(evt.id);
  expect(analysis.topCause.source).toBe('nozzle_assembly');
});

test('analyseEvent probabilities sum to ~1', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent('fungal', 'medium'));
  var analysis = t.analyseEvent(evt.id);
  var sum = analysis.probableCauses.reduce(function (s, c) { return s + c.probability; }, 0);
  expect(Math.abs(sum - 1.0) < 0.05).toBeTruthy();
});

test('analyseEvent considers environmental factors', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent({
    type: 'fungal', severity: 'high',
    environment: { humidityPct: 85 }
  });
  var analysis = t.analyseEvent(evt.id);
  expect(analysis.probableCauses.length > 0).toBeTruthy();
});

test('analyseEvent throws on unknown event', function () {
  var t = createContaminationTracker();
  expect(function () { t.analyseEvent('CONTAM-9999'); }).toThrow(/not found/);
});

test('analyseEvent historical pattern boost', function () {
  var t = createContaminationTracker();
  t.logEvent(mkEvent('bacterial', 'low', { source: 'tubing' }));
  t.logEvent(mkEvent('bacterial', 'medium', { source: 'tubing' }));
  var evt = t.logEvent(mkEvent('bacterial', 'high', { source: 'nozzle_assembly' }));
  var analysis = t.analyseEvent(evt.id);
  var tubing = analysis.probableCauses.find(function (c) { return c.source === 'tubing'; });
  expect(tubing).toBeTruthy();
  expect(tubing.historicalOccurrences >= 2).toBeTruthy();
});

// ── quarantine ──────────────────────────────────────────────────

test('quarantine creates record', function () {
  var t = createContaminationTracker();
  var q = t.quarantine({ itemId: 'BATCH-001', itemType: 'batch', reason: 'contaminated' });
  expect(q.id).toBe('QUAR-0001');
  expect(q.state).toBe('active');
});

test('quarantine rejects invalid itemType', function () {
  var t = createContaminationTracker();
  expect(function () {
    t.quarantine({ itemId: 'X', itemType: 'other', reason: 'test' });
  }).toThrow(/must be batch or equipment/);
});

test('quarantine rejects missing fields', function () {
  var t = createContaminationTracker();
  expect(function () { t.quarantine({}); }).toThrow(/required/);
});

test('updateQuarantine clears record', function () {
  var t = createContaminationTracker();
  var q = t.quarantine({ itemId: 'EQ-1', itemType: 'equipment', reason: 'suspect' });
  var updated = t.updateQuarantine(q.id, 'cleared', 'Tests negative');
  expect(updated.state).toBe('cleared');
  expect(updated.clearedAt).toBeTruthy();
});

test('updateQuarantine disposes record', function () {
  var t = createContaminationTracker();
  var q = t.quarantine({ itemId: 'B-1', itemType: 'batch', reason: 'positive culture' });
  var updated = t.updateQuarantine(q.id, 'disposed');
  expect(updated.state).toBe('disposed');
  expect(updated.disposedAt).toBeTruthy();
});

test('updateQuarantine rejects non-active', function () {
  var t = createContaminationTracker();
  var q = t.quarantine({ itemId: 'B-1', itemType: 'batch', reason: 'test' });
  t.updateQuarantine(q.id, 'cleared');
  expect(function () { t.updateQuarantine(q.id, 'disposed'); }).toThrow(/active/);
});

test('listQuarantines filters by state', function () {
  var t = createContaminationTracker();
  var q1 = t.quarantine({ itemId: 'A', itemType: 'batch', reason: 'r' });
  t.quarantine({ itemId: 'B', itemType: 'equipment', reason: 'r' });
  t.updateQuarantine(q1.id, 'cleared');
  expect(t.listQuarantines({ state: 'active' }).length).toBe(1);
  expect(t.listQuarantines({ state: 'cleared' }).length).toBe(1);
});

test('listQuarantines filters by itemType', function () {
  var t = createContaminationTracker();
  t.quarantine({ itemId: 'A', itemType: 'batch', reason: 'r' });
  t.quarantine({ itemId: 'B', itemType: 'equipment', reason: 'r' });
  expect(t.listQuarantines({ itemType: 'batch' }).length).toBe(1);
});

// ── preventionProtocols ─────────────────────────────────────────

test('preventionProtocols returns all sections', function () {
  var t = createContaminationTracker();
  var protocols = t.preventionProtocols('bacterial');
  expect(protocols.immediate.length > 0).toBeTruthy();
  expect(protocols.ongoing.length > 0).toBeTruthy();
  expect(protocols.monitoring.length > 0).toBeTruthy();
});

test('preventionProtocols works for all types', function () {
  var t = createContaminationTracker();
  t.CONTAMINATION_TYPES.forEach(function (ct) {
    var p = t.preventionProtocols(ct);
    expect(p.immediate.length > 0).toBeTruthy();
  });
});

test('preventionProtocols rejects invalid type', function () {
  var t = createContaminationTracker();
  expect(function () { t.preventionProtocols('invalid'); }).toThrow(/Invalid contamination type/);
});

// ── trendReport ─────────────────────────────────────────────────

test('trendReport on empty tracker', function () {
  var t = createContaminationTracker();
  var report = t.trendReport();
  expect(report.totalEvents).toBe(0);
  expect(report.riskScore).toBe(0);
  expect(report.riskLevel).toBe('low');
});

test('trendReport counts events in window', function () {
  var t = seedTracker(10);
  var report = t.trendReport({ windowDays: 365 });
  expect(report.totalEvents).toBe(10);
});

test('trendReport type breakdown', function () {
  var t = seedTracker(10);
  var report = t.trendReport({ windowDays: 365 });
  expect(report.byType.bacterial >= 1).toBeTruthy();
});

test('trendReport severity breakdown', function () {
  var t = seedTracker(10);
  var report = t.trendReport({ windowDays: 365 });
  var total = Object.values(report.bySeverity).reduce(function (s, v) { return s + v; }, 0);
  expect(total).toBe(10);
});

test('trendReport identifies hotspots', function () {
  var t = seedTracker(10);
  var report = t.trendReport({ windowDays: 365 });
  expect(report.hotspots.length > 0).toBeTruthy();
  expect(report.hotspots[0].count >= 1).toBeTruthy();
});

test('trendReport detects recurring patterns', function () {
  var t = createContaminationTracker();
  t.logEvent(mkEvent('bacterial', 'high', { source: 'nozzle_assembly' }));
  t.logEvent(mkEvent('bacterial', 'high', { source: 'nozzle_assembly' }));
  t.logEvent(mkEvent('bacterial', 'high', { source: 'nozzle_assembly' }));
  var report = t.trendReport({ windowDays: 365 });
  expect(report.recurringPatterns.length >= 1).toBeTruthy();
  expect(report.recurringPatterns[0].type).toBe('bacterial');
  expect(report.recurringPatterns[0].source).toBe('nozzle_assembly');
});

test('trendReport calculates risk level', function () {
  var t = createContaminationTracker();
  for (var i = 0; i < 5; i++) {
    t.logEvent(mkEvent('bacterial', 'critical'));
  }
  var report = t.trendReport({ windowDays: 365 });
  expect(report.riskLevel).toBe('critical');
});

test('trendReport counts unresolved', function () {
  var t = createContaminationTracker();
  var e1 = t.logEvent(mkEvent());
  t.logEvent(mkEvent());
  t.resolveEvent(e1.id);
  var report = t.trendReport({ windowDays: 365 });
  expect(report.unresolvedCount).toBe(1);
});

test('trendReport includes environment correlation', function () {
  var t = seedTracker(10);
  var report = t.trendReport({ windowDays: 365 });
  expect(report.environmentCorrelation).toBeTruthy();
  expect(report.environmentCorrelation.temperature).toBeTruthy();
});

// ── sourceRiskScores ────────────────────────────────────────────

test('sourceRiskScores ranks by risk', function () {
  var t = seedTracker(10);
  var scores = t.sourceRiskScores();
  expect(scores.length > 0).toBeTruthy();
  for (var i = 1; i < scores.length; i++) {
    expect(scores[i - 1].riskScore >= scores[i].riskScore).toBeTruthy();
  }
});

test('sourceRiskScores includes category', function () {
  var t = seedTracker(5);
  var scores = t.sourceRiskScores();
  scores.forEach(function (s) {
    expect(['equipment', 'material', 'environment', 'human', 'unknown'].indexOf(s.category) !== -1).toBeTruthy();
  });
});

// ── summary ─────────────────────────────────────────────────────

test('summary returns correct counts', function () {
  var t = createContaminationTracker();
  t.logEvent(mkEvent('bacterial', 'high'));
  var e2 = t.logEvent(mkEvent('fungal', 'low'));
  t.logEvent(mkEvent('bacterial', 'medium'));
  t.resolveEvent(e2.id);
  var s = t.summary();
  expect(s.totalEvents).toBe(3);
  expect(s.resolvedEvents).toBe(1);
  expect(s.unresolvedEvents).toBe(2);
  expect(s.mostCommonType).toBe('bacterial');
});

test('summary on empty tracker', function () {
  var t = createContaminationTracker();
  var s = t.summary();
  expect(s.totalEvents).toBe(0);
  expect(s.meanTimeToResolutionHours).toBe(null);
});

test('summary counts active quarantines', function () {
  var t = createContaminationTracker();
  t.quarantine({ itemId: 'A', itemType: 'batch', reason: 'r' });
  t.quarantine({ itemId: 'B', itemType: 'batch', reason: 'r' });
  expect(t.summary().activeQuarantines).toBe(2);
});

// ── export / import ─────────────────────────────────────────────

test('exportData returns events and quarantines', function () {
  var t = createContaminationTracker();
  t.logEvent(mkEvent());
  t.quarantine({ itemId: 'A', itemType: 'batch', reason: 'r' });
  var data = t.exportData();
  expect(data.events.length).toBe(1);
  expect(data.quarantines.length).toBe(1);
  expect(data.exportedAt).toBeTruthy();
});

test('importData restores events', function () {
  var t1 = createContaminationTracker();
  t1.logEvent(mkEvent('bacterial', 'high'));
  t1.quarantine({ itemId: 'A', itemType: 'batch', reason: 'r' });
  var data = t1.exportData();

  var t2 = createContaminationTracker();
  t2.importData(data);
  expect(t2.listEvents().length).toBe(1);
  expect(t2.listQuarantines().length).toBe(1);
});

test('importData rejects invalid data', function () {
  var t = createContaminationTracker();
  expect(function () { t.importData({}); }).toThrow(/events array required/);
});

test('importData continues ID sequence', function () {
  var t = createContaminationTracker();
  t.importData({ events: [{ id: 'CONTAM-0005', type: 'bacterial', severity: 'low' }] });
  var evt = t.logEvent(mkEvent());
  expect(evt.id).toBe('CONTAM-0006');
});

// ── Constants exposed ───────────────────────────────────────────

test('exposes CONTAMINATION_TYPES', function () {
  var t = createContaminationTracker();
  expect(t.CONTAMINATION_TYPES.length).toBe(8);
  expect(t.CONTAMINATION_TYPES.indexOf('bacterial') !== -1).toBeTruthy();
});

test('exposes SEVERITY_LEVELS', function () {
  var t = createContaminationTracker();
  expect(t.SEVERITY_LEVELS).toEqual(['low', 'medium', 'high', 'critical']);
});

test('exposes SOURCE_CATEGORIES', function () {
  var t = createContaminationTracker();
  expect(t.SOURCE_CATEGORIES.equipment.length > 0).toBeTruthy();
  expect(t.SOURCE_CATEGORIES.material.length > 0).toBeTruthy();
  expect(t.SOURCE_CATEGORIES.environment.length > 0).toBeTruthy();
  expect(t.SOURCE_CATEGORIES.human.length > 0).toBeTruthy();
});

test('risk score increases with severity', function () {
  var t = createContaminationTracker();
  t.logEvent(mkEvent('bacterial', 'low'));
  var r1 = t.trendReport({ windowDays: 365 });
  t.logEvent(mkEvent('bacterial', 'critical'));
  var r2 = t.trendReport({ windowDays: 365 });
  expect(r2.riskScore > r1.riskScore).toBeTruthy();
});


