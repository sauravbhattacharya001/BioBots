'use strict';

var safety = require('../docs/shared/labSafetyChecklist');

describe('labSafetyChecklist - createLabSafetyChecklist()', function () {
    test('returns an object with the public API', function () {
        var mgr = safety.createLabSafetyChecklist();
        ['registerArea', 'createChecklist', 'generateFromTemplate', 'reportFinding',
         'resolveFinding', 'checkPpeCompliance', 'getAreaSafetyScore',
         'generateAuditReport', 'listTemplates', 'listPpeProfiles']
            .forEach(function (fn) {
                expect(typeof mgr[fn]).toBe('function');
            });
    });
});

describe('labSafetyChecklist - registerArea', function () {
    var mgr;
    beforeEach(function () { mgr = safety.createLabSafetyChecklist(); });

    test('rejects missing name', function () {
        var res = mgr.registerArea();
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/name/i);
        var res2 = mgr.registerArea({});
        expect(res2.success).toBe(false);
    });

    test('rejects dangerous prototype-pollution keys', function () {
        var res = mgr.registerArea({ name: '__proto__' });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/invalid/i);
    });

    test('defaults to bsl1 hazard level', function () {
        var res = mgr.registerArea({ name: 'Cell Lab' });
        expect(res.success).toBe(true);
        expect(res.area.hazardLevel).toBe('bsl1');
        expect(res.area.ppeProfile.level).toBe('BSL-1');
    });

    test('accepts custom hazard level', function () {
        var res = mgr.registerArea({ name: 'Chem Hood', hazardLevel: 'chemical' });
        expect(res.success).toBe(true);
        expect(res.area.ppeProfile.level).toBe('Chemical Handling');
    });

    test('unknown hazard level falls back to bsl1 ppe profile', function () {
        var res = mgr.registerArea({ name: 'X', hazardLevel: 'nonexistent' });
        expect(res.success).toBe(true);
        expect(res.area.ppeProfile.level).toBe('BSL-1');
    });
});

describe('labSafetyChecklist - createChecklist', function () {
    var mgr;
    beforeEach(function () { mgr = safety.createLabSafetyChecklist(); });

    test('rejects missing area', function () {
        var res = mgr.createChecklist({ inspector: 'J', items: [{ item: 'x', checked: true }] });
        expect(res.success).toBe(false);
    });
    test('rejects missing inspector', function () {
        var res = mgr.createChecklist({ area: 'A', items: [{ item: 'x', checked: true }] });
        expect(res.success).toBe(false);
    });
    test('rejects empty items array', function () {
        var res = mgr.createChecklist({ area: 'A', inspector: 'J', items: [] });
        expect(res.success).toBe(false);
    });
    test('rejects non-array items', function () {
        var res = mgr.createChecklist({ area: 'A', inspector: 'J', items: 'oops' });
        expect(res.success).toBe(false);
    });

    test('scores all-checked items as PASS', function () {
        var res = mgr.createChecklist({
            area: 'A', inspector: 'J',
            items: [
                { category: 'ppe', item: 'lab coat', checked: true, critical: true },
                { category: 'ppe', item: 'gloves', checked: true, critical: true }
            ]
        });
        expect(res.success).toBe(true);
        expect(res.checklist.summary.score).toBe(100);
        expect(res.checklist.summary.status).toBe('PASS');
        expect(res.checklist.summary.criticalFailures).toEqual([]);
    });

    test('unchecked critical item triggers FAIL even at 80%+', function () {
        var items = [];
        for (var i = 0; i < 9; i++) items.push({ item: 'ok' + i, checked: true, critical: false });
        items.push({ item: 'critical-missed', checked: false, critical: true });
        var res = mgr.createChecklist({ area: 'A', inspector: 'J', items: items });
        expect(res.checklist.summary.status).toBe('FAIL');
        expect(res.checklist.summary.criticalFailures).toContain('critical-missed');
    });

    test('70-89% with no critical fails is CONDITIONAL', function () {
        var items = [
            { item: '1', checked: true }, { item: '2', checked: true },
            { item: '3', checked: true }, { item: '4', checked: false }
        ];
        var res = mgr.createChecklist({ area: 'A', inspector: 'J', items: items });
        expect(res.checklist.summary.score).toBe(75);
        expect(res.checklist.summary.status).toBe('CONDITIONAL');
    });

    test('below 70% is FAIL', function () {
        var items = [
            { item: '1', checked: true }, { item: '2', checked: false },
            { item: '3', checked: false }
        ];
        var res = mgr.createChecklist({ area: 'A', inspector: 'J', items: items });
        expect(res.checklist.summary.status).toBe('FAIL');
    });

    test('defaults missing item fields', function () {
        var res = mgr.createChecklist({
            area: 'A', inspector: 'J',
            items: [{ checked: true }]
        });
        expect(res.success).toBe(true);
        expect(res.checklist.items[0].category).toBe('general');
        expect(res.checklist.items[0].item).toBe('Unnamed item');
        expect(res.checklist.items[0].critical).toBe(false);
    });
});

