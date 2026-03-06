const { clamp, validatePositive, validateNonNegative } = require('../Try/scripts/scriptUtils');

describe('scriptUtils', () => {
    // ── clamp ───────────────────────────────────────────────────────────

    describe('clamp', () => {
        test('returns value when within bounds', () => {
            expect(clamp(5, 0, 10)).toBe(5);
        });

        test('clamps to lower bound', () => {
            expect(clamp(-5, 0, 10)).toBe(0);
        });

        test('clamps to upper bound', () => {
            expect(clamp(15, 0, 10)).toBe(10);
        });

        test('returns lo when value equals lo', () => {
            expect(clamp(0, 0, 10)).toBe(0);
        });

        test('returns hi when value equals hi', () => {
            expect(clamp(10, 0, 10)).toBe(10);
        });

        test('handles negative range', () => {
            expect(clamp(-3, -5, -1)).toBe(-3);
            expect(clamp(-10, -5, -1)).toBe(-5);
            expect(clamp(0, -5, -1)).toBe(-1);
        });

        test('handles zero-width range', () => {
            expect(clamp(5, 3, 3)).toBe(3);
            expect(clamp(1, 3, 3)).toBe(3);
        });

        test('handles fractional values', () => {
            expect(clamp(0.5, 0, 1)).toBe(0.5);
            expect(clamp(1.5, 0, 1)).toBe(1);
            expect(clamp(-0.1, 0, 1)).toBe(0);
        });

        test('handles Infinity inputs', () => {
            expect(clamp(Infinity, 0, 10)).toBe(10);
            expect(clamp(-Infinity, 0, 10)).toBe(0);
        });
    });

    // ── validatePositive ────────────────────────────────────────────────

    describe('validatePositive', () => {
        test('accepts positive integers', () => {
            expect(() => validatePositive(1, 'x')).not.toThrow();
            expect(() => validatePositive(42, 'x')).not.toThrow();
        });

        test('accepts positive decimals', () => {
            expect(() => validatePositive(0.001, 'x')).not.toThrow();
            expect(() => validatePositive(3.14, 'x')).not.toThrow();
        });

        test('rejects zero', () => {
            expect(() => validatePositive(0, 'val')).toThrow(/val/);
            expect(() => validatePositive(0, 'val')).toThrow(/positive finite/);
        });

        test('rejects negative numbers', () => {
            expect(() => validatePositive(-1, 'n')).toThrow(/n/);
            expect(() => validatePositive(-0.5, 'n')).toThrow();
        });

        test('rejects Infinity', () => {
            expect(() => validatePositive(Infinity, 'inf')).toThrow(/inf/);
        });

        test('rejects negative Infinity', () => {
            expect(() => validatePositive(-Infinity, 'ninf')).toThrow();
        });

        test('rejects NaN', () => {
            expect(() => validatePositive(NaN, 'nan')).toThrow(/nan/);
        });

        test('rejects non-number types', () => {
            expect(() => validatePositive('5', 'str')).toThrow(/str/);
            expect(() => validatePositive(null, 'nul')).toThrow(/nul/);
            expect(() => validatePositive(undefined, 'undef')).toThrow();
            expect(() => validatePositive(true, 'bool')).toThrow();
        });

        test('error message includes the actual value', () => {
            expect(() => validatePositive(-3, 'pressure')).toThrow('pressure must be a positive finite number, got -3');
        });
    });

    // ── validateNonNegative ─────────────────────────────────────────────

    describe('validateNonNegative', () => {
        test('accepts zero', () => {
            expect(() => validateNonNegative(0, 'x')).not.toThrow();
        });

        test('accepts positive numbers', () => {
            expect(() => validateNonNegative(1, 'x')).not.toThrow();
            expect(() => validateNonNegative(0.001, 'x')).not.toThrow();
        });

        test('rejects negative numbers', () => {
            expect(() => validateNonNegative(-1, 'n')).toThrow(/n/);
            expect(() => validateNonNegative(-0.001, 'n')).toThrow();
        });

        test('rejects Infinity', () => {
            expect(() => validateNonNegative(Infinity, 'inf')).toThrow(/inf/);
        });

        test('rejects NaN', () => {
            expect(() => validateNonNegative(NaN, 'nan')).toThrow(/nan/);
        });

        test('rejects non-number types', () => {
            expect(() => validateNonNegative('0', 'str')).toThrow(/str/);
            expect(() => validateNonNegative(null, 'nul')).toThrow(/nul/);
        });

        test('error message includes the actual value', () => {
            expect(() => validateNonNegative(-7, 'duration')).toThrow('duration must be a non-negative finite number, got -7');
        });
    });
});
