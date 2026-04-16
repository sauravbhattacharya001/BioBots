/**
 * Print Failure Diagnostic System
 *
 * Post-print / mid-print diagnostic tool that, given observed symptoms
 * (nozzle clogging, poor layer adhesion, cell death, under-extrusion,
 * structural collapse, warping, stringing, etc.), traces backward through
 * a decision-tree knowledge base to identify likely root causes and
 * recommend corrective parameter adjustments.
 *
 * Complements the pre-print Risk Assessor with reactive diagnostics.
 *
 * Features:
 * - 12 observable symptoms with severity grading
 * - Multi-cause diagnosis with confidence scoring
 * - Parameter-aware root cause analysis
 * - Corrective action recommendations with priority
 * - Symptom co-occurrence pattern detection
 * - Diagnostic history tracking
 * - Batch diagnosis across multiple prints
 * - Text report generation
 *
 * Usage:
 *   const diag = createFailureDiagnostic();
 *   const result = diag.diagnose(['nozzle_clog', 'under_extrusion'], params);
 *   const report = diag.generateReport(result);
 */

'use strict';

// ── Symptom definitions ───────────────────────────────────────────

const SYMPTOMS = Object.freeze({
  nozzle_clog: {
    id: 'nozzle_clog',
    label: 'Nozzle Clogging',
    description: 'Partial or complete blockage of extrusion nozzle',
    category: 'extrusion',
  },
  under_extrusion: {
    id: 'under_extrusion',
    label: 'Under-Extrusion',
    description: 'Less material deposited than expected, gaps in filament',
    category: 'extrusion',
  },
  over_extrusion: {
    id: 'over_extrusion',
    label: 'Over-Extrusion',
    description: 'Excess material causing blobbing or overflow',
    category: 'extrusion',
  },
  poor_adhesion: {
    id: 'poor_adhesion',
    label: 'Poor Layer Adhesion',
    description: 'Layers delaminating or not bonding properly',
    category: 'structural',
  },
  structural_collapse: {
    id: 'structural_collapse',
    label: 'Structural Collapse',
    description: 'Printed structure loses shape or collapses under own weight',
    category: 'structural',
  },
  warping: {
    id: 'warping',
    label: 'Warping / Curling',
    description: 'Edges or layers curl upward away from build plate',
    category: 'structural',
  },
  stringing: {
    id: 'stringing',
    label: 'Stringing / Oozing',
    description: 'Thin strings of material between printed sections',
    category: 'extrusion',
  },
  cell_death: {
    id: 'cell_death',
    label: 'Low Cell Viability',
    description: 'High proportion of dead cells in printed construct',
    category: 'biological',
  },
  poor_resolution: {
    id: 'poor_resolution',
    label: 'Poor Print Resolution',
    description: 'Feature details lost, rough surface finish',
    category: 'quality',
  },
  dehydration: {
    id: 'dehydration',
    label: 'Construct Dehydration',
    description: 'Printed construct drying out during or after printing',
    category: 'environmental',
  },
  contamination: {
    id: 'contamination',
    label: 'Contamination',
    description: 'Microbial growth or foreign material in construct',
    category: 'environmental',
  },
  crosslink_failure: {
    id: 'crosslink_failure',
    label: 'Crosslinking Failure',
    description: 'Inadequate or excessive crosslinking of bioink',
    category: 'chemical',
  },
});

// ── Severity levels ───────────────────────────────────────────────

const SEVERITY = Object.freeze({
  MILD: 'mild',
  MODERATE: 'moderate',
  SEVERE: 'severe',
  CRITICAL: 'critical',
});

const SEVERITY_WEIGHT = Object.freeze({
  mild: 1.0,
  moderate: 1.5,
  severe: 2.0,
  critical: 3.0,
});

// ── Root causes and diagnostic rules ─────────────────────────────

