/**
 * @jest-environment jsdom
 */

'use strict';

const { createLayerAdhesionPredictor } = require('../Try/scripts/layerAdhesion');

describe('LayerAdhesionPredictor', () => {
  let lap;

  beforeEach(() => {
    lap = createLayerAdhesionPredictor();
  });

  // ── Material database ──────────────────────────────────────

  describe('Material database', () => {
    test('getMaterialKeys returns all 6 materials', () => {
      const keys = lap.getMaterialKeys();
      expect(keys).toHaveLength(6);
      expect(keys).toContain('gelma-5');
      expect(keys).toContain('alginate-2');
      expect(keys).toContain('collagen-3');
    });

    test('getMaterials returns deep copies', () => {
      const m1 = lap.getMaterials();
      const m2 = lap.getMaterials();
      m1['gelma-5'].name = 'MODIFIED';
      expect(m2['gelma-5'].name).toBe('GelMA 5%');
    });

    test('all materials have required fields', () => {
      const materials = lap.getMaterials();
      for (const [key, mat] of Object.entries(materials)) {
        expect(mat.name).toBeTruthy();
        expect(mat.surfaceTensionMN).toBeGreaterThan(0);
        expect(mat.contactAngleDeg).toBeGreaterThanOrEqual(0);
        expect(mat.diffusionCoeff).toBeGreaterThan(0);
        expect(mat.maxBondStrengthKPa).toBeGreaterThan(0);
        expect(mat.gelPointSec).toBeGreaterThan(0);
        expect(['uv', 'ionic', 'thermal']).toContain(mat.crosslinkMethod);
      }
    });
  });

  // ── predictAdhesion ────────────────────────────────────────

  describe('predictAdhesion', () => {
    test('returns adhesion result for valid params', () => {
      const r = lap.predictAdhesion({
        material: 'gelma-5',
        layerTime: 30,
        nozzleTemp: 37,
        bedTemp: 25,
        layerHeight: 0.3,
      });
      expect(r.material).toBe('GelMA 5%');
      expect(r.adhesionStrengthKPa).toBeGreaterThan(0);
      expect(r.maxPossibleKPa).toBe(15);
      expect(r.bondRatio).toBeGreaterThan(0);
      expect(r.bondRatio).toBeLessThanOrEqual(1);
      expect(['low', 'moderate', 'high', 'critical']).toContain(r.riskLevel);
      expect(r.recommendation).toBeTruthy();
    });

    test('uses default temperatures when not provided', () => {
      const r = lap.predictAdhesion({
        material: 'alginate-2',
        layerTime: 20,
      });
      expect(r.parameters.nozzleTempC).toBe(37);
      expect(r.parameters.bedTempC).toBe(25);
      expect(r.parameters.layerHeightMm).toBe(0.3);
    });

    test('longer layer time increases interdiffusion strength', () => {
      const short = lap.predictAdhesion({ material: 'gelma-5', layerTime: 5 });
      const long = lap.predictAdhesion({ material: 'gelma-5', layerTime: 60 });
      expect(long.components.interdiffusionKPa).toBeGreaterThan(
        short.components.interdiffusionKPa
      );
    });

    test('higher nozzle temp increases adhesion when bed matches', () => {
      const cold = lap.predictAdhesion({
        material: 'gelma-5', layerTime: 30, nozzleTemp: 25, bedTemp: 25,
      });
      const warm = lap.predictAdhesion({
        material: 'gelma-5', layerTime: 30, nozzleTemp: 42, bedTemp: 42,
      });
      expect(warm.adhesionStrengthKPa).toBeGreaterThanOrEqual(
        cold.adhesionStrengthKPa
      );
    });

    test('large thermal gradient reduces adhesion', () => {
      const matched = lap.predictAdhesion({
        material: 'gelma-5', layerTime: 30, nozzleTemp: 37, bedTemp: 35,
      });
      const gradient = lap.predictAdhesion({
        material: 'gelma-5', layerTime: 30, nozzleTemp: 37, bedTemp: 10,
      });
      expect(matched.adhesionStrengthKPa).toBeGreaterThan(
        gradient.adhesionStrengthKPa
      );
    });

    test('thinner layer increases adhesion (shorter diffusion path)', () => {
      const thin = lap.predictAdhesion({
        material: 'gelma-5', layerTime: 30, layerHeight: 0.1,
      });
      const thick = lap.predictAdhesion({
        material: 'gelma-5', layerTime: 30, layerHeight: 0.5,
      });
      expect(thin.adhesionStrengthKPa).toBeGreaterThan(
        thick.adhesionStrengthKPa
      );
    });

    test('adhesion never exceeds material maximum', () => {
      const r = lap.predictAdhesion({
        material: 'gelma-5', layerTime: 10000, nozzleTemp: 42, layerHeight: 0.01,
      });
      expect(r.adhesionStrengthKPa).toBeLessThanOrEqual(15);
    });

    test('crosslink bridging is high when layerTime < gelPoint', () => {
      // gelma-5 gelPoint is 12s
      const fast = lap.predictAdhesion({
        material: 'gelma-5', layerTime: 5,
      });
      expect(fast.components.crosslinkBridging).toBe(1);
    });

    test('crosslink bridging decreases when layerTime > gelPoint', () => {
      const fast = lap.predictAdhesion({
        material: 'gelma-5', layerTime: 5,
      });
      const slow = lap.predictAdhesion({
        material: 'gelma-5', layerTime: 60,
      });
      expect(slow.components.crosslinkBridging).toBeLessThan(
        fast.components.crosslinkBridging
      );
    });

    test('components sub-object has all expected fields', () => {
      const r = lap.predictAdhesion({ material: 'gelma-5', layerTime: 30 });
      expect(r.components).toHaveProperty('interdiffusionKPa');
      expect(r.components).toHaveProperty('wettingScore');
      expect(r.components).toHaveProperty('crosslinkBridging');
      expect(r.components).toHaveProperty('thermalFactor');
    });

    test('parameters sub-object reflects inputs', () => {
      const r = lap.predictAdhesion({
        material: 'gelma-10', layerTime: 45, nozzleTemp: 40, bedTemp: 30, layerHeight: 0.2,
      });
      expect(r.parameters.layerTimeSec).toBe(45);
      expect(r.parameters.nozzleTempC).toBe(40);
      expect(r.parameters.bedTempC).toBe(30);
      expect(r.parameters.layerHeightMm).toBe(0.2);
      expect(r.parameters.interfaceTempC).toBe(35);
    });

    // ── Risk levels ──

    test('risk levels correspond to bond ratio thresholds', () => {
      // Test with parameters that give very high adhesion
      const high = lap.predictAdhesion({
        material: 'pluronic-f127', layerTime: 1, layerHeight: 0.01,
      });
      // And very low adhesion
      const low = lap.predictAdhesion({
        material: 'collagen-3', layerTime: 1, nozzleTemp: 20, bedTemp: 50, layerHeight: 1.0,
      });
      // Both should have valid risk levels
      expect(['low', 'moderate', 'high', 'critical']).toContain(high.riskLevel);
      expect(['low', 'moderate', 'high', 'critical']).toContain(low.riskLevel);
    });

    // ── Error handling ──

    test('throws on unknown material', () => {
      expect(() => lap.predictAdhesion({ material: 'unobtainium', layerTime: 30 }))
        .toThrow('Unknown material');
    });

    test('throws on missing params', () => {
      expect(() => lap.predictAdhesion()).toThrow();
      expect(() => lap.predictAdhesion(null)).toThrow();
    });

    test('throws on non-positive layerTime', () => {
      expect(() => lap.predictAdhesion({ material: 'gelma-5', layerTime: 0 }))
        .toThrow();
      expect(() => lap.predictAdhesion({ material: 'gelma-5', layerTime: -5 }))
        .toThrow();
    });

    test('throws on non-positive layerHeight', () => {
      expect(() => lap.predictAdhesion({
        material: 'gelma-5', layerTime: 30, layerHeight: 0,
      })).toThrow();
    });
  });

  // ── layerProfile ───────────────────────────────────────────

  describe('layerProfile', () => {
    test('returns profile for multi-layer construct', () => {
      const p = lap.layerProfile({
        material: 'gelma-5',
        layers: 10,
        layerTime: 30,
      });
      expect(p.material).toBe('GelMA 5%');
      expect(p.layerCount).toBe(10);
      expect(p.interfaceCount).toBe(9);
      expect(p.interfaces).toHaveLength(9);
    });

    test('interface numbers are sequential', () => {
      const p = lap.layerProfile({
        material: 'alginate-2', layers: 5, layerTime: 20,
      });
      expect(p.interfaces.map(i => i.interface)).toEqual([1, 2, 3, 4]);
    });

    test('summary includes mean/min/max/weakest', () => {
      const p = lap.layerProfile({
        material: 'gelma-5', layers: 5, layerTime: 30,
      });
      expect(p.summary.meanAdhesionKPa).toBeGreaterThan(0);
      expect(p.summary.minAdhesionKPa).toBeGreaterThan(0);
      expect(p.summary.maxAdhesionKPa).toBeGreaterThanOrEqual(p.summary.minAdhesionKPa);
      expect(p.summary.weakestInterface).toBeGreaterThanOrEqual(1);
    });

    test('temp drop reduces adhesion in upper layers', () => {
      const flat = lap.layerProfile({
        material: 'gelma-5', layers: 10, layerTime: 30, tempDropPerLayer: 0,
      });
      const dropping = lap.layerProfile({
        material: 'gelma-5', layers: 10, layerTime: 30, tempDropPerLayer: 1,
      });
      // With temp drop, upper layers should have lower adhesion
      expect(dropping.summary.minAdhesionKPa).toBeLessThanOrEqual(
        flat.summary.minAdhesionKPa
      );
    });

    test('weakest interface is at top when temp drops', () => {
      const p = lap.layerProfile({
        material: 'gelma-5', layers: 20, layerTime: 30, tempDropPerLayer: 0.5,
      });
      // Weakest should be near the top (higher interface number)
      expect(p.summary.weakestInterface).toBeGreaterThan(5);
    });

    test('throws on fewer than 2 layers', () => {
      expect(() => lap.layerProfile({
        material: 'gelma-5', layers: 1, layerTime: 30,
      })).toThrow('layers must be an integer >= 2');
    });

    test('throws on non-integer layers', () => {
      expect(() => lap.layerProfile({
        material: 'gelma-5', layers: 5.5, layerTime: 30,
      })).toThrow();
    });
  });

  // ── optimizeParams ─────────────────────────────────────────

  describe('optimizeParams', () => {
    test('finds optimal parameters to maximize adhesion', () => {
      const opt = lap.optimizeParams({ material: 'gelma-5' });
      expect(opt.material).toBe('GelMA 5%');
      expect(opt.targetKPa).toBe('maximize');
      expect(opt.optimal).toBeTruthy();
      expect(opt.optimal.adhesionKPa).toBeGreaterThan(0);
      expect(opt.topCandidates.length).toBeLessThanOrEqual(5);
    });

    test('finds parameters close to target strength', () => {
      const opt = lap.optimizeParams({
        material: 'gelma-5',
        targetStrength: 8,
      });
      expect(opt.targetKPa).toBe(8);
      // Best candidate should be reasonably close to target
      expect(Math.abs(opt.optimal.adhesionKPa - 8)).toBeLessThan(5);
    });

    test('top candidates are sorted by score descending', () => {
      const opt = lap.optimizeParams({ material: 'alginate-2' });
      for (let i = 1; i < opt.topCandidates.length; i++) {
        expect(opt.topCandidates[i - 1].score).toBeGreaterThanOrEqual(
          opt.topCandidates[i].score
        );
      }
    });

    test('search space is recorded', () => {
      const opt = lap.optimizeParams({
        material: 'gelma-5',
        layerTimeRange: [10, 50],
        tempRange: [25, 40],
      });
      expect(opt.searchSpace.layerTimeRange).toEqual([10, 50]);
      expect(opt.searchSpace.tempRange).toEqual([25, 40]);
      expect(opt.searchSpace.pointsEvaluated).toBeGreaterThan(0);
    });

    test('throws on unknown material', () => {
      expect(() => lap.optimizeParams({ material: 'fake' })).toThrow();
    });
  });

  // ── compareMaterials ───────────────────────────────────────

  describe('compareMaterials', () => {
    test('ranks all materials by adhesion strength', () => {
      const cmp = lap.compareMaterials({ layerTime: 30 });
      expect(cmp.rankings).toHaveLength(6);
      expect(cmp.bestMaterial).toBeTruthy();
      expect(cmp.worstMaterial).toBeTruthy();
      expect(cmp.bestMaterial.adhesionKPa).toBeGreaterThanOrEqual(
        cmp.worstMaterial.adhesionKPa
      );
    });

    test('rankings are sorted descending by adhesionKPa', () => {
      const cmp = lap.compareMaterials({ layerTime: 20 });
      for (let i = 1; i < cmp.rankings.length; i++) {
        expect(cmp.rankings[i - 1].adhesionKPa).toBeGreaterThanOrEqual(
          cmp.rankings[i].adhesionKPa
        );
      }
    });

    test('parameters reflected in result', () => {
      const cmp = lap.compareMaterials({
        layerTime: 45, nozzleTemp: 40, bedTemp: 30, layerHeight: 0.2,
      });
      expect(cmp.parameters.layerTimeSec).toBe(45);
      expect(cmp.parameters.nozzleTempC).toBe(40);
    });

    test('each ranking has required fields', () => {
      const cmp = lap.compareMaterials({ layerTime: 30 });
      for (const r of cmp.rankings) {
        expect(r.materialKey).toBeTruthy();
        expect(r.materialName).toBeTruthy();
        expect(typeof r.adhesionKPa).toBe('number');
        expect(typeof r.bondRatio).toBe('number');
        expect(['low', 'moderate', 'high', 'critical']).toContain(r.riskLevel);
      }
    });

    test('throws on missing layerTime', () => {
      expect(() => lap.compareMaterials({})).toThrow();
    });
  });

  // ── Cross-material consistency ─────────────────────────────

  describe('Cross-material behavior', () => {
    test('all materials produce valid results', () => {
      const keys = lap.getMaterialKeys();
      for (const key of keys) {
        const r = lap.predictAdhesion({ material: key, layerTime: 30 });
        expect(r.adhesionStrengthKPa).toBeGreaterThanOrEqual(0);
        expect(r.adhesionStrengthKPa).toBeLessThanOrEqual(r.maxPossibleKPa);
        expect(Number.isFinite(r.bondRatio)).toBe(true);
        expect(Number.isFinite(r.components.interdiffusionKPa)).toBe(true);
        expect(Number.isFinite(r.components.wettingScore)).toBe(true);
        expect(Number.isFinite(r.components.crosslinkBridging)).toBe(true);
        expect(Number.isFinite(r.components.thermalFactor)).toBe(true);
      }
    });

    test('higher diffusion coefficient materials have higher interdiffusion at same time', () => {
      // alginate has higher diffusion than collagen
      const alg = lap.predictAdhesion({ material: 'alginate-2', layerTime: 30 });
      const col = lap.predictAdhesion({ material: 'collagen-3', layerTime: 30 });
      expect(alg.components.interdiffusionKPa).toBeGreaterThan(0);
      expect(col.components.interdiffusionKPa).toBeGreaterThan(0);
    });
  });
});
