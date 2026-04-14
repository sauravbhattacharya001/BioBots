# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | ✅ Actively supported |
| < 1.0.0 | ❌ End of life |

## Reporting a Vulnerability

If you discover a security vulnerability in BioBots Tool, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email **online.saurav@gmail.com** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Impact assessment
   - Suggested fix (if any)
3. You'll receive an acknowledgment within 48 hours
4. A fix will be developed and released as soon as possible

## Security Architecture

### Server-Side (ASP.NET Web API)

#### Input Validation
- **Arithmetic operator whitelist:** The `ValidArithmetic` HashSet only accepts `greater`, `lesser`, and `equal` — all other values are rejected with a 400 Bad Request
- **Numeric parameter validation:** `double.TryParse()` validates all numeric inputs before processing; non-numeric values return 400 Bad Request
- **Metric name validation:** Only metrics registered in `MetricRegistry` are queryable; unknown metric names return 400 Bad Request with a list of valid options

#### Error Handling
- **`GlobalExceptionFilter`** catches all unhandled exceptions and returns generic, safe error messages to clients
- Internal exception details (stack traces, file paths, class names) are logged server-side via `System.Diagnostics.Trace` but **never exposed in API responses**
- Exception type mapping: `FileNotFoundException` → 404, `ArgumentException` → 400, all others → 500

#### Data Handling
- **Read-only data access:** The application only reads from `bioprint-data.json` — no write operations, no database, no SQL injection risk
- **Streaming deserialization:** JSON is parsed via `JsonTextReader` stream, avoiding full-file string allocation (limits memory exhaustion vectors)
- **Null-record filtering:** Records with missing nested objects are skipped during loading, preventing `NullReferenceException` cascades

#### Caching
- **Thread-safe cache:** Double-checked locking pattern with volatile field prevents race conditions during cache rebuilds
- **File-path configuration:** The `DataFilePath` setting is read from `Web.config` `<appSettings>` at startup — not from user input

### Client-Side (Docs Site / GitHub Pages)

#### XSS Prevention
- All docs site pages use `escapeHtml()` to sanitize data values before rendering them in the DOM
- Data is loaded from a static JSON file — no user-supplied content is rendered without escaping

#### No Sensitive Data
- The bioprint-data.json contains anonymized experimental data only
- No authentication tokens, API keys, or personal information in client-side code
- No cookies or local storage used for sensitive data

### Infrastructure

- **Branch protection** on `master` — PRs require review
- **CodeQL** analysis runs on every push and PR (JavaScript + C# scanning)
- **Dependabot** monitors NuGet, npm, GitHub Actions, and Docker dependencies for known vulnerabilities
- **Docker** container runs as non-root user with health checks

## Threat Model

| Threat | Mitigation | Status |
|--------|-----------|--------|
| Malformed API input | Whitelist validation for operators, TryParse for numbers, MetricRegistry for metrics | ✅ Mitigated |
| Stack trace leakage | GlobalExceptionFilter returns generic messages, logs details server-side | ✅ Mitigated |
| XSS in docs site | escapeHtml() on all user-facing data rendering | ✅ Mitigated |
| Dependency vulnerabilities | Dependabot + CodeQL automated scanning | ✅ Monitored |
| Memory exhaustion | Streaming JSON deserialization, bounded dataset | ✅ Mitigated |
| Race conditions | Double-checked locking with volatile cache field | ✅ Mitigated |
| Path traversal | DataFilePath from config only, not user input | ✅ Mitigated |

## Dependencies

Security-relevant dependencies are monitored via Dependabot:

- `Microsoft.AspNet.WebApi` 5.2.3
- `Newtonsoft.Json` 13.0.3
- `jest` ^30.2.0 (dev only)
- `jest-environment-jsdom` ^30.2.0 (dev only)

## Additional Security Measures (v1.1.0+)

- **CSV formula injection prevention** — cell values prefixed with `=`, `+`, `-`, `@` are sanitized on export (CWE-1236)
- **Prototype pollution guard** — object merging utilities reject `__proto__`, `constructor`, and `prototype` keys
- **URL safety validation** — external URLs are validated against `javascript:` and `data:` scheme injection
- **Content Security Policy** — docs site pages set restrictive CSP meta tags to block inline script injection
