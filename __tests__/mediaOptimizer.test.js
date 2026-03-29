'use strict';

var assert = require('assert');
var mod = require('../docs/shared/mediaOptimizer');

describe('MediaOptimizer', function () {
    var opt;

    beforeEach(function () {
        opt = mod.createMediaOptimizer();
    });

    describe('listMedia', function () {
        it('returns all built-in media', function () {
            var list = opt.listMedia();
            assert(list.length >= 4, 'should have at least 4 media');
            var names = list.map(function (m) { return m.key; });
            assert(names.indexOf('dmem') !== -1);
            assert(names.indexOf('rpmi1640') !== -1);
        });
    });

    describe('getFormulation', function () {
        it('returns DMEM formulation', function () {
            var f = opt.getFormulation('dmem');
            assert.strictEqual(f.key, 'dmem');
            assert(f.components['Glucose'] === 4500);
            assert(Object.keys(f.aminoAcids).length > 0);
        });

        it('throws on unknown medium', function () {
            assert.throws(function () { opt.getFormulation('xyz'); }, /Unknown medium/);
        });
    });

    describe('supplementVolumes', function () {
        it('calculates correct volumes', function () {
            var result = opt.supplementVolumes({
                totalMl: 500,
                supplements: [
                    { name: 'FBS', percent: 10 },
                    { name: 'Pen/Strep', percent: 1 }
                ]
            });
            assert.strictEqual(result.basalMediumMl, 445);
            assert.strictEqual(result.supplements[0].volumeMl, 50);
            assert.strictEqual(result.supplements[1].volumeMl, 5);
        });

        it('throws when supplements >= 100%', function () {
            assert.throws(function () {
                opt.supplementVolumes({ totalMl: 500, supplements: [{ name: 'X', percent: 100 }] });
            }, /must be < 100/);
        });
    });

    describe('estimateOsmolarity', function () {
        it('returns OK for normal formulation', function () {
            var result = opt.estimateOsmolarity('rpmi1640', [{ name: 'FBS', percent: 10 }]);
            assert.strictEqual(result.status, 'OK');
            assert(result.estimatedOsmolarity > 280);
        });
    });

    describe('nutrientGap', function () {
        it('identifies compatible medium', function () {
            var result = opt.nutrientGap({ medium: 'dmem', cellType: 'HeLa' });
            assert.strictEqual(result.compatible, true);
            assert(result.recommendations.length > 0);
        });

        it('warns about incompatible medium', function () {
            var result = opt.nutrientGap({ medium: 'rpmi1640', cellType: 'HeLa' });
            assert.strictEqual(result.compatible, false);
            assert(result.warnings.length > 0);
        });

        it('throws on unknown cell type', function () {
            assert.throws(function () {
                opt.nutrientGap({ medium: 'dmem', cellType: 'unknown' });
            }, /Unknown cell type/);
        });
    });

    describe('compareMedia', function () {
        it('compares DMEM and RPMI', function () {
            var result = opt.compareMedia('dmem', 'rpmi1640');
            assert(result.components.length > 0);
            assert(result.osmolarityDiff === 40); // 320 - 280
        });
    });

    describe('listCellTypes', function () {
        it('returns cell types', function () {
            var list = opt.listCellTypes();
            assert(list.length >= 5);
        });
    });
});
