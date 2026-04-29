'use strict';

var complianceTracker = require('../docs/shared/complianceTracker');

function buildTracker(opts) {
    return complianceTracker.createComplianceTracker(opts);
}

function futureDate(daysFromNow) {
    var d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return d.toISOString().slice(0, 10);
}

function pastDate(daysAgo) {
    var d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
}

// ── Construction ────────────────────────────────────────────────────

describe('createComplianceTracker', function () {
    test('returns object with expected API methods', function () {
        var t = buildTracker();
        expect(typeof t.addRequirement).toBe('function');
        expect(typeof t.updateRequirement).toBe('function');
        expect(typeof t.findById).toBe('function');
        expect(typeof t.audit).toBe('function');
        expect(typeof t.getTimeline).toBe('function');
        expect(typeof t.getFrameworkReport).toBe('function');
        expect(typeof t.exportReport).toBe('function');
        expect(typeof t.getAuditLog).toBe('function');
        expect(typeof t.getRequirements).toBe('function');
    });

    test('exposes FRAMEWORKS reference', function () {
        var t = buildTracker();
        expect(t.FRAMEWORKS).toBeDefined();
        expect(t.FRAMEWORKS.GLP).toBeDefined();
        expect(t.FRAMEWORKS.GMP).toBeDefined();
        expect(t.FRAMEWORKS.ISO17025).toBeDefined();
        expect(t.FRAMEWORKS.BSL).toBeDefined();
    });

    test('accepts custom warningDays and criticalDays', function () {
        var t = buildTracker({ warningDays: 14, criticalDays: 3 });
        expect(t).toBeDefined();
    });
});

// ── addRequirement ──────────────────────────────────────────────────

describe('addRequirement', function () {
    test('adds requirement and returns entry', function () {
        var t = buildTracker();
        var req = t.addRequirement({
            id: 'CAL-001', category: 'calibration',
            name: 'Pipette P200 Cal', framework: 'ISO17025',
            dueDate: futureDate(30)
        });
        expect(req.id).toBe('CAL-001');
        expect(req.name).toBe('Pipette P200 Cal');
        expect(req.framework).toBe('ISO17025');
        expect(req.status).toBe('pending');
        expect(req.createdAt).toBeDefined();
    });

    test('requirement appears in getRequirements', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'training', name: 'BSL Training', framework: 'BSL' });
        var reqs = t.getRequirements();
        expect(reqs).toHaveLength(1);
        expect(reqs[0].id).toBe('R1');
    });

    test('logs ADDED event in audit log', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'training', name: 'Test', framework: 'GLP' });
        var log = t.getAuditLog();
        expect(log.length).toBeGreaterThan(0);
        expect(log[0].type).toBe('ADDED');
        expect(log[0].requirementId).toBe('R1');
    });

    test('throws on missing required fields', function () {
        var t = buildTracker();
        expect(function () {
            t.addRequirement({ id: 'R1', category: 'calibration', name: 'Test' });
        }).toThrow(/must have/);
    });

    test('throws on unknown framework', function () {
        var t = buildTracker();
        expect(function () {
            t.addRequirement({ id: 'R1', category: 'x', name: 'Test', framework: 'FAKE' });
        }).toThrow(/Unknown framework/);
    });

    test('sets defaults for optional fields', function () {
        var t = buildTracker();
        var req = t.addRequirement({ id: 'R1', category: 'sop', name: 'SOP', framework: 'GLP' });
        expect(req.assignee).toBeNull();
        expect(req.dueDate).toBeNull();
        expect(req.notes).toBe('');
        expect(req.history).toEqual([]);
    });
});

// ── updateRequirement ───────────────────────────────────────────────

