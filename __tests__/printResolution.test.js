'use strict';

var pr = require('../docs/shared/printResolution');

describe('PrintResolutionCalculator', function () {
  var calc;

  beforeEach(function () {
    calc = pr.createPrintResolutionCalculator();
  });

  // ── Factory ──────────────────────────────────────────────────────────

  test('creates calculator with all methods', function () {
    expect(typeof calc.calculate).toBe('function');
    expect(typeof calc.compare).toBe('function');
    expect(typeof calc.findOptimalPressure).toBe('function');
    expect(typeof calc.formatReport).toBe('function');
    expect(calc.NOZZLE_GAUGES).toBeDefined();
    expect(calc.SWELL_RATIOS).toBeDefined();
    expect(calc.VISCOSITY_PRESETS).toBeDefined();
  });

  // ── Basic calculation ────────────────────────────────────────────────

  test('calculates resolution with explicit params', function () {
    var r = calc.calculate({
      nozzleDiameter: 0.413,
      pressure: 100,
      stageSpeed: 5,
      viscosity: 0.8,
      material: 'alginate'
    });
    expect(r.strandDiameter_mm).toBeGreaterThan(0);
    expect(r.layerHeight_mm).toBeGreaterThan(0);
    expect(r.flowRate_uL_s).toBeGreaterThan(0);
    expect(r.fidelityScore).toBeGreaterThanOrEqual(0);
    expect(r.fidelityScore).toBeLessThanOrEqual(100);
    expect(r.resolutionClass).toBeTruthy();
    expect(r.material).toBe('alginate');
  });

  test('calculates with gauge instead of diameter', function () {
    var r = calc.calculate({ gauge: '22G', pressure: 80, speed: 4, material: 'gelatin' });
    expect(r.nozzleDiameter).toBe(0.413);
    expect(r.strandDiameter_mm).toBeGreaterThan(0);
  });

  test('uses viscosity preset when material is known', function () {
    var r = calc.calculate({ gauge: '25G', pressure: 50, speed: 3, material: 'collagen' });
    expect(r.viscosity_Pa_s).toBe(1.2);
  });

  test('custom material with explicit viscosity', function () {
    var r = calc.calculate({ nozzleDiameter: 0.3, pressure: 60, speed: 5, viscosity: 2.0 });
    expect(r.material).toBe('custom');
    expect(r.viscosity_Pa_s).toBe(2);
  });

  // ── Physics sanity ───────────────────────────────────────────────────

  test('higher pressure → higher flow rate', function () {
    var lo = calc.calculate({ gauge: '22G', pressure: 50, speed: 5, viscosity: 0.8 });
    var hi = calc.calculate({ gauge: '22G', pressure: 200, speed: 5, viscosity: 0.8 });
    expect(hi.flowRate_uL_s).toBeGreaterThan(lo.flowRate_uL_s);
  });

  test('higher viscosity → lower flow rate', function () {
    var lo = calc.calculate({ gauge: '22G', pressure: 100, speed: 5, viscosity: 0.3 });
    var hi = calc.calculate({ gauge: '22G', pressure: 100, speed: 5, viscosity: 3.0 });
    expect(lo.flowRate_uL_s).toBeGreaterThan(hi.flowRate_uL_s);
  });

  test('smaller nozzle → finer strand at same conditions', function () {
    var big = calc.calculate({ gauge: '18G', pressure: 100, speed: 5, viscosity: 0.8 });
    var small = calc.calculate({ gauge: '27G', pressure: 100, speed: 5, viscosity: 0.8 });
    expect(small.strandDiameter_mm).toBeLessThan(big.strandDiameter_mm);
  });

  test('faster stage speed → thinner strand', function () {
    var slow = calc.calculate({ gauge: '22G', pressure: 100, speed: 2, viscosity: 0.8 });
    var fast = calc.calculate({ gauge: '22G', pressure: 100, speed: 15, viscosity: 0.8 });
    expect(fast.strandDiameter_mm).toBeLessThan(slow.strandDiameter_mm);
  });

  test('layer height is strand diameter × spread ratio', function () {
    var r = calc.calculate({ gauge: '22G', pressure: 100, speed: 5, viscosity: 0.8 });
    expect(r.layerHeight_mm).toBeCloseTo(r.strandDiameter_mm * 0.70, 3);
  });

  // ── Resolution classes ───────────────────────────────────────────────

  test('classifies resolution correctly', function () {
    // ultra-fine: very small nozzle, low pressure
    var uf = calc.calculate({ nozzleDiameter: 0.1, pressure: 20, speed: 10, viscosity: 0.5 });
    expect(['ultra-fine', 'fine']).toContain(uf.resolutionClass);
  });

  // ── Shear rate ───────────────────────────────────────────────────────

  test('computes shear rate', function () {
    var r = calc.calculate({ gauge: '22G', pressure: 100, speed: 5, viscosity: 0.8 });
    expect(r.shearRate_1_s).toBeGreaterThan(0);
  });

  // ── Validation ───────────────────────────────────────────────────────

  test('throws on missing options', function () {
    expect(function () { calc.calculate(); }).toThrow();
    expect(function () { calc.calculate({}); }).toThrow();
  });

  test('throws on zero pressure', function () {
    expect(function () {
      calc.calculate({ gauge: '22G', pressure: 0, speed: 5, viscosity: 0.8 });
    }).toThrow(/pressure/i);
  });

  test('throws on unknown gauge', function () {
    expect(function () {
      calc.calculate({ gauge: '99G', pressure: 100, speed: 5, viscosity: 0.8 });
    }).toThrow(/gauge/i);
  });

  test('throws on missing viscosity for unknown material', function () {
    expect(function () {
      calc.calculate({ gauge: '22G', pressure: 100, speed: 5, material: 'unobtainium' });
    }).toThrow(/viscosity/i);
  });

  // ── Compare ──────────────────────────────────────────────────────────

  test('compares multiple configs', function () {
    var r = calc.compare([
      { gauge: '22G', pressure: 100, speed: 5, viscosity: 0.8, label: 'A' },
      { gauge: '25G', pressure: 80, speed: 8, viscosity: 0.8, label: 'B' }
    ]);
    expect(r.results).toHaveLength(2);
    expect(r.ranked).toHaveLength(2);
    expect(r.best).toBeDefined();
    expect(r.finest).toBeDefined();
    expect(r.results[0]._label).toBe('A');
  });

  test('compare throws on < 2 configs', function () {
    expect(function () { calc.compare([{}]); }).toThrow();
  });

  // ── Optimal pressure finder ──────────────────────────────────────────

  test('finds pressure for target strand diameter', function () {
    var r = calc.findOptimalPressure({
      gauge: '22G',
      speed: 5,
      viscosity: 0.8,
      targetStrandDiameter: 0.4,
      minPressure: 10,
      maxPressure: 300
    });
    expect(r.optimalResult).toBeDefined();
    expect(r.deviation_mm).toBeLessThan(0.1);
    expect(r.targetStrandDiameter_mm).toBe(0.4);
  });

  test('findOptimalPressure throws without target', function () {
    expect(function () {
      calc.findOptimalPressure({ gauge: '22G', speed: 5, viscosity: 0.8 });
    }).toThrow(/targetStrandDiameter/i);
  });

  // ── Report ───────────────────────────────────────────────────────────

  test('formats a text report', function () {
    var r = calc.calculate({ gauge: '22G', pressure: 100, speed: 5, viscosity: 0.8 });
    var report = calc.formatReport(r);
    expect(report).toContain('Print Resolution Report');
    expect(report).toContain('Strand diameter');
    expect(report).toContain('Fidelity score');
    expect(report).toContain('Resolution class');
  });

  // ── Presets ──────────────────────────────────────────────────────────

  test('has gauge lookup table', function () {
    expect(Object.keys(calc.NOZZLE_GAUGES).length).toBeGreaterThanOrEqual(6);
    expect(calc.NOZZLE_GAUGES['22G']).toBe(0.413);
  });

  test('has swell ratios for common materials', function () {
    expect(calc.SWELL_RATIOS.alginate).toBeDefined();
    expect(calc.SWELL_RATIOS.collagen).toBeDefined();
  });

  test('all materials have viscosity preset', function () {
    var mats = Object.keys(calc.VISCOSITY_PRESETS);
    expect(mats.length).toBeGreaterThanOrEqual(10);
    mats.forEach(function (m) {
      expect(calc.VISCOSITY_PRESETS[m]).toBeGreaterThan(0);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  test('works with very high pressure', function () {
    var r = calc.calculate({ gauge: '22G', pressure: 500, speed: 5, viscosity: 0.8 });
    expect(r.strandDiameter_mm).toBeGreaterThan(0);
    expect(r.resolutionClass).toBeTruthy();
  });

  test('works with very low speed', function () {
    var r = calc.calculate({ gauge: '22G', pressure: 100, speed: 0.5, viscosity: 0.8 });
    expect(r.strandDiameter_mm).toBeGreaterThan(0);
  });

  test('custom swell and spread ratios', function () {
    var r = calc.calculate({
      gauge: '22G', pressure: 100, speed: 5, viscosity: 0.8,
      swellRatio: 1.30,
      spreadRatio: 0.50
    });
    expect(r.swellRatio).toBe(1.3);
    expect(r.layerHeight_mm).toBeCloseTo(r.strandDiameter_mm * 0.50, 3);
  });

  test('custom overlap fraction', function () {
    var r = calc.calculate({
      gauge: '22G', pressure: 100, speed: 5, viscosity: 0.8,
      overlapFraction: 0.20
    });
    var expectedSpacing = r.strandDiameter_mm * 0.80;
    expect(r.strandSpacing_mm).toBeCloseTo(expectedSpacing, 3);
  });
});
