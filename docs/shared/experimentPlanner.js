'use strict';

/**
 * Smart Experiment Planner
 *
 * Autonomous goal-oriented experiment design module for bioprinting research.
 * Accepts a natural-language research goal and generates a complete, optimized
 * experiment plan including parameter space, experiment matrix, risk assessment,
 * timeline, resource estimates, and alternative strategies.
 *
 * Key capabilities:
 * - Goal parsing: classifies goal type and extracts target parameters
 * - Parameter space design with built-in bioprinting domain knowledge
 * - Experiment matrix generation (factorial, Latin Hypercube, CCD, A/B)
 * - Per-condition risk assessment with severity and mitigation
 * - Timeline estimation with parallel/sequential scheduling
 * - Resource and cost estimation
 * - Adaptive replanning after partial results
 * - Protocol text export
 *
 * @example
 *   var ep = createExperimentPlanner();
 *   var plan = ep.plan('optimize bioink viscosity for cartilage printing');
 *   // plan.goalAnalysis.type => 'optimization'
 *   // plan.experimentMatrix.conditions => [ ... ]
 *   // plan.risks => [ { category: 'CELL_VIABILITY', score: 65, ... } ]
 *   // plan.timeline.totalHours => 48
 *   // plan.summary => 'Full factorial design with 27 conditions...'
 */

// ── Goal types ─────────────────────────────────────────────────────

var GOAL_TYPES = {
    OPTIMIZATION:  { key: 'optimization',  label: 'Optimization',  description: 'Find optimal parameter values' },
    COMPARISON:    { key: 'comparison',     label: 'Comparison',    description: 'Compare two or more conditions' },
    SCREENING:     { key: 'screening',      label: 'Screening',     description: 'Identify significant factors' },
    VALIDATION:    { key: 'validation',     label: 'Validation',    description: 'Confirm expected behavior' },
    DOSE_RESPONSE: { key: 'dose-response',  label: 'Dose-Response', description: 'Characterize dose-response curve' }
};

// ── Risk categories ────────────────────────────────────────────────

var RISK_CATEGORIES = {
    CELL_VIABILITY:          { key: 'CELL_VIABILITY',          label: 'Cell Viability Risk' },
    MATERIAL_INCOMPATIBILITY:{ key: 'MATERIAL_INCOMPATIBILITY',label: 'Material Incompatibility' },
    EQUIPMENT_LIMIT:         { key: 'EQUIPMENT_LIMIT',         label: 'Equipment Limitation' },
    CONTAMINATION:           { key: 'CONTAMINATION',           label: 'Contamination Risk' },
    TIME_SENSITIVITY:        { key: 'TIME_SENSITIVITY',        label: 'Time Sensitivity' },
    REPRODUCIBILITY:         { key: 'REPRODUCIBILITY',         label: 'Reproducibility Concern' }
};

// ── Material knowledge base ────────────────────────────────────────

var MATERIALS = {
    alginate: {
        concentrationRange: [1, 4], concentrationUnit: '% w/v',
        temperatureRange: [20, 37], crosslinkMethod: 'ionic (CaCl2)',
        crosslinkTimeRange: [5, 30], viscosityRange: [50, 2000],
        printSpeedRange: [2, 15], pressureRange: [10, 80],
        notes: 'Most common bioink base. Crosslinks with calcium chloride.'
    },
    gelatin: {
        concentrationRange: [3, 10], concentrationUnit: '% w/v',
        temperatureRange: [25, 37], crosslinkMethod: 'thermal / enzymatic (mTG)',
        crosslinkTimeRange: [10, 60], viscosityRange: [100, 5000],
        printSpeedRange: [1, 10], pressureRange: [15, 100],
        notes: 'Temperature-sensitive. Gels below ~27°C. Often combined with alginate.'
    },
    collagen: {
        concentrationRange: [2, 8], concentrationUnit: 'mg/mL',
        temperatureRange: [4, 37], crosslinkMethod: 'thermal / pH neutralization',
        crosslinkTimeRange: [15, 60], viscosityRange: [10, 500],
        printSpeedRange: [1, 8], pressureRange: [5, 60],
        notes: 'Must keep cold during prep. Gels at 37°C.'
    },
    pegda: {
        concentrationRange: [5, 20], concentrationUnit: '% w/v',
        temperatureRange: [20, 37], crosslinkMethod: 'UV photocrosslinking',
        crosslinkTimeRange: [1, 10], viscosityRange: [5, 200],
        printSpeedRange: [5, 20], pressureRange: [5, 50],
        notes: 'Requires photoinitiator. Fast crosslinking under UV.'
    },
    hyaluronic_acid: {
        concentrationRange: [0.5, 3], concentrationUnit: '% w/v',
        temperatureRange: [20, 37], crosslinkMethod: 'chemical / photocrosslinking',
        crosslinkTimeRange: [5, 30], viscosityRange: [100, 3000],
        printSpeedRange: [2, 12], pressureRange: [10, 70],
        notes: 'Excellent biocompatibility. Often modified (e.g., methacrylated HA).'
    },
    fibrin: {
        concentrationRange: [5, 40], concentrationUnit: 'mg/mL',
        temperatureRange: [20, 37], crosslinkMethod: 'enzymatic (thrombin)',
        crosslinkTimeRange: [1, 15], viscosityRange: [5, 100],
        printSpeedRange: [3, 15], pressureRange: [5, 40],
        notes: 'Fast gelation. Good for vascularization studies.'
    },
    agarose: {
        concentrationRange: [0.5, 3], concentrationUnit: '% w/v',
        temperatureRange: [30, 42], crosslinkMethod: 'thermal (cooling)',
        crosslinkTimeRange: [5, 20], viscosityRange: [50, 1500],
        printSpeedRange: [3, 15], pressureRange: [10, 60],
        notes: 'Gels upon cooling. Inert scaffold with good mechanical properties.'
    }
};