describe('updateRequirement', function () {
    test('updates fields and tracks history', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Cal', framework: 'ISO17025' });
        var updated = t.updateRequirement('R1', { status: 'completed', assignee: 'Dr. Smith' });
        expect(updated.status).toBe('completed');
        expect(updated.assignee).toBe('Dr. Smith');
        expect(updated.lastReviewed).toBeDefined();
        expect(updated.history).toHaveLength(1);
        expect(updated.history[0].oldStatus).toBe('pending');
        expect(updated.history[0].newStatus).toBe('completed');
    });

    test('logs UPDATED event', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'training', name: 'Train', framework: 'BSL' });
        t.updateRequirement('R1', { status: 'in_progress' });
        var log = t.getAuditLog();
        var updateEvt = log.find(function (e) { return e.type === 'UPDATED'; });
        expect(updateEvt).toBeDefined();
        expect(updateEvt.message).toMatch(/pending.*->.*in_progress/);
    });

    test('throws on unknown requirement', function () {
        var t = buildTracker();
        expect(function () {
            t.updateRequirement('GHOST', { status: 'done' });
        }).toThrow(/not found/);
    });

    test('does not overwrite id, history, or createdAt', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'audit', name: 'Audit', framework: 'GLP' });
        var updated = t.updateRequirement('R1', { id: 'HACKED', createdAt: 'FAKE', history: [] });
        expect(updated.id).toBe('R1');
        expect(updated.createdAt).not.toBe('FAKE');
    });
});

// ── findById ────────────────────────────────────────────────────────

describe('findById', function () {
    test('returns matching requirement', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'CAL-001', category: 'calibration', name: 'Cal', framework: 'ISO17025' });
        var found = t.findById('CAL-001');
        expect(found).not.toBeNull();
        expect(found.id).toBe('CAL-001');
    });

    test('returns null for non-existent id', function () {
        var t = buildTracker();
        expect(t.findById('NOPE')).toBeNull();
    });
});

// ── audit ───────────────────────────────────────────────────────────

describe('audit', function () {
    test('returns structured report with correct fields', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Cal', framework: 'ISO17025', dueDate: futureDate(60) });
        var report = t.audit();
        expect(report.auditDate).toBeDefined();
        expect(report.overallScore).toBeDefined();
        expect(report.grade).toBeDefined();
        expect(report.totalRequirements).toBe(1);
        expect(report.findings).toHaveLength(1);
        expect(report.frameworkScores).toBeDefined();
        expect(report.summary).toBeDefined();
    });

    test('overdue items get critical severity', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Overdue Cal', framework: 'ISO17025', dueDate: pastDate(10) });
        var report = t.audit();
        expect(report.findings[0].severity).toBe('critical');
        expect(report.findings[0].detail).toMatch(/OVERDUE/);
        expect(report.summary.critical).toBe(1);
    });

    test('items due within criticalDays get critical severity', function () {
        var t = buildTracker({ criticalDays: 7 });
        t.addRequirement({ id: 'R1', category: 'training', name: 'Urgent', framework: 'BSL', dueDate: futureDate(5) });
        var report = t.audit();
        expect(report.findings[0].severity).toBe('critical');
        expect(report.findings[0].detail).toMatch(/CRITICAL/);
    });

    test('items due within warningDays get major severity', function () {
        var t = buildTracker({ warningDays: 30, criticalDays: 7 });
        t.addRequirement({ id: 'R1', category: 'sop', name: 'SOP Review', framework: 'GLP', dueDate: futureDate(15) });
        var report = t.audit();
        expect(report.findings[0].severity).toBe('major');
        expect(report.findings[0].detail).toMatch(/WARNING/);
    });

    test('items due far in future get minor severity', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Far Out', framework: 'ISO17025', dueDate: futureDate(90) });
        var report = t.audit();
        expect(report.findings[0].severity).toBe('minor');
    });

    test('waived items get info severity', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Waived', framework: 'ISO17025', status: 'waived' });
        var report = t.audit();
        expect(report.findings[0].severity).toBe('info');
    });

    test('framework scores reflect requirement compliance', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Good', framework: 'ISO17025', dueDate: futureDate(90) });
        t.addRequirement({ id: 'R2', category: 'proficiency', name: 'Also Good', framework: 'ISO17025', dueDate: futureDate(60) });
        var report = t.audit();
        // Both minor (score 90 each) → average 90
        expect(report.frameworkScores.ISO17025).toBe(90);
    });

    test('overall score averages active frameworks', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Good', framework: 'ISO17025', dueDate: futureDate(90) });
        t.addRequirement({ id: 'R2', category: 'training', name: 'Good', framework: 'BSL', dueDate: futureDate(90) });
        var report = t.audit();
        expect(report.overallScore).toBe(90);
    });

    test('unused frameworks have null score', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Cal', framework: 'ISO17025', dueDate: futureDate(90) });
        var report = t.audit();
        expect(report.frameworkScores.GLP).toBeNull();
        expect(report.frameworkScores.GMP).toBeNull();
    });

    test('grading scale maps correctly', function () {
        var t = buildTracker();
        // All items far future → score 90 per item → grade A
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Cal', framework: 'ISO17025', dueDate: futureDate(90) });
        var report = t.audit();
        expect(report.grade).toBe('A');
    });

    test('generates recommendations for critical items', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Overdue', framework: 'ISO17025', dueDate: pastDate(5) });
        var report = t.audit();
        var urgent = report.recommendations.find(function (r) { return r.priority === 'urgent'; });
        expect(urgent).toBeDefined();
        expect(urgent.action).toMatch(/critical compliance/);
        expect(urgent.items.length).toBeGreaterThan(0);
    });

    test('recommendations flag missing framework categories', function () {
        var t = buildTracker();
        // ISO17025 requires: calibration, proficiency, measurement_uncertainty, traceability
        // Only adding calibration
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Cal', framework: 'ISO17025', dueDate: futureDate(60) });
        var report = t.audit();
        var coverage = report.recommendations.find(function (r) { return r.action && r.action.match(/missing coverage/); });
        expect(coverage).toBeDefined();
        expect(coverage.action).toMatch(/proficiency/);
    });

    test('supports asOf parameter for point-in-time audits', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Cal', framework: 'ISO17025', dueDate: '2026-06-01' });
        // Audit as-of a date where it's overdue
        var report = t.audit({ asOf: '2026-07-01' });
        expect(report.findings[0].severity).toBe('critical');
        expect(report.findings[0].detail).toMatch(/OVERDUE/);
    });

    test('findings are sorted by severity (critical first)', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Far', framework: 'ISO17025', dueDate: futureDate(90) });
        t.addRequirement({ id: 'R2', category: 'proficiency', name: 'Overdue', framework: 'ISO17025', dueDate: pastDate(5) });
        t.addRequirement({ id: 'R3', category: 'traceability', name: 'Warning', framework: 'ISO17025', dueDate: futureDate(15) });
        var report = t.audit();
        expect(report.findings[0].severity).toBe('critical');
    });
});

