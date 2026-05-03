'use strict';

var round = require('./validation').round;
var _isDangerousKey = require('./sanitize').isDangerousKey;

/**
 * Lab Compliance Auditor Engine
 *
 * Autonomous regulatory compliance engine for bioprinting labs.
 * Validates lab operations against configurable regulatory frameworks
 * (GLP, GMP, ISO 17025, FDA 21 CFR Part 11, EU GMP Annex 11),
 * tracks compliance gaps, assesses risk, generates audit-ready reports,
 * and provides remediation timelines with autonomous insights.
 *
 * Agentic capabilities:
 * - Multi-framework regulatory compliance checking
 * - Autonomous gap detection and risk scoring via probability×impact matrix
 * - Prioritized remediation planning with effort estimates
 * - Audit-ready report generation with evidence references
 * - Pattern detection: recurring non-conformances, trend analysis
 * - Cross-framework synergy detection (one fix → multiple gaps)
 * - Composite health scoring 0-100 with 5 tiers
 *
 * @example
 *   var auditor = createComplianceAuditor();
 *   auditor.enableFramework('GMP');
 *   auditor.logOperation({ type: 'calibration', resource: 'bioprinter-01',
 *     performedBy: 'tech-jane', details: { result: 'pass' } });
 *   var result = auditor.runAudit();
 *   // result.score => 72, result.label => 'good'
 *   var dash = auditor.getDashboard();
 */

// ── Constants ──────────────────────────────────────────────────────

var OPERATION_TYPES = ['calibration', 'training', 'documentChange', 'maintenance', 'dataEntry', 'cleaning', 'validation'];
var OP_TYPE_SET = Object.create(null);
for (var _ot = 0; _ot < OPERATION_TYPES.length; _ot++) { OP_TYPE_SET[OPERATION_TYPES[_ot]] = true; }

var HEALTH_LABELS = [
    { min: 90, label: 'excellent',         color: '#22c55e' },
    { min: 75, label: 'good',              color: '#84cc16' },
    { min: 60, label: 'fair',              color: '#eab308' },
    { min: 40, label: 'needs_improvement', color: '#f97316' },
    { min: 0,  label: 'critical',          color: '#ef4444' }
];

var RISK_LEVELS = [
    { min: 17, label: 'critical', color: '#ef4444' },
    { min: 10, label: 'high',     color: '#f97316' },
    { min: 5,  label: 'medium',   color: '#eab308' },
    { min: 1,  label: 'low',      color: '#22c55e' }
];

var SEVERITY_MAP = { critical: 4, major: 3, minor: 2, observation: 1 };

// ── Framework Definitions ──────────────────────────────────────────

