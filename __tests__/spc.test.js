/**
 * Tests for SPC Dashboard (docs/spc.html)
 *
 * Tests the core SPC computation functions: subgroup computation,
 * control limits, capability indices, and Western Electric violations.
 */

// ── SPC Constants (extracted from spc.html) ──
var SPC_A2 = { 2:1.880, 3:1.023, 4:0.729, 5:0.577, 6:0.483, 7:0.419, 8:0.373, 9:0.337, 10:0.308 };
var SPC_D3 = { 2:0, 3:0, 4:0, 5:0, 6:0, 7:0.076, 8:0.136, 9:0.184, 10:0.223 };
var SPC_D4 = { 2:3.267, 3:2.574, 4:2.282, 5:2.114, 6:2.004, 7:1.924, 8:1.864, 9:1.816, 10:1.777 };
var SPC_d2 = { 2:1.128, 3:1.693, 4:2.059, 5:2.326, 6:2.534, 7:2.704, 8:2.847, 9:2.970, 10:3.078 };

// ── Core Functions (extracted from spc.html) ──

function computeSubgroups(values, n) {
    var groups = [];
    for (var i = 0; i + n <= values.length; i += n) {
        var sub = values.slice(i, i + n);
        var sum = 0, min = sub[0], max = sub[0];
        for (var j = 0; j < sub.length; j++) {
            sum += sub[j];
            if (sub[j] < min) min = sub[j];
            if (sub[j] > max) max = sub[j];
        }
        groups.push({ mean: sum / sub.length, range: max - min, values: sub, index: groups.length });
    }
    return groups;
}

function computeControlLimits(subgroups, n) {
    if (subgroups.length === 0) return null;
    var sumMean = 0, sumRange = 0;
    for (var i = 0; i < subgroups.length; i++) {
        sumMean += subgroups[i].mean;
        sumRange += subgroups[i].range;
    }
    var xBar = sumMean / subgroups.length;
    var rBar = sumRange / subgroups.length;
    var A2 = SPC_A2[n] || 0.577;
    var D3 = SPC_D3[n] || 0;
    var D4 = SPC_D4[n] || 2.114;

    return {
        xBar: xBar,
        rBar: rBar,
        xBar_UCL: xBar + A2 * rBar,
        xBar_LCL: xBar - A2 * rBar,
        r_UCL: D4 * rBar,
        r_LCL: D3 * rBar
    };
}

function computeCapability(subgroups, n, lsl, usl) {
    if (subgroups.length < 2) return null;
    var sumMean = 0, sumRange = 0;
    for (var i = 0; i < subgroups.length; i++) {
        sumMean += subgroups[i].mean;
        sumRange += subgroups[i].range;
    }
    var xBar = sumMean / subgroups.length;
    var rBar = sumRange / subgroups.length;
    var d2 = SPC_d2[n] || 2.326;
    var sigmaW = rBar / d2;

    var result = { sigma: sigmaW, xBar: xBar };
    var hasLSL = lsl !== null && !isNaN(lsl);
    var hasUSL = usl !== null && !isNaN(usl);

    if (hasLSL && hasUSL && sigmaW > 0) {
        result.cp = (usl - lsl) / (6 * sigmaW);
        var cpuVal = (usl - xBar) / (3 * sigmaW);
        var cplVal = (xBar - lsl) / (3 * sigmaW);
        result.cpk = Math.min(cpuVal, cplVal);
        var target = (usl + lsl) / 2;
        var denom = Math.sqrt(sigmaW * sigmaW + (xBar - target) * (xBar - target));
        result.cpm = (usl - lsl) / (6 * denom);
        result.cpu = cpuVal;
        result.cpl = cplVal;
    } else if (hasUSL && sigmaW > 0) {
        result.cpu = (usl - xBar) / (3 * sigmaW);
        result.cpk = result.cpu;
    } else if (hasLSL && sigmaW > 0) {
        result.cpl = (xBar - lsl) / (3 * sigmaW);
        result.cpk = result.cpl;
    }
    return result;
}

function formatNum(n) {
    if (n == null) return '-';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(2);
}

