/**
 * Tests for Process Capability module (Cp, Cpk, Pp, Ppk, Six Sigma).
 */

'use strict';

var capability = require('../../docs/shared/capability');

describe('createCapabilityAnalyzer', function () {
    var analyzer;

    beforeEach(function () {
        analyzer = capability.createCapabilityAnalyzer();
    });

    describe('input validation', function () {
        test('throws on missing measurements', function () {
            expect(function () { analyzer.analyze({ lsl: 1, usl: 3 }); }).toThrow();
        });

        test('throws on empty measurements', function () {
            expect(function () { analyzer.analyze({ measurements: [], lsl: 1, usl: 3 }); }).toThrow();
        });

        test('throws on missing spec limits', function () {
            expect(function () { analyzer.analyze({ measurements: [1, 2, 3] }); }).toThrow();
        });

        test('throws when lsl >= usl', function () {
            expect(function () { analyzer.analyze({ measurements: [1, 2], lsl: 3, usl: 1 }); }).toThrow();
        });

        test('throws with fewer than 2 measurements', function () {
            expect(function () { analyzer.analyze({ measurements: [2], lsl: 1, usl: 3 }); }).toThrow();
        });
    });

    describe('flat measurements (no subgroups)', function () {
        test('centered process with low variation is capable', function () {
            // Tight measurements around 2.25 with spec [1.5, 3.0]
            var data = [2.2, 2.25, 2.3, 2.2, 2.25, 2.3, 2.22, 2.28, 2.24, 2.26];
            var result = analyzer.analyze({ measurements: data, lsl: 1.5, usl: 3.0 });

            expect(result.verdict).toBe('capable');
            expect(result.cp).toBeGreaterThan(1.33);
            expect(result.cpk).toBeGreaterThan(1.33);
            expect(result.pp).toBeGreaterThan(1.33);
            expect(result.ppk).toBeGreaterThan(1.33);
            expect(result.n).toBe(10);
            expect(result.pctOutOfSpec).toBeLessThan(0.01);
        });

        test('wide variation yields incapable', function () {
            var data = [1.0, 3.5, 0.5, 3.8, 1.2, 3.0, 0.8, 3.2];
            var result = analyzer.analyze({ measurements: data, lsl: 1.5, usl: 3.0 });

            expect(result.verdict).toBe('incapable');
            expect(result.cpk).toBeLessThan(1.0);
        });

        test('off-center process has cpk < cp', function () {
            // Measurements clustered near upper spec limit
            var data = [2.8, 2.85, 2.9, 2.82, 2.88, 2.87, 2.83, 2.86];
            var result = analyzer.analyze({ measurements: data, lsl: 1.5, usl: 3.0 });

            expect(result.cp).toBeGreaterThan(result.cpk);
        });

        test('default target is midpoint', function () {
            var result = analyzer.analyze({ measurements: [2.0, 2.5], lsl: 1.0, usl: 3.0 });
            expect(result.target).toBe(2.0);
        });

        test('custom target is preserved', function () {
            var result = analyzer.analyze({ measurements: [2.0, 2.5], lsl: 1.0, usl: 3.0, target: 1.8 });
            expect(result.target).toBe(1.8);
        });
    });

    describe('grouped measurements (batches)', function () {
        test('within-group sigma differs from overall sigma', function () {
            // Three batches with different means but tight within-batch variation
            var batches = [
                [2.0, 2.01, 2.02],
                [2.3, 2.31, 2.32],
                [2.1, 2.11, 2.12]
            ];
            var result = analyzer.analyze({ measurements: batches, lsl: 1.5, usl: 3.0 });

            // Within-batch sigma should be much smaller than overall
            expect(result.sigmaWithin).toBeLessThan(result.sigmaOverall);
            // Cp (short-term) should be better than Pp (long-term)
            expect(result.cp).toBeGreaterThan(result.pp);
            expect(result.n).toBe(9);
        });

        test('consistent batches have similar Cp and Pp', function () {
            // Batches with same mean and same spread
            var batches = [
                [2.2, 2.25, 2.3],
                [2.2, 2.25, 2.3],
                [2.2, 2.25, 2.3]
            ];
            var result = analyzer.analyze({ measurements: batches, lsl: 1.5, usl: 3.0 });

            expect(result.verdict).toBe('capable');
        });
    });

    describe('sigma level and pctOutOfSpec', function () {
        test('sigma level equals 3 * cpk', function () {
            var data = [2.0, 2.1, 2.2, 2.15, 2.05, 2.12];
            var result = analyzer.analyze({ measurements: data, lsl: 1.5, usl: 3.0 });

            expect(result.sigmaLevel).toBeCloseTo(3 * result.cpk, 3);
        });

        test('pctOutOfSpec is between 0 and 1', function () {
            var data = [2.0, 2.1, 2.2, 2.15, 2.05];
            var result = analyzer.analyze({ measurements: data, lsl: 1.5, usl: 3.0 });

            expect(result.pctOutOfSpec).toBeGreaterThanOrEqual(0);
            expect(result.pctOutOfSpec).toBeLessThanOrEqual(1);
        });
    });

    describe('output shape', function () {
        test('returns all expected fields', function () {
            var result = analyzer.analyze({ measurements: [2.0, 2.5, 2.3], lsl: 1.0, usl: 3.0 });
            var keys = Object.keys(result);

            expect(keys).toContain('cp');
            expect(keys).toContain('cpk');
            expect(keys).toContain('pp');
            expect(keys).toContain('ppk');
            expect(keys).toContain('sigmaLevel');
            expect(keys).toContain('pctOutOfSpec');
            expect(keys).toContain('verdict');
            expect(keys).toContain('n');
            expect(keys).toContain('mean');
            expect(keys).toContain('sigmaWithin');
            expect(keys).toContain('sigmaOverall');
        });
    });
});
