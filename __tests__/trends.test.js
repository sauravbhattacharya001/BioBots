/**
 * Tests for Trend Analysis (docs/trends.html)
 *
 * Tests the statistical functions, metric analysis, and trend classification
 * used in the trend analysis dashboard.
 */

// ── Statistical Helpers (extracted from trends.html) ──

function mean(arr) {
    if (!arr.length) return 0;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
}

function stdDev(arr, m) {
    if (arr.length < 2) return 0;
    if (m === undefined) m = mean(arr);
    let ss = 0;
    for (let i = 0; i < arr.length; i++) ss += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(ss / (arr.length - 1));
}

function movingAverage(arr, window) {
    if (window <= 0 || window > arr.length) return arr.slice();
    const result = [];
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
        sum += arr[i];
        if (i >= window) sum -= arr[i - window];
        if (i >= window - 1) result.push(sum / window);
        else result.push(null);
    }
    return result;
}

function linearRegression(vals) {
    const n = vals.length;
    if (n < 2) return { slope: 0, intercept: vals[0] || 0, r2: 0 };
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
        sx += i; sy += vals[i];
        sxx += i * i; sxy += i * vals[i]; syy += vals[i] * vals[i];
    }
    const denom = n * sxx - sx * sx;
    if (denom === 0) return { slope: 0, intercept: sy / n, r2: 0 };
    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;
    const ssTot = syy - sy * sy / n;
    const ssRes = syy - intercept * sy - slope * sxy;
    const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
    return { slope, intercept, r2 };
}

function pearsonCorrelation(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;
    const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - mx, dy = y[i] - my;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    return denom === 0 ? 0 : num / denom;
}

// ── Tests ──