// ── Cell type knowledge base ───────────────────────────────────────

var CELL_TYPES = {
    chondrocytes: {
        densityRange: [1e6, 20e6], densityUnit: 'cells/mL',
        viabilityThreshold: 80, optimalTemperature: 37,
        handlingNotes: 'Sensitive to shear. Prefer low pressure extrusion.',
        maxPressure: 60, maxShear: 'low'
    },
    fibroblasts: {
        densityRange: [0.5e6, 10e6], densityUnit: 'cells/mL',
        viabilityThreshold: 85, optimalTemperature: 37,
        handlingNotes: 'Robust. Tolerate moderate shear stress.',
        maxPressure: 100, maxShear: 'moderate'
    },
    mscs: {
        densityRange: [1e6, 15e6], densityUnit: 'cells/mL',
        viabilityThreshold: 85, optimalTemperature: 37,
        handlingNotes: 'Multipotent. Sensitive to passage number. Keep low passage.',
        maxPressure: 70, maxShear: 'low-moderate'
    },
    hepatocytes: {
        densityRange: [2e6, 25e6], densityUnit: 'cells/mL',
        viabilityThreshold: 75, optimalTemperature: 37,
        handlingNotes: 'Very fragile. Minimize handling time. Need ECM cues.',
        maxPressure: 40, maxShear: 'very-low'
    },
    endothelial: {
        densityRange: [1e6, 10e6], densityUnit: 'cells/mL',
        viabilityThreshold: 80, optimalTemperature: 37,
        handlingNotes: 'Need growth factor supplementation. Good for vascularization.',
        maxPressure: 60, maxShear: 'low-moderate'
    }
};

// ── Equipment constraints ──────────────────────────────────────────

var EQUIPMENT = {
    pressure:    { min: 1, max: 150, unit: 'kPa' },
    nozzleSize:  { min: 100, max: 800, unit: 'µm' },
    printSpeed:  { min: 0.5, max: 30, unit: 'mm/s' },
    temperature: { min: 4, max: 60, unit: '°C' },
    layerHeight: { min: 50, max: 500, unit: 'µm' },
    uvIntensity: { min: 1, max: 50, unit: 'mW/cm²' }
};

// ── Goal parsing keywords ──────────────────────────────────────────

var GOAL_KEYWORDS = {
    optimization:  ['optimize', 'optimal', 'maximize', 'minimize', 'best', 'improve', 'tune', 'fine-tune'],
    comparison:    ['compare', 'versus', 'vs', 'difference', 'better', 'which'],
    screening:     ['screen', 'identify', 'significant', 'factors', 'which factors', 'explore'],
    validation:    ['validate', 'confirm', 'verify', 'replicate', 'reproduce', 'check'],
    'dose-response': ['dose', 'response', 'concentration effect', 'titrate', 'gradient', 'dilution series']
};

var PARAMETER_KEYWORDS = {
    viscosity:      ['viscosity', 'viscous', 'flow', 'rheolog'],
    concentration:  ['concentration', 'density', '% w/v', 'mg/ml'],
    temperature:    ['temperature', 'temp', 'thermal', 'heat', 'cool'],
    pressure:       ['pressure', 'psi', 'kpa', 'extrusion force'],
    crosslinkTime:  ['crosslink', 'gelation', 'curing', 'solidif'],
    printSpeed:     ['speed', 'velocity', 'print rate', 'deposition rate'],
    cellViability:  ['viability', 'survival', 'live/dead', 'cell health'],
    cellDensity:    ['cell density', 'seeding density', 'cells/ml', 'cell concentration'],
    nozzleSize:     ['nozzle', 'needle', 'gauge', 'orifice', 'aperture'],
    layerHeight:    ['layer', 'height', 'z-step', 'slice'],
    mechanicalStr:  ['strength', 'stiffness', 'modulus', 'mechanical', 'compressive'],
    printability:   ['printability', 'fidelity', 'resolution', 'shape retention', 'strand']
};

// ── Helpers ────────────────────────────────────────────────────────

function clamp(val, lo, hi) { return Math.max(lo, Math.min(hi, val)); }

function round2(v) { return Math.round(v * 100) / 100; }

function generateId() {
    return 'plan-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function linspace(lo, hi, n) {
    if (n <= 1) return [round2((lo + hi) / 2)];
    var step = (hi - lo) / (n - 1);
    var arr = [];
    for (var i = 0; i < n; i++) arr.push(round2(lo + step * i));
    return arr;
}

function latinHypercube(factors, n) {
    // Each factor gets n evenly-spaced bins; one sample per bin, randomly permuted
    var matrix = [];
    var permutations = [];
    for (var f = 0; f < factors.length; f++) {
        var perm = [];
        for (var i = 0; i < n; i++) perm.push(i);
        // Fisher-Yates shuffle
        for (var j = n - 1; j > 0; j--) {
            var k = Math.floor(Math.random() * (j + 1));
            var tmp = perm[j]; perm[j] = perm[k]; perm[k] = tmp;
        }
        permutations.push(perm);
    }
    for (var row = 0; row < n; row++) {
        var condition = {};
        for (var fi = 0; fi < factors.length; fi++) {
            var fac = factors[fi];
            var bin = permutations[fi][row];
            var lo = fac.range[0];
            var hi = fac.range[1];
            var step = (hi - lo) / n;
            condition[fac.name] = round2(lo + step * (bin + 0.5));
        }
        matrix.push(condition);
    }
    return matrix;
}

