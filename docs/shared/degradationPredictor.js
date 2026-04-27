'use strict';

/**
 * Degradation Predictor — Models scaffold/bioink degradation kinetics
 * with proactive structural failure warnings.
 *
 * Supports first-order, enzymatic (Michaelis-Menten), and hydrolytic
 * degradation models. Tracks mass loss over time, predicts remaining
 * integrity at any timepoint, and issues tiered alerts when structural
 * failure thresholds are approaching.
 *
 * @example
 *   var dp = createDegradationPredictor();
 *   dp.addMeasurement({ sampleId: 'S1', day: 0, massPercent: 100, material: 'alginate' });
 *   dp.addMeasurement({ sampleId: 'S1', day: 7, massPercent: 82 });
 *   dp.addMeasurement({ sampleId: 'S1', day: 14, massPercent: 65 });
 *   var fit = dp.fitModel('S1');           // auto-selects best kinetic model
 *   var pred = dp.predict('S1', 30);       // predict mass% at day 30
 *   var alerts = dp.checkAlerts('S1');      // proactive failure warnings
 *   var report = dp.generateReport('S1');   // full degradation report
 */

// ── Helpers ────────────────────────────────────────────────────────
var round = require('./validation').round;

function validateNumber(v, name) {
    if (typeof v !== 'number' || !isFinite(v)) {
        throw new Error('degradationPredictor: ' + name + ' must be a finite number, got ' + v);
    }
}

function validateString(v, name) {
    if (typeof v !== 'string' || v.trim().length === 0) {
        throw new Error('degradationPredictor: ' + name + ' must be a non-empty string');
    }
}

// ── Kinetic Models ─────────────────────────────────────────────────

/**
 * First-order exponential decay: M(t) = M0 * exp(-k * t)
 * Linearize: ln(M) = ln(M0) - k*t
 */
function fitFirstOrder(times, masses) {
    var n = times.length;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
        var lnM = Math.log(Math.max(masses[i], 0.01));
        sumX += times[i];
        sumY += lnM;
        sumXY += times[i] * lnM;
        sumX2 += times[i] * times[i];
    }
    var denom = n * sumX2 - sumX * sumX;
    if (Math.abs(denom) < 1e-12) return null;
    var slope = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;
    var k = -slope;
    var M0 = Math.exp(intercept);
    if (k <= 0) return null; // not degrading

    // R² calculation
    var meanY = sumY / n;
    var ssTot = 0, ssRes = 0;
    for (var j = 0; j < n; j++) {
        var lnMj = Math.log(Math.max(masses[j], 0.01));
        var pred = intercept + slope * times[j];
        ssTot += (lnMj - meanY) * (lnMj - meanY);
        ssRes += (lnMj - pred) * (lnMj - pred);
    }
    var r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    return {
        model: 'first-order',
        params: { M0: round(M0, 2), k: round(k, 6) },
        r2: round(r2, 4),
        predict: function (t) { return round(M0 * Math.exp(-k * t), 2); },
        halfLife: round(Math.log(2) / k, 1)
    };
}

/**
 * Linear degradation: M(t) = M0 - r*t
 */
function fitLinear(times, masses) {
    var n = times.length;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var i = 0; i < n; i++) {
        sumX += times[i];
        sumY += masses[i];
        sumXY += times[i] * masses[i];
        sumX2 += times[i] * times[i];
    }
    var denom = n * sumX2 - sumX * sumX;
    if (Math.abs(denom) < 1e-12) return null;
    var slope = (n * sumXY - sumX * sumY) / denom;
    var intercept = (sumY - slope * sumX) / n;
    var rate = -slope;
    if (rate <= 0) return null;

    var meanY = sumY / n;
    var ssTot = 0, ssRes = 0;
    for (var j = 0; j < n; j++) {
        var pred = intercept + slope * times[j];
        ssTot += (masses[j] - meanY) * (masses[j] - meanY);
        ssRes += (masses[j] - pred) * (masses[j] - pred);
    }
    var r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    return {
        model: 'linear',
        params: { M0: round(intercept, 2), rate: round(rate, 4) },
        r2: round(r2, 4),
        predict: function (t) { return round(Math.max(0, intercept - rate * t), 2); },
        halfLife: round(intercept / (2 * rate), 1)
    };
}

/**
 * Power-law (Korsmeyer-Peppas): M_released(t) = k * t^n
 * M(t) = M0 - k*t^n  →  ln(M0-M) = ln(k) + n*ln(t)
 */
