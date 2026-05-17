# v1.46.0 — Knowledge Distillation, Reproducibility & Scheduling Intelligence

Released 2026-05-17. 50 commits since [v1.45.0](https://github.com/sauravbhattacharya001/BioBots/releases/tag/v1.45.0).

This release closes out the autonomous-lab triad: experiments learn from each other (**Cross-Experiment Learning** + **Reproducibility Analyzer**), the lab itself learns from its own tacit practice (**Knowledge Distillation**), and the scheduler turns that knowledge into a daily plan (**Scheduling Intelligence**). Plus a smaller, sharper inventory loop (**Smart Reorder Advisor**) and a measurable jump in core-engine performance.

## ✨ New Engines (10)

- **Lab Scheduling Intelligence Engine** — autonomous experiment scheduling optimizer with priority + resource awareness (`ac2c15f`).
- **Smart Reorder Advisor** — agentic inventory reordering with consumption forecasting (`6492e87`).
- **Lab Knowledge Distillation Engine** — extracts tacit knowledge from successful runs into reusable rules (`0a541c4`).
- **Experiment Reproducibility Analyzer** — quantifies cross-run reproducibility and flags drift sources (`d604624`).
- **Experiment Outcome Oracle** — pre-experiment outcome prediction with calibrated confidence bands (`e8a9d96`).
- **Lab Supply Chain Resilience Engine** — autonomous risk analysis across material lots and vendors (`29caf4c`).
- **Lab Compliance Auditor** — autonomous regulatory compliance checker (`5609b5d`).
- **Lab Entropy Monitor** — autonomous lab disorder detection (`a59a9fa`).
- **Lab Workflow Optimizer** — DAG-based workflow analysis with critical-path optimization (`0049daf`).
- **Bioprint Failure Autopsy** — autonomous post-failure forensic analysis (`acf0f01`).

## 🚀 Performance

- `experimentRiskAssessor`: collapsed `assessBiosafety` and `assessResource` into a single pass over materials (`4b675db`).
- `parameterRecommender`: incremental O(n·f) Pareto front maintenance + pre-filtered feedback (`de6de19`).
- `crossExperimentLearner`: pre-extracted column vectors + eliminated redundant correlation recomputation (`1c29054`).
- `analyseEvent`: O(1) source-category lookup + single-pass historical counts (`76b8325` — note: tracked under `76d…`).

## 🔒 Security

Prototype-pollution hardening (CWE-1321) added to:
- `protocolEvolution` (`d17ebb8`)
- `sterilization` analyzer (`1e9e768`)
- `wasteTracker` material/jobId key iteration (`f0e0c56`)
- `driftDetector` (`0108bdc`)

## 🧹 Refactors

- Deduplicated `mean` / `stddev` / `linearRegression` into the shared `stats` module (`7084b0a`).
- Deduplicated sanitization helpers — modules now delegate to the canonical `sanitize` module (`59dbf12`).
- Extracted guard helpers, deduplicated error strings, removed unused imports across the codebase (`0b40a73`).
- `crossExperimentLearner`: extracted `_partitionByOutcomePercentile` helper (`a7646c0`).

## 🐛 Fixes

- `labEntropyMonitor`: consistent timestamp references across snapshot and trend (`3b4c726`).
- `serialDilution`: enforce consistent coupling between `dilutionFactor` and `transferVolume` (`b8f33b3`).
- `driftDetector`: use recent-window regression for forecast slope (fixes #155) (`58a5121`).

## ✅ Tests

Test suite now ships **157 test files** under `__tests__/` plus targeted suites under `tests/`.

- Added coverage for `csvSafe`, `materials`, and `labSafetyChecklist` (`8b610af`).
- 38 comprehensive tests for `labDigitalTwin` (`ac804ac`).
- 47 tests for `workflowOrchestrator` (`133019d`).

## 📚 Docs

- README overhaul: accurate stats, categorized tool index, cleaner structure (`809e981`).
- 3 new interactive doc pages: QC Autopilot (SPC), Predictive Maintenance, Experiment Planner (`957e800`).
- Lab Digital Twin interactive docs page (`84c049a`).
- Lab Preparation Suite page — 9 interactive calculators (`9a8de4f`).
- CONTRIBUTING module catalog updated to 96 modules / 152 test files (`661b72d`).

## 🛠️ CI / Tooling

- `actions/github-script` bumped 7 → 9 (`80a3fa9`).
- Dev-dependencies group bump (`66a54d9`).
- **Auto-labeler overhaul** (this release): fixed the undefined `data` label (now uses existing `area/data`) and added rules for `python`, `npm-package`, `dependencies`, `copilot`, `security`, and `docker`. Missing labels were created in the repo so `sync-labels: true` no longer churns (`a71e90d`).

## 📦 npm package

`@sauravbhattacharya001/biobots` remains on **1.2.0** in this release — npm versioning is decoupled from the BioBots tool versioning. The next npm bump will pick up the new engines once they have stable consumer-facing entry points wired through `index.js`.

## Compatibility

- C# / .NET Framework 4.8 ASP.NET Web API project unchanged.
- Node.js ≥ 16 for the npm package (unchanged).
- No breaking changes for existing consumers.

**Full diff:** https://github.com/sauravbhattacharya001/BioBots/compare/v1.45.0...v1.46.0
