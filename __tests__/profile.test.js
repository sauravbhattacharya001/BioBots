/**
 * Tests for Print Profile Card (docs/profile.html)
 * Extracted pure functions tested in isolation.
 */

// ── Replicate shared utilities (from shared/utils.js) ──
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
        wellplate:    p => p.print_info.wellplate,
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

// ── Profile functions (from profile.html) ──
const PROFILE_METRICS = [
    'livePercent', 'deadPercent', 'elasticity',
    'cl_duration', 'cl_intensity',
    'extruder1', 'extruder2',
    'layerHeight', 'layerNum', 'wellplate'
];

const PROFILE_METRIC_LABELS = {
    livePercent: 'Live Cell %', deadPercent: 'Dead Cell %',
    elasticity: 'Elasticity (kPa)', cl_duration: 'CL Duration (ms)',
    cl_intensity: 'CL Intensity (%)', extruder1: 'Extruder 1 Pressure',
    extruder2: 'Extruder 2 Pressure', layerHeight: 'Layer Height (mm)',
    layerNum: 'Layer Count', wellplate: 'Wellplate'
};

function computeQualityScore(print) {
    const lp = getMetricValue(print, 'livePercent');
    const el = getMetricValue(print, 'elasticity');
    const ln = getMetricValue(print, 'layerNum');
    const cli = getMetricValue(print, 'cl_intensity');
    if (lp == null || el == null || ln == null || cli == null) return null;
    const viabilityNorm = Math.min(Math.max(lp / 100, 0), 1);
    const elastNorm = Math.min(Math.max(el / 100, 0), 1);
    const layerNorm = Math.min(Math.max(ln / 100, 0), 1);
    const clNorm = Math.min(Math.max(cli / 100, 0), 1);
    return (viabilityNorm * 40 + elastNorm * 25 + layerNorm * 20 + clNorm * 15);
}

function qualityGrade(score) {
    if (score == null) return 'F';
    if (score >= 80) return 'A';
    if (score >= 60) return 'B';
    if (score >= 40) return 'C';
    if (score >= 20) return 'D';
    return 'F';
}

function computePercentile(value, sortedValues) {
    if (!sortedValues || sortedValues.length === 0) return 0;
    let count = 0;
    for (const v of sortedValues) {
        if (v < value) count++;
        else break;
    }
    return (count / sortedValues.length) * 100;
}

function isAnomaly(value, mean, std) {
    if (std === 0) return false;
    return Math.abs(value - mean) > 2 * std;
}

function normalizeMetric(value, sortedValues) {
    if (!sortedValues || sortedValues.length === 0) return 0;
    const min = sortedValues[0];
    const max = sortedValues[sortedValues.length - 1];
    if (max === min) return 0.5;
    return (value - min) / (max - min);
}

function buildPopulationStats(prints) {
    const stats = {};
    for (const m of PROFILE_METRICS) {
        const vals = prints.map(p => getMetricValue(p, m)).filter(v => v != null);
        stats[m] = computeStats(vals);
        stats[m].values = vals.sort((a, b) => a - b);
    }
    return stats;
}

function findSimilarPrints(targetIdx, prints, populationStats, topN) {
    topN = topN || 3;
    const targetNorm = PROFILE_METRICS.map(m => {
        const v = getMetricValue(prints[targetIdx], m);
        return v != null ? normalizeMetric(v, populationStats[m].values) : 0;
    });
    const distances = [];
    for (let i = 0; i < prints.length; i++) {
        if (i === targetIdx) continue;
        const norm = PROFILE_METRICS.map(m => {
            const v = getMetricValue(prints[i], m);
            return v != null ? normalizeMetric(v, populationStats[m].values) : 0;
        });
        let dist = 0;
        for (let j = 0; j < norm.length; j++) dist += (targetNorm[j] - norm[j]) ** 2;
        dist = Math.sqrt(dist);
        distances.push({ index: i, distance: dist });
    }
    distances.sort((a, b) => a.distance - b.distance);
    return distances.slice(0, topN);
}

