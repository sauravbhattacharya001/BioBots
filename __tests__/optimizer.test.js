/**
 * @jest-environment jsdom
 *
 * Tests for the BioBots Parameter Optimizer (docs/optimizer.html)
 *
 * Tests: data structures, utility functions, analysis engine,
 * DOM rendering, sort/rankings, recommendations.
 */

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
    beforeAll(() => { mod = getExports(createDOM()); });

    it('PARAMS has 8 parameters', () => {
        expect(mod.PARAMS.length).toBe(8);
    });

    it('each param has required properties', () => {
        for (const p of mod.PARAMS) {
            expect(p.key).toBeTruthy();
            expect(p.label).toBeTruthy();
            expect(Array.isArray(p.path)).toBeTruthy();
            expect(p.path.length >= 2).toBeTruthy();
            expect(p.color).toBeTruthy();
        }
    });

    it('param keys are unique', () => {
        const keys = mod.PARAMS.map(p => p.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('METRICS has 3 metrics', () => {
        const keys = Object.keys(mod.METRICS);
        expect(keys.length).toBe(3);
        expect(mod.METRICS.livePercent).toBeTruthy();
        expect(mod.METRICS.elasticity).toBeTruthy();
        expect(mod.METRICS.deadPercent).toBeTruthy();
    });

    it('livePercent and elasticity are higher=true', () => {
        expect(mod.METRICS.livePercent.higher).toBe(true);
        expect(mod.METRICS.elasticity.higher).toBe(true);
    });

    it('deadPercent is higher=false (minimize)', () => {
        expect(mod.METRICS.deadPercent.higher).toBe(false);
    });

    it('each metric has label and path', () => {
        for (const k of Object.keys(mod.METRICS)) {
            const m = mod.METRICS[k];
            expect(m.label).toBeTruthy();
            expect(Array.isArray(m.path)).toBeTruthy();
        }
    });
});

// ===== Utility Functions =====

describe('Optimizer: Utilities', () => {
    let mod;
    beforeAll(() => { mod = getExports(createDOM()); });

    it('getNestedValue extracts deep values', () => {
        const obj = { a: { b: { c: 42 } } };
        expect(mod.getNestedValue(obj, ['a', 'b', 'c'])).toBe(42);
    });

    it('getNestedValue returns null for missing paths', () => {
        expect(mod.getNestedValue({ a: 1 }, ['b', 'c'])).toBe(null);
    });

    it('getNestedValue handles shallow paths', () => {
        expect(mod.getNestedValue({ x: 5 }, ['x'])).toBe(5);
    });

    it('round defaults to 2 decimal places', () => {
        expect(mod.round(3.14159)).toBe(3.14);
    });

    it('round with custom decimal places', () => {
        expect(mod.round(3.14159, 3)).toBe(3.142);
        expect(mod.round(3.14159, 1)).toBe(3.1);
        // round(x, 0) falls back to default 2 since 0 is falsy
        expect(mod.round(3.14159, 0)).toBe(3.14);
    });

    it('mean computes correctly', () => {
        expect(mod.mean([2, 4, 6, 8, 10])).toBe(6);
        expect(mod.mean([5])).toBe(5);
    });

    it('stddev computes population std dev', () => {
        const sd = mod.stddev([2, 4, 4, 4, 5, 5, 7, 9]);
        expect(Math.abs(sd - 2.0) < 0.01).toBeTruthy();
    });

    it('stddev of identical values is 0', () => {
        expect(mod.stddev([5, 5, 5, 5])).toBe(0);
    });

    it('percentile returns correct values', () => {
        const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        expect(mod.percentile(arr, 0)).toBe(1);
        expect(mod.percentile(arr, 100)).toBe(10);
        expect(mod.percentile(arr, 50)).toBe(5.5);
    });

    it('percentile at 25 and 75', () => {
        const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        const p25 = mod.percentile(arr, 25);
        const p75 = mod.percentile(arr, 75);
        expect(p25 >= 20 && p25 <= 35).toBeTruthy();
        expect(p75 >= 65 && p75 <= 80).toBeTruthy();
    });

    it('pearson returns 1 for perfect positive correlation', () => {
        const xs = [1, 2, 3, 4, 5];
        const ys = [2, 4, 6, 8, 10];
        expect(Math.abs(mod.pearson(xs, ys) - 1.0) < 0.001).toBeTruthy();
    });

    it('pearson returns -1 for perfect negative correlation', () => {
        const xs = [1, 2, 3, 4, 5];
        const ys = [10, 8, 6, 4, 2];
        expect(Math.abs(mod.pearson(xs, ys) + 1.0) < 0.001).toBeTruthy();
    });

    it('pearson returns ~0 for uncorrelated data', () => {
        const xs = [1, 2, 3, 4, 5, 6, 7, 8];
        const ys = [5, 3, 7, 2, 8, 1, 6, 4];
        expect(Math.abs(mod.pearson(xs, ys)) < 0.5).toBeTruthy();
    });

    it('pearson returns 0 for fewer than 3 points', () => {
        expect(mod.pearson([1, 2], [3, 4])).toBe(0);
        expect(mod.pearson([1], [2])).toBe(0);
    });

    it('sanitize escapes HTML', () => {
        expect(mod.sanitize('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });
});

// ===== Analysis Engine =====

describe('Optimizer: Analysis Engine', () => {
    let mod;
    beforeAll(() => { mod = getExports(createDOM()); });

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
        expect(result).toBeTruthy();
        expect(result.metricKey).toBe('livePercent');
        expect(result.metricLabel).toBe('Live Cell %');
        expect(result.higher).toBe(true);
        expect(result.threshold).toBe(50);
        expect(result.topPct).toBe(20);
        expect(result.totalRecords).toBe(100);
        expect(result.topCount).toBe(20);
    });

    it('analyze with higher=true selects highest as top', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 10);
        expect(result.topMean > result.metricMean).toBeTruthy();
    });

    it('analyze with higher=false (deadPercent) selects lowest as top', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'deadPercent', 50, 10);
        expect(result.topMean < result.metricMean).toBeTruthy();
    });

    it('analyze computes threshold percentage', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        expect(result.thresholdPct >= 0 && result.thresholdPct <= 100).toBeTruthy();
        expect(result.thresholdCount >= 0 && result.thresholdCount <= 100).toBeTruthy();
    });

    it('analyze returns params sorted by impact', () => {
        const data = makeData(200);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        for (let i = 1; i < result.params.length; i++) {
            expect(result.params[i].impact <= result.params[i - 1].impact).toBeTruthy();
        }
    });

    it('analyze includes all 8 parameters', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        expect(result.params.length).toBe(8);
    });

    it('each param result has required fields', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        for (const p of result.params) {
            expect('key' in p).toBeTruthy();
            expect('label' in p).toBeTruthy();
            expect('correlation' in p).toBeTruthy();
            expect('allMin' in p).toBeTruthy();
            expect('allMax' in p).toBeTruthy();
            expect('allMean' in p).toBeTruthy();
            expect('topMin' in p).toBeTruthy();
            expect('topMax' in p).toBeTruthy();
            expect('topMean' in p).toBeTruthy();
            expect('topP25' in p).toBeTruthy();
            expect('topP75' in p).toBeTruthy();
            expect('impact' in p).toBeTruthy();
        }
    });

    it('param correlations are between -1 and 1', () => {
        const data = makeData(200);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        for (const p of result.params) {
            expect(p.correlation >= -1 && p.correlation <= 1).toBeTruthy();
        }
    });

    it('top range P25 <= P75', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        for (const p of result.params) {
            expect(p.topP25 <= p.topP75).toBeTruthy();
        }
    });

    it('allMin <= topMin and topMax <= allMax', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 50, 20);
        for (const p of result.params) {
            expect(p.topMin >= p.allMin).toBeTruthy();
            expect(p.topMax <= p.allMax).toBeTruthy();
        }
    });

    it('analyze with 100% threshold on livePercent matches few', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 100, 20);
        expect(result.thresholdCount <= result.totalRecords * 0.05).toBeTruthy();
    });

    it('analyze with 0% threshold on livePercent matches all', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'livePercent', 0, 20);
        expect(result.thresholdCount).toBe(result.totalRecords);
    });

    it('analyze elasticity works', () => {
        const data = makeData(100);
        const result = mod.analyze(data, 'elasticity', 50, 20);
        expect(result.metricKey).toBe('elasticity');
        expect(result.metricLabel).toBe('Elasticity');
        expect(result.topMean > 0).toBeTruthy();
    });

    it('handles single record gracefully', () => {
        const data = makeData(1);
        const result = mod.analyze(data, 'livePercent', 0, 100);
        expect(result.totalRecords).toBe(1);
        expect(result.topCount).toBe(1);
    });
});

