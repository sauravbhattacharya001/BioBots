'use strict';

/**
 * Protocol Template Library for BioBots
 * 
 * Provides predefined bioprinting protocols that users can browse, customize,
 * clone, and validate. Each protocol defines material settings, print parameters,
 * and post-processing steps optimized for specific tissue types.
 */

// ── Prototype Pollution Guard ───────────────────────────────────────────────

const _DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Return a shallow copy of `obj` with prototype-polluting keys removed.
 * @param {Object} obj
 * @returns {Object}
 */
function _sanitize(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const k of Object.keys(obj)) {
        if (!_DANGEROUS_KEYS.has(k)) out[k] = obj[k];
    }
    return out;
}

// ── Built-in Protocol Templates ─────────────────────────────────────────────

const PROTOCOL_TEMPLATES = [
  {
    id: 'skin-scaffold',
    name: 'Skin Tissue Scaffold',
    category: 'tissue-engineering',
    difficulty: 'intermediate',
    description: 'Layered scaffold for skin tissue engineering using collagen-based bioink.',
    materials: ['collagen-type-i', 'gelatin-methacrylate'],
    parameters: {
      nozzleDiameter: 0.4,
      printSpeed: 8,
      pressure: 25,
      temperature: 37,
      layerHeight: 0.2,
      infillDensity: 60,
      crosslinkTime: 120,
      uvExposure: 30
    },
    postProcessing: ['uv-crosslink', 'incubation-37c', 'media-change-24h'],
    estimatedTime: 45,
    tags: ['skin', 'collagen', 'scaffold', 'regenerative'],
    citations: ['doi:10.1088/1758-5090/ab2aa1']
  },
  {
    id: 'cartilage-construct',
    name: 'Cartilage Construct',
    category: 'tissue-engineering',
    difficulty: 'advanced',
    description: 'High-density chondrocyte-laden hydrogel for cartilage repair.',
    materials: ['alginate', 'hyaluronic-acid', 'chondrocytes'],
    parameters: {
      nozzleDiameter: 0.6,
      printSpeed: 5,
      pressure: 35,
      temperature: 25,
      layerHeight: 0.3,
      infillDensity: 80,
      crosslinkTime: 180,
      uvExposure: 0
    },
    postProcessing: ['cacl2-crosslink', 'incubation-37c', 'mechanical-stimulation'],
    estimatedTime: 90,
    tags: ['cartilage', 'alginate', 'hydrogel', 'chondrocyte'],
    citations: ['doi:10.1016/j.biomaterials.2019.04.026']
  },
  {
    id: 'vascular-network',
    name: 'Vascular Network',
    category: 'organ-printing',
    difficulty: 'expert',
    description: 'Sacrificial ink-based vascular channel network for perfusable constructs.',
    materials: ['pluronic-f127', 'gelatin-methacrylate', 'endothelial-cells'],
    parameters: {
      nozzleDiameter: 0.25,
      printSpeed: 12,
      pressure: 40,
      temperature: 4,
      layerHeight: 0.15,
      infillDensity: 100,
      crosslinkTime: 300,
      uvExposure: 60
    },
    postProcessing: ['uv-crosslink', 'sacrificial-removal-4c', 'endothelial-seeding', 'perfusion-culture'],
    estimatedTime: 180,
    tags: ['vascular', 'perfusion', 'sacrificial', 'endothelial'],
    citations: ['doi:10.1038/s41563-019-0455-2']
  },
  {
    id: 'bone-scaffold',
    name: 'Bone Tissue Scaffold',
    category: 'tissue-engineering',
    difficulty: 'intermediate',
    description: 'Composite scaffold with hydroxyapatite for bone regeneration.',
    materials: ['polycaprolactone', 'hydroxyapatite', 'bmp-2'],
    parameters: {
      nozzleDiameter: 0.8,
      printSpeed: 3,
      pressure: 50,
      temperature: 80,
      layerHeight: 0.4,
      infillDensity: 40,
      crosslinkTime: 0,
      uvExposure: 0
    },
    postProcessing: ['cooling', 'bmp2-coating', 'sterilization'],
    estimatedTime: 60,
    tags: ['bone', 'PCL', 'hydroxyapatite', 'osteogenic'],
    citations: ['doi:10.1002/adfm.201904845']
  },
  {
    id: 'drug-delivery-patch',
    name: 'Drug Delivery Patch',
    category: 'pharmaceutical',
    difficulty: 'beginner',
    description: 'Controlled-release drug delivery patch with customizable dosage zones.',
    materials: ['pva', 'drug-compound'],
    parameters: {
      nozzleDiameter: 0.5,
      printSpeed: 10,
      pressure: 15,
      temperature: 22,
      layerHeight: 0.25,
      infillDensity: 50,
      crosslinkTime: 60,
      uvExposure: 0
    },
    postProcessing: ['drying-rt', 'packaging'],
    estimatedTime: 20,
    tags: ['drug-delivery', 'PVA', 'controlled-release', 'pharmaceutical'],
    citations: []
  },
  {
    id: 'liver-organoid',
    name: 'Liver Organoid Array',
    category: 'organ-printing',
    difficulty: 'expert',
    description: 'Multi-well hepatocyte organoid array for drug screening applications.',
    materials: ['decellularized-ecm', 'hepatocytes', 'stellate-cells'],
    parameters: {
      nozzleDiameter: 0.3,
      printSpeed: 6,
      pressure: 20,
      temperature: 37,
      layerHeight: 0.1,
      infillDensity: 90,
      crosslinkTime: 240,
      uvExposure: 15
    },
    postProcessing: ['thermal-crosslink', 'incubation-37c', 'media-change-12h', 'functional-assay'],
    estimatedTime: 120,
    tags: ['liver', 'organoid', 'drug-screening', 'hepatocyte'],
    citations: ['doi:10.1002/advs.201900344']
  },
  {
    id: 'bioink-calibration',
    name: 'Bioink Calibration Grid',
    category: 'calibration',
    difficulty: 'beginner',
    description: 'Standard calibration grid for testing new bioink formulations and print settings.',
    materials: ['test-bioink'],
    parameters: {
      nozzleDiameter: 0.4,
      printSpeed: 10,
      pressure: 20,
      temperature: 25,
      layerHeight: 0.2,
      infillDensity: 50,
      crosslinkTime: 60,
      uvExposure: 0
    },
    postProcessing: ['visual-inspection', 'dimensional-measurement'],
    estimatedTime: 10,
    tags: ['calibration', 'testing', 'bioink', 'quality-control'],
    citations: []
  },
  {
    id: 'neural-scaffold',
    name: 'Neural Tissue Scaffold',
    category: 'tissue-engineering',
    difficulty: 'expert',
    description: 'Aligned fiber scaffold for neural tissue regeneration with growth factor gradients.',
    materials: ['silk-fibroin', 'laminin', 'ngf'],
    parameters: {
      nozzleDiameter: 0.2,
      printSpeed: 15,
      pressure: 30,
      temperature: 25,
      layerHeight: 0.1,
      infillDensity: 70,
      crosslinkTime: 360,
      uvExposure: 45
    },
    postProcessing: ['methanol-treatment', 'ngf-gradient', 'incubation-37c', 'electrical-stimulation'],
    estimatedTime: 150,
    tags: ['neural', 'silk', 'nerve-regeneration', 'growth-factor'],
    citations: ['doi:10.1016/j.actbio.2020.01.003']
  }
];

