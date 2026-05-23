/**
 * Try/scripts/cellSeeding.js — comprehensive coverage tests.
 *
 * The repo has an existing test for the SDK sibling at
 * `docs/shared/cellSeeding.js` (`__tests__/cellSeeding.test.js`).
 * The Try/scripts sibling was at 0% coverage despite being shipped in
 * the dashboard bundle, so this file exercises every exported function
 * and every branch (errors, warnings, edge cases, factory).
 */
'use strict';

var cs = require('../Try/scripts/cellSeeding');
var createCellSeedingCalculator = cs.createCellSeedingCalculator;
var scaffoldSurfaceArea = cs.scaffoldSurfaceArea;
var scaffoldVolume = cs.scaffoldVolume;
var convertDensity = cs.convertDensity;
var serialDilutionPlan = cs.serialDilutionPlan;
var wellPlateSeedingPlan = cs.wellPlateSeedingPlan;
var seedingPlan = cs.seedingPlan;
var passageExpansionPlan = cs.passageExpansionPlan;
var WELL_PLATE_SPECS = cs.WELL_PLATE_SPECS;

// ---------------------------------------------------------------------------
// scaffoldSurfaceArea
// ---------------------------------------------------------------------------

describe('Try/scripts cellSeeding.scaffoldSurfaceArea', function() {
  test('cylinder: lateral + 2 caps', function() {
    var area = scaffoldSurfaceArea('cylinder', { radiusCm: 0.5, heightCm: 1.0 });
    expect(area).toBeCloseTo(2 * Math.PI * 0.5 * 1 + 2 * Math.PI * 0.25, 4);
  });

  test('cube: 6 * side^2', function() {
    expect(scaffoldSurfaceArea('cube', { sideCm: 2 })).toBeCloseTo(24, 6);
  });

  test('rectangle: full surface formula', function() {
    var a = scaffoldSurfaceArea('rectangle', { lengthCm: 2, widthCm: 3, heightCm: 4 });
    expect(a).toBeCloseTo(2 * (6 + 8 + 12), 6);
  });

  test('sphere: 4 pi r^2', function() {
    expect(scaffoldSurfaceArea('sphere', { radiusCm: 1 })).toBeCloseTo(4 * Math.PI, 6);
  });

  test('disc: pi r^2', function() {
    expect(scaffoldSurfaceArea('disc', { radiusCm: 2 })).toBeCloseTo(4 * Math.PI, 6);
  });

  test('well: defaults to spec well count', function() {
    expect(scaffoldSurfaceArea('well', { wellPlate: 96 })).toBeCloseTo(96 * 0.32, 6);
  });

  test('well: honors explicit wellCount', function() {
    expect(scaffoldSurfaceArea('well', { wellPlate: 24, wellCount: 6 })).toBeCloseTo(6 * 1.9, 6);
  });

  test('cylinder rejects bad dims', function() {
    expect(function() { scaffoldSurfaceArea('cylinder', { radiusCm: 0, heightCm: 1 }); }).toThrow(/positive/);
    expect(function() { scaffoldSurfaceArea('cylinder', { radiusCm: 1, heightCm: -1 }); }).toThrow(/positive/);
  });

  test('cube rejects bad dims', function() {
    expect(function() { scaffoldSurfaceArea('cube', { sideCm: 0 }); }).toThrow(/positive/);
  });

  test('rectangle rejects bad dims', function() {
    expect(function() { scaffoldSurfaceArea('rectangle', { lengthCm: 1, widthCm: 2 }); }).toThrow(/positive/);
  });

  test('sphere rejects bad dims', function() {
    expect(function() { scaffoldSurfaceArea('sphere', { radiusCm: -2 }); }).toThrow(/positive/);
  });

  test('disc rejects bad dims', function() {
    expect(function() { scaffoldSurfaceArea('disc', { radiusCm: 0 }); }).toThrow(/positive/);
  });

  test('well rejects unknown plate', function() {
    expect(function() { scaffoldSurfaceArea('well', { wellPlate: 7 }); }).toThrow(/Unknown well plate/);
  });

  test('unknown scaffold type throws', function() {
    expect(function() { scaffoldSurfaceArea('blob', {}); }).toThrow(/Unknown scaffold type/);
  });
});

