'use strict';

var mod = require('../docs/shared/incidentReplay');

describe('Lab Incident Replay Engine', function () {
    var engine;

    beforeEach(function () {
        engine = mod.createIncidentReplay();
    });

    // ── Factory ────────────────────────────────────────────────────

    describe('createIncidentReplay', function () {
        it('returns an object with expected API methods', function () {
            expect(typeof engine.addEvidence).toBe('function');
            expect(typeof engine.loadEvidence).toBe('function');
            expect(typeof engine.getTimeline).toBe('function');
            expect(typeof engine.investigate).toBe('function');
            expect(typeof engine.registerPattern).toBe('function');
            expect(typeof engine.reset).toBe('function');
        });
    });

    // ── Evidence Ingestion ─────────────────────────────────────────

    describe('addEvidence', function () {
        it('adds valid evidence', function () {
            var result = engine.addEvidence({
                source: 'print_log',
                timestamp: '2026-04-28T14:00:00Z',
                type: 'parameter_change',
                data: { parameter: 'temperature', value: 42, unit: 'C' }
            });
            expect(result.added).toBe(true);
            expect(result.id).toBe(1);
        });

        it('increments IDs for multiple evidence items', function () {
            engine.addEvidence({ source: 'print_log', timestamp: '2026-04-28T14:00:00Z', type: 'a' });
            var r2 = engine.addEvidence({ source: 'quality', timestamp: '2026-04-28T14:01:00Z', type: 'b' });
            expect(r2.id).toBe(2);
        });

        it('rejects evidence without timestamp', function () {
            var result = engine.addEvidence({ source: 'print_log', type: 'a' });
            expect(result.added).toBe(false);
            expect(result.reason).toContain('timestamp');
        });

        it('rejects evidence with invalid timestamp', function () {
            var result = engine.addEvidence({ source: 'print_log', timestamp: 'not-a-date', type: 'a' });
            expect(result.added).toBe(false);
        });

        it('rejects null evidence', function () {
            var result = engine.addEvidence(null);
            expect(result.added).toBe(false);
        });

        it('rejects array evidence', function () {
            var result = engine.addEvidence([1, 2, 3]);
            expect(result.added).toBe(false);
        });

        it('rejects evidence without source', function () {
            var result = engine.addEvidence({ timestamp: '2026-04-28T14:00:00Z', type: 'a' });
            expect(result.added).toBe(false);
            expect(result.reason).toContain('source');
        });

        it('rejects evidence with dangerous source key', function () {
            var result = engine.addEvidence({ source: '__proto__', timestamp: '2026-04-28T14:00:00Z', type: 'a' });
            expect(result.added).toBe(false);
            expect(result.reason).toContain('Dangerous');
        });

        it('rejects evidence with dangerous type key', function () {
            var result = engine.addEvidence({ source: 'print_log', timestamp: '2026-04-28T14:00:00Z', type: 'constructor' });
            expect(result.added).toBe(false);
            expect(result.reason).toContain('Dangerous');
        });

        it('rejects evidence with dangerous data key', function () {
            var result = engine.addEvidence({
                source: 'print_log', timestamp: '2026-04-28T14:00:00Z', type: 'a',
                data: { 'constructor': 'bad' }
            });
            expect(result.added).toBe(false);
            expect(result.reason).toContain('Dangerous');
        });

        it('accepts evidence with numeric timestamp', function () {
            var result = engine.addEvidence({ source: 'print_log', timestamp: 1714305600000, type: 'a' });
            expect(result.added).toBe(true);
        });

        it('accepts evidence without type (defaults to unknown)', function () {
            engine.addEvidence({ source: 'print_log', timestamp: '2026-04-28T14:00:00Z' });
            var tl = engine.getTimeline();
            expect(tl[0].type).toBe('unknown');
        });

        it('accepts evidence without data', function () {
            var result = engine.addEvidence({ source: 'print_log', timestamp: '2026-04-28T14:00:00Z', type: 'a' });
            expect(result.added).toBe(true);
        });
    });

    // ── Load Evidence (bulk) ───────────────────────────────────────

    describe('loadEvidence', function () {
        it('loads multiple valid items', function () {
            var result = engine.loadEvidence([
                { source: 'print_log', timestamp: '2026-04-28T14:00:00Z', type: 'a' },
                { source: 'quality', timestamp: '2026-04-28T14:01:00Z', type: 'b' },
                { source: 'equipment', timestamp: '2026-04-28T14:02:00Z', type: 'c' }
            ]);
            expect(result.loaded).toBe(3);
            expect(result.errors.length).toBe(0);
        });

        it('reports errors for invalid items', function () {
            var result = engine.loadEvidence([
                { source: 'print_log', timestamp: '2026-04-28T14:00:00Z', type: 'a' },
                { source: 'bad' }, // missing timestamp
                { source: 'quality', timestamp: '2026-04-28T14:01:00Z', type: 'b' }
            ]);
            expect(result.loaded).toBe(2);
            expect(result.errors.length).toBe(1);
            expect(result.errors[0]).toContain('Item 1');
        });

        it('rejects non-array input', function () {
            var result = engine.loadEvidence('not an array');
            expect(result.loaded).toBe(0);
            expect(result.errors[0]).toContain('array');
        });
    });

    // ── Timeline ───────────────────────────────────────────────────

    describe('getTimeline', function () {
        it('returns events in chronological order', function () {
            engine.addEvidence({ source: 'quality', timestamp: '2026-04-28T15:00:00Z', type: 'b' });
            engine.addEvidence({ source: 'print_log', timestamp: '2026-04-28T14:00:00Z', type: 'a' });
            engine.addEvidence({ source: 'equipment', timestamp: '2026-04-28T14:30:00Z', type: 'c' });
            var tl = engine.getTimeline();
            expect(tl.length).toBe(3);
            expect(tl[0].type).toBe('a');
            expect(tl[1].type).toBe('c');
            expect(tl[2].type).toBe('b');
        });

        it('returns empty array when no evidence', function () {
            expect(engine.getTimeline()).toEqual([]);
        });

        it('includes all evidence fields', function () {
            engine.addEvidence({
                source: 'print_log', timestamp: '2026-04-28T14:00:00Z',
                type: 'reading', data: { value: 42 }, description: 'test desc'
            });
            var tl = engine.getTimeline();
            expect(tl[0].source).toBe('print_log');
            expect(tl[0].type).toBe('reading');
            expect(tl[0].data.value).toBe(42);
            expect(tl[0].description).toBe('test desc');
        });
    });

    // ── Investigation (full) ───────────────────────────────────────

    describe('investigate', function () {
        function loadScenario() {
            engine.loadEvidence([
                { source: 'environmental', timestamp: '2026-04-28T13:50:00Z', type: 'reading', data: { metric: 'temperature', value: 37, unit: 'C' } },
                { source: 'environmental', timestamp: '2026-04-28T14:00:00Z', type: 'reading', data: { metric: 'temperature', value: 42, unit: 'C' } },
                { source: 'environmental', timestamp: '2026-04-28T14:05:00Z', type: 'reading', data: { metric: 'humidity', value: 85, unit: '%' } },
                { source: 'print_log', timestamp: '2026-04-28T14:10:00Z', type: 'parameter_change', data: { parameter: 'temperature', value: 42 } },
                { source: 'contamination', timestamp: '2026-04-28T14:15:00Z', type: 'alert', data: { type: 'colony', count: 3 }, description: 'Colony detected on plate' },
                { source: 'quality', timestamp: '2026-04-28T14:30:00Z', type: 'excursion', data: { metric: 'cell_viability', value: 62, expected: 95, unit: '%' } },
                { source: 'operator', timestamp: '2026-04-28T14:35:00Z', type: 'action', data: { action: 'manual_override', parameter: 'temperature', value: 37 } }
            ]);
        }

        it('returns a complete report structure', function () {
            loadScenario();
            var report = engine.investigate({ incidentType: 'viability_drop', incidentTime: '2026-04-28T14:30:00Z' });
            expect(report.timeline).toBeDefined();
            expect(report.temporalClusters).toBeDefined();
            expect(report.causalChains).toBeDefined();
            expect(report.patternMatches).toBeDefined();
            expect(report.contributingFactors).toBeDefined();
            expect(report.anomalies).toBeDefined();
            expect(report.gaps).toBeDefined();
            expect(report.verdict).toBeDefined();
            expect(report.severity).toBeDefined();
            expect(report.recommendations).toBeDefined();
            expect(report.summary).toBeDefined();
            expect(report.evidenceCount).toBe(7);
            expect(report.enginesRun).toBe(6);
        });

        it('detects temporal clusters', function () {
            loadScenario();
            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            expect(report.temporalClusters.length).toBeGreaterThan(0);
            expect(report.temporalClusters[0].eventCount).toBeGreaterThanOrEqual(2);
        });

        it('detects causal chains', function () {
            loadScenario();
            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            expect(report.causalChains.length).toBeGreaterThan(0);
            expect(report.causalChains[0].label).toBeDefined();
            expect(report.causalChains[0].strength).toBeGreaterThan(0);
        });

        it('matches contamination pattern', function () {
            loadScenario();
            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            var contam = report.patternMatches.find(function (m) { return m.pattern === 'contamination_event'; });
            expect(contam).toBeDefined();
            expect(contam.similarity).toBeGreaterThan(0.2);
        });

        it('ranks contributing factors by score', function () {
            loadScenario();
            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            expect(report.contributingFactors.length).toBe(7);
            for (var i = 1; i < report.contributingFactors.length; i++) {
                expect(report.contributingFactors[i - 1].score).toBeGreaterThanOrEqual(report.contributingFactors[i].score);
            }
        });

        it('generates a severity level', function () {
            loadScenario();
            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(report.severity);
        });

        it('generates verdict with confidence', function () {
            loadScenario();
            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            expect(report.verdict.rootCause).toBeDefined();
            expect(report.verdict.confidence).toBeGreaterThan(0);
            expect(report.verdict.confidence).toBeLessThanOrEqual(1);
            expect(report.verdict.category).toBeDefined();
            expect(report.verdict.evidenceChain.length).toBeGreaterThan(0);
        });

        it('generates recommendations', function () {
            loadScenario();
            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            expect(report.recommendations.length).toBeGreaterThan(0);
            expect(report.recommendations[0].action).toBeDefined();
            expect(report.recommendations[0].priority).toBeDefined();
            expect(report.recommendations[0].rationale).toBeDefined();
        });

        it('generates a human-readable summary', function () {
            loadScenario();
            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            expect(report.summary).toContain('Incident Investigation Report');
            expect(report.summary).toContain('Severity:');
            expect(report.summary).toContain('Root Cause:');
        });

        it('handles empty evidence gracefully', function () {
            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            expect(report.timeline.length).toBe(0);
            expect(report.temporalClusters.length).toBe(0);
            expect(report.causalChains.length).toBe(0);
            expect(report.severity).toBe('LOW');
            expect(report.recommendations.length).toBeGreaterThan(0); // generic recommendation
        });

        it('handles single evidence item', function () {
            engine.addEvidence({ source: 'quality', timestamp: '2026-04-28T14:30:00Z', type: 'excursion', data: { metric: 'cell_viability', value: 62 } });
            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            expect(report.timeline.length).toBe(1);
            expect(report.temporalClusters.length).toBe(0);
            expect(report.contributingFactors.length).toBe(1);
        });

        it('respects custom window size for clustering', function () {
            engine.loadEvidence([
                { source: 'a', timestamp: '2026-04-28T14:00:00Z', type: 'x' },
                { source: 'b', timestamp: '2026-04-28T14:02:00Z', type: 'y' },
                { source: 'c', timestamp: '2026-04-28T14:30:00Z', type: 'z' }
            ]);
            // 3 min window — first two cluster, third is isolated
            var r1 = engine.investigate({ windowMs: 180000, incidentTime: '2026-04-28T14:30:00Z' });
            expect(r1.temporalClusters.length).toBe(1);
            expect(r1.temporalClusters[0].eventCount).toBe(2);
        });
    });

    // ── Anomaly Detection ──────────────────────────────────────────

    describe('anomaly detection', function () {
        it('detects anomalous values via z-score', function () {
            var items = [];
            // Normal readings
            for (var i = 0; i < 10; i++) {
                items.push({
                    source: 'environmental',
                    timestamp: new Date(2026, 3, 28, 14, i).toISOString(),
                    type: 'reading',
                    data: { temperature: 37 + (Math.random() - 0.5) * 0.5 }
                });
            }
            // Anomalous reading
            items.push({
                source: 'environmental',
                timestamp: new Date(2026, 3, 28, 14, 10).toISOString(),
                type: 'reading',
                data: { temperature: 55 } // way outside normal
            });
            engine.loadEvidence(items);
            var report = engine.investigate({ incidentTime: new Date(2026, 3, 28, 14, 10).toISOString() });
            expect(report.anomalies.length).toBeGreaterThan(0);
            var tempAnomaly = report.anomalies.find(function (a) { return a.parameter === 'temperature'; });
            expect(tempAnomaly).toBeDefined();
            expect(Math.abs(tempAnomaly.zScore)).toBeGreaterThan(2);
        });

        it('does not flag anomalies when all values are similar', function () {
            var items = [];
            for (var i = 0; i < 10; i++) {
                items.push({
                    source: 'environmental',
                    timestamp: new Date(2026, 3, 28, 14, i).toISOString(),
                    type: 'reading',
                    data: { temperature: 37 }
                });
            }
            engine.loadEvidence(items);
            var report = engine.investigate({ incidentTime: new Date(2026, 3, 28, 14, 10).toISOString() });
            expect(report.anomalies.length).toBe(0);
        });

        it('skips groups with fewer than 3 data points', function () {
            engine.loadEvidence([
                { source: 'a', timestamp: '2026-04-28T14:00:00Z', type: 'r', data: { temp: 37 } },
                { source: 'a', timestamp: '2026-04-28T14:01:00Z', type: 'r', data: { temp: 100 } }
            ]);
            var report = engine.investigate({ incidentTime: '2026-04-28T14:01:00Z' });
            expect(report.anomalies.length).toBe(0);
        });
    });

    // ── Gap Analysis ───────────────────────────────────────────────

    describe('gap analysis', function () {
        it('detects data gaps', function () {
            engine.loadEvidence([
                { source: 'a', timestamp: '2026-04-28T14:00:00Z', type: 'x' },
                { source: 'b', timestamp: '2026-04-28T14:05:00Z', type: 'y' },
                { source: 'c', timestamp: '2026-04-28T16:00:00Z', type: 'z' } // 2hr gap
            ]);
            var report = engine.investigate({ incidentTime: '2026-04-28T16:00:00Z', expectedIntervalMs: 300000 });
            expect(report.gaps.length).toBeGreaterThan(0);
            expect(report.gaps[0].durationMinutes).toBeGreaterThan(60);
        });

        it('returns no gaps when events are evenly spaced', function () {
            engine.loadEvidence([
                { source: 'a', timestamp: '2026-04-28T14:00:00Z', type: 'x' },
                { source: 'b', timestamp: '2026-04-28T14:05:00Z', type: 'y' },
                { source: 'c', timestamp: '2026-04-28T14:10:00Z', type: 'z' }
            ]);
            var report = engine.investigate({ incidentTime: '2026-04-28T14:10:00Z', expectedIntervalMs: 300000 });
            expect(report.gaps.length).toBe(0);
        });

        it('identifies possible sensor failure for very long gaps', function () {
            engine.loadEvidence([
                { source: 'a', timestamp: '2026-04-28T14:00:00Z', type: 'x' },
                { source: 'b', timestamp: '2026-04-29T14:00:00Z', type: 'y' } // 24hr gap
            ]);
            var report = engine.investigate({ incidentTime: '2026-04-29T14:00:00Z', expectedIntervalMs: 300000 });
            expect(report.gaps.length).toBe(1);
            expect(report.gaps[0].possibleCause).toContain('sensor failure');
        });
    });

    // ── Pattern Matching ───────────────────────────────────────────

    describe('pattern matching', function () {
        it('matches equipment failure pattern', function () {
            engine.loadEvidence([
                { source: 'equipment', timestamp: '2026-04-28T14:00:00Z', type: 'error', data: { code: 'E001', fault: 'motor' } },
                { source: 'print_log', timestamp: '2026-04-28T14:05:00Z', type: 'drift', data: { parameter: 'pressure', drift: 5 } },
                { source: 'quality', timestamp: '2026-04-28T14:30:00Z', type: 'excursion', data: { metric: 'quality', value: 60 } }
            ]);
            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            var equip = report.patternMatches.find(function (m) { return m.pattern === 'equipment_failure'; });
            expect(equip).toBeDefined();
            expect(equip.similarity).toBeGreaterThan(0.2);
        });

        it('matches nozzle clog pattern', function () {
            engine.loadEvidence([
                { source: 'equipment', timestamp: '2026-04-28T14:00:00Z', type: 'reading', data: { pressure: 200, clog: true } },
                { source: 'print_log', timestamp: '2026-04-28T14:05:00Z', type: 'alert', data: { flow_rate: 0.1, under_extrusion: true } }
            ]);
            var report = engine.investigate({ incidentTime: '2026-04-28T14:05:00Z' });
            var nozzle = report.patternMatches.find(function (m) { return m.pattern === 'nozzle_clog'; });
            expect(nozzle).toBeDefined();
            expect(nozzle.similarity).toBeGreaterThan(0.1);
        });

        it('returns empty matches for unrelated evidence', function () {
            engine.addEvidence({ source: 'operator', timestamp: '2026-04-28T14:00:00Z', type: 'login', data: { user: 'alice' } });
            var report = engine.investigate({ incidentTime: '2026-04-28T14:00:00Z' });
            // May still match some patterns weakly, but top match should have low similarity
            if (report.patternMatches.length > 0) {
                expect(report.patternMatches[0].similarity).toBeLessThan(0.5);
            }
        });
    });

    // ── Causal Chains ──────────────────────────────────────────────

    describe('causal chain detection', function () {
        it('detects temperature → viability chain', function () {
            engine.loadEvidence([
                { source: 'environmental', timestamp: '2026-04-28T14:00:00Z', type: 'reading', data: { temperature: 42 } },
                { source: 'quality', timestamp: '2026-04-28T14:20:00Z', type: 'excursion', data: { viability: 62 } }
            ]);
            var report = engine.investigate({ incidentTime: '2026-04-28T14:20:00Z' });
            var chain = report.causalChains.find(function (c) { return c.label.indexOf('Temperature') !== -1 && c.label.indexOf('Viability') !== -1; });
            expect(chain).toBeDefined();
            expect(chain.delayMinutes).toBe(20);
        });

        it('strength decays with time delay', function () {
            engine.loadEvidence([
                { source: 'environmental', timestamp: '2026-04-28T14:00:00Z', type: 'reading', data: { temperature: 42 } },
                { source: 'quality', timestamp: '2026-04-28T14:10:00Z', type: 'excursion', data: { viability: 62 } },
                { source: 'quality', timestamp: '2026-04-28T14:50:00Z', type: 'excursion', data: { viability: 58 } }
            ]);
            var report = engine.investigate({ incidentTime: '2026-04-28T14:50:00Z' });
            var tvChains = report.causalChains.filter(function (c) { return c.label.indexOf('Temperature') !== -1; });
            expect(tvChains.length).toBeGreaterThanOrEqual(2);
            // Closer effect should have higher strength
            expect(tvChains[0].strength).toBeGreaterThanOrEqual(tvChains[1].strength);
        });

        it('only detects forward causation (cause before effect)', function () {
            engine.loadEvidence([
                { source: 'quality', timestamp: '2026-04-28T14:00:00Z', type: 'excursion', data: { viability: 62 } },
                { source: 'environmental', timestamp: '2026-04-28T14:10:00Z', type: 'reading', data: { temperature: 42 } }
            ]);
            var report = engine.investigate({ incidentTime: '2026-04-28T14:10:00Z' });
            // Should NOT find temperature → viability since temp came AFTER viability
            var tvChain = report.causalChains.find(function (c) {
                return c.label.indexOf('Temperature') !== -1 && c.label.indexOf('Viability') !== -1;
            });
            expect(tvChain).toBeUndefined();
        });
    });

    // ── Custom Patterns ────────────────────────────────────────────

    describe('registerPattern', function () {
        it('registers a valid custom pattern', function () {
            var result = engine.registerPattern({
                name: 'power_outage',
                label: 'Power Outage',
                signature: { sources: ['equipment'], keywords: ['power', 'outage', 'voltage'] },
                recommendations: [{ action: 'Check UPS', priority: 'HIGH', rationale: 'Power loss detected' }]
            });
            expect(result.registered).toBe(true);
            expect(result.name).toBe('power_outage');
        });

        it('uses custom pattern in investigation', function () {
            engine.registerPattern({
                name: 'power_outage',
                label: 'Power Outage',
                signature: { sources: ['equipment'], keywords: ['power', 'outage', 'voltage'] },
                recommendations: [{ action: 'Check UPS', priority: 'HIGH', rationale: 'Power loss' }]
            });
            engine.addEvidence({ source: 'equipment', timestamp: '2026-04-28T14:00:00Z', type: 'error', data: { issue: 'power outage', voltage: 0 } });
            var report = engine.investigate({ incidentTime: '2026-04-28T14:00:00Z' });
            var po = report.patternMatches.find(function (m) { return m.pattern === 'power_outage'; });
            expect(po).toBeDefined();
            expect(po.similarity).toBeGreaterThan(0.1);
        });

        it('rejects pattern without name', function () {
            var result = engine.registerPattern({ signature: { sources: [] } });
            expect(result.registered).toBe(false);
        });

        it('rejects pattern with dangerous name', function () {
            var result = engine.registerPattern({ name: '__proto__', signature: { sources: [] } });
            expect(result.registered).toBe(false);
        });

        it('rejects pattern without signature', function () {
            var result = engine.registerPattern({ name: 'test' });
            expect(result.registered).toBe(false);
        });

        it('rejects null pattern', function () {
            var result = engine.registerPattern(null);
            expect(result.registered).toBe(false);
        });
    });

    // ── Reset ──────────────────────────────────────────────────────

    describe('reset', function () {
        it('clears all evidence and custom patterns', function () {
            engine.addEvidence({ source: 'a', timestamp: '2026-04-28T14:00:00Z', type: 'x' });
            engine.registerPattern({ name: 'custom', signature: { sources: ['a'], keywords: ['test'] } });
            engine.reset();
            expect(engine.getTimeline().length).toBe(0);
            // Custom pattern should also be gone
            engine.addEvidence({ source: 'a', timestamp: '2026-04-28T14:00:00Z', type: 'x', data: { test: 1 } });
            var report = engine.investigate({ incidentTime: '2026-04-28T14:00:00Z' });
            var custom = report.patternMatches.find(function (m) { return m.pattern === 'custom'; });
            expect(custom).toBeUndefined();
        });

        it('allows re-use after reset', function () {
            engine.addEvidence({ source: 'a', timestamp: '2026-04-28T14:00:00Z', type: 'x' });
            engine.reset();
            var result = engine.addEvidence({ source: 'b', timestamp: '2026-04-28T15:00:00Z', type: 'y' });
            expect(result.added).toBe(true);
            expect(result.id).toBe(1); // IDs reset
        });
    });

    // ── Severity Classification ────────────────────────────────────

    describe('severity classification', function () {
        it('returns LOW for minimal evidence', function () {
            engine.addEvidence({ source: 'operator', timestamp: '2026-04-28T14:00:00Z', type: 'login', data: { user: 'alice' } });
            var report = engine.investigate({ incidentTime: '2026-04-28T14:00:00Z' });
            expect(report.severity).toBe('LOW');
        });

        it('escalates with more concerning evidence', function () {
            // Load a serious multi-source incident
            var items = [];
            for (var i = 0; i < 10; i++) {
                items.push({
                    source: 'environmental',
                    timestamp: new Date(2026, 3, 28, 14, i).toISOString(),
                    type: 'reading',
                    data: { temperature: 37, humidity: 50 }
                });
            }
            // Add anomalous readings and contamination
            items.push({ source: 'environmental', timestamp: '2026-04-28T14:10:00Z', type: 'reading', data: { temperature: 55, humidity: 95 } });
            items.push({ source: 'contamination', timestamp: '2026-04-28T14:15:00Z', type: 'alert', data: { colony: 5, contamination: true } });
            items.push({ source: 'quality', timestamp: '2026-04-28T14:20:00Z', type: 'excursion', data: { viability: 30, expected: 95 } });
            items.push({ source: 'equipment', timestamp: '2026-04-28T14:22:00Z', type: 'error', data: { fault: 'sensor', error: true } });
            engine.loadEvidence(items);
            var report = engine.investigate({ incidentTime: '2026-04-28T14:20:00Z' });
            expect(['HIGH', 'CRITICAL']).toContain(report.severity);
        });
    });

    // ── Recommendations ────────────────────────────────────────────

    describe('recommendations', function () {
        it('provides at least one recommendation even with minimal evidence', function () {
            engine.addEvidence({ source: 'operator', timestamp: '2026-04-28T14:00:00Z', type: 'login' });
            var report = engine.investigate({ incidentTime: '2026-04-28T14:00:00Z' });
            expect(report.recommendations.length).toBeGreaterThan(0);
            expect(report.recommendations[0].action).toBeDefined();
            expect(report.recommendations[0].priority).toBeDefined();
        });

        it('returns recommendations with valid priority levels', function () {
            engine.loadEvidence([
                { source: 'environmental', timestamp: '2026-04-28T14:00:00Z', type: 'reading', data: { humidity: 90 } },
                { source: 'contamination', timestamp: '2026-04-28T14:05:00Z', type: 'alert', data: { contamination: true, colony: 3 } },
                { source: 'quality', timestamp: '2026-04-28T14:30:00Z', type: 'excursion', data: { viability: 50 } }
            ]);
            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            expect(report.recommendations.length).toBeGreaterThan(1);
            var validPriorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
            for (var i = 0; i < report.recommendations.length; i++) {
                expect(validPriorities).toContain(report.recommendations[i].priority);
            }
        });

        it('includes gap recommendation when gaps detected', function () {
            engine.loadEvidence([
                { source: 'a', timestamp: '2026-04-28T14:00:00Z', type: 'x' },
                { source: 'b', timestamp: '2026-04-28T16:00:00Z', type: 'y' }
            ]);
            var report = engine.investigate({ incidentTime: '2026-04-28T16:00:00Z', expectedIntervalMs: 300000 });
            var gapRec = report.recommendations.find(function (r) { return r.action.indexOf('gap') !== -1; });
            expect(gapRec).toBeDefined();
        });
    });
});
