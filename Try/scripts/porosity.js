'use strict';

/**
 * Scaffold Porosity Analyzer
 * 
 * Models and analyzes pore structure in bioprinted scaffolds for tissue engineering.
 * Computes porosity metrics, pore size distributions, interconnectivity,
 * permeability estimates, and scaffold suitability for different tissue types.
 */

const { clamp, mean, stddev, median, percentile } = require('./scriptUtils');

// ── Tissue type target parameters (pore size in µm, porosity in %) ──

const TISSUE_TARGETS = {
  bone: {
    label: 'Bone',
    minPoreSize: 100,
    maxPoreSize: 500,
    idealPoreSize: 300,
    minPorosity: 50,
    maxPorosity: 90,
    idealPorosity: 70,
    minInterconnectivity: 0.6,
    notes: 'Requires large interconnected pores for vascularization and osteogenesis'
  },
  cartilage: {
    label: 'Cartilage',
    minPoreSize: 50,
    maxPoreSize: 300,
    idealPoreSize: 150,
    minPorosity: 60,
    maxPorosity: 90,
    idealPorosity: 80,
    minInterconnectivity: 0.5,
    notes: 'Moderate pores for chondrocyte proliferation'
  },
  skin: {
    label: 'Skin',
    minPoreSize: 20,
    maxPoreSize: 200,
    idealPoreSize: 100,
    minPorosity: 60,
    maxPorosity: 95,
    idealPorosity: 80,
    minInterconnectivity: 0.7,
    notes: 'High porosity and interconnectivity for nutrient transport'
  },
  nerve: {
    label: 'Nerve',
    minPoreSize: 10,
    maxPoreSize: 100,
    idealPoreSize: 50,
    minPorosity: 40,
    maxPorosity: 80,
    idealPorosity: 60,
    minInterconnectivity: 0.8,
    notes: 'Aligned microchannels for axonal guidance'
  },
  vascular: {
    label: 'Vascular',
    minPoreSize: 5,
    maxPoreSize: 150,
    idealPoreSize: 50,
    minPorosity: 50,
    maxPorosity: 85,
    idealPorosity: 70,
    minInterconnectivity: 0.9,
    notes: 'Highly interconnected network for endothelial cell migration'
  },
  liver: {
    label: 'Liver',
    minPoreSize: 50,
    maxPoreSize: 200,
    idealPoreSize: 100,
    minPorosity: 70,
    maxPorosity: 95,
    idealPorosity: 85,
    minInterconnectivity: 0.7,
    notes: 'High porosity for hepatocyte clusters and bile duct formation'
  }
};

// ── Scaffold definition ──

/**
 * Create a scaffold definition from layer-by-layer strand measurements.
 * @param {Object} opts
 * @param {number} opts.strandDiameter - Strand/filament diameter in µm
 * @param {number} opts.strandSpacing - Center-to-center strand spacing in µm
 * @param {number} opts.layerHeight - Layer height in µm
 * @param {number} opts.numLayers - Number of printed layers
 * @param {number} [opts.angleIncrement=90] - Rotation angle between layers in degrees
 * @param {number} [opts.scaffoldWidth] - Total scaffold width in µm (default: 10 strands)
 * @param {number} [opts.scaffoldDepth] - Total scaffold depth in µm (default: 10 strands)
 * @returns {Object} Scaffold definition
 */
function createScaffold(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('Scaffold options required');
  }
  const required = ['strandDiameter', 'strandSpacing', 'layerHeight', 'numLayers'];
  for (const key of required) {
    if (typeof opts[key] !== 'number' || !isFinite(opts[key]) || opts[key] <= 0) {
      throw new Error(`${key} must be a positive number`);
    }
  }
  if (opts.strandDiameter >= opts.strandSpacing) {
    throw new Error('strandDiameter must be less than strandSpacing');
  }

  const angleIncrement = opts.angleIncrement != null ? opts.angleIncrement : 90;
  const numStrands = 10;
  const scaffoldWidth = opts.scaffoldWidth || opts.strandSpacing * numStrands;
  const scaffoldDepth = opts.scaffoldDepth || opts.strandSpacing * numStrands;
  const totalHeight = opts.layerHeight * opts.numLayers;

  return {
    strandDiameter: opts.strandDiameter,
    strandSpacing: opts.strandSpacing,
    layerHeight: opts.layerHeight,
    numLayers: opts.numLayers,
    angleIncrement,
    scaffoldWidth,
    scaffoldDepth,
    totalHeight,
    boundingVolume: scaffoldWidth * scaffoldDepth * totalHeight
  };
}

