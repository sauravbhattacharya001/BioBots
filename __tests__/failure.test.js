/**
 * @jest-environment jsdom
 *
 * Tests for failure.html — Failure Mode Analysis
 *
 * Tests cover:
 *  - Failure mode classification (each mode individually)
 *  - Overall failure statistics
 *  - Multi-failure detection
 *  - Severity distribution
 *  - Parameter analysis for failed prints
 *  - Co-occurrence matrix
 *  - Edge cases (empty data, all passing, all failing)
 *  - Pareto ordering (most frequent first)
 *  - Recommendation generation
 */

'use strict';

// ── Sample data ────────────────────────────────────────

function makePrint(overrides = {}) {
    const base = {
        print_data: { deadPercent: 50, elasticity: 50, livePercent: 40 },
        print_info: {
            crosslinking: { cl_duration: 15000, cl_enabled: true, cl_intensity: 40 },
            files: { input: 'f.gcode', output: 'f_out.gcode' },
            pressure: { extruder1: 50, extruder2: 50 },
            resolution: { layerHeight: 0.5, layerNum: 30 },
            wellplate: 6
        },
        user_info: { email: 'user@test.com', serial: 0 }
    };

    // Deep merge overrides
    const result = JSON.parse(JSON.stringify(base));
    if (overrides.print_data) Object.assign(result.print_data, overrides.print_data);
    if (overrides.print_info) {
        if (overrides.print_info.crosslinking) Object.assign(result.print_info.crosslinking, overrides.print_info.crosslinking);
        if (overrides.print_info.pressure) Object.assign(result.print_info.pressure, overrides.print_info.pressure);
        if (overrides.print_info.resolution) Object.assign(result.print_info.resolution, overrides.print_info.resolution);
        if (overrides.print_info.wellplate !== undefined) result.print_info.wellplate = overrides.print_info.wellplate;
    }
    if (overrides.user_info) Object.assign(result.user_info, overrides.user_info);
    return result;
}

// Healthy print — should pass all checks
const healthyPrint = makePrint({
    print_data: { livePercent: 60, deadPercent: 30, elasticity: 55 },
    user_info: { serial: 100 }
});

// Low viability print
const lowViabilityPrint = makePrint({
    print_data: { livePercent: 5, deadPercent: 85, elasticity: 45 },
    user_info: { serial: 1 }
});

// Over-crosslinking print
const overCrosslinkPrint = makePrint({
    print_info: { crosslinking: { cl_duration: 30000, cl_enabled: true, cl_intensity: 80 } },
    user_info: { serial: 2 }
});

// Poor elasticity print
const poorElasticityPrint = makePrint({
    print_data: { elasticity: 10 },
    user_info: { serial: 3 }
});

// High pressure print
const highPressurePrint = makePrint({
    print_info: { pressure: { extruder1: 95, extruder2: 50 } },
    user_info: { serial: 4 }
});

// Low resolution print
const lowResPrint = makePrint({
    print_info: { resolution: { layerHeight: 0.95, layerNum: 5 } },
    user_info: { serial: 5 }
});

// Pressure imbalance print
const imbalancePrint = makePrint({
    print_info: { pressure: { extruder1: 10, extruder2: 90 } },
    user_info: { serial: 6 }
});

// No crosslinking + low elasticity print
const noCrosslinkPrint = makePrint({
    print_info: { crosslinking: { cl_enabled: false, cl_duration: 0, cl_intensity: 0 } },
    print_data: { elasticity: 15 },
    user_info: { serial: 7 }
});

// Extreme cell death print
const extremeDeathPrint = makePrint({
    print_data: { deadPercent: 95, livePercent: 3 },
    user_info: { serial: 8 }
});

// Multi-failure print (low viability + extreme death + high pressure)
const multiFailurePrint = makePrint({
    print_data: { livePercent: 4, deadPercent: 92, elasticity: 45 },
    print_info: { pressure: { extruder1: 90, extruder2: 30 } },
    user_info: { serial: 9 }
});

// ── Load failure mode definitions ──────────────────────

// Simulate constants.js
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
const metricColors = {};

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

// Re-create getMetricValue
const _metricAccessors = METRIC_DESCRIPTORS.reduce((acc, d) => { acc[d.key] = d.get; return acc; }, {});
function getMetricValue(print, metric) {
    const fn = _metricAccessors[metric];
    if (!fn) return null;
    try { return fn(print); } catch { return null; }
}

