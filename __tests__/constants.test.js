/**
 * @jest-environment jsdom
 *
 * Tests for docs/shared/constants.js — shared constants, metrics, and escapeHtml.
 */
const fs = require('fs');
const path = require('path');

// Load constants.js — replace const with var so globals leak into scope via eval
const constantsSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'docs', 'shared', 'constants.js'), 'utf-8'
).replace(/^const /gm, 'var ');
// eslint-disable-next-line no-eval
eval(constantsSrc);

// ── escapeHtml ──────────────────────────────────────────────────────

describe('escapeHtml', () => {
    test('escapes HTML special characters', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe(
            '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        );
    });

    test('escapes ampersand', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('escapes single quotes', () => {
        expect(escapeHtml("it's")).toBe("it&#39;s");
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

    test('passes through safe strings unchanged', () => {
        expect(escapeHtml('Hello World')).toBe('Hello World');
    });

    test('handles mixed special characters', () => {
        const result = escapeHtml('<b>"Tom & Jerry\'s"</b>');
        expect(result).not.toContain('<');
        expect(result).not.toContain('>');
        expect(result).toContain('&amp;');
        expect(result).toContain('&quot;');
        expect(result).toContain('&#39;');
    });
});

// ── METRICS ─────────────────────────────────────────────────────────

describe('METRICS', () => {
    test('is an array of strings', () => {
        expect(Array.isArray(METRICS)).toBe(true);
        METRICS.forEach(m => expect(typeof m).toBe('string'));
    });

    test('contains expected core metrics', () => {
        expect(METRICS).toContain('livePercent');
        expect(METRICS).toContain('deadPercent');
        expect(METRICS).toContain('elasticity');
        expect(METRICS).toContain('cl_duration');
        expect(METRICS).toContain('cl_intensity');
        expect(METRICS).toContain('extruder1');
        expect(METRICS).toContain('layerHeight');
        expect(METRICS).toContain('layerNum');
    });

    test('has 9 metrics', () => {
        expect(METRICS.length).toBe(9);
    });

    test('has no duplicates', () => {
        const unique = new Set(METRICS);
        expect(unique.size).toBe(METRICS.length);
    });
});

// ── metricLabels ────────────────────────────────────────────────────

describe('metricLabels', () => {
    test('has a label for every METRICS entry', () => {
        METRICS.forEach(key => {
            expect(metricLabels[key]).toBeDefined();
            expect(typeof metricLabels[key]).toBe('string');
            expect(metricLabels[key].length).toBeGreaterThan(0);
        });
    });

    test('labels are human-readable (contain spaces or uppercase)', () => {
        Object.values(metricLabels).forEach(label => {
            expect(label).toMatch(/[A-Z ]/);
        });
    });
});

// ── metricColors ────────────────────────────────────────────────────

describe('metricColors', () => {
    test('has a color for every METRICS entry', () => {
        METRICS.forEach(key => {
            expect(metricColors[key]).toBeDefined();
        });
    });

    test('all colors are valid hex codes', () => {
        Object.values(metricColors).forEach(color => {
            expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
        });
    });

    test('no duplicate colors', () => {
        const colors = Object.values(metricColors);
        const unique = new Set(colors);
        expect(unique.size).toBe(colors.length);
    });
});

// ── METRIC_DESCRIPTORS ──────────────────────────────────────────────

describe('METRIC_DESCRIPTORS', () => {
    test('is a non-empty array', () => {
        expect(Array.isArray(METRIC_DESCRIPTORS)).toBe(true);
        expect(METRIC_DESCRIPTORS.length).toBeGreaterThan(0);
    });

    test('each descriptor has required fields', () => {
        METRIC_DESCRIPTORS.forEach(d => {
            expect(d).toHaveProperty('key');
            expect(d).toHaveProperty('label');
            expect(d).toHaveProperty('unit');
            expect(d).toHaveProperty('higherBetter');
            expect(d).toHaveProperty('get');
            expect(typeof d.key).toBe('string');
            expect(typeof d.label).toBe('string');
            expect(typeof d.unit).toBe('string');
            expect(typeof d.get).toBe('function');
        });
    });

    test('higherBetter is boolean or null', () => {
        METRIC_DESCRIPTORS.forEach(d => {
            expect([true, false, null]).toContain(d.higherBetter);
        });
    });

    test('includes wellplate descriptor', () => {
        const wp = METRIC_DESCRIPTORS.find(d => d.key === 'wellplate');
        expect(wp).toBeDefined();
        expect(wp.label).toBe('Wellplate');
    });

    test('accessor functions extract correct values from a print record', () => {
        const mockPrint = {
            print_data: { livePercent: 92, deadPercent: 8, elasticity: 3.5 },
            print_info: {
                crosslinking: { cl_duration: 15, cl_intensity: 60 },
                pressure: { extruder1: 100, extruder2: 50 },
                resolution: { layerHeight: 0.4, layerNum: 8 },
                wellplate: 24,
            },
        };

        const live = METRIC_DESCRIPTORS.find(d => d.key === 'livePercent');
        expect(live.get(mockPrint)).toBe(92);

        const dead = METRIC_DESCRIPTORS.find(d => d.key === 'deadPercent');
        expect(dead.get(mockPrint)).toBe(8);

        const elast = METRIC_DESCRIPTORS.find(d => d.key === 'elasticity');
        expect(elast.get(mockPrint)).toBe(3.5);

        const clDur = METRIC_DESCRIPTORS.find(d => d.key === 'cl_duration');
        expect(clDur.get(mockPrint)).toBe(15);

        const ext1 = METRIC_DESCRIPTORS.find(d => d.key === 'extruder1');
        expect(ext1.get(mockPrint)).toBe(100);

        const lh = METRIC_DESCRIPTORS.find(d => d.key === 'layerHeight');
        expect(lh.get(mockPrint)).toBe(0.4);

        const wp = METRIC_DESCRIPTORS.find(d => d.key === 'wellplate');
        expect(wp.get(mockPrint)).toBe(24);
    });

    test('descriptor keys cover all METRICS entries', () => {
        const descriptorKeys = METRIC_DESCRIPTORS.map(d => d.key);
        METRICS.forEach(m => {
            expect(descriptorKeys).toContain(m);
        });
    });
});
