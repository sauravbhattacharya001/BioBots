# Architecture

Technical overview of the BioBots Tool codebase — a browser-based bioprinting analytics platform.

## Project Structure

```
BioBots/
├── docs/                    # GitHub Pages site (HTML + shared JS)
│   ├── index.html           # Landing page / dashboard hub
│   ├── shared/              # Core computation modules (14 modules)
│   │   ├── calculator.js    # Bioink volume & cost calculator
│   │   ├── capability.js    # Six Sigma process capability (Cp/Cpk/Pp/Ppk)
│   │   ├── constants.js     # Shared constants & defaults
│   │   ├── crosslink.js     # Cross-linking kinetics analyzer
│   │   ├── data-loader.js   # Dataset loading, validation, caching
│   │   ├── export.js        # CSV/JSON/PDF export utilities
│   │   ├── gcode.js         # G-code parser & print analyzer
│   │   ├── jobEstimator.js  # Print job time/material/cost/risk planner
│   │   ├── mixer.js         # Bioink mixing ratio optimization
│   │   ├── passage.js       # Cell passage tracking & growth curves
│   │   ├── rheology.js      # Bioink rheology modeler
│   │   ├── scaffold.js      # Scaffold geometry, porosity, mechanics
│   │   ├── utils.js         # DOM helpers, formatting, rounding
│   │   └── viability.js     # Cell viability estimator
│   ├── *.html               # Dashboard pages (45 pages)
│   └── bioprint-data.json   # Sample print dataset
├── __tests__/               # Jest test suite (74 files)
├── tests/                   # Assert-based tests (viability)
├── Try/                     # ASP.NET Web API project
│   └── scripts/             # 27 bioprinting simulation modules
└── src/                     # Source entry point
```

## Architecture Layers

### 1. Shared Computation Layer (`docs/shared/`)

Pure-function JavaScript modules with no DOM dependencies. Each module uses
the revealing module pattern (`function createXxx() { ... return { ... }; }`)
for encapsulation and testability.

| Module | Factory | Purpose | Functions |
|--------|---------|---------|-----------|
| `calculator.js` | `createCalculator()` | Bioink volume, cost, time estimation | 9 |
| `capability.js` | `createCapabilityAnalyzer()` | Six Sigma Cp/Cpk/Pp/Ppk process capability analysis | 2 |
| `constants.js` | (exports) | Physical constants, material defaults | — |
| `crosslink.js` | `createCrosslinkAnalyzer()` | UV/radical cross-linking kinetics | 12 |
| `data-loader.js` | `createDataLoader()` | Dataset loading, validation, caching | 6 |
| `export.js` | `createExporter()` | Multi-format data export (CSV/JSON/PDF) | 8 |
| `gcode.js` | `createGCodeAnalyzer()` | G-code parsing, layer analysis, costing | 11 |
| `jobEstimator.js` | `createJobEstimator()` | Print job time/material/cost/risk estimation & batch planning | 8 |
| `mixer.js` | `createMixer()` | Bioink mixing ratio optimization | 7 |
| `passage.js` | `createPassageTracker()` | Cell passage tracking & growth curves | 8 |
| `rheology.js` | `createRheologyModeler()` | Viscosity models, printability scoring | 11 |
| `scaffold.js` | `createScaffoldCalculator()` | Scaffold geometry, porosity, surface area, mechanical estimates | 4 |
| `utils.js` | (exports) | DOM helpers, number formatting | 5 |
| `viability.js` | `createViabilityEstimator()` | Multi-stressor cell survival modeling | 9 |

**Key design decisions:**
- All computation is client-side — no server required
- Modules are loaded via `<script>` tags and accessed as globals
- Each module validates inputs and throws descriptive errors
- State is kept in closures; no global mutation

### 2. Dashboard Layer (`docs/*.html`)

45 single-page HTML dashboards, each focused on one analysis domain. Pages
load shared modules via `<script>` and use vanilla JavaScript for interactivity.