function fullFactorial(factors) {
    var matrix = [{}];
    for (var fi = 0; fi < factors.length; fi++) {
        var fac = factors[fi];
        var newMatrix = [];
        for (var mi = 0; mi < matrix.length; mi++) {
            for (var li = 0; li < fac.levels.length; li++) {
                var cond = {};
                var keys = Object.keys(matrix[mi]);
                for (var ki = 0; ki < keys.length; ki++) cond[keys[ki]] = matrix[mi][keys[ki]];
                cond[fac.name] = fac.levels[li];
                newMatrix.push(cond);
            }
        }
        matrix = newMatrix;
    }
    return matrix;
}

function centralComposite(factors) {
    // Center point + factorial corners (±1) + axial/star points (±alpha)
    var alpha = round2(Math.pow(Math.pow(2, factors.length), 0.25));
    var matrix = [];
    var center = {};
    for (var fi = 0; fi < factors.length; fi++) {
        var fac = factors[fi];
        center[fac.name] = round2((fac.range[0] + fac.range[1]) / 2);
    }
    // Center point (with replicates)
    for (var c = 0; c < 3; c++) matrix.push(Object.assign({}, center, { _type: 'center' }));

    // Factorial points (2^k corners)
    var nCorners = Math.pow(2, factors.length);
    for (var ci = 0; ci < nCorners; ci++) {
        var pt = {};
        for (var fi2 = 0; fi2 < factors.length; fi2++) {
            var fac2 = factors[fi2];
            var mid = (fac2.range[0] + fac2.range[1]) / 2;
            var halfRange = (fac2.range[1] - fac2.range[0]) / 2;
            var sign = (ci >> fi2) & 1 ? 1 : -1;
            pt[fac2.name] = round2(clamp(mid + sign * halfRange, fac2.range[0], fac2.range[1]));
        }
        pt._type = 'factorial';
        matrix.push(pt);
    }

    // Axial (star) points
    for (var fi3 = 0; fi3 < factors.length; fi3++) {
        var fac3 = factors[fi3];
        var mid3 = (fac3.range[0] + fac3.range[1]) / 2;
        var halfR = (fac3.range[1] - fac3.range[0]) / 2;
        for (var s = -1; s <= 1; s += 2) {
            var axPt = Object.assign({}, center);
            axPt[fac3.name] = round2(clamp(mid3 + s * alpha * halfR, fac3.range[0], fac3.range[1]));
            axPt._type = 'axial';
            matrix.push(axPt);
        }
    }
    return matrix;
}

// ── Goal parser ────────────────────────────────────────────────────

function parseGoal(goalText) {
    var lower = (goalText || '').toLowerCase();
    var type = 'optimization'; // default
    var maxScore = 0;

    var typeKeys = Object.keys(GOAL_KEYWORDS);
    for (var ti = 0; ti < typeKeys.length; ti++) {
        var kws = GOAL_KEYWORDS[typeKeys[ti]];
        var score = 0;
        for (var ki = 0; ki < kws.length; ki++) {
            if (lower.indexOf(kws[ki]) !== -1) score++;
        }
        if (score > maxScore) { maxScore = score; type = typeKeys[ti]; }
    }

    // Extract target parameters
    var targets = [];
    var paramKeys = Object.keys(PARAMETER_KEYWORDS);
    for (var pi = 0; pi < paramKeys.length; pi++) {
        var pKws = PARAMETER_KEYWORDS[paramKeys[pi]];
        for (var pki = 0; pki < pKws.length; pki++) {
            if (lower.indexOf(pKws[pki]) !== -1) {
                targets.push(paramKeys[pi]);
                break;
            }
        }
    }

    // Extract materials
    var materials = [];
    var matKeys = Object.keys(MATERIALS);
    for (var mi = 0; mi < matKeys.length; mi++) {
        if (lower.indexOf(matKeys[mi].replace(/_/g, ' ')) !== -1 || lower.indexOf(matKeys[mi]) !== -1) {
            materials.push(matKeys[mi]);
        }
    }

    // Extract cell types
    var cells = [];
    var cellKeys = Object.keys(CELL_TYPES);
    for (var cli = 0; cli < cellKeys.length; cli++) {
        if (lower.indexOf(cellKeys[cli]) !== -1) cells.push(cellKeys[cli]);
    }

    // Direction
    var direction = 'maximize';
    if (lower.indexOf('minimize') !== -1 || lower.indexOf('reduce') !== -1 || lower.indexOf('lower') !== -1) {
        direction = 'minimize';
    }

    return {
        originalGoal: goalText,
        type: type,
        direction: direction,
        targetParameters: targets.length > 0 ? targets : ['viscosity'],
        materials: materials.length > 0 ? materials : ['alginate'],
        cellTypes: cells,
        confidence: maxScore > 0 ? Math.min(1, 0.5 + maxScore * 0.15) : 0.4
    };
}

// ── Parameter space builder ────────────────────────────────────────

