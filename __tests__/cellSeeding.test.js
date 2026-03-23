'use strict';

var cs = require('../docs/shared/cellSeeding');
var createCellSeedingCalculator = cs.createCellSeedingCalculator;
var scaffoldSurfaceArea = cs.scaffoldSurfaceArea;
var scaffoldVolume = cs.scaffoldVolume;
var convertDensity = cs.convertDensity;
var serialDilutionPlan = cs.serialDilutionPlan;
var wellPlateSeedingPlan = cs.wellPlateSeedingPlan;
var seedingPlan = cs.seedingPlan;
var passageExpansionPlan = cs.passageExpansionPlan;
var WELL_PLATE_SPECS = cs.WELL_PLATE_SPECS;

// -- Scaffold geometry --------------------------------------------------------

describe('scaffoldSurfaceArea', function() {
  test('cylinder surface area', function() {
    var area = scaffoldSurfaceArea('cylinder', { radiusCm: 0.5, heightCm: 1.0 });
    expect(area).toBeCloseTo(2 * Math.PI * 0.5 * 1 + 2 * Math.PI * 0.25, 4);
  });

  test('cube surface area', function() {
    expect(scaffoldSurfaceArea('cube', { sideCm: 2.0 })).toBeCloseTo(24.0, 4);
  });

  test('rectangle surface area', function() {
    var area = scaffoldSurfaceArea('rectangle', { lengthCm: 3, widthCm: 2, heightCm: 1 });
    expect(area).toBeCloseTo(22.0, 4);
  });

  test('sphere surface area', function() {
    var area = scaffoldSurfaceArea('sphere', { radiusCm: 1.0 });
    expect(area).toBeCloseTo(4 * Math.PI, 4);
  });

  test('disc surface area (top only)', function() {
    var area = scaffoldSurfaceArea('disc', { radiusCm: 1.0 });
    expect(area).toBeCloseTo(Math.PI, 4);
  });

  test('well plate surface area', function() {
    var area = scaffoldSurfaceArea('well', { wellPlate: 96, wellCount: 96 });
    expect(area).toBeCloseTo(96 * 0.32, 2);
  });

  test('throws on negative dimensions', function() {
    expect(function() { scaffoldSurfaceArea('cylinder', { radiusCm: -1, heightCm: 1 }); }).toThrow();
    expect(function() { scaffoldSurfaceArea('cube', { sideCm: 0 }); }).toThrow();
  });

  test('throws on unknown type', function() {
    expect(function() { scaffoldSurfaceArea('hexagon', {}); }).toThrow(/Unknown scaffold type/);
  });
});

describe('scaffoldVolume', function() {
  test('cylinder volume', function() {
    var vol = scaffoldVolume('cylinder', { radiusCm: 1.0, heightCm: 2.0 });
    expect(vol).toBeCloseTo(2 * Math.PI, 4);
  });

  test('cube volume', function() {
    expect(scaffoldVolume('cube', { sideCm: 3.0 })).toBeCloseTo(27.0, 4);
  });

  test('sphere volume', function() {
    var vol = scaffoldVolume('sphere', { radiusCm: 1.0 });
    expect(vol).toBeCloseTo((4/3) * Math.PI, 4);
  });

  test('well plate volume', function() {
    var vol = scaffoldVolume('well', { wellPlate: 24, wellCount: 12 });
    expect(vol).toBeCloseTo(12 * 0.5, 2);
  });
});

// -- Unit conversion ----------------------------------------------------------

