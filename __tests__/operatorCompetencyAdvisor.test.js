'use strict';

const { createOperatorCompetencyAdvisor } = require('../docs/shared/operatorCompetencyAdvisor');

const NOW = new Date('2026-05-23T08:00:00Z');
const nowFn = () => NOW;

function buildAdvisor() {
    return createOperatorCompetencyAdvisor({ now: nowFn });
}

function isoDaysFromNow(days) {
    return new Date(NOW.getTime() + days * 86400000).toISOString();
}

describe('createOperatorCompetencyAdvisor', () => {
    test('factory shape', () => {
        const adv = buildAdvisor();
        expect(typeof adv.analyze).toBe('function');
        expect(typeof adv.format).toBe('function');
        expect(typeof adv.formatText).toBe('function');
        expect(typeof adv.formatMarkdown).toBe('function');
        expect(typeof adv.formatJson).toBe('function');
    });

    test('empty roster -> empty portfolio + EMPTY_ROSTER insight', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([], []);
        expect(r.portfolio.totalOperators).toBe(0);
        expect(r.perOperator).toEqual([]);
        expect(r.insights).toContain('EMPTY_ROSTER');
        expect(r.playbook[0].id).toBe('MAINTAIN_COMPETENCY_PROGRAM');
    });

    test('expired certification -> NEEDS_RECERTIFICATION (P0)', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 'op1', name: 'Alice', role: 'tech',
            certifications: [{
                id: 'cert1', name: 'Bioprinter cert',
                equipmentId: 'bioprinter1',
                issuedAt: isoDaysFromNow(-400),
                expiresAt: isoDaysFromNow(-10),
                level: 4
            }],
            skills: { bioprinter1: 4 }
        }], [{
            targetId: 'bioprinter1', kind: 'equipment', label: 'Bioprinter',
            minLevel: 3, criticality: 4, requiresCertification: true
        }]);
        const op = r.perOperator.find(o => o.id === 'op1');
        expect(op.verdict).toBe('NEEDS_RECERTIFICATION');
        expect(op.priority).toBe('P0');
        expect(r.playbook.some(a => a.id === 'SCHEDULE_RECERTIFICATION')).toBe(true);
        expect(r.insights).toContain('EXPIRED_CERTIFICATIONS_PRESENT');
    });

    test('uncertified on critical target -> NEEDS_TRAINING (P0) and untrained insight', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 'op2', name: 'Bob', role: 'tech',
            certifications: [],
            skills: {}
        }], [{
            targetId: 'sterilizer', kind: 'equipment', label: 'Sterilizer',
            minLevel: 3, criticality: 5, requiresCertification: true
        }]);
        const op = r.perOperator[0];
        expect(['NEEDS_TRAINING', 'INSUFFICIENT_DATA']).toContain(op.verdict);
        expect(r.insights).toContain('CRITICAL_TARGETS_UNCOVERED');
        expect(r.portfolio.grade).toBe('F');
    });

    test('high failure rate -> NEEDS_SUPERVISION (P1)', () => {
        const adv = buildAdvisor();
        const runs = [];
        for (let i = 0; i < 10; i++) {
            runs.push({
                id: 'r' + i, equipmentId: 'bp1',
                ts: isoDaysFromNow(-i),
                outcome: i < 4 ? 'failure' : 'success'
            });
        }
        const r = adv.analyze([{
            id: 'op3', name: 'Cara', role: 'tech',
            certifications: [{
                id: 'c3', name: 'BP cert', equipmentId: 'bp1',
                issuedAt: isoDaysFromNow(-200), expiresAt: isoDaysFromNow(200), level: 3
            }],
            skills: { bp1: 3 },
            runs: runs
        }], [{
            targetId: 'bp1', kind: 'equipment', label: 'BP',
            minLevel: 3, criticality: 3, requiresCertification: true
        }]);
        const op = r.perOperator[0];
        expect(op.verdict).toBe('NEEDS_SUPERVISION');
        expect(op.priority).toBe('P1');
        expect(op.supervisionRecommendation).toBe('BUDDY');
        expect(r.playbook.some(a => a.id === 'PAIR_FOR_SUPERVISION')).toBe(true);
    });

    test('senior tech with no gaps -> READY_TO_MENTOR', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 'op4', name: 'Dee', role: 'senior_tech',
            certifications: [{
                id: 'c4', name: 'BP cert', equipmentId: 'bp1',
                issuedAt: isoDaysFromNow(-100), expiresAt: isoDaysFromNow(300), level: 5
            }],
            skills: { bp1: 5 }
        }], [{
            targetId: 'bp1', kind: 'equipment', minLevel: 3, criticality: 3,
            requiresCertification: true
        }]);
        const op = r.perOperator[0];
        expect(op.verdict).toBe('READY_TO_MENTOR');
        expect(op.priority).toBe('P3');
        expect(r.insights).toContain('MENTOR_CAPACITY_AVAILABLE');
    });

    test('expiring soon certification surfaces in expiringCerts and triggers coaching', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 'op5', name: 'Eli', role: 'tech',
            certifications: [{
                id: 'c5', name: 'BP cert', equipmentId: 'bp1',
                issuedAt: isoDaysFromNow(-300), expiresAt: isoDaysFromNow(15), level: 3
            }],
            skills: { bp1: 3 }
        }], [{
            targetId: 'bp1', kind: 'equipment', minLevel: 3, criticality: 3,
            requiresCertification: true
        }]);
        const op = r.perOperator[0];
        expect(op.expiringCerts.length).toBe(1);
        expect(op.expiringCerts[0].status).toBe('EXPIRING_SOON');
        expect(op.verdict).toBe('COACHING_RECOMMENDED');
    });

    test('insufficient data verdict when nothing recorded', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 'op6', name: 'Faye', role: 'tech'
        }], [{
            targetId: 'bp1', kind: 'equipment', minLevel: 3, criticality: 2,
            requiresCertification: false
        }]);
        const op = r.perOperator[0];
        expect(op.verdict).toBe('INSUFFICIENT_DATA');
        expect(r.playbook.some(a => a.id === 'BACKFILL_OPERATOR_HISTORY')).toBe(true);
    });

    test('bench depth: single-certified target surfaces single dependency insight', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([
            { id: 'op7', name: 'G', role: 'tech',
                certifications: [{ id: 'a', name: 'X', equipmentId: 'x',
                    issuedAt: isoDaysFromNow(-30), expiresAt: isoDaysFromNow(330), level: 4 }],
                skills: { x: 4 } },
            { id: 'op8', name: 'H', role: 'tech',
                certifications: [{ id: 'b', name: 'Y', equipmentId: 'y',
                    issuedAt: isoDaysFromNow(-30), expiresAt: isoDaysFromNow(330), level: 4 }],
                skills: { y: 4 } }
        ], [
            { targetId: 'x', kind: 'equipment', minLevel: 3, criticality: 3, requiresCertification: true },
            { targetId: 'y', kind: 'equipment', minLevel: 3, criticality: 3, requiresCertification: true }
        ]);
        expect(r.portfolio.singleCertifiedTargets.sort()).toEqual(['x', 'y']);
        expect(r.insights).toContain('SINGLE_OPERATOR_DEPENDENCIES');
        expect(r.playbook.some(a => a.id === 'EXPAND_BENCH_DEPTH')).toBe(true);
    });

    test('formatText / formatMarkdown / formatJson all return non-empty strings', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 'op9', name: 'Iris', role: 'tech',
            skills: { bp1: 4 },
            certifications: [{
                id: 'c9', name: 'BP cert', equipmentId: 'bp1',
                issuedAt: isoDaysFromNow(-30), expiresAt: isoDaysFromNow(330), level: 4
            }]
        }], [{
            targetId: 'bp1', kind: 'equipment', minLevel: 3, criticality: 3, requiresCertification: true
        }]);
        expect(adv.formatText(r)).toContain('VERDICT:');
        expect(adv.formatMarkdown(r)).toContain('# Operator Competency Report');
        const j = adv.formatJson(r);
        expect(j.length).toBeGreaterThan(10);
        const parsed = JSON.parse(j);
        expect(parsed.portfolio.totalOperators).toBe(1);
    });

    test('formatJson is byte-stable across runs', () => {
        const adv = buildAdvisor();
        const input = [{
            id: 'op10', name: 'Jay', role: 'tech',
            skills: { bp1: 3 },
            certifications: [{
                id: 'c10', equipmentId: 'bp1', name: 'BP',
                issuedAt: isoDaysFromNow(-30), expiresAt: isoDaysFromNow(330), level: 3
            }]
        }];
        const reqs = [{ targetId: 'bp1', kind: 'equipment', minLevel: 3, criticality: 3, requiresCertification: true }];
        const j1 = adv.formatJson(adv.analyze(input, reqs));
        const j2 = adv.formatJson(adv.analyze(input, reqs));
        expect(j1).toBe(j2);
    });

    test('does not mutate inputs', () => {
        const adv = buildAdvisor();
        const input = [{
            id: 'op11', name: 'Kim', role: 'tech',
            skills: { bp1: 2 },
            certifications: [{
                id: 'c11', equipmentId: 'bp1', name: 'BP',
                issuedAt: isoDaysFromNow(-30), expiresAt: isoDaysFromNow(-1), level: 2
            }]
        }];
        const reqs = [{ targetId: 'bp1', kind: 'equipment', minLevel: 3, criticality: 4, requiresCertification: true }];
        const before = JSON.stringify({ input, reqs });
        adv.analyze(input, reqs);
        expect(JSON.stringify({ input, reqs })).toBe(before);
    });

    test('risk_appetite cautious adds SCHEDULE_COMPETENCY_AUDIT when there are gaps', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 'op12', name: 'Liu', role: 'tech',
            skills: { bp1: 2 },
            certifications: [{
                id: 'c12', equipmentId: 'bp1', name: 'BP',
                issuedAt: isoDaysFromNow(-30), expiresAt: isoDaysFromNow(60), level: 2
            }]
        }], [{
            targetId: 'bp1', kind: 'equipment', minLevel: 3, criticality: 3, requiresCertification: true
        }], { risk_appetite: 'cautious' });
        expect(r.playbook.some(a => a.id === 'SCHEDULE_COMPETENCY_AUDIT')).toBe(true);
    });

    test('SDK manifest exposes createOperatorCompetencyAdvisor', () => {
        const biobots = require('../index');
        expect(typeof biobots.createOperatorCompetencyAdvisor).toBe('function');
        const adv = biobots.createOperatorCompetencyAdvisor({ now: nowFn });
        const r = adv.analyze([], []);
        expect(r.portfolio.totalOperators).toBe(0);
    });

    test('invalid now() throws', () => {
        const adv = createOperatorCompetencyAdvisor({ now: () => new Date('not-a-date') });
        expect(() => adv.analyze([], [])).toThrow(/invalid Date/);
    });

    test('format throws on unknown kind', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([], []);
        expect(() => adv.format(r, 'yaml')).toThrow(/unknown format/);
    });
});
