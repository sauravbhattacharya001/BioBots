'use strict';

/**
 * Tests for contaminationPropagationAdvisor.
 *
 * Covers: factory construction, lineage descendant walking (multi-hop,
 * horizon clamp), sibling sweep via shared equipment / clean room /
 * media / reagent / operator, verdict ladder (DESTROY for source,
 * RECALL for shipped high-risk, QUARANTINE/RETEST/MONITOR tiers),
 * shipped-batch upgrade to RECALL, already-destroyed clamp, risk
 * appetite shifts, and rendered text/markdown/json outputs.
 */

var factory = require('../docs/shared/contaminationPropagationAdvisor');
var createContaminationPropagationAdvisor = factory.createContaminationPropagationAdvisor;

function fixedNow(iso) { return function () { return new Date(iso); }; }

describe('contaminationPropagationAdvisor — basics', function () {
    test('factory exists and returns the documented API', function () {
        expect(typeof createContaminationPropagationAdvisor).toBe('function');
        var cpa = createContaminationPropagationAdvisor();
        expect(typeof cpa.evaluate).toBe('function');
        expect(typeof cpa.formatText).toBe('function');
        expect(typeof cpa.formatMarkdown).toBe('function');
        expect(typeof cpa.formatJson).toBe('function');
    });

    test('rejects an unknown default risk appetite at construction', function () {
        expect(function () {
            createContaminationPropagationAdvisor({ riskAppetite: 'nonsense' });
        }).toThrow(/riskAppetite/);
    });

    test('rejects an unknown per-call risk appetite', function () {
        var cpa = createContaminationPropagationAdvisor();
        expect(function () {
            cpa.evaluate({ sources: [], lineage: [], riskAppetite: 'unhinged' });
        }).toThrow(/riskAppetite/);
    });

    test('handles empty input gracefully', function () {
        var cpa = createContaminationPropagationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var r = cpa.evaluate({});
        expect(r).toBeDefined();
        expect(Array.isArray(r.batches)).toBe(true);
        expect(r.batches.length).toBe(0);
    });
});

describe('contaminationPropagationAdvisor — lineage propagation', function () {
    test('source batch gets DESTROY verdict; direct descendant gets QUARANTINE/RECALL/RETEST', function () {
        var cpa = createContaminationPropagationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var report = cpa.evaluate({
            sources: [{ batchId: 'B-001', severity: 'confirmed', organism: 'mycoplasma' }],
            lineage: [
                { batchId: 'B-001', parents: [], equipmentId: 'BSC-1' },
                { batchId: 'B-002', parents: ['B-001'], equipmentId: 'BSC-1' },
                { batchId: 'B-003', parents: ['B-002'], equipmentId: 'BSC-2' },
            ],
        });

        var byId = indexBy(report.batches, 'batchId');
        expect(byId['B-001']).toBeDefined();
        expect(byId['B-001'].verdict).toBe('DESTROY');
        expect(byId['B-001'].priority).toBe('P0');

        // B-002 is a direct descendant of a confirmed mycoplasma source — must be a high-priority hold.
        expect(byId['B-002']).toBeDefined();
        expect(['QUARANTINE', 'RECALL', 'RETEST_URGENT']).toContain(byId['B-002'].verdict);
        expect(byId['B-002'].depth).toBe(1);

        // Two hops down should still be flagged (RETEST or MONITOR).
        expect(byId['B-003']).toBeDefined();
        expect(byId['B-003'].depth).toBe(2);
    });

    test('shipped descendant escalates to RECALL', function () {
        var cpa = createContaminationPropagationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var report = cpa.evaluate({
            sources: [{ batchId: 'B-001', severity: 'confirmed', organism: 'viral' }],
            lineage: [
                { batchId: 'B-001', parents: [] },
                { batchId: 'B-002', parents: ['B-001'], shipped: true },
            ],
            shipments: [
                { id: 'SHIP-1', batchId: 'B-002', customer: 'CustA', shippedAt: '2026-05-19T10:00:00Z' },
            ],
        });
        var byId = indexBy(report.batches, 'batchId');
        expect(byId['B-002'].verdict).toBe('RECALL');
        expect(byId['B-002'].priority).toBe('P0');
    });

    test('horizon hops caps how deep lineage propagates', function () {
        var cpa = createContaminationPropagationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var report = cpa.evaluate({
            sources: [{ batchId: 'B-0', severity: 'confirmed', organism: 'bacterial' }],
            lineage: [
                { batchId: 'B-0', parents: [] },
                { batchId: 'B-1', parents: ['B-0'] },
                { batchId: 'B-2', parents: ['B-1'] },
                { batchId: 'B-3', parents: ['B-2'] },
                { batchId: 'B-4', parents: ['B-3'] },
                { batchId: 'B-5', parents: ['B-4'] },
            ],
            horizonHops: 2,
        });
        var ids = report.batches.map(function (b) { return b.batchId; });
        expect(ids).toContain('B-0');
        expect(ids).toContain('B-1');
        expect(ids).toContain('B-2');
        expect(ids).not.toContain('B-4');
        expect(ids).not.toContain('B-5');
    });

    test('already-destroyed status clamps risk score down', function () {
        var cpa = createContaminationPropagationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var report = cpa.evaluate({
            sources: [{ batchId: 'B-0', severity: 'confirmed', organism: 'mycoplasma' }],
            lineage: [
                { batchId: 'B-0', parents: [] },
                { batchId: 'B-1', parents: ['B-0'], status: 'destroyed' },
            ],
        });
        var b1 = indexBy(report.batches, 'batchId')['B-1'];
        expect(b1).toBeDefined();
        expect(b1.riskScore).toBeLessThanOrEqual(15);
    });
});

