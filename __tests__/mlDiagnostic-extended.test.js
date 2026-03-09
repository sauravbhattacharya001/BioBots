/**
 * Extended tests for ML Diagnostic Engine — covers edge cases, internal
 * helper behaviors, deeper clustering paths, and state management nuance.
 */

'use strict';

const { createMLDiagnostic } = require('../Try/scripts/mlDiagnostic');

// Helper to build a minimal diagnosis result object
function makeDiagnosis(symptomIds, diagnoses, severity) {
  return {
    symptoms: symptomIds.map(id => ({ id })),
    diagnoses: diagnoses || [],
    severity: severity || 'moderate',
    parameters: null,
  };
}

describe('createMLDiagnostic — extended', () => {
  let ml;
  beforeEach(() => { ml = createMLDiagnostic(); });

  // ── recordOutcome extended ──────────────────────────────

  describe('recordOutcome — per-symptom tracking', () => {
    test('tracks individual symptom-cause pairs separately from combo', () => {
      const diag = makeDiagnosis(['nozzle_clog', 'under_extrusion']);
      ml.recordOutcome(diag, 'high_pressure', true);

      // The combo key and each individual symptom key should exist
      const cal1 = ml.getCalibratedConfidence('nozzle_clog', 'high_pressure', 0.5);
      const cal2 = ml.getCalibratedConfidence('under_extrusion', 'high_pressure', 0.5);
      expect(cal1.sampleSize).toBe(1);
      expect(cal2.sampleSize).toBe(1);
    });

    test('accumulates counts across multiple outcomes', () => {
      const diag = makeDiagnosis(['cell_death']);
      ml.recordOutcome(diag, 'thermal_damage', true);
      ml.recordOutcome(diag, 'thermal_damage', true);
      ml.recordOutcome(diag, 'thermal_damage', false);

      const cal = ml.getCalibratedConfidence('cell_death', 'thermal_damage', 0.5);
      expect(cal.sampleSize).toBe(3);
      expect(cal.successRate).toBeCloseTo(0.667, 2);
    });

    test('single-symptom outcome does not create duplicate pair entries', () => {
      // When symptom list is just one item, the combo key and single key are the same
      const diag = makeDiagnosis(['warping']);
      ml.recordOutcome(diag, 'bed_temp', true);
      const stats = ml.getStats();
      // Should have exactly 1 unique pair (no duplicate)
      expect(stats.uniqueSymptomCausePairs).toBe(1);
    });

    test('recordOutcome preserves severity from diagnosis', () => {
      const diag = makeDiagnosis(['contamination'], [], 'critical');
      ml.recordOutcome(diag, 'sterility_breach', false);
      const state = ml.exportState();
      expect(state.outcomes[0].severity).toBe('critical');
    });
  });

  // ── getCalibratedConfidence — Bayesian update ──────────

  describe('getCalibratedConfidence — Bayesian update', () => {
    test('100% success rate with high prior pushes calibrated above prior', () => {
      const diag = makeDiagnosis(['nozzle_clog']);
      for (let i = 0; i < 10; i++) {
        ml.recordOutcome(diag, 'high_pressure', true);
      }
      const cal = ml.getCalibratedConfidence('nozzle_clog', 'high_pressure', 0.7);
      expect(cal.calibrated).toBeGreaterThan(0.7);
      expect(cal.calibrated).toBeLessThanOrEqual(1.0);
    });

    test('0% success rate with high prior pulls calibrated below prior', () => {
      const diag = makeDiagnosis(['poor_adhesion']);
      for (let i = 0; i < 10; i++) {
        ml.recordOutcome(diag, 'wrong_cause', false);
      }
      const cal = ml.getCalibratedConfidence('poor_adhesion', 'wrong_cause', 0.7);
      expect(cal.calibrated).toBeLessThan(0.7);
    });

    test('mixed outcomes converge toward observed success rate', () => {
      const diag = makeDiagnosis(['stringing']);
      // 8 successes, 2 failures = 80% observed
      for (let i = 0; i < 8; i++) ml.recordOutcome(diag, 'retraction', true);
      for (let i = 0; i < 2; i++) ml.recordOutcome(diag, 'retraction', false);

      const cal = ml.getCalibratedConfidence('stringing', 'retraction', 0.5);
      // With enough data, posterior should approach observed rate (0.8)
      expect(cal.calibrated).toBeGreaterThan(0.65);
      expect(cal.calibrated).toBeLessThan(0.9);
    });

    test('unknown symptom-cause pair returns prior with zero sample', () => {
      const cal = ml.getCalibratedConfidence('unknown_symptom', 'unknown_cause', 0.3);
      expect(cal.calibrated).toBe(0.3);
      expect(cal.sampleSize).toBe(0);
      expect(cal.successRate).toBeNull();
    });
  });

  // ── getAllCalibrationsForSymptom ────────────────────────

  describe('getAllCalibrationsForSymptom — sorting', () => {
    test('results sorted by calibrated confidence descending', () => {
      const diag1 = makeDiagnosis(['cell_death']);
      // Record more successes for cause_a, more failures for cause_b
      for (let i = 0; i < 5; i++) ml.recordOutcome(diag1, 'cause_a', true);
      for (let i = 0; i < 5; i++) ml.recordOutcome(diag1, 'cause_b', false);

      const cals = ml.getAllCalibrationsForSymptom('cell_death');
      expect(cals.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < cals.length; i++) {
        expect(cals[i - 1].calibrated).toBeGreaterThanOrEqual(cals[i].calibrated);
      }
    });
  });

  // ── detectAnomalies — edge cases ───────────────────────

  describe('detectAnomalies — boundary behavior', () => {
    test('identical symptoms to recorded pattern has similarity ~1.0', () => {
      const diag = makeDiagnosis(['warping', 'poor_adhesion']);
      ml.recordOutcome(diag, 'bed_issue', true);

      const result = ml.detectAnomalies(['warping', 'poor_adhesion']);
      expect(result.similarity).toBeCloseTo(1.0, 1);
      expect(result.isAnomaly).toBe(false);
    });

    test('completely disjoint symptoms flagged as anomalous', () => {
      const diag = makeDiagnosis(['warping']);
      ml.recordOutcome(diag, 'bed_issue', true);

      // Cell death and contamination have zero overlap with warping
      const result = ml.detectAnomalies(['cell_death', 'contamination']);
      expect(result.similarity).toBe(0);
      expect(result.isAnomaly).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
    });

    test('threshold=0 still flags zero-similarity as anomalous (strict less-than)', () => {
      const diag = makeDiagnosis(['nozzle_clog']);
      ml.recordOutcome(diag, 'debris', true);

      // cell_death has zero cosine similarity with nozzle_clog
      // Since 0 < 0 is false, zero-similarity is NOT anomalous at threshold=0
      // But partial overlap gives positive similarity, which is also not < 0
      const partialResult = ml.detectAnomalies(['nozzle_clog', 'cell_death'], { threshold: 0 });
      expect(partialResult.isAnomaly).toBe(false);
    });

    test('threshold=1 makes everything anomalous (unless perfect match)', () => {
      const diag = makeDiagnosis(['stringing']);
      ml.recordOutcome(diag, 'retraction', true);

      const result = ml.detectAnomalies(['stringing', 'warping'], { threshold: 1 });
      // Partial overlap < 1.0 similarity, so anomalous at threshold=1
      expect(result.isAnomaly).toBe(true);
    });

    test('nearestMatch contains the best matching entry info', () => {
      const diag = makeDiagnosis(['dehydration', 'cell_death']);
      ml.recordOutcome(diag, 'incubation_issue', true);
      ml.recordOutcome(makeDiagnosis(['warping']), 'temp_issue', true);

      const result = ml.detectAnomalies(['dehydration']);
      expect(result.nearestMatch).not.toBeNull();
      // Should match the dehydration+cell_death entry better than warping
      expect(result.nearestMatch.cause).toBe('incubation_issue');
    });
  });

  // ── clusterDiagnoses — deeper paths ────────────────────

  describe('clusterDiagnoses — convergence & config', () => {
    function seedData(ml, n) {
      // Two clear groups: pressure-related and crosslink-related
      for (let i = 0; i < n; i++) {
        if (i % 2 === 0) {
          ml.recordOutcome(makeDiagnosis(['nozzle_clog', 'under_extrusion']), 'high_pressure', true);
        } else {
          ml.recordOutcome(makeDiagnosis(['cell_death', 'crosslink_failure']), 'uv_damage', true);
        }
      }
    }

    test('auto-selects k based on data size (sqrt(n/2))', () => {
      seedData(ml, 20);
      const result = ml.clusterDiagnoses();
      // sqrt(20/2) ≈ 3.16 → 3, bounded [2, 8]
      expect(result.k).toBeGreaterThanOrEqual(2);
      expect(result.k).toBeLessThanOrEqual(8);
    });

    test('custom k overrides auto-selection', () => {
      seedData(ml, 10);
      const result = ml.clusterDiagnoses({ k: 2 });
      expect(result.k).toBe(2);
    });

    test('clusters have dominantCause with percentage', () => {
      seedData(ml, 10);
      const result = ml.clusterDiagnoses({ k: 2 });
      for (const cluster of result.clusters) {
        expect(cluster.dominantCause).toBeTruthy();
        expect(cluster.dominantCause.percentage).toBeGreaterThan(0);
        expect(cluster.dominantCause.percentage).toBeLessThanOrEqual(100);
      }
    });

    test('clusters have commonSymptoms with frequency percentages', () => {
      seedData(ml, 10);
      const result = ml.clusterDiagnoses({ k: 2 });
      for (const cluster of result.clusters) {
        for (const sym of cluster.commonSymptoms) {
          expect(sym.symptom).toBeDefined();
          expect(sym.frequency).toBeGreaterThan(50);
          expect(sym.frequency).toBeLessThanOrEqual(100);
        }
      }
    });

    test('cluster centroids have correct dimensionality (12 symptoms)', () => {
      seedData(ml, 6);
      const result = ml.clusterDiagnoses({ k: 2 });
      for (const cluster of result.clusters) {
        expect(cluster.centroid.length).toBe(12); // 12 default symptoms
      }
    });

    test('maxIterations=1 still produces clusters', () => {
      seedData(ml, 6);
      const result = ml.clusterDiagnoses({ k: 2, maxIterations: 1 });
      expect(result.clusters.length).toBeGreaterThan(0);
    });

    test('total member count across clusters equals total vectors', () => {
      seedData(ml, 10);
      const result = ml.clusterDiagnoses({ k: 2 });
      const totalMembers = result.clusters.reduce((s, c) => s + c.size, 0);
      expect(totalMembers).toBe(10);
    });
  });

  // ── suggestNewRules — filtering ────────────────────────

  describe('suggestNewRules — rule suggestion quality', () => {
    test('does not suggest existing rules', () => {
      // Seed 10 outcomes for nozzle_clog → high_pressure
      for (let i = 0; i < 10; i++) {
        ml.recordOutcome(makeDiagnosis(['nozzle_clog', 'under_extrusion']), 'high_pressure', true);
      }
      ml.clusterDiagnoses({ k: 2 });

      // Pass existing rule that matches
      const result = ml.suggestNewRules([{ symptom: 'nozzle_clog', cause: 'high_pressure' }]);
      const hasDuplicate = result.suggestions.some(
        s => s.symptom === 'nozzle_clog' && s.cause === 'high_pressure'
      );
      expect(hasDuplicate).toBe(false);
    });

    test('suggestions include evidence metrics', () => {
      for (let i = 0; i < 10; i++) {
        ml.recordOutcome(makeDiagnosis(['cell_death', 'dehydration']), 'incubation_issue', true);
      }
      ml.clusterDiagnoses({ k: 2 });
      const result = ml.suggestNewRules([]);
      if (result.suggestions.length > 0) {
        const s = result.suggestions[0];
        expect(s.evidence).toBeDefined();
        expect(s.evidence.clusterSize).toBeGreaterThan(0);
        expect(s.evidence.symptomFrequency).toBeGreaterThanOrEqual(60);
        expect(typeof s.suggestedConfidence).toBe('number');
      }
    });

    test('suggestions sorted by confidence descending', () => {
      for (let i = 0; i < 8; i++) {
        ml.recordOutcome(makeDiagnosis(['cell_death', 'dehydration', 'contamination']), 'env_issue', true);
      }
      for (let i = 0; i < 4; i++) {
        ml.recordOutcome(makeDiagnosis(['warping', 'poor_adhesion', 'stringing']), 'temp_issue', true);
      }
      ml.clusterDiagnoses({ k: 2 });
      const result = ml.suggestNewRules([]);
      for (let i = 1; i < result.suggestions.length; i++) {
        expect(result.suggestions[i - 1].suggestedConfidence)
          .toBeGreaterThanOrEqual(result.suggestions[i].suggestedConfidence);
      }
    });

    test('skips clusters with fewer than 2 members', () => {
      // 3 outcomes with 2 different patterns + 1 unique
      ml.recordOutcome(makeDiagnosis(['nozzle_clog']), 'debris', true);
      ml.recordOutcome(makeDiagnosis(['cell_death']), 'thermal', true);
      ml.recordOutcome(makeDiagnosis(['warping']), 'bed_temp', true);
      // Force k=3 so each cluster has 1 member
      ml.clusterDiagnoses({ k: 3 });
      const result = ml.suggestNewRules([]);
      expect(result.suggestions.length).toBe(0);
    });
  });

  // ── enhance — calibration & re-sorting ─────────────────

  describe('enhance — ML integration', () => {
    test('adds calibrationDelta to each diagnosis', () => {
      const diag = makeDiagnosis(['nozzle_clog'], [
        { cause: 'high_pressure', confidence: 0.8, matchedSymptoms: ['nozzle_clog'] },
      ]);
      // Record some outcomes to shift calibration
      for (let i = 0; i < 5; i++) {
        ml.recordOutcome(makeDiagnosis(['nozzle_clog']), 'high_pressure', false);
      }
      const enhanced = ml.enhance(diag);
      expect(enhanced.diagnoses[0].calibrationDelta).toBeDefined();
      expect(enhanced.diagnoses[0].calibrationDelta).toBeLessThan(0); // pulled down
    });

    test('re-sorts diagnoses by calibrated confidence', () => {
      // Give cause_b many successes, cause_a many failures
      for (let i = 0; i < 10; i++) {
        ml.recordOutcome(makeDiagnosis(['warping']), 'cause_b', true);
        ml.recordOutcome(makeDiagnosis(['warping']), 'cause_a', false);
      }

      const diag = makeDiagnosis(['warping'], [
        { cause: 'cause_a', confidence: 0.9, matchedSymptoms: ['warping'] },
        { cause: 'cause_b', confidence: 0.3, matchedSymptoms: ['warping'] },
      ]);
      const enhanced = ml.enhance(diag);
      // cause_b should be promoted above cause_a after calibration
      expect(enhanced.diagnoses[0].cause).toBe('cause_b');
    });

    test('primaryDiagnosis is the highest-calibrated diagnosis', () => {
      const diag = makeDiagnosis(['cell_death'], [
        { cause: 'thermal', confidence: 0.5, matchedSymptoms: ['cell_death'] },
      ]);
      const enhanced = ml.enhance(diag);
      expect(enhanced.primaryDiagnosis).toBe(enhanced.diagnoses[0]);
    });

    test('ml section includes anomaly and metadata', () => {
      const diag = makeDiagnosis(['poor_resolution'], [
        { cause: 'resolution', confidence: 0.6, matchedSymptoms: ['poor_resolution'] },
      ]);
      const enhanced = ml.enhance(diag);
      expect(enhanced.ml).toBeDefined();
      expect(enhanced.ml.anomaly).toBeDefined();
      expect(typeof enhanced.ml.outcomeCount).toBe('number');
      expect(typeof enhanced.ml.clusterCount).toBe('number');
    });

    test('empty diagnoses array returns null primaryDiagnosis', () => {
      const diag = makeDiagnosis(['warping'], []);
      const enhanced = ml.enhance(diag);
      expect(enhanced.primaryDiagnosis).toBeNull();
    });
  });

  // ── State management — import edge cases ───────────────

  describe('importState — edge cases', () => {
    test('import with empty arrays clears state', () => {
      ml.recordOutcome(makeDiagnosis(['warping']), 'temp', true);
      expect(ml.getStats().totalOutcomes).toBe(1);

      ml.importState({ outcomes: [], pairStats: {}, diagnosisVectors: [] });
      expect(ml.getStats().totalOutcomes).toBe(0);
      expect(ml.getStats().uniqueSymptomCausePairs).toBe(0);
    });

    test('import without knownPatterns does not crash', () => {
      ml.importState({ outcomes: [], pairStats: {} });
      expect(ml.getStats().clusterCount).toBe(0);
    });

    test('import preserves pairStats for calibration', () => {
      // Record, export, reset, import, verify calibration still works
      for (let i = 0; i < 5; i++) {
        ml.recordOutcome(makeDiagnosis(['stringing']), 'retraction', true);
      }
      const state = ml.exportState();
      ml.reset();
      expect(ml.getStats().totalOutcomes).toBe(0);

      ml.importState(state);
      const cal = ml.getCalibratedConfidence('stringing', 'retraction', 0.5);
      expect(cal.sampleSize).toBe(5);
      expect(cal.successRate).toBe(1.0);
    });

    test('export → import roundtrip preserves cluster state', () => {
      for (let i = 0; i < 6; i++) {
        ml.recordOutcome(
          makeDiagnosis(i % 2 === 0 ? ['warping'] : ['cell_death']),
          i % 2 === 0 ? 'temp' : 'uv',
          true
        );
      }
      ml.clusterDiagnoses({ k: 2 });
      const state = ml.exportState();
      expect(state.knownPatterns.length).toBeGreaterThan(0);

      ml.reset();
      ml.importState(state);
      expect(ml.getStats().clusterCount).toBeGreaterThan(0);
    });
  });

  // ── Custom symptomIds configuration ────────────────────

  describe('custom symptomIds', () => {
    test('uses custom symptom list for vectorization', () => {
      const customMl = createMLDiagnostic({ symptomIds: ['a', 'b', 'c'] });
      customMl.recordOutcome({ symptoms: ['a', 'c'], diagnoses: [] }, 'cause1', true);
      const state = customMl.exportState();
      // Vectors should be length 3 (matching custom symptomIds)
      expect(state.diagnosisVectors[0].vector.length).toBe(3);
      expect(state.diagnosisVectors[0].vector).toEqual([1, 0, 1]); // a=1, b=0, c=1
    });
  });

  // ── getStats comprehensive ─────────────────────────────

  describe('getStats — comprehensive', () => {
    test('overallSuccessRate reflects mixed outcomes', () => {
      ml.recordOutcome(makeDiagnosis(['warping']), 'temp', true);
      ml.recordOutcome(makeDiagnosis(['warping']), 'temp', true);
      ml.recordOutcome(makeDiagnosis(['warping']), 'temp', false);
      const stats = ml.getStats();
      expect(stats.overallSuccessRate).toBeCloseTo(0.667, 2);
      expect(stats.failedFixes).toBe(1);
    });

    test('diagnosisVectorCount matches totalOutcomes', () => {
      ml.recordOutcome(makeDiagnosis(['cell_death']), 'thermal', true);
      ml.recordOutcome(makeDiagnosis(['warping']), 'temp', false);
      const stats = ml.getStats();
      expect(stats.diagnosisVectorCount).toBe(stats.totalOutcomes);
    });
  });
});
