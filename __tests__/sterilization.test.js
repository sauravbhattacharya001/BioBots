'use strict';

const { createSterilizationAnalyzer } = require('../Try/scripts/sterilization');

describe('createSterilizationAnalyzer', () => {
    let analyzer;

    beforeEach(() => {
        analyzer = createSterilizationAnalyzer();
    });

    // ── Kill kinetics ───────────────────────────────────────────

    describe('calculateKillKinetics', () => {
        test('calculates log reduction for autoclave', () => {
            const result = analyzer.calculateKillKinetics('autoclave121', 20);
            expect(result.method).toBe('autoclave121');
            expect(result.logReduction).toBeGreaterThan(0);
            expect(result.survivors).toBeLessThan(result.initialBioburden);
            expect(result.durationUnit).toBe('minutes');
        });

        test('returns sterile=true when SAL is below threshold', () => {
            // B. stearothermophilus D=1.5min at 121°C
            // Need ~13.5 min for 9-log reduction (1000 → 10^-6)
            const result = analyzer.calculateKillKinetics('autoclave121', 30);
            expect(result.logReduction).toBeGreaterThan(9);
            expect(result.sterile).toBe(true);
        });

        test('zero duration yields no kill', () => {
            const result = analyzer.calculateKillKinetics('autoclave121', 0);
            expect(result.logReduction).toBe(0);
            expect(result.survivors).toBe(1000);
        });

        test('returns ineffective for ethanol vs spores', () => {
            const result = analyzer.calculateKillKinetics('ethanol', 30, 'B. stearothermophilus');
            expect(result.effective).toBe(false);
            expect(result.dValue).toBeNull();
            expect(result.reason).toContain('not effective');
        });

        test('uses gamma dose units', () => {
            const result = analyzer.calculateKillKinetics('gamma', 25, 'E. coli');
            expect(result.durationUnit).toBe('kGy');
            expect(result.logReduction).toBeGreaterThan(0);
        });

        test('throws on unknown method', () => {
            expect(() => analyzer.calculateKillKinetics('microwave', 10))
                .toThrow('Unknown method');
        });

        test('throws on negative duration', () => {
            expect(() => analyzer.calculateKillKinetics('autoclave121', -5))
                .toThrow('non-negative');
        });

        test('throws on unknown pathogen', () => {
            expect(() => analyzer.calculateKillKinetics('autoclave121', 20, 'Alien'))
                .toThrow('Unknown pathogen');
        });

        test('marks 6-log reduction as effective', () => {
            // E.coli D=0.1 at 121°C. 1 min → 10 log reduction
            const result = analyzer.calculateKillKinetics('autoclave121', 1, 'E. coli');
            expect(result.logReduction).toBeGreaterThanOrEqual(6);
            expect(result.effective).toBe(true);
        });

        test('short autoclave is not sufficient for spores', () => {
            const result = analyzer.calculateKillKinetics('autoclave121', 2, 'B. stearothermophilus');
            expect(result.logReduction).toBeLessThan(6);
            expect(result.effective).toBe(false);
        });
    });

    // ── Kill curve ──────────────────────────────────────────────

    describe('generateKillCurve', () => {
        test('generates curve with correct number of points', () => {
            const result = analyzer.generateKillCurve('autoclave121', 30, 10);
            expect(result.points).toHaveLength(11); // 0..10 inclusive
            expect(result.points[0].duration).toBe(0);
            expect(result.points[10].duration).toBe(30);
        });

        test('survivors decrease monotonically', () => {
            const result = analyzer.generateKillCurve('uvC', 60, 20);
            for (let i = 1; i < result.points.length; i++) {
                expect(result.points[i].survivors).toBeLessThanOrEqual(
                    result.points[i - 1].survivors);
            }
        });

        test('annotates SAL achievement time', () => {
            const result = analyzer.generateKillCurve('autoclave121', 30);
            expect(result.salReachedAt).toBeDefined();
            expect(result.salReachedAt).toBeGreaterThan(0);
        });

        test('annotates 6-log reduction time', () => {
            const result = analyzer.generateKillCurve('autoclave121', 30);
            expect(result.sixLogReductionAt).toBeDefined();
            expect(result.sixLogReductionAt).toBeGreaterThan(0);
        });

        test('returns ineffective for ethanol vs spores', () => {
            const result = analyzer.generateKillCurve('ethanol', 30, 10, 'B. stearothermophilus');
            expect(result.effective).toBe(false);
            expect(result.points).toEqual([]);
        });

        test('throws on non-positive maxDuration', () => {
            expect(() => analyzer.generateKillCurve('autoclave121', 0))
                .toThrow('positive');
        });

        test('defaults to 20 steps', () => {
            const result = analyzer.generateKillCurve('autoclave121', 30);
            expect(result.points).toHaveLength(21);
        });

        test('includes method metadata', () => {
            const result = analyzer.generateKillCurve('h2o2Plasma', 60);
            expect(result.methodName).toBe('H₂O₂ Plasma');
            expect(result.durationUnit).toBe('minutes');
        });
    });

    // ── Material compatibility ──────────────────────────────────

    describe('assessMaterialCompat', () => {
        test('GelMA is incompatible with autoclave', () => {
            const result = analyzer.assessMaterialCompat('GelMA', 'autoclave121');
            expect(result.compatible).toBe(false);
            expect(result.propertyRetention).toBe(0);
            expect(result.rating).toBe('incompatible');
        });

        test('Titanium is fully compatible with autoclave', () => {
            const result = analyzer.assessMaterialCompat('Titanium', 'autoclave121');
            expect(result.compatible).toBe(true);
            expect(result.propertyRetention).toBe(1);
            expect(result.rating).toBe('excellent');
        });

        test('multi-cycle degrades retention exponentially', () => {
            const single = analyzer.assessMaterialCompat('Alginate', 'uvC', 1);
            const multi = analyzer.assessMaterialCompat('Alginate', 'uvC', 5);
            expect(multi.propertyRetention).toBeLessThan(single.propertyRetention);
            // 0.95^5 ≈ 0.774
            expect(multi.propertyRetention).toBeCloseTo(Math.pow(0.95, 5), 2);
        });

        test('throws on unknown material', () => {
            expect(() => analyzer.assessMaterialCompat('Unobtanium', 'autoclave121'))
                .toThrow('Unknown material');
        });

        test('throws on unknown method', () => {
            expect(() => analyzer.assessMaterialCompat('GelMA', 'laser'))
                .toThrow('Unknown method');
        });

        test('returns retention percent', () => {
            const result = analyzer.assessMaterialCompat('PEEK', 'autoclave121');
            expect(result.retentionPercent).toBe(95);
        });

        test('includes material description', () => {
            const result = analyzer.assessMaterialCompat('Collagen', 'uvC');
            expect(result.materialDescription).toContain('collagen');
        });

        test('marginal recommendation for borderline materials', () => {
            const result = analyzer.assessMaterialCompat('Collagen', 'ethanol');
            // Retention 0.6, at threshold
            expect(result.compatible).toBe(true);
            expect(result.recommendation).toContain('Marginal');
        });
    });

    // ── Best methods for material ───────────────────────────────

    describe('bestMethodsForMaterial', () => {
        test('returns methods sorted by retention', () => {
            const result = analyzer.bestMethodsForMaterial('GelMA');
            expect(result.methods.length).toBeGreaterThan(0);
            for (let i = 1; i < result.methods.length; i++) {
                expect(result.methods[i].retention)
                    .toBeLessThanOrEqual(result.methods[i - 1].retention);
            }
        });

        test('best method for Titanium is always excellent', () => {
            const result = analyzer.bestMethodsForMaterial('Titanium');
            expect(result.bestMethod.retention).toBe(1);
            expect(result.compatibleMethods.length).toBe(result.methods.length);
        });

        test('GelMA has limited compatible methods', () => {
            const result = analyzer.bestMethodsForMaterial('GelMA');
            const incompat = result.methods.filter(m => !m.compatible);
            expect(incompat.length).toBeGreaterThan(0);
        });

        test('includes advantages and limitations', () => {
            const result = analyzer.bestMethodsForMaterial('Alginate');
            expect(result.bestMethod.advantages).toBeDefined();
            expect(result.bestMethod.advantages.length).toBeGreaterThan(0);
        });

        test('throws on unknown material', () => {
            expect(() => analyzer.bestMethodsForMaterial('Adamantium'))
                .toThrow('Unknown material');
        });
    });

    // ── Protocol recommendation ─────────────────────────────────

    describe('recommendProtocol', () => {
        test('recommends method for metal components', () => {
            const result = analyzer.recommendProtocol({
                materials: ['Titanium', 'Stainless Steel']
            });
            expect(result.recommended).not.toBeNull();
            expect(result.recommended.feasible).toBe(true);
        });

        test('finds no single method for incompatible material mix', () => {
            // GelMA needs low temp, but spores need high temp
            const result = analyzer.recommendProtocol({
                materials: ['GelMA'],
                pathogens: ['B. stearothermophilus']
            });
            // Should find UV-C or H2O2 plasma as alternatives
            expect(result.recommended).not.toBeNull();
            expect(result.recommended.category).not.toBe('heat');
        });

        test('excludes spores when includeSpores=false', () => {
            const withSpores = analyzer.recommendProtocol({
                materials: ['Alginate'],
                includeSpores: true
            });
            const noSpores = analyzer.recommendProtocol({
                materials: ['Alginate'],
                includeSpores: false
            });
            // Without spores, fewer pathogens are considered
            expect(noSpores.pathogens.length).toBeLessThan(withSpores.pathogens.length);
            // Spore-formers should be excluded from the no-spores list
            const sporePathogens = noSpores.pathogens.filter(p => {
                const info = analyzer.listPathogens().find(lp => lp.name === p);
                return info && info.type === 'spore';
            });
            expect(sporePathogens).toHaveLength(0);
        });

        test('includes summary text', () => {
            const result = analyzer.recommendProtocol({ materials: ['Glass'] });
            expect(result.summary).toBeDefined();
            expect(result.summary.length).toBeGreaterThan(0);
        });

        test('throws when no materials specified', () => {
            expect(() => analyzer.recommendProtocol({}))
                .toThrow('At least one material');
        });

        test('throws on unknown material', () => {
            expect(() => analyzer.recommendProtocol({ materials: ['Mythril'] }))
                .toThrow('Unknown material');
        });

        test('throws on unknown pathogen', () => {
            expect(() => analyzer.recommendProtocol({
                materials: ['Glass'],
                pathogens: ['SpaceVirus']
            })).toThrow('Unknown pathogen');
        });

        test('reports infeasible methods', () => {
            const result = analyzer.recommendProtocol({ materials: ['GelMA'] });
            expect(result.infeasible.length).toBeGreaterThan(0);
        });

        test('higher bioburden requires longer duration', () => {
            const low = analyzer.recommendProtocol({
                materials: ['Titanium'],
                bioburden: 100
            });
            const high = analyzer.recommendProtocol({
                materials: ['Titanium'],
                bioburden: 100000
            });
            if (low.recommended && high.recommended &&
                low.recommended.method === high.recommended.method) {
                expect(high.recommended.requiredDuration)
                    .toBeGreaterThan(low.recommended.requiredDuration);
            }
        });
    });

    // ── Multi-step protocol ─────────────────────────────────────

    describe('planMultiStepProtocol', () => {
        test('plans protocol for multiple components', () => {
            const result = analyzer.planMultiStepProtocol([
                { name: 'Nozzle', materials: ['Stainless Steel'] },
                { name: 'Bioink reservoir', materials: ['GelMA'] }
            ]);
            expect(result.steps).toHaveLength(2);
            expect(result.steps[0].stepNumber).toBe(1);
            expect(result.steps[1].stepNumber).toBe(2);
        });

        test('reports total estimated time', () => {
            const result = analyzer.planMultiStepProtocol([
                { name: 'Part A', materials: ['Titanium'] },
                { name: 'Part B', materials: ['Glass'] }
            ]);
            expect(result.totalTimeMin).toBeGreaterThan(0);
        });

        test('marks allFeasible when all steps have solutions', () => {
            const result = analyzer.planMultiStepProtocol([
                { name: 'Metal part', materials: ['Titanium'] }
            ]);
            expect(result.allFeasible).toBe(true);
        });

        test('throws on empty components', () => {
            expect(() => analyzer.planMultiStepProtocol([]))
                .toThrow('At least one component');
        });

        test('throws on too many components', () => {
            const many = [];
            for (let i = 0; i < 10; i++) {
                many.push({ name: 'Part' + i, materials: ['Titanium'] });
            }
            expect(() => analyzer.planMultiStepProtocol(many))
                .toThrow('Maximum');
        });

        test('throws on component without materials', () => {
            expect(() => analyzer.planMultiStepProtocol([
                { name: 'Bad', materials: [] }
            ])).toThrow('name and materials');
        });

        test('provides alternatives per step', () => {
            const result = analyzer.planMultiStepProtocol([
                { name: 'Part', materials: ['PEEK'] }
            ]);
            expect(result.steps[0].alternatives).toBeDefined();
        });
    });

    // ── Validation records ──────────────────────────────────────

    describe('recordValidation / getValidationHistory', () => {
        test('records a validation run', () => {
            const record = analyzer.recordValidation({
                method: 'autoclave121',
                date: '2026-03-04',
                biResult: 'pass',
                duration: 20
            });
            expect(record.id).toMatch(/^VAL-\d{4}$/);
            expect(record.passed).toBe(true);
        });

        test('tracks pass/fail statistics', () => {
            analyzer.recordValidation({ method: 'autoclave121', date: '2026-03-01', biResult: 'pass' });
            analyzer.recordValidation({ method: 'autoclave121', date: '2026-03-02', biResult: 'pass' });
            analyzer.recordValidation({ method: 'autoclave121', date: '2026-03-03', biResult: 'fail' });
            const history = analyzer.getValidationHistory();
            expect(history.total).toBe(3);
            expect(history.passed).toBe(2);
            expect(history.failed).toBe(1);
            expect(history.passRate).toBeCloseTo(0.667, 2);
        });

        test('filters by method', () => {
            analyzer.recordValidation({ method: 'autoclave121', date: '2026-03-01', biResult: 'pass' });
            analyzer.recordValidation({ method: 'uvC', date: '2026-03-02', biResult: 'pass' });
            const filtered = analyzer.getValidationHistory({ method: 'uvC' });
            expect(filtered.total).toBe(1);
        });

        test('filters by lastN', () => {
            for (let i = 0; i < 10; i++) {
                analyzer.recordValidation({
                    method: 'autoclave121',
                    date: '2026-03-0' + i,
                    biResult: 'pass'
                });
            }
            const last3 = analyzer.getValidationHistory({ lastN: 3 });
            expect(last3.total).toBe(3);
        });

        test('throws on missing method', () => {
            expect(() => analyzer.recordValidation({ date: '2026-01-01' }))
                .toThrow('method and date');
        });

        test('throws on unknown method', () => {
            expect(() => analyzer.recordValidation({ method: 'fire', date: '2026-01-01' }))
                .toThrow('Unknown method');
        });
    });

    // ── Cycle optimization ──────────────────────────────────────

    describe('optimizeCycle', () => {
        test('calculates minimum duration for autoclave', () => {
            const result = analyzer.optimizeCycle('autoclave121');
            expect(result.feasible).toBe(true);
            expect(result.minimumDuration).toBeGreaterThan(0);
            expect(result.overkillDuration).toBeGreaterThan(result.minimumDuration);
        });

        test('overkill applies safety factor', () => {
            const result = analyzer.optimizeCycle('autoclave121');
            expect(result.overkillDuration / result.minimumDuration)
                .toBeCloseTo(1.5, 1);
        });

        test('respects applyOverkill=false', () => {
            const result = analyzer.optimizeCycle('autoclave121', { applyOverkill: false });
            expect(result.recommendedDuration).toBe(result.minimumDuration);
        });

        test('higher bioburden needs longer duration', () => {
            const low = analyzer.optimizeCycle('autoclave121', { bioburden: 100 });
            const high = analyzer.optimizeCycle('autoclave121', { bioburden: 100000 });
            expect(high.minimumDuration).toBeGreaterThan(low.minimumDuration);
        });

        test('returns infeasible for ethanol vs spores', () => {
            const result = analyzer.optimizeCycle('ethanol', {
                pathogen: 'B. stearothermophilus'
            });
            expect(result.feasible).toBe(false);
        });

        test('gamma uses kGy units', () => {
            const result = analyzer.optimizeCycle('gamma');
            expect(result.durationUnit).toBe('kGy');
        });

        test('throws on unknown method', () => {
            expect(() => analyzer.optimizeCycle('plasma_cannon'))
                .toThrow('Unknown method');
        });
    });

    // ── Compare methods ─────────────────────────────────────────

    describe('compareMethods', () => {
        test('compares all methods against default pathogen', () => {
            const result = analyzer.compareMethods();
            expect(result.methods.length).toBe(7);
            expect(result.pathogen).toBe('B. stearothermophilus');
        });

        test('methods sorted by time to SAL', () => {
            const result = analyzer.compareMethods('E. coli');
            const effective = result.methods.filter(m => m.timeToSAL != null);
            for (let i = 1; i < effective.length; i++) {
                expect(effective[i].timeToSAL)
                    .toBeGreaterThanOrEqual(effective[i - 1].timeToSAL);
            }
        });

        test('identifies fastest method', () => {
            const result = analyzer.compareMethods('E. coli');
            expect(result.fastest).not.toBeNull();
            expect(result.fastest.effective).toBe(true);
        });

        test('includes material compatibility when specified', () => {
            const result = analyzer.compareMethods('S. aureus', ['GelMA', 'Titanium']);
            for (const m of result.methods) {
                expect(m.materialCompatibility).toHaveLength(2);
            }
        });

        test('ethanol is not effective against spores', () => {
            const result = analyzer.compareMethods('B. stearothermophilus');
            const ethanol = result.methods.find(m => m.method === 'ethanol');
            expect(ethanol.effective).toBe(false);
        });

        test('throws on unknown pathogen', () => {
            expect(() => analyzer.compareMethods('Xenomorph'))
                .toThrow('Unknown pathogen');
        });
    });

    // ── Full report ─────────────────────────────────────────────

    describe('generateReport', () => {
        test('generates comprehensive report', () => {
            const report = analyzer.generateReport({
                materials: ['Titanium', 'Glass'],
                environment: 'cleanroom'
            });
            expect(report.environment).toBe('cleanroom');
            expect(report.bioburden).toBe(100); // cleanroom default
            expect(report.materialCount).toBe(2);
            expect(report.materialAnalysis).toHaveLength(2);
            expect(report.recommendedProtocol).toBeDefined();
            expect(report.riskLevel).toBeDefined();
            expect(report.recommendations.length).toBeGreaterThan(0);
        });

        test('cleanroom has lower bioburden', () => {
            const lab = analyzer.generateReport({ materials: ['Titanium'], environment: 'lab' });
            const clean = analyzer.generateReport({ materials: ['Titanium'], environment: 'cleanroom' });
            expect(clean.bioburden).toBeLessThan(lab.bioburden);
        });

        test('high risk for difficult materials', () => {
            // GelMA cannot be autoclaved, limited options
            const report = analyzer.generateReport({ materials: ['GelMA'] });
            // Should still find methods (UV-C, H2O2 plasma)
            expect(report.recommendedProtocol.recommended).not.toBeNull();
        });

        test('validation status included', () => {
            analyzer.recordValidation({ method: 'autoclave121', date: '2026-03-04', biResult: 'pass' });
            const report = analyzer.generateReport({ materials: ['Titanium'] });
            expect(report.validationStatus.totalRuns).toBe(1);
            expect(report.validationStatus.passRate).toBe(1);
        });

        test('includes ISO compliance recommendation', () => {
            const report = analyzer.generateReport({ materials: ['PCL'] });
            const isoRec = report.recommendations.find(r => r.includes('ISO'));
            expect(isoRec).toBeDefined();
        });

        test('throws when no materials specified', () => {
            expect(() => analyzer.generateReport({}))
                .toThrow('materials array');
        });
    });

    // ── Custom pathogen/material management ─────────────────────

    describe('addPathogen / addMaterial', () => {
        test('adds custom pathogen', () => {
            const result = analyzer.addPathogen('Custom Virus', {
                type: 'virus',
                autoclave121: 0.05,
                uvC: 0.8,
                description: 'Test virus'
            });
            expect(result.added).toBe('Custom Virus');
            const kinetics = analyzer.calculateKillKinetics('autoclave121', 10, 'Custom Virus');
            expect(kinetics.logReduction).toBeGreaterThan(0);
        });

        test('adds custom material', () => {
            const result = analyzer.addMaterial('CustomPolymer', {
                autoclave121: 0.5,
                uvC: 0.9,
                description: 'Test polymer'
            });
            expect(result.added).toBe('CustomPolymer');
            const compat = analyzer.assessMaterialCompat('CustomPolymer', 'uvC');
            expect(compat.propertyRetention).toBe(0.9);
        });

        test('throws on empty pathogen name', () => {
            expect(() => analyzer.addPathogen('', {})).toThrow('non-empty string');
        });

        test('throws on non-object pathogen data', () => {
            expect(() => analyzer.addPathogen('Test', 'not-object')).toThrow('object');
        });
    });

    // ── List functions ──────────────────────────────────────────

    describe('listPathogens / listMaterials / listMethods', () => {
        test('lists all default pathogens', () => {
            const list = analyzer.listPathogens();
            expect(list.length).toBe(8);
            const names = list.map(p => p.name);
            expect(names).toContain('E. coli');
            expect(names).toContain('S. aureus');
        });

        test('lists all default materials', () => {
            const list = analyzer.listMaterials();
            expect(list.length).toBe(12);
            const names = list.map(m => m.name);
            expect(names).toContain('GelMA');
            expect(names).toContain('Titanium');
        });

        test('lists all sterilization methods', () => {
            const list = analyzer.listMethods();
            expect(list.length).toBe(7);
            for (const m of list) {
                expect(m.key).toBeDefined();
                expect(m.name).toBeDefined();
                expect(m.category).toBeDefined();
            }
        });

        test('pathogen entries include type', () => {
            const list = analyzer.listPathogens();
            const ecoli = list.find(p => p.name === 'E. coli');
            expect(ecoli.type).toBe('vegetative');
        });
    });

    // ── Configuration ───────────────────────────────────────────

    describe('custom configuration', () => {
        test('custom SAL target changes requirements', () => {
            const strict = createSterilizationAnalyzer({ defaultSAL: 1e-9 });
            const normal = createSterilizationAnalyzer({ defaultSAL: 1e-6 });

            const strictCycle = strict.optimizeCycle('autoclave121');
            const normalCycle = normal.optimizeCycle('autoclave121');
            expect(strictCycle.minimumDuration).toBeGreaterThan(normalCycle.minimumDuration);
        });

        test('custom bioburden changes requirements', () => {
            const high = createSterilizationAnalyzer({ defaultBioburden: 100000 });
            const low = createSterilizationAnalyzer({ defaultBioburden: 100 });

            const highCycle = high.optimizeCycle('autoclave121');
            const lowCycle = low.optimizeCycle('autoclave121');
            expect(highCycle.minimumDuration).toBeGreaterThan(lowCycle.minimumDuration);
        });

        test('custom material threshold affects compatibility', () => {
            const strict = createSterilizationAnalyzer({ materialThreshold: 0.9 });
            const result = strict.assessMaterialCompat('Alginate', 'ethanol');
            // Alginate ethanol retention = 0.85, below 0.9 threshold
            expect(result.compatible).toBe(false);
        });
    });

    // ── Edge cases ──────────────────────────────────────────────

    describe('edge cases', () => {
        test('very long autoclave cycle achieves extreme log reduction', () => {
            const result = analyzer.calculateKillKinetics('autoclave121', 60, 'B. stearothermophilus');
            expect(result.logReduction).toBe(40);
            expect(result.sterile).toBe(true);
        });

        test('multiple validation records from same run', () => {
            for (let i = 0; i < 5; i++) {
                analyzer.recordValidation({
                    method: 'autoclave121',
                    date: '2026-03-04',
                    biResult: 'pass',
                    operator: 'TestOp'
                });
            }
            const history = analyzer.getValidationHistory();
            expect(history.total).toBe(5);
            expect(history.passRate).toBe(1);
        });

        test('single-step protocol for simple case', () => {
            const result = analyzer.planMultiStepProtocol([
                { name: 'Tool', materials: ['Stainless Steel'] }
            ]);
            expect(result.steps).toHaveLength(1);
            expect(result.allFeasible).toBe(true);
        });

        test('compare methods with no material filter', () => {
            const result = analyzer.compareMethods('S. aureus');
            expect(result.methods.every(m => m.materialCompatibility === undefined)).toBe(true);
        });

        test('kill curve for gamma uses dose steps', () => {
            const result = analyzer.generateKillCurve('gamma', 50, 10, 'E. coli');
            expect(result.durationUnit).toBe('kGy');
            expect(result.points[10].duration).toBe(50);
        });
    });
});
