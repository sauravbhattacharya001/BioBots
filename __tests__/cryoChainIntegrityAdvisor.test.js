'use strict';

/**
 * Tests for cryoChainIntegrityAdvisor - agentic cold-chain monitor.
 */

var fab = require('../docs/shared/cryoChainIntegrityAdvisor');
var createCryoChainIntegrityAdvisor = fab.createCryoChainIntegrityAdvisor;
var ASSET_VERDICTS = fab.ASSET_VERDICTS;
var SAMPLE_VERDICTS = fab.SAMPLE_VERDICTS;

function fixedNow(iso) { return function () { return new Date(iso); }; }
var NOW = '2026-05-22T12:00:00Z';

function makeAdvisor(opts) {
    var o = opts || {};
    o.now = o.now || fixedNow(NOW);
    return createCryoChainIntegrityAdvisor(o);
}

describe('cryoChainIntegrityAdvisor - factory shape', function () {
    test('exports factory and verdict tables', function () {
        expect(typeof createCryoChainIntegrityAdvisor).toBe('function');
        expect(ASSET_VERDICTS.CRITICAL_EXCURSION).toBe('CRITICAL_EXCURSION');
        expect(SAMPLE_VERDICTS.SAMPLE_LOST_TO_THAW).toBe('SAMPLE_LOST_TO_THAW');
    });

    test('returned object has documented API', function () {
        var a = makeAdvisor();
        ['evaluate', 'formatText', 'formatMarkdown', 'formatJson'].forEach(function (k) {
            expect(typeof a[k]).toBe('function');
        });
        expect(a.VERDICTS.STABLE).toBe('STABLE');
        expect(a.SAMPLE_VERDICTS.SAMPLE_OK).toBe('SAMPLE_OK');
    });

    test('empty input yields grade A, COLD_CHAIN_INTACT or NO_DATA_PROVIDED, MAINTAIN action', function () {
        var r = makeAdvisor().evaluate();
        expect(r.grade).toBe('A');
        expect(r.assets.length).toBe(0);
        expect(r.sampleEvents.length).toBe(0);
        expect(r.insights).toContain('NO_DATA_PROVIDED');
        expect(r.playbook[0].id).toBe('MAINTAIN_COLD_CHAIN_WATCH');
        expect(r.riskAppetite).toBe('balanced');
    });
});

