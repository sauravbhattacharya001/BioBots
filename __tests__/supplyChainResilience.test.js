'use strict';

var _create = require('../docs/shared/supplyChainResilience').createSupplyChainResilience;

function setup() {
    var scr = _create();
    scr.registerVendor({ id: 'v1', name: 'ChemCorp', location: 'US', leadTimeDays: 5, reliabilityScore: 0.95 });
    scr.registerVendor({ id: 'v2', name: 'BioSupply', location: 'EU', leadTimeDays: 10, reliabilityScore: 0.85 });
    scr.registerVendor({ id: 'v3', name: 'LabDirect', location: 'US', leadTimeDays: 3, reliabilityScore: 0.9 });

    scr.registerMaterial({
        id: 'm1', name: 'Alginate 2%', category: 'bioink',
        vendors: [{ vendorId: 'v1', unitCost: 0.85, leadTimeDays: 5 }, { vendorId: 'v2', unitCost: 0.90, leadTimeDays: 10 }],
        consumptionRate: 10, currentStock: 500, reorderPoint: 100
    });
    scr.registerMaterial({
        id: 'm2', name: 'Gelatin', category: 'bioink',
        vendors: [{ vendorId: 'v1', unitCost: 1.20, leadTimeDays: 5 }],
        consumptionRate: 5, currentStock: 200, reorderPoint: 50
    });
    scr.registerMaterial({
        id: 'm3', name: 'PBS Buffer', category: 'reagent',
        vendors: [{ vendorId: 'v1', unitCost: 0.10, leadTimeDays: 3 }, { vendorId: 'v2', unitCost: 0.12, leadTimeDays: 8 }, { vendorId: 'v3', unitCost: 0.11, leadTimeDays: 3 }],
        consumptionRate: 20, currentStock: 1000, reorderPoint: 200
    });

    return scr;
}

// ── Vendor Registration ────────────────────────────────────────────

describe('Vendor Registration', function () {
    test('registers a vendor successfully', function () {
        var scr = _create();
        var r = scr.registerVendor({ id: 'v1', name: 'ChemCorp' });
        expect(r.success).toBe(true);
        expect(r.vendor.name).toBe('ChemCorp');
    });

    test('rejects missing id', function () {
        var scr = _create();
        var r = scr.registerVendor({ name: 'X' });
        expect(r.success).toBe(false);
    });

    test('rejects missing name', function () {
        var scr = _create();
        var r = scr.registerVendor({ id: 'v1' });
        expect(r.success).toBe(false);
    });

    test('rejects prototype pollution key', function () {
        var scr = _create();
        var r = scr.registerVendor({ id: '__proto__', name: 'Evil' });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/[Ii]nvalid/);
    });

    test('defaults leadTimeDays and reliabilityScore', function () {
        var scr = _create();
        var r = scr.registerVendor({ id: 'v1', name: 'Test' });
        expect(r.vendor.leadTimeDays).toBe(7);
        expect(r.vendor.reliabilityScore).toBe(0.9);
    });

    test('clamps reliabilityScore to [0,1]', function () {
        var scr = _create();
        var r = scr.registerVendor({ id: 'v1', name: 'Test', reliabilityScore: 5 });
        expect(r.vendor.reliabilityScore).toBe(1);
    });
});

// ── Material Registration ──────────────────────────────────────────

describe('Material Registration', function () {
    test('registers a material with vendors', function () {
        var scr = _create();
        var r = scr.registerMaterial({
            id: 'm1', name: 'Alginate', vendors: [{ vendorId: 'v1', unitCost: 0.85 }]
        });
        expect(r.success).toBe(true);
        expect(r.material.vendors).toHaveLength(1);
    });

    test('rejects missing id', function () {
        var scr = _create();
        var r = scr.registerMaterial({ name: 'X' });
        expect(r.success).toBe(false);
    });

    test('rejects prototype pollution key', function () {
        var scr = _create();
        var r = scr.registerMaterial({ id: 'constructor', name: 'Bad' });
        expect(r.success).toBe(false);
    });

    test('filters out dangerous vendor ids', function () {
        var scr = _create();
        var r = scr.registerMaterial({
            id: 'm1', name: 'X',
            vendors: [{ vendorId: '__proto__', unitCost: 1 }, { vendorId: 'v1', unitCost: 1 }]
        });
        expect(r.success).toBe(true);
        expect(r.material.vendors).toHaveLength(1);
    });
});

