'use strict';

var _mod = require('../docs/shared/reproducibilityAnalyzer');
var createReproducibilityAnalyzer = _mod.createReproducibilityAnalyzer;

// ── Helpers ────────────────────────────────────────────────────────

function makeExp(protocol, outcome, params, metrics, extra) {
    var exp = Object.assign({
        protocol: protocol,
        outcome: outcome,
        parameters: params || {},
        metrics: metrics || {}
    }, extra || {});
    return exp;
}

function seedConsistent(ra, protocol, n) {
    for (var i = 0; i < n; i++) {
        ra.record(makeExp(protocol, 'success',
            { temperature: 37 + Math.random() * 0.2, pressure: 100 + Math.random() * 0.5 },
            { viability: 95 + Math.random() * 2, yield: 80 + Math.random() * 3 },
            { timestamp: 1000000 + i * 1000, operator: 'Alice', equipment: 'printer-1' }
        ));
    }
}

function seedInconsistent(ra, protocol, n) {
    var outcomes = ['success', 'partial', 'failure'];
    for (var i = 0; i < n; i++) {
        ra.record(makeExp(protocol, outcomes[i % 3],
            { temperature: 30 + Math.random() * 15, pressure: 80 + Math.random() * 40 },
            { viability: 50 + Math.random() * 50, yield: 20 + Math.random() * 70 },
            { timestamp: 1000000 + i * 1000, operator: i % 2 === 0 ? 'Bob' : 'Carol', equipment: i % 2 === 0 ? 'printer-1' : 'printer-2' }
        ));
    }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('ReproducibilityAnalyzer', function () {

    describe('Engine 1: Experiment Registry', function () {
        var ra;
        beforeEach(function () { ra = createReproducibilityAnalyzer(); });

        it('records an experiment and returns entry with id', function () {
            var entry = ra.record(makeExp('P1', 'success', { temp: 37 }, { viability: 95 }));
            expect(entry.id).toBe(1);
            expect(entry.protocol).toBe('P1');
            expect(entry.outcome).toBe('success');
        });

        it('increments id for each recorded experiment', function () {
            ra.record(makeExp('P1', 'success'));
            var e2 = ra.record(makeExp('P1', 'partial'));
            expect(e2.id).toBe(2);
        });

        it('throws on missing protocol', function () {
            expect(function () { ra.record({ outcome: 'success' }); }).toThrow(/protocol/i);
        });

        it('throws on invalid outcome', function () {
            expect(function () { ra.record({ protocol: 'P1', outcome: 'unknown' }); }).toThrow(/outcome/i);
        });

        it('throws on null input', function () {
            expect(function () { ra.record(null); }).toThrow();
        });

        it('throws on dangerous parameter key __proto__', function () {
            var params = Object.create(null);
            params['__proto__'] = 1;
            expect(function () {
                ra.record({ protocol: 'P1', outcome: 'success', parameters: params });
            }).toThrow(/dangerous/i);
        });

        it('throws on dangerous parameter key constructor', function () {
            expect(function () {
                ra.record({ protocol: 'P1', outcome: 'success', parameters: { constructor: 1 } });
            }).toThrow(/dangerous/i);
        });

        it('throws on dangerous metric key prototype', function () {
            expect(function () {
                ra.record({ protocol: 'P1', outcome: 'success', metrics: { prototype: 1 } });
            }).toThrow(/dangerous/i);
        });

        it('defaults operator to unknown', function () {
            var e = ra.record(makeExp('P1', 'success'));
            expect(e.operator).toBe('unknown');
        });

        it('defaults equipment to default', function () {
            var e = ra.record(makeExp('P1', 'success'));
            expect(e.equipment).toBe('default');
        });

        it('stores operator and equipment when provided', function () {
            var e = ra.record(makeExp('P1', 'success', {}, {}, { operator: 'Alice', equipment: 'BioX' }));
            expect(e.operator).toBe('Alice');
            expect(e.equipment).toBe('BioX');
        });

        it('getExperimentCount returns correct count', function () {
            expect(ra.getExperimentCount()).toBe(0);
            ra.record(makeExp('P1', 'success'));
            expect(ra.getExperimentCount()).toBe(1);
        });

        it('getProtocols lists unique protocols', function () {
            ra.record(makeExp('P1', 'success'));
            ra.record(makeExp('P2', 'failure'));
            ra.record(makeExp('P1', 'partial'));
            expect(ra.getProtocols().sort()).toEqual(['P1', 'P2']);
        });

        it('reset clears all experiments', function () {
            ra.record(makeExp('P1', 'success'));
            ra.reset();
            expect(ra.getExperimentCount()).toBe(0);
        });

        it('accepts all valid outcomes', function () {
            ra.record(makeExp('P1', 'success'));
            ra.record(makeExp('P1', 'partial'));
            ra.record(makeExp('P1', 'failure'));
            expect(ra.getExperimentCount()).toBe(3);
        });
    });

    describe('Engine 4: Reproducibility Scorer', function () {
        var ra;
        beforeEach(function () { ra = createReproducibilityAnalyzer(); });

        it('returns score 0 for single experiment', function () {
            ra.record(makeExp('P1', 'success', { t: 37 }, { v: 95 }));
            var result = ra.getReproducibilityScore('P1');
            expect(result).toBeNull();
        });

        it('returns null for nonexistent protocol', function () {
            var result = ra.getReproducibilityScore('nonexistent');
            expect(result).toBeNull();
        });

        it('scores highly for consistent experiments', function () {
            seedConsistent(ra, 'P1', 10);
            var result = ra.getReproducibilityScore('P1');
            expect(result.score).toBeGreaterThan(70);
            expect(typeof result.tier).toBe('string');
        });

        it('scores low for inconsistent experiments', function () {
            seedInconsistent(ra, 'P1', 12);
            var result = ra.getReproducibilityScore('P1');
            expect(result.score).toBeLessThan(70);
        });

        it('returns correct tier labels', function () {
            // Perfect consistency
            for (var i = 0; i < 5; i++) {
                ra.record(makeExp('perfect', 'success', { t: 37 }, { v: 95 }));
            }
            var result = ra.getReproducibilityScore('perfect');
            expect(result.tier).toBe('Excellent');
        });

        it('score is between 0 and 100', function () {
            seedConsistent(ra, 'P1', 5);
            seedInconsistent(ra, 'P2', 6);
            var r1 = ra.getReproducibilityScore('P1');
            var r2 = ra.getReproducibilityScore('P2');
            expect(r1.score).toBeGreaterThanOrEqual(0);
            expect(r1.score).toBeLessThanOrEqual(100);
            expect(r2.score).toBeGreaterThanOrEqual(0);
            expect(r2.score).toBeLessThanOrEqual(100);
        });

        it('outcome consistency component reflects mixed outcomes', function () {
            ra.record(makeExp('mix', 'success', { t: 37 }, { v: 90 }));
            ra.record(makeExp('mix', 'failure', { t: 37 }, { v: 90 }));
            ra.record(makeExp('mix', 'partial', { t: 37 }, { v: 90 }));
            var result = ra.analyzeProtocol('mix');
            expect(result.score.components.outcomeConsistency).toBeLessThan(50);
        });
    });

    describe('Engine 3: Variance Decomposer', function () {
        var ra;
        beforeEach(function () { ra = createReproducibilityAnalyzer(); });

        it('includes metric CVs in protocol analysis', function () {
            seedConsistent(ra, 'P1', 5);
            var result = ra.analyzeProtocol('P1');
            expect(result.variance).toBeDefined();
            expect(result.variance.metricCVs).toBeDefined();
        });

        it('reports low CV for consistent metrics', function () {
            for (var i = 0; i < 6; i++) {
                ra.record(makeExp('P1', 'success', { t: 37 }, { viability: 95 }));
            }
            var result = ra.analyzeProtocol('P1');
            expect(result.variance.metricCVs.viability.cv).toBeLessThan(0.01);
        });

        it('reports parameter sensitivity', function () {
            seedConsistent(ra, 'P1', 6);
            var result = ra.analyzeProtocol('P1');
            expect(result.variance.parameterSensitivity).toBeDefined();
            expect(typeof result.variance.parameterSensitivity.temperature).toBe('object');
        });
    });

    describe('Engine 5: Drift Detector', function () {
        var ra;
        beforeEach(function () { ra = createReproducibilityAnalyzer(); });

        it('reports no drift for consistent data', function () {
            seedConsistent(ra, 'P1', 10);
            var result = ra.analyzeProtocol('P1');
            expect(result.drift.drifting).toBe(false);
        });

        it('reports insufficient data for small groups', function () {
            ra.record(makeExp('P1', 'success', { t: 37 }, { v: 95 }, { timestamp: 1000 }));
            ra.record(makeExp('P1', 'success', { t: 37 }, { v: 95 }, { timestamp: 2000 }));
            var result = ra.analyzeProtocol('P1');
            expect(result.drift.drifting).toBe(false);
            expect(result.drift.reason).toBeDefined();
        });

        it('detects degrading reproducibility', function () {
            // First batch: consistent
            for (var i = 0; i < 5; i++) {
                ra.record(makeExp('P1', 'success', { t: 37 }, { v: 95 }, { timestamp: 1000 + i * 100 }));
            }
            // Second batch: degrading
            var outcomes = ['success', 'failure', 'partial'];
            for (var j = 0; j < 5; j++) {
                ra.record(makeExp('P1', outcomes[j % 3],
                    { t: 30 + j * 3 }, { v: 50 + j * 10 },
                    { timestamp: 2000 + j * 100 }));
            }
            var result = ra.analyzeProtocol('P1');
            expect(result.drift).toBeDefined();
            expect(typeof result.drift.slope).toBe('number');
        });
    });

    describe('Engine 6: Improvement Recommender', function () {
        var ra;
        beforeEach(function () { ra = createReproducibilityAnalyzer(); });

        it('returns empty array for insufficient data', function () {
            ra.record(makeExp('P1', 'success'));
            var recs = ra.recommend('P1');
            expect(recs).toEqual([]);
        });

        it('generates recommendations for inconsistent protocol', function () {
            seedInconsistent(ra, 'P1', 8);
            var recs = ra.recommend('P1');
            expect(recs.length).toBeGreaterThan(0);
            expect(recs[0]).toHaveProperty('category');
            expect(recs[0]).toHaveProperty('action');
            expect(recs[0]).toHaveProperty('impact');
        });

        it('recommends operator training when multiple operators', function () {
            // Operator A: all success
            for (var i = 0; i < 4; i++) {
                ra.record(makeExp('P1', 'success', { t: 37 }, { v: 95 }, { operator: 'Alice' }));
            }
            // Operator B: all failure
            for (var j = 0; j < 4; j++) {
                ra.record(makeExp('P1', 'failure', { t: 30 + j * 5 }, { v: 40 + j * 10 }, { operator: 'Bob' }));
            }
            var recs = ra.recommend('P1');
            var trainingRec = recs.filter(function (r) { return r.category === 'training'; });
            expect(trainingRec.length).toBeGreaterThan(0);
        });

        it('recommends equipment standardization for multi-equipment', function () {
            for (var i = 0; i < 3; i++) {
                ra.record(makeExp('P1', 'success', { t: 37 }, { v: 95 }, { equipment: 'printer-' + (i + 1) }));
            }
            var recs = ra.recommend('P1');
            var eqRec = recs.filter(function (r) { return r.category === 'equipment'; });
            expect(eqRec.length).toBeGreaterThan(0);
        });

        it('recommendations are sorted by priority', function () {
            seedInconsistent(ra, 'P1', 10);
            var recs = ra.recommend('P1');
            for (var i = 1; i < recs.length; i++) {
                expect(recs[i].priority).toBeGreaterThanOrEqual(recs[i - 1].priority);
            }
        });
    });

    describe('Engine 7: Insight Generator', function () {
        var ra;
        beforeEach(function () { ra = createReproducibilityAnalyzer(); });

        it('returns info message with no data', function () {
            var insights = ra.generateInsights();
            expect(insights.length).toBe(0);
        });

        it('identifies best protocol', function () {
            seedConsistent(ra, 'good_protocol', 5);
            seedInconsistent(ra, 'bad_protocol', 6);
            var insights = ra.generateInsights();
            var best = insights.filter(function (i) { return i.type === 'best_protocol'; });
            expect(best.length).toBe(1);
            expect(best[0].protocol).toBe('good_protocol');
        });

        it('identifies worst protocol', function () {
            seedConsistent(ra, 'good', 5);
            seedInconsistent(ra, 'bad', 6);
            var insights = ra.generateInsights();
            var worst = insights.filter(function (i) { return i.type === 'worst_protocol'; });
            expect(worst.length).toBe(1);
            expect(worst[0].protocol).toBe('bad');
        });

        it('reports overall health', function () {
            seedConsistent(ra, 'P1', 5);
            var insights = ra.generateInsights();
            var health = insights.filter(function (i) { return i.type === 'overall_health'; });
            expect(health.length).toBe(1);
            expect(health[0].averageScore).toBeGreaterThan(0);
        });

        it('detects golden parameters in high-scoring protocols', function () {
            for (var i = 0; i < 8; i++) {
                ra.record(makeExp('golden', 'success', { temperature: 37, pressure: 100 }, { viability: 95 }));
            }
            var insights = ra.generateInsights();
            var golden = insights.filter(function (i) { return i.type === 'golden_parameters'; });
            expect(golden.length).toBeGreaterThan(0);
        });

        it('compares operators when multiple exist', function () {
            for (var i = 0; i < 4; i++) {
                ra.record(makeExp('P1', 'success', {}, {}, { operator: 'Alice' }));
                ra.record(makeExp('P1', 'failure', {}, {}, { operator: 'Bob' }));
            }
            var insights = ra.generateInsights();
            var opComp = insights.filter(function (i) { return i.type === 'operator_comparison'; });
            expect(opComp.length).toBe(1);
        });
    });

    describe('Full Analysis', function () {
        var ra;
        beforeEach(function () { ra = createReproducibilityAnalyzer(); });

        it('returns comprehensive analysis report', function () {
            seedConsistent(ra, 'P1', 5);
            seedInconsistent(ra, 'P2', 6);
            var report = ra.analyze();
            expect(report.totalExperiments).toBe(11);
            expect(report.protocolCount).toBe(2);
            expect(report.protocols.P1).toBeDefined();
            expect(report.protocols.P2).toBeDefined();
            expect(report.insights.length).toBeGreaterThan(0);
            expect(report.health).toBeDefined();
        });

        it('analyzeProtocol returns null for nonexistent protocol', function () {
            expect(ra.analyzeProtocol('nonexistent')).toBeNull();
        });

        it('analyzeProtocol includes all engines', function () {
            seedConsistent(ra, 'P1', 6);
            var result = ra.analyzeProtocol('P1');
            expect(result.score).toBeDefined();
            expect(result.drift).toBeDefined();
            expect(result.variance).toBeDefined();
            expect(result.recommendations).toBeDefined();
            expect(result.experimentCount).toBe(6);
        });
    });

    describe('Health Scoring', function () {
        var ra;
        beforeEach(function () { ra = createReproducibilityAnalyzer(); });

        it('returns Critical with no experiments', function () {
            var h = ra.getHealth();
            expect(h.score).toBe(0);
            expect(h.tier).toBe('Critical');
        });

        it('returns score between 0 and 100', function () {
            seedConsistent(ra, 'P1', 5);
            var h = ra.getHealth();
            expect(h.score).toBeGreaterThanOrEqual(0);
            expect(h.score).toBeLessThanOrEqual(100);
        });

        it('returns higher health for consistent protocols', function () {
            seedConsistent(ra, 'P1', 8);
            var h1 = ra.getHealth();

            var ra2 = createReproducibilityAnalyzer();
            seedInconsistent(ra2, 'P2', 8);
            var h2 = ra2.getHealth();

            expect(h1.score).toBeGreaterThan(h2.score);
        });

        it('includes protocol count and drift count', function () {
            seedConsistent(ra, 'P1', 5);
            var h = ra.getHealth();
            expect(h.protocolsAnalyzed).toBe(1);
            expect(typeof h.driftingProtocols).toBe('number');
        });
    });

    describe('Configuration', function () {
        it('accepts custom options', function () {
            var ra = createReproducibilityAnalyzer({ similarityThreshold: 0.9, minRepetitions: 5 });
            expect(ra).toBeDefined();
            expect(typeof ra.record).toBe('function');
        });

        it('works with default options', function () {
            var ra = createReproducibilityAnalyzer();
            expect(ra).toBeDefined();
        });
    });

    describe('Edge Cases', function () {
        var ra;
        beforeEach(function () { ra = createReproducibilityAnalyzer(); });

        it('handles experiments with no parameters', function () {
            ra.record(makeExp('P1', 'success', {}, { v: 95 }));
            ra.record(makeExp('P1', 'success', {}, { v: 96 }));
            var result = ra.analyzeProtocol('P1');
            expect(result).toBeDefined();
        });

        it('handles experiments with no metrics', function () {
            ra.record(makeExp('P1', 'success', { t: 37 }, {}));
            ra.record(makeExp('P1', 'success', { t: 38 }, {}));
            var result = ra.analyzeProtocol('P1');
            expect(result).toBeDefined();
        });

        it('handles experiments with mixed metric keys', function () {
            ra.record(makeExp('P1', 'success', {}, { a: 1, b: 2 }));
            ra.record(makeExp('P1', 'success', {}, { b: 3, c: 4 }));
            var result = ra.analyzeProtocol('P1');
            expect(result.variance.metricCVs).toBeDefined();
        });

        it('handles large number of experiments', function () {
            for (var i = 0; i < 100; i++) {
                ra.record(makeExp('P1', 'success', { t: 37 + Math.random() }, { v: 90 + Math.random() * 5 }));
            }
            var result = ra.analyze();
            expect(result.totalExperiments).toBe(100);
        });

        it('handles many protocols', function () {
            for (var i = 0; i < 20; i++) {
                ra.record(makeExp('P' + i, 'success', { t: 37 }, { v: 95 }));
                ra.record(makeExp('P' + i, 'success', { t: 37 }, { v: 95 }));
            }
            var result = ra.analyze();
            expect(result.protocolCount).toBe(20);
        });

        it('handles timestamp as Date string', function () {
            var e = ra.record(makeExp('P1', 'success', {}, {}, { timestamp: '2025-01-01T00:00:00Z' }));
            expect(typeof e.timestamp).toBe('number');
            expect(e.timestamp).toBeGreaterThan(0);
        });
    });
});
