'use strict';

/**
 * Tissue Maturation Simulator
 *
 * Models post-print tissue development in bioprinted constructs over culture
 * time. Tracks cell proliferation (logistic growth), ECM deposition (collagen,
 * GAGs, elastin), mechanical property evolution, nutrient/oxygen gradients,
 * and overall tissue maturity scoring.
 *
 * Usage:
 *   const { createMaturationSimulator } = require('./maturation');
 *   const sim = createMaturationSimulator();
 *   const growth = sim.cellGrowth({ initialDensity: 1e6, days: 28 });
 *   const ecm = sim.ecmDeposition({ cellType: 'chondrocyte', days: 21 });
 *   const mech = sim.mechanicalEvolution({ tissueType: 'cartilage', days: 28 });
 *   const report = sim.fullReport({ tissueType: 'cartilage', days: 28 });
 */

// ── Cell type profiles ──

const CELL_PROFILES = {
  'chondrocyte': {
    name: 'Chondrocyte',
    doublingTimeHours: 48,
    carryingCapacity: 50e6, // cells/mL at confluence
    deathRate: 0.005, // day^-1 baseline
    oxygenConsumption: 2.5e-17, // mol/cell/s
    nutrientConsumption: 5e-14, // mol/cell/s (glucose)
    ecmProfile: {
      collagen: { type: 'II', maxRate: 0.08, onsetDay: 3, peakDay: 14 },
      gag: { maxRate: 0.12, onsetDay: 2, peakDay: 10 },
      elastin: { maxRate: 0.01, onsetDay: 7, peakDay: 21 },
    },
    maturationMarkers: ['SOX9', 'COL2A1', 'ACAN'],
  },
  'osteoblast': {
    name: 'Osteoblast',
    doublingTimeHours: 60,
    carryingCapacity: 30e6,
    deathRate: 0.008,
    oxygenConsumption: 4e-17,
    nutrientConsumption: 8e-14,
    ecmProfile: {
      collagen: { type: 'I', maxRate: 0.10, onsetDay: 5, peakDay: 14 },
      gag: { maxRate: 0.03, onsetDay: 4, peakDay: 12 },
      elastin: { maxRate: 0.005, onsetDay: 10, peakDay: 25 },
      mineral: { maxRate: 0.06, onsetDay: 14, peakDay: 28 },
    },
    maturationMarkers: ['RUNX2', 'OCN', 'ALP', 'BSP'],
  },
  'fibroblast': {
    name: 'Fibroblast',
    doublingTimeHours: 24,
    carryingCapacity: 80e6,
    deathRate: 0.003,
    oxygenConsumption: 3e-17,
    nutrientConsumption: 6e-14,
    ecmProfile: {
      collagen: { type: 'I', maxRate: 0.15, onsetDay: 1, peakDay: 7 },
      gag: { maxRate: 0.05, onsetDay: 2, peakDay: 10 },
      elastin: { maxRate: 0.04, onsetDay: 5, peakDay: 14 },
    },
    maturationMarkers: ['COL1A1', 'FN1', 'VIM'],
  },
  'cardiomyocyte': {
    name: 'Cardiomyocyte',
    doublingTimeHours: 120,
    carryingCapacity: 20e6,
    deathRate: 0.012,
    oxygenConsumption: 8e-17,
    nutrientConsumption: 12e-14,
    ecmProfile: {
      collagen: { type: 'I', maxRate: 0.06, onsetDay: 5, peakDay: 18 },
      gag: { maxRate: 0.02, onsetDay: 4, peakDay: 14 },
      elastin: { maxRate: 0.08, onsetDay: 7, peakDay: 21 },
    },
    maturationMarkers: ['TNNT2', 'MYH7', 'NKX2-5'],
  },
  'hepatocyte': {
    name: 'Hepatocyte',
    doublingTimeHours: 72,
    carryingCapacity: 40e6,
    deathRate: 0.010,
    oxygenConsumption: 6e-17,
    nutrientConsumption: 10e-14,
    ecmProfile: {
      collagen: { type: 'IV', maxRate: 0.04, onsetDay: 3, peakDay: 12 },
      gag: { maxRate: 0.06, onsetDay: 2, peakDay: 10 },
      elastin: { maxRate: 0.01, onsetDay: 8, peakDay: 20 },
    },
    maturationMarkers: ['ALB', 'HNF4A', 'CYP3A4'],
  },
  'msc': {
    name: 'Mesenchymal Stem Cell',
    doublingTimeHours: 36,
    carryingCapacity: 60e6,
    deathRate: 0.004,
    oxygenConsumption: 2e-17,
    nutrientConsumption: 4e-14,
    ecmProfile: {
      collagen: { type: 'I', maxRate: 0.07, onsetDay: 2, peakDay: 10 },
      gag: { maxRate: 0.04, onsetDay: 3, peakDay: 12 },
      elastin: { maxRate: 0.02, onsetDay: 5, peakDay: 15 },
    },
    maturationMarkers: ['CD73', 'CD90', 'CD105'],
  },
};

