/**
 * Tests for the Print Success Predictor module.
 *
 * Validates the k-NN prediction logic, distance calculations,
 * normalization, grading, and recommendation generation.
 */

// ── Predictor Module (extracted for testing) ──
function createPredictor() {
    // Normalization
    function normalize(value, range) {
        if (!range || range.max === range.min) return 0;
        return (value - range.min) / (range.max - range.min);
    }

    // Euclidean distance (normalized, averaged over dimensions)
    function distance(params, print, paramRanges) {
        var sumSq = 0;
        var dims = 0;

        if (params.extruder1 !== undefined) {
            var d = normalize(params.extruder1, paramRanges.extruder1) -
                normalize(print.print_info.pressure.extruder1, paramRanges.extruder1);
            sumSq += d * d;
            dims++;
        }
        if (params.extruder2 !== undefined) {
            var d = normalize(params.extruder2, paramRanges.extruder2) -
                normalize(print.print_info.pressure.extruder2, paramRanges.extruder2);
            sumSq += d * d;
            dims++;
        }
        if (params.wellplate !== undefined) {
            sumSq += (params.wellplate === print.print_info.wellplate) ? 0 : 1;
            dims++;
        }
        if (params.layerNum !== undefined) {
            var d = normalize(params.layerNum, paramRanges.layerNum) -
                normalize(print.print_info.resolution.layerNum, paramRanges.layerNum);
            sumSq += d * d;
            dims++;
        }
        if (params.layerHeight !== undefined) {
            var d = normalize(params.layerHeight, paramRanges.layerHeight) -
                normalize(print.print_info.resolution.layerHeight, paramRanges.layerHeight);
            sumSq += d * d;
            dims++;
        }
        if (params.cl_enabled !== undefined) {
            sumSq += (params.cl_enabled === print.print_info.crosslinking.cl_enabled) ? 0 : 1;
            dims++;
        }
        if (params.cl_duration !== undefined) {
            var d = normalize(params.cl_duration, paramRanges.cl_duration) -
                normalize(print.print_info.crosslinking.cl_duration, paramRanges.cl_duration);
            sumSq += d * d;
            dims++;
        }
        if (params.cl_intensity !== undefined) {
            var d = normalize(params.cl_intensity, paramRanges.cl_intensity) -
                normalize(print.print_info.crosslinking.cl_intensity, paramRanges.cl_intensity);
            sumSq += d * d;
            dims++;
        }

        return dims > 0 ? Math.sqrt(sumSq / dims) : Infinity;
    }

    // Find k nearest neighbors
    function findKNearest(params, data, paramRanges, k) {
        var candidates = [];
        for (var i = 0; i < data.length; i++) {
            var p = data[i];
            if (params.cl_enabled !== undefined && p.print_info.crosslinking.cl_enabled !== params.cl_enabled) {
                continue;
            }
            var dist = distance(params, p, paramRanges);
            candidates.push({ print: p, dist: dist, index: i });
        }
        candidates.sort(function(a, b) { return a.dist - b.dist; });
        return candidates.slice(0, k);
    }

    // Inverse distance weighted prediction
    function predict(neighbors) {
        var liveSum = 0, elastSum = 0, weightSum = 0;
        var liveMin = Infinity, liveMax = -Infinity;
        var elastMin = Infinity, elastMax = -Infinity;

        for (var i = 0; i < neighbors.length; i++) {
            var n = neighbors[i];
            var w = n.dist > 0 ? 1 / (n.dist * n.dist + 0.001) : 1000;
            var live = n.print.print_data.livePercent;
            var elast = n.print.print_data.elasticity;

            liveSum += live * w;
            elastSum += elast * w;
            weightSum += w;

            if (live < liveMin) liveMin = live;
            if (live > liveMax) liveMax = live;
            if (elast < elastMin) elastMin = elast;
            if (elast > elastMax) elastMax = elast;
        }

        return {
            livePercent: liveSum / weightSum,
            elasticity: elastSum / weightSum,
            liveMin: liveMin,
            liveMax: liveMax,
            elastMin: elastMin,
            elastMax: elastMax
        };
    }

    // Grade calculation
    function getGrade(livePercent, elasticity) {
        var liveScore = Math.min(livePercent / 80, 1);
        var elastScore = Math.min(elasticity / 50, 1);
        var overall = liveScore * 0.7 + elastScore * 0.3;

        if (overall >= 0.85) return { label: 'A — Excellent', cls: 'grade-excellent' };
        if (overall >= 0.65) return { label: 'B — Good', cls: 'grade-good' };
        if (overall >= 0.45) return { label: 'C — Fair', cls: 'grade-fair' };
        return { label: 'D — Needs Work', cls: 'grade-poor' };
    }

    // Standard deviation
    function computeStdDev(arr) {
        if (arr.length < 2) return 0;
        var mean = 0;
        for (var i = 0; i < arr.length; i++) mean += arr[i];
        mean /= arr.length;
        var sumSq = 0;
        for (var i = 0; i < arr.length; i++) {
            var d = arr[i] - mean;
            sumSq += d * d;
        }
        return Math.sqrt(sumSq / (arr.length - 1));
    }

    // Compute ranges from data
    function computeRanges(data) {
        var fields = [
            { key: 'extruder1', fn: function(p) { return p.print_info.pressure.extruder1; } },
            { key: 'extruder2', fn: function(p) { return p.print_info.pressure.extruder2; } },
            { key: 'layerNum', fn: function(p) { return p.print_info.resolution.layerNum; } },
            { key: 'layerHeight', fn: function(p) { return p.print_info.resolution.layerHeight; } },
            { key: 'cl_duration', fn: function(p) { return p.print_info.crosslinking.cl_duration; } },
            { key: 'cl_intensity', fn: function(p) { return p.print_info.crosslinking.cl_intensity; } },
            { key: 'wellplate', fn: function(p) { return p.print_info.wellplate; } }
        ];
        var ranges = {};
        for (var i = 0; i < fields.length; i++) {
            var min = Infinity, max = -Infinity, sum = 0;
            for (var j = 0; j < data.length; j++) {
                var v = fields[i].fn(data[j]);
                if (v < min) min = v;
                if (v > max) max = v;
                sum += v;
            }
            ranges[fields[i].key] = { min: min, max: max, avg: sum / data.length };
        }
        return ranges;
    }

    return {
        normalize: normalize,
        distance: distance,
        findKNearest: findKNearest,
        predict: predict,
        getGrade: getGrade,
        computeStdDev: computeStdDev,
        computeRanges: computeRanges
    };
}

