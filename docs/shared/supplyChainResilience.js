'use strict';

/**
 * Lab Supply Chain Resilience Engine
 *
 * Autonomous supply chain risk analysis for bioprinting lab consumables.
 * Tracks vendor relationships, monitors lead time reliability, estimates
 * stockout probability, maps substitute materials, stress-tests disruption
 * scenarios, and produces a composite resilience score with actionable
 * insights.
 *
 * 7 Engines:
 *   1. Vendor Dependency Analyzer — HHI concentration, single-source flags
 *   2. Lead Time Variability Tracker — on-time rates, trend detection
 *   3. Stockout Probability Estimator — Monte Carlo risk estimation
 *   4. Substitute Material Mapper — coverage gaps, compatibility scoring
 *   5. Supply Chain Stress Tester — vendor loss / lead spike / demand surge
 *   6. Resilience Scorer — composite 0-100 across 5 weighted dimensions
 *   7. Insight Generator — autonomous actionable recommendations
 *
 * Agentic features:
 *   - Proactive single-source dependency detection
 *   - Autonomous stockout forecasting with configurable horizon
 *   - Disruption scenario simulation with survival scoring
 *   - Cross-vendor reliability trend analysis
 *   - Actionable procurement & diversification recommendations
 */

var _stats = require('./stats');
var mean = _stats.mean;
var stddev = _stats.stddev;
var linearRegression = _stats.linearRegression;

var _isDangerousKey = require('./sanitize').isDangerousKey;

// ── Tiers ──────────────────────────────────────────────────────────

var TIERS = [
    { min: 0,  max: 20, label: 'Critical' },
    { min: 21, max: 40, label: 'Poor' },
    { min: 41, max: 60, label: 'Fair' },
    { min: 61, max: 80, label: 'Good' },
    { min: 81, max: 100, label: 'Excellent' }
];

function tierLabel(score) {
    for (var i = 0; i < TIERS.length; i++) {
        if (score >= TIERS[i].min && score <= TIERS[i].max) return TIERS[i].label;
    }
    return 'Unknown';
}

// ── Helpers ────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function toEpoch(ts) {
    if (ts == null) return Date.now();
    if (typeof ts === 'number') return ts;
    var d = new Date(ts);
    return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

var MS_PER_DAY = 86400000;

function daysBetween(a, b) {
    return Math.abs(b - a) / MS_PER_DAY;
}

// ── Factory ────────────────────────────────────────────────────────

