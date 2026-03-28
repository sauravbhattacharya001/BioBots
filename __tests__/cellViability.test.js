'use strict';

var mod = require('../docs/shared/cellViability');

describe('Cell Viability Calculator', function () {
    var calc;
    beforeEach(function () { calc = mod.createCellViabilityCalculator(); });

    describe('fromCounts', function () {
        it('computes viability from live/dead counts', function () {
            var r = calc.fromCounts({ live: 180, dead: 20 });
            expect(r.viabilityPct).toBe(90);
            expect(r.totalCells).toBe(200);
        });
        it('throws on zero total', function () {
            expect(function () { calc.fromCounts({ live: 0, dead: 0 }); }).toThrow();
        });
    });

    describe('fromAbsorbance', function () {
        it('computes blank-corrected viability', function () {
            var r = calc.fromAbsorbance({ treated: 0.45, control: 0.9, blank: 0.05 });
            expect(r.viabilityPct).toBeCloseTo(47.06, 1);
        });
    });

    describe('fromLdh', function () {
        it('computes cytotoxicity and viability', function () {
            var r = calc.fromLdh({ experimental: 0.8, spontaneous: 0.2, maximum: 1.5 });
            expect(r.cytotoxicityPct).toBeCloseTo(46.15, 1);
            expect(r.viabilityPct).toBeCloseTo(53.85, 1);
        });
    });

    describe('fromFluorescence', function () {
        it('computes viability from fluorescence signals', function () {
            var r = calc.fromFluorescence({ liveFluorescence: 800, deadFluorescence: 200 });
            expect(r.viabilityPct).toBe(80);
        });
    });

    describe('batchCounts', function () {
        it('computes mean and SD across replicates', function () {
            var r = calc.batchCounts([
                { live: 90, dead: 10 },
                { live: 85, dead: 15 },
                { live: 92, dead: 8 }
            ]);
            expect(r.n).toBe(3);
            expect(r.mean).toBeGreaterThan(85);
            expect(r.sd).toBeGreaterThan(0);
        });
    });

    describe('doseResponse', function () {
        it('returns sorted curve and estimates IC50', function () {
            var r = calc.doseResponse([
                { concentration: 100, treated: 0.1, control: 1.0 },
                { concentration: 10, treated: 0.5, control: 1.0 },
                { concentration: 1, treated: 0.9, control: 1.0 },
                { concentration: 50, treated: 0.3, control: 1.0 }
            ]);
            expect(r.curve.length).toBe(4);
            expect(r.curve[0].concentration).toBe(1);
            expect(r.ic50).not.toBeNull();
        });
    });
});
