/**
 * Tests for Print Parameter Optimizer
 */

const {
  createParameterOptimizer,
  PARAMETER_DEFS,
  BIOINK_PRESETS,
  viabilityScore,
  structuralScore,
  resolutionScore,
  throughputScore,
} = require('../Try/scripts/parameterOptimizer');

// Helper: valid default params
const BASE_PARAMS = {
  speed: 10,
  pressure: 50,
  temperature: 30,
  nozzleDiameter: 0.4,
  layerHeight: 0.25,
  infill: 60,
};

describe('Parameter Definitions', () => {
  test('all 6 parameters defined with min/max/unit/label', () => {
    const keys = Object.keys(PARAMETER_DEFS);
    expect(keys).toHaveLength(6);
    for (const def of Object.values(PARAMETER_DEFS)) {
      expect(def.min).toBeDefined();
      expect(def.max).toBeDefined();
      expect(def.min).toBeLessThan(def.max);
      expect(def.unit).toBeTruthy();
      expect(def.label).toBeTruthy();
    }
  });
});

describe('Bioink Presets', () => {
  test('all 6 presets exist with required fields', () => {
    expect(Object.keys(BIOINK_PRESETS)).toHaveLength(6);
    for (const preset of Object.values(BIOINK_PRESETS)) {
      expect(preset.name).toBeTruthy();
      expect(preset.weights).toBeDefined();
      expect(preset.constraints).toBeDefined();
    }
  });
});

