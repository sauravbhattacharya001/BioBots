'use strict';

const {
  createScaffold,
  calculatePorosity,
  analyzePoreSizes,
  estimateInterconnectivity,
  estimatePermeability,
  scoreTissueSuitability,
  compareAllTissues,
  analyzeScaffold,
  suggestParameters,
  TISSUE_TARGETS,
  _utils
} = require('../Try/scripts/porosity');

const { mean, stddev, median, percentile } = _utils;

// ── Utility tests ──

describe('Utility functions', () => {
  test('mean of empty array is 0', () => {
    expect(mean([])).toBe(0);
  });
  test('mean computes correctly', () => {
    expect(mean([2, 4, 6])).toBe(4);
  });
  test('stddev of single element is 0', () => {
    expect(stddev([5])).toBe(0);
  });
  test('stddev computes sample standard deviation', () => {
    const s = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s).toBeCloseTo(2.138, 2);
  });
  test('median of odd-length array', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  test('median of even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  test('percentile at boundaries', () => {
    const arr = [10, 20, 30, 40, 50];
    expect(percentile(arr, 0)).toBe(10);
    expect(percentile(arr, 100)).toBe(50);
    expect(percentile(arr, 50)).toBe(30);
  });
});

// ── createScaffold ──

describe('createScaffold', () => {
  test('throws on missing options', () => {
    expect(() => createScaffold()).toThrow('options required');
  });
  test('throws on missing required fields', () => {
    expect(() => createScaffold({ strandDiameter: 200 })).toThrow();
  });
  test('throws on non-positive values', () => {
    expect(() => createScaffold({
      strandDiameter: -1, strandSpacing: 400, layerHeight: 200, numLayers: 10
    })).toThrow('positive number');
  });
  test('throws if diameter >= spacing', () => {
    expect(() => createScaffold({
      strandDiameter: 400, strandSpacing: 400, layerHeight: 200, numLayers: 10
    })).toThrow('less than strandSpacing');
  });
  test('creates valid scaffold with defaults', () => {
    const s = createScaffold({
      strandDiameter: 200, strandSpacing: 400, layerHeight: 200, numLayers: 10
    });
    expect(s.strandDiameter).toBe(200);
    expect(s.angleIncrement).toBe(90);
    expect(s.totalHeight).toBe(2000);
    expect(s.boundingVolume).toBeGreaterThan(0);
  });
  test('respects custom angle increment', () => {
    const s = createScaffold({
      strandDiameter: 200, strandSpacing: 400, layerHeight: 200, numLayers: 10, angleIncrement: 60
    });
    expect(s.angleIncrement).toBe(60);
  });
  test('respects custom scaffold dimensions', () => {
    const s = createScaffold({
      strandDiameter: 200, strandSpacing: 400, layerHeight: 200, numLayers: 10,
      scaffoldWidth: 5000, scaffoldDepth: 3000
    });
    expect(s.scaffoldWidth).toBe(5000);
    expect(s.scaffoldDepth).toBe(3000);
  });
});

// ── calculatePorosity ──

describe('calculatePorosity', () => {
  const scaffold = createScaffold({
    strandDiameter: 200, strandSpacing: 400, layerHeight: 200, numLayers: 10
  });

  test('returns porosity between 0 and 1', () => {
    const result = calculatePorosity(scaffold);
    expect(result.porosity).toBeGreaterThan(0);
    expect(result.porosity).toBeLessThan(1);
  });
  test('porosity percent matches porosity', () => {
    const result = calculatePorosity(scaffold);
    expect(result.porosityPercent).toBeCloseTo(result.porosity * 100, 5);
  });
  test('solid + pore volume equals total', () => {
    const result = calculatePorosity(scaffold);
    expect(result.solidVolume + result.poreVolume).toBeCloseTo(result.totalVolume, 0);
  });
  test('wider spacing gives higher porosity', () => {
    const s1 = createScaffold({ strandDiameter: 200, strandSpacing: 300, layerHeight: 200, numLayers: 10 });
    const s2 = createScaffold({ strandDiameter: 200, strandSpacing: 600, layerHeight: 200, numLayers: 10 });
    expect(calculatePorosity(s2).porosity).toBeGreaterThan(calculatePorosity(s1).porosity);
  });
  test('thicker strands give lower porosity', () => {
    const s1 = createScaffold({ strandDiameter: 150, strandSpacing: 500, layerHeight: 200, numLayers: 10 });
    const s2 = createScaffold({ strandDiameter: 300, strandSpacing: 500, layerHeight: 200, numLayers: 10 });
    expect(calculatePorosity(s1).porosity).toBeGreaterThan(calculatePorosity(s2).porosity);
  });
});