// ---------------------------------------------------------------------------
// scaffoldVolume
// ---------------------------------------------------------------------------

describe('Try/scripts cellSeeding.scaffoldVolume', function() {
  test('cylinder volume', function() {
    expect(scaffoldVolume('cylinder', { radiusCm: 1, heightCm: 2 })).toBeCloseTo(2 * Math.PI, 6);
  });

  test('cube volume', function() {
    expect(scaffoldVolume('cube', { sideCm: 3 })).toBeCloseTo(27, 6);
  });

  test('sphere volume', function() {
    expect(scaffoldVolume('sphere', { radiusCm: 1 })).toBeCloseTo((4 / 3) * Math.PI, 6);
  });

  test('well volume: default count', function() {
    expect(scaffoldVolume('well', { wellPlate: 24 })).toBeCloseTo(24 * 0.5, 6);
  });

  test('well volume: explicit count', function() {
    expect(scaffoldVolume('well', { wellPlate: 24, wellCount: 4 })).toBeCloseTo(4 * 0.5, 6);
  });

  test('cylinder rejects bad dims', function() {
    expect(function() { scaffoldVolume('cylinder', { radiusCm: 0, heightCm: 1 }); }).toThrow(/positive/);
  });

  test('cube rejects bad dims', function() {
    expect(function() { scaffoldVolume('cube', { sideCm: -1 }); }).toThrow(/positive/);
  });

  test('sphere rejects bad dims', function() {
    expect(function() { scaffoldVolume('sphere', { radiusCm: 0 }); }).toThrow(/positive/);
  });

  test('well rejects unknown plate', function() {
    expect(function() { scaffoldVolume('well', { wellPlate: 999 }); }).toThrow(/Unknown well plate/);
  });

  test('unknown type throws', function() {
    expect(function() { scaffoldVolume('rectangle', { lengthCm: 1, widthCm: 1, heightCm: 1 }); }).toThrow(/Unknown scaffold type/);
  });
});

// ---------------------------------------------------------------------------
// convertDensity
// ---------------------------------------------------------------------------

describe('Try/scripts cellSeeding.convertDensity', function() {
  test('cells/mL → cells/uL', function() {
    expect(convertDensity(1000, 'cells/mL', 'cells/uL')).toBeCloseTo(1, 6);
  });

  test('cells/uL → cells/mL', function() {
    expect(convertDensity(1, 'cells/uL', 'cells/mL')).toBeCloseTo(1000, 6);
  });

  test('cells/cm3 round trip', function() {
    expect(convertDensity(500, 'cells/cm3', 'cells/mL')).toBe(500);
    expect(convertDensity(500, 'cells/mL', 'cells/cm3')).toBe(500);
  });

  test('cells/cm2 → cells/mL requires context', function() {
    expect(function() { convertDensity(100, 'cells/cm2', 'cells/mL'); }).toThrow(/context/);
  });

  test('cells/cm2 → cells/mL with context', function() {
    // 100 cells/cm2 * 10 cm2 area / 2 mL volume = 500 cells/mL
    expect(convertDensity(100, 'cells/cm2', 'cells/mL', { areaCm2: 10, volumeMl: 2 })).toBeCloseTo(500, 6);
  });

  test('cells/mL → cells/cm2 requires context', function() {
    expect(function() { convertDensity(100, 'cells/mL', 'cells/cm2'); }).toThrow(/context/);
  });

  test('cells/mL → cells/cm2 with context', function() {
    expect(convertDensity(500, 'cells/mL', 'cells/cm2', { areaCm2: 10, volumeMl: 2 })).toBeCloseTo(100, 6);
  });

  test('unknown from-unit throws', function() {
    expect(function() { convertDensity(1, 'molar', 'cells/mL'); }).toThrow(/Unknown density unit/);
  });

  test('unknown to-unit throws', function() {
    expect(function() { convertDensity(1, 'cells/mL', 'parsec'); }).toThrow(/Unknown density unit/);
  });
});

