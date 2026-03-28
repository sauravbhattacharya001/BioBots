'use strict';

var mod = require('../docs/shared/labSafetyChecklist');

describe('labSafetyChecklist', function () {
    var mgr;

    beforeEach(function () {
        mgr = mod.createLabSafetyChecklist();
    });

    // ── Area registration ──────────────────────────────────────────

    describe('registerArea', function () {
        it('registers an area with defaults', function () {
            var res = mgr.registerArea({ name: 'Clean Room' });
            expect(res.success).toBe(true);
            expect(res.area.name).toBe('Clean Room');
            expect(res.area.hazardLevel).toBe('bsl1');
            expect(res.area.responsible).toBe('Unassigned');
        });

        it('registers with custom hazard level', function () {
            var res = mgr.registerArea({ name: 'Bio Lab', hazardLevel: 'bsl2', responsible: 'Dr. Kim' });
            expect(res.success).toBe(true);
            expect(res.area.hazardLevel).toBe('bsl2');
            expect(res.area.ppeProfile.level).toBe('BSL-2');
            expect(res.area.responsible).toBe('Dr. Kim');
        });

        it('fails without name', function () {
            expect(mgr.registerArea({}).success).toBe(false);
            expect(mgr.registerArea(null).success).toBe(false);
        });

        it('falls back to bsl1 for unknown hazard level', function () {
            var res = mgr.registerArea({ name: 'X', hazardLevel: 'unknown' });
            expect(res.success).toBe(true);
            expect(res.area.ppeProfile.level).toBe('BSL-1');
        });
    });

    // ── Checklist creation ─────────────────────────────────────────

    describe('createChecklist', function () {
        it('creates a passing checklist when all items checked', function () {
            var res = mgr.createChecklist({
                area: 'Lab A',
                inspector: 'J. Doe',
                items: [
                    { category: 'ppe', item: 'Gloves', checked: true, critical: true },
                    { category: 'ppe', item: 'Goggles', checked: true, critical: false },
                    { category: 'general', item: 'Clean bench', checked: true }
                ]
            });
            expect(res.success).toBe(true);
            expect(res.checklist.summary.status).toBe('PASS');
            expect(res.checklist.summary.score).toBe(100);
            expect(res.checklist.summary.criticalFailures).toEqual([]);
        });

        it('fails when critical items unchecked', function () {
            var res = mgr.createChecklist({
                area: 'Lab A',
                inspector: 'J. Doe',
                items: [
                    { category: 'ppe', item: 'Gloves', checked: false, critical: true },
                    { category: 'ppe', item: 'Goggles', checked: true }
                ]
            });
            expect(res.checklist.summary.status).toBe('FAIL');
            expect(res.checklist.summary.criticalFailures).toContain('Gloves');
        });

        it('returns CONDITIONAL for 70-89% score with no critical fails', function () {
            // 3/4 = 75%
            var res = mgr.createChecklist({
                area: 'Lab B',
                inspector: 'Test',
                items: [
                    { item: 'A', checked: true },
                    { item: 'B', checked: true },
                    { item: 'C', checked: true },
                    { item: 'D', checked: false }
                ]
            });
            expect(res.checklist.summary.status).toBe('CONDITIONAL');
            expect(res.checklist.summary.score).toBe(75);
        });

        it('returns FAIL for score < 70 with no critical fails', function () {
            // 1/4 = 25%
            var res = mgr.createChecklist({
                area: 'Lab C',
                inspector: 'Test',
                items: [
                    { item: 'A', checked: true },
                    { item: 'B', checked: false },
                    { item: 'C', checked: false },
                    { item: 'D', checked: false }
                ]
            });
            expect(res.checklist.summary.status).toBe('FAIL');
        });

        it('validates required fields', function () {
            expect(mgr.createChecklist(null).success).toBe(false);
            expect(mgr.createChecklist({ area: 'X' }).success).toBe(false);
            expect(mgr.createChecklist({ area: 'X', inspector: 'Y' }).success).toBe(false);
            expect(mgr.createChecklist({ area: 'X', inspector: 'Y', items: [] }).success).toBe(false);
        });

        it('assigns unique IDs', function () {
            var r1 = mgr.createChecklist({ area: 'A', inspector: 'I', items: [{ item: 'x', checked: true }] });
            var r2 = mgr.createChecklist({ area: 'A', inspector: 'I', items: [{ item: 'y', checked: true }] });
            expect(r1.checklist.id).not.toBe(r2.checklist.id);
        });
    });

    // ── Template generation ────────────────────────────────────────

    describe('generateFromTemplate', function () {
        it('generates daily checklist with all items unchecked', function () {
            var res = mgr.generateFromTemplate('daily', 'Lab A', 'Inspector');
            expect(res.success).toBe(true);
            expect(res.checklist.template).toBe('daily');
            // All unchecked → score 0, has critical fails
            expect(res.checklist.summary.status).toBe('FAIL');
            expect(res.checklist.summary.passed).toBe(0);
        });

        it('fails for unknown template', function () {
            var res = mgr.generateFromTemplate('nonexistent', 'Lab', 'I');
            expect(res.success).toBe(false);
            expect(res.error).toContain('Unknown template');
        });

        it('supports weekly and monthly templates', function () {
            expect(mgr.generateFromTemplate('weekly', 'X', 'Y').success).toBe(true);
            expect(mgr.generateFromTemplate('monthly', 'X', 'Y').success).toBe(true);
        });
    });

    // ── Findings ───────────────────────────────────────────────────

    describe('reportFinding / resolveFinding', function () {
        it('creates and resolves a finding', function () {
            var report = mgr.reportFinding({
                area: 'Lab A',
                description: 'Spill kit missing absorbent pads',
                risk: 'high',
                reporter: 'J. Smith',
                category: 'emergency'
            });
            expect(report.success).toBe(true);
            expect(report.finding.status).toBe('open');
            expect(report.finding.risk.label).toBe('High');

            var resolve = mgr.resolveFinding(report.finding.id, {
                correctedBy: 'M. Jones',
                action: 'Replaced spill kit supplies'
            });
            expect(resolve.success).toBe(true);
            expect(resolve.finding.status).toBe('closed');
            expect(resolve.finding.correctedBy).toBe('M. Jones');
        });

        it('cannot resolve a closed finding twice', function () {
            var f = mgr.reportFinding({ area: 'X', description: 'Test' });
            mgr.resolveFinding(f.finding.id, {});
            var res = mgr.resolveFinding(f.finding.id, {});
            expect(res.success).toBe(false);
            expect(res.error).toContain('already closed');
        });

        it('returns error for nonexistent finding', function () {
            expect(mgr.resolveFinding('NOPE', {}).success).toBe(false);
        });

        it('validates required fields', function () {
            expect(mgr.reportFinding(null).success).toBe(false);
            expect(mgr.reportFinding({ area: 'X' }).success).toBe(false);
        });
    });

    // ── PPE compliance ─────────────────────────────────────────────

    describe('checkPpeCompliance', function () {
        it('passes when all required PPE worn', function () {
            var res = mgr.checkPpeCompliance('bsl1', ['lab coat', 'gloves', 'safety glasses']);
            expect(res.success).toBe(true);
            expect(res.compliant).toBe(true);
            expect(res.missing).toEqual([]);
        });

        it('fails when required PPE missing', function () {
            var res = mgr.checkPpeCompliance('bsl2', ['lab coat', 'gloves']);
            expect(res.compliant).toBe(false);
            expect(res.missing.length).toBeGreaterThan(0);
        });

        it('reports missing recommended PPE', function () {
            var res = mgr.checkPpeCompliance('bsl1', ['lab coat', 'gloves', 'safety glasses']);
            expect(res.missingRecommended).toContain('closed-toe shoes');
        });

        it('errors on unknown hazard level', function () {
            expect(mgr.checkPpeCompliance('bsl99', []).success).toBe(false);
        });

        it('errors when wornPpe is not an array', function () {
            expect(mgr.checkPpeCompliance('bsl1', 'not array').success).toBe(false);
        });
    });

    // ── Area safety score ──────────────────────────────────────────

    describe('getAreaSafetyScore', function () {
        it('returns null score when no checklists exist', function () {
            var res = mgr.getAreaSafetyScore('Empty Lab');
            expect(res.score).toBeNull();
        });

        it('computes score with penalty for critical findings', function () {
            mgr.registerArea({ name: 'Lab X' });
            mgr.createChecklist({
                area: 'Lab X', inspector: 'I',
                items: [
                    { item: 'A', checked: true },
                    { item: 'B', checked: true },
                    { item: 'C', checked: true },
                    { item: 'D', checked: true },
                    { item: 'E', checked: true }
                ]
            });
            // Add a high-risk open finding (score 3 = critical for penalty)
            mgr.reportFinding({ area: 'Lab X', description: 'Broken eyewash', risk: 'high' });
            var score = mgr.getAreaSafetyScore('Lab X');
            expect(score.averageChecklistScore).toBe(100);
            expect(score.penalty).toBe(10); // 1 critical finding * 10
            expect(score.finalScore).toBe(90);
        });
    });

    // ── Audit report ───────────────────────────────────────────────

    describe('generateAuditReport', function () {
        it('generates report with registered areas', function () {
            mgr.registerArea({ name: 'Lab 1' });
            mgr.registerArea({ name: 'Lab 2' });
            var report = mgr.generateAuditReport();
            expect(report.success).toBe(true);
            expect(report.report.registeredAreas).toBe(2);
        });
    });

    // ── List helpers ───────────────────────────────────────────────

    describe('listTemplates / listPpeProfiles', function () {
        it('lists all templates', function () {
            var res = mgr.listTemplates();
            expect(res.success).toBe(true);
            expect(res.templates.length).toBe(3);
            var names = res.templates.map(function (t) { return t.name; });
            expect(names).toContain('daily');
        });

        it('lists all PPE profiles', function () {
            var res = mgr.listPpeProfiles();
            expect(res.success).toBe(true);
            expect(res.profiles.length).toBe(5);
        });
    });
});
