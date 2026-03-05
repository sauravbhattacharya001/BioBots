/**
 * Print Parameter Optimizer
 *
 * Finds optimal bioprinting parameter combinations (speed, pressure,
 * temperature, nozzle diameter, layer height, infill) to maximize a
 * composite objective balancing cell viability, structural integrity,
 * resolution, and throughput.
 *
 * Features:
 * - Multi-objective optimization via weighted scoring
 * - Grid search with configurable resolution
 * - Parameter constraint validation
 * - Sensitivity analysis (one-at-a-time perturbation)
 * - Pareto front extraction for multi-objective trade-offs
 * - Preset parameter profiles for common bioinks
 * - Optimization history with comparison
 * - Text report generation
 */

'use strict';

// ── Parameter definitions with physical bounds ──────────────────────

const PARAMETER_DEFS = {
  speed:        { min: 1,   max: 50,  unit: 'mm/s',  label: 'Print Speed' },
  pressure:     { min: 5,   max: 300, unit: 'kPa',   label: 'Extrusion Pressure' },
  temperature:  { min: 4,   max: 42,  unit: '°C',    label: 'Temperature' },
  nozzleDiameter: { min: 0.1, max: 1.5, unit: 'mm', label: 'Nozzle Diameter' },
  layerHeight:  { min: 0.05, max: 1.0, unit: 'mm',  label: 'Layer Height' },
  infill:       { min: 10,  max: 100, unit: '%',     label: 'Infill Density' },
};

// ── Bioink presets ──────────────────────────────────────────────────

const BIOINK_PRESETS = {
  gelatin_methacrylate: {
    name: 'GelMA',
    constraints: { temperature: { min: 20, max: 37 }, pressure: { min: 20, max: 150 } },
    weights: { viability: 0.35, structural: 0.25, resolution: 0.25, throughput: 0.15 },
    idealRanges: { speed: [5, 15], pressure: [30, 80], temperature: [25, 32] },
  },
  alginate: {
    name: 'Alginate',
    constraints: { temperature: { min: 15, max: 37 }, pressure: { min: 10, max: 120 } },
    weights: { viability: 0.30, structural: 0.30, resolution: 0.20, throughput: 0.20 },
    idealRanges: { speed: [5, 20], pressure: [20, 60], temperature: [20, 30] },
  },
  collagen: {
    name: 'Collagen',
    constraints: { temperature: { min: 4, max: 25 }, pressure: { min: 5, max: 80 } },
    weights: { viability: 0.40, structural: 0.20, resolution: 0.25, throughput: 0.15 },
    idealRanges: { speed: [2, 10], pressure: [10, 50], temperature: [4, 15] },
  },
  hyaluronic_acid: {
    name: 'Hyaluronic Acid',
    constraints: { temperature: { min: 18, max: 37 }, pressure: { min: 15, max: 100 } },
    weights: { viability: 0.35, structural: 0.20, resolution: 0.30, throughput: 0.15 },
    idealRanges: { speed: [3, 12], pressure: [20, 70], temperature: [20, 30] },
  },
  pluronic: {
    name: 'Pluronic F-127',
    constraints: { temperature: { min: 20, max: 40 }, pressure: { min: 30, max: 200 } },
    weights: { viability: 0.25, structural: 0.30, resolution: 0.25, throughput: 0.20 },
    idealRanges: { speed: [8, 25], pressure: [50, 150], temperature: [25, 37] },
  },
  silk_fibroin: {
    name: 'Silk Fibroin',
    constraints: { temperature: { min: 15, max: 37 }, pressure: { min: 20, max: 150 } },
    weights: { viability: 0.30, structural: 0.35, resolution: 0.20, throughput: 0.15 },
    idealRanges: { speed: [3, 12], pressure: [30, 100], temperature: [20, 30] },
  },
};

// ── Objective functions ─────────────────────────────────────────────

/**
 * Cell viability score (0-1). Lower shear (speed*pressure/nozzle) and
 * mid-range temperature are better.
 */
function viabilityScore(params) {
  // Shear stress proxy: speed * pressure / (nozzle^3)
  const shear = (params.speed * params.pressure) / Math.pow(params.nozzleDiameter * 1000, 3) * 1e6;
  const shearScore = Math.exp(-shear / 500);

  // Temperature: bell curve centered at 37°C, σ = 8
  const tempScore = Math.exp(-Math.pow(params.temperature - 37, 2) / (2 * 64));

  // Pressure penalty: high pressure damages cells
  const pressureScore = 1 - Math.pow(params.pressure / 300, 2);

  return clamp(0.4 * shearScore + 0.35 * tempScore + 0.25 * Math.max(0, pressureScore));
}

