/**
 * Vascularization Planner
 * 
 * Plans vascular channel networks for bioprinted tissue constructs.
 * Models nutrient/oxygen diffusion limits, generates branching channel
 * architectures (Murray's law), estimates perfusion adequacy, and
 * optimizes channel geometry for printability.
 */

// ── Constants ──────────────────────────────────────────────────────
const OXYGEN_DIFFUSION_COEFF = 2.0e-9;       // m²/s in hydrogel (~2×10⁻⁹)
const OXYGEN_CONSUMPTION_RATE = 1.5e-8;       // mol/m³/s typical cell consumption
const OXYGEN_SURFACE_CONC = 0.21e-3;          // mol/m³ (~0.21 mM at surface)
const MAX_DIFFUSION_DISTANCE_UM = 200;        // µm — classic tissue engineering limit
const MURRAY_EXPONENT = 3;                    // Murray's law: parent³ = Σchild³

// ── Tissue presets ─────────────────────────────────────────────────
const TISSUE_PRESETS = {
  skin: {
    name: 'Skin',
    cellDensity: 1e6,           // cells/cm³
    oxygenDemand: 'low',
    maxThickness: 3000,         // µm
    minChannelDiam: 100,        // µm
    branchingDepth: 3,
    diffusionLimit: 250,        // µm (skin is more tolerant)
  },
  cartilage: {
    name: 'Cartilage',
    cellDensity: 5e6,
    oxygenDemand: 'low',
    maxThickness: 4000,
    minChannelDiam: 80,
    branchingDepth: 3,
    diffusionLimit: 300,        // avascular tissue, lower demand
  },
  liver: {
    name: 'Liver',
    cellDensity: 1e8,
    oxygenDemand: 'high',
    maxThickness: 2000,
    minChannelDiam: 50,
    branchingDepth: 5,
    diffusionLimit: 100,
  },
  cardiac: {
    name: 'Cardiac Muscle',
    cellDensity: 5e7,
    oxygenDemand: 'very_high',
    maxThickness: 1500,
    minChannelDiam: 40,
    branchingDepth: 6,
    diffusionLimit: 80,
  },
  bone: {
    name: 'Bone',
    cellDensity: 2e7,
    oxygenDemand: 'medium',
    maxThickness: 5000,
    minChannelDiam: 100,
    branchingDepth: 4,
    diffusionLimit: 150,
  },
  kidney: {
    name: 'Kidney',
    cellDensity: 8e7,
    oxygenDemand: 'high',
    maxThickness: 2000,
    minChannelDiam: 40,
    branchingDepth: 6,
    diffusionLimit: 90,
  },
};

const OXYGEN_DEMAND_RATES = {
  low: 5e-9,
  medium: 1.5e-8,
  high: 5e-8,
  very_high: 1e-7,
};

// ── Diffusion analysis ─────────────────────────────────────────────

/**
 * Calculate maximum diffusion distance (Krogh cylinder radius)
 * R = sqrt(2 * D * C₀ / Q)
 * where D = diffusion coeff, C₀ = surface O₂, Q = consumption rate
 */
function calcMaxDiffusionDistance(options = {}) {
  const D = options.diffusionCoeff || OXYGEN_DIFFUSION_COEFF;
  const C0 = options.surfaceConcentration || OXYGEN_SURFACE_CONC;
  const Q = options.consumptionRate || OXYGEN_CONSUMPTION_RATE;

  if (D <= 0 || C0 <= 0 || Q <= 0) {
    throw new Error('All parameters must be positive');
  }

  const radiusM = Math.sqrt((2 * D * C0) / Q);
  const radiusUm = radiusM * 1e6;

  return {
    radiusUm: Math.round(radiusUm * 100) / 100,
    radiusM: radiusM,
    diameterUm: Math.round(radiusUm * 2 * 100) / 100,
    diffusionCoeff: D,
    surfaceConcentration: C0,
    consumptionRate: Q,
    adequate: radiusUm >= 50, // at least 50 µm reach
  };
}

/**
 * Oxygen concentration profile along radial distance from a channel.
 * C(r) = C₀ - (Q / 4D) * (r² - R_channel²)
 * Returns array of {distanceUm, concentrationMolM3, percentSaturation}
 */
