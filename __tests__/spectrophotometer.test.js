/**
 * Tests for Spectrophotometer Reading Analyzer.
 */
'use strict';

var mod = require('../docs/shared/spectrophotometer');
var createSpectrophotometer = mod.createSpectrophotometer;

describe('Spectrophotometer', function () {
  var spec;

  beforeEach(function () {
    spec = createSpectrophotometer();
  });

  /* ── OD600 Cell Density ── */

  describe('estimateCellDensity', function () {
    it('calculates E. coli density from single reading', function () {
      var result = spec.estimateCellDensity({ od600: 0.3 });
      expect(result.organism).toBe('e.coli');
      expect(result.estimatedCellsPerMl).toBe(240000000);
      expect(result.warnings.length).toBe(0);
    });

    it('handles replicate readings', function () {
      var result = spec.estimateCellDensity({ od600: [0.28, 0.30, 0.32] });
      expect(result.correctedMean).toBe(0.3);
      expect(result.standardDeviation).toBeGreaterThan(0);
    });

    it('warns when OD exceeds linear range', function () {
      var result = spec.estimateCellDensity({ od600: 0.8 });
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain('linear range');
    });

    it('supports dilution factor', function () {
      var result = spec.estimateCellDensity({ od600: 0.2, dilution: 10 });
      expect(result.effectiveOD).toBe(2);
      expect(result.estimatedCellsPerMl).toBe(1600000000);
    });

    it('subtracts blank OD', function () {
      var result = spec.estimateCellDensity({ od600: 0.35, blankOD: 0.05 });
      expect(result.correctedMean).toBe(0.3);
    });

    it('supports yeast organism', function () {
      var result = spec.estimateCellDensity({ od600: 0.5, organism: 's.cerevisiae' });
      expect(result.organism).toBe('s.cerevisiae');
      expect(result.estimatedCellsPerMl).toBe(15000000);
    });

    it('throws on unknown organism', function () {
      expect(function () {
        spec.estimateCellDensity({ od600: 0.3, organism: 'alien' });
      }).toThrow('Unknown organism');
    });

    it('throws on missing od600', function () {
      expect(function () {
        spec.estimateCellDensity({});
      }).toThrow();
    });
  });

  /* ── Nucleic Acid Quantification ── */

  describe('quantifyNucleicAcid', function () {
    it('quantifies pure dsDNA', function () {
      var result = spec.quantifyNucleicAcid({ a260: 0.5, a280: 0.27 });
      expect(result.type).toBe('dsDNA');
      expect(result.concentrationNgPerUl).toBe(25);
      expect(result.a260a280).toBe(1.85);
      expect(result.quality).toBe('good');
    });

    it('detects protein contamination', function () {
      var result = spec.quantifyNucleicAcid({ a260: 0.5, a280: 0.4 });
      expect(result.a260a280).toBe(1.25);
      expect(result.quality).toBe('contaminated');
    });

    it('handles RNA type', function () {
      var result = spec.quantifyNucleicAcid({ a260: 1.0, a280: 0.5, type: 'RNA' });
      expect(result.type).toBe('RNA');
      expect(result.concentrationNgPerUl).toBe(40);
      expect(result.a260a280).toBe(2);
      expect(result.quality).toBe('good');
    });

    it('includes A260/A230 when provided', function () {
      var result = spec.quantifyNucleicAcid({ a260: 0.5, a280: 0.27, a230: 0.24 });
      expect(result.a260a230).toBe(2.08);
      expect(result.quality).toBe('good');
    });

    it('warns on low A260/A230', function () {
      var result = spec.quantifyNucleicAcid({ a260: 0.5, a280: 0.27, a230: 0.5 });
      expect(result.a260a230).toBe(1);
      expect(result.quality).toBe('contaminated');
    });

    it('applies dilution factor', function () {
      var result = spec.quantifyNucleicAcid({ a260: 0.1, a280: 0.054, dilution: 10 });
      expect(result.concentrationNgPerUl).toBe(50);
    });

    it('throws on missing a260', function () {
      expect(function () {
        spec.quantifyNucleicAcid({ a280: 0.3 });
      }).toThrow('a260');
    });
  });

  /* ── Protein Concentration ── */

  describe('calculateProteinConcentration', function () {
    var standards = [
      { concentration: 0, absorbance: 0 },
      { concentration: 125, absorbance: 0.15 },
      { concentration: 250, absorbance: 0.30 },
      { concentration: 500, absorbance: 0.60 },
      { concentration: 1000, absorbance: 1.20 }
    ];

    it('interpolates sample from standard curve', function () {
      var result = spec.calculateProteinConcentration({
        standards: standards,
        sampleAbsorbance: 0.45
      });
      expect(result.standardCurve.rSquared).toBeGreaterThan(0.99);
      expect(result.samples[0].concentration).toBeCloseTo(375, 0);
    });

    it('handles multiple samples', function () {
      var result = spec.calculateProteinConcentration({
        standards: standards,
        sampleAbsorbance: [0.30, 0.60, 0.90]
      });
      expect(result.samples.length).toBe(3);
    });

    it('warns on absorbance above standard range', function () {
      var result = spec.calculateProteinConcentration({
        standards: standards,
        sampleAbsorbance: 2.0
      });
      expect(result.samples[0].warnings.length).toBeGreaterThan(0);
    });

    it('throws on insufficient standards', function () {
      expect(function () {
        spec.calculateProteinConcentration({
          standards: [{ concentration: 0, absorbance: 0 }],
          sampleAbsorbance: 0.5
        });
      }).toThrow('At least 2 standards');
    });
  });

  /* ── Beer-Lambert ── */

  describe('beerLambert', function () {
    it('solves for concentration', function () {
      var result = spec.beerLambert({ absorbance: 1.0, molarExtinction: 6600 });
      expect(result.solved).toBe('concentration');
      expect(result.concentrationMolPerL).toBeCloseTo(0.0001515, 6);
    });

    it('solves for absorbance', function () {
      var result = spec.beerLambert({ molarExtinction: 6600, concentration: 0.001 });
      expect(result.solved).toBe('absorbance');
      expect(result.absorbance).toBe(6.6);
    });

    it('solves for molar extinction', function () {
      var result = spec.beerLambert({ absorbance: 1.0, concentration: 0.001 });
      expect(result.solved).toBe('molarExtinction');
      expect(result.molarExtinction).toBe(1000);
    });

    it('respects pathlength', function () {
      var result = spec.beerLambert({ absorbance: 1.0, molarExtinction: 6600, pathlength: 0.5 });
      expect(result.concentrationMolPerL).toBeCloseTo(0.000303, 5);
    });

    it('throws when all three provided', function () {
      expect(function () {
        spec.beerLambert({ absorbance: 1, molarExtinction: 100, concentration: 0.01 });
      }).toThrow('exactly two');
    });
  });
});
