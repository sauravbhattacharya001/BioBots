'use strict';

var mod = require('../docs/shared/labNotebook');

describe('Lab Notebook Generator', function () {
    var gen;

    beforeEach(function () {
        gen = mod.createLabNotebookGenerator({ defaultResearcher: 'Dr. Test' });
    });

    test('generate returns all formats', function () {
        var result = gen.generate({
            title: 'Test Experiment',
            objective: 'Verify notebook generation',
            materials: [{ name: 'Reagent A', lot: 'L-001', quantity: '10 mL' }],
            protocol: ['Mix reagent', 'Incubate 1h'],
            observations: 'Clear solution',
            results: { yield: '95%' },
            notes: 'Repeat next week',
            tags: ['test']
        });

        expect(result.id).toMatch(/^LNB-/);
        expect(result.plainText).toContain('Test Experiment');
        expect(result.markdown).toContain('# Test Experiment');
        expect(result.html).toContain('<h1>Test Experiment</h1>');
        expect(result.checklist.length).toBeGreaterThan(0);
        expect(result.entry.researcher).toBe('Dr. Test');
    });

    test('requires title', function () {
        expect(function () { gen.generate({}); }).toThrow(/title/);
    });

    test('tracks entries', function () {
        gen.generate({ title: 'A' });
        gen.generate({ title: 'B' });
        expect(gen.entryCount()).toBe(2);
        expect(gen.listEntries()).toHaveLength(2);
        expect(gen.listEntries()[0].title).toBe('A');
    });

    test('template returns placeholder structure', function () {
        var t = gen.template('My Exp');
        expect(t.title).toBe('My Exp');
        expect(t.materials).toHaveLength(1);
        expect(t.protocol).toHaveLength(3);
    });

    test('markdown includes materials table', function () {
        var result = gen.generate({
            title: 'Mat Test',
            materials: [
                { name: 'X', lot: 'L1', quantity: '5g', expiry: '2027-01' }
            ]
        });
        expect(result.markdown).toContain('| 1 | X | L1 | 5g | 2027-01 |');
    });

    test('html escapes special characters', function () {
        var result = gen.generate({
            title: 'Test <script>',
            observations: 'pH > 7 & temp < 40'
        });
        expect(result.html).toContain('&lt;script&gt;');
        expect(result.html).toContain('pH &gt; 7 &amp; temp &lt; 40');
    });

    test('checklist includes expiry check for materials with expiry', function () {
        var result = gen.generate({
            title: 'Expiry Test',
            materials: [{ name: 'Reagent B', expiry: '2026-06' }]
        });
        var expiryTasks = result.checklist.filter(function (c) {
            return c.task.indexOf('expiry') >= 0 || c.task.indexOf('Expiry') >= 0;
        });
        expect(expiryTasks.length).toBeGreaterThan(0);
    });
});
