'use strict';

/**
 * Lab Resource Forecaster
 *
 * Autonomous resource consumption monitoring and forecasting module for
 * bioprinting labs. Tracks consumable usage over time, predicts depletion
 * dates using weighted moving averages and trend analysis, generates
 * procurement alerts with urgency levels, identifies waste patterns, and
 * recommends bulk ordering strategies.
 *
 * Key capabilities:
 * - Resource registration with stock levels, costs, and lead times
 * - Consumption and restock event tracking with operator attribution
 * - Weighted moving average consumption rate (recent days weighted more)
 * - Linear regression trend detection (increasing / decreasing / stable)
 * - Depletion date forecasting with trend-adjusted acceleration
 * - Multi-level reorder urgency (critical → high → medium → low → none)
 * - Expiration risk detection (stock expires before it's used)
 * - Waste analysis via statistical outlier detection (>2σ spikes)
 * - Procurement optimization with bulk ordering recommendations
 * - Full dashboard aggregation across all tracked resources
 *
 * @example
 *   var rf = createResourceForecaster();
 *   rf.registerResource({ id: 'alg-42', name: 'Alginate 2%', category: 'bioink',
 *     currentStock: 500, unit: 'mL', reorderPoint: 100, reorderQuantity: 1000,
 *     leadTimeDays: 5, costPerUnit: 0.85 });
 *   rf.recordConsumption({ resourceId: 'alg-42', quantity: 25 });
 *   var forecast = rf.forecast('alg-42');
 *   // forecast.reorderUrgency => 'low'
 *   var alerts = rf.getAlerts();
 *   // alerts => [{ type: 'reorder', severity: 'warning', ... }]
 */

// ── Valid categories ───────────────────────────────────────────────

var VALID_CATEGORIES = ['bioink', 'reagent', 'consumable', 'media', 'disposable'];

// ── Shared stats ──────────────────────────────────────────────────

var _stats = require('./stats');
var mean = _stats.mean;
var stddev = _stats.stddev;
var linearRegression = _stats.linearRegression;

// ── Helpers ────────────────────────────────────────────────────────

function toEpoch(ts) {
    if (ts == null) return Date.now();
    if (typeof ts === 'number') return ts;
    if (ts instanceof Date) return ts.getTime();
    var parsed = Date.parse(ts);
    if (isNaN(parsed)) throw new Error('Invalid timestamp: ' + ts);
    return parsed;
}

function daysBetween(a, b) {
    return (b - a) / 86400000;
}

