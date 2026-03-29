'use strict';

/**
 * Environmental Monitor — track and validate incubator/lab conditions.
 *
 * Logs temperature, CO₂ %, humidity, and optional O₂ readings.
 * Detects out-of-range values, computes rolling stats, and flags
 * excursions so users can correlate environmental drift with cell
 * viability or print quality issues.
 *
 * @example
 *   var em = createEnvironmentalMonitor({ profiles: ['mammalian'] });
 *   em.addReading({ temperature: 37.2, co2: 5.1, humidity: 95 });
 *   em.addReading({ temperature: 39.5, co2: 5.0, humidity: 94 });
 *   var report = em.getReport();
 *   console.log(report.alerts); // [{ param: 'temperature', value: 39.5, ... }]
 */

/* ── built-in environment profiles ───────────────────────────── */
var PROFILES = {
  mammalian: {
    label: 'Mammalian Cell Culture',
    temperature: { min: 36.0, max: 38.0, unit: '°C' },
    co2:         { min: 4.5,  max: 5.5,  unit: '%' },
    humidity:    { min: 90,   max: 100,  unit: '%' },
    o2:          { min: 18,   max: 21,   unit: '%' }
  },
  hypoxic: {
    label: 'Hypoxic Culture',
    temperature: { min: 36.0, max: 38.0, unit: '°C' },
    co2:         { min: 4.5,  max: 5.5,  unit: '%' },
    humidity:    { min: 90,   max: 100,  unit: '%' },
    o2:          { min: 1,    max: 5,    unit: '%' }
  },
  bacterial: {
    label: 'Bacterial Culture',
    temperature: { min: 35.0, max: 39.0, unit: '°C' },
    co2:         { min: 0,    max: 100,  unit: '%' },
    humidity:    { min: 0,    max: 100,  unit: '%' },
    o2:          { min: 18,   max: 21,   unit: '%' }
  },
  yeast: {
    label: 'Yeast Culture',
    temperature: { min: 28.0, max: 32.0, unit: '°C' },
    co2:         { min: 0,    max: 100,  unit: '%' },
    humidity:    { min: 0,    max: 100,  unit: '%' },
    o2:          { min: 18,   max: 21,   unit: '%' }
  },
  coldStorage: {
    label: 'Cold Storage (4 °C)',
    temperature: { min: 2.0, max: 8.0, unit: '°C' },
    co2:         { min: 0,   max: 100, unit: '%' },
    humidity:    { min: 0,   max: 100, unit: '%' },
    o2:          { min: 18,  max: 21,  unit: '%' }
  },
  roomTemp: {
    label: 'Room Temperature',
    temperature: { min: 20.0, max: 25.0, unit: '°C' },
    co2:         { min: 0,    max: 100,  unit: '%' },
    humidity:    { min: 30,   max: 60,   unit: '%' },
    o2:          { min: 19,   max: 21,   unit: '%' }
  }
};

var PARAMS = ['temperature', 'co2', 'humidity', 'o2'];

/* ── helpers ─────────────────────────────────────────────────── */
function mean(arr) {
  if (!arr.length) return null;
  var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}
function stddev(arr) {
  if (arr.length < 2) return null;
  var m = mean(arr);
  var ss = 0; for (var i = 0; i < arr.length; i++) ss += (arr[i] - m) * (arr[i] - m);
  return Math.sqrt(ss / (arr.length - 1));
}
function minVal(arr) {
  if (!arr.length) return null;
  var v = arr[0]; for (var i = 1; i < arr.length; i++) if (arr[i] < v) v = arr[i];
  return v;
}
function maxVal(arr) {
  if (!arr.length) return null;
  var v = arr[0]; for (var i = 1; i < arr.length; i++) if (arr[i] > v) v = arr[i];
  return v;
}
var _round = require('./validation').round;
function round(n, d) {
  if (n === null) return null;
  return _round(n, d || 2);
}