function buildParameterSpace(goalAnalysis, options) {
    options = options || {};
    var factors = [];
    var material = MATERIALS[goalAnalysis.materials[0]] || MATERIALS.alginate;

    var targetSet = {};
    for (var i = 0; i < goalAnalysis.targetParameters.length; i++) {
        targetSet[goalAnalysis.targetParameters[i]] = true;
    }

    // Primary factor based on targets
    if (targetSet.concentration || targetSet.viscosity) {
        factors.push({
            name: 'concentration',
            range: options.concentrationRange || material.concentrationRange,
            unit: material.concentrationUnit,
            levels: linspace(
                (options.concentrationRange || material.concentrationRange)[0],
                (options.concentrationRange || material.concentrationRange)[1],
                options.levelsPerFactor || 3
            )
        });
    }

    if (targetSet.temperature) {
        factors.push({
            name: 'temperature',
            range: options.temperatureRange || material.temperatureRange,
            unit: '°C',
            levels: linspace(
                (options.temperatureRange || material.temperatureRange)[0],
                (options.temperatureRange || material.temperatureRange)[1],
                options.levelsPerFactor || 3
            )
        });
    }

    if (targetSet.crosslinkTime) {
        factors.push({
            name: 'crosslinkTime',
            range: options.crosslinkTimeRange || material.crosslinkTimeRange,
            unit: 'min',
            levels: linspace(
                (options.crosslinkTimeRange || material.crosslinkTimeRange)[0],
                (options.crosslinkTimeRange || material.crosslinkTimeRange)[1],
                options.levelsPerFactor || 3
            )
        });
    }

    if (targetSet.pressure) {
        factors.push({
            name: 'pressure',
            range: options.pressureRange || material.pressureRange,
            unit: 'kPa',
            levels: linspace(
                (options.pressureRange || material.pressureRange)[0],
                (options.pressureRange || material.pressureRange)[1],
                options.levelsPerFactor || 3
            )
        });
    }

    if (targetSet.printSpeed) {
        factors.push({
            name: 'printSpeed',
            range: options.printSpeedRange || material.printSpeedRange,
            unit: 'mm/s',
            levels: linspace(
                (options.printSpeedRange || material.printSpeedRange)[0],
                (options.printSpeedRange || material.printSpeedRange)[1],
                options.levelsPerFactor || 3
            )
        });
    }

    if (targetSet.cellDensity && goalAnalysis.cellTypes.length > 0) {
        var cellType = CELL_TYPES[goalAnalysis.cellTypes[0]] || CELL_TYPES.fibroblasts;
        factors.push({
            name: 'cellDensity',
            range: options.cellDensityRange || cellType.densityRange,
            unit: cellType.densityUnit,
            levels: linspace(
                (options.cellDensityRange || cellType.densityRange)[0],
                (options.cellDensityRange || cellType.densityRange)[1],
                options.levelsPerFactor || 3
            )
        });
    }

    if (targetSet.nozzleSize) {
        factors.push({
            name: 'nozzleSize',
            range: options.nozzleSizeRange || [EQUIPMENT.nozzleSize.min, EQUIPMENT.nozzleSize.max],
            unit: 'µm',
            levels: linspace(
                (options.nozzleSizeRange || [EQUIPMENT.nozzleSize.min, EQUIPMENT.nozzleSize.max])[0],
                (options.nozzleSizeRange || [EQUIPMENT.nozzleSize.min, EQUIPMENT.nozzleSize.max])[1],
                options.levelsPerFactor || 3
            )
        });
    }

    // If no specific parameters matched, add concentration and temperature as defaults
    if (factors.length === 0) {
        factors.push({
            name: 'concentration',
            range: material.concentrationRange,
            unit: material.concentrationUnit,
            levels: linspace(material.concentrationRange[0], material.concentrationRange[1], 3)
        });
        factors.push({
            name: 'temperature',
            range: material.temperatureRange,
            unit: '°C',
            levels: linspace(material.temperatureRange[0], material.temperatureRange[1], 3)
        });
    }

    return {
        factors: factors,
        material: goalAnalysis.materials[0],
        materialInfo: material,
        replicates: options.replicates || 3
    };
}

// ── Design strategy selector ───────────────────────────────────────

function selectDesignStrategy(numFactors, levelsPerFactor, goalType) {
    if (goalType === 'comparison') return 'ab';
    if (goalType === 'dose-response') return 'dose-response';
    if (goalType === 'validation') return 'factorial';

    var totalConditions = Math.pow(levelsPerFactor, numFactors);

    if (numFactors <= 3 && levelsPerFactor <= 3) return 'factorial';
    if (goalType === 'optimization' && numFactors >= 2) return 'ccd';
    if (totalConditions > 50) return 'latin-hypercube';
    return 'factorial';
}

// ── Matrix builder ─────────────────────────────────────────────────

function buildMatrix(paramSpace, strategy, options) {
    options = options || {};
    var factors = paramSpace.factors;
    var conditions;

    switch (strategy) {
        case 'factorial':
            conditions = fullFactorial(factors);
            break;
        case 'ccd':
            conditions = centralComposite(factors);
            break;
        case 'latin-hypercube':
            conditions = latinHypercube(factors, options.sampleSize || 20);
            break;
        case 'ab':
            // Simple two-condition comparison
            conditions = [];
            for (var i = 0; i < factors.length; i++) {
                var fac = factors[i];
                var condA = {}; condA[fac.name] = fac.levels[0];
                var condB = {}; condB[fac.name] = fac.levels[fac.levels.length - 1];
                if (conditions.length === 0) {
                    conditions.push(condA, condB);
                } else {
                    conditions[0][fac.name] = fac.levels[0];
                    conditions[1][fac.name] = fac.levels[fac.levels.length - 1];
                }
            }
            break;
        case 'dose-response':
            // Single factor with many levels
            if (factors.length > 0) {
                var primary = factors[0];
                var levels = linspace(primary.range[0], primary.range[1], options.dosePoints || 7);
                conditions = levels.map(function(lev) {
                    var c = {}; c[primary.name] = lev; return c;
                });
            } else {
                conditions = [];
            }
            break;
        default:
            conditions = fullFactorial(factors);
    }

    // Assign condition IDs
    for (var ci = 0; ci < conditions.length; ci++) {
        conditions[ci]._conditionId = 'C' + String(ci + 1).padStart(3, '0');
    }

    return {
        strategy: strategy,
        conditions: conditions,
        conditionCount: conditions.length,
        replicates: paramSpace.replicates,
        totalRuns: conditions.length * paramSpace.replicates
    };
}

// ── Risk assessor ──────────────────────────────────────────────────

