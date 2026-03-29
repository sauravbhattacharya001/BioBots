'use strict';

var assert = require('assert');
var mod = require('../docs/shared/printSessionLogger');

describe('PrintSessionLogger', function () {
    var logger;

    beforeEach(function () {
        logger = mod.createPrintSessionLogger();
    });

    describe('logSession', function () {
        it('creates a record with all fields', function () {
            var s = logger.logSession({
                material: 'alginate', nozzle: '27G', pressure: 12,
                temperature: 25, speed: 8, duration: 45,
                outcome: 'success', viability: 92, notes: 'clean',
                tags: ['test'], operator: 'Alice', scaffold: 'grid'
            });
            assert.ok(s.id.startsWith('ps-'));
            assert.strictEqual(s.material, 'alginate');
            assert.strictEqual(s.outcome, 'success');
            assert.strictEqual(s.viability, 92);
        });

        it('rejects missing material', function () {
            assert.throws(function () { logger.logSession({ outcome: 'success' }); }, /material/);
        });

        it('rejects invalid outcome', function () {
            assert.throws(function () { logger.logSession({ material: 'pcl', outcome: 'bad' }); }, /outcome/);
        });

        it('rejects viability out of range', function () {
            assert.throws(function () { logger.logSession({ material: 'pcl', outcome: 'success', viability: 150 }); }, /viability/);
        });
    });

    describe('query', function () {
        beforeEach(function () {
            logger.logSession({ material: 'alginate', outcome: 'success', viability: 90, duration: 30 });
            logger.logSession({ material: 'gelatin', outcome: 'failure', viability: 40, duration: 60 });
            logger.logSession({ material: 'alginate', outcome: 'partial', viability: 70, duration: 20 });
        });

        it('returns all without filters', function () {
            assert.strictEqual(logger.query().length, 3);
        });

        it('filters by material', function () {
            assert.strictEqual(logger.query({ material: 'alginate' }).length, 2);
        });

        it('filters by outcome', function () {
            assert.strictEqual(logger.query({ outcome: 'failure' }).length, 1);
        });

        it('filters by minViability', function () {
            assert.strictEqual(logger.query({ minViability: 80 }).length, 1);
        });

        it('respects limit', function () {
            assert.strictEqual(logger.query({}, { limit: 2 }).length, 2);
        });
    });

    describe('getStats', function () {
        it('returns zeros for empty', function () {
            var s = logger.getStats();
            assert.strictEqual(s.total, 0);
            assert.strictEqual(s.successRate, 0);
        });

        it('computes correct stats', function () {
            logger.logSession({ material: 'alginate', outcome: 'success', viability: 90, duration: 30 });
            logger.logSession({ material: 'alginate', outcome: 'failure', viability: 40, duration: 60 });
            var s = logger.getStats();
            assert.strictEqual(s.total, 2);
            assert.strictEqual(s.successRate, 50);
            assert.strictEqual(s.avgViability, 65);
        });
    });

    describe('getSuccessTrend', function () {
        it('buckets by day', function () {
            logger.logSession({ material: 'alginate', outcome: 'success' });
            logger.logSession({ material: 'alginate', outcome: 'failure' });
            var trend = logger.getSuccessTrend();
            assert.strictEqual(trend.length, 1);
            assert.strictEqual(trend[0].total, 2);
            assert.strictEqual(trend[0].successes, 1);
        });
    });

    describe('compare', function () {
        it('returns recommendation', function () {
            for (var i = 0; i < 4; i++) {
                logger.logSession({ material: 'alginate', outcome: 'success' });
                logger.logSession({ material: 'gelatin', outcome: 'failure' });
            }
            var c = logger.compare({ material: 'alginate' }, { material: 'gelatin' });
            assert.strictEqual(c.a.successRate, 100);
            assert.strictEqual(c.b.successRate, 0);
            assert.ok(c.recommendation.indexOf('Group A') >= 0);
        });
    });

    describe('updateSession', function () {
        it('updates notes', function () {
            var s = logger.logSession({ material: 'pcl', outcome: 'success' });
            var updated = logger.updateSession(s.id, { notes: 'new note' });
            assert.strictEqual(updated.notes, 'new note');
        });

        it('returns null for unknown id', function () {
            assert.strictEqual(logger.updateSession('nope', {}), null);
        });
    });

    describe('deleteSession', function () {
        it('removes session', function () {
            var s = logger.logSession({ material: 'pcl', outcome: 'success' });
            assert.strictEqual(logger.deleteSession(s.id), true);
            assert.strictEqual(logger.query().length, 0);
        });
    });

    describe('exportCSV', function () {
        it('produces valid CSV', function () {
            logger.logSession({ material: 'alginate', outcome: 'success', notes: 'has, comma' });
            var csv = logger.exportCSV();
            var lines = csv.split('\n');
            assert.strictEqual(lines.length, 2);
            assert.ok(lines[0].startsWith('id,'));
        });

        it('guards formula injection but preserves negative numbers', function () {
            logger.logSession({ material: 'alginate', outcome: 'success', pressure: -5, notes: '=SUM(A1)' });
            var csv = logger.exportCSV();
            var lines = csv.split('\n');
            var dataLine = lines[lines.length - 1];
            // Negative pressure should NOT be prefixed with '
            assert.ok(dataLine.indexOf("'-5") === -1, 'negative number should not be quote-prefixed');
            // Formula in notes should be prefixed
            assert.ok(dataLine.indexOf("'=SUM(A1)") >= 0, 'formula should be quote-prefixed');
        });
    });

    describe('bestParams', function () {
        it('finds highest viability success', function () {
            logger.logSession({ material: 'alginate', outcome: 'success', viability: 85 });
            logger.logSession({ material: 'alginate', outcome: 'success', viability: 95 });
            logger.logSession({ material: 'alginate', outcome: 'failure', viability: 99 });
            var best = logger.bestParams('alginate');
            assert.strictEqual(best.viability, 95);
        });

        it('returns null for unknown material', function () {
            assert.strictEqual(logger.bestParams('unknown'), null);
        });
    });
});
