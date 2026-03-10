'use strict';

/**
 * Cell Seeding & Density Calculator
 *
 * Calculates cell seeding parameters for bioprinting scaffolds:
 *   1. Target seeding density -> required cell count & suspension volume
 *   2. Serial dilution planner for cell suspensions
 *   3. Scaffold surface area / volume estimation (cylinder, cube, well plate)
 *   4. Cell viability adjustment (compensate for expected loss)
 *   5. Multi-well plate seeding plans with per-well volumes
 *   6. Concentration unit conversions (cells/mL, cells/cm2, cells/cm3)
 *
 * Usage:
 *   const { createCellSeedingCalculator } = require('./cellSeeding');
 *   const calc = createCellSeedingCalculator();
 *   const plan = calc.seedingPlan({
 *     targetDensity: 1e6,       // cells/cm2
 *     scaffoldType: 'cylinder',
 *     dimensions: { radiusCm: 0.5, heightCm: 0.2 },
 *     stockConcentration: 5e6,  // cells/mL
 *     viabilityPct: 90,
 *   });
 */

// -- Geometry helpers ---------------------------------------------------------

var WELL_PLATE_SPECS = {
  6:   { wellDiameterCm: 3.48, wellAreaCm2: 9.50,  wellVolumeMl: 2.0 },
  12:  { wellDiameterCm: 2.22, wellAreaCm2: 3.83,  wellVolumeMl: 1.0 },
  24:  { wellDiameterCm: 1.56, wellAreaCm2: 1.91,  wellVolumeMl: 0.5 },
  48:  { wellDiameterCm: 1.13, wellAreaCm2: 0.95,  wellVolumeMl: 0.3 },
  96:  { wellDiameterCm: 0.64, wellAreaCm2: 0.32,  wellVolumeMl: 0.2 },
  384: { wellDiameterCm: 0.34, wellAreaCm2: 0.056, wellVolumeMl: 0.05 },
};

function scaffoldSurfaceArea(type, dims) {
  switch (type) {
    case 'cylinder': {
      var r = dims.radiusCm, h = dims.heightCm;
      if (r <= 0 || h <= 0) throw new Error('Cylinder dimensions must be positive');
      return 2 * Math.PI * r * h + 2 * Math.PI * r * r;
    }
    case 'cube': {
      var s = dims.sideCm;
      if (s <= 0) throw new Error('Cube side must be positive');
      return 6 * s * s;
    }
    case 'rectangle': {
      var l = dims.lengthCm, w = dims.widthCm, rh = dims.heightCm;
      if (l <= 0 || w <= 0 || rh <= 0) throw new Error('Rectangle dimensions must be positive');
      return 2 * (l * w + l * rh + w * rh);
    }
    case 'sphere': {
      var sr = dims.radiusCm;
      if (sr <= 0) throw new Error('Sphere radius must be positive');
      return 4 * Math.PI * sr * sr;
    }
    case 'disc': {
      var dr = dims.radiusCm;
      if (dr <= 0) throw new Error('Disc radius must be positive');
      return Math.PI * dr * dr;
    }
    case 'well': {
      var spec = WELL_PLATE_SPECS[dims.wellPlate];
      if (!spec) throw new Error('Unknown well plate format: ' + dims.wellPlate + '. Use 6/12/24/48/96/384');
      var count = dims.wellCount || dims.wellPlate;
      return spec.wellAreaCm2 * count;
    }
    default:
      throw new Error('Unknown scaffold type: ' + type + '. Use cylinder/cube/rectangle/sphere/disc/well');
  }
}

function scaffoldVolume(type, dims) {
  switch (type) {
    case 'cylinder': {
      var r = dims.radiusCm, h = dims.heightCm;
      return Math.PI * r * r * h;
    }
    case 'cube': {
      var s = dims.sideCm;
      return s * s * s;
    }
    case 'rectangle': {
      return dims.lengthCm * dims.widthCm * dims.heightCm;
    }
    case 'sphere': {
      var sr = dims.radiusCm;
      return (4 / 3) * Math.PI * sr * sr * sr;
    }
    case 'disc': {
      var dr = dims.radiusCm, t = dims.thicknessCm || 0.1;
      return Math.PI * dr * dr * t;
    }
    case 'well': {
      var spec = WELL_PLATE_SPECS[dims.wellPlate];
      if (!spec) throw new Error('Unknown well plate format: ' + dims.wellPlate);
      return spec.wellVolumeMl * (dims.wellCount || dims.wellPlate);
    }
    default:
      throw new Error('Unknown scaffold type: ' + type);
  }
}