| Category | Pages | Description |
|----------|-------|-------------|
| **Data Management** | `table`, `explorer`, `api`, `logbook` | View, filter, search, and log print records |
| **Analysis** | `trends`, `correlation`, `cluster`, `compare`, `batch` | Statistical analysis, comparison, batch analytics |
| **Quality** | `quality`, `spc`, `anomaly`, `reproducibility` | Quality control, SPC charting, reproducibility scoring |
| **Optimization** | `optimizer`, `predictor`, `recommender`, `pareto`, `doe` | Parameter optimization, prediction, design of experiments |
| **Calibration** | `calibration`, `nozzle` | Guided calibration, nozzle coordination |
| **Bioprinting** | `calculator`, `failure`, `protocol`, `profile`, `scaffold`, `queue` | Print planning, protocols, scaffold analysis, job queue |
| **Materials** | `materials`, `mixer`, `rheology`, `shelf-life`, `sterilization`, `waste` | Material database, mixing, rheology, shelf life, waste tracking |
| **Simulation** | `environment`, `maintenance`, `cost` | Environment monitoring, maintenance scheduling, cost estimation |
| **Reports** | `report`, `coverage`, `evolution` | Report generation, coverage tracking, evolution analysis |
| **Well Plates** | `wellplate` | 96-well plate layout & analysis |
| **Reference** | `guide`, `architecture` | User guide & architecture diagram |

**UI patterns:**
- CSS variables for theming (light/dark mode)
- Canvas-based charts (no external charting library)
- LocalStorage for user preferences and saved protocols
- Responsive layout with sidebar navigation

### 3. Simulation Layer (`Try/scripts/`)

27 standalone Node.js modules implementing bioprinting simulations and lab
operations. Each exports a factory function returning domain-specific methods.

| Category | Scripts | Description |
|----------|---------|-------------|
| **Bio Simulation** | `porosity`, `layerAdhesion`, `vascularization`, `maturation`, `degradation`, `cellSeeding` | Physical/biological process models |
| **Materials** | `compatibility`, `formulationCalculator`, `costEstimator`, `shelfLife`, `sterilization` | Material science computations |
| **Lab Operations** | `printQueue`, `protocolLibrary`, `sessionLogger`, `labAuditTrail`, `riskAssessor` | Lab workflow management |
| **Diagnostics** | `failureDiagnostic`, `mlDiagnostic`, `healthDashboard` | Print failure analysis and ML-based diagnostics |
| **Planning** | `nozzlePlanner`, `printComparator`, `parameterOptimizer`, `scriptUtils`, `runMethod` | Print planning and parameter optimization |
| **Tracking** | `contaminationTracker`, `experimentTracker`, `materialLotTracker` | Contamination, experiment, and material lot tracking |

### 4. Test Layer

**Jest suite** (`__tests__/`, 74 files): Tests for all shared modules,
simulation scripts, and dashboard logic. Uses `--env node` for pure
computation tests. Organized by category:

| Category | Test Files | Coverage |
|----------|-----------|----------|
| Core API & Utils | 5 | `runMethod`, `utils`, `constants`, `shared`, `data-loader` |
| Shared Modules | 11 | `calculator`, `capability`, `crosslink`, `gcode`, `rheology`, `viability`, `export`, `mixer`, `passage`, `jobEstimator`, `scaffold` |
| Analysis | 9 | `compare`, `trends`, `correlation`, `cluster`, `predictor`, `recommender`, `pareto`, `optimizer`, `doe` |
| Quality & SPC | 7 | `quality`, `spc`, `anomaly`, `reproducibility`, `batch`, `batchStats`, `compliance` |
| Bioprinting Sim | 6 | `porosity`, `layerAdhesion`, `vascularization`, `maturation`, `degradation`, `cellSeeding` |
| Lab Operations | 7 | `printQueue`, `protocolLibrary`, `protocol`, `sessionLogger`, `labAuditTrail`, `riskAssessor`, `scriptUtils` |
| Diagnostics | 5 | `failureDiagnostic`, `mlDiagnostic`, `mlDiagnostic-extended`, `mlDiagnosticDeep`, `failure` |
| Materials | 7 | `compatibility`, `formulationCalculator`, `costEstimator`, `shelfLife`, `sterilization`, `waste`, `materialLotTracker` |
| Infrastructure | 6 | `nozzlePlanner`, `environment`, `maintenance`, `calibration`, `printComparator`, `toolpath` |
| Dashboards | 8 | `index`, `table`, `explorer`, `profile`, `coverage`, `wellplate`, `logbook`, `shelfLifeDashboard` |
| Tracking | 2 | `contaminationTracker`, `experimentTracker` |
| Security | 3 | `logbook-xss`, `passage-csv-security`, `healthDashboard` |
| Parameter Opt. | 1 | `parameterOptimizer` |