describe('Trend Analysis — Statistical Functions', () => {

    // ── mean() ──

    describe('mean()', () => {
        test('returns 0 for empty array', () => {
            expect(mean([])).toBe(0);
        });

        test('single element', () => {
            expect(mean([42])).toBe(42);
        });

        test('multiple elements', () => {
            expect(mean([1, 2, 3, 4, 5])).toBe(3);
        });

        test('decimal values', () => {
            expect(mean([1.5, 2.5])).toBe(2);
        });

        test('negative values', () => {
            expect(mean([-10, 10])).toBe(0);
        });

        test('all same values', () => {
            expect(mean([7, 7, 7, 7])).toBe(7);
        });

        test('large array', () => {
            const arr = Array.from({length: 1000}, (_, i) => i);
            expect(mean(arr)).toBeCloseTo(499.5, 5);
        });
    });

    // ── stdDev() ──

    describe('stdDev()', () => {
        test('returns 0 for single element', () => {
            expect(stdDev([42])).toBe(0);
        });

        test('returns 0 for empty array', () => {
            expect(stdDev([])).toBe(0);
        });

        test('correct for known values', () => {
            // [2, 4, 4, 4, 5, 5, 7, 9] → sample std dev ≈ 2.138
            expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
        });

        test('all same values → 0', () => {
            expect(stdDev([5, 5, 5, 5])).toBe(0);
        });

        test('uses provided mean', () => {
            const arr = [1, 2, 3];
            const m = mean(arr);
            expect(stdDev(arr, m)).toBeCloseTo(stdDev(arr), 10);
        });

        test('two elements', () => {
            // [0, 10] sample std dev = 10/sqrt(1) = ~7.071
            expect(stdDev([0, 10])).toBeCloseTo(7.071, 2);
        });
    });

    // ── movingAverage() ──

    describe('movingAverage()', () => {
        test('window=0 returns copy', () => {
            expect(movingAverage([1, 2, 3], 0)).toEqual([1, 2, 3]);
        });

        test('window > length returns copy', () => {
            expect(movingAverage([1, 2], 5)).toEqual([1, 2]);
        });

        test('window=1 returns same values', () => {
            expect(movingAverage([1, 2, 3], 1)).toEqual([1, 2, 3]);
        });

        test('window=3 correct nulls and values', () => {
            const result = movingAverage([1, 2, 3, 4, 5], 3);
            expect(result[0]).toBeNull();
            expect(result[1]).toBeNull();
            expect(result[2]).toBeCloseTo(2, 5);    // (1+2+3)/3
            expect(result[3]).toBeCloseTo(3, 5);    // (2+3+4)/3
            expect(result[4]).toBeCloseTo(4, 5);    // (3+4+5)/3
        });

        test('window equal to length', () => {
            const result = movingAverage([10, 20, 30], 3);
            expect(result[0]).toBeNull();
            expect(result[1]).toBeNull();
            expect(result[2]).toBeCloseTo(20, 5);
        });

        test('constant values → constant MA', () => {
            const result = movingAverage([5, 5, 5, 5, 5], 3);
            expect(result[2]).toBeCloseTo(5, 5);
            expect(result[3]).toBeCloseTo(5, 5);
            expect(result[4]).toBeCloseTo(5, 5);
        });

        test('respects null leading entries count', () => {
            const result = movingAverage([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
            const nullCount = result.filter(v => v === null).length;
            expect(nullCount).toBe(4); // window - 1
        });
    });

    // ── linearRegression() ──

    describe('linearRegression()', () => {
        test('single value returns zero slope', () => {
            const reg = linearRegression([42]);
            expect(reg.slope).toBe(0);
            expect(reg.intercept).toBe(42);
        });

        test('empty array', () => {
            const reg = linearRegression([]);
            expect(reg.slope).toBe(0);
            expect(reg.intercept).toBe(0);
        });

        test('perfect linear upward', () => {
            const reg = linearRegression([0, 1, 2, 3, 4]);
            expect(reg.slope).toBeCloseTo(1, 5);
            expect(reg.intercept).toBeCloseTo(0, 5);
            expect(reg.r2).toBeCloseTo(1, 5);
        });

        test('perfect linear downward', () => {
            const reg = linearRegression([10, 8, 6, 4, 2]);
            expect(reg.slope).toBeCloseTo(-2, 5);
            expect(reg.intercept).toBeCloseTo(10, 5);
            expect(reg.r2).toBeCloseTo(1, 5);
        });

        test('constant values → zero slope', () => {
            const reg = linearRegression([5, 5, 5, 5]);
            expect(reg.slope).toBe(0);
            expect(reg.r2).toBe(0);
        });

        test('noisy data has low r2', () => {
            const reg = linearRegression([1, 100, 2, 99, 3]);
            expect(reg.r2).toBeLessThan(0.5);
        });

        test('r2 is between 0 and 1', () => {
            const reg = linearRegression([3, 1, 4, 1, 5, 9, 2, 6]);
            expect(reg.r2).toBeGreaterThanOrEqual(0);
            expect(reg.r2).toBeLessThanOrEqual(1);
        });
    });

    // ── pearsonCorrelation() ──

    describe('pearsonCorrelation()', () => {
        test('perfect positive correlation', () => {
            expect(pearsonCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 5);
        });

        test('perfect negative correlation', () => {
            expect(pearsonCorrelation([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 5);
        });

        test('no correlation (orthogonal)', () => {
            // sin and cos over uniform spacing → near-zero
            const x = Array.from({length: 100}, (_, i) => Math.sin(i * 0.1));
            const y = Array.from({length: 100}, (_, i) => Math.cos(i * 0.1));
            expect(Math.abs(pearsonCorrelation(x, y))).toBeLessThan(0.2);
        });

        test('returns 0 for single element', () => {
            expect(pearsonCorrelation([5], [10])).toBe(0);
        });

        test('returns 0 for constant arrays', () => {
            expect(pearsonCorrelation([3, 3, 3], [3, 3, 3])).toBe(0);
        });

        test('handles different lengths (uses min)', () => {
            const r = pearsonCorrelation([1, 2, 3, 4, 5], [10, 20, 30]);
            expect(r).toBeCloseTo(1, 5); // first 3 elements perfectly correlated
        });

        test('range is [-1, 1]', () => {
            const r = pearsonCorrelation([3, 1, 4, 1, 5, 9], [2, 7, 1, 8, 2, 8]);
            expect(r).toBeGreaterThanOrEqual(-1);
            expect(r).toBeLessThanOrEqual(1);
        });
    });
});

// ── Trend Classification Tests ──

describe('Trend Analysis — Metric Analysis', () => {
    // Simplified analyzeMetric for testing
    function analyzeMetricFromValues(vals) {
        if (vals.length === 0) return null;
        const m = mean(vals);
        const sd = stdDev(vals, m);
        const cv = m !== 0 ? (sd / Math.abs(m)) * 100 : 0;
        const reg = linearRegression(vals);
        const recentN = Math.min(10, vals.length);
        const recentAvg = mean(vals.slice(-recentN));
        const changePercent = m !== 0 ? ((recentAvg - m) / Math.abs(m)) * 100 : 0;
        const slopeNorm = vals.length > 1 ? (reg.slope * vals.length) / (m || 1) : 0;
        let trend;
        if (Math.abs(slopeNorm) < 0.02) trend = 'flat';
        else if (slopeNorm > 0) trend = 'up';
        else trend = 'down';
        return { mean: m, stdDev: sd, cv, min: Math.min(...vals), max: Math.max(...vals),
            recentAvg, changePercent, trend, regression: reg, slopeNorm };
    }

    test('upward trend detected', () => {
        const vals = Array.from({length: 50}, (_, i) => 10 + i * 0.5);
        const result = analyzeMetricFromValues(vals);
        expect(result.trend).toBe('up');
        expect(result.regression.slope).toBeGreaterThan(0);
    });

    test('downward trend detected', () => {
        const vals = Array.from({length: 50}, (_, i) => 100 - i * 0.5);
        const result = analyzeMetricFromValues(vals);
        expect(result.trend).toBe('down');
        expect(result.regression.slope).toBeLessThan(0);
    });

    test('flat trend for constant values', () => {
        const vals = Array.from({length: 50}, () => 42);
        const result = analyzeMetricFromValues(vals);
        expect(result.trend).toBe('flat');
    });

    test('flat trend for small fluctuation', () => {
        const vals = Array.from({length: 50}, (_, i) => 100 + Math.sin(i) * 0.01);
        const result = analyzeMetricFromValues(vals);
        expect(result.trend).toBe('flat');
    });

    test('recent average computed from last 10', () => {
        const vals = Array.from({length: 20}, (_, i) => i < 10 ? 0 : 100);
        const result = analyzeMetricFromValues(vals);
        expect(result.recentAvg).toBe(100);
    });

    test('recent average uses all if fewer than 10', () => {
        const vals = [5, 10, 15];
        const result = analyzeMetricFromValues(vals);
        expect(result.recentAvg).toBe(10);
    });

    test('CV is high for volatile data', () => {
        const vals = [1, 100, 1, 100, 1, 100];
        const result = analyzeMetricFromValues(vals);
        expect(result.cv).toBeGreaterThan(50);
    });

    test('CV is 0 for constant data', () => {
        const vals = [50, 50, 50, 50];
        const result = analyzeMetricFromValues(vals);
        expect(result.cv).toBe(0);
    });

    test('min and max correct', () => {
        const vals = [3, 1, 4, 1, 5, 9, 2, 6];
        const result = analyzeMetricFromValues(vals);
        expect(result.min).toBe(1);
        expect(result.max).toBe(9);
    });

    test('empty array returns null', () => {
        expect(analyzeMetricFromValues([])).toBeNull();
    });

    test('change percent positive when recent > overall', () => {
        const vals = Array.from({length: 30}, (_, i) => i < 20 ? 10 : 50);
        const result = analyzeMetricFromValues(vals);
        expect(result.changePercent).toBeGreaterThan(0);
    });

    test('change percent negative when recent < overall', () => {
        const vals = Array.from({length: 30}, (_, i) => i < 20 ? 50 : 10);
        const result = analyzeMetricFromValues(vals);
        expect(result.changePercent).toBeLessThan(0);
    });

    test('regression r2 high for clean trend', () => {
        const vals = Array.from({length: 100}, (_, i) => 5 + i * 2);
        const result = analyzeMetricFromValues(vals);
        expect(result.regression.r2).toBeGreaterThan(0.99);
    });

    test('regression r2 low for random data', () => {
        // Pseudo-random but deterministic
        const vals = [42, 17, 93, 8, 71, 33, 65, 12, 88, 24, 57, 39, 81, 4, 76];
        const result = analyzeMetricFromValues(vals);
        expect(result.regression.r2).toBeLessThan(0.3);
    });
});

// ── Moving Average Edge Cases ──

describe('Trend Analysis — Moving Average Edge Cases', () => {
    test('window=2 for 5 elements', () => {
        const result = movingAverage([10, 20, 30, 40, 50], 2);
        expect(result[0]).toBeNull();
        expect(result[1]).toBeCloseTo(15, 5);  // (10+20)/2
        expect(result[2]).toBeCloseTo(25, 5);  // (20+30)/2
        expect(result[3]).toBeCloseTo(35, 5);
        expect(result[4]).toBeCloseTo(45, 5);
    });

    test('moving average smooths noise', () => {
        const noisy = [10, 100, 10, 100, 10, 100, 10, 100, 10, 100];
        const ma = movingAverage(noisy, 2);
        // Each MA value should be 55 (avg of 10 and 100)
        for (let i = 1; i < ma.length; i++) {
            expect(ma[i]).toBeCloseTo(55, 5);
        }
    });

    test('MA preserves trend direction', () => {
        const upward = Array.from({length: 20}, (_, i) => i * 10 + Math.random() * 2);
        const ma = movingAverage(upward, 5);
        // After warmup, MA values should be increasing
        const validMa = ma.filter(v => v !== null);
        for (let i = 1; i < validMa.length; i++) {
            expect(validMa[i]).toBeGreaterThan(validMa[i - 1] - 5); // roughly increasing
        }
    });
});

// ── Correlation Edge Cases ──

describe('Trend Analysis — Correlation Edge Cases', () => {
    test('identical arrays → r=1', () => {
        const arr = [1, 5, 3, 7, 2];
        expect(pearsonCorrelation(arr, arr)).toBeCloseTo(1, 5);
    });

    test('negated array → r=-1', () => {
        const arr = [1, 5, 3, 7, 2];
        const neg = arr.map(v => -v);
        expect(pearsonCorrelation(arr, neg)).toBeCloseTo(-1, 5);
    });

    test('shifted constant → r=1', () => {
        const x = [1, 2, 3, 4, 5];
        const y = [101, 102, 103, 104, 105];
        expect(pearsonCorrelation(x, y)).toBeCloseTo(1, 5);
    });

    test('large dataset correlation', () => {
        const n = 1000;
        const x = Array.from({length: n}, (_, i) => i);
        const y = Array.from({length: n}, (_, i) => i * 2 + 5);
        expect(pearsonCorrelation(x, y)).toBeCloseTo(1, 5);
    });

    test('weakly correlated data', () => {
        // Sequences with known weak correlation
        const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const y = [5, 3, 8, 2, 7, 4, 9, 1, 6, 10];
        const r = pearsonCorrelation(x, y);
        expect(Math.abs(r)).toBeLessThan(0.6);
    });
});
