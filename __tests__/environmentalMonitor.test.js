'use strict';

var em = require('../docs/shared/environmentalMonitor');

describe('Environmental Monitor', function () {
  test('creates monitor with default mammalian profile', function () {
    var mon = em.createEnvironmentalMonitor();
    expect(mon.limits.temperature.min).toBe(36);
    expect(mon.limits.temperature.max).toBe(38);
  });

  test('adds readings and detects alerts', function () {
    var mon = em.createEnvironmentalMonitor();
    mon.addReading({ temperature: 37.0, co2: 5.0, humidity: 95 });
    mon.addReading({ temperature: 40.0, co2: 5.0, humidity: 95 }); // out of range
    var report = mon.getReport();
    expect(report.totalReadings).toBe(2);
    expect(report.alerts.length).toBe(1);
    expect(report.alerts[0].param).toBe('temperature');
    expect(report.alerts[0].severity).toBe('critical');
  });

  test('computes stats correctly', function () {
    var mon = em.createEnvironmentalMonitor();
    mon.addReading({ temperature: 36.5 });
    mon.addReading({ temperature: 37.5 });
    var stats = mon.getStats('temperature');
    expect(stats.count).toBe(2);
    expect(stats.mean).toBe(37);
    expect(stats.inRange).toBe(2);
  });

  test('bulk add works', function () {
    var mon = em.createEnvironmentalMonitor();
    mon.addBulk([
      { temperature: 37, co2: 5 },
      { temperature: 37.1, co2: 5.1 }
    ]);
    expect(mon.getReadings().length).toBe(2);
  });

  test('exports CSV', function () {
    var mon = em.createEnvironmentalMonitor();
    mon.addReading({ temperature: 37, co2: 5, humidity: 95, o2: 20 });
    var csv = mon.exportCSV();
    expect(csv).toContain('timestamp,temperature,co2,humidity,o2,notes');
    expect(csv).toContain(',37,5,95,20,');
  });

  test('stability score is 100 for perfect readings', function () {
    var mon = em.createEnvironmentalMonitor();
    mon.addReading({ temperature: 37, co2: 5, humidity: 95, o2: 20 });
    expect(mon.getStabilityScore()).toBe(100);
  });

  test('filters alerts by severity', function () {
    var mon = em.createEnvironmentalMonitor();
    mon.addReading({ temperature: 50 }); // critical
    mon.addReading({ temperature: 38.2 }); // caution (0.2/2 = 0.1, <= 0.2)
    var critical = mon.getAlerts({ severity: 'critical' });
    var caution = mon.getAlerts({ severity: 'caution' });
    expect(critical.length).toBe(1);
    expect(caution.length).toBe(1);
  });

  test('clear resets state', function () {
    var mon = em.createEnvironmentalMonitor();
    mon.addReading({ temperature: 37 });
    mon.clear();
    expect(mon.getReadings().length).toBe(0);
  });

  test('custom limits override profile', function () {
    var mon = em.createEnvironmentalMonitor({
      limits: { temperature: { min: 35, max: 40 } }
    });
    expect(mon.limits.temperature.min).toBe(35);
    expect(mon.limits.temperature.max).toBe(40);
  });

  test('unknown profile throws', function () {
    expect(function () {
      em.createEnvironmentalMonitor({ profiles: ['alien'] });
    }).toThrow('Unknown profile');
  });
});
