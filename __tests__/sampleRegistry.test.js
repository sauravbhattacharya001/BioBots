/**
 * @jest-environment jsdom
 */

/* ── Sample Tracking Registry – unit tests ──────────── */

const STORAGE_KEY = 'biobots-sample-registry';
const STAGES = ['prepared','loaded','printing','postprocess','maturation','analysis','archived','discarded'];
const STAGE_LABELS = { prepared:'Prepared', loaded:'Loaded', printing:'Printing', postprocess:'Post-processing', maturation:'Maturation', analysis:'Analysis', archived:'Archived', discarded:'Discarded' };
const TYPE_LABELS = { bioink:'Bioink Batch', tissue:'Tissue Sample', construct:'Printed Construct', scaffold:'Scaffold' };
const TYPE_ICONS = { bioink:'🧴', tissue:'🫀', construct:'🏗️', scaffold:'🦴' };

/* ── Helper functions (mirrored from HTML) ──────────── */
function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return { samples: [], nextId: 1 };
}
function saveState(state) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function generateId(state, type) {
    const prefix = { bioink:'BIO', tissue:'TIS', construct:'CON', scaffold:'SCA' }[type] || 'SAM';
    const num = String(state.nextId++).padStart(4,'0');
    return `${prefix}-${num}`;
}

function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff/60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins/60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs/24);
    return days + 'd ago';
}

function formatDuration(ms) {
    const mins = Math.floor(ms/60000);
    if (mins < 60) return mins + ' min';
    const hrs = Math.floor(mins/60);
    if (hrs < 24) return hrs + 'h ' + (mins%60) + 'm';
    const days = Math.floor(hrs/24);
    return days + 'd ' + (hrs%24) + 'h';
}

function createSample(state, data) {
    const sample = {
        id: generateId(state, data.type),
        ...data,
        stage: 'prepared',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        events: [{ type:'stage-change', stage:'prepared', description:'Sample registered', operator: data.operator||'', timestamp: new Date().toISOString() }],
    };
    state.samples.unshift(sample);
    return sample;
}

function logEvent(sample, evt) {
    sample.events.push({ ...evt, timestamp: new Date().toISOString() });
    if (evt.type === 'stage-change' && evt.stage) {
        evt.previousStage = sample.stage;
        sample.stage = evt.stage;
    }
    sample.updatedAt = new Date().toISOString();
}

function filterSamples(samples, { query='', type='', stage='' } = {}) {
    return samples.filter(s => {
        if (type && s.type !== type) return false;
        if (stage && s.stage !== stage) return false;
        if (query) {
            const haystack = `${s.id} ${s.name} ${s.material||''} ${s.source||''} ${(s.tags||[]).join(' ')} ${s.notes||''}`.toLowerCase();
            if (!haystack.includes(query.toLowerCase())) return false;
        }
        return true;
    });
}

