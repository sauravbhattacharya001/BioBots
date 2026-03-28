/**
 * Lab Safety Checklist
 *
 * Manages safety checklists for bioprinting lab areas. Tracks PPE
 * compliance, chemical/biological hazards, equipment safety checks,
 * emergency readiness, and generates audit-ready safety reports.
 *
 * Lab safety is non-negotiable in bioprinting — workers handle
 * biohazardous materials, UV sources, heated print heads, and
 * pressurised systems daily. This module helps labs maintain and
 * verify compliance with standard safety protocols.
 *
 * @example
 *   var safety = require('./labSafetyChecklist');
 *   var mgr = safety.createLabSafetyChecklist();
 *   var result = mgr.createChecklist({
 *     area: 'Cell Culture Room',
 *     inspector: 'J. Smith',
 *     items: [
 *       { category: 'ppe', item: 'Lab coat worn', checked: true },
 *       { category: 'ppe', item: 'Safety goggles', checked: true },
 *       { category: 'fire', item: 'Extinguisher accessible', checked: true }
 *     ]
 *   });
 */

'use strict';

/* ------------------------------------------------------------------ */
/*  PPE Requirements by Hazard Level                                   */
/* ------------------------------------------------------------------ */

var PPE_REQUIREMENTS = {
    bsl1: {
        level: 'BSL-1',
        required: ['lab coat', 'gloves', 'safety glasses'],
        recommended: ['closed-toe shoes'],
        description: 'Basic — no known disease agents'
    },
    bsl2: {
        level: 'BSL-2',
        required: ['lab coat', 'gloves', 'safety glasses', 'face shield'],
        recommended: ['shoe covers', 'sleeve protectors'],
        description: 'Moderate risk — agents causing human disease'
    },
    chemical: {
        level: 'Chemical Handling',
        required: ['lab coat', 'chemical-resistant gloves', 'splash goggles', 'fume hood use'],
        recommended: ['apron', 'face shield'],
        description: 'Chemical hazard areas'
    },
    uv: {
        level: 'UV Exposure',
        required: ['UV-blocking goggles', 'lab coat', 'gloves'],
        recommended: ['face shield', 'long sleeves'],
        description: 'UV crosslinking or sterilisation stations'
    },
    thermal: {
        level: 'Thermal Hazard',
        required: ['heat-resistant gloves', 'lab coat', 'safety glasses'],
        recommended: ['face shield', 'apron'],
        description: 'Autoclaves, heated print beds, ovens'
    }
};

/* ------------------------------------------------------------------ */
/*  Standard Checklist Templates                                       */
/* ------------------------------------------------------------------ */

var CHECKLIST_TEMPLATES = {
    daily: {
        name: 'Daily Safety Check',
        frequency: 'daily',
        items: [
            { category: 'ppe', item: 'Appropriate PPE available and worn', critical: true },
            { category: 'waste', item: 'Biohazard waste containers < 75% full', critical: true },
            { category: 'waste', item: 'Sharps containers < 75% full', critical: true },
            { category: 'equipment', item: 'BSC certified and operational', critical: true },
            { category: 'general', item: 'Bench surfaces clean and disinfected', critical: false },
            { category: 'general', item: 'No food or drink in lab area', critical: true },
            { category: 'emergency', item: 'Emergency exits unobstructed', critical: true },
            { category: 'chemical', item: 'Chemical containers properly labelled', critical: true }
        ]
    },
    weekly: {
        name: 'Weekly Safety Inspection',
        frequency: 'weekly',
        items: [
            { category: 'emergency', item: 'Eye wash station tested (15-min flush)', critical: true },
            { category: 'emergency', item: 'Safety shower accessible', critical: true },
            { category: 'emergency', item: 'First aid kit stocked', critical: false },
            { category: 'emergency', item: 'Fire extinguisher inspection tag current', critical: true },
            { category: 'chemical', item: 'SDS binder up to date', critical: true },
            { category: 'chemical', item: 'Flammable storage within limits', critical: true },
            { category: 'equipment', item: 'Fume hood face velocity checked', critical: true },
            { category: 'waste', item: 'Waste pickup schedule on track', critical: false },
            { category: 'general', item: 'Spill kit supplies complete', critical: true },
            { category: 'general', item: 'Lab access log reviewed', critical: false }
        ]
    },
    monthly: {
        name: 'Monthly Safety Audit',
        frequency: 'monthly',
        items: [
            { category: 'training', item: 'All personnel training records current', critical: true },
            { category: 'training', item: 'New personnel orientation completed', critical: true },
            { category: 'equipment', item: 'Autoclave validation current', critical: true },
            { category: 'equipment', item: 'Incubator calibration verified', critical: true },
            { category: 'equipment', item: 'Centrifuge rotor inspection', critical: false },
            { category: 'chemical', item: 'Chemical inventory reconciled', critical: true },
            { category: 'chemical', item: 'Expired chemicals removed', critical: true },
            { category: 'emergency', item: 'Emergency contact list updated', critical: true },
            { category: 'emergency', item: 'Evacuation drill conducted (quarterly)', critical: false },
            { category: 'general', item: 'Ventilation system inspection', critical: true },
            { category: 'general', item: 'Signage (biohazard, radiation, laser) correct', critical: false },
            { category: 'waste', item: 'Waste manifests filed correctly', critical: true }
        ]
    }
};

