'use strict';

var experimentPlanner = require('../docs/shared/experimentPlanner');

describe('ExperimentPlanner', function () {
    var ep;

    beforeEach(function () {
        ep = experimentPlanner.createExperimentPlanner();
    });

    // ── Goal Parsing ───────────────────────────────────────────────

    describe('goal parsing', function () {
        test('classifies optimization goals', function () {
            var plan = ep.plan('optimize bioink viscosity for cartilage printing');
            expect(plan.goalAnalysis.type).toBe('optimization');
            expect(plan.goalAnalysis.targetParameters).toContain('viscosity');
        });

        test('classifies comparison goals', function () {
            var plan = ep.plan('compare alginate versus gelatin for cell viability');
            expect(plan.goalAnalysis.type).toBe('comparison');
        });

        test('classifies screening goals', function () {
            var plan = ep.plan('screen which factors affect printability the most');
            expect(plan.goalAnalysis.type).toBe('screening');
        });

        test('classifies validation goals', function () {
            var plan = ep.plan('validate that the new protocol reproduces previous results');
            expect(plan.goalAnalysis.type).toBe('validation');
        });

        test('classifies dose-response goals', function () {
            var plan = ep.plan('determine dose response of concentration on cell viability');
            expect(plan.goalAnalysis.type).toBe('dose-response');
        });

        test('extracts material from goal', function () {
            var plan = ep.plan('optimize gelatin concentration for printing');
            expect(plan.goalAnalysis.materials).toContain('gelatin');
        });

        test('extracts cell types from goal', function () {
            var plan = ep.plan('maximize chondrocytes viability in bioink');
            expect(plan.goalAnalysis.cellTypes).toContain('chondrocytes');
        });

        test('defaults to alginate when no material detected', function () {
            var plan = ep.plan('optimize printing speed');
            expect(plan.goalAnalysis.materials).toContain('alginate');
        });

        test('detects minimize direction', function () {
            var plan = ep.plan('minimize cell death during printing');
            expect(plan.goalAnalysis.direction).toBe('minimize');
        });
    });

    // ── Parameter Space ────────────────────────────────────────────

    describe('parameter space', function () {
        test('generates factors for viscosity target', function () {
            var plan = ep.plan('optimize viscosity');
            expect(plan.parameterSpace.factors.length).toBeGreaterThan(0);
            var names = plan.parameterSpace.factors.map(function(f) { return f.name; });
            expect(names).toContain('concentration');
        });

        test('generates temperature factor when targeted', function () {
            var plan = ep.plan('optimize temperature for gelatin printing');
            var names = plan.parameterSpace.factors.map(function(f) { return f.name; });
            expect(names).toContain('temperature');
        });

        test('respects custom ranges', function () {
            var plan = ep.plan('optimize concentration', { concentrationRange: [2, 6] });
            var concFactor = plan.parameterSpace.factors.find(function(f) { return f.name === 'concentration'; });
            expect(concFactor.range[0]).toBe(2);
            expect(concFactor.range[1]).toBe(6);
        });

        test('includes material info', function () {
            var plan = ep.plan('optimize alginate viscosity');
            expect(plan.parameterSpace.material).toBe('alginate');
            expect(plan.parameterSpace.materialInfo).toBeDefined();
        });
    });

    // ── Experiment Matrix ──────────────────────────────────────────

    describe('experiment matrix', function () {
        test('generates full factorial for small designs', function () {
            var plan = ep.plan('optimize concentration and temperature', { levelsPerFactor: 3 });
            expect(plan.experimentMatrix.strategy).toBeDefined();
            expect(plan.experimentMatrix.conditions.length).toBeGreaterThan(0);
            expect(plan.experimentMatrix.totalRuns).toBe(
                plan.experimentMatrix.conditionCount * plan.experimentMatrix.replicates
            );
        });

        test('assigns condition IDs', function () {
            var plan = ep.plan('optimize concentration');
            plan.experimentMatrix.conditions.forEach(function(c) {
                expect(c._conditionId).toMatch(/^C\d{3}$/);
            });
        });

        test('comparison goal produces A/B design', function () {
            var plan = ep.plan('compare low vs high concentration');
            expect(plan.experimentMatrix.strategy).toBe('ab');
            expect(plan.experimentMatrix.conditions.length).toBe(2);
        });

        test('dose-response produces multi-level single factor', function () {
            var plan = ep.plan('determine dose response of concentration');
            expect(plan.experimentMatrix.strategy).toBe('dose-response');
            expect(plan.experimentMatrix.conditions.length).toBeGreaterThanOrEqual(3);
        });

        test('CCD can be forced via strategy option', function () {
            var plan = ep.plan('optimize viscosity and temperature', { strategy: 'ccd' });
            expect(plan.experimentMatrix.strategy).toBe('ccd');
            // CCD has center + factorial + axial points
            expect(plan.experimentMatrix.conditions.length).toBeGreaterThan(4);
        });

        test('latin-hypercube can be forced', function () {
            var plan = ep.plan('screen parameters', { strategy: 'latin-hypercube', sampleSize: 10 });
            expect(plan.experimentMatrix.strategy).toBe('latin-hypercube');
            expect(plan.experimentMatrix.conditions.length).toBe(10);
        });

        test('default replicates is 3', function () {
            var plan = ep.plan('optimize viscosity');
            expect(plan.experimentMatrix.replicates).toBe(3);
        });
    });

    // ── Risk Assessment ────────────────────────────────────────────

    describe('risk assessment', function () {
        test('returns overall risk score', function () {
            var plan = ep.plan('optimize viscosity');
            expect(plan.risks.overallRiskScore).toBeDefined();
            expect(typeof plan.risks.overallRiskScore).toBe('number');
        });

        test('returns risk level', function () {
            var plan = ep.plan('optimize viscosity');
            expect(['LOW', 'MODERATE', 'HIGH']).toContain(plan.risks.overallRiskLevel);
        });

        test('flags cell viability risk for fragile cells', function () {
            var plan = ep.plan('optimize pressure for hepatocytes printing', {
                pressureRange: [30, 80]
            });
            var allRisks = [];
            plan.risks.risks.forEach(function(cr) {
                cr.risks.forEach(function(r) { allRisks.push(r.category); });
            });
            expect(allRisks).toContain('CELL_VIABILITY');
        });

        test('provides mitigations', function () {
            var plan = ep.plan('optimize pressure for hepatocytes', { pressureRange: [30, 80] });
            expect(plan.risks.mitigations.length).toBeGreaterThan(0);
            expect(plan.risks.mitigations[0].action).toBeDefined();
        });
    });

    // ── Timeline ───────────────────────────────────────────────────

    describe('timeline', function () {
        test('estimates total hours', function () {
            var plan = ep.plan('optimize viscosity');
            expect(plan.timeline.totalHours).toBeGreaterThan(0);
        });

        test('includes phases', function () {
            var plan = ep.plan('optimize viscosity');
            expect(plan.timeline.phases.length).toBeGreaterThan(0);
            expect(plan.timeline.phases[0].name).toBeDefined();
            expect(plan.timeline.phases[0].durationMin).toBeGreaterThan(0);
        });

        test('identifies critical path', function () {
            var plan = ep.plan('optimize viscosity');
            expect(plan.timeline.criticalPath).toBeDefined();
        });

        test('standalone estimateTimeline works', function () {
            var matrix = { conditionCount: 10, totalRuns: 30, replicates: 3 };
            var tl = ep.estimateTimeline(matrix);
            expect(tl.totalHours).toBeGreaterThan(0);
        });
    });

    // ── Resources ──────────────────────────────────────────────────

    describe('resources', function () {
        test('estimates materials', function () {
            var plan = ep.plan('optimize alginate viscosity');
            expect(plan.resources.materials.length).toBeGreaterThan(0);
            expect(plan.resources.materials[0].name).toContain('alginate');
        });

        test('estimates cost', function () {
            var plan = ep.plan('optimize viscosity');
            expect(plan.resources.estimatedCost.amount).toBeGreaterThan(0);
        });

        test('includes consumables', function () {
            var plan = ep.plan('optimize viscosity');
            expect(plan.resources.consumables.length).toBeGreaterThan(0);
        });

        test('includes CaCl2 for alginate', function () {
            var plan = ep.plan('optimize alginate concentration');
            var matNames = plan.resources.materials.map(function(m) { return m.name; });
            expect(matNames.some(function(n) { return n.indexOf('CaCl2') !== -1; })).toBe(true);
        });
    });

    // ── Alternatives ───────────────────────────────────────────────

    describe('alternatives', function () {
        test('provides alternative strategies', function () {
            var plan = ep.plan('optimize viscosity');
            expect(plan.alternatives.length).toBeGreaterThanOrEqual(1);
        });

        test('alternatives include pros and cons', function () {
            var plan = ep.plan('optimize viscosity');
            plan.alternatives.forEach(function(alt) {
                expect(alt.pros.length).toBeGreaterThan(0);
                expect(alt.cons.length).toBeGreaterThan(0);
            });
        });

        test('alternatives are sorted by suitability', function () {
            var plan = ep.plan('optimize viscosity');
            if (plan.alternatives.length >= 2) {
                expect(plan.alternatives[0].suitability).toBeGreaterThanOrEqual(plan.alternatives[1].suitability);
            }
        });
    });

    // ── Adaptive Replanning ────────────────────────────────────────

    describe('adaptive replanning', function () {
        test('feedResults stores results', function () {
            var plan = ep.plan('optimize concentration');
            var cond = plan.experimentMatrix.conditions[0];
            ep.feedResults(plan.planId, { condition: cond, score: 85 });
            // Should not throw
        });

        test('replan narrows parameter space', function () {
            var plan = ep.plan('optimize concentration', { levelsPerFactor: 5 });
            var conditions = plan.experimentMatrix.conditions;
            // Feed results with varying scores
            for (var i = 0; i < conditions.length; i++) {
                ep.feedResults(plan.planId, {
                    condition: conditions[i],
                    score: i < 2 ? 90 : 40 // first 2 conditions are "good"
                });
            }
            var newPlan = ep.replan(plan.planId);
            expect(newPlan.replanIteration).toBe(1);
            expect(newPlan.narrowedFrom).toBeDefined();
            expect(newPlan.narrowedTo).toBeDefined();
        });

        test('replan returns same plan when no results', function () {
            var plan = ep.plan('optimize concentration');
            var same = ep.replan(plan.planId);
            expect(same.planId).toBe(plan.planId);
        });

        test('feedResults throws for unknown plan', function () {
            expect(function () {
                ep.feedResults('nonexistent', { score: 50 });
            }).toThrow();
        });
    });

    // ── Knowledge Base ─────────────────────────────────────────────

    describe('knowledge base', function () {
        test('getSuggestedParameters returns ranges', function () {
            var sugg = ep.getSuggestedParameters('optimization', 'gelatin');
            expect(sugg.parameters.concentration.range).toEqual([3, 10]);
            expect(sugg.material).toBe('gelatin');
        });

        test('getDesignStrategy returns strategy name', function () {
            expect(ep.getDesignStrategy(2, 3, 'optimization')).toBe('factorial');
            expect(ep.getDesignStrategy(2, 3, 'comparison')).toBe('ab');
        });

        test('defaults to alginate for unknown material', function () {
            var sugg = ep.getSuggestedParameters('optimization', 'unobtanium');
            expect(sugg.parameters.concentration.range).toEqual([1, 4]); // alginate default
        });
    });

    // ── Protocol Export ────────────────────────────────────────────

    describe('protocol export', function () {
        test('generates readable protocol text', function () {
            var plan = ep.plan('optimize alginate viscosity for cartilage');
            var text = ep.toProtocol(plan);
            expect(text).toContain('EXPERIMENT PROTOCOL');
            expect(text).toContain('OBJECTIVE:');
            expect(text).toContain('alginate');
            expect(text).toContain('CONDITION TABLE');
            expect(text).toContain('TIMELINE');
            expect(text).toContain('RISK ASSESSMENT');
        });
    });

    // ── JSON Export ────────────────────────────────────────────────

    describe('JSON export', function () {
        test('produces serializable output', function () {
            var plan = ep.plan('optimize viscosity');
            var json = ep.toJSON(plan);
            expect(json.planId).toBe(plan.planId);
            var str = JSON.stringify(json);
            expect(str.length).toBeGreaterThan(100);
        });
    });

    // ── Summary ────────────────────────────────────────────────────

    describe('summary', function () {
        test('plan includes human-readable summary', function () {
            var plan = ep.plan('optimize viscosity for printing');
            expect(plan.summary).toContain('design with');
            expect(plan.summary).toContain('conditions');
            expect(plan.summary).toContain('hours');
        });
    });

    // ── Edge Cases ─────────────────────────────────────────────────

    describe('edge cases', function () {
        test('handles empty goal gracefully', function () {
            var plan = ep.plan('');
            expect(plan.goalAnalysis.type).toBe('optimization');
            expect(plan.experimentMatrix.conditions.length).toBeGreaterThan(0);
        });

        test('handles single parameter', function () {
            var plan = ep.plan('optimize concentration only');
            expect(plan.parameterSpace.factors.length).toBeGreaterThanOrEqual(1);
        });

        test('handles unknown material gracefully', function () {
            var plan = ep.plan('optimize unobtanium viscosity');
            // Falls back to alginate
            expect(plan.parameterSpace.materialInfo).toBeDefined();
        });
    });
});