/**
 * Structural integrity score (0-1). Higher infill, appropriate layer
 * height relative to nozzle, and moderate speed improve structure.
 */
function structuralScore(params) {
  // Infill contribution
  const infillScore = params.infill / 100;

  // Layer height should be 50-80% of nozzle diameter
  const ratio = params.layerHeight / params.nozzleDiameter;
  const ratioScore = ratio >= 0.5 && ratio <= 0.8 ? 1.0 :
    ratio < 0.5 ? ratio / 0.5 :
    Math.max(0, 1 - (ratio - 0.8) / 0.5);

  // Speed: slower is more structurally sound
  const speedScore = Math.exp(-params.speed / 30);

  // Pressure: enough to extrude properly
  const pressureScore = 1 - Math.exp(-params.pressure / 40);

  return clamp(0.3 * infillScore + 0.3 * ratioScore + 0.2 * speedScore + 0.2 * pressureScore);
}

/**
 * Resolution score (0-1). Smaller nozzle and layer height = higher resolution.
 */
function resolutionScore(params) {
  // Nozzle: smaller is higher resolution
  const nozzleScore = 1 - (params.nozzleDiameter - 0.1) / 1.4;

  // Layer height: thinner layers
  const layerScore = 1 - (params.layerHeight - 0.05) / 0.95;

  // Speed: slower = more precise deposition
  const speedScore = Math.exp(-params.speed / 20);

  return clamp(0.4 * nozzleScore + 0.35 * layerScore + 0.25 * speedScore);
}

/**
 * Throughput score (0-1). Faster speed, larger nozzle, thicker layers = more throughput.
 */
function throughputScore(params) {
  const speedScore = (params.speed - 1) / 49;
  const nozzleScore = (params.nozzleDiameter - 0.1) / 1.4;
  const layerScore = (params.layerHeight - 0.05) / 0.95;

  return clamp(0.5 * speedScore + 0.25 * nozzleScore + 0.25 * layerScore);
}

function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

// ── Core optimizer ──────────────────────────────────────────────────

const DEFAULT_WEIGHTS = { viability: 0.30, structural: 0.25, resolution: 0.25, throughput: 0.20 };

