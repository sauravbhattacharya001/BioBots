'use strict';

const { createBatchQueuePrioritizationAdvisor, VERDICTS } =
    require('../docs/shared/batchQueuePrioritizationAdvisor');

const FIXED_NOW = new Date('2026-05-20T13:00:00Z');
function fixedNow() { return FIXED_NOW; }

function makeAdvisor(config) {
    return createBatchQueuePrioritizationAdvisor(Object.assign({ now: fixedNow }, config || {}));
}

function offsetIso(hours) {
    return new Date(FIXED_NOW.getTime() + hours * 3600 * 1000).toISOString();
}

describe('createBatchQueuePrioritizationAdvisor', () => {
    test('empty input returns HEALTHY_QUEUE and A grade', () => {
        const adv = makeAdvisor();
        const r = adv.prioritize({});
        expect(r.batches).toEqual([]);
        expect(r.summary.totalBatches).toBe(0);
        expect(r.summary.grade).toBe('A');
        expect(r.insights).toContain('HEALTHY_QUEUE');
        expect(r.playbook[0].id).toBe('MAINTAIN_QUEUE_OK');
    });

    test('SLA breach imminent → ESCALATE_SLA + P0', () => {
        const adv = makeAdvisor();
        const r = adv.prioritize({
            batches: [{
                id: 'B1', estimatedRuntimeHours: 4,
                slaDeadlineISO: offsetIso(2), // deadline in 2h, runtime 4h
            }],
        });
        const b = r.batches[0];
        expect(b.verdict).toBe(VERDICTS.ESCALATE_SLA);
        expect(b.priority).toBe('P0');
        expect(b.reasons).toContain('SLA_BREACH_IMMINENT');
        expect(r.playbook.find(p => p.id === 'ESCALATE_SLA_BREACH')).toBeTruthy();
    });

    test('past-deadline batch flagged ALREADY_LATE', () => {
        const adv = makeAdvisor();
        const r = adv.prioritize({
            batches: [{
                id: 'B1', estimatedRuntimeHours: 2,
                slaDeadlineISO: offsetIso(-3),
            }],
        });
        expect(r.batches[0].reasons).toContain('ALREADY_LATE');
        expect(r.batches[0].verdict).toBe(VERDICTS.ESCALATE_SLA);
        expect(r.batches[0].priority).toBe('P0');
    });

    test('unfinished dependency → BLOCKED_BY_DEPENDENCY', () => {
        const adv = makeAdvisor();
        const r = adv.prioritize({
            batches: [{
                id: 'B2', dependencyBatchIds: ['B1'], estimatedRuntimeHours: 2,
            }],
            context: { completedBatchIds: [] },
        });
        expect(r.batches[0].verdict).toBe(VERDICTS.BLOCKED_BY_DEPENDENCY);
        expect(r.batches[0].reasons).toContain('DEPENDENCY_PENDING');
        expect(r.batches[0].blockers).toContain('dependency:B1');
    });

    test('equipment unavailable → HOLD_FOR_RESOURCES', () => {
        const adv = makeAdvisor();
        const r = adv.prioritize({
            batches: [{
                id: 'B1', estimatedRuntimeHours: 3, requiredEquipmentId: 'PRINTER-1',
            }],
            context: {
                equipmentAvailability: {
                    'PRINTER-1': { healthyOk: false },
                },
            },
        });
        expect(r.batches[0].verdict).toBe(VERDICTS.HOLD_FOR_RESOURCES);
        expect(r.batches[0].reasons).toContain('EQUIPMENT_UNAVAILABLE');
    });

    test('all operators unavailable → HOLD_FOR_RESOURCES', () => {
        const adv = makeAdvisor();
        const r = adv.prioritize({
            batches: [{
                id: 'B1', estimatedRuntimeHours: 3,
                requiredOperatorIds: ['op1', 'op2'],
            }],
            context: {
                operatorAvailability: {
                    'op1': { availableAtISO: offsetIso(48) },
                    'op2': { availableAtISO: offsetIso(72) },
                },
            },
        });
        expect(r.batches[0].verdict).toBe(VERDICTS.HOLD_FOR_RESOURCES);
        expect(r.batches[0].reasons).toContain('OPERATOR_UNAVAILABLE');
    });

    test('fatigued operator only → score penalty, not blocked', () => {
        const adv = makeAdvisor();
        const r = adv.prioritize({
            batches: [{
                id: 'B1', estimatedRuntimeHours: 2,
                requiredOperatorIds: ['op1'],
            }],
            context: {
                operatorAvailability: {
                    'op1': { availableAtISO: offsetIso(1), fatigued: true },
                },
            },
        });
        expect(r.batches[0].reasons).toContain('OPERATOR_FATIGUED');
        expect(r.batches[0].verdict).not.toBe(VERDICTS.HOLD_FOR_RESOURCES);
        expect(r.batches[0].reasons).not.toContain('OPERATOR_UNAVAILABLE');
    });

    test('platinum + rush hint scores higher than standard', () => {
        const adv = makeAdvisor();
        const base = { estimatedRuntimeHours: 2 };
        const r1 = adv.prioritize({ batches: [Object.assign({ id: 'B1', customerTier: 'platinum', priorityHint: 'rush' }, base)] });
        const r2 = adv.prioritize({ batches: [Object.assign({ id: 'B2', customerTier: 'standard' }, base)] });
        expect(r1.batches[0].priorityScore).toBeGreaterThan(r2.batches[0].priorityScore);
        expect(r1.batches[0].reasons).toContain('PLATINUM_CUSTOMER');
        expect(r1.batches[0].reasons).toContain('RUSH_HINT');
    });

    test('rework deprioritized when no SLA pressure', () => {
        const adv = makeAdvisor();
        const r = adv.prioritize({
            batches: [{
                id: 'B1', estimatedRuntimeHours: 2, isRework: true,
            }],
        });
        expect(r.batches[0].verdict).toBe(VERDICTS.RECOMMEND_REWORK_BATCH_LATER);
        expect(r.batches[0].reasons).toContain('REWORK_LOWER_PRIORITY');
        expect(r.batches[0].priority).toBe('P3');
    });

    test('recommendedRunOrder sorts by priority then score', () => {
        const adv = makeAdvisor();
        const r = adv.prioritize({
            batches: [
                { id: 'low', estimatedRuntimeHours: 1, priorityHint: 'low' },
                { id: 'urgent', estimatedRuntimeHours: 4, slaDeadlineISO: offsetIso(3) },
                { id: 'mid', estimatedRuntimeHours: 2, customerTier: 'gold' },
            ],
        });
        expect(r.recommendedRunOrder[0]).toBe('urgent');
        expect(r.recommendedRunOrder).toContain('low');
        expect(r.recommendedRunOrder).toContain('mid');
    });

    test('risk_appetite shifts scores (cautious > balanced > aggressive)', () => {
        const adv = makeAdvisor();
        const input = { batches: [{ id: 'B1', estimatedRuntimeHours: 2, customerTier: 'gold' }] };
        const c = adv.prioritize(input, { risk_appetite: 'cautious' }).batches[0].priorityScore;
        const b = adv.prioritize(input, { risk_appetite: 'balanced' }).batches[0].priorityScore;
        const a = adv.prioritize(input, { risk_appetite: 'aggressive' }).batches[0].priorityScore;
        expect(c).toBeGreaterThanOrEqual(b);
        expect(b).toBeGreaterThanOrEqual(a);
        expect(c).toBeGreaterThan(a);
    });

    test('playbook dedupes ESCALATE_SLA_BREACH across multiple batches', () => {
        const adv = makeAdvisor();
        const r = adv.prioritize({
            batches: [
                { id: 'B1', estimatedRuntimeHours: 2, slaDeadlineISO: offsetIso(1) },
                { id: 'B2', estimatedRuntimeHours: 2, slaDeadlineISO: offsetIso(1) },
            ],
        });
        const escalates = r.playbook.filter(p => p.id === 'ESCALATE_SLA_BREACH');
        expect(escalates.length).toBe(1);
        expect(escalates[0].relatedBatchIds.sort()).toEqual(['B1', 'B2']);
        expect(r.insights).toContain('SLA_PRESSURE_CLUSTER');
    });

    test('formatJson is byte-stable across calls', () => {
        const adv = makeAdvisor();
        const input = {
            batches: [
                { id: 'B1', estimatedRuntimeHours: 2, customerTier: 'gold' },
                { id: 'B2', estimatedRuntimeHours: 3, isRework: true },
            ],
        };
        const r = adv.prioritize(input);
        const s1 = adv.formatJson(r);
        const s2 = adv.formatJson(r);
        expect(s1).toBe(s2);
        expect(() => JSON.parse(s1)).not.toThrow();
    });

    test('formatMarkdown includes required sections', () => {
        const adv = makeAdvisor();
        const r = adv.prioritize({ batches: [{ id: 'B1', estimatedRuntimeHours: 2 }] });
        const md = adv.formatMarkdown(r);
        expect(md).toContain('## Summary');
        expect(md).toContain('## Batches');
        expect(md).toContain('## Playbook');
        expect(md).toContain('## Insights');
    });

    test('inputs are not mutated', () => {
        const adv = makeAdvisor();
        const input = {
            batches: [{ id: 'B1', estimatedRuntimeHours: 2, dependencyBatchIds: ['X'] }],
            context: { completedBatchIds: ['Y'], equipmentAvailability: { 'P': { healthyOk: true } } },
        };
        const snap = JSON.stringify(input);
        adv.prioritize(input);
        expect(JSON.stringify(input)).toBe(snap);
    });

    test('expiring reagents drive priority insight', () => {
        const adv = makeAdvisor();
        const r = adv.prioritize({
            batches: [{
                id: 'B1', estimatedRuntimeHours: 1,
                reagentExpiryISO: offsetIso(6),
            }],
        });
        expect(r.batches[0].reasons).toContain('REAGENT_EXPIRY_PRESSURE');
        expect(r.insights).toContain('EXPIRING_REAGENTS_DRIVING_PRIORITY');
        expect(r.playbook.find(p => p.id === 'CONSUME_EXPIRING_REAGENTS_FIRST')).toBeTruthy();
    });
});
