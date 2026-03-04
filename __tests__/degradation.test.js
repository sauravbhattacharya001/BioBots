'use strict';

const {
  createDegradationPredictor,
  MATERIAL_PROFILES,
  TISSUE_TARGETS,
  arrheniusFactor,
  phFactor,
  crystallinityFactor,
  porosityFactor,
  effectiveRate,
  resolveProfile,
} = require('../Try/scripts/degradation');

describe('Scaffold Degradation Predictor', () => {
  let pred;

  beforeEach(() => {
    pred = createDegradationPredictor();
  });

  // ── resolveProfile ──

  describe('resolveProfile', () => {
    it('resolves built-in material by name', () => {
      const p = resolveProfile('PLA');
      expect(p.name).toBe('Polylactic Acid');
      expect(p.kHydrolytic).toBe(0.008);
    });

    it('throws for unknown material', () => {
      expect(() => resolveProfile('Unobtanium')).toThrow('Unknown material');
    });

    it('accepts custom material object with required fields', () => {
      const custom = {
        name: 'Custom',
        degradationMechanisms: ['hydrolytic'],
        kHydrolytic: 0.01,
        refTempC: 37,
        refPH: 7.4,
      };
      const p = resolveProfile(custom);
      expect(p.name).toBe('Custom');
    });

    it('throws for custom material missing required field', () => {
      expect(() => resolveProfile({ name: 'Bad' })).toThrow('missing required field');
    });

    it('throws for non-string non-object', () => {
      expect(() => resolveProfile(42)).toThrow('must be a string name or object');
    });
  });

  // ── Kinetics helpers ──

  describe('arrheniusFactor', () => {
    it('returns 1.0 at reference temperature', () => {
      expect(arrheniusFactor(37, 37, 80)).toBeCloseTo(1.0, 5);
    });

    it('increases rate at higher temperature', () => {
      expect(arrheniusFactor(45, 37, 80)).toBeGreaterThan(1);
    });

    it('decreases rate at lower temperature', () => {
      expect(arrheniusFactor(25, 37, 80)).toBeLessThan(1);
    });
  });

  describe('phFactor', () => {
    it('returns 1.0 at reference pH', () => {
      expect(phFactor(7.4, 7.4, 0.3)).toBeCloseTo(1.0, 5);
    });

    it('increases rate at acidic pH', () => {
      expect(phFactor(5.0, 7.4, 0.3)).toBeGreaterThan(1);
    });

    it('acidic pH gives higher factor than same distance basic', () => {
      const acidic = phFactor(5.4, 7.4, 0.3);
      const basic = phFactor(9.4, 7.4, 0.3);
      expect(acidic).toBeGreaterThan(basic);
    });
  });

  describe('crystallinityFactor', () => {
    it('returns 1.0 with zero crystallinity', () => {
      expect(crystallinityFactor(0, 0.4)).toBe(1.0);
    });

    it('slows degradation with high crystallinity', () => {
      expect(crystallinityFactor(0.5, 0.4)).toBeLessThan(1);
    });

    it('returns 1.0 with null inputs', () => {
      expect(crystallinityFactor(null, null)).toBe(1.0);
    });
  });

  describe('porosityFactor', () => {
    it('returns 1.0 at porosity 0.5 (baseline)', () => {
      expect(porosityFactor(0.5)).toBeCloseTo(1.0, 5);
    });

    it('lower porosity slows degradation', () => {
      expect(porosityFactor(0.2)).toBeLessThan(1);
    });

    it('higher porosity accelerates degradation', () => {
      expect(porosityFactor(0.9)).toBeGreaterThan(1);
    });

    it('returns 1.0 for null porosity', () => {
      expect(porosityFactor(null)).toBe(1.0);
    });
  });

  // ── effectiveRate ──

  describe('effectiveRate', () => {
    it('returns base rate at reference conditions', () => {
      const profile = resolveProfile('PLA');
      const rate = effectiveRate(profile, { tempC: 37, pH: 7.4 });
      // Should be close to kHydrolytic * crystallinityFactor
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThan(profile.kHydrolytic * 2);
    });

    it('includes enzymatic contribution when enzyme present', () => {
      const profile = resolveProfile('GelMA 5%');
      const rateNoEnz = effectiveRate(profile, { tempC: 37, pH: 7.4, enzymeConcentration: 0 });
      const rateEnz = effectiveRate(profile, { tempC: 37, pH: 7.4, enzymeConcentration: 2.0 });
      expect(rateEnz).toBeGreaterThan(rateNoEnz);
    });

    it('higher temperature increases rate', () => {
      const profile = resolveProfile('PCL');
      const r1 = effectiveRate(profile, { tempC: 30 });
      const r2 = effectiveRate(profile, { tempC: 45 });
      expect(r2).toBeGreaterThan(r1);
    });
  });

  // ── massCurve ──

  describe('massCurve', () => {
    it('starts at massFraction 1.0', () => {
      const curve = pred.massCurve('PLA', { days: 30 });
      expect(curve[0].massFraction).toBe(1.0);
      expect(curve[0].day).toBe(0);
    });

    it('mass decreases over time', () => {
      const curve = pred.massCurve('PLGA 50:50', { days: 60 });
      expect(curve[curve.length - 1].massFraction).toBeLessThan(curve[0].massFraction);
    });

    it('faster degrading material loses more mass', () => {
      const pla = pred.massCurve('PLA', { days: 60 });
      const plga = pred.massCurve('PLGA 50:50', { days: 60 });
      expect(plga[plga.length - 1].massFraction).toBeLessThan(pla[pla.length - 1].massFraction);
    });

    it('massLossPercent is consistent with massFraction', () => {
      const curve = pred.massCurve('Alginate 2%', { days: 30 });
      for (const pt of curve) {
        expect(pt.massLossPercent).toBeCloseTo((1 - pt.massFraction) * 100, 0);
      }
    });

    it('throws for invalid days', () => {
      expect(() => pred.massCurve('PLA', { days: -5 })).toThrow();
    });
  });

  // ── molecularWeightCurve ──

  describe('molecularWeightCurve', () => {
    it('starts at initial MW', () => {
      const curve = pred.molecularWeightCurve('PLA', { days: 30 });
      expect(curve[0].mwKDa).toBe(100);
      expect(curve[0].mwFraction).toBe(1.0);
    });

    it('MW decreases over time', () => {
      const curve = pred.molecularWeightCurve('PLA', { days: 90 });
      const last = curve[curve.length - 1];
      expect(last.mwKDa).toBeLessThan(100);
    });

    it('shorter half-life means faster MW loss', () => {
      const alginate = pred.molecularWeightCurve('Alginate 2%', { days: 30 });
      const pcl = pred.molecularWeightCurve('PCL', { days: 30 });
      expect(alginate[alginate.length - 1].mwFraction).toBeLessThan(
        pcl[pcl.length - 1].mwFraction
      );
    });
  });

  // ── mechanicalDecayCurve ──

  describe('mechanicalDecayCurve', () => {
    it('starts near 1.0 mechanical fraction', () => {
      const curve = pred.mechanicalDecayCurve('PLA', { days: 30 });
      expect(curve[0].mechanicalFraction).toBeCloseTo(1.0, 2);
    });

    it('mechanical strength decreases over time', () => {
      const curve = pred.mechanicalDecayCurve('PLGA 50:50', { days: 60 });
      expect(curve[curve.length - 1].mechanicalFraction).toBeLessThan(1.0);
    });

    it('mechanicalLossPercent is consistent', () => {
      const curve = pred.mechanicalDecayCurve('GelMA 5%', { days: 30 });
      for (const pt of curve) {
        expect(pt.mechanicalLossPercent).toBeCloseTo((1 - pt.mechanicalFraction) * 100, 0);
      }
    });
  });

  // ── functionalLifetime ──

  describe('functionalLifetime', () => {
    it('returns positive lifetime for all built-in materials', () => {
      for (const name of pred.listMaterials()) {
        const lt = pred.functionalLifetime(name, { minMassFraction: 0.5 });
        expect(lt.effectiveLifetimeDays).toBeGreaterThan(0);
        expect(['mass', 'mechanical']).toContain(lt.limitingFactor);
      }
    });

    it('stricter threshold gives shorter lifetime', () => {
      const lt1 = pred.functionalLifetime('PLA', { minMassFraction: 0.3 });
      const lt2 = pred.functionalLifetime('PLA', { minMassFraction: 0.7 });
      expect(lt2.effectiveLifetimeDays).toBeLessThan(lt1.effectiveLifetimeDays);
    });

    it('PCL has longer lifetime than PLGA 50:50', () => {
      const pcl = pred.functionalLifetime('PCL', {});
      const plga = pred.functionalLifetime('PLGA 50:50', {});
      expect(pcl.effectiveLifetimeDays).toBeGreaterThan(plga.effectiveLifetimeDays);
    });

    it('includes threshold info', () => {
      const lt = pred.functionalLifetime('PLA', { minMassFraction: 0.6, minMechFraction: 0.4 });
      expect(lt.thresholds.minMassFraction).toBe(0.6);
      expect(lt.thresholds.minMechFraction).toBe(0.4);
    });
  });

  // ── compareMaterials ──

  describe('compareMaterials', () => {
    it('returns sorted results (longest lifetime first)', () => {
      const results = pred.compareMaterials(['PLA', 'PLGA 50:50', 'PCL']);
      expect(results.length).toBe(3);
      expect(results[0].effectiveLifetimeDays).toBeGreaterThanOrEqual(
        results[1].effectiveLifetimeDays
      );
    });

    it('includes rate and half-life info', () => {
      const results = pred.compareMaterials(['PLA', 'Alginate 2%']);
      for (const r of results) {
        expect(r.effectiveRatePerDay).toBeGreaterThan(0);
        expect(r.halfLifeDays).toBeGreaterThan(0);
      }
    });
  });

  // ── sensitivityAnalysis ──

  describe('sensitivityAnalysis', () => {
    it('returns sensitivity factors for non-enzymatic material', () => {
      const sa = pred.sensitivityAnalysis('PLA', { tempC: 37, pH: 7.4 });
      expect(sa.material).toBe('Polylactic Acid');
      expect(sa.factors.length).toBe(3); // temp, pH, porosity
      expect(sa.mostSensitiveTo).toBeTruthy();
    });

    it('returns enzyme factor for enzymatic materials', () => {
      const sa = pred.sensitivityAnalysis('GelMA 5%', { tempC: 37, pH: 7.4, enzymeConcentration: 1 });
      const enzFactor = sa.factors.find(f => f.parameter.includes('enzyme'));
      expect(enzFactor).toBeTruthy();
      expect(sa.factors.length).toBe(4);
    });

    it('each factor has sensitivityIndex > 0', () => {
      const sa = pred.sensitivityAnalysis('Collagen I', { tempC: 37, pH: 7.4 });
      for (const f of sa.factors) {
        expect(f.sensitivityIndex).toBeGreaterThan(0);
      }
    });
  });

  // ── tissueSuitability ──

  describe('tissueSuitability', () => {
    it('PCL is good for bone (slow degradation)', () => {
      const result = pred.tissueSuitability('PCL', 'bone');
      expect(result.score).toBeGreaterThanOrEqual(50);
      expect(['excellent', 'good', 'adequate']).toContain(result.suitability);
    });

    it('Alginate is suitable for skin (fast degradation ok)', () => {
      const result = pred.tissueSuitability('Alginate 2%', 'skin');
      expect(result.score).toBeGreaterThan(0);
    });

    it('throws for unknown tissue', () => {
      expect(() => pred.tissueSuitability('PLA', 'hair')).toThrow('Unknown tissue');
    });

    it('returns recommendation text', () => {
      const result = pred.tissueSuitability('PLA', 'cartilage');
      expect(result.recommendation).toBeTruthy();
      expect(typeof result.recommendation).toBe('string');
    });

    it('score is 0-100', () => {
      for (const mat of pred.listMaterials()) {
        for (const tissue of pred.listTissues()) {
          const r = pred.tissueSuitability(mat, tissue);
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(100);
        }
      }
    });
  });

  // ── recommendMaterial ──

  describe('recommendMaterial', () => {
    it('returns ranked materials for bone', () => {
      const rec = pred.recommendMaterial('bone');
      expect(rec.rankings.length).toBe(Object.keys(MATERIAL_PROFILES).length);
      expect(rec.bestMatch.score).toBeGreaterThanOrEqual(rec.rankings[1].score);
    });

    it('best match for skin should be a fast-degrading material', () => {
      const rec = pred.recommendMaterial('skin');
      expect(rec.bestMatch.score).toBeGreaterThan(0);
    });

    it('respects candidate filter', () => {
      const rec = pred.recommendMaterial('cartilage', {}, ['PLA', 'PCL']);
      expect(rec.rankings.length).toBe(2);
    });
  });

  // ── fullReport ──

  describe('fullReport', () => {
    it('returns comprehensive report', () => {
      const report = pred.fullReport('PLA', { days: 60 });
      expect(report.material.name).toBe('Polylactic Acid');
      expect(report.kinetics.effectiveRatePerDay).toBeGreaterThan(0);
      expect(report.kinetics.halfLifeDays).toBeGreaterThan(0);
      expect(report.timePoints.day30).toBeTruthy();
      expect(report.lifetime.effectiveLifetimeDays).toBeGreaterThan(0);
      expect(report.curves.mass.length).toBeGreaterThan(0);
      expect(report.curves.molecularWeight.length).toBeGreaterThan(0);
      expect(report.curves.mechanical.length).toBeGreaterThan(0);
    });

    it('time points show progressive degradation', () => {
      const report = pred.fullReport('PLGA 50:50', { days: 90 });
      expect(report.timePoints.day30.massFraction).toBeGreaterThan(
        report.timePoints.day60.massFraction
      );
      expect(report.timePoints.day60.massFraction).toBeGreaterThan(
        report.timePoints.day90.massFraction
      );
    });
  });

  // ── Factory API ──

  describe('factory API', () => {
    it('listMaterials returns all built-in names', () => {
      const names = pred.listMaterials();
      expect(names).toContain('PLA');
      expect(names).toContain('PCL');
      expect(names).toContain('GelMA 5%');
      expect(names.length).toBe(Object.keys(MATERIAL_PROFILES).length);
    });

    it('listTissues returns all tissue types', () => {
      const tissues = pred.listTissues();
      expect(tissues).toContain('bone');
      expect(tissues).toContain('skin');
      expect(tissues.length).toBe(Object.keys(TISSUE_TARGETS).length);
    });

    it('getMaterial returns profile copy', () => {
      const p = pred.getMaterial('PLA');
      expect(p.name).toBe('Polylactic Acid');
      p.name = 'Modified';
      expect(pred.getMaterial('PLA').name).toBe('Polylactic Acid');
    });

    it('effectiveRate works through factory', () => {
      const rate = pred.effectiveRate('PLA', { tempC: 37, pH: 7.4 });
      expect(rate).toBeGreaterThan(0);
    });
  });

  // ── Edge cases ──

  describe('edge cases', () => {
    it('handles very short time periods', () => {
      const curve = pred.massCurve('PLA', { days: 1 });
      expect(curve.length).toBeGreaterThan(1);
      expect(curve[curve.length - 1].massFraction).toBeCloseTo(1.0, 1);
    });

    it('handles very long time periods', () => {
      const curve = pred.massCurve('PCL', { days: 1000, steps: 100 });
      expect(curve.length).toBe(101);
    });

    it('custom material works end-to-end', () => {
      const custom = {
        name: 'CustomBio',
        type: 'natural',
        degradationMechanisms: ['hydrolytic'],
        kHydrolytic: 0.05,
        refTempC: 37,
        refPH: 7.4,
        activationEnergyKJ: 50,
        phSensitivity: 0.3,
        initialMwKDa: 40,
        mwHalfLifeDays: 10,
        mechLagFraction: 0.05,
        mechDecayRate: 2.0,
      };
      const curve = pred.massCurve(custom, { days: 30 });
      expect(curve[0].massFraction).toBe(1.0);
      expect(curve[curve.length - 1].massFraction).toBeLessThan(0.5);
    });

    it('all materials produce valid full reports', () => {
      for (const name of pred.listMaterials()) {
        const report = pred.fullReport(name, { days: 30 });
        expect(report.material.name).toBeTruthy();
        expect(report.kinetics.halfLifeDays).toBeGreaterThan(0);
      }
    });
  });
});
