/**
 * Cell Counter — hemocytometer-based cell counting calculator.
 *
 * Computes cell concentration, total cell count, viability percentage,
 * and dilution recommendations from hemocytometer grid counts.
 * Supports standard Neubauer, Improved Neubauer, Burker, and Fuchs-Rosenthal
 * chamber types.
 *
 * @module cellCounter
 */
'use strict';

/* ---------- Chamber specifications ---------- */

/**
 * Each chamber has:
 *   squareVolumeMl — volume of one large square in mL
 *   totalSquares   — number of large squares available
 *   defaultSquares — typical number of squares counted
 */
var CHAMBER_SPECS = {
  'neubauer':          { squareVolumeMl: 0.0001, totalSquares: 9, defaultSquares: 4 },
  'improved-neubauer': { squareVolumeMl: 0.0001, totalSquares: 9, defaultSquares: 4 },
  'burker':            { squareVolumeMl: 0.0001, totalSquares: 9, defaultSquares: 9 },
  'fuchs-rosenthal':   { squareVolumeMl: 0.0002, totalSquares: 16, defaultSquares: 16 }
};

/* ---------- Helpers (shared) ---------- */

var _v = require('./validation');
var validatePositive = _v.validatePositive;
var validateNonNegative = _v.validateNonNegative;
var round = _v.round;

/* ---------- Core calculations ---------- */

/**
 * Calculate cell concentration from hemocytometer counts.
 *
 * @param {Object} opts
 * @param {number[]} opts.counts        — cell counts per square (array of numbers)
 * @param {string}   [opts.chamber]     — chamber type (default: 'improved-neubauer')
 * @param {number}   [opts.dilutionFactor] — dilution factor (default: 1, e.g. 2 for 1:2)
 * @param {number}   [opts.squaresCounted] — overrides how many squares were counted
 * @returns {Object} concentration results
 */
function calculateConcentration(opts) {
  if (!opts || !Array.isArray(opts.counts) || opts.counts.length === 0) {
    throw new Error('counts must be a non-empty array of numbers');
  }

  var chamberType = opts.chamber || 'improved-neubauer';
  var spec = CHAMBER_SPECS[chamberType];
  if (!spec) {
    throw new Error('Unknown chamber type: ' + chamberType + '. Supported: ' + Object.keys(CHAMBER_SPECS).join(', '));
  }

  var dilutionFactor = opts.dilutionFactor || 1;
  validatePositive(dilutionFactor, 'dilutionFactor');

  var squaresCounted = opts.squaresCounted || opts.counts.length;
  validatePositive(squaresCounted, 'squaresCounted');

  var totalCount = 0;
  for (var i = 0; i < opts.counts.length; i++) {
    validateNonNegative(opts.counts[i], 'counts[' + i + ']');
    totalCount += opts.counts[i];
  }

  var averagePerSquare = totalCount / squaresCounted;
  // concentration = (average count / volume per square) * dilution factor
  var cellsPerMl = (averagePerSquare / spec.squareVolumeMl) * dilutionFactor;

  // Statistical quality: coefficient of variation
  var mean = averagePerSquare;
  var sumSqDiff = 0;
  for (var j = 0; j < opts.counts.length; j++) {
    var diff = opts.counts[j] - mean;
    sumSqDiff += diff * diff;
  }
  var stdDev = opts.counts.length > 1 ? Math.sqrt(sumSqDiff / (opts.counts.length - 1)) : 0;
  var cv = mean > 0 ? (stdDev / mean) * 100 : 0;

  // Quality assessment
  var quality = 'good';
  var warnings = [];
  if (cv > 20) {
    quality = 'poor';
    warnings.push('High variability (CV > 20%). Recount recommended.');
  } else if (cv > 10) {
    quality = 'acceptable';
    warnings.push('Moderate variability (CV > 10%). Consider recounting.');
  }
  if (averagePerSquare < 10) {
    warnings.push('Low cell count per square. Consider using a less diluted sample.');
  }
  if (averagePerSquare > 100) {
    warnings.push('High cell count per square. Consider further dilution for accuracy.');
  }

  return {
    chamberType: chamberType,
    squaresCounted: squaresCounted,
    totalCellsCounted: totalCount,
    averagePerSquare: round(averagePerSquare, 2),
    dilutionFactor: dilutionFactor,
    cellsPerMl: round(cellsPerMl, 0),
    cellsPerMlFormatted: cellsPerMl.toExponential(2) + ' cells/mL',
    standardDeviation: round(stdDev, 2),
    coefficientOfVariation: round(cv, 2),
    quality: quality,
    warnings: warnings
  };
}

/**
 * Calculate viability from live/dead counts (e.g. trypan blue exclusion).
 *
 * @param {Object} opts
 * @param {number} opts.liveCells  — total live cells counted
 * @param {number} opts.deadCells  — total dead cells counted
 * @returns {Object} viability results
 */
