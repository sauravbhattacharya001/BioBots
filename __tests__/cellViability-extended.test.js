'use strict';

/**
 * Extended branch/error-path coverage for cellViability.
 * The legacy suite (__tests__/cellViability.test.js) covers only happy paths.
 * This suite exercises every validation branch, every batch wrapper, the
 * blank-default branch in fromAbsorbance, the IC50 interpolation logic
 * (including the both-points-at-50 midpoint branch), and the
 * "no IC50 in range" branch.
 */

var mod = require('../docs/shared/cellViability');

describe('cellViability - extended coverage', function () {
    var calc;
    beforeEach(function () { calc = mod.createCellViabilityCalculator(); });

    // ---------------------------------------------------------------------
    // fromCounts
    // ---------------------------------------------------------------------
    describe('fromCounts validation', function () {
        it('throws when opts is missing', function () {
            expect(function () { calc.fromCounts(); }).toThrow(/Options required/);
            expect(function () { calc.fromCounts(null); }).toThrow(/Options required/);
        });
        it('throws when live is not a number', function () {
            expect(function () { calc.fromCounts({ live: '180', dead: 20 }); }).toThrow(/live must be a number/);
        });
        it('throws when live is NaN', function () {
            expect(function () { calc.fromCounts({ live: NaN, dead: 20 }); }).toThrow(/live must be a number/);
        });
        it('throws when live is negative', function () {
            expect(function () { calc.fromCounts({ live: -1, dead: 20 }); }).toThrow(/live must be >= 0/);
        });
        it('throws when dead is not a number', function () {
            expect(function () { calc.fromCounts({ live: 100, dead: null }); }).toThrow(/dead must be a number/);
        });
        it('throws when dead is negative', function () {
            expect(function () { calc.fromCounts({ live: 100, dead: -5 }); }).toThrow(/dead must be >= 0/);
        });
        it('returns 100% when dead=0', function () {
            var r = calc.fromCounts({ live: 50, dead: 0 });
            expect(r.viabilityPct).toBe(100);
            expect(r.totalCells).toBe(50);
            expect(r.method).toBe('count-based');
            expect(r.formula).toMatch(/live \+ dead/);
        });
        it('returns 0% when live=0 and dead>0', function () {
            var r = calc.fromCounts({ live: 0, dead: 100 });
            expect(r.viabilityPct).toBe(0);
        });
    });

    // ---------------------------------------------------------------------
    // fromAbsorbance
    // ---------------------------------------------------------------------
    describe('fromAbsorbance validation + branches', function () {
        it('throws when opts is missing', function () {
            expect(function () { calc.fromAbsorbance(); }).toThrow(/Options required/);
        });
        it('throws when treated is not a number', function () {
            expect(function () { calc.fromAbsorbance({ treated: 'x', control: 1 }); }).toThrow(/treated must be a number/);
        });
        it('throws when control is not a number', function () {
            expect(function () { calc.fromAbsorbance({ treated: 0.5, control: undefined }); }).toThrow(/control must be a number/);
        });
        it('throws when corrected control <= 0 (equal to blank)', function () {
            expect(function () {
                calc.fromAbsorbance({ treated: 0.5, control: 0.1, blank: 0.1 });
            }).toThrow(/Corrected control absorbance must be > 0/);
        });
        it('throws when corrected control < 0 (blank > control)', function () {
            expect(function () {
                calc.fromAbsorbance({ treated: 0.5, control: 0.1, blank: 0.2 });
            }).toThrow(/Corrected control absorbance must be > 0/);
        });
        it('defaults blank to 0 when not provided', function () {
            var r = calc.fromAbsorbance({ treated: 0.5, control: 1.0 });
            expect(r.viabilityPct).toBe(50);
            expect(r.blank).toBe(0);
        });
        it('treats non-numeric blank as 0', function () {
            // The current implementation only falls back when typeof !== 'number';
            // string blank should be ignored (treated as 0).
            var r = calc.fromAbsorbance({ treated: 0.4, control: 0.8, blank: 'n/a' });
            expect(r.viabilityPct).toBe(50);
            expect(r.blank).toBe(0);
        });
        it('exposes blank-corrected values and formula metadata', function () {
            var r = calc.fromAbsorbance({ treated: 0.45, control: 0.9, blank: 0.05 });
            expect(r.correctedTreated).toBeCloseTo(0.4, 4);
            expect(r.correctedControl).toBeCloseTo(0.85, 4);
            expect(r.method).toBe('absorbance-based');
            expect(r.formula).toMatch(/treated - blank/);
        });
    });

    // ---------------------------------------------------------------------
    // fromLdh
    // ---------------------------------------------------------------------
    describe('fromLdh validation + branches', function () {
        it('throws when opts is missing', function () {
            expect(function () { calc.fromLdh(); }).toThrow(/Options required/);
        });
        it('throws when experimental is not a number', function () {
            expect(function () { calc.fromLdh({ experimental: 'a', spontaneous: 0.1, maximum: 1 }); })
                .toThrow(/experimental must be a number/);
        });
        it('throws when spontaneous is not a number', function () {
            expect(function () { calc.fromLdh({ experimental: 0.5, spontaneous: null, maximum: 1 }); })
                .toThrow(/spontaneous must be a number/);
        });
        it('throws when maximum is not a number', function () {
            expect(function () { calc.fromLdh({ experimental: 0.5, spontaneous: 0.1, maximum: NaN }); })
                .toThrow(/maximum must be a number/);
        });
        it('throws when maximum <= spontaneous (equal)', function () {
            expect(function () { calc.fromLdh({ experimental: 0.5, spontaneous: 0.4, maximum: 0.4 }); })
                .toThrow(/Maximum must be > spontaneous/);
        });
        it('throws when maximum < spontaneous', function () {
            expect(function () { calc.fromLdh({ experimental: 0.5, spontaneous: 0.9, maximum: 0.4 }); })
                .toThrow(/Maximum must be > spontaneous/);
        });
        it('returns metadata fields (method, formula)', function () {
            var r = calc.fromLdh({ experimental: 0.8, spontaneous: 0.2, maximum: 1.5 });
            expect(r.method).toBe('LDH-release');
            expect(r.formula).toMatch(/cytotoxicity/);
        });
        it('caps cytotoxicity logic when experimental == spontaneous (0% cyto, 100% viable)', function () {
            var r = calc.fromLdh({ experimental: 0.2, spontaneous: 0.2, maximum: 1.0 });
            expect(r.cytotoxicityPct).toBe(0);
            expect(r.viabilityPct).toBe(100);
        });
    });

    // ---------------------------------------------------------------------
    // fromFluorescence
    // ---------------------------------------------------------------------
    describe('fromFluorescence validation', function () {
        it('throws when opts is missing', function () {
            expect(function () { calc.fromFluorescence(); }).toThrow(/Options required/);
        });
        it('throws when liveFluorescence is missing', function () {
            expect(function () { calc.fromFluorescence({ deadFluorescence: 100 }); })
                .toThrow(/liveFluorescence must be a number/);
        });
        it('throws when deadFluorescence is negative', function () {
            expect(function () { calc.fromFluorescence({ liveFluorescence: 100, deadFluorescence: -1 }); })
                .toThrow(/deadFluorescence must be >= 0/);
        });
        it('throws when total fluorescence is zero', function () {
            expect(function () { calc.fromFluorescence({ liveFluorescence: 0, deadFluorescence: 0 }); })
                .toThrow(/Total fluorescence must be > 0/);
        });
        it('returns metadata fields (method, formula)', function () {
            var r = calc.fromFluorescence({ liveFluorescence: 800, deadFluorescence: 200 });
            expect(r.method).toBe('fluorescence-based');
            expect(r.formula).toMatch(/live_signal/);
        });
    });

    // ---------------------------------------------------------------------
    // Batch wrappers
    // ---------------------------------------------------------------------
    describe('batch wrappers', function () {
        it('batchCounts throws on non-array', function () {
            expect(function () { calc.batchCounts(null); }).toThrow(/non-empty array/);
            expect(function () { calc.batchCounts('abc'); }).toThrow(/non-empty array/);
        });
        it('batchCounts throws on empty array', function () {
            expect(function () { calc.batchCounts([]); }).toThrow(/non-empty array/);
        });
        it('batchAbsorbance computes mean across replicates', function () {
            var r = calc.batchAbsorbance([
                { treated: 0.5, control: 1.0 },
                { treated: 0.4, control: 1.0 },
                { treated: 0.6, control: 1.0 }
            ]);
            expect(r.n).toBe(3);
            expect(r.mean).toBe(50);
            expect(r.replicates.length).toBe(3);
            // single-replicate stddev branch is exercised below
        });
        it('batchAbsorbance throws on empty array', function () {
            expect(function () { calc.batchAbsorbance([]); }).toThrow(/non-empty array/);
        });
        it('batchLdh computes mean across replicates', function () {
            var r = calc.batchLdh([
                { experimental: 0.5, spontaneous: 0.1, maximum: 1.0 },
                { experimental: 0.6, spontaneous: 0.1, maximum: 1.0 }
            ]);
            expect(r.n).toBe(2);
            expect(r.replicates.every(function (x) { return typeof x.viabilityPct === 'number'; })).toBe(true);
        });
        it('batchLdh throws on non-array', function () {
            expect(function () { calc.batchLdh(undefined); }).toThrow(/non-empty array/);
        });
        it('batchFluorescence computes summary', function () {
            var r = calc.batchFluorescence([
                { liveFluorescence: 900, deadFluorescence: 100 },
                { liveFluorescence: 800, deadFluorescence: 200 }
            ]);
            expect(r.n).toBe(2);
            expect(r.mean).toBe(85);
            // n=2 -> stddev defined
            expect(r.sd).toBeGreaterThan(0);
        });
        it('batchFluorescence throws on empty array', function () {
            expect(function () { calc.batchFluorescence([]); }).toThrow(/non-empty array/);
        });
        it('batchCounts with n=1 returns sd=0 (stddev short-circuit)', function () {
            var r = calc.batchCounts([{ live: 90, dead: 10 }]);
            expect(r.n).toBe(1);
            expect(r.mean).toBe(90);
            expect(r.sd).toBe(0);
        });
    });

    // ---------------------------------------------------------------------
    // doseResponse - all IC50 branches
    // ---------------------------------------------------------------------
    describe('doseResponse', function () {
        it('throws on non-array', function () {
            expect(function () { calc.doseResponse(null); }).toThrow(/non-empty array/);
            expect(function () { calc.doseResponse('not array'); }).toThrow(/non-empty array/);
        });
        it('throws on empty array', function () {
            expect(function () { calc.doseResponse([]); }).toThrow(/non-empty array/);
        });
        it('throws when concentration is missing/non-numeric', function () {
            expect(function () {
                calc.doseResponse([{ concentration: 'low', treated: 0.5, control: 1.0 }]);
            }).toThrow(/concentration must be a number/);
        });
        it('sorts curve ascending by concentration', function () {
            var r = calc.doseResponse([
                { concentration: 100, treated: 0.1, control: 1.0 },
                { concentration: 1,   treated: 0.9, control: 1.0 },
                { concentration: 10,  treated: 0.5, control: 1.0 }
            ]);
            expect(r.curve.map(function (p) { return p.concentration; })).toEqual([1, 10, 100]);
        });
        it('returns null IC50 when curve never crosses 50% (all above)', function () {
            var r = calc.doseResponse([
                { concentration: 1, treated: 0.9, control: 1.0 }, // 90%
                { concentration: 2, treated: 0.8, control: 1.0 }  // 80%
            ]);
            expect(r.ic50).toBeNull();
            expect(r.ic50Note).toMatch(/not within measured concentration range/);
        });
        it('returns null IC50 when curve never crosses 50% (all below)', function () {
            var r = calc.doseResponse([
                { concentration: 10, treated: 0.4, control: 1.0 }, // 40%
                { concentration: 20, treated: 0.2, control: 1.0 }  // 20%
            ]);
            expect(r.ic50).toBeNull();
        });
        it('linearly interpolates IC50 between adjacent points', function () {
            // 80% at conc=10, 20% at conc=20 -> IC50 at conc=15 (interpolate midpoint)
            var r = calc.doseResponse([
                { concentration: 10, treated: 0.8, control: 1.0 },
                { concentration: 20, treated: 0.2, control: 1.0 }
            ]);
            expect(r.ic50).not.toBeNull();
            expect(r.ic50).toBeCloseTo(15, 4);
            expect(r.ic50Note).toMatch(/linear interpolation/);
        });
        it('handles descending crossing (high->low through 50)', function () {
            // already covered above; add ascending crossing too
            var r = calc.doseResponse([
                { concentration: 1, treated: 0.2, control: 1.0 }, // 20%
                { concentration: 5, treated: 0.8, control: 1.0 }  // 80%
            ]);
            // (20 -> 80) crosses 50%, frac = (50-20)/(80-20) = 0.5 -> ic50 = 3
            expect(r.ic50).toBeCloseTo(3, 4);
        });
        it('uses concentration midpoint when both adjacent points sit exactly at 50%', function () {
            // span === 0 branch: prev=50, curr=50 -> midpoint of concentrations
            var r = calc.doseResponse([
                { concentration: 8,  treated: 0.5, control: 1.0 }, // 50%
                { concentration: 12, treated: 0.5, control: 1.0 }  // 50%
            ]);
            expect(r.ic50).toBeCloseTo(10, 4);
        });
        it('honors blank correction in dose-response points', function () {
            var r = calc.doseResponse([
                { concentration: 1,  treated: 0.45, control: 0.9, blank: 0.05 },
                { concentration: 10, treated: 0.05, control: 0.9, blank: 0.05 }
            ]);
            // Point 1: (0.4/0.85)*100 ≈ 47.06%, Point 2: (0/0.85)*100 = 0%
            // Both <=50, no crossing -> ic50 null
            expect(r.curve.length).toBe(2);
            expect(r.ic50).toBeNull();
        });
    });
});
