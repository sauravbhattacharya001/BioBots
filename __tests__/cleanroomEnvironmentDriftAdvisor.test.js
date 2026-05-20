'use strict';

const { createCleanroomEnvironmentDriftAdvisor, VERDICTS } =
    require('../docs/shared/cleanroomEnvironmentDriftAdvisor');

const FIXED_NOW = new Date('2026-05-20T20:00:00Z');
function nowFn() { return FIXED_NOW; }

function makeAdvisor(opts = {}) {
    return createCleanroomEnvironmentDriftAdvisor(Object.assign({ now: nowFn }, opts));
}

function healthyZone(id = 'Z1', overrides = {}) {
    return Object.assign({
        id, name: 'Suite ' + id, isoClass: 7, role: 'process',
        samples: [
            { ts: '2026-05-19T22:00:00Z', temperatureC: 21, humidityPct: 50, particles05umPerM3: 100000, particles5umPerM3: 500, diffPressurePa: 15 },
            { ts: '2026-05-19T23:00:00Z', temperatureC: 21, humidityPct: 50, particles05umPerM3: 110000, particles5umPerM3: 520, diffPressurePa: 15 },
            { ts: '2026-05-20T00:00:00Z', temperatureC: 21, humidityPct: 50, particles05umPerM3: 105000, particles5umPerM3: 510, diffPressurePa: 15 },
            { ts: '2026-05-20T01:00:00Z', temperatureC: 21, humidityPct: 50, particles05umPerM3: 108000, particles5umPerM3: 515, diffPressurePa: 15 },
        ],
    }, overrides);
}

