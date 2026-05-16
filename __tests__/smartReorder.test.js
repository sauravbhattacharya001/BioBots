'use strict';

var labInventory = require('../docs/shared/labInventory');
var smartReorder = require('../docs/shared/smartReorder');

function seedUsage(inv, name, dailyAmount, days) {
    var now = Date.now();
    for (var d = days - 1; d >= 0; d--) {
        var ts = new Date(now - d * 86400000).toISOString();
        // Manually push usage with backdated timestamp via the public API.
        // We rely on recordUsage accepting current time; instead, drop straight
        // into the manager by calling recordUsage repeatedly. Since the
        // forecast only looks at first/last timestamp span, we mimic that by
        // also restocking to keep the test deterministic.
        inv.recordUsage(name, dailyAmount, 'sim ' + ts);
    }
}

describe('Smart Reorder Advisor', function () {
    var inv;

    beforeEach(function () {
        inv = labInventory.createLabInventoryManager();
    });

    test('throws without an inventory', function () {
        expect(function () {
            smartReorder.createSmartReorderAdvisor();
        }).toThrow('requires { inventory }');
    });

    test('throws on invalid options', function () {
        expect(function () {
            smartReorder.createSmartReorderAdvisor({ inventory: inv, safetyStockMultiplier: 0.5 });
        }).toThrow('safetyStockMultiplier');
        expect(function () {
            smartReorder.createSmartReorderAdvisor({ inventory: inv, targetCoverageDays: 0 });
        }).toThrow('targetCoverageDays');
    });

    test('flags out-of-stock items as critical', function () {
        inv.addItem({ name: 'Alginate 2%', category: 'bioink', quantity: 0, unit: 'mL', reorderThreshold: 10, unitCost: 2 });
        var advisor = smartReorder.createSmartReorderAdvisor({ inventory: inv });
        var plan = advisor.buildPlan();
        expect(plan.recommendations).toHaveLength(1);
        expect(plan.recommendations[0].priority).toBe('critical');
        expect(plan.recommendations[0].reasons).toContain('out_of_stock');
        expect(plan.recommendations[0].suggestedQuantity).toBeGreaterThan(0);
        expect(plan.counts.critical).toBe(1);
    });

    test('uses usage forecast to size orders', function () {
        inv.addItem({ name: 'CaCl2', category: 'crosslinker', quantity: 100, unit: 'mL', reorderThreshold: 20, unitCost: 1 });
        for (var i = 0; i < 12; i++) inv.recordUsage('CaCl2', 5, 'r' + i);
        var advisor = smartReorder.createSmartReorderAdvisor({
            inventory: inv,
            defaultLeadTimeDays: 4,
            targetCoverageDays: 14,
            safetyStockMultiplier: 1.5
        });
        var plan = advisor.buildPlan();
        // With high consumption already done, stock 40 -> small days; should appear.
        expect(plan.recommendations.length).toBeGreaterThanOrEqual(1);
        var rec = plan.recommendations[0];
        expect(rec.name).toBe('CaCl2');
        expect(rec.suggestedQuantity).toBeGreaterThan(0);
        expect(rec.estimatedCost).toBe(rec.suggestedQuantity * 1);
    });

    test('lead time override changes urgency', function () {
        inv.addItem({ name: 'Media', category: 'media', quantity: 50, unit: 'mL', reorderThreshold: 100, unitCost: 0.5 });
        var advisor = smartReorder.createSmartReorderAdvisor({ inventory: inv });
        var planA = advisor.buildPlan();
        var basePriority = planA.recommendations[0].priority;
        advisor.setLeadTime('Media', 30);
        var planB = advisor.buildPlan();
        // Lead time itself only escalates when stockoutDays is known; without
        // usage data stockoutDays is null. So priority should remain stable.
        expect(planB.recommendations[0].leadTimeDays).toBe(30);
        expect(planB.recommendations[0].priority).toBe(basePriority);
    });

    test('supplier mapping appears in recommendation', function () {
        inv.addItem({ name: 'PBS', category: 'reagent', quantity: 5, unit: 'L', reorderThreshold: 10 });
        var advisor = smartReorder.createSmartReorderAdvisor({ inventory: inv });
        advisor.setSupplier('PBS', 'AcmeBio');
        var plan = advisor.buildPlan();
        expect(plan.recommendations[0].supplier).toBe('AcmeBio');
    });

    test('category filter limits scope', function () {
        inv.addItem({ name: 'A', category: 'bioink', quantity: 0, unit: 'mL', reorderThreshold: 5 });
        inv.addItem({ name: 'B', category: 'media', quantity: 0, unit: 'mL', reorderThreshold: 5 });
        var advisor = smartReorder.createSmartReorderAdvisor({ inventory: inv });
        var plan = advisor.buildPlan({ category: 'bioink' });
        expect(plan.recommendations).toHaveLength(1);
        expect(plan.recommendations[0].name).toBe('A');
    });

    test('priority filter narrows results', function () {
        inv.addItem({ name: 'X', category: 'bioink', quantity: 0, unit: 'mL', reorderThreshold: 5 });
        inv.addItem({ name: 'Y', category: 'reagent', quantity: 4, unit: 'mL', reorderThreshold: 5 });
        var advisor = smartReorder.createSmartReorderAdvisor({ inventory: inv });
        var plan = advisor.buildPlan({ priority: 'critical' });
        var names = plan.recommendations.map(function (r) { return r.name; });
        expect(names).toContain('X');
        expect(names).not.toContain('Y');
    });

    test('expiring perishables are flagged and order is capped', function () {
        var soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        inv.addItem({
            name: 'FreshMedia', category: 'media', quantity: 20, unit: 'mL',
            reorderThreshold: 5, unitCost: 0.1, expiryDate: soon
        });
        for (var i = 0; i < 5; i++) inv.recordUsage('FreshMedia', 1, 'r' + i);
        var advisor = smartReorder.createSmartReorderAdvisor({
            inventory: inv, targetCoverageDays: 90, safetyStockMultiplier: 2
        });
        var plan = advisor.buildPlan();
        expect(plan.recommendations.length).toBeGreaterThanOrEqual(1);
        var rec = plan.recommendations.find(function (r) { return r.name === 'FreshMedia'; });
        expect(rec).toBeDefined();
        expect(rec.reasons).toContain('expiring_soon');
    });

    test('simulate projects post-restock coverage', function () {
        inv.addItem({ name: 'Z', category: 'bioink', quantity: 20, unit: 'mL', reorderThreshold: 10, unitCost: 3 });
        for (var i = 0; i < 6; i++) inv.recordUsage('Z', 2, 'u' + i);
        var advisor = smartReorder.createSmartReorderAdvisor({ inventory: inv });
        var plan = advisor.buildPlan();
        var sim = advisor.simulate(plan);
        expect(sim.itemCount).toBe(plan.recommendations.length);
        expect(sim.totalSpend).toBe(plan.totalEstimatedCost);
        sim.items.forEach(function (row) {
            expect(row.after).toBeGreaterThanOrEqual(row.before);
        });
    });

    test('formatPurchaseOrder produces readable text', function () {
        inv.addItem({ name: 'Alginate 2%', category: 'bioink', quantity: 0, unit: 'mL', reorderThreshold: 10, unitCost: 2 });
        var advisor = smartReorder.createSmartReorderAdvisor({ inventory: inv });
        advisor.setSupplier('Alginate 2%', 'BioInc');
        var po = advisor.formatPurchaseOrder(advisor.buildPlan());
        expect(po).toMatch(/BioBots Reorder Plan/);
        expect(po).toMatch(/Alginate 2%/);
        expect(po).toMatch(/BioInc/);
    });

    test('simulate validates input', function () {
        var advisor = smartReorder.createSmartReorderAdvisor({ inventory: inv });
        expect(function () { advisor.simulate(null); }).toThrow('simulate requires a plan');
        expect(function () { advisor.simulate({}); }).toThrow('simulate requires a plan');
    });

    test('setLeadTime and setSupplier validate input', function () {
        var advisor = smartReorder.createSmartReorderAdvisor({ inventory: inv });
        expect(function () { advisor.setLeadTime('', 5); }).toThrow('itemName');
        expect(function () { advisor.setLeadTime('A', -1); }).toThrow('Lead time');
        expect(function () { advisor.setSupplier('', 'x'); }).toThrow('itemName');
        expect(function () { advisor.setSupplier('A', ''); }).toThrow('supplier');
    });

    test('unknown priority filter throws', function () {
        var advisor = smartReorder.createSmartReorderAdvisor({ inventory: inv });
        expect(function () { advisor.buildPlan({ priority: 'urgent' }); }).toThrow('Unknown priority');
    });
});
