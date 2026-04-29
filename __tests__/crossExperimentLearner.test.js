'use strict';

var { createCrossExperimentLearner } = require('../docs/shared/crossExperimentLearner');

// ── Helper: generate synthetic experiment data ─────────────────────

function makeExperiment(overrides) {
    return Object.assign({
        parameters: { temperature: 23, pressure: 105, flowRate: 5.0 },
        outcomes: { viability: 85, structuralIntegrity: 80 },
        tags: ['alginate'],
        timestamp: Date.now()
    }, overrides);
}

function generateCorrelatedData(n, options) {
    var opts = options || {};
    var baseTemp = opts.baseTemp || 23;
    var experiments = [];
    for (var i = 0; i < n; i++) {
        var temp = baseTemp + (Math.random() - 0.5) * 6;
        var pressure = 100 + Math.random() * 20;
        // viability correlates positively with temp (within range)
        var viability = 70 + (temp - 20) * 4 + (Math.random() - 0.5) * 5;
        // structural integrity correlates with pressure
        var integrity = 60 + (pressure - 100) * 1.5 + (Math.random() - 0.5) * 8;
        experiments.push({
            parameters: { temperature: temp, pressure: pressure, flowRate: 3 + Math.random() * 4 },
            outcomes: { viability: Math.min(100, Math.max(0, viability)), structuralIntegrity: Math.min(100, Math.max(0, integrity)) },
            tags: i % 2 === 0 ? ['alginate'] : ['gelatin'],
            timestamp: Date.now() - (n - i) * 3600000
        });
    }
    return experiments;
}

// ── Tests ──────────────────────────────────────────────────────────

