'use strict';

const {
  createCompatibilityMatrix,
  BUILTIN_BIOINKS,
  DIMENSION_WEIGHTS,
  _rheologyScore,
  _crosslinkScore,
  _thermalScore,
  _phScore,
  _interfaceScore,
  _degradationScore,
  _rangeOverlapScore,
  _proxScore,
  _classifyCompatibility,
} = require('../Try/scripts/compatibility');

// ── Utility helpers ──

describe('rangeOverlapScore', () => {
  test('full overlap returns 1', () => {
    expect(_rangeOverlapScore(0, 10, 0, 10)).toBe(1);
  });
  test('no overlap returns 0', () => {
    expect(_rangeOverlapScore(0, 5, 6, 10)).toBe(0);
  });
  test('partial overlap', () => {
    const s = _rangeOverlapScore(0, 10, 5, 15);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
  test('touching at point returns 0', () => {
    expect(_rangeOverlapScore(0, 5, 5, 10)).toBe(0);
  });
  test('subset returns 1', () => {
    expect(_rangeOverlapScore(2, 8, 0, 10)).toBe(1);
  });
});

describe('proxScore', () => {
  test('same value returns 1', () => {
    expect(_proxScore(5, 5, 10)).toBe(1);
  });
  test('diff equal to scale returns 0', () => {
    expect(_proxScore(0, 10, 10)).toBe(0);
  });
  test('half scale returns 0.5', () => {
    expect(_proxScore(0, 5, 10)).toBe(0.5);
  });
});

describe('classifyCompatibility', () => {
  test('excellent', () => expect(_classifyCompatibility(0.85)).toBe('excellent'));
  test('good', () => expect(_classifyCompatibility(0.65)).toBe('good'));
  test('moderate', () => expect(_classifyCompatibility(0.45)).toBe('moderate'));
  test('poor', () => expect(_classifyCompatibility(0.25)).toBe('poor'));
  test('incompatible', () => expect(_classifyCompatibility(0.1)).toBe('incompatible'));
});

// ── Dimension scoring ──

describe('rheologyScore', () => {
  test('identical materials score 1', () => {
    const a = { viscosityPas: 1, shearThinningIndex: 0.5 };
    const r = _rheologyScore(a, a);
    expect(r.score).toBe(1);
  });
  test('very different viscosities score low', () => {
    const a = { viscosityPas: 0.05, shearThinningIndex: 0.5 };
    const b = { viscosityPas: 5.0, shearThinningIndex: 0.5 };
    const r = _rheologyScore(a, b);
    expect(r.score).toBeLessThan(0.5);
  });
  test('includes detail string', () => {
    const a = { viscosityPas: 1, shearThinningIndex: 0.5 };
    const b = { viscosityPas: 1.1, shearThinningIndex: 0.55 };
    const r = _rheologyScore(a, b);
    expect(r.detail).toBeTruthy();
    expect(typeof r.viscosityRatio).toBe('number');
  });
});

describe('crosslinkScore', () => {
  test('same UV wavelength scores high', () => {
    const a = { crosslinkMethod: 'uv', crosslinkWavelength: 405 };
    const r = _crosslinkScore(a, a);
    expect(r.score).toBe(1);
    expect(r.sameMethod).toBe(true);
  });
  test('different UV wavelengths', () => {
    const a = { crosslinkMethod: 'uv', crosslinkWavelength: 365 };
    const b = { crosslinkMethod: 'uv', crosslinkWavelength: 405 };
    const r = _crosslinkScore(a, b);
    expect(r.score).toBe(0.7);
  });
  test('orthogonal methods', () => {
    const a = { crosslinkMethod: 'uv' };
    const b = { crosslinkMethod: 'ionic' };
    const r = _crosslinkScore(a, b);
    expect(r.score).toBe(0.75);
  });
  test('same non-UV method', () => {
    const a = { crosslinkMethod: 'ionic' };
    const r = _crosslinkScore(a, a);
    expect(r.score).toBe(0.9);
  });
});

describe('thermalScore', () => {
  test('identical ranges score high', () => {
    const a = { tempMinC: 20, tempMaxC: 37, printTempC: 25 };
    const r = _thermalScore(a, a);
    expect(r.score).toBeGreaterThan(0.9);
  });
  test('non-overlapping ranges score 0 for overlap portion', () => {
    const a = { tempMinC: 4, tempMaxC: 10, printTempC: 8 };
    const b = { tempMinC: 30, tempMaxC: 45, printTempC: 37 };
    const r = _thermalScore(a, b);
    expect(r.overlapRange).toBeNull();
  });
});

describe('phScore', () => {
  test('identical pH scores high', () => {
    const a = { phMin: 6.5, phMax: 7.5, optimalPh: 7.0 };
    const r = _phScore(a, a);
    expect(r.score).toBeGreaterThan(0.9);
  });
  test('non-overlapping pH', () => {
    const a = { phMin: 3.0, phMax: 4.0, optimalPh: 3.5 };
    const b = { phMin: 8.0, phMax: 9.0, optimalPh: 8.5 };
    const r = _phScore(a, b);
    expect(r.overlapRange).toBeNull();
  });
});

describe('interfaceScore', () => {
  test('similar properties score high', () => {
    const a = { surfaceTension: 45, swellingRatio: 1.8, mechanicalModulusKPa: 12 };
    const r = _interfaceScore(a, a);
    expect(r.score).toBeGreaterThan(0.9);
  });
  test('very different modulus scores low', () => {
    const a = { surfaceTension: 45, swellingRatio: 1.5, mechanicalModulusKPa: 2 };
    const b = { surfaceTension: 45, swellingRatio: 1.5, mechanicalModulusKPa: 100 };
    const r = _interfaceScore(a, b);
    expect(r.modulusRatio).toBeLessThan(0.1);
  });
});

describe('degradationScore', () => {
  test('same rate scores 1', () => {
    const a = { degradationDays: 28 };
    const r = _degradationScore(a, a);
    expect(r.score).toBe(1);
  });
  test('very different rates score low', () => {
    const a = { degradationDays: 7 };
    const b = { degradationDays: 90 };
    const r = _degradationScore(a, b);
    expect(r.score).toBeLessThan(0.15);
  });
});

// ── Matrix factory ──

describe('createCompatibilityMatrix', () => {
  test('loads built-in bioinks by default', () => {
    const m = createCompatibilityMatrix();
    expect(m.listBioinks().length).toBe(Object.keys(BUILTIN_BIOINKS).length);
  });

  test('can skip built-ins', () => {
    const m = createCompatibilityMatrix({ loadBuiltins: false });
    expect(m.listBioinks().length).toBe(0);
  });

  test('addBioink validates name', () => {
    const m = createCompatibilityMatrix({ loadBuiltins: false });
    expect(() => m.addBioink({})).toThrow('name');
  });

  test('addBioink validates viscosity', () => {
    const m = createCompatibilityMatrix({ loadBuiltins: false });
    expect(() => m.addBioink({ name: 'X', viscosityPas: -1, shearThinningIndex: 0.5, crosslinkMethod: 'uv' })).toThrow('viscosityPas');
  });

  test('addBioink validates shearThinningIndex', () => {
    const m = createCompatibilityMatrix({ loadBuiltins: false });
    expect(() => m.addBioink({ name: 'X', viscosityPas: 1, shearThinningIndex: 2, crosslinkMethod: 'uv' })).toThrow('shearThinningIndex');
  });

  test('addBioink validates crosslinkMethod', () => {
    const m = createCompatibilityMatrix({ loadBuiltins: false });
    expect(() => m.addBioink({ name: 'X', viscosityPas: 1, shearThinningIndex: 0.5 })).toThrow('crosslinkMethod');
  });

  test('addBioink and getBioink', () => {
    const m = createCompatibilityMatrix({ loadBuiltins: false });
    m.addBioink({ name: 'Test', viscosityPas: 1, shearThinningIndex: 0.5, crosslinkMethod: 'uv' });
    const b = m.getBioink('Test');
    expect(b.name).toBe('Test');
  });

  test('getBioink returns null for unknown', () => {
    const m = createCompatibilityMatrix({ loadBuiltins: false });
    expect(m.getBioink('nope')).toBeNull();
  });

  test('removeBioink', () => {
    const m = createCompatibilityMatrix();
    const before = m.listBioinks().length;
    m.removeBioink('GelMA 5%');
    expect(m.listBioinks().length).toBe(before - 1);
  });

  test('listBioinks returns sorted names', () => {
    const m = createCompatibilityMatrix();
    const names = m.listBioinks();
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe('analyzePair', () => {
  test('same material returns 1.0', () => {
    const m = createCompatibilityMatrix();
    const r = m.analyzePair('GelMA 5%', 'GelMA 5%');
    expect(r.composite).toBe(1.0);
    expect(r.classification).toBe('excellent');
  });

  test('throws for unknown bioink', () => {
    const m = createCompatibilityMatrix();
    expect(() => m.analyzePair('GelMA 5%', 'NoExist')).toThrow('Unknown bioink');
  });

  test('returns all dimensions', () => {
    const m = createCompatibilityMatrix();
    const r = m.analyzePair('GelMA 5%', 'Alginate 2%');
    expect(r.dimensions).toHaveProperty('rheology');
    expect(r.dimensions).toHaveProperty('crosslinking');
    expect(r.dimensions).toHaveProperty('thermal');
    expect(r.dimensions).toHaveProperty('ph');
    expect(r.dimensions).toHaveProperty('interface');
    expect(r.dimensions).toHaveProperty('degradation');
  });

  test('composite is between 0 and 1', () => {
    const m = createCompatibilityMatrix();
    const r = m.analyzePair('GelMA 5%', 'PEGDA 10%');
    expect(r.composite).toBeGreaterThanOrEqual(0);
    expect(r.composite).toBeLessThanOrEqual(1);
  });

  test('includes recommendations array', () => {
    const m = createCompatibilityMatrix();
    const r = m.analyzePair('GelMA 5%', 'Collagen I 3mg/mL');
    expect(Array.isArray(r.recommendations)).toBe(true);
  });

  test('classification is valid', () => {
    const m = createCompatibilityMatrix();
    const r = m.analyzePair('Alginate 2%', 'PEGDA 10%');
    expect(['excellent', 'good', 'moderate', 'poor', 'incompatible']).toContain(r.classification);
  });
});

describe('fullMatrix', () => {
  test('returns NxN matrix', () => {
    const m = createCompatibilityMatrix();
    const mat = m.fullMatrix();
    const names = m.listBioinks();
    expect(Object.keys(mat).length).toBe(names.length);
    for (const n of names) {
      expect(Object.keys(mat[n]).length).toBe(names.length);
    }
  });

  test('diagonal is 1.0', () => {
    const m = createCompatibilityMatrix();
    const mat = m.fullMatrix();
    for (const n of m.listBioinks()) {
      expect(mat[n][n].composite).toBe(1.0);
    }
  });

  test('matrix is symmetric', () => {
    const m = createCompatibilityMatrix();
    const mat = m.fullMatrix();
    const names = m.listBioinks();
    for (const a of names) {
      for (const b of names) {
        expect(mat[a][b].composite).toBe(mat[b][a].composite);
      }
    }
  });
});

describe('bestPairs / worstPairs', () => {
  test('bestPairs returns sorted desc', () => {
    const m = createCompatibilityMatrix();
    const best = m.bestPairs(3);
    expect(best.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < best.length; i++) {
      expect(best[i].composite).toBeLessThanOrEqual(best[i - 1].composite);
    }
  });

  test('worstPairs returns sorted asc', () => {
    const m = createCompatibilityMatrix();
    const worst = m.worstPairs(3);
    for (let i = 1; i < worst.length; i++) {
      expect(worst[i].composite).toBeGreaterThanOrEqual(worst[i - 1].composite);
    }
  });
});

describe('findCompatible', () => {
  test('returns only pairs above threshold', () => {
    const m = createCompatibilityMatrix();
    const results = m.findCompatible('GelMA 5%', 0.5);
    for (const r of results) {
      expect(r.composite).toBeGreaterThanOrEqual(0.5);
    }
  });

  test('does not include self', () => {
    const m = createCompatibilityMatrix();
    const results = m.findCompatible('GelMA 5%', 0);
    const names = results.map(r => r.bioinkB);
    expect(names).not.toContain('GelMA 5%');
  });

  test('sorted descending', () => {
    const m = createCompatibilityMatrix();
    const results = m.findCompatible('Alginate 2%', 0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].composite).toBeLessThanOrEqual(results[i - 1].composite);
    }
  });
});

describe('multiMaterialPlan', () => {
  test('throws with fewer than 2 bioinks', () => {
    const m = createCompatibilityMatrix();
    expect(() => m.multiMaterialPlan(['GelMA 5%'])).toThrow('at least 2');
  });

  test('throws for unknown bioink', () => {
    const m = createCompatibilityMatrix();
    expect(() => m.multiMaterialPlan(['GelMA 5%', 'Unknown'])).toThrow('Unknown bioink');
  });

  test('2-material plan', () => {
    const m = createCompatibilityMatrix();
    const plan = m.multiMaterialPlan(['GelMA 5%', 'Alginate 2%']);
    expect(plan.pairCount).toBe(1);
    expect(plan.bioinks.length).toBe(2);
    expect(plan.commonThermalWindow).toBeTruthy();
    expect(plan.suggestedPrintOrder.length).toBe(2);
  });

  test('3-material plan has 3 pairs', () => {
    const m = createCompatibilityMatrix();
    const plan = m.multiMaterialPlan(['GelMA 5%', 'Alginate 2%', 'PEGDA 10%']);
    expect(plan.pairCount).toBe(3);
  });

  test('print order is viscosity descending', () => {
    const m = createCompatibilityMatrix();
    const plan = m.multiMaterialPlan(['GelMA 5%', 'Alginate 2%', 'PEGDA 10%']);
    const visc = plan.suggestedPrintOrder.map(n => BUILTIN_BIOINKS[n].viscosityPas);
    for (let i = 1; i < visc.length; i++) {
      expect(visc[i]).toBeLessThanOrEqual(visc[i - 1]);
    }
  });

  test('weakest link is identified', () => {
    const m = createCompatibilityMatrix();
    const plan = m.multiMaterialPlan(['GelMA 5%', 'Alginate 2%', 'Collagen I 3mg/mL']);
    expect(plan.weakestLink).toHaveProperty('pair');
    expect(plan.weakestLink).toHaveProperty('score');
  });

  test('common pH window computed', () => {
    const m = createCompatibilityMatrix();
    const plan = m.multiMaterialPlan(['GelMA 5%', 'Alginate 2%']);
    expect(plan.commonPhWindow).toBeTruthy();
    expect(plan.commonPhWindow.length).toBe(2);
  });

  test('crosslink methods listed', () => {
    const m = createCompatibilityMatrix();
    const plan = m.multiMaterialPlan(['GelMA 5%', 'Alginate 2%']);
    expect(plan.crosslinkMethods).toContain('uv');
    expect(plan.crosslinkMethods).toContain('ionic');
  });
});

describe('fullReport', () => {
  test('returns summary with counts', () => {
    const m = createCompatibilityMatrix();
    const report = m.fullReport();
    expect(report.bioinkCount).toBe(6);
    expect(report.totalPairs).toBe(15);
    expect(report.distributionByClass).toHaveProperty('excellent');
    expect(report.bestPairs.length).toBeLessThanOrEqual(3);
    expect(report.worstPairs.length).toBeLessThanOrEqual(3);
    expect(report.matrix).toBeTruthy();
  });
});

// ── Built-in bioinks sanity ──

describe('BUILTIN_BIOINKS', () => {
  test('all have required fields', () => {
    for (const [name, b] of Object.entries(BUILTIN_BIOINKS)) {
      expect(b.name).toBe(name);
      expect(b.viscosityPas).toBeGreaterThan(0);
      expect(b.shearThinningIndex).toBeGreaterThanOrEqual(0);
      expect(b.shearThinningIndex).toBeLessThanOrEqual(1);
      expect(b.crosslinkMethod).toBeTruthy();
      expect(b.tempMinC).toBeLessThan(b.tempMaxC);
      expect(b.phMin).toBeLessThan(b.phMax);
    }
  });

  test('6 built-in bioinks', () => {
    expect(Object.keys(BUILTIN_BIOINKS).length).toBe(6);
  });
});

describe('DIMENSION_WEIGHTS', () => {
  test('weights sum to 1', () => {
    const sum = Object.values(DIMENSION_WEIGHTS).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});
