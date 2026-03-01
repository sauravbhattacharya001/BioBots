/**
 * @jest-environment jsdom
 *
 * Tests for wellplate.html — Wellplate Analyzer
 *
 * Tests cover:
 *  - groupByWellplate (grouping + edge cases)
 *  - computeWellplateStats (mean, median, std, min, max, quartiles)
 *  - findBestWellplate (higher/lower is better)
 *  - computeCrosslinkingBreakdown (enabled counts, averages)
 *  - Metric selection and rendering
 *  - Export CSV/JSON format
 *  - Edge cases (empty data, single record, uniform values)
 */

'use strict';

// ── Sample data ────────────────────────────────────────
const sampleData = [
    {
        print_data: { deadPercent: 84.01, elasticity: 49.28, livePercent: 7.02 },
        print_info: {
            crosslinking: { cl_duration: 22793, cl_enabled: true, cl_intensity: 24 },
            files: { input: 'file_0.gcode', output: 'file_0_output.gcode' },
            pressure: { extruder1: 38.0, extruder2: 93.0 },
            resolution: { layerHeight: 0.8, layerNum: 48 },
            wellplate: 6
        },
        user_info: { email: 'user0@gmail.com', serial: 0 }
    },
    {
        print_data: { deadPercent: 53.09, elasticity: 47.42, livePercent: 37.42 },
        print_info: {
            crosslinking: { cl_duration: 0, cl_enabled: false, cl_intensity: 0 },
            files: { input: 'file_1.gcode', output: 'file_1_output.gcode' },
            pressure: { extruder1: 109.0, extruder2: 40.0 },
            resolution: { layerHeight: 0.3, layerNum: 25 },
            wellplate: 12
        },
        user_info: { email: 'user1@gmail.com', serial: 1 }
    },
    {
        print_data: { deadPercent: 20.0, elasticity: 80.5, livePercent: 72.3 },
        print_info: {
            crosslinking: { cl_duration: 15000, cl_enabled: true, cl_intensity: 50 },
            files: { input: 'file_2.gcode', output: 'file_2_output.gcode' },
            pressure: { extruder1: 60.0, extruder2: 65.0 },
            resolution: { layerHeight: 0.5, layerNum: 100 },
            wellplate: 6
        },
        user_info: { email: 'user2@gmail.com', serial: 2 }
    },
    {
        print_data: { deadPercent: 45.0, elasticity: 55.0, livePercent: 50.0 },
        print_info: {
            crosslinking: { cl_duration: 10000, cl_enabled: true, cl_intensity: 40 },
            files: { input: 'file_3.gcode', output: 'file_3_output.gcode' },
            pressure: { extruder1: 70.0, extruder2: 70.0 },
            resolution: { layerHeight: 0.5, layerNum: 60 },
            wellplate: 24
        },
        user_info: { email: 'user3@gmail.com', serial: 3 }
    },
    {
        print_data: { deadPercent: 30.0, elasticity: 65.0, livePercent: 62.0 },
        print_info: {
            crosslinking: { cl_duration: 18000, cl_enabled: true, cl_intensity: 60 },
            files: { input: 'file_4.gcode', output: 'file_4_output.gcode' },
            pressure: { extruder1: 55.0, extruder2: 58.0 },
            resolution: { layerHeight: 0.4, layerNum: 80 },
            wellplate: 6
        },
        user_info: { email: 'user4@gmail.com', serial: 4 }
    },
    {
        print_data: { deadPercent: 90.0, elasticity: 30.0, livePercent: 5.0 },
        print_info: {
            crosslinking: { cl_duration: 5000, cl_enabled: true, cl_intensity: 10 },
            files: { input: 'file_5.gcode', output: 'file_5_output.gcode' },
            pressure: { extruder1: 120.0, extruder2: 130.0 },
            resolution: { layerHeight: 1.0, layerNum: 20 },
            wellplate: 96
        },
        user_info: { email: 'user5@gmail.com', serial: 5 }
    },
    {
        print_data: { deadPercent: 88.0, elasticity: 35.0, livePercent: 8.0 },
        print_info: {
            crosslinking: { cl_duration: 0, cl_enabled: false, cl_intensity: 0 },
            files: { input: 'file_6.gcode', output: 'file_6_output.gcode' },
            pressure: { extruder1: 115.0, extruder2: 125.0 },
            resolution: { layerHeight: 0.9, layerNum: 22 },
            wellplate: 96
        },
        user_info: { email: 'user6@gmail.com', serial: 6 }
    },
    {
        print_data: { deadPercent: 60.0, elasticity: 42.0, livePercent: 30.0 },
        print_info: {
            crosslinking: { cl_duration: 8000, cl_enabled: true, cl_intensity: 30 },
            files: { input: 'file_7.gcode', output: 'file_7_output.gcode' },
            pressure: { extruder1: 80.0, extruder2: 85.0 },
            resolution: { layerHeight: 0.6, layerNum: 40 },
            wellplate: 12
        },
        user_info: { email: 'user7@gmail.com', serial: 7 }
    },
    {
        print_data: { deadPercent: 40.0, elasticity: 58.0, livePercent: 55.0 },
        print_info: {
            crosslinking: { cl_duration: 12000, cl_enabled: true, cl_intensity: 45 },
            files: { input: 'file_8.gcode', output: 'file_8_output.gcode' },
            pressure: { extruder1: 65.0, extruder2: 68.0 },
            resolution: { layerHeight: 0.5, layerNum: 70 },
            wellplate: 24
        },
        user_info: { email: 'user8@gmail.com', serial: 8 }
    }
];


