'use strict';

const { clamp, mean: _mean } = require('./scriptUtils');

/**
 * Bioink Compatibility Matrix
 *
 * Analyzes multi-material compatibility for bioprinting workflows that use
 * more than one bioink. Evaluates pairwise compatibility across multiple
 * dimensions: rheological matching, crosslinking compatibility, thermal
 * window overlap, pH tolerance, and interface adhesion estimation.
 *
 * Usage:
 *   const { createCompatibilityMatrix } = require('./compatibility');
 *   const matrix = createCompatibilityMatrix();
 *   matrix.addBioink({ name: 'GelMA 5%', ... });
 *   matrix.addBioink({ name: 'Alginate 2%', ... });
 *   const result = matrix.analyzePair('GelMA 5%', 'Alginate 2%');
 *   const report = matrix.fullReport();
 */

// ── Built-in bioink profiles ──

const BUILTIN_BIOINKS = {
  'GelMA 5%': {
    name: 'GelMA 5%',
    viscosityPas: 0.8,
    shearThinningIndex: 0.45,
    crosslinkMethod: 'uv',
    crosslinkWavelength: 405,
    crosslinkTimeS: 30,
    tempMinC: 20,
    tempMaxC: 37,
    printTempC: 25,
    phMin: 6.5,
    phMax: 7.5,
    optimalPh: 7.0,
    surfaceTension: 45,
    cellType: 'fibroblast',
    degradationDays: 28,
    swellingRatio: 1.8,
    mechanicalModulusKPa: 12,
    tags: ['photocrosslinkable', 'protein-based'],
  },
  'Alginate 2%': {
    name: 'Alginate 2%',
    viscosityPas: 0.3,
    shearThinningIndex: 0.65,
    crosslinkMethod: 'ionic',
    crosslinkAgent: 'CaCl2',
    crosslinkTimeS: 10,
    tempMinC: 15,
    tempMaxC: 40,
    printTempC: 22,
    phMin: 6.0,
    phMax: 8.0,
    optimalPh: 7.2,
    surfaceTension: 52,
    cellType: 'chondrocyte',
    degradationDays: 14,
    swellingRatio: 2.5,
    mechanicalModulusKPa: 5,
    tags: ['ionic-crosslink', 'polysaccharide'],
  },
  'Collagen I 3mg/mL': {
    name: 'Collagen I 3mg/mL',
    viscosityPas: 0.15,
    shearThinningIndex: 0.55,
    crosslinkMethod: 'thermal',
    crosslinkTempC: 37,
    crosslinkTimeS: 600,
    tempMinC: 4,
    tempMaxC: 37,
    printTempC: 10,
    phMin: 6.8,
    phMax: 7.6,
    optimalPh: 7.4,
    surfaceTension: 40,
    cellType: 'hepatocyte',
    degradationDays: 21,
    swellingRatio: 1.3,
    mechanicalModulusKPa: 2,
    tags: ['thermal-crosslink', 'protein-based'],
  },
  'PEGDA 10%': {
    name: 'PEGDA 10%',
    viscosityPas: 0.05,
    shearThinningIndex: 0.9,
    crosslinkMethod: 'uv',
    crosslinkWavelength: 365,
    crosslinkTimeS: 60,
    tempMinC: 18,
    tempMaxC: 45,
    printTempC: 25,
    phMin: 5.5,
    phMax: 8.5,
    optimalPh: 7.0,
    surfaceTension: 55,
    cellType: 'msc',
    degradationDays: 90,
    swellingRatio: 3.2,
    mechanicalModulusKPa: 50,
    tags: ['photocrosslinkable', 'synthetic'],
  },
  'Hyaluronic Acid 1.5%': {
    name: 'Hyaluronic Acid 1.5%',
    viscosityPas: 1.2,
    shearThinningIndex: 0.35,
    crosslinkMethod: 'uv',
    crosslinkWavelength: 365,
    crosslinkTimeS: 45,
    tempMinC: 20,
    tempMaxC: 37,
    printTempC: 25,
    phMin: 6.0,
    phMax: 7.5,
    optimalPh: 7.0,
    surfaceTension: 48,
    cellType: 'chondrocyte',
    degradationDays: 7,
    swellingRatio: 4.0,
    mechanicalModulusKPa: 3,
    tags: ['photocrosslinkable', 'polysaccharide'],
  },
  'Silk Fibroin 8%': {
    name: 'Silk Fibroin 8%',
    viscosityPas: 2.5,
    shearThinningIndex: 0.3,
    crosslinkMethod: 'enzymatic',
    crosslinkAgent: 'HRP/H2O2',
    crosslinkTimeS: 120,
    tempMinC: 20,
    tempMaxC: 37,
    printTempC: 25,
    phMin: 6.5,
    phMax: 7.8,
    optimalPh: 7.0,
    surfaceTension: 42,
    cellType: 'osteoblast',
    degradationDays: 60,
    swellingRatio: 1.5,
    mechanicalModulusKPa: 30,
    tags: ['enzymatic-crosslink', 'protein-based'],
  },
};

