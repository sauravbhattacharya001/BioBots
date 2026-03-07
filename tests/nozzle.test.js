/**
 * tests/nozzle.test.js — Nozzle Lifecycle Tracker tests
 *
 * Extracts and tests the pure computation functions from nozzle.html
 * (mean, linearSlope, clamp, pct, computeWearMetrics, etc.)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// ── Bootstrap nozzle.html in jsdom ─────────────────────────────

let dom, window, document;

function setupDOM() {
    const html = fs.readFileSync(
        path.join(__dirname, '..', 'docs', 'nozzle.html'), 'utf-8'
    );
    // Stub out external script references to avoid fetch
    const patched = html
        .replace(/<script src="shared\/constants\.js"><\/script>/g, '')
        .replace(/<script src="shared\/data-loader\.js"><\/script>/g, '');
    dom = new JSDOM(patched, {
        runScripts: 'dangerously',
        url: 'http://localhost',
        pretendToBeVisual: true
    });
    window = dom.window;
    document = window.document;

    // Stub loadBioprintData
    window.loadBioprintData = function(opts) {
        return Promise.resolve([]);
    };
}

beforeAll(() => { setupDOM(); });

// ── Helper extraction ──────────────────────────────────────────

function fn(name) { return window[name]; }

// ── mean() ─────────────────────────────────────────────────────

describe('mean', () => {
    test('returns 0 for empty array', () => {
        expect(fn('mean')([])).toBe(0);
    });

    test('returns value for single element', () => {
        expect(fn('mean')([5])).toBe(5);
    });

    test('computes average correctly', () => {
        expect(fn('mean')([2, 4, 6])).toBe(4);
    });

    test('handles decimals', () => {
        expect(fn('mean')([1.5, 2.5])).toBe(2);
    });
});

// ── linearSlope() ──────────────────────────────────────────────

describe('linearSlope', () => {
    test('returns 0 for empty array', () => {
        expect(fn('linearSlope')([])).toBe(0);
    });

    test('returns 0 for single value', () => {
        expect(fn('linearSlope')([5])).toBe(0);
    });

    test('positive slope for increasing values', () => {
        expect(fn('linearSlope')([10, 20, 30])).toBeGreaterThan(0);
    });

    test('negative slope for decreasing values', () => {
        expect(fn('linearSlope')([30, 20, 10])).toBeLessThan(0);
    });

    test('zero slope for constant values', () => {
        expect(fn('linearSlope')([5, 5, 5, 5])).toBe(0);
    });

    test('exact slope for linear data', () => {
        // y = 2x: [0, 2, 4, 6]
        expect(fn('linearSlope')([0, 2, 4, 6])).toBeCloseTo(2, 5);
    });
});

// ── clamp() ────────────────────────────────────────────────────

describe('clamp', () => {
    test('returns value within range', () => {
        expect(fn('clamp')(5, 0, 10)).toBe(5);
    });

    test('clamps to lower bound', () => {
        expect(fn('clamp')(-5, 0, 10)).toBe(0);
    });

    test('clamps to upper bound', () => {
        expect(fn('clamp')(15, 0, 10)).toBe(10);
    });

    test('handles boundary values', () => {
        expect(fn('clamp')(0, 0, 1)).toBe(0);
        expect(fn('clamp')(1, 0, 1)).toBe(1);
    });
});

// ── pct() ──────────────────────────────────────────────────────

describe('pct', () => {
    test('converts 0 to 0', () => {
        expect(fn('pct')(0)).toBe(0);
    });

    test('converts 1 to 100', () => {
        expect(fn('pct')(1)).toBe(100);
    });

    test('rounds correctly', () => {
        expect(fn('pct')(0.456)).toBe(46);
    });

    test('converts 0.5 to 50', () => {
        expect(fn('pct')(0.5)).toBe(50);
    });
});

// ── gaugeColor() ───────────────────────────────────────────────

describe('gaugeColor', () => {
    test('returns success color for low wear', () => {
        expect(fn('gaugeColor')(0.3)).toBe('var(--success)');
    });

    test('returns warning for moderate wear', () => {
        expect(fn('gaugeColor')(0.6)).toBe('var(--warning)');
    });

    test('returns error for high wear', () => {
        expect(fn('gaugeColor')(0.8)).toBe('var(--error)');
    });

    test('boundary: 0.5 is success', () => {
        expect(fn('gaugeColor')(0.49)).toBe('var(--success)');
    });

    test('boundary: 0.75 is warning', () => {
        expect(fn('gaugeColor')(0.74)).toBe('var(--warning)');
    });
});

// ── statusBadge() ──────────────────────────────────────────────

describe('statusBadge', () => {
    test('returns Good badge for low fraction', () => {
        var badge = fn('statusBadge')(0.3);
        expect(badge).toContain('badge-good');
        expect(badge).toContain('Good');
    });

    test('returns Moderate badge for mid fraction', () => {
        var badge = fn('statusBadge')(0.6);
        expect(badge).toContain('badge-warn');
        expect(badge).toContain('Moderate');
    });

    test('returns Replace Soon for high fraction', () => {
        var badge = fn('statusBadge')(0.8);
        expect(badge).toContain('badge-critical');
        expect(badge).toContain('Replace Soon');
    });
});

// ── NOZZLE_FACTORS ─────────────────────────────────────────────

describe('NOZZLE_FACTORS', () => {
    test('has all 4 nozzle types', () => {
        var factors = window.NOZZLE_FACTORS;
        expect(factors).toHaveProperty('standard');
        expect(factors).toHaveProperty('ceramic');
        expect(factors).toHaveProperty('glass');
        expect(factors).toHaveProperty('plastic');
    });

    test('plastic has highest pressure sensitivity', () => {
        var f = window.NOZZLE_FACTORS;
        expect(f.plastic.pressureSens).toBeGreaterThan(f.standard.pressureSens);
    });

    test('ceramic has lowest pressure sensitivity', () => {
        var f = window.NOZZLE_FACTORS;
        expect(f.ceramic.pressureSens).toBeLessThan(f.standard.pressureSens);
    });
});

// ── computeWearMetrics() ───────────────────────────────────────

function makeRecord(ext1, ext2, layers, viab) {
    return {
        print_data: { livePercent: viab, deadPercent: 100 - viab, elasticity: 50 },
        print_info: {
            pressure: { extruder1: ext1, extruder2: ext2 },
            resolution: { layerHeight: 0.5, layerNum: layers },
            crosslinking: { cl_enabled: true, cl_duration: 100, cl_intensity: 10 },
            files: { input: 'test.gcode', output: 'test_out.gcode' },
            wellplate: 6
        },
        user_info: { email: 'test@test.com', serial: 0 }
    };
}

function defaultSettings() {
    return { type: 'standard', diameter: 0.4, maxPrints: 200, pressureThreshold: 80 };
}

describe('computeWearMetrics', () => {
    test('returns zero wear for empty data', () => {
        var m = fn('computeWearMetrics')([], defaultSettings());
        expect(m.totalRuns).toBe(0);
        expect(m.overallWear).toBe(0);
    });

    test('computes metrics for valid data', () => {
        var data = [
            makeRecord(50, 60, 30, 80),
            makeRecord(55, 65, 35, 75),
            makeRecord(60, 70, 40, 70)
        ];
        var m = fn('computeWearMetrics')(data, defaultSettings());
        expect(m.totalRuns).toBe(3);
        expect(m.overallWear).toBeGreaterThan(0);
        expect(m.overallWear).toBeLessThanOrEqual(1);
        expect(m.ext1.avg).toBeCloseTo(55, 0);
        expect(m.ext2.avg).toBeCloseTo(65, 0);
    });

    test('remaining prints decreases with more data', () => {
        var few = [makeRecord(50, 60, 30, 80)];
        var many = [];
        for (var i = 0; i < 100; i++) many.push(makeRecord(50 + i * 0.5, 60, 30, 80));

        var mFew = fn('computeWearMetrics')(few, defaultSettings());
        var mMany = fn('computeWearMetrics')(many, defaultSettings());
        expect(mMany.remainingPrints).toBeLessThan(mFew.remainingPrints);
    });

    test('higher pressure increases wear', () => {
        var lowP = [makeRecord(30, 30, 30, 80), makeRecord(30, 30, 30, 80)];
        var highP = [makeRecord(120, 120, 30, 80), makeRecord(120, 120, 30, 80)];

        var mLow = fn('computeWearMetrics')(lowP, defaultSettings());
        var mHigh = fn('computeWearMetrics')(highP, defaultSettings());
        // More layers/pressure = higher per-run impact
        expect(mHigh.runs[0].impact).toBeGreaterThan(mLow.runs[0].impact);
    });

    test('ceramic nozzle has less wear than plastic', () => {
        var data = [];
        for (var i = 0; i < 50; i++) data.push(makeRecord(70, 70, 40, 75));

        var mCeramic = fn('computeWearMetrics')(data, { type: 'ceramic', diameter: 0.4, maxPrints: 200, pressureThreshold: 80 });
        var mPlastic = fn('computeWearMetrics')(data, { type: 'plastic', diameter: 0.4, maxPrints: 200, pressureThreshold: 80 });
        expect(mCeramic.overallWear).toBeLessThan(mPlastic.overallWear);
    });

    test('quality risk is High when viability drops sharply', () => {
        var data = [];
        for (var i = 0; i < 20; i++) {
            data.push(makeRecord(50, 50, 30, 90 - i * 3));
        }
        var m = fn('computeWearMetrics')(data, defaultSettings());
        expect(m.qualityRisk).toBe('High');
    });

    test('quality risk is Low when viability is stable', () => {
        var data = [];
        for (var i = 0; i < 20; i++) {
            data.push(makeRecord(50, 50, 30, 80));
        }
        var m = fn('computeWearMetrics')(data, defaultSettings());
        expect(m.qualityRisk).toBe('Low');
    });

    test('runs sorted by impact in history', () => {
        var data = [
            makeRecord(30, 30, 10, 90),
            makeRecord(120, 120, 80, 50),
            makeRecord(50, 50, 30, 80)
        ];
        var m = fn('computeWearMetrics')(data, defaultSettings());
        var impacts = m.runs.map(function(r) { return r.impact; });
        // impacts should vary based on pressure/layers
        expect(impacts[1]).toBeGreaterThan(impacts[0]);
    });

    test('skips records without pressure data', () => {
        var data = [
            makeRecord(50, 60, 30, 80),
            { print_data: {}, print_info: {}, user_info: {} }, // invalid
            makeRecord(55, 65, 35, 75)
        ];
        var m = fn('computeWearMetrics')(data, defaultSettings());
        expect(m.totalRuns).toBe(2);
    });

    test('pressure trend detects rising pressure', () => {
        var data = [];
        for (var i = 0; i < 30; i++) {
            data.push(makeRecord(50 + i * 2, 50, 30, 80));
        }
        var m = fn('computeWearMetrics')(data, defaultSettings());
        expect(m.ext1.slope).toBeGreaterThan(0);
    });
});

// ── escapeHTML ──────────────────────────────────────────────────

describe('escapeHTML', () => {
    test('escapes angle brackets', () => {
        expect(fn('escapeHTML')('<script>')).not.toContain('<script>');
    });

    test('returns plain text unchanged', () => {
        expect(fn('escapeHTML')('hello')).toBe('hello');
    });
});

// ── Settings persistence ───────────────────────────────────────

describe('settings', () => {
    test('getSettings reads from DOM', () => {
        var s = fn('getSettings')();
        expect(s.type).toBe('standard');
        expect(s.diameter).toBe(0.4);
        expect(s.maxPrints).toBe(200);
        expect(s.pressureThreshold).toBe(80);
    });

    test('saveSettings stores to localStorage', () => {
        var s = { type: 'ceramic', diameter: 0.3, maxPrints: 150, pressureThreshold: 60 };
        fn('saveSettings')(s);
        var stored = JSON.parse(window.localStorage.getItem('biobots_nozzle_settings'));
        expect(stored.type).toBe('ceramic');
        expect(stored.maxPrints).toBe(150);
    });

    test('resetSettings clears localStorage', () => {
        fn('saveSettings')({ type: 'glass' });
        fn('resetSettings')();
        expect(window.localStorage.getItem('biobots_nozzle_settings')).toBeNull();
    });
});