// ── Tissue type targets ──

const TISSUE_TARGETS = {
  'cartilage': {
    name: 'Articular Cartilage',
    preferredCell: 'chondrocyte',
    targetModulusKPa: 800,
    targetUTS_KPa: 25000,
    targetCollagenPct: 60,
    targetGAGPct: 25,
    targetCellDensity: 15e6,
    maturationDays: 42,
  },
  'bone': {
    name: 'Trabecular Bone',
    preferredCell: 'osteoblast',
    targetModulusKPa: 500000,
    targetUTS_KPa: 10000,
    targetCollagenPct: 30,
    targetGAGPct: 5,
    targetCellDensity: 10e6,
    maturationDays: 56,
  },
  'skin': {
    name: 'Dermal Tissue',
    preferredCell: 'fibroblast',
    targetModulusKPa: 50,
    targetUTS_KPa: 15000,
    targetCollagenPct: 70,
    targetGAGPct: 10,
    targetCellDensity: 40e6,
    maturationDays: 28,
  },
  'cardiac': {
    name: 'Cardiac Tissue',
    preferredCell: 'cardiomyocyte',
    targetModulusKPa: 20,
    targetUTS_KPa: 100,
    targetCollagenPct: 25,
    targetGAGPct: 8,
    targetCellDensity: 15e6,
    maturationDays: 35,
  },
  'liver': {
    name: 'Hepatic Tissue',
    preferredCell: 'hepatocyte',
    targetModulusKPa: 6,
    targetUTS_KPa: 50,
    targetCollagenPct: 20,
    targetGAGPct: 15,
    targetCellDensity: 25e6,
    maturationDays: 21,
  },
};

// ── Helper functions ──

function validatePositive(val, name) {
  if (typeof val !== 'number' || !isFinite(val) || val <= 0) {
    throw new Error(`${name} must be a positive finite number, got ${val}`);
  }
}

function validateNonNegative(val, name) {
  if (typeof val !== 'number' || !isFinite(val) || val < 0) {
    throw new Error(`${name} must be a non-negative finite number, got ${val}`);
  }
}

function getCellProfile(cellType) {
  const p = CELL_PROFILES[cellType];
  if (!p) throw new Error(`Unknown cell type: ${cellType}. Available: ${Object.keys(CELL_PROFILES).join(', ')}`);
  return p;
}

function getTissueTarget(tissueType) {
  const t = TISSUE_TARGETS[tissueType];
  if (!t) throw new Error(`Unknown tissue type: ${tissueType}. Available: ${Object.keys(TISSUE_TARGETS).join(', ')}`);
  return t;
}

// ── Logistic growth model ──

function logisticGrowth(N0, K, r, t) {
  // N(t) = K / (1 + ((K - N0) / N0) * exp(-r * t))
  return K / (1 + ((K - N0) / N0) * Math.exp(-r * t));
}

// ── Sigmoid onset function (smooth activation) ──

function sigmoidOnset(day, onsetDay, steepness) {
  steepness = steepness || 2;
  return 1 / (1 + Math.exp(-steepness * (day - onsetDay)));
}

// ── Gaussian-like production rate (rises then falls) ──

function productionRate(day, onsetDay, peakDay, maxRate) {
  if (day < 0) return 0;
  const sigma = (peakDay - onsetDay) * 0.8;
  if (sigma <= 0) return maxRate;
  const onset = sigmoidOnset(day, onsetDay, 2);
  const gaussian = Math.exp(-0.5 * Math.pow((day - peakDay) / sigma, 2));
  return maxRate * onset * gaussian;
}