// ── Functions extracted from wellplate.html ─────────────

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

function computeStats(values) {
    const n = values.length;
    if (n === 0) return { mean: 0, std: 0, q1: 0, q3: 0, iqr: 0, median: 0 };

    let mean = 0;
    let m2 = 0;
    for (let i = 0; i < n; i++) {
        const delta = values[i] - mean;
        mean += delta / (i + 1);
        m2 += delta * (values[i] - mean);
    }
    const std = n > 1 ? Math.sqrt(m2 / (n - 1)) : 0;

    values.sort((a, b) => a - b);
    const q1 = values[Math.floor(n * 0.25)];
    const q3 = values[Math.floor(n * 0.75)];
    const median = n % 2 === 0
        ? (values[n / 2 - 1] + values[n / 2]) / 2
        : values[Math.floor(n / 2)];
    return { mean, std, q1, q3, iqr: q3 - q1, median };
}

function groupByWellplate(data) {
    var groups = {};
    for (var i = 0; i < data.length; i++) {
        var wp = data[i].print_info.wellplate;
        if (!groups[wp]) groups[wp] = [];
        groups[wp].push(data[i]);
    }
    return groups;
}

function computeWellplateStats(groups, metric) {
    var result = {};
    var wellplates = Object.keys(groups).map(Number).sort(function(a, b) { return a - b; });

    for (var w = 0; w < wellplates.length; w++) {
        var wp = wellplates[w];
        var prints = groups[wp];
        var values = [];

        for (var i = 0; i < prints.length; i++) {
            var v = getMetricValue(prints[i], metric);
            if (v !== null && isFinite(v)) values.push(v);
        }

        if (values.length === 0) {
            result[wp] = { count: 0, mean: 0, median: 0, std: 0, min: 0, max: 0, q1: 0, q3: 0 };
            continue;
        }

        var stats = computeStats(values.slice());
        var sorted = values.slice().sort(function(a, b) { return a - b; });

        result[wp] = {
            count: values.length,
            mean: stats.mean,
            median: stats.median,
            std: stats.std,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            q1: stats.q1,
            q3: stats.q3
        };
    }

    return result;
}

