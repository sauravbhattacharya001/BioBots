'use strict';

/**
 * Tests for experimentRiskAssessor — pre-experiment 8-dimension risk
 * engine with verdict, mitigations, what-if, and trend tracking.
 */

var mod = require('../docs/shared/experimentRiskAssessor');
var createExperimentRiskAssessor = mod.createExperimentRiskAssessor;

function lowRiskExperiment(overrides) {
    var base = {
        title: 'Routine alginate scaffold',
        materials: ['alginate'],
        duration_hours: 4,
        equipment: ['bioprinter_1', 'incubator'],
        personnel: [{ name: 'Alice', certifications: ['BSL2', 'bioprinter'] }],
        biosafety_level: 1,
        inventory: { alginate: 1000 },
        calibration_status: { bioprinter_1: 'current', incubator: 'current' },
        protocol_approved: true,
        sop_available: true,
    };
    if (overrides) {
        Object.keys(overrides).forEach(function (k) { base[k] = overrides[k]; });
    }
    return base;
}

describe('createExperimentRiskAssessor', function () {
    test('exposes expected API surface', function () {
        var a = createExperimentRiskAssessor();
        ['assess', 'whatIf', 'trends', 'history', 'clearHistory',
         'getDimensions', 'getVerdictScale', 'getMaterialDatabase',
         'getEquipmentDatabase'].forEach(function (k) {
            expect(typeof a[k]).toBe('function');
        });
    });

    test('throws on null / non-object experiment', function () {
        var a = createExperimentRiskAssessor();
        expect(function () { a.assess(null); }).toThrow(/non-null object/);
        expect(function () { a.assess(undefined); }).toThrow();
        expect(function () { a.assess('hello'); }).toThrow();
    });

    test('returns the full result shape', function () {
        var a = createExperimentRiskAssessor();
        var r = a.assess(lowRiskExperiment());
        expect(r).toEqual(expect.objectContaining({
            title: expect.any(String),
            timestamp: expect.any(String),
            compositeScore: expect.any(Number),
            verdict: expect.any(String),
            verdictLabel: expect.any(String),
            verdictColor: expect.any(String),
            guidance: expect.any(String),
            confidence: expect.any(Number),
            dimensions: expect.any(Object),
            findings: expect.any(Array),
            mitigations: expect.any(Array),
            topRisks: expect.any(Array),
        }));
        // Has all 8 dimensions
        ['biosafety', 'resource', 'timeline', 'success_probability',
         'regulatory', 'cross_contamination', 'equipment', 'personnel']
            .forEach(function (k) {
                expect(r.dimensions[k]).toBeDefined();
                expect(typeof r.dimensions[k].score).toBe('number');
                expect(Array.isArray(r.dimensions[k].findings)).toBe(true);
            });
    });

    test('composite score is in [0,100]', function () {
        var a = createExperimentRiskAssessor();
        var r = a.assess(lowRiskExperiment());
        expect(r.compositeScore).toBeGreaterThanOrEqual(0);
        expect(r.compositeScore).toBeLessThanOrEqual(100);
    });

    test('all per-dimension scores are in [0,100]', function () {
        var a = createExperimentRiskAssessor();
        var r = a.assess(lowRiskExperiment({
            materials: ['gelma', 'chondrocytes', 'matrigel'],
            biosafety_level: 2,
            duration_hours: 36,
        }));
        Object.keys(r.dimensions).forEach(function (k) {
            expect(r.dimensions[k].score).toBeGreaterThanOrEqual(0);
            expect(r.dimensions[k].score).toBeLessThanOrEqual(100);
        });
    });

    test('low-risk experiment yields a green-zone verdict', function () {
        var a = createExperimentRiskAssessor();
        var r = a.assess(lowRiskExperiment());
        expect(['GO', 'GO_WITH_MONITORING', 'CONDITIONAL']).toContain(r.verdict);
    });

    test('high-risk experiment is materially worse than low-risk', function () {
        var a = createExperimentRiskAssessor();
        var low = a.assess(lowRiskExperiment());
        var high = a.assess({
            title: 'Aggressive BSL2 multi-cell scaffold',
            materials: ['chondrocytes', 'mscs', 'ipsc', 'fibrin', 'matrigel'],
            duration_hours: 72,
            equipment: ['bioprinter_1', 'bioprinter_2', 'uv_crosslinker'],
            personnel: [], // no personnel = high readiness risk
            biosafety_level: 1, // mismatched — materials need BSL2
            inventory: {}, // nothing available
            calibration_status: { bioprinter_1: 'overdue', bioprinter_2: 'overdue' },
        });
        expect(high.compositeScore).toBeGreaterThan(low.compositeScore);
        expect(high.findings.length).toBeGreaterThan(0);
    });

    test('verdict matches verdict-scale thresholds', function () {
        var a = createExperimentRiskAssessor();
        var scale = a.getVerdictScale();
        var r = a.assess(lowRiskExperiment());
        var matching = scale.find(function (v) { return r.compositeScore <= v.maxScore; });
        expect(matching).toBeDefined();
        expect(r.verdict).toBe(matching.verdict);
        expect(r.verdictLabel).toBe(matching.label);
        expect(r.verdictColor).toBe(matching.color);
    });

    test('biosafety findings flag BSL mismatch', function () {
        var a = createExperimentRiskAssessor();
        var r = a.assess(lowRiskExperiment({
            materials: ['chondrocytes'], // bsl 2
            biosafety_level: 1,
        }));
        expect(r.dimensions.biosafety.score).toBeGreaterThan(0);
        expect(r.dimensions.biosafety.findings.length).toBeGreaterThan(0);
    });

    test('confidence increases with more fields provided', function () {
        var a = createExperimentRiskAssessor();
        var sparse = a.assess({ title: 't', materials: ['alginate'] });
        var rich = a.assess(lowRiskExperiment());
        expect(rich.confidence).toBeGreaterThan(sparse.confidence);
    });

    test('history accumulates and clearHistory wipes it', function () {
        var a = createExperimentRiskAssessor();
        a.assess(lowRiskExperiment());
        a.assess(lowRiskExperiment());
        a.assess(lowRiskExperiment());
        expect(a.history().length).toBe(3);
        a.clearHistory();
        expect(a.history().length).toBe(0);
    });

    test('history() returns a copy (not the live array)', function () {
        var a = createExperimentRiskAssessor();
        a.assess(lowRiskExperiment());
        var h = a.history();
        h.push({ bogus: true });
        expect(a.history().length).toBe(1);
    });

    test('trends() requires sufficient history', function () {
        var a = createExperimentRiskAssessor();
        var t0 = a.trends();
        expect(t0.hasTrend).toBe(false);
        a.assess(lowRiskExperiment());
        a.assess(lowRiskExperiment());
        a.assess(lowRiskExperiment());
        a.assess(lowRiskExperiment());
        var t1 = a.trends();
        expect(typeof t1.hasTrend).toBe('boolean');
    });

    test('whatIf returns baseline + modified + diff', function () {
        var a = createExperimentRiskAssessor();
        var base = lowRiskExperiment();
        var w = a.whatIf(base, { biosafety_level: 2 });
        expect(w).toBeDefined();
        expect(w).toEqual(expect.objectContaining({
            baseline: expect.any(Object),
            modified: expect.any(Object),
        }));
        expect(w.baseline.compositeScore).toBeDefined();
        expect(w.modified.compositeScore).toBeDefined();
    });

    test('whatIf does not mutate the base experiment', function () {
        var a = createExperimentRiskAssessor();
        var base = lowRiskExperiment();
        var snapshot = JSON.stringify(base);
        a.whatIf(base, { duration_hours: 240, biosafety_level: 4 });
        expect(JSON.stringify(base)).toBe(snapshot);
    });

    test('getDimensions returns a fresh deep copy', function () {
        var a = createExperimentRiskAssessor();
        var dims = a.getDimensions();
        dims.BIOSAFETY.weight = 999;
        var dims2 = a.getDimensions();
        expect(dims2.BIOSAFETY.weight).not.toBe(999);
    });

    test('getMaterialDatabase / getEquipmentDatabase list known keys', function () {
        var a = createExperimentRiskAssessor();
        var mats = a.getMaterialDatabase();
        var eq = a.getEquipmentDatabase();
        expect(Array.isArray(mats)).toBe(true);
        expect(Array.isArray(eq)).toBe(true);
        expect(mats).toContain('gelma');
        expect(mats).toContain('alginate');
        expect(eq).toContain('bioprinter_1');
        expect(eq).toContain('incubator');
    });

    test('mitigations are well-formed when present', function () {
        var a = createExperimentRiskAssessor();
        var r = a.assess({
            title: 'Risky',
            materials: ['ipsc', 'matrigel', 'fibrin'],
            duration_hours: 60,
            biosafety_level: 1,
            equipment: ['bioprinter_1'],
            personnel: [],
        });
        r.mitigations.forEach(function (m) {
            expect(typeof m).toBe('object');
            expect(m).not.toBeNull();
        });
    });

    test('topRisks only includes dimensions with score > 30', function () {
        var a = createExperimentRiskAssessor();
        var r = a.assess({
            title: 'Risky',
            materials: ['ipsc', 'fibrin', 'matrigel'],
            biosafety_level: 1,
            duration_hours: 60,
            equipment: ['bioprinter_1'],
            personnel: [],
        });
        r.topRisks.forEach(function (tr) {
            expect(r.dimensions[tr.dimension].score).toBeGreaterThan(30);
        });
    });

    test('unknown material does not crash assess()', function () {
        var a = createExperimentRiskAssessor();
        expect(function () {
            a.assess(lowRiskExperiment({ materials: ['unobtanium', 'alginate'] }));
        }).not.toThrow();
    });

    test('custom thresholds override default verdict scale', function () {
        var custom = [
            { maxScore: 10, verdict: 'TIGHT', label: 'tight', color: 'g', guidance: '' },
            { maxScore: 100, verdict: 'LOOSE', label: 'loose', color: 'r', guidance: '' },
        ];
        var a = createExperimentRiskAssessor({ thresholds: custom });
        var r = a.assess(lowRiskExperiment());
        expect(['TIGHT', 'LOOSE']).toContain(r.verdict);
    });

    test('timestamp is an ISO-8601 string', function () {
        var a = createExperimentRiskAssessor();
        var r = a.assess(lowRiskExperiment());
        expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('default title falls back when missing', function () {
        var a = createExperimentRiskAssessor();
        var r = a.assess({ materials: ['alginate'] });
        expect(r.title).toBe('Untitled Experiment');
    });

    test('multiple instances have isolated history', function () {
        var a = createExperimentRiskAssessor();
        var b = createExperimentRiskAssessor();
        a.assess(lowRiskExperiment());
        a.assess(lowRiskExperiment());
        b.assess(lowRiskExperiment());
        expect(a.history().length).toBe(2);
        expect(b.history().length).toBe(1);
    });
});
