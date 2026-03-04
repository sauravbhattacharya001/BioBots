'use strict';

const { createShelfLifeTracker } = require('../Try/scripts/shelfLife');

describe('ShelfLifeTracker', () => {
    let tracker;

    beforeEach(() => {
        tracker = createShelfLifeTracker();
    });

    describe('getMaterials', () => {
        it('returns at least 10 materials', () => {
            expect(tracker.getMaterials().length).toBeGreaterThanOrEqual(10);
        });

        it('all materials have required fields', () => {
            tracker.getMaterials().forEach(m => {
                expect(m.id).toBeTruthy();
                expect(m.name).toBeTruthy();
                expect(m.category).toBeTruthy();
                expect(m.baseShelfLifeDays).toBeGreaterThan(0);
                expect(typeof m.optimalTempC).toBe('number');
                expect(m.costPerMl).toBeGreaterThanOrEqual(0);
            });
        });

        it('covers protein, polysaccharide, synthetic categories', () => {
            const cats = new Set(tracker.getMaterials().map(m => m.category));
            expect(cats.has('protein')).toBe(true);
            expect(cats.has('polysaccharide')).toBe(true);
            expect(cats.has('synthetic')).toBe(true);
        });
    });

    describe('registerBatch', () => {
        it('creates batch with auto-incrementing ID', () => {
            const b1 = tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
            const b2 = tracker.registerBatch({ materialId: 'alginate', volumeMl: 30 });
            expect(b1.id).toBe(1);
            expect(b2.id).toBe(2);
        });

        it('sets remainingMl to initial volume', () => {
            const b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
            expect(b.remainingMl).toBe(50);
        });

        it('stores optional fields', () => {
            const b = tracker.registerBatch({
                materialId: 'collagen-type-1', volumeMl: 10,
                lotNumber: 'LOT-2026-001', supplier: 'LabCorp', notes: 'First batch'
            });
            expect(b.lotNumber).toBe('LOT-2026-001');
            expect(b.supplier).toBe('LabCorp');
            expect(b.notes).toBe('First batch');
        });

        it('rejects missing materialId', () => {
            expect(tracker.registerBatch({ volumeMl: 10 }).error).toBeTruthy();
        });

        it('rejects unknown material', () => {
            expect(tracker.registerBatch({ materialId: 'unobtanium', volumeMl: 10 }).error).toContain('Unknown');
        });

        it('rejects zero volume', () => {
            expect(tracker.registerBatch({ materialId: 'alginate', volumeMl: 0 }).error).toBeTruthy();
        });

        it('rejects negative volume', () => {
            expect(tracker.registerBatch({ materialId: 'alginate', volumeMl: -5 }).error).toBeTruthy();
        });

        it('accepts custom created date', () => {
            const b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 50, createdDate: '2026-01-01' });
            expect(b.createdDate).toContain('2026-01-01');
        });
    });

    describe('recordUsage', () => {
        it('deducts from remaining volume', () => {
            const b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
            expect(tracker.recordUsage(b.id, 15, 'Print run 1').remaining).toBe(35);
        });

        it('allows multiple usage records', () => {
            const b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
            tracker.recordUsage(b.id, 15);
            expect(tracker.recordUsage(b.id, 10).remaining).toBe(25);
        });

        it('rejects exceeding remaining volume', () => {
            const b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 10 });
            expect(tracker.recordUsage(b.id, 15).error).toContain('Insufficient');
        });

        it('rejects zero volume', () => {
            const b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 10 });
            expect(tracker.recordUsage(b.id, 0).error).toBeTruthy();
        });

        it('rejects unknown batch', () => {
            expect(tracker.recordUsage(999, 5).error).toContain('not found');
        });
    });

    describe('recordFreezeThaw', () => {
        it('increments cycle count', () => {
            const b = tracker.registerBatch({ materialId: 'fibrin', volumeMl: 5 });
            expect(tracker.recordFreezeThaw(b.id).cycles).toBe(1);
            expect(tracker.recordFreezeThaw(b.id).cycles).toBe(2);
        });

        it('reports within tolerance', () => {
            const b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
            const r = tracker.recordFreezeThaw(b.id);
            expect(r.withinTolerance).toBe(true);
            expect(r.warning).toBeNull();
        });

        it('warns when tolerance exceeded', () => {
            const b = tracker.registerBatch({ materialId: 'fibrin', volumeMl: 5 });
            tracker.recordFreezeThaw(b.id);
            tracker.recordFreezeThaw(b.id);
            const r3 = tracker.recordFreezeThaw(b.id);
            expect(r3.withinTolerance).toBe(false);
            expect(r3.warning).toContain('compromised');
        });

        it('warns at exact tolerance', () => {
            const b = tracker.registerBatch({ materialId: 'fibrin', volumeMl: 5 });
            tracker.recordFreezeThaw(b.id);
            const r2 = tracker.recordFreezeThaw(b.id);
            expect(r2.withinTolerance).toBe(true);
            expect(r2.warning).toContain('maximum');
        });

        it('rejects unknown batch', () => {
            expect(tracker.recordFreezeThaw(999).error).toBeTruthy();
        });
    });

    describe('degradationMultiplier', () => {
        const baseMat = { optimalTempC: 4, q10: 2.0, humiditySensitivity: 0.3, lightSensitivity: 0.2 };

        it('returns ~1.0 at optimal conditions', () => {
            const r = tracker.degradationMultiplier(baseMat, {
                tempC: 4, humidityRH: 45, lightExposure: 'dark', container: 'sealed'
            });
            expect(r).toBeCloseTo(1.0, 1);
        });

        it('increases with temperature above optimal', () => {
            const lo = { ...baseMat, humiditySensitivity: 0, lightSensitivity: 0 };
            const r4 = tracker.degradationMultiplier(lo, { tempC: 4 });
            const r14 = tracker.degradationMultiplier(lo, { tempC: 14 });
            const r24 = tracker.degradationMultiplier(lo, { tempC: 24 });
            expect(r14).toBeGreaterThan(r4);
            expect(r24).toBeGreaterThan(r14);
        });

        it('Q10=2 doubles rate per 10C', () => {
            const lo = { ...baseMat, humiditySensitivity: 0, lightSensitivity: 0 };
            const r = tracker.degradationMultiplier(lo, { tempC: 14, humidityRH: 0, lightExposure: 'dark' });
            expect(r).toBeCloseTo(2.0, 1);
        });

        it('increases with high humidity', () => {
            const m = { ...baseMat, q10: 1.5, humiditySensitivity: 0.6, lightSensitivity: 0, optimalTempC: 20 };
            const dry = tracker.degradationMultiplier(m, { tempC: 20, humidityRH: 40 });
            const wet = tracker.degradationMultiplier(m, { tempC: 20, humidityRH: 90 });
            expect(wet).toBeGreaterThan(dry);
        });

        it('increases with light exposure', () => {
            const m = { ...baseMat, q10: 1.5, humiditySensitivity: 0, lightSensitivity: 0.7, optimalTempC: 20 };
            const dark = tracker.degradationMultiplier(m, { tempC: 20, lightExposure: 'dark' });
            const ambient = tracker.degradationMultiplier(m, { tempC: 20, lightExposure: 'ambient' });
            const direct = tracker.degradationMultiplier(m, { tempC: 20, lightExposure: 'direct' });
            expect(ambient).toBeGreaterThan(dark);
            expect(direct).toBeGreaterThan(ambient);
        });

        it('open container adds 50%', () => {
            const m = { ...baseMat, q10: 1.5, humiditySensitivity: 0, lightSensitivity: 0, optimalTempC: 20 };
            const sealed = tracker.degradationMultiplier(m, { tempC: 20, container: 'sealed' });
            const open = tracker.degradationMultiplier(m, { tempC: 20, container: 'open' });
            expect(open / sealed).toBeCloseTo(1.5, 1);
        });

        it('never goes below 0.1', () => {
            const m = { ...baseMat, q10: 3.0, humiditySensitivity: 0, lightSensitivity: 0, optimalTempC: 20 };
            expect(tracker.degradationMultiplier(m, { tempC: -80 })).toBeGreaterThanOrEqual(0.1);
        });
    });

    describe('calculateShelfLife', () => {
        it('full shelf life for fresh batch at optimal', () => {
            const b = tracker.registerBatch({
                materialId: 'alginate', volumeMl: 50,
                conditions: { tempC: 20, humidityRH: 45, lightExposure: 'dark', container: 'sealed' }
            });
            const sl = tracker.calculateShelfLife(b, new Date(b.createdDate));
            expect(sl.remainingDays).toBeCloseTo(365, 0);
            expect(sl.qualityPercent).toBeCloseTo(100, 0);
            expect(sl.status).toBe('ok');
        });

        it('expired for old batch', () => {
            const b = tracker.registerBatch({
                materialId: 'alginate', volumeMl: 50,
                createdDate: '2025-01-01', conditions: { tempC: 20 }
            });
            const sl = tracker.calculateShelfLife(b, new Date('2026-01-01'));
            expect(sl.status).toBe('expired');
        });

        it('freeze-thaw reduces shelf life', () => {
            const b = tracker.registerBatch({
                materialId: 'collagen-type-1', volumeMl: 10,
                conditions: { tempC: 4 }, freezeThawCycles: 5
            });
            const sl = tracker.calculateShelfLife(b, new Date(b.createdDate));
            expect(sl.freezeThawPenaltyDays).toBeGreaterThan(0);
            expect(sl.totalShelfLifeDays).toBeLessThan(90);
        });

        it('error for unknown material', () => {
            expect(tracker.calculateShelfLife({ materialId: 'unobtanium', createdDate: new Date().toISOString() }).error).toBeTruthy();
        });

        it('urgent status within threshold', () => {
            const now = new Date();
            const created = new Date(now.getTime() - (365 - 5) * 24 * 60 * 60 * 1000);
            const b = tracker.registerBatch({
                materialId: 'alginate', volumeMl: 50, createdDate: created,
                conditions: { tempC: 20, humidityRH: 45, lightExposure: 'dark', container: 'sealed' }
            });
            const sl = tracker.calculateShelfLife(b, now);
            expect(sl.remainingDays).toBeLessThanOrEqual(7);
            expect(sl.status).toBe('urgent');
        });
    });

    describe('getInventory', () => {
        it('empty initially', () => {
            const inv = tracker.getInventory();
            expect(inv.batches).toHaveLength(0);
            expect(inv.summary.totalBatches).toBe(0);
        });

        it('sorts by FEFO', () => {
            tracker.registerBatch({ materialId: 'fibrin', volumeMl: 5, conditions: { tempC: -20 } });
            tracker.registerBatch({ materialId: 'pluronic-f127', volumeMl: 100, conditions: { tempC: 20 } });
            const inv = tracker.getInventory();
            expect(inv.batches[0].material).toBe('Fibrin');
            expect(inv.batches[1].material).toBe('Pluronic F-127');
        });

        it('calculates total volume and value', () => {
            tracker.registerBatch({ materialId: 'alginate', volumeMl: 50, conditions: { tempC: 20 } });
            tracker.registerBatch({ materialId: 'collagen-type-1', volumeMl: 10, conditions: { tempC: 4 } });
            const inv = tracker.getInventory();
            expect(inv.summary.totalVolumeMl).toBe(60);
            expect(inv.summary.totalValueUsd).toBeGreaterThan(0);
        });

        it('generates alerts for expired', () => {
            tracker.registerBatch({ materialId: 'fibrin', volumeMl: 5, createdDate: '2024-01-01', conditions: { tempC: 4 } });
            const inv = tracker.getInventory(new Date('2026-03-04'));
            expect(inv.alerts.length).toBeGreaterThanOrEqual(1);
            expect(inv.alerts[0].status).toBe('expired');
        });

        it('excludes expired from total volume', () => {
            tracker.registerBatch({ materialId: 'fibrin', volumeMl: 5, createdDate: '2024-01-01', conditions: { tempC: 4 } });
            tracker.registerBatch({ materialId: 'alginate', volumeMl: 50, conditions: { tempC: 20 } });
            const inv = tracker.getInventory(new Date('2026-03-04'));
            expect(inv.summary.totalVolumeMl).toBe(50);
        });
    });

    describe('getStorageRecommendations', () => {
        it('returns recommendations for known material', () => {
            const rec = tracker.getStorageRecommendations('gelatin-methacrylate');
            expect(rec.materialName).toBe('GelMA');
            expect(rec.recommendations.length).toBeGreaterThanOrEqual(3);
        });

        it('highlights light protection for PEG-DA', () => {
            const rec = tracker.getStorageRecommendations('peg-diacrylate');
            const lr = rec.recommendations.find(r => r.factor === 'Light Protection');
            expect(lr).toBeTruthy();
            expect(lr.impact).toBe('high');
        });

        it('highlights freeze-thaw for fibrin', () => {
            const rec = tracker.getStorageRecommendations('fibrin');
            const ft = rec.recommendations.find(r => r.factor === 'Freeze-Thaw');
            expect(ft).toBeTruthy();
            expect(ft.maxCycles).toBe(2);
        });

        it('room temp shorter than optimal for cold-stored materials', () => {
            const rec = tracker.getStorageRecommendations('collagen-type-1');
            expect(parseInt(rec.estimatedShelfLife.roomTemp)).toBeLessThan(parseInt(rec.estimatedShelfLife.optimal));
        });

        it('error for unknown material', () => {
            expect(tracker.getStorageRecommendations('unobtanium').error).toBeTruthy();
        });
    });

    describe('getDegradationCurve', () => {
        it('returns specified number of points', () => {
            const b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 50, conditions: { tempC: 20 } });
            expect(tracker.getDegradationCurve(b.id, 6).curve).toHaveLength(6);
        });

        it('starts at 100% quality', () => {
            const b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 50, conditions: { tempC: 20 } });
            const c = tracker.getDegradationCurve(b.id);
            expect(c.curve[0].qualityPercent).toBe(100);
            expect(c.curve[0].day).toBe(0);
        });

        it('ends at 0% quality', () => {
            const b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 50, conditions: { tempC: 20 } });
            const last = tracker.getDegradationCurve(b.id).curve.slice(-1)[0];
            expect(last.qualityPercent).toBe(0);
        });

        it('quality monotonically decreases', () => {
            const b = tracker.registerBatch({ materialId: 'collagen-type-1', volumeMl: 10, conditions: { tempC: 4 } });
            const curve = tracker.getDegradationCurve(b.id, 20).curve;
            for (let i = 1; i < curve.length; i++) {
                expect(curve[i].qualityPercent).toBeLessThanOrEqual(curve[i-1].qualityPercent);
            }
        });

        it('includes status transitions', () => {
            const b = tracker.registerBatch({ materialId: 'alginate', volumeMl: 50, conditions: { tempC: 20 } });
            const statuses = tracker.getDegradationCurve(b.id, 20).curve.map(p => p.status);
            expect(statuses[0]).toBe('ok');
            expect(statuses[statuses.length - 1]).toBe('expired');
        });

        it('error for unknown batch', () => {
            expect(tracker.getDegradationCurve(999).error).toBeTruthy();
        });
    });

    describe('clearBatches', () => {
        it('removes all batches', () => {
            tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
            tracker.clearBatches();
            expect(tracker.getInventory().batches).toHaveLength(0);
        });

        it('resets ID counter', () => {
            tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 });
            tracker.clearBatches();
            expect(tracker.registerBatch({ materialId: 'alginate', volumeMl: 50 }).id).toBe(1);
        });
    });

    describe('custom config', () => {
        it('respects custom alert thresholds', () => {
            const t = createShelfLifeTracker({ alertThresholds: { urgentDays: 3, warningDays: 14 } });
            const now = new Date();
            const created = new Date(now.getTime() - (365 - 10) * 24 * 60 * 60 * 1000);
            const b = t.registerBatch({
                materialId: 'alginate', volumeMl: 50, createdDate: created,
                conditions: { tempC: 20, humidityRH: 45, lightExposure: 'dark', container: 'sealed' }
            });
            expect(t.calculateShelfLife(b, now).status).toBe('warning');
        });
    });
});
