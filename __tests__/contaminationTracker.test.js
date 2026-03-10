'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
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
  assert.equal(evt.id, 'CONTAM-0001');
  assert.equal(evt.type, 'bacterial');
  assert.equal(evt.severity, 'high');
  assert.equal(evt.resolved, false);
});

test('logEvent assigns sequential IDs', function () {
  var t = createContaminationTracker();
  var e1 = t.logEvent(mkEvent());
  var e2 = t.logEvent(mkEvent());
  assert.equal(e1.id, 'CONTAM-0001');
  assert.equal(e2.id, 'CONTAM-0002');
});

test('logEvent rejects invalid type', function () {
  var t = createContaminationTracker();
  assert.throws(function () { t.logEvent({ type: 'magic', severity: 'low' }); }, /Invalid contamination type/);
});

test('logEvent rejects invalid severity', function () {
  var t = createContaminationTracker();
  assert.throws(function () { t.logEvent({ type: 'bacterial', severity: 'extreme' }); }, /Invalid severity/);
});

test('logEvent rejects invalid detection method', function () {
  var t = createContaminationTracker();
  assert.throws(function () {
    t.logEvent({ type: 'bacterial', severity: 'low', detectionMethod: 'magic_wand' });
  }, /Invalid detection method/);
});

test('logEvent rejects null data', function () {
  var t = createContaminationTracker();
  assert.throws(function () { t.logEvent(null); }, /non-null object/);
});

test('logEvent stores environment data', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent({
    type: 'fungal', severity: 'medium',
    environment: { tempC: 25, humidityPct: 70, airQualityIndex: 35 }
  });
  assert.equal(evt.environment.tempC, 25);
  assert.equal(evt.environment.humidityPct, 70);
});

test('logEvent clamps humidity to 0-100', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent({
    type: 'bacterial', severity: 'low',
    environment: { humidityPct: 150 }
  });
  assert.equal(evt.environment.humidityPct, 100);
});

test('logEvent stores affected batches', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent({
    type: 'bacterial', severity: 'high',
    affectedBatches: ['B-001', 'B-002']
  });
  assert.deepEqual(evt.affectedBatches, ['B-001', 'B-002']);
});

test('logEvent accepts all valid detection methods', function () {
  var t = createContaminationTracker();
  t.DETECTION_METHODS.forEach(function (m) {
    var evt = t.logEvent({ type: 'bacterial', severity: 'low', detectionMethod: m });
    assert.equal(evt.detectionMethod, m);
  });
});

test('logEvent accepts all contamination types', function () {
  var t = createContaminationTracker();
  t.CONTAMINATION_TYPES.forEach(function (ct) {
    var evt = t.logEvent({ type: ct, severity: 'low' });
    assert.equal(evt.type, ct);
  });
});

test('logEvent stores organism field', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent({
    type: 'bacterial', severity: 'high',
    organism: 'E. coli', detectionMethod: 'culture'
  });
  assert.equal(evt.organism, 'E. coli');
});

// ── resolveEvent ────────────────────────────────────────────────

test('resolveEvent marks event as resolved', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent());
  var resolved = t.resolveEvent(evt.id, 'Cleaned and retested');
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.resolutionNotes, 'Cleaned and retested');
  assert.ok(resolved.resolvedAt);
});

test('resolveEvent throws on unknown event', function () {
  var t = createContaminationTracker();
  assert.throws(function () { t.resolveEvent('CONTAM-9999'); }, /not found/);
});

test('resolveEvent throws on already resolved', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent());
  t.resolveEvent(evt.id);
  assert.throws(function () { t.resolveEvent(evt.id); }, /already resolved/);
});

// ── getEvent / listEvents ───────────────────────────────────────

test('getEvent returns event by ID', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent('fungal', 'high'));
  assert.equal(t.getEvent(evt.id).type, 'fungal');
});

test('getEvent returns null for missing', function () {
  var t = createContaminationTracker();
  assert.equal(t.getEvent('CONTAM-9999'), null);
});

test('listEvents returns all when no filters', function () {
  var t = seedTracker(5);
  assert.equal(t.listEvents().length, 5);
});

test('listEvents filters by type', function () {
  var t = seedTracker(10);
  var bacterial = t.listEvents({ type: 'bacterial' });
  bacterial.forEach(function (e) { assert.equal(e.type, 'bacterial'); });
});

