# Changelog

All notable changes to the `@sauravbhattacharya001/biobots` npm package will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

> **Note on tag history.** The `v1.x` git tags (e.g. `v1.46.0`) on this repo are
> release notes for the *project as a whole* — the docs site, computational
> engines, and demo applications. The npm package version is independent and
> tracks only the surface area shipped via `index.js`. The `[Unreleased]`
> section below collects the npm-relevant changes that have accumulated since
> the last published npm version, `1.2.0`.

## [Unreleased]

### Added

- **18 new factory functions** exported from `index.js`, growing the public
  surface from 73 (in 1.2.0) to **91**. Notable additions:
  - `createCrossExperimentLearner` — pattern discovery across past experiments
    with correlation analysis (project v1.43.0).
  - `createExperimentRiskAssessor` — real-time biosafety + resource + regulatory
    risk scoring with a single-pass material analysis (project v1.43.0).
  - `createPredictiveMaintenance` — Weibull-based equipment failure prediction
    and proactive scheduling (project v1.43.0).
  - `createProtocolEvolution` — evolutionary optimization of protocols using
    fitness-scored mutations, with prototype-pollution-safe deep-clone
    (project v1.43.0).
  - `createIncidentReplay` — forensic timeline reconstruction for lab incidents
    (project v1.43.0).
  - `createLabEntropyMonitor` — disorder/drift detection across equipment,
    supplies, and protocol adherence (project v1.44.0).
  - `createWorkflowOptimizer` — DAG-based critical-path analysis for multi-step
    protocols (project v1.44.0).
  - `createFailureAutopsy` — autonomous post-failure forensic analysis
    (project v1.44.0).
  - `createOutcomeOracle` — pre-experiment outcome prediction with calibrated
    confidence bands (project v1.45.0).
  - `createSupplyChainResilience` — vendor-risk and single-source-dependency
    analysis (project v1.45.0).
  - `createComplianceAuditor` — GLP / GMP / ISO 17025 compliance auditing
    (project v1.45.0).
  - `createKnowledgeDistiller` — extracts tacit rules from successful runs
    (project v1.46.0).
  - `createReproducibilityAnalyzer` — quantifies cross-run reproducibility and
    flags drift sources (project v1.46.0).
  - `createSchedulingIntelligence` — priority- and resource-aware experiment
    scheduling (project v1.46.0).
  - `createSmartReorder` — consumption-forecast-driven inventory reordering
    (project v1.46.0).
  - `createPerishableWasteForecaster`, `createReagentSubstitutionAdvisor`,
    `createShiftHandoffSynthesizer` — agentic cross-module advisors
    (post-v1.46.0).
- TypeScript declarations (`index.d.ts`) updated to cover all 91 factories.
- Global **Ctrl+K / Cmd+K command palette** (`docs/shared/commandPalette.js`)
  for fast tool navigation in the docs site, with O(1) arrow-key navigation
  (avoids full DOM rebuilds — project v1.42.0+).

### Changed

- Mean / stddev / linear-regression utilities deduplicated into the shared
  `stats` module; engines now delegate instead of carrying private copies
  (project v1.44.0).
- Sanitization helpers consolidated into the canonical `sanitize` module
  (project v1.45.0).
- `parameterRecommender`: O(n·f) incremental Pareto-front maintenance plus
  pre-filtered feedback (project v1.43.0).
- `crossExperimentLearner`: pre-extracted column vectors and eliminated
  redundant correlation recomputation (project v1.43.0).
- `experimentRiskAssessor`: collapsed `assessBiosafety` and `assessResource`
  into a single pass over materials (project v1.43.0).

### Fixed

- `serialDilution`: enforces consistent coupling between `dilutionFactor` and
  `transferVolume` (project v1.44.0).
- `labEntropyMonitor`: consistent timestamp references across snapshot and
  trend windows (project v1.45.0).
- `driftDetector`: uses recent-window regression for forecast slope
  (closes #155, project v1.43.0).
- `runMethod` allowlist now matches `Try/index.html` options (closes #158).

### Security

- CWE-1321 prototype-pollution hardening in `protocolEvolution`,
  `sterilization`, `wasteTracker`, and `driftDetector` (project v1.43.0+).

### Tests

- Test suite grew to **162 files** under `__tests__/` plus targeted suites
  under `tests/`. Recent additions cover `commandPalette`, `csvSafe`,
  `materials`, `labSafetyChecklist`, `labDigitalTwin` (38 cases),
  `workflowOrchestrator` (47 cases), `parameterRecommender` (28 cases),
  `degradationPredictor` (42 cases), and `runMethod` (6 cases).

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