// ---------------------------------------------------------------------------
// serialDilutionPlan
// ---------------------------------------------------------------------------

describe('Try/scripts cellSeeding.serialDilutionPlan', function() {
  test('reaches target via 2x dilutions', function() {
    var plan = serialDilutionPlan({ stockConcentration: 1e6, targetConcentration: 1e5, dilutionFactor: 2, volumePerTubeMl: 1 });
    expect(plan.totalSteps).toBeGreaterThanOrEqual(3);
    expect(plan.finalConcentration).toBeLessThanOrEqual(1e5);
    expect(plan.achievedTarget).toBe(true);
    // Each step volumes consistent
    plan.steps.forEach(function(s) {
      expect(s.sampleVolumeMl + s.diluentVolumeMl).toBeCloseTo(s.totalVolumeMl, 6);
      expect(s.outputConcentration * 2).toBeCloseTo(s.inputConcentration, 6);
    });
    // Steps are numbered 1..N
    expect(plan.steps[0].step).toBe(1);
    expect(plan.steps[plan.steps.length - 1].step).toBe(plan.totalSteps);
  });

  test('default factor and volume', function() {
    var plan = serialDilutionPlan({ stockConcentration: 8, targetConcentration: 1 });
    // 8 -> 4 -> 2 -> 1 (still > 1? loop runs while conc > target). 8>1 step, 4>1 step, 2>1 step, 1>1 false → 3 steps
    expect(plan.totalSteps).toBe(3);
    expect(plan.finalConcentration).toBeCloseTo(1, 6);
    expect(plan.steps[0].totalVolumeMl).toBe(1.0);
  });

  test('rejects bad stock', function() {
    expect(function() { serialDilutionPlan({ stockConcentration: 0, targetConcentration: 1 }); }).toThrow(/stockConcentration/);
  });

  test('rejects bad target', function() {
    expect(function() { serialDilutionPlan({ stockConcentration: 10, targetConcentration: 0 }); }).toThrow(/targetConcentration/);
  });

  test('rejects target >= stock', function() {
    expect(function() { serialDilutionPlan({ stockConcentration: 10, targetConcentration: 10 }); }).toThrow(/less than/);
    expect(function() { serialDilutionPlan({ stockConcentration: 10, targetConcentration: 100 }); }).toThrow(/less than/);
  });

  test('rejects factor <= 1', function() {
    expect(function() { serialDilutionPlan({ stockConcentration: 10, targetConcentration: 1, dilutionFactor: 1 }); }).toThrow(/dilutionFactor/);
  });
});

// ---------------------------------------------------------------------------
// wellPlateSeedingPlan
// ---------------------------------------------------------------------------

describe('Try/scripts cellSeeding.wellPlateSeedingPlan', function() {
  test('basic 96-well plan', function() {
    var plan = wellPlateSeedingPlan({
      wellPlate: 96,
      targetDensityCm2: 50000,
      stockConcentration: 1e6
    });
    expect(plan.wellPlate).toBe(96);
    expect(plan.wellsToSeed).toBe(96);
    expect(plan.wellAreaCm2).toBeCloseTo(0.32, 6);
    expect(plan.cellsPerWell).toBeCloseTo(50000 * 0.32, 6);
    expect(plan.totalCellsNeeded).toBeCloseTo(plan.cellsPerWell * 96, 6);
    expect(plan.volumePerWellMl).toBeCloseTo(plan.cellsPerWell / 1e6, 6);
    expect(plan.deadVolumeMultiplier).toBe(1.0);
    expect(plan.warnings).toEqual([]);
  });

  test('respects wellsToSeed, viability, deadVolumeMultiplier', function() {
    var plan = wellPlateSeedingPlan({
      wellPlate: 24,
      wellsToSeed: 12,
      targetDensityCm2: 10000,
      viabilityPct: 80,
      stockConcentration: 1e6,
      deadVolumeMultiplier: 1.2
    });
    expect(plan.wellsToSeed).toBe(12);
    expect(plan.cellsPerWell).toBeCloseTo((10000 * 1.9) / 0.8, 6);
    expect(plan.deadVolumeMultiplier).toBe(1.2);
    expect(plan.totalVolumeMl).toBeCloseTo(plan.volumePerWellMl * 12 * 1.2, 6);
  });

  test('emits warning when per-well volume exceeds capacity', function() {
    // 384-well plate: wellVolumeMl=0.05. Force a big volume by using low stock concentration.
    var plan = wellPlateSeedingPlan({
      wellPlate: 384,
      targetDensityCm2: 1e6,
      stockConcentration: 1
    });
    expect(plan.warnings.length).toBe(1);
    expect(plan.warnings[0]).toMatch(/exceeds well capacity/);
  });

  test('rejects unknown well plate', function() {
    expect(function() { wellPlateSeedingPlan({ wellPlate: 7, targetDensityCm2: 1, stockConcentration: 1 }); }).toThrow(/Unknown well plate/);
  });
});

