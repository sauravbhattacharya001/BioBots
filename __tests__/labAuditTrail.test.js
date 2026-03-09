'use strict';

var _mod = require('../Try/scripts/labAuditTrail');
var createLabAuditTrail = _mod.createLabAuditTrail;

function mkEvent(type, operator, data) {
  return { type: type, operator: operator || 'Dr. Chen', data: data || {} };
}

function seedTrail(n) {
  var trail = createLabAuditTrail();
  var types = ['print_start', 'calibration', 'material_loaded', 'env_reading', 'quality_check'];
  var ops = ['Dr. Chen', 'Lab Tech 1', 'Dr. Smith'];
  var now = Date.now();
  for (var i = 0; i < n; i++) {
    trail.recordEvent({
      type: types[i % types.length],
      operator: ops[i % ops.length],
      data: { index: i },
      timestamp: new Date(now - (n - i) * 3600 * 1000).toISOString()
    });
  }
  return trail;
}

describe('createLabAuditTrail', () => {
  test('creates a trail with zero entries', () => {
    var trail = createLabAuditTrail();
    expect(trail.getCount()).toBe(0);
    expect(trail.getEntries()).toEqual([]);
  });

  test('exposes EVENT_TYPES and CATEGORIES', () => {
    var trail = createLabAuditTrail();
    expect(Object.keys(trail.EVENT_TYPES).length).toBeGreaterThan(20);
    expect(trail.CATEGORIES).toContain('print');
    expect(trail.CATEGORIES).toContain('quality');
  });
});

describe('recordEvent', () => {
  test('records a valid event and returns id + hash', () => {
    var trail = createLabAuditTrail();
    var result = trail.recordEvent(mkEvent('print_start', 'Dr. Chen', { protocol: 'skin' }));
    expect(result.id).toBe(1);
    expect(typeof result.hash).toBe('string');
    expect(result.hash.length).toBe(8);
    expect(trail.getCount()).toBe(1);
  });

  test('assigns incremental IDs', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent(mkEvent('print_start', 'A'));
    trail.recordEvent(mkEvent('print_complete', 'A'));
    var r3 = trail.recordEvent(mkEvent('calibration', 'A'));
    expect(r3.id).toBe(3);
  });

  test('throws on missing type', () => {
    var trail = createLabAuditTrail();
    expect(() => trail.recordEvent({ operator: 'A' })).toThrow('type');
  });

  test('throws on unknown type', () => {
    var trail = createLabAuditTrail();
    expect(() => trail.recordEvent({ type: 'bogus', operator: 'A' })).toThrow('Unknown event type');
  });

  test('throws on missing operator', () => {
    var trail = createLabAuditTrail();
    expect(() => trail.recordEvent({ type: 'print_start' })).toThrow('operator');
  });

  test('throws on empty operator', () => {
    var trail = createLabAuditTrail();
    expect(() => trail.recordEvent({ type: 'print_start', operator: '  ' })).toThrow('operator');
  });

  test('trims operator whitespace', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent(mkEvent('print_start', '  Bob  '));
    expect(trail.getEntries()[0].operator).toBe('Bob');
  });

  test('auto-populates category, severity, label from EVENT_TYPES', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent(mkEvent('print_error', 'A'));
    var entry = trail.getEntries()[0];
    expect(entry.category).toBe('print');
    expect(entry.severity).toBe('critical');
    expect(entry.label).toBe('Print Error');
  });

  test('stores data and notes', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent({ type: 'operator_note', operator: 'A', data: { foo: 1 }, notes: 'checked pressure' });
    var e = trail.getEntries()[0];
    expect(e.data.foo).toBe(1);
    expect(e.notes).toBe('checked pressure');
  });

  test('uses provided timestamp if given', () => {
    var trail = createLabAuditTrail();
    var ts = '2025-06-15T10:00:00.000Z';
    trail.recordEvent({ type: 'calibration', operator: 'A', timestamp: ts });
    expect(trail.getEntries()[0].timestamp).toBe(ts);
  });

  test('throws when trail is locked', () => {
    var trail = createLabAuditTrail();
    trail.lock();
    expect(() => trail.recordEvent(mkEvent('print_start', 'A'))).toThrow('locked');
  });
});