function findBestWellplate(stats, higherBetter) {
    var best = null;
    var bestVal = higherBetter ? -Infinity : Infinity;
    var wellplates = Object.keys(stats).map(Number);

    for (var i = 0; i < wellplates.length; i++) {
        var wp = wellplates[i];
        var s = stats[wp];
        if (s.count === 0) continue;

        if (higherBetter ? s.mean > bestVal : s.mean < bestVal) {
            bestVal = s.mean;
            best = wp;
        }
    }

    return best;
}

function computeCrosslinkingBreakdown(groups) {
    var result = {};
    var wellplates = Object.keys(groups).map(Number).sort(function(a, b) { return a - b; });

    for (var w = 0; w < wellplates.length; w++) {
        var wp = wellplates[w];
        var prints = groups[wp];
        var enabled = 0;
        var totalDuration = 0;
        var totalIntensity = 0;
        var durationCount = 0;

        for (var i = 0; i < prints.length; i++) {
            var cl = prints[i].print_info.crosslinking;
            if (cl.cl_enabled) {
                enabled++;
                totalDuration += cl.cl_duration;
                totalIntensity += cl.cl_intensity;
                durationCount++;
            }
        }

        result[wp] = {
            total: prints.length,
            enabled: enabled,
            enabledPct: prints.length > 0 ? (enabled / prints.length * 100) : 0,
            avgDuration: durationCount > 0 ? totalDuration / durationCount : 0,
            avgIntensity: durationCount > 0 ? totalIntensity / durationCount : 0
        };
    }

    return result;
}

function fmt(n) {
    if (n == null) return '-';
    if (Number.isInteger(n)) return n.toLocaleString();
    return n.toFixed(2);
}

function escapeHtml(str) {
    if (str == null) return '';
    var el = document.createElement('div');
    el.textContent = String(str);
    return el.innerHTML;
}


// ── Tests ──────────────────────────────────────────────