function createParameterOptimizer(config = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(config.weights || {}) };
  const constraints = {};
  // Merge default bounds with any user/bioink constraints
  for (const [k, def] of Object.entries(PARAMETER_DEFS)) {
    constraints[k] = {
      min: (config.constraints && config.constraints[k] && config.constraints[k].min != null)
        ? Math.max(def.min, config.constraints[k].min) : def.min,
      max: (config.constraints && config.constraints[k] && config.constraints[k].max != null)
        ? Math.min(def.max, config.constraints[k].max) : def.max,
    };
  }
  const history = [];

  /**
   * Evaluate a single parameter set, returning all sub-scores and composite.
   */
  function evaluate(params) {
    _validateParams(params);
    const scores = {
      viability: viabilityScore(params),
      structural: structuralScore(params),
      resolution: resolutionScore(params),
      throughput: throughputScore(params),
    };
    scores.composite = weights.viability * scores.viability +
      weights.structural * scores.structural +
      weights.resolution * scores.resolution +
      weights.throughput * scores.throughput;
    return { params: { ...params }, scores };
  }

  /**
   * Grid search over parameter space.
   * @param {object} options - { steps: number (per param, default 5), fixedParams: {} }
   */
  function gridSearch(options = {}) {
    const steps = options.steps || 5;
    const fixed = options.fixedParams || {};
    const freeParams = Object.keys(PARAMETER_DEFS).filter(k => !(k in fixed));

    // Build value arrays for free params
    const axes = {};
    for (const k of freeParams) {
      const c = constraints[k];
      axes[k] = [];
      for (let i = 0; i < steps; i++) {
        axes[k].push(c.min + (c.max - c.min) * i / (steps - 1));
      }
    }

    const results = [];
    const combo = { ...fixed };

    function recurse(idx) {
      if (idx >= freeParams.length) {
        results.push(evaluate({ ...combo }));
        return;
      }
      const key = freeParams[idx];
      for (const val of axes[key]) {
        combo[key] = val;
        recurse(idx + 1);
      }
    }
    recurse(0);

    results.sort((a, b) => b.scores.composite - a.scores.composite);

    const record = {
      timestamp: Date.now(),
      method: 'gridSearch',
      steps,
      fixedParams: { ...fixed },
      totalEvaluated: results.length,
      best: results[0] || null,
      top5: results.slice(0, 5),
    };
    history.push(record);
    return record;
  }

  /**
   * Sensitivity analysis: perturb each parameter ±delta% from a base point.
   */
  function sensitivityAnalysis(baseParams, options = {}) {
    const delta = options.delta || 0.1; // 10%
    const numSteps = options.steps || 11;
    _validateParams(baseParams);
    const baseEval = evaluate(baseParams);
    const results = {};

    for (const key of Object.keys(PARAMETER_DEFS)) {
      const c = constraints[key];
      const baseVal = baseParams[key];
      const lo = Math.max(c.min, baseVal * (1 - delta));
      const hi = Math.min(c.max, baseVal * (1 + delta));
      const sweepResults = [];

      for (let i = 0; i < numSteps; i++) {
        const val = lo + (hi - lo) * i / (numSteps - 1);
        const testParams = { ...baseParams, [key]: val };
        const ev = evaluate(testParams);
        sweepResults.push({
          value: val,
          composite: ev.scores.composite,
          delta: ev.scores.composite - baseEval.scores.composite,
        });
      }

      // Sensitivity = max range of composite over sweep
      const composites = sweepResults.map(r => r.composite);
      const range = Math.max(...composites) - Math.min(...composites);

      results[key] = {
        label: PARAMETER_DEFS[key].label,
        unit: PARAMETER_DEFS[key].unit,
        baseValue: baseVal,
        sweep: sweepResults,
        range,
        peakValue: sweepResults.reduce((best, r) => r.composite > best.composite ? r : best).value,
      };
    }

    // Rank by sensitivity
    const ranking = Object.entries(results)
      .sort((a, b) => b[1].range - a[1].range)
      .map(([key, data], i) => ({ rank: i + 1, parameter: key, ...data }));

    return { baseParams: { ...baseParams }, baseScore: baseEval.scores.composite, delta, ranking, details: results };
  }

  /**
   * Extract Pareto front from a set of evaluated results for two objectives.
   */
  function paretoFront(evaluatedResults, objective1 = 'viability', objective2 = 'throughput') {
    const points = evaluatedResults.map(r => ({
      params: r.params,
      scores: r.scores,
      obj1: r.scores[objective1],
      obj2: r.scores[objective2],
    }));

    // Sort by obj1 descending
    points.sort((a, b) => b.obj1 - a.obj1);

    const front = [];
    let bestObj2 = -Infinity;
    for (const p of points) {
      if (p.obj2 > bestObj2) {
        front.push(p);
        bestObj2 = p.obj2;
      }
    }

    return {
      objective1,
      objective2,
      totalPoints: evaluatedResults.length,
      frontSize: front.length,
      front,
    };
  }

  /**
   * Run full optimization: grid search + sensitivity + Pareto.
   */
  function fullOptimize(options = {}) {
    const steps = options.steps || 5;
    const fixed = options.fixedParams || {};

    const search = gridSearch({ steps, fixedParams: fixed });
    const best = search.best;
    if (!best) return { search, sensitivity: null, pareto: null };

    const sensitivity = sensitivityAnalysis(best.params, { delta: options.delta || 0.1 });

    // Rebuild evaluations for Pareto (use top results to keep it manageable)
    const topN = search.totalEvaluated > 200 ? 200 : search.totalEvaluated;
    // Re-run grid to get full results for Pareto
    const allResults = [];
    const freeParams = Object.keys(PARAMETER_DEFS).filter(k => !(k in fixed));
    const axes = {};
    for (const k of freeParams) {
      const c = constraints[k];
      axes[k] = [];
      for (let i = 0; i < steps; i++) {
        axes[k].push(c.min + (c.max - c.min) * i / (steps - 1));
      }
    }
    const combo = { ...fixed };
    function recurse(idx) {
      if (idx >= freeParams.length) {
        allResults.push(evaluate({ ...combo }));
        return;
      }
      const key = freeParams[idx];
      for (const val of axes[key]) {
        combo[key] = val;
        recurse(idx + 1);
      }
    }
    recurse(0);

    const pareto = paretoFront(allResults, options.paretoObj1 || 'viability', options.paretoObj2 || 'throughput');

    return { search, sensitivity, pareto };
  }

  /**
   * Get optimization presets for a bioink type.
   */
  function getPreset(bioinkKey) {
    const preset = BIOINK_PRESETS[bioinkKey];
    if (!preset) throw new Error(`Unknown bioink: ${bioinkKey}. Available: ${Object.keys(BIOINK_PRESETS).join(', ')}`);
    return { ...preset };
  }

  /**
   * Create optimizer pre-configured for a specific bioink.
   */
  function forBioink(bioinkKey) {
    const preset = BIOINK_PRESETS[bioinkKey];
    if (!preset) throw new Error(`Unknown bioink: ${bioinkKey}`);
    return createParameterOptimizer({
      weights: preset.weights,
      constraints: preset.constraints,
    });
  }

  /**
   * Compare two parameter sets side by side.
   */
  function compare(paramsA, paramsB) {
    const evalA = evaluate(paramsA);
    const evalB = evaluate(paramsB);
    const diff = {};
    for (const key of Object.keys(PARAMETER_DEFS)) {
      diff[key] = {
        a: paramsA[key],
        b: paramsB[key],
        delta: paramsB[key] - paramsA[key],
        unit: PARAMETER_DEFS[key].unit,
      };
    }
    const scoreDiff = {};
    for (const key of Object.keys(evalA.scores)) {
      scoreDiff[key] = {
        a: evalA.scores[key],
        b: evalB.scores[key],
        delta: evalB.scores[key] - evalA.scores[key],
      };
    }
    return { a: evalA, b: evalB, paramDiff: diff, scoreDiff };
  }

  /**
   * Generate text report from a full optimization result.
   */
  function textReport(result) {
    const lines = [];
    lines.push('═══════════════════════════════════════════════');
    lines.push('     PRINT PARAMETER OPTIMIZATION REPORT');
    lines.push('═══════════════════════════════════════════════');
    lines.push('');

    if (result.search && result.search.best) {
      const best = result.search.best;
      lines.push(`Grid Search: ${result.search.totalEvaluated} combinations evaluated`);
      lines.push('');
      lines.push('OPTIMAL PARAMETERS:');
      for (const [k, def] of Object.entries(PARAMETER_DEFS)) {
        const val = best.params[k];
        lines.push(`  ${def.label.padEnd(20)} ${val.toFixed(2)} ${def.unit}`);
      }
      lines.push('');
      lines.push('SCORES:');
      lines.push(`  Cell Viability:     ${(best.scores.viability * 100).toFixed(1)}%`);
      lines.push(`  Structural:         ${(best.scores.structural * 100).toFixed(1)}%`);
      lines.push(`  Resolution:         ${(best.scores.resolution * 100).toFixed(1)}%`);
      lines.push(`  Throughput:         ${(best.scores.throughput * 100).toFixed(1)}%`);
      lines.push(`  ─────────────────────────────────`);
      lines.push(`  COMPOSITE:          ${(best.scores.composite * 100).toFixed(1)}%`);
    }

    if (result.sensitivity) {
      lines.push('');
      lines.push('SENSITIVITY RANKING:');
      for (const r of result.sensitivity.ranking) {
        const bar = '█'.repeat(Math.round(r.range * 50));
        lines.push(`  ${r.rank}. ${r.label.padEnd(20)} ${bar} (range: ${(r.range * 100).toFixed(1)}%)`);
      }
    }

    if (result.pareto) {
      lines.push('');
      lines.push(`PARETO FRONT (${result.pareto.objective1} vs ${result.pareto.objective2}):`);
      lines.push(`  ${result.pareto.frontSize} non-dominated solutions from ${result.pareto.totalPoints} candidates`);
      const top3 = result.pareto.front.slice(0, 3);
      for (let i = 0; i < top3.length; i++) {
        const p = top3[i];
        lines.push(`  ${i + 1}. ${result.pareto.objective1}=${(p.obj1 * 100).toFixed(1)}% | ${result.pareto.objective2}=${(p.obj2 * 100).toFixed(1)}%`);
      }
    }

    lines.push('');
    lines.push('═══════════════════════════════════════════════');
    return lines.join('\n');
  }

  function getHistory() { return [...history]; }
  function getWeights() { return { ...weights }; }
  function getConstraints() { return JSON.parse(JSON.stringify(constraints)); }

  function _validateParams(params) {
    for (const key of Object.keys(PARAMETER_DEFS)) {
      if (params[key] == null) throw new Error(`Missing parameter: ${key}`);
      if (typeof params[key] !== 'number' || isNaN(params[key])) throw new Error(`Invalid ${key}: must be a number`);
      const c = constraints[key];
      if (params[key] < c.min || params[key] > c.max) {
        throw new Error(`${key} out of range: ${params[key]} (allowed: ${c.min}-${c.max})`);
      }
    }
  }

  return {
    evaluate,
    gridSearch,
    sensitivityAnalysis,
    paretoFront,
    fullOptimize,
    getPreset,
    forBioink,
    compare,
    textReport,
    getHistory,
    getWeights,
    getConstraints,
  };
}

// ── Exports ─────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createParameterOptimizer,
    PARAMETER_DEFS,
    BIOINK_PRESETS,
    viabilityScore,
    structuralScore,
    resolutionScore,
    throughputScore,
  };
}
