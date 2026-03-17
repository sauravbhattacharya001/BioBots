/**
 * Sterility Assurance Calculator — compute sterility assurance levels (SAL),
 * sterilization exposure times, contamination risk scores, and clean room
 * classification recommendations for bioprinting workflows.
 *
 * @module sterilityAssurance
 */
'use strict';

/* ---------- constants ---------- */

var STERILIZATION_METHODS = {
  autoclave: { name: 'Autoclave (Steam)', dValue: 1.5, tempC: 121, unit: 'min', maxLog: 12 },
  dryHeat: { name: 'Dry Heat', dValue: 5.0, tempC: 170, unit: 'min', maxLog: 12 },
  ethyleneOxide: { name: 'Ethylene Oxide (EtO)', dValue: 2.5, tempC: 55, unit: 'min', maxLog: 12 },
  gammaIrradiation: { name: 'Gamma Irradiation', dValue: 2.0, tempC: null, unit: 'kGy', maxLog: 12 },
  uvLight: { name: 'UV-C Light (254nm)', dValue: 4.0, tempC: null, unit: 'min', maxLog: 6 },
  hydrogenPeroxide: { name: 'Hydrogen Peroxide Vapor', dValue: 3.0, tempC: null, unit: 'min', maxLog: 8 },
  filtration: { name: 'Sterile Filtration (0.22µm)', dValue: null, tempC: null, unit: 'pass', maxLog: null }
};

var CLEAN_ROOM_CLASSES = [
  { iso: 5, name: 'ISO 5 (Class 100)', maxParticles: 3520, maxCfu: 1, suitability: ['implantable constructs', 'GMP cell therapy'] },
  { iso: 6, name: 'ISO 6 (Class 1000)', maxParticles: 35200, maxCfu: 7, suitability: ['standard bioprinting', 'tissue engineering research'] },
  { iso: 7, name: 'ISO 7 (Class 10000)', maxParticles: 352000, maxCfu: 10, suitability: ['bioink preparation', 'general lab work'] },
  { iso: 8, name: 'ISO 8 (Class 100000)', maxParticles: 3520000, maxCfu: 100, suitability: ['equipment storage', 'support areas'] }
];

var BIOBURDEN_DEFAULTS = {
  bioink: { typical: 100, description: 'Bioink material' },
  printhead: { typical: 50, description: 'Print nozzle/head' },
  tubing: { typical: 200, description: 'Delivery tubing' },
  substrate: { typical: 10, description: 'Print substrate/plate' },
  cartridge: { typical: 150, description: 'Material cartridge' },
  scaffold: { typical: 30, description: 'Pre-formed scaffold' }
};

var RISK_THRESHOLDS = {
  low: { max: 0.3, label: 'LOW', recommendation: 'Acceptable for most applications' },
  moderate: { max: 0.6, label: 'MODERATE', recommendation: 'Review sterilization cycle; consider additional controls' },
  high: { max: 0.85, label: 'HIGH', recommendation: 'Increase sterilization exposure or add redundant methods' },
  critical: { max: 1.0, label: 'CRITICAL', recommendation: 'Halt production; full sterility validation required' }
};

/* ---------- SAL calculator ---------- */

/**
 * Calculate Sterility Assurance Level (SAL).
 * SAL = 10^(-logReduction) where logReduction = exposureTime / dValue
 *
 * @param {object} opts
 * @param {string} opts.method - sterilization method key
 * @param {number} opts.exposureTime - exposure in method's unit
 * @param {number} [opts.bioburden=100] - initial bioburden (CFU)
 * @param {number} [opts.dValue] - override D-value
 * @returns {object} SAL result
 */
function calculateSAL(opts) {
  if (!opts || !opts.method) throw new Error('method is required');
  var method = STERILIZATION_METHODS[opts.method];
  if (!method) throw new Error('Unknown method: ' + opts.method);
  if (method.dValue === null) throw new Error('SAL calculation not applicable for ' + method.name);

  var exposure = opts.exposureTime;
  if (typeof exposure !== 'number' || exposure <= 0) throw new Error('exposureTime must be a positive number');

  var dVal = opts.dValue || method.dValue;
  var bioburden = opts.bioburden || 100;
  var logReduction = exposure / dVal;
  var sal = Math.pow(10, -logReduction);
  var survivingCfu = bioburden * sal;
  var logSal = -logReduction;

  var grade;
  if (logSal <= -6) grade = 'Excellent (≤10⁻⁶)';
  else if (logSal <= -3) grade = 'Acceptable (≤10⁻³)';
  else grade = 'Insufficient (>10⁻³)';

  return {
    method: method.name,
    dValue: dVal,
    exposureTime: exposure,
    unit: method.unit,
    bioburden: bioburden,
    logReduction: Math.round(logReduction * 1000) / 1000,
    sal: sal,
    salExponent: Math.round(logSal * 1000) / 1000,
    survivingCfu: survivingCfu,
    grade: grade,
    meetsPharmaSAL: logSal <= -6
  };
}

/* ---------- Exposure time calculator ---------- */

