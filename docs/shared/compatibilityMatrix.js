'use strict';

/**
 * Bioink Compatibility Matrix
 *
 * Evaluates compatibility between bioinks, cell types, crosslinkers,
 * and printing methods. Returns scored recommendations to help
 * researchers pick the right material combinations.
 *
 * @example
 *   var compat = require('./compatibilityMatrix');
 *   var matrix = compat.createCompatibilityMatrix();
 *   var result = matrix.check({ bioink: 'alginate', cellType: 'chondrocyte' });
 *   // => { score: 92, grade: 'A', notes: [...], crosslinkers: [...], methods: [...] }
 */

// --- Knowledge base ---

var BIOINKS = {
  alginate: {
    name: 'Alginate',
    category: 'natural',
    viscosityRange: [50, 2000],   // mPa·s
    printTemp: [20, 37],
    biodegradable: true,
    cellTypes: {
      chondrocyte: 95, osteoblast: 80, fibroblast: 85, hepatocyte: 70,
      cardiomyocyte: 65, neuron: 60, msc: 88, endothelial: 75, keratinocyte: 72, ipsc: 78
    },
    crosslinkers: { cacl2: 98, bacl2: 85, srcl2: 80 },
    methods: { extrusion: 95, inkjet: 60, dlp: 20, laser: 30 }
  },
  gelatin_methacryloyl: {
    name: 'GelMA',
    category: 'semi-synthetic',
    viscosityRange: [30, 1500],
    printTemp: [15, 25],
    biodegradable: true,
    cellTypes: {
      chondrocyte: 90, osteoblast: 88, fibroblast: 92, hepatocyte: 85,
      cardiomyocyte: 80, neuron: 75, msc: 90, endothelial: 88, keratinocyte: 82, ipsc: 85
    },
    crosslinkers: { uv: 95, lap: 92, irgacure: 88, eosin_y: 80 },
    methods: { extrusion: 85, inkjet: 50, dlp: 90, laser: 70 }
  },
  collagen: {
    name: 'Collagen Type I',
    category: 'natural',
    viscosityRange: [10, 500],
    printTemp: [4, 25],
    biodegradable: true,
    cellTypes: {
      chondrocyte: 85, osteoblast: 82, fibroblast: 95, hepatocyte: 80,
      cardiomyocyte: 78, neuron: 70, msc: 85, endothelial: 90, keratinocyte: 88, ipsc: 82
    },
    crosslinkers: { thermal: 90, genipin: 85, edc_nhs: 80, glutaraldehyde: 70 },
    methods: { extrusion: 80, inkjet: 70, dlp: 25, laser: 40 }
  },
  hyaluronic_acid: {
    name: 'Hyaluronic Acid (HA)',
    category: 'natural',
    viscosityRange: [100, 5000],
    printTemp: [20, 37],
    biodegradable: true,
    cellTypes: {
      chondrocyte: 98, osteoblast: 70, fibroblast: 80, hepatocyte: 65,
      cardiomyocyte: 72, neuron: 85, msc: 90, endothelial: 78, keratinocyte: 75, ipsc: 80
    },
    crosslinkers: { uv: 88, thiol: 85, tyramine: 82, dvs: 78 },
    methods: { extrusion: 90, inkjet: 45, dlp: 75, laser: 50 }
  },
  silk_fibroin: {
    name: 'Silk Fibroin',
    category: 'natural',
    viscosityRange: [20, 3000],
    printTemp: [20, 37],
    biodegradable: true,
    cellTypes: {
      chondrocyte: 82, osteoblast: 90, fibroblast: 85, hepatocyte: 72,
      cardiomyocyte: 68, neuron: 78, msc: 88, endothelial: 76, keratinocyte: 80, ipsc: 75
    },
    crosslinkers: { enzymatic: 88, sonication: 82, methanol: 75, hrp: 85 },
    methods: { extrusion: 88, inkjet: 55, dlp: 65, laser: 45 }
  },
  peg: {
    name: 'PEG-based',
    category: 'synthetic',
    viscosityRange: [10, 1000],
    printTemp: [20, 37],
    biodegradable: false,
    cellTypes: {
      chondrocyte: 75, osteoblast: 78, fibroblast: 80, hepatocyte: 70,
      cardiomyocyte: 65, neuron: 72, msc: 82, endothelial: 74, keratinocyte: 68, ipsc: 76
    },
    crosslinkers: { uv: 95, michael_addition: 90, thiol_ene: 92, redox: 78 },
    methods: { extrusion: 70, inkjet: 65, dlp: 95, laser: 80 }
  },
  pluronic: {
    name: 'Pluronic F-127',
    category: 'synthetic',
    viscosityRange: [5, 500],
    printTemp: [4, 25],
    biodegradable: false,
    cellTypes: {
      chondrocyte: 55, osteoblast: 50, fibroblast: 60, hepatocyte: 45,
      cardiomyocyte: 40, neuron: 48, msc: 58, endothelial: 52, keratinocyte: 50, ipsc: 55
    },
    crosslinkers: { thermal: 95, none: 90 },
    methods: { extrusion: 92, inkjet: 40, dlp: 15, laser: 20 }
  },
  fibrin: {
    name: 'Fibrin',
    category: 'natural',
    viscosityRange: [5, 200],
    printTemp: [20, 37],
    biodegradable: true,
    cellTypes: {
      chondrocyte: 78, osteoblast: 75, fibroblast: 88, hepatocyte: 82,
      cardiomyocyte: 85, neuron: 80, msc: 85, endothelial: 92, keratinocyte: 80, ipsc: 82
    },
    crosslinkers: { thrombin: 98, factor_xiii: 85 },
    methods: { extrusion: 75, inkjet: 80, dlp: 20, laser: 30 }
  }
};

