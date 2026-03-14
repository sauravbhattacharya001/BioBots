/**
 * Tests for environment.html — Environmental Monitoring Dashboard
 *
 * Validates: sensor data generation, statistics, correlation, alert
 * detection, threshold configuration, classification, and exports.
 */

'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'docs', 'environment.html');

function createDOM() {
    let html = fs.readFileSync(HTML_PATH, 'utf-8');
    // Remove external script tag that jsdom can't load
    html = html.replace(/<script src="shared\/data-loader\.js"><\/script>/, '');
    // Inject stub for loadBioprintData
    html = html.replace(
        '<script>',
        '<script>window.loadBioprintData = function() { return Promise.resolve([]); };</script>\n<script>',
    );

    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'http://localhost/',
    });
    return dom;
}

let dom, window, env;

beforeEach(() => {
    dom = createDOM();
    window = dom.window;
    env = window.envMonitor;
});

afterEach(() => {
    dom.window.close();
});

// ── Sensor Configuration ────────────────────────────────────────

describe('Sensor Configuration', () => {
    test('defines all 4 sensor types', () => {
        expect(env.SENSOR_KEYS).toEqual(['temperature', 'humidity', 'co2', 'particulates']);
    });

    test('each sensor has required properties', () => {
        env.SENSOR_KEYS.forEach((key) => {
            const s = env.SENSORS[key];
            expect(s.label).toBeTruthy();
            expect(s.unit).toBeTruthy();
            expect(typeof s.nominal).toBe('number');
            expect(typeof s.drift).toBe('number');
            expect(typeof s.precision).toBe('number');
        });
    });

    test('temperature optimal range is 21-25°C', () => {
        expect(env.SENSORS.temperature.optimalLow).toBe(21);
        expect(env.SENSORS.temperature.optimalHigh).toBe(25);
    });

    test('humidity optimal range is 35-55%RH', () => {
        expect(env.SENSORS.humidity.optimalLow).toBe(35);
        expect(env.SENSORS.humidity.optimalHigh).toBe(55);
    });
});

// ── Data Generation ─────────────────────────────────────────────

describe('generateReadings', () => {
    test('generates correct number of 5-min interval readings for 24h', () => {
        const readings = env.generateReadings(24);
        expect(readings.length).toBe(288); // 24 * 12
    });

    test('generates correct count for 1h', () => {
        const readings = env.generateReadings(1);
        expect(readings.length).toBe(12);
    });

    test('each reading has all sensor keys and timestamp', () => {
        const readings = env.generateReadings(1);
        readings.forEach((r) => {
            expect(typeof r.ts).toBe('number');
            expect(typeof r.temperature).toBe('number');
            expect(typeof r.humidity).toBe('number');
            expect(typeof r.co2).toBe('number');
            expect(typeof r.particulates).toBe('number');
        });
    });

    test('readings are in chronological order', () => {
        const readings = env.generateReadings(2);
        for (let i = 1; i < readings.length; i++) {
            expect(readings[i].ts).toBeGreaterThan(readings[i - 1].ts);
        }
    });

    test('temperature values are near nominal (23°C)', () => {
        const readings = env.generateReadings(4);
        const temps = readings.map((r) => r.temperature);
        const mean = temps.reduce((a, b) => a + b) / temps.length;
        expect(mean).toBeGreaterThan(18);
        expect(mean).toBeLessThan(28);
    });

    test('humidity stays within 0-100%', () => {
        const readings = env.generateReadings(24);
        readings.forEach((r) => {
            expect(r.humidity).toBeGreaterThanOrEqual(0);
            expect(r.humidity).toBeLessThanOrEqual(100);
        });
    });

    test('co2 stays above 200 ppm', () => {
        const readings = env.generateReadings(24);
        readings.forEach((r) => {
            expect(r.co2).toBeGreaterThanOrEqual(200);
        });
    });

    test('particulates are non-negative', () => {
        const readings = env.generateReadings(24);
        readings.forEach((r) => {
            expect(r.particulates).toBeGreaterThanOrEqual(0);
        });
    });

    test('default is 24h when no argument', () => {
        const readings = env.generateReadings();
        expect(readings.length).toBe(288);
    });
});

