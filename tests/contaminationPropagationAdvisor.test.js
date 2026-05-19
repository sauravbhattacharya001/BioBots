'use strict';

var _mod = require('../docs/shared/contaminationPropagationAdvisor');
var createContaminationPropagationAdvisor = _mod.createContaminationPropagationAdvisor;

function fixedNow() { return new Date('2026-05-19T20:00:00Z'); }

function makeAdvisor(extra) {
    var opts = { now: fixedNow };
    if (extra) for (var k in extra) opts[k] = extra[k];
    return createContaminationPropagationAdvisor(opts);
}

describe('ContaminationPropagationAdvisor', function () {
    it('exposes the expected API surface', function () {
        var a = makeAdvisor();
        expect(typeof a.evaluate).toBe('function');
        expect(typeof a.formatText).toBe('function');
        expect(typeof a.formatMarkdown).toBe('function');
        expect(typeof a.formatJson).toBe('function');
    });

    it('rejects unknown risk appetite at construction', function () {
        expect(function () { createContaminationPropagationAdvisor({ riskAppetite: 'wild' }); }).toThrow();
    });

    it('returns a clean report when there are no sources', function () {
        var r = makeAdvisor().evaluate({});
        expect(r.grade).toBe('A');
        expect(r.batches.length).toBe(0);
        expect(r.counts.affected).toBe(0);
        expect(r.insights.some(function (i) { return i.code === 'NO_SOURCES_PROVIDED'; })).toBe(true);
        expect(r.playbook.some(function (p) { return p.id === 'NO_PROPAGATION_DETECTED'; })).toBe(true);
    });

    it('classifies the source batch as DESTROY with risk 100 and a P0 action', function () {
        var r = makeAdvisor().evaluate({
            sources: [{ batchId: 'B-001', severity: 'confirmed', organism: 'mycoplasma' }],
            lineage: [{ batchId: 'B-001', parents: [] }],
        });
        var src = r.batches.find(function (b) { return b.batchId === 'B-001'; });
        expect(src.verdict).toBe('DESTROY');
        expect(src.priority).toBe('P0');
        expect(src.riskScore).toBe(100);
        expect(r.playbook.some(function (a) { return a.id === 'DESTROY_CONTAMINATED_SOURCES' && a.priority === 'P0'; })).toBe(true);
    });

    it('walks lineage forward up to horizonHops and assigns decreasing risk by depth', function () {
        var r = makeAdvisor().evaluate({
            sources: [{ batchId: 'B-001', severity: 'confirmed', organism: 'bacterial' }],
            lineage: [
                { batchId: 'B-001', parents: [] },
                { batchId: 'B-002', parents: ['B-001'] },
                { batchId: 'B-003', parents: ['B-002'] },
                { batchId: 'B-004', parents: ['B-003'] },
                { batchId: 'B-005', parents: ['B-004'] },
                { batchId: 'B-006', parents: ['B-005'] },
            ],
            horizonHops: 3,
        });
        var ids = r.batches.map(function (b) { return b.batchId; });
        expect(ids).toEqual(expect.arrayContaining(['B-001', 'B-002', 'B-003', 'B-004']));
        expect(ids).not.toEqual(expect.arrayContaining(['B-005']));
        var b2 = r.batches.find(function (b) { return b.batchId === 'B-002'; });
        var b3 = r.batches.find(function (b) { return b.batchId === 'B-003'; });
        expect(b2.depth).toBe(1);
        expect(b3.depth).toBe(2);
        expect(b2.riskScore).toBeGreaterThan(b3.riskScore);
    });

    it('emits a RECALL action and SHIPPED_BATCHES_AFFECTED insight for shipped downstream batches', function () {
        var r = makeAdvisor().evaluate({
            sources: [{ batchId: 'S-1', severity: 'confirmed', organism: 'mycoplasma' }],
            lineage: [
                { batchId: 'S-1', parents: [] },
                { batchId: 'D-1', parents: ['S-1'], shipped: true },
            ],
        });
        var d1 = r.batches.find(function (b) { return b.batchId === 'D-1'; });
        expect(['RECALL', 'QUARANTINE']).toContain(d1.verdict);
        expect(r.playbook.some(function (a) { return a.id === 'INITIATE_RECALL' && a.priority === 'P0'; })).toBe(true);
        expect(r.insights.some(function (i) { return i.code === 'SHIPPED_BATCHES_AFFECTED'; })).toBe(true);
        expect(r.grade).toBe('F');
    });

    it('detects sibling contamination via shared media lot within contact window', function () {
        var r = makeAdvisor().evaluate({
            sources: [{ batchId: 'S-1', severity: 'confirmed', organism: 'bacterial', detectedAt: '2026-05-19T18:00:00Z' }],
            lineage: [
                { batchId: 'S-1', parents: [], sharedMediaLotId: 'M-42', createdAt: '2026-05-19T16:00:00Z' },
                { batchId: 'SIB-A', parents: [], sharedMediaLotId: 'M-42', createdAt: '2026-05-19T17:00:00Z' },
                { batchId: 'SIB-B', parents: [], sharedMediaLotId: 'M-42', createdAt: '2026-05-19T15:30:00Z' },
                { batchId: 'FAR', parents: [], sharedMediaLotId: 'M-42', createdAt: '2026-05-10T00:00:00Z' },
            ],
            contactWindowHours: 24,
        });
        var ids = r.batches.map(function (b) { return b.batchId; });
        expect(ids).toEqual(expect.arrayContaining(['SIB-A', 'SIB-B']));
        expect(ids).not.toContain('FAR');
        var sibA = r.batches.find(function (b) { return b.batchId === 'SIB-A'; });
        expect(sibA.via).toContain('SHARED_MEDIA_LOT');
        expect(r.insights.some(function (i) { return i.code === 'SHARED_MEDIA_LOT_AT_FAULT'; })).toBe(true);
    });

    it('promotes patient-linked batches and emits NOTIFY_CLINICAL_TEAM + PATIENT_IMPACT', function () {
        var r = makeAdvisor().evaluate({
            sources: [{ batchId: 'P-0', severity: 'confirmed', organism: 'viral' }],
            lineage: [
                { batchId: 'P-0', parents: [] },
                { batchId: 'P-1', parents: ['P-0'], patientId: 'PT-77' },
            ],
        });
        expect(r.playbook.some(function (a) { return a.id === 'NOTIFY_CLINICAL_TEAM' && a.priority === 'P0'; })).toBe(true);
        expect(r.insights.some(function (i) { return i.code === 'PATIENT_IMPACT'; })).toBe(true);
        expect(r.grade).toBe('F');
    });

    it('respects already-destroyed batches by clamping their score low', function () {
        var r = makeAdvisor().evaluate({
            sources: [{ batchId: 'X-0', severity: 'confirmed', organism: 'bacterial' }],
            lineage: [
                { batchId: 'X-0', parents: [] },
                { batchId: 'X-1', parents: ['X-0'], status: 'destroyed' },
            ],
        });
        var x1 = r.batches.find(function (b) { return b.batchId === 'X-1'; });
        expect(x1.riskScore).toBeLessThanOrEqual(15);
    });

    it('isolated sources (no lineage descendants) emit ISOLATED_SOURCES insight', function () {
        var r = makeAdvisor().evaluate({
            sources: [{ batchId: 'I-1', severity: 'confirmed', organism: 'bacterial' }],
            lineage: [{ batchId: 'I-1', parents: [] }],
        });
        expect(r.insights.some(function (i) { return i.code === 'ISOLATED_SOURCES'; })).toBe(true);
    });

    it('risk-appetite monotonicity: cautious >= balanced >= aggressive on downstream risk', function () {
        var input = {
            sources: [{ batchId: 'M-0', severity: 'suspected', organism: 'bacterial' }],
            lineage: [
                { batchId: 'M-0', parents: [] },
                { batchId: 'M-1', parents: ['M-0'] },
            ],
        };
        var cautious = makeAdvisor({ riskAppetite: 'cautious' }).evaluate(input);
        var balanced = makeAdvisor({ riskAppetite: 'balanced' }).evaluate(input);
        var aggressive = makeAdvisor({ riskAppetite: 'aggressive' }).evaluate(input);
        var m1c = cautious.batches.find(function (b) { return b.batchId === 'M-1'; }).riskScore;
        var m1b = balanced.batches.find(function (b) { return b.batchId === 'M-1'; }).riskScore;
        var m1a = aggressive.batches.find(function (b) { return b.batchId === 'M-1'; }).riskScore;
        expect(m1c).toBeGreaterThanOrEqual(m1b);
        expect(m1b).toBeGreaterThanOrEqual(m1a);
    });

    it('aggressive appetite trims P3 fluff when P0/P1 actions are present', function () {
        var r = makeAdvisor({ riskAppetite: 'aggressive' }).evaluate({
            sources: [{ batchId: 'A-0', severity: 'confirmed', organism: 'bacterial' }],
            lineage: [
                { batchId: 'A-0', parents: [] },
                { batchId: 'A-1', parents: ['A-0'] },
                { batchId: 'A-2', parents: ['A-1'] },
                { batchId: 'A-3', parents: ['A-2'] },
            ],
        });
        expect(r.playbook.every(function (a) { return a.priority !== 'P3'; })).toBe(true);
    });

    it('cautious appetite appends SCHEDULE_ROOT_CAUSE_AUDIT when serious actions exist', function () {
        var r = makeAdvisor({ riskAppetite: 'cautious' }).evaluate({
            sources: [{ batchId: 'C-0', severity: 'confirmed', organism: 'bacterial' }],
            lineage: [
                { batchId: 'C-0', parents: [] },
                { batchId: 'C-1', parents: ['C-0'] },
            ],
        });
        expect(r.playbook.some(function (a) { return a.id === 'SCHEDULE_ROOT_CAUSE_AUDIT'; })).toBe(true);
    });

    it('sorts batches P0-first and by risk score descending within priority', function () {
        var r = makeAdvisor().evaluate({
            sources: [{ batchId: 'Q-0', severity: 'confirmed', organism: 'bacterial' }],
            lineage: [
                { batchId: 'Q-0', parents: [] },
                { batchId: 'Q-1', parents: ['Q-0'] },
                { batchId: 'Q-2', parents: ['Q-1'] },
                { batchId: 'Q-3', parents: ['Q-2'] },
            ],
        });
        var prios = r.batches.map(function (b) { return b.priority; });
        for (var i = 1; i < prios.length; i++) {
            expect(prios[i].localeCompare(prios[i - 1])).toBeGreaterThanOrEqual(0);
        }
    });

    it('formatText, formatMarkdown, formatJson all return non-empty stable output', function () {
        var r = makeAdvisor().evaluate({
            sources: [{ batchId: 'R-0', severity: 'confirmed', organism: 'mycoplasma' }],
            lineage: [
                { batchId: 'R-0', parents: [] },
                { batchId: 'R-1', parents: ['R-0'], shipped: true },
            ],
        });
        var a = makeAdvisor();
        var txt = a.formatText(r);
        var md = a.formatMarkdown(r);
        var json = a.formatJson(r);
        expect(txt).toMatch(/CONTAMINATION PROPAGATION ADVISOR/);
        expect(md).toMatch(/^# Contamination Propagation Advisor/);
        expect(md).toMatch(/## Affected batches/);
        expect(md).toMatch(/## Playbook/);
        expect(md).toMatch(/## Insights/);
        var parsed = JSON.parse(json);
        expect(parsed.grade).toBe(r.grade);
        // Byte-stable: re-render must equal.
        var json2 = a.formatJson(r);
        expect(json).toBe(json2);
    });

    it('never mutates input arrays or records', function () {
        var sources = [{ batchId: 'N-0', severity: 'confirmed', organism: 'bacterial' }];
        var lineage = [{ batchId: 'N-0', parents: [] }, { batchId: 'N-1', parents: ['N-0'] }];
        var sourcesCopy = JSON.parse(JSON.stringify(sources));
        var lineageCopy = JSON.parse(JSON.stringify(lineage));
        makeAdvisor().evaluate({ sources: sources, lineage: lineage });
        expect(sources).toEqual(sourcesCopy);
        expect(lineage).toEqual(lineageCopy);
    });

    it('horizonHops defaults to 4 and contactWindowHours defaults to 24', function () {
        var r = makeAdvisor().evaluate({ sources: [], lineage: [] });
        expect(r.horizonHops).toBe(4);
        expect(r.contactWindowHours).toBe(24);
    });

    it('confidence is higher for lineage descendants than sibling-only links', function () {
        var r = makeAdvisor().evaluate({
            sources: [{ batchId: 'L-0', severity: 'confirmed', organism: 'bacterial', detectedAt: '2026-05-19T18:00:00Z' }],
            lineage: [
                { batchId: 'L-0', parents: [], equipmentId: 'BP-1', createdAt: '2026-05-19T17:00:00Z' },
                { batchId: 'L-1', parents: ['L-0'], createdAt: '2026-05-19T17:30:00Z' },
                { batchId: 'L-2', parents: [], equipmentId: 'BP-1', createdAt: '2026-05-19T17:45:00Z' },
            ],
        });
        var lineageChild = r.batches.find(function (b) { return b.batchId === 'L-1'; });
        var sibling = r.batches.find(function (b) { return b.batchId === 'L-2'; });
        expect(lineageChild.confidence).toBeGreaterThan(sibling.confidence);
    });
});
