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
- [Dilution Calculator](#dilution-calculator)
- [Plate Map Generator](#plate-map-generator)
- [Cell Counter](#cell-counter)
- [Serial Dilution Calculator](#serial-dilution-calculator)
- [Standard Curve Calculator](#standard-curve-calculator)
- [Cell Viability Calculator](#cell-viability-calculator)
- [PCR Master Mix Calculator](#pcr-master-mix-calculator)
- [Flow Cytometry Analyzer](#flow-cytometry-analyzer)
- [Autoclave Logger](#autoclave-logger)
- [Centrifuge Calculator](#centrifuge-calculator)
- [Electroporation Calculator](#electroporation-calculator)
- [Growth Curve Analyzer](#growth-curve-analyzer)
- [Osmolality Calculator](#osmolality-calculator)
- [pH Adjustment Calculator](#ph-adjustment-calculator)
- [Buffer Prep Calculator](#buffer-prep-calculator)
- [Media Optimizer](#media-optimizer)
- [Western Blot Analyzer](#western-blot-analyzer)

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

## Dilution Calculator

```js
var diluter = biobots.createDilutionCalculator();
```

Provides C1V1 dilution calculations, serial dilution planning, molarity ↔ mass conversions, buffer preparation recipes, and working solution preparation from stock.

### Key Methods

| Method | Description |
|---|---|
| `diluter.c1v1({ c1, v1, c2, v2 })` | Solve C1V1 = C2V2 (set one to `null` to solve for it) |
| `diluter.serialDilution({ stockConcentration, dilutionFactor, steps, transferVolume, finalVolume })` | Plan a serial dilution series |
| `diluter.molarityToMass({ molarity, volumeL, reagent \| mw })` | Convert molar concentration to mass (g) |
| `diluter.massToMolarity({ massG, volumeL, reagent \| mw })` | Convert mass to molar concentration |
| `diluter.percentSolution({ massG, volumeML })` | Calculate weight/volume percent |
| `diluter.prepareBuffer(bufferKey, volumeML)` | Get recipe for a standard buffer |
| `diluter.workingSolution({ stockConcentration, workingConcentration, finalVolume })` | Calculate volumes for working solution |
| `diluter.listReagents()` | List available reagents with molecular weights |
| `diluter.listBuffers()` | List available buffer recipes |

```js
var result = diluter.c1v1({ c1: 10, v1: null, c2: 2, v2: 50 });
// => { c1: 10, v1: 10, c2: 2, v2: 50, diluentVolume: 40, dilutionFactor: 5 }
```

---

## Plate Map Generator

```js
var gen = biobots.createPlateMapGenerator();
```

Generates well plate layouts (6, 12, 24, 48, 96, 384-well) with sample/control/blank assignment, randomization, and edge-effect avoidance.

### Key Methods

| Method | Description |
|---|---|
| `gen.generate(opts)` | Generate a plate map with samples, controls, blanks |
| `gen.render(map)` | ASCII visual rendering of the plate |
| `gen.toCSV(map)` | Export plate map as CSV string |
| `gen.toJSON(map)` | Export plate map as JSON string |
| `gen.getFormats()` | List supported plate sizes |

```js
var map = gen.generate({
  plateSize: 96,
  samples: [{ name: 'BioinkA', replicates: 3 }, { name: 'BioinkB', replicates: 3 }],
  controls: { positive: 3, negative: 3 },
  blanks: 6,
  randomize: true,
  edgeBlanks: true
});
console.log(gen.render(map));
```

---

## Cell Counter

```js
var counter = biobots.createCellCounter();
```

Hemocytometer-based cell counting with viability assessment, dilution planning, and multiple chamber type support.

### Key Methods

| Method | Description |
|---|---|
| `counter.count({ counts, dilutionFactor, chamberType? })` | Calculate cells/mL from square counts |
| `counter.viability({ live, dead })` | Calculate cell viability percentage |
| `counter.diluteTo({ currentCellsPerMl, targetCellsPerMl, targetVolumeMl })` | Calculate dilution volumes |
| `counter.getChamberTypes()` | List supported chamber types |
| `counter.getChamberSpec(type)` | Get specs for a chamber type |

```js
var result = counter.count({ counts: [45, 52, 48, 50], dilutionFactor: 2 });
// => { cellsPerMl: 975000, averagePerSquare: 48.75, quality: 'good', ... }
```

---

## Serial Dilution Calculator

```js
var sd = biobots.createSerialDilutionCalculator();
```

Plans serial dilution series with volume calculations and preset schemes (half-log, quarter-log, etc.).

### Key Methods

| Method | Description |
|---|---|
| `sd.calculate(opts)` | Calculate a serial dilution series from parameters |
| `sd.calculateToTarget(opts)` | Plan dilution to reach a target final concentration |
| `sd.preset(scheme, initialConcentration, steps, finalVolume, unit?)` | Generate from preset scheme (e.g. `'half-log'`) |
| `sd.format(result)` | Format result as human-readable text |

```js
var result = sd.calculate({
  initialConcentration: 1000,
  dilutionFactor: 10,
  steps: 4,
  transferVolume: 100,
  finalVolume: 1000,
  unit: 'ng/mL'
});
```

---

## Standard Curve Calculator

```js
var sc = biobots.createStandardCurveCalculator();
```

Fits calibration curves (linear regression), calculates R², determines LOD/LOQ, and interpolates unknown concentrations from measured signals.

### Key Methods

| Method | Description |
|---|---|
| `sc.fitCurve(standards)` | Fit a linear standard curve from `[{ concentration, signal }]` |
| `sc.interpolate(curve, signal)` | Interpolate concentration from a signal value |
| `sc.interpolateBatch(curve, signals)` | Batch interpolation for multiple signals |

```js
var curve = sc.fitCurve([
  { concentration: 0, signal: 0.05 },
  { concentration: 10, signal: 0.52 },
  { concentration: 50, signal: 2.45 },
  { concentration: 100, signal: 4.90 }
]);
var unknown = sc.interpolate(curve, 1.25);
// => { concentration: 25.1, signal: 1.25, withinRange: true }
```

---

## Cell Viability Calculator

```js
var cv = biobots.createCellViabilityCalculator();
```

Calculates cell viability using multiple assay methods (trypan blue, MTT/MTS, live/dead fluorescent staining, etc.) with bioprinting suitability assessment.

### Key Methods

| Method | Description |
|---|---|
| `cv.trypanBlue({ live, dead })` | Viability from trypan blue exclusion counts |
| `cv.mtt({ treated, control, blank? })` | Viability from MTT/MTS absorbance |
| `cv.liveDead({ liveFluorescence, deadFluorescence })` | Viability from fluorescent staining |

```js
var result = cv.trypanBlue({ live: 450, dead: 50 });
// => { viabilityPct: 90, totalCells: 500, live: 450, dead: 50, method: 'trypan-blue' }
```

---

## PCR Master Mix Calculator

```js
var pcr = biobots.createPcrMasterMixCalculator();
```

Calculates reagent volumes for PCR master mix preparation with support for multiple polymerase presets and custom protocols.

### Key Methods

| Method | Description |
|---|---|
| `pcr.calculate(opts)` | Calculate master mix volumes for n reactions |
| `pcr.listPresets()` | List available polymerase presets |
| `pcr.getPreset(name)` | Get details of a specific preset |

---

## Flow Cytometry Analyzer

```js
var fc = biobots.createFlowCytometryAnalyzer();
```

Analyzes flow cytometry event data with gating, channel statistics, compensation, and panel-based multi-marker analysis.

### Key Methods

| Method | Description |
|---|---|
| `fc.analyzeChannel(events, channel)` | Compute statistics for a single channel |
| `fc.gate(events, gates)` | Apply gating criteria to filter events |
| `fc.listPanels()` | List available fluorochrome panels |

---

## Autoclave Logger

Track autoclave sterilization cycles, validate against standard protocols, and generate compliance reports.

```js
const logger = biobots.createAutoclaveLogger();
```

### Methods

| Method | Description |
|--------|-------------|
| `registerAutoclave(opts)` | Register an autoclave unit (id, model, chamber volume) |
| `logCycle(opts)` | Log a sterilization cycle with parameters and items |
| `recordIndicator(opts)` | Record biological/chemical indicator results for a cycle |
| `checkOverdue(maxDays)` | Find items overdue for re-sterilization |
| `checkMaintenance(opts)` | Check autoclave maintenance schedule and flag overdue units |
| `complianceReport(opts)` | Generate full compliance report with pass/fail summary |
| `getCycles(opts)` | Retrieve logged cycles with optional filtering |
| `getProtocols()` | List supported sterilization protocols (gravity, prevacuum, liquid, flash) |
| `getIndicatorTypes()` | List supported indicator types (biological, chemical, integrating) |

### Supported Protocols

| Protocol | Temp (°C) | Pressure (psi) | Duration (min) | Use Case |
|----------|-----------|----------------|----------------|----------|
| `gravity` | ≥121 | ≥15 | 30–60 | Liquids, media, wrapped instruments |
| `prevacuum` | ≥132 | ≥27 | 4–18 | Porous loads, wrapped packs, lumens |
| `liquid` | ≥121 | ≥15 | 20–60 | Liquid media (slow exhaust) |
| `flash` | ≥132 | — | 3–10 | Immediate-use, unwrapped instruments |

---

## Centrifuge Calculator

Convert between RPM and RCF (g-force), get cell-type-specific recommendations, and estimate pelleting time.

```js
const centrifuge = biobots.createCentrifugeCalculator();
```

### Methods

| Method | Description |
|--------|-------------|
| `rpmToRcf(rpm, radiusCm)` | Convert RPM to relative centrifugal force (× g) |
| `rcfToRpm(rcf, radiusCm)` | Convert RCF back to RPM |
| `recommend(cellType)` | Get recommended speed, time, and temperature for a cell type |
| `listCellTypes()` | List all cell types with preset centrifugation parameters |
| `pelletTime(opts)` | Estimate time to pellet given cell size, density, and viscosity |
| `compare(configs)` | Compare multiple centrifugation configurations side by side |

---

## Electroporation Calculator

Calculate electroporation parameters for cell transfection — voltage, pulse energy, survival and transfection efficiency estimates.

```js
const ep = biobots.createElectroporationCalculator();
```

### Methods

| Method | Description |
|--------|-------------|
| `fieldStrengthToVoltage(fieldVcm, gapCm)` | Convert field strength (V/cm) to applied voltage |
| `voltageToFieldStrength(voltage, gapCm)` | Convert voltage to field strength |
| `pulseEnergy(voltage, capacitanceUf)` | Calculate energy per pulse (Joules) |
| `timeConstant(resistanceOhm, capacitanceUf)` | Calculate RC time constant |
| `estimateSurvival(opts)` | Estimate cell survival percentage after pulsing |
| `estimateTransfection(opts)` | Estimate transfection efficiency |
| `generateProtocol(opts)` | Generate a complete electroporation protocol with all derived parameters |
| `compareProtocols(protocols)` | Compare multiple protocol configurations |
| `listCellPresets()` | List built-in cell type presets with optimal parameters |
| `listCuvettes()` | List supported cuvette types (gap width, volume) |

---

## Growth Curve Analyzer

Fit cell growth curves, calculate doubling time, and identify growth phases.

```js
const gc = biobots.createGrowthCurveAnalyzer();
```

### Methods

| Method | Description |
|--------|-------------|
| `analyze(data)` | Fit growth curve to time-series data; returns slope, intercept, R², doubling time, and phase classifications |
| `compare(datasets)` | Compare multiple growth curves (e.g., different conditions or cell lines) |
| `toCSV(analysisResult)` | Export analysis results as CSV string |

---

## Osmolality Calculator

Calculate and adjust osmolality for cell culture media and bioink formulations.

```js
const osmo = biobots.createOsmolalityCalculator();
```

### Methods

| Method | Description |
|--------|-------------|
| `calculate(opts)` | Calculate total osmolality from base media and added solutes |
| `adjustTo(opts)` | Determine how much solute to add/remove to reach target osmolality |
| `getMediaOsmolality(mediaKey)` | Get baseline osmolality for a standard medium |
| `getTargetRange(cellType)` | Get recommended osmolality range for a cell type |
| `listSolutes()` | List supported solutes with osmotic coefficients |
| `mix(media)` | Calculate osmolality of mixed media formulations |

---

## pH Adjustment Calculator

Calculate reagent volumes needed to adjust pH, with buffer system awareness.

```js
const ph = biobots.createPhAdjustmentCalculator();
```

### Methods

| Method | Description |
|--------|-------------|
| `calculate(opts)` | Calculate volume of acid/base reagent to reach target pH |
| `suggestReagent(opts)` | Suggest the best reagent for a given pH shift |
| `listReagents()` | List supported acid and base reagents with concentrations |
| `listBufferSystems()` | List supported buffer systems and their effective pH ranges |

---

## Buffer Prep Calculator

Prepare buffer solutions using the Henderson-Hasselbalch equation.

```js
const buf = biobots.createBufferPrepCalculator();
```

### Methods

| Method | Description |
|--------|-------------|
| `listBuffers()` | List all supported buffer systems with pKa, name, and effective pH range |
| `prepare(opts)` | Calculate acid/conjugate-base ratio and volumes for a target pH |
| `dilute(opts)` | Calculate dilution volumes from stock to working concentration |
| `hendersonHasselbalch(opts)` | Raw Henderson-Hasselbalch calculation: pH from pKa and ratio |

---

## Media Optimizer

Optimize cell culture media formulations — compare media, identify nutrient gaps, and calculate supplement volumes.

```js
const media = biobots.createMediaOptimizer();
```

### Methods

| Method | Description |
|--------|-------------|
| `listMedia()` | List all supported base media (DMEM, RPMI, MEM, etc.) |
| `getFormulation(mediaKey)` | Get full component list for a medium |
| `supplementVolumes(opts)` | Calculate volumes of supplements to add for a target formulation |
| `estimateOsmolarity(opts)` | Estimate osmolarity after adding supplements |
| `nutrientGap(opts)` | Identify nutrient deficiencies for a cell type given current media |
| `compareMedia(media1, media2)` | Side-by-side comparison of two media formulations |
| `listSupplements()` | List available supplements with concentrations |
| `listCellTypes()` | List cell types with media recommendations |

---

## Western Blot Analyzer

Quantitative western blot analysis — band normalization, fold-change, molecular weight estimation, and saturation detection.

```js
const wb = biobots.createWesternBlotAnalyzer();
```

### Methods

| Method | Description |
|--------|-------------|
| `normalize(opts)` | Normalize target band intensities against a loading control |
| `foldChange(opts)` | Calculate fold-change relative to a control condition |
| `compare(opts)` | Statistical comparison of band intensities across conditions |
| `estimateMW(opts)` | Estimate molecular weight from band migration distance using a standard ladder |
| `saturationCheck(intensities)` | Check for signal saturation in band intensity data |
| `report(opts)` | Generate a comprehensive analysis report |
| `listLadders()` | List supported molecular weight ladders |
| `listLoadingControls()` | List common loading control proteins |

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