var FRAMEWORKS = {
    GLP: {
        name: 'Good Laboratory Practice',
        categories: {
            personnel: {
                weight: 0.25,
                checks: {
                    trainingRecordsCurrent:  { label: 'Training records current',  operationType: 'training',       severity: 'major' },
                    competencyAssessed:      { label: 'Competency assessed',       operationType: 'training',       severity: 'major' },
                    supervisionDocumented:   { label: 'Supervision documented',    operationType: 'documentChange', severity: 'minor' }
                }
            },
            equipment: {
                weight: 0.30,
                checks: {
                    calibrationCurrent:    { label: 'Calibration current',      operationType: 'calibration',    severity: 'critical' },
                    maintenanceLogged:     { label: 'Maintenance logged',       operationType: 'maintenance',    severity: 'major' },
                    qualificationRecords:  { label: 'Qualification records',    operationType: 'validation',     severity: 'major' }
                }
            },
            documentation: {
                weight: 0.25,
                checks: {
                    sopsCurrent:    { label: 'SOPs current',       operationType: 'documentChange', severity: 'major' },
                    changeControl:  { label: 'Change control',     operationType: 'documentChange', severity: 'critical' },
                    archivalPolicy: { label: 'Archival policy',    operationType: 'documentChange', severity: 'minor' }
                }
            },
            dataIntegrity: {
                weight: 0.20,
                checks: {
                    rawDataPreserved: { label: 'Raw data preserved', operationType: 'dataEntry',      severity: 'critical' },
                    auditTrail:       { label: 'Audit trail',        operationType: 'dataEntry',      severity: 'critical' },
                    backupProcedures: { label: 'Backup procedures',  operationType: 'validation',     severity: 'major' }
                }
            }
        }
    },
    GMP: {
        name: 'Good Manufacturing Practice',
        categories: {
            facility: {
                weight: 0.25,
                checks: {
                    cleaningSchedules:       { label: 'Cleaning schedules',        operationType: 'cleaning',       severity: 'major' },
                    environmentalMonitoring: { label: 'Environmental monitoring',  operationType: 'validation',     severity: 'critical' },
                    pestControl:             { label: 'Pest control',              operationType: 'maintenance',    severity: 'minor' }
                }
            },
            process: {
                weight: 0.30,
                checks: {
                    validationProtocols: { label: 'Validation protocols',  operationType: 'validation',     severity: 'critical' },
                    batchRecords:        { label: 'Batch records',         operationType: 'dataEntry',      severity: 'critical' },
                    deviationHandling:   { label: 'Deviation handling',    operationType: 'documentChange', severity: 'major' }
                }
            },
            quality: {
                weight: 0.25,
                checks: {
                    qcTesting:          { label: 'QC testing',            operationType: 'validation',     severity: 'critical' },
                    releaseCriteria:    { label: 'Release criteria',      operationType: 'documentChange', severity: 'major' },
                    oosInvestigations:  { label: 'OOS investigations',    operationType: 'documentChange', severity: 'critical' }
                }
            },
            gmpPersonnel: {
                weight: 0.20,
                checks: {
                    gmpTraining:       { label: 'GMP training',          operationType: 'training',       severity: 'major' },
                    hygieneCompliance: { label: 'Hygiene compliance',    operationType: 'cleaning',       severity: 'major' },
                    healthMonitoring:  { label: 'Health monitoring',     operationType: 'validation',     severity: 'minor' }
                }
            }
        }
    },
    'ISO-17025': {
        name: 'ISO 17025 Testing & Calibration',
        categories: {
            management: {
                weight: 0.25,
                checks: {
                    qualityPolicy:     { label: 'Quality policy',       operationType: 'documentChange', severity: 'major' },
                    documentControl:   { label: 'Document control',     operationType: 'documentChange', severity: 'major' },
                    correctiveActions: { label: 'Corrective actions',   operationType: 'documentChange', severity: 'critical' }
                }
            },
            technical: {
                weight: 0.30,
                checks: {
                    methodValidation:        { label: 'Method validation',         operationType: 'validation',     severity: 'critical' },
                    measurementUncertainty:  { label: 'Measurement uncertainty',   operationType: 'calibration',    severity: 'major' },
                    proficiencyTesting:      { label: 'Proficiency testing',       operationType: 'validation',     severity: 'major' }
                }
            },
            isoEquipment: {
                weight: 0.25,
                checks: {
                    calibrationTraceability: { label: 'Calibration traceability', operationType: 'calibration',    severity: 'critical' },
                    intermediateChecks:      { label: 'Intermediate checks',      operationType: 'calibration',    severity: 'minor' },
                    referenceStandards:      { label: 'Reference standards',      operationType: 'validation',     severity: 'major' }
                }
            },
            reporting: {
                weight: 0.20,
                checks: {
                    resultReporting:       { label: 'Result reporting',        operationType: 'dataEntry',      severity: 'major' },
                    uncertaintyStatements: { label: 'Uncertainty statements',  operationType: 'dataEntry',      severity: 'minor' },
                    opinions:              { label: 'Opinions & interpretations', operationType: 'documentChange', severity: 'observation' }
                }
            }
        }
    },
    'FDA-21CFR11': {
        name: 'FDA 21 CFR Part 11 Electronic Records',
        categories: {
            accessControl: {
                weight: 0.30,
                checks: {
                    uniqueIDs:     { label: 'Unique user IDs',   operationType: 'validation',     severity: 'critical' },
                    passwordPolicy: { label: 'Password policy',  operationType: 'validation',     severity: 'critical' },
                    accessLevels:  { label: 'Access levels',     operationType: 'documentChange', severity: 'major' }
                }
            },
            auditTrailReq: {
                weight: 0.30,
                checks: {
                    timestampedRecords: { label: 'Timestamped records',   operationType: 'dataEntry',      severity: 'critical' },
                    immutableLogs:      { label: 'Immutable logs',        operationType: 'validation',     severity: 'critical' },
                    reasonForChange:    { label: 'Reason for change',     operationType: 'documentChange', severity: 'major' }
                }
            },
            electronicSigs: {
                weight: 0.20,
                checks: {
                    signerAuth:      { label: 'Signer authentication',  operationType: 'validation',     severity: 'critical' },
                    signatureBinding: { label: 'Signature binding',     operationType: 'validation',     severity: 'major' },
                    nonRepudiation:  { label: 'Non-repudiation',        operationType: 'validation',     severity: 'major' }
                }
            },
            systemValidation: {
                weight: 0.20,
                checks: {
                    iqOqPq:         { label: 'IQ/OQ/PQ',              operationType: 'validation',     severity: 'critical' },
                    sysChangeControl: { label: 'System change control', operationType: 'documentChange', severity: 'major' },
                    periodicReview: { label: 'Periodic review',        operationType: 'validation',     severity: 'minor' }
                }
            }
        }
    },
    'EU-GMP-Annex11': {
        name: 'EU GMP Annex 11 Computerised Systems',
        categories: {
            annexValidation: {
                weight: 0.30,
                checks: {
                    riskBasedValidation:  { label: 'Risk-based validation',    operationType: 'validation',     severity: 'critical' },
                    specificationDocs:    { label: 'Specification documents',  operationType: 'documentChange', severity: 'major' },
                    annexTesting:         { label: 'Testing',                  operationType: 'validation',     severity: 'major' }
                }
            },
            annexData: {
                weight: 0.25,
                checks: {
                    annexDataIntegrity: { label: 'Data integrity',     operationType: 'dataEntry',      severity: 'critical' },
                    backupRestore:      { label: 'Backup/restore',     operationType: 'validation',     severity: 'major' },
                    annexArchival:      { label: 'Archival',           operationType: 'dataEntry',      severity: 'minor' }
                }
            },
            annexSecurity: {
                weight: 0.25,
                checks: {
                    annexAccessMgmt:     { label: 'Access management',      operationType: 'validation',     severity: 'critical' },
                    incidentHandling:    { label: 'Incident handling',      operationType: 'documentChange', severity: 'major' },
                    businessContinuity:  { label: 'Business continuity',    operationType: 'validation',     severity: 'major' }
                }
            },
            operational: {
                weight: 0.20,
                checks: {
                    opChangeManagement: { label: 'Change management',  operationType: 'documentChange', severity: 'major' },
                    opPeriodicReview:   { label: 'Periodic review',    operationType: 'validation',     severity: 'minor' },
                    supplierAssessment: { label: 'Supplier assessment', operationType: 'validation',    severity: 'minor' }
                }
            }
        }
    }
};

