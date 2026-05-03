'use strict';

var _create = require('../docs/shared/outcomeOracle').createOutcomeOracle;

// ── Helpers ────────────────────────────────────────────────────────

function seedPrintExperiments(oracle, count) {
    var outcomes = ['success', 'success', 'success', 'partial', 'failure'];
    for (var i = 0; i < count; i++) {
        var temp = 20 + Math.random() * 20;
        var pressure = 50 + Math.random() * 100;
        var speed = 5 + Math.random() * 15;
        var oc = outcomes[i % outcomes.length];
        // Bias: high temp + high pressure → failure
        if (temp > 35 && pressure > 130) oc = 'failure';
        if (temp < 25 && pressure < 80) oc = 'success';
        oracle.recordExperiment({
            id: 'exp-' + i,
            type: 'bioprint',
            parameters: { temperature: temp, pressure: pressure, speed: speed },
            outcome: oc,
            metrics: { yield: oc === 'success' ? 80 + Math.random() * 20 : (oc === 'partial' ? 40 + Math.random() * 30 : 10 + Math.random() * 20), viability: oc === 'success' ? 85 + Math.random() * 15 : 30 + Math.random() * 40 },
            tags: ['batch-' + (i % 3), oc === 'success' ? 'good' : 'review'],
            timestamp: Date.now() - (count - i) * 86400000
        });
    }
}

function seedMixed(oracle) {
    oracle.recordExperiment({ id: 's1', type: 'bioprint', parameters: { temp: 22, pressure: 60 }, outcome: 'success', metrics: { yield: 90, viability: 95 }, tags: ['a'] });
    oracle.recordExperiment({ id: 's2', type: 'bioprint', parameters: { temp: 23, pressure: 62 }, outcome: 'success', metrics: { yield: 88, viability: 93 }, tags: ['a'] });
    oracle.recordExperiment({ id: 's3', type: 'bioprint', parameters: { temp: 24, pressure: 65 }, outcome: 'success', metrics: { yield: 85, viability: 91 }, tags: ['b'] });
    oracle.recordExperiment({ id: 'f1', type: 'bioprint', parameters: { temp: 38, pressure: 140 }, outcome: 'failure', metrics: { yield: 10, viability: 20 }, tags: ['c'] });
    oracle.recordExperiment({ id: 'f2', type: 'bioprint', parameters: { temp: 39, pressure: 145 }, outcome: 'failure', metrics: { yield: 12, viability: 18 }, tags: ['c'] });
    oracle.recordExperiment({ id: 'p1', type: 'bioprint', parameters: { temp: 30, pressure: 100 }, outcome: 'partial', metrics: { yield: 55, viability: 60 }, tags: ['b'] });
    oracle.recordExperiment({ id: 'o1', type: 'culture', parameters: { temp: 37, co2: 5 }, outcome: 'success', metrics: { viability: 98 }, tags: ['d'] });
    oracle.recordExperiment({ id: 'o2', type: 'culture', parameters: { temp: 37, co2: 5.5 }, outcome: 'success', metrics: { viability: 96 }, tags: ['d'] });
}

// ── Engine 1: Historical Knowledge Base ────────────────────────────