**Assert suite** (`tests/`, 1 file): Standalone `node`-runnable test for the
viability estimator (72 tests) using Node's built-in `assert` module.

**Running tests:**
```bash
npx jest --env node         # Jest (all 74 suites)
node tests/viability.test.js  # Assert-based viability tests
```

## Data Flow

```
bioprint-data.json ──► HTML dashboards ──► Shared modules
       │                     │                    │
       │                     ▼                    ▼
       │               DOM rendering        Pure computation
       │                     │                    │
       ▼                     ▼                    ▼
  LocalStorage ◄── User interactions ──► Export (CSV/JSON/PDF)
```

1. **Input:** Print data loaded from `bioprint-data.json` or user uploads
2. **Processing:** Shared modules compute metrics (viability, rheology, etc.)
3. **Output:** Results rendered to DOM, exportable in multiple formats
4. **Persistence:** User preferences and protocols saved to LocalStorage

## Module Dependency Graph

```
index.html ─┬── calculator.js ◄── constants.js
             ├── capability.js
             ├── crosslink.js
             ├── gcode.js
             ├── jobEstimator.js
             ├── rheology.js
             ├── scaffold.js
             ├── viability.js
             ├── export.js ◄── utils.js
             └── utils.js
```

Modules are deliberately independent — no circular dependencies. `utils.js`
and `constants.js` are the only shared dependencies.

## Key Algorithms

| Algorithm | Module | Technique |
|-----------|--------|-----------|
| Cell viability | `viability.js` | Multiplicative 5-stressor model (Hill equations) |
| Cross-linking | `crosslink.js` | First-order kinetics + dose-response curves |
| Rheology | `rheology.js` | Power-law, Carreau, Herschel-Bulkley models |
| Process capability | `capability.js` | Six Sigma Cp/Cpk (within-batch) and Pp/Ppk (overall) |
| Job estimation | `jobEstimator.js` | Multi-factor time/cost/risk with batch planning |
| Scaffold geometry | `scaffold.js` | Grid, honeycomb, gyroid architecture models |
| Optimization | `viability.js` | Grid-search calibration with RMSE minimization |
| Anomaly detection | Dashboard | Z-score and IQR-based outlier detection |
| Clustering | Dashboard | K-means with silhouette scoring |
| SPC | Dashboard | X-bar/R charts, Western Electric rules |

## Deployment

The site is deployed via **GitHub Pages** from the `docs/` directory. No build
step required — all assets are static HTML/JS/CSS served directly.

**CI/CD pipeline** (`.github/workflows/`):
- `ci.yml`: Jest tests + .NET build on every push/PR
- `coverage.yml`: Code coverage with threshold enforcement
- `codeql.yml`: Security scanning (JavaScript + C#)
- `docker.yml`: Docker image build & push
- `npm-publish.yml`: npm package publishing
- `nuget-publish.yml`: NuGet package publishing
- `auto-labeler.yml`: Automatic PR labeling
- `pages.yml`: GitHub Pages deployment

## Contributing

New analysis modules should follow the existing pattern:

1. Create `docs/shared/my-module.js` using the revealing module pattern
2. Create `__tests__/my-module.test.js` with comprehensive tests
3. Create `docs/my-module.html` dashboard page
4. Update `CHANGELOG.md` under `[Unreleased]`
5. Update the module table in this document
