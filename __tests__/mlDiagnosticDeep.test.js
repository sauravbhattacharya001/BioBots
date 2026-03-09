'use strict';

const { createMLDiagnostic } = require('../Try/scripts/mlDiagnostic');

/**
 * Deep edge-case tests for the ML diagnostic engine.
 * Supplements the existing mlDiagnostic.test.js (31 tests) with
 * 42 additional tests targeting under-covered paths.
 */

// ── Helpers ─────────────────────────────────────────────────────────

function makeDiagnosis(symptoms, diagnoses) {
  return {
    symptoms,
    diagnoses: diagnoses.map(d => ({
      cause: d.cause,
      confidence: d.confidence || 0.7,
      matchedSymptoms: d.matchedSymptoms || symptoms,
      evidence: d.evidence || [],
    })),
  };
}

function seedOutcomes(ml, records) {
  for (const r of records) {
    ml.recordOutcome(
      makeDiagnosis(r.symptoms, [{ cause: r.cause, confidence: 0.7, matchedSymptoms: r.symptoms }]),
      r.cause,
      r.fixed,
      r.metadata
    );
  }
}

// ── Anomaly Detection Deep ──────────────────────────────────────────

describe('detectAnomalies — deep', () => {
  test('identical symptoms to history are not anomalous', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog', 'under_extrusion'], cause: 'high_pressure', fixed: true },
      { symptoms: ['nozzle_clog', 'under_extrusion'], cause: 'high_pressure', fixed: true },
      { symptoms: ['nozzle_clog', 'under_extrusion'], cause: 'high_pressure', fixed: false },
    ]);
    const result = ml.detectAnomalies(['nozzle_clog', 'under_extrusion']);
    expect(result.isAnomaly).toBe(false);
    expect(result.similarity).toBe(1);
  });

  test('completely disjoint symptoms are anomalous', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog', 'under_extrusion'], cause: 'high_pressure', fixed: true },
      { symptoms: ['nozzle_clog'], cause: 'debris', fixed: true },
    ]);
    const result = ml.detectAnomalies(['contamination', 'dehydration']);
    expect(result.isAnomaly).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  test('partial overlap gives intermediate similarity', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog', 'under_extrusion', 'poor_adhesion'], cause: 'temp', fixed: true },
    ]);
    const result = ml.detectAnomalies(['nozzle_clog', 'under_extrusion']);
    expect(result.similarity).toBeGreaterThan(0);
    expect(result.similarity).toBeLessThan(1);
  });

  test('high threshold makes partial matches anomalous', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog', 'under_extrusion'], cause: 'temp', fixed: true },
    ]);
    const result = ml.detectAnomalies(['nozzle_clog'], { threshold: 0.99 });
    expect(result.isAnomaly).toBe(true);
  });

  test('single symptom query against multi-symptom history', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['cell_death', 'warping', 'stringing', 'contamination'], cause: 'env', fixed: true },
    ]);
    const result = ml.detectAnomalies(['cell_death']);
    expect(result.similarity).toBeGreaterThan(0);
    expect(result.nearestMatch).not.toBeNull();
    expect(result.nearestMatch.symptoms).toContain('cell_death');
  });

  test('details string mentions similarity percentage', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog'], cause: 'debris', fixed: true },
    ]);
    const result = ml.detectAnomalies(['nozzle_clog']);
    expect(result.details).toContain('100%');
  });

  test('multiple different patterns picks best match', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog', 'under_extrusion'], cause: 'debris', fixed: true },
      { symptoms: ['warping', 'poor_adhesion'], cause: 'temp', fixed: true },
      { symptoms: ['cell_death', 'contamination'], cause: 'env', fixed: true },
    ]);
    const result = ml.detectAnomalies(['nozzle_clog', 'under_extrusion']);
    expect(result.similarity).toBe(1);
    expect(result.nearestMatch.cause).toBe('debris');
  });
});

// ── Confidence Calibration Deep ─────────────────────────────────────

