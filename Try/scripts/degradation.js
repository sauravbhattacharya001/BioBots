'use strict';

/**
 * Scaffold Degradation Predictor
 *
 * Models and predicts scaffold degradation over time for bioprinted tissue
 * engineering constructs. Supports hydrolytic, enzymatic, and oxidative
 * degradation kinetics. Calculates mass loss curves, mechanical property
 * decay, molecular weight evolution, and estimates functional lifetime.
 *
 * Usage:
 *   const { createDegradationPredictor } = require('./degradation');
 *   const pred = createDegradationPredictor();
 *   const curve = pred.massCurve('PLA', { days: 90, tempC: 37, pH: 7.4 });
 *   const life = pred.functionalLifetime('GelMA 5%', { minMassFraction: 0.5 });
 *   const report = pred.fullReport('Alginate 2%', { days: 60 });
 */

// ── Material profiles with degradation parameters ──

const MATERIAL_PROFILES = {
  'PLA': {
    name: 'Polylactic Acid',
    type: 'synthetic',
    degradationMechanisms: ['hydrolytic'],
    // Hydrolytic rate constant at reference conditions (day^-1)
    kHydrolytic: 0.008,
    refTempC: 37,
    refPH: 7.4,
    activationEnergyKJ: 80, // Arrhenius Ea (kJ/mol)
    phSensitivity: 0.3, // rate multiplier per pH unit from neutral
    initialMwKDa: 100,
    mwHalfLifeDays: 90,
    // Mechanical decay tracks mass loss with lag
    mechLagFraction: 0.15, // mass fraction lost before mechanical decay begins
    mechDecayRate: 1.5, // relative to mass loss rate
    bulkDensityGcm3: 1.24,
    crystallinity: 0.35,
    crystallinityEffect: 0.4, // higher crystallinity slows degradation
  },
  'PLGA 50:50': {
    name: 'Poly(lactic-co-glycolic acid) 50:50',
    type: 'synthetic',
    degradationMechanisms: ['hydrolytic'],
    kHydrolytic: 0.025,
    refTempC: 37,
    refPH: 7.4,
    activationEnergyKJ: 75,
    phSensitivity: 0.35,
    initialMwKDa: 50,
    mwHalfLifeDays: 30,
    mechLagFraction: 0.10,
    mechDecayRate: 1.8,
    bulkDensityGcm3: 1.34,
    crystallinity: 0.0,
    crystallinityEffect: 0.4,
  },
  'PLGA 75:25': {
    name: 'Poly(lactic-co-glycolic acid) 75:25',
    type: 'synthetic',
    degradationMechanisms: ['hydrolytic'],
    kHydrolytic: 0.012,
    refTempC: 37,
    refPH: 7.4,
    activationEnergyKJ: 78,
    phSensitivity: 0.32,
    initialMwKDa: 70,
    mwHalfLifeDays: 60,
    mechLagFraction: 0.12,
    mechDecayRate: 1.6,
    bulkDensityGcm3: 1.30,
    crystallinity: 0.15,
    crystallinityEffect: 0.4,
  },
  'PCL': {
    name: 'Polycaprolactone',
    type: 'synthetic',
    degradationMechanisms: ['hydrolytic'],
    kHydrolytic: 0.001,
    refTempC: 37,
    refPH: 7.4,
    activationEnergyKJ: 65,
    phSensitivity: 0.2,
    initialMwKDa: 80,
    mwHalfLifeDays: 365,
    mechLagFraction: 0.20,
    mechDecayRate: 1.2,
    bulkDensityGcm3: 1.15,
    crystallinity: 0.50,
    crystallinityEffect: 0.5,
  },
  'GelMA 5%': {
    name: 'Gelatin Methacrylate 5%',
    type: 'natural',
    degradationMechanisms: ['enzymatic', 'hydrolytic'],
    kHydrolytic: 0.015,
    kEnzymatic: 0.04, // collagenase-driven
    enzymeConcentrationRef: 1.0, // U/mL reference
    refTempC: 37,
    refPH: 7.4,
    activationEnergyKJ: 50,
    phSensitivity: 0.4,
    initialMwKDa: 60,
    mwHalfLifeDays: 21,
    mechLagFraction: 0.05,
    mechDecayRate: 2.0,
    bulkDensityGcm3: 1.05,
    crystallinity: 0.0,
    crystallinityEffect: 0.0,
  },
  'Alginate 2%': {
    name: 'Sodium Alginate 2%',
    type: 'natural',
    degradationMechanisms: ['hydrolytic'],
    kHydrolytic: 0.02,
    refTempC: 37,
    refPH: 7.4,
    activationEnergyKJ: 45,
    phSensitivity: 0.5,
    initialMwKDa: 200,
    mwHalfLifeDays: 14,
    mechLagFraction: 0.08,
    mechDecayRate: 2.2,
    bulkDensityGcm3: 1.02,
    crystallinity: 0.0,
    crystallinityEffect: 0.0,
  },
  'Collagen I': {
    name: 'Type I Collagen',
    type: 'natural',
    degradationMechanisms: ['enzymatic', 'hydrolytic'],
    kHydrolytic: 0.005,
    kEnzymatic: 0.06,
    enzymeConcentrationRef: 1.0,
    refTempC: 37,
    refPH: 7.4,
    activationEnergyKJ: 55,
    phSensitivity: 0.45,
    initialMwKDa: 300,
    mwHalfLifeDays: 28,
    mechLagFraction: 0.05,
    mechDecayRate: 1.8,
    bulkDensityGcm3: 1.08,
    crystallinity: 0.10,
    crystallinityEffect: 0.2,
  },
  'Chitosan': {
    name: 'Chitosan',
    type: 'natural',
    degradationMechanisms: ['enzymatic', 'hydrolytic'],
    kHydrolytic: 0.010,
    kEnzymatic: 0.03,
    enzymeConcentrationRef: 1.0,
    refTempC: 37,
    refPH: 7.4,
    activationEnergyKJ: 52,
    phSensitivity: 0.6, // chitosan is very pH-sensitive
    initialMwKDa: 150,
    mwHalfLifeDays: 45,
    mechLagFraction: 0.10,
    mechDecayRate: 1.5,
    bulkDensityGcm3: 1.10,
    crystallinity: 0.20,
    crystallinityEffect: 0.3,
  },
};