describe('Historical Knowledge Base', function () {
    test('records a valid experiment', function () {
        var o = _create();
        var r = o.recordExperiment({ id: 'e1', outcome: 'success', parameters: { temp: 22 } });
        expect(r.success).toBe(true);
        expect(r.experiment.id).toBe('e1');
        expect(r.experiment.outcome).toBe('success');
        expect(o.getExperimentCount()).toBe(1);
    });

    test('rejects missing id', function () {
        var o = _create();
        var r = o.recordExperiment({ outcome: 'success' });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/id/i);
    });

    test('rejects null opts', function () {
        var o = _create();
        var r = o.recordExperiment(null);
        expect(r.success).toBe(false);
    });

    test('rejects dangerous key as id', function () {
        var o = _create();
        var r = o.recordExperiment({ id: '__proto__', outcome: 'success' });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/[Ii]nvalid/);
    });

    test('rejects constructor as id', function () {
        var o = _create();
        var r = o.recordExperiment({ id: 'constructor', outcome: 'success' });
        expect(r.success).toBe(false);
    });

    test('rejects invalid outcome', function () {
        var o = _create();
        var r = o.recordExperiment({ id: 'e1', outcome: 'maybe' });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/outcome/i);
    });

    test('rejects missing outcome', function () {
        var o = _create();
        var r = o.recordExperiment({ id: 'e1' });
        expect(r.success).toBe(false);
    });

    test('defaults type to general', function () {
        var o = _create();
        var r = o.recordExperiment({ id: 'e1', outcome: 'success' });
        expect(r.experiment.type).toBe('general');
    });

    test('defaults empty parameters and metrics', function () {
        var o = _create();
        var r = o.recordExperiment({ id: 'e1', outcome: 'partial' });
        expect(r.experiment.parameters).toEqual({});
        expect(r.experiment.metrics).toEqual({});
    });

    test('stores tags as a copy', function () {
        var o = _create();
        var tags = ['bio', 'test'];
        o.recordExperiment({ id: 'e1', outcome: 'success', tags: tags });
        tags.push('mutated');
        expect(o.getExperimentCount()).toBe(1);
    });

    test('accepts all three outcome types', function () {
        var o = _create();
        expect(o.recordExperiment({ id: 'a', outcome: 'success' }).success).toBe(true);
        expect(o.recordExperiment({ id: 'b', outcome: 'partial' }).success).toBe(true);
        expect(o.recordExperiment({ id: 'c', outcome: 'failure' }).success).toBe(true);
        expect(o.getExperimentCount()).toBe(3);
    });
});

// ── Engine 2: Similarity Engine ────────────────────────────────────

describe('Similarity Engine', function () {
    test('finds similar experiments', function () {
        var o = _create();
        seedMixed(o);
        var r = o.findSimilar({ parameters: { temp: 22.5, pressure: 61 }, type: 'bioprint' });
        expect(r.count).toBeGreaterThan(0);
        expect(r.matches[0].similarity).toBeGreaterThan(0);
        expect(r.matches[0].distance).toBeGreaterThanOrEqual(0);
    });

    test('returns empty for no data', function () {
        var o = _create();
        var r = o.findSimilar({ parameters: { temp: 22 } });
        expect(r.matches).toEqual([]);
        expect(r.count).toBe(0);
    });

    test('returns empty for missing parameters', function () {
        var o = _create();
        var r = o.findSimilar(null);
        expect(r.count).toBe(0);
    });

    test('respects type filter', function () {
        var o = _create();
        seedMixed(o);
        var r = o.findSimilar({ parameters: { temp: 37 }, type: 'culture' });
        expect(r.count).toBeGreaterThan(0);
        r.matches.forEach(function (m) {
            expect(m.experiment.type).toBe('culture');
        });
    });

    test('respects limit', function () {
        var o = _create();
        seedMixed(o);
        var r = o.findSimilar({ parameters: { temp: 25 }, type: 'bioprint', limit: 2 });
        expect(r.count).toBeLessThanOrEqual(2);
    });

    test('sorts by distance ascending', function () {
        var o = _create();
        seedMixed(o);
        var r = o.findSimilar({ parameters: { temp: 23, pressure: 63 }, type: 'bioprint', limit: 5 });
        for (var i = 1; i < r.matches.length; i++) {
            expect(r.matches[i].distance).toBeGreaterThanOrEqual(r.matches[i - 1].distance);
        }
    });

    test('similarity is inverse of distance', function () {
        var o = _create();
        seedMixed(o);
        var r = o.findSimilar({ parameters: { temp: 22, pressure: 60 }, type: 'bioprint', limit: 1 });
        expect(r.matches[0].similarity).toBeGreaterThan(0.5);
    });
});

