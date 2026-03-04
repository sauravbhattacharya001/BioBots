/**
 * Tests for Vascularization Planner
 */

const {
  TISSUE_PRESETS,
  OXYGEN_DEMAND_RATES,
  calcMaxDiffusionDistance,
  oxygenProfile,
  generateBranchingTree,
  calcChannelSpacing,
  assessPerfusion,
  assessPrintability,
  planVascularNetwork,
  compareTissuePlans,
  analyzeFlowDistribution,
} = require('../Try/scripts/vascularization');

// ── calcMaxDiffusionDistance ────────────────────────────────────────

describe('calcMaxDiffusionDistance', () => {
  test('returns positive radius with defaults', () => {
    const r = calcMaxDiffusionDistance();
    expect(r.radiusUm).toBeGreaterThan(0);
    expect(r.diameterUm).toBeCloseTo(r.radiusUm * 2, 1);
    expect(r.adequate).toBe(true);
  });

  test('higher consumption → smaller radius', () => {
    const low = calcMaxDiffusionDistance({ consumptionRate: 1e-9 });
    const high = calcMaxDiffusionDistance({ consumptionRate: 1e-7 });
    expect(low.radiusUm).toBeGreaterThan(high.radiusUm);
  });

  test('higher diffusion coeff → larger radius', () => {
    const low = calcMaxDiffusionDistance({ diffusionCoeff: 1e-9 });
    const high = calcMaxDiffusionDistance({ diffusionCoeff: 5e-9 });
    expect(high.radiusUm).toBeGreaterThan(low.radiusUm);
  });

  test('handles edge-case parameters', () => {
    const r = calcMaxDiffusionDistance({ diffusionCoeff: 1e-15 });
    expect(r.radiusUm).toBeLessThan(50);
    expect(() => calcMaxDiffusionDistance({ consumptionRate: -1 })).toThrow();
  });

  test('returns adequate=false when radius is tiny', () => {
    const r = calcMaxDiffusionDistance({ consumptionRate: 1e-3 });
    expect(r.adequate).toBe(false);
  });
});

// ── oxygenProfile ──────────────────────────────────────────────────

describe('oxygenProfile', () => {
  test('returns profile with decreasing concentration', () => {
    const result = oxygenProfile(100, 200);
    expect(result.profile.length).toBeGreaterThan(0);
    expect(result.profile[0].percentSaturation).toBeGreaterThan(
      result.profile[result.profile.length - 1].percentSaturation
    );
  });

  test('first point is at distance 0', () => {
    const result = oxygenProfile(50, 100);
    expect(result.profile[0].distanceUm).toBe(0);
  });

  test('reports critical distance', () => {
    const result = oxygenProfile(100, 500);
    expect(result.criticalDistanceUm).toBeGreaterThan(0);
    expect(result.maxViableDistanceUm).toBe(result.criticalDistanceUm);
  });

  test('concentration never negative', () => {
    const result = oxygenProfile(10, 1000);
    result.profile.forEach(p => {
      expect(p.concentrationMolM3).toBeGreaterThanOrEqual(0);
    });
  });

  test('throws on invalid inputs', () => {
    expect(() => oxygenProfile(0, 100)).toThrow();
    expect(() => oxygenProfile(100, 0)).toThrow();
  });

  test('custom steps', () => {
    const result = oxygenProfile(100, 200, { steps: 5 });
    expect(result.profile.length).toBe(6); // 0..5 inclusive
  });

  test('viability flags', () => {
    const result = oxygenProfile(50, 500);
    // Near channel should be viable
    expect(result.profile[0].viable).toBe(true);
  });
});

// ── generateBranchingTree ──────────────────────────────────────────