// ── Constants ──

const R_GAS = 8.314e-3; // kJ/(mol·K)

// ── Utility functions ──

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

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

function resolveProfile(materialOrName) {
  if (typeof materialOrName === 'string') {
    const profile = MATERIAL_PROFILES[materialOrName];
    if (!profile) {
      throw new Error(`Unknown material: "${materialOrName}". Available: ${Object.keys(MATERIAL_PROFILES).join(', ')}`);
    }
    return { ...profile };
  }
  if (typeof materialOrName === 'object' && materialOrName !== null) {
    // Custom material — validate required fields
    const required = ['name', 'degradationMechanisms', 'kHydrolytic', 'refTempC', 'refPH'];
    for (const field of required) {
      if (materialOrName[field] == null) {
        throw new Error(`Custom material missing required field: ${field}`);
      }
    }
    return { ...materialOrName };
  }
  throw new Error('Material must be a string name or object profile');
}

// ── Core kinetics ──

/**
 * Arrhenius temperature correction factor.
 * k(T) = k(Tref) * exp[ (Ea/R) * (1/Tref - 1/T) ]
 */
function arrheniusFactor(tempC, refTempC, activationEnergyKJ) {
  const T = tempC + 273.15;
  const Tref = refTempC + 273.15;
  return Math.exp((activationEnergyKJ / R_GAS) * (1 / Tref - 1 / T));
}

/**
 * pH correction factor. Rate increases as pH deviates from neutral (7.4).
 * Acidic conditions accelerate hydrolysis more than basic.
 */
function phFactor(pH, refPH, sensitivity) {
  const delta = Math.abs(pH - refPH);
  // Acidic gets extra boost
  const acidBoost = pH < refPH ? 1.3 : 1.0;
  return 1 + sensitivity * delta * acidBoost;
}

/**
 * Crystallinity correction — higher crystallinity slows degradation.
 */
function crystallinityFactor(crystallinity, effect) {
  if (!crystallinity || !effect) return 1.0;
  return 1 - crystallinity * effect;
}

/**
 * Porosity correction — higher porosity increases surface area and accelerates degradation.
 */
function porosityFactor(porosity) {
  if (porosity == null) return 1.0;
  // Normalized: porosity 0.5 is baseline (factor=1), higher = faster
  return 0.5 + porosity;
}

/**
 * Compute effective degradation rate constant under given conditions.
 */
