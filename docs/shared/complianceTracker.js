'use strict';

/**
 * Lab Compliance Tracker — autonomous regulatory compliance monitoring.
 *
 * Tracks compliance across GLP, GMP, ISO 17025, BSL frameworks.
 * Detects overdue items, scores frameworks, generates recommendations.
 *
 * @example
 *   var tracker = createComplianceTracker();
 *   tracker.addRequirement({ id: 'CAL-001', category: 'calibration',
 *     name: 'Pipette P200 Cal', framework: 'ISO17025', dueDate: '2026-05-15' });
 *   var report = tracker.audit();
 */

var FRAMEWORKS = {
    GLP: { name: 'Good Laboratory Practice', categories: ['documentation', 'calibration', 'training', 'audit', 'sop'] },
    GMP: { name: 'Good Manufacturing Practice', categories: ['calibration', 'training', 'validation', 'cleaning', 'environmental'] },
    ISO17025: { name: 'ISO/IEC 17025', categories: ['calibration', 'proficiency', 'measurement_uncertainty', 'traceability'] },
    BSL: { name: 'Biosafety Level', categories: ['training', 'ppe', 'waste_disposal', 'decontamination', 'incident_reporting'] }
};

var SEVERITY = { critical: 3, major: 2, minor: 1, info: 0 };

