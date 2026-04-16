'use strict';

const { clamp } = require('./scriptUtils');

/**
 * ML-Based Pattern Recognition for Print Failure Diagnostics
 *
 * Extends the rule-based failure diagnostic system with data-driven
 * pattern recognition capabilities:
 *
 * 1. **Historical Pattern Learning** — Clusters past diagnoses to
 *    discover symptom-cause correlations not captured by the rule base.
 * 2. **Confidence Calibration** — Uses outcome feedback (did the fix work?)
 *    to calibrate rule confidence scores over time.
 * 3. **Anomaly Detection** — Flags symptom combinations that don't match
 *    any known pattern as potential novel failure modes.
 *
 * All methods are pure/stateful-in-memory and require no external ML
 * libraries — implemented with lightweight statistical techniques
 * suitable for the domain (k-means clustering, Bayesian updating,
 * Mahalanobis-style distance).
 *
 * Usage:
 *   const ml = createMLDiagnostic();
 *   ml.recordOutcome(diagnosisResult, 'high_pressure', true);
 *   const calibrated = ml.getCalibratedConfidence('nozzle_clog', 'high_pressure');
 *   const anomalies = ml.detectAnomalies(['cell_death', 'warping', 'stringing']);
 *   const clusters = ml.clusterDiagnoses();
 */

// ── Vector helpers ────────────────────────────────────────────────

/**
 * Build a binary symptom vector from an array of symptom IDs.
 * @param {string[]} symptoms
 * @param {string[]} allSymptomIds - ordered list of all possible symptom IDs
 * @returns {number[]}
 */
function symptomVector(symptoms, allSymptomIds) {
  return allSymptomIds.map(id => (symptoms.includes(id) ? 1 : 0));
}

/**
 * Euclidean distance between two vectors.
 */
function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

/**
 * Element-wise mean of a list of vectors.
 */
function vectorMean(vectors) {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const mean = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) mean[i] += v[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= vectors.length;
  return mean;
}

// ── Main ML Diagnostic Engine ─────────────────────────────────────