// ── Engine 3: Outcome Predictor ────────────────────────────────────

describe('Outcome Predictor', function () {
    test('predicts success for params near successes', function () {
        var o = _create();
        seedMixed(o);
        var r = o.predictOutcome({ parameters: { temp: 22.5, pressure: 61 }, type: 'bioprint' });
        expect(r.prediction).toBe('success');
        expect(r.probabilities.success).toBeGreaterThan(0.5);
        expect(r.confidence).toBeGreaterThan(0);
    });

    test('predicts failure for params near failures', function () {
        var o = _create();
        seedMixed(o);
        var r = o.predictOutcome({ parameters: { temp: 38.5, pressure: 142 }, type: 'bioprint' });
        expect(r.prediction).toBe('failure');
        expect(r.probabilities.failure).toBeGreaterThan(0.3);
    });

    test('returns default for empty DB', function () {
        var o = _create();
        var r = o.predictOutcome({ parameters: { temp: 22 } });
        expect(r.prediction).toBe('failure');
        expect(r.confidence).toBe(0);
        expect(r.matchCount).toBe(0);
    });

    test('returns default for null opts', function () {
        var o = _create();
        var r = o.predictOutcome(null);
        expect(r.matchCount).toBe(0);
    });

    test('provides top influencers', function () {
        var o = _create();
        seedMixed(o);
        var r = o.predictOutcome({ parameters: { temp: 23, pressure: 62 }, type: 'bioprint' });
        expect(r.topInfluencers.length).toBeGreaterThan(0);
        expect(r.topInfluencers.length).toBeLessThanOrEqual(3);
        expect(r.topInfluencers[0]).toHaveProperty('id');
        expect(r.topInfluencers[0]).toHaveProperty('outcome');
        expect(r.topInfluencers[0]).toHaveProperty('similarity');
    });

    test('probabilities sum to approximately 1', function () {
        var o = _create();
        seedMixed(o);
        var r = o.predictOutcome({ parameters: { temp: 30, pressure: 100 }, type: 'bioprint' });
        var sum = r.probabilities.success + r.probabilities.partial + r.probabilities.failure;
        expect(sum).toBeGreaterThan(0.95);
        expect(sum).toBeLessThanOrEqual(1.05);
    });

    test('respects custom k', function () {
        var o = _create();
        seedMixed(o);
        var r = o.predictOutcome({ parameters: { temp: 25, pressure: 70 }, type: 'bioprint', k: 3 });
        expect(r.matchCount).toBeLessThanOrEqual(3);
    });

    test('works with no matching type', function () {
        var o = _create();
        seedMixed(o);
        var r = o.predictOutcome({ parameters: { temp: 22 }, type: 'nonexistent' });
        expect(r.matchCount).toBe(0);
        expect(r.confidence).toBe(0);
    });
});

// ── Engine 4: Metric Forecaster ────────────────────────────────────