function findStrengthsWeaknesses(print, populationStats) {
    const percs = PROFILE_METRICS.map(m => {
        const v = getMetricValue(print, m);
        if (v == null) return { metric: m, percentile: -1 };
        return { metric: m, percentile: computePercentile(v, populationStats[m].values) };
    }).filter(p => p.percentile >= 0);
    const sorted = [...percs].sort((a, b) => b.percentile - a.percentile);
    const strengths = sorted.slice(0, 3);
    const weaknesses = [...percs].sort((a, b) => a.percentile - b.percentile).slice(0, 3);
    return { strengths, weaknesses };
}

function searchPrints(query, allPrints) {
    if (!query) return [];
    const q = query.toLowerCase();
    const results = [];
    for (let i = 0; i < allPrints.length && results.length < 10; i++) {
        const p = allPrints[i];
        const serial = String(p.user_info.serial);
        const email = (p.user_info.email || '').toLowerCase();
        const idx = String(i);
        if (serial.includes(q) || email.includes(q) || idx === q) {
            results.push(i);
        }
    }
    return results;
}

function generateReportText(idx, allPrints, populationStats) {
    const p = allPrints[idx];
    const score = computeQualityScore(p);
    const grade = qualityGrade(score);
    let text = `PRINT PROFILE CARD\n==================\n`;
    text += `Serial: ${p.user_info.serial}\nEmail: ${p.user_info.email || 'N/A'}\n`;
    text += `Quality Grade: ${grade} (${score != null ? score.toFixed(1) : 'N/A'}/100)\n\n`;
    text += `METRICS\n-------\n`;
    for (const m of PROFILE_METRICS) {
        const v = getMetricValue(p, m);
        const st = populationStats[m];
        const pct = v != null ? computePercentile(v, st.values) : 0;
        const anom = v != null && isAnomaly(v, st.mean, st.std) ? ' ⚠️ ANOMALY' : '';
        text += `${PROFILE_METRIC_LABELS[m] || m}: ${formatNum(v)} (P${pct.toFixed(0)}, avg: ${formatNum(st.mean)})${anom}\n`;
    }
    return text;
}

