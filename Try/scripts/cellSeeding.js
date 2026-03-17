/**
 * Cell Seeding Calculator — compute seeding densities, dilution plans,
 * well plate seeding, scaffold geometry, and passage expansion planning
 * for bioprinting workflows.
 *
 * @module cellSeeding
 */
'use strict';

/* ---------- Well plate specifications ---------- */

var WELL_PLATE_SPECS = {
  6:   { wells: 6,   wellAreaCm2: 9.6,   wellVolumeMl: 2.0 },
  12:  { wells: 12,  wellAreaCm2: 3.8,   wellVolumeMl: 1.0 },
  24:  { wells: 24,  wellAreaCm2: 1.9,   wellVolumeMl: 0.5 },
  48:  { wells: 48,  wellAreaCm2: 0.95,  wellVolumeMl: 0.3 },
  96:  { wells: 96,  wellAreaCm2: 0.32,  wellVolumeMl: 0.2 },
  384: { wells: 384, wellAreaCm2: 0.056, wellVolumeMl: 0.05 }
};

/* ---------- Scaffold geometry ---------- */

function scaffoldSurfaceArea(type, dims) {
  switch (type) {
    case 'cylinder':
      if (!dims.radiusCm || dims.radiusCm <= 0 || !dims.heightCm || dims.heightCm <= 0) throw new Error('Dimensions must be positive');
      return 2 * Math.PI * dims.radiusCm * dims.heightCm + 2 * Math.PI * dims.radiusCm * dims.radiusCm;
    case 'cube':
      if (!dims.sideCm || dims.sideCm <= 0) throw new Error('Dimensions must be positive');
      return 6 * dims.sideCm * dims.sideCm;
    case 'rectangle':
      if (!dims.lengthCm || dims.lengthCm <= 0 || !dims.widthCm || dims.widthCm <= 0 || !dims.heightCm || dims.heightCm <= 0) throw new Error('Dimensions must be positive');
      return 2 * (dims.lengthCm * dims.widthCm + dims.lengthCm * dims.heightCm + dims.widthCm * dims.heightCm);
    case 'sphere':
      if (!dims.radiusCm || dims.radiusCm <= 0) throw new Error('Dimensions must be positive');
      return 4 * Math.PI * dims.radiusCm * dims.radiusCm;
    case 'disc':
      if (!dims.radiusCm || dims.radiusCm <= 0) throw new Error('Dimensions must be positive');
      return Math.PI * dims.radiusCm * dims.radiusCm;
    case 'well':
      var spec = WELL_PLATE_SPECS[dims.wellPlate];
      if (!spec) throw new Error('Unknown well plate format: ' + dims.wellPlate);
      var count = dims.wellCount || spec.wells;
      return count * spec.wellAreaCm2;
    default:
      throw new Error('Unknown scaffold type: ' + type);
  }
}

function scaffoldVolume(type, dims) {
  switch (type) {
    case 'cylinder':
      if (!dims.radiusCm || dims.radiusCm <= 0 || !dims.heightCm || dims.heightCm <= 0) throw new Error('Dimensions must be positive');
      return Math.PI * dims.radiusCm * dims.radiusCm * dims.heightCm;
    case 'cube':
      if (!dims.sideCm || dims.sideCm <= 0) throw new Error('Dimensions must be positive');
      return dims.sideCm * dims.sideCm * dims.sideCm;
    case 'sphere':
      if (!dims.radiusCm || dims.radiusCm <= 0) throw new Error('Dimensions must be positive');
      return (4 / 3) * Math.PI * dims.radiusCm * dims.radiusCm * dims.radiusCm;
    case 'well':
      var spec = WELL_PLATE_SPECS[dims.wellPlate];
      if (!spec) throw new Error('Unknown well plate format: ' + dims.wellPlate);
      var count = dims.wellCount || spec.wells;
      return count * spec.wellVolumeMl;
    default:
      throw new Error('Unknown scaffold type: ' + type);
  }
}

/* ---------- Unit conversion ---------- */

var DENSITY_TO_CELLS_PER_ML = {
  'cells/mL': 1,
  'cells/uL': 1000,
  'cells/cm3': 1
};