// ── Porosity calculations ──

/**
 * Calculate overall porosity of a scaffold using volumetric estimation.
 * Models strands as cylinders within each layer.
 * @param {Object} scaffold - Scaffold definition from createScaffold
 * @returns {Object} Porosity metrics
 */
function calculatePorosity(scaffold) {
  const { strandDiameter, strandSpacing, layerHeight, numLayers,
          scaffoldWidth, scaffoldDepth, totalHeight, boundingVolume } = scaffold;

  const r = strandDiameter / 2;
  // Cross-sectional area of one strand (circular)
  const strandCrossSection = Math.PI * r * r;

  // For each layer, strands run in one direction
  // Number of strands per layer depends on direction
  let totalStrandVolume = 0;
  for (let i = 0; i < numLayers; i++) {
    const angle = (scaffold.angleIncrement * i) % 180;
    let strandLength, numStrands;
    if (Math.abs(angle) < 1 || Math.abs(angle - 180) < 1) {
      // Strands along X
      strandLength = scaffoldWidth;
      numStrands = Math.floor(scaffoldDepth / strandSpacing);
    } else if (Math.abs(angle - 90) < 1) {
      // Strands along Y
      strandLength = scaffoldDepth;
      numStrands = Math.floor(scaffoldWidth / strandSpacing);
    } else {
      // Angled strands — approximate
      const diag = Math.sqrt(scaffoldWidth ** 2 + scaffoldDepth ** 2);
      strandLength = diag;
      numStrands = Math.floor(Math.min(scaffoldWidth, scaffoldDepth) / strandSpacing);
    }
    totalStrandVolume += numStrands * strandCrossSection * strandLength;
  }

  const porosity = 1 - (totalStrandVolume / boundingVolume);
  const solidFraction = totalStrandVolume / boundingVolume;

  return {
    porosity: clamp(porosity, 0, 1),
    porosityPercent: clamp(porosity * 100, 0, 100),
    solidFraction: clamp(solidFraction, 0, 1),
    totalVolume: boundingVolume,
    solidVolume: totalStrandVolume,
    poreVolume: boundingVolume - totalStrandVolume
  };
}

// ── Pore size analysis ──

/**
 * Analyze pore sizes in a scaffold.
 * Models in-plane pores (gaps between strands) and inter-layer pores.
 * @param {Object} scaffold - Scaffold definition
 * @returns {Object} Pore size analysis
 */
function analyzePoreSizes(scaffold) {
  const { strandDiameter, strandSpacing, layerHeight } = scaffold;

  // In-plane pore: gap between adjacent strands
  const inPlanePoreSize = strandSpacing - strandDiameter;

  // Inter-layer pore: gap between layers
  const interLayerPoreSize = layerHeight - strandDiameter;
  // Clamp to 0 if strands are compressed
  const effectiveInterLayer = Math.max(0, interLayerPoreSize);

  // For 0/90 pattern, throat size is minimum of in-plane and inter-layer
  const throatSize = Math.min(inPlanePoreSize, effectiveInterLayer || inPlanePoreSize);

  // Generate synthetic pore size distribution (normal variation around nominal)
  const pores = [];
  const cv = 0.15; // coefficient of variation (typical for bioprinting)
  const numSamples = 100;
  // Seeded simple random for reproducibility
  let seed = Math.round(strandDiameter * 1000 + strandSpacing * 100 + layerHeight * 10);
  function seededRandom() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  // Box-Muller for normal distribution
  for (let i = 0; i < numSamples; i++) {
    const u1 = seededRandom() || 0.001;
    const u2 = seededRandom();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const pore = inPlanePoreSize + z * inPlanePoreSize * cv;
    if (pore > 0) pores.push(pore);
  }

  const distribution = {
    mean: mean(pores),
    stddev: stddev(pores),
    median: median(pores),
    min: Math.min(...pores),
    max: Math.max(...pores),
    p10: percentile(pores, 10),
    p25: percentile(pores, 25),
    p75: percentile(pores, 75),
    p90: percentile(pores, 90),
    cv: pores.length > 1 ? stddev(pores) / mean(pores) : 0,
    n: pores.length
  };

  // Histogram (10 bins)
  const binCount = 10;
  const binWidth = (distribution.max - distribution.min) / binCount;
  const histogram = [];
  for (let i = 0; i < binCount; i++) {
    const lo = distribution.min + i * binWidth;
    const hi = lo + binWidth;
    const count = pores.filter(p => p >= lo && (i === binCount - 1 ? p <= hi : p < hi)).length;
    histogram.push({
      binStart: Math.round(lo * 100) / 100,
      binEnd: Math.round(hi * 100) / 100,
      count,
      frequency: count / pores.length
    });
  }

  return {
    nominalInPlanePore: inPlanePoreSize,
    nominalInterLayerPore: effectiveInterLayer,
    throatSize,
    distribution,
    histogram,
    uniformityIndex: 1 - distribution.cv // closer to 1 = more uniform
  };
}

