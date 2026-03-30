'use strict';

var nozzleAdvisor = require('../docs/shared/nozzleAdvisor');

describe('NozzleAdvisor', function() {
    var advisor;

    beforeEach(function() {
        advisor = nozzleAdvisor.createNozzleAdvisor();
    });

    describe('getCatalog', function() {
        it('returns all nozzles', function() {
            var catalog = advisor.getCatalog();
            expect(catalog.length).toBeGreaterThan(10);
            catalog.forEach(function(n) {
                expect(n).toHaveProperty('gauge');
                expect(n).toHaveProperty('innerDiameterMm');
                expect(n).toHaveProperty('color');
                expect(n).toHaveProperty('type');
            });
        });

        it('includes both blunt and tapered nozzles', function() {
            var catalog = advisor.getCatalog();
            var types = catalog.map(function(n) { return n.type; });
            expect(types).toContain('blunt');
            expect(types).toContain('tapered');
        });
    });

    describe('getViscosityClasses', function() {
        it('returns all viscosity classes', function() {
            var classes = advisor.getViscosityClasses();
            expect(classes).toHaveProperty('low');
            expect(classes).toHaveProperty('medium');
            expect(classes).toHaveProperty('high');
            expect(classes).toHaveProperty('paste');
        });
    });

    describe('getShearThresholds', function() {
        it('returns thresholds for all sensitivity levels', function() {
            var thresholds = advisor.getShearThresholds();
            expect(thresholds).toHaveProperty('fragile');
            expect(thresholds).toHaveProperty('moderate');
            expect(thresholds).toHaveProperty('robust');
            expect(thresholds).toHaveProperty('acellular');
            expect(thresholds.fragile).toBeLessThan(thresholds.moderate);
            expect(thresholds.moderate).toBeLessThan(thresholds.robust);
        });
    });

    describe('calculateFlowRate', function() {
        it('calculates volumetric flow rate', function() {
            var q = advisor.calculateFlowRate(5, 0.4, 0.2);
            expect(q).toBeCloseTo(0.4, 2);
        });

        it('returns 0 for zero speed', function() {
            expect(advisor.calculateFlowRate(0, 0.4, 0.2)).toBe(0);
        });
    });

    describe('estimateShearStress', function() {
        it('returns positive value for valid inputs', function() {
            var tau = advisor.estimateShearStress(0.5, 0.4, 0.2, 'blunt');
            expect(tau).toBeGreaterThan(0);
        });

        it('returns lower stress for tapered nozzles', function() {
            var blunt = advisor.estimateShearStress(0.5, 0.4, 0.2, 'blunt');
            var tapered = advisor.estimateShearStress(0.5, 0.4, 0.2, 'tapered');
            expect(tapered).toBeLessThan(blunt);
            expect(tapered).toBeCloseTo(blunt * 0.6, 1);
        });

        it('returns Infinity for zero radius', function() {
            expect(advisor.estimateShearStress(0.5, 0.4, 0, 'blunt')).toBe(Infinity);
        });
    });

    describe('recommend', function() {
        it('returns recommendation with default parameters', function() {
            var result = advisor.recommend();
            expect(result).toHaveProperty('recommendation');
            expect(result).toHaveProperty('alternatives');
            expect(result).toHaveProperty('parameters');
            expect(result).toHaveProperty('totalEvaluated');
            expect(result.recommendation).toHaveProperty('score');
            expect(result.recommendation).toHaveProperty('grade');
            expect(result.recommendation).toHaveProperty('nozzle');
            expect(result.recommendation).toHaveProperty('metrics');
        });

        it('scores include issues and warnings arrays', function() {
            var result = advisor.recommend();
            expect(Array.isArray(result.recommendation.issues)).toBe(true);
            expect(Array.isArray(result.recommendation.warnings)).toBe(true);
        });

        it('top recommendation has highest score', function() {
            var result = advisor.recommend();
            result.alternatives.forEach(function(alt) {
                expect(alt.score).toBeLessThanOrEqual(result.recommendation.score);
            });
        });

        it('respects nozzleType filter', function() {
            var result = advisor.recommend({ nozzleType: 'tapered' });
            expect(result.recommendation.nozzle.type).toBe('tapered');
            result.alternatives.forEach(function(alt) {
                expect(alt.nozzle.type).toBe('tapered');
            });
        });

        it('penalizes nozzles too large for target resolution', function() {
            var result = advisor.recommend({ targetResolutionMm: 0.1 });
            // Large nozzles should score lower
            var largeNozzle = result.alternatives.find(function(a) {
                return a.nozzle.gauge === 14;
            }) || result.recommendation;
            expect(largeNozzle.score).toBeLessThan(80);
        });

        it('penalizes small nozzles for paste viscosity', function() {
            var result = advisor.recommend({ viscosity: 'paste', targetResolutionMm: 0.1 });
            var smallNozzle = result.alternatives.find(function(a) {
                return a.nozzle.innerDiameterMm < 0.3;
            });
            if (smallNozzle) {
                expect(smallNozzle.issues).toContain('Paste-viscosity materials need larger nozzles (≥0.3mm)');
            }
        });

        it('considers cell diameter constraints', function() {
            // Cell diameter 50µm = 0.05mm, so nozzle needs ≥0.25mm
            var result = advisor.recommend({ cellDiameterUm: 50 });
            var tinyNozzle = result.alternatives.find(function(a) {
                return a.nozzle.innerDiameterMm < 0.15;
            });
            if (tinyNozzle) {
                expect(tinyNozzle.score).toBeLessThan(70);
            }
        });

        it('flags shear stress for fragile cells', function() {
            var result = advisor.recommend({
                cellSensitivity: 'fragile',
                viscosity: 'high',
                targetResolutionMm: 0.2,
                cellDiameterUm: 20
            });
            // Some nozzles should have shear warnings/issues
            var allResults = [result.recommendation].concat(result.alternatives);
            var hasShearFlag = allResults.some(function(r) {
                return r.issues.some(function(i) { return i.indexOf('Shear') >= 0; }) ||
                       r.warnings.some(function(w) { return w.indexOf('shear') >= 0 || w.indexOf('Shear') >= 0; });
            });
            expect(hasShearFlag).toBe(true);
        });

        it('gives tapered nozzle bonus for cell-laden work', function() {
            var bluntResult = advisor.recommend({
                cellDiameterUm: 20,
                nozzleType: 'blunt',
                targetResolutionMm: 0.4
            });
            var taperedResult = advisor.recommend({
                cellDiameterUm: 20,
                nozzleType: 'tapered',
                targetResolutionMm: 0.4
            });
            // Tapered 22G should score >= blunt 22G for same resolution (due to lower shear + bonus)
            var blunt22 = [bluntResult.recommendation].concat(bluntResult.alternatives)
                .find(function(r) { return r.nozzle.gauge === 22; });
            var tapered22 = [taperedResult.recommendation].concat(taperedResult.alternatives)
                .find(function(r) { return r.nozzle.gauge === 22; });
            if (blunt22 && tapered22) {
                expect(tapered22.score).toBeGreaterThanOrEqual(blunt22.score);
            }
        });

        it('throws on invalid viscosity', function() {
            expect(function() {
                advisor.recommend({ viscosity: 'invalid' });
            }).toThrow(/Unknown viscosity/);
        });

        it('throws on invalid cellSensitivity', function() {
            expect(function() {
                advisor.recommend({ cellSensitivity: 'invalid' });
            }).toThrow(/Unknown cellSensitivity/);
        });

        it('throws on negative targetResolutionMm', function() {
            expect(function() {
                advisor.recommend({ targetResolutionMm: -1 });
            }).toThrow(/positive.*number/);
        });

        it('includes flow rate and shear in metrics', function() {
            var result = advisor.recommend();
            expect(result.recommendation.metrics).toHaveProperty('expectedLineWidthMm');
            expect(result.recommendation.metrics).toHaveProperty('flowRateMm3s');
            expect(result.recommendation.metrics).toHaveProperty('estimatedShearStressPa');
        });

        it('provides correct parameter echo', function() {
            var result = advisor.recommend({ targetResolutionMm: 0.3, viscosity: 'high' });
            expect(result.parameters.targetResolutionMm).toBe(0.3);
            expect(result.parameters.viscosity).toBe('high');
        });
    });

    describe('findClosestNozzle', function() {
        it('finds exact match', function() {
            var result = advisor.findClosestNozzle(0.413);
            expect(result.gauge).toBe(22);
            expect(result.differenceFromTargetMm).toBe(0);
        });

        it('finds closest for in-between diameter', function() {
            var result = advisor.findClosestNozzle(0.5);
            expect(result).not.toBeNull();
            expect(result.differenceFromTargetMm).toBeLessThan(0.1);
        });

        it('filters by type', function() {
            var result = advisor.findClosestNozzle(0.413, 'tapered');
            expect(result.type).toBe('tapered');
        });

        it('throws on invalid input', function() {
            expect(function() {
                advisor.findClosestNozzle(-1);
            }).toThrow(/positive.*number/);
        });

        it('throws on non-number input', function() {
            expect(function() {
                advisor.findClosestNozzle('big');
            }).toThrow(/positive.*number/);
        });
    });
});
