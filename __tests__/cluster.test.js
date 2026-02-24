/**
 * @jest-environment jsdom
 *
 * Tests for cluster.html — Cluster Analysis
 *
 * Tests cover:
 *  - normalizeMatrix (min-max scaling)
 *  - euclidean distance
 *  - seededRandom (deterministic PRNG)
 *  - kMeansPPInit (k-means++ initialization)
 *  - kMeans clustering
 *  - computeClusterProfiles (descriptive stats per cluster)
 *  - silhouetteCoefficients (cluster quality)
 *  - findOptimalK (elbow + silhouette analysis)
 *  - Integration / rendering
 */

'use strict';

// ── Sample data ────────────────────────────────────────
const sampleData = [
    {
        print_data: { deadPercent: 84.01, elasticity: 49.28, livePercent: 7.02 },
        print_info: {
            crosslinking: { cl_duration: 22793, cl_enabled: true, cl_intensity: 24 },
            files: { input: 'file_0.gcode', output: 'file_0_output.gcode' },
            pressure: { extruder1: 38.0, extruder2: 93.0 },
            resolution: { layerHeight: 0.8, layerNum: 48 },
            wellplate: 6
        },
        user_info: { email: 'user0@gmail.com', serial: 0 }
    },
    {
        print_data: { deadPercent: 53.09, elasticity: 47.42, livePercent: 37.42 },
        print_info: {
            crosslinking: { cl_duration: 0, cl_enabled: false, cl_intensity: 0 },
            files: { input: 'file_1.gcode', output: 'file_1_output.gcode' },
            pressure: { extruder1: 109.0, extruder2: 40.0 },
            resolution: { layerHeight: 0.3, layerNum: 25 },
            wellplate: 12
        },
        user_info: { email: 'user1@gmail.com', serial: 1 }
    },
    {
        print_data: { deadPercent: 20.0, elasticity: 80.5, livePercent: 72.3 },
        print_info: {
            crosslinking: { cl_duration: 15000, cl_enabled: true, cl_intensity: 50 },
            files: { input: 'file_2.gcode', output: 'file_2_output.gcode' },
            pressure: { extruder1: 60.0, extruder2: 65.0 },
            resolution: { layerHeight: 0.5, layerNum: 100 },
            wellplate: 6
        },
        user_info: { email: 'user2@gmail.com', serial: 2 }
    },
    {
        print_data: { deadPercent: 45.0, elasticity: 55.0, livePercent: 50.0 },
        print_info: {
            crosslinking: { cl_duration: 10000, cl_enabled: true, cl_intensity: 40 },
            files: { input: 'file_3.gcode', output: 'file_3_output.gcode' },
            pressure: { extruder1: 70.0, extruder2: 70.0 },
            resolution: { layerHeight: 0.5, layerNum: 60 },
            wellplate: 24
        },
        user_info: { email: 'user3@gmail.com', serial: 3 }
    },
    {
        print_data: { deadPercent: 50.0, elasticity: 52.0, livePercent: 45.0 },
        print_info: {
            crosslinking: { cl_duration: 12000, cl_enabled: true, cl_intensity: 35 },
            files: { input: 'file_4.gcode', output: 'file_4_output.gcode' },
            pressure: { extruder1: 65.0, extruder2: 60.0 },
            resolution: { layerHeight: 0.4, layerNum: 50 },
            wellplate: 6
        },
        user_info: { email: 'user4@gmail.com', serial: 4 }
    },
    {
        print_data: { deadPercent: 99.5, elasticity: 200.0, livePercent: 0.5 },
        print_info: {
            crosslinking: { cl_duration: 90000, cl_enabled: true, cl_intensity: 100 },
            files: { input: 'file_5.gcode', output: 'file_5_output.gcode' },
            pressure: { extruder1: 250.0, extruder2: 250.0 },
            resolution: { layerHeight: 2.0, layerNum: 500 },
            wellplate: 96
        },
        user_info: { email: 'outlier@gmail.com', serial: 99 }
    }
];

// ── Functions extracted from cluster.html ──────────────