// ── Oxygen/nutrient diffusion (simplified Krogh model) ──

function oxygenProfile(thicknessMm, cellDensity, consumptionRate, surfaceConc) {
  // Simplified 1D steady-state diffusion
  // C(x) = C0 - (Q * x^2) / (2 * D)
  // D_O2 in hydrogel ~2.5e-9 m^2/s
  const D = 2.5e-9; // m^2/s
  const L = thicknessMm * 1e-3; // convert to meters
  const Q = cellDensity * 1e6 * consumptionRate; // volumetric consumption (mol/m^3/s)
  const C0 = surfaceConc || 0.21e-3; // ~0.21 mM at surface (atmospheric)
  
  const steps = 20;
  const profile = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * L;
    const C = Math.max(0, C0 - (Q * x * x) / (2 * D));
    profile.push({
      depthMm: (x * 1000),
      concentrationMM: C * 1000, // convert to mM
      fractionOfSurface: C / C0,
    });
  }
  
  // Critical depth where oxygen reaches zero
  const criticalDepthM = Math.sqrt((2 * D * C0) / Math.max(Q, 1e-30));
  const criticalDepthMm = criticalDepthM * 1000;
  
  return {
    profile,
    criticalDepthMm: Math.min(criticalDepthMm, thicknessMm),
    isHypoxic: criticalDepthMm < thicknessMm,
    surfaceConcentrationMM: C0 * 1000,
    diffusionCoefficient: D,
  };
}

// ── Main factory ──

