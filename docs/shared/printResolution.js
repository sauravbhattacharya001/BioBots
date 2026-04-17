'use strict';

var _sanitize = require('./sanitize');
var round = require('./validation').round;

/**
 * Print Resolution Calculator
 *
 * Predicts achievable print resolution from nozzle, pressure, speed, and
 * bioink parameters.  Helps researchers plan experiments by estimating:
 *
 *  - Strand diameter (die-swell adjusted Hagen-Poiseuille)
 *  - Minimum feature size (strand spacing + overlap)
 *  - Layer resolution (spread ratio)
 *  - Volumetric flow rate
 *  - Print fidelity score (0-100)
 *  - Multi-config comparison & optimal config selection
 *
 * Physics model (simplified extrusion bioprinting):
 *   Q  = (π × ΔP × R⁴) / (8 × η × L)          Hagen-Poiseuille
 *   v_exit = Q / (π × R²)
 *   d_strand = 2R × swell × √(v_exit / v_stage)  mass conservation + swell
 *   layer_h ≈ d_strand × spread_ratio
 *
 * @module printResolution
 */

// ── Constants ──────────────────────────────────────────────────────────

var SWELL_RATIOS = {
  alginate:       1.10,
  gelatin:        1.15,
  collagen:       1.12,
  fibrin:         1.08,
  hyaluronic:     1.14,
  peg:            1.06,
  pcl:            1.20,
  pluronic:       1.18,
  silk:           1.11,
  chitosan:       1.13,
  matrigel:       1.09,
  custom:         1.12
};

var VISCOSITY_PRESETS = {
  alginate:       0.8,
  gelatin:        0.5,
  collagen:       1.2,
  fibrin:         0.3,
  hyaluronic:     1.5,
  peg:            0.15,
  pcl:            50.0,
  pluronic:       0.25,
  silk:           0.9,
  chitosan:       1.1,
  matrigel:       0.4
};

var NOZZLE_GAUGES = {
  '18G': 0.838,
  '20G': 0.603,
  '22G': 0.413,
  '25G': 0.260,
  '27G': 0.210,
  '30G': 0.159,
  '32G': 0.108
};

var SPREAD_RATIO_DEFAULT = 0.70;
var OVERLAP_FRACTION_DEFAULT = 0.10;
var NOZZLE_LENGTH_DEFAULT = 12.7;

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Validate that a value is a positive number.
 *
 * @param {*} val - Value to check.
 * @param {string} name - Parameter name (for error messages).
 * @throws {Error} If val is not a positive finite number.
 * @private
 */
var _v = require('./validation');
var validatePositive = _v.validatePositive;
var clamp = _v.clamp;

/**
 * Resolve nozzle inner diameter from either a direct value or gauge string.
 *
 * @param {Object} opts - Options containing nozzleDiameter (mm) or gauge (e.g. '22G').
 * @returns {number} Nozzle inner diameter in mm.
 * @throws {Error} If neither nozzleDiameter nor a valid gauge is provided.
 * @private
 */
function resolveNozzleDiameter(opts) {
  if (typeof opts.nozzleDiameter === 'number') {
    validatePositive(opts.nozzleDiameter, 'nozzleDiameter');
    return opts.nozzleDiameter;
  }
  if (typeof opts.gauge === 'string') {
    var d = NOZZLE_GAUGES[opts.gauge.toUpperCase()] || NOZZLE_GAUGES[opts.gauge];
    if (!d) throw new Error('Unknown gauge: ' + opts.gauge + '. Use one of: ' + Object.keys(NOZZLE_GAUGES).join(', '));
    return d;
  }
  throw new Error('Provide nozzleDiameter (mm) or gauge (e.g. "22G")');
}

