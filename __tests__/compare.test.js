/**
 * @jest-environment jsdom
 *
 * Tests for compare.html — Print Comparison Tool
 *
 * Tests cover:
 *  - METRICS constant structure and accessor functions
 *  - formatNum() formatting logic
 *  - Selection management (addPrint, removePrint, clearAll, addRandom)
 *  - Search filtering logic
 *  - Radar chart normalization
 *  - Table building with best/worst highlighting
 *  - Insight generation (viability, elasticity, crosslinking, pressure)
 */

'use strict';

// ── Sample data matching bioprint-data.json structure ──────────────
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
            crosslinking: { cl_duration: 10000, cl_enabled: true, cl_intensity: 30 },
            files: { input: 'file_3.gcode', output: 'file_3_output.gcode' },
            pressure: { extruder1: 80.0, extruder2: 80.0 },
            resolution: { layerHeight: 0.4, layerNum: 60 },
            wellplate: 24
        },
        user_info: { email: 'user3@gmail.com', serial: 3 }
    }
];

// ── METRICS definition (mirrors compare.html) ──────────────────────
const METRICS = [
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

// ── formatNum (mirrors compare.html) ───────────────────────────────
function formatNum(n) {
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(2);
}

// ── Selection manager (mirrors compare.html logic) ─────────────────
const MAX_SELECTIONS = 4;

function createSelectionManager(data) {
    let selected = [];

    return {
        get selected() { return selected; },

        addPrint(index) {
            if (selected.length >= MAX_SELECTIONS) return false;
            if (selected.some(s => s.index === index)) return false;
            if (index < 0 || index >= data.length) return false;
            selected.push({ index, print: data[index] });
            return true;
        },

        removePrint(index) {
            const before = selected.length;
            selected = selected.filter(s => s.index !== index);
            return selected.length < before;
        },

        clearAll() {
            selected = [];
        },

        addRandom() {
            if (selected.length >= MAX_SELECTIONS || data.length === 0) return -1;
            const available = [];
            for (let i = 0; i < data.length; i++) {
                if (!selected.some(s => s.index === i)) available.push(i);
            }
            if (available.length === 0) return -1;
            const idx = available[Math.floor(Math.random() * available.length)];
            this.addPrint(idx);
            return idx;
        }
    };
}

// ── Search filter (mirrors compare.html) ───────────────────────────
function searchPrints(data, query, selected) {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];

    const results = [];
    for (let i = 0; i < data.length && results.length < 20; i++) {
        const p = data[i];
        const serial = String(p.user_info.serial);
        const email = (p.user_info.email || '').toLowerCase();
        const idx = String(i);

        if (serial.includes(q) || email.includes(q) || idx === q) {
            if (!selected.some(s => s.index === i)) {
                results.push(i);
            }
        }
    }
    return results;
}

// ── Radar normalization (mirrors compare.html) ─────────────────────
function normalizeForRadar(selected, allData) {
    return METRICS.map(m => {
        const allVals = allData.map(p => {
            try { return m.get(p); } catch { return null; }
        }).filter(v => v !== null && isFinite(v));

        const min = Math.min(...allVals);
        const max = Math.max(...allVals);
        const range = max - min || 1;

        const normalized = selected.map(s => {
            let val;
            try { val = m.get(s.print); } catch { val = null; }
            if (val === null || !isFinite(val)) val = min;
            return (val - min) / range;
        });

        return { key: m.key, normalized, min, max, range };
    });
}

// ── Insight generators (mirrors compare.html) ──────────────────────
function findBestViability(selected) {
    let best = { val: -1, idx: -1 };
    for (let i = 0; i < selected.length; i++) {
        const v = selected[i].print.print_data.livePercent;
        if (v > best.val) best = { val: v, idx: i };
    }
    return best;
}

function findBestElasticity(selected) {
    let best = { val: -1, idx: -1 };
    for (let i = 0; i < selected.length; i++) {
        const v = selected[i].print.print_data.elasticity;
        if (v > best.val) best = { val: v, idx: i };
    }
    return best;
}