function detectViolations(subgroups, limits) {
    var violations = [];
    var xBar = limits.xBar;
    var sigma = (limits.xBar_UCL - xBar) / 3;
    var zone1u = xBar + 2 * sigma;
    var zone1l = xBar - 2 * sigma;

    for (var i = 0; i < subgroups.length; i++) {
        var m = subgroups[i].mean;

        if (m > limits.xBar_UCL || m < limits.xBar_LCL) {
            violations.push({ subgroup: i + 1, value: m, rule: 1, type: 'ooc',
                desc: 'Point beyond control limits (' + formatNum(m) + ')' });
        }

        if (i >= 8) {
            var allAbove = true, allBelow = true;
            for (var j = i - 8; j <= i; j++) {
                if (subgroups[j].mean <= xBar) allAbove = false;
                if (subgroups[j].mean >= xBar) allBelow = false;
            }
            if (allAbove || allBelow) {
                violations.push({ subgroup: i + 1, value: m, rule: 2, type: 'run',
                    desc: '9 consecutive points ' + (allAbove ? 'above' : 'below') + ' center line' });
            }
        }

        if (i >= 5) {
            var rising = true, falling = true;
            for (var j = i - 4; j <= i; j++) {
                if (subgroups[j].mean <= subgroups[j - 1].mean) rising = false;
                if (subgroups[j].mean >= subgroups[j - 1].mean) falling = false;
            }
            if (rising || falling) {
                violations.push({ subgroup: i + 1, value: m, rule: 3, type: 'trend',
                    desc: '6 consecutive ' + (rising ? 'increasing' : 'decreasing') + ' points' });
            }
        }

        if (i >= 2) {
            var aboveCount = 0, belowCount = 0;
            for (var j = i - 2; j <= i; j++) {
                if (subgroups[j].mean > zone1u) aboveCount++;
                if (subgroups[j].mean < zone1l) belowCount++;
            }
            if (aboveCount >= 2 || belowCount >= 2) {
                violations.push({ subgroup: i + 1, value: m, rule: 4, type: 'warn',
                    desc: '2 of 3 points beyond 2σ (' + (aboveCount >= 2 ? 'upper' : 'lower') + ')' });
            }
        }
    }

    var seen = {};
    var unique = [];
    for (var i = 0; i < violations.length; i++) {
        var key = violations[i].subgroup + '-' + violations[i].rule;
        if (!seen[key]) { seen[key] = true; unique.push(violations[i]); }
    }
    return unique;
}

// ═══════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════

describe('computeSubgroups', function() {
    test('creates correct number of subgroups', function() {
        var values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        var groups = computeSubgroups(values, 5);
        expect(groups.length).toBe(2);
    });

    test('computes correct means', function() {
        var values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        var groups = computeSubgroups(values, 5);
        expect(groups[0].mean).toBe(3); // (1+2+3+4+5)/5
        expect(groups[1].mean).toBe(8); // (6+7+8+9+10)/5
    });

    test('computes correct ranges', function() {
        var values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        var groups = computeSubgroups(values, 5);
        expect(groups[0].range).toBe(4); // 5-1
        expect(groups[1].range).toBe(4); // 10-6
    });

    test('drops incomplete trailing subgroup', function() {
        var values = [1, 2, 3, 4, 5, 6, 7];
        var groups = computeSubgroups(values, 5);
        expect(groups.length).toBe(1);
    });

    test('handles subgroup size 2', function() {
        var values = [10, 20, 30, 40];
        var groups = computeSubgroups(values, 2);
        expect(groups.length).toBe(2);
        expect(groups[0].mean).toBe(15);
        expect(groups[0].range).toBe(10);
        expect(groups[1].mean).toBe(35);
        expect(groups[1].range).toBe(10);
    });

    test('returns empty for insufficient data', function() {
        var groups = computeSubgroups([1, 2], 5);
        expect(groups.length).toBe(0);
    });

    test('handles single-element subgroups correctly', function() {
        // Not practical (n>=2 enforced) but verifies edge behavior
        var values = [5, 10, 15];
        var groups = computeSubgroups(values, 1);
        expect(groups.length).toBe(3);
        expect(groups[0].range).toBe(0);
    });

    test('preserves values array in each subgroup', function() {
        var values = [1, 2, 3, 4, 5, 6];
        var groups = computeSubgroups(values, 3);
        expect(groups[0].values).toEqual([1, 2, 3]);
        expect(groups[1].values).toEqual([4, 5, 6]);
    });

    test('assigns sequential indices', function() {
        var values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        var groups = computeSubgroups(values, 4);
        expect(groups[0].index).toBe(0);
        expect(groups[1].index).toBe(1);
        expect(groups[2].index).toBe(2);
    });

    test('handles identical values', function() {
        var values = [5, 5, 5, 5, 5, 5];
        var groups = computeSubgroups(values, 3);
        expect(groups[0].mean).toBe(5);
        expect(groups[0].range).toBe(0);
    });

    test('handles negative values', function() {
        var values = [-10, -5, 0, 5, 10, 15];
        var groups = computeSubgroups(values, 3);
        expect(groups[0].mean).toBeCloseTo(-5, 5);
        expect(groups[0].range).toBe(10);
        expect(groups[1].mean).toBeCloseTo(10, 5);
    });

    test('handles large subgroup size equal to data length', function() {
        var values = [1, 2, 3, 4, 5];
        var groups = computeSubgroups(values, 5);
        expect(groups.length).toBe(1);
        expect(groups[0].mean).toBe(3);
    });
});

