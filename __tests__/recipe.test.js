/**
 * @jest-environment jsdom
 *
 * Tests for recipeBuilder.js - Print Recipe Builder core logic
 *
 * Tests cover:
 *  - filterAndScore: viability, dead %, elasticity, layer height filtering
 *  - filterAndScore: crosslinking and wellplate filters
 *  - filterAndScore: tolerance modes (strict, normal, relaxed)
 *  - filterAndScore: scoring formula and sort order
 *  - computeRecipe: median, quartiles, min/max, mean
 *  - formatRecipeText: clipboard text output
 *  - buildHistogram: binning logic
 *  - PRESETS: preset parameter sets
 *  - Edge cases: no matches, single record, empty data
 */

'use strict';

const { filterAndScore, computeRecipe, formatRecipeText, buildHistogram, PRESETS } = require('../docs/shared/recipeBuilder');

const sampleData = [
    {
        print_data: { deadPercent: 15, elasticity: 72, livePercent: 85 },
        print_info: {
            crosslinking: { cl_duration: 5000, cl_enabled: true, cl_intensity: 50 },
            files: { input: 'f1.gcode', output: 'f1_out.gcode' },
            pressure: { extruder1: 40, extruder2: 60 },
            resolution: { layerHeight: 0.3, layerNum: 30 },
            wellplate: 6
        },
        user_info: { email: 'a@test.com', serial: 1 }
    },
    {
        print_data: { deadPercent: 20, elasticity: 65, livePercent: 80 },
        print_info: {
            crosslinking: { cl_duration: 8000, cl_enabled: true, cl_intensity: 60 },
            files: { input: 'f2.gcode', output: 'f2_out.gcode' },
            pressure: { extruder1: 50, extruder2: 70 },
            resolution: { layerHeight: 0.5, layerNum: 20 },
            wellplate: 12
        },
        user_info: { email: 'b@test.com', serial: 2 }
    },
    {
        print_data: { deadPercent: 90, elasticity: 10, livePercent: 5 },
        print_info: {
            crosslinking: { cl_duration: 100, cl_enabled: false, cl_intensity: 5 },
            files: { input: 'f3.gcode', output: 'f3_out.gcode' },
            pressure: { extruder1: 100, extruder2: 30 },
            resolution: { layerHeight: 1.5, layerNum: 5 },
            wellplate: 96
        },
        user_info: { email: 'c@test.com', serial: 3 }
    },
    {
        print_data: { deadPercent: 25, elasticity: 55, livePercent: 75 },
        print_info: {
            crosslinking: { cl_duration: 6000, cl_enabled: true, cl_intensity: 45 },
            files: { input: 'f4.gcode', output: 'f4_out.gcode' },
            pressure: { extruder1: 45, extruder2: 65 },
            resolution: { layerHeight: 0.4, layerNum: 25 },
            wellplate: 6
        },
        user_info: { email: 'd@test.com', serial: 4 }
    },
    {
        print_data: { deadPercent: 10, elasticity: 80, livePercent: 90 },
        print_info: {
            crosslinking: { cl_duration: 4000, cl_enabled: true, cl_intensity: 55 },
            files: { input: 'f5.gcode', output: 'f5_out.gcode' },
            pressure: { extruder1: 35, extruder2: 55 },
            resolution: { layerHeight: 0.25, layerNum: 35 },
            wellplate: 24
        },
        user_info: { email: 'e@test.com', serial: 5 }
    }
];