function createSupplyChainResilience() {
    var vendors = Object.create(null);         // id → vendor record
    var materials = Object.create(null);       // id → material record
    var substitutes = [];                      // { materialId, substituteId, compatibilityScore, notes }
    var deliveries = [];                       // delivery events
    var stockouts = [];                        // stockout events

    // ── Vendor Registration ────────────────────────────────────────

    function registerVendor(opts) {
        if (!opts || !opts.id || !opts.name) {
            return { success: false, error: 'id and name are required' };
        }
        if (_isDangerousKey(opts.id)) {
            return { success: false, error: 'Invalid vendor id' };
        }
        vendors[opts.id] = {
            id: opts.id,
            name: opts.name,
            location: opts.location || 'unknown',
            leadTimeDays: typeof opts.leadTimeDays === 'number' ? opts.leadTimeDays : 7,
            reliabilityScore: typeof opts.reliabilityScore === 'number' ? clamp(opts.reliabilityScore, 0, 1) : 0.9,
            registeredAt: Date.now()
        };
        return { success: true, vendor: vendors[opts.id] };
    }

    // ── Material Registration ──────────────────────────────────────

    function registerMaterial(opts) {
        if (!opts || !opts.id || !opts.name) {
            return { success: false, error: 'id and name are required' };
        }
        if (_isDangerousKey(opts.id)) {
            return { success: false, error: 'Invalid material id' };
        }
        var matVendors = [];
        if (Array.isArray(opts.vendors)) {
            for (var i = 0; i < opts.vendors.length; i++) {
                var v = opts.vendors[i];
                if (v && v.vendorId && !_isDangerousKey(v.vendorId)) {
                    matVendors.push({
                        vendorId: v.vendorId,
                        unitCost: typeof v.unitCost === 'number' ? v.unitCost : 0,
                        leadTimeDays: typeof v.leadTimeDays === 'number' ? v.leadTimeDays : 7
                    });
                }
            }
        }
        materials[opts.id] = {
            id: opts.id,
            name: opts.name,
            category: opts.category || 'consumable',
            vendors: matVendors,
            consumptionRate: typeof opts.consumptionRate === 'number' ? opts.consumptionRate : 1,
            currentStock: typeof opts.currentStock === 'number' ? opts.currentStock : 0,
            reorderPoint: typeof opts.reorderPoint === 'number' ? opts.reorderPoint : 10,
            registeredAt: Date.now()
        };
        return { success: true, material: materials[opts.id] };
    }

    // ── Substitute Registration ────────────────────────────────────

    function registerSubstitute(opts) {
        if (!opts || !opts.materialId || !opts.substituteId) {
            return { success: false, error: 'materialId and substituteId are required' };
        }
        if (_isDangerousKey(opts.materialId) || _isDangerousKey(opts.substituteId)) {
            return { success: false, error: 'Invalid id' };
        }
        substitutes.push({
            materialId: opts.materialId,
            substituteId: opts.substituteId,
            compatibilityScore: typeof opts.compatibilityScore === 'number' ? clamp(opts.compatibilityScore, 0, 1) : 0.5,
            notes: opts.notes || ''
        });
        return { success: true };
    }

    // ── Delivery Recording ─────────────────────────────────────────

    function recordDelivery(opts) {
        if (!opts || !opts.vendorId || !opts.materialId) {
            return { success: false, error: 'vendorId and materialId are required' };
        }
        var ordered = toEpoch(opts.orderedAt);
        var delivered = toEpoch(opts.deliveredAt);
        var leadDays = daysBetween(ordered, delivered);
        deliveries.push({
            vendorId: opts.vendorId,
            materialId: opts.materialId,
            orderedAt: ordered,
            deliveredAt: delivered,
            leadTimeDays: leadDays,
            quantity: typeof opts.quantity === 'number' ? opts.quantity : 0,
            quality: typeof opts.quality === 'number' ? clamp(opts.quality, 0, 1) : 1
        });
        return { success: true, leadTimeDays: Math.round(leadDays * 100) / 100 };
    }

    // ── Stockout Recording ─────────────────────────────────────────

    function recordStockout(opts) {
        if (!opts || !opts.materialId) {
            return { success: false, error: 'materialId is required' };
        }
        stockouts.push({
            materialId: opts.materialId,
            timestamp: toEpoch(opts.timestamp),
            durationHours: typeof opts.durationHours === 'number' ? opts.durationHours : 0,
            impact: opts.impact || 'unknown'
        });
        return { success: true };
    }

    // ── Engine 1: Vendor Dependency Analyzer ───────────────────────

    function analyzeVendorDependency(materialId) {
        var targetMats = [];
        if (materialId) {
            if (materials[materialId]) targetMats.push(materials[materialId]);
        } else {
            var mKeys = Object.keys(materials);
            for (var i = 0; i < mKeys.length; i++) targetMats.push(materials[mKeys[i]]);
        }

        var results = [];
        for (var m = 0; m < targetMats.length; m++) {
            var mat = targetMats[m];
            var vendorCount = mat.vendors.length;
            var singleSource = vendorCount <= 1;

            // HHI: sum of squared market shares (0-10000 scale)
            var hhi = 0;
            if (vendorCount > 0) {
                var share = 100 / vendorCount; // equal share assumption
                for (var v = 0; v < vendorCount; v++) {
                    hhi += share * share;
                }
            } else {
                hhi = 10000; // no vendors = maximum concentration
            }
            hhi = Math.round(hhi);

            var concentrationRisk = hhi > 2500 ? 'high' : hhi > 1500 ? 'moderate' : 'low';

            results.push({
                materialId: mat.id,
                materialName: mat.name,
                vendorCount: vendorCount,
                singleSource: singleSource,
                hhi: hhi,
                concentrationRisk: concentrationRisk
            });
        }

        return {
            materials: results,
            totalMaterials: results.length,
            singleSourceCount: results.filter(function (r) { return r.singleSource; }).length
        };
    }

    // ── Engine 2: Lead Time Variability Tracker ────────────────────

    function analyzeLeadTimeReliability(vendorId) {
        var targetVendors = [];
        if (vendorId) {
            if (vendors[vendorId]) targetVendors.push(vendors[vendorId]);
        } else {
            var vKeys = Object.keys(vendors);
            for (var i = 0; i < vKeys.length; i++) targetVendors.push(vendors[vKeys[i]]);
        }

        var results = [];
        for (var v = 0; v < targetVendors.length; v++) {
            var vendor = targetVendors[v];
            var vDeliveries = deliveries.filter(function (d) { return d.vendorId === vendor.id; });
            var leadTimes = vDeliveries.map(function (d) { return d.leadTimeDays; });

            var avgLead = leadTimes.length > 0 ? mean(leadTimes) : vendor.leadTimeDays;
            var variability = leadTimes.length >= 2 ? stddev(leadTimes) : 0;

            // On-time: delivered within expected lead time + 1 day buffer
            var expectedLead = vendor.leadTimeDays;
            var onTimeCount = 0;
            for (var d = 0; d < vDeliveries.length; d++) {
                if (vDeliveries[d].leadTimeDays <= expectedLead + 1) onTimeCount++;
            }
            var onTimeRate = vDeliveries.length > 0 ? onTimeCount / vDeliveries.length : 1;

            // Trend detection via linear regression
            var trend = 'stable';
            if (leadTimes.length >= 3) {
                var xs = [];
                for (var t = 0; t < leadTimes.length; t++) xs.push(t);
                var reg = linearRegression(xs, leadTimes);
                if (reg.slope > 0.1) trend = 'increasing';
                else if (reg.slope < -0.1) trend = 'decreasing';
            }

            // Quality average
            var qualities = vDeliveries.map(function (d) { return d.quality; });
            var avgQuality = qualities.length > 0 ? mean(qualities) : 1;

            results.push({
                vendorId: vendor.id,
                vendorName: vendor.name,
                deliveryCount: vDeliveries.length,
                avgLeadTimeDays: Math.round(avgLead * 100) / 100,
                leadTimeVariability: Math.round(variability * 100) / 100,
                onTimeRate: Math.round(onTimeRate * 1000) / 1000,
                trend: trend,
                avgQuality: Math.round(avgQuality * 1000) / 1000
            });
        }

        return { vendors: results, totalVendors: results.length };
    }

    // ── Engine 3: Stockout Probability Estimator ───────────────────

    function estimateStockoutProbability(materialId, opts) {
        if (!materialId || !materials[materialId]) {
            return { error: 'Material not found', probability: 1 };
        }
        var mat = materials[materialId];
        var horizonDays = (opts && typeof opts.horizonDays === 'number') ? opts.horizonDays : 30;
        var simulations = (opts && typeof opts.simulations === 'number') ? opts.simulations : 1000;

        var consumptionRate = mat.consumptionRate; // units per day
        var currentStock = mat.currentStock;

        // Get average lead time and variability from deliveries
        var matDeliveries = deliveries.filter(function (d) { return d.materialId === materialId; });
        var leadTimes = matDeliveries.map(function (d) { return d.leadTimeDays; });
        var avgLead = leadTimes.length > 0 ? mean(leadTimes) : 7;
        var leadStd = leadTimes.length >= 2 ? stddev(leadTimes) : avgLead * 0.2;

        // Simple Monte Carlo: simulate stock over horizon
        var stockoutCount = 0;
        for (var s = 0; s < simulations; s++) {
            var stock = currentStock;
            var daysToReorder = avgLead + (Math.random() - 0.5) * 2 * leadStd;
            if (daysToReorder < 1) daysToReorder = 1;

            var reorderPending = false;
            var reorderArrival = -1;
            for (var day = 0; day < horizonDays; day++) {
                // Consume with some randomness
                var dailyUse = consumptionRate * (0.8 + Math.random() * 0.4);
                stock -= dailyUse;

                if (stock <= mat.reorderPoint && !reorderPending) {
                    reorderPending = true;
                    var thisLead = avgLead + (Math.random() - 0.5) * 2 * leadStd;
                    if (thisLead < 1) thisLead = 1;
                    reorderArrival = day + Math.ceil(thisLead);
                }
                if (reorderPending && day >= reorderArrival) {
                    stock += mat.reorderPoint * 3; // restock
                    reorderPending = false;
                }

                if (stock <= 0) {
                    stockoutCount++;
                    break;
                }
            }
        }

        var probability = stockoutCount / simulations;
        var risk = probability > 0.3 ? 'high' : probability > 0.1 ? 'moderate' : 'low';

        return {
            materialId: materialId,
            materialName: mat.name,
            horizonDays: horizonDays,
            simulations: simulations,
            stockoutProbability: Math.round(probability * 1000) / 1000,
            risk: risk,
            currentStock: currentStock,
            dailyConsumption: consumptionRate,
            daysOfSupply: consumptionRate > 0 ? Math.round(currentStock / consumptionRate * 10) / 10 : Infinity
        };
    }

    // ── Engine 4: Substitute Material Mapper ───────────────────────

    function mapSubstitutes(materialId) {
        var targetMats = [];
        if (materialId) {
            if (materials[materialId]) targetMats.push(materials[materialId]);
        } else {
            var mKeys = Object.keys(materials);
            for (var i = 0; i < mKeys.length; i++) targetMats.push(materials[mKeys[i]]);
        }

        var results = [];
        var gapCount = 0;
        for (var m = 0; m < targetMats.length; m++) {
            var mat = targetMats[m];
            var matSubs = substitutes.filter(function (s) { return s.materialId === mat.id; });

            var viableSubs = matSubs.filter(function (s) { return s.compatibilityScore >= 0.7; });
            var hasGap = matSubs.length === 0;
            if (hasGap) gapCount++;

            results.push({
                materialId: mat.id,
                materialName: mat.name,
                totalSubstitutes: matSubs.length,
                viableSubstitutes: viableSubs.length,
                substitutes: matSubs.map(function (s) {
                    return {
                        substituteId: s.substituteId,
                        compatibilityScore: s.compatibilityScore,
                        notes: s.notes
                    };
                }),
                hasGap: hasGap
            });
        }

        var coverage = targetMats.length > 0
            ? (targetMats.length - gapCount) / targetMats.length
            : 0;

        return {
            materials: results,
            totalMaterials: results.length,
            materialsWithSubstitutes: results.length - gapCount,
            gapCount: gapCount,
            coverageRate: Math.round(coverage * 1000) / 1000
        };
    }

    // ── Engine 5: Supply Chain Stress Tester ───────────────────────

    function stressTest(scenario) {
        if (!scenario || !scenario.type) {
            return { error: 'Scenario type is required' };
        }

        var mKeys = Object.keys(materials);
        var results = { type: scenario.type, impacts: [], survivalScore: 0 };

        if (scenario.type === 'vendor_loss') {
            var lostVendorId = scenario.params && scenario.params.vendorId;
            if (!lostVendorId) {
                return { error: 'params.vendorId is required for vendor_loss scenario' };
            }

            var affected = 0;
            var critical = 0;
            for (var i = 0; i < mKeys.length; i++) {
                var mat = materials[mKeys[i]];
                var hasVendor = mat.vendors.some(function (v) { return v.vendorId === lostVendorId; });
                if (hasVendor) {
                    affected++;
                    var remainingVendors = mat.vendors.filter(function (v) { return v.vendorId !== lostVendorId; });
                    if (remainingVendors.length === 0) critical++;
                    results.impacts.push({
                        materialId: mat.id,
                        materialName: mat.name,
                        remainingVendors: remainingVendors.length,
                        isCritical: remainingVendors.length === 0
                    });
                }
            }

            var totalMats = mKeys.length || 1;
            results.affectedMaterials = affected;
            results.criticalMaterials = critical;
            results.survivalScore = Math.round(clamp((1 - critical / totalMats) * 100, 0, 100));

        } else if (scenario.type === 'lead_time_spike') {
            var multiplier = (scenario.params && scenario.params.multiplier) || 2;
            var spikedStockouts = 0;

            for (var j = 0; j < mKeys.length; j++) {
                var mat2 = materials[mKeys[j]];
                var avgLead = 7;
                if (mat2.vendors.length > 0) {
                    var leads = mat2.vendors.map(function (v) { return v.leadTimeDays; });
                    avgLead = mean(leads);
                }
                var spikedLead = avgLead * multiplier;
                var daysOfSupply = mat2.consumptionRate > 0
                    ? mat2.currentStock / mat2.consumptionRate : Infinity;
                var wouldStockout = daysOfSupply < spikedLead;
                if (wouldStockout) spikedStockouts++;

                results.impacts.push({
                    materialId: mat2.id,
                    materialName: mat2.name,
                    originalLeadDays: Math.round(avgLead * 10) / 10,
                    spikedLeadDays: Math.round(spikedLead * 10) / 10,
                    daysOfSupply: Math.round(daysOfSupply * 10) / 10,
                    wouldStockout: wouldStockout
                });
            }

            results.stockoutCount = spikedStockouts;
            results.survivalScore = Math.round(clamp(
                (1 - spikedStockouts / (mKeys.length || 1)) * 100, 0, 100));

        } else if (scenario.type === 'demand_surge') {
            var surgePercent = (scenario.params && scenario.params.surgePercent) || 50;
            var surgeFactor = 1 + surgePercent / 100;
            var surgeStockouts = 0;

            for (var k = 0; k < mKeys.length; k++) {
                var mat3 = materials[mKeys[k]];
                var surgedRate = mat3.consumptionRate * surgeFactor;
                var daysAtSurge = surgedRate > 0
                    ? mat3.currentStock / surgedRate : Infinity;
                var wouldRunOut = daysAtSurge < 14; // 2-week horizon
                if (wouldRunOut) surgeStockouts++;

                results.impacts.push({
                    materialId: mat3.id,
                    materialName: mat3.name,
                    normalRate: mat3.consumptionRate,
                    surgedRate: Math.round(surgedRate * 100) / 100,
                    daysAtSurgeRate: Math.round(daysAtSurge * 10) / 10,
                    wouldRunOut: wouldRunOut
                });
            }

            results.stockoutCount = surgeStockouts;
            results.survivalScore = Math.round(clamp(
                (1 - surgeStockouts / (mKeys.length || 1)) * 100, 0, 100));

        } else {
            return { error: 'Unknown scenario type: ' + scenario.type };
        }

        return results;
    }

    // ── Engine 6: Resilience Scorer ────────────────────────────────

    function score() {
        var mKeys = Object.keys(materials);
        if (mKeys.length === 0) {
            return {
                overall: 0,
                tier: 'Critical',
                dimensions: {
                    vendorDiversity: 0,
                    leadTimeReliability: 0,
                    substituteCoverage: 0,
                    stockoutRisk: 0,
                    stressResilience: 0
                }
            };
        }

        // 1. Vendor Diversity (25%) — based on average HHI
        var depAnalysis = analyzeVendorDependency();
        var avgHHI = 0;
        if (depAnalysis.materials.length > 0) {
            var hhis = depAnalysis.materials.map(function (m) { return m.hhi; });
            avgHHI = mean(hhis);
        }
        // HHI 10000 (monopoly) → 0, HHI 1000 (competitive) → 100
        var vendorDiversityScore = clamp(Math.round((1 - avgHHI / 10000) * 100), 0, 100);

        // 2. Lead Time Reliability (20%) — average on-time rate
        var leadAnalysis = analyzeLeadTimeReliability();
        var avgOnTime = 1;
        if (leadAnalysis.vendors.length > 0) {
            var onTimeRates = leadAnalysis.vendors.map(function (v) { return v.onTimeRate; });
            avgOnTime = mean(onTimeRates);
        }
        var leadTimeScore = Math.round(avgOnTime * 100);

        // 3. Substitute Coverage (20%)
        var subMap = mapSubstitutes();
        var substituteCoverageScore = Math.round(subMap.coverageRate * 100);

        // 4. Stockout Risk (20%) — inverse of average probability
        var stockoutProbs = [];
        for (var i = 0; i < mKeys.length; i++) {
            var est = estimateStockoutProbability(mKeys[i], { simulations: 200 });
            stockoutProbs.push(est.stockoutProbability || 0);
        }
        var avgStockout = stockoutProbs.length > 0 ? mean(stockoutProbs) : 0.5;
        var stockoutRiskScore = Math.round(clamp((1 - avgStockout) * 100, 0, 100));

        // 5. Stress Resilience (15%) — average survival across scenarios
        var stressScores = [];
        // Test vendor loss for each vendor
        var vKeys = Object.keys(vendors);
        if (vKeys.length > 0) {
            for (var v = 0; v < vKeys.length; v++) {
                var vResult = stressTest({ type: 'vendor_loss', params: { vendorId: vKeys[v] } });
                if (typeof vResult.survivalScore === 'number') stressScores.push(vResult.survivalScore);
            }
        }
        // Test lead time spike
        var ltResult = stressTest({ type: 'lead_time_spike', params: { multiplier: 2 } });
        if (typeof ltResult.survivalScore === 'number') stressScores.push(ltResult.survivalScore);

        // Test demand surge
        var dsResult = stressTest({ type: 'demand_surge', params: { surgePercent: 50 } });
        if (typeof dsResult.survivalScore === 'number') stressScores.push(dsResult.survivalScore);

        var stressResilienceScore = stressScores.length > 0
            ? Math.round(mean(stressScores)) : 50;

        // Weighted composite
        var overall = Math.round(
            vendorDiversityScore * 0.25 +
            leadTimeScore * 0.20 +
            substituteCoverageScore * 0.20 +
            stockoutRiskScore * 0.20 +
            stressResilienceScore * 0.15
        );
        overall = clamp(overall, 0, 100);

        return {
            overall: overall,
            tier: tierLabel(overall),
            dimensions: {
                vendorDiversity: vendorDiversityScore,
                leadTimeReliability: leadTimeScore,
                substituteCoverage: substituteCoverageScore,
                stockoutRisk: stockoutRiskScore,
                stressResilience: stressResilienceScore
            }
        };
    }

    // ── Engine 7: Insight Generator ────────────────────────────────

    function generateInsights() {
        var insights = [];
        var mKeys = Object.keys(materials);
        var vKeys = Object.keys(vendors);

        // Single-source warnings
        var dep = analyzeVendorDependency();
        for (var i = 0; i < dep.materials.length; i++) {
            var m = dep.materials[i];
            if (m.singleSource) {
                insights.push({
                    type: 'single_source_risk',
                    severity: 'high',
                    material: m.materialName,
                    message: m.materialName + ' depends on a single vendor. Identify and qualify an alternative supplier to reduce supply chain risk.'
                });
            }
            if (m.concentrationRisk === 'high' && !m.singleSource) {
                insights.push({
                    type: 'concentration_risk',
                    severity: 'medium',
                    material: m.materialName,
                    message: m.materialName + ' has high vendor concentration (HHI: ' + m.hhi + '). Consider diversifying procurement across more vendors.'
                });
            }
        }

        // Lead time degradation
        var lead = analyzeLeadTimeReliability();
        for (var j = 0; j < lead.vendors.length; j++) {
            var v = lead.vendors[j];
            if (v.trend === 'increasing') {
                insights.push({
                    type: 'lead_time_degradation',
                    severity: 'medium',
                    vendor: v.vendorName,
                    message: v.vendorName + ' shows increasing lead times (avg: ' + v.avgLeadTimeDays + ' days). Monitor closely and consider backup sourcing.'
                });
            }
            if (v.onTimeRate < 0.7 && v.deliveryCount >= 3) {
                insights.push({
                    type: 'poor_delivery_performance',
                    severity: 'high',
                    vendor: v.vendorName,
                    message: v.vendorName + ' has a poor on-time delivery rate (' + Math.round(v.onTimeRate * 100) + '%). Consider replacing or supplementing this vendor.'
                });
            }
        }

        // Substitute gaps
        var subs = mapSubstitutes();
        if (subs.gapCount > 0) {
            insights.push({
                type: 'substitute_gap',
                severity: 'medium',
                message: subs.gapCount + ' material(s) have no registered substitutes. Identify alternatives to improve supply chain resilience.'
            });
        }

        // Stockout history
        if (stockouts.length > 0) {
            var recentStockouts = stockouts.filter(function (s) {
                return (Date.now() - s.timestamp) < 30 * MS_PER_DAY;
            });
            if (recentStockouts.length > 0) {
                insights.push({
                    type: 'recent_stockouts',
                    severity: 'high',
                    message: recentStockouts.length + ' stockout event(s) in the last 30 days. Review safety stock levels and reorder points.'
                });
            }
        }

        // Overall score recommendation
        var s = score();
        if (s.overall < 40) {
            insights.push({
                type: 'overall_resilience',
                severity: 'critical',
                message: 'Supply chain resilience is ' + s.tier + ' (' + s.overall + '/100). Immediate action required to reduce supply disruption risk.'
            });
        } else if (s.overall < 60) {
            insights.push({
                type: 'overall_resilience',
                severity: 'medium',
                message: 'Supply chain resilience is ' + s.tier + ' (' + s.overall + '/100). Focus on improving vendor diversity and substitute coverage.'
            });
        }

        return {
            insights: insights,
            totalInsights: insights.length,
            highSeverity: insights.filter(function (i) { return i.severity === 'high' || i.severity === 'critical'; }).length
        };
    }

    // ── Dashboard ──────────────────────────────────────────────────

    function dashboard() {
        return {
            summary: {
                totalVendors: Object.keys(vendors).length,
                totalMaterials: Object.keys(materials).length,
                totalSubstitutes: substitutes.length,
                totalDeliveries: deliveries.length,
                totalStockouts: stockouts.length
            },
            vendorDependency: analyzeVendorDependency(),
            leadTimeReliability: analyzeLeadTimeReliability(),
            substituteCoverage: mapSubstitutes(),
            resilience: score(),
            insights: generateInsights()
        };
    }

    return {
        registerVendor: registerVendor,
        registerMaterial: registerMaterial,
        registerSubstitute: registerSubstitute,
        recordDelivery: recordDelivery,
        recordStockout: recordStockout,
        analyzeVendorDependency: analyzeVendorDependency,
        analyzeLeadTimeReliability: analyzeLeadTimeReliability,
        estimateStockoutProbability: estimateStockoutProbability,
        mapSubstitutes: mapSubstitutes,
        stressTest: stressTest,
        score: score,
        generateInsights: generateInsights,
        dashboard: dashboard
    };
}

exports.createSupplyChainResilience = createSupplyChainResilience;