// -- Unit conversion ----------------------------------------------------------

function convertDensity(value, fromUnit, toUnit, context) {
  var cellsPerMl;

  switch (fromUnit) {
    case 'cells/mL':
      cellsPerMl = value;
      break;
    case 'cells/uL':
      cellsPerMl = value * 1000;
      break;
    case 'cells/cm2':
      if (!context || !context.volumeMl || !context.areaCm2) {
        throw new Error('cells/cm2 conversion needs context.volumeMl and context.areaCm2');
      }
      cellsPerMl = (value * context.areaCm2) / context.volumeMl;
      break;
    case 'cells/cm3':
      cellsPerMl = value;
      break;
    case 'M':
      cellsPerMl = value * 6.022e23 / 1000;
      break;
    default:
      throw new Error('Unknown density unit: ' + fromUnit);
  }

  switch (toUnit) {
    case 'cells/mL':
      return cellsPerMl;
    case 'cells/uL':
      return cellsPerMl / 1000;
    case 'cells/cm2':
      if (!context || !context.volumeMl || !context.areaCm2) {
        throw new Error('cells/cm2 conversion needs context.volumeMl and context.areaCm2');
      }
      return (cellsPerMl * context.volumeMl) / context.areaCm2;
    case 'cells/cm3':
      return cellsPerMl;
    default:
      throw new Error('Unknown density unit: ' + toUnit);
  }
}

// -- Serial dilution ----------------------------------------------------------

function serialDilutionPlan(opts) {
  var stockConcentration = opts.stockConcentration;
  var targetConcentration = opts.targetConcentration;
  var dilutionFactor = opts.dilutionFactor || 2;
  var volumePerTubeMl = opts.volumePerTubeMl || 1.0;

  if (stockConcentration <= 0) throw new Error('Stock concentration must be positive');
  if (targetConcentration <= 0) throw new Error('Target concentration must be positive');
  if (targetConcentration >= stockConcentration) {
    throw new Error('Target must be less than stock concentration');
  }
  if (dilutionFactor <= 1) throw new Error('Dilution factor must be > 1');

  var steps = [];
  var currentConc = stockConcentration;
  var step = 0;

  while (currentConc > targetConcentration && step < 20) {
    step++;
    var nextConc = currentConc / dilutionFactor;
    var sampleVolume = volumePerTubeMl / dilutionFactor;
    var diluentVolume = volumePerTubeMl - sampleVolume;

    steps.push({
      step: step,
      inputConcentration: currentConc,
      outputConcentration: nextConc,
      sampleVolumeMl: round(sampleVolume, 4),
      diluentVolumeMl: round(diluentVolume, 4),
      totalVolumeMl: volumePerTubeMl,
    });

    currentConc = nextConc;
  }

  return {
    steps: steps,
    finalConcentration: currentConc,
    totalSteps: steps.length,
    achievedTarget: currentConc <= targetConcentration,
    overallDilution: stockConcentration / currentConc,
  };
}

// -- Well plate seeding plan --------------------------------------------------

