'use strict';

var assert = require('assert');
var uc = require('../docs/shared/unitConverter');

describe('unitConverter', function () {
    var converter;

    beforeEach(function () {
        converter = uc.createUnitConverter();
    });

    describe('convert()', function () {
        it('should convert mL to L', function () {
            var r = converter.convert(500, 'mL', 'L');
            assert.strictEqual(r.value, 0.5);
            assert.strictEqual(r.category, 'Volume');
        });

        it('should return same value when from === to', function () {
            var r = converter.convert(42, 'g', 'g');
            assert.strictEqual(r.value, 42);
        });

        it('should convert µL to mL', function () {
            var r = converter.convert(1000, 'µL', 'mL');
            assert.strictEqual(r.value, 1);
        });

        it('should convert kPa to psi', function () {
            var r = converter.convert(100, 'kPa', 'psi');
            assert(Math.abs(r.value - 14.503774) < 0.001);
        });

        it('should convert °C to °F', function () {
            var r = converter.convert(37, '°C', '°F');
            assert.strictEqual(r.value, 98.6);
        });

        it('should convert °F to °C', function () {
            var r = converter.convert(212, '°F', '°C');
            assert.strictEqual(r.value, 100);
        });

        it('should convert °C to K', function () {
            var r = converter.convert(0, '°C', 'K');
            assert.strictEqual(r.value, 273.15);
        });

        it('should convert K to °C', function () {
            var r = converter.convert(310.15, 'K', '°C');
            assert.strictEqual(r.value, 37);
        });

        it('should convert mm to µm', function () {
            var r = converter.convert(0.4, 'mm', 'µm');
            assert.strictEqual(r.value, 400);
        });

        it('should convert mm/s to mm/min', function () {
            var r = converter.convert(10, 'mm/s', 'mm/min');
            assert.strictEqual(r.value, 600);
        });

        it('should throw on unknown unit', function () {
            assert.throws(function () { converter.convert(1, 'xyz', 'mL'); }, /Unknown unit/);
        });

        it('should throw on cross-category conversion', function () {
            assert.throws(function () { converter.convert(1, 'mL', 'g'); }, /Cannot convert/);
        });

        it('should throw on non-numeric value', function () {
            assert.throws(function () { converter.convert('abc', 'mL', 'L'); }, /valid number/);
        });
    });

    describe('convertAll()', function () {
        it('should convert to all volume units', function () {
            var r = converter.convertAll(1, 'L');
            assert.strictEqual(r.category, 'Volume');
            assert.strictEqual(r.conversions['mL'], 1000);
            assert.strictEqual(r.conversions['L'], 1);
        });

        it('should convert temperature to all units', function () {
            var r = converter.convertAll(100, '°C');
            assert.strictEqual(r.conversions['°F'], 212);
            assert.strictEqual(r.conversions['K'], 373.15);
        });

        it('should throw on unknown unit', function () {
            assert.throws(function () { converter.convertAll(1, 'xyz'); }, /Unknown unit/);
        });
    });

    describe('listCategories()', function () {
        it('should include standard categories', function () {
            var cats = converter.listCategories();
            assert(cats.indexOf('Volume') >= 0);
            assert(cats.indexOf('Mass') >= 0);
            assert(cats.indexOf('Temperature') >= 0);
            assert(cats.indexOf('Pressure') >= 0);
        });
    });

    describe('listUnits()', function () {
        it('should list volume units', function () {
            var units = converter.listUnits('Volume');
            assert(units.indexOf('mL') >= 0);
            assert(units.indexOf('µL') >= 0);
        });

        it('should list temperature units', function () {
            var units = converter.listUnits('Temperature');
            assert(units.indexOf('°C') >= 0);
            assert(units.indexOf('K') >= 0);
        });

        it('should throw on unknown category', function () {
            assert.throws(function () { converter.listUnits('FakeCategory'); }, /Unknown category/);
        });
    });

    describe('referenceTable()', function () {
        it('should return reference for Volume', function () {
            var ref = converter.referenceTable('Volume');
            assert.strictEqual(ref.baseUnit, 'L');
            assert(ref.conversions['mL'] > 0);
        });

        it('should return temperature references', function () {
            var ref = converter.referenceTable('Temperature');
            assert(ref.references.length > 0);
            assert.strictEqual(ref.references[0].conversions['°C'], 0);
        });

        it('should throw on unknown category', function () {
            assert.throws(function () { converter.referenceTable('Nope'); }, /Unknown category/);
        });
    });
});
