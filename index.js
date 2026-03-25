'use strict';

/**
 * BioBots SDK — Bioprinting computation toolkit.
 *
 * Exports factory functions for the core computational modules.
 * Modules are lazy-loaded on first access to minimize startup cost
 * when consumers only use a subset of the 37+ available factories.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var calc = biobots.createMaterialCalculator();
 *   var result = calc.calculate({ material: 'alginate', volume: 5 });
 */

// ── Module manifest ────────────────────────────────────────────────
// Each entry: [exportName, modulePath, factoryFunctionName]
// To add a new module, just add a line here.

var manifest = [
    ['createMaterialCalculator',        './docs/shared/calculator',            'createMaterialCalculator'],
    ['createCrosslinkAnalyzer',         './docs/shared/crosslink',             'createCrosslinkAnalyzer'],
    ['createGCodeAnalyzer',             './docs/shared/gcode',                 'createGCodeAnalyzer'],
    ['createRheologyModeler',           './docs/shared/rheology',              'createRheologyModeler'],
    ['createViabilityEstimator',        './docs/shared/viability',             'createViabilityEstimator'],
    ['createDataExporter',              './docs/shared/export',                'createDataExporter'],
    ['createPassageTracker',            './docs/shared/passage',               'createPassageTracker'],
    ['createBioinkMixer',              './docs/shared/mixer',                  'createBioinkMixer'],
    ['createJobEstimator',             './docs/shared/jobEstimator',           'createJobEstimator'],
    ['createScaffoldCalculator',       './docs/shared/scaffold',               'createScaffoldCalculator'],
    ['createCapabilityAnalyzer',       './docs/shared/capability',             'createCapabilityAnalyzer'],
    ['createPrintQualityScorer',       './docs/shared/printQualityScorer',     'createPrintQualityScorer'],
    ['createRecipeBuilder',            './docs/shared/recipeBuilder',          'createRecipeBuilder'],
    ['createProtocolGenerator',        './docs/shared/protocolGenerator',      'createProtocolGenerator'],
    ['createNozzleAdvisor',            './docs/shared/nozzleAdvisor',          'createNozzleAdvisor'],
    ['createSampleTracker',            './docs/shared/sampleTracker',          'createSampleTracker'],
    ['createYieldAnalyzer',            './docs/shared/yieldAnalyzer',          'createYieldAnalyzer'],
    ['createShelfLifeManager',         './docs/shared/shelfLife',              'createShelfLifeManager'],
    ['createSterilityAssurance',       './docs/shared/sterilityAssurance',     'createSterilityAssurance'],
    ['createCellSeedingCalculator',    './docs/shared/cellSeeding',            'createCellSeedingCalculator'],
    ['createWashProtocolCalculator',   './docs/shared/washProtocol',           'createWashProtocolCalculator'],
    ['createCompatibilityMatrix',      './docs/shared/compatibilityMatrix',    'createCompatibilityMatrix'],
    ['createLabInventoryManager',      './docs/shared/labInventory',           'createLabInventoryManager'],
    ['createWasteTracker',             './docs/shared/wasteTracker',           'createWasteTracker'],
    ['createPrintSessionLogger',       './docs/shared/printSessionLogger',     'createPrintSessionLogger'],
    ['createDilutionCalculator',       './docs/shared/dilutionCalculator',     'createDilutionCalculator'],
    ['createPlateMapGenerator',        './docs/shared/plateMap',               'createPlateMapGenerator'],
    ['createEnvironmentalMonitor',     './docs/shared/environmentalMonitor',   'createEnvironmentalMonitor'],
    ['createCentrifugeCalculator',     './docs/shared/centrifuge',             'createCentrifugeCalculator'],
    ['createMediaPrepCalculator',      './docs/shared/mediaPrep',              'createMediaPrepCalculator'],
    ['createPipetteCalibrationChecker','./docs/shared/pipetteCalibration',     'createPipetteCalibrationChecker'],
    ['createFreezeThawTracker',        './docs/shared/freezeThaw',             'createFreezeThawTracker'],
    ['createBufferPrepCalculator',     './docs/shared/bufferPrep',             'createBufferPrepCalculator'],
    ['createCellCounter',             './docs/shared/cellCounter',             'createCellCounter'],
    ['createSpectrophotometer',       './docs/shared/spectrophotometer',       'createSpectrophotometer'],
    ['createOsmolalityCalculator',    './docs/shared/osmolality',              'createOsmolalityCalculator'],
    ['createAutoclaveLogger',         './docs/shared/autoclave',               'createAutoclaveLogger'],
];

// ── Lazy-loading exports ───────────────────────────────────────────
// Each factory is loaded from disk only on first access, then cached.
// This avoids requiring all 37 modules at startup when consumers
// typically use only a handful.

var api = {};

function defineLazy(target, exportName, modulePath, factoryName) {
    var cached = null;
    Object.defineProperty(target, exportName, {
        enumerable: true,
        configurable: true,
        get: function () {
            if (cached === null) {
                cached = require(modulePath)[factoryName];
            }
            return cached;
        }
    });
}

for (var i = 0; i < manifest.length; i++) {
    defineLazy(api, manifest[i][0], manifest[i][1], manifest[i][2]);
}

/**
 * List all available factory names.
 * @returns {string[]} Sorted array of export names.
 */
api.listFactories = function listFactories() {
    return manifest.map(function (entry) { return entry[0]; }).sort();
};

module.exports = api;