var CELL_DISPLAY = {
  chondrocyte: 'Chondrocyte', osteoblast: 'Osteoblast', fibroblast: 'Fibroblast',
  hepatocyte: 'Hepatocyte', cardiomyocyte: 'Cardiomyocyte', neuron: 'Neuron',
  msc: 'MSC (Mesenchymal Stem Cell)', endothelial: 'Endothelial', keratinocyte: 'Keratinocyte',
  ipsc: 'iPSC (Induced Pluripotent)'
};

var CROSSLINKER_DISPLAY = {
  cacl2: 'CaCl₂', bacl2: 'BaCl₂', srcl2: 'SrCl₂',
  uv: 'UV Light', lap: 'LAP Photoinitiator', irgacure: 'Irgacure 2959', eosin_y: 'Eosin Y',
  thermal: 'Thermal', genipin: 'Genipin', edc_nhs: 'EDC/NHS', glutaraldehyde: 'Glutaraldehyde',
  thiol: 'Thiol-ene', tyramine: 'Tyramine', dvs: 'DVS',
  enzymatic: 'Enzymatic (HRP)', sonication: 'Sonication', methanol: 'Methanol', hrp: 'HRP/H₂O₂',
  michael_addition: 'Michael Addition', thiol_ene: 'Thiol-ene Click', redox: 'Redox',
  thrombin: 'Thrombin', factor_xiii: 'Factor XIII', none: 'None (self-gelling)'
};

var METHOD_DISPLAY = {
  extrusion: 'Extrusion', inkjet: 'Inkjet', dlp: 'DLP/SLA', laser: 'Laser-assisted'
};

// --- Grading ---

