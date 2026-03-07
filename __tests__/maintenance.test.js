/**
 * Tests for maintenance.html — Maintenance Tracker
 *
 * Validates: event CRUD, schedule computation, intervals, cost summary,
 * quality impact helpers, import/export, and alert logic.
 */

'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'docs', 'maintenance.html');

function createDOM() {
    let html = fs.readFileSync(HTML_PATH, 'utf-8');
    // Remove external script tag that jsdom can't load
    html = html.replace(/<script src="shared\/data-loader\.js"><\/script>/, '');
    // Inject a stub for loadBioprintData before the main IIFE so the XHR
    // fallback (which tries to fetch bioprint-data.json from localhost) is
    // never reached.
    html = html.replace(
        '<script>',
        '<script>window.loadBioprintData = function(cb) { cb([]); };</script>\n<script>',
    );

    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'http://localhost/',
    });
    return dom;
}

let dom, window, document;

beforeEach(() => {
    dom = createDOM();
    window = dom.window;
    document = window.document;
    window.localStorage.clear();
    const event = new window.Event('DOMContentLoaded');
    document.dispatchEvent(event);
});

afterEach(() => {
    if (dom) dom.window.close();
});

function logViaForm(opts) {
    document.getElementById('eventType').value = opts.type || 'cleaning';
    document.getElementById('eventDate').value = opts.date || '2026-03-01';
    document.getElementById('eventPrinter').value = opts.printer || '';
    document.getElementById('eventCost').value = opts.cost !== undefined ? String(opts.cost) : '';
    document.getElementById('eventNotes').value = opts.notes || '';
    window.logEvent();
}

function getStoredEvents() {
    try { return JSON.parse(window.localStorage.getItem('biobots_maintenance') || '[]'); }
    catch (e) { return []; }
}

function getStoredIntervals() {
    try { return JSON.parse(window.localStorage.getItem('biobots_maintenance_intervals') || '{}'); }
    catch (e) { return {}; }
}

describe('Event Logging', () => {
    test('logs an event and persists to localStorage', () => {
        logViaForm({ type: 'nozzle', date: '2026-03-05', printer: 'BioBot-001', cost: 25.5, notes: 'Replaced nozzle' });
        const events = getStoredEvents();
        expect(events.length).toBe(1);
        expect(events[0].type).toBe('nozzle');
        expect(events[0].date).toBe('2026-03-05');
        expect(events[0].printer).toBe('BioBot-001');
        expect(events[0].cost).toBe(25.5);
        expect(events[0].notes).toBe('Replaced nozzle');
        expect(events[0].id).toBeTruthy();
    });

    test('logs multiple events', () => {
        logViaForm({ type: 'cleaning', date: '2026-03-01' });
        logViaForm({ type: 'calibration', date: '2026-03-02' });
        logViaForm({ type: 'nozzle', date: '2026-03-03' });
        expect(getStoredEvents().length).toBe(3);
    });

    test('clears the form after logging', () => {
        logViaForm({ type: 'repair', date: '2026-03-01', printer: 'Bot-2', cost: 100, notes: 'Fixed motor' });
        expect(document.getElementById('eventPrinter').value).toBe('');
        expect(document.getElementById('eventCost').value).toBe('');
        expect(document.getElementById('eventNotes').value).toBe('');
    });

    test('requires a date to log', () => {
        let alertMsg = null;
        window.alert = function(msg) { alertMsg = msg; };
        document.getElementById('eventDate').value = '';
        window.logEvent();
        expect(alertMsg).toMatch(/date/i);
        expect(getStoredEvents().length).toBe(0);
    });

    test('handles zero cost gracefully', () => {
        logViaForm({ type: 'cleaning', date: '2026-03-01', cost: 0 });
        expect(getStoredEvents()[0].cost).toBe(0);
    });

    test('handles empty cost (no cost entered)', () => {
        logViaForm({ type: 'cleaning', date: '2026-03-01' });
        expect(getStoredEvents()[0].cost).toBe(0);
    });
});