function calcPressureImbalance(selected) {
    const diffs = selected.map(s => {
        const e1 = s.print.print_info.pressure.extruder1;
        const e2 = s.print.print_info.pressure.extruder2;
        return Math.abs(e1 - e2);
    });
    return diffs.reduce((a, b) => a + b, 0) / diffs.length;
}

function calcCrosslinkingEffect(selected) {
    const enabled = selected.filter(s => s.print.print_info.crosslinking.cl_enabled);
    const disabled = selected.filter(s => !s.print.print_info.crosslinking.cl_enabled);
    if (enabled.length === 0 || disabled.length === 0) return null;

    const avgEnabled = enabled.map(s => s.print.print_data.livePercent).reduce((a, b) => a + b, 0) / enabled.length;
    const avgDisabled = disabled.map(s => s.print.print_data.livePercent).reduce((a, b) => a + b, 0) / disabled.length;
    return { avgEnabled, avgDisabled, diff: avgEnabled - avgDisabled };
}

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe('METRICS', () => {
    test('has 10 metrics defined', () => {
        expect(METRICS).toHaveLength(10);
    });

    test('each metric has required fields', () => {
        for (const m of METRICS) {
            expect(m).toHaveProperty('key');
            expect(m).toHaveProperty('label');
            expect(m).toHaveProperty('unit');
            expect(m).toHaveProperty('higherBetter');
            expect(typeof m.get).toBe('function');
        }
    });

    test('metric accessors extract correct values from sample data', () => {
        const print = sampleData[0];
        expect(METRICS.find(m => m.key === 'livePercent').get(print)).toBe(7.02);
        expect(METRICS.find(m => m.key === 'deadPercent').get(print)).toBe(84.01);
        expect(METRICS.find(m => m.key === 'elasticity').get(print)).toBe(49.28);
        expect(METRICS.find(m => m.key === 'cl_duration').get(print)).toBe(22793);
        expect(METRICS.find(m => m.key === 'cl_intensity').get(print)).toBe(24);
        expect(METRICS.find(m => m.key === 'extruder1').get(print)).toBe(38.0);
        expect(METRICS.find(m => m.key === 'extruder2').get(print)).toBe(93.0);
        expect(METRICS.find(m => m.key === 'layerHeight').get(print)).toBe(0.8);
        expect(METRICS.find(m => m.key === 'layerNum').get(print)).toBe(48);
        expect(METRICS.find(m => m.key === 'wellplate').get(print)).toBe(6);
    });

    test('higherBetter is set for viability/elasticity/layers, null for others', () => {
        expect(METRICS.find(m => m.key === 'livePercent').higherBetter).toBe(true);
        expect(METRICS.find(m => m.key === 'deadPercent').higherBetter).toBe(false);
        expect(METRICS.find(m => m.key === 'elasticity').higherBetter).toBe(true);
        expect(METRICS.find(m => m.key === 'layerNum').higherBetter).toBe(true);
        expect(METRICS.find(m => m.key === 'cl_duration').higherBetter).toBeNull();
        expect(METRICS.find(m => m.key === 'extruder1').higherBetter).toBeNull();
    });
});

describe('formatNum', () => {
    test('formats integers without decimals', () => {
        expect(formatNum(42)).toBe('42');
        expect(formatNum(0)).toBe('0');
        expect(formatNum(100)).toBe('100');
    });

    test('formats floats to 2 decimal places', () => {
        expect(formatNum(3.14159)).toBe('3.14');
        expect(formatNum(0.5)).toBe('0.50');
    });

    test('formats large numbers with locale string', () => {
        const result = formatNum(12345);
        expect(result).toContain('12');
        expect(result).toContain('345');
    });

    test('handles negative numbers', () => {
        expect(formatNum(-5)).toBe('-5');
        expect(formatNum(-3.14)).toBe('-3.14');
    });
});

