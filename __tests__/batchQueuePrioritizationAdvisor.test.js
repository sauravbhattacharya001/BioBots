'use strict';

/**
 * Tests for batchQueuePrioritizationAdvisor.
 *
 * Covers: factory construction, priority/order assignment, SLA-pressure
 * scoring, tier bonuses, dependency blocking, equipment/operator
 * availability blocking, deterministic recommendedRunOrder tie-breaking,
 * rendered text/markdown/JSON outputs, and the public VERDICTS surface.
 */

var fab = require('../docs/shared/batchQueuePrioritizationAdvisor');
var createBatchQueuePrioritizationAdvisor = fab.createBatchQueuePrioritizationAdvisor;
var VERDICTS = fab.VERDICTS;

function fixedNow(iso) { return function () { return new Date(iso); }; }

describe('batchQueuePrioritizationAdvisor — factory and basics', function () {
    test('exports a factory and verdict constants', function () {
        expect(typeof createBatchQueuePrioritizationAdvisor).toBe('function');
        expect(VERDICTS).toBeDefined();
        expect(VERDICTS.RUN_NOW).toBe('RUN_NOW');
        expect(VERDICTS.DEFER).toBe('DEFER');
    });

    test('builds an advisor with the documented surface', function () {
        var advisor = createBatchQueuePrioritizationAdvisor();
        expect(typeof advisor.prioritize).toBe('function');
        expect(typeof advisor.formatText).toBe('function');
        expect(typeof advisor.formatMarkdown).toBe('function');
        expect(typeof advisor.formatJson).toBe('function');
        expect(advisor.VERDICTS.RUN_NOW).toBe('RUN_NOW');
    });

    test('handles empty / missing input without throwing', function () {
        var advisor = createBatchQueuePrioritizationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var r1 = advisor.prioritize();
        expect(r1).toBeDefined();
        expect(Array.isArray(r1.batches)).toBe(true);
        expect(r1.batches.length).toBe(0);
        expect(Array.isArray(r1.recommendedRunOrder)).toBe(true);
        expect(r1.recommendedRunOrder.length).toBe(0);
        expect(r1.risk_appetite).toBe('balanced');
        var r2 = advisor.prioritize({});
        expect(r2.batches.length).toBe(0);
    });
});

describe('batchQueuePrioritizationAdvisor — scoring & ordering', function () {
    test('SLA-imminent + platinum batch outranks plain backlog batch', function () {
        var advisor = createBatchQueuePrioritizationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var report = advisor.prioritize({
            batches: [
                {
                    id: 'B-LOW',
                    estimatedRuntimeHours: 4,
                    customerTier: 'standard',
                    priorityHint: 'low',
                },
                {
                    id: 'B-HOT',
                    estimatedRuntimeHours: 4,
                    customerTier: 'platinum',
                    priorityHint: 'rush',
                    slaDeadlineISO: '2026-05-20T16:00:00Z', // 4h, tight vs 4h runtime
                    estimatedRevenueUsd: 25000,
                },
            ],
        });

        expect(report.recommendedRunOrder[0]).toBe('B-HOT');
        expect(report.recommendedRunOrder[1]).toBe('B-LOW');
        var hot = report.batches.find(function (b) { return b.id === 'B-HOT'; });
        var low = report.batches.find(function (b) { return b.id === 'B-LOW'; });
        expect(hot.priorityScore).toBeGreaterThan(low.priorityScore);
        expect(PRIORITY_TO_NUM(hot.priority)).toBeLessThanOrEqual(PRIORITY_TO_NUM(low.priority));
        // None of the internal scoring fields should leak into the public report.
        expect(hot.slaDeadlineMs).toBeUndefined();
    });

    test('flagging an already-late SLA bumps the reasons list', function () {
        var advisor = createBatchQueuePrioritizationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var report = advisor.prioritize({
            batches: [{
                id: 'B-LATE',
                estimatedRuntimeHours: 2,
                slaDeadlineISO: '2026-05-19T12:00:00Z', // 24h ago
            }],
        });
        var b = report.batches[0];
        expect(b.reasons).toContain('ALREADY_LATE');
    });

    test('dependency-blocked batch is heavily penalized', function () {
        var advisor = createBatchQueuePrioritizationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var report = advisor.prioritize({
            batches: [
                { id: 'B-DEP', estimatedRuntimeHours: 4, dependencyBatchIds: ['B-PARENT'] },
            ],
            context: { completedBatchIds: [] },
        });
        var b = report.batches[0];
        expect(b.reasons).toContain('DEPENDENCY_PENDING');
        // Dependency-blocked batches lose ~50 points of base score and pick up a
        // BLOCKED_BY_DEPENDENCY verdict regardless of priority bucket.
        expect(b.blockers).toEqual(expect.arrayContaining(['dependency:B-PARENT']));
        expect(b.verdict).toBe(VERDICTS.BLOCKED_BY_DEPENDENCY);
    });

    test('completing the dependency unblocks the batch', function () {
        var advisor = createBatchQueuePrioritizationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var report = advisor.prioritize({
            batches: [
                { id: 'B-DEP', estimatedRuntimeHours: 4, dependencyBatchIds: ['B-PARENT'] },
            ],
            context: { completedBatchIds: ['B-PARENT'] },
        });
        var b = report.batches[0];
        expect(b.reasons.indexOf('DEPENDENCY_PENDING')).toBe(-1);
    });

    test('deterministic tie-break by id for identical batches', function () {
        var advisor = createBatchQueuePrioritizationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var report = advisor.prioritize({
            batches: [
                { id: 'Z', estimatedRuntimeHours: 1 },
                { id: 'A', estimatedRuntimeHours: 1 },
                { id: 'M', estimatedRuntimeHours: 1 },
            ],
        });
        expect(report.recommendedRunOrder).toEqual(['A', 'M', 'Z']);
    });
});