// ── Statistics ──────────────────────────────────────────────────

describe('computeStats', () => {
    test('computes mean correctly', () => {
        const stats = env.computeStats([10, 20, 30]);
        expect(stats.mean).toBe(20);
    });

    test('computes min and max', () => {
        const stats = env.computeStats([5, 2, 8, 1, 9]);
        expect(stats.min).toBe(1);
        expect(stats.max).toBe(9);
    });

    test('computes standard deviation', () => {
        const stats = env.computeStats([2, 4, 4, 4, 5, 5, 7, 9]);
        expect(stats.std).toBeCloseTo(2.138, 2);
    });

    test('handles single value', () => {
        const stats = env.computeStats([42]);
        expect(stats.mean).toBe(42);
        expect(stats.std).toBe(0);
    });

    test('handles empty array', () => {
        const stats = env.computeStats([]);
        expect(stats.mean).toBe(0);
        expect(stats.min).toBe(0);
        expect(stats.max).toBe(0);
    });
});

// ── Pearson Correlation ─────────────────────────────────────────

describe('pearsonCorrelation', () => {
    test('perfect positive correlation', () => {
        const r = env.pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
        expect(r).toBeCloseTo(1.0, 5);
    });

    test('perfect negative correlation', () => {
        const r = env.pearsonCorrelation([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]);
        expect(r).toBeCloseTo(-1.0, 5);
    });

    test('no correlation for random-like data', () => {
        const r = env.pearsonCorrelation([1, 2, 3, 4, 5], [5, 1, 4, 2, 3]);
        expect(Math.abs(r)).toBeLessThan(0.5);
    });

    test('returns 0 for fewer than 3 points', () => {
        expect(env.pearsonCorrelation([1], [2])).toBe(0);
        expect(env.pearsonCorrelation([1, 2], [3, 4])).toBe(0);
    });
});

// ── Alert Detection ─────────────────────────────────────────────

describe('checkAlerts', () => {
    test('generates critical alert for high temperature', () => {
        const alerts = env.checkAlerts({
            ts: Date.now(),
            temperature: 30, humidity: 45, co2: 400, particulates: 3000
        });
        expect(alerts.length).toBe(1);
        expect(alerts[0].level).toBe('critical');
        expect(alerts[0].sensor).toBe('temperature');
    });

    test('generates warning for low temperature', () => {
        const alerts = env.checkAlerts({
            ts: Date.now(),
            temperature: 19, humidity: 45, co2: 400, particulates: 3000
        });
        expect(alerts.length).toBe(1);
        expect(alerts[0].level).toBe('warning');
        expect(alerts[0].sensor).toBe('temperature');
    });

    test('no alerts for nominal values', () => {
        const alerts = env.checkAlerts({
            ts: Date.now(),
            temperature: 23, humidity: 45, co2: 420, particulates: 3000
        });
        expect(alerts.length).toBe(0);
    });

    test('generates alert for high CO2', () => {
        const alerts = env.checkAlerts({
            ts: Date.now(),
            temperature: 23, humidity: 45, co2: 1300, particulates: 3000
        });
        expect(alerts.length).toBe(1);
        expect(alerts[0].sensor).toBe('co2');
        expect(alerts[0].level).toBe('critical');
    });

    test('generates alert for high particulates', () => {
        const alerts = env.checkAlerts({
            ts: Date.now(),
            temperature: 23, humidity: 45, co2: 400, particulates: 40000
        });
        expect(alerts.length).toBe(1);
        expect(alerts[0].sensor).toBe('particulates');
    });

    test('multiple alerts for multiple out-of-range sensors', () => {
        const alerts = env.checkAlerts({
            ts: Date.now(),
            temperature: 30, humidity: 75, co2: 1300, particulates: 40000
        });
        expect(alerts.length).toBe(4);
    });
});

// ── Sensor Classification ───────────────────────────────────────

