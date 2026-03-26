'use strict';

var mod = require('../docs/shared/gelElectrophoresis');

describe('Gel Electrophoresis Analyzer', function () {
  var analyzer;

  beforeEach(function () {
    analyzer = mod.createGelElectrophoresisAnalyzer();
  });

  describe('fitStandardCurve', function () {
    it('fits a log-linear curve from ladder bands', function () {
      var bands = [
        { size: 10000, distance: 10 },
        { size: 5000,  distance: 20 },
        { size: 1000,  distance: 40 },
        { size: 500,   distance: 50 },
        { size: 100,   distance: 70 }
      ];
      var curve = analyzer.fitStandardCurve(bands);
      expect(curve.rSquared).toBeGreaterThan(0.95);
      expect(typeof curve.predict).toBe('function');
      // Predict should return reasonable estimate near a known band
      var est = curve.predict(40);
      expect(est).toBeGreaterThan(500);
      expect(est).toBeLessThan(2000);
    });

    it('throws with fewer than 2 bands', function () {
      expect(function () {
        analyzer.fitStandardCurve([{ size: 100, distance: 10 }]);
      }).toThrow();
    });
  });

  describe('estimateMW', function () {
    it('estimates MW for unknown bands', function () {
      var ladder = [
        { size: 10000, distance: 10 },
        { size: 1000,  distance: 40 },
        { size: 100,   distance: 70 }
      ];
      var result = analyzer.estimateMW(ladder, [25, 55]);
      expect(result.estimates.length).toBe(2);
      expect(result.estimates[0].estimatedSize).toBeGreaterThan(1000);
      expect(result.estimates[1].estimatedSize).toBeLessThan(1000);
      expect(result.curve.rSquared).toBeGreaterThan(0.9);
    });
  });

  describe('analyzeIntensities', function () {
    it('calculates relative fractions', function () {
      var result = analyzer.analyzeIntensities([100, 200, 300]);
      expect(result.total).toBe(600);
      expect(result.bands.length).toBe(3);
      expect(result.bands[0].percent).toBeCloseTo(16.67, 1);
      expect(result.bands[2].percent).toBe(50);
    });

    it('handles single band', function () {
      var result = analyzer.analyzeIntensities([500]);
      expect(result.bands[0].percent).toBe(100);
    });
  });

  describe('predictDigest', function () {
    it('predicts fragments from cut sites', function () {
      var result = analyzer.predictDigest(5000, [1000, 3000]);
      expect(result.count).toBe(3);
      expect(result.fragments).toEqual([1000, 2000, 2000]);
      expect(result.sorted).toEqual([2000, 2000, 1000]);
    });

    it('throws for out-of-bounds cut site', function () {
      expect(function () {
        analyzer.predictDigest(1000, [0]);
      }).toThrow();
      expect(function () {
        analyzer.predictDigest(1000, [1000]);
      }).toThrow();
    });
  });

  describe('gelRecipe', function () {
    it('calculates agarose gel recipe', function () {
      var recipe = analyzer.gelRecipe({ percentage: 1, volumeMl: 100 });
      expect(recipe.agaroseGrams).toBe(1);
      expect(recipe.bufferMl).toBe(100);
      expect(recipe.bufferType).toBe('TAE');
      expect(recipe.etBrUl).toBe(5);
    });

    it('throws for unreasonable percentage', function () {
      expect(function () {
        analyzer.gelRecipe({ percentage: 10, volumeMl: 100 });
      }).toThrow();
    });
  });

  describe('recommendGelPercent', function () {
    it('recommends agarose % for DNA range', function () {
      var recs = analyzer.recommendGelPercent({ type: 'dna', minSize: 500, maxSize: 5000 });
      expect(recs.length).toBeGreaterThan(0);
      recs.forEach(function (r) { expect(r.pct).toBeGreaterThan(0); });
    });

    it('recommends PAGE % for protein range', function () {
      var recs = analyzer.recommendGelPercent({ type: 'protein', minSize: 20, maxSize: 100 });
      expect(recs.length).toBeGreaterThan(0);
    });
  });

  describe('getLadders', function () {
    it('returns all ladders when no type specified', function () {
      var all = analyzer.getLadders();
      expect(all.dna).toBeDefined();
      expect(all.protein).toBeDefined();
    });

    it('returns DNA ladders only', function () {
      var dna = analyzer.getLadders('dna');
      expect(dna['1kb']).toBeDefined();
    });

    it('throws for unknown type', function () {
      expect(function () { analyzer.getLadders('rna'); }).toThrow();
    });
  });
});