// ── Test Helpers ──
function makePrint(overrides = {}) {
    const base = {
        print_data: { livePercent: 50, deadPercent: 50, elasticity: 50 },
        print_info: {
            crosslinking: { cl_duration: 15000, cl_enabled: true, cl_intensity: 50 },
            pressure: { extruder1: 50, extruder2: 50 },
            resolution: { layerHeight: 0.5, layerNum: 50 },
            wellplate: 6
        },
        user_info: { email: 'test@example.com', serial: 100 }
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

// ══════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════

describe('Quality Score Calculation', () => {
    test('perfect scores yield 100', () => {
        const p = makePrint({ print_data: { livePercent: 100, elasticity: 100 }, print_info: { resolution: { layerNum: 100 }, crosslinking: { cl_intensity: 100 } } });
        expect(computeQualityScore(p)).toBe(100);
    });

    test('all zeros yield 0', () => {
        const p = makePrint({ print_data: { livePercent: 0, elasticity: 0 }, print_info: { resolution: { layerNum: 0 }, crosslinking: { cl_intensity: 0 } } });
        expect(computeQualityScore(p)).toBe(0);
    });

    test('mid-range values yield ~50', () => {
        const p = makePrint();
        expect(computeQualityScore(p)).toBe(50);
    });

    test('weighted correctly — viability dominates', () => {
        const high = makePrint({ print_data: { livePercent: 100, elasticity: 0 }, print_info: { resolution: { layerNum: 0 }, crosslinking: { cl_intensity: 0 } } });
        expect(computeQualityScore(high)).toBe(40);
    });

    test('weighted correctly — elasticity contribution', () => {
        const p = makePrint({ print_data: { livePercent: 0, elasticity: 100 }, print_info: { resolution: { layerNum: 0 }, crosslinking: { cl_intensity: 0 } } });
        expect(computeQualityScore(p)).toBe(25);
    });

    test('weighted correctly — layer count contribution', () => {
        const p = makePrint({ print_data: { livePercent: 0, elasticity: 0 }, print_info: { resolution: { layerNum: 100 }, crosslinking: { cl_intensity: 0 } } });
        expect(computeQualityScore(p)).toBe(20);
    });

    test('weighted correctly — crosslinking contribution', () => {
        const p = makePrint({ print_data: { livePercent: 0, elasticity: 0 }, print_info: { resolution: { layerNum: 0 }, crosslinking: { cl_intensity: 100 } } });
        expect(computeQualityScore(p)).toBe(15);
    });

    test('values above 100 are clamped to 1', () => {
        const p = makePrint({ print_data: { livePercent: 200, elasticity: 200 }, print_info: { resolution: { layerNum: 200 }, crosslinking: { cl_intensity: 200 } } });
        expect(computeQualityScore(p)).toBe(100);
    });

    test('negative values are clamped to 0', () => {
        const p = makePrint({ print_data: { livePercent: -50, elasticity: -50 }, print_info: { resolution: { layerNum: -10 }, crosslinking: { cl_intensity: -10 } } });
        expect(computeQualityScore(p)).toBe(0);
    });

    test('returns null if livePercent missing', () => {
        const p = makePrint();
        delete p.print_data.livePercent;
        expect(computeQualityScore(p)).toBeNull();
    });
});

describe('Quality Grade', () => {
    test('A for score >= 80', () => { expect(qualityGrade(80)).toBe('A'); expect(qualityGrade(100)).toBe('A'); });
    test('B for score >= 60', () => { expect(qualityGrade(60)).toBe('B'); expect(qualityGrade(79)).toBe('B'); });
    test('C for score >= 40', () => { expect(qualityGrade(40)).toBe('C'); expect(qualityGrade(59)).toBe('C'); });
    test('D for score >= 20', () => { expect(qualityGrade(20)).toBe('D'); expect(qualityGrade(39)).toBe('D'); });
    test('F for score < 20', () => { expect(qualityGrade(19)).toBe('F'); expect(qualityGrade(0)).toBe('F'); });
    test('F for null score', () => { expect(qualityGrade(null)).toBe('F'); });
    test('boundary: exactly 80', () => { expect(qualityGrade(80)).toBe('A'); });
    test('boundary: exactly 79.9', () => { expect(qualityGrade(79.9)).toBe('B'); });
});

describe('Percentile Computation', () => {
    test('lowest value is 0th percentile', () => {
        expect(computePercentile(1, [1, 2, 3, 4, 5])).toBe(0);
    });

    test('highest value has correct percentile', () => {
        expect(computePercentile(5, [1, 2, 3, 4, 5])).toBe(80);
    });

    test('middle value', () => {
        expect(computePercentile(3, [1, 2, 3, 4, 5])).toBe(40);
    });

    test('empty array returns 0', () => {
        expect(computePercentile(5, [])).toBe(0);
    });

    test('null array returns 0', () => {
        expect(computePercentile(5, null)).toBe(0);
    });

    test('single value — same value is P0', () => {
        expect(computePercentile(10, [10])).toBe(0);
    });

    test('ties — counts values strictly less than', () => {
        expect(computePercentile(3, [1, 3, 3, 3, 5])).toBe(20);
    });

    test('value below all', () => {
        expect(computePercentile(0, [1, 2, 3])).toBe(0);
    });

    test('value above all', () => {
        expect(computePercentile(10, [1, 2, 3])).toBe(100);
    });
});

describe('Anomaly Detection', () => {
    test('value within 2 std is not anomaly', () => {
        expect(isAnomaly(52, 50, 5)).toBe(false);
    });

    test('value exactly at 2 std boundary is not anomaly', () => {
        expect(isAnomaly(60, 50, 5)).toBe(false);
    });

    test('value beyond 2 std is anomaly', () => {
        expect(isAnomaly(61, 50, 5)).toBe(true);
    });

    test('value below mean beyond 2 std is anomaly', () => {
        expect(isAnomaly(39, 50, 5)).toBe(true);
    });

    test('std of 0 never flags anomaly', () => {
        expect(isAnomaly(100, 50, 0)).toBe(false);
    });

    test('value exactly at mean is not anomaly', () => {
        expect(isAnomaly(50, 50, 10)).toBe(false);
    });
});

describe('Metric Normalization', () => {
    test('min value normalizes to 0', () => {
        expect(normalizeMetric(1, [1, 5, 10])).toBe(0);
    });

    test('max value normalizes to 1', () => {
        expect(normalizeMetric(10, [1, 5, 10])).toBe(1);
    });

    test('mid value normalizes proportionally', () => {
        expect(normalizeMetric(5.5, [1, 10])).toBeCloseTo(0.5, 1);
    });

    test('all same values returns 0.5', () => {
        expect(normalizeMetric(5, [5, 5, 5])).toBe(0.5);
    });

    test('empty array returns 0', () => {
        expect(normalizeMetric(5, [])).toBe(0);
    });

    test('null array returns 0', () => {
        expect(normalizeMetric(5, null)).toBe(0);
    });

    test('value outside range above', () => {
        expect(normalizeMetric(20, [1, 10])).toBeCloseTo(2.11, 1);
    });

    test('value outside range below', () => {
        expect(normalizeMetric(-5, [0, 10])).toBe(-0.5);
    });
});

describe('Similar Print Finding', () => {
    const prints = [
        makePrint({ user_info: { serial: 1 } }),
        makePrint({ user_info: { serial: 2 }, print_data: { livePercent: 51 } }),
        makePrint({ user_info: { serial: 3 }, print_data: { livePercent: 90 } }),
        makePrint({ user_info: { serial: 4 }, print_data: { livePercent: 10 } }),
    ];
    const stats = buildPopulationStats(prints);

    test('returns requested number of similar prints', () => {
        const result = findSimilarPrints(0, prints, stats, 2);
        expect(result).toHaveLength(2);
    });

    test('does not include target print', () => {
        const result = findSimilarPrints(0, prints, stats, 3);
        expect(result.every(r => r.index !== 0)).toBe(true);
    });

    test('most similar is closest by distance', () => {
        const result = findSimilarPrints(0, prints, stats, 3);
        expect(result[0].distance).toBeLessThanOrEqual(result[1].distance);
    });

    test('identical prints have distance 0', () => {
        const dup = [makePrint(), makePrint()];
        const ds = buildPopulationStats(dup);
        const result = findSimilarPrints(0, dup, ds, 1);
        expect(result[0].distance).toBe(0);
    });

    test('returns empty for single print dataset', () => {
        const single = [makePrint()];
        const ds = buildPopulationStats(single);
        const result = findSimilarPrints(0, single, ds, 3);
        expect(result).toHaveLength(0);
    });

    test('distance is non-negative', () => {
        const result = findSimilarPrints(0, prints, stats, 3);
        result.forEach(r => expect(r.distance).toBeGreaterThanOrEqual(0));
    });
});

describe('Search Functionality', () => {
    const prints = [
        makePrint({ user_info: { serial: 100, email: 'alice@test.com' } }),
        makePrint({ user_info: { serial: 200, email: 'bob@test.com' } }),
        makePrint({ user_info: { serial: 101, email: 'carol@test.com' } }),
    ];

    test('search by serial', () => {
        expect(searchPrints('100', prints)).toEqual([0]);
    });

    test('search by partial serial', () => {
        expect(searchPrints('10', prints)).toEqual([0, 2]);
    });

    test('search by email', () => {
        expect(searchPrints('bob', prints)).toEqual([1]);
    });

    test('search by index', () => {
        expect(searchPrints('2', prints)).toEqual([1, 2]);
    });

    test('empty query returns empty', () => {
        expect(searchPrints('', prints)).toEqual([]);
    });

    test('no match returns empty', () => {
        expect(searchPrints('zzz', prints)).toEqual([]);
    });

    test('case insensitive email search', () => {
        expect(searchPrints('ALICE', prints)).toEqual([0]);
    });

    test('limits to 10 results', () => {
        const many = Array.from({ length: 20 }, (_, i) => makePrint({ user_info: { serial: i, email: `u${i}@a.com` } }));
        const results = searchPrints('a.com', many);
        expect(results.length).toBeLessThanOrEqual(10);
    });
});

describe('Strengths & Weaknesses', () => {
    test('returns top 3 strengths and weaknesses', () => {
        const prints = [
            makePrint({ print_data: { livePercent: 10, deadPercent: 90, elasticity: 10 }, print_info: { crosslinking: { cl_duration: 1000, cl_intensity: 10 }, pressure: { extruder1: 10, extruder2: 10 }, resolution: { layerHeight: 0.1, layerNum: 10 }, wellplate: 6 } }),
            makePrint({ print_data: { livePercent: 90, deadPercent: 10, elasticity: 90 }, print_info: { crosslinking: { cl_duration: 30000, cl_intensity: 90 }, pressure: { extruder1: 90, extruder2: 90 }, resolution: { layerHeight: 0.9, layerNum: 90 }, wellplate: 12 } }),
        ];
        const stats = buildPopulationStats(prints);
        const sw = findStrengthsWeaknesses(prints[1], stats);
        expect(sw.strengths).toHaveLength(3);
        expect(sw.weaknesses).toHaveLength(3);
    });

    test('strengths have higher percentile than weaknesses', () => {
        const prints = [
            makePrint({ print_data: { livePercent: 10, elasticity: 10 } }),
            makePrint({ print_data: { livePercent: 90, elasticity: 90 } }),
        ];
        const stats = buildPopulationStats(prints);
        const sw = findStrengthsWeaknesses(prints[1], stats);
        expect(sw.strengths[0].percentile).toBeGreaterThanOrEqual(sw.weaknesses[0].percentile);
    });

    test('single record — all percentiles are 0', () => {
        const prints = [makePrint()];
        const stats = buildPopulationStats(prints);
        const sw = findStrengthsWeaknesses(prints[0], stats);
        sw.strengths.forEach(s => expect(s.percentile).toBe(0));
    });
});

describe('Export Text Generation', () => {
    const prints = [makePrint()];
    const stats = buildPopulationStats(prints);

    test('includes serial number', () => {
        const text = generateReportText(0, prints, stats);
        expect(text).toContain('Serial: 100');
    });

    test('includes email', () => {
        const text = generateReportText(0, prints, stats);
        expect(text).toContain('test@example.com');
    });

    test('includes quality grade', () => {
        const text = generateReportText(0, prints, stats);
        expect(text).toContain('Quality Grade:');
    });

    test('includes all metrics', () => {
        const text = generateReportText(0, prints, stats);
        expect(text).toContain('Live Cell %');
        expect(text).toContain('Elasticity');
        expect(text).toContain('Layer Count');
    });

    test('includes METRICS header', () => {
        const text = generateReportText(0, prints, stats);
        expect(text).toContain('METRICS');
    });

    test('includes percentile info', () => {
        const text = generateReportText(0, prints, stats);
        expect(text).toMatch(/P\d+/);
    });
});

describe('Edge Cases', () => {
    test('all same values — normalization returns 0.5', () => {
        const prints = Array.from({ length: 5 }, () => makePrint());
        const stats = buildPopulationStats(prints);
        expect(normalizeMetric(50, stats.livePercent.values)).toBe(0.5);
    });

    test('quality score with boundary value 80 gets A', () => {
        const p = makePrint({ print_data: { livePercent: 100, elasticity: 100 }, print_info: { resolution: { layerNum: 100 }, crosslinking: { cl_intensity: 100 } } });
        expect(qualityGrade(computeQualityScore(p))).toBe('A');
    });

    test('getMetricValue handles missing nested path', () => {
        const broken = { print_data: {}, print_info: {}, user_info: { serial: 0 } };
        expect(getMetricValue(broken, 'cl_duration')).toBeNull();
    });

    test('getMetricValue returns null for unknown metric', () => {
        expect(getMetricValue(makePrint(), 'nonexistent')).toBeNull();
    });

    test('computeStats with empty array', () => {
        const s = computeStats([]);
        expect(s.mean).toBe(0);
        expect(s.std).toBe(0);
    });

    test('computeStats with single value has std 0', () => {
        const s = computeStats([42]);
        expect(s.mean).toBe(42);
        expect(s.std).toBe(0);
    });
});