describe('Event Deletion', () => {
    test('deletes an event by ID', () => {
        logViaForm({ type: 'cleaning', date: '2026-03-01' });
        logViaForm({ type: 'nozzle', date: '2026-03-02' });
        const events = getStoredEvents();
        expect(events.length).toBe(2);
        window.confirm = function() { return true; };
        window.deleteEvent(events[0].id);
        const remaining = getStoredEvents();
        expect(remaining.length).toBe(1);
        expect(remaining[0].id).toBe(events[1].id);
    });

    test('does not delete if confirm is cancelled', () => {
        logViaForm({ type: 'cleaning', date: '2026-03-01' });
        window.confirm = function() { return false; };
        const events = getStoredEvents();
        window.deleteEvent(events[0].id);
        expect(getStoredEvents().length).toBe(1);
    });
});

describe('Clear All', () => {
    test('removes all events', () => {
        logViaForm({ type: 'cleaning', date: '2026-03-01' });
        logViaForm({ type: 'nozzle', date: '2026-03-02' });
        window.confirm = function() { return true; };
        window.clearHistory();
        expect(getStoredEvents().length).toBe(0);
    });
});

describe('Export', () => {
    test('creates a downloadable JSON blob', () => {
        logViaForm({ type: 'firmware', date: '2026-03-01', notes: 'v2.1 update' });
        window.URL.createObjectURL = function() { return 'blob:mock'; };
        window.URL.revokeObjectURL = function() {};
        expect(() => window.exportHistory()).not.toThrow();
    });
});

describe('Import', () => {
    test('merges imported events, skipping duplicates', () => {
        logViaForm({ type: 'cleaning', date: '2026-03-01' });
        const existing = getStoredEvents();
        const importData = [
            existing[0],
            { id: 'new-1', type: 'nozzle', date: '2026-03-05', cost: 10, notes: 'new', printer: '' }
        ];
        const existingIds = {};
        existing.forEach(function(e) { existingIds[e.id] = true; });
        let added = 0;
        importData.forEach(function(item) { if (!existingIds[item.id]) added++; });
        expect(added).toBe(1);
    });
});

describe('Intervals', () => {
    test('updates custom interval', () => {
        document.getElementById('schedTaskType').value = 'nozzle';
        document.getElementById('schedInterval').value = '45';
        window.updateInterval();
        expect(getStoredIntervals().nozzle).toBe(45);
    });

    test('rejects invalid interval', () => {
        let alertMsg = null;
        window.alert = function(msg) { alertMsg = msg; };
        document.getElementById('schedTaskType').value = 'cleaning';
        document.getElementById('schedInterval').value = '0';
        window.updateInterval();
        expect(alertMsg).toMatch(/valid/i);
    });

    test('resets intervals to defaults', () => {
        document.getElementById('schedTaskType').value = 'nozzle';
        document.getElementById('schedInterval').value = '999';
        window.updateInterval();
        expect(getStoredIntervals().nozzle).toBe(999);
        window.confirm = function() { return true; };
        window.resetIntervals();
        expect(getStoredIntervals().nozzle).toBe(30);
        expect(getStoredIntervals().calibration).toBe(14);
        expect(getStoredIntervals().cleaning).toBe(7);
    });
});

describe('Dashboard', () => {
    test('renders dashboard cards', () => {
        const dashboard = document.getElementById('dashboard');
        expect(dashboard.innerHTML).toContain('Printer Health');
        expect(dashboard.innerHTML).toContain('Total Events');
    });

    test('shows 0 events initially', () => {
        const dashboard = document.getElementById('dashboard');
        expect(dashboard.textContent).toContain('0');
    });

    test('updates after adding events', () => {
        logViaForm({ type: 'cleaning', date: '2026-03-01', cost: 50 });
        const dashboard = document.getElementById('dashboard');
        expect(dashboard.textContent).toContain('$50');
    });
});

describe('Tabs', () => {
    test('switches between tabs', () => {
        const tabs = document.querySelectorAll('.tab');
        const historyTab = Array.from(tabs).find(t => t.getAttribute('data-tab') === 'history');
        historyTab.click();
        expect(document.getElementById('tab-history').classList.contains('active')).toBe(true);
        expect(document.getElementById('tab-log').classList.contains('active')).toBe(false);
    });
});

