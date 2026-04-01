'use strict';

/**
 * Western Blot Band Analyzer — quantify and interpret Western blot band
 * intensities from densitometry data.
 *
 * Typical workflow:
 *  1. Image analysis software (ImageJ, Bio-Rad Image Lab, etc.) exports
 *     band intensity values as numbers.
 *  2. Feed those values here for normalization, fold-change calculation,
 *     and statistical comparison across lanes.
 *
 * @example
 *   var wb = createWesternBlotAnalyzer();
 *
 *   // Normalize target bands to loading control (e.g., β-actin)
 *   wb.normalize({
 *     target:  [12000, 24000, 36000, 8000],
 *     control: [10000, 11000, 12000, 9500],
 *     lanes:   ['Ctrl', 'Drug 1x', 'Drug 2x', 'KO']
 *   });
 *   // => { normalized: [1.2, 2.1818, 3.0, 0.8421], ... }
 *
 *   // Fold change relative to lane 0
 *   wb.foldChange({
 *     target:  [12000, 24000, 36000, 8000],
 *     control: [10000, 11000, 12000, 9500],
 *     referenceLane: 0
 *   });
 *   // => { foldChanges: [1.0, 1.8182, 2.5, 0.7018] }
 */

// ── Helpers ────────────────────────────────────────────────────────

var round = require('./validation').round;

var _stats = require('./stats');
var mean = _stats.mean;
var stddev = _stats.stddev;

// ── Common molecular weight markers (kDa) ──────────────────────────
var MARKER_LADDERS = {
    'precision-plus': [10, 15, 20, 25, 37, 50, 75, 100, 150, 250],
    'spectra':        [10, 15, 25, 35, 40, 55, 70, 100, 130, 170, 250],
    'pageruler':      [10, 15, 25, 35, 40, 55, 70, 100, 130, 180, 250],
    'benchmark':      [6, 14, 17, 28, 38, 49, 62, 98, 188],
    'magic-mark':     [20, 30, 40, 50, 60, 80, 100, 120, 160, 220],
};

// ── Loading controls ───────────────────────────────────────────────
var LOADING_CONTROLS = {
    'beta-actin':  { name: 'β-Actin',   expectedKda: 42,  note: 'Ubiquitous cytoskeletal protein' },
    'gapdh':       { name: 'GAPDH',     expectedKda: 37,  note: 'Glycolytic enzyme, highly expressed' },
    'tubulin':     { name: 'β-Tubulin', expectedKda: 55,  note: 'Cytoskeletal component' },
    'histone-h3':  { name: 'Histone H3',expectedKda: 17,  note: 'Nuclear fraction control' },
    'vinculin':    { name: 'Vinculin',  expectedKda: 124, note: 'High-MW loading control' },
    'lamin-b1':    { name: 'Lamin B1',  expectedKda: 66,  note: 'Nuclear envelope control' },
    'total-protein':{ name: 'Total Protein (Ponceau/Stain-Free)', expectedKda: null, note: 'Whole-lane normalization' },
};

