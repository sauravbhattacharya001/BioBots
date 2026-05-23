'use strict';

const { createReagentLotRecallReadinessAdvisor } = require('../docs/shared/reagentLotRecallReadinessAdvisor');

const NOW = new Date('2026-05-23T10:00:00Z');
const nowFn = () => NOW;

function build() {
    return createReagentLotRecallReadinessAdvisor({ now: nowFn });
}

describe('createReagentLotRecallReadinessAdvisor', () => {
    test('factory shape', () => {
        const adv = build();
        expect(typeof adv.evaluate).toBe('function');
        expect(typeof adv.format).toBe('function');
    });

    test('empty lot list -> empty portfolio + NO_LOTS_PROVIDED insight', () => {
        const adv = build();
        const r = adv.evaluate({ lots: [] });
        expect(r.portfolio.totalLots).toBe(0);
        expect(r.perLot).toEqual([]);
        expect(r.insights).toContain('NO_LOTS_PROVIDED');
        expect(r.headline).toMatch(/No lots/);
    });

    test('fully documented lot -> RECALL_READY verdict, P3 priority, grade A', () => {
        const adv = build();
        const r = adv.evaluate({
            lots: [{
                id: 'L-001', reagent: 'FBS', inUse: true,
                receivedAt: '2026-05-01T00:00:00Z',
                receivingInspectionAt: '2026-05-02T00:00:00Z',
                coaOnFile: true, chainOfCustodyComplete: true,
                qcStatus: 'pass',
                downstreamBatchIds: ['B-1', 'B-2'],
                criticality: 3
            }]
        });
        const lot = r.perLot[0];
        expect(lot.verdict).toBe('RECALL_READY');
        expect(lot.priority).toBe('P3');
        expect(lot.grade).toBe('A');
        expect(lot.gaps).toEqual([]);
    });

    test('in-use lot with null downstreamBatchIds -> TRACE_BLIND P0', () => {
        const adv = build();
        const r = adv.evaluate({
            lots: [{
                id: 'L-002', reagent: 'CaCl2', inUse: true,
                receivedAt: '2026-04-01T00:00:00Z',
                receivingInspectionAt: '2026-04-02T00:00:00Z',
                coaOnFile: true, chainOfCustodyComplete: true,
                qcStatus: 'pass',
                downstreamBatchIds: null
            }]
        });
        const lot = r.perLot[0];
        expect(lot.verdict).toBe('TRACE_BLIND');
        expect(lot.priority).toBe('P0');
        expect(r.playbook.some(a => a.id === 'REBUILD_DOWNSTREAM_BATCH_LIST')).toBe(true);
        expect(r.insights).toContain('TRACE_BLIND_LOTS_PRESENT');
    });

    test('expired but in-use lot -> EXPIRED_IN_USE P0', () => {
        const adv = build();
        const r = adv.evaluate({
            lots: [{
                id: 'L-003', reagent: 'Alginate', inUse: true,
                receivedAt: '2025-12-01T00:00:00Z',
                expiresAt: '2026-05-01T00:00:00Z',
                receivingInspectionAt: '2025-12-02T00:00:00Z',
                coaOnFile: true, chainOfCustodyComplete: true,
                qcStatus: 'pass', downstreamBatchIds: ['B-9']
            }]
        });
        const lot = r.perLot[0];
        expect(lot.verdict).toBe('EXPIRED_IN_USE');
        expect(lot.priority).toBe('P0');
        expect(lot.daysUntilExpiry).toBeLessThan(0);
        expect(r.playbook.some(a => a.id === 'QUARANTINE_EXPIRED_IN_USE_LOTS')).toBe(true);
    });

    test('missing COA + chain -> DOCUMENTATION_GAP P1', () => {
        const adv = build();
        const r = adv.evaluate({
            lots: [{
                id: 'L-004', reagent: 'DMEM', inUse: true,
                receivedAt: '2026-05-10T00:00:00Z',
                coaOnFile: false, chainOfCustodyComplete: false,
                receivingInspectionAt: '2026-05-11T00:00:00Z',
                qcStatus: 'pass', downstreamBatchIds: ['B-7']
            }]
        });
        const lot = r.perLot[0];
        expect(lot.verdict).toBe('DOCUMENTATION_GAP');
        expect(lot.priority).toBe('P1');
        expect(lot.gaps).toEqual(expect.arrayContaining(['NO_COA', 'CHAIN_BROKEN']));
        expect(r.playbook.some(a => a.id === 'BACKFILL_MISSING_DOCUMENTATION')).toBe(true);
    });

    test('storage excursion -> STORAGE_RISK P1', () => {
        const adv = build();
        const r = adv.evaluate({
            lots: [{
                id: 'L-005', reagent: 'PBS', inUse: true,
                receivedAt: '2026-05-10T00:00:00Z',
                receivingInspectionAt: '2026-05-11T00:00:00Z',
                coaOnFile: true, chainOfCustodyComplete: true,
                qcStatus: 'pass', downstreamBatchIds: ['B-12'],
                storageExcursionCount: 2
            }]
        });
        const lot = r.perLot[0];
        expect(lot.verdict).toBe('STORAGE_RISK');
        expect(lot.priority).toBe('P1');
        expect(r.playbook.some(a => a.id === 'REVIEW_STORAGE_INTEGRITY')).toBe(true);
    });

    test('open investigation -> UNDER_INVESTIGATION P0', () => {
        const adv = build();
        const r = adv.evaluate({
            lots: [{
                id: 'L-006', reagent: 'Trypsin', inUse: true,
                receivedAt: '2026-05-10T00:00:00Z',
                receivingInspectionAt: '2026-05-11T00:00:00Z',
                coaOnFile: true, chainOfCustodyComplete: true,
                qcStatus: 'pass', downstreamBatchIds: ['B-15']
            }],
            openInvestigations: [{ lotId: 'L-006', severity: 'critical' }]
        });
        const lot = r.perLot[0];
        expect(lot.verdict).toBe('UNDER_INVESTIGATION');
        expect(lot.priority).toBe('P0');
        expect(r.playbook.some(a => a.id === 'HOLD_LOTS_UNDER_INVESTIGATION')).toBe(true);
    });

    test('completely empty lot -> INSUFFICIENT_DATA', () => {
        const adv = build();
        const r = adv.evaluate({ lots: [{ id: 'L-007', reagent: 'Mystery', inUse: false, qcStatus: 'unknown' }] });
        const lot = r.perLot[0];
        expect(lot.verdict).toBe('INSUFFICIENT_DATA');
        expect(r.playbook.some(a => a.id === 'BACKFILL_LOT_METADATA')).toBe(true);
    });

    test('risk appetite shifts score: cautious <= balanced <= aggressive', () => {
        const lots = [{
            id: 'L-100', reagent: 'FBS', inUse: true,
            receivedAt: '2026-05-01T00:00:00Z',
            receivingInspectionAt: '2026-05-02T00:00:00Z',
            coaOnFile: false, chainOfCustodyComplete: true,
            qcStatus: 'pass', downstreamBatchIds: ['B-1']
        }];
        const cautious = build().evaluate({ lots: lots, options: { riskAppetite: 'cautious' } }).perLot[0].score;
        const balanced = build().evaluate({ lots: lots, options: { riskAppetite: 'balanced' } }).perLot[0].score;
        const aggressive = build().evaluate({ lots: lots, options: { riskAppetite: 'aggressive' } }).perLot[0].score;
        expect(cautious).toBeLessThanOrEqual(balanced);
        expect(balanced).toBeLessThanOrEqual(aggressive);
    });

    test('input lot is not mutated', () => {
        const adv = build();
        const lot = {
            id: 'L-200', reagent: 'FBS', inUse: true,
            receivedAt: '2026-05-01T00:00:00Z',
            coaOnFile: true, chainOfCustodyComplete: true,
            downstreamBatchIds: ['B-1']
        };
        const snapshot = JSON.stringify(lot);
        adv.evaluate({ lots: [lot] });
        expect(JSON.stringify(lot)).toBe(snapshot);
    });

    test('format json is deterministic + sorted-keys + parseable', () => {
        const adv = build();
        const r = adv.evaluate({
            lots: [
                { id: 'L-2', reagent: 'X', inUse: true, coaOnFile: true, chainOfCustodyComplete: true, qcStatus: 'pass', downstreamBatchIds: ['b'] },
                { id: 'L-1', reagent: 'Y', inUse: true, coaOnFile: true, chainOfCustodyComplete: true, qcStatus: 'pass', downstreamBatchIds: ['a'] }
            ]
        });
        const j1 = adv.format(r, 'json');
        const j2 = adv.format(r, 'json');
        expect(j1).toBe(j2);
        expect(() => JSON.parse(j1)).not.toThrow();
    });

    test('markdown render has all sections', () => {
        const adv = build();
        const r = adv.evaluate({
            lots: [{
                id: 'L-300', reagent: 'FBS', inUse: true,
                coaOnFile: true, chainOfCustodyComplete: true,
                qcStatus: 'pass', downstreamBatchIds: ['B-1'],
                receivedAt: '2026-05-01T00:00:00Z',
                receivingInspectionAt: '2026-05-02T00:00:00Z'
            }]
        });
        const md = adv.format(r, 'markdown');
        expect(md).toContain('# Reagent Lot Recall Readiness');
        expect(md).toContain('## Portfolio');
        expect(md).toContain('## Lots');
        expect(md).toContain('## Playbook');
        expect(md).toContain('## Insights');
    });

    test('blind + expired -> portfolio grade floor (C max)', () => {
        const adv = build();
        const r = adv.evaluate({
            lots: [
                { id: 'L-A', reagent: 'X', inUse: true, downstreamBatchIds: null, coaOnFile: true, chainOfCustodyComplete: true, qcStatus: 'pass' },
                { id: 'L-B', reagent: 'Y', inUse: true, expiresAt: '2026-01-01T00:00:00Z', coaOnFile: true, chainOfCustodyComplete: true, downstreamBatchIds: ['B-1'], qcStatus: 'pass', receivingInspectionAt: '2025-12-01T00:00:00Z' }
            ]
        });
        expect(['C', 'D', 'F']).toContain(r.portfolio.grade);
        expect(r.portfolio.blindCount).toBeGreaterThanOrEqual(1);
        expect(r.portfolio.expiredInUseCount).toBeGreaterThanOrEqual(1);
    });

    test('recallHorizonHours grows with gaps + downstream breadth', () => {
        const adv = build();
        const small = adv.evaluate({ lots: [{ id: 'L-S', reagent: 'X', inUse: true, coaOnFile: true, chainOfCustodyComplete: true, qcStatus: 'pass', downstreamBatchIds: ['B-1'], receivingInspectionAt: '2026-05-01T00:00:00Z' }] }).perLot[0].recallHorizonHours;
        const big = adv.evaluate({ lots: [{ id: 'L-B', reagent: 'X', inUse: true, coaOnFile: false, chainOfCustodyComplete: false, qcStatus: 'pass', downstreamBatchIds: ['B-1','B-2','B-3','B-4','B-5'], storageExcursionCount: 1 }] }).perLot[0].recallHorizonHours;
        expect(big).toBeGreaterThan(small);
    });

    test('factory is wired into top-level SDK', () => {
        const biobots = require('../index.js');
        expect(typeof biobots.createReagentLotRecallReadinessAdvisor).toBe('function');
        expect(biobots.hasFactory('createReagentLotRecallReadinessAdvisor')).toBe(true);
    });

    test('listFactories includes new advisor (sorted)', () => {
        const biobots = require('../index.js');
        const names = biobots.listFactories();
        expect(names).toContain('createReagentLotRecallReadinessAdvisor');
        const sorted = names.slice().sort();
        expect(names).toEqual(sorted);
    });

    test('deterministic ordering: priority asc then score asc then id asc', () => {
        const adv = build();
        const r = adv.evaluate({
            lots: [
                { id: 'C', reagent: 'X', inUse: true, coaOnFile: true, chainOfCustodyComplete: true, qcStatus: 'pass', downstreamBatchIds: ['B-1'], receivingInspectionAt: '2026-05-01T00:00:00Z' },
                { id: 'A', reagent: 'X', inUse: true, downstreamBatchIds: null, coaOnFile: true, chainOfCustodyComplete: true, qcStatus: 'pass' },
                { id: 'B', reagent: 'X', inUse: true, downstreamBatchIds: null, coaOnFile: true, chainOfCustodyComplete: true, qcStatus: 'pass' }
            ]
        });
        expect(r.perLot[0].id).toBe('A');
        expect(r.perLot[1].id).toBe('B');
        expect(r.perLot[2].id).toBe('C');
    });

    test('healthy portfolio triggers SCHEDULE_RECALL_DRILL', () => {
        const adv = build();
        const r = adv.evaluate({
            lots: [
                { id: 'L-1', reagent: 'X', inUse: true, coaOnFile: true, chainOfCustodyComplete: true, qcStatus: 'pass', downstreamBatchIds: ['B-1'], receivingInspectionAt: '2026-05-01T00:00:00Z' },
                { id: 'L-2', reagent: 'Y', inUse: true, coaOnFile: true, chainOfCustodyComplete: true, qcStatus: 'pass', downstreamBatchIds: ['B-2'], receivingInspectionAt: '2026-05-01T00:00:00Z' },
                { id: 'L-3', reagent: 'Z', inUse: true, coaOnFile: true, chainOfCustodyComplete: true, qcStatus: 'pass', downstreamBatchIds: ['B-3'], receivingInspectionAt: '2026-05-01T00:00:00Z' }
            ]
        });
        expect(r.playbook.some(a => a.id === 'SCHEDULE_RECALL_DRILL')).toBe(true);
        expect(r.insights).toContain('FULLY_RECALL_READY');
    });
});