function assessConditionRisks(conditions, goalAnalysis, paramSpace) {
    var risks = [];
    var totalScore = 0;

    for (var ci = 0; ci < conditions.length; ci++) {
        var cond = conditions[ci];
        var condRisks = [];

        // Cell viability risk — high pressure or extreme temperature
        if (goalAnalysis.cellTypes.length > 0) {
            var cellType = CELL_TYPES[goalAnalysis.cellTypes[0]];
            if (cellType) {
                if (cond.pressure && cond.pressure > cellType.maxPressure) {
                    condRisks.push({
                        category: 'CELL_VIABILITY',
                        score: clamp(Math.round(50 + (cond.pressure - cellType.maxPressure) * 2), 0, 100),
                        message: 'Pressure ' + cond.pressure + ' kPa exceeds ' + goalAnalysis.cellTypes[0] + ' tolerance (' + cellType.maxPressure + ' kPa)',
                        mitigation: 'Reduce pressure or use larger nozzle diameter'
                    });
                }
                if (cond.temperature && (cond.temperature < 20 || cond.temperature > 40)) {
                    condRisks.push({
                        category: 'CELL_VIABILITY',
                        score: Math.round(40 + Math.abs(cond.temperature - 37) * 3),
                        message: 'Temperature ' + cond.temperature + '°C may reduce cell viability',
                        mitigation: 'Pre-warm/cool bioink and minimize exposure time'
                    });
                }
            }
        }

        // Equipment limits
        var eqKeys = Object.keys(EQUIPMENT);
        for (var ei = 0; ei < eqKeys.length; ei++) {
            var eq = EQUIPMENT[eqKeys[ei]];
            if (cond[eqKeys[ei]] !== undefined) {
                if (cond[eqKeys[ei]] > eq.max * 0.9) {
                    condRisks.push({
                        category: 'EQUIPMENT_LIMIT',
                        score: Math.round(40 + ((cond[eqKeys[ei]] - eq.max * 0.9) / (eq.max * 0.1)) * 40),
                        message: eqKeys[ei] + ' at ' + cond[eqKeys[ei]] + ' ' + eq.unit + ' near equipment limit (' + eq.max + ')',
                        mitigation: 'Verify equipment can sustain this setting reliably'
                    });
                }
                if (cond[eqKeys[ei]] < eq.min * 1.1) {
                    condRisks.push({
                        category: 'EQUIPMENT_LIMIT',
                        score: 30,
                        message: eqKeys[ei] + ' at ' + cond[eqKeys[ei]] + ' ' + eq.unit + ' near equipment minimum (' + eq.min + ')',
                        mitigation: 'Confirm equipment precision at low settings'
                    });
                }
            }
        }

        // Concentration extremes — material incompatibility
        var mat = paramSpace.materialInfo;
        if (cond.concentration !== undefined && mat) {
            var range = mat.concentrationRange;
            var margin = (range[1] - range[0]) * 0.1;
            if (cond.concentration > range[1] - margin || cond.concentration < range[0] + margin) {
                condRisks.push({
                    category: 'MATERIAL_INCOMPATIBILITY',
                    score: 45,
                    message: 'Concentration ' + cond.concentration + ' near material limits',
                    mitigation: 'Pilot test at extreme concentrations before full run'
                });
            }
        }

        // Contamination risk — long crosslink times
        if (cond.crosslinkTime && cond.crosslinkTime > 45) {
            condRisks.push({
                category: 'CONTAMINATION',
                score: Math.round(30 + (cond.crosslinkTime - 45) * 1.5),
                message: 'Extended crosslink time (' + cond.crosslinkTime + ' min) increases contamination exposure',
                mitigation: 'Use sterile enclosure and minimize air exposure during gelation'
            });
        }

        // Reproducibility risk — too many interacting factors at extremes
        var extremeCount = 0;
        var factorNames = paramSpace.factors.map(function(f) { return f.name; });
        for (var fi = 0; fi < factorNames.length; fi++) {
            var fn = factorNames[fi];
            if (cond[fn] !== undefined) {
                var factor = paramSpace.factors[fi];
                var low = factor.range[0];
                var high = factor.range[1];
                var pct = (cond[fn] - low) / (high - low);
                if (pct < 0.1 || pct > 0.9) extremeCount++;
            }
        }
        if (extremeCount >= 2) {
            condRisks.push({
                category: 'REPRODUCIBILITY',
                score: Math.round(35 + extremeCount * 10),
                message: extremeCount + ' parameters at extreme values — interaction effects may reduce reproducibility',
                mitigation: 'Add extra replicates for this condition'
            });
        }

        var condScore = 0;
        for (var ri = 0; ri < condRisks.length; ri++) condScore = Math.max(condScore, condRisks[ri].score);
        totalScore += condScore;

        if (condRisks.length > 0) {
            risks.push({
                conditionId: cond._conditionId,
                risks: condRisks,
                maxScore: condScore,
                riskLevel: condScore >= 70 ? 'HIGH' : condScore >= 40 ? 'MODERATE' : 'LOW'
            });
        }
    }

    var overallScore = conditions.length > 0 ? Math.round(totalScore / conditions.length) : 0;

    return {
        risks: risks,
        overallRiskScore: overallScore,
        overallRiskLevel: overallScore >= 60 ? 'HIGH' : overallScore >= 30 ? 'MODERATE' : 'LOW',
        highRiskConditions: risks.filter(function(r) { return r.riskLevel === 'HIGH'; }).length,
        mitigations: deduplicateMitigations(risks)
    };
}

function deduplicateMitigations(risks) {
    var seen = {};
    var mitigations = [];
    for (var i = 0; i < risks.length; i++) {
        for (var j = 0; j < risks[i].risks.length; j++) {
            var m = risks[i].risks[j].mitigation;
            if (m && !seen[m]) {
                seen[m] = true;
                mitigations.push({
                    action: m,
                    category: risks[i].risks[j].category,
                    priority: risks[i].risks[j].score >= 60 ? 'high' : 'medium'
                });
            }
        }
    }
    return mitigations.sort(function(a, b) {
        return (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1);
    });
}

