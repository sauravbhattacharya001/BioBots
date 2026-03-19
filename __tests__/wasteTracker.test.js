'use strict';

var wasteTracker = require('../docs/shared/wasteTracker');

describe('Waste Tracker', function () {
    var wt;

    beforeEach(function () {
        wt = wasteTracker.createWasteTracker();
    });

    test('WASTE_TYPES contains expected types', function () {
        expect(wt.WASTE_TYPES).toContain('purge');
        expect(wt.WASTE_TYPES).toContain('failed_print');
        expect(wt.WASTE_TYPES).toContain('leftover');
        expect(wt.WASTE_TYPES).toContain('expired');
        expect(wt.WASTE_TYPES).toContain('contaminated');
        expect(wt.WASTE_TYPES.length).toBe(7);
    });

    test('logWaste creates entry with correct fields', function () {
        var entry = wt.logWaste({ jobId: 'J-1', material: 'alginate', wasteType: 'purge', volumeMl: 0.5, costPerMl: 2 });
        expect(entry.id).toBe(1);
        expect(entry.material).toBe('alginate');
        expect(entry.cost).toBe(1);
        expect(entry.wasteType).toBe('purge');
    });

    test('logWaste throws on missing material', function () {
        expect(function () { wt.logWaste({ volumeMl: 1 }); }).toThrow('material is required');
    });

    test('logWaste throws on invalid wasteType', function () {
        expect(function () { wt.logWaste({ material: 'x', volumeMl: 1, wasteType: 'bad' }); }).toThrow(/Invalid wasteType/);
    });

    test('logWaste throws on negative volume', function () {
        expect(function () { wt.logWaste({ material: 'x', volumeMl: -1 }); }).toThrow();
    });

    test('getSummary returns breakdown by type and material', function () {
        wt.logWaste({ material: 'alginate', wasteType: 'purge', volumeMl: 0.5, costPerMl: 2 });
        wt.logWaste({ material: 'alginate', wasteType: 'leftover', volumeMl: 1.0, costPerMl: 2 });
        wt.logWaste({ material: 'collagen', wasteType: 'purge', volumeMl: 0.3, costPerMl: 5 });
        var s = wt.getSummary();
        expect(s.totalEntries).toBe(3);
        expect(s.totalVolumeMl).toBe(1.8);
        expect(s.totalCost).toBe(4.5);
        expect(s.byType.purge.count).toBe(2);
        expect(s.byMaterial.alginate.count).toBe(2);
        expect(s.byMaterial.collagen.count).toBe(1);
    });

    test('getSummary with filter', function () {
        wt.logWaste({ jobId: 'A', material: 'x', wasteType: 'purge', volumeMl: 1 });
        wt.logWaste({ jobId: 'B', material: 'x', wasteType: 'purge', volumeMl: 2 });
        var s = wt.getSummary({ jobId: 'A' });
        expect(s.totalEntries).toBe(1);
        expect(s.totalVolumeMl).toBe(1);
    });

    test('getWasteRate calculates correctly', function () {
        wt.logWaste({ material: 'x', wasteType: 'purge', volumeMl: 1 });
        var rate = wt.getWasteRate(9);
        expect(rate.wasteRatePct).toBe(10);
        expect(rate.rating).toBe('fair'); // 10% is at the boundary
    });

    test('getWasteRate rating tiers', function () {
        wt.logWaste({ material: 'x', wasteType: 'purge', volumeMl: 1 });
        expect(wt.getWasteRate(99).rating).toBe('excellent'); // 1%
        expect(wt.getWasteRate(19).rating).toBe('good');      // 5%
        expect(wt.getWasteRate(5).rating).toBe('fair');        // ~17%
        expect(wt.getWasteRate(1).rating).toBe('poor');        // 50%
    });

    test('getTopWasteSources sorts by volume descending', function () {
        wt.logWaste({ material: 'x', wasteType: 'purge', volumeMl: 1 });
        wt.logWaste({ material: 'x', wasteType: 'leftover', volumeMl: 5 });
        wt.logWaste({ material: 'x', wasteType: 'expired', volumeMl: 2 });
        var top = wt.getTopWasteSources(2);
        expect(top.length).toBe(2);
        expect(top[0].type).toBe('leftover');
        expect(top[1].type).toBe('expired');
    });

    test('getReductionTips returns tips for logged waste types', function () {
        wt.logWaste({ material: 'x', wasteType: 'purge', volumeMl: 1 });
        wt.logWaste({ material: 'x', wasteType: 'contaminated', volumeMl: 2 });
        var tips = wt.getReductionTips();
        expect(tips.length).toBe(2);
        expect(tips[0].wasteType).toBe('contaminated'); // higher volume first
        expect(tips[0].suggestions.length).toBeGreaterThan(0);
    });

    test('getJobWaste filters by jobId', function () {
        wt.logWaste({ jobId: 'J1', material: 'x', wasteType: 'purge', volumeMl: 1 });
        wt.logWaste({ jobId: 'J2', material: 'x', wasteType: 'purge', volumeMl: 2 });
        expect(wt.getJobWaste('J1').length).toBe(1);
    });

    test('exportData JSON', function () {
        wt.logWaste({ material: 'x', wasteType: 'purge', volumeMl: 1 });
        var json = JSON.parse(wt.exportData('json'));
        expect(json.length).toBe(1);
    });

    test('exportData CSV', function () {
        wt.logWaste({ material: 'x', wasteType: 'purge', volumeMl: 1 });
        var csv = wt.exportData('csv');
        expect(csv.split('\n').length).toBe(2);
        expect(csv).toContain('id,jobId,material');
    });

    test('clearEntries resets state', function () {
        wt.logWaste({ material: 'x', wasteType: 'purge', volumeMl: 1 });
        wt.clearEntries();
        expect(wt.getEntries().length).toBe(0);
        var e = wt.logWaste({ material: 'y', wasteType: 'purge', volumeMl: 1 });
        expect(e.id).toBe(1);
    });

    test('empty summary', function () {
        var s = wt.getSummary();
        expect(s.totalEntries).toBe(0);
        expect(s.totalVolumeMl).toBe(0);
    });
});
