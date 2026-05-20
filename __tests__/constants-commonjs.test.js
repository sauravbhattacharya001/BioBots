/**
 * Regression: docs/shared/constants.js must export its symbols via
 * CommonJS so `require('./constants').escapeHtml` works in Node.
 *
 * Until 2026-05-19 the file only declared `escapeHtml`, `METRICS`,
 * `metricLabels`, `metricColors` and `METRIC_DESCRIPTORS` as top-level
 * `function` / `const` declarations and never wrote to `module.exports`.
 * That meant:
 *   - `require('./docs/shared/constants')` returned `{}` (empty object).
 *   - `utils.js`'s CommonJS fallback `require('./constants').escapeHtml`
 *     resolved to `undefined`, so `require('./docs/shared/utils').escapeHtml`
 *     was `undefined` for any Node consumer of the SDK.
 *
 * The bug was masked in the rest of the test suite because every test
 * file loads constants.js via `fs.readFileSync` + `eval`, leaking
 * symbols into the test's `globalThis` instead of going through the
 * real `require` path. Pure Node consumers (the SDK's documented usage
 * pattern, see README "Usage" section) hit `undefined` immediately.
 *
 * This test exercises the *real* `require` path to lock in the fix.
 */
describe('docs/shared/constants - CommonJS exports', () => {
    // Use a fresh require cache per test run.
    let constants;
    beforeAll(() => {
        jest.resetModules();
        constants = require('../docs/shared/constants');
    });

    test('module exports an object with at least one key', () => {
        expect(constants).toBeDefined();
        expect(typeof constants).toBe('object');
        expect(constants).not.toBeNull();
        expect(Object.keys(constants).length).toBeGreaterThan(0);
    });

    test('exports escapeHtml as a function', () => {
        expect(typeof constants.escapeHtml).toBe('function');
    });

    test('escapeHtml works correctly through require()', () => {
        expect(constants.escapeHtml('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
        expect(constants.escapeHtml('a & b')).toBe('a &amp; b');
        expect(constants.escapeHtml('"q\'')).toBe('&quot;q&#39;');
        expect(constants.escapeHtml(null)).toBe('');
        expect(constants.escapeHtml(undefined)).toBe('');
        expect(constants.escapeHtml(0)).toBe('0');
    });

    test('exports METRICS array', () => {
        expect(Array.isArray(constants.METRICS)).toBe(true);
        expect(constants.METRICS).toContain('livePercent');
        expect(constants.METRICS).toContain('deadPercent');
        expect(constants.METRICS.length).toBe(9);
    });

    test('exports metricLabels object', () => {
        expect(typeof constants.metricLabels).toBe('object');
        constants.METRICS.forEach(key => {
            expect(typeof constants.metricLabels[key]).toBe('string');
        });
    });

    test('exports metricColors object with valid hex codes', () => {
        expect(typeof constants.metricColors).toBe('object');
        constants.METRICS.forEach(key => {
            expect(constants.metricColors[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
        });
    });

    test('exports METRIC_DESCRIPTORS array with working accessors', () => {
        expect(Array.isArray(constants.METRIC_DESCRIPTORS)).toBe(true);
        expect(constants.METRIC_DESCRIPTORS.length).toBeGreaterThanOrEqual(10);

        const mockPrint = {
            print_data: { livePercent: 80, deadPercent: 20, elasticity: 4 },
            print_info: {
                crosslinking: { cl_duration: 30, cl_intensity: 70 },
                pressure: { extruder1: 90, extruder2: 60 },
                resolution: { layerHeight: 0.3, layerNum: 12 },
                wellplate: 6,
            },
        };
        const byKey = Object.fromEntries(
            constants.METRIC_DESCRIPTORS.map(d => [d.key, d])
        );
        expect(byKey.livePercent.get(mockPrint)).toBe(80);
        expect(byKey.wellplate.get(mockPrint)).toBe(6);
    });
});

describe('docs/shared/utils - CommonJS escapeHtml passthrough', () => {
    // Regression: utils.js re-exports constants.escapeHtml via require().
    // Before the constants.js fix this resolved to `undefined` and any
    // Node SDK consumer calling `biobots.utils.escapeHtml` would crash.
    test('utils.escapeHtml is a function (not undefined)', () => {
        jest.resetModules();
        const utils = require('../docs/shared/utils');
        expect(typeof utils.escapeHtml).toBe('function');
        expect(utils.escapeHtml('<x>')).toBe('&lt;x&gt;');
    });

    test('utils and constants resolve to the same escapeHtml semantics', () => {
        jest.resetModules();
        const utils = require('../docs/shared/utils');
        const constants = require('../docs/shared/constants');
        const samples = ['<b>', 'a&b', '"q\'', '', 'plain text', '<img src=x onerror=1>'];
        for (const s of samples) {
            expect(utils.escapeHtml(s)).toBe(constants.escapeHtml(s));
        }
    });
});