function oxygenProfile(channelRadiusUm, maxDistanceUm, options = {}) {
  if (channelRadiusUm <= 0) throw new Error('Channel radius must be positive');
  if (maxDistanceUm <= 0) throw new Error('Max distance must be positive');

  const D = options.diffusionCoeff || OXYGEN_DIFFUSION_COEFF;
  const C0 = options.surfaceConcentration || OXYGEN_SURFACE_CONC;
  const Q = options.consumptionRate || OXYGEN_CONSUMPTION_RATE;
  const steps = options.steps || 20;

  const Rc = channelRadiusUm * 1e-6;
  const Rmax = (channelRadiusUm + maxDistanceUm) * 1e-6;
  const profile = [];

  for (let i = 0; i <= steps; i++) {
    const r = Rc + (Rmax - Rc) * (i / steps);
    const distUm = (r - Rc) * 1e6;
    let conc = C0 - (Q / (4 * D)) * (r * r - Rc * Rc);
    if (conc < 0) conc = 0;

    profile.push({
      distanceUm: Math.round(distUm * 100) / 100,
      concentrationMolM3: conc,
      percentSaturation: Math.round((conc / C0) * 10000) / 100,
      viable: conc > C0 * 0.01, // >1% O₂ considered viable
    });
  }

  // Find critical distance (where O₂ drops to 0)
  const criticalR = Math.sqrt(Rc * Rc + (4 * D * C0) / Q);
  const criticalDistanceUm = Math.round((criticalR - Rc) * 1e6 * 100) / 100;

  return {
    channelRadiusUm,
    criticalDistanceUm,
    profile,
    maxViableDistanceUm: criticalDistanceUm,
  };
}

// ── Murray's law branching ─────────────────────────────────────────

/**
 * Generate a branching vascular tree using Murray's law.
 * Parent radius³ = Σ child_radius³
 * For symmetric bifurcation: child_r = parent_r / 2^(1/3)
 */
function generateBranchingTree(rootDiameterUm, depth, options = {}) {
  if (rootDiameterUm <= 0) throw new Error('Root diameter must be positive');
  if (depth < 0 || !Number.isInteger(depth)) throw new Error('Depth must be a non-negative integer');

  const branchFactor = options.branchFactor || 2;
  const asymmetry = options.asymmetry || 0; // 0 = symmetric, 0-0.5 = asymmetric
  const minDiameterUm = options.minDiameterUm || 20;
  const lengthRatio = options.lengthRatio || 3; // length = diameter * ratio

  let nodeId = 0;

  function buildNode(diamUm, level) {
    const id = nodeId++;
    const lengthUm = diamUm * lengthRatio;
    const node = {
      id,
      level,
      diameterUm: Math.round(diamUm * 100) / 100,
      radiusUm: Math.round((diamUm / 2) * 100) / 100,
      lengthUm: Math.round(lengthUm * 100) / 100,
      crossSectionUm2: Math.round(Math.PI * (diamUm / 2) ** 2 * 100) / 100,
      children: [],
    };

    if (level < depth && diamUm > minDiameterUm) {
      const parentR3 = (diamUm / 2) ** MURRAY_EXPONENT;
      for (let b = 0; b < branchFactor; b++) {
        let childR;
        if (asymmetry > 0 && branchFactor === 2) {
          const factor = b === 0 ? 1 + asymmetry : 1 - asymmetry;
          const share = (factor / 2) * parentR3;
          childR = Math.pow(share, 1 / MURRAY_EXPONENT);
        } else {
          childR = Math.pow(parentR3 / branchFactor, 1 / MURRAY_EXPONENT);
        }
        const childDiam = childR * 2;
        if (childDiam >= minDiameterUm) {
          node.children.push(buildNode(childDiam, level + 1));
        }
      }
    }

    return node;
  }

  const tree = buildNode(rootDiameterUm, 0);

  // Collect stats
  const stats = { totalNodes: 0, totalLengthUm: 0, levels: {}, leafCount: 0 };
  function walk(node) {
    stats.totalNodes++;
    stats.totalLengthUm += node.lengthUm;
    if (!stats.levels[node.level]) {
      stats.levels[node.level] = { count: 0, avgDiameterUm: 0, totalLength: 0 };
    }
    const lv = stats.levels[node.level];
    lv.totalLength += node.lengthUm;
    lv.avgDiameterUm = (lv.avgDiameterUm * lv.count + node.diameterUm) / (lv.count + 1);
    lv.count++;
    if (node.children.length === 0) stats.leafCount++;
    node.children.forEach(walk);
  }
  walk(tree);

  stats.totalLengthMm = Math.round(stats.totalLengthUm / 1000 * 100) / 100;
  // Round level stats
  Object.values(stats.levels).forEach(lv => {
    lv.avgDiameterUm = Math.round(lv.avgDiameterUm * 100) / 100;
    lv.totalLength = Math.round(lv.totalLength * 100) / 100;
  });

  return { tree, stats };
}

