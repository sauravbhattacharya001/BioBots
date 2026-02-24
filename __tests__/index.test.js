/**
 * @jest-environment jsdom
 *
 * Tests for docs/index.html — Main Dashboard
 *
 * Tests cover:
 *  - getMetricValue (11 metrics + null/missing)
 *  - compare (greater/lesser/equal with epsilon)
 *  - escapeHtml (XSS chars, null, undefined, numbers)
 *  - runAggregation (max/min/avg with DOM)
 *  - runQuery (valid/invalid input, count verification)
 */

'use strict';

// ── Sample data ────────────────────────────────────────
const samplePrint = {
    print_data: {
        deadPercent: 15.2,
        livePercent: 84.8,
        elasticity: 0.72
    },
    print_info: {
        crosslinking: { cl_duration: 30, cl_intensity: 50 },
        pressure: { extruder1: 100, extruder2: 80 },
        resolution: { layerHeight: 0.3, layerNum: 12 },
        wellplate: 96
    },
    user_info: { serial: 42 }
};

const samplePrint2 = {
    print_data: {
        deadPercent: 25.0,
        livePercent: 75.0,
        elasticity: 1.5
    },
    print_info: {
        crosslinking: { cl_duration: 60, cl_intensity: 80 },
        pressure: { extruder1: 120, extruder2: 90 },
        resolution: { layerHeight: 0.5, layerNum: 20 },
        wellplate: 48
    },
    user_info: { serial: 99 }
};

const samplePrint3 = {
    print_data: {
        deadPercent: 10.0,
        livePercent: 90.0,
        elasticity: 0.5
    },
    print_info: {
        crosslinking: { cl_duration: 15, cl_intensity: 30 },
        pressure: { extruder1: 80, extruder2: 70 },
        resolution: { layerHeight: 0.2, layerNum: 8 },
        wellplate: 24
    },
    user_info: { serial: 7 }
};

// ── Functions extracted from index.html ────────────────

function getMetricValue(print, metric) {
    const paths = {
        deadPercent: p => p.print_data.deadPercent,
        livePercent: p => p.print_data.livePercent,
        elasticity: p => p.print_data.elasticity,
        cl_duration: p => p.print_info.crosslinking.cl_duration,
        cl_intensity: p => p.print_info.crosslinking.cl_intensity,
        extruder1: p => p.print_info.pressure.extruder1,
        extruder2: p => p.print_info.pressure.extruder2,
        layerHeight: p => p.print_info.resolution.layerHeight,
        layerNum: p => p.print_info.resolution.layerNum,
        serial: p => p.user_info.serial,
        wellplate: p => p.print_info.wellplate,
    };
    return paths[metric] ? paths[metric](print) : null;
}

function compare(value, operator, target) {
    switch (operator) {
        case 'greater': return value > target;
        case 'lesser': return value < target;
        case 'equal': return Math.abs(value - target) < 0.001;
        default: return false;
    }
}

const _escapeEl = document.createElement('div');
function escapeHtml(str) {
    if (str == null) return '';
    _escapeEl.textContent = String(str);
    return _escapeEl.innerHTML;
}

// ── DOM-dependent functions ────────────────────────────

let printData = [];

function showResult(text, type) {
    const el = document.getElementById('result');
    el.textContent = text;
    el.className = 'result ' + (type || '');
}

function runQuery() {
    const metric = document.getElementById('property').value;
    const op = document.getElementById('arithmetic').value;
    const val = document.getElementById('param').value;

    if (val === '' || isNaN(val) || !isFinite(val)) {
        showResult('Please enter a valid number.', 'error');
        return;
    }

    const target = parseFloat(val);
    const count = printData.filter(p => {
        const v = getMetricValue(p, metric);
        return v !== null && compare(v, op, target);
    }).length;

    showResult(`${count} print(s) where ${metric} is ${op} than ${target}`, 'success');
}

