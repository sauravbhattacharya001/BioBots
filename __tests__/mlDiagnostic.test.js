/**
 * Tests for ML-Based Pattern Recognition (mlDiagnostic.js)
 */

'use strict';

const { createMLDiagnostic } = require('../Try/scripts/mlDiagnostic');
const { createFailureDiagnostic } = require('../Try/scripts/failureDiagnostic');

describe('createMLDiagnostic', () => {
  let ml;
  let diag;

  beforeEach(() => {
    ml = createMLDiagnostic();
    diag = createFailureDiagnostic();
  });

  describe('recordOutcome', () => {
    test('records a valid outcome', () => {
      const result = diag.diagnose(['nozzle_clog'], { pressure: 200 });
      ml.recordOutcome(result, 'high_pressure', true);

      const stats = ml.getStats();
      expect(stats.totalOutcomes).toBe(1);
      expect(stats.successfulFixes).toBe(1);
    });

    test('tracks failures correctly', () => {
      const result = diag.diagnose(['cell_death']);
      ml.recordOutcome(result, 'high_shear', false);

      const stats = ml.getStats();
      expect(stats.failedFixes).toBe(1);
    });

    test('throws on invalid diagnosis result', () => {
      expect(() => ml.recordOutcome(null, 'x', true)).toThrow('Invalid diagnosis result');
      expect(() => ml.recordOutcome({}, 'x', true)).toThrow('Invalid diagnosis result');
    });

    test('throws on invalid appliedCause', () => {
      const result = diag.diagnose(['nozzle_clog']);
      expect(() => ml.recordOutcome(result, '', true)).toThrow('appliedCause must be a non-empty string');
      expect(() => ml.recordOutcome(result, 123, true)).toThrow('appliedCause must be a non-empty string');
    });

    test('throws on non-boolean fixWorked', () => {
      const result = diag.diagnose(['nozzle_clog']);
      expect(() => ml.recordOutcome(result, 'x', 'yes')).toThrow('fixWorked must be a boolean');
    });

    test('records with metadata', () => {
      const result = diag.diagnose(['warping']);
      ml.recordOutcome(result, 'low_humidity', true, { operator: 'test' });
      expect(ml.getStats().totalOutcomes).toBe(1);
    });
  });

  describe('getCalibratedConfidence', () => {
    test('returns prior when no data exists', () => {
      const cal = ml.getCalibratedConfidence('nozzle_clog', 'high_pressure', 0.5);
      expect(cal.calibrated).toBe(0.5);
      expect(cal.sampleSize).toBe(0);
      expect(cal.successRate).toBeNull();
    });

    test('calibrates upward with successful outcomes', () => {
      const result = diag.diagnose(['nozzle_clog']);
      // Record 5 successes
      for (let i = 0; i < 5; i++) {
        ml.recordOutcome(result, 'high_pressure', true);
      }

      const cal = ml.getCalibratedConfidence('nozzle_clog', 'high_pressure', 0.5);
      expect(cal.calibrated).toBeGreaterThan(0.5);
      expect(cal.sampleSize).toBe(5);
      expect(cal.successRate).toBe(1.0);
    });

    test('calibrates downward with failed outcomes', () => {
      const result = diag.diagnose(['nozzle_clog']);
      for (let i = 0; i < 5; i++) {
        ml.recordOutcome(result, 'narrow_nozzle', false);
      }

      const cal = ml.getCalibratedConfidence('nozzle_clog', 'narrow_nozzle', 0.6);
      expect(cal.calibrated).toBeLessThan(0.6);
      expect(cal.successRate).toBe(0);
    });

    test('defaults prior to 0.5 when not provided', () => {
      const cal = ml.getCalibratedConfidence('nozzle_clog', 'high_pressure');
      expect(cal.prior).toBe(0.5);
    });
  });

  describe('getAllCalibrationsForSymptom', () => {
    test('returns empty array with no data', () => {
      expect(ml.getAllCalibrationsForSymptom('nozzle_clog')).toEqual([]);
    });

    test('returns all cause calibrations for a symptom', () => {
      const r1 = diag.diagnose(['nozzle_clog']);
      ml.recordOutcome(r1, 'high_pressure', true);
      ml.recordOutcome(r1, 'narrow_nozzle', false);

      const cals = ml.getAllCalibrationsForSymptom('nozzle_clog');
      expect(cals.length).toBe(2);
      expect(cals[0].calibrated).toBeGreaterThanOrEqual(cals[1].calibrated);
    });
  });

  describe('detectAnomalies', () => {
    test('flags everything as anomalous with no history', () => {
      const result = ml.detectAnomalies(['nozzle_clog']);
      expect(result.isAnomaly).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.nearestMatch).toBeNull();
    });

    test('recognizes known patterns', () => {
      const r = diag.diagnose(['nozzle_clog', 'under_extrusion']);
      ml.recordOutcome(r, 'narrow_nozzle', true);

      const result = ml.detectAnomalies(['nozzle_clog', 'under_extrusion']);
      expect(result.isAnomaly).toBe(false);
      expect(result.similarity).toBe(1.0);
    });

    test('flags novel symptom combinations', () => {
      // Record a pattern
      const r = diag.diagnose(['nozzle_clog']);
      ml.recordOutcome(r, 'high_pressure', true);

      // Check a very different combination
      const result = ml.detectAnomalies(['dehydration', 'contamination']);
      expect(result.isAnomaly).toBe(true);
      expect(result.similarity).toBeLessThan(0.5);
    });

    test('throws on invalid input', () => {
      expect(() => ml.detectAnomalies([])).toThrow();
      expect(() => ml.detectAnomalies('nozzle_clog')).toThrow();
    });

    test('respects custom threshold', () => {
      const r = diag.diagnose(['nozzle_clog']);
      ml.recordOutcome(r, 'high_pressure', true);

      // With very high threshold, even similar things are anomalous
      const result = ml.detectAnomalies(['nozzle_clog', 'under_extrusion'], { threshold: 0.99 });
      expect(result.isAnomaly).toBe(true);
    });
  });

  describe('clusterDiagnoses', () => {
    test('requires minimum 3 diagnoses', () => {
      const result = ml.clusterDiagnoses();
      expect(result.clusters).toEqual([]);
      expect(result.k).toBe(0);
    });

    test('clusters diagnoses into groups', () => {
      // Create distinct patterns
      const symptoms1 = ['nozzle_clog', 'under_extrusion'];
      const symptoms2 = ['cell_death', 'contamination'];
      const symptoms3 = ['warping', 'dehydration'];

      for (let i = 0; i < 3; i++) {
        ml.recordOutcome(diag.diagnose(symptoms1), 'narrow_nozzle', true);
        ml.recordOutcome(diag.diagnose(symptoms2), 'non_sterile', true);
        ml.recordOutcome(diag.diagnose(symptoms3), 'low_humidity', true);
      }

      const result = ml.clusterDiagnoses();
      expect(result.clusters.length).toBeGreaterThanOrEqual(2);
      expect(result.k).toBeGreaterThanOrEqual(2);

      // Each cluster should have a dominant cause
      for (const cluster of result.clusters) {
        expect(cluster.dominantCause).not.toBeNull();
        expect(cluster.size).toBeGreaterThan(0);
      }
    });

    test('respects custom k', () => {
      for (let i = 0; i < 4; i++) {
        ml.recordOutcome(diag.diagnose(['nozzle_clog']), 'high_pressure', true);
        ml.recordOutcome(diag.diagnose(['cell_death']), 'high_shear', true);
      }

      const result = ml.clusterDiagnoses({ k: 2 });
      expect(result.k).toBe(2);
    });
  });

  describe('suggestNewRules', () => {
    test('requires clustering first', () => {
      const result = ml.suggestNewRules([]);
      expect(result.message).toBe('Run clusterDiagnoses() first');
    });

    test('throws on invalid input', () => {
      expect(() => ml.suggestNewRules('not array')).toThrow();
    });

    test('returns suggestions array after clustering', () => {
      // Build up enough data
      for (let i = 0; i < 5; i++) {
        ml.recordOutcome(diag.diagnose(['nozzle_clog', 'cell_death']), 'bioink_degradation', true);
        ml.recordOutcome(diag.diagnose(['warping', 'stringing']), 'high_temperature', true);
      }
      ml.clusterDiagnoses();

      const result = ml.suggestNewRules([]);
      expect(result.suggestions).toBeDefined();
      expect(Array.isArray(result.suggestions)).toBe(true);
    });
  });

  describe('enhance', () => {
    test('enhances a diagnosis with ML insights', () => {
      // Build some history
      const r1 = diag.diagnose(['nozzle_clog'], { pressure: 200 });
      ml.recordOutcome(r1, 'high_pressure', true);
      ml.recordOutcome(r1, 'high_pressure', true);

      const r2 = diag.diagnose(['nozzle_clog', 'under_extrusion']);
      const enhanced = ml.enhance(r2);

      expect(enhanced.ml).toBeDefined();
      expect(enhanced.ml.anomaly).toBeDefined();
      expect(enhanced.ml.outcomeCount).toBe(2);
      expect(enhanced.ml.calibrationApplied).toBe(true);

      // Should have calibrated diagnoses
      for (const d of enhanced.diagnoses) {
        expect(d.originalConfidence).toBeDefined();
        expect(d.calibratedConfidence).toBeDefined();
        expect(d.calibrationDelta).toBeDefined();
      }
    });

    test('throws on invalid input', () => {
      expect(() => ml.enhance(null)).toThrow();
      expect(() => ml.enhance({})).toThrow();
    });

    test('works with no prior data', () => {
      const r = diag.diagnose(['poor_adhesion']);
      const enhanced = ml.enhance(r);
      expect(enhanced.ml.outcomeCount).toBe(0);
      expect(enhanced.ml.calibrationApplied).toBe(false);
    });
  });

  describe('state management', () => {
    test('exportState and importState roundtrip', () => {
      const r = diag.diagnose(['nozzle_clog']);
      ml.recordOutcome(r, 'high_pressure', true);
      ml.recordOutcome(r, 'narrow_nozzle', false);

      const state = ml.exportState();
      expect(state.outcomes.length).toBe(2);

      const ml2 = createMLDiagnostic();
      ml2.importState(state);
      expect(ml2.getStats().totalOutcomes).toBe(2);
    });

    test('importState throws on null', () => {
      expect(() => ml.importState(null)).toThrow();
    });

    test('reset clears all state', () => {
      const r = diag.diagnose(['nozzle_clog']);
      ml.recordOutcome(r, 'high_pressure', true);
      expect(ml.getStats().totalOutcomes).toBe(1);

      ml.reset();
      expect(ml.getStats().totalOutcomes).toBe(0);
      expect(ml.getStats().uniqueSymptomCausePairs).toBe(0);
    });
  });

  describe('getStats', () => {
    test('returns correct stats', () => {
      const r = diag.diagnose(['warping', 'dehydration']);
      ml.recordOutcome(r, 'low_humidity', true);
      ml.recordOutcome(r, 'high_temperature', false);
      ml.recordOutcome(r, 'low_humidity', true);

      const stats = ml.getStats();
      expect(stats.totalOutcomes).toBe(3);
      expect(stats.successfulFixes).toBe(2);
      expect(stats.failedFixes).toBe(1);
      expect(stats.overallSuccessRate).toBeCloseTo(0.667, 2);
      expect(stats.uniqueSymptomCausePairs).toBeGreaterThan(0);
    });

    test('handles empty state', () => {
      const stats = ml.getStats();
      expect(stats.totalOutcomes).toBe(0);
      expect(stats.overallSuccessRate).toBeNull();
    });
  });
});
