#!/usr/bin/env node
/**
 * Guard against the regression described in GitHub issue #158.
 *
 * The Try page (`Try/index.html`) exposes a dropdown of metric and comparison
 * options. The frontend client (`Try/scripts/runMethod.js`) validates the
 * selected values against a hand-maintained allowlist before building the API
 * path. If those two sets ever drift, the UI silently rejects every query.
 *
 * This script extracts the `<option value="...">` entries from `index.html`
 * under `#property` and `#arithmetic` and compares them with the
 * `VALID_PROPERTIES` / `VALID_ARITHMETIC` arrays in `runMethod.js`. It exits
 * non-zero with a diff if they disagree.
 *
 * Run locally:   node scripts/check-runmethod-allowlist.js
 * Run in CI:     same — designed to be wired into the lint step.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const htmlPath = path.join(repoRoot, 'Try', 'index.html');
const jsPath = path.join(repoRoot, 'Try', 'scripts', 'runMethod.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');

/**
 * Extract `<option value="...">` values from a <select id="..."> block.
 * Tolerant of attribute ordering and whitespace; not a full HTML parser, but
 * sufficient for the narrow, well-formed markup in Try/index.html.
 */
function extractOptions(htmlSrc, selectId) {
    const re = new RegExp(
        '<select\\b[^>]*\\bid=["\']' + selectId + '["\'][^>]*>([\\s\\S]*?)</select>',
        'i'
    );
    const match = re.exec(htmlSrc);
    if (!match) throw new Error('select #' + selectId + ' not found in ' + htmlPath);
    const optRe = /<option\b[^>]*\bvalue=["']([^"']+)["']/g;
    const values = [];
    let m;
    while ((m = optRe.exec(match[1])) !== null) values.push(m[1]);
    return values;
}

/** Extract the contents of a JS array literal declared as `var NAME = [...];`. */
function extractArrayLiteral(jsSrc, name) {
    const re = new RegExp('var\\s+' + name + '\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*;', 'm');
    const match = re.exec(jsSrc);
    if (!match) throw new Error('var ' + name + ' = [...] not found in ' + jsPath);
    const strRe = /['"]([^'"]+)['"]/g;
    const values = [];
    let m;
    while ((m = strRe.exec(match[1])) !== null) values.push(m[1]);
    return values;
}

function diff(label, expected, actual) {
    const expSet = new Set(expected);
    const actSet = new Set(actual);
    const missing = expected.filter((v) => !actSet.has(v));
    const extra = actual.filter((v) => !expSet.has(v));
    if (!missing.length && !extra.length) {
        console.log('  ✓ ' + label + ': allowlist matches (' + expected.length + ' values)');
        return true;
    }
    console.error('  ✗ ' + label + ' allowlist drift:');
    if (missing.length) console.error('      missing from JS: ' + missing.join(', '));
    if (extra.length) console.error('      extra in JS:     ' + extra.join(', '));
    return false;
}

console.log('Checking runMethod allowlists against Try/index.html...');
const htmlProps = extractOptions(html, 'property');
const htmlArith = extractOptions(html, 'arithmetic');
const jsProps = extractArrayLiteral(js, 'VALID_PROPERTIES');
const jsArith = extractArrayLiteral(js, 'VALID_ARITHMETIC');

// Aggregation button labels live in <input value="..."> handlers, not the
// arithmetic <select>. Allow them as a fixed extension to VALID_ARITHMETIC.
const AGGREGATIONS = ['Maximum', 'Minimum', 'Average'];
const expectedArith = htmlArith.concat(AGGREGATIONS);

const ok =
    diff('VALID_PROPERTIES', htmlProps, jsProps) &
    diff('VALID_ARITHMETIC', expectedArith, jsArith);

if (!ok) {
    console.error(
        '\nrunMethod allowlist is out of sync with Try/index.html.\n' +
        'See issue #158 for context. Update Try/scripts/runMethod.js so the\n' +
        'two stay in lock-step, then re-run this check.'
    );
    process.exit(1);
}
console.log('OK');
