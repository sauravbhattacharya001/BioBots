'use strict';

var mod = require('../docs/shared/flowCytometry');

describe('Flow Cytometry Analyzer', function () {
    var fc;
    beforeEach(function () { fc = mod.createFlowCytometryAnalyzer(); });

    describe('analyzePopulation', function () {
        it('returns statistics for event data', function () {
            var result = fc.analyzePopulation({ events: [10, 20, 30, 40, 50], channel: 'FITC' });
            expect(result.channel).toBe('FITC');
            expect(result.totalEvents).toBe(5);
            expect(result.mean).toBe(30);
            expect(result.median).toBe(30);
            expect(result.min).toBe(10);
            expect(result.max).toBe(50);
        });

        it('throws on empty events', function () {
            expect(function () { fc.analyzePopulation({ events: [] }); }).toThrow();
        });
    });

    describe('analyzeViability', function () {
        it('calculates viability percentage', function () {
            var result = fc.analyzeViability({ totalEvents: 1000, liveEvents: 950 });
            expect(result.viability).toBe(95);
            expect(result.qualityRating).toBe('Excellent');
        });

        it('flags poor viability', function () {
            var result = fc.analyzeViability({ totalEvents: 1000, liveEvents: 600 });
            expect(result.qualityRating).toBe('Critical');
            expect(result.recommendation).toContain('below 80%');
        });

        it('handles apoptotic populations', function () {
            var result = fc.analyzeViability({
                totalEvents: 1000, liveEvents: 800,
                earlyApoptotic: 100, lateApoptotic: 50,
            });
            expect(result.debris).toBe(50);
            expect(result.viability).toBe(80);
        });
    });

    describe('quadrantAnalysis', function () {
        it('separates events into four quadrants', function () {
            var result = fc.quadrantAnalysis({
                xValues: [10, 200, 10, 200],
                yValues: [10, 10, 200, 200],
                xThreshold: 100, yThreshold: 100,
            });
            expect(result.quadrants.Q1_doubleNeg.count).toBe(1);
            expect(result.quadrants.Q2_xPos.count).toBe(1);
            expect(result.quadrants.Q3_yPos.count).toBe(1);
            expect(result.quadrants.Q4_doublePos.count).toBe(1);
        });

        it('throws on mismatched arrays', function () {
            expect(function () {
                fc.quadrantAnalysis({ xValues: [1], yValues: [1, 2], xThreshold: 0, yThreshold: 0 });
            }).toThrow();
        });
    });

    describe('histogram', function () {
        it('bins events correctly', function () {
            var events = [];
            for (var i = 0; i < 100; i++) events.push(i);
            var result = fc.histogram({ events: events, bins: 10 });
            expect(result.bins.length).toBe(10);
            expect(result.totalEvents).toBe(100);
        });

        it('supports log scale', function () {
            var result = fc.histogram({ events: [1, 10, 100, 1000], bins: 4, logScale: true });
            expect(result.logScale).toBe(true);
        });
    });

    describe('calculateCompensation', function () {
        it('calculates spillover coefficient', function () {
            var result = fc.calculateCompensation({
                singleStainPrimary: [100, 200, 300, 400],
                singleStainSpillover: [10, 20, 30, 40],
            });
            expect(result.spilloverCoefficient).toBeDefined();
            expect(typeof result.spilloverPercent).toBe('number');
        });
    });

    describe('validatePanel', function () {
        it('validates a simple panel', function () {
            var result = fc.validatePanel(['FITC', 'PE', 'APC']);
            expect(result.valid).toBe(true);
            expect(result.laserCount).toBeGreaterThan(0);
            expect(result.panelComplexity).toBe('Simple');
        });

        it('detects emission overlap', function () {
            var result = fc.validatePanel(['FITC', 'Alexa Fluor 488']);
            expect(result.issues.length).toBeGreaterThan(0);
            expect(result.issues[0]).toContain('overlap');
        });

        it('flags unknown fluorochromes', function () {
            var result = fc.validatePanel(['FAKE-FLUOR']);
            expect(result.issues[0]).toContain('Unknown');
        });
    });

    describe('panels and fluorochromes', function () {
        it('lists available panels', function () {
            var panels = fc.listPanels();
            expect(panels).toContain('T-cell-basic');
            expect(panels).toContain('viability');
        });

        it('gets a panel config', function () {
            var panel = fc.getPanel('T-cell-basic');
            expect(panel.name).toBe('Basic T-Cell Panel');
            expect(panel.markers.length).toBeGreaterThan(0);
        });

        it('lists fluorochromes', function () {
            var fluors = fc.listFluorochromes();
            expect(fluors.length).toBeGreaterThan(10);
            expect(fluors[0]).toHaveProperty('excitation');
        });
    });
});