// ── analyzePoreSizes ──

describe('analyzePoreSizes', () => {
  const scaffold = createScaffold({
    strandDiameter: 200, strandSpacing: 500, layerHeight: 250, numLayers: 10
  });
  const analysis = analyzePoreSizes(scaffold);

  test('nominal in-plane pore = spacing - diameter', () => {
    expect(analysis.nominalInPlanePore).toBe(300);
  });
  test('nominal inter-layer pore = layerHeight - diameter', () => {
    expect(analysis.nominalInterLayerPore).toBe(50);
  });
  test('throat size is minimum of pore dimensions', () => {
    expect(analysis.throatSize).toBe(Math.min(300, 50));
  });
  test('distribution has expected fields', () => {
    const d = analysis.distribution;
    expect(d.mean).toBeGreaterThan(0);
    expect(d.stddev).toBeGreaterThan(0);
    expect(d.min).toBeLessThan(d.max);
    expect(d.n).toBeGreaterThan(50);
  });
  test('distribution mean is close to nominal', () => {
    expect(analysis.distribution.mean).toBeCloseTo(300, -1);
  });
  test('histogram has 10 bins', () => {
    expect(analysis.histogram).toHaveLength(10);
  });
  test('histogram frequencies sum to ~1', () => {
    const total = analysis.histogram.reduce((s, b) => s + b.frequency, 0);
    expect(total).toBeCloseTo(1, 1);
  });
  test('uniformity index between 0 and 1', () => {
    expect(analysis.uniformityIndex).toBeGreaterThan(0);
    expect(analysis.uniformityIndex).toBeLessThanOrEqual(1);
  });
  test('inter-layer pore clamped to 0 when compressed', () => {
    const s = createScaffold({ strandDiameter: 300, strandSpacing: 500, layerHeight: 200, numLayers: 5 });
    const a = analyzePoreSizes(s);
    expect(a.nominalInterLayerPore).toBe(0);
  });
});

// ── estimateInterconnectivity ──

describe('estimateInterconnectivity', () => {
  test('returns score between 0 and 1', () => {
    const s = createScaffold({ strandDiameter: 200, strandSpacing: 400, layerHeight: 300, numLayers: 10 });
    const ic = estimateInterconnectivity(s);
    expect(ic.interconnectivity).toBeGreaterThanOrEqual(0);
    expect(ic.interconnectivity).toBeLessThanOrEqual(1);
  });
  test('wider gaps improve interconnectivity', () => {
    const s1 = createScaffold({ strandDiameter: 300, strandSpacing: 400, layerHeight: 300, numLayers: 10 });
    const s2 = createScaffold({ strandDiameter: 100, strandSpacing: 400, layerHeight: 300, numLayers: 10 });
    expect(estimateInterconnectivity(s2).interconnectivity)
      .toBeGreaterThan(estimateInterconnectivity(s1).interconnectivity);
  });
  test('tortuosity >= 1', () => {
    const s = createScaffold({ strandDiameter: 200, strandSpacing: 500, layerHeight: 300, numLayers: 10 });
    expect(estimateInterconnectivity(s).tortuosity).toBeGreaterThanOrEqual(1);
  });
  test('rating is a string', () => {
    const s = createScaffold({ strandDiameter: 200, strandSpacing: 500, layerHeight: 300, numLayers: 10 });
    expect(['excellent', 'good', 'moderate', 'poor']).toContain(estimateInterconnectivity(s).rating);
  });
  test('60-degree angle gives more unique angles', () => {
    const s1 = createScaffold({ strandDiameter: 200, strandSpacing: 400, layerHeight: 300, numLayers: 10, angleIncrement: 90 });
    const s2 = createScaffold({ strandDiameter: 200, strandSpacing: 400, layerHeight: 300, numLayers: 10, angleIncrement: 60 });
    expect(estimateInterconnectivity(s2).uniqueAngles).toBeGreaterThan(estimateInterconnectivity(s1).uniqueAngles);
  });
});

// ── estimatePermeability ──

