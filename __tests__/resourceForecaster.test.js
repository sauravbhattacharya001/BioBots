'use strict';

var rfMod = require('../docs/shared/resourceForecaster');

describe('ResourceForecaster', function () {
    var rf;

    function makeResource(overrides) {
        return Object.assign({
            id: 'alg-1',
            name: 'Alginate 2%',
            category: 'bioink',
            currentStock: 500,
            unit: 'mL',
            reorderPoint: 100,
            reorderQuantity: 1000,
            leadTimeDays: 5,
            costPerUnit: 0.85
        }, overrides || {});
    }

    function dayMs(n) { return n * 86400000; }

    /** Record consumption events spread over past N days */
    function spreadConsumption(resourceId, qtyPerDay, days) {
        var now = Date.now();
        for (var d = days; d >= 1; d--) {
            rf.recordConsumption({
                resourceId: resourceId,
                quantity: qtyPerDay,
                timestamp: now - dayMs(d)
            });
        }
    }

    beforeEach(function () {
        rf = rfMod.createResourceForecaster();
    });

    // ── Registration ───────────────────────────────────────────────

    describe('registerResource', function () {
        it('registers a valid resource', function () {
            var res = rf.registerResource(makeResource());
            expect(res.id).toBe('alg-1');
            expect(res.currentStock).toBe(500);
        });

        it('rejects missing id', function () {
            expect(function () {
                rf.registerResource(makeResource({ id: '' }));
            }).toThrow(/id must be a non-empty string/);
        });

        it('rejects invalid category', function () {
            expect(function () {
                rf.registerResource(makeResource({ category: 'food' }));
            }).toThrow(/category must be one of/);
        });

        it('rejects negative stock', function () {
            expect(function () {
                rf.registerResource(makeResource({ currentStock: -1 }));
            }).toThrow(/non-negative/);
        });

        it('rejects non-object input', function () {
            expect(function () { rf.registerResource(null); }).toThrow(/Options object required/);
        });
    });

    // ── List / Remove ──────────────────────────────────────────────

    describe('listResources', function () {
        it('lists all resources', function () {
            rf.registerResource(makeResource({ id: 'a', category: 'bioink' }));
            rf.registerResource(makeResource({ id: 'b', category: 'reagent' }));
            expect(rf.listResources()).toHaveLength(2);
        });

        it('filters by category', function () {
            rf.registerResource(makeResource({ id: 'a', category: 'bioink' }));
            rf.registerResource(makeResource({ id: 'b', category: 'reagent' }));
            expect(rf.listResources({ category: 'reagent' })).toHaveLength(1);
        });
    });

    describe('removeResource', function () {
        it('removes a resource', function () {
            rf.registerResource(makeResource());
            rf.removeResource('alg-1');
            expect(rf.listResources()).toHaveLength(0);
        });

        it('throws for unknown id', function () {
            expect(function () { rf.removeResource('nope'); }).toThrow(/not found/);
        });
    });

    // ── Consumption ────────────────────────────────────────────────

    describe('recordConsumption', function () {
        it('decrements stock', function () {
            rf.registerResource(makeResource({ currentStock: 100 }));
            var result = rf.recordConsumption({ resourceId: 'alg-1', quantity: 30 });
            expect(result.remainingStock).toBe(70);
        });

        it('rejects consumption exceeding stock', function () {
            rf.registerResource(makeResource({ currentStock: 10 }));
            expect(function () {
                rf.recordConsumption({ resourceId: 'alg-1', quantity: 20 });
            }).toThrow(/exceeds current stock/);
        });

        it('rejects zero quantity', function () {
            rf.registerResource(makeResource());
            expect(function () {
                rf.recordConsumption({ resourceId: 'alg-1', quantity: 0 });
            }).toThrow(/positive number/);
        });

        it('rejects unknown resource', function () {
            expect(function () {
                rf.recordConsumption({ resourceId: 'ghost', quantity: 1 });
            }).toThrow(/not found/);
        });
    });

    // ── Restock ────────────────────────────────────────────────────

    describe('recordRestock', function () {
        it('increments stock', function () {
            rf.registerResource(makeResource({ currentStock: 50 }));
            var result = rf.recordRestock({ resourceId: 'alg-1', quantity: 200 });
            expect(result.currentStock).toBe(250);
        });
    });

    // ── Forecast ───────────────────────────────────────────────────

    describe('forecast', function () {
        it('returns forecast with no consumption history', function () {
            rf.registerResource(makeResource());
            var f = rf.forecast('alg-1');
            expect(f.dailyConsumptionRate).toBe(0);
            expect(f.daysUntilDepletion).toBeNull();
            expect(f.reorderUrgency).toBe('none');
        });

        it('calculates daily rate from history', function () {
            rf.registerResource(makeResource({ currentStock: 500 }));
            spreadConsumption('alg-1', 10, 10); // 10 units/day for 10 days => stock now 400
            var f = rf.forecast('alg-1');
            expect(f.dailyConsumptionRate).toBeGreaterThan(0);
            expect(f.daysUntilDepletion).toBeGreaterThan(0);
        });

        it('detects stable trend', function () {
            rf.registerResource(makeResource({ currentStock: 1000 }));
            spreadConsumption('alg-1', 10, 15);
            var f = rf.forecast('alg-1');
            expect(f.consumptionTrend).toBe('stable');
        });

        it('returns weekly forecast array with 4 weeks', function () {
            rf.registerResource(makeResource({ currentStock: 1000 }));
            spreadConsumption('alg-1', 10, 5);
            var f = rf.forecast('alg-1');
            expect(f.weeklyForecast).toHaveLength(4);
            expect(f.weeklyForecast[0].week).toBe(1);
        });

        it('reorder urgency is critical when stock below reorder point', function () {
            rf.registerResource(makeResource({ currentStock: 150, reorderPoint: 100 }));
            spreadConsumption('alg-1', 10, 5); // stock = 100 after 5*10=50
            var f = rf.forecast('alg-1');
            expect(f.reorderUrgency).toBe('critical');
        });

        it('detects expiration risk', function () {
            var tomorrow = new Date(Date.now() + dayMs(1));
            rf.registerResource(makeResource({
                currentStock: 500,
                expirationDate: tomorrow.toISOString()
            }));
            // Low consumption — won't use 500 units in 1 day
            spreadConsumption('alg-1', 1, 3);
            var f = rf.forecast('alg-1');
            expect(f.expirationRisk).not.toBe('none');
        });

        it('throws for unknown resource', function () {
            expect(function () { rf.forecast('nope'); }).toThrow(/not found/);
        });
    });

    // ── Alerts ─────────────────────────────────────────────────────

    describe('getAlerts', function () {
        it('returns empty when no resources', function () {
            expect(rf.getAlerts()).toEqual([]);
        });

        it('generates reorder alert for critical urgency', function () {
            rf.registerResource(makeResource({ currentStock: 150, reorderPoint: 100 }));
            // Consume to below reorder point
            spreadConsumption('alg-1', 10, 5); // stock = 100
            var alerts = rf.getAlerts();
            var reorderAlerts = alerts.filter(function (a) { return a.type === 'reorder'; });
            expect(reorderAlerts.length).toBeGreaterThanOrEqual(1);
        });

        it('alerts sorted by severity', function () {
            rf.registerResource(makeResource({ id: 'a', currentStock: 50, reorderPoint: 100 }));
            rf.registerResource(makeResource({ id: 'b', currentStock: 1000, reorderPoint: 10 }));
            var alerts = rf.getAlerts();
            if (alerts.length >= 2) {
                var first = alerts[0].severity;
                expect(first).toBe('critical');
            }
        });
    });

    // ── Waste analysis ─────────────────────────────────────────────

    describe('analyzeWaste', function () {
        it('returns empty waste for clean consumption', function () {
            rf.registerResource(makeResource({ currentStock: 1000 }));
            spreadConsumption('alg-1', 10, 10);
            var waste = rf.analyzeWaste();
            expect(waste.wasteEvents).toHaveLength(0);
            expect(waste.overallWasteRate).toBe(0);
        });

        it('detects waste spike', function () {
            rf.registerResource(makeResource({ currentStock: 2000 }));
            var now = Date.now();
            // 9 normal events
            for (var i = 9; i >= 1; i--) {
                rf.recordConsumption({ resourceId: 'alg-1', quantity: 10, timestamp: now - dayMs(i) });
            }
            // 1 spike
            rf.recordConsumption({ resourceId: 'alg-1', quantity: 100, timestamp: now - dayMs(0.5) });
            var waste = rf.analyzeWaste();
            expect(waste.wasteEvents.length).toBeGreaterThanOrEqual(1);
            expect(waste.wasteEvents[0].excess).toBeGreaterThan(0);
        });
    });

    // ── Procurement ────────────────────────────────────────────────

    describe('optimizeProcurement', function () {
        it('returns structure with all fields', function () {
            rf.registerResource(makeResource());
            var plan = rf.optimizeProcurement();
            expect(plan).toHaveProperty('immediateOrders');
            expect(plan).toHaveProperty('scheduledOrders');
            expect(plan).toHaveProperty('bulkOpportunities');
            expect(plan).toHaveProperty('estimatedMonthlyCost');
            expect(plan).toHaveProperty('savingsFromBulk');
        });

        it('includes immediate orders for critical stock', function () {
            rf.registerResource(makeResource({ currentStock: 50, reorderPoint: 100 }));
            var plan = rf.optimizeProcurement();
            expect(plan.immediateOrders.length).toBe(1);
            expect(plan.immediateOrders[0].reason).toMatch(/below reorder/i);
        });
    });

    // ── Dashboard ──────────────────────────────────────────────────

    describe('getDashboard', function () {
        it('returns comprehensive dashboard', function () {
            rf.registerResource(makeResource({ id: 'a' }));
            rf.registerResource(makeResource({ id: 'b', name: 'FBS', category: 'media' }));
            var dash = rf.getDashboard();
            expect(dash.totalResources).toBe(2);
            expect(dash.totalInventoryValue).toBeGreaterThan(0);
            expect(dash.resources).toHaveLength(2);
            expect(dash).toHaveProperty('alerts');
            expect(dash).toHaveProperty('procurement');
        });
    });

    // ── History ────────────────────────────────────────────────────

    describe('getHistory', function () {
        it('returns consumption and restock history', function () {
            rf.registerResource(makeResource());
            rf.recordConsumption({ resourceId: 'alg-1', quantity: 10 });
            rf.recordRestock({ resourceId: 'alg-1', quantity: 50 });
            var h = rf.getHistory('alg-1');
            expect(h.consumptions).toHaveLength(1);
            expect(h.restocks).toHaveLength(1);
        });
    });

    // ── Reset ──────────────────────────────────────────────────────

    describe('reset', function () {
        it('clears all data', function () {
            rf.registerResource(makeResource());
            rf.reset();
            expect(rf.listResources()).toHaveLength(0);
        });
    });

    // ── Module export ──────────────────────────────────────────────

    describe('module exports', function () {
        it('exports createResourceForecaster', function () {
            expect(typeof rfMod.createResourceForecaster).toBe('function');
        });
    });
});
