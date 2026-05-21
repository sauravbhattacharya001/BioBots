'use strict';

/**
 * Regression tests for incidentReplay perf optimizations and edge cases
 * around pattern matching + causal chain detection.
 *
 * These exercise behaviors the main suite doesn't cover:
 *  - Mixed-case keyword matching (the optimized hot path lowercases the
 *    corpus once; keywords themselves are still lowercased per-pair).
 *  - Custom user-registered patterns (so the optimization doesn't regress
 *    when customPatterns is non-empty).
 *  - Causal chains where cause/effect substrings appear inside `data` keys
 *    or values, not just `source`/`type`.
 *  - Stability under bigger evidence sets (smoke for the precomputed
 *    lowerTexts buffer in detectCausalChains).
 */

var mod = require('../docs/shared/incidentReplay');

describe('Lab Incident Replay - perf regression + edge cases', function () {
    var engine;

    beforeEach(function () {
        engine = mod.createIncidentReplay();
    });

    describe('pattern matching - case insensitivity', function () {
        it('matches keywords regardless of case in the evidence corpus', function () {
            // Register a deterministic custom pattern so we control the keywords.
            engine.registerPattern({
                name: 'mixed_case_probe',
                label: 'Mixed Case Probe',
                signature: {
                    sources: ['print_log'],
                    keywords: ['CUSTOM_FAULT', 'StrangeWarning']
                },
                recommendations: ['probe-rec']
            });

            engine.loadEvidence([
                {
                    source: 'print_log',
                    timestamp: '2026-04-28T14:00:00Z',
                    type: 'note',
                    description: 'Operator reported strangewarning during run'
                },
                {
                    source: 'print_log',
                    timestamp: '2026-04-28T14:05:00Z',
                    type: 'fault',
                    data: { reason: 'custom_fault triggered' }
                }
            ]);

            var report = engine.investigate({ incidentTime: '2026-04-28T14:05:00Z' });
            var probe = report.patternMatches.find(function (m) {
                return m.pattern === 'mixed_case_probe';
            });
            expect(probe).toBeDefined();
            // Both keywords present (case-insensitive) -> keywordMatch == 1.0
            expect(probe.keywordMatch).toBe(1);
            // Source matches -> sourceOverlap == 1.0
            expect(probe.sourceOverlap).toBe(1);
            // Combined similarity = 0.4*1 + 0.6*1 = 1.0 (rounded)
            expect(probe.similarity).toBe(1);
        });

        it('produces no false positives when keywords are absent', function () {
            engine.registerPattern({
                name: 'absent_pattern',
                label: 'Absent',
                signature: {
                    sources: ['quality'],
                    keywords: ['this_string_should_never_appear_xyzzy']
                },
                recommendations: []
            });

            engine.loadEvidence([
                { source: 'quality', timestamp: '2026-04-28T14:00:00Z', type: 'reading', data: { ok: true } }
            ]);

            var report = engine.investigate({ incidentTime: '2026-04-28T14:00:00Z' });
            var match = report.patternMatches.find(function (m) {
                return m.pattern === 'absent_pattern';
            });
            // sourceOverlap = 1, kwScore = 0, similarity = 0.4 -> kept (>0.1)
            // but keywordMatch must be 0.
            if (match) {
                expect(match.keywordMatch).toBe(0);
            }
        });
    });

    describe('causal chain detection - data field scans', function () {
        it('detects clog -> under_extrusion when terms only appear inside data values', function () {
            engine.loadEvidence([
                {
                    source: 'equipment',
                    timestamp: '2026-04-28T14:00:00Z',
                    type: 'reading',
                    data: { note: 'nozzle clog suspected', pressure: 220 }
                },
                {
                    source: 'print_log',
                    timestamp: '2026-04-28T14:10:00Z',
                    type: 'alert',
                    data: { warning: 'under_extrusion observed', flow: 0.1 }
                }
            ]);

            var report = engine.investigate({ incidentTime: '2026-04-28T14:10:00Z' });
            var chain = report.causalChains.find(function (c) {
                return c.label.indexOf('Nozzle clog') !== -1;
            });
            expect(chain).toBeDefined();
            expect(chain.delayMinutes).toBeCloseTo(10, 1);
            // Strength decays linearly over 1 hour; 10 min -> ~0.83
            expect(chain.strength).toBeGreaterThan(0.7);
            expect(chain.strength).toBeLessThanOrEqual(1);
        });

        it('orders cause before effect (no chain when effect precedes cause)', function () {
            engine.loadEvidence([
                {
                    source: 'quality',
                    timestamp: '2026-04-28T14:00:00Z',
                    type: 'excursion',
                    data: { viability: 60 }
                },
                {
                    source: 'environmental',
                    timestamp: '2026-04-28T14:30:00Z',
                    type: 'reading',
                    data: { temperature: 42 }
                }
            ]);

            var report = engine.investigate({ incidentTime: '2026-04-28T14:30:00Z' });
            var bogus = report.causalChains.find(function (c) {
                return c.label.indexOf('Temperature') !== -1;
            });
            expect(bogus).toBeUndefined();
        });
    });

    describe('scale - many events through optimized hot paths', function () {
        it('investigates 200 events without throwing and returns a coherent report', function () {
            var evidence = [];
            var base = Date.parse('2026-04-28T14:00:00Z');
            for (var i = 0; i < 200; i++) {
                evidence.push({
                    source: i % 2 === 0 ? 'environmental' : 'quality',
                    timestamp: new Date(base + i * 30000).toISOString(),
                    type: i % 5 === 0 ? 'excursion' : 'reading',
                    data: i % 3 === 0
                        ? { temperature: 30 + (i % 20), note: 'temperature drift detected' }
                        : { viability: 70 + (i % 25) }
                });
            }
            engine.loadEvidence(evidence);

            var report = engine.investigate({
                incidentTime: new Date(base + 200 * 30000).toISOString()
            });

            expect(report).toBeDefined();
            expect(Array.isArray(report.causalChains)).toBe(true);
            expect(Array.isArray(report.patternMatches)).toBe(true);
            // We seeded clear temperature->viability signal, so at least one chain
            // for that pair must be found.
            var tempChain = report.causalChains.find(function (c) {
                return c.label.indexOf('Temperature') !== -1;
            });
            expect(tempChain).toBeDefined();
        });
    });
});
