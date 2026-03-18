'use strict';

const {
  filterAndScore,
  computeRecipe,
  formatRecipeText,
  buildHistogram,
  PRESETS
} = require('../docs/shared/recipeBuilder');

// ── Test data fixtures ──────────────────────────────────────────

function makeRun(overrides) {
  const defaults = {
    print_data: {
      livePercent: 85,
      deadPercent: 15,
      elasticity: 60
    },
    print_info: {
      crosslinking: { cl_enabled: true, cl_duration: 30, cl_intensity: 50 },
      pressure: { extruder1: 20, extruder2: 15 },
      resolution: { layerHeight: 0.4, layerNum: 10 },
      wellplate: 6
    }
  };

  const run = JSON.parse(JSON.stringify(defaults));
  if (overrides) {
    if (overrides.print_data) Object.assign(run.print_data, overrides.print_data);
    if (overrides.print_info) {
      if (overrides.print_info.crosslinking)
        Object.assign(run.print_info.crosslinking, overrides.print_info.crosslinking);
      if (overrides.print_info.pressure)
        Object.assign(run.print_info.pressure, overrides.print_info.pressure);
      if (overrides.print_info.resolution)
        Object.assign(run.print_info.resolution, overrides.print_info.resolution);
      if (overrides.print_info.wellplate !== undefined)
        run.print_info.wellplate = overrides.print_info.wellplate;
    }
  }
  return run;
}

const sampleRuns = [
  makeRun(), // high viability, good elasticity
  makeRun({ print_data: { livePercent: 40, deadPercent: 60, elasticity: 20 } }), // low quality
  makeRun({ print_data: { livePercent: 95, deadPercent: 5, elasticity: 80 }, print_info: { resolution: { layerHeight: 0.2 } } }), // excellent
  makeRun({ print_info: { crosslinking: { cl_enabled: false } } }), // no crosslinking
  makeRun({ print_data: { livePercent: 70, elasticity: 55 }, print_info: { wellplate: 24 } }), // different wellplate
];

// ── filterAndScore ──────────────────────────────────────────────

