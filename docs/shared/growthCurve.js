'use strict';

/**
 * Growth Curve Analyzer for BioBots
 *
 * Tracks cell proliferation post-print with:
 *   - Exponential & logistic growth model fitting
 *   - Doubling time calculation
 *   - Growth phase detection (lag, log, stationary, decline)
 *   - Viability tracking over time
 *   - Statistical summary & export
 */
function createGrowthCurveAnalyzer() {

    // ── Growth Models ───────────────────────────────────────────

    /**
     * Exponential growth: N(t) = N0 * e^(r*t)
     * @param {number} n0 - Initial cell count
     * @param {number} r - Growth rate (1/h)
     * @param {number} t - Time (h)
     * @returns {number}
     */
    function exponentialGrowth(n0, r, t) {
        if (n0 <= 0) throw new Error('Initial count must be positive');
        if (t < 0) throw new Error('Time must be non-negative');
        return n0 * Math.exp(r * t);
    }

    /**
     * Logistic growth: N(t) = K / (1 + ((K - N0)/N0) * e^(-r*t))
     * @param {number} n0 - Initial cell count
     * @param {number} r - Growth rate (1/h)
     * @param {number} k - Carrying capacity
     * @param {number} t - Time (h)
     * @returns {number}
     */
    function logisticGrowth(n0, r, k, t) {
        if (n0 <= 0) throw new Error('Initial count must be positive');
        if (k <= 0) throw new Error('Carrying capacity must be positive');
        if (n0 > k) throw new Error('Initial count cannot exceed carrying capacity');
        if (t < 0) throw new Error('Time must be non-negative');
        return k / (1 + ((k - n0) / n0) * Math.exp(-r * t));
    }

    /**
     * Calculate doubling time from growth rate.
     * td = ln(2) / r
     * @param {number} r - Growth rate (1/h), must be > 0
     * @returns {number} Doubling time in hours
     */
    function doublingTime(r) {
        if (r <= 0) throw new Error('Growth rate must be positive for doubling time');
        return Math.LN2 / r;
    }

    /**
     * Estimate growth rate from two time points.
     * r = ln(N2/N1) / (t2 - t1)
     * @param {number} n1 - Count at time t1
     * @param {number} n2 - Count at time t2
     * @param {number} t1 - First time point (h)
     * @param {number} t2 - Second time point (h)
     * @returns {number} Growth rate (1/h)
     */
    function estimateGrowthRate(n1, n2, t1, t2) {
        if (n1 <= 0 || n2 <= 0) throw new Error('Counts must be positive');
        if (t2 <= t1) throw new Error('t2 must be greater than t1');
        return Math.log(n2 / n1) / (t2 - t1);
    }

    // ── Phase Detection ─────────────────────────────────────────

    /**
     * Detect growth phases from time-series data.
     * Uses specific growth rate (µ) changes to classify phases.
     *
     * @param {{ time: number, count: number }[]} data - Sorted time-series
     * @returns {{ phase: string, startTime: number, endTime: number, avgRate: number }[]}
     */
    function detectPhases(data) {
        if (!Array.isArray(data) || data.length < 3) {
            throw new Error('Need at least 3 data points for phase detection');
        }

        // Calculate specific growth rates between consecutive points
        var rates = [];
        for (var i = 1; i < data.length; i++) {
            var dt = data[i].time - data[i - 1].time;
            if (dt <= 0) throw new Error('Time points must be strictly increasing');
            var r = (data[i].count > 0 && data[i - 1].count > 0)
                ? Math.log(data[i].count / data[i - 1].count) / dt
                : 0;
            rates.push({ time: (data[i].time + data[i - 1].time) / 2, rate: r });
        }

        // Find max rate for thresholds
        var maxRate = 0;
        for (var i = 0; i < rates.length; i++) {
            if (rates[i].rate > maxRate) maxRate = rates[i].rate;
        }

        var lagThreshold = maxRate * 0.1;
        var stationaryThreshold = maxRate * 0.05;

        var phases = [];
        var currentPhase = null;
        var phaseStart = data[0].time;
        var phaseRateSum = 0;
        var phaseRateCount = 0;

        for (var i = 0; i < rates.length; i++) {
            var r = rates[i].rate;
            var phase;

            if (r < -stationaryThreshold) {
                phase = 'decline';
            } else if (r < lagThreshold && phases.length === 0) {
                phase = 'lag';
            } else if (r < stationaryThreshold) {
                phase = 'stationary';
            } else {
                phase = 'log';
            }

            if (phase !== currentPhase) {
                if (currentPhase !== null) {
                    phases.push({
                        phase: currentPhase,
                        startTime: Math.round(phaseStart * 100) / 100,
                        endTime: Math.round(data[i].time * 100) / 100,
                        avgRate: phaseRateCount > 0
                            ? Math.round((phaseRateSum / phaseRateCount) * 1e6) / 1e6
                            : 0
                    });
                }
                currentPhase = phase;
                phaseStart = data[i].time;
                phaseRateSum = r;
                phaseRateCount = 1;
            } else {
                phaseRateSum += r;
                phaseRateCount++;
            }
        }

        // Close last phase
        if (currentPhase !== null) {
            phases.push({
                phase: currentPhase,
                startTime: Math.round(phaseStart * 100) / 100,
                endTime: Math.round(data[data.length - 1].time * 100) / 100,
                avgRate: phaseRateCount > 0
                    ? Math.round((phaseRateSum / phaseRateCount) * 1e6) / 1e6
                    : 0
            });
        }

        return phases;
    }

    // ── Curve Fitting (Least Squares) ───────────────────────────

    /**
     * Fit exponential growth model to data using linearized least squares.
     * ln(N) = ln(N0) + r*t
     *
     * @param {{ time: number, count: number }[]} data
     * @returns {{ n0: number, r: number, doublingTime: number, rSquared: number }}
     */
    function fitExponential(data) {
        if (!Array.isArray(data) || data.length < 2) {
            throw new Error('Need at least 2 data points');
        }

        // Filter out zero/negative counts
        var valid = [];
        for (var i = 0; i < data.length; i++) {
            if (data[i].count > 0) valid.push(data[i]);
        }
        if (valid.length < 2) throw new Error('Need at least 2 positive data points');

        var n = valid.length;
        var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;

        for (var i = 0; i < n; i++) {
            var x = valid[i].time;
            var y = Math.log(valid[i].count);
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
            sumYY += y * y;
        }

        var denom = n * sumXX - sumX * sumX;
        if (Math.abs(denom) < 1e-12) throw new Error('Degenerate data (all same time)');

        var r = (n * sumXY - sumX * sumY) / denom;
        var lnN0 = (sumY - r * sumX) / n;
        var n0 = Math.exp(lnN0);

        // R-squared
        var meanY = sumY / n;
        var ssTot = sumYY - n * meanY * meanY;
        var ssRes = 0;
        for (var i = 0; i < n; i++) {
            var pred = lnN0 + r * valid[i].time;
            var diff = Math.log(valid[i].count) - pred;
            ssRes += diff * diff;
        }
        var rSq = ssTot > 0 ? 1 - ssRes / ssTot : 0;

        return {
            n0: Math.round(n0 * 100) / 100,
            r: Math.round(r * 1e6) / 1e6,
            doublingTime: r > 0 ? Math.round(doublingTime(r) * 100) / 100 : null,
            rSquared: Math.round(rSq * 10000) / 10000
        };
    }

    /**
     * Fit logistic growth model using iterative least squares.
     * Estimates K (carrying capacity), r (rate), and N0.
     *
     * Uses analytical gradients (∂P/∂r and ∂P/∂K computed from the
     * logistic formula directly) instead of numerical finite-difference
     * approximation, reducing per-iteration cost from 3 exp() calls per
     * data point to 1. Also adds early termination when the relative
     * change in MSE drops below 1e-10, avoiding wasted iterations on
     * already-converged fits.
     *
     * @param {{ time: number, count: number }[]} data
     * @param {number} [maxIter=200] - Max iterations
     * @param {{ r: number }} [precomputedExpFit] - Optional pre-computed exponential fit to reuse for initial r estimate
     * @returns {{ n0: number, r: number, k: number, doublingTime: number, rSquared: number }}
     */
    function fitLogistic(data, maxIter, precomputedExpFit) {
        if (!Array.isArray(data) || data.length < 3) {
            throw new Error('Need at least 3 data points for logistic fit');
        }
        maxIter = maxIter || 200;

        var valid = [];
        for (var i = 0; i < data.length; i++) {
            if (data[i].count > 0) valid.push(data[i]);
        }
        if (valid.length < 3) throw new Error('Need at least 3 positive data points');

        // Initial guesses
        var n0 = valid[0].count;
        var maxCount = 0;
        for (var i = 0; i < valid.length; i++) {
            if (valid[i].count > maxCount) maxCount = valid[i].count;
        }
        var k = maxCount * 1.2;

        // Estimate r from exponential fit of first half (or reuse
        // pre-computed fit when available to avoid redundant regression)
        var expFit;
        if (precomputedExpFit && typeof precomputedExpFit.r === 'number') {
            expFit = precomputedExpFit;
        } else {
            var halfLen = Math.max(2, Math.floor(valid.length / 2));
            expFit = fitExponential(valid.slice(0, halfLen));
        }
        var r = Math.max(0.001, expFit.r);

        // Gradient descent with analytical gradients and early termination.
        //
        // Logistic: P(t) = K / (1 + A·e^(-r·t))  where A = (K - N0)/N0
        //
        // ∂P/∂r = K · A · t · e^(-r·t) / (1 + A·e^(-r·t))²
        //       = P² · A · t · e^(-r·t) / K
        //
        // ∂P/∂K = 1 / (1 + A·e^(-r·t))  –  K · (e^(-r·t)/N0) / (1 + A·e^(-r·t))²
        //       = P/K  –  P² · e^(-r·t) / (K · N0)
        var lr = 0.0001;
        var prevMSE = Infinity;
        for (var iter = 0; iter < maxIter; iter++) {
            var gradR = 0, gradK = 0;
            var totalErr = 0;
            var A = (k - n0) / n0;

            for (var i = 0; i < valid.length; i++) {
                var t = valid[i].time;
                var observed = valid[i].count;
                var expTerm = Math.exp(-r * t);      // single exp() per point
                var denom = 1 + A * expTerm;
                var predicted = k / denom;
                var err = predicted - observed;
                totalErr += err * err;

                // Analytical partial derivatives
                var pOverDenom = predicted / denom;   // P / (1 + A·e^(-rt)) = P²/K
                var dPdR = pOverDenom * A * t * expTerm;
                var dPdK = predicted / k - pOverDenom * expTerm / n0;

                gradR += 2 * err * dPdR;
                gradK += 2 * err * dPdK;
            }

            r = Math.max(0.0001, r - lr * gradR / valid.length);
            k = Math.max(maxCount, k - lr * gradK / valid.length);

            // Early termination: stop if MSE barely changes
            var mse = totalErr / valid.length;
            if (iter > 0 && Math.abs(prevMSE - mse) / (prevMSE + 1e-20) < 1e-10) {
                break;
            }
            prevMSE = mse;
        }

        // R-squared
        var meanCount = 0;
        for (var i = 0; i < valid.length; i++) meanCount += valid[i].count;
        meanCount /= valid.length;

        var ssTot = 0, ssRes = 0;
        for (var i = 0; i < valid.length; i++) {
            ssTot += Math.pow(valid[i].count - meanCount, 2);
            var pred = logisticGrowth(n0, r, k, valid[i].time);
            ssRes += Math.pow(valid[i].count - pred, 2);
        }
        var rSq = ssTot > 0 ? 1 - ssRes / ssTot : 0;

        return {
            n0: Math.round(n0 * 100) / 100,
            r: Math.round(r * 1e6) / 1e6,
            k: Math.round(k * 100) / 100,
            doublingTime: r > 0 ? Math.round(doublingTime(r) * 100) / 100 : null,
            rSquared: Math.round(Math.max(0, rSq) * 10000) / 10000
        };
    }

    // ── Summary Statistics ──────────────────────────────────────

    /**
     * Generate comprehensive growth curve summary.
     *
     * @param {{ time: number, count: number }[]} data - Time-series data
     * @returns {Object} Summary with fits, phases, stats
     */
    function summarize(data) {
        if (!Array.isArray(data) || data.length < 2) {
            throw new Error('Need at least 2 data points');
        }

        var sorted = data.slice().sort(function (a, b) { return a.time - b.time; });

        var minCount = Infinity, maxCount = -Infinity;
        var totalCount = 0;
        for (var i = 0; i < sorted.length; i++) {
            if (sorted[i].count < minCount) minCount = sorted[i].count;
            if (sorted[i].count > maxCount) maxCount = sorted[i].count;
            totalCount += sorted[i].count;
        }

        var expFit = null;
        try { expFit = fitExponential(sorted); } catch (e) { /* skip */ }

        // fitLogistic internally calls fitExponential on the first
        // half of the data to seed its initial growth-rate guess.
        // Pass the full-data expFit so it can reuse r directly
        // instead of recomputing the regression.
        var logFit = null;
        try { logFit = fitLogistic(sorted, undefined, expFit); } catch (e) { /* skip */ }

        var phases = null;
        try { phases = detectPhases(sorted); } catch (e) { /* skip */ }

        var foldChange = (sorted[0].count > 0)
            ? Math.round((sorted[sorted.length - 1].count / sorted[0].count) * 100) / 100
            : null;

        return {
            dataPoints: sorted.length,
            timeRange: {
                start: sorted[0].time,
                end: sorted[sorted.length - 1].time,
                duration: sorted[sorted.length - 1].time - sorted[0].time
            },
            counts: {
                initial: sorted[0].count,
                final: sorted[sorted.length - 1].count,
                min: minCount,
                max: maxCount,
                mean: Math.round((totalCount / sorted.length) * 100) / 100,
                foldChange: foldChange
            },
            exponentialFit: expFit,
            logisticFit: logFit,
            phases: phases,
            bestModel: (expFit && logFit)
                ? (logFit.rSquared > expFit.rSquared ? 'logistic' : 'exponential')
                : (logFit ? 'logistic' : (expFit ? 'exponential' : null))
        };
    }

    // ── Curve Presets (common cell types) ───────────────────────

    var PRESETS = {
        'HeLa': { doublingTime: 24, lagHours: 6, maxDensity: 5e6, description: 'HeLa cervical cancer cells' },
        'HEK293': { doublingTime: 36, lagHours: 8, maxDensity: 3e6, description: 'Human embryonic kidney cells' },
        'CHO': { doublingTime: 20, lagHours: 4, maxDensity: 8e6, description: 'Chinese hamster ovary cells' },
        'MSC': { doublingTime: 48, lagHours: 12, maxDensity: 1e6, description: 'Mesenchymal stem cells' },
        'iPSC': { doublingTime: 18, lagHours: 24, maxDensity: 2e6, description: 'Induced pluripotent stem cells' },
        'Fibroblast': { doublingTime: 30, lagHours: 8, maxDensity: 4e6, description: 'Primary fibroblasts' },
        'Chondrocyte': { doublingTime: 72, lagHours: 24, maxDensity: 0.5e6, description: 'Cartilage chondrocytes' },
        'Hepatocyte': { doublingTime: 60, lagHours: 16, maxDensity: 1.5e6, description: 'Liver hepatocytes' }
    };

    /**
     * Generate a synthetic growth curve from a preset.
     * @param {string} cellType - Key from PRESETS
     * @param {number} [n0=10000] - Initial seeding density
     * @param {number} [hours=168] - Total hours (default 7 days)
     * @param {number} [points=25] - Number of data points
     * @returns {{ time: number, count: number }[]}
     */
    function generateFromPreset(cellType, n0, hours, points) {
        var preset = PRESETS[cellType];
        if (!preset) throw new Error('Unknown cell type: ' + cellType + '. Available: ' + Object.keys(PRESETS).join(', '));

        n0 = n0 || 10000;
        hours = hours || 168;
        points = points || 25;

        var r = Math.LN2 / preset.doublingTime;
        var k = preset.maxDensity;
        var result = [];

        for (var i = 0; i < points; i++) {
            var t = (i / (points - 1)) * hours;
            var count;
            if (t < preset.lagHours) {
                // Lag phase - slow initial adaptation
                count = n0 * (1 + 0.05 * (t / preset.lagHours));
            } else {
                var effectiveT = t - preset.lagHours;
                count = logisticGrowth(n0, r, k, effectiveT);
            }
            // Add ±5% noise
            var noise = 1 + (Math.random() - 0.5) * 0.1;
            result.push({
                time: Math.round(t * 10) / 10,
                count: Math.round(count * noise)
            });
        }

        return result;
    }

    // ── Export ───────────────────────────────────────────────────

    /**
     * Export growth data as CSV string.
     * @param {{ time: number, count: number }[]} data
     * @param {Object} [summary] - Optional summary to include as header comments
     * @returns {string}
     */
    function exportCSV(data, summary) {
        var lines = [];
        if (summary) {
            lines.push('# Growth Curve Analysis Export');
            if (summary.exponentialFit) {
                lines.push('# Exponential fit: r=' + summary.exponentialFit.r +
                    ' doublingTime=' + summary.exponentialFit.doublingTime + 'h' +
                    ' R²=' + summary.exponentialFit.rSquared);
            }
            if (summary.logisticFit) {
                lines.push('# Logistic fit: r=' + summary.logisticFit.r +
                    ' K=' + summary.logisticFit.k +
                    ' doublingTime=' + summary.logisticFit.doublingTime + 'h' +
                    ' R²=' + summary.logisticFit.rSquared);
            }
            lines.push('# Best model: ' + (summary.bestModel || 'N/A'));
        }
        lines.push('Time (h),Cell Count');
        for (var i = 0; i < data.length; i++) {
            lines.push(data[i].time + ',' + data[i].count);
        }
        return lines.join('\n');
    }

    /**
     * Export as JSON.
     * @param {{ time: number, count: number }[]} data
     * @param {Object} [summary]
     * @returns {string}
     */
    function exportJSON(data, summary) {
        return JSON.stringify({ data: data, analysis: summary || null }, null, 2);
    }

    // ── Public API ──────────────────────────────────────────────

    return {
        exponentialGrowth: exponentialGrowth,
        logisticGrowth: logisticGrowth,
        doublingTime: doublingTime,
        estimateGrowthRate: estimateGrowthRate,
        detectPhases: detectPhases,
        fitExponential: fitExponential,
        fitLogistic: fitLogistic,
        summarize: summarize,
        generateFromPreset: generateFromPreset,
        exportCSV: exportCSV,
        exportJSON: exportJSON,
        PRESETS: PRESETS
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createGrowthCurveAnalyzer: createGrowthCurveAnalyzer };
}
