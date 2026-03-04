/**
 * @jest-environment jsdom
 *
 * Tests for docs/shared/data-loader.js — shared bioprint data loader.
 */
const {
    loadBioprintData,
    validateRecord,
    clearCache,
    setDataUrl,
    getCachedData,
} = require('../docs/shared/data-loader');

// ── Mock fetch for jsdom ────────────────────────────────────────────

function mockFetch(data, status) {
    status = status || 200;
    return jest.fn(function () {
        if (status !== 200) {
            return Promise.resolve({
                ok: false,
                status: status,
                json: function () { return Promise.resolve(data); },
            });
        }
        return Promise.resolve({
            ok: true,
            status: 200,
            json: function () { return Promise.resolve(data); },
        });
    });
}

// ── Fixtures ────────────────────────────────────────────────────────

var VALID_RECORD = {
    print_data: { livePercent: 85, deadPercent: 15, elasticity: 2.1 },
    print_info: {
        crosslinking: { cl_duration: 10, cl_intensity: 50 },
        pressure: { extruder1: 80 },
        resolution: { layerHeight: 0.4, layerNum: 5 },
    },
    user_info: { name: 'Test User' },
};

var INVALID_RECORD_NO_PRINT_DATA = {
    print_info: {
        crosslinking: { cl_duration: 10, cl_intensity: 50 },
        pressure: { extruder1: 80 },
        resolution: { layerHeight: 0.4 },
    },
    user_info: { name: 'Test' },
};

var INVALID_RECORD_NO_CROSSLINKING = {
    print_data: { livePercent: 85 },
    print_info: {
        pressure: { extruder1: 80 },
        resolution: { layerHeight: 0.4 },
    },
    user_info: { name: 'Test' },
};

var INVALID_RECORD_NO_PRESSURE = {
    print_data: { livePercent: 85 },
    print_info: {
        crosslinking: { cl_duration: 10 },
        resolution: { layerHeight: 0.4 },
    },
    user_info: { name: 'Test' },
};

var INVALID_RECORD_NO_RESOLUTION = {
    print_data: { livePercent: 85 },
    print_info: {
        crosslinking: { cl_duration: 10 },
        pressure: { extruder1: 80 },
    },
    user_info: { name: 'Test' },
};

var INVALID_RECORD_NO_USER = {
    print_data: { livePercent: 85 },
    print_info: {
        crosslinking: { cl_duration: 10 },
        pressure: { extruder1: 80 },
        resolution: { layerHeight: 0.4 },
    },
};

// ── Tests ───────────────────────────────────────────────────────────

describe('data-loader', function () {

    beforeEach(function () {
        clearCache();
        delete global.fetch;
    });

    // ── validateRecord ──────────────────────────────────────────

    describe('validateRecord', function () {
        test('returns true for complete record', function () {
            expect(validateRecord(VALID_RECORD)).toBe(true);
        });

        test('returns false when print_data missing', function () {
            expect(validateRecord(INVALID_RECORD_NO_PRINT_DATA)).toBe(false);
        });

        test('returns false when crosslinking missing', function () {
            expect(validateRecord(INVALID_RECORD_NO_CROSSLINKING)).toBe(false);
        });

        test('returns false when pressure missing', function () {
            expect(validateRecord(INVALID_RECORD_NO_PRESSURE)).toBe(false);
        });

        test('returns false when resolution missing', function () {
            expect(validateRecord(INVALID_RECORD_NO_RESOLUTION)).toBe(false);
        });

        test('returns false when user_info missing', function () {
            expect(validateRecord(INVALID_RECORD_NO_USER)).toBe(false);
        });

        test('returns false for null', function () {
            expect(validateRecord(null)).toBe(false);
        });

        test('returns false for undefined', function () {
            expect(validateRecord(undefined)).toBe(false);
        });

        test('returns false for empty object', function () {
            expect(validateRecord({})).toBe(false);
        });
    });

    // ── loadBioprintData ────────────────────────────────────────

    describe('loadBioprintData', function () {
        test('loads data from fetch', function () {
            var data = [VALID_RECORD];
            global.fetch = mockFetch(data);

            return loadBioprintData().then(function (result) {
                expect(result).toHaveLength(1);
                expect(result[0]).toEqual(VALID_RECORD);
            });
        });

        test('caches data after first load', function () {
            var data = [VALID_RECORD];
            global.fetch = mockFetch(data);

            return loadBioprintData().then(function () {
                return loadBioprintData().then(function (result) {
                    expect(result).toHaveLength(1);
                    // fetch should only be called once
                    expect(global.fetch).toHaveBeenCalledTimes(1);
                });
            });
        });

        test('validate option filters invalid records', function () {
            var data = [VALID_RECORD, INVALID_RECORD_NO_PRINT_DATA, INVALID_RECORD_NO_CROSSLINKING];
            global.fetch = mockFetch(data);

            return loadBioprintData({ validate: true }).then(function (result) {
                expect(result).toHaveLength(1);
                expect(result[0]).toEqual(VALID_RECORD);
            });
        });

        test('without validate, returns all records', function () {
            var data = [VALID_RECORD, INVALID_RECORD_NO_PRINT_DATA];
            global.fetch = mockFetch(data);

            return loadBioprintData().then(function (result) {
                expect(result).toHaveLength(2);
            });
        });

        test('custom filter applied after validation', function () {
            var valid2 = JSON.parse(JSON.stringify(VALID_RECORD));
            valid2.print_data.livePercent = 50;
            var data = [VALID_RECORD, valid2, INVALID_RECORD_NO_PRINT_DATA];
            global.fetch = mockFetch(data);

            return loadBioprintData({
                validate: true,
                filter: function (p) { return p.print_data.livePercent > 70; },
            }).then(function (result) {
                expect(result).toHaveLength(1);
                expect(result[0].print_data.livePercent).toBe(85);
            });
        });

        test('rejects on HTTP error', function () {
            global.fetch = mockFetch(null, 500);

            return loadBioprintData().catch(function (err) {
                expect(err.message).toContain('HTTP 500');
            });
        });

        test('rejects on non-array response', function () {
            global.fetch = mockFetch({ not: 'array' });

            return loadBioprintData().catch(function (err) {
                expect(err.message).toContain('must be an array');
            });
        });
    });

    // ── clearCache ──────────────────────────────────────────────

    describe('clearCache', function () {
        test('forces re-fetch after clearing', function () {
            var data = [VALID_RECORD];
            global.fetch = mockFetch(data);

            return loadBioprintData().then(function () {
                clearCache();
                return loadBioprintData().then(function (result) {
                    expect(result).toHaveLength(1);
                    expect(global.fetch).toHaveBeenCalledTimes(2);
                });
            });
        });
    });

    // ── getCachedData ───────────────────────────────────────────

    describe('getCachedData', function () {
        test('returns null before any load', function () {
            expect(getCachedData()).toBeNull();
        });

        test('returns data after load', function () {
            var data = [VALID_RECORD];
            global.fetch = mockFetch(data);

            return loadBioprintData().then(function () {
                expect(getCachedData()).toHaveLength(1);
            });
        });
    });
});