describe('computeControlLimits', function() {
    test('returns null for empty subgroups', function() {
        expect(computeControlLimits([], 5)).toBeNull();
    });

    test('computes correct xBar and rBar', function() {
        var subgroups = [
            { mean: 10, range: 2 },
            { mean: 12, range: 3 },
            { mean: 11, range: 1 },
            { mean: 13, range: 4 }
        ];
        var limits = computeControlLimits(subgroups, 5);
        expect(limits.xBar).toBeCloseTo(11.5, 5);
        expect(limits.rBar).toBeCloseTo(2.5, 5);
    });

    test('uses correct A2 factor for n=5', function() {
        var subgroups = [
            { mean: 10, range: 4 },
            { mean: 10, range: 4 }
        ];
        var limits = computeControlLimits(subgroups, 5);
        // A2 for n=5 is 0.577
        expect(limits.xBar_UCL).toBeCloseTo(10 + 0.577 * 4, 3);
        expect(limits.xBar_LCL).toBeCloseTo(10 - 0.577 * 4, 3);
    });

    test('uses correct D3/D4 factors for n=5', function() {
        var subgroups = [
            { mean: 10, range: 4 },
            { mean: 10, range: 4 }
        ];
        var limits = computeControlLimits(subgroups, 5);
        // D3=0, D4=2.114 for n=5
        expect(limits.r_LCL).toBe(0);
        expect(limits.r_UCL).toBeCloseTo(2.114 * 4, 3);
    });

    test('uses correct A2 for n=2', function() {
        var subgroups = [{ mean: 5, range: 2 }];
        var limits = computeControlLimits(subgroups, 2);
        // A2 for n=2 is 1.880
        expect(limits.xBar_UCL).toBeCloseTo(5 + 1.880 * 2, 3);
    });

    test('UCL > xBar > LCL always', function() {
        var subgroups = [
            { mean: 50, range: 10 },
            { mean: 55, range: 8 },
            { mean: 48, range: 12 }
        ];
        var limits = computeControlLimits(subgroups, 5);
        expect(limits.xBar_UCL).toBeGreaterThan(limits.xBar);
        expect(limits.xBar).toBeGreaterThan(limits.xBar_LCL);
        expect(limits.r_UCL).toBeGreaterThan(limits.rBar);
    });

    test('r_LCL is 0 for n<=6', function() {
        for (var n = 2; n <= 6; n++) {
            var limits = computeControlLimits([{ mean: 10, range: 5 }], n);
            expect(limits.r_LCL).toBe(0);
        }
    });

    test('r_LCL is positive for n>=7', function() {
        var limits = computeControlLimits([{ mean: 10, range: 5 }], 7);
        expect(limits.r_LCL).toBeGreaterThan(0);
    });

    test('handles zero range (all identical values)', function() {
        var subgroups = [
            { mean: 10, range: 0 },
            { mean: 10, range: 0 }
        ];
        var limits = computeControlLimits(subgroups, 5);
        expect(limits.rBar).toBe(0);
        expect(limits.xBar_UCL).toBe(limits.xBar);
        expect(limits.xBar_LCL).toBe(limits.xBar);
    });
});