function effectiveRate(profile, conditions) {
  const tempC = conditions.tempC || profile.refTempC;
  const pH = conditions.pH != null ? conditions.pH : profile.refPH;
  const porosity = conditions.porosity;

  let kBase = profile.kHydrolytic;

  // Add enzymatic component if present
  if (profile.degradationMechanisms.includes('enzymatic') && profile.kEnzymatic) {
    const enzConc = conditions.enzymeConcentration || 0;
    const refConc = profile.enzymeConcentrationRef || 1.0;
    kBase += profile.kEnzymatic * (enzConc / refConc);
  }

  // Apply corrections
  const arrFactor = arrheniusFactor(tempC, profile.refTempC, profile.activationEnergyKJ || 60);
  const phCorr = phFactor(pH, profile.refPH, profile.phSensitivity || 0.3);
  const crystCorr = crystallinityFactor(profile.crystallinity, profile.crystallinityEffect);
  const porCorr = porosityFactor(porosity);

  return kBase * arrFactor * phCorr * crystCorr * porCorr;
}

// ── Prediction functions ──

/**
 * Generate mass loss curve over time.
 * Uses first-order degradation: M(t) = M0 * exp(-k * t)
 * With optional autocatalytic acceleration for synthetic polymers.
 */
function massCurve(profile, conditions) {
  const days = conditions.days || 90;
  const steps = conditions.steps || Math.min(days, 200);
  validatePositive(days, 'days');

  const k = effectiveRate(profile, conditions);
  const autocatalytic = profile.type === 'synthetic' ? (conditions.autocatalytic || 0.002) : 0;

  const curve = [];
  const dt = days / steps;

  let massFraction = 1.0;
  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    curve.push({
      day: Math.round(t * 100) / 100,
      massFraction: Math.round(massFraction * 10000) / 10000,
      massLossPercent: Math.round((1 - massFraction) * 10000) / 100,
    });
    // Autocatalytic: rate increases as degradation products accumulate
    const effectiveK = k * (1 + autocatalytic * (1 - massFraction) * t);
    massFraction *= Math.exp(-effectiveK * dt);
    massFraction = clamp(massFraction, 0, 1);
  }
  return curve;
}

/**
 * Molecular weight evolution over time.
 * Mn(t) = Mn0 * exp(-kMw * t) where kMw derived from half-life.
 */
function molecularWeightCurve(profile, conditions) {
  const days = conditions.days || 90;
  const steps = conditions.steps || Math.min(days, 200);
  validatePositive(days, 'days');

  const mw0 = profile.initialMwKDa || 100;
  const halfLife = profile.mwHalfLifeDays || 60;
  const kMw = Math.LN2 / halfLife;

  // Temperature correction for MW degradation too
  const tempC = conditions.tempC || profile.refTempC;
  const arrCorr = arrheniusFactor(tempC, profile.refTempC, profile.activationEnergyKJ || 60);

  const curve = [];
  const dt = days / steps;

  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    const mw = mw0 * Math.exp(-kMw * arrCorr * t);
    curve.push({
      day: Math.round(t * 100) / 100,
      mwKDa: Math.round(mw * 100) / 100,
      mwFraction: Math.round((mw / mw0) * 10000) / 10000,
    });
  }
  return curve;
}

/**
 * Mechanical property decay curve.
 * Mechanical strength decays after an initial lag phase.
 */
function mechanicalDecayCurve(profile, conditions) {
  const days = conditions.days || 90;
  const steps = conditions.steps || Math.min(days, 200);
  validatePositive(days, 'days');

  const k = effectiveRate(profile, conditions);
  const lagFraction = profile.mechLagFraction || 0.1;
  const mechRate = (profile.mechDecayRate || 1.5) * k;

  const massCurveData = massCurve(profile, conditions);
  const curve = [];

  for (let i = 0; i < massCurveData.length; i++) {
    const pt = massCurveData[i];
    const massLost = 1 - pt.massFraction;
    let mechFraction;
    if (massLost <= lagFraction) {
      // Lag phase — minimal mechanical loss
      mechFraction = 1 - (massLost / lagFraction) * 0.05;
    } else {
      // Active decay phase
      const decayTime = (massLost - lagFraction) / k;
      mechFraction = 0.95 * Math.exp(-mechRate * decayTime / (1 - lagFraction));
    }
    mechFraction = clamp(mechFraction, 0, 1);
    curve.push({
      day: pt.day,
      mechanicalFraction: Math.round(mechFraction * 10000) / 10000,
      mechanicalLossPercent: Math.round((1 - mechFraction) * 10000) / 100,
    });
  }
  return curve;
}