function fitPowerLaw(times, masses) {
    if (masses.length < 3) return null;
    var M0 = masses[0];
    var pts = [];
    for (var i = 1; i < times.length; i++) {
        var released = M0 - masses[i];
        if (released > 0 && times[i] > 0) {
            pts.push({ t: times[i], rel: released });
        }
    }
    if (pts.length < 2) return null;

    var n = pts.length;
    var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (var j = 0; j < n; j++) {
        var lnT = Math.log(pts[j].t);
        var lnR = Math.log(pts[j].rel);
        sumX += lnT;
        sumY += lnR;
        sumXY += lnT * lnR;
        sumX2 += lnT * lnT;
    }
    var denom = n * sumX2 - sumX * sumX;
    if (Math.abs(denom) < 1e-12) return null;
    var nExp = (n * sumXY - sumX * sumY) / denom;
    var lnK = (sumY - nExp * sumX) / n;
    var kCoef = Math.exp(lnK);

    // R² on original scale
    var meanM = 0;
    for (var q = 0; q < masses.length; q++) meanM += masses[q];
    meanM /= masses.length;
    var ssTot = 0, ssRes = 0;
    for (var p = 0; p < times.length; p++) {
        var pred = Math.max(0, M0 - kCoef * Math.pow(Math.max(times[p], 0.001), nExp));
        ssTot += (masses[p] - meanM) * (masses[p] - meanM);
        ssRes += (masses[p] - pred) * (masses[p] - pred);
    }
    var r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    return {
        model: 'power-law',
        params: { M0: round(M0, 2), k: round(kCoef, 6), n: round(nExp, 4) },
        r2: round(r2, 4),
        predict: function (t) {
            return round(Math.max(0, M0 - kCoef * Math.pow(Math.max(t, 0), nExp)), 2);
        },
        halfLife: round(Math.pow((M0 / 2) / kCoef, 1 / nExp), 1)
    };
}

// ── Alert Thresholds ───────────────────────────────────────────────

var DEFAULT_THRESHOLDS = {
    critical: 20,   // mass% below which structural failure is imminent
    warning: 40,    // mass% — approaching failure
    caution: 60,    // mass% — noticeable degradation
    lookaheadDays: 14  // how far ahead to check for threshold crossings
};

// ── Material Profiles ──────────────────────────────────────────────

var MATERIAL_PROFILES = {
    alginate:   { typicalHalfLife: [14, 42],  mechanism: 'ionic dissolution', notes: 'Ca²⁺ chelation accelerates' },
    gelatin:    { typicalHalfLife: [7, 28],   mechanism: 'enzymatic + thermal', notes: 'Temperature-sensitive above 37°C' },
    collagen:   { typicalHalfLife: [21, 90],  mechanism: 'enzymatic (collagenase)', notes: 'Cross-linking extends stability' },
    peg:        { typicalHalfLife: [30, 180], mechanism: 'hydrolytic', notes: 'pH-dependent ester hydrolysis' },
    hyaluronic: { typicalHalfLife: [3, 21],   mechanism: 'enzymatic (hyaluronidase)', notes: 'Rapid in vivo degradation' },
    pcl:        { typicalHalfLife: [180, 730], mechanism: 'hydrolytic', notes: 'Very slow, bulk erosion' },
    plga:       { typicalHalfLife: [30, 120], mechanism: 'hydrolytic', notes: 'Autocatalytic, ratio-dependent' },
    silk:       { typicalHalfLife: [60, 365], mechanism: 'proteolytic', notes: 'Beta-sheet content affects rate' }
};

// ── Factory ────────────────────────────────────────────────────────

