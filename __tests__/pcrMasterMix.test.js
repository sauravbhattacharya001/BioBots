'use strict';

var mod = require('../docs/shared/pcrMasterMix');

describe('PCR Master Mix Calculator', function () {
    var pcr;

    beforeEach(function () {
        pcr = mod.createPcrMasterMixCalculator();
    });

    describe('calculate', function () {
        it('should calculate master mix for Taq with defaults', function () {
            var result = pcr.calculate({ reactions: 8 });
            expect(result.polymerase).toBe('Taq DNA Polymerase');
            expect(result.reactions).toBe(8);
            expect(result.components.length).toBe(8);
            expect(result.totalMasterMixVolume).toBeGreaterThan(0);
        });

        it('should apply overage', function () {
            var result = pcr.calculate({ reactions: 10, overage: 0.15 });
            expect(result.reactionsWithOverage).toBe(11.5);
        });

        it('should work with Phusion preset', function () {
            var result = pcr.calculate({ reactions: 4, polymerase: 'phusion' });
            expect(result.polymerase).toBe('Phusion High-Fidelity');
        });

        it('should throw for invalid reactions', function () {
            expect(function () { pcr.calculate({}); }).toThrow();
            expect(function () { pcr.calculate({ reactions: 0 }); }).toThrow();
        });

        it('should throw for unknown polymerase', function () {
            expect(function () { pcr.calculate({ reactions: 1, polymerase: 'unknown' }); }).toThrow(/Unknown polymerase/);
        });
    });

    describe('gradientPlan', function () {
        it('should plan gradient temperatures', function () {
            var result = pcr.gradientPlan({ tmForward: 60, tmReverse: 65 });
            expect(result.temperatures.length).toBe(8);
            expect(result.recommendedTa).toBe(55);
        });

        it('should throw without Tm values', function () {
            expect(function () { pcr.gradientPlan({}); }).toThrow();
        });
    });

    describe('cyclingProtocol', function () {
        it('should generate protocol for Taq', function () {
            var result = pcr.cyclingProtocol({ annealingTemp: 55, ampliconSize: 500 });
            expect(result.steps.length).toBe(6);
            expect(result.polymerase).toBe('Taq DNA Polymerase');
        });

        it('should generate protocol for Q5', function () {
            var result = pcr.cyclingProtocol({ polymerase: 'q5', annealingTemp: 65, ampliconSize: 2000 });
            expect(result.polymerase).toBe('Q5 High-Fidelity');
        });
    });

    describe('listPolymerases', function () {
        it('should list all presets', function () {
            var list = pcr.listPolymerases();
            expect(list.length).toBe(4);
            expect(list.map(function (p) { return p.key; })).toContain('taq');
        });
    });
});