/**
 * Calculate required exposure time for a target SAL.
 *
 * @param {object} opts
 * @param {string} opts.method
 * @param {number} [opts.targetSAL=-6] - target SAL exponent (e.g. -6 for 10⁻⁶)
 * @param {number} [opts.bioburden=100]
 * @param {number} [opts.safetyFactor=1.5] - multiplier for overkill approach
 * @returns {object}
 */
function calculateExposureTime(opts) {
  if (!opts || !opts.method) throw new Error('method is required');
  var method = STERILIZATION_METHODS[opts.method];
  if (!method) throw new Error('Unknown method: ' + opts.method);
  if (method.dValue === null) throw new Error('Exposure calculation not applicable for ' + method.name);

  var targetSAL = opts.targetSAL || -6;
  var bioburden = opts.bioburden || 100;
  var safetyFactor = opts.safetyFactor || 1.5;
  var dVal = method.dValue;

  // Total log reduction needed = log10(bioburden) + |targetSAL|
  var logBioburden = Math.log10(bioburden);
  var totalLogReduction = logBioburden + Math.abs(targetSAL);
  var minExposure = totalLogReduction * dVal;
  var recommendedExposure = minExposure * safetyFactor;

  return {
    method: method.name,
    dValue: dVal,
    unit: method.unit,
    bioburden: bioburden,
    targetSAL: '10^' + targetSAL,
    totalLogReductionNeeded: Math.round(totalLogReduction * 1000) / 1000,
    minimumExposure: Math.round(minExposure * 100) / 100,
    recommendedExposure: Math.round(recommendedExposure * 100) / 100,
    safetyFactor: safetyFactor,
    temperatureC: method.tempC
  };
}

/* ---------- Contamination risk scorer ---------- */

/**
 * Score contamination risk for a bioprinting workflow.
 *
 * @param {object} opts
 * @param {Array<{component:string, bioburden:number, sterilized:boolean}>} opts.components
 * @param {number} [opts.cleanRoomISO=7]
 * @param {number} [opts.operatorCount=1]
 * @param {number} [opts.printDurationHours=2]
 * @param {boolean} [opts.asepticTransfer=true]
 * @returns {object}
 */
function assessContaminationRisk(opts) {
  if (!opts) throw new Error('options required');
  var components = opts.components || [];
  var iso = opts.cleanRoomISO || 7;
  var operators = opts.operatorCount || 1;
  var duration = opts.printDurationHours || 2;
  var aseptic = opts.asepticTransfer !== false;

  var factors = [];
  var totalScore = 0;

  // Component bioburden factor (0-0.3)
  var unsterilized = components.filter(function(c) { return !c.sterilized; });
  var componentScore = Math.min(0.3, unsterilized.length * 0.075);
  factors.push({ factor: 'Unsterilized components', score: Math.round(componentScore * 1000) / 1000, detail: unsterilized.length + ' of ' + components.length + ' not sterilized' });
  totalScore += componentScore;

  // Clean room factor (0-0.25)
  var roomScore = Math.max(0, (iso - 5) * 0.083);
  roomScore = Math.min(0.25, roomScore);
  factors.push({ factor: 'Clean room class', score: Math.round(roomScore * 1000) / 1000, detail: 'ISO ' + iso });
  totalScore += roomScore;

  // Operator factor (0-0.2)
  var opScore = Math.min(0.2, (operators - 1) * 0.05);
  factors.push({ factor: 'Operator count', score: Math.round(opScore * 1000) / 1000, detail: operators + ' operator(s)' });
  totalScore += opScore;

  // Duration factor (0-0.15)
  var durScore = Math.min(0.15, (duration / 24) * 0.15);
  factors.push({ factor: 'Print duration', score: Math.round(durScore * 1000) / 1000, detail: duration + ' hours' });
  totalScore += durScore;

  // Transfer factor (0-0.1)
  var transferScore = aseptic ? 0 : 0.1;
  factors.push({ factor: 'Aseptic transfer', score: transferScore, detail: aseptic ? 'Yes' : 'No' });
  totalScore += transferScore;

  totalScore = Math.round(totalScore * 1000) / 1000;

  var riskLevel;
  if (totalScore <= RISK_THRESHOLDS.low.max) riskLevel = RISK_THRESHOLDS.low;
  else if (totalScore <= RISK_THRESHOLDS.moderate.max) riskLevel = RISK_THRESHOLDS.moderate;
  else if (totalScore <= RISK_THRESHOLDS.high.max) riskLevel = RISK_THRESHOLDS.high;
  else riskLevel = RISK_THRESHOLDS.critical;

  return {
    riskScore: totalScore,
    riskLevel: riskLevel.label,
    recommendation: riskLevel.recommendation,
    factors: factors,
    mitigations: generateMitigations(factors, totalScore)
  };
}

