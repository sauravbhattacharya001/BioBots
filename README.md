<div align="center">

# 🧬 BioBots

**Bioprinting computation toolkit & analysis platform**

Material calculations · Rheology modeling · GCode analysis · Cell viability estimation · Cross-linking kinetics · 87 interactive tools

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/ci.yml/badge.svg)](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/sauravbhattacharya001/BioBots/graph/badge.svg)](https://codecov.io/gh/sauravbhattacharya001/BioBots)
[![CodeQL](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/codeql.yml/badge.svg)](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/codeql.yml)
[![Docker Build](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/docker.yml/badge.svg)](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/docker.yml)
[![npm](https://img.shields.io/npm/v/@sauravbhattacharya001/biobots?label=npm&logo=npm)](https://www.npmjs.com/package/@sauravbhattacharya001/biobots)
[![NuGet Publish](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/nuget-publish.yml/badge.svg)](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/nuget-publish.yml)
[![GitHub Pages](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/pages.yml/badge.svg)](https://sauravbhattacharya001.github.io/BioBots/)

![Tests](https://img.shields.io/badge/tests-5668%20passed-brightgreen)
![Test Suites](https://img.shields.io/badge/test%20suites-150-blue)
![Factories](https://img.shields.io/badge/SDK%20factories-80-informational)
![Tools](https://img.shields.io/badge/analysis%20tools-87-orange)

</div>

---

## 📑 Table of Contents

- [Quick Start](#-quick-start)
- [What's Inside](#-whats-inside)
- [Live Demo — 87 Analysis Tools](#-live-demo--87-analysis-tools)
- [SDK — npm Package](#-sdk--npm-package)
- [REST API](#-rest-api)
- [Architecture](#-architecture)
- [Development](#-development)
- [Deployment](#-deployment)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

---

## ⚡ Quick Start

All 87 analysis tools run entirely in your browser — no backend, no install, no dependencies:

**→ [Open the Dashboard](https://sauravbhattacharya001.github.io/BioBots/)**

Start with:
- [📊 Data Explorer](https://sauravbhattacharya001.github.io/BioBots/explorer.html) — histograms and scatter plots with regression
- [🎯 Quality Control](https://sauravbhattacharya001.github.io/BioBots/quality.html) — quality grading and optimal parameters
- [⚙️ Parameter Optimizer](https://sauravbhattacharya001.github.io/BioBots/optimizer.html) — find optimal parameters for any target metric
- [📋 Data Table](https://sauravbhattacharya001.github.io/BioBots/table.html) — sortable, filterable data browser with CSV export

Or install the SDK:
```bash
npm install @sauravbhattacharya001/biobots
```

---

## 📦 What's Inside

| Component | Description |
|-----------|-------------|
| **87 Browser Tools** | Interactive analysis, visualization, and lab management tools — zero dependencies, pure client-side |
| **80 SDK Factories** | Node.js computation modules for material calc, rheology, GCode, viability, and more |
| **REST API** | ASP.NET Web API for querying bioprint statistics (11 metrics × 3 comparisons × 3 aggregations) |
| **150 Test Suites** | 5,668 Jest tests covering SDK modules and analysis tools |
| **.NET Models** | NuGet package with data model classes for integration |
| **Docker** | Containerized deployment via GitHub Container Registry |

---

## 🌐 Live Demo — 87 Analysis Tools

All tools are deployed at **[sauravbhattacharya001.github.io/BioBots](https://sauravbhattacharya001.github.io/BioBots/)** and render entirely client-side using Canvas API.

<details>
<summary><strong>🔬 Core Analysis (8 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| [📊 Data Explorer](https://sauravbhattacharya001.github.io/BioBots/explorer.html) | Histograms, scatter plots, regression, summary statistics |
| [🔬 Print Comparison](https://sauravbhattacharya001.github.io/BioBots/compare.html) | Side-by-side comparison of 2–4 prints with radar charts |
| [🎯 Quality Control](https://sauravbhattacharya001.github.io/BioBots/quality.html) | Quality grading (A–F), correlation heatmap, optimal parameters |
| [🔍 Anomaly Detector](https://sauravbhattacharya001.github.io/BioBots/anomaly.html) | Z-Score and IQR outlier detection with severity classification |
| [🔗 Cluster Analysis](https://sauravbhattacharya001.github.io/BioBots/cluster.html) | K-means clustering with auto-k detection and silhouette scores |
| [⚙️ Parameter Optimizer](https://sauravbhattacharya001.github.io/BioBots/optimizer.html) | Find optimal parameters for any target metric |
| [📈 Trend Analysis](https://sauravbhattacharya001.github.io/BioBots/trends.html) | Moving averages, regression, metric correlations |
| [📊 Correlation](https://sauravbhattacharya001.github.io/BioBots/correlation.html) | Pairwise metric correlation matrix and insights |

</details>

<details>
<summary><strong>📊 Statistical & Process Control (8 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| [📊 SPC Charts](https://sauravbhattacharya001.github.io/BioBots/spc.html) | X-bar/R statistical process control charts |
| [📊 Pareto Analysis](https://sauravbhattacharya001.github.io/BioBots/pareto.html) | Multi-objective Pareto frontier visualization |
| [🎛️ Sensitivity Analysis](https://sauravbhattacharya001.github.io/BioBots/sensitivity.html) | Tornado charts, parameter impact ranking |
| [📐 Design of Experiments](https://sauravbhattacharya001.github.io/BioBots/doe.html) | Parameter space coverage, gap analysis |
| [📊 Statistics](https://sauravbhattacharya001.github.io/BioBots/stats.html) | Hypothesis testing and statistical calculator |
| [📊 Reproducibility](https://sauravbhattacharya001.github.io/BioBots/reproducibility.html) | Print reproducibility scoring |
| [📉 Drift Detector](https://sauravbhattacharya001.github.io/BioBots/drift-detector.html) | Parameter drift detection across runs |
| [📊 Coverage Tracker](https://sauravbhattacharya001.github.io/BioBots/coverage.html) | Parameter space coverage analysis |

</details>

<details>
<summary><strong>🧬 Bioink & Materials (9 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| [🧪 Bioink Calculator](https://sauravbhattacharya001.github.io/BioBots/calculator.html) | Volume, cost, and time estimation for bioink preparations |
| [🧪 Bioink Mixer](https://sauravbhattacharya001.github.io/BioBots/mixer.html) | Multi-component mixing ratio optimization |
| [🧪 Rheology Modeler](https://sauravbhattacharya001.github.io/BioBots/rheology.html) | Power-law, Carreau, Herschel-Bulkley viscosity models |
| [🧪 Materials Database](https://sauravbhattacharya001.github.io/BioBots/materials.html) | Bioink material properties and selection guide |
| [🧫 Bioink Database](https://sauravbhattacharya001.github.io/BioBots/bioink-database.html) | Searchable bioink properties with comparison |
| [🧪 Compatibility Matrix](https://sauravbhattacharya001.github.io/BioBots/compatibility.html) | Material pairing compatibility matrix |
| [🧫 Material Substitution](https://sauravbhattacharya001.github.io/BioBots/substitution.html) | Smart material substitution recommendations |
| [⏳ Shelf Life](https://sauravbhattacharya001.github.io/BioBots/shelf-life.html) | Bioink stability and expiry tracking |
| [📐 Standard Curve](https://sauravbhattacharya001.github.io/BioBots/standard-curve.html) | Standard curve calculator for calibration data |

</details>

<details>
<summary><strong>🏗️ Print Setup & Design (8 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| [🏗️ Scaffold Designer](https://sauravbhattacharya001.github.io/BioBots/scaffold.html) | 3D scaffold design — porosity, strut, material analysis |
| [🔩 Nozzle Planner](https://sauravbhattacharya001.github.io/BioBots/nozzle.html) | Nozzle selection and coordination |
| [🔧 Calibration](https://sauravbhattacharya001.github.io/BioBots/calibration.html) | Guided multi-parameter calibration |
| [🗺️ Toolpath Analyzer](https://sauravbhattacharya001.github.io/BioBots/toolpath.html) | G-code toolpath visualization |
| [📋 Recipe Builder](https://sauravbhattacharya001.github.io/BioBots/recipe.html) | Reproducible print recipe builder |
| [📝 Protocol Library](https://sauravbhattacharya001.github.io/BioBots/protocol.html) | Protocol management, tagging, comparison |
| [⚖️ Protocol Compare](https://sauravbhattacharya001.github.io/BioBots/protocol-compare.html) | Side-by-side protocol comparison engine |
| [🔮 Predictor](https://sauravbhattacharya001.github.io/BioBots/predictor.html) | ML prediction of print outcomes |

</details>

<details>
<summary><strong>🧫 Cell Biology & Post-Print (7 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| [🧬 Cell Seeding](https://sauravbhattacharya001.github.io/BioBots/seeding.html) | Seeding density and scaffold calculations |
| [🧫 Maturation Tracker](https://sauravbhattacharya001.github.io/BioBots/maturation.html) | Post-print tissue maturation tracking |
| [📈 Growth Curve](https://sauravbhattacharya001.github.io/BioBots/growth.html) | Cell proliferation tracking |
| [🔬 Passage Tracker](https://sauravbhattacharya001.github.io/BioBots/passage.html) | Cell passage tracking and lineage management |
| [🧬 Western Blot](https://sauravbhattacharya001.github.io/BioBots/western-blot.html) | Western blot analysis and quantification |
| [🧪 Flow Cytometry](https://sauravbhattacharya001.github.io/BioBots/flow-cytometry.html) | Flow cytometry data analysis and gating |
| [⚡ Electroporation Calculator](https://sauravbhattacharya001.github.io/BioBots/electroporation.html) | Electroporation protocol parameters |

</details>

<details>
<summary><strong>🏭 Lab Operations & Management (16 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| [💰 Cost Estimator](https://sauravbhattacharya001.github.io/BioBots/cost.html) | Per-print costs with materials, machine time, batch scaling |
| [📊 Queue Manager](https://sauravbhattacharya001.github.io/BioBots/queue.html) | Print job scheduling and queue management |
| [🏭 Batch Analytics](https://sauravbhattacharya001.github.io/BioBots/batch.html) | Batch processing queue and statistics |
| [📊 Yield Analyzer](https://sauravbhattacharya001.github.io/BioBots/yield.html) | Print yield analysis and optimization |
| [🌡️ Environment Monitor](https://sauravbhattacharya001.github.io/BioBots/environment.html) | Lab conditions — temp, humidity, CO₂, particulates |
| [🛡️ Maintenance](https://sauravbhattacharya001.github.io/BioBots/maintenance.html) | Equipment maintenance scheduling and alerts |
| [🚀 Fleet Commander](https://sauravbhattacharya001.github.io/BioBots/fleet-commander.html) | Multi-printer fleet management dashboard |
| [🏭 Capacity Planner](https://sauravbhattacharya001.github.io/BioBots/capacity-planner.html) | Lab capacity planning and resource forecasting |
| [📦 Sample Registry](https://sauravbhattacharya001.github.io/BioBots/samples.html) | Sample tracking and inventory management |
| [📋 Sample Tracking](https://sauravbhattacharya001.github.io/BioBots/tracking.html) | Sample tracking board with status |
| [♻️ Waste Tracker](https://sauravbhattacharya001.github.io/BioBots/waste.html) | Material waste logging and trends |
| [⏰ Expiry Watchdog](https://sauravbhattacharya001.github.io/BioBots/expiry-watchdog.html) | Reagent expiry tracking and alerting |
| [🧹 Sterilization](https://sauravbhattacharya001.github.io/BioBots/sterilization.html) | Sterilization method selection and cycles |
| [📅 Timeline Planner](https://sauravbhattacharya001.github.io/BioBots/timeline.html) | Bioprint timeline planning and scheduling |
| [📅 Smart Scheduler](https://sauravbhattacharya001.github.io/BioBots/scheduler.html) | Intelligent experiment scheduling |
| [⏱️ Lab Timer](https://sauravbhattacharya001.github.io/BioBots/timer.html) | Multi-channel lab timer for protocol timing |

</details>

<details>
<summary><strong>📝 Compliance, Quality & Reporting (12 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| [📋 Print Report](https://sauravbhattacharya001.github.io/BioBots/report.html) | Formatted, printable lab reports |
| [📓 Print Logbook](https://sauravbhattacharya001.github.io/BioBots/logbook.html) | Lab notebook — notes, tags, flags, search, export |
| [📊 Print Profile](https://sauravbhattacharya001.github.io/BioBots/profile.html) | Individual print quality profiling with scoring |
| [📈 Evolution Tracker](https://sauravbhattacharya001.github.io/BioBots/evolution.html) | Print quality evolution over time |
| [🔬 Failure Diagnostics](https://sauravbhattacharya001.github.io/BioBots/failure.html) | Root cause analysis and failure mode detection |
| [🔧 Troubleshooter](https://sauravbhattacharya001.github.io/BioBots/troubleshooter.html) | Interactive bioprint troubleshooter |
| [✅ GLP Compliance](https://sauravbhattacharya001.github.io/BioBots/compliance.html) | Good Laboratory Practice compliance checks |
| [🔗 Chain of Custody](https://sauravbhattacharya001.github.io/BioBots/chain-of-custody.html) | Sample chain-of-custody tracking and audit trail |
| [🔍 Data Integrity](https://sauravbhattacharya001.github.io/BioBots/integrity.html) | Data integrity auditing and validation |
| [🛡️ Safety Checklist](https://sauravbhattacharya001.github.io/BioBots/safety-checklist.html) | Lab safety checklist and compliance |
| [🚨 Incident Report](https://sauravbhattacharya001.github.io/BioBots/incident-report.html) | Lab incident reporting and pattern analysis |
| [⚠️ Risk Assessor](https://sauravbhattacharya001.github.io/BioBots/risk-assessor.html) | Experiment risk assessment and mitigation |

</details>

<details>
<summary><strong>🤖 Automation & Advanced (7 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| [🤖 Print Quality Autopilot](https://sauravbhattacharya001.github.io/BioBots/autopilot.html) | Autonomous print quality monitoring and adjustment |
| [📝 Recommender](https://sauravbhattacharya001.github.io/BioBots/recommender.html) | Parameter recommendation engine |
| [🔄 Workflow Orchestrator](https://sauravbhattacharya001.github.io/BioBots/orchestrator.html) | Lab workflow orchestration and automation |
| [⚙️ Workflow Builder](https://sauravbhattacharya001.github.io/BioBots/workflow-builder.html) | Visual workflow builder for experiment pipelines |
| [🔬 Experiment Replicator](https://sauravbhattacharya001.github.io/BioBots/replicator.html) | Experiment replication planning and tracking |
| [🧠 Knowledge Graph](https://sauravbhattacharya001.github.io/BioBots/knowledge-graph.html) | Lab knowledge graph for experiment insights |
| [⚠️ Early Warning](https://sauravbhattacharya001.github.io/BioBots/early-warning.html) | Contamination early warning and detection system |

</details>

<details>
<summary><strong>🔧 Utilities & Reference (12 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| [📋 Data Table](https://sauravbhattacharya001.github.io/BioBots/table.html) | Searchable, sortable, filterable data browser with CSV export |
| [🧫 Wellplate Analyzer](https://sauravbhattacharya001.github.io/BioBots/wellplate.html) | Performance breakdown by wellplate format |
| [🧫 Plate Designer](https://sauravbhattacharya001.github.io/BioBots/plate-designer.html) | Plate layout designer for experiment planning |
| [🔄 Unit Converter](https://sauravbhattacharya001.github.io/BioBots/unit-converter.html) | Bioprinting unit converter |
| [📖 Glossary](https://sauravbhattacharya001.github.io/BioBots/glossary.html) | Bioprinting terminology reference |
| [🎬 Simulator](https://sauravbhattacharya001.github.io/BioBots/simulator.html) | Print timeline simulator |
| [🧬 Print Fingerprint](https://sauravbhattacharya001.github.io/BioBots/fingerprint.html) | Print DNA fingerprinting for unique run identification |
| [🎓 Training Tracker](https://sauravbhattacharya001.github.io/BioBots/training.html) | Lab personnel training and certification tracking |
| [🔍 Search Hub](https://sauravbhattacharya001.github.io/BioBots/hub.html) | Unified search and navigation across all tools |
| [🔌 API Explorer](https://sauravbhattacharya001.github.io/BioBots/api.html) | Interactive REST API documentation and testing |
| [📚 Developer Guide](https://sauravbhattacharya001.github.io/BioBots/guide.html) | Setup, testing, and contributing reference |
| [🏛️ Architecture](https://sauravbhattacharya001.github.io/BioBots/architecture.html) | System architecture diagram |

</details>

---

## 📦 SDK — npm Package

The `@sauravbhattacharya001/biobots` package ships **80 factory functions** for bioprinting computation — material calculations, rheology modeling, cell viability estimation, GCode analysis, and more.

```bash
npm install @sauravbhattacharya001/biobots
```

All modules are **lazy-loaded** — only the factories you call are loaded from disk, keeping `require()` startup fast.

### Quick Examples

```js
const biobots = require('@sauravbhattacharya001/biobots');

// Material usage estimation
const calc = biobots.createMaterialCalculator();
const usage = calc.calculateUsage({
  wellplate: 24, layerHeight: 0.2, layerNum: 10,
  materialKey: 'alginate', infillPercent: 80, wastePercent: 15
});
console.log(usage.totalVolumeMl, usage.estimatedCost);

// Rheology modeling (Power Law)
const rheo = biobots.createRheologyModeler();
const viscosity = rheo.powerLaw(100, { K: 50, n: 0.4 }); // η at γ̇ = 100 s⁻¹
const window = rheo.printabilityWindow({ K: 50, n: 0.4 });

// Cell viability estimation
const viability = biobots.createViabilityEstimator();
const result = viability.estimate({
  shearStress: 5.0,   // kPa
  duration: 120,       // seconds
  cellType: 'HeLa'
});
console.log(result.estimatedViability); // percentage

// GCode toolpath analysis
const gcode = biobots.createGCodeAnalyzer();
const analysis = gcode.analyze('G1 X10 Y20 Z0.2 E5 F1200\nG1 X30 Y20');
console.log(analysis.totalDistance, analysis.layerCount);

// Discover all available factories
console.log(biobots.listFactories()); // sorted array of 80 names
console.log(biobots.factoryCount);     // 80
```

### Factory Categories

| Category | Factories | Examples |
|----------|-----------|----------|
| **Material Science** | 12 | `createMaterialCalculator`, `createBioinkMixer`, `createCompatibilityMatrix`, `createShelfLifeManager` |
| **Print Engineering** | 10 | `createGCodeAnalyzer`, `createScaffoldCalculator`, `createNozzleAdvisor`, `createRecipeBuilder` |
| **Cell Biology** | 8 | `createViabilityEstimator`, `createCellSeedingCalculator`, `createPassageTracker`, `createGrowthCurveAnalyzer` |
| **Rheology & Physics** | 5 | `createRheologyModeler`, `createCrosslinkAnalyzer`, `createElectroporationCalculator` |
| **Lab Operations** | 15 | `createLabInventoryManager`, `createWasteTracker`, `createEnvironmentalMonitor`, `createSterilityAssurance` |
| **Quality & Analysis** | 12 | `createPrintQualityScorer`, `createYieldAnalyzer`, `createCapabilityAnalyzer`, `createDriftDetector` |
| **Data & Export** | 8 | `createDataExporter`, `createPrintSessionLogger`, `createSampleTracker`, `createDilutionCalculator` |
| **Automation** | 10 | `createProtocolGenerator`, `createJobEstimator`, `createMediaPrepCalculator`, `createCentrifugeCalculator` |

---

## 📡 REST API

The ASP.NET Web API reads bioprinting data from a JSON dataset and exposes RESTful endpoints for statistical queries.

### Endpoint Pattern

```
GET /api/prints/{metric}/{comparison}/{value}
```

### Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `livePercent` | double | Cell viability — % alive (live/dead imaging) |
| `deadPercent` | double | Cell mortality — % dead |
| `elasticity` | double | Structural rigidity (kPa) |
| `cl_duration` | int | Photocrosslinking duration (ms) |
| `cl_intensity` | int | Photocrosslinking light intensity (%) |
| `extruder1` / `extruder2` | double | Extruder pressure at print time |
| `layerHeight` | double | Height per layer (mm) |
| `layerNum` | int | Total layer count |
| `wellplate` | int | Wellplate type |
| `serial` | int | BioBot 1 serial number |

### Comparisons & Aggregations

| Comparison | Description |
|------------|-------------|
| `greater` / `lesser` / `equal` | Count where metric matches condition |

Pass `Maximum`, `Minimum`, or `Average` as the value for aggregation queries:

```bash
# Prints with >50% cell viability
GET /api/prints/livePercent/greater/50

# Maximum layer count
GET /api/prints/layerNum/greater/Maximum

# Average elasticity
GET /api/prints/elasticity/greater/Average
```

---

## 🏗️ Architecture

```
BioBots/
├── docs/                      # 87 client-side analysis tools (GitHub Pages)
│   ├── shared/                # 80 SDK computation modules
│   ├── index.html             # Dashboard entry point
│   └── *.html                 # Individual tool pages
├── Try/                       # ASP.NET Web API backend
│   ├── Controllers/
│   │   └── PrintsController.cs    # REST API with 11 metric endpoints
│   ├── Models/
│   │   └── Print.cs               # Data models
│   └── Web.config
├── __tests__/                 # 146 Jest test files
├── tests/                     # Additional test modules
├── src/                       # Python analysis scripts
├── index.js                   # npm SDK entry — lazy-loaded factory manifest
├── index.d.ts                 # TypeScript type definitions
├── bioprint-data.json         # Sample dataset
└── BioBotsTool.sln            # .NET solution file
```

### Key Design Decisions

- **Thread-safe caching** — Double-checked locking for concurrent request safety
- **File-watch reload** — Checks `LastWriteTimeUtc` on each request; re-parses only when changed
- **Null-safe filtering** — Records with missing nested objects are skipped with trace warnings
- **Float equality** — Epsilon-based comparison (`1e-9`) for IEEE 754 precision
- **Lazy SDK loading** — Factory modules loaded on first access, not at `require()` time

---

## 🔧 Development

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18 (for SDK and tests)
- [Visual Studio 2015+](https://visualstudio.microsoft.com/) with ASP.NET workload (for REST API)
- .NET Framework 4.x (for REST API)

### Running Tests

```bash
npm install

# Full suite with coverage
npm test

# Watch mode
npx jest --watch

# Single file
npx jest __tests__/calculator.test.js

# Coverage thresholds (branches: 60%, functions/lines/statements: 70%)
npm run coverage:check
```

### Running the REST API

1. Open `BioBotsTool.sln` in Visual Studio
2. Press <kbd>F5</kbd> to start the development server
3. Navigate to `http://localhost:{port}/index.html`

### Previewing Analysis Tools Locally

```bash
npx http-server docs -p 8000
# Open http://localhost:8000
```

### Custom Data File

Add to `Web.config`:
```xml
<appSettings>
  <add key="DataFilePath" value="C:\path\to\your\bioprint-data.json" />
</appSettings>
```

The data file is watched — edits are picked up automatically.

---

## 🚀 Deployment

### Docker

```bash
docker pull ghcr.io/sauravbhattacharya001/biobots-tool:latest
docker run -p 8080:80 ghcr.io/sauravbhattacharya001/biobots-tool:latest
```

### NuGet (GitHub Packages)

The `BioBots.Models` package provides data model classes for .NET projects:

```bash
dotnet nuget add source https://nuget.pkg.github.com/sauravbhattacharya001/index.json \
  --name github-biobots --username YOUR_GITHUB_USERNAME --password YOUR_GITHUB_PAT

dotnet add package BioBots.Models
```

---

## ❓ Troubleshooting

| Problem | Solution |
|---------|----------|
| API returns empty results | Verify `bioprint-data.json` exists and is valid JSON |
| Analysis tools show "No data" | Tools load `bioprint-data.json` via relative path — ensure the file is present |
| Tests fail with `document is not defined` | Run `npm install` — jsdom is required for DOM-dependent tests |
| Docker container won't start | Requires Windows containers (`.NET Framework 4.x`) — use `--isolation=hyperv` on Win 10/11 |
| NuGet auth fails | GitHub Packages requires a PAT with `read:packages` scope |

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, [ARCHITECTURE.md](ARCHITECTURE.md) for system design, or the [Developer Guide](https://sauravbhattacharya001.github.io/BioBots/guide.html) for setup instructions.

## 📄 License

[MIT](LICENSE) — Saurav Bhattacharya

## 👤 Author

**Saurav Bhattacharya** — [@sauravbhattacharya001](https://github.com/sauravbhattacharya001)
