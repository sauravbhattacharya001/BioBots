/**
 * Spectrophotometer Reading Analyzer — absorbance-based assay interpreter.
 *
 * Supports:
 *   - OD600 cell density estimation (bacterial & yeast cultures)
 *   - Bradford / BCA protein concentration (standard curve interpolation)
 *   - Nucleic acid quantification & purity ratios (A260/A280, A260/A230)
 *   - Beer-Lambert law calculator
 *
 * @module spectrophotometer
 */
'use strict';

/* ---------- Constants ---------- */

var NUCLEIC_ACID_FACTORS = {
  'dsDNA': 50,     // ng/µL per OD at 260 nm
  'ssDNA': 33,
  'RNA':   40
};

var PURITY_RANGES = {
  'dsDNA': { a260a280: [1.8, 2.0], a260a230: [2.0, 2.2] },
  'ssDNA': { a260a280: [1.7, 1.9], a260a230: [2.0, 2.2] },
  'RNA':   { a260a280: [1.9, 2.1], a260a230: [2.0, 2.2] }
};

/* Common organism doubling times at standard conditions (minutes) */
var DEFAULT_OD_COEFFICIENTS = {
  'e.coli':          { cellsPerMlPerOD: 8e8,  linearMax: 0.4 },
  's.cerevisiae':    { cellsPerMlPerOD: 3e7,  linearMax: 0.8 },
  'generic-bacteria':{ cellsPerMlPerOD: 1e9,  linearMax: 0.4 },
  'generic-yeast':   { cellsPerMlPerOD: 3e7,  linearMax: 0.8 },
  'cho':             { cellsPerMlPerOD: 1e6,  linearMax: 1.0 },
  'hek293':          { cellsPerMlPerOD: 1e6,  linearMax: 1.0 }
};

/* ---------- Helpers ---------- */

function validatePositive(val, name) {
  if (typeof val !== 'number' || isNaN(val) || val <= 0) {
    throw new Error(name + ' must be a positive number');
  }
}

function validateNonNegative(val, name) {
  if (typeof val !== 'number' || isNaN(val) || val < 0) {
    throw new Error(name + ' must be a non-negative number');
  }
}

function round(val, decimals) {
  var factor = Math.pow(10, decimals || 4);
  return Math.round(val * factor) / factor;
}