describe('Objective Functions', () => {
  test('viabilityScore returns 0-1', () => {
    const s = viabilityScore(BASE_PARAMS);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  test('viabilityScore decreases with extreme pressure', () => {
    const low = viabilityScore({ ...BASE_PARAMS, pressure: 20 });
    const high = viabilityScore({ ...BASE_PARAMS, pressure: 280 });
    expect(low).toBeGreaterThan(high);
  });

  test('structuralScore returns 0-1', () => {
    const s = structuralScore(BASE_PARAMS);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  test('structuralScore increases with higher infill', () => {
    const lo = structuralScore({ ...BASE_PARAMS, infill: 20 });
    const hi = structuralScore({ ...BASE_PARAMS, infill: 100 });
    expect(hi).toBeGreaterThan(lo);
  });

  test('resolutionScore returns 0-1', () => {
    const s = resolutionScore(BASE_PARAMS);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  test('resolutionScore higher with smaller nozzle', () => {
    const small = resolutionScore({ ...BASE_PARAMS, nozzleDiameter: 0.15 });
    const big = resolutionScore({ ...BASE_PARAMS, nozzleDiameter: 1.2 });
    expect(small).toBeGreaterThan(big);
  });

  test('throughputScore returns 0-1', () => {
    const s = throughputScore(BASE_PARAMS);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  test('throughputScore higher with faster speed', () => {
    const slow = throughputScore({ ...BASE_PARAMS, speed: 2 });
    const fast = throughputScore({ ...BASE_PARAMS, speed: 45 });
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('createParameterOptimizer', () => {
  let opt;
  beforeEach(() => { opt = createParameterOptimizer(); });

  describe('evaluate', () => {
    test('returns scores for valid params', () => {
      const result = opt.evaluate(BASE_PARAMS);
      expect(result.params).toEqual(BASE_PARAMS);
      expect(result.scores.viability).toBeGreaterThanOrEqual(0);
      expect(result.scores.structural).toBeGreaterThanOrEqual(0);
      expect(result.scores.resolution).toBeGreaterThanOrEqual(0);
      expect(result.scores.throughput).toBeGreaterThanOrEqual(0);
      expect(result.scores.composite).toBeGreaterThanOrEqual(0);
    });

    test('composite is weighted sum of sub-scores', () => {
      const result = opt.evaluate(BASE_PARAMS);
      const w = opt.getWeights();
      const expected = w.viability * result.scores.viability +
        w.structural * result.scores.structural +
        w.resolution * result.scores.resolution +
        w.throughput * result.scores.throughput;
      expect(result.scores.composite).toBeCloseTo(expected, 10);
    });

    test('throws on missing parameter', () => {
      const { speed, ...incomplete } = BASE_PARAMS;
      expect(() => opt.evaluate(incomplete)).toThrow(/Missing/);
    });

    test('throws on out-of-range parameter', () => {
      expect(() => opt.evaluate({ ...BASE_PARAMS, speed: 999 })).toThrow(/out of range/);
    });

    test('throws on NaN parameter', () => {
      expect(() => opt.evaluate({ ...BASE_PARAMS, speed: NaN })).toThrow(/must be a number/);
    });
  });

  describe('gridSearch', () => {
    test('returns results sorted by composite score', () => {
      const result = opt.gridSearch({ steps: 3, fixedParams: { nozzleDiameter: 0.4, layerHeight: 0.2, infill: 60, temperature: 30 } });
      expect(result.totalEvaluated).toBe(9); // 3^2 free params (speed, pressure)
      expect(result.best).toBeDefined();
      expect(result.best.scores.composite).toBeGreaterThan(0);
    });

    test('respects fixed params', () => {
      const result = opt.gridSearch({ steps: 3, fixedParams: { speed: 10, pressure: 50, temperature: 30, nozzleDiameter: 0.4, layerHeight: 0.25, infill: 60 } });
      expect(result.totalEvaluated).toBe(1);
      expect(result.best.params.speed).toBe(10);
    });

    test('adds to history', () => {
      expect(opt.getHistory()).toHaveLength(0);
      opt.gridSearch({ steps: 2, fixedParams: { nozzleDiameter: 0.4, layerHeight: 0.2, infill: 60, temperature: 30 } });
      expect(opt.getHistory()).toHaveLength(1);
    });

    test('top5 has at most 5 entries', () => {
      const result = opt.gridSearch({ steps: 3, fixedParams: { nozzleDiameter: 0.4, layerHeight: 0.2, infill: 60, temperature: 30 } });
      expect(result.top5.length).toBeLessThanOrEqual(5);
    });
  });

  describe('sensitivityAnalysis', () => {
    test('returns ranking for all parameters', () => {
      const result = opt.sensitivityAnalysis(BASE_PARAMS);
      expect(result.ranking).toHaveLength(6);
      expect(result.ranking[0].rank).toBe(1);
      expect(result.baseScore).toBeGreaterThan(0);
    });

    test('sweep has correct number of steps', () => {
      const result = opt.sensitivityAnalysis(BASE_PARAMS, { steps: 5 });
      for (const r of result.ranking) {
        expect(r.sweep).toHaveLength(5);
      }
    });

    test('each sweep point has delta from base', () => {
      const result = opt.sensitivityAnalysis(BASE_PARAMS, { steps: 3 });
      for (const r of result.ranking) {
        for (const s of r.sweep) {
          expect(typeof s.delta).toBe('number');
        }
      }
    });

    test('ranking is sorted by range descending', () => {
      const result = opt.sensitivityAnalysis(BASE_PARAMS);
      for (let i = 1; i < result.ranking.length; i++) {
        expect(result.ranking[i - 1].range).toBeGreaterThanOrEqual(result.ranking[i].range);
      }
    });
  });

  describe('paretoFront', () => {
    test('extracts non-dominated solutions', () => {
      const evals = [
        opt.evaluate({ ...BASE_PARAMS, speed: 5 }),
        opt.evaluate({ ...BASE_PARAMS, speed: 15 }),
        opt.evaluate({ ...BASE_PARAMS, speed: 30 }),
        opt.evaluate({ ...BASE_PARAMS, speed: 45 }),
      ];
      const result = opt.paretoFront(evals, 'viability', 'throughput');
      expect(result.frontSize).toBeGreaterThan(0);
      expect(result.frontSize).toBeLessThanOrEqual(evals.length);
      expect(result.objective1).toBe('viability');
      expect(result.objective2).toBe('throughput');
    });

    test('front points are truly non-dominated', () => {
      const evals = [];
      for (let s = 2; s <= 40; s += 5) {
        evals.push(opt.evaluate({ ...BASE_PARAMS, speed: s }));
      }
      const result = opt.paretoFront(evals, 'viability', 'throughput');
      for (let i = 0; i < result.front.length - 1; i++) {
        // Each successive point must have higher obj2
        expect(result.front[i + 1].obj2).toBeGreaterThan(result.front[i].obj2);
      }
    });
  });

  describe('fullOptimize', () => {
    test('returns search, sensitivity, and pareto', () => {
      const result = opt.fullOptimize({
        steps: 2,
        fixedParams: { nozzleDiameter: 0.4, layerHeight: 0.2, infill: 60 },
      });
      expect(result.search).toBeDefined();
      expect(result.sensitivity).toBeDefined();
      expect(result.pareto).toBeDefined();
    });
  });

  describe('compare', () => {
    test('shows diff between two parameter sets', () => {
      const paramsA = { ...BASE_PARAMS, speed: 5 };
      const paramsB = { ...BASE_PARAMS, speed: 30 };
      const result = opt.compare(paramsA, paramsB);
      expect(result.paramDiff.speed.delta).toBe(25);
      expect(result.a.scores).toBeDefined();
      expect(result.b.scores).toBeDefined();
      expect(result.scoreDiff.composite).toBeDefined();
    });
  });

  describe('textReport', () => {
    test('generates readable report', () => {
      const result = opt.fullOptimize({
        steps: 2,
        fixedParams: { nozzleDiameter: 0.4, layerHeight: 0.2, infill: 60 },
      });
      const report = opt.textReport(result);
      expect(report).toContain('OPTIMIZATION REPORT');
      expect(report).toContain('OPTIMAL PARAMETERS');
      expect(report).toContain('SCORES');
      expect(report).toContain('SENSITIVITY');
      expect(report).toContain('PARETO');
    });
  });

  describe('getPreset', () => {
    test('returns preset for valid bioink', () => {
      const preset = opt.getPreset('alginate');
      expect(preset.name).toBe('Alginate');
    });

    test('throws for unknown bioink', () => {
      expect(() => opt.getPreset('unobtainium')).toThrow(/Unknown bioink/);
    });
  });

  describe('forBioink', () => {
    test('creates optimizer with bioink constraints', () => {
      const colOpt = opt.forBioink('collagen');
      expect(colOpt.getConstraints().temperature.max).toBeLessThanOrEqual(25);
    });

    test('throws for unknown bioink', () => {
      expect(() => opt.forBioink('nonexistent')).toThrow(/Unknown bioink/);
    });
  });

  describe('custom weights', () => {
    test('custom weights change composite scoring', () => {
      const viabOpt = createParameterOptimizer({ weights: { viability: 1.0, structural: 0, resolution: 0, throughput: 0 } });
      const thruOpt = createParameterOptimizer({ weights: { viability: 0, structural: 0, resolution: 0, throughput: 1.0 } });
      const slowParams = { ...BASE_PARAMS, speed: 2 };
      const fastParams = { ...BASE_PARAMS, speed: 45 };

      // Viability optimizer should prefer slow
      expect(viabOpt.evaluate(slowParams).scores.composite).toBeGreaterThan(viabOpt.evaluate(fastParams).scores.composite);
      // Throughput optimizer should prefer fast
      expect(thruOpt.evaluate(fastParams).scores.composite).toBeGreaterThan(thruOpt.evaluate(slowParams).scores.composite);
    });
  });

  describe('custom constraints', () => {
    test('constraints narrow the search space', () => {
      const narrowOpt = createParameterOptimizer({
        constraints: { speed: { min: 5, max: 10 } },
      });
      const c = narrowOpt.getConstraints();
      expect(c.speed.min).toBe(5);
      expect(c.speed.max).toBe(10);
    });

    test('rejects params outside custom constraints', () => {
      const narrowOpt = createParameterOptimizer({
        constraints: { speed: { min: 5, max: 10 } },
      });
      expect(() => narrowOpt.evaluate({ ...BASE_PARAMS, speed: 2 })).toThrow(/out of range/);
    });
  });
});
