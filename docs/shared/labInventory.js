'use strict';

/**
 * Lab Inventory Manager — Track bioink stock, consumables, and reagents
 * with low-stock alerts, usage logging, and consumption forecasting.
 *
 * @example
 *   var inv = require('./labInventory').createLabInventoryManager();
 *   inv.addItem({ name: 'Alginate 2%', category: 'bioink', quantity: 50, unit: 'mL', reorderThreshold: 10 });
 *   inv.recordUsage('Alginate 2%', 5, 'Print run #42');
 *   inv.getLowStockAlerts();  // items below threshold
 *   inv.getForecast('Alginate 2%', 7);  // 7-day usage forecast
 */

var CATEGORIES = ['bioink', 'crosslinker', 'reagent', 'consumable', 'scaffold', 'media', 'other'];

/** @private Keys that must never be used as item names to prevent prototype pollution. */
var DANGEROUS_KEYS = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };

function createLabInventoryManager() {
    var items = Object.create(null);  // prototype-free map: name -> item record
    var usageLog = [];                // chronological usage entries

    /**
     * Validate that an item name is safe (non-empty string, not a dangerous key).
     * @private
     * @param {string} name
     * @returns {string} The validated name.
     * @throws {Error} If name is invalid or dangerous.
     */
    function _validateName(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Item name is required');
        }
        if (DANGEROUS_KEYS[name]) {
            throw new Error('Item name is reserved and cannot be used: ' + name);
        }
        return name;
    }

    /**
     * Add or update an inventory item.
     * @param {Object} opts
     * @param {string} opts.name - Unique item name
     * @param {string} opts.category - One of CATEGORIES
     * @param {number} opts.quantity - Current stock quantity
     * @param {string} opts.unit - Unit of measure (mL, g, units, etc.)
     * @param {number} [opts.reorderThreshold=0] - Low-stock alert threshold
     * @param {string} [opts.lotNumber] - Lot/batch identifier
     * @param {string} [opts.expiryDate] - ISO date string for expiry
     * @param {number} [opts.unitCost=0] - Cost per unit
     */
    function addItem(opts) {
        if (!opts || !opts.name || typeof opts.name !== 'string') {
            throw new Error('Item name is required');
        }
        _validateName(opts.name);
        if (!opts.category || CATEGORIES.indexOf(opts.category) === -1) {
            throw new Error('Category must be one of: ' + CATEGORIES.join(', '));
        }
        if (typeof opts.quantity !== 'number' || opts.quantity < 0) {
            throw new Error('Quantity must be a non-negative number');
        }
        if (!opts.unit || typeof opts.unit !== 'string') {
            throw new Error('Unit is required');
        }

        var existing = items[opts.name];
        items[opts.name] = {
            name: opts.name,
            category: opts.category,
            quantity: opts.quantity,
            unit: opts.unit,
            reorderThreshold: opts.reorderThreshold || 0,
            lotNumber: opts.lotNumber || null,
            expiryDate: opts.expiryDate || null,
            unitCost: opts.unitCost || 0,
            addedAt: existing ? existing.addedAt : new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        return items[opts.name];
    }

    /**
     * Remove an item from inventory.
     */
    function removeItem(name) {
        _validateName(name);
        if (!items[name]) {
            throw new Error('Item not found: ' + name);
        }
        var removed = items[name];
        delete items[name];
        return removed;
    }

    /**
     * Record usage of an item (decrements stock).
     * @param {string} name - Item name
     * @param {number} amount - Amount used
     * @param {string} [note] - Usage note (print job, experiment, etc.)
     * @returns {Object} Updated item record
     */
    function recordUsage(name, amount, note) {
        _validateName(name);
        if (!items[name]) {
            throw new Error('Item not found: ' + name);
        }
        if (typeof amount !== 'number' || amount <= 0) {
            throw new Error('Usage amount must be a positive number');
        }
        if (amount > items[name].quantity) {
            throw new Error('Insufficient stock: have ' + items[name].quantity + ' ' + items[name].unit + ', tried to use ' + amount);
        }

        items[name].quantity -= amount;
        items[name].updatedAt = new Date().toISOString();

        usageLog.push({
            name: name,
            amount: amount,
            note: note || '',
            timestamp: new Date().toISOString(),
            remainingAfter: items[name].quantity
        });

        return items[name];
    }

    /**
     * Record a restock (increments stock).
     */
    function recordRestock(name, amount, lotNumber) {
        _validateName(name);
        if (!items[name]) {
            throw new Error('Item not found: ' + name);
        }
        if (typeof amount !== 'number' || amount <= 0) {
            throw new Error('Restock amount must be a positive number');
        }

        items[name].quantity += amount;
        if (lotNumber) { items[name].lotNumber = lotNumber; }
        items[name].updatedAt = new Date().toISOString();

        usageLog.push({
            name: name,
            amount: -amount,  // negative = restock
            note: 'Restock' + (lotNumber ? ' (lot: ' + lotNumber + ')' : ''),
            timestamp: new Date().toISOString(),
            remainingAfter: items[name].quantity
        });

        return items[name];
    }

    /**
     * Get item by name.
     */
    function getItem(name) {
        return items[name] || null;
    }

    /**
     * List all items, optionally filtered by category.
     */
    function listItems(category) {
        var result = [];
        var keys = Object.keys(items);
        for (var i = 0; i < keys.length; i++) {
            if (!category || items[keys[i]].category === category) {
                result.push(items[keys[i]]);
            }
        }
        return result;
    }

    /**
     * Get items below their reorder threshold.
     */
    function getLowStockAlerts() {
        var alerts = [];
        var keys = Object.keys(items);
        for (var i = 0; i < keys.length; i++) {
            var item = items[keys[i]];
            if (item.quantity <= item.reorderThreshold) {
                alerts.push({
                    name: item.name,
                    category: item.category,
                    quantity: item.quantity,
                    unit: item.unit,
                    reorderThreshold: item.reorderThreshold,
                    deficit: item.reorderThreshold - item.quantity
                });
            }
        }
        return alerts.sort(function(a, b) { return a.deficit - b.deficit; });
    }

    /**
     * Get items that are expired or expiring within the given days.
     */
    function getExpiryAlerts(withinDays) {
        withinDays = withinDays || 30;
        var now = new Date();
        var cutoff = new Date(now.getTime() + withinDays * 86400000);
        var alerts = [];
        var keys = Object.keys(items);
        for (var i = 0; i < keys.length; i++) {
            var item = items[keys[i]];
            if (item.expiryDate) {
                var exp = new Date(item.expiryDate);
                if (exp <= cutoff) {
                    alerts.push({
                        name: item.name,
                        category: item.category,
                        quantity: item.quantity,
                        unit: item.unit,
                        expiryDate: item.expiryDate,
                        expired: exp <= now,
                        daysUntilExpiry: Math.ceil((exp - now) / 86400000)
                    });
                }
            }
        }
        return alerts.sort(function(a, b) { return a.daysUntilExpiry - b.daysUntilExpiry; });
    }

    /**
     * Get usage history for an item.
     */
    function getUsageHistory(name, limit) {
        var history = [];
        for (var i = 0; i < usageLog.length; i++) {
            if (usageLog[i].name === name && usageLog[i].amount > 0) {
                history.push(usageLog[i]);
            }
        }
        if (limit) { history = history.slice(-limit); }
        return history;
    }

    /**
     * Forecast consumption for an item over the next N days
     * based on average daily usage from usage history.
     * @param {string} name - Item name
     * @param {number} days - Forecast horizon in days
     * @returns {Object} Forecast with avgDaily, projected usage, days until stockout
     */
    function getForecast(name, days) {
        _validateName(name);
        if (!items[name]) {
            throw new Error('Item not found: ' + name);
        }
        days = days || 7;

        var usages = [];
        for (var i = 0; i < usageLog.length; i++) {
            if (usageLog[i].name === name && usageLog[i].amount > 0) {
                usages.push(usageLog[i]);
            }
        }

        if (usages.length < 2) {
            return {
                name: name,
                currentStock: items[name].quantity,
                unit: items[name].unit,
                forecastDays: days,
                avgDailyUsage: null,
                projectedUsage: null,
                daysUntilStockout: null,
                confidence: 'insufficient_data',
                message: 'Need at least 2 usage records to forecast'
            };
        }

        var firstTs = new Date(usages[0].timestamp).getTime();
        var lastTs = new Date(usages[usages.length - 1].timestamp).getTime();
        var spanDays = Math.max((lastTs - firstTs) / 86400000, 1);

        var totalUsed = 0;
        for (var j = 0; j < usages.length; j++) {
            totalUsed += usages[j].amount;
        }

        var avgDaily = totalUsed / spanDays;
        var projected = avgDaily * days;
        var daysUntilStockout = avgDaily > 0 ? items[name].quantity / avgDaily : Infinity;

        return {
            name: name,
            currentStock: items[name].quantity,
            unit: items[name].unit,
            forecastDays: days,
            avgDailyUsage: Math.round(avgDaily * 100) / 100,
            projectedUsage: Math.round(projected * 100) / 100,
            daysUntilStockout: daysUntilStockout === Infinity ? null : Math.round(daysUntilStockout * 10) / 10,
            confidence: usages.length >= 10 ? 'high' : usages.length >= 5 ? 'medium' : 'low',
            dataPoints: usages.length
        };
    }

    /**
     * Get total inventory value.
     */
    function getInventoryValue(category) {
        var total = 0;
        var breakdown = {};
        var keys = Object.keys(items);
        for (var i = 0; i < keys.length; i++) {
            var item = items[keys[i]];
            if (!category || item.category === category) {
                var val = item.quantity * item.unitCost;
                total += val;
                if (!breakdown[item.category]) { breakdown[item.category] = 0; }
                breakdown[item.category] += val;
            }
        }
        return {
            totalValue: Math.round(total * 100) / 100,
            breakdown: breakdown,
            itemCount: keys.length
        };
    }

    /**
     * Generate a summary report of current inventory state.
     */
    function getSummary() {
        var all = listItems();
        var lowStock = getLowStockAlerts();
        var expiring = getExpiryAlerts(30);
        var value = getInventoryValue();

        var byCategory = {};
        for (var i = 0; i < all.length; i++) {
            if (!byCategory[all[i].category]) { byCategory[all[i].category] = 0; }
            byCategory[all[i].category]++;
        }

        return {
            totalItems: all.length,
            byCategory: byCategory,
            lowStockCount: lowStock.length,
            expiringCount: expiring.length,
            totalValue: value.totalValue,
            valueBreakdown: value.breakdown,
            generatedAt: new Date().toISOString()
        };
    }

    return {
        addItem: addItem,
        removeItem: removeItem,
        recordUsage: recordUsage,
        recordRestock: recordRestock,
        getItem: getItem,
        listItems: listItems,
        getLowStockAlerts: getLowStockAlerts,
        getExpiryAlerts: getExpiryAlerts,
        getUsageHistory: getUsageHistory,
        getForecast: getForecast,
        getInventoryValue: getInventoryValue,
        getSummary: getSummary,
        CATEGORIES: CATEGORIES
    };
}

module.exports = {
    createLabInventoryManager: createLabInventoryManager
};