// ── Timeline estimator ─────────────────────────────────────────────

function estimateTimeline(matrix, options) {
    options = options || {};
    var parallel = options.parallel || 1;
    var prepTimePerCondition = options.prepTimeMin || 15; // minutes
    var incubationTime = options.incubationTimeMin || 0;
    var analysisTimePerSample = options.analysisTimeMin || 10;
    var setupTime = options.setupTimeMin || 60;
    var cleanupTime = options.cleanupTimeMin || 30;

    var totalConditions = matrix.conditionCount;
    var totalRuns = matrix.totalRuns;

    var printTimePerRun = options.printTimeMin || 20;
    var batchSize = Math.min(parallel, totalConditions);
    var batches = Math.ceil(totalConditions / batchSize);

    var phases = [
        { name: 'Setup & Calibration', durationMin: setupTime },
        { name: 'Material Preparation', durationMin: Math.ceil(totalConditions / 3) * prepTimePerCondition },
        { name: 'Printing', durationMin: batches * printTimePerRun * matrix.replicates },
        { name: 'Post-Processing', durationMin: totalConditions * (incubationTime || 5) },
        { name: 'Analysis & Measurement', durationMin: totalRuns * analysisTimePerSample },
        { name: 'Cleanup', durationMin: cleanupTime }
    ];

    var totalMin = 0;
    for (var i = 0; i < phases.length; i++) {
        phases[i].durationMin = Math.round(phases[i].durationMin);
        totalMin += phases[i].durationMin;
    }

    return {
        totalHours: round2(totalMin / 60),
        totalMinutes: totalMin,
        phases: phases,
        criticalPath: phases.reduce(function(a, b) { return a.durationMin > b.durationMin ? a : b; }).name,
        parallelism: batchSize,
        batches: batches
    };
}

// ── Resource estimator ─────────────────────────────────────────────

function estimateResources(matrix, paramSpace) {
    var material = paramSpace.materialInfo || MATERIALS.alginate;
    var materialName = paramSpace.material || 'alginate';
    var totalRuns = matrix.totalRuns;
    var volumePerRun = 2; // mL default per print

    var materials = [
        {
            name: materialName + ' bioink',
            quantity: round2(totalRuns * volumePerRun * 1.2),
            unit: 'mL',
            note: 'Includes 20% waste margin'
        }
    ];

    if (material.crosslinkMethod && material.crosslinkMethod.indexOf('CaCl2') !== -1) {
        materials.push({
            name: 'CaCl2 solution (100mM)',
            quantity: round2(totalRuns * 5),
            unit: 'mL',
            note: 'For ionic crosslinking'
        });
    }

    if (material.crosslinkMethod && material.crosslinkMethod.indexOf('UV') !== -1) {
        materials.push({ name: 'Photoinitiator (LAP/Irgacure)', quantity: round2(totalRuns * 0.1), unit: 'mL', note: 'UV crosslinking' });
    }

    var equipment = [
        { name: 'Bioprinter', hoursNeeded: round2(totalRuns * 0.33) },
        { name: 'Biosafety cabinet', hoursNeeded: round2(totalRuns * 0.25) }
    ];

    var consumables = [
        { name: 'Print cartridges/syringes', quantity: Math.ceil(totalRuns / 3) },
        { name: 'Nozzle tips', quantity: Math.ceil(totalRuns / 5) },
        { name: 'Well plates (6-well)', quantity: Math.ceil(matrix.conditionCount / 6) * matrix.replicates },
        { name: 'Sterile petri dishes', quantity: matrix.conditionCount },
        { name: 'Gloves (pairs)', quantity: Math.ceil(totalRuns / 2) }
    ];

    var estimatedCost = round2(
        materials.reduce(function(s, m) { return s + m.quantity * 2; }, 0) +
        consumables.reduce(function(s, c) { return s + (c.quantity || 0) * 3; }, 0) +
        equipment.reduce(function(s, e) { return s + e.hoursNeeded * 25; }, 0)
    );

    return {
        materials: materials,
        equipment: equipment,
        consumables: consumables,
        estimatedCost: { amount: estimatedCost, currency: 'USD', note: 'Rough estimate based on typical lab pricing' }
    };
}

// ── Alternative strategies ─────────────────────────────────────────

function generateAlternatives(goalAnalysis, paramSpace, primaryStrategy) {
    var strategies = ['factorial', 'ccd', 'latin-hypercube'];
    var alternatives = [];
    var numFactors = paramSpace.factors.length;

    for (var si = 0; si < strategies.length; si++) {
        var strat = strategies[si];
        if (strat === primaryStrategy) continue;
        if (alternatives.length >= 2) break;

        var matrix = buildMatrix(paramSpace, strat, { sampleSize: 15 });
        var timeline = estimateTimeline(matrix);
        var suitability = 0.5;

        if (strat === 'ccd' && goalAnalysis.type === 'optimization') suitability = 0.9;
        if (strat === 'factorial' && numFactors <= 2) suitability = 0.85;
        if (strat === 'latin-hypercube' && numFactors > 3) suitability = 0.8;
        if (strat === 'factorial' && numFactors > 3) suitability = 0.3;

        alternatives.push({
            strategy: strat,
            conditions: matrix.conditionCount,
            totalRuns: matrix.totalRuns,
            estimatedHours: timeline.totalHours,
            suitability: round2(suitability),
            pros: getStrategyPros(strat),
            cons: getStrategyCons(strat, numFactors)
        });
    }

    return alternatives.sort(function(a, b) { return b.suitability - a.suitability; });
}

