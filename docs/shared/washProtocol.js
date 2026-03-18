'use strict';

/**
 * Wash Protocol Calculator — computes post-print washing protocols
 * for bioprinted constructs based on dimensions, material, and target
 * residual concentration.
 *
 * Handles common crosslinker-removal and solvent-exchange scenarios.
 *
 * @example
 *   var wash = require('./washProtocol');
 *   var calc = wash.createWashProtocolCalculator();
 *   var protocol = calc.calculate({
 *     constructVolume_mL: 0.5,
 *     material: 'alginate-CaCl2',
 *     targetResidual: 0.01
 *   });
 */

/* ── Material wash profiles ───────────────────────────────────── */

var WASH_PROFILES = {
  'alginate-CaCl2': {
    label: 'Alginate / CaCl₂ crosslinked',
    washSolution: 'DPBS',
    diffusionCoeff_cm2s: 1.2e-5,
    initialConc_mM: 100,
    minCycles: 2,
    maxCycles: 8,
    soakTemp_C: 37,
    agitation: 'gentle orbital (60 rpm)'
  },
  'gelatin-GelMA': {
    label: 'GelMA photo-crosslinked',
    washSolution: 'Warm DPBS (37 °C)',
    diffusionCoeff_cm2s: 0.8e-5,
    initialConc_mM: 50,
    minCycles: 3,
    maxCycles: 10,
    soakTemp_C: 37,
    agitation: 'gentle orbital (60 rpm)'
  },
  'collagen-NaOH': {
    label: 'Collagen / NaOH neutralised',
    washSolution: '1× PBS pH 7.4',
    diffusionCoeff_cm2s: 0.6e-5,
    initialConc_mM: 200,
    minCycles: 3,
    maxCycles: 10,
    soakTemp_C: 25,
    agitation: 'static with periodic inversion'
  },
  'PEGDA': {
    label: 'PEGDA photo-crosslinked',
    washSolution: 'DPBS',
    diffusionCoeff_cm2s: 1.0e-5,
    initialConc_mM: 30,
    minCycles: 2,
    maxCycles: 6,
    soakTemp_C: 25,
    agitation: 'gentle rocking'
  },
  'fibrin-thrombin': {
    label: 'Fibrin / thrombin',
    washSolution: 'Serum-free medium',
    diffusionCoeff_cm2s: 0.9e-5,
    initialConc_mM: 10,
    minCycles: 2,
    maxCycles: 5,
    soakTemp_C: 37,
    agitation: 'static'
  },
  'custom': {
    label: 'Custom material',
    washSolution: 'User-defined',
    diffusionCoeff_cm2s: 1.0e-5,
    initialConc_mM: 100,
    minCycles: 2,
    maxCycles: 10,
    soakTemp_C: 25,
    agitation: 'gentle orbital'
  }
};

/* ── Helpers ──────────────────────────────────────────────────── */

/**
 * Estimate characteristic diffusion time for a slab of given thickness.
 * t_diff ≈ L² / (π² · D)
 */
function diffusionTime_s(thickness_cm, D_cm2s) {
  return (thickness_cm * thickness_cm) / (Math.PI * Math.PI * D_cm2s);
}

/**
 * Residual fraction after n perfect-exchange washes.
 * C_n / C_0 = (V_c / (V_c + V_w))^n  (dilution model)
 * Combined with diffusion efficiency factor η for each cycle.
 */
function residualFraction(n, constructVol, washVol, eta) {
  var dilution = constructVol / (constructVol + washVol);
  var effectiveDilution = dilution * (1 - eta) + (1 - eta) * 0.05;
  // simplified: each cycle removes eta fraction of remaining solute
  return Math.pow(1 - eta, n);
}

/**
 * Compute the wash-to-construct volume ratio (typically 5-20×).
 */
function washVolumeRatio(constructVol_mL) {
  if (constructVol_mL <= 0.1) return 20;
  if (constructVol_mL <= 1.0) return 10;
  if (constructVol_mL <= 5.0) return 7;
  return 5;
}

