# Contributing to BioBots Tool

Thanks for considering contributing to BioBots Tool! Whether it's a bug fix, new metric, better docs, or a performance improvement — contributions are welcome.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [How to Contribute](#how-to-contribute)
- [Coding Standards](#coding-standards)
- [Adding a New Metric](#adding-a-new-metric)
- [Testing](#testing)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)

## Getting Started

1. **Fork** this repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/<your-username>/BioBots.git
   cd BioBots
   ```
3. **Create a branch** for your work:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Development Setup

### Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| Visual Studio | 2015+ | C# backend development |
| .NET Framework | 4.x | Runtime |
| Node.js | 18+ | Running JavaScript tests |
| npm | 9+ | Package management |
| Git | 2.x | Source control |
| Docker | (optional) | Container builds |

### Running Locally

1. Open `BioBotsTool.sln` in Visual Studio
2. Restore NuGet packages (should happen automatically)
3. Press **F5** (debug) or **Ctrl+F5** (without debugger) to start the dev server
4. Open `http://localhost:{port}/index.html` for the web interface
5. Test API endpoints at `http://localhost:{port}/api/prints/{metric}/{comparison}/{value}`

### Frontend / Docs Site Preview

To preview the docs site (GitHub Pages) locally without the backend:

```bash
# Using Python
cd docs && python -m http.server 8080

# Using Node.js
npx serve docs

# Using PHP
php -S localhost:8080 -t docs
```

### Data File

The app reads from `bioprint-data.json` in the project root. To use a custom file, set the `DataFilePath` key in `Try/Web.config`:

```xml
<appSettings>
  <add key="DataFilePath" value="C:\path\to\your\data.json" />
</appSettings>
```

The file is watched — changes are picked up automatically without restart.

## Project Structure

```
BioBotsTool.sln                     # Visual Studio solution
bioprint-data.json                  # Bioprinting dataset (~8MB JSON array)
package.json                        # npm config for Jest test suite
codecov.yml                         # Codecov coverage configuration

Try/                                # Main web project
├── Controllers/
│   └── PrintsController.cs         # REST API — unified MetricRegistry pattern
├── Models/
│   └── Print.cs                    # Data models (Print, UserInfo, PrintData, etc.)
├── Filters/
│   └── GlobalExceptionFilter.cs    # Global error handling → JSON error responses
├── App_Start/
│   └── WebApiConfig.cs             # Route configuration + filter registration
├── scripts/
│   └── runMethod.js                # Frontend API client (jQuery, CommonJS exports)
├── index.html                      # Original landing page
├── Web.config                      # App configuration
├── packages.config                 # NuGet package manifest
└── Global.asax(.cs)                # Application startup

docs/                               # GitHub Pages documentation site
├── index.html                      # Interactive query tool
├── explorer.html                   # Distribution histograms + correlation plots
├── table.html                      # Sortable/filterable data table
├── compare.html                    # Multi-print radar chart comparison
├── quality.html                    # Quality control scoring dashboard
├── api.html                        # API reference
├── architecture.html               # Architecture documentation
├── guide.html                      # Developer guide
└── bioprint-data.json              # Data copy for client-side processing

__tests__/                          # Jest test suite (170+ tests)
├── runMethod.test.js               # Frontend query client tests
├── compare.test.js                 # Comparison tool tests
└── quality.test.js                 # Quality dashboard tests

.github/
├── workflows/                      # CI/CD (build, test, coverage, CodeQL, Docker, Pages)
├── copilot-setup-steps.yml         # Copilot coding agent setup
├── copilot-instructions.md         # Repo-specific agent instructions
├── dependabot.yml                  # Automated dependency updates
└── labeler.yml                     # Auto-labeling config
```

### Key Architecture Decisions

- **Unified MetricRegistry:** All 11 metrics are registered in a single dictionary in `PrintsController.cs`. Each entry maps a metric name to a selector function and integer/double type. One endpoint handles everything: `GET /api/prints/{metric}/{arithmetic}/{param}`.
- **Pre-computed aggregation stats:** Min/max/average are calculated once at cache load time, making aggregation queries O(1).
- **Stream deserialization:** `Newtonsoft.Json.JsonTextReader` reads the JSON file as a stream (~50% lower peak memory than loading the full string).
- **Thread-safe caching:** Double-checked locking with file-timestamp invalidation. Data reloads only when `LastWriteTimeUtc` changes.
- **Null-safe filtering:** Records with missing nested objects are skipped during loading (with `Trace` warnings) rather than causing `NullReferenceException` at query time.
- **Epsilon equality:** Float comparisons use `1e-9` tolerance to avoid IEEE 754 precision issues.

## How to Contribute

### Bug Reports

Open an issue with:
- Steps to reproduce
- Expected vs. actual behavior
- .NET Framework version and Visual Studio version
- Relevant stack traces or API responses

### Feature Requests

Open an issue describing:
- What you'd like to add and why
- How it fits with the existing API design
- Any breaking changes

### Code Contributions

1. Check existing issues — pick one labeled `good first issue` if you're new
2. Comment on the issue to signal you're working on it
3. Follow the [coding standards](#coding-standards) below
4. Run `npm test` to ensure tests pass
5. Submit a pull request

## Coding Standards

### C# Style

- Follow standard C# naming conventions (PascalCase for public members, camelCase for locals)
- Use XML doc comments (`///`) on all public methods
- Keep controller methods thin — delegate logic to private helpers
- Use `Trace.TraceInformation`/`TraceWarning` for diagnostics, not `Console.Write`
- Prefer LINQ for collection operations but avoid over-nesting

### Frontend (JavaScript/HTML)

- `'use strict'` mode in all JS files
- `const`/`let` over `var` in new code (existing `runMethod.js` uses `var` — maintain consistency within file)
- Self-contained HTML pages in `docs/` — each page bundles its own CSS and JS inline
- CSS custom properties (`--bg`, `--accent`, etc.) for all colors
- Canvas charts use direct 2D context calls — no charting libraries
- `escapeHtml()` for any user-facing data rendering (XSS prevention)
- `typeof module !== 'undefined'` pattern for CommonJS test exports

### General

- No unnecessary dependencies — this is a lightweight project
- Keep backward compatibility with .NET Framework 4.x
- Every API change should update the docs site and README

## Adding a New Metric

The backend uses a **MetricRegistry** pattern — adding a metric requires minimal code:

### Step 1: Add the model property (if needed)

If the data field doesn't exist in the model classes, add it to the appropriate class in `Try/Models/Print.cs`:

```csharp
public class PrintData
{
    // ... existing properties ...
    
    /// <summary>
    /// Your new metric description.
    /// </summary>
    public double newMetric { get; set; }
}
```

### Step 2: Register the metric

Add **one line** to the `MetricRegistry` dictionary in `PrintsController.cs`:

```csharp
{ "newMetric", new MetricDescriptor(p => p.print_data.newMetric, isInteger: false) },
```

That's it for the backend! The metric is now:
- Queryable at `GET /api/prints/newMetric/{op}/{value}`
- Included in pre-computed aggregation statistics (min/max/avg)
- Validated automatically by the existing input validation

### Step 3: Update the frontend (optional)

- Add the metric to the `<select>` dropdown in `docs/index.html`
- Add it to the `getMetricValue()` map in `docs/index.html`
- Add it to the `METRICS` array in `docs/compare.html` and `docs/quality.html` if applicable
- Add tests in `__tests__/` for any new frontend logic

### Step 4: Update documentation

- Add a row to the API reference in `docs/api.html`
- Update the metric count badge in `README.md` if displayed

## Testing

### Running Tests

```bash
# Install dependencies (first time only)
npm install

# Run all tests with coverage
npm test

# Generate detailed HTML coverage report
npm run coverage
# → open coverage/index.html in browser

# Check coverage thresholds
npm run coverage:check

# Run a specific test file
npx jest __tests__/runMethod.test.js --verbose

# Watch mode (re-runs on file changes)
npx jest --watch
```

### Test Suite Overview

| File | Tests | Coverage |
|------|-------|----------|
| `runMethod.test.js` | ~87 | `isNumeric()`, `setButtonsEnabled()`, `runMethod()` — URL construction, validation, button states, response handling, jQuery mock integration |
| `compare.test.js` | ~40+ | `METRICS` constant, `formatNum()`, selection manager, search filtering, radar normalization, table highlighting, insight generation (viability, elasticity, crosslinking, pressure) |
| `quality.test.js` | ~100+ | Quality scoring, normalization, grade assignment, color functions, Pearson correlation, heatmap colors, optimal ranges, weight customization, performer ranking, edge cases |

### Coverage Thresholds

Enforced in `package.json` via Jest configuration:

| Metric | Threshold |
|--------|-----------|
| Branches | 60% |
| Functions | 70% |
| Lines | 70% |
| Statements | 70% |

CI will fail if coverage drops below these thresholds.

### Writing New Tests

- Place test files in `__tests__/` with the `.test.js` suffix
- Use `@jest-environment jsdom` pragma for browser API tests
- For testing frontend modules that use jQuery, follow the mock pattern in `runMethod.test.js`
- For testing self-contained HTML page functions, extract functions with CommonJS exports (see `compare.html` and `quality.html`)

## Commit Messages

Use conventional commit format:

```
type(scope): short description

Longer explanation if needed.

Fixes #123
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`

Examples:
- `feat(api): add pH metric to MetricRegistry`
- `fix(cache): handle concurrent file writes safely`
- `docs(guide): update testing section with new test files`
- `test(quality): add edge cases for uniform value datasets`

## Pull Request Process

1. **Ensure your branch is up to date** with `master`:
   ```bash
   git fetch origin
   git rebase origin/master
   ```

2. **Run the test suite**:
   ```bash
   npm test
   ```

3. **Self-review** your changes — would you approve this PR?

4. **Fill out the PR template** or describe:
   - What changed and why
   - How to test it
   - Any breaking changes

5. **Wait for CI** — all checks must pass (build, tests, coverage, CodeQL, lint)

6. **Squash commits** if requested before merge

---

## Adding a New SDK Module

The `index.js` entry point uses a **lazy-loaded manifest** pattern. To expose a new computation module through the npm package:

### Step 1: Create the module

Place your module in `docs/shared/` (shared modules are used by both the docs site and the SDK). Export a factory function:

```javascript
'use strict';

function createYourModule() {
  return {
    compute: function(input) {
      // ...
    }
  };
}

if (typeof module !== 'undefined') {
  module.exports = { createYourModule: createYourModule };
}
```

### Step 2: Register in the manifest

Add one line to the `manifest` array in `index.js`:

```javascript
['createYourModule', './docs/shared/yourModule', 'createYourModule'],
```

The module is now lazy-loaded on first access — no startup cost for consumers who don't use it.

### Step 3: Add tests

Create `__tests__/yourModule.test.js`. Follow the existing pattern — use `@jest-environment jsdom` if the module touches DOM APIs, plain Node otherwise. The project has 130+ test files; match the style of a similar module.

### Step 4: Update docs

If the module is user-facing, add it to the relevant `docs/*.html` page(s).

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `npm test` fails with "Cannot find module" | Run `npm install` — a dependency may be missing after a rebase |
| NuGet restore fails in Visual Studio | Right-click solution → "Restore NuGet Packages", or delete `packages/` and rebuild |
| `bioprint-data.json` not found at runtime | Ensure it's in the project root and `DataFilePath` in `Web.config` is correct (or absent for default) |
| Coverage below thresholds after adding code | Add tests for your new code — thresholds are enforced in `package.json` (60% branches, 70% functions/lines/statements) |
| Jest tests hang or timeout | Check for unclosed timers or async operations; use `jest.useFakeTimers()` if your module uses `setTimeout`/`setInterval` |
| Port conflict when running locally | Change the port in Visual Studio project properties → Debug → App URL |
| Git rebase conflicts in `package-lock.json` | Accept either version, then run `npm install` to regenerate |

## Security Guidelines

BioBots processes biomedical/bioprinting data. Contributors should:

- **Never commit real patient or lab data** — use synthetic data in tests and examples
- **Sanitize all user inputs** rendered in HTML — use `escapeHtml()` (see existing pattern in docs pages)
- **Avoid `eval()`, `Function()`, or `innerHTML` with untrusted data** in frontend code
- **Keep dependencies minimal** — every new npm/NuGet dependency increases the attack surface
- **Review Dependabot PRs carefully** — don't auto-merge major version bumps without checking changelogs for breaking changes
- **Report vulnerabilities privately** — email the maintainer rather than opening a public issue

## Questions?

Open an issue or reach out to [@sauravbhattacharya001](https://github.com/sauravbhattacharya001).

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [@sauravbhattacharya001](https://github.com/sauravbhattacharya001).

---

Thanks for helping improve BioBots Tool! 🧬
