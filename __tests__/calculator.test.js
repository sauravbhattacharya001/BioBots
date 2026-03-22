const { createMaterialCalculator } = require('../docs/shared/calculator');

describe('createMaterialCalculator', () => {
    let calc;

    beforeEach(() => {
        calc = createMaterialCalculator();
    });

    // ── volumePerLayer ──────────────────────────────────────────────────

    describe('volumePerLayer', () => {
        test('calculates area * height', () => {
            expect(calc.volumePerLayer(100, 0.5)).toBe(50);
        });

        test('returns 0 for zero area', () => {
            expect(calc.volumePerLayer(0, 0.5)).toBe(0);
        });

        test('returns 0 for negative height', () => {
            expect(calc.volumePerLayer(100, -1)).toBe(0);
        });

        test('returns 0 for null inputs', () => {
            expect(calc.volumePerLayer(null, 0.5)).toBe(0);
        });
    });

    // ── calculateUsage ──────────────────────────────────────────────────

    describe('calculateUsage', () => {
        const baseParams = {
            wellplate: 24,
            wellCount: 24,
            layerHeight: 0.8,
            layerNum: 10,
            infillPercent: 100,
            wastePercent: 15,
            materialKey: 'gelatin-methacrylate'
        };

        test('returns correct structure', () => {
            var result = calc.calculateUsage(baseParams);
            expect(result).toHaveProperty('totalVolumeMl');
            expect(result).toHaveProperty('estimatedCost');
            expect(result).toHaveProperty('volumePerWellUl');
            expect(result).toHaveProperty('netVolumeUl');
            expect(result).toHaveProperty('printHeight');
            expect(result).toHaveProperty('material');
        });

        test('calculates print height correctly', () => {
            var result = calc.calculateUsage(baseParams);
            expect(result.printHeight).toBe(8); // 0.8 * 10
        });

        test('net volume = vol_per_well * wellCount', () => {
            var result = calc.calculateUsage({ ...baseParams, infillPercent: 100, wastePercent: 0 });
            expect(result.netVolumeUl).toBe(result.volumePerWellUl * 24);
            expect(result.totalVolumeUl).toBe(result.netVolumeUl); // no waste
        });

        test('waste adds to total', () => {
            var result = calc.calculateUsage({ ...baseParams, wastePercent: 20 });
            var noWaste = calc.calculateUsage({ ...baseParams, wastePercent: 0 });
            expect(result.totalVolumeUl).toBeCloseTo(noWaste.totalVolumeUl * 1.2, 0);
        });

        test('infill reduces volume', () => {
            var full = calc.calculateUsage({ ...baseParams, infillPercent: 100 });
            var half = calc.calculateUsage({ ...baseParams, infillPercent: 50 });
            expect(half.netVolumeUl).toBeCloseTo(full.netVolumeUl / 2, 0);
        });

        test('defaults wellCount to all wells', () => {
            var result = calc.calculateUsage({ ...baseParams, wellCount: undefined });
            expect(result.wellCount).toBe(24);
        });

        test('throws for invalid wellplate', () => {
            expect(() => calc.calculateUsage({ ...baseParams, wellplate: 7 })).toThrow('Invalid wellplate');
        });

        test('throws for zero layer height', () => {
            expect(() => calc.calculateUsage({ ...baseParams, layerHeight: 0 })).toThrow('Layer height');
        });

        test('throws for excessive layer height', () => {
            expect(() => calc.calculateUsage({ ...baseParams, layerHeight: 10 })).toThrow('exceeds maximum');
        });

        test('throws for too many layers', () => {
            expect(() => calc.calculateUsage({ ...baseParams, layerNum: 600 })).toThrow('exceeds maximum');
        });

        test('throws for well count exceeding plate', () => {
            expect(() => calc.calculateUsage({ ...baseParams, wellCount: 30 })).toThrow('Well count');
        });

        test('throws for non-object params', () => {
            expect(() => calc.calculateUsage(null)).toThrow('Parameters must be an object');
        });

        test('uses custom density and cost', () => {
            var result = calc.calculateUsage({
                ...baseParams,
                materialKey: 'custom',
                customDensity: 2.0,
                customCost: 25
            });
            expect(result.material).toBe('Custom');
            expect(result.estimatedCost).toBeGreaterThan(0);
        });

        test('handles 6-well plate', () => {
            var result = calc.calculateUsage({ ...baseParams, wellplate: 6, wellCount: 6 });
            expect(result.wellplate).toBe('6-well');
        });

        test('throws for negative customDensity', () => {
            expect(() => calc.calculateUsage({ ...baseParams, customDensity: -1 })).toThrow('Custom density must be a positive number');
        });

        test('throws for NaN customDensity', () => {
            expect(() => calc.calculateUsage({ ...baseParams, customDensity: NaN })).toThrow('Custom density must be a positive number');
        });

        test('throws for negative customCost', () => {
            expect(() => calc.calculateUsage({ ...baseParams, customCost: -5 })).toThrow('Custom cost must be a non-negative number');
        });

        test('throws for Infinity customCost', () => {
            expect(() => calc.calculateUsage({ ...baseParams, customCost: Infinity })).toThrow('Custom cost must be a non-negative number');
        });

        test('allows zero customCost', () => {
            var result = calc.calculateUsage({ ...baseParams, customCost: 0 });
            expect(result.estimatedCost).toBe(0);
        });

        test('handles 96-well plate', () => {
            var result = calc.calculateUsage({ ...baseParams, wellplate: 96, wellCount: 1 });
            expect(result.wellplate).toBe('96-well');
        });
    });

    // ── estimateDuration ────────────────────────────────────────────────

    describe('estimateDuration', () => {
        const baseParams = {
            wellplate: 24,
            wellCount: 24,
            layerHeight: 0.8,
            layerNum: 10,
            infillPercent: 100,
            wastePercent: 15,
            materialKey: 'alginate',
            extruderSpeed: 5
        };

        test('returns duration structure', () => {
            var result = calc.estimateDuration(baseParams);
            expect(result).toHaveProperty('printTimeMinutes');
            expect(result).toHaveProperty('totalTimeMinutes');
            expect(result).toHaveProperty('totalTimeFormatted');
            expect(result).toHaveProperty('travelDistanceMm');
        });

        test('crosslinking adds to total', () => {
            var noCl = calc.estimateDuration({ ...baseParams, clDuration: 0 });
            var withCl = calc.estimateDuration({ ...baseParams, clDuration: 10 });
            expect(withCl.totalTimeMinutes).toBeGreaterThan(noCl.totalTimeMinutes);
            expect(withCl.crosslinkingTimeMinutes).toBeGreaterThan(0);
        });

        test('throws for negative speed', () => {
            expect(() => calc.estimateDuration({ ...baseParams, extruderSpeed: -1 })).toThrow('Speed');
        });

        test('defaults speed to 5 mm/s', () => {
            var result = calc.estimateDuration({ ...baseParams, extruderSpeed: undefined });
            expect(result.printTimeMinutes).toBeGreaterThan(0);
        });
    });

    // ── getMaterials / getWellplates ─────────────────────────────────────

    describe('getMaterials', () => {
        test('returns all profiles', () => {
            var mats = calc.getMaterials();
            expect(Object.keys(mats).length).toBe(5);
            expect(mats['gelatin-methacrylate'].name).toBe('GelMA');
        });

        test('returns a copy', () => {
            var m1 = calc.getMaterials();
            m1['gelatin-methacrylate'].name = 'Modified';
            var m2 = calc.getMaterials();
            expect(m2['gelatin-methacrylate'].name).toBe('GelMA');
        });
    });

    describe('getWellplates', () => {
        test('returns specs for 5 wellplates', () => {
            var wp = calc.getWellplates();
            expect(Object.keys(wp)).toEqual(['6', '12', '24', '48', '96']);
        });
    });

    // ── compareConfigs ──────────────────────────────────────────────────

    describe('compareConfigs', () => {
        test('compares multiple configs', () => {
            var configs = [
                { wellplate: 6, wellCount: 6, layerHeight: 0.5, layerNum: 5, materialKey: 'alginate' },
                { wellplate: 24, wellCount: 24, layerHeight: 0.8, layerNum: 10, materialKey: 'alginate' }
            ];
            var results = calc.compareConfigs(configs);
            expect(results.length).toBe(2);
            expect(results[0].success).toBe(true);
            expect(results[1].success).toBe(true);
        });

        test('handles errors gracefully', () => {
            var results = calc.compareConfigs([{ wellplate: 999 }]);
            expect(results[0].success).toBe(false);
            expect(results[0].error).toBeDefined();
        });

        test('throws for empty array', () => {
            expect(() => calc.compareConfigs([])).toThrow('non-empty');
        });

        test('throws for too many configs', () => {
            var many = new Array(11).fill({ wellplate: 6, layerHeight: 0.5, layerNum: 1, materialKey: 'alginate' });
            expect(() => calc.compareConfigs(many)).toThrow('Maximum 10');
        });
    });

    // ── formatDuration ──────────────────────────────────────────────────

    describe('formatDuration', () => {
        test('formats seconds for < 1 min', () => {
            expect(calc.formatDuration(0.5)).toBe('30s');
        });

        test('formats minutes only', () => {
            expect(calc.formatDuration(45)).toBe('45min');
        });

        test('formats hours and minutes', () => {
            expect(calc.formatDuration(125)).toBe('2h 5min');
        });

        test('does not produce 60min when rounding up near hour boundary', () => {
            // 59.6 minutes should round to 1h 0min, not "60min"
            expect(calc.formatDuration(59.6)).toBe('1h 0min');
        });

        test('does not produce 60min in hours+minutes format', () => {
            // 119.6 minutes should round to 2h 0min, not "1h 60min"
            expect(calc.formatDuration(119.6)).toBe('2h 0min');
        });

        test('formats exact hour boundary', () => {
            expect(calc.formatDuration(60)).toBe('1h 0min');
        });
    });

    // ── round ───────────────────────────────────────────────────────────

    describe('round', () => {
        test('rounds to specified decimals', () => {
            expect(calc.round(3.14159, 2)).toBe(3.14);
            expect(calc.round(3.14159, 0)).toBe(3);
        });
    });
});