test('listEvents filters by severity', function () {
  var t = seedTracker(10);
  var high = t.listEvents({ severity: 'high' });
  high.forEach(function (e) { assert.equal(e.severity, 'high'); });
});

test('listEvents filters by resolved', function () {
  var t = createContaminationTracker();
  var e1 = t.logEvent(mkEvent());
  t.logEvent(mkEvent());
  t.resolveEvent(e1.id);
  assert.equal(t.listEvents({ resolved: true }).length, 1);
  assert.equal(t.listEvents({ resolved: false }).length, 1);
});

test('listEvents filters by source', function () {
  var t = seedTracker(10);
  var nozzle = t.listEvents({ source: 'nozzle_assembly' });
  nozzle.forEach(function (e) { assert.equal(e.source, 'nozzle_assembly'); });
});

// ── analyseEvent ────────────────────────────────────────────────

test('analyseEvent returns probable causes', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent('bacterial', 'high', { source: 'nozzle_assembly' }));
  var analysis = t.analyseEvent(evt.id);
  assert.equal(analysis.eventId, evt.id);
  assert.ok(analysis.probableCauses.length > 0);
  assert.ok(analysis.topCause);
  assert.ok(analysis.recommendedActions.length > 0);
});

test('analyseEvent boosts reported source', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent('bacterial', 'high', { source: 'nozzle_assembly' }));
  var analysis = t.analyseEvent(evt.id);
  assert.equal(analysis.topCause.source, 'nozzle_assembly');
});

test('analyseEvent probabilities sum to ~1', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent(mkEvent('fungal', 'medium'));
  var analysis = t.analyseEvent(evt.id);
  var sum = analysis.probableCauses.reduce(function (s, c) { return s + c.probability; }, 0);
  assert.ok(Math.abs(sum - 1.0) < 0.05, 'Probabilities should sum to ~1, got ' + sum);
});

test('analyseEvent considers environmental factors', function () {
  var t = createContaminationTracker();
  var evt = t.logEvent({
    type: 'fungal', severity: 'high',
    environment: { humidityPct: 85 }
  });
  var analysis = t.analyseEvent(evt.id);
  assert.ok(analysis.probableCauses.length > 0);
});

test('analyseEvent throws on unknown event', function () {
  var t = createContaminationTracker();
  assert.throws(function () { t.analyseEvent('CONTAM-9999'); }, /not found/);
});

test('analyseEvent historical pattern boost', function () {
  var t = createContaminationTracker();
  t.logEvent(mkEvent('bacterial', 'low', { source: 'tubing' }));
  t.logEvent(mkEvent('bacterial', 'medium', { source: 'tubing' }));
  var evt = t.logEvent(mkEvent('bacterial', 'high', { source: 'nozzle_assembly' }));
  var analysis = t.analyseEvent(evt.id);
  var tubing = analysis.probableCauses.find(function (c) { return c.source === 'tubing'; });
  assert.ok(tubing, 'tubing should appear');
  assert.ok(tubing.historicalOccurrences >= 2);
});

// ── quarantine ──────────────────────────────────────────────────

test('quarantine creates record', function () {
  var t = createContaminationTracker();
  var q = t.quarantine({ itemId: 'BATCH-001', itemType: 'batch', reason: 'contaminated' });
  assert.equal(q.id, 'QUAR-0001');
  assert.equal(q.state, 'active');
});

test('quarantine rejects invalid itemType', function () {
  var t = createContaminationTracker();
  assert.throws(function () {
    t.quarantine({ itemId: 'X', itemType: 'other', reason: 'test' });
  }, /must be batch or equipment/);
});

test('quarantine rejects missing fields', function () {
  var t = createContaminationTracker();
  assert.throws(function () { t.quarantine({}); }, /required/);
});

test('updateQuarantine clears record', function () {
  var t = createContaminationTracker();
  var q = t.quarantine({ itemId: 'EQ-1', itemType: 'equipment', reason: 'suspect' });
  var updated = t.updateQuarantine(q.id, 'cleared', 'Tests negative');
  assert.equal(updated.state, 'cleared');
  assert.ok(updated.clearedAt);
});

test('updateQuarantine disposes record', function () {
  var t = createContaminationTracker();
  var q = t.quarantine({ itemId: 'B-1', itemType: 'batch', reason: 'positive culture' });
  var updated = t.updateQuarantine(q.id, 'disposed');
  assert.equal(updated.state, 'disposed');
  assert.ok(updated.disposedAt);
});

