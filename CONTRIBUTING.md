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

- **Visual Studio 2015+** with the ASP.NET workload
- **.NET Framework 4.x** SDK
- **NuGet** (included with Visual Studio)

### Running Locally

1. Open `BioBotsTool.sln` in Visual Studio
2. Restore NuGet packages (should happen automatically)
3. Press **F5** (debug) or **Ctrl+F5** (without debugger) to start the dev server
4. Open `http://localhost:{port}/index.html` for the web interface
5. Test API endpoints at `http://localhost:{port}/api/prints/{metric}/{comparison}/{value}`

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
BioBotsTool.sln
├── bioprint-data.json              # Sample bioprinting dataset
├── Try/
│   ├── Controllers/
│   │   └── PrintsController.cs     # REST API — all query endpoints
│   ├── Models/
│   │   └── Print.cs                # Data models (Print, UserInfo, PrintData, etc.)
│   ├── Filters/
│   │   └── GlobalExceptionFilter.cs # Global error handling
│   ├── App_Start/
│   │   └── WebApiConfig.cs         # Route configuration
│   ├── index.html                  # Interactive query UI
│   ├── scripts/
│   │   └── runMethod.js            # Frontend API client (jQuery)
│   ├── Web.config                  # App configuration
│   └── Global.asax.cs              # Application startup
└── .github/
    ├── copilot-setup-steps.yml     # Copilot agent configuration
    └── copilot-instructions.md     # Repo-specific agent instructions
```

### Key Architecture Decisions

- **Thread-safe caching**: `PrintsController` uses double-checked locking to cache parsed JSON data, reloading only when the file's `LastWriteTimeUtc` changes.
- **Null-safe filtering**: Records with missing nested objects are skipped during loading (with `Trace` warnings) rather than causing `NullReferenceException` at query time.
- **Generic query methods**: `QueryIntMetric` and `QueryDoubleMetric` handle all comparison/aggregation logic — individual endpoint methods are thin wrappers.
- **Epsilon equality**: Float comparisons use `1e-9` tolerance to avoid IEEE 754 precision issues.

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
4. Submit a pull request

## Coding Standards

### C# Style

- Follow standard C# naming conventions (PascalCase for public members, camelCase for locals)
- Use XML doc comments (`///`) on all public methods
- Keep controller methods thin — delegate logic to private helpers
- Use `Trace.TraceInformation`/`TraceWarning` for diagnostics, not `Console.Write`
- Prefer LINQ for collection operations but avoid over-nesting

### Frontend (JavaScript/HTML)

- Vanilla JS or jQuery (matching existing codebase)
- No build tools required — keep it simple
- Test in at least Chrome and Firefox

### General

- No unnecessary dependencies — this is a lightweight project
- Keep backward compatibility with .NET Framework 4.x
- Every API change should update the README's API Reference table

## Adding a New Metric

To add a queryable metric to the API:

1. **Update the model** in `Try/Models/Print.cs` if the field doesn't exist yet

2. **Add the endpoint** in `Try/Controllers/PrintsController.cs`:
   ```csharp
   [Route("api/prints/yourMetric/{arithmetic}/{param}")]
   [HttpGet]
   public IHttpActionResult GetPrintFromYourMetric(string arithmetic, string param)
       => QueryDoubleMetric(arithmetic, param, p => p.your_object.yourMetric);
   // Use QueryIntMetric for integer fields
   ```

3. **Add the option** to the dropdown in `Try/index.html`

4. **Update the README** — add a row to the Metrics table

5. **Verify** with manual testing: greater, lesser, equal, Maximum, Minimum, Average

## Testing

Currently the project has no automated test suite. When adding tests:

- Use **MSTest** or **xUnit** (both integrate well with Visual Studio)
- Place tests in a separate `BioBots.Tests` project within the solution
- Test at minimum:
  - Each metric endpoint returns correct counts for known data
  - Aggregation functions (Maximum, Minimum, Average)
  - Invalid input handling (bad numbers, unknown metrics)
  - Cache invalidation when the data file changes
  - Null-record filtering

Manual testing checklist:
- [ ] API returns correct results for each metric
- [ ] Aggregation functions work (Maximum, Minimum, Average)
- [ ] Invalid parameters return appropriate error responses (400/404)
- [ ] Web UI dropdown works for all metrics
- [ ] Data file changes are picked up without restart

## Commit Messages

Use conventional commit format:

```
type(scope): short description

Longer explanation if needed.

Fixes #123
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`

Examples:
- `feat(api): add pH metric endpoint`
- `fix(cache): handle concurrent file writes safely`
- `docs(readme): update API reference with new metrics`

## Pull Request Process

1. **Ensure your branch is up to date** with `master`:
   ```bash
   git fetch origin
   git rebase origin/master
   ```

2. **Self-review** your changes — would you approve this PR?

3. **Fill out the PR template** (if provided) or describe:
   - What changed and why
   - How to test it
   - Any breaking changes

4. **Wait for review** — the maintainer will review and may request changes

5. **Squash commits** if requested before merge

---

## Questions?

Open an issue or reach out to [@sauravbhattacharya001](https://github.com/sauravbhattacharya001).

Thanks for helping improve BioBots Tool! 🧬