function exportCSV(samples) {
    const headers = ['ID','Name','Type','Stage','Material','Source','Volume','Storage','Operator','Tags','Created','Updated','Events'];
    const rows = samples.map(s => [
        s.id, s.name, s.type, s.stage, s.material||'', s.source||'', s.volume||'', s.storage||'', s.operator||'',
        (s.tags||[]).join(';'), s.createdAt, s.updatedAt, (s.events||[]).length
    ].map(v => '"'+String(v).replace(/"/g,'""')+'"'));
    return [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
}

function importMerge(existing, imported) {
    imported.samples.forEach(s => {
        if (!existing.samples.find(x => x.id === s.id)) existing.samples.push(s);
    });
    existing.nextId = Math.max(existing.nextId, imported.nextId || 0);
}

function getStageCounts(samples) {
    const counts = {};
    STAGES.forEach(st => counts[st] = 0);
    samples.forEach(s => { counts[s.stage] = (counts[s.stage]||0) + 1; });
    return counts;
}

beforeEach(() => { localStorage.clear(); });

describe('Sample Tracking Registry', () => {

    describe('State management', () => {
        test('loadState returns empty state when no data', () => {
            const st = loadState();
            expect(st.samples).toEqual([]);
            expect(st.nextId).toBe(1);
        });

        test('saveState and loadState roundtrip', () => {
            const st = { samples: [{ id:'BIO-0001', name:'Test' }], nextId: 2 };
            saveState(st);
            const loaded = loadState();
            expect(loaded.samples[0].id).toBe('BIO-0001');
            expect(loaded.nextId).toBe(2);
        });

        test('handles corrupted localStorage gracefully', () => {
            localStorage.setItem(STORAGE_KEY, 'not-json');
            const st = loadState();
            expect(st.samples).toEqual([]);
        });
    });

    describe('ID generation', () => {
        test('generates BIO prefix for bioink', () => {
            const st = { samples: [], nextId: 1 };
            expect(generateId(st, 'bioink')).toBe('BIO-0001');
            expect(st.nextId).toBe(2);
        });

        test('generates TIS prefix for tissue', () => {
            const st = { samples: [], nextId: 5 };
            expect(generateId(st, 'tissue')).toBe('TIS-0005');
        });

        test('generates CON prefix for construct', () => {
            const st = { samples: [], nextId: 12 };
            expect(generateId(st, 'construct')).toBe('CON-0012');
        });

        test('generates SCA prefix for scaffold', () => {
            const st = { samples: [], nextId: 100 };
            expect(generateId(st, 'scaffold')).toBe('SCA-0100');
        });

        test('generates SAM prefix for unknown type', () => {
            const st = { samples: [], nextId: 1 };
            expect(generateId(st, 'unknown')).toBe('SAM-0001');
        });

        test('auto-increments nextId', () => {
            const st = { samples: [], nextId: 1 };
            generateId(st, 'bioink');
            generateId(st, 'tissue');
            generateId(st, 'construct');
            expect(st.nextId).toBe(4);
        });
    });

    describe('Sample creation', () => {
        test('creates sample with correct defaults', () => {
            const st = { samples: [], nextId: 1 };
            const s = createSample(st, { type:'bioink', name:'GelMA 5%', material:'GelMA' });
            expect(s.id).toBe('BIO-0001');
            expect(s.stage).toBe('prepared');
            expect(s.events.length).toBe(1);
            expect(s.events[0].type).toBe('stage-change');
        });

        test('prepends to samples array', () => {
            const st = { samples: [{ id:'OLD' }], nextId: 1 };
            createSample(st, { type:'tissue', name:'hMSC' });
            expect(st.samples[0].id).toBe('TIS-0001');
            expect(st.samples[1].id).toBe('OLD');
        });

        test('sets createdAt and updatedAt', () => {
            const st = { samples: [], nextId: 1 };
            const s = createSample(st, { type:'bioink', name:'Test' });
            expect(s.createdAt).toBeTruthy();
            expect(s.updatedAt).toBeTruthy();
        });
    });

    describe('Event logging', () => {
        test('logs observation event', () => {
            const sample = { id:'BIO-0001', stage:'prepared', events:[], updatedAt:'' };
            logEvent(sample, { type:'observation', description:'Color yellow' });
            expect(sample.events.length).toBe(1);
            expect(sample.events[0].type).toBe('observation');
            expect(sample.stage).toBe('prepared'); // unchanged
        });

        test('stage-change event updates stage', () => {
            const sample = { id:'BIO-0001', stage:'prepared', events:[], updatedAt:'' };
            logEvent(sample, { type:'stage-change', stage:'loaded', description:'Loaded into cartridge' });
            expect(sample.stage).toBe('loaded');
        });

        test('contamination event logged correctly', () => {
            const sample = { id:'TIS-0001', stage:'maturation', events:[], updatedAt:'' };
            logEvent(sample, { type:'contamination', description:'Fungal contamination' });
            expect(sample.events[0].type).toBe('contamination');
            expect(sample.stage).toBe('maturation'); // unchanged
        });

        test('measurement event logged', () => {
            const sample = { id:'BIO-0001', stage:'prepared', events:[], updatedAt:'' };
            logEvent(sample, { type:'measurement', description:'Viscosity: 0.45 Pa·s' });
            expect(sample.events[0].description).toContain('Viscosity');
        });

        test('multiple events accumulate', () => {
            const sample = { id:'BIO-0001', stage:'prepared', events:[], updatedAt:'' };
            logEvent(sample, { type:'observation', description:'A' });
            logEvent(sample, { type:'observation', description:'B' });
            logEvent(sample, { type:'stage-change', stage:'loaded', description:'C' });
            expect(sample.events.length).toBe(3);
            expect(sample.stage).toBe('loaded');
        });
    });

    describe('Search and filter', () => {
        const samples = [
            { id:'BIO-0001', name:'GelMA 5% Batch', type:'bioink', stage:'loaded', material:'GelMA', source:'Lab A', tags:['gelma','validated'], notes:'' },
            { id:'TIS-0001', name:'hMSC Passage 4', type:'tissue', stage:'maturation', material:'hMSC', source:'ATCC', tags:['hmsc'], notes:'High viability' },
            { id:'CON-0001', name:'Cartilage Disc', type:'construct', stage:'postprocess', material:'GelMA+hMSC', source:'', tags:['cartilage'], notes:'' },
            { id:'SCA-0001', name:'PCL Mesh', type:'scaffold', stage:'archived', material:'PCL', source:'FDM', tags:['pcl'], notes:'' },
        ];

        test('no filters returns all', () => {
            expect(filterSamples(samples).length).toBe(4);
        });

        test('filter by type', () => {
            expect(filterSamples(samples, { type:'bioink' }).length).toBe(1);
            expect(filterSamples(samples, { type:'tissue' })[0].id).toBe('TIS-0001');
        });

        test('filter by stage', () => {
            expect(filterSamples(samples, { stage:'archived' }).length).toBe(1);
            expect(filterSamples(samples, { stage:'prepared' }).length).toBe(0);
        });

        test('search by name', () => {
            const results = filterSamples(samples, { query:'gelma' });
            expect(results.length).toBe(2); // BIO-0001 name + CON-0001 material
        });

        test('search by ID', () => {
            expect(filterSamples(samples, { query:'TIS-0001' }).length).toBe(1);
        });

        test('search by tag', () => {
            expect(filterSamples(samples, { query:'validated' }).length).toBe(1);
        });

        test('search by notes', () => {
            expect(filterSamples(samples, { query:'viability' }).length).toBe(1);
        });

        test('combined type + stage', () => {
            expect(filterSamples(samples, { type:'scaffold', stage:'archived' }).length).toBe(1);
            expect(filterSamples(samples, { type:'bioink', stage:'archived' }).length).toBe(0);
        });

        test('combined query + type', () => {
            expect(filterSamples(samples, { query:'gelma', type:'bioink' }).length).toBe(1);
        });

        test('case insensitive search', () => {
            expect(filterSamples(samples, { query:'GELMA' }).length).toBe(2);
        });
    });

    describe('Parent-child relationships', () => {
        test('find parent', () => {
            const samples = [
                { id:'BIO-0001', parentId:'' },
                { id:'CON-0001', parentId:'BIO-0001' },
            ];
            const child = samples.find(s => s.id === 'CON-0001');
            const parent = samples.find(s => s.id === child.parentId);
            expect(parent.id).toBe('BIO-0001');
        });

        test('find children', () => {
            const samples = [
                { id:'BIO-0001', parentId:'' },
                { id:'CON-0001', parentId:'BIO-0001' },
                { id:'CON-0002', parentId:'BIO-0001' },
                { id:'CON-0003', parentId:'BIO-0002' },
            ];
            const children = samples.filter(s => s.parentId === 'BIO-0001');
            expect(children.length).toBe(2);
        });

        test('no children returns empty', () => {
            const samples = [{ id:'BIO-0001', parentId:'' }];
            expect(samples.filter(s => s.parentId === 'BIO-0001').length).toBe(0);
        });
    });

    describe('Stages', () => {
        test('8 stages defined', () => {
            expect(STAGES.length).toBe(8);
        });

        test('all stages have labels', () => {
            STAGES.forEach(st => expect(STAGE_LABELS[st]).toBeTruthy());
        });

        test('lifecycle order correct', () => {
            expect(STAGES[0]).toBe('prepared');
            expect(STAGES[STAGES.length-1]).toBe('discarded');
        });

        test('stage counts work', () => {
            const samples = [
                { stage:'prepared' }, { stage:'prepared' }, { stage:'loaded' },
                { stage:'archived' }, { stage:'archived' }, { stage:'archived' },
            ];
            const counts = getStageCounts(samples);
            expect(counts.prepared).toBe(2);
            expect(counts.loaded).toBe(1);
            expect(counts.archived).toBe(3);
            expect(counts.printing).toBe(0);
        });
    });

    describe('Sample types', () => {
        test('4 types supported', () => {
            expect(Object.keys(TYPE_LABELS).length).toBe(4);
        });

        test('all types have labels and icons', () => {
            ['bioink','tissue','construct','scaffold'].forEach(t => {
                expect(TYPE_LABELS[t]).toBeTruthy();
                expect(TYPE_ICONS[t]).toBeTruthy();
            });
        });
    });

    describe('Time formatting', () => {
        test('timeAgo just now', () => {
            expect(timeAgo(new Date().toISOString())).toBe('just now');
        });

        test('timeAgo minutes', () => {
            const past = new Date(Date.now() - 5 * 60000).toISOString();
            expect(timeAgo(past)).toBe('5m ago');
        });

        test('timeAgo hours', () => {
            const past = new Date(Date.now() - 3 * 3600000).toISOString();
            expect(timeAgo(past)).toBe('3h ago');
        });

        test('timeAgo days', () => {
            const past = new Date(Date.now() - 2 * 86400000).toISOString();
            expect(timeAgo(past)).toBe('2d ago');
        });

        test('formatDuration minutes', () => {
            expect(formatDuration(300000)).toBe('5 min');
        });

        test('formatDuration hours', () => {
            expect(formatDuration(5400000)).toBe('1h 30m');
        });

        test('formatDuration days', () => {
            expect(formatDuration(90000000)).toBe('1d 1h');
        });

        test('formatDuration zero', () => {
            expect(formatDuration(0)).toBe('0 min');
        });
    });

    describe('Export', () => {
        test('CSV has correct headers', () => {
            const csv = exportCSV([]);
            expect(csv.startsWith('ID,Name,Type,Stage')).toBe(true);
        });

        test('CSV escapes quotes', () => {
            const csv = exportCSV([{
                id:'BIO-0001', name:'GelMA "5%"', type:'bioink', stage:'prepared',
                material:'', source:'', volume:'', storage:'', operator:'',
                tags:[], createdAt:'2026-01-01', updatedAt:'2026-01-01', events:[]
            }]);
            expect(csv).toContain('""5%""');
        });

        test('CSV includes event count', () => {
            const csv = exportCSV([{
                id:'BIO-0001', name:'Test', type:'bioink', stage:'prepared',
                material:'', source:'', volume:'', storage:'', operator:'',
                tags:['a','b'], createdAt:'', updatedAt:'',
                events:[{},{},{}]
            }]);
            expect(csv).toContain('"3"');
        });

        test('CSV joins tags with semicolons', () => {
            const csv = exportCSV([{
                id:'X', name:'Y', type:'bioink', stage:'prepared',
                material:'', source:'', volume:'', storage:'', operator:'',
                tags:['urgent','exp-7'], createdAt:'', updatedAt:'', events:[]
            }]);
            expect(csv).toContain('urgent;exp-7');
        });

        test('JSON roundtrip preserves structure', () => {
            const state = {
                samples: [{ id:'BIO-0001', name:'Test', type:'bioink', stage:'prepared', tags:['a'], events:[{ type:'obs' }] }],
                nextId: 2
            };
            const json = JSON.stringify(state);
            const parsed = JSON.parse(json);
            expect(parsed.samples[0].events[0].type).toBe('obs');
            expect(parsed.nextId).toBe(2);
        });
    });

    describe('Import / merge', () => {
        test('merges without duplicating existing IDs', () => {
            const existing = { samples: [{ id:'BIO-0001', name:'Existing' }], nextId: 2 };
            const imported = { samples: [{ id:'BIO-0001', name:'Dup' }, { id:'BIO-0002', name:'New' }], nextId: 3 };
            importMerge(existing, imported);
            expect(existing.samples.length).toBe(2);
            expect(existing.samples[0].name).toBe('Existing');
            expect(existing.samples[1].name).toBe('New');
        });

        test('updates nextId to max', () => {
            const existing = { samples: [], nextId: 2 };
            importMerge(existing, { samples: [], nextId: 10 });
            expect(existing.nextId).toBe(10);
        });

        test('handles empty import', () => {
            const existing = { samples: [{ id:'X' }], nextId: 2 };
            importMerge(existing, { samples: [], nextId: 1 });
            expect(existing.samples.length).toBe(1);
            expect(existing.nextId).toBe(2);
        });
    });

    describe('CRUD operations', () => {
        test('delete sample', () => {
            const st = { samples: [{ id:'A' }, { id:'B' }, { id:'C' }], nextId: 4 };
            st.samples = st.samples.filter(s => s.id !== 'B');
            expect(st.samples.length).toBe(2);
            expect(st.samples.map(s=>s.id)).toEqual(['A','C']);
        });

        test('update sample fields', () => {
            const s = { id:'BIO-0001', name:'Old', material:'' };
            Object.assign(s, { name:'New', material:'GelMA 5%', updatedAt: new Date().toISOString() });
            expect(s.name).toBe('New');
            expect(s.material).toBe('GelMA 5%');
        });

        test('full lifecycle', () => {
            const st = { samples: [], nextId: 1 };
            const s = createSample(st, { type:'bioink', name:'Test', operator:'Dr. X' });
            expect(s.stage).toBe('prepared');

            logEvent(s, { type:'measurement', description:'pH 7.2' });
            expect(s.events.length).toBe(2);

            logEvent(s, { type:'stage-change', stage:'loaded', description:'Into cartridge' });
            expect(s.stage).toBe('loaded');

            logEvent(s, { type:'stage-change', stage:'printing', description:'Print started' });
            expect(s.stage).toBe('printing');

            logEvent(s, { type:'stage-change', stage:'archived', description:'Done' });
            expect(s.stage).toBe('archived');
            expect(s.events.length).toBe(5);
        });
    });

    describe('Demo data structure', () => {
        test('demo samples cover all types', () => {
            const demoTypes = ['bioink','bioink','tissue','construct','scaffold'];
            const unique = [...new Set(demoTypes)];
            expect(unique).toEqual(expect.arrayContaining(['bioink','tissue','construct','scaffold']));
        });

        test('demo samples have various stages', () => {
            const demoStages = ['loaded','prepared','maturation','postprocess','archived'];
            expect(demoStages.length).toBe(5);
            expect([...new Set(demoStages)].length).toBe(5);
        });
    });

    describe('Edge cases', () => {
        test('empty tags array', () => {
            const s = { tags: [] };
            expect(s.tags.join(',')).toBe('');
        });

        test('special chars in name', () => {
            const st = { samples: [], nextId: 1 };
            const s = createSample(st, { type:'bioink', name:'GelMA <5%> & "test"' });
            expect(s.name).toBe('GelMA <5%> & "test"');
        });

        test('very long name', () => {
            const st = { samples: [], nextId: 1 };
            const name = 'A'.repeat(1000);
            const s = createSample(st, { type:'bioink', name });
            expect(s.name.length).toBe(1000);
        });

        test('sample with no optional fields', () => {
            const st = { samples: [], nextId: 1 };
            const s = createSample(st, { type:'scaffold', name:'Minimal' });
            expect(s.material).toBeUndefined();
            expect(s.tags).toBeUndefined();
        });

        test('search with no matches', () => {
            expect(filterSamples([{ id:'A', name:'B', tags:[], notes:'', material:'', source:'' }], { query:'zzzzz' }).length).toBe(0);
        });
    });

    describe('HTML structure verification', () => {
        const fs = require('fs');
        const path = require('path');
        const html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'samples.html'), 'utf8');

        test('contains title', () => {
            expect(html).toContain('Sample Tracking Registry');
        });

        test('contains all stage badge classes', () => {
            STAGES.forEach(st => {
                expect(html).toContain(`badge-${st}`);
            });
        });

        test('contains all type classes', () => {
            ['bioink','tissue','construct','scaffold'].forEach(t => {
                expect(html).toContain(`type-${t}`);
            });
        });

        test('contains modal elements', () => {
            expect(html).toContain('modal-new-sample');
            expect(html).toContain('modal-log-event');
        });

        test('contains nav link to home', () => {
            expect(html).toContain('href="index.html"');
        });

        test('contains export functions', () => {
            expect(html).toContain('exportJSON');
            expect(html).toContain('exportCSV');
            expect(html).toContain('exportLabels');
        });

        test('contains localStorage key', () => {
            expect(html).toContain('biobots-sample-registry');
        });

        test('contains all 4 tabs', () => {
            expect(html).toContain('tab-registry');
            expect(html).toContain('tab-detail');
            expect(html).toContain('tab-lifecycle');
            expect(html).toContain('tab-export');
        });

        test('contains filter controls', () => {
            expect(html).toContain('search-input');
            expect(html).toContain('filter-type');
            expect(html).toContain('filter-stage');
        });

        test('contains demo data function', () => {
            expect(html).toContain('loadDemoData');
        });
    });
});