function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function generateNotes(bioinkData, cellType, crosslinker, method) {
  var notes = [];
  var cellScore = cellType && bioinkData.cellTypes[cellType] || 0;
  var crossScore = crosslinker && bioinkData.crosslinkers[crosslinker] || 0;
  var methodScore = method && bioinkData.methods[method] || 0;

  if (cellScore >= 90) notes.push(CELL_DISPLAY[cellType] + ' cells thrive in ' + bioinkData.name);
  else if (cellScore >= 70) notes.push(CELL_DISPLAY[cellType] + ' cells show good viability in ' + bioinkData.name);
  else if (cellScore > 0 && cellScore < 60) notes.push('Low viability risk for ' + CELL_DISPLAY[cellType] + ' in ' + bioinkData.name + ' — consider alternatives');

  if (crossScore >= 90) notes.push((CROSSLINKER_DISPLAY[crosslinker] || crosslinker) + ' is an excellent crosslinker for ' + bioinkData.name);
  else if (crossScore > 0 && crossScore < 70) notes.push('Suboptimal crosslinker choice — check gel strength');

  if (methodScore >= 85) notes.push(bioinkData.name + ' prints very well with ' + (METHOD_DISPLAY[method] || method));
  else if (methodScore > 0 && methodScore < 50) notes.push('Printing difficulty expected with ' + (METHOD_DISPLAY[method] || method) + ' — may need parameter tuning');

  if (!bioinkData.biodegradable) notes.push(bioinkData.name + ' is non-biodegradable — ensure this fits tissue engineering goals');

  return notes;
}

// --- Public API ---

