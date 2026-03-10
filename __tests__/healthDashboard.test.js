'use strict';

var assert = require('assert');
var createHealthDashboard = require('../Try/scripts/healthDashboard').createHealthDashboard;

// Fixed clock for deterministic tests
var NOW = new Date('2026-03-10T12:00:00Z');
function fixedNow() { return new Date(NOW.getTime()); }
function opts(extra) {
  return Object.assign({ now: fixedNow }, extra || {});
}

// ── Factory Tests ────────────────────────────────────────────────

describe('createHealthDashboard', function() {
  it('should create a dashboard with default config', function() {
    var d = createHealthDashboard(opts());
    assert.ok(d);
    assert.equal(typeof d.logPrint, 'function');
    assert.equal(typeof d.getHealth, 'function');
  });

  it('should reject weights that do not sum to 1.0', function() {
    assert.throws(function() {
      createHealthDashboard({ weights: { printSuccess: 0.5 } });
    }, /weights must sum to 1\.0/);
  });

  it('should accept custom weights summing to 1.0', function() {
    var d = createHealthDashboard(opts({
      weights: {
        printSuccess: 0.30,
        parameterDrift: 0.20,
        maintenance: 0.20,
        materialHealth: 0.10,
        contamination: 0.10,
        calibration: 0.10
      }
    }));
    assert.ok(d);
  });
});

// ── Logging Validation ───────────────────────────────────────────

describe('Logging validation', function() {
  var d;
  beforeEach(function() { d = createHealthDashboard(opts()); });

  it('logPrint requires id', function() {
    assert.throws(function() { d.logPrint({}); }, /id/);
  });

  it('logPrint requires success boolean', function() {
    assert.throws(function() { d.logPrint({ id: 'P1' }); }, /success/);
  });

  it('logPrint accepts valid entry', function() {
    d.logPrint({ id: 'P1', success: true, params: { pressure: 12 } });
    assert.equal(d.getHealth().stats.totalPrints, 1);
  });

  it('logMaintenance requires type', function() {
    assert.throws(function() { d.logMaintenance({}); }, /type/);
  });

  it('logMaintenance accepts valid entry', function() {
    d.logMaintenance({ type: 'nozzle_clean', completedDate: '2026-03-10' });
    assert.equal(d.getHealth().stats.totalMaintenanceTasks, 1);
  });

  it('logMaterialUse requires material', function() {
    assert.throws(function() { d.logMaterialUse({}); }, /material/);
  });

  it('logMaterialUse rejects negative usedMl', function() {
    assert.throws(function() {
      d.logMaterialUse({ material: 'GelMA', usedMl: -1 });
    }, /non-negative/);
  });

  it('logMaterialUse accepts valid entry', function() {
    d.logMaterialUse({ material: 'GelMA', usedMl: 2.5, wastedMl: 0.3 });
    assert.equal(d.getHealth().stats.totalMaterialUsedMl, 2.5);
  });

  it('setMaterialStock requires name', function() {
    assert.throws(function() { d.setMaterialStock('', 10); }, /name/);
  });

  it('setMaterialStock rejects negative', function() {
    assert.throws(function() { d.setMaterialStock('GelMA', -5); }, /non-negative/);
  });

  it('logContamination requires type', function() {
    assert.throws(function() { d.logContamination({}); }, /type/);
  });

  it('logCalibration requires type', function() {
    assert.throws(function() { d.logCalibration({}); }, /type/);
  });

  it('logCalibration requires passed boolean', function() {
    assert.throws(function() { d.logCalibration({ type: 'pressure' }); }, /passed/);
  });
});

// ── Empty State ──────────────────────────────────────────────────

describe('Empty dashboard', function() {
  it('should return high score with info alerts', function() {
    var d = createHealthDashboard(opts());
    var h = d.getHealth();
    assert.ok(h.overallScore >= 90);
    assert.equal(h.grade, 'A');
    assert.ok(h.stats.totalPrints === 0);
  });
});

// ── Print Success Scoring ────────────────────────────────────────