const METRICS = ['livePercent', 'deadPercent', 'elasticity', 'cl_duration', 'cl_intensity', 'extruder1', 'extruder2', 'layerHeight', 'layerNum'];

const metricLabels = {
    livePercent: 'Live Cell %',
    deadPercent: 'Dead Cell %',
    elasticity: 'Elasticity (kPa)',
    cl_duration: 'CL Duration (ms)',
    cl_intensity: 'CL Intensity (%)',
    extruder1: 'Extruder 1 Pressure',
    extruder2: 'Extruder 2 Pressure',
    layerHeight: 'Layer Height (mm)',
    layerNum: 'Layer Count'
};

function getMetricValue(print, metric) {
    const paths = {
        livePercent: p => p.print_data.livePercent,
        deadPercent: p => p.print_data.deadPercent,
        elasticity: p => p.print_data.elasticity,
        cl_duration: p => p.print_info.crosslinking.cl_duration,
        cl_intensity: p => p.print_info.crosslinking.cl_intensity,
        extruder1: p => p.print_info.pressure.extruder1,
        extruder2: p => p.print_info.pressure.extruder2,
        layerHeight: p => p.print_info.resolution.layerHeight,
        layerNum: p => p.print_info.resolution.layerNum,
    };
    try { return paths[metric] ? paths[metric](print) : null; }
    catch { return null; }
}

function normalizeMatrix(matrix) {
    if (matrix.length === 0) return { normalized: [], mins: [], maxs: [] };
    const cols = matrix[0].length;
    const mins = new Array(cols).fill(Infinity);
    const maxs = new Array(cols).fill(-Infinity);

    for (let i = 0; i < matrix.length; i++) {
        for (let j = 0; j < cols; j++) {
            if (matrix[i][j] < mins[j]) mins[j] = matrix[i][j];
            if (matrix[i][j] > maxs[j]) maxs[j] = matrix[i][j];
        }
    }

    const normalized = matrix.map(row =>
        row.map((val, j) => {
            const range = maxs[j] - mins[j];
            return range > 0 ? (val - mins[j]) / range : 0;
        })
    );

    return { normalized, mins, maxs };
}

function euclidean(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const d = a[i] - b[i];
        sum += d * d;
    }
    return Math.sqrt(sum);
}