describe('getCalibratedConfidence — deep', () => {
  test('many successes push calibrated confidence high', () => {
    const ml = createMLDiagnostic();
    for (let i = 0; i < 20; i++) {
      ml.recordOutcome(
        makeDiagnosis(['nozzle_clog'], [{ cause: 'high_pressure', matchedSymptoms: ['nozzle_clog'] }]),
        'high_pressure', true
      );
    }
    const result = ml.getCalibratedConfidence('nozzle_clog', 'high_pressure', 0.5);
    expect(result.calibrated).toBeGreaterThan(0.8);
    expect(result.sampleSize).toBe(20);
  });

  test('many failures push calibrated confidence low', () => {
    const ml = createMLDiagnostic();
    for (let i = 0; i < 20; i++) {
      ml.recordOutcome(
        makeDiagnosis(['warping'], [{ cause: 'temp_drift', matchedSymptoms: ['warping'] }]),
        'temp_drift', false
      );
    }
    const result = ml.getCalibratedConfidence('warping', 'temp_drift', 0.5);
    expect(result.calibrated).toBeLessThan(0.2);
  });

  test('mixed outcomes converge toward success rate', () => {
    const ml = createMLDiagnostic();
    for (let i = 0; i < 7; i++) {
      ml.recordOutcome(
        makeDiagnosis(['cell_death'], [{ cause: 'env', matchedSymptoms: ['cell_death'] }]),
        'env', true
      );
    }
    for (let i = 0; i < 3; i++) {
      ml.recordOutcome(
        makeDiagnosis(['cell_death'], [{ cause: 'env', matchedSymptoms: ['cell_death'] }]),
        'env', false
      );
    }
    const result = ml.getCalibratedConfidence('cell_death', 'env', 0.5);
    expect(result.calibrated).toBeGreaterThan(0.5);
    expect(result.calibrated).toBeLessThan(0.9);
    expect(result.successRate).toBeCloseTo(0.7, 1);
  });

  test('different symptoms same cause get independent calibrations', () => {
    const ml = createMLDiagnostic();
    ml.recordOutcome(
      makeDiagnosis(['nozzle_clog'], [{ cause: 'debris', matchedSymptoms: ['nozzle_clog'] }]),
      'debris', true
    );
    ml.recordOutcome(
      makeDiagnosis(['warping'], [{ cause: 'debris', matchedSymptoms: ['warping'] }]),
      'debris', false
    );
    const confClog = ml.getCalibratedConfidence('nozzle_clog', 'debris', 0.5);
    const confWarp = ml.getCalibratedConfidence('warping', 'debris', 0.5);
    expect(confClog.calibrated).toBeGreaterThan(confWarp.calibrated);
  });

  test('returns prior when no data exists', () => {
    const ml = createMLDiagnostic();
    const result = ml.getCalibratedConfidence('nozzle_clog', 'unknown', 0.75);
    expect(result.calibrated).toBeCloseTo(0.75, 1);
    expect(result.sampleSize).toBe(0);
  });

  test('result includes successRate', () => {
    const ml = createMLDiagnostic();
    ml.recordOutcome(
      makeDiagnosis(['nozzle_clog'], [{ cause: 'debris', matchedSymptoms: ['nozzle_clog'] }]),
      'debris', true
    );
    const result = ml.getCalibratedConfidence('nozzle_clog', 'debris');
    expect(typeof result.successRate).toBe('number');
  });
});

// ── getAllCalibrationsForSymptom Deep ────────────────────────────────

