/**
 * Tests for scripts/check-runmethod-allowlist.js
 *
 * Background: GitHub issue #158 documented that the JS allowlist in
 * Try/scripts/runMethod.js drifted from the <option> values in
 * Try/index.html, silently breaking every UI query. The drift-checker
 * script is the regression guard. These tests verify that:
 *
 *   1. Running the checker against the real repo passes (sanity).
 *   2. The checker correctly detects "missing in JS" drift.
 *   3. The checker correctly detects "extra in JS" drift.
 *   4. The checker enforces the aggregation-button extension list.
 */
'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const repoRoot = path.resolve(__dirname, '..');
const checkerSrc = path.join(repoRoot, 'scripts', 'check-runmethod-allowlist.js');

function runChecker(cwd) {
    return spawnSync(process.execPath, [path.join(cwd, 'scripts', 'check-runmethod-allowlist.js')], {
        cwd,
        encoding: 'utf8',
    });
}

/**
 * Build a tiny throwaway "repo" with just the files the checker reads:
 *   Try/index.html, Try/scripts/runMethod.js, scripts/check-runmethod-allowlist.js.
 * Mutations happen in-place; nothing leaks back into the real repo.
 */
function scaffold({ htmlProperties, htmlArithmetic, jsProperties, jsArithmetic }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'biobots-allowlist-'));
    fs.mkdirSync(path.join(dir, 'Try', 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });

    const propOptions = htmlProperties.map((v) => `<option value="${v}">${v}</option>`).join('\n');
    const arithOptions = htmlArithmetic.map((v) => `<option value="${v}">${v}</option>`).join('\n');
    fs.writeFileSync(
        path.join(dir, 'Try', 'index.html'),
        `<!DOCTYPE html><html><body>
<select id="property">${propOptions}</select>
<select id="arithmetic">${arithOptions}</select>
</body></html>`
    );

    const propLits = jsProperties.map((v) => `'${v}'`).join(', ');
    const arithLits = jsArithmetic.map((v) => `'${v}'`).join(', ');
    fs.writeFileSync(
        path.join(dir, 'Try', 'scripts', 'runMethod.js'),
        `'use strict';\nvar VALID_PROPERTIES = [${propLits}];\nvar VALID_ARITHMETIC = [${arithLits}];\n`
    );

    fs.copyFileSync(checkerSrc, path.join(dir, 'scripts', 'check-runmethod-allowlist.js'));
    return dir;
}

describe('check-runmethod-allowlist.js (issue #158 regression guard)', () => {
    test('passes against the real repo (allowlists in sync)', () => {
        const result = spawnSync(process.execPath, [checkerSrc], { cwd: repoRoot, encoding: 'utf8' });
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/VALID_PROPERTIES: allowlist matches/);
        expect(result.stdout).toMatch(/VALID_ARITHMETIC: allowlist matches/);
    });

    test('passes on a synthetic in-sync repo', () => {
        const dir = scaffold({
            htmlProperties: ['a', 'b', 'c'],
            htmlArithmetic: ['greater', 'lesser'],
            jsProperties: ['a', 'b', 'c'],
            jsArithmetic: ['greater', 'lesser', 'Maximum', 'Minimum', 'Average'],
        });
        const result = runChecker(dir);
        expect(result.status).toBe(0);
    });

    test('fails when JS is missing a property the HTML offers', () => {
        const dir = scaffold({
            htmlProperties: ['deadPercent', 'livePercent', 'elasticity'],
            htmlArithmetic: ['greater', 'lesser', 'equal'],
            jsProperties: ['deadPercent', 'livePercent'], // elasticity missing
            jsArithmetic: ['greater', 'lesser', 'equal', 'Maximum', 'Minimum', 'Average'],
        });
        const result = runChecker(dir);
        expect(result.status).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(/missing from JS:\s*elasticity/);
    });

    test('fails when JS has a property the HTML does not offer', () => {
        const dir = scaffold({
            htmlProperties: ['a', 'b'],
            htmlArithmetic: ['greater', 'lesser', 'equal'],
            jsProperties: ['a', 'b', 'ghost'], // ghost is extra
            jsArithmetic: ['greater', 'lesser', 'equal', 'Maximum', 'Minimum', 'Average'],
        });
        const result = runChecker(dir);
        expect(result.status).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(/extra in JS:\s*ghost/);
    });

    test('fails when aggregation buttons are missing from arithmetic allowlist', () => {
        const dir = scaffold({
            htmlProperties: ['a'],
            htmlArithmetic: ['greater', 'lesser', 'equal'],
            jsProperties: ['a'],
            jsArithmetic: ['greater', 'lesser', 'equal'], // missing Maximum/Minimum/Average
        });
        const result = runChecker(dir);
        expect(result.status).not.toBe(0);
        expect(result.stderr + result.stdout).toMatch(/missing from JS:\s*Maximum/);
    });

    test('reports drift on stderr so CI surfaces it', () => {
        const dir = scaffold({
            htmlProperties: ['a', 'b'],
            htmlArithmetic: ['greater'],
            jsProperties: ['a'], // b missing
            jsArithmetic: ['greater', 'Maximum', 'Minimum', 'Average'],
        });
        const result = runChecker(dir);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/out of sync with Try\/index\.html/);
    });
});