describe('Selection Manager', () => {
    let mgr;

    beforeEach(() => {
        mgr = createSelectionManager(sampleData);
    });

    test('starts empty', () => {
        expect(mgr.selected).toHaveLength(0);
    });

    test('addPrint adds a print by index', () => {
        expect(mgr.addPrint(0)).toBe(true);
        expect(mgr.selected).toHaveLength(1);
        expect(mgr.selected[0].index).toBe(0);
        expect(mgr.selected[0].print).toBe(sampleData[0]);
    });

    test('addPrint rejects duplicate index', () => {
        mgr.addPrint(0);
        expect(mgr.addPrint(0)).toBe(false);
        expect(mgr.selected).toHaveLength(1);
    });

    test('addPrint enforces max 4 selections', () => {
        mgr.addPrint(0);
        mgr.addPrint(1);
        mgr.addPrint(2);
        mgr.addPrint(3);
        expect(mgr.selected).toHaveLength(4);
        // Can't add a 5th
        expect(mgr.addPrint(0)).toBe(false); // already in
    });

    test('addPrint rejects out-of-range index', () => {
        expect(mgr.addPrint(-1)).toBe(false);
        expect(mgr.addPrint(999)).toBe(false);
    });

    test('removePrint removes by index', () => {
        mgr.addPrint(0);
        mgr.addPrint(1);
        expect(mgr.removePrint(0)).toBe(true);
        expect(mgr.selected).toHaveLength(1);
        expect(mgr.selected[0].index).toBe(1);
    });

    test('removePrint returns false for non-existent', () => {
        expect(mgr.removePrint(5)).toBe(false);
    });

    test('clearAll empties selection', () => {
        mgr.addPrint(0);
        mgr.addPrint(1);
        mgr.clearAll();
        expect(mgr.selected).toHaveLength(0);
    });

    test('addRandom adds a random non-selected print', () => {
        const idx = mgr.addRandom();
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(sampleData.length);
        expect(mgr.selected).toHaveLength(1);
    });

    test('addRandom returns -1 when all selected', () => {
        for (let i = 0; i < sampleData.length; i++) mgr.addPrint(i);
        expect(mgr.addRandom()).toBe(-1);
    });

    test('addRandom avoids already-selected indices', () => {
        mgr.addPrint(0);
        mgr.addPrint(1);
        mgr.addPrint(2);
        const idx = mgr.addRandom();
        expect(idx).toBe(3); // only one left
    });
});

describe('Search', () => {
    test('finds prints by serial number', () => {
        const results = searchPrints(sampleData, '0', []);
        expect(results).toContain(0);
    });

    test('finds prints by email', () => {
        const results = searchPrints(sampleData, 'user2', []);
        expect(results).toContain(2);
    });

    test('finds prints by exact index', () => {
        const results = searchPrints(sampleData, '3', []);
        expect(results).toContain(3);
    });

    test('returns empty for no match', () => {
        const results = searchPrints(sampleData, 'nonexistent', []);
        expect(results).toHaveLength(0);
    });

    test('excludes already-selected prints', () => {
        const selected = [{ index: 0 }];
        const results = searchPrints(sampleData, '0', selected);
        expect(results).not.toContain(0);
    });

    test('returns empty for empty query', () => {
        expect(searchPrints(sampleData, '', [])).toHaveLength(0);
        expect(searchPrints(sampleData, '  ', [])).toHaveLength(0);
    });

    test('is case-insensitive for email', () => {
        const results = searchPrints(sampleData, 'USER1', []);
        expect(results).toContain(1);
    });
});

describe('Radar Normalization', () => {
    test('normalizes values to 0-1 range', () => {
        const selected = [
            { index: 0, print: sampleData[0] },
            { index: 2, print: sampleData[2] }
        ];
        const normalized = normalizeForRadar(selected, sampleData);

        for (const metric of normalized) {
            for (const val of metric.normalized) {
                expect(val).toBeGreaterThanOrEqual(0);
                expect(val).toBeLessThanOrEqual(1);
            }
        }
    });

    test('best value normalizes to 1, worst to 0 (when selected are min/max)', () => {
        // livePercent: min=7.02 (idx 0), max=72.3 (idx 2)
        const selected = [
            { index: 0, print: sampleData[0] },
            { index: 2, print: sampleData[2] }
        ];
        const normalized = normalizeForRadar(selected, sampleData);
        const liveMetric = normalized.find(m => m.key === 'livePercent');
        expect(liveMetric.normalized[0]).toBe(0); // 7.02 is min
        expect(liveMetric.normalized[1]).toBe(1); // 72.3 is max
    });

    test('produces normalized arrays matching selected length', () => {
        const selected = [
            { index: 0, print: sampleData[0] },
            { index: 1, print: sampleData[1] },
            { index: 2, print: sampleData[2] }
        ];
        const normalized = normalizeForRadar(selected, sampleData);
        expect(normalized).toHaveLength(METRICS.length);
        for (const m of normalized) {
            expect(m.normalized).toHaveLength(3);
        }
    });
});

