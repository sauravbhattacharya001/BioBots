/**
 * Tests for the Multi-Nozzle Coordination Planner module.
 */

const { createNozzlePlanner } = require('../Try/scripts/nozzlePlanner');

describe('createNozzlePlanner', () => {
    let planner;

    beforeEach(() => {
        planner = createNozzlePlanner();
    });

    // ── Factory ────────────────────────────────────────────────

    test('creates planner with default config', () => {
        expect(planner).toBeDefined();
        expect(planner.configureNozzles).toBeInstanceOf(Function);
        expect(planner.checkCollisions).toBeInstanceOf(Function);
        expect(planner.planTempTransition).toBeInstanceOf(Function);
        expect(planner.planPurgeSequence).toBeInstanceOf(Function);
        expect(planner.generateLayerPlan).toBeInstanceOf(Function);
        expect(planner.optimizePlan).toBeInstanceOf(Function);
        expect(planner.checkMaterialCompatibility).toBeInstanceOf(Function);
        expect(planner.estimatePrintTime).toBeInstanceOf(Function);
        expect(planner.generateReport).toBeInstanceOf(Function);
        expect(planner.textSummary).toBeInstanceOf(Function);
    });

    test('exposes default nozzle and material profiles', () => {
        expect(planner.DEFAULT_NOZZLES).toBeDefined();
        expect(Object.keys(planner.DEFAULT_NOZZLES).length).toBeGreaterThanOrEqual(5);
        expect(planner.DEFAULT_MATERIALS).toBeDefined();
        expect(Object.keys(planner.DEFAULT_MATERIALS).length).toBeGreaterThanOrEqual(6);
    });

    test('accepts custom config overrides', () => {
        var custom = createNozzlePlanner({ maxNozzles: 8, printSpeed: 20 });
        // Should allow 8 nozzles now
        var assignments = [];
        for (var i = 0; i < 5; i++) {
            assignments.push({ materialId: 'alginate-3' });
        }
        var result = custom.configureNozzles(assignments);
        expect(result.count).toBe(5);
    });

    // ── configureNozzles ───────────────────────────────────────

    describe('configureNozzles', () => {
        test('configures single nozzle with material', () => {
            var cfg = planner.configureNozzles([
                { nozzleProfile: 'pneumatic-200', materialId: 'gelma-5' }
            ]);
            expect(cfg.count).toBe(1);
            expect(cfg.valid).toBe(true);
            expect(cfg.nozzles[0].materialId).toBe('gelma-5');
            expect(cfg.nozzles[0].material.name).toBe('GelMA 5%');
            expect(cfg.nozzles[0].profile.innerDiameter).toBe(0.2);
        });

        test('configures multiple nozzles', () => {
            var cfg = planner.configureNozzles([
                { id: 'n1', nozzleProfile: 'pneumatic-200', materialId: 'gelma-5' },
                { id: 'n2', nozzleProfile: 'pneumatic-400', materialId: 'alginate-3' },
                { id: 'n3', nozzleProfile: 'uv-250', materialId: 'hyaluronic-acid' }
            ]);
            expect(cfg.count).toBe(3);
            expect(cfg.nozzles[0].id).toBe('n1');
            expect(cfg.nozzles[1].id).toBe('n2');
            expect(cfg.nozzles[2].id).toBe('n3');
        });

        test('assigns default IDs when not provided', () => {
            var cfg = planner.configureNozzles([
                { materialId: 'gelma-5' },
                { materialId: 'alginate-3' }
            ]);
            expect(cfg.nozzles[0].id).toBe('nozzle-1');
            expect(cfg.nozzles[1].id).toBe('nozzle-2');
        });

        test('uses default nozzle profile when not specified', () => {
            var cfg = planner.configureNozzles([{ materialId: 'gelma-5' }]);
            expect(cfg.nozzles[0].profile.type).toBe('pneumatic');
            expect(cfg.nozzles[0].profile.innerDiameter).toBe(0.2);
        });

        test('accepts custom nozzle profile objects', () => {
            var cfg = planner.configureNozzles([{
                nozzleProfile: {
                    type: 'custom',
                    innerDiameter: 0.150,
                    outerDiameter: 0.300,
                    tempRange: [4, 50],
                    primeVolume: 0.5,
                    purgeVolume: 0.8
                },
                materialId: 'gelma-5'
            }]);
            expect(cfg.nozzles[0].profile.innerDiameter).toBe(0.15);
        });

        test('assigns nozzle offsets based on spacing', () => {
            var cfg = planner.configureNozzles([
                { materialId: 'gelma-5' },
                { materialId: 'alginate-3' }
            ]);
            expect(cfg.nozzles[0].offsetX).toBe(0);
            expect(cfg.nozzles[1].offsetX).toBe(15); // default nozzleSpacing
        });

        test('uses custom offsets when provided', () => {
            var cfg = planner.configureNozzles([
                { materialId: 'gelma-5', offsetX: 0, offsetY: 0 },
                { materialId: 'alginate-3', offsetX: 20, offsetY: 5 }
            ]);
            expect(cfg.nozzles[1].offsetX).toBe(20);
            expect(cfg.nozzles[1].offsetY).toBe(5);
        });

        test('creates fallback material for unknown materialId', () => {
            var cfg = planner.configureNozzles([
                { materialId: 'custom-ink-xyz' }
            ]);
            expect(cfg.nozzles[0].material.name).toBe('custom-ink-xyz');
            expect(cfg.nozzles[0].material.printTemp).toBe(25);
        });

        test('throws on empty assignments', () => {
            expect(() => planner.configureNozzles([])).toThrow('At least one');
        });

        test('throws on too many nozzles', () => {
            var five = Array(5).fill(null).map(() => ({ materialId: 'gelma-5' }));
            expect(() => planner.configureNozzles(five)).toThrow('Cannot exceed');
        });

        test('throws on duplicate nozzle IDs', () => {
            expect(() => planner.configureNozzles([
                { id: 'dup', materialId: 'gelma-5' },
                { id: 'dup', materialId: 'alginate-3' }
            ])).toThrow('Duplicate nozzle ID');
        });

        test('throws on unknown nozzle profile string', () => {
            expect(() => planner.configureNozzles([
                { nozzleProfile: 'nonexistent-nozzle' }
            ])).toThrow('Unknown nozzle profile');
        });

        test('throws when material temp outside nozzle range', () => {
            expect(() => planner.configureNozzles([
                { nozzleProfile: 'pneumatic-200', materialId: 'pcl' }
            ])).toThrow('outside nozzle range');
        });

        test('sets currentTemp from material storageTemp', () => {
            var cfg = planner.configureNozzles([
                { materialId: 'collagen-i' }
            ]);
            expect(cfg.nozzles[0].currentTemp).toBe(4); // collagen storageTemp
        });
    });

    // ── checkCollisions ────────────────────────────────────────

    describe('checkCollisions', () => {
        test('reports no collision for well-spaced nozzles', () => {
            var cfg = planner.configureNozzles([
                { id: 'a', materialId: 'gelma-5', offsetX: 0 },
                { id: 'b', materialId: 'alginate-3', offsetX: 20 }
            ]);
            var result = planner.checkCollisions(cfg);
            expect(result.hasCollision).toBe(false);
            expect(result.pairs.length).toBe(1);
            expect(result.pairs[0].safe).toBe(true);
            expect(result.minClearance).toBeGreaterThan(0);
        });

        test('detects collision for close nozzles', () => {
            var cfg = planner.configureNozzles([
                { id: 'a', materialId: 'gelma-5', offsetX: 0 },
                { id: 'b', materialId: 'alginate-3', offsetX: 1 } // way too close
            ]);
            var result = planner.checkCollisions(cfg);
            expect(result.hasCollision).toBe(true);
            expect(result.pairs[0].safe).toBe(false);
            expect(result.minClearance).toBeLessThan(0);
        });

        test('checks all pairs for 3 nozzles', () => {
            var cfg = planner.configureNozzles([
                { materialId: 'gelma-5', offsetX: 0 },
                { materialId: 'alginate-3', offsetX: 20 },
                { materialId: 'hyaluronic-acid', offsetX: 40 }
            ]);
            var result = planner.checkCollisions(cfg);
            expect(result.pairs.length).toBe(3); // 3 choose 2
            expect(result.nozzleCount).toBe(3);
        });

        test('returns zero clearance for single nozzle', () => {
            var cfg = planner.configureNozzles([{ materialId: 'gelma-5' }]);
            var result = planner.checkCollisions(cfg);
            expect(result.pairs.length).toBe(0);
            expect(result.hasCollision).toBe(false);
            expect(result.minClearance).toBe(0);
        });
    });

    // ── planTempTransition ─────────────────────────────────────

    describe('planTempTransition', () => {
        test('calculates heating transition', () => {
            var result = planner.planTempTransition(22, 37);
            expect(result.delta).toBe(15);
            expect(result.direction).toBe('heating');
            expect(result.transitionTime).toBeGreaterThan(0);
            expect(result.dwellTime).toBeGreaterThanOrEqual(2);
            expect(result.totalTime).toBeGreaterThan(result.transitionTime);
            expect(result.riskLevel).toBe('low');
        });

        test('calculates cooling transition', () => {
            var result = planner.planTempTransition(37, 10);
            expect(result.delta).toBe(27);
            expect(result.direction).toBe('cooling');
            expect(result.riskLevel).toBe('medium');
        });

        test('handles zero delta', () => {
            var result = planner.planTempTransition(25, 25);
            expect(result.delta).toBe(0);
            expect(result.direction).toBe('none');
            expect(result.transitionTime).toBe(0);
            expect(result.dwellTime).toBe(0);
            expect(result.totalTime).toBe(0);
            expect(result.riskLevel).toBe('low');
        });

        test('flags high risk for large delta', () => {
            var result = planner.planTempTransition(10, 50);
            expect(result.riskLevel).toBe('high');
        });

        test('throws on non-numeric temps', () => {
            expect(() => planner.planTempTransition('hot', 25)).toThrow('must be numbers');
        });

        test('throws on excessive delta', () => {
            expect(() => planner.planTempTransition(0, 100)).toThrow('exceeds max');
        });
    });

    // ── planPurgeSequence ──────────────────────────────────────

    describe('planPurgeSequence', () => {
        test('plans purge between two nozzles', () => {
            var cfg = planner.configureNozzles([
                { id: 'from', nozzleProfile: 'pneumatic-200', materialId: 'gelma-5' },
                { id: 'to', nozzleProfile: 'pneumatic-400', materialId: 'alginate-3' }
            ]);
            var result = planner.planPurgeSequence(cfg.nozzles[0], cfg.nozzles[1]);
            expect(result.purgeVolume).toBeGreaterThan(0);
            expect(result.primeVolume).toBeGreaterThan(0);
            expect(result.totalWasteVolume).toBe(
                result.purgeVolume + result.primeVolume
            );
            expect(result.totalTime).toBeGreaterThan(0);
            expect(result.crossContamRisk).toBeDefined();
            expect(result.steps.length).toBe(6);
        });

        test('increases purge for high cross-contamination risk', () => {
            var cfg = planner.configureNozzles([
                { id: 'cell', materialId: 'gelma-5' },    // cell-compatible
                { id: 'noncell', nozzleProfile: 'heated-300', materialId: 'pcl' }  // not cell-compatible
            ]);
            var result = planner.planPurgeSequence(cfg.nozzles[0], cfg.nozzles[1]);
            expect(result.crossContamRisk).toBe('high');
            // Purge should be amplified
            var baseCfg = planner.configureNozzles([
                { id: 'a', materialId: 'gelma-5' },
                { id: 'b', materialId: 'alginate-3' }
            ]);
            var baseResult = planner.planPurgeSequence(baseCfg.nozzles[0], baseCfg.nozzles[1]);
            expect(result.totalWasteVolume).toBeGreaterThan(baseResult.totalWasteVolume);
        });

        test('reports medium risk for different material types', () => {
            var cfg = planner.configureNozzles([
                { id: 'a', materialId: 'gelma-5' },       // photocrosslinkable
                { id: 'b', materialId: 'alginate-3' }     // ionic-crosslink
            ]);
            var result = planner.planPurgeSequence(cfg.nozzles[0], cfg.nozzles[1]);
            expect(result.crossContamRisk).toBe('medium');
        });

        test('throws without nozzles', () => {
            expect(() => planner.planPurgeSequence(null, {})).toThrow('required');
        });

        test('purge steps have correct actions', () => {
            var cfg = planner.configureNozzles([
                { id: 'a', materialId: 'gelma-5' },
                { id: 'b', materialId: 'alginate-3' }
            ]);
            var result = planner.planPurgeSequence(cfg.nozzles[0], cfg.nozzles[1]);
            var actions = result.steps.map(s => s.action);
            expect(actions).toEqual([
                'retract', 'travel-to-purge', 'purge',
                'activate', 'prime', 'travel-to-print'
            ]);
        });
    });

    // ── generateLayerPlan ──────────────────────────────────────

    describe('generateLayerPlan', () => {
        var cfg;

        beforeEach(() => {
            cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'gelma-5' },
                { id: 'n2', materialId: 'alginate-3' }
            ]);
        });

        test('generates plan for single-material layer', () => {
            var plan = planner.generateLayerPlan(cfg, [
                { height: 0.2, regions: [{ materialId: 'gelma-5', area: 100, perimeter: 40 }] }
            ]);
            expect(plan.layerCount).toBe(1);
            expect(plan.layers[0].regionCount).toBe(1);
            expect(plan.summary.totalNozzleSwitches).toBe(0);
            expect(plan.summary.efficiency).toBe(100);
        });

        test('generates plan for multi-material layer', () => {
            var plan = planner.generateLayerPlan(cfg, [
                { height: 0.2, regions: [
                    { materialId: 'gelma-5', area: 50, perimeter: 30 },
                    { materialId: 'alginate-3', area: 50, perimeter: 30 }
                ]}
            ]);
            expect(plan.summary.totalNozzleSwitches).toBe(1);
            expect(plan.summary.totalSwitchTime).toBeGreaterThan(0);
            expect(plan.summary.switchOverhead).toBeGreaterThan(0);
        });

        test('generates plan for multiple layers', () => {
            var layers = [];
            for (var i = 0; i < 5; i++) {
                layers.push({
                    height: 0.2,
                    regions: [
                        { materialId: 'gelma-5', area: 50, perimeter: 30 },
                        { materialId: 'alginate-3', area: 50, perimeter: 30 }
                    ]
                });
            }
            var plan = planner.generateLayerPlan(cfg, layers);
            expect(plan.layerCount).toBe(5);
            // First layer has 1 switch (n1→n2), subsequent layers may also switch
            expect(plan.summary.totalNozzleSwitches).toBeGreaterThanOrEqual(5);
        });

        test('minimizes switches by grouping same-material regions', () => {
            var plan = planner.generateLayerPlan(cfg, [
                { height: 0.2, regions: [
                    { materialId: 'gelma-5', area: 30, perimeter: 20 },
                    { materialId: 'alginate-3', area: 30, perimeter: 20 },
                    { materialId: 'gelma-5', area: 30, perimeter: 20 }
                ]}
            ]);
            // Should group gelma-5 regions together, only 1 switch
            expect(plan.layers[0].nozzleSwitches).toBe(1);
        });

        test('formats total time', () => {
            var plan = planner.generateLayerPlan(cfg, [
                { height: 0.2, regions: [{ materialId: 'gelma-5', area: 100, perimeter: 40 }] }
            ]);
            expect(plan.summary.totalTimeFormatted).toMatch(/\d+[hms]/);
        });

        test('calculates purge waste', () => {
            var plan = planner.generateLayerPlan(cfg, [
                { height: 0.2, regions: [
                    { materialId: 'gelma-5', area: 50, perimeter: 30 },
                    { materialId: 'alginate-3', area: 50, perimeter: 30 }
                ]}
            ]);
            expect(plan.summary.totalPurgeWaste).toBeGreaterThan(0);
        });

        test('throws on missing nozzle config', () => {
            expect(() => planner.generateLayerPlan(null, [{}])).toThrow('Valid nozzle');
        });

        test('throws on empty layers', () => {
            expect(() => planner.generateLayerPlan(cfg, [])).toThrow('At least one');
        });

        test('throws on unassigned material', () => {
            expect(() => planner.generateLayerPlan(cfg, [
                { regions: [{ materialId: 'pcl', area: 50 }] }
            ])).toThrow('No nozzle assigned');
        });

        test('uses default height when not provided', () => {
            var plan = planner.generateLayerPlan(cfg, [
                { regions: [{ materialId: 'gelma-5', area: 10, perimeter: 5 }] }
            ]);
            expect(plan.layers[0].height).toBe(0.2);
        });

        test('handles layers with empty regions', () => {
            var plan = planner.generateLayerPlan(cfg, [
                { height: 0.2, regions: [] }
            ]);
            expect(plan.layers[0].regionCount).toBe(0);
            expect(plan.layers[0].steps.length).toBe(0);
        });
    });

    // ── optimizePlan ───────────────────────────────────────────

    describe('optimizePlan', () => {
        test('scores single-material plan at 100', () => {
            var cfg = planner.configureNozzles([{ id: 'n1', materialId: 'gelma-5' }]);
            var plan = planner.generateLayerPlan(cfg, [
                { regions: [{ materialId: 'gelma-5', area: 100, perimeter: 40 }] }
            ]);
            var opt = planner.optimizePlan(plan);
            expect(opt.optimizationScore).toBe(100);
            expect(opt.totalSwitches).toBe(0);
            expect(opt.pingPongPatterns).toBe(0);
            expect(opt.suggestions.length).toBe(0);
        });

        test('detects high switch overhead', () => {
            var cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'gelma-5' },
                { id: 'n2', materialId: 'alginate-3' }
            ]);
            // Many tiny regions force lots of switches relative to print time
            var regions = [];
            for (var i = 0; i < 10; i++) {
                regions.push({ materialId: i % 2 === 0 ? 'gelma-5' : 'alginate-3', area: 1, perimeter: 1 });
            }
            var plan = planner.generateLayerPlan(cfg, [{ regions: regions }]);
            var opt = planner.optimizePlan(plan);
            // Even with sorting, we'll have at least 1 switch
            expect(opt.totalSwitches).toBeGreaterThanOrEqual(1);
        });

        test('returns costliest switches sorted', () => {
            var cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'gelma-5' },
                { id: 'n2', materialId: 'alginate-3' }
            ]);
            var plan = planner.generateLayerPlan(cfg, [
                { regions: [
                    { materialId: 'gelma-5', area: 50, perimeter: 20 },
                    { materialId: 'alginate-3', area: 50, perimeter: 20 }
                ]},
                { regions: [
                    { materialId: 'gelma-5', area: 50, perimeter: 20 },
                    { materialId: 'alginate-3', area: 50, perimeter: 20 }
                ]}
            ]);
            var opt = planner.optimizePlan(plan);
            expect(opt.costliestSwitches.length).toBeGreaterThan(0);
            if (opt.costliestSwitches.length > 1) {
                expect(opt.costliestSwitches[0].time).toBeGreaterThanOrEqual(
                    opt.costliestSwitches[1].time
                );
            }
        });

        test('throws on invalid plan', () => {
            expect(() => planner.optimizePlan(null)).toThrow('Valid print plan');
        });
    });

    // ── checkMaterialCompatibility ─────────────────────────────

    describe('checkMaterialCompatibility', () => {
        test('reports compatible for similar-temp materials', () => {
            var cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'gelma-5' },   // 22°C
                { id: 'n2', materialId: 'alginate-3' }  // 25°C
            ]);
            var result = planner.checkMaterialCompatibility(cfg);
            expect(result.compatible).toBe(true);
            expect(result.temperatureSpread).toBe(3);
            expect(result.materialCount).toBe(2);
        });

        test('flags high temperature spread', () => {
            var cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'collagen-i' },    // 10°C
                { id: 'n2', nozzleProfile: 'heated-300', materialId: 'pcl' }  // 65°C
            ]);
            var result = planner.checkMaterialCompatibility(cfg);
            expect(result.compatible).toBe(false);
            expect(result.temperatureSpread).toBe(55);
            var highWarnings = result.warnings.filter(w => w.severity === 'high');
            expect(highWarnings.length).toBeGreaterThan(0);
        });

        test('warns about cell/non-cell mix', () => {
            var cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'gelma-5' },    // cell-compatible
                { id: 'n2', nozzleProfile: 'heated-300', materialId: 'pcl' }  // not cell-compatible
            ]);
            var result = planner.checkMaterialCompatibility(cfg);
            var crossWarnings = result.warnings.filter(w => w.type === 'cross-contamination');
            expect(crossWarnings.length).toBe(1);
        });

        test('warns about crosslink conflicts', () => {
            var cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'gelma-5' },      // photocrosslinkable
                { id: 'n2', materialId: 'collagen-i' }    // thermal-crosslink
            ]);
            var result = planner.checkMaterialCompatibility(cfg);
            var crosslinkWarns = result.warnings.filter(w => w.type === 'crosslink-conflict');
            expect(crosslinkWarns.length).toBe(1);
        });

        test('reports zero spread for single material', () => {
            var cfg = planner.configureNozzles([{ id: 'n1', materialId: 'gelma-5' }]);
            var result = planner.checkMaterialCompatibility(cfg);
            expect(result.temperatureSpread).toBe(0);
            expect(result.warnings.length).toBe(0);
        });
    });

    // ── estimatePrintTime ──────────────────────────────────────

    describe('estimatePrintTime', () => {
        var cfg;

        beforeEach(() => {
            cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'gelma-5' },
                { id: 'n2', materialId: 'alginate-3' }
            ]);
        });

        test('estimates time for zero-switch job', () => {
            var result = planner.estimatePrintTime(cfg, 100, 50, 0);
            expect(result.purePrintTime).toBeGreaterThan(0);
            expect(result.totalSwitchTime).toBe(0);
            expect(result.totalSwitches).toBe(0);
            expect(result.efficiency).toBe(100);
        });

        test('estimates time with switches', () => {
            var result = planner.estimatePrintTime(cfg, 100, 50, 1);
            expect(result.totalSwitches).toBe(50);
            expect(result.totalSwitchTime).toBeGreaterThan(0);
            expect(result.efficiency).toBeLessThan(100);
            expect(result.totalPurgeWaste).toBeGreaterThan(0);
        });

        test('provides time breakdown', () => {
            var result = planner.estimatePrintTime(cfg, 100, 20, 2);
            expect(result.breakdown.printPercent).toBeGreaterThan(0);
            expect(result.breakdown.switchPercent).toBeGreaterThan(0);
            expect(Math.abs(result.breakdown.printPercent + result.breakdown.switchPercent - 100))
                .toBeLessThan(1);
        });

        test('formats total time', () => {
            var result = planner.estimatePrintTime(cfg, 1000, 100, 1);
            expect(result.totalTimeFormatted).toMatch(/\d+[hms]/);
        });

        test('throws on non-positive volume', () => {
            expect(() => planner.estimatePrintTime(cfg, 0, 10, 1)).toThrow('volume must be positive');
        });

        test('throws on non-positive layer count', () => {
            expect(() => planner.estimatePrintTime(cfg, 100, 0, 1)).toThrow('Layer count');
        });

        test('throws on negative switches per layer', () => {
            expect(() => planner.estimatePrintTime(cfg, 100, 10, -1)).toThrow('cannot be negative');
        });
    });

    // ── generateReport ─────────────────────────────────────────

    describe('generateReport', () => {
        test('generates comprehensive report', () => {
            var cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'gelma-5' },
                { id: 'n2', materialId: 'alginate-3' }
            ]);
            var layers = [
                { height: 0.2, regions: [
                    { materialId: 'gelma-5', area: 100, perimeter: 40 },
                    { materialId: 'alginate-3', area: 80, perimeter: 35 }
                ]},
                { height: 0.2, regions: [
                    { materialId: 'gelma-5', area: 100, perimeter: 40 }
                ]}
            ];
            var report = planner.generateReport(cfg, layers);
            expect(report.configuration.nozzleCount).toBe(2);
            expect(report.collisionCheck).toBeDefined();
            expect(report.materialCompatibility).toBeDefined();
            expect(report.printPlan).toBeDefined();
            expect(report.optimization).toBeDefined();
            expect(report.viable).toBe(true);
            expect(report.generatedAt).toBeDefined();
        });

        test('marks non-viable when collision detected', () => {
            var cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'gelma-5', offsetX: 0 },
                { id: 'n2', materialId: 'alginate-3', offsetX: 1 }
            ]);
            var layers = [
                { regions: [{ materialId: 'gelma-5', area: 10, perimeter: 5 }] }
            ];
            var report = planner.generateReport(cfg, layers);
            expect(report.viable).toBe(false);
            expect(report.issues.some(i => i.indexOf('CRITICAL') >= 0)).toBe(true);
        });

        test('includes nozzle details in configuration', () => {
            var cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'gelma-5' }
            ]);
            var report = planner.generateReport(cfg, [
                { regions: [{ materialId: 'gelma-5', area: 50, perimeter: 20 }] }
            ]);
            var n = report.configuration.nozzles[0];
            expect(n.id).toBe('n1');
            expect(n.materialName).toBe('GelMA 5%');
            expect(n.printTemp).toBe(22);
        });
    });

    // ── textSummary ────────────────────────────────────────────

    describe('textSummary', () => {
        test('produces readable text output', () => {
            var cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'gelma-5' },
                { id: 'n2', materialId: 'alginate-3' }
            ]);
            var layers = [
                { height: 0.2, regions: [
                    { materialId: 'gelma-5', area: 80, perimeter: 35 },
                    { materialId: 'alginate-3', area: 60, perimeter: 30 }
                ]}
            ];
            var report = planner.generateReport(cfg, layers);
            var text = planner.textSummary(report);

            expect(text).toContain('MULTI-NOZZLE PRINT PLAN');
            expect(text).toContain('Nozzles (2)');
            expect(text).toContain('Collision Check: PASS');
            expect(text).toContain('Print Plan');
            expect(text).toContain('Optimization Score');
            expect(text).toContain('Viable: YES');
        });

        test('shows issues in summary', () => {
            var cfg = planner.configureNozzles([
                { id: 'n1', materialId: 'gelma-5', offsetX: 0 },
                { id: 'n2', materialId: 'alginate-3', offsetX: 1 }
            ]);
            var report = planner.generateReport(cfg, [
                { regions: [{ materialId: 'gelma-5', area: 10, perimeter: 5 }] }
            ]);
            var text = planner.textSummary(report);
            expect(text).toContain('FAIL');
            expect(text).toContain('Viable: NO');
        });
    });

    // ── Edge cases ─────────────────────────────────────────────

    describe('edge cases', () => {
        test('single nozzle, many layers', () => {
            var cfg = planner.configureNozzles([{ id: 'solo', materialId: 'gelma-5' }]);
            var layers = Array(20).fill(null).map(() => ({
                height: 0.1,
                regions: [{ materialId: 'gelma-5', area: 50, perimeter: 25 }]
            }));
            var plan = planner.generateLayerPlan(cfg, layers);
            expect(plan.summary.totalNozzleSwitches).toBe(0);
            expect(plan.summary.efficiency).toBe(100);
        });

        test('3-nozzle, 3-material plan', () => {
            var cfg = planner.configureNozzles([
                { id: 'structural', materialId: 'gelma-5', offsetX: 0 },
                { id: 'cellular', materialId: 'alginate-3', offsetX: 20 },
                { id: 'support', materialId: 'hyaluronic-acid', offsetX: 40 }
            ]);
            var plan = planner.generateLayerPlan(cfg, [
                { height: 0.3, regions: [
                    { materialId: 'gelma-5', area: 40, perimeter: 25 },
                    { materialId: 'alginate-3', area: 30, perimeter: 20 },
                    { materialId: 'hyaluronic-acid', area: 20, perimeter: 15 }
                ]}
            ]);
            expect(plan.summary.totalNozzleSwitches).toBe(2);
        });

        test('region with zero area and perimeter prints instantly', () => {
            var cfg = planner.configureNozzles([{ id: 'n1', materialId: 'gelma-5' }]);
            var plan = planner.generateLayerPlan(cfg, [
                { regions: [{ materialId: 'gelma-5', area: 0, perimeter: 0 }] }
            ]);
            var printStep = plan.layers[0].steps[0];
            expect(printStep.time).toBe(0);
        });

        test('all default materials have required fields', () => {
            var mats = planner.DEFAULT_MATERIALS;
            Object.keys(mats).forEach(key => {
                expect(mats[key].name).toBeDefined();
                expect(typeof mats[key].printTemp).toBe('number');
                expect(typeof mats[key].purgeMultiplier).toBe('number');
                expect(typeof mats[key].cellCompatible).toBe('boolean');
            });
        });

        test('all default nozzles have required fields', () => {
            var nozzles = planner.DEFAULT_NOZZLES;
            Object.keys(nozzles).forEach(key => {
                expect(nozzles[key].type).toBeDefined();
                expect(typeof nozzles[key].innerDiameter).toBe('number');
                expect(typeof nozzles[key].outerDiameter).toBe('number');
                expect(Array.isArray(nozzles[key].tempRange)).toBe(true);
                expect(typeof nozzles[key].primeVolume).toBe('number');
                expect(typeof nozzles[key].purgeVolume).toBe('number');
            });
        });
    });
});