function seededRandom(seed) {
    let s = seed | 0;
    return function() {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function kMeansPPInit(data, k, seed = null) {
    let rng = seed !== null ? seededRandom(seed) : Math.random;
    const n = data.length;
    const centroids = [];

    centroids.push([...data[Math.floor(rng() * n)]]);

    for (let c = 1; c < k; c++) {
        const dists = new Array(n);
        let totalDist = 0;

        for (let i = 0; i < n; i++) {
            let minDist = Infinity;
            for (let j = 0; j < centroids.length; j++) {
                const d = euclidean(data[i], centroids[j]);
                if (d < minDist) minDist = d;
            }
            dists[i] = minDist * minDist;
            totalDist += dists[i];
        }

        let r = rng() * totalDist;
        for (let i = 0; i < n; i++) {
            r -= dists[i];
            if (r <= 0) {
                centroids.push([...data[i]]);
                break;
            }
        }

        if (centroids.length <= c) {
            centroids.push([...data[n - 1]]);
        }
    }

    return centroids;
}

function kMeans(data, k, maxIter = 100, seed = null) {
    const n = data.length;
    const dims = data[0].length;

    if (k >= n) {
        return {
            assignments: data.map((_, i) => i),
            centroids: data.map(row => [...row]),
            iterations: 0,
            inertia: 0
        };
    }

    const centroids = kMeansPPInit(data, k, seed);
    const assignments = new Array(n).fill(0);
    let iterations = 0;

    for (let iter = 0; iter < maxIter; iter++) {
        iterations = iter + 1;
        let changed = false;

        for (let i = 0; i < n; i++) {
            let minDist = Infinity;
            let bestCluster = 0;
            for (let c = 0; c < k; c++) {
                const d = euclidean(data[i], centroids[c]);
                if (d < minDist) {
                    minDist = d;
                    bestCluster = c;
                }
            }
            if (assignments[i] !== bestCluster) {
                assignments[i] = bestCluster;
                changed = true;
            }
        }

        if (!changed) break;

        const counts = new Array(k).fill(0);
        const sums = Array.from({ length: k }, () => new Array(dims).fill(0));

        for (let i = 0; i < n; i++) {
            const c = assignments[i];
            counts[c]++;
            for (let d = 0; d < dims; d++) {
                sums[c][d] += data[i][d];
            }
        }

        for (let c = 0; c < k; c++) {
            if (counts[c] > 0) {
                for (let d = 0; d < dims; d++) {
                    centroids[c][d] = sums[c][d] / counts[c];
                }
            }
        }
    }

    let inertia = 0;
    for (let i = 0; i < n; i++) {
        const d = euclidean(data[i], centroids[assignments[i]]);
        inertia += d * d;
    }

    return { assignments, centroids, iterations, inertia };
}

function computeClusterProfiles(prints, assignments, k, metricKeys) {
    const clusters = Array.from({ length: k }, () => []);
    for (let i = 0; i < prints.length; i++) {
        clusters[assignments[i]].push(prints[i]);
    }

    return clusters.map((members, idx) => {
        const profile = { clusterId: idx, size: members.length, metrics: {} };

        for (const key of metricKeys) {
            const values = members.map(p => getMetricValue(p, key)).filter(v => v !== null);
            if (values.length === 0) {
                profile.metrics[key] = { mean: 0, std: 0, min: 0, max: 0 };
                continue;
            }
            const mean = values.reduce((s, v) => s + v, 0) / values.length;
            const std = values.length > 1
                ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1))
                : 0;
            profile.metrics[key] = {
                mean: Math.round(mean * 100) / 100,
                std: Math.round(std * 100) / 100,
                min: Math.min(...values),
                max: Math.max(...values),
            };
        }

        return profile;
    });
}

function silhouetteCoefficients(data, assignments, k) {
    const n = data.length;
    const silhouettes = new Array(n).fill(0);

    if (k <= 1 || n <= 1) return { scores: silhouettes, average: 0 };

    for (let i = 0; i < n; i++) {
        const myCluster = assignments[i];

        let aSum = 0, aCount = 0;
        const bSums = new Array(k).fill(0);
        const bCounts = new Array(k).fill(0);

        for (let j = 0; j < n; j++) {
            if (i === j) continue;
            const d = euclidean(data[i], data[j]);
            if (assignments[j] === myCluster) {
                aSum += d;
                aCount++;
            } else {
                bSums[assignments[j]] += d;
                bCounts[assignments[j]]++;
            }
        }

        const a = aCount > 0 ? aSum / aCount : 0;
        let b = Infinity;
        for (let c = 0; c < k; c++) {
            if (c !== myCluster && bCounts[c] > 0) {
                const avg = bSums[c] / bCounts[c];
                if (avg < b) b = avg;
            }
        }
        if (b === Infinity) b = 0;

        const maxAB = Math.max(a, b);
        silhouettes[i] = maxAB > 0 ? (b - a) / maxAB : 0;
    }

    const average = silhouettes.reduce((s, v) => s + v, 0) / n;
    return { scores: silhouettes, average };
}

function findOptimalK(data, maxK = 8, seed = 42) {
    const results = [];
    for (let k = 2; k <= Math.min(maxK, data.length); k++) {
        const { assignments, centroids, iterations, inertia } = kMeans(data, k, 100, seed);
        const sil = silhouetteCoefficients(data, assignments, k);
        results.push({ k, inertia, silhouette: sil.average, iterations });
    }
    return results;
}

function formatNum(n) {
    if (n == null) return '-';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(2);
}

// ── Tests ──────────────────────────────────────────────