function convertDensity(value, fromUnit, toUnit, ctx) {
  var cellsPerMl;

  if (fromUnit === 'cells/cm2') {
    if (!ctx || !ctx.volumeMl || !ctx.areaCm2) throw new Error('cells/cm2 conversion requires context with volumeMl and areaCm2');
    cellsPerMl = (value * ctx.areaCm2) / ctx.volumeMl;
  } else if (DENSITY_TO_CELLS_PER_ML[fromUnit] !== undefined) {
    cellsPerMl = value * DENSITY_TO_CELLS_PER_ML[fromUnit];
  } else {
    throw new Error('Unknown density unit: ' + fromUnit);
  }

  if (toUnit === 'cells/cm2') {
    if (!ctx || !ctx.volumeMl || !ctx.areaCm2) throw new Error('cells/cm2 conversion requires context');
    return (cellsPerMl * ctx.volumeMl) / ctx.areaCm2;
  } else if (DENSITY_TO_CELLS_PER_ML[toUnit] !== undefined) {
    return cellsPerMl / DENSITY_TO_CELLS_PER_ML[toUnit];
  } else {
    throw new Error('Unknown density unit: ' + toUnit);
  }
}

/* ---------- Serial dilution ---------- */

function serialDilutionPlan(opts) {
  var stock = opts.stockConcentration;
  var target = opts.targetConcentration;
  var factor = opts.dilutionFactor || 2;
  var volPerTube = opts.volumePerTubeMl || 1.0;

  if (!stock || stock <= 0) throw new Error('stockConcentration must be positive');
  if (!target || target <= 0) throw new Error('targetConcentration must be positive');
  if (target >= stock) throw new Error('targetConcentration must be less than stockConcentration');
  if (factor <= 1) throw new Error('dilutionFactor must be greater than 1');

  var steps = [];
  var conc = stock;
  while (conc > target) {
    var newConc = conc / factor;
    var sampleVol = volPerTube / factor;
    var diluentVol = volPerTube - sampleVol;
    steps.push({
      step: steps.length + 1,
      inputConcentration: conc,
      outputConcentration: newConc,
      sampleVolumeMl: sampleVol,
      diluentVolumeMl: diluentVol,
      totalVolumeMl: volPerTube
    });
    conc = newConc;
  }

  return {
    totalSteps: steps.length,
    steps: steps,
    finalConcentration: conc,
    achievedTarget: conc <= target
  };
}

/* ---------- Well plate seeding ---------- */

function wellPlateSeedingPlan(opts) {
  var spec = WELL_PLATE_SPECS[opts.wellPlate];
  if (!spec) throw new Error('Unknown well plate: ' + opts.wellPlate);

  var wellsToSeed = opts.wellsToSeed || spec.wells;
  var viability = (opts.viabilityPct || 100) / 100;
  var deadVolMult = opts.deadVolumeMultiplier || 1.0;

  var cellsPerWell = (opts.targetDensityCm2 * spec.wellAreaCm2) / viability;
  var totalCells = cellsPerWell * wellsToSeed;
  var volPerWellMl = cellsPerWell / opts.stockConcentration;

  var warnings = [];
  if (volPerWellMl > spec.wellVolumeMl) {
    warnings.push('Seeding volume (' + volPerWellMl.toFixed(3) + ' mL) exceeds well capacity (' + spec.wellVolumeMl + ' mL). Increase stock concentration.');
  }

  return {
    wellPlate: opts.wellPlate,
    wellsToSeed: wellsToSeed,
    wellAreaCm2: spec.wellAreaCm2,
    cellsPerWell: cellsPerWell,
    totalCellsNeeded: totalCells,
    volumePerWellMl: volPerWellMl,
    totalVolumeMl: volPerWellMl * wellsToSeed * deadVolMult,
    deadVolumeMultiplier: deadVolMult,
    warnings: warnings
  };
}

/* ---------- Main seeding plan ---------- */

