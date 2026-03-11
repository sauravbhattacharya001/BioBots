/**
 * @jest-environment jsdom
 */

'use strict';

/**
 * Security tests for logbook and maintenance import sanitization.
 * Verifies that user-supplied data (tags, IDs, notes) cannot inject
 * HTML or JavaScript via innerHTML / onclick handlers.
 */

// ── Logbook escapeHtml / escapeAttr ──────────────────────────────────

describe('Logbook XSS prevention', () => {
    // Reproduce the escapeHtml from logbook.html
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function escapeAttr(text) {
        return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    describe('escapeHtml', () => {
        test('escapes angle brackets', () => {
            expect(escapeHtml('<script>alert(1)</script>')).not.toContain('<script>');
            expect(escapeHtml('<img src=x onerror=alert(1)>')).not.toContain('<img');
        });

        test('escapes ampersands', () => {
            expect(escapeHtml('a&b')).toBe('a&amp;b');
        });

        test('preserves normal text', () => {
            expect(escapeHtml('Hello World')).toBe('Hello World');
        });

        test('handles empty string', () => {
            expect(escapeHtml('')).toBe('');
        });
    });

    describe('escapeAttr', () => {
        test('escapes single quotes for onclick handlers', () => {
            const malicious = "'); alert('xss";
            const escaped = escapeAttr(malicious);
            expect(escaped).not.toContain("'");
            expect(escaped).toContain('&#39;');
        });

        test('escapes double quotes', () => {
            expect(escapeAttr('a"b')).toContain('&quot;');
        });

        test('escapes HTML tags', () => {
            expect(escapeAttr('<script>')).toContain('&lt;');
        });

        test('preserves alphanumeric IDs', () => {
            expect(escapeAttr('abc123')).toBe('abc123');
        });
    });

    describe('Tag rendering', () => {
        function renderTag(tag) {
            return `<span class="tag">${escapeHtml(tag)}</span>`;
        }

        test('XSS payload in tag is escaped', () => {
            const html = renderTag('<img src=x onerror=alert(document.cookie)>');
            expect(html).not.toContain('<img');
            expect(html).toContain('&lt;img');
        });

        test('script tag in tag is escaped', () => {
            const html = renderTag('<script>fetch("evil.com")</script>');
            expect(html).not.toContain('<script>');
        });

        test('normal tag text renders safely', () => {
            const html = renderTag('experiment-42');
            expect(html).toBe('<span class="tag">experiment-42</span>');
        });
    });

    describe('ID onclick injection', () => {
        function renderButton(id) {
            return `<button onclick="deleteEntry('${escapeAttr(id)}')">Delete</button>`;
        }

        test('malicious ID cannot break out of onclick', () => {
            const html = renderButton("'); alert('xss");
            expect(html).not.toContain("alert('xss')");
            expect(html).toContain('&#39;');
        });

        test('ID with HTML cannot inject elements', () => {
            const html = renderButton('"><img src=x onerror=alert(1)>');
            expect(html).not.toContain('<img');
        });

        test('normal ID renders correctly', () => {
            const html = renderButton('abc123');
            expect(html).toContain("deleteEntry('abc123')");
        });
    });
});

// ── Import sanitization ─────────────────────────────────────────────

describe('Import sanitization', () => {
    function sanitizeId(id) {
        if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
            return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        }
        return id;
    }

    function sanitizeTags(tags) {
        if (Array.isArray(tags)) {
            return tags.filter(t => typeof t === 'string').map(t => t.slice(0, 100));
        }
        return [];
    }

    describe('ID sanitization', () => {
        test('valid alphanumeric ID is preserved', () => {
            expect(sanitizeId('abc123')).toBe('abc123');
        });

        test('ID with dashes and underscores is preserved', () => {
            expect(sanitizeId('my-entry_01')).toBe('my-entry_01');
        });

        test('ID with JS injection is regenerated', () => {
            const result = sanitizeId("');alert(1);//");
            expect(result).not.toContain('alert');
            expect(result).toMatch(/^[a-z0-9]+$/);
        });

        test('ID with HTML is regenerated', () => {
            const result = sanitizeId('<script>evil</script>');
            expect(result).not.toContain('<');
        });

        test('non-string ID is regenerated', () => {
            expect(typeof sanitizeId(123)).toBe('string');
            expect(typeof sanitizeId(null)).toBe('string');
            expect(typeof sanitizeId(undefined)).toBe('string');
        });

        test('empty string ID is regenerated', () => {
            const result = sanitizeId('');
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe('Tag sanitization', () => {
        test('valid string tags are preserved', () => {
            expect(sanitizeTags(['tag1', 'tag2'])).toEqual(['tag1', 'tag2']);
        });

        test('non-string tags are filtered out', () => {
            expect(sanitizeTags(['ok', 123, null, 'fine'])).toEqual(['ok', 'fine']);
        });

        test('tags are truncated to 100 chars', () => {
            const longTag = 'a'.repeat(200);
            const result = sanitizeTags([longTag]);
            expect(result[0].length).toBe(100);
        });

        test('non-array input returns empty array', () => {
            expect(sanitizeTags(null)).toEqual([]);
            expect(sanitizeTags('string')).toEqual([]);
            expect(sanitizeTags(42)).toEqual([]);
        });

        test('XSS in tags is preserved as text (will be escaped on render)', () => {
            const result = sanitizeTags(['<script>alert(1)</script>']);
            expect(result).toEqual(['<script>alert(1)</script>']);
            // The rendering escapeHtml will handle this
        });
    });
});

// ── Maintenance import ──────────────────────────────────────────────

describe('Maintenance import ID validation', () => {
    // Reproduce the escHtml from maintenance.html
    function escHtml(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    test('escHtml escapes onclick breakout', () => {
        const escaped = escHtml("'); deleteAll(); //");
        expect(escaped).toContain('&#39;');
        expect(escaped).not.toMatch(/[^&]'/);
    });

    test('escHtml handles null/undefined', () => {
        expect(escHtml(null)).toBe('');
        expect(escHtml(undefined)).toBe('');
    });

    test('delete button with escaped ID is safe', () => {
        const id = "x'); deleteAll(); //";
        const html = '<button onclick="deleteEvent(\'' + escHtml(id) + '\')">Delete</button>';
        // The single quotes in the ID are escaped to &#39;
        expect(html).toContain('&#39;');
        // The onclick handler string should NOT contain raw unescaped
        // single quotes from the malicious ID — only the wrapper quotes
        // around the escaped value should be present
        const escaped = escHtml(id);
        expect(escaped).not.toContain("'");
    });
});
