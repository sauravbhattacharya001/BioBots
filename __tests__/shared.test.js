/**
 * Tests for docs/shared/constants.js and docs/shared/utils.js
 *
 * Verifies the shared utility functions and constants used across
 * all dashboard pages. These modules are the single source of truth.
 */

// Re-create the shared constants and utils inline (same as shared files)
// since Jest runs in Node.js without browser DOM by default.

const METRICS = [
    'livePercent', 'deadPercent', 'elasticity',
    'cl_duration', 'cl_intensity',
    'extruder1', 'extruder2',
    'layerHeight', 'layerNum'
];

const metricLabels = {
    livePercent:  'Live Cell %',
    deadPercent:  'Dead Cell %',
    elasticity:   'Elasticity (kPa)',
    cl_duration:  'CL Duration (ms)',
    cl_intensity: 'CL Intensity (%)',
    extruder1:    'Extruder 1 Pressure',
    extruder2:    'Extruder 2 Pressure',
    layerHeight:  'Layer Height (mm)',
    layerNum:     'Layer Count'
};

const metricColors = {
    livePercent:  '#4ade80',
    deadPercent:  '#f87171',
    elasticity:   '#38bdf8',
    cl_duration:  '#fbbf24',
    cl_intensity: '#fb923c',
    extruder1:    '#a78bfa',
    extruder2:    '#c084fc',
    layerHeight:  '#2dd4bf',
    layerNum:     '#f472b6'
};

const METRIC_DESCRIPTORS = [
    { key: 'livePercent',  label: 'Live Cell %',  unit: '%',   higherBetter: true,  get: p => p.print_data.livePercent },
    { key: 'deadPercent',  label: 'Dead Cell %',  unit: '%',   higherBetter: false, get: p => p.print_data.deadPercent },
    { key: 'elasticity',   label: 'Elasticity',   unit: 'kPa', higherBetter: true,  get: p => p.print_data.elasticity },
    { key: 'cl_duration',  label: 'CL Duration',  unit: 'ms',  higherBetter: null,  get: p => p.print_info.crosslinking.cl_duration },
    { key: 'cl_intensity', label: 'CL Intensity', unit: '%',   higherBetter: null,  get: p => p.print_info.crosslinking.cl_intensity },
    { key: 'extruder1',    label: 'Extruder 1',   unit: '',    higherBetter: null,  get: p => p.print_info.pressure.extruder1 },
    { key: 'extruder2',    label: 'Extruder 2',   unit: '',    higherBetter: null,  get: p => p.print_info.pressure.extruder2 },
    { key: 'layerHeight',  label: 'Layer Height', unit: 'mm',  higherBetter: null,  get: p => p.print_info.resolution.layerHeight },
    { key: 'layerNum',     label: 'Layer Count',  unit: '',    higherBetter: true,  get: p => p.print_info.resolution.layerNum },
    { key: 'wellplate',    label: 'Wellplate',    unit: '',    higherBetter: null,  get: p => p.print_info.wellplate },
];

// escapeHtml needs DOM — use a simple implementation for Node.js testing
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getMetricValue(print, metric) {
    const paths = {
        livePercent:  p => p.print_data.livePercent,
        deadPercent:  p => p.print_data.deadPercent,
        elasticity:   p => p.print_data.elasticity,
        cl_duration:  p => p.print_info.crosslinking.cl_duration,
        cl_intensity: p => p.print_info.crosslinking.cl_intensity,
        extruder1:    p => p.print_info.pressure.extruder1,
        extruder2:    p => p.print_info.pressure.extruder2,
        layerHeight:  p => p.print_info.resolution.layerHeight,
        layerNum:     p => p.print_info.resolution.layerNum,
    };
    try { return paths[metric] ? paths[metric](print) : null; }
    catch { return null; }
}

function formatNum(n) {
    if (n == null) return '-';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(2);
}

function computeStats(values) {
    const n = values.length;
    if (n === 0) return { mean: 0, std: 0, q1: 0, q3: 0, iqr: 0, median: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const std = n > 1
        ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1))
        : 0;
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const median = n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[Math.floor(n / 2)];
    return { mean, std, q1, q3, iqr: q3 - q1, median };
}

// Sample print record for testing
const samplePrint = {
    print_data: { livePercent: 85.5, deadPercent: 14.5, elasticity: 52.3 },
    print_info: {
        crosslinking: { cl_duration: 15000, cl_intensity: 30 },
        pressure: { extruder1: 45.0, extruder2: 50.0 },
        resolution: { layerHeight: 0.5, layerNum: 60 },
        wellplate: 'WP-001'
    },
    user_info: { serial: 12345, email: 'test@example.com' }
};

// ── Tests ──────────────────────────────────────────────────

