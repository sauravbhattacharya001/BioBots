/**
 * Tests for the Batch Statistics API computations.
 *
 * Tests the statistical functions (descriptive stats, percentiles,
 * histograms, correlations, skewness) that power the batch API endpoints:
 *   GET /api/prints/stats
 *   GET /api/prints/stats/{metric}
 *   GET /api/prints/correlations
 *
 * Since the backend is C#/ASP.NET, these tests validate the equivalent
 * JavaScript implementations used by the dashboard pages to verify
 * correctness of the statistical algorithms.
 */

'use strict';

// ── Statistical Functions (mirroring C# backend logic) ──────────────

/**
 * Compute the percentile using linear interpolation (same as C# Percentile()).
 */
function percentile(sorted, p) {
    if (sorted.length === 1) return sorted[0];
    const rank = p * (sorted.length - 1);
    const lower = Math.floor(rank);
    const upper = lower + 1;
    if (upper >= sorted.length) return sorted[sorted.length - 1];
    const frac = rank - lower;
    return sorted[lower] + frac * (sorted[upper] - sorted[lower]);
}

/**
 * Compute adjusted Fisher-Pearson skewness coefficient.
 */
function computeSkewness(sorted, mean, std) {
    const n = sorted.length;
    if (n < 3 || std < 1e-15) return 0;
    let sumCubedDev = 0;
    for (let i = 0; i < n; i++) {
        const d = (sorted[i] - mean) / std;
        sumCubedDev += d * d * d;
    }
    const adjustment = n / ((n - 1) * (n - 2));
    return Math.round(adjustment * sumCubedDev * 10000) / 10000;
}

/**
 * Compute descriptive statistics for a sorted array.
 */
function computeStats(sorted, isInteger) {
    const n = sorted.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sorted[i];
    const mean = sum / n;

    let sumSqDev = 0;
    for (let i = 0; i < n; i++) {
        const d = sorted[i] - mean;
        sumSqDev += d * d;
    }
    const std = n > 1 ? Math.sqrt(sumSqDev / (n - 1)) : 0;

    const median = percentile(sorted, 0.5);
    const q1 = percentile(sorted, 0.25);
    const q3 = percentile(sorted, 0.75);

    return {
        count: n,
        mean: Math.round(mean * 10000) / 10000,
        std: Math.round(std * 10000) / 10000,
        min: isInteger ? Math.floor(sorted[0]) : Math.round(sorted[0] * 10000) / 10000,
        max: isInteger ? Math.floor(sorted[n - 1]) : Math.round(sorted[n - 1] * 10000) / 10000,
        median: Math.round(median * 10000) / 10000,
        q1: Math.round(q1 * 10000) / 10000,
        q3: Math.round(q3 * 10000) / 10000,
        iqr: Math.round((q3 - q1) * 10000) / 10000,
        coefficientOfVariation: mean !== 0 ? Math.round(std / Math.abs(mean) * 100 * 100) / 100 : 0,
        skewness: computeSkewness(sorted, mean, std),
    };
}

/**
 * Compute equal-width histogram bins.
 */
function computeHistogram(sorted, binCount) {
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;

    if (range < 1e-15) {
        return [{ binStart: min, binEnd: max, count: sorted.length }];
    }

    const binWidth = range / binCount;
    const bins = [];
    let idx = 0;

    for (let b = 0; b < binCount; b++) {
        const binStart = min + b * binWidth;
        const binEnd = (b === binCount - 1) ? max + 1e-10 : min + (b + 1) * binWidth;
        let count = 0;

        while (idx < sorted.length && sorted[idx] < binEnd) {
            count++;
            idx++;
        }

        if (b === binCount - 1) {
            while (idx < sorted.length) {
                count++;
                idx++;
            }
        }

        bins.push({
            binStart: Math.round((min + b * binWidth) * 10000) / 10000,
            binEnd: Math.round((b === binCount - 1 ? max : min + (b + 1) * binWidth) * 10000) / 10000,
            count,
        });
    }
    return bins;
}

