// Type definitions for @sauravbhattacharya001/biobots 1.2.0
// Project: https://github.com/sauravbhattacharya001/BioBots

/**
 * BioBots SDK — Bioprinting computation toolkit.
 *
 * Provides 73 lazy-loaded factory functions for bioprinting calculations,
 * lab instrument control, sample management, and experiment planning.
 *
 * @example
 * ```ts
 * import biobots from '@sauravbhattacharya001/biobots';
 *
 * const calc = biobots.createMaterialCalculator();
 * const result = calc.calculate({ material: 'alginate', volume: 5 });
 * ```
 */

// --- Core Bioprinting ---
export function createMaterialCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createCrosslinkAnalyzer(options?: Record<string, unknown>): Record<string, unknown>;
export function createGCodeAnalyzer(options?: Record<string, unknown>): Record<string, unknown>;
export function createRheologyModeler(options?: Record<string, unknown>): Record<string, unknown>;
export function createViabilityEstimator(options?: Record<string, unknown>): Record<string, unknown>;
export function createBioinkMixer(options?: Record<string, unknown>): Record<string, unknown>;
export function createScaffoldCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createNozzleAdvisor(options?: Record<string, unknown>): Record<string, unknown>;
export function createPrintQualityScorer(options?: Record<string, unknown>): Record<string, unknown>;
export function createPrintResolutionCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createPrintParameterRecommender(options?: Record<string, unknown>): Record<string, unknown>;
export function createPrintSessionLogger(options?: Record<string, unknown>): Record<string, unknown>;

// --- Data & Export ---
export function createDataExporter(options?: Record<string, unknown>): Record<string, unknown>;
export function createRecipeBuilder(options?: Record<string, unknown>): Record<string, unknown>;
export function createProtocolGenerator(options?: Record<string, unknown>): Record<string, unknown>;
export function createProtocolTemplateLibrary(options?: Record<string, unknown>): Record<string, unknown>;
export function createLabNotebookGenerator(options?: Record<string, unknown>): Record<string, unknown>;

// --- Cell & Sample Management ---
export function createPassageTracker(options?: Record<string, unknown>): Record<string, unknown>;
export function createSampleTracker(options?: Record<string, unknown>): Record<string, unknown>;
export function createSampleLabelGenerator(options?: Record<string, unknown>): Record<string, unknown>;
export function createCellSeedingCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createCellCounter(options?: Record<string, unknown>): Record<string, unknown>;
export function createCellViabilityCalculator(options?: Record<string, unknown>): Record<string, unknown>;

// --- Lab Calculations ---
export function createDilutionCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createSerialDilutionCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createMolarityCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createBufferPrepCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createMediaPrepCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createPhAdjustmentCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createOsmolalityCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createUnitConverter(options?: Record<string, unknown>): Record<string, unknown>;

// --- Lab Instruments ---
export function createCentrifugeCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createSpectrophotometer(options?: Record<string, unknown>): Record<string, unknown>;
export function createElectroporationCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createPipetteCalibrationChecker(options?: Record<string, unknown>): Record<string, unknown>;
export function createAutoclaveLogger(options?: Record<string, unknown>): Record<string, unknown>;
export function createGelElectrophoresisAnalyzer(options?: Record<string, unknown>): Record<string, unknown>;
export function createPcrMasterMixCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createFlowCytometryAnalyzer(options?: Record<string, unknown>): Record<string, unknown>;
export function createWesternBlotAnalyzer(options?: Record<string, unknown>): Record<string, unknown>;
export function createStandardCurveCalculator(options?: Record<string, unknown>): Record<string, unknown>;

// --- Lab Management ---
export function createLabInventoryManager(options?: Record<string, unknown>): Record<string, unknown>;
export function createLabEquipmentScheduler(options?: Record<string, unknown>): Record<string, unknown>;
export function createLabSafetyChecklist(options?: Record<string, unknown>): Record<string, unknown>;
export function createLabDigitalTwin(options?: Record<string, unknown>): Record<string, unknown>;
export function createEnvironmentalMonitor(options?: Record<string, unknown>): Record<string, unknown>;
export function createWasteTracker(options?: Record<string, unknown>): Record<string, unknown>;
export function createPlateMapGenerator(options?: Record<string, unknown>): Record<string, unknown>;

// --- Quality & Safety ---
export function createCapabilityAnalyzer(options?: Record<string, unknown>): Record<string, unknown>;
export function createSterilityAssurance(options?: Record<string, unknown>): Record<string, unknown>;
export function createShelfLifeManager(options?: Record<string, unknown>): Record<string, unknown>;
export function createWashProtocolCalculator(options?: Record<string, unknown>): Record<string, unknown>;
export function createCompatibilityMatrix(options?: Record<string, unknown>): Record<string, unknown>;
export function createFreezeThawTracker(options?: Record<string, unknown>): Record<string, unknown>;
export function createContaminationRiskScorer(options?: Record<string, unknown>): Record<string, unknown>;
export function createContaminationEarlyWarning(options?: Record<string, unknown>): Record<string, unknown>;
export function createMycoplasmaTestLogger(options?: Record<string, unknown>): Record<string, unknown>;
export function createMediaOptimizer(options?: Record<string, unknown>): Record<string, unknown>;

// --- Analytics & Prediction ---
export function createJobEstimator(options?: Record<string, unknown>): Record<string, unknown>;
export function createYieldAnalyzer(options?: Record<string, unknown>): Record<string, unknown>;
export function createGrowthCurveAnalyzer(options?: Record<string, unknown>): Record<string, unknown>;
export function createOutcomePredictor(options?: Record<string, unknown>): Record<string, unknown>;
export function createAnomalyCorrelator(options?: Record<string, unknown>): Record<string, unknown>;
export function createDegradationPredictor(options?: Record<string, unknown>): Record<string, unknown>;
export function createDriftDetector(options?: Record<string, unknown>): Record<string, unknown>;
export function createResourceForecaster(options?: Record<string, unknown>): Record<string, unknown>;
export function createSituationAwareness(options?: Record<string, unknown>): Record<string, unknown>;

// --- Experiment Design ---
export function createExperimentRandomizer(options?: Record<string, unknown>): Record<string, unknown>;
export function createExperimentReplicator(options?: Record<string, unknown>): Record<string, unknown>;
export function createExperimentPlanner(options?: Record<string, unknown>): Record<string, unknown>;
export function createProtocolDeviationTracker(options?: Record<string, unknown>): Record<string, unknown>;
export function createBatchGenealogyTracker(options?: Record<string, unknown>): Record<string, unknown>;
export function createWorkflowOrchestrator(options?: Record<string, unknown>): Record<string, unknown>;
export function createPrintParameterRecommender(options?: Record<string, unknown>): Record<string, unknown>;

// --- Utility ---

/**
 * List all available factory names.
 * @returns Sorted array of factory export names.
 */
export function listFactories(): string[];

/**
 * Check whether a factory name is available (O(1) hash lookup).
 * @param name - Factory name (e.g. 'createMaterialCalculator').
 */
export function hasFactory(name: string): boolean;

/**
 * Total number of available factories.
 */
export const factoryCount: number;
