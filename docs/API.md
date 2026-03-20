# BioBots SDK — API Reference

Complete reference for the `@sauravbhattacharya001/biobots` npm package.

```js
const biobots = require('@sauravbhattacharya001/biobots');
```

---

## Table of Contents

- [Material Calculator](#material-calculator)
- [Crosslink Analyzer](#crosslink-analyzer)
- [GCode Analyzer](#gcode-analyzer)
- [Rheology Modeler](#rheology-modeler)
- [Viability Estimator](#viability-estimator)
- [Data Exporter](#data-exporter)
- [Passage Tracker](#passage-tracker)
- [Bioink Mixer](#bioink-mixer)
- [Job Estimator](#job-estimator)
- [Scaffold Calculator](#scaffold-calculator)
- [Capability Analyzer](#capability-analyzer)
- [Print Quality Scorer](#print-quality-scorer)
- [Recipe Builder](#recipe-builder)
- [Protocol Generator](#protocol-generator)
- [Nozzle Advisor](#nozzle-advisor)
- [Sample Tracker](#sample-tracker)
- [Yield Analyzer](#yield-analyzer)
- [Shelf Life Manager](#shelf-life-manager)
- [Sterility Assurance](#sterility-assurance)
- [Cell Seeding Calculator](#cell-seeding-calculator)
- [Wash Protocol Calculator](#wash-protocol-calculator)
- [Compatibility Matrix](#compatibility-matrix)
- [Lab Inventory Manager](#lab-inventory-manager)
- [Waste Tracker](#waste-tracker)

---

## Material Calculator

Bioink volume, cost, and time estimation for wellplate-based prints.

```js
const calc = biobots.createMaterialCalculator();
```

### `calc.calculate(params)`

Calculate material usage for a print job.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `material` | `string` | — | Material name (e.g. `'alginate'`, `'gelatin'`, `'collagen'`) |
| `volume` | `number` | — | Volume in µL |
| `wellplate` | `number` | `96` | Well plate format (6, 12, 24, 48, 96) |
| `layerHeight` | `number` | `0.2` | Layer height in mm |
| `layerNum` | `number` | `1` | Number of layers |
| `infillPercent` | `number` | `100` | Infill percentage (0–100) |
| `wastePercent` | `number` | `10` | Waste factor percentage |

**Returns:** `{ material, wellplate, wellCount, layerHeight, layerNum, printHeight, infillPercent, wastePercent, volumePerWellUl, netVolumeUl, totalVolumeUl, totalVolumeMl, totalMassG, estimatedCost, wellDiameterMm, wellAreaMm2 }`

### `calc.estimateDuration(params)`

Estimate total print duration including crosslinking pauses.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `extruderSpeed` | `number` | `5` | Extruder speed in mm/s |
| `clDuration` | `number` | `0` | Crosslinking duration per layer (seconds) |
| *(plus all `calculate` params)* | | | |

**Returns:** `{ printTimeMinutes, crosslinkingTimeMinutes, totalTimeMinutes, totalTimeFormatted }`

---

## Crosslink Analyzer

UV/radical cross-linking kinetics modeling with dose-response curves.

```js
const cl = biobots.createCrosslinkAnalyzer();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `analyzeKinetics(params)` | Model cross-linking reaction kinetics |
| `doseResponse(params)` | Generate dose-response curves |
| `estimateGelation(params)` | Predict gelation time and degree |
| `viabilityTradeoff(params)` | Bell-shaped viability vs. crosslinking tradeoff |
| `reactionRate(params)` | Calculate reaction rate constants |

---

## GCode Analyzer

Parse G-code files for extrusion metrics, movement patterns, and cost analysis.

```js
const gcode = biobots.createGCodeAnalyzer();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `parse(gcodeString)` | Parse raw G-code into structured data |
| `analyzeExtrusion(parsed)` | Extrusion volume, flow rate, retraction stats |
| `analyzeMovement(parsed)` | Travel distance, speed profile, acceleration |
| `analyzeLayers(parsed)` | Per-layer metrics and height map |
| `estimatePrintTime(parsed)` | Time estimation from movement analysis |
| `estimateCost(parsed, rates)` | Material + machine time cost breakdown |

---

## Rheology Modeler

Viscosity modeling and printability scoring for bioinks.

```js
const rheo = biobots.createRheologyModeler();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `powerLaw(params)` | Power-law viscosity model (η = K·γ̇ⁿ⁻¹) |
| `carreau(params)` | Carreau model for shear-thinning fluids |
| `herschelBulkley(params)` | Herschel-Bulkley yield-stress model |
| `printabilityScore(params)` | Composite printability index (0–100) |
| `shearThinningIndex(data)` | Quantify shear-thinning behavior |
| `filamentStability(params)` | Predict filament shape retention |

---

## Viability Estimator

Multi-stressor cell survival prediction with environment modeling.

```js
const via = biobots.createViabilityEstimator();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `estimate(params)` | Predict cell viability under given conditions |
| `sensitivityAnalysis(params)` | Rank stressor impact on viability |
| `optimalWindow(params)` | Find parameter ranges maximizing viability |
| `batchAnalysis(batchParams)` | Analyze viability across multiple conditions |
| `parameterSweep(params)` | 2D parameter sweep with heatmap data |
| `calibrate(experimentalData)` | Grid-search calibration with RMSE minimization |
| `generateReport(params)` | Generate formatted viability report |

### Stressor Parameters

| Stressor | Parameter | Unit | Description |
|----------|-----------|------|-------------|
| Shear | `shearStress` | Pa | Shear stress during extrusion |
| Pressure | `pressure` | kPa | Extrusion pressure |
| UV | `uvDose` | mJ/cm² | UV crosslinking dose |
| Temperature | `temperature` | °C | Print temperature |
| Duration | `duration` | min | Total process duration |

---

## Data Exporter

Multi-format data export with formula-injection defense.

```js
const exp = biobots.createDataExporter();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `toCSV(data, columns)` | Export to CSV with injection sanitization |
| `toJSON(data, columns)` | Export to formatted JSON |
| `download(content, filename, type)` | Trigger browser download |

---

## Passage Tracker

Cell line passage history, viability trends, and senescence risk.

```js
const pt = biobots.createPassageTracker();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `addPassage(record)` | Record a new cell passage event |
| `getHistory(cellLine)` | Retrieve full passage history |
| `growthCurve(cellLine)` | Generate growth curve data |
| `senescenceRisk(cellLine)` | Assess senescence risk level |
| `viabilityTrend(cellLine)` | Track viability across passages |

---

## Bioink Mixer

Bioink mixing ratio optimization.

```js
const mixer = biobots.createBioinkMixer();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `optimizeRatio(components)` | Find optimal mixing ratios |
| `calculateViscosity(mixture)` | Predict mixture viscosity |
| `homogeneityScore(params)` | Assess mixing uniformity |

---

## Job Estimator

Print job time, material, cost, and risk estimation with batch planning.

```js
const job = biobots.createJobEstimator();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `estimate(jobParams)` | Full job estimation (time, material, cost, risk) |
| `batchPlan(jobs)` | Plan multiple jobs with resource optimization |
| `riskAssessment(jobParams)` | Detailed risk factor analysis |

---

## Scaffold Calculator

Scaffold geometry, porosity, surface area, and mechanical estimates.

```js
const sc = biobots.createScaffoldCalculator();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `calculatePorosity(params)` | Compute scaffold porosity for grid/honeycomb/gyroid architectures |
| `surfaceArea(params)` | Estimate internal surface area |
| `mechanicalProperties(params)` | Predict compressive modulus and yield strength |
| `tissueSuitability(params)` | Assess suitability for target tissue type |

---

## Capability Analyzer

Six Sigma process capability analysis (Cp/Cpk/Pp/Ppk).

```js
const cap = biobots.createCapabilityAnalyzer();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `withinBatch(data, specs)` | Cp/Cpk analysis (within-batch variation) |
| `overall(data, specs)` | Pp/Ppk analysis (overall variation) |

---

## Print Quality Scorer

Multi-dimensional print quality scoring and batch comparison.

```js
const pqs = biobots.createPrintQualityScorer();
```

### Key Methods

| Method | Description |
|--------|-------------|
| `score(printData)` | Compute composite quality score (0–100) |
| `breakdown(printData)` | Per-dimension quality breakdown |
| `compareBatches(batches)` | Statistical comparison across batches |
| `grade(score)` | Letter grade from numeric score |

---

## Recipe Builder

Create and manage bioink recipes with version tracking.

```js
const rb = biobots.createRecipeBuilder();
```

---

## Protocol Generator

Generate bioprinting protocols from parameters.

```js
const pg = biobots.createProtocolGenerator();
```

---

## Nozzle Advisor

Nozzle selection recommendations based on bioink and geometry.

```js
const na = biobots.createNozzleAdvisor();
```

---

## Sample Tracker

Track biological samples through the bioprinting pipeline.

```js
const st = biobots.createSampleTracker();
```

---

## Yield Analyzer

Analyze print yield and identify waste reduction opportunities.

```js
const ya = biobots.createYieldAnalyzer();
```

---

## Shelf Life Manager

Predict and track bioink shelf life under storage conditions.

```js
const sl = biobots.createShelfLifeManager();
```

---

## Sterility Assurance

Sterility assurance level calculations and contamination risk modeling.

```js
const sa = biobots.createSterilityAssurance();
```

---

## Cell Seeding Calculator

Calculate optimal cell seeding densities and volumes.

```js
const cs = biobots.createCellSeedingCalculator();
```

---

## Wash Protocol Calculator

Design wash buffer protocols with volume and timing optimization.

```js
const wp = biobots.createWashProtocolCalculator();
```

---

## Compatibility Matrix

Material–cell compatibility assessment and recommendation engine.

```js
const cm = biobots.createCompatibilityMatrix();
```

---

## Lab Inventory Manager

Track bioink stock, consumables, and reagents with low-stock alerts, usage logging, and consumption forecasting.

```js
const inv = biobots.createLabInventoryManager();
```

### `inv.addItem(opts)`

Add or update an inventory item.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `string` | — | Unique item name |
| `category` | `string` | — | One of: `bioink`, `crosslinker`, `reagent`, `consumable`, `scaffold`, `media`, `other` |
| `quantity` | `number` | — | Current stock quantity |
| `unit` | `string` | — | Unit of measure (mL, g, units, etc.) |
| `reorderThreshold` | `number` | `0` | Low-stock alert threshold |
| `lotNumber` | `string` | `null` | Lot/batch identifier |
| `expiryDate` | `string` | `null` | ISO date string for expiry |
| `unitCost` | `number` | `0` | Cost per unit |

**Returns:** The item record object.

### `inv.removeItem(name)`

Remove an item from inventory by name. Throws if not found.

### `inv.recordUsage(name, amount, note?)`

Record usage of an item (decrements stock).

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Item name |
| `amount` | `number` | Amount used |
| `note` | `string` | Optional usage note (e.g., print job reference) |

### `inv.getLowStockAlerts()`

Returns an array of items whose quantity is at or below their `reorderThreshold`.

### `inv.getForecast(name, days)`

Forecast usage for an item over a given number of days based on historical consumption.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Item name |
| `days` | `number` | Forecast horizon in days |

### `inv.getExpiringItems(days?)`

List items expiring within the given number of days (default: 30).

### `inv.getUsageHistory(name?)`

Get usage log entries, optionally filtered by item name.

### `inv.getSummary()`

Get a summary of all inventory: total items, total value, items by category, and low-stock count.

---

## Waste Tracker

Track, analyze, and reduce bioprinting material waste. Records waste events per print job, categorizes waste by type, calculates waste rates, identifies patterns, and suggests reduction strategies.

```js
const wt = biobots.createWasteTracker();
```

### `wt.logWaste(opts)`

Record a waste event.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `jobId` | `string` | `null` | Print job identifier |
| `material` | `string` | — | Material name (required) |
| `wasteType` | `string` | `'other'` | One of: `purge`, `failed_print`, `leftover`, `expired`, `contaminated`, `calibration`, `other` |
| `volumeMl` | `number` | — | Waste volume in mL (required, ≥ 0) |
| `costPerMl` | `number` | `0` | Cost per mL for cost tracking |
| `note` | `string` | `''` | Optional note |

**Returns:** The waste entry record with computed `cost` field.

### `wt.getSummary()`

Get aggregate waste statistics: total volume, total cost, breakdown by waste type, and breakdown by material.

### `wt.getReductionTips()`

Get actionable waste reduction tips based on the most common waste types in the recorded data.

### `wt.getByJob(jobId)`

Get all waste entries for a specific print job.

### `wt.getByMaterial(material)`

Get all waste entries for a specific material.

### `wt.reset()`

Clear all waste tracking data.

---

## Error Handling

All factory functions validate inputs and throw descriptive errors:

```js
try {
  const result = calc.calculate({ material: 'unknown' });
} catch (e) {
  console.error(e.message); // "Unknown material: unknown. Valid: alginate, gelatin, ..."
}
```

## Design Principles

- **Pure computation** — no DOM dependencies in SDK modules
- **Revealing module pattern** — factory functions return public API objects
- **Input validation** — all parameters validated with descriptive errors
- **No global state** — state kept in closures per instance
- **No external dependencies** — zero runtime dependencies
