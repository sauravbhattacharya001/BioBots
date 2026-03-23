'use strict';

var cellCounter = require('../docs/shared/cellCounter');

describe('Cell Counter', function () {
  var counter;

  beforeEach(function () {
    counter = cellCounter.createCellCounter();
  });

  describe('calculateConcentration', function () {
    test('basic count with default chamber', function () {
      var result = counter.calculateConcentration({
        counts: [45, 50, 55, 48]
      });
      expect(result.chamberType).toBe('improved-neubauer');
      expect(result.squaresCounted).toBe(4);
      expect(result.totalCellsCounted).toBe(198);
      expect(result.averagePerSquare).toBe(49.5);
      // 49.5 / 0.0001 * 1 = 495000
      expect(result.cellsPerMl).toBe(495000);
      expect(result.quality).toBe('good');
    });

    test('applies dilution factor', function () {
      var result = counter.calculateConcentration({
        counts: [50, 50, 50, 50],
        dilutionFactor: 10
      });
      // 50 / 0.0001 * 10 = 5,000,000
      expect(result.cellsPerMl).toBe(5000000);
    });

    test('warns on high variability', function () {
      var result = counter.calculateConcentration({
        counts: [10, 80, 15, 90]
      });
      expect(result.quality).not.toBe('good');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    test('warns on low counts', function () {
      var result = counter.calculateConcentration({
        counts: [3, 5, 4, 2]
      });
      expect(result.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('Low cell count')
      ]));
    });

    test('warns on high counts', function () {
      var result = counter.calculateConcentration({
        counts: [150, 160, 140, 155]
      });
      expect(result.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('further dilution')
      ]));
    });

    test('supports fuchs-rosenthal chamber', function () {
      var result = counter.calculateConcentration({
        counts: [30, 35, 28, 32],
        chamber: 'fuchs-rosenthal'
      });
      // avg=31.25, vol=0.0002, dilution=1 → 31.25/0.0002 = 156250
      expect(result.cellsPerMl).toBe(156250);
    });

    test('rejects empty counts', function () {
      expect(function () {
        counter.calculateConcentration({ counts: [] });
      }).toThrow();
    });

    test('rejects unknown chamber', function () {
      expect(function () {
        counter.calculateConcentration({ counts: [10], chamber: 'unknown' });
      }).toThrow(/Unknown chamber/);
    });
  });

  describe('calculateViability', function () {
    test('calculates viability percentage', function () {
      var result = counter.calculateViability({ liveCells: 90, deadCells: 10 });
      expect(result.viabilityPercent).toBe(90);
      expect(result.assessment).toBe('good');
      expect(result.suitableForBioprinting).toBe(true);
    });

    test('poor viability', function () {
      var result = counter.calculateViability({ liveCells: 50, deadCells: 50 });
      expect(result.viabilityPercent).toBe(50);
      expect(result.assessment).toBe('poor');
      expect(result.suitableForBioprinting).toBe(false);
    });

    test('excellent viability', function () {
      var result = counter.calculateViability({ liveCells: 98, deadCells: 2 });
      expect(result.viabilityPercent).toBe(98);
      expect(result.assessment).toBe('excellent');
    });

    test('rejects zero total', function () {
      expect(function () {
        counter.calculateViability({ liveCells: 0, deadCells: 0 });
      }).toThrow(/zero/);
    });
  });

  describe('calculateDilutionPlan', function () {
    test('basic dilution', function () {
      var result = counter.calculateDilutionPlan({
        currentConcentration: 1000000,
        targetConcentration: 250000,
        targetVolumeMl: 10
      });
      expect(result.stockVolumeMl).toBe(2.5);
      expect(result.diluentVolumeMl).toBe(7.5);
      expect(result.dilutionRatio).toBe('1:4');
    });

    test('rejects target > current', function () {
      expect(function () {
        counter.calculateDilutionPlan({
          currentConcentration: 100,
          targetConcentration: 1000,
          targetVolumeMl: 5
        });
      }).toThrow(/cannot exceed/);
    });
  });

  describe('generateCountingReport', function () {
    test('full report', function () {
      var result = counter.generateCountingReport({
        liveCounts: [45, 50, 48, 52],
        deadCounts: [5, 3, 4, 6],
        cellLine: 'HeLa',
        operator: 'Dr. Smith'
      });
      expect(result.cellLine).toBe('HeLa');
      expect(result.viability.viabilityPercent).toBeGreaterThan(85);
      expect(result.summary).toContain('viable');
      expect(result.viableCellsPerMl).toBeGreaterThan(0);
    });

    test('rejects mismatched arrays', function () {
      expect(function () {
        counter.generateCountingReport({
          liveCounts: [10, 20],
          deadCounts: [5]
        });
      }).toThrow(/same length/);
    });
  });

  describe('getChamberTypes', function () {
    test('returns all chamber types', function () {
      var types = counter.getChamberTypes();
      expect(types).toContain('improved-neubauer');
      expect(types).toContain('fuchs-rosenthal');
    });
  });
});