function createMLDiagnostic(options) {
  const opts = options || {};

  // All known symptom IDs (canonical order for vectorization)
  const ALL_SYMPTOMS = opts.symptomIds || [
    'nozzle_clog', 'under_extrusion', 'over_extrusion',
    'poor_adhesion', 'structural_collapse', 'warping',
    'stringing', 'cell_death', 'poor_resolution',
    'dehydration', 'contamination', 'crosslink_failure',
  ];

  // ── Internal state ──────────────────────────────────────────────

  // Outcome records: { symptoms: string[], cause: string, fixed: boolean, params?: object }
  const outcomes = [];

  // Per symptom-cause pair: { successes: number, failures: number }
  // Used for Bayesian confidence calibration
  const pairStats = {};

  // Stored diagnosis vectors for clustering
  const diagnosisVectors = [];

  // Known pattern library (populated by clustering)
  let knownPatterns = [];

  // ── Outcome Recording ──────────────────────────────────────────

  /**
   * Record whether a diagnosed root cause was correct (the fix worked).
   *
   * @param {Object} diagnosisResult - result from createFailureDiagnostic().diagnose()
   * @param {string} appliedCause - the root cause that was acted upon
   * @param {boolean} fixWorked - did applying the corrective action fix the issue?
   * @param {Object} [metadata] - optional additional context
   */
  function recordOutcome(diagnosisResult, appliedCause, fixWorked, metadata) {
    if (!diagnosisResult || !diagnosisResult.symptoms) {
      throw new Error('Invalid diagnosis result');
    }
    if (typeof appliedCause !== 'string' || !appliedCause) {
      throw new Error('appliedCause must be a non-empty string');
    }
    if (typeof fixWorked !== 'boolean') {
      throw new Error('fixWorked must be a boolean');
    }

    const symptomIds = diagnosisResult.symptoms.map(s => s.id || s);
    const vec = symptomVector(symptomIds, ALL_SYMPTOMS);

    const record = {
      timestamp: Date.now(),
      symptoms: symptomIds,
      vector: vec,
      cause: appliedCause,
      fixWorked,
      severity: diagnosisResult.severity || 'moderate',
      params: diagnosisResult.parameters || null,
      metadata: metadata || null,
    };

    outcomes.push(record);
    diagnosisVectors.push({ vector: vec, cause: appliedCause, symptoms: symptomIds });

    // Update pair stats
    const pairKey = symptomIds.sort().join('|') + '→' + appliedCause;
    if (!pairStats[pairKey]) {
      pairStats[pairKey] = { successes: 0, failures: 0, symptoms: symptomIds, cause: appliedCause };
    }
    if (fixWorked) {
      pairStats[pairKey].successes++;
    } else {
      pairStats[pairKey].failures++;
    }

    // Also track per individual symptom-cause pair (skip if same as combo key)
    for (const symptom of symptomIds) {
      const singleKey = symptom + '→' + appliedCause;
      if (singleKey === pairKey) continue; // already tracked above
      if (!pairStats[singleKey]) {
        pairStats[singleKey] = { successes: 0, failures: 0, symptoms: [symptom], cause: appliedCause };
      }
      if (fixWorked) {
        pairStats[singleKey].successes++;
      } else {
        pairStats[singleKey].failures++;
      }
    }
  }

  // ── Confidence Calibration ─────────────────────────────────────

  /**
   * Get calibrated confidence for a symptom→cause mapping using
   * Bayesian updating based on recorded outcomes.
   *
   * Uses a Beta distribution prior (uniform: α=1, β=1) updated with
   * success/failure counts. Returns the posterior mean.
   *
   * @param {string} symptom - symptom ID
   * @param {string} cause - root cause ID
   * @param {number} [priorConfidence] - the rule-based confidence as prior
   * @returns {Object} { calibrated, prior, posterior, sampleSize, successRate }
   */
  function getCalibratedConfidence(symptom, cause, priorConfidence) {
    const key = symptom + '→' + cause;
    const stats = pairStats[key];
    const prior = typeof priorConfidence === 'number' ? priorConfidence : 0.5;

    if (!stats || (stats.successes + stats.failures) === 0) {
      return {
        calibrated: prior,
        prior,
        posterior: prior,
        sampleSize: 0,
        successRate: null,
      };
    }

    const n = stats.successes + stats.failures;
    const successRate = stats.successes / n;

    // Beta posterior: α = prior_α + successes, β = prior_β + failures
    // Use prior confidence to set initial α, β (method of moments)
    const priorStrength = 2; // equivalent sample size of prior
    const alpha0 = prior * priorStrength;
    const beta0 = (1 - prior) * priorStrength;

    const alphaPost = alpha0 + stats.successes;
    const betaPost = beta0 + stats.failures;
    const posterior = alphaPost / (alphaPost + betaPost);

    return {
      calibrated: Math.round(posterior * 1000) / 1000,
      prior,
      posterior: Math.round(posterior * 1000) / 1000,
      sampleSize: n,
      successRate: Math.round(successRate * 1000) / 1000,
    };
  }

  /**
   * Get all calibrated confidences for a given symptom.
   * @param {string} symptom
   * @returns {Object[]} array of { cause, calibrated, sampleSize, successRate }
   */
  function getAllCalibrationsForSymptom(symptom) {
    const results = [];
    for (const [key, stats] of Object.entries(pairStats)) {
      if (!key.startsWith(symptom + '→')) continue;
      const cause = key.split('→')[1];
      const cal = getCalibratedConfidence(symptom, cause);
      results.push({ cause, ...cal });
    }
    return results.sort((a, b) => b.calibrated - a.calibrated);
  }

  // ── Anomaly Detection ──────────────────────────────────────────

  /**
   * Detect whether a symptom combination is anomalous — i.e., doesn't
   * match any previously seen pattern or known co-occurrence.
   *
   * Uses cosine similarity against all recorded diagnosis vectors.
   * If the best match is below the threshold, it's flagged as anomalous.
   *
   * @param {string[]} symptoms - observed symptom IDs
   * @param {Object} [opts] - { threshold: number (default 0.5) }
   * @returns {Object} { isAnomaly, confidence, nearestMatch, similarity, details }
   */
  function detectAnomalies(symptoms, detectionOpts) {
    if (!Array.isArray(symptoms) || symptoms.length === 0) {
      throw new Error('symptoms must be a non-empty array');
    }

    const threshold = (detectionOpts && detectionOpts.threshold) || 0.5;
    const vec = symptomVector(symptoms, ALL_SYMPTOMS);

    // If no history, everything is anomalous
    if (diagnosisVectors.length === 0) {
      return {
        isAnomaly: true,
        confidence: 1.0,
        nearestMatch: null,
        similarity: 0,
        details: 'No historical data available for comparison',
      };
    }

    // Find closest match
    let bestSim = -1;
    let bestMatch = null;
    for (const entry of diagnosisVectors) {
      const sim = cosineSimilarity(vec, entry.vector);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = entry;
      }
    }

    const isAnomaly = bestSim < threshold;
    // Anomaly confidence: how far below threshold
    const anomalyConfidence = isAnomaly
      ? Math.min(1.0, Math.round((1 - bestSim / threshold) * 1000) / 1000)
      : 0;

    return {
      isAnomaly,
      confidence: anomalyConfidence,
      nearestMatch: bestMatch ? {
        symptoms: bestMatch.symptoms,
        cause: bestMatch.cause,
      } : null,
      similarity: Math.round(bestSim * 1000) / 1000,
      details: isAnomaly
        ? 'Symptom combination does not match any known pattern (similarity ' +
          Math.round(bestSim * 100) + '% < threshold ' + Math.round(threshold * 100) + '%)'
        : 'Matches known pattern with ' + Math.round(bestSim * 100) + '% similarity',
    };
  }

  // ── Clustering (Historical Pattern Learning) ────────────────────

  /**
   * Cluster recorded diagnoses using k-means to discover symptom-cause
   * patterns not captured by the rule base.
   *
   * @param {Object} [clusterOpts] - { k: number (default auto), maxIterations: number }
   * @returns {Object} { clusters: Array<{ centroid, members, dominantCause, symptoms }>, k }
   */
  function clusterDiagnoses(clusterOpts) {
    if (diagnosisVectors.length < 3) {
      return { clusters: [], k: 0, message: 'Need at least 3 recorded diagnoses to cluster' };
    }

    const cOpts = clusterOpts || {};
    // Auto-select k: sqrt(n/2), bounded 2..8
    const autoK = clamp(Math.round(Math.sqrt(diagnosisVectors.length / 2)), 2, 8);
    const k = cOpts.k || autoK;
    const maxIter = cOpts.maxIterations || 50;

    const vectors = diagnosisVectors.map(d => d.vector);

    // Initialize centroids via k-means++ style (deterministic spread)
    const centroids = [];
    centroids.push(vectors[0].slice());

    for (let c = 1; c < k; c++) {
      // Pick the vector farthest from nearest existing centroid
      let bestIdx = 0, bestDist = -1;
      for (let i = 0; i < vectors.length; i++) {
        let minDist = Infinity;
        for (const cent of centroids) {
          const d = euclidean(vectors[i], cent);
          if (d < minDist) minDist = d;
        }
        if (minDist > bestDist) {
          bestDist = minDist;
          bestIdx = i;
        }
      }
      centroids.push(vectors[bestIdx].slice());
    }

    // k-means iterations
    let assignments = new Array(vectors.length).fill(0);

    for (let iter = 0; iter < maxIter; iter++) {
      // Assign each vector to nearest centroid
      const newAssignments = vectors.map(v => {
        let minDist = Infinity, minIdx = 0;
        for (let c = 0; c < k; c++) {
          const d = euclidean(v, centroids[c]);
          if (d < minDist) { minDist = d; minIdx = c; }
        }
        return minIdx;
      });

      // Check convergence
      let changed = false;
      for (let i = 0; i < assignments.length; i++) {
        if (assignments[i] !== newAssignments[i]) { changed = true; break; }
      }
      assignments = newAssignments;

      if (!changed) break;

      // Update centroids
      for (let c = 0; c < k; c++) {
        const members = vectors.filter((_, i) => assignments[i] === c);
        if (members.length > 0) {
          const mean = vectorMean(members);
          for (let d = 0; d < centroids[c].length; d++) {
            centroids[c][d] = mean[d];
          }
        }
      }
    }

    // Build cluster summaries
    const clusters = [];
    for (let c = 0; c < k; c++) {
      const memberIndices = assignments
        .map((a, i) => a === c ? i : -1)
        .filter(i => i >= 0);

      if (memberIndices.length === 0) continue;

      const members = memberIndices.map(i => diagnosisVectors[i]);

      // Dominant cause
      const causeCounts = {};
      for (const m of members) {
        causeCounts[m.cause] = (causeCounts[m.cause] || 0) + 1;
      }
      const dominantCause = Object.entries(causeCounts)
        .sort((a, b) => b[1] - a[1])[0];

      // Common symptoms (appear in >50% of members)
      const symptomFreq = {};
      for (const m of members) {
        for (const s of m.symptoms) {
          symptomFreq[s] = (symptomFreq[s] || 0) + 1;
        }
      }
      const commonSymptoms = Object.entries(symptomFreq)
        .filter(([, count]) => count / members.length > 0.5)
        .sort((a, b) => b[1] - a[1])
        .map(([s, count]) => ({
          symptom: s,
          frequency: Math.round((count / members.length) * 100),
        }));

      clusters.push({
        id: c,
        size: members.length,
        centroid: centroids[c].map(v => Math.round(v * 1000) / 1000),
        dominantCause: dominantCause ? {
          cause: dominantCause[0],
          percentage: Math.round((dominantCause[1] / members.length) * 100),
        } : null,
        commonSymptoms,
      });
    }

    knownPatterns = clusters;

    return { clusters, k };
  }

  /**
   * Suggest potential new diagnostic rules based on clustering results.
   * Identifies symptom-cause correlations found in clusters but not in
   * the standard rule base.
   *
   * @param {Object[]} existingRules - DIAGNOSTIC_RULES array from failureDiagnostic
   * @returns {Object[]} suggested new rules
   */
  function suggestNewRules(existingRules) {
    if (!Array.isArray(existingRules)) {
      throw new Error('existingRules must be an array');
    }
    if (knownPatterns.length === 0) {
      return { suggestions: [], message: 'Run clusterDiagnoses() first' };
    }

    // Build set of existing symptom→cause pairs
    const existingPairs = new Set(
      existingRules.map(r => r.symptom + '→' + r.cause)
    );

    const suggestions = [];

    for (const cluster of knownPatterns) {
      if (!cluster.dominantCause || cluster.size < 2) continue;

      for (const sym of cluster.commonSymptoms) {
        const pairKey = sym.symptom + '→' + cluster.dominantCause.cause;
        if (!existingPairs.has(pairKey) && sym.frequency >= 60) {
          // This symptom-cause relationship was discovered by clustering
          // but isn't in the rule base
          const cal = getCalibratedConfidence(sym.symptom, cluster.dominantCause.cause);

          suggestions.push({
            symptom: sym.symptom,
            cause: cluster.dominantCause.cause,
            suggestedConfidence: Math.round(sym.frequency / 100 * 0.8 * 1000) / 1000,
            evidence: {
              clusterSize: cluster.size,
              symptomFrequency: sym.frequency,
              causePercentage: cluster.dominantCause.percentage,
              calibratedConfidence: cal.calibrated,
              sampleSize: cal.sampleSize,
            },
          });
        }
      }
    }

    return {
      suggestions: suggestions.sort((a, b) => b.suggestedConfidence - a.suggestedConfidence),
    };
  }

  // ── Enhanced Diagnosis ──────────────────────────────────────────

  /**
   * Enhance a rule-based diagnosis with ML-derived insights.
   * Runs anomaly detection, calibrates confidences, and adds cluster context.
   *
   * @param {Object} diagnosisResult - from createFailureDiagnostic().diagnose()
   * @returns {Object} enhanced diagnosis with ml section
   */
  function enhance(diagnosisResult) {
    if (!diagnosisResult || !diagnosisResult.symptoms) {
      throw new Error('Invalid diagnosis result');
    }

    const symptomIds = diagnosisResult.symptoms.map(s => s.id || s);

    // Anomaly check
    const anomaly = detectAnomalies(symptomIds);

    // Calibrate each diagnosis confidence
    const calibratedDiagnoses = diagnosisResult.diagnoses.map(d => {
      const calibrations = d.matchedSymptoms.map(s =>
        getCalibratedConfidence(s, d.cause, d.confidence)
      );
      const avgCalibrated = calibrations.length > 0
        ? calibrations.reduce((sum, c) => sum + c.calibrated, 0) / calibrations.length
        : d.confidence;
      const totalSamples = calibrations.reduce((sum, c) => sum + c.sampleSize, 0);

      return {
        ...d,
        originalConfidence: d.confidence,
        calibratedConfidence: Math.round(avgCalibrated * 1000) / 1000,
        calibrationSamples: totalSamples,
        calibrationDelta: Math.round((avgCalibrated - d.confidence) * 1000) / 1000,
      };
    });

    // Re-sort by calibrated confidence
    calibratedDiagnoses.sort((a, b) => b.calibratedConfidence - a.calibratedConfidence);

    return {
      ...diagnosisResult,
      diagnoses: calibratedDiagnoses,
      primaryDiagnosis: calibratedDiagnoses.length > 0 ? calibratedDiagnoses[0] : null,
      ml: {
        anomaly,
        outcomeCount: outcomes.length,
        clusterCount: knownPatterns.length,
        calibrationApplied: outcomes.length > 0,
      },
    };
  }

  // ── State Management ────────────────────────────────────────────

  /**
   * Export internal state for persistence.
   */
  function exportState() {
    return {
      outcomes: outcomes.map(o => ({ ...o })),
      pairStats: JSON.parse(JSON.stringify(pairStats)),
      diagnosisVectors: diagnosisVectors.map(d => ({ ...d })),
      knownPatterns: knownPatterns.map(p => ({ ...p })),
    };
  }

  /**
   * Import previously exported state.
   */
  function importState(state) {
    if (!state) throw new Error('State object required');

    outcomes.length = 0;
    diagnosisVectors.length = 0;
    knownPatterns = [];

    // Clear pairStats
    for (const key of Object.keys(pairStats)) {
      delete pairStats[key];
    }

    if (Array.isArray(state.outcomes)) {
      for (const o of state.outcomes) outcomes.push(o);
    }
    if (state.pairStats) {
      Object.assign(pairStats, state.pairStats);
    }
    if (Array.isArray(state.diagnosisVectors)) {
      for (const d of state.diagnosisVectors) diagnosisVectors.push(d);
    }
    if (Array.isArray(state.knownPatterns)) {
      knownPatterns = state.knownPatterns;
    }
  }

  /**
   * Get summary statistics.
   */
  function getStats() {
    const totalOutcomes = outcomes.length;
    const successfulFixes = outcomes.filter(o => o.fixWorked).length;

    return {
      totalOutcomes,
      successfulFixes,
      failedFixes: totalOutcomes - successfulFixes,
      overallSuccessRate: totalOutcomes > 0
        ? Math.round((successfulFixes / totalOutcomes) * 1000) / 1000
        : null,
      uniqueSymptomCausePairs: Object.keys(pairStats).length,
      clusterCount: knownPatterns.length,
      diagnosisVectorCount: diagnosisVectors.length,
    };
  }

  /**
   * Reset all ML state.
   */
  function reset() {
    outcomes.length = 0;
    diagnosisVectors.length = 0;
    knownPatterns = [];
    for (const key of Object.keys(pairStats)) {
      delete pairStats[key];
    }
  }

  return Object.freeze({
    recordOutcome,
    getCalibratedConfidence,
    getAllCalibrationsForSymptom,
    detectAnomalies,
    clusterDiagnoses,
    suggestNewRules,
    enhance,
    exportState,
    importState,
    getStats,
    reset,
  });
}

// ── Exports ──────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createMLDiagnostic };
}
