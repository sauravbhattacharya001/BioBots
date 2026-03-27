/**
 * Electroporation Protocol Calculator — compute voltage, pulse parameters,
 * and survival estimates for cell electroporation experiments.
 *
 * Supports cuvette and plate-based formats, common cell types, and
 * multi-pulse protocols.
 *
 * @module electroporation
 */
'use strict';

/* ---------- Cuvette specifications ---------- */

var CUVETTE_SPECS = {
  '1mm':  { gapCm: 0.1, volumeUl: 50,  maxVoltagekV: 0.5 },
  '2mm':  { gapCm: 0.2, volumeUl: 200, maxVoltagekV: 1.0 },
  '4mm':  { gapCm: 0.4, volumeUl: 800, maxVoltagekV: 2.5 }
};

/* ---------- Cell type presets ---------- */

var CELL_PRESETS = {
  'HEK293':    { optimalFieldStrengthVcm: 250, optimalPulseMs: 10,  survivalBaseline: 0.85 },
  'CHO':       { optimalFieldStrengthVcm: 300, optimalPulseMs: 10,  survivalBaseline: 0.80 },
  'Jurkat':    { optimalFieldStrengthVcm: 300, optimalPulseMs: 5,   survivalBaseline: 0.70 },
  'HeLa':     { optimalFieldStrengthVcm: 250, optimalPulseMs: 20,  survivalBaseline: 0.80 },
  'NIH3T3':   { optimalFieldStrengthVcm: 350, optimalPulseMs: 10,  survivalBaseline: 0.75 },
  'K562':     { optimalFieldStrengthVcm: 300, optimalPulseMs: 5,   survivalBaseline: 0.75 },
  'primary-T':{ optimalFieldStrengthVcm: 200, optimalPulseMs: 5,   survivalBaseline: 0.65 },
  'MSC':      { optimalFieldStrengthVcm: 200, optimalPulseMs: 10,  survivalBaseline: 0.70 },
  'iPSC':     { optimalFieldStrengthVcm: 150, optimalPulseMs: 5,   survivalBaseline: 0.60 },
  'E.coli':   { optimalFieldStrengthVcm: 1800, optimalPulseMs: 5,  survivalBaseline: 0.50 }
};

/* ---------- Helpers (shared) ---------- */

var _v = require('./validation');
var validatePositive = _v.validatePositive;
var round = _v.round;

/* ---------- Core calculations ---------- */

/**
 * Calculate voltage from desired field strength and gap.
 * E = V / d  →  V = E × d
 */
function fieldStrengthToVoltage(fieldStrengthVcm, gapCm) {
  validatePositive(fieldStrengthVcm, 'fieldStrengthVcm');
  validatePositive(gapCm, 'gapCm');
  return round(fieldStrengthVcm * gapCm, 1);
}

/**
 * Calculate field strength from voltage and gap.
 */
function voltageToFieldStrength(voltageV, gapCm) {
  validatePositive(voltageV, 'voltageV');
  validatePositive(gapCm, 'gapCm');
  return round(voltageV / gapCm, 1);
}

/**
 * Estimate energy delivered per pulse (Joules).
 * For exponential decay: E = 0.5 × C × V²
 * For square wave: E = V² × t / R
 * Using simplified: E ≈ V × I × t (approximation for square wave)
 * We use the capacitor model: E = 0.5 × C × V²
 */
function pulseEnergy(voltageV, capacitanceUf) {
  validatePositive(voltageV, 'voltageV');
  validatePositive(capacitanceUf, 'capacitanceUf');
  var capacitanceF = capacitanceUf * 1e-6;
  return round(0.5 * capacitanceF * voltageV * voltageV, 6);
}

/**
 * Time constant for exponential decay pulse: τ = R × C
 */
function timeConstant(resistanceOhm, capacitanceUf) {
  validatePositive(resistanceOhm, 'resistanceOhm');
  validatePositive(capacitanceUf, 'capacitanceUf');
  var capacitanceF = capacitanceUf * 1e-6;
  return round(resistanceOhm * capacitanceF * 1000, 3); // return ms
}

