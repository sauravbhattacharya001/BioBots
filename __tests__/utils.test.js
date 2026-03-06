/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

// Load constants.js first to define METRIC_DESCRIPTORS etc. in global scope
const constantsSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'docs', 'shared', 'constants.js'), 'utf-8'
);
// eslint-disable-next-line no-eval
eval(constantsSrc);

// Load utils.js to define escapeHtml, getMetricValue, etc. in global scope
const utilsSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'docs', 'shared', 'utils.js'), 'utf-8'
);
// eslint-disable-next-line no-eval
eval(utilsSrc);

describe('docs/shared/utils', () => {
    // ── escapeHtml ──────────────────────────────────────────────────────

    describe('escapeHtml', () => {
        test('escapes angle brackets', () => {
            expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
        });

        test('escapes ampersand', () => {
            expect(escapeHtml('a & b')).toBe('a &amp; b');
        });

        test('returns empty string for null', () => {
            expect(escapeHtml(null)).toBe('');
        });

        test('returns empty string for undefined', () => {
            expect(escapeHtml(undefined)).toBe('');
        });

        test('converts numbers to string', () => {
            expect(escapeHtml(42)).toBe('42');
        });

        test('handles empty string', () => {
            expect(escapeHtml('')).toBe('');
        });

        test('passes through safe strings', () => {
            expect(escapeHtml('Hello World')).toBe('Hello World');
        });

        test('escapes mixed dangerous characters', () => {
            const result = escapeHtml('<img onerror="alert(1)" src=x>');
            expect(result).not.toContain('<');
            expect(result).not.toContain('>');
        });
    });

    // ── getMetricValue ──────────────────────────────────────────────────

    describe('getMetricValue', () => {
        const mockPrint = {
            print_data: {
                livePercent: 85.5,
                deadPercent: 14.5,
                elasticity: 12.3,
            },
            print_info: {
                crosslinking: { cl_duration: 200, cl_intensity: 75 },
                pressure: { extruder1: 3.5, extruder2: 2.1 },
                resolution: { layerHeight: 0.4, layerNum: 8 },
                wellplate: '6-well',
            },
        };

        test('extracts livePercent from print_data', () => {
            expect(getMetricValue(mockPrint, 'livePercent')).toBe(85.5);
        });

        test('extracts deadPercent from print_data', () => {
            expect(getMetricValue(mockPrint, 'deadPercent')).toBe(14.5);
        });

        test('extracts elasticity from print_data', () => {
            expect(getMetricValue(mockPrint, 'elasticity')).toBe(12.3);
        });

        test('extracts nested crosslinking values', () => {
            expect(getMetricValue(mockPrint, 'cl_duration')).toBe(200);
            expect(getMetricValue(mockPrint, 'cl_intensity')).toBe(75);
        });

        test('extracts pressure values', () => {
            expect(getMetricValue(mockPrint, 'extruder1')).toBe(3.5);
            expect(getMetricValue(mockPrint, 'extruder2')).toBe(2.1);
        });

        test('extracts resolution values', () => {
            expect(getMetricValue(mockPrint, 'layerHeight')).toBe(0.4);
            expect(getMetricValue(mockPrint, 'layerNum')).toBe(8);
        });

        test('returns null for wellplate in fallback mode', () => {
            // In Node (no browser globals), utils.js uses a fallback accessor
            // map that doesn't include 'wellplate' — only the browser-loaded
            // METRIC_DESCRIPTORS has the wellplate accessor.
            expect(getMetricValue(mockPrint, 'wellplate')).toBeNull();
        });

        test('returns null for unknown metric', () => {
            expect(getMetricValue(mockPrint, 'nonexistent')).toBeNull();
        });

        test('returns null when nested path is missing', () => {
            const partial = { print_data: {}, print_info: {} };
            expect(getMetricValue(partial, 'cl_duration')).toBeNull();
        });
    });

    // ── formatNum ───────────────────────────────────────────────────────

    describe('formatNum', () => {
        test('returns dash for null', () => {
            expect(formatNum(null)).toBe('-');
        });

        test('returns dash for undefined', () => {
            expect(formatNum(undefined)).toBe('-');
        });

        test('formats integer without decimals', () => {
            expect(formatNum(42)).toBe('42');
        });

        test('formats decimal with 2 places', () => {
            expect(formatNum(3.14159)).toBe('3.14');
        });

        test('formats large numbers with locale grouping', () => {
            const result = formatNum(12345);
            // Should contain digits (locale-dependent separator)
            expect(result).toMatch(/12.*345/);
        });

        test('handles zero', () => {
            expect(formatNum(0)).toBe('0');
        });

        test('handles negative decimals', () => {
            const result = formatNum(-3.14);
            expect(result).toContain('3.14');
        });

        test('handles very small decimals', () => {
            expect(formatNum(0.123)).toBe('0.12');
        });
    });

    // ── percentile ──────────────────────────────────────────────────────

    describe('percentile', () => {
        test('returns 0 for empty array', () => {
            expect(percentile([], 0.5)).toBe(0);
        });

        test('returns sole element for single-element array', () => {
            expect(percentile([42], 0.5)).toBe(42);
            expect(percentile([42], 0)).toBe(42);
            expect(percentile([42], 1)).toBe(42);
        });

        test('returns min at p=0', () => {
            expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
        });

        test('returns max at p=1', () => {
            expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5);
        });

        test('returns median at p=0.5 for odd-length array', () => {
            expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
        });

        test('interpolates for even-length array median', () => {
            expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
        });

        test('computes Q1 correctly', () => {
            expect(percentile([1, 2, 3, 4, 5], 0.25)).toBe(2);
        });

        test('computes Q3 correctly', () => {
            expect(percentile([1, 2, 3, 4, 5], 0.75)).toBe(4);
        });

        test('interpolates fractional rank', () => {
            // [10, 20, 30, 40]: p=0.3, rank = 0.3 * 3 = 0.9
            // 10 + 0.9 * (20 - 10) = 19
            expect(percentile([10, 20, 30, 40], 0.3)).toBe(19);
        });

        test('handles two-element array', () => {
            expect(percentile([10, 20], 0.5)).toBe(15);
            expect(percentile([10, 20], 0)).toBe(10);
            expect(percentile([10, 20], 1)).toBe(20);
        });
    });

    // ── computeStats ────────────────────────────────────────────────────

    describe('computeStats', () => {
        test('returns zeros for empty array', () => {
            const stats = computeStats([]);
            expect(stats.mean).toBe(0);
            expect(stats.std).toBe(0);
            expect(stats.q1).toBe(0);
            expect(stats.q3).toBe(0);
            expect(stats.iqr).toBe(0);
            expect(stats.median).toBe(0);
        });

        test('handles single element', () => {
            const stats = computeStats([42]);
            expect(stats.mean).toBe(42);
            expect(stats.std).toBe(0);
            expect(stats.median).toBe(42);
        });

        test('computes correct mean', () => {
            const stats = computeStats([2, 4, 6, 8, 10]);
            expect(stats.mean).toBeCloseTo(6, 10);
        });

        test('computes sample standard deviation (n-1)', () => {
            // [2,4,6,8,10]: mean=6, var=(16+4+0+4+16)/4=10, std=sqrt(10)
            const stats = computeStats([2, 4, 6, 8, 10]);
            expect(stats.std).toBeCloseTo(Math.sqrt(10), 5);
        });

        test('computes correct median for odd-length', () => {
            const stats = computeStats([5, 1, 3]); // sorted: [1,3,5]
            expect(stats.median).toBe(3);
        });

        test('computes correct median for even-length', () => {
            const stats = computeStats([4, 1, 3, 2]); // sorted: [1,2,3,4]
            expect(stats.median).toBe(2.5);
        });

        test('computes IQR correctly', () => {
            const stats = computeStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
            expect(stats.iqr).toBeCloseTo(stats.q3 - stats.q1, 10);
            expect(stats.iqr).toBeGreaterThan(0);
        });

        test('handles identical values', () => {
            const stats = computeStats([5, 5, 5, 5]);
            expect(stats.mean).toBe(5);
            expect(stats.std).toBe(0);
            expect(stats.iqr).toBe(0);
            expect(stats.median).toBe(5);
        });

        test('handles negative values', () => {
            const stats = computeStats([-3, -1, 0, 1, 3]);
            expect(stats.mean).toBeCloseTo(0, 10);
            expect(stats.median).toBe(0);
        });

        test('sorts array in-place', () => {
            const arr = [5, 3, 1, 4, 2];
            computeStats(arr);
            expect(arr).toEqual([1, 2, 3, 4, 5]);
        });

        test('large dataset produces reasonable results', () => {
            const values = Array.from({ length: 1000 }, (_, i) => i);
            const stats = computeStats(values);
            expect(stats.mean).toBeCloseTo(499.5, 1);
            expect(stats.median).toBeCloseTo(499.5, 1);
            expect(stats.std).toBeGreaterThan(250);
            expect(stats.std).toBeLessThan(300);
        });

        test('Welford algorithm is numerically stable', () => {
            const base = 1e10;
            const values = [base + 1, base + 2, base + 3];
            const stats = computeStats(values);
            expect(stats.mean).toBeCloseTo(base + 2, 1);
            expect(stats.std).toBeCloseTo(1, 5);
        });

        test('two elements uses n-1 denominator', () => {
            // [0, 10]: mean=5, var=(25+25)/1=50, std=sqrt(50)
            const stats = computeStats([0, 10]);
            expect(stats.mean).toBe(5);
            expect(stats.std).toBeCloseTo(Math.sqrt(50), 5);
        });
    });
});
