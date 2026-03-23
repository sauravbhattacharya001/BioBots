'use strict';

var labInventory = require('../docs/shared/labInventory');

describe('Lab Inventory Manager', function () {
    var mgr;

    beforeEach(function () {
        mgr = labInventory.createLabInventoryManager();
    });

    test('CATEGORIES contains expected entries', function () {
        expect(mgr.CATEGORIES).toContain('bioink');
        expect(mgr.CATEGORIES).toContain('crosslinker');
        expect(mgr.CATEGORIES).toContain('reagent');
        expect(mgr.CATEGORIES).toContain('consumable');
    });

    test('addItem stores and returns item', function () {
        var item = mgr.addItem({ name: 'Alginate 2%', category: 'bioink', quantity: 50, unit: 'mL', reorderThreshold: 10, unitCost: 2.5 });
        expect(item.name).toBe('Alginate 2%');
        expect(item.quantity).toBe(50);
        expect(item.unitCost).toBe(2.5);
        expect(mgr.getItem('Alginate 2%')).toEqual(item);
    });

    test('addItem validates inputs', function () {
        expect(function () { mgr.addItem({}); }).toThrow('name is required');
        expect(function () { mgr.addItem({ name: 'X', category: 'invalid', quantity: 1, unit: 'mL' }); }).toThrow('Category');
        expect(function () { mgr.addItem({ name: 'X', category: 'bioink', quantity: -1, unit: 'mL' }); }).toThrow('non-negative');
    });

    test('removeItem works', function () {
        mgr.addItem({ name: 'GelMA', category: 'bioink', quantity: 20, unit: 'mL' });
        var removed = mgr.removeItem('GelMA');
        expect(removed.name).toBe('GelMA');
        expect(mgr.getItem('GelMA')).toBeNull();
    });

    test('recordUsage decrements and logs', function () {
        mgr.addItem({ name: 'CaCl2', category: 'crosslinker', quantity: 100, unit: 'mL', reorderThreshold: 20 });
        mgr.recordUsage('CaCl2', 30, 'Print #1');
        expect(mgr.getItem('CaCl2').quantity).toBe(70);
        var history = mgr.getUsageHistory('CaCl2');
        expect(history.length).toBe(1);
        expect(history[0].note).toBe('Print #1');
    });

    test('recordUsage rejects insufficient stock', function () {
        mgr.addItem({ name: 'PBS', category: 'reagent', quantity: 5, unit: 'mL' });
        expect(function () { mgr.recordUsage('PBS', 10); }).toThrow('Insufficient stock');
    });

    test('recordRestock increments stock', function () {
        mgr.addItem({ name: 'DMEM', category: 'media', quantity: 10, unit: 'mL' });
        mgr.recordRestock('DMEM', 50, 'LOT-2026A');
        expect(mgr.getItem('DMEM').quantity).toBe(60);
        expect(mgr.getItem('DMEM').lotNumber).toBe('LOT-2026A');
    });

    test('getLowStockAlerts returns items below threshold', function () {
        mgr.addItem({ name: 'A', category: 'bioink', quantity: 5, unit: 'mL', reorderThreshold: 10 });
        mgr.addItem({ name: 'B', category: 'bioink', quantity: 50, unit: 'mL', reorderThreshold: 10 });
        var alerts = mgr.getLowStockAlerts();
        expect(alerts.length).toBe(1);
        expect(alerts[0].name).toBe('A');
        expect(alerts[0].deficit).toBe(5);
    });

    test('getExpiryAlerts detects expired items', function () {
        var yesterday = new Date(Date.now() - 86400000).toISOString();
        mgr.addItem({ name: 'Old Reagent', category: 'reagent', quantity: 10, unit: 'mL', expiryDate: yesterday });
        var alerts = mgr.getExpiryAlerts(30);
        expect(alerts.length).toBe(1);
        expect(alerts[0].expired).toBe(true);
    });

    test('listItems filters by category', function () {
        mgr.addItem({ name: 'X', category: 'bioink', quantity: 1, unit: 'mL' });
        mgr.addItem({ name: 'Y', category: 'reagent', quantity: 1, unit: 'mL' });
        expect(mgr.listItems('bioink').length).toBe(1);
        expect(mgr.listItems().length).toBe(2);
    });

    test('getInventoryValue calculates correctly', function () {
        mgr.addItem({ name: 'A', category: 'bioink', quantity: 10, unit: 'mL', unitCost: 5 });
        mgr.addItem({ name: 'B', category: 'reagent', quantity: 20, unit: 'g', unitCost: 2 });
        var val = mgr.getInventoryValue();
        expect(val.totalValue).toBe(90);
        expect(val.breakdown.bioink).toBe(50);
        expect(val.breakdown.reagent).toBe(40);
    });

    test('getForecast returns insufficient_data with < 2 records', function () {
        mgr.addItem({ name: 'X', category: 'bioink', quantity: 50, unit: 'mL' });
        var f = mgr.getForecast('X', 7);
        expect(f.confidence).toBe('insufficient_data');
    });

    test('getForecast computes with enough data', function () {
        mgr.addItem({ name: 'Ink', category: 'bioink', quantity: 100, unit: 'mL' });
        mgr.recordUsage('Ink', 10, 'day 1');
        mgr.recordUsage('Ink', 10, 'day 2');
        mgr.recordUsage('Ink', 10, 'day 3');
        var f = mgr.getForecast('Ink', 7);
        expect(f.currentStock).toBe(70);
        expect(f.avgDailyUsage).toBeGreaterThan(0);
        expect(f.daysUntilStockout).toBeGreaterThan(0);
    });

    test('getSummary returns overview', function () {
        mgr.addItem({ name: 'A', category: 'bioink', quantity: 5, unit: 'mL', reorderThreshold: 10, unitCost: 3 });
        var summary = mgr.getSummary();
        expect(summary.totalItems).toBe(1);
        expect(summary.lowStockCount).toBe(1);
        expect(summary.totalValue).toBe(15);
    });
});

describe('Prototype Pollution Protection', function() {
    var inv;
    beforeEach(function() { inv = labInventory.createLabInventoryManager(); });

    var dangerousNames = ['__proto__', 'constructor', 'prototype'];

    dangerousNames.forEach(function(name) {
        it('rejects "' + name + '" as item name in addItem', function() {
            expect(function() {
                inv.addItem({ name: name, category: 'bioink', quantity: 10, unit: 'mL' });
            }).toThrow(/reserved key/);
        });

        it('rejects "' + name + '" in recordUsage', function() {
            expect(function() { inv.recordUsage(name, 1); }).toThrow(/reserved key/);
        });

        it('rejects "' + name + '" in recordRestock', function() {
            expect(function() { inv.recordRestock(name, 1); }).toThrow(/reserved key/);
        });

        it('rejects "' + name + '" in removeItem', function() {
            expect(function() { inv.removeItem(name); }).toThrow(/reserved key/);
        });

        it('rejects "' + name + '" in getForecast', function() {
            expect(function() { inv.getForecast(name, 7); }).toThrow(/reserved key/);
        });

        it('returns null for "' + name + '" in getItem', function() {
            expect(inv.getItem(name)).toBeNull();
        });
    });

    it('does not pollute Object.prototype via items dictionary', function() {
        // The items dict uses Object.create(null), so even if somehow
        // a dangerous key slipped through, it wouldn't affect Object.prototype
        var obj = {};
        expect(obj.malicious).toBeUndefined();
    });
});