describe('Metric Forecaster', function () {
    test('forecasts yield and viability', function () {
        var o = _create();
        seedMixed(o);
        var r = o.forecastMetrics({ parameters: { temp: 22.5, pressure: 61 }, type: 'bioprint' });
        expect(r.forecasts).toHaveProperty('yield');
        expect(r.forecasts).toHaveProperty('viability');
        expect(r.forecasts.yield.predicted).toBeGreaterThan(0);
        expect(r.forecasts.yield.sampleSize).toBeGreaterThan(0);
    });

    test('provides confidence intervals', function () {
        var o = _create();
        seedMixed(o);
        var r = o.forecastMetrics({ parameters: { temp: 23, pressure: 63 }, type: 'bioprint' });
        expect(r.forecasts.yield.range).toHaveLength(2);
        expect(r.forecasts.yield.range[0]).toBeLessThanOrEqual(r.forecasts.yield.predicted);
        expect(r.forecasts.yield.range[1]).toBeGreaterThanOrEqual(r.forecasts.yield.predicted);
    });

    test('returns empty for no data', function () {
        var o = _create();
        var r = o.forecastMetrics({ parameters: { temp: 22 } });
        expect(r.forecasts).toEqual({});
        expect(r.confidence).toBe(0);
    });

    test('returns empty for null opts', function () {
        var o = _create();
        var r = o.forecastMetrics(null);
        expect(r.confidence).toBe(0);
    });

    test('higher predicted yield near success region', function () {
        var o = _create();
        seedMixed(o);
        var good = o.forecastMetrics({ parameters: { temp: 22, pressure: 60 }, type: 'bioprint' });
        var bad = o.forecastMetrics({ parameters: { temp: 38, pressure: 140 }, type: 'bioprint' });
        expect(good.forecasts.yield.predicted).toBeGreaterThan(bad.forecasts.yield.predicted);
    });

    test('stdDev is non-negative', function () {
        var o = _create();
        seedMixed(o);
        var r = o.forecastMetrics({ parameters: { temp: 30, pressure: 100 }, type: 'bioprint' });
        var keys = Object.keys(r.forecasts);
        keys.forEach(function (k) {
            expect(r.forecasts[k].stdDev).toBeGreaterThanOrEqual(0);
        });
    });
});

// ── Engine 5: Risk Assessor ────────────────────────────────────────

describe('Risk Assessor', function () {
    test('low risk for safe parameters', function () {
        var o = _create();
        seedMixed(o);
        var r = o.assessRisk({ parameters: { temp: 23, pressure: 63 }, type: 'bioprint' });
        expect(r.riskScore).toBeLessThan(50);
        expect(r.tier).toBe('Low');
    });

    test('high risk near failure region', function () {
        var o = _create();
        seedMixed(o);
        var r = o.assessRisk({ parameters: { temp: 38.5, pressure: 142 }, type: 'bioprint' });
        expect(r.riskScore).toBeGreaterThan(0);
        expect(r.risks.length).toBeGreaterThan(0);
    });

    test('high risk for no historical data', function () {
        var o = _create();
        var r = o.assessRisk({ parameters: { temp: 30 }, type: 'nonexistent' });
        expect(r.riskScore).toBe(75);
        expect(r.tier).toBe('High');
    });

    test('returns risks for extreme parameters', function () {
        var o = _create();
        seedMixed(o);
        var r = o.assessRisk({ parameters: { temp: 50, pressure: 200 }, type: 'bioprint' });
        var hasExtremity = r.risks.some(function (risk) { return risk.category === 'parameterExtremity'; });
        expect(hasExtremity).toBe(true);
    });

    test('detects unknown territory', function () {
        var o = _create();
        seedMixed(o);
        var r = o.assessRisk({ parameters: { temp: 23, pressure: 60, newParam: 42 }, type: 'bioprint' });
        var hasUnknown = r.risks.some(function (risk) { return risk.category === 'unknownTerritory'; });
        expect(hasUnknown).toBe(true);
    });

    test('provides mitigations', function () {
        var o = _create();
        seedMixed(o);
        var r = o.assessRisk({ parameters: { temp: 50, pressure: 200, unknownX: 5 }, type: 'bioprint' });
        expect(r.mitigations.length).toBeGreaterThan(0);
    });

    test('handles null opts', function () {
        var o = _create();
        var r = o.assessRisk(null);
        expect(r.riskScore).toBe(50);
        expect(r.tier).toBe('Moderate');
    });

    test('risk score is 0-100', function () {
        var o = _create();
        seedPrintExperiments(o, 30);
        var r = o.assessRisk({ parameters: { temperature: 25, pressure: 70, speed: 10 }, type: 'bioprint' });
        expect(r.riskScore).toBeGreaterThanOrEqual(0);
        expect(r.riskScore).toBeLessThanOrEqual(100);
    });
});

// ── Engine 6: Oracle Health Scorer ─────────────────────────────────

