'use strict';

const { createFormulationCalculator } = require('../Try/scripts/formulationCalculator');

describe('FormulationCalculator', () => {
    let calc;

    beforeEach(() => {
        calc = createFormulationCalculator();
    });

    // ── Dilution ────────────────────────────────────────────────

    describe('dilution', () => {
        test('basic C1V1=C2V2', () => {
            const r = calc.dilution({ stockConc: 10, targetConc: 2, targetVolume: 5 });
            expect(r.stockVolume).toBe(1);
            expect(r.diluentVolume).toBe(4);
            expect(r.totalVolume).toBe(5);
            expect(r.dilutionFactor).toBe(5);
            expect(r.percentStock).toBe(20);
        });

        test('no dilution needed when stock equals target', () => {
            const r = calc.dilution({ stockConc: 5, targetConc: 5, targetVolume: 10 });
            expect(r.stockVolume).toBe(10);
            expect(r.diluentVolume).toBe(0);
            expect(r.dilutionFactor).toBe(1);
        });

        test('throws on missing params', () => {
            expect(() => calc.dilution({})).toThrow('requires');
        });

        test('throws on negative values', () => {
            expect(() => calc.dilution({ stockConc: -1, targetConc: 1, targetVolume: 5 })).toThrow('positive');
        });

        test('throws when target exceeds stock', () => {
            expect(() => calc.dilution({ stockConc: 1, targetConc: 5, targetVolume: 10 })).toThrow('exceed');
        });

        test('high dilution factor', () => {
            const r = calc.dilution({ stockConc: 1000, targetConc: 1, targetVolume: 100 });
            expect(r.stockVolume).toBe(0.1);
            expect(r.dilutionFactor).toBe(1000);
        });
    });

    // ── Serial Dilution ─────────────────────────────────────────

    describe('serialDilution', () => {
        test('basic 1:10 serial dilution', () => {
            const steps = calc.serialDilution({ stockConc: 1000, dilutionFactor: 10, steps: 3, volumePerStep: 1 });
            expect(steps).toHaveLength(3);
            expect(steps[0].concentration).toBe(100);
            expect(steps[1].concentration).toBe(10);
            expect(steps[2].concentration).toBe(1);
        });

        test('each step has transfer and diluent', () => {
            const steps = calc.serialDilution({ stockConc: 100, dilutionFactor: 2, steps: 2, volumePerStep: 1 });
            expect(steps[0].transferVolume).toBe(0.5);
            expect(steps[0].diluentVolume).toBe(0.5);
        });

        test('throws on factor <= 1', () => {
            expect(() => calc.serialDilution({ stockConc: 10, dilutionFactor: 1, steps: 3, volumePerStep: 1 })).toThrow();
        });

        test('throws on too many steps', () => {
            expect(() => calc.serialDilution({ stockConc: 10, dilutionFactor: 2, steps: 25, volumePerStep: 1 })).toThrow();
        });

        test('throws on missing params', () => {
            expect(() => calc.serialDilution({})).toThrow();
        });
    });

    // ── Cell Suspension ─────────────────────────────────────────

    describe('cellSuspension', () => {
        test('basic cell dilution', () => {
            const r = calc.cellSuspension({ stockDensity: 10e6, targetDensity: 5e6, targetVolume: 2 });
            expect(r.cellSuspensionVolume).toBe(1);
            expect(r.mediaVolume).toBe(1);
            expect(r.totalCells).toBe(10000000);
            expect(r.dilutionFactor).toBe(2);
        });

        test('throws when target exceeds stock', () => {
            expect(() => calc.cellSuspension({ stockDensity: 1e6, targetDensity: 5e6, targetVolume: 1 })).toThrow('exceed');
        });

        test('throws on missing params', () => {
            expect(() => calc.cellSuspension({})).toThrow();
        });
    });

    // ── Create Formulation ──────────────────────────────────────

    describe('createFormulation', () => {
        test('single component formulation', () => {
            const f = calc.createFormulation({
                name: 'Test',
                targetVolume: 10,
                components: [
                    { name: 'alginate', stockConc: 4, targetConc: 2 }
                ]
            });
            expect(f.name).toBe('Test');
            expect(f.targetVolume).toBe(10);
            expect(f.components).toHaveLength(1);
            expect(f.components[0].volumeNeeded).toBe(5);
            expect(f.solventVolume).toBe(5);
        });

        test('multi-component formulation', () => {
            const f = calc.createFormulation({
                name: 'Multi',
                targetVolume: 5,
                components: [
                    { name: 'gelatin-methacrylate', stockConc: 20, targetConc: 7 },
                    { name: 'lap', stockConc: 2, targetConc: 0.1 }
                ]
            });
            expect(f.components).toHaveLength(2);
            expect(f.totalComponentVolume).toBeGreaterThan(0);
            expect(f.solventVolume).toBeGreaterThan(0);
        });

        test('with cells', () => {
            const f = calc.createFormulation({
                name: 'With Cells',
                targetVolume: 5,
                components: [
                    { name: 'alginate', stockConc: 4, targetConc: 2 }
                ],
                cells: { name: 'MSCs', stockDensity: 20e6, targetDensity: 5e6 }
            });
            expect(f.cells).not.toBeNull();
            expect(f.cells.totalCells).toBe(25000000);
            expect(f.cells.volumeNeeded).toBeGreaterThan(0);
        });

        test('includes mixing order', () => {
            const f = calc.createFormulation({
                name: 'Test',
                targetVolume: 20,
                components: [
                    { name: 'lap', stockConc: 2, targetConc: 0.1 },
                    { name: 'alginate', stockConc: 4, targetConc: 2 }
                ],
                cells: { name: 'Cells', stockDensity: 10e6, targetDensity: 1e6 }
            });
            expect(f.mixingOrder).toBeDefined();
            expect(f.mixingOrder.length).toBeGreaterThan(0);
            // hydrogel should come before photoinitiator which comes before cells
            const hydIdx = f.mixingOrder.findIndex(s => s.role === 'hydrogel');
            const piIdx = f.mixingOrder.findIndex(s => s.role === 'photoinitiator');
            const cellIdx = f.mixingOrder.findIndex(s => s.role === 'cells');
            expect(hydIdx).toBeLessThan(piIdx);
            expect(piIdx).toBeLessThan(cellIdx);
        });

        test('throws on volume overflow', () => {
            expect(() => calc.createFormulation({
                name: 'Overflow',
                targetVolume: 1,
                components: [
                    { name: 'alginate', stockConc: 2, targetConc: 1.5 },
                    { name: 'gelatin-methacrylate', stockConc: 2, targetConc: 1.5 }
                ]
            })).toThrow('exceed');
        });

        test('throws on empty components', () => {
            expect(() => calc.createFormulation({ name: 'X', targetVolume: 5, components: [] })).toThrow();
        });

        test('throws when target > stock for component', () => {
            expect(() => calc.createFormulation({
                name: 'X', targetVolume: 5,
                components: [{ name: 'alginate', stockConc: 1, targetConc: 5 }]
            })).toThrow('exceeds');
        });

        test('resolves known material display names', () => {
            const f = calc.createFormulation({
                name: 'Test',
                targetVolume: 5,
                components: [{ name: 'alginate', stockConc: 4, targetConc: 2 }]
            });
            expect(f.components[0].displayName).toBe('Sodium Alginate');
        });

        test('handles unknown materials gracefully', () => {
            const f = calc.createFormulation({
                name: 'Custom',
                targetVolume: 5,
                components: [{ name: 'custom-polymer', stockConc: 10, targetConc: 5 }]
            });
            expect(f.components[0].name).toBe('custom-polymer');
            expect(f.components[0].role).toBe('other');
        });

        test('generates warnings for out-of-range concentrations', () => {
            const f = calc.createFormulation({
                name: 'High Conc',
                targetVolume: 10,
                components: [{ name: 'alginate', stockConc: 20, targetConc: 10 }]
            });
            expect(f.warnings.length).toBeGreaterThan(0);
            expect(f.warnings.some(w => w.includes('exceeds typical max'))).toBe(true);
        });

        test('warns on high cell density', () => {
            const f = calc.createFormulation({
                name: 'Dense',
                targetVolume: 5,
                components: [{ name: 'alginate', stockConc: 4, targetConc: 2 }],
                cells: { name: 'Cells', stockDensity: 100e6, targetDensity: 25e6 }
            });
            expect(f.warnings.some(w => w.includes('High cell density'))).toBe(true);
        });
    });

    // ── Scale Formulation ───────────────────────────────────────

    describe('scaleFormulation', () => {
        test('scales up 2x', () => {
            const f = calc.createFormulation({
                name: 'Base',
                targetVolume: 5,
                components: [{ name: 'alginate', stockConc: 4, targetConc: 2 }]
            });
            const scaled = calc.scaleFormulation(f, 2);
            expect(scaled.targetVolume).toBe(10);
            expect(scaled.components[0].volumeNeeded).toBe(f.components[0].volumeNeeded * 2);
            expect(scaled.solventVolume).toBe(f.solventVolume * 2);
            expect(scaled.scaleFactor).toBe(2);
        });

        test('scales down 0.5x', () => {
            const f = calc.createFormulation({
                name: 'Base',
                targetVolume: 10,
                components: [{ name: 'alginate', stockConc: 4, targetConc: 2 }]
            });
            const scaled = calc.scaleFormulation(f, 0.5);
            expect(scaled.targetVolume).toBe(5);
        });

        test('scales cells too', () => {
            const f = calc.createFormulation({
                name: 'Base',
                targetVolume: 5,
                components: [{ name: 'alginate', stockConc: 4, targetConc: 2 }],
                cells: { name: 'Cells', stockDensity: 10e6, targetDensity: 5e6 }
            });
            const scaled = calc.scaleFormulation(f, 3);
            expect(scaled.cells.totalCells).toBe(f.cells.totalCells * 3);
        });

        test('throws on missing inputs', () => {
            expect(() => calc.scaleFormulation(null, 2)).toThrow();
        });

        test('throws on zero factor', () => {
            const f = calc.createFormulation({
                name: 'X', targetVolume: 5,
                components: [{ name: 'alginate', stockConc: 4, targetConc: 2 }]
            });
            expect(() => calc.scaleFormulation(f, 0)).toThrow('positive');
        });
    });

    // ── Compare Formulations ────────────────────────────────────

    describe('compareFormulations', () => {
        test('compares two formulations', () => {
            const f1 = calc.createFormulation({
                name: 'A', targetVolume: 5,
                components: [
                    { name: 'alginate', stockConc: 4, targetConc: 2 },
                    { name: 'lap', stockConc: 2, targetConc: 0.1 }
                ]
            });
            const f2 = calc.createFormulation({
                name: 'B', targetVolume: 5,
                components: [
                    { name: 'alginate', stockConc: 4, targetConc: 3 },
                    { name: 'gelatin-methacrylate', stockConc: 20, targetConc: 5 }
                ]
            });

            const cmp = calc.compareFormulations(f1, f2);
            expect(cmp.formulation1).toBe('A');
            expect(cmp.formulation2).toBe('B');
            expect(cmp.sharedComponents).toBe(1); // alginate
            expect(cmp.uniqueToFirst).toContain('lap');
            expect(cmp.uniqueToSecond).toContain('gelatin-methacrylate');
        });

        test('shows concentration differences', () => {
            const f1 = calc.createFormulation({
                name: 'A', targetVolume: 5,
                components: [{ name: 'alginate', stockConc: 4, targetConc: 1 }]
            });
            const f2 = calc.createFormulation({
                name: 'B', targetVolume: 5,
                components: [{ name: 'alginate', stockConc: 4, targetConc: 3 }]
            });
            const cmp = calc.compareFormulations(f1, f2);
            const alg = cmp.componentComparison.find(c => c.name === 'alginate');
            expect(alg.concDiff).toBe(2);
        });
    });

    // ── Cost Estimation ─────────────────────────────────────────

    describe('estimateCost', () => {
        test('estimates cost for known materials', () => {
            const f = calc.createFormulation({
                name: 'Cost Test',
                targetVolume: 10,
                components: [{ name: 'alginate', stockConc: 4, targetConc: 2 }]
            });
            const cost = calc.estimateCost(f);
            expect(cost.estimatedCost).toBeGreaterThan(0);
            expect(cost.breakdown).toHaveLength(1);
        });

        test('marks unknown materials', () => {
            const f = calc.createFormulation({
                name: 'Unknown',
                targetVolume: 5,
                components: [{ name: 'mystery-gel', stockConc: 10, targetConc: 5 }]
            });
            const cost = calc.estimateCost(f);
            expect(cost.isComplete).toBe(false);
            expect(cost.totalCost).toBeNull();
        });

        test('handles ng/mL units', () => {
            const f = calc.createFormulation({
                name: 'GF',
                targetVolume: 1,
                components: [{ name: 'vegf', stockConc: 100, targetConc: 50 }]
            });
            const cost = calc.estimateCost(f);
            expect(cost.breakdown[0].grams).toBeGreaterThan(0);
            expect(cost.breakdown[0].cost).toBeGreaterThan(0);
        });
    });

    // ── Blend Viscosity ─────────────────────────────────────────

    describe('estimateBlendViscosity', () => {
        test('estimates for known hydrogels', () => {
            const f = calc.createFormulation({
                name: 'Blend',
                targetVolume: 10,
                components: [
                    { name: 'gelatin-methacrylate', stockConc: 20, targetConc: 5 },
                    { name: 'alginate', stockConc: 4, targetConc: 1 }
                ]
            });
            const v = calc.estimateBlendViscosity(f);
            expect(v.estimatedViscosity).toBeGreaterThan(0);
            expect(v.unit).toBe('Pa·s');
            expect(v.contributions).toHaveLength(2);
        });

        test('returns null for unknown materials', () => {
            const f = calc.createFormulation({
                name: 'Unknown',
                targetVolume: 5,
                components: [{ name: 'custom', stockConc: 10, targetConc: 5 }]
            });
            const v = calc.estimateBlendViscosity(f);
            expect(v.estimatedViscosity).toBeNull();
        });
    });

    // ── Templates ───────────────────────────────────────────────

    describe('templates', () => {
        test('lists available templates', () => {
            const templates = calc.getRecipeTemplates();
            expect(templates.length).toBeGreaterThanOrEqual(5);
            templates.forEach(t => {
                expect(t.id).toBeDefined();
                expect(t.name).toBeDefined();
                expect(t.components).toBeDefined();
            });
        });

        test('creates formulation from template', () => {
            const f = calc.fromTemplate('gelma-basic');
            expect(f.name).toBe('Basic GelMA Bioink');
            expect(f.templateId).toBe('gelma-basic');
            expect(f.components.length).toBeGreaterThan(0);
        });

        test('overrides template values', () => {
            const f = calc.fromTemplate('gelma-basic', { name: 'My GelMA', targetVolume: 20 });
            expect(f.name).toBe('My GelMA');
            expect(f.targetVolume).toBe(20);
        });

        test('throws on unknown template', () => {
            expect(() => calc.fromTemplate('nonexistent')).toThrow('not found');
        });

        test('fibrin template has crosslinker note', () => {
            const f = calc.fromTemplate('fibrin');
            expect(f.crosslinkerNote).toBeDefined();
        });
    });

    // ── Recommendations ─────────────────────────────────────────

    describe('getRecommendations', () => {
        test('returns all recommendations without arg', () => {
            const recs = calc.getRecommendations();
            expect(Object.keys(recs).length).toBeGreaterThanOrEqual(5);
        });

        test('returns specific tissue recommendation', () => {
            const r = calc.getRecommendations('bone');
            expect(r.tissue).toBe('Bone');
            expect(r.stiffness).toBeDefined();
            expect(r.growthFactors).toContain('bmp2');
        });

        test('handles unknown tissue', () => {
            const r = calc.getRecommendations('alien');
            expect(r.error).toBeDefined();
        });

        test('cartilage suggests HA', () => {
            const r = calc.getRecommendations('cartilage');
            expect(r.suggestedBase).toContain('hyaluronic-acid');
        });
    });

    // ── Export / Import ─────────────────────────────────────────

    describe('export/import', () => {
        test('round-trips via JSON', () => {
            const f = calc.createFormulation({
                name: 'Export Test',
                targetVolume: 5,
                components: [{ name: 'alginate', stockConc: 4, targetConc: 2 }]
            });
            const json = calc.exportFormulation(f);
            const imported = calc.importFormulation(json);
            expect(imported.name).toBe('Export Test');
            expect(imported.components).toHaveLength(1);
        });

        test('import throws on invalid JSON', () => {
            expect(() => calc.importFormulation('not json')).toThrow('Failed to import');
        });

        test('import throws on missing fields', () => {
            expect(() => calc.importFormulation('{"foo": "bar"}')).toThrow('missing required');
        });

        test('import accepts object directly', () => {
            const obj = { name: 'Direct', targetVolume: 5, components: [{ name: 'x' }] };
            const imported = calc.importFormulation(obj);
            expect(imported.name).toBe('Direct');
        });
    });

    // ── Report Generation ───────────────────────────────────────

    describe('generateReport', () => {
        test('generates text report', () => {
            const f = calc.createFormulation({
                name: 'Report Test',
                targetVolume: 5,
                components: [
                    { name: 'gelatin-methacrylate', stockConc: 20, targetConc: 7 },
                    { name: 'lap', stockConc: 2, targetConc: 0.1 }
                ]
            });
            const report = calc.generateReport(f);
            expect(report).toContain('Report Test');
            expect(report).toContain('Components');
            expect(report).toContain('GelMA');
            expect(report).toContain('Mixing Order');
        });

        test('includes cells in report', () => {
            const f = calc.createFormulation({
                name: 'Cells',
                targetVolume: 5,
                components: [{ name: 'alginate', stockConc: 4, targetConc: 2 }],
                cells: { name: 'MSCs', stockDensity: 10e6, targetDensity: 5e6 }
            });
            const report = calc.generateReport(f);
            expect(report).toContain('MSCs');
            expect(report).toContain('Cell Component');
        });

        test('includes warnings in report', () => {
            const f = calc.createFormulation({
                name: 'Warn',
                targetVolume: 10,
                components: [{ name: 'alginate', stockConc: 20, targetConc: 10 }]
            });
            const report = calc.generateReport(f);
            expect(report).toContain('Warnings');
        });

        test('includes cost estimate in report', () => {
            const f = calc.createFormulation({
                name: 'Cost',
                targetVolume: 5,
                components: [{ name: 'alginate', stockConc: 4, targetConc: 2 }]
            });
            const report = calc.generateReport(f);
            expect(report).toContain('Cost Estimate');
            expect(report).toContain('$');
        });

        test('includes crosslinker note from template', () => {
            const f = calc.fromTemplate('fibrin');
            const report = calc.generateReport(f);
            expect(report).toContain('Crosslinking Note');
            expect(report).toContain('thrombin');
        });
    });

    // ── Material Listing ────────────────────────────────────────

    describe('listBaseMaterials / listAdditives', () => {
        test('lists base materials with keys', () => {
            const mats = calc.listBaseMaterials();
            expect(mats.length).toBeGreaterThanOrEqual(8);
            mats.forEach(m => {
                expect(m.key).toBeDefined();
                expect(m.name).toBeDefined();
                expect(m.category).toBeDefined();
            });
        });

        test('lists additives with keys', () => {
            const adds = calc.listAdditives();
            expect(adds.length).toBeGreaterThanOrEqual(8);
            adds.forEach(a => {
                expect(a.key).toBeDefined();
                expect(a.role).toBeDefined();
            });
        });
    });

    // ── Serial Dilution edge cases ──────────────────────────────

    describe('serialDilution edge cases', () => {
        test('1:2 dilution produces halving', () => {
            const steps = calc.serialDilution({ stockConc: 64, dilutionFactor: 2, steps: 6, volumePerStep: 2 });
            expect(steps[5].concentration).toBe(1);
        });

        test('preserves fromConcentration chain', () => {
            const steps = calc.serialDilution({ stockConc: 100, dilutionFactor: 10, steps: 3, volumePerStep: 1 });
            expect(steps[0].fromConcentration).toBe(100);
            expect(steps[1].fromConcentration).toBe(10);
            expect(steps[2].fromConcentration).toBe(1);
        });
    });

    // ── Integration: full workflow ──────────────────────────────

    describe('integration', () => {
        test('full workflow: template → scale → report → export', () => {
            const f = calc.fromTemplate('gelma-ha', { targetVolume: 10 });
            expect(f.tissue).toBe('cartilage');

            const scaled = calc.scaleFormulation(f, 2);
            expect(scaled.targetVolume).toBe(20);

            const report = calc.generateReport(scaled);
            expect(report).toContain('GelMA-HA');

            const json = calc.exportFormulation(scaled);
            const reimported = calc.importFormulation(json);
            expect(reimported.targetVolume).toBe(20);
        });

        test('compare template variants', () => {
            const bone = calc.fromTemplate('bone-gelma');
            const basic = calc.fromTemplate('gelma-basic');
            const cmp = calc.compareFormulations(basic, bone);
            expect(cmp.sharedComponents).toBeGreaterThanOrEqual(1);
        });

        test('dilution → formulation flow', () => {
            const dil = calc.dilution({ stockConc: 20, targetConc: 7, targetVolume: 5 });
            expect(dil.stockVolume).toBeCloseTo(1.75, 2);

            const f = calc.createFormulation({
                name: 'From Dilution',
                targetVolume: 5,
                components: [{ name: 'gelatin-methacrylate', stockConc: 20, targetConc: 7 }]
            });
            expect(f.components[0].volumeNeeded).toBeCloseTo(dil.stockVolume, 2);
        });
    });
});
