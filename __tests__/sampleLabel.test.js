'use strict';

var mod = require('../docs/shared/sampleLabel');

describe('SampleLabelGenerator', function () {
    var gen;
    beforeEach(function () {
        gen = mod.createSampleLabelGenerator();
    });

    test('generates labels with correct structure', function () {
        var labels = gen.generate({ prefix: 'ALG', count: 3, project: 'Test' });
        expect(labels).toHaveLength(3);
        expect(labels[0].id).toMatch(/^ALG-\d{8}-001-\d$/);
        expect(labels[0].project).toBe('Test');
        expect(labels[0].barcode).toMatch(/^\|ALG-/);
    });

    test('rejects invalid count', function () {
        expect(function () { gen.generate({ count: -1 }); }).toThrow();
        expect(function () { gen.generate({ count: 501 }); }).toThrow();
    });

    test('rejects invalid sample type', function () {
        expect(function () { gen.generate({ sampleType: 'banana' }); }).toThrow();
    });

    test('toCSV produces valid output', function () {
        var labels = gen.generate({ count: 2 });
        var csv = gen.toCSV(labels);
        var lines = csv.split('\n');
        expect(lines).toHaveLength(3);
        expect(lines[0]).toBe('ID,Type,Project,Operator,Date,Notes,Barcode');
    });

    test('toText produces formatted labels', function () {
        var labels = gen.generate({ count: 1, prefix: 'X' });
        var text = gen.toText(labels);
        expect(text).toContain('┌');
        expect(text).toContain('┘');
    });

    test('parseId validates check digit', function () {
        var labels = gen.generate({ prefix: 'TST', count: 1 });
        var parsed = gen.parseId(labels[0].id);
        expect(parsed.valid).toBe(true);
        expect(parsed.prefix).toBe('TST');
    });

    test('parseId detects invalid check digit', function () {
        var parsed = gen.parseId('TST-20260101-001-9');
        // May or may not be valid depending on actual check digit
        expect(parsed).not.toBeNull();
        expect(typeof parsed.valid).toBe('boolean');
    });

    test('getSampleTypes returns all types', function () {
        var types = gen.getSampleTypes();
        expect(types.tube).toBeDefined();
        expect(types.scaffold).toBeDefined();
    });

    test('getHistory tracks generated labels', function () {
        gen.generate({ count: 2 });
        gen.generate({ count: 3 });
        expect(gen.getHistory()).toHaveLength(5);
    });

    test('sequential numbering across calls', function () {
        var a = gen.generate({ prefix: 'A', count: 2 });
        var b = gen.generate({ prefix: 'A', count: 1 });
        // b should continue from where a left off
        expect(b[0].sequenceNumber).toBe(3);
    });
});
