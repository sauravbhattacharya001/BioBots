'use strict';

var loader = require('../docs/shared/data-loader');

describe('URL safety validation', function () {
    var _isUrlSafe = loader._isUrlSafe;

    test('allows relative paths', function () {
        expect(_isUrlSafe('bioprint-data.json')).toBe(true);
        expect(_isUrlSafe('./data/file.json')).toBe(true);
        expect(_isUrlSafe('../other/data.json')).toBe(true);
    });

    test('allows http and https URLs', function () {
        expect(_isUrlSafe('https://example.com/data.json')).toBe(true);
        expect(_isUrlSafe('http://localhost:3000/data.json')).toBe(true);
    });

    test('blocks javascript: scheme', function () {
        expect(_isUrlSafe('javascript:alert(1)')).toBe(false);
        expect(_isUrlSafe('JAVASCRIPT:alert(1)')).toBe(false);
    });

    test('blocks data: scheme', function () {
        expect(_isUrlSafe('data:text/html,<script>alert(1)</script>')).toBe(false);
    });

    test('blocks file: scheme', function () {
        expect(_isUrlSafe('file:///etc/passwd')).toBe(false);
    });

    test('blocks blob: scheme', function () {
        expect(_isUrlSafe('blob:http://example.com/uuid')).toBe(false);
    });

    test('blocks vbscript: scheme', function () {
        expect(_isUrlSafe('vbscript:MsgBox("hi")')).toBe(false);
    });

    test('blocks embedded credentials', function () {
        expect(_isUrlSafe('https://user:pass@evil.com/data.json')).toBe(false);
        expect(_isUrlSafe('http://admin:secret@192.168.1.1/api')).toBe(false);
    });

    test('rejects empty or non-string input', function () {
        expect(_isUrlSafe('')).toBe(false);
        expect(_isUrlSafe(null)).toBe(false);
        expect(_isUrlSafe(undefined)).toBe(false);
        expect(_isUrlSafe(123)).toBe(false);
    });
});

describe('setDataUrl', function () {
    test('rejects dangerous URLs', function () {
        expect(function () {
            loader.setDataUrl('javascript:alert(1)');
        }).toThrow('Unsafe data URL blocked');
    });

    test('accepts safe URLs', function () {
        expect(function () {
            loader.setDataUrl('safe-data.json');
        }).not.toThrow();
        // Reset
        loader.setDataUrl('bioprint-data.json');
    });
});