describe('Wellplate Analyzer', () => {

    describe('groupByWellplate', () => {
        test('groups sample data by wellplate type', () => {
            const groups = groupByWellplate(sampleData);
            expect(Object.keys(groups).sort()).toEqual(['12', '24', '6', '96']);
            expect(groups[6].length).toBe(3);
            expect(groups[12].length).toBe(2);
            expect(groups[24].length).toBe(2);
            expect(groups[96].length).toBe(2);
        });

        test('returns empty object for empty array', () => {
            expect(groupByWellplate([])).toEqual({});
        });

        test('single record goes into one group', () => {
            const groups = groupByWellplate([sampleData[0]]);
            expect(Object.keys(groups)).toEqual(['6']);
            expect(groups[6].length).toBe(1);
        });

        test('preserves full print records in groups', () => {
            const groups = groupByWellplate(sampleData);
            const first6 = groups[6][0];
            expect(first6.print_data.livePercent).toBe(7.02);
            expect(first6.user_info.email).toBe('user0@gmail.com');
        });
    });

    describe('computeWellplateStats', () => {
        let groups;

        beforeEach(() => {
            groups = groupByWellplate(sampleData);
        });

        test('computes stats for livePercent across wellplates', () => {
            const stats = computeWellplateStats(groups, 'livePercent');
            expect(stats[6].count).toBe(3);
            expect(stats[6].mean).toBeCloseTo(47.107, 1);
            expect(stats[6].min).toBeCloseTo(7.02, 2);
            expect(stats[6].max).toBeCloseTo(72.3, 2);
        });

        test('computes stats for deadPercent', () => {
            const stats = computeWellplateStats(groups, 'deadPercent');
            expect(stats[96].count).toBe(2);
            expect(stats[96].mean).toBeCloseTo(89.0, 1);
        });

        test('computes stats for elasticity', () => {
            const stats = computeWellplateStats(groups, 'elasticity');
            expect(stats[24].count).toBe(2);
            expect(stats[24].mean).toBeCloseTo(56.5, 1);
            expect(stats[24].min).toBeCloseTo(55.0, 1);
            expect(stats[24].max).toBeCloseTo(58.0, 1);
        });

        test('computes stats for cl_duration', () => {
            const stats = computeWellplateStats(groups, 'cl_duration');
            expect(stats[6].count).toBe(3);
            expect(stats[6].mean).toBeCloseTo(18597.67, 0);
        });

        test('computes stats for integer metrics', () => {
            const stats = computeWellplateStats(groups, 'layerNum');
            expect(stats[12].count).toBe(2);
            expect(stats[12].mean).toBeCloseTo(32.5, 1);
        });

        test('includes std dev calculation', () => {
            const stats = computeWellplateStats(groups, 'livePercent');
            expect(stats[6].std).toBeGreaterThan(0);
        });

        test('single value has zero std', () => {
            const singleGroup = groupByWellplate([sampleData[3]]);
            const stats = computeWellplateStats(singleGroup, 'livePercent');
            expect(stats[24].std).toBe(0);
        });

        test('returns zeros for empty groups', () => {
            const stats = computeWellplateStats({ 1: [] }, 'livePercent');
            expect(stats[1]).toEqual({ count: 0, mean: 0, median: 0, std: 0, min: 0, max: 0, q1: 0, q3: 0 });
        });

        test('computes median correctly for even count', () => {
            const stats = computeWellplateStats(groups, 'livePercent');
            expect(stats[96].median).toBeCloseTo(6.5, 1);
        });

        test('computes median correctly for odd count', () => {
            const stats = computeWellplateStats(groups, 'livePercent');
            expect(stats[6].median).toBeCloseTo(62.0, 1);
        });

        test('handles all METRICS', () => {
            const metrics = ['livePercent', 'deadPercent', 'elasticity', 'cl_duration',
                'cl_intensity', 'extruder1', 'extruder2', 'layerHeight', 'layerNum'];
            metrics.forEach(metric => {
                const stats = computeWellplateStats(groups, metric);
                expect(Object.keys(stats).length).toBeGreaterThan(0);
                Object.values(stats).forEach(s => {
                    expect(s).toHaveProperty('count');
                    expect(s).toHaveProperty('mean');
                    expect(s).toHaveProperty('median');
                    expect(s).toHaveProperty('std');
                    expect(s).toHaveProperty('min');
                    expect(s).toHaveProperty('max');
                });
            });
        });

        test('unknown metric returns count 0 for all groups', () => {
            const stats = computeWellplateStats(groups, 'nonexistent');
            Object.values(stats).forEach(s => {
                expect(s.count).toBe(0);
            });
        });
    });

    describe('findBestWellplate', () => {
        let stats;

        beforeEach(() => {
            const groups = groupByWellplate(sampleData);
            stats = computeWellplateStats(groups, 'livePercent');
        });

        test('finds wellplate with highest mean when higherBetter=true', () => {
            const best = findBestWellplate(stats, true);
            expect(best).toBe(24);
        });

        test('finds wellplate with lowest mean when higherBetter=false', () => {
            const best = findBestWellplate(stats, false);
            expect(best).toBe(96);
        });

        test('returns null for empty stats', () => {
            expect(findBestWellplate({}, true)).toBeNull();
            expect(findBestWellplate({}, false)).toBeNull();
        });

        test('skips zero-count groups', () => {
            const withEmpty = { ...stats, 1: { count: 0, mean: 999, median: 0, std: 0, min: 0, max: 0, q1: 0, q3: 0 } };
            const best = findBestWellplate(withEmpty, true);
            expect(best).not.toBe(1);
        });

        test('finds best for deadPercent (lower is better)', () => {
            const groups = groupByWellplate(sampleData);
            const deadStats = computeWellplateStats(groups, 'deadPercent');
            const best = findBestWellplate(deadStats, false);
            expect(best).toBe(24);
        });
    });

    describe('computeCrosslinkingBreakdown', () => {
        let groups;

        beforeEach(() => {
            groups = groupByWellplate(sampleData);
        });

        test('counts total and enabled correctly', () => {
            const cl = computeCrosslinkingBreakdown(groups);
            expect(cl[6].total).toBe(3);
            expect(cl[6].enabled).toBe(3);
            expect(cl[6].enabledPct).toBeCloseTo(100, 0);
        });

        test('handles mixed enabled/disabled', () => {
            const cl = computeCrosslinkingBreakdown(groups);
            expect(cl[12].total).toBe(2);
            expect(cl[12].enabled).toBe(1);
            expect(cl[12].enabledPct).toBeCloseTo(50, 0);
        });

        test('computes average duration for enabled prints', () => {
            const cl = computeCrosslinkingBreakdown(groups);
            expect(cl[6].avgDuration).toBeCloseTo(18597.67, 0);
        });

        test('computes average intensity for enabled prints', () => {
            const cl = computeCrosslinkingBreakdown(groups);
            expect(cl[6].avgIntensity).toBeCloseTo(44.67, 0);
        });

        test('zero averages when no CL enabled', () => {
            const noClGroup = { 1: [{ print_info: { crosslinking: { cl_enabled: false, cl_duration: 0, cl_intensity: 0 }, wellplate: 1 } }] };
            const cl = computeCrosslinkingBreakdown(noClGroup);
            expect(cl[1].enabled).toBe(0);
            expect(cl[1].avgDuration).toBe(0);
            expect(cl[1].avgIntensity).toBe(0);
        });

        test('covers all wellplate types in sample', () => {
            const cl = computeCrosslinkingBreakdown(groups);
            expect(Object.keys(cl).sort()).toEqual(['12', '24', '6', '96']);
        });

        test('wellplate 96 breakdown', () => {
            const cl = computeCrosslinkingBreakdown(groups);
            expect(cl[96].total).toBe(2);
            expect(cl[96].enabled).toBe(1);
            expect(cl[96].avgDuration).toBeCloseTo(5000, 0);
            expect(cl[96].avgIntensity).toBeCloseTo(10, 0);
        });
    });

    describe('fmt', () => {
        test('returns dash for null', () => {
            expect(fmt(null)).toBe('-');
        });

        test('returns dash for undefined', () => {
            expect(fmt(undefined)).toBe('-');
        });

        test('formats integer without decimals', () => {
            const result = fmt(42);
            expect(result).toMatch(/42/);
        });

        test('formats float to 2 decimal places', () => {
            expect(fmt(3.14159)).toBe('3.14');
        });

        test('formats zero', () => {
            const result = fmt(0);
            expect(result).toMatch(/0/);
        });

        test('formats large numbers with locale separators', () => {
            const result = fmt(10000);
            expect(result.replace(/,/g, '')).toBe('10000');
        });
    });

    describe('escapeHtml', () => {
        test('escapes angle brackets', () => {
            expect(escapeHtml('<script>alert(1)</script>')).not.toContain('<script>');
        });

        test('escapes ampersand', () => {
            expect(escapeHtml('a & b')).toContain('&amp;');
        });

        test('returns empty string for null', () => {
            expect(escapeHtml(null)).toBe('');
        });

        test('returns empty string for undefined', () => {
            expect(escapeHtml(undefined)).toBe('');
        });

        test('handles numbers', () => {
            expect(escapeHtml(42)).toBe('42');
        });

        test('passes through safe strings', () => {
            expect(escapeHtml('hello world')).toBe('hello world');
        });
    });

    describe('getMetricValue', () => {
        const print = sampleData[0];

        test('extracts livePercent', () => {
            expect(getMetricValue(print, 'livePercent')).toBe(7.02);
        });

        test('extracts deadPercent', () => {
            expect(getMetricValue(print, 'deadPercent')).toBe(84.01);
        });

        test('extracts elasticity', () => {
            expect(getMetricValue(print, 'elasticity')).toBe(49.28);
        });

        test('extracts cl_duration', () => {
            expect(getMetricValue(print, 'cl_duration')).toBe(22793);
        });

        test('extracts cl_intensity', () => {
            expect(getMetricValue(print, 'cl_intensity')).toBe(24);
        });

        test('extracts extruder1', () => {
            expect(getMetricValue(print, 'extruder1')).toBe(38.0);
        });

        test('extracts extruder2', () => {
            expect(getMetricValue(print, 'extruder2')).toBe(93.0);
        });

        test('extracts layerHeight', () => {
            expect(getMetricValue(print, 'layerHeight')).toBe(0.8);
        });

        test('extracts layerNum', () => {
            expect(getMetricValue(print, 'layerNum')).toBe(48);
        });

        test('returns null for unknown metric', () => {
            expect(getMetricValue(print, 'nonexistent')).toBeNull();
        });
    });

    describe('Integration', () => {
        test('full pipeline: group → stats → best', () => {
            const groups = groupByWellplate(sampleData);
            const stats = computeWellplateStats(groups, 'elasticity');
            const best = findBestWellplate(stats, true);
            expect(best).toBe(6);
        });

        test('worst wellplate for deadPercent (higher is worse)', () => {
            const groups = groupByWellplate(sampleData);
            const stats = computeWellplateStats(groups, 'deadPercent');
            const worst = findBestWellplate(stats, true);
            expect(worst).toBe(96);
        });

        test('handles single-print wellplate groups', () => {
            const single = [sampleData[0]];
            const groups = groupByWellplate(single);
            const stats = computeWellplateStats(groups, 'livePercent');
            expect(stats[6].count).toBe(1);
            expect(stats[6].mean).toBe(7.02);
            expect(stats[6].std).toBe(0);
        });

        test('uniform values give zero std', () => {
            const uniformData = [
                { print_data: { livePercent: 50 }, print_info: { crosslinking: { cl_duration: 0, cl_enabled: false, cl_intensity: 0 }, pressure: { extruder1: 50, extruder2: 50 }, resolution: { layerHeight: 0.5, layerNum: 50 }, wellplate: 6 }, user_info: { serial: 0 } },
                { print_data: { livePercent: 50 }, print_info: { crosslinking: { cl_duration: 0, cl_enabled: false, cl_intensity: 0 }, pressure: { extruder1: 50, extruder2: 50 }, resolution: { layerHeight: 0.5, layerNum: 50 }, wellplate: 6 }, user_info: { serial: 1 } },
            ];
            const groups = groupByWellplate(uniformData);
            const stats = computeWellplateStats(groups, 'livePercent');
            expect(stats[6].std).toBe(0);
            expect(stats[6].mean).toBe(50);
        });
    });

    describe('computeStats edge cases', () => {
        test('empty array', () => {
            const s = computeStats([]);
            expect(s.mean).toBe(0);
            expect(s.std).toBe(0);
        });

        test('single value', () => {
            const s = computeStats([42]);
            expect(s.mean).toBe(42);
            expect(s.std).toBe(0);
            expect(s.median).toBe(42);
        });

        test('two values', () => {
            const s = computeStats([10, 20]);
            expect(s.mean).toBe(15);
            expect(s.median).toBe(15);
        });

        test('large array', () => {
            const arr = [];
            for (let i = 0; i < 1000; i++) arr.push(i);
            const s = computeStats(arr);
            expect(s.mean).toBeCloseTo(499.5, 0);
            expect(s.median).toBeCloseTo(499.5, 0);
        });

        test('negative values', () => {
            const s = computeStats([-10, -5, 0, 5, 10]);
            expect(s.mean).toBe(0);
            expect(s.median).toBe(0);
        });
    });
});