const ROOT_CAUSES = Object.freeze({
  high_pressure: {
    id: 'high_pressure',
    label: 'Excessive Extrusion Pressure',
    category: 'parameter',
    description: 'Pressure exceeds optimal range for bioink viscosity',
  },
  low_pressure: {
    id: 'low_pressure',
    label: 'Insufficient Extrusion Pressure',
    category: 'parameter',
    description: 'Pressure too low for consistent material flow',
  },
  high_speed: {
    id: 'high_speed',
    label: 'Excessive Print Speed',
    category: 'parameter',
    description: 'Speed too fast for material to properly deposit and bond',
  },
  low_speed: {
    id: 'low_speed',
    label: 'Print Speed Too Slow',
    category: 'parameter',
    description: 'Slow speed increasing dwell time and exposure',
  },
  high_temperature: {
    id: 'high_temperature',
    label: 'Temperature Too High',
    category: 'environmental',
    description: 'Nozzle or ambient temperature above optimal range',
  },
  low_temperature: {
    id: 'low_temperature',
    label: 'Temperature Too Low',
    category: 'environmental',
    description: 'Temperature below bioink working range causing gelation',
  },
  narrow_nozzle: {
    id: 'narrow_nozzle',
    label: 'Nozzle Diameter Too Small',
    category: 'hardware',
    description: 'Nozzle gauge too narrow for bioink particle size',
  },
  wide_nozzle: {
    id: 'wide_nozzle',
    label: 'Nozzle Diameter Too Large',
    category: 'hardware',
    description: 'Wide nozzle reducing resolution and causing oozing',
  },
  thick_layers: {
    id: 'thick_layers',
    label: 'Layer Height Too Large',
    category: 'parameter',
    description: 'Thick layers causing poor inter-layer bonding and resolution',
  },
  thin_layers: {
    id: 'thin_layers',
    label: 'Layer Height Too Small',
    category: 'parameter',
    description: 'Very thin layers increasing shear and print time',
  },
  insufficient_crosslink: {
    id: 'insufficient_crosslink',
    label: 'Insufficient Crosslinking',
    category: 'chemical',
    description: 'Crosslink duration or intensity too low for structural integrity',
  },
  excessive_crosslink: {
    id: 'excessive_crosslink',
    label: 'Excessive Crosslinking',
    category: 'chemical',
    description: 'Over-crosslinking damaging cells or making material brittle',
  },
  bioink_degradation: {
    id: 'bioink_degradation',
    label: 'Bioink Degradation',
    category: 'material',
    description: 'Bioink has degraded due to age, temperature, or contamination',
  },
  low_humidity: {
    id: 'low_humidity',
    label: 'Low Ambient Humidity',
    category: 'environmental',
    description: 'Dry environment causing rapid construct dehydration',
  },
  non_sterile: {
    id: 'non_sterile',
    label: 'Non-Sterile Conditions',
    category: 'environmental',
    description: 'Contamination from unsterile environment or equipment',
  },
  high_shear: {
    id: 'high_shear',
    label: 'Excessive Shear Stress',
    category: 'mechanical',
    description: 'Combined speed/pressure/nozzle causing damaging shear forces',
  },
  long_print_time: {
    id: 'long_print_time',
    label: 'Extended Print Duration',
    category: 'process',
    description: 'Long print time increasing exposure and dehydration risk',
  },
  low_infill: {
    id: 'low_infill',
    label: 'Insufficient Infill Density',
    category: 'parameter',
    description: 'Infill too sparse to support structure',
  },
});

// ── Diagnostic rules: symptom → causes with base confidence ──────