function createCompatibilityMatrix() {

  /**
   * Check compatibility for a specific combination.
   * @param {Object} opts
   * @param {string} opts.bioink - Bioink key
   * @param {string} [opts.cellType] - Cell type key
   * @param {string} [opts.crosslinker] - Crosslinker key
   * @param {string} [opts.method] - Printing method key
   * @returns {Object} { score, grade, breakdown, notes, recommendations }
   */
  function check(opts) {
    if (!opts || !opts.bioink) throw new Error('bioink is required');
    var bioinkKey = opts.bioink.toLowerCase().replace(/[\s-]/g, '_');
    var bioinkData = BIOINKS[bioinkKey];
    if (!bioinkData) throw new Error('Unknown bioink: ' + opts.bioink + '. Available: ' + Object.keys(BIOINKS).join(', '));

    var parts = [];
    var breakdown = {};

    if (opts.cellType) {
      var ct = opts.cellType.toLowerCase().replace(/[\s-]/g, '_');
      var cs = bioinkData.cellTypes[ct];
      if (cs === undefined) throw new Error('Unknown cell type: ' + opts.cellType + '. Available: ' + Object.keys(bioinkData.cellTypes).join(', '));
      parts.push(cs);
      breakdown.cellType = { key: ct, name: CELL_DISPLAY[ct], score: cs, grade: scoreToGrade(cs) };
    }
    if (opts.crosslinker) {
      var cl = opts.crosslinker.toLowerCase().replace(/[\s-]/g, '_');
      var cls = bioinkData.crosslinkers[cl];
      if (cls === undefined) throw new Error('Unknown crosslinker: ' + opts.crosslinker + '. Available: ' + Object.keys(bioinkData.crosslinkers).join(', '));
      parts.push(cls);
      breakdown.crosslinker = { key: cl, name: CROSSLINKER_DISPLAY[cl] || cl, score: cls, grade: scoreToGrade(cls) };
    }
    if (opts.method) {
      var m = opts.method.toLowerCase().replace(/[\s-]/g, '_');
      var ms = bioinkData.methods[m];
      if (ms === undefined) throw new Error('Unknown method: ' + opts.method + '. Available: ' + Object.keys(bioinkData.methods).join(', '));
      parts.push(ms);
      breakdown.method = { key: m, name: METHOD_DISPLAY[m] || m, score: ms, grade: scoreToGrade(ms) };
    }

    var score = parts.length > 0
      ? Math.round(parts.reduce(function(a, b) { return a + b; }, 0) / parts.length)
      : 0;

    var notes = generateNotes(bioinkData, opts.cellType && opts.cellType.toLowerCase().replace(/[\s-]/g, '_'),
      opts.crosslinker && opts.crosslinker.toLowerCase().replace(/[\s-]/g, '_'),
      opts.method && opts.method.toLowerCase().replace(/[\s-]/g, '_'));

    // Recommend best crosslinkers and methods for this bioink
    var recommendations = {};
    var sortedCrosslinkers = Object.keys(bioinkData.crosslinkers).sort(function(a, b) {
      return bioinkData.crosslinkers[b] - bioinkData.crosslinkers[a];
    });
    recommendations.topCrosslinkers = sortedCrosslinkers.slice(0, 3).map(function(k) {
      return { key: k, name: CROSSLINKER_DISPLAY[k] || k, score: bioinkData.crosslinkers[k] };
    });
    var sortedMethods = Object.keys(bioinkData.methods).sort(function(a, b) {
      return bioinkData.methods[b] - bioinkData.methods[a];
    });
    recommendations.topMethods = sortedMethods.slice(0, 2).map(function(k) {
      return { key: k, name: METHOD_DISPLAY[k] || k, score: bioinkData.methods[k] };
    });

    return {
      bioink: bioinkData.name,
      score: score,
      grade: scoreToGrade(score),
      breakdown: breakdown,
      notes: notes,
      recommendations: recommendations
    };
  }

  /**
   * Find the best bioinks for a given cell type.
   * @param {string} cellType
   * @param {number} [topN=5]
   * @returns {Array} Ranked bioink recommendations
   */
  function bestFor(cellType, topN) {
    if (!cellType) throw new Error('cellType is required');
    var ct = cellType.toLowerCase().replace(/[\s-]/g, '_');
    topN = topN || 5;

    var results = [];
    Object.keys(BIOINKS).forEach(function(key) {
      var b = BIOINKS[key];
      var score = b.cellTypes[ct];
      if (score !== undefined) {
        results.push({ bioink: key, name: b.name, category: b.category, score: score, grade: scoreToGrade(score) });
      }
    });

    results.sort(function(a, b) { return b.score - a.score; });
    return results.slice(0, topN);
  }

  /**
   * Compare two bioink+config combos side-by-side.
   * @param {Object} comboA
   * @param {Object} comboB
   * @returns {Object} { a, b, winner, scoreDiff }
   */
  function compare(comboA, comboB) {
    var a = check(comboA);
    var b = check(comboB);
    return {
      a: a,
      b: b,
      winner: a.score >= b.score ? 'A' : 'B',
      scoreDiff: Math.abs(a.score - b.score)
    };
  }

  /**
   * List all available bioinks with metadata.
   * @returns {Array}
   */
  function listBioinks() {
    return Object.keys(BIOINKS).map(function(key) {
      var b = BIOINKS[key];
      return {
        key: key,
        name: b.name,
        category: b.category,
        biodegradable: b.biodegradable,
        viscosityRange: b.viscosityRange,
        printTemp: b.printTemp,
        supportedCellTypes: Object.keys(b.cellTypes).length,
        supportedCrosslinkers: Object.keys(b.crosslinkers).length,
        supportedMethods: Object.keys(b.methods).length
      };
    });
  }

  /**
   * List available cell types, crosslinkers, and methods.
   * @returns {Object}
   */
  function listOptions() {
    return {
      cellTypes: Object.keys(CELL_DISPLAY).map(function(k) { return { key: k, name: CELL_DISPLAY[k] }; }),
      crosslinkers: Object.keys(CROSSLINKER_DISPLAY).map(function(k) { return { key: k, name: CROSSLINKER_DISPLAY[k] }; }),
      methods: Object.keys(METHOD_DISPLAY).map(function(k) { return { key: k, name: METHOD_DISPLAY[k] }; })
    };
  }

  /**
   * Full compatibility heatmap: all bioinks × all cell types.
   * @returns {Object} { bioinks: [...], cellTypes: [...], matrix: [[score, ...], ...] }
   */
  function heatmap() {
    var bioinkKeys = Object.keys(BIOINKS);
    var cellKeys = Object.keys(CELL_DISPLAY);
    var mat = bioinkKeys.map(function(bk) {
      return cellKeys.map(function(ck) {
        return BIOINKS[bk].cellTypes[ck] || 0;
      });
    });
    return {
      bioinks: bioinkKeys.map(function(k) { return BIOINKS[k].name; }),
      cellTypes: cellKeys.map(function(k) { return CELL_DISPLAY[k]; }),
      matrix: mat
    };
  }

  return {
    check: check,
    bestFor: bestFor,
    compare: compare,
    listBioinks: listBioinks,
    listOptions: listOptions,
    heatmap: heatmap
  };
}

module.exports = {
  createCompatibilityMatrix: createCompatibilityMatrix
};