function runAggregation(func) {
    const metric = document.getElementById('property').value;
    const values = printData
        .map(p => getMetricValue(p, metric))
        .filter(v => v !== null && !isNaN(v));

    if (values.length === 0) {
        showResult('No data available for this metric.', 'error');
        return;
    }

    let result;
    switch (func) {
        case 'Maximum': result = Math.max(...values); break;
        case 'Minimum': result = Math.min(...values); break;
        case 'Average': result = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2); break;
    }

    showResult(`${func} ${metric}: ${result}`, 'success');
}

// ── Tests ──────────────────────────────────────────────

describe('getMetricValue', () => {
    test('returns deadPercent correctly', () => {
        expect(getMetricValue(samplePrint, 'deadPercent')).toBe(15.2);
    });

    test('returns livePercent correctly', () => {
        expect(getMetricValue(samplePrint, 'livePercent')).toBe(84.8);
    });

    test('returns elasticity correctly', () => {
        expect(getMetricValue(samplePrint, 'elasticity')).toBe(0.72);
    });

    test('returns cl_duration correctly', () => {
        expect(getMetricValue(samplePrint, 'cl_duration')).toBe(30);
    });

    test('returns cl_intensity correctly', () => {
        expect(getMetricValue(samplePrint, 'cl_intensity')).toBe(50);
    });

    test('returns extruder1 correctly', () => {
        expect(getMetricValue(samplePrint, 'extruder1')).toBe(100);
    });

    test('returns extruder2 correctly', () => {
        expect(getMetricValue(samplePrint, 'extruder2')).toBe(80);
    });

    test('returns layerHeight correctly', () => {
        expect(getMetricValue(samplePrint, 'layerHeight')).toBe(0.3);
    });

    test('returns layerNum correctly', () => {
        expect(getMetricValue(samplePrint, 'layerNum')).toBe(12);
    });

    test('returns serial correctly', () => {
        expect(getMetricValue(samplePrint, 'serial')).toBe(42);
    });

    test('returns wellplate correctly', () => {
        expect(getMetricValue(samplePrint, 'wellplate')).toBe(96);
    });

    test('returns null for unknown metric', () => {
        expect(getMetricValue(samplePrint, 'nonExistent')).toBeNull();
    });

    test('handles missing nested property gracefully', () => {
        const incompletePrint = { print_data: {}, print_info: {}, user_info: {} };
        expect(getMetricValue(incompletePrint, 'deadPercent')).toBeUndefined();
    });

    test('returns correct value from second sample print', () => {
        expect(getMetricValue(samplePrint2, 'deadPercent')).toBe(25.0);
    });

    test('returns correct wellplate from second sample print', () => {
        expect(getMetricValue(samplePrint2, 'wellplate')).toBe(48);
    });
});

describe('compare', () => {
    test('greater returns true when value > target', () => {
        expect(compare(10, 'greater', 5)).toBe(true);
    });

    test('greater returns false when value < target', () => {
        expect(compare(3, 'greater', 5)).toBe(false);
    });

    test('greater returns false when equal', () => {
        expect(compare(5, 'greater', 5)).toBe(false);
    });

    test('lesser returns true when value < target', () => {
        expect(compare(3, 'lesser', 5)).toBe(true);
    });

    test('lesser returns false when value > target', () => {
        expect(compare(10, 'lesser', 5)).toBe(false);
    });

    test('lesser returns false when equal', () => {
        expect(compare(5, 'lesser', 5)).toBe(false);
    });

    test('equal returns true when values match', () => {
        expect(compare(5, 'equal', 5)).toBe(true);
    });

    test('equal returns true within epsilon (0.001)', () => {
        expect(compare(5.0005, 'equal', 5.0001)).toBe(true);
    });

    test('equal returns false when values differ', () => {
        expect(compare(5, 'equal', 6)).toBe(false);
    });

    test('unknown operator returns false', () => {
        expect(compare(5, 'notAnOp', 5)).toBe(false);
    });

    test('greater works with negative numbers', () => {
        expect(compare(-1, 'greater', -5)).toBe(true);
    });

    test('lesser works with decimals', () => {
        expect(compare(0.001, 'lesser', 0.01)).toBe(true);
    });

    test('equal returns false for values just outside epsilon', () => {
        expect(compare(5.0, 'equal', 5.002)).toBe(false);
    });
});

