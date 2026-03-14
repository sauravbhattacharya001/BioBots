// tests/predictor.test.js — Print Outcome Predictor Tests (KNN logic)
'use strict';

// ── KNN Predictor (mirrors C# PredictorController logic) ───────

function createPredictor(prints) {
    const ranges = {};
    const fields = ['extruder1', 'extruder2', 'cl_duration', 'cl_intensity', 'layerNum', 'layerHeight', 'wellplate'];

    function getField(p, f) {
        const map = {
            extruder1: p.print_info.pressure.extruder1,
            extruder2: p.print_info.pressure.extruder2,
            cl_duration: p.print_info.crosslinking.cl_duration,
            cl_intensity: p.print_info.crosslinking.cl_intensity,
            layerNum: p.print_info.resolution.layerNum,
            layerHeight: p.print_info.resolution.layerHeight,
            wellplate: p.print_info.wellplate,
        };
        return map[f];
    }

    // Compute ranges
    fields.forEach(f => {
        let min = Infinity, max = -Infinity;
        prints.forEach(p => {
            const v = getField(p, f);
            if (v < min) min = v;
            if (v > max) max = v;
        });
        ranges[f] = [min, max];
    });

    function distance(query, print) {
        let sumSq = 0, dims = 0;
        function addDim(qv, pv, key) {
            const [mn, mx] = ranges[key];
            const span = mx - mn;
            if (span < 1e-15) return;
            const norm = (qv - pv) / span;
            sumSq += norm * norm;
            dims++;
        }
        if (query.extruder1 != null) addDim(query.extruder1, getField(print, 'extruder1'), 'extruder1');
        if (query.extruder2 != null) addDim(query.extruder2, getField(print, 'extruder2'), 'extruder2');
        if (query.clDuration != null) addDim(query.clDuration, getField(print, 'cl_duration'), 'cl_duration');
        if (query.clIntensity != null) addDim(query.clIntensity, getField(print, 'cl_intensity'), 'cl_intensity');
        if (query.layerNum != null) addDim(query.layerNum, getField(print, 'layerNum'), 'layerNum');
        if (query.layerHeight != null) addDim(query.layerHeight, getField(print, 'layerHeight'), 'layerHeight');
        if (query.wellplate != null) addDim(query.wellplate, getField(print, 'wellplate'), 'wellplate');

        if (query.clEnabled != null) {
            if (query.clEnabled !== print.print_info.crosslinking.cl_enabled) {
                sumSq += 1.0;
                dims++;
            }
        }
        return dims > 0 ? Math.sqrt(sumSq / dims) : 0;
    }

    function predict(query, k = 5) {
        k = Math.min(k, prints.length);
        const dists = prints.map(p => ({ dist: distance(query, p), print: p }));
        dists.sort((a, b) => a.dist - b.dist);
        const neighbors = dists.slice(0, k);

        let totalWeight = 0, wLive = 0, wDead = 0, wElast = 0;
        neighbors.forEach(n => {
            const w = n.dist < 1e-10 ? 1000.0 : 1.0 / n.dist;
            totalWeight += w;
            wLive += w * n.print.print_data.livePercent;
            wDead += w * n.print.print_data.deadPercent;
            wElast += w * n.print.print_data.elasticity;
        });

        return {
            predicted: {
                livePercent: wLive / totalWeight,
                deadPercent: wDead / totalWeight,
                elasticity: wElast / totalWeight,
            },
            confidence: {
                livePercent: { low: Math.min(...neighbors.map(n => n.print.print_data.livePercent)), high: Math.max(...neighbors.map(n => n.print.print_data.livePercent)) },
                deadPercent: { low: Math.min(...neighbors.map(n => n.print.print_data.deadPercent)), high: Math.max(...neighbors.map(n => n.print.print_data.deadPercent)) },
                elasticity: { low: Math.min(...neighbors.map(n => n.print.print_data.elasticity)), high: Math.max(...neighbors.map(n => n.print.print_data.elasticity)) },
            },
            neighborsUsed: k,
            averageDistance: neighbors.reduce((s, n) => s + n.dist, 0) / k,
            neighbors,
        };
    }

    return { predict, distance, ranges };
}

function makePrint(ext1, ext2, layers, lh, clOn, clDur, clInt, wp, live, dead, elast) {
    return {
        user_info: { serial: 1, email: 'test@test.com' },
        print_info: {
            pressure: { extruder1: ext1, extruder2: ext2 },
            crosslinking: { cl_enabled: clOn, cl_duration: clDur, cl_intensity: clInt },
            resolution: { layerNum: layers, layerHeight: lh },
            wellplate: wp,
            files: { input: 'a.gcode', output: 'b.gcode' },
        },
        print_data: { livePercent: live, deadPercent: dead, elasticity: elast },
    };
}

