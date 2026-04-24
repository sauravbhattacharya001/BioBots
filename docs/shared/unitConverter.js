'use strict';

/**
 * Unit Converter — convert between common laboratory and bioprinting units.
 *
 * Categories: Volume, Mass, Length, Temperature, Pressure, Flow Rate, Time,
 *             Concentration (simple w/v), Force, Speed (print speed).
 *
 * @example
 *   var converter = createUnitConverter();
 *   converter.convert(500, 'µL', 'mL');  // => { value: 0.5, from: 'µL', to: 'mL' }
 *   converter.convert(37, '°C', '°F');   // => { value: 98.6, from: '°C', to: '°F' }
 *   converter.listCategories();           // => ['Volume', 'Mass', ...]
 *   converter.listUnits('Volume');        // => ['L', 'mL', 'µL', ...]
 */

// ── Unit definitions ───────────────────────────────────────────────
// Each category maps unit names to a factor (relative to the base unit).
// Temperature and other non-linear conversions are handled specially.

var CATEGORIES = {
    'Volume': {
        base: 'L',
        units: {
            'L':  1,
            'mL': 1e-3,
            'µL': 1e-6,
            'nL': 1e-9,
            'pL': 1e-12,
            'dL': 0.1,
            'cm³': 1e-3,
            'mm³': 1e-6,
            'm³': 1000,
            'gal': 3.78541,
            'fl oz': 0.0295735
        }
    },
    'Mass': {
        base: 'g',
        units: {
            'kg': 1000,
            'g': 1,
            'mg': 1e-3,
            'µg': 1e-6,
            'ng': 1e-9,
            'pg': 1e-12,
            'lb': 453.592,
            'oz': 28.3495
        }
    },
    'Length': {
        base: 'm',
        units: {
            'km': 1000,
            'm': 1,
            'cm': 0.01,
            'mm': 1e-3,
            'µm': 1e-6,
            'nm': 1e-9,
            'in': 0.0254,
            'ft': 0.3048
        }
    },
    'Pressure': {
        base: 'Pa',
        units: {
            'Pa': 1,
            'kPa': 1000,
            'MPa': 1e6,
            'bar': 1e5,
            'mbar': 100,
            'atm': 101325,
            'psi': 6894.76,
            'mmHg': 133.322,
            'Torr': 133.322
        }
    },
    'Flow Rate': {
        base: 'mL/min',
        units: {
            'L/min': 1000,
            'mL/min': 1,
            'µL/min': 1e-3,
            'mL/h': 1 / 60,
            'µL/h': 1e-3 / 60,
            'L/h': 1000 / 60,
            'mL/s': 60,
            'µL/s': 0.06
        }
    },
    'Time': {
        base: 's',
        units: {
            'ms': 1e-3,
            's': 1,
            'min': 60,
            'h': 3600,
            'day': 86400
        }
    },
    'Print Speed': {
        base: 'mm/s',
        units: {
            'mm/s': 1,
            'mm/min': 1 / 60,
            'cm/s': 10,
            'm/s': 1000,
            'in/s': 25.4
        }
    },
    'Force': {
        base: 'N',
        units: {
            'N': 1,
            'kN': 1000,
            'mN': 1e-3,
            'µN': 1e-6,
            'dyn': 1e-5,
            'lbf': 4.44822
        }
    }
};

// Temperature is non-linear — handle separately
var TEMPERATURE_UNITS = ['°C', '°F', 'K'];

function convertTemperature(value, from, to) {
    if (from === to) return value;
    // Normalize to Celsius first
    var c;
    switch (from) {
        case '°C': c = value; break;
        case '°F': c = (value - 32) * 5 / 9; break;
        case 'K':  c = value - 273.15; break;
        default: throw new Error('Unknown temperature unit: ' + from);
    }
    // Convert from Celsius to target
    switch (to) {
        case '°C': return c;
        case '°F': return c * 9 / 5 + 32;
        case 'K':  return c + 273.15;
        default: throw new Error('Unknown temperature unit: ' + to);
    }
}