function daysBetween(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function toISO(d) { return new Date(d).toISOString().slice(0, 10); }

function createComplianceTracker(options) {
    options = options || {};
    var warningDays = options.warningDays || 30;
    var criticalDays = options.criticalDays || 7;
    var requirements = [];
    var auditLog = [];
    var autoMonitor = false;
    var monitorInterval = null;

    function addRequirement(req) {
        if (!req.id || !req.category || !req.name || !req.framework) {
            throw new Error('Requirement must have id, category, name, and framework');
        }
        if (!FRAMEWORKS[req.framework]) {
            throw new Error('Unknown framework: ' + req.framework);
        }
        var entry = {
            id: req.id, category: req.category, name: req.name,
            framework: req.framework, dueDate: req.dueDate || null,
            status: req.status || 'pending', assignee: req.assignee || null,
            notes: req.notes || '', lastReviewed: req.lastReviewed || null,
            createdAt: new Date().toISOString(), history: []
        };
        requirements.push(entry);
        logEvent('ADDED', entry.id, 'Requirement added: ' + entry.name);
        return entry;
    }

    function updateRequirement(id, updates) {
        var req = findById(id);
        if (!req) throw new Error('Requirement not found: ' + id);
        var oldStatus = req.status;
        Object.keys(updates).forEach(function (k) {
            if (k !== 'id' && k !== 'history' && k !== 'createdAt') req[k] = updates[k];
        });
        req.lastReviewed = new Date().toISOString();
        req.history.push({ date: new Date().toISOString(), oldStatus: oldStatus, newStatus: req.status, changes: Object.keys(updates) });
        logEvent('UPDATED', id, 'Status: ' + oldStatus + ' -> ' + req.status);
        return req;
    }

    function findById(id) {
        for (var i = 0; i < requirements.length; i++) {
            if (requirements[i].id === id) return requirements[i];
        }
        return null;
    }

    function logEvent(type, reqId, message) {
        auditLog.push({ timestamp: new Date().toISOString(), type: type, requirementId: reqId, message: message });
    }

    function classifyStatus(req, now) {
        now = now || new Date().toISOString().slice(0, 10);
        if (req.status === 'waived' || req.status === 'na') return { level: 'info', label: 'Not Applicable' };
        if (!req.dueDate) return { level: 'info', label: 'No due date' };
        var days = daysBetween(now, req.dueDate);
        if (days < 0) return { level: 'critical', label: 'OVERDUE by ' + Math.abs(days) + ' days' };
        if (days <= criticalDays) return { level: 'critical', label: 'Due in ' + days + ' days (CRITICAL)' };
        if (days <= warningDays) return { level: 'major', label: 'Due in ' + days + ' days (WARNING)' };
        return { level: 'minor', label: 'Due in ' + days + ' days' };
    }

    function scoreToGrade(score) {
        if (score >= 95) return 'A+';
        if (score >= 90) return 'A';
        if (score >= 85) return 'B+';
        if (score >= 80) return 'B';
        if (score >= 70) return 'C';
        if (score >= 60) return 'D';
        return 'F';
    }

    function audit(opts) {
        opts = opts || {};
        var now = opts.asOf || new Date().toISOString().slice(0, 10);
        var findings = [];
        var frameworkScores = {};

        requirements.forEach(function (req) {
            var cls = classifyStatus(req, now);
            findings.push({
                id: req.id, name: req.name, framework: req.framework,
                category: req.category, severity: cls.level, detail: cls.label,
                assignee: req.assignee, dueDate: req.dueDate
            });
        });

        Object.keys(FRAMEWORKS).forEach(function (fw) {
            var fwReqs = requirements.filter(function (r) { return r.framework === fw; });
            if (fwReqs.length === 0) { frameworkScores[fw] = null; return; }
            var total = 0;
            fwReqs.forEach(function (r) {
                var cls = classifyStatus(r, now);
                if (cls.level === 'critical') total += 0;
                else if (cls.level === 'major') total += 50;
                else if (cls.level === 'minor') total += 90;
                else total += 100;
            });
            frameworkScores[fw] = Math.round(total / fwReqs.length);
        });

        var activeFrameworks = Object.keys(frameworkScores).filter(function (k) { return frameworkScores[k] !== null; });
        var overallScore = 0;
        if (activeFrameworks.length > 0) {
            var sum = 0;
            activeFrameworks.forEach(function (k) { sum += frameworkScores[k]; });
            overallScore = Math.round(sum / activeFrameworks.length);
        }

        var recommendations = generateRecommendations(findings, frameworkScores, now);

        var result = {
            auditDate: now, overallScore: overallScore, grade: scoreToGrade(overallScore),
            totalRequirements: requirements.length,
            findings: findings.sort(function (a, b) { return SEVERITY[b.severity] - SEVERITY[a.severity]; }),
            frameworkScores: frameworkScores, recommendations: recommendations,
            summary: {
                critical: findings.filter(function (f) { return f.severity === 'critical'; }).length,
                major: findings.filter(function (f) { return f.severity === 'major'; }).length,
                minor: findings.filter(function (f) { return f.severity === 'minor'; }).length,
                info: findings.filter(function (f) { return f.severity === 'info'; }).length
            }
        };

        logEvent('AUDIT', null, 'Audit completed. Score: ' + overallScore + ' (' + result.grade + ')');
        return result;
    }

    function generateRecommendations(findings, frameworkScores, now) {
        var recs = [];
        var criticals = findings.filter(function (f) { return f.severity === 'critical'; });
        var majors = findings.filter(function (f) { return f.severity === 'major'; });

        if (criticals.length > 0) {
            recs.push({
                priority: 'urgent',
                action: 'Address ' + criticals.length + ' critical compliance item(s) immediately',
                items: criticals.map(function (c) { return c.id + ': ' + c.name + ' - ' + c.detail; }),
                impact: 'Regulatory risk, potential lab shutdown'
            });
        }
        if (majors.length > 0) {
            recs.push({
                priority: 'high',
                action: 'Schedule ' + majors.length + ' upcoming renewal(s) within ' + warningDays + ' days',
                items: majors.map(function (m) { return m.id + ': ' + m.name + ' - ' + m.detail; }),
                impact: 'Avoid escalation to critical status'
            });
        }

        Object.keys(frameworkScores).forEach(function (fw) {
            var score = frameworkScores[fw];
            if (score !== null && score < 70) {
                recs.push({ priority: 'high', action: fw + ' compliance score is ' + score + '% - schedule review', items: [], impact: FRAMEWORKS[fw].name + ' audit readiness at risk' });
            }
        });

        Object.keys(FRAMEWORKS).forEach(function (fw) {
            var fwReqs = requirements.filter(function (r) { return r.framework === fw; });
            if (fwReqs.length === 0) return;
            var coveredCats = {};
            fwReqs.forEach(function (r) { coveredCats[r.category] = true; });
            var missing = FRAMEWORKS[fw].categories.filter(function (c) { return !coveredCats[c]; });
            if (missing.length > 0) {
                recs.push({ priority: 'medium', action: fw + ' missing coverage for: ' + missing.join(', '), items: [], impact: 'Incomplete compliance coverage' });
            }
        });

        var staleCount = 0;
        requirements.forEach(function (r) {
            if (r.lastReviewed && daysBetween(r.lastReviewed, now) > 90) staleCount++;
        });
        if (staleCount > 0) {
            recs.push({ priority: 'medium', action: staleCount + ' requirement(s) not reviewed in 90+ days', items: [], impact: 'Stale records may hide compliance drift' });
        }
        return recs;
    }

    function getTimeline(daysAhead) {
        daysAhead = daysAhead || 90;
        var now = new Date();
        var cutoff = new Date(now.getTime() + daysAhead * 86400000);
        var timeline = [];
        requirements.forEach(function (r) {
            if (!r.dueDate) return;
            if (new Date(r.dueDate) <= cutoff) {
                timeline.push({ date: r.dueDate, id: r.id, name: r.name, framework: r.framework, category: r.category, daysUntil: daysBetween(toISO(now), r.dueDate), assignee: r.assignee });
            }
        });
        return timeline.sort(function (a, b) { return a.daysUntil - b.daysUntil; });
    }

    function getFrameworkReport(framework) {
        if (!FRAMEWORKS[framework]) throw new Error('Unknown framework: ' + framework);
        var fwReqs = requirements.filter(function (r) { return r.framework === framework; });
        var now = new Date().toISOString().slice(0, 10);
        var byCategory = {};
        FRAMEWORKS[framework].categories.forEach(function (cat) { byCategory[cat] = { items: [], compliant: 0, total: 0 }; });
        fwReqs.forEach(function (r) {
            if (!byCategory[r.category]) byCategory[r.category] = { items: [], compliant: 0, total: 0 };
            var cls = classifyStatus(r, now);
            byCategory[r.category].items.push({ id: r.id, name: r.name, status: cls });
            byCategory[r.category].total++;
            if (cls.level === 'minor' || cls.level === 'info') byCategory[r.category].compliant++;
        });
        return { framework: framework, fullName: FRAMEWORKS[framework].name, categories: byCategory, totalItems: fwReqs.length, auditDate: now };
    }

    function exportReport(format) {
        var report = audit();
        if (format === 'json') return JSON.stringify(report, null, 2);
        if (format === 'csv') {
            var lines = ['id,name,framework,category,severity,detail,assignee,dueDate'];
            report.findings.forEach(function (f) {
                lines.push([f.id, '"' + f.name + '"', f.framework, f.category, f.severity, '"' + f.detail + '"', f.assignee || '', f.dueDate || ''].join(','));
            });
            return lines.join('\n');
        }
        var out = ['=== Lab Compliance Audit Report ===',
            'Date: ' + report.auditDate,
            'Overall Score: ' + report.overallScore + '% (' + report.grade + ')',
            'Critical: ' + report.summary.critical + '  Major: ' + report.summary.major + '  Minor: ' + report.summary.minor, ''];
        out.push('--- Framework Scores ---');
        Object.keys(report.frameworkScores).forEach(function (fw) {
            var s = report.frameworkScores[fw];
            out.push('  ' + fw + ': ' + (s !== null ? s + '%' : 'N/A'));
        });
        out.push('', '--- Findings ---');
        report.findings.forEach(function (f) { out.push('  [' + f.severity.toUpperCase() + '] ' + f.id + ': ' + f.name + ' - ' + f.detail); });
        out.push('', '--- Recommendations ---');
        report.recommendations.forEach(function (r, i) {
            out.push('  ' + (i + 1) + '. [' + r.priority.toUpperCase() + '] ' + r.action);
            if (r.impact) out.push('     Impact: ' + r.impact);
        });
        return out.join('\n');
    }

    function startAutoMonitor(intervalMs, callback) {
        if (autoMonitor) return;
        autoMonitor = true;
        intervalMs = intervalMs || 3600000;
        monitorInterval = setInterval(function () {
            var report = audit();
            var alerts = report.findings.filter(function (f) { return f.severity === 'critical'; }).map(function (f) { return { type: 'CRITICAL_COMPLIANCE', item: f }; });
            if (callback && alerts.length > 0) {
                callback({ alerts: alerts, score: report.overallScore, grade: report.grade, timestamp: new Date().toISOString() });
            }
        }, intervalMs);
        logEvent('MONITOR', null, 'Auto-monitor started');
    }

    function stopAutoMonitor() {
        if (monitorInterval) clearInterval(monitorInterval);
        autoMonitor = false;
        logEvent('MONITOR', null, 'Auto-monitor stopped');
    }

    return {
        addRequirement: addRequirement, updateRequirement: updateRequirement,
        findById: findById, audit: audit, getTimeline: getTimeline,
        getFrameworkReport: getFrameworkReport, exportReport: exportReport,
        startAutoMonitor: startAutoMonitor, stopAutoMonitor: stopAutoMonitor,
        getAuditLog: function () { return auditLog.slice(); },
        getRequirements: function () { return requirements.slice(); },
        FRAMEWORKS: FRAMEWORKS
    };
}

module.exports = { createComplianceTracker: createComplianceTracker };