/**
 * Estimate cell survival based on field strength deviation from optimal.
 * Uses a Gaussian-like decay model.
 */
function estimateSurvival(fieldStrengthVcm, cellType, numPulses) {
  numPulses = numPulses || 1;
  var preset = CELL_PRESETS[cellType];
  if (!preset) {
    throw new Error('Unknown cell type: ' + cellType + '. Available: ' + Object.keys(CELL_PRESETS).join(', '));
  }
  validatePositive(fieldStrengthVcm, 'fieldStrengthVcm');
  validatePositive(numPulses, 'numPulses');

  var optimal = preset.optimalFieldStrengthVcm;
  var deviation = Math.abs(fieldStrengthVcm - optimal) / optimal;
  // Gaussian decay around optimal
  var singlePulseSurvival = preset.survivalBaseline * Math.exp(-2 * deviation * deviation);
  // Multiple pulses reduce survival multiplicatively
  var survival = Math.pow(singlePulseSurvival, Math.pow(numPulses, 0.3));
  return round(Math.max(0, Math.min(1, survival)), 4);
}

/**
 * Estimate transfection efficiency (simplified model).
 * Peaks near optimal field strength, drops off at extremes.
 */
function estimateTransfection(fieldStrengthVcm, cellType, numPulses) {
  numPulses = numPulses || 1;
  var preset = CELL_PRESETS[cellType];
  if (!preset) {
    throw new Error('Unknown cell type: ' + cellType);
  }
  validatePositive(fieldStrengthVcm, 'fieldStrengthVcm');

  var optimal = preset.optimalFieldStrengthVcm;
  var ratio = fieldStrengthVcm / optimal;
  // Bell curve centered at 1.0–1.1× optimal
  var peak = 1.05;
  var efficiency = Math.exp(-4 * Math.pow(ratio - peak, 2));
  // Multiple pulses improve transfection with diminishing returns
  efficiency = 1 - Math.pow(1 - efficiency, Math.pow(numPulses, 0.5));
  return round(Math.max(0, Math.min(1, efficiency)), 4);
}

/* ---------- Protocol builder ---------- */

/**
 * Generate a complete electroporation protocol.
 *
 * @param {Object} opts
 * @param {string} opts.cellType - Cell type key (e.g. 'HEK293')
 * @param {string} [opts.cuvette='2mm'] - Cuvette size ('1mm', '2mm', '4mm')
 * @param {number} [opts.fieldStrengthVcm] - Override field strength (V/cm)
 * @param {number} [opts.numPulses=1] - Number of pulses
 * @param {number} [opts.pulseDurationMs] - Pulse duration in ms
 * @param {number} [opts.cellCountMillion=1] - Cell count in millions
 * @param {number} [opts.dnaMicrograms=10] - DNA amount in µg
 * @param {number} [opts.capacitanceUf=25] - Capacitance in µF (for energy calc)
 * @param {number} [opts.resistanceOhm=200] - Resistance in Ω (for time constant)
 * @returns {Object} Protocol details
 */