// ── Interconnectivity ──

/**
 * Estimate pore interconnectivity.
 * Based on geometric analysis of strand arrangement.
 * @param {Object} scaffold - Scaffold definition
 * @returns {Object} Interconnectivity metrics
 */
function estimateInterconnectivity(scaffold) {
  const { strandDiameter, strandSpacing, layerHeight, numLayers, angleIncrement } = scaffold;
  const gap = strandSpacing - strandDiameter;
  const interLayer = Math.max(0, layerHeight - strandDiameter);

  // Connectivity ratio: fraction of pore space that is connected
  // Higher when gaps are large relative to strand diameter
  const gapRatio = gap / strandSpacing;
  const layerRatio = interLayer > 0 ? interLayer / layerHeight : 0;

  // Angle diversity improves connectivity
  const uniqueAngles = new Set();
  for (let i = 0; i < Math.min(numLayers, 20); i++) {
    uniqueAngles.add((angleIncrement * i) % 180);
  }
  const angleDiversityFactor = Math.min(1, uniqueAngles.size / 4);

  // Composite interconnectivity score
  const interconnectivity = Math.min(1,
    0.4 * gapRatio + 0.3 * layerRatio + 0.3 * angleDiversityFactor
  );

  // Tortuosity: path length ratio through pore network (1 = straight, higher = more tortuous)
  const tortuosity = 1 + (1 - gapRatio) * 0.5 + (1 - layerRatio) * 0.3 +
    (1 - angleDiversityFactor) * 0.2;

  return {
    interconnectivity,
    gapRatio,
    layerRatio,
    angleDiversityFactor,
    tortuosity,
    uniqueAngles: uniqueAngles.size,
    rating: interconnectivity >= 0.7 ? 'excellent' :
            interconnectivity >= 0.5 ? 'good' :
            interconnectivity >= 0.3 ? 'moderate' : 'poor'
  };
}

// ── Permeability estimation (Kozeny-Carman) ──

/**
 * Estimate scaffold permeability using the Kozeny-Carman equation.
 * @param {Object} porosityResult - From calculatePorosity
 * @param {Object} poreAnalysis - From analyzePoreSizes
 * @returns {Object} Permeability estimates
 */
function estimatePermeability(porosityResult, poreAnalysis) {
  const eps = porosityResult.porosity;
  const d = poreAnalysis.nominalInPlanePore; // characteristic pore size in µm

  if (eps <= 0 || eps >= 1) {
    throw new Error('Porosity must be between 0 and 1 (exclusive)');
  }

  // Kozeny-Carman: k = (eps^3 * d^2) / (180 * (1-eps)^2)
  // d in µm → convert to m for SI permeability (m²)
  const d_m = d * 1e-6;
  const kozenyCarman = 180; // Kozeny-Carman constant

  const permeability_m2 = (eps ** 3 * d_m ** 2) / (kozenyCarman * (1 - eps) ** 2);
  const permeability_darcy = permeability_m2 / 9.869233e-13; // 1 darcy in m²

  // Specific surface area (1/m)
  const specificSurface = 6 * (1 - eps) / d_m;

  return {
    permeability_m2,
    permeability_darcy,
    permeability_mdarcy: permeability_darcy * 1000,
    specificSurface,
    porosity: eps,
    characteristicPoreSize_um: d,
    // Qualitative assessment for tissue engineering
    suitability: permeability_darcy > 1 ? 'high' :
                 permeability_darcy > 0.1 ? 'moderate' :
                 permeability_darcy > 0.01 ? 'low' : 'very low'
  };
}

// ── Tissue suitability scoring ──

/**
 * Score scaffold suitability for a specific tissue type.
 * @param {string} tissueType - One of: bone, cartilage, skin, nerve, vascular, liver
 * @param {Object} porosityResult - From calculatePorosity
 * @param {Object} poreAnalysis - From analyzePoreSizes
 * @param {Object} interconnResult - From estimateInterconnectivity
 * @returns {Object} Suitability score and breakdown
 */