// ---------------------------------------------------------------------------
// seedingPlan
// ---------------------------------------------------------------------------

describe('Try/scripts cellSeeding.seedingPlan', function() {
  test('surface mode on cube scaffold', function() {
    var plan = seedingPlan({
      targetDensity: 10000,
      stockConcentration: 1e6,
      scaffoldType: 'cube',
      dimensions: { sideCm: 1 }
    });
    expect(plan.densityMode).toBe('surface');
    expect(plan.scaffoldType).toBe('cube');
    expect(plan.surfaceAreaCm2).toBeCloseTo(6, 6);
    expect(plan.cellsPerScaffold).toBeCloseTo(60000, 6);
    expect(plan.adjustedCellsPerScaffold).toBeCloseTo(60000, 6); // viability/efficiency default to 100%
    expect(plan.replicates).toBe(1);
    expect(plan.totalCellsNeeded).toBeCloseTo(60000, 6);
    expect(plan.totalSuspensionMl).toBeCloseTo(60000 / 1e6, 6);
    expect(plan.viabilityPct).toBe(100);
    expect(plan.seedingEfficiencyPct).toBe(100);
  });

  test('volumetric mode uses scaffoldVolume', function() {
    var plan = seedingPlan({
      targetDensity: 1e6,
      stockConcentration: 1e6,
      scaffoldType: 'cube',
      dimensions: { sideCm: 1 },
      densityMode: 'volumetric'
    });
    expect(plan.densityMode).toBe('volumetric');
    expect(plan.cellsPerScaffold).toBeCloseTo(1e6, 6); // volume = 1
  });

  test('applies viability, efficiency, replicates', function() {
    var plan = seedingPlan({
      targetDensity: 10000,
      stockConcentration: 1e6,
      scaffoldType: 'cube',
      dimensions: { sideCm: 1 },
      viabilityPct: 80,
      seedingEfficiencyPct: 50,
      replicates: 3
    });
    // base 60000, adjusted = 60000 / (0.8 * 0.5) = 150000
    expect(plan.adjustedCellsPerScaffold).toBeCloseTo(150000, 6);
    expect(plan.totalCellsNeeded).toBeCloseTo(450000, 6);
    expect(plan.replicates).toBe(3);
    expect(plan.viabilityPct).toBe(80);
    expect(plan.seedingEfficiencyPct).toBe(50);
  });

  test('rejects bad targetDensity', function() {
    expect(function() { seedingPlan({ targetDensity: 0, stockConcentration: 1, scaffoldType: 'cube', dimensions: { sideCm: 1 } }); }).toThrow(/targetDensity/);
  });

  test('rejects bad stockConcentration', function() {
    expect(function() { seedingPlan({ targetDensity: 1, stockConcentration: -1, scaffoldType: 'cube', dimensions: { sideCm: 1 } }); }).toThrow(/stockConcentration/);
  });
});

// ---------------------------------------------------------------------------
// passageExpansionPlan
// ---------------------------------------------------------------------------