/**
 * Estimate functional lifetime — days until mass fraction drops below threshold.
 */
function functionalLifetime(profile, conditions) {
  const minMass = conditions.minMassFraction || 0.5;
  const minMech = conditions.minMechFraction || 0.3;

  // Binary search for mass threshold
  const k = effectiveRate(profile, conditions);
  if (k <= 0) return { massLifetimeDays: Infinity, mechLifetimeDays: Infinity, limitingFactor: 'none' };

  // Approximate mass lifetime from first-order: t = -ln(minMass) / k
  const massLifeApprox = -Math.log(minMass) / k;

  // Refine with actual curve
  const longDays = Math.max(massLifeApprox * 3, 365);
  const curve = massCurve(profile, { ...conditions, days: longDays, steps: 500 });
  const mechCurve = mechanicalDecayCurve(profile, { ...conditions, days: longDays, steps: 500 });

  let massLifetimeDays = longDays;
  for (const pt of curve) {
    if (pt.massFraction <= minMass) {
      massLifetimeDays = pt.day;
      break;
    }
  }

  let mechLifetimeDays = longDays;
  for (const pt of mechCurve) {
    if (pt.mechanicalFraction <= minMech) {
      mechLifetimeDays = pt.day;
      break;
    }
  }

  const limitingFactor = massLifetimeDays <= mechLifetimeDays ? 'mass' : 'mechanical';
  const effectiveLifetime = Math.min(massLifetimeDays, mechLifetimeDays);

  return {
    massLifetimeDays: Math.round(massLifetimeDays * 10) / 10,
    mechLifetimeDays: Math.round(mechLifetimeDays * 10) / 10,
    effectiveLifetimeDays: Math.round(effectiveLifetime * 10) / 10,
    limitingFactor,
    thresholds: { minMassFraction: minMass, minMechFraction: minMech },
  };
}

/**
 * Compare degradation of multiple materials under the same conditions.
 */
function compareMaterials(materialNames, conditions) {
  const results = [];
  for (const name of materialNames) {
    const profile = resolveProfile(name);
    const k = effectiveRate(profile, conditions);
    const lifetime = functionalLifetime(profile, conditions);
    const halfLife = k > 0 ? Math.LN2 / k : Infinity;
    results.push({
      material: profile.name || name,
      type: profile.type,
      mechanisms: profile.degradationMechanisms,
      effectiveRatePerDay: Math.round(k * 100000) / 100000,
      halfLifeDays: Math.round(halfLife * 10) / 10,
      ...lifetime,
    });
  }
  // Sort by effective lifetime descending
  results.sort((a, b) => b.effectiveLifetimeDays - a.effectiveLifetimeDays);
  return results;
}

/**
 * Sensitivity analysis — how parameters affect degradation rate.
 */