function scoreTissueSuitability(tissueType, porosityResult, poreAnalysis, interconnResult) {
  const target = TISSUE_TARGETS[tissueType];
  if (!target) {
    throw new Error(`Unknown tissue type: ${tissueType}. Valid: ${Object.keys(TISSUE_TARGETS).join(', ')}`);
  }

  const porePct = porosityResult.porosityPercent;
  const poreSize = poreAnalysis.distribution.mean;
  const interconn = interconnResult.interconnectivity;

  // Score porosity (0-100)
  let porosityScore;
  if (porePct >= target.minPorosity && porePct <= target.maxPorosity) {
    // Within range — score based on distance from ideal
    const maxDist = Math.max(target.idealPorosity - target.minPorosity,
                              target.maxPorosity - target.idealPorosity);
    const dist = Math.abs(porePct - target.idealPorosity);
    porosityScore = 100 * (1 - dist / maxDist);
  } else {
    // Outside range — penalize
    const dist = porePct < target.minPorosity ?
      target.minPorosity - porePct : porePct - target.maxPorosity;
    porosityScore = Math.max(0, 50 - dist * 2);
  }

  // Score pore size (0-100)
  let poreSizeScore;
  if (poreSize >= target.minPoreSize && poreSize <= target.maxPoreSize) {
    const maxDist = Math.max(target.idealPoreSize - target.minPoreSize,
                              target.maxPoreSize - target.idealPoreSize);
    const dist = Math.abs(poreSize - target.idealPoreSize);
    poreSizeScore = 100 * (1 - dist / maxDist);
  } else {
    const dist = poreSize < target.minPoreSize ?
      target.minPoreSize - poreSize : poreSize - target.maxPoreSize;
    const range = target.maxPoreSize - target.minPoreSize;
    poreSizeScore = Math.max(0, 50 - (dist / range) * 100);
  }

  // Score interconnectivity (0-100)
  let interconnScore;
  if (interconn >= target.minInterconnectivity) {
    interconnScore = 70 + 30 * ((interconn - target.minInterconnectivity) /
                                 (1 - target.minInterconnectivity));
  } else {
    interconnScore = 70 * (interconn / target.minInterconnectivity);
  }

  // Composite score (weighted)
  const weights = { porosity: 0.3, poreSize: 0.4, interconnectivity: 0.3 };
  const composite = weights.porosity * porosityScore +
                    weights.poreSize * poreSizeScore +
                    weights.interconnectivity * interconnScore;

  const issues = [];
  if (porePct < target.minPorosity) issues.push(`Porosity too low (${porePct.toFixed(1)}% < ${target.minPorosity}%)`);
  if (porePct > target.maxPorosity) issues.push(`Porosity too high (${porePct.toFixed(1)}% > ${target.maxPorosity}%)`);
  if (poreSize < target.minPoreSize) issues.push(`Pore size too small (${poreSize.toFixed(0)}µm < ${target.minPoreSize}µm)`);
  if (poreSize > target.maxPoreSize) issues.push(`Pore size too large (${poreSize.toFixed(0)}µm > ${target.maxPoreSize}µm)`);
  if (interconn < target.minInterconnectivity) issues.push(`Interconnectivity too low (${(interconn*100).toFixed(0)}% < ${(target.minInterconnectivity*100).toFixed(0)}%)`);

  const suggestions = [];
  if (porePct < target.minPorosity) suggestions.push('Increase strand spacing or reduce strand diameter');
  if (porePct > target.maxPorosity) suggestions.push('Decrease strand spacing or increase strand diameter');
  if (poreSize < target.minPoreSize) suggestions.push('Increase strand spacing to enlarge pores');
  if (poreSize > target.maxPoreSize) suggestions.push('Decrease strand spacing to reduce pore size');
  if (interconn < target.minInterconnectivity) suggestions.push('Vary layer angles or increase inter-layer gap');

  return {
    tissueType,
    tissueLabel: target.label,
    composite: Math.round(composite * 10) / 10,
    scores: {
      porosity: Math.round(porosityScore * 10) / 10,
      poreSize: Math.round(poreSizeScore * 10) / 10,
      interconnectivity: Math.round(interconnScore * 10) / 10
    },
    weights,
    rating: composite >= 80 ? 'excellent' :
            composite >= 60 ? 'good' :
            composite >= 40 ? 'fair' : 'poor',
    issues,
    suggestions,
    targetParams: target
  };
}

// ── Multi-tissue comparison ──

/**
 * Compare scaffold suitability across all tissue types.
 * @param {Object} porosityResult
 * @param {Object} poreAnalysis
 * @param {Object} interconnResult
 * @returns {Object} Ranked tissue suitabilities
 */
