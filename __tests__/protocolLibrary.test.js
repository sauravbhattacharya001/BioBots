'use strict';

const {
  PROTOCOL_TEMPLATES,
  PARAMETER_RULES,
  CATEGORIES,
  DIFFICULTY_LEVELS,
  ProtocolLibrary,
  validateParameters,
  estimateVolume
} = require('../Try/scripts/protocolLibrary');

describe('ProtocolLibrary', () => {
  let lib;
  beforeEach(() => { lib = new ProtocolLibrary(); });

  describe('getAll / getById', () => {
    test('returns all built-in templates', () => {
      expect(lib.getAll().length).toBe(PROTOCOL_TEMPLATES.length);
    });

    test('finds protocol by ID', () => {
      const p = lib.getById('skin-scaffold');
      expect(p).not.toBeNull();
      expect(p.name).toBe('Skin Tissue Scaffold');
    });

    test('returns null for unknown ID', () => {
      expect(lib.getById('nonexistent')).toBeNull();
    });

    test('returns null for invalid input', () => {
      expect(lib.getById(null)).toBeNull();
      expect(lib.getById(42)).toBeNull();
    });
  });

  describe('filter', () => {
    test('filters by category', () => {
      const results = lib.filter({ category: 'tissue-engineering' });
      expect(results.length).toBeGreaterThan(0);
      results.forEach(p => expect(p.category).toBe('tissue-engineering'));
    });

    test('filters by difficulty', () => {
      const results = lib.filter({ difficulty: 'beginner' });
      results.forEach(p => expect(p.difficulty).toBe('beginner'));
    });

    test('filters by material', () => {
      const results = lib.filter({ material: 'alginate' });
      expect(results.length).toBeGreaterThan(0);
      results.forEach(p => expect(p.materials.some(m => m.includes('alginate'))).toBe(true));
    });

    test('filters by tag', () => {
      const results = lib.filter({ tag: 'scaffold' });
      expect(results.length).toBeGreaterThan(0);
    });

    test('filters by search term', () => {
      const results = lib.filter({ search: 'vascular' });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('vascular-network');
    });

    test('combines multiple filters', () => {
      const results = lib.filter({ category: 'tissue-engineering', difficulty: 'intermediate' });
      results.forEach(p => {
        expect(p.category).toBe('tissue-engineering');
        expect(p.difficulty).toBe('intermediate');
      });
    });

    test('returns empty for no matches', () => {
      expect(lib.filter({ category: 'nonexistent' })).toEqual([]);
    });
  });

  describe('getCategories / getMaterials / getTags', () => {
    test('returns categories with counts', () => {
      const cats = lib.getCategories();
      expect(cats.length).toBeGreaterThan(0);
      cats.forEach(c => {
        expect(c).toHaveProperty('id');
        expect(c).toHaveProperty('label');
        expect(c.count).toBeGreaterThan(0);
      });
    });

    test('returns sorted unique materials', () => {
      const mats = lib.getMaterials();
      expect(mats.length).toBeGreaterThan(0);
      for (let i = 1; i < mats.length; i++) {
        expect(mats[i] >= mats[i - 1]).toBe(true);
      }
    });

    test('returns sorted unique tags', () => {
      const tags = lib.getTags();
      expect(tags.length).toBeGreaterThan(0);
    });
  });

  describe('clone', () => {
    test('clones a protocol with overrides', () => {
      const cloned = lib.clone('bioink-calibration', {
        id: 'my-calibration',
        name: 'My Calibration',
        parameters: { pressure: 30 }
      });
      expect(cloned.id).toBe('my-calibration');
      expect(cloned.name).toBe('My Calibration');
      expect(cloned.parameters.pressure).toBe(30);
      expect(cloned._clonedFrom).toBe('bioink-calibration');
      expect(lib.getById('my-calibration')).not.toBeNull();
    });

    test('throws on unknown source', () => {
      expect(() => lib.clone('nope')).toThrow('Protocol not found');
    });

    test('throws on duplicate ID', () => {
      lib.clone('bioink-calibration', { id: 'dup' });
      expect(() => lib.clone('bioink-calibration', { id: 'dup' })).toThrow('already exists');
    });

    test('throws on invalid parameters', () => {
      expect(() => lib.clone('bioink-calibration', {
        id: 'bad',
        parameters: { pressure: 999 }
      })).toThrow('Invalid parameters');
    });
  });

  describe('remove', () => {
    test('removes custom protocol', () => {
      lib.clone('bioink-calibration', { id: 'removable' });
      const removed = lib.remove('removable');
      expect(removed.id).toBe('removable');
      expect(lib.getById('removable')).toBeNull();
    });

    test('throws when removing built-in', () => {
      expect(() => lib.remove('skin-scaffold')).toThrow('Cannot remove built-in');
    });

    test('throws for unknown ID', () => {
      expect(() => lib.remove('nope')).toThrow('Protocol not found');
    });
  });

  describe('compare', () => {
    test('compares two protocols', () => {
      const result = lib.compare('skin-scaffold', 'bone-scaffold');
      expect(result.protocolA.id).toBe('skin-scaffold');
      expect(result.protocolB.id).toBe('bone-scaffold');
      expect(result.parameterDiffs.length).toBeGreaterThan(0);
      expect(result).toHaveProperty('timeDiff');
      expect(result).toHaveProperty('difficultyDiff');
      expect(result.materials).toHaveProperty('shared');
      expect(result.materials).toHaveProperty('onlyA');
      expect(result.materials).toHaveProperty('onlyB');
    });

    test('throws for unknown protocol', () => {
      expect(() => lib.compare('nope', 'skin-scaffold')).toThrow();
      expect(() => lib.compare('skin-scaffold', 'nope')).toThrow();
    });
  });

  describe('recommend', () => {
    test('recommends by tissue type', () => {
      const results = lib.recommend({ tissueType: 'bone' });
      expect(results.length).toBeGreaterThan(0);
    });

    test('filters by experience level', () => {
      const results = lib.recommend({ experience: 'beginner' });
      results.forEach(p => expect(DIFFICULTY_LEVELS.indexOf(p.difficulty)).toBeLessThanOrEqual(0));
    });

    test('filters by max time', () => {
      const results = lib.recommend({ maxTime: 30 });
      results.forEach(p => expect(p.estimatedTime).toBeLessThanOrEqual(30));
    });

    test('returns sorted by difficulty then time', () => {
      const results = lib.recommend({});
      for (let i = 1; i < results.length; i++) {
        const da = DIFFICULTY_LEVELS.indexOf(results[i - 1].difficulty);
        const db = DIFFICULTY_LEVELS.indexOf(results[i].difficulty);
        if (da === db) {
          expect(results[i].estimatedTime).toBeGreaterThanOrEqual(results[i - 1].estimatedTime);
        } else {
          expect(db).toBeGreaterThanOrEqual(da);
        }
      }
    });
  });

  describe('export / import JSON', () => {
    test('exports protocol to JSON', () => {
      const json = lib.exportJSON('skin-scaffold');
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe('skin-scaffold');
    });

    test('throws export for unknown', () => {
      expect(() => lib.exportJSON('nope')).toThrow();
    });

    test('imports valid protocol', () => {
      const data = {
        id: 'imported-test',
        name: 'Imported Protocol',
        parameters: { pressure: 20, temperature: 25 }
      };
      const imported = lib.importJSON(JSON.stringify(data));
      expect(imported.id).toBe('imported-test');
      expect(lib.getById('imported-test')).not.toBeNull();
    });

    test('throws on invalid JSON', () => {
      expect(() => lib.importJSON('not json')).toThrow('Invalid JSON');
    });

    test('throws on missing fields', () => {
      expect(() => lib.importJSON('{}')).toThrow('Missing required fields');
    });

    test('throws on duplicate ID import', () => {
      expect(() => lib.importJSON(JSON.stringify({
        id: 'skin-scaffold', name: 'Dup', parameters: {}
      }))).toThrow('already exists');
    });
  });
});