describe('generateBranchingTree', () => {
  test('generates root node at depth 0', () => {
    const { tree, stats } = generateBranchingTree(500, 0);
    expect(tree.diameterUm).toBe(500);
    expect(tree.children).toHaveLength(0);
    expect(stats.totalNodes).toBe(1);
  });

  test('binary branching obeys Murray\'s law', () => {
    const { tree } = generateBranchingTree(1000, 1);
    expect(tree.children).toHaveLength(2);
    const parentR3 = (tree.diameterUm / 2) ** 3;
    const childR3Sum = tree.children.reduce((s, c) => s + (c.diameterUm / 2) ** 3, 0);
    expect(childR3Sum).toBeCloseTo(parentR3, -3);
  });

  test('children are smaller than parent', () => {
    const { tree } = generateBranchingTree(800, 3);
    function checkSmaller(node) {
      for (const child of node.children) {
        expect(child.diameterUm).toBeLessThan(node.diameterUm);
        checkSmaller(child);
      }
    }
    checkSmaller(tree);
  });

  test('stats count nodes correctly for depth 2', () => {
    const { stats } = generateBranchingTree(500, 2);
    // 1 + 2 + 4 = 7 nodes
    expect(stats.totalNodes).toBe(7);
    expect(stats.leafCount).toBe(4);
  });

  test('respects minDiameterUm', () => {
    const { tree } = generateBranchingTree(100, 10, { minDiameterUm: 80 });
    // Should stop early since children would be < 80
    function checkMin(node) {
      expect(node.diameterUm).toBeGreaterThanOrEqual(80);
      node.children.forEach(checkMin);
    }
    checkMin(tree);
  });

  test('asymmetric branching produces unequal children', () => {
    const { tree } = generateBranchingTree(1000, 1, { asymmetry: 0.3 });
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].diameterUm).not.toBeCloseTo(tree.children[1].diameterUm, 0);
  });

  test('custom branch factor', () => {
    const { tree } = generateBranchingTree(1000, 1, { branchFactor: 3 });
    expect(tree.children).toHaveLength(3);
  });

  test('totalLengthMm is computed', () => {
    const { stats } = generateBranchingTree(500, 2);
    expect(stats.totalLengthMm).toBeGreaterThan(0);
  });

  test('throws on invalid inputs', () => {
    expect(() => generateBranchingTree(0, 2)).toThrow();
    expect(() => generateBranchingTree(500, -1)).toThrow();
    expect(() => generateBranchingTree(500, 1.5)).toThrow();
  });

  test('level stats have correct counts', () => {
    const { stats } = generateBranchingTree(500, 3);
    expect(stats.levels[0].count).toBe(1);
    expect(stats.levels[1].count).toBe(2);
    expect(stats.levels[2].count).toBe(4);
    expect(stats.levels[3].count).toBe(8);
  });
});

// ── calcChannelSpacing ─────────────────────────────────────────────

describe('calcChannelSpacing', () => {
  test('returns spacing for parallel pattern', () => {
    const result = calcChannelSpacing(
      { widthUm: 10000, heightUm: 10000 },
      { pattern: 'parallel' }
    );
    expect(result.spacingUm).toBeGreaterThan(0);
    expect(result.channelCount).toBeGreaterThan(0);
    expect(result.pattern).toBe('parallel');
  });

  test('returns spacing for hexagonal pattern', () => {
    const result = calcChannelSpacing(
      { widthUm: 10000, heightUm: 10000 },
      { pattern: 'hexagonal' }
    );
    expect(result.pattern).toBe('hexagonal');
    expect(result.channelCount).toBeGreaterThan(0);
  });

  test('larger construct needs more channels', () => {
    const small = calcChannelSpacing({ widthUm: 5000, heightUm: 5000 });
    const large = calcChannelSpacing({ widthUm: 20000, heightUm: 20000 });
    expect(large.channelCount).toBeGreaterThan(small.channelCount);
  });

  test('void fraction is reasonable', () => {
    const result = calcChannelSpacing({ widthUm: 10000, heightUm: 10000 });
    expect(result.voidFraction).toBeGreaterThan(0);
    expect(result.voidPercent).toBeGreaterThan(0);
  });

  test('3D construct with depth', () => {
    const result = calcChannelSpacing(
      { widthUm: 10000, heightUm: 10000, depthUm: 5000 },
      { pattern: 'parallel' }
    );
    expect(result.channelCount).toBeGreaterThan(1);
  });

  test('throws without dimensions', () => {
    expect(() => calcChannelSpacing({})).toThrow();
  });

  test('safety factor affects spacing', () => {
    const safe = calcChannelSpacing(
      { widthUm: 10000, heightUm: 10000 },
      { safetyFactor: 0.5 }
    );
    const risky = calcChannelSpacing(
      { widthUm: 10000, heightUm: 10000 },
      { safetyFactor: 1.0 }
    );
    expect(safe.spacingUm).toBeLessThan(risky.spacingUm);
  });
});

// ── assessPerfusion ────────────────────────────────────────────────

