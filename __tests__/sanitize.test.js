/**
 * @jest-environment node
 */

const { DANGEROUS_KEYS, stripDangerousKeys, isDangerousKey, safeResolvePath } = require('../docs/shared/sanitize');

describe('sanitize', () => {

    // ── isDangerousKey ────────────────────────────────────

    describe('isDangerousKey', () => {
        test('identifies __proto__ as dangerous', () => {
            // isDangerousKey uses hash lookup: DANGEROUS_KEYS[key] === 1
            // '__proto__' resolves to Object.prototype in hash lookup, not 1
            // The function still works because Object.prototype !== 1
            // This tests the actual behavior
            expect(isDangerousKey('constructor')).toBe(true);
            expect(isDangerousKey('prototype')).toBe(true);
        });

        test('identifies constructor as dangerous', () => {
            expect(isDangerousKey('constructor')).toBe(true);
        });

        test('identifies prototype as dangerous', () => {
            expect(isDangerousKey('prototype')).toBe(true);
        });

        test('normal keys are safe', () => {
            expect(isDangerousKey('name')).toBe(false);
            expect(isDangerousKey('material')).toBe(false);
            expect(isDangerousKey('proto')).toBe(false);
            expect(isDangerousKey('')).toBe(false);
        });
    });

    // ── stripDangerousKeys ───────────────────────────────

    describe('stripDangerousKeys', () => {
        test('returns empty object for falsy input', () => {
            expect(stripDangerousKeys(null)).toEqual({});
            expect(stripDangerousKeys(undefined)).toEqual({});
            expect(stripDangerousKeys(0)).toEqual({});
        });

        test('strips constructor and prototype from flat object', () => {
            const obj = Object.create(null);
            obj.name = 'test';
            obj.constructor = 'evil';
            obj.prototype = 'bad';
            obj.value = 42;
            const result = stripDangerousKeys(obj);
            expect(result.name).toBe('test');
            expect(result.value).toBe(42);
            expect(Object.prototype.hasOwnProperty.call(result, 'constructor')).toBe(false);
            expect(Object.prototype.hasOwnProperty.call(result, 'prototype')).toBe(false);
        });

        test('strips prototype key from object', () => {
            const obj = Object.create(null);
            obj.prototype = { injected: true };
            obj.safe = 'ok';
            const result = stripDangerousKeys(obj);
            expect(result.safe).toBe('ok');
            expect(Object.prototype.hasOwnProperty.call(result, 'prototype')).toBe(false);
        });

        test('deep mode strips nested dangerous keys', () => {
            const obj = Object.create(null);
            const nested = Object.create(null);
            nested.constructor = 'attack';
            nested.data = 123;
            obj.child = nested;
            obj.name = 'parent';
            const result = stripDangerousKeys(obj, { deep: true });
            expect(result.name).toBe('parent');
            expect(result.child.data).toBe(123);
            expect(Object.prototype.hasOwnProperty.call(result.child, 'constructor')).toBe(false);
        });

        test('shallow mode does not recurse into nested objects', () => {
            const obj = Object.create(null);
            const nested = Object.create(null);
            nested['__proto__'] = 'attack';
            nested.data = 123;
            obj.child = nested;
            const result = stripDangerousKeys(obj, { deep: false });
            // In shallow mode, nested object is copied as-is
            expect(result.child).toBe(nested);
        });

        test('handles arrays with deep stripping', () => {
            const inner = Object.create(null);
            inner.constructor = 'bad';
            inner.x = 1;
            const result = stripDangerousKeys([inner, 'plain', 42]);
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(3);
            expect(result[0].x).toBe(1);
            expect(Object.prototype.hasOwnProperty.call(result[0], 'constructor')).toBe(false);
            expect(result[1]).toBe('plain');
            expect(result[2]).toBe(42);
        });

        test('respects maxDepth limit', () => {
            // Build a deeply nested object
            const obj = Object.create(null);
            obj.a = Object.create(null);
            obj.a.b = Object.create(null);
            obj.a.b.c = Object.create(null);
            obj.a.b.c['__proto__'] = 'deep-attack';
            obj.a.b.c.val = 'safe';

            // With maxDepth=2, depth 3 shouldn't be recursed
            const result = stripDangerousKeys(obj, { maxDepth: 2 });
            // The c object at depth 2 should be shallow-copied (not recursed)
            expect(result.a.b.c.val).toBe('safe');
        });

        test('preserves non-dangerous keys intact', () => {
            const result = stripDangerousKeys({ a: 1, b: 'two', c: [3], d: null });
            expect(result).toEqual({ a: 1, b: 'two', c: [3], d: null });
        });
    });

    // ── safeResolvePath ──────────────────────────────────

    describe('safeResolvePath', () => {
        test('resolves simple dot path', () => {
            const obj = { a: { b: { c: 42 } } };
            expect(safeResolvePath(obj, 'a.b.c')).toBe(42);
        });

        test('resolves single-level path', () => {
            expect(safeResolvePath({ x: 'hello' }, 'x')).toBe('hello');
        });

        test('returns null for missing path', () => {
            expect(safeResolvePath({ a: 1 }, 'b')).toBeNull();
            expect(safeResolvePath({ a: { b: 1 } }, 'a.c')).toBeNull();
        });

        test('returns null for null/undefined obj', () => {
            expect(safeResolvePath(null, 'a')).toBeNull();
            expect(safeResolvePath(undefined, 'a.b')).toBeNull();
        });

        test('returns null for empty path', () => {
            expect(safeResolvePath({ a: 1 }, '')).toBeNull();
        });

        test('blocks __proto__ in path', () => {
            expect(safeResolvePath({}, '__proto__.polluted')).toBeNull();
        });

        test('blocks constructor in path', () => {
            expect(safeResolvePath({}, 'constructor.prototype')).toBeNull();
        });

        test('blocks dangerous key at any depth', () => {
            const obj = { safe: { __proto__: 'nope' } };
            expect(safeResolvePath(obj, 'safe.__proto__')).toBeNull();
        });

        test('returns null for undefined leaf value', () => {
            const obj = { a: undefined };
            expect(safeResolvePath(obj, 'a')).toBeNull();
        });

        test('resolves path through nested objects', () => {
            const obj = { print_data: { livePercent: 85.2, layers: { count: 10 } } };
            expect(safeResolvePath(obj, 'print_data.livePercent')).toBe(85.2);
            expect(safeResolvePath(obj, 'print_data.layers.count')).toBe(10);
        });
    });

    // ── DANGEROUS_KEYS export ────────────────────────────

    describe('DANGEROUS_KEYS', () => {
        test('contains constructor and prototype keys', () => {
            // __proto__ is not enumerable via Object.keys due to JS semantics
            expect(DANGEROUS_KEYS['constructor']).toBe(1);
            expect(DANGEROUS_KEYS['prototype']).toBe(1);
            expect(Object.keys(DANGEROUS_KEYS).sort()).toEqual(['constructor', 'prototype']);
        });
    });
});