describe('classifySensor', () => {
    test('ok for nominal temperature', () => {
        expect(env.classifySensor('temperature', 23)).toBe('ok');
    });

    test('warn for borderline temperature', () => {
        expect(env.classifySensor('temperature', 27)).toBe('warn');
    });

    test('alert for extreme temperature', () => {
        expect(env.classifySensor('temperature', 29)).toBe('alert');
    });

    test('ok for nominal humidity', () => {
        expect(env.classifySensor('humidity', 45)).toBe('ok');
    });

    test('warn for high humidity', () => {
        expect(env.classifySensor('humidity', 65)).toBe('warn');
    });

    test('alert for very high humidity', () => {
        expect(env.classifySensor('humidity', 75)).toBe('alert');
    });

    test('ok for nominal co2', () => {
        expect(env.classifySensor('co2', 420)).toBe('ok');
    });

    test('warn for elevated co2', () => {
        expect(env.classifySensor('co2', 900)).toBe('warn');
    });

    test('ok for low particulates', () => {
        expect(env.classifySensor('particulates', 2000)).toBe('ok');
    });

    test('alert for very high particulates', () => {
        expect(env.classifySensor('particulates', 40000)).toBe('alert');
    });
});

// ── Status Labels ───────────────────────────────────────────────

describe('statusLabel', () => {
    test('returns green for ok', () => {
        expect(env.statusLabel('ok')).toContain('Normal');
    });

    test('returns yellow for warn', () => {
        expect(env.statusLabel('warn')).toContain('Warning');
    });

    test('returns red for alert', () => {
        expect(env.statusLabel('alert')).toContain('Critical');
    });
});

// ── Threshold Configuration ─────────────────────────────────────

describe('Threshold Management', () => {
    test('getThresholds returns all 4 sensors', () => {
        const t = env.getThresholds();
        expect(Object.keys(t)).toEqual(env.SENSOR_KEYS);
    });

    test('default temperature thresholds match SENSORS', () => {
        const t = env.getThresholds();
        expect(t.temperature.warnLow).toBe(20);
        expect(t.temperature.warnHigh).toBe(26);
        expect(t.temperature.alertLow).toBe(18);
        expect(t.temperature.alertHigh).toBe(28);
    });

    test('setThresholds updates values', () => {
        env.setThresholds({ temperature: { warnHigh: 24 } });
        const t = env.getThresholds();
        expect(t.temperature.warnHigh).toBe(24);
        // Other values unchanged
        expect(t.temperature.warnLow).toBe(20);
    });

    test('custom thresholds affect classification', () => {
        env.setThresholds({ temperature: { warnHigh: 22 } });
        // 23°C was ok, now should be warn
        expect(env.classifySensor('temperature', 23)).toBe('warn');
    });

    test('can set null thresholds to disable', () => {
        env.setThresholds({ co2: { warnHigh: null } });
        const t = env.getThresholds();
        expect(t.co2.warnHigh).toBeNull();
    });
});

// ── DOM Rendering ───────────────────────────────────────────────

describe('DOM Rendering', () => {
    test('page title includes Environmental Monitor', () => {
        expect(window.document.title).toContain('Environmental Monitor');
    });

    test('status grid has 4 tiles on load', () => {
        const tiles = window.document.querySelectorAll('.status-tile');
        expect(tiles.length).toBe(4);
    });

    test('each tile shows a value', () => {
        const values = window.document.querySelectorAll('.status-tile .value');
        expect(values.length).toBe(4);
        values.forEach((v) => {
            expect(v.textContent.trim()).not.toBe('');
        });
    });

    test('summary table has 4 rows', () => {
        const rows = window.document.querySelectorAll('#summaryBody tr');
        expect(rows.length).toBe(4);
    });

    test('threshold config table has input fields', () => {
        const inputs = window.document.querySelectorAll('#thresholdConfig input');
        expect(inputs.length).toBeGreaterThanOrEqual(12); // 4 sensors * 3-4 thresholds
    });

    test('nav bar includes environment link as active', () => {
        const active = window.document.querySelector('.nav a.active');
        expect(active).toBeTruthy();
        expect(active.getAttribute('href')).toBe('environment.html');
    });

    test('readings are generated on init', () => {
        const readings = env.getReadings();
        expect(readings.length).toBe(288);
    });
});