function wellPlateSeedingPlan(opts) {
  var wellPlate = opts.wellPlate;
  var targetDensityCm2 = opts.targetDensityCm2;
  var stockConcentration = opts.stockConcentration;
  var viabilityPct = opts.viabilityPct != null ? opts.viabilityPct : 100;
  var wellsToSeed = opts.wellsToSeed;
  var deadVolumeMultiplier = opts.deadVolumeMultiplier || 1.1;

  var spec = WELL_PLATE_SPECS[wellPlate];
  if (!spec) throw new Error('Unknown well plate: ' + wellPlate);

  var wells = wellsToSeed || wellPlate;
  if (wells <= 0 || wells > wellPlate) {
    throw new Error('wellsToSeed must be 1-' + wellPlate);
  }

  var viabilityFraction = Math.min(100, Math.max(1, viabilityPct)) / 100;
  var adjustedDensity = targetDensityCm2 / viabilityFraction;

  var cellsPerWell = adjustedDensity * spec.wellAreaCm2;
  var volumePerWellMl = cellsPerWell / stockConcentration;
  var mediaPerWellMl = Math.max(0, spec.wellVolumeMl - volumePerWellMl);

  var totalCells = cellsPerWell * wells;
  var totalSuspensionMl = volumePerWellMl * wells * deadVolumeMultiplier;
  var totalMediaMl = mediaPerWellMl * wells;

  var warnings = [];
  if (volumePerWellMl > spec.wellVolumeMl) {
    warnings.push('Cell suspension volume (' + round(volumePerWellMl, 3) +
      ' mL) exceeds well capacity (' + spec.wellVolumeMl +
      ' mL). Increase stock concentration or reduce target density.');
  }

  return {
    wellPlate: wellPlate,
    wellsToSeed: wells,
    wellAreaCm2: spec.wellAreaCm2,
    targetDensityCm2: targetDensityCm2,
    adjustedDensityCm2: round(adjustedDensity, 0),
    viabilityPct: viabilityPct,
    cellsPerWell: round(cellsPerWell, 0),
    volumePerWellMl: round(volumePerWellMl, 4),
    mediaPerWellMl: round(mediaPerWellMl, 4),
    totalCellsNeeded: round(totalCells, 0),
    totalSuspensionMl: round(totalSuspensionMl, 4),
    totalMediaMl: round(totalMediaMl, 4),
    deadVolumeMultiplier: deadVolumeMultiplier,
    warnings: warnings,
  };
}

// -- Main seeding plan calculator ---------------------------------------------

function seedingPlan(opts) {
  var targetDensity = opts.targetDensity;
  var densityMode = opts.densityMode || 'surface';
  var scaffoldType = opts.scaffoldType;
  var dimensions = opts.dimensions;
  var stockConcentration = opts.stockConcentration;
  var viabilityPct = opts.viabilityPct != null ? opts.viabilityPct : 100;
  var seedingEfficiencyPct = opts.seedingEfficiencyPct != null ? opts.seedingEfficiencyPct : 100;
  var replicates = opts.replicates || 1;
  var deadVolumeMultiplier = opts.deadVolumeMultiplier || 1.1;

  if (targetDensity <= 0) throw new Error('Target density must be positive');
  if (stockConcentration <= 0) throw new Error('Stock concentration must be positive');

  var area = scaffoldSurfaceArea(scaffoldType, dimensions);
  var volume = scaffoldVolume(scaffoldType, dimensions);

  var viabilityFraction = Math.min(100, Math.max(1, viabilityPct)) / 100;
  var efficiencyFraction = Math.min(100, Math.max(1, seedingEfficiencyPct)) / 100;
  var adjustmentFactor = viabilityFraction * efficiencyFraction;

  var cellsPerScaffold;
  if (densityMode === 'surface') {
    cellsPerScaffold = targetDensity * area;
  } else {
    cellsPerScaffold = targetDensity * volume;
  }

  var adjustedCellsPerScaffold = cellsPerScaffold / adjustmentFactor;
  var suspensionVolumeMl = adjustedCellsPerScaffold / stockConcentration;
  var totalCells = adjustedCellsPerScaffold * replicates;
  var totalVolumeMl = suspensionVolumeMl * replicates * deadVolumeMultiplier;

  return {
    scaffoldType: scaffoldType,
    surfaceAreaCm2: round(area, 4),
    volumeCm3: round(volume, 6),
    densityMode: densityMode,
    targetDensity: targetDensity,
    viabilityPct: viabilityPct,
    seedingEfficiencyPct: seedingEfficiencyPct,
    adjustmentFactor: round(adjustmentFactor, 4),
    cellsPerScaffold: round(cellsPerScaffold, 0),
    adjustedCellsPerScaffold: round(adjustedCellsPerScaffold, 0),
    suspensionVolumeMlPerScaffold: round(suspensionVolumeMl, 4),
    replicates: replicates,
    totalCellsNeeded: round(totalCells, 0),
    totalSuspensionMl: round(totalVolumeMl, 4),
    deadVolumeMultiplier: deadVolumeMultiplier,
    stockConcentration: stockConcentration,
  };
}