function getStrategyPros(strategy) {
    var pros = {
        'factorial':        ['Complete coverage of all factor combinations', 'Detects interaction effects', 'Straightforward analysis'],
        'ccd':              ['Efficient for optimization', 'Models quadratic effects', 'Fewer runs than full factorial for >2 factors'],
        'latin-hypercube':  ['Excellent space coverage', 'Scales well with many factors', 'Efficient sample size'],
        'ab':               ['Simplest to execute', 'Clear binary comparison', 'Minimal resources'],
        'dose-response':    ['Full characterization of response curve', 'Identifies thresholds', 'Good for single-factor studies']
    };
    return pros[strategy] || [];
}

function getStrategyCons(strategy, numFactors) {
    var cons = {
        'factorial':        numFactors > 3 ? ['Exponential growth in conditions', 'Very resource-intensive'] : ['May miss non-linear effects'],
        'ccd':              ['Assumes quadratic model', 'Requires coded factor levels', 'Not ideal for screening'],
        'latin-hypercube':  ['Cannot detect interactions directly', 'Requires statistical modeling', 'Randomness affects reproducibility'],
        'ab':               ['No interaction detection', 'Only two conditions', 'Limited insight'],
        'dose-response':    ['Single factor only', 'Ignores multi-factor interactions']
    };
    return cons[strategy] || [];
}

// ── Protocol export ────────────────────────────────────────────────

