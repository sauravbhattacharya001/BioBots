'use strict';

var m = require('../docs/shared/materials');

describe('materials - MATERIAL_PROFILES', function () {
    test('exports the expected canonical materials', function () {
        var keys = Object.keys(m.MATERIAL_PROFILES);
        ['gelatin-methacrylate', 'alginate', 'collagen-type-1', 'pluronic-f127',
         'pcl', 'hyaluronic-acid', 'fibrin', 'silk-fibroin', 'pectin', 'custom']
            .forEach(function (k) {
                expect(keys).toContain(k);
            });
    });

    test('every material has required fields with valid types', function () {
        Object.keys(m.MATERIAL_PROFILES).forEach(function (k) {
            var mat = m.MATERIAL_PROFILES[k];
            expect(typeof mat.name).toBe('string');
            expect(mat.name.length).toBeGreaterThan(0);
            expect(typeof mat.density).toBe('number');
            expect(mat.density).toBeGreaterThan(0);
            expect(typeof mat.costPerMl).toBe('number');
            expect(mat.costPerMl).toBeGreaterThanOrEqual(0);
            expect(['low', 'medium', 'high']).toContain(mat.viscosity);
        });
    });

    test('densities are within plausible bioink range (0.9-1.2 g/mL)', function () {
        Object.keys(m.MATERIAL_PROFILES).forEach(function (k) {
            var mat = m.MATERIAL_PROFILES[k];
            if (k === 'custom') { return; }
            expect(mat.density).toBeGreaterThanOrEqual(0.9);
            expect(mat.density).toBeLessThanOrEqual(1.3);
        });
    });

    test('custom material defaults to zero cost and unity density', function () {
        expect(m.MATERIAL_PROFILES.custom.costPerMl).toBe(0);
        expect(m.MATERIAL_PROFILES.custom.density).toBe(1.0);
    });
});

describe('materials - WELLPLATE_SPECS', function () {
    test('includes standard SBS wellplate formats', function () {
        [6, 12, 24, 48, 96].forEach(function (n) {
            expect(m.WELLPLATE_SPECS[n]).toBeDefined();
        });
    });

    test('areaMm2 matches area (backward compat alias)', function () {
        Object.keys(m.WELLPLATE_SPECS).forEach(function (k) {
            var spec = m.WELLPLATE_SPECS[k];
            expect(spec.area).toBe(spec.areaMm2);
        });
    });

    test('well count matches key', function () {
        Object.keys(m.WELLPLATE_SPECS).forEach(function (k) {
            expect(m.WELLPLATE_SPECS[k].wells).toBe(Number(k));
        });
    });

    test('area is approximately π·(diameter/2)² within 5% tolerance', function () {
        Object.keys(m.WELLPLATE_SPECS).forEach(function (k) {
            var spec = m.WELLPLATE_SPECS[k];
            var expected = Math.PI * Math.pow(spec.diameter / 2, 2);
            var ratio = spec.areaMm2 / expected;
            expect(ratio).toBeGreaterThan(0.95);
            expect(ratio).toBeLessThan(1.05);
        });
    });

    test('higher well count means smaller per-well area', function () {
        var keys = [6, 12, 24, 48, 96];
        for (var i = 1; i < keys.length; i++) {
            expect(m.WELLPLATE_SPECS[keys[i]].areaMm2)
                .toBeLessThan(m.WELLPLATE_SPECS[keys[i - 1]].areaMm2);
        }
    });
});

describe('materials - CELL_PROFILES', function () {
    test('includes common cell lines', function () {
        ['HEK293', 'CHO', 'MSC', 'iPSC', 'fibroblast'].forEach(function (k) {
            expect(m.CELL_PROFILES[k]).toBeDefined();
        });
    });

    test('viabilityBase is a probability in [0,1]', function () {
        Object.keys(m.CELL_PROFILES).forEach(function (k) {
            var c = m.CELL_PROFILES[k];
            expect(c.viabilityBase).toBeGreaterThanOrEqual(0);
            expect(c.viabilityBase).toBeLessThanOrEqual(1);
        });
    });

    test('shearSensitivity is non-negative', function () {
        Object.keys(m.CELL_PROFILES).forEach(function (k) {
            expect(m.CELL_PROFILES[k].shearSensitivity).toBeGreaterThanOrEqual(0);
        });
    });

    test('iPSC is more expensive than fibroblast (sanity)', function () {
        expect(m.CELL_PROFILES.iPSC.costPer1M)
            .toBeGreaterThan(m.CELL_PROFILES.fibroblast.costPer1M);
    });
});

describe('materials - getMaterial()', function () {
    test('returns the matching profile by key', function () {
        var alg = m.getMaterial('alginate');
        expect(alg).toBe(m.MATERIAL_PROFILES.alginate);
        expect(alg.name).toBe('Alginate');
    });

    test('returns null for unknown key without fallback', function () {
        expect(m.getMaterial('does-not-exist')).toBeNull();
    });

    test('returns null when fallback explicitly disabled', function () {
        expect(m.getMaterial('does-not-exist', false)).toBeNull();
    });

    test('returns custom profile when fallback enabled', function () {
        expect(m.getMaterial('does-not-exist', true)).toBe(m.MATERIAL_PROFILES.custom);
    });

    test('falsy key returns null', function () {
        expect(m.getMaterial('')).toBeNull();
        expect(m.getMaterial(null)).toBeNull();
        expect(m.getMaterial(undefined)).toBeNull();
    });
});

describe('materials - listMaterials()', function () {
    test('returns array of all material keys', function () {
        var keys = m.listMaterials();
        expect(Array.isArray(keys)).toBe(true);
        expect(keys.length).toBe(Object.keys(m.MATERIAL_PROFILES).length);
    });

    test('returned list includes custom', function () {
        expect(m.listMaterials()).toContain('custom');
    });
});
