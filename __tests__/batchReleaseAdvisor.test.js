'use strict';

var mod = require('../docs/shared/batchReleaseAdvisor');
var createBatchReleaseAdvisor = mod.createBatchReleaseAdvisor;
var V = mod.VERDICTS;

var FROZEN_NOW = new Date('2026-05-17T19:00:00.000Z');
function frozenNow() { return new Date(FROZEN_NOW.getTime()); }

function makeAdvisor(opts) {
    opts = opts || {};
    if (!opts.now) opts.now = frozenNow;
    return createBatchReleaseAdvisor(opts);
}

describe('createBatchReleaseAdvisor', function () {
    test('clean batch returns RELEASE with grade A and empty reasons', function () {
        var a = makeAdvisor();
        var r = a.evaluate({
            batchId: 'B-CLEAN',
            intendedUse: 'research',
            printQualityScore: 95,
            sterilityTest: { status: 'passed' },
            mycoplasmaTest: { status: 'negative' },
            viability: { percent: 95 },
            environmentalExcursions: [],
            deviations: [],
        });
        expect(r.verdict).toBe(V.RELEASE);
        expect(r.grade).toBe('A');
        expect(r.reasons.length).toBe(0);
        expect(r.score).toBeGreaterThanOrEqual(90);
        expect(r.playbook[0].code).toBe('RELEASE_CLEAN');
    });

    test('contamination forces REJECT_DESTROY regardless of score', function () {
        var a = makeAdvisor();
        var r = a.evaluate({
            batchId: 'B-FATAL',
            intendedUse: 'research',
            printQualityScore: 100,
            contaminationDetected: true,
        });
        expect(r.verdict).toBe(V.REJECT_DESTROY);
        expect(r.grade).toBe('F');
        expect(r.playbook.some(function (a) { return a.code === 'INCINERATE_BATCH'; })).toBe(true);
        expect(r.playbook[0].priority).toBe('P0');
    });

    test('sterility failed also forces REJECT_DESTROY', function () {
        var a = makeAdvisor();
        var r = a.evaluate({ batchId: 'B-STER', sterilityTest: { status: 'failed' }, printQualityScore: 90 });
        expect(r.verdict).toBe(V.REJECT_DESTROY);
        expect(r.reasons.some(function (x) { return x.code === 'STERILITY_FAILED'; })).toBe(true);
    });

    test('mycoplasma pending on critical-use batch triggers QUARANTINE_HOLD', function () {
        var a = makeAdvisor();
        var r = a.evaluate({
            batchId: 'B-IMP',
            intendedUse: 'implant',
            printQualityScore: 92,
            sterilityTest: { status: 'passed' },
            mycoplasmaTest: { status: 'pending' },
            viability: { percent: 95 },
        });
        expect(r.verdict).toBe(V.QUARANTINE_HOLD);
        expect(r.grade).toBe('F');
        expect(r.playbook.some(function (a) { return a.code === 'AWAIT_MYCOPLASMA_RESULT'; })).toBe(true);
    });

    test('low print quality with no fatal signal triggers REWORK', function () {
        var a = makeAdvisor();
        var r = a.evaluate({
            batchId: 'B-RW',
            intendedUse: 'research',
            printQualityScore: 45,
            sterilityTest: { status: 'passed' },
            viability: { percent: 90 },
        });
        expect(r.verdict).toBe(V.REWORK);
        expect(r.playbook.some(function (a) { return a.code === 'RETURN_TO_OPERATOR'; })).toBe(true);
    });

    test('marginal print quality yields RELEASE_WITH_NOTE not RELEASE', function () {
        var a = makeAdvisor();
        var r = a.evaluate({
            batchId: 'B-MARG',
            intendedUse: 'research',
            printQualityScore: 72,
            sterilityTest: { status: 'passed' },
            viability: { percent: 88 },
        });
        expect(r.verdict).toBe(V.RELEASE_WITH_NOTE);
        expect(r.reasons.some(function (x) { return x.code === 'PRINT_QUALITY_MARGINAL'; })).toBe(true);
    });

    test('expired reagent flag escalates to QUARANTINE_HOLD', function () {
        var a = makeAdvisor();
        var r = a.evaluate({
            batchId: 'B-EXP',
            intendedUse: 'research',
            printQualityScore: 90,
            sterilityTest: { status: 'passed' },
            viability: { percent: 92 },
            expiredReagents: ['NaCl-2024'],
        });
        expect(r.verdict).toBe(V.QUARANTINE_HOLD);
        expect(r.reasons.some(function (x) { return x.code === 'EXPIRED_REAGENT_USED'; })).toBe(true);
    });

    test('critical environmental excursion + low viability emits cross-signal insight', function () {
        var a = makeAdvisor();
        var r = a.evaluate({
            batchId: 'B-ENV',
            intendedUse: 'research',
            printQualityScore: 80,
            sterilityTest: { status: 'passed' },
            viability: { percent: 60 },
            environmentalExcursions: [{ severity: 'critical', durationMin: 12 }],
        });
        expect(r.verdict).toBe(V.QUARANTINE_HOLD);
        expect(r.insights.some(function (i) { return i.code === 'ENV_LINKED_VIABILITY_LOSS'; })).toBe(true);
    });

    test('cautious appetite is stricter than aggressive on the same batch', function () {
        var batch = {
            batchId: 'B-APP',
            intendedUse: 'research',
            printQualityScore: 70,
            sterilityTest: { status: 'passed' },
            viability: { percent: 86 },
            deviations: [{ severity: 'minor' }, { severity: 'minor' }],
        };
        var cautious = makeAdvisor({ riskAppetite: 'cautious' }).evaluate(batch);
        var aggressive = makeAdvisor({ riskAppetite: 'aggressive' }).evaluate(batch);
        expect(cautious.score).toBeLessThanOrEqual(aggressive.score);
    });

    test('deterministic output for identical input with fixed now()', function () {
        var batch = {
            batchId: 'B-DET',
            intendedUse: 'pre_clinical',
            printQualityScore: 78,
            sterilityTest: { status: 'passed' },
            mycoplasmaTest: { status: 'negative' },
            viability: { percent: 84 },
            environmentalExcursions: [{ severity: 'medium' }],
            deviations: [{ severity: 'minor' }],
        };
        var r1 = makeAdvisor().formatJson(makeAdvisor().evaluate(batch));
        var r2 = makeAdvisor().formatJson(makeAdvisor().evaluate(batch));
        expect(r1).toBe(r2);
    });

    test('does not mutate input batch', function () {
        var batch = {
            batchId: 'B-IMM',
            intendedUse: 'research',
            printQualityScore: 50,
            environmentalExcursions: [{ severity: 'high' }],
            deviations: [{ severity: 'moderate' }],
        };
        var snapshot = JSON.stringify(batch);
        makeAdvisor().evaluate(batch);
        expect(JSON.stringify(batch)).toBe(snapshot);
    });

    test('formatText, formatMarkdown, formatJson all produce non-empty strings', function () {
        var a = makeAdvisor();
        var r = a.evaluate({ batchId: 'B-FMT', printQualityScore: 88, sterilityTest: { status: 'passed' } });
        expect(typeof a.formatText(r)).toBe('string');
        expect(a.formatMarkdown(r)).toContain('Batch Release Report');
        expect(function () { JSON.parse(a.formatJson(r)); }).not.toThrow();
    });

    test('simulate applies top playbook actions and improves projected score', function () {
        var a = makeAdvisor();
        var batch = {
            batchId: 'B-SIM',
            intendedUse: 'research',
            printQualityScore: 50,
            sterilityTest: { status: 'passed' },
            viability: { percent: 75 },
        };
        var base = a.evaluate(batch);
        var sim = a.simulate(batch, { applyTop: 3 });
        expect(sim.baselineScore).toBe(base.score);
        expect(sim.projectedScore).toBeGreaterThanOrEqual(base.score);
        expect(sim.appliedActions.length).toBeLessThanOrEqual(base.playbook.length);
    });

    test('simulate cannot un-trigger REJECT_DESTROY', function () {
        var a = makeAdvisor();
        var batch = { batchId: 'B-X', contaminationDetected: true, printQualityScore: 100 };
        var sim = a.simulate(batch, { applyTop: 10 });
        expect(sim.projectedVerdict).toBe(V.REJECT_DESTROY);
        expect(sim.projectedGrade).toBe('F');
    });

    test('throws on missing batch', function () {
        var a = makeAdvisor();
        expect(function () { a.evaluate(); }).toThrow();
        expect(function () { a.evaluate(null); }).toThrow();
    });

    test('reasons sorted by severity descending', function () {
        var a = makeAdvisor();
        var r = a.evaluate({
            batchId: 'B-SORT',
            intendedUse: 'research',
            printQualityScore: 30,
            sterilityTest: { status: 'passed' },
            viability: { percent: 30 },
            environmentalExcursions: [{ severity: 'high' }],
            deviations: [{ severity: 'moderate' }, { severity: 'minor' }],
        });
        for (var i = 1; i < r.reasons.length; i++) {
            expect(r.reasons[i].severity).toBeLessThanOrEqual(r.reasons[i - 1].severity);
        }
    });

    test('exposed via biobots index as createBatchReleaseAdvisor', function () {
        var biobots = require('../index.js');
        expect(typeof biobots.createBatchReleaseAdvisor).toBe('function');
        var a = biobots.createBatchReleaseAdvisor({ now: frozenNow });
        var r = a.evaluate({ batchId: 'B-IDX', printQualityScore: 95, sterilityTest: { status: 'passed' } });
        expect(r.verdict).toBe(V.RELEASE);
    });
});
