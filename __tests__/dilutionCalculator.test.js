'use strict';

var dilution = require('../docs/shared/dilutionCalculator');

describe('DilutionCalculator', function () {
    var calc;

    beforeEach(function () {
        calc = dilution.createDilutionCalculator();
    });

    describe('c1v1', function () {
        it('solves for v1', function () {
            var r = calc.c1v1({ c1: 10, v1: null, c2: 2, v2: 50 });
            expect(r.solvedValue).toBe(10);
            expect(r.diluentVolume).toBe(40);
            expect(r.dilutionFactor).toBe(5);
        });

        it('solves for c2', function () {
            var r = calc.c1v1({ c1: 10, v1: 10, c2: null, v2: 50 });
            expect(r.solvedValue).toBe(2);
        });

        it('solves for v2', function () {
            var r = calc.c1v1({ c1: 10, v1: 5, c2: 2, v2: null });
            expect(r.solvedValue).toBe(25);
        });

        it('solves for c1', function () {
            var r = calc.c1v1({ c1: null, v1: 10, c2: 2, v2: 50 });
            expect(r.solvedValue).toBe(10);
        });

        it('errors when no null provided', function () {
            var r = calc.c1v1({ c1: 10, v1: 10, c2: 2, v2: 50 });
            expect(r.error).toBeDefined();
        });
    });

    describe('serialDilution', function () {
        it('generates correct tube series', function () {
            var r = calc.serialDilution({ stockConcentration: 1000, dilutionFactor: 10, steps: 3, transferVolume: 100, finalVolume: 1000 });
            expect(r.tubes).toHaveLength(3);
            expect(r.tubes[0].concentration).toBe(1000);
            expect(r.tubes[1].concentration).toBe(100);
            expect(r.tubes[2].concentration).toBe(10);
        });

        it('errors on bad factor', function () {
            var r = calc.serialDilution({ stockConcentration: 100, dilutionFactor: 0.5, steps: 3, transferVolume: 100, finalVolume: 1000 });
            expect(r.error).toBeDefined();
        });
    });

    describe('molarityToMass', function () {
        it('calculates grams for known reagent', function () {
            var r = calc.molarityToMass({ molarity: 0.1, volumeL: 1, reagent: 'calcium-chloride' });
            expect(r.gramsNeeded).toBeCloseTo(11.098, 2);
            expect(r.reagentName).toBe('Calcium Chloride (CaCl₂)');
        });

        it('works with custom mw', function () {
            var r = calc.molarityToMass({ molarity: 0.5, volumeL: 0.5, mw: 100 });
            expect(r.gramsNeeded).toBe(25);
        });
    });

    describe('massToMolarity', function () {
        it('calculates molarity', function () {
            var r = calc.massToMolarity({ massG: 5.844, volumeL: 1, reagent: 'pbs-nacl' });
            expect(r.molarity).toBeCloseTo(0.1, 1);
        });
    });

    describe('percentSolution', function () {
        it('calculates w/v', function () {
            var r = calc.percentSolution({ percent: 2, volumeMl: 500, type: 'w/v' });
            expect(r.soluteGrams).toBe(10);
        });

        it('calculates v/v', function () {
            var r = calc.percentSolution({ percent: 10, volumeMl: 100, type: 'v/v' });
            expect(r.soluteMl).toBe(10);
            expect(r.solventMl).toBe(90);
        });
    });

    describe('prepareBuffer', function () {
        it('prepares PBS at 500 mL', function () {
            var r = calc.prepareBuffer({ buffer: 'pbs-1x', volumeMl: 500 });
            expect(r.components).toHaveLength(4);
            expect(r.components[0].gramsNeeded).toBe(4); // NaCl 8g/L * 0.5L
        });

        it('errors on unknown buffer', function () {
            var r = calc.prepareBuffer({ buffer: 'nope' });
            expect(r.error).toBeDefined();
            expect(r.available).toBeDefined();
        });
    });

    describe('workingSolution', function () {
        it('calculates dilution volumes', function () {
            var r = calc.workingSolution({ stockConcentration: 100, workingConcentration: 10, volumeNeeded: 500 });
            expect(r.stockVolumeNeeded).toBe(50);
            expect(r.diluentVolumeNeeded).toBe(450);
            expect(r.dilutionFactor).toBe(10);
        });
    });

    describe('listReagents / listBuffers', function () {
        it('returns reagent list', function () {
            var reagents = calc.listReagents();
            expect(reagents.length).toBeGreaterThan(10);
            expect(reagents[0]).toHaveProperty('molecularWeight');
        });

        it('returns buffer list', function () {
            var buffers = calc.listBuffers();
            expect(buffers.length).toBeGreaterThan(0);
            expect(buffers[0]).toHaveProperty('ph');
        });
    });
});