function mean(arr) {
  var sum = 0;
  for (var i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

function stdDev(arr) {
  var m = mean(arr);
  var sqDiffs = 0;
  for (var i = 0; i < arr.length; i++) {
    sqDiffs += (arr[i] - m) * (arr[i] - m);
  }
  return Math.sqrt(sqDiffs / arr.length);
}

/* Simple linear regression: y = slope * x + intercept */
function linearRegression(xVals, yVals) {
  var n = xVals.length;
  var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (var i = 0; i < n; i++) {
    sumX += xVals[i];
    sumY += yVals[i];
    sumXY += xVals[i] * yVals[i];
    sumX2 += xVals[i] * xVals[i];
  }
  var slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  var intercept = (sumY - slope * sumX) / n;

  /* R² */
  var yMean = sumY / n;
  var ssRes = 0, ssTot = 0;
  for (var j = 0; j < n; j++) {
    var predicted = slope * xVals[j] + intercept;
    ssRes += (yVals[j] - predicted) * (yVals[j] - predicted);
    ssTot += (yVals[j] - yMean) * (yVals[j] - yMean);
  }
  var rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope: slope, intercept: intercept, rSquared: rSquared };
}

/* ---------- OD600 Cell Density ---------- */

/**
 * Estimate cell density from OD600 readings.
 *
 * @param {Object} opts
 * @param {number|number[]} opts.od600       — OD600 reading(s); array for replicates
 * @param {string}          [opts.organism]  — organism key (default: 'e.coli')
 * @param {number}          [opts.dilution]  — dilution factor (default: 1)
 * @param {number}          [opts.blankOD]   — blank OD to subtract (default: 0)
 * @returns {Object} cell density estimate
 */
function estimateCellDensity(opts) {
  if (!opts) throw new Error('Options required');

  var readings = Array.isArray(opts.od600) ? opts.od600 : [opts.od600];
  if (readings.length === 0) throw new Error('od600 must be provided');
  for (var i = 0; i < readings.length; i++) {
    if (typeof readings[i] !== 'number' || isNaN(readings[i])) {
      throw new Error('od600 values must be numbers');
    }
  }

  var organism = (opts.organism || 'e.coli').toLowerCase();
  var coeff = DEFAULT_OD_COEFFICIENTS[organism];
  if (!coeff) {
    throw new Error('Unknown organism: ' + organism + '. Supported: ' + Object.keys(DEFAULT_OD_COEFFICIENTS).join(', '));
  }

  var dilution = opts.dilution || 1;
  validatePositive(dilution, 'dilution');

  var blankOD = opts.blankOD || 0;
  validateNonNegative(blankOD, 'blankOD');

  var corrected = [];
  for (var j = 0; j < readings.length; j++) {
    corrected.push(Math.max(0, readings[j] - blankOD));
  }

  var avgOD = round(mean(corrected), 4);
  var sd = readings.length > 1 ? round(stdDev(corrected), 4) : 0;
  var actualOD = avgOD * dilution;
  var cellsPerMl = round(actualOD * coeff.cellsPerMlPerOD, 0);

  var warnings = [];
  if (actualOD > coeff.linearMax) {
    warnings.push('OD ' + round(actualOD, 3) + ' exceeds linear range (' + coeff.linearMax + '). Dilute and re-read for accuracy.');
  }
  if (avgOD < 0.01) {
    warnings.push('Very low OD reading — may be below detection limit.');
  }

  return {
    organism: organism,
    rawReadings: readings,
    blankOD: blankOD,
    correctedMean: avgOD,
    standardDeviation: sd,
    dilutionFactor: dilution,
    effectiveOD: round(actualOD, 4),
    estimatedCellsPerMl: cellsPerMl,
    cellsPerMlPerOD: coeff.cellsPerMlPerOD,
    linearRange: '0 – ' + coeff.linearMax,
    warnings: warnings
  };
}

/* ---------- Nucleic Acid Quantification ---------- */

/**
 * Quantify nucleic acid from spectrophotometer readings.
 *
 * @param {Object} opts
 * @param {number} opts.a260          — absorbance at 260 nm
 * @param {number} opts.a280          — absorbance at 280 nm
 * @param {number} [opts.a230]        — absorbance at 230 nm (optional)
 * @param {string} [opts.type]        — 'dsDNA', 'ssDNA', or 'RNA' (default: 'dsDNA')
 * @param {number} [opts.dilution]    — dilution factor (default: 1)
 * @param {number} [opts.pathlength]  — cuvette path length in cm (default: 1)
 * @param {number} [opts.blankA260]   — blank at 260 (default: 0)
 * @param {number} [opts.blankA280]   — blank at 280 (default: 0)
 * @returns {Object} concentration, purity ratios, quality assessment
 */
function quantifyNucleicAcid(opts) {
  if (!opts) throw new Error('Options required');
  if (typeof opts.a260 !== 'number') throw new Error('a260 is required');
  if (typeof opts.a280 !== 'number') throw new Error('a280 is required');

  var type = (opts.type || 'dsDNA').toLowerCase();
  /* Normalize case */
  if (type === 'dsdna') type = 'dsDNA';
  else if (type === 'ssdna') type = 'ssDNA';
  else if (type === 'rna') type = 'RNA';

  var factor = NUCLEIC_ACID_FACTORS[type];
  if (!factor) throw new Error('Unknown nucleic acid type: ' + type + '. Supported: dsDNA, ssDNA, RNA');

  var dilution = opts.dilution || 1;
  var pathlength = opts.pathlength || 1;
  var blankA260 = opts.blankA260 || 0;
  var blankA280 = opts.blankA280 || 0;

  var corrA260 = opts.a260 - blankA260;
  var corrA280 = opts.a280 - blankA280;
  var corrA230 = opts.a230 != null ? opts.a230 - (opts.blankA230 || 0) : null;

  var concentration = round((corrA260 / pathlength) * factor * dilution, 2); // ng/µL

  var a260a280 = corrA280 > 0 ? round(corrA260 / corrA280, 2) : null;
  var a260a230 = corrA230 != null && corrA230 > 0 ? round(corrA260 / corrA230, 2) : null;

  var purityRange = PURITY_RANGES[type];
  var warnings = [];
  var quality = 'good';

  if (a260a280 !== null) {
    if (a260a280 < purityRange.a260a280[0]) {
      warnings.push('A260/A280 ratio (' + a260a280 + ') below expected range — possible protein contamination.');
      quality = 'contaminated';
    } else if (a260a280 > purityRange.a260a280[1]) {
      warnings.push('A260/A280 ratio (' + a260a280 + ') above expected range — possible RNA contamination or degradation.');
      quality = 'suspect';
    }
  }

  if (a260a230 !== null) {
    if (a260a230 < purityRange.a260a230[0]) {
      warnings.push('A260/A230 ratio (' + a260a230 + ') below expected range — possible organic solvent/salt contamination.');
      if (quality === 'good') quality = 'contaminated';
    }
  }

  if (corrA260 < 0.01) {
    warnings.push('Very low A260 — may be below detection limit.');
  }

  return {
    type: type,
    concentrationNgPerUl: concentration,
    concentrationUgPerMl: round(concentration * 1000 / 1000, 2), // same numerically
    a260a280: a260a280,
    a260a230: a260a230,
    expectedA260A280: purityRange.a260a280[0] + ' – ' + purityRange.a260a280[1],
    expectedA260A230: purityRange.a260a230[0] + ' – ' + purityRange.a260a230[1],
    quality: quality,
    dilutionFactor: dilution,
    pathlengthCm: pathlength,
    warnings: warnings
  };
}

/* ---------- Protein Concentration (Standard Curve) ---------- */

/**
 * Calculate protein concentration from absorbance using a standard curve.
 *
 * @param {Object} opts
 * @param {Object[]} opts.standards            — array of { concentration, absorbance }
 * @param {number|number[]} opts.sampleAbsorbance — sample reading(s)
 * @param {number}  [opts.dilution]            — dilution factor (default: 1)
 * @param {number}  [opts.blankAbsorbance]     — blank to subtract (default: 0)
 * @param {string}  [opts.assayType]           — 'bradford', 'bca', 'lowry', 'custom' (default: 'bradford')
 * @param {string}  [opts.unit]                — concentration unit label (default: 'µg/mL')
 * @returns {Object} concentration, standard curve fit, quality metrics
 */
function calculateProteinConcentration(opts) {
  if (!opts) throw new Error('Options required');
  if (!Array.isArray(opts.standards) || opts.standards.length < 2) {
    throw new Error('At least 2 standards required');
  }

  var blank = opts.blankAbsorbance || 0;
  var dilution = opts.dilution || 1;
  var unit = opts.unit || 'µg/mL';

  /* Build standard curve */
  var xVals = []; // concentrations
  var yVals = []; // absorbances
  for (var i = 0; i < opts.standards.length; i++) {
    var s = opts.standards[i];
    if (typeof s.concentration !== 'number' || typeof s.absorbance !== 'number') {
      throw new Error('Each standard must have concentration and absorbance');
    }
    xVals.push(s.concentration);
    yVals.push(s.absorbance - blank);
  }

  var fit = linearRegression(xVals, yVals);

  var warnings = [];
  if (fit.rSquared < 0.95) {
    warnings.push('R² = ' + round(fit.rSquared, 4) + ' — poor standard curve fit. Check standards.');
  }

  /* Interpolate samples */
  var samples = Array.isArray(opts.sampleAbsorbance) ? opts.sampleAbsorbance : [opts.sampleAbsorbance];
  var results = [];
  for (var j = 0; j < samples.length; j++) {
    var corrAbs = samples[j] - blank;
    var conc = fit.slope !== 0 ? (corrAbs - fit.intercept) / fit.slope : 0;
    conc = conc * dilution;

    var sampleWarnings = [];
    if (conc < 0) sampleWarnings.push('Negative concentration — sample below blank.');
    if (corrAbs > yVals[yVals.length - 1] * 1.1) {
      sampleWarnings.push('Absorbance exceeds standard curve range — dilute and re-read.');
    }

    results.push({
      rawAbsorbance: samples[j],
      correctedAbsorbance: round(corrAbs, 4),
      concentration: round(Math.max(0, conc), 2),
      unit: unit,
      warnings: sampleWarnings
    });
  }

  return {
    assayType: opts.assayType || 'bradford',
    standardCurve: {
      slope: round(fit.slope, 6),
      intercept: round(fit.intercept, 6),
      rSquared: round(fit.rSquared, 4),
      equation: 'A = ' + round(fit.slope, 6) + ' × C + ' + round(fit.intercept, 6)
    },
    dilutionFactor: dilution,
    samples: results,
    warnings: warnings
  };
}

/* ---------- Beer-Lambert Calculator ---------- */

/**
 * Beer-Lambert law: A = ε × c × l
 * Given any two of {absorbance, molarExtinction, concentration, pathlength},
 * calculates the third.
 *
 * @param {Object} opts
 * @param {number} [opts.absorbance]         — measured absorbance
 * @param {number} [opts.molarExtinction]    — molar extinction coefficient (L/(mol·cm))
 * @param {number} [opts.concentration]      — concentration in mol/L
 * @param {number} [opts.pathlength]         — path length in cm (default: 1)
 * @returns {Object} calculated values
 */
function beerLambert(opts) {
  if (!opts) throw new Error('Options required');
  var A = opts.absorbance;
  var e = opts.molarExtinction;
  var c = opts.concentration;
  var l = opts.pathlength || 1;

  validatePositive(l, 'pathlength');

  var solved;
  if (A != null && e != null && c == null) {
    solved = 'concentration';
    c = A / (e * l);
  } else if (A != null && c != null && e == null) {
    solved = 'molarExtinction';
    e = A / (c * l);
  } else if (e != null && c != null && A == null) {
    solved = 'absorbance';
    A = e * c * l;
  } else {
    throw new Error('Provide exactly two of: absorbance, molarExtinction, concentration');
  }

  return {
    solved: solved,
    absorbance: round(A, 6),
    molarExtinction: round(e, 4),
    concentrationMolPerL: round(c, 8),
    pathlengthCm: l,
    formula: 'A = ε × c × l'
  };
}

/* ---------- Factory ---------- */

function createSpectrophotometer() {
  return {
    estimateCellDensity: estimateCellDensity,
    quantifyNucleicAcid: quantifyNucleicAcid,
    calculateProteinConcentration: calculateProteinConcentration,
    beerLambert: beerLambert
  };
}

module.exports = {
  createSpectrophotometer: createSpectrophotometer
};