/**
 * Compute Pearson correlation coefficient.
 */
function pearsonCorrelation(x, meanX, y, meanY) {
    const n = x.length;
    let sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - meanX;
        const dy = y[i] - meanY;
        sumXY += dx * dy;
        sumX2 += dx * dx;
        sumY2 += dy * dy;
    }
    const denom = Math.sqrt(sumX2 * sumY2);
    return denom < 1e-15 ? 0 : Math.round(sumXY / denom * 10000) / 10000;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Percentile', () => {
    test('returns single value for single-element array', () => {
        expect(percentile([42], 0.5)).toBe(42);
        expect(percentile([42], 0.0)).toBe(42);
        expect(percentile([42], 1.0)).toBe(42);
    });

    test('computes median of even-length array', () => {
        expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    });

    test('computes median of odd-length array', () => {
        expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    });

    test('computes P25 (Q1)', () => {
        expect(percentile([1, 2, 3, 4, 5, 6, 7, 8], 0.25)).toBeCloseTo(2.75, 4);
    });

    test('computes P75 (Q3)', () => {
        expect(percentile([1, 2, 3, 4, 5, 6, 7, 8], 0.75)).toBeCloseTo(6.25, 4);
    });

    test('P0 returns minimum', () => {
        expect(percentile([10, 20, 30], 0.0)).toBe(10);
    });

    test('P100 returns maximum', () => {
        expect(percentile([10, 20, 30], 1.0)).toBe(30);
    });

    test('interpolates between values', () => {
        // rank = 0.1 * 3 = 0.3, lower=0, upper=1, frac=0.3
        // result = 10 + 0.3 * (20 - 10) = 13
        expect(percentile([10, 20, 30, 40], 0.1)).toBeCloseTo(13, 4);
    });

    test('P95 on 20 values', () => {
        const sorted = Array.from({ length: 20 }, (_, i) => i + 1);
        // rank = 0.95 * 19 = 18.05
        // lower = 18 (val=19), upper = 19 (val=20), frac = 0.05
        // result = 19 + 0.05 * 1 = 19.05
        expect(percentile(sorted, 0.95)).toBeCloseTo(19.05, 4);
    });
});

describe('Compute Skewness', () => {
    test('returns 0 for fewer than 3 values', () => {
        expect(computeSkewness([1, 2], 1.5, 0.707)).toBe(0);
    });

    test('returns 0 for zero standard deviation', () => {
        expect(computeSkewness([5, 5, 5], 5, 0)).toBe(0);
    });

    test('symmetric distribution has near-zero skewness', () => {
        const sorted = [1, 2, 3, 4, 5];
        const mean = 3;
        const std = Math.sqrt(10 / 4); // sample std
        const skew = computeSkewness(sorted, mean, std);
        expect(Math.abs(skew)).toBeLessThan(0.01);
    });

    test('right-skewed distribution has positive skewness', () => {
        const sorted = [1, 1, 1, 2, 2, 3, 10].sort((a, b) => a - b);
        const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
        const std = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (sorted.length - 1));
        const skew = computeSkewness(sorted, mean, std);
        expect(skew).toBeGreaterThan(0);
    });

    test('left-skewed distribution has negative skewness', () => {
        const sorted = [1, 8, 9, 9, 10, 10, 10].sort((a, b) => a - b);
        const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
        const std = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (sorted.length - 1));
        const skew = computeSkewness(sorted, mean, std);
        expect(skew).toBeLessThan(0);
    });
});