const DIAGNOSTIC_RULES = [
  // Nozzle clogging
  { symptom: 'nozzle_clog', cause: 'high_pressure', confidence: 0.5,
    paramCheck: p => p && p.pressure > 150 ? 0.3 : 0 },
  { symptom: 'nozzle_clog', cause: 'narrow_nozzle', confidence: 0.6,
    paramCheck: p => p && p.nozzleDiameter < 0.2 ? 0.3 : 0 },
  { symptom: 'nozzle_clog', cause: 'low_temperature', confidence: 0.5,
    paramCheck: p => p && p.temperature < 15 ? 0.3 : 0 },
  { symptom: 'nozzle_clog', cause: 'bioink_degradation', confidence: 0.4,
    paramCheck: () => 0 },

  // Under-extrusion
  { symptom: 'under_extrusion', cause: 'low_pressure', confidence: 0.7,
    paramCheck: p => p && p.pressure < 20 ? 0.2 : 0 },
  { symptom: 'under_extrusion', cause: 'narrow_nozzle', confidence: 0.5,
    paramCheck: p => p && p.nozzleDiameter < 0.2 ? 0.25 : 0 },
  { symptom: 'under_extrusion', cause: 'high_speed', confidence: 0.5,
    paramCheck: p => p && p.speed > 30 ? 0.25 : 0 },
  { symptom: 'under_extrusion', cause: 'bioink_degradation', confidence: 0.3,
    paramCheck: () => 0 },

  // Over-extrusion
  { symptom: 'over_extrusion', cause: 'high_pressure', confidence: 0.7,
    paramCheck: p => p && p.pressure > 150 ? 0.2 : 0 },
  { symptom: 'over_extrusion', cause: 'wide_nozzle', confidence: 0.5,
    paramCheck: p => p && p.nozzleDiameter > 0.8 ? 0.25 : 0 },
  { symptom: 'over_extrusion', cause: 'low_speed', confidence: 0.5,
    paramCheck: p => p && p.speed < 3 ? 0.25 : 0 },

  // Poor adhesion
  { symptom: 'poor_adhesion', cause: 'high_speed', confidence: 0.6,
    paramCheck: p => p && p.speed > 25 ? 0.2 : 0 },
  { symptom: 'poor_adhesion', cause: 'thick_layers', confidence: 0.6,
    paramCheck: p => p && p.layerHeight > 0.5 ? 0.25 : 0 },
  { symptom: 'poor_adhesion', cause: 'insufficient_crosslink', confidence: 0.5,
    paramCheck: p => p && p.crosslinkIntensity < 15 ? 0.25 : 0 },
  { symptom: 'poor_adhesion', cause: 'low_temperature', confidence: 0.4,
    paramCheck: p => p && p.temperature < 15 ? 0.2 : 0 },

  // Structural collapse
  { symptom: 'structural_collapse', cause: 'insufficient_crosslink', confidence: 0.7,
    paramCheck: p => p && p.crosslinkIntensity < 10 ? 0.2 : 0 },
  { symptom: 'structural_collapse', cause: 'low_infill', confidence: 0.6,
    paramCheck: p => p && p.infill < 30 ? 0.25 : 0 },
  { symptom: 'structural_collapse', cause: 'thick_layers', confidence: 0.4,
    paramCheck: p => p && p.layerHeight > 0.6 ? 0.2 : 0 },
  { symptom: 'structural_collapse', cause: 'high_temperature', confidence: 0.4,
    paramCheck: p => p && p.temperature > 38 ? 0.2 : 0 },

  // Warping
  { symptom: 'warping', cause: 'high_temperature', confidence: 0.5,
    paramCheck: p => p && p.temperature > 35 ? 0.25 : 0 },
  { symptom: 'warping', cause: 'low_humidity', confidence: 0.5,
    paramCheck: p => p && p.humidity < 40 ? 0.3 : 0 },
  { symptom: 'warping', cause: 'excessive_crosslink', confidence: 0.5,
    paramCheck: p => p && p.crosslinkIntensity > 80 ? 0.25 : 0 },
  { symptom: 'warping', cause: 'thick_layers', confidence: 0.3,
    paramCheck: p => p && p.layerHeight > 0.5 ? 0.15 : 0 },

  // Stringing
  { symptom: 'stringing', cause: 'high_temperature', confidence: 0.6,
    paramCheck: p => p && p.temperature > 35 ? 0.2 : 0 },
  { symptom: 'stringing', cause: 'low_speed', confidence: 0.4,
    paramCheck: p => p && p.speed < 5 ? 0.2 : 0 },
  { symptom: 'stringing', cause: 'wide_nozzle', confidence: 0.5,
    paramCheck: p => p && p.nozzleDiameter > 0.8 ? 0.2 : 0 },
  { symptom: 'stringing', cause: 'high_pressure', confidence: 0.4,
    paramCheck: p => p && p.pressure > 120 ? 0.2 : 0 },

  // Cell death
  { symptom: 'cell_death', cause: 'high_shear', confidence: 0.7,
    paramCheck: p => {
      if (!p) return 0;
      const shear = (p.speed || 10) * (p.pressure || 50) / (p.nozzleDiameter || 0.4);
      return shear > 5000 ? 0.25 : 0;
    }},
  { symptom: 'cell_death', cause: 'high_temperature', confidence: 0.5,
    paramCheck: p => p && p.temperature > 40 ? 0.3 : 0 },
  { symptom: 'cell_death', cause: 'excessive_crosslink', confidence: 0.5,
    paramCheck: p => p && p.crosslinkIntensity > 70 ? 0.25 : 0 },
  { symptom: 'cell_death', cause: 'high_pressure', confidence: 0.5,
    paramCheck: p => p && p.pressure > 180 ? 0.2 : 0 },
  { symptom: 'cell_death', cause: 'long_print_time', confidence: 0.4,
    paramCheck: p => p && p.printDuration > 120 ? 0.2 : 0 },

  // Poor resolution
  { symptom: 'poor_resolution', cause: 'wide_nozzle', confidence: 0.7,
    paramCheck: p => p && p.nozzleDiameter > 0.6 ? 0.2 : 0 },
  { symptom: 'poor_resolution', cause: 'thick_layers', confidence: 0.6,
    paramCheck: p => p && p.layerHeight > 0.4 ? 0.2 : 0 },
  { symptom: 'poor_resolution', cause: 'high_speed', confidence: 0.4,
    paramCheck: p => p && p.speed > 25 ? 0.2 : 0 },
  { symptom: 'poor_resolution', cause: 'over_extrusion', confidence: 0.3,
    paramCheck: p => p && p.pressure > 120 ? 0.15 : 0 },

  // Dehydration
  { symptom: 'dehydration', cause: 'low_humidity', confidence: 0.8,
    paramCheck: p => p && p.humidity < 30 ? 0.15 : 0 },
  { symptom: 'dehydration', cause: 'long_print_time', confidence: 0.6,
    paramCheck: p => p && p.printDuration > 90 ? 0.2 : 0 },
  { symptom: 'dehydration', cause: 'high_temperature', confidence: 0.4,
    paramCheck: p => p && p.temperature > 35 ? 0.2 : 0 },

  // Contamination
  { symptom: 'contamination', cause: 'non_sterile', confidence: 0.8,
    paramCheck: () => 0 },
  { symptom: 'contamination', cause: 'long_print_time', confidence: 0.4,
    paramCheck: p => p && p.printDuration > 120 ? 0.2 : 0 },
  { symptom: 'contamination', cause: 'bioink_degradation', confidence: 0.3,
    paramCheck: () => 0 },

  // Crosslink failure
  { symptom: 'crosslink_failure', cause: 'insufficient_crosslink', confidence: 0.8,
    paramCheck: p => p && p.crosslinkIntensity < 10 ? 0.15 : 0 },
  { symptom: 'crosslink_failure', cause: 'excessive_crosslink', confidence: 0.5,
    paramCheck: p => p && p.crosslinkIntensity > 80 ? 0.2 : 0 },
  { symptom: 'crosslink_failure', cause: 'bioink_degradation', confidence: 0.4,
    paramCheck: () => 0 },
  { symptom: 'crosslink_failure', cause: 'low_temperature', confidence: 0.3,
    paramCheck: p => p && p.temperature < 10 ? 0.2 : 0 },
];