/**
 * Clamp a value to a [lo, hi] range.
 *
 * @param {number} v - Value to clamp.
 * @param {number} lo - Lower bound.
 * @param {number} hi - Upper bound.
 * @returns {number} Clamped value.
// ── Core calculator ────────────────────────────────────────────────────

/**
 * Calculate print resolution metrics for extrusion bioprinting.
 *
 * Uses Hagen-Poiseuille flow, mass conservation with die-swell correction,
 * and empirical fidelity scoring to predict strand diameter, layer height,
 * minimum feature size, and volumetric flow rate.
 *
 * @param {Object} opts - Print parameters.
 * @param {number} [opts.nozzleDiameter] - Nozzle inner diameter (mm). Provide this or gauge.
 * @param {string} [opts.gauge] - Nozzle gauge string (e.g. '22G'). Alternative to nozzleDiameter.
 * @param {number} opts.pressure - Extrusion pressure (kPa).
 * @param {number} opts.stageSpeed - Stage/print-head speed (mm/s). Alias: opts.speed.
 * @param {string} [opts.material='custom'] - Material name for viscosity/swell presets.
 * @param {number} [opts.viscosity] - Bioink viscosity (Pa·s). Overrides material preset.
 * @param {number} [opts.swellRatio] - Die swell ratio. Overrides material preset.
 * @param {number} [opts.nozzleLength=12.7] - Nozzle length (mm).
 * @param {number} [opts.spreadRatio=0.70] - Layer spread ratio (layer height / strand diameter).
 * @param {number} [opts.overlapFraction=0.10] - Strand overlap fraction for feature size calculation.
 * @returns {Object} Resolution analysis including strandDiameter_mm, layerHeight_mm,
 *   minFeatureSize_mm, flowRate_uL_s, fidelityScore (0–100), and resolutionClass.
 * @throws {Error} If required parameters are missing or invalid.
 */
function calculateResolution(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('Options object required');

  var nozzleDia = resolveNozzleDiameter(opts);                     // mm
  var R = nozzleDia / 2;                                            // mm
  var R_m = R / 1000;                                               // m
  var pressure = opts.pressure;                                     // kPa
  validatePositive(pressure, 'pressure');
  var P_Pa = pressure * 1000;                                       // Pa

  var stageSpeed = opts.stageSpeed || opts.speed;                   // mm/s
  validatePositive(stageSpeed, 'stageSpeed');
  var v_stage = stageSpeed / 1000;                                  // m/s

  var material = (opts.material || 'custom').toLowerCase();
  var viscosity = opts.viscosity || VISCOSITY_PRESETS[material];     // Pa·s
  if (!viscosity) throw new Error('Provide viscosity (Pa·s) or a known material');
  validatePositive(viscosity, 'viscosity');

  var swellRatio = opts.swellRatio || SWELL_RATIOS[material] || SWELL_RATIOS.custom;
  var nozzleLength = opts.nozzleLength || NOZZLE_LENGTH_DEFAULT;    // mm
  var L_m = nozzleLength / 1000;                                    // m
  var spreadRatio = opts.spreadRatio || SPREAD_RATIO_DEFAULT;
  var overlapFraction = opts.overlapFraction != null ? opts.overlapFraction : OVERLAP_FRACTION_DEFAULT;

  // Hagen-Poiseuille flow rate
  var Q = (Math.PI * P_Pa * Math.pow(R_m, 4)) / (8 * viscosity * L_m);  // m³/s
  var Q_uL_s = Q * 1e9;                                             // µL/s

  // Exit velocity
  var A_nozzle = Math.PI * R_m * R_m;
  var v_exit = Q / A_nozzle;                                        // m/s

  // Strand diameter (mass conservation + die swell)
  var speedRatio = v_exit / v_stage;
  var strandDia = nozzleDia * swellRatio * Math.sqrt(Math.max(speedRatio, 0.01)); // mm

  // Layer height
  var layerHeight = strandDia * spreadRatio;                         // mm

  // Minimum feature size (two strands side-by-side with overlap)
  var strandSpacing = strandDia * (1 - overlapFraction);
  var minFeatureSize = strandSpacing + strandDia;                    // mm (width of smallest wall = 2 strands)

  // Fidelity score (0-100) — lower strand-to-nozzle ratio is better
  var expansion = strandDia / nozzleDia;
  var fidelity = clamp(100 - (Math.abs(expansion - 1) * 80) - (speedRatio > 3 ? 20 : 0), 0, 100);

  // Resolution class
  var resClass;
  if (strandDia < 0.15) resClass = 'ultra-fine';
  else if (strandDia < 0.3) resClass = 'fine';
  else if (strandDia < 0.6) resClass = 'standard';
  else if (strandDia < 1.0) resClass = 'coarse';
  else resClass = 'macro';

  // Shear rate at wall (for shear-thinning reference)
  var shearRate = (4 * Q) / (Math.PI * Math.pow(R_m, 3));           // 1/s

  return {
    nozzleDiameter:   round(nozzleDia, 4),
    material:         material,
    pressure_kPa:     round(pressure, 4),
    stageSpeed_mm_s:  round(stageSpeed, 4),
    viscosity_Pa_s:   round(viscosity, 4),
    swellRatio:       round(swellRatio, 4),
    flowRate_uL_s:    round(Q_uL_s, 4),
    exitVelocity_mm_s:round(v_exit * 1000, 4),
    strandDiameter_mm:round(strandDia, 4),
    layerHeight_mm:   round(layerHeight, 4),
    minFeatureSize_mm:round(minFeatureSize, 4),
    strandSpacing_mm: round(strandSpacing, 4),
    shearRate_1_s:    round(shearRate, 4),
    fidelityScore:    Math.round(fidelity),
    resolutionClass:  resClass
  };
}

