# BioBots Tool — Copilot Instructions

## Project Overview

BioBots Tool is a REST API and interactive web frontend for querying BioBot 1 3D bioprinter run statistics. It lets users analyze print data across 11 metrics including cell viability (live/dead percentages), structural rigidity (elasticity), crosslinking parameters, extruder pressures, and print resolution.

## Tech Stack

- **Framework:** ASP.NET Web API 2 on .NET Framework 4.5.2
- **Language:** C# (backend) + JavaScript (frontend)
- **Build:** MSBuild + NuGet (not .NET Core — uses `packages.config`, not PackageReference)
- **Data:** JSON file (`bioprint-data.json`) stream-deserialized via Newtonsoft.Json into typed models
- **Frontend tests:** Jest + jsdom (3342 tests across 64 suites with coverage thresholds)
- **Python module:** `evolution_tracker.py` — population genetics analysis with pytest tests
- **Hosting:** IIS Express (development) / IIS (production) / GitHub Pages (docs site)

## Project Structure

```
BioBotsTool.sln              # Visual Studio solution
bioprint-data.json           # Print data (JSON array, ~8MB)
package.json                 # npm config for Jest test suite
codecov.yml                  # Codecov coverage configuration

Try/                         # Main web project ("BioBots 1 tool.csproj")
  Controllers/
    PrintsController.cs      # Single API controller — unified MetricRegistry
  Models/
    Print.cs                 # Data models (Print, UserInfo, PrintInfo, PrintData, etc.)
  Filters/
    GlobalExceptionFilter.cs # Global exception handling (maps exceptions → HTTP status codes)
  App_Start/
    WebApiConfig.cs          # Route configuration + exception filter registration
  Global.asax(.cs)           # Application startup
  Web.config                 # Configuration (appSettings, connection strings)
  packages.config            # NuGet package manifest
  scripts/                   # 23 bioprinting modules
    runMethod.js             # Frontend API query client (jQuery, CommonJS-exportable for testing)
    cellSeeding.js           # Cell seeding & density calculator
    costEstimator.js         # Bioprint cost estimator
    failureDiagnostic.js     # Print failure diagnostic system
    labAuditTrail.js         # Hash-chained audit trail
    mlDiagnostic.js          # ML-based failure pattern recognition
    parameterOptimizer.js    # Print parameter optimizer
    printQueue.js            # Print queue manager
    protocolLibrary.js       # Protocol template library
    riskAssessor.js          # Print risk assessor
    vascularization.js       # Vascularization planner
    ... 12 more modules      # See docs/architecture.html
  index.html                 # Original landing page

docs/                        # GitHub Pages documentation site (42 pages)
  index.html                 # Landing page / dashboard hub
  shared/                    # 11 core computation modules
    calculator.js            # Bioink volume & cost calculator
    constants.js             # Physical constants & defaults
    crosslink.js             # Cross-linking kinetics analyzer
    data-loader.js           # Dataset loading & validation
    export.js                # CSV/JSON/PDF export utilities
    gcode.js                 # G-code parser & print analyzer
    mixer.js                 # Bioink mixing ratio optimizer
    passage.js               # Cell passage tracker
    rheology.js              # Bioink rheology modeler
    utils.js                 # DOM helpers, formatting, rounding
    viability.js             # Cell viability estimator
  *.html                     # 42 dashboard pages (see Architecture)
  bioprint-data.json         # Sample print dataset
  style.css                  # Shared styles

__tests__/                   # Jest test suite
  runMethod.test.js          # 87+ tests: isNumeric, setButtonsEnabled, runMethod (URL construction, validation, response handling)
  compare.test.js            # 40+ tests: METRICS, formatNum, selection manager, search, radar normalization, insights
  quality.test.js            # 100+ tests: quality scoring, grading, Pearson correlation, optimal ranges, edge cases
```

## Architecture

### Backend — Unified MetricRegistry Pattern

The controller uses a **MetricRegistry** dictionary mapping metric names to `MetricDescriptor` objects (selector function + integer/double type). This means:

- **Single endpoint:** `GET /api/prints/{metric}/{arithmetic}/{param}` handles all 11 metrics
- **One-line addition:** Adding a new metric requires only one line in `MetricRegistry`
- **Pre-computed stats:** Min/max/average are calculated once at cache load time → O(1) aggregation queries
- **Comparison queries:** Scan the array → O(n) but fast for the dataset size

```csharp
// MetricRegistry in PrintsController.cs — single source of truth
private static readonly Dictionary<string, MetricDescriptor> MetricRegistry = new Dictionary<string, MetricDescriptor>
{
    { "serial",       new MetricDescriptor(p => p.user_info.serial,                    isInteger: true)  },
    { "livePercent",  new MetricDescriptor(p => p.print_data.livePercent,              isInteger: false) },
    // ... 9 more metrics
};
```

### Caching

- **File-timestamp cache invalidation:** `File.GetLastWriteTimeUtc()` checked on every request (cheap I/O); full JSON reload only when timestamp changes
- **Double-checked locking:** Thread-safe cache rebuilding via `lock (_cacheLock)` with volatile field
- **Streaming deserialization:** `JsonTextReader` streams from file → ~50% lower peak memory vs loading entire string
- **Null-record filtering:** Records missing nested objects are filtered at load time with `Trace.TraceWarning`

### Error Handling

- `GlobalExceptionFilter` catches all unhandled exceptions
- Maps `FileNotFoundException` → 404, `ArgumentException` → 400, everything else → 500
- Internal details (stack traces) logged via `Trace`, never exposed to clients
- `QueryMetric()` validates arithmetic operators and numeric params before processing

### Frontend Architecture

