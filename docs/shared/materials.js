'use strict';

/**
 * BioBots Shared Material & Wellplate Profiles
 *
 * Single source of truth for material properties and wellplate geometry.
 * Previously duplicated across calculator.js, mixer.js, and jobEstimator.js
 * with subtle inconsistencies. Centralizing here prevents drift and makes
 * updates (new materials, corrected values) apply everywhere at once.
 *
 * @module materials
 */

/**
 * Base material profiles shared across all modules.
 * Modules may extend individual entries with domain-specific fields
 * (e.g. mixer adds cellAdhesion, jobEstimator adds printSpeedFactor).
 *
 * @type {Object.<string, {name: string, density: number, costPerMl: number, viscosity: string}>}
 */
var MATERIAL_PROFILES = {
    'gelatin-methacrylate': { name: 'GelMA',          density: 1.05, costPerMl: 12.50, viscosity: 'medium' },
    'alginate':             { name: 'Alginate',        density: 1.02, costPerMl:  3.80, viscosity: 'low'    },
    'collagen-type-1':      { name: 'Collagen Type I', density: 1.08, costPerMl: 45.00, viscosity: 'high'   },
    'pluronic-f127':        { name: 'Pluronic F-127',  density: 1.06, costPerMl:  8.20, viscosity: 'medium' },
    'pcl':                  { name: 'PCL',             density: 1.14, costPerMl:  6.50, viscosity: 'high'   },
    'hyaluronic-acid':      { name: 'Hyaluronic Acid', density: 1.03, costPerMl: 28.00, viscosity: 'low'    },
    'fibrin':               { name: 'Fibrin',          density: 1.04, costPerMl: 35.00, viscosity: 'low'    },
    'silk-fibroin':         { name: 'Silk Fibroin',    density: 1.10, costPerMl: 22.00, viscosity: 'medium' },
    'pectin':               { name: 'Pectin',          density: 1.01, costPerMl:  2.50, viscosity: 'low'    },
    'custom':               { name: 'Custom',          density: 1.00, costPerMl:  0,    viscosity: 'medium' }
};

/**
 * Standard wellplate specifications.
 *
 * Uses `areaMm2` as the canonical field name. The legacy `area` alias
 * is preserved for backward compatibility with calculator.js consumers.
 *
 * @type {Object.<number, {wells: number, diameter: number, areaMm2: number, area: number}>}
 */
var WELLPLATE_SPECS = {
    6:  { wells: 6,  diameter: 34.8,  areaMm2: 951.1, area: 951.1 },
    12: { wells: 12, diameter: 22.1,  areaMm2: 383.5, area: 383.5 },
    24: { wells: 24, diameter: 15.6,  areaMm2: 191.1, area: 191.1 },
    48: { wells: 48, diameter: 11.05, areaMm2:  95.9, area:  95.9 },
    96: { wells: 96, diameter: 6.35,  areaMm2:  31.7, area:  31.7 }
};

/**
 * Cell line profiles for viability and cost estimation.
 *
 * @type {Object.<string, {name: string, viabilityBase: number, costPer1M: number, shearSensitivity: number}>}
 */
var CELL_PROFILES = {
    'HEK293':      { name: 'HEK293',                  viabilityBase: 0.92, costPer1M: 150, shearSensitivity: 0.8 },
    'CHO':         { name: 'CHO',                      viabilityBase: 0.90, costPer1M: 120, shearSensitivity: 0.7 },
    'MSC':         { name: 'Mesenchymal Stem Cell',     viabilityBase: 0.88, costPer1M: 500, shearSensitivity: 1.2 },
    'iPSC':        { name: 'iPSC',                     viabilityBase: 0.85, costPer1M: 800, shearSensitivity: 1.5 },
    'chondrocyte': { name: 'Chondrocyte',              viabilityBase: 0.89, costPer1M: 350, shearSensitivity: 1.0 },
    'hepatocyte':  { name: 'Hepatocyte',               viabilityBase: 0.82, costPer1M: 600, shearSensitivity: 1.3 },
    'fibroblast':  { name: 'Fibroblast',               viabilityBase: 0.93, costPer1M: 100, shearSensitivity: 0.6 },
    'keratinocyte':{ name: 'Keratinocyte',             viabilityBase: 0.87, costPer1M: 250, shearSensitivity: 0.9 }
};

/**
 * Look up a material profile by key, with optional fallback to 'custom'.
 *
 * @param {string} key - Material key (e.g. 'alginate').
 * @param {boolean} [fallbackToCustom=false] - Return 'custom' profile if key not found.
 * @returns {Object|null} Material profile or null if not found and no fallback.
 */
function getMaterial(key, fallbackToCustom) {
    return MATERIAL_PROFILES[key] || (fallbackToCustom ? MATERIAL_PROFILES['custom'] : null);
}

/**
 * List all available material keys.
 * @returns {string[]}
 */
function listMaterials() {
    return Object.keys(MATERIAL_PROFILES);
}

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        MATERIAL_PROFILES: MATERIAL_PROFILES,
        WELLPLATE_SPECS: WELLPLATE_SPECS,
        CELL_PROFILES: CELL_PROFILES,
        getMaterial: getMaterial,
        listMaterials: listMaterials
    };
}
