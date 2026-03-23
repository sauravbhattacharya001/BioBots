'use strict';

/**
 * BioBots SDK — Bioprinting computation toolkit.
 *
 * Exports factory functions for the core computational modules:
 *   - Material Calculator: bioink consumption & cost estimation
 *   - Crosslink Analyzer: cross-linking kinetics & gelation modeling
 *   - GCode Analyzer: extrusion, movement, and cost analysis
 *   - Rheology Modeler: viscosity modeling & printability scoring
 *   - Viability Estimator: cell survival prediction with environment modeling
 *   - Data Exporter: CSV/JSON export with formula-injection defense
 *   - Passage Tracker: cell line passage history, viability trends, senescence risk
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
];

// ── Build exports from manifest ────────────────────────────────────
var exports_ = {};
for (var i = 0; i < manifest.length; i++) {
    var entry = manifest[i];
    var exportName = entry[0];
    var modulePath = entry[1];
    var factoryName = entry[2];
    exports_[exportName] = require(modulePath)[factoryName];
}

module.exports = exports_;
