'use strict';

var kd = require('../docs/shared/knowledgeDistiller');

function makeExp(id, operator, protocol, outcome, opts) {
    opts = opts || {};
    return {
        id: id,
        operator: operator,
        protocol: protocol,
        outcome: outcome,
        timestamp: opts.timestamp || '2025-06-15T10:00:00Z',
        parameters: opts.parameters || { temperature: 37, pressure: 2.5, speed: 10 },
        metrics: opts.metrics || { cellViability: 0.9, printAccuracy: 0.85 },
        techniques: opts.techniques || [],
        notes: opts.notes || ''
    };
}

describe('Lab Knowledge Distillation Engine', function () {
    describe('createKnowledgeDistiller', function () {
        it('returns an object with all API methods', function () {
            var d = kd.createKnowledgeDistiller();
            expect(typeof d.recordExperiment).toBe('function');
            expect(typeof d.getOperatorProfile).toBe('function');
            expect(typeof d.identifyExperts).toBe('function');
            expect(typeof d.detectKnowledgeGaps).toBe('function');
            expect(typeof d.codifyBestPractices).toBe('function');
            expect(typeof d.recommendTransfers).toBe('function');
            expect(typeof d.detectKnowledgeDecay).toBe('function');
            expect(typeof d.generateInsights).toBe('function');
            expect(typeof d.dashboard).toBe('function');
        });

        it('starts with zero counts', function () {
            var d = kd.createKnowledgeDistiller();
            expect(d.experimentCount()).toBe(0);
            expect(d.operatorCount()).toBe(0);
            expect(d.protocolCount()).toBe(0);
        });
    });

    describe('recordExperiment', function () {
        it('records and indexes an experiment', function () {
            var d = kd.createKnowledgeDistiller();
            var exp = d.recordExperiment(makeExp('e1', 'alice', 'proto-a', 'success'));
            expect(exp.id).toBe('e1');
            expect(d.experimentCount()).toBe(1);
            expect(d.operatorCount()).toBe(1);
            expect(d.protocolCount()).toBe(1);
        });

        it('rejects missing id', function () {
            var d = kd.createKnowledgeDistiller();
            expect(function () { d.recordExperiment({ operator: 'a', protocol: 'b', outcome: 'success' }); }).toThrow();
        });

        it('rejects missing operator', function () {
            var d = kd.createKnowledgeDistiller();
            expect(function () { d.recordExperiment({ id: 'e1', protocol: 'b', outcome: 'success' }); }).toThrow();
        });

        it('rejects missing protocol', function () {
            var d = kd.createKnowledgeDistiller();
            expect(function () { d.recordExperiment({ id: 'e1', operator: 'a', outcome: 'success' }); }).toThrow();
        });

        it('rejects invalid outcome', function () {
            var d = kd.createKnowledgeDistiller();
            expect(function () { d.recordExperiment(makeExp('e1', 'a', 'b', 'invalid')); }).toThrow();
        });

        it('rejects dangerous keys in id', function () {
            var d = kd.createKnowledgeDistiller();
            expect(function () { d.recordExperiment(makeExp('__proto__', 'a', 'b', 'success')); }).toThrow();
        });

        it('indexes techniques', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment(makeExp('e1', 'alice', 'p1', 'success', { techniques: ['pre-warm', 'slow-ramp'] }));
            var profile = d.getOperatorProfile('alice');
            expect(profile.techniquePreferences['pre-warm']).toBe(1);
            expect(profile.techniquePreferences['slow-ramp']).toBe(1);
        });

        it('records multiple experiments', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment(makeExp('e1', 'alice', 'p1', 'success'));
            d.recordExperiment(makeExp('e2', 'bob', 'p1', 'failure'));
            d.recordExperiment(makeExp('e3', 'alice', 'p2', 'success'));
            expect(d.experimentCount()).toBe(3);
            expect(d.operatorCount()).toBe(2);
            expect(d.protocolCount()).toBe(2);
        });
    });

    describe('Engine 1: Technique Fingerprinter', function () {
        it('returns null for unknown operator', function () {
            var d = kd.createKnowledgeDistiller();
            expect(d.getOperatorProfile('nobody')).toBeNull();
        });

        it('builds parameter signature', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment(makeExp('e1', 'alice', 'p1', 'success', { parameters: { temperature: 36 } }));
            d.recordExperiment(makeExp('e2', 'alice', 'p1', 'success', { parameters: { temperature: 38 } }));
            var profile = d.getOperatorProfile('alice');
            expect(profile.parameterSignature.temperature).toBe(37);
            expect(profile.experimentCount).toBe(2);
            expect(profile.successRate).toBe(100);
        });

        it('computes parameter consistency (CV)', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment(makeExp('e1', 'alice', 'p1', 'success', { parameters: { pressure: 2.5 } }));
            d.recordExperiment(makeExp('e2', 'alice', 'p1', 'success', { parameters: { pressure: 2.5 } }));
            var profile = d.getOperatorProfile('alice');
            expect(profile.parameterConsistency.pressure).toBe(0); // zero variance
        });

        it('tracks outcome distribution', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment(makeExp('e1', 'alice', 'p1', 'success'));
            d.recordExperiment(makeExp('e2', 'alice', 'p1', 'failure'));
            d.recordExperiment(makeExp('e3', 'alice', 'p1', 'partial'));
            var profile = d.getOperatorProfile('alice');
            expect(profile.outcomeDistribution.success).toBe(1);
            expect(profile.outcomeDistribution.failure).toBe(1);
            expect(profile.outcomeDistribution.partial).toBe(1);
        });
    });

    describe('Engine 2: Expert Identifier', function () {
        it('ranks operators by expertise', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 10; i++) {
                d.recordExperiment(makeExp('a' + i, 'alice', 'p1', 'success'));
            }
            for (var j = 0; j < 3; j++) {
                d.recordExperiment(makeExp('b' + j, 'bob', 'p1', j === 0 ? 'success' : 'failure'));
            }
            var experts = d.identifyExperts('p1');
            expect(experts.length).toBe(2);
            expect(experts[0].operator).toBe('alice');
            expect(experts[0].score).toBeGreaterThan(experts[1].score);
        });

        it('assigns expertise tiers', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 20; i++) {
                d.recordExperiment(makeExp('e' + i, 'expert', 'p1', 'success', {
                    metrics: { cellViability: 0.95, printAccuracy: 0.92 }
                }));
            }
            var experts = d.identifyExperts('p1');
            expect(experts[0].tier).toBeDefined();
            expect(typeof experts[0].score).toBe('number');
        });

        it('filters by protocol when specified', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment(makeExp('e1', 'alice', 'p1', 'success'));
            d.recordExperiment(makeExp('e2', 'alice', 'p2', 'failure'));
            var score = d.computeExpertiseScore('alice', 'p1');
            var scoreP2 = d.computeExpertiseScore('alice', 'p2');
            expect(score).toBeGreaterThan(scoreP2);
        });

        it('returns 0 for unknown operator', function () {
            var d = kd.createKnowledgeDistiller();
            expect(d.computeExpertiseScore('nobody')).toBe(0);
        });
    });

    describe('Engine 3: Knowledge Gap Detector', function () {
        it('detects sole expert gaps', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 5; i++) {
                d.recordExperiment(makeExp('e' + i, 'alice', 'rare-protocol', 'success'));
            }
            var gaps = d.detectKnowledgeGaps();
            var soleGap = gaps.find(function (g) { return g.category === 'sole_expert'; });
            expect(soleGap).toBeDefined();
            expect(soleGap.severity).toBe('high');
            expect(soleGap.details.operator).toBe('alice');
        });

        it('detects stale knowledge', function () {
            var d = kd.createKnowledgeDistiller();
            var oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
            for (var i = 0; i < 3; i++) {
                d.recordExperiment(makeExp('e' + i, 'alice', 'old-protocol', 'success', { timestamp: oldDate }));
            }
            var gaps = d.detectKnowledgeGaps();
            var staleGap = gaps.find(function (g) { return g.category === 'stale'; });
            expect(staleGap).toBeDefined();
        });

        it('detects undocumented technique gaps', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 4; i++) {
                d.recordExperiment(makeExp('e' + i, 'alice', 'p1', 'success', {
                    techniques: ['secret-sauce']
                }));
            }
            var gaps = d.detectKnowledgeGaps();
            var undocGap = gaps.find(function (g) { return g.category === 'undocumented'; });
            expect(undocGap).toBeDefined();
            expect(undocGap.details.technique).toBe('secret-sauce');
        });

        it('detects fragmented knowledge', function () {
            var d = kd.createKnowledgeDistiller();
            var ops = ['alice', 'bob', 'carol', 'dave'];
            for (var i = 0; i < 8; i++) {
                d.recordExperiment(makeExp('e' + i, ops[i % 4], 'shared-protocol', 'success'));
            }
            var gaps = d.detectKnowledgeGaps();
            var fragGap = gaps.find(function (g) { return g.category === 'fragmented'; });
            expect(fragGap).toBeDefined();
        });

        it('returns empty for well-covered protocols', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment(makeExp('e1', 'alice', 'p1', 'success'));
            d.recordExperiment(makeExp('e2', 'bob', 'p1', 'success'));
            var gaps = d.detectKnowledgeGaps();
            var soleGap = gaps.find(function (g) { return g.category === 'sole_expert' && g.protocol === 'p1'; });
            expect(soleGap).toBeUndefined();
        });

        it('sorts by severity', function () {
            var d = kd.createKnowledgeDistiller();
            var oldDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
            for (var i = 0; i < 5; i++) {
                d.recordExperiment(makeExp('s' + i, 'alice', 'sole-proto', 'success'));
                d.recordExperiment(makeExp('o' + i, 'bob', 'old-proto', 'success', { timestamp: oldDate }));
            }
            var gaps = d.detectKnowledgeGaps();
            expect(gaps.length).toBeGreaterThanOrEqual(2);
            // Critical/high should come before medium
            if (gaps.length >= 2) {
                var severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                expect(severityOrder[gaps[0].severity]).toBeLessThanOrEqual(severityOrder[gaps[1].severity]);
            }
        });
    });

    describe('Engine 4: Best Practice Codifier', function () {
        it('extracts golden parameter ranges from successes', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 8; i++) {
                d.recordExperiment(makeExp('s' + i, 'alice', 'p1', 'success', {
                    parameters: { temperature: 36 + Math.random() * 2, pressure: 2.4 + Math.random() * 0.2 }
                }));
            }
            d.recordExperiment(makeExp('f1', 'bob', 'p1', 'failure', {
                parameters: { temperature: 45, pressure: 5.0 }
            }));
            var practices = d.codifyBestPractices();
            expect(practices.length).toBeGreaterThan(0);
            var p = practices[0];
            expect(p.protocol).toBe('p1');
            expect(p.parameterRules.length).toBeGreaterThan(0);
            expect(p.parameterRules[0].goldenRange).toBeDefined();
            expect(p.parameterRules[0].confidence).toBeGreaterThan(0);
        });

        it('identifies technique best practices', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 6; i++) {
                d.recordExperiment(makeExp('s' + i, 'alice', 'p1', 'success', {
                    techniques: ['pre-warm-nozzle']
                }));
            }
            d.recordExperiment(makeExp('f1', 'bob', 'p1', 'failure'));
            var practices = d.codifyBestPractices();
            expect(practices.length).toBe(1);
            expect(practices[0].techniqueRules.length).toBe(1);
            expect(practices[0].techniqueRules[0].technique).toBe('pre-warm-nozzle');
        });

        it('skips protocols with fewer than 3 experiments', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment(makeExp('e1', 'alice', 'tiny', 'success'));
            d.recordExperiment(makeExp('e2', 'alice', 'tiny', 'success'));
            var practices = d.codifyBestPractices();
            expect(practices.length).toBe(0);
        });

        it('includes success rate', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 4; i++) {
                d.recordExperiment(makeExp('s' + i, 'alice', 'p1', 'success'));
            }
            d.recordExperiment(makeExp('f1', 'bob', 'p1', 'failure'));
            var practices = d.codifyBestPractices();
            expect(practices[0].successRate).toBe(80);
        });
    });

    describe('Engine 5: Skill Transfer Recommender', function () {
        it('recommends critical transfer for bus factor = 1', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 5; i++) {
                d.recordExperiment(makeExp('a' + i, 'alice', 'special-proto', 'success'));
            }
            d.recordExperiment(makeExp('b1', 'bob', 'other-proto', 'success'));
            var transfers = d.recommendTransfers();
            var critical = transfers.filter(function (t) { return t.urgency === 'critical'; });
            expect(critical.length).toBeGreaterThan(0);
            expect(critical[0].mentor).toBe('alice');
        });

        it('sorts by urgency', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 5; i++) {
                d.recordExperiment(makeExp('a' + i, 'alice', 'proto-a', 'success'));
            }
            d.recordExperiment(makeExp('b1', 'bob', 'proto-b', 'success'));
            var transfers = d.recommendTransfers();
            if (transfers.length >= 2) {
                var urgencyOrder = { critical: 0, recommended: 1, optional: 2 };
                expect(urgencyOrder[transfers[0].urgency]).toBeLessThanOrEqual(urgencyOrder[transfers[1].urgency]);
            }
        });

        it('identifies mentor with highest score', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 10; i++) {
                d.recordExperiment(makeExp('a' + i, 'alice', 'p1', 'success'));
            }
            for (var j = 0; j < 3; j++) {
                d.recordExperiment(makeExp('b' + j, 'bob', 'p1', 'failure'));
            }
            d.recordExperiment(makeExp('c1', 'carol', 'p2', 'success'));
            var transfers = d.recommendTransfers();
            var forP1 = transfers.filter(function (t) { return t.protocol === 'p1'; });
            if (forP1.length > 0) {
                expect(forP1[0].mentor).toBe('alice');
            }
        });
    });

    describe('Engine 6: Knowledge Decay Detector', function () {
        it('detects declining success rates', function () {
            var d = kd.createKnowledgeDistiller();
            var baseTime = new Date('2025-01-01').getTime();
            // Early experiments: all success
            for (var i = 0; i < 6; i++) {
                d.recordExperiment(makeExp('s' + i, 'alice', 'decaying', 'success', {
                    timestamp: new Date(baseTime + i * 7 * 24 * 60 * 60 * 1000).toISOString()
                }));
            }
            // Later experiments: all failure
            for (var j = 0; j < 6; j++) {
                d.recordExperiment(makeExp('f' + j, 'alice', 'decaying', 'failure', {
                    timestamp: new Date(baseTime + (6 + j) * 7 * 24 * 60 * 60 * 1000).toISOString()
                }));
            }
            var decay = d.detectKnowledgeDecay();
            expect(decay.length).toBeGreaterThan(0);
            expect(decay[0].protocol).toBe('decaying');
            expect(decay[0].trend).toBe('declining');
            expect(decay[0].decayRate).toBeGreaterThan(0);
        });

        it('returns empty for stable protocols', function () {
            var d = kd.createKnowledgeDistiller();
            var baseTime = new Date('2025-01-01').getTime();
            for (var i = 0; i < 10; i++) {
                d.recordExperiment(makeExp('s' + i, 'alice', 'stable', 'success', {
                    timestamp: new Date(baseTime + i * 7 * 24 * 60 * 60 * 1000).toISOString()
                }));
            }
            var decay = d.detectKnowledgeDecay();
            var stableDecay = decay.find(function (d) { return d.protocol === 'stable'; });
            expect(stableDecay).toBeUndefined();
        });

        it('classifies severity based on decay rate', function () {
            var d = kd.createKnowledgeDistiller();
            var baseTime = new Date('2025-01-01').getTime();
            // Sharp decline
            for (var i = 0; i < 5; i++) {
                d.recordExperiment(makeExp('s' + i, 'alice', 'sharp-decay', 'success', {
                    timestamp: new Date(baseTime + i * 7 * 24 * 60 * 60 * 1000).toISOString()
                }));
            }
            for (var j = 0; j < 8; j++) {
                d.recordExperiment(makeExp('f' + j, 'alice', 'sharp-decay', 'failure', {
                    timestamp: new Date(baseTime + (5 + j) * 7 * 24 * 60 * 60 * 1000).toISOString()
                }));
            }
            var decay = d.detectKnowledgeDecay();
            if (decay.length > 0) {
                expect(['critical', 'high', 'medium']).toContain(decay[0].severity);
            }
        });
    });

    describe('Engine 7: Insight Generator', function () {
        it('generates bus factor insights', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 5; i++) {
                d.recordExperiment(makeExp('e' + i, 'alice', 'solo-proto', 'success'));
            }
            var insights = d.generateInsights();
            var busFactor = insights.find(function (ins) { return ins.type === 'bus_factor'; });
            expect(busFactor).toBeDefined();
            expect(busFactor.severity).toBe('high');
        });

        it('detects expertise concentration', function () {
            var d = kd.createKnowledgeDistiller();
            // Alice does 50 experiments, others do 1 each
            for (var i = 0; i < 50; i++) {
                d.recordExperiment(makeExp('a' + i, 'alice', 'p1', 'success'));
            }
            d.recordExperiment(makeExp('b1', 'bob', 'p2', 'success'));
            d.recordExperiment(makeExp('c1', 'carol', 'p3', 'success'));
            var insights = d.generateInsights();
            var cluster = insights.find(function (ins) { return ins.type === 'expertise_cluster'; });
            expect(cluster).toBeDefined();
        });

        it('identifies hidden experts', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 5; i++) {
                d.recordExperiment(makeExp('e' + i, 'quiet-bob', 'p1', 'success'));
            }
            var insights = d.generateInsights();
            var hidden = insights.find(function (ins) { return ins.type === 'hidden_expert'; });
            expect(hidden).toBeDefined();
            expect(hidden.message).toContain('quiet-bob');
        });

        it('includes knowledge decay insights', function () {
            var d = kd.createKnowledgeDistiller();
            var baseTime = new Date('2025-01-01').getTime();
            for (var i = 0; i < 6; i++) {
                d.recordExperiment(makeExp('s' + i, 'alice', 'decay-proto', 'success', {
                    timestamp: new Date(baseTime + i * 7 * 24 * 60 * 60 * 1000).toISOString()
                }));
            }
            for (var j = 0; j < 6; j++) {
                d.recordExperiment(makeExp('f' + j, 'alice', 'decay-proto', 'failure', {
                    timestamp: new Date(baseTime + (6 + j) * 7 * 24 * 60 * 60 * 1000).toISOString()
                }));
            }
            var insights = d.generateInsights();
            var decayInsight = insights.find(function (ins) { return ins.type === 'knowledge_decay'; });
            expect(decayInsight).toBeDefined();
        });
    });

    describe('Dashboard', function () {
        it('returns health score and summary', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 5; i++) {
                d.recordExperiment(makeExp('e' + i, i < 3 ? 'alice' : 'bob', 'p1', 'success'));
            }
            var db = d.dashboard();
            expect(db.health).toBeDefined();
            expect(typeof db.health.score).toBe('number');
            expect(db.health.score).toBeGreaterThanOrEqual(0);
            expect(db.health.score).toBeLessThanOrEqual(100);
            expect(db.health.tier).toBeDefined();
            expect(db.summary.totalExperiments).toBe(5);
            expect(db.summary.totalOperators).toBe(2);
        });

        it('includes all dashboard sections', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment(makeExp('e1', 'alice', 'p1', 'success'));
            var db = d.dashboard();
            expect(db.topExperts).toBeDefined();
            expect(db.knowledgeGaps).toBeDefined();
            expect(db.decayAlerts).toBeDefined();
            expect(db.insights).toBeDefined();
        });

        it('health factors sum meaningfully', function () {
            var d = kd.createKnowledgeDistiller();
            for (var i = 0; i < 10; i++) {
                d.recordExperiment(makeExp('e' + i, i % 2 === 0 ? 'alice' : 'bob', 'p1', 'success'));
            }
            var health = d.dashboard().health;
            expect(health.factors.distribution).toBeGreaterThanOrEqual(0);
            expect(health.factors.busFactor).toBeGreaterThanOrEqual(0);
            expect(health.factors.successRate).toBeGreaterThanOrEqual(0);
            expect(health.factors.freshness).toBeGreaterThanOrEqual(0);
        });

        it('defaults to Fair for empty distiller', function () {
            var d = kd.createKnowledgeDistiller();
            var health = d.dashboard().health;
            expect(health.score).toBe(50);
            expect(health.tier).toBe('Fair');
        });
    });

    describe('Edge cases', function () {
        it('handles operators with no parameters', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment({ id: 'e1', operator: 'alice', protocol: 'p1', outcome: 'success' });
            var profile = d.getOperatorProfile('alice');
            expect(profile).toBeDefined();
            expect(Object.keys(profile.parameterSignature)).toEqual([]);
        });

        it('handles operators with no techniques', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment(makeExp('e1', 'alice', 'p1', 'success'));
            var profile = d.getOperatorProfile('alice');
            expect(Object.keys(profile.techniquePreferences)).toEqual([]);
        });

        it('rejects prototype pollution via operator name', function () {
            var d = kd.createKnowledgeDistiller();
            expect(function () {
                d.recordExperiment(makeExp('e1', 'constructor', 'p1', 'success'));
            }).toThrow();
        });

        it('rejects prototype pollution via protocol name', function () {
            var d = kd.createKnowledgeDistiller();
            expect(function () {
                d.recordExperiment(makeExp('e1', 'alice', 'prototype', 'success'));
            }).toThrow();
        });

        it('accepts partial outcome', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment(makeExp('e1', 'alice', 'p1', 'partial'));
            expect(d.experimentCount()).toBe(1);
        });

        it('handles numeric timestamps', function () {
            var d = kd.createKnowledgeDistiller();
            d.recordExperiment(makeExp('e1', 'alice', 'p1', 'success', { timestamp: Date.now() }));
            expect(d.experimentCount()).toBe(1);
        });
    });
});
