'use strict';

const { createEquipmentDowntimeRiskAdvisor, VERDICTS } = require('../docs/shared/equipmentDowntimeRiskAdvisor');

const FIXED_NOW = new Date('2026-05-18T20:00:00Z');
function nowFn() { return FIXED_NOW; }

function makeAdvisor(opts = {}) {
    return createEquipmentDowntimeRiskAdvisor(Object.assign({ now: nowFn }, opts));
}

describe('createEquipmentDowntimeRiskAdvisor', () => {
    test('empty fleet → grade A, FLEET_HEALTHY playbook fallback, HEALTHY_FLEET insight', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({ equipment: [] });
        expect(report.grade).toBe('A');
        expect(report.equipmentCount).toBe(0);
        expect(report.insights).toContain('HEALTHY_FLEET');
        expect(report.playbook.some(a => a.id === 'FLEET_HEALTHY')).toBe(true);
    });

    test('single healthy asset → STABLE_OK', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            equipment: [{
                id: 'BP-01', type: 'bioprinter', criticality: 'medium',
                runtimeHours: 200, hoursSinceLastService: 50, hoursSinceLastCalibration: 20,
                errorsLast30d: 0, errorsLast7d: 0,
            }],
        });
        expect(report.equipment[0].verdict).toBe(VERDICTS.STABLE_OK);
        expect(report.equipment[0].priority).toBe('P3');
    });

    test('overdue service → PREVENTIVE_SERVICE_URGENT and SCHEDULE_PREVENTIVE_SERVICE action', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            equipment: [{
                id: 'AUTO-1', type: 'autoclave', criticality: 'medium',
                hoursSinceLastService: 1100, serviceIntervalHours: 1000,
                hoursSinceLastCalibration: 100,
            }],
        });
        expect([VERDICTS.PREVENTIVE_SERVICE_URGENT, VERDICTS.OFFLINE_RISK_IMMINENT]).toContain(report.equipment[0].verdict);
        expect(report.playbook.some(a => a.id === 'SCHEDULE_PREVENTIVE_SERVICE' || a.id === 'TAKE_OFFLINE_AND_SERVICE')).toBe(true);
    });

    test('error spike (errorsLast7d>=4) → OFFLINE_RISK_IMMINENT', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            equipment: [{
                id: 'CTF-1', type: 'centrifuge', criticality: 'high',
                errorsLast7d: 5, errorsLast30d: 8,
            }],
        });
        expect(report.equipment[0].verdict).toBe(VERDICTS.OFFLINE_RISK_IMMINENT);
        expect(report.equipment[0].priority).toBe('P0');
        expect(report.playbook.some(a => a.id === 'TAKE_OFFLINE_AND_SERVICE')).toBe(true);
    });

    test('vibration critical → OFFLINE_RISK_IMMINENT', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            equipment: [{
                id: 'BP-02', type: 'bioprinter', criticality: 'medium',
                vibrationTrend: 'critical',
            }],
        });
        expect(report.equipment[0].verdict).toBe(VERDICTS.OFFLINE_RISK_IMMINENT);
    });

    test('consumables low (>=2 flags, otherwise healthy) → CONSUMABLES_RESTOCK + RESTOCK_CONSUMABLES action', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            equipment: [{
                id: 'BP-03', type: 'bioprinter', criticality: 'low',
                consumablesLowFlags: ['filter', 'belt', 'nozzle'],
            }],
        });
        expect(report.equipment[0].verdict).toBe(VERDICTS.CONSUMABLES_RESTOCK);
        expect(report.playbook.some(a => a.id === 'RESTOCK_CONSUMABLES')).toBe(true);
        const restock = report.playbook.find(a => a.id === 'RESTOCK_CONSUMABLES');
        expect(restock.suggestedValue).toEqual(['belt', 'filter', 'nozzle']);
    });

    test('calibration drift → CALIBRATE action emitted', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            equipment: [{
                id: 'PIP-1', type: 'pipette', criticality: 'high',
                hoursSinceLastCalibration: 800, calibrationIntervalHours: 720,
            }],
        });
        expect(report.playbook.some(a => a.id === 'CALIBRATE')).toBe(true);
    });

    test('critical asset offline w/o backup with upcoming batches → ENGAGE_BACKUP_OR_RESCHEDULE_BATCHES P0', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            horizonDays: 7,
            equipment: [{
                id: 'BP-CRIT', type: 'bioprinter', criticality: 'critical',
                hoursSinceLastService: 1300, serviceIntervalHours: 1000,
                errorsLast7d: 5, backupAvailable: false,
            }],
            context: { upcomingHighStakesBatches: 2 },
        });
        const action = report.playbook.find(a => a.id === 'ENGAGE_BACKUP_OR_RESCHEDULE_BATCHES');
        expect(action).toBeDefined();
        expect(action.priority).toBe('P0');
        expect(report.insights).toContain('BACKUP_GAP');
        expect(report.grade).toBe('F'); // critical P0 forces F
    });

    test('risk appetite monotonicity: cautious >= balanced >= aggressive on identical fleet', () => {
        const fleet = {
            horizonDays: 7,
            equipment: [
                { id: 'A', type: 'bioprinter', criticality: 'high', hoursSinceLastService: 700, serviceIntervalHours: 1000, errorsLast7d: 2 },
                { id: 'B', type: 'incubator', criticality: 'medium', hoursSinceLastCalibration: 500, calibrationIntervalHours: 720 },
            ],
        };
        const cautious = makeAdvisor({ riskAppetite: 'cautious' }).evaluate(fleet);
        const balanced = makeAdvisor({ riskAppetite: 'balanced' }).evaluate(fleet);
        const aggressive = makeAdvisor({ riskAppetite: 'aggressive' }).evaluate(fleet);
        expect(cautious.portfolioRisk).toBeGreaterThanOrEqual(balanced.portfolioRisk);
        expect(balanced.portfolioRisk).toBeGreaterThanOrEqual(aggressive.portfolioRisk);
    });

    test('simulate applies diminishing returns and lowers projected risk', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({
            equipment: [{
                id: 'BP-X', type: 'bioprinter', criticality: 'critical',
                hoursSinceLastService: 1300, serviceIntervalHours: 1000,
                errorsLast7d: 4, vibrationTrend: 'rising',
            }],
        });
        const sim0 = advisor.simulate({ applyTop: 0 }, report);
        const sim1 = advisor.simulate({ applyTop: 1 }, report);
        const sim3 = advisor.simulate({ applyTop: 3 }, report);
        expect(sim0.projectedPortfolioRisk).toBe(report.portfolioRisk);
        expect(sim1.projectedPortfolioRisk).toBeLessThanOrEqual(sim0.projectedPortfolioRisk);
        expect(sim3.projectedPortfolioRisk).toBeLessThanOrEqual(sim1.projectedPortfolioRisk);
        expect(sim3.appliedActions.length).toBeLessThanOrEqual(3);
    });

    test('formatJson is byte-stable for identical input', () => {
        const advisor = makeAdvisor();
        const payload = {
            horizonDays: 5,
            equipment: [
                { id: 'B', type: 'incubator', criticality: 'medium', hoursSinceLastService: 1500, serviceIntervalHours: 2000 },
                { id: 'A', type: 'bioprinter', criticality: 'high', errorsLast7d: 1 },
            ],
        };
        const json1 = advisor.formatJson(advisor.evaluate(payload));
        const json2 = advisor.formatJson(advisor.evaluate(payload));
        expect(json1).toBe(json2);
    });

    test('formatMarkdown contains required headers', () => {
        const advisor = makeAdvisor();
        const md = advisor.formatMarkdown(advisor.evaluate({
            equipment: [{ id: 'A', type: 'bioprinter', errorsLast7d: 2 }],
        }));
        expect(md).toContain('# Equipment Downtime Risk');
        expect(md).toContain('## Summary');
        expect(md).toContain('## Equipment');
        expect(md).toContain('## Playbook');
        expect(md).toContain('## Insights');
    });

    test('never mutates input payload', () => {
        const advisor = makeAdvisor();
        const payload = {
            horizonDays: 7,
            equipment: [{
                id: 'BP-1', type: 'bioprinter', criticality: 'critical',
                consumablesLowFlags: ['filter'],
                hoursSinceLastService: 1100,
            }],
            context: { upcomingHighStakesBatches: 1 },
        };
        const snapshot = JSON.stringify(payload);
        advisor.evaluate(payload);
        expect(JSON.stringify(payload)).toBe(snapshot);
    });

    test('scheduledServiceInDays dampens risk vs same item without schedule', () => {
        const advisor = makeAdvisor();
        const base = {
            id: 'BP-1', type: 'bioprinter', criticality: 'high',
            hoursSinceLastService: 1100, serviceIntervalHours: 1000, errorsLast7d: 2,
        };
        const noSched = advisor.evaluate({ horizonDays: 7, equipment: [base] });
        const withSched = advisor.evaluate({ horizonDays: 7, equipment: [Object.assign({}, base, { scheduledServiceInDays: 2 })] });
        expect(withSched.equipment[0].downtimeRisk).toBeLessThan(noSched.equipment[0].downtimeRisk);
    });

    test('cautious appetite appends SCHEDULE_FLEET_AUDIT on C/D/F grades', () => {
        const advisor = makeAdvisor({ riskAppetite: 'cautious' });
        const report = advisor.evaluate({
            equipment: [{
                id: 'BP-1', type: 'bioprinter', criticality: 'high',
                hoursSinceLastService: 1100, serviceIntervalHours: 1000, errorsLast7d: 3,
            }],
        });
        if (['C', 'D', 'F'].includes(report.grade)) {
            expect(report.playbook.some(a => a.id === 'SCHEDULE_FLEET_AUDIT')).toBe(true);
        }
    });
});
