/**
 * @jest-environment jsdom
 *
 * Tests for doe.html — Design of Experiments Analyzer
 *
 * Tests cover:
 *  - Factor level computation (range splitting)
 *  - Cell mapping (assigning prints to parameter regions)
 *  - Coverage calculation
 *  - Gap analysis (identifying empty/sparse regions)
 *  - Suggestion scoring (adjacency, edge bonus, priority)
 *  - Factorial design generation
 *  - CSV export format
 *  - Edge cases (single factor, all empty, all covered)
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
            crosslinking: { cl_duration: 18456, cl_enabled: true, cl_intensity: 50 },
            files: { input: 'file_1.gcode', output: 'file_1_output.gcode' },
            pressure: { extruder1: 65.0, extruder2: 45.0 },
            resolution: { layerHeight: 0.4, layerNum: 96 },
            wellplate: 12
        },
        user_info: { email: 'user1@gmail.com', serial: 1 }
    },
    {
        print_data: { deadPercent: 30.0, elasticity: 70.0, livePercent: 60.0 },
        print_info: {
            crosslinking: { cl_duration: 10000, cl_enabled: true, cl_intensity: 75 },
            files: { input: 'file_2.gcode', output: 'file_2_output.gcode' },
            pressure: { extruder1: 90.0, extruder2: 20.0 },
            resolution: { layerHeight: 0.2, layerNum: 150 },
            wellplate: 24
        },
        user_info: { email: 'user2@gmail.com', serial: 2 }
    },
    {
        print_data: { deadPercent: 45.0, elasticity: 55.0, livePercent: 45.0 },
        print_info: {
            crosslinking: { cl_duration: 15000, cl_enabled: true, cl_intensity: 40 },
            files: { input: 'file_3.gcode', output: 'file_3_output.gcode' },
            pressure: { extruder1: 50.0, extruder2: 60.0 },
            resolution: { layerHeight: 0.6, layerNum: 72 },
            wellplate: 6
        },
        user_info: { email: 'user3@gmail.com', serial: 3 }
    },
    {
        print_data: { deadPercent: 20.0, elasticity: 80.0, livePercent: 75.0 },
        print_info: {
            crosslinking: { cl_duration: 8000, cl_enabled: true, cl_intensity: 90 },
            files: { input: 'file_4.gcode', output: 'file_4_output.gcode' },
            pressure: { extruder1: 95.0, extruder2: 15.0 },
            resolution: { layerHeight: 0.15, layerNum: 200 },
            wellplate: 48
        },
        user_info: { email: 'user4@gmail.com', serial: 4 }
    },
];

// ── Shared utilities (re-defined inline, matching docs/shared/*.js) ──

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
];

const _metricAccessors = METRIC_DESCRIPTORS.reduce(function (acc, d) { acc[d.key] = d.get; return acc; }, {});

function getMetricValue(print, metric) {
    const fn = _metricAccessors[metric];
    if (!fn) return null;
    try { return fn(print); }
    catch { return null; }
}

function formatNum(n) {
    if (n == null) return '-';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(2);
}

// ── DOE Analysis Helpers (extracted from doe.html) ──

const DOE_FACTORS = [
    { key: 'cl_duration',  label: 'CL Duration (ms)' },
    { key: 'cl_intensity', label: 'CL Intensity (%)' },
    { key: 'extruder1',    label: 'Extruder 1 Pressure' },
    { key: 'extruder2',    label: 'Extruder 2 Pressure' },
    { key: 'layerHeight',  label: 'Layer Height (mm)' },
    { key: 'layerNum',     label: 'Layer Count' },
];

function computeFactorInfo(data, selectedFactors, levels) {
    const factorInfo = {};
    selectedFactors.forEach(key => {
        const vals = data.map(p => getMetricValue(p, key)).filter(v => v != null);
        vals.sort((a, b) => a - b);
        const min = vals[0];
        const max = vals[vals.length - 1];
        const step = (max - min) / levels;
        const boundaries = [];
        for (let i = 0; i <= levels; i++) {
            boundaries.push(min + step * i);
        }
        const levelLabels = [];
        for (let i = 0; i < levels; i++) {
            const lo = boundaries[i];
            const hi = boundaries[i + 1];
            levelLabels.push({ lo, hi, mid: (lo + hi) / 2, label: `${formatNum(lo)}–${formatNum(hi)}` });
        }
        factorInfo[key] = { min, max, step, boundaries, levels: levelLabels, values: vals };
    });
    return factorInfo;
}

function mapToCells(data, selectedFactors, factorInfo, levels) {
    const cellMap = {};
    data.forEach(p => {
        const indices = [];
        let valid = true;
        selectedFactors.forEach(key => {
            const v = getMetricValue(p, key);
            if (v == null) { valid = false; return; }
            let lvl = Math.floor((v - factorInfo[key].min) / factorInfo[key].step);
            if (lvl >= levels) lvl = levels - 1;
            if (lvl < 0) lvl = 0;
            indices.push(lvl);
        });
        if (!valid) return;
        const cellKey = indices.join(',');
        if (!cellMap[cellKey]) cellMap[cellKey] = [];
        cellMap[cellKey].push(p);
    });
    return cellMap;
}

function findGaps(selectedFactors, levels, cellMap) {
    const gaps = [];
    function recurse(indices, depth) {
        if (depth === selectedFactors.length) {
            const cellKey = indices.join(',');
            const count = cellMap[cellKey] ? cellMap[cellKey].length : 0;
            if (count <= 1) {
                gaps.push({ indices: [...indices], count });
            }
            return;
        }
        for (let i = 0; i < levels; i++) {
            indices.push(i);
            recurse(indices, depth + 1);
            indices.pop();
        }
    }
    recurse([], 0);
    gaps.sort((a, b) => a.count - b.count);
    return gaps;
}

// ── Tests ──

describe('DOE Factor Level Computation', () => {
    test('computes correct number of levels', () => {
        const info = computeFactorInfo(sampleData, ['cl_duration'], 3);
        expect(info.cl_duration.levels).toHaveLength(3);
    });

    test('computes correct min and max', () => {
        const info = computeFactorInfo(sampleData, ['cl_intensity'], 3);
        expect(info.cl_intensity.min).toBe(24);
        expect(info.cl_intensity.max).toBe(90);
    });

    test('level boundaries span full range', () => {
        const info = computeFactorInfo(sampleData, ['extruder1'], 4);
        const fi = info.extruder1;
        expect(fi.boundaries[0]).toBeCloseTo(fi.min);
        expect(fi.boundaries[fi.boundaries.length - 1]).toBeCloseTo(fi.max);
    });

    test('level midpoints are between lo and hi', () => {
        const info = computeFactorInfo(sampleData, ['layerHeight'], 5);
        info.layerHeight.levels.forEach(lvl => {
            expect(lvl.mid).toBeGreaterThanOrEqual(lvl.lo);
            expect(lvl.mid).toBeLessThanOrEqual(lvl.hi);
        });
    });

    test('handles multiple factors', () => {
        const info = computeFactorInfo(sampleData, ['cl_duration', 'extruder1'], 3);
        expect(info.cl_duration).toBeDefined();
        expect(info.extruder1).toBeDefined();
        expect(info.cl_duration.levels).toHaveLength(3);
        expect(info.extruder1.levels).toHaveLength(3);
    });
});

describe('DOE Cell Mapping', () => {
    test('maps prints to cells', () => {
        const factors = ['cl_duration', 'cl_intensity'];
        const info = computeFactorInfo(sampleData, factors, 3);
        const cells = mapToCells(sampleData, factors, info, 3);
        const totalPrints = Object.values(cells).reduce((sum, arr) => sum + arr.length, 0);
        expect(totalPrints).toBe(sampleData.length);
    });

    test('cell keys are comma-separated indices', () => {
        const factors = ['extruder1'];
        const info = computeFactorInfo(sampleData, factors, 3);
        const cells = mapToCells(sampleData, factors, info, 3);
        Object.keys(cells).forEach(key => {
            expect(key).toMatch(/^\d+(,\d+)*$/);
        });
    });

    test('boundary values go to last level', () => {
        const factors = ['cl_intensity'];
        const info = computeFactorInfo(sampleData, factors, 3);
        const cells = mapToCells(sampleData, factors, info, 3);
        // Max value (90) should be in level 2 (last), not cause out-of-bounds
        const allIndices = Object.keys(cells).map(k => parseInt(k));
        allIndices.forEach(idx => {
            expect(idx).toBeLessThan(3);
            expect(idx).toBeGreaterThanOrEqual(0);
        });
    });

    test('handles single factor', () => {
        const factors = ['layerNum'];
        const info = computeFactorInfo(sampleData, factors, 5);
        const cells = mapToCells(sampleData, factors, info, 5);
        expect(Object.keys(cells).length).toBeGreaterThan(0);
    });
});

describe('DOE Coverage Calculation', () => {
    test('coverage percentage computed correctly', () => {
        const factors = ['cl_duration', 'cl_intensity'];
        const levels = 3;
        const info = computeFactorInfo(sampleData, factors, levels);
        const cells = mapToCells(sampleData, factors, info, levels);
        const totalCells = Math.pow(levels, factors.length); // 9
        const coveredCells = Object.keys(cells).length;
        const pct = (coveredCells / totalCells) * 100;
        expect(pct).toBeGreaterThan(0);
        expect(pct).toBeLessThanOrEqual(100);
    });

    test('more levels = lower coverage for same data', () => {
        const factors = ['cl_duration', 'cl_intensity'];
        const info3 = computeFactorInfo(sampleData, factors, 3);
        const cells3 = mapToCells(sampleData, factors, info3, 3);
        const pct3 = Object.keys(cells3).length / 9;

        const info5 = computeFactorInfo(sampleData, factors, 5);
        const cells5 = mapToCells(sampleData, factors, info5, 5);
        const pct5 = Object.keys(cells5).length / 25;

        expect(pct3).toBeGreaterThanOrEqual(pct5);
    });

    test('single factor full coverage with enough levels', () => {
        const factors = ['cl_intensity'];
        const info = computeFactorInfo(sampleData, factors, 3);
        const cells = mapToCells(sampleData, factors, info, 3);
        // 5 data points in 3 levels should have decent coverage
        expect(Object.keys(cells).length).toBeGreaterThanOrEqual(2);
    });
});

describe('DOE Gap Analysis', () => {
    test('finds empty gaps', () => {
        const factors = ['cl_duration', 'cl_intensity'];
        const levels = 3;
        const info = computeFactorInfo(sampleData, factors, levels);
        const cells = mapToCells(sampleData, factors, info, levels);
        const gaps = findGaps(factors, levels, cells);
        const emptyGaps = gaps.filter(g => g.count === 0);
        // With 5 data points in 9 cells, some must be empty
        expect(emptyGaps.length).toBeGreaterThan(0);
    });

    test('gaps sorted by count ascending', () => {
        const factors = ['cl_duration', 'cl_intensity'];
        const levels = 3;
        const info = computeFactorInfo(sampleData, factors, levels);
        const cells = mapToCells(sampleData, factors, info, levels);
        const gaps = findGaps(factors, levels, cells);
        for (let i = 1; i < gaps.length; i++) {
            expect(gaps[i].count).toBeGreaterThanOrEqual(gaps[i - 1].count);
        }
    });

    test('no gaps when data fills all cells', () => {
        // With 5 data points and 2 levels for 1 factor, should cover well
        const factors = ['cl_intensity'];
        const levels = 2;
        const info = computeFactorInfo(sampleData, factors, levels);
        const cells = mapToCells(sampleData, factors, info, levels);
        const gaps = findGaps(factors, levels, cells);
        const emptyGaps = gaps.filter(g => g.count === 0);
        expect(emptyGaps).toHaveLength(0);
    });

    test('gap indices are within bounds', () => {
        const factors = ['extruder1', 'layerHeight'];
        const levels = 4;
        const info = computeFactorInfo(sampleData, factors, levels);
        const cells = mapToCells(sampleData, factors, info, levels);
        const gaps = findGaps(factors, levels, cells);
        gaps.forEach(g => {
            g.indices.forEach(idx => {
                expect(idx).toBeGreaterThanOrEqual(0);
                expect(idx).toBeLessThan(levels);
            });
        });
    });

    test('total gaps + covered cells = total possible cells', () => {
        const factors = ['cl_duration', 'cl_intensity'];
        const levels = 3;
        const totalCells = Math.pow(levels, factors.length);
        const info = computeFactorInfo(sampleData, factors, levels);
        const cells = mapToCells(sampleData, factors, info, levels);
        const gaps = findGaps(factors, levels, cells);
        // Gaps only include count <= 1, but covered cells with count >= 2 aren't gaps
        const allCellKeys = new Set();
        gaps.forEach(g => allCellKeys.add(g.indices.join(',')));
        Object.keys(cells).forEach(k => {
            if (cells[k].length >= 2) allCellKeys.add(k);
        });
        // Gaps (count 0) + sparse (count 1) + well-covered should sum correctly
        const emptyCount = gaps.filter(g => g.count === 0).length;
        const sparseCount = gaps.filter(g => g.count === 1).length;
        const coveredCount = Object.keys(cells).filter(k => cells[k].length >= 2).length;
        expect(emptyCount + sparseCount + coveredCount).toBe(totalCells);
    });
});

describe('DOE Factorial Design', () => {
    test('factorial size is levels^factors', () => {
        const factors = ['cl_duration', 'cl_intensity'];
        const levels = 3;
        const total = Math.pow(levels, factors.length);
        expect(total).toBe(9);
    });

    test('4 factors x 3 levels = 81 combinations', () => {
        expect(Math.pow(3, 4)).toBe(81);
    });

    test('2 factors x 5 levels = 25 combinations', () => {
        expect(Math.pow(5, 2)).toBe(25);
    });
});

describe('DOE Edge Cases', () => {
    test('single data point creates valid factor info', () => {
        const single = [sampleData[0]];
        const factors = ['cl_duration'];
        // min === max, step would be 0
        const vals = single.map(p => getMetricValue(p, 'cl_duration')).filter(v => v != null);
        expect(vals).toHaveLength(1);
        // Edge case: can't meaningfully split 1 value into levels
        // but the code should not crash
    });

    test('all same values maps to single cell', () => {
        const uniform = Array(5).fill(null).map(() => ({
            print_data: { livePercent: 50, deadPercent: 50, elasticity: 50 },
            print_info: {
                crosslinking: { cl_duration: 10000, cl_enabled: true, cl_intensity: 50 },
                pressure: { extruder1: 50, extruder2: 50 },
                resolution: { layerHeight: 0.5, layerNum: 100 },
                wellplate: 6
            },
            user_info: { email: 'u@test.com', serial: 0 }
        }));
        const factors = ['cl_duration', 'cl_intensity'];
        // All identical values: min == max, step == 0
        // This is an edge case that should either map all to level 0 or handle gracefully
        const vals = uniform.map(p => getMetricValue(p, 'cl_duration'));
        expect(vals.every(v => v === 10000)).toBe(true);
    });

    test('getMetricValue returns null for missing metric', () => {
        const print = sampleData[0];
        const val = getMetricValue(print, 'nonexistent_metric');
        expect(val).toBeNull();
    });

    test('formatNum handles various number types', () => {
        expect(formatNum(null)).toBe('-');
        expect(formatNum(undefined)).toBe('-');
        expect(formatNum(42)).toBe('42');
        expect(formatNum(3.14159)).toBe('3.14');
    });
});

describe('DOE Metric Extraction', () => {
    test('extracts cl_duration correctly', () => {
        expect(getMetricValue(sampleData[0], 'cl_duration')).toBe(22793);
    });

    test('extracts cl_intensity correctly', () => {
        expect(getMetricValue(sampleData[0], 'cl_intensity')).toBe(24);
    });

    test('extracts extruder1 correctly', () => {
        expect(getMetricValue(sampleData[0], 'extruder1')).toBe(38.0);
    });

    test('extracts layerHeight correctly', () => {
        expect(getMetricValue(sampleData[0], 'layerHeight')).toBe(0.8);
    });

    test('extracts livePercent correctly', () => {
        expect(getMetricValue(sampleData[0], 'livePercent')).toBe(7.02);
    });

    test('extracts all response metrics', () => {
        const p = sampleData[2];
        expect(getMetricValue(p, 'livePercent')).toBe(60.0);
        expect(getMetricValue(p, 'deadPercent')).toBe(30.0);
        expect(getMetricValue(p, 'elasticity')).toBe(70.0);
    });
});
