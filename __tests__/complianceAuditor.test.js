'use strict';

var _mod = require('../docs/shared/complianceAuditor');
var createComplianceAuditor = _mod.createComplianceAuditor;

describe('Lab Compliance Auditor Engine', function () {
    var auditor;

    beforeEach(function () {
        auditor = createComplianceAuditor();
    });

    // ── Framework Management ───────────────────────────────────

    describe('enableFramework', function () {
        test('enables a valid framework', function () {
            var res = auditor.enableFramework('GMP');
            expect(res.success).toBe(true);
            expect(res.framework).toBe('GMP');
        });

        test('rejects unknown framework', function () {
            var res = auditor.enableFramework('FAKE');
            expect(res.success).toBe(false);
            expect(res.error).toContain('Unknown framework');
        });

        test('rejects empty string', function () {
            expect(auditor.enableFramework('').success).toBe(false);
        });

        test('rejects null', function () {
            expect(auditor.enableFramework(null).success).toBe(false);
        });

        test('rejects prototype pollution key', function () {
            expect(auditor.enableFramework('__proto__').success).toBe(false);
        });
    });

    describe('disableFramework', function () {
        test('disables an enabled framework', function () {
            auditor.enableFramework('GLP');
            var res = auditor.disableFramework('GLP');
            expect(res.success).toBe(true);
        });

        test('rejects unknown framework', function () {
            expect(auditor.disableFramework('NOPE').success).toBe(false);
        });
    });

    describe('listFrameworks', function () {
        test('lists all frameworks with status', function () {
            var list = auditor.listFrameworks();
            expect(list.length).toBe(5);
            expect(list[0]).toHaveProperty('id');
            expect(list[0]).toHaveProperty('name');
            expect(list[0]).toHaveProperty('enabled');
            expect(list[0]).toHaveProperty('categories');
            expect(list[0]).toHaveProperty('checks');
        });

        test('shows enabled status after enabling', function () {
            auditor.enableFramework('GMP');
            var list = auditor.listFrameworks();
            var gmp = list.find(function (f) { return f.id === 'GMP'; });
            expect(gmp.enabled).toBe(true);
        });
    });

    describe('getFrameworkDetails', function () {
        test('returns details for valid framework', function () {
            var res = auditor.getFrameworkDetails('GLP');
            expect(res.success).toBe(true);
            expect(res.name).toBe('Good Laboratory Practice');
            expect(res.categories.length).toBe(4);
            expect(res.categories[0].checks.length).toBeGreaterThan(0);
        });

        test('rejects unknown framework', function () {
            expect(auditor.getFrameworkDetails('NOPE').success).toBe(false);
        });

        test('rejects missing id', function () {
            expect(auditor.getFrameworkDetails().success).toBe(false);
        });

        test('each check has required fields', function () {
            var res = auditor.getFrameworkDetails('GMP');
            var check = res.categories[0].checks[0];
            expect(check).toHaveProperty('id');
            expect(check).toHaveProperty('label');
            expect(check).toHaveProperty('operationType');
            expect(check).toHaveProperty('severity');
        });
    });

    // ── Operation Logging ──────────────────────────────────────

    describe('logOperation', function () {
        test('logs a valid calibration operation', function () {
            var res = auditor.logOperation({
                type: 'calibration',
                resource: 'bioprinter-01',
                performedBy: 'tech-jane',
                details: { result: 'pass' },
                evidence: ['CAL-001']
            });
            expect(res.success).toBe(true);
            expect(res.operationId).toBeDefined();
        });

        test('logs all 7 operation types', function () {
            var types = ['calibration', 'training', 'documentChange', 'maintenance', 'dataEntry', 'cleaning', 'validation'];
            for (var i = 0; i < types.length; i++) {
                var res = auditor.logOperation({ type: types[i], resource: 'r', performedBy: 'p' });
                expect(res.success).toBe(true);
            }
        });

        test('rejects invalid type', function () {
            var res = auditor.logOperation({ type: 'magic', resource: 'r', performedBy: 'p' });
            expect(res.success).toBe(false);
            expect(res.error).toContain('type');
        });

        test('rejects missing resource', function () {
            expect(auditor.logOperation({ type: 'calibration', performedBy: 'p' }).success).toBe(false);
        });

        test('rejects missing performedBy', function () {
            expect(auditor.logOperation({ type: 'calibration', resource: 'r' }).success).toBe(false);
        });

        test('rejects null opts', function () {
            expect(auditor.logOperation(null).success).toBe(false);
        });

        test('rejects prototype pollution in resource', function () {
            expect(auditor.logOperation({ type: 'calibration', resource: '__proto__', performedBy: 'p' }).success).toBe(false);
        });

        test('rejects prototype pollution in performedBy', function () {
            expect(auditor.logOperation({ type: 'calibration', resource: 'r', performedBy: 'constructor' }).success).toBe(false);
        });

        test('defaults timestamp to now', function () {
            var before = Date.now();
            auditor.logOperation({ type: 'cleaning', resource: 'r', performedBy: 'p' });
            var ops = auditor.getOperations();
            expect(ops[0].timestamp).toBeGreaterThanOrEqual(before);
        });

        test('uses provided timestamp', function () {
            auditor.logOperation({ type: 'cleaning', resource: 'r', performedBy: 'p', timestamp: 1000 });
            var ops = auditor.getOperations();
            expect(ops[0].timestamp).toBe(1000);
        });
    });

    describe('getOperations', function () {
        test('returns all operations', function () {
            auditor.logOperation({ type: 'calibration', resource: 'a', performedBy: 'p' });
            auditor.logOperation({ type: 'training', resource: 'b', performedBy: 'p' });
            expect(auditor.getOperations().length).toBe(2);
        });

        test('filters by type', function () {
            auditor.logOperation({ type: 'calibration', resource: 'a', performedBy: 'p' });
            auditor.logOperation({ type: 'training', resource: 'b', performedBy: 'p' });
            expect(auditor.getOperations({ type: 'calibration' }).length).toBe(1);
        });

        test('filters by resource', function () {
            auditor.logOperation({ type: 'calibration', resource: 'printer-01', performedBy: 'p' });
            auditor.logOperation({ type: 'calibration', resource: 'printer-02', performedBy: 'p' });
            expect(auditor.getOperations({ resource: 'printer-01' }).length).toBe(1);
        });
    });

    // ── Audit ──────────────────────────────────────────────────

    describe('runAudit', function () {
        test('fails with no frameworks enabled', function () {
            var res = auditor.runAudit();
            expect(res.success).toBe(false);
            expect(res.error).toContain('No frameworks');
        });

        test('runs audit against single enabled framework', function () {
            auditor.enableFramework('GLP');
            var res = auditor.runAudit();
            expect(res.success).toBe(true);
            expect(res.score).toBeDefined();
            expect(res.label).toBeDefined();
            expect(res.frameworks.length).toBe(1);
        });

        test('runs audit against specific framework', function () {
            auditor.enableFramework('GLP');
            auditor.enableFramework('GMP');
            var res = auditor.runAudit({ framework: 'GLP' });
            expect(res.success).toBe(true);
            expect(res.frameworks.length).toBe(1);
            expect(res.frameworks[0].id).toBe('GLP');
        });

        test('rejects audit of unknown framework', function () {
            expect(auditor.runAudit({ framework: 'FAKE' }).success).toBe(false);
        });

        test('rejects audit of disabled framework', function () {
            expect(auditor.runAudit({ framework: 'GLP' }).success).toBe(false);
        });

        test('produces gaps for unmet checks', function () {
            auditor.enableFramework('GLP');
            var res = auditor.runAudit();
            expect(res.gapCount).toBeGreaterThan(0);
            expect(res.gaps.length).toBe(res.gapCount);
        });

        test('scoring improves with operations', function () {
            auditor.enableFramework('GLP');
            var before = auditor.runAudit();
            auditor.logOperation({ type: 'calibration', resource: 'r', performedBy: 'p', details: { result: 'pass' } });
            auditor.logOperation({ type: 'training', resource: 'r', performedBy: 'p', details: { result: 'pass' } });
            auditor.logOperation({ type: 'documentChange', resource: 'r', performedBy: 'p', details: { result: 'pass' } });
            auditor.logOperation({ type: 'validation', resource: 'r', performedBy: 'p', details: { result: 'pass' } });
            auditor.logOperation({ type: 'dataEntry', resource: 'r', performedBy: 'p', details: { result: 'pass' } });
            var after = auditor.runAudit();
            expect(after.score).toBeGreaterThan(before.score);
        });

        test('multi-framework audit averages scores', function () {
            auditor.enableFramework('GLP');
            auditor.enableFramework('GMP');
            var res = auditor.runAudit();
            expect(res.frameworkCount).toBe(2);
            expect(res.frameworks.length).toBe(2);
        });

        test('audit result contains color', function () {
            auditor.enableFramework('GLP');
            var res = auditor.runAudit();
            expect(res.color).toBeDefined();
            expect(res.color.startsWith('#')).toBe(true);
        });

        test('perfect compliance yields excellent', function () {
            auditor.enableFramework('GLP');
            // Log all operation types with pass results
            var types = ['calibration', 'training', 'documentChange', 'maintenance', 'dataEntry', 'cleaning', 'validation'];
            for (var i = 0; i < types.length; i++) {
                auditor.logOperation({ type: types[i], resource: 'r', performedBy: 'p', details: { result: 'pass' } });
            }
            var res = auditor.runAudit();
            expect(res.score).toBeGreaterThanOrEqual(90);
            expect(res.label).toBe('excellent');
        });
    });

    describe('getComplianceScore', function () {
        test('fails before any audit', function () {
            expect(auditor.getComplianceScore().success).toBe(false);
        });

        test('returns score after audit', function () {
            auditor.enableFramework('GLP');
            auditor.runAudit();
            var res = auditor.getComplianceScore();
            expect(res.success).toBe(true);
            expect(typeof res.score).toBe('number');
            expect(res.label).toBeDefined();
        });
    });

    // ── Risk Assessment ────────────────────────────────────────

    describe('assessRisk', function () {
        test('fails before any audit', function () {
            expect(auditor.assessRisk().success).toBe(false);
        });

        test('returns risk assessment after audit', function () {
            auditor.enableFramework('GLP');
            auditor.runAudit();
            var res = auditor.assessRisk();
            expect(res.success).toBe(true);
            expect(res.risks.length).toBeGreaterThan(0);
            expect(res.riskExposure).toBeDefined();
        });

        test('risks are sorted by score descending', function () {
            auditor.enableFramework('GMP');
            auditor.runAudit();
            var res = auditor.assessRisk();
            for (var i = 1; i < res.risks.length; i++) {
                expect(res.risks[i].riskScore).toBeLessThanOrEqual(res.risks[i - 1].riskScore);
            }
        });

        test('risk levels are classified correctly', function () {
            auditor.enableFramework('GLP');
            auditor.runAudit();
            var res = auditor.assessRisk();
            for (var i = 0; i < res.risks.length; i++) {
                var r = res.risks[i];
                expect(['low', 'medium', 'high', 'critical']).toContain(r.riskLevel);
            }
        });

        test('critical gaps produce high risk scores', function () {
            auditor.enableFramework('GLP');
            auditor.runAudit();
            var res = auditor.assessRisk();
            var critical = res.risks.filter(function (r) { return r.severity === 'critical'; });
            for (var i = 0; i < critical.length; i++) {
                expect(critical[i].riskScore).toBeGreaterThanOrEqual(10);
            }
        });

        test('includes count breakdowns', function () {
            auditor.enableFramework('GMP');
            auditor.runAudit();
            var res = auditor.assessRisk();
            expect(typeof res.criticalCount).toBe('number');
            expect(typeof res.highCount).toBe('number');
            expect(typeof res.mediumCount).toBe('number');
            expect(typeof res.lowCount).toBe('number');
        });
    });

    // ── Remediation ────────────────────────────────────────────

    describe('getRemediationPlan', function () {
        test('fails before any audit', function () {
            expect(auditor.getRemediationPlan().success).toBe(false);
        });

        test('returns prioritized actions', function () {
            auditor.enableFramework('GLP');
            auditor.runAudit();
            var res = auditor.getRemediationPlan();
            expect(res.success).toBe(true);
            expect(res.actionCount).toBeGreaterThan(0);
            expect(res.totalEffortHours).toBeGreaterThan(0);
        });

        test('actions have required fields', function () {
            auditor.enableFramework('GMP');
            auditor.runAudit();
            var res = auditor.getRemediationPlan();
            var a = res.actions[0];
            expect(a).toHaveProperty('framework');
            expect(a).toHaveProperty('severity');
            expect(a).toHaveProperty('action');
            expect(a).toHaveProperty('effortHours');
            expect(a).toHaveProperty('role');
            expect(a).toHaveProperty('deadlineDays');
        });

        test('critical items have shorter deadlines', function () {
            auditor.enableFramework('GLP');
            auditor.runAudit();
            var res = auditor.getRemediationPlan();
            var critical = res.actions.filter(function (a) { return a.severity === 'critical'; });
            var minor = res.actions.filter(function (a) { return a.severity === 'minor'; });
            if (critical.length > 0 && minor.length > 0) {
                expect(critical[0].deadlineDays).toBeLessThan(minor[0].deadlineDays);
            }
        });

        test('actions sorted by priority', function () {
            auditor.enableFramework('GLP');
            auditor.runAudit();
            var res = auditor.getRemediationPlan();
            for (var i = 1; i < res.actions.length; i++) {
                expect(res.actions[i].priority).toBeGreaterThanOrEqual(res.actions[i - 1].priority);
            }
        });
    });

    // ── Report ─────────────────────────────────────────────────

    describe('generateReport', function () {
        test('fails before any audit', function () {
            expect(auditor.generateReport().success).toBe(false);
        });

        test('generates full report', function () {
            auditor.enableFramework('GLP');
            auditor.logOperation({ type: 'calibration', resource: 'r', performedBy: 'p', evidence: ['CAL-001'] });
            auditor.runAudit();
            var res = auditor.generateReport();
            expect(res.success).toBe(true);
            expect(res.executiveSummary).toBeDefined();
            expect(res.frameworks).toBeDefined();
            expect(res.riskAssessment).toBeDefined();
            expect(res.remediationPlan).toBeDefined();
            expect(res.evidenceReferences).toBeDefined();
        });

        test('collects evidence references', function () {
            auditor.enableFramework('GLP');
            auditor.logOperation({ type: 'calibration', resource: 'r', performedBy: 'p', evidence: ['CAL-001', 'CAL-002'] });
            auditor.runAudit();
            var res = auditor.generateReport();
            expect(res.evidenceReferences).toContain('CAL-001');
            expect(res.evidenceReferences).toContain('CAL-002');
        });

        test('executive summary has required fields', function () {
            auditor.enableFramework('GMP');
            auditor.runAudit();
            var res = auditor.generateReport();
            expect(res.executiveSummary).toHaveProperty('score');
            expect(res.executiveSummary).toHaveProperty('label');
            expect(res.executiveSummary).toHaveProperty('gapCount');
            expect(res.executiveSummary).toHaveProperty('riskExposure');
        });
    });

    // ── Dashboard ──────────────────────────────────────────────

    describe('getDashboard', function () {
        test('works with no data', function () {
            var dash = auditor.getDashboard();
            expect(dash.complianceScore).toBe(0);
            expect(dash.operationCount).toBe(0);
            expect(dash.auditCount).toBe(0);
        });

        test('returns full dashboard after audit', function () {
            auditor.enableFramework('GLP');
            auditor.logOperation({ type: 'calibration', resource: 'r', performedBy: 'p' });
            auditor.runAudit();
            var dash = auditor.getDashboard();
            expect(dash.complianceScore).toBeDefined();
            expect(dash.healthLabel).toBeDefined();
            expect(dash.enabledFrameworks.length).toBe(1);
            expect(dash.operationCount).toBe(1);
            expect(dash.auditCount).toBe(1);
            expect(dash.latestAudit).toBeDefined();
            expect(dash.riskSummary).toBeDefined();
            expect(dash.remediationSummary).toBeDefined();
            expect(dash.insights).toBeDefined();
        });
    });

    // ── Insights ───────────────────────────────────────────────

    describe('insights', function () {
        test('no operations warning insight', function () {
            auditor.enableFramework('GLP');
            auditor.runAudit();
            var dash = auditor.getDashboard();
            var noOps = dash.insights.filter(function (i) { return i.type === 'no_operations'; });
            expect(noOps.length).toBe(1);
        });

        test('recurring non-conformance detection', function () {
            auditor.enableFramework('GLP');
            auditor.runAudit();
            auditor.runAudit(); // same gaps
            var dash = auditor.getDashboard();
            var recurring = dash.insights.filter(function (i) { return i.type === 'recurring_non_conformance'; });
            expect(recurring.length).toBeGreaterThan(0);
        });

        test('compliance trend detection (improving)', function () {
            auditor.enableFramework('GLP');
            auditor.runAudit(); // low score
            // Add operations to improve
            var types = ['calibration', 'training', 'documentChange', 'validation', 'dataEntry'];
            for (var i = 0; i < types.length; i++) {
                auditor.logOperation({ type: types[i], resource: 'r', performedBy: 'p', details: { result: 'pass' } });
            }
            auditor.runAudit();
            var dash = auditor.getDashboard();
            var trend = dash.insights.filter(function (i) { return i.type === 'compliance_trend'; });
            expect(trend.length).toBeGreaterThan(0);
            expect(trend[0].message).toContain('improving');
        });

        test('cross-framework synergy detection', function () {
            auditor.enableFramework('GLP');
            auditor.enableFramework('GMP');
            auditor.runAudit();
            var dash = auditor.getDashboard();
            var synergy = dash.insights.filter(function (i) { return i.type === 'cross_framework_synergy'; });
            expect(synergy.length).toBeGreaterThan(0);
        });
    });

    // ── Reset ──────────────────────────────────────────────────

    describe('reset', function () {
        test('clears all state', function () {
            auditor.enableFramework('GLP');
            auditor.logOperation({ type: 'calibration', resource: 'r', performedBy: 'p' });
            auditor.runAudit();
            auditor.reset();
            expect(auditor.getOperations().length).toBe(0);
            expect(auditor.getComplianceScore().success).toBe(false);
            var list = auditor.listFrameworks();
            var anyEnabled = list.filter(function (f) { return f.enabled; });
            expect(anyEnabled.length).toBe(0);
        });
    });

    // ── Edge Cases ─────────────────────────────────────────────

    describe('edge cases', function () {
        test('all five frameworks can be enabled', function () {
            var ids = ['GLP', 'GMP', 'ISO-17025', 'FDA-21CFR11', 'EU-GMP-Annex11'];
            for (var i = 0; i < ids.length; i++) {
                expect(auditor.enableFramework(ids[i]).success).toBe(true);
            }
            var res = auditor.runAudit();
            expect(res.frameworkCount).toBe(5);
        });

        test('re-enabling a framework is idempotent', function () {
            auditor.enableFramework('GMP');
            auditor.enableFramework('GMP');
            var list = auditor.listFrameworks();
            var gmp = list.filter(function (f) { return f.id === 'GMP' && f.enabled; });
            expect(gmp.length).toBe(1);
        });

        test('evidence deduplication in report', function () {
            auditor.enableFramework('GLP');
            auditor.logOperation({ type: 'calibration', resource: 'r', performedBy: 'p', evidence: ['EV-001'] });
            auditor.logOperation({ type: 'calibration', resource: 'r2', performedBy: 'p', evidence: ['EV-001'] });
            auditor.runAudit();
            var report = auditor.generateReport();
            var count = report.evidenceReferences.filter(function (e) { return e === 'EV-001'; }).length;
            expect(count).toBe(1);
        });
    });
});
