'use strict';

var mod = require('../docs/shared/mycoplasmaTest');

describe('MycoplasmaTestLogger', function () {
    var logger;

    beforeEach(function () {
        logger = mod.createMycoplasmaTestLogger({ testIntervalDays: 30 });
    });

    test('logs a negative test', function () {
        var r = logger.logTest({ cellLine: 'HeLa', method: 'PCR', result: 'negative', date: '2026-03-01', operator: 'JD' });
        expect(r.id).toBe(1);
        expect(r.cellLine).toBe('HeLa');
        expect(r.result).toBe('negative');
    });

    test('rejects invalid method', function () {
        expect(function () {
            logger.logTest({ cellLine: 'HeLa', method: 'magic', result: 'negative', date: '2026-03-01' });
        }).toThrow(/method must be one of/);
    });

    test('rejects missing cellLine', function () {
        expect(function () {
            logger.logTest({ method: 'PCR', result: 'negative', date: '2026-03-01' });
        }).toThrow(/cellLine is required/);
    });

    test('quarantines on positive result', function () {
        logger.logTest({ cellLine: 'HEK293', method: 'MycoAlert', result: 'positive', date: '2026-03-10', operator: 'AS' });
        var q = logger.getQuarantined();
        expect(q.length).toBe(1);
        expect(q[0].cellLine).toBe('HEK293');
    });

    test('releases quarantine after 2 consecutive negatives', function () {
        logger.logTest({ cellLine: 'HEK293', method: 'PCR', result: 'positive', date: '2026-03-01' });
        expect(logger.getQuarantined().length).toBe(1);
        logger.logTest({ cellLine: 'HEK293', method: 'PCR', result: 'negative', date: '2026-03-08' });
        expect(logger.getQuarantined().length).toBe(1); // still quarantined after 1 negative
        logger.logTest({ cellLine: 'HEK293', method: 'PCR', result: 'negative', date: '2026-03-15' });
        expect(logger.getQuarantined().length).toBe(0); // released after 2 negatives
    });

    test('detects overdue cell lines', function () {
        logger.logTest({ cellLine: 'HeLa', method: 'PCR', result: 'negative', date: '2026-01-01' });
        var overdue = logger.getOverdue('2026-03-29');
        expect(overdue.length).toBe(1);
        expect(overdue[0].cellLine).toBe('HeLa');
        expect(overdue[0].daysOverdue).toBeGreaterThan(0);
    });

    test('compliance report includes stats', function () {
        logger.logTest({ cellLine: 'HeLa', method: 'PCR', result: 'negative', date: '2026-03-25' });
        logger.logTest({ cellLine: 'MCF7', method: 'PCR', result: 'negative', date: '2026-01-01' });
        var report = logger.complianceReport('2026-03-29');
        expect(report.totalCellLines).toBe(2);
        expect(report.compliantCount).toBe(1);
        expect(report.overdueCount).toBe(1);
    });

    test('exports as CSV', function () {
        logger.logTest({ cellLine: 'HeLa', method: 'PCR', result: 'negative', date: '2026-03-01', operator: 'JD' });
        var csv = logger.exportRecords('csv');
        expect(csv).toContain('id,cellLine,method');
        expect(csv).toContain('HeLa');
    });

    test('getHistory filters by cell line', function () {
        logger.logTest({ cellLine: 'HeLa', method: 'PCR', result: 'negative', date: '2026-03-01' });
        logger.logTest({ cellLine: 'MCF7', method: 'PCR', result: 'negative', date: '2026-03-02' });
        expect(logger.getHistory('HeLa').length).toBe(1);
        expect(logger.getHistory().length).toBe(2);
    });

    test('getCellLines returns summary', function () {
        logger.logTest({ cellLine: 'HeLa', method: 'PCR', result: 'negative', date: '2026-03-01' });
        logger.logTest({ cellLine: 'HeLa', method: 'PCR', result: 'negative', date: '2026-03-15' });
        var lines = logger.getCellLines();
        expect(lines.HeLa.tests).toBe(2);
        expect(lines.HeLa.lastResult).toBe('negative');
    });
});
