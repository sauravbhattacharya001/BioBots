'use strict';

/**
 * Lab Digital Twin
 *
 * Autonomous simulation of the lab environment that tracks equipment state,
 * reagent levels, and environmental conditions over time.  Predicts failures,
 * reagent depletion, and environmental drift, then recommends optimal actions.
 *
 * Agentic capabilities:
 *  - Proactively predicts equipment maintenance windows
 *  - Autonomously forecasts reagent depletion dates
 *  - Detects environmental anomalies via z-score analysis
 *  - Generates prioritised action timelines
 *  - Computes composite lab health score
 *
 * @example
 *   var twin = createLabDigitalTwin();
 *   twin.registerEquipment({ id:'P1', name:'Printer-1', type:'bioprinter',
 *       installDate:'2025-01-15', maintenanceIntervalDays:90, usageHoursPerDay:6 });
 *   twin.registerReagent({ id:'R1', name:'Alginate 2%', lotNumber:'LOT-A1',
 *       expiryDate:'2026-06-01', currentVolumeMl:500, reorderThresholdMl:100 });
 *   twin.recordEquipmentUsage('P1', 4, 'scaffold print');
 *   twin.recordReagentUsage('R1', 25, 'scaffold print');
 *   var sim = twin.simulate(30);
 *   var health = twin.getHealthScore();
 */

// ── Helpers ─────────────────────────────────────────────────────────
// Delegate to shared stats module instead of maintaining local copies
// of mean, stddev, and linear regression.

var _stats = require('./stats');
var mean = _stats.mean;
var stddev = _stats.stddev;
var linReg = _stats.linearRegression;

var _sanitize = require('./sanitize');

function daysBetween(a, b) {
    return (new Date(b) - new Date(a)) / 86400000;
}

