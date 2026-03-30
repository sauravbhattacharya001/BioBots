'use strict';

var mod = require('../docs/shared/experimentRandomizer');

describe('ExperimentRandomizer', function () {
    var rand;
    beforeEach(function () {
        rand = mod.createExperimentRandomizer();
    });

    describe('completeRandomization', function () {
        it('assigns correct total units', function () {
            var d = rand.completeRandomization({
                treatments: ['A', 'B', 'C'],
                replicatesPerTreatment: 3,
                seed: 1
            });
            expect(d.totalUnits).toBe(9);
            expect(d.assignments.length).toBe(9);
        });

        it('includes all treatments the correct number of times', function () {
            var d = rand.completeRandomization({
                treatments: ['X', 'Y'],
                replicatesPerTreatment: 5,
                seed: 42
            });
            var counts = {};
            d.assignments.forEach(function (a) {
                counts[a.treatment] = (counts[a.treatment] || 0) + 1;
            });
            expect(counts['X']).toBe(5);
            expect(counts['Y']).toBe(5);
        });

        it('is reproducible with same seed', function () {
            var d1 = rand.completeRandomization({ treatments: ['A', 'B'], replicatesPerTreatment: 4, seed: 99 });
            var d2 = rand.completeRandomization({ treatments: ['A', 'B'], replicatesPerTreatment: 4, seed: 99 });
            expect(d1.assignments.map(function (a) { return a.treatment; }))
                .toEqual(d2.assignments.map(function (a) { return a.treatment; }));
        });

        it('generates blinding codes when requested', function () {
            var d = rand.completeRandomization({ treatments: ['A', 'B'], replicatesPerTreatment: 2, seed: 1, blinded: true });
            expect(d.blindingCodes).toBeDefined();
            expect(d.blindingCodes['A']).toBeDefined();
            expect(d.blindingCodes['B']).toBeDefined();
        });

        it('throws without treatments', function () {
            expect(function () { rand.completeRandomization({}); }).toThrow();
        });
    });

    describe('rcbd', function () {
        it('creates correct number of blocks', function () {
            var d = rand.rcbd({ treatments: ['T1', 'T2', 'T3'], blocks: 4, seed: 10 });
            expect(d.blockDetails.length).toBe(4);
            expect(d.totalUnits).toBe(12);
        });

        it('each block contains all treatments exactly once', function () {
            var d = rand.rcbd({ treatments: ['A', 'B', 'C'], blocks: 3, seed: 5 });
            d.blockDetails.forEach(function (blk) {
                var treatments = blk.assignments.map(function (a) { return a.treatment; }).sort();
                expect(treatments).toEqual(['A', 'B', 'C']);
            });
        });
    });

    describe('latinSquare', function () {
        it('creates NxN grid', function () {
            var d = rand.latinSquare({ treatments: ['A', 'B', 'C'], seed: 7 });
            expect(d.size).toBe(3);
            expect(d.grid.length).toBe(3);
            expect(d.totalUnits).toBe(9);
        });

        it('each treatment appears once per row and column', function () {
            var d = rand.latinSquare({ treatments: ['W', 'X', 'Y', 'Z'], seed: 42 });
            // Check rows
            for (var r = 0; r < d.size; r++) {
                var rowSet = new Set(d.grid[r]);
                expect(rowSet.size).toBe(d.size);
            }
            // Check columns
            for (var c = 0; c < d.size; c++) {
                var colSet = new Set();
                for (var r2 = 0; r2 < d.size; r2++) {
                    colSet.add(d.grid[r2][c]);
                }
                expect(colSet.size).toBe(d.size);
            }
        });
    });

    describe('export', function () {
        it('toCSV produces valid output', function () {
            var d = rand.completeRandomization({ treatments: ['A', 'B'], replicatesPerTreatment: 2, seed: 1 });
            var csv = rand.toCSV(d);
            var lines = csv.split('\n');
            expect(lines[0]).toBe('Unit,Treatment');
            expect(lines.length).toBe(5); // header + 4 rows
        });

        it('renderSchedule includes type header', function () {
            var d = rand.rcbd({ treatments: ['X', 'Y'], blocks: 2, seed: 1 });
            var text = rand.renderSchedule(d);
            expect(text).toContain('RCBD');
        });

        it('toJSON is valid JSON', function () {
            var d = rand.latinSquare({ treatments: ['A', 'B'], seed: 1 });
            var parsed = JSON.parse(rand.toJSON(d));
            expect(parsed.type).toBe('LatinSquare');
        });
    });
});