// ── Integration ─────────────────────────────────────────────────

describe('Integration', () => {
    test('generated readings produce reasonable statistics', () => {
        const readings = env.getReadings();
        const temps = readings.map((r) => r.temperature);
        const stats = env.computeStats(temps);
        // Mean should be near 23°C nominal
        expect(stats.mean).toBeGreaterThan(18);
        expect(stats.mean).toBeLessThan(28);
        // Std dev should be reasonable
        expect(stats.std).toBeGreaterThan(0);
        expect(stats.std).toBeLessThan(10);
    });

    test('some readings trigger alerts over 24h', () => {
        // With random walks and occasional spikes, some alerts are expected
        const alertsArr = env.getAlerts();
        // Could be 0 or more — just validate they're well-formed
        alertsArr.forEach((a) => {
            expect(['critical', 'warning']).toContain(a.level);
            expect(env.SENSOR_KEYS).toContain(a.sensor);
            expect(typeof a.ts).toBe('number');
            expect(typeof a.message).toBe('string');
        });
    });
});

// ── Security: XSS / HTML escaping ─────────────────────────
describe('esc() — HTML escaping', () => {
    let env;
    beforeAll(() => {
        const dom = createDOM();
        env = dom.window.envMonitor;
    });

    test('escapes angle brackets', () => {
        expect(env.esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    test('escapes ampersand', () => {
        expect(env.esc('a&b')).toBe('a&amp;b');
    });

    test('escapes double and single quotes', () => {
        expect(env.esc('"hello"')).toBe('&quot;hello&quot;');
        expect(env.esc("it's")).toBe('it&#39;s');
    });

    test('returns empty string for null/undefined', () => {
        expect(env.esc(null)).toBe('');
        expect(env.esc(undefined)).toBe('');
    });

    test('coerces numbers to string', () => {
        expect(env.esc(42)).toBe('42');
    });

    test('handles combined attack payload', () => {
        const payload = '<img src=x onerror="alert(document.cookie)">';
        const result = env.esc(payload);
        expect(result).not.toContain('<');
        expect(result).not.toContain('>');
        expect(result).not.toContain('"');
    });
});

// ── Security: CSV formula injection ───────────────────────
describe('csvSafe() — CSV formula injection prevention', () => {
    let env;
    beforeAll(() => {
        const dom = createDOM();
        env = dom.window.envMonitor;
    });

    test('prefixes values starting with = to prevent formula injection', () => {
        const result = env.csvSafe('=CMD("calc")');
        expect(result).toMatch(/^"'/);
        expect(result).not.toMatch(/^"=/);
    });

    test('prefixes values starting with +', () => {
        const result = env.csvSafe('+1+2');
        expect(result).toMatch(/^"'/);
    });

    test('prefixes values starting with -', () => {
        const result = env.csvSafe('-1-2');
        expect(result).toMatch(/^"'/);
    });

    test('prefixes values starting with @', () => {
        const result = env.csvSafe('@SUM(A1:A10)');
        expect(result).toMatch(/^"'/);
    });

    test('prefixes values starting with tab', () => {
        const result = env.csvSafe('\t=1');
        expect(result).toMatch(/^"'/);
    });

    test('prefixes values starting with carriage return', () => {
        const result = env.csvSafe('\r=1');
        expect(result).toMatch(/^"'/);
    });

    test('does not prefix safe values', () => {
        expect(env.csvSafe('Temperature CRITICAL')).toBe('"Temperature CRITICAL"');
        expect(env.csvSafe('42')).toBe('"42"');
    });

    test('escapes internal double quotes', () => {
        expect(env.csvSafe('say "hello"')).toBe('"say ""hello"""');
    });

    test('handles null/undefined', () => {
        expect(env.csvSafe(null)).toBe('""');
        expect(env.csvSafe(undefined)).toBe('""');
    });
});
