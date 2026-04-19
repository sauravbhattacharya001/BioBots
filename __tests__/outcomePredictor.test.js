'use strict';

var op = require('../docs/shared/outcomePredictor');

describe('OutcomePredictor', function () {
  var predictor;

  beforeEach(function () {
    predictor = op.createOutcomePredictor();
  });

  describe('recordOutcome()', function () {
    test('throws without success boolean', function () {
      expect(function () { predictor.recordOutcome({}); }).toThrow();
      expect(function () { predictor.recordOutcome(null); }).toThrow();
    });

    test('records a valid outcome and returns stats', function () {
      var result = predictor.recordOutcome({
        material: 'alginate', temperature: 30, success: true
      });
      expect(result.recorded).toBe(true);
      expect(result.materialStats.total).toBe(1);
      expect(result.materialStats.rate).toBe(1);
    });

    test('normalizes material names (lowercase + underscore)', function () {
      predictor.recordOutcome({ material: 'Hyaluronic Acid', success: true });
      var stats = predictor.getStats();
      expect(stats.materials[0].material).toBe('hyaluronic_acid');
    });

    test('tracks multiple outcomes correctly', function () {
      predictor.recordOutcome({ material: 'alginate', success: true });
      predictor.recordOutcome({ material: 'alginate', success: false });
      predictor.recordOutcome({ material: 'alginate', success: true });
      var stats = predictor.getStats();
      var alg = stats.materials.find(function (m) { return m.material === 'alginate'; });
      expect(alg.total).toBe(3);
      expect(alg.successes).toBe(2);
    });
  });

  describe('predict()', function () {
    test('throws without params', function () {
      expect(function () { predictor.predict(); }).toThrow();
    });

    test('returns prediction with required fields', function () {
      var pred = predictor.predict({ material: 'alginate', temperature: 30, speed: 10 });
      expect(pred).toHaveProperty('probability');
      expect(pred).toHaveProperty('riskLevel');
      expect(pred).toHaveProperty('confidence');
      expect(pred).toHaveProperty('risks');
      expect(pred).toHaveProperty('suggestions');
      expect(pred).toHaveProperty('breakdown');
    });

    test('optimal params yield high probability', function () {
      var pred = predictor.predict({
        material: 'alginate', temperature: 28, cellDensity: 2e6,
        speed: 12, pressure: 25, layerHeight: 0.2, nozzleDiameter: 0.4
      });
      expect(pred.probability).toBeGreaterThanOrEqual(0.7);
      expect(pred.profileAvailable).toBe(true);
    });

    test('out-of-range params yield lower probability and risks', function () {
      var pred = predictor.predict({
        material: 'alginate', temperature: 50, speed: 100, pressure: 200
      });
      expect(pred.probability).toBeLessThan(0.7);
      expect(pred.risks.length).toBeGreaterThan(0);
      expect(pred.suggestions.length).toBeGreaterThan(0);
    });

    test('unknown material flags info risk', function () {
      var pred = predictor.predict({ material: 'unobtanium', temperature: 25 });
      expect(pred.profileAvailable).toBe(false);
      var matRisk = pred.risks.find(function (r) { return r.parameter === 'material'; });
      expect(matRisk).toBeDefined();
      expect(matRisk.severity).toBe('info');
    });

    test('historical data improves confidence', function () {
      for (var i = 0; i < 20; i++) {
        predictor.recordOutcome({ material: 'gelatin', temperature: 30, speed: 10, pressure: 30, success: i % 3 !== 0 });
      }
      var pred = predictor.predict({ material: 'gelatin', temperature: 30, speed: 10, pressure: 30 });
      expect(pred.matchingExperiments).toBeGreaterThan(0);
      expect(['moderate', 'high', 'very high']).toContain(pred.confidence);
    });

    test('similar-parameter matching refines prediction', function () {
      // Record successes at temp=30 and failures at temp=45
      for (var i = 0; i < 10; i++) {
        predictor.recordOutcome({ material: 'alginate', temperature: 30, speed: 10, pressure: 25, cellDensity: 2e6, success: true });
        predictor.recordOutcome({ material: 'alginate', temperature: 45, speed: 10, pressure: 25, cellDensity: 2e6, success: false });
      }
      var goodPred = predictor.predict({ material: 'alginate', temperature: 30, speed: 10, pressure: 25, cellDensity: 2e6 });
      var badPred = predictor.predict({ material: 'alginate', temperature: 45, speed: 10, pressure: 25, cellDensity: 2e6 });
      expect(goodPred.probability).toBeGreaterThan(badPred.probability);
    });

    test('risk levels follow probability thresholds', function () {
      // High probability
      var pred = predictor.predict({
        material: 'alginate', temperature: 28, cellDensity: 2e6,
        speed: 12, pressure: 25, layerHeight: 0.2, nozzleDiameter: 0.4
      });
      if (pred.probability >= 0.8) expect(pred.riskLevel).toBe('LOW');
      else if (pred.probability >= 0.6) expect(pred.riskLevel).toBe('MODERATE');
    });

    test('risks sorted by severity', function () {
      var pred = predictor.predict({
        material: 'alginate', temperature: 60, speed: 200, pressure: 300, cellDensity: 1
      });
      var severityOrder = { critical: 0, warning: 1, info: 2 };
      for (var i = 1; i < pred.risks.length; i++) {
        expect(severityOrder[pred.risks[i - 1].severity]).toBeLessThanOrEqual(
          severityOrder[pred.risks[i].severity]
        );
      }
    });
  });

  describe('getStats()', function () {
    test('returns N/A with no data', function () {
      var stats = predictor.getStats();
      expect(stats.totalExperiments).toBe(0);
      expect(stats.overallSuccessRate).toBe('N/A');
    });

    test('computes correct overall rate', function () {
      predictor.recordOutcome({ material: 'alginate', success: true });
      predictor.recordOutcome({ material: 'alginate', success: false });
      var stats = predictor.getStats();
      expect(stats.totalExperiments).toBe(2);
      expect(stats.overallSuccessRate).toBe('50%');
    });
  });

  describe('analyzeFailurePatterns()', function () {
    test('returns no patterns with no failures', function () {
      for (var i = 0; i < 5; i++) {
        predictor.recordOutcome({ material: 'alginate', temperature: 30, success: true });
      }
      var analysis = predictor.analyzeFailurePatterns();
      expect(analysis.patterns.length).toBe(0);
    });

    test('detects parameter drift in failures', function () {
      // Successes at temp=30, failures at temp=45
      for (var i = 0; i < 10; i++) {
        predictor.recordOutcome({ material: 'alginate', temperature: 30, success: true });
        predictor.recordOutcome({ material: 'alginate', temperature: 45, success: false });
      }
      var analysis = predictor.analyzeFailurePatterns();
      expect(analysis.failures).toBe(10);
      expect(analysis.patterns.length).toBeGreaterThan(0);
      var tempPattern = analysis.patterns.find(function (p) { return p.parameter === 'temperature'; });
      expect(tempPattern).toBeDefined();
      expect(tempPattern.direction).toBe('too high');
    });

    test('patterns sorted by drift percent descending', function () {
      for (var i = 0; i < 10; i++) {
        predictor.recordOutcome({ material: 'alginate', temperature: 30, speed: 10, success: true });
        predictor.recordOutcome({ material: 'alginate', temperature: 50, speed: 40, success: false });
      }
      var analysis = predictor.analyzeFailurePatterns();
      for (var j = 1; j < analysis.patterns.length; j++) {
        expect(parseFloat(analysis.patterns[j - 1].driftPercent))
          .toBeGreaterThanOrEqual(parseFloat(analysis.patterns[j].driftPercent));
      }
    });

    test('respects recentN parameter', function () {
      for (var i = 0; i < 30; i++) {
        predictor.recordOutcome({ material: 'alginate', temperature: 30, success: true });
      }
      for (var j = 0; j < 5; j++) {
        predictor.recordOutcome({ material: 'alginate', temperature: 45, success: false });
      }
      var analysis = predictor.analyzeFailurePatterns(5);
      expect(analysis.recentExperiments).toBe(5);
      expect(analysis.failures).toBe(5);
    });
  });

  describe('getSupportedMaterials()', function () {
    test('returns array of known materials', function () {
      var mats = predictor.getSupportedMaterials();
      expect(mats).toContain('alginate');
      expect(mats).toContain('gelatin');
      expect(mats).toContain('collagen');
      expect(mats).toContain('fibrin');
      expect(mats).toContain('hyaluronic_acid');
    });
  });

  describe('loadHistory()', function () {
    test('throws on non-array', function () {
      expect(function () { predictor.loadHistory('bad'); }).toThrow();
    });

    test('loads valid experiments and skips invalid', function () {
      var result = predictor.loadHistory([
        { material: 'alginate', success: true },
        { material: 'gelatin', success: false },
        { invalid: true }, // no success field
        null,
      ]);
      expect(result.loaded).toBe(2);
      expect(result.skipped).toBe(2);
      expect(predictor.getStats().totalExperiments).toBe(2);
    });
  });

  describe('percentage format', function () {
    test('prediction percentage ends with %', function () {
      var pred = predictor.predict({ material: 'alginate', temperature: 30 });
      expect(pred.percentage).toMatch(/%$/);
    });
  });
});