// ── Corrective actions per root cause ────────────────────────────

const CORRECTIVE_ACTIONS = Object.freeze({
  high_pressure: [
    { action: 'Reduce extrusion pressure by 10-20%', priority: 1, parameter: 'pressure', direction: 'decrease' },
    { action: 'Switch to a wider nozzle to allow lower pressure', priority: 2, parameter: 'nozzleDiameter', direction: 'increase' },
    { action: 'Warm bioink slightly to reduce viscosity', priority: 3, parameter: 'temperature', direction: 'increase' },
  ],
  low_pressure: [
    { action: 'Increase extrusion pressure by 10-20%', priority: 1, parameter: 'pressure', direction: 'increase' },
    { action: 'Check for air bubbles in cartridge', priority: 2, parameter: null, direction: null },
    { action: 'Verify bioink is not over-crosslinked before extrusion', priority: 3, parameter: null, direction: null },
  ],
  high_speed: [
    { action: 'Reduce print speed by 20-30%', priority: 1, parameter: 'speed', direction: 'decrease' },
    { action: 'Increase pressure slightly to compensate for speed', priority: 2, parameter: 'pressure', direction: 'increase' },
  ],
  low_speed: [
    { action: 'Increase print speed to reduce dwell time', priority: 1, parameter: 'speed', direction: 'increase' },
    { action: 'Reduce nozzle temperature if oozing is observed', priority: 2, parameter: 'temperature', direction: 'decrease' },
  ],
  high_temperature: [
    { action: 'Lower nozzle/platform temperature by 2-5°C', priority: 1, parameter: 'temperature', direction: 'decrease' },
    { action: 'Ensure cooling system is functioning', priority: 2, parameter: null, direction: null },
  ],
  low_temperature: [
    { action: 'Increase temperature by 2-5°C', priority: 1, parameter: 'temperature', direction: 'increase' },
    { action: 'Pre-warm bioink cartridge before loading', priority: 2, parameter: null, direction: null },
    { action: 'Check temperature sensor calibration', priority: 3, parameter: null, direction: null },
  ],
  narrow_nozzle: [
    { action: 'Switch to next larger nozzle gauge', priority: 1, parameter: 'nozzleDiameter', direction: 'increase' },
    { action: 'Filter bioink to remove large particles', priority: 2, parameter: null, direction: null },
    { action: 'Increase pressure slightly with current nozzle', priority: 3, parameter: 'pressure', direction: 'increase' },
  ],
  wide_nozzle: [
    { action: 'Switch to a smaller nozzle gauge for better resolution', priority: 1, parameter: 'nozzleDiameter', direction: 'decrease' },
    { action: 'Reduce pressure to prevent over-extrusion', priority: 2, parameter: 'pressure', direction: 'decrease' },
  ],
  thick_layers: [
    { action: 'Reduce layer height by 20-30%', priority: 1, parameter: 'layerHeight', direction: 'decrease' },
    { action: 'Increase inter-layer crosslinking time', priority: 2, parameter: 'crosslinkIntensity', direction: 'increase' },
  ],
  thin_layers: [
    { action: 'Increase layer height to reduce total print time', priority: 1, parameter: 'layerHeight', direction: 'increase' },
    { action: 'Reduce pressure to match thinner layer requirement', priority: 2, parameter: 'pressure', direction: 'decrease' },
  ],
  insufficient_crosslink: [
    { action: 'Increase UV/crosslink intensity by 15-25%', priority: 1, parameter: 'crosslinkIntensity', direction: 'increase' },
    { action: 'Extend crosslinking duration per layer', priority: 2, parameter: 'crosslinkDuration', direction: 'increase' },
    { action: 'Check photo-initiator concentration in bioink', priority: 3, parameter: null, direction: null },
  ],
  excessive_crosslink: [
    { action: 'Reduce UV/crosslink intensity by 15-25%', priority: 1, parameter: 'crosslinkIntensity', direction: 'decrease' },
    { action: 'Shorten crosslinking duration per layer', priority: 2, parameter: 'crosslinkDuration', direction: 'decrease' },
    { action: 'Add cell-protective additives', priority: 3, parameter: null, direction: null },
  ],
  bioink_degradation: [
    { action: 'Replace bioink with fresh batch', priority: 1, parameter: null, direction: null },
    { action: 'Check storage conditions (temperature, light exposure)', priority: 2, parameter: null, direction: null },
    { action: 'Verify bioink expiration date', priority: 3, parameter: null, direction: null },
  ],
  low_humidity: [
    { action: 'Increase enclosure humidity to 80-95%', priority: 1, parameter: 'humidity', direction: 'increase' },
    { action: 'Apply hydrating mist during print pauses', priority: 2, parameter: null, direction: null },
    { action: 'Use hydrogel support bath', priority: 3, parameter: null, direction: null },
  ],
  non_sterile: [
    { action: 'Sterilize all equipment and work area', priority: 1, parameter: null, direction: null },
    { action: 'Use UV sterilization between prints', priority: 2, parameter: null, direction: null },
    { action: 'Work inside laminar flow hood', priority: 3, parameter: null, direction: null },
  ],
  high_shear: [
    { action: 'Reduce speed × pressure product', priority: 1, parameter: 'speed', direction: 'decrease' },
    { action: 'Use wider nozzle to reduce shear at same flow rate', priority: 2, parameter: 'nozzleDiameter', direction: 'increase' },
    { action: 'Switch to shear-thinning bioink formulation', priority: 3, parameter: null, direction: null },
  ],
  long_print_time: [
    { action: 'Increase print speed where viability allows', priority: 1, parameter: 'speed', direction: 'increase' },
    { action: 'Reduce construct complexity or size', priority: 2, parameter: null, direction: null },
    { action: 'Use multi-nozzle printing to parallelize', priority: 3, parameter: null, direction: null },
  ],
  low_infill: [
    { action: 'Increase infill density by 15-25%', priority: 1, parameter: 'infill', direction: 'increase' },
    { action: 'Use support structures for overhangs', priority: 2, parameter: null, direction: null },
  ],
});

