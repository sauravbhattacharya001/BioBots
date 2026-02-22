/**
 * Tests for the BioBots Parameter Optimizer (docs/optimizer.html)
 *
 * Tests: data structures, utility functions, analysis engine,
 * DOM rendering, sort/rankings, recommendations.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'docs', 'optimizer.html'), 'utf8');

function createDOM() {
    return new JSDOM(HTML, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'https://example.com/optimizer.html',
    });
}

function getExports(dom) {
    return dom.window.eval(`
        (function() { return {
            PARAMS: typeof PARAMS !== 'undefined' ? PARAMS : null,
            METRICS: typeof METRICS !== 'undefined' ? METRICS : null,
            getNestedValue: typeof getNestedValue !== 'undefined' ? getNestedValue : null,
            extractParam: typeof extractParam !== 'undefined' ? extractParam : null,
            extractMetric: typeof extractMetric !== 'undefined' ? extractMetric : null,
            sanitize: typeof sanitize !== 'undefined' ? sanitize : null,
            round: typeof round !== 'undefined' ? round : null,
            percentile: typeof percentile !== 'undefined' ? percentile : null,
            mean: typeof mean !== 'undefined' ? mean : null,
            stddev: typeof stddev !== 'undefined' ? stddev : null,
            pearson: typeof pearson !== 'undefined' ? pearson : null,
            analyze: typeof analyze !== 'undefined' ? analyze : null
        }; })()
    `);
}

// ===== Data Structures =====

describe('Optimizer: Data Structures', () => {
    let mod;
    before(() => { mod = getExports(createDOM()); });

    it('PARAMS has 8 parameters', () => {
        assert.equal(mod.PARAMS.length, 8);
    });

    it('each param has required properties', () => {
        for (const p of mod.PARAMS) {
            assert.ok(p.key, 'key missing');
            assert.ok(p.label, 'label missing');
            assert.ok(Array.isArray(p.path), 'path not array');
            assert.ok(p.path.length >= 2, 'path too short');
            assert.ok(p.color, 'color missing');
        }
    });

    it('param keys are unique', () => {
        const keys = mod.PARAMS.map(p => p.key);
        assert.equal(new Set(keys).size, keys.length);
    });

    it('METRICS has 3 metrics', () => {
        const keys = Object.keys(mod.METRICS);
        assert.equal(keys.length, 3);
        assert.ok(mod.METRICS.livePercent);
        assert.ok(mod.METRICS.elasticity);
        assert.ok(mod.METRICS.deadPercent);
    });

    it('livePercent and elasticity are higher=true', () => {
        assert.equal(mod.METRICS.livePercent.higher, true);
        assert.equal(mod.METRICS.elasticity.higher, true);
    });

    it('deadPercent is higher=false (minimize)', () => {
        assert.equal(mod.METRICS.deadPercent.higher, false);
    });

    it('each metric has label and path', () => {
        for (const k of Object.keys(mod.METRICS)) {
            const m = mod.METRICS[k];
            assert.ok(m.label, 'label missing');
            assert.ok(Array.isArray(m.path), 'path not array');
        }
    });
});

// ===== Utility Functions =====

describe('Optimizer: Utilities', () => {
    let mod;
    before(() => { mod = getExports(createDOM()); });

    it('getNestedValue extracts deep values', () => {
        const obj = { a: { b: { c: 42 } } };
        assert.equal(mod.getNestedValue(obj, ['a', 'b', 'c']), 42);
    });

    it('getNestedValue returns null for missing paths', () => {
        assert.equal(mod.getNestedValue({ a: 1 }, ['b', 'c']), null);
    });

    it('getNestedValue handles shallow paths', () => {
        assert.equal(mod.getNestedValue({ x: 5 }, ['x']), 5);
    });

    it('round defaults to 2 decimal places', () => {
        assert.equal(mod.round(3.14159), 3.14);
    });

    it('round with custom decimal places', () => {
        assert.equal(mod.round(3.14159, 3), 3.142);
        assert.equal(mod.round(3.14159, 1), 3.1);
        // round(x, 0) falls back to default 2 since 0 is falsy
        assert.equal(mod.round(3.14159, 0), 3.14);
    });

    it('mean computes correctly', () => {
        assert.equal(mod.mean([2, 4, 6, 8, 10]), 6);
        assert.equal(mod.mean([5]), 5);
    });

    it('stddev computes population std dev', () => {
        const sd = mod.stddev([2, 4, 4, 4, 5, 5, 7, 9]);
        assert.ok(Math.abs(sd - 2.0) < 0.01);
    });

    it('stddev of identical values is 0', () => {
        assert.equal(mod.stddev([5, 5, 5, 5]), 0);
    });

    it('percentile returns correct values', () => {
        const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        assert.equal(mod.percentile(arr, 0), 1);
        assert.equal(mod.percentile(arr, 100), 10);
        assert.equal(mod.percentile(arr, 50), 5.5);
    });

    it('percentile at 25 and 75', () => {
        const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        const p25 = mod.percentile(arr, 25);
        const p75 = mod.percentile(arr, 75);
        assert.ok(p25 >= 20 && p25 <= 35, `p25=${p25}`);
        assert.ok(p75 >= 65 && p75 <= 80, `p75=${p75}`);
    });

    it('pearson returns 1 for perfect positive correlation', () => {
        const xs = [1, 2, 3, 4, 5];
        const ys = [2, 4, 6, 8, 10];
        assert.ok(Math.abs(mod.pearson(xs, ys) - 1.0) < 0.001);
    });

    it('pearson returns -1 for perfect negative correlation', () => {
        const xs = [1, 2, 3, 4, 5];
        const ys = [10, 8, 6, 4, 2];
        assert.ok(Math.abs(mod.pearson(xs, ys) + 1.0) < 0.001);
    });

    it('pearson returns ~0 for uncorrelated data', () => {
        const xs = [1, 2, 3, 4, 5, 6, 7, 8];
        const ys = [5, 3, 7, 2, 8, 1, 6, 4];
        assert.ok(Math.abs(mod.pearson(xs, ys)) < 0.5);
    });

    it('pearson returns 0 for fewer than 3 points', () => {
        assert.equal(mod.pearson([1, 2], [3, 4]), 0);
        assert.equal(mod.pearson([1], [2]), 0);
    });

    it('sanitize escapes HTML', () => {
        assert.equal(mod.sanitize('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
    });
});

// ===== Analysis Engine =====

describe('Optimizer: Analysis Engine', () => {
    let mod;
    before(() => { mod = getExports(createDOM()); });

    // Create synthetic test data
    function makeData(n) {
        var records = [];
        for (var i = 0; i < n; i++) {
            records.push({
                print_data: {
                    livePercent: 10 + (i / n) * 80, // 10-90 range
                    deadPercent: 90 - (i / n) * 80,
                    elasticity: 20 + (i / n) * 60
                },
                print_info: {
                    pressure: { extruder1: 30 + i * 0.5, extruder2: 80 + i * 0.3 },
                    temperature: 20 + (i % 10) * 3,
                    speed: 5 + (i % 8) * 2,
                    crosslinking: {
                        cl_intensity: (i % 5) * 10,
                        cl_duration: (i % 5) * 5000,
                        cl_enabled: (i % 5) > 0
                    },
                    resolution: { layerHeight: 0.1 + (i % 10) * 0.1, layerNum: 10 + (i % 5) * 10 }
                }
            });
        }
        return records;
    }

    it('analyze returns valid result structure', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        assert.ok(result);
        assert.equal(result.metricKey, 'livePercent');
        assert.equal(result.metricLabel, 'Live Cell %');
        assert.equal(result.higher, true);
        assert.equal(result.threshold, 50);
        assert.equal(result.topPct, 20);
        assert.equal(result.totalRecords, 100);
        assert.equal(result.topCount, 20);
    });

    it('analyze with higher=true selects highest as top', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 10);
        assert.ok(result.topMean > result.metricMean, 'top mean should exceed overall mean');
    });

    it('analyze with higher=false (deadPercent) selects lowest as top', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'deadPercent', 50, 10);
        assert.ok(result.topMean < result.metricMean, `top ${result.topMean} should be < overall ${result.metricMean}`);
    });

    it('analyze computes threshold percentage', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        assert.ok(result.thresholdPct >= 0 && result.thresholdPct <= 100);
        assert.ok(result.thresholdCount >= 0 && result.thresholdCount <= 100);
    });

    it('analyze returns params sorted by impact', () => {
        const data = makeData(200);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        for (let i = 1; i < result.params.length; i++) {
            assert.ok(result.params[i].impact <= result.params[i - 1].impact,
                `param ${i} impact ${result.params[i].impact} > prev ${result.params[i - 1].impact}`);
        }
    });

    it('analyze includes all 8 parameters', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        assert.equal(result.params.length, 8);
    });

    it('each param result has required fields', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        for (const p of result.params) {
            assert.ok('key' in p);
            assert.ok('label' in p);
            assert.ok('correlation' in p);
            assert.ok('allMin' in p);
            assert.ok('allMax' in p);
            assert.ok('allMean' in p);
            assert.ok('topMin' in p);
            assert.ok('topMax' in p);
            assert.ok('topMean' in p);
            assert.ok('topP25' in p);
            assert.ok('topP75' in p);
            assert.ok('impact' in p);
        }
    });

    it('param correlations are between -1 and 1', () => {
        const data = makeData(200);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        for (const p of result.params) {
            assert.ok(p.correlation >= -1 && p.correlation <= 1, `${p.key} r=${p.correlation}`);
        }
    });

    it('top range P25 <= P75', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        for (const p of result.params) {
            assert.ok(p.topP25 <= p.topP75, `${p.key}: P25=${p.topP25} > P75=${p.topP75}`);
        }
    });

    it('allMin <= topMin and topMax <= allMax', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        for (const p of result.params) {
            assert.ok(p.topMin >= p.allMin, `${p.key}: topMin=${p.topMin} < allMin=${p.allMin}`);
            assert.ok(p.topMax <= p.allMax, `${p.key}: topMax=${p.topMax} > allMax=${p.allMax}`);
        }
    });

    it('analyze with 100% threshold on livePercent matches few', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 100, 20);
        assert.ok(result.thresholdCount <= result.totalRecords * 0.05, 'very few should hit 100%');
    });

    it('analyze with 0% threshold on livePercent matches all', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 0, 20);
        assert.equal(result.thresholdCount, result.totalRecords);
    });

    it('analyze elasticity works', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'elasticity', 50, 20);
        assert.equal(result.metricKey, 'elasticity');
        assert.equal(result.metricLabel, 'Elasticity');
        assert.ok(result.topMean > 0);
    });

    it('handles single record gracefully', () => {
        const data = makeData(1);
        const result = mod.analyze(data, 'livePercent', 0, 100);
        assert.equal(result.totalRecords, 1);
        assert.equal(result.topCount, 1);
    });
});

// ===== DOM Rendering =====

describe('Optimizer: DOM Rendering', () => {
    let dom, doc;
    before(() => { dom = createDOM(); doc = dom.window.document; });

    it('page title contains Parameter Optimizer', () => {
        assert.ok(doc.title.includes('Parameter Optimizer'));
    });

    it('has navigation links', () => {
        const nav = doc.querySelector('.nav');
        assert.ok(nav);
        const links = nav.querySelectorAll('a');
        assert.ok(links.length >= 8);
    });

    it('optimizer nav link is active', () => {
        const active = doc.querySelector('.nav a.active');
        assert.ok(active);
        assert.ok(active.getAttribute('href').includes('optimizer'));
    });

    it('has target metric select', () => {
        const select = doc.getElementById('targetMetric');
        assert.ok(select);
        assert.ok(select.querySelectorAll('option').length >= 3);
    });

    it('has threshold input', () => {
        const input = doc.getElementById('threshold');
        assert.ok(input);
        assert.equal(input.type, 'number');
        assert.equal(input.value, '50');
    });

    it('has top percent select', () => {
        const select = doc.getElementById('topPercent');
        assert.ok(select);
    });

    it('has optimize button', () => {
        const btn = doc.getElementById('optimizeBtn');
        assert.ok(btn);
        assert.ok(btn.textContent.includes('Optimize'));
    });

    it('has reset button', () => {
        const btn = doc.getElementById('resetBtn');
        assert.ok(btn);
    });

    it('results container shows initial message', () => {
        const results = doc.getElementById('results');
        assert.ok(results);
        assert.ok(results.textContent.includes('Configure'));
    });

    it('has footer with source link', () => {
        const footer = doc.querySelector('.footer');
        assert.ok(footer);
        assert.ok(footer.textContent.includes('BioBots'));
    });

    it('has lang=en', () => {
        assert.equal(doc.documentElement.getAttribute('lang'), 'en');
    });

    it('has viewport meta', () => {
        assert.ok(doc.querySelector('meta[name="viewport"]'));
    });

    it('has charset', () => {
        assert.ok(doc.querySelector('meta[charset]'));
    });
});

// ===== renderResults with Synthetic Data =====

describe('Optimizer: Rendered Results', () => {
    let dom, doc, mod;

    before(() => {
        dom = createDOM();
        doc = dom.window.document;
        mod = getExports(dom);

        // Create synthetic data and run analysis
        var records = [];
        for (var i = 0; i < 50; i++) {
            records.push({
                print_data: { livePercent: 10 + i * 1.6, deadPercent: 90 - i * 1.6, elasticity: 30 + i * 0.8 },
                print_info: {
                    pressure: { extruder1: 30 + i, extruder2: 80 + i * 0.5 },
                    temperature: 20 + (i % 10) * 3,
                    speed: 5 + (i % 8) * 2,
                    crosslinking: { cl_intensity: (i % 5) * 10, cl_duration: (i % 5) * 5000, cl_enabled: true },
                    resolution: { layerHeight: 0.2 + (i % 5) * 0.2, layerNum: 20 + (i % 5) * 5 }
                }
            });
        }

        var result = mod.analyze(records, 'livePercent', 50, 20);
        dom.window.eval('renderResults(' + JSON.stringify(result) + ')');
    });

    it('renders overview cards', () => {
        const cards = doc.querySelectorAll('.card');
        assert.ok(cards.length >= 4, `got ${cards.length} cards`);
    });

    it('renders impact chart canvas', () => {
        assert.ok(doc.getElementById('impactChart'));
    });

    it('renders correlation chart canvas', () => {
        assert.ok(doc.getElementById('corrChart'));
    });

    it('renders parameter table', () => {
        const table = doc.querySelector('.param-table');
        assert.ok(table);
        const rows = table.querySelectorAll('tbody tr');
        assert.equal(rows.length, 8);
    });

    it('table has optimal range column', () => {
        const headers = doc.querySelectorAll('.param-table th');
        const texts = Array.from(headers).map(h => h.textContent);
        assert.ok(texts.some(t => t.includes('Optimal')));
    });

    it('renders range bars', () => {
        const bars = doc.querySelectorAll('.range-bar');
        assert.ok(bars.length >= 8, `got ${bars.length} range bars`);
    });

    it('renders recommendation cards', () => {
        const recs = doc.querySelectorAll('.rec-card');
        assert.ok(recs.length >= 2, `got ${recs.length} recs`);
    });

    it('recommendation cards have impact badges', () => {
        const badges = doc.querySelectorAll('.impact-badge');
        assert.ok(badges.length >= 2);
    });

    it('overview cards contain key metrics', () => {
        const text = doc.querySelector('.cards').textContent;
        assert.ok(text.includes('Total Records'));
        assert.ok(text.includes('Top'));
    });
});

// ===== HTML Structure =====

describe('Optimizer: HTML Structure', () => {
    it('has DOCTYPE', () => {
        assert.match(HTML, /<!DOCTYPE html>/i);
    });

    it('has favicon', () => {
        assert.match(HTML, /rel="icon"/);
    });

    it('has ARIA role on nav', () => {
        const dom = createDOM();
        const nav = dom.window.document.querySelector('[role="navigation"]');
        assert.ok(nav);
    });

    it('nav has aria-label', () => {
        const dom = createDOM();
        const nav = dom.window.document.querySelector('[aria-label]');
        assert.ok(nav);
    });
});
