'use strict';

var advisorMod = require('../docs/shared/reagentSubstitutionAdvisor');
var createReagentSubstitutionAdvisor = advisorMod.createReagentSubstitutionAdvisor;
var inv = require('../docs/shared/labInventory');

function mkInventory() { return inv.createLabInventoryManager(); }

// Fixed-time helper for determinism
var FROZEN_NOW = new Date('2026-05-17T14:00:00.000Z');
function frozenNow() { return new Date(FROZEN_NOW.getTime()); }

describe('createReagentSubstitutionAdvisor', function () {
    test('throws if inventory missing or lacks listItems', function () {
        expect(function () { createReagentSubstitutionAdvisor(); }).toThrow();
        expect(function () { createReagentSubstitutionAdvisor({ inventory: {} }); }).toThrow();
    });

    test('unknown reagent yields grade F with no candidates and P2 NOTIFY_PI', function () {
        var i = mkInventory();
        var a = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        var r = a.recommend({ reagent: 'NonexistentXYZ', needAmount: 3 });
        expect(r.candidates.length).toBe(0);
        expect(r.grade).toBe('F');
        expect(r.topPick).toBeNull();
        expect(r.insights.length).toBeGreaterThan(0);
        var hasNotify = r.playbook.some(function (p) { return p.action === 'NOTIFY_PI'; });
        expect(hasNotify).toBe(true);
    });

    test('in-stock high-compat substitute -> RECOMMENDED, grade A, topPick set, suggestedAmount scaled', function () {
        var i = mkInventory();
        // GlutaMAX -> L-Glutamine: compat 0.95, no protocol change, conc factor 1.0 -> easy A
        i.addItem({ name: 'GlutaMAX', category: 'reagent', quantity: 100, unit: 'mL' });
        var a = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        var r = a.recommend({ reagent: 'L-Glutamine', needAmount: 5, unit: 'mL', reason: 'out_of_stock' });
        expect(r.topPick).not.toBeNull();
        expect(r.topPick.name).toBe('GlutaMAX');
        expect(r.topPick.verdict).toBe('RECOMMENDED');
        expect(r.topPick.suggestedAmount).toBe(5);
        expect(r.grade).toBe('A');
    });

    test('suggestedAmount honors concentrationFactor (Alginate 1% -> 2x volume)', function () {
        var i = mkInventory();
        i.addItem({ name: 'Alginate 1%', category: 'bioink', quantity: 50, unit: 'mL' });
        var a = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        var r = a.recommend({ reagent: 'Alginate 2%', needAmount: 5, unit: 'mL', reason: 'out_of_stock' });
        var alg1 = r.candidates.find(function (c) { return c.name === 'Alginate 1%'; });
        expect(alg1.suggestedAmount).toBe(10); // 5 * 2.0
        expect(alg1.stockSufficient).toBe(true);
    });

    test('only out-of-stock candidates -> all UNAVAILABLE, P0 ESCALATE_REORDER', function () {
        var i = mkInventory();  // no items at all
        var a = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        var r = a.recommend({ reagent: 'CaCl2 100mM', needAmount: 10, reason: 'out_of_stock' });
        expect(r.candidates.length).toBeGreaterThan(0);
        var allUnavailable = r.candidates.every(function (c) { return c.verdict === 'UNAVAILABLE'; });
        expect(allUnavailable).toBe(true);
        expect(r.topPick).toBeNull();
        var hasEscalate = r.playbook.some(function (p) { return p.action === 'ESCALATE_REORDER'; });
        expect(hasEscalate).toBe(true);
    });

    test('expired inventory candidate flagged + score reduced', function () {
        var i = mkInventory();
        i.addItem({
            name: 'GlutaMAX', category: 'reagent', quantity: 100, unit: 'mL',
            expiryDate: '2026-05-10T00:00:00.000Z'  // past relative to frozen now (2026-05-17)
        });
        var a = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        var r = a.recommend({ reagent: 'L-Glutamine', needAmount: 5, reason: 'out_of_stock' });
        var c = r.candidates.find(function (x) { return x.name === 'GlutaMAX'; });
        expect(c.expired).toBe(true);
        // score should be reduced vs the no-expiry baseline (compatibility=0.95 alone -> base 95)
        expect(c.score).toBeLessThan(95);
        var hasExpiredNote = c.protocolAdjustments.some(function (s) { return s.indexOf('expired') !== -1; });
        expect(hasExpiredNote).toBe(true);
    });

    test('reason=failed_qc -> P0 QUARANTINE_LOT in playbook', function () {
        var i = mkInventory();
        i.addItem({ name: 'GlutaMAX', category: 'reagent', quantity: 100, unit: 'mL' });
        var a = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        var r = a.recommend({ reagent: 'L-Glutamine', needAmount: 5, reason: 'failed_qc' });
        var hasQuar = r.playbook.some(function (p) { return p.action === 'QUARANTINE_LOT' && p.priority === 'P0'; });
        expect(hasQuar).toBe(true);
        expect(r.priority).toBe('P0');
    });

    test('reason=recalled -> P0 QUARANTINE_LOT + P0 ESCALATE_REORDER', function () {
        var i = mkInventory();
        i.addItem({ name: 'GlutaMAX', category: 'reagent', quantity: 100, unit: 'mL' });
        var a = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        var r = a.recommend({ reagent: 'L-Glutamine', needAmount: 5, reason: 'recalled' });
        var actions = r.playbook.map(function (p) { return p.action; });
        expect(actions.indexOf('QUARANTINE_LOT')).toBeGreaterThanOrEqual(0);
        expect(actions.indexOf('ESCALATE_REORDER')).toBeGreaterThanOrEqual(0);
    });

    test('cautious lowers score on low-compat candidates more than aggressive', function () {
        var i = mkInventory();
        // BaCl2 100mM has compatibility 0.60 - falls in cautious penalty band (<0.7)
        i.addItem({ name: 'BaCl2 100mM', category: 'crosslinker', quantity: 100, unit: 'mL' });
        var cautious = createReagentSubstitutionAdvisor({ inventory: i, riskAppetite: 'cautious', now: frozenNow });
        var aggressive = createReagentSubstitutionAdvisor({ inventory: i, riskAppetite: 'aggressive', now: frozenNow });
        var rc = cautious.recommend({ reagent: 'CaCl2 100mM', needAmount: 5 });
        var ra = aggressive.recommend({ reagent: 'CaCl2 100mM', needAmount: 5 });
        var bc = rc.candidates.find(function (c) { return c.name === 'BaCl2 100mM'; });
        var ba = ra.candidates.find(function (c) { return c.name === 'BaCl2 100mM'; });
        expect(bc.score).toBeLessThan(ba.score);
    });

    test('custom substitutionMap merges with built-in and overrides on conflict', function () {
        var i = mkInventory();
        i.addItem({ name: 'CustomInk', category: 'bioink', quantity: 50, unit: 'mL' });
        var a = createReagentSubstitutionAdvisor({
            inventory: i, now: frozenNow,
            substitutionMap: {
                'MysteryGel': [
                    { name: 'CustomInk', category: 'bioink', compatibility: 0.9,
                      concentrationFactor: 1.0, requiresProtocolChange: false, notes: 'custom' }
                ]
            }
        });
        var r = a.recommend({ reagent: 'MysteryGel', needAmount: 2 });
        expect(r.candidates.length).toBe(1);
        expect(r.candidates[0].name).toBe('CustomInk');
        expect(r.grade).toBe('A');

        // And original built-in should still work
        var r2 = a.recommend({ reagent: 'DMEM', needAmount: 2 });
        expect(r2.candidates.length).toBeGreaterThan(0);
    });

    test('setSubstitution at runtime is used by subsequent recommend()', function () {
        var i = mkInventory();
        i.addItem({ name: 'FooSub', category: 'reagent', quantity: 100, unit: 'mL' });
        var a = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        a.setSubstitution('FooReagent', [
            { name: 'FooSub', category: 'reagent', compatibility: 0.95,
              concentrationFactor: 1.0, requiresProtocolChange: false, notes: 'runtime' }
        ]);
        var r = a.recommend({ reagent: 'FooReagent', needAmount: 1 });
        expect(r.topPick && r.topPick.name).toBe('FooSub');
    });

    test('recommendBatch summary counts grades across mixed items', function () {
        var i = mkInventory();
        i.addItem({ name: 'GlutaMAX', category: 'reagent', quantity: 100, unit: 'mL' });
        var a = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        var batch = a.recommendBatch([
            { reagent: 'L-Glutamine', needAmount: 5 },          // A
            { reagent: 'NonexistentXYZ', needAmount: 1 },       // F
            { reagent: 'CaCl2 100mM', needAmount: 5 }           // nothing in stock -> D (no topPick, no fallback)
        ]);
        expect(batch.summary.total).toBe(3);
        expect(batch.summary.gradeCounts.A).toBe(1);
        expect(batch.summary.gradeCounts.F).toBe(1);
        expect(batch.summary.needsEscalation).toBeGreaterThanOrEqual(1);
    });

    test('simulate({applyTopN:1}) returns applied list + projected inventory delta', function () {
        var i = mkInventory();
        i.addItem({ name: 'GlutaMAX', category: 'reagent', quantity: 100, unit: 'mL' });
        var a = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        var r = a.recommend({ reagent: 'L-Glutamine', needAmount: 5 });
        var sim = a.simulate(r, { applyTopN: 1 });
        expect(sim.applied).toEqual(['GlutaMAX']);
        expect(sim.projectedInventoryDelta['GlutaMAX']).toBe(-5);
        expect(sim.remainingDemand).toBe(0);
    });

    test('formatJson is byte-stable given fixed now and inputs', function () {
        var i = mkInventory();
        i.addItem({ name: 'GlutaMAX', category: 'reagent', quantity: 100, unit: 'mL' });
        var a = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        var r1 = a.recommend({ reagent: 'L-Glutamine', needAmount: 5 });
        var r2 = a.recommend({ reagent: 'L-Glutamine', needAmount: 5 });
        expect(a.formatJson(r1)).toBe(a.formatJson(r2));
    });

    test('preferSameCategory:false removes the +5 same-category bonus', function () {
        var i = mkInventory();
        // Requesting Alginate 2% which exists in inventory as a bioink -> reqCategory='bioink'
        i.addItem({ name: 'Alginate 2%', category: 'bioink', quantity: 0, unit: 'mL' });
        i.addItem({ name: 'Alginate 1%', category: 'bioink', quantity: 50, unit: 'mL' });
        var withBonus = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        var noBonus = createReagentSubstitutionAdvisor({ inventory: i, preferSameCategory: false, now: frozenNow });
        var r1 = withBonus.recommend({ reagent: 'Alginate 2%', needAmount: 5 });
        var r2 = noBonus.recommend({ reagent: 'Alginate 2%', needAmount: 5 });
        var a1 = r1.candidates.find(function (c) { return c.name === 'Alginate 1%'; });
        var a2 = r2.candidates.find(function (c) { return c.name === 'Alginate 1%'; });
        expect(a1.score).toBeGreaterThan(a2.score);
    });

    test('formatText and formatMarkdown produce non-empty strings', function () {
        var i = mkInventory();
        i.addItem({ name: 'GlutaMAX', category: 'reagent', quantity: 100, unit: 'mL' });
        var a = createReagentSubstitutionAdvisor({ inventory: i, now: frozenNow });
        var r = a.recommend({ reagent: 'L-Glutamine', needAmount: 5, reason: 'recalled' });
        var t = a.formatText(r);
        var md = a.formatMarkdown(r);
        expect(typeof t).toBe('string');
        expect(t.length).toBeGreaterThan(50);
        expect(typeof md).toBe('string');
        expect(md.indexOf('## Reagent Substitution')).toBe(0);
        expect(md.indexOf('Playbook')).toBeGreaterThan(0);
    });
});
