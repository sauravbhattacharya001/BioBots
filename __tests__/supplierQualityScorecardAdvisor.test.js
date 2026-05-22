'use strict';

const { createSupplierQualityScorecardAdvisor } = require('../docs/shared/supplierQualityScorecardAdvisor');

const NOW = new Date('2026-05-22T12:00:00Z');
const nowFn = () => NOW;

function buildAdvisor() {
    return createSupplierQualityScorecardAdvisor({ now: nowFn });
}

describe('createSupplierQualityScorecardAdvisor', () => {
    test('factory shape', () => {
        const adv = buildAdvisor();
        expect(typeof adv.analyze).toBe('function');
        expect(typeof adv.format).toBe('function');
        expect(typeof adv.formatText).toBe('function');
        expect(typeof adv.formatMarkdown).toBe('function');
        expect(typeof adv.formatJson).toBe('function');
    });

    test('empty supplier list -> empty portfolio + healthy insight', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([]);
        expect(r.portfolio.totalSuppliers).toBe(0);
        expect(r.perSupplier).toEqual([]);
        expect(r.playbook[0].id).toBe('MAINTAIN_SUPPLIER_HEALTH');
        expect(r.insights).toContain('EMPTY_SUPPLIER_BASE');
    });

    test('clean supplier with strong history promotes toward EXPAND_USAGE', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 's1', name: 'Acme', category: 'reagent',
            lotsDelivered: 50, lotsRejected: 1,
            onTimeDeliveries: 48, lateDeliveries: 2,
            contaminationIncidents: 0, recalls: 0,
            avgLeadTimeDays: 7, contractedLeadTimeDays: 10,
            priceIndex: 0.95, criticality: 3
        }, {
            id: 's2', name: 'Beta', category: 'consumable',
            lotsDelivered: 20, lotsRejected: 0,
            onTimeDeliveries: 19, lateDeliveries: 1,
            contaminationIncidents: 0, recalls: 0,
            avgLeadTimeDays: 5, priceIndex: 1.0, criticality: 2
        }]);
        const s1 = r.perSupplier.find(s => s.id === 's1');
        expect(['EXPAND_USAGE', 'APPROVED']).toContain(s1.verdict);
        expect(s1.grade).toMatch(/[A-C]/);
    });

    test('high defect rate -> PROBATION verdict with CAR action', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 's3', name: 'Sloppy', category: 'reagent',
            lotsDelivered: 20, lotsRejected: 5,  // 25% defect
            onTimeDeliveries: 15, lateDeliveries: 5,
            contaminationIncidents: 0, recalls: 0,
            criticality: 3
        }]);
        const s = r.perSupplier[0];
        expect([V_PROBATION, 'BLACKLIST']).toContain(s.verdict);
        const ids = r.playbook.map(a => a.id);
        expect(ids).toEqual(expect.arrayContaining(['PLACE_SUPPLIERS_ON_PROBATION']));
    });

    test('multiple recalls -> BLACKLIST + quarantine action', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 's4', name: 'Banned', category: 'reagent',
            lotsDelivered: 30, lotsRejected: 6,
            onTimeDeliveries: 20, lateDeliveries: 10,
            contaminationIncidents: 1, recalls: 2,
            criticality: 4, lastIncidentAt: '2026-04-01T00:00:00Z'
        }]);
        const s = r.perSupplier[0];
        expect(s.verdict).toBe('BLACKLIST');
        expect(s.priority).toBe('P0');
        const ids = r.playbook.map(a => a.id);
        expect(ids).toContain('REMOVE_BLACKLISTED_SUPPLIERS');
        expect(ids).toContain('QUARANTINE_OPEN_LOTS_FROM_BLACKLIST');
        expect(r.portfolio.grade).toBe('F'); // critical-asset blacklist
    });

    test('new supplier with <3 deliveries -> INSUFFICIENT_DATA + pilot action', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 's5', name: 'Newbie', category: 'reagent',
            lotsDelivered: 1, lotsRejected: 0,
            onTimeDeliveries: 1, lateDeliveries: 0,
            contaminationIncidents: 0, recalls: 0
        }]);
        expect(r.perSupplier[0].verdict).toBe('INSUFFICIENT_DATA');
        expect(r.playbook.map(a => a.id)).toContain('COLLECT_SUPPLIER_HISTORY');
    });

    test('single-sourced critical category -> DIVERSIFY_AWAY + qualify second source', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 'sole', name: 'OnlyOne', category: 'reagent',
            lotsDelivered: 25, lotsRejected: 3,
            onTimeDeliveries: 14, lateDeliveries: 11,
            contaminationIncidents: 1, recalls: 0,
            avgLeadTimeDays: 15, contractedLeadTimeDays: 10,
            criticality: 5
        }]);
        const s = r.perSupplier[0];
        expect(s.categoryShareWarning).toBe(true);
        expect(s.reasons).toContain('SOLE_SOURCE_FOR_CATEGORY');
        const ids = r.playbook.map(a => a.id);
        expect(ids).toContain('QUALIFY_SECOND_SOURCE');
        expect(r.insights.some(i => i.startsWith('SINGLE_SOURCE_RISK'))).toBe(true);
    });

    test('aggressive trims P3 fallback when P0/P1 present', () => {
        const adv = buildAdvisor();
        const data = [
            { id: 'bad', name: 'Bad', category: 'reagent',
              lotsDelivered: 10, lotsRejected: 5,
              onTimeDeliveries: 5, lateDeliveries: 5,
              contaminationIncidents: 2, recalls: 1, criticality: 4 },
            { id: 'ok', name: 'Ok', category: 'consumable',
              lotsDelivered: 20, lotsRejected: 0,
              onTimeDeliveries: 19, lateDeliveries: 1,
              contaminationIncidents: 0, recalls: 0 }
        ];
        const aggressive = adv.analyze(data, { risk_appetite: 'aggressive' });
        const cautious = adv.analyze(data, { risk_appetite: 'cautious' });
        // Cautious should add the audit cadence when grade is degraded
        const cautiousIds = cautious.playbook.map(a => a.id);
        const aggressiveIds = aggressive.playbook.map(a => a.id);
        if (['C', 'D', 'F'].includes(cautious.portfolio.grade)) {
            expect(cautiousIds).toContain('SCHEDULE_QUARTERLY_SUPPLIER_AUDIT');
        }
        // Aggressive should not include P3 maintain
        expect(aggressiveIds).not.toContain('MAINTAIN_SUPPLIER_HEALTH');
    });

    test('lead-time SLA breach surfaces reason code', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 's6', name: 'Slow', category: 'consumable',
            lotsDelivered: 15, lotsRejected: 0,
            onTimeDeliveries: 10, lateDeliveries: 5,
            avgLeadTimeDays: 20, contractedLeadTimeDays: 10,
            priceIndex: 1.0, criticality: 3
        }]);
        expect(r.perSupplier[0].reasons).toContain('LEAD_TIME_SLA_BREACH');
    });

    test('formatText / formatMarkdown / formatJson render all sections', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 's7', name: 'TextCo', category: 'reagent',
            lotsDelivered: 12, lotsRejected: 1,
            onTimeDeliveries: 10, lateDeliveries: 2,
            contaminationIncidents: 0, recalls: 0
        }]);
        const txt = adv.formatText(r);
        expect(txt).toMatch(/SUPPLIER QUALITY SCORECARD/);
        expect(txt).toMatch(/Playbook:/);
        const md = adv.formatMarkdown(r);
        expect(md).toMatch(/^# Supplier Quality Scorecard/m);
        expect(md).toMatch(/## Suppliers/);
        expect(md).toMatch(/## Playbook/);
        expect(md).toMatch(/## Insights/);
        const json = adv.formatJson(r);
        const parsed = JSON.parse(json);
        expect(parsed.portfolio).toBeDefined();
        expect(parsed.perSupplier).toBeDefined();
    });

    test('json output is byte-stable across two calls with same input', () => {
        const adv = buildAdvisor();
        const input = [
            { id: 'a', name: 'A', category: 'reagent',
              lotsDelivered: 10, lotsRejected: 1,
              onTimeDeliveries: 9, lateDeliveries: 1 },
            { id: 'b', name: 'B', category: 'reagent',
              lotsDelivered: 8, lotsRejected: 0,
              onTimeDeliveries: 8, lateDeliveries: 0 }
        ];
        const r1 = adv.analyze(input);
        const r2 = adv.analyze(input);
        expect(adv.formatJson(r1)).toBe(adv.formatJson(r2));
    });

    test('input is not mutated', () => {
        const adv = buildAdvisor();
        const input = [{
            id: 'x', name: 'X', category: 'reagent',
            lotsDelivered: 15, lotsRejected: 3,
            onTimeDeliveries: 12, lateDeliveries: 3,
            contaminationIncidents: 1, recalls: 0, criticality: 3
        }];
        const snap = JSON.stringify(input);
        adv.analyze(input, { risk_appetite: 'cautious' });
        expect(JSON.stringify(input)).toBe(snap);
    });

    test('explicit categorySupplierCounts overrides auto-detection', () => {
        const adv = buildAdvisor();
        const r = adv.analyze({
            suppliers: [{
                id: 'lonely', name: 'Lonely', category: 'service',
                lotsDelivered: 20, lotsRejected: 3,
                onTimeDeliveries: 15, lateDeliveries: 5,
                criticality: 4
            }],
            categorySupplierCounts: { service: 1 }  // explicitly single-sourced
        });
        expect(r.perSupplier[0].categoryShareWarning).toBe(true);
    });

    test('invalid now() throws', () => {
        const adv = buildAdvisor();
        expect(() => adv.analyze([], { now: () => new Date('not-a-date') })).toThrow();
    });

    test('headline string contains key metrics', () => {
        const adv = buildAdvisor();
        const r = adv.analyze([{
            id: 'h', name: 'H', category: 'reagent',
            lotsDelivered: 10, lotsRejected: 0,
            onTimeDeliveries: 10, lateDeliveries: 0
        }]);
        expect(r.headline).toMatch(/^VERDICT:/);
        expect(r.headline).toMatch(/grade=/);
        expect(r.headline).toMatch(/blacklist=/);
    });
});

const V_PROBATION = 'PROBATION';
