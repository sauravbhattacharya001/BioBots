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

var calculator = require('./docs/shared/calculator');
var crosslink = require('./docs/shared/crosslink');
var gcode = require('./docs/shared/gcode');
var rheology = require('./docs/shared/rheology');
var viability = require('./docs/shared/viability');
var exporter = require('./docs/shared/export');
var passage = require('./docs/shared/passage');
var mixer = require('./docs/shared/mixer');
var jobEstimator = require('./docs/shared/jobEstimator');
var scaffold = require('./docs/shared/scaffold');
var capability = require('./docs/shared/capability');
var printQualityScorer = require('./docs/shared/printQualityScorer');
var recipeBuilder = require('./docs/shared/recipeBuilder');
var protocolGenerator = require('./docs/shared/protocolGenerator');
var nozzleAdvisor = require('./docs/shared/nozzleAdvisor');
var sampleTracker = require('./docs/shared/sampleTracker');

module.exports = {
    createMaterialCalculator: calculator.createMaterialCalculator,
    createCrosslinkAnalyzer: crosslink.createCrosslinkAnalyzer,
    createGCodeAnalyzer: gcode.createGCodeAnalyzer,
    createRheologyModeler: rheology.createRheologyModeler,
    createViabilityEstimator: viability.createViabilityEstimator,
    createDataExporter: exporter.createDataExporter,
    createPassageTracker: passage.createPassageTracker,
    createBioinkMixer: mixer.createBioinkMixer,
    createJobEstimator: jobEstimator.createJobEstimator,
    createScaffoldCalculator: scaffold.createScaffoldCalculator,
    createCapabilityAnalyzer: capability.createCapabilityAnalyzer,
    createPrintQualityScorer: printQualityScorer.createPrintQualityScorer,
    createRecipeBuilder: function() { return recipeBuilder; },
    createProtocolGenerator: function() { return protocolGenerator; },
    createNozzleAdvisor: nozzleAdvisor.createNozzleAdvisor,
    createSampleTracker: sampleTracker.createSampleTracker
};