describe('labSafetyChecklist - generateFromTemplate', function () {
    var mgr;
    beforeEach(function () { mgr = safety.createLabSafetyChecklist(); });

    test('rejects unknown template name', function () {
        var res = mgr.generateFromTemplate('nope', 'A', 'J');
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/Available:/);
    });

    test('daily template generates a checklist with all items unchecked', function () {
        var res = mgr.generateFromTemplate('daily', 'Cell Lab', 'J');
        expect(res.success).toBe(true);
        expect(res.checklist.items.length).toBeGreaterThan(0);
        res.checklist.items.forEach(function (it) {
            expect(it.checked).toBe(false);
        });
        // All unchecked => 0 score => FAIL
        expect(res.checklist.summary.score).toBe(0);
    });
});

describe('labSafetyChecklist - reportFinding / resolveFinding', function () {
    var mgr;
    beforeEach(function () { mgr = safety.createLabSafetyChecklist(); });

    test('rejects finding without area or description', function () {
        expect(mgr.reportFinding({}).success).toBe(false);
        expect(mgr.reportFinding({ area: 'A' }).success).toBe(false);
    });

    test('creates a finding with default moderate risk', function () {
        var res = mgr.reportFinding({ area: 'A', description: 'spill' });
        expect(res.success).toBe(true);
        expect(res.finding.status).toBe('open');
        expect(res.finding.risk).toBeDefined();
        expect(res.finding.id).toMatch(/^SF-/);
    });

    test('resolveFinding closes an open finding', function () {
        var f = mgr.reportFinding({ area: 'A', description: 'spill' }).finding;
        var res = mgr.resolveFinding(f.id, { correctedBy: 'Jane', action: 'cleaned' });
        expect(res.success).toBe(true);
        expect(res.finding.status).toBe('closed');
        expect(res.finding.correctedBy).toBe('Jane');
        expect(res.finding.correctiveAction).toBe('cleaned');
    });

    test('resolveFinding rejects unknown id', function () {
        expect(mgr.resolveFinding('bogus').success).toBe(false);
    });

    test('cannot resolve an already-closed finding', function () {
        var f = mgr.reportFinding({ area: 'A', description: 'spill' }).finding;
        mgr.resolveFinding(f.id, { correctedBy: 'J', action: 'fixed' });
        var res2 = mgr.resolveFinding(f.id, { correctedBy: 'J', action: 'again' });
        expect(res2.success).toBe(false);
    });
});

describe('labSafetyChecklist - checkPpeCompliance', function () {
    var mgr;
    beforeEach(function () { mgr = safety.createLabSafetyChecklist(); });

    test('rejects unknown hazard level', function () {
        expect(mgr.checkPpeCompliance('nope', []).success).toBe(false);
    });
    test('rejects non-array wornPpe', function () {
        expect(mgr.checkPpeCompliance('bsl1', 'lab coat').success).toBe(false);
    });

    test('flags missing required PPE', function () {
        var res = mgr.checkPpeCompliance('bsl2', ['lab coat']);
        expect(res.success).toBe(true);
        expect(res.compliant).toBe(false);
        expect(res.missing.length).toBeGreaterThan(0);
    });

    test('compliant when all required PPE present (substring match)', function () {
        var res = mgr.checkPpeCompliance('bsl1', ['lab coat', 'nitrile gloves', 'safety glasses']);
        expect(res.compliant).toBe(true);
        expect(res.missing).toEqual([]);
    });

    test('reports missing recommended without failing compliance', function () {
        var res = mgr.checkPpeCompliance('bsl1', ['lab coat', 'gloves', 'safety glasses']);
        expect(res.compliant).toBe(true);
        expect(Array.isArray(res.missingRecommended)).toBe(true);
    });
});

