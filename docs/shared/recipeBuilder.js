'use strict';

/**
 * BioBots Print Recipe Builder - Core Logic
 *
 * Searches bioprinting datasets for runs matching target outcomes
 * and recommends optimal parameter combinations.
 *
 * @module recipeBuilder
 */

/**
 * Filter and score runs against target parameters.
 *
 * @param {Object[]} data - Array of bioprint records.
 * @param {Object} targets - Target parameters.
 * @param {number} targets.minViability - Minimum live cell %.
 * @param {number} targets.maxDead - Maximum dead cell %.
 * @param {number} targets.minElasticity - Minimum elasticity.
 * @param {number} targets.maxLayerHeight - Maximum layer height (mm).
 * @param {string} [targets.crosslinking='any'] - 'any', 'yes', or 'no'.
 * @param {string} [targets.wellplate='any'] - 'any' or a number string.
 * @param {number} [targets.tolerance=0.10] - Tolerance multiplier (0=strict, 0.25=relaxed).
 * @returns {Object[]} Matched runs sorted by score descending: [{record, score}].
 */
function filterAndScore(data, targets) {
    var tgt = targets || {};
    var minV = tgt.minViability || 0;
    var maxD = tgt.maxDead !== undefined ? tgt.maxDead : 100;
    var minE = tgt.minElasticity || 0;
    var maxLH = tgt.maxLayerHeight || 2;
    var clFilter = tgt.crosslinking || 'any';
    var wpFilter = tgt.wellplate || 'any';
    var tol = tgt.tolerance !== undefined ? tgt.tolerance : 0.10;

    var matches = [];

    for (var i = 0; i < data.length; i++) {
        var r = data[i];
        if (!r || !r.print_data || !r.print_info) continue;
        var pd = r.print_data;
        var pi = r.print_info;
        if (!pi.crosslinking || !pi.pressure || !pi.resolution) continue;

        if (pd.livePercent < minV * (1 - tol)) continue;
        if (pd.deadPercent > maxD * (1 + tol)) continue;
        if (pd.elasticity < minE * (1 - tol)) continue;
        if (pi.resolution.layerHeight > maxLH * (1 + tol)) continue;

        if (clFilter === 'yes' && !pi.crosslinking.cl_enabled) continue;
        if (clFilter === 'no' && pi.crosslinking.cl_enabled) continue;

        if (wpFilter !== 'any' && pi.wellplate !== parseInt(wpFilter, 10)) continue;

        var vScore = pd.livePercent / 100;
        var eScore = pd.elasticity / 100;
        var dPenalty = pd.deadPercent / 100;
        var rScore = 1 - (pi.resolution.layerHeight / 2);
        var score = (vScore * 0.4) + (eScore * 0.25) + (rScore * 0.2) + ((1 - dPenalty) * 0.15);

        matches.push({ record: r, score: score });
    }

    matches.sort(function(a, b) { return b.score - a.score; });
    return matches;
}

/**
 * Compute optimal recipe parameters from top matching runs.
 *
 * @param {Object[]} matches - Array of {record, score} objects.
 * @returns {Object} Recipe with median, q1, q3, min, max, mean for each parameter.
 */
function computeRecipe(matches) {
    var fields = {
        pressure1: [], pressure2: [], clDuration: [], clIntensity: [],
        layerHeight: [], layerNum: [], viability: [], elasticity: [], deadPercent: []
    };

    for (var i = 0; i < matches.length; i++) {
        var r = matches[i].record;
        fields.pressure1.push(r.print_info.pressure.extruder1);
        fields.pressure2.push(r.print_info.pressure.extruder2);
        fields.clDuration.push(r.print_info.crosslinking.cl_duration);
        fields.clIntensity.push(r.print_info.crosslinking.cl_intensity);
        fields.layerHeight.push(r.print_info.resolution.layerHeight);
        fields.layerNum.push(r.print_info.resolution.layerNum);
        fields.viability.push(r.print_data.livePercent);
        fields.elasticity.push(r.print_data.elasticity);
        fields.deadPercent.push(r.print_data.deadPercent);
    }

    var recipe = {};
    var keys = Object.keys(fields);
    for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var sorted = fields[key].slice().sort(function(a, b) { return a - b; });
        var n = sorted.length;
        recipe[key] = {
            median: sorted[Math.floor(n / 2)],
            q1: sorted[Math.floor(n * 0.25)],
            q3: sorted[Math.floor(n * 0.75)],
            min: sorted[0],
            max: sorted[n - 1],
            mean: sorted.reduce(function(s, v) { return s + v; }, 0) / n,
            values: fields[key]
        };
    }

    return recipe;
}

/**
 * Format recipe as plain text for clipboard.
 *
 * @param {Object} recipe - Output of computeRecipe().
 * @param {number} matchCount - Number of matching runs.
 * @returns {string} Human-readable recipe text.
 */
function formatRecipeText(recipe, matchCount) {
    var labels = {
        pressure1: 'Extruder 1 Pressure', pressure2: 'Extruder 2 Pressure',
        layerHeight: 'Layer Height', layerNum: 'Layer Count',
        clIntensity: 'CL Intensity', clDuration: 'CL Duration',
        viability: 'Expected Viability', elasticity: 'Expected Elasticity',
        deadPercent: 'Expected Dead %'
    };

    var text = 'Bioprint Recipe\n';
    text += '==================\n';
    var keys = Object.keys(recipe);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var r = recipe[k];
        text += (labels[k] || k) + ': ' + r.median.toFixed(1) +
            ' (IQR: ' + r.q1.toFixed(1) + ' - ' + r.q3.toFixed(1) + ')\n';
    }
    text += '\nMatching runs: ' + matchCount;
    return text;
}

/**
 * Build histogram bins from an array of values.
 *
 * @param {number[]} values - Input values.
 * @param {number} numBins - Number of bins.
 * @returns {Object[]} Array of {lo, hi, count} bin objects.
 */
function buildHistogram(values, numBins) {
    if (values.length === 0) return [];
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    var lo = sorted[0];
    var hi = sorted[sorted.length - 1];
    var width = (hi - lo) / numBins || 1;

    var bins = [];
    for (var b = 0; b < numBins; b++) {
        bins.push({ lo: lo + b * width, hi: lo + (b + 1) * width, count: 0 });
    }
    for (var v = 0; v < values.length; v++) {
        var bi = Math.min(numBins - 1, Math.floor((values[v] - lo) / width));
        bins[bi].count++;
    }
    return bins;
}

// ── Presets ──

var PRESETS = {
    'high-viability': { minViability: 80, maxDead: 20, minElasticity: 40, maxLayerHeight: 1.0, crosslinking: 'any', tolerance: 0.10 },
    'fine-resolution': { minViability: 50, maxDead: 50, minElasticity: 30, maxLayerHeight: 0.3, crosslinking: 'any', tolerance: 0.25 },
    'balanced': { minViability: 60, maxDead: 40, minElasticity: 50, maxLayerHeight: 0.5, crosslinking: 'any', tolerance: 0.10 },
    'rapid-prototype': { minViability: 30, maxDead: 70, minElasticity: 20, maxLayerHeight: 1.5, crosslinking: 'no', tolerance: 0.25 },
    'high-elasticity': { minViability: 50, maxDead: 50, minElasticity: 70, maxLayerHeight: 1.0, crosslinking: 'any', tolerance: 0.10 }
};

// CommonJS export for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        filterAndScore: filterAndScore,
        computeRecipe: computeRecipe,
        formatRecipeText: formatRecipeText,
        buildHistogram: buildHistogram,
        PRESETS: PRESETS
    };
}
