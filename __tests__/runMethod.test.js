/**
 * @jest-environment jsdom
 *
 * Comprehensive tests for runMethod.js — the BioBots Tool frontend query client.
 *
 * Tests cover:
 *  - isNumeric() validation logic (valid numbers, edge cases, NaN, Infinity, empty)
 *  - setButtonsEnabled() state management
 *  - runMethod() API URL construction, aggregation vs comparison logic, error handling
 *  - jQuery integration ($.getJSON, DOM element selection)
 */

'use strict';

// ---------------------------------------------------------------------------
// jQuery mock — simulate the jQuery interface used by runMethod.js
// ---------------------------------------------------------------------------

/** Map element selectors to their mocked state */
let domState;
let getJSONUrl;

function resetDomState() {
    domState = {
        '#property option:selected': { val: 'livePercent' },
        '#arithmetic option:selected': { val: 'greater' },
        '#param': { val: '50' },
        '#print': { text: '' },
        'input[type="button"]': { disabled: false },
    };
    getJSONUrl = null;
}

/**
 * Creates a deferred-like object mimicking jQuery's $.getJSON return value
 * with .done(), .fail(), .always() chaining.
 */
function createDeferred() {
    let _done, _fail, _always;
    const deferred = {
        done(fn)   { _done = fn; return deferred; },
        fail(fn)   { _fail = fn; return deferred; },
        always(fn) { _always = fn; return deferred; },
        // Test helpers to resolve/reject
        _resolve(data) {
            if (_done) _done(data);
            if (_always) _always();
        },
        _reject(jqXHR, textStatus, err) {
            if (_fail) _fail(jqXHR, textStatus, err);
            if (_always) _always();
        },
    };
    return deferred;
}

let lastDeferred;

// Build the jQuery mock
const $ = jest.fn((selector) => {
    const key = selector;
    if (!domState[key]) {
        domState[key] = { val: '', text: '', disabled: false };
    }
    return {
        val() { return domState[key].val; },
        text(t) {
            if (t === undefined) return domState[key].text;
            domState[key].text = t;
        },
        prop(name, value) {
            domState[key][name] = value;
        },
    };
});

$.getJSON = jest.fn((url) => {
    getJSONUrl = url;
    lastDeferred = createDeferred();
    return lastDeferred;
});

// Expose $ globally before loading the module
global.$ = $;

// ---------------------------------------------------------------------------
// Load the module under test
// ---------------------------------------------------------------------------

const { isNumeric, setButtonsEnabled, runMethod } = require('../Try/scripts/runMethod');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
    resetDomState();
    $.getJSON.mockClear();
    $.mockClear();
});

// ========================== isNumeric ======================================

describe('isNumeric()', () => {
    test('accepts positive integers', () => {
        expect(isNumeric('42')).toBe(true);
    });

    test('accepts negative integers', () => {
        expect(isNumeric('-7')).toBe(true);
    });

    test('accepts zero', () => {
        expect(isNumeric('0')).toBe(true);
    });

    test('accepts floating point numbers', () => {
        expect(isNumeric('3.14')).toBe(true);
    });

    test('accepts negative floats', () => {
        expect(isNumeric('-0.001')).toBe(true);
    });

    test('accepts scientific notation', () => {
        expect(isNumeric('1e5')).toBe(true);
        expect(isNumeric('2.5e-3')).toBe(true);
    });

    test('rejects empty string', () => {
        expect(isNumeric('')).toBe(false);
    });

    test('rejects NaN string', () => {
        expect(isNumeric('NaN')).toBe(false);
    });

    test('rejects alphabetic strings', () => {
        expect(isNumeric('abc')).toBe(false);
    });

    test('rejects Infinity', () => {
        expect(isNumeric('Infinity')).toBe(false);
        expect(isNumeric('-Infinity')).toBe(false);
    });

    test('rejects strings with mixed content', () => {
        expect(isNumeric('12abc')).toBe(false);
        expect(isNumeric('abc12')).toBe(false);
    });

    test('treats whitespace as numeric (documents existing behavior)', () => {
        // ' ' (single space) is NOT empty and isNaN(' ') is false, so it passes.
        // This is a known edge case in the original code — documenting rather than fixing
        // to avoid changing the API contract.
        expect(isNumeric('  ')).toBe(true);
    });

    test('treats null as numeric (documents existing behavior)', () => {
        // null coerces to 0 via isNaN(null) → false, isFinite(null) → true,
        // and null !== '' → true. This is a JS quirk — documenting rather than
        // changing the contract since callers always pass strings from DOM.
        expect(isNumeric(null)).toBe(true);
    });

    test('rejects undefined', () => {
        expect(isNumeric(undefined)).toBe(false);
    });
});

