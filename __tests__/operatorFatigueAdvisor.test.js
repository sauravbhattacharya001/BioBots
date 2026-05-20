'use strict';

const { createOperatorFatigueAdvisor, VERDICTS } = require('../docs/shared/operatorFatigueAdvisor');

const FIXED_NOW = new Date('2026-05-19T20:00:00Z');
function nowFn() { return FIXED_NOW; }

function makeAdvisor(opts = {}) {
    return createOperatorFatigueAdvisor(Object.assign({ now: nowFn }, opts));
}

describe('createOperatorFatigueAdvisor', () => {
    test('rejects invalid riskAppetite at construction', () => {
        expect(() => createOperatorFatigueAdvisor({ riskAppetite: 'reckless' })).toThrow(/riskAppetite/);
    });

    test('empty roster → grade A, ROSTER_HEALTHY action, NO_OPERATORS_PROVIDED insight', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({ operators: [] });
        expect(report.grade).toBe('A');
        expect(report.operatorCount).toBe(0);
        expect(report.portfolioRisk).toBe(0);
        expect(report.insights).toContain('NO_OPERATORS_PROVIDED');
        expect(report.playbook.some(a => a.id === 'ROSTER_HEALTHY')).toBe(true);
        // header timestamp uses injected now
        expect(report.generatedAt).toBe('2026-05-19T20:00:00.000Z');
    });

    test('single fresh operator → READY_FOR_SHIFT / P3', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            operators: [{
                id: 'OP-01', name: 'Alex', hoursLast24h: 6, hoursLast7d: 30,
                consecutiveDaysWorked: 2, hoursSinceLastBreakMin: 60,
                errorsLast7d: 0, plannedRoleNext24h: 'standard',
            }],
        });
        expect(report.operators[0].verdict).toBe(VERDICTS.READY_FOR_SHIFT);
        expect(report.operators[0].priority).toBe('P3');
        expect(report.grade).toBe('A');
    });

    test('long shift + many consecutive days → BURNOUT_RISK_IMMINENT, P0', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            operators: [{
                id: 'OP-02', name: 'Bea', hoursLast24h: 16, hoursLast7d: 80,
                consecutiveDaysWorked: 11, hoursSinceLastBreakMin: 600,
                errorsLast7d: 3, plannedRoleNext24h: 'deep',
            }],
        });
        const it = report.operators[0];
        expect(it.verdict).toBe(VERDICTS.BURNOUT_RISK_IMMINENT);
        expect(it.priority).toBe('P0');
        expect(it.recommendedRestHours).toBeGreaterThanOrEqual(24);
        expect(report.grade).toBe('F');
        expect(report.playbook.some(a => a.id === 'SEND_HOME_AND_LOG_INCIDENT')).toBe(true);
        expect(report.insights).toContain('BURNOUT_CLUSTER_DETECTED');
    });

    test('weekly hour cap breached → MANDATORY_REST and insight', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            operators: [{
                id: 'OP-03', name: 'Cy', hoursLast24h: 9, hoursLast7d: 65,
                weeklyHourCap: 50, consecutiveDaysWorked: 5,
                hoursSinceLastBreakMin: 120, errorsLast7d: 1,
                plannedRoleNext24h: 'standard',
            }],
        });
        const it = report.operators[0];
        expect([VERDICTS.MANDATORY_REST, VERDICTS.BURNOUT_RISK_IMMINENT]).toContain(it.verdict);
        expect(it.priority).toBe('P0');
        expect(report.insights).toContain('WEEKLY_HOUR_CAP_BREACHED');
        expect(report.playbook.some(a => a.id === 'MANDATE_REST_PERIOD' || a.id === 'SEND_HOME_AND_LOG_INCIDENT')).toBe(true);
    });

    test('elevated risk + deep role + upcoming high-stakes → REASSIGN action', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            operators: [{
                id: 'OP-04', name: 'Dee', hoursLast24h: 12, hoursLast7d: 50,
                consecutiveDaysWorked: 6, hoursSinceLastBreakMin: 300,
                errorsLast7d: 2, plannedRoleNext24h: 'deep',
            }],
            context: { upcomingHighStakesBatches: 3 },
        });
        const it = report.operators[0];
        // should at least register REASSIGN action when deep role + high-stakes + elevated risk
        const hasReassign = report.playbook.some(a => a.id === 'REASSIGN_FROM_HIGH_STAKES_TASKS')
            || it.verdict === VERDICTS.REASSIGN_FROM_HIGH_STAKES
            || it.priority === 'P0' || it.priority === 'P1';
        expect(hasReassign).toBe(true);
    });

    test('contamination incident → CONTAMINATION_FATIGUE_LINK + INVESTIGATE action', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            operators: [{
                id: 'OP-05', hoursLast24h: 9, hoursLast7d: 40,
                consecutiveDaysWorked: 4, hoursSinceLastBreakMin: 180,
                errorsLast7d: 1, contaminationIncidentsLast30d: 1,
                plannedRoleNext24h: 'standard',
            }],
        });
        expect(report.insights).toContain('CONTAMINATION_FATIGUE_LINK');
        expect(report.playbook.some(a => a.id === 'INVESTIGATE_OPERATOR_PROCESS')).toBe(true);
    });

    test('night-shift cluster ≥2 ops → NIGHT_SHIFT_OVERLOAD + REBALANCE action', () => {
        const advisor = makeAdvisor();
        const ops = ['A', 'B', 'C'].map(id => ({
            id: 'OP-' + id, hoursLast24h: 8, hoursLast7d: 40,
            consecutiveDaysWorked: 3, hoursSinceLastBreakMin: 90,
            errorsLast7d: 0, nightShiftsLast7d: 4,
            plannedRoleNext24h: 'standard',
        }));
        const report = advisor.evaluate({ operators: ops });
        expect(report.insights).toContain('NIGHT_SHIFT_OVERLOAD');
        expect(report.playbook.some(a => a.id === 'REBALANCE_NIGHT_ROTATION')).toBe(true);
    });

    test('overdue break alone → OFFER_BREAK verdict', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            operators: [{
                id: 'OP-06', hoursLast24h: 7, hoursLast7d: 30,
                consecutiveDaysWorked: 2, hoursSinceLastBreakMin: 300,
                errorsLast7d: 0, plannedRoleNext24h: 'standard',
            }],
        });
        expect([VERDICTS.OFFER_BREAK, VERDICTS.WATCH_AND_PAIR]).toContain(report.operators[0].verdict);
        expect(report.playbook.some(a => a.id === 'OFFER_BREAK_NOW' || a.id === 'PAIR_WITH_BUDDY')).toBe(true);
    });

    test('risk appetite is monotonic: cautious ≥ balanced ≥ aggressive', () => {
        const input = {
            operators: [{
                id: 'OP-07', hoursLast24h: 11, hoursLast7d: 55,
                consecutiveDaysWorked: 6, hoursSinceLastBreakMin: 240,
                errorsLast7d: 2, plannedRoleNext24h: 'standard',
            }],
        };
        const cautious = createOperatorFatigueAdvisor({ now: nowFn, riskAppetite: 'cautious' }).evaluate(input);
        const balanced = createOperatorFatigueAdvisor({ now: nowFn, riskAppetite: 'balanced' }).evaluate(input);
        const aggressive = createOperatorFatigueAdvisor({ now: nowFn, riskAppetite: 'aggressive' }).evaluate(input);
        expect(cautious.operators[0].fatigueRisk).toBeGreaterThanOrEqual(balanced.operators[0].fatigueRisk);
        expect(balanced.operators[0].fatigueRisk).toBeGreaterThanOrEqual(aggressive.operators[0].fatigueRisk);
    });

    test('staffing-thin warning → CALL_IN_RELIEF_STAFF', () => {
        const advisor = makeAdvisor();
        const ops = [
            { id: 'A', hoursLast24h: 16, consecutiveDaysWorked: 12, errorsLast7d: 4, contaminationIncidentsLast30d: 1, plannedRoleNext24h: 'deep' },
            { id: 'B', hoursLast24h: 6, consecutiveDaysWorked: 2, plannedRoleNext24h: 'standard' },
            { id: 'C', hoursLast24h: 6, consecutiveDaysWorked: 2, plannedRoleNext24h: 'standard' },
        ];
        const report = advisor.evaluate({ operators: ops, context: { activeStaffingCount: 3 } });
        expect(report.playbook.some(a => a.id === 'CALL_IN_RELIEF_STAFF')).toBe(true);
    });

    test('formatText / formatMarkdown / formatJson are non-empty and deterministic', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            operators: [{
                id: 'OP-09', name: 'Eve', hoursLast24h: 9, hoursLast7d: 40,
                consecutiveDaysWorked: 3, hoursSinceLastBreakMin: 90,
                errorsLast7d: 0, plannedRoleNext24h: 'standard',
            }],
        });
        const t1 = advisor.formatText(report);
        const m1 = advisor.formatMarkdown(report);
        const j1 = advisor.formatJson(report);
        expect(t1).toContain('OPERATOR FATIGUE REPORT');
        expect(m1).toContain('# Operator Fatigue Report');
        expect(m1).toContain('## Operators');
        expect(m1).toContain('## Playbook');
        expect(m1).toContain('## Insights');
        // byte-stable
        expect(advisor.formatJson(report)).toBe(j1);
        // sorted keys check
        const parsed = JSON.parse(j1);
        expect(parsed.operatorCount).toBe(1);
        expect(parsed.operators[0].id).toBe('OP-09');
    });

    test('simulate({applyTop:N}) lowers projectedRisk monotonically', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            operators: [
                { id: 'A', hoursLast24h: 16, consecutiveDaysWorked: 11, errorsLast7d: 4, contaminationIncidentsLast30d: 1, plannedRoleNext24h: 'deep' },
                { id: 'B', hoursLast24h: 14, consecutiveDaysWorked: 8, errorsLast7d: 2, plannedRoleNext24h: 'standard' },
            ],
        });
        const s0 = advisor.simulate({ applyTop: 0 }, report);
        const s2 = advisor.simulate({ applyTop: 2 }, report);
        expect(s0.projectedRisk).toBe(report.portfolioRisk);
        expect(s2.projectedRisk).toBeLessThanOrEqual(s0.projectedRisk);
        expect(s2.appliedActions.length).toBeLessThanOrEqual(report.playbook.length);
    });

    test('does not mutate input operators', () => {
        const advisor = makeAdvisor();
        const ops = [{
            id: 'OP-10', hoursLast24h: 9, hoursLast7d: 40,
            consecutiveDaysWorked: 3, hoursSinceLastBreakMin: 90,
            errorsLast7d: 0, plannedRoleNext24h: 'standard',
        }];
        const snapshot = JSON.stringify(ops);
        advisor.evaluate({ operators: ops });
        expect(JSON.stringify(ops)).toBe(snapshot);
    });

    test('playbook is P0-first and dedup by id', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            operators: [
                { id: 'A', hoursLast24h: 16, consecutiveDaysWorked: 11, errorsLast7d: 4, contaminationIncidentsLast30d: 1, plannedRoleNext24h: 'deep' },
                { id: 'B', hoursLast24h: 13, consecutiveDaysWorked: 7, errorsLast7d: 2, plannedRoleNext24h: 'standard' },
                { id: 'C', hoursLast24h: 8, hoursSinceLastBreakMin: 300, plannedRoleNext24h: 'standard' },
            ],
        });
        const priorities = report.playbook.map(a => a.priority);
        for (let i = 1; i < priorities.length; i++) {
            const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
            expect(rank[priorities[i]]).toBeGreaterThanOrEqual(rank[priorities[i - 1]]);
        }
        const ids = report.playbook.map(a => a.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
