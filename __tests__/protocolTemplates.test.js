'use strict';

var mod = require('../docs/shared/protocolTemplates');

describe('Protocol Template Library', function () {
    var lib;

    beforeEach(function () {
        lib = mod.createProtocolTemplateLibrary();
    });

    test('listTemplates returns all built-in templates', function () {
        var list = lib.listTemplates();
        expect(list.length).toBeGreaterThanOrEqual(6);
        expect(list.some(function (t) { return t.id === 'cell-thawing'; })).toBe(true);
        expect(list.some(function (t) { return t.id === 'bioink-prep-alginate'; })).toBe(true);
    });

    test('listTemplates filters by category', function () {
        var bioinks = lib.listTemplates('bioink');
        bioinks.forEach(function (t) {
            expect(t.category).toBe('bioink');
        });
        expect(bioinks.length).toBeGreaterThanOrEqual(2);
    });

    test('getTemplate returns deep clone', function () {
        var t1 = lib.getTemplate('cell-thawing');
        var t2 = lib.getTemplate('cell-thawing');
        expect(t1).toEqual(t2);
        t1.name = 'modified';
        expect(t2.name).not.toBe('modified');
    });

    test('getTemplate returns null for unknown id', function () {
        expect(lib.getTemplate('nonexistent')).toBeNull();
    });

    test('customize overrides parameters within range', function () {
        var result = lib.customize('bioink-prep-alginate', { concentration: 3.0 });
        expect(result.parameters.concentration.value).toBe(3.0);
    });

    test('customize rejects out-of-range values', function () {
        var result = lib.customize('bioink-prep-alginate', { concentration: 99 });
        expect(result.error).toBeDefined();
    });

    test('customize rejects invalid option values', function () {
        var result = lib.customize('bioink-prep-alginate', { crosslinker: 'Water' });
        expect(result.error).toBeDefined();
    });

    test('exportMarkdown produces formatted output', function () {
        var md = lib.exportMarkdown('cell-thawing');
        expect(md).toContain('# Cell Thawing Protocol');
        expect(md).toContain('## Procedure');
        expect(md).toContain('## Materials');
        expect(md).toContain('CRITICAL');
    });

    test('exportJSON produces valid JSON', function () {
        var json = lib.exportJSON('bioprint-extrusion');
        var parsed = JSON.parse(json);
        expect(parsed.name).toBe('Extrusion Bioprinting Run');
    });

    test('addTemplate adds custom template', function () {
        var result = lib.addTemplate('my-protocol', {
            name: 'My Protocol',
            category: 'custom',
            steps: [{ step: 1, action: 'Do something', duration: 5, unit: 'min' }]
        });
        expect(result.success).toBe(true);
        expect(lib.getTemplate('my-protocol')).not.toBeNull();
    });

    test('addTemplate rejects overwriting built-in', function () {
        var result = lib.addTemplate('cell-thawing', { name: 'X', category: 'Y', steps: [] });
        expect(result.success).toBe(false);
    });

    test('listCategories returns unique sorted categories', function () {
        var cats = lib.listCategories();
        expect(cats).toContain('bioink');
        expect(cats).toContain('cell-culture');
        expect(cats).toEqual(cats.slice().sort());
    });

    test('search finds templates by keyword', function () {
        var results = lib.search('alginate');
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].id).toBe('bioink-prep-alginate');
    });

    test('search is case-insensitive', function () {
        var results = lib.search('GELMA');
        expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test('search returns empty for no match', function () {
        expect(lib.search('zzzznonexistent')).toEqual([]);
    });
});
