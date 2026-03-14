'use strict';

const assert = require('assert');
const { createExperimentTracker } = require('../Try/scripts/experimentTracker');

describe('Experiment Tracker', () => {

    let tracker;

    const BASIC_CONFIG = {
        title: 'Effect of nozzle diameter on cell viability',
        hypothesis: {
            statement: 'Larger nozzles reduce shear stress and improve viability',
            prediction: 'Viability > 90% with 0.4mm nozzle'
        },
        variables: {
            independent: [{ name: 'nozzle_diameter', unit: 'mm', values: [0.2, 0.3, 0.4] }],
            dependent:   [{ name: 'cell_viability', unit: '%' }],
            controlled:  [{ name: 'temperature', unit: '°C', value: 37 }]
        }
    };

    beforeEach(() => {
        tracker = createExperimentTracker();
    });

    // ── Creation ────────────────────────────────────────────────

    describe('create', () => {
        it('creates an experiment with a valid ID', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.ok(exp.id.startsWith('EXP-'));
        });

        it('starts in draft state', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.strictEqual(exp.state, 'draft');
        });

        it('requires a title', () => {
            assert.throws(() => tracker.create({ hypothesis: { statement: 'x' }, variables: { dependent: [{ name: 'y' }] } }),
                /title is required/);
        });

        it('requires a hypothesis statement', () => {
            assert.throws(() => tracker.create({ title: 'Test', hypothesis: {}, variables: { dependent: [{ name: 'y' }] } }),
                /Hypothesis statement is required/);
        });

        it('requires variables', () => {
            assert.throws(() => tracker.create({ title: 'Test', hypothesis: { statement: 'x' } }),
                /Variables definition is required/);
        });

        it('rejects duplicate variable names', () => {
            assert.throws(() => tracker.create({
                title: 'Test',
                hypothesis: { statement: 'x' },
                variables: {
                    independent: [{ name: 'a' }, { name: 'a' }],
                    dependent: [{ name: 'y' }]
                }
            }), /Duplicate independent variable name/);
        });

        it('requires controlled variables to have a value', () => {
            assert.throws(() => tracker.create({
                title: 'Test',
                hypothesis: { statement: 'x' },
                variables: {
                    dependent: [{ name: 'y' }],
                    controlled: [{ name: 'temp' }]
                }
            }), /must have a value/);
        });

        it('requires at least one independent or dependent variable', () => {
            assert.throws(() => tracker.create({
                title: 'Test',
                hypothesis: { statement: 'x' },
                variables: {}
            }), /At least one/);
        });

        it('accepts tags on creation', () => {
            const config = Object.assign({}, BASIC_CONFIG, { tags: ['viability', 'nozzle'] });
            const exp = tracker.create(config);
            const summary = exp.getSummary();
            assert.deepStrictEqual(summary.tags, ['viability', 'nozzle']);
        });

        it('increments IDs', () => {
            const e1 = tracker.create(BASIC_CONFIG);
            const e2 = tracker.create(BASIC_CONFIG);
            assert.notStrictEqual(e1.id, e2.id);
        });
    });

    // ── State Transitions ───────────────────────────────────────

    describe('state transitions', () => {
        it('transitions from draft to running via start()', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.start();
            assert.strictEqual(exp.state, 'running');
        });

        it('transitions from running to completed', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.start();
            exp.complete();
            assert.strictEqual(exp.state, 'completed');
        });

        it('transitions from running to failed', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.start();
            exp.fail('Equipment malfunction');
            assert.strictEqual(exp.state, 'failed');
        });

        it('transitions from draft to cancelled', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.cancel('Superseded by new protocol');
            assert.strictEqual(exp.state, 'cancelled');
        });

        it('transitions from running to cancelled', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.start();
            exp.cancel('Budget cut');
            assert.strictEqual(exp.state, 'cancelled');
        });

        it('rejects invalid transitions', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.start();
            exp.complete();
            assert.throws(() => exp.start(), /Can only start/);
        });

        it('rejects modification of completed experiment', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.start();
            exp.complete();
            assert.throws(() => exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 85 }),
                /cannot be modified/i);
        });
    });

    // ── Trials ──────────────────────────────────────────────────

    describe('addTrial', () => {
        it('adds a trial with inputs and outputs', () => {
            const exp = tracker.create(BASIC_CONFIG);
            const result = exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72.5 });
            assert.strictEqual(result.trialNumber, 1);
        });

        it('auto-starts experiment on first trial', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.strictEqual(exp.state, 'draft');
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72.5 });
            assert.strictEqual(exp.state, 'running');
        });

        it('rejects unknown independent variables', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.throws(() => exp.addTrial({ unknown_var: 1 }, { cell_viability: 50 }),
                /Unknown independent variable/);
        });

        it('rejects unknown dependent variables', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.throws(() => exp.addTrial({ nozzle_diameter: 0.2 }, { unknown_output: 50 }),
                /Unknown dependent variable/);
        });

        it('requires inputs object', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.throws(() => exp.addTrial(null, { cell_viability: 50 }),
                /inputs must be an object/);
        });

        it('requires outputs object', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.throws(() => exp.addTrial({ nozzle_diameter: 0.2 }, null),
                /outputs must be an object/);
        });

        it('increments trial numbers', () => {
            const exp = tracker.create(BASIC_CONFIG);
            const r1 = exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72 });
            const r2 = exp.addTrial({ nozzle_diameter: 0.3 }, { cell_viability: 85 });
            assert.strictEqual(r1.trialNumber, 1);
            assert.strictEqual(r2.trialNumber, 2);
        });

        it('accepts notes in metadata', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72 }, { notes: 'First run' });
            const trials = exp.getTrials();
            assert.strictEqual(trials[0].notes, 'First run');
        });

        it('enforces max trials limit', () => {
            const smallTracker = createExperimentTracker({ maxTrials: 3 });
            const exp = smallTracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 70 });
            exp.addTrial({ nozzle_diameter: 0.3 }, { cell_viability: 80 });
            exp.addTrial({ nozzle_diameter: 0.4 }, { cell_viability: 90 });
            assert.throws(() => exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 75 }),
                /Maximum trials/);
        });
    });

    // ── Trials Retrieval ────────────────────────────────────────

    describe('getTrials', () => {
        it('returns all trials', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72 });
            exp.addTrial({ nozzle_diameter: 0.3 }, { cell_viability: 85 });
            assert.strictEqual(exp.getTrials().length, 2);
        });

        it('filters by input match', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72 });
            exp.addTrial({ nozzle_diameter: 0.3 }, { cell_viability: 85 });
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 74 });
            const filtered = exp.getTrials({ inputMatch: { nozzle_diameter: 0.2 } });
            assert.strictEqual(filtered.length, 2);
        });

        it('respects limit', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72 });
            exp.addTrial({ nozzle_diameter: 0.3 }, { cell_viability: 85 });
            exp.addTrial({ nozzle_diameter: 0.4 }, { cell_viability: 93 });
            const limited = exp.getTrials({ limit: 2 });
            assert.strictEqual(limited.length, 2);
        });

        it('returns deep copies', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72 });
            const trials = exp.getTrials();
            trials[0].inputs.nozzle_diameter = 999;
            const fresh = exp.getTrials();
            assert.strictEqual(fresh[0].inputs.nozzle_diameter, 0.2);
        });
    });

    // ── Statistics ───────────────────────────────────────────────

    describe('getStatistics', () => {
        it('computes mean, stdDev, min, max, cv', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 70 });
            exp.addTrial({ nozzle_diameter: 0.3 }, { cell_viability: 80 });
            exp.addTrial({ nozzle_diameter: 0.4 }, { cell_viability: 90 });
            const stats = exp.getStatistics();
            assert.strictEqual(stats.cell_viability.count, 3);
            assert.strictEqual(stats.cell_viability.mean, 80);
            assert.strictEqual(stats.cell_viability.min, 70);
            assert.strictEqual(stats.cell_viability.max, 90);
            assert.ok(stats.cell_viability.stdDev > 0);
            assert.ok(stats.cell_viability.cv > 0);
        });

        it('groups by independent variable', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 70 });
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72 });
            exp.addTrial({ nozzle_diameter: 0.4 }, { cell_viability: 90 });
            exp.addTrial({ nozzle_diameter: 0.4 }, { cell_viability: 92 });
            const grouped = exp.getStatistics({ groupBy: 'nozzle_diameter' });
            assert.strictEqual(grouped['0.2'].cell_viability.mean, 71);
            assert.strictEqual(grouped['0.4'].cell_viability.mean, 91);
        });

        it('returns zeros for no trials', () => {
            const exp = tracker.create(BASIC_CONFIG);
            const stats = exp.getStatistics();
            assert.strictEqual(stats.cell_viability.count, 0);
            assert.strictEqual(stats.cell_viability.mean, 0);
        });

        it('handles single trial (stdDev = 0)', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 85 });
            const stats = exp.getStatistics();
            assert.strictEqual(stats.cell_viability.stdDev, 0);
        });
    });

    // ── Hypothesis Evaluation ───────────────────────────────────

    describe('evaluate', () => {
        it('sets verdict and reasoning', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.4 }, { cell_viability: 93 });
            const result = exp.evaluate('supported', 'Viability exceeded 90% threshold');
            assert.strictEqual(result.verdict, 'supported');
            assert.ok(result.evaluatedAt);
        });

        it('accepts refuted verdict', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.evaluate('refuted', 'No significant difference observed');
            const summary = exp.getSummary();
            assert.strictEqual(summary.hypothesis.verdict, 'refuted');
        });

        it('accepts inconclusive verdict', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.evaluate('inconclusive', 'More data needed');
            const summary = exp.getSummary();
            assert.strictEqual(summary.hypothesis.verdict, 'inconclusive');
        });

        it('rejects pending as verdict', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.throws(() => exp.evaluate('pending', 'reason'), /must be one of/);
        });

        it('rejects invalid verdict', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.throws(() => exp.evaluate('maybe', 'reason'), /must be one of/);
        });

        it('requires reasoning', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.throws(() => exp.evaluate('supported', ''), /Reasoning is required/);
        });
    });

    // ── Notes ───────────────────────────────────────────────────

    describe('notes', () => {
        it('adds notes with timestamp', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addNote('Initial setup complete');
            const summary = exp.getSummary();
            assert.strictEqual(summary.notes.length, 1);
            assert.strictEqual(summary.notes[0].text, 'Initial setup complete');
            assert.ok(summary.notes[0].timestamp);
        });

        it('rejects empty notes', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.throws(() => exp.addNote(''), /Note text is required/);
        });
    });

    // ── Tags ────────────────────────────────────────────────────

    describe('tags', () => {
        it('adds tags (deduplicated, lowercase)', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTags(['Viability', 'Nozzle', 'viability']);
            const summary = exp.getSummary();
            assert.deepStrictEqual(summary.tags, ['viability', 'nozzle']);
        });

        it('removes tags', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTags(['viability', 'nozzle']);
            exp.removeTag('viability');
            const summary = exp.getSummary();
            assert.deepStrictEqual(summary.tags, ['nozzle']);
        });

        it('rejects non-array tags', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.throws(() => exp.addTags('viability'), /Tags must be an array/);
        });
    });

    // ── Summary ─────────────────────────────────────────────────

    describe('getSummary', () => {
        it('includes all fields', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72 });
            const s = exp.getSummary();
            assert.ok(s.id);
            assert.ok(s.title);
            assert.strictEqual(s.state, 'running');
            assert.ok(s.hypothesis);
            assert.ok(s.variables);
            assert.strictEqual(s.trialCount, 1);
            assert.ok(s.statistics);
            assert.ok(s.createdAt);
        });
    });

    // ── Export ───────────────────────────────────────────────────

    describe('export', () => {
        it('exports as JSON', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72 });
            const json = exp.export('json');
            const parsed = JSON.parse(json);
            assert.strictEqual(parsed.title, BASIC_CONFIG.title);
            assert.strictEqual(parsed.trials.length, 1);
        });

        it('exports as CSV', () => {
            const exp = tracker.create(BASIC_CONFIG);
            exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72 });
            exp.addTrial({ nozzle_diameter: 0.3 }, { cell_viability: 85 });
            const csv = exp.export('csv');
            const lines = csv.split('\n');
            assert.strictEqual(lines.length, 3); // header + 2 data
            assert.ok(lines[0].indexOf('input:nozzle_diameter') !== -1);
            assert.ok(lines[0].indexOf('output:cell_viability') !== -1);
        });
    });

    // ── Tracker-level operations ────────────────────────────────

    describe('get / delete', () => {
        it('retrieves experiment by ID', () => {
            const exp = tracker.create(BASIC_CONFIG);
            const fetched = tracker.get(exp.id);
            assert.ok(fetched);
            assert.strictEqual(fetched.id, exp.id);
        });

        it('returns null for unknown ID', () => {
            assert.strictEqual(tracker.get('EXP-9999'), null);
        });

        it('deletes experiment', () => {
            const exp = tracker.create(BASIC_CONFIG);
            assert.strictEqual(tracker.delete(exp.id), true);
            assert.strictEqual(tracker.get(exp.id), null);
        });

        it('returns false for deleting unknown ID', () => {
            assert.strictEqual(tracker.delete('EXP-9999'), false);
        });
    });

    describe('list', () => {
        it('lists all experiments', () => {
            tracker.create(BASIC_CONFIG);
            tracker.create(Object.assign({}, BASIC_CONFIG, { title: 'Second experiment' }));
            const list = tracker.list();
            assert.strictEqual(list.length, 2);
        });

        it('filters by state', () => {
            const e1 = tracker.create(BASIC_CONFIG);
            tracker.create(Object.assign({}, BASIC_CONFIG, { title: 'Second' }));
            e1.start();
            const running = tracker.list({ state: 'running' });
            assert.strictEqual(running.length, 1);
        });

        it('filters by tag', () => {
            const e1 = tracker.create(BASIC_CONFIG);
            const e2 = tracker.create(Object.assign({}, BASIC_CONFIG, { title: 'Second' }));
            e1.addTags(['nozzle']);
            const tagged = tracker.list({ tag: 'nozzle' });
            assert.strictEqual(tagged.length, 1);
            assert.strictEqual(tagged[0].id, e1.id);
        });

        it('filters by verdict', () => {
            const e1 = tracker.create(BASIC_CONFIG);
            tracker.create(Object.assign({}, BASIC_CONFIG, { title: 'Second' }));
            e1.evaluate('supported', 'Confirmed');
            const supported = tracker.list({ verdict: 'supported' });
            assert.strictEqual(supported.length, 1);
        });

        it('searches by title and hypothesis', () => {
            tracker.create(BASIC_CONFIG);
            tracker.create({
                title: 'Temperature effect on gelation',
                hypothesis: { statement: 'Higher temp speeds crosslinking' },
                variables: { dependent: [{ name: 'gel_time' }] }
            });
            const results = tracker.list({ search: 'nozzle' });
            assert.strictEqual(results.length, 1);
        });

        it('sorts by title', () => {
            tracker.create(Object.assign({}, BASIC_CONFIG, { title: 'Zebra' }));
            tracker.create(Object.assign({}, BASIC_CONFIG, { title: 'Alpha' }));
            const sorted = tracker.list({ sortBy: 'title' });
            assert.strictEqual(sorted[0].title, 'Alpha');
            assert.strictEqual(sorted[1].title, 'Zebra');
        });

        it('sorts descending', () => {
            tracker.create(Object.assign({}, BASIC_CONFIG, { title: 'Alpha' }));
            tracker.create(Object.assign({}, BASIC_CONFIG, { title: 'Zebra' }));
            const sorted = tracker.list({ sortBy: 'title', descending: true });
            assert.strictEqual(sorted[0].title, 'Zebra');
        });
    });

    // ── Compare ─────────────────────────────────────────────────

    describe('compare', () => {
        it('compares experiments on shared dependent variables', () => {
            const e1 = tracker.create(BASIC_CONFIG);
            e1.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 70 });
            e1.addTrial({ nozzle_diameter: 0.3 }, { cell_viability: 80 });

            const e2 = tracker.create({
                title: 'Alternative protocol',
                hypothesis: { statement: 'New bioink improves viability' },
                variables: {
                    independent: [{ name: 'bioink_type', values: ['A', 'B'] }],
                    dependent: [{ name: 'cell_viability', unit: '%' }],
                    controlled: [{ name: 'nozzle_diameter', value: 0.3 }]
                }
            });
            e2.addTrial({ bioink_type: 'A' }, { cell_viability: 88 });
            e2.addTrial({ bioink_type: 'B' }, { cell_viability: 95 });

            const report = tracker.compare([e1.id, e2.id]);
            assert.strictEqual(report.experimentCount, 2);
            assert.deepStrictEqual(report.sharedVariables, ['cell_viability']);
            assert.strictEqual(report.rankings.cell_viability[0].id, e2.id); // higher mean
        });

        it('requires at least 2 IDs', () => {
            const e1 = tracker.create(BASIC_CONFIG);
            assert.throws(() => tracker.compare([e1.id]), /At least 2/);
        });

        it('rejects unknown IDs', () => {
            const e1 = tracker.create(BASIC_CONFIG);
            assert.throws(() => tracker.compare([e1.id, 'EXP-9999']), /not found/);
        });
    });

    // ── Import/Export All ───────────────────────────────────────

    describe('importAll / exportAll', () => {
        it('round-trips via export and import', () => {
            tracker.create(BASIC_CONFIG);
            const e2 = tracker.create(Object.assign({}, BASIC_CONFIG, { title: 'Second' }));
            e2.addTrial({ nozzle_diameter: 0.3 }, { cell_viability: 85 });

            const exported = tracker.exportAll();
            const newTracker = createExperimentTracker();
            const result = newTracker.importAll(exported);

            assert.strictEqual(result.imported, 2);
            assert.strictEqual(result.skipped, 0);
            assert.strictEqual(newTracker.list().length, 2);
        });

        it('skips duplicate IDs on import', () => {
            const e1 = tracker.create(BASIC_CONFIG);
            const exported = tracker.exportAll();
            const result = tracker.importAll(exported);
            assert.strictEqual(result.imported, 0);
            assert.strictEqual(result.skipped, 1);
        });

        it('rejects invalid JSON', () => {
            assert.throws(() => tracker.importAll('not json'), /Invalid JSON/);
        });

        it('rejects wrong format', () => {
            assert.throws(() => tracker.importAll('{"format":"wrong"}'), /Invalid export format/);
        });
    });

    // ── getCounts ───────────────────────────────────────────────

    describe('getCounts', () => {
        it('counts experiments by state', () => {
            const e1 = tracker.create(BASIC_CONFIG);
            const e2 = tracker.create(Object.assign({}, BASIC_CONFIG, { title: 'Second' }));
            const e3 = tracker.create(Object.assign({}, BASIC_CONFIG, { title: 'Third' }));
            e1.start();
            e2.start();
            e2.complete();

            const counts = tracker.getCounts();
            assert.strictEqual(counts.draft, 1);
            assert.strictEqual(counts.running, 1);
            assert.strictEqual(counts.completed, 1);
            assert.strictEqual(counts.total, 3);
        });
    });

    // ── Clear ───────────────────────────────────────────────────

    describe('clear', () => {
        it('removes all experiments', () => {
            tracker.create(BASIC_CONFIG);
            tracker.create(Object.assign({}, BASIC_CONFIG, { title: 'Second' }));
            tracker.clear();
            assert.strictEqual(tracker.list().length, 0);
        });
    });

    // ── Edge cases ──────────────────────────────────────────────

    describe('edge cases', () => {
        it('enforces max experiments limit', () => {
            const small = createExperimentTracker({ maxExperiments: 2 });
            small.create(BASIC_CONFIG);
            small.create(Object.assign({}, BASIC_CONFIG, { title: 'Second' }));
            assert.throws(() => small.create(Object.assign({}, BASIC_CONFIG, { title: 'Third' })),
                /Maximum experiments/);
        });

        it('handles multiple dependent variables', () => {
            const exp = tracker.create({
                title: 'Multi-output test',
                hypothesis: { statement: 'Testing multiple outputs' },
                variables: {
                    independent: [{ name: 'speed', values: [5, 10, 15] }],
                    dependent: [{ name: 'viability' }, { name: 'accuracy' }],
                    controlled: [{ name: 'temp', value: 37 }]
                }
            });
            exp.addTrial({ speed: 5 }, { viability: 90, accuracy: 95 });
            exp.addTrial({ speed: 10 }, { viability: 85, accuracy: 88 });
            const stats = exp.getStatistics();
            assert.strictEqual(stats.viability.count, 2);
            assert.strictEqual(stats.accuracy.count, 2);
        });

        it('handles experiment with no controlled variables', () => {
            const exp = tracker.create({
                title: 'No controls',
                hypothesis: { statement: 'Exploratory' },
                variables: {
                    independent: [{ name: 'x', values: [1, 2] }],
                    dependent: [{ name: 'y' }]
                }
            });
            exp.addTrial({ x: 1 }, { y: 10 });
            assert.strictEqual(exp.getTrials().length, 1);
        });
    });
});