/**
 * Round a number to 4 decimal places.
 *
 * @param {number} v - Value to round.
 * @returns {number} Rounded value.
 * @private - now imported from validation.js
 */

/**
 * Compare multiple print configurations and rank by quality.
 *
 * Runs {@link calculateResolution} on each config, then ranks by
 * fidelity score (descending) and strand diameter (ascending). Also
 * identifies the finest-resolution configuration.
 *
 * @param {Object[]} configs - Array of config objects (each passed to calculateResolution).
 *   Each may include an optional `label` string for identification.
 * @returns {Object} Comparison report with results (in input order), ranked (by quality),
 *   best (top-ranked), and finest (smallest strand diameter).
 * @throws {Error} If fewer than 2 configurations are provided.
 */
function compareConfigs(configs) {
  if (!Array.isArray(configs) || configs.length < 2) {
    throw new Error('Provide an array of at least 2 config objects');
  }
  var results = configs.map(function (c, i) {
    var r = calculateResolution(c);
    r._index = i;
    r._label = c.label || 'Config ' + (i + 1);
    return r;
  });

  // Sort by fidelity desc, then strand diameter asc
  var ranked = results.slice().sort(function (a, b) {
    if (b.fidelityScore !== a.fidelityScore) return b.fidelityScore - a.fidelityScore;
    return a.strandDiameter_mm - b.strandDiameter_mm;
  });

  return {
    results: results,
    ranked: ranked,
    best: ranked[0],
    finest: results.slice().sort(function (a, b) { return a.strandDiameter_mm - b.strandDiameter_mm; })[0]
  };
}

// ── Optimal config finder ──────────────────────────────────────────────

/**
 * Find the optimal extrusion pressure to achieve a target strand diameter.
 *
 * Performs a brute-force sweep over the pressure range (200 steps) and
 * returns the configuration that produces a strand diameter closest to
 * the target.
 *
 * @param {Object} opts - Base print parameters (same as calculateResolution), plus:
 * @param {number} [opts.minPressure=10] - Lower pressure bound (kPa).
 * @param {number} [opts.maxPressure=300] - Upper pressure bound (kPa).
 * @param {number} opts.targetStrandDiameter - Desired strand diameter (mm).
 * @returns {Object} Result with optimalResult (full resolution analysis at best pressure),
 *   targetStrandDiameter_mm, achievedStrandDiameter_mm, and deviation_mm.
 * @throws {Error} If targetStrandDiameter is not a positive number.
 */