function startOfDay(epoch) {
    var d = new Date(epoch);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function isoDate(epoch) {
    return new Date(epoch).toISOString().slice(0, 10);
}
var _isDangerousKey = require('./sanitize').isDangerousKey;

// ── Factory ────────────────────────────────────────────────────────

function createResourceForecaster(config) {
    config = config || {};

    var wmaPeriodDays = config.wmaPeriodDays || 14;
    var trendPeriodDays = config.trendPeriodDays || 30;
    var wasteSigmaThreshold = config.wasteSigmaThreshold || 2;
    var bulkWindowDays = config.bulkWindowDays || 14;

    // State
    var resources = {};       // id → resource object
    var consumptions = {};    // id → [{ quantity, timestamp, purpose, operator }]
    var restocks = {};        // id → [{ quantity, timestamp, lotNumber, supplier }]

    // ── Validation ─────────────────────────────────────────────────

    function requireString(val, name) {
        if (typeof val !== 'string' || !val.trim()) {
            throw new Error(name + ' must be a non-empty string');
        }
    }

    function requirePositive(val, name) {
        if (typeof val !== 'number' || isNaN(val) || val <= 0) {
            throw new Error(name + ' must be a positive number');
        }
    }

    function requireNonNeg(val, name) {
        if (typeof val !== 'number' || isNaN(val) || val < 0) {
            throw new Error(name + ' must be a non-negative number');
        }
    }

    function requireResource(id) {
        if (!resources[id]) throw new Error('Resource not found: ' + id);
    }

    // ── Resource management ────────────────────────────────────────

    function registerResource(opts) {
        if (!opts || typeof opts !== 'object') throw new Error('Options object required');
        requireString(opts.id, 'id');
        if (_isDangerousKey(opts.id)) {
            throw new Error('Invalid resource id');
        }
        requireString(opts.name, 'name');
        requireString(opts.unit, 'unit');
        if (VALID_CATEGORIES.indexOf(opts.category) === -1) {
            throw new Error('category must be one of: ' + VALID_CATEGORIES.join(', '));
        }
        requireNonNeg(opts.currentStock, 'currentStock');
        requireNonNeg(opts.reorderPoint, 'reorderPoint');
        requirePositive(opts.reorderQuantity, 'reorderQuantity');
        requireNonNeg(opts.leadTimeDays, 'leadTimeDays');
        requireNonNeg(opts.costPerUnit, 'costPerUnit');

        var res = {
            id: opts.id,
            name: opts.name,
            category: opts.category,
            currentStock: opts.currentStock,
            unit: opts.unit,
            reorderPoint: opts.reorderPoint,
            reorderQuantity: opts.reorderQuantity,
            leadTimeDays: opts.leadTimeDays,
            costPerUnit: opts.costPerUnit,
            expirationDate: opts.expirationDate ? toEpoch(opts.expirationDate) : null,
            registeredAt: Date.now()
        };

        resources[opts.id] = res;
        consumptions[opts.id] = consumptions[opts.id] || [];
        restocks[opts.id] = restocks[opts.id] || [];
        return res;
    }

    function removeResource(id) {
        requireResource(id);
        delete resources[id];
        delete consumptions[id];
        delete restocks[id];
    }

    function listResources(filter) {
        var result = [];
        var ids = Object.keys(resources);
        for (var i = 0; i < ids.length; i++) {
            var r = resources[ids[i]];
            if (filter && filter.category && r.category !== filter.category) continue;
            result.push({
                id: r.id,
                name: r.name,
                category: r.category,
                currentStock: r.currentStock,
                unit: r.unit,
                reorderPoint: r.reorderPoint,
                costPerUnit: r.costPerUnit
            });
        }
        return result;
    }

    // ── Event recording ────────────────────────────────────────────

    function recordConsumption(opts) {
        if (!opts || typeof opts !== 'object') throw new Error('Options object required');
        requireString(opts.resourceId, 'resourceId');
        requireResource(opts.resourceId);
        requirePositive(opts.quantity, 'quantity');

        var ts = toEpoch(opts.timestamp);
        var res = resources[opts.resourceId];

        if (opts.quantity > res.currentStock) {
            throw new Error('Consumption (' + opts.quantity + ') exceeds current stock (' + res.currentStock + ')');
        }

        res.currentStock -= opts.quantity;
        consumptions[opts.resourceId].push({
            quantity: opts.quantity,
            timestamp: ts,
            purpose: opts.purpose || null,
            operator: opts.operator || null
        });

        return { remainingStock: res.currentStock };
    }

    function recordRestock(opts) {
        if (!opts || typeof opts !== 'object') throw new Error('Options object required');
        requireString(opts.resourceId, 'resourceId');
        requireResource(opts.resourceId);
        requirePositive(opts.quantity, 'quantity');

        var ts = toEpoch(opts.timestamp);
        var res = resources[opts.resourceId];
        res.currentStock += opts.quantity;

        restocks[opts.resourceId].push({
            quantity: opts.quantity,
            timestamp: ts,
            lotNumber: opts.lotNumber || null,
            supplier: opts.supplier || null
        });

        return { currentStock: res.currentStock };
    }

    // ── Analysis helpers ───────────────────────────────────────────

    /**
     * Build daily consumption totals from event log.
     * Returns sorted array of { day (epoch start-of-day), total }.
     */
    function dailyTotals(resourceId) {
        var events = consumptions[resourceId] || [];
        var byDay = {};
        for (var i = 0; i < events.length; i++) {
            var day = startOfDay(events[i].timestamp);
            byDay[day] = (byDay[day] || 0) + events[i].quantity;
        }
        var days = Object.keys(byDay).sort(function(a, b) { return +a - +b; });
        var result = [];
        for (var j = 0; j < days.length; j++) {
            result.push({ day: +days[j], total: byDay[days[j]] });
        }
        return result;
    }

    /**
     * Weighted moving average over last N days.
     * Recent days get higher weight (linear: day index + 1).
     */
    function weightedMovingAvg(resourceId) {
        var totals = dailyTotals(resourceId);
        if (totals.length === 0) return 0;

        var now = startOfDay(Date.now());
        var cutoff = now - wmaPeriodDays * 86400000;

        // Filter to period
        var recent = [];
        for (var i = 0; i < totals.length; i++) {
            if (totals[i].day >= cutoff) recent.push(totals[i]);
        }

        if (recent.length === 0) {
            // Fall back to overall simple average
            var vals = [];
            for (var k = 0; k < totals.length; k++) vals.push(totals[k].total);
            return mean(vals);
        }

        if (recent.length < 3) {
            // Not enough for weighted avg, use simple
            var v2 = [];
            for (var m = 0; m < recent.length; m++) v2.push(recent[m].total);
            return mean(v2);
        }

        // Weighted average (higher index = more recent = more weight)
        var weightSum = 0, valSum = 0;
        for (var j = 0; j < recent.length; j++) {
            var w = j + 1;
            valSum += recent[j].total * w;
            weightSum += w;
        }
        return valSum / weightSum;
    }

    /**
     * Trend detection via linear regression on daily consumption.
     */
    function detectTrend(resourceId) {
        var totals = dailyTotals(resourceId);
        if (totals.length < 3) return { trend: 'stable', slope: 0, r2: 0 };

        var now = startOfDay(Date.now());
        var cutoff = now - trendPeriodDays * 86400000;
        var recent = [];
        for (var i = 0; i < totals.length; i++) {
            if (totals[i].day >= cutoff) recent.push(totals[i]);
        }
        if (recent.length < 3) return { trend: 'stable', slope: 0, r2: 0 };

        var xs = [], ys = [];
        var baseDay = recent[0].day;
        for (var j = 0; j < recent.length; j++) {
            xs.push(daysBetween(baseDay, recent[j].day));
            ys.push(recent[j].total);
        }

        var reg = linearRegression(xs, ys);
        var avgConsumption = mean(ys);
        // Slope significance: > 5% of mean per day considered significant
        var threshold = avgConsumption * 0.05;

        var trend = 'stable';
        if (reg.slope > threshold && reg.r2 > 0.1) trend = 'increasing';
        else if (reg.slope < -threshold && reg.r2 > 0.1) trend = 'decreasing';

        return { trend: trend, slope: reg.slope, r2: reg.r2 };
    }

    // ── Forecasting ────────────────────────────────────────────────

    function forecast(resourceId) {
        requireResource(resourceId);
        var res = resources[resourceId];
        var rate = weightedMovingAvg(resourceId);
        var trendInfo = detectTrend(resourceId);

        // Adjust rate for trend
        var adjustedRate = rate;
        if (trendInfo.trend === 'increasing') {
            adjustedRate = rate * (1 + Math.min(trendInfo.slope / (rate || 1), 0.5));
        } else if (trendInfo.trend === 'decreasing') {
            adjustedRate = rate * (1 - Math.min(Math.abs(trendInfo.slope) / (rate || 1), 0.3));
        }
        if (adjustedRate < 0) adjustedRate = 0;

        var daysUntilDepletion = adjustedRate > 0 ? res.currentStock / adjustedRate : Infinity;
        var depletionDate = daysUntilDepletion === Infinity
            ? null
            : isoDate(Date.now() + daysUntilDepletion * 86400000);

        var daysUntilReorder = adjustedRate > 0
            ? Math.max(0, (res.currentStock - res.reorderPoint) / adjustedRate)
            : Infinity;

        // Reorder urgency
        var urgency = 'none';
        if (res.currentStock <= res.reorderPoint) {
            urgency = 'critical';
        } else if (daysUntilReorder <= res.leadTimeDays) {
            urgency = 'high';
        } else if (daysUntilReorder <= res.leadTimeDays * 2) {
            urgency = 'medium';
        } else if (daysUntilReorder <= 30) {
            urgency = 'low';
        }

        // Expiration risk
        var expirationRisk = 'none';
        if (res.expirationDate) {
            var daysUntilExpiry = daysBetween(Date.now(), res.expirationDate);
            if (daysUntilExpiry <= 0) {
                expirationRisk = 'critical';
            } else if (daysUntilDepletion !== Infinity && daysUntilDepletion > daysUntilExpiry) {
                // Won't use it all before it expires
                expirationRisk = daysUntilExpiry < 14 ? 'critical' : 'warning';
            }
        }

        // Weekly forecast (next 4 weeks)
        var weeklyForecast = [];
        for (var w = 0; w < 4; w++) {
            var weekRate = adjustedRate;
            if (trendInfo.trend === 'increasing') {
                weekRate = adjustedRate * (1 + (trendInfo.slope / (rate || 1)) * 0.1 * w);
            }
            weeklyForecast.push({
                week: w + 1,
                predictedConsumption: Math.round(weekRate * 7 * 100) / 100,
                predictedStockEnd: Math.max(0, Math.round((res.currentStock - adjustedRate * 7 * (w + 1)) * 100) / 100)
            });
        }

        return {
            resourceId: res.id,
            name: res.name,
            category: res.category,
            currentStock: res.currentStock,
            unit: res.unit,
            dailyConsumptionRate: Math.round(adjustedRate * 1000) / 1000,
            consumptionTrend: trendInfo.trend,
            daysUntilDepletion: daysUntilDepletion === Infinity ? null : Math.round(daysUntilDepletion * 10) / 10,
            depletionDate: depletionDate,
            daysUntilReorderPoint: daysUntilReorder === Infinity ? null : Math.round(daysUntilReorder * 10) / 10,
            reorderUrgency: urgency,
            expirationRisk: expirationRisk,
            weeklyForecast: weeklyForecast
        };
    }

    // ── Alerts ─────────────────────────────────────────────────────

    function getAlerts() {
        var alerts = [];
        var ids = Object.keys(resources);

        for (var i = 0; i < ids.length; i++) {
            var f = forecast(ids[i]);
            var res = resources[ids[i]];

            // Depletion alert
            if (f.daysUntilDepletion !== null && f.daysUntilDepletion <= 7) {
                alerts.push({
                    type: 'depletion',
                    severity: f.daysUntilDepletion <= 2 ? 'critical' : 'warning',
                    resourceId: res.id,
                    resourceName: res.name,
                    message: res.name + ' will be depleted in ~' + f.daysUntilDepletion + ' days',
                    recommendation: 'Order ' + res.reorderQuantity + ' ' + res.unit + ' immediately',
                    daysUntilImpact: f.daysUntilDepletion
                });
            }

            // Reorder alert
            if (f.reorderUrgency === 'critical' || f.reorderUrgency === 'high') {
                alerts.push({
                    type: 'reorder',
                    severity: f.reorderUrgency === 'critical' ? 'critical' : 'warning',
                    resourceId: res.id,
                    resourceName: res.name,
                    message: res.name + ' stock (' + res.currentStock + ' ' + res.unit + ') ' +
                        (f.reorderUrgency === 'critical' ? 'is below reorder point' : 'will hit reorder point within lead time'),
                    recommendation: 'Place order for ' + res.reorderQuantity + ' ' + res.unit + ' (lead time: ' + res.leadTimeDays + ' days)',
                    daysUntilImpact: f.daysUntilReorderPoint || 0
                });
            }

            // Expiration alert
            if (f.expirationRisk !== 'none') {
                var daysExp = res.expirationDate ? Math.max(0, Math.round(daysBetween(Date.now(), res.expirationDate) * 10) / 10) : 0;
                alerts.push({
                    type: 'expiration',
                    severity: f.expirationRisk === 'critical' ? 'critical' : 'warning',
                    resourceId: res.id,
                    resourceName: res.name,
                    message: res.name + ' may expire before fully consumed (' + daysExp + ' days until expiry)',
                    recommendation: 'Increase usage rate or redistribute to other projects',
                    daysUntilImpact: daysExp
                });
            }

            // Surge alert — consumption > 3x normal rate recently
            var events = consumptions[ids[i]] || [];
            if (events.length >= 5) {
                var allQty = [];
                for (var e = 0; e < events.length; e++) allQty.push(events[e].quantity);
                var m = mean(allQty);
                var last3 = events.slice(-3);
                var recentAvg = mean(last3.map(function(x) { return x.quantity; }));
                if (recentAvg > m * 3 && m > 0) {
                    alerts.push({
                        type: 'surge',
                        severity: 'warning',
                        resourceId: res.id,
                        resourceName: res.name,
                        message: res.name + ' consumption surged to ' + Math.round(recentAvg / m * 100) + '% of normal rate',
                        recommendation: 'Investigate recent high-consumption events',
                        daysUntilImpact: f.daysUntilDepletion || 0
                    });
                }
            }
        }

        // Sort by severity (critical first)
        var sevOrder = { critical: 0, warning: 1, info: 2 };
        alerts.sort(function(a, b) {
            return (sevOrder[a.severity] || 9) - (sevOrder[b.severity] || 9);
        });

        return alerts;
    }

    // ── Waste analysis ─────────────────────────────────────────────

    function analyzeWaste() {
        var wasteEvents = [];
        var totalOptimal = 0;
        var totalActual = 0;
        var recommendations = [];
        var ids = Object.keys(resources);

        for (var i = 0; i < ids.length; i++) {
            var events = consumptions[ids[i]] || [];
            if (events.length < 3) continue;

            var quantities = [];
            for (var e = 0; e < events.length; e++) quantities.push(events[e].quantity);

            var m = mean(quantities);
            var sd = stddev(quantities);
            totalOptimal += m * events.length;
            totalActual += m * events.length; // baseline

            for (var j = 0; j < events.length; j++) {
                if (sd > 0 && events[j].quantity > m + wasteSigmaThreshold * sd) {
                    var excess = events[j].quantity - m;
                    totalActual += excess;
                    wasteEvents.push({
                        resourceId: ids[i],
                        resourceName: resources[ids[i]].name,
                        quantity: events[j].quantity,
                        expectedQuantity: Math.round(m * 100) / 100,
                        excess: Math.round(excess * 100) / 100,
                        timestamp: events[j].timestamp,
                        operator: events[j].operator,
                        purpose: events[j].purpose
                    });
                }
            }
        }

        var overallWasteRate = totalOptimal > 0
            ? Math.round((totalActual - totalOptimal) / totalOptimal * 10000) / 100
            : 0;

        if (wasteEvents.length > 0) {
            // Group by operator
            var byOperator = {};
            for (var w = 0; w < wasteEvents.length; w++) {
                var op = wasteEvents[w].operator || 'unknown';
                byOperator[op] = (byOperator[op] || 0) + 1;
            }
            var ops = Object.keys(byOperator);
            for (var o = 0; o < ops.length; o++) {
                if (byOperator[ops[o]] >= 2) {
                    recommendations.push('Operator "' + ops[o] + '" has ' + byOperator[ops[o]] + ' waste events — consider retraining');
                }
            }
            recommendations.push('Review protocols for resources with repeated waste events');
        }

        if (overallWasteRate > 10) {
            recommendations.push('Overall waste rate of ' + overallWasteRate + '% is high — audit consumption procedures');
        }

        return {
            wasteEvents: wasteEvents,
            overallWasteRate: overallWasteRate,
            recommendations: recommendations
        };
    }

    // ── Procurement optimization ───────────────────────────────────

    function optimizeProcurement() {
        var immediateOrders = [];
        var scheduledOrders = [];
        var bulkOpportunities = [];
        var monthlyCost = 0;
        var ids = Object.keys(resources);

        // Gather all resources needing reorder soon
        var needsReorder = []; // { resource, forecast, daysUntilReorder }

        for (var i = 0; i < ids.length; i++) {
            var f = forecast(ids[i]);
            var res = resources[ids[i]];
            var rate = f.dailyConsumptionRate;
            monthlyCost += rate * 30 * res.costPerUnit;

            if (f.reorderUrgency === 'critical') {
                immediateOrders.push({
                    resourceId: res.id,
                    name: res.name,
                    category: res.category,
                    quantity: res.reorderQuantity,
                    unit: res.unit,
                    estimatedCost: Math.round(res.reorderQuantity * res.costPerUnit * 100) / 100,
                    reason: 'Stock below reorder point'
                });
                needsReorder.push({ resource: res, forecast: f, daysUntilReorder: 0 });
            } else if (f.reorderUrgency === 'high' || f.reorderUrgency === 'medium') {
                scheduledOrders.push({
                    resourceId: res.id,
                    name: res.name,
                    category: res.category,
                    quantity: res.reorderQuantity,
                    unit: res.unit,
                    estimatedCost: Math.round(res.reorderQuantity * res.costPerUnit * 100) / 100,
                    orderByDate: isoDate(Date.now() + Math.max(0, (f.daysUntilReorderPoint || 0) - res.leadTimeDays) * 86400000),
                    reason: f.reorderUrgency === 'high' ? 'Within lead time' : 'Within 2x lead time'
                });
                needsReorder.push({ resource: res, forecast: f, daysUntilReorder: f.daysUntilReorderPoint || 0 });
            }
        }

        // Find bulk opportunities: 3+ items in same category needing reorder within window
        var byCategory = {};
        for (var j = 0; j < needsReorder.length; j++) {
            var cat = needsReorder[j].resource.category;
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(needsReorder[j]);
        }
        var cats = Object.keys(byCategory);
        for (var c = 0; c < cats.length; c++) {
            var items = byCategory[cats[c]];
            // Filter to those within bulk window
            var eligible = [];
            for (var k = 0; k < items.length; k++) {
                if (items[k].daysUntilReorder <= bulkWindowDays) eligible.push(items[k]);
            }
            if (eligible.length >= 3) {
                var totalCost = 0;
                var itemList = [];
                for (var l = 0; l < eligible.length; l++) {
                    var r = eligible[l].resource;
                    totalCost += r.reorderQuantity * r.costPerUnit;
                    itemList.push(r.name);
                }
                var savings = Math.round(totalCost * 0.08 * 100) / 100; // Estimate 8% bulk discount
                bulkOpportunities.push({
                    category: cats[c],
                    itemCount: eligible.length,
                    items: itemList,
                    combinedCost: Math.round(totalCost * 100) / 100,
                    estimatedSavings: savings,
                    recommendation: 'Combine ' + eligible.length + ' ' + cats[c] + ' orders for ~' + savings + ' savings'
                });
            }
        }

        return {
            immediateOrders: immediateOrders,
            scheduledOrders: scheduledOrders,
            bulkOpportunities: bulkOpportunities,
            estimatedMonthlyCost: Math.round(monthlyCost * 100) / 100,
            savingsFromBulk: bulkOpportunities.reduce(function(sum, b) { return sum + b.estimatedSavings; }, 0)
        };
    }

    // ── Dashboard ──────────────────────────────────────────────────

    function getDashboard() {
        var ids = Object.keys(resources);
        var items = [];
        var totalValue = 0;

        for (var i = 0; i < ids.length; i++) {
            var res = resources[ids[i]];
            var f = forecast(ids[i]);
            totalValue += res.currentStock * res.costPerUnit;
            items.push({
                resource: { id: res.id, name: res.name, category: res.category },
                stock: { current: res.currentStock, unit: res.unit, reorderPoint: res.reorderPoint },
                forecast: f,
                value: Math.round(res.currentStock * res.costPerUnit * 100) / 100
            });
        }

        return {
            totalResources: ids.length,
            totalInventoryValue: Math.round(totalValue * 100) / 100,
            resources: items,
            alerts: getAlerts(),
            procurement: optimizeProcurement()
        };
    }

    // ── History ────────────────────────────────────────────────────

    function getHistory(resourceId) {
        requireResource(resourceId);
        return {
            consumptions: (consumptions[resourceId] || []).slice(),
            restocks: (restocks[resourceId] || []).slice()
        };
    }

    // ── Reset ──────────────────────────────────────────────────────

    function reset() {
        resources = {};
        consumptions = {};
        restocks = {};
    }

    // ── Public API ─────────────────────────────────────────────────

    return {
        registerResource: registerResource,
        removeResource: removeResource,
        listResources: listResources,
        recordConsumption: recordConsumption,
        recordRestock: recordRestock,
        forecast: forecast,
        getAlerts: getAlerts,
        analyzeWaste: analyzeWaste,
        optimizeProcurement: optimizeProcurement,
        getDashboard: getDashboard,
        getHistory: getHistory,
        reset: reset
    };
}

module.exports = { createResourceForecaster: createResourceForecaster };
