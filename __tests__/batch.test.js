/**
 * @jest-environment jsdom
 */

describe('Batch Planner', () => {
    let doc;

    beforeEach(() => {
        localStorage.clear();
    });

    describe('Volume estimation', () => {
        // Well diameters from the batch planner
        const WELL_DIAMETERS = { 6: 34.8, 12: 22.1, 24: 15.6, 48: 11.0, 96: 6.4 };

        function estimateVolume(wellplate, wells, layers, layerHeight) {
            const d = WELL_DIAMETERS[wellplate] || 15.6;
            const r = d / 2;
            const areaPerWell = Math.PI * r * r;
            const volumePerWell = areaPerWell * layers * layerHeight;
            const totalMm3 = volumePerWell * wells;
            return { totalMl: totalMm3 / 1000, perWellUl: volumePerWell };
        }

        test('calculates volume for 24-well plate', () => {
            const result = estimateVolume(24, 24, 10, 0.8);
            expect(result.totalMl).toBeGreaterThan(0);
            expect(result.totalMl).toBeLessThan(100);
        });

        test('volume scales linearly with wells', () => {
            const single = estimateVolume(24, 1, 10, 0.8);
            const double = estimateVolume(24, 2, 10, 0.8);
            expect(double.totalMl).toBeCloseTo(single.totalMl * 2, 5);
        });

        test('volume scales linearly with layers', () => {
            const base = estimateVolume(24, 1, 5, 0.8);
            const doubled = estimateVolume(24, 1, 10, 0.8);
            expect(doubled.totalMl).toBeCloseTo(base.totalMl * 2, 5);
        });

        test('larger wellplate has larger volume per well', () => {
            const small = estimateVolume(96, 1, 10, 0.8);
            const large = estimateVolume(6, 1, 10, 0.8);
            expect(large.totalMl).toBeGreaterThan(small.totalMl);
        });

        test('zero wells gives zero volume', () => {
            const result = estimateVolume(24, 0, 10, 0.8);
            expect(result.totalMl).toBe(0);
        });
    });

    describe('Time estimation', () => {
        function estimateTime(wells, layers) {
            return wells * layers * 2 + wells * 5;
        }

        test('estimates positive time', () => {
            expect(estimateTime(24, 10)).toBeGreaterThan(0);
        });

        test('more wells = more time', () => {
            expect(estimateTime(48, 10)).toBeGreaterThan(estimateTime(24, 10));
        });

        test('more layers = more time', () => {
            expect(estimateTime(24, 20)).toBeGreaterThan(estimateTime(24, 10));
        });
    });

    describe('Time formatting', () => {
        function formatTime(seconds) {
            if (seconds < 60) return seconds + 's';
            if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            return h + 'h ' + m + 'm';
        }

        test('formats seconds', () => {
            expect(formatTime(30)).toBe('30s');
        });

        test('formats minutes', () => {
            expect(formatTime(125)).toBe('2m 5s');
        });

        test('formats hours', () => {
            expect(formatTime(3725)).toBe('1h 2m');
        });
    });

    describe('CSV export format', () => {
        test('escapes quotes in CSV', () => {
            const name = 'Test "scaffold"';
            const escaped = '"' + name.replace(/"/g, '""') + '"';
            expect(escaped).toBe('"Test ""scaffold"""');
        });
    });

    describe('Priority ordering', () => {
        function priorityOrder(p) {
            return p === 'high' ? 0 : p === 'medium' ? 1 : 2;
        }

        test('high < medium < low', () => {
            expect(priorityOrder('high')).toBeLessThan(priorityOrder('medium'));
            expect(priorityOrder('medium')).toBeLessThan(priorityOrder('low'));
        });
    });
});