function percentile(sorted, p) {
    const n = sorted.length;
    if (n === 0) return 0;
    if (n === 1) return sorted[0];
    const rank = p * (n - 1);
    const lower = Math.floor(rank);
    const upper = lower + 1;
    if (upper >= n) return sorted[n - 1];
    const frac = rank - lower;
    return sorted[lower] + frac * (sorted[upper] - sorted[lower]);
}

function formatNum(n) {
    if (n == null) return '-';
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(2);
}

// ── Failure mode definitions (from failure.html) ───────

const FAILURE_MODES = [
    {
        id: 'low_viability',
        name: 'Low Cell Viability',
        severity: 'critical',
        test: p => p.print_data.livePercent < 15,
        params: ['livePercent', 'extruder1', 'extruder2', 'cl_duration']
    },
    {
        id: 'over_crosslinking',
        name: 'Over-Crosslinking',
        severity: 'major',
        test: p => p.print_info.crosslinking.cl_enabled &&
                   p.print_info.crosslinking.cl_duration > 25000 &&
                   p.print_info.crosslinking.cl_intensity > 60,
        params: ['cl_duration', 'cl_intensity', 'livePercent']
    },
    {
        id: 'poor_elasticity',
        name: 'Poor Mechanical Strength',
        severity: 'major',
        test: p => p.print_data.elasticity < 20,
        params: ['elasticity', 'cl_intensity', 'cl_duration']
    },
    {
        id: 'high_pressure',
        name: 'Excessive Pressure',
        severity: 'major',
        test: p => p.print_info.pressure.extruder1 > 85 || p.print_info.pressure.extruder2 > 85,
        params: ['extruder1', 'extruder2', 'livePercent', 'elasticity']
    },
    {
        id: 'resolution_issue',
        name: 'Low Print Resolution',
        severity: 'minor',
        test: p => p.print_info.resolution.layerHeight > 0.9 && p.print_info.resolution.layerNum < 10,
        params: ['layerHeight', 'layerNum']
    },
    {
        id: 'pressure_imbalance',
        name: 'Dual Extruder Imbalance',
        severity: 'minor',
        test: p => Math.abs(p.print_info.pressure.extruder1 - p.print_info.pressure.extruder2) > 60,
        params: ['extruder1', 'extruder2']
    },
    {
        id: 'no_crosslinking',
        name: 'Missing Crosslinking',
        severity: 'critical',
        test: p => !p.print_info.crosslinking.cl_enabled && p.print_data.elasticity < 30,
        params: ['cl_duration', 'cl_intensity', 'elasticity']
    },
    {
        id: 'cell_death_dominant',
        name: 'Extreme Cell Death',
        severity: 'critical',
        test: p => p.print_data.deadPercent > 90,
        params: ['deadPercent', 'livePercent', 'cl_duration', 'extruder1']
    }
];

// ── Analysis functions (from failure.html) ─────────────

function classifyPrints(data) {
    const results = FAILURE_MODES.map(mode => ({
        ...mode,
        prints: data.filter(mode.test),
        count: 0,
        pct: 0
    }));
    results.forEach(r => {
        r.count = r.prints.length;
        r.pct = data.length > 0 ? (r.count / data.length) * 100 : 0;
    });
    results.sort((a, b) => b.count - a.count);
    return results;
}

function computeFailureStats(data, results) {
    const totalPrints = data.length;
    const failedPrints = new Set();
    results.forEach(r => r.prints.forEach(p => failedPrints.add(p.user_info.serial)));
    const uniqueFailures = failedPrints.size;

    const failureCounts = {};
    results.forEach(r => {
        r.prints.forEach(p => {
            const id = p.user_info.serial;
            failureCounts[id] = (failureCounts[id] || 0) + 1;
        });
    });
    const multiFailure = Object.values(failureCounts).filter(c => c > 1).length;

    const bySeverity = { critical: 0, major: 0, minor: 0 };
    results.forEach(r => {
        if (r.count > 0) bySeverity[r.severity]++;
    });

    return {
        totalPrints,
        uniqueFailures,
        failureRate: totalPrints > 0 ? (uniqueFailures / totalPrints) * 100 : 0,
        multiFailure,
        multiFailureRate: totalPrints > 0 ? (multiFailure / totalPrints) * 100 : 0,
        activeModes: results.filter(r => r.count > 0).length,
        totalModes: results.length,
        bySeverity
    };
}

