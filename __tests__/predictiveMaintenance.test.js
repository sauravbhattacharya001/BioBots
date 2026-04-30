'use strict';

var pm = require('../docs/shared/predictiveMaintenance');
var createPredictiveMaintenance = pm.createPredictiveMaintenance;
var VALID_CATEGORIES = pm.VALID_CATEGORIES;
var VALID_CRITICALITIES = pm.VALID_CRITICALITIES;
var ANOMALY_TYPES = pm.ANOMALY_TYPES;

describe('Predictive Maintenance Engine', function() {

    var engine;

    beforeEach(function() {
        engine = createPredictiveMaintenance();
    });

    function registerDefault(overrides) {
        var opts = Object.assign({
            id: 'ph-01',
            name: 'Printhead Alpha',
            category: 'printhead',
            installDate: '2025-01-15',
            expectedLifeHours: 5000,
            maintenanceIntervalHours: 500,
            criticality: 'critical'
        }, overrides || {});
        return engine.registerEquipment(opts);
    }

    // ── Registration Tests ─────────────────────────────────────────

    describe('registerEquipment', function() {
        it('should register valid equipment', function() {
            var result = registerDefault();
            expect(result.success).toBe(true);
            expect(result.equipment.id).toBe('ph-01');
            expect(result.equipment.category).toBe('printhead');
            expect(result.equipment.totalOperatingHours).toBe(0);
        });

        it('should reject missing options', function() {
            expect(engine.registerEquipment(null).success).toBe(false);
            expect(engine.registerEquipment(undefined).success).toBe(false);
        });

        it('should reject missing id', function() {
            var result = engine.registerEquipment({ category: 'pump', expectedLifeHours: 1000 });
            expect(result.success).toBe(false);
            expect(result.error).toContain('id');
        });

        it('should reject dangerous keys as id', function() {
            var result = engine.registerEquipment({ id: '__proto__', category: 'pump', expectedLifeHours: 1000 });
            expect(result.success).toBe(false);
        });

        it('should reject duplicate registration', function() {
            registerDefault();
            var result = registerDefault();
            expect(result.success).toBe(false);
            expect(result.error).toContain('already registered');
        });

        it('should reject invalid category', function() {
            var result = registerDefault({ category: 'toaster' });
            expect(result.success).toBe(false);
            expect(result.error).toContain('category');
        });

        it('should reject invalid criticality', function() {
            var result = registerDefault({ criticality: 'extreme' });
            expect(result.success).toBe(false);
            expect(result.error).toContain('criticality');
        });

        it('should reject invalid expectedLifeHours', function() {
            var result = registerDefault({ expectedLifeHours: -100 });
            expect(result.success).toBe(false);
        });

        it('should accept all valid categories', function() {
            VALID_CATEGORIES.forEach(function(cat, i) {
                var result = engine.registerEquipment({
                    id: 'eq-' + i, category: cat, expectedLifeHours: 1000
                });
                expect(result.success).toBe(true);
            });
        });

        it('should accept all valid criticalities', function() {
            VALID_CRITICALITIES.forEach(function(crit, i) {
                var result = engine.registerEquipment({
                    id: 'eq-c' + i, category: 'pump', criticality: crit, expectedLifeHours: 1000
                });
                expect(result.success).toBe(true);
            });
        });
    });

    // ── Usage Recording Tests ──────────────────────────────────────

    describe('recordUsage', function() {
        beforeEach(function() {
            registerDefault();
        });

        it('should record valid usage', function() {
            var result = engine.recordUsage({ equipmentId: 'ph-01', hours: 8, temperature: 37, vibration: 0.1, errorCount: 0 });
            expect(result.success).toBe(true);
            expect(result.totalHours).toBe(8);
        });

        it('should accumulate hours', function() {
            engine.recordUsage({ equipmentId: 'ph-01', hours: 5 });
            engine.recordUsage({ equipmentId: 'ph-01', hours: 3 });
            var result = engine.recordUsage({ equipmentId: 'ph-01', hours: 2 });
            expect(result.totalHours).toBe(10);
        });

        it('should reject missing options', function() {
            expect(engine.recordUsage(null).success).toBe(false);
        });

        it('should reject missing equipmentId', function() {
            expect(engine.recordUsage({ hours: 5 }).success).toBe(false);
        });

        it('should reject dangerous equipmentId', function() {
            expect(engine.recordUsage({ equipmentId: 'constructor', hours: 5 }).success).toBe(false);
        });

        it('should reject unknown equipment', function() {
            expect(engine.recordUsage({ equipmentId: 'unknown', hours: 5 }).success).toBe(false);
        });

        it('should reject invalid hours', function() {
            expect(engine.recordUsage({ equipmentId: 'ph-01', hours: 0 }).success).toBe(false);
            expect(engine.recordUsage({ equipmentId: 'ph-01', hours: -5 }).success).toBe(false);
        });

        it('should handle null temperature and vibration', function() {
            var result = engine.recordUsage({ equipmentId: 'ph-01', hours: 4 });
            expect(result.success).toBe(true);
            expect(result.event.temperature).toBeNull();
            expect(result.event.vibration).toBeNull();
        });
    });

    // ── Wear Analysis Tests ────────────────────────────────────────

    describe('analyzeWear', function() {
        beforeEach(function() {
            registerDefault();
        });

        it('should return baseline for no usage', function() {
            var result = engine.analyzeWear('ph-01');
            expect(result.success).toBe(true);
            expect(result.wearRate).toBe(0);
            expect(result.remainingLife).toBe(5000);
            expect(result.lifeConsumed).toBe(0);
        });

        it('should compute wear rate', function() {
            for (var i = 0; i < 10; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 8, vibration: 0.1, temperature: 37 });
            }
            var result = engine.analyzeWear('ph-01');
            expect(result.success).toBe(true);
            expect(result.wearRate).toBe(8);
            expect(result.remainingLife).toBe(4920);
        });

        it('should detect wear acceleration', function() {
            // Increasing hours pattern
            for (var i = 1; i <= 10; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: i * 2, vibration: 0.1 });
            }
            var result = engine.analyzeWear('ph-01');
            expect(result.wearAcceleration).toBe(true);
        });

        it('should detect vibration trend', function() {
            // Increasing vibration
            for (var i = 0; i < 10; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 5, vibration: 0.1 + i * 0.02 });
            }
            var result = engine.analyzeWear('ph-01');
            expect(result.vibrationTrend.direction).toBe('increasing');
        });

        it('should detect temperature drift', function() {
            for (var i = 0; i < 10; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 5, temperature: 37 + i * 0.5 });
            }
            var result = engine.analyzeWear('ph-01');
            expect(result.temperatureDrift.direction).toBe('increasing');
        });

        it('should reject invalid equipmentId', function() {
            expect(engine.analyzeWear('__proto__').success).toBe(false);
            expect(engine.analyzeWear('nonexistent').success).toBe(false);
        });
    });

    // ── Failure Prediction Tests ───────────────────────────────────

    describe('predictFailure', function() {
        it('should predict minimal risk for new equipment', function() {
            registerDefault();
            var result = engine.predictFailure('ph-01');
            expect(result.success).toBe(true);
            expect(result.riskLevel).toBe('minimal');
            expect(result.currentReliability).toBeCloseTo(1.0, 2);
        });

        it('should predict higher risk as hours accumulate', function() {
            registerDefault();
            // Simulate heavy usage
            for (var i = 0; i < 50; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 80 });
            }
            var result = engine.predictFailure('ph-01');
            expect(result.success).toBe(true);
            expect(result.currentReliability).toBeLessThan(0.7);
            expect(['moderate', 'high', 'critical']).toContain(result.riskLevel);
        });

        it('should show increasing risk over horizons', function() {
            registerDefault();
            engine.recordUsage({ equipmentId: 'ph-01', hours: 2000 });
            var result = engine.predictFailure('ph-01');
            expect(result.horizons.next1000h.probability).toBeGreaterThan(result.horizons.next100h.probability);
        });

        it('should reject invalid equipmentId', function() {
            expect(engine.predictFailure('prototype').success).toBe(false);
        });

        it('should report correct operating hours', function() {
            registerDefault();
            engine.recordUsage({ equipmentId: 'ph-01', hours: 150 });
            var result = engine.predictFailure('ph-01');
            expect(result.operatingHours).toBe(150);
            expect(result.expectedLifeHours).toBe(5000);
        });
    });

    // ── Schedule Optimization Tests ────────────────────────────────

    describe('optimizeSchedule', function() {
        it('should return empty schedule for no equipment', function() {
            var result = engine.optimizeSchedule();
            expect(result.success).toBe(true);
            expect(result.schedule).toEqual([]);
        });

        it('should sort by urgency score descending', function() {
            engine.registerEquipment({ id: 'low-use', name: 'Low', category: 'pump', expectedLifeHours: 10000, criticality: 'low' });
            engine.registerEquipment({ id: 'high-use', name: 'High', category: 'printhead', expectedLifeHours: 1000, criticality: 'critical' });
            // Make high-use overdue
            for (var i = 0; i < 10; i++) {
                engine.recordUsage({ equipmentId: 'high-use', hours: 100 });
            }
            var result = engine.optimizeSchedule();
            expect(result.schedule[0].equipmentId).toBe('high-use');
            expect(result.schedule[0].urgencyScore).toBeGreaterThan(result.schedule[1].urgencyScore);
        });

        it('should flag overdue equipment as high priority', function() {
            registerDefault();
            // Push past maintenance interval
            for (var i = 0; i < 70; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 10 });
            }
            var result = engine.optimizeSchedule();
            expect(['critical', 'high']).toContain(result.schedule[0].priority);
        });

        it('should generate recommendations for urgent items', function() {
            registerDefault();
            for (var i = 0; i < 60; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 10 });
            }
            var result = engine.optimizeSchedule();
            expect(result.recommendations.length).toBeGreaterThan(0);
        });
    });

    // ── Anomaly Detection Tests ────────────────────────────────────

    describe('detectAnomalies', function() {
        beforeEach(function() {
            registerDefault();
        });

        it('should return no anomalies for insufficient data', function() {
            engine.recordUsage({ equipmentId: 'ph-01', hours: 5, vibration: 0.1 });
            var result = engine.detectAnomalies('ph-01');
            expect(result.success).toBe(true);
            expect(result.anomalies).toEqual([]);
        });

        it('should detect vibration spike', function() {
            for (var i = 0; i < 19; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 5, vibration: 0.1 });
            }
            // Spike
            engine.recordUsage({ equipmentId: 'ph-01', hours: 5, vibration: 2.0 });
            var result = engine.detectAnomalies('ph-01');
            var vibAnomaly = result.anomalies.find(function(a) { return a.type === ANOMALY_TYPES.VIBRATION_SPIKE; });
            expect(vibAnomaly).toBeDefined();
            expect(vibAnomaly.zScore).toBeGreaterThan(2);
        });

        it('should detect temperature drift', function() {
            for (var i = 0; i < 19; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 5, temperature: 37.0 });
            }
            engine.recordUsage({ equipmentId: 'ph-01', hours: 5, temperature: 55.0 });
            var result = engine.detectAnomalies('ph-01');
            var tempAnomaly = result.anomalies.find(function(a) { return a.type === ANOMALY_TYPES.TEMPERATURE_DRIFT; });
            expect(tempAnomaly).toBeDefined();
        });

        it('should detect error burst', function() {
            for (var i = 0; i < 19; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 5, errorCount: 1 });
            }
            engine.recordUsage({ equipmentId: 'ph-01', hours: 5, errorCount: 50 });
            var result = engine.detectAnomalies('ph-01');
            var errAnomaly = result.anomalies.find(function(a) { return a.type === ANOMALY_TYPES.ERROR_BURST; });
            expect(errAnomaly).toBeDefined();
        });

        it('should detect wear acceleration', function() {
            // Low usage then high usage
            for (var i = 0; i < 5; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 2 });
            }
            for (var j = 0; j < 5; j++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 8 });
            }
            var result = engine.detectAnomalies('ph-01');
            var wearAnomaly = result.anomalies.find(function(a) { return a.type === ANOMALY_TYPES.WEAR_ACCELERATION; });
            expect(wearAnomaly).toBeDefined();
            expect(wearAnomaly.accelerationRatio).toBeGreaterThan(0.3);
        });

        it('should report no anomalies for stable data', function() {
            for (var i = 0; i < 20; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 5, vibration: 0.1, temperature: 37.0, errorCount: 0 });
            }
            var result = engine.detectAnomalies('ph-01');
            expect(result.anomalies).toEqual([]);
        });

        it('should reject invalid equipmentId', function() {
            expect(engine.detectAnomalies('__proto__').success).toBe(false);
        });
    });

    // ── Dashboard Tests ────────────────────────────────────────────

    describe('getDashboard', function() {
        it('should return default dashboard for empty fleet', function() {
            var result = engine.getDashboard();
            expect(result.success).toBe(true);
            expect(result.fleetHealthScore).toBe(100);
            expect(result.equipmentCount).toBe(0);
        });

        it('should compute fleet health score', function() {
            registerDefault();
            engine.registerEquipment({ id: 'pump-01', name: 'Pump', category: 'pump', expectedLifeHours: 8000, criticality: 'high' });
            var result = engine.getDashboard();
            expect(result.fleetHealthScore).toBeGreaterThanOrEqual(90);
            expect(result.equipmentCount).toBe(2);
        });

        it('should classify equipment status', function() {
            registerDefault();
            var result = engine.getDashboard();
            expect(result.statusBreakdown.healthy).toBe(1);
        });

        it('should detect overdue maintenance', function() {
            registerDefault();
            for (var i = 0; i < 70; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 10 });
            }
            var result = engine.getDashboard();
            expect(result.statusBreakdown.overdue).toBe(1);
        });

        it('should generate recommendations for critical fleet', function() {
            registerDefault();
            for (var i = 0; i < 100; i++) {
                engine.recordUsage({ equipmentId: 'ph-01', hours: 50 });
            }
            var result = engine.getDashboard();
            expect(result.recommendations.length).toBeGreaterThan(0);
        });

        it('should return top urgent items', function() {
            registerDefault();
            engine.registerEquipment({ id: 'pump-01', name: 'Pump', category: 'pump', expectedLifeHours: 8000, criticality: 'high' });
            var result = engine.getDashboard();
            expect(result.topUrgent.length).toBeLessThanOrEqual(5);
        });
    });

    // ── Maintenance Recording Tests ────────────────────────────────

    describe('recordMaintenance', function() {
        it('should reset hours since last maintenance', function() {
            registerDefault();
            engine.recordUsage({ equipmentId: 'ph-01', hours: 200 });
            engine.recordMaintenance('ph-01');
            var eq = engine.getEquipment('ph-01');
            expect(eq.equipment.hoursSinceLastMaintenance).toBe(0);
            expect(eq.equipment.lastMaintenanceDate).not.toBeNull();
        });

        it('should reject invalid id', function() {
            expect(engine.recordMaintenance('__proto__').success).toBe(false);
            expect(engine.recordMaintenance('unknown').success).toBe(false);
        });
    });

    // ── Edge Cases ─────────────────────────────────────────────────

    describe('edge cases', function() {
        it('should handle prototype pollution attempt in equipmentId', function() {
            var result = engine.registerEquipment({ id: 'prototype', category: 'pump', expectedLifeHours: 1000 });
            expect(result.success).toBe(false);
        });

        it('should handle constructor as equipmentId', function() {
            var result = engine.recordUsage({ equipmentId: 'constructor', hours: 5 });
            expect(result.success).toBe(false);
        });

        it('exports module constants', function() {
            expect(VALID_CATEGORIES).toContain('printhead');
            expect(VALID_CRITICALITIES).toContain('critical');
            expect(ANOMALY_TYPES.VIBRATION_SPIKE).toBe('vibration_spike');
        });
    });
});
