'use strict';

var _utils = require('./scriptUtils');
var clamp = _utils.clamp;
var round = _utils.round;
var mean = _utils.mean;

/**
 * Print Health Dashboard for BioBots
 *
 * Aggregates data from multiple bioprinting modules into a unified
 * "printer health" score with actionable insights. Think of it as a
 * fitness tracker for your bioprinter — one glance tells you if
 * everything is running smoothly or needs attention.
 *
 * Features:
 *   - Overall health score (0–100) from 6 weighted dimensions
 *   - Print success rate tracking with trend analysis
 *   - Parameter drift detection across print runs
 *   - Maintenance compliance scoring
 *   - Material consumption tracking and waste rates
 *   - Contamination risk assessment
 *   - Calibration freshness monitoring
 *   - Alert generation with severity levels
 *   - Historical health snapshots for trend visualization
 *   - Configurable thresholds and dimension weights
 *   - Health report generation (text, JSON)
 *
 * Health Dimensions:
 *   1. Print Success   — ratio of successful prints, trend direction
 *   2. Parameter Drift — stability of key parameters over recent runs
 *   3. Maintenance     — on-schedule maintenance, overdue tasks
 *   4. Material Health — waste rate, stock levels, expiry risk
 *   5. Contamination   — contamination event rate, open quarantines
 *   6. Calibration     — calibration age, consistency of results
 *
 * Usage:
 *   var dashboard = createHealthDashboard();
 *
 *   // Log print outcomes
 *   dashboard.logPrint({ id: 'P001', success: true, params: { pressure: 12, speed: 8 } });
 *   dashboard.logPrint({ id: 'P002', success: false, failureReason: 'nozzle clog' });
 *
 *   // Log maintenance
 *   dashboard.logMaintenance({ type: 'nozzle_clean', scheduledDate: '2026-03-01', completedDate: '2026-03-01' });
 *
 *   // Log material usage
 *   dashboard.logMaterialUse({ material: 'GelMA', usedMl: 2.5, wastedMl: 0.3 });
 *
 *   // Log contamination events
 *   dashboard.logContamination({ type: 'bacterial', severity: 'medium' });
 *
 *   // Log calibration
 *   dashboard.logCalibration({ type: 'pressure', date: '2026-03-10', passed: true });
 *
 *   // Get health score
 *   var health = dashboard.getHealth();
 *   console.log(health.overallScore);  // 0–100
 *   console.log(health.grade);          // A/B/C/D/F
 *   console.log(health.alerts);         // [{severity, message, dimension}]
 */

// ── Constants ───────────────────────────────────────────────────

var SEVERITY_LEVELS = { info: 0, warning: 1, critical: 2 };

var DEFAULT_WEIGHTS = {
  printSuccess: 0.25,
  parameterDrift: 0.20,
  maintenance: 0.20,
  materialHealth: 0.15,
  contamination: 0.10,
  calibration: 0.10
};

var DEFAULT_THRESHOLDS = {
  // Print success
  minSuccessRate: 0.80,        // below this → warning
  criticalSuccessRate: 0.60,   // below this → critical
  minPrintsForScore: 3,        // need at least 3 prints to score

  // Parameter drift
  maxDriftPercent: 15,         // >15% drift from baseline → warning
  criticalDriftPercent: 30,    // >30% → critical
  driftWindowSize: 10,         // last N prints for drift analysis

  // Maintenance
  overdueDaysWarning: 3,       // overdue by 3 days → warning
  overdueDaysCritical: 7,      // overdue by 7 days → critical

  // Material
  maxWasteRate: 0.15,          // >15% waste rate → warning
  criticalWasteRate: 0.30,     // >30% → critical
  lowStockThresholdMl: 10,     // below 10ml → warning

  // Contamination
  maxEventsPerMonth: 2,        // >2 events/month → warning
  criticalEventsPerMonth: 5,   // >5 → critical
  contaminationWindowDays: 30,

  // Calibration
  calibrationStaleDays: 14,    // >14 days since last cal → warning
  calibrationCriticalDays: 30  // >30 days → critical
};