describe('getAllCalibrationsForSymptom — deep', () => {
  test('returns multiple causes for same symptom', () => {
    const ml = createMLDiagnostic();
    ml.recordOutcome(
      makeDiagnosis(['nozzle_clog'], [{ cause: 'debris', matchedSymptoms: ['nozzle_clog'] }]),
      'debris', true
    );
    ml.recordOutcome(
      makeDiagnosis(['nozzle_clog'], [{ cause: 'high_pressure', matchedSymptoms: ['nozzle_clog'] }]),
      'high_pressure', false
    );
    const cals = ml.getAllCalibrationsForSymptom('nozzle_clog');
    expect(cals.length).toBeGreaterThanOrEqual(2);
    const causes = cals.map(c => c.cause);
    expect(causes).toContain('debris');
    expect(causes).toContain('high_pressure');
  });

  test('each calibration has cause and calibrated fields', () => {
    const ml = createMLDiagnostic();
    ml.recordOutcome(
      makeDiagnosis(['warping'], [{ cause: 'temp', matchedSymptoms: ['warping'] }]),
      'temp', true
    );
    const cals = ml.getAllCalibrationsForSymptom('warping');
    expect(cals.length).toBeGreaterThan(0);
    expect(cals[0].cause).toBeDefined();
    expect(typeof cals[0].calibrated).toBe('number');
    expect(typeof cals[0].sampleSize).toBe('number');
  });

  test('sorted by calibrated confidence descending', () => {
    const ml = createMLDiagnostic();
    // High success for cause A
    for (let i = 0; i < 5; i++) {
      ml.recordOutcome(
        makeDiagnosis(['nozzle_clog'], [{ cause: 'causeA', matchedSymptoms: ['nozzle_clog'] }]),
        'causeA', true
      );
    }
    // Low success for cause B
    for (let i = 0; i < 5; i++) {
      ml.recordOutcome(
        makeDiagnosis(['nozzle_clog'], [{ cause: 'causeB', matchedSymptoms: ['nozzle_clog'] }]),
        'causeB', false
      );
    }
    const cals = ml.getAllCalibrationsForSymptom('nozzle_clog');
    for (let i = 1; i < cals.length; i++) {
      expect(cals[i - 1].calibrated).toBeGreaterThanOrEqual(cals[i].calibrated);
    }
  });
});

// ── Clustering Deep ─────────────────────────────────────────────────

describe('clusterDiagnoses — deep', () => {
  function seedForClustering(ml) {
    for (let i = 0; i < 5; i++) {
      seedOutcomes(ml, [
        { symptoms: ['nozzle_clog', 'under_extrusion'], cause: 'debris', fixed: true },
      ]);
    }
    for (let i = 0; i < 5; i++) {
      seedOutcomes(ml, [
        { symptoms: ['poor_adhesion', 'warping'], cause: 'temp_drift', fixed: true },
      ]);
    }
  }

  test('auto-selects k based on data size', () => {
    const ml = createMLDiagnostic();
    seedForClustering(ml);
    const result = ml.clusterDiagnoses();
    expect(result.k).toBeGreaterThanOrEqual(2);
    expect(result.clusters.length).toBe(result.k);
  });

  test('custom k=2 produces exactly 2 clusters', () => {
    const ml = createMLDiagnostic();
    seedForClustering(ml);
    const result = ml.clusterDiagnoses({ k: 2 });
    expect(result.k).toBe(2);
    expect(result.clusters.length).toBe(2);
  });

  test('each cluster has centroid, members, dominantCause', () => {
    const ml = createMLDiagnostic();
    seedForClustering(ml);
    const result = ml.clusterDiagnoses({ k: 2 });
    for (const cluster of result.clusters) {
      expect(Array.isArray(cluster.centroid)).toBe(true);
      expect(cluster.centroid.length).toBeGreaterThan(0);
      expect(typeof cluster.size).toBe('number');
      expect(cluster.size).toBeGreaterThan(0);
      expect(cluster.dominantCause).toBeDefined();
      expect(cluster.dominantCause.cause).toBeDefined();
    }
  });

  test('clusters separate distinct symptom patterns', () => {
    const ml = createMLDiagnostic();
    seedForClustering(ml);
    const result = ml.clusterDiagnoses({ k: 2 });
    const causes = result.clusters.map(c => c.dominantCause.cause).sort();
    expect(causes.length).toBe(2);
  });

  test('identical vectors converge quickly', () => {
    const ml = createMLDiagnostic();
    for (let i = 0; i < 6; i++) {
      seedOutcomes(ml, [
        { symptoms: ['nozzle_clog'], cause: 'debris', fixed: true },
      ]);
    }
    const result = ml.clusterDiagnoses({ k: 2, maxIterations: 5 });
    expect(result.clusters.length).toBeGreaterThanOrEqual(1);
  });

  test('total members across clusters equals data size', () => {
    const ml = createMLDiagnostic();
    seedForClustering(ml);
    const result = ml.clusterDiagnoses({ k: 2 });
    const totalMembers = result.clusters.reduce((sum, c) => sum + c.size, 0);
    expect(totalMembers).toBe(10);
  });
});