describe('filterAndScore', () => {
  test('returns all runs with relaxed targets', () => {
    const matches = filterAndScore(sampleRuns, {
      minViability: 0,
      maxDead: 100,
      minElasticity: 0,
      maxLayerHeight: 2,
      tolerance: 0.5
    });
    expect(matches.length).toBe(sampleRuns.length);
  });

  test('filters by minimum viability', () => {
    const matches = filterAndScore(sampleRuns, {
      minViability: 80,
      maxDead: 100,
      minElasticity: 0,
      maxLayerHeight: 2,
      tolerance: 0
    });
    // Runs with livePercent >= 80: runs 0, 2, 3 (all have 85+ viability)
    expect(matches.length).toBe(3);
    matches.forEach(m => {
      expect(m.record.print_data.livePercent).toBeGreaterThanOrEqual(80);
    });
  });

  test('filters by maximum dead percent', () => {
    const matches = filterAndScore(sampleRuns, {
      minViability: 0,
      maxDead: 20,
      minElasticity: 0,
      maxLayerHeight: 2,
      tolerance: 0
    });
    matches.forEach(m => {
      expect(m.record.print_data.deadPercent).toBeLessThanOrEqual(20);
    });
  });

  test('filters by crosslinking enabled', () => {
    const matches = filterAndScore(sampleRuns, {
      minViability: 0,
      maxDead: 100,
      minElasticity: 0,
      maxLayerHeight: 2,
      crosslinking: 'yes',
      tolerance: 0.5
    });
    matches.forEach(m => {
      expect(m.record.print_info.crosslinking.cl_enabled).toBe(true);
    });
  });

  test('filters by crosslinking disabled', () => {
    const matches = filterAndScore(sampleRuns, {
      minViability: 0,
      maxDead: 100,
      minElasticity: 0,
      maxLayerHeight: 2,
      crosslinking: 'no',
      tolerance: 0.5
    });
    matches.forEach(m => {
      expect(m.record.print_info.crosslinking.cl_enabled).toBe(false);
    });
  });

  test('filters by wellplate', () => {
    const matches = filterAndScore(sampleRuns, {
      minViability: 0,
      maxDead: 100,
      minElasticity: 0,
      maxLayerHeight: 2,
      wellplate: '24',
      tolerance: 0.5
    });
    expect(matches.length).toBe(1);
    expect(matches[0].record.print_info.wellplate).toBe(24);
  });

  test('results are sorted by score descending', () => {
    const matches = filterAndScore(sampleRuns, {
      minViability: 0,
      maxDead: 100,
      minElasticity: 0,
      maxLayerHeight: 2,
      tolerance: 0.5
    });
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });

  test('score is between 0 and 1', () => {
    const matches = filterAndScore(sampleRuns, {
      minViability: 0,
      maxDead: 100,
      minElasticity: 0,
      maxLayerHeight: 2,
      tolerance: 0.5
    });
    matches.forEach(m => {
      expect(m.score).toBeGreaterThan(0);
      expect(m.score).toBeLessThanOrEqual(1);
    });
  });

  test('tolerance relaxes the filter boundaries', () => {
    const strict = filterAndScore(sampleRuns, {
      minViability: 80,
      maxDead: 20,
      minElasticity: 50,
      maxLayerHeight: 0.5,
      tolerance: 0
    });
    const relaxed = filterAndScore(sampleRuns, {
      minViability: 80,
      maxDead: 20,
      minElasticity: 50,
      maxLayerHeight: 0.5,
      tolerance: 0.25
    });
    expect(relaxed.length).toBeGreaterThanOrEqual(strict.length);
  });

  test('handles empty data array', () => {
    const matches = filterAndScore([], { minViability: 0 });
    expect(matches).toEqual([]);
  });

  test('skips malformed records gracefully', () => {
    const data = [null, {}, { print_data: {} }, makeRun()];
    const matches = filterAndScore(data, {
      minViability: 0,
      maxDead: 100,
      minElasticity: 0,
      maxLayerHeight: 2,
      tolerance: 0.5
    });
    expect(matches.length).toBe(1);
  });

  test('uses default tolerance when not specified', () => {
    const matches = filterAndScore(sampleRuns, {
      minViability: 80,
      maxDead: 20,
      minElasticity: 50,
      maxLayerHeight: 0.5
    });
    // Should use default tolerance of 0.10
    expect(Array.isArray(matches)).toBe(true);
  });
});

// ── computeRecipe ───────────────────────────────────────────────

describe('computeRecipe', () => {
  const matches = filterAndScore(sampleRuns, {
    minViability: 0,
    maxDead: 100,
    minElasticity: 0,
    maxLayerHeight: 2,
    tolerance: 0.5
  });

  test('returns all expected fields', () => {
    const recipe = computeRecipe(matches);
    const expectedFields = [
      'pressure1', 'pressure2', 'clDuration', 'clIntensity',
      'layerHeight', 'layerNum', 'viability', 'elasticity', 'deadPercent'
    ];
    expectedFields.forEach(f => {
      expect(recipe).toHaveProperty(f);
    });
  });

  test('each field has statistical properties', () => {
    const recipe = computeRecipe(matches);
    Object.values(recipe).forEach(stats => {
      expect(stats).toHaveProperty('median');
      expect(stats).toHaveProperty('q1');
      expect(stats).toHaveProperty('q3');
      expect(stats).toHaveProperty('min');
      expect(stats).toHaveProperty('max');
      expect(stats).toHaveProperty('mean');
      expect(stats).toHaveProperty('values');
      expect(stats.min).toBeLessThanOrEqual(stats.max);
      expect(stats.q1).toBeLessThanOrEqual(stats.q3);
    });
  });

  test('values array length matches input length', () => {
    const recipe = computeRecipe(matches);
    Object.values(recipe).forEach(stats => {
      expect(stats.values.length).toBe(matches.length);
    });
  });
});

