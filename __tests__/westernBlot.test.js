'use strict';

var westernBlot = require('../docs/shared/westernBlot');

describe('Western Blot Analyzer', function () {
    var wb;

    beforeEach(function () {
        wb = westernBlot.createWesternBlotAnalyzer();
    });

    describe('normalize', function () {
        it('divides target by control per lane', function () {
            var r = wb.normalize({
                target:  [12000, 24000, 36000],
                control: [10000, 12000, 12000]
            });
            expect(r.normalized).toEqual([1.2, 2.0, 3.0]);
        });

        it('throws if control is 0', function () {
            expect(function () {
                wb.normalize({ target: [100], control: [0] });
            }).toThrow(/cannot normalize/i);
        });
    });

    describe('foldChange', function () {
        it('calculates fold change relative to reference lane', function () {
            var r = wb.foldChange({
                target:  [10000, 20000, 30000],
                control: [10000, 10000, 10000],
                referenceLane: 0
            });
            expect(r.foldChanges).toEqual([1.0, 2.0, 3.0]);
        });
    });

    describe('compare', function () {
        it('computes group statistics', function () {
            var r = wb.compare({
                groupA: { target: [100, 110, 105], control: [100, 100, 100], label: 'Ctrl' },
                groupB: { target: [200, 210, 195], control: [100, 100, 100], label: 'Treat' }
            });
            expect(r.groupA.label).toBe('Ctrl');
            expect(r.groupB.label).toBe('Treat');
            expect(r.foldChange).toBeGreaterThan(1.5);
        });
    });

    describe('estimateMW', function () {
        it('estimates molecular weight from Rf values', function () {
            var r = wb.estimateMW({
                markerRfs: [0.1, 0.3, 0.5, 0.7, 0.9],
                markerKdas: [250, 100, 50, 25, 10],
                sampleRfs: [0.4]
            });
            expect(r.estimates[0].estimatedKda).toBeGreaterThan(40);
            expect(r.estimates[0].estimatedKda).toBeLessThan(80);
            expect(r.standardCurve.r2).toBeGreaterThan(0.95);
        });
    });

    describe('saturationCheck', function () {
        it('flags saturated bands', function () {
            var r = wb.saturationCheck({
                intensities: [30000, 60000, 65000],
                maxIntensity: 65535,
                threshold: 0.9
            });
            expect(r.saturatedCount).toBe(2);
            expect(r.results[2].saturated).toBe(true);
        });
    });

    describe('report', function () {
        it('generates a complete report', function () {
            var r = wb.report({
                targetProtein: 'p53',
                loadingControl: 'β-Actin',
                target:  [10000, 20000, 30000],
                control: [10000, 10000, 10000],
                lanes: ['Ctrl', '1x', '2x'],
                referenceLane: 0
            });
            expect(r.targetProtein).toBe('p53');
            expect(r.lanes.length).toBe(3);
            expect(r.lanes[0].foldChange).toBe(1);
            expect(r.lanes[2].foldChange).toBe(3);
        });
    });

    describe('listLadders', function () {
        it('returns known marker ladders', function () {
            var ladders = wb.listLadders();
            expect(ladders['precision-plus']).toBeDefined();
            expect(ladders['precision-plus'].length).toBeGreaterThan(5);
        });
    });

    describe('listLoadingControls', function () {
        it('returns loading controls list', function () {
            var controls = wb.listLoadingControls();
            expect(controls.length).toBeGreaterThan(3);
            expect(controls.find(function (c) { return c.key === 'gapdh'; })).toBeDefined();
        });
    });
});