function toProtocol(plan) {
    var lines = [];
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('  EXPERIMENT PROTOCOL');
    lines.push('  Generated by BioBots Smart Experiment Planner');
    lines.push('  Plan ID: ' + plan.planId);
    lines.push('  Date: ' + new Date().toISOString().split('T')[0]);
    lines.push('═══════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push('OBJECTIVE: ' + plan.goalAnalysis.originalGoal);
    lines.push('Goal Type: ' + plan.goalAnalysis.type);
    lines.push('Material: ' + plan.goalAnalysis.materials.join(', '));
    if (plan.goalAnalysis.cellTypes.length > 0) {
        lines.push('Cell Types: ' + plan.goalAnalysis.cellTypes.join(', '));
    }
    lines.push('');
    lines.push('── EXPERIMENTAL DESIGN ──────────────────────────────────────');
    lines.push('Strategy: ' + plan.experimentMatrix.strategy);
    lines.push('Conditions: ' + plan.experimentMatrix.conditionCount);
    lines.push('Replicates: ' + plan.experimentMatrix.replicates);
    lines.push('Total Runs: ' + plan.experimentMatrix.totalRuns);
    lines.push('');
    lines.push('── PARAMETERS ──────────────────────────────────────────────');
    for (var fi = 0; fi < plan.parameterSpace.factors.length; fi++) {
        var f = plan.parameterSpace.factors[fi];
        lines.push('  ' + f.name + ': ' + f.range[0] + ' – ' + f.range[1] + ' ' + f.unit + '  (levels: ' + f.levels.join(', ') + ')');
    }
    lines.push('');
    lines.push('── CONDITION TABLE ─────────────────────────────────────────');
    for (var ci = 0; ci < plan.experimentMatrix.conditions.length; ci++) {
        var cond = plan.experimentMatrix.conditions[ci];
        var parts = [cond._conditionId + ':'];
        var keys = Object.keys(cond);
        for (var ki = 0; ki < keys.length; ki++) {
            if (keys[ki].charAt(0) !== '_') parts.push(keys[ki] + '=' + cond[keys[ki]]);
        }
        lines.push('  ' + parts.join('  '));
    }
    lines.push('');
    lines.push('── TIMELINE ────────────────────────────────────────────────');
    lines.push('Total estimated time: ' + plan.timeline.totalHours + ' hours');
    for (var ti = 0; ti < plan.timeline.phases.length; ti++) {
        var phase = plan.timeline.phases[ti];
        lines.push('  ' + phase.name + ': ' + phase.durationMin + ' min');
    }
    lines.push('');
    lines.push('── RISK ASSESSMENT ─────────────────────────────────────────');
    lines.push('Overall risk: ' + plan.risks.overallRiskLevel + ' (score: ' + plan.risks.overallRiskScore + '/100)');
    if (plan.risks.mitigations.length > 0) {
        lines.push('Key mitigations:');
        for (var mi = 0; mi < Math.min(plan.risks.mitigations.length, 5); mi++) {
            lines.push('  • ' + plan.risks.mitigations[mi].action);
        }
    }
    lines.push('');
    lines.push('── RESOURCES ───────────────────────────────────────────────');
    lines.push('Estimated cost: $' + plan.resources.estimatedCost.amount);
    lines.push('Materials:');
    for (var mti = 0; mti < plan.resources.materials.length; mti++) {
        var mat = plan.resources.materials[mti];
        lines.push('  • ' + mat.name + ': ' + mat.quantity + ' ' + mat.unit);
    }
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════');

    return lines.join('\n');
}

// ── Factory ────────────────────────────────────────────────────────

function createExperimentPlanner() {
    var plans = {};

    function plan(goal, options) {
        options = options || {};
        var goalAnalysis = parseGoal(goal);
        var paramSpace = buildParameterSpace(goalAnalysis, options);
        var strategy = options.strategy || selectDesignStrategy(
            paramSpace.factors.length,
            options.levelsPerFactor || 3,
            goalAnalysis.type
        );
        var matrix = buildMatrix(paramSpace, strategy, options);
        var risks = assessConditionRisks(matrix.conditions, goalAnalysis, paramSpace);
        var timeline = estimateTimeline(matrix, options);
        var resources = estimateResources(matrix, paramSpace);
        var alternatives = generateAlternatives(goalAnalysis, paramSpace, strategy);

        var planId = generateId();
        var result = {
            planId: planId,
            goalAnalysis: goalAnalysis,
            parameterSpace: paramSpace,
            experimentMatrix: matrix,
            risks: risks,
            timeline: timeline,
            resources: resources,
            alternatives: alternatives,
            results: [],
            summary: matrix.strategy + ' design with ' + matrix.conditionCount + ' conditions × ' +
                     matrix.replicates + ' replicates = ' + matrix.totalRuns + ' total runs. ' +
                     'Estimated ' + timeline.totalHours + ' hours. ' +
                     'Risk level: ' + risks.overallRiskLevel + '.'
        };
        plans[planId] = result;
        return result;
    }

    function feedResults(planId, results) {
        if (!plans[planId]) throw new Error('Unknown plan: ' + planId);
        if (!Array.isArray(results)) results = [results];
        for (var i = 0; i < results.length; i++) {
            plans[planId].results.push(results[i]);
        }
    }

    function replan(planId) {
        if (!plans[planId]) throw new Error('Unknown plan: ' + planId);
        var p = plans[planId];
        var results = p.results;
        if (results.length === 0) return p; // no results to adapt on

        // Analyze results to narrow parameter ranges
        var scored = results.filter(function(r) { return r.score !== undefined; });
        if (scored.length === 0) return p;

        // Sort by score descending
        scored.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });

        // Take top 30% conditions as "promising"
        var topN = Math.max(1, Math.ceil(scored.length * 0.3));
        var top = scored.slice(0, topN);

        // Narrow factor ranges to span of top performers + 10% margin
        var newFactors = [];
        for (var fi = 0; fi < p.parameterSpace.factors.length; fi++) {
            var fac = p.parameterSpace.factors[fi];
            var vals = [];
            for (var ti = 0; ti < top.length; ti++) {
                if (top[ti].condition && top[ti].condition[fac.name] !== undefined) {
                    vals.push(top[ti].condition[fac.name]);
                }
            }
            if (vals.length > 0) {
                var min = Math.min.apply(null, vals);
                var max = Math.max.apply(null, vals);
                var margin = (max - min) * 0.1 || (fac.range[1] - fac.range[0]) * 0.05;
                var newRange = [
                    round2(Math.max(fac.range[0], min - margin)),
                    round2(Math.min(fac.range[1], max + margin))
                ];
                newFactors.push({
                    name: fac.name,
                    range: newRange,
                    unit: fac.unit,
                    levels: linspace(newRange[0], newRange[1], fac.levels.length)
                });
            } else {
                newFactors.push(fac);
            }
        }

        // Rebuild with narrowed space
        var newParamSpace = Object.assign({}, p.parameterSpace, { factors: newFactors });
        var strategy = selectDesignStrategy(newFactors.length, newFactors[0].levels.length, p.goalAnalysis.type);
        var matrix = buildMatrix(newParamSpace, strategy);
        var risks = assessConditionRisks(matrix.conditions, p.goalAnalysis, newParamSpace);
        var timeline = estimateTimeline(matrix);
        var resources = estimateResources(matrix, newParamSpace);

        var newPlan = {
            planId: p.planId,
            goalAnalysis: p.goalAnalysis,
            parameterSpace: newParamSpace,
            experimentMatrix: matrix,
            risks: risks,
            timeline: timeline,
            resources: resources,
            alternatives: p.alternatives,
            results: p.results,
            replanIteration: (p.replanIteration || 0) + 1,
            narrowedFrom: p.parameterSpace.factors.map(function(f) { return f.name + ': [' + f.range.join(', ') + ']'; }),
            narrowedTo: newFactors.map(function(f) { return f.name + ': [' + f.range.join(', ') + ']'; }),
            summary: 'Replanned (iteration ' + ((p.replanIteration || 0) + 1) + '): ' +
                     matrix.strategy + ' design with ' + matrix.conditionCount + ' conditions, ' +
                     'narrowed ranges based on ' + topN + ' top-performing results.'
        };
        plans[planId] = newPlan;
        return newPlan;
    }

    return {
        plan: plan,
        feedResults: feedResults,
        replan: replan,
        estimateTimeline: function(matrix, opts) { return estimateTimeline(matrix, opts); },
        estimateResources: function(matrix, paramSpace) { return estimateResources(matrix, paramSpace || { materialInfo: MATERIALS.alginate, material: 'alginate' }); },
        assessRisks: function(matrix, goalAnalysis, paramSpace) {
            goalAnalysis = goalAnalysis || { cellTypes: [], materials: ['alginate'] };
            paramSpace = paramSpace || { factors: [], materialInfo: MATERIALS.alginate };
            return assessConditionRisks(matrix.conditions || matrix, goalAnalysis, paramSpace);
        },
        getSuggestedParameters: function(goalType, material) {
            var mat = MATERIALS[material] || MATERIALS.alginate;
            var suggestions = {
                concentration: { range: mat.concentrationRange, unit: mat.concentrationUnit },
                temperature: { range: mat.temperatureRange, unit: '°C' },
                crosslinkTime: { range: mat.crosslinkTimeRange, unit: 'min' },
                printSpeed: { range: mat.printSpeedRange, unit: 'mm/s' },
                pressure: { range: mat.pressureRange, unit: 'kPa' }
            };
            return { material: material || 'alginate', goalType: goalType, parameters: suggestions };
        },
        getDesignStrategy: function(numFactors, numLevels, goalType) {
            return selectDesignStrategy(numFactors, numLevels, goalType);
        },
        toProtocol: toProtocol,
        toJSON: function(thePlan) {
            return JSON.parse(JSON.stringify(thePlan));
        }
    };
}

// ── Export ──────────────────────────────────────────────────────────

module.exports = { createExperimentPlanner: createExperimentPlanner };
