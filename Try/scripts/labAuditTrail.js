'use strict';

/**
 * Lab Audit Trail — Immutable, hash-chained event log for bioprinting operations.
 *
 * Records all significant lab events (prints, calibrations, material changes,
 * environmental readings, protocol modifications) in a tamper-evident chain.
 * Each entry is linked to the previous via FNV-1a hashing, enabling integrity
 * verification for GLP/GMP compliance.
 *
 * @example
 *   var trail = createLabAuditTrail();
 *   trail.recordEvent({ type: 'print_start', operator: 'Dr. Chen',
 *     data: { protocol: 'skin-scaffold', material: 'collagen-type-i' }});
 *   trail.recordEvent({ type: 'calibration', operator: 'Lab Tech 1',
 *     data: { module: 'extruder-A', result: 'pass' }});
 *   var report = trail.getComplianceReport();
 *   console.log(report.chainIntegrity); // 'intact'
 */

var EVENT_TYPES = {
  print_start:      { category: 'print',       severity: 'info',     label: 'Print Started' },
  print_complete:   { category: 'print',       severity: 'info',     label: 'Print Completed' },
  print_abort:      { category: 'print',       severity: 'warning',  label: 'Print Aborted' },
  print_pause:      { category: 'print',       severity: 'info',     label: 'Print Paused' },
  print_resume:     { category: 'print',       severity: 'info',     label: 'Print Resumed' },
  print_error:      { category: 'print',       severity: 'critical', label: 'Print Error' },
  calibration:      { category: 'calibration',  severity: 'info',     label: 'Calibration Performed' },
  calibration_fail: { category: 'calibration',  severity: 'warning',  label: 'Calibration Failed' },
  material_loaded:  { category: 'material',     severity: 'info',     label: 'Material Loaded' },
  material_changed: { category: 'material',     severity: 'info',     label: 'Material Changed' },
  material_expired: { category: 'material',     severity: 'warning',  label: 'Material Expired' },
  material_lot:     { category: 'material',     severity: 'info',     label: 'New Lot Received' },
  env_reading:      { category: 'environment',  severity: 'info',     label: 'Environmental Reading' },
  env_alert:        { category: 'environment',  severity: 'warning',  label: 'Environmental Alert' },
  env_violation:    { category: 'environment',  severity: 'critical', label: 'Environmental Violation' },
  protocol_loaded:  { category: 'protocol',     severity: 'info',     label: 'Protocol Loaded' },
  protocol_modified:{ category: 'protocol',     severity: 'warning',  label: 'Protocol Modified' },
  protocol_approved:{ category: 'protocol',     severity: 'info',     label: 'Protocol Approved' },
  maintenance_done: { category: 'maintenance',  severity: 'info',     label: 'Maintenance Completed' },
  maintenance_due:  { category: 'maintenance',  severity: 'warning',  label: 'Maintenance Due' },
  operator_login:   { category: 'operator',     severity: 'info',     label: 'Operator Login' },
  operator_logout:  { category: 'operator',     severity: 'info',     label: 'Operator Logout' },
  operator_note:    { category: 'operator',     severity: 'info',     label: 'Operator Note' },
  quality_check:    { category: 'quality',      severity: 'info',     label: 'Quality Check' },
  quality_fail:     { category: 'quality',      severity: 'critical', label: 'Quality Check Failed' },
  sample_collected: { category: 'quality',      severity: 'info',     label: 'Sample Collected' },
  system_start:     { category: 'system',       severity: 'info',     label: 'System Started' },
  system_shutdown:  { category: 'system',       severity: 'info',     label: 'System Shutdown' },
  system_error:     { category: 'system',       severity: 'critical', label: 'System Error' },
};

var CATEGORIES = ['print', 'calibration', 'material', 'environment',
                  'protocol', 'maintenance', 'operator', 'quality', 'system'];

