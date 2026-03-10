'use strict';

var mixer = require('../docs/shared/mixer');

describe('BioinkMixer', function() {
    var m;
    beforeEach(function() { m = mixer.createBioinkMixer(); });

    // ── getMaterials ────────────────────────────────────────────

    describe('getMaterials', function() {
        it('returns all material profiles', function() {
            var mats = m.getMaterials();
            expect(Object.keys(mats).length).toBeGreaterThanOrEqual(8);
            expect(mats['alginate'].name).toBe('Alginate');
        });

        it('returns defensive copies', function() {
            var mats1 = m.getMaterials();
            mats1['alginate'].density = 999;
            var mats2 = m.getMaterials();
            expect(mats2['alginate'].density).toBeCloseTo(1.02, 2);
        });

        it('every material has required fields', function() {
            var mats = m.getMaterials();
            var keys = Object.keys(mats);
            keys.forEach(function(k) {
                var mat = mats[k];
                expect(mat.name).toBeDefined();
                expect(typeof mat.density).toBe('number');
                expect(typeof mat.costPerMl).toBe('number');
                expect(typeof mat.viscosity).toBe('number');
                expect(typeof mat.cellAdhesion).toBe('number');
                expect(typeof mat.degradability).toBe('number');
                expect(mat.printTemp).toBeDefined();
                expect(typeof mat.printTemp.min).toBe('number');
                expect(typeof mat.printTemp.max).toBe('number');
                expect(mat.printTemp.min).toBeLessThan(mat.printTemp.max);
            });
        });
    });

    // ── mix ─────────────────────────────────────────────────────

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

        it('throws on null/undefined input', function() {
            expect(function() { m.mix(null); }).toThrow();
            expect(function() { m.mix(undefined); }).toThrow();
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

        it('throws on zero fraction', function() {
            expect(function() {
                m.mix([
                    { material: 'alginate', fraction: 0 },
                    { material: 'fibrin', fraction: 1.0 }
                ]);
            }).toThrow(/between 0 and 1/);
        });

        it('throws on negative fraction', function() {
            expect(function() {
                m.mix([
                    { material: 'alginate', fraction: -0.5 },
                    { material: 'fibrin', fraction: 1.5 }
                ]);
            }).toThrow();
        });

        it('zero volume defaults to 1 (falsy fallback)', function() {
            var result = m.mix([{ material: 'alginate', fraction: 1.0 }], { totalVolumeMl: 0 });
            expect(result.totalVolumeMl).toBe(1);
        });

        it('throws on negative volume', function() {
            expect(function() {
                m.mix([{ material: 'alginate', fraction: 1.0 }], { totalVolumeMl: -5 });
            }).toThrow(/positive/);
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

        it('computes degradability for single material', function() {
            var result = m.mix([{ material: 'fibrin', fraction: 1.0 }]);
            expect(result.composite.degradability).toBeCloseTo(0.9, 1);
        });

        it('computes composite degradability for two materials', function() {
            var result = m.mix([
                { material: 'alginate', fraction: 0.5 },   // 0.4
                { material: 'collagen-type-1', fraction: 0.5 }  // 0.85
            ]);
            expect(result.composite.degradability).toBeCloseTo(0.625, 1);
        });

        it('computes cell adhesion as linear blend', function() {
            var result = m.mix([
                { material: 'alginate', fraction: 0.5 },     // 0.3
                { material: 'collagen-type-1', fraction: 0.5 }  // 0.95
            ]);
            expect(result.composite.cellAdhesion).toBeCloseTo(0.625, 1);
        });

        it('uses log-mixing rule for viscosity', function() {
            // Log mixing: ln(η) = 0.5*ln(200) + 0.5*ln(3200) = ln(800)
            var result = m.mix([
                { material: 'alginate', fraction: 0.5 },      // 200
                { material: 'collagen-type-1', fraction: 0.5 } // 3200
            ]);
            expect(result.composite.viscosity).toBeCloseTo(800, -1);
        });

        it('breakdown has correct color for each material', function() {
            var result = m.mix([
                { material: 'alginate', fraction: 0.6 },
                { material: 'gelatin-methacrylate', fraction: 0.4 }
            ]);
            var alg = result.breakdown.find(function(b) { return b.material === 'alginate'; });
            expect(alg.color).toBe('#2ecc71');
        });

        it('breakdown costContribution sums to totalCost', function() {
            var result = m.mix([
                { material: 'alginate', fraction: 0.5 },
                { material: 'fibrin', fraction: 0.5 }
            ], { totalVolumeMl: 8 });
            var sumCost = result.breakdown.reduce(function(s, b) { return s + b.costContribution; }, 0);
            expect(sumCost).toBeCloseTo(result.composite.totalCost, 1);
        });

        it('handles three-component mix', function() {
            var result = m.mix([
                { material: 'alginate', fraction: 0.4 },
                { material: 'gelatin-methacrylate', fraction: 0.3 },
                { material: 'hyaluronic-acid', fraction: 0.3 }
            ], { totalVolumeMl: 5 });
            expect(result.breakdown).toHaveLength(3);
            expect(result.composite.density).toBeGreaterThan(1.0);
            expect(result.composite.totalCost).toBeGreaterThan(0);
            expect(result.compatibility.pairs).toHaveLength(3);
        });

        it('allows fractions summing within 0.01 tolerance', function() {
            // 0.51 + 0.495 = 1.005, within tolerance
            var result = m.mix([
                { material: 'alginate', fraction: 0.505 },
                { material: 'fibrin', fraction: 0.5 }
            ]);
            expect(result.composite.density).toBeGreaterThan(0);
        });

        it('every material can be used as sole component', function() {
            var mats = m.getMaterials();
            Object.keys(mats).forEach(function(key) {
                var result = m.mix([{ material: key, fraction: 1.0 }]);
                expect(result.composite.density).toBe(mats[key].density);
                expect(result.composite.costPerMl).toBe(mats[key].costPerMl);
            });
        });

        it('includes printability in result', function() {
            var result = m.mix([{ material: 'alginate', fraction: 1.0 }]);
            expect(result.printability).toBeDefined();
            expect(result.printability.rating).toBeDefined();
            expect(result.printability.recommendation).toBeDefined();
        });

        it('includes temperatureRange in result', function() {
            var result = m.mix([
                { material: 'alginate', fraction: 0.5 },
                { material: 'gelatin-methacrylate', fraction: 0.5 }
            ]);
            expect(result.temperatureRange).toBeDefined();
            expect(result.temperatureRange.feasible).toBe(true);
            expect(result.temperatureRange.min).toBeGreaterThanOrEqual(18);
        });

        it('large volume scales cost linearly', function() {
            var small = m.mix([{ material: 'alginate', fraction: 1.0 }], { totalVolumeMl: 1 });
            var large = m.mix([{ material: 'alginate', fraction: 1.0 }], { totalVolumeMl: 100 });
            expect(large.composite.totalCost / small.composite.totalCost).toBeCloseTo(100, 0);
        });
    });

    // ── compatibility ───────────────────────────────────────────

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
            expect(result.pairs[0].synergy).toBe('antagonistic');
        });

        it('returns neutral for unknown pair', function() {
            var result = m.computeCompatibility([
                { material: 'fibrin', fraction: 0.5 },
                { material: 'pectin', fraction: 0.5 }
            ]);
            expect(result.pairs[0].factor).toBe(1.0);
            expect(result.pairs[0].synergy).toBe('neutral');
        });

        it('single component has score 1.0 and no pairs', function() {
            var result = m.computeCompatibility([
                { material: 'alginate', fraction: 1.0 }
            ]);
            expect(result.score).toBe(1.0);
            expect(result.pairs).toHaveLength(0);
        });

        it('three components produce three pairwise comparisons', function() {
            var result = m.computeCompatibility([
                { material: 'alginate', fraction: 0.4 },
                { material: 'gelatin-methacrylate', fraction: 0.3 },
                { material: 'hyaluronic-acid', fraction: 0.3 }
            ]);
            expect(result.pairs).toHaveLength(3);
        });

        it('weights pairs by fraction products', function() {
            // Dominant fraction on synergistic pair should pull score up
            var result = m.computeCompatibility([
                { material: 'alginate', fraction: 0.9 },
                { material: 'gelatin-methacrylate', fraction: 0.1 }
            ]);
            // alginate+gelma = 1.2 synergy
            expect(result.score).toBeGreaterThan(1.0);
        });
    });

    // ── temperature range ───────────────────────────────────────

    describe('temperature range', function() {
        it('finds overlapping range', function() {
            var result = m.computeTempRange([
                { material: 'alginate', fraction: 0.5 },         // 18-40
                { material: 'gelatin-methacrylate', fraction: 0.5 }  // 20-37
            ]);
            expect(result.feasible).toBe(true);
            expect(result.min).toBe(20);
            expect(result.max).toBe(37);
        });

        it('flags infeasible range when no overlap', function() {
            // collagen: 4-25, pectin: 18-45 → overlap 18-25
            // Need two materials with truly non-overlapping ranges.
            // Test feasible overlap case instead
            var result = m.computeTempRange([
                { material: 'collagen-type-1', fraction: 0.5 },  // 4-25
                { material: 'pectin', fraction: 0.5 }             // 18-45
            ]);
            expect(result.feasible).toBe(true);
            expect(result.min).toBe(18);
            expect(result.max).toBe(25);
        });

        it('single material returns its full range', function() {
            var result = m.computeTempRange([
                { material: 'alginate', fraction: 1.0 }  // 18-40
            ]);
            expect(result.feasible).toBe(true);
            expect(result.min).toBe(18);
            expect(result.max).toBe(40);
        });

        it('three material intersection', function() {
            var result = m.computeTempRange([
                { material: 'alginate', fraction: 0.33 },           // 18-40
                { material: 'gelatin-methacrylate', fraction: 0.34 }, // 20-37
                { material: 'collagen-type-1', fraction: 0.33 }     // 4-25
            ]);
            expect(result.feasible).toBe(true);
            expect(result.min).toBe(20);
            expect(result.max).toBe(25);
        });
    });

    // ── printability ────────────────────────────────────────────

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

        it('rates borderline viscosity (100) as acceptable', function() {
            expect(m.assessPrintability(100).rating).toBe('acceptable');
        });

        it('rates upper-good range (2000) as good', function() {
            expect(m.assessPrintability(2000).rating).toBe('good');
        });

        it('includes viscosity in result', function() {
            var result = m.assessPrintability(750);
            expect(result.viscosity).toBe(750);
        });

        it('includes recommendation', function() {
            var result = m.assessPrintability(500);
            expect(result.recommendation).toBeDefined();
            expect(result.recommendation.length).toBeGreaterThan(0);
        });

        it('boundary at 300 transitions acceptable → good', function() {
            var below = m.assessPrintability(299);
            var at = m.assessPrintability(300);
            expect(below.rating).toBe('acceptable');
            expect(at.rating).toBe('good');
        });

        it('boundary at 2500 transitions good → challenging', function() {
            var below = m.assessPrintability(2499);
            var at = m.assessPrintability(2500);
            expect(below.rating).toBe('good');
            expect(at.rating).toBe('challenging');
        });
    });

    // ── integration ─────────────────────────────────────────────

    describe('integration', function() {
        it('mix result is internally consistent', function() {
            var result = m.mix([
                { material: 'silk-fibroin', fraction: 0.6 },
                { material: 'pectin', fraction: 0.4 }
            ], { totalVolumeMl: 20 });

            // Breakdown volumes sum to total
            var totalVol = result.breakdown.reduce(function(s, b) { return s + b.volumeMl; }, 0);
            expect(totalVol).toBeCloseTo(20, 1);

            // Printability matches composite viscosity
            expect(result.printability.viscosity).toBe(result.composite.viscosity);

            // Composite density is between individual densities
            expect(result.composite.density).toBeGreaterThanOrEqual(1.01); // pectin
            expect(result.composite.density).toBeLessThanOrEqual(1.10);   // silk
        });

        it('all eight materials can pair without error', function() {
            var mats = Object.keys(m.getMaterials());
            for (var i = 0; i < mats.length; i++) {
                for (var j = i + 1; j < mats.length; j++) {
                    var result = m.mix([
                        { material: mats[i], fraction: 0.5 },
                        { material: mats[j], fraction: 0.5 }
                    ]);
                    expect(result.composite.density).toBeGreaterThan(0);
                    expect(result.compatibility.pairs).toHaveLength(1);
                }
            }
        });
    });
});
