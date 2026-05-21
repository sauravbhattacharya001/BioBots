'use strict';

var mod = require('../docs/shared/cellBankVialAdvisor');
var createCellBankVialAdvisor = mod.createCellBankVialAdvisor;

var FROZEN_NOW = new Date('2026-06-01T00:00:00.000Z');
function frozenNow() { return new Date(FROZEN_NOW.getTime()); }

function makeAdvisor(opts) {
    opts = opts || {};
    if (!opts.now) opts.now = frozenNow;
    return createCellBankVialAdvisor(opts);
}

function hekLine(extra) {
    return Object.assign({
        name: 'HEK293',
        maxPassage: 30,
        qcIntervalDays: 180,
        minViabilityPct: 80,
        masterFloor: 5,
        workingFloor: 4,
        warningRunway: 8,
    }, extra || {});
}

function vial(id, extra) {
    return Object.assign({
        id: id,
        cellLine: 'HEK293',
        bankType: 'working',
        passageNumber: 10,
        vialCount: 1,
        frozenAt: '2025-06-01',
        viabilityAtFreezePct: 92,
        freezeThawCycles: 0,
        lastQCDate: '2026-04-01',
    }, extra || {});
}

describe('createCellBankVialAdvisor', function () {

    test('factory returns expected API surface', function () {
        var a = makeAdvisor();
        expect(typeof a.evaluate).toBe('function');
        expect(typeof a.formatText).toBe('function');
        expect(typeof a.formatMarkdown).toBe('function');
        expect(typeof a.formatJson).toBe('function');
    });

    test('empty input returns NO_NOTABLE_SIGNALS and grade A', function () {
        var r = makeAdvisor().evaluate({});
        expect(r.grade).toBe('A');
        expect(r.summary.totalVials).toBe(0);
        expect(r.insights[0].code).toBe('NO_NOTABLE_SIGNALS');
        expect(r.playbook[0].id).toBe('HEALTHY_BANK_PORTFOLIO');
    });

    test('well-stocked line yields ADEQUATE/WELL_STOCKED and grade A or B', function () {
        var vials = [];
        // 8 master, low passage, recent QC
        for (var i = 0; i < 8; i++) {
            vials.push(vial('M' + i, { bankType: 'master', passageNumber: 3,
                                       viabilityAtFreezePct: 95, lastQCDate: '2026-05-01' }));
        }
        // 14 working, recent QC
        for (var j = 0; j < 14; j++) {
            vials.push(vial('W' + j, { bankType: 'working', passageNumber: 10,
                                       viabilityAtFreezePct: 92, lastQCDate: '2026-04-15' }));
        }
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials });
        expect(['ADEQUATE', 'WELL_STOCKED']).toContain(r.lines[0].primaryVerdict);
        expect(['A', 'B']).toContain(r.grade);
    });

    test('master bank below floor triggers MASTER_BANK_ENDANGERED P0', function () {
        var vials = [
            vial('M1', { bankType: 'master', passageNumber: 3, lastQCDate: '2026-05-01' }),
            vial('M2', { bankType: 'master', passageNumber: 3, lastQCDate: '2026-05-01' }),
            vial('W1', { bankType: 'working', passageNumber: 10, lastQCDate: '2026-04-01', vialCount: 5 }),
            vial('W2', { bankType: 'working', passageNumber: 10, lastQCDate: '2026-04-01', vialCount: 5 }),
        ];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials });
        expect(r.lines[0].primaryVerdict).toBe('MASTER_BANK_ENDANGERED');
        expect(r.grade).toBe('F');
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('REPLENISH_MASTER_BANK');
    });

    test('critical depletion when no usable working vials', function () {
        var vials = [
            vial('M1', { bankType: 'master', passageNumber: 3, lastQCDate: '2026-05-01', vialCount: 10 }),
        ];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials });
        expect(r.lines[0].verdicts).toContain('CRITICAL_DEPLETION');
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('EXPAND_WORKING_BANK_FROM_MASTER');
    });

    test('passage > max produces AGED_OUT_PASSAGE and blocking', function () {
        var vials = [vial('V1', { passageNumber: 40, lastQCDate: '2026-04-01' })];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials });
        expect(r.vials[0].verdicts).toContain('AGED_OUT_PASSAGE');
        expect(r.vials[0].blocking).toBe(true);
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('RETIRE_AGED_PASSAGE_VIALS');
    });

    test('low viability yields EXPIRED_VIABILITY and blocks allocation', function () {
        var vials = [
            vial('V1', { viabilityAtFreezePct: 50 }),
            vial('V2'),
        ];
        var requests = [{ id: 'R1', cellLine: 'HEK293', vialsNeeded: 1, intendedUse: 'experiment' }];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials, requests: requests });
        var v1 = r.vials.filter(function (v) { return v.id === 'V1'; })[0];
        expect(v1.verdicts).toContain('EXPIRED_VIABILITY');
        expect(v1.blocking).toBe(true);
        // allocation should pick V2 not V1
        expect(r.allocations[0].picks[0].vialId).toBe('V2');
        expect(r.allocations[0].fulfilled).toBe(true);
    });

    test('QC overdue is detected when lastQCDate is old or missing', function () {
        var vials = [
            vial('V1', { lastQCDate: '2024-01-01' }),    // way too old
            vial('V2', { lastQCDate: null }),            // never
        ];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials });
        expect(r.vials[0].verdicts).toContain('QC_OVERDUE');
        expect(r.vials[1].verdicts).toContain('QC_OVERDUE');
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('RUN_QC_ON_OVERDUE_VIALS');
    });

    test('high freezeThawCycles triggers HIGH_THAW_CYCLES + consolidate action', function () {
        var vials = [vial('V1', { freezeThawCycles: 3 })];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials });
        expect(r.vials[0].verdicts).toContain('HIGH_THAW_CYCLES');
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('CONSOLIDATE_HIGH_THAW_VIALS');
    });

    test('experiment intent never picks from master when working has stock', function () {
        var vials = [
            vial('M1', { bankType: 'master', passageNumber: 3, vialCount: 10, lastQCDate: '2026-05-01' }),
            vial('W1', { bankType: 'working', passageNumber: 12, vialCount: 6, lastQCDate: '2026-04-01' }),
            vial('W2', { bankType: 'working', passageNumber: 10, vialCount: 6, lastQCDate: '2026-04-01' }),
        ];
        var requests = [{ id: 'R1', cellLine: 'HEK293', vialsNeeded: 2, intendedUse: 'experiment' }];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials, requests: requests });
        var picks = r.allocations[0].picks;
        expect(picks.every(function (p) { return p.bankType !== 'master'; })).toBe(true);
        expect(r.allocations[0].fulfilled).toBe(true);
    });

    test('FIFO picks highest-passage vial first within eligible pool', function () {
        var vials = [
            vial('W_low', { passageNumber: 8, vialCount: 5, lastQCDate: '2026-04-01' }),
            vial('W_high', { passageNumber: 18, vialCount: 5, lastQCDate: '2026-04-01' }),
        ];
        var requests = [{ id: 'R1', cellLine: 'HEK293', vialsNeeded: 1, intendedUse: 'experiment' }];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials, requests: requests });
        expect(r.allocations[0].picks[0].vialId).toBe('W_high');
    });

    test('rebanking pulls from master only', function () {
        var vials = [
            vial('M1', { bankType: 'master', passageNumber: 3, vialCount: 10, lastQCDate: '2026-05-01' }),
            vial('W1', { bankType: 'working', passageNumber: 10, vialCount: 10, lastQCDate: '2026-04-01' }),
        ];
        var requests = [{ id: 'R1', cellLine: 'HEK293', vialsNeeded: 2, intendedUse: 'rebanking' }];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials, requests: requests });
        expect(r.allocations[0].picks.every(function (p) { return p.bankType === 'master'; })).toBe(true);
    });

    test('unfulfilled request with alternate bank suggests REROUTE', function () {
        var vials = [
            vial('M1', { bankType: 'master', passageNumber: 3, vialCount: 10, lastQCDate: '2026-05-01' }),
        ];
        // no working vials, but experiment requested
        var requests = [{ id: 'R1', cellLine: 'HEK293', vialsNeeded: 1, intendedUse: 'experiment' }];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials, requests: requests });
        expect(r.allocations[0].fulfilled).toBe(false);
        var codes = r.allocations[0].reasons.map(function (rs) { return rs.code; });
        expect(codes).toContain('ALTERNATE_BANK_HAS_STOCK');
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('REROUTE_REQUEST_TO_DIFFERENT_BANK');
    });

    test('unfulfilled with no stock anywhere suggests external sourcing', function () {
        var requests = [{ id: 'R1', cellLine: 'HEK293', vialsNeeded: 3, intendedUse: 'experiment' }];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: [], requests: requests });
        expect(r.allocations[0].fulfilled).toBe(false);
        expect(r.allocations[0].vialsAllocated).toBe(0);
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('REQUEST_EXTERNAL_VIAL_SOURCE');
    });

    test('unknown cell line tagged UNKNOWN_LINE and surfaced in playbook', function () {
        var vials = [vial('V1', { cellLine: 'MYSTERY' })];
        var r = makeAdvisor().evaluate({ cellLines: [], vials: vials });
        var mystery = r.lines.filter(function (l) { return l.name === 'MYSTERY'; })[0];
        expect(mystery.primaryVerdict).toBe('UNKNOWN_LINE');
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('REGISTER_UNKNOWN_LINE');
    });

    test('reserved vial is skipped during allocation', function () {
        var vials = [
            vial('R1v', { reserved: true, vialCount: 10 }),
            vial('W1', { vialCount: 2 }),
        ];
        var requests = [{ id: 'R1', cellLine: 'HEK293', vialsNeeded: 2, intendedUse: 'experiment' }];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials, requests: requests });
        expect(r.allocations[0].picks.every(function (p) { return p.vialId !== 'R1v'; })).toBe(true);
        expect(r.allocations[0].fulfilled).toBe(true);
    });

    test('short lead time emits SHORT_LEAD_TIME warning', function () {
        var vials = [vial('W1', { vialCount: 5 })];
        var requests = [{ id: 'R1', cellLine: 'HEK293', vialsNeeded: 1, intendedUse: 'experiment',
                          neededByDate: '2026-06-02' }];
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials, requests: requests });
        var codes = r.allocations[0].warnings.map(function (w) { return w.code; });
        expect(codes).toContain('SHORT_LEAD_TIME');
    });

    test('cautious risk appetite raises effective floors', function () {
        var vials = [];
        // Exactly at master floor with default appetite
        for (var i = 0; i < 5; i++) vials.push(vial('M' + i, { bankType: 'master', passageNumber: 3, lastQCDate: '2026-05-01' }));
        for (var j = 0; j < 8; j++) vials.push(vial('W' + j, { bankType: 'working', passageNumber: 10, lastQCDate: '2026-04-01' }));
        var balanced = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials });
        var cautious = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: vials, riskAppetite: 'cautious' });
        // cautious should be at least as critical as balanced
        expect(cautious.riskScore).toBeGreaterThanOrEqual(balanced.riskScore);
    });

    test('aggressive appetite trims P3 actions when P0/P1 present', function () {
        var vials = [vial('V1', { passageNumber: 40 })]; // forces P0
        var aggressive = makeAdvisor().evaluate({
            cellLines: [hekLine()], vials: vials, riskAppetite: 'aggressive'
        });
        var p3s = aggressive.playbook.filter(function (a) { return a.priority === 'P3'; });
        expect(p3s.length).toBe(0);
    });

    test('formatText returns a non-empty string with expected sections', function () {
        var r = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: [vial('W1')] });
        var txt = makeAdvisor().formatText(r);
        expect(typeof txt).toBe('string');
        expect(txt).toMatch(/CELL BANK VIAL ADVISOR/);
        expect(txt).toMatch(/LINES/);
        expect(txt).toMatch(/PLAYBOOK/);
    });

    test('formatMarkdown contains all expected sections', function () {
        var r = makeAdvisor().evaluate({
            cellLines: [hekLine()],
            vials: [vial('W1')],
            requests: [{ id: 'R1', cellLine: 'HEK293', vialsNeeded: 1, intendedUse: 'experiment' }],
        });
        var md = makeAdvisor().formatMarkdown(r);
        expect(md).toMatch(/# Cell Bank Vial Advisor/);
        expect(md).toMatch(/## Summary/);
        expect(md).toMatch(/## Lines/);
        expect(md).toMatch(/## Vials/);
        expect(md).toMatch(/## Allocations/);
        expect(md).toMatch(/## Playbook/);
        expect(md).toMatch(/## Insights/);
    });

    test('formatJson is byte-stable with sorted keys', function () {
        var r1 = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: [vial('W1')] });
        var r2 = makeAdvisor().evaluate({ cellLines: [hekLine()], vials: [vial('W1')] });
        var j1 = makeAdvisor().formatJson(r1);
        var j2 = makeAdvisor().formatJson(r2);
        expect(j1).toBe(j2);
        // First object key alphabetical
        var parsed = JSON.parse(j1);
        var keys = Object.keys(parsed);
        var sorted = keys.slice().sort();
        expect(keys).toEqual(sorted);
    });

    test('evaluate does not mutate input arrays/objects', function () {
        var lines = [hekLine()];
        var vials = [vial('W1')];
        var requests = [{ id: 'R1', cellLine: 'HEK293', vialsNeeded: 1, intendedUse: 'experiment' }];
        var snap = JSON.stringify({ lines: lines, vials: vials, requests: requests });
        makeAdvisor().evaluate({ cellLines: lines, vials: vials, requests: requests });
        expect(JSON.stringify({ lines: lines, vials: vials, requests: requests })).toBe(snap);
    });

    test('throws when now() returns invalid Date', function () {
        var a = createCellBankVialAdvisor({ now: function () { return new Date('not-a-date'); } });
        expect(function () { a.evaluate({}); }).toThrow(/now/);
    });

    test('exposed via main SDK manifest', function () {
        var sdk = require('..');
        expect(sdk.hasFactory('createCellBankVialAdvisor')).toBe(true);
        expect(typeof sdk.createCellBankVialAdvisor).toBe('function');
    });
});