function generateProtocol(opts) {
  if (!opts || !opts.cellType) throw new Error('cellType is required');
  var preset = CELL_PRESETS[opts.cellType];
  if (!preset) {
    throw new Error('Unknown cell type: ' + opts.cellType + '. Available: ' + Object.keys(CELL_PRESETS).join(', '));
  }

  var cuvetteKey = opts.cuvette || '2mm';
  var cuvette = CUVETTE_SPECS[cuvetteKey];
  if (!cuvette) {
    throw new Error('Unknown cuvette: ' + cuvetteKey + '. Available: ' + Object.keys(CUVETTE_SPECS).join(', '));
  }

  var fieldStrength = opts.fieldStrengthVcm || preset.optimalFieldStrengthVcm;
  var numPulses = opts.numPulses || 1;
  var pulseDuration = opts.pulseDurationMs || preset.optimalPulseMs;
  var cellCount = opts.cellCountMillion || 1;
  var dna = opts.dnaMicrograms || 10;
  var capacitance = opts.capacitanceUf || 25;
  var resistance = opts.resistanceOhm || 200;

  var voltage = fieldStrengthToVoltage(fieldStrength, cuvette.gapCm);
  var energy = pulseEnergy(voltage, capacitance);
  var tau = timeConstant(resistance, capacitance);
  var survival = estimateSurvival(fieldStrength, opts.cellType, numPulses);
  var transfection = estimateTransfection(fieldStrength, opts.cellType, numPulses);
  var dnaPerCell = round(dna / (cellCount * 1e6) * 1e6, 4); // pg per cell

  var warnings = [];
  if (voltage > cuvette.maxVoltagekV * 1000) {
    warnings.push('Voltage (' + voltage + ' V) exceeds cuvette max (' + (cuvette.maxVoltagekV * 1000) + ' V)');
  }
  if (survival < 0.3) {
    warnings.push('Estimated survival is low (' + (survival * 100) + '%). Consider reducing field strength or pulse count.');
  }
  if (fieldStrength > preset.optimalFieldStrengthVcm * 1.5) {
    warnings.push('Field strength significantly exceeds optimal for ' + opts.cellType);
  }

  return {
    cellType: opts.cellType,
    cuvette: cuvetteKey,
    cuvetteGapCm: cuvette.gapCm,
    cuvetteVolumeUl: cuvette.volumeUl,
    fieldStrengthVcm: fieldStrength,
    voltageV: voltage,
    numPulses: numPulses,
    pulseDurationMs: pulseDuration,
    capacitanceUf: capacitance,
    resistanceOhm: resistance,
    pulseEnergyJ: energy,
    timeConstantMs: tau,
    cellCountMillion: cellCount,
    dnaMicrograms: dna,
    dnaPerCellPg: dnaPerCell,
    estimatedSurvival: survival,
    estimatedTransfection: transfection,
    warnings: warnings
  };
}

/**
 * Compare protocols across different parameters.
 */
function compareProtocols(baseOpts, variations) {
  if (!Array.isArray(variations) || variations.length === 0) {
    throw new Error('variations must be a non-empty array of override objects');
  }
  var baseline = generateProtocol(baseOpts);
  var results = variations.map(function (v) {
    var merged = {};
    for (var k in baseOpts) { if (baseOpts.hasOwnProperty(k)) merged[k] = baseOpts[k]; }
    for (var k2 in v) { if (v.hasOwnProperty(k2)) merged[k2] = v[k2]; }
    return generateProtocol(merged);
  });
  return { baseline: baseline, variations: results };
}

/**
 * List available cell type presets.
 */
function listCellPresets() {
  return Object.keys(CELL_PRESETS).map(function (key) {
    var p = CELL_PRESETS[key];
    return {
      cellType: key,
      optimalFieldStrengthVcm: p.optimalFieldStrengthVcm,
      optimalPulseMs: p.optimalPulseMs,
      survivalBaseline: p.survivalBaseline
    };
  });
}

/**
 * List available cuvette sizes.
 */
function listCuvettes() {
  return Object.keys(CUVETTE_SPECS).map(function (key) {
    var s = CUVETTE_SPECS[key];
    return {
      size: key,
      gapCm: s.gapCm,
      volumeUl: s.volumeUl,
      maxVoltagekV: s.maxVoltagekV
    };
  });
}

/* ---------- Factory ---------- */

function createElectroporationCalculator() {
  return {
    fieldStrengthToVoltage: fieldStrengthToVoltage,
    voltageToFieldStrength: voltageToFieldStrength,
    pulseEnergy: pulseEnergy,
    timeConstant: timeConstant,
    estimateSurvival: estimateSurvival,
    estimateTransfection: estimateTransfection,
    generateProtocol: generateProtocol,
    compareProtocols: compareProtocols,
    listCellPresets: listCellPresets,
    listCuvettes: listCuvettes
  };
}

exports.createElectroporationCalculator = createElectroporationCalculator;
