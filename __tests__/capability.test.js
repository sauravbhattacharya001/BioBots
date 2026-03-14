'use strict';

var capability = require('../docs/shared/capability');

describe('CapabilityAnalyzer', function () {
    var analyzer;

    beforeEach(function () {
        analyzer = capability.createCapabilityAnalyzer();
    });

    describe('analyze()', function () {
        it('should compute capability indices for a capable process', function () {
            // Well-centered process with tight variation
            var measurements = [];
            for (var i = 0; i < 50; i++) {
                measurements.push(2.25 + (Math.random() - 0.5) * 0.2);
            }
            var result = analyzer.analyze({
                measurements: measurements,
                lsl: 1.5,
                usl: 3.0,
                target: 2.25
            });

            expect(result.cp).toBeGreaterThan(1);
            expect(result.cpk).toBeGreaterThan(0);
            expect(result.pp).toBeGreaterThan(0);
            expect(result.ppk).toBeGreaterThan(0);
            expect(result.sigmaLevel).toBeGreaterThan(0);
            expect(result.pctOutOfSpec).toBeGreaterThanOrEqual(0);
            expect(result.pctOutOfSpec).toBeLessThanOrEqual(100);
            expect(['capable', 'marginal', 'incapable']).toContain(result.verdict);
            expect(result.stats.n).toBe(50);
            expect(result.stats.lsl).toBe(1.5);
            expect(result.stats.usl).toBe(3.0);
        });

        it('should return incapable for high-variation process', function () {
            // Process with variation exceeding spec limits
            var measurements = [0.5, 4.0, 1.0, 3.5, 0.8, 3.8, 1.2, 3.2, 0.6, 4.1];
            var result = analyzer.analyze({
                measurements: measurements,
                lsl: 1.5,
                usl: 3.0
            });

            expect(result.cpk).toBeLessThan(1);
            expect(result.verdict).toBe('incapable');
            expect(result.pctOutOfSpec).toBeGreaterThan(0);
        });

        it('should handle batched measurements', function () {
            var result = analyzer.analyze({
                batches: [
                    [2.1, 2.2, 2.3, 2.2, 2.1],
                    [2.0, 2.3, 2.1, 2.2, 2.0],
                    [2.2, 2.1, 2.3, 2.2, 2.1],
                    [2.1, 2.0, 2.2, 2.3, 2.1]
                ],
                lsl: 1.5,
                usl: 3.0,
                target: 2.25
            });

            expect(result.stats.n).toBe(20);
            expect(result.stats.nBatches).toBe(4);
            expect(result.cp).toBeGreaterThan(1);
            expect(result.verdict).toBe('capable');
        });

        it('should default target to spec midpoint', function () {
            var result = analyzer.analyze({
                measurements: [2.1, 2.2, 2.3],
                lsl: 1.0,
                usl: 3.0
            });

            expect(result.stats.target).toBe(2.0);
        });

        it('should throw on missing spec limits', function () {
            expect(function () {
                analyzer.analyze({ measurements: [1, 2, 3], lsl: 1 });
            }).toThrow('Both lsl and usl are required');
        });

        it('should throw when usl <= lsl', function () {
            expect(function () {
                analyzer.analyze({ measurements: [1, 2, 3], lsl: 3, usl: 1 });
            }).toThrow('usl must be greater than lsl');
        });

        it('should throw on insufficient measurements', function () {
            expect(function () {
                analyzer.analyze({ measurements: [1], lsl: 0, usl: 2 });
            }).toThrow('At least 2 measurements');
        });

        it('should compute Cpm (Taguchi index)', function () {
            var result = analyzer.analyze({
                measurements: [2.0, 2.1, 2.2, 2.3, 2.4],
                lsl: 1.0,
                usl: 3.0,
                target: 2.2
            });

            expect(result.cpm).toBeGreaterThan(0);
            expect(typeof result.cpm).toBe('number');
        });
    });

    describe('compareParameters()', function () {
        it('should compare multiple parameters sorted by worst Cpk first', function () {
            var results = analyzer.compareParameters([
                {
                    name: 'Layer Height',
                    measurements: [0.20, 0.21, 0.19, 0.20, 0.22, 0.18, 0.20, 0.21, 0.19, 0.20],
                    lsl: 0.15,
                    usl: 0.25
                },
                {
                    name: 'Fiber Diameter',
                    measurements: [0.5, 0.8, 0.3, 1.0, 0.2, 0.9, 0.4, 0.7, 0.6, 0.5],
                    lsl: 0.4,
                    usl: 0.6
                }
            ]);

            expect(results.length).toBe(2);
            // Worst Cpk first
            expect(results[0].cpk).toBeLessThanOrEqual(results[1].cpk);
            expect(results[0].name).toBeDefined();
        });
    });
});