var GRADE_THRESHOLDS = [
  { min: 90, grade: 'A', label: 'Excellent' },
  { min: 80, grade: 'B', label: 'Good' },
  { min: 70, grade: 'C', label: 'Fair' },
  { min: 50, grade: 'D', label: 'Poor' },
  { min: 0,  grade: 'F', label: 'Critical' }
];

var MS_PER_DAY = 86400000;

// ── Factory ─────────────────────────────────────────────────────

/**
 * Creates a new Print Health Dashboard instance.
 *
 * @param {Object} [options] Configuration options.
 * @param {Object} [options.weights] Dimension weights (must sum to ~1.0).
 * @param {Object} [options.thresholds] Override default thresholds.
 * @param {Function} [options.now] Custom clock function for testing.
 * @returns {Object} Dashboard API.
 */
function createHealthDashboard(options) {
  var opts = options || {};
  var weights = Object.assign({}, DEFAULT_WEIGHTS, opts.weights || {});
  var thresholds = Object.assign({}, DEFAULT_THRESHOLDS, opts.thresholds || {});
  var nowFn = opts.now || function() { return new Date(); };

  // Validate weights sum to ~1.0
  var weightSum = Object.keys(weights).reduce(function(sum, k) { return sum + weights[k]; }, 0);
  if (Math.abs(weightSum - 1.0) > 0.01) {
    throw new Error('Dimension weights must sum to 1.0, got ' + round(weightSum, 3));
  }

  // ── State ───────────────────────────────────────────────────
  var prints = [];
  var maintenanceLogs = [];
  var materialLogs = [];
  var contaminationEvents = [];
  var calibrationLogs = [];
  var healthSnapshots = [];
  var materialStock = {};  // material → remaining ml

  // ── Logging API ─────────────────────────────────────────────

  /**
   * Log a print outcome.
   * @param {Object} entry
   * @param {string} entry.id - Print identifier.
   * @param {boolean} entry.success - Whether the print succeeded.
   * @param {Object} [entry.params] - Key-value parameter readings.
   * @param {string} [entry.failureReason] - Reason for failure.
   * @param {Date|string} [entry.date] - Date of print (defaults to now).
   */
  function logPrint(entry) {
    if (!entry || !entry.id) throw new Error('Print entry must have an id');
    if (typeof entry.success !== 'boolean') throw new Error('Print entry must have success (boolean)');
    prints.push({
      id: entry.id,
      success: entry.success,
      params: entry.params || {},
      failureReason: entry.failureReason || null,
      date: _parseDate(entry.date) || nowFn()
    });
  }

  /**
   * Log a maintenance event.
   * @param {Object} entry
   * @param {string} entry.type - Maintenance type (e.g., 'nozzle_clean').
   * @param {Date|string} [entry.scheduledDate] - When it was due.
   * @param {Date|string} [entry.completedDate] - When it was done.
   */
  function logMaintenance(entry) {
    if (!entry || !entry.type) throw new Error('Maintenance entry must have a type');
    maintenanceLogs.push({
      type: entry.type,
      scheduledDate: _parseDate(entry.scheduledDate) || null,
      completedDate: _parseDate(entry.completedDate) || null,
      notes: entry.notes || null
    });
  }

  /**
   * Log material consumption.
   * @param {Object} entry
   * @param {string} entry.material - Material name.
   * @param {number} entry.usedMl - Millilitres used productively.
   * @param {number} [entry.wastedMl=0] - Millilitres wasted.
   */
  function logMaterialUse(entry) {
    if (!entry || !entry.material) throw new Error('Material entry must have a material name');
    if (typeof entry.usedMl !== 'number' || entry.usedMl < 0) {
      throw new Error('usedMl must be a non-negative number');
    }
    var wasted = entry.wastedMl || 0;
    if (typeof wasted !== 'number' || wasted < 0) {
      throw new Error('wastedMl must be a non-negative number');
    }
    materialLogs.push({
      material: entry.material,
      usedMl: entry.usedMl,
      wastedMl: wasted,
      date: _parseDate(entry.date) || nowFn()
    });
  }

  /**
   * Set current stock level for a material.
   * @param {string} material - Material name.
   * @param {number} stockMl - Current stock in millilitres.
   */
  function setMaterialStock(material, stockMl) {
    if (!material) throw new Error('Material name required');
    if (typeof stockMl !== 'number' || stockMl < 0) {
      throw new Error('stockMl must be a non-negative number');
    }
    materialStock[material] = stockMl;
  }

  /**
   * Log a contamination event.
   * @param {Object} entry
   * @param {string} entry.type - Contamination type.
   * @param {string} [entry.severity='medium'] - 'low', 'medium', or 'high'.
   * @param {boolean} [entry.quarantineActive=false] - Is quarantine active?
   */
  function logContamination(entry) {
    if (!entry || !entry.type) throw new Error('Contamination entry must have a type');
    contaminationEvents.push({
      type: entry.type,
      severity: entry.severity || 'medium',
      quarantineActive: entry.quarantineActive || false,
      date: _parseDate(entry.date) || nowFn()
    });
  }

  /**
   * Log a calibration event.
   * @param {Object} entry
   * @param {string} entry.type - Calibration type (e.g., 'pressure', 'temperature').
   * @param {boolean} entry.passed - Whether calibration passed.
   * @param {Date|string} [entry.date] - Date of calibration.
   */
  function logCalibration(entry) {
    if (!entry || !entry.type) throw new Error('Calibration entry must have a type');
    if (typeof entry.passed !== 'boolean') throw new Error('Calibration entry must have passed (boolean)');
    calibrationLogs.push({
      type: entry.type,
      passed: entry.passed,
      date: _parseDate(entry.date) || nowFn()
    });
  }

  // ── Dimension Scorers ───────────────────────────────────────

  function _scorePrintSuccess() {
    var alerts = [];
    if (prints.length < thresholds.minPrintsForScore) {
      return { score: 100, alerts: [{ severity: 'info', message: 'Not enough prints to score (' + prints.length + '/' + thresholds.minPrintsForScore + ')', dimension: 'printSuccess' }] };
    }

    var successes = prints.filter(function(p) { return p.success; }).length;
    var rate = successes / prints.length;
    var score;

    if (rate >= thresholds.minSuccessRate) {
      score = 80 + (rate - thresholds.minSuccessRate) / (1 - thresholds.minSuccessRate) * 20;
    } else if (rate >= thresholds.criticalSuccessRate) {
      score = 40 + (rate - thresholds.criticalSuccessRate) / (thresholds.minSuccessRate - thresholds.criticalSuccessRate) * 40;
    } else {
      score = rate / thresholds.criticalSuccessRate * 40;
    }

    if (rate < thresholds.criticalSuccessRate) {
      alerts.push({ severity: 'critical', message: 'Print success rate critically low: ' + round(rate * 100, 1) + '%', dimension: 'printSuccess' });
    } else if (rate < thresholds.minSuccessRate) {
      alerts.push({ severity: 'warning', message: 'Print success rate below target: ' + round(rate * 100, 1) + '%', dimension: 'printSuccess' });
    }

    // Trend analysis — compare last 3 vs previous 3
    if (prints.length >= 6) {
      var recent = prints.slice(-3);
      var previous = prints.slice(-6, -3);
      var recentRate = recent.filter(function(p) { return p.success; }).length / 3;
      var prevRate = previous.filter(function(p) { return p.success; }).length / 3;
      if (recentRate < prevRate - 0.2) {
        alerts.push({ severity: 'warning', message: 'Declining print success trend detected', dimension: 'printSuccess' });
      }
    }

    // Top failure reasons
    var failures = prints.filter(function(p) { return !p.success && p.failureReason; });
    if (failures.length > 0) {
      var reasons = {};
      failures.forEach(function(f) {
        reasons[f.failureReason] = (reasons[f.failureReason] || 0) + 1;
      });
      var topReason = Object.keys(reasons).sort(function(a, b) { return reasons[b] - reasons[a]; })[0];
      if (reasons[topReason] >= 2) {
        alerts.push({ severity: 'info', message: 'Top failure reason: "' + topReason + '" (' + reasons[topReason] + ' occurrences)', dimension: 'printSuccess' });
      }
    }

    return { score: clamp(round(score, 1), 0, 100), alerts: alerts };
  }

  function _scoreParameterDrift() {
    var alerts = [];
    var windowSize = Math.min(thresholds.driftWindowSize, prints.length);
    var recent = prints.slice(-windowSize);
    var paramReadings = {};

    recent.forEach(function(p) {
      Object.keys(p.params).forEach(function(key) {
        if (typeof p.params[key] === 'number') {
          if (!paramReadings[key]) paramReadings[key] = [];
          paramReadings[key].push(p.params[key]);
        }
      });
    });

    var paramNames = Object.keys(paramReadings);
    if (paramNames.length === 0) {
      return { score: 100, alerts: [{ severity: 'info', message: 'No parameter data recorded', dimension: 'parameterDrift' }] };
    }

    var driftScores = [];
    paramNames.forEach(function(param) {
      var values = paramReadings[param];
      if (values.length < 2) return;

      var avg = mean(values);
      if (avg === 0) return;

      // Coefficient of variation as drift measure
      var variance = values.reduce(function(sum, v) { return sum + Math.pow(v - avg, 2); }, 0) / values.length;
      var cv = Math.sqrt(variance) / Math.abs(avg) * 100;

      var paramScore;
      if (cv <= thresholds.maxDriftPercent) {
        paramScore = 100 - cv / thresholds.maxDriftPercent * 20;
      } else if (cv <= thresholds.criticalDriftPercent) {
        paramScore = 80 - (cv - thresholds.maxDriftPercent) / (thresholds.criticalDriftPercent - thresholds.maxDriftPercent) * 60;
      } else {
        paramScore = Math.max(0, 20 - (cv - thresholds.criticalDriftPercent));
      }
      driftScores.push(paramScore);

      if (cv > thresholds.criticalDriftPercent) {
        alerts.push({ severity: 'critical', message: 'Critical parameter drift: ' + param + ' (CV=' + round(cv, 1) + '%)', dimension: 'parameterDrift' });
      } else if (cv > thresholds.maxDriftPercent) {
        alerts.push({ severity: 'warning', message: 'Parameter drift detected: ' + param + ' (CV=' + round(cv, 1) + '%)', dimension: 'parameterDrift' });
      }
    });

    var score = driftScores.length > 0 ? mean(driftScores) : 100;
    return { score: clamp(round(score, 1), 0, 100), alerts: alerts };
  }

  function _scoreMaintenanceCompliance() {
    var alerts = [];
    if (maintenanceLogs.length === 0) {
      return { score: 100, alerts: [{ severity: 'info', message: 'No maintenance records', dimension: 'maintenance' }] };
    }

    var now = nowFn();
    var scores = [];
    var overdueCount = 0;
    var criticalOverdue = 0;

    maintenanceLogs.forEach(function(m) {
      if (m.completedDate) {
        // Completed — score based on timeliness
        if (m.scheduledDate) {
          var daysLate = (m.completedDate - m.scheduledDate) / MS_PER_DAY;
          if (daysLate <= 0) {
            scores.push(100); // On time or early
          } else if (daysLate <= thresholds.overdueDaysWarning) {
            scores.push(80);
          } else {
            scores.push(50);
          }
        } else {
          scores.push(90); // Completed but no schedule — still good
        }
      } else if (m.scheduledDate) {
        // Scheduled but not completed
        var overdueDays = (now - m.scheduledDate) / MS_PER_DAY;
        if (overdueDays > thresholds.overdueDaysCritical) {
          scores.push(10);
          criticalOverdue++;
        } else if (overdueDays > thresholds.overdueDaysWarning) {
          scores.push(40);
          overdueCount++;
        } else if (overdueDays > 0) {
          scores.push(70);
        } else {
          scores.push(95); // Upcoming
        }
      }
    });

    if (criticalOverdue > 0) {
      alerts.push({ severity: 'critical', message: criticalOverdue + ' maintenance task(s) critically overdue', dimension: 'maintenance' });
    }
    if (overdueCount > 0) {
      alerts.push({ severity: 'warning', message: overdueCount + ' maintenance task(s) overdue', dimension: 'maintenance' });
    }

    var score = scores.length > 0 ? mean(scores) : 100;
    return { score: clamp(round(score, 1), 0, 100), alerts: alerts };
  }

  function _scoreMaterialHealth() {
    var alerts = [];
    if (materialLogs.length === 0) {
      return { score: 100, alerts: [{ severity: 'info', message: 'No material usage data', dimension: 'materialHealth' }] };
    }

    var scores = [];

    // Waste rate scoring
    var totalUsed = 0;
    var totalWasted = 0;
    materialLogs.forEach(function(m) {
      totalUsed += m.usedMl;
      totalWasted += m.wastedMl;
    });

    var total = totalUsed + totalWasted;
    var wasteRate = total > 0 ? totalWasted / total : 0;

    if (wasteRate <= thresholds.maxWasteRate) {
      scores.push(100 - wasteRate / thresholds.maxWasteRate * 20);
    } else if (wasteRate <= thresholds.criticalWasteRate) {
      scores.push(80 - (wasteRate - thresholds.maxWasteRate) / (thresholds.criticalWasteRate - thresholds.maxWasteRate) * 50);
    } else {
      scores.push(Math.max(0, 30 - (wasteRate - thresholds.criticalWasteRate) * 100));
    }

    if (wasteRate > thresholds.criticalWasteRate) {
      alerts.push({ severity: 'critical', message: 'Material waste rate critically high: ' + round(wasteRate * 100, 1) + '%', dimension: 'materialHealth' });
    } else if (wasteRate > thresholds.maxWasteRate) {
      alerts.push({ severity: 'warning', message: 'Material waste rate elevated: ' + round(wasteRate * 100, 1) + '%', dimension: 'materialHealth' });
    }

    // Stock level scoring
    var stockMaterials = Object.keys(materialStock);
    stockMaterials.forEach(function(mat) {
      var stock = materialStock[mat];
      if (stock < thresholds.lowStockThresholdMl) {
        scores.push(50);
        alerts.push({ severity: 'warning', message: 'Low stock: ' + mat + ' (' + round(stock, 1) + ' ml remaining)', dimension: 'materialHealth' });
      } else {
        scores.push(100);
      }
    });

    var score = scores.length > 0 ? mean(scores) : 100;
    return { score: clamp(round(score, 1), 0, 100), alerts: alerts };
  }

  function _scoreContamination() {
    var alerts = [];
    if (contaminationEvents.length === 0) {
      return { score: 100, alerts: [] };
    }

    var now = nowFn();
    var windowMs = thresholds.contaminationWindowDays * MS_PER_DAY;
    var recentEvents = contaminationEvents.filter(function(e) {
      return (now - e.date) < windowMs;
    });

    var recentCount = recentEvents.length;
    var monthlyRate = recentCount * (30 / thresholds.contaminationWindowDays);

    var score;
    if (monthlyRate === 0) {
      score = 100;
    } else if (monthlyRate <= thresholds.maxEventsPerMonth) {
      score = 100 - monthlyRate / thresholds.maxEventsPerMonth * 30;
    } else if (monthlyRate <= thresholds.criticalEventsPerMonth) {
      score = 70 - (monthlyRate - thresholds.maxEventsPerMonth) / (thresholds.criticalEventsPerMonth - thresholds.maxEventsPerMonth) * 40;
    } else {
      score = Math.max(0, 30 - (monthlyRate - thresholds.criticalEventsPerMonth) * 5);
    }

    if (monthlyRate > thresholds.criticalEventsPerMonth) {
      alerts.push({ severity: 'critical', message: 'High contamination rate: ~' + round(monthlyRate, 1) + ' events/month', dimension: 'contamination' });
    } else if (monthlyRate > thresholds.maxEventsPerMonth) {
      alerts.push({ severity: 'warning', message: 'Elevated contamination rate: ~' + round(monthlyRate, 1) + ' events/month', dimension: 'contamination' });
    }

    // Active quarantines
    var activeQuarantines = contaminationEvents.filter(function(e) { return e.quarantineActive; }).length;
    if (activeQuarantines > 0) {
      score = Math.max(score - activeQuarantines * 10, 0);
      alerts.push({ severity: 'warning', message: activeQuarantines + ' active quarantine(s)', dimension: 'contamination' });
    }

    return { score: clamp(round(score, 1), 0, 100), alerts: alerts };
  }

  function _scoreCalibration() {
    var alerts = [];
    if (calibrationLogs.length === 0) {
      return { score: 70, alerts: [{ severity: 'warning', message: 'No calibration records — calibrate your printer', dimension: 'calibration' }] };
    }

    var now = nowFn();
    var scores = [];

    // Group calibrations by type and check freshness
    var byType = {};
    calibrationLogs.forEach(function(c) {
      if (!byType[c.type]) byType[c.type] = [];
      byType[c.type].push(c);
    });

    Object.keys(byType).forEach(function(type) {
      var cals = byType[type].sort(function(a, b) { return b.date - a.date; });
      var latest = cals[0];
      var ageDays = (now - latest.date) / MS_PER_DAY;

      if (!latest.passed) {
        scores.push(30);
        alerts.push({ severity: 'critical', message: 'Failed calibration: ' + type, dimension: 'calibration' });
      } else if (ageDays > thresholds.calibrationCriticalDays) {
        scores.push(30);
        alerts.push({ severity: 'critical', message: 'Calibration stale (' + type + '): ' + round(ageDays, 0) + ' days old', dimension: 'calibration' });
      } else if (ageDays > thresholds.calibrationStaleDays) {
        scores.push(70);
        alerts.push({ severity: 'warning', message: 'Calibration aging (' + type + '): ' + round(ageDays, 0) + ' days old', dimension: 'calibration' });
      } else {
        scores.push(100);
      }
    });

    var score = scores.length > 0 ? mean(scores) : 70;
    return { score: clamp(round(score, 1), 0, 100), alerts: alerts };
  }

  // ── Core API ────────────────────────────────────────────────

  /**
   * Get the current health status.
   *
   * @returns {Object} Health report with:
   *   - overallScore: 0–100
   *   - grade: A/B/C/D/F
   *   - gradeLabel: 'Excellent'/'Good'/'Fair'/'Poor'/'Critical'
   *   - dimensions: per-dimension scores
   *   - alerts: aggregated alerts sorted by severity
   *   - stats: summary statistics
   */
  function getHealth() {
    var dimensions = {
      printSuccess: _scorePrintSuccess(),
      parameterDrift: _scoreParameterDrift(),
      maintenance: _scoreMaintenanceCompliance(),
      materialHealth: _scoreMaterialHealth(),
      contamination: _scoreContamination(),
      calibration: _scoreCalibration()
    };

    // Weighted overall score
    var overallScore = 0;
    Object.keys(dimensions).forEach(function(dim) {
      overallScore += dimensions[dim].score * weights[dim];
    });
    overallScore = clamp(round(overallScore, 1), 0, 100);

    // Grade
    var gradeEntry = GRADE_THRESHOLDS.find(function(g) { return overallScore >= g.min; }) || GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1];

    // Aggregate alerts by severity (critical first)
    var allAlerts = [];
    Object.keys(dimensions).forEach(function(dim) {
      dimensions[dim].alerts.forEach(function(a) { allAlerts.push(a); });
    });
    allAlerts.sort(function(a, b) {
      return (SEVERITY_LEVELS[b.severity] || 0) - (SEVERITY_LEVELS[a.severity] || 0);
    });

    // Stats
    var successes = prints.filter(function(p) { return p.success; }).length;
    var stats = {
      totalPrints: prints.length,
      successfulPrints: successes,
      successRate: prints.length > 0 ? round(successes / prints.length, 3) : null,
      totalMaintenanceTasks: maintenanceLogs.length,
      totalMaterialUsedMl: round(materialLogs.reduce(function(s, m) { return s + m.usedMl; }, 0), 2),
      totalMaterialWastedMl: round(materialLogs.reduce(function(s, m) { return s + m.wastedMl; }, 0), 2),
      contaminationEvents: contaminationEvents.length,
      calibrationEvents: calibrationLogs.length
    };

    return {
      overallScore: overallScore,
      grade: gradeEntry.grade,
      gradeLabel: gradeEntry.label,
      dimensions: dimensions,
      alerts: allAlerts,
      stats: stats,
      timestamp: nowFn()
    };
  }

  /**
   * Take a health snapshot for historical tracking.
   * @returns {Object} The snapshot that was stored.
   */
  function takeSnapshot() {
    var health = getHealth();
    var snapshot = {
      overallScore: health.overallScore,
      grade: health.grade,
      dimensions: {},
      alertCount: health.alerts.length,
      criticalAlerts: health.alerts.filter(function(a) { return a.severity === 'critical'; }).length,
      timestamp: nowFn()
    };
    Object.keys(health.dimensions).forEach(function(dim) {
      snapshot.dimensions[dim] = health.dimensions[dim].score;
    });
    healthSnapshots.push(snapshot);
    return snapshot;
  }

  /**
   * Get all historical health snapshots.
   * @returns {Array} List of snapshots.
   */
  function getSnapshots() {
    return healthSnapshots.slice();
  }

  /**
   * Get the health trend direction for each dimension.
   * Requires at least 2 snapshots.
   * @returns {Object|null} Per-dimension trend ('improving', 'stable', 'declining') or null.
   */
  function getHealthTrend() {
    if (healthSnapshots.length < 2) return null;
    var latest = healthSnapshots[healthSnapshots.length - 1];
    var previous = healthSnapshots[healthSnapshots.length - 2];

    var trends = {};
    Object.keys(latest.dimensions).forEach(function(dim) {
      var diff = latest.dimensions[dim] - previous.dimensions[dim];
      if (diff > 5) trends[dim] = 'improving';
      else if (diff < -5) trends[dim] = 'declining';
      else trends[dim] = 'stable';
    });

    var overallDiff = latest.overallScore - previous.overallScore;
    if (overallDiff > 3) trends.overall = 'improving';
    else if (overallDiff < -3) trends.overall = 'declining';
    else trends.overall = 'stable';

    return trends;
  }

  /**
   * Get print failure analysis — breakdown of failure reasons.
   * @returns {Object} Failure analysis with counts and percentages.
   */
  function getFailureAnalysis() {
    var failures = prints.filter(function(p) { return !p.success; });
    if (failures.length === 0) return { totalFailures: 0, reasons: {} };

    var reasons = {};
    failures.forEach(function(f) {
      var reason = f.failureReason || 'unknown';
      reasons[reason] = (reasons[reason] || 0) + 1;
    });

    var analysis = {};
    Object.keys(reasons).sort(function(a, b) { return reasons[b] - reasons[a]; }).forEach(function(r) {
      analysis[r] = {
        count: reasons[r],
        percentage: round(reasons[r] / failures.length * 100, 1)
      };
    });

    return { totalFailures: failures.length, reasons: analysis };
  }

  /**
   * Get material consumption summary per material.
   * @returns {Object} Per-material used, wasted, waste rate, and stock level.
   */
  function getMaterialSummary() {
    var byMaterial = {};
    materialLogs.forEach(function(m) {
      if (!byMaterial[m.material]) {
        byMaterial[m.material] = { usedMl: 0, wastedMl: 0 };
      }
      byMaterial[m.material].usedMl += m.usedMl;
      byMaterial[m.material].wastedMl += m.wastedMl;
    });

    var summary = {};
    Object.keys(byMaterial).forEach(function(mat) {
      var data = byMaterial[mat];
      var total = data.usedMl + data.wastedMl;
      summary[mat] = {
        usedMl: round(data.usedMl, 2),
        wastedMl: round(data.wastedMl, 2),
        totalMl: round(total, 2),
        wasteRate: total > 0 ? round(data.wastedMl / total, 3) : 0,
        stockMl: materialStock[mat] !== undefined ? round(materialStock[mat], 2) : null
      };
    });

    return summary;
  }

  /**
   * Generate a text report of printer health.
   * @returns {string} Multi-line text report.
   */
  function generateReport() {
    var health = getHealth();
    var lines = [];
    lines.push('╔══════════════════════════════════════╗');
    lines.push('║    PRINT HEALTH DASHBOARD REPORT     ║');
    lines.push('╚══════════════════════════════════════╝');
    lines.push('');
    lines.push('Overall Score: ' + health.overallScore + '/100 (' + health.grade + ' — ' + health.gradeLabel + ')');
    lines.push('Generated: ' + health.timestamp.toISOString());
    lines.push('');

    lines.push('── Dimension Scores ──');
    var dimLabels = {
      printSuccess: 'Print Success',
      parameterDrift: 'Parameter Drift',
      maintenance: 'Maintenance',
      materialHealth: 'Material Health',
      contamination: 'Contamination',
      calibration: 'Calibration'
    };
    Object.keys(health.dimensions).forEach(function(dim) {
      var d = health.dimensions[dim];
      var bar = _scoreBar(d.score);
      lines.push('  ' + (dimLabels[dim] || dim).padEnd(18) + bar + ' ' + d.score);
    });

    if (health.alerts.length > 0) {
      lines.push('');
      lines.push('── Alerts (' + health.alerts.length + ') ──');
      health.alerts.forEach(function(a) {
        var icon = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵';
        lines.push('  ' + icon + ' [' + a.severity.toUpperCase() + '] ' + a.message);
      });
    }

    lines.push('');
    lines.push('── Stats ──');
    lines.push('  Total prints: ' + health.stats.totalPrints);
    if (health.stats.successRate !== null) {
      lines.push('  Success rate: ' + round(health.stats.successRate * 100, 1) + '%');
    }
    lines.push('  Material used: ' + health.stats.totalMaterialUsedMl + ' ml');
    lines.push('  Material wasted: ' + health.stats.totalMaterialWastedMl + ' ml');
    lines.push('  Contamination events: ' + health.stats.contaminationEvents);
    lines.push('  Calibration events: ' + health.stats.calibrationEvents);

    return lines.join('\n');
  }

  /**
   * Clear all logged data (for testing or reset).
   */
  function reset() {
    prints.length = 0;
    maintenanceLogs.length = 0;
    materialLogs.length = 0;
    contaminationEvents.length = 0;
    calibrationLogs.length = 0;
    healthSnapshots.length = 0;
    Object.keys(materialStock).forEach(function(k) { delete materialStock[k]; });
  }

  // ── Helpers ─────────────────────────────────────────────────

  function _parseDate(d) {
    if (!d) return null;
    if (d instanceof Date) return d;
    var parsed = new Date(d);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function _scoreBar(score) {
    var filled = Math.round(score / 5);
    var empty = 20 - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  }

  // ── Public API ──────────────────────────────────────────────

  return {
    // Logging
    logPrint: logPrint,
    logMaintenance: logMaintenance,
    logMaterialUse: logMaterialUse,
    setMaterialStock: setMaterialStock,
    logContamination: logContamination,
    logCalibration: logCalibration,

    // Health scoring
    getHealth: getHealth,
    takeSnapshot: takeSnapshot,
    getSnapshots: getSnapshots,
    getHealthTrend: getHealthTrend,

    // Analytics
    getFailureAnalysis: getFailureAnalysis,
    getMaterialSummary: getMaterialSummary,

    // Reporting
    generateReport: generateReport,

    // Utility
    reset: reset
  };
}

// ── Exports ─────────────────────────────────────────────────────

module.exports = { createHealthDashboard: createHealthDashboard };
