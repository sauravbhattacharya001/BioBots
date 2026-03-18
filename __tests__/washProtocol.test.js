'use strict';

var washProtocol = require('../docs/shared/washProtocol');

describe('Wash Protocol Calculator', function () {
  var calc;

  beforeEach(function () {
    calc = washProtocol.createWashProtocolCalculator();
  });

  describe('listMaterials', function () {
    it('returns known material keys', function () {
      var mats = calc.listMaterials();
      expect(mats).toContain('alginate-CaCl2');
      expect(mats).toContain('gelatin-GelMA');
      expect(mats).toContain('custom');
      expect(mats.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('getProfile', function () {
    it('returns profile for known material', function () {
      var p = calc.getProfile('PEGDA');
      expect(p).not.toBeNull();
      expect(p.washSolution).toBe('DPBS');
    });
    it('returns null for unknown material', function () {
      expect(calc.getProfile('unobtainium')).toBeNull();
    });
  });

  describe('calculate', function () {
    it('produces a valid protocol for alginate', function () {
      var result = calc.calculate({ constructVolume_mL: 0.5, material: 'alginate-CaCl2' });
      expect(result.totalCycles).toBeGreaterThanOrEqual(2);
      expect(result.totalTime_min).toBeGreaterThan(0);
      expect(result.steps.length).toBe(result.totalCycles);
      expect(result.washSolution).toBe('DPBS');
      expect(result.achievedResidual).toBeLessThanOrEqual(result.targetResidual);
      expect(result.targetMet).toBe(true);
    });

    it('handles small constructs with higher wash ratio', function () {
      var result = calc.calculate({ constructVolume_mL: 0.05 });
      expect(result.washVolumePerCycle_mL).toBeGreaterThanOrEqual(0.05 * 15);
    });

    it('throws on missing volume', function () {
      expect(function () { calc.calculate({}); }).toThrow();
    });

    it('throws on invalid targetResidual', function () {
      expect(function () {
        calc.calculate({ constructVolume_mL: 1, targetResidual: 0 });
      }).toThrow();
    });

    it('respects custom diffusion coefficient', function () {
      var fast = calc.calculate({ constructVolume_mL: 1, customDiffCoeff: 5e-5 });
      var slow = calc.calculate({ constructVolume_mL: 1, customDiffCoeff: 1e-6 });
      expect(fast.soakPerCycle_min).toBeLessThanOrEqual(slow.soakPerCycle_min);
    });

    it('steps residual decreases monotonically', function () {
      var result = calc.calculate({ constructVolume_mL: 0.5 });
      for (var i = 1; i < result.steps.length; i++) {
        expect(result.steps[i].estimatedResidual_mM).toBeLessThan(result.steps[i - 1].estimatedResidual_mM);
      }
    });

    it('defaults to alginate-CaCl2 when no material given', function () {
      var result = calc.calculate({ constructVolume_mL: 1 });
      expect(result.materialKey).toBe('alginate-CaCl2');
    });
  });

  describe('compare', function () {
    it('returns entries for all non-custom materials', function () {
      var results = calc.compare(1.0);
      expect(results.length).toBeGreaterThanOrEqual(4);
      results.forEach(function (r) {
        expect(r.cycles).toBeGreaterThan(0);
        expect(r.totalWashVolume_mL).toBeGreaterThan(0);
      });
    });
  });

  describe('formatProtocol', function () {
    it('produces readable text', function () {
      var protocol = calc.calculate({ constructVolume_mL: 0.5 });
      var text = calc.formatProtocol(protocol);
      expect(text).toContain('WASH PROTOCOL');
      expect(text).toContain('Steps');
      expect(text).toContain('MET');
    });
  });
});