// ── Scoring helpers ──

/**
 * Score overlap of two ranges [a1,a2] and [b1,b2]. Returns 0-1.
 */
function rangeOverlapScore(a1, a2, b1, b2) {
  const lo = Math.max(a1, b1);
  const hi = Math.min(a2, b2);
  if (lo >= hi) return 0;
  const overlap = hi - lo;
  const smaller = Math.min(a2 - a1, b2 - b1);
  if (smaller <= 0) return 0;
  return clamp(overlap / smaller, 0, 1);
}

/**
 * Score difference between two values relative to a scale. Closer = higher.
 */
function proxScore(a, b, scale) {
  return Math.max(0, 1 - Math.abs(a - b) / scale);
}

// ── Pairwise analysis dimensions ──

function rheologyScore(a, b) {
  const viscRatio = a.viscosityPas > b.viscosityPas
    ? b.viscosityPas / a.viscosityPas
    : a.viscosityPas / b.viscosityPas;
  const shearDiff = Math.abs(a.shearThinningIndex - b.shearThinningIndex);
  // Viscosity within 3x is good; shear thinning index within 0.3 is ideal
  const viscScore = clamp(viscRatio, 0, 1);
  const shearScore = Math.max(0, 1 - shearDiff / 0.5);
  return {
    score: 0.6 * viscScore + 0.4 * shearScore,
    viscosityRatio: +(a.viscosityPas / b.viscosityPas).toFixed(3),
    shearThinningDiff: +shearDiff.toFixed(3),
    detail: viscRatio < 0.2
      ? 'Large viscosity mismatch — may cause interface instability'
      : viscRatio < 0.5
        ? 'Moderate viscosity difference — consider interface gradient'
        : 'Good viscosity match',
  };
}

function crosslinkScore(a, b) {
  const sameMethod = a.crosslinkMethod === b.crosslinkMethod;
  let score, detail;

  if (sameMethod) {
    if (a.crosslinkMethod === 'uv' && a.crosslinkWavelength && b.crosslinkWavelength) {
      const wlDiff = Math.abs(a.crosslinkWavelength - b.crosslinkWavelength);
      if (wlDiff === 0) {
        score = 1.0;
        detail = 'Same UV wavelength — single-step crosslinking possible';
      } else if (wlDiff <= 40) {
        score = 0.7;
        detail = `UV wavelengths differ by ${wlDiff}nm — sequential crosslinking recommended`;
      } else {
        score = 0.4;
        detail = `UV wavelengths differ by ${wlDiff}nm — may need separate crosslinking steps`;
      }
    } else {
      score = 0.9;
      detail = `Both use ${a.crosslinkMethod} crosslinking — compatible workflow`;
    }
  } else {
    // Different methods — orthogonal crosslinking can be advantageous
    const orthogonalPairs = [
      ['uv', 'ionic'], ['uv', 'enzymatic'], ['thermal', 'ionic'],
      ['thermal', 'uv'], ['enzymatic', 'ionic'],
    ];
    const isOrthogonal = orthogonalPairs.some(([x, y]) =>
      (a.crosslinkMethod === x && b.crosslinkMethod === y) ||
      (a.crosslinkMethod === y && b.crosslinkMethod === x)
    );
    if (isOrthogonal) {
      score = 0.75;
      detail = `Orthogonal crosslinking (${a.crosslinkMethod}/${b.crosslinkMethod}) — independent gelation possible`;
    } else {
      score = 0.5;
      detail = `Different crosslinking methods (${a.crosslinkMethod}/${b.crosslinkMethod}) — verify compatibility`;
    }
  }

  return { score, sameMethod, methods: [a.crosslinkMethod, b.crosslinkMethod], detail };
}