describe('cryoChainIntegrityAdvisor - asset classification', function () {
    test('stable freezer with readings in tolerance', function () {
        var r = makeAdvisor().evaluate({
            freezers: [{
                id: 'F1', kind: 'minus80', setpointC: -80, toleranceC: 5, criticality: 3,
                readings: [
                    { ts: '2026-05-22T11:00:00Z', tempC: -81 },
                    { ts: '2026-05-22T11:30:00Z', tempC: -79 },
                    { ts: '2026-05-22T12:00:00Z', tempC: -80 },
                ],
            }],
        });
        expect(r.assets[0].verdict).toBe(ASSET_VERDICTS.STABLE);
        expect(r.grade).toBe('A');
    });

    test('critical excursion when temp beyond 2x tolerance', function () {
        var r = makeAdvisor().evaluate({
            freezers: [{
                id: 'F2', kind: 'minus80', setpointC: -80, toleranceC: 5, criticality: 5,
                readings: [
                    { ts: '2026-05-22T11:00:00Z', tempC: -80 },
                    { ts: '2026-05-22T11:30:00Z', tempC: -55 }, // beyond 2x tol (-90..-70)
                ],
            }],
        });
        expect(r.assets[0].verdict).toBe(ASSET_VERDICTS.CRITICAL_EXCURSION);
        expect(r.assets[0].priority).toBe('P0');
        expect(r.grade).toBe('F');
        expect(r.insights).toContain('CRITICAL_COLD_CHAIN_FAILURE');
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toEqual(expect.arrayContaining(['EVACUATE_ASSETS_TO_BACKUP', 'PAGE_FACILITIES_ON_CALL']));
    });

    test('sustained temp drift triggers TEMP_DRIFT, not CRITICAL', function () {
        var r = makeAdvisor().evaluate({
            freezers: [{
                id: 'F3', kind: 'minus80', setpointC: -80, toleranceC: 5, criticality: 3,
                readings: [
                    { ts: '2026-05-22T11:50:00Z', tempC: -73 }, // out of tol
                    { ts: '2026-05-22T11:55:00Z', tempC: -73 },
                    { ts: '2026-05-22T12:00:00Z', tempC: -73 },
                ],
            }],
        });
        expect(r.assets[0].verdict).toBe(ASSET_VERDICTS.TEMP_DRIFT);
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('INVESTIGATE_TEMP_DRIFT');
    });

    test('LN2 dewar at critical floor -> CRITICAL_EXCURSION', function () {
        var r = makeAdvisor().evaluate({
            freezers: [{
                id: 'D1', kind: 'ln2_dewar', criticality: 5,
                ln2LevelPct: 10, ln2BoilOffPctPerDay: 3,
            }],
        });
        expect(r.assets[0].verdict).toBe(ASSET_VERDICTS.CRITICAL_EXCURSION);
        expect(r.assets[0].priority).toBe('P0');
        expect(r.grade).toBe('F');
    });

    test('LN2 dewar at refill threshold with short runway -> LN2_REFILL_NEEDED', function () {
        var r = makeAdvisor().evaluate({
            freezers: [{
                id: 'D2', kind: 'ln2_dewar', criticality: 4,
                ln2LevelPct: 25, ln2BoilOffPctPerDay: 5,
            }],
        });
        expect(r.assets[0].verdict).toBe(ASSET_VERDICTS.LN2_REFILL_NEEDED);
        expect(r.assets[0].priority).toBe('P0');
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('REFILL_LN2_DEWARS_NOW');
    });

    test('LN2 dewar with comfortable runway -> LN2_RUNWAY_LOW only if <=14d', function () {
        var r = makeAdvisor().evaluate({
            freezers: [{
                id: 'D3', kind: 'ln2_dewar', criticality: 3,
                ln2LevelPct: 60, ln2BoilOffPctPerDay: 4,  // headroom 45 / 4 = ~11d
            }],
        });
        expect(r.assets[0].verdict).toBe(ASSET_VERDICTS.LN2_RUNWAY_LOW);
        expect(r.assets[0].priority).toBe('P1');
    });

    test('LN2 dewar with long runway -> STABLE', function () {
        var r = makeAdvisor().evaluate({
            freezers: [{
                id: 'D4', kind: 'ln2_dewar', criticality: 3,
                ln2LevelPct: 95, ln2BoilOffPctPerDay: 1,
            }],
        });
        expect(r.assets[0].verdict).toBe(ASSET_VERDICTS.STABLE);
    });

    test('boil-off inferred from level history when not supplied', function () {
        var r = makeAdvisor().evaluate({
            freezers: [{
                id: 'D5', kind: 'ln2_dewar', criticality: 3,
                ln2LevelPct: 25,
                ln2LevelHistory: [
                    { ts: '2026-05-12T12:00:00Z', levelPct: 65 },
                    { ts: '2026-05-22T12:00:00Z', levelPct: 25 },
                ],
            }],
        });
        // (65-25)/10d = 4 pct/day; level 25 <= refill 30; headroom 25-15=10 -> 2.5d -> REFILL_NEEDED
        expect(r.assets[0].verdict).toBe(ASSET_VERDICTS.LN2_REFILL_NEEDED);
        expect(r.assets[0].details.projectedDaysToCritical).toBeGreaterThan(0);
    });

    test('excess door activity flagged', function () {
        var doors = [];
        for (var i = 0; i < 13; i++) {
            doors.push({ ts: '2026-05-22T11:' + (i < 10 ? '0' + i : i) + ':00Z', durationSec: 20 });
        }
        var r = makeAdvisor().evaluate({
            freezers: [{
                id: 'F4', kind: 'minus80', setpointC: -80, toleranceC: 5, criticality: 3,
                readings: [{ ts: '2026-05-22T12:00:00Z', tempC: -80 }],
                doorOpenEvents: doors,
            }],
        });
        var verdicts = r.assets[0].allVerdicts;
        // door budget is 180s, total = 260s, count 13
        expect(verdicts).toEqual(expect.arrayContaining([
            ASSET_VERDICTS.EXCESS_DOOR_TIME, ASSET_VERDICTS.FREQUENT_DOOR_OPEN
        ]));
    });

    test('stale sensor: no reading for >24h', function () {
        var r = makeAdvisor().evaluate({
            freezers: [{
                id: 'F5', kind: 'minus80', setpointC: -80, toleranceC: 5, criticality: 3,
                readings: [{ ts: '2026-05-20T12:00:00Z', tempC: -80 }], // 48h stale
            }],
        });
        expect(r.assets[0].allVerdicts).toContain(ASSET_VERDICTS.STALE_SENSOR);
    });

    test('insufficient data when freezer has nothing', function () {
        var r = makeAdvisor().evaluate({
            freezers: [{ id: 'F6', kind: 'minus80', setpointC: -80, criticality: 2 }],
        });
        expect(r.assets[0].verdict).toBe(ASSET_VERDICTS.INSUFFICIENT_DATA);
    });
});

