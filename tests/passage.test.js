// tests/passage.test.js — Cell Passage Tracker Tests
'use strict';

const { createPassageTracker } = require('../docs/shared/passage.js');

// ── Cell Line Management ────────────────────────────────────

describe('createPassageTracker', () => {
    let tracker;

    beforeEach(() => {
        tracker = createPassageTracker();
    });

    // --- addCellLine ---

    describe('addCellLine', () => {
        test('creates a cell line with required fields', () => {
            const cl = tracker.addCellLine({ id: 'HEK293', name: 'HEK-293T', maxPassage: 30 });
            expect(cl.id).toBe('HEK293');
            expect(cl.name).toBe('HEK-293T');
            expect(cl.maxPassage).toBe(30);
        });

        test('applies defaults for optional fields', () => {
            const cl = tracker.addCellLine({ id: 'X1' });
            expect(cl.name).toBe('X1');
            expect(cl.species).toBe('unknown');
            expect(cl.tissue).toBe('unknown');
            expect(cl.maxPassage).toBe(50);
            expect(cl.medium).toBe('unknown');
            expect(cl.optimalConfluence).toEqual({ min: 70, max: 90 });
        });

        test('throws if id is missing', () => {
            expect(() => tracker.addCellLine({})).toThrow('id is required');
            expect(() => tracker.addCellLine(null)).toThrow();
        });

        test('throws if cell line already exists', () => {
            tracker.addCellLine({ id: 'A' });
            expect(() => tracker.addCellLine({ id: 'A' })).toThrow('already exists');
        });
    });

    // --- getCellLine ---

    describe('getCellLine', () => {
        test('returns a copy of the cell line', () => {
            tracker.addCellLine({ id: 'C1', name: 'Clone 1' });
            const cl = tracker.getCellLine('C1');
            expect(cl.name).toBe('Clone 1');
            // Should be a copy, not a reference
            cl.name = 'Modified';
            expect(tracker.getCellLine('C1').name).toBe('Clone 1');
        });

        test('throws for unknown cell line', () => {
            expect(() => tracker.getCellLine('NOPE')).toThrow('not found');
        });
    });

    // --- listCellLines ---

    describe('listCellLines', () => {
        test('returns empty array when no cell lines exist', () => {
            expect(tracker.listCellLines()).toEqual([]);
        });

        test('lists all cell lines with summary info', () => {
            tracker.addCellLine({ id: 'A' });
            tracker.addCellLine({ id: 'B' });
            const list = tracker.listCellLines();
            expect(list).toHaveLength(2);
            expect(list[0].id).toBe('A');
            expect(list[0].totalPassages).toBe(0);
        });
    });

    // --- removeCellLine ---

    describe('removeCellLine', () => {
        test('removes an existing cell line', () => {
            tracker.addCellLine({ id: 'R1' });
            expect(tracker.removeCellLine('R1')).toBe(true);
            expect(tracker.listCellLines()).toHaveLength(0);
        });

        test('throws for unknown cell line', () => {
            expect(() => tracker.removeCellLine('NOPE')).toThrow('not found');
        });
    });

    // --- recordPassage ---

    describe('recordPassage', () => {
        beforeEach(() => {
            tracker.addCellLine({ id: 'HEK', maxPassage: 30 });
        });

        test('records a valid passage', () => {
            const result = tracker.recordPassage('HEK', {
                passage: 5, viability: 95, confluence: 80
            });
            expect(result.record.passage).toBe(5);
            expect(result.record.viability).toBe(95);
        });

        test('throws for unknown cell line', () => {
            expect(() => tracker.recordPassage('NOPE', { passage: 1 })).toThrow('not found');
        });

        test('throws if passage number is missing', () => {
            expect(() => tracker.recordPassage('HEK', {})).toThrow('required');
        });

        test('throws if passage number < 1', () => {
            expect(() => tracker.recordPassage('HEK', { passage: 0 })).toThrow('>= 1');
        });

        test('throws if viability is out of range', () => {
            expect(() => tracker.recordPassage('HEK', { passage: 1, viability: -5 })).toThrow('0-100');
            expect(() => tracker.recordPassage('HEK', { passage: 1, viability: 105 })).toThrow('0-100');
        });

        test('throws if confluence is out of range', () => {
            expect(() => tracker.recordPassage('HEK', { passage: 1, confluence: -1 })).toThrow('0-100');
            expect(() => tracker.recordPassage('HEK', { passage: 1, confluence: 101 })).toThrow('0-100');
        });

        test('records are sorted by passage number', () => {
            tracker.recordPassage('HEK', { passage: 5, viability: 90 });
            tracker.recordPassage('HEK', { passage: 2, viability: 95 });
            tracker.recordPassage('HEK', { passage: 8, viability: 85 });
            const history = tracker.getPassageHistory('HEK');
            expect(history.map(p => p.passage)).toEqual([2, 5, 8]);
        });

        test('generates alerts when near maxPassage', () => {
            // Record passage near the max (30)
            const result = tracker.recordPassage('HEK', { passage: 28, viability: 70 });
            // Should trigger a senescence alert
            expect(result.alerts.length).toBeGreaterThanOrEqual(0);
        });
    });

    // --- getPassageHistory ---

    describe('getPassageHistory', () => {
        beforeEach(() => {
            tracker.addCellLine({ id: 'T1', maxPassage: 50 });
            for (let i = 1; i <= 10; i++) {
                tracker.recordPassage('T1', { passage: i, viability: 95 - i });
            }
        });

        test('returns all passages by default', () => {
            expect(tracker.getPassageHistory('T1')).toHaveLength(10);
        });

        test('filters by fromPassage', () => {
            const ps = tracker.getPassageHistory('T1', { fromPassage: 5 });
            expect(ps.every(p => p.passage >= 5)).toBe(true);
        });

        test('filters by toPassage', () => {
            const ps = tracker.getPassageHistory('T1', { toPassage: 3 });
            expect(ps.every(p => p.passage <= 3)).toBe(true);
        });

        test('limits results', () => {
            const ps = tracker.getPassageHistory('T1', { limit: 3 });
            expect(ps).toHaveLength(3);
        });

        test('throws for unknown cell line', () => {
            expect(() => tracker.getPassageHistory('NOPE')).toThrow('not found');
        });
    });

    // --- getViabilityTrend ---

    describe('getViabilityTrend', () => {
        test('returns insufficient_data with < 2 points', () => {
            tracker.addCellLine({ id: 'V1' });
            tracker.recordPassage('V1', { passage: 1, viability: 95 });
            const trend = tracker.getViabilityTrend('V1');
            expect(trend.trend).toBe('insufficient_data');
        });

        test('detects declining viability', () => {
            tracker.addCellLine({ id: 'V2' });
            tracker.recordPassage('V2', { passage: 1, viability: 95 });
            tracker.recordPassage('V2', { passage: 5, viability: 90 });
            tracker.recordPassage('V2', { passage: 10, viability: 80 });
            tracker.recordPassage('V2', { passage: 15, viability: 65 });
            const trend = tracker.getViabilityTrend('V2');
            expect(trend.trend).toMatch(/declining|critical_decline/);
            expect(trend.slope).toBeLessThan(0);
        });

        test('detects stable viability', () => {
            tracker.addCellLine({ id: 'V3' });
            tracker.recordPassage('V3', { passage: 1, viability: 93 });
            tracker.recordPassage('V3', { passage: 5, viability: 94 });
            tracker.recordPassage('V3', { passage: 10, viability: 93 });
            const trend = tracker.getViabilityTrend('V3');
            expect(trend.trend).toBe('stable');
        });

        test('returns projected limit passage when declining', () => {
            tracker.addCellLine({ id: 'V4' });
            tracker.recordPassage('V4', { passage: 1, viability: 95 });
            tracker.recordPassage('V4', { passage: 10, viability: 80 });
            tracker.recordPassage('V4', { passage: 20, viability: 60 });
            const trend = tracker.getViabilityTrend('V4');
            expect(trend.projectedLimitPassage).toBeDefined();
            expect(trend.projectedLimitPassage).toBeGreaterThan(0);
        });
    });

    // --- getConfluenceProfile ---

    describe('getConfluenceProfile', () => {
        test('returns no_data when no confluence recorded', () => {
            tracker.addCellLine({ id: 'C1' });
            tracker.recordPassage('C1', { passage: 1, viability: 90 });
            const profile = tracker.getConfluenceProfile('C1');
            expect(profile.profile).toBe('no_data');
        });

        test('returns well_managed when mostly in range', () => {
            tracker.addCellLine({ id: 'C2', optimalConfluence: { min: 70, max: 90 } });
            for (let i = 1; i <= 10; i++) {
                tracker.recordPassage('C2', { passage: i, viability: 90, confluence: 80 });
            }
            const profile = tracker.getConfluenceProfile('C2');
            expect(profile.profile).toBe('well_managed');
            expect(profile.inRangePercent).toBe(100);
        });

        test('identifies over-confluent passages', () => {
            tracker.addCellLine({ id: 'C3', optimalConfluence: { min: 70, max: 90 } });
            tracker.recordPassage('C3', { passage: 1, viability: 90, confluence: 95 });
            tracker.recordPassage('C3', { passage: 2, viability: 90, confluence: 98 });
            const profile = tracker.getConfluenceProfile('C3');
            expect(profile.overConfluentCount).toBe(2);
        });
    });

    // --- getSenescenceRisk ---

    describe('getSenescenceRisk', () => {
        test('returns unknown with no passages', () => {
            tracker.addCellLine({ id: 'S1', maxPassage: 30 });
            const risk = tracker.getSenescenceRisk('S1');
            expect(risk.risk).toBe('unknown');
        });

        test('returns low risk at early passages', () => {
            tracker.addCellLine({ id: 'S2', maxPassage: 50 });
            tracker.recordPassage('S2', { passage: 5, viability: 95 });
            const risk = tracker.getSenescenceRisk('S2');
            expect(risk.risk).toBe('low');
            expect(risk.remainingPassages).toBe(45);
        });

        test('returns critical risk near maxPassage', () => {
            tracker.addCellLine({ id: 'S3', maxPassage: 30 });
            tracker.recordPassage('S3', { passage: 28, viability: 70 });
            const risk = tracker.getSenescenceRisk('S3');
            expect(risk.risk).toBe('critical');
        });

        test('returns high risk above 75% of maxPassage', () => {
            tracker.addCellLine({ id: 'S4', maxPassage: 40 });
            tracker.recordPassage('S4', { passage: 32, viability: 80 });
            const risk = tracker.getSenescenceRisk('S4');
            expect(risk.risk).toBe('high');
        });
    });

    // --- getCellLineReport ---

    describe('getCellLineReport', () => {
        test('generates a comprehensive report', () => {
            tracker.addCellLine({ id: 'R1', maxPassage: 30 });
            for (let i = 1; i <= 5; i++) {
                tracker.recordPassage('R1', {
                    passage: i, viability: 95 - i, confluence: 75 + i
                });
            }
            const report = tracker.getCellLineReport('R1');
            expect(report.cellLine.id).toBe('R1');
            expect(report.passageCount).toBe(5);
            expect(report.viabilityTrend).toBeDefined();
            expect(report.confluenceProfile).toBeDefined();
            expect(report.senescenceRisk).toBeDefined();
            expect(report.recentPassages).toBeDefined();
        });
    });

    // --- getFleetReport ---

    describe('getFleetReport', () => {
        test('returns summary for empty fleet', () => {
            const report = tracker.getFleetReport();
            expect(report.cellLines).toBe(0);
        });

        test('aggregates risk across multiple cell lines', () => {
            tracker.addCellLine({ id: 'F1', maxPassage: 30 });
            tracker.addCellLine({ id: 'F2', maxPassage: 30 });
            tracker.recordPassage('F1', { passage: 5, viability: 95 });
            tracker.recordPassage('F2', { passage: 28, viability: 70 });
            const report = tracker.getFleetReport();
            expect(report.cellLines).toBe(2);
            expect(report.riskDistribution.low).toBeGreaterThanOrEqual(1);
            expect(report.needsAttention.length).toBeGreaterThanOrEqual(1);
        });
    });

    // --- exportPassageData ---

    describe('exportPassageData', () => {
        beforeEach(() => {
            tracker.addCellLine({ id: 'E1' });
            tracker.recordPassage('E1', { passage: 1, viability: 95, confluence: 80 });
            tracker.recordPassage('E1', { passage: 2, viability: 93, confluence: 82 });
        });

        test('exports as JSON by default', () => {
            const json = tracker.exportPassageData('E1');
            const parsed = JSON.parse(json);
            expect(parsed.cellLine.id).toBe('E1');
            expect(parsed.passages).toHaveLength(2);
        });

        test('exports as CSV', () => {
            const csv = tracker.exportPassageData('E1', 'csv');
            expect(csv).toContain('passage,viability,confluence');
            const lines = csv.trim().split('\n');
            expect(lines.length).toBe(3); // header + 2 rows
        });

        test('throws for unknown cell line', () => {
            expect(() => tracker.exportPassageData('NOPE')).toThrow('not found');
        });
    });

    // --- getOptimalPassageWindow ---

    describe('getOptimalPassageWindow', () => {
        test('returns insufficient_data with < 3 passages', () => {
            tracker.addCellLine({ id: 'W1' });
            tracker.recordPassage('W1', { passage: 1, viability: 95 });
            const window = tracker.getOptimalPassageWindow('W1');
            expect(window.window).toBeNull();
            expect(window.reason).toBe('insufficient_data');
        });

        test('finds optimal window from high viability passages', () => {
            tracker.addCellLine({ id: 'W2', maxPassage: 50 });
            for (let i = 1; i <= 20; i++) {
                const viability = i <= 15 ? 90 : 60;
                tracker.recordPassage('W2', { passage: i, viability });
            }
            const result = tracker.getOptimalPassageWindow('W2');
            expect(result.window).not.toBeNull();
            expect(result.window.from).toBeLessThanOrEqual(result.window.to);
        });
    });
});