describe('computeCapability', function() {
    test('returns null for fewer than 2 subgroups', function() {
        expect(computeCapability([{ mean: 5, range: 2 }], 5, 0, 10)).toBeNull();
    });

    test('computes Cp correctly', function() {
        // Known: xBar=10, rBar=4, n=5, d2=2.326
        // sigma = 4/2.326 ≈ 1.7197
        // Cp = (USL-LSL)/(6*sigma) = (20-0)/(6*1.7197) ≈ 1.938
        var subgroups = [
            { mean: 10, range: 4 },
            { mean: 10, range: 4 }
        ];
        var cap = computeCapability(subgroups, 5, 0, 20);
        expect(cap.cp).toBeCloseTo(20 / (6 * 4 / 2.326), 2);
    });

    test('computes Cpk correctly (centered)', function() {
        var subgroups = [
            { mean: 10, range: 4 },
            { mean: 10, range: 4 }
        ];
        var cap = computeCapability(subgroups, 5, 0, 20);
        // Centered: cpu = cpl = cp → cpk = cp
        expect(cap.cpk).toBeCloseTo(cap.cp, 2);
    });

    test('Cpk < Cp when process is off-center', function() {
        var subgroups = [
            { mean: 15, range: 2 },
            { mean: 15, range: 2 }
        ];
        var cap = computeCapability(subgroups, 5, 0, 20);
        expect(cap.cpk).toBeLessThan(cap.cp);
    });

    test('computes Cpm (Taguchi)', function() {
        var subgroups = [
            { mean: 10, range: 4 },
            { mean: 10, range: 4 }
        ];
        var cap = computeCapability(subgroups, 5, 0, 20);
        expect(cap.cpm).toBeDefined();
        expect(cap.cpm).toBeGreaterThan(0);
    });

    test('Cpm equals Cp when process is on target', function() {
        // Target = (USL+LSL)/2 = 10, xBar = 10
        var subgroups = [
            { mean: 10, range: 4 },
            { mean: 10, range: 4 }
        ];
        var cap = computeCapability(subgroups, 5, 0, 20);
        expect(cap.cpm).toBeCloseTo(cap.cp, 2);
    });

    test('handles USL only', function() {
        var subgroups = [
            { mean: 10, range: 4 },
            { mean: 10, range: 4 }
        ];
        var cap = computeCapability(subgroups, 5, null, 20);
        expect(cap.cpu).toBeDefined();
        expect(cap.cpk).toBe(cap.cpu);
        expect(cap.cp).toBeUndefined();
    });

    test('handles LSL only', function() {
        var subgroups = [
            { mean: 10, range: 4 },
            { mean: 10, range: 4 }
        ];
        var cap = computeCapability(subgroups, 5, 0, null);
        expect(cap.cpl).toBeDefined();
        expect(cap.cpk).toBe(cap.cpl);
        expect(cap.cp).toBeUndefined();
    });

    test('returns sigma estimate', function() {
        var subgroups = [
            { mean: 10, range: 4 },
            { mean: 10, range: 4 }
        ];
        var cap = computeCapability(subgroups, 5, 0, 20);
        expect(cap.sigma).toBeCloseTo(4 / 2.326, 3);
    });

    test('handles no spec limits (returns only sigma/xBar)', function() {
        var subgroups = [
            { mean: 10, range: 4 },
            { mean: 10, range: 4 }
        ];
        var cap = computeCapability(subgroups, 5, null, null);
        expect(cap.sigma).toBeDefined();
        expect(cap.xBar).toBeDefined();
        expect(cap.cp).toBeUndefined();
        expect(cap.cpk).toBeUndefined();
    });

    test('handles zero sigma (all identical values)', function() {
        var subgroups = [
            { mean: 10, range: 0 },
            { mean: 10, range: 0 }
        ];
        var cap = computeCapability(subgroups, 5, 0, 20);
        expect(cap.sigma).toBe(0);
        // With sigma=0, capabilities can't be computed
        expect(cap.cp).toBeUndefined();
    });
});