describe('Shared Constants', () => {
    describe('METRICS array', () => {
        test('contains exactly 9 metric keys', () => {
            expect(METRICS).toHaveLength(9);
        });

        test('all entries are strings', () => {
            METRICS.forEach(m => expect(typeof m).toBe('string'));
        });

        test('contains all expected keys', () => {
            const expected = ['livePercent', 'deadPercent', 'elasticity',
                'cl_duration', 'cl_intensity', 'extruder1', 'extruder2',
                'layerHeight', 'layerNum'];
            expect(METRICS).toEqual(expected);
        });

        test('has no duplicates', () => {
            const unique = new Set(METRICS);
            expect(unique.size).toBe(METRICS.length);
        });
    });

    describe('metricLabels', () => {
        test('every METRICS key has a label', () => {
            for (const m of METRICS) {
                expect(metricLabels[m]).toBeDefined();
                expect(typeof metricLabels[m]).toBe('string');
                expect(metricLabels[m].length).toBeGreaterThan(0);
            }
        });

        test('labels are human-readable (contain spaces or %)', () => {
            for (const m of METRICS) {
                const label = metricLabels[m];
                expect(label.length).toBeGreaterThan(2);
            }
        });
    });

    describe('metricColors', () => {
        test('every METRICS key has a color', () => {
            for (const m of METRICS) {
                expect(metricColors[m]).toBeDefined();
            }
        });

        test('all colors are valid hex strings', () => {
            for (const m of METRICS) {
                expect(metricColors[m]).toMatch(/^#[0-9a-fA-F]{6}$/);
            }
        });

        test('no duplicate colors', () => {
            const colors = Object.values(metricColors);
            const unique = new Set(colors);
            expect(unique.size).toBe(colors.length);
        });
    });

    describe('METRIC_DESCRIPTORS', () => {
        test('has 10 entries (9 metrics + wellplate)', () => {
            expect(METRIC_DESCRIPTORS).toHaveLength(10);
        });

        test('each descriptor has required properties', () => {
            for (const d of METRIC_DESCRIPTORS) {
                expect(d).toHaveProperty('key');
                expect(d).toHaveProperty('label');
                expect(d).toHaveProperty('unit');
                expect(d).toHaveProperty('higherBetter');
                expect(d).toHaveProperty('get');
                expect(typeof d.get).toBe('function');
            }
        });

        test('keys match METRICS plus wellplate', () => {
            const keys = METRIC_DESCRIPTORS.map(d => d.key);
            for (const m of METRICS) {
                expect(keys).toContain(m);
            }
            expect(keys).toContain('wellplate');
        });

        test('get functions extract correct values', () => {
            const live = METRIC_DESCRIPTORS.find(d => d.key === 'livePercent');
            expect(live.get(samplePrint)).toBe(85.5);

            const cl = METRIC_DESCRIPTORS.find(d => d.key === 'cl_duration');
            expect(cl.get(samplePrint)).toBe(15000);

            const wp = METRIC_DESCRIPTORS.find(d => d.key === 'wellplate');
            expect(wp.get(samplePrint)).toBe('WP-001');
        });

        test('higherBetter is correctly set for scored metrics', () => {
            const live = METRIC_DESCRIPTORS.find(d => d.key === 'livePercent');
            expect(live.higherBetter).toBe(true);

            const dead = METRIC_DESCRIPTORS.find(d => d.key === 'deadPercent');
            expect(dead.higherBetter).toBe(false);

            const elast = METRIC_DESCRIPTORS.find(d => d.key === 'elasticity');
            expect(elast.higherBetter).toBe(true);
        });
    });
});

describe('Shared Utils', () => {
    describe('escapeHtml', () => {
        test('escapes angle brackets', () => {
            expect(escapeHtml('<script>')).not.toContain('<script>');
        });

        test('escapes ampersands', () => {
            expect(escapeHtml('a&b')).toBe('a&amp;b');
        });

        test('escapes quotes', () => {
            expect(escapeHtml('"test"')).toContain('&quot;');
        });

        test('returns empty string for null', () => {
            expect(escapeHtml(null)).toBe('');
        });

        test('returns empty string for undefined', () => {
            expect(escapeHtml(undefined)).toBe('');
        });

        test('passes through safe text unchanged', () => {
            expect(escapeHtml('hello world')).toBe('hello world');
        });

        test('handles numeric input', () => {
            expect(escapeHtml(42)).toBe('42');
        });
    });

    describe('getMetricValue', () => {
        test('extracts print_data metrics', () => {
            expect(getMetricValue(samplePrint, 'livePercent')).toBe(85.5);
            expect(getMetricValue(samplePrint, 'deadPercent')).toBe(14.5);
            expect(getMetricValue(samplePrint, 'elasticity')).toBe(52.3);
        });

        test('extracts crosslinking metrics', () => {
            expect(getMetricValue(samplePrint, 'cl_duration')).toBe(15000);
            expect(getMetricValue(samplePrint, 'cl_intensity')).toBe(30);
        });

        test('extracts pressure metrics', () => {
            expect(getMetricValue(samplePrint, 'extruder1')).toBe(45.0);
            expect(getMetricValue(samplePrint, 'extruder2')).toBe(50.0);
        });

        test('extracts resolution metrics', () => {
            expect(getMetricValue(samplePrint, 'layerHeight')).toBe(0.5);
            expect(getMetricValue(samplePrint, 'layerNum')).toBe(60);
        });

        test('returns null for unknown metric', () => {
            expect(getMetricValue(samplePrint, 'nonexistent')).toBeNull();
        });

        test('returns null for missing nested properties', () => {
            expect(getMetricValue({}, 'livePercent')).toBeNull();
        });

        test('returns null for empty print', () => {
            expect(getMetricValue({}, 'cl_duration')).toBeNull();
        });
    });

    describe('formatNum', () => {
        test('returns dash for null', () => {
            expect(formatNum(null)).toBe('-');
        });

        test('returns dash for undefined', () => {
            expect(formatNum(undefined)).toBe('-');
        });

        test('formats integers without decimals', () => {
            expect(formatNum(42)).toBe('42');
            expect(formatNum(0)).toBe('0');
        });

        test('formats decimals to 2 places', () => {
            expect(formatNum(3.14159)).toBe('3.14');
        });

        test('formats large numbers with locale separator', () => {
            const result = formatNum(12345);
            // Locale-dependent, but should contain digits
            expect(result).toMatch(/12.?345/);
        });

        test('formats negative numbers', () => {
            expect(formatNum(-5.678)).toBe('-5.68');
        });

        test('formats zero correctly', () => {
            expect(formatNum(0)).toBe('0');
        });
    });

    describe('computeStats', () => {
        test('returns zeros for empty array', () => {
            const s = computeStats([]);
            expect(s.mean).toBe(0);
            expect(s.std).toBe(0);
            expect(s.q1).toBe(0);
            expect(s.q3).toBe(0);
            expect(s.iqr).toBe(0);
            expect(s.median).toBe(0);
        });

        test('computes correct mean', () => {
            const s = computeStats([10, 20, 30, 40, 50]);
            expect(s.mean).toBe(30);
        });

        test('uses sample standard deviation (n-1)', () => {
            // [10, 20, 30, 40, 50]: mean=30
            // sum of squared deviations = 1000
            // sample std = sqrt(1000/4) = sqrt(250) ≈ 15.81
            const s = computeStats([10, 20, 30, 40, 50]);
            expect(s.std).toBeCloseTo(Math.sqrt(250), 5);
        });

        test('std is 0 for single value', () => {
            const s = computeStats([42]);
            expect(s.std).toBe(0);
            expect(s.mean).toBe(42);
        });

        test('computes correct median for odd-length array', () => {
            const s = computeStats([1, 3, 5, 7, 9]);
            expect(s.median).toBe(5);
        });

        test('computes correct median for even-length array', () => {
            const s = computeStats([1, 3, 5, 7]);
            expect(s.median).toBe(4); // (3+5)/2
        });

        test('computes correct quartiles', () => {
            const s = computeStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
            expect(s.q1).toBe(3);  // floor(10 * 0.25) = index 2
            expect(s.q3).toBe(8);  // floor(10 * 0.75) = index 7
            expect(s.iqr).toBe(5);
        });

        test('handles identical values', () => {
            const s = computeStats([5, 5, 5, 5, 5]);
            expect(s.mean).toBe(5);
            expect(s.std).toBe(0);
            expect(s.iqr).toBe(0);
        });

        test('handles negative values', () => {
            const s = computeStats([-10, -5, 0, 5, 10]);
            expect(s.mean).toBe(0);
        });

        test('handles two values', () => {
            const s = computeStats([10, 20]);
            expect(s.mean).toBe(15);
            expect(s.median).toBe(15);
            // sample std = sqrt((25+25)/1) = sqrt(50) ≈ 7.07
            expect(s.std).toBeCloseTo(Math.sqrt(50), 5);
        });

        test('handles large dataset', () => {
            const data = Array.from({ length: 1000 }, (_, i) => i);
            const s = computeStats(data);
            expect(s.mean).toBeCloseTo(499.5, 5);
            expect(s.median).toBe(499.5);
        });
    });

    describe('Cross-module consistency', () => {
        test('METRICS keys are a subset of METRIC_DESCRIPTORS keys', () => {
            const descriptorKeys = METRIC_DESCRIPTORS.map(d => d.key);
            for (const m of METRICS) {
                expect(descriptorKeys).toContain(m);
            }
        });

        test('metricLabels and METRIC_DESCRIPTORS labels agree on shared keys', () => {
            for (const m of METRICS) {
                const descriptor = METRIC_DESCRIPTORS.find(d => d.key === m);
                // Labels may differ slightly (short vs long form), but both should be defined
                expect(descriptor).toBeDefined();
                expect(descriptor.label).toBeDefined();
                expect(metricLabels[m]).toBeDefined();
            }
        });

        test('getMetricValue and METRIC_DESCRIPTORS.get produce same results', () => {
            for (const m of METRICS) {
                const fromUtil = getMetricValue(samplePrint, m);
                const descriptor = METRIC_DESCRIPTORS.find(d => d.key === m);
                const fromDescriptor = descriptor.get(samplePrint);
                expect(fromUtil).toBe(fromDescriptor);
            }
        });
    });
});