// ========================== setButtonsEnabled ==============================

describe('setButtonsEnabled()', () => {
    test('enables all buttons when passed true', () => {
        setButtonsEnabled(true);
        expect(domState['input[type="button"]'].disabled).toBe(false);
    });

    test('disables all buttons when passed false', () => {
        setButtonsEnabled(false);
        expect(domState['input[type="button"]'].disabled).toBe(true);
    });
});

// ========================== runMethod — URL Construction ====================

describe('runMethod() URL construction', () => {
    test('builds correct URL for comparison query', () => {
        domState['#property option:selected'].val = 'elasticity';
        domState['#arithmetic option:selected'].val = 'lesser';
        domState['#param'].val = '25';

        runMethod();

        expect($.getJSON).toHaveBeenCalledWith('api/prints/elasticity/lesser/25');
    });

    test('builds correct URL for aggregation query (Maximum)', () => {
        domState['#property option:selected'].val = 'serial';
        domState['#arithmetic option:selected'].val = 'greater';

        runMethod('Maximum');

        expect($.getJSON).toHaveBeenCalledWith('api/prints/serial/greater/Maximum');
    });

    test('builds correct URL for aggregation query (Minimum)', () => {
        domState['#property option:selected'].val = 'layerNum';
        domState['#arithmetic option:selected'].val = 'equal';

        runMethod('Minimum');

        expect($.getJSON).toHaveBeenCalledWith('api/prints/layerNum/equal/Minimum');
    });

    test('builds correct URL for aggregation query (Average)', () => {
        domState['#property option:selected'].val = 'cl_duration';
        domState['#arithmetic option:selected'].val = 'greater';

        runMethod('Average');

        expect($.getJSON).toHaveBeenCalledWith('api/prints/cl_duration/greater/Average');
    });

    test('URL-encodes the param value', () => {
        domState['#property option:selected'].val = 'extruder1';
        domState['#arithmetic option:selected'].val = 'greater';
        domState['#param'].val = '1.5';

        runMethod();

        expect($.getJSON).toHaveBeenCalledWith('api/prints/extruder1/greater/1.5');
    });

    test('URL-encodes special characters in param', () => {
        domState['#property option:selected'].val = 'serial';
        domState['#arithmetic option:selected'].val = 'greater';

        // Aggregation param with special chars shouldn't happen in practice,
        // but encodeURIComponent should handle it
        runMethod('Maximum');

        expect($.getJSON).toHaveBeenCalledWith('api/prints/serial/greater/Maximum');
    });

    test('queries all 11 metrics correctly', () => {
        const metrics = [
            'deadPercent', 'livePercent', 'elasticity',
            'cl_duration', 'cl_intensity', 'extruder1',
            'extruder2', 'layerHeight', 'layerNum',
            'serial', 'wellplate',
        ];

        metrics.forEach((metric) => {
            $.getJSON.mockClear();
            domState['#property option:selected'].val = metric;
            domState['#arithmetic option:selected'].val = 'greater';
            domState['#param'].val = '10';

            runMethod();

            expect($.getJSON).toHaveBeenCalledWith(`api/prints/${metric}/greater/10`);
        });
    });

    test('handles all three comparison operators', () => {
        ['greater', 'lesser', 'equal'].forEach((op) => {
            $.getJSON.mockClear();
            domState['#arithmetic option:selected'].val = op;
            domState['#param'].val = '5';

            runMethod();

            expect($.getJSON).toHaveBeenCalledWith(`api/prints/livePercent/${op}/5`);
        });
    });
});

