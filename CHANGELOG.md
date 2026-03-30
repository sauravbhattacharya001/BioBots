# Changelog

All notable changes to the BioBots Tool project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.13.0] - 2026-03-30

### Added
- **Standard Curve Calculator** — linear regression for assay quantification with R² goodness-of-fit
- **Mycoplasma Test Logger** — track and log mycoplasma contamination testing results

### Changed
- **Performance:** optimized hot-path `round()` with lookup table and single-pass regression
- **Refactor:** consolidated duplicated `round`/`clamp` into shared `validation.js` imports
- **Refactor:** use shared `validatePositive` in centrifuge, nozzleAdvisor, sterilityAssurance modules

## [1.4.1] - 2026-03-24

### Changed
- **escapeHtml utility** — replaced DOM-based implementation with a universal string-replace approach, removing the dependency on a DOM environment and improving portability across Node.js and browser runtimes.

### CI
- Bumped `microsoft/setup-msbuild` from v2 to v3 in CI workflow.

## [1.4.0] - 2026-03-03

### Added
- **Cell Viability Estimator** (`docs/shared/viability.js`) — multi-stressor model predicting cell survival under shear stress, pressure, UV crosslinking, thermal, and duration factors; sensitivity analysis, optimal window finder, batch analysis, 2D parameter sweep, grid-search calibration, and report generation (72 tests)
- **Scaffold Porosity Analyzer** — tissue engineering suitability assessment for bioprinted constructs
- **Cross-Linking Kinetics Analyzer** (`docs/shared/crosslink.js`) — models UV/radical cross-linking kinetics with dose-response curves, bell-shaped viability tradeoffs, and reaction rate estimation (81 tests)
- **GCode Analyzer** (`docs/shared/gcode.js`) — parses G-code files for extrusion metrics, movement patterns, layer analysis, print time estimation, and cost calculation (60 tests)
- **Bioink Rheology Modeler** (`docs/shared/rheology.js`) — viscosity modeling (power-law, Carreau, Herschel-Bulkley), shear-thinning analysis, printability scoring, and filament stability prediction (73 tests)
- **Protocol Template Library** — 8 built-in bioprinting protocols with parameter presets, modification tracking, and comparison
- **Failure Mode Analysis** dashboard — FMEA classification, Pareto charts, and root cause analysis for bioprinting failures

## [1.3.0] - 2026-03-02

### Added
- **Reproducibility Analyzer** dashboard — coefficient of variation, ICC, Bland-Altman analysis across print runs (64 tests)
- **Pareto Front Analyzer** — multi-objective trade-off analysis for bioprinting parameters
- **Print Report Generator** — select prints and generate formatted, printable lab reports
- **Parameter Recommender** — optimal settings derived from dataset statistics
- **Calibration Wizard** — guided step-by-step parameter optimization workflow
- **Protocol Library** — save, browse, search, and compare bioprinting protocols
- **DOE (Design of Experiments) Analyzer** — factorial design, interaction effects, statistical significance
- **Batch Planner** — plan multiple print runs with material and time resource estimation

### Fixed
- Correct quartile calculation using linear interpolation
- Lazy-init `escapeHtml` DOM element to prevent null reference
- Optimizer test failures from floating-point precision
- Single-pass evolution tracking (performance improvement)

### Changed
- Bump `actions/upload-artifact` from 6 to 7

## [1.2.0] - 2026-03-01

### Added
- **Experiment Coverage Map** — 2D parameter space heatmap showing tested regions
- **Wellplate Analyzer** dashboard — well-level statistics and spatial pattern detection
- **Statistical Process Control (SPC)** dashboard — control charts, process capability indices (Cp/Cpk)
- **Material Usage Calculator** — estimate bioink consumption, cost, and duration for print jobs
- **Print Success Predictor** — k-nearest-neighbor outcome prediction from historical data
- **Correlation Matrix** heatmap — Pearson r across all 11 metrics with interactive visualization

### Fixed
- Stack overflow on large datasets (recursive correlation computation)
- Normalize arithmetic operator to lowercase before matching (case-insensitive fix)
- Add fetch error handling to profile page