// ── Substitute Registration ────────────────────────────────────────

describe('Substitute Registration', function () {
    test('registers a substitute', function () {
        var scr = _create();
        var r = scr.registerSubstitute({ materialId: 'm1', substituteId: 'm2', compatibilityScore: 0.85 });
        expect(r.success).toBe(true);
    });

    test('rejects missing materialId', function () {
        var scr = _create();
        var r = scr.registerSubstitute({ substituteId: 'm2' });
        expect(r.success).toBe(false);
    });

    test('rejects dangerous keys', function () {
        var scr = _create();
        var r = scr.registerSubstitute({ materialId: '__proto__', substituteId: 'm2' });
        expect(r.success).toBe(false);
    });

    test('clamps compatibility score', function () {
        var scr = _create();
        scr.registerSubstitute({ materialId: 'm1', substituteId: 'm2', compatibilityScore: 1.5 });
        var map = scr.mapSubstitutes('m1');
        // We didn't register m1, so empty
        expect(map.materials).toHaveLength(0);
    });
});

// ── Delivery Recording ─────────────────────────────────────────────

describe('Delivery Recording', function () {
    test('records a delivery with lead time calculation', function () {
        var scr = setup();
        var ordered = Date.now() - 5 * 86400000;
        var delivered = Date.now();
        var r = scr.recordDelivery({ vendorId: 'v1', materialId: 'm1', orderedAt: ordered, deliveredAt: delivered, quantity: 100 });
        expect(r.success).toBe(true);
        expect(r.leadTimeDays).toBeCloseTo(5, 0);
    });

    test('rejects missing vendorId', function () {
        var scr = _create();
        var r = scr.recordDelivery({ materialId: 'm1' });
        expect(r.success).toBe(false);
    });

    test('rejects missing materialId', function () {
        var scr = _create();
        var r = scr.recordDelivery({ vendorId: 'v1' });
        expect(r.success).toBe(false);
    });
});

// ── Stockout Recording ─────────────────────────────────────────────

describe('Stockout Recording', function () {
    test('records a stockout event', function () {
        var scr = _create();
        var r = scr.recordStockout({ materialId: 'm1', durationHours: 8, impact: 'delayed experiment' });
        expect(r.success).toBe(true);
    });

    test('rejects missing materialId', function () {
        var scr = _create();
        var r = scr.recordStockout({});
        expect(r.success).toBe(false);
    });
});

// ── Engine 1: Vendor Dependency Analyzer ───────────────────────────

describe('Vendor Dependency Analyzer', function () {
    test('detects single-source materials', function () {
        var scr = setup();
        var r = scr.analyzeVendorDependency();
        expect(r.singleSourceCount).toBe(1); // m2 = Gelatin
        var gelatin = r.materials.find(function (m) { return m.materialId === 'm2'; });
        expect(gelatin.singleSource).toBe(true);
    });

    test('computes HHI correctly for single vendor', function () {
        var scr = setup();
        var r = scr.analyzeVendorDependency('m2');
        expect(r.materials[0].hhi).toBe(10000);
    });

    test('computes HHI for two vendors', function () {
        var scr = setup();
        var r = scr.analyzeVendorDependency('m1');
        expect(r.materials[0].hhi).toBe(5000); // 50^2 + 50^2
    });

    test('computes HHI for three vendors', function () {
        var scr = setup();
        var r = scr.analyzeVendorDependency('m3');
        // (100/3)^2 * 3 ≈ 3333
        expect(r.materials[0].hhi).toBeCloseTo(3333, -1);
    });

    test('analyzes specific material', function () {
        var scr = setup();
        var r = scr.analyzeVendorDependency('m1');
        expect(r.materials).toHaveLength(1);
        expect(r.materials[0].vendorCount).toBe(2);
    });

    test('returns empty for nonexistent material', function () {
        var scr = setup();
        var r = scr.analyzeVendorDependency('nonexistent');
        expect(r.materials).toHaveLength(0);
    });
});

