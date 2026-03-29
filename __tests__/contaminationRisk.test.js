'use strict';

var contaminationRisk = require('../docs/shared/contaminationRisk');

describe('ContaminationRiskScorer', function () {
    var scorer;

    beforeEach(function () {
        scorer = contaminationRisk.createContaminationRiskScorer();
    });

    test('ideal conditions produce low risk score', function () {
        var result = scorer.score({
            temperature: 22,
            humidity: 45,
            particleCount: 1000,
            airChangesPerHour: 30,
            lastCleaningHoursAgo: 1,
            openContainerMinutes: 5,
            personnelCount: 1,
            gowningCompliance: 100,
            mediaAge: 3,
            priorIncidents30d: 0
        });
        expect(result.score).toBeLessThanOrEqual(20);
        expect(result.level).toBe('LOW');
        expect(result.recommendations).toHaveLength(0);
    });

    test('poor conditions produce high risk score', function () {
        var result = scorer.score({
            temperature: 35,
            humidity: 90,
            particleCount: 50000,
            lastCleaningHoursAgo: 48,
            gowningCompliance: 20,
            priorIncidents30d: 5
        });
        expect(result.score).toBeGreaterThan(60);
        expect(['HIGH', 'CRITICAL']).toContain(result.level);
        expect(result.recommendations.length).toBeGreaterThan(0);
    });

    test('throws on empty conditions', function () {
        expect(function () { scorer.score({}); }).toThrow('At least one');
    });

    test('throws on null input', function () {
        expect(function () { scorer.score(null); }).toThrow('conditions must be');
    });

    test('compare shows improvement', function () {
        var result = scorer.compare(
            { temperature: 35, humidity: 90 },
            { temperature: 22, humidity: 45 }
        );
        expect(result.improved).toBe(true);
        expect(result.improvement).toBeGreaterThan(0);
    });

    test('listFactors returns all factors', function () {
        var factors = scorer.listFactors();
        expect(factors.length).toBe(10);
        expect(factors[0]).toHaveProperty('name');
        expect(factors[0]).toHaveProperty('weight');
    });

    test('history tracks scores', function () {
        scorer.score({ temperature: 22 });
        scorer.score({ temperature: 35 });
        var history = scorer.getHistory();
        expect(history).toHaveLength(2);
    });

    test('reset clears history', function () {
        scorer.score({ temperature: 22 });
        scorer.reset();
        expect(scorer.getHistory()).toHaveLength(0);
    });

    test('factors sorted by contribution descending', function () {
        var result = scorer.score({
            temperature: 22,
            humidity: 95,
            particleCount: 100000
        });
        for (var i = 1; i < result.factors.length; i++) {
            expect(result.factors[i - 1].contribution)
                .toBeGreaterThanOrEqual(result.factors[i].contribution);
        }
    });
});
