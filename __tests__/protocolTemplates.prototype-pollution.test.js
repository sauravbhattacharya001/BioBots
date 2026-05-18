'use strict';

/**
 * Regression tests for protocolTemplates prototype-pollution / inherited-key
 * bypass (security_fix, gardener run 4155).
 *
 * Before the fix:
 *   - customize() used `if (tpl.parameters[key])` which resolved inherited
 *     keys such as `toString`, `hasOwnProperty`, `valueOf` to functions
 *     on Object.prototype. The branch was taken, validation was skipped,
 *     and `tpl.parameters[key].value = val` polluted Object.prototype.
 *   - addTemplate() used `if (TEMPLATES[id])` which similarly accepted
 *     inherited ids, and `customTemplates[id] = ...` could mutate the
 *     [[Prototype]] when id was '__proto__'.
 */

var mod = require('../docs/shared/protocolTemplates');

describe('protocolTemplates — prototype-pollution defense', function () {
    var lib;
    beforeEach(function () { lib = mod.createProtocolTemplateLibrary(); });

    afterEach(function () {
        // Defensive: scrub any pollution a failing test might leak so we
        // don't poison the rest of the suite.
        delete Object.prototype.value;
        delete Object.prototype.polluted;
    });

    describe('customize() rejects inherited keys', function () {
        test('"toString" override is ignored and does not pollute Object.prototype', function () {
            var before = Object.prototype.toString;
            lib.customize('bioink-prep-alginate', { toString: 999 });
            expect(Object.prototype.toString).toBe(before);
            // Sanity: a fresh object's toString is still the built-in function.
            expect(typeof ({}).toString).toBe('function');
            // And the built-in function does NOT have a .value of 999.
            expect(({}).toString.value).toBeUndefined();
        });

        test('"hasOwnProperty" override is ignored', function () {
            var before = Object.prototype.hasOwnProperty;
            lib.customize('bioink-prep-alginate', { hasOwnProperty: 1 });
            expect(Object.prototype.hasOwnProperty).toBe(before);
            expect(({}).hasOwnProperty.value).toBeUndefined();
        });

        test('"valueOf" override is ignored', function () {
            var before = Object.prototype.valueOf;
            lib.customize('bioink-prep-alginate', { valueOf: 42 });
            expect(Object.prototype.valueOf).toBe(before);
            expect(({}).valueOf.value).toBeUndefined();
        });

        test('"__proto__" override is rejected (DANGEROUS_KEYS)', function () {
            lib.customize('bioink-prep-alginate', { __proto__: { polluted: true } });
            expect(({}).polluted).toBeUndefined();
        });

        test('legitimate own-property override still works', function () {
            var r = lib.customize('bioink-prep-alginate', { concentration: 3.0 });
            expect(r.parameters.concentration.value).toBe(3.0);
        });

        test('inherited overrides on a prototype-chained input are skipped', function () {
            function Bag() {}
            Bag.prototype.concentration = 9.9;     // inherited, not own
            var overrides = new Bag();
            var r = lib.customize('bioink-prep-alginate', overrides);
            // concentration came from prototype, so override is ignored;
            // the default value (2 in the built-in template) is preserved.
            expect(r.parameters.concentration.value).not.toBe(9.9);
        });
    });

    describe('addTemplate() rejects dangerous ids', function () {
        var validTpl = {
            name: 'x', category: 'misc',
            steps: [{ step: 1, action: 'do x', duration: 1, unit: 'min' }]
        };

        test('"__proto__" id is rejected and does not mutate [[Prototype]]', function () {
            var r = lib.addTemplate('__proto__', validTpl);
            expect(r.success).toBe(false);
            expect(({}).name).toBeUndefined();
            expect(({}).steps).toBeUndefined();
        });

        test('"constructor" id is rejected', function () {
            var r = lib.addTemplate('constructor', validTpl);
            expect(r.success).toBe(false);
        });

        test('"prototype" id is rejected', function () {
            var r = lib.addTemplate('prototype', validTpl);
            expect(r.success).toBe(false);
        });

        test('non-string id is rejected', function () {
            var r = lib.addTemplate({}, validTpl);
            expect(r.success).toBe(false);
        });

        test('cannot overwrite a built-in template (own-property check)', function () {
            var r = lib.addTemplate('cell-thawing', validTpl);
            expect(r.success).toBe(false);
            expect(r.error).toMatch(/built-in/);
        });

        test('id matching an inherited Object.prototype key is allowed (not in TEMPLATES)', function () {
            // Before the fix, `if (TEMPLATES['toString'])` was truthy and
            // incorrectly reported "Cannot overwrite built-in template".
            var r = lib.addTemplate('toString', validTpl);
            expect(r.success).toBe(true);
            expect(lib.getTemplate('toString').name).toBe('x');
        });

        test('legitimate custom template still works', function () {
            var r = lib.addTemplate('custom-foo', validTpl);
            expect(r.success).toBe(true);
            expect(lib.getTemplate('custom-foo').name).toBe('x');
        });
    });
});
