/**
 * @jest-environment jsdom
 */

describe('Parameter Recommender', () => {

    // ── Helper functions (extracted from recommender.html) ──

    function fmtNum(n) {
        if (n === undefined || n === null) return '\u2014';
        if (Number.isInteger(n)) return n.toString();
        if (Math.abs(n) >= 100) return n.toFixed(1);
        if (Math.abs(n) >= 1) return n.toFixed(2);
        return n.toFixed(4);
    }

    function checkParam(val, optMin, optMax) {
        if (val >= optMin && val <= optMax) return 100;
        var range = optMax - optMin;
        var guardBand = range > 0 ? range : 1;
        if (val < optMin) return Math.max(0, 100 - ((optMin - val) / guardBand) * 100);
        return Math.max(0, 100 - ((val - optMax) / guardBand) * 100);
    }

    function computeConfidence(cvValues, count) {
        var confidence = 0;
        for (var i = 0; i < cvValues.length; i++) {
            confidence += Math.max(0, 1 - cvValues[i] / 100);
        }
        var confScore = cvValues.length > 0 ? Math.round((confidence / cvValues.length) * 100) : 0;
        var sizeBonus = Math.min(count / 100, 1) * 10;
        return Math.min(Math.round(confScore * 0.8 + sizeBonus + 10), 99);
    }

    function classifyConfidence(score) {
        if (score >= 70) return 'High Confidence';
        if (score >= 40) return 'Moderate Confidence';
        return 'Low Confidence';
    }

    function compatVerdict(avg) {
        if (avg >= 80) return 'well-aligned';
        if (avg >= 50) return 'could be adjusted';
        return 'revising';
    }

    function statusBadge(score) {
        if (score >= 80) return 'Good';
        if (score >= 50) return 'Fair';
        return 'Off';
    }

    function spreadLabel(cv) {
        if (cv < 30) return 'Tight';
        if (cv < 60) return 'Moderate';
        return 'Wide';
    }

    function rangePosition(val, min, max) {
        if (max === min) return 0;
        return ((val - min) / (max - min)) * 100;
    }

    // ── fmtNum ──────────────────────────────────────────

    describe('fmtNum', () => {
        test('returns dash for null', () => {
            expect(fmtNum(null)).toBe('\u2014');
        });

        test('returns dash for undefined', () => {
            expect(fmtNum(undefined)).toBe('\u2014');
        });

        test('formats integers without decimals', () => {
            expect(fmtNum(42)).toBe('42');
            expect(fmtNum(0)).toBe('0');
        });

        test('formats large numbers to 1 decimal', () => {
            expect(fmtNum(123.456)).toBe('123.5');
        });

        test('formats medium numbers to 2 decimals', () => {
            expect(fmtNum(3.14159)).toBe('3.14');
        });

        test('formats small numbers to 4 decimals', () => {
            expect(fmtNum(0.12345)).toBe('0.1235');
        });

        test('handles negative large', () => {
            expect(fmtNum(-500.123)).toBe('-500.1');
        });

        test('handles negative small', () => {
            expect(fmtNum(-0.001)).toBe('-0.0010');
        });

        test('handles negative medium', () => {
            expect(fmtNum(-5.678)).toBe('-5.68');
        });
    });

    // ── checkParam (compatibility scoring) ──────────────

    describe('checkParam', () => {
        test('inside optimal range returns 100', () => {
            expect(checkParam(40, 25, 55)).toBe(100);
        });

        test('at lower boundary returns 100', () => {
            expect(checkParam(25, 25, 55)).toBe(100);
        });

        test('at upper boundary returns 100', () => {
            expect(checkParam(55, 25, 55)).toBe(100);
        });

        test('slightly below range scores < 100', () => {
            var s = checkParam(20, 25, 55);
            expect(s).toBeGreaterThan(0);
            expect(s).toBeLessThan(100);
        });

        test('far below range scores 0', () => {
            expect(checkParam(-100, 25, 55)).toBe(0);
        });

        test('slightly above range scores < 100', () => {
            var s = checkParam(60, 25, 55);
            expect(s).toBeGreaterThan(0);
            expect(s).toBeLessThan(100);
        });

        test('far above range scores 0', () => {
            expect(checkParam(200, 25, 55)).toBe(0);
        });

        test('zero-width range uses guardBand of 1', () => {
            expect(checkParam(5, 5, 5)).toBe(100);
            expect(checkParam(6, 5, 5)).toBe(0);
        });

        test('linear decrease with distance', () => {
            var s1 = checkParam(50, 25, 55);
            var s2 = checkParam(60, 25, 55);
            var s3 = checkParam(70, 25, 55);
            expect(s1).toBeGreaterThan(s2);
            expect(s2).toBeGreaterThan(s3);
        });

        test('symmetric around range', () => {
            var below = checkParam(15, 25, 55);
            var above = checkParam(65, 25, 55);
            expect(below).toBeCloseTo(above, 5);
        });
    });

    // ── computeConfidence ───────────────────────────────

    describe('computeConfidence', () => {
        test('zero CV gives highest confidence', () => {
            var c = computeConfidence([0, 0, 0], 200);
            expect(c).toBeGreaterThanOrEqual(90);
        });

        test('high CV gives lower confidence', () => {
            var c = computeConfidence([80, 90, 85], 200);
            expect(c).toBeLessThan(40);
        });

        test('more samples increase confidence', () => {
            var small = computeConfidence([30], 10);
            var large = computeConfidence([30], 500);
            expect(large).toBeGreaterThan(small);
        });

        test('capped at 99', () => {
            expect(computeConfidence([0], 10000)).toBeLessThanOrEqual(99);
        });

        test('handles empty cvValues', () => {
            var c = computeConfidence([], 100);
            expect(c).toBeLessThanOrEqual(99);
            expect(c).toBeGreaterThanOrEqual(0);
        });

        test('single metric with moderate CV', () => {
            var c = computeConfidence([50], 100);
            expect(c).toBeGreaterThan(30);
            expect(c).toBeLessThan(80);
        });
    });

    // ── classifyConfidence ──────────────────────────────

    describe('classifyConfidence', () => {
        test('high >= 70', () => {
            expect(classifyConfidence(70)).toBe('High Confidence');
            expect(classifyConfidence(99)).toBe('High Confidence');
        });

        test('moderate 40-69', () => {
            expect(classifyConfidence(40)).toBe('Moderate Confidence');
            expect(classifyConfidence(69)).toBe('Moderate Confidence');
        });

        test('low < 40', () => {
            expect(classifyConfidence(39)).toBe('Low Confidence');
            expect(classifyConfidence(0)).toBe('Low Confidence');
        });
    });

    // ── compatVerdict ───────────────────────────────────

    describe('compatVerdict', () => {
        test('well-aligned for 80+', () => {
            expect(compatVerdict(80)).toBe('well-aligned');
            expect(compatVerdict(100)).toBe('well-aligned');
        });

        test('could be adjusted for 50-79', () => {
            expect(compatVerdict(50)).toBe('could be adjusted');
            expect(compatVerdict(79)).toBe('could be adjusted');
        });

        test('revising for < 50', () => {
            expect(compatVerdict(49)).toBe('revising');
            expect(compatVerdict(0)).toBe('revising');
        });
    });

    // ── statusBadge ─────────────────────────────────────

    describe('statusBadge', () => {
        test('Good for 80+', () => {
            expect(statusBadge(80)).toBe('Good');
            expect(statusBadge(100)).toBe('Good');
        });

        test('Fair for 50-79', () => {
            expect(statusBadge(50)).toBe('Fair');
            expect(statusBadge(79)).toBe('Fair');
        });

        test('Off for < 50', () => {
            expect(statusBadge(49)).toBe('Off');
            expect(statusBadge(0)).toBe('Off');
        });
    });

    // ── spreadLabel ─────────────────────────────────────

    describe('spreadLabel', () => {
        test('Tight for CV < 30', () => {
            expect(spreadLabel(0)).toBe('Tight');
            expect(spreadLabel(29)).toBe('Tight');
        });

        test('Moderate for CV 30-59', () => {
            expect(spreadLabel(30)).toBe('Moderate');
            expect(spreadLabel(59)).toBe('Moderate');
        });

        test('Wide for CV >= 60', () => {
            expect(spreadLabel(60)).toBe('Wide');
            expect(spreadLabel(100)).toBe('Wide');
        });
    });

    // ── rangePosition ───────────────────────────────────

    describe('rangePosition', () => {
        test('min maps to 0%', () => {
            expect(rangePosition(10, 10, 80)).toBe(0);
        });

        test('max maps to 100%', () => {
            expect(rangePosition(80, 10, 80)).toBe(100);
        });

        test('midpoint maps to ~50%', () => {
            expect(rangePosition(45, 10, 80)).toBeCloseTo(50, 0);
        });

        test('zero range returns 0', () => {
            expect(rangePosition(5, 5, 5)).toBe(0);
        });

        test('optimal band width proportional', () => {
            var left = rangePosition(25, 10, 80);
            var right = rangePosition(55, 10, 80);
            var width = right - left;
            expect(width).toBeCloseTo(42.86, 1);
        });
    });

    // ── Recommendation building ─────────────────────────

    describe('buildRecommendation logic', () => {
        var PARAMS = [
            { key: 'extruder1', label: 'Ext1', unit: 'psi' },
            { key: 'cl_duration', label: 'CL', unit: 'ms' },
        ];

        function buildRec(metrics, count, topPct, obj) {
            var ranges = {};
            var cvValues = [];
            for (var i = 0; i < PARAMS.length; i++) {
                var m = metrics[PARAMS[i].key];
                if (!m) continue;
                var optMin, optMax;
                if (obj === 'balanced') {
                    var iqr = m.q3 - m.q1;
                    optMin = m.median - iqr * 0.3;
                    optMax = m.median + iqr * 0.3;
                } else {
                    optMin = m.q1;
                    optMax = m.q3;
                }
                ranges[PARAMS[i].key] = {
                    optMin: Math.max(optMin, m.min),
                    optMax: Math.min(optMax, m.max),
                    ideal: m.median, min: m.min, max: m.max,
                };
                cvValues.push(m.coefficientOfVariation || 0);
            }
            return {
                ranges: ranges,
                confidence: computeConfidence(cvValues, count),
                sampleSize: Math.round(count * topPct / 100),
            };
        }

        var metrics = {
            extruder1: { min: 10, max: 80, q1: 25, q3: 55, median: 40, mean: 39, std: 15, coefficientOfVariation: 38 },
            cl_duration: { min: 0, max: 5000, q1: 1000, q3: 3000, median: 2000, mean: 1900, std: 900, coefficientOfVariation: 47 },
        };

        test('viability uses Q1-Q3', () => {
            var rec = buildRec(metrics, 200, 20, 'viability');
            expect(rec.ranges.extruder1.optMin).toBe(25);
            expect(rec.ranges.extruder1.optMax).toBe(55);
        });

        test('balanced uses narrower range', () => {
            var rec = buildRec(metrics, 200, 20, 'balanced');
            expect(rec.ranges.extruder1.optMin).toBeGreaterThan(25);
            expect(rec.ranges.extruder1.optMax).toBeLessThan(55);
        });

        test('optimal range clamped to data range', () => {
            var narrow = {
                extruder1: { min: 30, max: 50, q1: 20, q3: 60, median: 40, mean: 40, std: 5, coefficientOfVariation: 12 },
            };
            var rec = buildRec(narrow, 100, 20, 'viability');
            expect(rec.ranges.extruder1.optMin).toBe(30);
            expect(rec.ranges.extruder1.optMax).toBe(50);
        });

        test('sample size is correct', () => {
            var rec = buildRec(metrics, 500, 10, 'viability');
            expect(rec.sampleSize).toBe(50);
        });

        test('handles missing metrics gracefully', () => {
            var rec = buildRec({ extruder1: metrics.extruder1 }, 100, 20, 'viability');
            expect(Object.keys(rec.ranges)).toHaveLength(1);
        });

        test('confidence higher with low CV', () => {
            var lowCV = {
                extruder1: { min: 10, max: 80, q1: 35, q3: 45, median: 40, mean: 40, std: 3, coefficientOfVariation: 7 },
            };
            var highCV = {
                extruder1: { min: 10, max: 80, q1: 15, q3: 75, median: 40, mean: 40, std: 30, coefficientOfVariation: 75 },
            };
            var recLow = buildRec(lowCV, 200, 20, 'viability');
            var recHigh = buildRec(highCV, 200, 20, 'viability');
            expect(recLow.confidence).toBeGreaterThan(recHigh.confidence);
        });
    });
});