function thermalScore(a, b) {
  const overlap = rangeOverlapScore(a.tempMinC, a.tempMaxC, b.tempMinC, b.tempMaxC);
  const printTempDiff = Math.abs(a.printTempC - b.printTempC);
  const printScore = proxScore(a.printTempC, b.printTempC, 20);

  const overlapMin = Math.max(a.tempMinC, b.tempMinC);
  const overlapMax = Math.min(a.tempMaxC, b.tempMaxC);

  return {
    score: 0.5 * overlap + 0.5 * printScore,
    overlapRange: overlapMin < overlapMax ? [overlapMin, overlapMax] : null,
    printTempDiffC: printTempDiff,
    detail: overlap === 0
      ? 'No thermal window overlap — cannot co-print'
      : overlap < 0.3
        ? 'Narrow thermal window — tight temperature control required'
        : 'Good thermal compatibility',
  };
}

function phScore(a, b) {
  const overlap = rangeOverlapScore(a.phMin, a.phMax, b.phMin, b.phMax);
  const optDiff = Math.abs(a.optimalPh - b.optimalPh);
  const optScore = proxScore(a.optimalPh, b.optimalPh, 2);

  return {
    score: 0.5 * overlap + 0.5 * optScore,
    overlapRange: Math.max(a.phMin, b.phMin) < Math.min(a.phMax, b.phMax)
      ? [Math.max(a.phMin, b.phMin), Math.min(a.phMax, b.phMax)]
      : null,
    optimalPhDiff: +optDiff.toFixed(2),
    detail: overlap === 0
      ? 'No pH overlap — incompatible'
      : 'pH ranges overlap — compatible',
  };
}

function interfaceScore(a, b) {
  // Surface tension similarity predicts interface adhesion
  const stDiff = Math.abs((a.surfaceTension || 45) - (b.surfaceTension || 45));
  const stScore = proxScore(a.surfaceTension || 45, b.surfaceTension || 45, 30);

  // Swelling ratio similarity affects dimensional stability at interfaces
  const swellRatio = a.swellingRatio && b.swellingRatio
    ? Math.min(a.swellingRatio, b.swellingRatio) / Math.max(a.swellingRatio, b.swellingRatio)
    : 0.5;

  // Mechanical modulus matching — large mismatches cause stress concentrations
  const modA = a.mechanicalModulusKPa || 10;
  const modB = b.mechanicalModulusKPa || 10;
  const modRatio = Math.min(modA, modB) / Math.max(modA, modB);
  const modScore = clamp(modRatio, 0, 1);

  const score = 0.4 * stScore + 0.3 * swellRatio + 0.3 * modScore;

  return {
    score,
    surfaceTensionDiff: +stDiff.toFixed(1),
    swellingRatioMatch: +swellRatio.toFixed(3),
    modulusRatio: +modRatio.toFixed(3),
    detail: score > 0.7
      ? 'Good interface adhesion predicted'
      : score > 0.4
        ? 'Moderate interface — consider adhesion promoter'
        : 'Poor interface — significant delamination risk',
  };
}

function degradationScore(a, b) {
  const dA = a.degradationDays || 30;
  const dB = b.degradationDays || 30;
  const ratio = Math.min(dA, dB) / Math.max(dA, dB);
  return {
    score: clamp(ratio, 0, 1),
    rateRatio: +(dA / dB).toFixed(3),
    detail: ratio > 0.7
      ? 'Similar degradation rates — good structural balance'
      : ratio > 0.3
        ? 'Different degradation rates — staged remodeling possible'
        : 'Very different degradation rates — early structural compromise risk',
  };
}

// ── Composite scoring ──

const DIMENSION_WEIGHTS = {
  rheology: 0.2,
  crosslinking: 0.2,
  thermal: 0.2,
  ph: 0.15,
  interface: 0.15,
  degradation: 0.1,
};

function classifyCompatibility(score) {
  if (score >= 0.8) return 'excellent';
  if (score >= 0.6) return 'good';
  if (score >= 0.4) return 'moderate';
  if (score >= 0.2) return 'poor';
  return 'incompatible';
}