describe('normalizeMatrix', () => {
    test('normalizes to [0,1] range', () => {
        const matrix = [[1, 10], [3, 20], [5, 30]];
        const { normalized } = normalizeMatrix(matrix);
        normalized.forEach(row => row.forEach(v => {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }));
    });

    test('handles single-row matrix', () => {
        const matrix = [[5, 10, 15]];
        const { normalized } = normalizeMatrix(matrix);
        expect(normalized).toEqual([[0, 0, 0]]);
    });

    test('handles uniform column (all same value → 0)', () => {
        const matrix = [[3, 1], [3, 2], [3, 3]];
        const { normalized } = normalizeMatrix(matrix);
        normalized.forEach(row => expect(row[0]).toBe(0));
    });

    test('empty matrix returns empty', () => {
        const result = normalizeMatrix([]);
        expect(result.normalized).toEqual([]);
        expect(result.mins).toEqual([]);
        expect(result.maxs).toEqual([]);
    });

    test('returns correct mins and maxs', () => {
        const matrix = [[1, 100], [5, 200], [3, 150]];
        const { mins, maxs } = normalizeMatrix(matrix);
        expect(mins).toEqual([1, 100]);
        expect(maxs).toEqual([5, 200]);
    });

    test('preserves row count and column count', () => {
        const matrix = [[1, 2, 3], [4, 5, 6]];
        const { normalized } = normalizeMatrix(matrix);
        expect(normalized.length).toBe(2);
        expect(normalized[0].length).toBe(3);
    });

    test('min maps to 0, max maps to 1', () => {
        const matrix = [[0, 100], [50, 200], [100, 300]];
        const { normalized } = normalizeMatrix(matrix);
        expect(normalized[0][0]).toBe(0);
        expect(normalized[2][0]).toBe(1);
        expect(normalized[0][1]).toBe(0);
        expect(normalized[2][1]).toBe(1);
    });

    test('mid values are proportional', () => {
        const matrix = [[0], [50], [100]];
        const { normalized } = normalizeMatrix(matrix);
        expect(normalized[1][0]).toBeCloseTo(0.5, 5);
    });
});

describe('euclidean', () => {
    test('zero distance for same point', () => {
        expect(euclidean([1, 2, 3], [1, 2, 3])).toBe(0);
    });

    test('known distance (3-4-5)', () => {
        expect(euclidean([0, 0], [3, 4])).toBe(5);
    });

    test('symmetric', () => {
        const a = [1, 2, 3];
        const b = [4, 5, 6];
        expect(euclidean(a, b)).toBe(euclidean(b, a));
    });

    test('1D case', () => {
        expect(euclidean([3], [7])).toBe(4);
    });

    test('higher dimensions', () => {
        const a = [1, 0, 0, 0, 0];
        const b = [0, 0, 0, 0, 0];
        expect(euclidean(a, b)).toBe(1);
    });

    test('negative coordinates', () => {
        expect(euclidean([-1, -1], [2, 3])).toBe(5);
    });
});

