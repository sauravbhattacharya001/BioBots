'use strict';

var passage = require('../docs/shared/passage');

describe('Cell Passage Tracker', function () {
    var tracker;

    beforeEach(function () {
        tracker = passage.createPassageTracker();
    });

    // --- Cell Line Management ---

    describe('addCellLine', function () {
        test('adds cell line with defaults', function () {
            var cl = tracker.addCellLine({ id: 'HEK293', name: 'HEK-293T' });
            expect(cl.id).toBe('HEK293');
            expect(cl.name).toBe('HEK-293T');
            expect(cl.maxPassage).toBe(50);
            expect(cl.optimalConfluence).toEqual({ min: 70, max: 90 });
            expect(cl.species).toBe('unknown');
        });

        test('adds cell line with custom settings', function () {
            var cl = tracker.addCellLine({
                id: 'MSC', name: 'Mesenchymal Stem Cells', species: 'human',
                tissue: 'bone marrow', maxPassage: 8, doublingTime: 36,
                medium: 'DMEM + 10% FBS', optimalConfluence: { min: 60, max: 80 }
            });
            expect(cl.maxPassage).toBe(8);
            expect(cl.doublingTime).toBe(36);
            expect(cl.tissue).toBe('bone marrow');
        });

        test('throws on missing id', function () {
            expect(function () { tracker.addCellLine({}); }).toThrow('id is required');
        });

        test('throws on duplicate id', function () {
            tracker.addCellLine({ id: 'A' });
            expect(function () { tracker.addCellLine({ id: 'A' }); }).toThrow('already exists');
        });
    });

    describe('getCellLine', function () {
        test('returns cell line copy', function () {
            tracker.addCellLine({ id: 'X', name: 'Test' });
            var cl = tracker.getCellLine('X');
            expect(cl.name).toBe('Test');
            cl.name = 'Modified';
            expect(tracker.getCellLine('X').name).toBe('Test');
        });

        test('throws on unknown id', function () {
            expect(function () { tracker.getCellLine('nope'); }).toThrow('not found');
        });
    });

    describe('listCellLines', function () {
        test('lists all with summary', function () {
            tracker.addCellLine({ id: 'A' });
            tracker.addCellLine({ id: 'B' });
            tracker.recordPassage('A', { passage: 1, viability: 95 });
            var list = tracker.listCellLines();
            expect(list).toHaveLength(2);
            expect(list[0].totalPassages).toBe(1);
            expect(list[0].latestViability).toBe(95);
            expect(list[1].totalPassages).toBe(0);
        });
    });

    describe('removeCellLine', function () {
        test('removes cell line and passages', function () {
            tracker.addCellLine({ id: 'X' });
            tracker.recordPassage('X', { passage: 1, viability: 90 });
            expect(tracker.removeCellLine('X')).toBe(true);
            expect(tracker.listCellLines()).toHaveLength(0);
        });

        test('throws on unknown', function () {
            expect(function () { tracker.removeCellLine('nope'); }).toThrow('not found');
        });
    });

    // --- Passage Recording ---

    describe('recordPassage', function () {
        beforeEach(function () {
            tracker.addCellLine({ id: 'C', name: 'TestCells', maxPassage: 20 });
        });

        test('records basic passage', function () {
            var result = tracker.recordPassage('C', { passage: 1, viability: 95, confluence: 80 });
            expect(result.record.passage).toBe(1);
            expect(result.record.viability).toBe(95);
            expect(result.alerts).toHaveLength(0);
        });

        test('sorts passages by number', function () {
            tracker.recordPassage('C', { passage: 3, viability: 90 });
            tracker.recordPassage('C', { passage: 1, viability: 95 });
            tracker.recordPassage('C', { passage: 2, viability: 92 });
            var history = tracker.getPassageHistory('C');
            expect(history.map(function (p) { return p.passage; })).toEqual([1, 2, 3]);
        });

        test('validates viability range', function () {
            expect(function () {
                tracker.recordPassage('C', { passage: 1, viability: 105 });
            }).toThrow('0-100');
        });

        test('validates confluence range', function () {
            expect(function () {
                tracker.recordPassage('C', { passage: 1, confluence: -5 });
            }).toThrow('0-100');
        });

        test('validates passage >= 1', function () {
            expect(function () {
                tracker.recordPassage('C', { passage: 0 });
            }).toThrow('>= 1');
        });

        test('triggers high passage alert', function () {
            var result = tracker.recordPassage('C', { passage: 18, viability: 90 });
            expect(result.alerts).toHaveLength(1);
            expect(result.alerts[0].type).toBe('high_passage');
            expect(result.alerts[0].severity).toBe('critical');
        });

        test('triggers low viability alert', function () {
            var result = tracker.recordPassage('C', { passage: 5, viability: 65 });
            var alert = result.alerts.find(function (a) { return a.type === 'low_viability'; });
            expect(alert).toBeDefined();
            expect(alert.severity).toBe('critical');
        });

        test('triggers warning viability alert at 75%', function () {
            var result = tracker.recordPassage('C', { passage: 5, viability: 75 });
            var alert = result.alerts.find(function (a) { return a.type === 'low_viability'; });
            expect(alert.severity).toBe('warning');
        });

        test('triggers over-confluence alert', function () {
            var result = tracker.recordPassage('C', { passage: 5, viability: 90, confluence: 96 });
            var alert = result.alerts.find(function (a) { return a.type === 'over_confluence'; });
            expect(alert).toBeDefined();
            expect(alert.severity).toBe('critical');
        });

        test('throws on unknown cell line', function () {
            expect(function () { tracker.recordPassage('nope', { passage: 1 }); }).toThrow('not found');
        });
    });

    describe('getPassageHistory', function () {
        beforeEach(function () {
            tracker.addCellLine({ id: 'H', maxPassage: 30 });
            for (var i = 1; i <= 10; i++) {
                tracker.recordPassage('H', { passage: i, viability: 95 - i });
            }
        });

        test('returns all passages', function () {
            expect(tracker.getPassageHistory('H')).toHaveLength(10);
        });

        test('filters by fromPassage', function () {
            var ps = tracker.getPassageHistory('H', { fromPassage: 5 });
            expect(ps).toHaveLength(6);
            expect(ps[0].passage).toBe(5);
        });

        test('filters by toPassage', function () {
            var ps = tracker.getPassageHistory('H', { toPassage: 3 });
            expect(ps).toHaveLength(3);
        });

        test('limits results', function () {
            var ps = tracker.getPassageHistory('H', { limit: 3 });
            expect(ps).toHaveLength(3);
            expect(ps[0].passage).toBe(8); // last 3
        });
    });

    // --- Analysis ---

    describe('getViabilityTrend', function () {
        test('returns insufficient data for < 2 points', function () {
            tracker.addCellLine({ id: 'V' });
            tracker.recordPassage('V', { passage: 1, viability: 95 });
            var trend = tracker.getViabilityTrend('V');
            expect(trend.trend).toBe('insufficient_data');
        });

        test('detects declining viability', function () {
            tracker.addCellLine({ id: 'V' });
            [95, 92, 88, 84, 80, 75].forEach(function (v, i) {
                tracker.recordPassage('V', { passage: i + 1, viability: v });
            });
            var trend = tracker.getViabilityTrend('V');
            expect(trend.trend).toBe('critical_decline');
            expect(trend.slope).toBeLessThan(-1.5);
            expect(trend.projectedLimitPassage).not.toBeNull();
        });

        test('detects stable viability', function () {
            tracker.addCellLine({ id: 'V' });
            [95, 95, 94, 95, 95].forEach(function (v, i) {
                tracker.recordPassage('V', { passage: i + 1, viability: v });
            });
            var trend = tracker.getViabilityTrend('V');
            expect(trend.trend).toBe('stable');
        });

        test('detects improving viability', function () {
            tracker.addCellLine({ id: 'V' });
            [85, 88, 90, 93, 95].forEach(function (v, i) {
                tracker.recordPassage('V', { passage: i + 1, viability: v });
            });
            var trend = tracker.getViabilityTrend('V');
            expect(trend.trend).toBe('improving');
        });

        test('handles identical passage numbers without NaN (fixes #45)', function () {
            tracker.addCellLine({ id: 'V' });
            tracker.recordPassage('V', { passage: 5, viability: 90 });
            tracker.recordPassage('V', { passage: 5, viability: 85 });
            tracker.recordPassage('V', { passage: 5, viability: 88 });
            var trend = tracker.getViabilityTrend('V');
            expect(trend.trend).toBe('insufficient_data');
            expect(trend.reason).toBe('all_same_passage');
            expect(trend.slope).toBe(0);
            expect(isNaN(trend.slope)).toBe(false);
            expect(isNaN(trend.intercept)).toBe(false);
            expect(trend.currentViability).toBe(88);
            expect(trend.projectedLimitPassage).toBeNull();
        });
    });

    describe('getConfluenceProfile', function () {
        test('returns no_data when empty', function () {
            tracker.addCellLine({ id: 'C' });
            var profile = tracker.getConfluenceProfile('C');
            expect(profile.profile).toBe('no_data');
        });

        test('detects well-managed confluence', function () {
            tracker.addCellLine({ id: 'C', optimalConfluence: { min: 70, max: 90 } });
            [75, 80, 85, 80, 78].forEach(function (c, i) {
                tracker.recordPassage('C', { passage: i + 1, confluence: c });
            });
            var profile = tracker.getConfluenceProfile('C');
            expect(profile.profile).toBe('well_managed');
            expect(profile.inRangePercent).toBe(100);
        });

        test('detects needs_attention profile', function () {
            tracker.addCellLine({ id: 'C', optimalConfluence: { min: 70, max: 90 } });
            [50, 95, 40, 92, 60].forEach(function (c, i) {
                tracker.recordPassage('C', { passage: i + 1, confluence: c });
            });
            var profile = tracker.getConfluenceProfile('C');
            expect(profile.profile).toBe('needs_attention');
        });
    });

    describe('getOptimalPassageWindow', function () {
        test('returns insufficient_data for < 3 points', function () {
            tracker.addCellLine({ id: 'W' });
            tracker.recordPassage('W', { passage: 1, viability: 95 });
            var window = tracker.getOptimalPassageWindow('W');
            expect(window.window).toBeNull();
        });

        test('finds optimal passage window', function () {
            tracker.addCellLine({ id: 'W', maxPassage: 30 });
            [90, 92, 95, 93, 88, 85, 78, 70].forEach(function (v, i) {
                tracker.recordPassage('W', { passage: i + 1, viability: v });
            });
            var window = tracker.getOptimalPassageWindow('W');
            expect(window.window).toBeDefined();
            expect(window.window.from).toBe(1);
            expect(window.window.to).toBeLessThanOrEqual(24);
        });
    });

    describe('getSenescenceRisk', function () {
        test('low risk for early passages', function () {
            tracker.addCellLine({ id: 'S', maxPassage: 30 });
            tracker.recordPassage('S', { passage: 5, viability: 95 });
            var risk = tracker.getSenescenceRisk('S');
            expect(risk.risk).toBe('low');
            expect(risk.remainingPassages).toBe(25);
        });

        test('critical risk near max', function () {
            tracker.addCellLine({ id: 'S', maxPassage: 20 });
            tracker.recordPassage('S', { passage: 19, viability: 80 });
            var risk = tracker.getSenescenceRisk('S');
            expect(risk.risk).toBe('critical');
        });

        test('moderate risk at midpoint', function () {
            tracker.addCellLine({ id: 'S', maxPassage: 20 });
            tracker.recordPassage('S', { passage: 12, viability: 90 });
            var risk = tracker.getSenescenceRisk('S');
            expect(risk.risk).toBe('moderate');
        });

        test('unknown risk with no passages', function () {
            tracker.addCellLine({ id: 'S', maxPassage: 20 });
            var risk = tracker.getSenescenceRisk('S');
            expect(risk.risk).toBe('unknown');
        });
    });

    // --- Reporting ---

    describe('getCellLineReport', function () {
        test('generates comprehensive report', function () {
            tracker.addCellLine({ id: 'R', name: 'ReportTest', maxPassage: 20 });
            [95, 93, 91, 89, 87].forEach(function (v, i) {
                tracker.recordPassage('R', { passage: i + 1, viability: v, confluence: 75 + i * 3 });
            });
            var report = tracker.getCellLineReport('R');
            expect(report.cellLine.id).toBe('R');
            expect(report.passageCount).toBe(5);
            expect(report.viabilityTrend.trend).toBeDefined();
            expect(report.confluenceProfile.profile).toBeDefined();
            expect(report.senescenceRisk.risk).toBe('low');
            expect(report.recentPassages).toHaveLength(5);
        });
    });

    describe('getFleetReport', function () {
        test('returns empty summary with no lines', function () {
            var report = tracker.getFleetReport();
            expect(report.cellLines).toBe(0);
        });

        test('aggregates across cell lines', function () {
            tracker.addCellLine({ id: 'A', maxPassage: 20 });
            tracker.addCellLine({ id: 'B', maxPassage: 10 });
            tracker.recordPassage('A', { passage: 5, viability: 95 });
            tracker.recordPassage('B', { passage: 9, viability: 80 });
            var report = tracker.getFleetReport();
            expect(report.cellLines).toBe(2);
            expect(report.needsAttention).toHaveLength(1);
            expect(report.needsAttention[0].id).toBe('B');
        });
    });

    // --- Export ---

    describe('exportPassageData', function () {
        beforeEach(function () {
            tracker.addCellLine({ id: 'E' });
            tracker.recordPassage('E', { passage: 1, viability: 95, confluence: 80, operator: 'Alice' });
            tracker.recordPassage('E', { passage: 2, viability: 92, confluence: 85, operator: 'Bob' });
        });

        test('exports JSON', function () {
            var json = tracker.exportPassageData('E', 'json');
            var parsed = JSON.parse(json);
            expect(parsed.passages).toHaveLength(2);
            expect(parsed.cellLine.id).toBe('E');
        });

        test('exports CSV', function () {
            var csv = tracker.exportPassageData('E', 'csv');
            var lines = csv.split('\n');
            expect(lines[0]).toContain('passage,viability,confluence');
            expect(lines).toHaveLength(3);
        });

        test('defaults to JSON', function () {
            var json = tracker.exportPassageData('E');
            expect(function () { JSON.parse(json); }).not.toThrow();
        });

        test('throws on unsupported format', function () {
            expect(function () { tracker.exportPassageData('E', 'xml'); }).toThrow('Unsupported format');
        });
    });

    // --- Alerts ---

    describe('alerts', function () {
        test('getAlerts filters by cell line', function () {
            tracker.addCellLine({ id: 'A', maxPassage: 10 });
            tracker.addCellLine({ id: 'B', maxPassage: 10 });
            tracker.recordPassage('A', { passage: 9, viability: 65 });
            tracker.recordPassage('B', { passage: 2, viability: 95 });
            var alertsA = tracker.getAlerts({ cellLineId: 'A' });
            expect(alertsA.length).toBeGreaterThan(0);
            alertsA.forEach(function (a) { expect(a.cellLineId).toBe('A'); });
        });

        test('getAlerts filters unacknowledged', function () {
            tracker.addCellLine({ id: 'X', maxPassage: 10 });
            tracker.recordPassage('X', { passage: 9, viability: 65 });
            var all = tracker.getAlerts({});
            expect(all.length).toBeGreaterThan(0);
            tracker.acknowledgeAlert(0);
            var unacked = tracker.getAlerts({ unacknowledged: true });
            expect(unacked.length).toBe(all.length - 1);
        });

        test('acknowledgeAlert marks alert', function () {
            tracker.addCellLine({ id: 'X', maxPassage: 10 });
            tracker.recordPassage('X', { passage: 9, viability: 90 });
            var acked = tracker.acknowledgeAlert(0);
            expect(acked.acknowledged).toBe(true);
            expect(acked.acknowledgedAt).toBeDefined();
        });

        test('acknowledgeAlert throws on invalid index', function () {
            expect(function () { tracker.acknowledgeAlert(999); }).toThrow('Invalid alert index');
        });

        test('filters by severity', function () {
            tracker.addCellLine({ id: 'X', maxPassage: 10 });
            tracker.recordPassage('X', { passage: 9, viability: 65, confluence: 96 });
            var critical = tracker.getAlerts({ severity: 'critical' });
            critical.forEach(function (a) { expect(a.severity).toBe('critical'); });
        });
    });

    // --- Edge Cases ---

    describe('edge cases', function () {
        test('handles cell line with only null viabilities', function () {
            tracker.addCellLine({ id: 'N' });
            tracker.recordPassage('N', { passage: 1 });
            tracker.recordPassage('N', { passage: 2 });
            var trend = tracker.getViabilityTrend('N');
            expect(trend.trend).toBe('insufficient_data');
        });

        test('handles cell line with null confluences', function () {
            tracker.addCellLine({ id: 'N' });
            tracker.recordPassage('N', { passage: 1, viability: 95 });
            var profile = tracker.getConfluenceProfile('N');
            expect(profile.profile).toBe('no_data');
        });

        test('records operator and notes', function () {
            tracker.addCellLine({ id: 'D' });
            tracker.recordPassage('D', { passage: 1, viability: 95, operator: 'Dr. Smith', notes: 'Cells look healthy' });
            var history = tracker.getPassageHistory('D');
            expect(history[0].operator).toBe('Dr. Smith');
            expect(history[0].notes).toBe('Cells look healthy');
        });
    });
});