describe('Descriptive Statistics', () => {
    test('basic stats for simple array', () => {
        const sorted = [1, 2, 3, 4, 5];
        const s = computeStats(sorted, false);
        expect(s.count).toBe(5);
        expect(s.mean).toBe(3);
        expect(s.min).toBe(1);
        expect(s.max).toBe(5);
        expect(s.median).toBe(3);
    });

    test('sample standard deviation (n-1)', () => {
        const sorted = [10, 20, 30, 40, 50];
        const s = computeStats(sorted, false);
        // population std would be sqrt(200), sample std = sqrt(250)
        expect(s.std).toBeCloseTo(Math.sqrt(250), 2);
    });

    test('std is 0 for single value', () => {
        const s = computeStats([42], false);
        expect(s.std).toBe(0);
        expect(s.mean).toBe(42);
    });

    test('integer min/max are truncated', () => {
        const sorted = [1.5, 2.5, 3.5, 4.5, 5.5];
        const s = computeStats(sorted, true);
        expect(s.min).toBe(1);
        expect(s.max).toBe(5);
    });

    test('float min/max are rounded', () => {
        const sorted = [1.23456, 2.34567, 3.45678];
        const s = computeStats(sorted, false);
        expect(s.min).toBe(1.2346);
        expect(s.max).toBe(3.4568);
    });

    test('IQR computation', () => {
        const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const s = computeStats(sorted, false);
        expect(s.q1).toBeCloseTo(3.25, 2);
        expect(s.q3).toBeCloseTo(7.75, 2);
        expect(s.iqr).toBeCloseTo(4.5, 2);
    });

    test('coefficient of variation', () => {
        const sorted = [10, 20, 30, 40, 50];
        const s = computeStats(sorted, false);
        // CV = std / mean * 100 = sqrt(250) / 30 * 100 ≈ 52.70%
        expect(s.coefficientOfVariation).toBeCloseTo(52.70, 0);
    });

    test('coefficient of variation is 0 when mean is 0', () => {
        const sorted = [-2, -1, 0, 1, 2];
        const s = computeStats(sorted, false);
        expect(s.coefficientOfVariation).toBe(0);
    });

    test('handles identical values', () => {
        const sorted = [5, 5, 5, 5, 5];
        const s = computeStats(sorted, false);
        expect(s.mean).toBe(5);
        expect(s.std).toBe(0);
        expect(s.iqr).toBe(0);
        expect(s.median).toBe(5);
    });

    test('handles two values', () => {
        const sorted = [10, 20];
        const s = computeStats(sorted, false);
        expect(s.mean).toBe(15);
        expect(s.median).toBe(15);
        expect(s.count).toBe(2);
    });

    test('handles large dataset', () => {
        const sorted = Array.from({ length: 1000 }, (_, i) => i);
        const s = computeStats(sorted, false);
        expect(s.mean).toBeCloseTo(499.5, 2);
        expect(s.count).toBe(1000);
        expect(s.min).toBe(0);
        expect(s.max).toBe(999);
    });

    test('handles negative values', () => {
        const sorted = [-10, -5, 0, 5, 10];
        const s = computeStats(sorted, false);
        expect(s.mean).toBe(0);
        expect(s.min).toBe(-10);
        expect(s.max).toBe(10);
    });

    test('skewness is included in output', () => {
        const sorted = [1, 2, 3, 4, 5];
        const s = computeStats(sorted, false);
        expect(s).toHaveProperty('skewness');
        expect(typeof s.skewness).toBe('number');
    });
});