function calculateViability(opts) {
  if (!opts) throw new Error('Options required');
  validateNonNegative(opts.liveCells, 'liveCells');
  validateNonNegative(opts.deadCells, 'deadCells');

  var total = opts.liveCells + opts.deadCells;
  if (total === 0) throw new Error('Total cell count cannot be zero');

  var viabilityPct = (opts.liveCells / total) * 100;

  var assessment = 'excellent';
  if (viabilityPct < 70) assessment = 'poor';
  else if (viabilityPct < 85) assessment = 'acceptable';
  else if (viabilityPct < 95) assessment = 'good';

  return {
    liveCells: opts.liveCells,
    deadCells: opts.deadCells,
    totalCells: total,
    viabilityPercent: round(viabilityPct, 1),
    assessment: assessment,
    suitableForBioprinting: viabilityPct >= 85
  };
}

/**
 * Calculate how to prepare a target cell suspension from a stock.
 *
 * Uses C1*V1 = C2*V2 dilution formula.
 *
 * @param {Object} opts
 * @param {number} opts.currentConcentration — cells/mL in stock
 * @param {number} opts.targetConcentration  — desired cells/mL
 * @param {number} opts.targetVolumeMl       — desired final volume in mL
 * @returns {Object} dilution plan
 */
function calculateDilutionPlan(opts) {
  if (!opts) throw new Error('Options required');
  validatePositive(opts.currentConcentration, 'currentConcentration');
  validatePositive(opts.targetConcentration, 'targetConcentration');
  validatePositive(opts.targetVolumeMl, 'targetVolumeMl');

  if (opts.targetConcentration > opts.currentConcentration) {
    throw new Error('Target concentration cannot exceed current concentration. Centrifuge and resuspend to concentrate.');
  }

  var stockVolumeMl = (opts.targetConcentration * opts.targetVolumeMl) / opts.currentConcentration;
  var diluentVolumeMl = opts.targetVolumeMl - stockVolumeMl;
  var dilutionRatio = opts.currentConcentration / opts.targetConcentration;
  var totalCellsNeeded = opts.targetConcentration * opts.targetVolumeMl;

  return {
    stockVolumeMl: round(stockVolumeMl, 3),
    diluentVolumeMl: round(diluentVolumeMl, 3),
    finalVolumeMl: opts.targetVolumeMl,
    dilutionRatio: '1:' + round(dilutionRatio, 1),
    totalCellsNeeded: round(totalCellsNeeded, 0),
    currentConcentration: opts.currentConcentration,
    targetConcentration: opts.targetConcentration
  };
}

/**
 * Generate a full cell counting report combining concentration + viability.
 *
 * @param {Object} opts
 * @param {number[]} opts.liveCounts   — live cell counts per square
 * @param {number[]} opts.deadCounts   — dead cell counts per square
 * @param {string}   [opts.chamber]    — chamber type
 * @param {number}   [opts.dilutionFactor] — dilution factor
 * @param {string}   [opts.cellLine]   — cell line name for the report
 * @param {string}   [opts.operator]   — operator name
 * @returns {Object} full counting report
 */
function generateCountingReport(opts) {
  if (!opts) throw new Error('Options required');
  if (!Array.isArray(opts.liveCounts) || opts.liveCounts.length === 0) {
    throw new Error('liveCounts must be a non-empty array');
  }
  if (!Array.isArray(opts.deadCounts)) {
    throw new Error('deadCounts must be an array');
  }
  if (opts.liveCounts.length !== opts.deadCounts.length) {
    throw new Error('liveCounts and deadCounts must have the same length');
  }

  var totalLive = 0;
  var totalDead = 0;
  var totalCounts = [];
  for (var i = 0; i < opts.liveCounts.length; i++) {
    totalLive += opts.liveCounts[i];
    totalDead += opts.deadCounts[i];
    totalCounts.push(opts.liveCounts[i] + opts.deadCounts[i]);
  }

  var liveConc = calculateConcentration({
    counts: opts.liveCounts,
    chamber: opts.chamber,
    dilutionFactor: opts.dilutionFactor
  });

  var totalConc = calculateConcentration({
    counts: totalCounts,
    chamber: opts.chamber,
    dilutionFactor: opts.dilutionFactor
  });

  var viability = calculateViability({
    liveCells: totalLive,
    deadCells: totalDead
  });

  return {
    timestamp: new Date().toISOString(),
    cellLine: opts.cellLine || 'Unknown',
    operator: opts.operator || 'Unknown',
    liveConcentration: liveConc,
    totalConcentration: totalConc,
    viability: viability,
    viableCellsPerMl: liveConc.cellsPerMl,
    summary: liveConc.cellsPerMlFormatted + ' viable (' + viability.viabilityPercent + '% viability)'
  };
}

/* ---------- Factory ---------- */

function createCellCounter() {
  return {
    calculateConcentration: calculateConcentration,
    calculateViability: calculateViability,
    calculateDilutionPlan: calculateDilutionPlan,
    generateCountingReport: generateCountingReport,
    getChamberTypes: function () { return Object.keys(CHAMBER_SPECS); },
    getChamberSpec: function (type) {
      var spec = CHAMBER_SPECS[type];
      if (!spec) throw new Error('Unknown chamber type: ' + type);
      return JSON.parse(JSON.stringify(spec));
    }
  };
}

/* ---------- Exports ---------- */

module.exports = {
  createCellCounter: createCellCounter
};