function findOptimalPressure(opts) {
  if (!opts || typeof opts !== 'object') throw new Error('Options object required');
  var minP = opts.minPressure || 10;
  var maxP = opts.maxPressure || 300;
  var targetStrand = opts.targetStrandDiameter;
  validatePositive(targetStrand, 'targetStrandDiameter');

  // Sanitize once outside the search loop instead of on every iteration.
  // The old brute-force sweep called stripDangerousKeys 200 times and
  // evaluated calculateResolution at every step. Since strand diameter
  // is monotonically increasing with pressure (Hagen-Poiseuille: Q ∝ P,
  // strand ∝ √Q), we use binary search to converge in ~30 iterations
  // instead of 200, a ~6× reduction in compute.
  var baseCfg = _sanitize.stripDangerousKeys(opts);

  // Helper: evaluate strand diameter at a given pressure
  function evalAt(p) {
    baseCfg.pressure = p;
    return calculateResolution(baseCfg);
  }

  // Binary search exploiting monotonicity: higher pressure → wider strand
  var lo = minP, hi = maxP;
  var bestResult = null;
  var bestDiff = Infinity;

  for (var iter = 0; iter < 30; iter++) {
    var mid = (lo + hi) / 2;
    var r = evalAt(mid);
    var diff = Math.abs(r.strandDiameter_mm - targetStrand);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestResult = r;
    }
    // If achieved strand is too small, increase pressure; otherwise decrease
    if (r.strandDiameter_mm < targetStrand) {
      lo = mid;
    } else {
      hi = mid;
    }
    // Early exit when close enough (sub-micron precision)
    if (bestDiff < 0.001) break;
  }

  return {
    optimalResult: bestResult,
    targetStrandDiameter_mm: targetStrand,
    achievedStrandDiameter_mm: bestResult.strandDiameter_mm,
    deviation_mm: round(bestDiff, 4)
  };
}

// ── Text report ────────────────────────────────────────────────────────

/**
 * Format a resolution analysis result as a human-readable text report.
 *
 * @param {Object} result - Output from {@link calculateResolution}.
 * @returns {string} Multi-line plain-text report.
 */
function formatReport(result) {
  var lines = [
    '=== Print Resolution Report ===',
    '',
    'Material:          ' + result.material,
    'Nozzle:            ' + result.nozzleDiameter + ' mm',
    'Pressure:          ' + result.pressure_kPa + ' kPa',
    'Stage speed:       ' + result.stageSpeed_mm_s + ' mm/s',
    'Viscosity:         ' + result.viscosity_Pa_s + ' Pa·s',
    'Swell ratio:       ' + result.swellRatio,
    '',
    '--- Results ---',
    'Flow rate:         ' + result.flowRate_uL_s + ' µL/s',
    'Exit velocity:     ' + result.exitVelocity_mm_s + ' mm/s',
    'Strand diameter:   ' + result.strandDiameter_mm + ' mm',
    'Layer height:      ' + result.layerHeight_mm + ' mm',
    'Min feature size:  ' + result.minFeatureSize_mm + ' mm',
    'Strand spacing:    ' + result.strandSpacing_mm + ' mm',
    'Shear rate:        ' + result.shearRate_1_s + ' 1/s',
    'Fidelity score:    ' + result.fidelityScore + ' / 100',
    'Resolution class:  ' + result.resolutionClass,
    ''
  ];
  return lines.join('\n');
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Create a Print Resolution Calculator instance.
 *
 * Exposes methods for single-config analysis, multi-config comparison,
 * optimal pressure search, and report formatting, plus reference data
 * (nozzle gauges, swell ratios, viscosity presets).
 *
 * @returns {Object} Calculator API with calculate, compare, findOptimalPressure,
 *   formatReport, and reference constant objects.
 */
function createPrintResolutionCalculator() {
  return {
    calculate:           calculateResolution,
    compare:             compareConfigs,
    findOptimalPressure: findOptimalPressure,
    formatReport:        formatReport,
    NOZZLE_GAUGES:       NOZZLE_GAUGES,
    SWELL_RATIOS:        SWELL_RATIOS,
    VISCOSITY_PRESETS:   VISCOSITY_PRESETS
  };
}

module.exports = { createPrintResolutionCalculator: createPrintResolutionCalculator };