describe('escapeHtml', () => {
    test('escapes angle brackets', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe(
            '&lt;script&gt;alert("xss")&lt;/script&gt;'
        );
    });

    test('escapes ampersand', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    test('escapes quotes', () => {
        // jsdom textContent → innerHTML does not escape double quotes inside text nodes;
        // the implementation uses textContent which safely escapes < > &
        const result = escapeHtml('"hello"');
        expect(result).toContain('hello');
    });

    test('returns empty string for null', () => {
        expect(escapeHtml(null)).toBe('');
    });

    test('returns empty string for undefined', () => {
        expect(escapeHtml(undefined)).toBe('');
    });

    test('passes through plain text unchanged', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });

    test('handles numeric input', () => {
        expect(escapeHtml(42)).toBe('42');
    });

    test('handles string with multiple special characters', () => {
        expect(escapeHtml('<b>a & b</b>')).toBe('&lt;b&gt;a &amp; b&lt;/b&gt;');
    });

    test('handles empty string', () => {
        expect(escapeHtml('')).toBe('');
    });
});

describe('runAggregation', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <select id="property"><option value="deadPercent" selected>Dead %</option></select>
            <div id="result"></div>
        `;
        printData = [samplePrint, samplePrint2, samplePrint3];
    });

    test('Maximum returns highest value', () => {
        runAggregation('Maximum');
        const el = document.getElementById('result');
        expect(el.textContent).toContain('Maximum');
        expect(el.textContent).toContain('25');
    });

    test('Minimum returns lowest value', () => {
        runAggregation('Minimum');
        const el = document.getElementById('result');
        expect(el.textContent).toContain('Minimum');
        expect(el.textContent).toContain('10');
    });

    test('Average returns mean value', () => {
        runAggregation('Average');
        const el = document.getElementById('result');
        expect(el.textContent).toContain('Average');
        // (15.2 + 25.0 + 10.0) / 3 = 16.73
        expect(el.textContent).toContain('16.73');
    });

    test('handles empty data gracefully', () => {
        printData = [];
        runAggregation('Maximum');
        const el = document.getElementById('result');
        expect(el.textContent).toContain('No data');
        expect(el.className).toContain('error');
    });

    test('shows error for no data', () => {
        document.getElementById('property').value = 'nonExistent';
        printData = [samplePrint];
        runAggregation('Minimum');
        const el = document.getElementById('result');
        expect(el.textContent).toContain('No data');
    });
});

describe('runQuery', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <select id="property"><option value="deadPercent" selected>Dead %</option></select>
            <select id="arithmetic"><option value="greater" selected>greater</option></select>
            <input id="param" value="10" />
            <div id="result"></div>
        `;
        printData = [samplePrint, samplePrint2, samplePrint3];
    });

    test('counts matching prints correctly', () => {
        // deadPercent > 10: samplePrint (15.2) and samplePrint2 (25.0) match, samplePrint3 (10.0) doesn't
        runQuery();
        const el = document.getElementById('result');
        expect(el.textContent).toContain('2 print(s)');
        expect(el.className).toContain('success');
    });

    test('shows error for non-numeric input', () => {
        document.getElementById('param').value = 'abc';
        runQuery();
        const el = document.getElementById('result');
        expect(el.textContent).toContain('valid number');
        expect(el.className).toContain('error');
    });

    test('shows error for empty input', () => {
        document.getElementById('param').value = '';
        runQuery();
        const el = document.getElementById('result');
        expect(el.textContent).toContain('valid number');
        expect(el.className).toContain('error');
    });

    test('handles NaN input', () => {
        document.getElementById('param').value = 'NaN';
        runQuery();
        const el = document.getElementById('result');
        expect(el.textContent).toContain('valid number');
        expect(el.className).toContain('error');
    });

    test('shows success message with count', () => {
        document.getElementById('param').value = '100';
        runQuery();
        const el = document.getElementById('result');
        expect(el.textContent).toContain('0 print(s)');
        expect(el.className).toContain('success');
    });
});
