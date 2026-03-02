/**
 * @jest-environment jsdom
 */

describe('Protocol Library', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    const STORAGE_KEY = 'biobots_protocols';

    function loadProtocols() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    function saveProtocols(protocols) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(protocols));
    }

    function generateId() {
        return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
    }

    function makeProtocol(overrides = {}) {
        return {
            id: generateId(),
            name: 'Test Protocol',
            tags: ['gelma', 'cartilage'],
            wellplate: '24',
            layerHeight: 0.8,
            layerNum: 10,
            extruder1: 30,
            extruder2: 45,
            clDuration: 5000,
            clIntensity: 50,
            livePercent: 72.5,
            deadPercent: 27.5,
            elasticity: 15.3,
            notes: 'Standard protocol',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            ...overrides,
        };
    }

    // ── Storage ────────────────────────────────────────────────

    describe('Storage', () => {
        test('loadProtocols returns empty array when no data', () => {
            expect(loadProtocols()).toEqual([]);
        });

        test('saveProtocols and loadProtocols round-trip', () => {
            const protocols = [makeProtocol({ name: 'A' }), makeProtocol({ name: 'B' })];
            saveProtocols(protocols);
            const loaded = loadProtocols();
            expect(loaded).toHaveLength(2);
            expect(loaded[0].name).toBe('A');
            expect(loaded[1].name).toBe('B');
        });

        test('loadProtocols handles corrupted JSON gracefully', () => {
            localStorage.setItem(STORAGE_KEY, 'not-json{{{');
            expect(loadProtocols()).toEqual([]);
        });

        test('saveProtocols overwrites previous data', () => {
            saveProtocols([makeProtocol({ name: 'First' })]);
            saveProtocols([makeProtocol({ name: 'Second' })]);
            const loaded = loadProtocols();
            expect(loaded).toHaveLength(1);
            expect(loaded[0].name).toBe('Second');
        });
    });

    // ── ID generation ──────────────────────────────────────────

    describe('generateId', () => {
        test('returns a string', () => {
            expect(typeof generateId()).toBe('string');
        });

        test('starts with p_', () => {
            expect(generateId().startsWith('p_')).toBe(true);
        });

        test('generates unique IDs', () => {
            const ids = new Set();
            for (let i = 0; i < 100; i++) ids.add(generateId());
            expect(ids.size).toBe(100);
        });
    });

    // ── Protocol model ─────────────────────────────────────────

    describe('Protocol model', () => {
        test('makeProtocol creates valid protocol', () => {
            const p = makeProtocol();
            expect(p.name).toBe('Test Protocol');
            expect(p.tags).toEqual(['gelma', 'cartilage']);
            expect(p.wellplate).toBe('24');
            expect(p.layerHeight).toBe(0.8);
            expect(p.livePercent).toBe(72.5);
        });

        test('overrides work', () => {
            const p = makeProtocol({ name: 'Custom', layerNum: 20 });
            expect(p.name).toBe('Custom');
            expect(p.layerNum).toBe(20);
        });

        test('supports null outcomes', () => {
            const p = makeProtocol({ livePercent: null, deadPercent: null, elasticity: null });
            expect(p.livePercent).toBeNull();
            expect(p.deadPercent).toBeNull();
            expect(p.elasticity).toBeNull();
        });
    });

    // ── Tag parsing ────────────────────────────────────────────

    describe('Tag parsing', () => {
        function parseTags(input) {
            return input.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        }

        test('parses comma-separated tags', () => {
            expect(parseTags('gelma, cartilage, high-viability')).toEqual([
                'gelma', 'cartilage', 'high-viability'
            ]);
        });

        test('handles empty string', () => {
            expect(parseTags('')).toEqual([]);
        });

        test('trims whitespace', () => {
            expect(parseTags('  tag1 ,  tag2  ')).toEqual(['tag1', 'tag2']);
        });

        test('lowercases tags', () => {
            expect(parseTags('GelMA, CARTILAGE')).toEqual(['gelma', 'cartilage']);
        });

        test('filters empty entries from trailing comma', () => {
            expect(parseTags('a, b, ')).toEqual(['a', 'b']);
        });
    });

    // ── Sorting ────────────────────────────────────────────────

    describe('Sorting', () => {
        function sortProtocols(protocols, sortBy) {
            return [...protocols].sort((a, b) => {
                switch (sortBy) {
                    case 'oldest': return (a.createdAt || 0) - (b.createdAt || 0);
                    case 'name': return (a.name || '').localeCompare(b.name || '');
                    case 'viability': return (b.livePercent || 0) - (a.livePercent || 0);
                    case 'elasticity': return (b.elasticity || 0) - (a.elasticity || 0);
                    default: return (b.createdAt || 0) - (a.createdAt || 0);
                }
            });
        }

        const protos = [
            makeProtocol({ name: 'Beta', createdAt: 100, livePercent: 50, elasticity: 10 }),
            makeProtocol({ name: 'Alpha', createdAt: 200, livePercent: 80, elasticity: 5 }),
            makeProtocol({ name: 'Gamma', createdAt: 150, livePercent: 65, elasticity: 20 }),
        ];

        test('newest first (default)', () => {
            const sorted = sortProtocols(protos, 'newest');
            expect(sorted[0].name).toBe('Alpha');
            expect(sorted[2].name).toBe('Beta');
        });

        test('oldest first', () => {
            const sorted = sortProtocols(protos, 'oldest');
            expect(sorted[0].name).toBe('Beta');
        });

        test('name A-Z', () => {
            const sorted = sortProtocols(protos, 'name');
            expect(sorted.map(p => p.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
        });

        test('best viability first', () => {
            const sorted = sortProtocols(protos, 'viability');
            expect(sorted[0].livePercent).toBe(80);
            expect(sorted[2].livePercent).toBe(50);
        });

        test('best elasticity first', () => {
            const sorted = sortProtocols(protos, 'elasticity');
            expect(sorted[0].elasticity).toBe(20);
        });
    });

    // ── Filtering ──────────────────────────────────────────────

    describe('Filtering', () => {
        function filterProtocols(protocols, search, filterTag) {
            return protocols.filter(p => {
                if (filterTag && !(p.tags || []).includes(filterTag)) return false;
                if (search) {
                    const haystack = [p.name, p.notes || '', ...(p.tags || [])].join(' ').toLowerCase();
                    return haystack.includes(search.toLowerCase());
                }
                return true;
            });
        }

        const protos = [
            makeProtocol({ name: 'GelMA Standard', tags: ['gelma', 'bone'], notes: 'Works well' }),
            makeProtocol({ name: 'Alginate Mix', tags: ['alginate'], notes: 'Needs tuning' }),
            makeProtocol({ name: 'PEGDA Cross', tags: ['pegda', 'bone'], notes: '' }),
        ];

        test('no filter returns all', () => {
            expect(filterProtocols(protos, '', '')).toHaveLength(3);
        });

        test('search by name', () => {
            const result = filterProtocols(protos, 'alginate', '');
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Alginate Mix');
        });

        test('search by tag content', () => {
            const result = filterProtocols(protos, 'pegda', '');
            expect(result).toHaveLength(1);
        });

        test('search by notes', () => {
            const result = filterProtocols(protos, 'tuning', '');
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Alginate Mix');
        });

        test('filter by tag', () => {
            const result = filterProtocols(protos, '', 'bone');
            expect(result).toHaveLength(2);
        });

        test('search + tag filter combined', () => {
            const result = filterProtocols(protos, 'gelma', 'bone');
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('GelMA Standard');
        });

        test('case insensitive search', () => {
            const result = filterProtocols(protos, 'GELMA', '');
            expect(result).toHaveLength(1);
        });

        test('no match returns empty', () => {
            expect(filterProtocols(protos, 'nonexistent', '')).toHaveLength(0);
        });
    });

    // ── Compare logic ──────────────────────────────────────────

    describe('Compare', () => {
        function findBestWorst(protocols, param, higherBetter) {
            const values = protocols.map(p => p[param]).filter(v => v != null);
            if (values.length < 2) return { bestIdx: -1, worstIdx: -1 };

            const sorted = [...values].sort((a, b) => a - b);
            const best = higherBetter ? sorted[sorted.length - 1] : sorted[0];
            const worst = higherBetter ? sorted[0] : sorted[sorted.length - 1];
            return {
                bestIdx: protocols.findIndex(p => p[param] === best),
                worstIdx: protocols.findIndex(p => p[param] === worst),
            };
        }

        const protos = [
            makeProtocol({ livePercent: 80, deadPercent: 20, elasticity: 10 }),
            makeProtocol({ livePercent: 60, deadPercent: 40, elasticity: 25 }),
            makeProtocol({ livePercent: 90, deadPercent: 10, elasticity: 15 }),
        ];

        test('finds best viability (higher is better)', () => {
            const { bestIdx } = findBestWorst(protos, 'livePercent', true);
            expect(protos[bestIdx].livePercent).toBe(90);
        });

        test('finds worst viability', () => {
            const { worstIdx } = findBestWorst(protos, 'livePercent', true);
            expect(protos[worstIdx].livePercent).toBe(60);
        });

        test('finds best dead percent (lower is better)', () => {
            const { bestIdx } = findBestWorst(protos, 'deadPercent', false);
            expect(protos[bestIdx].deadPercent).toBe(10);
        });

        test('finds best elasticity (higher is better)', () => {
            const { bestIdx } = findBestWorst(protos, 'elasticity', true);
            expect(protos[bestIdx].elasticity).toBe(25);
        });

        test('handles null values gracefully', () => {
            const withNulls = [
                makeProtocol({ livePercent: null }),
                makeProtocol({ livePercent: 70 }),
            ];
            const { bestIdx, worstIdx } = findBestWorst(withNulls, 'livePercent', true);
            // Only 1 non-null value, so can't determine best/worst
            expect(bestIdx).toBe(-1);
            expect(worstIdx).toBe(-1);
        });

        test('returns -1 when fewer than 2 values', () => {
            const single = [makeProtocol({ livePercent: null })];
            const { bestIdx } = findBestWorst(single, 'livePercent', true);
            expect(bestIdx).toBe(-1);
        });
    });

    // ── CSV export ─────────────────────────────────────────────

    describe('CSV export', () => {
        function protocolToCSVRow(p, fields) {
            return fields.map(f => {
                const v = p[f];
                if (v == null) return '';
                const s = String(v);
                return s.includes(',') || s.includes('"') || s.includes('\n')
                    ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(',');
        }

        test('basic fields export correctly', () => {
            const p = makeProtocol({ name: 'Test', layerHeight: 0.8, livePercent: 72.5 });
            const row = protocolToCSVRow(p, ['name', 'layerHeight', 'livePercent']);
            expect(row).toBe('Test,0.8,72.5');
        });

        test('null values become empty', () => {
            const p = makeProtocol({ livePercent: null });
            const row = protocolToCSVRow(p, ['livePercent']);
            expect(row).toBe('');
        });

        test('commas in notes are escaped', () => {
            const p = makeProtocol({ notes: 'first, second' });
            const row = protocolToCSVRow(p, ['notes']);
            expect(row).toBe('"first, second"');
        });

        test('quotes in notes are doubled', () => {
            const p = makeProtocol({ notes: 'used "high" pressure' });
            const row = protocolToCSVRow(p, ['notes']);
            expect(row).toBe('"used ""high"" pressure"');
        });

        test('newlines in notes are escaped', () => {
            const p = makeProtocol({ notes: 'line1\nline2' });
            const row = protocolToCSVRow(p, ['notes']);
            expect(row).toBe('"line1\nline2"');
        });
    });

    // ── HTML escaping ──────────────────────────────────────────

    describe('HTML escaping', () => {
        const _esc = document.createElement('div');
        function escapeHtml(str) {
            if (str == null) return '';
            _esc.textContent = String(str);
            return _esc.innerHTML;
        }

        test('escapes angle brackets', () => {
            expect(escapeHtml('<script>alert(1)</script>')).not.toContain('<script>');
        });

        test('escapes ampersands', () => {
            expect(escapeHtml('A & B')).toBe('A &amp; B');
        });

        test('handles null', () => {
            expect(escapeHtml(null)).toBe('');
        });

        test('handles numbers', () => {
            expect(escapeHtml(42)).toBe('42');
        });
    });

    // ── Tag classification ─────────────────────────────────────

    describe('Tag classification', () => {
        function tagClass(tag) {
            if (tag.includes('bio')) return 'tag-bio';
            if (tag.includes('hydrogel') || tag.includes('gel')) return 'tag-hydrogel';
            if (tag.includes('scaffold')) return 'tag-scaffold';
            return 'tag-custom';
        }

        test('bio tags get tag-bio', () => {
            expect(tagClass('bioink')).toBe('tag-bio');
            expect(tagClass('bio-compatible')).toBe('tag-bio');
        });

        test('gel/hydrogel tags get tag-hydrogel', () => {
            expect(tagClass('gelma')).toBe('tag-hydrogel');
            expect(tagClass('hydrogel')).toBe('tag-hydrogel');
        });

        test('scaffold tags get tag-scaffold', () => {
            expect(tagClass('scaffold')).toBe('tag-scaffold');
        });

        test('other tags get tag-custom', () => {
            expect(tagClass('cartilage')).toBe('tag-custom');
            expect(tagClass('high-viability')).toBe('tag-custom');
        });
    });

    // ── Outcome bar calculations ───────────────────────────────

    describe('Outcome bar', () => {
        function calcBarPercent(value, max) {
            return Math.min(100, (value / max) * 100);
        }

        test('0 value gives 0%', () => {
            expect(calcBarPercent(0, 100)).toBe(0);
        });

        test('50 of 100 gives 50%', () => {
            expect(calcBarPercent(50, 100)).toBe(50);
        });

        test('caps at 100%', () => {
            expect(calcBarPercent(150, 100)).toBe(100);
        });

        test('elasticity scale uses 200 max', () => {
            expect(calcBarPercent(100, 200)).toBe(50);
        });
    });

    // ── Stats computation ──────────────────────────────────────

    describe('Stats', () => {
        function computeLibraryStats(protocols) {
            const total = protocols.length;
            const withOutcomes = protocols.filter(p => p.livePercent != null).length;
            const tags = new Set();
            protocols.forEach(p => (p.tags || []).forEach(t => tags.add(t)));

            let avgViability = null;
            if (withOutcomes > 0) {
                const sum = protocols.reduce((s, p) => s + (p.livePercent || 0), 0);
                avgViability = sum / withOutcomes;
            }
            return { total, withOutcomes, tagCount: tags.size, avgViability };
        }

        test('empty library', () => {
            const stats = computeLibraryStats([]);
            expect(stats.total).toBe(0);
            expect(stats.withOutcomes).toBe(0);
            expect(stats.tagCount).toBe(0);
            expect(stats.avgViability).toBeNull();
        });

        test('with protocols and outcomes', () => {
            const protos = [
                makeProtocol({ livePercent: 80, tags: ['a', 'b'] }),
                makeProtocol({ livePercent: 60, tags: ['b', 'c'] }),
                makeProtocol({ livePercent: null, tags: ['a'] }),
            ];
            const stats = computeLibraryStats(protos);
            expect(stats.total).toBe(3);
            expect(stats.withOutcomes).toBe(2);
            expect(stats.tagCount).toBe(3);
            expect(stats.avgViability).toBe(70);
        });

        test('deduplicates tags across protocols', () => {
            const protos = [
                makeProtocol({ tags: ['gelma', 'bone'] }),
                makeProtocol({ tags: ['gelma', 'cartilage'] }),
            ];
            const stats = computeLibraryStats(protos);
            expect(stats.tagCount).toBe(3);
        });
    });

    // ── CRUD integration ───────────────────────────────────────

    describe('CRUD integration', () => {
        test('create and retrieve protocol', () => {
            const p = makeProtocol({ name: 'My Protocol' });
            saveProtocols([p]);
            const loaded = loadProtocols();
            expect(loaded[0].name).toBe('My Protocol');
        });

        test('update protocol in place', () => {
            const p = makeProtocol({ name: 'Original' });
            saveProtocols([p]);

            const protocols = loadProtocols();
            protocols[0].name = 'Updated';
            saveProtocols(protocols);

            expect(loadProtocols()[0].name).toBe('Updated');
        });

        test('delete protocol by ID', () => {
            const p1 = makeProtocol({ id: 'keep' });
            const p2 = makeProtocol({ id: 'remove' });
            saveProtocols([p1, p2]);

            const filtered = loadProtocols().filter(p => p.id !== 'remove');
            saveProtocols(filtered);

            expect(loadProtocols()).toHaveLength(1);
            expect(loadProtocols()[0].id).toBe('keep');
        });

        test('handles many protocols', () => {
            const many = Array.from({ length: 50 }, (_, i) =>
                makeProtocol({ name: `Proto ${i}`, id: `id_${i}` }));
            saveProtocols(many);
            expect(loadProtocols()).toHaveLength(50);
        });
    });
});
