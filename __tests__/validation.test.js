'use strict';

var validation = require('../docs/shared/validation');

describe('validation module', function () {
  describe('validatePositive', function () {
    it('accepts positive numbers', function () {
      expect(function () { validation.validatePositive(1, 'x'); }).not.toThrow();
      expect(function () { validation.validatePositive(0.001, 'x'); }).not.toThrow();
    });

    it('rejects zero', function () {
      expect(function () { validation.validatePositive(0, 'x'); }).toThrow(/positive/);
    });

    it('rejects negative', function () {
      expect(function () { validation.validatePositive(-1, 'x'); }).toThrow(/positive/);
    });

    it('rejects non-numbers', function () {
      expect(function () { validation.validatePositive('5', 'x'); }).toThrow(/positive/);
      expect(function () { validation.validatePositive(NaN, 'x'); }).toThrow(/positive/);
      expect(function () { validation.validatePositive(Infinity, 'x'); }).toThrow(/positive/);
    });
  });

  describe('validateNonNegative', function () {
    it('accepts zero', function () {
      expect(function () { validation.validateNonNegative(0, 'x'); }).not.toThrow();
    });

    it('rejects negative', function () {
      expect(function () { validation.validateNonNegative(-1, 'x'); }).toThrow(/non-negative/);
    });
  });

  describe('round', function () {
    it('rounds to 2 decimals by default', function () {
      expect(validation.round(1.2345)).toBe(1.23);
    });

    it('rounds to specified decimals', function () {
      expect(validation.round(1.2345, 3)).toBe(1.235);
    });
  });
});