// ── getTimeline ─────────────────────────────────────────────────────

describe('getTimeline', function () {
    test('returns upcoming items sorted by due date', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Later', framework: 'ISO17025', dueDate: futureDate(60) });
        t.addRequirement({ id: 'R2', category: 'training', name: 'Sooner', framework: 'BSL', dueDate: futureDate(10) });
        var timeline = t.getTimeline(90);
        expect(timeline).toHaveLength(2);
        expect(timeline[0].id).toBe('R2'); // sooner first
        expect(timeline[0].daysUntil).toBeLessThan(timeline[1].daysUntil);
    });

    test('excludes items beyond daysAhead window', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Far', framework: 'ISO17025', dueDate: futureDate(200) });
        var timeline = t.getTimeline(90);
        expect(timeline).toHaveLength(0);
    });

    test('includes overdue items (negative daysUntil)', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Late', framework: 'ISO17025', dueDate: pastDate(5) });
        var timeline = t.getTimeline(90);
        expect(timeline).toHaveLength(1);
        expect(timeline[0].daysUntil).toBeLessThan(0);
    });

    test('skips items with no dueDate', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'sop', name: 'No Date', framework: 'GLP' });
        var timeline = t.getTimeline(90);
        expect(timeline).toHaveLength(0);
    });
});

// ── getFrameworkReport ──────────────────────────────────────────────