describe('estimatePermeability', () => {
  const scaffold = createScaffold({ strandDiameter: 200, strandSpacing: 500, layerHeight: 300, numLayers: 10 });
  const porosity = calculatePorosity(scaffold);
  const pores = analyzePoreSizes(scaffold);

  test('returns positive permeability', () => {
    const p = estimatePermeability(porosity, pores);
    expect(p.permeability_m2).toBeGreaterThan(0);
    expect(p.permeability_darcy).toBeGreaterThan(0);
  });
  test('millidarcy = 1000 * darcy', () => {
    const p = estimatePermeability(porosity, pores);
    expect(p.permeability_mdarcy).toBeCloseTo(p.permeability_darcy * 1000, 5);
  });
  test('specific surface is positive', () => {
    const p = estimatePermeability(porosity, pores);
    expect(p.specificSurface).toBeGreaterThan(0);
  });
  test('suitability is a valid rating', () => {
    const p = estimatePermeability(porosity, pores);
    expect(['very low', 'low', 'moderate', 'high']).toContain(p.suitability);
  });
  test('higher porosity gives higher permeability', () => {
    const s1 = createScaffold({ strandDiameter: 300, strandSpacing: 500, layerHeight: 300, numLayers: 10 });
    const s2 = createScaffold({ strandDiameter: 100, strandSpacing: 500, layerHeight: 300, numLayers: 10 });
    const p1 = estimatePermeability(calculatePorosity(s1), analyzePoreSizes(s1));
    const p2 = estimatePermeability(calculatePorosity(s2), analyzePoreSizes(s2));
    expect(p2.permeability_m2).toBeGreaterThan(p1.permeability_m2);
  });
});

// ── scoreTissueSuitability ──