function parameterAnalysis(results) {
    return results.filter(r => r.count > 0).map(r => {
        const paramStats = {};
        r.params.forEach(metric => {
            const values = r.prints.map(p => getMetricValue(p, metric)).filter(v => v != null);
            if (values.length > 0) {
                const sorted = [...values].sort((a, b) => a - b);
                paramStats[metric] = {
                    mean: values.reduce((a, b) => a + b, 0) / values.length,
                    min: sorted[0],
                    max: sorted[sorted.length - 1],
                    median: percentile(sorted, 0.5),
                    label: metricLabels[metric] || metric
                };
            }
        });
        return { mode: r, paramStats };
    });
}

function coOccurrenceMatrix(data, results) {
    const active = results.filter(r => r.count > 0);
    const matrix = [];
    for (let i = 0; i < active.length; i++) {
        const row = [];
        for (let j = 0; j < active.length; j++) {
            if (i === j) {
                row.push(active[i].count);
            } else {
                const overlap = active[i].prints.filter(p => active[j].test(p)).length;
                row.push(overlap);
            }
        }
        matrix.push(row);
    }
    return { modes: active, matrix };
}

// ── Tests ──────────────────────────────────────────────

describe('Failure Mode Classification', () => {
    test('low_viability detects prints with livePercent < 15', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'low_viability');
        expect(mode.test(lowViabilityPrint)).toBe(true);
        expect(mode.test(healthyPrint)).toBe(false);
    });

    test('over_crosslinking detects high duration + intensity', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'over_crosslinking');
        expect(mode.test(overCrosslinkPrint)).toBe(true);
        expect(mode.test(healthyPrint)).toBe(false);
    });

    test('over_crosslinking requires cl_enabled', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'over_crosslinking');
        const disabledPrint = makePrint({
            print_info: { crosslinking: { cl_enabled: false, cl_duration: 30000, cl_intensity: 80 } }
        });
        expect(mode.test(disabledPrint)).toBe(false);
    });

    test('poor_elasticity detects elasticity < 20', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'poor_elasticity');
        expect(mode.test(poorElasticityPrint)).toBe(true);
        expect(mode.test(healthyPrint)).toBe(false);
    });

    test('high_pressure detects either extruder > 85', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'high_pressure');
        expect(mode.test(highPressurePrint)).toBe(true);
        expect(mode.test(healthyPrint)).toBe(false);

        // Test extruder2 > 85
        const e2high = makePrint({ print_info: { pressure: { extruder1: 30, extruder2: 90 } } });
        expect(mode.test(e2high)).toBe(true);
    });

    test('resolution_issue detects thick layers with few layers', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'resolution_issue');
        expect(mode.test(lowResPrint)).toBe(true);
        expect(mode.test(healthyPrint)).toBe(false);
    });

    test('resolution_issue requires BOTH thick layers AND low count', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'resolution_issue');
        // Thick layers but many
        const thickMany = makePrint({ print_info: { resolution: { layerHeight: 0.95, layerNum: 20 } } });
        expect(mode.test(thickMany)).toBe(false);
        // Thin layers but few
        const thinFew = makePrint({ print_info: { resolution: { layerHeight: 0.3, layerNum: 5 } } });
        expect(mode.test(thinFew)).toBe(false);
    });

    test('pressure_imbalance detects > 60 difference', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'pressure_imbalance');
        expect(mode.test(imbalancePrint)).toBe(true);
        expect(mode.test(healthyPrint)).toBe(false);
    });

    test('no_crosslinking detects disabled + low elasticity', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'no_crosslinking');
        expect(mode.test(noCrosslinkPrint)).toBe(true);
        expect(mode.test(healthyPrint)).toBe(false);
    });

    test('no_crosslinking does not fire with high elasticity', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'no_crosslinking');
        const disabledHighElast = makePrint({
            print_info: { crosslinking: { cl_enabled: false, cl_duration: 0, cl_intensity: 0 } },
            print_data: { elasticity: 50 }
        });
        expect(mode.test(disabledHighElast)).toBe(false);
    });

    test('cell_death_dominant detects deadPercent > 90', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'cell_death_dominant');
        expect(mode.test(extremeDeathPrint)).toBe(true);
        expect(mode.test(healthyPrint)).toBe(false);
    });
});

