'use strict';

var cew = require('../docs/shared/contaminationEarlyWarning');

describe('ContaminationEarlyWarning', function () {
  var ew;

  beforeEach(function () {
    ew = cew.createContaminationEarlyWarning();
  });

  describe('ingest()', function () {
    test('throws on non-object input', function () {
      expect(function () { ew.ingest(null); }).toThrow();
      expect(function () { ew.ingest('bad'); }).toThrow();
    });

    test('accepts valid readings and returns reading index', function () {
      var r = ew.ingest({ temperature: 22, humidity: 45 });
      expect(r.readingIndex).toBe(1);
      expect(typeof r.signalCount).toBe('number');
      expect(Array.isArray(r.signals)).toBe(true);
    });

    test('safe readings produce no signals', function () {
      var r = ew.ingest({ temperature: 22, humidity: 45, particleCount: 1000, airChangesPerHour: 30 });
      expect(r.signalCount).toBe(0);
    });

    test('critical value generates CRITICAL_VALUE signal', function () {
      var r = ew.ingest({ temperature: 35 }); // above critical max 32
      var criticals = r.signals.filter(function (s) { return s.type === 'CRITICAL_VALUE'; });
      expect(criticals.length).toBeGreaterThan(0);
      expect(criticals[0].param).toBe('temperature');
    });

    test('warn-range value generates WARN_VALUE signal', function () {
      var r = ew.ingest({ humidity: 68 }); // within warn (20-70) but outside safe (30-60)
      var warns = r.signals.filter(function (s) { return s.type === 'WARN_VALUE'; });
      expect(warns.length).toBeGreaterThan(0);
    });

    test('ignores unknown parameters', function () {
      var r = ew.ingest({ unknownSensor: 999 });
      expect(r.signalCount).toBe(0);
    });

    test('ignores NaN values', function () {
      var r = ew.ingest({ temperature: 'not-a-number' });
      expect(r.signalCount).toBe(0);
    });
  });

  describe('trend detection', function () {
    test('detects deteriorating trend when values drift toward warn zone', function () {
      // Feed gradually increasing temperatures toward warn zone
      for (var i = 0; i < 8; i++) {
        ew.ingest({ temperature: 22 + i * 0.8 }); // 22 -> 27.6
      }
      // The forecast should extrapolate into warn territory
      var report = ew.trendReport();
      expect(report.temperature).toBeDefined();
      expect(report.temperature.readings).toBe(8);
      expect(report.temperature.rateOfChange).toBeGreaterThan(0);
    });
  });

  describe('correlation detection', function () {
    test('detects particle-ACH divergence', function () {
      // Need at least rocWindow (5) readings
      var signalFound = false;
      for (var i = 0; i < 8; i++) {
        var result = ew.ingest({
          particleCount: 1000 + i * 400,       // rising
          airChangesPerHour: 30 - i * 2         // falling
        });
        if (result.signals.some(function (s) { return s.type === 'CORRELATED_DETERIORATION'; })) {
          signalFound = true;
        }
      }
      expect(signalFound).toBe(true);
    });

    test('detects humidity+temperature combined risk', function () {
      ew.ingest({ humidity: 50, temperature: 22 });
      var r = ew.ingest({ humidity: 70, temperature: 27 });
      var correlated = r.signals.filter(function (s) { return s.param === 'humidity+temperature'; });
      expect(correlated.length).toBeGreaterThan(0);
    });
  });

  describe('assess()', function () {
    test('returns CLEAR when all params are safe', function () {
      ew.ingest({ temperature: 22, humidity: 45, particleCount: 1000 });
      var a = ew.assess();
      expect(a.level).toBe('CLEAR');
      expect(a.priority).toBe(0);
    });

    test('returns WARNING for single critical param', function () {
      ew.ingest({ temperature: 35 }); // critical
      var a = ew.assess();
      expect(a.priority).toBeGreaterThanOrEqual(3); // WARNING or ALERT
    });

    test('returns ALERT for 2+ critical params', function () {
      ew.ingest({ temperature: 35, humidity: 90 }); // both critical
      var a = ew.assess();
      expect(a.level).toBe('ALERT');
      expect(a.priority).toBe(4);
    });

    test('provides mitigations for non-safe params', function () {
      ew.ingest({ temperature: 30 }); // warn range
      var a = ew.assess();
      expect(a.mitigations.length).toBeGreaterThan(0);
      expect(a.mitigations[0].param).toBe('temperature');
      expect(a.mitigations[0].action).toBeTruthy();
    });

    test('mitigations are sorted by urgency descending', function () {
      ew.ingest({ temperature: 35, particleCount: 40000 }); // both critical
      var a = ew.assess();
      for (var i = 1; i < a.mitigations.length; i++) {
        expect(a.mitigations[i - 1].urgency).toBeGreaterThanOrEqual(a.mitigations[i].urgency);
      }
    });
  });

  describe('trendReport()', function () {
    test('returns empty report with no data', function () {
      var report = ew.trendReport();
      expect(Object.keys(report).length).toBe(0);
    });

    test('returns per-parameter stats after ingestion', function () {
      ew.ingest({ temperature: 22, humidity: 45 });
      ew.ingest({ temperature: 23, humidity: 46 });
      var report = ew.trendReport();
      expect(report.temperature).toBeDefined();
      expect(report.temperature.current).toBe(23);
      expect(report.temperature.readings).toBe(2);
      expect(report.temperature.unit).toBe('°C');
      expect(report.humidity.current).toBe(46);
    });

    test('forecasts future values', function () {
      for (var i = 0; i < 5; i++) {
        ew.ingest({ temperature: 20 + i });
      }
      var report = ew.trendReport();
      expect(report.temperature.forecast).toBeGreaterThan(24);
    });
  });

  describe('getWarnings()', function () {
    test('returns empty array with no warnings', function () {
      ew.ingest({ temperature: 22 });
      expect(ew.getWarnings()).toEqual([]);
    });

    test('returns warnings after critical ingestion', function () {
      ew.ingest({ temperature: 35 });
      var w = ew.getWarnings();
      expect(w.length).toBeGreaterThan(0);
      expect(w[0].signals.length).toBeGreaterThan(0);
    });

    test('filters by since timestamp', function () {
      ew.ingest({ temperature: 35, timestamp: 1000 });
      ew.ingest({ temperature: 35, timestamp: 2000 });
      var w = ew.getWarnings({ since: 1500 });
      expect(w.length).toBe(1);
    });
  });

  describe('reset()', function () {
    test('clears all state', function () {
      ew.ingest({ temperature: 35 });
      ew.reset();
      var a = ew.assess();
      expect(a.level).toBe('CLEAR');
      expect(ew.getWarnings()).toEqual([]);
      expect(Object.keys(ew.trendReport()).length).toBe(0);
    });
  });

  describe('RAPID_CHANGE detection', function () {
    test('detects rapid rate of change', function () {
      // Safe range for temperature is 20-25 (range=5), threshold is 15% = 0.75 per reading
      var signalFound = false;
      ew.ingest({ temperature: 22 });
      ew.ingest({ temperature: 22 });
      ew.ingest({ temperature: 22 });
      ew.ingest({ temperature: 22 });
      var r = ew.ingest({ temperature: 27 }); // jump of 5 over 5 readings = rate 1.0 per reading
      signalFound = r.signals.some(function (s) { return s.type === 'RAPID_CHANGE'; });
      expect(signalFound).toBe(true);
    });
  });

  describe('EMA configuration', function () {
    test('custom emaAlpha affects smoothing', function () {
      var ew1 = cew.createContaminationEarlyWarning({ emaAlpha: 0.1 });
      var ew2 = cew.createContaminationEarlyWarning({ emaAlpha: 0.9 });
      ew1.ingest({ temperature: 22 });
      ew2.ingest({ temperature: 22 });
      ew1.ingest({ temperature: 30 });
      ew2.ingest({ temperature: 30 });
      var r1 = ew1.trendReport().temperature.ema;
      var r2 = ew2.trendReport().temperature.ema;
      // Higher alpha = more responsive = closer to 30
      expect(r2).toBeGreaterThan(r1);
    });
  });

  describe('maxHistory', function () {
    test('limits stored readings', function () {
      var ew3 = cew.createContaminationEarlyWarning({ maxHistory: 5 });
      for (var i = 0; i < 10; i++) {
        ew3.ingest({ temperature: 22 + i });
      }
      var report = ew3.trendReport();
      expect(report.temperature.readings).toBe(5);
    });
  });
});