test('updateQuarantine rejects non-active', function () {
  var t = createContaminationTracker();
  var q = t.quarantine({ itemId: 'B-1', itemType: 'batch', reason: 'test' });
  t.updateQuarantine(q.id, 'cleared');
  assert.throws(function () { t.updateQuarantine(q.id, 'disposed'); }, /active/);
});

test('listQuarantines filters by state', function () {
  var t = createContaminationTracker();
  var q1 = t.quarantine({ itemId: 'A', itemType: 'batch', reason: 'r' });
  t.quarantine({ itemId: 'B', itemType: 'equipment', reason: 'r' });
  t.updateQuarantine(q1.id, 'cleared');
  assert.equal(t.listQuarantines({ state: 'active' }).length, 1);
  assert.equal(t.listQuarantines({ state: 'cleared' }).length, 1);
});

test('listQuarantines filters by itemType', function () {
  var t = createContaminationTracker();
  t.quarantine({ itemId: 'A', itemType: 'batch', reason: 'r' });
  t.quarantine({ itemId: 'B', itemType: 'equipment', reason: 'r' });
  assert.equal(t.listQuarantines({ itemType: 'batch' }).length, 1);
});

// ── preventionProtocols ─────────────────────────────────────────

test('preventionProtocols returns all sections', function () {
  var t = createContaminationTracker();
  var protocols = t.preventionProtocols('bacterial');
  assert.ok(protocols.immediate.length > 0);
  assert.ok(protocols.ongoing.length > 0);
  assert.ok(protocols.monitoring.length > 0);
});

test('preventionProtocols works for all types', function () {
  var t = createContaminationTracker();
  t.CONTAMINATION_TYPES.forEach(function (ct) {
    var p = t.preventionProtocols(ct);
    assert.ok(p.immediate.length > 0, ct + ' should have immediate actions');
  });
});

test('preventionProtocols rejects invalid type', function () {
  var t = createContaminationTracker();
  assert.throws(function () { t.preventionProtocols('invalid'); }, /Invalid contamination type/);
});

// ── trendReport ─────────────────────────────────────────────────

test('trendReport on empty tracker', function () {
  var t = createContaminationTracker();
  var report = t.trendReport();
  assert.equal(report.totalEvents, 0);
  assert.equal(report.riskScore, 0);
  assert.equal(report.riskLevel, 'low');
});

test('trendReport counts events in window', function () {
  var t = seedTracker(10);
  var report = t.trendReport({ windowDays: 365 });
  assert.equal(report.totalEvents, 10);
});

test('trendReport type breakdown', function () {
  var t = seedTracker(10);
  var report = t.trendReport({ windowDays: 365 });
  assert.ok(report.byType.bacterial >= 1);
});

test('trendReport severity breakdown', function () {
  var t = seedTracker(10);
  var report = t.trendReport({ windowDays: 365 });
  var total = Object.values(report.bySeverity).reduce(function (s, v) { return s + v; }, 0);
  assert.equal(total, 10);
});

test('trendReport identifies hotspots', function () {
  var t = seedTracker(10);
  var report = t.trendReport({ windowDays: 365 });
  assert.ok(report.hotspots.length > 0);
  assert.ok(report.hotspots[0].count >= 1);
});

test('trendReport detects recurring patterns', function () {
  var t = createContaminationTracker();
  t.logEvent(mkEvent('bacterial', 'high', { source: 'nozzle_assembly' }));
  t.logEvent(mkEvent('bacterial', 'high', { source: 'nozzle_assembly' }));
  t.logEvent(mkEvent('bacterial', 'high', { source: 'nozzle_assembly' }));
  var report = t.trendReport({ windowDays: 365 });
  assert.ok(report.recurringPatterns.length >= 1);
  assert.equal(report.recurringPatterns[0].type, 'bacterial');
  assert.equal(report.recurringPatterns[0].source, 'nozzle_assembly');
});

test('trendReport calculates risk level', function () {
  var t = createContaminationTracker();
  for (var i = 0; i < 5; i++) {
    t.logEvent(mkEvent('bacterial', 'critical'));
  }
  var report = t.trendReport({ windowDays: 365 });
  assert.equal(report.riskLevel, 'critical');
});

test('trendReport counts unresolved', function () {
  var t = createContaminationTracker();
  var e1 = t.logEvent(mkEvent());
  t.logEvent(mkEvent());
  t.resolveEvent(e1.id);
  var report = t.trendReport({ windowDays: 365 });
  assert.equal(report.unresolvedCount, 1);
});

