'use strict';

var mixer = require('../docs/shared/mixer');

describe('BioinkMixer', function() {
    var m;
    beforeEach(function() { m = mixer.createBioinkMixer(); });

    describe('getMaterials', function() {
        it('returns all material profiles', function() {
            var mats = m.getMaterials();
            expect(Object.keys(mats).length).toBeGreaterThanOrEqual(8);
            expect(mats['alginate'].name).toBe('Alginate');
        });
    });

    describe('mix', function() {
        it('computes composite for two components', function() {
            var result = m.mix([
                { material: 'alginate', fraction: 0.6 },
                { material: 'gelatin-methacrylate', fraction: 0.4 }
            ], { totalVolumeMl: 10 });

            expect(result.composite.density).toBeCloseTo(1.032, 2);
            expect(result.composite.costPerMl).toBeCloseTo(7.28, 1);
            expect(result.composite.totalCost).toBeCloseTo(72.8, 0);
            expect(result.composite.viscosity).toBeGreaterThan(0);
            expect(result.composite.cellAdhesion).toBeGreaterThan(0);
            expect(result.breakdown).toHaveLength(2);
            expect(result.breakdown[0].volumeMl).toBeCloseTo(6, 1);
        });

        it('throws on empty components', function() {
            expect(function() { m.mix([]); }).toThrow(/non-empty/);
        });

        it('throws on invalid material', function() {
            expect(function() {
                m.mix([{ material: 'unobtanium', fraction: 1.0 }]);
            }).toThrow(/Unknown material/);
        });

        it('throws when fractions do not sum to 1', function() {
            expect(function() {
                m.mix([
                    { material: 'alginate', fraction: 0.3 },
                    { material: 'fibrin', fraction: 0.3 }
                ]);
            }).toThrow(/sum to 1/);
        });

        it('handles single component', function() {
            var result = m.mix([{ material: 'collagen-type-1', fraction: 1.0 }]);
            expect(result.composite.density).toBeCloseTo(1.08, 2);
            expect(result.compatibility.score).toBe(1.0);
        });

        it('defaults totalVolumeMl to 1', function() {
            var result = m.mix([{ material: 'alginate', fraction: 1.0 }]);
            expect(result.totalVolumeMl).toBe(1);
        });
    });

    describe('compatibility', function() {
        it('detects synergistic pairs', function() {
            var result = m.computeCompatibility([
                { material: 'alginate', fraction: 0.5 },
                { material: 'gelatin-methacrylate', fraction: 0.5 }
            ]);
            expect(result.score).toBeGreaterThan(1.0);
            expect(result.pairs[0].synergy).toBe('synergistic');
        });

        it('detects antagonistic pairs', function() {
            var result = m.computeCompatibility([
                { material: 'pluronic-f127', fraction: 0.5 },
                { material: 'collagen-type-1', fraction: 0.5 }
            ]);
            expect(result.score).toBeLessThan(1.0);
        });
    });

    describe('temperature range', function() {
        it('finds overlapping range', function() {
            var result = m.computeTempRange([
                { material: 'alginate', fraction: 0.5 },
                { material: 'gelatin-methacrylate', fraction: 0.5 }
            ]);
            expect(result.feasible).toBe(true);
            expect(result.min).toBe(20);
            expect(result.max).toBe(37);
        });

        it('flags infeasible range', function() {
            var result = m.computeTempRange([
                { material: 'collagen-type-1', fraction: 0.5 },  // max 25
                { material: 'pectin', fraction: 0.5 }             // min 18.. max 45
            ]);
            // collagen max=25 overlaps pectin min=18, so feasible
            expect(result.feasible).toBe(true);
        });
    });

    describe('printability', function() {
        it('rates low viscosity as poor', function() {
            expect(m.assessPrintability(50).rating).toBe('poor');
        });
        it('rates medium viscosity as good', function() {
            expect(m.assessPrintability(500).rating).toBe('good');
        });
        it('rates very high viscosity as challenging', function() {
            expect(m.assessPrintability(3000).rating).toBe('challenging');
        });
    });
});
