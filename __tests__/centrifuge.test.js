'use strict';

var centrifuge = require('../docs/shared/centrifuge');

describe('Centrifuge Protocol Calculator', function () {
    var calc;

    beforeEach(function () {
        calc = centrifuge.createCentrifugeCalculator();
    });

    describe('rpmToRcf', function () {
        it('converts RPM to RCF correctly', function () {
            var result = calc.rpmToRcf(1500, 10);
            expect(result.rcf).toBeCloseTo(251.6, 0);
            expect(result.rpm).toBe(1500);
            expect(result.radiusCm).toBe(10);
        });

        it('throws on invalid input', function () {
            expect(function () { calc.rpmToRcf(-1, 10); }).toThrow();
            expect(function () { calc.rpmToRcf(1500, 0); }).toThrow();
        });
    });

    describe('rcfToRpm', function () {
        it('converts RCF to RPM correctly', function () {
            var result = calc.rcfToRpm(300, 10);
            expect(result.rpm).toBeGreaterThan(0);
            expect(result.rcf).toBe(300);
        });

        it('round-trips with rpmToRcf', function () {
            var forward = calc.rpmToRcf(2000, 8);
            var back = calc.rcfToRpm(forward.rcf, 8);
            expect(back.rpm).toBeCloseTo(2000, -1);
        });
    });

    describe('recommend', function () {
        it('returns protocol for known cell type', function () {
            var result = calc.recommend('HeLa');
            expect(result).not.toBeNull();
            expect(result.rpm).toBe(1200);
            expect(result.rcf).toBe(300);
            expect(result.durationMin).toBe(5);
        });

        it('is case-insensitive', function () {
            var result = calc.recommend('hela');
            expect(result).not.toBeNull();
            expect(result.cellType).toBe('HeLa');
        });

        it('returns null for unknown cell type', function () {
            expect(calc.recommend('UnknownCell')).toBeNull();
        });
    });

    describe('listCellTypes', function () {
        it('returns array of cell types', function () {
            var types = calc.listCellTypes();
            expect(Array.isArray(types)).toBe(true);
            expect(types.length).toBeGreaterThan(5);
            expect(types).toContain('HeLa');
        });
    });

    describe('pelletTime', function () {
        it('estimates sedimentation time', function () {
            var result = calc.pelletTime({ rcf: 300, cellDiameter: 15 });
            expect(result.timeSeconds).toBeGreaterThan(0);
            expect(result.timeMinutes).toBeGreaterThanOrEqual(0);
            expect(result.velocity_cm_s).toBeGreaterThan(0);
        });

        it('accepts custom medium', function () {
            var result = calc.pelletTime({ rcf: 300, cellDiameter: 15, medium: 'PBS' });
            expect(result.medium).toBe('PBS');
        });

        it('throws on missing params', function () {
            expect(function () { calc.pelletTime({}); }).toThrow();
        });
    });

    describe('compare', function () {
        it('compares two cell type protocols', function () {
            var result = calc.compare('HeLa', 'MSC');
            expect(result.a.cellType).toBe('HeLa');
            expect(result.b.cellType).toBe('MSC');
            expect(result.comparison.gentler).toBe('MSC');
        });

        it('throws for unknown cell type', function () {
            expect(function () { calc.compare('HeLa', 'Unknown'); }).toThrow();
        });
    });
});