// ── Parameter Validation Rules ──────────────────────────────────────────────

const PARAMETER_RULES = {
  nozzleDiameter: { min: 0.1, max: 2.0, unit: 'mm', label: 'Nozzle Diameter' },
  printSpeed:     { min: 1,   max: 50,  unit: 'mm/s', label: 'Print Speed' },
  pressure:       { min: 1,   max: 100, unit: 'kPa', label: 'Extrusion Pressure' },
  temperature:    { min: 0,   max: 200, unit: '°C', label: 'Temperature' },
  layerHeight:    { min: 0.05, max: 1.0, unit: 'mm', label: 'Layer Height' },
  infillDensity:  { min: 0,   max: 100, unit: '%', label: 'Infill Density' },
  crosslinkTime:  { min: 0,   max: 600, unit: 's', label: 'Crosslink Time' },
  uvExposure:     { min: 0,   max: 300, unit: 's', label: 'UV Exposure' }
};

const CATEGORIES = {
  'tissue-engineering': 'Tissue Engineering',
  'organ-printing': 'Organ Printing',
  'pharmaceutical': 'Pharmaceutical',
  'calibration': 'Calibration'
};

const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'];

// ── Protocol Library Class ──────────────────────────────────────────────────

class ProtocolLibrary {
  constructor(templates) {
    this._builtIn = (templates || PROTOCOL_TEMPLATES).map(t => Object.freeze({ ...t }));
    this._custom = [];
  }