var FRAMEWORK_IDS = Object.keys(FRAMEWORKS);

// ── Remediation templates ──────────────────────────────────────────

var REMEDIATION_TEMPLATES = {
    calibration:    { action: 'Schedule and complete calibration',          effortHours: 4,  role: 'QA Technician' },
    training:       { action: 'Conduct required training session',         effortHours: 8,  role: 'Training Coordinator' },
    documentChange: { action: 'Update and approve documentation',          effortHours: 6,  role: 'Quality Manager' },
    maintenance:    { action: 'Perform equipment maintenance',             effortHours: 4,  role: 'Maintenance Engineer' },
    dataEntry:      { action: 'Establish data integrity procedures',       effortHours: 8,  role: 'Data Manager' },
    cleaning:       { action: 'Implement cleaning protocol',               effortHours: 2,  role: 'Lab Technician' },
    validation:     { action: 'Complete validation activities',            effortHours: 16, role: 'Validation Specialist' }
};

// ── Helpers ────────────────────────────────────────────────────────

function _now() { return Date.now(); }

function _classifyHealth(score) {
    for (var i = 0; i < HEALTH_LABELS.length; i++) {
        if (score >= HEALTH_LABELS[i].min) return HEALTH_LABELS[i];
    }
    return HEALTH_LABELS[HEALTH_LABELS.length - 1];
}

