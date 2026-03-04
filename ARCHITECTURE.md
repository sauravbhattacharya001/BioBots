# Architecture

Technical overview of the BioBots Tool codebase — a browser-based bioprinting analytics platform.

## Project Structure

```
BioBots/
├── docs/                    # GitHub Pages site (HTML + shared JS)
│   ├── index.html           # Landing page / dashboard hub
│   ├── shared/              # Core computation modules
│   │   ├── calculator.js    # Bioink volume & cost calculator
│   │   ├── constants.js     # Shared constants & defaults
│   │   ├── crosslink.js     # Cross-linking kinetics analyzer
│   │   ├── export.js        # CSV/JSON/PDF export utilities
│   │   ├── gcode.js         # G-code parser & print analyzer
│   │   ├── rheology.js      # Bioink rheology modeler
│   │   ├── utils.js         # DOM helpers, formatting, rounding
│   │   └── viability.js     # Cell viability estimator
│   ├── *.html               # Dashboard pages (27 pages)
│   └── bioprint-data.json   # Sample print dataset
├── __tests__/               # Jest test suite (31 files, ~16k lines)
├── tests/                   # Assert-based tests (viability)
├── src/                     # Source entry point
└── Try/                     # Experimental prototypes
```

## Architecture Layers

### 1. Shared Computation Layer (`docs/shared/`)

Pure-function JavaScript modules with no DOM dependencies. Each module uses
the revealing module pattern (`function createXxx() { ... return { ... }; }`)
for encapsulation and testability.

| Module | Factory | Purpose | Functions |
|--------|---------|---------|-----------|
| `calculator.js` | `createCalculator()` | Bioink volume, cost, time estimation | 9 |
| `constants.js` | (exports) | Physical constants, material defaults | — |
| `crosslink.js` | `createCrosslinkAnalyzer()` | UV/radical cross-linking kinetics | 12 |
| `export.js` | `createExporter()` | Multi-format data export (CSV/JSON/PDF) | 8 |
| `gcode.js` | `createGCodeAnalyzer()` | G-code parsing, layer analysis, costing | 11 |
| `rheology.js` | `createRheologyModeler()` | Viscosity models, printability scoring | 11 |
| `utils.js` | (exports) | DOM helpers, number formatting | 5 |
| `viability.js` | `createViabilityEstimator()` | Multi-stressor cell survival modeling | 9 |

**Key design decisions:**
- All computation is client-side — no server required
- Modules are loaded via `<script>` tags and accessed as globals
- Each module validates inputs and throws descriptive errors
- State is kept in closures; no global mutation

### 2. Dashboard Layer (`docs/*.html`)

27 single-page HTML dashboards, each focused on one analysis domain. Pages
load shared modules via `<script>` and use vanilla JavaScript for interactivity.

| Category | Pages | Description |
|----------|-------|-------------|
| **Data Management** | `table`, `explorer`, `api` | View, filter, search print records |
| **Analysis** | `trends`, `correlation`, `cluster`, `compare` | Statistical analysis of print data |
| **Quality** | `quality`, `spc`, `anomaly`, `reproducibility` | Quality control & SPC charting |
| **Optimization** | `optimizer`, `predictor`, `recommender`, `pareto` | Parameter optimization & prediction |
| **Calibration** | `calibration`, `doe` | Guided calibration, design of experiments |
| **Bioprinting** | `calculator`, `failure`, `protocol`, `profile` | Print planning & protocol management |
| **Reports** | `report`, `coverage`, `evolution` | Report generation & coverage tracking |
| **Well Plates** | `wellplate` | 96-well plate layout & analysis |
| **Reference** | `guide`, `architecture` | User guide & architecture diagram |

**UI patterns:**
- CSS variables for theming (light/dark mode)
- Canvas-based charts (no external charting library)
- LocalStorage for user preferences and saved protocols
- Responsive layout with sidebar navigation

### 3. Test Layer

**Jest suite** (`__tests__/`, 31 files): Tests for all shared modules plus
HTML dashboard logic extracted into testable functions. Uses `jsdom`
environment for DOM-dependent tests.

**Assert suite** (`tests/`, 1 file): Standalone `node`-runnable test for the
viability estimator (72 tests) using Node's built-in `assert` module.

**Running tests:**
```bash
npm test                    # Jest (all 1736+ tests)
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
             ├── crosslink.js
             ├── gcode.js
             ├── rheology.js
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
| Optimization | `viability.js` | Grid-search calibration with RMSE minimization |
| Anomaly detection | Dashboard | Z-score and IQR-based outlier detection |
| Clustering | Dashboard | K-means with silhouette scoring |
| SPC | Dashboard | X-bar/R charts, Western Electric rules |

## Deployment

The site is deployed via **GitHub Pages** from the `docs/` directory. No build
step required — all assets are static HTML/JS/CSS served directly.

**CI/CD pipeline** (`.github/workflows/`):
- `ci.yml`: Jest tests on every push/PR
- `codeql.yml`: Security scanning
- `pages.yml`: GitHub Pages deployment

## Contributing

New analysis modules should follow the existing pattern:

1. Create `docs/shared/my-module.js` using the revealing module pattern
2. Create `__tests__/my-module.test.js` with comprehensive tests
3. Create `docs/my-module.html` dashboard page
4. Update `CHANGELOG.md` under `[Unreleased]`
5. Update the module table in this document
