'use strict';

var round = require('./validation').round;
var _isDangerousKey = require('./sanitize').isDangerousKey;

/**
 * Predictive Maintenance Engine
 *
 * Autonomous equipment health monitoring and failure prediction system
 * for bioprinting labs. Tracks equipment usage, detects wear patterns,
 * estimates failure probability using Weibull reliability modeling, and
 * optimizes maintenance scheduling to minimize unplanned downtime.
 *
 * Agentic capabilities:
 * - Self-monitoring: continuously ingests usage telemetry and updates wear models
 * - Proactive detection: identifies degradation before failures occur
 * - Predictive modeling: Weibull reliability estimation with time-horizon forecasts
 * - Autonomous scheduling: generates optimized maintenance windows by urgency
 * - Anomaly detection: z-score flagging of vibration/temperature/error spikes
 * - Fleet awareness: aggregate health scoring across all registered equipment
 *
 * @example
 *   var pm = createPredictiveMaintenance();
 *   pm.registerEquipment({ id: 'ph-01', name: 'Printhead Alpha', category: 'printhead',
 *     installDate: '2025-01-15', expectedLifeHours: 5000, maintenanceIntervalHours: 500,
 *     criticality: 'critical' });
 *   pm.recordUsage({ equipmentId: 'ph-01', hours: 8, temperature: 37.2, vibration: 0.12, errorCount: 0 });
 *   var prediction = pm.predictFailure('ph-01');
 *   // prediction.riskLevel => 'minimal' | 'low' | 'moderate' | 'high' | 'critical'
 *   var schedule = pm.optimizeSchedule();
 *   // schedule => [{ equipmentId: 'ph-01', urgencyScore: 72, ... }]
 *   var dashboard = pm.getDashboard();
 *   // dashboard.fleetHealthScore => 85
 */

// ── Constants ──────────────────────────────────────────────────────

var VALID_CATEGORIES = ['printhead', 'pump', 'stage', 'uv_source', 'temperature_controller', 'pressure_system'];
var VALID_CRITICALITIES = ['critical', 'high', 'medium', 'low'];
var CRITICALITY_WEIGHTS = { critical: 1.0, high: 0.75, medium: 0.5, low: 0.25 };

var RISK_THRESHOLDS = [
    { max: 0.05, level: 'minimal',  color: '#22c55e' },
    { max: 0.15, level: 'low',      color: '#84cc16' },
    { max: 0.35, level: 'moderate', color: '#eab308' },
    { max: 0.60, level: 'high',     color: '#f97316' },
    { max: 1.00, level: 'critical', color: '#ef4444' }
];

var ANOMALY_TYPES = {
    VIBRATION_SPIKE:    'vibration_spike',
    TEMPERATURE_DRIFT:  'temperature_drift',
    ERROR_BURST:        'error_burst',
    WEAR_ACCELERATION:  'wear_acceleration'
};

var WEIBULL_BETA = 2.5; // Shape parameter (wear-out failure mode)
var ANOMALY_WINDOW = 20;
var ANOMALY_THRESHOLD = 2.0; // σ

// ── Helpers ────────────────────────────────────────────────────────

function _now() {
    return Date.now();
}

function _daysBetween(d1, d2) {
    var ms = Math.abs(new Date(d2).getTime() - new Date(d1).getTime());
    return ms / (1000 * 60 * 60 * 24);
}

function _mean(arr) {
    if (!arr || arr.length === 0) return 0;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
}

function _stddev(arr) {
    if (!arr || arr.length < 2) return 0;
    var m = _mean(arr);
    var sumSq = 0;
    for (var i = 0; i < arr.length; i++) {
        var diff = arr[i] - m;
        sumSq += diff * diff;
    }
    return Math.sqrt(sumSq / (arr.length - 1));
}

function _linearRegression(values) {
    var n = values.length;
    if (n < 2) return { slope: 0, intercept: values[0] || 0 };
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
        sumX += i;
        sumY += values[i];
        sumXY += i * values[i];
        sumX2 += i * i;
    }
    var denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return { slope: 0, intercept: _mean(values) };
    var slope = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;
    return { slope: slope, intercept: intercept };
}

function _weibullReliability(t, eta, beta) {
    if (t <= 0) return 1.0;
    return Math.exp(-Math.pow(t / eta, beta));
}

