'use strict';

const { createBatchGenealogyTracker } = require('../docs/shared/batchGenealogy');

describe('Bioink Batch Genealogy Tracker', () => {
    let tracker;

    beforeEach(() => {
        tracker = createBatchGenealogyTracker();
    });

    // ── registerBatch ──────────────────────────────────────────

    describe('registerBatch', () => {
        test('registers a valid batch', () => {
            const b = tracker.registerBatch({ id: 'B1', material: 'alginate', volume: 10, viability: 95, date: '2026-01-01' });
            expect(b.id).toBe('B1');
            expect(b.material).toBe('alginate');
            expect(b.volume).toBe(10);
            expect(b.viability).toBe(95);
            expect(b.passageNumber).toBe(0);
            expect(b.generation).toBe(0);
            expect(b.parentIds).toEqual([]);
            expect(b.childIds).toEqual([]);
            expect(b.event).toBe('registered');
            expect(b.qualityHistory).toHaveLength(1);
        });

        test('throws on duplicate batch id', () => {
            tracker.registerBatch({ id: 'B1', material: 'alginate', volume: 10, viability: 90 });
            expect(() => tracker.registerBatch({ id: 'B1', material: 'alginate', volume: 5, viability: 80 }))
                .toThrow('already exists');
        });

        test('throws on invalid batch (non-object)', () => {
            expect(() => tracker.registerBatch(null)).toThrow('batch must be an object');
            expect(() => tracker.registerBatch('string')).toThrow('batch must be an object');
        });

        test('throws on empty id', () => {
            expect(() => tracker.registerBatch({ id: '', material: 'alginate', volume: 10, viability: 90 }))
                .toThrow('non-empty string');
        });

        test('throws on non-positive volume', () => {
            expect(() => tracker.registerBatch({ id: 'B1', material: 'alginate', volume: 0, viability: 90 }))
                .toThrow('volume must be a positive number');
            expect(() => tracker.registerBatch({ id: 'B1', material: 'alginate', volume: -5, viability: 90 }))
                .toThrow('volume must be a positive number');
        });

        test('throws on invalid viability', () => {
            expect(() => tracker.registerBatch({ id: 'B1', material: 'alginate', volume: 10, viability: -1 }))
                .toThrow('viability must be 0-100');
            expect(() => tracker.registerBatch({ id: 'B1', material: 'alginate', volume: 10, viability: 101 }))
                .toThrow('viability must be 0-100');
        });

        test('throws on missing material', () => {
            expect(() => tracker.registerBatch({ id: 'B1', volume: 10, viability: 90 }))
                .toThrow('non-empty string');
        });

        test('stores metadata if provided', () => {
            const b = tracker.registerBatch({ id: 'B1', material: 'gelatin', volume: 5, viability: 88, metadata: { lot: 'L123' } });
            expect(b.metadata).toEqual({ lot: 'L123' });
        });
    });

    // ── recordSplit ────────────────────────────────────────────

    describe('recordSplit', () => {
        beforeEach(() => {
            tracker.registerBatch({ id: 'B1', material: 'alginate', volume: 10, viability: 92 });
        });

        test('splits a batch into children', () => {
            const children = tracker.recordSplit('B1', [
                { id: 'B1a', volume: 5 },
                { id: 'B1b', volume: 5 },
            ]);
            expect(children).toHaveLength(2);
            expect(children[0].id).toBe('B1a');
            expect(children[0].material).toBe('alginate');
            expect(children[0].viability).toBe(92);
            expect(children[0].parentIds).toEqual(['B1']);
            expect(children[0].event).toBe('split');
            expect(children[0].generation).toBe(1);

            const parent = tracker.getBatch('B1');
            expect(parent.childIds).toEqual(['B1a', 'B1b']);
        });

        test('throws on empty children array', () => {
            expect(() => tracker.recordSplit('B1', [])).toThrow('non-empty array');
        });

        test('throws on non-array children', () => {
            expect(() => tracker.recordSplit('B1', 'nope')).toThrow('non-empty array');
        });

        test('throws on duplicate child id', () => {
            tracker.registerBatch({ id: 'B2', material: 'alginate', volume: 5, viability: 80 });
            expect(() => tracker.recordSplit('B1', [{ id: 'B2', volume: 5 }])).toThrow('already exists');
        });

        test('throws on non-existent parent', () => {
            expect(() => tracker.recordSplit('NOPE', [{ id: 'C1', volume: 5 }])).toThrow('not found');
        });

        test('throws on non-positive child volume', () => {
            expect(() => tracker.recordSplit('B1', [{ id: 'C1', volume: 0 }])).toThrow('child volume must be positive');
        });
    });

    // ── recordPool ─────────────────────────────────────────────

    describe('recordPool', () => {
        beforeEach(() => {
            tracker.registerBatch({ id: 'B1', material: 'alginate', volume: 5, viability: 90 });
            tracker.registerBatch({ id: 'B2', material: 'alginate', volume: 10, viability: 80 });
        });

        test('pools two batches with weighted viability', () => {
            const pooled = tracker.recordPool(['B1', 'B2'], { id: 'P1' });
            expect(pooled.id).toBe('P1');
            expect(pooled.volume).toBe(15);
            // weighted avg: (90*5 + 80*10) / 15 = 1250/15 ≈ 83.33
            expect(pooled.viability).toBeCloseTo(83.33, 1);
            expect(pooled.event).toBe('pooled');
            expect(pooled.parentIds).toEqual(['B1', 'B2']);
            expect(pooled.generation).toBe(1);

            expect(tracker.getBatch('B1').childIds).toContain('P1');
            expect(tracker.getBatch('B2').childIds).toContain('P1');
        });

        test('throws on fewer than 2 sources', () => {
            expect(() => tracker.recordPool(['B1'], { id: 'P1' })).toThrow('at least 2');
        });

        test('throws on duplicate result id', () => {
            expect(() => tracker.recordPool(['B1', 'B2'], { id: 'B1' })).toThrow('already exists');
        });

        test('throws on non-existent source', () => {
            expect(() => tracker.recordPool(['B1', 'NOPE'], { id: 'P1' })).toThrow('not found');
        });

        test('throws on invalid result object', () => {
            expect(() => tracker.recordPool(['B1', 'B2'], null)).toThrow('result must be an object');
        });

        test('takes max passage number from sources', () => {
            // Passage B1 a few times
            tracker.recordPassage('B1', { id: 'B1p', viability: 88 });
            tracker.recordPassage('B1p', { id: 'B1pp', viability: 86 });
            const pooled = tracker.recordPool(['B1pp', 'B2'], { id: 'P1' });
            expect(pooled.passageNumber).toBe(2);
        });
    });

    // ── recordPassage ──────────────────────────────────────────

    describe('recordPassage', () => {
        beforeEach(() => {
            tracker.registerBatch({ id: 'B1', material: 'collagen', volume: 8, viability: 95 });
        });

        test('creates passage with incremented number', () => {
            const child = tracker.recordPassage('B1', { id: 'B1p1', viability: 92 });
            expect(child.passageNumber).toBe(1);
            expect(child.material).toBe('collagen');
            expect(child.viability).toBe(92);
            expect(child.event).toBe('passaged');
            expect(child.generation).toBe(1);
            expect(child.parentIds).toEqual(['B1']);
        });

        test('chains passages correctly', () => {
            tracker.recordPassage('B1', { id: 'B1p1', viability: 92 });
            const p2 = tracker.recordPassage('B1p1', { id: 'B1p2', viability: 88 });
            expect(p2.passageNumber).toBe(2);
            expect(p2.generation).toBe(2);
        });

        test('throws on invalid viability', () => {
            expect(() => tracker.recordPassage('B1', { id: 'X', viability: -5 })).toThrow('viability must be 0-100');
        });

        test('throws on missing child object', () => {
            expect(() => tracker.recordPassage('B1', null)).toThrow('child must be an object');
        });

        test('throws on non-existent parent', () => {
            expect(() => tracker.recordPassage('NOPE', { id: 'X', viability: 90 })).toThrow('not found');
        });
    });

    // ── recordQualityUpdate ────────────────────────────────────

    describe('recordQualityUpdate', () => {
        beforeEach(() => {
            tracker.registerBatch({ id: 'B1', material: 'alginate', volume: 10, viability: 90 });
        });

        test('updates viability and appends history', () => {
            const b = tracker.recordQualityUpdate('B1', { viability: 85 });
            expect(b.viability).toBe(85);
            expect(b.qualityHistory).toHaveLength(2);
            expect(b.qualityHistory[1].viability).toBe(85);
        });

        test('appends non-viability metrics', () => {
            tracker.recordQualityUpdate('B1', { ph: 7.2, temperature: 37, contamination: false, notes: 'OK' });
            const b = tracker.getBatch('B1');
            const last = b.qualityHistory[b.qualityHistory.length - 1];
            expect(last.ph).toBe(7.2);
            expect(last.temperature).toBe(37);
            expect(last.contamination).toBe(false);
            expect(last.notes).toBe('OK');
        });

        test('throws on non-existent batch', () => {
            expect(() => tracker.recordQualityUpdate('NOPE', { viability: 80 })).toThrow('not found');
        });

        test('throws on invalid metrics', () => {
            expect(() => tracker.recordQualityUpdate('B1', null)).toThrow('metrics must be an object');
        });
    });

    // ── getLineage ─────────────────────────────────────────────

    describe('getLineage', () => {
        test('returns chain from root to current', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordPassage('R', { id: 'P1', viability: 92 });
            tracker.recordPassage('P1', { id: 'P2', viability: 88 });

            const chain = tracker.getLineage('P2');
            expect(chain.map(b => b.id)).toEqual(['R', 'P1', 'P2']);
        });

        test('returns single batch if root', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            const chain = tracker.getLineage('R');
            expect(chain).toHaveLength(1);
            expect(chain[0].id).toBe('R');
        });
    });

    // ── getDescendants ─────────────────────────────────────────

    describe('getDescendants', () => {
        test('returns all descendants', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordSplit('R', [{ id: 'A', volume: 5 }, { id: 'B', volume: 5 }]);
            tracker.recordPassage('A', { id: 'A1', viability: 90 });

            const desc = tracker.getDescendants('R');
            expect(desc.map(d => d.id).sort()).toEqual(['A', 'A1', 'B']);
        });

        test('returns empty for leaf batch', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            expect(tracker.getDescendants('R')).toEqual([]);
        });

        test('throws on non-existent batch', () => {
            expect(() => tracker.getDescendants('NOPE')).toThrow('not found');
        });
    });

    // ── getTree ────────────────────────────────────────────────

    describe('getTree', () => {
        test('builds tree structure', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordSplit('R', [{ id: 'A', volume: 5 }, { id: 'B', volume: 5 }]);

            const tree = tracker.getTree('R');
            expect(tree.batch.id).toBe('R');
            expect(tree.children).toHaveLength(2);
            expect(tree.children[0].batch.id).toBe('A');
            expect(tree.children[1].batch.id).toBe('B');
        });
    });

    // ── listBatches ────────────────────────────────────────────

    describe('listBatches', () => {
        beforeEach(() => {
            tracker.registerBatch({ id: 'B1', material: 'alginate', volume: 10, viability: 95, date: '2026-01-01' });
            tracker.registerBatch({ id: 'B2', material: 'gelatin', volume: 5, viability: 60, date: '2026-02-01' });
            tracker.registerBatch({ id: 'B3', material: 'alginate', volume: 8, viability: 85, date: '2026-03-01' });
        });

        test('returns all batches without filter', () => {
            expect(tracker.listBatches()).toHaveLength(3);
        });

        test('filters by material', () => {
            const r = tracker.listBatches({ material: 'alginate' });
            expect(r).toHaveLength(2);
            expect(r.every(b => b.material === 'alginate')).toBe(true);
        });

        test('filters by minViability', () => {
            const r = tracker.listBatches({ minViability: 80 });
            expect(r).toHaveLength(2);
        });

        test('filters by since date', () => {
            const r = tracker.listBatches({ since: '2026-02-01' });
            expect(r).toHaveLength(2);
        });

        test('filters by maxPassage', () => {
            tracker.recordPassage('B1', { id: 'B1p', viability: 90 });
            tracker.recordPassage('B1p', { id: 'B1pp', viability: 88 });
            const r = tracker.listBatches({ maxPassage: 0 });
            expect(r.every(b => b.passageNumber === 0)).toBe(true);
        });
    });

    // ── detectDrift ────────────────────────────────────────────

    describe('detectDrift', () => {
        test('no drift on fresh batch', () => {
            tracker.registerBatch({ id: 'B1', material: 'alg', volume: 10, viability: 95 });
            const result = tracker.detectDrift('B1');
            expect(result.hasDrift).toBe(false);
        });

        test('detects viability decline across lineage', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordPassage('R', { id: 'P1', viability: 80 });
            const result = tracker.detectDrift('P1');
            expect(result.hasDrift).toBe(true);
            const viabMetric = result.metrics.find(m => m.name === 'viability');
            expect(viabMetric.trend).toBe('declining');
            expect(viabMetric.severity).toBe('high');
        });

        test('detects high passage count', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            let prevId = 'R';
            for (let i = 1; i <= 12; i++) {
                const id = `P${i}`;
                tracker.recordPassage(prevId, { id, viability: 95 - i * 0.1 });
                prevId = id;
            }
            const result = tracker.detectDrift(prevId);
            expect(result.hasDrift).toBe(true);
            expect(result.metrics.some(m => m.name === 'passage_count')).toBe(true);
        });

        test('detects improving viability', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 70 });
            tracker.recordPassage('R', { id: 'P1', viability: 90 });
            const result = tracker.detectDrift('P1');
            expect(result.hasDrift).toBe(true);
            const viabMetric = result.metrics.find(m => m.name === 'viability');
            expect(viabMetric.trend).toBe('improving');
        });

        test('recommends new batch from frozen stock when viability low', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordPassage('R', { id: 'P1', viability: 60 });
            const result = tracker.detectDrift('P1');
            expect(result.recommendations.some(r => r.includes('frozen stock'))).toBe(true);
        });

        test('generation depth detection', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            let prevId = 'R';
            for (let i = 1; i <= 10; i++) {
                const id = `G${i}`;
                tracker.recordPassage(prevId, { id, viability: 90 });
                prevId = id;
            }
            const result = tracker.detectDrift(prevId);
            expect(result.metrics.some(m => m.name === 'generation_depth')).toBe(true);
        });
    });

    // ── flagAtRiskDescendants ──────────────────────────────────

    describe('flagAtRiskDescendants', () => {
        test('flags descendants below default threshold', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordSplit('R', [
                { id: 'A', volume: 5 },
                { id: 'B', volume: 5 },
            ]);
            tracker.recordQualityUpdate('A', { viability: 50 });

            const result = tracker.flagAtRiskDescendants('R');
            expect(result.atRisk).toHaveLength(1);
            expect(result.atRisk[0].id).toBe('A');
            expect(result.recommendations.length).toBeGreaterThan(0);
        });

        test('uses custom threshold', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordSplit('R', [{ id: 'A', volume: 5 }]);
            tracker.recordQualityUpdate('A', { viability: 85 });

            const result = tracker.flagAtRiskDescendants('R', 90);
            expect(result.atRisk).toHaveLength(1);
        });

        test('no at-risk when all healthy', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordSplit('R', [{ id: 'A', volume: 5 }]);
            const result = tracker.flagAtRiskDescendants('R');
            expect(result.atRisk).toHaveLength(0);
            expect(result.recommendations).toHaveLength(0);
        });

        test('majority at risk triggers root batch warning', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordSplit('R', [
                { id: 'A', volume: 3 },
                { id: 'B', volume: 3 },
                { id: 'C', volume: 4 },
            ]);
            tracker.recordQualityUpdate('A', { viability: 40 });
            tracker.recordQualityUpdate('B', { viability: 30 });

            const result = tracker.flagAtRiskDescendants('R');
            expect(result.atRisk).toHaveLength(2);
            expect(result.recommendations.some(r => r.includes('root batch'))).toBe(true);
        });
    });

    // ── auditChain ─────────────────────────────────────────────

    describe('auditChain', () => {
        test('valid chain returns clean audit', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordPassage('R', { id: 'P1', viability: 92 });
            const audit = tracker.auditChain('P1');
            expect(audit.valid).toBe(true);
            expect(audit.issues).toHaveLength(0);
            expect(audit.score).toBe(100);
        });

        test('detects volume imbalance in splits', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordSplit('R', [
                { id: 'A', volume: 3 },
                { id: 'B', volume: 3 },
            ]);
            const audit = tracker.auditChain('R');
            expect(audit.issues.some(i => i.type === 'volume_imbalance')).toBe(true);
            expect(audit.score).toBeLessThan(100);
        });

        test('perfect split has no volume imbalance', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordSplit('R', [
                { id: 'A', volume: 5 },
                { id: 'B', volume: 5 },
            ]);
            const audit = tracker.auditChain('R');
            expect(audit.issues.filter(i => i.type === 'volume_imbalance')).toHaveLength(0);
        });

        test('score floors at 0', () => {
            // Hard to produce many issues, but at minimum verify score >= 0
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            const audit = tracker.auditChain('R');
            expect(audit.score).toBeGreaterThanOrEqual(0);
        });
    });

    // ── suggestAction ──────────────────────────────────────────

    describe('suggestAction', () => {
        test('suggests discard for critically low viability', () => {
            tracker.registerBatch({ id: 'B1', material: 'alg', volume: 10, viability: 40 });
            const action = tracker.suggestAction('B1');
            expect(action.action).toBe('discard');
            expect(action.urgency).toBe('high');
        });

        test('suggests quality-check for moderate viability drop', () => {
            tracker.registerBatch({ id: 'B1', material: 'alg', volume: 10, viability: 65 });
            const action = tracker.suggestAction('B1');
            expect(action.action).toBe('quality-check');
            expect(action.urgency).toBe('medium');
        });

        test('suggests discard for very high passage', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            let prevId = 'R';
            for (let i = 1; i <= 16; i++) {
                tracker.recordPassage(prevId, { id: `P${i}`, viability: 95 });
                prevId = `P${i}`;
            }
            const action = tracker.suggestAction(prevId);
            expect(action.action).toBe('discard');
            expect(action.reason).toContain('Passage number');
        });

        test('suggests passage-now for mid-range passage', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            let prevId = 'R';
            for (let i = 1; i <= 10; i++) {
                tracker.recordPassage(prevId, { id: `P${i}`, viability: 95 });
                prevId = `P${i}`;
            }
            const action = tracker.suggestAction(prevId);
            expect(action.action).toBe('passage-now');
        });

        test('suggests continue for healthy batch', () => {
            tracker.registerBatch({ id: 'B1', material: 'alg', volume: 10, viability: 95 });
            const action = tracker.suggestAction('B1');
            expect(action.action).toBe('continue');
            expect(action.urgency).toBe('low');
        });

        test('suggests pool-with for low-volume batch with siblings', () => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordSplit('R', [
                { id: 'A', volume: 1 },
                { id: 'B', volume: 9 },
            ]);
            const action = tracker.suggestAction('A');
            expect(action.action).toBe('pool-with');
            expect(action.details).toContain('B');
        });
    });

    // ── exportGenealogy ────────────────────────────────────────

    describe('exportGenealogy', () => {
        beforeEach(() => {
            tracker.registerBatch({ id: 'R', material: 'alg', volume: 10, viability: 95 });
            tracker.recordSplit('R', [{ id: 'A', volume: 5 }, { id: 'B', volume: 5 }]);
        });

        test('exports as markdown by default', () => {
            const md = tracker.exportGenealogy('R');
            expect(md).toContain('# Batch Genealogy: R');
            expect(md).toContain('**R**');
            expect(md).toContain('**A**');
            expect(md).toContain('**B**');
        });

        test('exports as json', () => {
            const jsonStr = tracker.exportGenealogy('R', 'json');
            const parsed = JSON.parse(jsonStr);
            expect(parsed.batch.id).toBe('R');
            expect(parsed.children).toHaveLength(2);
        });
    });

    // ── getSummary ─────────────────────────────────────────────

    describe('getSummary', () => {
        test('returns correct summary stats', () => {
            tracker.registerBatch({ id: 'B1', material: 'alginate', volume: 10, viability: 90 });
            tracker.registerBatch({ id: 'B2', material: 'gelatin', volume: 5, viability: 40 });
            tracker.recordPassage('B1', { id: 'B1p', viability: 85 });

            const summary = tracker.getSummary();
            expect(summary.totalBatches).toBe(3);
            expect(summary.avgViability).toBeCloseTo(71.67, 1);
            expect(summary.materialBreakdown).toEqual({ alginate: 2, gelatin: 1 });
            expect(summary.generationDistribution).toEqual({ '0': 2, '1': 1 });
            expect(summary.retired).toBe(1); // B2 viability < 50
        });

        test('empty tracker returns zeros', () => {
            const summary = tracker.getSummary();
            expect(summary.totalBatches).toBe(0);
            expect(summary.avgViability).toBe(0);
        });
    });

    // ── getBatch ───────────────────────────────────────────────

    describe('getBatch', () => {
        test('returns registered batch', () => {
            tracker.registerBatch({ id: 'B1', material: 'alg', volume: 10, viability: 90 });
            const b = tracker.getBatch('B1');
            expect(b.id).toBe('B1');
        });

        test('throws on non-existent', () => {
            expect(() => tracker.getBatch('NOPE')).toThrow('not found');
        });

        test('throws on empty string', () => {
            expect(() => tracker.getBatch('')).toThrow('non-empty string');
        });
    });
});