describe('Print success scoring', function() {
  it('should score 100 for all successful prints', function() {
    var d = createHealthDashboard(opts());
    for (var i = 0; i < 5; i++) {
      d.logPrint({ id: 'P' + i, success: true });
    }
    var h = d.getHealth();
    assert.equal(h.dimensions.printSuccess.score, 100);
  });

  it('should detect low success rate', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: true });
    d.logPrint({ id: 'P2', success: false, failureReason: 'clog' });
    d.logPrint({ id: 'P3', success: false, failureReason: 'clog' });
    d.logPrint({ id: 'P4', success: false, failureReason: 'adhesion' });
    var h = d.getHealth();
    assert.ok(h.dimensions.printSuccess.score < 80);
    var warnings = h.dimensions.printSuccess.alerts.filter(function(a) {
      return a.severity === 'warning' || a.severity === 'critical';
    });
    assert.ok(warnings.length > 0);
  });

  it('should return info alert for too few prints', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: true });
    var h = d.getHealth();
    assert.ok(h.dimensions.printSuccess.alerts.some(function(a) {
      return a.severity === 'info' && a.message.match(/not enough/i);
    }));
  });

  it('should detect declining trend', function() {
    var d = createHealthDashboard(opts());
    // 3 successes then 3 failures
    for (var i = 0; i < 3; i++) d.logPrint({ id: 'S' + i, success: true });
    for (var j = 0; j < 3; j++) d.logPrint({ id: 'F' + j, success: false });
    var h = d.getHealth();
    var trend = h.dimensions.printSuccess.alerts.some(function(a) {
      return a.message.match(/declining/i);
    });
    assert.ok(trend);
  });

  it('should identify top failure reason', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: false, failureReason: 'nozzle clog' });
    d.logPrint({ id: 'P2', success: false, failureReason: 'nozzle clog' });
    d.logPrint({ id: 'P3', success: false, failureReason: 'adhesion' });
    d.logPrint({ id: 'P4', success: true });
    var h = d.getHealth();
    var topReason = h.dimensions.printSuccess.alerts.some(function(a) {
      return a.message.match(/nozzle clog/);
    });
    assert.ok(topReason);
  });
});

// ── Parameter Drift Scoring ──────────────────────────────────────

describe('Parameter drift scoring', function() {
  it('should score 100 for consistent parameters', function() {
    var d = createHealthDashboard(opts());
    for (var i = 0; i < 5; i++) {
      d.logPrint({ id: 'P' + i, success: true, params: { pressure: 12.0, speed: 8.0 } });
    }
    var h = d.getHealth();
    assert.equal(h.dimensions.parameterDrift.score, 100);
  });

  it('should detect high parameter drift', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: true, params: { pressure: 10 } });
    d.logPrint({ id: 'P2', success: true, params: { pressure: 15 } });
    d.logPrint({ id: 'P3', success: true, params: { pressure: 8 } });
    d.logPrint({ id: 'P4', success: true, params: { pressure: 20 } });
    d.logPrint({ id: 'P5', success: true, params: { pressure: 5 } });
    var h = d.getHealth();
    assert.ok(h.dimensions.parameterDrift.score < 90);
  });

  it('should return info alert for no parameter data', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: true });
    d.logPrint({ id: 'P2', success: true });
    d.logPrint({ id: 'P3', success: true });
    var h = d.getHealth();
    assert.ok(h.dimensions.parameterDrift.alerts.some(function(a) {
      return a.severity === 'info';
    }));
  });
});

// ── Maintenance Scoring ──────────────────────────────────────────

describe('Maintenance scoring', function() {
  it('should score high for on-time maintenance', function() {
    var d = createHealthDashboard(opts());
    d.logMaintenance({
      type: 'nozzle_clean',
      scheduledDate: '2026-03-08',
      completedDate: '2026-03-08'
    });
    var h = d.getHealth();
    assert.ok(h.dimensions.maintenance.score >= 90);
  });

  it('should detect overdue maintenance', function() {
    var d = createHealthDashboard(opts());
    // Scheduled 10 days ago, not completed
    d.logMaintenance({
      type: 'nozzle_clean',
      scheduledDate: '2026-02-28'
    });
    var h = d.getHealth();
    assert.ok(h.dimensions.maintenance.score < 50);
    var critical = h.dimensions.maintenance.alerts.some(function(a) {
      return a.severity === 'critical';
    });
    assert.ok(critical);
  });

  it('should return info alert for no maintenance records', function() {
    var d = createHealthDashboard(opts());
    var h = d.getHealth();
    assert.ok(h.dimensions.maintenance.alerts.some(function(a) {
      return a.severity === 'info' && a.message.match(/no maintenance/i);
    }));
  });
});

// ── Material Health Scoring ──────────────────────────────────────