function _weibullFailureProbability(t, eta, beta) {
    return 1.0 - _weibullReliability(t, eta, beta);
}

function _classifyRisk(probability) {
    for (var i = 0; i < RISK_THRESHOLDS.length; i++) {
        if (probability <= RISK_THRESHOLDS[i].max) {
            return { level: RISK_THRESHOLDS[i].level, color: RISK_THRESHOLDS[i].color };
        }
    }
    return { level: 'critical', color: '#ef4444' };
}

// ── Factory ────────────────────────────────────────────────────────

function createPredictiveMaintenance() {
    var equipment = {};     // id → equipment record
    var usageHistory = {};  // id → [usage events]

    // ── Equipment Registration ─────────────────────────────────────

    function registerEquipment(opts) {
        if (!opts || typeof opts !== 'object') {
            return { success: false, error: 'Options object required' };
        }
        var id = opts.id;
        if (!id || typeof id !== 'string') {
            return { success: false, error: 'Equipment id is required (string)' };
        }
        if (_isDangerousKey(id)) {
            return { success: false, error: 'Invalid equipment id' };
        }
        if (equipment[id]) {
            return { success: false, error: 'Equipment already registered: ' + id };
        }
        var name = opts.name || id;
        var category = opts.category;
        if (VALID_CATEGORIES.indexOf(category) === -1) {
            return { success: false, error: 'Invalid category. Must be one of: ' + VALID_CATEGORIES.join(', ') };
        }
        var criticality = opts.criticality || 'medium';
        if (VALID_CRITICALITIES.indexOf(criticality) === -1) {
            return { success: false, error: 'Invalid criticality. Must be one of: ' + VALID_CRITICALITIES.join(', ') };
        }
        var expectedLifeHours = Number(opts.expectedLifeHours);
        if (!expectedLifeHours || expectedLifeHours <= 0) {
            return { success: false, error: 'expectedLifeHours must be a positive number' };
        }
        var maintenanceIntervalHours = Number(opts.maintenanceIntervalHours) || 500;
        var installDate = opts.installDate || new Date().toISOString().slice(0, 10);

        equipment[id] = {
            id: id,
            name: name,
            category: category,
            criticality: criticality,
            installDate: installDate,
            expectedLifeHours: expectedLifeHours,
            maintenanceIntervalHours: maintenanceIntervalHours,
            totalOperatingHours: 0,
            hoursSinceLastMaintenance: 0,
            lastMaintenanceDate: null,
            registeredAt: _now()
        };
        usageHistory[id] = [];

        return { success: true, equipment: equipment[id] };
    }

    // ── Usage Recording ────────────────────────────────────────────

    function recordUsage(opts) {
        if (!opts || typeof opts !== 'object') {
            return { success: false, error: 'Options object required' };
        }
        var eqId = opts.equipmentId;
        if (!eqId || typeof eqId !== 'string') {
            return { success: false, error: 'equipmentId is required' };
        }
        if (_isDangerousKey(eqId)) {
            return { success: false, error: 'Invalid equipmentId' };
        }
        if (!equipment[eqId]) {
            return { success: false, error: 'Equipment not found: ' + eqId };
        }
        var hours = Number(opts.hours);
        if (!hours || hours <= 0) {
            return { success: false, error: 'hours must be a positive number' };
        }
        var temperature = opts.temperature != null ? Number(opts.temperature) : null;
        var vibration = opts.vibration != null ? Number(opts.vibration) : null;
        var errorCount = opts.errorCount != null ? Math.max(0, Math.floor(Number(opts.errorCount))) : 0;
        var notes = opts.notes || '';

        var event = {
            timestamp: _now(),
            hours: hours,
            temperature: temperature,
            vibration: vibration,
            errorCount: errorCount,
            notes: notes
        };

        usageHistory[eqId].push(event);
        equipment[eqId].totalOperatingHours += hours;
        equipment[eqId].hoursSinceLastMaintenance += hours;

        return { success: true, event: event, totalHours: equipment[eqId].totalOperatingHours };
    }

    // ── Record Maintenance ─────────────────────────────────────────

    function recordMaintenance(equipmentId) {
        if (!equipmentId || _isDangerousKey(equipmentId)) {
            return { success: false, error: 'Invalid equipmentId' };
        }
        if (!equipment[equipmentId]) {
            return { success: false, error: 'Equipment not found: ' + equipmentId };
        }
        equipment[equipmentId].hoursSinceLastMaintenance = 0;
        equipment[equipmentId].lastMaintenanceDate = new Date().toISOString().slice(0, 10);
        return { success: true };
    }

    // ── Wear Analysis ──────────────────────────────────────────────

    function analyzeWear(equipmentId) {
        if (!equipmentId || _isDangerousKey(equipmentId)) {
            return { success: false, error: 'Invalid equipmentId' };
        }
        if (!equipment[equipmentId]) {
            return { success: false, error: 'Equipment not found: ' + equipmentId };
        }
        var eq = equipment[equipmentId];
        var history = usageHistory[equipmentId];

        if (history.length === 0) {
            return {
                success: true,
                equipmentId: equipmentId,
                wearRate: 0,
                wearAcceleration: false,
                vibrationTrend: { slope: 0, direction: 'stable' },
                temperatureDrift: { slope: 0, direction: 'stable' },
                errorTrend: { slope: 0, direction: 'stable' },
                lifeConsumed: 0,
                remainingLife: eq.expectedLifeHours
            };
        }

        // Compute wear rate (hours per event, trend)
        var hourValues = [];
        for (var i = 0; i < history.length; i++) hourValues.push(history[i].hours);
        var wearReg = _linearRegression(hourValues);
        var wearAcceleration = wearReg.slope > 0.1;

        // Vibration trend
        var vibValues = [];
        for (var v = 0; v < history.length; v++) {
            if (history[v].vibration != null) vibValues.push(history[v].vibration);
        }
        var vibReg = _linearRegression(vibValues);
        var vibDirection = vibReg.slope > 0.005 ? 'increasing' : (vibReg.slope < -0.005 ? 'decreasing' : 'stable');

        // Temperature drift
        var tempValues = [];
        for (var t = 0; t < history.length; t++) {
            if (history[t].temperature != null) tempValues.push(history[t].temperature);
        }
        var tempReg = _linearRegression(tempValues);
        var tempDirection = tempReg.slope > 0.05 ? 'increasing' : (tempReg.slope < -0.05 ? 'decreasing' : 'stable');

        // Error frequency trend
        var errValues = [];
        for (var e = 0; e < history.length; e++) errValues.push(history[e].errorCount);
        var errReg = _linearRegression(errValues);
        var errDirection = errReg.slope > 0.05 ? 'increasing' : (errReg.slope < -0.05 ? 'decreasing' : 'stable');

        var lifeConsumed = round(eq.totalOperatingHours / eq.expectedLifeHours * 100, 1);
        var remainingLife = Math.max(0, eq.expectedLifeHours - eq.totalOperatingHours);

        return {
            success: true,
            equipmentId: equipmentId,
            wearRate: round(_mean(hourValues), 2),
            wearAcceleration: wearAcceleration,
            vibrationTrend: { slope: round(vibReg.slope, 4), direction: vibDirection },
            temperatureDrift: { slope: round(tempReg.slope, 4), direction: tempDirection },
            errorTrend: { slope: round(errReg.slope, 4), direction: errDirection },
            lifeConsumed: lifeConsumed,
            remainingLife: round(remainingLife, 1)
        };
    }

    // ── Failure Prediction ─────────────────────────────────────────

    function predictFailure(equipmentId) {
        if (!equipmentId || _isDangerousKey(equipmentId)) {
            return { success: false, error: 'Invalid equipmentId' };
        }
        if (!equipment[equipmentId]) {
            return { success: false, error: 'Equipment not found: ' + equipmentId };
        }
        var eq = equipment[equipmentId];
        var eta = eq.expectedLifeHours;
        var t = eq.totalOperatingHours;

        var currentReliability = _weibullReliability(t, eta, WEIBULL_BETA);
        var currentFailureProb = _weibullFailureProbability(t, eta, WEIBULL_BETA);

        var prob100 = _weibullFailureProbability(t + 100, eta, WEIBULL_BETA) - currentFailureProb;
        var prob500 = _weibullFailureProbability(t + 500, eta, WEIBULL_BETA) - currentFailureProb;
        var prob1000 = _weibullFailureProbability(t + 1000, eta, WEIBULL_BETA) - currentFailureProb;

        // Conditional probability of failure in next N hours given survival to t
        var condProb100 = currentReliability > 0 ? 1 - _weibullReliability(t + 100, eta, WEIBULL_BETA) / currentReliability : 1;
        var condProb500 = currentReliability > 0 ? 1 - _weibullReliability(t + 500, eta, WEIBULL_BETA) / currentReliability : 1;
        var condProb1000 = currentReliability > 0 ? 1 - _weibullReliability(t + 1000, eta, WEIBULL_BETA) / currentReliability : 1;

        var riskClassification = _classifyRisk(condProb500);

        return {
            success: true,
            equipmentId: equipmentId,
            operatingHours: round(t, 1),
            expectedLifeHours: eta,
            currentReliability: round(currentReliability, 4),
            cumulativeFailureProbability: round(currentFailureProb, 4),
            horizons: {
                next100h: { probability: round(condProb100, 4), risk: _classifyRisk(condProb100).level },
                next500h: { probability: round(condProb500, 4), risk: _classifyRisk(condProb500).level },
                next1000h: { probability: round(condProb1000, 4), risk: _classifyRisk(condProb1000).level }
            },
            riskLevel: riskClassification.level,
            riskColor: riskClassification.color
        };
    }

    // ── Maintenance Schedule Optimization ──────────────────────────

    function optimizeSchedule() {
        var ids = Object.keys(equipment);
        if (ids.length === 0) return { success: true, schedule: [], recommendations: [] };

        var scheduleItems = [];

        for (var i = 0; i < ids.length; i++) {
            var eq = equipment[ids[i]];
            var prediction = predictFailure(ids[i]);
            var critWeight = CRITICALITY_WEIGHTS[eq.criticality] || 0.5;

            // Maintenance overdue factor
            var maintenanceRatio = eq.hoursSinceLastMaintenance / eq.maintenanceIntervalHours;
            var overdueFactor = maintenanceRatio > 1 ? maintenanceRatio : maintenanceRatio * 0.5;

            // Failure risk factor
            var failureRisk = prediction.success ? prediction.cumulativeFailureProbability : 0;

            // Urgency score: weighted combination
            var urgencyScore = round(
                (overdueFactor * 40 + failureRisk * 40 + critWeight * 20),
                1
            );

            var action = 'routine_check';
            var priority = 'low';
            if (urgencyScore > 70) { action = 'immediate_maintenance'; priority = 'critical'; }
            else if (urgencyScore > 50) { action = 'schedule_maintenance'; priority = 'high'; }
            else if (urgencyScore > 30) { action = 'plan_maintenance'; priority = 'medium'; }

            var hoursUntilDue = Math.max(0, eq.maintenanceIntervalHours - eq.hoursSinceLastMaintenance);

            scheduleItems.push({
                equipmentId: eq.id,
                name: eq.name,
                category: eq.category,
                criticality: eq.criticality,
                urgencyScore: urgencyScore,
                action: action,
                priority: priority,
                hoursUntilDue: round(hoursUntilDue, 0),
                hoursSinceLastMaintenance: round(eq.hoursSinceLastMaintenance, 1),
                maintenanceInterval: eq.maintenanceIntervalHours,
                failureRisk: prediction.success ? prediction.riskLevel : 'unknown'
            });
        }

        // Sort by urgency descending
        scheduleItems.sort(function(a, b) { return b.urgencyScore - a.urgencyScore; });

        // Generate recommendations
        var recommendations = [];
        for (var r = 0; r < scheduleItems.length && r < 5; r++) {
            var item = scheduleItems[r];
            if (item.urgencyScore > 30) {
                recommendations.push({
                    equipmentId: item.equipmentId,
                    message: item.name + ' requires ' + item.action.replace(/_/g, ' ') +
                             ' (urgency: ' + item.urgencyScore + ', risk: ' + item.failureRisk + ')',
                    priority: item.priority
                });
            }
        }

        return { success: true, schedule: scheduleItems, recommendations: recommendations };
    }

    // ── Anomaly Detection ──────────────────────────────────────────

    function detectAnomalies(equipmentId) {
        if (!equipmentId || _isDangerousKey(equipmentId)) {
            return { success: false, error: 'Invalid equipmentId' };
        }
        if (!equipment[equipmentId]) {
            return { success: false, error: 'Equipment not found: ' + equipmentId };
        }
        var history = usageHistory[equipmentId];
        if (history.length < 3) {
            return { success: true, equipmentId: equipmentId, anomalies: [], message: 'Insufficient data (need at least 3 readings)' };
        }

        var anomalies = [];
        var windowSize = Math.min(ANOMALY_WINDOW, history.length);
        var window = history.slice(-windowSize);

        // Vibration anomalies
        var vibValues = [];
        for (var v = 0; v < window.length; v++) {
            if (window[v].vibration != null) vibValues.push(window[v].vibration);
        }
        if (vibValues.length >= 3) {
            var vibMean = _mean(vibValues);
            var vibStd = _stddev(vibValues);
            var lastVib = vibValues[vibValues.length - 1];
            if (vibStd > 0 && Math.abs(lastVib - vibMean) > ANOMALY_THRESHOLD * vibStd) {
                anomalies.push({
                    type: ANOMALY_TYPES.VIBRATION_SPIKE,
                    value: round(lastVib, 4),
                    mean: round(vibMean, 4),
                    stddev: round(vibStd, 4),
                    zScore: round((lastVib - vibMean) / vibStd, 2),
                    severity: Math.abs(lastVib - vibMean) > 3 * vibStd ? 'high' : 'medium'
                });
            }
        }

        // Temperature anomalies
        var tempValues = [];
        for (var t = 0; t < window.length; t++) {
            if (window[t].temperature != null) tempValues.push(window[t].temperature);
        }
        if (tempValues.length >= 3) {
            var tempMean = _mean(tempValues);
            var tempStd = _stddev(tempValues);
            var lastTemp = tempValues[tempValues.length - 1];
            if (tempStd > 0 && Math.abs(lastTemp - tempMean) > ANOMALY_THRESHOLD * tempStd) {
                anomalies.push({
                    type: ANOMALY_TYPES.TEMPERATURE_DRIFT,
                    value: round(lastTemp, 2),
                    mean: round(tempMean, 2),
                    stddev: round(tempStd, 2),
                    zScore: round((lastTemp - tempMean) / tempStd, 2),
                    severity: Math.abs(lastTemp - tempMean) > 3 * tempStd ? 'high' : 'medium'
                });
            }
        }

        // Error burst detection
        var errValues = [];
        for (var e = 0; e < window.length; e++) errValues.push(window[e].errorCount);
        if (errValues.length >= 3) {
            var errMean = _mean(errValues);
            var errStd = _stddev(errValues);
            var lastErr = errValues[errValues.length - 1];
            if (errStd > 0 && (lastErr - errMean) > ANOMALY_THRESHOLD * errStd) {
                anomalies.push({
                    type: ANOMALY_TYPES.ERROR_BURST,
                    value: lastErr,
                    mean: round(errMean, 2),
                    stddev: round(errStd, 2),
                    zScore: round((lastErr - errMean) / errStd, 2),
                    severity: (lastErr - errMean) > 3 * errStd ? 'high' : 'medium'
                });
            }
        }

        // Wear acceleration detection
        var hourValues = [];
        for (var h = 0; h < window.length; h++) hourValues.push(window[h].hours);
        if (hourValues.length >= 5) {
            var firstHalf = hourValues.slice(0, Math.floor(hourValues.length / 2));
            var secondHalf = hourValues.slice(Math.floor(hourValues.length / 2));
            var firstMean = _mean(firstHalf);
            var secondMean = _mean(secondHalf);
            if (firstMean > 0 && (secondMean - firstMean) / firstMean > 0.3) {
                anomalies.push({
                    type: ANOMALY_TYPES.WEAR_ACCELERATION,
                    firstHalfMean: round(firstMean, 2),
                    secondHalfMean: round(secondMean, 2),
                    accelerationRatio: round((secondMean - firstMean) / firstMean, 2),
                    severity: (secondMean - firstMean) / firstMean > 0.6 ? 'high' : 'medium'
                });
            }
        }

        return { success: true, equipmentId: equipmentId, anomalies: anomalies, anomalyCount: anomalies.length };
    }

    // ── Health Dashboard ───────────────────────────────────────────

    function getDashboard() {
        var ids = Object.keys(equipment);
        if (ids.length === 0) {
            return {
                success: true,
                fleetHealthScore: 100,
                equipmentCount: 0,
                statusBreakdown: { healthy: 0, degrading: 0, critical: 0, overdue: 0 },
                topUrgent: [],
                predictedFailures30d: [],
                recommendations: []
            };
        }

        var totalWeight = 0;
        var weightedHealth = 0;
        var statusBreakdown = { healthy: 0, degrading: 0, critical: 0, overdue: 0 };
        var predictedFailures = [];

        for (var i = 0; i < ids.length; i++) {
            var eq = equipment[ids[i]];
            var critWeight = CRITICALITY_WEIGHTS[eq.criticality] || 0.5;
            totalWeight += critWeight;

            var prediction = predictFailure(ids[i]);
            var reliability = prediction.success ? prediction.currentReliability : 1;

            weightedHealth += reliability * critWeight;

            // Classify status
            var isOverdue = eq.hoursSinceLastMaintenance > eq.maintenanceIntervalHours;
            if (isOverdue) {
                statusBreakdown.overdue++;
            } else if (prediction.success && prediction.riskLevel === 'critical') {
                statusBreakdown.critical++;
            } else if (prediction.success && (prediction.riskLevel === 'high' || prediction.riskLevel === 'moderate')) {
                statusBreakdown.degrading++;
            } else {
                statusBreakdown.healthy++;
            }

            // Predict failures in next 30 days (~720 hours at 24h/day usage)
            if (prediction.success && prediction.horizons.next1000h.probability > 0.3) {
                predictedFailures.push({
                    equipmentId: eq.id,
                    name: eq.name,
                    probability: prediction.horizons.next1000h.probability,
                    riskLevel: prediction.horizons.next1000h.risk
                });
            }
        }

        var fleetHealthScore = totalWeight > 0 ? round(weightedHealth / totalWeight * 100, 0) : 100;

        var schedule = optimizeSchedule();
        var topUrgent = schedule.schedule.slice(0, 5);

        // Autonomous recommendations
        var recommendations = [];
        if (statusBreakdown.critical > 0) {
            recommendations.push('IMMEDIATE: ' + statusBreakdown.critical + ' equipment item(s) at critical risk — schedule emergency maintenance');
        }
        if (statusBreakdown.overdue > 0) {
            recommendations.push('OVERDUE: ' + statusBreakdown.overdue + ' item(s) past maintenance interval — prioritize scheduling');
        }
        if (fleetHealthScore < 70) {
            recommendations.push('FLEET ALERT: Overall fleet health below 70% — review maintenance strategy');
        }
        if (predictedFailures.length > 0) {
            recommendations.push('FORECAST: ' + predictedFailures.length + ' potential failure(s) predicted within 1000 operating hours');
        }

        return {
            success: true,
            fleetHealthScore: fleetHealthScore,
            equipmentCount: ids.length,
            statusBreakdown: statusBreakdown,
            topUrgent: topUrgent,
            predictedFailures30d: predictedFailures,
            recommendations: recommendations
        };
    }

    // ── Get Equipment Info ─────────────────────────────────────────

    function getEquipment(equipmentId) {
        if (!equipmentId || _isDangerousKey(equipmentId)) {
            return { success: false, error: 'Invalid equipmentId' };
        }
        if (!equipment[equipmentId]) {
            return { success: false, error: 'Equipment not found: ' + equipmentId };
        }
        return { success: true, equipment: equipment[equipmentId] };
    }

    // ── Public API ─────────────────────────────────────────────────

    return {
        registerEquipment: registerEquipment,
        recordUsage: recordUsage,
        recordMaintenance: recordMaintenance,
        analyzeWear: analyzeWear,
        predictFailure: predictFailure,
        optimizeSchedule: optimizeSchedule,
        detectAnomalies: detectAnomalies,
        getDashboard: getDashboard,
        getEquipment: getEquipment
    };
}

// ── Exports ────────────────────────────────────────────────────────

module.exports = {
    createPredictiveMaintenance: createPredictiveMaintenance,
    VALID_CATEGORIES: VALID_CATEGORIES,
    VALID_CRITICALITIES: VALID_CRITICALITIES,
    ANOMALY_TYPES: ANOMALY_TYPES
};
