'use strict';

const { mean, median, cv, stddev, pstddev, percentile } = require('../docs/shared/stats');

describe('stats', () => {
  // ── mean ──────────────────────────────────────────────────

  describe('mean', () => {
    test('returns 0 for empty array', () => {
      expect(mean([])).toBe(0);
    });

    test('single element', () => {
      expect(mean([42])).toBe(42);
    });

    test('basic average', () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3);
    });

    test('handles negative values', () => {
      expect(mean([-10, 10])).toBe(0);
    });

    test('floating point values', () => {
      expect(mean([0.1, 0.2, 0.3])).toBeCloseTo(0.2, 10);
    });

    test('Kahan summation reduces floating-point drift', () => {
      // Without compensation, adding many small values to a large value
      // loses precision. Kahan summation should keep the result accurate.
      const arr = [1e15, 1, -1e15, 1];
      // Naive sum would lose the two 1s; Kahan preserves them
      expect(mean(arr)).toBeCloseTo(0.5, 5);
    });

    test('large uniform array', () => {
      const arr = new Array(10000).fill(7);
      expect(mean(arr)).toBe(7);
    });
  });

  // ── median ────────────────────────────────────────────────

  describe('median', () => {
    test('returns 0 for empty array', () => {
      expect(median([])).toBe(0);
    });

    test('single element', () => {
      expect(median([5])).toBe(5);
    });

    test('odd-length array', () => {
      expect(median([3, 1, 2])).toBe(2);
    });

    test('even-length array averages two middle values', () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    test('does not mutate input array', () => {
      const arr = [5, 3, 1];
      median(arr);
      expect(arr).toEqual([5, 3, 1]);
    });

    test('handles duplicates', () => {
      expect(median([2, 2, 2, 2])).toBe(2);
    });

    test('negative values', () => {
      expect(median([-5, -1, -3])).toBe(-3);
    });
  });

  // ── stddev (sample, n-1) ──────────────────────────────────

  describe('stddev', () => {
    test('returns 0 for empty array', () => {
      expect(stddev([])).toBe(0);
    });

    test('returns 0 for single element', () => {
      expect(stddev([42])).toBe(0);
    });

    test('identical values → 0', () => {
      expect(stddev([5, 5, 5, 5])).toBe(0);
    });

    test('basic sample stddev', () => {
      // [2, 4, 4, 4, 5, 5, 7, 9] → sample stddev ≈ 2.138
      const arr = [2, 4, 4, 4, 5, 5, 7, 9];
      expect(stddev(arr)).toBeCloseTo(2.13809, 4);
    });

    test('accepts pre-computed mean', () => {
      const arr = [10, 20, 30];
      const m = mean(arr);
      expect(stddev(arr, m)).toBeCloseTo(stddev(arr), 10);
    });

    test('two elements', () => {
      // [0, 10] → mean=5, ss=50, sample stddev = sqrt(50/1) = sqrt(50)
      expect(stddev([0, 10])).toBeCloseTo(Math.sqrt(50), 10);
    });
  });

  // ── pstddev (population, n) ───────────────────────────────

  describe('pstddev', () => {
    test('returns 0 for fewer than 2 elements', () => {
      expect(pstddev([])).toBe(0);
      expect(pstddev([1])).toBe(0);
    });

    test('population stddev is smaller than sample stddev', () => {
      const arr = [2, 4, 4, 4, 5, 5, 7, 9];
      expect(pstddev(arr)).toBeLessThan(stddev(arr));
    });

    test('basic population stddev', () => {
      // [2, 4, 4, 4, 5, 5, 7, 9] → pop stddev = 2.0
      expect(pstddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.0, 4);
    });

    test('accepts pre-computed mean', () => {
      const arr = [1, 2, 3];
      expect(pstddev(arr, mean(arr))).toBeCloseTo(pstddev(arr), 10);
    });
  });

  // ── cv ────────────────────────────────────────────────────

  describe('cv', () => {
    test('returns 0 for empty array', () => {
      expect(cv([])).toBe(0);
    });

    test('returns 0 when mean is 0', () => {
      expect(cv([-1, 1])).toBe(0);
    });

    test('zero stddev → 0% CV', () => {
      expect(cv([5, 5, 5])).toBe(0);
    });

    test('basic CV calculation', () => {
      // CV = (stddev / |mean|) * 100
      const arr = [10, 20, 30];
      const expected = (stddev(arr) / mean(arr)) * 100;
      expect(cv(arr)).toBeCloseTo(expected, 10);
    });

    test('negative mean uses absolute value', () => {
      const arr = [-10, -20, -30];
      expect(cv(arr)).toBeGreaterThan(0);
    });
  });

  // ── percentile ────────────────────────────────────────────

  describe('percentile', () => {
    test('returns 0 for empty array', () => {
      expect(percentile([], 50)).toBe(0);
    });

    test('p=0 returns minimum', () => {
      expect(percentile([10, 20, 30], 0)).toBe(10);
    });

    test('p=100 returns maximum', () => {
      expect(percentile([10, 20, 30], 100)).toBe(30);
    });

    test('p=50 returns median', () => {
      const arr = [1, 2, 3, 4, 5];
      expect(percentile(arr, 50)).toBe(median(arr));
    });

    test('interpolates between values', () => {
      // [10, 20, 30, 40] at p=25 → idx=0.75 → 10 + (20-10)*0.75 = 17.5
      expect(percentile([10, 20, 30, 40], 25)).toBe(17.5);
    });

    test('does not mutate input', () => {
      const arr = [30, 10, 20];
      percentile(arr, 50);
      expect(arr).toEqual([30, 10, 20]);
    });

    test('single element always returns that value', () => {
      expect(percentile([42], 0)).toBe(42);
      expect(percentile([42], 50)).toBe(42);
      expect(percentile([42], 100)).toBe(42);
    });
  });
});