describe('recipeBuilder', () => {

    describe('filterAndScore', () => {
        test('filters by minimum viability with normal tolerance', () => {
            var results = filterAndScore(sampleData, {
                minViability: 70, maxDead: 100, tolerance: 0.10
            });
            // viability >= 63 (70 * 0.9). Records: 85, 80, 75, 90 = 4 matches
            expect(results.length).toBe(4);
            expect(results.every(function(r) { return r.record.print_data.livePercent >= 63; })).toBe(true);
        });

        test('filters by minimum viability with strict tolerance', () => {
            var results = filterAndScore(sampleData, {
                minViability: 80, tolerance: 0
            });
            // viability >= 80 exactly. Records: 85, 80, 90 = 3 matches
            expect(results.length).toBe(3);
        });

        test('filters by maximum dead cell percentage', () => {
            var results = filterAndScore(sampleData, {
                minViability: 0, maxDead: 20, tolerance: 0
            });
            // deadPercent <= 20. Records: 15, 20, 10 = 3 matches
            expect(results.length).toBe(3);
        });

        test('filters by minimum elasticity', () => {
            var results = filterAndScore(sampleData, {
                minViability: 0, maxDead: 100, minElasticity: 60, tolerance: 0
            });
            // elasticity >= 60. Records: 72, 65, 80 = 3 matches
            expect(results.length).toBe(3);
        });

        test('filters by maximum layer height', () => {
            var results = filterAndScore(sampleData, {
                minViability: 0, maxDead: 100, maxLayerHeight: 0.4, tolerance: 0
            });
            // layerHeight <= 0.4. Records: 0.3, 0.4, 0.25 = 3 matches
            expect(results.length).toBe(3);
        });

        test('filters by crosslinking required', () => {
            var results = filterAndScore(sampleData, {
                minViability: 0, maxDead: 100, crosslinking: 'yes', tolerance: 0
            });
            // cl_enabled true: records 1,2,4,5 = 4
            expect(results.length).toBe(4);
        });

        test('filters by no crosslinking', () => {
            var results = filterAndScore(sampleData, {
                minViability: 0, maxDead: 100, crosslinking: 'no', tolerance: 0
            });
            // cl_enabled false: record 3 only
            expect(results.length).toBe(1);
            expect(results[0].record.print_info.crosslinking.cl_enabled).toBe(false);
        });

        test('filters by wellplate size', () => {
            var results = filterAndScore(sampleData, {
                minViability: 0, maxDead: 100, wellplate: '6', tolerance: 0
            });
            // wellplate=6: records 1,4 = 2
            expect(results.length).toBe(2);
        });

        test('any wellplate returns all', () => {
            var results = filterAndScore(sampleData, {
                minViability: 0, maxDead: 100, wellplate: 'any', tolerance: 0
            });
            expect(results.length).toBe(5);
        });

        test('relaxed tolerance includes more runs', () => {
            var strict = filterAndScore(sampleData, { minViability: 80, tolerance: 0 });
            var relaxed = filterAndScore(sampleData, { minViability: 80, tolerance: 0.25 });
            expect(relaxed.length).toBeGreaterThanOrEqual(strict.length);
        });

        test('results are sorted by score descending', () => {
            var results = filterAndScore(sampleData, { minViability: 0, maxDead: 100, tolerance: 0 });
            for (var i = 1; i < results.length; i++) {
                expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
            }
        });

        test('score is between 0 and 1', () => {
            var results = filterAndScore(sampleData, { minViability: 0, maxDead: 100, tolerance: 0 });
            for (var i = 0; i < results.length; i++) {
                expect(results[i].score).toBeGreaterThanOrEqual(0);
                expect(results[i].score).toBeLessThanOrEqual(1);
            }
        });

        test('handles empty data', () => {
            var results = filterAndScore([], { minViability: 0, tolerance: 0 });
            expect(results.length).toBe(0);
        });

        test('handles impossible constraints', () => {
            var results = filterAndScore(sampleData, {
                minViability: 99, maxDead: 1, tolerance: 0
            });
            expect(results.length).toBe(0);
        });

        test('handles records with missing fields', () => {
            var badData = [{ print_data: null }, {}, null, sampleData[0]];
            var results = filterAndScore(badData, { minViability: 0, maxDead: 100, tolerance: 0 });
            expect(results.length).toBe(1);
        });

        test('combined filters narrow results correctly', () => {
            var results = filterAndScore(sampleData, {
                minViability: 70,
                maxDead: 30,
                minElasticity: 40,
                maxLayerHeight: 1.0,
                crosslinking: 'yes',
                wellplate: '6',
                tolerance: 0
            });
            // Must satisfy ALL: viability>=70, dead<=30, elasticity>=40, layerH<=1.0, CL=yes, wellplate=6
            // Record 1: 85/15/72/0.3/yes/6 → YES
            // Record 4: 75/25/55/0.4/yes/6 → YES
            expect(results.length).toBe(2);
        });
    });

    describe('computeRecipe', () => {
        test('computes median, q1, q3, min, max for all parameters', () => {
            var matches = sampleData.map(function(r) { return { record: r, score: 0.5 }; });
            var recipe = computeRecipe(matches);

            expect(recipe.pressure1).toBeDefined();
            expect(recipe.pressure1.median).toBeDefined();
            expect(recipe.pressure1.q1).toBeDefined();
            expect(recipe.pressure1.q3).toBeDefined();
            expect(recipe.pressure1.min).toBeDefined();
            expect(recipe.pressure1.max).toBeDefined();
            expect(recipe.pressure1.mean).toBeDefined();
        });

        test('IQR is within min-max range', () => {
            var matches = sampleData.map(function(r) { return { record: r, score: 0.5 }; });
            var recipe = computeRecipe(matches);
            var keys = Object.keys(recipe);
            for (var i = 0; i < keys.length; i++) {
                var r = recipe[keys[i]];
                expect(r.q1).toBeGreaterThanOrEqual(r.min);
                expect(r.q3).toBeLessThanOrEqual(r.max);
                expect(r.q1).toBeLessThanOrEqual(r.q3);
                expect(r.median).toBeGreaterThanOrEqual(r.q1);
                expect(r.median).toBeLessThanOrEqual(r.q3);
            }
        });

        test('single record returns that record values', () => {
            var matches = [{ record: sampleData[0], score: 0.8 }];
            var recipe = computeRecipe(matches);
            expect(recipe.pressure1.median).toBe(40);
            expect(recipe.pressure1.min).toBe(40);
            expect(recipe.pressure1.max).toBe(40);
        });

        test('mean is computed correctly for pressure1', () => {
            var matches = sampleData.slice(0, 2).map(function(r) { return { record: r, score: 0.5 }; });
            var recipe = computeRecipe(matches);
            // (40 + 50) / 2 = 45
            expect(recipe.pressure1.mean).toBe(45);
        });

        test('includes all expected parameter keys', () => {
            var matches = [{ record: sampleData[0], score: 0.5 }];
            var recipe = computeRecipe(matches);
            var expected = ['pressure1', 'pressure2', 'clDuration', 'clIntensity',
                'layerHeight', 'layerNum', 'viability', 'elasticity', 'deadPercent'];
            for (var i = 0; i < expected.length; i++) {
                expect(recipe[expected[i]]).toBeDefined();
            }
        });
    });

    describe('formatRecipeText', () => {
        test('produces readable text with all parameters', () => {
            var matches = sampleData.map(function(r) { return { record: r, score: 0.5 }; });
            var recipe = computeRecipe(matches);
            var text = formatRecipeText(recipe, 5);

            expect(text).toContain('Bioprint Recipe');
            expect(text).toContain('Extruder 1 Pressure');
            expect(text).toContain('Layer Height');
            expect(text).toContain('Matching runs: 5');
        });

        test('includes IQR ranges', () => {
            var matches = sampleData.map(function(r) { return { record: r, score: 0.5 }; });
            var recipe = computeRecipe(matches);
            var text = formatRecipeText(recipe, 5);
            expect(text).toContain('IQR:');
        });
    });

    describe('buildHistogram', () => {
        test('creates correct number of bins', () => {
            var bins = buildHistogram([1, 2, 3, 4, 5, 6, 7, 8], 4);
            expect(bins.length).toBe(4);
        });

        test('all values are binned', () => {
            var values = [10, 20, 30, 40, 50];
            var bins = buildHistogram(values, 3);
            var totalCount = bins.reduce(function(s, b) { return s + b.count; }, 0);
            expect(totalCount).toBe(5);
        });

        test('bins have correct lo/hi ranges', () => {
            var bins = buildHistogram([0, 100], 2);
            expect(bins[0].lo).toBe(0);
            expect(bins[1].hi).toBe(100);
        });

        test('handles empty array', () => {
            var bins = buildHistogram([], 4);
            expect(bins.length).toBe(0);
        });

        test('handles single value', () => {
            var bins = buildHistogram([42], 3);
            var totalCount = bins.reduce(function(s, b) { return s + b.count; }, 0);
            expect(totalCount).toBe(1);
        });
    });

    describe('PRESETS', () => {
        test('all 5 presets are defined', () => {
            expect(Object.keys(PRESETS).length).toBe(5);
            expect(PRESETS['high-viability']).toBeDefined();
            expect(PRESETS['fine-resolution']).toBeDefined();
            expect(PRESETS['balanced']).toBeDefined();
            expect(PRESETS['rapid-prototype']).toBeDefined();
            expect(PRESETS['high-elasticity']).toBeDefined();
        });

        test('high-viability preset has viability >= 80', () => {
            expect(PRESETS['high-viability'].minViability).toBe(80);
        });

        test('fine-resolution preset has small layer height', () => {
            expect(PRESETS['fine-resolution'].maxLayerHeight).toBeLessThanOrEqual(0.3);
        });

        test('rapid-prototype preset disables crosslinking', () => {
            expect(PRESETS['rapid-prototype'].crosslinking).toBe('no');
        });

        test('presets produce valid results when used with filterAndScore', () => {
            var keys = Object.keys(PRESETS);
            for (var i = 0; i < keys.length; i++) {
                var results = filterAndScore(sampleData, PRESETS[keys[i]]);
                expect(Array.isArray(results)).toBe(true);
                // Each result should have record and score
                for (var j = 0; j < results.length; j++) {
                    expect(results[j].record).toBeDefined();
                    expect(typeof results[j].score).toBe('number');
                }
            }
        });
    });
});