  /** Get all protocols (built-in + custom). */
  getAll() {
    return [...this._builtIn, ...this._custom];
  }

  /** Get a protocol by ID. */
  getById(id) {
    if (!id || typeof id !== 'string') return null;
    return this.getAll().find(p => p.id === id) || null;
  }

  /** Filter protocols by criteria. */
  filter({ category, difficulty, material, tag, search } = {}) {
    let results = this.getAll();
    if (category) {
      results = results.filter(p => p.category === category);
    }
    if (difficulty) {
      results = results.filter(p => p.difficulty === difficulty);
    }
    if (material) {
      const m = material.toLowerCase();
      results = results.filter(p => p.materials.some(mat => mat.toLowerCase().includes(m)));
    }
    if (tag) {
      const t = tag.toLowerCase();
      results = results.filter(p => p.tags.some(tg => tg.toLowerCase().includes(t)));
    }
    if (search) {
      const s = search.toLowerCase();
      results = results.filter(p =>
        p.name.toLowerCase().includes(s) ||
        p.description.toLowerCase().includes(s) ||
        p.tags.some(tg => tg.toLowerCase().includes(s))
      );
    }
    return results;
  }

  /** Get all available categories with counts. */
  getCategories() {
    const counts = {};
    for (const p of this.getAll()) {
      counts[p.category] = (counts[p.category] || 0) + 1;
    }
    return Object.entries(counts).map(([id, count]) => ({
      id,
      label: CATEGORIES[id] || id,
      count
    }));
  }

  /** Get all unique materials across all protocols. */
  getMaterials() {
    const set = new Set();
    for (const p of this.getAll()) {
      p.materials.forEach(m => set.add(m));
    }
    return [...set].sort();
  }

  /** Get all unique tags across all protocols. */
  getTags() {
    const set = new Set();
    for (const p of this.getAll()) {
      p.tags.forEach(t => set.add(t));
    }
    return [...set].sort();
  }

  /**
   * Clone a protocol with overrides, creating a custom version.
   * Returns the new protocol.
   */
  clone(sourceId, overrides = {}) {
    const source = this.getById(sourceId);
    if (!source) throw new Error(`Protocol not found: ${sourceId}`);

    const newId = overrides.id || `${source.id}-custom-${Date.now()}`;

    const safeOverrides = _sanitize(overrides);
    const safeParams = _sanitize(overrides.parameters || {});

    const cloned = {
      ...JSON.parse(JSON.stringify(source)),
      ...safeOverrides,
      id: newId,
      parameters: { ...source.parameters, ...safeParams },
      _clonedFrom: source.id,
      _createdAt: new Date().toISOString()
    };

    return this._addCustomProtocol(cloned);
  }