function compareAllTissues(porosityResult, poreAnalysis, interconnResult) {
  const results = [];
  for (const tissueType of Object.keys(TISSUE_TARGETS)) {
    const score = scoreTissueSuitability(tissueType, porosityResult, poreAnalysis, interconnResult);
    results.push(score);
  }
  results.sort((a, b) => b.composite - a.composite);
  return {
    rankings: results,
    bestMatch: results[0],
    worstMatch: results[results.length - 1]
  };
}

// ── Full scaffold analysis ──

/**
 * Run complete porosity analysis on a scaffold.
 * @param {Object} scaffoldOpts - Options for createScaffold
 * @param {string} [targetTissue] - Optional tissue type to score
 * @returns {Object} Complete analysis report
 */
function analyzeScaffold(scaffoldOpts, targetTissue) {
  const scaffold = createScaffold(scaffoldOpts);
  const porosity = calculatePorosity(scaffold);
  const pores = analyzePoreSizes(scaffold);
  const interconn = estimateInterconnectivity(scaffold);
  const permeability = estimatePermeability(porosity, pores);

  const report = {
    scaffold,
    porosity,
    poreAnalysis: pores,
    interconnectivity: interconn,
    permeability
  };

  if (targetTissue) {
    report.tissueSuitability = scoreTissueSuitability(targetTissue, porosity, pores, interconn);
  } else {
    report.tissueComparison = compareAllTissues(porosity, pores, interconn);
  }

  return report;
}

// ── Parameter optimization ──

/**
 * Suggest optimal printing parameters for a target tissue type.
 * @param {string} tissueType - Target tissue
 * @param {Object} [constraints] - Optional constraints
 * @param {number} [constraints.minStrandDiameter=100] - Min strand diameter in µm
 * @param {number} [constraints.maxStrandDiameter=500] - Max strand diameter in µm
 * @param {number} [constraints.minLayerHeight=50] - Min layer height in µm
 * @param {number} [constraints.maxLayerHeight=500] - Max layer height in µm
 * @returns {Object} Suggested parameters and expected metrics
 */
function suggestParameters(tissueType, constraints) {
  const target = TISSUE_TARGETS[tissueType];
  if (!target) {
    throw new Error(`Unknown tissue type: ${tissueType}`);
  }

  const c = Object.assign({
    minStrandDiameter: 100,
    maxStrandDiameter: 500,
    minLayerHeight: 50,
    maxLayerHeight: 500
  }, constraints);

  // Work backwards from ideal pore size and porosity
  // poreSize ≈ spacing - diameter
  // porosity ≈ 1 - π*d²/(4*spacing*layerHeight) for one direction

  let bestScore = -1;
  let bestParams = null;
  let bestReport = null;

  // Grid search over feasible parameters
  const dSteps = 5;
  const sSteps = 8;
  const lSteps = 5;

  for (let di = 0; di <= dSteps; di++) {
    const diameter = c.minStrandDiameter + (c.maxStrandDiameter - c.minStrandDiameter) * di / dSteps;
    for (let si = 1; si <= sSteps; si++) {
      const spacing = diameter * (1.5 + si * 0.5); // 2x to 5.5x diameter
      for (let li = 0; li <= lSteps; li++) {
        const layerH = c.minLayerHeight + (c.maxLayerHeight - c.minLayerHeight) * li / lSteps;
        if (layerH < diameter * 0.5) continue; // unrealistic
        try {
          const opts = { strandDiameter: diameter, strandSpacing: spacing, layerHeight: layerH, numLayers: 10 };
          const scaffold = createScaffold(opts);
          const porosity = calculatePorosity(scaffold);
          const pores = analyzePoreSizes(scaffold);
          const interconn = estimateInterconnectivity(scaffold);
          const suitability = scoreTissueSuitability(tissueType, porosity, pores, interconn);
          if (suitability.composite > bestScore) {
            bestScore = suitability.composite;
            bestParams = opts;
            bestReport = { porosity, pores, interconn, suitability };
          }
        } catch (e) {
          // skip invalid combinations
        }
      }
    }
  }

  return {
    tissueType,
    suggestedParameters: bestParams,
    expectedMetrics: bestReport ? {
      porosity: bestReport.porosity.porosityPercent,
      meanPoreSize: bestReport.pores.distribution.mean,
      interconnectivity: bestReport.interconn.interconnectivity,
      suitabilityScore: bestReport.suitability.composite,
      rating: bestReport.suitability.rating
    } : null,
    constraints: c
  };
}

// ── Exports ──

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
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
    // Expose utilities for testing
    _utils: { mean, stddev, median, percentile }
  };
}