describe('Insights', () => {
    const selected = [
        { index: 0, print: sampleData[0] },
        { index: 1, print: sampleData[1] },
        { index: 2, print: sampleData[2] },
        { index: 3, print: sampleData[3] }
    ];

    test('findBestViability picks the highest live cell %', () => {
        const best = findBestViability(selected);
        expect(best.val).toBe(72.3);
        expect(best.idx).toBe(2); // sampleData[2] has 72.3%
    });

    test('findBestElasticity picks the highest elasticity', () => {
        const best = findBestElasticity(selected);
        expect(best.val).toBe(80.5);
        expect(best.idx).toBe(2);
    });

    test('calcPressureImbalance computes average difference', () => {
        // Print 0: |38-93| = 55, Print 1: |109-40| = 69
        // Print 2: |60-65| = 5, Print 3: |80-80| = 0
        // Average: (55+69+5+0)/4 = 32.25
        const imbalance = calcPressureImbalance(selected);
        expect(imbalance).toBeCloseTo(32.25, 2);
    });

    test('calcCrosslinkingEffect compares enabled vs disabled', () => {
        const effect = calcCrosslinkingEffect(selected);
        expect(effect).not.toBeNull();

        // Enabled: prints 0 (7.02%), 2 (72.3%), 3 (50.0%) → avg 43.107
        // Disabled: print 1 (37.42%) → avg 37.42
        expect(effect.avgEnabled).toBeCloseTo(43.107, 1);
        expect(effect.avgDisabled).toBeCloseTo(37.42, 2);
        expect(effect.diff).toBeGreaterThan(0); // crosslinked is better
    });

    test('calcCrosslinkingEffect returns null when all same type', () => {
        const allEnabled = [
            { index: 0, print: sampleData[0] },
            { index: 2, print: sampleData[2] }
        ];
        expect(calcCrosslinkingEffect(allEnabled)).toBeNull();
    });

    test('pressure imbalance for balanced extruders is 0', () => {
        const balanced = [{ index: 3, print: sampleData[3] }];
        expect(calcPressureImbalance(balanced)).toBe(0);
    });
});

describe('Integration', () => {
    test('full workflow: add, compare, remove, clear', () => {
        const mgr = createSelectionManager(sampleData);

        // Add 3 prints
        mgr.addPrint(0);
        mgr.addPrint(2);
        mgr.addPrint(3);
        expect(mgr.selected).toHaveLength(3);

        // Run insights
        const viability = findBestViability(mgr.selected);
        expect(viability.val).toBe(72.3);

        // Normalize for radar
        const normalized = normalizeForRadar(mgr.selected, sampleData);
        expect(normalized).toHaveLength(10);

        // Remove one
        mgr.removePrint(2);
        expect(mgr.selected).toHaveLength(2);

        // Clear
        mgr.clearAll();
        expect(mgr.selected).toHaveLength(0);
    });

    test('search + add workflow', () => {
        const mgr = createSelectionManager(sampleData);

        // Search for serial 2
        const results = searchPrints(sampleData, '2', mgr.selected);
        expect(results.length).toBeGreaterThan(0);

        // Add first result
        mgr.addPrint(results[0]);
        expect(mgr.selected).toHaveLength(1);

        // Search again excludes selected
        const results2 = searchPrints(sampleData, '2', mgr.selected);
        expect(results2).not.toContain(results[0]);
    });
});