  /** Remove a custom protocol. Built-in protocols cannot be removed. */
  remove(id) {
    const idx = this._custom.findIndex(p => p.id === id);
    if (idx === -1) {
      if (this._builtIn.find(p => p.id === id)) {
        throw new Error('Cannot remove built-in protocol');
      }
      throw new Error(`Protocol not found: ${id}`);
    }
    return this._custom.splice(idx, 1)[0];
  }

  /**
   * Internal: validate and register a custom protocol.
   * Shared by clone() and importJSON() to avoid duplicated
   * ID-uniqueness checking, parameter validation, and array insertion.
   * @param {Object} data - Full protocol object with id, name, parameters.
   * @returns {Object} The added protocol.
   */
  _addCustomProtocol(data) {
    if (!data.id || !data.name || !data.parameters) {
      throw new Error('Missing required fields: id, name, parameters');
    }
    if (this.getById(data.id)) {
      throw new Error(`Protocol ID already exists: ${data.id}`);
    }
    const validation = validateParameters(data.parameters);
    if (!validation.valid) {
      throw new Error(`Invalid parameters: ${validation.errors.map(e => e.message).join('; ')}`);
    }
    this._custom.push(data);
    return data;
  }

  /** Compare two protocols side-by-side. */
  compare(idA, idB) {
    const a = this.getById(idA);
    const b = this.getById(idB);
    if (!a) throw new Error(`Protocol not found: ${idA}`);
    if (!b) throw new Error(`Protocol not found: ${idB}`);

    const diffs = [];
    const allKeys = new Set([...Object.keys(a.parameters), ...Object.keys(b.parameters)]);
    for (const key of allKeys) {
      const valA = a.parameters[key];
      const valB = b.parameters[key];
      if (valA !== valB) {
        const rule = PARAMETER_RULES[key];
        diffs.push({
          parameter: key,
          label: rule ? rule.label : key,
          unit: rule ? rule.unit : '',
          valueA: valA !== undefined ? valA : null,
          valueB: valB !== undefined ? valB : null,
          delta: (valA != null && valB != null) ? valB - valA : null
        });
      }
    }

    const sharedMaterials = a.materials.filter(m => b.materials.includes(m));
    const uniqueA = a.materials.filter(m => !b.materials.includes(m));
    const uniqueB = b.materials.filter(m => !a.materials.includes(m));

    return {
      protocolA: { id: a.id, name: a.name },
      protocolB: { id: b.id, name: b.name },
      parameterDiffs: diffs,
      materials: { shared: sharedMaterials, onlyA: uniqueA, onlyB: uniqueB },
      timeDiff: b.estimatedTime - a.estimatedTime,
      difficultyDiff: DIFFICULTY_LEVELS.indexOf(b.difficulty) - DIFFICULTY_LEVELS.indexOf(a.difficulty)
    };
  }

  /** Get protocol recommendations based on desired outcome. */
  recommend({ tissueType, experience, maxTime }) {
    let candidates = this.getAll();
    if (tissueType) {
      const t = tissueType.toLowerCase();
      candidates = candidates.filter(p =>
        p.tags.some(tg => tg.toLowerCase().includes(t)) ||
        p.name.toLowerCase().includes(t) ||
        p.description.toLowerCase().includes(t)
      );
    }
    if (experience) {
      const maxLevel = DIFFICULTY_LEVELS.indexOf(experience);
      if (maxLevel >= 0) {
        candidates = candidates.filter(p => DIFFICULTY_LEVELS.indexOf(p.difficulty) <= maxLevel);
      }
    }
    if (maxTime && typeof maxTime === 'number') {
      candidates = candidates.filter(p => p.estimatedTime <= maxTime);
    }
    // Sort by difficulty (easiest first), then by time
    candidates.sort((a, b) => {
      const dd = DIFFICULTY_LEVELS.indexOf(a.difficulty) - DIFFICULTY_LEVELS.indexOf(b.difficulty);
      return dd !== 0 ? dd : a.estimatedTime - b.estimatedTime;
    });
    return candidates;
  }

