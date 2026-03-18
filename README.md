<div align="center">

# 🧬 BioBots Tool

**A REST API and web interface for querying BioBot 1 bioprinter statistics**

Analyze 3D bioprinting run data — cell viability, print resolution, crosslinking parameters, and more — through a clean API and interactive UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/ci.yml/badge.svg)](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/ci.yml)
[![Code Coverage](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/coverage.yml/badge.svg)](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/coverage.yml)
[![codecov](https://codecov.io/gh/sauravbhattacharya001/BioBots/graph/badge.svg)](https://codecov.io/gh/sauravbhattacharya001/BioBots)
[![Docker Build](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/docker.yml/badge.svg)](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/docker.yml)
[![CodeQL](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/codeql.yml/badge.svg)](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/codeql.yml)
[![NuGet Publish](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/nuget-publish.yml/badge.svg)](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/nuget-publish.yml)
[![npm Publish](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/npm-publish.yml)
[![GitHub Pages](https://github.com/sauravbhattacharya001/BioBots/actions/workflows/pages.yml/badge.svg)](https://sauravbhattacharya001.github.io/BioBots/)
![Tests](https://img.shields.io/badge/tests-3664%20passed-brightgreen)
![Test Suites](https://img.shields.io/badge/test%20suites-71-blue)
![Scripts](https://img.shields.io/badge/scripts-25%20modules-informational)
![C#](https://img.shields.io/badge/C%23-ASP.NET%20Web%20API-purple)
![.NET Framework](https://img.shields.io/badge/.NET%20Framework-4.x-blue)
[![Visual Studio](https://img.shields.io/badge/IDE-Visual%20Studio%202015+-blueviolet)](https://visualstudio.microsoft.com/)
[![GitHub issues](https://img.shields.io/github/issues/sauravbhattacharya001/BioBots)](https://github.com/sauravbhattacharya001/BioBots/issues)
[![GitHub last commit](https://img.shields.io/github/last-commit/sauravbhattacharya001/BioBots)](https://github.com/sauravbhattacharya001/BioBots/commits/master)
[![GitHub repo size](https://img.shields.io/github/repo-size/sauravbhattacharya001/BioBots)](https://github.com/sauravbhattacharya001/BioBots)
![GitHub stars](https://img.shields.io/github/stars/sauravbhattacharya001/BioBots?style=social)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Docker Image](https://img.shields.io/badge/Docker-ghcr.io-blue?logo=docker)](https://github.com/sauravbhattacharya001/BioBots/pkgs/container/biobots-tool)

</div>

---

## 📖 Overview

BioBots Tool is an ASP.NET Web API application that reads bioprinting data from a JSON dataset and exposes RESTful endpoints for statistical queries. It was built to analyze print runs from the [BioBot 1](http://imgur.com/a/MR6ww) — an early desktop 3D bioprinter used in tissue engineering research.

The tool supports:
- **Comparison queries** — Count prints matching criteria (greater/lesser/equal)
- **Aggregation functions** — Maximum, Minimum, Average across all records
- **11 queryable metrics** — From cell viability to extruder pressure
- **File-watch caching** — Data reloads automatically when the JSON file changes (no restart needed)
- **46 interactive analysis tools** — From Data Explorer and Quality Control to Scaffold Designer, Environment Monitor, and Failure Diagnostics — all running client-side with zero dependencies

### 🌐 Live Demo

All 46 analysis tools are deployed on GitHub Pages:

| Tool | Description |
|------|-------------|
| [📊 Data Explorer](https://sauravbhattacharya001.github.io/BioBots/explorer.html) | Histograms and scatter plots with regression |
| [🔬 Print Comparison](https://sauravbhattacharya001.github.io/BioBots/compare.html) | Side-by-side comparison of 2–4 prints |
| [🎯 Quality Control](https://sauravbhattacharya001.github.io/BioBots/quality.html) | Quality grading, heatmaps, optimal parameters |
| [🔍 Anomaly Detector](https://sauravbhattacharya001.github.io/BioBots/anomaly.html) | Z-Score and IQR outlier detection |
| [🔗 Cluster Analysis](https://sauravbhattacharya001.github.io/BioBots/cluster.html) | K-means clustering with auto-k detection |
| [⚙️ Parameter Optimizer](https://sauravbhattacharya001.github.io/BioBots/optimizer.html) | Find optimal parameters for any target metric |
| [📈 Trend Analysis](https://sauravbhattacharya001.github.io/BioBots/trends.html) | Metric trends, moving averages, correlations |
| [📋 Data Table](https://sauravbhattacharya001.github.io/BioBots/table.html) | Searchable, sortable, filterable data browser |
| [🧫 Wellplate Analyzer](https://sauravbhattacharya001.github.io/BioBots/wellplate.html) | Performance breakdown by wellplate format |
| [📋 Print Report](https://sauravbhattacharya001.github.io/BioBots/report.html) | Formatted, printable lab reports |
| [💰 Cost Estimator](https://sauravbhattacharya001.github.io/BioBots/cost.html) | Per-print costs with materials, machine time, batch scaling |
| [📓 Print Logbook](https://sauravbhattacharya001.github.io/BioBots/logbook.html) | Lab notebook — notes, tags, flags, search, export |
| [🧪 Bioink Calculator](https://sauravbhattacharya001.github.io/BioBots/calculator.html) | Volume, cost, and time estimation for bioink preparations |
| [🔧 Calibration](https://sauravbhattacharya001.github.io/BioBots/calibration.html) | Guided multi-parameter calibration with analysis |
| [📊 Correlation](https://sauravbhattacharya001.github.io/BioBots/correlation.html) | Pairwise metric correlation matrix and insights |
| [🏭 Batch Analytics](https://sauravbhattacharya001.github.io/BioBots/batch.html) | Batch processing queue and statistics |
| [📐 Design of Experiments](https://sauravbhattacharya001.github.io/BioBots/doe.html) | Parameter space coverage, gap analysis |
| [🌡️ Environment Monitor](https://sauravbhattacharya001.github.io/BioBots/environment.html) | Real-time lab conditions — temp, humidity, CO₂, particulates |
| [📈 Evolution Tracker](https://sauravbhattacharya001.github.io/BioBots/evolution.html) | Track print quality evolution over time |
| [🔬 Failure Diagnostics](https://sauravbhattacharya001.github.io/BioBots/failure.html) | Root cause analysis and failure mode detection |
| [🔩 Nozzle Planner](https://sauravbhattacharya001.github.io/BioBots/nozzle.html) | Nozzle selection and coordination |
| [🧪 Materials Database](https://sauravbhattacharya001.github.io/BioBots/materials.html) | Bioink material properties and selection |
| [🧪 Bioink Mixer](https://sauravbhattacharya001.github.io/BioBots/mixer.html) | Multi-component mixing ratio optimization |
| [📊 Pareto Analysis](https://sauravbhattacharya001.github.io/BioBots/pareto.html) | Multi-objective Pareto frontier visualization |
| [🔮 Predictor](https://sauravbhattacharya001.github.io/BioBots/predictor.html) | Machine learning prediction of print outcomes |
| [🎛️ Sensitivity Analysis](https://sauravbhattacharya001.github.io/BioBots/sensitivity.html) | Tornado charts, standardized coefficients, parameter impact ranking |
| [📝 Protocol Library](https://sauravbhattacharya001.github.io/BioBots/protocol.html) | Protocol management, tagging, comparison |
| [📊 Print Profile](https://sauravbhattacharya001.github.io/BioBots/profile.html) | Individual print quality profiling with scoring |
| [📊 Queue Manager](https://sauravbhattacharya001.github.io/BioBots/queue.html) | Print job scheduling and queue management |
| [📝 Recommender](https://sauravbhattacharya001.github.io/BioBots/recommender.html) | Parameter recommendation engine |
| [📊 Reproducibility](https://sauravbhattacharya001.github.io/BioBots/reproducibility.html) | Print reproducibility scoring and grouping |
| [🧪 Rheology Modeler](https://sauravbhattacharya001.github.io/BioBots/rheology.html) | Viscosity models — Power-law, Carreau, Herschel-Bulkley |
| [🏗️ Scaffold Designer](https://sauravbhattacharya001.github.io/BioBots/scaffold.html) | 3D scaffold design — porosity, strut, material analysis |
| [🧬 Cell Seeding](https://sauravbhattacharya001.github.io/BioBots/seeding.html) | Seeding density and scaffold calculations |
| [🧫 Maturation Tracker](https://sauravbhattacharya001.github.io/BioBots/maturation.html) | Post-print tissue maturation — growth curves, milestones, culture timeline |
| [⏳ Shelf Life](https://sauravbhattacharya001.github.io/BioBots/shelf-life.html) | Bioink stability and shelf life tracking |
| [📊 SPC Charts](https://sauravbhattacharya001.github.io/BioBots/spc.html) | Statistical process control — X-bar/R charts |
| [🧹 Sterilization](https://sauravbhattacharya001.github.io/BioBots/sterilization.html) | Sterilization method selection and cycle planning |
| [📊 Coverage Tracker](https://sauravbhattacharya001.github.io/BioBots/coverage.html) | Parameter space coverage analysis |
| [✅ GLP Compliance](https://sauravbhattacharya001.github.io/BioBots/compliance.html) | Good Laboratory Practice compliance checks |
| [🗺️ Toolpath Analyzer](https://sauravbhattacharya001.github.io/BioBots/toolpath.html) | G-code toolpath visualization and analysis |
| [♻️ Waste Tracker](https://sauravbhattacharya001.github.io/BioBots/waste.html) | Material waste logging and trend analysis |
| [🛡️ Maintenance](https://sauravbhattacharya001.github.io/BioBots/maintenance.html) | Equipment maintenance scheduling and alerts |
| [🔌 API Explorer](https://sauravbhattacharya001.github.io/BioBots/api.html) | Interactive REST API documentation and testing |
| [📚 Developer Guide](https://sauravbhattacharya001.github.io/BioBots/guide.html) | Setup, testing, and contributing reference |
| [🏛️ Architecture](https://sauravbhattacharya001.github.io/BioBots/architecture.html) | System architecture diagram |

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

## 📊 Data Explorer

The [Data Explorer](https://sauravbhattacharya001.github.io/BioBots/explorer.html) provides interactive visualizations:

- **Distribution View** — Histogram of any metric with configurable bin count, hover tooltips, and summary statistics (min, max, mean, median, standard deviation)
- **Correlation View** — Scatter plot comparing any two metrics with linear regression trend line, Pearson r coefficient, and R² value
- All charts render client-side using Canvas API (zero dependencies)

## 🔬 Print Comparison

The [Print Comparison](https://sauravbhattacharya001.github.io/BioBots/compare.html) tool lets you compare 2–4 individual print records side by side:

- **Search & Select** — Find prints by serial number, email, or index; or add random records
- **Radar Chart** — Normalized radar/spider chart overlaying all selected prints across 10 metrics
- **Metric Breakdown** — Side-by-side table with per-metric values, best/worst highlighting (🏆), inline bars, and spread calculation
- **Smart Insights** — Auto-generated cards: highest viability, best elasticity, most layers, viability spread, crosslinking effect analysis, pressure balance assessment
- All charts render client-side using Canvas API (zero dependencies)

## 🎯 Quality Control Dashboard

The [Quality Control Dashboard](https://sauravbhattacharya001.github.io/BioBots/quality.html) helps identify optimal bioprinting parameters and track print quality:

- **Overall Grade** — Aggregate quality grade (A–F) and score distribution across all prints
- **Correlation Heatmap** — 10×10 Pearson correlation matrix showing how all parameters relate, with hover tooltips and color-coded cells (red = negative, green = positive)
- **Score Distribution** — Histogram of quality scores color-coded by quality tier (High ≥70, Medium 40–69, Low <40)
- **Parameter Impact Analysis** — Visualizes how each parameter correlates with cell viability, sorted by impact strength
- **Top/Bottom 10 Performers** — Ranked tables of best and worst prints with quality score bars
- **Optimal Parameter Finder** — Adjustable viability threshold slider that shows recommended parameter ranges from qualifying prints, with crosslinking usage stats and sample size
- **Customizable Weights** — Adjust the quality score formula (Live Cell %, Dead Cell %, Elasticity, Layer Count) with real-time recalculation
- All charts render client-side using Canvas API (zero dependencies)

## 🔍 Anomaly Detector

The [Anomaly Detector](https://sauravbhattacharya001.github.io/BioBots/anomaly.html) identifies statistical outliers in bioprint data:

- **Dual Detection Methods** — Z-Score (parametric) and IQR/Interquartile Range (non-parametric) anomaly detection, plus a union mode that combines both
- **Adjustable Sensitivity** — Slider controls for Z-score threshold (1.5–4.0) and IQR multiplier (1.0–3.0) with real-time recalculation
- **Metric Filtering** — Analyze all 9 metrics at once or focus on a single parameter
- **Anomaly Distribution Chart** — Stacked bar chart showing anomaly counts per metric, split by direction (above/below normal)
- **Scatter Overview** — Viability vs Elasticity scatter plot with normal prints in blue and anomalies highlighted by severity (color + size coding)
- **Severity Classification** — Three-tier system (Extreme, High, Moderate) based on Z-score magnitude and number of anomalous metrics
- **Direction Analysis** — Pie chart showing the split between above-normal and below-normal anomalies
- **Detailed Table** — Sortable, paginated list of anomalous prints with expandable detail rows showing all metrics, Z-scores, and means
- **Export** — Download anomaly reports as CSV or JSON for external analysis
- All charts render client-side using Canvas API (zero dependencies)

## 🔗 Cluster Analysis

The [Cluster Analysis](https://sauravbhattacharya001.github.io/BioBots/cluster.html) tool groups print records by similarity using k-means clustering:

- **K-Means Clustering** — Configurable cluster count (k) with automatic k detection via elbow method
- **Cluster Quality Metrics** — Silhouette score assessment and elbow/silhouette analysis charts to find the optimal number of clusters
- **Centroid Radar Profile** — Radar chart showing each cluster's centroid across all normalized metrics
- **2D Scatter Plot** — PCA-projected scatter plot with color-coded cluster assignments for visual separation
- **Cluster Profiles** — Detailed per-cluster metric breakdowns showing average values and how each cluster differs
- All charts render client-side using Canvas API (zero dependencies)

## ⚙️ Parameter Optimizer

The [Parameter Optimizer](https://sauravbhattacharya001.github.io/BioBots/optimizer.html) finds optimal bioprinting parameters to maximize a target metric:

- **Configurable Target** — Optimize for any metric (e.g., maximize cell viability, minimize dead cell %)
- **Parameter Impact Ranking** — Bar chart showing how strongly each parameter correlates with the target metric
- **Correlation Chart** — Scatter plot of each parameter vs. the target metric
- **Optimal Ranges** — Derived parameter ranges from the top-performing prints with visual range comparison bars
- **Optimization Recommendations** — Actionable suggestions based on statistical analysis of the highest-performing prints
- All charts render client-side using Canvas API (zero dependencies)

## 📈 Trend Analysis

The [Trend Analysis](https://sauravbhattacharya001.github.io/BioBots/trends.html) tool visualizes how metrics change across print records:

- **Trend Chart** — Line chart with configurable metric, moving average smoothing, and linear regression trend line
- **Chart Controls** — Adjustable moving average window, metric selection, and display toggles
- **Metric Trend Summary** — Statistical summary of trend direction and magnitude for each metric
- **Correlation Matrix** — Heatmap showing pairwise metric correlations across sequential prints
- **Smart Insights** — Auto-generated observations about improving/declining trends, strongest correlations, and notable patterns
- All charts render client-side using Canvas API (zero dependencies)

## 📚 Developer Guide

The [Developer Guide](https://sauravbhattacharya001.github.io/BioBots/guide.html) provides comprehensive documentation for contributors:

- **Prerequisites & Setup** — .NET Framework, Visual Studio, Node.js requirements
- **Running Locally** — Backend (ASP.NET Web API) and frontend (GitHub Pages preview) instructions
- **Testing** — Jest test suite with coverage reporting, threshold checks, watch mode, and per-file execution
- **Architecture Reference** — API structure, data model, and frontend organization

## 📋 Data Table

The [Data Table](https://sauravbhattacharya001.github.io/BioBots/table.html) lets you browse individual print records:

- **Sortable columns** — Click any column header to sort ascending/descending
- **Full-text search** — Filter by serial number, email, or any value
- **Numeric filtering** — Filter records by metric with comparison operators (>, <, =, ≥, ≤)
- **Expandable rows** — Click any row to see a detailed breakdown with viability bar, crosslinking status, file info
- **CSV export** — Download filtered results for external analysis
- **Pagination** — Configurable rows per page (10, 25, 50, 100)
- **Live statistics** — Shows min/avg/max for selected filter metric across visible records

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

## 📦 Packages

### NuGet (GitHub Packages)

The `BioBots.Models` package provides the data model classes (`Print`, `UserInfo`, `PrintInfo`, `PrintData`, etc.) for use in other .NET projects.

```bash
# Add the GitHub Packages source (one-time)
dotnet nuget add source https://nuget.pkg.github.com/sauravbhattacharya001/index.json \
  --name github-biobots --username YOUR_GITHUB_USERNAME --password YOUR_GITHUB_PAT

# Install the package
dotnet add package BioBots.Models
```

Packages are published automatically on each [GitHub Release](https://github.com/sauravbhattacharya001/BioBots/releases).

### Docker (GitHub Container Registry)

```bash
docker pull ghcr.io/sauravbhattacharya001/biobots-tool:latest
docker run -p 8080:80 ghcr.io/sauravbhattacharya001/biobots-tool:latest
```

## 📄 License

[MIT](LICENSE) — Saurav Bhattacharya

## 👤 Author

**Saurav Bhattacharya**
- GitHub: [@sauravbhattacharya001](https://github.com/sauravbhattacharya001)
- Email: online.saurav@gmail.com