describe('CrossExperimentLearner', function() {

    describe('initialization', function() {
        test('creates learner with zero experiments', function() {
            var learner = createCrossExperimentLearner();
            expect(learner.experimentCount).toBe(0);
        });

        test('getKnowledgeSummary returns empty state', function() {
            var learner = createCrossExperimentLearner();
            var summary = learner.getKnowledgeSummary();
            expect(summary.totalExperiments).toBe(0);
            expect(summary.parameters).toEqual([]);
            expect(summary.outcomes).toEqual([]);
        });
    });

    describe('ingest', function() {
        test('accepts valid experiment record', function() {
            var learner = createCrossExperimentLearner();
            var id = learner.ingest(makeExperiment());
            expect(id).toBeTruthy();
            expect(learner.experimentCount).toBe(1);
        });

        test('auto-generates id when not provided', function() {
            var learner = createCrossExperimentLearner();
            var id = learner.ingest(makeExperiment());
            expect(id).toMatch(/^EXP-/);
        });

        test('uses provided id', function() {
            var learner = createCrossExperimentLearner();
            var id = learner.ingest(makeExperiment({ id: 'MY-001' }));
            expect(id).toBe('MY-001');
        });

        test('throws on null record', function() {
            var learner = createCrossExperimentLearner();
            expect(function() { learner.ingest(null); }).toThrow();
        });

        test('throws on missing parameters', function() {
            var learner = createCrossExperimentLearner();
            expect(function() { learner.ingest({ outcomes: { x: 1 } }); }).toThrow(/parameters/);
        });

        test('throws on missing outcomes', function() {
            var learner = createCrossExperimentLearner();
            expect(function() { learner.ingest({ parameters: { x: 1 } }); }).toThrow(/outcomes/);
        });

        test('ingestBatch accepts array', function() {
            var learner = createCrossExperimentLearner();
            var ids = learner.ingestBatch([makeExperiment(), makeExperiment()]);
            expect(ids).toHaveLength(2);
            expect(learner.experimentCount).toBe(2);
        });

        test('ingestBatch throws on non-array', function() {
            var learner = createCrossExperimentLearner();
            expect(function() { learner.ingestBatch('not array'); }).toThrow();
        });

        test('tracks parameter and outcome names', function() {
            var learner = createCrossExperimentLearner();
            learner.ingest(makeExperiment());
            var summary = learner.getKnowledgeSummary();
            expect(summary.parameters).toContain('temperature');
            expect(summary.parameters).toContain('pressure');
            expect(summary.outcomes).toContain('viability');
        });

        test('indexes tags correctly', function() {
            var learner = createCrossExperimentLearner();
            learner.ingest(makeExperiment({ tags: ['alginate', 'v2'] }));
            learner.ingest(makeExperiment({ tags: ['gelatin'] }));
            var summary = learner.getKnowledgeSummary();
            expect(summary.tags).toContain('alginate');
            expect(summary.tags).toContain('gelatin');
            expect(summary.tags).toContain('v2');
            expect(summary.tagCounts.alginate).toBe(1);
        });
    });

    describe('discoverCorrelations', function() {
        test('returns insufficient when < 5 experiments', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch([makeExperiment(), makeExperiment()]);
            var result = learner.discoverCorrelations();
            expect(result.insufficient).toBe(true);
        });

        test('discovers correlations with enough data', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(20));
            var result = learner.discoverCorrelations();
            expect(result.insufficient).toBe(false);
            expect(result.correlations.length).toBeGreaterThan(0);
            // temperature-viability should be strong
            var tempViability = result.correlations.find(function(c) {
                return c.parameter === 'temperature' && c.outcome === 'viability';
            });
            expect(tempViability).toBeDefined();
            expect(tempViability.absCorrelation).toBeGreaterThan(0.3);
        });

        test('correlations are sorted by absolute value', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(30));
            var result = learner.discoverCorrelations();
            for (var i = 1; i < result.correlations.length; i++) {
                expect(result.correlations[i].absCorrelation).toBeLessThanOrEqual(result.correlations[i-1].absCorrelation);
            }
        });

        test('each correlation has required fields', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(15));
            var result = learner.discoverCorrelations();
            var c = result.correlations[0];
            expect(c).toHaveProperty('parameter');
            expect(c).toHaveProperty('outcome');
            expect(c).toHaveProperty('correlation');
            expect(c).toHaveProperty('direction');
            expect(c).toHaveProperty('sensitivity');
            expect(c).toHaveProperty('sampleSize');
            expect(c).toHaveProperty('confidence');
        });

        test('filters by tag', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(20));
            var result = learner.discoverCorrelations({ tags: ['alginate'] });
            expect(result.sampleSize).toBeLessThan(20);
            expect(result.sampleSize).toBeGreaterThan(0);
        });
    });

    describe('findGoldenCombinations', function() {
        test('returns insufficient with few experiments', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch([makeExperiment()]);
            var result = learner.findGoldenCombinations('viability');
            expect(result.insufficient).toBe(true);
        });

        test('identifies golden parameter ranges', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(30));
            var result = learner.findGoldenCombinations('viability');
            expect(result.insufficient).toBe(false);
            expect(result.combinations.length).toBeGreaterThan(0);
            expect(result.goldenCount).toBeGreaterThan(0);
        });

        test('golden combinations have tightness scores', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(25));
            var result = learner.findGoldenCombinations('viability');
            if (result.combinations.length > 0) {
                var combo = result.combinations[0];
                expect(combo.tightness).toBeGreaterThanOrEqual(0);
                expect(combo.tightness).toBeLessThanOrEqual(1);
                expect(combo).toHaveProperty('sweetSpot');
                expect(combo).toHaveProperty('goldenRange');
            }
        });

        test('returns goldenThreshold', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(20));
            var result = learner.findGoldenCombinations('viability');
            expect(typeof result.goldenThreshold).toBe('number');
        });
    });

    describe('detectFailurePatterns', function() {
        test('returns insufficient with few experiments', function() {
            var learner = createCrossExperimentLearner();
            learner.ingest(makeExperiment());
            var result = learner.detectFailurePatterns('viability');
            expect(result.insufficient).toBe(true);
        });

        test('detects failure patterns in biased data', function() {
            var learner = createCrossExperimentLearner();
            // Create experiments where low temperature causes low viability
            var exps = [];
            for (var i = 0; i < 30; i++) {
                var temp = 18 + Math.random() * 10;
                var viability = temp > 23 ? 85 + Math.random() * 10 : 50 + Math.random() * 15;
                exps.push({
                    parameters: { temperature: temp, pressure: 105 },
                    outcomes: { viability: viability },
                    tags: ['test']
                });
            }
            learner.ingestBatch(exps);
            var result = learner.detectFailurePatterns('viability');
            expect(result.insufficient).toBe(false);
            expect(result.failureCount).toBeGreaterThan(0);
        });

        test('failure patterns have severity classification', function() {
            var learner = createCrossExperimentLearner();
            var exps = [];
            for (var i = 0; i < 30; i++) {
                var temp = 18 + Math.random() * 10;
                var viability = temp > 23 ? 85 + Math.random() * 10 : 40 + Math.random() * 10;
                exps.push({
                    parameters: { temperature: temp, pressure: 100 + Math.random() * 5 },
                    outcomes: { viability: viability },
                    tags: ['test']
                });
            }
            learner.ingestBatch(exps);
            var result = learner.detectFailurePatterns('viability');
            if (result.patterns.length > 0) {
                expect(['MODERATE', 'HIGH', 'CRITICAL']).toContain(result.patterns[0].severity);
            }
        });
    });

    describe('rankParameterSensitivity', function() {
        test('ranks parameters by influence on outcome', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(25));
            var result = learner.rankParameterSensitivity('viability');
            expect(result.insufficient).toBe(false);
            expect(result.rankings.length).toBeGreaterThan(0);
            // Temperature should rank high for viability
            var tempRank = result.rankings.find(function(r) { return r.parameter === 'temperature'; });
            expect(tempRank).toBeDefined();
        });

        test('rankings include actionability classification', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(20));
            var result = learner.rankParameterSensitivity('viability');
            if (result.rankings.length > 0) {
                expect(['ACTIONABLE', 'MONITOR', 'IGNORE']).toContain(result.rankings[0].actionability);
            }
        });
    });

    describe('recommend', function() {
        test('throws without targetOutcome', function() {
            var learner = createCrossExperimentLearner();
            expect(function() { learner.recommend({}); }).toThrow(/targetOutcome/);
        });

        test('returns insufficient with few experiments', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch([makeExperiment(), makeExperiment()]);
            var result = learner.recommend({ targetOutcome: 'viability', targetValue: 95 });
            expect(result.insufficient).toBe(true);
        });

        test('generates recommendations with enough data', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(25));
            var result = learner.recommend({ targetOutcome: 'viability', targetValue: 95 });
            expect(result.insufficient).toBe(false);
            expect(result.recommendations.length).toBeGreaterThan(0);
        });

        test('recommendations include adjustment info', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(30));
            var result = learner.recommend({ targetOutcome: 'viability', targetValue: 95 });
            if (result.recommendations.length > 0) {
                var rec = result.recommendations[0];
                expect(rec).toHaveProperty('parameter');
                expect(rec).toHaveProperty('suggestedValue');
                expect(rec).toHaveProperty('adjustmentDirection');
                expect(rec).toHaveProperty('rationale');
                expect(rec).toHaveProperty('confidence');
                expect(rec).toHaveProperty('confidenceLevel');
            }
        });

        test('recommendations are sorted by confidence', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(30));
            var result = learner.recommend({ targetOutcome: 'viability' });
            for (var i = 1; i < result.recommendations.length; i++) {
                expect(result.recommendations[i].confidence).toBeLessThanOrEqual(result.recommendations[i-1].confidence);
            }
        });

        test('works without targetValue (direction only)', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(20));
            var result = learner.recommend({ targetOutcome: 'viability' });
            expect(result.insufficient).toBe(false);
        });
    });

    describe('getLearningCurve', function() {
        test('returns insufficient with < 3 experiments', function() {
            var learner = createCrossExperimentLearner();
            learner.ingest(makeExperiment());
            var result = learner.getLearningCurve('viability');
            expect(result.insufficient).toBe(true);
        });

        test('computes learning curve with improvement metrics', function() {
            var learner = createCrossExperimentLearner();
            // Simulate improving outcomes over time
            var exps = [];
            for (var i = 0; i < 20; i++) {
                exps.push({
                    parameters: { temperature: 23 },
                    outcomes: { viability: 70 + i * 1.2 + (Math.random() - 0.5) * 3 },
                    tags: ['test'],
                    timestamp: Date.now() - (20 - i) * 86400000
                });
            }
            learner.ingestBatch(exps);
            var result = learner.getLearningCurve('viability');
            expect(result.insufficient).toBe(false);
            expect(result.curve.length).toBe(20);
            expect(result.metrics.trend).toBe('IMPROVING');
            expect(result.metrics.improvementPercent).toBeGreaterThan(0);
        });

        test('curve points include running average', function() {
            var learner = createCrossExperimentLearner();
            var exps = [];
            for (var i = 0; i < 10; i++) {
                exps.push({
                    parameters: { temperature: 23 },
                    outcomes: { viability: 80 + i },
                    timestamp: Date.now() - (10 - i) * 1000
                });
            }
            learner.ingestBatch(exps);
            var result = learner.getLearningCurve('viability');
            expect(result.curve[0]).toHaveProperty('runningAverage');
            expect(result.curve[0]).toHaveProperty('experimentId');
        });
    });

    describe('compareByTag', function() {
        test('compares two material groups', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(20));
            var result = learner.compareByTag('alginate', 'gelatin', 'viability');
            expect(result.tagA.tag).toBe('alginate');
            expect(result.tagB.tag).toBe('gelatin');
            expect(result.targetOutcome).toBe('viability');
        });

        test('declares a winner', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(20));
            var result = learner.compareByTag('alginate', 'gelatin', 'viability');
            expect(['alginate', 'gelatin', 'tie']).toContain(result.winner);
        });

        test('handles missing tag gracefully', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(10));
            var result = learner.compareByTag('alginate', 'nonexistent', 'viability');
            expect(result.tagB.stats).toBeNull();
        });
    });

    describe('analyze (full)', function() {
        test('returns comprehensive analysis', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(25));
            var result = learner.analyze();
            expect(result.experimentCount).toBe(25);
            expect(result.correlations).toBeDefined();
            expect(result.outcomeAnalyses).toBeDefined();
            expect(result.outcomeAnalyses.viability).toBeDefined();
            expect(result.outcomeAnalyses.viability.golden).toBeDefined();
            expect(result.outcomeAnalyses.viability.failures).toBeDefined();
            expect(result.outcomeAnalyses.viability.sensitivity).toBeDefined();
            expect(result.outcomeAnalyses.viability.learningCurve).toBeDefined();
        });
    });

    describe('exportData and reset', function() {
        test('exports all experiments', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(5));
            var data = learner.exportData();
            expect(data.experiments).toHaveLength(5);
            expect(data.metadata.totalExperiments).toBe(5);
            expect(data.metadata.parameters.length).toBeGreaterThan(0);
        });

        test('reset clears all data', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(10));
            expect(learner.experimentCount).toBe(10);
            learner.reset();
            expect(learner.experimentCount).toBe(0);
            var summary = learner.getKnowledgeSummary();
            expect(summary.parameters).toEqual([]);
        });
    });

    describe('data coverage', function() {
        test('computes coverage score', function() {
            var learner = createCrossExperimentLearner();
            learner.ingestBatch(generateCorrelatedData(10));
            var summary = learner.getKnowledgeSummary();
            expect(summary.dataHealth.coverageScore).toBeGreaterThan(0);
            expect(summary.dataHealth.coverageScore).toBeLessThanOrEqual(1);
            expect(summary.dataHealth.hasEnoughForCorrelation).toBe(true);
            expect(summary.dataHealth.hasEnoughForRecommendation).toBe(true);
        });
    });

    describe('filtering', function() {
        test('filters by timestamp range', function() {
            var learner = createCrossExperimentLearner();
            var now = Date.now();
            learner.ingest(makeExperiment({ timestamp: now - 86400000 * 10 })); // 10 days ago
            learner.ingest(makeExperiment({ timestamp: now - 86400000 * 5 }));  // 5 days ago
            for (var i = 0; i < 8; i++) {
                learner.ingest(makeExperiment({ timestamp: now - 86400000 * i }));
            }
            var result = learner.discoverCorrelations({ since: now - 86400000 * 6 });
            // Should include experiments from last 6 days
            expect(result.sampleSize).toBeLessThan(10);
        });
    });
});