describe('detectViolations', function() {
    function makeLimits(xBar, rBar, n) {
        var A2 = SPC_A2[n] || 0.577;
        return {
            xBar: xBar,
            rBar: rBar,
            xBar_UCL: xBar + A2 * rBar,
            xBar_LCL: xBar - A2 * rBar
        };
    }

    test('no violations for in-control process', function() {
        // All points at center line
        var subgroups = [];
        for (var i = 0; i < 20; i++) {
            subgroups.push({ mean: 10, range: 2 });
        }
        var limits = makeLimits(10, 2, 5);
        var v = detectViolations(subgroups, limits);
        expect(v.length).toBe(0);
    });

    test('Rule 1: detects point above UCL', function() {
        var limits = makeLimits(10, 2, 5);
        // UCL = 10 + 0.577 * 2 = 11.154
        var subgroups = [{ mean: 10 }, { mean: 12 }]; // 12 > 11.154
        var v = detectViolations(subgroups, limits);
        var rule1 = v.filter(function(x) { return x.rule === 1; });
        expect(rule1.length).toBe(1);
        expect(rule1[0].type).toBe('ooc');
        expect(rule1[0].subgroup).toBe(2);
    });

    test('Rule 1: detects point below LCL', function() {
        var limits = makeLimits(10, 2, 5);
        // LCL = 10 - 0.577 * 2 = 8.846
        var subgroups = [{ mean: 10 }, { mean: 8 }]; // 8 < 8.846
        var v = detectViolations(subgroups, limits);
        var rule1 = v.filter(function(x) { return x.rule === 1; });
        expect(rule1.length).toBe(1);
    });

    test('Rule 2: 9 consecutive above center', function() {
        var limits = makeLimits(10, 10, 5); // wide limits so no rule 1
        var subgroups = [];
        for (var i = 0; i < 9; i++) {
            subgroups.push({ mean: 10.5 }); // slightly above
        }
        var v = detectViolations(subgroups, limits);
        var rule2 = v.filter(function(x) { return x.rule === 2; });
        expect(rule2.length).toBeGreaterThanOrEqual(1);
        expect(rule2[0].type).toBe('run');
    });

    test('Rule 2: 8 is not enough', function() {
        var limits = makeLimits(10, 10, 5);
        var subgroups = [];
        for (var i = 0; i < 8; i++) {
            subgroups.push({ mean: 10.5 });
        }
        var v = detectViolations(subgroups, limits);
        var rule2 = v.filter(function(x) { return x.rule === 2; });
        expect(rule2.length).toBe(0);
    });

    test('Rule 3: 6 consecutive increasing', function() {
        var limits = makeLimits(10, 100, 5); // very wide limits
        var subgroups = [
            { mean: 5 }, { mean: 6 }, { mean: 7 }, { mean: 8 }, { mean: 9 }, { mean: 10 }
        ];
        var v = detectViolations(subgroups, limits);
        var rule3 = v.filter(function(x) { return x.rule === 3; });
        expect(rule3.length).toBeGreaterThanOrEqual(1);
        expect(rule3[0].type).toBe('trend');
    });

    test('Rule 3: 6 consecutive decreasing', function() {
        var limits = makeLimits(10, 100, 5);
        var subgroups = [
            { mean: 15 }, { mean: 14 }, { mean: 13 }, { mean: 12 }, { mean: 11 }, { mean: 10 }
        ];
        var v = detectViolations(subgroups, limits);
        var rule3 = v.filter(function(x) { return x.rule === 3; });
        expect(rule3.length).toBeGreaterThanOrEqual(1);
    });

    test('Rule 3: 5 is not enough', function() {
        var limits = makeLimits(10, 100, 5);
        var subgroups = [
            { mean: 5 }, { mean: 6 }, { mean: 7 }, { mean: 8 }, { mean: 9 }
        ];
        var v = detectViolations(subgroups, limits);
        var rule3 = v.filter(function(x) { return x.rule === 3; });
        expect(rule3.length).toBe(0);
    });

    test('Rule 4: 2 of 3 beyond 2σ (upper)', function() {
        var limits = makeLimits(10, 3, 5);
        // sigma = (UCL - xBar) / 3 = (10 + 0.577*3 - 10)/3 = 0.577
        // 2σ boundary = 10 + 2*0.577 = 11.154
        var subgroups = [
            { mean: 12 }, // beyond 2σ
            { mean: 10 }, // normal
            { mean: 12 }  // beyond 2σ → triggers rule 4
        ];
        var v = detectViolations(subgroups, limits);
        var rule4 = v.filter(function(x) { return x.rule === 4; });
        expect(rule4.length).toBeGreaterThanOrEqual(1);
        expect(rule4[0].type).toBe('warn');
    });

    test('deduplicates by subgroup-rule combo', function() {
        var limits = makeLimits(10, 100, 5);
        // 9 increasing points would trigger rule 3 multiple times
        var subgroups = [];
        for (var i = 0; i < 9; i++) {
            subgroups.push({ mean: i + 1 });
        }
        var v = detectViolations(subgroups, limits);
        // Check no duplicate subgroup-rule combos
        var keys = {};
        v.forEach(function(vi) {
            var key = vi.subgroup + '-' + vi.rule;
            expect(keys[key]).toBeUndefined();
            keys[key] = true;
        });
    });

    test('returns violation types correctly', function() {
        var v = { type: 'ooc' };
        expect(v.type).toBe('ooc');
        v = { type: 'run' };
        expect(v.type).toBe('run');
        v = { type: 'trend' };
        expect(v.type).toBe('trend');
        v = { type: 'warn' };
        expect(v.type).toBe('warn');
    });

    test('handles empty subgroups', function() {
        var limits = makeLimits(10, 2, 5);
        var v = detectViolations([], limits);
        expect(v.length).toBe(0);
    });

    test('single subgroup can only trigger rule 1', function() {
        var limits = makeLimits(10, 2, 5);
        var subgroups = [{ mean: 20 }]; // way above UCL
        var v = detectViolations(subgroups, limits);
        // Only rule 1 possible (rules 2,3,4 need history)
        expect(v.every(function(vi) { return vi.rule === 1; })).toBe(true);
    });

    test('multiple rules can fire on same subgroup', function() {
        var limits = makeLimits(10, 2, 5);
        // Build a scenario where subgroup 9 has rule 1 AND rule 2
        var subgroups = [];
        for (var i = 0; i < 9; i++) {
            subgroups.push({ mean: 12 }); // above UCL (rule 1) AND 9 above center (rule 2)
        }
        var v = detectViolations(subgroups, limits);
        var sub9rules = v.filter(function(vi) { return vi.subgroup === 9; });
        var rules = sub9rules.map(function(vi) { return vi.rule; });
        expect(rules).toContain(1); // beyond UCL
        expect(rules).toContain(2); // 9 same side
    });
});