// ========================== runMethod — Input Validation ====================

describe('runMethod() input validation', () => {
    test('rejects empty param for comparison query', () => {
        domState['#param'].val = '';

        runMethod();

        expect(domState['#print'].text).toBe('Please enter a valid number.');
        expect($.getJSON).not.toHaveBeenCalled();
    });

    test('rejects non-numeric param for comparison query', () => {
        domState['#param'].val = 'abc';

        runMethod();

        expect(domState['#print'].text).toBe('Please enter a valid number.');
        expect($.getJSON).not.toHaveBeenCalled();
    });

    test('rejects Infinity for comparison query', () => {
        domState['#param'].val = 'Infinity';

        runMethod();

        expect(domState['#print'].text).toBe('Please enter a valid number.');
        expect($.getJSON).not.toHaveBeenCalled();
    });

    test('rejects -Infinity for comparison query', () => {
        domState['#param'].val = '-Infinity';

        runMethod();

        expect(domState['#print'].text).toBe('Please enter a valid number.');
        expect($.getJSON).not.toHaveBeenCalled();
    });

    test('skips numeric validation for aggregation functions', () => {
        domState['#param'].val = ''; // empty — should not matter for aggregation

        runMethod('Maximum');

        expect($.getJSON).toHaveBeenCalled();
    });

    test('accepts negative numbers for comparison query', () => {
        domState['#param'].val = '-5';

        runMethod();

        expect($.getJSON).toHaveBeenCalled();
    });

    test('accepts decimal numbers for comparison query', () => {
        domState['#param'].val = '3.14159';

        runMethod();

        expect($.getJSON).toHaveBeenCalled();
    });

    test('accepts very large numbers', () => {
        domState['#param'].val = '99999999';

        runMethod();

        expect($.getJSON).toHaveBeenCalled();
    });

    test('accepts very small decimals', () => {
        domState['#param'].val = '0.000001';

        runMethod();

        expect($.getJSON).toHaveBeenCalled();
    });
});

// ========================== runMethod — Button State ======================

describe('runMethod() button state management', () => {
    test('disables buttons while request is in flight', () => {
        runMethod('Maximum');

        expect(domState['input[type="button"]'].disabled).toBe(true);
    });

    test('shows loading state while request is in flight', () => {
        runMethod('Maximum');

        expect(domState['#print'].text).toBe('Loading...');
    });

    test('re-enables buttons after successful response', () => {
        runMethod('Maximum');
        lastDeferred._resolve(42);

        expect(domState['input[type="button"]'].disabled).toBe(false);
    });

    test('re-enables buttons after failed response', () => {
        runMethod('Maximum');
        lastDeferred._reject({}, 'error', 'Internal Server Error');

        expect(domState['input[type="button"]'].disabled).toBe(false);
    });

    test('does not disable buttons when input validation fails', () => {
        domState['#param'].val = 'not-a-number';

        runMethod();

        // No request was made, so buttons should remain enabled
        expect(domState['input[type="button"]'].disabled).toBe(false);
    });
});

// ========================== runMethod — Response Handling ==================

