'use strict';

/**
 * Smart Reorder Advisor - Agentic inventory reorder planner.
 *
 * Consumes a Lab Inventory Manager (or compatible item snapshot) and produces
 * prioritized, actionable reorder recommendations: target quantity, urgency
 * tier, justification, and a what-if simulation of cash outlay over time.
 *
 * Unlike a flat low-stock alert, this advisor considers:
 *   - current stock vs. reorder threshold
 *   - forecast daily consumption (from the inventory manager)
 *   - per-item lead time (days to receive after ordering)
 *   - safety stock multiplier (buffer above lead-time demand)
 *   - target days of coverage after restock
 *   - upcoming expiry (avoid over-ordering perishables)
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var inv = biobots.createLabInventoryManager();
 *   // ... populate inv ...
 *   var advisor = biobots.createSmartReorderAdvisor({
 *       inventory: inv,
 *       defaultLeadTimeDays: 5,
 *       safetyStockMultiplier: 1.5,
 *       targetCoverageDays: 30
 *   });
 *   advisor.setLeadTime('Alginate 2%', 7);
 *   var plan = advisor.buildPlan();
 *   plan.recommendations.forEach(function (r) {
 *       console.log(r.priority, r.name, 'order', r.suggestedQuantity, r.unit);
 *   });
 */

var PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
var EXPIRY_HORIZON_DAYS = 14;
var STOCKOUT_CRITICAL_DAYS = 3;
var STOCKOUT_HIGH_DAYS = 7;
var STOCKOUT_MEDIUM_DAYS = 14;

function _isPosNumber(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0;
}

function _round2(n) {
    if (!isFinite(n)) return n;
    return Math.round(n * 100) / 100;
}