function fnv1aHash(str) {
  var hash = 0x811c9dc5;
  for (var i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  var hex = hash.toString(16);
  while (hex.length < 8) hex = '0' + hex;
  return hex;
}

function computeEntryHash(entry, prevHash) {
  var payload = prevHash + '|' + entry.timestamp + '|' + entry.type + '|' +
    entry.operator + '|' + JSON.stringify(entry.data || {});
  return fnv1aHash(payload);
}

function createLabAuditTrail(options) {
  options = options || {};
  var _entries = [];
  var _lastHash = options.genesisHash || '00000000';
  var _locked = false;
  var _retentionDays = options.retentionDays || 365;
  var _maxEntries = options.maxEntries || 100000;

  function recordEvent(evt) {
    if (_locked) throw new Error('Audit trail is locked (archived). No new entries allowed.');
    if (!evt || !evt.type) throw new Error('Event must have a type.');
    if (!EVENT_TYPES[evt.type]) throw new Error('Unknown event type: ' + evt.type +
      '. Valid types: ' + Object.keys(EVENT_TYPES).join(', '));
    if (!evt.operator || typeof evt.operator !== 'string' || !evt.operator.trim())
      throw new Error('Event must have a non-empty operator string.');

    var meta = EVENT_TYPES[evt.type];
    var entry = {
      id: _entries.length + 1,
      timestamp: evt.timestamp || new Date().toISOString(),
      type: evt.type, category: meta.category,
      severity: meta.severity, label: meta.label,
      operator: evt.operator.trim(),
      data: evt.data || {}, notes: evt.notes || '',
      prevHash: _lastHash, hash: ''
    };
    entry.hash = computeEntryHash(entry, _lastHash);
    _lastHash = entry.hash;
    _entries.push(entry);
    if (_entries.length > _maxEntries) _entries = _entries.slice(_entries.length - _maxEntries);
    return { id: entry.id, hash: entry.hash };
  }

  function getEntries(filter) {
    filter = filter || {};
    var result = _entries.slice();
    if (filter.type) result = result.filter(function(e) { return e.type === filter.type; });
    if (filter.category) result = result.filter(function(e) { return e.category === filter.category; });
    if (filter.severity) result = result.filter(function(e) { return e.severity === filter.severity; });
    if (filter.operator) {
      var op = filter.operator.toLowerCase();
      result = result.filter(function(e) { return e.operator.toLowerCase() === op; });
    }
    if (filter.from) {
      var from = new Date(filter.from).getTime();
      result = result.filter(function(e) { return new Date(e.timestamp).getTime() >= from; });
    }
    if (filter.to) {
      var to = new Date(filter.to).getTime();
      result = result.filter(function(e) { return new Date(e.timestamp).getTime() <= to; });
    }
    if (filter.search) {
      var term = filter.search.toLowerCase();
      result = result.filter(function(e) {
        return e.notes.toLowerCase().indexOf(term) !== -1 ||
               e.label.toLowerCase().indexOf(term) !== -1 ||
               JSON.stringify(e.data).toLowerCase().indexOf(term) !== -1;
      });
    }
    if (typeof filter.limit === 'number' && filter.limit > 0) result = result.slice(-filter.limit);
    return result;
  }

  function getEntry(id) { return _entries.find(function(e) { return e.id === id; }) || null; }
  function getCount() { return _entries.length; }

  function verifyIntegrity() {
    if (_entries.length === 0) return { intact: true, entries: 0, errors: [] };
    var errors = [], prevHash = _entries[0].prevHash;
    for (var i = 0; i < _entries.length; i++) {
      var entry = _entries[i];
      if (entry.prevHash !== prevHash)
        errors.push({ id: entry.id, issue: 'broken_chain', expected: prevHash, found: entry.prevHash });
      var recomputed = computeEntryHash(entry, entry.prevHash);
      if (entry.hash !== recomputed)
        errors.push({ id: entry.id, issue: 'hash_mismatch', expected: recomputed, found: entry.hash });
      prevHash = entry.hash;
    }
    return { intact: errors.length === 0, entries: _entries.length,
      firstEntry: _entries[0].timestamp, lastEntry: _entries[_entries.length - 1].timestamp, errors: errors };
  }

  function getStatistics() {
    var byCat = {}, bySev = { info: 0, warning: 0, critical: 0 };
    var byOp = {}, byType = {}, hourly = {};
    CATEGORIES.forEach(function(c) { byCat[c] = 0; });
    _entries.forEach(function(e) {
      byCat[e.category] = (byCat[e.category] || 0) + 1;
      bySev[e.severity] = (bySev[e.severity] || 0) + 1;
      byOp[e.operator] = (byOp[e.operator] || 0) + 1;
      byType[e.type] = (byType[e.type] || 0) + 1;
      var h = new Date(e.timestamp).getHours();
      hourly[h] = (hourly[h] || 0) + 1;
    });
    var peakHour = null, peakCount = 0, topOp = null, topOpCount = 0;
    Object.keys(hourly).forEach(function(h) { if (hourly[h] > peakCount) { peakCount = hourly[h]; peakHour = parseInt(h, 10); } });
    Object.keys(byOp).forEach(function(op) { if (byOp[op] > topOpCount) { topOpCount = byOp[op]; topOp = op; } });
    return { totalEvents: _entries.length, byCategory: byCat, bySeverity: bySev,
      byOperator: byOp, byType: byType, peakHour: peakHour,
      topOperator: topOp, uniqueOperators: Object.keys(byOp).length };
  }

  function getOperatorActivity(operator) {
    var ops = _entries.filter(function(e) { return e.operator.toLowerCase() === operator.toLowerCase(); });
    if (ops.length === 0) return null;
    var types = {};
    ops.forEach(function(e) { types[e.type] = (types[e.type] || 0) + 1; });
    return { operator: operator, totalEvents: ops.length, eventTypes: types,
      firstEvent: ops[0].timestamp, lastEvent: ops[ops.length - 1].timestamp,
      criticalEvents: ops.filter(function(e) { return e.severity === 'critical'; }).length,
      warningEvents: ops.filter(function(e) { return e.severity === 'warning'; }).length };
  }

  function getComplianceReport() {
    var integrity = verifyIntegrity(), stats = getStatistics();
    var now = Date.now(), thirtyDaysAgo = now - 30 * 86400000, daysWithEvents = {};
    _entries.forEach(function(e) {
      var ts = new Date(e.timestamp).getTime();
      if (ts >= thirtyDaysAgo) daysWithEvents[new Date(e.timestamp).toISOString().slice(0, 10)] = true;
    });
    var gapDays = [];
    for (var d = thirtyDaysAgo; d < now; d += 86400000) {
      var dayStr = new Date(d).toISOString().slice(0, 10);
      if (!daysWithEvents[dayStr]) gapDays.push(dayStr);
    }
    var sevenDaysAgo = now - 7 * 86400000, recentTypes = {};
    _entries.forEach(function(e) { if (new Date(e.timestamp).getTime() >= sevenDaysAgo) recentTypes[e.type] = true; });
    var missingChecks = [];
    if (!recentTypes['calibration']) missingChecks.push('calibration');
    if (!recentTypes['env_reading']) missingChecks.push('environmental_reading');
    if (!recentTypes['quality_check']) missingChecks.push('quality_check');
    if (!recentTypes['maintenance_done']) missingChecks.push('maintenance');
    var unresolvedCritical = _entries.filter(function(e) { return e.severity === 'critical'; });
    var score = 100;
    if (!integrity.intact) score -= 30;
    score -= Math.min(20, gapDays.length * 2);
    score -= missingChecks.length * 5;
    score -= Math.min(15, unresolvedCritical.length * 3);
    score = Math.max(0, score);
    var grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
    return { chainIntegrity: integrity.intact ? 'intact' : 'compromised',
      integrityErrors: integrity.errors, totalEvents: stats.totalEvents,
      bySeverity: stats.bySeverity, coverageGapDays: gapDays.length, coverageGaps: gapDays,
      missingWeeklyChecks: missingChecks, unresolvedCriticalCount: unresolvedCritical.length,
      complianceScore: score, complianceGrade: grade,
      uniqueOperators: stats.uniqueOperators, peakHour: stats.peakHour };
  }

  function getTimeline(opts) {
    opts = opts || {};
    var entries = getEntries(opts), grouped = {};
    entries.forEach(function(e) {
      var day = e.timestamp.slice(0, 10);
      if (!grouped[day]) grouped[day] = [];
      grouped[day].push({ time: e.timestamp.slice(11, 19), type: e.type, label: e.label,
        severity: e.severity, operator: e.operator, notes: e.notes });
    });
    return { days: Object.keys(grouped).sort(), timeline: grouped, totalEvents: entries.length };
  }

  function exportJSON() {
    return { exportedAt: new Date().toISOString(),
      genesisHash: _entries.length > 0 ? _entries[0].prevHash : _lastHash,
      entries: _entries.map(function(e) {
        return { id: e.id, timestamp: e.timestamp, type: e.type, category: e.category,
          severity: e.severity, operator: e.operator, data: e.data, notes: e.notes,
          prevHash: e.prevHash, hash: e.hash };
      }), integrity: verifyIntegrity() };
  }

  function exportCSV() {
    var header = 'ID,Timestamp,Type,Category,Severity,Operator,Notes,Hash\n';
    var rows = _entries.map(function(e) {
      return [e.id, e.timestamp, e.type, e.category, e.severity,
        '"' + e.operator.replace(/"/g, '""') + '"',
        '"' + (e.notes || '').replace(/"/g, '""') + '"', e.hash].join(',');
    });
    return header + rows.join('\n');
  }

  function importJSON(data) {
    if (!data || !Array.isArray(data.entries)) throw new Error('Invalid import data: must have entries array.');
    if (_entries.length > 0) throw new Error('Cannot import into non-empty trail. Create a new instance.');
    _entries = []; _lastHash = data.genesisHash || '00000000';
    data.entries.forEach(function(e) {
      _entries.push({ id: e.id, timestamp: e.timestamp, type: e.type,
        category: e.category || (EVENT_TYPES[e.type] || {}).category || 'system',
        severity: e.severity || (EVENT_TYPES[e.type] || {}).severity || 'info',
        label: (EVENT_TYPES[e.type] || {}).label || e.type,
        operator: e.operator, data: e.data || {}, notes: e.notes || '',
        prevHash: e.prevHash, hash: e.hash });
      _lastHash = e.hash;
    });
    return verifyIntegrity();
  }

  function lock() { _locked = true; }
  function isLocked() { return _locked; }

  function purgeExpired() {
    var cutoff = Date.now() - _retentionDays * 86400000, before = _entries.length;
    _entries = _entries.filter(function(e) { return new Date(e.timestamp).getTime() >= cutoff; });
    return { purged: before - _entries.length, remaining: _entries.length };
  }

  return { recordEvent: recordEvent, getEntries: getEntries, getEntry: getEntry,
    getCount: getCount, verifyIntegrity: verifyIntegrity, getStatistics: getStatistics,
    getOperatorActivity: getOperatorActivity, getComplianceReport: getComplianceReport,
    getTimeline: getTimeline, exportJSON: exportJSON, exportCSV: exportCSV,
    importJSON: importJSON, lock: lock, isLocked: isLocked, purgeExpired: purgeExpired,
    EVENT_TYPES: EVENT_TYPES, CATEGORIES: CATEGORIES };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createLabAuditTrail: createLabAuditTrail };
}
