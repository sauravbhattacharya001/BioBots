'use strict';

/**
 * Perishable Waste Forecaster - Agentic cross-module synthesizer.
 *
 * Combines Lab Inventory Manager signals (current stock, daily consumption
 * forecast, expiry dates) to project how much of each perishable will
 * likely EXPIRE UNUSED inside a horizon, with concrete intervention
 * recommendations and a what-if simulator.
 *
 * Unlike `inventory.getExpiryAlerts()` (which only flags upcoming expiries)
 * or `inventory.getForecast()` (which only projects consumption), this
 * advisor crosses both signals to surface waste risk no single existing
 * module can see.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var inv = biobots.createLabInventoryManager();
 *   // ... populate inv ...
 *   var pwf = biobots.createPerishableWasteForecaster({
 *       inventory: inv,
 *       horizonDays: 30
 *   });
 *   var plan = pwf.forecast();
 *   console.log(plan.totals.projectedWasteValue);
 *   console.log(pwf.formatMarkdown(plan));
 */

var DEFAULT_PERISHABLES = ['bioink', 'reagent', 'media', 'crosslinker'];
var SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

function _isPosNumber(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0;
}

function _round2(n) {
    if (!isFinite(n)) return n;
    return Math.round(n * 100) / 100;
}

function _round1(n) {
    if (!isFinite(n)) return n;
    return Math.round(n * 10) / 10;
}

function _cloneItem(item) {
    return {
        name: item.name,
        category: item.category || null,
        quantity: typeof item.quantity === 'number' ? item.quantity : 0,
        unit: item.unit || '',
        reorderThreshold: item.reorderThreshold || 0,
        lotNumber: item.lotNumber || null,
        expiryDate: item.expiryDate || null,
        unitCost: typeof item.unitCost === 'number' ? item.unitCost : 0
    };
}

