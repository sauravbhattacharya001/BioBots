/**
 * @jest-environment node
 */

const { createExperimentReplicator } = require('../docs/shared/experimentReplicator');

describe('experimentReplicator', () => {

    let rep;
    beforeEach(() => {
        rep = createExperimentReplicator();
    });

    // ── recordExperiment ─────────────────────────────────

    describe('recordExperiment', () => {
        test('records an experiment and returns it with id', () => {
            const exp = rep.recordExperiment({ material: 'alginate', success: true, viability: 0.92 });
            expect(exp.id).toBeDefined();
            expect(exp.material).toBe('alginate');
            expect(exp.success).toBe(true);
            expect(exp.viability).toBe(0.92);
        });

        test('throws if material is missing', () => {
            expect(() => rep.recordExperiment({ success: true })).toThrow('material is required');
        });

        test('throws if success is missing', () => {
            expect(() => rep.recordExperiment({ material: 'alginate' })).toThrow('success (boolean) is required');
        });

        test('assigns unique ids', () => {
            const e1 = rep.recordExperiment({ material: 'alginate', success: true });
            const e2 = rep.recordExperiment({ material: 'gelatin', success: false });
            expect(e1.id).not.toBe(e2.id);
        });

        test('stores numeric parameters when provided', () => {
            const exp = rep.recordExperiment({
                material: 'collagen', success: true, temperature: 20,
                cellDensity: 2e6, speed: 8, pressure: 15, layerHeight: 0.2, nozzleDiameter: 0.3
            });
            expect(exp.temperature).toBe(20);
            expect(exp.cellDensity).toBe(2e6);
            expect(exp.speed).toBe(8);
            expect(exp.pressure).toBe(15);
            expect(exp.layerHeight).toBe(0.2);
            expect(exp.nozzleDiameter).toBe(0.3);
        });

        test('null for unspecified numeric parameters', () => {
            const exp = rep.recordExperiment({ material: 'fibrin', success: true });
            expect(exp.temperature).toBeNull();
            expect(exp.cellDensity).toBeNull();
        });
    });

    // ── getExperiments / getStats ────────────────────────

    describe('getExperiments and getStats', () => {
        test('getExperiments returns copies', () => {
            rep.recordExperiment({ material: 'alginate', success: true, viability: 0.9 });
            const exps = rep.getExperiments();
            expect(exps.length).toBe(1);
            exps.push({ fake: true });
            expect(rep.getExperiments().length).toBe(1); // original unaffected
        });

        test('getStats computes success rate and material count', () => {
            rep.recordExperiment({ material: 'alginate', success: true, viability: 0.9 });
            rep.recordExperiment({ material: 'alginate', success: false, viability: 0.3 });
            rep.recordExperiment({ material: 'gelatin', success: true, viability: 0.85 });
            const stats = rep.getStats();
            expect(stats.total).toBe(3);
            expect(stats.materials).toBe(2);
            expect(stats.successRate).toBeCloseTo(0.667, 2);
            expect(stats.avgViability).toBeCloseTo(0.683, 2);
        });

        test('getStats returns zero for empty collection', () => {
            const stats = rep.getStats();
            expect(stats.total).toBe(0);
            expect(stats.successRate).toBe(0);
        });
    });

    // ── calculatePower ───────────────────────────────────

    describe('calculatePower', () => {
        test('returns power for given sample size', () => {
            const result = rep.calculatePower({ sampleSize: 30, effectSize: 'medium' });
            expect(result.power).toBeGreaterThan(0);
            expect(result.power).toBeLessThanOrEqual(1);
            expect(result.requiredSampleSize).toBeGreaterThan(0);
            expect(result.effectSize).toBe(0.5);
            expect(result.effectSizeLabel).toBe('medium');
        });

        test('small effect needs larger sample', () => {
            const small = rep.calculatePower({ effectSize: 'small' });
            const large = rep.calculatePower({ effectSize: 'large' });
            expect(small.requiredSampleSize).toBeGreaterThan(large.requiredSampleSize);
        });

        test('accepts numeric effect size', () => {
            const result = rep.calculatePower({ effectSize: 0.3, sampleSize: 50 });
            expect(result.effectSize).toBe(0.3);
            expect(result.power).toBeGreaterThan(0);
        });

        test('power curve is generated', () => {
            const result = rep.calculatePower({ effectSize: 'medium' });
            expect(result.curve.length).toBeGreaterThan(0);
            // Power should increase with sample size
            const first = result.curve[0];
            const last = result.curve[result.curve.length - 1];
            expect(last.power).toBeGreaterThanOrEqual(first.power);
        });

        test('defaults to medium effect and 0.05 significance', () => {
            const result = rep.calculatePower({});
            expect(result.effectSize).toBe(0.5);
            expect(result.significance).toBe(0.05);
            expect(result.targetPower).toBe(0.8);
        });
    });

    // ── planReplication ──────────────────────────────────

    describe('planReplication', () => {
        test('generates plan for recorded experiment', () => {
            const exp = rep.recordExperiment({
                material: 'alginate', success: true, viability: 0.9,
                temperature: 30, cellDensity: 1e6, speed: 10, pressure: 25
            });
            const plan = rep.planReplication(exp.id);
            expect(plan.experimentId).toBe(exp.id);
            expect(plan.baseline.material).toBe('alginate');
            expect(plan.totalExperimentsNeeded).toBeGreaterThan(0);
            expect(plan.exactReplications).toBeGreaterThan(0);
            expect(plan.oatVariations.length).toBeGreaterThan(0);
            expect(plan.recommendations.length).toBeGreaterThan(0);
        });

        test('throws for non-existent experiment', () => {
            expect(() => rep.planReplication(9999)).toThrow('Experiment 9999 not found');
        });

        test('OAT variations respect parameter count', () => {
            const exp = rep.recordExperiment({
                material: 'gelatin', success: true,
                temperature: 30, speed: 10
            });
            const plan = rep.planReplication(exp.id, { variations: 5 });
            // Should have OAT for temperature and speed
            expect(plan.oatVariations.length).toBe(2);
            plan.oatVariations.forEach(oat => {
                expect(oat.variations.length).toBeLessThanOrEqual(5);
                expect(oat.variations.length).toBeGreaterThan(0);
            });
        });

        test('factorial pairs generated for multi-param experiments', () => {
            const exp = rep.recordExperiment({
                material: 'collagen', success: true,
                temperature: 15, cellDensity: 3e6, speed: 8, pressure: 20
            });
            const plan = rep.planReplication(exp.id);
            expect(plan.factorialPairs.length).toBeGreaterThan(0);
            plan.factorialPairs.forEach(fp => {
                expect(fp.params.length).toBe(2);
                expect(fp.combinations.length).toBe(4);
            });
        });
    });

    // ── prioritize ───────────────────────────────────────

    describe('prioritize', () => {
        test('returns empty for no experiments', () => {
            expect(rep.prioritize()).toEqual([]);
        });

        test('single-run experiments get high urgency', () => {
            rep.recordExperiment({ material: 'alginate', success: true, temperature: 30, speed: 10 });
            const ranked = rep.prioritize();
            expect(ranked.length).toBe(1);
            expect(ranked[0].urgencyScore).toBeGreaterThanOrEqual(40);
            expect(ranked[0].reasons).toContain('single run (no replicates)');
        });

        test('conflicting results increase urgency', () => {
            rep.recordExperiment({ material: 'fibrin', success: true, temperature: 25, speed: 10, viability: 0.9 });
            rep.recordExperiment({ material: 'fibrin', success: false, temperature: 25, speed: 10, viability: 0.2 });
            rep.recordExperiment({ material: 'fibrin', success: true, temperature: 30, speed: 12, viability: 0.85 });
            const ranked = rep.prioritize();
            const hasConflict = ranked.some(r => r.reasons.some(reason => reason.includes('conflicting')));
            expect(hasConflict).toBe(true);
        });

        test('sorted by urgency descending', () => {
            rep.recordExperiment({ material: 'alginate', success: true, temperature: 30, speed: 10 });
            rep.recordExperiment({ material: 'alginate', success: true, temperature: 30, speed: 10 });
            rep.recordExperiment({ material: 'gelatin', success: true, temperature: 28, speed: 8 });
            const ranked = rep.prioritize();
            for (let i = 1; i < ranked.length; i++) {
                expect(ranked[i - 1].urgencyScore).toBeGreaterThanOrEqual(ranked[i].urgencyScore);
            }
        });
    });

    // ── generateSchedule ─────────────────────────────────

    describe('generateSchedule', () => {
        test('returns empty for no experiments', () => {
            expect(rep.generateSchedule()).toEqual([]);
        });

        test('respects maxExperiments', () => {
            for (let i = 0; i < 20; i++) {
                rep.recordExperiment({ material: 'alginate', success: i % 2 === 0, temperature: 20 + i, speed: 5 + i });
            }
            const schedule = rep.generateSchedule({ maxExperiments: 5 });
            expect(schedule.length).toBeLessThanOrEqual(5);
            // Order field should be sequential
            schedule.forEach((entry, idx) => {
                expect(entry.order).toBe(idx + 1);
            });
        });

        test('schedule entries have required fields', () => {
            rep.recordExperiment({ material: 'alginate', success: true, temperature: 30, speed: 10 });
            const schedule = rep.generateSchedule();
            expect(schedule.length).toBeGreaterThan(0);
            const entry = schedule[0];
            expect(entry).toHaveProperty('experimentId');
            expect(entry).toHaveProperty('material');
            expect(entry).toHaveProperty('urgencyScore');
            expect(entry).toHaveProperty('informationGain');
            expect(entry).toHaveProperty('suggestedReplications');
        });
    });

    // ── getInsights ──────────────────────────────────────

    describe('getInsights', () => {
        test('returns summary for empty collection', () => {
            const insights = rep.getInsights();
            expect(insights.insights).toEqual([]);
            expect(insights.summary).toContain('No experiments');
        });

        test('detects under-replicated materials', () => {
            rep.recordExperiment({ material: 'alginate', success: true, viability: 0.9 });
            const insights = rep.getInsights();
            const underRep = insights.insights.find(i => i.type === 'under-replicated');
            expect(underRep).toBeDefined();
            expect(underRep.severity).toBe('high');
        });

        test('detects untested materials', () => {
            rep.recordExperiment({ material: 'alginate', success: true });
            const insights = rep.getInsights();
            const gaps = insights.insights.filter(i => i.type === 'gap');
            expect(gaps.length).toBeGreaterThan(0);
            expect(gaps.some(g => g.text.includes('gelatin'))).toBe(true);
        });

        test('detects parameter sensitivity', () => {
            // Success at low temp, failure at high temp — need variance in each group
            const succTemps = [24, 25, 26, 24, 25];
            const failTemps = [36, 37, 38, 36, 37];
            for (let i = 0; i < 5; i++) {
                rep.recordExperiment({ material: 'alginate', success: true, temperature: succTemps[i] });
                rep.recordExperiment({ material: 'alginate', success: false, temperature: failTemps[i] });
            }
            const insights = rep.getInsights();
            const sensitivity = insights.insights.find(i => i.type === 'sensitivity');
            expect(sensitivity).toBeDefined();
            expect(sensitivity.text).toContain('temperature');
        });

        test('reports overall success rate', () => {
            rep.recordExperiment({ material: 'alginate', success: true });
            rep.recordExperiment({ material: 'alginate', success: false });
            const insights = rep.getInsights();
            expect(insights.overallSuccessRate).toBe(0.5);
        });
    });

    // ── exportPlan ───────────────────────────────────────

    describe('exportPlan', () => {
        let expId;
        beforeEach(() => {
            const exp = rep.recordExperiment({
                material: 'alginate', success: true, viability: 0.88,
                temperature: 30, cellDensity: 1e6, speed: 10, pressure: 25
            });
            expId = exp.id;
        });

        test('exports as JSON by default', () => {
            const json = rep.exportPlan(expId);
            const parsed = JSON.parse(json);
            expect(parsed.experimentId).toBe(expId);
        });

        test('exports as markdown', () => {
            const md = rep.exportPlan(expId, 'markdown');
            expect(md).toContain('# Replication Plan');
            expect(md).toContain('alginate');
            expect(md).toContain('## Power Analysis');
            expect(md).toContain('## Recommendations');
        });

        test('exports as CSV', () => {
            const csv = rep.exportPlan(expId, 'csv');
            expect(csv).toContain('parameter,baseline,variation,value');
            const lines = csv.trim().split('\n');
            expect(lines.length).toBeGreaterThan(1);
        });
    });
});
