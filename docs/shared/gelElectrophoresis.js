/**
 * Gel Electrophoresis Analyzer — band analysis and MW estimation.
 *
 * Supports:
 *   - Molecular weight estimation from migration distance (log-linear regression)
 *   - Standard curve fitting from ladder/marker bands
 *   - Band intensity ratio analysis (relative quantification)
 *   - Restriction digest fragment prediction
 *   - Gel recipe calculator (agarose/polyacrylamide concentrations)
 *   - Resolution range advisor (optimal gel % for target MW range)
 *
 * @module gelElectrophoresis
 */
'use strict';

/* ---------- Constants ---------- */

/** Common DNA ladders: name → array of fragment sizes in bp */
var DNA_LADDERS = {
  '1kb':      [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 750, 500, 250],
  '1kb-plus': [12000, 10000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 850, 650, 500, 400, 300, 200, 100],
  '100bp':    [1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
  '50bp':     [1350, 916, 766, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100, 50]
};

/** Common protein ladders: name → array of MW in kDa */
var PROTEIN_LADDERS = {
  'broad-range':  [250, 150, 100, 75, 50, 37, 25, 20, 15, 10],
  'precision':    [250, 150, 100, 75, 50, 37, 25, 20, 15, 10, 5, 2],
  'kaleidoscope': [250, 150, 100, 75, 50, 37, 25, 20, 15, 10]
};

/** Recommended agarose % for DNA size ranges */
var AGAROSE_RECOMMENDATIONS = [
  { pct: 0.5, minBp: 10000, maxBp: 50000 },
  { pct: 0.7, minBp: 5000,  maxBp: 20000 },
  { pct: 1.0, minBp: 500,   maxBp: 10000 },
  { pct: 1.2, minBp: 400,   maxBp: 7000  },
  { pct: 1.5, minBp: 200,   maxBp: 4000  },
  { pct: 2.0, minBp: 50,    maxBp: 2000  },
  { pct: 3.0, minBp: 20,    maxBp: 500   }
];

/** Recommended polyacrylamide % for protein MW ranges */
var PAGE_RECOMMENDATIONS = [
  { pct: 6,  minKDa: 60,  maxKDa: 250 },
  { pct: 8,  minKDa: 40,  maxKDa: 200 },
  { pct: 10, minKDa: 20,  maxKDa: 120 },
  { pct: 12, minKDa: 10,  maxKDa: 70  },
  { pct: 15, minKDa: 3,   maxKDa: 40  }
];

/* ---------- Helpers ---------- */

var _v = require('./validation');
var validatePositive = _v.validatePositive;
var round = _v.round;

function validateArray(arr, name, minLen) {
  if (!Array.isArray(arr) || arr.length < (minLen || 1)) {
    throw new Error(name + ' must be an array with at least ' + (minLen || 1) + ' element(s)');
  }
}

/**
 * Simple linear regression: y = slope * x + intercept
 * Returns { slope, intercept, rSquared }
 * Delegates to shared stats.linearRegression and aliases r2 → rSquared
 * for backward compatibility with existing consumers.
 */
var _linReg = require('./stats').linearRegression;
function linearRegression(xs, ys) {
  var result = _linReg(xs, ys);
  return { slope: result.slope, intercept: result.intercept, rSquared: result.r2 };
}

/* ---------- Core functions ---------- */

/**
 * Fit a standard curve from ladder bands.
 * Uses log(size) vs migration distance (log-linear model).
 *
 * @param {Array<{size: number, distance: number}>} bands
 *   Known ladder bands with size (bp or kDa) and migration distance (mm or relative).
 * @returns {{ slope: number, intercept: number, rSquared: number, predict: function }}
 */
function fitStandardCurve(bands) {
  validateArray(bands, 'bands', 2);
  var distances = [];
  var logSizes = [];
  for (var i = 0; i < bands.length; i++) {
    validatePositive(bands[i].size, 'bands[' + i + '].size');
    validatePositive(bands[i].distance, 'bands[' + i + '].distance');
    distances.push(bands[i].distance);
    logSizes.push(Math.log10(bands[i].size));
  }
  var reg = linearRegression(distances, logSizes);
  return {
    slope: round(reg.slope, 6),
    intercept: round(reg.intercept, 6),
    rSquared: round(reg.rSquared, 6),
    predict: function (distance) {
      validatePositive(distance, 'distance');
      var logSize = reg.slope * distance + reg.intercept;
      return round(Math.pow(10, logSize), 2);
    }
  };
}

/**
 * Estimate molecular weight of unknown bands given a fitted curve.
 *
 * @param {Array<{size: number, distance: number}>} ladderBands - Known standards.
 * @param {number[]} unknownDistances - Migration distances of unknown bands.
 * @returns {{ curve: object, estimates: Array<{ distance: number, estimatedSize: number }> }}
 */
function estimateMW(ladderBands, unknownDistances) {
  var curve = fitStandardCurve(ladderBands);
  validateArray(unknownDistances, 'unknownDistances', 1);
  var estimates = [];
  for (var i = 0; i < unknownDistances.length; i++) {
    estimates.push({
      distance: unknownDistances[i],
      estimatedSize: curve.predict(unknownDistances[i])
    });
  }
  return { curve: { slope: curve.slope, intercept: curve.intercept, rSquared: curve.rSquared }, estimates: estimates };
}

/**
 * Analyze band intensities for relative quantification.
 *
 * @param {number[]} intensities - Raw intensity values for each band.
 * @returns {{ bands: Array<{ index: number, intensity: number, fraction: number, percent: number }>, total: number }}
 */
function analyzeIntensities(intensities) {
  validateArray(intensities, 'intensities', 1);
  var total = 0;
  for (var i = 0; i < intensities.length; i++) {
    if (typeof intensities[i] !== 'number' || intensities[i] < 0) {
      throw new Error('intensities[' + i + '] must be a non-negative number');
    }
    total += intensities[i];
  }
  var bands = [];
  for (var j = 0; j < intensities.length; j++) {
    var fraction = total > 0 ? intensities[j] / total : 0;
    bands.push({
      index: j,
      intensity: intensities[j],
      fraction: round(fraction, 6),
      percent: round(fraction * 100, 2)
    });
  }
  return { bands: bands, total: round(total, 4) };
}

/**
 * Predict restriction digest fragments.
 *
 * @param {number} sequenceLength - Total length of DNA in bp.
 * @param {number[]} cutSites - Array of cut positions (bp from start).
 * @returns {{ fragments: number[], count: number, sorted: number[] }}
 */
function predictDigest(sequenceLength, cutSites) {
  validatePositive(sequenceLength, 'sequenceLength');
  validateArray(cutSites, 'cutSites', 1);
  var sorted = cutSites.slice().sort(function (a, b) { return a - b; });
  // Validate cut sites
  for (var i = 0; i < sorted.length; i++) {
    if (sorted[i] <= 0 || sorted[i] >= sequenceLength) {
      throw new Error('Cut site ' + sorted[i] + ' is outside sequence bounds (1 to ' + (sequenceLength - 1) + ')');
    }
  }
  var fragments = [];
  var prev = 0;
  for (var j = 0; j < sorted.length; j++) {
    fragments.push(sorted[j] - prev);
    prev = sorted[j];
  }
  fragments.push(sequenceLength - prev);
  var sortedFrags = fragments.slice().sort(function (a, b) { return b - a; });
  return { fragments: fragments, count: fragments.length, sorted: sortedFrags };
}

/**
 * Calculate agarose gel recipe.
 *
 * @param {{ percentage: number, volumeMl: number, bufferType?: string }} opts
 * @returns {{ agaroseGrams: number, bufferMl: number, bufferType: string, etBrUl: number, percentage: number }}
 */
function gelRecipe(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('opts is required');
  validatePositive(opts.percentage, 'percentage');
  validatePositive(opts.volumeMl, 'volumeMl');
  if (opts.percentage > 5) throw new Error('Agarose percentage unusually high (>5%). Check value.');
  var bufferType = opts.bufferType || 'TAE';
  var agaroseGrams = round((opts.percentage / 100) * opts.volumeMl, 4);
  // EtBr: typical 0.5 µg/mL from 10 mg/mL stock → 0.05 µL per mL
  var etBrUl = round(opts.volumeMl * 0.05, 2);
  return {
    agaroseGrams: agaroseGrams,
    bufferMl: opts.volumeMl,
    bufferType: bufferType,
    etBrUl: etBrUl,
    percentage: opts.percentage
  };
}

/**
 * Recommend optimal gel concentration for a target size range.
 *
 * @param {{ type: string, minSize: number, maxSize: number }} opts
 *   type: 'dna' or 'protein'. minSize/maxSize in bp (DNA) or kDa (protein).
 * @returns {Array<{ pct: number, minSize: number, maxSize: number, coverage: string }>}
 */
function recommendGelPercent(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('opts is required');
  var type = (opts.type || 'dna').toLowerCase();
  validatePositive(opts.minSize, 'minSize');
  validatePositive(opts.maxSize, 'maxSize');
  if (opts.minSize >= opts.maxSize) throw new Error('minSize must be less than maxSize');

  var recommendations = type === 'protein' ? PAGE_RECOMMENDATIONS : AGAROSE_RECOMMENDATIONS;
  var results = [];
  for (var i = 0; i < recommendations.length; i++) {
    var rec = recommendations[i];
    var min = type === 'protein' ? rec.minKDa : rec.minBp;
    var max = type === 'protein' ? rec.maxKDa : rec.maxBp;
    // Check overlap
    if (opts.minSize <= max && opts.maxSize >= min) {
      var overlapMin = Math.max(opts.minSize, min);
      var overlapMax = Math.min(opts.maxSize, max);
      var coverage = round(((overlapMax - overlapMin) / (opts.maxSize - opts.minSize)) * 100, 1);
      results.push({
        pct: rec.pct,
        minSize: min,
        maxSize: max,
        coverage: coverage + '%'
      });
    }
  }
  return results;
}

/**
 * Get available ladder definitions.
 *
 * @param {string} [type] - 'dna' or 'protein'. Omit for both.
 * @returns {object} Ladder name → sizes array.
 */
function getLadders(type) {
  if (!type) return { dna: DNA_LADDERS, protein: PROTEIN_LADDERS };
  if (type === 'dna') return DNA_LADDERS;
  if (type === 'protein') return PROTEIN_LADDERS;
  throw new Error('Unknown ladder type: ' + type + '. Use "dna" or "protein".');
}

/* ---------- Factory ---------- */

function createGelElectrophoresisAnalyzer() {
  return {
    fitStandardCurve: fitStandardCurve,
    estimateMW: estimateMW,
    analyzeIntensities: analyzeIntensities,
    predictDigest: predictDigest,
    gelRecipe: gelRecipe,
    recommendGelPercent: recommendGelPercent,
    getLadders: getLadders
  };
}

/* ---------- Exports ---------- */

exports.createGelElectrophoresisAnalyzer = createGelElectrophoresisAnalyzer;