describe('cryoChainIntegrityAdvisor - sample event classification', function () {
    test('exposure at >= 0C -> SAMPLE_LOST_TO_THAW (P0)', function () {
        var r = makeAdvisor().evaluate({
            sampleEvents: [{ id: 'E1', sampleId: 'V001', ts: NOW, kind: 'transport',
                durationSec: 600, exposedTempC: 4 }],
        });
        expect(r.sampleEvents[0].verdict).toBe(SAMPLE_VERDICTS.SAMPLE_LOST_TO_THAW);
        expect(r.sampleEvents[0].priority).toBe('P0');
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('QUARANTINE_THAWED_SAMPLES');
    });

    test('irreplaceable thaw forces F regardless of score', function () {
        var r = makeAdvisor().evaluate({
            sampleEvents: [{ id: 'E2', sampleId: 'M1', ts: NOW, kind: 'bench_exposure',
                durationSec: 60, exposedTempC: 2, irreplaceable: true }],
        });
        expect(r.grade).toBe('F');
        expect(r.insights).toContain('IRREPLACEABLE_SAMPLE_LOSS');
    });

    test('long bench exposure but cold -> SAMPLE_OVER_EXPOSED (P1)', function () {
        var r = makeAdvisor().evaluate({
            sampleEvents: [{ id: 'E3', sampleId: 'V003', ts: NOW, kind: 'bench_exposure',
                durationSec: 900, exposedTempC: -60 }],
        });
        expect(r.sampleEvents[0].verdict).toBe(SAMPLE_VERDICTS.SAMPLE_OVER_EXPOSED);
        expect(r.sampleEvents[0].priority).toBe('P1');
    });

    test('repeat handling within 24h promotes OK -> SAMPLE_REPEAT_HANDLING', function () {
        var r = makeAdvisor().evaluate({
            sampleEvents: [
                { id: 'E4a', sampleId: 'V004', ts: '2026-05-22T08:00:00Z', kind: 'thaw',
                    durationSec: 30, exposedTempC: -120 },
                { id: 'E4b', sampleId: 'V004', ts: '2026-05-22T10:00:00Z', kind: 'thaw',
                    durationSec: 40, exposedTempC: -120 },
                { id: 'E4c', sampleId: 'V004', ts: '2026-05-22T11:30:00Z', kind: 'thaw',
                    durationSec: 35, exposedTempC: -120 },
            ],
        });
        for (var i = 0; i < r.sampleEvents.length; i++) {
            expect(r.sampleEvents[i].verdict).toBe(SAMPLE_VERDICTS.SAMPLE_REPEAT_HANDLING);
        }
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('BATCH_REPEAT_HANDLING');
    });

    test('safe short cold exposure -> SAMPLE_OK', function () {
        var r = makeAdvisor().evaluate({
            sampleEvents: [{ id: 'E5', sampleId: 'V005', ts: NOW, kind: 'transfer',
                durationSec: 60, exposedTempC: -100 }],
        });
        expect(r.sampleEvents[0].verdict).toBe(SAMPLE_VERDICTS.SAMPLE_OK);
        expect(r.grade).toBe('A');
    });
});

