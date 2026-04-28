'use strict';

const {
  createWorkflowOrchestrator,
  createPipeline,
  executePipeline,
  detectAnomalies,
  recommendFix,
  getPresetPipelines,
  scorePipelineHealth,
  autoOptimize,
  STEP_TYPES
} = require('../docs/shared/workflowOrchestrator');

/* ── createPipeline ─────────────────────────────────────────────── */

describe('createPipeline', () => {
  const validStep = { id: 's1', name: 'Prep', type: 'bioink-prep' };

  test('creates pipeline with valid name and steps', () => {
    const p = createPipeline('Test', [validStep]);
    expect(p.name).toBe('Test');
    expect(p.steps).toHaveLength(1);
    expect(p.steps[0]).toEqual(validStep);
    expect(typeof p.created).toBe('string');
  });

  test('throws on missing name', () => {
    expect(() => createPipeline('', [validStep])).toThrow('Pipeline name required');
    expect(() => createPipeline(null, [validStep])).toThrow('Pipeline name required');
  });

  test('throws on empty steps array', () => {
    expect(() => createPipeline('P', [])).toThrow('At least one step required');
  });

  test('throws on non-array steps', () => {
    expect(() => createPipeline('P', 'bad')).toThrow('At least one step required');
  });

  test('throws on step missing required fields', () => {
    expect(() => createPipeline('P', [{ id: 's1', name: 'X' }]))
      .toThrow('Step must have id, name, type');
    expect(() => createPipeline('P', [{ id: 's1', type: 'bioink-prep' }]))
      .toThrow('Step must have id, name, type');
  });

  test('throws on unknown step type', () => {
    expect(() => createPipeline('P', [{ id: 's1', name: 'X', type: 'magic' }]))
      .toThrow('Unknown step type: magic');
  });

  test('accepts all valid step types', () => {
    STEP_TYPES.forEach(type => {
      const p = createPipeline('T', [{ id: 'x', name: 'X', type }]);
      expect(p.steps[0].type).toBe(type);
    });
  });

  test('multi-step pipeline preserves order', () => {
    const steps = [
      { id: 's1', name: 'A', type: 'bioink-prep' },
      { id: 's2', name: 'B', type: 'crosslink' },
      { id: 's3', name: 'C', type: 'quality-assessment' }
    ];
    const p = createPipeline('Multi', steps);
    expect(p.steps.map(s => s.id)).toEqual(['s1', 's2', 's3']);
  });
});

/* ── STEP_TYPES constant ─────────────────────────────────────────── */

describe('STEP_TYPES', () => {
  test('contains expected step types', () => {
    expect(STEP_TYPES).toContain('bioink-prep');
    expect(STEP_TYPES).toContain('rheology-check');
    expect(STEP_TYPES).toContain('cell-seeding');
    expect(STEP_TYPES).toContain('print-execution');
    expect(STEP_TYPES).toContain('crosslink');
    expect(STEP_TYPES).toContain('viability-check');
    expect(STEP_TYPES).toContain('quality-assessment');
    expect(STEP_TYPES).toHaveLength(7);
  });
});

/* ── detectAnomalies ─────────────────────────────────────────────── */

describe('detectAnomalies', () => {
  test('returns empty when no expected range', () => {
    expect(detectAnomalies({ viscosity: 500 }, null)).toEqual([]);
    expect(detectAnomalies({ viscosity: 500 }, undefined)).toEqual([]);
  });

  test('returns empty when value within range', () => {
    const result = detectAnomalies(
      { viscosity: 500 },
      { viscosity: { min: 200, max: 800 } }
    );
    expect(result).toEqual([]);
  });

  test('detects value below min as warning', () => {
    const result = detectAnomalies(
      { viscosity: 190 },
      { viscosity: { min: 200, max: 800 } }
    );
    expect(result).toHaveLength(1);
    expect(result[0].metric).toBe('viscosity');
    expect(result[0].value).toBe(190);
    expect(result[0].severity).toBe('warning');
  });

  test('detects value above max as warning', () => {
    const result = detectAnomalies(
      { viscosity: 850 },
      { viscosity: { min: 200, max: 800 } }
    );
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('warning');
  });

  test('detects critical anomaly when far below min', () => {
    // Critical when val < min * 0.8
    const result = detectAnomalies(
      { viscosity: 100 },
      { viscosity: { min: 200, max: 800 } }
    );
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('critical');
  });

  test('detects critical anomaly when far above max', () => {
    // Critical when val > max * 1.2
    const result = detectAnomalies(
      { viscosity: 1000 },
      { viscosity: { min: 200, max: 800 } }
    );
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('critical');
  });

  test('skips metrics not in result', () => {
    const result = detectAnomalies(
      { viscosity: 500 },
      { homogeneity: { min: 0.8, max: 1 } }
    );
    expect(result).toEqual([]);
  });

  test('checks multiple metrics independently', () => {
    const result = detectAnomalies(
      { viscosity: 100, homogeneity: 0.5 },
      {
        viscosity: { min: 200, max: 800 },
        homogeneity: { min: 0.8, max: 1 }
      }
    );
    expect(result).toHaveLength(2);
    expect(result.map(a => a.metric).sort()).toEqual(['homogeneity', 'viscosity']);
  });

  test('ignores non-numeric values', () => {
    const result = detectAnomalies(
      { pass_fail: 'PASS' },
      { pass_fail: { min: 0, max: 1 } }
    );
    expect(result).toEqual([]);
  });
});

