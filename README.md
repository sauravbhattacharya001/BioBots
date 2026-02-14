<div align="center">

# 🧬 BioBots Tool

**A REST API and web interface for querying BioBot 1 bioprinter statistics**

Analyze 3D bioprinting run data — cell viability, print resolution, crosslinking parameters, and more — through a clean API and interactive UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![C#](https://img.shields.io/badge/C%23-ASP.NET%20Web%20API-purple)
![.NET Framework](https://img.shields.io/badge/.NET%20Framework-4.x-blue)
[![Visual Studio](https://img.shields.io/badge/IDE-Visual%20Studio%202015+-blueviolet)](https://visualstudio.microsoft.com/)

</div>

---

## 📖 Overview

BioBots Tool is an ASP.NET Web API application that reads bioprinting data from a JSON dataset and exposes RESTful endpoints for statistical queries. It was built to analyze print runs from the [BioBot 1](http://imgur.com/a/MR6ww) — an early desktop 3D bioprinter used in tissue engineering research.

The tool supports:
- **Comparison queries** — Count prints matching criteria (greater/lesser/equal)
- **Aggregation functions** — Maximum, Minimum, Average across all records
- **11 queryable metrics** — From cell viability to extruder pressure
- **File-watch caching** — Data reloads automatically when the JSON file changes (no restart needed)

## 🏗️ Architecture

```
BioBotsTool.sln
├── Try/
│   ├── Controllers/
│   │   └── PrintsController.cs    # REST API with 11 metric endpoints
│   ├── Models/
│   │   └── Print.cs               # Data models (Print, UserInfo, PrintData, etc.)
│   ├── index.html                 # Interactive query UI (jQuery)
│   ├── scripts/
│   │   └── runMethod.js           # Frontend API client
│   ├── Web.config                 # Configuration (data file path)
│   └── Global.asax.cs             # App startup
└── bioprint-data.json             # Sample dataset
```

## 🚀 Getting Started

### Prerequisites

- [Visual Studio 2015+](https://visualstudio.microsoft.com/) with ASP.NET workload
- .NET Framework 4.x

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/sauravbhattacharya001/BioBots.git
   cd BioBots
   ```

2. **Open the solution**
   ```
   Open BioBotsTool.sln in Visual Studio
   ```

3. **Run the project**
   ```
   Press F5 or Ctrl+F5 to start the development server
   ```

4. **Open the UI**
   ```
   Navigate to http://localhost:{port}/index.html
   ```

### Custom Data File

By default, the controller reads from `bioprint-data.json` in the application root. To use a different file, add to your `Web.config`:

```xml
<appSettings>
  <add key="DataFilePath" value="C:\path\to\your\bioprint-data.json" />
</appSettings>
```

The data file is **watched for changes** — edits are picked up automatically without restarting the application.

## 📡 API Reference

### Endpoint Pattern

```
GET /api/prints/{metric}/{comparison}/{value}
```

### Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `serial` | int | BioBot 1 serial number |
| `livePercent` | double | Cell viability — % alive (live/dead imaging) |
| `deadPercent` | double | Cell mortality — % dead (live/dead imaging) |
| `elasticity` | double | Structural rigidity (kPa) |
| `cl_duration` | int | Photocrosslinking duration (ms) |
| `cl_intensity` | int | Photocrosslinking light intensity (%) |
| `extruder1` | double | Extruder 1 pressure at print time |
| `extruder2` | double | Extruder 2 pressure at print time |
| `layerHeight` | double | Height per layer (mm) |
| `layerNum` | int | Total layer count |
| `wellplate` | int | Wellplate type |

### Comparisons

| Operation | Description |
|-----------|-------------|
| `greater` | Count where metric > value |
| `lesser` | Count where metric < value |
| `equal` | Count where metric = value |

### Aggregations

Pass function name as the value parameter:

| Function | Description |
|----------|-------------|
| `Maximum` | Max value across all records |
| `Minimum` | Min value across all records |
| `Average` | Mean value across all records |

### Examples

```bash
# How many prints had >50% cell viability?
GET /api/prints/livePercent/greater/50

# What's the maximum layer count across all prints?
GET /api/prints/layerNum/greater/Maximum

# Average elasticity of all prints
GET /api/prints/elasticity/greater/Average

# Prints with crosslinking duration under 10 seconds
GET /api/prints/cl_duration/lesser/10000
```

## 🖥️ Web Interface

The bundled `index.html` provides an interactive query builder:

1. **Select a metric** from the dropdown
2. **Choose a comparison** (greater/lesser/equal)
3. **Enter a value** or click an aggregation button (Maximum/Minimum/Average)
4. **View results** inline

## 🔧 Technical Details

- **Thread-safe caching** — Double-checked locking pattern for concurrent request safety
- **File-watch reload** — Checks `LastWriteTimeUtc` on each request; only re-parses JSON when the file actually changes
- **Null-safe filtering** — Records with missing nested objects are skipped with trace warnings
- **Float equality** — Uses epsilon-based comparison (`1e-9`) to handle IEEE 754 precision issues

## 🛠️ Tech Stack

| Technology | Purpose |
|-----------|---------|
| C# / ASP.NET Web API 2 | REST API framework |
| .NET Framework 4.x | Runtime |
| jQuery 3.7.1 | Frontend API client |
| JSON | Data storage format |

## 📄 License

[MIT](LICENSE) — Saurav Bhattacharya

## 👤 Author

**Saurav Bhattacharya**
- GitHub: [@sauravbhattacharya001](https://github.com/sauravbhattacharya001)
- Email: online.saurav@gmail.com