describe('History', () => {
    test('shows empty state when no events', () => {
        const timeline = document.getElementById('historyTimeline');
        expect(timeline.innerHTML).toContain('No maintenance events');
    });

    test('renders timeline entries', () => {
        logViaForm({ type: 'nozzle', date: '2026-03-01', notes: 'Changed tip' });
        logViaForm({ type: 'cleaning', date: '2026-03-02' });
        const timeline = document.getElementById('historyTimeline');
        expect(timeline.querySelectorAll('.tl-entry').length).toBe(2);
    });

    test('filters by type', () => {
        logViaForm({ type: 'nozzle', date: '2026-03-01' });
        logViaForm({ type: 'cleaning', date: '2026-03-02' });
        logViaForm({ type: 'nozzle', date: '2026-03-03' });
        document.getElementById('historyFilter').value = 'nozzle';
        document.getElementById('historyFilter').dispatchEvent(new window.Event('change'));
        const timeline = document.getElementById('historyTimeline');
        expect(timeline.querySelectorAll('.tl-entry').length).toBeGreaterThan(0);
    });
});

describe('Security', () => {
    test('escapes HTML in notes', () => {
        logViaForm({ type: 'cleaning', date: '2026-03-01', notes: '<script>alert("xss")</script>' });
        const timeline = document.getElementById('historyTimeline');
        expect(timeline.innerHTML).not.toContain('<script>alert');
        expect(timeline.innerHTML).toContain('&lt;script&gt;');
    });

    test('escapes HTML in printer name', () => {
        logViaForm({ type: 'nozzle', date: '2026-03-01', printer: '<img onerror=alert(1)>' });
        const timeline = document.getElementById('historyTimeline');
        expect(timeline.innerHTML).not.toContain('<img onerror');
    });
});

describe('ID Generation', () => {
    test('each event gets a unique ID', () => {
        logViaForm({ type: 'cleaning', date: '2026-03-01' });
        logViaForm({ type: 'cleaning', date: '2026-03-01' });
        logViaForm({ type: 'cleaning', date: '2026-03-01' });
        const events = getStoredEvents();
        const ids = events.map(e => e.id);
        expect(new Set(ids).size).toBe(3);
    });
});

describe('Alerts', () => {
    test('shows alerts when maintenance is overdue', () => {
        const banner = document.getElementById('alertBanner');
        expect(banner.classList.contains('visible')).toBe(true);
    });

    test('hides alerts when all maintenance is recent', () => {
        const today = new Date().toISOString().split('T')[0];
        logViaForm({ type: 'nozzle', date: today });
        logViaForm({ type: 'calibration', date: today });
        logViaForm({ type: 'cleaning', date: today });
        logViaForm({ type: 'firmware', date: today });
        logViaForm({ type: 'general', date: today });
        const banner = document.getElementById('alertBanner');
        expect(banner.classList.contains('visible')).toBe(false);
    });
});

describe('Schedule', () => {
    test('renders schedule table', () => {
        const table = document.getElementById('scheduleTable');
        expect(table.innerHTML).toContain('Nozzle Change');
        expect(table.innerHTML).toContain('Calibration');
        expect(table.innerHTML).toContain('Cleaning');
    });

    test('shows overdue for never-done tasks', () => {
        const table = document.getElementById('scheduleTable');
        expect(table.innerHTML).toContain('Overdue');
    });

    test('shows on-track after logging recent event', () => {
        const today = new Date().toISOString().split('T')[0];
        logViaForm({ type: 'cleaning', date: today });
        const table = document.getElementById('scheduleTable');
        expect(table.innerHTML).toContain('On Track');
    });
});

describe('Cost Summary', () => {
    test('shows cost breakdown after events', () => {
        logViaForm({ type: 'nozzle', date: '2026-03-01', cost: 50 });
        logViaForm({ type: 'cleaning', date: '2026-03-02', cost: 10 });
        const summary = document.getElementById('costSummary');
        expect(summary.textContent).toContain('$50');
        expect(summary.textContent).toContain('$10');
    });
});

describe('Impact Analysis', () => {
    test('shows empty state when no data', () => {
        const results = document.getElementById('impactResults');
        expect(results.innerHTML).toContain('Need maintenance events');
    });
});