// ── Co-occurrence patterns ───────────────────────────────────────

const CO_OCCURRENCE_PATTERNS = [
  {
    symptoms: ['nozzle_clog', 'under_extrusion'],
    label: 'Flow Restriction Syndrome',
    description: 'Combined clogging and under-extrusion indicates material flow obstruction',
    likelyCause: 'narrow_nozzle',
    confidenceBoost: 0.15,
  },
  {
    symptoms: ['cell_death', 'poor_adhesion'],
    label: 'Over-Processing Syndrome',
    description: 'Cell death with adhesion failure suggests excessive mechanical/thermal stress',
    likelyCause: 'high_shear',
    confidenceBoost: 0.15,
  },
  {
    symptoms: ['structural_collapse', 'crosslink_failure'],
    label: 'Integrity Failure Syndrome',
    description: 'Collapse with crosslink issues indicates fundamental gelation problem',
    likelyCause: 'insufficient_crosslink',
    confidenceBoost: 0.2,
  },
  {
    symptoms: ['stringing', 'over_extrusion'],
    label: 'Excess Flow Syndrome',
    description: 'Both symptoms point to too much material being deposited',
    likelyCause: 'high_pressure',
    confidenceBoost: 0.15,
  },
  {
    symptoms: ['dehydration', 'warping'],
    label: 'Desiccation Syndrome',
    description: 'Warping caused by uneven drying and construct shrinkage',
    likelyCause: 'low_humidity',
    confidenceBoost: 0.2,
  },
  {
    symptoms: ['cell_death', 'crosslink_failure'],
    label: 'Crosslink Toxicity Syndrome',
    description: 'Cell death co-occurring with crosslink issues suggests over-crosslinking damage',
    likelyCause: 'excessive_crosslink',
    confidenceBoost: 0.15,
  },
  {
    symptoms: ['nozzle_clog', 'cell_death'],
    label: 'Thermal Gelation Syndrome',
    description: 'Clogging with cell death suggests bioink premature gelation or degradation',
    likelyCause: 'low_temperature',
    confidenceBoost: 0.1,
  },
  {
    symptoms: ['contamination', 'cell_death'],
    label: 'Sterility Failure Syndrome',
    description: 'Contamination causing secondary cell death',
    likelyCause: 'non_sterile',
    confidenceBoost: 0.2,
  },
];

