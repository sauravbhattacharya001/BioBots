# v1.47.0 — Five New Agentic Advisors, Allowlist Hardening, +184 Tests

Released 2026-05-18. 17 commits since [v1.46.0](https://github.com/sauravbhattacharya001/BioBots/releases/tag/v1.46.0).

This release rounds out the agentic-advisor family with five new engines that all follow the same shape (deterministic, zero-deps, injectable `now()`, never mutates inputs, text/markdown/json renderers, P0-first deduped playbook), closes a real allowlist-drift issue (#158), hardens one more prototype-pollution surface, and adds 184 new test cases across previously thin areas of the suite.

## ✨ New Agentic Engines (5)

All new engines are siblings — same protocol, different problem.

- **EquipmentDowntimeRiskAdvisor** — next-N-day downtime risk for a fleet of lab equipment (bioprinter, incubator, biosafety cabinet, centrifuge, autoclave, pipette, microscope). Scores 6 weighted components (usage stress, calibration drift, error rate, consumables gap, environmental signal, runtime age) with criticality + risk-appetite multipliers, emits 6 verdicts and an A–F grade, simulates mitigation actions with 0.85^i diminishing returns (`5d47868`).
- **BatchReleaseAdvisor** — per-batch final-disposition advisor producing RELEASE / RELEASE_WITH_OBSERVATIONS / QUARANTINE / REWORK / REJECT verdicts with structured evidence trails (`b7031f2`).
- **ShiftHandoffSynthesizer** — between-shift carryover briefing generator covering in-flight runs, blockers, fresh anomalies, and next-shift priorities (`b76126e`).
- **ReagentSubstitutionAdvisor** — substitution recommender that scores candidate reagents against compatibility, criticality, and cost (`9d3d809`).
- **PerishableWasteForecaster** — agentic cross-module inventory-waste forecaster (`6a868cc`).

## 🔒 Security

- **protocolTemplates: prototype-pollution defense (CWE-1321).** `customize()` and `addTemplate()` no longer trust inherited-key lookups — an override key matching an `Object.prototype` member (`toString`, `hasOwnProperty`, `valueOf`, …) used to resolve truthy via the prototype chain, bypass validation, and mutate the built-in, polluting `Object.prototype` for the whole process. Fix uses `Object.prototype.hasOwnProperty.call` on both source and target, strips `__proto__` / `constructor` / `prototype` via `isDangerousKey`, and validates that custom template ids are strings. New regression suite `__tests__/protocolTemplates.prototype-pollution.test.js` covers all bypass vectors (`7bcc03c`).

## 🐛 Fixes

- **runMethod: align allowlist with `Try/index.html` options (closes #158).** The Try-page method picker had silently drifted from the runtime allowlist, producing "method not allowed" errors for options the UI advertised. Allowlist regenerated from the canonical UI source, plus a `scripts/check-runmethod-allowlist.js` drift checker wired into `pretest` and `pretest:ci` so any future divergence fails the build (`1d83f60`, `abce441`).
- **evolution_tracker: Simpson index returns 0.0 for empty population.** Empty input was returning Simpson's D = 1.0 (from `1 − sum([])`), which is mathematically meaningless — the diversity of nothing is not "maximally diverse". Matched the existing convention used by Shannon entropy and heterozygosity in the same class. Also fixed a latent `coverageThresholds` → `coverageThreshold` typo in `package.json` that had been emitting a Jest 30 validation warning every test run and leaving thresholds effectively unenforced (`2b911a1`).
- **molarity, gcode: preserve sub-gram precision; count trailing line.** Two narrow bugs in canonical chemistry/parsing helpers (`6f55c1d`).
- **tests/maintenance: await async `loadPrintData()` in `beforeEach`** — closes a regression that intermittently surfaced as flaky maintenance-suite failures (`8410084`).

## ✅ Tests (+184 cases)

- `workflowOrchestrator`: 41 cases covering the pipeline engine end-to-end (`1d8db43`).
- Shared-module coverage backfill: 57 new cases for the last two untested shared modules (`b9231b6`).
- `commandPalette`: 16 jest cases for the Ctrl+K overlay — filtering, keyboard nav, XSS escaping (`7855386`).
- `parameterRecommender`: 28-case unit suite for `createPrintParameterRecommender` (`9288ed6`).
- `degradationPredictor`: 42 cases (`83cd6c9`).

## 📚 Docs

- **CHANGELOG: `[Unreleased]` section** covering the 18 factories, perf/security work, and test additions accumulated since the last published npm version (`9c13c66`).

## 📦 npm package

`@sauravbhattacharya001/biobots` remains on **1.2.0** in this release — npm versioning stays decoupled from the BioBots tool versioning. The next npm bump will land once the new advisor engines (Equipment / Batch / Shift / Reagent / Waste) have stable consumer-facing entry points wired through `index.js`.

## Compatibility

- C# / .NET Framework 4.8 ASP.NET Web API project unchanged.
- Node.js ≥ 16 for the npm package (unchanged).
- No breaking changes for existing consumers.

**Full diff:** https://github.com/sauravbhattacharya001/BioBots/compare/v1.46.0...v1.47.0
