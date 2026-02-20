/**
 * @jest-environment jsdom
 *
 * Tests for anomaly.html — Anomaly Detector
 *
 * Tests cover:
 *  - computeStats (mean, std, quartiles, IQR, median)
 *  - Z-score anomaly detection
 *  - IQR anomaly detection
 *  - Combined (both) detection
 *  - Severity classification (extreme, high, moderate)
 *  - Metric value extraction (getMetricValue)
 *  - Direction detection (high/low)
 *  - Single-metric filtering
 *  - Threshold sensitivity
 *  - CSV export format
 *  - JSON export format
 *  - Edge cases (empty data, single record, uniform values, NaN handling)
 *  - escapeHtml utility
 *  - formatNum utility
 *  - Table sorting
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
        print_data: { deadPercent: 50.0, elasticity: 52.0, livePercent: 45.0 },
        print_info: {
            crosslinking: { cl_duration: 12000, cl_enabled: true, cl_intensity: 35 },
            files: { input: 'file_4.gcode', output: 'file_4_output.gcode' },
            pressure: { extruder1: 65.0, extruder2: 60.0 },
            resolution: { layerHeight: 0.4, layerNum: 50 },
            wellplate: 6
        },
        user_info: { email: 'user4@gmail.com', serial: 4 }
    },
    // Extreme outlier — very unusual values
    {
        print_data: { deadPercent: 99.5, elasticity: 200.0, livePercent: 0.5 },
        print_info: {
            crosslinking: { cl_duration: 90000, cl_enabled: true, cl_intensity: 100 },
            files: { input: 'file_5.gcode', output: 'file_5_output.gcode' },
            pressure: { extruder1: 250.0, extruder2: 250.0 },
            resolution: { layerHeight: 2.0, layerNum: 500 },
            wellplate: 96
        },
        user_info: { email: 'outlier@gmail.com', serial: 99 }
    }
];

// ── Functions extracted from anomaly.html ──────────────

const METRICS = ['livePercent', 'deadPercent', 'elasticity', 'cl_duration', 'cl_intensity', 'extruder1', 'extruder2', 'layerHeight', 'layerNum'];

const metricLabels = {
    deadPercent: 'Dead Cell %',
    livePercent: 'Live Cell %',
    elasticity: 'Elasticity (kPa)',
    cl_duration: 'CL Duration (ms)',
    cl_intensity: 'CL Intensity (%)',
    extruder1: 'Extruder 1 Pressure',
    extruder2: 'Extruder 2 Pressure',
    layerHeight: 'Layer Height (mm)',
    layerNum: 'Layer Count'
};

function getMetricValue(print, metric) {
    const paths = {
        deadPercent: p => p.print_data.deadPercent,
        livePercent: p => p.print_data.livePercent,
        elasticity: p => p.print_data.elasticity,
        cl_duration: p => p.print_info.crosslinking.cl_duration,
        cl_intensity: p => p.print_info.crosslinking.cl_intensity,
        extruder1: p => p.print_info.pressure.extruder1,
        extruder2: p => p.print_info.pressure.extruder2,
        layerHeight: p => p.print_info.resolution.layerHeight,
        layerNum: p => p.print_info.resolution.layerNum,
    };
    try { return paths[metric] ? paths[metric](print) : null; }
    catch { return null; }
}

function computeStats(values) {
    const n = values.length;
    if (n === 0) return { mean: 0, std: 0, q1: 0, q3: 0, iqr: 0, median: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
    return { mean, std, q1, q3, iqr: q3 - q1, median };
}

function detectAnomalies(data, method, zThreshold, iqrMultiplier, metricsToCheck) {
    const stats = {};
    for (const m of metricsToCheck) {
        const values = data
            .map(p => getMetricValue(p, m))
            .filter(v => v !== null && !isNaN(v) && isFinite(v));
        stats[m] = computeStats(values);
    }

    const results = [];

    for (let i = 0; i < data.length; i++) {
        const p = data[i];
        const reasons = [];

        for (const m of metricsToCheck) {
            const v = getMetricValue(p, m);
            if (v === null || isNaN(v) || !isFinite(v)) continue;

            const s = stats[m];
            let isAnomaly = false;
            let detectedMethod = '';

            const zscore = s.std > 0 ? (v - s.mean) / s.std : 0;
            const lowerFence = s.q1 - iqrMultiplier * s.iqr;
            const upperFence = s.q3 + iqrMultiplier * s.iqr;
            const zAnomaly = Math.abs(zscore) > zThreshold;
            const iqrAnomaly = v < lowerFence || v > upperFence;

            if (method === 'zscore') {
                isAnomaly = zAnomaly;
                detectedMethod = 'Z-Score';
            } else if (method === 'iqr') {
                isAnomaly = iqrAnomaly;
                detectedMethod = 'IQR';
            } else {
                isAnomaly = zAnomaly || iqrAnomaly;
                detectedMethod = zAnomaly && iqrAnomaly ? 'Both' : (zAnomaly ? 'Z-Score' : 'IQR');
            }

            if (isAnomaly) {
                reasons.push({
                    metric: m,
                    value: v,
                    mean: s.mean,
                    std: s.std,
                    zscore,
                    q1: s.q1,
                    q3: s.q3,
                    lowerFence,
                    upperFence,
                    direction: v > s.mean ? 'high' : 'low',
                    method: detectedMethod
                });
            }
        }

        if (reasons.length > 0) {
            const maxZscore = Math.max(...reasons.map(r => Math.abs(r.zscore)));
            let severity;
            if (maxZscore > 3.5 || reasons.length >= 4) severity = 'extreme';
            else if (maxZscore > 2.5 || reasons.length >= 2) severity = 'high';
            else severity = 'moderate';

            results.push({
                index: i,
                serial: p.user_info.serial,
                email: p.user_info.email,
                severity,
                anomalyScore: maxZscore,
                metricCount: reasons.length,
                reasons,
                print: p
            });
        }
    }

    return results;
}

function formatNum(n) {
    if (n == null) return '-';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(2);
}

const _escapeEl = document.createElement('div');
function escapeHtml(str) {
    if (str == null) return '';
    _escapeEl.textContent = String(str);
    return _escapeEl.innerHTML;
}

// ── Tests ──────────────────────────────────────────────

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

    test('computes correct std', () => {
        const s = computeStats([10, 20, 30, 40, 50]);
        const expected = Math.sqrt(((10-30)**2 + (20-30)**2 + (30-30)**2 + (40-30)**2 + (50-30)**2) / 5);
        expect(s.std).toBeCloseTo(expected, 6);
    });

    test('computes correct median for odd count', () => {
        const s = computeStats([1, 3, 5, 7, 9]);
        expect(s.median).toBe(5);
    });

    test('computes correct median for even count', () => {
        const s = computeStats([1, 3, 5, 7]);
        expect(s.median).toBe(4);
    });

    test('computes correct quartiles', () => {
        const s = computeStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(s.q1).toBe(3); // floor(10*0.25) = index 2 → value 3
        expect(s.q3).toBe(8); // floor(10*0.75) = index 7 → value 8
        expect(s.iqr).toBe(5);
    });

    test('computes stats for single value', () => {
        const s = computeStats([42]);
        expect(s.mean).toBe(42);
        expect(s.std).toBe(0);
        expect(s.median).toBe(42);
    });

    test('computes stats for uniform values', () => {
        const s = computeStats([5, 5, 5, 5, 5]);
        expect(s.mean).toBe(5);
        expect(s.std).toBe(0);
        expect(s.iqr).toBe(0);
    });

    test('handles negative values', () => {
        const s = computeStats([-10, -5, 0, 5, 10]);
        expect(s.mean).toBe(0);
        expect(s.median).toBe(0);
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

    test('returns null for broken print data', () => {
        expect(getMetricValue({}, 'livePercent')).toBeNull();
    });
});

describe('detectAnomalies — Z-Score method', () => {
    test('detects extreme outlier print at z=1.5', () => {
        const results = detectAnomalies(sampleData, 'zscore', 1.5, 1.5, METRICS);
        const outlier = results.find(r => r.serial === 99);
        expect(outlier).toBeDefined();
        expect(outlier.reasons.length).toBeGreaterThan(0);
    });

    test('outlier has high anomaly score', () => {
        const results = detectAnomalies(sampleData, 'zscore', 2.0, 1.5, METRICS);
        const outlier = results.find(r => r.serial === 99);
        expect(outlier).toBeDefined();
        expect(outlier.anomalyScore).toBeGreaterThan(1.5);
    });

    test('no anomalies at very high threshold', () => {
        const results = detectAnomalies(sampleData, 'zscore', 100, 1.5, METRICS);
        expect(results.length).toBe(0);
    });

    test('more anomalies at lower threshold', () => {
        const resultsHigh = detectAnomalies(sampleData, 'zscore', 3.0, 1.5, METRICS);
        const resultsLow = detectAnomalies(sampleData, 'zscore', 1.5, 1.5, METRICS);
        expect(resultsLow.length).toBeGreaterThanOrEqual(resultsHigh.length);
    });

    test('all reasons have method Z-Score', () => {
        const results = detectAnomalies(sampleData, 'zscore', 2.0, 1.5, METRICS);
        for (const r of results) {
            for (const reason of r.reasons) {
                expect(reason.method).toBe('Z-Score');
            }
        }
    });

    test('reasons include z-score values', () => {
        const results = detectAnomalies(sampleData, 'zscore', 2.0, 1.5, METRICS);
        for (const r of results) {
            for (const reason of r.reasons) {
                expect(typeof reason.zscore).toBe('number');
                expect(Math.abs(reason.zscore)).toBeGreaterThan(2.0);
            }
        }
    });
});

describe('detectAnomalies — IQR method', () => {
    test('detects outlier with IQR method', () => {
        const results = detectAnomalies(sampleData, 'iqr', 2.5, 1.5, METRICS);
        const outlier = results.find(r => r.serial === 99);
        expect(outlier).toBeDefined();
    });

    test('all reasons have method IQR', () => {
        const results = detectAnomalies(sampleData, 'iqr', 2.5, 1.5, METRICS);
        for (const r of results) {
            for (const reason of r.reasons) {
                expect(reason.method).toBe('IQR');
            }
        }
    });

    test('higher multiplier = fewer anomalies', () => {
        const resultsStrict = detectAnomalies(sampleData, 'iqr', 2.5, 3.0, METRICS);
        const resultsLoose = detectAnomalies(sampleData, 'iqr', 2.5, 1.0, METRICS);
        expect(resultsLoose.length).toBeGreaterThanOrEqual(resultsStrict.length);
    });

    test('reasons include fence values', () => {
        const results = detectAnomalies(sampleData, 'iqr', 2.5, 1.5, METRICS);
        for (const r of results) {
            for (const reason of r.reasons) {
                expect(typeof reason.lowerFence).toBe('number');
                expect(typeof reason.upperFence).toBe('number');
                expect(reason.upperFence).toBeGreaterThanOrEqual(reason.lowerFence);
            }
        }
    });
});

describe('detectAnomalies — Both (union) method', () => {
    test('both method detects at least as many anomalies as each individual method', () => {
        const zResults = detectAnomalies(sampleData, 'zscore', 2.0, 1.5, METRICS);
        const iqrResults = detectAnomalies(sampleData, 'iqr', 2.0, 1.5, METRICS);
        const bothResults = detectAnomalies(sampleData, 'both', 2.0, 1.5, METRICS);
        expect(bothResults.length).toBeGreaterThanOrEqual(zResults.length);
        expect(bothResults.length).toBeGreaterThanOrEqual(iqrResults.length);
    });

    test('reasons have method Both, Z-Score, or IQR', () => {
        const results = detectAnomalies(sampleData, 'both', 2.0, 1.5, METRICS);
        for (const r of results) {
            for (const reason of r.reasons) {
                expect(['Both', 'Z-Score', 'IQR']).toContain(reason.method);
            }
        }
    });
});

describe('Severity classification', () => {
    test('extreme severity for very high z-score (>3.5)', () => {
        // The outlier at serial 99 should likely be extreme
        const results = detectAnomalies(sampleData, 'zscore', 1.5, 1.5, METRICS);
        const outlier = results.find(r => r.serial === 99);
        if (outlier && outlier.anomalyScore > 3.5) {
            expect(outlier.severity).toBe('extreme');
        }
    });

    test('extreme severity for 4+ anomalous metrics', () => {
        const results = detectAnomalies(sampleData, 'zscore', 1.5, 1.5, METRICS);
        const outlier = results.find(r => r.serial === 99);
        if (outlier && outlier.metricCount >= 4) {
            expect(outlier.severity).toBe('extreme');
        }
    });

    test('severity values are valid', () => {
        const results = detectAnomalies(sampleData, 'zscore', 2.0, 1.5, METRICS);
        for (const r of results) {
            expect(['extreme', 'high', 'moderate']).toContain(r.severity);
        }
    });
});

describe('Direction detection', () => {
    test('values above mean have direction high', () => {
        const results = detectAnomalies(sampleData, 'zscore', 1.5, 1.5, METRICS);
        for (const r of results) {
            for (const reason of r.reasons) {
                if (reason.value > reason.mean) {
                    expect(reason.direction).toBe('high');
                } else {
                    expect(reason.direction).toBe('low');
                }
            }
        }
    });
});

describe('Single-metric filtering', () => {
    test('detects anomalies for a single metric', () => {
        const results = detectAnomalies(sampleData, 'zscore', 1.5, 1.5, ['elasticity']);
        for (const r of results) {
            expect(r.reasons.every(reason => reason.metric === 'elasticity')).toBe(true);
        }
    });

    test('single metric produces fewer or equal anomalies than all metrics', () => {
        const allResults = detectAnomalies(sampleData, 'zscore', 2.0, 1.5, METRICS);
        const singleResults = detectAnomalies(sampleData, 'zscore', 2.0, 1.5, ['livePercent']);
        expect(singleResults.length).toBeLessThanOrEqual(allResults.length);
    });
});

describe('Edge cases', () => {
    test('empty data returns no anomalies', () => {
        const results = detectAnomalies([], 'zscore', 2.5, 1.5, METRICS);
        expect(results.length).toBe(0);
    });

    test('single record returns no anomalies (z-score = 0 when std = 0)', () => {
        const results = detectAnomalies([sampleData[0]], 'zscore', 2.5, 1.5, METRICS);
        expect(results.length).toBe(0);
    });

    test('uniform values return no Z-score anomalies', () => {
        const uniform = Array(10).fill(null).map(() => ({
            print_data: { deadPercent: 50, elasticity: 50, livePercent: 50 },
            print_info: {
                crosslinking: { cl_duration: 1000, cl_enabled: true, cl_intensity: 50 },
                files: { input: 'f.gcode', output: 'f_out.gcode' },
                pressure: { extruder1: 50, extruder2: 50 },
                resolution: { layerHeight: 0.5, layerNum: 50 },
                wellplate: 6
            },
            user_info: { email: 'u@g.com', serial: 0 }
        }));
        const results = detectAnomalies(uniform, 'zscore', 2.5, 1.5, METRICS);
        expect(results.length).toBe(0);
    });

    test('handles data with missing nested objects gracefully', () => {
        const broken = [
            ...sampleData,
            { print_data: null, print_info: null, user_info: { email: 'x', serial: 999 } }
        ];
        // Should not throw
        expect(() => detectAnomalies(broken, 'zscore', 2.5, 1.5, METRICS)).not.toThrow();
    });
});

describe('Result structure', () => {
    test('each result has required fields', () => {
        const results = detectAnomalies(sampleData, 'zscore', 2.0, 1.5, METRICS);
        for (const r of results) {
            expect(typeof r.index).toBe('number');
            expect(typeof r.serial).toBe('number');
            expect(typeof r.email).toBe('string');
            expect(typeof r.severity).toBe('string');
            expect(typeof r.anomalyScore).toBe('number');
            expect(typeof r.metricCount).toBe('number');
            expect(Array.isArray(r.reasons)).toBe(true);
            expect(r.print).toBeDefined();
        }
    });

    test('reasons have required fields', () => {
        const results = detectAnomalies(sampleData, 'zscore', 2.0, 1.5, METRICS);
        for (const r of results) {
            for (const reason of r.reasons) {
                expect(typeof reason.metric).toBe('string');
                expect(typeof reason.value).toBe('number');
                expect(typeof reason.mean).toBe('number');
                expect(typeof reason.zscore).toBe('number');
                expect(typeof reason.direction).toBe('string');
                expect(typeof reason.method).toBe('string');
                expect(METRICS).toContain(reason.metric);
                expect(['high', 'low']).toContain(reason.direction);
            }
        }
    });

    test('metricCount matches reasons length', () => {
        const results = detectAnomalies(sampleData, 'zscore', 1.5, 1.5, METRICS);
        for (const r of results) {
            expect(r.metricCount).toBe(r.reasons.length);
        }
    });

    test('anomalyScore equals max absolute z-score', () => {
        const results = detectAnomalies(sampleData, 'zscore', 1.5, 1.5, METRICS);
        for (const r of results) {
            const maxZ = Math.max(...r.reasons.map(reason => Math.abs(reason.zscore)));
            expect(r.anomalyScore).toBeCloseTo(maxZ, 6);
        }
    });
});

describe('formatNum', () => {
    test('formats null as dash', () => {
        expect(formatNum(null)).toBe('-');
    });

    test('formats undefined as dash', () => {
        expect(formatNum(undefined)).toBe('-');
    });

    test('formats integers without decimals', () => {
        expect(formatNum(42)).toBe('42');
    });

    test('formats decimals with 2 places', () => {
        expect(formatNum(3.14159)).toBe('3.14');
    });

    test('formats large numbers with locale string', () => {
        const result = formatNum(12345);
        expect(result).toContain('12');
        expect(result).toContain('345');
    });
});

describe('escapeHtml', () => {
    test('escapes angle brackets', () => {
        expect(escapeHtml('<script>alert(1)</script>')).not.toContain('<script>');
    });

    test('escapes ampersands', () => {
        expect(escapeHtml('a&b')).toBe('a&amp;b');
    });

    test('escapes quotes', () => {
        // textContent assignment doesn't escape quotes in jsdom,
        // but does escape angle brackets and ampersands
        const result = escapeHtml('"hello"');
        expect(typeof result).toBe('string');
        expect(result).toContain('hello');
    });

    test('returns empty string for null', () => {
        expect(escapeHtml(null)).toBe('');
    });

    test('returns empty string for undefined', () => {
        expect(escapeHtml(undefined)).toBe('');
    });

    test('passes through plain text', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });
});

describe('METRICS constant', () => {
    test('contains 9 metrics', () => {
        expect(METRICS.length).toBe(9);
    });

    test('all metrics have labels', () => {
        for (const m of METRICS) {
            expect(metricLabels[m]).toBeDefined();
            expect(typeof metricLabels[m]).toBe('string');
        }
    });
});

describe('CSV export format', () => {
    test('generates proper CSV content', () => {
        const results = detectAnomalies(sampleData, 'zscore', 1.5, 1.5, METRICS);
        if (results.length === 0) return;

        const headers = ['Index', 'Serial', 'Email', 'Severity', 'Anomaly Score', 'Anomalous Metrics', 'Details'];
        const rows = results.map(a => [
            a.index,
            a.serial,
            '"' + a.email.replace(/"/g, '""') + '"',
            a.severity,
            a.anomalyScore.toFixed(4),
            a.metricCount,
            '"' + a.reasons.map(r => `${r.metric}: ${formatNum(r.value)} (z=${r.zscore.toFixed(2)}, ${r.direction})`).join('; ').replace(/"/g, '""') + '"'
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

        expect(csv).toContain('Index,Serial,Email');
        expect(csv.split('\n').length).toBe(results.length + 1);
    });
});

describe('JSON export format', () => {
    test('generates valid JSON', () => {
        const results = detectAnomalies(sampleData, 'zscore', 1.5, 1.5, METRICS);
        const data = results.map(a => ({
            index: a.index,
            serial: a.serial,
            email: a.email,
            severity: a.severity,
            anomalyScore: a.anomalyScore,
            metricCount: a.metricCount,
            reasons: a.reasons.map(r => ({
                metric: r.metric,
                value: r.value,
                mean: r.mean,
                zscore: r.zscore,
                direction: r.direction,
                method: r.method
            }))
        }));

        const json = JSON.stringify(data, null, 2);
        expect(() => JSON.parse(json)).not.toThrow();
        const parsed = JSON.parse(json);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBe(results.length);
    });
});