function sensitivityAnalysis(material, baseConditions) {
  const profile = resolveProfile(material);
  const baseRate = effectiveRate(profile, baseConditions);

  const factors = [];

  // Temperature sensitivity
  const tempRange = [30, 33, 37, 40, 43];
  const tempResults = tempRange.map(t => ({
    value: t,
    rate: effectiveRate(profile, { ...baseConditions, tempC: t }),
  }));
  factors.push({
    parameter: 'temperature (°C)',
    values: tempResults.map(r => r.value),
    rates: tempResults.map(r => Math.round(r.rate * 100000) / 100000),
    sensitivityIndex: Math.round(
      (tempResults[tempResults.length - 1].rate / tempResults[0].rate) * 100
    ) / 100,
  });

  // pH sensitivity
  const phRange = [5.0, 6.0, 7.0, 7.4, 8.0, 9.0];
  const phResults = phRange.map(p => ({
    value: p,
    rate: effectiveRate(profile, { ...baseConditions, pH: p }),
  }));
  factors.push({
    parameter: 'pH',
    values: phResults.map(r => r.value),
    rates: phResults.map(r => Math.round(r.rate * 100000) / 100000),
    sensitivityIndex: Math.round(
      (Math.max(...phResults.map(r => r.rate)) / Math.min(...phResults.map(r => r.rate))) * 100
    ) / 100,
  });

  // Porosity sensitivity
  const porRange = [0.2, 0.4, 0.6, 0.8, 0.95];
  const porResults = porRange.map(p => ({
    value: p,
    rate: effectiveRate(profile, { ...baseConditions, porosity: p }),
  }));
  factors.push({
    parameter: 'porosity',
    values: porResults.map(r => r.value),
    rates: porResults.map(r => Math.round(r.rate * 100000) / 100000),
    sensitivityIndex: Math.round(
      (porResults[porResults.length - 1].rate / porResults[0].rate) * 100
    ) / 100,
  });

  // Enzyme concentration (if enzymatic)
  if (profile.degradationMechanisms.includes('enzymatic')) {
    const enzRange = [0, 0.5, 1.0, 2.0, 5.0];
    const enzResults = enzRange.map(e => ({
      value: e,
      rate: effectiveRate(profile, { ...baseConditions, enzymeConcentration: e }),
    }));
    factors.push({
      parameter: 'enzyme concentration (U/mL)',
      values: enzResults.map(r => r.value),
      rates: enzResults.map(r => Math.round(r.rate * 100000) / 100000),
      sensitivityIndex: Math.round(
        (enzResults[enzResults.length - 1].rate / Math.max(enzResults[0].rate, 1e-10)) * 100
      ) / 100,
    });
  }

  return {
    material: profile.name || material,
    baseRate: Math.round(baseRate * 100000) / 100000,
    baseConditions,
    factors,
    mostSensitiveTo: factors.reduce((best, f) =>
      f.sensitivityIndex > best.sensitivityIndex ? f : best
    ).parameter,
  };
}

/**
 * Generate a comprehensive degradation report for a material.
 */
function fullReport(material, conditions) {
  const profile = resolveProfile(material);
  const conds = {
    tempC: 37,
    pH: 7.4,
    days: 90,
    ...conditions,
  };

  const k = effectiveRate(profile, conds);
  const mass = massCurve(profile, conds);
  const mw = molecularWeightCurve(profile, conds);
  const mech = mechanicalDecayCurve(profile, conds);
  const lifetime = functionalLifetime(profile, conds);
  const sensitivity = sensitivityAnalysis(material, conds);

  // Key time points
  const day30 = mass.find(p => p.day >= 30) || mass[mass.length - 1];
  const day60 = mass.find(p => p.day >= 60) || mass[mass.length - 1];
  const day90 = mass.find(p => p.day >= 90) || mass[mass.length - 1];

  const mech30 = mech.find(p => p.day >= 30) || mech[mech.length - 1];
  const mech60 = mech.find(p => p.day >= 60) || mech[mech.length - 1];
  const mech90 = mech.find(p => p.day >= 90) || mech[mech.length - 1];

  return {
    material: {
      name: profile.name || material,
      type: profile.type,
      mechanisms: profile.degradationMechanisms,
      initialMwKDa: profile.initialMwKDa,
    },
    conditions: conds,
    kinetics: {
      effectiveRatePerDay: Math.round(k * 100000) / 100000,
      halfLifeDays: Math.round((Math.LN2 / k) * 10) / 10,
    },
    timePoints: {
      day30: {
        massFraction: day30.massFraction,
        mechFraction: mech30.mechanicalFraction,
      },
      day60: {
        massFraction: day60.massFraction,
        mechFraction: mech60.mechanicalFraction,
      },
      day90: {
        massFraction: day90.massFraction,
        mechFraction: mech90.mechanicalFraction,
      },
    },
    lifetime,
    sensitivity: {
      mostSensitiveTo: sensitivity.mostSensitiveTo,
      factors: sensitivity.factors,
    },
    curves: {
      mass,
      molecularWeight: mw,
      mechanical: mech,
    },
  };
}

// ── Tissue-specific degradation targets ──

const TISSUE_TARGETS = {
  bone: { minLifetimeDays: 180, idealLifetimeDays: 365, minMechFraction: 0.5 },
  cartilage: { minLifetimeDays: 90, idealLifetimeDays: 180, minMechFraction: 0.3 },
  skin: { minLifetimeDays: 21, idealLifetimeDays: 60, minMechFraction: 0.2 },
  vascular: { minLifetimeDays: 60, idealLifetimeDays: 120, minMechFraction: 0.4 },
  nerve: { minLifetimeDays: 90, idealLifetimeDays: 180, minMechFraction: 0.3 },
  liver: { minLifetimeDays: 30, idealLifetimeDays: 90, minMechFraction: 0.2 },
};

