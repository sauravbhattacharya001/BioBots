# Changelog

All notable changes to the BioBots Tool project will be documented in this file.

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
- **Branch Protection** — PR reviews required on master

### Documentation
- Professional README with badges, architecture diagram, API reference, tech stack
- CONTRIBUTING.md with setup and development guidelines
- MIT License

[1.0.0]: https://github.com/sauravbhattacharya001/BioBots/releases/tag/v1.0.0
