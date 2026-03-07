'use strict';

const { createComparator, flattenNumeric, pearson } = require('../Try/scripts/printComparator');

// --- Test data ---
const sampleRuns = [
  {
    print_data: { deadPercent: 80, elasticity: 50, livePercent: 10 },
    print_info: {
      crosslinking: { cl_duration: 20000, cl_enabled: true, cl_intensity: 20 },
      pressure: { extruder1: 40, extruder2: 90 },
      resolution: { layerHeight: 0.5, layerNum: 30 },
      wellplate: 6
    },
    user_info: { serial: 0 }
  },
  {
    print_data: { deadPercent: 60, elasticity: 70, livePercent: 30 },
    print_info: {
      crosslinking: { cl_duration: 25000, cl_enabled: true, cl_intensity: 30 },
      pressure: { extruder1: 50, extruder2: 80 },
      resolution: { layerHeight: 0.3, layerNum: 50 },
      wellplate: 12
    },
    user_info: { serial: 1 }
  },
  {
    print_data: { deadPercent: 40, elasticity: 90, livePercent: 50 },
    print_info: {
      crosslinking: { cl_duration: 30000, cl_enabled: true, cl_intensity: 40 },
      pressure: { extruder1: 60, extruder2: 70 },
      resolution: { layerHeight: 0.2, layerNum: 80 },
      wellplate: 24
    },
    user_info: { serial: 2 }
  },
  {
    print_data: { deadPercent: 90, elasticity: 30, livePercent: 5 },
    print_info: {
      crosslinking: { cl_duration: 15000, cl_enabled: true, cl_intensity: 10 },
      pressure: { extruder1: 30, extruder2: 100 },
      resolution: { layerHeight: 1.0, layerNum: 10 },
      wellplate: 6
    },
    user_info: { serial: 3 }
  },
  {
    print_data: { deadPercent: 50, elasticity: 80, livePercent: 40 },
    print_info: {
      crosslinking: { cl_duration: 28000, cl_enabled: true, cl_intensity: 35 },
      pressure: { extruder1: 55, extruder2: 75 },
      resolution: { layerHeight: 0.25, layerNum: 60 },
      wellplate: 12
    },
    user_info: { serial: 4 }
  }
];

describe('flattenNumeric', () => {
  test('flattens nested object to dot-notation keys', () => {
    const result = flattenNumeric(sampleRuns[0]);
    expect(result['print_data.deadPercent']).toBe(80);
    expect(result['print_info.crosslinking.cl_duration']).toBe(20000);
    expect(result['print_info.resolution.layerHeight']).toBe(0.5);
  });

  test('skips non-numeric and boolean fields', () => {
    const result = flattenNumeric(sampleRuns[0]);
    expect(result['print_info.crosslinking.cl_enabled']).toBeUndefined();
  });

  test('returns empty object for null/undefined', () => {
    expect(flattenNumeric(null)).toEqual({});
    expect(flattenNumeric(undefined)).toEqual({});
  });
});

describe('pearson', () => {
  test('perfect positive correlation', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1.0, 4);
  });

  test('perfect negative correlation', () => {
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1.0, 4);
  });

  test('returns 0 for single element', () => {
    expect(pearson([1], [2])).toBe(0);
  });
});

describe('createComparator', () => {
  test('throws on empty array', () => {
    expect(() => createComparator([])).toThrow('non-empty');
  });

  test('creates comparator with correct run count', () => {
    const comp = createComparator(sampleRuns);
    expect(comp.runCount).toBe(5);
    expect(comp.fields.length).toBeGreaterThan(0);
  });

  describe('compare()', () => {
    const comp = createComparator(sampleRuns);

    test('compares two runs', () => {
      const result = comp.compare([0, 1]);
      expect(result.runs).toHaveLength(2);
      expect(result.runs[0].index).toBe(0);
      expect(result.runs[1].index).toBe(1);
      expect(result.fields.length).toBeGreaterThan(0);
    });

    test('computes deltas correctly', () => {
      const result = comp.compare([0, 2]);
      const dp = result.deltas['print_data.deadPercent'];
      expect(dp.min).toBe(40);
      expect(dp.max).toBe(80);
      expect(dp.range).toBe(40);
    });

    test('throws on fewer than 2 indices', () => {
      expect(() => comp.compare([0])).toThrow('at least 2');
    });

    test('throws on out-of-range index', () => {
      expect(() => comp.compare([0, 99])).toThrow('out of range');
    });

    test('throws on more than 10 indices', () => {
      expect(() => comp.compare([0,1,2,3,4,0,1,2,3,4,0])).toThrow('at most 10');
    });
  });

  describe('rankBy()', () => {
    const comp = createComparator(sampleRuns);

    test('ranks by livePercent descending', () => {
      const ranked = comp.rankBy('print_data.livePercent', 'desc');
      expect(ranked[0].value).toBe(50);
      expect(ranked[0].rank).toBe(1);
      expect(ranked[0].index).toBe(2);
    });

    test('ranks ascending', () => {
      const ranked = comp.rankBy('print_data.deadPercent', 'asc');
      expect(ranked[0].value).toBe(40);
    });

    test('respects limit', () => {
      const ranked = comp.rankBy('print_data.livePercent', 'desc', 2);
      expect(ranked).toHaveLength(2);
    });

    test('throws on unknown field', () => {
      expect(() => comp.rankBy('nonexistent')).toThrow('Unknown field');
    });
  });

  describe('correlate()', () => {
    const comp = createComparator(sampleRuns);

    test('finds correlations with livePercent', () => {
      const corr = comp.correlate('print_data.livePercent');
      expect(corr.length).toBeGreaterThan(0);
      expect(corr[0]).toHaveProperty('field');
      expect(corr[0]).toHaveProperty('correlation');
      expect(corr[0]).toHaveProperty('absCorrelation');
      // deadPercent should be strongly negatively correlated with livePercent
      const dead = corr.find(c => c.field === 'print_data.deadPercent');
      expect(dead).toBeDefined();
      expect(dead.correlation).toBeLessThan(-0.9);
    });

    test('throws on unknown field', () => {
      expect(() => comp.correlate('nonexistent')).toThrow('Unknown field');
    });
  });

  describe('summary()', () => {
    const comp = createComparator(sampleRuns);

    test('returns stats for all fields', () => {
      const s = comp.summary();
      expect(s['print_data.livePercent']).toBeDefined();
      expect(s['print_data.livePercent'].count).toBe(5);
      expect(s['print_data.livePercent'].mean).toBe(27);
    });
  });
});