describe('convertDensity', function() {
  test('cells/mL to cells/uL', function() {
    expect(convertDensity(1e6, 'cells/mL', 'cells/uL')).toBeCloseTo(1000, 0);
  });

  test('cells/uL to cells/mL', function() {
    expect(convertDensity(500, 'cells/uL', 'cells/mL')).toBeCloseTo(5e5, 0);
  });

  test('cells/cm3 to cells/mL', function() {
    expect(convertDensity(1e6, 'cells/cm3', 'cells/mL')).toBeCloseTo(1e6, 0);
  });

  test('cells/cm2 needs context', function() {
    var ctx = { volumeMl: 1.0, areaCm2: 2.0 };
    var result = convertDensity(5e5, 'cells/cm2', 'cells/mL', ctx);
    expect(result).toBeCloseTo(1e6, 0);
  });

  test('cells/cm2 without context throws', function() {
    expect(function() { convertDensity(1e5, 'cells/cm2', 'cells/mL'); }).toThrow();
  });

  test('unknown unit throws', function() {
    expect(function() { convertDensity(100, 'cells/L', 'cells/mL'); }).toThrow(/Unknown density unit/);
  });
});

// -- Serial dilution ----------------------------------------------------------

describe('serialDilutionPlan', function() {
  test('basic 1:2 dilution', function() {
    var plan = serialDilutionPlan({
      stockConcentration: 1e6,
      targetConcentration: 1e5,
      dilutionFactor: 2,
      volumePerTubeMl: 1.0,
    });
    expect(plan.totalSteps).toBeGreaterThanOrEqual(3);
    expect(plan.achievedTarget).toBe(true);
    expect(plan.finalConcentration).toBeLessThanOrEqual(1e5);
  });

  test('each step halves concentration', function() {
    var plan = serialDilutionPlan({
      stockConcentration: 1e6,
      targetConcentration: 1e4,
      dilutionFactor: 2,
    });
    for (var i = 0; i < plan.steps.length; i++) {
      var s = plan.steps[i];
      expect(s.outputConcentration).toBeCloseTo(s.inputConcentration / 2, 0);
    }
  });

  test('1:10 dilution uses fewer steps', function() {
    var plan = serialDilutionPlan({
      stockConcentration: 1e8,
      targetConcentration: 1e4,
      dilutionFactor: 10,
    });
    expect(plan.totalSteps).toBe(4);
  });

  test('volumes add up', function() {
    var plan = serialDilutionPlan({
      stockConcentration: 1e6,
      targetConcentration: 1e5,
      volumePerTubeMl: 2.0,
      dilutionFactor: 2,
    });
    plan.steps.forEach(function(s) {
      expect(s.sampleVolumeMl + s.diluentVolumeMl).toBeCloseTo(s.totalVolumeMl, 4);
    });
  });

  test('throws on invalid inputs', function() {
    expect(function() { serialDilutionPlan({ stockConcentration: 0, targetConcentration: 100 }); }).toThrow();
    expect(function() { serialDilutionPlan({ stockConcentration: 100, targetConcentration: 200 }); }).toThrow();
    expect(function() { serialDilutionPlan({ stockConcentration: 100, targetConcentration: 10, dilutionFactor: 0.5 }); }).toThrow();
  });
});

// -- Well plate seeding -------------------------------------------------------

