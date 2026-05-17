'use strict';

var csvSafe = require('../docs/shared/csvSafe').csvSafe;

describe('csvSafe', function () {
    describe('null/undefined handling', function () {
        test('returns empty string for null', function () {
            expect(csvSafe(null)).toBe('');
        });
        test('returns empty string for undefined', function () {
            expect(csvSafe(undefined)).toBe('');
        });
        test('returns empty string for empty string', function () {
            expect(csvSafe('')).toBe('');
        });
    });

    describe('formula-injection defense (CWE-1236)', function () {
        test('prefixes leading = with apostrophe', function () {
            expect(csvSafe('=1+1')).toBe("'=1+1");
        });
        test('prefixes leading @ with apostrophe', function () {
            expect(csvSafe('@SUM(A1)')).toBe("'@SUM(A1)");
        });
        test('prefixes leading tab with apostrophe', function () {
            // After prepending ', the string no longer starts with whitespace
            // so RFC quoting doesn't kick in.
            expect(csvSafe('\tdanger')).toBe("'\tdanger");
        });
        test('prefixes leading CR with apostrophe (and quotes for embedded CR)', function () {
            var out = csvSafe('\rdanger');
            // CR present anywhere triggers RFC 4180 quoting
            expect(out.charAt(0)).toBe('"');
            expect(out.indexOf("'\r")).toBe(1);
        });
        test('prefixes leading pipe with apostrophe', function () {
            expect(csvSafe('|cmd')).toBe("'|cmd");
        });
        test('prefixes formula starting with = followed by function', function () {
            expect(csvSafe('=HYPERLINK("evil")')).toMatch(/^"'=HYPERLINK/);
        });
    });

    describe('preserves legitimate numbers with sign', function () {
        test('keeps negative number unescaped', function () {
            expect(csvSafe('-3.14')).toBe('-3.14');
        });
        test('keeps positive number unescaped', function () {
            expect(csvSafe('+1.5')).toBe('+1.5');
        });
        test('keeps negative integer unescaped', function () {
            expect(csvSafe('-100')).toBe('-100');
        });
        test('escapes minus followed by non-number', function () {
            expect(csvSafe('-cmd /c whoami')).toBe("'-cmd /c whoami");
        });
        test('escapes plus followed by non-number', function () {
            expect(csvSafe('+foo')).toBe("'+foo");
        });
        test('escapes lone minus sign', function () {
            // single '-' is not a finite number
            expect(csvSafe('-')).toBe("'-");
        });
    });

    describe('RFC-4180 quoting', function () {
        test('quotes value with comma', function () {
            expect(csvSafe('a,b')).toBe('"a,b"');
        });
        test('escapes embedded double quotes', function () {
            expect(csvSafe('she said "hi"')).toBe('"she said ""hi"""');
        });
        test('quotes value with newline', function () {
            expect(csvSafe('line1\nline2')).toBe('"line1\nline2"');
        });
        test('quotes value with carriage return', function () {
            expect(csvSafe('line1\rline2')).toBe('"line1\rline2"');
        });
        test('quotes value with leading whitespace', function () {
            expect(csvSafe('  padded')).toBe('"  padded"');
        });
        test('quotes value with trailing whitespace', function () {
            expect(csvSafe('padded  ')).toBe('"padded  "');
        });
        test('does not quote ordinary text', function () {
            expect(csvSafe('hello world')).toBe('hello world');
        });
    });

    describe('type coercion', function () {
        test('coerces numbers to string', function () {
            expect(csvSafe(42)).toBe('42');
        });
        test('coerces boolean true', function () {
            expect(csvSafe(true)).toBe('true');
        });
        test('coerces boolean false', function () {
            expect(csvSafe(false)).toBe('false');
        });
        test('coerces zero correctly (not treated as null)', function () {
            expect(csvSafe(0)).toBe('0');
        });
        test('coerces objects via String()', function () {
            expect(csvSafe({ a: 1 })).toBe('[object Object]');
        });
    });

    describe('combined attacks', function () {
        test('handles formula injection with embedded quote', function () {
            // Starts with =, contains ", so both apostrophe AND RFC quoting apply
            var out = csvSafe('=cmd|"evil"!A1');
            expect(out.charAt(0)).toBe('"');
            expect(out.indexOf("'=")).toBe(1);
            expect(out).toContain('""evil""');
        });
        test('handles formula injection with comma', function () {
            var out = csvSafe('=A1,B1');
            expect(out).toBe('"\'=A1,B1"');
        });
    });
});