describe('Histogram', () => {
    test('10 bins for range of values', () => {
        const sorted = Array.from({ length: 100 }, (_, i) => i);
        const bins = computeHistogram(sorted, 10);
        expect(bins).toHaveLength(10);
        const totalCount = bins.reduce((s, b) => s + b.count, 0);
        expect(totalCount).toBe(100);
    });

    test('single bin for identical values', () => {
        const sorted = [5, 5, 5, 5, 5];
        const bins = computeHistogram(sorted, 10);
        expect(bins).toHaveLength(1);
        expect(bins[0].count).toBe(5);
    });

    test('bins have correct structure', () => {
        const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const bins = computeHistogram(sorted, 5);
        bins.forEach(bin => {
            expect(bin).toHaveProperty('binStart');
            expect(bin).toHaveProperty('binEnd');
            expect(bin).toHaveProperty('count');
            expect(typeof bin.binStart).toBe('number');
            expect(typeof bin.binEnd).toBe('number');
            expect(typeof bin.count).toBe('number');
            expect(bin.count).toBeGreaterThanOrEqual(0);
        });
    });

    test('bin edges are monotonically increasing', () => {
        const sorted = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
        const bins = computeHistogram(sorted, 5);
        for (let i = 1; i < bins.length; i++) {
            expect(bins[i].binStart).toBeGreaterThanOrEqual(bins[i - 1].binStart);
        }
    });

    test('all values are counted exactly once', () => {
        const sorted = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5];
        const bins = computeHistogram(sorted, 3);
        const total = bins.reduce((s, b) => s + b.count, 0);
        expect(total).toBe(10);
    });

    test('first bin starts at minimum', () => {
        const sorted = [10, 20, 30, 40, 50];
        const bins = computeHistogram(sorted, 4);
        expect(bins[0].binStart).toBe(10);
    });

    test('last bin ends at maximum', () => {
        const sorted = [10, 20, 30, 40, 50];
        const bins = computeHistogram(sorted, 4);
        expect(bins[bins.length - 1].binEnd).toBe(50);
    });

    test('works with 2 values', () => {
        const sorted = [0, 100];
        const bins = computeHistogram(sorted, 10);
        expect(bins).toHaveLength(10);
        const total = bins.reduce((s, b) => s + b.count, 0);
        expect(total).toBe(2);
    });

    test('handles floating point values', () => {
        const sorted = [0.001, 0.002, 0.003, 0.004, 0.005];
        const bins = computeHistogram(sorted, 2);
        const total = bins.reduce((s, b) => s + b.count, 0);
        expect(total).toBe(5);
    });
});

describe('Pearson Correlation', () => {
    test('perfect positive correlation', () => {
        const x = [1, 2, 3, 4, 5];
        const y = [2, 4, 6, 8, 10];
        const meanX = 3, meanY = 6;
        expect(pearsonCorrelation(x, meanX, y, meanY)).toBe(1);
    });

    test('perfect negative correlation', () => {
        const x = [1, 2, 3, 4, 5];
        const y = [10, 8, 6, 4, 2];
        const meanX = 3, meanY = 6;
        expect(pearsonCorrelation(x, meanX, y, meanY)).toBe(-1);
    });

    test('zero correlation for orthogonal data', () => {
        // X and Y are independent
        const x = [1, 0, -1, 0];
        const y = [0, 1, 0, -1];
        const meanX = 0, meanY = 0;
        expect(pearsonCorrelation(x, meanX, y, meanY)).toBe(0);
    });

    test('returns 0 for zero variance in x', () => {
        const x = [5, 5, 5, 5];
        const y = [1, 2, 3, 4];
        expect(pearsonCorrelation(x, 5, y, 2.5)).toBe(0);
    });

    test('returns 0 for zero variance in y', () => {
        const x = [1, 2, 3, 4];
        const y = [5, 5, 5, 5];
        expect(pearsonCorrelation(x, 2.5, y, 5)).toBe(0);
    });

    test('moderate positive correlation', () => {
        const x = [1, 2, 3, 4, 5];
        const y = [2, 3, 5, 4, 6];
        const meanX = 3, meanY = 4;
        const r = pearsonCorrelation(x, meanX, y, meanY);
        expect(r).toBeGreaterThan(0.5);
        expect(r).toBeLessThan(1);
    });

    test('correlation is symmetric', () => {
        const x = [1, 3, 5, 7, 9];
        const y = [2, 8, 4, 10, 6];
        const meanX = 5, meanY = 6;
        const rXY = pearsonCorrelation(x, meanX, y, meanY);
        const rYX = pearsonCorrelation(y, meanY, x, meanX);
        expect(rXY).toBe(rYX);
    });

    test('correlation with itself is 1', () => {
        const x = [1, 3, 5, 7, 9];
        const meanX = 5;
        expect(pearsonCorrelation(x, meanX, x, meanX)).toBe(1);
    });

    test('handles large values without overflow', () => {
        const x = [1e6, 2e6, 3e6, 4e6, 5e6];
        const y = [2e6, 4e6, 6e6, 8e6, 10e6];
        const meanX = 3e6, meanY = 6e6;
        expect(pearsonCorrelation(x, meanX, y, meanY)).toBe(1);
    });

    test('handles negative values', () => {
        const x = [-5, -3, -1, 1, 3, 5];
        const y = [-10, -6, -2, 2, 6, 10];
        const meanX = 0, meanY = 0;
        expect(pearsonCorrelation(x, meanX, y, meanY)).toBe(1);
    });
});