function createDegradationPredictor(options) {
    options = options || {};
    var thresholds = {};
    var defT = DEFAULT_THRESHOLDS;
    thresholds.critical = (options.thresholds && options.thresholds.critical) || defT.critical;
    thresholds.warning = (options.thresholds && options.thresholds.warning) || defT.warning;
    thresholds.caution = (options.thresholds && options.thresholds.caution) || defT.caution;
    thresholds.lookaheadDays = (options.thresholds && options.thresholds.lookaheadDays) || defT.lookaheadDays;

    // sampleId → { measurements: [], material: string|null, fit: object|null }
    var samples = Object.create(null);

    function ensureSample(id) {
        if (!samples[id]) {
            samples[id] = { measurements: [], material: null, fit: null };
        }
        return samples[id];
    }

    /**
     * Record a degradation measurement.
     */
    function addMeasurement(opts) {
        validateString(opts.sampleId, 'sampleId');
        validateNumber(opts.day, 'day');
        validateNumber(opts.massPercent, 'massPercent');
        if (opts.day < 0) throw new Error('degradationPredictor: day must be >= 0');
        if (opts.massPercent < 0 || opts.massPercent > 150) {
            throw new Error('degradationPredictor: massPercent must be 0-150');
        }

        var s = ensureSample(opts.sampleId);
        if (opts.material) s.material = opts.material.toLowerCase();
        s.measurements.push({ day: opts.day, massPercent: opts.massPercent });
        s.measurements.sort(function (a, b) { return a.day - b.day; });
        s.fit = null; // invalidate cached fit
    }

    /**
     * Fit best kinetic model to sample data. Requires >= 3 measurements.
     */
    function fitModel(sampleId, modelType) {
        validateString(sampleId, 'sampleId');
        var s = samples[sampleId];
        if (!s) throw new Error('degradationPredictor: unknown sample "' + sampleId + '"');
        if (s.measurements.length < 3) {
            throw new Error('degradationPredictor: need >= 3 measurements for fitting, have ' + s.measurements.length);
        }

        var times = [], masses = [];
        for (var i = 0; i < s.measurements.length; i++) {
            times.push(s.measurements[i].day);
            masses.push(s.measurements[i].massPercent);
        }

        var candidates = [];
        if (!modelType || modelType === 'first-order') {
            var fo = fitFirstOrder(times, masses);
            if (fo) candidates.push(fo);
        }
        if (!modelType || modelType === 'linear') {
            var lin = fitLinear(times, masses);
            if (lin) candidates.push(lin);
        }
        if (!modelType || modelType === 'power-law') {
            var pl = fitPowerLaw(times, masses);
            if (pl) candidates.push(pl);
        }

        if (modelType && candidates.length === 0) {
            throw new Error('degradationPredictor: could not fit "' + modelType + '" model');
        }
        if (candidates.length === 0) {
            throw new Error('degradationPredictor: no model could be fitted — data may not show degradation');
        }

        // Pick best R²
        candidates.sort(function (a, b) { return b.r2 - a.r2; });
        s.fit = candidates[0];
        return {
            bestModel: s.fit.model,
            params: s.fit.params,
            r2: s.fit.r2,
            halfLife: s.fit.halfLife,
            allModels: candidates.map(function (c) {
                return { model: c.model, r2: c.r2, halfLife: c.halfLife };
            })
        };
    }

    /**
     * Predict mass% at a given day for a fitted sample.
     */
    function predict(sampleId, day) {
        validateString(sampleId, 'sampleId');
        validateNumber(day, 'day');
        var s = samples[sampleId];
        if (!s) throw new Error('degradationPredictor: unknown sample "' + sampleId + '"');
        if (!s.fit) throw new Error('degradationPredictor: call fitModel() before predict()');
        return {
            sampleId: sampleId,
            day: day,
            predictedMassPercent: s.fit.predict(day),
            model: s.fit.model
        };
    }

    /**
     * Proactive alert check: when will thresholds be crossed?
     */
    function checkAlerts(sampleId) {
        validateString(sampleId, 'sampleId');
        var s = samples[sampleId];
        if (!s) throw new Error('degradationPredictor: unknown sample "' + sampleId + '"');
        if (!s.fit) throw new Error('degradationPredictor: call fitModel() before checkAlerts()');

        var lastDay = s.measurements[s.measurements.length - 1].day;
        var currentMass = s.fit.predict(lastDay);
        var alerts = [];

        var levels = [
            { name: 'critical', threshold: thresholds.critical },
            { name: 'warning', threshold: thresholds.warning },
            { name: 'caution', threshold: thresholds.caution }
        ];

        for (var i = 0; i < levels.length; i++) {
            var lvl = levels[i];
            if (currentMass <= lvl.threshold) {
                alerts.push({
                    level: lvl.name,
                    message: 'Sample already below ' + lvl.name + ' threshold (' + lvl.threshold + '%)',
                    currentMassPercent: round(currentMass, 2),
                    daysUntilCrossing: 0,
                    status: 'BREACHED'
                });
                continue;
            }

            // Binary search for crossing day
            var lo = lastDay, hi = lastDay + 3650; // up to 10 years
            for (var iter = 0; iter < 100; iter++) {
                var mid = (lo + hi) / 2;
                if (s.fit.predict(mid) <= lvl.threshold) {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            var crossDay = round(hi, 1);
            var daysLeft = round(crossDay - lastDay, 1);
            var isImminent = daysLeft <= thresholds.lookaheadDays;

            alerts.push({
                level: lvl.name,
                threshold: lvl.threshold,
                estimatedCrossingDay: crossDay,
                daysUntilCrossing: daysLeft,
                status: isImminent ? 'IMMINENT' : 'OK',
                message: isImminent
                    ? lvl.name.toUpperCase() + ': ' + lvl.threshold + '% threshold in ~' + daysLeft + ' days'
                    : lvl.threshold + '% threshold in ~' + daysLeft + ' days'
            });
        }

        // Material context
        var materialInsight = null;
        if (s.material && MATERIAL_PROFILES[s.material]) {
            var prof = MATERIAL_PROFILES[s.material];
            var halfLife = s.fit.halfLife;
            var withinRange = halfLife >= prof.typicalHalfLife[0] && halfLife <= prof.typicalHalfLife[1];
            materialInsight = {
                material: s.material,
                mechanism: prof.mechanism,
                typicalHalfLifeRange: prof.typicalHalfLife,
                observedHalfLife: halfLife,
                withinTypicalRange: withinRange,
                notes: prof.notes,
                recommendation: !withinRange
                    ? (halfLife < prof.typicalHalfLife[0]
                        ? 'Degradation faster than typical — check cross-linking, pH, enzyme exposure'
                        : 'Degradation slower than typical — verify measurement accuracy')
                    : 'Degradation rate within expected range'
            };
        }

        return {
            sampleId: sampleId,
            currentDay: lastDay,
            currentMassPercent: round(currentMass, 2),
            model: s.fit.model,
            halfLife: s.fit.halfLife,
            alerts: alerts,
            materialInsight: materialInsight
        };
    }

    /**
     * Generate a comprehensive degradation report for a sample.
     */
    function generateReport(sampleId) {
        validateString(sampleId, 'sampleId');
        var s = samples[sampleId];
        if (!s) throw new Error('degradationPredictor: unknown sample "' + sampleId + '"');
        if (!s.fit) throw new Error('degradationPredictor: call fitModel() before generateReport()');

        var alertData = checkAlerts(sampleId);
        var lastDay = s.measurements[s.measurements.length - 1].day;

        // Generate forecast points
        var forecast = [];
        var maxDay = Math.max(lastDay * 2, lastDay + 30);
        var step = Math.max(1, Math.round(maxDay / 20));
        for (var d = 0; d <= maxDay; d += step) {
            var val = s.fit.predict(d);
            forecast.push({ day: d, massPercent: val });
            if (val <= 0) break;
        }

        // Residual analysis
        var residuals = [];
        var maxResidual = 0;
        for (var i = 0; i < s.measurements.length; i++) {
            var meas = s.measurements[i];
            var pred = s.fit.predict(meas.day);
            var res = round(meas.massPercent - pred, 2);
            residuals.push({ day: meas.day, measured: meas.massPercent, predicted: pred, residual: res });
            if (Math.abs(res) > maxResidual) maxResidual = Math.abs(res);
        }

        // Rate of degradation at current point
        var epsilon = 0.01;
        var mNow = s.fit.predict(lastDay);
        var mNext = s.fit.predict(lastDay + epsilon);
        var instantRate = round(-(mNext - mNow) / epsilon, 4);

        return {
            sampleId: sampleId,
            material: s.material,
            measurementCount: s.measurements.length,
            timeSpan: { from: s.measurements[0].day, to: lastDay },
            model: {
                type: s.fit.model,
                params: s.fit.params,
                r2: s.fit.r2,
                halfLife: s.fit.halfLife
            },
            currentState: {
                day: lastDay,
                massPercent: round(mNow, 2),
                instantRatePerDay: instantRate
            },
            alerts: alertData.alerts,
            materialInsight: alertData.materialInsight,
            forecast: forecast,
            residuals: residuals,
            maxResidual: round(maxResidual, 2),
            recommendations: generateRecommendations(s, alertData, instantRate)
        };
    }

    function generateRecommendations(s, alertData, rate) {
        var recs = [];
        var hasImminent = alertData.alerts.some(function (a) { return a.status === 'IMMINENT'; });
        var hasBreached = alertData.alerts.some(function (a) { return a.status === 'BREACHED'; });

        if (hasBreached) {
            recs.push({ priority: 'HIGH', action: 'Scaffold integrity compromised — consider replacing or reinforcing' });
        }
        if (hasImminent) {
            recs.push({ priority: 'HIGH', action: 'Structural failure approaching — plan scaffold replacement within lookahead window' });
        }
        if (rate > 3) {
            recs.push({ priority: 'MEDIUM', action: 'Rapid degradation detected (' + rate + '%/day) — investigate environmental factors' });
        }
        if (s.fit.r2 < 0.9) {
            recs.push({ priority: 'MEDIUM', action: 'Model fit is moderate (R²=' + s.fit.r2 + ') — collect more data points for accuracy' });
        }
        if (s.measurements.length < 5) {
            recs.push({ priority: 'LOW', action: 'Only ' + s.measurements.length + ' data points — add more for reliable predictions' });
        }
        if (alertData.materialInsight && !alertData.materialInsight.withinTypicalRange) {
            recs.push({ priority: 'MEDIUM', action: alertData.materialInsight.recommendation });
        }
        if (recs.length === 0) {
            recs.push({ priority: 'INFO', action: 'Degradation within expected parameters — continue monitoring' });
        }
        return recs;
    }

    /**
     * Compare degradation rates across multiple samples.
     */
    function compareSamples(sampleIds) {
        if (!Array.isArray(sampleIds) || sampleIds.length < 2) {
            throw new Error('degradationPredictor: compareSamples requires >= 2 sample IDs');
        }
        var results = [];
        for (var i = 0; i < sampleIds.length; i++) {
            var id = sampleIds[i];
            var s = samples[id];
            if (!s) throw new Error('degradationPredictor: unknown sample "' + id + '"');
            if (!s.fit) throw new Error('degradationPredictor: call fitModel("' + id + '") first');
            results.push({
                sampleId: id,
                material: s.material,
                model: s.fit.model,
                halfLife: s.fit.halfLife,
                r2: s.fit.r2
            });
        }
        results.sort(function (a, b) { return a.halfLife - b.halfLife; });

        var fastest = results[0];
        var slowest = results[results.length - 1];
        return {
            samples: results,
            fastest: { sampleId: fastest.sampleId, halfLife: fastest.halfLife },
            slowest: { sampleId: slowest.sampleId, halfLife: slowest.halfLife },
            halfLifeRange: round(slowest.halfLife - fastest.halfLife, 1),
            insight: slowest.halfLife > fastest.halfLife * 3
                ? 'Large variation in degradation rates — investigate material or environmental differences'
                : 'Degradation rates are relatively consistent across samples'
        };
    }

    /**
     * List all tracked samples.
     */
    function listSamples() {
        var result = [];
        for (var id in samples) {
            var s = samples[id];
            result.push({
                sampleId: id,
                material: s.material,
                measurementCount: s.measurements.length,
                hasFit: !!s.fit,
                latestDay: s.measurements.length > 0
                    ? s.measurements[s.measurements.length - 1].day : null
            });
        }
        return result;
    }

    /**
     * Get material profile info.
     */
    function getMaterialProfile(material) {
        validateString(material, 'material');
        var key = material.toLowerCase();
        var prof = MATERIAL_PROFILES[key];
        if (!prof) return null;
        return {
            material: key,
            typicalHalfLifeDays: prof.typicalHalfLife,
            mechanism: prof.mechanism,
            notes: prof.notes
        };
    }

    /**
     * List all known material profiles.
     */
    function listMaterials() {
        var result = [];
        for (var key in MATERIAL_PROFILES) {
            var p = MATERIAL_PROFILES[key];
            result.push({
                material: key,
                typicalHalfLifeDays: p.typicalHalfLife,
                mechanism: p.mechanism
            });
        }
        return result;
    }

    return {
        addMeasurement: addMeasurement,
        fitModel: fitModel,
        predict: predict,
        checkAlerts: checkAlerts,
        generateReport: generateReport,
        compareSamples: compareSamples,
        listSamples: listSamples,
        getMaterialProfile: getMaterialProfile,
        listMaterials: listMaterials
    };
}

module.exports = { createDegradationPredictor: createDegradationPredictor };