describe('createCleanroomEnvironmentDriftAdvisor', () => {
    test('rejects invalid riskAppetite at construction', () => {
        expect(() => createCleanroomEnvironmentDriftAdvisor({ riskAppetite: 'reckless' }))
            .toThrow(/riskAppetite/);
    });

    test('empty zone list -> grade A, NO_ZONES_PROVIDED, IN_CONTROL fallback action', () => {
        const advisor = makeAdvisor();
        const report = advisor.evaluate({ zones: [] });
        expect(report.grade).toBe('A');
        expect(report.zoneCount).toBe(0);
        expect(report.portfolioRisk).toBe(0);
        expect(report.portfolioBand).toBe('CALM');
        expect(report.insights).toContain('NO_ZONES_PROVIDED');
        expect(report.playbook.some(a => a.id === 'ENVIRONMENT_IN_CONTROL')).toBe(true);
        expect(report.generatedAt).toBe('2026-05-20T20:00:00.000Z');
    });

    test('healthy zone -> IN_CONTROL / P3, grade A', () => {
        const advisor = makeAdvisor();
        const r = advisor.evaluate({ zones: [healthyZone()] });
        expect(r.zones[0].verdict).toBe(VERDICTS.IN_CONTROL);
        expect(r.zones[0].priority).toBe('P3');
        expect(r.grade).toBe('A');
        expect(r.insights).toContain('ENVIRONMENT_STABLE');
    });

    test('pressure inversion in aseptic zone forces F grade and HOLD_BATCHES floor', () => {
        const advisor = makeAdvisor();
        const r = advisor.evaluate({
            zones: [{
                id: 'Z2', name: 'Aseptic Fill', isoClass: 5, role: 'aseptic',
                hasOpenActivity: true, batchIds: ['B1', 'B2'],
                samples: [
                    { ts: '2026-05-19T22:00:00Z', temperatureC: 22, humidityPct: 55, particles05umPerM3: 50000, particles5umPerM3: 200, diffPressurePa: -2 },
                    { ts: '2026-05-19T23:00:00Z', temperatureC: 22, humidityPct: 56, particles05umPerM3: 80000, particles5umPerM3: 400, diffPressurePa: -1 },
                ],
            }],
        });
        expect(r.grade).toBe('F');
        const z = r.zones[0];
        // Either HOLD_BATCHES (the floor) or harsher; never WATCH/IN_CONTROL
        const idx = (v) => ['SHUT_DOWN', 'QUARANTINE_AND_REVALIDATE', 'HOLD_BATCHES'].indexOf(v);
        expect(idx(z.verdict) >= 0).toBe(true);
        expect(r.insights).toContain('PRESSURE_CASCADE_BROKEN');
        expect(r.insights).toContain('ASEPTIC_ZONE_AT_RISK');
        // Must surface batch hold action and rebalance.
        const ids = r.playbook.map(a => a.id);
        expect(ids).toContain('HOLD_DOWNSTREAM_BATCHES');
        expect(ids).toContain('REBALANCE_AIR_HANDLING');
        // HOLD_DOWNSTREAM_BATCHES carries the batch ids
        const hold = r.playbook.find(a => a.id === 'HOLD_DOWNSTREAM_BATCHES');
        expect(hold.batchIds).toEqual(expect.arrayContaining(['B1', 'B2']));
    });

    test('severe particle exceedance with open activity -> at least QUARANTINE_AND_REVALIDATE', () => {
        const advisor = makeAdvisor();
        const r = advisor.evaluate({
            zones: [{
                id: 'Z3', isoClass: 5, role: 'aseptic', hasOpenActivity: true, batchIds: ['B9'],
                samples: [{
                    ts: '2026-05-19T22:00:00Z', temperatureC: 23, humidityPct: 55,
                    particles05umPerM3: 9999999, particles5umPerM3: 99999, diffPressurePa: 15,
                }],
            }],
        });
        const idx = (v) => ['SHUT_DOWN', 'QUARANTINE_AND_REVALIDATE'].indexOf(v);
        expect(idx(r.zones[0].verdict) >= 0).toBe(true);
        expect(r.grade).toBe('F');
        expect(r.insights).not.toContain('PARTICLE_EXCURSION_CLUSTER'); // single zone, not cluster
    });

    test('multiple particle excursions surface PARTICLE_EXCURSION_CLUSTER + HEPA sweep action', () => {
        const advisor = makeAdvisor();
        const r = advisor.evaluate({
            zones: [
                {
                    id: 'A', isoClass: 7, role: 'process',
                    samples: [{ ts: '2026-05-19T22:00:00Z', temperatureC: 21, humidityPct: 50, particles05umPerM3: 400000, particles5umPerM3: 3200, diffPressurePa: 15 }],
                },
                {
                    id: 'B', isoClass: 7, role: 'process',
                    samples: [{ ts: '2026-05-19T22:00:00Z', temperatureC: 21, humidityPct: 50, particles05umPerM3: 400000, particles5umPerM3: 3200, diffPressurePa: 15 }],
                },
            ],
        });
        expect(r.insights).toContain('PARTICLE_EXCURSION_CLUSTER');
        expect(r.playbook.some(a => a.id === 'SCHEDULE_HEPA_SWEEP')).toBe(true);
    });

    test('missing pressure telemetry surfaces PRESSURE_NOT_MONITORED and INSTRUMENT action', () => {
        const advisor = makeAdvisor();
        const r = advisor.evaluate({
            zones: [{
                id: 'NP', isoClass: 7, role: 'process',
                samples: [{ ts: '2026-05-19T22:00:00Z', temperatureC: 21, humidityPct: 50, particles05umPerM3: 100000, particles5umPerM3: 500 }],
            }],
        });
        const codes = r.zones[0].reasons.map(x => x.code);
        expect(codes).toContain('PRESSURE_NOT_MONITORED');
        expect(r.playbook.some(a => a.id === 'INSTRUMENT_PRESSURE_SENSORS')).toBe(true);
    });

    test('cautious appetite raises severity vs aggressive (monotonic)', () => {
        const zones = [{
            id: 'M', isoClass: 7, role: 'process',
            samples: [
                { ts: '2026-05-19T22:00:00Z', temperatureC: 26.5, humidityPct: 72, particles05umPerM3: 320000, particles5umPerM3: 2500, diffPressurePa: 6 },
                { ts: '2026-05-19T23:00:00Z', temperatureC: 26.5, humidityPct: 72, particles05umPerM3: 330000, particles5umPerM3: 2600, diffPressurePa: 6 },
            ],
        }];
        const rc = createCleanroomEnvironmentDriftAdvisor({ now: nowFn, riskAppetite: 'cautious' }).evaluate({ zones });
        const rb = createCleanroomEnvironmentDriftAdvisor({ now: nowFn, riskAppetite: 'balanced' }).evaluate({ zones });
        const ra = createCleanroomEnvironmentDriftAdvisor({ now: nowFn, riskAppetite: 'aggressive' }).evaluate({ zones });
        expect(rc.portfolioRisk).toBeGreaterThanOrEqual(rb.portfolioRisk);
        expect(rb.portfolioRisk).toBeGreaterThanOrEqual(ra.portfolioRisk);
    });

    test('aggressive trims P3 ENVIRONMENT_IN_CONTROL when P0/P1 present', () => {
        const advisor = createCleanroomEnvironmentDriftAdvisor({ now: nowFn, riskAppetite: 'aggressive' });
        const r = advisor.evaluate({
            zones: [{
                id: 'X', isoClass: 5, role: 'aseptic', hasOpenActivity: true, batchIds: ['B1'],
                samples: [{ ts: '2026-05-19T22:00:00Z', temperatureC: 22, humidityPct: 55, particles05umPerM3: 9999999, particles5umPerM3: 99999, diffPressurePa: -5 }],
            }],
        });
        expect(r.playbook.every(a => a.id !== 'ENVIRONMENT_IN_CONTROL')).toBe(true);
    });

    test('simulate(applyTop=3) reduces projected risk via diminishing returns', () => {
        const advisor = makeAdvisor();
        const input = {
            zones: [{
                id: 'S', isoClass: 5, role: 'aseptic', hasOpenActivity: true, batchIds: ['B1'],
                samples: [{ ts: '2026-05-19T22:00:00Z', temperatureC: 30, humidityPct: 80, particles05umPerM3: 9999999, particles5umPerM3: 99999, diffPressurePa: -3 }],
            }],
        };
        const sim = advisor.simulate(input, { applyTop: 3 });
        expect(sim.projectedRisk).toBeLessThan(sim.baselineRisk);
        expect(sim.appliedActions.length).toBeGreaterThan(0);
        expect(sim.projectedRisk).toBeGreaterThanOrEqual(0);
    });

    test('formatJson is byte-stable across runs and sorted-keys deterministic', () => {
        const advisor = makeAdvisor();
        const input = { zones: [healthyZone('Q1'), healthyZone('Q2')] };
        const j1 = advisor.formatJson(advisor.evaluate(input));
        const j2 = advisor.formatJson(advisor.evaluate(input));
        expect(j1).toBe(j2);
        // top-level keys appear in sorted order
        const lines = j1.split('\n').slice(0, 20).join('\n');
        const a = lines.indexOf('"generatedAt"');
        const b = lines.indexOf('"grade"');
        const c = lines.indexOf('"insights"');
        expect(a).toBeLessThan(b);
        expect(b).toBeLessThan(c);
    });

    test('formatMarkdown always emits required sections', () => {
        const advisor = makeAdvisor();
        const md = advisor.formatMarkdown(advisor.evaluate({ zones: [healthyZone()] }));
        expect(md).toMatch(/^# Cleanroom Environment Drift Report/);
        expect(md).toMatch(/## Zones/);
        expect(md).toMatch(/## Playbook/);
        expect(md).toMatch(/## Insights/);
    });

    test('never mutates input zones', () => {
        const advisor = makeAdvisor();
        const input = {
            zones: [{
                id: 'IM', isoClass: 7, role: 'process',
                batchIds: ['BB'],
                samples: [{ ts: '2026-05-19T22:00:00Z', temperatureC: 22, humidityPct: 50, particles05umPerM3: 100000, particles5umPerM3: 500, diffPressurePa: 15 }],
            }],
            context: { recentContaminationEvents: 1 },
        };
        const before = JSON.stringify(input);
        advisor.evaluate(input);
        advisor.simulate(input, { applyTop: 2 });
        expect(JSON.stringify(input)).toBe(before);
    });
});