describe('seededRandom', () => {
    test('produces deterministic sequence', () => {
        const rng1 = seededRandom(42);
        const rng2 = seededRandom(42);
        const seq1 = Array.from({ length: 10 }, () => rng1());
        const seq2 = Array.from({ length: 10 }, () => rng2());
        expect(seq1).toEqual(seq2);
    });

    test('values in [0,1)', () => {
        const rng = seededRandom(123);
        for (let i = 0; i < 1000; i++) {
            const v = rng();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    test('different seeds give different sequences', () => {
        const rng1 = seededRandom(42);
        const rng2 = seededRandom(99);
        const v1 = rng1();
        const v2 = rng2();
        expect(v1).not.toBe(v2);
    });
});

describe('kMeansPPInit', () => {
    const data = [[0, 0], [1, 1], [2, 2], [10, 10], [11, 11], [12, 12]];

    test('returns k centroids', () => {
        const centroids = kMeansPPInit(data, 3, 42);
        expect(centroids.length).toBe(3);
    });

    test('centroids are valid data points', () => {
        const centroids = kMeansPPInit(data, 2, 42);
        centroids.forEach(c => {
            const match = data.some(d => d[0] === c[0] && d[1] === c[1]);
            expect(match).toBe(true);
        });
    });

    test('deterministic with seed', () => {
        const c1 = kMeansPPInit(data, 3, 42);
        const c2 = kMeansPPInit(data, 3, 42);
        expect(c1).toEqual(c2);
    });

    test('handles k=1', () => {
        const centroids = kMeansPPInit(data, 1, 42);
        expect(centroids.length).toBe(1);
    });

    test('each centroid has correct dimensions', () => {
        const centroids = kMeansPPInit(data, 3, 42);
        centroids.forEach(c => expect(c.length).toBe(2));
    });
});

describe('kMeans', () => {
    test('assigns all points to clusters', () => {
        const data = [[0, 0], [1, 1], [10, 10], [11, 11]];
        const { assignments } = kMeans(data, 2, 100, 42);
        expect(assignments.length).toBe(4);
        assignments.forEach(a => {
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThan(2);
        });
    });

    test('k clusters exist in assignments', () => {
        const data = [[0, 0], [0.1, 0.1], [10, 10], [10.1, 10.1], [20, 20], [20.1, 20.1]];
        const { assignments } = kMeans(data, 3, 100, 42);
        const unique = new Set(assignments);
        expect(unique.size).toBe(3);
    });

    test('converges (iterations < maxIter for simple data)', () => {
        const data = [[0, 0], [1, 0], [10, 0], [11, 0]];
        const { iterations } = kMeans(data, 2, 100, 42);
        expect(iterations).toBeLessThan(100);
    });

    test('inertia is non-negative', () => {
        const data = [[0, 0], [1, 1], [2, 2], [10, 10]];
        const { inertia } = kMeans(data, 2, 100, 42);
        expect(inertia).toBeGreaterThanOrEqual(0);
    });

    test('well-separated clusters get correct assignments', () => {
        const data = [[0, 0], [0.1, 0], [0, 0.1], [100, 100], [100.1, 100], [100, 100.1]];
        const { assignments } = kMeans(data, 2, 100, 42);
        // First three should be in same cluster, last three in another
        expect(assignments[0]).toBe(assignments[1]);
        expect(assignments[1]).toBe(assignments[2]);
        expect(assignments[3]).toBe(assignments[4]);
        expect(assignments[4]).toBe(assignments[5]);
        expect(assignments[0]).not.toBe(assignments[3]);
    });

    test('deterministic with seed', () => {
        const data = [[0, 0], [1, 1], [5, 5], [6, 6], [10, 10]];
        const r1 = kMeans(data, 2, 100, 42);
        const r2 = kMeans(data, 2, 100, 42);
        expect(r1.assignments).toEqual(r2.assignments);
        expect(r1.inertia).toBe(r2.inertia);
    });

    test('handles k >= n (each point is own cluster)', () => {
        const data = [[0, 0], [1, 1], [2, 2]];
        const { assignments, inertia, iterations } = kMeans(data, 5, 100, 42);
        expect(assignments).toEqual([0, 1, 2]);
        expect(inertia).toBe(0);
        expect(iterations).toBe(0);
    });

    test('handles k=1 (all in one cluster)', () => {
        const data = [[0, 0], [1, 1], [2, 2]];
        const { assignments } = kMeans(data, 1, 100, 42);
        assignments.forEach(a => expect(a).toBe(0));
    });

    test('single dimension data', () => {
        const data = [[0], [1], [10], [11]];
        const { assignments } = kMeans(data, 2, 100, 42);
        expect(assignments[0]).toBe(assignments[1]);
        expect(assignments[2]).toBe(assignments[3]);
        expect(assignments[0]).not.toBe(assignments[2]);
    });

    test('returns correct number of centroids', () => {
        const data = [[0, 0], [1, 1], [5, 5], [6, 6]];
        const { centroids } = kMeans(data, 2, 100, 42);
        expect(centroids.length).toBe(2);
    });

    test('centroids have correct dimensions', () => {
        const data = [[0, 0, 0], [1, 1, 1], [5, 5, 5]];
        const { centroids } = kMeans(data, 2, 100, 42);
        centroids.forEach(c => expect(c.length).toBe(3));
    });
});

describe('computeClusterProfiles', () => {
    const prints = sampleData;

    test('returns one profile per cluster', () => {
        const assignments = [0, 0, 1, 1, 0, 1];
        const profiles = computeClusterProfiles(prints, assignments, 2, METRICS);
        expect(profiles.length).toBe(2);
    });

    test('each profile has correct size', () => {
        const assignments = [0, 0, 0, 1, 1, 1];
        const profiles = computeClusterProfiles(prints, assignments, 2, METRICS);
        expect(profiles[0].size).toBe(3);
        expect(profiles[1].size).toBe(3);
    });

    test('metric means are reasonable', () => {
        const assignments = [0, 0, 0, 0, 0, 0];
        const profiles = computeClusterProfiles(prints, assignments, 1, ['livePercent']);
        const mean = profiles[0].metrics.livePercent.mean;
        expect(mean).toBeGreaterThan(0);
        expect(mean).toBeLessThan(100);
    });

    test('handles empty cluster defensively', () => {
        const assignments = [0, 0, 0, 0, 0, 0];
        const profiles = computeClusterProfiles(prints, assignments, 2, METRICS);
        expect(profiles[1].size).toBe(0);
        // Empty cluster should still have metric entries
        METRICS.forEach(m => {
            expect(profiles[1].metrics[m]).toBeDefined();
            expect(profiles[1].metrics[m].mean).toBe(0);
        });
    });

    test('all metricKeys present in each profile', () => {
        const assignments = [0, 1, 0, 1, 0, 1];
        const profiles = computeClusterProfiles(prints, assignments, 2, METRICS);
        profiles.forEach(p => {
            METRICS.forEach(m => {
                expect(p.metrics[m]).toBeDefined();
                expect(p.metrics[m]).toHaveProperty('mean');
                expect(p.metrics[m]).toHaveProperty('std');
                expect(p.metrics[m]).toHaveProperty('min');
                expect(p.metrics[m]).toHaveProperty('max');
            });
        });
    });

    test('profile has clusterId', () => {
        const assignments = [0, 0, 1, 1, 0, 1];
        const profiles = computeClusterProfiles(prints, assignments, 2, METRICS);
        expect(profiles[0].clusterId).toBe(0);
        expect(profiles[1].clusterId).toBe(1);
    });

    test('std is 0 for single-member cluster', () => {
        const assignments = [0, 1, 1, 1, 1, 1];
        const profiles = computeClusterProfiles(prints, assignments, 2, ['livePercent']);
        expect(profiles[0].metrics.livePercent.std).toBe(0);
    });

    test('min equals max for single-member cluster', () => {
        const assignments = [0, 1, 1, 1, 1, 1];
        const profiles = computeClusterProfiles(prints, assignments, 2, ['livePercent']);
        expect(profiles[0].metrics.livePercent.min).toBe(profiles[0].metrics.livePercent.max);
    });
});

describe('silhouetteCoefficients', () => {
    test('returns scores array of correct length', () => {
        const data = [[0, 0], [1, 0], [10, 0], [11, 0]];
        const assignments = [0, 0, 1, 1];
        const { scores } = silhouetteCoefficients(data, assignments, 2);
        expect(scores.length).toBe(4);
    });

    test('average is in [-1, 1]', () => {
        const data = [[0, 0], [1, 0], [10, 0], [11, 0]];
        const assignments = [0, 0, 1, 1];
        const { average } = silhouetteCoefficients(data, assignments, 2);
        expect(average).toBeGreaterThanOrEqual(-1);
        expect(average).toBeLessThanOrEqual(1);
    });

    test('well-separated data → high silhouette', () => {
        const data = [[0, 0], [0.1, 0], [0, 0.1], [100, 100], [100.1, 100], [100, 100.1]];
        const assignments = [0, 0, 0, 1, 1, 1];
        const { average } = silhouetteCoefficients(data, assignments, 2);
        expect(average).toBeGreaterThan(0.9);
    });

    test('single cluster → all zeros', () => {
        const data = [[0, 0], [1, 1], [2, 2]];
        const assignments = [0, 0, 0];
        const { scores, average } = silhouetteCoefficients(data, assignments, 1);
        scores.forEach(s => expect(s).toBe(0));
        expect(average).toBe(0);
    });

    test('single point → zero', () => {
        const data = [[5, 5]];
        const assignments = [0];
        const { scores, average } = silhouetteCoefficients(data, assignments, 1);
        expect(scores[0]).toBe(0);
        expect(average).toBe(0);
    });

    test('each score is in [-1, 1]', () => {
        const data = [[0], [1], [5], [6], [10], [11]];
        const assignments = [0, 0, 1, 1, 2, 2];
        const { scores } = silhouetteCoefficients(data, assignments, 3);
        scores.forEach(s => {
            expect(s).toBeGreaterThanOrEqual(-1);
            expect(s).toBeLessThanOrEqual(1);
        });
    });

    test('badly clustered data → lower silhouette', () => {
        // Interleave clusters — bad assignment
        const data = [[0], [1], [2], [3], [4], [5]];
        const assignments = [0, 1, 0, 1, 0, 1];
        const { average } = silhouetteCoefficients(data, assignments, 2);
        expect(average).toBeLessThan(0.5);
    });
});

describe('findOptimalK', () => {
    const data = [[0, 0], [0.1, 0.1], [5, 5], [5.1, 5.1], [10, 10], [10.1, 10.1], [15, 15], [15.1, 15.1], [20, 20], [20.1, 20.1]];

    test('returns results for each k from 2 to maxK', () => {
        const results = findOptimalK(data, 5, 42);
        expect(results.length).toBe(4); // k = 2, 3, 4, 5
        expect(results[0].k).toBe(2);
        expect(results[3].k).toBe(5);
    });

    test('inertia decreases as k increases', () => {
        const results = findOptimalK(data, 5, 42);
        for (let i = 1; i < results.length; i++) {
            expect(results[i].inertia).toBeLessThanOrEqual(results[i - 1].inertia);
        }
    });

    test('silhouette values are in [-1, 1]', () => {
        const results = findOptimalK(data, 5, 42);
        results.forEach(r => {
            expect(r.silhouette).toBeGreaterThanOrEqual(-1);
            expect(r.silhouette).toBeLessThanOrEqual(1);
        });
    });

    test('each result has k, inertia, silhouette, iterations', () => {
        const results = findOptimalK(data, 4, 42);
        results.forEach(r => {
            expect(r).toHaveProperty('k');
            expect(r).toHaveProperty('inertia');
            expect(r).toHaveProperty('silhouette');
            expect(r).toHaveProperty('iterations');
        });
    });

    test('maxK larger than data length is clamped', () => {
        const smallData = [[0, 0], [1, 1], [2, 2]];
        const results = findOptimalK(smallData, 10, 42);
        expect(results.length).toBe(2); // k = 2, 3
    });

    test('results are deterministic with same seed', () => {
        const r1 = findOptimalK(data, 5, 42);
        const r2 = findOptimalK(data, 5, 42);
        expect(r1).toEqual(r2);
    });
});

describe('Integration / rendering', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="clusterCards"></div>
            <div id="totalPrints">-</div>
            <div id="clusterCount">-</div>
            <div id="silhouetteScore">-</div>
            <div id="iterations">-</div>
            <div id="qualityScore">-</div>
            <div id="qualityDesc">-</div>
            <canvas id="radarChart" width="500" height="500"></canvas>
            <canvas id="scatterChart" width="500" height="400"></canvas>
            <table id="profilesTable">
                <thead id="profilesHead"></thead>
                <tbody id="profilesBody"></tbody>
            </table>
        `;
    });

    test('page loads without errors (DOM setup)', () => {
        expect(document.getElementById('clusterCards')).not.toBeNull();
        expect(document.getElementById('radarChart')).not.toBeNull();
        expect(document.getElementById('scatterChart')).not.toBeNull();
    });

    test('cluster cards created for each cluster', () => {
        const matrix = sampleData.map(p =>
            METRICS.map(m => { const v = getMetricValue(p, m); return v !== null ? v : 0; })
        );
        const { normalized } = normalizeMatrix(matrix);
        const { assignments } = kMeans(normalized, 3, 100, 42);
        const profiles = computeClusterProfiles(sampleData, assignments, 3, METRICS);

        const container = document.getElementById('clusterCards');
        profiles.forEach((prof, i) => {
            const card = document.createElement('div');
            card.className = 'cluster-card';
            card.textContent = `Cluster ${i + 1}: ${prof.size} prints`;
            container.appendChild(card);
        });

        const cards = container.querySelectorAll('.cluster-card');
        expect(cards.length).toBe(3);
    });

    test('profiles table has rows for each cluster', () => {
        const assignments = [0, 0, 1, 1, 2, 2];
        const profiles = computeClusterProfiles(sampleData, assignments, 3, METRICS);

        const body = document.getElementById('profilesBody');
        profiles.forEach((prof, i) => {
            const row = document.createElement('tr');
            row.innerHTML = `<td>Cluster ${i + 1}</td><td>${prof.size}</td>`;
            body.appendChild(row);
        });

        expect(body.querySelectorAll('tr').length).toBe(3);
    });

    test('total sizes across clusters sum to data length', () => {
        const matrix = sampleData.map(p =>
            METRICS.map(m => { const v = getMetricValue(p, m); return v !== null ? v : 0; })
        );
        const { normalized } = normalizeMatrix(matrix);
        const { assignments } = kMeans(normalized, 2, 100, 42);
        const profiles = computeClusterProfiles(sampleData, assignments, 2, METRICS);
        const totalSize = profiles.reduce((s, p) => s + p.size, 0);
        expect(totalSize).toBe(sampleData.length);
    });
});

describe('getMetricValue', () => {
    test('extracts livePercent', () => {
        expect(getMetricValue(sampleData[0], 'livePercent')).toBe(7.02);
    });

    test('extracts nested crosslinking metric', () => {
        expect(getMetricValue(sampleData[0], 'cl_duration')).toBe(22793);
    });

    test('returns null for unknown metric', () => {
        expect(getMetricValue(sampleData[0], 'nonexistent')).toBeNull();
    });

    test('returns null for broken record', () => {
        expect(getMetricValue({}, 'livePercent')).toBeNull();
    });
});

describe('edge cases', () => {
    test('kMeans with 2 identical points and k=2', () => {
        const data = [[1, 1], [1, 1]];
        const { assignments, inertia } = kMeans(data, 2, 100, 42);
        expect(assignments).toEqual([0, 1]);
        expect(inertia).toBe(0);
    });

    test('normalizeMatrix with negative values', () => {
        const matrix = [[-10, -5], [0, 0], [10, 5]];
        const { normalized, mins, maxs } = normalizeMatrix(matrix);
        expect(mins).toEqual([-10, -5]);
        expect(maxs).toEqual([10, 5]);
        expect(normalized[0]).toEqual([0, 0]);
        expect(normalized[2]).toEqual([1, 1]);
    });

    test('silhouette with all points in same location', () => {
        const data = [[5, 5], [5, 5], [5, 5], [5, 5]];
        const assignments = [0, 0, 1, 1];
        const { scores, average } = silhouetteCoefficients(data, assignments, 2);
        // All distances are 0, so silhouettes should be 0
        scores.forEach(s => expect(s).toBe(0));
        expect(average).toBe(0);
    });

    test('formatNum handles null', () => {
        expect(formatNum(null)).toBe('-');
    });

    test('formatNum handles integers', () => {
        expect(formatNum(42)).toBe('42');
    });

    test('formatNum handles large numbers', () => {
        const result = formatNum(12345);
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
    });

    test('formatNum handles decimals', () => {
        expect(formatNum(3.14159)).toBe('3.14');
    });
});