describe('hash chaining', () => {
  test('each entry has prevHash linking to prior entry hash', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent(mkEvent('print_start', 'A'));
    trail.recordEvent(mkEvent('print_complete', 'A'));
    var entries = trail.getEntries();
    expect(entries[1].prevHash).toBe(entries[0].hash);
  });

  test('first entry prevHash is genesis hash', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent(mkEvent('print_start', 'A'));
    expect(trail.getEntries()[0].prevHash).toBe('00000000');
  });

  test('custom genesis hash is used', () => {
    var trail = createLabAuditTrail({ genesisHash: 'deadbeef' });
    trail.recordEvent(mkEvent('print_start', 'A'));
    expect(trail.getEntries()[0].prevHash).toBe('deadbeef');
  });

  test('hashes are deterministic', () => {
    var t1 = createLabAuditTrail();
    var t2 = createLabAuditTrail();
    var ts = '2025-01-01T00:00:00Z';
    t1.recordEvent({ type: 'print_start', operator: 'A', timestamp: ts, data: {} });
    t2.recordEvent({ type: 'print_start', operator: 'A', timestamp: ts, data: {} });
    expect(t1.getEntries()[0].hash).toBe(t2.getEntries()[0].hash);
  });
});

describe('verifyIntegrity', () => {
  test('returns intact for empty trail', () => {
    var trail = createLabAuditTrail();
    var result = trail.verifyIntegrity();
    expect(result.intact).toBe(true);
    expect(result.entries).toBe(0);
  });

  test('returns intact for valid chain', () => {
    var trail = seedTrail(10);
    var result = trail.verifyIntegrity();
    expect(result.intact).toBe(true);
    expect(result.entries).toBe(10);
    expect(result.errors).toEqual([]);
  });

  test('detects hash tampering', () => {
    var trail = seedTrail(5);
    trail.getEntries()[2].hash = 'ffffffff';
    var result = trail.verifyIntegrity();
    expect(result.intact).toBe(false);
    expect(result.errors.some(function(e) { return e.issue === 'hash_mismatch'; })).toBe(true);
  });

  test('detects chain break', () => {
    var trail = seedTrail(5);
    trail.getEntries()[3].prevHash = 'aaaaaaaa';
    var result = trail.verifyIntegrity();
    expect(result.intact).toBe(false);
    expect(result.errors.some(function(e) { return e.issue === 'broken_chain'; })).toBe(true);
  });
});

describe('getEntries (filtering)', () => {
  test('filter by type', () => {
    var trail = seedTrail(10);
    var results = trail.getEntries({ type: 'calibration' });
    results.forEach(function(e) { expect(e.type).toBe('calibration'); });
    expect(results.length).toBeGreaterThan(0);
  });

  test('filter by category', () => {
    var trail = seedTrail(10);
    var results = trail.getEntries({ category: 'print' });
    results.forEach(function(e) { expect(e.category).toBe('print'); });
  });

  test('filter by severity', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent(mkEvent('print_error', 'A'));
    trail.recordEvent(mkEvent('print_start', 'A'));
    var critical = trail.getEntries({ severity: 'critical' });
    expect(critical.length).toBe(1);
    expect(critical[0].type).toBe('print_error');
  });

  test('filter by operator (case-insensitive)', () => {
    var trail = seedTrail(10);
    var results = trail.getEntries({ operator: 'dr. chen' });
    results.forEach(function(e) { expect(e.operator).toBe('Dr. Chen'); });
  });

  test('filter by date range', () => {
    var trail = createLabAuditTrail();
    var now = Date.now();
    trail.recordEvent({ type: 'print_start', operator: 'A', timestamp: new Date(now - 5 * 3600000).toISOString() });
    trail.recordEvent({ type: 'calibration', operator: 'A', timestamp: new Date(now - 2 * 3600000).toISOString() });
    trail.recordEvent({ type: 'env_reading', operator: 'A', timestamp: new Date(now).toISOString() });
    var results = trail.getEntries({ from: new Date(now - 3 * 3600000).toISOString(), to: new Date(now + 1000).toISOString() });
    expect(results.length).toBe(2);
  });

  test('filter by search term', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent({ type: 'operator_note', operator: 'A', notes: 'checked nozzle pressure' });
    trail.recordEvent(mkEvent('print_start', 'A'));
    var results = trail.getEntries({ search: 'nozzle' });
    expect(results.length).toBe(1);
  });

  test('limit returns last N entries', () => {
    var trail = seedTrail(20);
    var results = trail.getEntries({ limit: 5 });
    expect(results.length).toBe(5);
    expect(results[results.length - 1].id).toBe(20);
  });
});