- **Self-contained HTML pages:** Each page in `docs/` includes all CSS and JS inline — no build step
- **CSS custom properties:** Dark theme using `:root` variables
- **Canvas charts:** Direct 2D context rendering (no charting libraries)
- **Client-side data:** Pages load `bioprint-data.json` via `fetch()` and process entirely client-side

## Building

```bash
# Restore NuGet packages
nuget restore BioBotsTool.sln

# Build
msbuild BioBotsTool.sln /p:Configuration=Release /p:Platform="Any CPU"

# The project runs on IIS Express (port 56277) or IIS
```

## Testing

### JavaScript Test Suite

```bash
# Install dependencies
npm install

# Run all tests with coverage
npm test

# Run with detailed coverage report (HTML + LCOV + JSON)
npm run coverage

# Check coverage thresholds (70% lines, 60% branches)
npm run coverage:check

# Run a specific test file
npx jest __tests__/runMethod.test.js --verbose

# Watch mode
npx jest --watch
```

**Coverage thresholds** (enforced in `package.json`):
- Branches: 60%
- Functions: 70%
- Lines: 70%
- Statements: 70%

### Test Files

| Category | Files | What They Cover |
|----------|-------|-----------------|
| **Core API** | `runMethod`, `utils`, `constants`, `shared`, `data-loader` | API query client, DOM helpers, formatting, constants, data loading |
| **Analysis** | `compare`, `trends`, `correlation`, `cluster`, `predictor`, `recommender`, `pareto`, `optimizer`, `doe` | Statistical analysis, comparison, optimization, design of experiments |
| **Quality** | `quality`, `spc`, `anomaly`, `reproducibility`, `batch`, `batchStats` | Quality scoring, SPC charting, anomaly detection, batch stats |
| **Shared Modules** | `calculator`, `crosslink`, `gcode`, `rheology`, `viability`, `export`, `mixer`, `passage` | Bioink computation, G-code parsing, rheology, viability, export |
| **Bioprinting** | `porosity`, `layerAdhesion`, `vascularization`, `maturation`, `degradation`, `scaffold` | Physical simulation modules |
| **Lab Ops** | `printQueue`, `protocolLibrary`, `sessionLogger`, `labAuditTrail`, `riskAssessor`, `cellSeeding` | Queue management, protocols, audit trail, risk assessment |
| **Diagnostics** | `failureDiagnostic`, `mlDiagnostic`, `mlDiagnostic-extended`, `mlDiagnosticDeep`, `failure` | Print failure diagnosis, ML pattern recognition |
| **Materials** | `compatibility`, `formulationCalculator`, `costEstimator`, `shelfLife`, `sterilization`, `waste` | Material compatibility, cost, shelf life, sterilization |
| **Infrastructure** | `nozzlePlanner`, `environment`, `maintenance`, `calibration`, `scriptUtils` | Nozzle coordination, environment monitoring, calibration |
| **Dashboards** | `index`, `table`, `explorer`, `profile`, `coverage`, `wellplate`, `logbook` | Dashboard page logic |

**64 test files, 3342 tests** across all modules (as of March 2026).

### Manual Testing Checklist

- [ ] API returns correct results for each of the 11 metrics
- [ ] All 3 aggregation functions work (Maximum, Minimum, Average)
- [ ] Invalid parameters return appropriate error responses (400/404)
- [ ] All 8 docs site pages load and function correctly
- [ ] Data file changes are picked up without restart

## Key Conventions

1. **Naming:** Standard C# conventions — PascalCase for methods/classes, camelCase for JSON properties and JS
2. **Error handling:** `GlobalExceptionFilter` maps exception types to HTTP status codes; internal details never exposed
3. **Data file path:** Configurable via `DataFilePath` in `<appSettings>` of `Web.config`; defaults to `bioprint-data.json` in app root
4. **Floating-point equality:** Uses epsilon comparison (`1e-9`) for double equality checks
5. **CommonJS exports:** `runMethod.js` conditionally exports functions for testing (`typeof module !== 'undefined'`)
6. **XSS prevention:** Docs site pages use `escapeHtml()` for any user-facing data rendering

## Key Dependencies

- `Microsoft.AspNet.WebApi` 5.2.3 — Web API framework
- `Newtonsoft.Json` 6.0.4 — JSON streaming deserialization
- `Microsoft.ApplicationInsights` 2.1.0 — Telemetry/monitoring
- `jest` ^30.2.0 — Frontend test runner (devDependency)
- `jest-environment-jsdom` ^30.2.0 — Browser-like test environment (devDependency)

## What to Watch Out For

- **MetricRegistry is the single source of truth:** Don't add separate endpoint methods. Add metrics to the registry dictionary only.
- **Pre-computed stats are rebuilt on cache reload:** If you change how metrics are computed, stats are updated automatically.
- **Streaming deserialization:** The data file is read via `JsonTextReader`, not loaded as a string. Keep this pattern for memory efficiency.
- **Null-record filtering happens at load time:** All queries can safely assume nested objects are non-null.
- **Frontend pages are self-contained:** Each HTML file bundles its own CSS/JS. When adding features, keep this pattern (no shared JS bundles).
- **Test jQuery mock pattern:** `runMethod.test.js` creates a custom jQuery mock before loading the module. See the mock implementation if you need to test additional jQuery interactions.

## Security Considerations

- **GlobalExceptionFilter** prevents internal details (stack traces, file paths) from leaking to API clients
- **Input validation:** `QueryMetric()` validates arithmetic operators against a whitelist (`ValidArithmetic` HashSet) and uses `double.TryParse` for numeric params
- **No SQL injection risk:** The app uses file-based data, not a database
- **XSS prevention:** Docs site pages escape HTML in user-facing content via `escapeHtml()`
- **Client-side data only:** The docs site processes data entirely client-side; no server-side user input handling