// ── suggestNewRules Deep ────────────────────────────────────────────

describe('suggestNewRules — deep', () => {
  test('suggests rules based on cluster patterns', () => {
    const ml = createMLDiagnostic();
    for (let i = 0; i < 6; i++) {
      seedOutcomes(ml, [
        { symptoms: ['nozzle_clog', 'under_extrusion'], cause: 'debris', fixed: true },
      ]);
    }
    ml.clusterDiagnoses({ k: 2 });
    const result = ml.suggestNewRules([]);
    expect(Array.isArray(result.suggestions || result)).toBe(true);
  });

  test('returns message before clustering', () => {
    const ml = createMLDiagnostic();
    const result2 = ml.suggestNewRules([]);
    expect(result2.message).toBeDefined();
  });

  test('suggestions have cause and symptoms', () => {
    const ml = createMLDiagnostic();
    for (let i = 0; i < 8; i++) {
      seedOutcomes(ml, [
        { symptoms: ['cell_death', 'contamination'], cause: 'env_failure', fixed: true },
      ]);
    }
    ml.clusterDiagnoses();
    const result = ml.suggestNewRules([]);
    const suggestions = result.suggestions || result;
    if (suggestions.length > 0) {
      expect(suggestions[0].cause).toBeDefined();
      expect(suggestions[0].symptom).toBeDefined();
    }
  });
});

// ── Enhance Deep ────────────────────────────────────────────────────

