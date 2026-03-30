/**
 * Tests for Sterility Assurance Calculator
 */
'use strict';

var mod = require('../docs/shared/sterilityAssurance');

describe('SterilityAssurance', function() {
  var sa;

  beforeEach(function() {
    sa = mod.createSterilityAssurance();
  });

  /* ---------- calculateSAL ---------- */

  describe('calculateSAL', function() {
    test('calculates correct log reduction for autoclave', function() {
      var r = sa.calculateSAL({ method: 'autoclave', exposureTime: 15, bioburden: 100 });
      expect(r.logReduction).toBe(10);
      expect(r.salExponent).toBe(-10);
      expect(r.meetsPharmaSAL).toBe(true);
      expect(r.method).toBe('Autoclave (Steam)');
    });

    test('short exposure gives insufficient grade', function() {
      var r = sa.calculateSAL({ method: 'autoclave', exposureTime: 2, bioburden: 100 });
      expect(r.grade).toContain('Insufficient');
      expect(r.meetsPharmaSAL).toBe(false);
    });

    test('moderate exposure gives acceptable grade', function() {
      var r = sa.calculateSAL({ method: 'autoclave', exposureTime: 6, bioburden: 100 });
      expect(r.grade).toContain('Acceptable');
    });

    test('throws on missing method', function() {
      expect(function() { sa.calculateSAL({}); }).toThrow('method is required');
    });

    test('throws on unknown method', function() {
      expect(function() { sa.calculateSAL({ method: 'plasma', exposureTime: 5 }); }).toThrow('Unknown method');
    });

    test('throws on invalid exposure time', function() {
      expect(function() { sa.calculateSAL({ method: 'autoclave', exposureTime: -1 }); }).toThrow(/positive.*number/);
    });

    test('throws for filtration method', function() {
      expect(function() { sa.calculateSAL({ method: 'filtration', exposureTime: 1 }); }).toThrow('not applicable');
    });

    test('respects custom dValue', function() {
      var r = sa.calculateSAL({ method: 'autoclave', exposureTime: 10, dValue: 2.0 });
      expect(r.logReduction).toBe(5);
      expect(r.dValue).toBe(2.0);
    });

    test('uses default bioburden of 100', function() {
      var r = sa.calculateSAL({ method: 'dryHeat', exposureTime: 50 });
      expect(r.bioburden).toBe(100);
    });

    test('calculates surviving CFU', function() {
      var r = sa.calculateSAL({ method: 'uvLight', exposureTime: 8, bioburden: 1000 });
      expect(r.survivingCfu).toBeLessThan(r.bioburden);
    });
  });

  /* ---------- calculateExposureTime ---------- */

  describe('calculateExposureTime', function() {
    test('calculates min and recommended exposure', function() {
      var r = sa.calculateExposureTime({ method: 'autoclave', bioburden: 100, targetSAL: -6 });
      expect(r.minimumExposure).toBeGreaterThan(0);
      expect(r.recommendedExposure).toBeGreaterThan(r.minimumExposure);
      expect(r.safetyFactor).toBe(1.5);
    });

    test('higher bioburden needs more exposure', function() {
      var low = sa.calculateExposureTime({ method: 'autoclave', bioburden: 10 });
      var high = sa.calculateExposureTime({ method: 'autoclave', bioburden: 10000 });
      expect(high.minimumExposure).toBeGreaterThan(low.minimumExposure);
    });

    test('stricter SAL needs more exposure', function() {
      var a = sa.calculateExposureTime({ method: 'autoclave', targetSAL: -3 });
      var b = sa.calculateExposureTime({ method: 'autoclave', targetSAL: -9 });
      expect(b.minimumExposure).toBeGreaterThan(a.minimumExposure);
    });

    test('includes temperature when applicable', function() {
      var r = sa.calculateExposureTime({ method: 'autoclave' });
      expect(r.temperatureC).toBe(121);
    });

    test('custom safety factor applies', function() {
      var r = sa.calculateExposureTime({ method: 'autoclave', safetyFactor: 2.0 });
      expect(r.recommendedExposure).toBe(r.minimumExposure * 2.0);
    });

    test('throws on missing method', function() {
      expect(function() { sa.calculateExposureTime({}); }).toThrow('method is required');
    });

    test('returns correct unit', function() {
      var r = sa.calculateExposureTime({ method: 'gammaIrradiation' });
      expect(r.unit).toBe('kGy');
    });
  });

  /* ---------- assessContaminationRisk ---------- */

  describe('assessContaminationRisk', function() {
    test('low risk for ideal conditions', function() {
      var r = sa.assessContaminationRisk({
        components: [{ component: 'bioink', bioburden: 100, sterilized: true }],
        cleanRoomISO: 5,
        operatorCount: 1,
        printDurationHours: 1,
        asepticTransfer: true
      });
      expect(r.riskLevel).toBe('LOW');
      expect(r.riskScore).toBeLessThanOrEqual(0.3);
    });

    test('higher risk with poor conditions', function() {
      var r = sa.assessContaminationRisk({
        components: [
          { component: 'bioink', bioburden: 100, sterilized: false },
          { component: 'tubing', bioburden: 200, sterilized: false },
          { component: 'cartridge', bioburden: 150, sterilized: false },
          { component: 'printhead', bioburden: 50, sterilized: false }
        ],
        cleanRoomISO: 8,
        operatorCount: 5,
        printDurationHours: 20,
        asepticTransfer: false
      });
      expect(r.riskScore).toBeGreaterThan(0.6);
    });

    test('returns factors array', function() {
      var r = sa.assessContaminationRisk({ components: [] });
      expect(r.factors.length).toBe(5);
    });

    test('returns mitigations', function() {
      var r = sa.assessContaminationRisk({
        components: [{ component: 'bioink', sterilized: false }],
        asepticTransfer: false
      });
      expect(r.mitigations.length).toBeGreaterThan(0);
    });

    test('throws on null options', function() {
      expect(function() { sa.assessContaminationRisk(); }).toThrow();
    });

    test('defaults work', function() {
      var r = sa.assessContaminationRisk({});
      expect(r.riskScore).toBeGreaterThanOrEqual(0);
    });
  });

  /* ---------- recommendCleanRoom ---------- */

  describe('recommendCleanRoom', function() {
    test('implantable gets ISO 5', function() {
      var r = sa.recommendCleanRoom({ application: 'implantable' });
      expect(r.recommendedClass.iso).toBe(5);
    });

    test('gmp gets ISO 5', function() {
      var r = sa.recommendCleanRoom({ application: 'gmp' });
      expect(r.recommendedClass.iso).toBe(5);
    });

    test('research with cells gets ISO 6', function() {
      var r = sa.recommendCleanRoom({ application: 'research', cellBased: true });
      expect(r.recommendedClass.iso).toBe(6);
    });

    test('research without cells gets ISO 7', function() {
      var r = sa.recommendCleanRoom({ application: 'research', cellBased: false });
      expect(r.recommendedClass.iso).toBe(7);
    });

    test('strict SAL upgrades class', function() {
      var r = sa.recommendCleanRoom({ application: 'research', cellBased: false, targetSAL: -9 });
      expect(r.recommendedClass.iso).toBe(6);
    });

    test('includes additional controls', function() {
      var r = sa.recommendCleanRoom({ application: 'gmp', cellBased: true });
      expect(r.additionalControls.length).toBeGreaterThan(2);
    });

    test('returns all classes', function() {
      var r = sa.recommendCleanRoom({ application: 'general' });
      expect(r.allClasses.length).toBe(4);
    });

    test('throws on missing application', function() {
      expect(function() { sa.recommendCleanRoom({}); }).toThrow('application is required');
    });
  });

  /* ---------- planSterilization ---------- */

  describe('planSterilization', function() {
    test('assigns autoclave for heat/moisture tolerant', function() {
      var r = sa.planSterilization([{ component: 'bioink', bioburden: 100 }]);
      expect(r.steps[0].methodKey).toBe('autoclave');
    });

    test('assigns EtO for heat+moisture sensitive', function() {
      var r = sa.planSterilization([{ component: 'sensor', heatSensitive: true, moistureSensitive: true }]);
      expect(r.steps[0].methodKey).toBe('ethyleneOxide');
    });

    test('assigns H2O2 for heat sensitive only', function() {
      var r = sa.planSterilization([{ component: 'tubing', heatSensitive: true }]);
      expect(r.steps[0].methodKey).toBe('hydrogenPeroxide');
    });

    test('assigns dry heat for moisture sensitive only', function() {
      var r = sa.planSterilization([{ component: 'powder', moistureSensitive: true }]);
      expect(r.steps[0].methodKey).toBe('dryHeat');
    });

    test('groups components by method', function() {
      var r = sa.planSterilization([
        { component: 'a' },
        { component: 'b' },
        { component: 'c', heatSensitive: true }
      ]);
      expect(r.methodsUsed).toBe(2);
    });

    test('uses default bioburden from BIOBURDEN_DEFAULTS', function() {
      var r = sa.planSterilization([{ component: 'tubing' }]);
      expect(r.steps[0].bioburden).toBe(200);
    });

    test('throws on empty array', function() {
      expect(function() { sa.planSterilization([]); }).toThrow('At least one');
    });

    test('returns target SAL', function() {
      var r = sa.planSterilization([{ component: 'x' }], -9);
      expect(r.targetSAL).toBe('10^-9');
    });

    test('includes constraint info', function() {
      var r = sa.planSterilization([{ component: 'x', heatSensitive: true, moistureSensitive: true }]);
      expect(r.steps[0].constraints.heatSensitive).toBe(true);
      expect(r.steps[0].constraints.moistureSensitive).toBe(true);
    });
  });

  /* ---------- constants ---------- */

  describe('constants', function() {
    test('exposes sterilization methods', function() {
      expect(Object.keys(sa.STERILIZATION_METHODS).length).toBeGreaterThanOrEqual(6);
    });

    test('exposes clean room classes', function() {
      expect(sa.CLEAN_ROOM_CLASSES.length).toBe(4);
    });

    test('exposes bioburden defaults', function() {
      expect(sa.BIOBURDEN_DEFAULTS.bioink.typical).toBe(100);
    });

    test('exposes risk thresholds', function() {
      expect(sa.RISK_THRESHOLDS.low.max).toBe(0.3);
    });
  });
});