// ── Channel spacing calculator ─────────────────────────────────────

/**
 * Calculate required channel spacing for a tissue slab.
 * Ensures no point is further than maxDiffusionDistance from a channel.
 * Returns grid layout (parallel channels or hexagonal pattern).
 */
function calcChannelSpacing(constructDims, options = {}) {
  const { widthUm, heightUm, depthUm } = constructDims;
  if (!widthUm || !heightUm) throw new Error('Width and height required');

  const maxDiffDist = options.maxDiffusionDistanceUm || MAX_DIFFUSION_DISTANCE_UM;
  const channelDiam = options.channelDiameterUm || 200;
  const pattern = options.pattern || 'hexagonal'; // 'parallel' | 'hexagonal'
  const safetyFactor = options.safetyFactor || 0.8; // use 80% of max distance

  const effectiveReach = maxDiffDist * safetyFactor;
  const channelRadius = channelDiam / 2;

  let spacingUm, channelCount;

  if (pattern === 'parallel') {
    // Parallel channels: spacing = 2 × effective reach
    spacingUm = effectiveReach * 2;
    const channelsX = Math.ceil(widthUm / spacingUm) + 1;
    const channelsZ = depthUm ? Math.ceil(depthUm / spacingUm) + 1 : 1;
    channelCount = channelsX * channelsZ;
  } else {
    // Hexagonal close-packed: more efficient coverage
    spacingUm = effectiveReach * Math.sqrt(3);
    const rows = Math.ceil(heightUm / (spacingUm * Math.sqrt(3) / 2)) + 1;
    const cols = Math.ceil(widthUm / spacingUm) + 1;
    channelCount = rows * cols;
    if (depthUm) {
      const layers = Math.ceil(depthUm / spacingUm) + 1;
      channelCount *= layers;
    }
  }

  const totalChannelLength = channelCount * (heightUm || 1000);
  const channelVolume = channelCount * Math.PI * channelRadius ** 2 * (heightUm || 1000);
  const constructVolume = widthUm * (heightUm || 1000) * (depthUm || widthUm);
  const voidFraction = channelVolume / constructVolume;

  return {
    pattern,
    spacingUm: Math.round(spacingUm * 100) / 100,
    channelDiameterUm: channelDiam,
    channelCount,
    effectiveReachUm: Math.round(effectiveReach * 100) / 100,
    totalChannelLengthUm: Math.round(totalChannelLength),
    voidFraction: Math.round(voidFraction * 10000) / 10000,
    voidPercent: Math.round(voidFraction * 10000) / 100,
    coverageAdequate: voidFraction < 0.4, // <40% void is acceptable
  };
}

// ── Perfusion adequacy ─────────────────────────────────────────────

/**
 * Estimate perfusion adequacy for a vascularized construct.
 * Combines flow rate, O₂ delivery, and diffusion coverage.
 */