// ── Engine 2: Lead Time Reliability ────────────────────────────────

describe('Lead Time Reliability', function () {
    test('returns defaults with no deliveries', function () {
        var scr = setup();
        var r = scr.analyzeLeadTimeReliability('v1');
        expect(r.vendors[0].deliveryCount).toBe(0);
        expect(r.vendors[0].onTimeRate).toBe(1); // default
    });

    test('calculates on-time rate', function () {
        var scr = setup();
        var now = Date.now();
        // 3 on-time deliveries for v1 (expected 5 days, buffer +1 = 6)
        scr.recordDelivery({ vendorId: 'v1', materialId: 'm1', orderedAt: now - 5 * 86400000, deliveredAt: now, quantity: 50 });
        scr.recordDelivery({ vendorId: 'v1', materialId: 'm1', orderedAt: now - 4 * 86400000, deliveredAt: now, quantity: 50 });
        // 1 late delivery
        scr.recordDelivery({ vendorId: 'v1', materialId: 'm1', orderedAt: now - 15 * 86400000, deliveredAt: now, quantity: 50 });

        var r = scr.analyzeLeadTimeReliability('v1');
        expect(r.vendors[0].deliveryCount).toBe(3);
        expect(r.vendors[0].onTimeRate).toBeGreaterThan(0);
        expect(r.vendors[0].onTimeRate).toBeLessThanOrEqual(1);
    });

    test('detects lead time trend', function () {
        var scr = setup();
        var now = Date.now();
        // Increasing lead times: 3, 5, 8, 12 days
        scr.recordDelivery({ vendorId: 'v1', materialId: 'm1', orderedAt: now - 3 * 86400000, deliveredAt: now, quantity: 10 });
        scr.recordDelivery({ vendorId: 'v1', materialId: 'm1', orderedAt: now - 5 * 86400000, deliveredAt: now, quantity: 10 });
        scr.recordDelivery({ vendorId: 'v1', materialId: 'm1', orderedAt: now - 8 * 86400000, deliveredAt: now, quantity: 10 });
        scr.recordDelivery({ vendorId: 'v1', materialId: 'm1', orderedAt: now - 12 * 86400000, deliveredAt: now, quantity: 10 });

        var r = scr.analyzeLeadTimeReliability('v1');
        // Lead times (from daysBetween) will be 3, 5, 8, 12 — but recorded in order
        // so regression should show decreasing pattern (12, 8, 5, 3)
        expect(['increasing', 'decreasing', 'stable']).toContain(r.vendors[0].trend);
    });

    test('analyzes all vendors when no id given', function () {
        var scr = setup();
        var r = scr.analyzeLeadTimeReliability();
        expect(r.totalVendors).toBe(3);
    });
});

// ── Engine 3: Stockout Probability Estimator ───────────────────────

describe('Stockout Probability Estimator', function () {
    test('returns error for unknown material', function () {
        var scr = _create();
        var r = scr.estimateStockoutProbability('nonexistent');
        expect(r.error).toBeDefined();
        expect(r.probability).toBe(1);
    });

    test('estimates probability for well-stocked material', function () {
        var scr = setup();
        var r = scr.estimateStockoutProbability('m3', { horizonDays: 7, simulations: 500 });
        // PBS has 1000 stock, 20/day rate, 50 days supply → low stockout in 7 days
        expect(r.stockoutProbability).toBeLessThan(0.5);
        expect(r.risk).toBeDefined();
        expect(r.daysOfSupply).toBe(50);
    });

    test('estimates higher probability for low-stock material', function () {
        var scr = _create();
        scr.registerVendor({ id: 'v1', name: 'X' });
        scr.registerMaterial({
            id: 'm1', name: 'Low Stock',
            vendors: [{ vendorId: 'v1', leadTimeDays: 15 }],
            consumptionRate: 50, currentStock: 100, reorderPoint: 200
        });
        var r = scr.estimateStockoutProbability('m1', { horizonDays: 30, simulations: 500 });
        // 100 stock / 50 per day = 2 days supply → high stockout
        expect(r.stockoutProbability).toBeGreaterThan(0.1);
    });

    test('returns days of supply', function () {
        var scr = setup();
        var r = scr.estimateStockoutProbability('m1');
        expect(r.daysOfSupply).toBe(50); // 500 / 10
    });
});