// ===== DOM Rendering =====

describe('Optimizer: DOM Rendering', () => {
    let dom, doc;
    beforeAll(() => { dom = createDOM(); doc = dom.window.document; });

    it('page title contains Parameter Optimizer', () => {
        expect(doc.title.includes('Parameter Optimizer')).toBeTruthy();
    });

    it('has navigation links', () => {
        const nav = doc.querySelector('.nav');
        expect(nav).toBeTruthy();
        const links = nav.querySelectorAll('a');
        expect(links.length >= 8).toBeTruthy();
    });

    it('optimizer nav link is active', () => {
        const active = doc.querySelector('.nav a.active');
        expect(active).toBeTruthy();
        expect(active.getAttribute('href').includes('optimizer')).toBeTruthy();
    });

    it('has target metric select', () => {
        const select = doc.getElementById('targetMetric');
        expect(select).toBeTruthy();
        expect(select.querySelectorAll('option').length >= 3).toBeTruthy();
    });

    it('has threshold input', () => {
        const input = doc.getElementById('threshold');
        expect(input).toBeTruthy();
        expect(input.type).toBe('number');
        expect(input.value).toBe('50');
    });

    it('has top percent select', () => {
        const select = doc.getElementById('topPercent');
        expect(select).toBeTruthy();
    });

    it('has optimize button', () => {
        const btn = doc.getElementById('optimizeBtn');
        expect(btn).toBeTruthy();
        expect(btn.textContent.includes('Optimize')).toBeTruthy();
    });

    it('has reset button', () => {
        const btn = doc.getElementById('resetBtn');
        expect(btn).toBeTruthy();
    });

    it('results container shows initial message', () => {
        const results = doc.getElementById('results');
        expect(results).toBeTruthy();
        expect(results.textContent.includes('Configure')).toBeTruthy();
    });

    it('has footer with source link', () => {
        const footer = doc.querySelector('.footer');
        expect(footer).toBeTruthy();
        expect(footer.textContent.includes('BioBots')).toBeTruthy();
    });

    it('has lang=en', () => {
        expect(doc.documentElement.getAttribute('lang')).toBe('en');
    });

    it('has viewport meta', () => {
        expect(doc.querySelector('meta[name="viewport"]')).toBeTruthy();
    });

    it('has charset', () => {
        expect(doc.querySelector('meta[charset]')).toBeTruthy();
    });
});