### Changed
- Refactored metric accessors; removed committed `__pycache__` directory

## [1.1.0] - 2026-02-24

### Added
- **Print Profile Card** — detailed single-print view with radar chart and quality grading (70 tests)
- **Cluster Analysis** dashboard — k-means clustering, silhouette scoring, and cluster profiles
- **Data Export Manager** — CSV and JSON download with column selection and filtering
- **Batch Statistics API** (`/stats`, `/stats/{metric}`, `/correlations`) — multi-metric descriptive statistics, percentiles, histograms, and Pearson correlation matrix

### Changed
- O(log n) binary search for comparison queries (was O(n) linear scan)
- Array-indexed `PrecomputeStats` single-pass optimization
- Single-pass metric extraction for correlation matrix (halves computation)

### Testing
- 45+ tests for `index.html` dashboard functions
- 115 tests for `table.html` functions

## [1.0.1] - 2026-02-22

### Added
- **Parameter Optimizer** — gradient-free optimization for bioprinting parameters
- **Evolution Tracker** — population genetics and natural selection analysis
- **Trend Analysis** dashboard — time-series trend detection for bioprinting metrics
- **Anomaly Detector** — statistical outlier detection (Z-score, IQR, Grubbs) for bioprint data
- **Quality Control** dashboard — identify optimal bioprinting parameter ranges
- **Print Comparison** tool — side-by-side analysis of 2-4 print records

### Fixed
- XSS via innerHTML injection and exception detail leakage (`8d440ce`)
- CSV formula injection (CWE-1236) via cell prefix sanitization (`aae216c`)
- Weight Fst subgroup heterozygosities by population size (`#16`)
- Skip boundary allele frequencies in selection coefficient (`#15`)
- Aggregation parameter keywords now case-insensitive (`07d4f3e`)

### Infrastructure
- CodeQL security scanning for JavaScript and C#
- Auto-labeler with PR size labels and stale bot
- Code coverage reporting with Codecov integration
- Comprehensive documentation site (API reference, architecture, developer guide)
- SECURITY.md and improved CONTRIBUTING.md
- Issue/PR templates

### Changed
- Bumped: `actions/checkout` v4→v6, `actions/setup-node` v4→v6, `actions/labeler` v5→v6, `actions/upload-pages-artifact` v3→v4, `github/codeql-action` v3→v4

## [1.0.0] - 2026-02-14

### Features
- **REST API** with 11 queryable bioprinting metrics (cell viability, elasticity, crosslinking, pressure, resolution, wellplate)
- **Three comparison operators** — greater, lesser, equal — for counting records matching criteria
- **Three aggregation functions** — Maximum, Minimum, Average — for statistical summaries
- **Interactive web UI** with metric/comparison dropdowns and aggregation buttons
- **Thread-safe file-watch caching** — data reloads automatically when JSON file changes (no restart needed)
- **Streaming JSON deserialization** via Newtonsoft.Json — 50% lower peak memory vs legacy JavaScriptSerializer
- **Pre-computed aggregation stats** — O(1) for Maximum/Minimum/Average queries instead of O(n) per request
- **Null-safe record filtering** — records with missing nested objects are skipped with trace warnings
- **IEEE 754 epsilon equality** — floating-point comparison uses 1e-9 tolerance for accuracy
- **Input validation** — server-side validation of comparison operators and numeric parameters with descriptive error messages
- **Configurable data path** — set `DataFilePath` in Web.config appSettings

### Testing
- 50 Jest tests for frontend query client (isNumeric, setButtonsEnabled, runMethod)
- 100% statement, function, and line coverage on frontend JavaScript
- Tests cover: validation logic, URL construction, button state management, response handling, error scenarios

### Infrastructure
- **CI/CD** — GitHub Actions: MSBuild + NuGet restore (Windows), Jest tests (Node.js 22), JSON/YAML linting
- **Docker** — Multi-stage Dockerfile with non-root user, health checks
- **Dependabot** — Automated dependency updates for NuGet, npm, GitHub Actions, Docker
- **Copilot Agent** — Setup steps and instructions for autonomous AI coding
- **GitHub Pages** — Deployed interactive demo