function assessPerfusion(config) {
  const {
    channelDiameterUm = 200,
    channelCount = 10,
    channelLengthUm = 5000,
    flowRateUlMin = 10,        // µL/min total flow
    tissueType = 'skin',
    constructVolumeMm3 = 100,
  } = config;

  const preset = TISSUE_PRESETS[tissueType];
  if (!preset) throw new Error(`Unknown tissue type: ${tissueType}. Available: ${Object.keys(TISSUE_PRESETS).join(', ')}`);

  const Q = OXYGEN_DEMAND_RATES[preset.oxygenDemand];
  const diffResult = calcMaxDiffusionDistance({ consumptionRate: Q });

  // Flow velocity in channels
  const channelAreaM2 = Math.PI * (channelDiameterUm * 1e-6 / 2) ** 2;
  const totalFlowM3s = flowRateUlMin * 1e-9 / 60; // µL/min → m³/s
  const perChannelFlow = totalFlowM3s / channelCount;
  const velocityMs = perChannelFlow / channelAreaM2;
  const velocityMmS = velocityMs * 1000;

  // Residence time
  const channelLengthM = channelLengthUm * 1e-6;
  const residenceTimeS = channelLengthM / velocityMs;

  // O₂ delivery rate
  const o2DeliveryMolS = totalFlowM3s * OXYGEN_SURFACE_CONC;

  // O₂ demand
  const constructVolumeM3 = constructVolumeMm3 * 1e-9;
  const o2DemandMolS = Q * constructVolumeM3;

  // Delivery ratio
  const deliveryRatio = o2DeliveryMolS / o2DemandMolS;

  // Wall shear stress (Poiseuille flow) — τ = 4µQ/(πR³)
  const viscosity = 1e-3; // Pa·s (water-like medium)
  const R = channelDiameterUm * 1e-6 / 2;
  const wallShearPa = (4 * viscosity * perChannelFlow) / (Math.PI * R ** 3);
  const wallShearDyneCm2 = wallShearPa * 10;

  // Shear assessment (endothelial cells prefer 1-20 dyne/cm²)
  let shearAssessment;
  if (wallShearDyneCm2 < 0.5) shearAssessment = 'too_low';
  else if (wallShearDyneCm2 <= 20) shearAssessment = 'optimal';
  else if (wallShearDyneCm2 <= 50) shearAssessment = 'elevated';
  else shearAssessment = 'damaging';

  // Coverage assessment
  const spacingResult = calcChannelSpacing(
    { widthUm: Math.cbrt(constructVolumeMm3) * 1000, heightUm: Math.cbrt(constructVolumeMm3) * 1000 },
    { maxDiffusionDistanceUm: diffResult.radiusUm, channelDiameterUm }
  );

  // Overall score (0-100)
  let score = 0;
  if (deliveryRatio >= 1) score += 40;
  else score += deliveryRatio * 40;

  if (shearAssessment === 'optimal') score += 30;
  else if (shearAssessment === 'elevated' || shearAssessment === 'too_low') score += 15;

  if (spacingResult.coverageAdequate) score += 30;
  else score += (1 - spacingResult.voidFraction) * 30;

  score = Math.round(Math.min(100, score));

  let grade;
  if (score >= 90) grade = 'A';
  else if (score >= 75) grade = 'B';
  else if (score >= 60) grade = 'C';
  else if (score >= 40) grade = 'D';
  else grade = 'F';

  const recommendations = [];
  if (deliveryRatio < 1) recommendations.push(`Increase flow rate — current O₂ delivery is ${Math.round(deliveryRatio * 100)}% of demand`);
  if (shearAssessment === 'too_low') recommendations.push('Flow velocity too low for endothelial health — reduce channel diameter or increase flow');
  if (shearAssessment === 'damaging') recommendations.push('Wall shear stress may damage cells — increase channel diameter or reduce flow');
  if (shearAssessment === 'elevated') recommendations.push('Wall shear stress elevated — monitor cell response');
  if (!spacingResult.coverageAdequate) recommendations.push(`Channel void fraction (${spacingResult.voidPercent}%) too high — use smaller/fewer channels or accept reduced tissue volume`);
  if (residenceTimeS < 1) recommendations.push('Very short residence time — O₂ may not fully exchange');
  if (residenceTimeS > 60) recommendations.push('Long residence time — downstream O₂ may be depleted');

  return {
    tissueType,
    tissuePreset: preset,
    flow: {
      totalFlowUlMin: flowRateUlMin,
      perChannelFlowUlMin: Math.round((flowRateUlMin / channelCount) * 1000) / 1000,
      velocityMmS: Math.round(velocityMmS * 1000) / 1000,
      residenceTimeS: Math.round(residenceTimeS * 100) / 100,
    },
    oxygen: {
      deliveryRateMolS: o2DeliveryMolS,
      demandRateMolS: o2DemandMolS,
      deliveryRatio: Math.round(deliveryRatio * 1000) / 1000,
      adequate: deliveryRatio >= 1,
      maxDiffusionDistanceUm: diffResult.radiusUm,
    },
    shear: {
      wallShearPa: Math.round(wallShearPa * 10000) / 10000,
      wallShearDyneCm2: Math.round(wallShearDyneCm2 * 1000) / 1000,
      assessment: shearAssessment,
    },
    coverage: spacingResult,
    score,
    grade,
    recommendations,
  };
}