describe('cryoChainIntegrityAdvisor - playbook / risk_appetite / insights', function () {
    test('aggressive appetite trims P3 fallback when P0/P1 exist', function () {
        var r = makeAdvisor({ risk_appetite: 'aggressive' }).evaluate({
            freezers: [{
                id: 'F7', kind: 'minus80', setpointC: -80, toleranceC: 5, criticality: 4,
                readings: [
                    { ts: '2026-05-22T11:00:00Z', tempC: -80 },
                    { ts: '2026-05-22T11:30:00Z', tempC: -55 },
                ],
            }],
        });
        var hasP3 = r.playbook.some(function (p) { return p.priority === 'P3'; });
        expect(hasP3).toBe(false);
    });

    test('cautious appetite at degraded grade appends SCHEDULE_COLD_CHAIN_AUDIT', function () {
        var r = makeAdvisor({ risk_appetite: 'cautious' }).evaluate({
            freezers: [{
                id: 'F8', kind: 'minus80', setpointC: -80, toleranceC: 5, criticality: 5,
                readings: [
                    { ts: '2026-05-22T11:00:00Z', tempC: -80 },
                    { ts: '2026-05-22T11:30:00Z', tempC: -55 },
                ],
            }],
        });
        var ids = r.playbook.map(function (p) { return p.id; });
        expect(ids).toContain('SCHEDULE_COLD_CHAIN_AUDIT');
    });

    test('clustered drift / heavy traffic insights', function () {
        var bigDoors = [];
        for (var i = 0; i < 13; i++) bigDoors.push({ ts: '2026-05-22T11:' + (i < 10 ? '0' + i : i) + ':00Z', durationSec: 20 });
        var r = makeAdvisor().evaluate({
            freezers: [
                {
                    id: 'A', kind: 'minus80', setpointC: -80, toleranceC: 5, criticality: 3,
                    readings: [
                        { ts: '2026-05-22T11:50:00Z', tempC: -73 },
                        { ts: '2026-05-22T11:55:00Z', tempC: -73 },
                        { ts: '2026-05-22T12:00:00Z', tempC: -73 },
                    ],
                },
                {
                    id: 'B', kind: 'minus80', setpointC: -80, toleranceC: 5, criticality: 3,
                    readings: [
                        { ts: '2026-05-22T11:50:00Z', tempC: -73 },
                        { ts: '2026-05-22T11:55:00Z', tempC: -73 },
                        { ts: '2026-05-22T12:00:00Z', tempC: -73 },
                    ],
                    doorOpenEvents: bigDoors,
                },
                {
                    id: 'C', kind: 'minus80', setpointC: -80, toleranceC: 5, criticality: 3,
                    readings: [{ ts: '2026-05-22T12:00:00Z', tempC: -80 }],
                    doorOpenEvents: bigDoors,
                },
            ],
        });
        expect(r.insights).toEqual(expect.arrayContaining(['CLUSTERED_TEMP_DRIFT', 'HEAVY_FREEZER_TRAFFIC']));
    });
});

describe('cryoChainIntegrityAdvisor - formatters and immutability', function () {
    var input = {
        freezers: [{
            id: 'F9', kind: 'minus80', setpointC: -80, toleranceC: 5, criticality: 3,
            readings: [{ ts: '2026-05-22T11:00:00Z', tempC: -80 }],
        }],
        sampleEvents: [{ id: 'E9', sampleId: 'V9', ts: NOW, kind: 'transfer',
            durationSec: 30, exposedTempC: -120 }],
    };
    var snapshot = JSON.stringify(input);

    test('formatters return strings with expected sections', function () {
        var a = makeAdvisor();
        var r = a.evaluate(input);
        var txt = a.formatText(r);
        var md = a.formatMarkdown(r);
        var js = a.formatJson(r);
        expect(typeof txt).toBe('string');
        expect(txt).toContain('CryoChainIntegrityAdvisor');
        expect(md).toContain('## Summary');
        expect(md).toContain('## Assets');
        expect(md).toContain('## Sample events');
        expect(md).toContain('## Playbook');
        expect(md).toContain('## Insights');
        expect(function () { JSON.parse(js); }).not.toThrow();
    });

    test('formatJson is byte-stable across calls', function () {
        var a = makeAdvisor();
        var r1 = a.evaluate(input);
        var r2 = a.evaluate(input);
        expect(a.formatJson(r1)).toBe(a.formatJson(r2));
    });

    test('input is never mutated', function () {
        var a = makeAdvisor();
        a.evaluate(input);
        expect(JSON.stringify(input)).toBe(snapshot);
    });

    test('throws when now() returns invalid date', function () {
        var bad = createCryoChainIntegrityAdvisor({ now: function () { return new Date('not-a-date'); } });
        expect(function () { bad.evaluate(); }).toThrow();
    });
});

describe('cryoChainIntegrityAdvisor - SDK manifest exposure', function () {
    test('lazy-loaded via index.js', function () {
        var biobots = require('../index.js');
        expect(typeof biobots.createCryoChainIntegrityAdvisor).toBe('function');
        var advisor = biobots.createCryoChainIntegrityAdvisor({ now: fixedNow(NOW) });
        var r = advisor.evaluate();
        expect(r.grade).toBe('A');
    });
});
