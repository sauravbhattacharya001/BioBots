'use strict';

var phAdj = require('../docs/shared/phAdjustment');

describe('PhAdjustmentCalculator', function () {
    var calc;

    beforeEach(function () {
        calc = phAdj.createPhAdjustmentCalculator();
    });

    // ── calculate: validation ─────────────────────────────────────

    describe('validation', function () {
        it('rejects pH outside 0-14', function () {
            var r = calc.calculate({
                currentPh: -1, targetPh: 7, solutionVolume: 100,
                reagent: 'NaOH', reagentConcentration: 1
            });
            expect(r.success).toBe(false);
            expect(r.errors[0]).toMatch(/currentPh/);
        });

        it('rejects negative volume', function () {
            var r = calc.calculate({
                currentPh: 7, targetPh: 8, solutionVolume: -10,
                reagent: 'NaOH', reagentConcentration: 1
            });
            expect(r.success).toBe(false);
        });

        it('rejects unknown reagent', function () {
            var r = calc.calculate({
                currentPh: 7, targetPh: 8, solutionVolume: 100,
                reagent: 'MagicBase', reagentConcentration: 1
            });
            expect(r.success).toBe(false);
            expect(r.errors[0]).toMatch(/Unknown reagent/);
        });

        it('rejects raising pH with acid', function () {
            var r = calc.calculate({
                currentPh: 6, targetPh: 8, solutionVolume: 100,
                reagent: 'HCl', reagentConcentration: 1
            });
            expect(r.success).toBe(false);
            expect(r.errors[0]).toMatch(/Cannot raise pH with an acid/);
        });

        it('rejects lowering pH with base', function () {
            var r = calc.calculate({
                currentPh: 8, targetPh: 6, solutionVolume: 100,
                reagent: 'NaOH', reagentConcentration: 1
            });
            expect(r.success).toBe(false);
            expect(r.errors[0]).toMatch(/Cannot lower pH with a base/);
        });
    });

    // ── calculate: no change needed ───────────────────────────────

    it('returns zero volume when pH already at target', function () {
        var r = calc.calculate({
            currentPh: 7.4, targetPh: 7.4, solutionVolume: 500,
            reagent: 'HCl', reagentConcentration: 1
        });
        expect(r.success).toBe(true);
        expect(r.reagentVolume).toBe(0);
    });

    // ── calculate: unbuffered ─────────────────────────────────────

    describe('unbuffered calculations', function () {
        it('acidifies with HCl', function () {
            var r = calc.calculate({
                currentPh: 7, targetPh: 4, solutionVolume: 1000,
                reagent: 'HCl', reagentConcentration: 1
            });
            expect(r.success).toBe(true);
            expect(r.direction).toBe('acidify');
            expect(r.result.reagentVolumeMl).toBeGreaterThan(0);
            expect(r.reagent.key).toBe('HCl');
        });

        it('alkalinizes with NaOH', function () {
            var r = calc.calculate({
                currentPh: 6, targetPh: 8, solutionVolume: 500,
                reagent: 'NaOH', reagentConcentration: 0.1
            });
            expect(r.success).toBe(true);
            expect(r.direction).toBe('alkalinize');
            expect(r.result.reagentVolumeMl).toBeGreaterThan(0);
        });

        it('accounts for H2SO4 valence (2 H+ per mole)', function () {
            var rHCl = calc.calculate({
                currentPh: 7, targetPh: 3, solutionVolume: 1000,
                reagent: 'HCl', reagentConcentration: 1
            });
            var rH2SO4 = calc.calculate({
                currentPh: 7, targetPh: 3, solutionVolume: 1000,
                reagent: 'H2SO4', reagentConcentration: 1
            });
            // H2SO4 should need about half the volume (2 H+ per mole)
            expect(rH2SO4.result.reagentVolumeMl).toBeCloseTo(
                rHCl.result.reagentVolumeMl / 2, 2
            );
        });
    });

    // ── calculate: buffered ───────────────────────────────────────

    describe('buffered calculations', function () {
        it('requires more reagent in buffered solution', function () {
            var unbuffered = calc.calculate({
                currentPh: 7.0, targetPh: 7.4, solutionVolume: 500,
                reagent: 'NaOH', reagentConcentration: 1
            });
            var buffered = calc.calculate({
                currentPh: 7.0, targetPh: 7.4, solutionVolume: 500,
                reagent: 'NaOH', reagentConcentration: 1,
                bufferSystem: 'phosphate'
            });
            expect(buffered.result.reagentVolumeMl).toBeGreaterThan(
                unbuffered.result.reagentVolumeMl
            );
        });

        it('includes buffer system info in result', function () {
            var r = calc.calculate({
                currentPh: 7.0, targetPh: 7.5, solutionVolume: 100,
                reagent: 'NaOH', reagentConcentration: 1,
                bufferSystem: 'tris', bufferConcentration: 0.1
            });
            expect(r.success).toBe(true);
            expect(r.bufferSystem.name).toBe('Tris');
            expect(r.bufferSystem.concentration).toBe(0.1);
        });
    });

    // ── calculate: output structure ───────────────────────────────

    describe('output structure', function () {
        it('includes titration steps', function () {
            var r = calc.calculate({
                currentPh: 7, targetPh: 5, solutionVolume: 100,
                reagent: 'HCl', reagentConcentration: 0.1
            });
            expect(r.titrationSteps).toBeDefined();
            expect(r.titrationSteps.length).toBe(4);
            expect(r.titrationSteps[0].step).toBe(1);
        });

        it('displays µL for tiny volumes', function () {
            // Very small shift in unbuffered solution → tiny volume
            var r = calc.calculate({
                currentPh: 7.0, targetPh: 6.9, solutionVolume: 10,
                reagent: 'HCl', reagentConcentration: 1
            });
            expect(r.success).toBe(true);
            expect(r.result.unit).toBe('µL');
        });

        it('warns on large pH shifts', function () {
            var r = calc.calculate({
                currentPh: 3, targetPh: 10, solutionVolume: 100,
                reagent: 'NaOH', reagentConcentration: 1
            });
            expect(r.warnings.some(function (w) { return w.match(/Large pH shift/); })).toBe(true);
        });

        it('warns about reagent hazards', function () {
            var r = calc.calculate({
                currentPh: 7, targetPh: 5, solutionVolume: 100,
                reagent: 'HCl', reagentConcentration: 1
            });
            expect(r.warnings.some(function (w) { return w.match(/Safety/); })).toBe(true);
        });

        it('reports final volume estimate', function () {
            var r = calc.calculate({
                currentPh: 7, targetPh: 5, solutionVolume: 100,
                reagent: 'HCl', reagentConcentration: 0.1
            });
            expect(r.finalVolumeEstimate).toBeGreaterThan(100);
        });
    });

    // ── suggestReagent ────────────────────────────────────────────

    describe('suggestReagent', function () {
        it('suggests bases for pH increase', function () {
            var s = calc.suggestReagent(6, 8);
            expect(s.direction).toBe('alkalinize');
            expect(s.suggestions.length).toBeGreaterThan(0);
            s.suggestions.forEach(function (r) {
                expect(['NaOH', 'KOH', 'NH4OH']).toContain(r.key);
            });
        });

        it('suggests acids for pH decrease', function () {
            var s = calc.suggestReagent(8, 5);
            expect(s.direction).toBe('acidify');
            s.suggestions.forEach(function (r) {
                expect(['HCl', 'H2SO4', 'AceticAcid']).toContain(r.key);
            });
        });

        it('reports pH shift magnitude', function () {
            var s = calc.suggestReagent(3, 9);
            expect(s.phShift).toBeCloseTo(6, 1);
        });
    });

    // ── listReagents / listBufferSystems ──────────────────────────

    describe('listReagents', function () {
        it('returns all 6 reagents', function () {
            var r = calc.listReagents();
            expect(Object.keys(r)).toHaveLength(6);
            expect(r.NaOH.type).toBe('base');
            expect(r.HCl.type).toBe('acid');
        });
    });

    describe('listBufferSystems', function () {
        it('returns buffer systems with pKa values', function () {
            var b = calc.listBufferSystems();
            expect(Object.keys(b).length).toBeGreaterThan(5);
            expect(b.phosphate.pKa).toBeCloseTo(7.2, 1);
            expect(b.tris.pKa).toBeCloseTo(8.06, 1);
        });
    });
});