// ── Test Data ──────────────────────────────────────────────

const testPrints = [
    makePrint(10, 5, 8, 0.3, true, 5000, 50, 24, 85, 15, 30),
    makePrint(15, 8, 10, 0.4, true, 10000, 70, 24, 75, 25, 45),
    makePrint(20, 10, 12, 0.5, false, 0, 0, 48, 60, 40, 20),
    makePrint(12, 6, 9, 0.35, true, 7500, 60, 24, 80, 20, 35),
    makePrint(25, 12, 15, 0.6, true, 15000, 90, 96, 55, 45, 50),
    makePrint(8, 4, 6, 0.25, false, 0, 0, 6, 90, 10, 25),
    makePrint(18, 9, 11, 0.45, true, 12000, 80, 48, 65, 35, 40),
    makePrint(30, 15, 20, 0.8, true, 20000, 100, 96, 45, 55, 60),
];

// ── Tests ──────────────────────────────────────────────────

describe('Predictor — createPredictor', () => {
    test('creates predictor from valid prints', () => {
        const pred = createPredictor(testPrints);
        expect(pred).toBeDefined();
        expect(pred.predict).toBeInstanceOf(Function);
        expect(pred.distance).toBeInstanceOf(Function);
    });

    test('computes ranges correctly', () => {
        const pred = createPredictor(testPrints);
        expect(pred.ranges.extruder1[0]).toBe(8);
        expect(pred.ranges.extruder1[1]).toBe(30);
        expect(pred.ranges.layerNum[0]).toBe(6);
        expect(pred.ranges.layerNum[1]).toBe(20);
    });
});

describe('Predictor — distance', () => {
    const pred = createPredictor(testPrints);

    test('distance to self is 0', () => {
        const q = { extruder1: 10, extruder2: 5, layerNum: 8, layerHeight: 0.3, wellplate: 24 };
        expect(pred.distance(q, testPrints[0])).toBeCloseTo(0, 5);
    });

    test('distance is positive for different params', () => {
        const q = { extruder1: 20, extruder2: 10 };
        expect(pred.distance(q, testPrints[0])).toBeGreaterThan(0);
    });

    test('distance with only one dimension', () => {
        const q = { extruder1: 19 };
        const d = pred.distance(q, testPrints[0]);
        // (19-10)/(30-8) = 9/22 ≈ 0.409
        expect(d).toBeCloseTo(9 / 22, 3);
    });

    test('clEnabled mismatch adds penalty', () => {
        const q1 = { clEnabled: true };
        const q2 = { clEnabled: false };
        const d1 = pred.distance(q1, testPrints[0]); // match (true)
        const d2 = pred.distance(q2, testPrints[0]); // mismatch
        expect(d1).toBe(0);
        expect(d2).toBe(1);
    });

    test('no params returns 0 distance', () => {
        expect(pred.distance({}, testPrints[0])).toBe(0);
    });

    test('distance is non-negative', () => {
        const q = { extruder1: 15, layerNum: 12 };
        const d = pred.distance(q, testPrints[0]);
        expect(d).toBeGreaterThanOrEqual(0);
    });
});