describe('getEntry', () => {
  test('returns entry by ID', () => {
    var trail = seedTrail(5);
    var entry = trail.getEntry(3);
    expect(entry).not.toBeNull();
    expect(entry.id).toBe(3);
  });

  test('returns null for unknown ID', () => {
    var trail = seedTrail(5);
    expect(trail.getEntry(99)).toBeNull();
  });
});

describe('getStatistics', () => {
  test('returns category and severity counts', () => {
    var trail = seedTrail(10);
    var stats = trail.getStatistics();
    expect(stats.totalEvents).toBe(10);
    expect(stats.bySeverity.info).toBeGreaterThan(0);
  });

  test('identifies top operator', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent(mkEvent('print_start', 'Alice'));
    trail.recordEvent(mkEvent('print_start', 'Bob'));
    trail.recordEvent(mkEvent('print_start', 'Bob'));
    var stats = trail.getStatistics();
    expect(stats.topOperator).toBe('Bob');
    expect(stats.uniqueOperators).toBe(2);
  });

  test('tracks peak hour', () => {
    var trail = createLabAuditTrail();
    var peakDate = new Date(2026, 2, 9, 14, 0, 0);
    for (var i = 0; i < 5; i++) {
      trail.recordEvent({ type: 'print_start', operator: 'A', timestamp: new Date(peakDate.getTime() + i * 60000).toISOString() });
    }
    trail.recordEvent({ type: 'print_start', operator: 'A', timestamp: new Date(2026, 2, 9, 9, 0, 0).toISOString() });
    expect(trail.getStatistics().peakHour).toBe(14);
  });
});

describe('getOperatorActivity', () => {
  test('returns null for unknown operator', () => {
    var trail = seedTrail(5);
    expect(trail.getOperatorActivity('nobody')).toBeNull();
  });

  test('returns activity summary', () => {
    var trail = seedTrail(10);
    var activity = trail.getOperatorActivity('Dr. Chen');
    expect(activity).not.toBeNull();
    expect(activity.totalEvents).toBeGreaterThan(0);
  });

  test('counts critical and warning events', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent(mkEvent('print_start', 'Alice'));
    trail.recordEvent(mkEvent('print_error', 'Alice'));
    trail.recordEvent(mkEvent('env_alert', 'Alice'));
    var activity = trail.getOperatorActivity('Alice');
    expect(activity.criticalEvents).toBe(1);
    expect(activity.warningEvents).toBe(1);
  });
});

describe('getComplianceReport', () => {
  test('returns report structure', () => {
    var trail = seedTrail(10);
    var report = trail.getComplianceReport();
    expect(report.chainIntegrity).toBe('intact');
    expect(typeof report.complianceScore).toBe('number');
    expect(typeof report.complianceGrade).toBe('string');
  });

  test('grades A for well-maintained trail', () => {
    var trail = createLabAuditTrail();
    var now = new Date();
    var recent = new Date(now.getTime() - 2 * 3600000).toISOString();
    ['calibration', 'env_reading', 'quality_check', 'maintenance_done'].forEach(function(t) {
      trail.recordEvent({ type: t, operator: 'A', timestamp: recent });
    });
    for (var d = 0; d < 30; d++) {
      trail.recordEvent({ type: 'env_reading', operator: 'A', timestamp: new Date(now.getTime() - d * 86400000).toISOString() });
    }
    var report = trail.getComplianceReport();
    expect(report.complianceGrade).toBe('A');
    expect(report.complianceScore).toBeGreaterThanOrEqual(90);
  });

  test('detects missing weekly checks', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent({ type: 'print_start', operator: 'A', timestamp: new Date(Date.now() - 10 * 86400000).toISOString() });
    var report = trail.getComplianceReport();
    expect(report.missingWeeklyChecks).toContain('calibration');
    expect(report.missingWeeklyChecks).toContain('environmental_reading');
  });

  test('reports compromised integrity', () => {
    var trail = seedTrail(5);
    trail.getEntries()[2].hash = 'deadbeef';
    var report = trail.getComplianceReport();
    expect(report.chainIntegrity).toBe('compromised');
  });
});