function _classifyRisk(score) {
    for (var i = 0; i < RISK_LEVELS.length; i++) {
        if (score >= RISK_LEVELS[i].min) return RISK_LEVELS[i];
    }
    return RISK_LEVELS[RISK_LEVELS.length - 1];
}

function _generateId(prefix) {
    return (prefix || 'ca') + '-' + _now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _severityToProbability(sev) {
    var map = { critical: 4, major: 3, minor: 2, observation: 1 };
    return map[sev] || 2;
}

function _severityToImpact(sev) {
    var map = { critical: 5, major: 3, minor: 2, observation: 1 };
    return map[sev] || 2;
}

// ── Factory ────────────────────────────────────────────────────────

function createComplianceAuditor() {
    var _enabledFrameworks = Object.create(null);
    var _operations = [];
    var _auditHistory = [];

    // ── Framework management ───────────────────────────────────

    function enableFramework(id) {
        if (!id || typeof id !== 'string') return { success: false, error: 'Framework id must be a non-empty string' };
        if (_isDangerousKey(id)) return { success: false, error: 'Invalid framework id' };
        if (!FRAMEWORKS[id]) return { success: false, error: 'Unknown framework: ' + id + '. Available: ' + FRAMEWORK_IDS.join(', ') };
        _enabledFrameworks[id] = true;
        return { success: true, framework: id };
    }

    function disableFramework(id) {
        if (!id || typeof id !== 'string') return { success: false, error: 'Framework id must be a non-empty string' };
        if (!FRAMEWORKS[id]) return { success: false, error: 'Unknown framework: ' + id };
        delete _enabledFrameworks[id];
        return { success: true, framework: id };
    }

    function listFrameworks() {
        var result = [];
        for (var i = 0; i < FRAMEWORK_IDS.length; i++) {
            var id = FRAMEWORK_IDS[i];
            var fw = FRAMEWORKS[id];
            var catCount = Object.keys(fw.categories).length;
            var checkCount = 0;
            var cats = Object.keys(fw.categories);
            for (var c = 0; c < cats.length; c++) {
                checkCount += Object.keys(fw.categories[cats[c]].checks).length;
            }
            result.push({
                id: id,
                name: fw.name,
                enabled: _enabledFrameworks[id] === true,
                categories: catCount,
                checks: checkCount
            });
        }
        return result;
    }

    function getFrameworkDetails(id) {
        if (!id || typeof id !== 'string') return { success: false, error: 'Framework id required' };
        if (!FRAMEWORKS[id]) return { success: false, error: 'Unknown framework: ' + id };
        var fw = FRAMEWORKS[id];
        var cats = Object.keys(fw.categories);
        var details = [];
        for (var c = 0; c < cats.length; c++) {
            var cat = fw.categories[cats[c]];
            var checks = Object.keys(cat.checks);
            var checkList = [];
            for (var k = 0; k < checks.length; k++) {
                var ch = cat.checks[checks[k]];
                checkList.push({ id: checks[k], label: ch.label, operationType: ch.operationType, severity: ch.severity });
            }
            details.push({ id: cats[c], weight: cat.weight, checks: checkList });
        }
        return { success: true, id: id, name: fw.name, enabled: _enabledFrameworks[id] === true, categories: details };
    }

    // ── Operation logging ──────────────────────────────────────

    function logOperation(opts) {
        if (!opts || typeof opts !== 'object') return { success: false, error: 'Options object required' };
        if (!opts.type || !OP_TYPE_SET[opts.type]) return { success: false, error: 'Invalid operation type. Valid: ' + OPERATION_TYPES.join(', ') };
        if (!opts.resource || typeof opts.resource !== 'string') return { success: false, error: 'resource must be a non-empty string' };
        if (_isDangerousKey(opts.resource)) return { success: false, error: 'Invalid resource name' };
        if (!opts.performedBy || typeof opts.performedBy !== 'string') return { success: false, error: 'performedBy must be a non-empty string' };
        if (_isDangerousKey(opts.performedBy)) return { success: false, error: 'Invalid performedBy value' };

        var op = {
            id: _generateId('op'),
            type: opts.type,
            resource: opts.resource,
            performedBy: opts.performedBy,
            timestamp: typeof opts.timestamp === 'number' && isFinite(opts.timestamp) ? opts.timestamp : _now(),
            details: opts.details && typeof opts.details === 'object' ? opts.details : {},
            evidence: Array.isArray(opts.evidence) ? opts.evidence.slice() : []
        };
        _operations.push(op);
        return { success: true, operationId: op.id };
    }

    function getOperations(opts) {
        var filtered = _operations.slice();
        if (opts && opts.type) {
            filtered = filtered.filter(function (o) { return o.type === opts.type; });
        }
        if (opts && opts.resource) {
            filtered = filtered.filter(function (o) { return o.resource === opts.resource; });
        }
        return filtered;
    }

    // ── Compliance checking ────────────────────────────────────

    function _evaluateCheck(check) {
        var matching = [];
        for (var i = 0; i < _operations.length; i++) {
            if (_operations[i].type === check.operationType) {
                matching.push(_operations[i]);
            }
        }
        if (matching.length === 0) return { status: 'FAIL', score: 0, evidence: [] };

        // Check for any pass results in details
        var passCount = 0;
        var evidence = [];
        for (var j = 0; j < matching.length; j++) {
            evidence = evidence.concat(matching[j].evidence);
            if (matching[j].details && matching[j].details.result === 'pass') {
                passCount++;
            } else {
                passCount += 0.5; // partial credit for logged but unconfirmed
            }
        }

        var ratio = passCount / matching.length;
        if (ratio >= 0.8) return { status: 'PASS', score: 100, evidence: evidence };
        if (ratio >= 0.4) return { status: 'PARTIAL', score: 50, evidence: evidence };
        return { status: 'FAIL', score: 0, evidence: evidence };
    }

    function runAudit(opts) {
        var targetFrameworks = [];
        if (opts && opts.framework) {
            if (!FRAMEWORKS[opts.framework]) return { success: false, error: 'Unknown framework: ' + opts.framework };
            if (!_enabledFrameworks[opts.framework]) return { success: false, error: 'Framework not enabled: ' + opts.framework };
            targetFrameworks.push(opts.framework);
        } else {
            var keys = Object.keys(_enabledFrameworks);
            for (var k = 0; k < keys.length; k++) {
                if (_enabledFrameworks[keys[k]]) targetFrameworks.push(keys[k]);
            }
        }

        if (targetFrameworks.length === 0) return { success: false, error: 'No frameworks enabled. Enable at least one framework first.' };

        var auditId = _generateId('audit');
        var timestamp = _now();
        var frameworkResults = [];
        var allGaps = [];
        var compositeWeightSum = 0;
        var compositeScoreSum = 0;

        for (var f = 0; f < targetFrameworks.length; f++) {
            var fwId = targetFrameworks[f];
            var fw = FRAMEWORKS[fwId];
            var cats = Object.keys(fw.categories);
            var categoryResults = [];
            var fwWeightSum = 0;
            var fwScoreSum = 0;

            for (var c = 0; c < cats.length; c++) {
                var cat = fw.categories[cats[c]];
                var checks = Object.keys(cat.checks);
                var checkResults = [];
                var catScoreSum = 0;

                for (var ch = 0; ch < checks.length; ch++) {
                    var checkDef = cat.checks[checks[ch]];
                    var evaluation = _evaluateCheck(checkDef);
                    checkResults.push({
                        id: checks[ch],
                        label: checkDef.label,
                        status: evaluation.status,
                        score: evaluation.score,
                        evidence: evaluation.evidence
                    });
                    catScoreSum += evaluation.score;

                    if (evaluation.status !== 'PASS') {
                        allGaps.push({
                            framework: fwId,
                            category: cats[c],
                            checkId: checks[ch],
                            label: checkDef.label,
                            status: evaluation.status,
                            severity: checkDef.severity,
                            operationType: checkDef.operationType
                        });
                    }
                }

                var catScore = checks.length > 0 ? round(catScoreSum / checks.length, 2) : 0;
                categoryResults.push({ id: cats[c], weight: cat.weight, score: catScore, checks: checkResults });
                fwWeightSum += cat.weight;
                fwScoreSum += cat.weight * catScore;
            }

            var fwScore = fwWeightSum > 0 ? round(fwScoreSum / fwWeightSum, 2) : 0;
            frameworkResults.push({ id: fwId, name: fw.name, score: fwScore, categories: categoryResults });
            compositeWeightSum += 1;
            compositeScoreSum += fwScore;
        }

        var compositeScore = compositeWeightSum > 0 ? round(compositeScoreSum / compositeWeightSum, 2) : 0;
        var health = _classifyHealth(compositeScore);

        var auditResult = {
            success: true,
            auditId: auditId,
            timestamp: timestamp,
            score: compositeScore,
            label: health.label,
            color: health.color,
            frameworkCount: targetFrameworks.length,
            gapCount: allGaps.length,
            frameworks: frameworkResults,
            gaps: allGaps
        };

        _auditHistory.push(auditResult);
        return auditResult;
    }

    function getComplianceScore() {
        if (_auditHistory.length === 0) return { success: false, error: 'No audits have been run. Call runAudit() first.' };
        var latest = _auditHistory[_auditHistory.length - 1];
        return { success: true, score: latest.score, label: latest.label, color: latest.color, auditId: latest.auditId };
    }

    // ── Risk assessment ────────────────────────────────────────

    function assessRisk() {
        if (_auditHistory.length === 0) return { success: false, error: 'No audits have been run. Call runAudit() first.' };
        var latest = _auditHistory[_auditHistory.length - 1];
        var risks = [];
        var totalRisk = 0;

        for (var i = 0; i < latest.gaps.length; i++) {
            var gap = latest.gaps[i];
            var probability = _severityToProbability(gap.severity);
            var impact = _severityToImpact(gap.severity);
            var riskScore = probability * impact;
            var riskLevel = _classifyRisk(riskScore);

            risks.push({
                framework: gap.framework,
                category: gap.category,
                checkId: gap.checkId,
                label: gap.label,
                severity: gap.severity,
                probability: probability,
                impact: impact,
                riskScore: riskScore,
                riskLevel: riskLevel.label,
                color: riskLevel.color
            });
            totalRisk += riskScore;
        }

        risks.sort(function (a, b) { return b.riskScore - a.riskScore; });

        var maxPossibleRisk = risks.length * 25;
        var riskExposure = maxPossibleRisk > 0 ? round((totalRisk / maxPossibleRisk) * 100, 2) : 0;

        return {
            success: true,
            totalRisk: totalRisk,
            riskExposure: riskExposure,
            gapCount: risks.length,
            criticalCount: risks.filter(function (r) { return r.riskLevel === 'critical'; }).length,
            highCount: risks.filter(function (r) { return r.riskLevel === 'high'; }).length,
            mediumCount: risks.filter(function (r) { return r.riskLevel === 'medium'; }).length,
            lowCount: risks.filter(function (r) { return r.riskLevel === 'low'; }).length,
            risks: risks
        };
    }

    // ── Remediation planning ───────────────────────────────────

    function getRemediationPlan() {
        if (_auditHistory.length === 0) return { success: false, error: 'No audits have been run. Call runAudit() first.' };
        var latest = _auditHistory[_auditHistory.length - 1];
        var actions = [];
        var priorityOrder = { critical: 0, major: 1, minor: 2, observation: 3 };

        for (var i = 0; i < latest.gaps.length; i++) {
            var gap = latest.gaps[i];
            var template = REMEDIATION_TEMPLATES[gap.operationType] || REMEDIATION_TEMPLATES.validation;
            var deadlineDays = gap.severity === 'critical' ? 7 : gap.severity === 'major' ? 30 : gap.severity === 'minor' ? 90 : 180;

            actions.push({
                framework: gap.framework,
                category: gap.category,
                checkId: gap.checkId,
                label: gap.label,
                severity: gap.severity,
                priority: typeof priorityOrder[gap.severity] === 'number' ? priorityOrder[gap.severity] : 3,
                action: template.action + ' for ' + gap.label,
                effortHours: template.effortHours,
                role: template.role,
                deadlineDays: deadlineDays
            });
        }

        actions.sort(function (a, b) { return a.priority - b.priority || b.effortHours - a.effortHours; });

        var totalEffort = 0;
        for (var j = 0; j < actions.length; j++) totalEffort += actions[j].effortHours;

        return {
            success: true,
            actionCount: actions.length,
            totalEffortHours: totalEffort,
            actions: actions
        };
    }

    // ── Report generation ──────────────────────────────────────

    function generateReport() {
        if (_auditHistory.length === 0) return { success: false, error: 'No audits have been run. Call runAudit() first.' };
        var latest = _auditHistory[_auditHistory.length - 1];
        var risk = assessRisk();
        var remediation = getRemediationPlan();

        var evidenceRefs = [];
        for (var f = 0; f < latest.frameworks.length; f++) {
            var fw = latest.frameworks[f];
            for (var c = 0; c < fw.categories.length; c++) {
                var cat = fw.categories[c];
                for (var ch = 0; ch < cat.checks.length; ch++) {
                    var check = cat.checks[ch];
                    if (check.evidence && check.evidence.length > 0) {
                        for (var e = 0; e < check.evidence.length; e++) {
                            if (evidenceRefs.indexOf(check.evidence[e]) === -1) {
                                evidenceRefs.push(check.evidence[e]);
                            }
                        }
                    }
                }
            }
        }

        return {
            success: true,
            auditId: latest.auditId,
            timestamp: latest.timestamp,
            executiveSummary: {
                score: latest.score,
                label: latest.label,
                frameworkCount: latest.frameworkCount,
                gapCount: latest.gapCount,
                riskExposure: risk.riskExposure,
                criticalGaps: risk.criticalCount
            },
            frameworks: latest.frameworks,
            riskAssessment: risk,
            remediationPlan: remediation,
            evidenceReferences: evidenceRefs,
            auditHistoryCount: _auditHistory.length
        };
    }

    // ── Insight generation ─────────────────────────────────────

    function _generateInsights() {
        var insights = [];
        if (_auditHistory.length === 0) return insights;

        var latest = _auditHistory[_auditHistory.length - 1];

        // 1. Recurring non-conformances
        if (_auditHistory.length >= 2) {
            var prev = _auditHistory[_auditHistory.length - 2];
            var prevGapIds = Object.create(null);
            for (var pg = 0; pg < prev.gaps.length; pg++) {
                prevGapIds[prev.gaps[pg].checkId] = true;
            }
            var recurring = [];
            for (var cg = 0; cg < latest.gaps.length; cg++) {
                if (prevGapIds[latest.gaps[cg].checkId]) recurring.push(latest.gaps[cg].label);
            }
            if (recurring.length > 0) {
                insights.push({
                    type: 'recurring_non_conformance',
                    severity: 'high',
                    message: recurring.length + ' recurring non-conformance(s) detected across audits: ' + recurring.slice(0, 3).join(', ') + (recurring.length > 3 ? ' and ' + (recurring.length - 3) + ' more' : '')
                });
            }
        }

        // 2. Compliance trend
        if (_auditHistory.length >= 2) {
            var prevScore = _auditHistory[_auditHistory.length - 2].score;
            var currScore = latest.score;
            var delta = round(currScore - prevScore, 2);
            if (delta > 5) {
                insights.push({ type: 'compliance_trend', severity: 'info', message: 'Compliance improving: score increased by ' + delta + ' points since last audit' });
            } else if (delta < -5) {
                insights.push({ type: 'compliance_trend', severity: 'warning', message: 'Compliance declining: score decreased by ' + Math.abs(delta) + ' points since last audit' });
            }
        }

        // 3. High-risk concentration
        var catGaps = Object.create(null);
        for (var g = 0; g < latest.gaps.length; g++) {
            var key = latest.gaps[g].framework + '/' + latest.gaps[g].category;
            if (!catGaps[key]) catGaps[key] = { count: 0, critical: 0 };
            catGaps[key].count++;
            if (latest.gaps[g].severity === 'critical') catGaps[key].critical++;
        }
        var catKeys = Object.keys(catGaps);
        for (var ck = 0; ck < catKeys.length; ck++) {
            if (catGaps[catKeys[ck]].critical >= 2) {
                insights.push({
                    type: 'high_risk_concentration',
                    severity: 'critical',
                    message: 'High-risk concentration in ' + catKeys[ck] + ': ' + catGaps[catKeys[ck]].critical + ' critical gaps detected'
                });
            }
        }

        // 4. Cross-framework synergy
        var opTypeGaps = Object.create(null);
        for (var sg = 0; sg < latest.gaps.length; sg++) {
            var ot = latest.gaps[sg].operationType;
            if (!opTypeGaps[ot]) opTypeGaps[ot] = [];
            opTypeGaps[ot].push(latest.gaps[sg].framework);
        }
        var otKeys = Object.keys(opTypeGaps);
        for (var ok = 0; ok < otKeys.length; ok++) {
            var uniqueFws = [];
            for (var uf = 0; uf < opTypeGaps[otKeys[ok]].length; uf++) {
                if (uniqueFws.indexOf(opTypeGaps[otKeys[ok]][uf]) === -1) uniqueFws.push(opTypeGaps[otKeys[ok]][uf]);
            }
            if (uniqueFws.length >= 2) {
                insights.push({
                    type: 'cross_framework_synergy',
                    severity: 'info',
                    message: 'Addressing ' + otKeys[ok] + ' gaps would improve compliance across ' + uniqueFws.length + ' frameworks: ' + uniqueFws.join(', ')
                });
            }
        }

        // 5. No operations warning
        if (_operations.length === 0) {
            insights.push({
                type: 'no_operations',
                severity: 'warning',
                message: 'No operations logged. Log lab activities to get meaningful compliance assessments.'
            });
        }

        return insights;
    }

    // ── Dashboard ──────────────────────────────────────────────

    function getDashboard() {
        var latest = _auditHistory.length > 0 ? _auditHistory[_auditHistory.length - 1] : null;
        var score = latest ? latest.score : 0;
        var health = _classifyHealth(score);
        var risk = _auditHistory.length > 0 ? assessRisk() : null;
        var remediation = _auditHistory.length > 0 ? getRemediationPlan() : null;
        var insights = _generateInsights();

        var enabledList = [];
        var eKeys = Object.keys(_enabledFrameworks);
        for (var e = 0; e < eKeys.length; e++) {
            if (_enabledFrameworks[eKeys[e]]) enabledList.push(eKeys[e]);
        }

        return {
            complianceScore: score,
            healthLabel: health.label,
            healthColor: health.color,
            enabledFrameworks: enabledList,
            operationCount: _operations.length,
            auditCount: _auditHistory.length,
            latestAudit: latest ? { auditId: latest.auditId, timestamp: latest.timestamp, gapCount: latest.gapCount } : null,
            riskSummary: risk ? { totalRisk: risk.totalRisk, riskExposure: risk.riskExposure, criticalCount: risk.criticalCount } : null,
            remediationSummary: remediation ? { actionCount: remediation.actionCount, totalEffortHours: remediation.totalEffortHours } : null,
            insights: insights
        };
    }

    // ── Reset ──────────────────────────────────────────────────

    function reset() {
        _operations.length = 0;
        _auditHistory.length = 0;
        var keys = Object.keys(_enabledFrameworks);
        for (var i = 0; i < keys.length; i++) delete _enabledFrameworks[keys[i]];
        return { success: true };
    }

    return {
        enableFramework: enableFramework,
        disableFramework: disableFramework,
        listFrameworks: listFrameworks,
        getFrameworkDetails: getFrameworkDetails,
        logOperation: logOperation,
        getOperations: getOperations,
        runAudit: runAudit,
        getComplianceScore: getComplianceScore,
        assessRisk: assessRisk,
        getRemediationPlan: getRemediationPlan,
        generateReport: generateReport,
        getDashboard: getDashboard,
        reset: reset
    };
}

exports.createComplianceAuditor = createComplianceAuditor;
