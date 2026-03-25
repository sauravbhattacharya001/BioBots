'use strict';

var electroporation = require('../docs/shared/electroporation');

describe('ElectroporationCalculator', function () {
  var calc;

  beforeEach(function () {
    calc = electroporation.createElectroporationCalculator();
  });

  describe('fieldStrengthToVoltage', function () {
    it('calculates voltage from field strength and gap', function () {
      expect(calc.fieldStrengthToVoltage(250, 0.2)).toBe(50);
      expect(calc.fieldStrengthToVoltage(1800, 0.1)).toBe(180);
    });

    it('throws on invalid inputs', function () {
      expect(function () { calc.fieldStrengthToVoltage(-1, 0.2); }).toThrow();
      expect(function () { calc.fieldStrengthToVoltage(250, 0); }).toThrow();
    });
  });

  describe('voltageToFieldStrength', function () {
    it('calculates field strength from voltage and gap', function () {
      expect(calc.voltageToFieldStrength(50, 0.2)).toBe(250);
    });
  });

  describe('pulseEnergy', function () {
    it('calculates energy for capacitor discharge', function () {
      var energy = calc.pulseEnergy(100, 25);
      expect(energy).toBeGreaterThan(0);
      // E = 0.5 * 25e-6 * 100^2 = 0.125 J
      expect(energy).toBeCloseTo(0.125, 3);
    });
  });

  describe('timeConstant', function () {
    it('calculates RC time constant in ms', function () {
      var tau = calc.timeConstant(200, 25);
      // τ = 200 * 25e-6 = 0.005 s = 5 ms
      expect(tau).toBe(5);
    });
  });

  describe('estimateSurvival', function () {
    it('returns high survival at optimal field strength', function () {
      var survival = calc.estimateSurvival(250, 'HEK293', 1);
      expect(survival).toBeGreaterThan(0.8);
    });

    it('returns lower survival at high field strength', function () {
      var s1 = calc.estimateSurvival(250, 'HEK293', 1);
      var s2 = calc.estimateSurvival(500, 'HEK293', 1);
      expect(s2).toBeLessThan(s1);
    });

    it('reduces survival with more pulses', function () {
      var s1 = calc.estimateSurvival(250, 'HEK293', 1);
      var s3 = calc.estimateSurvival(250, 'HEK293', 5);
      expect(s3).toBeLessThan(s1);
    });

    it('throws on unknown cell type', function () {
      expect(function () { calc.estimateSurvival(250, 'UNKNOWN'); }).toThrow(/Unknown cell type/);
    });
  });

  describe('estimateTransfection', function () {
    it('returns reasonable efficiency at optimal field strength', function () {
      var eff = calc.estimateTransfection(250, 'HEK293', 1);
      expect(eff).toBeGreaterThan(0.5);
      expect(eff).toBeLessThanOrEqual(1);
    });
  });

  describe('generateProtocol', function () {
    it('generates a complete protocol', function () {
      var protocol = calc.generateProtocol({ cellType: 'HEK293' });
      expect(protocol.cellType).toBe('HEK293');
      expect(protocol.voltageV).toBeGreaterThan(0);
      expect(protocol.estimatedSurvival).toBeGreaterThan(0);
      expect(protocol.estimatedTransfection).toBeGreaterThan(0);
      expect(Array.isArray(protocol.warnings)).toBe(true);
    });

    it('generates warnings for excessive voltage', function () {
      var protocol = calc.generateProtocol({
        cellType: 'E.coli',
        cuvette: '1mm'
      });
      // E.coli optimal is 1800 V/cm, 1mm cuvette max is 500V, needed 180V — should be fine
      // Let's force high field strength
      var protocol2 = calc.generateProtocol({
        cellType: 'HEK293',
        cuvette: '1mm',
        fieldStrengthVcm: 6000
      });
      expect(protocol2.warnings.length).toBeGreaterThan(0);
    });

    it('throws on missing cellType', function () {
      expect(function () { calc.generateProtocol({}); }).toThrow(/cellType/);
    });
  });

  describe('compareProtocols', function () {
    it('compares baseline with variations', function () {
      var result = calc.compareProtocols(
        { cellType: 'HEK293' },
        [{ numPulses: 3 }, { fieldStrengthVcm: 400 }]
      );
      expect(result.baseline).toBeDefined();
      expect(result.variations.length).toBe(2);
    });
  });

  describe('listCellPresets', function () {
    it('returns all presets', function () {
      var presets = calc.listCellPresets();
      expect(presets.length).toBeGreaterThan(5);
      expect(presets[0].cellType).toBeDefined();
    });
  });

  describe('listCuvettes', function () {
    it('returns all cuvette specs', function () {
      var cuvettes = calc.listCuvettes();
      expect(cuvettes.length).toBe(3);
    });
  });
});
