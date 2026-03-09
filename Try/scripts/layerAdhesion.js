'use strict';

const { clamp, validatePositive, validateNonNegative, mean, round } = require('./scriptUtils');

/**
 * Bioprint Layer Adhesion Predictor
 *
 * Models inter-layer bonding strength in bioprinted constructs based on
 * material properties, print parameters, and environmental conditions.
 * Helps researchers predict and prevent delamination failures before
 * committing to long print runs.
 *
 * Physics models:
 *   - Polymer interdiffusion (reptation theory): bond strength grows as
 *     t^(1/4) at the interface, modulated by temperature via Arrhenius
 *   - Surface wetting: contact angle and surface tension predict initial
 *     adhesion quality
 *   - Crosslink bridging: UV/ionic crosslinks spanning the layer interface
 *     add covalent/ionic bond strength
 *   - Thermal gradient: temperature difference between deposited and
 *     previous layer affects chain mobility and thus interdiffusion rate
 *
 * Usage:
 *   const { createLayerAdhesionPredictor } = require('./layerAdhesion');
 *   const lap = createLayerAdhesionPredictor();
 *
 *   const result = lap.predictAdhesion({
 *     material: 'gelma-5',
 *     layerTime: 30,
 *     nozzleTemp: 37,
 *     bedTemp: 25,
 *     layerHeight: 0.2,
 *   });
 *
 *   const profile = lap.layerProfile({
 *     material: 'alginate-2',
 *     layers: 20,
 *     layerTime: 45,
 *   });
 *
 *   const optimal = lap.optimizeParams({ material: 'gelma-5', targetStrength: 8 });
 */

