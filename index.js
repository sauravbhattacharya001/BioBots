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

module.exports = {
    createMaterialCalculator: calculator.createMaterialCalculator,
    createCrosslinkAnalyzer: crosslink.createCrosslinkAnalyzer,
    createGCodeAnalyzer: gcode.createGCodeAnalyzer,
    createRheologyModeler: rheology.createRheologyModeler,
    createViabilityEstimator: viability.createViabilityEstimator,
    createDataExporter: exporter.createDataExporter,
    createPassageTracker: passage.createPassageTracker,
    createBioinkMixer: mixer.createBioinkMixer,
    createJobEstimator: jobEstimator.createJobEstimator
};