if (typeof module !== 'undefined') module.exports = { createPredictor: createPredictor };

// ── Test Helpers ──

function makePrint(opts) {
    opts = opts || {};
    return {
        user_info: { serial: opts.serial || 1, email: 'test@test.com' },
        print_info: {
            files: { input: 'a.gcode', output: 'b.gcode' },
            pressure: {
                extruder1: opts.ext1 !== undefined ? opts.ext1 : 5.0,
                extruder2: opts.ext2 !== undefined ? opts.ext2 : 3.0
            },
            crosslinking: {
                cl_enabled: opts.cl_enabled !== undefined ? opts.cl_enabled : true,
                cl_duration: opts.cl_duration !== undefined ? opts.cl_duration : 500,
                cl_intensity: opts.cl_intensity !== undefined ? opts.cl_intensity : 50
            },
            resolution: {
                layerNum: opts.layers !== undefined ? opts.layers : 8,
                layerHeight: opts.height !== undefined ? opts.height : 0.25
            },
            wellplate: opts.wellplate !== undefined ? opts.wellplate : 6
        },
        print_data: {
            livePercent: opts.live !== undefined ? opts.live : 60,
            elasticity: opts.elast !== undefined ? opts.elast : 35,
            deadPercent: opts.dead !== undefined ? opts.dead : 40
        }
    };
}

// ── Tests ──