/* ── Main calculator ──────────────────────────────────────────── */

function createWashProtocolCalculator() {
  return {
    /**
     * List available material profiles.
     * @returns {string[]}
     */
    listMaterials: function() {
      return Object.keys(WASH_PROFILES);
    },

    /**
     * Get details for a material profile.
     * @param {string} material
     * @returns {object|null}
     */
    getProfile: function(material) {
      return WASH_PROFILES[material] || null;
    },

    /**
     * Calculate a complete wash protocol.
     *
     * @param {object} opts
     * @param {number} opts.constructVolume_mL - Construct volume in mL
     * @param {string} [opts.material='alginate-CaCl2'] - Material profile key
     * @param {number} [opts.targetResidual=0.01] - Target residual fraction (0-1)
     * @param {number} [opts.thickness_cm] - Construct thickness (auto-estimated if omitted)
     * @param {number} [opts.customDiffCoeff] - Override diffusion coefficient (cm²/s)
     * @param {number} [opts.customInitialConc_mM] - Override initial concentration
     * @param {number} [opts.washVolumeRatio] - Override wash:construct volume ratio
     * @returns {object} protocol
     */
    calculate: function(opts) {
      if (!opts || typeof opts.constructVolume_mL !== 'number' || opts.constructVolume_mL <= 0) {
        throw new Error('constructVolume_mL must be a positive number');
      }

      var matKey = opts.material || 'alginate-CaCl2';
      var profile = WASH_PROFILES[matKey] || WASH_PROFILES['custom'];
      var target = typeof opts.targetResidual === 'number' ? opts.targetResidual : 0.01;

      if (target <= 0 || target >= 1) {
        throw new Error('targetResidual must be between 0 and 1 (exclusive)');
      }

      var vol = opts.constructVolume_mL;
      var D = opts.customDiffCoeff || profile.diffusionCoeff_cm2s;
      var initConc = opts.customInitialConc_mM || profile.initialConc_mM;

      // Estimate thickness assuming a disc: V = π r² h, aspect ~3:1 diameter:height
      var thickness_cm = opts.thickness_cm ||
        Math.pow((4 * vol) / (9 * Math.PI), 1 / 3); // from V=π(1.5h)²h

      var tDiff = diffusionTime_s(thickness_cm, D);

      // Soak time per cycle: 1.5× diffusion time (empirical safety factor)
      var soakPerCycle_s = tDiff * 1.5;
      var soakPerCycle_min = Math.ceil(soakPerCycle_s / 60);
      // Clamp soak to reasonable range
      soakPerCycle_min = Math.max(5, Math.min(soakPerCycle_min, 120));

      // Per-cycle removal efficiency (diffusion-limited)
      var eta = 1 - Math.exp(-1.5); // ~0.777 for 1.5× diffusion time
      // Adjust for agitation bonus
      if (profile.agitation && profile.agitation.indexOf('orbital') !== -1) {
        eta = Math.min(eta * 1.1, 0.95);
      }

      // Calculate required cycles
      var cycles = Math.ceil(Math.log(target) / Math.log(1 - eta));
      cycles = Math.max(cycles, profile.minCycles);
      cycles = Math.min(cycles, profile.maxCycles);

      // Actual residual achieved
      var actualResidual = Math.pow(1 - eta, cycles);
      var residualConc_mM = initConc * actualResidual;

      var ratio = opts.washVolumeRatio || washVolumeRatio(vol);
      var washVol_mL = vol * ratio;
      var totalWashVol_mL = washVol_mL * cycles;
      var totalTime_min = soakPerCycle_min * cycles;

      // Build step-by-step protocol
      var steps = [];
      var currentConc = initConc;
      for (var i = 1; i <= cycles; i++) {
        currentConc = currentConc * (1 - eta);
        steps.push({
          cycle: i,
          action: 'Replace with ' + washVol_mL.toFixed(1) + ' mL fresh ' + profile.washSolution,
          soakTime_min: soakPerCycle_min,
          temperature_C: profile.soakTemp_C,
          agitation: profile.agitation,
          estimatedResidual_mM: parseFloat(currentConc.toFixed(4))
        });
      }

      return {
        material: profile.label,
        materialKey: matKey,
        constructVolume_mL: vol,
        thickness_cm: parseFloat(thickness_cm.toFixed(3)),
        washSolution: profile.washSolution,
        temperature_C: profile.soakTemp_C,
        washVolumePerCycle_mL: parseFloat(washVol_mL.toFixed(1)),
        totalCycles: cycles,
        soakPerCycle_min: soakPerCycle_min,
        totalTime_min: totalTime_min,
        totalWashVolume_mL: parseFloat(totalWashVol_mL.toFixed(1)),
        perCycleEfficiency: parseFloat(eta.toFixed(4)),
        targetResidual: target,
        achievedResidual: parseFloat(actualResidual.toFixed(6)),
        finalResidualConc_mM: parseFloat(residualConc_mM.toFixed(4)),
        targetMet: actualResidual <= target,
        steps: steps
      };
    },

    /**
     * Compare protocols across different materials for the same construct.
     *
     * @param {number} constructVolume_mL
     * @param {number} [targetResidual=0.01]
     * @returns {object[]} array of protocol summaries
     */
    compare: function(constructVolume_mL, targetResidual) {
      var self = this;
      var target = targetResidual || 0.01;
      var results = [];
      var keys = Object.keys(WASH_PROFILES).filter(function(k) { return k !== 'custom'; });
      keys.forEach(function(k) {
        try {
          var p = self.calculate({
            constructVolume_mL: constructVolume_mL,
            material: k,
            targetResidual: target
          });
          results.push({
            material: p.material,
            cycles: p.totalCycles,
            totalTime_min: p.totalTime_min,
            totalWashVolume_mL: p.totalWashVolume_mL,
            finalResidualConc_mM: p.finalResidualConc_mM,
            targetMet: p.targetMet
          });
        } catch (e) {
          // skip
        }
      });
      return results;
    },

    /**
     * Format a protocol as a human-readable text summary.
     *
     * @param {object} protocol - Output from calculate()
     * @returns {string}
     */
    formatProtocol: function(protocol) {
      var p = protocol;
      var lines = [
        '═══ WASH PROTOCOL ═══',
        'Material: ' + p.material,
        'Construct: ' + p.constructVolume_mL + ' mL (thickness ≈ ' + p.thickness_cm + ' cm)',
        'Wash solution: ' + p.washSolution + ' at ' + p.temperature_C + ' °C',
        '',
        'Cycles: ' + p.totalCycles + ' × ' + p.soakPerCycle_min + ' min = ' + p.totalTime_min + ' min total',
        'Volume per wash: ' + p.washVolumePerCycle_mL + ' mL (' + p.totalWashVolume_mL + ' mL total)',
        'Per-cycle efficiency: ' + (p.perCycleEfficiency * 100).toFixed(1) + '%',
        '',
        '── Steps ──'
      ];
      p.steps.forEach(function(s) {
        lines.push(
          '  ' + s.cycle + '. ' + s.action +
          ' → soak ' + s.soakTime_min + ' min' +
          ' (' + s.agitation + ')' +
          ' — residual ≈ ' + s.estimatedResidual_mM + ' mM'
        );
      });
      lines.push('');
      lines.push('Final residual: ' + p.finalResidualConc_mM + ' mM (' + (p.achievedResidual * 100).toFixed(3) + '%)');
      lines.push('Target ' + (p.targetMet ? '✓ MET' : '✗ NOT MET') +
        ' (goal: <' + (p.targetResidual * 100).toFixed(1) + '%)');
      return lines.join('\n');
    }
  };
}

module.exports = {
  createWashProtocolCalculator: createWashProtocolCalculator,
  WASH_PROFILES: WASH_PROFILES
};
