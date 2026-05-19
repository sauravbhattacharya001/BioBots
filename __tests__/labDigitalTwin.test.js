'use strict';

/**
 * Tests for labDigitalTwin — autonomous lab environment simulation module.
 *
 * Covers: registerEquipment, registerReagent, recordEnvironmentalReading,
 * recordEquipmentUsage, recordReagentUsage, simulate, getHealthScore,
 * detectAnomalies, getTimeline, exportState, DEMO_SCENARIOS.
 *
 * NOTE: This suite uses Jest's globals (describe / it / beforeEach / expect)
 * to match the rest of the repository. It was previously authored against the
 * Node built-in test runner (node:test + node:assert/strict), which Jest
 * silently failed to load ("Your test suite must contain at least one test"),
 * meaning ~50 assertions covering this module were never actually executed.
 */

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
    expect(eq.id).toBe('P1');
    expect(eq.name).toBe('Printer-1');
    expect(eq.type).toBe('bioprinter');
    expect(eq.maintenanceIntervalDays).toBe(90);
    expect(eq.totalUsageHours).toBe(0);
  });

  it('defaults name to id when not provided', () => {
    const eq = twin.registerEquipment({ id: 'X1' });
    expect(eq.name).toBe('X1');
  });

  it('throws on missing id', () => {
    expect(() => twin.registerEquipment({})).toThrow(/id/);
  });

  it('throws on null input', () => {
    expect(() => twin.registerEquipment(null)).toThrow(/id/);
  });

  it('throws on dangerous key (prototype pollution)', () => {
    expect(() => twin.registerEquipment({ id: '__proto__' })).toThrow(/Invalid/);
    expect(() => twin.registerEquipment({ id: 'constructor' })).toThrow(/Invalid/);
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
    expect(r.id).toBe('R1');
    expect(r.name).toBe('Alginate 2%');
    expect(r.currentVolumeMl).toBe(500);
    expect(r.reorderThresholdMl).toBe(100);
    expect(r.initialVolumeMl).toBe(500);
  });

  it('throws on missing id', () => {
    expect(() => twin.registerReagent({})).toThrow(/id/);
  });

  it('throws on dangerous key', () => {
    expect(() => twin.registerReagent({ id: '__proto__' })).toThrow(/Invalid/);
  });

  it('defaults currentVolumeMl to 1000', () => {
    const r = twin.registerReagent({ id: 'R2' });
    expect(r.currentVolumeMl).toBe(1000);
    expect(r.initialVolumeMl).toBe(1000);
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
    expect(r.temperatureC).toBe(23.5);
    expect(r.humidityPct).toBe(48);
    expect(r.co2Pct).toBe(5.2);
    expect(r.particleCount).toBe(120);
    expect(r.timestamp).toBeTruthy();
  });

  it('defaults values when not provided', () => {
    const r = twin.recordEnvironmentalReading({});
    expect(r.temperatureC).toBe(22);
    expect(r.humidityPct).toBe(45);
    expect(r.co2Pct).toBe(5);
    expect(r.particleCount).toBe(100);
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
    expect(state.equipment.P1.totalUsageHours).toBe(6);
  });

  it('throws on unknown equipment', () => {
    expect(() => twin.recordEquipmentUsage('UNKNOWN', 1)).toThrow(/Unknown equipment/);
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
    expect(state.reagents.R1.currentVolumeMl).toBe(450);
  });

  it('does not go below zero', () => {
    twin.recordReagentUsage('R1', 600, 'bulk use');
    const state = twin.exportState();
    expect(state.reagents.R1.currentVolumeMl).toBe(0);
  });

  it('throws on unknown reagent', () => {
    expect(() => twin.recordReagentUsage('UNKNOWN', 10)).toThrow(/Unknown reagent/);
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
    expect(score.overall).toBeGreaterThanOrEqual(80);
    expect(score.equipmentCount).toBe(1);
    expect(score.reagentCount).toBe(1);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(score.grade);
  });

  it('degrades when reagent is below threshold', () => {
    const twin = createLabDigitalTwin();
    twin.registerReagent({ id: 'R1', currentVolumeMl: 50, reorderThresholdMl: 100 });
    const score = twin.getHealthScore();
    expect(score.reagents).toBeLessThan(100);
  });

  it('degrades when reagent is depleted', () => {
    const twin = createLabDigitalTwin();
    twin.registerReagent({ id: 'R1', currentVolumeMl: 0, reorderThresholdMl: 100 });
    const score = twin.getHealthScore();
    expect(score.reagents).toBeLessThan(50);
  });

  it('handles empty twin (no equipment or reagents)', () => {
    const twin = createLabDigitalTwin();
    const score = twin.getHealthScore();
    expect(score.overall).toBe(100);
    expect(score.equipmentCount).toBe(0);
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
    expect(twin.detectAnomalies()).toEqual([]);
  });

  it('detects temperature anomaly via z-score', () => {
    const twin = createLabDigitalTwin();
    for (let i = 0; i < 9; i++) {
      twin.recordEnvironmentalReading({ temperatureC: 22, humidityPct: 45, co2Pct: 5, particleCount: 100 });
    }
    twin.recordEnvironmentalReading({ temperatureC: 45, humidityPct: 45, co2Pct: 5, particleCount: 100 });
    const anomalies = twin.detectAnomalies();
    expect(anomalies.length).toBeGreaterThan(0);
    const tempAnomaly = anomalies.find(a => a.metric === 'temperatureC');
    expect(tempAnomaly).toBeTruthy();
    expect(tempAnomaly.zScore).toBeGreaterThan(2);
    expect(['warning', 'critical']).toContain(tempAnomaly.severity);
  });

  it('no anomalies for consistent readings', () => {
    const twin = createLabDigitalTwin();
    for (let i = 0; i < 10; i++) {
      twin.recordEnvironmentalReading({ temperatureC: 22, humidityPct: 45, co2Pct: 5, particleCount: 100 });
    }
    const anomalies = twin.detectAnomalies();
    expect(anomalies.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// simulate
// ---------------------------------------------------------------------------

describe('simulate', () => {
  it('returns structured simulation result', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.standard();
    const sim = twin.simulate(30);
    expect(sim.simulationDays).toBe(30);
    expect(sim.healthScore).toBeTruthy();
    expect(Array.isArray(sim.equipmentFailureRisks)).toBe(true);
    expect(Array.isArray(sim.reagentDepletions)).toBe(true);
    expect(Array.isArray(sim.environmentalDrifts)).toBe(true);
    expect(Array.isArray(sim.recommendations)).toBe(true);
  });

  it('recommendations include priority field', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.highThroughput();
    const sim = twin.simulate(60);
    expect(sim.recommendations.length).toBeGreaterThan(0);
    for (const rec of sim.recommendations) {
      expect(['critical', 'high', 'medium', 'low']).toContain(rec.priority);
      expect(rec.category).toBeTruthy();
      expect(rec.message).toBeTruthy();
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
    expect(maintenanceRecs.length).toBeGreaterThan(0);
    expect(maintenanceRecs[0].priority).toBe('critical');
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
    expect(reagentRecs.length).toBeGreaterThan(0);
  });

  it('defaults to 30 days', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.startup();
    const sim = twin.simulate();
    expect(sim.simulationDays).toBe(30);
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
    expect(Array.isArray(events)).toBe(true);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].daysFromNow).toBeGreaterThanOrEqual(events[i - 1].daysFromNow);
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
    expect(maintEvents.length).toBeGreaterThan(0);
  });

  it('includes expiry events', () => {
    const twin = createLabDigitalTwin();
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    twin.registerReagent({ id: 'R1', name: 'Expiring', expiryDate: soon, currentVolumeMl: 500 });
    const events = twin.getTimeline(30);
    const expiryEvents = events.filter(e => e.type === 'expiry');
    expect(expiryEvents.length).toBeGreaterThan(0);
  });

  it('defaults to 30 days window', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.startup();
    const events = twin.getTimeline();
    expect(Array.isArray(events)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// exportState
// ---------------------------------------------------------------------------

describe('exportState', () => {
  it('returns JSON state with all sections', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.standard();
    const state = twin.exportState();
    expect(state.equipment).toBeTruthy();
    expect(state.reagents).toBeTruthy();
    expect(Array.isArray(state.environmentalReadings)).toBe(true);
    expect(state.healthScore).toBeTruthy();
    expect(state.exportedAt).toBeTruthy();
  });

  it('returns text format when requested', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.standard();
    const text = twin.exportState('text');
    expect(typeof text).toBe('string');
    expect(text).toContain('Lab Digital Twin State');
    expect(text).toContain('Equipment');
    expect(text).toContain('Reagents');
  });
});

// ---------------------------------------------------------------------------
// DEMO_SCENARIOS
// ---------------------------------------------------------------------------

describe('DEMO_SCENARIOS', () => {
  it('standard scenario is functional', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.standard();
    const sim = twin.simulate(14);
    expect(sim.healthScore.overall).toBeGreaterThan(0);
    expect(sim.equipmentFailureRisks.length).toBeGreaterThan(0);
  });

  it('highThroughput scenario is functional', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.highThroughput();
    const score = twin.getHealthScore();
    expect(score.equipmentCount).toBe(3);
    expect(score.reagentCount).toBe(2);
  });

  it('startup scenario is functional', () => {
    const twin = createLabDigitalTwin.DEMO_SCENARIOS.startup();
    const score = twin.getHealthScore();
    expect(score.equipmentCount).toBe(1);
    expect(score.reagentCount).toBe(1);
    expect(score.readingCount).toBe(1);
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
    expect(state.equipment.P1.totalUsageHours).toBe(10);
    expect(state.reagents.R1.currentVolumeMl).toBe(50);

    const score = twin.getHealthScore();
    expect(score.overall).toBeGreaterThan(0);
    expect(score.overall).toBeLessThanOrEqual(100);
  });
});