describe('scoreTissueSuitability', () => {
  const scaffold = createScaffold({ strandDiameter: 200, strandSpacing: 500, layerHeight: 300, numLayers: 10 });
  const porosity = calculatePorosity(scaffold);
  const pores = analyzePoreSizes(scaffold);
  const interconn = estimateInterconnectivity(scaffold);

  test('throws on unknown tissue type', () => {
    expect(() => scoreTissueSuitability('brain', porosity, pores, interconn)).toThrow('Unknown tissue type');
  });
  test('returns composite score 0-100', () => {
    const r = scoreTissueSuitability('bone', porosity, pores, interconn);
    expect(r.composite).toBeGreaterThanOrEqual(0);
    expect(r.composite).toBeLessThanOrEqual(100);
  });
  test('includes breakdown scores', () => {
    const r = scoreTissueSuitability('cartilage', porosity, pores, interconn);
    expect(r.scores.porosity).toBeDefined();
    expect(r.scores.poreSize).toBeDefined();
    expect(r.scores.interconnectivity).toBeDefined();
  });
  test('rating is one of expected values', () => {
    const r = scoreTissueSuitability('skin', porosity, pores, interconn);
    expect(['excellent', 'good', 'fair', 'poor']).toContain(r.rating);
  });
  test('provides issues for out-of-range params', () => {
    // Tiny pores for bone
    const s = createScaffold({ strandDiameter: 190, strandSpacing: 200, layerHeight: 200, numLayers: 10 });
    const p = calculatePorosity(s);
    const pa = analyzePoreSizes(s);
    const ic = estimateInterconnectivity(s);
    const r = scoreTissueSuitability('bone', p, pa, ic);
    expect(r.issues.length).toBeGreaterThan(0);
  });
  test('provides suggestions when issues exist', () => {
    const s = createScaffold({ strandDiameter: 190, strandSpacing: 200, layerHeight: 200, numLayers: 10 });
    const p = calculatePorosity(s);
    const pa = analyzePoreSizes(s);
    const ic = estimateInterconnectivity(s);
    const r = scoreTissueSuitability('bone', p, pa, ic);
    expect(r.suggestions.length).toBeGreaterThan(0);
  });
  test('all tissue types can be scored', () => {
    for (const tissue of Object.keys(TISSUE_TARGETS)) {
      const r = scoreTissueSuitability(tissue, porosity, pores, interconn);
      expect(r.tissueType).toBe(tissue);
      expect(r.composite).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── compareAllTissues ──

describe('compareAllTissues', () => {
  const scaffold = createScaffold({ strandDiameter: 200, strandSpacing: 500, layerHeight: 300, numLayers: 10 });
  const porosity = calculatePorosity(scaffold);
  const pores = analyzePoreSizes(scaffold);
  const interconn = estimateInterconnectivity(scaffold);
  const comparison = compareAllTissues(porosity, pores, interconn);

  test('ranks all tissue types', () => {
    expect(comparison.rankings).toHaveLength(Object.keys(TISSUE_TARGETS).length);
  });
  test('sorted by composite descending', () => {
    for (let i = 1; i < comparison.rankings.length; i++) {
      expect(comparison.rankings[i - 1].composite).toBeGreaterThanOrEqual(comparison.rankings[i].composite);
    }
  });
  test('bestMatch is first', () => {
    expect(comparison.bestMatch).toBe(comparison.rankings[0]);
  });
  test('worstMatch is last', () => {
    expect(comparison.worstMatch).toBe(comparison.rankings[comparison.rankings.length - 1]);
  });
});

// ── analyzeScaffold ──

describe('analyzeScaffold', () => {
  test('full analysis without target tissue', () => {
    const report = analyzeScaffold({
      strandDiameter: 200, strandSpacing: 500, layerHeight: 300, numLayers: 10
    });
    expect(report.scaffold).toBeDefined();
    expect(report.porosity).toBeDefined();
    expect(report.poreAnalysis).toBeDefined();
    expect(report.interconnectivity).toBeDefined();
    expect(report.permeability).toBeDefined();
    expect(report.tissueComparison).toBeDefined();
    expect(report.tissueSuitability).toBeUndefined();
  });
  test('full analysis with target tissue', () => {
    const report = analyzeScaffold({
      strandDiameter: 200, strandSpacing: 500, layerHeight: 300, numLayers: 10
    }, 'bone');
    expect(report.tissueSuitability).toBeDefined();
    expect(report.tissueSuitability.tissueType).toBe('bone');
    expect(report.tissueComparison).toBeUndefined();
  });
});

// ── suggestParameters ──

describe('suggestParameters', () => {
  test('throws on unknown tissue', () => {
    expect(() => suggestParameters('brain')).toThrow('Unknown tissue type');
  });
  test('returns suggested parameters for bone', () => {
    const result = suggestParameters('bone');
    expect(result.suggestedParameters).toBeDefined();
    expect(result.suggestedParameters.strandDiameter).toBeGreaterThan(0);
    expect(result.expectedMetrics).toBeDefined();
    expect(result.expectedMetrics.suitabilityScore).toBeGreaterThan(0);
  });
  test('suggested params for cartilage give good rating', () => {
    const result = suggestParameters('cartilage');
    expect(['excellent', 'good']).toContain(result.expectedMetrics.rating);
  });
  test('respects constraints', () => {
    const result = suggestParameters('skin', {
      minStrandDiameter: 150, maxStrandDiameter: 250
    });
    expect(result.suggestedParameters.strandDiameter).toBeGreaterThanOrEqual(150);
    expect(result.suggestedParameters.strandDiameter).toBeLessThanOrEqual(250);
  });
  test('works for all tissue types', () => {
    for (const tissue of Object.keys(TISSUE_TARGETS)) {
      const result = suggestParameters(tissue);
      expect(result.tissueType).toBe(tissue);
      expect(result.suggestedParameters).toBeDefined();
    }
  });
});

// ── TISSUE_TARGETS ──

describe('TISSUE_TARGETS', () => {
  test('has 6 tissue types', () => {
    expect(Object.keys(TISSUE_TARGETS)).toHaveLength(6);
  });
  test('each target has required fields', () => {
    for (const [key, t] of Object.entries(TISSUE_TARGETS)) {
      expect(t.label).toBeDefined();
      expect(t.minPoreSize).toBeLessThan(t.maxPoreSize);
      expect(t.idealPoreSize).toBeGreaterThanOrEqual(t.minPoreSize);
      expect(t.idealPoreSize).toBeLessThanOrEqual(t.maxPoreSize);
      expect(t.minPorosity).toBeLessThan(t.maxPorosity);
      expect(t.minInterconnectivity).toBeGreaterThan(0);
      expect(t.minInterconnectivity).toBeLessThanOrEqual(1);
    }
  });
});

// ── Edge cases ──

describe('Edge cases', () => {
  test('single layer scaffold', () => {
    const s = createScaffold({ strandDiameter: 200, strandSpacing: 400, layerHeight: 200, numLayers: 1 });
    const p = calculatePorosity(s);
    expect(p.porosity).toBeGreaterThan(0);
  });
  test('very thin strands give high porosity', () => {
    const s = createScaffold({ strandDiameter: 50, strandSpacing: 1000, layerHeight: 500, numLayers: 10 });
    const p = calculatePorosity(s);
    expect(p.porosityPercent).toBeGreaterThan(90);
  });
  test('angled scaffold (45 degrees)', () => {
    const s = createScaffold({ strandDiameter: 200, strandSpacing: 400, layerHeight: 200, numLayers: 10, angleIncrement: 45 });
    const p = calculatePorosity(s);
    expect(p.porosity).toBeGreaterThan(0);
    expect(p.porosity).toBeLessThan(1);
  });
  test('permeability throws on invalid porosity', () => {
    expect(() => estimatePermeability(
      { porosity: 0 },
      { nominalInPlanePore: 100 }
    )).toThrow('between 0 and 1');
  });
});