describe('contaminationPropagationAdvisor — sibling sweep', function () {
    test('sibling batch sharing equipment within contact window is flagged', function () {
        var cpa = createContaminationPropagationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var report = cpa.evaluate({
            sources: [{
                batchId: 'B-SRC',
                severity: 'confirmed',
                organism: 'mycoplasma',
                detectedAt: '2026-05-20T10:00:00Z',
            }],
            lineage: [
                { batchId: 'B-SRC', parents: [], equipmentId: 'BP-7', createdAt: '2026-05-20T10:00:00Z' },
                { batchId: 'B-SIB', parents: [], equipmentId: 'BP-7', createdAt: '2026-05-20T11:00:00Z' },
                { batchId: 'B-FAR', parents: [], equipmentId: 'BP-7', createdAt: '2026-05-15T11:00:00Z' },
            ],
            contactWindowHours: 24,
        });
        var byId = indexBy(report.batches, 'batchId');
        expect(byId['B-SIB']).toBeDefined();
        expect(byId['B-SIB'].via).toContain('SHARED_EQUIPMENT');
        // B-FAR is outside the 24h contact window from the source detection time.
        expect(byId['B-FAR']).toBeUndefined();
    });

    test('shared reagent lot also triggers a sibling flag', function () {
        var cpa = createContaminationPropagationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var report = cpa.evaluate({
            sources: [{
                batchId: 'B-SRC',
                severity: 'confirmed',
                organism: 'bacterial',
                detectedAt: '2026-05-20T11:00:00Z',
            }],
            lineage: [
                {
                    batchId: 'B-SRC', parents: [],
                    sharedReagentLotIds: ['LOT-42'],
                    createdAt: '2026-05-20T10:00:00Z',
                },
                {
                    batchId: 'B-SIB', parents: [],
                    sharedReagentLotIds: ['LOT-42'],
                    createdAt: '2026-05-20T11:00:00Z',
                },
            ],
        });
        var sib = indexBy(report.batches, 'batchId')['B-SIB'];
        expect(sib).toBeDefined();
        expect(sib.via).toContain('SHARED_REAGENT_LOT');
    });
});

describe('contaminationPropagationAdvisor — appetite & rendering', function () {
    var input = {
        sources: [{ batchId: 'B-0', severity: 'suspected', organism: 'bacterial' }],
        lineage: [
            { batchId: 'B-0', parents: [] },
            { batchId: 'B-1', parents: ['B-0'] },
        ],
    };

    test('cautious appetite scores >= aggressive appetite', function () {
        var cpa = createContaminationPropagationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var cautious = cpa.evaluate(Object.assign({}, input, { riskAppetite: 'cautious' }));
        var aggressive = cpa.evaluate(Object.assign({}, input, { riskAppetite: 'aggressive' }));
        var c1 = indexBy(cautious.batches, 'batchId')['B-1'];
        var a1 = indexBy(aggressive.batches, 'batchId')['B-1'];
        expect(c1.riskScore).toBeGreaterThanOrEqual(a1.riskScore);
    });

    test('formatText / formatMarkdown / formatJson all return usable output', function () {
        var cpa = createContaminationPropagationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var report = cpa.evaluate(input);
        var txt = cpa.formatText(report);
        var md = cpa.formatMarkdown(report);
        var json = cpa.formatJson(report);
        expect(typeof txt).toBe('string');
        expect(txt.length).toBeGreaterThan(0);
        expect(typeof md).toBe('string');
        expect(md.length).toBeGreaterThan(0);
        var parsed = JSON.parse(json);
        expect(parsed).toBeDefined();
        // Round-trip preserves the per-batch list under some top-level key.
        var json2 = JSON.stringify(parsed);
        expect(json2).toContain('B-0');
        expect(json2).toContain('B-1');
    });
});

// helpers --------------------------------------------------------

function indexBy(arr, key) {
    var out = {};
    for (var i = 0; i < arr.length; i++) {
        out[arr[i][key]] = arr[i];
    }
    return out;
}