function seedingPlan(opts) {
  if (!opts.targetDensity || opts.targetDensity <= 0) throw new Error('targetDensity must be positive');
  if (!opts.stockConcentration || opts.stockConcentration <= 0) throw new Error('stockConcentration must be positive');

  var mode = opts.densityMode || 'surface';
  var viability = (opts.viabilityPct || 100) / 100;
  var efficiency = (opts.seedingEfficiencyPct || 100) / 100;
  var replicates = opts.replicates || 1;

  var area = scaffoldSurfaceArea(opts.scaffoldType, opts.dimensions);
  var cellsPerScaffold;

  if (mode === 'volumetric') {
    var vol = scaffoldVolume(opts.scaffoldType, opts.dimensions);
    cellsPerScaffold = opts.targetDensity * vol;
  } else {
    cellsPerScaffold = opts.targetDensity * area;
  }

  var adjustedCells = cellsPerScaffold / (viability * efficiency);
  var totalCells = adjustedCells * replicates;
  var totalVolMl = totalCells / opts.stockConcentration;

  return {
    densityMode: mode,
    scaffoldType: opts.scaffoldType,
    surfaceAreaCm2: area,
    cellsPerScaffold: cellsPerScaffold,
    adjustedCellsPerScaffold: adjustedCells,
    replicates: replicates,
    totalCellsNeeded: totalCells,
    totalSuspensionMl: totalVolMl,
    stockConcentration: opts.stockConcentration,
    viabilityPct: opts.viabilityPct || 100,
    seedingEfficiencyPct: opts.seedingEfficiencyPct || 100
  };
}

/* ---------- Passage expansion ---------- */

function passageExpansionPlan(opts) {
  if (!opts.currentCellCount || opts.currentCellCount <= 0) throw new Error('currentCellCount must be positive');
  if (!opts.targetCellCount || opts.targetCellCount <= 0) throw new Error('targetCellCount must be positive');
  if (!opts.doublingTimeHrs || opts.doublingTimeHrs <= 0) throw new Error('doublingTimeHrs must be positive');

  var splitRatio = opts.splitRatio || 3;
  var flaskCapacity = opts.flaskCapacity || 1e7;
  var confluenceMultiplier = opts.confluenceMultiplier || 4;

  if (opts.currentCellCount >= opts.targetCellCount) {
    return {
      passagesNeeded: 0,
      totalTimeHrs: 0,
      totalTimeDays: 0,
      finalCellCount: opts.currentCellCount,
      passages: []
    };
  }

  var passages = [];
  var cells = opts.currentCellCount;

  while (cells < opts.targetCellCount) {
    var flasks = Math.max(1, Math.ceil(cells / flaskCapacity));
    var seedPerFlask = cells / flasks;
    var harvestPerFlask = seedPerFlask * confluenceMultiplier;
    var cultureTime = opts.doublingTimeHrs * Math.log2(confluenceMultiplier);

    cells = harvestPerFlask * flasks;

    passages.push({
      passage: passages.length + 1,
      flasks: flasks,
      seedPerFlask: seedPerFlask,
      harvestPerFlask: harvestPerFlask,
      totalCells: cells,
      cultureTimeHrs: cultureTime
    });

    // After harvest, seed next passage at 1/splitRatio if we need more
    if (cells < opts.targetCellCount) {
      // cells stay the same (we keep all harvested cells)
    }
  }

  var totalHrs = passages.reduce(function(sum, p) { return sum + p.cultureTimeHrs; }, 0);

  return {
    passagesNeeded: passages.length,
    totalTimeHrs: totalHrs,
    totalTimeDays: totalHrs / 24,
    finalCellCount: cells,
    passages: passages
  };
}

/* ---------- Factory ---------- */

function createCellSeedingCalculator() {
  return {
    seedingPlan: seedingPlan,
    wellPlateSeedingPlan: wellPlateSeedingPlan,
    serialDilutionPlan: serialDilutionPlan,
    passageExpansionPlan: passageExpansionPlan,
    scaffoldSurfaceArea: scaffoldSurfaceArea,
    scaffoldVolume: scaffoldVolume,
    convertDensity: convertDensity,
    WELL_PLATE_SPECS: WELL_PLATE_SPECS
  };
}

/* ---------- Exports ---------- */

module.exports = {
  createCellSeedingCalculator: createCellSeedingCalculator,
  scaffoldSurfaceArea: scaffoldSurfaceArea,
  scaffoldVolume: scaffoldVolume,
  convertDensity: convertDensity,
  serialDilutionPlan: serialDilutionPlan,
  wellPlateSeedingPlan: wellPlateSeedingPlan,
  seedingPlan: seedingPlan,
  passageExpansionPlan: passageExpansionPlan,
  WELL_PLATE_SPECS: WELL_PLATE_SPECS
};