describe('validateParameters', () => {
  test('valid parameters pass', () => {
    const result = validateParameters({ pressure: 25, temperature: 37 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('out-of-range values produce errors', () => {
    const result = validateParameters({ pressure: 999 });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('non-numeric values produce errors', () => {
    const result = validateParameters({ pressure: 'high' });
    expect(result.valid).toBe(false);
  });

  test('null params produce error', () => {
    const result = validateParameters(null);
    expect(result.valid).toBe(false);
  });

  test('warns on layer height exceeding nozzle diameter', () => {
    const result = validateParameters({ layerHeight: 0.5, nozzleDiameter: 0.3 });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('warns on high temp + UV', () => {
    const result = validateParameters({ temperature: 120, uvExposure: 10 });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('warns on high pressure + speed', () => {
    const result = validateParameters({ pressure: 70, printSpeed: 20 });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('skips undefined values', () => {
    const result = validateParameters({ pressure: undefined });
    expect(result.valid).toBe(true);
  });
});

describe('estimateVolume', () => {
  test('calculates volume correctly', () => {
    const result = estimateVolume(
      { infillDensity: 100, layerHeight: 0.2 },
      { width: 10, depth: 10, layers: 5 }
    );
    expect(result.volume).toBe(100);
    expect(result.unit).toBe('mm³');
  });

  test('accounts for infill density', () => {
    const result = estimateVolume(
      { infillDensity: 50, layerHeight: 0.2 },
      { width: 10, depth: 10, layers: 5 }
    );
    expect(result.volume).toBe(50);
  });

  test('throws on missing params', () => {
    expect(() => estimateVolume(null, { width: 1, depth: 1, layers: 1 })).toThrow();
    expect(() => estimateVolume({}, null)).toThrow();
  });

  test('throws on zero dimensions', () => {
    expect(() => estimateVolume({}, { width: 0, depth: 10, layers: 5 })).toThrow();
  });
});
