'use strict';

var freezeThaw = require('../docs/shared/freezeThaw');

describe('Freeze-Thaw Cycle Tracker', function () {
    var tracker;

    beforeEach(function () {
        tracker = freezeThaw.createFreezeThawTracker();
    });

    describe('addSample', function () {
        it('should add a new sample', function () {
            var result = tracker.addSample({ id: 'S-001', cellType: 'MSC', initialViability: 95 });
            expect(result.id).toBe('S-001');
            expect(result.status).toBe('active');
        });

        it('should throw on missing id', function () {
            expect(function () { tracker.addSample({}); }).toThrow(/id is required/);
        });

        it('should throw on duplicate id', function () {
            tracker.addSample({ id: 'S-001', cellType: 'MSC', initialViability: 95 });
            expect(function () { tracker.addSample({ id: 'S-001', cellType: 'MSC', initialViability: 90 }); }).toThrow(/already exists/);
        });

        it('should reject viability out of range', function () {
            expect(function () { tracker.addSample({ id: 'S-002', initialViability: 120 }); }).toThrow(/between 0 and 100/);
        });

        it('should use default model for unknown cell type', function () {
            var result = tracker.addSample({ id: 'S-003', cellType: 'alien', initialViability: 90 });
            expect(result.model.maxCycles).toBe(5);
        });
    });

    describe('recordThaw', function () {
        beforeEach(function () {
            tracker.addSample({ id: 'S-001', cellType: 'MSC', initialViability: 95 });
        });

        it('should record a thaw cycle', function () {
            var result = tracker.recordThaw('S-001', { viability: 89 });
            expect(result.cycle).toBe(1);
            expect(result.viabilityDrop).toBe(6);
            expect(result.status).toBe('active');
        });

        it('should warn when below threshold', function () {
            tracker.recordThaw('S-001', { viability: 75 });
            var result = tracker.recordThaw('S-001', { viability: 68 });
            expect(result.status).toBe('warning');
            expect(result.warnings.length).toBeGreaterThan(0);
        });

        it('should recommend discard at max cycles', function () {
            for (var i = 0; i < 5; i++) {
                var v = 95 - (i + 1) * 4;
                tracker.recordThaw('S-001', { viability: v });
            }
            var report = tracker.getReport('S-001');
            expect(report.totalCycles).toBe(5);
        });

        it('should throw for unknown sample', function () {
            expect(function () { tracker.recordThaw('NOPE', { viability: 80 }); }).toThrow(/not found/);
        });

        it('should throw for discarded sample', function () {
            tracker.discardSample('S-001');
            expect(function () { tracker.recordThaw('S-001', { viability: 80 }); }).toThrow(/discarded/);
        });

        it('should flag critically low viability', function () {
            var result = tracker.recordThaw('S-001', { viability: 40 });
            expect(result.status).toBe('discard_recommended');
        });
    });

    describe('getReport', function () {
        it('should generate a complete report', function () {
            tracker.addSample({ id: 'S-001', cellType: 'HEK293', initialViability: 98, cryoprotectant: 'DMSO' });
            tracker.recordThaw('S-001', { viability: 95, recoveryRate: 0.9 });
            tracker.recordThaw('S-001', { viability: 91, recoveryRate: 0.85 });
            var report = tracker.getReport('S-001');
            expect(report.totalCycles).toBe(2);
            expect(report.totalViabilityLoss).toBe(7);
            expect(report.avgViabilityLossPerCycle).toBe(3.5);
            expect(report.cryoprotectant.agent).toBe('DMSO');
            expect(report.predictedCyclesRemaining).toBeGreaterThan(0);
            expect(report.recommendation).toContain('OK');
        });
    });

    describe('listSamples', function () {
        it('should list and filter samples', function () {
            tracker.addSample({ id: 'S-001', cellType: 'MSC', initialViability: 95 });
            tracker.addSample({ id: 'S-002', cellType: 'iPSC', initialViability: 92 });
            expect(tracker.listSamples().length).toBe(2);
            expect(tracker.listSamples({ cellType: 'MSC' }).length).toBe(1);
        });
    });

    describe('getSummary', function () {
        it('should return aggregate stats', function () {
            tracker.addSample({ id: 'S-001', cellType: 'MSC', initialViability: 95 });
            tracker.addSample({ id: 'S-002', cellType: 'iPSC', initialViability: 90 });
            tracker.recordThaw('S-001', { viability: 88 });
            var summary = tracker.getSummary();
            expect(summary.totalSamples).toBe(2);
            expect(summary.active).toBe(2);
            expect(summary.totalThawCycles).toBe(1);
        });
    });

    describe('discardSample', function () {
        it('should mark sample as discarded', function () {
            tracker.addSample({ id: 'S-001', cellType: 'MSC', initialViability: 95 });
            var result = tracker.discardSample('S-001', 'Expired');
            expect(result.status).toBe('discarded');
        });
    });

    describe('reference data', function () {
        it('should return cell types', function () {
            var types = tracker.getCellTypes();
            expect(types.MSC).toBeDefined();
            expect(types.MSC.maxCycles).toBe(5);
        });

        it('should return cryoprotectants', function () {
            var cpas = tracker.getCryoprotectants();
            expect(cpas.DMSO).toBeDefined();
            expect(cpas.DMSO.toxicityRisk).toBe('moderate');
        });
    });
});