describe('createPredictor', () => {
    let pred;

    beforeEach(() => {
        pred = createPredictor();
    });

    // ── normalize ──

    describe('normalize', () => {
        test('normalizes value within range', () => {
            expect(pred.normalize(5, { min: 0, max: 10 })).toBe(0.5);
        });

        test('returns 0 for min value', () => {
            expect(pred.normalize(0, { min: 0, max: 10 })).toBe(0);
        });

        test('returns 1 for max value', () => {
            expect(pred.normalize(10, { min: 0, max: 10 })).toBe(1);
        });

        test('returns 0 when min equals max', () => {
            expect(pred.normalize(5, { min: 5, max: 5 })).toBe(0);
        });

        test('returns 0 for null range', () => {
            expect(pred.normalize(5, null)).toBe(0);
        });

        test('handles negative ranges', () => {
            expect(pred.normalize(0, { min: -10, max: 10 })).toBe(0.5);
        });

        test('handles values outside range', () => {
            expect(pred.normalize(15, { min: 0, max: 10 })).toBe(1.5);
        });
    });

    // ── distance ──

    describe('distance', () => {
        const ranges = {
            extruder1: { min: 0, max: 10 },
            extruder2: { min: 0, max: 10 },
            layerNum: { min: 1, max: 20 },
            layerHeight: { min: 0.1, max: 0.5 },
            cl_duration: { min: 0, max: 1000 },
            cl_intensity: { min: 0, max: 100 }
        };

        test('returns 0 for identical params', () => {
            const print = makePrint({ ext1: 5.0 });
            const params = { extruder1: 5.0 };
            expect(pred.distance(params, print, ranges)).toBe(0);
        });

        test('returns positive for different params', () => {
            const print = makePrint({ ext1: 5.0 });
            const params = { extruder1: 8.0 };
            expect(pred.distance(params, print, ranges)).toBeGreaterThan(0);
        });

        test('returns Infinity when no params specified', () => {
            const print = makePrint();
            expect(pred.distance({}, print, ranges)).toBe(Infinity);
        });

        test('wellplate match gives distance 0', () => {
            const print = makePrint({ wellplate: 6 });
            const params = { wellplate: 6 };
            expect(pred.distance(params, print, ranges)).toBe(0);
        });

        test('wellplate mismatch adds to distance', () => {
            const print = makePrint({ wellplate: 6 });
            const params = { wellplate: 96 };
            expect(pred.distance(params, print, ranges)).toBe(1);
        });

        test('cl_enabled match gives 0', () => {
            const print = makePrint({ cl_enabled: true });
            const params = { cl_enabled: true };
            expect(pred.distance(params, print, ranges)).toBe(0);
        });

        test('cl_enabled mismatch adds to distance', () => {
            const print = makePrint({ cl_enabled: true });
            const params = { cl_enabled: false };
            expect(pred.distance(params, print, ranges)).toBe(1);
        });

        test('multiple params average correctly', () => {
            const print = makePrint({ ext1: 5.0, ext2: 5.0 });
            const params = { extruder1: 5.0, extruder2: 5.0 };
            expect(pred.distance(params, print, ranges)).toBe(0);
        });

        test('higher difference gives higher distance', () => {
            const print = makePrint({ ext1: 5.0 });
            const d1 = pred.distance({ extruder1: 6.0 }, print, ranges);
            const d2 = pred.distance({ extruder1: 9.0 }, print, ranges);
            expect(d2).toBeGreaterThan(d1);
        });
    });

    // ── findKNearest ──

    describe('findKNearest', () => {
        const data = [
            makePrint({ ext1: 1, live: 90, elast: 50 }),
            makePrint({ ext1: 5, live: 60, elast: 30 }),
            makePrint({ ext1: 9, live: 40, elast: 20 }),
            makePrint({ ext1: 3, live: 75, elast: 40 }),
            makePrint({ ext1: 7, live: 50, elast: 25 }),
        ];
        const ranges = { extruder1: { min: 1, max: 9 } };

        test('returns k neighbors', () => {
            const result = pred.findKNearest({ extruder1: 5 }, data, ranges, 3);
            expect(result).toHaveLength(3);
        });

        test('returns all if k > data size', () => {
            const result = pred.findKNearest({ extruder1: 5 }, data, ranges, 10);
            expect(result).toHaveLength(5);
        });

        test('nearest neighbor is closest', () => {
            const result = pred.findKNearest({ extruder1: 5 }, data, ranges, 1);
            expect(result[0].print.print_info.pressure.extruder1).toBe(5);
        });

        test('neighbors are sorted by distance', () => {
            const result = pred.findKNearest({ extruder1: 2 }, data, ranges, 5);
            for (var i = 1; i < result.length; i++) {
                expect(result[i].dist).toBeGreaterThanOrEqual(result[i - 1].dist);
            }
        });

        test('filters by cl_enabled when specified', () => {
            const mixed = [
                makePrint({ ext1: 5, cl_enabled: true, live: 70 }),
                makePrint({ ext1: 5, cl_enabled: false, live: 50 }),
                makePrint({ ext1: 5, cl_enabled: true, live: 60 }),
            ];
            const result = pred.findKNearest(
                { extruder1: 5, cl_enabled: true }, mixed, ranges, 5);
            expect(result).toHaveLength(2);
        });

        test('returns empty for no matching data', () => {
            const result = pred.findKNearest(
                { cl_enabled: true },
                [makePrint({ cl_enabled: false })],
                ranges, 5);
            expect(result).toHaveLength(0);
        });
    });

    // ── predict ──

    describe('predict', () => {
        test('returns weighted average for uniform neighbors', () => {
            const neighbors = [
                { print: makePrint({ live: 80, elast: 40 }), dist: 0.1 },
                { print: makePrint({ live: 80, elast: 40 }), dist: 0.1 },
            ];
            const result = pred.predict(neighbors);
            expect(result.livePercent).toBeCloseTo(80, 1);
            expect(result.elasticity).toBeCloseTo(40, 1);
        });

        test('closer neighbor has more weight', () => {
            const neighbors = [
                { print: makePrint({ live: 90 }), dist: 0.01 }, // very close
                { print: makePrint({ live: 10 }), dist: 1.0 },  // far
            ];
            const result = pred.predict(neighbors);
            expect(result.livePercent).toBeGreaterThan(80); // dominated by close neighbor
        });

        test('zero distance gives max weight', () => {
            const neighbors = [
                { print: makePrint({ live: 100 }), dist: 0 },
                { print: makePrint({ live: 0 }), dist: 0.5 },
            ];
            const result = pred.predict(neighbors);
            expect(result.livePercent).toBeGreaterThan(95);
        });

        test('computes min and max correctly', () => {
            const neighbors = [
                { print: makePrint({ live: 30, elast: 10 }), dist: 0.1 },
                { print: makePrint({ live: 90, elast: 60 }), dist: 0.1 },
            ];
            const result = pred.predict(neighbors);
            expect(result.liveMin).toBe(30);
            expect(result.liveMax).toBe(90);
            expect(result.elastMin).toBe(10);
            expect(result.elastMax).toBe(60);
        });

        test('single neighbor prediction', () => {
            const neighbors = [
                { print: makePrint({ live: 65, elast: 33 }), dist: 0.2 }
            ];
            const result = pred.predict(neighbors);
            expect(result.livePercent).toBeCloseTo(65, 1);
            expect(result.elasticity).toBeCloseTo(33, 1);
        });
    });

    // ── getGrade ──

    describe('getGrade', () => {
        test('excellent for high viability and elasticity', () => {
            const grade = pred.getGrade(85, 55);
            expect(grade.label).toContain('Excellent');
            expect(grade.cls).toBe('grade-excellent');
        });

        test('good for moderate values', () => {
            const grade = pred.getGrade(65, 40);
            expect(grade.label).toContain('Good');
            expect(grade.cls).toBe('grade-good');
        });

        test('fair for below-average', () => {
            const grade = pred.getGrade(45, 25);
            expect(grade.label).toContain('Fair');
            expect(grade.cls).toBe('grade-fair');
        });

        test('needs work for low values', () => {
            const grade = pred.getGrade(15, 10);
            expect(grade.label).toContain('Needs Work');
            expect(grade.cls).toBe('grade-poor');
        });

        test('viability weighted more (70%) than elasticity (30%)', () => {
            // High viability, low elasticity → should still be decent
            const grade1 = pred.getGrade(80, 5);
            // Low viability, high elasticity → should be worse
            const grade2 = pred.getGrade(20, 80);
            // grade1 should be better (Good vs Fair/Poor)
            expect(grade1.cls).not.toBe('grade-poor');
        });

        test('perfect scores give excellent', () => {
            const grade = pred.getGrade(100, 100);
            expect(grade.label).toContain('Excellent');
        });

        test('zero scores give needs work', () => {
            const grade = pred.getGrade(0, 0);
            expect(grade.label).toContain('Needs Work');
        });
    });

    // ── computeStdDev ──

    describe('computeStdDev', () => {
        test('returns 0 for single value', () => {
            expect(pred.computeStdDev([42])).toBe(0);
        });

        test('returns 0 for empty array', () => {
            expect(pred.computeStdDev([])).toBe(0);
        });

        test('returns 0 for identical values', () => {
            expect(pred.computeStdDev([5, 5, 5, 5])).toBe(0);
        });

        test('computes correct std dev', () => {
            // [2, 4, 4, 4, 5, 5, 7, 9] → mean=5, σ≈2.138
            const result = pred.computeStdDev([2, 4, 4, 4, 5, 5, 7, 9]);
            expect(result).toBeCloseTo(2.138, 2);
        });

        test('higher spread gives higher std dev', () => {
            const narrow = pred.computeStdDev([49, 50, 51]);
            const wide = pred.computeStdDev([10, 50, 90]);
            expect(wide).toBeGreaterThan(narrow);
        });
    });

    // ── computeRanges ──

    describe('computeRanges', () => {
        test('computes correct ranges', () => {
            const data = [
                makePrint({ ext1: 2, ext2: 1, layers: 5, height: 0.1 }),
                makePrint({ ext1: 8, ext2: 3, layers: 15, height: 0.5 }),
            ];
            const ranges = pred.computeRanges(data);
            expect(ranges.extruder1.min).toBe(2);
            expect(ranges.extruder1.max).toBe(8);
            expect(ranges.extruder1.avg).toBe(5);
        });

        test('handles single item', () => {
            const data = [makePrint({ ext1: 5 })];
            const ranges = pred.computeRanges(data);
            expect(ranges.extruder1.min).toBe(5);
            expect(ranges.extruder1.max).toBe(5);
        });

        test('includes all parameter keys', () => {
            const data = [makePrint()];
            const ranges = pred.computeRanges(data);
            expect(Object.keys(ranges)).toEqual(
                expect.arrayContaining(['extruder1', 'extruder2', 'layerNum',
                    'layerHeight', 'cl_duration', 'cl_intensity', 'wellplate'])
            );
        });
    });

    // ── Integration: end-to-end prediction ──

    describe('end-to-end prediction', () => {
        const data = [
            makePrint({ ext1: 3, ext2: 2, layers: 8, wellplate: 6, live: 85, elast: 45 }),
            makePrint({ ext1: 3, ext2: 2, layers: 8, wellplate: 6, live: 80, elast: 42 }),
            makePrint({ ext1: 3, ext2: 2, layers: 8, wellplate: 6, live: 90, elast: 48 }),
            makePrint({ ext1: 7, ext2: 5, layers: 4, wellplate: 96, live: 30, elast: 15 }),
            makePrint({ ext1: 7, ext2: 5, layers: 4, wellplate: 96, live: 25, elast: 12 }),
        ];

        test('predicts high viability for similar-to-good params', () => {
            const ranges = pred.computeRanges(data);
            const neighbors = pred.findKNearest(
                { extruder1: 3, extruder2: 2, layerNum: 8, wellplate: 6 },
                data, ranges, 3
            );
            const result = pred.predict(neighbors);
            expect(result.livePercent).toBeGreaterThan(75);
            expect(result.elasticity).toBeGreaterThan(40);
        });

        test('predicts low viability for similar-to-bad params', () => {
            const ranges = pred.computeRanges(data);
            const neighbors = pred.findKNearest(
                { extruder1: 7, extruder2: 5, layerNum: 4, wellplate: 96 },
                data, ranges, 3
            );
            const result = pred.predict(neighbors);
            expect(result.livePercent).toBeLessThan(40);
        });

        test('correct grade for good prediction', () => {
            const ranges = pred.computeRanges(data);
            const neighbors = pred.findKNearest(
                { extruder1: 3, extruder2: 2 },
                data, ranges, 3
            );
            const result = pred.predict(neighbors);
            const grade = pred.getGrade(result.livePercent, result.elasticity);
            expect(['grade-excellent', 'grade-good']).toContain(grade.cls);
        });
    });
});