/* ------------------------------------------------------------------ */
/*  Severity / Risk levels                                             */
/* ------------------------------------------------------------------ */

var RISK_LEVELS = {
    low:      { label: 'Low',      score: 1, action: 'Monitor — address within 30 days' },
    moderate: { label: 'Moderate', score: 2, action: 'Correct within 7 days' },
    high:     { label: 'High',     score: 3, action: 'Correct within 24 hours' },
    critical: { label: 'Critical', score: 4, action: 'Stop work — correct immediately' }
};

/* ------------------------------------------------------------------ */
/*  Helper utilities                                                   */
/* ------------------------------------------------------------------ */

function generateId() {
    return 'SC-' + Date.now().toString(36).toUpperCase() + '-' +
           Math.random().toString(36).substring(2, 6).toUpperCase();
}

function isoNow() {
    return new Date().toISOString();
}

function cloneDeep(obj) {
    return JSON.parse(JSON.stringify(obj));
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

function createLabSafetyChecklist() {
    var checklists = [];
    var findings = [];
    var areas = {};

    /* ---- Area registration ---- */

    function registerArea(opts) {
        if (!opts || !opts.name) {
            return { success: false, error: 'Area name is required' };
        }
        var area = {
            name: opts.name,
            hazardLevel: opts.hazardLevel || 'bsl1',
            ppeProfile: PPE_REQUIREMENTS[opts.hazardLevel || 'bsl1'] || PPE_REQUIREMENTS.bsl1,
            responsible: opts.responsible || 'Unassigned',
            registeredAt: isoNow()
        };
        areas[opts.name] = area;
        return { success: true, area: area };
    }

    /* ---- Checklist creation ---- */

    function createChecklist(opts) {
        if (!opts || !opts.area) {
            return { success: false, error: 'Area is required' };
        }
        if (!opts.inspector) {
            return { success: false, error: 'Inspector name is required' };
        }
        if (!opts.items || !Array.isArray(opts.items) || opts.items.length === 0) {
            return { success: false, error: 'At least one checklist item is required' };
        }

        var id = generateId();
        var totalItems = opts.items.length;
        var checkedItems = 0;
        var criticalFails = [];

        var processedItems = opts.items.map(function (it) {
            var checked = !!it.checked;
            if (checked) { checkedItems++; }
            var isCritical = it.critical !== undefined ? it.critical : false;
            if (!checked && isCritical) {
                criticalFails.push(it.item);
            }
            return {
                category: it.category || 'general',
                item: it.item || 'Unnamed item',
                checked: checked,
                critical: isCritical,
                notes: it.notes || ''
            };
        });

        var score = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0;
        var status;
        if (criticalFails.length > 0) {
            status = 'FAIL';
        } else if (score >= 90) {
            status = 'PASS';
        } else if (score >= 70) {
            status = 'CONDITIONAL';
        } else {
            status = 'FAIL';
        }

        var record = {
            id: id,
            area: opts.area,
            inspector: opts.inspector,
            date: isoNow(),
            template: opts.template || 'custom',
            items: processedItems,
            summary: {
                total: totalItems,
                passed: checkedItems,
                failed: totalItems - checkedItems,
                score: score,
                status: status,
                criticalFailures: criticalFails
            }
        };

        checklists.push(record);
        return { success: true, checklist: record };
    }

    /* ---- Template-based checklist generation ---- */

    function generateFromTemplate(templateName, area, inspector) {
        var tpl = CHECKLIST_TEMPLATES[templateName];
        if (!tpl) {
            return { success: false, error: 'Unknown template: ' + templateName + '. Available: ' + Object.keys(CHECKLIST_TEMPLATES).join(', ') };
        }
        var items = cloneDeep(tpl.items).map(function (it) {
            it.checked = false;
            return it;
        });
        return createChecklist({
            area: area || 'Unspecified',
            inspector: inspector || 'Unspecified',
            template: templateName,
            items: items
        });
    }

    /* ---- Finding / incident reporting ---- */

    function reportFinding(opts) {
        if (!opts || !opts.area) {
            return { success: false, error: 'Area is required' };
        }
        if (!opts.description) {
            return { success: false, error: 'Description is required' };
        }

        var risk = RISK_LEVELS[opts.risk || 'moderate'] || RISK_LEVELS.moderate;
        var finding = {
            id: 'SF-' + Date.now().toString(36).toUpperCase(),
            area: opts.area,
            category: opts.category || 'general',
            description: opts.description,
            risk: risk,
            reporter: opts.reporter || 'Anonymous',
            reportedAt: isoNow(),
            status: 'open',
            correctedAt: null,
            correctedBy: null,
            correctiveAction: null
        };
        findings.push(finding);
        return { success: true, finding: finding };
    }

    /* ---- Resolve a finding ---- */

    function resolveFinding(findingId, resolution) {
        var found = null;
        for (var i = 0; i < findings.length; i++) {
            if (findings[i].id === findingId) {
                found = findings[i];
                break;
            }
        }
        if (!found) {
            return { success: false, error: 'Finding not found: ' + findingId };
        }
        if (found.status === 'closed') {
            return { success: false, error: 'Finding already closed' };
        }
        found.status = 'closed';
        found.correctedAt = isoNow();
        found.correctedBy = (resolution && resolution.correctedBy) || 'Unknown';
        found.correctiveAction = (resolution && resolution.action) || 'Corrected';
        return { success: true, finding: found };
    }

    /* ---- PPE compliance check ---- */

    function checkPpeCompliance(hazardLevel, wornPpe) {
        var profile = PPE_REQUIREMENTS[hazardLevel];
        if (!profile) {
            return { success: false, error: 'Unknown hazard level: ' + hazardLevel };
        }
        if (!Array.isArray(wornPpe)) {
            return { success: false, error: 'wornPpe must be an array of PPE items' };
        }

        var wornLower = wornPpe.map(function (p) { return p.toLowerCase().trim(); });
        var missing = [];
        var present = [];

        profile.required.forEach(function (req) {
            var reqLower = req.toLowerCase();
            var found = wornLower.some(function (w) {
                return w.indexOf(reqLower) !== -1 || reqLower.indexOf(w) !== -1;
            });
            if (found) {
                present.push(req);
            } else {
                missing.push(req);
            }
        });

        var missingRecommended = [];
        (profile.recommended || []).forEach(function (rec) {
            var recLower = rec.toLowerCase();
            var found = wornLower.some(function (w) {
                return w.indexOf(recLower) !== -1 || recLower.indexOf(w) !== -1;
            });
            if (!found) {
                missingRecommended.push(rec);
            }
        });

        return {
            success: true,
            compliant: missing.length === 0,
            hazardLevel: profile.level,
            required: profile.required.length,
            present: present,
            missing: missing,
            missingRecommended: missingRecommended,
            message: missing.length === 0
                ? 'PPE compliant for ' + profile.level
                : 'NON-COMPLIANT: Missing ' + missing.join(', ')
        };
    }

    /* ---- Safety score for an area ---- */

    function getAreaSafetyScore(areaName) {
        var areaChecklists = checklists.filter(function (c) { return c.area === areaName; });
        var areaFindings = findings.filter(function (f) { return f.area === areaName; });
        var openFindings = areaFindings.filter(function (f) { return f.status === 'open'; });

        if (areaChecklists.length === 0) {
            return {
                success: true,
                area: areaName,
                score: null,
                message: 'No checklists completed for this area yet'
            };
        }

        // Average checklist score
        var avgScore = 0;
        areaChecklists.forEach(function (c) { avgScore += c.summary.score; });
        avgScore = Math.round(avgScore / areaChecklists.length);

        // Penalty for open critical findings
        var criticalOpen = openFindings.filter(function (f) { return f.risk.score >= 3; });
        var penalty = criticalOpen.length * 10;
        var finalScore = Math.max(0, avgScore - penalty);

        var grade;
        if (finalScore >= 95) { grade = 'A'; }
        else if (finalScore >= 85) { grade = 'B'; }
        else if (finalScore >= 70) { grade = 'C'; }
        else if (finalScore >= 50) { grade = 'D'; }
        else { grade = 'F'; }

        return {
            success: true,
            area: areaName,
            checklistCount: areaChecklists.length,
            averageChecklistScore: avgScore,
            openFindings: openFindings.length,
            criticalOpenFindings: criticalOpen.length,
            penalty: penalty,
            finalScore: finalScore,
            grade: grade
        };
    }

    /* ---- Generate audit report ---- */

    function generateAuditReport() {
        var areaNames = Object.keys(areas);
        var allAreaScores = areaNames.map(function (name) {
            return getAreaSafetyScore(name);
        });

        var openFindings = findings.filter(function (f) { return f.status === 'open'; });
        var criticalOpen = openFindings.filter(function (f) { return f.risk.score >= 4; });
        var highOpen = openFindings.filter(function (f) { return f.risk.score === 3; });

        var overallScore = 0;
        var scoredAreas = allAreaScores.filter(function (a) { return a.score !== null; });
        if (scoredAreas.length > 0) {
            scoredAreas.forEach(function (a) { overallScore += a.finalScore; });
            overallScore = Math.round(overallScore / scoredAreas.length);
        }

        return {
            success: true,
            report: {
                generatedAt: isoNow(),
                registeredAreas: areaNames.length,
                totalChecklists: checklists.length,
                totalFindings: findings.length,
                openFindings: openFindings.length,
                criticalOpenFindings: criticalOpen.length,
                highOpenFindings: highOpen.length,
                overallScore: scoredAreas.length > 0 ? overallScore : null,
                areaBreakdown: allAreaScores,
                recentChecklists: checklists.slice(-5).reverse(),
                urgentFindings: criticalOpen.concat(highOpen)
            }
        };
    }

    /* ---- List available templates ---- */

    function listTemplates() {
        return {
            success: true,
            templates: Object.keys(CHECKLIST_TEMPLATES).map(function (key) {
                var t = CHECKLIST_TEMPLATES[key];
                return {
                    name: key,
                    displayName: t.name,
                    frequency: t.frequency,
                    itemCount: t.items.length,
                    categories: t.items.reduce(function (acc, it) {
                        if (acc.indexOf(it.category) === -1) { acc.push(it.category); }
                        return acc;
                    }, [])
                };
            })
        };
    }

    /* ---- List PPE profiles ---- */

    function listPpeProfiles() {
        return {
            success: true,
            profiles: Object.keys(PPE_REQUIREMENTS).map(function (key) {
                var p = PPE_REQUIREMENTS[key];
                return {
                    key: key,
                    level: p.level,
                    required: p.required,
                    recommended: p.recommended,
                    description: p.description
                };
            })
        };
    }

    /* ---- Public API ---- */

    return {
        registerArea: registerArea,
        createChecklist: createChecklist,
        generateFromTemplate: generateFromTemplate,
        reportFinding: reportFinding,
        resolveFinding: resolveFinding,
        checkPpeCompliance: checkPpeCompliance,
        getAreaSafetyScore: getAreaSafetyScore,
        generateAuditReport: generateAuditReport,
        listTemplates: listTemplates,
        listPpeProfiles: listPpeProfiles
    };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

module.exports = { createLabSafetyChecklist: createLabSafetyChecklist };
