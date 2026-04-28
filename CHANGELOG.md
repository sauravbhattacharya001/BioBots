# Changelog

All notable changes to the `@sauravbhattacharya001/biobots` npm package will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-04-28

### Added
- **TypeScript declarations** (`index.d.ts`) — full type definitions for all 73 factory functions, `listFactories()`, `hasFactory()`, and `factoryCount`. Consumers get autocomplete and type checking out of the box.
- **`exports` field** in package.json for Node.js conditional exports (CJS + types).
- **`publishConfig`** with `access: "public"` and `provenance: true` for npm attestation.
- **`engines`** field requiring Node.js ≥ 16.0.0.
- **Lifecycle scripts**: `prepublishOnly` (runs tests before publish), `preversion` (runs tests before version bump), `postversion` (auto-pushes tags).
- This `CHANGELOG.md`.

### New Modules (since v1.1.0)
- `createSituationAwareness` — Lab Situation Awareness Engine
- `createExperimentPlanner` — Smart Experiment Planner for autonomous goal-oriented experiment design
- `createResourceForecaster` — Lab Resource Forecaster for consumption monitoring & procurement optimization
- `createDriftDetector` — Parameter Drift Detector for autonomous statistical drift monitoring
- `createPrintParameterRecommender` — Autonomous multi-objective parameter optimizer
- `createDegradationPredictor` — Material degradation prediction
- `createWorkflowOrchestrator` — Lab Workflow Orchestrator with autonomous pipeline execution
- `createBatchGenealogyTracker` — Batch genealogy tracking
- `createExperimentReplicator` — Experiment replication engine
- `createProtocolDeviationTracker` — Protocol deviation tracking
- `createLabEquipmentScheduler` — Lab equipment scheduling
- `createLabDigitalTwin` — Lab Digital Twin

### Security
- Fixed CWE-1321 prototype pollution in driftDetector, protocolDeviation, materialLotTracker, mlDiagnostic, experimentRandomizer
- Fixed CWE-1236 CSV formula injection in plateMap, mycoplasmaTest, sampleLabel

### Testing
- Added 47 tests for workflowOrchestrator
- Added 67 tests for batchGenealogy
- Added 73 tests for stats and anomalyCorrelator

## [1.1.0] - 2026-03-15

### Added
- Initial npm package release with 61 factory functions
- Lazy-loading module system for minimal startup cost
- `listFactories()`, `hasFactory()`, `factoryCount` utilities
- npm and GitHub Packages publish workflows

## [1.0.0] - 2026-02-01

### Added
- Core bioprinting computation modules
- Material calculator, rheology modeler, GCode analyzer
- Cell viability estimator, crosslink analyzer