// ── Printability analysis ──────────────────────────────────────────

/**
 * Assess whether a vascular network is printable with current bioprinting tech.
 */
function assessPrintability(networkConfig) {
  const {
    minChannelDiameterUm = 100,
    maxChannelDiameterUm = 2000,
    branchAngleDeg = 60,
    materialViscosityPas = 10,
    nozzleDiameterUm = 400,
    printSpeedMmS = 5,
    layerHeightUm = 200,
  } = networkConfig;

  const issues = [];
  const scores = {};

  // Resolution check
  if (minChannelDiameterUm < nozzleDiameterUm * 0.5) {
    issues.push(`Min channel (${minChannelDiameterUm}µm) below printable resolution (~${nozzleDiameterUm * 0.5}µm with ${nozzleDiameterUm}µm nozzle)`);
    scores.resolution = 30;
  } else if (minChannelDiameterUm < nozzleDiameterUm) {
    issues.push(`Min channel (${minChannelDiameterUm}µm) near resolution limit of ${nozzleDiameterUm}µm nozzle — may be imprecise`);
    scores.resolution = 60;
  } else {
    scores.resolution = 100;
  }

  // Overhang / branch angle
  if (branchAngleDeg < 30) {
    issues.push(`Branch angle ${branchAngleDeg}° too steep — channels may collapse without support`);
    scores.geometry = 40;
  } else if (branchAngleDeg < 45) {
    issues.push(`Branch angle ${branchAngleDeg}° is steep — may need sacrificial support`);
    scores.geometry = 70;
  } else {
    scores.geometry = 100;
  }

  // Aspect ratio (channel length vs diameter)
  const aspectRatio = maxChannelDiameterUm / layerHeightUm;
  if (aspectRatio > 10) {
    issues.push(`High aspect ratio (${Math.round(aspectRatio)}:1) — channel may deform during printing`);
    scores.aspect = 50;
  } else {
    scores.aspect = 100;
  }

  // Material suitability
  if (materialViscosityPas < 1) {
    issues.push('Material too runny — channels will collapse before crosslinking');
    scores.material = 20;
  } else if (materialViscosityPas > 100) {
    issues.push('Material too viscous — may clog fine channels');
    scores.material = 50;
  } else {
    scores.material = 100;
  }

  // Speed vs resolution
  const speedResolutionRatio = printSpeedMmS / (nozzleDiameterUm / 1000);
  if (speedResolutionRatio > 20) {
    issues.push('Print speed too high for nozzle size — reduced accuracy');
    scores.speed = 50;
  } else {
    scores.speed = 100;
  }

  const composite = Math.round(
    Object.values(scores).reduce((a, b) => a + b, 0) / Object.keys(scores).length
  );

  let printMethod;
  if (minChannelDiameterUm >= 500) printMethod = 'Extrusion bioprinting';
  else if (minChannelDiameterUm >= 100) printMethod = 'Sacrificial ink / embedded printing (FRESH)';
  else if (minChannelDiameterUm >= 20) printMethod = 'Two-photon lithography / DLP';
  else printMethod = 'Sub-resolution — requires microfluidic or self-assembly approach';

  return {
    scores,
    composite,
    printable: composite >= 60,
    recommendedMethod: printMethod,
    issues,
    nozzleDiameterUm,
    layerHeightUm,
  };
}

// ── Network planner (ties it all together) ─────────────────────────

/**
 * Generate a complete vascularization plan for a tissue construct.
 */