/* ── recommendFix ────────────────────────────────────────────────── */

describe('recommendFix', () => {
  test('returns fix for known metric below min', () => {
    const fix = recommendFix({
      metric: 'viscosity',
      value: 100,
      expected: { min: 200, max: 800 }
    });
    expect(fix).toContain('Increase polymer concentration');
  });

  test('returns fix for known metric above max', () => {
    const fix = recommendFix({
      metric: 'viscosity',
      value: 900,
      expected: { min: 200, max: 800 }
    });
    expect(fix).toContain('Reduce concentration');
  });

  test('returns generic fix for unknown metric', () => {
    const fix = recommendFix({
      metric: 'unknown_metric',
      value: 5,
      expected: { min: 10, max: 20 }
    });
    expect(fix).toContain('upward');
  });

  test('covers viability_pct low fix', () => {
    const fix = recommendFix({
      metric: 'viability_pct',
      value: 0.5,
      expected: { min: 0.8, max: 1 }
    });
    expect(fix).toContain('crosslinking');
  });

  test('covers crosslink_density high fix', () => {
    const fix = recommendFix({
      metric: 'crosslink_density',
      value: 0.95,
      expected: { min: 0.3, max: 0.7 }
    });
    expect(fix).toContain('cell viability');
  });
});

/* ── scorePipelineHealth ─────────────────────────────────────────── */

describe('scorePipelineHealth', () => {
  test('returns zero for empty results', () => {
    const h = scorePipelineHealth([]);
    expect(h.score).toBe(0);
    expect(h.breakdown).toEqual({});
  });

  test('scores all-passed pipeline at 100', () => {
    const results = [
      { step: { name: 'A' }, status: 'passed' },
      { step: { name: 'B' }, status: 'passed' }
    ];
    const h = scorePipelineHealth(results);
    expect(h.score).toBe(100);
    expect(h.breakdown.A).toBe(100);
    expect(h.breakdown.B).toBe(100);
  });

  test('warning steps scored at 70', () => {
    const results = [
      { step: { name: 'A' }, status: 'warning' }
    ];
    expect(scorePipelineHealth(results).score).toBe(70);
  });

  test('failed steps scored at 30', () => {
    const results = [
      { step: { name: 'A' }, status: 'failed' }
    ];
    expect(scorePipelineHealth(results).score).toBe(30);
  });

  test('mixed statuses produce averaged score', () => {
    const results = [
      { step: { name: 'A' }, status: 'passed' },  // 100
      { step: { name: 'B' }, status: 'failed' }    // 30
    ];
    const h = scorePipelineHealth(results);
    expect(h.score).toBe(65); // (100+30)/2
  });
});

/* ── executePipeline ─────────────────────────────────────────────── */

