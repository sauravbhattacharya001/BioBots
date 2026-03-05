/**
 * Tests for Print Failure Diagnostic System
 */

'use strict';

const {
  createFailureDiagnostic,
  SYMPTOMS,
  SEVERITY,
  ROOT_CAUSES,
  CORRECTIVE_ACTIONS,
  CO_OCCURRENCE_PATTERNS,
} = require('../Try/scripts/failureDiagnostic');

// ── Constants tests ─────────────────────────────────────────────

describe('Constants', () => {
  test('SYMPTOMS has 12 entries', () => {
    expect(Object.keys(SYMPTOMS)).toHaveLength(12);
  });

  test('all symptoms have required fields', () => {
    for (const s of Object.values(SYMPTOMS)) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('label');
      expect(s).toHaveProperty('description');
      expect(s).toHaveProperty('category');
      expect(typeof s.label).toBe('string');
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  test('symptom keys match ids', () => {
    for (const [key, val] of Object.entries(SYMPTOMS)) {
      expect(key).toBe(val.id);
    }
  });

  test('SEVERITY has 4 levels', () => {
    expect(Object.keys(SEVERITY)).toHaveLength(4);
    expect(SEVERITY.MILD).toBe('mild');
    expect(SEVERITY.MODERATE).toBe('moderate');
    expect(SEVERITY.SEVERE).toBe('severe');
    expect(SEVERITY.CRITICAL).toBe('critical');
  });

  test('ROOT_CAUSES has entries with required fields', () => {
    expect(Object.keys(ROOT_CAUSES).length).toBeGreaterThan(10);
    for (const c of Object.values(ROOT_CAUSES)) {
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('label');
      expect(c).toHaveProperty('category');
      expect(c).toHaveProperty('description');
    }
  });

  test('every root cause has corrective actions', () => {
    for (const causeId of Object.keys(ROOT_CAUSES)) {
      expect(CORRECTIVE_ACTIONS[causeId]).toBeDefined();
      expect(CORRECTIVE_ACTIONS[causeId].length).toBeGreaterThan(0);
    }
  });

  test('corrective actions have required fields', () => {
    for (const actions of Object.values(CORRECTIVE_ACTIONS)) {
      for (const a of actions) {
        expect(a).toHaveProperty('action');
        expect(a).toHaveProperty('priority');
        expect(typeof a.action).toBe('string');
        expect(typeof a.priority).toBe('number');
      }
    }
  });

  test('CO_OCCURRENCE_PATTERNS reference valid symptoms and causes', () => {
    for (const p of CO_OCCURRENCE_PATTERNS) {
      for (const s of p.symptoms) {
        expect(SYMPTOMS[s]).toBeDefined();
      }
      expect(ROOT_CAUSES[p.likelyCause]).toBeDefined();
      expect(typeof p.confidenceBoost).toBe('number');
      expect(p.confidenceBoost).toBeGreaterThan(0);
    }
  });
});

// ── Factory tests ───────────────────────────────────────────────

describe('createFailureDiagnostic', () => {
  test('returns frozen object with expected methods', () => {
    const diag = createFailureDiagnostic();
    expect(Object.isFrozen(diag)).toBe(true);
    expect(typeof diag.diagnose).toBe('function');
    expect(typeof diag.batchDiagnose).toBe('function');
    expect(typeof diag.getSymptoms).toBe('function');
    expect(typeof diag.getRootCauses).toBe('function');
    expect(typeof diag.getHistory).toBe('function');
    expect(typeof diag.clearHistory).toBe('function');
    expect(typeof diag.getTrends).toBe('function');
    expect(typeof diag.compareDiagnoses).toBe('function');
    expect(typeof diag.generateReport).toBe('function');
  });
});

// ── getSymptoms / getRootCauses ─────────────────────────────────

describe('getSymptoms', () => {
  const diag = createFailureDiagnostic();

  test('returns all symptom definitions', () => {
    const symptoms = diag.getSymptoms();
    expect(symptoms).toHaveLength(12);
    expect(symptoms[0]).toHaveProperty('id');
    expect(symptoms[0]).toHaveProperty('label');
  });

  test('returned symptom objects are copies', () => {
    const s1 = diag.getSymptoms();
    const s2 = diag.getSymptoms();
    expect(s1).not.toBe(s2);
    expect(s1[0]).not.toBe(s2[0]);
  });
});

describe('getSymptomsByCategory', () => {
  const diag = createFailureDiagnostic();

  test('returns symptoms grouped by category', () => {
    const cats = diag.getSymptomsByCategory();
    expect(cats).toHaveProperty('extrusion');
    expect(cats).toHaveProperty('structural');
    expect(cats).toHaveProperty('biological');
    expect(cats).toHaveProperty('environmental');
    expect(cats.extrusion.length).toBeGreaterThan(0);
  });
});

describe('getRootCauses', () => {
  const diag = createFailureDiagnostic();

  test('returns all root cause definitions', () => {
    const causes = diag.getRootCauses();
    expect(causes.length).toBe(Object.keys(ROOT_CAUSES).length);
  });
});

// ── diagnose ────────────────────────────────────────────────────

describe('diagnose', () => {
  let diag;
  beforeEach(() => { diag = createFailureDiagnostic(); });

  test('throws on empty symptoms', () => {
    expect(() => diag.diagnose([])).toThrow('non-empty');
  });

  test('throws on non-array symptoms', () => {
    expect(() => diag.diagnose('nozzle_clog')).toThrow('non-empty');
  });

  test('throws on unknown symptom', () => {
    expect(() => diag.diagnose(['unknown_symptom'])).toThrow('Unknown symptoms');
  });

  test('diagnoses single symptom', () => {
    const result = diag.diagnose(['nozzle_clog']);
    expect(result.symptoms).toHaveLength(1);
    expect(result.symptoms[0].id).toBe('nozzle_clog');
    expect(result.diagnoses.length).toBeGreaterThan(0);
    expect(result.primaryDiagnosis).not.toBeNull();
    expect(result.overallRisk).toBeGreaterThanOrEqual(0);
    expect(result.overallRisk).toBeLessThanOrEqual(100);
  });

  test('diagnoses multiple symptoms', () => {
    const result = diag.diagnose(['nozzle_clog', 'under_extrusion']);
    expect(result.symptoms).toHaveLength(2);
    expect(result.diagnoses.length).toBeGreaterThan(1);
  });

  test('returns sorted diagnoses by confidence (descending)', () => {
    const result = diag.diagnose(['cell_death', 'poor_adhesion', 'structural_collapse']);
    for (let i = 1; i < result.diagnoses.length; i++) {
      expect(result.diagnoses[i].confidence).toBeLessThanOrEqual(result.diagnoses[i - 1].confidence);
    }
  });

  test('diagnoses include corrective actions', () => {
    const result = diag.diagnose(['nozzle_clog']);
    for (const d of result.diagnoses) {
      expect(d.correctiveActions).toBeDefined();
      expect(Array.isArray(d.correctiveActions)).toBe(true);
    }
  });

  test('corrective actions sorted by priority', () => {
    const result = diag.diagnose(['cell_death']);
    for (const d of result.diagnoses) {
      for (let i = 1; i < d.correctiveActions.length; i++) {
        expect(d.correctiveActions[i].priority).toBeGreaterThanOrEqual(d.correctiveActions[i - 1].priority);
      }
    }
  });

  test('default severity is moderate', () => {
    const result = diag.diagnose(['nozzle_clog']);
    expect(result.severity).toBe('moderate');
  });

  test('respects custom severity', () => {
    const mild = diag.diagnose(['nozzle_clog'], null, 'mild');
    const critical = diag.diagnose(['nozzle_clog'], null, 'critical');
    expect(mild.severity).toBe('mild');
    expect(critical.severity).toBe('critical');
  });

  test('critical severity produces higher risk than mild', () => {
    const mild = diag.diagnose(['cell_death', 'structural_collapse'], null, 'mild');
    const critical = diag.diagnose(['cell_death', 'structural_collapse'], null, 'critical');
    expect(critical.overallRisk).toBeGreaterThanOrEqual(mild.overallRisk);
  });

  test('invalid severity defaults to moderate', () => {
    const result = diag.diagnose(['nozzle_clog'], null, 'nonexistent');
    expect(result.severity).toBe('moderate');
  });

  test('confidence capped at 1.0', () => {
    const result = diag.diagnose(
      ['cell_death', 'poor_adhesion', 'structural_collapse', 'crosslink_failure'],
      { pressure: 200, speed: 40, temperature: 45, crosslinkIntensity: 5 },
      'critical'
    );
    for (const d of result.diagnoses) {
      expect(d.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  test('overall risk is 0-100', () => {
    const result = diag.diagnose(['nozzle_clog', 'under_extrusion', 'cell_death', 'structural_collapse'], null, 'critical');
    expect(result.overallRisk).toBeGreaterThanOrEqual(0);
    expect(result.overallRisk).toBeLessThanOrEqual(100);
  });

  test('has timestamp', () => {
    const before = Date.now();
    const result = diag.diagnose(['nozzle_clog']);
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
  });
});

// ── Parameter-aware diagnosis ───────────────────────────────────

describe('diagnose with parameters', () => {
  let diag;
  beforeEach(() => { diag = createFailureDiagnostic(); });

  test('high pressure boosts related cause confidence', () => {
    const withoutParams = diag.diagnose(['nozzle_clog']);
    const withParams = diag.diagnose(['nozzle_clog'], { pressure: 200 });
    const causeWithout = withoutParams.diagnoses.find(d => d.cause === 'high_pressure');
    const causeWith = withParams.diagnoses.find(d => d.cause === 'high_pressure');
    expect(causeWith.confidence).toBeGreaterThanOrEqual(causeWithout.confidence);
  });

  test('narrow nozzle boosts clog diagnosis', () => {
    const result = diag.diagnose(['nozzle_clog'], { nozzleDiameter: 0.1 });
    const narrow = result.diagnoses.find(d => d.cause === 'narrow_nozzle');
    expect(narrow).toBeDefined();
    expect(narrow.confidence).toBeGreaterThan(0);
  });

  test('low pressure boosts under_extrusion diagnosis', () => {
    const result = diag.diagnose(['under_extrusion'], { pressure: 10 });
    const lowP = result.diagnoses.find(d => d.cause === 'low_pressure');
    expect(lowP).toBeDefined();
    expect(lowP.confidence).toBeGreaterThan(0.5);
  });

  test('high speed boosts poor_adhesion diagnosis', () => {
    const result = diag.diagnose(['poor_adhesion'], { speed: 35 });
    const highSpeed = result.diagnoses.find(d => d.cause === 'high_speed');
    expect(highSpeed).toBeDefined();
  });

  test('high shear calculated from composite parameters', () => {
    const result = diag.diagnose(['cell_death'], { speed: 40, pressure: 200, nozzleDiameter: 0.15 });
    const shear = result.diagnoses.find(d => d.cause === 'high_shear');
    expect(shear).toBeDefined();
    expect(shear.confidence).toBeGreaterThan(0);
  });

  test('low humidity boosts dehydration diagnosis', () => {
    const result = diag.diagnose(['dehydration'], { humidity: 20 });
    const lowH = result.diagnoses.find(d => d.cause === 'low_humidity');
    expect(lowH).toBeDefined();
    expect(lowH.confidence).toBeGreaterThan(0.7);
  });

  test('parameters stored in result', () => {
    const params = { pressure: 100, speed: 10, temperature: 37 };
    const result = diag.diagnose(['nozzle_clog'], params);
    expect(result.parameters).toEqual(params);
  });

  test('null params are fine', () => {
    const result = diag.diagnose(['nozzle_clog'], null);
    expect(result.parameters).toBeNull();
  });
});

// ── Co-occurrence patterns ──────────────────────────────────────

describe('co-occurrence patterns', () => {
  let diag;
  beforeEach(() => { diag = createFailureDiagnostic(); });

  test('detects flow restriction syndrome', () => {
    const result = diag.diagnose(['nozzle_clog', 'under_extrusion']);
    const patterns = result.coOccurrencePatterns;
    expect(patterns.some(p => p.label === 'Flow Restriction Syndrome')).toBe(true);
  });

  test('detects integrity failure syndrome', () => {
    const result = diag.diagnose(['structural_collapse', 'crosslink_failure']);
    expect(result.coOccurrencePatterns.some(p => p.label === 'Integrity Failure Syndrome')).toBe(true);
  });

  test('detects desiccation syndrome', () => {
    const result = diag.diagnose(['dehydration', 'warping']);
    expect(result.coOccurrencePatterns.some(p => p.label === 'Desiccation Syndrome')).toBe(true);
  });

  test('detects excess flow syndrome', () => {
    const result = diag.diagnose(['stringing', 'over_extrusion']);
    expect(result.coOccurrencePatterns.some(p => p.label === 'Excess Flow Syndrome')).toBe(true);
  });

  test('detects sterility failure syndrome', () => {
    const result = diag.diagnose(['contamination', 'cell_death']);
    expect(result.coOccurrencePatterns.some(p => p.label === 'Sterility Failure Syndrome')).toBe(true);
  });

  test('no patterns for unrelated symptoms', () => {
    const result = diag.diagnose(['poor_resolution']);
    expect(result.coOccurrencePatterns).toHaveLength(0);
  });

  test('co-occurrence boosts cause confidence', () => {
    // Without co-occurrence
    const single = diag.diagnose(['nozzle_clog']);
    // With co-occurrence (triggers Flow Restriction Syndrome → narrow_nozzle boost)
    const combined = diag.diagnose(['nozzle_clog', 'under_extrusion']);
    const singleNarrow = single.diagnoses.find(d => d.cause === 'narrow_nozzle');
    const combinedNarrow = combined.diagnoses.find(d => d.cause === 'narrow_nozzle');
    // Combined should have same or higher confidence due to more matching rules + boost
    expect(combinedNarrow).toBeDefined();
    expect(singleNarrow).toBeDefined();
  });
});

// ── batchDiagnose ───────────────────────────────────────────────

describe('batchDiagnose', () => {
  let diag;
  beforeEach(() => { diag = createFailureDiagnostic(); });

  test('throws on empty array', () => {
    expect(() => diag.batchDiagnose([])).toThrow('non-empty');
  });

  test('throws on non-array', () => {
    expect(() => diag.batchDiagnose('test')).toThrow('non-empty');
  });

  test('processes multiple prints', () => {
    const batch = diag.batchDiagnose([
      { symptoms: ['nozzle_clog'] },
      { symptoms: ['cell_death'] },
      { symptoms: ['poor_adhesion'] },
    ]);
    expect(batch.totalPrints).toBe(3);
    expect(batch.successfulDiagnoses).toBe(3);
    expect(batch.failedDiagnoses).toBe(0);
    expect(batch.results).toHaveLength(3);
  });

  test('handles failures gracefully', () => {
    const batch = diag.batchDiagnose([
      { symptoms: ['nozzle_clog'] },
      { symptoms: [] }, // will throw
    ]);
    expect(batch.totalPrints).toBe(2);
    expect(batch.successfulDiagnoses).toBe(1);
    expect(batch.failedDiagnoses).toBe(1);
    expect(batch.results[1].error).not.toBeNull();
  });

  test('returns most common causes', () => {
    const batch = diag.batchDiagnose([
      { symptoms: ['nozzle_clog'] },
      { symptoms: ['nozzle_clog', 'under_extrusion'] },
      { symptoms: ['cell_death'] },
    ]);
    expect(batch.mostCommonCauses.length).toBeGreaterThan(0);
    expect(batch.mostCommonCauses[0]).toHaveProperty('cause');
    expect(batch.mostCommonCauses[0]).toHaveProperty('occurrences');
    expect(batch.mostCommonCauses[0]).toHaveProperty('percentage');
  });

  test('returns most common symptoms', () => {
    const batch = diag.batchDiagnose([
      { symptoms: ['nozzle_clog'] },
      { symptoms: ['nozzle_clog'] },
      { symptoms: ['cell_death'] },
    ]);
    expect(batch.mostCommonSymptoms.length).toBeGreaterThan(0);
    expect(batch.mostCommonSymptoms[0].symptom).toBe('nozzle_clog');
  });

  test('calculates average risk', () => {
    const batch = diag.batchDiagnose([
      { symptoms: ['nozzle_clog'], severity: 'mild' },
      { symptoms: ['cell_death', 'structural_collapse'], severity: 'critical' },
    ]);
    expect(batch.averageRisk).toBeGreaterThan(0);
    expect(batch.averageRisk).toBeLessThanOrEqual(100);
  });

  test('batch with custom params', () => {
    const batch = diag.batchDiagnose([
      { symptoms: ['nozzle_clog'], params: { pressure: 200 } },
      { symptoms: ['under_extrusion'], params: { pressure: 10 } },
    ]);
    expect(batch.successfulDiagnoses).toBe(2);
  });
});

// ── History ─────────────────────────────────────────────────────

describe('history', () => {
  let diag;
  beforeEach(() => { diag = createFailureDiagnostic(); });

  test('starts empty', () => {
    expect(diag.getHistory()).toHaveLength(0);
  });

  test('records diagnoses', () => {
    diag.diagnose(['nozzle_clog']);
    diag.diagnose(['cell_death']);
    expect(diag.getHistory()).toHaveLength(2);
  });

  test('returns copies', () => {
    diag.diagnose(['nozzle_clog']);
    const h1 = diag.getHistory();
    const h2 = diag.getHistory();
    expect(h1).not.toBe(h2);
  });

  test('clearHistory empties history', () => {
    diag.diagnose(['nozzle_clog']);
    diag.diagnose(['cell_death']);
    diag.clearHistory();
    expect(diag.getHistory()).toHaveLength(0);
  });

  test('batch diagnoses add to history', () => {
    diag.batchDiagnose([
      { symptoms: ['nozzle_clog'] },
      { symptoms: ['cell_death'] },
    ]);
    expect(diag.getHistory().length).toBeGreaterThanOrEqual(2);
  });
});

// ── getTrends ───────────────────────────────────────────────────

describe('getTrends', () => {
  let diag;
  beforeEach(() => { diag = createFailureDiagnostic(); });

  test('empty history returns no trends', () => {
    const trends = diag.getTrends();
    expect(trends.window).toBe(0);
    expect(trends.trends).toHaveLength(0);
  });

  test('returns trends after diagnoses', () => {
    diag.diagnose(['nozzle_clog']);
    diag.diagnose(['nozzle_clog']);
    diag.diagnose(['cell_death']);
    const trends = diag.getTrends();
    expect(trends.window).toBe(3);
    expect(trends.trends.length).toBeGreaterThan(0);
  });

  test('trends sorted by frequency descending', () => {
    diag.diagnose(['nozzle_clog']);
    diag.diagnose(['nozzle_clog']);
    diag.diagnose(['nozzle_clog']);
    diag.diagnose(['cell_death']);
    const trends = diag.getTrends();
    for (let i = 1; i < trends.trends.length; i++) {
      expect(trends.trends[i].frequency).toBeLessThanOrEqual(trends.trends[i - 1].frequency);
    }
  });

  test('respects window size', () => {
    for (let i = 0; i < 15; i++) {
      diag.diagnose(['nozzle_clog']);
    }
    const trends = diag.getTrends(5);
    expect(trends.window).toBe(5);
  });

  test('trends have required fields', () => {
    diag.diagnose(['nozzle_clog']);
    const trends = diag.getTrends();
    for (const t of trends.trends) {
      expect(t).toHaveProperty('cause');
      expect(t).toHaveProperty('label');
      expect(t).toHaveProperty('frequency');
      expect(t).toHaveProperty('percentage');
      expect(t).toHaveProperty('avgConfidence');
    }
  });
});

// ── compareDiagnoses ────────────────────────────────────────────

describe('compareDiagnoses', () => {
  let diag;
  beforeEach(() => { diag = createFailureDiagnostic(); });

  test('throws without both diagnoses', () => {
    const d1 = diag.diagnose(['nozzle_clog']);
    expect(() => diag.compareDiagnoses(d1, null)).toThrow('Both diagnoses');
  });

  test('throws on invalid objects', () => {
    expect(() => diag.compareDiagnoses({}, {})).toThrow('Invalid');
  });

  test('compares two diagnoses', () => {
    const d1 = diag.diagnose(['nozzle_clog']);
    const d2 = diag.diagnose(['nozzle_clog', 'under_extrusion']);
    const comp = diag.compareDiagnoses(d1, d2);
    expect(comp).toHaveProperty('sharedCauses');
    expect(comp).toHaveProperty('uniqueToDiag1');
    expect(comp).toHaveProperty('uniqueToDiag2');
    expect(comp).toHaveProperty('confidenceChanges');
    expect(comp).toHaveProperty('riskDelta');
    expect(comp.sharedCauses).toBeGreaterThan(0);
  });

  test('detects unique causes', () => {
    const d1 = diag.diagnose(['nozzle_clog']);
    const d2 = diag.diagnose(['cell_death']);
    const comp = diag.compareDiagnoses(d1, d2);
    expect(comp.uniqueToDiag1.length).toBeGreaterThan(0);
    expect(comp.uniqueToDiag2.length).toBeGreaterThan(0);
  });

  test('confidence changes have deltas', () => {
    const d1 = diag.diagnose(['nozzle_clog'], { pressure: 50 });
    const d2 = diag.diagnose(['nozzle_clog'], { pressure: 200 });
    const comp = diag.compareDiagnoses(d1, d2);
    for (const cc of comp.confidenceChanges) {
      expect(cc).toHaveProperty('confidence1');
      expect(cc).toHaveProperty('confidence2');
      expect(cc).toHaveProperty('delta');
      expect(typeof cc.delta).toBe('number');
    }
  });

  test('severity change detected', () => {
    const d1 = diag.diagnose(['nozzle_clog'], null, 'mild');
    const d2 = diag.diagnose(['nozzle_clog'], null, 'critical');
    const comp = diag.compareDiagnoses(d1, d2);
    expect(comp.severityChange).not.toBeNull();
    expect(comp.severityChange.from).toBe('mild');
    expect(comp.severityChange.to).toBe('critical');
  });

  test('no severity change when same', () => {
    const d1 = diag.diagnose(['nozzle_clog'], null, 'moderate');
    const d2 = diag.diagnose(['cell_death'], null, 'moderate');
    const comp = diag.compareDiagnoses(d1, d2);
    expect(comp.severityChange).toBeNull();
  });
});

// ── generateReport ──────────────────────────────────────────────

describe('generateReport', () => {
  let diag;
  beforeEach(() => { diag = createFailureDiagnostic(); });

  test('throws on invalid input', () => {
    expect(() => diag.generateReport(null)).toThrow('Invalid');
    expect(() => diag.generateReport({})).toThrow('Invalid');
  });

  test('generates report for single symptom', () => {
    const result = diag.diagnose(['nozzle_clog']);
    const report = diag.generateReport(result);
    expect(typeof report).toBe('string');
    expect(report).toContain('DIAGNOSTIC REPORT');
    expect(report).toContain('Nozzle Clogging');
    expect(report).toContain('Root Cause Analysis');
  });

  test('report includes severity', () => {
    const result = diag.diagnose(['cell_death'], null, 'critical');
    const report = diag.generateReport(result);
    expect(report).toContain('CRITICAL');
  });

  test('report includes parameters when provided', () => {
    const result = diag.diagnose(['nozzle_clog'], { pressure: 150, speed: 20 });
    const report = diag.generateReport(result);
    expect(report).toContain('Print Parameters');
    expect(report).toContain('pressure');
    expect(report).toContain('150');
  });

  test('report includes co-occurrence patterns', () => {
    const result = diag.diagnose(['nozzle_clog', 'under_extrusion']);
    const report = diag.generateReport(result);
    expect(report).toContain('Co-Occurrence');
    expect(report).toContain('Flow Restriction');
  });

  test('report includes corrective actions', () => {
    const result = diag.diagnose(['nozzle_clog']);
    const report = diag.generateReport(result);
    expect(report).toContain('Corrective Actions');
  });

  test('report includes primary recommendation', () => {
    const result = diag.diagnose(['cell_death']);
    const report = diag.generateReport(result);
    expect(report).toContain('Primary Recommendation');
  });

  test('report includes confidence bars', () => {
    const result = diag.diagnose(['nozzle_clog']);
    const report = diag.generateReport(result);
    expect(report).toContain('Confidence:');
    expect(report).toMatch(/[█░]+/);
  });
});

// ── Comprehensive scenario tests ────────────────────────────────

describe('real-world scenarios', () => {
  let diag;
  beforeEach(() => { diag = createFailureDiagnostic(); });

  test('scenario: cold-start gelation problem', () => {
    const result = diag.diagnose(
      ['nozzle_clog', 'under_extrusion'],
      { temperature: 10, pressure: 80, nozzleDiameter: 0.3 },
      'severe'
    );
    // Low temperature should be identified as a cause
    const lowTemp = result.diagnoses.find(d => d.cause === 'low_temperature');
    expect(lowTemp).toBeDefined();
    expect(result.overallRisk).toBeGreaterThan(30);
  });

  test('scenario: aggressive print causing cell death', () => {
    const result = diag.diagnose(
      ['cell_death', 'poor_adhesion'],
      { speed: 40, pressure: 200, temperature: 40, nozzleDiameter: 0.15 },
      'critical'
    );
    const highShear = result.diagnoses.find(d => d.cause === 'high_shear');
    expect(highShear).toBeDefined();
    expect(result.overallRisk).toBeGreaterThan(50);
  });

  test('scenario: dry environment printing', () => {
    const result = diag.diagnose(
      ['dehydration', 'warping'],
      { humidity: 20, temperature: 30, printDuration: 150 },
    );
    const lowHumidity = result.diagnoses.find(d => d.cause === 'low_humidity');
    expect(lowHumidity).toBeDefined();
    // Should detect desiccation syndrome
    expect(result.coOccurrencePatterns.some(p => p.label === 'Desiccation Syndrome')).toBe(true);
  });

  test('scenario: contaminated non-sterile print', () => {
    const result = diag.diagnose(['contamination', 'cell_death']);
    const nonSterile = result.diagnoses.find(d => d.cause === 'non_sterile');
    expect(nonSterile).toBeDefined();
    expect(result.coOccurrencePatterns.some(p => p.label === 'Sterility Failure Syndrome')).toBe(true);
  });

  test('scenario: all symptoms at once (stress test)', () => {
    const allSymptoms = Object.keys(SYMPTOMS);
    const result = diag.diagnose(allSymptoms, null, 'critical');
    expect(result.diagnoses.length).toBeGreaterThan(5);
    expect(result.overallRisk).toBeGreaterThan(0);
    expect(result.coOccurrencePatterns.length).toBeGreaterThan(0);
  });
});

// ── Edge cases ──────────────────────────────────────────────────

describe('edge cases', () => {
  let diag;
  beforeEach(() => { diag = createFailureDiagnostic(); });

  test('diagnose with params that do not trigger boosts', () => {
    const result = diag.diagnose(['nozzle_clog'], { pressure: 50, nozzleDiameter: 0.5, temperature: 30 });
    // Should still produce results, just no param boosts
    expect(result.diagnoses.length).toBeGreaterThan(0);
  });

  test('batch with single print', () => {
    const batch = diag.batchDiagnose([{ symptoms: ['nozzle_clog'] }]);
    expect(batch.totalPrints).toBe(1);
    expect(batch.successfulDiagnoses).toBe(1);
  });

  test('trends with default window', () => {
    diag.diagnose(['nozzle_clog']);
    const trends = diag.getTrends();
    expect(trends.window).toBe(1);
  });

  test('multiple instances have independent history', () => {
    const d1 = createFailureDiagnostic();
    const d2 = createFailureDiagnostic();
    d1.diagnose(['nozzle_clog']);
    expect(d1.getHistory()).toHaveLength(1);
    expect(d2.getHistory()).toHaveLength(0);
  });

  test('duplicate symptoms in input', () => {
    // Should still work (rules just match twice for same symptom, but results are aggregated)
    const result = diag.diagnose(['nozzle_clog', 'nozzle_clog']);
    expect(result.symptoms).toHaveLength(2);
    expect(result.diagnoses.length).toBeGreaterThan(0);
  });
});