function planVascularNetwork(config) {
  const {
    tissueType = 'skin',
    constructWidthMm = 10,
    constructHeightMm = 10,
    constructDepthMm = 5,
    rootChannelDiameterUm = 1000,
    flowRateUlMin = 50,
    nozzleDiameterUm = 400,
    materialViscosityPas = 10,
  } = config;

  const preset = TISSUE_PRESETS[tissueType];
  if (!preset) throw new Error(`Unknown tissue type: ${tissueType}. Available: ${Object.keys(TISSUE_PRESETS).join(', ')}`);

  const Q = OXYGEN_DEMAND_RATES[preset.oxygenDemand];

  // 1. Diffusion analysis
  const diffusion = calcMaxDiffusionDistance({ consumptionRate: Q });

  // 2. Branching tree
  const branching = generateBranchingTree(rootChannelDiameterUm, preset.branchingDepth, {
    minDiameterUm: preset.minChannelDiam,
  });

  // 3. Channel spacing
  const spacing = calcChannelSpacing(
    {
      widthUm: constructWidthMm * 1000,
      heightUm: constructHeightMm * 1000,
      depthUm: constructDepthMm * 1000,
    },
    {
      maxDiffusionDistanceUm: Math.min(diffusion.radiusUm, preset.diffusionLimit),
      channelDiameterUm: rootChannelDiameterUm,
    }
  );

  // 4. Perfusion assessment
  const constructVolumeMm3 = constructWidthMm * constructHeightMm * constructDepthMm;
  const perfusion = assessPerfusion({
    channelDiameterUm: rootChannelDiameterUm,
    channelCount: spacing.channelCount,
    channelLengthUm: constructHeightMm * 1000,
    flowRateUlMin,
    tissueType,
    constructVolumeMm3,
  });

  // 5. Printability
  const leafDiam = branching.stats.levels[preset.branchingDepth]
    ? branching.stats.levels[preset.branchingDepth].avgDiameterUm
    : preset.minChannelDiam;

  const printability = assessPrintability({
    minChannelDiameterUm: leafDiam,
    maxChannelDiameterUm: rootChannelDiameterUm,
    nozzleDiameterUm,
    materialViscosityPas,
  });

  // 6. Overall feasibility
  const feasibilityScore = Math.round(
    perfusion.score * 0.4 + printability.composite * 0.4 + (spacing.coverageAdequate ? 100 : 40) * 0.2
  );

  let feasibility;
  if (feasibilityScore >= 80) feasibility = 'highly_feasible';
  else if (feasibilityScore >= 60) feasibility = 'feasible';
  else if (feasibilityScore >= 40) feasibility = 'challenging';
  else feasibility = 'not_recommended';

  return {
    tissueType,
    preset,
    construct: {
      widthMm: constructWidthMm,
      heightMm: constructHeightMm,
      depthMm: constructDepthMm,
      volumeMm3: constructVolumeMm3,
    },
    diffusion,
    branching: {
      rootDiameterUm: rootChannelDiameterUm,
      depth: preset.branchingDepth,
      stats: branching.stats,
    },
    spacing,
    perfusion: {
      score: perfusion.score,
      grade: perfusion.grade,
      oxygenDeliveryRatio: perfusion.oxygen.deliveryRatio,
      shearAssessment: perfusion.shear.assessment,
      recommendations: perfusion.recommendations,
    },
    printability,
    feasibilityScore,
    feasibility,
    allRecommendations: [
      ...perfusion.recommendations,
      ...printability.issues,
    ],
  };
}

// ── Compare tissue plans ───────────────────────────────────────────

/**
 * Compare vascularization plans across multiple tissue types.
 */
function compareTissuePlans(tissueTypes, baseConfig = {}) {
  const plans = {};
  const summary = [];

  for (const tt of tissueTypes) {
    plans[tt] = planVascularNetwork({ ...baseConfig, tissueType: tt });
    summary.push({
      tissueType: tt,
      feasibility: plans[tt].feasibility,
      feasibilityScore: plans[tt].feasibilityScore,
      perfusionGrade: plans[tt].perfusion.grade,
      printable: plans[tt].printability.printable,
      channelCount: plans[tt].spacing.channelCount,
      voidPercent: plans[tt].spacing.voidPercent,
      recommendedMethod: plans[tt].printability.recommendedMethod,
    });
  }

  summary.sort((a, b) => b.feasibilityScore - a.feasibilityScore);

  return { plans, summary, bestCandidate: summary[0]?.tissueType };
}

