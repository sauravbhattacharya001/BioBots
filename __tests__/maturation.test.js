'use strict';

const { createMaturationSimulator } = require('../Try/scripts/maturation');

describe('Tissue Maturation Simulator', () => {
  let sim;

  beforeEach(() => {
    sim = createMaturationSimulator();
  });

  // ── cellGrowth ──

  describe('cellGrowth', () => {
    it('returns growth curve with expected fields', () => {
      const r = sim.cellGrowth({ cellType: 'fibroblast', days: 7 });
      expect(r.cellType).toBe('fibroblast');
      expect(r.curve).toHaveLength(8); // 0..7
      expect(r.curve[0].day).toBe(0);
      expect(r.curve[0].density).toBe(1e6);
      expect(r.finalDensity).toBeGreaterThan(r.initialDensity);
      expect(r.foldExpansion).toBeGreaterThan(1);
    });

    it('respects carrying capacity', () => {
      const r = sim.cellGrowth({ cellType: 'fibroblast', initialDensity: 1e6, days: 100 });
      expect(r.finalDensity).toBeLessThanOrEqual(80e6);
    });

    it('uses default cell type if not specified', () => {
      const r = sim.cellGrowth({ days: 5 });
      expect(r.cellType).toBe('fibroblast');
    });

    it('throws on invalid cell type', () => {
      expect(() => sim.cellGrowth({ cellType: 'alien' })).toThrow('Unknown cell type');
    });

    it('throws on non-positive initialDensity', () => {
      expect(() => sim.cellGrowth({ initialDensity: -1 })).toThrow('initialDensity');
    });

    it('throws on non-positive days', () => {
      expect(() => sim.cellGrowth({ days: -1 })).toThrow('days');
    });

    it('labels growth phases correctly', () => {
      const r = sim.cellGrowth({ cellType: 'fibroblast', initialDensity: 1e5, days: 30 });
      const phases = r.curve.map(p => p.phaseLabel);
      expect(phases[0]).toBe('lag');
      expect(phases).toContain('exponential');
    });

    it('temperature affects growth rate', () => {
      const r37 = sim.cellGrowth({ cellType: 'fibroblast', days: 14, tempC: 37 });
      const r30 = sim.cellGrowth({ cellType: 'fibroblast', days: 14, tempC: 30 });
      expect(r37.finalDensity).toBeGreaterThan(r30.finalDensity);
    });

    it('works for all cell types', () => {
      for (const ct of Object.keys(sim._profiles.cells)) {
        const r = sim.cellGrowth({ cellType: ct, days: 7 });
        expect(r.finalDensity).toBeGreaterThan(0);
      }
    });

    it('tracks viability over time', () => {
      const r = sim.cellGrowth({ days: 14 });
      expect(r.curve[0].viability).toBeLessThanOrEqual(1);
      expect(r.curve[14].viability).toBeLessThanOrEqual(1);
      expect(r.curve[14].viability).toBeGreaterThan(0);
    });

    it('tracks doublings', () => {
      const r = sim.cellGrowth({ days: 7 });
      expect(r.curve[0].doublings).toBeCloseTo(0, 5);
      expect(r.curve[7].doublings).toBeGreaterThan(0);
    });
  });

  // ── ecmDeposition ──

  describe('ecmDeposition', () => {
    it('returns ECM components for chondrocyte', () => {
      const r = sim.ecmDeposition({ cellType: 'chondrocyte', days: 21 });
      expect(r.components).toHaveProperty('collagen');
      expect(r.components).toHaveProperty('gag');
      expect(r.components).toHaveProperty('elastin');
      expect(r.dominantComponent).toBeDefined();
    });

    it('cumulative values increase over time', () => {
      const r = sim.ecmDeposition({ days: 14 });
      const col = r.components.collagen.curve;
      for (let i = 1; i < col.length; i++) {
        expect(col[i].cumulative).toBeGreaterThanOrEqual(col[i - 1].cumulative);
      }
    });

    it('scales with cell density', () => {
      const low = sim.ecmDeposition({ cellDensity: 1e6, days: 14 });
      const high = sim.ecmDeposition({ cellDensity: 20e6, days: 14 });
      expect(high.components.collagen.totalDeposited)
        .toBeGreaterThan(low.components.collagen.totalDeposited);
    });

    it('throws on invalid cellDensity', () => {
      expect(() => sim.ecmDeposition({ cellDensity: -5 })).toThrow('cellDensity');
    });

    it('osteoblast produces mineral', () => {
      const r = sim.ecmDeposition({ cellType: 'osteoblast', days: 28 });
      expect(r.components).toHaveProperty('mineral');
      expect(r.components.mineral.totalDeposited).toBeGreaterThan(0);
    });

    it('reports onset and peak days', () => {
      const r = sim.ecmDeposition({ cellType: 'chondrocyte', days: 21 });
      expect(r.components.collagen.onsetDay).toBe(3);
      expect(r.components.collagen.peakDay).toBe(14);
    });
  });

  // ── mechanicalEvolution ──

  describe('mechanicalEvolution', () => {
    it('returns mechanical property curve', () => {
      const r = sim.mechanicalEvolution({ tissueType: 'cartilage', days: 42 });
      expect(r.tissueType).toBe('cartilage');
      expect(r.finalModulusKPa).toBeGreaterThan(1);
      expect(r.percentOfTarget).toBeGreaterThan(0);
      expect(r.curve).toHaveLength(43);
    });

    it('modulus increases over time', () => {
      const r = sim.mechanicalEvolution({ tissueType: 'skin', days: 28 });
      expect(r.curve[28].modulusKPa).toBeGreaterThan(r.curve[0].modulusKPa);
    });

    it('works for all tissue types', () => {
      for (const tt of Object.keys(sim._profiles.tissues)) {
        const r = sim.mechanicalEvolution({ tissueType: tt });
        expect(r.finalModulusKPa).toBeGreaterThan(0);
      }
    });

    it('throws on unknown tissue type', () => {
      expect(() => sim.mechanicalEvolution({ tissueType: 'brain' })).toThrow('Unknown tissue type');
    });

    it('returns daysToTarget80Pct', () => {
      const r = sim.mechanicalEvolution({ tissueType: 'cartilage', days: 60 });
      expect(typeof r.daysToTarget80Pct).toBe('number');
    });

    it('tracks UTS alongside modulus', () => {
      const r = sim.mechanicalEvolution({ tissueType: 'cartilage', days: 28 });
      expect(r.finalUTS_KPa).toBeGreaterThan(0);
      expect(r.curve[28].utsKPa).toBeGreaterThan(r.curve[0].utsKPa);
    });

    it('allows custom initial modulus', () => {
      const r = sim.mechanicalEvolution({ tissueType: 'skin', initialModulusKPa: 5, days: 14 });
      expect(r.curve[0].modulusKPa).toBeGreaterThanOrEqual(5);
    });
  });

  // ── nutrientAnalysis ──

  describe('nutrientAnalysis', () => {
    it('returns oxygen profile', () => {
      const r = sim.nutrientAnalysis({ cellType: 'chondrocyte', thicknessMm: 2 });
      expect(r.oxygenProfile).toBeDefined();
      expect(r.oxygenProfile.profile.length).toBeGreaterThan(0);
      expect(r.maxViableThicknessMm).toBeGreaterThan(0);
    });

    it('thin constructs are viable', () => {
      const r = sim.nutrientAnalysis({ thicknessMm: 0.1, cellDensity: 1e6 });
      expect(r.isViable).toBe(true);
    });

    it('thick dense constructs may be hypoxic', () => {
      const r = sim.nutrientAnalysis({ thicknessMm: 10, cellDensity: 50e6, cellType: 'cardiomyocyte' });
      expect(r.oxygenProfile.isHypoxic).toBe(true);
      expect(r.recommendations.length).toBeGreaterThan(0);
    });

    it('throws on invalid thickness', () => {
      expect(() => sim.nutrientAnalysis({ thicknessMm: -1 })).toThrow('thicknessMm');
    });

    it('oxygen decreases with depth', () => {
      const r = sim.nutrientAnalysis({ thicknessMm: 3, cellDensity: 10e6 });
      const prof = r.oxygenProfile.profile;
      expect(prof[0].concentrationMM).toBeGreaterThanOrEqual(prof[prof.length - 1].concentrationMM);
    });

    it('recommends perfusion for thick constructs', () => {
      const r = sim.nutrientAnalysis({ thicknessMm: 5, cellDensity: 5e6 });
      const hasRec = r.recommendations.some(rec => rec.includes('perfusion') || rec.includes('bioreactor'));
      expect(hasRec).toBe(true);
    });
  });

  // ── maturityScore ──

  describe('maturityScore', () => {
    it('returns composite score with grade', () => {
      const r = sim.maturityScore({ tissueType: 'cartilage', day: 14 });
      expect(r.composite).toBeGreaterThanOrEqual(0);
      expect(r.composite).toBeLessThanOrEqual(100);
      expect(['A', 'B', 'C', 'D', 'F']).toContain(r.grade);
    });

    it('score increases over time', () => {
      const s0 = sim.maturityScore({ tissueType: 'skin', day: 1 });
      const s14 = sim.maturityScore({ tissueType: 'skin', day: 14 });
      expect(s14.composite).toBeGreaterThan(s0.composite);
    });

    it('has four weighted dimensions', () => {
      const r = sim.maturityScore({ day: 7 });
      expect(Object.keys(r.dimensions)).toHaveLength(4);
      const totalWeight = Object.values(r.dimensions).reduce((s, d) => s + d.weight, 0);
      expect(totalWeight).toBeCloseTo(1, 5);
    });

    it('day 0 scores low', () => {
      const r = sim.maturityScore({ day: 0 });
      expect(r.composite).toBeLessThan(70);
    });

    it('works for all tissue types', () => {
      for (const tt of Object.keys(sim._profiles.tissues)) {
        const r = sim.maturityScore({ tissueType: tt, day: 14 });
        expect(r.composite).toBeGreaterThanOrEqual(0);
      }
    });

    it('grade A requires score >= 90', () => {
      // Fully matured cartilage
      const r = sim.maturityScore({ tissueType: 'cartilage', day: 100 });
      if (r.composite >= 90) expect(r.grade).toBe('A');
    });
  });

  // ── compareTrajectories ──

  describe('compareTrajectories', () => {
    it('returns ranked trajectories for all tissues', () => {
      const r = sim.compareTrajectories({ days: 21, interval: 7 });
      expect(r.ranked.length).toBe(Object.keys(sim._profiles.tissues).length);
      expect(r.ranked[0].rank).toBe(1);
      expect(r.ranked[0].finalScore).toBeGreaterThanOrEqual(r.ranked[1].finalScore);
    });

    it('accepts subset of tissue types', () => {
      const r = sim.compareTrajectories({ tissueTypes: ['cartilage', 'skin'], days: 14 });
      expect(r.ranked).toHaveLength(2);
    });

    it('throws on bad interval', () => {
      expect(() => sim.compareTrajectories({ interval: -1 })).toThrow('interval');
    });
  });

  // ── optimalCultureTime ──

  describe('optimalCultureTime', () => {
    it('finds optimal day for grade B', () => {
      const r = sim.optimalCultureTime({ tissueType: 'skin', targetGrade: 'B' });
      expect(r.achieved).toBe(true);
      expect(r.optimalDay).toBeGreaterThanOrEqual(0);
      expect(r.scoreAtOptimal.composite).toBeGreaterThanOrEqual(75);
    });

    it('returns diminishing returns day', () => {
      const r = sim.optimalCultureTime({ tissueType: 'cartilage' });
      expect(typeof r.diminishingReturnsDay).toBe('number');
    });

    it('throws on invalid grade', () => {
      expect(() => sim.optimalCultureTime({ targetGrade: 'S' })).toThrow('Invalid grade');
    });

    it('handles unreachable grade within maxDays', () => {
      const r = sim.optimalCultureTime({ tissueType: 'bone', targetGrade: 'A', maxDays: 5 });
      expect(r.achieved).toBe(false);
      expect(r.optimalDay).toBeNull();
    });

    it('provides recommendation string', () => {
      const r = sim.optimalCultureTime({ tissueType: 'skin' });
      expect(r.recommendation).toContain('Culture for');
    });
  });

  // ── fullReport ──

  describe('fullReport', () => {
    it('returns comprehensive report', () => {
      const r = sim.fullReport({ tissueType: 'cartilage', days: 28 });
      expect(r.tissueType).toBe('cartilage');
      expect(r.tissueName).toBe('Articular Cartilage');
      expect(r.cellGrowth).toBeDefined();
      expect(r.ecmSummary).toBeDefined();
      expect(r.mechanicalProperties).toBeDefined();
      expect(r.nutrientStatus).toBeDefined();
      expect(r.maturityScore).toBeDefined();
      expect(r.weeklyProgress.length).toBeGreaterThan(0);
      expect(r.optimalCulture).toBeDefined();
    });

    it('includes alerts for hypoxic constructs', () => {
      const r = sim.fullReport({ tissueType: 'cartilage', days: 28, thicknessMm: 20 });
      const hasOxygenAlert = r.alerts.some(a => a.message.includes('Oxygen'));
      expect(hasOxygenAlert).toBe(true);
    });

    it('works for all tissue types', () => {
      for (const tt of Object.keys(sim._profiles.tissues)) {
        const r = sim.fullReport({ tissueType: tt, days: 14 });
        expect(r.tissueType).toBe(tt);
        expect(r.maturityScore.composite).toBeGreaterThanOrEqual(0);
      }
    });

    it('weekly progress generally increases', () => {
      const r = sim.fullReport({ tissueType: 'skin', days: 28 });
      const scores = r.weeklyProgress.map(w => w.score);
      // Final should be higher than first
      expect(scores[scores.length - 1]).toBeGreaterThanOrEqual(scores[0]);
    });

    it('uses defaults when no params', () => {
      const r = sim.fullReport();
      expect(r.tissueType).toBe('cartilage');
      expect(r.days).toBe(28);
    });
  });

  // ── profiles ──

  describe('profiles', () => {
    it('exposes cell profiles', () => {
      expect(Object.keys(sim._profiles.cells).length).toBeGreaterThanOrEqual(6);
    });

    it('exposes tissue targets', () => {
      expect(Object.keys(sim._profiles.tissues).length).toBeGreaterThanOrEqual(5);
    });

    it('each cell profile has required fields', () => {
      for (const [name, p] of Object.entries(sim._profiles.cells)) {
        expect(p.doublingTimeHours).toBeGreaterThan(0);
        expect(p.carryingCapacity).toBeGreaterThan(0);
        expect(p.ecmProfile).toBeDefined();
        expect(p.maturationMarkers.length).toBeGreaterThan(0);
      }
    });

    it('each tissue target references a valid cell type', () => {
      for (const t of Object.values(sim._profiles.tissues)) {
        expect(sim._profiles.cells).toHaveProperty(t.preferredCell);
      }
    });
  });
});
