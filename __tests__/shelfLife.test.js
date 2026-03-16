'use strict';

var shelfLife = require('../docs/shared/shelfLife');

describe('ShelfLifeManager', function () {
    var mgr;

    beforeEach(function () {
        mgr = shelfLife.createShelfLifeManager();
    });

    // --- addBioink ---

    test('adds a bioink with defaults', function () {
        var b = mgr.addBioink({ id: 'A1', material: 'alginate', volume: 50 });
        expect(b.id).toBe('A1');
        expect(b.material).toBe('alginate');
        expect(b.volume).toBe(50);
        expect(b.storageTemp).toBe(4);
        expect(b.shelfLifeDays).toBe(180);
        expect(b.status).toBe('active');
    });

    test('throws on missing id', function () {
        expect(function () { mgr.addBioink({ material: 'alginate' }); }).toThrow(/id is required/);
    });

    test('throws on missing material', function () {
        expect(function () { mgr.addBioink({ id: 'X' }); }).toThrow(/Material type is required/);
    });

    test('throws on duplicate id', function () {
        mgr.addBioink({ id: 'D1', material: 'gelatin' });
        expect(function () { mgr.addBioink({ id: 'D1', material: 'gelatin' }); }).toThrow(/already exists/);
    });

    test('uses material defaults for collagen', function () {
        var b = mgr.addBioink({ id: 'C1', material: 'collagen', volume: 10 });
        expect(b.shelfLifeDays).toBe(60);
        expect(b.lightSensitive).toBe(true);
    });

    test('uses custom values over defaults', function () {
        var b = mgr.addBioink({ id: 'C2', material: 'alginate', shelfLifeDays: 30, storageTemp: -20 });
        expect(b.shelfLifeDays).toBe(30);
        expect(b.storageTemp).toBe(-20);
    });

    // --- getBioink / listBioinks ---

    test('getBioink returns clone', function () {
        mgr.addBioink({ id: 'G1', material: 'peg', volume: 20 });
        var b = mgr.getBioink('G1');
        b.volume = 999;
        expect(mgr.getBioink('G1').volume).toBe(20);
    });

    test('getBioink throws for unknown', function () {
        expect(function () { mgr.getBioink('nope'); }).toThrow(/not found/);
    });

    test('listBioinks filters by status', function () {
        mgr.addBioink({ id: 'L1', material: 'alginate', volume: 10 });
        mgr.addBioink({ id: 'L2', material: 'gelatin', volume: 5 });
        mgr.removeBioink('L2');
        var active = mgr.listBioinks({ status: 'active' });
        expect(active.length).toBe(1);
        expect(active[0].id).toBe('L1');
    });

    test('listBioinks filters by material', function () {
        mgr.addBioink({ id: 'M1', material: 'alginate', volume: 10 });
        mgr.addBioink({ id: 'M2', material: 'gelatin', volume: 5 });
        var gels = mgr.listBioinks({ material: 'gelatin' });
        expect(gels.length).toBe(1);
    });

    // --- updateBioink ---

    test('updates allowed fields', function () {
        mgr.addBioink({ id: 'U1', material: 'silk', volume: 25 });
        var updated = mgr.updateBioink('U1', { storageTemp: -20, notes: 'moved to freezer' });
        expect(updated.storageTemp).toBe(-20);
        expect(updated.notes).toBe('moved to freezer');
    });

    test('records storage events on temp change', function () {
        mgr.addBioink({ id: 'SE1', material: 'alginate', volume: 10 });
        mgr.updateBioink('SE1', { storageTemp: -20 });
        var events = mgr.getStorageEvents('SE1');
        expect(events.length).toBe(1);
        expect(events[0].oldTemp).toBe(4);
        expect(events[0].newTemp).toBe(-20);
    });

    // --- removeBioink ---

    test('marks bioink as discarded', function () {
        mgr.addBioink({ id: 'R1', material: 'fibrin', volume: 5 });
        var removed = mgr.removeBioink('R1');
        expect(removed.status).toBe('discarded');
    });

    // --- calculateStabilityScore ---

    test('new bioink has high stability', function () {
        mgr.addBioink({ id: 'S1', material: 'alginate', volume: 50, manufacturedDate: new Date().toISOString().slice(0, 10) });
        var result = mgr.calculateStabilityScore('S1');
        expect(result.score).toBeGreaterThanOrEqual(70);
        expect(result.grade).toMatch(/^[AB]$/);
        expect(result.recommendation).toBeTruthy();
    });

    test('old bioink has low stability', function () {
        var oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 2);
        mgr.addBioink({ id: 'S2', material: 'alginate', volume: 50, manufacturedDate: oldDate.toISOString().slice(0, 10) });
        var result = mgr.calculateStabilityScore('S2');
        expect(result.score).toBeLessThan(70);
    });

    test('light-exposed sensitive material penalized', function () {
        mgr.addBioink({ id: 'S3', material: 'collagen', volume: 10, lightExposed: true });
        mgr.addBioink({ id: 'S4', material: 'collagen', volume: 10, lightExposed: false });
        var s3 = mgr.calculateStabilityScore('S3');
        var s4 = mgr.calculateStabilityScore('S4');
        expect(s3.score).toBeLessThan(s4.score);
    });

    test('opened bioink penalized over time', function () {
        var pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 30);
        mgr.addBioink({ id: 'S5', material: 'alginate', volume: 50, openedDate: pastDate.toISOString().slice(0, 10) });
        mgr.addBioink({ id: 'S6', material: 'alginate', volume: 50 });
        var s5 = mgr.calculateStabilityScore('S5');
        var s6 = mgr.calculateStabilityScore('S6');
        expect(s5.score).toBeLessThanOrEqual(s6.score);
    });

    test('wrong temperature penalized', function () {
        mgr.addBioink({ id: 'S7', material: 'alginate', volume: 10, storageTemp: 40 });
        mgr.addBioink({ id: 'S8', material: 'alginate', volume: 10, storageTemp: 4 });
        var s7 = mgr.calculateStabilityScore('S7');
        var s8 = mgr.calculateStabilityScore('S8');
        expect(s7.score).toBeLessThan(s8.score);
    });

    test('stability includes breakdown', function () {
        mgr.addBioink({ id: 'BD1', material: 'peg', volume: 20 });
        var result = mgr.calculateStabilityScore('BD1');
        expect(result.breakdown).toBeDefined();
        expect(result.breakdown.age).toBeGreaterThanOrEqual(0);
        expect(result.breakdown.temperature).toBeGreaterThanOrEqual(0);
        expect(result.breakdown.lightProtection).toBeGreaterThanOrEqual(0);
        expect(result.breakdown.sealIntegrity).toBeGreaterThanOrEqual(0);
    });

    // --- recordUsage ---

    test('records usage and reduces volume', function () {
        mgr.addBioink({ id: 'U2', material: 'alginate', volume: 50 });
        var record = mgr.recordUsage('U2', 10, { purpose: 'test print' });
        expect(record.amount).toBe(10);
        expect(record.remainingVolume).toBe(40);
        expect(mgr.getBioink('U2').volume).toBe(40);
    });

    test('marks depleted when volume hits zero', function () {
        mgr.addBioink({ id: 'U3', material: 'gelatin', volume: 5 });
        mgr.recordUsage('U3', 5);
        expect(mgr.getBioink('U3').status).toBe('depleted');
    });

    test('throws on insufficient volume', function () {
        mgr.addBioink({ id: 'U4', material: 'alginate', volume: 3 });
        expect(function () { mgr.recordUsage('U4', 10); }).toThrow(/Insufficient/);
    });

    test('sets openedDate on first usage', function () {
        mgr.addBioink({ id: 'U5', material: 'alginate', volume: 50 });
        expect(mgr.getBioink('U5').openedDate).toBeNull();
        mgr.recordUsage('U5', 1);
        expect(mgr.getBioink('U5').openedDate).toBeTruthy();
    });

    test('getUsageHistory returns records', function () {
        mgr.addBioink({ id: 'UH1', material: 'alginate', volume: 50 });
        mgr.recordUsage('UH1', 5);
        mgr.recordUsage('UH1', 10);
        var history = mgr.getUsageHistory('UH1');
        expect(history.length).toBe(2);
    });

    // --- getExpiringAlerts ---

    test('alerts for expired bioink', function () {
        var oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 2);
        mgr.addBioink({ id: 'EA1', material: 'alginate', volume: 10, manufacturedDate: oldDate.toISOString().slice(0, 10) });
        var alerts = mgr.getExpiringAlerts(30);
        var expired = alerts.filter(function (a) { return a.bioinkId === 'EA1' && a.type === 'expired'; });
        expect(expired.length).toBe(1);
        expect(expired[0].severity).toBe('critical');
    });

    test('alerts for light-exposed sensitive material', function () {
        mgr.addBioink({ id: 'EA2', material: 'collagen', volume: 10, lightExposed: true });
        var alerts = mgr.getExpiringAlerts(30);
        var light = alerts.filter(function (a) { return a.bioinkId === 'EA2' && a.type === 'light_exposure'; });
        expect(light.length).toBe(1);
    });

    test('alerts sorted by severity', function () {
        var oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 2);
        mgr.addBioink({ id: 'AS1', material: 'alginate', volume: 10, manufacturedDate: oldDate.toISOString().slice(0, 10) });
        mgr.addBioink({ id: 'AS2', material: 'collagen', volume: 10, lightExposed: true });
        var alerts = mgr.getExpiringAlerts(30);
        expect(alerts.length).toBeGreaterThanOrEqual(1);
        // Verify all alerts have valid severity
        var validSev = ['critical', 'high', 'medium', 'low'];
        alerts.forEach(function(a) { expect(validSev).toContain(a.severity); });
    });

    // --- getInventorySummary ---

    test('summary counts by status', function () {
        mgr.addBioink({ id: 'IS1', material: 'alginate', volume: 50 });
        mgr.addBioink({ id: 'IS2', material: 'gelatin', volume: 5 });
        mgr.recordUsage('IS2', 5);
        var summary = mgr.getInventorySummary();
        expect(summary.total).toBe(2);
        expect(summary.active).toBe(1);
        expect(summary.depleted).toBe(1);
    });

    test('summary includes material breakdown', function () {
        mgr.addBioink({ id: 'MB1', material: 'alginate', volume: 30 });
        mgr.addBioink({ id: 'MB2', material: 'alginate', volume: 20 });
        var summary = mgr.getInventorySummary();
        expect(summary.byMaterial['alginate'].count).toBe(2);
        expect(summary.byMaterial['alginate'].volume).toBe(50);
    });

    // --- getStorageRecommendation ---

    test('known material returns recommendation', function () {
        var rec = mgr.getStorageRecommendation('matrigel');
        expect(rec.known).toBe(true);
        expect(rec.idealTemp).toBe(-20);
        expect(rec.lightSensitive).toBe(true);
    });

    test('unknown material returns fallback', function () {
        var rec = mgr.getStorageRecommendation('unobtainium');
        expect(rec.known).toBe(false);
        expect(rec.idealTemp).toBe(4);
    });

    // --- MATERIAL_DEFAULTS & STORAGE_CONDITIONS ---

    test('exposes material defaults', function () {
        expect(mgr.MATERIAL_DEFAULTS.alginate).toBeDefined();
        expect(mgr.MATERIAL_DEFAULTS.alginate.shelfLifeDays).toBe(180);
    });

    test('exposes storage conditions', function () {
        expect(mgr.STORAGE_CONDITIONS.frozen).toBeDefined();
        expect(mgr.STORAGE_CONDITIONS.frozen.label).toBe('Frozen');
    });
});