// ── Flow distribution analysis ─────────────────────────────────────

/**
 * Analyze flow distribution in a branching tree using Hagen-Poiseuille.
 * Resistance ∝ L / r⁴ (for each segment)
 */
function analyzeFlowDistribution(tree, totalFlowUlMin = 10) {
  const viscosity = 1e-3; // Pa·s

  function calcResistance(node) {
    const R = node.radiusUm * 1e-6;
    const L = node.lengthUm * 1e-6;
    const selfResist = (8 * viscosity * L) / (Math.PI * R ** 4);

    if (node.children.length === 0) {
      node.resistance = selfResist;
      return selfResist;
    }

    // Children in parallel: 1/R_total = Σ(1/R_child)
    let invRChild = 0;
    for (const child of node.children) {
      invRChild += 1 / calcResistance(child);
    }
    const childResist = 1 / invRChild;
    node.resistance = selfResist + childResist;
    return node.resistance;
  }

  calcResistance(tree);

  // Distribute flow
  const totalFlowM3s = totalFlowUlMin * 1e-9 / 60;

  function distributeFlow(node, flowM3s) {
    node.flowUlMin = Math.round(flowM3s * 60 * 1e9 * 1000) / 1000;
    const R = node.radiusUm * 1e-6;
    const area = Math.PI * R * R;
    node.velocityMmS = Math.round((flowM3s / area) * 1000 * 1000) / 1000;

    // Pressure drop across this segment
    const L = node.lengthUm * 1e-6;
    node.pressureDropPa = Math.round((8 * viscosity * L * flowM3s) / (Math.PI * R ** 4) * 1000) / 1000;

    if (node.children.length > 0) {
      const totalInvR = node.children.reduce((s, c) => s + 1 / c.resistance, 0);
      for (const child of node.children) {
        const childFrac = (1 / child.resistance) / totalInvR;
        distributeFlow(child, flowM3s * childFrac);
      }
    }
  }

  distributeFlow(tree, totalFlowM3s);

  // Collect leaf flows for uniformity analysis
  const leafFlows = [];
  function collectLeaves(node) {
    if (node.children.length === 0) leafFlows.push(node.flowUlMin);
    node.children.forEach(collectLeaves);
  }
  collectLeaves(tree);

  const meanLeafFlow = leafFlows.reduce((a, b) => a + b, 0) / leafFlows.length;
  const stdDev = Math.sqrt(leafFlows.reduce((s, f) => s + (f - meanLeafFlow) ** 2, 0) / leafFlows.length);
  const cv = meanLeafFlow > 0 ? stdDev / meanLeafFlow : 0;

  return {
    tree,
    totalResistancePaSmM3: tree.resistance,
    totalPressureDropPa: tree.pressureDropPa,
    leafFlowStats: {
      count: leafFlows.length,
      meanUlMin: Math.round(meanLeafFlow * 1000) / 1000,
      stdDevUlMin: Math.round(stdDev * 1000) / 1000,
      cv: Math.round(cv * 1000) / 1000,
      uniform: cv < 0.1,
      minUlMin: Math.round(Math.min(...leafFlows) * 1000) / 1000,
      maxUlMin: Math.round(Math.max(...leafFlows) * 1000) / 1000,
    },
  };
}

// ── Exports ────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // Constants
    TISSUE_PRESETS,
    OXYGEN_DEMAND_RATES,
    OXYGEN_DIFFUSION_COEFF,
    OXYGEN_CONSUMPTION_RATE,
    OXYGEN_SURFACE_CONC,
    MAX_DIFFUSION_DISTANCE_UM,
    MURRAY_EXPONENT,

    // Functions
    calcMaxDiffusionDistance,
    oxygenProfile,
    generateBranchingTree,
    calcChannelSpacing,
    assessPerfusion,
    assessPrintability,
    planVascularNetwork,
    compareTissuePlans,
    analyzeFlowDistribution,
  };
}