describe('Material health scoring', function() {
  it('should score high for low waste rate', function() {
    var d = createHealthDashboard(opts());
    d.logMaterialUse({ material: 'GelMA', usedMl: 10, wastedMl: 0.5 });
    var h = d.getHealth();
    assert.ok(h.dimensions.materialHealth.score >= 90);
  });

  it('should detect high waste rate', function() {
    var d = createHealthDashboard(opts());
    d.logMaterialUse({ material: 'GelMA', usedMl: 5, wastedMl: 5 });
    var h = d.getHealth();
    assert.ok(h.dimensions.materialHealth.score < 50);
    assert.ok(h.dimensions.materialHealth.alerts.some(function(a) {
      return a.severity === 'critical';
    }));
  });

  it('should detect low stock', function() {
    var d = createHealthDashboard(opts());
    d.logMaterialUse({ material: 'GelMA', usedMl: 1 });
    d.setMaterialStock('GelMA', 5);
    var h = d.getHealth();
    assert.ok(h.dimensions.materialHealth.alerts.some(function(a) {
      return a.message.match(/low stock/i);
    }));
  });
});

// ── Contamination Scoring ────────────────────────────────────────

describe('Contamination scoring', function() {
  it('should score 100 with no contamination', function() {
    var d = createHealthDashboard(opts());
    var h = d.getHealth();
    assert.equal(h.dimensions.contamination.score, 100);
  });

  it('should reduce score with recent events', function() {
    var d = createHealthDashboard(opts());
    for (var i = 0; i < 6; i++) {
      d.logContamination({ type: 'bacterial', severity: 'medium', date: '2026-03-05' });
    }
    var h = d.getHealth();
    assert.ok(h.dimensions.contamination.score < 50);
  });

  it('should penalise active quarantines', function() {
    var d = createHealthDashboard(opts());
    d.logContamination({ type: 'fungal', quarantineActive: true, date: '2026-03-09' });
    var h = d.getHealth();
    assert.ok(h.dimensions.contamination.alerts.some(function(a) {
      return a.message.match(/quarantine/i);
    }));
  });
});

// ── Calibration Scoring ──────────────────────────────────────────

describe('Calibration scoring', function() {
  it('should score high for recent passed calibration', function() {
    var d = createHealthDashboard(opts());
    d.logCalibration({ type: 'pressure', passed: true, date: '2026-03-09' });
    var h = d.getHealth();
    assert.equal(h.dimensions.calibration.score, 100);
  });

  it('should detect stale calibration', function() {
    var d = createHealthDashboard(opts());
    d.logCalibration({ type: 'pressure', passed: true, date: '2026-01-15' });
    var h = d.getHealth();
    assert.ok(h.dimensions.calibration.score < 50);
    assert.ok(h.dimensions.calibration.alerts.some(function(a) {
      return a.severity === 'critical' && a.message.match(/stale/i);
    }));
  });

  it('should detect failed calibration', function() {
    var d = createHealthDashboard(opts());
    d.logCalibration({ type: 'temperature', passed: false, date: '2026-03-09' });
    var h = d.getHealth();
    assert.ok(h.dimensions.calibration.score < 50);
    assert.ok(h.dimensions.calibration.alerts.some(function(a) {
      return a.severity === 'critical' && a.message.match(/failed/i);
    }));
  });

  it('should return warning for no calibration records', function() {
    var d = createHealthDashboard(opts());
    var h = d.getHealth();
    assert.ok(h.dimensions.calibration.alerts.some(function(a) {
      return a.severity === 'warning' && a.message.match(/calibrate/i);
    }));
  });
});

// ── Overall Health ───────────────────────────────────────────────