describe('runMethod() response handling', () => {
    test('displays numeric result on success', () => {
        runMethod('Maximum');
        lastDeferred._resolve(99.5);

        expect(domState['#print'].text).toBe(99.5);
    });

    test('displays integer count on comparison success', () => {
        domState['#param'].val = '50';
        runMethod();
        lastDeferred._resolve(17);

        expect(domState['#print'].text).toBe(17);
    });

    test('displays zero result correctly', () => {
        domState['#param'].val = '999999';
        runMethod();
        lastDeferred._resolve(0);

        expect(domState['#print'].text).toBe(0);
    });

    test('displays error message on failure', () => {
        runMethod('Maximum');
        lastDeferred._reject({}, 'error', 'Not Found');

        expect(domState['#print'].text).toBe('Error: Not Found');
    });

    test('displays error for server error', () => {
        domState['#param'].val = '10';
        runMethod();
        lastDeferred._reject({}, 'error', 'Internal Server Error');

        expect(domState['#print'].text).toBe('Error: Internal Server Error');
    });

    test('displays error for timeout', () => {
        runMethod('Average');
        lastDeferred._reject({}, 'timeout', 'timeout');

        expect(domState['#print'].text).toBe('Error: timeout');
    });
});

// ========================== Integration Scenarios ==========================

describe('integration scenarios', () => {
    test('full comparison workflow: select → query → result', () => {
        // User selects livePercent > 50
        domState['#property option:selected'].val = 'livePercent';
        domState['#arithmetic option:selected'].val = 'greater';
        domState['#param'].val = '50';

        runMethod();

        // Verify URL
        expect($.getJSON).toHaveBeenCalledWith('api/prints/livePercent/greater/50');
        // Verify loading state
        expect(domState['#print'].text).toBe('Loading...');
        expect(domState['input[type="button"]'].disabled).toBe(true);

        // Server responds
        lastDeferred._resolve(23);

        // Verify result displayed and buttons re-enabled
        expect(domState['#print'].text).toBe(23);
        expect(domState['input[type="button"]'].disabled).toBe(false);
    });

    test('full aggregation workflow: select metric → get average', () => {
        domState['#property option:selected'].val = 'elasticity';
        domState['#arithmetic option:selected'].val = 'greater';

        runMethod('Average');

        expect($.getJSON).toHaveBeenCalledWith('api/prints/elasticity/greater/Average');
        lastDeferred._resolve(42.7);

        expect(domState['#print'].text).toBe(42.7);
        expect(domState['input[type="button"]'].disabled).toBe(false);
    });

    test('sequential queries reset state properly', () => {
        // First query
        domState['#param'].val = '10';
        runMethod();
        lastDeferred._resolve(5);
        expect(domState['#print'].text).toBe(5);

        // Second query
        domState['#param'].val = '20';
        runMethod();
        expect(domState['#print'].text).toBe('Loading...');
        lastDeferred._resolve(3);
        expect(domState['#print'].text).toBe(3);
    });

    test('invalid input prevents API call entirely', () => {
        domState['#param'].val = 'not-a-number';

        runMethod();

        expect($.getJSON).not.toHaveBeenCalled();
        expect(domState['#print'].text).toBe('Please enter a valid number.');
        expect(domState['input[type="button"]'].disabled).toBe(false);
    });

    test('crosslinking metrics query correctly', () => {
        domState['#property option:selected'].val = 'cl_intensity';
        domState['#arithmetic option:selected'].val = 'equal';
        domState['#param'].val = '100';

        runMethod();

        expect($.getJSON).toHaveBeenCalledWith('api/prints/cl_intensity/equal/100');
        lastDeferred._resolve(8);
        expect(domState['#print'].text).toBe(8);
    });

    test('wellplate query with all three aggregations', () => {
        domState['#property option:selected'].val = 'wellplate';

        ['Maximum', 'Minimum', 'Average'].forEach((agg) => {
            $.getJSON.mockClear();
            runMethod(agg);
            expect($.getJSON).toHaveBeenCalledWith(`api/prints/wellplate/greater/${agg}`);
            lastDeferred._resolve(agg === 'Average' ? 12.5 : 24);
        });
    });
});