function createSmartReorderAdvisor(opts) {
    opts = opts || {};
    if (!opts.inventory || typeof opts.inventory.listItems !== 'function') {
        throw new Error('createSmartReorderAdvisor requires { inventory } with a listItems() method');
    }

    var inventory = opts.inventory;
    var defaultLeadTimeDays = _isPosNumber(opts.defaultLeadTimeDays) ? opts.defaultLeadTimeDays : 5;
    var safetyStockMultiplier = _isPosNumber(opts.safetyStockMultiplier) ? opts.safetyStockMultiplier : 1.5;
    var targetCoverageDays = _isPosNumber(opts.targetCoverageDays) ? opts.targetCoverageDays : 30;
    var minOrderUnits = _isPosNumber(opts.minOrderUnits) ? opts.minOrderUnits : 1;

    if (safetyStockMultiplier < 1) {
        throw new Error('safetyStockMultiplier must be >= 1');
    }
    if (targetCoverageDays < 1) {
        throw new Error('targetCoverageDays must be >= 1');
    }

    var leadTimeOverrides = Object.create(null);
    var supplierMap = Object.create(null);

    function setLeadTime(itemName, days) {
        if (!itemName || typeof itemName !== 'string') {
            throw new Error('itemName is required');
        }
        if (!_isPosNumber(days) || days < 0.5) {
            throw new Error('Lead time must be a number >= 0.5 days');
        }
        leadTimeOverrides[itemName] = days;
    }

    function setSupplier(itemName, supplier) {
        if (!itemName || typeof itemName !== 'string') {
            throw new Error('itemName is required');
        }
        if (!supplier || typeof supplier !== 'string') {
            throw new Error('supplier is required');
        }
        supplierMap[itemName] = supplier;
    }

    function getLeadTime(itemName) {
        return leadTimeOverrides[itemName] != null ? leadTimeOverrides[itemName] : defaultLeadTimeDays;
    }

    function _avgDaily(name) {
        // Try the inventory manager's forecast first.
        if (typeof inventory.getForecast === 'function') {
            try {
                var f = inventory.getForecast(name, 1);
                if (f && _isPosNumber(f.avgDailyUsage)) {
                    return f.avgDailyUsage;
                }
            } catch (_e) { /* fall through */ }
        }
        return 0;
    }

    function _expiryDaysAway(item) {
        if (!item.expiryDate) return null;
        var exp = new Date(item.expiryDate).getTime();
        if (isNaN(exp)) return null;
        return Math.ceil((exp - Date.now()) / 86400000);
    }

    function _classify(stockoutDays, expiryDays, item) {
        // Already out of stock or expired -> critical
        if (item.quantity <= 0) return 'critical';
        if (expiryDays !== null && expiryDays <= 0) return 'critical';

        // Below threshold AND will run out before lead time arrives -> critical
        var lead = getLeadTime(item.name);
        if (stockoutDays !== null && stockoutDays <= Math.min(lead, STOCKOUT_CRITICAL_DAYS)) {
            return 'critical';
        }
        if (stockoutDays !== null && stockoutDays <= STOCKOUT_HIGH_DAYS) return 'high';
        if (stockoutDays !== null && stockoutDays <= STOCKOUT_MEDIUM_DAYS) return 'medium';
        if (item.quantity <= item.reorderThreshold) return 'medium';
        if (expiryDays !== null && expiryDays <= EXPIRY_HORIZON_DAYS) return 'low';
        return 'low';
    }

    function _suggest(item, avgDaily, expiryDays) {
        var lead = getLeadTime(item.name);
        var leadDemand = avgDaily * lead;
        var coverageDemand = avgDaily * targetCoverageDays;
        var target = (leadDemand * safetyStockMultiplier) + coverageDemand;

        // If we have no usage signal, default to topping back up to threshold * 2.
        if (avgDaily <= 0) {
            target = Math.max(item.reorderThreshold * 2, item.reorderThreshold + minOrderUnits);
        }

        // Don't over-order perishables: cap at what we can consume before expiry.
        if (expiryDays !== null && expiryDays > 0 && avgDaily > 0) {
            var consumable = avgDaily * expiryDays;
            if (consumable < target) target = consumable;
        }

        var deficit = Math.max(0, target - item.quantity);
        if (deficit > 0 && deficit < minOrderUnits) deficit = minOrderUnits;
        return _round2(deficit);
    }

    function _needsConsideration(item, stockoutDays, expiryDays) {
        if (item.quantity <= item.reorderThreshold) return true;
        if (stockoutDays !== null && stockoutDays <= targetCoverageDays) return true;
        if (expiryDays !== null && expiryDays <= EXPIRY_HORIZON_DAYS) return true;
        return false;
    }

    /**
     * Build a prioritized reorder plan for all qualifying items.
     * @param {Object} [filterOpts]
     * @param {string} [filterOpts.category] - Only consider items in this category.
     * @param {string} [filterOpts.priority] - Minimum priority to include (critical|high|medium|low).
     * @returns {Object} Plan with recommendations[], summary, totals.
     */
    function buildPlan(filterOpts) {
        filterOpts = filterOpts || {};
        var minRank = filterOpts.priority ? PRIORITY_RANK[filterOpts.priority] : PRIORITY_RANK.low;
        if (minRank === undefined) {
            throw new Error('Unknown priority filter: ' + filterOpts.priority);
        }

        var items = inventory.listItems(filterOpts.category) || [];
        var recs = [];
        var totalCost = 0;
        var counts = { critical: 0, high: 0, medium: 0, low: 0 };

        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var avgDaily = _avgDaily(item.name);
            var lead = getLeadTime(item.name);
            var stockoutDays = avgDaily > 0 ? _round2(item.quantity / avgDaily) : null;
            var expiryDays = _expiryDaysAway(item);

            if (!_needsConsideration(item, stockoutDays, expiryDays)) continue;

            var priority = _classify(stockoutDays, expiryDays, item);
            if (PRIORITY_RANK[priority] > minRank) continue;

            var qty = _suggest(item, avgDaily, expiryDays);
            if (qty <= 0 && priority === 'low') continue;

            var unitCost = _isPosNumber(item.unitCost) ? item.unitCost : 0;
            var estimatedCost = _round2(qty * unitCost);
            totalCost += estimatedCost;
            counts[priority]++;

            var reasons = [];
            if (item.quantity <= 0) reasons.push('out_of_stock');
            else if (item.quantity <= item.reorderThreshold) reasons.push('below_threshold');
            if (stockoutDays !== null && stockoutDays <= lead) reasons.push('lead_time_risk');
            if (expiryDays !== null && expiryDays <= 0) reasons.push('expired');
            else if (expiryDays !== null && expiryDays <= EXPIRY_HORIZON_DAYS) reasons.push('expiring_soon');
            if (reasons.length === 0) reasons.push('coverage_top_up');

            recs.push({
                name: item.name,
                category: item.category,
                priority: priority,
                currentStock: item.quantity,
                unit: item.unit,
                reorderThreshold: item.reorderThreshold,
                avgDailyUsage: avgDaily > 0 ? avgDaily : null,
                daysUntilStockout: stockoutDays,
                leadTimeDays: lead,
                expiryDays: expiryDays,
                suggestedQuantity: qty,
                estimatedCost: estimatedCost,
                supplier: supplierMap[item.name] || null,
                reasons: reasons
            });
        }

        recs.sort(function (a, b) {
            var d = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
            if (d !== 0) return d;
            var ad = a.daysUntilStockout == null ? Infinity : a.daysUntilStockout;
            var bd = b.daysUntilStockout == null ? Infinity : b.daysUntilStockout;
            return ad - bd;
        });

        return {
            generatedAt: new Date().toISOString(),
            settings: {
                defaultLeadTimeDays: defaultLeadTimeDays,
                safetyStockMultiplier: safetyStockMultiplier,
                targetCoverageDays: targetCoverageDays
            },
            counts: counts,
            totalEstimatedCost: _round2(totalCost),
            recommendations: recs
        };
    }

    /**
     * Simulate accepting a plan: returns post-restock stock levels and
     * projected days of coverage per item, without mutating inventory.
     */
    function simulate(plan) {
        if (!plan || !Array.isArray(plan.recommendations)) {
            throw new Error('simulate requires a plan from buildPlan()');
        }
        var rows = plan.recommendations.map(function (r) {
            var newStock = _round2(r.currentStock + r.suggestedQuantity);
            var coverage = r.avgDailyUsage && r.avgDailyUsage > 0
                ? _round2(newStock / r.avgDailyUsage)
                : null;
            return {
                name: r.name,
                priority: r.priority,
                before: r.currentStock,
                after: newStock,
                unit: r.unit,
                projectedCoverageDays: coverage,
                cost: r.estimatedCost
            };
        });
        var totalSpend = rows.reduce(function (a, b) { return a + (b.cost || 0); }, 0);
        return {
            generatedAt: new Date().toISOString(),
            itemCount: rows.length,
            totalSpend: _round2(totalSpend),
            items: rows
        };
    }

    /**
     * Render a plan as a human-readable purchase-order draft (plain text).
     */
    function formatPurchaseOrder(plan) {
        if (!plan || !Array.isArray(plan.recommendations)) {
            throw new Error('formatPurchaseOrder requires a plan from buildPlan()');
        }
        var lines = [];
        lines.push('BioBots Reorder Plan - ' + plan.generatedAt);
        lines.push('Items: ' + plan.recommendations.length +
            '  |  Total estimated cost: $' + plan.totalEstimatedCost.toFixed(2));
        lines.push('Priority counts: critical=' + plan.counts.critical +
            ', high=' + plan.counts.high +
            ', medium=' + plan.counts.medium +
            ', low=' + plan.counts.low);
        lines.push('');
        lines.push('  #  PRIORITY   ITEM                            ORDER         COST    SUPPLIER');
        lines.push('  -- ---------- ------------------------------- ------------- ------- ----------------');
        plan.recommendations.forEach(function (r, i) {
            var idx = String(i + 1).padStart(2, '0');
            var pr = r.priority.padEnd(10);
            var nm = r.name.length > 31 ? r.name.slice(0, 28) + '...' : r.name.padEnd(31);
            var qty = (r.suggestedQuantity + ' ' + r.unit).padEnd(13);
            var cost = ('$' + r.estimatedCost.toFixed(2)).padEnd(7);
            var sup = r.supplier || '-';
            lines.push('  ' + idx + ' ' + pr + ' ' + nm + ' ' + qty + ' ' + cost + ' ' + sup);
        });
        return lines.join('\n');
    }

    return {
        setLeadTime: setLeadTime,
        getLeadTime: getLeadTime,
        setSupplier: setSupplier,
        buildPlan: buildPlan,
        simulate: simulate,
        formatPurchaseOrder: formatPurchaseOrder,
        PRIORITIES: ['critical', 'high', 'medium', 'low']
    };
}

module.exports = {
    createSmartReorderAdvisor: createSmartReorderAdvisor
};