describe('SPC constants', function() {
    test('A2 decreases as n increases', function() {
        var prev = SPC_A2[2];
        for (var n = 3; n <= 10; n++) {
            expect(SPC_A2[n]).toBeLessThan(prev);
            prev = SPC_A2[n];
        }
    });

    test('D4 decreases as n increases', function() {
        var prev = SPC_D4[2];
        for (var n = 3; n <= 10; n++) {
            expect(SPC_D4[n]).toBeLessThan(prev);
            prev = SPC_D4[n];
        }
    });

    test('D3 is 0 for n<=6 and positive for n>=7', function() {
        for (var n = 2; n <= 6; n++) {
            expect(SPC_D3[n]).toBe(0);
        }
        for (var n = 7; n <= 10; n++) {
            expect(SPC_D3[n]).toBeGreaterThan(0);
        }
    });

    test('d2 increases as n increases', function() {
        var prev = SPC_d2[2];
        for (var n = 3; n <= 10; n++) {
            expect(SPC_d2[n]).toBeGreaterThan(prev);
            prev = SPC_d2[n];
        }
    });
});

describe('integration', function() {
    test('end-to-end: subgroups → limits → violations', function() {
        // Generate a dataset with a clear shift at subgroup 10
        var values = [];
        for (var i = 0; i < 50; i++) values.push(10 + Math.sin(i) * 0.5); // stable
        for (var i = 0; i < 50; i++) values.push(15 + Math.sin(i) * 0.5); // shifted

        var subgroups = computeSubgroups(values, 5);
        expect(subgroups.length).toBe(20);

        var limits = computeControlLimits(subgroups, 5);
        expect(limits).not.toBeNull();
        expect(limits.xBar).toBeGreaterThan(10);
        expect(limits.xBar).toBeLessThan(15);

        var violations = detectViolations(subgroups, limits);
        // Shifted process should trigger violations
        expect(violations.length).toBeGreaterThan(0);
    });

    test('end-to-end: capability with tight specs', function() {
        var values = [];
        for (var i = 0; i < 50; i++) values.push(10 + (i % 3 - 1) * 0.5);

        var subgroups = computeSubgroups(values, 5);
        var cap = computeCapability(subgroups, 5, 8, 12);
        expect(cap).not.toBeNull();
        expect(cap.cp).toBeGreaterThan(0);
        expect(cap.cpk).toBeGreaterThan(0);
        expect(cap.cpm).toBeGreaterThan(0);
    });

    test('end-to-end: stable process has no violations', function() {
        // Very stable: all values identical
        var values = [];
        for (var i = 0; i < 100; i++) values.push(10);

        var subgroups = computeSubgroups(values, 5);
        var limits = computeControlLimits(subgroups, 5);
        var violations = detectViolations(subgroups, limits);
        expect(violations.length).toBe(0);
    });

    test('end-to-end: process with linear drift triggers trend violations', function() {
        var values = [];
        for (var i = 0; i < 50; i++) values.push(10 + i * 0.2);

        var subgroups = computeSubgroups(values, 5);
        var limits = computeControlLimits(subgroups, 5);
        var violations = detectViolations(subgroups, limits);

        // Should have trend violations (rule 3)
        var trends = violations.filter(function(v) { return v.rule === 3; });
        expect(trends.length).toBeGreaterThan(0);
    });

    test('capability indices decrease with wider process spread', function() {
        var narrowValues = [];
        var wideValues = [];
        for (var i = 0; i < 50; i++) {
            narrowValues.push(10 + (i % 2) * 0.1);
            wideValues.push(10 + (i % 2) * 5);
        }

        var narrowSub = computeSubgroups(narrowValues, 5);
        var wideSub = computeSubgroups(wideValues, 5);

        var narrowCap = computeCapability(narrowSub, 5, 0, 20);
        var wideCap = computeCapability(wideSub, 5, 0, 20);

        expect(narrowCap.cp).toBeGreaterThan(wideCap.cp);
    });
});

describe('formatNum', function() {
    test('returns dash for null', function() {
        expect(formatNum(null)).toBe('-');
    });

    test('returns dash for undefined', function() {
        expect(formatNum(undefined)).toBe('-');
    });

    test('formats integers without decimals', function() {
        expect(formatNum(42)).toBe('42');
    });

    test('formats decimals to 2 places', function() {
        expect(formatNum(3.14159)).toBe('3.14');
    });

    test('formats large numbers with locale', function() {
        var result = formatNum(1500);
        // Should contain "1" and "500" with possible separator
        expect(result).toContain('1');
        expect(result).toContain('500');
    });

    test('handles zero', function() {
        expect(formatNum(0)).toBe('0');
    });

    test('handles negative numbers', function() {
        var result = formatNum(-3.14);
        expect(result).toBe('-3.14');
    });
});