describe('wellPlateSeedingPlan', function() {
  test('96-well plate basic', function() {
    var plan = wellPlateSeedingPlan({
      wellPlate: 96,
      targetDensityCm2: 1e4,
      stockConcentration: 1e6,
    });
    expect(plan.wellsToSeed).toBe(96);
    expect(plan.cellsPerWell).toBeCloseTo(1e4 * 0.32, 0);
    expect(plan.totalCellsNeeded).toBeGreaterThan(0);
    expect(plan.warnings).toHaveLength(0);
  });

  test('partial plate seeding', function() {
    var plan = wellPlateSeedingPlan({
      wellPlate: 24,
      targetDensityCm2: 5e4,
      stockConcentration: 2e6,
      wellsToSeed: 12,
    });
    expect(plan.wellsToSeed).toBe(12);
  });

  test('viability adjustment increases cells needed', function() {
    var full = wellPlateSeedingPlan({
      wellPlate: 6,
      targetDensityCm2: 1e5,
      stockConcentration: 1e7,
      viabilityPct: 100,
    });
    var partial = wellPlateSeedingPlan({
      wellPlate: 6,
      targetDensityCm2: 1e5,
      stockConcentration: 1e7,
      viabilityPct: 80,
    });
    expect(partial.cellsPerWell).toBeGreaterThan(full.cellsPerWell);
  });

  test('warns when volume exceeds well capacity', function() {
    var plan = wellPlateSeedingPlan({
      wellPlate: 384,
      targetDensityCm2: 1e6,
      stockConcentration: 1e5,
    });
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  test('dead volume multiplier', function() {
    var plan = wellPlateSeedingPlan({
      wellPlate: 96,
      targetDensityCm2: 1e4,
      stockConcentration: 1e6,
      deadVolumeMultiplier: 1.2,
    });
    expect(plan.deadVolumeMultiplier).toBe(1.2);
  });

  test('unknown well plate throws', function() {
    expect(function() { wellPlateSeedingPlan({
      wellPlate: 1536,
      targetDensityCm2: 1e4,
      stockConcentration: 1e6,
    }); }).toThrow();
  });
});

// -- Main seeding plan --------------------------------------------------------

describe('seedingPlan', function() {
  test('surface density on cylinder', function() {
    var plan = seedingPlan({
      targetDensity: 1e5,
      scaffoldType: 'cylinder',
      dimensions: { radiusCm: 0.5, heightCm: 0.2 },
      stockConcentration: 5e6,
    });
    expect(plan.surfaceAreaCm2).toBeGreaterThan(0);
    expect(plan.cellsPerScaffold).toBeGreaterThan(0);
    expect(plan.totalSuspensionMl).toBeGreaterThan(0);
  });

  test('volumetric density', function() {
    var plan = seedingPlan({
      targetDensity: 1e7,
      densityMode: 'volumetric',
      scaffoldType: 'cube',
      dimensions: { sideCm: 1.0 },
      stockConcentration: 1e8,
    });
    expect(plan.densityMode).toBe('volumetric');
    expect(plan.cellsPerScaffold).toBeCloseTo(1e7, -3);
  });

  test('viability adjustment', function() {
    var full = seedingPlan({
      targetDensity: 1e5,
      scaffoldType: 'disc',
      dimensions: { radiusCm: 0.5 },
      stockConcentration: 1e6,
      viabilityPct: 100,
      seedingEfficiencyPct: 100,
    });
    var adjusted = seedingPlan({
      targetDensity: 1e5,
      scaffoldType: 'disc',
      dimensions: { radiusCm: 0.5 },
      stockConcentration: 1e6,
      viabilityPct: 80,
      seedingEfficiencyPct: 50,
    });
    expect(adjusted.adjustedCellsPerScaffold).toBeGreaterThan(full.adjustedCellsPerScaffold);
    expect(adjusted.totalSuspensionMl).toBeGreaterThan(full.totalSuspensionMl);
  });

  test('replicates multiply total', function() {
    var single = seedingPlan({
      targetDensity: 1e5,
      scaffoldType: 'sphere',
      dimensions: { radiusCm: 0.3 },
      stockConcentration: 1e7,
      replicates: 1,
    });
    var triple = seedingPlan({
      targetDensity: 1e5,
      scaffoldType: 'sphere',
      dimensions: { radiusCm: 0.3 },
      stockConcentration: 1e7,
      replicates: 3,
    });
    expect(triple.totalCellsNeeded).toBeCloseTo(single.totalCellsNeeded * 3, -2);
  });

  test('throws on invalid inputs', function() {
    expect(function() { seedingPlan({
      targetDensity: -1,
      scaffoldType: 'cube',
      dimensions: { sideCm: 1 },
      stockConcentration: 1e6,
    }); }).toThrow();
  });
});

// -- Passage expansion --------------------------------------------------------

describe('passageExpansionPlan', function() {
  test('returns 0 passages when enough cells', function() {
    var plan = passageExpansionPlan({
      currentCellCount: 1e7,
      targetCellCount: 1e6,
      doublingTimeHrs: 24,
    });
    expect(plan.passagesNeeded).toBe(0);
    expect(plan.totalTimeHrs).toBe(0);
  });

  test('calculates passages needed', function() {
    var plan = passageExpansionPlan({
      currentCellCount: 1e5,
      targetCellCount: 1e8,
      doublingTimeHrs: 24,
      splitRatio: 3,
    });
    expect(plan.passagesNeeded).toBeGreaterThan(0);
    expect(plan.totalTimeHrs).toBeGreaterThan(0);
    expect(plan.totalTimeDays).toBeGreaterThan(0);
    expect(plan.finalCellCount).toBeGreaterThanOrEqual(1e8);
  });

  test('faster doubling reduces time', function() {
    var slow = passageExpansionPlan({
      currentCellCount: 1e5,
      targetCellCount: 1e7,
      doublingTimeHrs: 48,
    });
    var fast = passageExpansionPlan({
      currentCellCount: 1e5,
      targetCellCount: 1e7,
      doublingTimeHrs: 12,
    });
    expect(fast.totalTimeHrs).toBeLessThan(slow.totalTimeHrs);
  });

  test('passages array has expected structure', function() {
    var plan = passageExpansionPlan({
      currentCellCount: 1e4,
      targetCellCount: 1e7,
      doublingTimeHrs: 24,
    });
    plan.passages.forEach(function(p, i) {
      expect(p.passage).toBe(i + 1);
      expect(p.flasks).toBeGreaterThanOrEqual(1);
      expect(p.seedPerFlask).toBeGreaterThan(0);
      expect(p.harvestPerFlask).toBeGreaterThan(0);
      expect(p.cultureTimeHrs).toBeGreaterThan(0);
    });
  });

  test('throws on invalid inputs', function() {
    expect(function() { passageExpansionPlan({
      currentCellCount: 0, targetCellCount: 1e6, doublingTimeHrs: 24,
    }); }).toThrow();
    expect(function() { passageExpansionPlan({
      currentCellCount: 1e5, targetCellCount: 1e6, doublingTimeHrs: -1,
    }); }).toThrow();
  });
});

// -- Factory ------------------------------------------------------------------

describe('createCellSeedingCalculator', function() {
  test('exposes all methods', function() {
    var calc = createCellSeedingCalculator();
    expect(typeof calc.seedingPlan).toBe('function');
    expect(typeof calc.wellPlateSeedingPlan).toBe('function');
    expect(typeof calc.serialDilutionPlan).toBe('function');
    expect(typeof calc.passageExpansionPlan).toBe('function');
    expect(typeof calc.scaffoldSurfaceArea).toBe('function');
    expect(typeof calc.scaffoldVolume).toBe('function');
    expect(typeof calc.convertDensity).toBe('function');
    expect(calc.WELL_PLATE_SPECS).toBeDefined();
  });

  test('factory methods work end-to-end', function() {
    var calc = createCellSeedingCalculator();
    var plan = calc.seedingPlan({
      targetDensity: 5e4,
      scaffoldType: 'cylinder',
      dimensions: { radiusCm: 0.5, heightCm: 0.3 },
      stockConcentration: 2e6,
    });
    expect(plan.totalCellsNeeded).toBeGreaterThan(0);
  });
});

// -- Well plate specs ---------------------------------------------------------

describe('WELL_PLATE_SPECS', function() {
  test('has standard formats', function() {
    [6, 12, 24, 48, 96, 384].forEach(function(n) {
      expect(WELL_PLATE_SPECS[n]).toBeDefined();
      expect(WELL_PLATE_SPECS[n].wellAreaCm2).toBeGreaterThan(0);
      expect(WELL_PLATE_SPECS[n].wellVolumeMl).toBeGreaterThan(0);
    });
  });

  test('area decreases with more wells', function() {
    expect(WELL_PLATE_SPECS[6].wellAreaCm2).toBeGreaterThan(WELL_PLATE_SPECS[96].wellAreaCm2);
    expect(WELL_PLATE_SPECS[96].wellAreaCm2).toBeGreaterThan(WELL_PLATE_SPECS[384].wellAreaCm2);
  });
});