// ── formatRecipeText ────────────────────────────────────────────

describe('formatRecipeText', () => {
  test('returns a non-empty string', () => {
    const matches = filterAndScore(sampleRuns, { minViability: 0, maxDead: 100, minElasticity: 0, maxLayerHeight: 2, tolerance: 0.5 });
    const recipe = computeRecipe(matches);
    const text = formatRecipeText(recipe, matches.length);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  test('includes header and match count', () => {
    const matches = filterAndScore(sampleRuns, { minViability: 0, maxDead: 100, minElasticity: 0, maxLayerHeight: 2, tolerance: 0.5 });
    const recipe = computeRecipe(matches);
    const text = formatRecipeText(recipe, matches.length);
    expect(text).toContain('Bioprint Recipe');
    expect(text).toContain(`Matching runs: ${matches.length}`);
  });

  test('includes IQR for each parameter', () => {
    const matches = filterAndScore(sampleRuns, { minViability: 0, maxDead: 100, minElasticity: 0, maxLayerHeight: 2, tolerance: 0.5 });
    const recipe = computeRecipe(matches);
    const text = formatRecipeText(recipe, matches.length);
    expect(text).toContain('IQR:');
  });
});

// ── buildHistogram ──────────────────────────────────────────────

describe('buildHistogram', () => {
  test('returns correct number of bins', () => {
    const bins = buildHistogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(bins.length).toBe(5);
  });

  test('total count equals input length', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const bins = buildHistogram(values, 4);
    const total = bins.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(values.length);
  });

  test('bins have lo, hi, count properties', () => {
    const bins = buildHistogram([10, 20, 30], 3);
    bins.forEach(b => {
      expect(b).toHaveProperty('lo');
      expect(b).toHaveProperty('hi');
      expect(b).toHaveProperty('count');
      expect(typeof b.lo).toBe('number');
    });
  });

  test('returns empty array for empty input', () => {
    expect(buildHistogram([], 5)).toEqual([]);
  });

  test('handles single value', () => {
    const bins = buildHistogram([42], 3);
    expect(bins.length).toBe(3);
    const total = bins.reduce((sum, b) => sum + b.count, 0);
    expect(total).toBe(1);
  });
});

// ── PRESETS ─────────────────────────────────────────────────────

describe('PRESETS', () => {
  test('all presets have required target fields', () => {
    Object.entries(PRESETS).forEach(([name, preset]) => {
      expect(preset).toHaveProperty('minViability');
      expect(preset).toHaveProperty('maxDead');
      expect(preset).toHaveProperty('minElasticity');
      expect(preset).toHaveProperty('maxLayerHeight');
      expect(preset).toHaveProperty('tolerance');
    });
  });

  test('all presets produce valid results with sample data', () => {
    Object.entries(PRESETS).forEach(([name, preset]) => {
      const matches = filterAndScore(sampleRuns, preset);
      expect(Array.isArray(matches)).toBe(true);
    });
  });

  test('high-viability preset filters for high livePercent', () => {
    const matches = filterAndScore(sampleRuns, PRESETS['high-viability']);
    matches.forEach(m => {
      // With tolerance 0.10, minViability 80 means livePercent >= 72
      expect(m.record.print_data.livePercent).toBeGreaterThanOrEqual(72);
    });
  });
});

// ── Integration: end-to-end recipe workflow ─────────────────────

describe('end-to-end recipe workflow', () => {
  test('filter → compute → format produces valid output', () => {
    const matches = filterAndScore(sampleRuns, PRESETS['balanced']);
    if (matches.length > 0) {
      const recipe = computeRecipe(matches);
      const text = formatRecipeText(recipe, matches.length);
      expect(text).toContain('Bioprint Recipe');
      expect(recipe.viability.mean).toBeGreaterThan(0);
    }
  });
});
