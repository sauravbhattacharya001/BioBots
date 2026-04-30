'use strict';

/**
 * Tests for labDigitalTwin — autonomous lab environment simulation module.
 *
 * Covers: registerEquipment, registerReagent, recordEnvironmentalReading,
 * recordEquipmentUsage, recordReagentUsage, simulate, getHealthScore,
 * detectAnomalies, getTimeline, exportState, DEMO_SCENARIOS.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createLabDigitalTwin } = require('../docs/shared/labDigitalTwin');

// ---------------------------------------------------------------------------
// registerEquipment
// ---------------------------------------------------------------------------

describe('registerEquipment', () => {
  let twin;
  beforeEach(() => { twin = createLabDigitalTwin(); });

  it('registers equipment with all fields', () => {
    const eq = twin.registerEquipment({
      id: 'P1', name: 'Printer-1', type: 'bioprinter',
      installDate: '2025-01-15', maintenanceIntervalDays: 90,
      usageHoursPerDay: 6
    });
    assert.equal(eq.id, 'P1');
    assert.equal(eq.name, 'Printer-1');
    assert.equal(eq.type, 'bioprinter');
    assert.equal(eq.maintenanceIntervalDays, 90);
    assert.equal(eq.totalUsageHours, 0);
  });

  it('defaults name to id when not provided', () => {
    const eq = twin.registerEquipment({ id: 'X1' });
    assert.equal(eq.name, 'X1');
  });

  it('throws on missing id', () => {
    assert.throws(() => twin.registerEquipment({}), /id/);
  });

  it('throws on null input', () => {
    assert.throws(() => twin.registerEquipment(null), /id/);
  });

  it('throws on dangerous key (prototype pollution)', () => {
    assert.throws(() => twin.registerEquipment({ id: '__proto__' }), /Invalid/);
    assert.throws(() => twin.registerEquipment({ id: 'constructor' }), /Invalid/);
  });
});

// ---------------------------------------------------------------------------
// registerReagent
// ---------------------------------------------------------------------------

describe('registerReagent', () => {
  let twin;
  beforeEach(() => { twin = createLabDigitalTwin(); });

  it('registers reagent with all fields', () => {
    const r = twin.registerReagent({
      id: 'R1', name: 'Alginate 2%', lotNumber: 'LOT-A1',
      expiryDate: '2026-06-01', currentVolumeMl: 500, reorderThresholdMl: 100
    });
    assert.equal(r.id, 'R1');
    assert.equal(r.name, 'Alginate 2%');
    assert.equal(r.currentVolumeMl, 500);
    assert.equal(r.reorderThresholdMl, 100);
    assert.equal(r.initialVolumeMl, 500);
  });

  it('throws on missing id', () => {
    assert.throws(() => twin.registerReagent({}), /id/);
  });

  it('throws on dangerous key', () => {
    assert.throws(() => twin.registerReagent({ id: '__proto__' }), /Invalid/);
  });

  it('defaults currentVolumeMl to 1000', () => {
    const r = twin.registerReagent({ id: 'R2' });
    assert.equal(r.currentVolumeMl, 1000);
    assert.equal(r.initialVolumeMl, 1000);
  });
});

// ---------------------------------------------------------------------------
// recordEnvironmentalReading
// ---------------------------------------------------------------------------

describe('recordEnvironmentalReading', () => {
  let twin;
  beforeEach(() => { twin = createLabDigitalTwin(); });

  it('records reading with all fields', () => {
    const r = twin.recordEnvironmentalReading({
      temperatureC: 23.5, humidityPct: 48, co2Pct: 5.2, particleCount: 120
    });
    assert.equal(r.temperatureC, 23.5);
    assert.equal(r.humidityPct, 48);
    assert.equal(r.co2Pct, 5.2);
    assert.equal(r.particleCount, 120);
    assert.ok(r.timestamp);
  });

  it('defaults values when not provided', () => {
    const r = twin.recordEnvironmentalReading({});
    assert.equal(r.temperatureC, 22);
    assert.equal(r.humidityPct, 45);
    assert.equal(r.co2Pct, 5);
    assert.equal(r.particleCount, 100);
  });
});

// ---------------------------------------------------------------------------
// recordEquipmentUsage
// ---------------------------------------------------------------------------

describe('recordEquipmentUsage', () => {
  let twin;
  beforeEach(() => {
    twin = createLabDigitalTwin();
    twin.registerEquipment({ id: 'P1', name: 'Printer', usageHoursPerDay: 6 });
  });

  it('records usage and increments totalUsageHours', () => {
    twin.recordEquipmentUsage('P1', 4, 'scaffold print');
    twin.recordEquipmentUsage('P1', 2, 'test run');
    const state = twin.exportState();
    assert.equal(state.equipment.P1.totalUsageHours, 6);
  });

  it('throws on unknown equipment', () => {
    assert.throws(() => twin.recordEquipmentUsage('UNKNOWN', 1), /Unknown equipment/);
  });
});

// ---------------------------------------------------------------------------
// recordReagentUsage
// ---------------------------------------------------------------------------

describe('recordReagentUsage', () => {
  let twin;
  beforeEach(() => {
    twin = createLabDigitalTwin();
    twin.registerReagent({ id: 'R1', currentVolumeMl: 500, reorderThresholdMl: 100 });
  });

  it('decrements volume', () => {
    twin.recordReagentUsage('R1', 50, 'print job');
    const state = twin.exportState();
    assert.equal(state.reagents.R1.currentVolumeMl, 450);
  });

  it('does not go below zero', () => {
    twin.recordReagentUsage('R1', 600, 'bulk use');
    const state = twin.exportState();
    assert.equal(state.reagents.R1.currentVolumeMl, 0);
  });

  it('throws on unknown reagent', () => {
    assert.throws(() => twin.recordReagentUsage('UNKNOWN', 10), /Unknown reagent/);
  });
});

// ---------------------------------------------------------------------------
// getHealthScore
// ---------------------------------------------------------------------------

describe('getHealthScore', () => {
  it('returns high score for fresh twin with no issues', () => {
    const twin = createLabDigitalTwin();
    twin.registerEquipment({ id: 'P1', maintenanceIntervalDays: 90 });
    twin.registerReagent({ id: 'R1', currentVolumeMl: 500, reorderThresholdMl: 100 });
    const score = twin.getHealthScore();
    assert.ok(score.overall >= 80);
    assert.equal(score.equipmentCount, 1);
    assert.equal(score.reagentCount, 1);
    assert.ok(['A', 'B', 'C', 'D', 'F'].includes(score.grade));
  });

  it('degrades when reagent is below threshold', () => {
    const twin = createLabDigitalTwin();
    twin.registerReagent({ id: 'R1', currentVolumeMl: 50, reorderThresholdMl: 100 });
    const score = twin.getHealthScore();
    assert.ok(score.reagents < 100);
  });

  it('degrades when reagent is depleted', () => {
    const twin = createLabDigitalTwin();
    twin.registerReagent({ id: 'R1', currentVolumeMl: 0, reorderThresholdMl: 100 });
    const score = twin.getHealthScore();
    assert.ok(score.reagents < 50);
  });

  it('handles empty twin (no equipment or reagents)', () => {
    const twin = createLabDigitalTwin();
    const score = twin.getHealthScore();
    assert.equal(score.overall, 100);
    assert.equal(score.equipmentCount, 0);
  });
});

// ---------------------------------------------------------------------------
// detectAnomalies
// ---------------------------------------------------------------------------

describe('detectAnomalies', () => {
  it('returns empty for fewer than 5 readings', () => {
    const twin = createLabDigitalTwin();
    for (let i = 0; i < 4; i++) {
      twin.recordEnvironmentalReading({ temperatureC: 22 });
    }
    assert.deepEqual(twin.detectAnomalies(), []);
  });

  it('detects temperature anomaly via z-score', () => {
    const twin = createLabDigitalTwin();
    for (let i = 0; i < 9; i++) {
      twin.recordEnvironmentalReading({ temperatureC: 22, humidityPct: 45, co2Pct: 5, particleCount: 100 });
    }
    twin.recordEnvironmentalReading({ temperatureC: 45, humidityPct: 45, co2Pct: 5, particleCount: 100 });
    const anomalies = twin.detectAnomalies();
    assert.ok(anomalies.length > 0);
    const tempAnomaly = anomalies.find(a => a.metric === 'temperatureC');
    assert.ok(tempAnomaly);
    assert.ok(tempAnomaly.zScore > 2);
    assert.ok(['warning', 'critical'].includes(tempAnomaly.severity));
  });

  it('no anomalies for consistent readings', () => {
    const twin = createLabDigitalTwin();
    for (let i = 0; i < 10; i++) {
      twin.recordEnvironmentalReading({ temperatureC: 22, humidityPct: 45, co2Pct: 5, particleCount: 100 });
    }
    const anomalies = twin.detectAnomalies();
    assert.equal(anomalies.length, 0);
  });
});

// ---------------------------------------------------------------------------
// simulate
// ---------------------------------------------------------------------------

describe('simulate', () => {
  it('returns structured simulation result', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.standard();
    const sim = twin.simulate(30);
    assert.equal(sim.simulationDays, 30);
    assert.ok(sim.healthScore);
    assert.ok(Array.isArray(sim.equipmentFailureRisks));
    assert.ok(Array.isArray(sim.reagentDepletions));
    assert.ok(Array.isArray(sim.environmentalDrifts));
    assert.ok(Array.isArray(sim.recommendations));
  });

  it('recommendations include priority field', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.highThroughput();
    const sim = twin.simulate(60);
    assert.ok(sim.recommendations.length > 0);
    for (const rec of sim.recommendations) {
      assert.ok(['critical', 'high', 'medium', 'low'].includes(rec.priority),
        `Unexpected priority: ${rec.priority}`);
      assert.ok(rec.category);
      assert.ok(rec.message);
    }
  });

  it('detects overdue maintenance', () => {
    const twin = createLabDigitalTwin();
    twin.registerEquipment({
      id: 'OLD', name: 'Old Printer', maintenanceIntervalDays: 30,
      lastMaintenanceDate: '2025-01-01', usageHoursPerDay: 8
    });
    const sim = twin.simulate(7);
    const maintenanceRecs = sim.recommendations.filter(r => r.category === 'equipment');
    assert.ok(maintenanceRecs.length > 0);
    assert.equal(maintenanceRecs[0].priority, 'critical');
  });

  it('detects reagent depletion warning', () => {
    const twin = createLabDigitalTwin();
    twin.registerReagent({
      id: 'LOW', name: 'Low Reagent', currentVolumeMl: 30, reorderThresholdMl: 50
    });
    twin.recordReagentUsage('LOW', 10, 'use1');
    twin.recordReagentUsage('LOW', 10, 'use2');
    const sim = twin.simulate(30);
    const reagentRecs = sim.recommendations.filter(r => r.category === 'reagent');
    assert.ok(reagentRecs.length > 0);
  });

  it('defaults to 30 days', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.startup();
    const sim = twin.simulate();
    assert.equal(sim.simulationDays, 30);
  });
});

// ---------------------------------------------------------------------------
// getTimeline
// ---------------------------------------------------------------------------

describe('getTimeline', () => {
  it('returns sorted events', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.standard();
    twin.recordReagentUsage('ALG', 100, 'batch 1');
    twin.recordReagentUsage('ALG', 100, 'batch 2');
    const events = twin.getTimeline(90);
    assert.ok(Array.isArray(events));
    for (let i = 1; i < events.length; i++) {
      assert.ok(events[i].daysFromNow >= events[i - 1].daysFromNow);
    }
  });

  it('includes maintenance events', () => {
    const twin = createLabDigitalTwin();
    twin.registerEquipment({
      id: 'P1', name: 'Printer', maintenanceIntervalDays: 30,
      lastMaintenanceDate: '2026-04-20'
    });
    const events = twin.getTimeline(60);
    const maintEvents = events.filter(e => e.type === 'maintenance');
    assert.ok(maintEvents.length > 0);
  });

  it('includes expiry events', () => {
    const twin = createLabDigitalTwin();
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    twin.registerReagent({ id: 'R1', name: 'Expiring', expiryDate: soon, currentVolumeMl: 500 });
    const events = twin.getTimeline(30);
    const expiryEvents = events.filter(e => e.type === 'expiry');
    assert.ok(expiryEvents.length > 0);
  });

  it('defaults to 30 days window', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.startup();
    const events = twin.getTimeline();
    assert.ok(Array.isArray(events));
  });
});

// ---------------------------------------------------------------------------
// exportState
// ---------------------------------------------------------------------------

describe('exportState', () => {
  it('returns JSON state with all sections', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.standard();
    const state = twin.exportState();
    assert.ok(state.equipment);
    assert.ok(state.reagents);
    assert.ok(Array.isArray(state.environmentalReadings));
    assert.ok(state.healthScore);
    assert.ok(state.exportedAt);
  });

  it('returns text format when requested', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.standard();
    const text = twin.exportState('text');
    assert.equal(typeof text, 'string');
    assert.ok(text.includes('Lab Digital Twin State'));
    assert.ok(text.includes('Equipment'));
    assert.ok(text.includes('Reagents'));
  });
});

// ---------------------------------------------------------------------------
// DEMO_SCENARIOS
// ---------------------------------------------------------------------------

describe('DEMO_SCENARIOS', () => {
  it('standard scenario is functional', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.standard();
    const sim = twin.simulate(14);
    assert.ok(sim.healthScore.overall > 0);
    assert.ok(sim.equipmentFailureRisks.length > 0);
  });

  it('highThroughput scenario is functional', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.highThroughput();
    const score = twin.getHealthScore();
    assert.equal(score.equipmentCount, 3);
    assert.equal(score.reagentCount, 2);
  });

  it('startup scenario is functional', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.startup();
    const score = twin.getHealthScore();
    assert.equal(score.equipmentCount, 1);
    assert.equal(score.reagentCount, 1);
    assert.equal(score.readingCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Integration: full lifecycle
// ---------------------------------------------------------------------------

describe('full lifecycle integration', () => {
  it('tracks depletion over multiple usage cycles', () => {
    const twin = createLabDigitalTwin();
    twin.registerEquipment({ id: 'P1', maintenanceIntervalDays: 90 });
    twin.registerReagent({ id: 'R1', currentVolumeMl: 200, reorderThresholdMl: 50 });

    for (let i = 0; i < 5; i++) {
      twin.recordEquipmentUsage('P1', 2, `job ${i}`);
      twin.recordReagentUsage('R1', 30, `job ${i}`);
      twin.recordEnvironmentalReading({
        temperatureC: 22 + Math.random() * 0.5,
        humidityPct: 45, co2Pct: 5, particleCount: 100
      });
    }

    const state = twin.exportState();
    assert.equal(state.equipment.P1.totalUsageHours, 10);
    assert.equal(state.reagents.R1.currentVolumeMl, 50);

    const score = twin.getHealthScore();
    assert.ok(score.overall > 0);
    assert.ok(score.overall <= 100);
  });
});
