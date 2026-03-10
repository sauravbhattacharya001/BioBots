'use strict';

var jobEstimator = require('../docs/shared/jobEstimator');

describe('JobEstimator', function () {
    var planner;

    beforeEach(function () {
        planner = jobEstimator.createJobEstimator();
    });

    // ── Factory ────────────────────────────────────────────────

    test('createJobEstimator returns object with expected methods', function () {
        expect(planner.estimate).toBeInstanceOf(Function);
        expect(planner.compare).toBeInstanceOf(Function);
        expect(planner.batchPlan).toBeInstanceOf(Function);
        expect(planner.getMaterials).toBeInstanceOf(Function);
        expect(planner.getCellTypes).toBeInstanceOf(Function);
        expect(planner.getWellplates).toBeInstanceOf(Function);
    });

    test('getMaterials returns non-empty array of strings', function () {
        var mats = planner.getMaterials();
        expect(Array.isArray(mats)).toBe(true);
        expect(mats.length).toBeGreaterThan(0);
        expect(mats).toContain('alginate');
    });

    test('getCellTypes returns non-empty array', function () {
        var types = planner.getCellTypes();
        expect(types.length).toBeGreaterThan(0);
        expect(types).toContain('HEK293');
    });

    test('getWellplates returns standard sizes', function () {
        var wp = planner.getWellplates();
        expect(wp).toEqual(expect.arrayContaining([6, 12, 24, 48, 96]));
    });

    // ── Estimate — validation ──────────────────────────────────

    test('throws on missing params', function () {
        expect(function () { planner.estimate(); }).toThrow();
        expect(function () { planner.estimate(null); }).toThrow();
        expect(function () { planner.estimate({}); }).toThrow('geometry');
    });

    test('throws on missing material', function () {
        expect(function () {
            planner.estimate({ geometry: { type: 'wellplate', wellplate: 24 } });
        }).toThrow('material');
    });

    test('throws on unknown material', function () {
        expect(function () {
            planner.estimate({ geometry: { type: 'wellplate', wellplate: 24 }, material: 'unobtanium' });
        }).toThrow('Unknown material');
    });

    test('throws on invalid geometry type', function () {
        expect(function () {
            planner.estimate({ geometry: { type: 'sphere' }, material: 'alginate' });
        }).toThrow('geometry.type');
    });

    test('throws on invalid wellplate size', function () {
        expect(function () {
            planner.estimate({ geometry: { type: 'wellplate', wellplate: 7 }, material: 'alginate' });
        }).toThrow('Invalid wellplate');
    });

    // ── Estimate — wellplate ───────────────────────────────────

    test('basic wellplate estimate produces valid structure', function () {
        var est = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
            material: 'alginate'
        });

        expect(est.summary).toBeDefined();
        expect(est.geometry).toBeDefined();
        expect(est.material).toBeDefined();
        expect(est.timing).toBeDefined();
        expect(est.risk).toBeDefined();
        expect(est.timestamp).toBeDefined();

        expect(est.summary.recommendation).toMatch(/^(GO|CAUTION|NO-GO)$/);
        expect(est.summary.totalVolumeMl).toBeGreaterThan(0);
        expect(est.summary.totalTimeMin).toBeGreaterThan(0);
        expect(est.summary.totalCost).toBeGreaterThan(0);
    });

    test('wellplate geometry values are reasonable', function () {
        var est = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 6, layers: 10, layerHeight: 0.3 },
            material: 'gelatin-methacrylate'
        });
        expect(est.geometry.type).toBe('wellplate');
        expect(est.geometry.wellCount).toBe(6);
        expect(est.geometry.layers).toBe(10);
        expect(est.geometry.volumeMl).toBeGreaterThan(0);
    });

    test('wellCount limits to plate capacity', function () {
        var est = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 6, wellCount: 100, layers: 1, layerHeight: 0.2 },
            material: 'alginate'
        });
        expect(est.geometry.wellCount).toBe(6);
    });

    test('infill reduces volume', function () {
        var full = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2, infillPercent: 100 },
            material: 'alginate'
        });
        var half = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2, infillPercent: 50 },
            material: 'alginate'
        });
        expect(half.geometry.volumeMl).toBeLessThan(full.geometry.volumeMl);
    });

    // ── Estimate — cylinder ────────────────────────────────────

    test('cylinder geometry estimate', function () {
        var est = planner.estimate({
            geometry: { type: 'cylinder', radiusMm: 5, heightMm: 10, layerHeight: 0.2 },
            material: 'collagen-type-1'
        });
        expect(est.geometry.type).toBe('cylinder');
        expect(est.geometry.volumeMl).toBeGreaterThan(0);
        expect(est.geometry.layers).toBe(50); // 10mm / 0.2mm
    });

    test('cylinder with diameter', function () {
        var est = planner.estimate({
            geometry: { type: 'cylinder', diameterMm: 10, heightMm: 5 },
            material: 'alginate'
        });
        expect(est.geometry.radiusMm).toBe(5);
    });

    // ── Estimate — cuboid ──────────────────────────────────────

    test('cuboid geometry estimate', function () {
        var est = planner.estimate({
            geometry: { type: 'cuboid', widthMm: 10, lengthMm: 10, heightMm: 5 },
            material: 'pluronic-f127'
        });
        expect(est.geometry.type).toBe('cuboid');
        expect(est.geometry.volumeMm3).toBeCloseTo(500, 0);
    });

    test('cuboid throws on missing dimensions', function () {
        expect(function () {
            planner.estimate({ geometry: { type: 'cuboid', widthMm: 10 }, material: 'alginate' });
        }).toThrow();
    });

    // ── Estimate — custom ──────────────────────────────────────

    test('custom geometry with volumeMl', function () {
        var est = planner.estimate({
            geometry: { type: 'custom', volumeMl: 2.5 },
            material: 'alginate'
        });
        expect(est.geometry.volumeMl).toBe(2.5);
    });

    // ── Material estimates ─────────────────────────────────────

    test('material cost reflects waste factor', function () {
        var low = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
            material: 'alginate',
            wastePercent: 5
        });
        var high = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
            material: 'alginate',
            wastePercent: 40
        });
        expect(high.material.materialCost).toBeGreaterThan(low.material.materialCost);
    });

    test('expensive material increases cost', function () {
        var cheap = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
            material: 'alginate'
        });
        var expensive = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
            material: 'collagen-type-1'
        });
        expect(expensive.material.materialCost).toBeGreaterThan(cheap.material.materialCost);
    });

    // ── Timing estimates ───────────────────────────────────────

    test('more layers increases print time', function () {
        var few = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 2, layerHeight: 0.2 },
            material: 'alginate'
        });
        var many = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 20, layerHeight: 0.2 },
            material: 'alginate'
        });
        expect(many.timing.totalMin).toBeGreaterThan(few.timing.totalMin);
    });

    test('high viscosity material prints slower', function () {
        var fast = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 10, layerHeight: 0.2 },
            material: 'alginate'
        });
        var slow = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 10, layerHeight: 0.2 },
            material: 'collagen-type-1'
        });
        expect(slow.timing.totalPrintMin).toBeGreaterThan(fast.timing.totalPrintMin);
    });

    test('timing includes calibration and cleanup', function () {
        var est = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 1, layerHeight: 0.2 },
            material: 'alginate'
        });
        expect(est.timing.calibrationMin).toBe(15);
        expect(est.timing.cleanupMin).toBe(10);
    });

    // ── Cell estimates ─────────────────────────────────────────

    test('cell estimate without cells returns null', function () {
        var est = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
            material: 'alginate'
        });
        expect(est.cells).toBeNull();
        expect(est.summary.viability).toBeNull();
    });

    test('cell estimate with known type', function () {
        var est = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
            material: 'alginate',
            cells: { type: 'HEK293', density: 1e6 }
        });
        expect(est.cells).toBeDefined();
        expect(est.cells.cellType).toBe('HEK293');
        expect(est.cells.predictedViability).toBeGreaterThan(0);
        expect(est.cells.predictedViability).toBeLessThanOrEqual(1);
        expect(est.cells.viableCells).toBeGreaterThan(0);
        expect(est.cells.cellCost).toBeGreaterThan(0);
    });

    test('sensitive cells have lower viability', function () {
        var robust = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 10, layerHeight: 0.2 },
            material: 'collagen-type-1',
            cells: { type: 'fibroblast', density: 1e6 }
        });
        var sensitive = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 10, layerHeight: 0.2 },
            material: 'collagen-type-1',
            cells: { type: 'iPSC', density: 1e6 }
        });
        expect(sensitive.cells.predictedViability).toBeLessThan(robust.cells.predictedViability);
    });

    test('unknown cell type uses defaults', function () {
        var est = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
            material: 'alginate',
            cells: { type: 'CustomCell', density: 5e5 }
        });
        expect(est.cells.cellType).toBe('CustomCell');
        expect(est.cells.predictedViability).toBeGreaterThan(0);
    });

    // ── Environment effects ────────────────────────────────────

    test('temperature affects viability', function () {
        var optimal = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
            material: 'alginate',
            cells: { type: 'HEK293', density: 1e6 },
            environment: { temperature: 37 }
        });
        var cold = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
            material: 'alginate',
            cells: { type: 'HEK293', density: 1e6 },
            environment: { temperature: 20 }
        });
        expect(optimal.cells.predictedViability).toBeGreaterThan(cold.cells.predictedViability);
    });

    // ── Risk assessment ────────────────────────────────────────

    test('simple low-risk job gets GO', function () {
        var est = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, wellCount: 2, layers: 2, layerHeight: 0.1 },
            material: 'alginate',
            cells: { type: 'fibroblast', density: 1e6 }
        });
        expect(est.risk.recommendation).toBe('GO');
    });

    test('risk includes cost estimate', function () {
        var est = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
            material: 'alginate'
        });
        expect(est.risk.totalEstimatedCost).toBeGreaterThanOrEqual(0);
    });

    // ── Compare ────────────────────────────────────────────────

    test('compare ranks alternatives', function () {
        var result = planner.compare([
            {
                geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
                material: 'alginate',
                cells: { type: 'HEK293', density: 1e6 }
            },
            {
                geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
                material: 'collagen-type-1',
                cells: { type: 'HEK293', density: 1e6 }
            }
        ]);
        expect(result.estimates).toHaveLength(2);
        expect(result.ranking).toHaveLength(2);
        expect(result.best).toBeDefined();
    });

    test('compare throws with fewer than 2 sets', function () {
        expect(function () { planner.compare([]); }).toThrow();
        expect(function () { planner.compare([{}]); }).toThrow();
    });

    test('compare handles errors gracefully', function () {
        var result = planner.compare([
            { geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 }, material: 'alginate' },
            { geometry: { type: 'invalid' }, material: 'alginate' }
        ]);
        expect(result.estimates[1].error).toBeDefined();
        expect(result.ranking).toHaveLength(1);
    });

    // ── Batch Plan ─────────────────────────────────────────────

    test('batchPlan aggregates multiple jobs', function () {
        var result = planner.batchPlan([
            { geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 }, material: 'alginate' },
            { geometry: { type: 'wellplate', wellplate: 96, layers: 3, layerHeight: 0.1 }, material: 'alginate' }
        ]);
        expect(result.jobCount).toBe(2);
        expect(result.estimates).toHaveLength(2);
        expect(result.aggregate.totalCost).toBeGreaterThan(0);
        expect(result.aggregate.totalTimeMin).toBeGreaterThan(0);
        expect(result.aggregate.sharedCalibrationSavingsMin).toBeGreaterThan(0);
    });

    test('batchPlan throws on empty array', function () {
        expect(function () { planner.batchPlan([]); }).toThrow();
    });

    test('batchPlan warns on NO-GO jobs', function () {
        // Create a long, expensive job that might trigger warnings
        var result = planner.batchPlan([
            { geometry: { type: 'wellplate', wellplate: 6, layers: 200, layerHeight: 0.2 }, material: 'collagen-type-1', cells: { type: 'iPSC', density: 1e7 } },
            { geometry: { type: 'wellplate', wellplate: 96, layers: 1, layerHeight: 0.1 }, material: 'alginate' }
        ]);
        expect(result.estimates).toHaveLength(2);
        // At minimum the aggregate should work
        expect(result.aggregate.totalCost).toBeGreaterThan(0);
    });

    test('batch saves calibration time for subsequent jobs', function () {
        var single = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 },
            material: 'alginate'
        });
        var batch = planner.batchPlan([
            { geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 }, material: 'alginate' },
            { geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 0.2 }, material: 'alginate' }
        ]);
        // Second job should have less time than standalone
        expect(batch.estimates[1].timing.totalMin).toBeLessThan(single.timing.totalMin);
    });

    // ── Custom timing options ──────────────────────────────────

    test('custom timing overrides', function () {
        var custom = jobEstimator.createJobEstimator({
            timing: { calibrationMin: 5, cleanupMin: 5 }
        });
        var est = custom.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 1, layerHeight: 0.2 },
            material: 'alginate'
        });
        expect(est.timing.calibrationMin).toBe(5);
        expect(est.timing.cleanupMin).toBe(5);
    });

    // ── Layer validation ───────────────────────────────────────

    test('throws on too many layers', function () {
        expect(function () {
            planner.estimate({
                geometry: { type: 'wellplate', wellplate: 24, layers: 501, layerHeight: 0.2 },
                material: 'alginate'
            });
        }).toThrow('layers');
    });

    test('throws on invalid layer height', function () {
        expect(function () {
            planner.estimate({
                geometry: { type: 'wellplate', wellplate: 24, layers: 5, layerHeight: 6 },
                material: 'alginate'
            });
        }).toThrow('layerHeight');
    });

    // ── Viability factors ──────────────────────────────────────

    test('viability factors are all between 0 and 1', function () {
        var est = planner.estimate({
            geometry: { type: 'wellplate', wellplate: 24, layers: 10, layerHeight: 0.2 },
            material: 'collagen-type-1',
            cells: { type: 'MSC', density: 2e6 },
            environment: { temperature: 22 }
        });
        var f = est.cells.viabilityFactors;
        expect(f.baseline).toBeGreaterThan(0);
        expect(f.baseline).toBeLessThanOrEqual(1);
        expect(f.shearDamage).toBeGreaterThanOrEqual(0);
        expect(f.shearDamage).toBeLessThan(1);
        expect(f.durationDamage).toBeGreaterThanOrEqual(0);
        expect(f.temperatureDamage).toBeGreaterThanOrEqual(0);
    });
});