describe('labSafetyChecklist - getAreaSafetyScore', function () {
    var mgr;
    beforeEach(function () { mgr = safety.createLabSafetyChecklist(); });

    test('returns null score for area with no checklists', function () {
        var res = mgr.getAreaSafetyScore('NowhereLand');
        expect(res.success).toBe(true);
        expect(res.score).toBeNull();
    });

    test('computes grade A for spotless area', function () {
        mgr.createChecklist({
            area: 'Clean Lab', inspector: 'J',
            items: [{ item: 'x', checked: true }, { item: 'y', checked: true }]
        });
        var res = mgr.getAreaSafetyScore('Clean Lab');
        expect(res.finalScore).toBe(100);
        expect(res.grade).toBe('A');
    });

    test('applies penalty for open critical findings', function () {
        mgr.createChecklist({
            area: 'Risky Lab', inspector: 'J',
            items: [{ item: 'x', checked: true }]
        });
        mgr.reportFinding({ area: 'Risky Lab', description: 'fire hazard', risk: 'critical' });
        mgr.reportFinding({ area: 'Risky Lab', description: 'leak', risk: 'critical' });
        var res = mgr.getAreaSafetyScore('Risky Lab');
        expect(res.criticalOpenFindings).toBeGreaterThanOrEqual(2);
        expect(res.finalScore).toBeLessThan(100);
    });
});

describe('labSafetyChecklist - generateAuditReport', function () {
    test('aggregates across registered areas', function () {
        var mgr = safety.createLabSafetyChecklist();
        mgr.registerArea({ name: 'Lab A' });
        mgr.registerArea({ name: 'Lab B', hazardLevel: 'bsl2' });
        mgr.createChecklist({
            area: 'Lab A', inspector: 'J',
            items: [{ item: 'x', checked: true }, { item: 'y', checked: true }]
        });
        mgr.reportFinding({ area: 'Lab B', description: 'broken sash', risk: 'high' });

        var res = mgr.generateAuditReport();
        expect(res.success).toBe(true);
        expect(res.report.registeredAreas).toBe(2);
        expect(res.report.totalChecklists).toBe(1);
        expect(res.report.totalFindings).toBe(1);
        expect(res.report.openFindings).toBe(1);
        expect(res.report.areaBreakdown.length).toBe(2);
    });

    test('handles empty manager gracefully', function () {
        var mgr = safety.createLabSafetyChecklist();
        var res = mgr.generateAuditReport();
        expect(res.success).toBe(true);
        expect(res.report.registeredAreas).toBe(0);
        expect(res.report.overallScore).toBeNull();
    });
});

describe('labSafetyChecklist - list helpers', function () {
    test('listTemplates returns metadata for each template', function () {
        var mgr = safety.createLabSafetyChecklist();
        var res = mgr.listTemplates();
        expect(res.success).toBe(true);
        expect(res.templates.length).toBeGreaterThan(0);
        res.templates.forEach(function (t) {
            expect(t.name).toBeDefined();
            expect(t.itemCount).toBeGreaterThan(0);
            expect(Array.isArray(t.categories)).toBe(true);
        });
    });

    test('listPpeProfiles returns metadata for each hazard profile', function () {
        var mgr = safety.createLabSafetyChecklist();
        var res = mgr.listPpeProfiles();
        expect(res.success).toBe(true);
        expect(res.profiles.length).toBeGreaterThan(0);
        var keys = res.profiles.map(function (p) { return p.key; });
        ['bsl1', 'bsl2', 'chemical', 'uv', 'thermal'].forEach(function (k) {
            expect(keys).toContain(k);
        });
    });
});