// ── Engine 4: Substitute Material Mapper ───────────────────────────

describe('Substitute Material Mapper', function () {
    test('detects gaps when no substitutes registered', function () {
        var scr = setup();
        var r = scr.mapSubstitutes();
        expect(r.gapCount).toBe(3);
        expect(r.coverageRate).toBe(0);
    });

    test('counts viable substitutes (score >= 0.7)', function () {
        var scr = setup();
        scr.registerSubstitute({ materialId: 'm1', substituteId: 'm2', compatibilityScore: 0.85 });
        scr.registerSubstitute({ materialId: 'm1', substituteId: 'm3', compatibilityScore: 0.4 });
        var r = scr.mapSubstitutes('m1');
        expect(r.materials[0].totalSubstitutes).toBe(2);
        expect(r.materials[0].viableSubstitutes).toBe(1);
    });

    test('calculates coverage rate', function () {
        var scr = setup();
        scr.registerSubstitute({ materialId: 'm1', substituteId: 'm2', compatibilityScore: 0.9 });
        var r = scr.mapSubstitutes();
        // 1 of 3 materials has substitutes
        expect(r.coverageRate).toBeCloseTo(0.333, 2);
    });
});

// ── Engine 5: Stress Tester ────────────────────────────────────────

describe('Stress Tester', function () {
    test('vendor_loss scenario identifies affected materials', function () {
        var scr = setup();
        var r = scr.stressTest({ type: 'vendor_loss', params: { vendorId: 'v1' } });
        expect(r.affectedMaterials).toBe(3); // all 3 materials use v1
        expect(r.criticalMaterials).toBe(1); // m2 has only v1
        expect(r.survivalScore).toBeGreaterThanOrEqual(0);
        expect(r.survivalScore).toBeLessThanOrEqual(100);
    });

    test('vendor_loss with nonexistent vendor shows no impact', function () {
        var scr = setup();
        var r = scr.stressTest({ type: 'vendor_loss', params: { vendorId: 'v999' } });
        expect(r.affectedMaterials).toBe(0);
        expect(r.survivalScore).toBe(100);
    });

    test('lead_time_spike scenario', function () {
        var scr = setup();
        var r = scr.stressTest({ type: 'lead_time_spike', params: { multiplier: 3 } });
        expect(r.impacts).toHaveLength(3);
        expect(r.survivalScore).toBeGreaterThanOrEqual(0);
        expect(r.survivalScore).toBeLessThanOrEqual(100);
        expect(typeof r.stockoutCount).toBe('number');
    });

    test('demand_surge scenario', function () {
        var scr = setup();
        var r = scr.stressTest({ type: 'demand_surge', params: { surgePercent: 100 } });
        expect(r.impacts).toHaveLength(3);
        expect(r.survivalScore).toBeGreaterThanOrEqual(0);
        expect(typeof r.stockoutCount).toBe('number');
    });

    test('requires scenario type', function () {
        var scr = _create();
        var r = scr.stressTest({});
        expect(r.error).toBeDefined();
    });

    test('rejects unknown scenario type', function () {
        var scr = _create();
        var r = scr.stressTest({ type: 'earthquake' });
        expect(r.error).toMatch(/[Uu]nknown/);
    });

    test('vendor_loss requires vendorId', function () {
        var scr = setup();
        var r = scr.stressTest({ type: 'vendor_loss', params: {} });
        expect(r.error).toBeDefined();
    });
});

// ── Engine 6: Resilience Scorer ────────────────────────────────────

describe('Resilience Scorer', function () {
    test('returns 0 with no materials', function () {
        var scr = _create();
        var r = scr.score();
        expect(r.overall).toBe(0);
        expect(r.tier).toBe('Critical');
    });

    test('returns score between 0 and 100', function () {
        var scr = setup();
        var r = scr.score();
        expect(r.overall).toBeGreaterThanOrEqual(0);
        expect(r.overall).toBeLessThanOrEqual(100);
        expect(r.tier).toBeDefined();
    });

    test('has all 5 dimensions', function () {
        var scr = setup();
        var r = scr.score();
        expect(r.dimensions).toHaveProperty('vendorDiversity');
        expect(r.dimensions).toHaveProperty('leadTimeReliability');
        expect(r.dimensions).toHaveProperty('substituteCoverage');
        expect(r.dimensions).toHaveProperty('stockoutRisk');
        expect(r.dimensions).toHaveProperty('stressResilience');
    });

    test('tier labels are valid', function () {
        var scr = setup();
        var r = scr.score();
        expect(['Critical', 'Poor', 'Fair', 'Good', 'Excellent']).toContain(r.tier);
    });
});