describe('getTimeline', () => {
  test('groups events by day', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent({ type: 'print_start', operator: 'A', timestamp: '2026-01-10T09:00:00Z' });
    trail.recordEvent({ type: 'print_complete', operator: 'A', timestamp: '2026-01-10T11:00:00Z' });
    trail.recordEvent({ type: 'calibration', operator: 'A', timestamp: '2026-01-11T08:00:00Z' });
    var tl = trail.getTimeline();
    expect(tl.days).toEqual(['2026-01-10', '2026-01-11']);
    expect(tl.timeline['2026-01-10'].length).toBe(2);
    expect(tl.totalEvents).toBe(3);
  });

  test('respects filters', () => {
    var trail = seedTrail(20);
    var tl = trail.getTimeline({ category: 'print' });
    tl.days.forEach(function(d) {
      tl.timeline[d].forEach(function(e) { expect(e.type).toMatch(/^print_/); });
    });
  });
});

describe('export / import', () => {
  test('exportJSON includes all fields', () => {
    var trail = seedTrail(5);
    var json = trail.exportJSON();
    expect(json.entries.length).toBe(5);
    expect(json.integrity.intact).toBe(true);
    expect(json.genesisHash).toBe('00000000');
  });

  test('exportCSV has header and correct row count', () => {
    var trail = seedTrail(5);
    var lines = trail.exportCSV().trim().split('\n');
    expect(lines[0]).toContain('ID,Timestamp');
    expect(lines.length).toBe(6);
  });

  test('importJSON restores and verifies', () => {
    var trail = seedTrail(5);
    var exported = trail.exportJSON();
    var trail2 = createLabAuditTrail();
    expect(trail2.importJSON(exported).intact).toBe(true);
    expect(trail2.getCount()).toBe(5);
  });

  test('importJSON detects tampered data', () => {
    var trail = seedTrail(5);
    var exported = trail.exportJSON();
    exported.entries[2].hash = 'deadbeef';
    var trail2 = createLabAuditTrail();
    expect(trail2.importJSON(exported).intact).toBe(false);
  });

  test('importJSON rejects non-empty trail', () => {
    var trail = seedTrail(3);
    expect(() => trail.importJSON(trail.exportJSON())).toThrow('non-empty');
  });

  test('importJSON rejects invalid data', () => {
    var trail = createLabAuditTrail();
    expect(() => trail.importJSON({})).toThrow('Invalid');
  });
});

describe('lock', () => {
  test('prevents new events', () => {
    var trail = createLabAuditTrail();
    trail.recordEvent(mkEvent('print_start', 'A'));
    trail.lock();
    expect(trail.isLocked()).toBe(true);
    expect(() => trail.recordEvent(mkEvent('print_start', 'A'))).toThrow('locked');
  });

  test('allows reads', () => {
    var trail = seedTrail(5);
    trail.lock();
    expect(trail.getCount()).toBe(5);
    expect(trail.verifyIntegrity().intact).toBe(true);
  });
});

describe('purgeExpired', () => {
  test('purges old entries', () => {
    var trail = createLabAuditTrail({ retentionDays: 7 });
    trail.recordEvent({ type: 'print_start', operator: 'A', timestamp: new Date(Date.now() - 10 * 86400000).toISOString() });
    trail.recordEvent({ type: 'print_start', operator: 'A', timestamp: new Date().toISOString() });
    var result = trail.purgeExpired();
    expect(result.purged).toBe(1);
    expect(result.remaining).toBe(1);
  });

  test('keeps recent entries', () => {
    var trail = createLabAuditTrail({ retentionDays: 365 });
    var now = Date.now();
    for (var i = 0; i < 5; i++) trail.recordEvent({ type: 'print_start', operator: 'A', timestamp: new Date(now - i * 86400000).toISOString() });
    expect(trail.purgeExpired().remaining).toBe(5);
  });
});

describe('maxEntries', () => {
  test('enforces limit', () => {
    var trail = createLabAuditTrail({ maxEntries: 5 });
    for (var i = 0; i < 8; i++) trail.recordEvent(mkEvent('print_start', 'A'));
    expect(trail.getCount()).toBe(5);
  });
});

describe('all event types', () => {
  test('every EVENT_TYPE can be recorded', () => {
    var trail = createLabAuditTrail();
    Object.keys(trail.EVENT_TYPES).forEach(function(type) {
      expect(function() { trail.recordEvent({ type: type, operator: 'Tester' }); }).not.toThrow();
    });
    expect(trail.getCount()).toBe(Object.keys(trail.EVENT_TYPES).length);
  });
});
