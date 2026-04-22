'use strict';

var _vRound = require('./validation').round;
var _statsLinReg = require('./stats').linearRegression;

/**
 * Standard Curve Calculator — fit a linear regression to known
 * standard concentrations vs. measured signals (absorbance, fluorescence,
 * luminescence), then interpolate unknown sample concentrations.
 *
 * Common assays: Bradford, BCA, ELISA, Lowry, spectrophotometric DNA quant.
 *
 * @example
 *   var sc = createStandardCurveCalculator();
 *   var curve = sc.fitCurve({
 *     standards: [
 *       { concentration: 0,    signal: 0.05 },
 *       { concentration: 0.25, signal: 0.18 },
 *       { concentration: 0.5,  signal: 0.34 },
 *       { concentration: 1.0,  signal: 0.65 },
 *       { concentration: 2.0,  signal: 1.28 },
 *     ]
 *   });
 *   // => { slope, intercept, rSquared, equation }
 *
 *   sc.interpolate({ curve: curve, signal: 0.50 });
 *   // => { concentration: 0.741..., withinRange: true }
 */

// ── Helpers ────────────────────────────────────────────────────────

function _validate(standards) {
    if (!Array.isArray(standards) || standards.length < 2) {
        throw new Error('At least 2 standard points are required');
    }
    standards.forEach(function (s, i) {
        if (typeof s.concentration !== 'number' || typeof s.signal !== 'number') {
            throw new Error('Standard #' + (i + 1) + ' must have numeric concentration and signal');
        }
    });
}

/**
 * Thin adapter over stats.linearRegression — accepts {x, y} point objects
 * and returns {slope, intercept, rSquared}.
 */
function _linearRegression(points) {
    var xs = new Array(points.length);
    var ys = new Array(points.length);
    for (var i = 0; i < points.length; i++) {
        xs[i] = points[i].x;
        ys[i] = points[i].y;
    }
    var reg = _statsLinReg(xs, ys);
    if (reg.slope === 0 && xs.length > 1) {
        // Check if all X values are identical (stats returns slope=0 for denom=0)
        var allSame = true;
        for (var j = 1; j < xs.length; j++) {
            if (xs[j] !== xs[0]) { allSame = false; break; }
        }
        if (allSame) throw new Error('Cannot fit line — all X values are identical');
    }
    return { slope: reg.slope, intercept: reg.intercept, rSquared: reg.r2 };
}

function _round(v, d) {
    return _vRound(v, d || 6);
}

// ── Factory ────────────────────────────────────────────────────────

function createStandardCurveCalculator() {

    /**
     * Fit a linear curve (signal = slope * concentration + intercept).
     */
    function fitCurve(opts) {
        if (!opts || !opts.standards) throw new Error('standards array required');
        _validate(opts.standards);

        var points = opts.standards.map(function (s) {
            return { x: s.concentration, y: s.signal };
        });

        var reg = _linearRegression(points);

        var concentrations = opts.standards.map(function (s) { return s.concentration; });
        var minConc = Math.min.apply(null, concentrations);
        var maxConc = Math.max.apply(null, concentrations);

        return {
            slope:     _round(reg.slope),
            intercept: _round(reg.intercept),
            rSquared:  _round(reg.rSquared),
            n:         opts.standards.length,
            range:     { min: minConc, max: maxConc },
            equation:  'signal = ' + _round(reg.slope, 4) + ' × conc + ' + _round(reg.intercept, 4),
            quality:   reg.rSquared >= 0.99 ? 'excellent'
                     : reg.rSquared >= 0.95 ? 'good'
                     : reg.rSquared >= 0.90 ? 'acceptable'
                     : 'poor'
        };
    }

    /**
     * Calculate concentration from a measured signal using a fitted curve.
     */
    function interpolate(opts) {
        if (!opts || !opts.curve) throw new Error('curve object required');
        if (typeof opts.signal !== 'number') throw new Error('signal must be a number');

        var curve = opts.curve;
        if (curve.slope === 0) throw new Error('Slope is zero — cannot interpolate');

        var conc = (opts.signal - curve.intercept) / curve.slope;
        conc = _round(conc);

        var withinRange = conc >= curve.range.min && conc <= curve.range.max;

        var result = {
            concentration: conc,
            signal:        opts.signal,
            withinRange:   withinRange
        };

        if (!withinRange) {
            result.warning = conc < curve.range.min
                ? 'Below standard range — consider adding lower standards'
                : 'Above standard range — consider diluting sample or adding higher standards';
        }

        return result;
    }

    /**
     * Batch-interpolate multiple unknown samples.
     */
    function interpolateBatch(opts) {
        if (!opts || !opts.curve) throw new Error('curve object required');
        if (!Array.isArray(opts.signals)) throw new Error('signals array required');

        return opts.signals.map(function (sig) {
            return interpolate({ curve: opts.curve, signal: sig });
        });
    }

    /**
     * Calculate residuals for each standard point (goodness-of-fit detail).
     */
    function residuals(opts) {
        if (!opts || !opts.curve || !opts.standards) throw new Error('curve and standards required');

        return opts.standards.map(function (s) {
            var predicted = opts.curve.slope * s.concentration + opts.curve.intercept;
            return {
                concentration: s.concentration,
                observedSignal: s.signal,
                predictedSignal: _round(predicted),
                residual: _round(s.signal - predicted)
            };
        });
    }

    /**
     * Compute the limit of detection (LOD) and limit of quantification (LOQ).
     * LOD = 3 × σ_blank / slope
     * LOQ = 10 × σ_blank / slope
     */
    function detectionLimits(opts) {
        if (!opts || !opts.curve) throw new Error('curve object required');
        if (!Array.isArray(opts.blankSignals) || opts.blankSignals.length < 2) {
            throw new Error('At least 2 blank signal readings required');
        }

        var blanks = opts.blankSignals;
        var mean = blanks.reduce(function (a, b) { return a + b; }, 0) / blanks.length;
        var variance = blanks.reduce(function (sum, v) {
            return sum + (v - mean) * (v - mean);
        }, 0) / (blanks.length - 1);
        var sd = Math.sqrt(variance);

        var slope = Math.abs(opts.curve.slope);
        if (slope === 0) throw new Error('Slope is zero');

        return {
            blankMean: _round(mean),
            blankSD:   _round(sd),
            LOD:       _round(3 * sd / slope),
            LOQ:       _round(10 * sd / slope)
        };
    }

    /**
     * Suggest a standard dilution series given a concentration range.
     */
    function suggestStandards(opts) {
        if (!opts) throw new Error('options required');
        var min = opts.minConcentration || 0;
        var max = opts.maxConcentration;
        if (typeof max !== 'number' || max <= min) throw new Error('Valid maxConcentration required');

        var n = opts.points || 6;
        if (n < 2) n = 2;
        if (n > 12) n = 12;

        var step = (max - min) / (n - 1);
        var standards = [];
        for (var i = 0; i < n; i++) {
            standards.push(_round(min + step * i, 4));
        }

        return {
            concentrations: standards,
            count: n,
            tip: 'Prepare standards by serial dilution from ' + max + ' stock'
        };
    }

    return {
        fitCurve:           fitCurve,
        interpolate:        interpolate,
        interpolateBatch:   interpolateBatch,
        residuals:          residuals,
        detectionLimits:    detectionLimits,
        suggestStandards:   suggestStandards
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createStandardCurveCalculator: createStandardCurveCalculator };
}