function createMaturationSimulator(opts) {
  opts = opts || {};

  /**
   * Simulate cell proliferation over time using logistic growth.
   */
  function cellGrowth(params) {
    params = params || {};
    const cellType = params.cellType || 'fibroblast';
    const cell = getCellProfile(cellType);
    const initialDensity = params.initialDensity || 1e6; // cells/mL
    const days = params.days || 14;
    const tempC = params.tempC || 37;

    validatePositive(initialDensity, 'initialDensity');
    validatePositive(days, 'days');

    // Growth rate from doubling time, adjusted for temperature
    const baseRate = (Math.log(2) / (cell.doublingTimeHours / 24)); // day^-1
    const tempFactor = Math.exp(-0.05 * Math.abs(tempC - 37)); // optimal at 37°C
    const netRate = (baseRate * tempFactor) - cell.deathRate;
    const K = cell.carryingCapacity;

    const curve = [];
    for (let d = 0; d <= days; d++) {
      const density = logisticGrowth(initialDensity, K, netRate, d);
      const viability = Math.max(0.5, 1 - cell.deathRate * d * 0.02);
      curve.push({
        day: d,
        density: Math.round(density),
        viability: Math.min(1, viability),
        doublings: Math.log2(density / initialDensity),
        phaseLabel: density < K * 0.1 ? 'lag' :
                    density < K * 0.8 ? 'exponential' :
                    'plateau',
      });
    }

    const finalDensity = curve[curve.length - 1].density;
    return {
      cellType,
      initialDensity,
      finalDensity,
      foldExpansion: finalDensity / initialDensity,
      carryingCapacity: K,
      netGrowthRate: netRate,
      temperatureFactor: tempFactor,
      curve,
    };
  }

  /**
   * Model ECM component deposition over culture time.
   */
  function ecmDeposition(params) {
    params = params || {};
    const cellType = params.cellType || 'chondrocyte';
    const cell = getCellProfile(cellType);
    const days = params.days || 21;
    const cellDensity = params.cellDensity || 5e6;

    validatePositive(days, 'days');
    validatePositive(cellDensity, 'cellDensity');

    const ecm = cell.ecmProfile;
    const components = {};

    for (const [name, config] of Object.entries(ecm)) {
      const curve = [];
      let cumulative = 0;
      for (let d = 0; d <= days; d++) {
        const rate = productionRate(d, config.onsetDay, config.peakDay, config.maxRate);
        // Scale by cell density (normalized to 10M cells/mL)
        const scaledRate = rate * (cellDensity / 10e6);
        cumulative += scaledRate;
        curve.push({
          day: d,
          rate: scaledRate,
          cumulative,
          percentOfMax: (cumulative / (config.maxRate * days)) * 100,
        });
      }
      components[name] = {
        type: config.type || name,
        onsetDay: config.onsetDay,
        peakDay: config.peakDay,
        maxRate: config.maxRate,
        totalDeposited: cumulative,
        curve,
      };
    }

    return {
      cellType,
      days,
      cellDensity,
      components,
      dominantComponent: Object.entries(components)
        .sort((a, b) => b[1].totalDeposited - a[1].totalDeposited)[0][0],
    };
  }

  /**
   * Model mechanical property evolution during maturation.
   */
  function mechanicalEvolution(params) {
    params = params || {};
    const tissueType = params.tissueType || 'cartilage';
    const target = getTissueTarget(tissueType);
    const cell = getCellProfile(target.preferredCell);
    const days = params.days || target.maturationDays;
    const initialModulusKPa = params.initialModulusKPa || 1; // soft hydrogel start
    const cellDensity = params.cellDensity || 5e6;

    validatePositive(days, 'days');
    validatePositive(initialModulusKPa, 'initialModulusKPa');

    const targetMod = target.targetModulusKPa;
    // Mechanical properties improve with ECM deposition (sigmoid approach to target)
    const halfwayDay = target.maturationDays * 0.5;
    const steepness = 4 / target.maturationDays;

    const curve = [];
    for (let d = 0; d <= days; d++) {
      const matFraction = 1 / (1 + Math.exp(-steepness * (d - halfwayDay)));
      const modulus = initialModulusKPa + (targetMod - initialModulusKPa) * matFraction;
      // UTS follows similar pattern but with slight lag
      const utsMatFraction = 1 / (1 + Math.exp(-steepness * (d - halfwayDay * 1.2)));
      const uts = target.targetUTS_KPa * utsMatFraction;
      
      curve.push({
        day: d,
        modulusKPa: modulus,
        utsKPa: uts,
        maturationFraction: matFraction,
        meetsTarget: modulus >= targetMod * 0.8,
      });
    }

    const final = curve[curve.length - 1];
    return {
      tissueType,
      targetModulusKPa: targetMod,
      targetUTS_KPa: target.targetUTS_KPa,
      finalModulusKPa: final.modulusKPa,
      finalUTS_KPa: final.utsKPa,
      percentOfTarget: (final.modulusKPa / targetMod) * 100,
      daysToTarget80Pct: curve.findIndex(p => p.meetsTarget),
      curve,
    };
  }

  /**
   * Calculate oxygen/nutrient limitation profiles.
   */
  function nutrientAnalysis(params) {
    params = params || {};
    const cellType = params.cellType || 'chondrocyte';
    const cell = getCellProfile(cellType);
    const thicknessMm = params.thicknessMm || 2;
    const cellDensity = params.cellDensity || 10e6;

    validatePositive(thicknessMm, 'thicknessMm');
    validatePositive(cellDensity, 'cellDensity');

    const o2 = oxygenProfile(thicknessMm, cellDensity, cell.oxygenConsumption);
    
    // Maximum viable construct thickness
    const maxThickness = o2.criticalDepthMm;

    // Recommendations
    const recommendations = [];
    if (o2.isHypoxic) {
      recommendations.push(`Construct is hypoxic beyond ${maxThickness.toFixed(2)} mm depth`);
      recommendations.push('Consider adding perfusion channels or reducing thickness');
      if (cellDensity > 20e6) {
        recommendations.push('Reduce cell seeding density to decrease oxygen demand');
      }
    }
    if (thicknessMm > 3) {
      recommendations.push('Thick constructs (>3mm) benefit from bioreactor perfusion');
    }

    return {
      cellType,
      thicknessMm,
      cellDensity,
      oxygenProfile: o2,
      maxViableThicknessMm: maxThickness,
      isViable: !o2.isHypoxic,
      recommendations,
    };
  }

  /**
   * Compute a composite tissue maturity score (0-100).
   */
  function maturityScore(params) {
    params = params || {};
    const tissueType = params.tissueType || 'cartilage';
    const target = getTissueTarget(tissueType);
    const cell = getCellProfile(target.preferredCell);
    const day = params.day || 14;
    const initialDensity = params.initialDensity || 1e6;
    const cellDensityOverride = params.cellDensity;

    validateNonNegative(day, 'day');

    // Get cell density at this day
    const growthResult = cellGrowth({
      cellType: target.preferredCell,
      initialDensity,
      days: day,
    });
    const currentDensity = cellDensityOverride || growthResult.finalDensity;

    // ECM score
    const ecmResult = ecmDeposition({
      cellType: target.preferredCell,
      days: day,
      cellDensity: currentDensity,
    });
    const ecmTotal = Object.values(ecmResult.components)
      .reduce((s, c) => s + c.totalDeposited, 0);
    // Normalize to expected total at full maturation
    const ecmAtFull = Object.values(cell.ecmProfile)
      .reduce((s, c) => s + c.maxRate * target.maturationDays, 0);
    const ecmScore = Math.min(100, (ecmTotal / ecmAtFull) * 100);

    // Mechanical score
    const mechResult = mechanicalEvolution({ tissueType, days: day });
    const mechScore = Math.min(100, mechResult.percentOfTarget);

    // Cell density score
    const densityScore = Math.min(100, (currentDensity / target.targetCellDensity) * 100);

    // Time score (how close to expected maturation)
    const timeScore = Math.min(100, (day / target.maturationDays) * 100);

    // Composite (weighted)
    const weights = { ecm: 0.35, mechanical: 0.30, density: 0.20, time: 0.15 };
    const composite = (
      ecmScore * weights.ecm +
      mechScore * weights.mechanical +
      densityScore * weights.density +
      timeScore * weights.time
    );

    const grade = composite >= 90 ? 'A' :
                  composite >= 75 ? 'B' :
                  composite >= 60 ? 'C' :
                  composite >= 40 ? 'D' : 'F';

    return {
      tissueType,
      day,
      composite: Math.round(composite * 10) / 10,
      grade,
      dimensions: {
        ecm: { score: Math.round(ecmScore * 10) / 10, weight: weights.ecm },
        mechanical: { score: Math.round(mechScore * 10) / 10, weight: weights.mechanical },
        cellDensity: { score: Math.round(densityScore * 10) / 10, weight: weights.density },
        time: { score: Math.round(timeScore * 10) / 10, weight: weights.time },
      },
      currentDensity: Math.round(currentDensity),
      targetDensity: target.targetCellDensity,
    };
  }

  /**
   * Compare maturation trajectories across tissue types.
   */
  function compareTrajectories(params) {
    params = params || {};
    const tissueTypes = params.tissueTypes || Object.keys(TISSUE_TARGETS);
    const days = params.days || 28;
    const interval = params.interval || 7;

    validatePositive(days, 'days');
    validatePositive(interval, 'interval');

    const trajectories = {};
    for (const tt of tissueTypes) {
      const scores = [];
      for (let d = 0; d <= days; d += interval) {
        scores.push(maturityScore({ tissueType: tt, day: d }));
      }
      trajectories[tt] = {
        tissueName: TISSUE_TARGETS[tt].name,
        maturationDays: TISSUE_TARGETS[tt].maturationDays,
        scores,
        finalScore: scores[scores.length - 1].composite,
        finalGrade: scores[scores.length - 1].grade,
      };
    }

    // Rank by final score
    const ranked = Object.entries(trajectories)
      .sort((a, b) => b[1].finalScore - a[1].finalScore)
      .map(([k, v], i) => ({ rank: i + 1, tissueType: k, ...v }));

    return {
      days,
      interval,
      trajectories,
      ranked,
    };
  }

  /**
   * Estimate optimal culture duration for a tissue type.
   */
  function optimalCultureTime(params) {
    params = params || {};
    const tissueType = params.tissueType || 'cartilage';
    const targetGrade = params.targetGrade || 'B';
    const maxDays = params.maxDays || 90;

    const gradeThresholds = { 'A': 90, 'B': 75, 'C': 60, 'D': 40 };
    const threshold = gradeThresholds[targetGrade];
    if (threshold === undefined) {
      throw new Error(`Invalid grade: ${targetGrade}. Use A, B, C, or D`);
    }

    let optimalDay = null;
    const scores = [];
    for (let d = 0; d <= maxDays; d++) {
      const s = maturityScore({ tissueType, day: d });
      scores.push(s);
      if (optimalDay === null && s.composite >= threshold) {
        optimalDay = d;
      }
    }

    // Find diminishing returns point (where daily improvement < 0.5%)
    let diminishingDay = null;
    for (let i = 1; i < scores.length; i++) {
      const improvement = scores[i].composite - scores[i - 1].composite;
      if (improvement < 0.5 && scores[i].composite > 50) {
        diminishingDay = i;
        break;
      }
    }

    return {
      tissueType,
      targetGrade,
      optimalDay,
      achieved: optimalDay !== null,
      diminishingReturnsDay: diminishingDay,
      recommendation: optimalDay !== null
        ? `Culture for ${optimalDay} days to achieve grade ${targetGrade} (score ≥${threshold})`
        : `Grade ${targetGrade} not achievable within ${maxDays} days`,
      scoreAtOptimal: optimalDay !== null ? scores[optimalDay] : null,
    };
  }

  /**
   * Generate a comprehensive maturation report.
   */
  function fullReport(params) {
    params = params || {};
    const tissueType = params.tissueType || 'cartilage';
    const days = params.days || 28;
    const initialDensity = params.initialDensity || 1e6;
    const thicknessMm = params.thicknessMm || 2;

    const target = getTissueTarget(tissueType);
    const cellType = target.preferredCell;

    const growth = cellGrowth({ cellType, initialDensity, days });
    const ecm = ecmDeposition({ cellType, days, cellDensity: growth.finalDensity });
    const mech = mechanicalEvolution({ tissueType, days });
    const nutrients = nutrientAnalysis({ cellType, thicknessMm, cellDensity: growth.finalDensity });
    const score = maturityScore({ tissueType, day: days, initialDensity });
    const optimal = optimalCultureTime({ tissueType });

    // Weekly maturity snapshots
    const weeklyScores = [];
    for (let d = 0; d <= days; d += 7) {
      weeklyScores.push(maturityScore({ tissueType, day: d, initialDensity }));
    }

    // Alerts
    const alerts = [];
    if (nutrients.oxygenProfile.isHypoxic) {
      alerts.push({ level: 'warning', message: `Oxygen limitation at ${nutrients.maxViableThicknessMm.toFixed(1)}mm depth` });
    }
    if (score.composite < 50) {
      alerts.push({ level: 'warning', message: `Low maturity score (${score.composite}) at day ${days}` });
    }
    if (growth.foldExpansion < 2) {
      alerts.push({ level: 'warning', message: 'Low cell expansion — check seeding density and culture conditions' });
    }
    if (mech.percentOfTarget < 50) {
      alerts.push({ level: 'info', message: 'Mechanical properties below 50% of target — extended culture recommended' });
    }

    return {
      tissueType,
      tissueName: target.name,
      cellType,
      days,
      cellGrowth: {
        initial: initialDensity,
        final: growth.finalDensity,
        foldExpansion: growth.foldExpansion,
      },
      ecmSummary: {
        dominantComponent: ecm.dominantComponent,
        components: Object.fromEntries(
          Object.entries(ecm.components).map(([k, v]) => [k, { total: v.totalDeposited }])
        ),
      },
      mechanicalProperties: {
        modulusKPa: mech.finalModulusKPa,
        utsKPa: mech.finalUTS_KPa,
        percentOfTarget: mech.percentOfTarget,
      },
      nutrientStatus: {
        isViable: nutrients.isViable,
        maxThicknessMm: nutrients.maxViableThicknessMm,
      },
      maturityScore: score,
      weeklyProgress: weeklyScores.map(s => ({ day: s.day, score: s.composite, grade: s.grade })),
      optimalCulture: {
        recommendedDays: optimal.optimalDay,
        diminishingReturnsDay: optimal.diminishingReturnsDay,
      },
      alerts,
    };
  }

  return {
    cellGrowth,
    ecmDeposition,
    mechanicalEvolution,
    nutrientAnalysis,
    maturityScore,
    compareTrajectories,
    optimalCultureTime,
    fullReport,
    // Expose for testing
    _profiles: { cells: CELL_PROFILES, tissues: TISSUE_TARGETS },
  };
}

module.exports = { createMaturationSimulator };