describe('getFrameworkReport', function () {
    test('returns framework-specific breakdown by category', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Cal', framework: 'ISO17025', dueDate: futureDate(30) });
        t.addRequirement({ id: 'R2', category: 'proficiency', name: 'Prof', framework: 'ISO17025', dueDate: futureDate(60) });
        var report = t.getFrameworkReport('ISO17025');
        expect(report.framework).toBe('ISO17025');
        expect(report.fullName).toBe('ISO/IEC 17025');
        expect(report.totalItems).toBe(2);
        expect(report.categories.calibration.total).toBe(1);
        expect(report.categories.proficiency.total).toBe(1);
    });

    test('throws on unknown framework', function () {
        var t = buildTracker();
        expect(function () {
            t.getFrameworkReport('INVALID');
        }).toThrow(/Unknown framework/);
    });

    test('includes all defined categories even if empty', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Cal', framework: 'ISO17025', dueDate: futureDate(30) });
        var report = t.getFrameworkReport('ISO17025');
        expect(report.categories.measurement_uncertainty).toBeDefined();
        expect(report.categories.measurement_uncertainty.total).toBe(0);
    });
});

// ── exportReport ────────────────────────────────────────────────────

describe('exportReport', function () {
    test('exports JSON format', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Cal', framework: 'ISO17025', dueDate: futureDate(30) });
        var json = t.exportReport('json');
        var parsed = JSON.parse(json);
        expect(parsed.overallScore).toBeDefined();
        expect(parsed.findings).toBeDefined();
    });

    test('exports CSV format with header', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Cal', framework: 'ISO17025', dueDate: futureDate(30) });
        var csv = t.exportReport('csv');
        var lines = csv.split('\n');
        expect(lines[0]).toBe('id,name,framework,category,severity,detail,assignee,dueDate');
        expect(lines.length).toBe(2);
        expect(lines[1]).toMatch(/^R1/);
    });

    test('exports text format with sections', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Cal', framework: 'ISO17025', dueDate: futureDate(30) });
        var text = t.exportReport('text');
        expect(text).toMatch(/Lab Compliance Audit Report/);
        expect(text).toMatch(/Framework Scores/);
        expect(text).toMatch(/Findings/);
        expect(text).toMatch(/Recommendations/);
    });
});

// ── Auto Monitor ────────────────────────────────────────────────────

describe('auto monitor', function () {
    beforeEach(function () { jest.useFakeTimers(); });
    afterEach(function () { jest.useRealTimers(); });

    test('startAutoMonitor triggers callback on critical items', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Overdue', framework: 'ISO17025', dueDate: pastDate(10) });
        var alerts = [];
        t.startAutoMonitor(1000, function (data) { alerts.push(data); });
        jest.advanceTimersByTime(1000);
        expect(alerts.length).toBe(1);
        expect(alerts[0].alerts.length).toBeGreaterThan(0);
        expect(alerts[0].score).toBeDefined();
        t.stopAutoMonitor();
    });

    test('stopAutoMonitor prevents further callbacks', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Overdue', framework: 'ISO17025', dueDate: pastDate(10) });
        var count = 0;
        t.startAutoMonitor(1000, function () { count++; });
        jest.advanceTimersByTime(1000);
        t.stopAutoMonitor();
        jest.advanceTimersByTime(5000);
        expect(count).toBe(1);
    });

    test('no callback when no critical items', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Fine', framework: 'ISO17025', dueDate: futureDate(90) });
        var called = false;
        t.startAutoMonitor(1000, function () { called = true; });
        jest.advanceTimersByTime(1000);
        expect(called).toBe(false);
        t.stopAutoMonitor();
    });
});

// ── Edge Cases ──────────────────────────────────────────────────────

describe('edge cases', function () {
    test('audit with no requirements returns empty report', function () {
        var t = buildTracker();
        var report = t.audit();
        expect(report.totalRequirements).toBe(0);
        expect(report.findings).toHaveLength(0);
        expect(report.overallScore).toBe(0);
    });

    test('getRequirements returns a copy, not internal array', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'training', name: 'Test', framework: 'GLP' });
        var reqs = t.getRequirements();
        reqs.push({ id: 'FAKE' });
        expect(t.getRequirements()).toHaveLength(1);
    });

    test('multiple updates accumulate history', function () {
        var t = buildTracker();
        t.addRequirement({ id: 'R1', category: 'calibration', name: 'Cal', framework: 'ISO17025' });
        t.updateRequirement('R1', { status: 'in_progress' });
        t.updateRequirement('R1', { status: 'completed' });
        var req = t.findById('R1');
        expect(req.history).toHaveLength(2);
        expect(req.history[0].newStatus).toBe('in_progress');
        expect(req.history[1].newStatus).toBe('completed');
    });
});
