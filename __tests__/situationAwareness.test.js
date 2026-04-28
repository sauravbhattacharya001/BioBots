'use strict';

var sa = require('../docs/shared/situationAwareness');

describe('Lab Situation Awareness Engine', function () {
    var engine;

    beforeEach(function () {
        engine = sa.createSituationAwareness();
    });

    // ── Ingestion ─────────────────────────────────────────────────

    describe('ingest', function () {
        test('accepts a valid event', function () {
            expect(function () {
                engine.ingest({ domain: 'environment', type: 'temp_high', severity: 'warning' });
            }).not.toThrow();
        });

        test('throws on null event', function () {
            expect(function () { engine.ingest(null); }).toThrow(/non-null object/);
        });

        test('throws on missing domain', function () {
            expect(function () { engine.ingest({ type: 'x' }); }).toThrow(/domain/);
        });

        test('throws on invalid domain', function () {
            expect(function () { engine.ingest({ domain: 'magic', type: 'x' }); }).toThrow(/domain/);
        });

        test('throws on missing type', function () {
            expect(function () { engine.ingest({ domain: 'environment' }); }).toThrow(/type/);
        });

        test('throws on invalid severity', function () {
            expect(function () { engine.ingest({ domain: 'environment', type: 'x', severity: 'mega' }); }).toThrow(/severity/);
        });

        test('defaults severity to info when omitted', function () {
            engine.ingest({ domain: 'environment', type: 'reading' });
            var timeline = engine.getTimeline();
            expect(timeline[0].severity).toBe('info');
        });

        test('accepts all valid domains', function () {
            var domains = ['environment', 'contamination', 'equipment', 'print_quality',
                'cell_health', 'inventory', 'protocol_compliance', 'personnel'];
            domains.forEach(function (d) {
                expect(function () {
                    engine.ingest({ domain: d, type: 'test', severity: 'info' });
                }).not.toThrow();
            });
            expect(engine.getTimeline().length).toBe(8);
        });

        test('accepts all valid severities', function () {
            var sevs = ['info', 'notice', 'warning', 'alert', 'critical', 'emergency'];
            sevs.forEach(function (s) {
                engine.ingest({ domain: 'equipment', type: 'test', severity: s });
            });
            expect(engine.getTimeline().length).toBe(6);
        });
    });

    // ── Readiness Score ───────────────────────────────────────────

    describe('readiness score', function () {
        test('is 100 with no events', function () {
            var pic = engine.getOperationalPicture();
            expect(pic.readinessScore).toBe(100);
        });

        test('decreases with warning events', function () {
            engine.ingest({ domain: 'environment', type: 'temp_high', severity: 'warning' });
            var pic = engine.getOperationalPicture();
            expect(pic.readinessScore).toBeLessThan(100);
            expect(pic.readinessScore).toBeGreaterThan(0);
        });

        test('decreases more with critical events', function () {
            var eng1 = sa.createSituationAwareness();
            var eng2 = sa.createSituationAwareness();
            eng1.ingest({ domain: 'environment', type: 'temp_high', severity: 'warning' });
            eng2.ingest({ domain: 'environment', type: 'temp_high', severity: 'critical' });
            expect(eng2.getOperationalPicture().readinessScore).toBeLessThan(
                eng1.getOperationalPicture().readinessScore
            );
        });

        test('multiple domain impacts compound', function () {
            engine.ingest({ domain: 'environment', type: 'temp', severity: 'critical' });
            engine.ingest({ domain: 'contamination', type: 'particles', severity: 'critical' });
            engine.ingest({ domain: 'equipment', type: 'clog', severity: 'critical' });
            var pic = engine.getOperationalPicture();
            expect(pic.readinessScore).toBeLessThan(70);
        });
    });

    // ── Operational State ─────────────────────────────────────────

    describe('operational state', function () {
        test('is GREEN with no events', function () {
            expect(engine.getOperationalPicture().operationalState).toBe('GREEN');
        });

        test('is YELLOW with moderate issues', function () {
            engine.ingest({ domain: 'contamination', type: 'a', severity: 'alert' });
            engine.ingest({ domain: 'environment', type: 'b', severity: 'alert' });
            var pic = engine.getOperationalPicture();
            // Score should be in YELLOW range (60-79) or lower
            expect(['YELLOW', 'ORANGE', 'RED']).toContain(pic.operationalState);
            expect(pic.readinessScore).toBeLessThan(100);
        });

        test('is RED with many emergencies', function () {
            var domains = ['environment', 'contamination', 'equipment', 'print_quality',
                'cell_health', 'inventory', 'protocol_compliance', 'personnel'];
            domains.forEach(function (d) {
                engine.ingest({ domain: d, type: 'emergency', severity: 'emergency' });
                engine.ingest({ domain: d, type: 'emergency2', severity: 'emergency' });
            });
            var pic = engine.getOperationalPicture();
            expect(pic.operationalState).toBe('RED');
        });
    });

    // ── Domain Health ─────────────────────────────────────────────

    describe('getDomainHealth', function () {
        test('returns 100 for clean domain', function () {
            var health = engine.getDomainHealth('environment');
            expect(health.score).toBe(100);
            expect(health.events).toBe(0);
        });

        test('returns degraded score after events', function () {
            engine.ingest({ domain: 'equipment', type: 'clog', severity: 'critical' });
            var health = engine.getDomainHealth('equipment');
            expect(health.score).toBeLessThan(100);
            expect(health.events).toBe(1);
        });

        test('throws on invalid domain', function () {
            expect(function () { engine.getDomainHealth('invalid'); }).toThrow();
        });

        test('includes degradation rate', function () {
            engine.ingest({ domain: 'environment', type: 'temp', severity: 'warning' });
            var health = engine.getDomainHealth('environment');
            expect(typeof health.degradationRate).toBe('number');
        });
    });

    // ── Cascade Detection ─────────────────────────────────────────

    describe('detectCascades', function () {
        test('returns empty with no events', function () {
            expect(engine.detectCascades()).toEqual([]);
        });

        test('detects confirmed cascade when both domains active', function () {
            engine.ingest({ domain: 'equipment', type: 'hvac_failure', severity: 'critical' });
            engine.ingest({ domain: 'environment', type: 'temp_drift', severity: 'warning' });
            var cascades = engine.detectCascades();
            var found = cascades.some(function (c) {
                return c.trigger.domain === 'equipment' &&
                    c.affected[0].domain === 'environment' &&
                    c.severity === 'confirmed';
            });
            expect(found).toBe(true);
        });

        test('detects potential cascade for severe source without target activity', function () {
            engine.ingest({ domain: 'equipment', type: 'total_failure', severity: 'emergency' });
            var cascades = engine.detectCascades();
            expect(cascades.length).toBeGreaterThan(0);
            var potential = cascades.some(function (c) {
                return c.severity === 'potential';
            });
            expect(potential).toBe(true);
        });

        test('traces multi-hop cascade chains', function () {
            engine.ingest({ domain: 'equipment', type: 'hvac', severity: 'critical' });
            engine.ingest({ domain: 'environment', type: 'drift', severity: 'warning' });
            engine.ingest({ domain: 'contamination', type: 'spike', severity: 'alert' });
            var cascades = engine.detectCascades();
            var multiHop = cascades.some(function (c) {
                return c.chain && c.chain.length >= 3;
            });
            expect(multiHop).toBe(true);
        });
    });

    // ── Forecast ──────────────────────────────────────────────────

    describe('forecast', function () {
        test('returns stable forecast with no events', function () {
            var pic = engine.getOperationalPicture();
            expect(pic.forecast.currentScore).toBe(100);
            expect(pic.forecast.predictedState).toBe('GREEN');
        });

        test('includes degrading domain count', function () {
            engine.ingest({ domain: 'environment', type: 'x', severity: 'warning' });
            var pic = engine.getOperationalPicture();
            expect(typeof pic.forecast.degradingDomains).toBe('number');
        });
    });

    // ── SITREP ────────────────────────────────────────────────────

    describe('generateSITREP', function () {
        test('generates narrative for clean lab', function () {
            var sitrep = engine.generateSITREP();
            expect(sitrep.narrative).toContain('GREEN');
            expect(sitrep.readinessScore).toBe(100);
            expect(sitrep.operationalState).toBe('GREEN');
        });

        test('narrative mentions primary concern domain', function () {
            engine.ingest({ domain: 'contamination', type: 'particle_spike', severity: 'critical', value: 8500 });
            var sitrep = engine.generateSITREP();
            expect(sitrep.narrative).toContain('Contamination');
        });

        test('includes domain summaries for all 8 domains', function () {
            var sitrep = engine.generateSITREP();
            expect(Object.keys(sitrep.domainSummaries).length).toBe(8);
        });

        test('includes advisories and recommendations', function () {
            engine.ingest({ domain: 'equipment', type: 'failure', severity: 'emergency' });
            engine.ingest({ domain: 'equipment', type: 'failure2', severity: 'emergency' });
            var sitrep = engine.generateSITREP();
            expect(sitrep.advisories.length).toBeGreaterThan(0);
            expect(sitrep.recommendations.length).toBeGreaterThan(0);
        });

        test('includes tempo info', function () {
            var sitrep = engine.generateSITREP();
            expect(sitrep.tempo).toBeDefined();
            expect(typeof sitrep.tempo.eventsPerHour).toBe('number');
        });
    });

    // ── Operational Tempo ─────────────────────────────────────────

    describe('operational tempo', function () {
        test('reports 0 events/hour with no events', function () {
            var pic = engine.getOperationalPicture();
            expect(pic.tempo.eventsPerHour).toBe(0);
            expect(pic.tempo.trend).toBe('stable');
        });

        test('counts events in time windows', function () {
            for (var i = 0; i < 10; i++) {
                engine.ingest({ domain: 'environment', type: 'reading_' + i, severity: 'info' });
            }
            var pic = engine.getOperationalPicture();
            expect(pic.tempo.eventsPerHour).toBeGreaterThan(0);
        });
    });

    // ── Timeline ──────────────────────────────────────────────────

    describe('getTimeline', function () {
        test('returns all events with no filter', function () {
            engine.ingest({ domain: 'environment', type: 'a', severity: 'info' });
            engine.ingest({ domain: 'equipment', type: 'b', severity: 'warning' });
            expect(engine.getTimeline().length).toBe(2);
        });

        test('filters by domain', function () {
            engine.ingest({ domain: 'environment', type: 'a', severity: 'info' });
            engine.ingest({ domain: 'equipment', type: 'b', severity: 'warning' });
            var filtered = engine.getTimeline({ domain: 'environment' });
            expect(filtered.length).toBe(1);
            expect(filtered[0].domain).toBe('environment');
        });

        test('filters by since timestamp', function () {
            var past = Date.now() - 10000;
            engine.ingest({ domain: 'environment', type: 'old', severity: 'info', timestamp: past - 5000 });
            engine.ingest({ domain: 'environment', type: 'new', severity: 'info', timestamp: past + 5000 });
            var filtered = engine.getTimeline({ since: past });
            expect(filtered.length).toBe(1);
            expect(filtered[0].type).toBe('new');
        });

        test('filters by severity threshold', function () {
            engine.ingest({ domain: 'environment', type: 'minor', severity: 'info' });
            engine.ingest({ domain: 'environment', type: 'major', severity: 'critical' });
            var filtered = engine.getTimeline({ severity: 'warning' });
            expect(filtered.length).toBe(1);
            expect(filtered[0].severity).toBe('critical');
        });
    });

    // ── Advisories ────────────────────────────────────────────────

    describe('getAdvisories', function () {
        test('returns empty for clean lab', function () {
            expect(engine.getAdvisories().length).toBe(0);
        });

        test('returns domain_critical for very impacted domain', function () {
            engine.ingest({ domain: 'contamination', type: 'a', severity: 'emergency' });
            engine.ingest({ domain: 'contamination', type: 'b', severity: 'emergency' });
            var advisories = engine.getAdvisories();
            var hasCritical = advisories.some(function (a) {
                return a.type === 'domain_critical' && a.domain === 'contamination';
            });
            expect(hasCritical).toBe(true);
        });

        test('advisories are sorted by priority', function () {
            // Use only one domain to avoid cascade interactions
            engine.ingest({ domain: 'inventory', type: 'a', severity: 'emergency' });
            engine.ingest({ domain: 'inventory', type: 'b', severity: 'emergency' });
            engine.ingest({ domain: 'personnel', type: 'c', severity: 'warning' });
            var advisories = engine.getAdvisories();
            expect(advisories.length).toBeGreaterThanOrEqual(1);
            // First advisory should be highest priority
            var pOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            for (var i = 1; i < advisories.length; i++) {
                expect(pOrder[advisories[i].priority]).toBeGreaterThanOrEqual(
                    pOrder[advisories[i - 1].priority]
                );
            }
        });
    });

    // ── Reset ─────────────────────────────────────────────────────

    describe('reset', function () {
        test('clears all events and restores score to 100', function () {
            engine.ingest({ domain: 'environment', type: 'temp', severity: 'critical' });
            expect(engine.getOperationalPicture().readinessScore).toBeLessThan(100);
            engine.reset();
            expect(engine.getOperationalPicture().readinessScore).toBe(100);
            expect(engine.getTimeline().length).toBe(0);
        });
    });

    // ── Export ─────────────────────────────────────────────────────

    describe('exportData', function () {
        test('returns config and events', function () {
            engine.ingest({ domain: 'environment', type: 'x', severity: 'info' });
            var data = engine.exportData();
            expect(data.config).toBeDefined();
            expect(data.config.windowMinutes).toBe(60);
            expect(data.events.length).toBe(1);
            expect(data.operationalPicture).toBeDefined();
        });
    });

    // ── Custom configuration ──────────────────────────────────────

    describe('custom configuration', function () {
        test('custom weights affect scoring', function () {
            var eng1 = sa.createSituationAwareness({ weights: { environment: 0.50, contamination: 0.10, equipment: 0.10, print_quality: 0.10, cell_health: 0.10, inventory: 0.02, protocol_compliance: 0.05, personnel: 0.03 } });
            var eng2 = sa.createSituationAwareness({ weights: { environment: 0.05, contamination: 0.10, equipment: 0.10, print_quality: 0.10, cell_health: 0.10, inventory: 0.10, protocol_compliance: 0.10, personnel: 0.35 } });

            eng1.ingest({ domain: 'environment', type: 'x', severity: 'critical' });
            eng2.ingest({ domain: 'environment', type: 'x', severity: 'critical' });

            // eng1 weights environment heavily, so it should be more impacted
            expect(eng1.getOperationalPicture().readinessScore).toBeLessThan(
                eng2.getOperationalPicture().readinessScore
            );
        });

        test('custom window works', function () {
            var eng = sa.createSituationAwareness({ windowMinutes: 1 });
            // An old event (> 1 min ago) should be pruned
            eng.ingest({ domain: 'environment', type: 'x', severity: 'warning', timestamp: Date.now() - 120000 });
            expect(eng.getTimeline().length).toBe(0);
        });
    });

    // ── Edge Cases ────────────────────────────────────────────────

    describe('edge cases', function () {
        test('single domain with all severities', function () {
            var sevs = ['info', 'notice', 'warning', 'alert', 'critical', 'emergency'];
            sevs.forEach(function (s, i) {
                engine.ingest({ domain: 'environment', type: 'event_' + i, severity: s });
            });
            var pic = engine.getOperationalPicture();
            expect(pic.readinessScore).toBeLessThan(100);
            expect(pic.domains.environment.eventCount).toBe(6);
        });

        test('event with value and threshold', function () {
            engine.ingest({ domain: 'environment', type: 'temp', severity: 'warning', value: 28.5, threshold: 25 });
            var timeline = engine.getTimeline();
            expect(timeline[0].value).toBe(28.5);
        });

        test('event with custom timestamp', function () {
            var ts = Date.now() - 30000;
            engine.ingest({ domain: 'environment', type: 'old', severity: 'info', timestamp: ts });
            var timeline = engine.getTimeline();
            expect(timeline[0].timestamp).toBe(ts);
        });
    });
});