describe('Predictor — predict', () => {
    const pred = createPredictor(testPrints);

    test('returns predicted outcomes', () => {
        const r = pred.predict({ extruder1: 10, layerNum: 8 }, 3);
        expect(r.predicted).toBeDefined();
        expect(r.predicted.livePercent).toBeGreaterThan(0);
        expect(r.predicted.deadPercent).toBeGreaterThan(0);
        expect(r.predicted.elasticity).toBeGreaterThan(0);
    });

    test('confidence interval brackets prediction', () => {
        const r = pred.predict({ extruder1: 15, extruder2: 8 }, 5);
        expect(r.predicted.livePercent).toBeGreaterThanOrEqual(r.confidence.livePercent.low);
        expect(r.predicted.livePercent).toBeLessThanOrEqual(r.confidence.livePercent.high);
        expect(r.predicted.elasticity).toBeGreaterThanOrEqual(r.confidence.elasticity.low);
        expect(r.predicted.elasticity).toBeLessThanOrEqual(r.confidence.elasticity.high);
    });

    test('k=1 returns exact neighbor values', () => {
        const r = pred.predict({ extruder1: 10, extruder2: 5, layerNum: 8, layerHeight: 0.3 }, 1);
        expect(r.predicted.livePercent).toBeCloseTo(85, 0);
        expect(r.predicted.deadPercent).toBeCloseTo(15, 0);
        expect(r.predicted.elasticity).toBeCloseTo(30, 0);
        expect(r.neighborsUsed).toBe(1);
    });

    test('k capped at dataset size', () => {
        const r = pred.predict({ extruder1: 15 }, 100);
        expect(r.neighborsUsed).toBe(testPrints.length);
    });

    test('neighbors sorted by distance', () => {
        const r = pred.predict({ extruder1: 12, layerNum: 9 }, 5);
        for (let i = 1; i < r.neighbors.length; i++) {
            expect(r.neighbors[i].dist).toBeGreaterThanOrEqual(r.neighbors[i - 1].dist);
        }
    });

    test('averageDistance is mean of neighbor distances', () => {
        const r = pred.predict({ extruder1: 18 }, 3);
        const expected = r.neighbors.reduce((s, n) => s + n.dist, 0) / 3;
        expect(r.averageDistance).toBeCloseTo(expected, 6);
    });

    test('exact match gives very high weight (near-exact prediction)', () => {
        const r = pred.predict({
            extruder1: 10, extruder2: 5, layerNum: 8,
            layerHeight: 0.3, clEnabled: true, clDuration: 5000,
            clIntensity: 50, wellplate: 24
        }, 5);
        // Should be very close to first print's values due to dist≈0
        expect(r.predicted.livePercent).toBeCloseTo(85, 0);
    });

    test('prediction changes with different params', () => {
        const r1 = pred.predict({ extruder1: 8 }, 3);
        const r2 = pred.predict({ extruder1: 30 }, 3);
        expect(r1.predicted.livePercent).not.toBeCloseTo(r2.predicted.livePercent, 0);
    });
});

describe('Predictor — edge cases', () => {
    test('single print dataset', () => {
        const single = [makePrint(10, 5, 8, 0.3, true, 5000, 50, 24, 85, 15, 30)];
        const pred = createPredictor(single);
        const r = pred.predict({ extruder1: 20 }, 1);
        expect(r.predicted.livePercent).toBe(85);
    });

    test('all identical prints', () => {
        const same = Array(5).fill(null).map(() => makePrint(10, 5, 8, 0.3, true, 5000, 50, 24, 85, 15, 30));
        const pred = createPredictor(same);
        const r = pred.predict({ extruder1: 10, layerNum: 8 }, 3);
        expect(r.predicted.livePercent).toBeCloseTo(85, 1);
        expect(r.confidence.livePercent.low).toBe(85);
        expect(r.confidence.livePercent.high).toBe(85);
    });

    test('query with all params', () => {
        const pred = createPredictor(testPrints);
        const r = pred.predict({
            extruder1: 15, extruder2: 8, layerNum: 10,
            layerHeight: 0.4, clEnabled: true, clDuration: 10000,
            clIntensity: 70, wellplate: 24
        }, 5);
        expect(r.predicted).toBeDefined();
        expect(r.neighborsUsed).toBe(5);
    });

    test('large k returns all prints', () => {
        const pred = createPredictor(testPrints);
        const r = pred.predict({ extruder1: 15 }, 50);
        expect(r.neighborsUsed).toBe(8);
    });

    test('deadPercent + livePercent confidence ranges are non-negative', () => {
        const pred = createPredictor(testPrints);
        const r = pred.predict({ extruder1: 15 }, 5);
        expect(r.confidence.livePercent.low).toBeGreaterThanOrEqual(0);
        expect(r.confidence.deadPercent.low).toBeGreaterThanOrEqual(0);
    });
});

describe('Predictor — weighting behavior', () => {
    test('closer neighbors have more influence', () => {
        // Query near print[0] (ext1=10) — prediction should be closer to print[0]'s values
        const pred = createPredictor(testPrints);
        const r = pred.predict({ extruder1: 10.1 }, 3);
        // Simple mean of 3 nearest would give different result than weighted
        const nearest = r.neighbors.slice(0, 3);
        const simpleMean = nearest.reduce((s, n) => s + n.print.print_data.livePercent, 0) / 3;
        // Weighted should be closer to the nearest neighbor
        const nearestLive = nearest[0].print.print_data.livePercent;
        const wDiff = Math.abs(r.predicted.livePercent - nearestLive);
        const sDiff = Math.abs(simpleMean - nearestLive);
        expect(wDiff).toBeLessThanOrEqual(sDiff + 0.1);
    });
});
