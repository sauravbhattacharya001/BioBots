/**
 * @jest-environment jsdom
 */

describe('Pareto Front Analyzer', () => {

    // Core Pareto dominance logic extracted from pareto.html
    function computeParetoFront(points, xMax, yMax) {
        const dominated = new Set();
        for (let i = 0; i < points.length; i++) {
            if (dominated.has(i)) continue;
            for (let j = 0; j < points.length; j++) {
                if (i === j || dominated.has(j)) continue;
                const ix = points[i].x, iy = points[i].y;
                const jx = points[j].x, jy = points[j].y;
                const iBetterX = xMax ? ix >= jx : ix <= jx;
                const iBetterY = yMax ? iy >= jy : iy <= jy;
                const iStrictX = xMax ? ix > jx : ix < jx;
                const iStrictY = yMax ? iy > jy : iy < jy;
                if (iBetterX && iBetterY && (iStrictX || iStrictY)) {
                    dominated.add(j);
                }
            }
        }
        return dominated;
    }

    describe('Pareto dominance — maximize both', () => {
        test('single point is always non-dominated', () => {
            const pts = [{ x: 5, y: 5 }];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(0);
        });

        test('two identical points are both non-dominated', () => {
            const pts = [{ x: 5, y: 5 }, { x: 5, y: 5 }];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(0);
        });

        test('one dominates the other (maximize)', () => {
            const pts = [{ x: 10, y: 10 }, { x: 5, y: 5 }];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(1);
            expect(dom.has(1)).toBe(true);
        });

        test('neither dominates when on trade-off curve', () => {
            const pts = [{ x: 10, y: 1 }, { x: 1, y: 10 }];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(0);
        });

        test('classic three-point front', () => {
            const pts = [
                { x: 10, y: 1 },
                { x: 5, y: 5 },
                { x: 1, y: 10 },
                { x: 3, y: 3 }
            ];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(1);
            expect(dom.has(3)).toBe(true);
        });

        test('dominated if equal in one and worse in other', () => {
            const pts = [{ x: 10, y: 5 }, { x: 10, y: 3 }];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(1);
            expect(dom.has(1)).toBe(true);
        });

        test('larger dataset', () => {
            const pts = [
                { x: 9, y: 1 },
                { x: 7, y: 4 },
                { x: 5, y: 6 },
                { x: 3, y: 8 },
                { x: 1, y: 9 },
                { x: 6, y: 3 },
                { x: 4, y: 5 },
                { x: 2, y: 2 }
            ];
            const dom = computeParetoFront(pts, true, true);
            const front = pts.filter((_, i) => !dom.has(i));
            expect(front.length).toBe(5);
            expect(dom.has(5)).toBe(true);  // (6,3) dominated by (7,4)
            expect(dom.has(6)).toBe(true);  // (4,5) dominated by (5,6)
            expect(dom.has(7)).toBe(true);  // (2,2) dominated by many
        });

        test('all on front', () => {
            const pts = [
                { x: 10, y: 0 },
                { x: 8, y: 2 },
                { x: 6, y: 4 },
                { x: 4, y: 6 },
                { x: 2, y: 8 },
                { x: 0, y: 10 }
            ];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(0);
        });

        test('all dominated except one', () => {
            const pts = [
                { x: 10, y: 10 },
                { x: 1, y: 1 },
                { x: 2, y: 2 },
                { x: 3, y: 3 },
                { x: 9, y: 9 }
            ];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(4);
            expect(dom.has(0)).toBe(false);
        });
    });

    describe('Pareto dominance — minimize both', () => {
        test('lower values are better', () => {
            const pts = [{ x: 1, y: 1 }, { x: 5, y: 5 }];
            const dom = computeParetoFront(pts, false, false);
            expect(dom.size).toBe(1);
            expect(dom.has(1)).toBe(true);
        });

        test('trade-off in minimize mode', () => {
            const pts = [{ x: 1, y: 10 }, { x: 10, y: 1 }];
            const dom = computeParetoFront(pts, false, false);
            expect(dom.size).toBe(0);
        });

        test('mixed dominance minimize', () => {
            const pts = [
                { x: 1, y: 8 },
                { x: 3, y: 5 },
                { x: 5, y: 3 },
                { x: 8, y: 1 },
                { x: 6, y: 6 }  // dominated: (5,3) has both < (6,6)
            ];
            const dom = computeParetoFront(pts, false, false);
            expect(dom.size).toBe(1);
            expect(dom.has(4)).toBe(true);
        });
    });

    describe('Pareto dominance — mixed directions', () => {
        test('maximize X, minimize Y', () => {
            // Want high X, low Y
            const pts = [
                { x: 10, y: 1 },  // ideal
                { x: 5, y: 5 },   // middle
                { x: 1, y: 10 },  // worst
            ];
            const dom = computeParetoFront(pts, true, false);
            // (10,1) dominates (5,5) and (1,10)
            expect(dom.size).toBe(2);
            expect(dom.has(0)).toBe(false);
        });

        test('minimize X, maximize Y', () => {
            const pts = [
                { x: 1, y: 10 },
                { x: 5, y: 5 },
                { x: 10, y: 1 }
            ];
            const dom = computeParetoFront(pts, false, true);
            expect(dom.size).toBe(2);
            expect(dom.has(0)).toBe(false);
        });

        test('mixed with trade-offs preserved', () => {
            // Maximize X, minimize Y
            const pts = [
                { x: 10, y: 5 },
                { x: 5, y: 1 },
                { x: 8, y: 3 }
            ];
            const dom = computeParetoFront(pts, true, false);
            // (10,5) and (5,1) form the front; (8,3) is in between...
            // (10,5) doesn't dominate (5,1) because 5>1 (Y worse in max-X min-Y)
            // (8,3) — is it dominated? By (10,5)? x: 10>8 yes, y: 5>3 but we minimize Y so 3<5 is better
            // So neither dominates the other. All 3 on front.
            expect(dom.size).toBe(0);
        });
    });

    describe('Edge cases', () => {
        test('empty array', () => {
            const dom = computeParetoFront([], true, true);
            expect(dom.size).toBe(0);
        });

        test('two points with same X', () => {
            const pts = [{ x: 5, y: 10 }, { x: 5, y: 3 }];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(1);
            expect(dom.has(1)).toBe(true);
        });

        test('two points with same Y', () => {
            const pts = [{ x: 10, y: 5 }, { x: 3, y: 5 }];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(1);
            expect(dom.has(1)).toBe(true);
        });

        test('negative values', () => {
            const pts = [{ x: -1, y: -1 }, { x: -5, y: -5 }];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(1);
            expect(dom.has(1)).toBe(true);
        });

        test('zero values', () => {
            const pts = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(0);
        });

        test('floating point values', () => {
            const pts = [{ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.1 }];
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBe(0);
        });
    });

    describe('Knee point detection', () => {
        function findKnee(frontPts, xMaxDir, yMaxDir) {
            if (frontPts.length < 2) return frontPts[0] || null;
            const fxVals = frontPts.map(p => p.x);
            const fyVals = frontPts.map(p => p.y);
            const xNorm = xMaxDir ? Math.max(...fxVals) : Math.min(...fxVals);
            const yNorm = yMaxDir ? Math.max(...fyVals) : Math.min(...fyVals);
            const xSpread = (Math.max(...fxVals) - Math.min(...fxVals)) || 1;
            const ySpread = (Math.max(...fyVals) - Math.min(...fyVals)) || 1;
            let kneePt = frontPts[0], minDist = Infinity;
            frontPts.forEach(p => {
                const dx = (p.x - xNorm) / xSpread;
                const dy = (p.y - yNorm) / ySpread;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < minDist) { minDist = d; kneePt = p; }
            });
            return kneePt;
        }

        test('knee point is closest to ideal corner (maximize both)', () => {
            const pts = [
                { x: 10, y: 1 },
                { x: 6, y: 6 },
                { x: 1, y: 10 }
            ];
            const knee = findKnee(pts, true, true);
            expect(knee.x).toBe(6);
            expect(knee.y).toBe(6);
        });

        test('knee point minimize both', () => {
            const pts = [
                { x: 1, y: 8 },
                { x: 4, y: 4 },
                { x: 8, y: 1 }
            ];
            const knee = findKnee(pts, false, false);
            expect(knee.x).toBe(4);
            expect(knee.y).toBe(4);
        });

        test('single point returns itself', () => {
            const pts = [{ x: 5, y: 5 }];
            const knee = findKnee(pts, true, true);
            expect(knee.x).toBe(5);
        });

        test('two points returns closest to ideal', () => {
            const pts = [{ x: 10, y: 1 }, { x: 1, y: 10 }];
            const knee = findKnee(pts, true, true);
            // Both equidistant from (10,10) in normalized coords — first wins
            expect(knee).toBeDefined();
        });
    });

    describe('Front statistics', () => {
        function frontStats(points, xMax, yMax) {
            const dom = computeParetoFront(points, xMax, yMax);
            const front = points.filter((_, i) => !dom.has(i));
            const xs = front.map(p => p.x);
            const ys = front.map(p => p.y);
            return {
                total: points.length,
                frontSize: front.length,
                dominated: dom.size,
                ratio: front.length / points.length,
                xRange: Math.max(...xs) - Math.min(...xs),
                yRange: Math.max(...ys) - Math.min(...ys),
                xMean: xs.reduce((a, b) => a + b, 0) / xs.length,
                yMean: ys.reduce((a, b) => a + b, 0) / ys.length
            };
        }

        test('stats for balanced front', () => {
            const pts = [
                { x: 10, y: 1 },
                { x: 7, y: 4 },
                { x: 4, y: 7 },
                { x: 1, y: 10 },
                { x: 3, y: 3 }   // dominated by (4,7) and (7,4)
            ];
            const s = frontStats(pts, true, true);
            expect(s.total).toBe(5);
            expect(s.frontSize).toBe(4);
            expect(s.dominated).toBe(1);
            expect(s.ratio).toBeCloseTo(0.8, 1);
            expect(s.xRange).toBe(9);
            expect(s.yRange).toBe(9);
        });

        test('all dominated gives ratio 1/N', () => {
            const pts = [
                { x: 10, y: 10 },
                { x: 1, y: 1 },
                { x: 2, y: 2 }
            ];
            const s = frontStats(pts, true, true);
            expect(s.frontSize).toBe(1);
            expect(s.ratio).toBeCloseTo(1 / 3, 1);
        });

        test('front + dominated sums to total', () => {
            const pts = [];
            for (let i = 0; i < 20; i++) {
                pts.push({ x: Math.random() * 100, y: Math.random() * 100 });
            }
            const s = frontStats(pts, true, true);
            expect(s.frontSize + s.dominated).toBe(s.total);
        });
    });

    describe('Correlation on front', () => {
        function pearson(xs, ys) {
            const n = xs.length;
            if (n < 3) return 0;
            let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
            for (let i = 0; i < n; i++) {
                sx += xs[i]; sy += ys[i];
                sxx += xs[i] * xs[i]; syy += ys[i] * ys[i];
                sxy += xs[i] * ys[i];
            }
            const num = n * sxy - sx * sy;
            const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
            return den === 0 ? 0 : num / den;
        }

        test('perfect negative correlation', () => {
            const r = pearson([1, 2, 3, 4], [4, 3, 2, 1]);
            expect(r).toBeCloseTo(-1, 5);
        });

        test('perfect positive correlation', () => {
            const r = pearson([1, 2, 3, 4], [1, 2, 3, 4]);
            expect(r).toBeCloseTo(1, 5);
        });

        test('no correlation', () => {
            const r = pearson([1, 2, 3, 4], [5, 5, 5, 5]);
            expect(r).toBe(0);
        });

        test('fewer than 3 points returns 0', () => {
            expect(pearson([1], [2])).toBe(0);
            expect(pearson([1, 2], [3, 4])).toBe(0);
        });
    });

    describe('METRICS extraction', () => {
        const sampleRecord = {
            print_data: { deadPercent: 84.01, elasticity: 49.28, livePercent: 7.02 },
            print_info: {
                crosslinking: { cl_duration: 22793, cl_enabled: true, cl_intensity: 24 },
                pressure: { extruder1: 38.0, extruder2: 93.0 },
                resolution: { layerHeight: 0.8, layerNum: 48 },
                wellplate: 6
            },
            user_info: { name: 'test', org: 'lab' }
        };

        const METRICS = [
            { key: 'livePercent',  get: p => p.print_data.livePercent },
            { key: 'deadPercent',  get: p => p.print_data.deadPercent },
            { key: 'elasticity',   get: p => p.print_data.elasticity },
            { key: 'cl_duration',  get: p => p.print_info.crosslinking.cl_duration },
            { key: 'cl_intensity', get: p => p.print_info.crosslinking.cl_intensity },
            { key: 'extruder1',    get: p => p.print_info.pressure.extruder1 },
            { key: 'extruder2',    get: p => p.print_info.pressure.extruder2 },
            { key: 'layerHeight',  get: p => p.print_info.resolution.layerHeight },
            { key: 'layerNum',     get: p => p.print_info.resolution.layerNum },
            { key: 'wellplate',    get: p => p.print_info.wellplate },
        ];

        test('extracts all 10 metrics', () => {
            const values = METRICS.map(m => m.get(sampleRecord));
            expect(values).toEqual([7.02, 84.01, 49.28, 22793, 24, 38.0, 93.0, 0.8, 48, 6]);
        });

        test('all values are numbers', () => {
            METRICS.forEach(m => {
                expect(typeof m.get(sampleRecord)).toBe('number');
            });
        });
    });

    describe('Front sorting', () => {
        test('front points sort by X ascending', () => {
            const pts = [
                { x: 5, y: 6, idx: 0 },
                { x: 1, y: 10, idx: 1 },
                { x: 10, y: 1, idx: 2 }
            ];
            pts.sort((a, b) => a.x - b.x);
            expect(pts[0].x).toBe(1);
            expect(pts[1].x).toBe(5);
            expect(pts[2].x).toBe(10);
        });
    });

    describe('Scalability', () => {
        test('handles 1000 points without error', () => {
            const pts = [];
            for (let i = 0; i < 1000; i++) {
                pts.push({ x: Math.random() * 100, y: Math.random() * 100 });
            }
            const dom = computeParetoFront(pts, true, true);
            expect(dom.size).toBeLessThan(1000);
            expect(dom.size).toBeGreaterThanOrEqual(0);
            expect(pts.length - dom.size).toBeGreaterThan(0);
        });

        test('deterministic results', () => {
            const pts = [
                { x: 10, y: 1 }, { x: 8, y: 3 }, { x: 5, y: 6 },
                { x: 2, y: 9 }, { x: 4, y: 4 }, { x: 7, y: 2 }
            ];
            const dom1 = computeParetoFront(pts, true, true);
            const dom2 = computeParetoFront(pts, true, true);
            expect([...dom1].sort()).toEqual([...dom2].sort());
        });
    });
});
