/**
 * CommonJS-mode tests for docs/shared/utils.js.
 *
 * The companion __tests__/utils.test.js loads the file via eval() under
 * jsdom to exercise the browser-style globals. That path never touches
 * the Node CommonJS exports block (module.exports, require('./validation'),
 * require('./constants').escapeHtml, require('./sanitize').stripDangerousKeys)
 * or the requireNumber/requirePositive/requireNonNegative/requireNumberInRange
 * validators — coverage for utils.js sat at ~68% lines / 33% functions.
 *
 * This file complements utils.test.js by importing utils through Node's
 * normal CommonJS resolver and asserting that every exported member
 * behaves as documented.
 */

'use strict';

const utils = require('../docs/shared/utils');
const constants = require('../docs/shared/constants');
const sanitize = require('../docs/shared/sanitize');

describe('docs/shared/utils (CommonJS exports)', () => {
    test('exports the canonical surface', () => {
        const expected = [
            'clamp', 'round', 'escapeHtml', 'getMetricValue',
            'stripDangerousKeys', 'formatNum', 'percentile', 'computeStats',
            'requireNumber', 'requireNumberInRange', 'requirePositive', 'requireNonNegative',
        ];
        for (const name of expected) {
            expect(typeof utils[name]).toBe('function');
        }
    });

    describe('escapeHtml passthrough', () => {
        test('delegates to constants.escapeHtml (identity)', () => {
            expect(utils.escapeHtml).toBe(constants.escapeHtml);
        });

        test('still produces the correct HTML-safe output', () => {
            expect(utils.escapeHtml('<a href="x">&\'</a>'))
                .toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
        });
    });

    describe('stripDangerousKeys passthrough', () => {
        test('delegates to sanitize.stripDangerousKeys (identity)', () => {
            expect(utils.stripDangerousKeys).toBe(sanitize.stripDangerousKeys);
        });

        test('drops __proto__ / prototype / constructor keys', () => {
            const input = JSON.parse('{"a":1,"__proto__":{"polluted":true},"b":{"constructor":{"x":1},"y":2}}');
            const out = utils.stripDangerousKeys(input);
            expect(out.a).toBe(1);
            expect(out.b.y).toBe(2);
            // 'constructor' is inherited from Object.prototype; what matters is
            // that it is NOT a sanitized object's own property anymore.
            expect(Object.prototype.hasOwnProperty.call(out.b, 'constructor')).toBe(false);
            // Confirm no prototype pollution actually landed on Object.prototype
            expect(({}).polluted).toBeUndefined();
        });
    });

    // ── clamp ──────────────────────────────────────────────────────────

    describe('clamp', () => {
        test('returns value when inside the range', () => {
            expect(utils.clamp(5, 0, 10)).toBe(5);
        });

        test('clamps below lower bound', () => {
            expect(utils.clamp(-3, 0, 10)).toBe(0);
        });

        test('clamps above upper bound', () => {
            expect(utils.clamp(99, 0, 10)).toBe(10);
        });

        test('inclusive on both bounds', () => {
            expect(utils.clamp(0, 0, 10)).toBe(0);
            expect(utils.clamp(10, 0, 10)).toBe(10);
        });

        test('works with negative ranges', () => {
            expect(utils.clamp(-50, -10, -1)).toBe(-10);
            expect(utils.clamp(0, -10, -1)).toBe(-1);
            expect(utils.clamp(-5, -10, -1)).toBe(-5);
        });

        test('handles zero-width range', () => {
            expect(utils.clamp(99, 3, 3)).toBe(3);
            expect(utils.clamp(-99, 3, 3)).toBe(3);
        });
    });

    // ── round ──────────────────────────────────────────────────────────

    describe('round', () => {
        test('defaults to 2 decimals', () => {
            expect(utils.round(3.14159)).toBe(3.14);
        });

        test('respects explicit decimals', () => {
            expect(utils.round(3.14159, 4)).toBe(3.1416);
            expect(utils.round(3.14159, 0)).toBe(3);
        });

        test('half-away-from-zero is JS-banker style (Math.round)', () => {
            // Math.round in JS rounds .5 toward +Infinity, not banker's
            expect(utils.round(0.5, 0)).toBe(1);
            expect(utils.round(1.5, 0)).toBe(2);
        });

        test('handles negative numbers', () => {
            expect(utils.round(-3.14159, 2)).toBe(-3.14);
        });

        test('uses the power-of-ten lookup table for d in [0..10]', () => {
            // The fast-path table is hit for d in [0..10]; verify a value above
            // the table (which falls through to Math.pow) still works.
            expect(utils.round(1.23456789012345, 11)).toBeCloseTo(1.23456789012, 10);
        });

        test('handles zero', () => {
            expect(utils.round(0)).toBe(0);
            expect(utils.round(0, 5)).toBe(0);
        });
    });

    // ── requireNumber ──────────────────────────────────────────────────

    describe('requireNumber', () => {
        test('returns valid numbers untouched', () => {
            expect(utils.requireNumber(42, 'x')).toBe(42);
            expect(utils.requireNumber(0, 'x')).toBe(0);
            expect(utils.requireNumber(-1.5, 'x')).toBe(-1.5);
        });

        test('throws on NaN', () => {
            expect(() => utils.requireNumber(NaN, 'x'))
                .toThrow(/x must be a finite number/);
        });

        test('throws on Infinity', () => {
            expect(() => utils.requireNumber(Infinity, 'x'))
                .toThrow(/x must be a finite number/);
            expect(() => utils.requireNumber(-Infinity, 'x'))
                .toThrow(/x must be a finite number/);
        });

        test('throws on non-number types', () => {
            expect(() => utils.requireNumber('5', 'x'))
                .toThrow(/x must be a finite number/);
            expect(() => utils.requireNumber(null, 'x'))
                .toThrow(/x must be a finite number/);
            expect(() => utils.requireNumber(undefined, 'x'))
                .toThrow(/x must be a finite number/);
            expect(() => utils.requireNumber({}, 'x'))
                .toThrow(/x must be a finite number/);
        });

        test('includes the offending value in the error', () => {
            expect(() => utils.requireNumber('oops', 'temperature'))
                .toThrow(/got: oops/);
        });
    });

    // ── requireNumberInRange ───────────────────────────────────────────

    describe('requireNumberInRange', () => {
        test('returns value when in range', () => {
            expect(utils.requireNumberInRange(5, 'x', 0, 10)).toBe(5);
        });

        test('inclusive on both bounds', () => {
            expect(utils.requireNumberInRange(0, 'x', 0, 10)).toBe(0);
            expect(utils.requireNumberInRange(10, 'x', 0, 10)).toBe(10);
        });

        test('throws when below min', () => {
            expect(() => utils.requireNumberInRange(-1, 'pH', 0, 14))
                .toThrow(/pH must be >= 0/);
        });

        test('throws when above max', () => {
            expect(() => utils.requireNumberInRange(15, 'pH', 0, 14))
                .toThrow(/pH must be <= 14/);
        });

        test('lone min works without max', () => {
            expect(utils.requireNumberInRange(1e9, 'x', 0)).toBe(1e9);
            expect(() => utils.requireNumberInRange(-1, 'x', 0)).toThrow(/x must be >= 0/);
        });

        test('lone max works without min', () => {
            expect(utils.requireNumberInRange(-1e9, 'x', undefined, 10)).toBe(-1e9);
            expect(() => utils.requireNumberInRange(11, 'x', undefined, 10)).toThrow(/x must be <= 10/);
        });

        test('rejects non-numbers before range check', () => {
            expect(() => utils.requireNumberInRange('5', 'x', 0, 10))
                .toThrow(/x must be a finite number/);
        });
    });

    // ── requirePositive ────────────────────────────────────────────────

    describe('requirePositive', () => {
        test('returns positive values', () => {
            expect(utils.requirePositive(0.0001, 'x')).toBe(0.0001);
            expect(utils.requirePositive(1e9, 'x')).toBe(1e9);
        });

        test('throws on zero', () => {
            expect(() => utils.requirePositive(0, 'volume'))
                .toThrow(/volume must be positive/);
        });

        test('throws on negatives', () => {
            expect(() => utils.requirePositive(-1, 'volume'))
                .toThrow(/volume must be positive/);
        });

        test('rejects NaN', () => {
            expect(() => utils.requirePositive(NaN, 'x'))
                .toThrow(/x must be a finite number/);
        });
    });

    // ── requireNonNegative ─────────────────────────────────────────────

    describe('requireNonNegative', () => {
        test('returns zero and positives', () => {
            expect(utils.requireNonNegative(0, 'x')).toBe(0);
            expect(utils.requireNonNegative(7, 'x')).toBe(7);
        });

        test('throws on negatives', () => {
            expect(() => utils.requireNonNegative(-0.5, 'concentration'))
                .toThrow(/concentration must be non-negative/);
        });

        test('rejects non-numbers', () => {
            expect(() => utils.requireNonNegative(null, 'x'))
                .toThrow(/x must be a finite number/);
        });
    });

    // ── computeStats CommonJS smoke ────────────────────────────────────

    describe('computeStats (CommonJS)', () => {
        test('matches the eval-loaded surface (mean/median/iqr)', () => {
            // Quick re-verification through the Node module path. The
            // jsdom-mode utils.test.js already covers the math in depth.
            const s = utils.computeStats([1, 2, 3, 4, 5]);
            expect(s.mean).toBe(3);
            expect(s.median).toBe(3);
            expect(s.q1).toBe(2);
            expect(s.q3).toBe(4);
            expect(s.iqr).toBe(2);
            expect(s.std).toBeCloseTo(Math.sqrt(2.5), 10);
        });
    });

    describe('percentile (CommonJS)', () => {
        test('produces the same values as the eval-loaded build', () => {
            expect(utils.percentile([10, 20, 30, 40], 0.3)).toBe(19);
            expect(utils.percentile([], 0.5)).toBe(0);
            expect(utils.percentile([42], 0.7)).toBe(42);
        });
    });

    describe('formatNum (CommonJS)', () => {
        test('returns "-" for null/undefined', () => {
            expect(utils.formatNum(null)).toBe('-');
            expect(utils.formatNum(undefined)).toBe('-');
        });

        test('compact form for small decimals', () => {
            expect(utils.formatNum(0.5)).toBe('0.50');
        });
    });

    describe('getMetricValue (CommonJS, no METRIC_DESCRIPTORS global)', () => {
        // In CommonJS context, utils.js's accessor map is built from the
        // *static fallback* (METRIC_DESCRIPTORS is not a global). The
        // browser-only 'wellplate' accessor therefore should not resolve.
        const sample = {
            print_data: { livePercent: 91, deadPercent: 9, elasticity: 5 },
            print_info: {
                crosslinking: { cl_duration: 100, cl_intensity: 80 },
                pressure: { extruder1: 2, extruder2: 1 },
                resolution: { layerHeight: 0.2, layerNum: 12 },
                wellplate: '24-well',
            },
        };

        test('returns values for all 9 documented metric keys', () => {
            expect(utils.getMetricValue(sample, 'livePercent')).toBe(91);
            expect(utils.getMetricValue(sample, 'deadPercent')).toBe(9);
            expect(utils.getMetricValue(sample, 'elasticity')).toBe(5);
            expect(utils.getMetricValue(sample, 'cl_duration')).toBe(100);
            expect(utils.getMetricValue(sample, 'cl_intensity')).toBe(80);
            expect(utils.getMetricValue(sample, 'extruder1')).toBe(2);
            expect(utils.getMetricValue(sample, 'extruder2')).toBe(1);
            expect(utils.getMetricValue(sample, 'layerHeight')).toBe(0.2);
            expect(utils.getMetricValue(sample, 'layerNum')).toBe(12);
        });

        test('returns null for unknown metric', () => {
            expect(utils.getMetricValue(sample, 'mysteryMetric')).toBeNull();
        });

        test('returns null when nested path throws', () => {
            // Missing print_data → accessor throws → null
            expect(utils.getMetricValue({}, 'livePercent')).toBeNull();
            expect(utils.getMetricValue({ print_info: {} }, 'cl_duration')).toBeNull();
        });
    });
});
