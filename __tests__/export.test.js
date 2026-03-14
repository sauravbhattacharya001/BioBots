const { createDataExporter } = require('../docs/shared/export');

describe('createDataExporter', () => {
    let exporter;

    beforeEach(() => {
        exporter = createDataExporter();
    });

    // ── escapeCSVValue ──────────────────────────────────────────────────

    describe('escapeCSVValue', () => {
        test('returns empty string for null', () => {
            expect(exporter.escapeCSVValue(null)).toBe('');
        });

        test('returns empty string for undefined', () => {
            expect(exporter.escapeCSVValue(undefined)).toBe('');
        });

        test('converts number to string', () => {
            expect(exporter.escapeCSVValue(42)).toBe('42');
        });

        test('returns plain string unchanged', () => {
            expect(exporter.escapeCSVValue('hello')).toBe('hello');
        });

        test('wraps value containing comma in quotes', () => {
            expect(exporter.escapeCSVValue('a,b')).toBe('"a,b"');
        });

        test('escapes double quotes by doubling them', () => {
            expect(exporter.escapeCSVValue('say "hi"')).toBe('"say ""hi"""');
        });

        test('wraps value containing newline in quotes', () => {
            expect(exporter.escapeCSVValue('line1\nline2')).toBe('"line1\nline2"');
        });

        test('wraps value with leading/trailing whitespace in quotes', () => {
            expect(exporter.escapeCSVValue('  spaced  ')).toBe('"  spaced  "');
        });
    });

    // ── resolvePath ─────────────────────────────────────────────────────

    describe('resolvePath', () => {
        test('resolves a simple top-level key', () => {
            expect(exporter.resolvePath({ name: 'Bio' }, 'name')).toBe('Bio');
        });

        test('resolves a nested path', () => {
            expect(exporter.resolvePath({ a: { b: 10 } }, 'a.b')).toBe(10);
        });

        test('resolves deeply nested path', () => {
            expect(exporter.resolvePath({ a: { b: { c: { d: 99 } } } }, 'a.b.c.d')).toBe(99);
        });

        test('returns null for null object', () => {
            expect(exporter.resolvePath(null, 'a')).toBeNull();
        });

        test('returns null for missing key', () => {
            expect(exporter.resolvePath({ x: 1 }, 'y')).toBeNull();
        });

        test('returns null for undefined nested key', () => {
            expect(exporter.resolvePath({ a: {} }, 'a.b')).toBeNull();
        });

        test('returns null for empty path', () => {
            expect(exporter.resolvePath({ a: 1 }, '')).toBeNull();
        });
    });

    // ── toCSV ───────────────────────────────────────────────────────────

    describe('toCSV', () => {
        const sampleData = [
            { id: 1, name: 'PrintA', viability: 95.2 },
            { id: 2, name: 'PrintB', viability: 88.1 }
        ];
        const columns = [
            { key: 'id', label: 'ID' },
            { key: 'name', label: 'Name' },
            { key: 'viability', label: 'Viability (%)' }
        ];

        test('generates CSV with headers and data rows', () => {
            var csv = exporter.toCSV(sampleData, columns, { includeBOM: false });
            var lines = csv.split('\r\n');
            expect(lines[0]).toBe('ID,Name,Viability (%)');
            expect(lines[1]).toBe('1,PrintA,95.2');
            expect(lines[2]).toBe('2,PrintB,88.1');
        });

        test('uses key as label when label is omitted', () => {
            var csv = exporter.toCSV([{ x: 1 }], [{ key: 'x' }], { includeBOM: false });
            expect(csv.startsWith('x')).toBe(true);
        });

        test('applies format function to values', () => {
            var cols = [{ key: 'viability', label: 'V', format: v => v.toFixed(0) + '%' }];
            var csv = exporter.toCSV(sampleData, cols, { includeBOM: false });
            expect(csv).toContain('95%');
            expect(csv).toContain('88%');
        });

        test('includes UTF-8 BOM by default', () => {
            var csv = exporter.toCSV(sampleData, columns);
            expect(csv.charCodeAt(0)).toBe(0xFEFF);
        });

        test('can disable BOM', () => {
            var csv = exporter.toCSV(sampleData, columns, { includeBOM: false });
            expect(csv.charCodeAt(0)).not.toBe(0xFEFF);
        });

        test('supports custom line ending', () => {
            var csv = exporter.toCSV(sampleData, columns, { includeBOM: false, lineEnding: '\n' });
            expect(csv.indexOf('\r\n')).toBe(-1);
            expect(csv.split('\n').length).toBe(3);
        });

        test('handles empty data array', () => {
            var csv = exporter.toCSV([], columns, { includeBOM: false });
            expect(csv).toBe('ID,Name,Viability (%)');
        });

        test('handles single row', () => {
            var csv = exporter.toCSV([sampleData[0]], columns, { includeBOM: false });
            expect(csv.split('\r\n').length).toBe(2);
        });

        test('escapes special characters in values', () => {
            var data = [{ id: 1, name: 'has, comma', viability: 0 }];
            var csv = exporter.toCSV(data, columns, { includeBOM: false });
            expect(csv).toContain('"has, comma"');
        });

        test('resolves nested paths', () => {
            var data = [{ meta: { score: 42 } }];
            var cols = [{ key: 'meta.score', label: 'Score' }];
            var csv = exporter.toCSV(data, cols, { includeBOM: false });
            expect(csv).toContain('42');
        });

        test('throws on non-array data', () => {
            expect(() => exporter.toCSV('bad', columns)).toThrow('Data must be an array');
        });

        test('throws on empty columns', () => {
            expect(() => exporter.toCSV([], [])).toThrow('Columns must be a non-empty array');
        });

        test('throws when data exceeds MAX_ROWS', () => {
            var big = new Array(exporter.MAX_ROWS + 1).fill({ id: 1 });
            expect(() => exporter.toCSV(big, [{ key: 'id' }])).toThrow('Data exceeds maximum');
        });
    });

    // ── toJSON ──────────────────────────────────────────────────────────

    describe('toJSON', () => {
        test('pretty-prints by default', () => {
            var json = exporter.toJSON({ a: 1 });
            expect(json).toContain('\n');
            expect(json).toContain('  ');
        });

        test('compact mode with pretty=false', () => {
            var json = exporter.toJSON({ a: 1 }, { pretty: false });
            expect(json).toBe('{"a":1}');
        });

        test('filters fields when provided', () => {
            var data = [{ id: 1, name: 'A', secret: 'x' }];
            var json = exporter.toJSON(data, { fields: ['id', 'name'] });
            var parsed = JSON.parse(json);
            expect(parsed[0].id).toBe(1);
            expect(parsed[0].name).toBe('A');
            expect(parsed[0].secret).toBeUndefined();
        });

        test('filters nested fields', () => {
            var data = [{ id: 1, meta: { score: 42, internal: 'x' } }];
            var json = exporter.toJSON(data, { fields: ['id', 'meta.score'] });
            var parsed = JSON.parse(json);
            expect(parsed[0].meta.score).toBe(42);
            expect(parsed[0].meta.internal).toBeUndefined();
        });

        test('preserves nested structure during filtering', () => {
            var data = [{ a: { b: { c: 5 } } }];
            var json = exporter.toJSON(data, { fields: ['a.b.c'] });
            var parsed = JSON.parse(json);
            expect(parsed[0].a.b.c).toBe(5);
        });

        test('handles empty array', () => {
            expect(exporter.toJSON([])).toBe('[]');
        });

        test('serializes a single object', () => {
            var json = exporter.toJSON({ key: 'val' });
            expect(JSON.parse(json).key).toBe('val');
        });

        test('handles null values in data', () => {
            var json = exporter.toJSON([{ a: null, b: 1 }]);
            var parsed = JSON.parse(json);
            expect(parsed[0].a).toBeNull();
            expect(parsed[0].b).toBe(1);
        });
    });

    // ── formatFilename ──────────────────────────────────────────────────

    describe('formatFilename', () => {
        test('generates filename with base and extension', () => {
            var fn = exporter.formatFilename('export', 'csv');
            expect(fn).toMatch(/^export_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/);
        });

        test('includes ISO-like timestamp', () => {
            var fn = exporter.formatFilename('data', 'json');
            expect(fn).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
        });

        test('sanitizes special characters', () => {
            var fn = exporter.formatFilename('my file @#$!', 'csv');
            expect(fn).not.toMatch(/[@#$! ]/);
            expect(fn).toContain('my_file');
        });

        test('defaults empty base to export', () => {
            var fn = exporter.formatFilename('', 'csv');
            expect(fn).toMatch(/^export_/);
        });

        test('defaults empty extension to csv', () => {
            var fn = exporter.formatFilename('data', '');
            expect(fn).toMatch(/\.csv$/);
        });

        test('defaults null base and extension', () => {
            var fn = exporter.formatFilename(null, null);
            expect(fn).toMatch(/^export_.*\.csv$/);
        });

        test('truncates long filenames', () => {
            var longName = 'a'.repeat(300);
            var fn = exporter.formatFilename(longName, 'csv');
            expect(fn.length).toBeLessThanOrEqual(exporter.MAX_FILENAME_LENGTH);
        });

        test('works with various extensions', () => {
            expect(exporter.formatFilename('f', 'json')).toMatch(/\.json$/);
            expect(exporter.formatFilename('f', 'xlsx')).toMatch(/\.xlsx$/);
        });
    });

    // ── triggerDownload ─────────────────────────────────────────────────

    describe('triggerDownload', () => {
        let mockAnchor;
        let origCreateObjectURL, origRevokeObjectURL;
        let origCreateElement, origAppendChild, origRemoveChild;

        beforeEach(() => {
            mockAnchor = { click: jest.fn(), style: {}, href: '', download: '' };

            // Mock DOM APIs
            origCreateObjectURL = global.URL.createObjectURL;
            origRevokeObjectURL = global.URL.revokeObjectURL;
            global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
            global.URL.revokeObjectURL = jest.fn();

            origCreateElement = document.createElement.bind(document);
            jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor);
            origAppendChild = document.body.appendChild;
            origRemoveChild = document.body.removeChild;
            document.body.appendChild = jest.fn();
            document.body.removeChild = jest.fn();
        });

        afterEach(() => {
            global.URL.createObjectURL = origCreateObjectURL;
            global.URL.revokeObjectURL = origRevokeObjectURL;
            document.createElement.mockRestore();
            document.body.appendChild = origAppendChild;
            document.body.removeChild = origRemoveChild;
        });

        test('creates a Blob via URL.createObjectURL', () => {
            exporter.triggerDownload('data', 'file.csv', 'text/csv');
            expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
        });

        test('sets href on anchor element', () => {
            exporter.triggerDownload('data', 'file.csv', 'text/csv');
            expect(mockAnchor.href).toBe('blob:mock-url');
        });

        test('sets download attribute to filename', () => {
            exporter.triggerDownload('data', 'myfile.json', 'application/json');
            expect(mockAnchor.download).toBe('myfile.json');
        });

        test('appends anchor to document body and clicks', () => {
            exporter.triggerDownload('data', 'f.csv', 'text/csv');
            expect(document.body.appendChild).toHaveBeenCalledWith(mockAnchor);
            expect(mockAnchor.click).toHaveBeenCalled();
        });

        test('removes anchor and revokes URL after timeout', () => {
            jest.useFakeTimers();
            exporter.triggerDownload('data', 'f.csv', 'text/csv');
            jest.advanceTimersByTime(150);
            expect(document.body.removeChild).toHaveBeenCalledWith(mockAnchor);
            expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
            jest.useRealTimers();
        });
    });

    // ── downloadCSV ─────────────────────────────────────────────────────

    describe('downloadCSV', () => {
        let mockAnchor;
        let origAppendChild, origRemoveChild;

        beforeEach(() => {
            mockAnchor = { click: jest.fn(), style: {}, href: '', download: '' };
            global.URL.createObjectURL = jest.fn(() => 'blob:mock');
            global.URL.revokeObjectURL = jest.fn();
            jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor);
            origAppendChild = document.body.appendChild;
            origRemoveChild = document.body.removeChild;
            document.body.appendChild = jest.fn();
            document.body.removeChild = jest.fn();
        });

        afterEach(() => {
            document.createElement.mockRestore();
            document.body.appendChild = origAppendChild;
            document.body.removeChild = origRemoveChild;
        });

        const data = [{ id: 1, name: 'A' }];
        const cols = [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }];

        test('returns CSV string', () => {
            var csv = exporter.downloadCSV(data, cols, 'test.csv');
            expect(csv).toContain('ID,Name');
            expect(csv).toContain('1,A');
        });

        test('auto-generates filename when omitted', () => {
            exporter.downloadCSV(data, cols);
            expect(mockAnchor.download).toMatch(/biobots_export_.*\.csv$/);
        });

        test('uses custom filename when provided', () => {
            exporter.downloadCSV(data, cols, 'custom.csv');
            expect(mockAnchor.download).toBe('custom.csv');
        });

        test('passes options through to toCSV', () => {
            var csv = exporter.downloadCSV(data, cols, 'f.csv', { includeBOM: false });
            expect(csv.charCodeAt(0)).not.toBe(0xFEFF);
        });

        test('triggers download with click', () => {
            exporter.downloadCSV(data, cols, 'f.csv');
            expect(mockAnchor.click).toHaveBeenCalled();
            expect(document.body.appendChild).toHaveBeenCalledWith(mockAnchor);
        });
    });

    // ── downloadJSON ────────────────────────────────────────────────────

    describe('downloadJSON', () => {
        let mockAnchor;
        let origAppendChild, origRemoveChild;

        beforeEach(() => {
            mockAnchor = { click: jest.fn(), style: {}, href: '', download: '' };
            global.URL.createObjectURL = jest.fn(() => 'blob:mock');
            global.URL.revokeObjectURL = jest.fn();
            jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor);
            origAppendChild = document.body.appendChild;
            origRemoveChild = document.body.removeChild;
            document.body.appendChild = jest.fn();
            document.body.removeChild = jest.fn();
        });

        afterEach(() => {
            document.createElement.mockRestore();
            document.body.appendChild = origAppendChild;
            document.body.removeChild = origRemoveChild;
        });

        test('returns JSON string', () => {
            var json = exporter.downloadJSON([{ a: 1 }], 'test.json');
            expect(JSON.parse(json)).toEqual([{ a: 1 }]);
        });

        test('auto-generates filename when omitted', () => {
            exporter.downloadJSON([1]);
            expect(mockAnchor.download).toMatch(/biobots_export_.*\.json$/);
        });

        test('uses custom filename when provided', () => {
            exporter.downloadJSON([1], 'custom.json');
            expect(mockAnchor.download).toBe('custom.json');
        });

        test('passes options through to toJSON', () => {
            var json = exporter.downloadJSON({ x: 1 }, 'f.json', { pretty: false });
            expect(json).toBe('{"x":1}');
        });

        test('triggers download with application/json', () => {
            exporter.downloadJSON([1], 'f.json');
            expect(mockAnchor.click).toHaveBeenCalled();
        });
    });

    // ── columnsFromDescriptors ──────────────────────────────────────────

    describe('columnsFromDescriptors', () => {
        test('converts descriptors to column definitions', () => {
            var descriptors = [{ key: 'temp', label: 'Temperature', unit: '°C' }];
            var cols = exporter.columnsFromDescriptors(descriptors);
            expect(cols).toEqual([{ key: 'temp', label: 'Temperature (°C)' }]);
        });

        test('appends unit in parentheses when present', () => {
            var cols = exporter.columnsFromDescriptors([{ key: 'p', label: 'Pressure', unit: 'kPa' }]);
            expect(cols[0].label).toBe('Pressure (kPa)');
        });

        test('omits unit parentheses when unit is empty', () => {
            var cols = exporter.columnsFromDescriptors([{ key: 'id', label: 'ID', unit: '' }]);
            expect(cols[0].label).toBe('ID');
        });

        test('returns empty array for empty input', () => {
            expect(exporter.columnsFromDescriptors([])).toEqual([]);
        });

        test('returns empty array for non-array input', () => {
            expect(exporter.columnsFromDescriptors('bad')).toEqual([]);
            expect(exporter.columnsFromDescriptors(null)).toEqual([]);
        });
    });

    // ── getExportSummary ────────────────────────────────────────────────

    describe('getExportSummary', () => {
        test('returns correct record count', () => {
            var summary = exporter.getExportSummary([1, 2, 3], 'Test');
            expect(summary.recordCount).toBe(3);
        });

        test('uses default dataset name when omitted', () => {
            var summary = exporter.getExportSummary([]);
            expect(summary.datasetName).toBe('BioBots Export');
        });

        test('uses custom dataset name', () => {
            var summary = exporter.getExportSummary([], 'My Data');
            expect(summary.datasetName).toBe('My Data');
        });

        test('handles empty data array', () => {
            var summary = exporter.getExportSummary([], 'X');
            expect(summary.recordCount).toBe(0);
            expect(summary.exportDate).toBeDefined();
        });

        test('returns 0 count for non-array data', () => {
            var summary = exporter.getExportSummary('not array');
            expect(summary.recordCount).toBe(0);
        });
    });

    // ── integration / edge cases ────────────────────────────────────────

    describe('integration', () => {
        test('CSV round-trip: export then verify content', () => {
            var data = [
                { name: 'Cell Line A', metrics: { viability: 97.3 } },
                { name: 'Cell Line B', metrics: { viability: 82.1 } }
            ];
            var cols = [
                { key: 'name', label: 'Cell Line' },
                { key: 'metrics.viability', label: 'Viability', format: v => v + '%' }
            ];
            var csv = exporter.toCSV(data, cols, { includeBOM: false });
            var lines = csv.split('\r\n');
            expect(lines[0]).toBe('Cell Line,Viability');
            expect(lines[1]).toBe('Cell Line A,97.3%');
            expect(lines[2]).toBe('Cell Line B,82.1%');
        });

        test('escapeCSVValue handles carriage return', () => {
            expect(exporter.escapeCSVValue('a\rb')).toBe('"a\rb"');
        });

        test('resolvePath returns 0 and false correctly (not null)', () => {
            expect(exporter.resolvePath({ val: 0 }, 'val')).toBe(0);
            expect(exporter.resolvePath({ val: false }, 'val')).toBe(false);
        });

        test('toCSV does not apply format when value is null', () => {
            var cols = [{ key: 'x', format: v => v.toFixed(2) }];
            var csv = exporter.toCSV([{ y: 1 }], cols, { includeBOM: false });
            // x is missing → null → format should NOT be called → empty string
            expect(csv).toBe('x\r\n');
        });

        test('getExportSummary includes format version string', () => {
            var s = exporter.getExportSummary([]);
            expect(s.format).toBe('BioBots Data Export v1.0');
        });

        test('MAX_ROWS is 100000', () => {
            expect(exporter.MAX_ROWS).toBe(100000);
        });

        test('MAX_FILENAME_LENGTH is 200', () => {
            expect(exporter.MAX_FILENAME_LENGTH).toBe(200);
        });

        // ── CSV Formula Injection Defense ────────────────────────────
        describe('CSV formula injection defense', () => {
            test('prefixes = with single-quote to prevent formula execution', () => {
                expect(exporter.escapeCSVValue('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
            });

            test('prefixes + with single-quote', () => {
                expect(exporter.escapeCSVValue('+cmd|calc')).toBe("'+cmd|calc");
            });

            test('prefixes - with single-quote', () => {
                expect(exporter.escapeCSVValue('-1+2')).toBe("'-1+2");
            });

            test('prefixes @ with single-quote', () => {
                expect(exporter.escapeCSVValue('@SUM(A1)')).toBe("'@SUM(A1)");
            });

            test('prefixes tab character with single-quote', () => {
                var result = exporter.escapeCSVValue('\t=calc');
                // Tab is a formula trigger → prefixed with '
                expect(result).toBe("'\t=calc");
            });

            test('prefixes \\r with single-quote and wraps in quotes', () => {
                var result = exporter.escapeCSVValue('\r=dangerous');
                // \r prefix → prefixed with ', then contains \r → quoted
                expect(result).toBe('"\'\r=dangerous"');
            });

            test('does not prefix safe strings', () => {
                expect(exporter.escapeCSVValue('Hello World')).toBe('Hello World');
                expect(exporter.escapeCSVValue('42')).toBe('42');
                expect(exporter.escapeCSVValue('Cell Line A')).toBe('Cell Line A');
            });

            test('HYPERLINK injection is neutralized', () => {
                var result = exporter.escapeCSVValue('=HYPERLINK("http://evil.com","click")');
                // = prefix → prefixed with ', then contains " → quoted
                // The important thing: it won't execute as formula in Excel
                expect(result).toContain("'=HYPERLINK");
            });

            test('formula injection in full CSV export', () => {
                var data = [{ name: '=cmd|calc', value: 10 }];
                var cols = [{ key: 'name' }, { key: 'value' }];
                var csv = exporter.toCSV(data, cols, { includeBOM: false });
                var lines = csv.split('\r\n');
                // Name field should be prefixed, not treated as formula
                expect(lines[1]).toBe("'=cmd|calc,10");
            });

            test('does not corrupt negative numbers with formula injection prefix', () => {
                // Negative numbers start with '-' but must not be prefixed
                expect(exporter.escapeCSVValue(-3.14)).toBe('-3.14');
                expect(exporter.escapeCSVValue('-42')).toBe('-42');
                expect(exporter.escapeCSVValue('-0.001')).toBe('-0.001');
            });

            test('does not corrupt positive numbers with leading +', () => {
                expect(exporter.escapeCSVValue('+1.5')).toBe('+1.5');
                expect(exporter.escapeCSVValue('+100')).toBe('+100');
            });

            test('still prefixes non-numeric strings starting with - or +', () => {
                expect(exporter.escapeCSVValue('-cmd|calc')).toBe("'-cmd|calc");
                expect(exporter.escapeCSVValue('+cmd|calc')).toBe("'+cmd|calc");
                expect(exporter.escapeCSVValue('--double')).toBe("'--double");
            });

            test('negative numbers in full CSV export remain numeric', () => {
                var data = [{ name: 'test', delta: -5.2 }];
                var cols = [{ key: 'name' }, { key: 'delta' }];
                var csv = exporter.toCSV(data, cols, { includeBOM: false });
                var lines = csv.split('\r\n');
                expect(lines[1]).toBe('test,-5.2');
            });
        });
    });
});