function createPerishableWasteForecaster(opts) {
    opts = opts || {};
    if (!opts.inventory || typeof opts.inventory.listItems !== 'function') {
        throw new Error('createPerishableWasteForecaster requires { inventory } with a listItems() method');
    }

    var inventory = opts.inventory;

    var horizonDays;
    if (opts.horizonDays === undefined || opts.horizonDays === null) {
        horizonDays = 30;
    } else {
        if (typeof opts.horizonDays !== 'number' || !isFinite(opts.horizonDays) || opts.horizonDays < 1) {
            throw new Error('horizonDays must be >= 1');
        }
        horizonDays = opts.horizonDays;
    }

    var minWasteUnits = _isPosNumber(opts.minWasteUnits) ? opts.minWasteUnits : 0.0001;
    var unitCostFallback = _isPosNumber(opts.unitCostFallback) ? opts.unitCostFallback : 0;
    var perishableCategories = (opts.perishableCategories && opts.perishableCategories.length)
        ? opts.perishableCategories.slice()
        : DEFAULT_PERISHABLES.slice();

    var perishableSet = {};
    for (var pi = 0; pi < perishableCategories.length; pi++) {
        perishableSet[perishableCategories[pi]] = true;
    }

    // ------------------------------------------------------------------
    // Helper: get a daily usage rate for an item, defensive against the
    // labInventory `getForecast` returning { avgDailyUsage: null } when
    // there's insufficient history.
    // ------------------------------------------------------------------
    function _readDailyUsageFromInv(name) {
        try {
            var fc = inventory.getForecast(name);
            if (fc && typeof fc.avgDailyUsage === 'number' && isFinite(fc.avgDailyUsage) && fc.avgDailyUsage > 0) {
                return fc.avgDailyUsage;
            }
        } catch (e) {
            // item missing or other issue - treat as no forecast
        }
        return 0;
    }

    // ------------------------------------------------------------------
    // Core: compute a Plan over an array of item snapshots and a
    // daily-usage lookup. This is the seam simulate() reuses without
    // touching the real inventory.
    // ------------------------------------------------------------------
    function _computePlan(itemsSnapshot, getDailyUsage, asOfIso) {
        var asOfMs = new Date(asOfIso).getTime();
        var forecasts = [];
        var totalPerishableValue = 0;

        for (var i = 0; i < itemsSnapshot.length; i++) {
            var item = itemsSnapshot[i];
            var cat = item.category;
            if (!perishableSet[cat]) continue;

            var qty = typeof item.quantity === 'number' ? item.quantity : 0;
            var unitCost = typeof item.unitCost === 'number' && isFinite(item.unitCost)
                ? item.unitCost
                : unitCostFallback;

            totalPerishableValue += qty * unitCost;

            var hasExpiry = !!item.expiryDate;
            var daysUntilExpiry = -1;
            if (hasExpiry) {
                var expMs = new Date(item.expiryDate).getTime();
                daysUntilExpiry = Math.floor((expMs - asOfMs) / 86400000);
            }

            // Skip items with no expiry at all - nothing to waste vs. clock.
            if (!hasExpiry) continue;

            var dailyUsage = getDailyUsage(item.name);
            var reasons = [];
            var projectedConsumption = 0;
            var projectedWasteUnits = 0;

            if (daysUntilExpiry < 0) {
                // Already expired with stock on hand.
                projectedConsumption = 0;
                projectedWasteUnits = qty;
                if (qty > 0) reasons.push('already_expired');
            } else {
                // Expiry within horizon? If not, no waste projected.
                if (daysUntilExpiry > horizonDays) continue;

                projectedConsumption = dailyUsage * daysUntilExpiry;
                if (projectedConsumption < 0) projectedConsumption = 0;
                if (projectedConsumption > qty) projectedConsumption = qty;
                projectedWasteUnits = qty - projectedConsumption;
                if (projectedWasteUnits < 0) projectedWasteUnits = 0;

                if (dailyUsage === 0 && qty > 0) {
                    reasons.push('no_consumption_forecast');
                }
                if (daysUntilExpiry <= 7) {
                    reasons.push('expires_within_7_days');
                }
                if (qty > 0 && dailyUsage > 0 && projectedConsumption < qty * 0.5) {
                    reasons.push('low_usage_vs_stock');
                }
            }

            // Filter: drop items with negligible projected waste unless
            // they are already expired with stock (always keep those).
            if (projectedWasteUnits < minWasteUnits && !(daysUntilExpiry < 0 && qty > 0)) {
                continue;
            }

            var wastePct = qty > 0 ? (projectedWasteUnits / qty) : 0;
            var severity;
            if (daysUntilExpiry < 0 && qty > 0) {
                severity = 'critical';
            } else if (wastePct > 0.75) {
                severity = 'critical';
            } else if (wastePct > 0.5 || (daysUntilExpiry >= 0 && daysUntilExpiry <= 7 && projectedWasteUnits > 0)) {
                severity = 'high';
            } else if (wastePct > 0.2) {
                severity = 'medium';
            } else {
                severity = 'low';
            }

            // Recommend action.
            var action;
            if (daysUntilExpiry < 0 && qty > 0) {
                action = {
                    kind: 'donate_or_dispose',
                    detail: 'Stock already expired - remove from active inventory or donate per SOP'
                };
            } else if (severity === 'critical' || severity === 'high') {
                if (dailyUsage === 0) {
                    action = {
                        kind: 'redistribute',
                        detail: 'No active consumption - redistribute to another project or share with collaborators before ' + item.expiryDate
                    };
                } else if (daysUntilExpiry <= 7) {
                    action = {
                        kind: 'use_now',
                        detail: 'Schedule prints/assays consuming this material in the next ' + daysUntilExpiry + ' days'
                    };
                } else {
                    action = {
                        kind: 'scale_down_order',
                        detail: 'Projected to waste ' + _round2(projectedWasteUnits) + ' ' + (item.unit || 'units') + ' - reduce next reorder accordingly'
                    };
                }
            } else if (severity === 'medium') {
                action = {
                    kind: 'increase_usage_priority',
                    detail: 'Prioritize this lot in upcoming protocols to avoid mid-horizon waste'
                };
            } else {
                action = {
                    kind: 'increase_usage_priority',
                    detail: 'Minor projected waste - monitor weekly'
                };
            }

            forecasts.push({
                name: item.name,
                category: cat,
                unit: item.unit || '',
                quantity: qty,
                unitCost: unitCost,
                dailyUsage: dailyUsage,
                daysUntilExpiry: daysUntilExpiry,
                projectedConsumption: _round2(projectedConsumption),
                projectedWasteUnits: _round2(projectedWasteUnits),
                projectedWasteValue: _round2(projectedWasteUnits * unitCost),
                severity: severity,
                reasons: reasons,
                recommendedAction: action
            });
        }

        // Sort: severity asc-by-rank, then waste value desc.
        forecasts.sort(function (a, b) {
            var sa = SEVERITY_RANK[a.severity];
            var sb = SEVERITY_RANK[b.severity];
            if (sa !== sb) return sa - sb;
            return b.projectedWasteValue - a.projectedWasteValue;
        });

        // Totals.
        var totalUnits = 0;
        var totalValue = 0;
        for (var t = 0; t < forecasts.length; t++) {
            totalUnits += forecasts[t].projectedWasteUnits;
            totalValue += forecasts[t].projectedWasteValue;
        }

        var pctAtRisk = totalPerishableValue > 0
            ? (totalValue / totalPerishableValue) * 100
            : 0;

        var totals = {
            itemsAtRisk: forecasts.length,
            projectedWasteUnits: _round2(totalUnits),
            projectedWasteValue: _round2(totalValue),
            pctOfInventoryValueAtRisk: _round1(pctAtRisk)
        };

        var interventions = _buildInterventions(forecasts);
        var insights = _buildInsights(forecasts, totals, totalPerishableValue);

        return {
            asOf: asOfIso,
            horizonDays: horizonDays,
            totals: totals,
            forecasts: forecasts,
            topInterventions: interventions,
            insights: insights
        };
    }

    function _buildInterventions(forecasts) {
        var p0Items = [];
        var p0Value = 0;
        var p1UseItems = [];
        var p1UseValue = 0;
        var p1ScaleItems = [];
        var p1ScaleValue = 0;
        var p2Items = [];
        var p2Value = 0;

        for (var i = 0; i < forecasts.length; i++) {
            var f = forecasts[i];
            if (f.daysUntilExpiry < 0 && f.quantity > 0) {
                p0Items.push(f.name);
                p0Value += f.projectedWasteValue;
                continue;
            }
            if (f.severity === 'critical' || (f.severity === 'high' && f.daysUntilExpiry <= 7)) {
                if (f.recommendedAction.kind === 'scale_down_order') {
                    p1ScaleItems.push(f.name);
                    p1ScaleValue += f.projectedWasteValue;
                } else {
                    p1UseItems.push(f.name);
                    p1UseValue += f.projectedWasteValue;
                }
                continue;
            }
            if (f.severity === 'high') {
                p1ScaleItems.push(f.name);
                p1ScaleValue += f.projectedWasteValue;
                continue;
            }
            if (f.severity === 'medium') {
                p2Items.push(f.name);
                p2Value += f.projectedWasteValue;
            }
        }

        var out = [];
        if (p0Items.length) {
            out.push({
                priority: 'P0',
                action: 'Donate or dispose ' + p0Items.length + ' already-expired perishable(s)',
                impactValue: _round2(p0Value),
                affectedItems: p0Items
            });
        }
        if (p1UseItems.length) {
            out.push({
                priority: 'P1',
                action: 'Prioritize use / redistribute ' + p1UseItems.length + ' near-expiry perishable(s)',
                impactValue: _round2(p1UseValue),
                affectedItems: p1UseItems
            });
        }
        if (p1ScaleItems.length) {
            out.push({
                priority: 'P1',
                action: 'Scale down next reorder for ' + p1ScaleItems.length + ' over-stocked perishable(s)',
                impactValue: _round2(p1ScaleValue),
                affectedItems: p1ScaleItems
            });
        }
        if (p2Items.length) {
            out.push({
                priority: 'P2',
                action: 'Batch redistribution / priority-use of ' + p2Items.length + ' moderate-risk item(s)',
                impactValue: _round2(p2Value),
                affectedItems: p2Items
            });
        }

        // Highest impact first; cap 5.
        out.sort(function (a, b) {
            return b.impactValue - a.impactValue;
        });
        if (out.length > 5) out = out.slice(0, 5);
        return out;
    }

    function _buildInsights(forecasts, totals, totalPerishableValue) {
        var insights = [];
        if (!forecasts.length) return insights;

        var heavyWasters = 0;
        var noForecast = 0;
        var catCounts = {};
        for (var i = 0; i < forecasts.length; i++) {
            var f = forecasts[i];
            if (f.quantity > 0 && (f.projectedWasteUnits / f.quantity) > 0.5) {
                heavyWasters++;
            }
            if (f.reasons.indexOf('no_consumption_forecast') !== -1) {
                noForecast++;
            }
            catCounts[f.category] = (catCounts[f.category] || 0) + 1;
        }

        if (heavyWasters > 0) {
            insights.push(heavyWasters + ' perishable' + (heavyWasters === 1 ? '' : 's')
                + ' will waste >50% of stock before expiry');
        }
        if (totals.projectedWasteValue > 0 && totalPerishableValue > 0) {
            insights.push('$' + totals.projectedWasteValue.toFixed(2)
                + ' (' + totals.pctOfInventoryValueAtRisk.toFixed(1)
                + '% of perishable inventory value) projected to expire unused');
        }
        // Dominant category?
        var dominantCat = null;
        var dominantCount = 0;
        var catKeys = Object.keys(catCounts);
        for (var k = 0; k < catKeys.length; k++) {
            if (catCounts[catKeys[k]] > dominantCount) {
                dominantCount = catCounts[catKeys[k]];
                dominantCat = catKeys[k];
            }
        }
        if (dominantCat && dominantCount >= 2 && dominantCount > forecasts.length / 2) {
            insights.push(dominantCat.charAt(0).toUpperCase() + dominantCat.slice(1)
                + 's dominate waste risk: ' + dominantCount + ' of ' + forecasts.length
                + ' at-risk items');
        }
        if (noForecast > 0) {
            insights.push('No consumption forecast available for ' + noForecast
                + ' at-risk item' + (noForecast === 1 ? '' : 's')
                + ' - usage data may be stale');
        }

        if (insights.length > 5) insights = insights.slice(0, 5);
        return insights;
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------
    function forecast(asOf) {
        var asOfIso;
        if (asOf === undefined || asOf === null) {
            asOfIso = new Date().toISOString();
        } else if (asOf instanceof Date) {
            asOfIso = asOf.toISOString();
        } else if (typeof asOf === 'number') {
            asOfIso = new Date(asOf).toISOString();
        } else if (typeof asOf === 'string') {
            asOfIso = new Date(asOf).toISOString();
        } else {
            throw new Error('asOf must be a Date, number, or ISO string');
        }

        var raw = inventory.listItems();
        var snapshot = [];
        for (var i = 0; i < raw.length; i++) {
            snapshot.push(_cloneItem(raw[i]));
        }
        return _computePlan(snapshot, _readDailyUsageFromInv, asOfIso);
    }

    function simulate(actions) {
        if (!actions || !actions.length) {
            actions = [];
        }
        var asOfIso = new Date().toISOString();

        // Build virtual snapshot - never mutate underlying inventory.
        var raw = inventory.listItems();
        var snapshot = [];
        var byName = {};
        for (var i = 0; i < raw.length; i++) {
            var c = _cloneItem(raw[i]);
            snapshot.push(c);
            byName[c.name] = c;
        }

        // Cache daily usage *before* applying actions so the virtual
        // snapshot still uses real historical usage rates.
        var usageCache = {};
        for (var u = 0; u < snapshot.length; u++) {
            usageCache[snapshot[u].name] = _readDailyUsageFromInv(snapshot[u].name);
        }
        function snapshotUsageLookup(name) {
            return usageCache[name] || 0;
        }

        var actionsApplied = [];
        for (var a = 0; a < actions.length; a++) {
            var act = actions[a] || {};
            var target = byName[act.name];
            if (!target) {
                continue;
            }
            if (act.type === 'consume' || act.type === 'reduce_stock') {
                var n = typeof act.units === 'number' && isFinite(act.units) ? act.units : 0;
                target.quantity = Math.max(0, target.quantity - n);
                actionsApplied.push({ type: act.type, name: act.name, units: n });
            } else if (act.type === 'extend_expiry') {
                var d = typeof act.days === 'number' && isFinite(act.days) ? act.days : 0;
                if (target.expiryDate) {
                    var base = new Date(target.expiryDate).getTime();
                    target.expiryDate = new Date(base + d * 86400000).toISOString();
                }
                actionsApplied.push({ type: act.type, name: act.name, days: d });
            }
        }

        // Compute before-plan using the real inventory's listItems()
        // snapshot we took at entry (pre-mutation copies are NOT what we
        // want for "before" - we need a fresh clone of the originals).
        var rawForBefore = inventory.listItems();
        var beforeSnap = [];
        for (var b = 0; b < rawForBefore.length; b++) {
            beforeSnap.push(_cloneItem(rawForBefore[b]));
        }
        var beforePlan = _computePlan(beforeSnap, snapshotUsageLookup, asOfIso);
        var afterPlan = _computePlan(snapshot, snapshotUsageLookup, asOfIso);

        return {
            before: beforePlan.totals,
            after: afterPlan.totals,
            deltaUnits: _round2(beforePlan.totals.projectedWasteUnits - afterPlan.totals.projectedWasteUnits),
            deltaValue: _round2(beforePlan.totals.projectedWasteValue - afterPlan.totals.projectedWasteValue),
            actionsApplied: actionsApplied
        };
    }

    function formatText(plan) {
        if (!plan) plan = forecast();
        var lines = [];
        lines.push('PERISHABLE WASTE FORECAST');
        lines.push('As of: ' + plan.asOf);
        lines.push('Horizon: ' + plan.horizonDays + ' days');
        lines.push('');
        lines.push('Totals');
        lines.push('  Items at risk:           ' + plan.totals.itemsAtRisk);
        lines.push('  Projected waste units:   ' + plan.totals.projectedWasteUnits);
        lines.push('  Projected waste value:   $' + plan.totals.projectedWasteValue.toFixed(2));
        lines.push('  % of perishable value:   ' + plan.totals.pctOfInventoryValueAtRisk.toFixed(1) + '%');
        lines.push('');

        if (plan.forecasts.length) {
            lines.push('At-risk items');
            for (var i = 0; i < plan.forecasts.length; i++) {
                var f = plan.forecasts[i];
                lines.push('  [' + f.severity.toUpperCase() + '] ' + f.name
                    + ' (' + f.category + ')'
                    + ' qty=' + f.quantity + ' ' + f.unit
                    + ' exp_in=' + f.daysUntilExpiry + 'd'
                    + ' waste=' + f.projectedWasteUnits + ' ' + f.unit
                    + ' ($' + f.projectedWasteValue.toFixed(2) + ')');
                lines.push('      action: ' + f.recommendedAction.kind + ' - ' + f.recommendedAction.detail);
                if (f.reasons.length) {
                    lines.push('      reasons: ' + f.reasons.join(', '));
                }
            }
            lines.push('');
        }

        if (plan.topInterventions.length) {
            lines.push('Top interventions');
            for (var j = 0; j < plan.topInterventions.length; j++) {
                var iv = plan.topInterventions[j];
                lines.push('  ' + iv.priority + ': ' + iv.action
                    + ' (impact $' + iv.impactValue.toFixed(2) + ')');
            }
            lines.push('');
        }

        if (plan.insights.length) {
            lines.push('Insights');
            for (var k = 0; k < plan.insights.length; k++) {
                lines.push('  - ' + plan.insights[k]);
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    function formatMarkdown(plan) {
        if (!plan) plan = forecast();
        var lines = [];
        lines.push('# Perishable Waste Forecast');
        lines.push('');
        lines.push('_As of_: `' + plan.asOf + '`  ');
        lines.push('_Horizon_: ' + plan.horizonDays + ' days');
        lines.push('');
        lines.push('## Totals');
        lines.push('');
        lines.push('- Items at risk: **' + plan.totals.itemsAtRisk + '**');
        lines.push('- Projected waste units: **' + plan.totals.projectedWasteUnits + '**');
        lines.push('- Projected waste value: **$' + plan.totals.projectedWasteValue.toFixed(2) + '**');
        lines.push('- % of perishable inventory value at risk: **'
            + plan.totals.pctOfInventoryValueAtRisk.toFixed(1) + '%**');
        lines.push('');

        if (plan.forecasts.length) {
            lines.push('## At-risk items');
            lines.push('');
            lines.push('| Name | Category | Qty | Days to exp | Waste units | Waste $ | Severity |');
            lines.push('|------|----------|-----|-------------|-------------|---------|----------|');
            for (var i = 0; i < plan.forecasts.length; i++) {
                var f = plan.forecasts[i];
                lines.push('| ' + f.name
                    + ' | ' + f.category
                    + ' | ' + f.quantity + ' ' + f.unit
                    + ' | ' + f.daysUntilExpiry
                    + ' | ' + f.projectedWasteUnits + ' ' + f.unit
                    + ' | $' + f.projectedWasteValue.toFixed(2)
                    + ' | ' + f.severity
                    + ' |');
            }
            lines.push('');
        }

        if (plan.topInterventions.length) {
            lines.push('## Top interventions');
            lines.push('');
            for (var j = 0; j < plan.topInterventions.length; j++) {
                var iv = plan.topInterventions[j];
                lines.push('- **' + iv.priority + '** ' + iv.action
                    + ' _(impact $' + iv.impactValue.toFixed(2) + ')_');
            }
            lines.push('');
        }

        if (plan.insights.length) {
            lines.push('## Insights');
            lines.push('');
            for (var k = 0; k < plan.insights.length; k++) {
                lines.push('- ' + plan.insights[k]);
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    function formatJson(plan) {
        if (!plan) plan = forecast();
        return JSON.stringify(plan, null, 2);
    }

    return {
        forecast: forecast,
        simulate: simulate,
        formatText: formatText,
        formatMarkdown: formatMarkdown,
        formatJson: formatJson
    };
}

module.exports = {
    createPerishableWasteForecaster: createPerishableWasteForecaster
};