// ===== renderResults with Synthetic Data =====

describe('Optimizer: Rendered Results', () => {
    let dom, doc, mod;

    beforeAll(() => {
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
        expect(cards.length >= 4).toBeTruthy();
    });

    it('renders impact chart canvas', () => {
        expect(doc.getElementById('impactChart')).toBeTruthy();
    });

    it('renders correlation chart canvas', () => {
        expect(doc.getElementById('corrChart')).toBeTruthy();
    });

    it('renders parameter table', () => {
        const table = doc.querySelector('.param-table');
        expect(table).toBeTruthy();
        const rows = table.querySelectorAll('tbody tr');
        expect(rows.length).toBe(8);
    });

    it('table has optimal range column', () => {
        const headers = doc.querySelectorAll('.param-table th');
        const texts = Array.from(headers).map(h => h.textContent);
        expect(texts.some(t => t.includes('Optimal'))).toBeTruthy();
    });

    it('renders range bars', () => {
        const bars = doc.querySelectorAll('.range-bar');
        expect(bars.length >= 8).toBeTruthy();
    });

    it('renders recommendation cards', () => {
        const recs = doc.querySelectorAll('.rec-card');
        expect(recs.length >= 2).toBeTruthy();
    });

    it('recommendation cards have impact badges', () => {
        const badges = doc.querySelectorAll('.impact-badge');
        expect(badges.length >= 2).toBeTruthy();
    });

    it('overview cards contain key metrics', () => {
        const text = doc.querySelector('.cards').textContent;
        expect(text.includes('Total Records')).toBeTruthy();
        expect(text.includes('Top')).toBeTruthy();
    });
});

// ===== HTML Structure =====

describe('Optimizer: HTML Structure', () => {
    it('has DOCTYPE', () => {
        expect(HTML).toMatch(/<!DOCTYPE html>/i);
    });

    it('has favicon', () => {
        expect(HTML).toMatch(/rel="icon"/);
    });

    it('has ARIA role on nav', () => {
        const dom = createDOM();
        const nav = dom.window.document.querySelector('[role="navigation"]');
        expect(nav).toBeTruthy();
    });

    it('nav has aria-label', () => {
        const dom = createDOM();
        const nav = dom.window.document.querySelector('[aria-label]');
        expect(nav).toBeTruthy();
    });
});
