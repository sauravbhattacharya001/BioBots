'use strict';

/**
 * Tests for docs/shared/degradationPredictor.js
 *
 * Covers kinetic-model fitting (first-order, linear, power-law),
 * prediction, proactive threshold alerts, material insight, multi-sample
 * comparison, and report generation.
 */

const { createDegradationPredictor } = require('../docs/shared/degradationPredictor');

// Helper: build a sample with exponential decay (first-order) data points.
function seedFirstOrder(pred, id, material, k, days, M0) {
    M0 = M0 || 100;
    days.forEach(function (d) {
        pred.addMeasurement({
            sampleId: id,
            day: d,
            massPercent: M0 * Math.exp(-k * d),
            material: material
        });
    });
}

// Helper: linear decay.
function seedLinear(pred, id, rate, days, M0) {
    M0 = M0 || 100;
    days.forEach(function (d) {
        pred.addMeasurement({
            sampleId: id,
            day: d,
            massPercent: Math.max(0, M0 - rate * d)
        });
    });
}

describe('createDegradationPredictor', () => {
    let pred;

    beforeEach(() => {
        pred = createDegradationPredictor();
    });

    describe('factory & defaults', () => {
        it('returns an API object with the documented surface', () => {
            const api = createDegradationPredictor();
            ['addMeasurement', 'fitModel', 'predict', 'checkAlerts',
                'generateReport', 'compareSamples', 'listSamples',
                'getMaterialProfile', 'listMaterials'
            ].forEach((m) => expect(typeof api[m]).toBe('function'));
        });

        it('accepts custom thresholds via options', () => {
            const p = createDegradationPredictor({
                thresholds: { critical: 10, warning: 30, caution: 50, lookaheadDays: 5 }
            });
            seedFirstOrder(p, 'S1', 'alginate', 0.05, [0, 7, 14, 21]);
            p.fitModel('S1');
            const alerts = p.checkAlerts('S1');
            const critical = alerts.alerts.find((a) => a.level === 'critical');
            expect(critical.threshold).toBe(10);
        });

        it('listMaterials returns the catalog of known profiles', () => {
            const materials = pred.listMaterials();
            expect(materials.length).toBeGreaterThanOrEqual(5);
            const names = materials.map((m) => m.material);
            expect(names).toEqual(expect.arrayContaining(['alginate', 'gelatin', 'collagen']));
            materials.forEach((m) => {
                expect(Array.isArray(m.typicalHalfLifeDays)).toBe(true);
                expect(m.typicalHalfLifeDays.length).toBe(2);
                expect(typeof m.mechanism).toBe('string');
            });
        });

        it('getMaterialProfile returns null for unknown materials', () => {
            expect(pred.getMaterialProfile('unobtainium')).toBeNull();
        });

        it('getMaterialProfile is case-insensitive', () => {
            const a = pred.getMaterialProfile('ALGINATE');
            expect(a).not.toBeNull();
            expect(a.material).toBe('alginate');
            expect(a.mechanism).toMatch(/ionic|dissolution/);
        });

        it('getMaterialProfile validates input', () => {
            expect(() => pred.getMaterialProfile('')).toThrow(/non-empty string/);
            expect(() => pred.getMaterialProfile(42)).toThrow(/non-empty string/);
        });
    });

    describe('addMeasurement', () => {
        it('validates required fields', () => {
            expect(() => pred.addMeasurement({ day: 0, massPercent: 100 })).toThrow(/sampleId/);
            expect(() => pred.addMeasurement({ sampleId: 'S1', massPercent: 100 })).toThrow(/day/);
            expect(() => pred.addMeasurement({ sampleId: 'S1', day: 0 })).toThrow(/massPercent/);
        });

        it('rejects negative day', () => {
            expect(() => pred.addMeasurement({ sampleId: 'S1', day: -1, massPercent: 100 }))
                .toThrow(/day must be >= 0/);
        });

        it('rejects out-of-range massPercent', () => {
            expect(() => pred.addMeasurement({ sampleId: 'S1', day: 0, massPercent: -5 }))
                .toThrow(/0-150/);
            expect(() => pred.addMeasurement({ sampleId: 'S1', day: 0, massPercent: 200 }))
                .toThrow(/0-150/);
        });

        it('rejects non-numeric values', () => {
            expect(() => pred.addMeasurement({ sampleId: 'S1', day: NaN, massPercent: 100 }))
                .toThrow(/finite number/);
            expect(() => pred.addMeasurement({ sampleId: 'S1', day: 0, massPercent: Infinity }))
                .toThrow(/finite number/);
        });

        it('keeps measurements sorted by day', () => {
            pred.addMeasurement({ sampleId: 'S1', day: 14, massPercent: 50 });
            pred.addMeasurement({ sampleId: 'S1', day: 0, massPercent: 100 });
            pred.addMeasurement({ sampleId: 'S1', day: 7, massPercent: 75 });
            // Verify via fitting which requires sorted input order indirectly
            const fit = pred.fitModel('S1');
            expect(fit.r2).toBeGreaterThan(0);
        });

        it('lowercases and remembers material', () => {
            pred.addMeasurement({ sampleId: 'S1', day: 0, massPercent: 100, material: 'Alginate' });
            const list = pred.listSamples();
            expect(list[0].material).toBe('alginate');
        });
    });

    describe('fitModel', () => {
        it('throws when sample is unknown', () => {
            expect(() => pred.fitModel('missing')).toThrow(/unknown sample/);
        });

        it('requires at least 3 measurements', () => {
            pred.addMeasurement({ sampleId: 'S1', day: 0, massPercent: 100 });
            pred.addMeasurement({ sampleId: 'S1', day: 7, massPercent: 80 });
            expect(() => pred.fitModel('S1')).toThrow(/>= 3 measurements/);
        });

        it('fits first-order kinetics to exponential decay with high R²', () => {
            seedFirstOrder(pred, 'S1', 'alginate', 0.05, [0, 7, 14, 21, 28]);
            const fit = pred.fitModel('S1');
            expect(fit.bestModel).toBe('first-order');
            expect(fit.r2).toBeGreaterThan(0.99);
            // k=0.05/day → half-life ≈ ln(2)/0.05 ≈ 13.86
            expect(fit.halfLife).toBeGreaterThan(13);
            expect(fit.halfLife).toBeLessThan(15);
        });

        it('fits linear kinetics when data is linear', () => {
            seedLinear(pred, 'S1', 2, [0, 5, 10, 15, 20, 25]);
            const fit = pred.fitModel('S1', 'linear');
            expect(fit.bestModel).toBe('linear');
            expect(fit.params.rate).toBeGreaterThan(1.9);
            expect(fit.params.rate).toBeLessThan(2.1);
            expect(fit.r2).toBeGreaterThan(0.99);
        });

        it('reports all candidate models when modelType is not specified', () => {
            seedFirstOrder(pred, 'S1', 'alginate', 0.04, [0, 7, 14, 21, 28]);
            const fit = pred.fitModel('S1');
            expect(Array.isArray(fit.allModels)).toBe(true);
            expect(fit.allModels.length).toBeGreaterThanOrEqual(1);
            fit.allModels.forEach((m) => {
                expect(typeof m.model).toBe('string');
                expect(typeof m.r2).toBe('number');
            });
        });

        it('throws when requested model type cannot be fitted', () => {
            // Constant (non-degrading) mass - first-order cannot produce k>0
            pred.addMeasurement({ sampleId: 'C', day: 0, massPercent: 100 });
            pred.addMeasurement({ sampleId: 'C', day: 5, massPercent: 100 });
            pred.addMeasurement({ sampleId: 'C', day: 10, massPercent: 100 });
            expect(() => pred.fitModel('C', 'first-order'))
                .toThrow(/could not fit "first-order"/);
        });

        it('throws when no model can be fitted to non-degrading data', () => {
            pred.addMeasurement({ sampleId: 'C', day: 0, massPercent: 100 });
            pred.addMeasurement({ sampleId: 'C', day: 5, massPercent: 100 });
            pred.addMeasurement({ sampleId: 'C', day: 10, massPercent: 100 });
            expect(() => pred.fitModel('C')).toThrow(/no model could be fitted/);
        });

        it('invalidates cached fit when a new measurement is added', () => {
            seedFirstOrder(pred, 'S1', 'alginate', 0.05, [0, 7, 14]);
            pred.fitModel('S1');
            // Adding a new point should require re-fitting before predict()
            pred.addMeasurement({ sampleId: 'S1', day: 21, massPercent: 50 });
            expect(() => pred.predict('S1', 30)).toThrow(/call fitModel/);
        });
    });

    describe('predict', () => {
        it('throws if fitModel was not called', () => {
            pred.addMeasurement({ sampleId: 'S1', day: 0, massPercent: 100 });
            pred.addMeasurement({ sampleId: 'S1', day: 7, massPercent: 80 });
            pred.addMeasurement({ sampleId: 'S1', day: 14, massPercent: 65 });
            expect(() => pred.predict('S1', 30)).toThrow(/call fitModel/);
        });

        it('predicts mass% near actual exponential decay', () => {
            seedFirstOrder(pred, 'S1', 'alginate', 0.05, [0, 7, 14, 21, 28]);
            pred.fitModel('S1');
            const out = pred.predict('S1', 30);
            const expected = 100 * Math.exp(-0.05 * 30);
            expect(out.predictedMassPercent).toBeGreaterThan(expected - 1);
            expect(out.predictedMassPercent).toBeLessThan(expected + 1);
            expect(out.sampleId).toBe('S1');
            expect(out.day).toBe(30);
            expect(typeof out.model).toBe('string');
        });

        it('validates day argument', () => {
            seedFirstOrder(pred, 'S1', 'alginate', 0.05, [0, 7, 14]);
            pred.fitModel('S1');
            expect(() => pred.predict('S1', 'not a number')).toThrow(/finite number/);
        });
    });

    describe('checkAlerts', () => {
        it('reports BREACHED when current mass already crossed a threshold', () => {
            seedLinear(pred, 'S1', 10, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
            // M(8) = 100 - 10*8 = 20 → at critical threshold
            pred.fitModel('S1');
            const out = pred.checkAlerts('S1');
            const critical = out.alerts.find((a) => a.level === 'critical');
            expect(critical.status).toBe('BREACHED');
            expect(critical.daysUntilCrossing).toBe(0);
        });

        it('flags IMMINENT alerts within the lookahead window', () => {
            // Linear at 5%/day, last day=10 (mass=50) → caution(60) breached, warning(40) in 2 days
            const p = createDegradationPredictor({
                thresholds: { critical: 20, warning: 40, caution: 60, lookaheadDays: 7 }
            });
            seedLinear(p, 'S1', 5, [0, 2, 4, 6, 8, 10]);
            p.fitModel('S1');
            const out = p.checkAlerts('S1');
            const warning = out.alerts.find((a) => a.level === 'warning');
            expect(warning.status).toBe('IMMINENT');
            expect(warning.daysUntilCrossing).toBeGreaterThan(0);
            expect(warning.daysUntilCrossing).toBeLessThanOrEqual(7);
            expect(warning.message).toMatch(/WARNING/);
        });

        it('marks distant thresholds as OK', () => {
            // Slow decay - first-order with small k, lookahead 14
            seedFirstOrder(pred, 'S1', 'alginate', 0.005, [0, 5, 10, 15, 20]);
            pred.fitModel('S1');
            const out = pred.checkAlerts('S1');
            const critical = out.alerts.find((a) => a.level === 'critical');
            expect(critical.status).toBe('OK');
            expect(critical.daysUntilCrossing).toBeGreaterThan(14);
        });

        it('returns a materialInsight when material is known', () => {
            seedFirstOrder(pred, 'S1', 'alginate', 0.03, [0, 7, 14, 21]);
            pred.fitModel('S1');
            const out = pred.checkAlerts('S1');
            expect(out.materialInsight).toBeTruthy();
            expect(out.materialInsight.material).toBe('alginate');
            expect(typeof out.materialInsight.mechanism).toBe('string');
            expect(Array.isArray(out.materialInsight.typicalHalfLifeRange)).toBe(true);
            expect(typeof out.materialInsight.withinTypicalRange).toBe('boolean');
            expect(typeof out.materialInsight.recommendation).toBe('string');
        });

        it('omits materialInsight when material is unset', () => {
            seedLinear(pred, 'S1', 2, [0, 5, 10, 15, 20]);
            pred.fitModel('S1');
            const out = pred.checkAlerts('S1');
            expect(out.materialInsight).toBeNull();
        });

        it('flags faster-than-typical degradation for known material', () => {
            // Alginate typical half-life [14, 42]; force k very high → half-life < 14
            seedFirstOrder(pred, 'F', 'alginate', 0.2, [0, 2, 4, 6, 8]);
            pred.fitModel('F');
            const out = pred.checkAlerts('F');
            expect(out.materialInsight.withinTypicalRange).toBe(false);
            expect(out.materialInsight.recommendation).toMatch(/faster than typical/);
        });

        it('throws if fitModel was not called', () => {
            pred.addMeasurement({ sampleId: 'S1', day: 0, massPercent: 100 });
            pred.addMeasurement({ sampleId: 'S1', day: 5, massPercent: 80 });
            pred.addMeasurement({ sampleId: 'S1', day: 10, massPercent: 65 });
            expect(() => pred.checkAlerts('S1')).toThrow(/call fitModel/);
        });
    });

    describe('generateReport', () => {
        it('produces a structured report with all sections', () => {
            seedFirstOrder(pred, 'S1', 'alginate', 0.05, [0, 7, 14, 21, 28]);
            pred.fitModel('S1');
            const rep = pred.generateReport('S1');

            expect(rep.sampleId).toBe('S1');
            expect(rep.material).toBe('alginate');
            expect(rep.measurementCount).toBe(5);
            expect(rep.timeSpan).toEqual({ from: 0, to: 28 });
            expect(rep.model.r2).toBeGreaterThan(0.99);
            expect(rep.currentState.day).toBe(28);
            expect(typeof rep.currentState.instantRatePerDay).toBe('number');
            expect(Array.isArray(rep.alerts)).toBe(true);
            expect(Array.isArray(rep.forecast)).toBe(true);
            expect(rep.forecast.length).toBeGreaterThan(5);
            rep.forecast.forEach((pt) => {
                expect(typeof pt.day).toBe('number');
                expect(typeof pt.massPercent).toBe('number');
            });
            expect(Array.isArray(rep.residuals)).toBe(true);
            expect(rep.residuals.length).toBe(5);
            expect(typeof rep.maxResidual).toBe('number');
            expect(Array.isArray(rep.recommendations)).toBe(true);
            expect(rep.recommendations.length).toBeGreaterThan(0);
        });

        it('flags breached thresholds in recommendations', () => {
            // Aggressive linear decay -> already below critical at last measurement
            seedLinear(pred, 'S1', 12, [0, 2, 4, 6, 8]);
            pred.fitModel('S1');
            const rep = pred.generateReport('S1');
            const high = rep.recommendations.filter((r) => r.priority === 'HIGH');
            expect(high.length).toBeGreaterThan(0);
            expect(high.some((r) => /compromised|approaching/i.test(r.action))).toBe(true);
        });

        it('flags rapid degradation in recommendations', () => {
            seedLinear(pred, 'S1', 8, [0, 2, 4, 6]); // 8%/day > 3 threshold
            pred.fitModel('S1');
            const rep = pred.generateReport('S1');
            expect(rep.recommendations.some((r) => /Rapid degradation/i.test(r.action))).toBe(true);
        });

        it('flags sparse data with low priority recommendation', () => {
            seedFirstOrder(pred, 'S1', 'alginate', 0.04, [0, 7, 14]);
            pred.fitModel('S1');
            const rep = pred.generateReport('S1');
            expect(rep.recommendations.some((r) =>
                r.priority === 'LOW' && /data points/i.test(r.action))).toBe(true);
        });

        it('residuals match measured-minus-predicted', () => {
            seedFirstOrder(pred, 'S1', 'alginate', 0.04, [0, 10, 20, 30]);
            pred.fitModel('S1');
            const rep = pred.generateReport('S1');
            rep.residuals.forEach((r) => {
                expect(r.residual).toBeCloseTo(r.measured - r.predicted, 1);
            });
        });
    });

    describe('compareSamples', () => {
        it('throws on fewer than two sample IDs', () => {
            expect(() => pred.compareSamples([])).toThrow(/>= 2 sample IDs/);
            expect(() => pred.compareSamples(['only'])).toThrow(/>= 2 sample IDs/);
            expect(() => pred.compareSamples('S1')).toThrow(/>= 2 sample IDs/);
        });

        it('throws on unknown sample ID', () => {
            seedFirstOrder(pred, 'A', 'alginate', 0.05, [0, 7, 14]);
            pred.fitModel('A');
            expect(() => pred.compareSamples(['A', 'B'])).toThrow(/unknown sample/);
        });

        it('throws when one sample has no fit yet', () => {
            seedFirstOrder(pred, 'A', 'alginate', 0.05, [0, 7, 14]);
            seedFirstOrder(pred, 'B', 'gelatin', 0.10, [0, 7, 14]);
            pred.fitModel('A');
            // B not fitted
            expect(() => pred.compareSamples(['A', 'B'])).toThrow(/call fitModel/);
        });

        it('ranks samples by half-life ascending', () => {
            seedFirstOrder(pred, 'A', 'alginate', 0.02, [0, 7, 14, 21]); // slow
            seedFirstOrder(pred, 'B', 'gelatin',  0.10, [0, 7, 14, 21]); // fast
            seedFirstOrder(pred, 'C', 'collagen', 0.05, [0, 7, 14, 21]); // medium
            pred.fitModel('A'); pred.fitModel('B'); pred.fitModel('C');
            const out = pred.compareSamples(['A', 'B', 'C']);
            expect(out.fastest.sampleId).toBe('B');
            expect(out.slowest.sampleId).toBe('A');
            expect(out.halfLifeRange).toBeGreaterThan(0);
            expect(out.samples[0].sampleId).toBe('B');
            expect(typeof out.insight).toBe('string');
        });

        it('insight flags large variation', () => {
            seedFirstOrder(pred, 'A', 'alginate', 0.005, [0, 30, 60, 90]); // very slow
            seedFirstOrder(pred, 'B', 'gelatin',  0.20,  [0, 1, 2, 3]);     // very fast
            pred.fitModel('A'); pred.fitModel('B');
            const out = pred.compareSamples(['A', 'B']);
            expect(out.insight).toMatch(/Large variation/);
        });
    });

    describe('listSamples', () => {
        it('returns empty array initially', () => {
            expect(pred.listSamples()).toEqual([]);
        });

        it('summarizes tracked samples', () => {
            pred.addMeasurement({ sampleId: 'X', day: 0, massPercent: 100, material: 'gelatin' });
            pred.addMeasurement({ sampleId: 'X', day: 5, massPercent: 80 });
            pred.addMeasurement({ sampleId: 'X', day: 10, massPercent: 65 });
            pred.addMeasurement({ sampleId: 'Y', day: 0, massPercent: 100 });

            const list = pred.listSamples();
            expect(list.length).toBe(2);
            const x = list.find((s) => s.sampleId === 'X');
            expect(x.measurementCount).toBe(3);
            expect(x.material).toBe('gelatin');
            expect(x.latestDay).toBe(10);
            expect(x.hasFit).toBe(false);

            pred.fitModel('X');
            expect(pred.listSamples().find((s) => s.sampleId === 'X').hasFit).toBe(true);
        });
    });
});
