'use strict';

/**
 * Flow Cytometry Data Analyzer for BioBots bioprinting & cell biology workflows.
 *
 * Provides:
 *   - Gating strategy calculations (FSC/SSC thresholds)
 *   - Cell population statistics (mean, median, CV, percentiles)
 *   - Viability analysis from live/dead staining data
 *   - Compensation matrix calculations for multi-color panels
 *   - Quadrant analysis for dual-marker experiments
 *   - Histogram binning and distribution analysis
 *   - Panel design validation (fluorochrome compatibility)
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var fc = biobots.createFlowCytometryAnalyzer();
 *   var result = fc.analyzePopulation({ events: [100,200,150,...], channel: 'FITC' });
 */

function createFlowCytometryAnalyzer() {

    /* ── Common fluorochrome database ── */
    var FLUOROCHROMES = {
        'FITC':      { excitation: 488, emission: 519, color: 'green',    laser: 'Blue 488nm' },
        'PE':        { excitation: 565, emission: 578, color: 'yellow',   laser: 'Blue 488nm' },
        'PE-Cy5':    { excitation: 565, emission: 667, color: 'red',      laser: 'Blue 488nm' },
        'PE-Cy7':    { excitation: 565, emission: 785, color: 'near-IR',  laser: 'Blue 488nm' },
        'PerCP':     { excitation: 482, emission: 678, color: 'red',      laser: 'Blue 488nm' },
        'PerCP-Cy5.5':{ excitation: 482, emission: 695, color: 'red',     laser: 'Blue 488nm' },
        'APC':       { excitation: 650, emission: 660, color: 'red',      laser: 'Red 633nm' },
        'APC-Cy7':   { excitation: 650, emission: 785, color: 'near-IR',  laser: 'Red 633nm' },
        'BV421':     { excitation: 405, emission: 421, color: 'violet',   laser: 'Violet 405nm' },
        'BV510':     { excitation: 405, emission: 510, color: 'cyan',     laser: 'Violet 405nm' },
        'BV605':     { excitation: 405, emission: 605, color: 'orange',   laser: 'Violet 405nm' },
        'BV711':     { excitation: 405, emission: 711, color: 'red',      laser: 'Violet 405nm' },
        'BV786':     { excitation: 405, emission: 786, color: 'near-IR',  laser: 'Violet 405nm' },
        'Pacific Blue':{ excitation: 401, emission: 452, color: 'blue',   laser: 'Violet 405nm' },
        'Alexa Fluor 488':{ excitation: 495, emission: 519, color: 'green', laser: 'Blue 488nm' },
        'Alexa Fluor 647':{ excitation: 650, emission: 668, color: 'red',   laser: 'Red 633nm' },
        'PI':        { excitation: 535, emission: 617, color: 'red',      laser: 'Blue 488nm' },
        '7-AAD':     { excitation: 546, emission: 647, color: 'red',      laser: 'Blue 488nm' },
        'DAPI':      { excitation: 360, emission: 460, color: 'blue',     laser: 'UV 355nm' },
    };

    /* ── Common cell markers ── */
    var COMMON_PANELS = {
        'T-cell-basic': {
            name: 'Basic T-Cell Panel',
            markers: [
                { marker: 'CD3',  fluorochrome: 'FITC',  purpose: 'T-cell lineage' },
                { marker: 'CD4',  fluorochrome: 'PE',    purpose: 'Helper T-cells' },
                { marker: 'CD8',  fluorochrome: 'APC',   purpose: 'Cytotoxic T-cells' },
                { marker: 'CD45', fluorochrome: 'PerCP', purpose: 'Leukocyte gate' },
            ],
        },
        'viability': {
            name: 'Viability Panel',
            markers: [
                { marker: 'Annexin V', fluorochrome: 'FITC',  purpose: 'Early apoptosis' },
                { marker: 'PI',         fluorochrome: 'PI',    purpose: 'Late apoptosis / necrosis' },
            ],
        },
        'stem-cell': {
            name: 'Stem Cell Panel',
            markers: [
                { marker: 'CD34',  fluorochrome: 'PE',     purpose: 'Hematopoietic stem cells' },
                { marker: 'CD38',  fluorochrome: 'APC',    purpose: 'Differentiation marker' },
                { marker: 'CD90',  fluorochrome: 'FITC',   purpose: 'MSC marker' },
                { marker: 'CD105', fluorochrome: 'BV421',  purpose: 'Endoglin / MSC marker' },
            ],
        },
    };

    /* ── Statistics helpers ── */

    function sortNumeric(arr) {
        return arr.slice().sort(function (a, b) { return a - b; });
    }

    function mean(arr) {
        if (!arr.length) return 0;
        var sum = 0;
        for (var i = 0; i < arr.length; i++) sum += arr[i];
        return sum / arr.length;
    }

    function median(arr) {
        var s = sortNumeric(arr);
        var mid = Math.floor(s.length / 2);
        return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }

    function stddev(arr) {
        var m = mean(arr);
        var sumSq = 0;
        for (var i = 0; i < arr.length; i++) sumSq += (arr[i] - m) * (arr[i] - m);
        return Math.sqrt(sumSq / arr.length);
    }

    function percentile(arr, p) {
        var s = sortNumeric(arr);
        var idx = (p / 100) * (s.length - 1);
        var lo = Math.floor(idx);
        var hi = Math.ceil(idx);
        if (lo === hi) return s[lo];
        return s[lo] + (idx - lo) * (s[hi] - s[lo]);
    }

    function cv(arr) {
        var m = mean(arr);
        if (m === 0) return 0;
        return (stddev(arr) / m) * 100;
    }

    /* ── Core analysis functions ── */

    /**
     * Analyze a population of events from a single channel.
     * @param {Object} opts
     * @param {number[]} opts.events - Array of fluorescence intensity values
     * @param {string} [opts.channel] - Channel/fluorochrome name
     * @returns {Object} Population statistics
     */
    function analyzePopulation(opts) {
        if (!opts || !opts.events || !opts.events.length) {
            throw new Error('events array is required and must be non-empty');
        }
        var ev = opts.events;
        var sorted = sortNumeric(ev);
        return {
            channel: opts.channel || 'unknown',
            totalEvents: ev.length,
            mean: Math.round(mean(ev) * 100) / 100,
            median: Math.round(median(ev) * 100) / 100,
            stddev: Math.round(stddev(ev) * 100) / 100,
            cv: Math.round(cv(ev) * 100) / 100,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            percentile5: Math.round(percentile(ev, 5) * 100) / 100,
            percentile25: Math.round(percentile(ev, 25) * 100) / 100,
            percentile75: Math.round(percentile(ev, 75) * 100) / 100,
            percentile95: Math.round(percentile(ev, 95) * 100) / 100,
        };
    }

    /**
     * Perform viability analysis from live/dead stain data.
     * @param {Object} opts
     * @param {number} opts.totalEvents - Total events acquired
     * @param {number} opts.liveEvents - Events in the live gate
     * @param {number} [opts.earlyApoptotic] - Events in early apoptosis gate
     * @param {number} [opts.lateApoptotic] - Events in late apoptosis/necrosis gate
     * @returns {Object} Viability report
     */
    function analyzeViability(opts) {
        if (!opts || !opts.totalEvents || !opts.liveEvents) {
            throw new Error('totalEvents and liveEvents are required');
        }
        var total = opts.totalEvents;
        var live = opts.liveEvents;
        var earlyAp = opts.earlyApoptotic || 0;
        var lateAp = opts.lateApoptotic || 0;
        var debris = total - live - earlyAp - lateAp;
        if (debris < 0) debris = 0;

        var viabilityPct = (live / total) * 100;
        var qualityRating;
        if (viabilityPct >= 95) qualityRating = 'Excellent';
        else if (viabilityPct >= 90) qualityRating = 'Good';
        else if (viabilityPct >= 80) qualityRating = 'Acceptable';
        else if (viabilityPct >= 70) qualityRating = 'Poor';
        else qualityRating = 'Critical';

        return {
            totalEvents: total,
            liveEvents: live,
            earlyApoptotic: earlyAp,
            lateApoptotic: lateAp,
            debris: debris,
            viability: Math.round(viabilityPct * 100) / 100,
            qualityRating: qualityRating,
            recommendation: viabilityPct < 80
                ? 'Viability below 80%. Consider optimizing cell handling or reducing processing time.'
                : 'Viability acceptable for downstream applications.',
        };
    }

    /**
     * Perform quadrant analysis for dual-marker experiments.
     * @param {Object} opts
     * @param {number[]} opts.xValues - Intensity values for X-axis marker
     * @param {number[]} opts.yValues - Intensity values for Y-axis marker
     * @param {number} opts.xThreshold - Gate threshold for X marker
     * @param {number} opts.yThreshold - Gate threshold for Y marker
     * @param {string} [opts.xMarker] - X marker name
     * @param {string} [opts.yMarker] - Y marker name
     * @returns {Object} Quadrant statistics
     */
    function quadrantAnalysis(opts) {
        if (!opts || !opts.xValues || !opts.yValues) {
            throw new Error('xValues and yValues arrays are required');
        }
        if (opts.xValues.length !== opts.yValues.length) {
            throw new Error('xValues and yValues must have equal length');
        }
        if (opts.xThreshold == null || opts.yThreshold == null) {
            throw new Error('xThreshold and yThreshold are required');
        }

        var n = opts.xValues.length;
        var q1 = 0, q2 = 0, q3 = 0, q4 = 0; // Q1=LL, Q2=LR, Q3=UL, Q4=UR

        for (var i = 0; i < n; i++) {
            var xHi = opts.xValues[i] >= opts.xThreshold;
            var yHi = opts.yValues[i] >= opts.yThreshold;
            if (!xHi && !yHi) q1++;
            else if (xHi && !yHi) q2++;
            else if (!xHi && yHi) q3++;
            else q4++;
        }

        function pct(v) { return Math.round((v / n) * 10000) / 100; }

        return {
            totalEvents: n,
            xMarker: opts.xMarker || 'X',
            yMarker: opts.yMarker || 'Y',
            xThreshold: opts.xThreshold,
            yThreshold: opts.yThreshold,
            quadrants: {
                Q1_doubleNeg: { count: q1, percent: pct(q1), label: 'Double Negative' },
                Q2_xPos:      { count: q2, percent: pct(q2), label: (opts.xMarker || 'X') + '+ only' },
                Q3_yPos:      { count: q3, percent: pct(q3), label: (opts.yMarker || 'Y') + '+ only' },
                Q4_doublePos: { count: q4, percent: pct(q4), label: 'Double Positive' },
            },
        };
    }

    /**
     * Build histogram bins from event data.
     * @param {Object} opts
     * @param {number[]} opts.events - Fluorescence intensity values
     * @param {number} [opts.bins=256] - Number of bins
     * @param {number} [opts.logScale] - If true, use log10 scale
     * @returns {Object} Histogram data
     */
    function histogram(opts) {
        if (!opts || !opts.events || !opts.events.length) {
            throw new Error('events array is required');
        }
        var ev = opts.events;
        var numBins = opts.bins || 256;
        var useLog = !!opts.logScale;

        var values = useLog
            ? ev.map(function (v) { return v > 0 ? Math.log10(v) : 0; })
            : ev;

        var minVal = Math.min.apply(null, values);
        var maxVal = Math.max.apply(null, values);
        var range = maxVal - minVal || 1;
        var binWidth = range / numBins;

        var bins = new Array(numBins);
        for (var b = 0; b < numBins; b++) bins[b] = 0;

        for (var i = 0; i < values.length; i++) {
            var idx = Math.floor((values[i] - minVal) / binWidth);
            if (idx >= numBins) idx = numBins - 1;
            bins[idx]++;
        }

        return {
            bins: bins,
            binWidth: Math.round(binWidth * 1000) / 1000,
            minValue: Math.round(minVal * 1000) / 1000,
            maxValue: Math.round(maxVal * 1000) / 1000,
            logScale: useLog,
            totalEvents: ev.length,
            peakBin: bins.indexOf(Math.max.apply(null, bins)),
        };
    }

    /**
     * Calculate spillover compensation between two channels.
     * @param {Object} opts
     * @param {number[]} opts.singleStainPrimary - Intensities in primary channel
     * @param {number[]} opts.singleStainSpillover - Intensities in spillover channel
     * @returns {Object} Compensation coefficient
     */
    function calculateCompensation(opts) {
        if (!opts || !opts.singleStainPrimary || !opts.singleStainSpillover) {
            throw new Error('singleStainPrimary and singleStainSpillover arrays required');
        }
        if (opts.singleStainPrimary.length !== opts.singleStainSpillover.length) {
            throw new Error('Arrays must have equal length');
        }

        var primary = opts.singleStainPrimary;
        var spillover = opts.singleStainSpillover;

        // Calculate spillover coefficient via linear regression slope
        var mP = mean(primary);
        var mS = mean(spillover);
        var num = 0, den = 0;
        for (var i = 0; i < primary.length; i++) {
            num += (primary[i] - mP) * (spillover[i] - mS);
            den += (primary[i] - mP) * (primary[i] - mP);
        }

        var coefficient = den !== 0 ? num / den : 0;

        return {
            spilloverCoefficient: Math.round(coefficient * 10000) / 10000,
            spilloverPercent: Math.round(coefficient * 10000) / 100,
            recommendation: Math.abs(coefficient) > 0.3
                ? 'High spillover detected. Consider using alternative fluorochromes.'
                : 'Spillover within acceptable range.',
        };
    }

    /**
     * Validate a multi-color panel for fluorochrome compatibility.
     * @param {string[]} fluorochromes - Array of fluorochrome names
     * @returns {Object} Panel validation report
     */
    function validatePanel(fluorochromes) {
        if (!fluorochromes || !fluorochromes.length) {
            throw new Error('fluorochromes array is required');
        }

        var issues = [];
        var details = [];

        for (var i = 0; i < fluorochromes.length; i++) {
            var fc = FLUOROCHROMES[fluorochromes[i]];
            if (!fc) {
                issues.push('Unknown fluorochrome: ' + fluorochromes[i]);
                continue;
            }
            details.push({
                name: fluorochromes[i],
                excitation: fc.excitation,
                emission: fc.emission,
                laser: fc.laser,
            });
        }

        // Check for emission overlap (within 30nm)
        for (var a = 0; a < details.length; a++) {
            for (var b = a + 1; b < details.length; b++) {
                var diff = Math.abs(details[a].emission - details[b].emission);
                if (diff < 30) {
                    issues.push(
                        'Emission overlap warning: ' + details[a].name +
                        ' (' + details[a].emission + 'nm) and ' + details[b].name +
                        ' (' + details[b].emission + 'nm) — only ' + diff + 'nm apart'
                    );
                }
            }
        }

        // Count lasers needed
        var lasers = {};
        details.forEach(function (d) { lasers[d.laser] = true; });

        return {
            fluorochromes: details,
            lasersRequired: Object.keys(lasers),
            laserCount: Object.keys(lasers).length,
            issues: issues,
            valid: issues.filter(function (i) { return i.indexOf('Unknown') >= 0; }).length === 0,
            panelComplexity: fluorochromes.length <= 4 ? 'Simple' :
                fluorochromes.length <= 8 ? 'Moderate' : 'Complex',
        };
    }

    /**
     * Get a predefined panel configuration.
     * @param {string} panelName - Panel name (e.g., 'T-cell-basic', 'viability', 'stem-cell')
     * @returns {Object} Panel configuration
     */
    function getPanel(panelName) {
        var panel = COMMON_PANELS[panelName];
        if (!panel) {
            throw new Error('Unknown panel: ' + panelName + '. Available: ' + Object.keys(COMMON_PANELS).join(', '));
        }
        return JSON.parse(JSON.stringify(panel));
    }

    /**
     * List available panels.
     * @returns {string[]}
     */
    function listPanels() {
        return Object.keys(COMMON_PANELS);
    }

    /**
     * List available fluorochromes.
     * @returns {Object[]}
     */
    function listFluorochromes() {
        return Object.keys(FLUOROCHROMES).map(function (name) {
            var fc = FLUOROCHROMES[name];
            return { name: name, excitation: fc.excitation, emission: fc.emission, laser: fc.laser };
        });
    }

    /* ── Public API ── */
    return {
        analyzePopulation: analyzePopulation,
        analyzeViability: analyzeViability,
        quadrantAnalysis: quadrantAnalysis,
        histogram: histogram,
        calculateCompensation: calculateCompensation,
        validatePanel: validatePanel,
        getPanel: getPanel,
        listPanels: listPanels,
        listFluorochromes: listFluorochromes,
    };
}

module.exports = { createFlowCytometryAnalyzer: createFlowCytometryAnalyzer };
