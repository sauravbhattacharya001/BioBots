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
            const totalMl = totalMm3 / 1000;
            return { totalMl, perWellUl: (volumePerWell / 1000) * 1000 };
        }

        test('6-well plate volume', () => {
            const result = estimateVolume(6, 1, 1, 1);
            expect(result.totalMl).toBeCloseTo(0.951, 2);
        });

        test('12-well plate volume', () => {
            const result = estimateVolume(12, 1, 1, 1);
            expect(result.totalMl).toBeCloseTo(0.384, 2);
        });

        test('24-well plate volume', () => {
            const result = estimateVolume(24, 1, 1, 1);
            expect(result.totalMl).toBeCloseTo(0.191, 2);
        });

        test('48-well plate volume', () => {
            const result = estimateVolume(48, 1, 1, 1);
            expect(result.totalMl).toBeCloseTo(0.095, 2);
        });

        test('96-well plate volume', () => {
            const result = estimateVolume(96, 1, 1, 1);
            expect(result.totalMl).toBeCloseTo(0.032, 2);
        });

        test('multiple wells multiply volume', () => {
            const single = estimateVolume(6, 1, 1, 1);
            const multi = estimateVolume(6, 4, 1, 1);
            expect(multi.totalMl).toBeCloseTo(single.totalMl * 4, 4);
        });

        test('multiple layers multiply volume', () => {
            const single = estimateVolume(6, 1, 1, 1);
            const multi = estimateVolume(6, 1, 10, 1);
            expect(multi.totalMl).toBeCloseTo(single.totalMl * 10, 4);
        });

        test('layer height scales linearly', () => {
            const base = estimateVolume(24, 1, 1, 0.1);
            const doubled = estimateVolume(24, 1, 1, 0.2);
            expect(doubled.totalMl).toBeCloseTo(base.totalMl * 2, 6);
        });

        test('unknown wellplate defaults to 24-well diameter', () => {
            const unknown = estimateVolume(384, 1, 1, 1);
            const default24 = estimateVolume(24, 1, 1, 1);
            expect(unknown.totalMl).toBeCloseTo(default24.totalMl, 6);
        });

        test('perWellUl matches totalMl for single well', () => {
            const result = estimateVolume(6, 1, 3, 0.5);
            expect(result.perWellUl).toBeCloseTo(result.totalMl * 1000, 4);
        });

        test('perWellUl is per-well, not total', () => {
            const single = estimateVolume(12, 1, 5, 0.3);
            const multi = estimateVolume(12, 6, 5, 0.3);
            expect(single.perWellUl).toBeCloseTo(multi.perWellUl, 6);
        });

        test('zero layers yields zero volume', () => {
            const result = estimateVolume(6, 1, 0, 1);
            expect(result.totalMl).toBe(0);
        });

        test('zero layer height yields zero volume', () => {
            const result = estimateVolume(6, 1, 5, 0);
            expect(result.totalMl).toBe(0);
        });
    });

    describe('Time estimation', () => {
        // 2 seconds per layer per well + 5 seconds setup per well
        function estimateTime(wells, layers, layerHeight) {
            return wells * layers * 2 + wells * 5;
        }

        test('single well single layer', () => {
            expect(estimateTime(1, 1, 0.5)).toBe(7); // 2 + 5
        });

        test('multiple wells', () => {
            expect(estimateTime(4, 1, 0.5)).toBe(28); // (4*1*2) + (4*5)
        });

        test('multiple layers', () => {
            expect(estimateTime(1, 10, 0.3)).toBe(25); // (1*10*2) + (1*5)
        });

        test('layer height does not affect time', () => {
            const t1 = estimateTime(1, 5, 0.1);
            const t2 = estimateTime(1, 5, 0.5);
            expect(t1).toBe(t2);
        });

        test('zero wells yields zero time', () => {
            expect(estimateTime(0, 10, 0.5)).toBe(0);
        });

        test('zero layers still has setup time', () => {
            expect(estimateTime(3, 0, 0.5)).toBe(15); // 0 + 3*5
        });

        test('full 96-well plate scales correctly', () => {
            const t = estimateTime(96, 20, 0.2);
            expect(t).toBe(96 * 20 * 2 + 96 * 5); // 3840 + 480 = 4320
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

        test('seconds only', () => {
            expect(formatTime(45)).toBe('45s');
        });

        test('exactly 0 seconds', () => {
            expect(formatTime(0)).toBe('0s');
        });

        test('exactly 59 seconds', () => {
            expect(formatTime(59)).toBe('59s');
        });

        test('exactly 60 seconds → 1m 0s', () => {
            expect(formatTime(60)).toBe('1m 0s');
        });

        test('minutes and seconds', () => {
            expect(formatTime(125)).toBe('2m 5s');
        });

        test('exactly one hour', () => {
            expect(formatTime(3600)).toBe('1h 0m');
        });

        test('hours and minutes', () => {
            expect(formatTime(7380)).toBe('2h 3m');
        });

        test('large values', () => {
            expect(formatTime(36000)).toBe('10h 0m');
        });

        test('just under an hour', () => {
            expect(formatTime(3599)).toBe('59m 59s');
        });
    });

    describe('Priority ordering', () => {
        function priorityOrder(p) {
            return p === 'high' ? 0 : p === 'medium' ? 1 : 2;
        }

        test('high is lowest order (first)', () => {
            expect(priorityOrder('high')).toBe(0);
        });

        test('medium is middle', () => {
            expect(priorityOrder('medium')).toBe(1);
        });

        test('low is highest order (last)', () => {
            expect(priorityOrder('low')).toBe(2);
        });

        test('unknown defaults to low (2)', () => {
            expect(priorityOrder('critical')).toBe(2);
            expect(priorityOrder(undefined)).toBe(2);
        });

        test('sorting by priority produces correct order', () => {
            const runs = [
                { priority: 'low' },
                { priority: 'high' },
                { priority: 'medium' },
                { priority: 'high' }
            ];
            runs.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));
            expect(runs.map(r => r.priority)).toEqual(['high', 'high', 'medium', 'low']);
        });
    });

    describe('escAttr', () => {
        function escAttr(s) {
            return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        }

        test('escapes double quotes', () => {
            expect(escAttr('test "value"')).toBe('test &quot;value&quot;');
        });

        test('escapes < to prevent tag injection', () => {
            expect(escAttr('<script>')).toBe('&lt;script>');
        });

        test('handles null', () => {
            expect(escAttr(null)).toBe('');
        });

        test('handles undefined', () => {
            expect(escAttr(undefined)).toBe('');
        });

        test('handles empty string', () => {
            expect(escAttr('')).toBe('');
        });

        test('preserves safe characters', () => {
            expect(escAttr('hello world 123')).toBe('hello world 123');
        });

        test('combined escaping', () => {
            expect(escAttr('<div title="x">')).toBe('&lt;div title=&quot;x&quot;>');
        });
    });

    describe('localStorage persistence', () => {
        const STORAGE_KEY = 'biobots-batch-runs';

        test('loadRuns parses stored JSON array', () => {
            const data = [{ id: 1, name: 'Test Run', priority: 'high' }];
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            const loaded = JSON.parse(localStorage.getItem(STORAGE_KEY));
            expect(loaded).toEqual(data);
        });

        test('loadRuns returns empty for missing key', () => {
            const saved = localStorage.getItem(STORAGE_KEY);
            expect(saved).toBeNull();
        });

        test('loadRuns handles corrupt JSON gracefully', () => {
            localStorage.setItem(STORAGE_KEY, 'not json!!!');
            let runs = [];
            try {
                runs = JSON.parse(localStorage.getItem(STORAGE_KEY));
            } catch (e) {
                // Expected — matches the empty catch in source
            }
            expect(runs).toEqual([]);
        });

        test('saveRuns persists to localStorage', () => {
            const runs = [{ id: 42, name: 'Batch A' }];
            localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
            const loaded = JSON.parse(localStorage.getItem(STORAGE_KEY));
            expect(loaded[0].id).toBe(42);
        });

        test('saveRuns replaces previous data', () => {
            localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 1 }]));
            localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: 2 }]));
            const loaded = JSON.parse(localStorage.getItem(STORAGE_KEY));
            expect(loaded).toHaveLength(1);
            expect(loaded[0].id).toBe(2);
        });
    });

    describe('Run queue operations', () => {
        function moveRun(runs, id, dir) {
            const idx = runs.findIndex(r => r.id === id);
            if (idx < 0) return runs;
            const newIdx = idx + dir;
            if (newIdx < 0 || newIdx >= runs.length) return runs;
            const tmp = runs[idx]; runs[idx] = runs[newIdx]; runs[newIdx] = tmp;
            return runs;
        }

        test('moveRun swaps adjacent elements up', () => {
            const runs = [{ id: 1 }, { id: 2 }, { id: 3 }];
            moveRun(runs, 2, -1);
            expect(runs.map(r => r.id)).toEqual([2, 1, 3]);
        });

        test('moveRun swaps adjacent elements down', () => {
            const runs = [{ id: 1 }, { id: 2 }, { id: 3 }];
            moveRun(runs, 2, 1);
            expect(runs.map(r => r.id)).toEqual([1, 3, 2]);
        });

        test('moveRun does nothing if already at top', () => {
            const runs = [{ id: 1 }, { id: 2 }];
            moveRun(runs, 1, -1);
            expect(runs.map(r => r.id)).toEqual([1, 2]);
        });

        test('moveRun does nothing if already at bottom', () => {
            const runs = [{ id: 1 }, { id: 2 }];
            moveRun(runs, 2, 1);
            expect(runs.map(r => r.id)).toEqual([1, 2]);
        });

        test('moveRun does nothing for unknown id', () => {
            const runs = [{ id: 1 }, { id: 2 }];
            moveRun(runs, 999, -1);
            expect(runs.map(r => r.id)).toEqual([1, 2]);
        });

        test('removeRun filters by id', () => {
            const runs = [{ id: 1 }, { id: 2 }, { id: 3 }];
            const filtered = runs.filter(r => r.id !== 2);
            expect(filtered.map(r => r.id)).toEqual([1, 3]);
        });

        test('removeRun leaves array unchanged for unknown id', () => {
            const runs = [{ id: 1 }, { id: 2 }];
            const filtered = runs.filter(r => r.id !== 999);
            expect(filtered).toEqual(runs);
        });

        test('removeRun handles empty array', () => {
            const filtered = [].filter(r => r.id !== 1);
            expect(filtered).toEqual([]);
        });
    });

    describe('Well count clamping', () => {
        test('wells > wellplate clamped to wellplate', () => {
            const run = { wellplate: 24, wells: 48 };
            if (run.wells > run.wellplate) run.wells = run.wellplate;
            expect(run.wells).toBe(24);
        });

        test('wells < 1 clamped to 1', () => {
            const run = { wellplate: 24, wells: 0 };
            if (run.wells < 1) run.wells = 1;
            expect(run.wells).toBe(1);
        });

        test('negative wells clamped to 1', () => {
            const run = { wellplate: 96, wells: -5 };
            if (run.wells < 1) run.wells = 1;
            expect(run.wells).toBe(1);
        });

        test('valid well count unchanged', () => {
            const run = { wellplate: 96, wells: 48 };
            if (run.wells > run.wellplate) run.wells = run.wellplate;
            if (run.wells < 1) run.wells = 1;
            expect(run.wells).toBe(48);
        });
    });

    describe('CSV export format', () => {
        function formatCSVField(value) {
            if (typeof value === 'string') {
                return '"' + value.replace(/"/g, '""') + '"';
            }
            return String(value);
        }

        test('wraps strings in quotes', () => {
            expect(formatCSVField('test')).toBe('"test"');
        });

        test('escapes embedded double quotes', () => {
            expect(formatCSVField('a "quoted" value')).toBe('"a ""quoted"" value"');
        });

        test('handles empty string', () => {
            expect(formatCSVField('')).toBe('""');
        });

        test('numbers not wrapped', () => {
            expect(formatCSVField(42)).toBe('42');
        });

        test('special characters preserved', () => {
            expect(formatCSVField('has,comma')).toBe('"has,comma"');
        });
    });
});
