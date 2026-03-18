'use strict';

var mod = require('../Try/scripts/shelfLife');
var createShelfLifeTracker = mod.createShelfLifeTracker;

describe('createShelfLifeTracker (Try/scripts)', function () {
    var tracker;

    beforeEach(function () {
        tracker = createShelfLifeTracker();
    });

    // ── getMaterials ────────────────────────────────────────────

    test('lists all default materials', function () {
        var mats = tracker.getMaterials();
        expect(mats.length).toBeGreaterThanOrEqual(10);
        var ids = mats.map(function (m) { return m.id; });
        expect(ids).toContain('alginate');
        expect(ids).toContain('collagen-type-1');
        expect(ids).toContain('pluronic-f127');
    });

    test('material entries include expected fields', function () {
        var mats = tracker.getMaterials();
        mats.forEach(function (m) {
            expect(m.id).toBeTruthy();
            expect(m.name).toBeTruthy();
            expect(m.category).toBeTruthy();
            expect(typeof m.baseShelfLifeDays).toBe('number');
            expect(typeof m.costPerMl).toBe('number');
        });
    });

    // ── registerBatch ───────────────────────────────────────────

    test('registers a batch and returns it', function () {
        var b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
        expect(b.id).toBe(1);
        expect(b.materialId).toBe('alginate');
        expect(b.volumeMl).toBe(50);
        expect(b.remainingMl).toBe(50);
        expect(b.freezeThawCycles).toBe(0);
    });

    test('auto-increments batch IDs', function () {
        var b1 = tracker.registerBatch({ materialId: 'alginate', volumeMl: 10 });
        var b2 = tracker.registerBatch({ materialId: 'fibrin', volumeMl: 5 });
        expect(b2.id).toBe(b1.id + 1);
    });

    test('rejects missing materialId', function () {
        var result = tracker.registerBatch({ volumeMl: 10 });
        expect(result.error).toMatch(/materialId/);
    });

    test('rejects unknown material', function () {
        var result = tracker.registerBatch({ materialId: 'unobtainium', volumeMl: 10 });
        expect(result.error).toMatch(/Unknown material/);
    });

    test('rejects zero or negative volume', function () {
        expect(tracker.registerBatch({ materialId: 'alginate', volumeMl: 0 }).error).toMatch(/positive/);
        expect(tracker.registerBatch({ materialId: 'alginate', volumeMl: -5 }).error).toMatch(/positive/);
    });

    test('accepts optional fields', function () {
        var b = tracker.registerBatch({
            materialId: 'alginate',
            volumeMl: 25,
            lotNumber: 'LOT-001',
            supplier: 'Sigma',
            notes: 'test batch',
            freezeThawCycles: 2,
            conditions: { tempC: 10 }
        });
        expect(b.lotNumber).toBe('LOT-001');
        expect(b.supplier).toBe('Sigma');
        expect(b.notes).toBe('test batch');
        expect(b.freezeThawCycles).toBe(2);
    });

    // ── recordUsage ─────────────────────────────────────────────

    test('records usage and decrements volume', function () {
        tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
        var result = tracker.recordUsage(1, 10, 'print');
        expect(result.used).toBe(10);
        expect(result.remaining).toBe(40);
    });

    test('rejects usage exceeding remaining volume', function () {
        tracker.registerBatch({ materialId: 'alginate', volumeMl: 5 });
        var result = tracker.recordUsage(1, 10, 'print');
        expect(result.error).toMatch(/Insufficient/);
    });

    test('rejects zero/negative usage', function () {
        tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
        expect(tracker.recordUsage(1, 0).error).toMatch(/positive/);
        expect(tracker.recordUsage(1, -1).error).toMatch(/positive/);
    });

    test('rejects usage on unknown batch', function () {
        expect(tracker.recordUsage(999, 10).error).toMatch(/not found/);
    });

    // ── recordFreezeThaw ────────────────────────────────────────

    test('increments freeze-thaw cycles', function () {
        tracker.registerBatch({ materialId: 'fibrin', volumeMl: 10 });
        var r = tracker.recordFreezeThaw(1);
        expect(r.cycles).toBe(1);
        expect(r.withinTolerance).toBe(true);
    });

    test('warns when exceeding tolerance', function () {
        tracker.registerBatch({ materialId: 'fibrin', volumeMl: 10 }); // tolerance = 2
        tracker.recordFreezeThaw(1);
        tracker.recordFreezeThaw(1);
        var r = tracker.recordFreezeThaw(1); // 3rd cycle exceeds tolerance of 2
        expect(r.withinTolerance).toBe(false);
        expect(r.warning).toMatch(/Exceeded/);
    });

    test('warns at exactly tolerance', function () {
        tracker.registerBatch({ materialId: 'fibrin', volumeMl: 10 }); // tolerance = 2
        tracker.recordFreezeThaw(1);
        var r = tracker.recordFreezeThaw(1); // 2nd cycle = tolerance
        expect(r.withinTolerance).toBe(true);
        expect(r.warning).toMatch(/maximum/i);
    });

    test('rejects unknown batch', function () {
        expect(tracker.recordFreezeThaw(999).error).toMatch(/not found/);
    });

    // ── calculateShelfLife ──────────────────────────────────────

    test('calculates shelf life for a fresh batch', function () {
        var now = new Date();
        tracker.registerBatch({ materialId: 'alginate', volumeMl: 50, createdDate: now.toISOString() });
        var sl = tracker.calculateShelfLife(
            { id: 1, materialId: 'alginate', createdDate: now.toISOString(), conditions: {}, freezeThawCycles: 0 },
            now.toISOString()
        );
        expect(sl.status).toBe('ok');
        expect(sl.qualityPercent).toBeGreaterThan(90);
        expect(sl.remainingDays).toBeGreaterThan(300);
    });

    test('returns expired for very old batch', function () {
        var old = new Date();
        old.setFullYear(old.getFullYear() - 5);
        var sl = tracker.calculateShelfLife(
            { id: 1, materialId: 'alginate', createdDate: old.toISOString(), conditions: {}, freezeThawCycles: 0 }
        );
        expect(sl.status).toBe('expired');
        expect(sl.remainingDays).toBe(0);
        expect(sl.qualityPercent).toBe(0);
    });

    test('returns error for unknown material', function () {
        var sl = tracker.calculateShelfLife(
            { id: 1, materialId: 'fake', createdDate: new Date().toISOString(), conditions: {} }
        );
        expect(sl.error).toMatch(/Unknown material/);
    });

    test('freeze-thaw penalty reduces shelf life', function () {
        var now = new Date();
        var base = { id: 1, materialId: 'collagen-type-1', createdDate: now.toISOString(), conditions: {} };
        var sl0 = tracker.calculateShelfLife(Object.assign({}, base, { freezeThawCycles: 0 }), now.toISOString());
        var sl5 = tracker.calculateShelfLife(Object.assign({}, base, { freezeThawCycles: 5 }), now.toISOString());
        expect(sl5.remainingDays).toBeLessThan(sl0.remainingDays);
    });

    // ── degradationMultiplier ───────────────────────────────────

    test('optimal conditions give multiplier near 1', function () {
        var mat = { optimalTempC: 4, q10: 2.0, humiditySensitivity: 0.3, lightSensitivity: 0.2 };
        var m = tracker.degradationMultiplier(mat, { tempC: 4, humidityRH: 45, lightExposure: 'dark', container: 'sealed' });
        expect(m).toBeCloseTo(1.0, 1);
    });

    test('high temp increases degradation', function () {
        var mat = { optimalTempC: 4, q10: 2.0, humiditySensitivity: 0.3, lightSensitivity: 0.2 };
        var mOpt = tracker.degradationMultiplier(mat, { tempC: 4, humidityRH: 45, lightExposure: 'dark', container: 'sealed' });
        var mHot = tracker.degradationMultiplier(mat, { tempC: 24, humidityRH: 45, lightExposure: 'dark', container: 'sealed' });
        expect(mHot).toBeGreaterThan(mOpt * 3); // 2^2 = 4x for 20°C delta
    });

    test('high humidity increases degradation', function () {
        var mat = { optimalTempC: 20, q10: 1.5, humiditySensitivity: 0.6, lightSensitivity: 0.1 };
        var mDry = tracker.degradationMultiplier(mat, { tempC: 20, humidityRH: 45, lightExposure: 'dark', container: 'sealed' });
        var mWet = tracker.degradationMultiplier(mat, { tempC: 20, humidityRH: 90, lightExposure: 'dark', container: 'sealed' });
        expect(mWet).toBeGreaterThan(mDry);
    });

    test('direct light increases degradation for sensitive material', function () {
        var mat = { optimalTempC: 4, q10: 2.0, humiditySensitivity: 0.3, lightSensitivity: 0.8 };
        var mDark = tracker.degradationMultiplier(mat, { tempC: 4, humidityRH: 45, lightExposure: 'dark', container: 'sealed' });
        var mDirect = tracker.degradationMultiplier(mat, { tempC: 4, humidityRH: 45, lightExposure: 'direct', container: 'sealed' });
        expect(mDirect).toBeGreaterThan(mDark * 2);
    });

    test('ambient light has moderate impact', function () {
        var mat = { optimalTempC: 4, q10: 2.0, humiditySensitivity: 0.3, lightSensitivity: 0.8 };
        var mDark = tracker.degradationMultiplier(mat, { tempC: 4, humidityRH: 45, lightExposure: 'dark', container: 'sealed' });
        var mAmbient = tracker.degradationMultiplier(mat, { tempC: 4, humidityRH: 45, lightExposure: 'ambient', container: 'sealed' });
        expect(mAmbient).toBeGreaterThan(mDark);
        expect(mAmbient).toBeLessThan(mDark * 2);
    });

    test('open container increases degradation by 50%', function () {
        var mat = { optimalTempC: 20, q10: 1.5, humiditySensitivity: 0.1, lightSensitivity: 0.1 };
        var mSealed = tracker.degradationMultiplier(mat, { tempC: 20, humidityRH: 45, lightExposure: 'dark', container: 'sealed' });
        var mOpen = tracker.degradationMultiplier(mat, { tempC: 20, humidityRH: 45, lightExposure: 'dark', container: 'open' });
        expect(mOpen / mSealed).toBeCloseTo(1.5, 1);
    });

    test('very cold temp has floor multiplier of 0.1', function () {
        var mat = { optimalTempC: 20, q10: 2.0, humiditySensitivity: 0.1, lightSensitivity: 0.1 };
        var m = tracker.degradationMultiplier(mat, { tempC: -80, humidityRH: 45, lightExposure: 'dark', container: 'sealed' });
        // tempFactor should be floored at 0.1
        expect(m).toBeGreaterThanOrEqual(0.1);
        expect(m).toBeLessThan(0.2);
    });

    // ── getInventory ────────────────────────────────────────────

    test('returns inventory summary with FEFO ordering', function () {
        var now = new Date();
        var old = new Date(now);
        old.setDate(old.getDate() - 300);

        tracker.registerBatch({ materialId: 'alginate', volumeMl: 50, createdDate: now.toISOString() });
        tracker.registerBatch({ materialId: 'alginate', volumeMl: 30, createdDate: old.toISOString() });

        var inv = tracker.getInventory(now.toISOString());
        expect(inv.summary.totalBatches).toBe(2);
        // Older batch should appear first (fewer remaining days)
        expect(inv.batches[0].remainingDays).toBeLessThanOrEqual(inv.batches[1].remainingDays);
    });

    test('inventory tracks expired and urgent batches', function () {
        var ancient = new Date();
        ancient.setFullYear(ancient.getFullYear() - 5);
        tracker.registerBatch({ materialId: 'fibrin', volumeMl: 5, createdDate: ancient.toISOString() });

        var inv = tracker.getInventory();
        expect(inv.summary.expired).toBe(1);
        expect(inv.alerts.length).toBeGreaterThanOrEqual(1);
        expect(inv.alerts[0].status).toBe('expired');
    });

    test('inventory calculates total volume and value', function () {
        tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
        tracker.registerBatch({ materialId: 'alginate', volumeMl: 30 });

        var inv = tracker.getInventory();
        expect(inv.summary.totalVolumeMl).toBe(80);
        expect(inv.summary.totalValueUsd).toBeGreaterThan(0);
    });

    // ── getStorageRecommendations ───────────────────────────────

    test('returns recommendations for known material', function () {
        var rec = tracker.getStorageRecommendations('collagen-type-1');
        expect(rec.materialName).toBe('Collagen Type I');
        expect(rec.recommendations.length).toBeGreaterThanOrEqual(2);
        expect(rec.estimatedShelfLife.optimal).toMatch(/days/);
    });

    test('includes light protection for light-sensitive material', function () {
        var rec = tracker.getStorageRecommendations('peg-diacrylate'); // lightSensitivity 0.8
        var lightRec = rec.recommendations.find(function (r) { return r.factor === 'Light Protection'; });
        expect(lightRec).toBeTruthy();
        expect(lightRec.impact).toBe('high');
    });

    test('includes humidity control for hygroscopic material', function () {
        var rec = tracker.getStorageRecommendations('chitosan'); // humiditySensitivity 0.7
        var humidRec = rec.recommendations.find(function (r) { return r.factor === 'Humidity Control'; });
        expect(humidRec).toBeTruthy();
        expect(humidRec.impact).toBe('high');
    });

    test('includes freeze-thaw warning for sensitive material', function () {
        var rec = tracker.getStorageRecommendations('fibrin'); // freezeThawTolerance 2
        var ftRec = rec.recommendations.find(function (r) { return r.factor === 'Freeze-Thaw'; });
        expect(ftRec).toBeTruthy();
        expect(ftRec.maxCycles).toBe(2);
    });

    test('returns error for unknown material', function () {
        var rec = tracker.getStorageRecommendations('unobtainium');
        expect(rec.error).toMatch(/Unknown material/);
    });

    // ── getDegradationCurve ─────────────────────────────────────

    test('returns degradation curve with expected points', function () {
        tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
        var curve = tracker.getDegradationCurve(1, 6);
        expect(curve.curve.length).toBe(6);
        expect(curve.curve[0].qualityPercent).toBe(100);
        expect(curve.curve[curve.curve.length - 1].qualityPercent).toBe(0);
    });

    test('curve starts at 100% and ends at 0%', function () {
        tracker.registerBatch({ materialId: 'pluronic-f127', volumeMl: 20 });
        var curve = tracker.getDegradationCurve(1);
        expect(curve.curve[0].qualityPercent).toBe(100);
        expect(curve.curve[curve.curve.length - 1].qualityPercent).toBe(0);
    });

    test('returns error for unknown batch', function () {
        expect(tracker.getDegradationCurve(999).error).toMatch(/not found/);
    });

    // ── clearBatches ────────────────────────────────────────────

    test('clears all batches and resets IDs', function () {
        tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
        tracker.registerBatch({ materialId: 'fibrin', volumeMl: 5 });
        tracker.clearBatches();
        var inv = tracker.getInventory();
        expect(inv.summary.totalBatches).toBe(0);

        // IDs reset
        var b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 10 });
        expect(b.id).toBe(1);
    });

    // ── Custom config ───────────────────────────────────────────

    test('accepts custom alert thresholds', function () {
        var custom = createShelfLifeTracker({ alertThresholds: { urgentDays: 3, warningDays: 14 } });
        var now = new Date();
        var almostExpired = new Date(now);
        almostExpired.setDate(almostExpired.getDate() - 360); // alginate has 365 base

        custom.registerBatch({ materialId: 'alginate', volumeMl: 10, createdDate: almostExpired.toISOString() });
        var sl = custom.calculateShelfLife(
            { id: 1, materialId: 'alginate', createdDate: almostExpired.toISOString(), conditions: {}, freezeThawCycles: 0 },
            now.toISOString()
        );
        // With ~5 days remaining and urgentDays=3, should be warning (not urgent)
        expect(sl.status).toBe('warning');
    });

    test('accepts custom materials', function () {
        var custom = createShelfLifeTracker({
            materials: {
                'custom-ink': {
                    name: 'Custom Ink',
                    category: 'synthetic',
                    baseShelfLifeDays: 100,
                    optimalTempC: 10,
                    maxTempC: 30,
                    minTempC: -10,
                    humiditySensitivity: 0.2,
                    lightSensitivity: 0.1,
                    freezeThawTolerance: 5,
                    q10: 1.5,
                    costPerMl: 20,
                    storageNotes: 'Test material'
                }
            }
        });
        var b = custom.registerBatch({ materialId: 'custom-ink', volumeMl: 25 });
        expect(b.materialId).toBe('custom-ink');
    });

    // ── Edge: moderate light sensitivity recommendation ─────────

    test('moderate light sensitivity gives medium impact rec', function () {
        // hyaluronic-acid has lightSensitivity 0.3 (> 0.2, <= 0.5)
        var rec = tracker.getStorageRecommendations('hyaluronic-acid');
        var lightRec = rec.recommendations.find(function (r) { return r.factor === 'Light Protection'; });
        expect(lightRec).toBeTruthy();
        expect(lightRec.impact).toBe('medium');
    });
});
