# BioBots Tool — Copilot Instructions

## Project Overview

BioBots Tool is a REST API for querying BioBot 1 3D bioprinter run statistics. It lets users analyze print data across metrics like cell viability (live/dead percentages), structural rigidity (elasticity), crosslinking parameters, extruder pressures, and print resolution.

## Tech Stack

- **Framework:** ASP.NET Web API 2 on .NET Framework 4.5.2
- **Language:** C# (Visual Studio 2015 era)
- **Build:** MSBuild + NuGet (not .NET Core — uses `packages.config`, not PackageReference)
- **Data:** JSON file (`bioprint-data.json`) deserialized into typed models
- **Hosting:** IIS Express (development) / IIS (production)

## Project Structure

```
BioBotsTool.sln              # Visual Studio solution
bioprint-data.json           # Print data (JSON array)
Try/                         # Main web project ("BioBots 1 tool.csproj")
  Controllers/
    PrintsController.cs      # Single API controller — all endpoints
  Models/
    Print.cs                 # Data models (Print, UserInfo, PrintInfo, etc.)
  Filters/
    GlobalExceptionFilter.cs # Global exception handling
  App_Start/
    WebApiConfig.cs          # Route configuration
  Global.asax(.cs)           # Application startup
  Web.config                 # Configuration (appSettings, connection strings)
  packages.config            # NuGet package manifest
  scripts/                   # Client-side JS (Application Insights)
  index.html                 # Simple landing page
```

## Architecture

- **Single controller pattern:** `PrintsController` handles all `/api/prints/{metric}/{comparison}/{value}` routes
- **File-based caching:** Print data is loaded from `bioprint-data.json` with file-timestamp-based cache invalidation (double-checked locking for thread safety)
- **Generic query methods:** `QueryIntMetric` and `QueryDoubleMetric` handle comparison (`greater`/`lesser`/`equal`) and aggregation (`Maximum`/`Minimum`/`Average`) operations
- **Null record filtering:** Records with missing nested objects are filtered out during load to prevent NullReferenceExceptions

## Key Conventions

1. **Naming:** Standard C# conventions — PascalCase for methods/classes, camelCase for JSON properties
2. **Error handling:** `GlobalExceptionFilter` maps exception types to HTTP status codes (FileNotFoundException → 404, ArgumentException → 400)
3. **Data file path:** Configurable via `DataFilePath` in `<appSettings>` of `Web.config`; defaults to `bioprint-data.json` in app root
4. **Floating-point equality:** Uses epsilon comparison (`1e-9`) for double equality checks to handle IEEE 754 precision issues
5. **No unit tests exist yet** — the project currently has no test project

## Building & Running

```bash
# Restore packages
nuget restore BioBotsTool.sln

# Build
msbuild BioBotsTool.sln /p:Configuration=Release /p:Platform="Any CPU"

# The project runs on IIS Express (port 56277) or IIS
```

## Key Dependencies

- `Microsoft.AspNet.WebApi` 5.2.3 — Web API framework
- `Newtonsoft.Json` 6.0.4 — JSON serialization
- `Microsoft.ApplicationInsights` 2.1.0 — Telemetry/monitoring

## Areas for Improvement

- No automated tests — adding a test project with NUnit or xUnit would be valuable
- Could benefit from input validation middleware
- The `bioprint-data.json` file is shipped in the repo — consider excluding large data files
- Using `JavaScriptSerializer` instead of `Newtonsoft.Json` for deserialization (inconsistent with the dependency)
- Consider migrating to modern .NET if viable
