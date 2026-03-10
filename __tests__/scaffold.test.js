'use strict';

var scaffold = require('../docs/shared/scaffold');

describe('Scaffold Geometry Calculator', function () {
    var calc;
    beforeEach(function () { calc = scaffold.createScaffoldCalculator(); });

    var baseParams = {
        architecture: 'grid', dimensions: { x: 10, y: 10, z: 5 },
        strutWidth: 0.4, poreSize: 0.5, layerHeight: 0.2
    };

    describe('analyze()', function () {
        test('returns valid result for grid architecture', function () {
            var r = calc.analyze(baseParams);
            expect(r.architecture.type).toBe('grid');
            expect(r.dimensions.boundingVolumeMm3).toBe(500);
            expect(r.porosity.fraction).toBeGreaterThan(0);
            expect(r.porosity.fraction).toBeLessThan(1);
            expect(r.poreGeometry.strutWidthUm).toBe(400);
            expect(r.poreGeometry.targetPoreSizeUm).toBe(500);
            expect(r.printEstimates.numberOfLayers).toBe(25);
        });
        test('works for honeycomb', function () {
            var r = calc.analyze(Object.assign({}, baseParams, { architecture: 'honeycomb' }));
            expect(r.architecture.type).toBe('honeycomb');
            expect(r.porosity.fraction).toBeGreaterThan(0);
        });
        test('works for gyroid', function () {
            var r = calc.analyze(Object.assign({}, baseParams, { architecture: 'gyroid' }));
            expect(r.architecture.type).toBe('gyroid');
        });
        test('throws on missing params', function () {
            expect(function () { calc.analyze(); }).toThrow();
            expect(function () { calc.analyze(null); }).toThrow();
        });
        test('throws on invalid architecture', function () {
            expect(function () { calc.analyze(Object.assign({}, baseParams, { architecture: 'cube' })); }).toThrow(/Invalid architecture/);
        });
        test('throws on bad dimensions', function () {
            expect(function () { calc.analyze(Object.assign({}, baseParams, { dimensions: { x: -1, y: 10, z: 5 } })); }).toThrow();
        });
        test('throws on oversized dimensions', function () {
            expect(function () { calc.analyze(Object.assign({}, baseParams, { dimensions: { x: 600, y: 10, z: 5 } })); }).toThrow(/500/);
        });
        test('throws on invalid strutWidth', function () {
            expect(function () { calc.analyze(Object.assign({}, baseParams, { strutWidth: 0 })); }).toThrow();
        });
        test('throws on invalid poreSize', function () {
            expect(function () { calc.analyze(Object.assign({}, baseParams, { poreSize: 20 })); }).toThrow();
        });
        test('throws on invalid layerHeight', function () {
            expect(function () { calc.analyze(Object.assign({}, baseParams, { layerHeight: 0 })); }).toThrow();
        });
        test('uses material preset', function () {
            var r = calc.analyze(Object.assign({}, baseParams, { material: 'pcl' }));
            expect(r.mechanical.materialPreset).toBe('PCL');
            expect(r.mechanical.bulkModulusKPa).toBe(400000);
        });
        test('throws on unknown material', function () {
            expect(function () { calc.analyze(Object.assign({}, baseParams, { material: 'unobtainium' })); }).toThrow(/Unknown material/);
        });
        test('custom modulus override works', function () {
            var r = calc.analyze(Object.assign({}, baseParams, { customModulusKPa: 50 }));
            expect(r.mechanical.bulkModulusKPa).toBe(50);
        });
        test('higher strut width gives lower porosity', function () {
            var thin = calc.analyze(Object.assign({}, baseParams, { strutWidth: 0.2 }));
            var thick = calc.analyze(Object.assign({}, baseParams, { strutWidth: 0.8 }));
            expect(thin.porosity.fraction).toBeGreaterThan(thick.porosity.fraction);
        });
        test('surface area and transport are computed', function () {
            var r = calc.analyze(baseParams);
            expect(r.surface.surfaceAreaToVolumeRatio).toBeGreaterThan(0);
            expect(r.transport.permeabilityMm2).toBeGreaterThan(0);
        });
    });

    describe('checkTissueCompatibility()', function () {
        test('returns compatibility for bone', function () {
            var a = calc.analyze(Object.assign({}, baseParams, { material: 'pcl' }));
            var r = calc.checkTissueCompatibility('bone', a);
            expect(r.tissueType).toBe('bone');
            expect(r.overallScore).toBeDefined();
            expect(r.recommendations.length).toBeGreaterThan(0);
        });
        test('returns compatibility for cartilage', function () {
            var a = calc.analyze(Object.assign({}, baseParams, { material: 'alginate-4' }));
            var r = calc.checkTissueCompatibility('cartilage', a);
            expect(r.tissueType).toBe('cartilage');
        });
        test('throws on unknown tissue', function () {
            var a = calc.analyze(baseParams);
            expect(function () { calc.checkTissueCompatibility('pancreas', a); }).toThrow(/Unknown tissue/);
        });
        test('throws on invalid analysis result', function () {
            expect(function () { calc.checkTissueCompatibility('bone', {}); }).toThrow();
        });
        test('score is valid', function () {
            var a = calc.analyze({ architecture: 'grid', dimensions: { x: 10, y: 10, z: 5 }, strutWidth: 0.1, poreSize: 0.2, layerHeight: 0.1, material: 'alginate-4' });
            var r = calc.checkTissueCompatibility('cartilage', a);
            expect(['Excellent', 'Acceptable', 'Marginal', 'Poor']).toContain(r.overallScore);
        });
    });

    describe('parameterSweep()', function () {
        test('sweeps strutWidth', function () {
            var results = calc.parameterSweep(baseParams, 'strutWidth', 0.1, 1.0, 5);
            expect(results.length).toBe(5);
            expect(results[0].porosity).toBeGreaterThan(results[4].porosity);
        });
        test('sweeps poreSize', function () {
            var results = calc.parameterSweep(baseParams, 'poreSize', 0.1, 1.0, 5);
            expect(results.length).toBe(5);
            expect(results[4].porosity).toBeGreaterThan(results[0].porosity);
        });
        test('throws on invalid sweep param', function () {
            expect(function () { calc.parameterSweep(baseParams, 'layerHeight', 0.1, 1.0); }).toThrow();
        });
        test('throws on min >= max', function () {
            expect(function () { calc.parameterSweep(baseParams, 'strutWidth', 1.0, 0.1); }).toThrow();
        });
        test('handles out-of-range values', function () {
            var results = calc.parameterSweep(baseParams, 'strutWidth', 0.01, 6.0, 3);
            expect(results.length).toBe(3);
        });
    });

    describe('getOptions()', function () {
        test('returns architectures, materials, and tissue targets', function () {
            var opts = calc.getOptions();
            expect(opts.architectures.length).toBe(3);
            expect(opts.materials.length).toBeGreaterThan(0);
            expect(opts.tissueTargets.length).toBe(6);
        });
    });
});
