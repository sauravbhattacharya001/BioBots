'use strict';

const { createRiskAssessor } = require('../Try/scripts/riskAssessor');

describe('Print Risk Assessor', () => {

    let assessor;

    beforeEach(() => {
        assessor = createRiskAssessor();
    });

    // ── Factory ────────────────────────────────────────────────

    describe('createRiskAssessor', () => {
        test('creates assessor with default thresholds', () => {
            expect(assessor).toBeDefined();
            expect(typeof assessor.assess).toBe('function');
            expect(typeof assessor.batchAssess).toBe('function');
            expect(typeof assessor.compareConfigurations).toBe('function');
            expect(typeof assessor.suggestImprovements).toBe('function');
            expect(typeof assessor.analyzeHistorical).toBe('function');
            expect(typeof assessor.textReport).toBe('function');
            expect(typeof assessor.assessDimension).toBe('function');
        });

        test('accepts custom thresholds', () => {
            const custom = createRiskAssessor({
                pressure: { safePressure: 30, riskyPressure: 50, criticalPressure: 80 }
            });
            const result = custom.assess({ pressure: 60 });
            const pressureDim = result.dimensions.find(d => d.dimension === 'Pressure Damage');
            expect(pressureDim.score).toBeGreaterThan(50);
        });
    });

    // ── assess() ────────────────────────────────────────────────

    describe('assess', () => {
        test('throws on non-object input', () => {
            expect(() => assessor.assess(null)).toThrow('assess requires a parameters object');
            expect(() => assessor.assess()).toThrow();
        });

        test('returns all 8 risk dimensions', () => {
            const result = assessor.assess({ pressure: 50 });
            expect(result.dimensions).toHaveLength(8);
            const names = result.dimensions.map(d => d.dimension);
            expect(names).toContain('Nozzle Clogging');
            expect(names).toContain('Cell Viability');
            expect(names).toContain('Structural Collapse');
            expect(names).toContain('Layer Adhesion');
            expect(names).toContain('Over-Crosslinking');
            expect(names).toContain('Dehydration');
            expect(names).toContain('Contamination');
            expect(names).toContain('Pressure Damage');
        });

        test('returns overall score, level, and recommendation', () => {
            const result = assessor.assess({ pressure: 50, temperature: 37 });
            expect(typeof result.overallScore).toBe('number');
            expect(result.overallScore).toBeGreaterThanOrEqual(0);
            expect(result.overallScore).toBeLessThanOrEqual(100);
            expect(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']).toContain(result.overallLevel);
            expect(['GO', 'CAUTION', 'NO-GO']).toContain(result.recommendation);
        });

        test('preserves input params in result', () => {
            const params = { pressure: 80, temperature: 37 };
            const result = assessor.assess(params);
            expect(result.params.pressure).toBe(80);
            expect(result.params.temperature).toBe(37);
        });

        test('safe parameters get GO recommendation', () => {
            const result = assessor.assess({
                pressure: 30, temperature: 37, layerHeight: 0.15,
                layerCount: 3, crosslinkEnabled: true,
                crosslinkIntensity: 20, crosslinkDuration: 10000,
                printSpeed: 5, printTimeMinutes: 10,
                humidity: 85, sterileEnvironment: true, nozzleGauge: 22,
            });
            expect(result.recommendation).toBe('GO');
            expect(result.overallScore).toBeLessThan(30);
        });

        test('dangerous parameters get NO-GO recommendation', () => {
            const result = assessor.assess({
                pressure: 180, temperature: 45, layerHeight: 1.5,
                layerCount: 50, crosslinkEnabled: true,
                crosslinkIntensity: 98, crosslinkDuration: 150000,
                printSpeed: 40, printTimeMinutes: 150,
                humidity: 30, sterileEnvironment: false,
                ambientExposureMinutes: 120, nozzleGauge: 32,
            });
            expect(result.recommendation).toBe('NO-GO');
            expect(result.overallScore).toBeGreaterThan(60);
        });

        test('mitigations are deduplicated', () => {
            const result = assessor.assess({ pressure: 150, temperature: 20 });
            const suggestions = result.mitigations.map(m => m.suggestion);
            const unique = new Set(suggestions);
            expect(suggestions.length).toBe(unique.size);
        });

        test('mitigations sorted by risk dimension score (worst first)', () => {
            const result = assessor.assess({ pressure: 150, printTimeMinutes: 100 });
            if (result.mitigations.length >= 2) {
                const dimScores = {};
                result.dimensions.forEach(d => dimScores[d.dimension] = d.score);
                for (let i = 1; i < result.mitigations.length; i++) {
                    const prevScore = dimScores[result.mitigations[i - 1].dimension] || 0;
                    const currScore = dimScores[result.mitigations[i].dimension] || 0;
                    expect(prevScore).toBeGreaterThanOrEqual(currScore);
                }
            }
        });

        test('criticalCount and highCount are accurate', () => {
            const result = assessor.assess({ pressure: 180 });
            const critical = result.dimensions.filter(d => d.level === 'CRITICAL').length;
            const high = result.dimensions.filter(d => d.level === 'HIGH').length;
            expect(result.criticalCount).toBe(critical);
            expect(result.highCount).toBe(high);
        });
    });

    // ── Individual Dimensions ───────────────────────────────────

    describe('Nozzle Clogging', () => {
        test('low risk with wide nozzle and low pressure', () => {
            const r = assessor.assessDimension('nozzle', { pressure: 30, nozzleGauge: 22 });
            expect(r.score).toBeLessThan(20);
            expect(r.level).toBe('LOW');
        });

        test('high risk with narrow nozzle and high pressure', () => {
            const r = assessor.assessDimension('nozzle', { pressure: 150, nozzleGauge: 32 });
            expect(r.score).toBeGreaterThan(50);
        });

        test('compound risk when both pressure and gauge are bad', () => {
            const rPressOnly = assessor.assessDimension('nozzle', { pressure: 130, nozzleGauge: 22 });
            const rBoth = assessor.assessDimension('nozzle', { pressure: 130, nozzleGauge: 31 });
            expect(rBoth.score).toBeGreaterThan(rPressOnly.score);
        });

        test('provides mitigations when risk is elevated', () => {
            const r = assessor.assessDimension('nozzle', { pressure: 150, nozzleGauge: 32 });
            expect(r.mitigations.length).toBeGreaterThan(0);
        });
    });

    describe('Cell Viability', () => {
        test('low risk at optimal temperature and low pressure', () => {
            const r = assessor.assessDimension('viability', { temperature: 37, pressure: 30 });
            expect(r.score).toBeLessThan(20);
        });

        test('high risk at extreme temperature', () => {
            const rCold = assessor.assessDimension('viability', { temperature: 15, pressure: 30 });
            expect(rCold.score).toBeGreaterThan(30);

            const rHot = assessor.assessDimension('viability', { temperature: 45, pressure: 30 });
            expect(rHot.score).toBeGreaterThan(30);
        });

        test('estimates shear stress from pressure and gauge', () => {
            const r = assessor.assessDimension('viability', { pressure: 100, nozzleGauge: 32 });
            expect(r.factors.estimatedShear).toBeGreaterThan(0);
        });

        test('narrow gauge increases shear risk', () => {
            const rWide = assessor.assessDimension('viability', { pressure: 60, nozzleGauge: 22 });
            const rNarrow = assessor.assessDimension('viability', { pressure: 60, nozzleGauge: 32 });
            expect(rNarrow.factors.shearRisk).toBeGreaterThanOrEqual(rWide.factors.shearRisk);
        });
    });

    describe('Structural Collapse', () => {
        test('low risk with crosslinking and few layers', () => {
            const r = assessor.assessDimension('structure', {
                crosslinkEnabled: true, crosslinkIntensity: 30,
                crosslinkDuration: 15000, layerHeight: 0.15, layerCount: 3,
            });
            expect(r.score).toBeLessThan(25);
        });

        test('high risk without crosslinking on many layers', () => {
            const r = assessor.assessDimension('structure', {
                crosslinkEnabled: false, layerCount: 20, layerHeight: 0.5,
            });
            expect(r.score).toBeGreaterThan(40);
        });

        test('high layer height increases risk', () => {
            const rThin = assessor.assessDimension('structure', {
                crosslinkEnabled: true, crosslinkIntensity: 30,
                crosslinkDuration: 15000, layerHeight: 0.15, layerCount: 40,
            });
            const rThick = assessor.assessDimension('structure', {
                crosslinkEnabled: true, crosslinkIntensity: 30,
                crosslinkDuration: 15000, layerHeight: 0.7, layerCount: 40,
            });
            expect(rThick.score).toBeGreaterThan(rThin.score);
        });
    });

    describe('Layer Adhesion', () => {
        test('low risk with thin layers and slow speed', () => {
            const r = assessor.assessDimension('adhesion', { layerHeight: 0.2, printSpeed: 5 });
            expect(r.score).toBeLessThan(15);
        });

        test('high risk with thick layers and fast speed', () => {
            const r = assessor.assessDimension('adhesion', { layerHeight: 1.0, printSpeed: 30 });
            expect(r.score).toBeGreaterThan(50);
        });
    });

    describe('Over-Crosslinking', () => {
        test('zero risk when crosslinking disabled', () => {
            const r = assessor.assessDimension('crosslink', { crosslinkEnabled: false });
            expect(r.score).toBe(0);
            expect(r.level).toBe('LOW');
        });

        test('zero risk with no intensity or duration', () => {
            const r = assessor.assessDimension('crosslink', {
                crosslinkEnabled: true, crosslinkIntensity: 0, crosslinkDuration: 0,
            });
            expect(r.score).toBe(0);
        });

        test('high risk with excessive crosslinking', () => {
            const r = assessor.assessDimension('crosslink', {
                crosslinkEnabled: true, crosslinkIntensity: 90, crosslinkDuration: 100000,
            });
            expect(r.score).toBeGreaterThan(60);
        });

        test('compounding when both intensity and duration are high', () => {
            const rIntOnly = assessor.assessDimension('crosslink', {
                crosslinkEnabled: true, crosslinkIntensity: 70, crosslinkDuration: 5000,
            });
            const rBoth = assessor.assessDimension('crosslink', {
                crosslinkEnabled: true, crosslinkIntensity: 70, crosslinkDuration: 70000,
            });
            expect(rBoth.score).toBeGreaterThan(rIntOnly.score);
        });
    });

    describe('Dehydration', () => {
        test('low risk with short print time and good humidity', () => {
            const r = assessor.assessDimension('dehydration', { printTimeMinutes: 10, humidity: 80 });
            expect(r.score).toBeLessThan(10);
        });

        test('high risk with long print time', () => {
            const r = assessor.assessDimension('dehydration', { printTimeMinutes: 100, humidity: 80 });
            expect(r.score).toBeGreaterThan(40);
        });

        test('low humidity increases risk', () => {
            const rDry = assessor.assessDimension('dehydration', { printTimeMinutes: 50, humidity: 40 });
            const rWet = assessor.assessDimension('dehydration', { printTimeMinutes: 50, humidity: 80 });
            expect(rDry.score).toBeGreaterThan(rWet.score);
        });
    });

    describe('Contamination', () => {
        test('sterile environment greatly reduces risk', () => {
            const rSterile = assessor.assessDimension('contamination', {
                ambientExposureMinutes: 60, sterileEnvironment: true,
            });
            const rNonSterile = assessor.assessDimension('contamination', {
                ambientExposureMinutes: 60, sterileEnvironment: false,
            });
            expect(rSterile.score).toBeLessThan(rNonSterile.score);
        });

        test('long ambient exposure increases risk', () => {
            const rShort = assessor.assessDimension('contamination', { ambientExposureMinutes: 5 });
            const rLong = assessor.assessDimension('contamination', { ambientExposureMinutes: 100 });
            expect(rLong.score).toBeGreaterThan(rShort.score);
        });
    });

    describe('Pressure Damage', () => {
        test('low risk at safe pressure', () => {
            const r = assessor.assessDimension('pressure', { pressure: 30 });
            expect(r.score).toBeLessThan(10);
            expect(r.level).toBe('LOW');
        });

        test('high risk at extreme pressure', () => {
            const r = assessor.assessDimension('pressure', { pressure: 160 });
            expect(r.score).toBeGreaterThan(80);
        });

        test('mitigations provided at elevated pressure', () => {
            const r = assessor.assessDimension('pressure', { pressure: 120 });
            expect(r.mitigations.length).toBeGreaterThan(0);
        });
    });

    // ── assessDimension ─────────────────────────────────────────

    describe('assessDimension', () => {
        test('throws on unknown dimension', () => {
            expect(() => assessor.assessDimension('unknown', {})).toThrow('Unknown dimension');
        });

        test('each dimension name returns correct result', () => {
            const dims = ['nozzle', 'viability', 'structure', 'adhesion',
                'crosslink', 'dehydration', 'contamination', 'pressure'];
            dims.forEach(name => {
                const r = assessor.assessDimension(name, { pressure: 50 });
                expect(typeof r.score).toBe('number');
                expect(typeof r.level).toBe('string');
                expect(Array.isArray(r.mitigations)).toBe(true);
            });
        });
    });

    // ── batchAssess ─────────────────────────────────────────────

    describe('batchAssess', () => {
        test('throws on non-array input', () => {
            expect(() => assessor.batchAssess({})).toThrow('batchAssess requires an array');
        });

        test('returns results for each parameter set', () => {
            const results = assessor.batchAssess([
                { pressure: 40, temperature: 37 },
                { pressure: 160, temperature: 45 },
            ]);
            expect(results).toHaveLength(2);
            expect(results[0].overallScore).toBeLessThan(results[1].overallScore);
        });

        test('empty array returns empty results', () => {
            const results = assessor.batchAssess([]);
            expect(results).toHaveLength(0);
        });
    });

    // ── compareConfigurations ───────────────────────────────────

    describe('compareConfigurations', () => {
        test('identifies which configuration is better', () => {
            const safe = { pressure: 40, temperature: 37 };
            const risky = { pressure: 160, temperature: 45 };
            const comp = assessor.compareConfigurations(safe, risky);

            expect(comp.configA.overallScore).toBeLessThan(comp.configB.overallScore);
            expect(comp.overallDelta).toBeGreaterThan(0);
            expect(comp.recommendation).toBe('Config A is lower risk');
        });

        test('reports dimension-level improvements and regressions', () => {
            const a = { pressure: 40, layerHeight: 1.0 };
            const b = { pressure: 120, layerHeight: 0.2 };
            const comp = assessor.compareConfigurations(a, b);

            expect(comp.dimensionComparison).toHaveLength(8);
            const pressureDim = comp.dimensionComparison.find(d => d.dimension === 'Pressure Damage');
            expect(pressureDim.worsened).toBe(true);

            const adhesionDim = comp.dimensionComparison.find(d => d.dimension === 'Layer Adhesion');
            expect(adhesionDim.improved).toBe(true);
        });

        test('equal configs get equal-risk message', () => {
            const params = { pressure: 50 };
            const comp = assessor.compareConfigurations(params, params);
            expect(comp.overallDelta).toBe(0);
            expect(comp.recommendation).toContain('equal');
        });
    });

    // ── suggestImprovements ─────────────────────────────────────

    describe('suggestImprovements', () => {
        test('reports already met when score is below target', () => {
            const result = assessor.suggestImprovements({
                pressure: 30, temperature: 37, layerHeight: 0.2,
            }, 50);
            expect(result.alreadyMet).toBe(true);
            expect(result.suggestions).toHaveLength(0);
        });

        test('provides parameter change suggestions for risky config', () => {
            const result = assessor.suggestImprovements({
                pressure: 140, temperature: 20, layerHeight: 1.0,
                printTimeMinutes: 100,
            });
            expect(result.alreadyMet).toBe(false);
            expect(result.suggestions.length).toBeGreaterThan(0);

            const allChanges = result.suggestions.flatMap(s => s.parameterChanges);
            expect(allChanges.length).toBeGreaterThan(0);
            const params = allChanges.map(c => c.parameter);
            expect(params).toContain('pressure');
        });

        test('suggestions sorted by worst dimension first', () => {
            const result = assessor.suggestImprovements({
                pressure: 160, printTimeMinutes: 100, temperature: 15,
            });
            if (result.suggestions.length >= 2) {
                for (let i = 1; i < result.suggestions.length; i++) {
                    expect(result.suggestions[i - 1].currentScore)
                        .toBeGreaterThanOrEqual(result.suggestions[i].currentScore);
                }
            }
        });

        test('default target score is 30', () => {
            const result = assessor.suggestImprovements({ pressure: 30 });
            expect(result.targetScore).toBe(30);
        });
    });

    // ── analyzeHistorical ───────────────────────────────────────

    describe('analyzeHistorical', () => {
        test('returns empty analysis for empty data', () => {
            const result = assessor.analyzeHistorical([]);
            expect(result.sampleSize).toBe(0);
        });

        test('separates successes and failures', () => {
            const data = [
                { params: { pressure: 40, temperature: 37 }, outcome: 'success' },
                { params: { pressure: 40, temperature: 37 }, outcome: 'success' },
                { params: { pressure: 160, temperature: 45 }, outcome: 'failure' },
            ];
            const result = assessor.analyzeHistorical(data);
            expect(result.sampleSize).toBe(3);
            expect(result.successCount).toBe(2);
            expect(result.failureCount).toBe(1);
        });

        test('failures should have higher avg risk score', () => {
            const data = [
                { params: { pressure: 30, temperature: 37 }, outcome: 'success' },
                { params: { pressure: 170, temperature: 45 }, outcome: 'failure' },
            ];
            const result = assessor.analyzeHistorical(data);
            expect(result.avgScoreFailure).toBeGreaterThan(result.avgScoreSuccess);
        });

        test('identifies most predictive dimension', () => {
            const data = [
                { params: { pressure: 30 }, outcome: 'success' },
                { params: { pressure: 30 }, outcome: 'success' },
                { params: { pressure: 180 }, outcome: 'failure' },
                { params: { pressure: 180 }, outcome: 'failure' },
            ];
            const result = assessor.analyzeHistorical(data);
            expect(result.mostPredictive).toBeTruthy();
            expect(result.dimensionAnalysis[0].gap).toBeGreaterThan(0);
        });

        test('dimension analysis sorted by gap descending', () => {
            const data = [
                { params: { pressure: 30, temperature: 37 }, outcome: 'success' },
                { params: { pressure: 160, temperature: 15 }, outcome: 'failure' },
            ];
            const result = assessor.analyzeHistorical(data);
            for (let i = 1; i < result.dimensionAnalysis.length; i++) {
                expect(result.dimensionAnalysis[i - 1].gap)
                    .toBeGreaterThanOrEqual(result.dimensionAnalysis[i].gap);
            }
        });
    });

    // ── textReport ──────────────────────────────────────────────

    describe('textReport', () => {
        test('generates readable text output', () => {
            const result = assessor.assess({ pressure: 100, temperature: 35 });
            const report = assessor.textReport(result);
            expect(report).toContain('Print Risk Assessment');
            expect(report).toContain('Overall Score');
            expect(report).toContain('Recommendation');
            expect(report).toContain('Risk Dimensions');
        });

        test('includes risk bars', () => {
            const result = assessor.assess({ pressure: 100 });
            const report = assessor.textReport(result);
            expect(report).toMatch(/\[#+\.+\]/);
        });

        test('includes mitigations section when risks exist', () => {
            const result = assessor.assess({ pressure: 150 });
            const report = assessor.textReport(result);
            expect(report).toContain('Recommended Mitigations');
        });

        test('omits mitigations section for safe config', () => {
            const result = assessor.assess({
                pressure: 30, temperature: 37, layerHeight: 0.2,
                crosslinkEnabled: true, crosslinkIntensity: 20,
                crosslinkDuration: 10000, printSpeed: 5,
                printTimeMinutes: 10, humidity: 80, sterileEnvironment: true,
            });
            if (result.mitigations.length === 0) {
                const report = assessor.textReport(result);
                expect(report).not.toContain('Recommended Mitigations');
            }
        });
    });

    // ── Risk Levels ─────────────────────────────────────────────

    describe('risk levels', () => {
        test('correct level boundaries', () => {
            const low = assessor.assess({
                pressure: 15, temperature: 37, layerHeight: 0.1,
                crosslinkEnabled: true, crosslinkIntensity: 15,
                crosslinkDuration: 8000, printSpeed: 3,
                printTimeMinutes: 5, humidity: 90, sterileEnvironment: true,
                nozzleGauge: 22, layerCount: 2,
            });
            expect(low.overallLevel).toBe('LOW');

            const critical = assessor.assess({
                pressure: 200, temperature: 50, nozzleGauge: 32,
            });
            expect(['HIGH', 'CRITICAL']).toContain(critical.overallLevel);
        });
    });

    // ── Edge Cases ──────────────────────────────────────────────

    describe('edge cases', () => {
        test('empty params object uses safe defaults', () => {
            const result = assessor.assess({});
            expect(result.overallScore).toBeDefined();
            expect(typeof result.overallScore).toBe('number');
        });

        test('zero pressure is safe', () => {
            const r = assessor.assessDimension('pressure', { pressure: 0 });
            expect(r.score).toBe(0);
        });

        test('negative values treated as zero/safe', () => {
            const r = assessor.assessDimension('pressure', { pressure: -10 });
            expect(r.score).toBe(0);
        });

        test('very large values cap at 100', () => {
            const r = assessor.assessDimension('pressure', { pressure: 9999 });
            expect(r.score).toBeLessThanOrEqual(100);
        });

        test('all dimensions have required shape', () => {
            const result = assessor.assess({ pressure: 80 });
            result.dimensions.forEach(dim => {
                expect(dim).toHaveProperty('dimension');
                expect(dim).toHaveProperty('score');
                expect(dim).toHaveProperty('level');
                expect(dim).toHaveProperty('factors');
                expect(dim).toHaveProperty('mitigations');
                expect(typeof dim.dimension).toBe('string');
                expect(typeof dim.score).toBe('number');
                expect(dim.score).toBeGreaterThanOrEqual(0);
                expect(dim.score).toBeLessThanOrEqual(100);
            });
        });
    });

    // ── CAUTION recommendation ──────────────────────────────────

    describe('CAUTION recommendation', () => {
        test('single HIGH dimension gives CAUTION', () => {
            const result = assessor.assess({ pressure: 140 });
            const highCount = result.dimensions.filter(d => d.level === 'HIGH').length;
            const critCount = result.dimensions.filter(d => d.level === 'CRITICAL').length;
            if (highCount === 1 && critCount === 0) {
                expect(result.recommendation).toBe('CAUTION');
            }
        });

        test('two HIGH dimensions give NO-GO', () => {
            const result = assessor.assess({
                pressure: 140, printTimeMinutes: 110, humidity: 30,
                ambientExposureMinutes: 100, sterileEnvironment: false,
            });
            const severeCount = result.dimensions.filter(
                d => d.level === 'HIGH' || d.level === 'CRITICAL').length;
            if (severeCount >= 2) {
                expect(result.recommendation).toBe('NO-GO');
            }
        });
    });
});
