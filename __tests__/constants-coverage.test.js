/**
 * docs/shared/constants.js — branch + accessor coverage tests.
 *
 * The pre-existing `__tests__/constants.test.js` exercises constants
 * via `fs.readFileSync` + `eval`, which leaks symbols into the test
 * scope but bypasses Jest's coverage instrumentation. The
 * `constants-commonjs.test.js` regression test uses the real `require`
 * path but only invokes two of the ten `METRIC_DESCRIPTORS` accessors,
 * leaving the rest at 0% function coverage (27% file-level).
 *
 * This file exercises every accessor + every escapeHtml branch via
 * `require()` so coverage reflects reality.
 */
'use strict';

describe('docs/shared/constants — accessor coverage (require path)', function() {
  var constants;

  beforeAll(function() {
    jest.resetModules();
    constants = require('../docs/shared/constants');
  });

  test('every METRIC_DESCRIPTORS accessor returns the correct value', function() {
    var mockPrint = {
      print_data: {
        livePercent: 91.5,
        deadPercent: 8.5,
        elasticity: 4.2,
      },
      print_info: {
        crosslinking: { cl_duration: 25, cl_intensity: 65 },
        pressure: { extruder1: 110, extruder2: 55 },
        resolution: { layerHeight: 0.35, layerNum: 14 },
        wellplate: 96,
      },
    };

    var byKey = {};
    constants.METRIC_DESCRIPTORS.forEach(function(d) { byKey[d.key] = d; });

    // Invoke every accessor exactly once (drives function coverage to 100%).
    expect(byKey.livePercent.get(mockPrint)).toBe(91.5);
    expect(byKey.deadPercent.get(mockPrint)).toBe(8.5);
    expect(byKey.elasticity.get(mockPrint)).toBe(4.2);
    expect(byKey.cl_duration.get(mockPrint)).toBe(25);
    expect(byKey.cl_intensity.get(mockPrint)).toBe(65);
    expect(byKey.extruder1.get(mockPrint)).toBe(110);
    expect(byKey.extruder2.get(mockPrint)).toBe(55);
    expect(byKey.layerHeight.get(mockPrint)).toBe(0.35);
    expect(byKey.layerNum.get(mockPrint)).toBe(14);
    expect(byKey.wellplate.get(mockPrint)).toBe(96);
  });

  test('accessors honor higherBetter directionality metadata', function() {
    // Live% higher better, dead% lower better, elasticity higher better,
    // layerNum higher better. Process-parameters (cl_*, extruder*,
    // layerHeight, wellplate) have no defined direction.
    var byKey = {};
    constants.METRIC_DESCRIPTORS.forEach(function(d) { byKey[d.key] = d; });
    expect(byKey.livePercent.higherBetter).toBe(true);
    expect(byKey.deadPercent.higherBetter).toBe(false);
    expect(byKey.elasticity.higherBetter).toBe(true);
    expect(byKey.layerNum.higherBetter).toBe(true);
    expect(byKey.cl_duration.higherBetter).toBeNull();
    expect(byKey.cl_intensity.higherBetter).toBeNull();
    expect(byKey.extruder1.higherBetter).toBeNull();
    expect(byKey.extruder2.higherBetter).toBeNull();
    expect(byKey.layerHeight.higherBetter).toBeNull();
    expect(byKey.wellplate.higherBetter).toBeNull();
  });

  // ----- escapeHtml: every branch via require path ----------------------

  test('escapeHtml: handles null/undefined (the `str == null` branch)', function() {
    expect(constants.escapeHtml(null)).toBe('');
    expect(constants.escapeHtml(undefined)).toBe('');
  });

  test('escapeHtml: coerces non-strings (numbers, booleans, objects)', function() {
    expect(constants.escapeHtml(0)).toBe('0');
    expect(constants.escapeHtml(42)).toBe('42');
    expect(constants.escapeHtml(false)).toBe('false');
    expect(constants.escapeHtml(true)).toBe('true');
    // Object → uses default String() coercion. We don't pin to a specific
    // toString form for vanilla objects (would couple to Node internals),
    // but the result must be a string and must have HTML specials escaped
    // out of it.
    var obj = {
      toString: function() { return '<script>alert("xss")</script>'; },
    };
    var out = constants.escapeHtml(obj);
    expect(typeof out).toBe('string');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
    expect(out).toContain('&quot;');
  });

  test('escapeHtml: escapes &, <, >, ", \' (every replace() branch)', function() {
    expect(constants.escapeHtml('&')).toBe('&amp;');
    expect(constants.escapeHtml('<')).toBe('&lt;');
    expect(constants.escapeHtml('>')).toBe('&gt;');
    expect(constants.escapeHtml('"')).toBe('&quot;');
    expect(constants.escapeHtml("'")).toBe('&#39;');
  });

  test('escapeHtml: ampersand is escaped first (no double-escape of &lt; → &amp;lt;)', function() {
    // Regression: if ampersand replacement ran *last*, a `<` input would
    // turn into `&lt;` and then the next pass would re-escape the `&`
    // into `&amp;lt;`. The function is correct iff `&` runs first.
    expect(constants.escapeHtml('<')).toBe('&lt;');
    expect(constants.escapeHtml('&<')).toBe('&amp;&lt;');
    expect(constants.escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  test('escapeHtml: passes safe strings through unchanged', function() {
    expect(constants.escapeHtml('plain text')).toBe('plain text');
    expect(constants.escapeHtml('')).toBe('');
    expect(constants.escapeHtml('café 🌱 résumé')).toBe('café 🌱 résumé');
  });

  test('escapeHtml: idempotency of safe input + injection payloads', function() {
    var payloads = [
      '<img src=x onerror=alert(1)>',
      '"><svg/onload=alert(1)>',
      "javascript:alert('xss')",
      '<a href="javascript:alert(1)">click</a>',
    ];
    payloads.forEach(function(p) {
      var escaped = constants.escapeHtml(p);
      expect(escaped).not.toMatch(/<[a-z]/i);     // no remaining open tags
      expect(escaped).not.toContain('"');           // raw quotes are gone
      // Round-trip (escaping an already-escaped string only escapes the &)
      expect(constants.escapeHtml(escaped)).toBe(
        escaped.replace(/&/g, '&amp;')
      );
    });
  });

  // ----- shape sanity over the require path -----------------------------

  test('exports surface is exactly the documented keys', function() {
    expect(Object.keys(constants).sort()).toEqual(
      ['METRICS', 'METRIC_DESCRIPTORS', 'escapeHtml', 'metricColors', 'metricLabels'].sort()
    );
  });
});