describe('Oracle Health Scorer', function () {
    test('returns zero for empty KB', function () {
        var o = _create();
        var h = o.getHealth();
        expect(h.score).toBe(0);
        expect(h.tier).toBe('Critical');
        expect(h.insights.length).toBeGreaterThan(0);
    });

    test('score increases with data', function () {
        var o = _create();
        o.recordExperiment({ id: 'e1', outcome: 'success', parameters: { x: 1 } });
        var h1 = o.getHealth();
        seedPrintExperiments(o, 20);
        var h2 = o.getHealth();
        expect(h2.score).toBeGreaterThan(h1.score);
    });

    test('has all five dimensions', function () {
        var o = _create();
        seedMixed(o);
        var h = o.getHealth();
        expect(h.dimensions).toHaveProperty('volume');
        expect(h.dimensions).toHaveProperty('coverage');
        expect(h.dimensions).toHaveProperty('balance');
        expect(h.dimensions).toHaveProperty('freshness');
        expect(h.dimensions).toHaveProperty('diversity');
    });

    test('score is 0-100', function () {
        var o = _create();
        seedPrintExperiments(o, 50);
        var h = o.getHealth();
        expect(h.score).toBeGreaterThanOrEqual(0);
        expect(h.score).toBeLessThanOrEqual(100);
    });

    test('tier matches score', function () {
        var o = _create();
        seedPrintExperiments(o, 50);
        var h = o.getHealth();
        if (h.score <= 20) expect(h.tier).toBe('Critical');
        else if (h.score <= 40) expect(h.tier).toBe('Poor');
        else if (h.score <= 60) expect(h.tier).toBe('Fair');
        else if (h.score <= 80) expect(h.tier).toBe('Good');
        else expect(h.tier).toBe('Excellent');
    });

    test('low volume triggers insight', function () {
        var o = _create();
        o.recordExperiment({ id: 'e1', outcome: 'success', parameters: { x: 1 } });
        var h = o.getHealth();
        var hasVolumeInsight = h.insights.some(function (i) { return i.indexOf('volume') !== -1 || i.indexOf('Low') !== -1; });
        expect(hasVolumeInsight).toBe(true);
    });
});

// ── Engine 7: Insight Generator ────────────────────────────────────

describe('Insight Generator', function () {
    test('warns on insufficient data', function () {
        var o = _create();
        o.recordExperiment({ id: 'e1', outcome: 'success' });
        var r = o.generateInsights();
        expect(r.insights.length).toBeGreaterThan(0);
        expect(r.insights[0].type).toBe('warning');
    });

    test('finds golden parameters', function () {
        var o = _create();
        seedMixed(o);
        var r = o.generateInsights({ type: 'bioprint' });
        var golden = r.insights.filter(function (i) { return i.type === 'golden_parameters'; });
        expect(golden.length).toBeGreaterThan(0);
        expect(golden[0].evidence).toHaveProperty('parameter');
    });

    test('finds danger zones', function () {
        var o = _create();
        seedMixed(o);
        var r = o.generateInsights({ type: 'bioprint' });
        var dangers = r.insights.filter(function (i) { return i.type === 'danger_zone'; });
        expect(dangers.length).toBeGreaterThan(0);
    });

    test('detects sensitivity', function () {
        var o = _create();
        seedMixed(o);
        var r = o.generateInsights({ type: 'bioprint' });
        var sens = r.insights.filter(function (i) { return i.type === 'sensitivity'; });
        expect(sens.length).toBeGreaterThan(0);
    });

    test('detects trends with enough data', function () {
        var o = _create();
        // Record declining outcomes over time
        for (var i = 0; i < 10; i++) {
            o.recordExperiment({
                id: 'trend-' + i,
                type: 'trending',
                parameters: { x: i },
                outcome: i < 5 ? 'success' : 'failure',
                timestamp: Date.now() - (10 - i) * 86400000
            });
        }
        var r = o.generateInsights({ type: 'trending' });
        var trends = r.insights.filter(function (i) { return i.type === 'trending'; });
        expect(trends.length).toBeGreaterThan(0);
        expect(trends[0].evidence.trend).toBe('declining');
    });

    test('has generatedAt timestamp', function () {
        var o = _create();
        seedMixed(o);
        var r = o.generateInsights();
        expect(r.generatedAt).toBeGreaterThan(0);
    });

    test('handles type filter with insufficient data', function () {
        var o = _create();
        seedMixed(o);
        var r = o.generateInsights({ type: 'nonexistent' });
        expect(r.insights[0].type).toBe('warning');
    });
});