test('trendReport includes environment correlation', function () {
  var t = seedTracker(10);
  var report = t.trendReport({ windowDays: 365 });
  assert.ok(report.environmentCorrelation);
  assert.ok(report.environmentCorrelation.temperature);
});

// ── sourceRiskScores ────────────────────────────────────────────

test('sourceRiskScores ranks by risk', function () {
  var t = seedTracker(10);
  var scores = t.sourceRiskScores();
  assert.ok(scores.length > 0);
  for (var i = 1; i < scores.length; i++) {
    assert.ok(scores[i - 1].riskScore >= scores[i].riskScore);
  }
});

test('sourceRiskScores includes category', function () {
  var t = seedTracker(5);
  var scores = t.sourceRiskScores();
  scores.forEach(function (s) {
    assert.ok(['equipment', 'material', 'environment', 'human', 'unknown'].indexOf(s.category) !== -1);
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
  assert.equal(s.totalEvents, 3);
  assert.equal(s.resolvedEvents, 1);
  assert.equal(s.unresolvedEvents, 2);
  assert.equal(s.mostCommonType, 'bacterial');
});

test('summary on empty tracker', function () {
  var t = createContaminationTracker();
  var s = t.summary();
  assert.equal(s.totalEvents, 0);
  assert.equal(s.meanTimeToResolutionHours, null);
});

test('summary counts active quarantines', function () {
  var t = createContaminationTracker();
  t.quarantine({ itemId: 'A', itemType: 'batch', reason: 'r' });
  t.quarantine({ itemId: 'B', itemType: 'batch', reason: 'r' });
  assert.equal(t.summary().activeQuarantines, 2);
});

// ── export / import ─────────────────────────────────────────────

test('exportData returns events and quarantines', function () {
  var t = createContaminationTracker();
  t.logEvent(mkEvent());
  t.quarantine({ itemId: 'A', itemType: 'batch', reason: 'r' });
  var data = t.exportData();
  assert.equal(data.events.length, 1);
  assert.equal(data.quarantines.length, 1);
  assert.ok(data.exportedAt);
});

test('importData restores events', function () {
  var t1 = createContaminationTracker();
  t1.logEvent(mkEvent('bacterial', 'high'));
  t1.quarantine({ itemId: 'A', itemType: 'batch', reason: 'r' });
  var data = t1.exportData();

  var t2 = createContaminationTracker();
  t2.importData(data);
  assert.equal(t2.listEvents().length, 1);
  assert.equal(t2.listQuarantines().length, 1);
});

test('importData rejects invalid data', function () {
  var t = createContaminationTracker();
  assert.throws(function () { t.importData({}); }, /events array required/);
});

test('importData continues ID sequence', function () {
  var t = createContaminationTracker();
  t.importData({ events: [{ id: 'CONTAM-0005', type: 'bacterial', severity: 'low' }] });
  var evt = t.logEvent(mkEvent());
  assert.equal(evt.id, 'CONTAM-0006');
});

// ── Constants exposed ───────────────────────────────────────────

test('exposes CONTAMINATION_TYPES', function () {
  var t = createContaminationTracker();
  assert.equal(t.CONTAMINATION_TYPES.length, 8);
  assert.ok(t.CONTAMINATION_TYPES.indexOf('bacterial') !== -1);
});

test('exposes SEVERITY_LEVELS', function () {
  var t = createContaminationTracker();
  assert.deepEqual(t.SEVERITY_LEVELS, ['low', 'medium', 'high', 'critical']);
});

test('exposes SOURCE_CATEGORIES', function () {
  var t = createContaminationTracker();
  assert.ok(t.SOURCE_CATEGORIES.equipment.length > 0);
  assert.ok(t.SOURCE_CATEGORIES.material.length > 0);
  assert.ok(t.SOURCE_CATEGORIES.environment.length > 0);
  assert.ok(t.SOURCE_CATEGORIES.human.length > 0);
});

test('risk score increases with severity', function () {
  var t = createContaminationTracker();
  t.logEvent(mkEvent('bacterial', 'low'));
  var r1 = t.trendReport({ windowDays: 365 });
  t.logEvent(mkEvent('bacterial', 'critical'));
  var r2 = t.trendReport({ windowDays: 365 });
  assert.ok(r2.riskScore > r1.riskScore);
});
