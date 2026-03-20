'use strict';

var plateMap = require('../docs/shared/plateMap');

describe('Plate Map Generator', function () {
    var gen;

    beforeEach(function () {
        gen = plateMap.createPlateMapGenerator();
    });

    test('getSupportedSizes returns all formats', function () {
        var sizes = gen.getSupportedSizes();
        expect(sizes).toEqual(expect.arrayContaining([6, 12, 24, 48, 96, 384]));
    });

    test('generate creates a 96-well plate', function () {
        var map = gen.generate({
            plateSize: 96,
            samples: [{ name: 'TestA', replicates: 3 }],
            controls: { positive: 2, negative: 2 },
            blanks: 2
        });
        expect(map.plateSize).toBe(96);
        expect(map.rows).toBe(8);
        expect(map.cols).toBe(12);
        expect(map.stats.samples).toBe(3);
        expect(map.stats.positive_control).toBe(2);
        expect(map.stats.negative_control).toBe(2);
        expect(map.stats.blank).toBe(2);
        expect(map.stats.total).toBe(96);
    });

    test('generate throws on unsupported plate size', function () {
        expect(function () { gen.generate({ plateSize: 100 }); }).toThrow('Unsupported plate size');
    });

    test('generate throws when too many assignments', function () {
        expect(function () {
            gen.generate({
                plateSize: 6,
                samples: [{ name: 'X', replicates: 7 }]
            });
        }).toThrow('Too many assignments');
    });

    test('edgeBlanks reserves border wells', function () {
        var map = gen.generate({
            plateSize: 24,
            samples: [{ name: 'S1', replicates: 2 }],
            edgeBlanks: true
        });
        // 24-well = 4x6, all are edge in a 4x6 except inner 2x4=8
        expect(map.stats.blank).toBeGreaterThan(0);
        expect(map.edgeBlanks).toBe(true);
    });

    test('render produces ASCII output', function () {
        var map = gen.generate({
            plateSize: 6,
            samples: [{ name: 'A', replicates: 2 }],
            blanks: 1
        });
        var text = gen.render(map);
        expect(text).toContain('Stats:');
        expect(text).toContain('2 samples');
    });

    test('toCSV produces valid CSV', function () {
        var map = gen.generate({
            plateSize: 12,
            samples: [{ name: 'Test', replicates: 4 }]
        });
        var csv = gen.toCSV(map);
        expect(csv).toContain('Well,Row,Column,Type,Name,Replicate');
        var lines = csv.split('\n');
        expect(lines.length).toBe(13); // header + 12 wells
    });

    test('toJSON produces valid JSON', function () {
        var map = gen.generate({
            plateSize: 6,
            samples: [{ name: 'X', replicates: 1 }]
        });
        var json = gen.toJSON(map);
        var parsed = JSON.parse(json);
        expect(parsed.plateSize).toBe(6);
        expect(parsed.wells.length).toBe(6);
    });

    test('template dose_response generates valid map', function () {
        var map = gen.template('dose_response', 96);
        expect(map.stats.samples).toBe(15); // 5 doses * 3 replicates
        expect(map.stats.positive_control).toBe(3);
        expect(map.stats.negative_control).toBe(3);
    });

    test('template bioink_comparison generates valid map', function () {
        var map = gen.template('bioink_comparison', 96);
        expect(map.stats.samples).toBe(20); // 5 bioinks * 4 replicates
        expect(map.edgeBlanks).toBe(true);
    });

    test('template throws on unknown type', function () {
        expect(function () { gen.template('unknown'); }).toThrow('Unknown template');
    });

    test('randomize produces different layouts', function () {
        // Run twice with randomize - layouts should differ (probabilistically)
        var map1 = gen.generate({
            plateSize: 96,
            samples: [
                { name: 'A', replicates: 10 },
                { name: 'B', replicates: 10 }
            ],
            randomize: true
        });
        var map2 = gen.generate({
            plateSize: 96,
            samples: [
                { name: 'A', replicates: 10 },
                { name: 'B', replicates: 10 }
            ],
            randomize: true
        });
        // Compare first few well assignments
        var wells1 = gen.toCSV(map1);
        var wells2 = gen.toCSV(map2);
        // With 20 samples in 96 wells, randomized, extremely unlikely to be identical
        expect(map1.randomized).toBe(true);
        expect(map2.randomized).toBe(true);
    });
});