function findCategory(unit) {
    if (TEMPERATURE_UNITS.indexOf(unit) !== -1) return 'Temperature';
    var cats = Object.keys(CATEGORIES);
    for (var i = 0; i < cats.length; i++) {
        if (CATEGORIES[cats[i]].units[unit] !== undefined) return cats[i];
    }
    return null;
}

function round(val, decimals) {
    if (decimals === undefined) decimals = 6;
    var factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
}

function createUnitConverter() {
    return {
        /**
         * Convert a value from one unit to another.
         * Units must be in the same category.
         */
        convert: function (value, from, to) {
            if (typeof value !== 'number' || isNaN(value)) {
                throw new Error('Value must be a valid number.');
            }
            if (from === to) {
                return { value: value, from: from, to: to, category: findCategory(from) };
            }

            var fromCat = findCategory(from);
            var toCat = findCategory(to);
            if (!fromCat) throw new Error('Unknown unit: ' + from);
            if (!toCat) throw new Error('Unknown unit: ' + to);
            if (fromCat !== toCat) {
                throw new Error('Cannot convert between categories: ' + fromCat + ' → ' + toCat);
            }

            var result;
            if (fromCat === 'Temperature') {
                result = convertTemperature(value, from, to);
            } else {
                var cat = CATEGORIES[fromCat];
                var baseValue = value * cat.units[from];
                result = baseValue / cat.units[to];
            }

            return {
                value: round(result),
                from: from,
                to: to,
                category: fromCat
            };
        },

        /**
         * Convert a value to all other units in the same category.
         */
        convertAll: function (value, from) {
            var cat = findCategory(from);
            if (!cat) throw new Error('Unknown unit: ' + from);

            var units = cat === 'Temperature' ? TEMPERATURE_UNITS : Object.keys(CATEGORIES[cat].units);
            var results = {};
            for (var i = 0; i < units.length; i++) {
                var u = units[i];
                if (cat === 'Temperature') {
                    results[u] = round(convertTemperature(value, from, u));
                } else {
                    var baseValue = value * CATEGORIES[cat].units[from];
                    results[u] = round(baseValue / CATEGORIES[cat].units[u]);
                }
            }
            return { from: from, value: value, category: cat, conversions: results };
        },

        /**
         * List all available categories.
         */
        listCategories: function () {
            return Object.keys(CATEGORIES).concat(['Temperature']).sort();
        },

        /**
         * List all units in a category.
         */
        listUnits: function (category) {
            if (category === 'Temperature') return TEMPERATURE_UNITS.slice();
            var cat = CATEGORIES[category];
            if (!cat) throw new Error('Unknown category: ' + category);
            return Object.keys(cat.units);
        },

        /**
         * Quick reference table for a category — convert value 1 of base unit to all.
         */
        referenceTable: function (category) {
            if (category === 'Temperature') {
                return {
                    category: 'Temperature',
                    references: [
                        { label: 'Freezing', conversions: { '°C': 0, '°F': 32, 'K': 273.15 } },
                        { label: 'Body temp', conversions: { '°C': 37, '°F': 98.6, 'K': 310.15 } },
                        { label: 'Boiling', conversions: { '°C': 100, '°F': 212, 'K': 373.15 } },
                        { label: 'Incubator', conversions: { '°C': 37, '°F': 98.6, 'K': 310.15 } },
                        { label: 'Room temp', conversions: { '°C': 22, '°F': 71.6, 'K': 295.15 } }
                    ]
                };
            }
            var cat = CATEGORIES[category];
            if (!cat) throw new Error('Unknown category: ' + category);
            var units = Object.keys(cat.units);
            var conversions = {};
            for (var i = 0; i < units.length; i++) {
                conversions[units[i]] = round(cat.units[cat.base] / cat.units[units[i]]);
            }
            return { category: category, baseUnit: cat.base, conversions: conversions };
        }
    };
}

if (typeof exports !== 'undefined') {
    exports.createUnitConverter = createUnitConverter;
}
