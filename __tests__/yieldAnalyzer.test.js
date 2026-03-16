'use strict';

var ya = require('../docs/shared/yieldAnalyzer');

function makeRecords(outcomes) {
    return outcomes.map(function(o, i) {
        return {
            id: 'P-' + i,
            material: ['alginate','gelatin','collagen'][i % 3],
            operator: ['Dr. A','Dr. B'][i % 2],
            date: new Date(2026, 2, 1 + i).toISOString(),
            outcome: o,
            failureReason: o === 'failure' ? 'nozzle clog' : (o === 'partial' ? 'under-extrusion' : undefined)
        };
    });
}

describe('YieldAnalyzer', function() {
    var analyzer;
    beforeEach(function() { analyzer = ya.createYieldAnalyzer(); });

    // --- Validation ---
    test('throws on non-array', function() {
        expect(function() { analyzer.analyze('bad'); }).toThrow('records must be an array');
    });
    test('throws on empty array', function() {
        expect(function() { analyzer.analyze([]); }).toThrow('records array is empty');
    });
    test('throws on missing outcome', function() {
        expect(function() { analyzer.analyze([{ id: '1' }]); }).toThrow('missing outcome');
    });
    test('throws on invalid outcome', function() {
        expect(function() { analyzer.analyze([{ outcome: 'bad' }]); }).toThrow('invalid outcome');
    });

    // --- Overall yield ---
    test('all success = 100% yield', function() {
        var r = analyzer.analyze(makeRecords(['success','success','success']));
        expect(r.overall.yieldRate).toBe(100);
        expect(r.overall.failureRate).toBe(0);
    });
    test('all failure = 0% yield', function() {
        var r = analyzer.analyze(makeRecords(['failure','failure','failure']));
        expect(r.overall.yieldRate).toBe(0);
        expect(r.overall.failureRate).toBe(100);
    });
    test('mixed outcomes computed correctly', function() {
        var r = analyzer.analyze(makeRecords(['success','failure','partial','success']));
        expect(r.overall.total).toBe(4);
        expect(r.overall.success).toBe(2);
        expect(r.overall.failure).toBe(1);
        expect(r.overall.partial).toBe(1);
        expect(r.overall.yieldRate).toBe(50);
    });
    test('effective yield counts partial as 0.5', function() {
        var r = analyzer.analyze(makeRecords(['success','partial']));
        expect(r.overall.effectiveYield).toBe(75); // (1 + 0.5) / 2 * 100
    });

    // --- By material ---
    test('groups by material', function() {
        var r = analyzer.analyze(makeRecords(['success','failure','success']));
        expect(r.byMaterial).toBeDefined();
        expect(Object.keys(r.byMaterial).length).toBeGreaterThan(0);
    });
    test('material yield correct', function() {
        var records = [
            { id: '1', material: 'alginate', outcome: 'success', date: '2026-03-01' },
            { id: '2', material: 'alginate', outcome: 'failure', date: '2026-03-02', failureReason: 'clog' },
            { id: '3', material: 'gelatin', outcome: 'success', date: '2026-03-03' }
        ];
        var r = analyzer.analyze(records);
        expect(r.byMaterial.alginate.yieldRate).toBe(50);
        expect(r.byMaterial.gelatin.yieldRate).toBe(100);
    });

    // --- By operator ---
    test('groups by operator', function() {
        var r = analyzer.analyze(makeRecords(['success','failure','success','failure']));
        expect(r.byOperator['Dr. A']).toBeDefined();
        expect(r.byOperator['Dr. B']).toBeDefined();
    });

    // --- Failure reasons ---
    test('aggregates failure reasons', function() {
        var r = analyzer.analyze(makeRecords(['failure','failure','success']));
        expect(r.failureReasons.total).toBe(2);
        expect(r.failureReasons.reasons[0].reason).toBe('nozzle clog');
    });
    test('no failures gives empty reasons', function() {
        var r = analyzer.analyze(makeRecords(['success','success']));
        expect(r.failureReasons.total).toBe(0);
        expect(r.failureReasons.reasons).toHaveLength(0);
    });

    // --- Streaks ---
    test('tracks success streak', function() {
        var r = analyzer.analyze(makeRecords(['success','success','success']));
        expect(r.streaks.bestSuccessStreak).toBe(3);
        expect(r.streaks.currentType).toBe('success');
    });
    test('tracks failure streak', function() {
        var r = analyzer.analyze(makeRecords(['success','failure','failure','failure']));
        expect(r.streaks.worstFailureStreak).toBe(3);
        expect(r.streaks.currentType).toBe('failure');
    });

    // --- Recommendations ---
    test('critical rec when yield < 50%', function() {
        var r = analyzer.analyze(makeRecords(['failure','failure','failure','success']));
        expect(r.recommendations.some(function(x) { return x.priority === 'critical'; })).toBe(true);
    });
    test('healthy rec when yield is good', function() {
        var r = analyzer.analyze(makeRecords(['success','success','success','success','success']));
        expect(r.recommendations[0].priority).toBe('low');
    });

    // --- Trends ---
    test('computes rolling yield', function() {
        var t = analyzer.trends(makeRecords(['success','success','failure','success','success']), { windowSize: 3 });
        expect(t.rollingYield.length).toBe(3);
        expect(t.direction).toBeDefined();
    });
    test('detects improving trend', function() {
        var t = analyzer.trends(makeRecords(['failure','failure','failure','success','success','success','success']), { windowSize: 3 });
        expect(t.direction).toBe('improving');
    });
    test('detects declining trend', function() {
        var t = analyzer.trends(makeRecords(['success','success','success','failure','failure','failure','failure']), { windowSize: 3 });
        expect(t.direction).toBe('declining');
    });
    test('daily aggregation', function() {
        var t = analyzer.trends(makeRecords(['success','failure','success']), { windowSize: 2 });
        expect(t.daily.length).toBeGreaterThan(0);
    });

    // --- Compare ---
    test('compare two batches', function() {
        var a = makeRecords(['failure','failure']);
        var b = makeRecords(['success','success']);
        var c = analyzer.compare(a, b, 'Batch A', 'Batch B');
        expect(c.improved).toBe(true);
        expect(c.yieldDelta).toBe(100);
        expect(c.labels[0]).toBe('Batch A');
    });

    // --- Export ---
    test('exportCSV produces valid CSV', function() {
        var r = analyzer.analyze(makeRecords(['success','failure','partial']));
        var csv = analyzer.exportCSV(r);
        expect(csv).toContain('Category,Total');
        expect(csv).toContain('Overall');
    });
    test('exportJSON produces valid JSON', function() {
        var r = analyzer.analyze(makeRecords(['success','failure']));
        var json = analyzer.exportJSON(r);
        var parsed = JSON.parse(json);
        expect(parsed.overall.total).toBe(2);
    });

    // --- OUTCOMES constant ---
    test('exposes OUTCOMES', function() {
        expect(analyzer.OUTCOMES.SUCCESS).toBe('success');
        expect(analyzer.OUTCOMES.FAILURE).toBe('failure');
        expect(analyzer.OUTCOMES.PARTIAL).toBe('partial');
    });

    // --- Case insensitive ---
    test('outcome is case insensitive', function() {
        var r = analyzer.analyze([{ id: '1', outcome: 'SUCCESS', material: 'a', date: '2026-01-01' }]);
        expect(r.overall.success).toBe(1);
    });

    // --- Unknown material/operator default ---
    test('missing material defaults to unknown', function() {
        var r = analyzer.analyze([{ id: '1', outcome: 'success', date: '2026-01-01' }]);
        expect(r.byMaterial.unknown).toBeDefined();
    });

    // --- Record count ---
    test('report includes recordCount', function() {
        var r = analyzer.analyze(makeRecords(['success','success']));
        expect(r.recordCount).toBe(2);
    });
});