// ── Stats & Reset ──────────────────────────────────────────────────

describe('Stats and Reset', function () {
    test('getStats returns correct counts', function () {
        var o = _create();
        seedMixed(o);
        var s = o.getStats();
        expect(s.totalExperiments).toBe(8);
        expect(s.types.bioprint).toBe(6);
        expect(s.types.culture).toBe(2);
        expect(s.outcomes.success).toBe(5);
        expect(s.outcomes.failure).toBe(2);
        expect(s.outcomes.partial).toBe(1);
    });

    test('reset clears all data', function () {
        var o = _create();
        seedMixed(o);
        expect(o.getExperimentCount()).toBe(8);
        o.reset();
        expect(o.getExperimentCount()).toBe(0);
        expect(o.getStats().totalExperiments).toBe(0);
    });

    test('oracle works after reset', function () {
        var o = _create();
        seedMixed(o);
        o.reset();
        var r = o.recordExperiment({ id: 'new1', outcome: 'success', parameters: { x: 1 } });
        expect(r.success).toBe(true);
        expect(o.getExperimentCount()).toBe(1);
    });
});

// ── Edge Cases ─────────────────────────────────────────────────────

describe('Edge Cases', function () {
    test('single experiment prediction', function () {
        var o = _create();
        o.recordExperiment({ id: 'solo', outcome: 'success', parameters: { temp: 25 } });
        var r = o.predictOutcome({ parameters: { temp: 25 } });
        expect(r.prediction).toBe('success');
        expect(r.matchCount).toBe(1);
    });

    test('all same outcome', function () {
        var o = _create();
        for (var i = 0; i < 5; i++) {
            o.recordExperiment({ id: 'same-' + i, outcome: 'success', parameters: { x: i * 10 } });
        }
        var r = o.predictOutcome({ parameters: { x: 25 } });
        expect(r.prediction).toBe('success');
        expect(r.probabilities.success).toBe(1);
    });

    test('forecast with single metric', function () {
        var o = _create();
        o.recordExperiment({ id: 'e1', outcome: 'success', parameters: { x: 10 }, metrics: { yield: 80 } });
        o.recordExperiment({ id: 'e2', outcome: 'success', parameters: { x: 12 }, metrics: { yield: 85 } });
        var r = o.forecastMetrics({ parameters: { x: 11 } });
        expect(r.forecasts.yield.predicted).toBeGreaterThan(0);
        expect(r.forecasts.yield.stdDev).toBeGreaterThanOrEqual(0);
    });

    test('non-numeric parameters are ignored in distance', function () {
        var o = _create();
        o.recordExperiment({ id: 'e1', outcome: 'success', parameters: { x: 10, label: 'a' } });
        o.recordExperiment({ id: 'e2', outcome: 'failure', parameters: { x: 50, label: 'b' } });
        var r = o.findSimilar({ parameters: { x: 10, label: 'c' } });
        expect(r.matches.length).toBe(2);
        expect(r.matches[0].experiment.id).toBe('e1');
    });

    test('many experiments performance', function () {
        var o = _create();
        seedPrintExperiments(o, 100);
        expect(o.getExperimentCount()).toBe(100);
        var r = o.predictOutcome({ parameters: { temperature: 25, pressure: 70, speed: 10 }, type: 'bioprint' });
        expect(r.matchCount).toBeGreaterThan(0);
    });
});