// ── Pre-indexed rule lookup ──────────────────────────────────────
// Index DIAGNOSTIC_RULES by symptom at module load time so that
// diagnose() only iterates the rules relevant to the observed
// symptoms — O(matched) instead of O(all_rules) per call.

const RULES_BY_SYMPTOM = Object.freeze(
  DIAGNOSTIC_RULES.reduce((idx, rule) => {
    if (!idx[rule.symptom]) idx[rule.symptom] = [];
    idx[rule.symptom].push(rule);
    return idx;
  }, {})
);

// ── Main diagnostic engine ───────────────────────────────────────

function createFailureDiagnostic() {
  const history = [];

  /**
   * Validate symptoms input.
   */
  function validateSymptoms(symptoms) {
    if (!Array.isArray(symptoms) || symptoms.length === 0) {
      throw new Error('symptoms must be a non-empty array');
    }
    const invalid = symptoms.filter(s => !SYMPTOMS[s]);
    if (invalid.length > 0) {
      throw new Error('Unknown symptoms: ' + invalid.join(', '));
    }
  }

  /**
   * Diagnose failures from observed symptoms.
   * @param {string[]} symptoms - array of symptom IDs
   * @param {Object} [params] - print parameters for context-aware diagnosis
   * @param {string} [severity='moderate'] - observed severity level
   * @returns {Object} diagnosis result
   */
  function diagnose(symptoms, params, severity) {
    validateSymptoms(symptoms);
    const sev = severity && SEVERITY_WEIGHT[severity] ? severity : SEVERITY.MODERATE;
    const sevWeight = SEVERITY_WEIGHT[sev];

    // Collect matching rules using pre-indexed lookup.
    // Only rules for the observed symptoms are visited.
    const causeScores = {};
    for (const symptom of symptoms) {
      const rules = RULES_BY_SYMPTOM[symptom];
      if (!rules) continue;
      for (const rule of rules) {
        const paramBoost = typeof rule.paramCheck === 'function' ? rule.paramCheck(params || null) : 0;
        const rawConfidence = Math.min(1.0, rule.confidence + paramBoost);

        if (!causeScores[rule.cause]) {
          causeScores[rule.cause] = { totalConfidence: 0, matchedSymptoms: [], ruleCount: 0 };
        }
        causeScores[rule.cause].totalConfidence += rawConfidence;
        causeScores[rule.cause].matchedSymptoms.push(rule.symptom);
        causeScores[rule.cause].ruleCount += 1;
      }
    }

    // Apply co-occurrence boosts
    const matchedPatterns = [];
    for (const pattern of CO_OCCURRENCE_PATTERNS) {
      const allPresent = pattern.symptoms.every(s => symptoms.includes(s));
      if (allPresent) {
        matchedPatterns.push(pattern);
        if (causeScores[pattern.likelyCause]) {
          causeScores[pattern.likelyCause].totalConfidence += pattern.confidenceBoost;
        }
      }
    }

    // Normalize and rank causes
    const diagnoses = Object.entries(causeScores).map(([causeId, data]) => {
      // Normalize: average confidence across matched rules, capped at 1.0
      const avgConfidence = Math.min(1.0, data.totalConfidence / data.ruleCount);
      // Scale by severity
      const adjustedConfidence = Math.min(1.0, avgConfidence * (0.5 + sevWeight * 0.2));

      const causeInfo = ROOT_CAUSES[causeId] || { id: causeId, label: causeId, category: 'unknown', description: '' };
      const actions = (CORRECTIVE_ACTIONS[causeId] || []).map(a => ({ ...a }));

      return {
        cause: causeId,
        label: causeInfo.label,
        category: causeInfo.category,
        description: causeInfo.description,
        confidence: Math.round(adjustedConfidence * 1000) / 1000,
        matchedSymptoms: [...new Set(data.matchedSymptoms)],
        correctiveActions: actions.sort((a, b) => a.priority - b.priority),
      };
    }).sort((a, b) => b.confidence - a.confidence);

    const result = {
      timestamp: Date.now(),
      symptoms: symptoms.map(s => ({ id: s, ...SYMPTOMS[s] })),
      severity: sev,
      parameters: params || null,
      diagnoses,
      coOccurrencePatterns: matchedPatterns.map(p => ({
        label: p.label,
        description: p.description,
        symptoms: p.symptoms,
        likelyCause: p.likelyCause,
      })),
      primaryDiagnosis: diagnoses.length > 0 ? diagnoses[0] : null,
      overallRisk: calculateOverallRisk(diagnoses, sev),
    };

    history.push(result);
    return result;
  }

  /**
   * Calculate overall risk score (0-100).
   */
  function calculateOverallRisk(diagnoses, severity) {
    if (diagnoses.length === 0) return 0;
    const sevWeight = SEVERITY_WEIGHT[severity] || 1.5;
    // Weighted sum of top causes
    const topN = Math.min(3, diagnoses.length);
    let weightedSum = 0;
    for (let i = 0; i < topN; i++) {
      weightedSum += diagnoses[i].confidence * (1 - i * 0.2);
    }
    const normalized = (weightedSum / topN) * sevWeight;
    return Math.min(100, Math.round(normalized * 100));
  }

  /**
   * Get all symptom definitions.
   */
  function getSymptoms() {
    return Object.values(SYMPTOMS).map(s => ({ ...s }));
  }

  /**
   * Get symptom IDs grouped by category.
   */
  function getSymptomsByCategory() {
    const cats = {};
    for (const s of Object.values(SYMPTOMS)) {
      if (!cats[s.category]) cats[s.category] = [];
      cats[s.category].push(s.id);
    }
    return cats;
  }

  /**
   * List all root causes.
   */
  function getRootCauses() {
    return Object.values(ROOT_CAUSES).map(c => ({ ...c }));
  }

  /**
   * Batch diagnose multiple prints.
   * @param {Array<{symptoms: string[], params?: Object, severity?: string}>} prints
   * @returns {Object} batch diagnosis
   */
  function batchDiagnose(prints) {
    if (!Array.isArray(prints) || prints.length === 0) {
      throw new Error('prints must be a non-empty array');
    }

    const results = prints.map((p, i) => {
      try {
        return { index: i, result: diagnose(p.symptoms, p.params, p.severity), error: null };
      } catch (e) {
        return { index: i, result: null, error: e.message };
      }
    });

    // Aggregate most common causes across all prints
    const causeCounts = {};
    const symptomCounts = {};
    let totalRisk = 0;
    let validCount = 0;

    for (const r of results) {
      if (!r.result) continue;
      validCount++;
      totalRisk += r.result.overallRisk;
      for (const s of r.result.symptoms) {
        symptomCounts[s.id] = (symptomCounts[s.id] || 0) + 1;
      }
      for (const d of r.result.diagnoses) {
        causeCounts[d.cause] = (causeCounts[d.cause] || 0) + 1;
      }
    }

    const mostCommonCauses = Object.entries(causeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cause, count]) => ({
        cause,
        label: (ROOT_CAUSES[cause] || {}).label || cause,
        occurrences: count,
        percentage: Math.round((count / validCount) * 100),
      }));

    const mostCommonSymptoms = Object.entries(symptomCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([symptom, count]) => ({
        symptom,
        label: (SYMPTOMS[symptom] || {}).label || symptom,
        occurrences: count,
        percentage: Math.round((count / validCount) * 100),
      }));

    return {
      totalPrints: prints.length,
      successfulDiagnoses: validCount,
      failedDiagnoses: prints.length - validCount,
      averageRisk: validCount > 0 ? Math.round(totalRisk / validCount) : 0,
      mostCommonCauses,
      mostCommonSymptoms,
      results,
    };
  }

  /**
   * Get diagnostic history.
   */
  function getHistory() {
    return history.map(h => ({ ...h }));
  }

  /**
   * Clear diagnostic history.
   */
  function clearHistory() {
    history.length = 0;
  }

  /**
   * Get trending issues from history.
   * Returns causes that appear frequently in recent diagnoses.
   */
  function getTrends(windowSize) {
    const window = windowSize || 10;
    const recent = history.slice(-window);
    if (recent.length === 0) return { window: 0, trends: [] };

    const causeCounts = {};
    for (const r of recent) {
      for (const d of r.diagnoses) {
        if (!causeCounts[d.cause]) causeCounts[d.cause] = { count: 0, totalConfidence: 0 };
        causeCounts[d.cause].count += 1;
        causeCounts[d.cause].totalConfidence += d.confidence;
      }
    }

    const trends = Object.entries(causeCounts)
      .map(([cause, data]) => ({
        cause,
        label: (ROOT_CAUSES[cause] || {}).label || cause,
        frequency: data.count,
        percentage: Math.round((data.count / recent.length) * 100),
        avgConfidence: Math.round((data.totalConfidence / data.count) * 1000) / 1000,
      }))
      .sort((a, b) => b.frequency - a.frequency);

    return { window: recent.length, trends };
  }

  /**
   * Compare two diagnoses and highlight differences.
   */
  function compareDiagnoses(diag1, diag2) {
    if (!diag1 || !diag2) throw new Error('Both diagnoses are required');
    if (!diag1.diagnoses || !diag2.diagnoses) throw new Error('Invalid diagnosis objects');

    const causes1 = new Set(diag1.diagnoses.map(d => d.cause));
    const causes2 = new Set(diag2.diagnoses.map(d => d.cause));

    const shared = [...causes1].filter(c => causes2.has(c));
    const onlyIn1 = [...causes1].filter(c => !causes2.has(c));
    const onlyIn2 = [...causes2].filter(c => !causes1.has(c));

    const confidenceChanges = shared.map(cause => {
      const c1 = diag1.diagnoses.find(d => d.cause === cause).confidence;
      const c2 = diag2.diagnoses.find(d => d.cause === cause).confidence;
      return {
        cause,
        label: (ROOT_CAUSES[cause] || {}).label || cause,
        confidence1: c1,
        confidence2: c2,
        delta: Math.round((c2 - c1) * 1000) / 1000,
      };
    });

    return {
      sharedCauses: shared.length,
      uniqueToDiag1: onlyIn1.map(c => ({ cause: c, label: (ROOT_CAUSES[c] || {}).label || c })),
      uniqueToDiag2: onlyIn2.map(c => ({ cause: c, label: (ROOT_CAUSES[c] || {}).label || c })),
      confidenceChanges,
      riskDelta: diag2.overallRisk - diag1.overallRisk,
      severityChange: diag1.severity !== diag2.severity
        ? { from: diag1.severity, to: diag2.severity } : null,
    };
  }

  /**
   * Generate human-readable diagnostic report.
   */
  function generateReport(diagnosis) {
    if (!diagnosis || !diagnosis.diagnoses) throw new Error('Invalid diagnosis object');

    const lines = [];
    lines.push('╔══════════════════════════════════════════════════════╗');
    lines.push('║        PRINT FAILURE DIAGNOSTIC REPORT              ║');
    lines.push('╚══════════════════════════════════════════════════════╝');
    lines.push('');

    // Symptoms
    lines.push('── Observed Symptoms ──────────────────────────────────');
    for (const s of diagnosis.symptoms) {
      lines.push('  • ' + s.label + ' [' + s.category + ']');
    }
    lines.push('  Severity: ' + diagnosis.severity.toUpperCase());
    lines.push('  Overall Risk: ' + diagnosis.overallRisk + '/100');
    lines.push('');

    // Parameters if available
    if (diagnosis.parameters) {
      lines.push('── Print Parameters ──────────────────────────────────');
      const p = diagnosis.parameters;
      const paramEntries = Object.entries(p).filter(([, v]) => v !== null && v !== undefined);
      for (const [k, v] of paramEntries) {
        lines.push('  ' + k + ': ' + v);
      }
      lines.push('');
    }

    // Co-occurrence patterns
    if (diagnosis.coOccurrencePatterns.length > 0) {
      lines.push('── Co-Occurrence Patterns Detected ───────────────────');
      for (const pat of diagnosis.coOccurrencePatterns) {
        lines.push('  ⚠ ' + pat.label);
        lines.push('    ' + pat.description);
      }
      lines.push('');
    }

    // Diagnoses
    lines.push('── Root Cause Analysis ───────────────────────────────');
    if (diagnosis.diagnoses.length === 0) {
      lines.push('  No root causes identified.');
    } else {
      for (let i = 0; i < diagnosis.diagnoses.length; i++) {
        const d = diagnosis.diagnoses[i];
        const rank = i + 1;
        const bar = '█'.repeat(Math.round(d.confidence * 20)) +
                    '░'.repeat(20 - Math.round(d.confidence * 20));
        lines.push('  #' + rank + ' ' + d.label + ' [' + d.category + ']');
        lines.push('     Confidence: ' + bar + ' ' + Math.round(d.confidence * 100) + '%');
        lines.push('     Matched symptoms: ' + d.matchedSymptoms.join(', '));
        if (d.correctiveActions.length > 0) {
          lines.push('     Corrective Actions:');
          for (const a of d.correctiveActions) {
            lines.push('       ' + a.priority + '. ' + a.action);
          }
        }
        lines.push('');
      }
    }

    // Primary recommendation
    if (diagnosis.primaryDiagnosis) {
      lines.push('── Primary Recommendation ────────────────────────────');
      const primary = diagnosis.primaryDiagnosis;
      lines.push('  Most likely cause: ' + primary.label);
      if (primary.correctiveActions.length > 0) {
        lines.push('  First action: ' + primary.correctiveActions[0].action);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  return Object.freeze({
    diagnose,
    batchDiagnose,
    getSymptoms,
    getSymptomsByCategory,
    getRootCauses,
    getHistory,
    clearHistory,
    getTrends,
    compareDiagnoses,
    generateReport,
  });
}

// ── Exports ──────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createFailureDiagnostic,
    SYMPTOMS,
    SEVERITY,
    ROOT_CAUSES,
    CORRECTIVE_ACTIONS,
    CO_OCCURRENCE_PATTERNS,
    DIAGNOSTIC_RULES,
    RULES_BY_SYMPTOM,
  };
}