function analyzePairDetail(a, b) {
  const dimensions = {
    rheology: rheologyScore(a, b),
    crosslinking: crosslinkScore(a, b),
    thermal: thermalScore(a, b),
    ph: phScore(a, b),
    interface: interfaceScore(a, b),
    degradation: degradationScore(a, b),
  };

  let composite = 0;
  for (const [dim, w] of Object.entries(DIMENSION_WEIGHTS)) {
    composite += w * dimensions[dim].score;
  }
  composite = +composite.toFixed(4);

  // Identify blockers (any dimension < 0.1)
  const blockers = Object.entries(dimensions)
    .filter(([, v]) => v.score < 0.1)
    .map(([k, v]) => ({ dimension: k, score: v.score, detail: v.detail }));

  // Recommendations
  const recommendations = [];
  if (dimensions.rheology.score < 0.4) {
    recommendations.push('Add thickener/thinner to match viscosities');
  }
  if (dimensions.thermal.score < 0.4) {
    recommendations.push('Use heated/cooled dual-nozzle system');
  }
  if (dimensions.interface.score < 0.5) {
    recommendations.push('Apply adhesion-promoting layer between materials');
  }
  if (dimensions.crosslinking.score < 0.5 && !dimensions.crosslinking.sameMethod) {
    recommendations.push('Verify crosslinking agents do not interfere');
  }
  if (dimensions.degradation.score < 0.4) {
    recommendations.push('Consider using degradation-matched formulations');
  }

  return {
    bioinkA: a.name,
    bioinkB: b.name,
    composite,
    classification: classifyCompatibility(composite),
    dimensions,
    blockers,
    recommendations,
  };
}

// ── Matrix factory ──