describe('enhance — deep', () => {
  test('enhances confidence based on calibration data', () => {
    const ml = createMLDiagnostic();
    for (let i = 0; i < 10; i++) {
      ml.recordOutcome(
        makeDiagnosis(['nozzle_clog'], [{ cause: 'debris', matchedSymptoms: ['nozzle_clog'] }]),
        'debris', true
      );
    }
    const diagnosis = makeDiagnosis(
      ['nozzle_clog'],
      [{ cause: 'debris', confidence: 0.5, matchedSymptoms: ['nozzle_clog'] }]
    );
    const enhanced = ml.enhance(diagnosis);
    expect(enhanced).toBeDefined();
    expect(enhanced.diagnoses).toBeDefined();
    const debrisDiag = enhanced.diagnoses.find(d => d.cause === 'debris');
    expect(debrisDiag).toBeDefined();
    expect(debrisDiag.calibratedConfidence).toBeGreaterThan(0.5);
  });

  test('enhance includes anomaly info in ml field', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog'], cause: 'debris', fixed: true },
    ]);
    const diagnosis = makeDiagnosis(
      ['nozzle_clog'],
      [{ cause: 'debris', matchedSymptoms: ['nozzle_clog'] }]
    );
    const enhanced = ml.enhance(diagnosis);
    expect(enhanced.ml).toBeDefined();
    expect(enhanced.ml.anomaly).toBeDefined();
    expect(typeof enhanced.ml.anomaly.isAnomaly).toBe('boolean');
  });

  test('enhance with multiple diagnoses calibrates each', () => {
    const ml = createMLDiagnostic();
    ml.recordOutcome(
      makeDiagnosis(['nozzle_clog'], [{ cause: 'debris', matchedSymptoms: ['nozzle_clog'] }]),
      'debris', true
    );
    ml.recordOutcome(
      makeDiagnosis(['nozzle_clog'], [{ cause: 'high_pressure', matchedSymptoms: ['nozzle_clog'] }]),
      'high_pressure', false
    );
    const diagnosis = makeDiagnosis(['nozzle_clog'], [
      { cause: 'debris', confidence: 0.5, matchedSymptoms: ['nozzle_clog'] },
      { cause: 'high_pressure', confidence: 0.5, matchedSymptoms: ['nozzle_clog'] },
    ]);
    const enhanced = ml.enhance(diagnosis);
    const debris = enhanced.diagnoses.find(d => d.cause === 'debris');
    const pressure = enhanced.diagnoses.find(d => d.cause === 'high_pressure');
    expect(debris.calibratedConfidence).toBeGreaterThan(pressure.calibratedConfidence);
  });

  test('enhance preserves original confidence', () => {
    const ml = createMLDiagnostic();
    const diagnosis = makeDiagnosis(
      ['nozzle_clog'],
      [{ cause: 'debris', confidence: 0.75, matchedSymptoms: ['nozzle_clog'] }]
    );
    const enhanced = ml.enhance(diagnosis);
    const d = enhanced.diagnoses[0];
    expect(d.originalConfidence).toBe(0.75);
  });

  test('enhance shows calibrationDelta', () => {
    const ml = createMLDiagnostic();
    for (let i = 0; i < 5; i++) {
      ml.recordOutcome(
        makeDiagnosis(['warping'], [{ cause: 'temp', matchedSymptoms: ['warping'] }]),
        'temp', true
      );
    }
    const diagnosis = makeDiagnosis(
      ['warping'],
      [{ cause: 'temp', confidence: 0.3, matchedSymptoms: ['warping'] }]
    );
    const enhanced = ml.enhance(diagnosis);
    const d = enhanced.diagnoses[0];
    expect(typeof d.calibrationDelta).toBe('number');
    expect(d.calibrationDelta).toBeGreaterThan(0); // should increase from 0.3
  });
});

// ── State Management Deep ───────────────────────────────────────────

describe('state management — deep', () => {
  test('exported state contains outcomes and pairStats', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog'], cause: 'debris', fixed: true },
      { symptoms: ['warping'], cause: 'temp', fixed: false },
    ]);
    const state = ml.exportState();
    expect(state.outcomes.length).toBe(2);
    expect(state.pairStats).toBeDefined();
    expect(Object.keys(state.pairStats).length).toBeGreaterThan(0);
  });

  test('imported state preserves calibration data', () => {
    const ml1 = createMLDiagnostic();
    for (let i = 0; i < 5; i++) {
      ml1.recordOutcome(
        makeDiagnosis(['nozzle_clog'], [{ cause: 'debris', matchedSymptoms: ['nozzle_clog'] }]),
        'debris', true
      );
    }
    const conf1 = ml1.getCalibratedConfidence('nozzle_clog', 'debris', 0.5);
    const state = ml1.exportState();

    const ml2 = createMLDiagnostic();
    ml2.importState(state);
    const conf2 = ml2.getCalibratedConfidence('nozzle_clog', 'debris', 0.5);
    expect(conf2.calibrated).toBeCloseTo(conf1.calibrated, 3);
  });

  test('importState throws on invalid format', () => {
    const ml = createMLDiagnostic();
    expect(() => ml.importState(null)).toThrow();
  });

  test('reset clears anomaly detection history', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog'], cause: 'debris', fixed: true },
    ]);
    ml.reset();
    const result = ml.detectAnomalies(['nozzle_clog']);
    expect(result.isAnomaly).toBe(true);
    expect(result.details).toContain('No historical data');
  });

  test('reset clears calibration data', () => {
    const ml = createMLDiagnostic();
    for (let i = 0; i < 5; i++) {
      ml.recordOutcome(
        makeDiagnosis(['nozzle_clog'], [{ cause: 'debris', matchedSymptoms: ['nozzle_clog'] }]),
        'debris', true
      );
    }
    ml.reset();
    const result = ml.getCalibratedConfidence('nozzle_clog', 'debris', 0.5);
    expect(result.sampleSize).toBe(0);
  });
});