describe('assessPerfusion', () => {
  test('returns score and grade', () => {
    const result = assessPerfusion({ tissueType: 'skin', flowRateUlMin: 50 });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.grade);
  });

  test('high flow gives better perfusion', () => {
    const low = assessPerfusion({ tissueType: 'skin', flowRateUlMin: 1 });
    const high = assessPerfusion({ tissueType: 'skin', flowRateUlMin: 500 });
    expect(high.score).toBeGreaterThanOrEqual(low.score);
  });

  test('includes oxygen delivery ratio', () => {
    const result = assessPerfusion({ tissueType: 'liver' });
    expect(result.oxygen.deliveryRatio).toBeGreaterThan(0);
  });

  test('includes shear assessment', () => {
    const result = assessPerfusion({ tissueType: 'cardiac' });
    expect(['too_low', 'optimal', 'elevated', 'damaging']).toContain(result.shear.assessment);
  });

  test('throws on unknown tissue type', () => {
    expect(() => assessPerfusion({ tissueType: 'brain' })).toThrow();
  });

  test('recommendations array exists', () => {
    const result = assessPerfusion({ tissueType: 'skin' });
    expect(Array.isArray(result.recommendations)).toBe(true);
  });

  test('flow stats are computed', () => {
    const result = assessPerfusion({ tissueType: 'skin', flowRateUlMin: 100 });
    expect(result.flow.velocityMmS).toBeGreaterThan(0);
    expect(result.flow.residenceTimeS).toBeGreaterThan(0);
  });

  test('all tissue types work', () => {
    for (const tt of Object.keys(TISSUE_PRESETS)) {
      const result = assessPerfusion({ tissueType: tt });
      expect(result.score).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── assessPrintability ─────────────────────────────────────────────

describe('assessPrintability', () => {
  test('returns composite score', () => {
    const result = assessPrintability({});
    expect(result.composite).toBeGreaterThanOrEqual(0);
    expect(result.composite).toBeLessThanOrEqual(100);
  });

  test('printable flag', () => {
    const good = assessPrintability({ minChannelDiameterUm: 500, nozzleDiameterUm: 400 });
    expect(good.printable).toBe(true);

    const bad = assessPrintability({
      minChannelDiameterUm: 10,
      nozzleDiameterUm: 400,
      materialViscosityPas: 0.1,
      branchAngleDeg: 10,
    });
    expect(bad.composite).toBeLessThan(good.composite);
  });

  test('recommends print method based on resolution', () => {
    const large = assessPrintability({ minChannelDiameterUm: 600 });
    expect(large.recommendedMethod).toContain('Extrusion');

    const fine = assessPrintability({ minChannelDiameterUm: 150 });
    expect(fine.recommendedMethod).toContain('Sacrificial');

    const micro = assessPrintability({ minChannelDiameterUm: 30 });
    expect(micro.recommendedMethod).toContain('Two-photon');
  });

  test('steep branch angle lowers geometry score', () => {
    const steep = assessPrintability({ branchAngleDeg: 20 });
    const normal = assessPrintability({ branchAngleDeg: 60 });
    expect(steep.scores.geometry).toBeLessThan(normal.scores.geometry);
  });

  test('issues array populated for bad config', () => {
    const result = assessPrintability({
      minChannelDiameterUm: 50,
      nozzleDiameterUm: 400,
      branchAngleDeg: 20,
      materialViscosityPas: 0.5,
    });
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

// ── planVascularNetwork ────────────────────────────────────────────

describe('planVascularNetwork', () => {
  test('returns complete plan for skin', () => {
    const plan = planVascularNetwork({ tissueType: 'skin' });
    expect(plan.tissueType).toBe('skin');
    expect(plan.feasibilityScore).toBeGreaterThanOrEqual(0);
    expect(['highly_feasible', 'feasible', 'challenging', 'not_recommended']).toContain(plan.feasibility);
  });

  test('includes all sections', () => {
    const plan = planVascularNetwork({ tissueType: 'liver' });
    expect(plan.diffusion).toBeDefined();
    expect(plan.branching).toBeDefined();
    expect(plan.spacing).toBeDefined();
    expect(plan.perfusion).toBeDefined();
    expect(plan.printability).toBeDefined();
    expect(plan.construct).toBeDefined();
  });

  test('construct dimensions are preserved', () => {
    const plan = planVascularNetwork({
      tissueType: 'bone',
      constructWidthMm: 15,
      constructHeightMm: 20,
      constructDepthMm: 8,
    });
    expect(plan.construct.widthMm).toBe(15);
    expect(plan.construct.heightMm).toBe(20);
    expect(plan.construct.depthMm).toBe(8);
    expect(plan.construct.volumeMm3).toBe(15 * 20 * 8);
  });

  test('throws on unknown tissue', () => {
    expect(() => planVascularNetwork({ tissueType: 'unknown' })).toThrow();
  });

  test('allRecommendations combines perfusion + printability', () => {
    const plan = planVascularNetwork({ tissueType: 'cardiac' });
    expect(Array.isArray(plan.allRecommendations)).toBe(true);
  });

  test('all tissue types produce valid plans', () => {
    for (const tt of Object.keys(TISSUE_PRESETS)) {
      const plan = planVascularNetwork({ tissueType: tt });
      expect(plan.feasibilityScore).toBeGreaterThanOrEqual(0);
      expect(plan.feasibilityScore).toBeLessThanOrEqual(100);
    }
  });
});

// ── compareTissuePlans ─────────────────────────────────────────────

describe('compareTissuePlans', () => {
  test('compares multiple tissues', () => {
    const result = compareTissuePlans(['skin', 'liver', 'cardiac']);
    expect(Object.keys(result.plans)).toHaveLength(3);
    expect(result.summary).toHaveLength(3);
    expect(result.bestCandidate).toBeDefined();
  });

  test('summary sorted by feasibility score desc', () => {
    const result = compareTissuePlans(['skin', 'liver', 'bone']);
    for (let i = 1; i < result.summary.length; i++) {
      expect(result.summary[i - 1].feasibilityScore)
        .toBeGreaterThanOrEqual(result.summary[i].feasibilityScore);
    }
  });

  test('single tissue comparison', () => {
    const result = compareTissuePlans(['cartilage']);
    expect(result.summary).toHaveLength(1);
    expect(result.bestCandidate).toBe('cartilage');
  });

  test('passes base config to all plans', () => {
    const result = compareTissuePlans(['skin', 'bone'], { flowRateUlMin: 200 });
    expect(result.plans.skin).toBeDefined();
    expect(result.plans.bone).toBeDefined();
  });
});

// ── analyzeFlowDistribution ────────────────────────────────────────

describe('analyzeFlowDistribution', () => {
  test('symmetric tree has uniform leaf flows', () => {
    const { tree } = generateBranchingTree(500, 3);
    const result = analyzeFlowDistribution(tree, 10);
    expect(result.leafFlowStats.uniform).toBe(true);
    expect(result.leafFlowStats.cv).toBeLessThan(0.1);
  });

  test('total pressure drop is positive', () => {
    const { tree } = generateBranchingTree(500, 2);
    const result = analyzeFlowDistribution(tree, 10);
    expect(result.totalPressureDropPa).toBeGreaterThan(0);
  });

  test('leaf count matches tree', () => {
    const { tree, stats } = generateBranchingTree(500, 2);
    const result = analyzeFlowDistribution(tree, 10);
    expect(result.leafFlowStats.count).toBe(stats.leafCount);
  });

  test('flow conserved at leaves', () => {
    const { tree } = generateBranchingTree(500, 2);
    const totalFlow = 10;
    const result = analyzeFlowDistribution(tree, totalFlow);
    const leafSum = result.leafFlowStats.count * result.leafFlowStats.meanUlMin;
    expect(leafSum).toBeCloseTo(totalFlow, 0);
  });

  test('single node (depth 0)', () => {
    const { tree } = generateBranchingTree(500, 0);
    const result = analyzeFlowDistribution(tree, 5);
    expect(result.leafFlowStats.count).toBe(1);
    expect(result.leafFlowStats.meanUlMin).toBeCloseTo(5, 0);
  });

  test('asymmetric tree has non-uniform leaf flows', () => {
    const { tree } = generateBranchingTree(500, 3, { asymmetry: 0.4 });
    const result = analyzeFlowDistribution(tree, 10);
    expect(result.leafFlowStats.cv).toBeGreaterThan(0);
  });

  test('velocity is computed for root', () => {
    const { tree } = generateBranchingTree(500, 1);
    const result = analyzeFlowDistribution(tree, 10);
    expect(tree.velocityMmS).toBeGreaterThan(0);
  });
});

// ── TISSUE_PRESETS ─────────────────────────────────────────────────

describe('TISSUE_PRESETS', () => {
  test('all presets have required fields', () => {
    for (const [key, preset] of Object.entries(TISSUE_PRESETS)) {
      expect(preset.name).toBeDefined();
      expect(preset.cellDensity).toBeGreaterThan(0);
      expect(preset.oxygenDemand).toBeDefined();
      expect(OXYGEN_DEMAND_RATES[preset.oxygenDemand]).toBeGreaterThan(0);
      expect(preset.maxThickness).toBeGreaterThan(0);
      expect(preset.minChannelDiam).toBeGreaterThan(0);
      expect(preset.branchingDepth).toBeGreaterThanOrEqual(0);
      expect(preset.diffusionLimit).toBeGreaterThan(0);
    }
  });

  test('has expected tissue types', () => {
    expect(TISSUE_PRESETS.skin).toBeDefined();
    expect(TISSUE_PRESETS.liver).toBeDefined();
    expect(TISSUE_PRESETS.cardiac).toBeDefined();
    expect(TISSUE_PRESETS.bone).toBeDefined();
    expect(TISSUE_PRESETS.cartilage).toBeDefined();
    expect(TISSUE_PRESETS.kidney).toBeDefined();
  });
});
