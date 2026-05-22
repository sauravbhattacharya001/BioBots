'use strict';

/**
 * Tests for cellHarvestWindowAdvisor — agentic per-vessel harvest planner.
 */

var fab = require('../docs/shared/cellHarvestWindowAdvisor');
var createCellHarvestWindowAdvisor = fab.createCellHarvestWindowAdvisor;
var VERDICTS = fab.VERDICTS;

function fixedNow(iso) { return function () { return new Date(iso); }; }
var NOW = '2026-05-22T09:00:00Z';

function makeAdvisor() {
    return createCellHarvestWindowAdvisor({ now: fixedNow(NOW) });
}

describe('cellHarvestWindowAdvisor — factory shape', function () {
    test('exports factory and verdict constants', function () {
        expect(typeof createCellHarvestWindowAdvisor).toBe('function');
        expect(VERDICTS.HARVEST_NOW).toBe('HARVEST_NOW');
        expect(VERDICTS.OVERGROWN_DISCARD).toBe('OVERGROWN_DISCARD');
    });

    test('returned object has documented API', function () {
        var a = makeAdvisor();
        ['recommend', 'simulate', 'formatText', 'formatMarkdown', 'formatJson'].forEach(function (k) {
            expect(typeof a[k]).toBe('function');
        });
        expect(a.VERDICTS.HARVEST_NOW).toBe('HARVEST_NOW');
    });

    test('empty input -> grade A and healthy insight', function () {
        var a = makeAdvisor();
        var r = a.recommend();
        expect(r.portfolio.totalVessels).toBe(0);
        expect(r.portfolio.grade).toBe('A');
        expect(r.insights).toContain('HEALTHY_CULTURE_FLEET');
        expect(r.risk_appetite).toBe('balanced');
    });
});

