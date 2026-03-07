'use strict';

const { mean, stddev, round } = require('./scriptUtils');

/**
 * Print Run Comparator — compare multiple bioprint runs side-by-side.
 *
 * Extracts all numeric parameters from each run, computes deltas and
 * rankings so users can see which parameter changes drove outcome differences.
 *
 * Usage:
 *   const { createComparator } = require('./printComparator');
 *   const comp = createComparator(allRuns);     // allRuns = bioprint-data.json array
 *   const result = comp.compare([0, 3, 7]);     // compare runs by index
 *   const best = comp.rankBy('livePercent', 'desc'); // rank all runs by metric
 *   const corr = comp.correlate('livePercent');  // correlations with outcome
 */

/**
 * Flatten a nested print-run object into { key: numericValue } pairs.
 * Keys use dot notation (e.g. "print_data.elasticity").
 * @param {object} obj - Nested object.
 * @param {string} [prefix] - Key prefix for recursion.
 * @returns {object} Flat map of numeric fields.
 */
function flattenNumeric(obj, prefix) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'number' && isFinite(v)) {
      out[key] = v;
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      Object.assign(out, flattenNumeric(v, key));
    }
  }
  return out;
}

/**
 * Pearson correlation coefficient between two equal-length arrays.
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {number} r in [-1, 1], or 0 if degenerate.
 */
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

/**
 * Create a comparator bound to a dataset.
 * @param {object[]} runs - Array of print run objects (bioprint-data.json format).
 * @returns {object} Comparator with compare(), rankBy(), correlate(), summary().
 */
function createComparator(runs) {
  if (!Array.isArray(runs) || runs.length === 0) {
    throw new Error('runs must be a non-empty array');
  }

  // Pre-flatten all runs
  const flat = runs.map((r, i) => ({ index: i, fields: flattenNumeric(r) }));

  // Collect all known numeric field names
  const allKeys = [...new Set(flat.flatMap(f => Object.keys(f.fields)))].sort();

  /**
   * Compare specific runs side-by-side.
   * @param {number[]} indices - Run indices to compare (2-10).
   * @returns {object} { runs: [...], deltas: {...}, fields: [...] }
   */
  function compare(indices) {
    if (!Array.isArray(indices) || indices.length < 2) {
      throw new Error('Provide at least 2 run indices to compare');
    }
    if (indices.length > 10) {
      throw new Error('Compare at most 10 runs at a time');
    }
    for (const i of indices) {
      if (i < 0 || i >= runs.length) {
        throw new Error(`Run index ${i} out of range (0-${runs.length - 1})`);
      }
    }

    const selected = indices.map(i => flat[i]);
    // Fields present in at least one selected run
    const fields = [...new Set(selected.flatMap(s => Object.keys(s.fields)))].sort();

    const runData = selected.map(s => {
      const row = { index: s.index };
      for (const f of fields) {
        row[f] = s.fields[f] !== undefined ? round(s.fields[f], 4) : null;
      }
      return row;
    });

    // Deltas: for each field, compute range (max - min) among selected runs
    const deltas = {};
    for (const f of fields) {
      const vals = selected.map(s => s.fields[f]).filter(v => v !== undefined);
      if (vals.length >= 2) {
        deltas[f] = {
          min: round(Math.min(...vals), 4),
          max: round(Math.max(...vals), 4),
          range: round(Math.max(...vals) - Math.min(...vals), 4),
          mean: round(mean(vals), 4),
          stddev: round(stddev(vals), 4)
        };
      }
    }

    return { runs: runData, deltas, fields };
  }

  /**
   * Rank all runs by a specific metric.
   * @param {string} field - Dot-notation field name.
   * @param {'asc'|'desc'} [order='desc'] - Sort order.
   * @param {number} [limit=10] - Max results.
   * @returns {object[]} Ranked entries [{ rank, index, value }].
   */
  function rankBy(field, order, limit) {
    order = order || 'desc';
    limit = limit || 10;
    if (!allKeys.includes(field)) {
      throw new Error(`Unknown field "${field}". Available: ${allKeys.slice(0, 10).join(', ')}...`);
    }

    const entries = flat
      .filter(f => f.fields[field] !== undefined)
      .map(f => ({ index: f.index, value: round(f.fields[field], 4) }));

    entries.sort((a, b) => order === 'desc' ? b.value - a.value : a.value - b.value);

    return entries.slice(0, limit).map((e, i) => ({ rank: i + 1, ...e }));
  }

  /**
   * Find which parameters correlate most with a target metric.
   * @param {string} target - Target field (e.g. "print_data.livePercent").
   * @param {number} [limit=10] - Number of top correlations.
   * @returns {object[]} [{ field, correlation, absCorrelation }] sorted by |r|.
   */
  function correlate(target, limit) {
    limit = limit || 10;
    if (!allKeys.includes(target)) {
      throw new Error(`Unknown field "${target}". Available: ${allKeys.slice(0, 10).join(', ')}...`);
    }

    const targetVals = flat.map(f => f.fields[target]);
    const results = [];

    for (const field of allKeys) {
      if (field === target) continue;
      const pairs = [];
      for (let i = 0; i < flat.length; i++) {
        if (targetVals[i] !== undefined && flat[i].fields[field] !== undefined) {
          pairs.push({ x: flat[i].fields[field], y: targetVals[i] });
        }
      }
      if (pairs.length < 5) continue; // need enough data points
      const r = pearson(pairs.map(p => p.x), pairs.map(p => p.y));
      results.push({
        field,
        correlation: round(r, 4),
        absCorrelation: round(Math.abs(r), 4)
      });
    }

    results.sort((a, b) => b.absCorrelation - a.absCorrelation);
    return results.slice(0, limit);
  }

  /**
   * Summary statistics for every numeric field across all runs.
   * @returns {object} { fieldName: { count, mean, stddev, min, max } }
   */
  function summary() {
    const out = {};
    for (const field of allKeys) {
      const vals = flat.map(f => f.fields[field]).filter(v => v !== undefined);
      if (vals.length === 0) continue;
      out[field] = {
        count: vals.length,
        mean: round(mean(vals), 4),
        stddev: round(stddev(vals), 4),
        min: round(Math.min(...vals), 4),
        max: round(Math.max(...vals), 4)
      };
    }
    return out;
  }

  return {
    compare,
    rankBy,
    correlate,
    summary,
    fields: allKeys,
    runCount: runs.length
  };
}

module.exports = { createComparator, flattenNumeric, pearson };