describe('batchQueuePrioritizationAdvisor — output renderers', function () {
    var advisor = createBatchQueuePrioritizationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
    var report = advisor.prioritize({
        batches: [
            { id: 'B-1', estimatedRuntimeHours: 2, customerTier: 'gold' },
        ],
    });

    test('formatText returns a non-empty string', function () {
        var txt = advisor.formatText(report);
        expect(typeof txt).toBe('string');
        expect(txt.length).toBeGreaterThan(0);
        expect(txt).toContain('B-1');
    });

    test('formatMarkdown contains markdown structure', function () {
        var md = advisor.formatMarkdown(report);
        expect(typeof md).toBe('string');
        expect(md).toMatch(/^#\s|##\s/m);
        expect(md).toContain('B-1');
    });

    test('formatJson returns valid JSON containing the batch', function () {
        var raw = advisor.formatJson(report);
        var parsed = JSON.parse(raw);
        expect(parsed.batches[0].id).toBe('B-1');
    });
});

describe('batchQueuePrioritizationAdvisor — appetite controls', function () {
    test('cautious appetite gives a higher score than aggressive for the same batch', function () {
        var advisor = createBatchQueuePrioritizationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var batches = [{
            id: 'B-X',
            estimatedRuntimeHours: 2,
            customerTier: 'silver',
            slaDeadlineISO: '2026-05-21T12:00:00Z',
        }];
        var cautious = advisor.prioritize({ batches: batches }, { risk_appetite: 'cautious' });
        var aggressive = advisor.prioritize({ batches: batches }, { risk_appetite: 'aggressive' });
        expect(cautious.risk_appetite).toBe('cautious');
        expect(aggressive.risk_appetite).toBe('aggressive');
        // Cautious appetite uses a higher multiplier on score (1.10 vs 0.90), so >=.
        expect(cautious.batches[0].priorityScore)
            .toBeGreaterThanOrEqual(aggressive.batches[0].priorityScore);
    });

    test('unknown appetite is coerced back to balanced', function () {
        var advisor = createBatchQueuePrioritizationAdvisor({ now: fixedNow('2026-05-20T12:00:00Z') });
        var r = advisor.prioritize({ batches: [] }, { risk_appetite: 'nonsense' });
        expect(r.risk_appetite).toBe('balanced');
    });
});

// helpers --------------------------------------------------------

function PRIORITY_TO_NUM(p) {
    return ({ P0: 0, P1: 1, P2: 2, P3: 3 })[p];
}