// -- Passage expansion plan ---------------------------------------------------

function passageExpansionPlan(opts) {
  var currentCellCount = opts.currentCellCount;
  var targetCellCount = opts.targetCellCount;
  var doublingTimeHrs = opts.doublingTimeHrs;
  var splitRatio = opts.splitRatio || 3;
  var confluencyPct = opts.confluencyPct || 80;
  var flaskAreaCm2 = opts.flaskAreaCm2 || 75;
  var maxDensityCm2 = opts.maxDensityCm2 || 1e5;

  if (currentCellCount <= 0) throw new Error('Current cell count must be positive');
  if (targetCellCount <= 0) throw new Error('Target cell count must be positive');
  if (doublingTimeHrs <= 0) throw new Error('Doubling time must be positive');

  if (currentCellCount >= targetCellCount) {
    return {
      passagesNeeded: 0,
      totalTimeHrs: 0,
      totalTimeDays: 0,
      expansionFactor: 1,
      finalCellCount: currentCellCount,
      passages: [],
    };
  }

  var passages = [];
  var cells = currentCellCount;
  var totalHrs = 0;

  while (cells < targetCellCount && passages.length < 50) {
    var confluencyCells = flaskAreaCm2 * maxDensityCm2 * (confluencyPct / 100);
    var flasksNeeded = Math.ceil(cells / (confluencyCells / splitRatio));
    var seedPerFlask = cells / flasksNeeded;
    var doublingsNeeded = Math.log2(confluencyCells / seedPerFlask);
    var timeHrs = doublingsNeeded * doublingTimeHrs;

    cells = confluencyCells * flasksNeeded;
    totalHrs += timeHrs;

    passages.push({
      passage: passages.length + 1,
      flasks: flasksNeeded,
      seedPerFlask: round(seedPerFlask, 0),
      harvestPerFlask: round(confluencyCells, 0),
      totalCells: round(cells, 0),
      cultureTimeHrs: round(timeHrs, 1),
    });

    if (cells >= targetCellCount) break;
  }

  return {
    passagesNeeded: passages.length,
    totalTimeHrs: round(totalHrs, 1),
    totalTimeDays: round(totalHrs / 24, 1),
    expansionFactor: round(cells / currentCellCount, 1),
    finalCellCount: round(cells, 0),
    passages: passages,
  };
}

// -- Helpers ------------------------------------------------------------------

function round(val, decimals) {
  var f = Math.pow(10, decimals);
  return Math.round(val * f) / f;
}

// -- Factory ------------------------------------------------------------------

function createCellSeedingCalculator() {
  return {
    seedingPlan: function(opts) { return seedingPlan(opts); },
    wellPlateSeedingPlan: function(opts) { return wellPlateSeedingPlan(opts); },
    serialDilutionPlan: function(opts) { return serialDilutionPlan(opts); },
    passageExpansionPlan: function(opts) { return passageExpansionPlan(opts); },
    scaffoldSurfaceArea: function(type, dims) { return scaffoldSurfaceArea(type, dims); },
    scaffoldVolume: function(type, dims) { return scaffoldVolume(type, dims); },
    convertDensity: function(val, from, to, ctx) { return convertDensity(val, from, to, ctx); },
    WELL_PLATE_SPECS: WELL_PLATE_SPECS,
  };
}

module.exports = {
  createCellSeedingCalculator: createCellSeedingCalculator,
  scaffoldSurfaceArea: scaffoldSurfaceArea,
  scaffoldVolume: scaffoldVolume,
  convertDensity: convertDensity,
  serialDilutionPlan: serialDilutionPlan,
  wellPlateSeedingPlan: wellPlateSeedingPlan,
  seedingPlan: seedingPlan,
  passageExpansionPlan: passageExpansionPlan,
  WELL_PLATE_SPECS: WELL_PLATE_SPECS,
};