describe('Correlation Matrix Structure', () => {
    test('builds symmetric matrix', () => {
        const metrics = ['a', 'b', 'c'];
        const values = {
            a: [1, 2, 3, 4, 5],
            b: [2, 4, 6, 8, 10],
            c: [5, 4, 3, 2, 1],
        };
        const means = {
            a: 3, b: 6, c: 3,
        };

        const matrix = {};
        for (const keyA of metrics) {
            matrix[keyA] = {};
            for (const keyB of metrics) {
                if (keyA === keyB) {
                    matrix[keyA][keyB] = 1.0;
                } else {
                    matrix[keyA][keyB] = pearsonCorrelation(
                        values[keyA], means[keyA],
                        values[keyB], means[keyB]
                    );
                }
            }
        }

        // Diagonal is 1.0
        for (const key of metrics) {
            expect(matrix[key][key]).toBe(1.0);
        }

        // Symmetric: matrix[a][b] === matrix[b][a]
        expect(matrix.a.b).toBe(matrix.b.a);
        expect(matrix.a.c).toBe(matrix.c.a);
        expect(matrix.b.c).toBe(matrix.c.b);

        // a and b are perfectly correlated
        expect(matrix.a.b).toBe(1);

        // a and c are perfectly inversely correlated
        expect(matrix.a.c).toBe(-1);
    });
});

describe('Edge Cases', () => {
    test('single record stats', () => {
        const s = computeStats([42], false);
        expect(s.count).toBe(1);
        expect(s.mean).toBe(42);
        expect(s.std).toBe(0);
        expect(s.min).toBe(42);
        expect(s.max).toBe(42);
        expect(s.median).toBe(42);
        expect(s.q1).toBe(42);
        expect(s.q3).toBe(42);
        expect(s.iqr).toBe(0);
    });

    test('single record histogram', () => {
        const bins = computeHistogram([42], 10);
        expect(bins).toHaveLength(1);
        expect(bins[0].count).toBe(1);
    });

    test('two records stats', () => {
        const s = computeStats([10, 20], false);
        expect(s.count).toBe(2);
        expect(s.mean).toBe(15);
        expect(s.median).toBe(15);
    });

    test('very small values', () => {
        const sorted = [0.0001, 0.0002, 0.0003];
        const s = computeStats(sorted, false);
        expect(s.mean).toBeCloseTo(0.0002, 4);
    });

    test('very large values', () => {
        const sorted = [1e8, 2e8, 3e8];
        const s = computeStats(sorted, false);
        expect(s.mean).toBe(2e8);
    });

    test('mixed positive and negative', () => {
        const sorted = [-100, -50, 0, 50, 100];
        const s = computeStats(sorted, false);
        expect(s.mean).toBe(0);
        expect(s.min).toBe(-100);
        expect(s.max).toBe(100);
    });

    test('all zeros', () => {
        const sorted = [0, 0, 0, 0, 0];
        const s = computeStats(sorted, false);
        expect(s.mean).toBe(0);
        expect(s.std).toBe(0);
        expect(s.coefficientOfVariation).toBe(0);
    });

    test('histogram with very narrow range', () => {
        const sorted = [1.0000001, 1.0000002, 1.0000003];
        const bins = computeHistogram(sorted, 10);
        const total = bins.reduce((s, b) => s + b.count, 0);
        expect(total).toBe(3);
    });
});