describe('Try/scripts cellSeeding.passageExpansionPlan', function() {
  test('zero passages when already above target', function() {
    var plan = passageExpansionPlan({
      currentCellCount: 1e8,
      targetCellCount: 1e6,
      doublingTimeHrs: 24
    });
    expect(plan.passagesNeeded).toBe(0);
    expect(plan.totalTimeHrs).toBe(0);
    expect(plan.totalTimeDays).toBe(0);
    expect(plan.finalCellCount).toBe(1e8);
    expect(plan.passages).toEqual([]);
  });

  test('multi-passage expansion converges and reports culture time', function() {
    var plan = passageExpansionPlan({
      currentCellCount: 1e5,
      targetCellCount: 1e8,
      doublingTimeHrs: 24,
      flaskCapacity: 1e7,
      confluenceMultiplier: 4
    });
    expect(plan.passagesNeeded).toBeGreaterThan(0);
    expect(plan.finalCellCount).toBeGreaterThanOrEqual(1e8);
    // Each passage roughly 2 doublings of culture (log2(4)=2)
    plan.passages.forEach(function(p) {
      expect(p.cultureTimeHrs).toBeCloseTo(24 * Math.log2(4), 6);
      expect(p.flasks).toBeGreaterThanOrEqual(1);
      expect(p.harvestPerFlask).toBeCloseTo(p.seedPerFlask * 4, 6);
    });
    // totalTimeDays = totalTimeHrs / 24
    expect(plan.totalTimeDays).toBeCloseTo(plan.totalTimeHrs / 24, 6);
    // Passages numbered 1..N
    expect(plan.passages[0].passage).toBe(1);
    expect(plan.passages[plan.passages.length - 1].passage).toBe(plan.passagesNeeded);
  });

  test('splits into multiple flasks once cells exceed flask capacity', function() {
    var plan = passageExpansionPlan({
      currentCellCount: 2.5e7, // > 1e7 default flask capacity
      targetCellCount: 1e9,
      doublingTimeHrs: 24
    });
    expect(plan.passages[0].flasks).toBeGreaterThanOrEqual(3);
  });

  test('rejects bad inputs', function() {
    expect(function() { passageExpansionPlan({ currentCellCount: 0, targetCellCount: 1, doublingTimeHrs: 1 }); }).toThrow(/currentCellCount/);
    expect(function() { passageExpansionPlan({ currentCellCount: 1, targetCellCount: 0, doublingTimeHrs: 1 }); }).toThrow(/targetCellCount/);
    expect(function() { passageExpansionPlan({ currentCellCount: 1, targetCellCount: 2, doublingTimeHrs: 0 }); }).toThrow(/doublingTimeHrs/);
  });
});

// ---------------------------------------------------------------------------
// createCellSeedingCalculator (factory) + exports surface
// ---------------------------------------------------------------------------

describe('Try/scripts cellSeeding.createCellSeedingCalculator', function() {
  test('factory wires every public function', function() {
    var calc = createCellSeedingCalculator();
    expect(typeof calc.seedingPlan).toBe('function');
    expect(typeof calc.wellPlateSeedingPlan).toBe('function');
    expect(typeof calc.serialDilutionPlan).toBe('function');
    expect(typeof calc.passageExpansionPlan).toBe('function');
    expect(typeof calc.scaffoldSurfaceArea).toBe('function');
    expect(typeof calc.scaffoldVolume).toBe('function');
    expect(typeof calc.convertDensity).toBe('function');
    expect(calc.WELL_PLATE_SPECS).toBe(WELL_PLATE_SPECS);
    // Smoke: factory result is functional
    var plan = calc.seedingPlan({
      targetDensity: 1000, stockConcentration: 1e6,
      scaffoldType: 'sphere', dimensions: { radiusCm: 1 }
    });
    expect(plan.surfaceAreaCm2).toBeCloseTo(4 * Math.PI, 6);
  });

  test('WELL_PLATE_SPECS contains expected formats', function() {
    [6, 12, 24, 48, 96, 384].forEach(function(n) {
      expect(WELL_PLATE_SPECS[n]).toBeDefined();
      expect(WELL_PLATE_SPECS[n].wells).toBe(n);
      expect(WELL_PLATE_SPECS[n].wellAreaCm2).toBeGreaterThan(0);
      expect(WELL_PLATE_SPECS[n].wellVolumeMl).toBeGreaterThan(0);
    });
  });
});