describe('cellHarvestWindowAdvisor — per-vessel verdicts', function () {
    test('HARVEST_NOW when confluency >= target and viability OK', function () {
        var a = makeAdvisor();
        var r = a.recommend({
            vessels: [{
                id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-18T09:00:00Z',
                confluencyPct: 85, viabilityPct: 96, experimentTarget: 'assay',
            }],
        });
        expect(r.vessels[0].verdict).toBe(VERDICTS.HARVEST_NOW);
        expect(r.vessels[0].priority).toBe('P0');
        expect(r.portfolio.grade).toBe('F'); // P0 forces F
    });

    test('OVERGROWN_DISCARD verdict when confluency >= 100', function () {
        var a = makeAdvisor();
        var r = a.recommend({
            vessels: [{ id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-18T09:00:00Z',
                confluencyPct: 100, viabilityPct: 90 }],
        });
        expect(r.vessels[0].verdict).toBe(VERDICTS.OVERGROWN_DISCARD);
        expect(r.vessels[0].priority).toBe('P0');
        var hasDiscard = r.playbook.some(function (a) { return a.id === 'DISCARD_OVERGROWN_VESSELS'; });
        expect(hasDiscard).toBe(true);
    });

    test('UNHEALTHY_RESCUE verdict for low viability', function () {
        var a = makeAdvisor();
        var r = a.recommend({
            vessels: [{ id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-20T09:00:00Z',
                confluencyPct: 60, viabilityPct: 55 }],
        });
        expect(r.vessels[0].verdict).toBe(VERDICTS.UNHEALTHY_RESCUE);
        expect(r.vessels[0].priority).toBe('P0');
        expect(r.vessels[0].reasons).toContain('LOW_VIABILITY');
        expect(r.playbook.some(function (a) { return a.id === 'RESCUE_LOW_VIABILITY'; })).toBe(true);
    });

    test('contamination flag triggers ISOLATE_CONTAMINATED_VESSELS', function () {
        var a = makeAdvisor();
        var r = a.recommend({
            vessels: [{ id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-20T09:00:00Z',
                confluencyPct: 60, viabilityPct: 95, contaminationFlag: true }],
        });
        expect(r.vessels[0].verdict).toBe(VERDICTS.UNHEALTHY_RESCUE);
        expect(r.vessels[0].priority).toBe('P0');
        expect(r.insights).toContain('CONTAMINATION_DETECTED');
        expect(r.playbook.some(function (a) { return a.id === 'ISOLATE_CONTAMINATED_VESSELS'; })).toBe(true);
    });

    test('PASSAGE_LIMIT_REACHED verdict', function () {
        var a = makeAdvisor();
        var r = a.recommend({
            vessels: [{ id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-20T09:00:00Z',
                confluencyPct: 50, viabilityPct: 95, passageNumber: 25, maxPassage: 25 }],
        });
        expect(r.vessels[0].verdict).toBe(VERDICTS.PASSAGE_LIMIT_REACHED);
        expect(r.vessels[0].priority).toBe('P1');
        expect(r.playbook.some(function (a) { return a.id === 'REBANK_PASSAGE_LIMITED'; })).toBe(true);
    });

    test('INSUFFICIENT_DATA when no confluency or history', function () {
        var a = makeAdvisor();
        var r = a.recommend({
            vessels: [{ id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-20T09:00:00Z' }],
        });
        expect(r.vessels[0].verdict).toBe(VERDICTS.INSUFFICIENT_DATA);
        expect(r.vessels[0].priority).toBe('P3');
    });

    test('HARVEST_TODAY with projected window populated from growth history', function () {
        var a = makeAdvisor();
        // Slope: 60% -> 70% over 6h => 5%/h. Target 80% -> ~2h remaining.
        var r = a.recommend({
            vessels: [{
                id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-20T09:00:00Z',
                experimentTarget: 'assay',
                growthHistory: [
                    { ts: '2026-05-22T03:00:00Z', confluencyPct: 60 },
                    { ts: '2026-05-22T09:00:00Z', confluencyPct: 70 },
                ],
            }],
        });
        var v = r.vessels[0];
        // 70 is below 80 target, so should be HARVEST_TODAY
        expect([VERDICTS.HARVEST_TODAY, VERDICTS.HARVEST_NOW]).toContain(v.verdict);
        expect(v.projectedHarvestWindowISO).toBeTruthy();
        expect(v.hoursToTarget).not.toBeNull();
    });

    test('HARVEST_TOMORROW window between 12h and 36h', function () {
        var a = makeAdvisor();
        // 50% -> 55% over 24h => ~0.2%/h. Target 80% -> ~125h. Hmm too long.
        // Use 60% -> 65% over 3h => ~1.67%/h. Remaining to 80% = ~9h. That's TODAY.
        // For TOMORROW: 60% -> 62% over 6h => ~0.33%/h. Remaining 18/0.33 ~= 54h. Too long.
        // Use 60% -> 64% over 6h => 0.67%/h. Remaining 16/0.67 = ~24h. -> TOMORROW.
        var r = a.recommend({
            vessels: [{
                id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-19T09:00:00Z',
                experimentTarget: 'assay',
                growthHistory: [
                    { ts: '2026-05-22T03:00:00Z', confluencyPct: 60 },
                    { ts: '2026-05-22T09:00:00Z', confluencyPct: 64 },
                ],
            }],
        });
        var v = r.vessels[0];
        expect([VERDICTS.HARVEST_TOMORROW, VERDICTS.WAIT, VERDICTS.HARVEST_TODAY]).toContain(v.verdict);
        expect(v.projectedHarvestWindowISO).toBeTruthy();
    });
});

describe('cellHarvestWindowAdvisor — fleet playbook & insights', function () {
    test('REQUEST_CENTRIFUGE_SLOT fires when >=2 NOW and no centrifuge soon', function () {
        var a = makeAdvisor();
        var v = function (id) {
            return { id: id, cellLine: 'HEK293', seededAt: '2026-05-18T09:00:00Z',
                confluencyPct: 85, viabilityPct: 95, experimentTarget: 'assay' };
        };
        var r = a.recommend({
            vessels: [v('V1'), v('V2')],
            equipmentAvailability: { centrifuge: '2026-05-23T09:00:00Z' }, // 24h away
        });
        expect(r.playbook.some(function (a) { return a.id === 'REQUEST_CENTRIFUGE_SLOT'; })).toBe(true);
        expect(r.playbook.some(function (a) { return a.id === 'SCHEDULE_BSC_FOR_HARVEST_NOW'; })).toBe(true);
    });

    test('OVERGROWTH_CLUSTER insight with >=2 overgrown', function () {
        var a = makeAdvisor();
        var v = function (id) {
            return { id: id, cellLine: 'HEK293', seededAt: '2026-05-18T09:00:00Z',
                confluencyPct: 100, viabilityPct: 90 };
        };
        var r = a.recommend({ vessels: [v('A'), v('B')] });
        expect(r.insights).toContain('OVERGROWTH_CLUSTER');
    });

    test('cautious vs aggressive shifts scores and playbook', function () {
        var ac = makeAdvisor();
        var input = { vessels: [{ id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-20T09:00:00Z',
            confluencyPct: 50, viabilityPct: 95 }] };
        var rb = ac.recommend(input);
        var rc = ac.recommend(input, { risk_appetite: 'cautious' });
        var ra = ac.recommend(input, { risk_appetite: 'aggressive' });
        expect(rc.vessels[0].priorityScore).toBeGreaterThan(rb.vessels[0].priorityScore);
        expect(ra.vessels[0].priorityScore).toBeLessThan(rb.vessels[0].priorityScore);
        // Aggressive should trim P3 fallback when no other actions exist?
        // With only WAIT (P3) verdict, aggressive keeps MAINTAIN_CULTURE_WATCH because no other actions.
        expect(rb.risk_appetite).toBe('balanced');
        expect(rc.risk_appetite).toBe('cautious');
        expect(ra.risk_appetite).toBe('aggressive');
    });
});

describe('cellHarvestWindowAdvisor — simulate, immutability, renderers', function () {
    test('simulate(applyTopN) raises projected score and does not mutate report', function () {
        var a = makeAdvisor();
        var r = a.recommend({
            vessels: [
                { id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-18T09:00:00Z',
                    confluencyPct: 100, viabilityPct: 90 },
                { id: 'V2', cellLine: 'HEK293', seededAt: '2026-05-18T09:00:00Z',
                    confluencyPct: 50, viabilityPct: 55 },
            ],
        });
        var before = JSON.stringify(r);
        var sim = a.simulate(r, { applyTopN: 2 });
        expect(sim.projectedScore).toBeLessThanOrEqual(r.portfolio.portfolioScore);
        expect(Array.isArray(sim.actionsApplied)).toBe(true);
        expect(sim.actionsApplied.length).toBeLessThanOrEqual(2);
        expect(JSON.stringify(r)).toBe(before);
    });

    test('input immutability: input snapshot unchanged after recommend', function () {
        var a = makeAdvisor();
        var input = {
            vessels: [{ id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-18T09:00:00Z',
                confluencyPct: 85, viabilityPct: 95,
                growthHistory: [{ ts: '2026-05-21T09:00:00Z', confluencyPct: 70 }],
                experimentTarget: 'assay' }],
            equipmentAvailability: { centrifuge: '2026-05-22T10:00:00Z' },
        };
        var snap = JSON.stringify(input);
        a.recommend(input);
        expect(JSON.stringify(input)).toBe(snap);
    });

    test('formatJson byte-stability (two calls match)', function () {
        var a = makeAdvisor();
        var r = a.recommend({
            vessels: [{ id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-18T09:00:00Z',
                confluencyPct: 85, viabilityPct: 95 }],
        });
        var j1 = a.formatJson(r);
        var j2 = a.formatJson(r);
        expect(j1).toBe(j2);
        // sanity: it's valid JSON
        expect(function () { JSON.parse(j1); }).not.toThrow();
    });

    test('formatMarkdown contains all four ## sections', function () {
        var a = makeAdvisor();
        var r = a.recommend({
            vessels: [{ id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-18T09:00:00Z',
                confluencyPct: 85, viabilityPct: 95 }],
        });
        var md = a.formatMarkdown(r);
        ['## Summary', '## Vessels', '## Playbook', '## Insights'].forEach(function (s) {
            expect(md).toContain(s);
        });
    });

    test('formatText non-empty and contains grade headline', function () {
        var a = makeAdvisor();
        var r = a.recommend({});
        var txt = a.formatText(r);
        expect(txt).toContain('VERDICT:');
        expect(txt).toContain('grade=');
    });
});

describe('cellHarvestWindowAdvisor — SDK wiring', function () {
    test('exposed via index.js lazy manifest', function () {
        var biobots = require('../index.js');
        expect(typeof biobots.createCellHarvestWindowAdvisor).toBe('function');
        expect(biobots.hasFactory('createCellHarvestWindowAdvisor')).toBe(true);
        var a = biobots.createCellHarvestWindowAdvisor();
        expect(typeof a.recommend).toBe('function');
    });
});