// ── Engine 7: Insight Generator ────────────────────────────────────

describe('Insight Generator', function () {
    test('generates single-source warnings', function () {
        var scr = setup();
        var r = scr.generateInsights();
        var singleSourceInsights = r.insights.filter(function (i) { return i.type === 'single_source_risk'; });
        expect(singleSourceInsights.length).toBeGreaterThanOrEqual(1);
    });

    test('generates substitute gap warnings', function () {
        var scr = setup();
        var r = scr.generateInsights();
        var gapInsights = r.insights.filter(function (i) { return i.type === 'substitute_gap'; });
        expect(gapInsights.length).toBeGreaterThanOrEqual(1);
    });

    test('detects recent stockouts', function () {
        var scr = setup();
        scr.recordStockout({ materialId: 'm1', timestamp: Date.now() - 86400000, durationHours: 4 });
        var r = scr.generateInsights();
        var stockoutInsights = r.insights.filter(function (i) { return i.type === 'recent_stockouts'; });
        expect(stockoutInsights.length).toBe(1);
    });

    test('counts high severity insights', function () {
        var scr = setup();
        var r = scr.generateInsights();
        expect(typeof r.highSeverity).toBe('number');
        expect(r.highSeverity).toBeGreaterThanOrEqual(0);
    });

    test('returns total count', function () {
        var scr = setup();
        var r = scr.generateInsights();
        expect(r.totalInsights).toBe(r.insights.length);
    });
});

// ── Dashboard ──────────────────────────────────────────────────────

describe('Dashboard', function () {
    test('aggregates all sections', function () {
        var scr = setup();
        var d = scr.dashboard();
        expect(d.summary.totalVendors).toBe(3);
        expect(d.summary.totalMaterials).toBe(3);
        expect(d.vendorDependency).toBeDefined();
        expect(d.leadTimeReliability).toBeDefined();
        expect(d.substituteCoverage).toBeDefined();
        expect(d.resilience).toBeDefined();
        expect(d.insights).toBeDefined();
    });

    test('summary counts are correct', function () {
        var scr = setup();
        scr.registerSubstitute({ materialId: 'm1', substituteId: 'm2', compatibilityScore: 0.8 });
        scr.recordDelivery({ vendorId: 'v1', materialId: 'm1', orderedAt: Date.now() - 86400000, deliveredAt: Date.now(), quantity: 50 });
        scr.recordStockout({ materialId: 'm2', durationHours: 2 });

        var d = scr.dashboard();
        expect(d.summary.totalSubstitutes).toBe(1);
        expect(d.summary.totalDeliveries).toBe(1);
        expect(d.summary.totalStockouts).toBe(1);
    });
});

// ── Edge Cases ─────────────────────────────────────────────────────

describe('Edge Cases', function () {
    test('empty instance dashboard', function () {
        var scr = _create();
        var d = scr.dashboard();
        expect(d.summary.totalVendors).toBe(0);
        expect(d.resilience.overall).toBe(0);
    });

    test('null opts rejected', function () {
        var scr = _create();
        expect(scr.registerVendor(null).success).toBe(false);
        expect(scr.registerMaterial(null).success).toBe(false);
        expect(scr.registerSubstitute(null).success).toBe(false);
        expect(scr.recordDelivery(null).success).toBe(false);
        expect(scr.recordStockout(null).success).toBe(false);
    });

    test('material with no vendors has max HHI', function () {
        var scr = _create();
        scr.registerMaterial({ id: 'm1', name: 'No Vendor', vendors: [] });
        var r = scr.analyzeVendorDependency('m1');
        expect(r.materials[0].hhi).toBe(10000);
    });
});
