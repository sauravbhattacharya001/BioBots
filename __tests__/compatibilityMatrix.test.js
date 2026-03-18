'use strict';

var compatibilityMatrix = require('../docs/shared/compatibilityMatrix');

describe('Compatibility Matrix', function () {
  var matrix;

  beforeEach(function () {
    matrix = compatibilityMatrix.createCompatibilityMatrix();
  });

  describe('check()', function () {
    test('returns scored result for bioink + cell type', function () {
      var r = matrix.check({ bioink: 'alginate', cellType: 'chondrocyte' });
      expect(r.score).toBe(95);
      expect(r.grade).toBe('A');
      expect(r.bioink).toBe('Alginate');
      expect(r.breakdown.cellType.score).toBe(95);
    });

    test('averages multiple dimensions', function () {
      var r = matrix.check({ bioink: 'alginate', cellType: 'chondrocyte', crosslinker: 'cacl2', method: 'extrusion' });
      expect(r.score).toBe(Math.round((95 + 98 + 95) / 3));
      expect(r.breakdown.crosslinker).toBeDefined();
      expect(r.breakdown.method).toBeDefined();
    });

    test('throws on unknown bioink', function () {
      expect(function () { matrix.check({ bioink: 'unobtanium' }); }).toThrow(/Unknown bioink/);
    });

    test('throws on unknown cell type', function () {
      expect(function () { matrix.check({ bioink: 'alginate', cellType: 'alien' }); }).toThrow(/Unknown cell type/);
    });

    test('includes recommendations', function () {
      var r = matrix.check({ bioink: 'gelatin_methacryloyl', cellType: 'fibroblast' });
      expect(r.recommendations.topCrosslinkers.length).toBeGreaterThan(0);
      expect(r.recommendations.topMethods.length).toBeGreaterThan(0);
    });

    test('generates contextual notes', function () {
      var r = matrix.check({ bioink: 'pluronic', cellType: 'cardiomyocyte', method: 'dlp' });
      expect(r.notes.length).toBeGreaterThan(0);
      expect(r.notes.some(function (n) { return n.includes('non-biodegradable'); })).toBe(true);
    });
  });

  describe('bestFor()', function () {
    test('ranks bioinks for a cell type', function () {
      var results = matrix.bestFor('chondrocyte');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    });

    test('respects topN', function () {
      var results = matrix.bestFor('fibroblast', 3);
      expect(results.length).toBe(3);
    });
  });

  describe('compare()', function () {
    test('compares two combos', function () {
      var r = matrix.compare(
        { bioink: 'alginate', cellType: 'chondrocyte' },
        { bioink: 'peg', cellType: 'chondrocyte' }
      );
      expect(r.winner).toBe('A');
      expect(r.scoreDiff).toBe(20);
    });
  });

  describe('listBioinks()', function () {
    test('returns all bioinks with metadata', function () {
      var list = matrix.listBioinks();
      expect(list.length).toBe(8);
      expect(list[0].key).toBeDefined();
      expect(list[0].supportedCellTypes).toBeGreaterThan(0);
    });
  });

  describe('listOptions()', function () {
    test('returns cell types, crosslinkers, methods', function () {
      var opts = matrix.listOptions();
      expect(opts.cellTypes.length).toBe(10);
      expect(opts.crosslinkers.length).toBeGreaterThan(0);
      expect(opts.methods.length).toBe(4);
    });
  });

  describe('heatmap()', function () {
    test('returns full matrix', function () {
      var h = matrix.heatmap();
      expect(h.bioinks.length).toBe(8);
      expect(h.cellTypes.length).toBe(10);
      expect(h.matrix.length).toBe(8);
      expect(h.matrix[0].length).toBe(10);
    });
  });
});