function createCompatibilityMatrix(opts = {}) {
  const bioinks = new Map();
  const customWeights = opts.weights || { ...DIMENSION_WEIGHTS };

  // Pre-load built-in bioinks if requested
  if (opts.loadBuiltins !== false) {
    for (const [name, profile] of Object.entries(BUILTIN_BIOINKS)) {
      bioinks.set(name, { ...profile });
    }
  }

  function addBioink(profile) {
    if (!profile || !profile.name) throw new Error('Bioink profile must have a name');
    if (typeof profile.viscosityPas !== 'number' || profile.viscosityPas <= 0) {
      throw new Error('viscosityPas must be a positive number');
    }
    if (typeof profile.shearThinningIndex !== 'number' ||
        profile.shearThinningIndex < 0 || profile.shearThinningIndex > 1) {
      throw new Error('shearThinningIndex must be between 0 and 1');
    }
    if (!profile.crosslinkMethod) {
      throw new Error('crosslinkMethod is required');
    }
    bioinks.set(profile.name, { ...profile });
    return profile.name;
  }

  function removeBioink(name) {
    return bioinks.delete(name);
  }

  function getBioink(name) {
    return bioinks.has(name) ? { ...bioinks.get(name) } : null;
  }

  function listBioinks() {
    return Array.from(bioinks.keys()).sort();
  }

  function analyzePair(nameA, nameB) {
    const a = bioinks.get(nameA);
    const b = bioinks.get(nameB);
    if (!a) throw new Error(`Unknown bioink: ${nameA}`);
    if (!b) throw new Error(`Unknown bioink: ${nameB}`);
    if (nameA === nameB) {
      return {
        bioinkA: nameA,
        bioinkB: nameB,
        composite: 1.0,
        classification: 'excellent',
        dimensions: {},
        blockers: [],
        recommendations: [],
        note: 'Same material — fully compatible',
      };
    }
    return analyzePairDetail(a, b);
  }

  function fullMatrix() {
    const names = listBioinks();
    const matrix = {};
    for (const a of names) {
      matrix[a] = {};
      for (const b of names) {
        if (a === b) {
          matrix[a][b] = { composite: 1.0, classification: 'excellent' };
        } else if (matrix[b] && matrix[b][a]) {
          // Symmetric — copy
          matrix[a][b] = { composite: matrix[b][a].composite, classification: matrix[b][a].classification };
        } else {
          const result = analyzePair(a, b);
          matrix[a][b] = { composite: result.composite, classification: result.classification };
        }
      }
    }
    return matrix;
  }

  function bestPairs(n = 5) {
    const names = listBioinks();
    const pairs = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const result = analyzePair(names[i], names[j]);
        pairs.push(result);
      }
    }
    pairs.sort((a, b) => b.composite - a.composite);
    return pairs.slice(0, n);
  }

  function worstPairs(n = 5) {
    const names = listBioinks();
    const pairs = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const result = analyzePair(names[i], names[j]);
        pairs.push(result);
      }
    }
    pairs.sort((a, b) => a.composite - b.composite);
    return pairs.slice(0, n);
  }

  function findCompatible(name, minScore = 0.6) {
    const names = listBioinks().filter(n => n !== name);
    const results = [];
    for (const other of names) {
      const result = analyzePair(name, other);
      if (result.composite >= minScore) {
        results.push(result);
      }
    }
    results.sort((a, b) => b.composite - a.composite);
    return results;
  }

  function multiMaterialPlan(bioinkNames) {
    if (!Array.isArray(bioinkNames) || bioinkNames.length < 2) {
      throw new Error('Need at least 2 bioink names');
    }
    for (const n of bioinkNames) {
      if (!bioinks.has(n)) throw new Error(`Unknown bioink: ${n}`);
    }

    const pairResults = [];
    for (let i = 0; i < bioinkNames.length; i++) {
      for (let j = i + 1; j < bioinkNames.length; j++) {
        pairResults.push(analyzePair(bioinkNames[i], bioinkNames[j]));
      }
    }

    const minPair = pairResults.reduce((m, p) =>
      p.composite < m.composite ? p : m, pairResults[0]);
    const avgComposite = +(_mean(pairResults.map(p => p.composite))).toFixed(4);

    // Find common thermal window
    let commonTempMin = -Infinity, commonTempMax = Infinity;
    for (const n of bioinkNames) {
      const b = bioinks.get(n);
      commonTempMin = Math.max(commonTempMin, b.tempMinC);
      commonTempMax = Math.min(commonTempMax, b.tempMaxC);
    }
    const commonThermalWindow = commonTempMin < commonTempMax
      ? [commonTempMin, commonTempMax] : null;

    // Common pH window
    let commonPhMin = -Infinity, commonPhMax = Infinity;
    for (const n of bioinkNames) {
      const b = bioinks.get(n);
      commonPhMin = Math.max(commonPhMin, b.phMin);
      commonPhMax = Math.min(commonPhMax, b.phMax);
    }
    const commonPhWindow = commonPhMin < commonPhMax
      ? [+commonPhMin.toFixed(1), +commonPhMax.toFixed(1)] : null;

    // Crosslinking methods needed
    const crosslinkMethods = [...new Set(bioinkNames.map(n => bioinks.get(n).crosslinkMethod))];

    // Printing order suggestion (highest viscosity first for structural integrity)
    const printOrder = [...bioinkNames].sort((a, b) =>
      bioinks.get(b).viscosityPas - bioinks.get(a).viscosityPas);

    const allBlockers = pairResults.flatMap(p => p.blockers.map(bl => ({
      ...bl, pair: `${p.bioinkA} / ${p.bioinkB}`,
    })));

    const allRecs = [...new Set(pairResults.flatMap(p => p.recommendations))];

    return {
      bioinks: bioinkNames,
      pairCount: pairResults.length,
      averageCompatibility: avgComposite,
      classification: classifyCompatibility(avgComposite),
      weakestLink: { pair: `${minPair.bioinkA} / ${minPair.bioinkB}`, score: minPair.composite },
      commonThermalWindow,
      commonPhWindow,
      crosslinkMethods,
      suggestedPrintOrder: printOrder,
      blockers: allBlockers,
      recommendations: allRecs,
      pairDetails: pairResults,
    };
  }

  function fullReport() {
    const names = listBioinks();
    const matrix = fullMatrix();
    const best = bestPairs(3);
    const worst = worstPairs(3);

    // Category counts
    const cats = { excellent: 0, good: 0, moderate: 0, poor: 0, incompatible: 0 };
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        cats[matrix[names[i]][names[j]].classification]++;
      }
    }

    return {
      bioinkCount: names.length,
      totalPairs: names.length * (names.length - 1) / 2,
      distributionByClass: cats,
      bestPairs: best.map(p => ({
        pair: `${p.bioinkA} / ${p.bioinkB}`,
        score: p.composite,
        classification: p.classification,
      })),
      worstPairs: worst.map(p => ({
        pair: `${p.bioinkA} / ${p.bioinkB}`,
        score: p.composite,
        classification: p.classification,
      })),
      matrix,
    };
  }

  return {
    addBioink,
    removeBioink,
    getBioink,
    listBioinks,
    analyzePair,
    fullMatrix,
    bestPairs,
    worstPairs,
    findCompatible,
    multiMaterialPlan,
    fullReport,
  };
}

module.exports = {
  createCompatibilityMatrix,
  BUILTIN_BIOINKS,
  DIMENSION_WEIGHTS,
  // Expose internals for testing
  _rheologyScore: rheologyScore,
  _crosslinkScore: crosslinkScore,
  _thermalScore: thermalScore,
  _phScore: phScore,
  _interfaceScore: interfaceScore,
  _degradationScore: degradationScore,
  _rangeOverlapScore: rangeOverlapScore,
  _proxScore: proxScore,
  _classifyCompatibility: classifyCompatibility,
};