describe('Overall health scoring', function() {
  it('should grade A for healthy printer', function() {
    var d = createHealthDashboard(opts());
    for (var i = 0; i < 10; i++) {
      d.logPrint({ id: 'P' + i, success: true, params: { pressure: 12, speed: 8 } });
    }
    d.logMaintenance({ type: 'nozzle', scheduledDate: '2026-03-08', completedDate: '2026-03-08' });
    d.logMaterialUse({ material: 'GelMA', usedMl: 20, wastedMl: 1 });
    d.logCalibration({ type: 'pressure', passed: true, date: '2026-03-09' });
    var h = d.getHealth();
    assert.equal(h.grade, 'A');
    assert.ok(h.overallScore >= 90);
  });

  it('should grade F for badly maintained printer', function() {
    var d = createHealthDashboard(opts());
    // All failures
    for (var i = 0; i < 5; i++) {
      d.logPrint({ id: 'P' + i, success: false, failureReason: 'clog' });
    }
    // Overdue maintenance
    d.logMaintenance({ type: 'nozzle', scheduledDate: '2026-01-01' });
    // High waste
    d.logMaterialUse({ material: 'GelMA', usedMl: 2, wastedMl: 8 });
    // Contamination
    for (var j = 0; j < 8; j++) {
      d.logContamination({ type: 'bacterial', date: '2026-03-05' });
    }
    // Failed calibration
    d.logCalibration({ type: 'pressure', passed: false, date: '2026-03-09' });
    var h = d.getHealth();
    assert.equal(h.grade, 'F');
    assert.ok(h.overallScore < 50);
  });

  it('alerts should be sorted by severity (critical first)', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: false });
    d.logPrint({ id: 'P2', success: false });
    d.logPrint({ id: 'P3', success: false });
    d.logPrint({ id: 'P4', success: false });
    d.logMaintenance({ type: 'nozzle', scheduledDate: '2026-01-01' });
    var h = d.getHealth();
    if (h.alerts.length >= 2) {
      var prevSev = 999;
      for (var i = 0; i < h.alerts.length; i++) {
        var sev = h.alerts[i].severity === 'critical' ? 2 : h.alerts[i].severity === 'warning' ? 1 : 0;
        assert.ok(sev <= prevSev, 'Alerts should be sorted critical → warning → info');
        prevSev = sev;
      }
    }
  });
});

// ── Snapshots ────────────────────────────────────────────────────

describe('Health snapshots', function() {
  it('should take and retrieve snapshots', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: true });
    var snap = d.takeSnapshot();
    assert.ok(snap.overallScore > 0);
    assert.ok(snap.timestamp);
    assert.equal(d.getSnapshots().length, 1);
  });

  it('should not modify snapshots through returned array', function() {
    var d = createHealthDashboard(opts());
    d.takeSnapshot();
    var snaps = d.getSnapshots();
    snaps.push({ fake: true });
    assert.equal(d.getSnapshots().length, 1);
  });
});

// ── Health Trend ─────────────────────────────────────────────────

describe('Health trend', function() {
  it('should return null with fewer than 2 snapshots', function() {
    var d = createHealthDashboard(opts());
    assert.equal(d.getHealthTrend(), null);
    d.takeSnapshot();
    assert.equal(d.getHealthTrend(), null);
  });

  it('should detect declining trend', function() {
    var d = createHealthDashboard(opts());
    // Good state
    for (var i = 0; i < 5; i++) d.logPrint({ id: 'S' + i, success: true });
    d.takeSnapshot();

    // Bad state
    for (var j = 0; j < 10; j++) d.logPrint({ id: 'F' + j, success: false });
    d.takeSnapshot();

    var trends = d.getHealthTrend();
    assert.ok(trends);
    assert.equal(trends.overall, 'declining');
  });

  it('should detect stable trend', function() {
    var d = createHealthDashboard(opts());
    for (var i = 0; i < 3; i++) d.logPrint({ id: 'A' + i, success: true });
    d.takeSnapshot();
    d.takeSnapshot(); // same data

    var trends = d.getHealthTrend();
    assert.equal(trends.overall, 'stable');
  });
});

// ── Failure Analysis ─────────────────────────────────────────────

describe('Failure analysis', function() {
  it('should return empty for no failures', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: true });
    var a = d.getFailureAnalysis();
    assert.equal(a.totalFailures, 0);
    assert.deepEqual(a.reasons, {});
  });

  it('should break down failure reasons', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: false, failureReason: 'clog' });
    d.logPrint({ id: 'P2', success: false, failureReason: 'clog' });
    d.logPrint({ id: 'P3', success: false, failureReason: 'adhesion' });
    var a = d.getFailureAnalysis();
    assert.equal(a.totalFailures, 3);
    assert.equal(a.reasons.clog.count, 2);
    assert.ok(Math.abs(a.reasons.clog.percentage - 66.7) < 0.1);
    assert.equal(a.reasons.adhesion.count, 1);
  });

  it('should handle unknown failure reasons', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: false });
    var a = d.getFailureAnalysis();
    assert.equal(a.reasons.unknown.count, 1);
  });
});

// ── Material Summary ─────────────────────────────────────────────

describe('Material summary', function() {
  it('should aggregate per material', function() {
    var d = createHealthDashboard(opts());
    d.logMaterialUse({ material: 'GelMA', usedMl: 5, wastedMl: 1 });
    d.logMaterialUse({ material: 'GelMA', usedMl: 3, wastedMl: 0.5 });
    d.logMaterialUse({ material: 'Collagen', usedMl: 2 });
    d.setMaterialStock('GelMA', 20);

    var s = d.getMaterialSummary();
    assert.equal(s.GelMA.usedMl, 8);
    assert.equal(s.GelMA.wastedMl, 1.5);
    assert.equal(s.GelMA.totalMl, 9.5);
    assert.equal(s.GelMA.stockMl, 20);
    assert.equal(s.Collagen.usedMl, 2);
    assert.equal(s.Collagen.stockMl, null);
  });
});

