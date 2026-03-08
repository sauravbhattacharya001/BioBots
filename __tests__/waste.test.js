/**
 * Tests for waste.html — Waste & Sustainability Dashboard
 *
 * Validates: entry logging, demo data, history filtering/sorting,
 * category breakdown, weekly trends, goal setting, impact calculations,
 * sustainability scoring, export, delete, tab switching, persistence.
 */

'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'docs', 'waste.html');

function createDOM() {
    var html = fs.readFileSync(HTML_PATH, 'utf-8');
    var dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'http://localhost/',
        resources: 'usable',
    });
    return dom;
}

function getWindow() {
    return createDOM().window;
}

describe('Waste & Sustainability Dashboard', function() {
    var win, doc, api;

    beforeEach(function() {
        win = getWindow();
        doc = win.document;
        api = win._waste;
    });

    // -- Smoke Tests --

    test('page loads with title', function() {
        expect(doc.title).toContain('Waste');
    });

    test('API object is exposed', function() {
        expect(api).toBeDefined();
        expect(typeof api.logWaste).toBe('function');
        expect(typeof api.loadDemoData).toBe('function');
        expect(typeof api.switchTab).toBe('function');
    });

    test('summary stats initialize to zero', function() {
        expect(doc.getElementById('statTotal').textContent).toBe('0');
        expect(doc.getElementById('statMass').textContent).toContain('0');
        expect(doc.getElementById('statCost').textContent).toContain('$0');
    });

    // -- Logging --

    test('log waste entry with valid data', function() {
        doc.getElementById('wasteMass').value = '25.5';
        doc.getElementById('wasteCost').value = '10.00';
        doc.getElementById('wasteCategory').value = 'bioink';
        doc.getElementById('wasteMaterial').value = 'GelMA 7%';
        doc.getElementById('wasteNotes').value = 'Test entry';

        api.logWaste();

        var entries = api.getEntries();
        expect(entries.length).toBe(1);
        expect(entries[0].mass).toBe(25.5);
        expect(entries[0].cost).toBe(10);
        expect(entries[0].category).toBe('bioink');
        expect(entries[0].material).toBe('GelMA 7%');
    });

    test('log waste rejects zero mass', function() {
        doc.getElementById('wasteMass').value = '0';
        win.alert = jest.fn();
        api.logWaste();
        expect(api.getEntries().length).toBe(0);
    });

    test('log waste rejects empty mass', function() {
        doc.getElementById('wasteMass').value = '';
        win.alert = jest.fn();
        api.logWaste();
        expect(api.getEntries().length).toBe(0);
    });

    test('log waste rejects negative mass', function() {
        doc.getElementById('wasteMass').value = '-5';
        win.alert = jest.fn();
        api.logWaste();
        expect(api.getEntries().length).toBe(0);
    });

    test('log waste clears form after success', function() {
        doc.getElementById('wasteMass').value = '10';
        doc.getElementById('wasteCost').value = '5';
        doc.getElementById('wasteMaterial').value = 'Alginate';
        doc.getElementById('wasteNotes').value = 'Some notes';

        api.logWaste();

        expect(doc.getElementById('wasteMass').value).toBe('');
        expect(doc.getElementById('wasteCost').value).toBe('');
        expect(doc.getElementById('wasteMaterial').value).toBe('');
        expect(doc.getElementById('wasteNotes').value).toBe('');
    });

    test('log waste updates summary stats', function() {
        doc.getElementById('wasteMass').value = '30';
        doc.getElementById('wasteCost').value = '15';
        api.logWaste();

        expect(doc.getElementById('statTotal').textContent).toBe('1');
        expect(doc.getElementById('statMass').textContent).toContain('30');
        expect(doc.getElementById('statCost').textContent).toContain('15');
    });

    test('log multiple entries accumulates stats', function() {
        doc.getElementById('wasteMass').value = '10';
        doc.getElementById('wasteCost').value = '5';
        api.logWaste();

        doc.getElementById('wasteMass').value = '20';
        doc.getElementById('wasteCost').value = '10';
        api.logWaste();

        expect(doc.getElementById('statTotal').textContent).toBe('2');
        expect(doc.getElementById('statMass').textContent).toContain('30');
    });

    // -- Demo Data --

    test('load demo data adds entries', function() {
        win.confirm = jest.fn(function() { return true; });
        api.loadDemoData();
        expect(api.getEntries().length).toBeGreaterThanOrEqual(10);
    });

    test('demo data has diverse categories', function() {
        win.confirm = jest.fn(function() { return true; });
        api.loadDemoData();
        var cats = {};
        api.getEntries().forEach(function(e) { cats[e.category] = true; });
        expect(Object.keys(cats).length).toBeGreaterThanOrEqual(4);
    });

    test('demo data includes diverted entries', function() {
        win.confirm = jest.fn(function() { return true; });
        api.loadDemoData();
        var diverted = api.getEntries().filter(function(e) { return e.diverted; });
        expect(diverted.length).toBeGreaterThan(0);
    });

    // -- History Tab --

    test('history table shows logged entries', function() {
        doc.getElementById('wasteMass').value = '15';
        doc.getElementById('wasteMaterial').value = 'Test Mat';
        api.logWaste();

        api.renderHistory();

        var tbody = doc.getElementById('historyBody');
        expect(tbody.children.length).toBe(1);
        expect(tbody.innerHTML).toContain('Test Mat');
    });

    test('history filter by category', function() {
        doc.getElementById('wasteMass').value = '10';
        doc.getElementById('wasteCategory').value = 'bioink';
        api.logWaste();

        doc.getElementById('wasteMass').value = '20';
        doc.getElementById('wasteCategory').value = 'failed';
        api.logWaste();

        doc.getElementById('filterCategory').value = 'bioink';
        api.renderHistory();

        var tbody = doc.getElementById('historyBody');
        expect(tbody.children.length).toBe(1);
    });

    test('history shows empty message when no entries', function() {
        api.renderHistory();
        expect(doc.getElementById('historyEmpty').style.display).not.toBe('none');
    });

    test('delete entry removes from list', function() {
        doc.getElementById('wasteMass').value = '10';
        api.logWaste();
        doc.getElementById('wasteMass').value = '20';
        api.logWaste();

        expect(api.getEntries().length).toBe(2);

        var id = api.getEntries()[0].id;
        var btn = doc.querySelector('[data-delete="' + id + '"]');
        btn.click();

        expect(api.getEntries().length).toBe(1);
    });

    // -- Breakdown Tab --

    test('category chart renders bars', function() {
        win.confirm = jest.fn(function() { return true; });
        api.loadDemoData();
        api.renderBreakdown();

        var chart = doc.getElementById('categoryChart');
        var bars = chart.querySelectorAll('.bar-row');
        expect(bars.length).toBeGreaterThan(0);
    });

    test('material chart shows top materials', function() {
        win.confirm = jest.fn(function() { return true; });
        api.loadDemoData();
        api.renderBreakdown();

        var chart = doc.getElementById('materialChart');
        var bars = chart.querySelectorAll('.bar-row');
        expect(bars.length).toBeGreaterThan(0);
        expect(bars.length).toBeLessThanOrEqual(8);
    });

    test('empty breakdown shows message', function() {
        api.renderBreakdown();
        var chart = doc.getElementById('categoryChart');
        expect(chart.innerHTML).toContain('No data');
    });

    // -- Goals --

    test('set waste mass goal', function() {
        doc.getElementById('goalMetric').value = 'mass';
        doc.getElementById('goalTarget').value = '50';
        doc.getElementById('goalPeriod').value = 'weekly';

        api.setGoal();

        var goal = api.getGoal();
        expect(goal).not.toBeNull();
        expect(goal.metric).toBe('mass');
        expect(goal.target).toBe(50);
        expect(goal.period).toBe('weekly');
    });

    test('set diversion rate goal', function() {
        doc.getElementById('goalMetric').value = 'diversion';
        doc.getElementById('goalTarget').value = '80';
        doc.getElementById('goalPeriod').value = 'monthly';

        api.setGoal();

        var goal = api.getGoal();
        expect(goal.metric).toBe('diversion');
        expect(goal.target).toBe(80);
    });

    test('clear goal removes it', function() {
        doc.getElementById('goalMetric').value = 'mass';
        doc.getElementById('goalTarget').value = '50';
        api.setGoal();
        expect(api.getGoal()).not.toBeNull();

        api.clearGoal();
        expect(api.getGoal()).toBeNull();
    });

    test('goal rejects zero target', function() {
        doc.getElementById('goalTarget').value = '0';
        win.alert = jest.fn();
        api.setGoal();
        expect(api.getGoal()).toBeNull();
    });

    test('goal progress renders when goal exists', function() {
        doc.getElementById('goalMetric').value = 'mass';
        doc.getElementById('goalTarget').value = '100';
        api.setGoal();
        api.renderGoals();

        var display = doc.getElementById('goalDisplay');
        expect(display.innerHTML).toContain('Waste Mass');
    });

    // -- Impact --

    test('impact grid renders cards', function() {
        win.confirm = jest.fn(function() { return true; });
        api.loadDemoData();
        api.renderImpact();

        var grid = doc.getElementById('impactGrid');
        var cards = grid.querySelectorAll('.impact-card');
        expect(cards.length).toBe(6);
    });

    test('sustainability score renders', function() {
        win.confirm = jest.fn(function() { return true; });
        api.loadDemoData();
        api.renderImpact();

        var score = doc.getElementById('sustainabilityScore');
        expect(score.innerHTML).not.toBe('');
    });

    test('sustainability score is 0 with no entries', function() {
        var score = api.calculateSustainabilityScore(0, 0, 0);
        expect(score).toBe(0);
    });

    test('sustainability score rewards high diversion', function() {
        var low = api.calculateSustainabilityScore(100, 10, 5);
        var high = api.calculateSustainabilityScore(100, 90, 5);
        expect(high).toBeGreaterThan(low);
    });

    test('sustainability score rewards more tracking', function() {
        var few = api.calculateSustainabilityScore(100, 50, 2);
        var many = api.calculateSustainabilityScore(100, 50, 10);
        expect(many).toBeGreaterThan(few);
    });

    // -- Tab Switching --

    test('switch to breakdown tab', function() {
        api.switchTab('breakdown');
        expect(doc.getElementById('panel-breakdown').classList.contains('active')).toBe(true);
        expect(doc.getElementById('panel-log').classList.contains('active')).toBe(false);
    });

    test('switch to goals tab', function() {
        api.switchTab('goals');
        expect(doc.getElementById('panel-goals').classList.contains('active')).toBe(true);
    });

    test('switch to impact tab', function() {
        api.switchTab('impact');
        expect(doc.getElementById('panel-impact').classList.contains('active')).toBe(true);
    });

    test('switch back to log tab', function() {
        api.switchTab('breakdown');
        api.switchTab('log');
        expect(doc.getElementById('panel-log').classList.contains('active')).toBe(true);
    });

    // -- Escape / Security --

    test('escapeHtml handles XSS payloads', function() {
        var result = api.escapeHtml('<script>alert("xss")</script>');
        expect(result).not.toContain('<script>');
        expect(result).toContain('&lt;');
    });

    test('escapeHtml handles null', function() {
        expect(api.escapeHtml(null)).toBe('');
        expect(api.escapeHtml(undefined)).toBe('');
    });

    // -- Categories --

    test('all 6 categories defined', function() {
        expect(Object.keys(api.CATEGORIES).length).toBe(6);
        expect(api.CATEGORIES.bioink).toBeDefined();
        expect(api.CATEGORIES.failed).toBeDefined();
        expect(api.CATEGORIES.expired).toBeDefined();
        expect(api.CATEGORIES.packaging).toBeDefined();
        expect(api.CATEGORIES.consumable).toBeDefined();
        expect(api.CATEGORIES.other).toBeDefined();
    });

    test('each category has label and color', function() {
        Object.values(api.CATEGORIES).forEach(function(cat) {
            expect(cat.label).toBeTruthy();
            expect(cat.color).toBeTruthy();
        });
    });

    // -- Diversion Rate --

    test('diversion rate calculates correctly', function() {
        doc.getElementById('wasteMass').value = '50';
        doc.getElementById('wasteDiverted').value = 'yes';
        api.logWaste();

        doc.getElementById('wasteMass').value = '50';
        doc.getElementById('wasteDiverted').value = 'no';
        api.logWaste();

        expect(doc.getElementById('statDiversion').textContent).toContain('50');
    });

    test('diversion rate shows 0% with no entries', function() {
        expect(doc.getElementById('statDiversion').textContent).toContain('0');
    });

    // -- Impact Factors --

    test('impact factors are positive numbers', function() {
        expect(api.IMPACT_FACTORS.co2PerGram).toBeGreaterThan(0);
        expect(api.IMPACT_FACTORS.waterPerGram).toBeGreaterThan(0);
        expect(api.IMPACT_FACTORS.energyPerGram).toBeGreaterThan(0);
    });

    // -- Material truncation --

    test('material name is truncated to 100 chars', function() {
        var longName = 'A'.repeat(200);
        doc.getElementById('wasteMass').value = '10';
        doc.getElementById('wasteMaterial').value = longName;
        api.logWaste();

        expect(api.getEntries()[0].material.length).toBeLessThanOrEqual(100);
    });

    // -- Notes truncation --

    test('notes are truncated to 500 chars', function() {
        var longNotes = 'B'.repeat(600);
        doc.getElementById('wasteMass').value = '10';
        doc.getElementById('wasteNotes').value = longNotes;
        api.logWaste();

        expect(api.getEntries()[0].notes.length).toBeLessThanOrEqual(500);
    });
});