function generateMitigations(factors, score) {
  var mitigations = [];
  factors.forEach(function(f) {
    if (f.factor === 'Unsterilized components' && f.score > 0) {
      mitigations.push('Sterilize remaining components before use');
    }
    if (f.factor === 'Clean room class' && f.score > 0.1) {
      mitigations.push('Consider upgrading to a higher ISO class environment');
    }
    if (f.factor === 'Operator count' && f.score > 0) {
      mitigations.push('Minimize personnel in printing area');
    }
    if (f.factor === 'Print duration' && f.score > 0.05) {
      mitigations.push('Implement periodic environmental monitoring during long prints');
    }
    if (f.factor === 'Aseptic transfer' && f.score > 0) {
      mitigations.push('Use aseptic transfer techniques for all material handling');
    }
  });
  return mitigations;
}

/* ---------- Clean room recommender ---------- */

/**
 * Recommend clean room class based on application.
 *
 * @param {object} opts
 * @param {string} opts.application - e.g. 'implantable', 'research', 'gmp', 'general'
 * @param {number} [opts.targetSAL=-6]
 * @param {boolean} [opts.cellBased=true]
 * @returns {object}
 */
function recommendCleanRoom(opts) {
  if (!opts || !opts.application) throw new Error('application is required');
  var app = opts.application.toLowerCase();
  var targetSAL = opts.targetSAL || -6;
  var cellBased = opts.cellBased !== false;

  var recommendedISO;
  if (app === 'implantable' || app === 'gmp') {
    recommendedISO = 5;
  } else if (app === 'research' || app === 'standard') {
    recommendedISO = cellBased ? 6 : 7;
  } else {
    recommendedISO = 7;
  }

  // Stricter SAL requirements may push ISO class lower (stricter)
  if (targetSAL <= -9 && recommendedISO > 5) {
    recommendedISO = Math.max(5, recommendedISO - 1);
  }

  var classInfo = CLEAN_ROOM_CLASSES.find(function(c) { return c.iso === recommendedISO; });

  return {
    application: opts.application,
    targetSAL: '10^' + targetSAL,
    cellBased: cellBased,
    recommendedClass: classInfo,
    allClasses: CLEAN_ROOM_CLASSES,
    additionalControls: getAdditionalControls(app, cellBased)
  };
}

function getAdditionalControls(app, cellBased) {
  var controls = ['HEPA-filtered air supply', 'Regular surface decontamination'];
  if (cellBased) {
    controls.push('Biological safety cabinet for cell handling');
    controls.push('Temperature-controlled environment (20-25°C)');
  }
  if (app === 'implantable' || app === 'gmp') {
    controls.push('Gowning protocol with sterile garments');
    controls.push('Environmental monitoring (settle plates, active air sampling)');
    controls.push('Validated cleaning procedures');
  }
  return controls;
}

/* ---------- Multi-method sterilization planner ---------- */

/**
 * Plan a multi-step sterilization workflow.
 *
 * @param {Array<{component:string, bioburden:number, heatSensitive:boolean, moistureSensitive:boolean}>} components
 * @param {number} [targetSAL=-6]
 * @returns {object}
 */
function planSterilization(components, targetSAL) {
  if (!components || !components.length) throw new Error('At least one component required');
  targetSAL = targetSAL || -6;

  var plan = components.map(function(comp) {
    var method;
    if (comp.heatSensitive && comp.moistureSensitive) {
      method = 'ethyleneOxide';
    } else if (comp.heatSensitive) {
      method = 'hydrogenPeroxide';
    } else if (comp.moistureSensitive) {
      method = 'dryHeat';
    } else {
      method = 'autoclave';
    }

    var exposure = calculateExposureTime({
      method: method,
      targetSAL: targetSAL,
      bioburden: comp.bioburden || BIOBURDEN_DEFAULTS[comp.component] && BIOBURDEN_DEFAULTS[comp.component].typical || 100
    });

    return {
      component: comp.component,
      bioburden: exposure.bioburden,
      method: exposure.method,
      methodKey: method,
      exposure: exposure.recommendedExposure,
      unit: exposure.unit,
      temperatureC: exposure.temperatureC,
      constraints: {
        heatSensitive: !!comp.heatSensitive,
        moistureSensitive: !!comp.moistureSensitive
      }
    };
  });

  // Group by method for efficiency
  var grouped = {};
  plan.forEach(function(step) {
    if (!grouped[step.methodKey]) grouped[step.methodKey] = [];
    grouped[step.methodKey].push(step);
  });

  return {
    targetSAL: '10^' + targetSAL,
    steps: plan,
    groupedByMethod: grouped,
    totalComponents: components.length,
    methodsUsed: Object.keys(grouped).length
  };
}

/* ---------- exports ---------- */

function createSterilityAssurance() {
  return {
    calculateSAL: calculateSAL,
    calculateExposureTime: calculateExposureTime,
    assessContaminationRisk: assessContaminationRisk,
    recommendCleanRoom: recommendCleanRoom,
    planSterilization: planSterilization,
    STERILIZATION_METHODS: STERILIZATION_METHODS,
    CLEAN_ROOM_CLASSES: CLEAN_ROOM_CLASSES,
    BIOBURDEN_DEFAULTS: BIOBURDEN_DEFAULTS,
    RISK_THRESHOLDS: RISK_THRESHOLDS
  };
}

module.exports = { createSterilityAssurance: createSterilityAssurance };