// ── Report Generation ────────────────────────────────────────────

describe('Report generation', function() {
  it('should generate a text report', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: true, params: { pressure: 12 } });
    d.logMaterialUse({ material: 'GelMA', usedMl: 5, wastedMl: 0.5 });
    var report = d.generateReport();
    assert.ok(report.indexOf('PRINT HEALTH DASHBOARD') >= 0);
    assert.ok(report.indexOf('Print Success') >= 0);
    assert.ok(report.indexOf('Calibration') >= 0);
    assert.ok(report.indexOf('Material used') >= 0);
  });
});

// ── Reset ────────────────────────────────────────────────────────

describe('Reset', function() {
  it('should clear all data', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: true });
    d.logMaintenance({ type: 'clean' });
    d.logMaterialUse({ material: 'X', usedMl: 1 });
    d.setMaterialStock('X', 100);
    d.logContamination({ type: 'bacterial' });
    d.logCalibration({ type: 'pressure', passed: true });
    d.takeSnapshot();

    d.reset();

    var h = d.getHealth();
    assert.equal(h.stats.totalPrints, 0);
    assert.equal(h.stats.totalMaintenanceTasks, 0);
    assert.equal(h.stats.contaminationEvents, 0);
    assert.equal(h.stats.calibrationEvents, 0);
    assert.equal(d.getSnapshots().length, 0);
    assert.deepEqual(d.getMaterialSummary(), {});
  });
});

// ── Custom Thresholds ────────────────────────────────────────────

describe('Custom thresholds', function() {
  it('should use custom success rate threshold', function() {
    var d = createHealthDashboard(opts({
      thresholds: { minSuccessRate: 0.95 }
    }));
    // 4/5 = 80% — below custom 95% threshold
    for (var i = 0; i < 4; i++) d.logPrint({ id: 'S' + i, success: true });
    d.logPrint({ id: 'F1', success: false });
    var h = d.getHealth();
    assert.ok(h.dimensions.printSuccess.alerts.some(function(a) {
      return a.severity === 'warning';
    }));
  });
});

// ── Date Parsing ─────────────────────────────────────────────────

describe('Date parsing', function() {
  it('should parse ISO date strings', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: true, date: '2026-03-01T10:00:00Z' });
    assert.equal(d.getHealth().stats.totalPrints, 1);
  });

  it('should accept Date objects', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: true, date: new Date('2026-03-01') });
    assert.equal(d.getHealth().stats.totalPrints, 1);
  });

  it('should handle null dates (defaults to now)', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: true });
    assert.equal(d.getHealth().stats.totalPrints, 1);
  });
});

// ── Grade Boundaries ─────────────────────────────────────────────

describe('Grade boundaries', function() {
  it('grade A for 90+', function() {
    var d = createHealthDashboard(opts());
    for (var i = 0; i < 10; i++) {
      d.logPrint({ id: 'P' + i, success: true, params: { p: 12 } });
    }
    d.logCalibration({ type: 'p', passed: true, date: '2026-03-09' });
    d.logMaintenance({ type: 'c', scheduledDate: '2026-03-09', completedDate: '2026-03-09' });
    assert.equal(d.getHealth().grade, 'A');
  });
});

// ── Stats Consistency ────────────────────────────────────────────

describe('Stats consistency', function() {
  it('material stats should match logged data', function() {
    var d = createHealthDashboard(opts());
    d.logMaterialUse({ material: 'A', usedMl: 10, wastedMl: 2 });
    d.logMaterialUse({ material: 'B', usedMl: 5, wastedMl: 1 });
    var h = d.getHealth();
    assert.equal(h.stats.totalMaterialUsedMl, 15);
    assert.equal(h.stats.totalMaterialWastedMl, 3);
  });

  it('success rate should be accurate', function() {
    var d = createHealthDashboard(opts());
    d.logPrint({ id: 'P1', success: true });
    d.logPrint({ id: 'P2', success: true });
    d.logPrint({ id: 'P3', success: false });
    var h = d.getHealth();
    assert.ok(Math.abs(h.stats.successRate - 0.667) < 0.001);
  });
});
