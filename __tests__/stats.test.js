'use strict';

var stats = require('../docs/shared/stats');

describe('stats module', function () {

  // ── mean ──────────────────────────────────────────────────────────
  describe('mean()', function () {
    it('returns 0 for an empty array', function () {
      expect(stats.mean([])).toBe(0);
    });

    it('computes mean of a single element', function () {
      expect(stats.mean([7])).toBe(7);
    });

    it('computes mean of positive integers', function () {
      expect(stats.mean([2, 4, 6, 8])).toBe(5);
    });

    it('handles negative numbers', function () {
      expect(stats.mean([-10, 10])).toBe(0);
    });

    it('maintains numerical stability with Kahan summation', function () {
      // Large array of small numbers where naive summation accumulates error
      var arr = [];
      for (var i = 0; i < 10000; i++) arr.push(0.1);
      expect(Math.abs(stats.mean(arr) - 0.1)).toBeLessThan(1e-10);
    });
  });

  // ── median ────────────────────────────────────────────────────────
  describe('median()', function () {
    it('returns 0 for an empty array', function () {
      expect(stats.median([])).toBe(0);
    });

    it('returns the single element', function () {
      expect(stats.median([42])).toBe(42);
    });

    it('returns middle element for odd-length array', function () {
      expect(stats.median([3, 1, 2])).toBe(2);
    });

    it('returns average of middle two for even-length array', function () {
      expect(stats.median([1, 2, 3, 4])).toBe(2.5);
    });

    it('does not mutate the original array', function () {
      var arr = [5, 3, 1, 4, 2];
      stats.median(arr);
      expect(arr).toEqual([5, 3, 1, 4, 2]);
    });
  });

  // ── medianSorted ──────────────────────────────────────────────────
  describe('medianSorted()', function () {
    it('returns 0 for an empty array', function () {
      expect(stats.medianSorted([])).toBe(0);
    });

    it('returns correct median for pre-sorted odd array', function () {
      expect(stats.medianSorted([1, 2, 3, 4, 5])).toBe(3);
    });

    it('returns correct median for pre-sorted even array', function () {
      expect(stats.medianSorted([10, 20, 30, 40])).toBe(25);
    });
  });

  // ── stddev ────────────────────────────────────────────────────────
  describe('stddev()', function () {
    it('returns 0 for arrays with fewer than 2 elements', function () {
      expect(stats.stddev([])).toBe(0);
      expect(stats.stddev([5])).toBe(0);
    });

    it('computes sample stddev (Bessel-corrected)', function () {
      // [2, 4, 4, 4, 5, 5, 7, 9] → mean=5, sample stddev ≈ 2.138
      var result = stats.stddev([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(result).toBeCloseTo(2.138, 2);
    });

    it('uses pre-computed mean when provided', function () {
      var arr = [10, 20, 30];
      var m = stats.mean(arr);
      expect(stats.stddev(arr, m)).toBeCloseTo(stats.stddev(arr), 10);
    });

    it('returns 0 for identical values', function () {
      expect(stats.stddev([5, 5, 5, 5])).toBe(0);
    });
  });

  // ── pstddev ───────────────────────────────────────────────────────
  describe('pstddev()', function () {
    it('returns 0 for arrays with fewer than 2 elements', function () {
      expect(stats.pstddev([])).toBe(0);
      expect(stats.pstddev([3])).toBe(0);
    });

    it('computes population stddev (n denominator)', function () {
      // [2, 4, 4, 4, 5, 5, 7, 9] → mean=5, pop stddev = 2
      var result = stats.pstddev([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(result).toBeCloseTo(2.0, 1);
    });

    it('is smaller than sample stddev for same data', function () {
      var arr = [1, 3, 5, 7, 9];
      expect(stats.pstddev(arr)).toBeLessThan(stats.stddev(arr));
    });
  });

  // ── cv ────────────────────────────────────────────────────────────
  describe('cv()', function () {
    it('returns 0 when mean is zero', function () {
      expect(stats.cv([-1, 1])).toBe(0);
    });

    it('returns 0 for identical values', function () {
      expect(stats.cv([5, 5, 5])).toBe(0);
    });

    it('computes CV as a percentage', function () {
      // stddev/|mean| * 100
      var arr = [10, 12, 14, 8, 16];
      var m = stats.mean(arr);
      var sd = stats.stddev(arr);
      expect(stats.cv(arr)).toBeCloseTo((sd / Math.abs(m)) * 100, 5);
    });
  });

  // ── percentile ────────────────────────────────────────────────────
  describe('percentile()', function () {
    it('returns 0 for an empty array', function () {
      expect(stats.percentile([], 50)).toBe(0);
    });

    it('returns min at p=0', function () {
      expect(stats.percentile([5, 1, 3], 0)).toBe(1);
    });

    it('returns max at p=100', function () {
      expect(stats.percentile([5, 1, 3], 100)).toBe(5);
    });

    it('interpolates between values', function () {
      // [1,2,3,4] p=25 → index=0.75 → 1 + 0.75*(2-1) = 1.75
      expect(stats.percentile([1, 2, 3, 4], 25)).toBeCloseTo(1.75, 5);
    });

    it('returns exact value when index is integer', function () {
      // [10,20,30] p=50 → index=1 → 20
      expect(stats.percentile([10, 20, 30], 50)).toBe(20);
    });
  });

  // ── percentileSorted ──────────────────────────────────────────────
  describe('percentileSorted()', function () {
    it('returns 0 for an empty array', function () {
      expect(stats.percentileSorted([], 50)).toBe(0);
    });

    it('matches percentile for sorted input', function () {
      var arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(stats.percentileSorted(arr, 75)).toBeCloseTo(stats.percentile(arr, 75), 10);
    });
  });

  // ── linearRegression ──────────────────────────────────────────────
  describe('linearRegression()', function () {
    it('finds perfect positive slope', function () {
      var result = stats.linearRegression([1, 2, 3, 4], [2, 4, 6, 8]);
      expect(result.slope).toBeCloseTo(2, 5);
      expect(result.intercept).toBeCloseTo(0, 5);
      expect(result.r2).toBeCloseTo(1, 5);
    });

    it('finds perfect negative slope', function () {
      var result = stats.linearRegression([1, 2, 3], [10, 8, 6]);
      expect(result.slope).toBeCloseTo(-2, 5);
      expect(result.intercept).toBeCloseTo(12, 5);
      expect(result.r2).toBeCloseTo(1, 5);
    });

    it('returns 0 slope for constant x', function () {
      var result = stats.linearRegression([5, 5, 5], [1, 2, 3]);
      expect(result.slope).toBe(0);
    });

    it('handles non-trivial regression with low R²', function () {
      var result = stats.linearRegression([1, 2, 3, 4, 5], [2, 1, 4, 3, 6]);
      expect(result.slope).toBeGreaterThan(0);
      expect(result.r2).toBeLessThan(1);
      expect(result.r2).toBeGreaterThan(0);
    });
  });

  // ── linearRegressionCompat ────────────────────────────────────────
  describe('linearRegressionCompat()', function () {
    it('returns rSquared instead of r2', function () {
      var result = stats.linearRegressionCompat([1, 2, 3], [2, 4, 6]);
      expect(result.rSquared).toBeDefined();
      expect(result.r2).toBeUndefined();
      expect(result.rSquared).toBeCloseTo(1, 5);
      expect(result.slope).toBeCloseTo(2, 5);
    });
  });

  // ── descriptiveStats ──────────────────────────────────────────────
  describe('descriptiveStats()', function () {
    it('returns zeros for empty/null input', function () {
      var result = stats.descriptiveStats([]);
      expect(result).toEqual({ count: 0, mean: 0, stdDev: 0, min: 0, max: 0, cv: 0 });

      var resultNull = stats.descriptiveStats(null);
      expect(resultNull.count).toBe(0);
    });

    it('handles a single element (stdDev=0)', function () {
      var result = stats.descriptiveStats([42]);
      expect(result.count).toBe(1);
      expect(result.mean).toBe(42);
      expect(result.stdDev).toBe(0);
      expect(result.min).toBe(42);
      expect(result.max).toBe(42);
      expect(result.cv).toBe(0);
    });

    it('computes correct stats for a known dataset', function () {
      var result = stats.descriptiveStats([2, 4, 6, 8, 10]);
      expect(result.count).toBe(5);
      expect(result.mean).toBe(6);
      expect(result.min).toBe(2);
      expect(result.max).toBe(10);
      expect(result.stdDev).toBeGreaterThan(0);
      expect(result.cv).toBeGreaterThan(0);
    });

    it('rounds mean and stdDev to 4 decimal places', function () {
      var result = stats.descriptiveStats([1, 2, 3]);
      // mean = 2, stdDev = 1
      expect(result.mean).toBe(2);
      expect(result.stdDev).toBe(1);
    });

    it('handles negative values', function () {
      var result = stats.descriptiveStats([-10, -5, 0, 5, 10]);
      expect(result.mean).toBe(0);
      expect(result.min).toBe(-10);
      expect(result.max).toBe(10);
    });
  });

  // ── minMax ────────────────────────────────────────────────────────
  describe('minMax()', function () {
    it('returns {min:0, max:0} for empty array', function () {
      expect(stats.minMax([])).toEqual({ min: 0, max: 0 });
    });

    it('finds min and max correctly', function () {
      expect(stats.minMax([3, 1, 4, 1, 5, 9, 2, 6])).toEqual({ min: 1, max: 9 });
    });

    it('handles single element', function () {
      expect(stats.minMax([7])).toEqual({ min: 7, max: 7 });
    });

    it('handles all negative values', function () {
      expect(stats.minMax([-5, -3, -8, -1])).toEqual({ min: -8, max: -1 });
    });

    it('handles large arrays without stack overflow', function () {
      var big = [];
      for (var i = 0; i < 200000; i++) big.push(i);
      var result = stats.minMax(big);
      expect(result.min).toBe(0);
      expect(result.max).toBe(199999);
    });
  });
});
