# Testing Guide

Comprehensive testing documentation for the BioBots bioprinting analytics platform.

## Running Tests

```bash
# Run the full Jest suite
npm test

# Run with coverage report
npm test -- --coverage

# Run a specific test file
npx jest __tests__/rheology.test.js

# Run tests matching a pattern
npx jest --testPathPattern="scaffold|porosity"

# Run in watch mode during development
npx jest --watch
```

## Test Suite Overview

The project contains **125 test files** in `__tests__/` covering every computation module, dashboard feature, and security concern. Tests use [Jest](https://jestjs.io/) with the setup in `jest.setup.js`.

## Test Structure

```
__tests__/
├── Core Computation (16 files)
│   ├── calculator.test.js         # Bioink volume & cost calculations
│   ├── crosslink.test.js          # Cross-linking kinetics analyzer
│   ├── gcode.test.js              # G-code parser & print analyzer
│   ├── mixer.test.js              # Bioink mixing ratio optimization
│   ├── rheology.test.js           # Bioink rheology modeling (Power-law, Herschel-Bulkley)
│   ├── scaffold.test.js           # Scaffold geometry, porosity, mechanics
│   ├── viability.test.js          # Cell viability estimation
│   ├── capability.test.js         # Six Sigma process capability (Cp/Cpk/Pp/Ppk)
│   ├── constants.test.js          # Shared constants validation
│   ├── data-loader.test.js        # Dataset loading, validation, caching
│   ├── export.test.js             # CSV/JSON/PDF export utilities
│   ├── jobEstimator.test.js       # Print job time/material/cost planning
│   ├── porosity.test.js           # Porosity calculations
│   ├── standardCurve.test.js      # Standard curve fitting
│   ├── utils.test.js              # DOM helpers, formatting, rounding
│   └── shared.test.js             # Shared module integration
│
├── Print & Fabrication (18 files)
│   ├── nozzleAdvisor.test.js      # Nozzle selection recommendations
│   ├── nozzlePlanner.test.js      # Nozzle maintenance scheduling
│   ├── toolpath.test.js           # Toolpath generation & analysis
│   ├── printQualityScorer.test.js # Print quality scoring algorithms
│   ├── printComparator.test.js    # Side-by-side print comparison
│   ├── printQueue.test.js         # Print job queue management
│   ├── printResolution.test.js    # Resolution optimization
│   ├── printSessionLogger.test.js # Session logging
│   ├── layerAdhesion.test.js      # Layer adhesion analysis
│   ├── optimizer.test.js          # Parameter optimization
│   ├── parameterOptimizer.test.js # Advanced parameter tuning
│   ├── predictor.test.js          # Outcome prediction
│   ├── profile.test.js            # Print profiles
│   ├── simulator.test.js          # Print simulation (via docs)
│   ├── calibration.test.js        # Printer calibration
│   ├── vascularization.test.js    # Vascularization modeling
│   ├── electroporation.test.js    # Electroporation parameters
│   └── maturation.test.js         # Tissue maturation modeling
│
├── Lab & Sample Management (20 files)
│   ├── sampleTracker.test.js      # Sample lifecycle tracking
│   ├── sampleRegistry.test.js     # Sample registration & lookup
│   ├── sampleLabel.test.js        # Label generation & formatting
│   ├── batch.test.js              # Batch processing
│   ├── batchStats.test.js         # Batch statistics
│   ├── logbook-xss.test.js        # Logbook XSS prevention
│   ├── labInventory.test.js       # Lab inventory management
│   ├── labNotebook.test.js        # Digital lab notebook
│   ├── labAuditTrail.test.js      # Audit trail logging
│   ├── sessionLogger.test.js      # Session activity logging
│   ├── materialLotTracker.test.js # Material lot tracking
│   ├── experimentTracker.test.js  # Experiment lifecycle
│   ├── experimentRandomizer.test.js # Randomization for experiments
│   ├── maintenance.test.js        # Equipment maintenance
│   ├── autoclave.test.js          # Autoclave cycle validation
│   ├── centrifuge.test.js         # Centrifuge protocol calculations
│   ├── sterilization.test.js      # Sterilization validation
│   ├── sterilityAssurance.test.js # Sterility assurance level
│   ├── waste.test.js              # Waste classification & tracking
│   └── wasteTracker.test.js       # Waste volume monitoring
│
├── Cell Biology (12 files)
│   ├── cellCounter.test.js        # Cell counting algorithms
│   ├── cellSeeding.test.js        # Seeding density calculations
│   ├── cellViability.test.js      # Viability assay analysis
│   ├── passage.test.js            # Cell passage tracking & growth curves
│   ├── growthCurve.test.js        # Growth curve fitting
│   ├── contaminationRisk.test.js  # Contamination risk scoring
│   ├── contaminationTracker.test.js # Contamination event logging
│   ├── flowCytometry.test.js      # Flow cytometry data processing
│   ├── mycoplasmaTest.test.js     # Mycoplasma detection analysis
│   ├── westernBlot.test.js        # Western blot quantification
│   ├── gelElectrophoresis.test.js # Gel electrophoresis analysis
│   └── spectrophotometer.test.js  # Spectrophotometer readings
│
├── Chemistry & Reagents (10 files)
│   ├── bufferPrep.test.js         # Buffer preparation calculations
│   ├── dilutionCalculator.test.js # Serial & simple dilution math
│   ├── serialDilution.test.js     # Serial dilution series
│   ├── molarity.test.js           # Molarity/molality conversions
│   ├── osmolality.test.js         # Osmolality calculations
│   ├── phAdjustment.test.js       # pH adjustment protocols
│   ├── mediaPrep.test.js          # Media preparation
│   ├── mediaOptimizer.test.js     # Media formulation optimization
│   ├── pcrMasterMix.test.js       # PCR master mix calculations
│   └── formulationCalculator.test.js # Bioink formulation
│
├── Quality & Compliance (14 files)
│   ├── quality.test.js            # Quality scoring
│   ├── spc.test.js                # Statistical process control
│   ├── compliance.test.js         # Regulatory compliance checks
│   ├── compatibility.test.js      # Material compatibility
│   ├── compatibilityMatrix.test.js # Compatibility matrix lookups
│   ├── reproducibility.test.js    # Reproducibility analysis
│   ├── riskAssessor.test.js       # Risk assessment scoring
│   ├── degradation.test.js        # Material degradation modeling
│   ├── shelfLife.test.js          # Shelf life calculations
│   ├── shelfLifeTracker.test.js   # Shelf life monitoring
│   ├── shelfLifeDashboard.test.js # Shelf life dashboard logic
│   ├── freezeThaw.test.js         # Freeze-thaw cycle analysis
│   ├── pipetteCalibration.test.js # Pipette calibration verification
│   └── wellplate.test.js          # Well plate layout management
│
├── Analytics & Reporting (16 files)
│   ├── anomaly.test.js            # Anomaly detection algorithms
│   ├── cluster.test.js            # Data clustering
│   ├── compare.test.js            # Comparative analysis
│   ├── correlation.test.js        # Correlation analysis (via docs)
│   ├── costEstimator.test.js      # Cost estimation
│   ├── coverage.test.js           # Coverage analysis
│   ├── doe.test.js                # Design of experiments
│   ├── failure.test.js            # Failure mode analysis
│   ├── failureDiagnostic.test.js  # Failure diagnostics
│   ├── pareto.test.js             # Pareto analysis
│   ├── trends.test.js             # Trend detection
│   ├── sensitivity.test.js        # Sensitivity analysis (via docs)
│   ├── table.test.js              # Data table operations
│   ├── recommender.test.js        # Recommendation engine
│   ├── healthDashboard.test.js    # Health metrics dashboard
│   └── mlDiagnostic*.test.js      # ML diagnostic models (3 files)
│
├── Protocols & Workflows (8 files)
│   ├── protocol.test.js           # Protocol execution
│   ├── protocolGenerator.test.js  # Protocol auto-generation
│   ├── protocolGenerator-extended.test.js
│   ├── protocolLibrary.test.js    # Protocol library management
│   ├── protocolTemplates.test.js  # Protocol templates
│   ├── recipe.test.js             # Bioink recipe management
│   ├── recipeBuilder.test.js      # Recipe builder
│   └── runMethod.test.js          # Run method execution
│
├── Environment & Monitoring (4 files)
│   ├── environment.test.js        # Environmental conditions
│   ├── environmentalMonitor.test.js # Real-time monitoring
│   ├── yieldAnalyzer.test.js      # Yield analysis
│   └── plateMap.test.js           # Plate map management
│
└── Security (5 files)
    ├── logbook-xss.test.js        # XSS prevention in logbook entries
    ├── passage-csv-security.test.js # CSV injection prevention
    ├── prototype-pollution.test.js # Prototype pollution guards
    ├── urlSafety.test.js          # URL validation & sanitization
    └── validation.test.js         # Input validation
```

## Test Categories

### Core Computation Tests
Validate the mathematical engines that power the platform. These tests verify calculation accuracy against known values and handle edge cases like division by zero, negative inputs, and extreme ranges.

### Security Tests
Five dedicated security test files ensure the platform is hardened against:
- **XSS** — HTML/script injection in logbook entries and user inputs
- **CSV Injection** — Formula injection prevention in exported CSV data
- **Prototype Pollution** — Object prototype tampering guards
- **URL Safety** — Scheme validation, SSRF prevention
- **Input Validation** — Type coercion, boundary values, malformed data

### ML Diagnostic Tests
Three test files (`mlDiagnostic.test.js`, `mlDiagnostic-extended.test.js`, `mlDiagnosticDeep.test.js`) cover the machine learning diagnostic pipeline with increasing depth — from basic inference to edge-case model behavior.

## Coverage

```bash
npm test -- --coverage
```

Coverage reports are generated in `coverage/` and tracked via [Codecov](https://codecov.io/gh/sauravbhattacharya001/BioBots). CI runs coverage on every push.

### Coverage Strategy
- **100% coverage target** for core computation modules (`docs/shared/`)
- **High coverage** for data processing, security, and protocol generation
- **Functional coverage** for dashboard-level integration tests

## Writing New Tests

### Conventions
- One test file per module in `__tests__/`
- Name: `<module>.test.js` matching the source module name
- Use `describe()` blocks for logical grouping
- Test edge cases: zero values, negative numbers, empty arrays, NaN, Infinity
- For security-sensitive code, include explicit attack vector tests

### Example Pattern

```js
const { calculateVolume } = require('../docs/shared/calculator');

describe('calculateVolume', () => {
  test('computes cylindrical volume correctly', () => {
    const result = calculateVolume({ radius: 5, height: 10, shape: 'cylinder' });
    expect(result).toBeCloseTo(785.398, 2);
  });

  test('returns 0 for zero dimensions', () => {
    expect(calculateVolume({ radius: 0, height: 10, shape: 'cylinder' })).toBe(0);
  });

  test('throws on negative radius', () => {
    expect(() => calculateVolume({ radius: -1, height: 10, shape: 'cylinder' }))
      .toThrow();
  });
});
```

## Additional Test Files

The `tests/` directory contains standalone assert-based tests (e.g., viability validation) that run independently of Jest for quick sanity checks during development.
