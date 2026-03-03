/**
 * @jest-environment jsdom
 */

describe('Reproducibility Analyzer', () => {

    // ── Functions extracted from reproducibility.html ──

    function getGroupKey(record, groupBy) {
        var info = record.print_info;
        if (!info) return null;
        switch (groupBy) {
            case 'wellplate':
                return 'WP-' + info.wellplate;
            case 'cl_intensity':
                return 'CL-' + (info.crosslinking ? info.crosslinking.cl_intensity : '?') + '%';
            case 'cl_duration_bin': {
                var dur = info.crosslinking ? info.crosslinking.cl_duration : 0;
                if (dur < 5000) return 'CL <5s';
                if (dur < 15000) return 'CL 5-15s';
                if (dur < 30000) return 'CL 15-30s';
                return 'CL >30s';
            }
            case 'layerNum':
                return info.resolution ? info.resolution.layerNum + ' layers' : null;
            case 'layerHeight':
                return info.resolution ? info.resolution.layerHeight + 'mm' : null;
            case 'wellplate+cl':
                return 'WP-' + info.wellplate + ' / CL-' +
                    (info.crosslinking ? info.crosslinking.cl_intensity : '?') + '%';
            default:
                return null;
        }
    }

    function groupPrints(data, groupBy) {
        var groups = {};
        for (var i = 0; i < data.length; i++) {
            var key = getGroupKey(data[i], groupBy);
            if (key == null) continue;
            if (!groups[key]) groups[key] = [];
            groups[key].push(data[i]);
        }
        return groups;
    }

    function mean(values) {
        if (values.length === 0) return 0;
        var sum = 0;
        for (var i = 0; i < values.length; i++) sum += values[i];
        return sum / values.length;
    }

    function stddev(values) {
        if (values.length < 2) return 0;
        var m = mean(values);
        var sumSq = 0;
        for (var i = 0; i < values.length; i++) {
            var d = values[i] - m;
            sumSq += d * d;
        }
        return Math.sqrt(sumSq / (values.length - 1));
    }

    function coefficientOfVariation(values) {
        var m = mean(values);
        if (Math.abs(m) < 0.0001) return 0;
        return (stddev(values) / Math.abs(m)) * 100;
    }

    function cvGrade(cv) {
        if (cv <= 10) return 'excellent';
        if (cv <= 20) return 'good';
        if (cv <= 30) return 'fair';
        return 'poor';
    }

    function cvGradeLabel(cv) {
        if (cv <= 10) return 'Excellent';
        if (cv <= 20) return 'Good';
        if (cv <= 30) return 'Fair';
        return 'Poor';
    }

    function reproducibilityScore(cv) {
        return Math.max(0, Math.min(100, 100 - cv * 2));
    }

    function extractValues(prints, metricGet) {
        var vals = [];
        for (var i = 0; i < prints.length; i++) {
            try {
                var v = metricGet(prints[i]);
                if (v != null && typeof v === 'number' && isFinite(v)) vals.push(v);
            } catch (e) { /* skip */ }
        }
        return vals;
    }

    // ── Test Data ──

    function makeRecord(opts) {
        var o = opts || {};
        return {
            print_data: Object.assign({ livePercent: 80, deadPercent: 20, elasticity: 3.5 }, o.data || {}),
            print_info: {
                crosslinking: Object.assign({ cl_duration: 10000, cl_intensity: 50, cl_enabled: true }, o.cl || {}),
                pressure: Object.assign({ extruder1: 40, extruder2: 35 }, o.pressure || {}),
                resolution: Object.assign({ layerHeight: 0.3, layerNum: 10 }, o.resolution || {}),
                wellplate: o.wellplate || 24,
                files: { input: 'test.gcode', output: 'out.gcode' },
            },
            user_info: { serial: o.serial || 0, email: 'test@lab.com' },
        };
    }

    // ── mean ──

    describe('mean', () => {
        test('empty array returns 0', () => {
            expect(mean([])).toBe(0);
        });

        test('single value', () => {
            expect(mean([42])).toBe(42);
        });

        test('multiple values', () => {
            expect(mean([10, 20, 30])).toBe(20);
        });

        test('decimal values', () => {
            expect(mean([1.5, 2.5])).toBe(2);
        });

        test('negative values', () => {
            expect(mean([-10, 10])).toBe(0);
        });

        test('all same values', () => {
            expect(mean([5, 5, 5, 5])).toBe(5);
        });
    });

    // ── stddev ──

    describe('stddev', () => {
        test('empty array returns 0', () => {
            expect(stddev([])).toBe(0);
        });

        test('single value returns 0', () => {
            expect(stddev([42])).toBe(0);
        });

        test('all same values returns 0', () => {
            expect(stddev([5, 5, 5])).toBe(0);
        });

        test('known values', () => {
            // [2, 4, 4, 4, 5, 5, 7, 9] → sample std ≈ 2.138
            var result = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
            expect(result).toBeCloseTo(2.138, 2);
        });

        test('two values', () => {
            // [0, 10] → mean=5, sample std = sqrt(50/1) ≈ 7.07
            expect(stddev([0, 10])).toBeCloseTo(7.071, 2);
        });

        test('uses sample stddev (n-1)', () => {
            // [1, 3] → mean=2, deviations: [-1, 1], sum_sq=2, variance=2/1=2, std=sqrt(2)
            expect(stddev([1, 3])).toBeCloseTo(Math.sqrt(2), 6);
        });
    });

    // ── coefficientOfVariation ──

    describe('coefficientOfVariation', () => {
        test('empty array returns 0', () => {
            expect(coefficientOfVariation([])).toBe(0);
        });

        test('all same values returns 0', () => {
            expect(coefficientOfVariation([10, 10, 10])).toBe(0);
        });

        test('known CV', () => {
            // [100, 100, 100, 100, 200] → mean=120, std≈44.72, CV≈37.27%
            var cv = coefficientOfVariation([100, 100, 100, 100, 200]);
            expect(cv).toBeGreaterThan(30);
            expect(cv).toBeLessThan(45);
        });

        test('mean near zero returns 0', () => {
            expect(coefficientOfVariation([0.00001, -0.00001])).toBe(0);
        });

        test('negative mean uses absolute value', () => {
            var cv = coefficientOfVariation([-100, -110, -90]);
            expect(cv).toBeGreaterThan(0);
        });
    });

    // ── cvGrade ──

    describe('cvGrade', () => {
        test('CV 0 is excellent', () => { expect(cvGrade(0)).toBe('excellent'); });
        test('CV 5 is excellent', () => { expect(cvGrade(5)).toBe('excellent'); });
        test('CV 10 is excellent', () => { expect(cvGrade(10)).toBe('excellent'); });
        test('CV 11 is good', () => { expect(cvGrade(11)).toBe('good'); });
        test('CV 20 is good', () => { expect(cvGrade(20)).toBe('good'); });
        test('CV 21 is fair', () => { expect(cvGrade(21)).toBe('fair'); });
        test('CV 30 is fair', () => { expect(cvGrade(30)).toBe('fair'); });
        test('CV 31 is poor', () => { expect(cvGrade(31)).toBe('poor'); });
        test('CV 100 is poor', () => { expect(cvGrade(100)).toBe('poor'); });
    });

    // ── cvGradeLabel ──

    describe('cvGradeLabel', () => {
        test('CV 5 → Excellent', () => { expect(cvGradeLabel(5)).toBe('Excellent'); });
        test('CV 15 → Good', () => { expect(cvGradeLabel(15)).toBe('Good'); });
        test('CV 25 → Fair', () => { expect(cvGradeLabel(25)).toBe('Fair'); });
        test('CV 50 → Poor', () => { expect(cvGradeLabel(50)).toBe('Poor'); });
    });

    // ── reproducibilityScore ──

    describe('reproducibilityScore', () => {
        test('CV 0 → score 100', () => { expect(reproducibilityScore(0)).toBe(100); });
        test('CV 50 → score 0', () => { expect(reproducibilityScore(50)).toBe(0); });
        test('CV 25 → score 50', () => { expect(reproducibilityScore(25)).toBe(50); });
        test('CV 10 → score 80', () => { expect(reproducibilityScore(10)).toBe(80); });
        test('CV > 50 clamped to 0', () => { expect(reproducibilityScore(100)).toBe(0); });
        test('negative CV clamped to 100', () => { expect(reproducibilityScore(-10)).toBe(100); });
    });

    // ── getGroupKey ──

    describe('getGroupKey', () => {
        var record = makeRecord({ wellplate: 24, cl: { cl_intensity: 50, cl_duration: 10000 }, resolution: { layerNum: 10, layerHeight: 0.3 } });

        test('wellplate grouping', () => {
            expect(getGroupKey(record, 'wellplate')).toBe('WP-24');
        });

        test('cl_intensity grouping', () => {
            expect(getGroupKey(record, 'cl_intensity')).toBe('CL-50%');
        });

        test('cl_duration_bin <5s', () => {
            var r = makeRecord({ cl: { cl_duration: 3000 } });
            expect(getGroupKey(r, 'cl_duration_bin')).toBe('CL <5s');
        });

        test('cl_duration_bin 5-15s', () => {
            var r = makeRecord({ cl: { cl_duration: 10000 } });
            expect(getGroupKey(r, 'cl_duration_bin')).toBe('CL 5-15s');
        });

        test('cl_duration_bin 15-30s', () => {
            var r = makeRecord({ cl: { cl_duration: 20000 } });
            expect(getGroupKey(r, 'cl_duration_bin')).toBe('CL 15-30s');
        });

        test('cl_duration_bin >30s', () => {
            var r = makeRecord({ cl: { cl_duration: 35000 } });
            expect(getGroupKey(r, 'cl_duration_bin')).toBe('CL >30s');
        });

        test('layerNum grouping', () => {
            expect(getGroupKey(record, 'layerNum')).toBe('10 layers');
        });

        test('layerHeight grouping', () => {
            expect(getGroupKey(record, 'layerHeight')).toBe('0.3mm');
        });

        test('wellplate+cl grouping', () => {
            expect(getGroupKey(record, 'wellplate+cl')).toBe('WP-24 / CL-50%');
        });

        test('unknown groupBy returns null', () => {
            expect(getGroupKey(record, 'nonsense')).toBeNull();
        });

        test('missing print_info returns null', () => {
            expect(getGroupKey({ print_data: {} }, 'wellplate')).toBeNull();
        });

        test('missing crosslinking shows ?', () => {
            var r = { print_info: { wellplate: 6 } };
            expect(getGroupKey(r, 'cl_intensity')).toBe('CL-?%');
        });

        test('missing resolution returns null for layerNum', () => {
            var r = { print_info: { wellplate: 6 } };
            expect(getGroupKey(r, 'layerNum')).toBeNull();
        });
    });

    // ── groupPrints ──

    describe('groupPrints', () => {
        test('groups by wellplate', () => {
            var data = [
                makeRecord({ wellplate: 6 }),
                makeRecord({ wellplate: 24 }),
                makeRecord({ wellplate: 6 }),
            ];
            var groups = groupPrints(data, 'wellplate');
            expect(Object.keys(groups)).toHaveLength(2);
            expect(groups['WP-6']).toHaveLength(2);
            expect(groups['WP-24']).toHaveLength(1);
        });

        test('empty data returns empty groups', () => {
            var groups = groupPrints([], 'wellplate');
            expect(Object.keys(groups)).toHaveLength(0);
        });

        test('skips records with null key', () => {
            var data = [
                makeRecord({ wellplate: 6 }),
                { print_data: { livePercent: 50 } }, // no print_info
            ];
            var groups = groupPrints(data, 'wellplate');
            expect(Object.keys(groups)).toHaveLength(1);
            expect(groups['WP-6']).toHaveLength(1);
        });

        test('groups by cl_duration_bin', () => {
            var data = [
                makeRecord({ cl: { cl_duration: 1000 } }),
                makeRecord({ cl: { cl_duration: 2000 } }),
                makeRecord({ cl: { cl_duration: 20000 } }),
            ];
            var groups = groupPrints(data, 'cl_duration_bin');
            expect(groups['CL <5s']).toHaveLength(2);
            expect(groups['CL 15-30s']).toHaveLength(1);
        });

        test('compound grouping creates distinct keys', () => {
            var data = [
                makeRecord({ wellplate: 6, cl: { cl_intensity: 30 } }),
                makeRecord({ wellplate: 6, cl: { cl_intensity: 50 } }),
                makeRecord({ wellplate: 24, cl: { cl_intensity: 30 } }),
            ];
            var groups = groupPrints(data, 'wellplate+cl');
            expect(Object.keys(groups)).toHaveLength(3);
        });
    });

    // ── extractValues ──

    describe('extractValues', () => {
        var getter = function(p) { return p.print_data.livePercent; };

        test('extracts numeric values', () => {
            var prints = [makeRecord({ data: { livePercent: 80 } }), makeRecord({ data: { livePercent: 90 } })];
            expect(extractValues(prints, getter)).toEqual([80, 90]);
        });

        test('skips null values', () => {
            var prints = [
                makeRecord({ data: { livePercent: 80 } }),
                makeRecord({ data: { livePercent: null } }),
            ];
            expect(extractValues(prints, getter)).toEqual([80]);
        });

        test('skips non-numeric values', () => {
            var prints = [
                makeRecord({ data: { livePercent: 'abc' } }),
                makeRecord({ data: { livePercent: 90 } }),
            ];
            expect(extractValues(prints, getter)).toEqual([90]);
        });

        test('skips NaN and Infinity', () => {
            var prints = [
                makeRecord({ data: { livePercent: NaN } }),
                makeRecord({ data: { livePercent: Infinity } }),
                makeRecord({ data: { livePercent: 50 } }),
            ];
            expect(extractValues(prints, getter)).toEqual([50]);
        });

        test('handles exceptions in getter', () => {
            var badGetter = function(p) { return p.nonexistent.field; };
            var prints = [makeRecord()];
            expect(extractValues(prints, badGetter)).toEqual([]);
        });

        test('empty prints returns empty', () => {
            expect(extractValues([], getter)).toEqual([]);
        });
    });

    // ── Integration-style tests ──

    describe('full analysis workflow', () => {
        test('identical prints produce CV 0 and score 100', () => {
            var prints = [];
            for (var i = 0; i < 10; i++) prints.push(makeRecord({ data: { livePercent: 85 } }));
            var values = extractValues(prints, function(p) { return p.print_data.livePercent; });
            expect(coefficientOfVariation(values)).toBe(0);
            expect(reproducibilityScore(0)).toBe(100);
        });

        test('highly variable prints produce high CV and low score', () => {
            var prints = [
                makeRecord({ data: { livePercent: 10 } }),
                makeRecord({ data: { livePercent: 90 } }),
                makeRecord({ data: { livePercent: 50 } }),
                makeRecord({ data: { livePercent: 5 } }),
                makeRecord({ data: { livePercent: 95 } }),
            ];
            var values = extractValues(prints, function(p) { return p.print_data.livePercent; });
            var cv = coefficientOfVariation(values);
            expect(cv).toBeGreaterThan(50);
            expect(reproducibilityScore(cv)).toBe(0);
            expect(cvGrade(cv)).toBe('poor');
        });

        test('grouping + analysis produces expected structure', () => {
            var data = [];
            // Group 1: consistent (WP-6)
            for (var i = 0; i < 5; i++) data.push(makeRecord({ wellplate: 6, data: { livePercent: 80 + i * 0.5 } }));
            // Group 2: variable (WP-24)
            data.push(makeRecord({ wellplate: 24, data: { livePercent: 10 } }));
            data.push(makeRecord({ wellplate: 24, data: { livePercent: 90 } }));
            data.push(makeRecord({ wellplate: 24, data: { livePercent: 50 } }));
            data.push(makeRecord({ wellplate: 24, data: { livePercent: 20 } }));
            data.push(makeRecord({ wellplate: 24, data: { livePercent: 80 } }));

            var groups = groupPrints(data, 'wellplate');
            expect(groups['WP-6']).toHaveLength(5);
            expect(groups['WP-24']).toHaveLength(5);

            var g1vals = extractValues(groups['WP-6'], function(p) { return p.print_data.livePercent; });
            var g2vals = extractValues(groups['WP-24'], function(p) { return p.print_data.livePercent; });

            var cv1 = coefficientOfVariation(g1vals);
            var cv2 = coefficientOfVariation(g2vals);

            expect(cv1).toBeLessThan(cv2);
            expect(cvGrade(cv1)).toBe('excellent');
            expect(reproducibilityScore(cv1)).toBeGreaterThan(reproducibilityScore(cv2));
        });

        test('outlier detection with z-score > 2', () => {
            // Create a group with one obvious outlier
            var prints = [
                makeRecord({ serial: 1, data: { livePercent: 80 } }),
                makeRecord({ serial: 2, data: { livePercent: 82 } }),
                makeRecord({ serial: 3, data: { livePercent: 79 } }),
                makeRecord({ serial: 4, data: { livePercent: 81 } }),
                makeRecord({ serial: 5, data: { livePercent: 80 } }),
                makeRecord({ serial: 6, data: { livePercent: 81 } }),
                makeRecord({ serial: 7, data: { livePercent: 79 } }),
                makeRecord({ serial: 8, data: { livePercent: 82 } }),
                makeRecord({ serial: 9, data: { livePercent: 80 } }),
                makeRecord({ serial: 10, data: { livePercent: 5 } }), // extreme outlier
            ];
            var values = extractValues(prints, function(p) { return p.print_data.livePercent; });
            var m = mean(values);
            var s = stddev(values);

            // Check that serial=10 has z-score > 2
            var outlierVal = 5;
            var z = Math.abs(outlierVal - m) / s;
            expect(z).toBeGreaterThan(2);
        });
    });
});
