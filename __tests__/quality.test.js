/**
 * @jest-environment jsdom
 *
 * Tests for quality.html — Quality Control Dashboard
 *
 * Tests cover:
 *  - Quality score computation (computeQualityScore)
 *  - Normalization logic
 *  - Grade assignment (getGrade)
 *  - Grade/score color functions
 *  - Pearson correlation (pearsonR)
 *  - Correlation heatmap color mapping (corrColor)
 *  - Optimal parameter range extraction
 *  - Weight customization
 *  - Performer ranking
 *  - formatNum utility
 *  - escapeHtml utility
 *  - Edge cases (empty data, single record, uniform values)
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
    },
    {
        print_data: { deadPercent: 10.0, elasticity: 90.0, livePercent: 88.0 },
        print_info: {
            crosslinking: { cl_duration: 20000, cl_enabled: true, cl_intensity: 60 },
            files: { input: 'file_4.gcode', output: 'file_4_output.gcode' },
            pressure: { extruder1: 50.0, extruder2: 55.0 },
            resolution: { layerHeight: 0.3, layerNum: 90 },
            wellplate: 6
        },
        user_info: { email: 'user4@gmail.com', serial: 4 }
    }
];

// ── METRICS definition (mirrors quality.html) ──────────────────────
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

const DEFAULT_WEIGHTS = {
    livePercent: 0.40,
    elasticity:  0.25,
    layerNum:    0.15,
    deadPercent: 0.20,
};

// ── Utility functions (mirrors quality.html) ───────────────────────

function formatNum(v, decimals) {
    if (v == null || isNaN(v)) return '—';
    const d = decimals != null ? decimals : 2;
    return Number(v).toFixed(d);
}

function escapeHtml(str) {
    const el = document.createElement('div');
    el.textContent = String(str == null ? '' : str);
    return el.innerHTML;
}

function pearsonR(xs, ys) {
    const n = xs.length;
    if (n < 2) return 0;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx;
        const dy = ys[i] - my;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    return denom === 0 ? 0 : num / denom;
}

function getGrade(score) {
    if (score >= 80) return 'A';
    if (score >= 65) return 'B';
    if (score >= 50) return 'C';
    if (score >= 35) return 'D';
    return 'F';
}

function gradeColor(grade) {
    switch (grade) {
        case 'A': return '#4ade80';
        case 'B': return '#38bdf8';
        case 'C': return '#fbbf24';
        case 'D': return '#f87171';
        case 'F': return '#ef4444';
        default:  return '#94a3b8';
    }
}

function scoreColor(score) {
    if (score >= 70) return '#4ade80';
    if (score >= 40) return '#fbbf24';
    return '#f87171';
}

function normalize(value, min, max) {
    if (max === min) return 0.5;
    return (value - min) / (max - min);
}

function computeRanges(data) {
    const ranges = {};
    METRICS.forEach(m => {
        const vals = data.map(p => m.get(p)).filter(v => v != null && !isNaN(v));
        if (vals.length === 0) { ranges[m.key] = { min: 0, max: 1 }; return; }
        ranges[m.key] = { min: Math.min(...vals), max: Math.max(...vals) };
    });
    return ranges;
}

function computeQualityScore(print, ranges, w) {
    const live = METRICS[0].get(print);
    const dead = METRICS[1].get(print);
    const elast = METRICS[2].get(print);
    const layers = METRICS[8].get(print);

    if (live == null || dead == null || elast == null || layers == null) return null;

    const liveNorm = normalize(live, ranges.livePercent.min, ranges.livePercent.max);
    const deadNorm = 1 - normalize(dead, ranges.deadPercent.min, ranges.deadPercent.max);
    const elastNorm = normalize(elast, ranges.elasticity.min, ranges.elasticity.max);
    const layerNorm = normalize(layers, ranges.layerNum.min, ranges.layerNum.max);

    const score = (
        (w.livePercent || 0) * liveNorm +
        (w.deadPercent || 0) * deadNorm +
        (w.elasticity || 0)  * elastNorm +
        (w.layerNum || 0)    * layerNorm
    ) * 100;

    return Math.max(0, Math.min(100, score));
}

function corrColor(r) {
    if (r >= 0) {
        const t = Math.min(r, 1);
        const red = Math.round(30 + (74 - 30) * t);
        const green = Math.round(41 + (222 - 41) * t);
        const blue = Math.round(59 + (128 - 59) * t);
        return `rgb(${red}, ${green}, ${blue})`;
    } else {
        const t = Math.min(-r, 1);
        const red = Math.round(30 + (239 - 30) * t);
        const green = Math.round(41 + (68 - 41) * t);
        const blue = Math.round(59 + (68 - 59) * t);
        return `rgb(${red}, ${green}, ${blue})`;
    }
}

// ════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════

// ── formatNum ──────────────────────────────────────────────────────

describe('formatNum', () => {
    test('formats number with default 2 decimals', () => {
        expect(formatNum(3.14159)).toBe('3.14');
    });

    test('formats number with specified decimals', () => {
        expect(formatNum(3.14159, 1)).toBe('3.1');
        expect(formatNum(3.14159, 0)).toBe('3');
        expect(formatNum(3.14159, 4)).toBe('3.1416');
    });

    test('returns dash for null/undefined/NaN', () => {
        expect(formatNum(null)).toBe('—');
        expect(formatNum(undefined)).toBe('—');
        expect(formatNum(NaN)).toBe('—');
    });

    test('formats zero correctly', () => {
        expect(formatNum(0)).toBe('0.00');
        expect(formatNum(0, 1)).toBe('0.0');
    });

    test('formats negative numbers', () => {
        expect(formatNum(-5.678, 2)).toBe('-5.68');
    });
});

// ── escapeHtml ─────────────────────────────────────────────────────

describe('escapeHtml', () => {
    test('escapes angle brackets', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    test('escapes ampersand', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('handles null/undefined', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    test('passes through normal text', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });
});

// ── pearsonR ───────────────────────────────────────────────────────

describe('pearsonR', () => {
    test('returns 1 for perfectly correlated data', () => {
        const r = pearsonR([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
        expect(r).toBeCloseTo(1.0, 5);
    });

    test('returns -1 for perfectly inverse correlated data', () => {
        const r = pearsonR([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
        expect(r).toBeCloseTo(-1.0, 5);
    });

    test('returns 0 for uncorrelated data', () => {
        const r = pearsonR([1, 2, 3, 4, 5], [5, 1, 4, 2, 3]);
        expect(Math.abs(r)).toBeLessThan(0.5); // approximately uncorrelated
    });

    test('returns 0 for single element', () => {
        expect(pearsonR([1], [2])).toBe(0);
    });

    test('returns 0 for empty arrays', () => {
        expect(pearsonR([], [])).toBe(0);
    });

    test('returns 0 for constant arrays', () => {
        expect(pearsonR([5, 5, 5], [1, 2, 3])).toBe(0);
    });

    test('handles two elements', () => {
        const r = pearsonR([1, 2], [3, 4]);
        expect(r).toBeCloseTo(1.0, 5);
    });
});

// ── getGrade ───────────────────────────────────────────────────────

describe('getGrade', () => {
    test('returns A for scores >= 80', () => {
        expect(getGrade(80)).toBe('A');
        expect(getGrade(100)).toBe('A');
        expect(getGrade(95.5)).toBe('A');
    });

    test('returns B for scores 65-79', () => {
        expect(getGrade(65)).toBe('B');
        expect(getGrade(79.9)).toBe('B');
    });

    test('returns C for scores 50-64', () => {
        expect(getGrade(50)).toBe('C');
        expect(getGrade(64.9)).toBe('C');
    });

    test('returns D for scores 35-49', () => {
        expect(getGrade(35)).toBe('D');
        expect(getGrade(49.9)).toBe('D');
    });

    test('returns F for scores < 35', () => {
        expect(getGrade(34.9)).toBe('F');
        expect(getGrade(0)).toBe('F');
        expect(getGrade(-5)).toBe('F');
    });
});

// ── gradeColor ─────────────────────────────────────────────────────

describe('gradeColor', () => {
    test('returns correct colors for each grade', () => {
        expect(gradeColor('A')).toBe('#4ade80');
        expect(gradeColor('B')).toBe('#38bdf8');
        expect(gradeColor('C')).toBe('#fbbf24');
        expect(gradeColor('D')).toBe('#f87171');
        expect(gradeColor('F')).toBe('#ef4444');
    });

    test('returns fallback for unknown grade', () => {
        expect(gradeColor('X')).toBe('#94a3b8');
    });
});

// ── scoreColor ─────────────────────────────────────────────────────

describe('scoreColor', () => {
    test('returns green for high scores', () => {
        expect(scoreColor(70)).toBe('#4ade80');
        expect(scoreColor(100)).toBe('#4ade80');
    });

    test('returns yellow for medium scores', () => {
        expect(scoreColor(40)).toBe('#fbbf24');
        expect(scoreColor(69)).toBe('#fbbf24');
    });

    test('returns red for low scores', () => {
        expect(scoreColor(0)).toBe('#f87171');
        expect(scoreColor(39)).toBe('#f87171');
    });
});

// ── normalize ──────────────────────────────────────────────────────

describe('normalize', () => {
    test('normalizes value within range', () => {
        expect(normalize(50, 0, 100)).toBe(0.5);
        expect(normalize(0, 0, 100)).toBe(0);
        expect(normalize(100, 0, 100)).toBe(1);
    });

    test('returns 0.5 when min equals max', () => {
        expect(normalize(5, 5, 5)).toBe(0.5);
    });

    test('handles negative ranges', () => {
        expect(normalize(-5, -10, 0)).toBe(0.5);
    });

    test('handles value outside range', () => {
        expect(normalize(150, 0, 100)).toBe(1.5);
        expect(normalize(-50, 0, 100)).toBe(-0.5);
    });
});

// ── computeRanges ──────────────────────────────────────────────────

describe('computeRanges', () => {
    test('computes correct ranges for sample data', () => {
        const ranges = computeRanges(sampleData);
        expect(ranges.livePercent.min).toBe(7.02);
        expect(ranges.livePercent.max).toBe(88.0);
        expect(ranges.elasticity.min).toBe(47.42);
        expect(ranges.elasticity.max).toBe(90.0);
        expect(ranges.layerNum.min).toBe(25);
        expect(ranges.layerNum.max).toBe(100);
    });

    test('handles empty data', () => {
        const ranges = computeRanges([]);
        expect(ranges.livePercent).toEqual({ min: 0, max: 1 });
    });

    test('handles single record', () => {
        const ranges = computeRanges([sampleData[0]]);
        expect(ranges.livePercent.min).toBe(7.02);
        expect(ranges.livePercent.max).toBe(7.02);
    });
});

// ── computeQualityScore ────────────────────────────────────────────

describe('computeQualityScore', () => {
    const ranges = computeRanges(sampleData);

    test('highest quality print gets highest score', () => {
        // Print 4 has: highest live (88), lowest dead (10), highest elasticity (90), high layers (90)
        const score4 = computeQualityScore(sampleData[4], ranges, DEFAULT_WEIGHTS);
        // Print 0 has: lowest live (7.02), highest dead (84.01), low elasticity (49.28), mid layers (48)
        const score0 = computeQualityScore(sampleData[0], ranges, DEFAULT_WEIGHTS);
        expect(score4).toBeGreaterThan(score0);
    });

    test('scores are between 0 and 100', () => {
        sampleData.forEach(p => {
            const score = computeQualityScore(p, ranges, DEFAULT_WEIGHTS);
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(100);
        });
    });

    test('default weights sum to 1.0', () => {
        const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1.0, 5);
    });

    test('all-zero weights produce score of 0', () => {
        const zeroWeights = { livePercent: 0, elasticity: 0, layerNum: 0, deadPercent: 0 };
        const score = computeQualityScore(sampleData[0], ranges, zeroWeights);
        expect(score).toBe(0);
    });

    test('viability-only weights rank by live percent', () => {
        const w = { livePercent: 1.0, elasticity: 0, layerNum: 0, deadPercent: 0 };
        const scores = sampleData.map(p => computeQualityScore(p, ranges, w));
        // Print 4 (88%) should have highest score
        expect(scores[4]).toBeGreaterThan(scores[2]); // 88 > 72.3
        expect(scores[2]).toBeGreaterThan(scores[3]); // 72.3 > 50
        expect(scores[3]).toBeGreaterThan(scores[1]); // 50 > 37.42
        expect(scores[1]).toBeGreaterThan(scores[0]); // 37.42 > 7.02
    });

    test('elasticity-only weights rank by elasticity', () => {
        const w = { livePercent: 0, elasticity: 1.0, layerNum: 0, deadPercent: 0 };
        const scores = sampleData.map(p => computeQualityScore(p, ranges, w));
        // Print 4 (90 kPa) should have highest
        expect(scores[4]).toBeGreaterThan(scores[2]); // 90 > 80.5
        expect(scores[2]).toBeGreaterThan(scores[3]); // 80.5 > 55
    });

    test('dead-percent weight inverts correctly', () => {
        const w = { livePercent: 0, elasticity: 0, layerNum: 0, deadPercent: 1.0 };
        const scores = sampleData.map(p => computeQualityScore(p, ranges, w));
        // Lower dead = higher score. Print 4 (10%) should be best
        expect(scores[4]).toBeGreaterThan(scores[2]); // 10 < 20
        expect(scores[2]).toBeGreaterThan(scores[3]); // 20 < 45
        expect(scores[0]).toBeLessThan(scores[1]);    // 84.01 > 53.09 → lower score
    });

    test('returns null for record with missing data', () => {
        const badPrint = {
            print_data: { deadPercent: null, elasticity: 50, livePercent: 50 },
            print_info: {
                crosslinking: { cl_duration: 0, cl_enabled: false, cl_intensity: 0 },
                pressure: { extruder1: 50, extruder2: 50 },
                resolution: { layerHeight: 0.5, layerNum: 50 },
                wellplate: 6
            },
            user_info: { email: 'test@test.com', serial: 99 }
        };
        expect(computeQualityScore(badPrint, ranges, DEFAULT_WEIGHTS)).toBeNull();
    });

    test('uniform data produces mid-range scores', () => {
        const uniformData = Array(5).fill(null).map(() => ({
            print_data: { deadPercent: 50, elasticity: 50, livePercent: 50 },
            print_info: {
                crosslinking: { cl_duration: 1000, cl_enabled: true, cl_intensity: 30 },
                pressure: { extruder1: 60, extruder2: 60 },
                resolution: { layerHeight: 0.5, layerNum: 50 },
                wellplate: 6
            },
            user_info: { email: 'u@u.com', serial: 0 }
        }));
        const uRanges = computeRanges(uniformData);
        const score = computeQualityScore(uniformData[0], uRanges, DEFAULT_WEIGHTS);
        // With uniform data, all normalizations → 0.5, dead inverted → 0.5
        expect(score).toBeCloseTo(50, 0);
    });
});

// ── corrColor ──────────────────────────────────────────────────────

describe('corrColor', () => {
    test('returns green-ish for positive correlations', () => {
        const color = corrColor(1.0);
        expect(color).toBe('rgb(74, 222, 128)');
    });

    test('returns red-ish for negative correlations', () => {
        const color = corrColor(-1.0);
        expect(color).toBe('rgb(239, 68, 68)');
    });

    test('returns dark for zero correlation', () => {
        const color = corrColor(0);
        expect(color).toBe('rgb(30, 41, 59)');
    });

    test('handles values between 0 and 1', () => {
        const color = corrColor(0.5);
        expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    });

    test('handles values between -1 and 0', () => {
        const color = corrColor(-0.5);
        expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    });
});

// ── Optimal parameter filtering ────────────────────────────────────

describe('Optimal parameter filtering', () => {
    test('filters prints above viability threshold', () => {
        const threshold = 50;
        const matching = sampleData.filter(p => {
            const live = METRICS[0].get(p);
            return live != null && live >= threshold;
        });
        expect(matching.length).toBe(3); // prints 2 (72.3), 3 (50.0), 4 (88.0)
    });

    test('threshold 0 matches all prints', () => {
        const matching = sampleData.filter(p => {
            const live = METRICS[0].get(p);
            return live != null && live >= 0;
        });
        expect(matching.length).toBe(sampleData.length);
    });

    test('threshold 100 matches no prints (none have exactly 100)', () => {
        const matching = sampleData.filter(p => {
            const live = METRICS[0].get(p);
            return live != null && live >= 100;
        });
        expect(matching.length).toBe(0);
    });

    test('computes correct ranges for matching prints', () => {
        const threshold = 50;
        const matching = sampleData.filter(p => METRICS[0].get(p) >= threshold);
        const elastVals = matching.map(p => METRICS[2].get(p));
        expect(Math.min(...elastVals)).toBe(55.0);  // print 3
        expect(Math.max(...elastVals)).toBe(90.0);   // print 4
    });

    test('crosslinking percentage calculation', () => {
        const threshold = 50;
        const matching = sampleData.filter(p => METRICS[0].get(p) >= threshold);
        const clEnabled = matching.filter(p => p.print_info.crosslinking.cl_enabled).length;
        const pct = (clEnabled / matching.length) * 100;
        expect(pct).toBeCloseTo(100, 0); // all 3 matching have cl_enabled
    });
});

// ── Performer ranking ──────────────────────────────────────────────

describe('Performer ranking', () => {
    test('sorts prints by score descending', () => {
        const ranges = computeRanges(sampleData);
        const scored = sampleData.map((p, i) => ({
            index: i,
            score: computeQualityScore(p, ranges, DEFAULT_WEIGHTS),
            print: p,
        })).filter(s => s.score != null);
        scored.sort((a, b) => b.score - a.score);

        // First should be print 4 (best overall)
        expect(scored[0].index).toBe(4);
        // Last should be print 0 (worst overall)
        expect(scored[scored.length - 1].index).toBe(0);
    });

    test('top performers have higher viability', () => {
        const ranges = computeRanges(sampleData);
        const scored = sampleData.map((p, i) => ({
            index: i,
            score: computeQualityScore(p, ranges, DEFAULT_WEIGHTS),
            print: p,
        })).filter(s => s.score != null);
        scored.sort((a, b) => b.score - a.score);

        const topLive = METRICS[0].get(scored[0].print);
        const bottomLive = METRICS[0].get(scored[scored.length - 1].print);
        expect(topLive).toBeGreaterThan(bottomLive);
    });

    test('all prints get valid scores', () => {
        const ranges = computeRanges(sampleData);
        sampleData.forEach(p => {
            const score = computeQualityScore(p, ranges, DEFAULT_WEIGHTS);
            expect(score).not.toBeNull();
            expect(typeof score).toBe('number');
        });
    });
});

// ── Weight customization ───────────────────────────────────────────

describe('Weight customization', () => {
    test('changing weights changes scores', () => {
        const ranges = computeRanges(sampleData);
        const score1 = computeQualityScore(sampleData[0], ranges, DEFAULT_WEIGHTS);
        const altWeights = { livePercent: 0.1, elasticity: 0.6, layerNum: 0.2, deadPercent: 0.1 };
        const score2 = computeQualityScore(sampleData[0], ranges, altWeights);
        expect(score1).not.toBeCloseTo(score2, 1);
    });

    test('weights can be any positive values', () => {
        const ranges = computeRanges(sampleData);
        const bigWeights = { livePercent: 2.0, elasticity: 0, layerNum: 0, deadPercent: 0 };
        const score = computeQualityScore(sampleData[4], ranges, bigWeights);
        expect(score).toBeGreaterThanOrEqual(0);
    });

    test('partial weights (some zero) still work', () => {
        const ranges = computeRanges(sampleData);
        const partialWeights = { livePercent: 0.5, elasticity: 0.5, layerNum: 0, deadPercent: 0 };
        const score = computeQualityScore(sampleData[2], ranges, partialWeights);
        expect(score).toBeGreaterThan(0);
    });
});

// ── METRICS structure ──────────────────────────────────────────────

describe('METRICS', () => {
    test('has 10 metrics', () => {
        expect(METRICS.length).toBe(10);
    });

    test('all metrics have required fields', () => {
        METRICS.forEach(m => {
            expect(m.key).toBeTruthy();
            expect(m.label).toBeTruthy();
            expect(typeof m.get).toBe('function');
            expect(m).toHaveProperty('unit');
            expect(m).toHaveProperty('higherBetter');
        });
    });

    test('all metrics extract values from sample data', () => {
        METRICS.forEach(m => {
            const val = m.get(sampleData[0]);
            expect(val).not.toBeUndefined();
            expect(typeof val).toBe('number');
        });
    });

    test('livePercent and deadPercent are complementary indicators', () => {
        const live = METRICS.find(m => m.key === 'livePercent');
        const dead = METRICS.find(m => m.key === 'deadPercent');
        expect(live.higherBetter).toBe(true);
        expect(dead.higherBetter).toBe(false);
    });
});

// ── Correlation matrix ─────────────────────────────────────────────

describe('Correlation matrix', () => {
    test('diagonal is always 1', () => {
        METRICS.forEach((m, i) => {
            const vals = sampleData.map(p => m.get(p)).filter(v => v != null);
            const r = pearsonR(vals, vals);
            expect(r).toBeCloseTo(1.0, 5);
        });
    });

    test('matrix is symmetric', () => {
        const m1Vals = sampleData.map(p => METRICS[0].get(p));
        const m2Vals = sampleData.map(p => METRICS[2].get(p));
        const r12 = pearsonR(m1Vals, m2Vals);
        const r21 = pearsonR(m2Vals, m1Vals);
        expect(r12).toBeCloseTo(r21, 10);
    });

    test('live and dead percent are negatively correlated', () => {
        const live = sampleData.map(p => METRICS[0].get(p));
        const dead = sampleData.map(p => METRICS[1].get(p));
        const r = pearsonR(live, dead);
        expect(r).toBeLessThan(0);
    });
});

// ── Integration: full scoring pipeline ─────────────────────────────

describe('Full scoring pipeline', () => {
    test('computes ranges, scores, grades for all sample prints', () => {
        const ranges = computeRanges(sampleData);
        const results = sampleData.map((p, i) => {
            const score = computeQualityScore(p, ranges, DEFAULT_WEIGHTS);
            return { index: i, score, grade: getGrade(score) };
        });

        expect(results.length).toBe(5);
        results.forEach(r => {
            expect(r.score).toBeGreaterThanOrEqual(0);
            expect(r.score).toBeLessThanOrEqual(100);
            expect(['A', 'B', 'C', 'D', 'F']).toContain(r.grade);
        });
    });

    test('average score is reasonable for sample data', () => {
        const ranges = computeRanges(sampleData);
        const scores = sampleData.map(p => computeQualityScore(p, ranges, DEFAULT_WEIGHTS));
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        expect(avg).toBeGreaterThan(20);
        expect(avg).toBeLessThan(80);
    });

    test('score variance exists (not all same)', () => {
        const ranges = computeRanges(sampleData);
        const scores = sampleData.map(p => computeQualityScore(p, ranges, DEFAULT_WEIGHTS));
        const uniqueScores = new Set(scores.map(s => s.toFixed(2)));
        expect(uniqueScores.size).toBeGreaterThan(1);
    });
});