  /** Export protocol to JSON string. */
  exportJSON(id) {
    const p = this.getById(id);
    if (!p) throw new Error(`Protocol not found: ${id}`);
    return JSON.stringify(p, null, 2);
  }

  /** Import protocol from JSON. */
  importJSON(jsonStr) {
    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('Invalid JSON');
    }
    // Sanitize against prototype pollution before merging
    data = _sanitize(data);
    if (data.parameters) data.parameters = _sanitize(data.parameters);
    // Ensure required fields with defaults
    data.materials = data.materials || [];
    data.postProcessing = data.postProcessing || [];
    data.tags = data.tags || [];
    data.category = data.category || 'calibration';
    data.difficulty = data.difficulty || 'beginner';
    data.estimatedTime = data.estimatedTime || 0;
    data.citations = data.citations || [];
    data._importedAt = new Date().toISOString();
    return this._addCustomProtocol(data);
  }
}

// ── Parameter Validation ────────────────────────────────────────────────────

/**
 * Validate print parameters against defined rules.
 * @param {Object} params - Parameter key-value pairs to validate.
 * @returns {{ valid: boolean, errors: Array<{parameter: string, message: string}>, warnings: Array<{parameter: string, message: string}> }}
 */
function validateParameters(params) {
  const errors = [];
  const warnings = [];

  if (!params || typeof params !== 'object') {
    return { valid: false, errors: [{ parameter: '*', message: 'Parameters must be an object' }], warnings: [] };
  }

  for (const [key, rule] of Object.entries(PARAMETER_RULES)) {
    const val = params[key];
    if (val === undefined || val === null) continue;
    if (typeof val !== 'number' || isNaN(val)) {
      errors.push({ parameter: key, message: `${rule.label} must be a number` });
      continue;
    }
    if (val < rule.min) {
      errors.push({ parameter: key, message: `${rule.label} (${val}${rule.unit}) below minimum ${rule.min}${rule.unit}` });
    } else if (val > rule.max) {
      errors.push({ parameter: key, message: `${rule.label} (${val}${rule.unit}) exceeds maximum ${rule.max}${rule.unit}` });
    }
  }

  // Warn about suspicious combos
  if (params.layerHeight && params.nozzleDiameter && params.layerHeight > params.nozzleDiameter) {
    warnings.push({ parameter: 'layerHeight', message: 'Layer height exceeds nozzle diameter — may cause print quality issues' });
  }
  if (params.temperature > 100 && params.uvExposure > 0) {
    warnings.push({ parameter: 'temperature', message: 'High temperature with UV exposure may degrade photosensitive materials' });
  }
  if (params.pressure > 60 && params.printSpeed > 15) {
    warnings.push({ parameter: 'pressure', message: 'High pressure with high speed may cause over-extrusion' });
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Estimate material volume for a protocol given print dimensions.
 * @param {Object} params - Print parameters.
 * @param {{ width: number, depth: number, layers: number }} dimensions - Print area.
 * @returns {{ volume: number, unit: string, layers: number }}
 */
function estimateVolume(params, dimensions) {
  if (!params || !dimensions) throw new Error('Parameters and dimensions are required');
  const { width, depth, layers } = dimensions;
  if (!width || !depth || !layers || width <= 0 || depth <= 0 || layers <= 0) {
    throw new Error('Dimensions must have positive width, depth, and layers');
  }
  const infill = (params.infillDensity || 50) / 100;
  const layerH = params.layerHeight || 0.2;
  const volume = width * depth * layerH * layers * infill;
  return {
    volume: Math.round(volume * 1000) / 1000,
    unit: 'mm³',
    layers
  };
}

// ── Exports ─────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PROTOCOL_TEMPLATES,
    PARAMETER_RULES,
    CATEGORIES,
    DIFFICULTY_LEVELS,
    ProtocolLibrary,
    validateParameters,
    estimateVolume
  };
}