function createLayerAdhesionPredictor() {

  // ── Material database ─────────────────────────────────────────

  const MATERIALS = {
    'gelma-5': {
      name: 'GelMA 5%',
      category: 'photocrosslinkable',
      surfaceTensionMN: 42,      // mN/m
      contactAngleDeg: 35,       // degrees on glass
      diffusionCoeff: 2.8e-12,   // m²/s at 37°C
      activationEnergyKJ: 25,    // kJ/mol for chain mobility
      crosslinkMethod: 'uv',
      referenceTemp: 310,        // K (37°C)
      maxBondStrengthKPa: 15,    // kPa at full cure
      gelPointSec: 12,           // seconds to gel point under UV
      chainMobilityIndex: 0.72,  // 0-1, higher = more mobile
    },
    'gelma-10': {
      name: 'GelMA 10%',
      category: 'photocrosslinkable',
      surfaceTensionMN: 46,
      contactAngleDeg: 30,
      diffusionCoeff: 1.5e-12,
      activationEnergyKJ: 28,
      crosslinkMethod: 'uv',
      referenceTemp: 310,
      maxBondStrengthKPa: 22,
      gelPointSec: 8,
      chainMobilityIndex: 0.55,
    },
    'alginate-2': {
      name: 'Alginate 2%',
      category: 'ionic-crosslink',
      surfaceTensionMN: 55,
      contactAngleDeg: 25,
      diffusionCoeff: 4.2e-12,
      activationEnergyKJ: 18,
      crosslinkMethod: 'ionic',
      referenceTemp: 298,
      maxBondStrengthKPa: 8,
      gelPointSec: 5,
      chainMobilityIndex: 0.85,
    },
    'collagen-3': {
      name: 'Collagen Type I 3mg/mL',
      category: 'thermal-gel',
      surfaceTensionMN: 48,
      contactAngleDeg: 40,
      diffusionCoeff: 1.0e-12,
      activationEnergyKJ: 35,
      crosslinkMethod: 'thermal',
      referenceTemp: 310,
      maxBondStrengthKPa: 5,
      gelPointSec: 60,
      chainMobilityIndex: 0.40,
    },
    'pluronic-f127': {
      name: 'Pluronic F-127 30%',
      category: 'thermoreversible',
      surfaceTensionMN: 38,
      contactAngleDeg: 20,
      diffusionCoeff: 3.5e-12,
      activationEnergyKJ: 15,
      crosslinkMethod: 'thermal',
      referenceTemp: 298,
      maxBondStrengthKPa: 3,
      gelPointSec: 3,
      chainMobilityIndex: 0.90,
    },
    'pectin-2': {
      name: 'Pectin 2%',
      category: 'ionic-crosslink',
      surfaceTensionMN: 50,
      contactAngleDeg: 30,
      diffusionCoeff: 3.8e-12,
      activationEnergyKJ: 20,
      crosslinkMethod: 'ionic',
      referenceTemp: 298,
      maxBondStrengthKPa: 6,
      gelPointSec: 8,
      chainMobilityIndex: 0.78,
    },
  };

  // ── Constants ─────────────────────────────────────────────────

  const R_GAS = 8.314e-3; // kJ/(mol·K)

  // ── Core physics ──────────────────────────────────────────────

  /**
   * Arrhenius temperature factor for chain diffusion.
   * Returns a multiplier (>1 if T > Tref, <1 if T < Tref).
   */
  function tempFactor(tempK, refTempK, activationEnergyKJ) {
    return Math.exp((activationEnergyKJ / R_GAS) * (1 / refTempK - 1 / tempK));
  }

  /**
   * Interdiffusion bond strength from reptation theory.
   * σ(t) = σ_max · (D·t / h²)^(1/4)
   * where D is diffusion coefficient, t is contact time, h is layer height.
   */
  function interdiffusionStrength(mat, contactTimeSec, tempK, layerHeightMm) {
    var hMeters = layerHeightMm / 1000;
    var D = mat.diffusionCoeff * tempFactor(tempK, mat.referenceTemp, mat.activationEnergyKJ);
    var dimensionless = (D * contactTimeSec) / (hMeters * hMeters);
    var strength = mat.maxBondStrengthKPa * Math.pow(Math.min(dimensionless, 1), 0.25);
    return clamp(strength, 0, mat.maxBondStrengthKPa);
  }

  /**
   * Surface wetting score (0-1).
   * Lower contact angle = better wetting = higher initial adhesion.
   */
  function wettingScore(contactAngleDeg) {
    // cos(θ) normalized: cos(0)=1 (perfect), cos(90)=0 (no wetting)
    var rad = (contactAngleDeg * Math.PI) / 180;
    return clamp(Math.cos(rad), 0, 1);
  }

  /**
   * Crosslink bridging factor.
   * If the layer interface sees crosslinking (UV/ionic) before the
   * material fully gels, covalent/ionic bridges form across layers.
   * Factor decreases exponentially as layerTime exceeds gelPoint.
   */
  function crosslinkBridgingFactor(layerTimeSec, gelPointSec) {
    if (layerTimeSec <= 0 || gelPointSec <= 0) return 0;
    // If new layer deposited before gel point, excellent bridging
    // After gel point, bridging drops exponentially
    if (layerTimeSec <= gelPointSec) return 1.0;
    var excess = (layerTimeSec - gelPointSec) / gelPointSec;
    return Math.exp(-excess);
  }

  /**
   * Thermal gradient penalty.
   * Large temperature differences between layers reduce chain mobility
   * at the interface, harming interdiffusion.
   */
  function thermalGradientPenalty(nozzleTempC, bedTempC) {
    var diff = Math.abs(nozzleTempC - bedTempC);
    // No penalty below 5°C difference; linear penalty up to 30°C
    if (diff <= 5) return 1.0;
    return clamp(1 - (diff - 5) / 25, 0.3, 1.0);
  }

  // ── Main prediction ───────────────────────────────────────────

  /**
   * Predict inter-layer adhesion strength.
   *
   * @param {Object} params
   * @param {string} params.material - Material key from database
   * @param {number} params.layerTime - Time between layers (seconds)
   * @param {number} [params.nozzleTemp=37] - Nozzle temperature (°C)
   * @param {number} [params.bedTemp=25] - Bed/platform temperature (°C)
   * @param {number} [params.layerHeight=0.3] - Layer height (mm)
   * @param {number} [params.crosslinkDelay=0] - Delay before crosslinking (s)
   * @returns {Object} Adhesion prediction result
   */
  function predictAdhesion(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('params must be an object');
    }

    var matKey = params.material;
    var mat = MATERIALS[matKey];
    if (!mat) {
      throw new Error('Unknown material: ' + matKey + '. Available: ' + Object.keys(MATERIALS).join(', '));
    }

    var layerTime = params.layerTime;
    validatePositive(layerTime, 'layerTime');

    var nozzleTemp = params.nozzleTemp != null ? params.nozzleTemp : 37;
    var bedTemp = params.bedTemp != null ? params.bedTemp : 25;
    var layerHeight = params.layerHeight != null ? params.layerHeight : 0.3;
    var crosslinkDelay = params.crosslinkDelay != null ? params.crosslinkDelay : 0;

    validatePositive(layerHeight, 'layerHeight');
    validateNonNegative(crosslinkDelay, 'crosslinkDelay');

    // Interface temperature: average of nozzle and bed
    var interfaceTempC = (nozzleTemp + bedTemp) / 2;
    var interfaceTempK = interfaceTempC + 273.15;

    // Component scores
    var diffStrength = interdiffusionStrength(mat, layerTime, interfaceTempK, layerHeight);
    var wetting = wettingScore(mat.contactAngleDeg);
    var bridging = crosslinkBridgingFactor(layerTime + crosslinkDelay, mat.gelPointSec);
    var thermalPenalty = thermalGradientPenalty(nozzleTemp, bedTemp);

    // Composite adhesion strength (kPa)
    // Weighted combination: diffusion dominates, crosslink bridging adds,
    // wetting and thermal are multiplicative modifiers
    var baseStrength = diffStrength * 0.6 + mat.maxBondStrengthKPa * bridging * 0.4;
    var adhesionKPa = baseStrength * wetting * thermalPenalty;
    adhesionKPa = clamp(adhesionKPa, 0, mat.maxBondStrengthKPa);

    // Risk classification
    var riskLevel, recommendation;
    var ratio = adhesionKPa / mat.maxBondStrengthKPa;
    if (ratio >= 0.7) {
      riskLevel = 'low';
      recommendation = 'Good adhesion predicted — proceed with print.';
    } else if (ratio >= 0.4) {
      riskLevel = 'moderate';
      recommendation = 'Moderate adhesion — consider reducing layer time or increasing temperature.';
    } else if (ratio >= 0.2) {
      riskLevel = 'high';
      recommendation = 'Weak adhesion — high delamination risk. Reduce layer height or increase crosslink overlap.';
    } else {
      riskLevel = 'critical';
      recommendation = 'Very weak adhesion — delamination almost certain. Reconsider material or parameters.';
    }

    return {
      material: mat.name,
      adhesionStrengthKPa: round(adhesionKPa, 2),
      maxPossibleKPa: mat.maxBondStrengthKPa,
      bondRatio: round(ratio, 3),
      riskLevel: riskLevel,
      recommendation: recommendation,
      components: {
        interdiffusionKPa: round(diffStrength, 2),
        wettingScore: round(wetting, 3),
        crosslinkBridging: round(bridging, 3),
        thermalFactor: round(thermalPenalty, 3),
      },
      parameters: {
        layerTimeSec: layerTime,
        nozzleTempC: nozzleTemp,
        bedTempC: bedTemp,
        layerHeightMm: layerHeight,
        interfaceTempC: round(interfaceTempC, 1),
      },
    };
  }

  // ── Layer profile ─────────────────────────────────────────────

  /**
   * Predict adhesion for each layer interface in a multi-layer construct.
   *
   * @param {Object} params
   * @param {string} params.material - Material key
   * @param {number} params.layers - Number of layers
   * @param {number} params.layerTime - Time per layer (seconds)
   * @param {number} [params.nozzleTemp=37]
   * @param {number} [params.bedTemp=25]
   * @param {number} [params.layerHeight=0.3]
   * @param {number} [params.tempDropPerLayer=0] - °C cooling per layer distance from bed
   * @returns {Object} Layer-by-layer adhesion profile
   */
  function layerProfile(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('params must be an object');
    }

    var layers = params.layers;
    if (!Number.isInteger(layers) || layers < 2) {
      throw new Error('layers must be an integer >= 2');
    }

    var tempDrop = params.tempDropPerLayer || 0;
    var interfaces = [];
    var strengths = [];

    for (var i = 1; i < layers; i++) {
      // Each layer farther from heated bed loses some temperature
      var effectiveBedTemp = (params.bedTemp != null ? params.bedTemp : 25) - tempDrop * i;
      effectiveBedTemp = Math.max(effectiveBedTemp, 15); // floor at 15°C

      var result = predictAdhesion({
        material: params.material,
        layerTime: params.layerTime,
        nozzleTemp: params.nozzleTemp,
        bedTemp: effectiveBedTemp,
        layerHeight: params.layerHeight,
      });

      interfaces.push({
        interface: i,
        fromLayer: i,
        toLayer: i + 1,
        adhesionKPa: result.adhesionStrengthKPa,
        bondRatio: result.bondRatio,
        riskLevel: result.riskLevel,
        bedTempC: round(effectiveBedTemp, 1),
      });
      strengths.push(result.adhesionStrengthKPa);
    }

    // Find weakest interface (most likely failure point)
    var weakest = interfaces.reduce(function (min, iface) {
      return iface.adhesionKPa < min.adhesionKPa ? iface : min;
    }, interfaces[0]);

    return {
      material: MATERIALS[params.material].name,
      layerCount: layers,
      interfaceCount: interfaces.length,
      interfaces: interfaces,
      summary: {
        meanAdhesionKPa: round(mean(strengths), 2),
        minAdhesionKPa: round(Math.min.apply(null, strengths), 2),
        maxAdhesionKPa: round(Math.max.apply(null, strengths), 2),
        weakestInterface: weakest.interface,
        weakestRisk: weakest.riskLevel,
      },
    };
  }

  // ── Parameter optimization ────────────────────────────────────

  /**
   * Find optimal parameters to achieve a target adhesion strength.
   * Sweeps layer time and temperature ranges.
   *
   * @param {Object} params
   * @param {string} params.material - Material key
   * @param {number} [params.targetStrength=0] - Target adhesion (kPa), 0 = maximize
   * @param {number} [params.layerTimeRange=[5,120]] - Search range for layer time
   * @param {number} [params.tempRange=[20,42]] - Search range for nozzle temp
   * @returns {Object} Optimal parameter set
   */
  function optimizeParams(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('params must be an object');
    }

    var matKey = params.material;
    if (!MATERIALS[matKey]) {
      throw new Error('Unknown material: ' + matKey);
    }

    var target = params.targetStrength || 0;
    var timeRange = params.layerTimeRange || [5, 120];
    var tempRange = params.tempRange || [20, 42];

    var bestResult = null;
    var bestScore = -Infinity;
    var candidates = [];

    // Grid search
    for (var t = timeRange[0]; t <= timeRange[1]; t += 5) {
      for (var temp = tempRange[0]; temp <= tempRange[1]; temp += 2) {
        var result = predictAdhesion({
          material: matKey,
          layerTime: t,
          nozzleTemp: temp,
          bedTemp: 25,
          layerHeight: 0.3,
        });

        var score;
        if (target > 0) {
          // Minimize distance from target (prefer exceeding slightly)
          var diff = result.adhesionStrengthKPa - target;
          score = diff >= 0 ? -diff : diff * 2; // penalize under-target more
        } else {
          score = result.adhesionStrengthKPa;
        }

        candidates.push({
          layerTimeSec: t,
          nozzleTempC: temp,
          adhesionKPa: result.adhesionStrengthKPa,
          bondRatio: result.bondRatio,
          riskLevel: result.riskLevel,
          score: round(score, 3),
        });

        if (score > bestScore) {
          bestScore = score;
          bestResult = candidates[candidates.length - 1];
        }
      }
    }

    // Top 5 candidates
    candidates.sort(function (a, b) { return b.score - a.score; });

    return {
      material: MATERIALS[matKey].name,
      targetKPa: target || 'maximize',
      optimal: bestResult,
      topCandidates: candidates.slice(0, 5),
      searchSpace: {
        layerTimeRange: timeRange,
        tempRange: tempRange,
        pointsEvaluated: candidates.length,
      },
    };
  }

  // ── Material comparison ───────────────────────────────────────

  /**
   * Compare adhesion performance across all materials for given parameters.
   *
   * @param {Object} params
   * @param {number} params.layerTime - Time between layers (s)
   * @param {number} [params.nozzleTemp=37]
   * @param {number} [params.bedTemp=25]
   * @param {number} [params.layerHeight=0.3]
   * @returns {Object} Ranked comparison of all materials
   */
  function compareMaterials(params) {
    if (!params || typeof params !== 'object') {
      throw new Error('params must be an object');
    }

    validatePositive(params.layerTime, 'layerTime');

    var results = [];
    var keys = Object.keys(MATERIALS);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var result = predictAdhesion({
        material: key,
        layerTime: params.layerTime,
        nozzleTemp: params.nozzleTemp,
        bedTemp: params.bedTemp,
        layerHeight: params.layerHeight,
      });
      results.push({
        materialKey: key,
        materialName: result.material,
        adhesionKPa: result.adhesionStrengthKPa,
        bondRatio: result.bondRatio,
        riskLevel: result.riskLevel,
      });
    }

    // Sort by adhesion strength descending
    results.sort(function (a, b) { return b.adhesionKPa - a.adhesionKPa; });

    return {
      parameters: {
        layerTimeSec: params.layerTime,
        nozzleTempC: params.nozzleTemp || 37,
        bedTempC: params.bedTemp || 25,
        layerHeightMm: params.layerHeight || 0.3,
      },
      rankings: results,
      bestMaterial: results[0],
      worstMaterial: results[results.length - 1],
    };
  }

  // ── Public API ────────────────────────────────────────────────

  return {
    predictAdhesion: predictAdhesion,
    layerProfile: layerProfile,
    optimizeParams: optimizeParams,
    compareMaterials: compareMaterials,
    getMaterials: function () { return JSON.parse(JSON.stringify(MATERIALS)); },
    getMaterialKeys: function () { return Object.keys(MATERIALS); },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createLayerAdhesionPredictor };
}