/* ── factory ─────────────────────────────────────────────────── */
function createEnvironmentalMonitor(opts) {
  opts = opts || {};

  // resolve profile(s) into merged limits
  var profileNames = opts.profiles || ['mammalian'];
  var limits = {};
  PARAMS.forEach(function (p) {
    limits[p] = { min: -Infinity, max: Infinity };
  });
  profileNames.forEach(function (name) {
    var prof = PROFILES[name];
    if (!prof) throw new Error('Unknown profile: ' + name);
    PARAMS.forEach(function (p) {
      if (prof[p]) {
        if (prof[p].min > limits[p].min) limits[p].min = prof[p].min;
        if (prof[p].max < limits[p].max) limits[p].max = prof[p].max;
      }
    });
  });

  // allow custom overrides
  if (opts.limits) {
    PARAMS.forEach(function (p) {
      if (opts.limits[p]) {
        if (typeof opts.limits[p].min === 'number') limits[p].min = opts.limits[p].min;
        if (typeof opts.limits[p].max === 'number') limits[p].max = opts.limits[p].max;
      }
    });
  }

  var readings = [];
  var alerts = [];

  function addReading(r) {
    if (!r || typeof r !== 'object') throw new Error('Reading must be an object');
    var entry = {
      timestamp: r.timestamp || new Date().toISOString(),
      temperature: typeof r.temperature === 'number' ? r.temperature : null,
      co2: typeof r.co2 === 'number' ? r.co2 : null,
      humidity: typeof r.humidity === 'number' ? r.humidity : null,
      o2: typeof r.o2 === 'number' ? r.o2 : null,
      notes: r.notes || null
    };
    readings.push(entry);

    // check limits
    PARAMS.forEach(function (p) {
      if (entry[p] === null) return;
      var lim = limits[p];
      if (entry[p] < lim.min || entry[p] > lim.max) {
        var alert = {
          index: readings.length - 1,
          timestamp: entry.timestamp,
          param: p,
          value: entry[p],
          min: lim.min,
          max: lim.max,
          severity: getSeverity(p, entry[p], lim)
        };
        alerts.push(alert);
      }
    });

    return entry;
  }

  function getSeverity(param, value, lim) {
    var range = lim.max - lim.min;
    if (range <= 0) return 'critical';
    var deviation;
    if (value < lim.min) deviation = (lim.min - value) / range;
    else deviation = (value - lim.max) / range;
    if (deviation > 0.5) return 'critical';
    if (deviation > 0.2) return 'warning';
    return 'caution';
  }

  function addBulk(arr) {
    if (!Array.isArray(arr)) throw new Error('Expected array of readings');
    return arr.map(addReading);
  }

  function getStats(param) {
    var vals = [];
    readings.forEach(function (r) {
      if (r[param] !== null && r[param] !== undefined) vals.push(r[param]);
    });
    return {
      count: vals.length,
      mean: round(mean(vals)),
      stddev: round(stddev(vals)),
      min: round(minVal(vals)),
      max: round(maxVal(vals)),
      inRange: vals.filter(function (v) {
        return v >= limits[param].min && v <= limits[param].max;
      }).length,
      outOfRange: vals.filter(function (v) {
        return v < limits[param].min || v > limits[param].max;
      }).length
    };
  }

  function getReport() {
    var stats = {};
    PARAMS.forEach(function (p) { stats[p] = getStats(p); });

    var totalReadings = readings.length;
    var excursionReadings = 0;
    readings.forEach(function (r, idx) {
      var hasExcursion = alerts.some(function (a) { return a.index === idx; });
      if (hasExcursion) excursionReadings++;
    });

    return {
      profiles: profileNames,
      limits: JSON.parse(JSON.stringify(limits)),
      totalReadings: totalReadings,
      excursionReadings: excursionReadings,
      excursionRate: totalReadings ? round(excursionReadings / totalReadings * 100) : 0,
      stats: stats,
      alerts: alerts.slice(),
      stability: getStabilityScore()
    };
  }

  function getStabilityScore() {
    // 0–100 score: 100 = perfectly stable, penalised by excursions and variance
    if (!readings.length) return null;
    var score = 100;
    var excursionPenalty = (alerts.length / Math.max(readings.length, 1)) * 60;
    score -= Math.min(excursionPenalty, 60);

    PARAMS.forEach(function (p) {
      var s = getStats(p);
      if (s.count > 1 && s.stddev !== null) {
        var range = limits[p].max - limits[p].min;
        if (range > 0) {
          var cv = s.stddev / range;
          score -= Math.min(cv * 20, 10); // up to 10 pts penalty per param
        }
      }
    });
    return Math.max(0, round(score));
  }

  function getReadings(filter) {
    if (!filter) return readings.slice();
    return readings.filter(function (r) {
      if (filter.from && r.timestamp < filter.from) return false;
      if (filter.to && r.timestamp > filter.to) return false;
      if (filter.param && r[filter.param] === null) return false;
      return true;
    });
  }

  function getAlerts(filter) {
    if (!filter) return alerts.slice();
    return alerts.filter(function (a) {
      if (filter.severity && a.severity !== filter.severity) return false;
      if (filter.param && a.param !== filter.param) return false;
      return true;
    });
  }

  function clear() {
    readings.length = 0;
    alerts.length = 0;
  }

  /**
   * Escape a value for safe CSV inclusion, defending against formula
   * injection (CWE-1236).
   */
  function csvSafe(value) {
    if (value == null) return '';
    var str = String(value);
    var first = str.charAt(0);
    if (first === '=' || first === '+' || first === '-' ||
        first === '@' || first === '\t' || first === '\r') {
      if (!((first === '-' || first === '+') && str.length > 1 && isFinite(Number(str)))) {
        str = "'" + str;
      }
    }
    if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 ||
        str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1 ||
        str !== str.trim()) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function exportCSV() {
    var header = 'timestamp,temperature,co2,humidity,o2,notes';
    var rows = readings.map(function (r) {
      return [
        r.timestamp,
        r.temperature !== null ? r.temperature : '',
        r.co2 !== null ? r.co2 : '',
        r.humidity !== null ? r.humidity : '',
        r.o2 !== null ? r.o2 : '',
        csvSafe(r.notes)
      ].join(',');
    });
    return header + '\n' + rows.join('\n');
  }

  function exportJSON() {
    return JSON.stringify(getReport(), null, 2);
  }

  return {
    addReading: addReading,
    addBulk: addBulk,
    getStats: getStats,
    getReport: getReport,
    getStabilityScore: getStabilityScore,
    getReadings: getReadings,
    getAlerts: getAlerts,
    clear: clear,
    exportCSV: exportCSV,
    exportJSON: exportJSON,
    PROFILES: PROFILES,
    limits: limits
  };
}

module.exports = {
  createEnvironmentalMonitor: createEnvironmentalMonitor,
  PROFILES: PROFILES
};