/**
 * Assess material suitability for a target tissue.
 */
function tissueSuitability(material, tissue, conditions) {
  const target = TISSUE_TARGETS[tissue];
  if (!target) {
    throw new Error(`Unknown tissue: "${tissue}". Available: ${Object.keys(TISSUE_TARGETS).join(', ')}`);
  }

  const profile = resolveProfile(material);
  const conds = { tempC: 37, pH: 7.4, ...conditions };
  const lifetime = functionalLifetime(profile, {
    ...conds,
    minMassFraction: 0.5,
    minMechFraction: target.minMechFraction,
  });

  const effectiveDays = lifetime.effectiveLifetimeDays;
  let suitability;
  let score;
  if (effectiveDays >= target.idealLifetimeDays) {
    suitability = 'excellent';
    score = 100;
  } else if (effectiveDays >= target.minLifetimeDays) {
    score = Math.round(50 + 50 * (effectiveDays - target.minLifetimeDays) /
      (target.idealLifetimeDays - target.minLifetimeDays));
    suitability = score >= 75 ? 'good' : 'adequate';
  } else {
    score = Math.round(50 * effectiveDays / target.minLifetimeDays);
    suitability = score >= 25 ? 'marginal' : 'unsuitable';
  }

  return {
    material: profile.name || material,
    tissue,
    target,
    effectiveLifetimeDays: effectiveDays,
    limitingFactor: lifetime.limitingFactor,
    suitability,
    score,
    recommendation: suitability === 'unsuitable'
      ? `${profile.name} degrades too quickly for ${tissue}. Consider slower-degrading alternatives.`
      : suitability === 'marginal'
      ? `${profile.name} may work for ${tissue} under optimal conditions but has limited margin.`
      : suitability === 'excellent'
      ? `${profile.name} is an excellent match for ${tissue} scaffold applications.`
      : `${profile.name} is suitable for ${tissue} with ${suitability} compatibility.`,
  };
}

/**
 * Find the best material for a target tissue from available materials.
 */
function recommendMaterial(tissue, conditions, candidateNames) {
  const candidates = candidateNames || Object.keys(MATERIAL_PROFILES);
  const assessments = candidates.map(name =>
    tissueSuitability(name, tissue, conditions)
  );
  assessments.sort((a, b) => b.score - a.score);
  return {
    tissue,
    conditions: { tempC: 37, pH: 7.4, ...conditions },
    rankings: assessments,
    bestMatch: assessments[0],
  };
}

// ── Factory ──

function createDegradationPredictor() {
  return {
    listMaterials: () => Object.keys(MATERIAL_PROFILES),
    getMaterial: (name) => resolveProfile(name),
    listTissues: () => Object.keys(TISSUE_TARGETS),

    effectiveRate: (material, conditions) =>
      effectiveRate(resolveProfile(material), conditions || {}),

    massCurve: (material, conditions) =>
      massCurve(resolveProfile(material), conditions || {}),

    molecularWeightCurve: (material, conditions) =>
      molecularWeightCurve(resolveProfile(material), conditions || {}),

    mechanicalDecayCurve: (material, conditions) =>
      mechanicalDecayCurve(resolveProfile(material), conditions || {}),

    functionalLifetime: (material, conditions) =>
      functionalLifetime(resolveProfile(material), conditions || {}),

    compareMaterials: (materials, conditions) =>
      compareMaterials(materials, conditions || {}),

    sensitivityAnalysis: (material, conditions) =>
      sensitivityAnalysis(material, conditions || {}),

    tissueSuitability: (material, tissue, conditions) =>
      tissueSuitability(material, tissue, conditions),

    recommendMaterial: (tissue, conditions, candidates) =>
      recommendMaterial(tissue, conditions, candidates),

    fullReport: (material, conditions) =>
      fullReport(material, conditions),
  };
}

module.exports = {
  createDegradationPredictor,
  MATERIAL_PROFILES,
  TISSUE_TARGETS,
  // Export internals for testing
  arrheniusFactor,
  phFactor,
  crystallinityFactor,
  porosityFactor,
  effectiveRate,
  resolveProfile,
};