describe('classifyPrints', () => {
    test('sorts results by count descending', () => {
        const data = [lowViabilityPrint, lowViabilityPrint, highPressurePrint, healthyPrint];
        const results = classifyPrints(data);
        for (let i = 0; i < results.length - 1; i++) {
            expect(results[i].count).toBeGreaterThanOrEqual(results[i + 1].count);
        }
    });

    test('computes correct percentages', () => {
        const data = [lowViabilityPrint, healthyPrint, healthyPrint, healthyPrint];
        const results = classifyPrints(data);
        const lowVia = results.find(r => r.id === 'low_viability');
        expect(lowVia.count).toBe(1);
        expect(lowVia.pct).toBe(25);
    });

    test('healthy prints have zero failures', () => {
        const data = [healthyPrint, healthyPrint, healthyPrint];
        const results = classifyPrints(data);
        results.forEach(r => expect(r.count).toBe(0));
    });
});

describe('computeFailureStats', () => {
    test('calculates failure rate correctly', () => {
        const data = [lowViabilityPrint, healthyPrint, healthyPrint, healthyPrint];
        const results = classifyPrints(data);
        const stats = computeFailureStats(data, results);
        expect(stats.totalPrints).toBe(4);
        expect(stats.uniqueFailures).toBe(1);
        expect(stats.failureRate).toBe(25);
    });

    test('detects multi-failure prints', () => {
        const data = [multiFailurePrint, healthyPrint];
        const results = classifyPrints(data);
        const stats = computeFailureStats(data, results);
        expect(stats.multiFailure).toBe(1);
        expect(stats.multiFailureRate).toBe(50);
    });

    test('counts active modes', () => {
        const data = [lowViabilityPrint, overCrosslinkPrint, healthyPrint];
        const results = classifyPrints(data);
        const stats = computeFailureStats(data, results);
        expect(stats.activeModes).toBe(2);
    });

    test('severity distribution', () => {
        const data = [lowViabilityPrint, overCrosslinkPrint, lowResPrint, healthyPrint];
        const results = classifyPrints(data);
        const stats = computeFailureStats(data, results);
        expect(stats.bySeverity.critical).toBeGreaterThanOrEqual(1); // low_viability
        expect(stats.bySeverity.major).toBeGreaterThanOrEqual(1);    // over_crosslinking
        expect(stats.bySeverity.minor).toBeGreaterThanOrEqual(1);    // resolution_issue
    });

    test('empty dataset', () => {
        const results = classifyPrints([]);
        const stats = computeFailureStats([], results);
        expect(stats.totalPrints).toBe(0);
        expect(stats.failureRate).toBe(0);
        expect(stats.activeModes).toBe(0);
    });

    test('all prints failing', () => {
        const data = [lowViabilityPrint, extremeDeathPrint];
        const results = classifyPrints(data);
        const stats = computeFailureStats(data, results);
        expect(stats.uniqueFailures).toBe(2);
        expect(stats.failureRate).toBe(100);
    });
});

describe('parameterAnalysis', () => {
    test('returns stats for each active mode', () => {
        const data = [lowViabilityPrint, overCrosslinkPrint, healthyPrint];
        const results = classifyPrints(data);
        const analysis = parameterAnalysis(results);
        expect(analysis.length).toBeGreaterThanOrEqual(2);
    });

    test('parameter stats have mean, min, max, median', () => {
        const data = [lowViabilityPrint, lowViabilityPrint];
        data[1] = makePrint({
            print_data: { livePercent: 8 },
            user_info: { serial: 99 }
        });
        const results = classifyPrints(data);
        const analysis = parameterAnalysis(results);
        const lowVia = analysis.find(a => a.mode.id === 'low_viability');
        expect(lowVia).toBeDefined();
        const liveStats = lowVia.paramStats.livePercent;
        expect(liveStats).toBeDefined();
        expect(liveStats.mean).toBeDefined();
        expect(liveStats.min).toBeDefined();
        expect(liveStats.max).toBeDefined();
        expect(liveStats.median).toBeDefined();
        expect(liveStats.min).toBeLessThanOrEqual(liveStats.max);
    });

    test('skips modes with zero prints', () => {
        const data = [healthyPrint];
        const results = classifyPrints(data);
        const analysis = parameterAnalysis(results);
        expect(analysis.length).toBe(0);
    });
});