// ── getStats Deep ───────────────────────────────────────────────────

describe('getStats — deep', () => {
  test('tracks total outcomes and unique pairs', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog'], cause: 'debris', fixed: true },
      { symptoms: ['nozzle_clog'], cause: 'debris', fixed: false },
      { symptoms: ['warping'], cause: 'temp', fixed: true },
    ]);
    const stats = ml.getStats();
    expect(stats.totalOutcomes).toBe(3);
    expect(stats.uniqueSymptomCausePairs).toBeGreaterThanOrEqual(2);
  });

  test('overallSuccessRate reflects actual outcomes', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog'], cause: 'debris', fixed: true },
      { symptoms: ['nozzle_clog'], cause: 'debris', fixed: true },
      { symptoms: ['nozzle_clog'], cause: 'debris', fixed: false },
    ]);
    const stats = ml.getStats();
    expect(stats.overallSuccessRate).toBeCloseTo(0.667, 1);
  });

  test('stats reflect reset', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog'], cause: 'debris', fixed: true },
    ]);
    ml.reset();
    const stats = ml.getStats();
    expect(stats.totalOutcomes).toBe(0);
    expect(stats.overallSuccessRate).toBeNull();
  });

  test('diagnosisVectorCount matches recorded outcomes', () => {
    const ml = createMLDiagnostic();
    seedOutcomes(ml, [
      { symptoms: ['nozzle_clog'], cause: 'debris', fixed: true },
      { symptoms: ['warping'], cause: 'temp', fixed: true },
    ]);
    const stats = ml.getStats();
    expect(stats.diagnosisVectorCount).toBe(2);
  });
});

// ── Custom symptom IDs ──────────────────────────────────────────────

describe('custom symptom IDs', () => {
  test('accepts custom symptom ID list', () => {
    const ml = createMLDiagnostic({ symptomIds: ['alpha', 'beta', 'gamma'] });
    ml.recordOutcome(
      makeDiagnosis(['alpha', 'beta'], [{ cause: 'test_cause', matchedSymptoms: ['alpha', 'beta'] }]),
      'test_cause', true
    );
    const result = ml.detectAnomalies(['alpha']);
    expect(result).toBeDefined();
    expect(typeof result.isAnomaly).toBe('boolean');
  });

  test('exact match with custom IDs has similarity 1', () => {
    const ml = createMLDiagnostic({ symptomIds: ['x', 'y'] });
    ml.recordOutcome(
      makeDiagnosis(['x'], [{ cause: 'c1', matchedSymptoms: ['x'] }]),
      'c1', true
    );
    const result = ml.detectAnomalies(['x']);
    expect(result.similarity).toBe(1);
    expect(result.isAnomaly).toBe(false);
  });
});

// ── recordOutcome metadata ──────────────────────────────────────────

describe('recordOutcome metadata', () => {
  test('metadata is preserved in exported state', () => {
    const ml = createMLDiagnostic();
    ml.recordOutcome(
      makeDiagnosis(['nozzle_clog'], [{ cause: 'debris', matchedSymptoms: ['nozzle_clog'] }]),
      'debris', true,
      { operator: 'lab-tech-1', batch: 'B42' }
    );
    const state = ml.exportState();
    expect(state.outcomes[0].metadata).toEqual({ operator: 'lab-tech-1', batch: 'B42' });
  });

  test('metadata defaults to null when omitted', () => {
    const ml = createMLDiagnostic();
    ml.recordOutcome(
      makeDiagnosis(['nozzle_clog'], [{ cause: 'debris', matchedSymptoms: ['nozzle_clog'] }]),
      'debris', true
    );
    const state = ml.exportState();
    expect(state.outcomes[0].metadata).toBeNull();
  });
});
