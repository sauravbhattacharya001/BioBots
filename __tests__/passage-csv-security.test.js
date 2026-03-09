'use strict';

var passage = require('../docs/shared/passage');

describe('Passage Tracker — CSV export security & edge cases', function () {
    var tracker;

    beforeEach(function () {
        tracker = passage.createPassageTracker();
        tracker.addCellLine({ id: 'SEC', name: 'Security Test', maxPassage: 50 });
    });

    // --- CSV formula injection defense (OWASP) ---

    describe('CSV formula injection defense', function () {
        test('prefixes operator starting with = to prevent formula injection', function () {
            tracker.recordPassage('SEC', {
                passage: 1, viability: 95, operator: '=CMD("calc")'
            });
            var csv = tracker.exportPassageData('SEC', 'csv');
            var dataLine = csv.split('\n')[1];
            // The = should be prefixed with a single quote
            expect(dataLine).toContain("'=CMD");
            expect(dataLine).not.toMatch(/,=CMD/);
        });

        test('prefixes notes starting with + to prevent formula injection', function () {
            tracker.recordPassage('SEC', {
                passage: 1, viability: 90, notes: '+1234567890'
            });
            var csv = tracker.exportPassageData('SEC', 'csv');
            expect(csv).toContain("'+1234567890");
        });

        test('prefixes notes starting with - to prevent formula injection', function () {
            tracker.recordPassage('SEC', {
                passage: 1, viability: 90, notes: '-1+2'
            });
            var csv = tracker.exportPassageData('SEC', 'csv');
            expect(csv).toContain("'-1+2");
        });

        test('prefixes notes starting with @ to prevent formula injection', function () {
            tracker.recordPassage('SEC', {
                passage: 1, viability: 90, notes: '@SUM(A1:A10)'
            });
            var csv = tracker.exportPassageData('SEC', 'csv');
            expect(csv).toContain("'@SUM");
        });

        test('handles notes with commas by quoting', function () {
            tracker.recordPassage('SEC', {
                passage: 1, viability: 90, notes: 'cell A, cell B'
            });
            var csv = tracker.exportPassageData('SEC', 'csv');
            expect(csv).toContain('"cell A, cell B"');
        });

        test('handles notes with double quotes by escaping', function () {
            tracker.recordPassage('SEC', {
                passage: 1, viability: 90, notes: 'said "hello"'
            });
            var csv = tracker.exportPassageData('SEC', 'csv');
            expect(csv).toContain('""hello""');
        });
    });

    // --- Fleet report edge cases ---

    describe('fleet report edge cases', function () {
        test('fleet report with mixed risk levels', function () {
            tracker.addCellLine({ id: 'LOW', maxPassage: 50 });
            tracker.addCellLine({ id: 'HIGH', maxPassage: 10 });
            tracker.addCellLine({ id: 'CRIT', maxPassage: 10 });

            tracker.recordPassage('LOW', { passage: 3, viability: 95 });
            tracker.recordPassage('HIGH', { passage: 8, viability: 85 });
            tracker.recordPassage('CRIT', { passage: 10, viability: 70 });

            var report = tracker.getFleetReport();
            expect(report.cellLines).toBe(4); // includes SEC from beforeEach
            expect(report.riskDistribution.critical).toBeGreaterThanOrEqual(1);
            expect(report.needsAttention.length).toBeGreaterThanOrEqual(1);
        });
    });

    // --- Multiple alerts on single passage ---

    describe('compound alert scenarios', function () {
        test('single passage triggers multiple alert types', function () {
            tracker.addCellLine({ id: 'MULTI', maxPassage: 10 });
            var result = tracker.recordPassage('MULTI', {
                passage: 9, viability: 65, confluence: 98
            });
            var types = result.alerts.map(function (a) { return a.type; });
            expect(types).toContain('high_passage');
            expect(types).toContain('low_viability');
            expect(types).toContain('over_confluence');
            expect(result.alerts.length).toBe(3);
        });
    });

    // --- Viability trend with exactly 2 points ---

    describe('viability trend with minimal data', function () {
        test('computes trend with exactly 2 data points', function () {
            tracker.recordPassage('SEC', { passage: 1, viability: 95 });
            tracker.recordPassage('SEC', { passage: 2, viability: 90 });
            var trend = tracker.getViabilityTrend('SEC');
            expect(trend.trend).not.toBe('insufficient_data');
            expect(trend.points).toBe(2);
            expect(trend.slope).toBeLessThan(0);
        });

        test('projects viability limit passage correctly', function () {
            tracker.recordPassage('SEC', { passage: 1, viability: 95 });
            tracker.recordPassage('SEC', { passage: 10, viability: 50 });
            var trend = tracker.getViabilityTrend('SEC');
            expect(trend.projectedLimitPassage).not.toBeNull();
            // Viability drops 5 per passage; from 95 at p1, hits 70 around passage 6
            expect(trend.projectedLimitPassage).toBeGreaterThan(0);
        });
    });

    // --- Export with null fields ---

    describe('export with null/missing fields', function () {
        test('CSV handles null viability and confluence gracefully', function () {
            tracker.recordPassage('SEC', { passage: 1 });
            var csv = tracker.exportPassageData('SEC', 'csv');
            var lines = csv.split('\n');
            expect(lines.length).toBe(2);
            // null fields should appear as empty or null, not crash
            expect(lines[1]).toContain('1,');
        });

        test('JSON handles null fields', function () {
            tracker.recordPassage('SEC', { passage: 1 });
            var json = tracker.exportPassageData('SEC', 'json');
            var parsed = JSON.parse(json);
            expect(parsed.passages[0].viability).toBeNull();
            expect(parsed.passages[0].confluence).toBeNull();
            expect(parsed.passages[0].cellCount).toBeNull();
        });
    });

    // --- getOptimalPassageWindow edge: no high viability ---

    describe('optimal window edge cases', function () {
        test('returns no window when all viabilities below 85%', function () {
            tracker.recordPassage('SEC', { passage: 1, viability: 70 });
            tracker.recordPassage('SEC', { passage: 2, viability: 72 });
            tracker.recordPassage('SEC', { passage: 3, viability: 68 });
            var window = tracker.getOptimalPassageWindow('SEC');
            expect(window.window).toBeNull();
            expect(window.reason).toBe('no_high_viability_passages');
        });
    });
});