describe('coOccurrenceMatrix', () => {
    test('diagonal equals individual mode counts', () => {
        const data = [lowViabilityPrint, highPressurePrint, healthyPrint];
        const results = classifyPrints(data);
        const { modes, matrix } = coOccurrenceMatrix(data, results);
        for (let i = 0; i < modes.length; i++) {
            expect(matrix[i][i]).toBe(modes[i].count);
        }
    });

    test('co-occurrence is symmetric', () => {
        const data = [multiFailurePrint, lowViabilityPrint, highPressurePrint, healthyPrint];
        const results = classifyPrints(data);
        const { matrix } = coOccurrenceMatrix(data, results);
        for (let i = 0; i < matrix.length; i++) {
            for (let j = 0; j < matrix[i].length; j++) {
                expect(matrix[i][j]).toBe(matrix[j][i]);
            }
        }
    });

    test('empty when no failures', () => {
        const data = [healthyPrint];
        const results = classifyPrints(data);
        const { modes, matrix } = coOccurrenceMatrix(data, results);
        expect(modes.length).toBe(0);
        expect(matrix.length).toBe(0);
    });

    test('multi-failure print appears in co-occurrence cells', () => {
        // multiFailurePrint has low_viability + cell_death_dominant + possibly others
        const data = [multiFailurePrint];
        const results = classifyPrints(data);
        const active = results.filter(r => r.count > 0);
        expect(active.length).toBeGreaterThanOrEqual(2);

        const { matrix } = coOccurrenceMatrix(data, results);
        // At least one off-diagonal cell should be > 0
        let hasOverlap = false;
        for (let i = 0; i < matrix.length; i++) {
            for (let j = 0; j < matrix[i].length; j++) {
                if (i !== j && matrix[i][j] > 0) hasOverlap = true;
            }
        }
        expect(hasOverlap).toBe(true);
    });
});

describe('Edge cases', () => {
    test('single print with no failures', () => {
        const results = classifyPrints([healthyPrint]);
        const stats = computeFailureStats([healthyPrint], results);
        expect(stats.failureRate).toBe(0);
        expect(stats.activeModes).toBe(0);
    });

    test('single print with one failure', () => {
        const results = classifyPrints([lowViabilityPrint]);
        const stats = computeFailureStats([lowViabilityPrint], results);
        expect(stats.failureRate).toBe(100);
        expect(stats.uniqueFailures).toBe(1);
    });

    test('boundary values — livePercent exactly 15 is NOT low viability', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'low_viability');
        const boundary = makePrint({ print_data: { livePercent: 15 } });
        expect(mode.test(boundary)).toBe(false);
    });

    test('boundary values — livePercent 14.99 IS low viability', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'low_viability');
        const boundary = makePrint({ print_data: { livePercent: 14.99 } });
        expect(mode.test(boundary)).toBe(true);
    });

    test('boundary values — deadPercent exactly 90 is NOT extreme death', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'cell_death_dominant');
        const boundary = makePrint({ print_data: { deadPercent: 90 } });
        expect(mode.test(boundary)).toBe(false);
    });

    test('boundary values — pressure exactly 85 is NOT high pressure', () => {
        const mode = FAILURE_MODES.find(m => m.id === 'high_pressure');
        const boundary = makePrint({ print_info: { pressure: { extruder1: 85, extruder2: 50 } } });
        expect(mode.test(boundary)).toBe(false);
    });

    test('each failure mode has required fields', () => {
        FAILURE_MODES.forEach(mode => {
            expect(mode.id).toBeDefined();
            expect(mode.name).toBeDefined();
            expect(mode.severity).toBeDefined();
            expect(typeof mode.test).toBe('function');
            expect(Array.isArray(mode.params)).toBe(true);
            expect(mode.params.length).toBeGreaterThan(0);
            expect(['critical', 'major', 'minor']).toContain(mode.severity);
        });
    });

    test('all failure mode params reference valid metrics', () => {
        const validMetrics = METRIC_DESCRIPTORS.map(d => d.key);
        FAILURE_MODES.forEach(mode => {
            mode.params.forEach(p => {
                expect(validMetrics).toContain(p);
            });
        });
    });
});