function addDays(dateStr, days) {
    var d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

function zScore(value, m, sd) {
    return sd > 0 ? Math.abs(value - m) / sd : 0;
}

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

// ── Factory ─────────────────────────────────────────────────────────

function createLabDigitalTwin() {
    var equipment = {};       // id -> equipment record
    var reagents = {};        // id -> reagent record
    var envReadings = [];     // array of readings
    var equipUsageLog = [];   // { equipmentId, hours, notes, timestamp }
    var reagentUsageLog = []; // { reagentId, volumeMl, purpose, timestamp }
    // Pre-indexed reagent usage entries keyed by reagentId.
    // Eliminates O(total_log) .filter() in reagentDepletion() —
    // simulate() and getTimeline() call it once per reagent, turning
    // O(R × L) aggregate filtering into O(L) total lookups.
    var _reagentUsageByReagent = {};  // reagentId -> [usage entries]

    function registerEquipment(eq) {
        if (!eq || !eq.id) throw new Error('Equipment must have an id');
        if (_sanitize.isDangerousKey(eq.id)) throw new Error('Invalid equipment id');
        equipment[eq.id] = {
            id: eq.id,
            name: eq.name || eq.id,
            type: eq.type || 'unknown',
            installDate: eq.installDate || todayStr(),
            maintenanceIntervalDays: eq.maintenanceIntervalDays || 90,
            usageHoursPerDay: eq.usageHoursPerDay || 8,
            lastMaintenanceDate: eq.lastMaintenanceDate || eq.installDate || todayStr(),
            totalUsageHours: eq.totalUsageHours || 0
        };
        return equipment[eq.id];
    }

    function registerReagent(r) {
        if (!r || !r.id) throw new Error('Reagent must have an id');
        if (_sanitize.isDangerousKey(r.id)) throw new Error('Invalid reagent id');
        reagents[r.id] = {
            id: r.id,
            name: r.name || r.id,
            lotNumber: r.lotNumber || '',
            expiryDate: r.expiryDate || addDays(todayStr(), 180),
            currentVolumeMl: r.currentVolumeMl != null ? r.currentVolumeMl : 1000,
            reorderThresholdMl: r.reorderThresholdMl != null ? r.reorderThresholdMl : 100,
            initialVolumeMl: r.currentVolumeMl != null ? r.currentVolumeMl : 1000
        };
        return reagents[r.id];
    }

    function recordEnvironmentalReading(reading) {
        envReadings.push({
            timestamp: reading.timestamp || new Date().toISOString(),
            temperatureC: reading.temperatureC != null ? reading.temperatureC : 22,
            humidityPct: reading.humidityPct != null ? reading.humidityPct : 45,
            co2Pct: reading.co2Pct != null ? reading.co2Pct : 5,
            particleCount: reading.particleCount != null ? reading.particleCount : 100
        });
        return envReadings[envReadings.length - 1];
    }

    function recordEquipmentUsage(equipmentId, hours, notes) {
        if (!equipment[equipmentId]) throw new Error('Unknown equipment: ' + equipmentId);
        var entry = {
            equipmentId: equipmentId,
            hours: hours,
            notes: notes || '',
            timestamp: new Date().toISOString()
        };
        equipUsageLog.push(entry);
        equipment[equipmentId].totalUsageHours += hours;
        return entry;
    }

    function recordReagentUsage(reagentId, volumeMl, purpose) {
        if (!reagents[reagentId]) throw new Error('Unknown reagent: ' + reagentId);
        var entry = {
            reagentId: reagentId,
            volumeMl: volumeMl,
            purpose: purpose || '',
            timestamp: new Date().toISOString()
        };
        reagentUsageLog.push(entry);
        if (!_reagentUsageByReagent[reagentId]) _reagentUsageByReagent[reagentId] = [];
        _reagentUsageByReagent[reagentId].push(entry);
        reagents[reagentId].currentVolumeMl = Math.max(0, reagents[reagentId].currentVolumeMl - volumeMl);
        return entry;
    }

    // ── Equipment failure risk ──────────────────────────────────────

    function equipmentRisk(eqId, daysAhead) {
        var eq = equipment[eqId];
        if (!eq) return null;
        var today = todayStr();
        var daysSinceMaint = daysBetween(eq.lastMaintenanceDate, today) + daysAhead;
        var interval = eq.maintenanceIntervalDays;
        // Exponential risk model
        var baseRisk = 1 - Math.exp(-daysSinceMaint / interval);
        // Usage-based modifier: higher usage = higher risk
        var expectedHours = eq.usageHoursPerDay * daysSinceMaint;
        var actualHours = eq.totalUsageHours + (eq.usageHoursPerDay * daysAhead);
        var usageFactor = expectedHours > 0 ? actualHours / expectedHours : 1;
        var risk = Math.min(1, baseRisk * Math.max(1, usageFactor));
        var maintenanceDueIn = Math.max(0, interval - daysBetween(eq.lastMaintenanceDate, today));
        return {
            equipmentId: eqId,
            name: eq.name,
            risk: Math.round(risk * 1000) / 1000,
            daysSinceLastMaintenance: Math.round(daysBetween(eq.lastMaintenanceDate, today)),
            maintenanceDueInDays: Math.round(maintenanceDueIn),
            totalUsageHours: Math.round(eq.totalUsageHours),
            overdue: daysBetween(eq.lastMaintenanceDate, today) > interval
        };
    }

    // ── Reagent depletion prediction ────────────────────────────────

    function reagentDepletion(rId, daysAhead) {
        var r = reagents[rId];
        if (!r) return null;
        // Look up pre-indexed usage entries — O(1) vs O(L) full-log scan
        var usages = _reagentUsageByReagent[rId] || [];
        var dailyRate;
        if (usages.length >= 2) {
            var days = [];
            var cumVol = [];
            var cum = 0;
            for (var i = 0; i < usages.length; i++) {
                cum += usages[i].volumeMl;
                days.push(daysBetween(usages[0].timestamp, usages[i].timestamp) || (i * 0.1));
                cumVol.push(cum);
            }
            var reg = linReg(days, cumVol);
            dailyRate = Math.max(0, reg.slope);
        } else if (usages.length === 1) {
            dailyRate = usages[0].volumeMl; // assume 1 day
        } else {
            dailyRate = 0;
        }
        var daysToDepletion = dailyRate > 0 ? r.currentVolumeMl / dailyRate : Infinity;
        var daysToReorder = dailyRate > 0 ? Math.max(0, (r.currentVolumeMl - r.reorderThresholdMl) / dailyRate) : Infinity;
        var daysToExpiry = daysBetween(todayStr(), r.expiryDate);
        var depletionDate = daysToDepletion < Infinity ? addDays(todayStr(), Math.round(daysToDepletion)) : null;
        var depletesDuringWindow = daysToDepletion <= daysAhead;
        return {
            reagentId: rId,
            name: r.name,
            currentVolumeMl: Math.round(r.currentVolumeMl * 10) / 10,
            dailyConsumptionMl: Math.round(dailyRate * 100) / 100,
            estimatedDepletionDate: depletionDate,
            daysToDepletion: daysToDepletion < Infinity ? Math.round(daysToDepletion) : null,
            daysToReorderThreshold: daysToReorder < Infinity ? Math.round(daysToReorder) : null,
            daysToExpiry: Math.round(daysToExpiry),
            depletesDuringWindow: depletesDuringWindow,
            expiresDuringWindow: daysToExpiry <= daysAhead,
            belowReorderThreshold: r.currentVolumeMl <= r.reorderThresholdMl
        };
    }

    // ── Environmental drift ─────────────────────────────────────────

    function environmentalDrift(daysAhead) {
        if (envReadings.length < 2) return [];
        var metrics = ['temperatureC', 'humidityPct', 'co2Pct', 'particleCount'];
        var drifts = [];
        for (var m = 0; m < metrics.length; m++) {
            var key = metrics[m];
            var xs = [];
            var ys = [];
            for (var i = 0; i < envReadings.length; i++) {
                xs.push(daysBetween(envReadings[0].timestamp, envReadings[i].timestamp) || (i * 0.1));
                ys.push(envReadings[i][key]);
            }
            var reg = linReg(xs, ys);
            var currentVal = ys[ys.length - 1];
            var predictedVal = reg.slope * (xs[xs.length - 1] + daysAhead) + reg.intercept;
            var sd = stddev(ys);
            var driftMagnitude = Math.abs(predictedVal - currentVal);
            if (sd > 0 && driftMagnitude / sd > 0.5) {
                drifts.push({
                    metric: key,
                    currentValue: Math.round(currentVal * 100) / 100,
                    predictedValue: Math.round(predictedVal * 100) / 100,
                    trend: reg.slope > 0 ? 'increasing' : 'decreasing',
                    slopePerDay: Math.round(reg.slope * 1000) / 1000,
                    r2: Math.round(reg.r2 * 1000) / 1000,
                    significance: driftMagnitude / sd > 2 ? 'high' : driftMagnitude / sd > 1 ? 'medium' : 'low'
                });
            }
        }
        return drifts;
    }

    // ── Anomaly detection ───────────────────────────────────────────

    function detectAnomalies() {
        var n = envReadings.length;
        if (n < 5) return [];
        var metrics = ['temperatureC', 'humidityPct', 'co2Pct', 'particleCount'];
        var mLen = metrics.length;

        // Single pass over envReadings to compute sum and sumSq for all
        // 4 metrics simultaneously — replaces 4× .map() + 4× mean() +
        // 4× stddev() (12 passes) with 1 pass.
        var sums = new Array(mLen);
        var sumSqs = new Array(mLen);
        for (var mi = 0; mi < mLen; mi++) { sums[mi] = 0; sumSqs[mi] = 0; }

        for (var ri = 0; ri < n; ri++) {
            var reading = envReadings[ri];
            for (var k = 0; k < mLen; k++) {
                var v = reading[metrics[k]];
                sums[k] += v;
                sumSqs[k] += v * v;
            }
        }

        var alerts = [];
        var start = Math.max(0, n - 3);
        for (var m = 0; m < mLen; m++) {
            var mu = sums[m] / n;
            var variance = sumSqs[m] / n - mu * mu;
            var sd = variance > 0 ? Math.sqrt(variance) : 0;
            for (var i = start; i < n; i++) {
                var val = envReadings[i][metrics[m]];
                var z = zScore(val, mu, sd);
                if (z > 2.0) {
                    alerts.push({
                        metric: metrics[m],
                        value: val,
                        mean: Math.round(mu * 100) / 100,
                        stddev: Math.round(sd * 100) / 100,
                        zScore: Math.round(z * 100) / 100,
                        severity: z > 3 ? 'critical' : 'warning',
                        timestamp: envReadings[i].timestamp
                    });
                }
            }
        }
        return alerts;
    }

    // ── Health score ────────────────────────────────────────────────

    function getHealthScore() {
        // Equipment health (40%)
        var eqIds = Object.keys(equipment);
        var eqScore = 100;
        if (eqIds.length > 0) {
            var risks = eqIds.map(function(id) { return equipmentRisk(id, 0).risk; });
            eqScore = Math.round((1 - mean(risks)) * 100);
        }
        // Reagent health (35%)
        var rIds = Object.keys(reagents);
        var rgScore = 100;
        if (rIds.length > 0) {
            var depleted = 0;
            var belowThreshold = 0;
            for (var i = 0; i < rIds.length; i++) {
                var r = reagents[rIds[i]];
                if (r.currentVolumeMl <= 0) depleted++;
                else if (r.currentVolumeMl <= r.reorderThresholdMl) belowThreshold++;
            }
            rgScore = Math.round(((rIds.length - depleted - belowThreshold * 0.5) / rIds.length) * 100);
        }
        // Environment health (25%)
        var envScore = 100;
        var anomalies = detectAnomalies();
        if (anomalies.length > 0) {
            var criticals = 0;
            var warnings = 0;
            for (var ai = 0; ai < anomalies.length; ai++) {
                if (anomalies[ai].severity === 'critical') criticals++;
                else if (anomalies[ai].severity === 'warning') warnings++;
            }
            envScore = Math.max(0, 100 - criticals * 25 - warnings * 10);
        }
        var composite = Math.round(eqScore * 0.4 + rgScore * 0.35 + envScore * 0.25);
        return {
            overall: composite,
            equipment: eqScore,
            reagents: rgScore,
            environment: envScore,
            grade: composite >= 90 ? 'A' : composite >= 75 ? 'B' : composite >= 60 ? 'C' : composite >= 40 ? 'D' : 'F',
            equipmentCount: eqIds.length,
            reagentCount: rIds.length,
            readingCount: envReadings.length,
            anomalyCount: anomalies.length
        };
    }

    // ── Simulate ────────────────────────────────────────────────────

    function simulate(daysAhead) {
        daysAhead = daysAhead || 30;
        var eqIds = Object.keys(equipment);
        var rIds = Object.keys(reagents);

        var equipmentFailureRisks = eqIds.map(function(id) { return equipmentRisk(id, daysAhead); })
            .sort(function(a, b) { return b.risk - a.risk; });
        var reagentDepletions = rIds.map(function(id) { return reagentDepletion(id, daysAhead); })
            .sort(function(a, b) {
                var da = a.daysToDepletion != null ? a.daysToDepletion : 9999;
                var db = b.daysToDepletion != null ? b.daysToDepletion : 9999;
                return da - db;
            });
        var environmentalDrifts = environmentalDrift(daysAhead);
        var recommendations = [];

        // Equipment recommendations
        for (var i = 0; i < equipmentFailureRisks.length; i++) {
            var er = equipmentFailureRisks[i];
            if (er.overdue) {
                recommendations.push({
                    priority: 'critical',
                    category: 'equipment',
                    message: er.name + ' is OVERDUE for maintenance (' + er.daysSinceLastMaintenance + ' days since last service). Schedule immediately.',
                    targetId: er.equipmentId
                });
            } else if (er.risk > 0.7) {
                recommendations.push({
                    priority: 'high',
                    category: 'equipment',
                    message: 'Schedule maintenance for ' + er.name + ' within ' + er.maintenanceDueInDays + ' days (risk: ' + Math.round(er.risk * 100) + '%).',
                    targetId: er.equipmentId
                });
            } else if (er.risk > 0.4) {
                recommendations.push({
                    priority: 'medium',
                    category: 'equipment',
                    message: 'Plan maintenance for ' + er.name + ' in the next ' + er.maintenanceDueInDays + ' days.',
                    targetId: er.equipmentId
                });
            }
        }

        // Reagent recommendations
        for (var j = 0; j < reagentDepletions.length; j++) {
            var rd = reagentDepletions[j];
            if (rd.depletesDuringWindow) {
                recommendations.push({
                    priority: 'critical',
                    category: 'reagent',
                    message: rd.name + ' will be depleted in ~' + (rd.daysToDepletion || 0) + ' days. Order now.',
                    targetId: rd.reagentId
                });
            } else if (rd.belowReorderThreshold) {
                recommendations.push({
                    priority: 'high',
                    category: 'reagent',
                    message: rd.name + ' is below reorder threshold (' + rd.currentVolumeMl + ' mL remaining). Place order.',
                    targetId: rd.reagentId
                });
            } else if (rd.expiresDuringWindow) {
                recommendations.push({
                    priority: 'high',
                    category: 'reagent',
                    message: rd.name + ' expires in ' + rd.daysToExpiry + ' days. Plan usage or replacement.',
                    targetId: rd.reagentId
                });
            } else if (rd.daysToReorderThreshold != null && rd.daysToReorderThreshold <= daysAhead) {
                recommendations.push({
                    priority: 'medium',
                    category: 'reagent',
                    message: rd.name + ' will hit reorder threshold in ~' + rd.daysToReorderThreshold + ' days. Consider ordering.',
                    targetId: rd.reagentId
                });
            }
        }

        // Environmental recommendations
        for (var k = 0; k < environmentalDrifts.length; k++) {
            var ed = environmentalDrifts[k];
            if (ed.significance === 'high') {
                recommendations.push({
                    priority: 'high',
                    category: 'environment',
                    message: ed.metric + ' is ' + ed.trend + ' significantly (predicted: ' + ed.predictedValue + ' in ' + daysAhead + ' days). Investigate HVAC/controls.',
                    targetId: ed.metric
                });
            } else if (ed.significance === 'medium') {
                recommendations.push({
                    priority: 'medium',
                    category: 'environment',
                    message: ed.metric + ' shows ' + ed.trend + ' trend (slope: ' + ed.slopePerDay + '/day). Monitor closely.',
                    targetId: ed.metric
                });
            }
        }

        // Sort recommendations by priority
        var priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        recommendations.sort(function(a, b) {
            return (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99);
        });

        return {
            simulationDays: daysAhead,
            simulatedAt: new Date().toISOString(),
            healthScore: getHealthScore(),
            equipmentFailureRisks: equipmentFailureRisks,
            reagentDepletions: reagentDepletions,
            environmentalDrifts: environmentalDrifts,
            recommendations: recommendations
        };
    }

    // ── Timeline ────────────────────────────────────────────────────

    function getTimeline(days) {
        days = days || 30;
        var events = [];
        var eqIds = Object.keys(equipment);
        var rIds = Object.keys(reagents);

        for (var i = 0; i < eqIds.length; i++) {
            var er = equipmentRisk(eqIds[i], 0);
            if (er.maintenanceDueInDays <= days) {
                events.push({
                    date: addDays(todayStr(), er.maintenanceDueInDays),
                    daysFromNow: er.maintenanceDueInDays,
                    type: 'maintenance',
                    severity: er.overdue ? 'critical' : er.risk > 0.7 ? 'high' : 'medium',
                    description: er.name + ' maintenance due'
                });
            }
        }

        for (var j = 0; j < rIds.length; j++) {
            var rd = reagentDepletion(rIds[j], days);
            if (rd.daysToDepletion != null && rd.daysToDepletion <= days) {
                events.push({
                    date: rd.estimatedDepletionDate,
                    daysFromNow: rd.daysToDepletion,
                    type: 'depletion',
                    severity: 'critical',
                    description: rd.name + ' depletion'
                });
            }
            if (rd.daysToReorderThreshold != null && rd.daysToReorderThreshold <= days) {
                events.push({
                    date: addDays(todayStr(), rd.daysToReorderThreshold),
                    daysFromNow: rd.daysToReorderThreshold,
                    type: 'reorder',
                    severity: 'high',
                    description: rd.name + ' hits reorder threshold'
                });
            }
            if (rd.daysToExpiry <= days) {
                events.push({
                    date: reagents[rIds[j]].expiryDate,
                    daysFromNow: rd.daysToExpiry,
                    type: 'expiry',
                    severity: rd.daysToExpiry <= 7 ? 'critical' : 'high',
                    description: rd.name + ' expiry'
                });
            }
        }

        events.sort(function(a, b) { return a.daysFromNow - b.daysFromNow; });
        return events;
    }

    // ── Export ───────────────────────────────────────────────────────

    function exportState(format) {
        var state = {
            equipment: equipment,
            reagents: reagents,
            environmentalReadings: envReadings,
            equipmentUsageLog: equipUsageLog,
            reagentUsageLog: reagentUsageLog,
            healthScore: getHealthScore(),
            exportedAt: new Date().toISOString()
        };
        if (format === 'text') {
            var lines = ['=== Lab Digital Twin State ==='];
            lines.push('Exported: ' + state.exportedAt);
            lines.push('Health: ' + state.healthScore.overall + '/100 (' + state.healthScore.grade + ')');
            lines.push('');
            lines.push('Equipment (' + Object.keys(equipment).length + '):');
            Object.keys(equipment).forEach(function(id) {
                var e = equipment[id];
                lines.push('  ' + e.name + ' [' + e.type + '] - ' + e.totalUsageHours + 'h total');
            });
            lines.push('');
            lines.push('Reagents (' + Object.keys(reagents).length + '):');
            Object.keys(reagents).forEach(function(id) {
                var r = reagents[id];
                lines.push('  ' + r.name + ' - ' + Math.round(r.currentVolumeMl) + 'mL remaining');
            });
            return lines.join('\n');
        }
        return JSON.parse(JSON.stringify(state));
    }

    return {
        registerEquipment: registerEquipment,
        registerReagent: registerReagent,
        recordEnvironmentalReading: recordEnvironmentalReading,
        recordEquipmentUsage: recordEquipmentUsage,
        recordReagentUsage: recordReagentUsage,
        simulate: simulate,
        getHealthScore: getHealthScore,
        detectAnomalies: detectAnomalies,
        getTimeline: getTimeline,
        exportState: exportState
    };
}

// ── Demo Scenarios ──────────────────────────────────────────────────

createLabDigitalTwin.DEMO_SCENARIOS = {
    /** Standard research lab with moderate equipment and reagents. */
    standard: function() {
        var twin = createLabDigitalTwin();
        twin.registerEquipment({ id: 'BP-1', name: 'BioBot-1', type: 'bioprinter', installDate: '2025-06-01', maintenanceIntervalDays: 90, usageHoursPerDay: 6 });
        twin.registerEquipment({ id: 'BP-2', name: 'BioBot-2', type: 'bioprinter', installDate: '2025-09-15', maintenanceIntervalDays: 90, usageHoursPerDay: 4 });
        twin.registerEquipment({ id: 'INC-1', name: 'Incubator-A', type: 'incubator', installDate: '2024-01-10', maintenanceIntervalDays: 180, usageHoursPerDay: 24 });
        twin.registerReagent({ id: 'ALG', name: 'Alginate 2%', lotNumber: 'LOT-2026-A1', expiryDate: '2026-08-15', currentVolumeMl: 450, reorderThresholdMl: 100 });
        twin.registerReagent({ id: 'GEL', name: 'Gelatin 5%', lotNumber: 'LOT-2026-G3', expiryDate: '2026-06-01', currentVolumeMl: 200, reorderThresholdMl: 80 });
        twin.registerReagent({ id: 'COL', name: 'Collagen Type I', lotNumber: 'LOT-2025-C7', expiryDate: '2026-05-10', currentVolumeMl: 120, reorderThresholdMl: 50 });
        for (var d = 0; d < 14; d++) {
            var ts = new Date(Date.now() - (14 - d) * 86400000).toISOString();
            twin.recordEnvironmentalReading({ timestamp: ts, temperatureC: 22 + Math.random() * 0.8 - 0.4, humidityPct: 45 + Math.random() * 4 - 2, co2Pct: 5 + Math.random() * 0.2 - 0.1, particleCount: 90 + Math.floor(Math.random() * 30) });
        }
        return twin;
    },
    /** High-throughput production lab under heavy load. */
    highThroughput: function() {
        var twin = createLabDigitalTwin();
        twin.registerEquipment({ id: 'BP-1', name: 'Production-1', type: 'bioprinter', installDate: '2025-01-10', maintenanceIntervalDays: 60, usageHoursPerDay: 16, lastMaintenanceDate: '2026-02-01', totalUsageHours: 2400 });
        twin.registerEquipment({ id: 'BP-2', name: 'Production-2', type: 'bioprinter', installDate: '2025-03-20', maintenanceIntervalDays: 60, usageHoursPerDay: 16, lastMaintenanceDate: '2026-03-15', totalUsageHours: 1800 });
        twin.registerEquipment({ id: 'BP-3', name: 'Production-3', type: 'bioprinter', installDate: '2025-06-01', maintenanceIntervalDays: 60, usageHoursPerDay: 12, lastMaintenanceDate: '2026-04-01', totalUsageHours: 900 });
        twin.registerReagent({ id: 'ALG', name: 'Alginate Bulk', lotNumber: 'BULK-A', expiryDate: '2026-07-01', currentVolumeMl: 150, reorderThresholdMl: 200 });
        twin.registerReagent({ id: 'GEL', name: 'Gelatin Bulk', lotNumber: 'BULK-G', expiryDate: '2026-09-01', currentVolumeMl: 80, reorderThresholdMl: 150 });
        return twin;
    },
    /** New startup lab with minimal history. */
    startup: function() {
        var twin = createLabDigitalTwin();
        twin.registerEquipment({ id: 'BP-1', name: 'First Printer', type: 'bioprinter', installDate: '2026-04-01', maintenanceIntervalDays: 90, usageHoursPerDay: 4 });
        twin.registerReagent({ id: 'KIT', name: 'Starter Kit Bioink', lotNumber: 'STARTER-1', expiryDate: '2026-10-01', currentVolumeMl: 100, reorderThresholdMl: 20 });
        twin.recordEnvironmentalReading({ temperatureC: 23, humidityPct: 50, co2Pct: 5, particleCount: 150 });
        return twin;
    }
};

module.exports = { createLabDigitalTwin: createLabDigitalTwin };