function createWesternBlotAnalyzer() {
    return {
        /**
         * Normalize target band intensities against a loading control.
         * Returns ratio = target[i] / control[i] for each lane.
         */
        normalize: function (opts) {
            var target = opts.target;
            var control = opts.control;
            if (!target || !control) throw new Error('Provide target and control intensity arrays.');
            if (target.length !== control.length) throw new Error('target and control arrays must be the same length.');
            var lanes = opts.lanes || target.map(function (_, i) { return 'Lane ' + (i + 1); });
            var normalized = [];
            for (var i = 0; i < target.length; i++) {
                if (control[i] === 0) throw new Error('Loading control intensity is 0 at lane ' + i + '; cannot normalize.');
                normalized.push(round(target[i] / control[i]));
            }
            return {
                normalized: normalized,
                lanes: lanes,
                mean: round(mean(normalized)),
                sd: normalized.length > 1 ? round(stddev(normalized)) : 0,
                method: 'target / loading-control per lane'
            };
        },

        /**
         * Calculate fold change relative to a reference lane (default: 0).
         * First normalizes to loading control, then divides by reference.
         */
        foldChange: function (opts) {
            var target = opts.target;
            var control = opts.control;
            var refLane = opts.referenceLane || 0;
            if (!target || !control) throw new Error('Provide target and control intensity arrays.');
            if (target.length !== control.length) throw new Error('Arrays must match in length.');

            var norm = [];
            for (var i = 0; i < target.length; i++) {
                if (control[i] === 0) throw new Error('Control is 0 at lane ' + i);
                norm.push(target[i] / control[i]);
            }
            var ref = norm[refLane];
            if (ref === 0) throw new Error('Reference lane normalized value is 0.');

            var fc = norm.map(function (v) { return round(v / ref); });
            var lanes = opts.lanes || target.map(function (_, i) { return 'Lane ' + (i + 1); });

            return {
                foldChanges: fc,
                referenceLane: refLane,
                referenceLabel: lanes[refLane],
                lanes: lanes,
                method: '(target/control) / reference_lane_ratio'
            };
        },

        /**
         * Compare two groups (e.g., control vs treatment) using a
         * two-sample t-test on normalized intensities.
         */
        compare: function (opts) {
            var groupA = opts.groupA; // { target: [...], control: [...], label: 'Control' }
            var groupB = opts.groupB; // { target: [...], control: [...], label: 'Treatment' }

            function normArr(g) {
                var n = [];
                for (var i = 0; i < g.target.length; i++) {
                    if (g.control[i] === 0) throw new Error('Control 0 in group ' + (g.label || '?'));
                    n.push(g.target[i] / g.control[i]);
                }
                return n;
            }
            var nA = normArr(groupA);
            var nB = normArr(groupB);

            var mA = mean(nA), mB = mean(nB);
            var sA = nA.length > 1 ? stddev(nA) : 0;
            var sB = nB.length > 1 ? stddev(nB) : 0;

            // Welch's t-test
            var se = Math.sqrt((sA * sA / nA.length) + (sB * sB / nB.length));
            var t = se > 0 ? (mA - mB) / se : 0;

            // Welch–Satterthwaite degrees of freedom
            var num = Math.pow((sA * sA / nA.length) + (sB * sB / nB.length), 2);
            var dA = nA.length - 1 || 1;
            var dB = nB.length - 1 || 1;
            var den = Math.pow(sA * sA / nA.length, 2) / dA +
                      Math.pow(sB * sB / nB.length, 2) / dB;
            var df = den > 0 ? num / den : 1;

            return {
                groupA: { label: groupA.label || 'A', mean: round(mA), sd: round(sA), n: nA.length, values: nA.map(function (v) { return round(v); }) },
                groupB: { label: groupB.label || 'B', mean: round(mB), sd: round(sB), n: nB.length, values: nB.map(function (v) { return round(v); }) },
                foldChange: round(mA !== 0 ? mB / mA : 0),
                tStatistic: round(t),
                degreesOfFreedom: round(df, 1),
                note: 'Use a t-distribution table or stats library for p-value from t and df.'
            };
        },

        /**
         * Estimate molecular weight from Rf (relative migration) using
         * a standard curve from marker bands.
         *
         * markerRfs: array of Rf values for each marker (0-1, top to bottom)
         * markerKdas: array of known kDa for each marker
         * sampleRfs: array of Rf values for unknown bands
         */
        estimateMW: function (opts) {
            var rfs = opts.markerRfs;
            var kdas = opts.markerKdas;
            var samples = opts.sampleRfs;
            if (!rfs || !kdas || rfs.length !== kdas.length) throw new Error('Provide matching markerRfs and markerKdas arrays.');
            if (!samples || samples.length === 0) throw new Error('Provide sampleRfs array.');

            // Linear regression on log10(kDa) vs Rf
            var logKdas = kdas.map(function (k) { return Math.log10(k); });
            var n = rfs.length;
            var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
            for (var i = 0; i < n; i++) {
                sumX += rfs[i]; sumY += logKdas[i];
                sumXY += rfs[i] * logKdas[i]; sumX2 += rfs[i] * rfs[i];
            }
            var slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
            var intercept = (sumY - slope * sumX) / n;

            // R²
            var meanY = sumY / n;
            var ssTot = 0, ssRes = 0;
            for (var j = 0; j < n; j++) {
                var predicted = slope * rfs[j] + intercept;
                ssTot += (logKdas[j] - meanY) * (logKdas[j] - meanY);
                ssRes += (logKdas[j] - predicted) * (logKdas[j] - predicted);
            }
            var r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

            var estimates = samples.map(function (rf) {
                var logMw = slope * rf + intercept;
                return { rf: rf, estimatedKda: round(Math.pow(10, logMw), 1) };
            });

            return {
                estimates: estimates,
                standardCurve: { slope: round(slope), intercept: round(intercept), r2: round(r2) },
                method: 'Linear regression of log10(kDa) vs Rf'
            };
        },

        /**
         * Check band saturation: flags any intensity above a threshold
         * (default 90% of max possible, e.g., 65535 for 16-bit images).
         */
        saturationCheck: function (opts) {
            var intensities = opts.intensities;
            var maxPossible = opts.maxIntensity || 65535; // 16-bit
            var threshold = opts.threshold || 0.9;
            var cutoff = maxPossible * threshold;
            var lanes = opts.lanes || intensities.map(function (_, i) { return 'Lane ' + (i + 1); });

            var results = [];
            var saturatedCount = 0;
            for (var i = 0; i < intensities.length; i++) {
                var pct = round(intensities[i] / maxPossible * 100, 1);
                var sat = intensities[i] >= cutoff;
                if (sat) saturatedCount++;
                results.push({
                    lane: lanes[i],
                    intensity: intensities[i],
                    percentOfMax: pct,
                    saturated: sat
                });
            }
            return {
                results: results,
                saturatedCount: saturatedCount,
                totalLanes: intensities.length,
                recommendation: saturatedCount > 0
                    ? 'WARNING: ' + saturatedCount + ' lane(s) may be saturated. Consider shorter exposure or less protein loading.'
                    : 'All bands within linear range.'
            };
        },

        /**
         * Generate a summary report for a complete blot.
         */
        report: function (opts) {
            var targetName = opts.targetProtein || 'Target';
            var controlName = opts.loadingControl || 'Loading Control';
            var target = opts.target;
            var control = opts.control;
            var lanes = opts.lanes || target.map(function (_, i) { return 'Lane ' + (i + 1); });
            var refLane = opts.referenceLane || 0;

            // Normalize
            var norm = [];
            for (var i = 0; i < target.length; i++) {
                norm.push(control[i] !== 0 ? target[i] / control[i] : 0);
            }
            var ref = norm[refLane];
            var fc = norm.map(function (v) { return ref !== 0 ? round(v / ref) : 0; });

            var rows = [];
            for (var j = 0; j < lanes.length; j++) {
                rows.push({
                    lane: lanes[j],
                    targetIntensity: target[j],
                    controlIntensity: control[j],
                    normalized: round(norm[j]),
                    foldChange: fc[j],
                    isReference: j === refLane
                });
            }

            return {
                targetProtein: targetName,
                loadingControl: controlName,
                referenceLane: lanes[refLane],
                lanes: rows,
                summary: {
                    mean: round(mean(norm)),
                    sd: norm.length > 1 ? round(stddev(norm)) : 0,
                    maxFoldChange: Math.max.apply(null, fc),
                    minFoldChange: Math.min.apply(null, fc)
                }
            };
        },

        /** List available marker ladders.
         * Uses per-key array.slice() instead of JSON round-trip since
         * each ladder is a simple number array (no nested objects).
         */
        listLadders: function () {
            var result = {};
            var keys = Object.keys(MARKER_LADDERS);
            for (var i = 0; i < keys.length; i++) {
                result[keys[i]] = MARKER_LADDERS[keys[i]].slice();
            }
            return result;
        },

        /** List common loading controls. */
        listLoadingControls: function () {
            var result = [];
            var keys = Object.keys(LOADING_CONTROLS).sort();
            for (var i = 0; i < keys.length; i++) {
                var c = LOADING_CONTROLS[keys[i]];
                result.push({ key: keys[i], name: c.name, expectedKda: c.expectedKda, note: c.note });
            }
            return result;
        }
    };
}

exports.createWesternBlotAnalyzer = createWesternBlotAnalyzer;