describe('executePipeline', () => {
  test('executes a single-step pipeline', () => {
    const pipeline = createPipeline('Single', [
      { id: 's1', name: 'Prep', type: 'bioink-prep', params: { concentration: 3, temperature: 25, mixing_time: 10 } }
    ]);
    const result = executePipeline(pipeline);
    expect(result.pipeline).toBe('Single');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].output).toHaveProperty('viscosity');
    expect(result.results[0].output).toHaveProperty('homogeneity');
    expect(typeof result.duration).toBe('number');
    expect(result.timestamp).toBeTruthy();
  });

  test('propagates outputs between steps', () => {
    const pipeline = createPipeline('Chain', [
      { id: 's1', name: 'Prep', type: 'bioink-prep', params: { concentration: 3 } },
      { id: 's2', name: 'Rheology', type: 'rheology-check', params: {} }
    ]);
    const result = executePipeline(pipeline);
    expect(result.results).toHaveLength(2);
    // Rheology should have received viscosity from bioink-prep
    expect(result.results[1].output).toHaveProperty('printability_score');
  });

  test('detects anomalies during execution', () => {
    const pipeline = createPipeline('Anomaly', [
      { id: 's1', name: 'Prep', type: 'bioink-prep',
        params: { concentration: 3, temperature: 25, mixing_time: 10 },
        expectedOutputRange: { viscosity: { min: 10000, max: 20000 } } // impossible range
      }
    ]);
    const result = executePipeline(pipeline);
    expect(result.anomalies.length).toBeGreaterThan(0);
    expect(result.anomalies[0].step).toBe('Prep');
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  test('uses initialParams when provided', () => {
    const pipeline = createPipeline('WithInit', [
      { id: 's1', name: 'Rheology', type: 'rheology-check', params: {} }
    ]);
    const result = executePipeline(pipeline, { viscosity: 500 });
    expect(result.results[0].output).toHaveProperty('shear_thinning_index');
  });

  test('status is completed when no critical anomalies', () => {
    const pipeline = createPipeline('OK', [
      { id: 's1', name: 'Prep', type: 'bioink-prep',
        params: { concentration: 3, temperature: 25, mixing_time: 10 },
        expectedOutputRange: { viscosity: { min: 50, max: 5000 }, homogeneity: { min: 0, max: 1 } }
      }
    ]);
    const result = executePipeline(pipeline);
    expect(['completed', 'completed-with-issues']).toContain(result.status);
  });

  test('full 7-step standard pipeline executes', () => {
    const presets = getPresetPipelines();
    const standard = presets[0]; // 'Standard Bioprint'
    const result = executePipeline(standard);
    expect(result.results).toHaveLength(7);
    expect(result.health).toHaveProperty('score');
    expect(result.health.score).toBeGreaterThanOrEqual(0);
    expect(result.health.score).toBeLessThanOrEqual(100);
  });

  test('cell-seeding produces seeded_count and uniformity', () => {
    const pipeline = createPipeline('Seed', [
      { id: 's1', name: 'Seed', type: 'cell-seeding',
        params: { cell_density: 1e6, volume: 1 } }
    ]);
    const result = executePipeline(pipeline);
    const out = result.results[0].output;
    expect(out).toHaveProperty('seeded_count');
    expect(out).toHaveProperty('distribution_uniformity');
    expect(out.seeded_count).toBeGreaterThan(0);
    expect(out.distribution_uniformity).toBeGreaterThan(0);
    expect(out.distribution_uniformity).toBeLessThanOrEqual(1);
  });

  test('print-execution tracks layers and accuracy', () => {
    const pipeline = createPipeline('Print', [
      { id: 's1', name: 'Print', type: 'print-execution',
        params: { layers: 20, speed: 10, pressure: 200 } }
    ]);
    const result = executePipeline(pipeline);
    const out = result.results[0].output;
    expect(out.layers_target).toBe(20);
    expect(out.layers_completed).toBeLessThanOrEqual(20);
    expect(out.layers_completed).toBeGreaterThan(0);
    expect(out.dimensional_accuracy).toBeGreaterThan(0);
    expect(out.dimensional_accuracy).toBeLessThanOrEqual(1);
  });

  test('crosslink produces density and gel strength', () => {
    const pipeline = createPipeline('XL', [
      { id: 's1', name: 'XL', type: 'crosslink',
        params: { uv_intensity: 10, duration: 60 } }
    ]);
    const out = executePipeline(pipeline).results[0].output;
    expect(out).toHaveProperty('crosslink_density');
    expect(out).toHaveProperty('gel_strength');
    expect(out.crosslink_density).toBeGreaterThanOrEqual(0);
    expect(out.crosslink_density).toBeLessThanOrEqual(1);
  });

  test('quality-assessment produces pass/fail', () => {
    const pipeline = createPipeline('QA', [
      { id: 's1', name: 'QA', type: 'quality-assessment', params: {} }
    ]);
    const out = executePipeline(pipeline).results[0].output;
    expect(out).toHaveProperty('overall_score');
    expect(out).toHaveProperty('pass_fail');
    expect(['PASS', 'FAIL']).toContain(out.pass_fail);
    expect(out).toHaveProperty('defect_list');
    expect(Array.isArray(out.defect_list)).toBe(true);
  });
});

/* ── autoOptimize ────────────────────────────────────────────────── */

describe('autoOptimize', () => {
  test('returns message when < 2 history runs', () => {
    const pipeline = createPipeline('T', [
      { id: 's1', name: 'Prep', type: 'bioink-prep', params: {} }
    ]);
    const opt = autoOptimize(pipeline, []);
    expect(opt.suggestions).toEqual([]);
    expect(opt.message).toContain('at least 2');

    const opt2 = autoOptimize(pipeline, [{ anomalies: [] }]);
    expect(opt2.suggestions).toEqual([]);
  });

  test('detects recurring anomalies across runs', () => {
    const pipeline = createPipeline('T', [
      { id: 's1', name: 'Prep', type: 'bioink-prep', params: {} }
    ]);
    const history = [
      { anomalies: [{ step: 'Prep', metric: 'viscosity' }] },
      { anomalies: [{ step: 'Prep', metric: 'viscosity' }] },
      { anomalies: [] }
    ];
    const opt = autoOptimize(pipeline, history);
    expect(opt.suggestions.length).toBeGreaterThan(0);
    const visSugg = opt.suggestions.find(s => s.metric === 'viscosity');
    expect(visSugg).toBeTruthy();
    expect(visSugg.step).toBe('Prep');
    expect(visSugg.frequency).toContain('2/3');
  });

  test('flags high priority when anomaly is frequent', () => {
    const history = [
      { anomalies: [{ step: 'A', metric: 'x' }] },
      { anomalies: [{ step: 'A', metric: 'x' }] },
      { anomalies: [{ step: 'A', metric: 'x' }] }
    ];
    const opt = autoOptimize({}, history);
    expect(opt.suggestions[0].priority).toBe('high');
  });

  test('detects declining health trend', () => {
    const history = [
      { anomalies: [], health: { score: 90 } },
      { anomalies: [], health: { score: 85 } },
      { anomalies: [], health: { score: 70 } }
    ];
    const opt = autoOptimize({}, history);
    const trendSugg = opt.suggestions.find(s => s.metric === 'health_trend');
    expect(trendSugg).toBeTruthy();
    expect(trendSugg.priority).toBe('high');
    expect(trendSugg.suggestion).toContain('declining');
  });

  test('reports healthy when no issues', () => {
    const history = [
      { anomalies: [], health: { score: 95 } },
      { anomalies: [], health: { score: 97 } }
    ];
    const opt = autoOptimize({}, history);
    expect(opt.suggestions).toEqual([]);
    expect(opt.message).toContain('healthy');
  });
});

/* ── getPresetPipelines ──────────────────────────────────────────── */

describe('getPresetPipelines', () => {
  test('returns array of valid pipelines', () => {
    const presets = getPresetPipelines();
    expect(presets.length).toBeGreaterThanOrEqual(4);
    presets.forEach(p => {
      expect(p.name).toBeTruthy();
      expect(p.steps.length).toBeGreaterThan(0);
      expect(p.created).toBeTruthy();
    });
  });

  test('all preset pipelines can execute', () => {
    const presets = getPresetPipelines();
    presets.forEach(p => {
      const result = executePipeline(p);
      expect(result.results.length).toBe(p.steps.length);
      expect(['completed', 'completed-with-issues']).toContain(result.status);
    });
  });

  test('preset names are unique', () => {
    const names = getPresetPipelines().map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

/* ── createWorkflowOrchestrator factory ──────────────────────────── */

describe('createWorkflowOrchestrator', () => {
  test('returns object with all expected methods', () => {
    const o = createWorkflowOrchestrator();
    expect(typeof o.createPipeline).toBe('function');
    expect(typeof o.executePipeline).toBe('function');
    expect(typeof o.detectAnomalies).toBe('function');
    expect(typeof o.recommendFix).toBe('function');
    expect(typeof o.getPresetPipelines).toBe('function');
    expect(typeof o.scorePipelineHealth).toBe('function');
    expect(typeof o.autoOptimize).toBe('function');
    expect(o.STEP_TYPES).toEqual(STEP_TYPES);
  });
});
