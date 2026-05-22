'use strict';

/**
 * Cell Harvest Window Advisor — agentic per-vessel harvest-window planner.
 *
 * Sibling to cellBankVialAdvisor (bank-side), batchQueuePrioritizationAdvisor
 * (queue-side), equipmentDowntimeRiskAdvisor, shiftHandoffSynthesizer,
 * perishableWasteForecaster, reagentSubstitutionAdvisor.
 *
 * Given a roster of active culture vessels (with confluency, viability,
 * passage info, growth history, and a downstream experimentTarget) plus
 * optional equipment availability, emits per-vessel verdicts
 * (HARVEST_NOW / HARVEST_TODAY / HARVEST_TOMORROW / WAIT /
 * OVERGROWN_DISCARD / UNHEALTHY_RESCUE / PASSAGE_LIMIT_REACHED /
 * INSUFFICIENT_DATA), priorityScore 0-100, P0-P3 bucket, projected
 * harvest window ISO, structured reasons, a deduped P0-first
 * cross-fleet playbook with owner/blast/reversibility, always-on
 * insight codes, an A-F grade, and text / markdown / JSON renderers
 * (formatJson is byte-stable via sorted-keys recursion).
 *
 * Pure CommonJS, zero deps, deterministic given an injected now(),
 * never mutates inputs.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var advisor = biobots.createCellHarvestWindowAdvisor({
 *       now: function () { return new Date('2026-05-22T09:00:00Z'); }
 *   });
 *   var report = advisor.recommend({
 *       vessels: [{
 *           id: 'V1', cellLine: 'HEK293', seededAt: '2026-05-18T09:00:00Z',
 *           confluencyPct: 88, viabilityPct: 95,
 *           experimentTarget: 'assay'
 *       }]
 *   });
 *   console.log(advisor.formatMarkdown(report));
 */

var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

var VERDICTS = {
    HARVEST_NOW: 'HARVEST_NOW',
    HARVEST_TODAY: 'HARVEST_TODAY',
    HARVEST_TOMORROW: 'HARVEST_TOMORROW',
    WAIT: 'WAIT',
    OVERGROWN_DISCARD: 'OVERGROWN_DISCARD',
    UNHEALTHY_RESCUE: 'UNHEALTHY_RESCUE',
    PASSAGE_LIMIT_REACHED: 'PASSAGE_LIMIT_REACHED',
    INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
};

var APPETITE_MULT = { cautious: 1.15, balanced: 1.0, aggressive: 0.85 };

var DEFAULT_TARGETS = {
    expansion: 80,
    freeze: 85,
    assay: 80,
    print: 90,
    transfection: 70,
    discard: 100,
};
var DEFAULT_TARGET_FALLBACK = 80;

// ── helpers ─────────────────────────────────────────────────────

function _isFiniteNum(n) { return typeof n === 'number' && isFinite(n); }
function _num(n, d) { return _isFiniteNum(n) ? n : (d === undefined ? 0 : d); }
function _str(s) { return typeof s === 'string' ? s : ''; }
function _bool(b) { return b === true; }
function _arr(a) { return Array.isArray(a) ? a : []; }
function _obj(o) { return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; }
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _parseIso(s) {
    if (!s || typeof s !== 'string') return null;
    var t = Date.parse(s);
    return isFinite(t) ? new Date(t) : null;
}

function _isoOrNull(d) {
    return (d && d instanceof Date && isFinite(d.getTime())) ? d.toISOString() : null;
}

function _resolveAppetite(opts) {
    var ra = _str((opts || {}).risk_appetite).toLowerCase();
    if (ra === 'cautious' || ra === 'aggressive') return ra;
    return 'balanced';
}

function _normalizeHistoryPoint(p) {
    var o = _obj(p);
    var ts = _parseIso(o.ts);
    return {
        ts: ts,
        tsMs: ts ? ts.getTime() : null,
        densityCellsPerCm2: _isFiniteNum(o.densityCellsPerCm2) ? o.densityCellsPerCm2 : null,
        confluencyPct: _isFiniteNum(o.confluencyPct) ? o.confluencyPct : null,
    };
}

function _normalizeVessel(raw) {
    var r = _obj(raw);
    var history = _arr(r.growthHistory).map(_normalizeHistoryPoint)
        .filter(function (p) { return p.tsMs != null; })
        .sort(function (a, b) { return a.tsMs - b.tsMs; });
    var experimentTarget = _str(r.experimentTarget).toLowerCase();
    if (!(experimentTarget in DEFAULT_TARGETS)) experimentTarget = '';
    var targetConfluencyPct = _isFiniteNum(r.targetConfluencyPct)
        ? _clamp(r.targetConfluencyPct, 1, 100)
        : (experimentTarget ? DEFAULT_TARGETS[experimentTarget] : DEFAULT_TARGET_FALLBACK);
    return {
        id: _str(r.id),
        cellLine: _str(r.cellLine) || '(unknown)',
        vesselType: _str(r.vesselType) || '',
        seededAt: _str(r.seededAt),
        seedDensityCellsPerCm2: _isFiniteNum(r.seedDensityCellsPerCm2) ? r.seedDensityCellsPerCm2 : null,
        currentDensityCellsPerCm2: _isFiniteNum(r.currentDensityCellsPerCm2) ? r.currentDensityCellsPerCm2 : null,
        confluencyPct: _isFiniteNum(r.confluencyPct) ? r.confluencyPct : null,
        viabilityPct: _isFiniteNum(r.viabilityPct) ? r.viabilityPct : null,
        growthHistory: history,
        experimentTarget: experimentTarget,
        targetConfluencyPct: targetConfluencyPct,
        passageNumber: _isFiniteNum(r.passageNumber) ? r.passageNumber : null,
        maxPassage: _isFiniteNum(r.maxPassage) ? r.maxPassage : null,
        contaminationFlag: _bool(r.contaminationFlag),
        notes: _str(r.notes),
    };
}

function _normalizeEquipment(raw) {
    var e = _obj(raw);
    return {
        centrifuge: _str(e.centrifuge),
        biosafetyCabinet: _str(e.biosafetyCabinet),
    };
}

// Derive the most-recent observable confluency by preferring explicit
// confluencyPct, then the last growthHistory point, then a linear
// estimate from currentDensity vs seedDensity (treating seed as 5%).
function _deriveCurrentConfluency(v) {
    if (v.confluencyPct != null) return _clamp(v.confluencyPct, 0, 200);
    if (v.growthHistory.length) {
        var last = v.growthHistory[v.growthHistory.length - 1];
        if (last.confluencyPct != null) return _clamp(last.confluencyPct, 0, 200);
    }
    if (v.currentDensityCellsPerCm2 != null && v.seedDensityCellsPerCm2 != null && v.seedDensityCellsPerCm2 > 0) {
        var ratio = v.currentDensityCellsPerCm2 / v.seedDensityCellsPerCm2;
        // assume seed = 5% confluency; scale linearly; cap at 200
        return _clamp(5 * ratio, 0, 200);
    }
    return null;
}

// Returns { hoursToTarget, projectedISO } or null if cannot project.
function _projectToTarget(v, currentConfluency, nowDate) {
    if (currentConfluency == null) return null;
    var target = v.targetConfluencyPct;
    if (currentConfluency >= target) return { hoursToTarget: 0, projectedISO: nowDate.toISOString() };

    // Need at least 2 timestamped confluency points to compute slope.
    var pts = v.growthHistory.filter(function (p) { return p.confluencyPct != null; });
    // If history doesn't include the latest, synthesize a now-point from confluencyPct.
    if (v.confluencyPct != null) {
        pts = pts.concat([{ tsMs: nowDate.getTime(), confluencyPct: v.confluencyPct }]);
    }
    if (pts.length < 2) {
        // Try density-based projection if we have seed + current density + seededAt.
        if (v.seededAt && v.seedDensityCellsPerCm2 && v.currentDensityCellsPerCm2 && v.currentDensityCellsPerCm2 > v.seedDensityCellsPerCm2) {
            var seedT = _parseIso(v.seededAt);
            if (seedT) {
                var hours = (nowDate.getTime() - seedT.getTime()) / 3600000;
                if (hours > 0) {
                    // exponential: density(t) = seed * exp(k*t). solve for time to target confluency.
                    var k = Math.log(v.currentDensityCellsPerCm2 / v.seedDensityCellsPerCm2) / hours;
                    if (k > 0) {
                        // approximate target density: target% / 5% * seedDensity (same assumption as derive)
                        var targetDensity = (target / 5) * v.seedDensityCellsPerCm2;
                        var totalHours = Math.log(targetDensity / v.seedDensityCellsPerCm2) / k;
                        var remain = totalHours - hours;
                        if (remain > 0 && remain < 24 * 14) {
                            return {
                                hoursToTarget: remain,
                                projectedISO: new Date(nowDate.getTime() + remain * 3600000).toISOString(),
                            };
                        }
                    }
                }
            }
        }
        return null;
    }

    // Sort by ts and take last 2 points for slope.
    pts.sort(function (a, b) { return a.tsMs - b.tsMs; });
    var p1 = pts[pts.length - 2];
    var p2 = pts[pts.length - 1];
    var dt = (p2.tsMs - p1.tsMs) / 3600000;
    if (dt <= 0) return null;
    var slope = (p2.confluencyPct - p1.confluencyPct) / dt; // %/hour
    if (slope <= 0) return null;
    var remainPct = target - p2.confluencyPct;
    var remainHours = remainPct / slope;
    if (remainHours < 0) remainHours = 0;
    if (remainHours > 24 * 14) return null;
    // Anchor projection from nowDate (or p2 if p2 is in the future, unusual).
    var anchorMs = Math.max(nowDate.getTime(), p2.tsMs);
    return {
        hoursToTarget: remainHours,
        projectedISO: new Date(anchorMs + remainHours * 3600000).toISOString(),
    };
}

// Detect a confluency drop > threshold between last 2 history points.
function _confluencyDrop(v) {
    var pts = v.growthHistory.filter(function (p) { return p.confluencyPct != null; });
    if (pts.length < 2) return 0;
    var a = pts[pts.length - 2].confluencyPct;
    var b = pts[pts.length - 1].confluencyPct;
    return a - b; // positive == drop
}

// ── core ────────────────────────────────────────────────────────

/**
 * Build a new CellHarvestWindowAdvisor.
 *
 * @param {Object} [config]
 * @param {Function} [config.now] - Override clock; defaults to `new Date()`.
 * @returns {{
 *   recommend: function(Object, Object=): Object,
 *   simulate: function(Object, Object=): Object,
 *   formatText: function(Object): string,
 *   formatMarkdown: function(Object): string,
 *   formatJson: function(Object): string,
 *   VERDICTS: Object
 * }}
 */
function createCellHarvestWindowAdvisor(config) {
    config = _obj(config);
    var now = typeof config.now === 'function' ? config.now : function () { return new Date(); };

    function recommend(input, options) {
        var nowDate = now();
        if (!(nowDate instanceof Date) || !isFinite(nowDate.getTime())) nowDate = new Date();
        var appetite = _resolveAppetite(options);
        var mult = APPETITE_MULT[appetite];

        var vesselsIn = _arr((input || {}).vessels);
        var equipment = _normalizeEquipment((input || {}).equipmentAvailability);
        var vessels = vesselsIn.map(_normalizeVessel);

        var assessments = vessels.map(function (v) {
            return _assessVessel(v, equipment, nowDate, mult);
        });

        // Order by priority asc, score desc, id asc
        var order = assessments.slice().sort(function (a, x) {
            var pa = PRIORITY_RANK[a.priority] - PRIORITY_RANK[x.priority];
            if (pa !== 0) return pa;
            if (x.priorityScore !== a.priorityScore) return x.priorityScore - a.priorityScore;
            return a.id < x.id ? -1 : a.id > x.id ? 1 : 0;
        });

        var portfolio = _summarize(assessments, appetite);
        var playbook = _buildPlaybook(assessments, portfolio, equipment, nowDate, appetite);
        var insights = _buildInsights(assessments, vessels);

        // Strip internal fields
        var publicAssessments = order.map(function (a) {
            return {
                id: a.id,
                cellLine: a.cellLine,
                experimentTarget: a.experimentTarget || null,
                targetConfluencyPct: a.targetConfluencyPct,
                currentConfluencyPct: a.currentConfluencyPct,
                viabilityPct: a.viabilityPct,
                verdict: a.verdict,
                priority: a.priority,
                priorityScore: a.priorityScore,
                reasons: a.reasons.slice(),
                projectedHarvestWindowISO: a.projectedHarvestWindowISO,
                hoursToTarget: a.hoursToTarget,
            };
        });

        return {
            generatedAtISO: nowDate.toISOString(),
            risk_appetite: appetite,
            portfolio: portfolio,
            vessels: publicAssessments,
            playbook: playbook,
            insights: insights,
        };
    }

    function _assessVessel(v, equipment, nowDate, mult) {
        var reasons = [];
        var currentConfluency = _deriveCurrentConfluency(v);
        var viability = v.viabilityPct;
        var hasHistory = v.growthHistory.length >= 2 || v.confluencyPct != null || v.currentDensityCellsPerCm2 != null;

        // Projection
        var proj = _projectToTarget(v, currentConfluency, nowDate);
        var hoursToTarget = proj ? proj.hoursToTarget : null;
        var projectedISO = proj ? proj.projectedISO : null;

        // ── Verdict ladder (highest priority hazards first) ──

        // INSUFFICIENT_DATA
        if (!hasHistory && currentConfluency == null) {
            reasons.push('INSUFFICIENT_DATA');
            return _finalize(v, currentConfluency, viability, null, null, VERDICTS.INSUFFICIENT_DATA, 'P3', 10 * mult, reasons);
        }

        // UNHEALTHY_RESCUE — contamination, low viability, or sharp drop
        var dropSig = _confluencyDrop(v);
        if (v.contaminationFlag) reasons.push('CONTAMINATION_FLAG');
        if (viability != null && viability < 70) reasons.push('LOW_VIABILITY');
        if (dropSig > 15) reasons.push('SHARP_CONFLUENCY_DROP');

        if (v.contaminationFlag || (viability != null && viability < 70) || dropSig > 15) {
            var score = 60 + (viability != null ? Math.max(0, 70 - viability) * 1.0 : 0) + (v.contaminationFlag ? 25 : 0);
            score = _clamp(score * mult, 0, 100);
            return _finalize(v, currentConfluency, viability, hoursToTarget, projectedISO, VERDICTS.UNHEALTHY_RESCUE, 'P0', score, reasons);
        }

        // OVERGROWN_DISCARD
        if (currentConfluency != null && currentConfluency >= 100) {
            reasons.push('CONFLUENCY_AT_OR_ABOVE_100');
            var ovScore = _clamp((75 + (viability != null && viability < 85 ? 15 : 0)) * mult, 0, 100);
            return _finalize(v, currentConfluency, viability, hoursToTarget, projectedISO, VERDICTS.OVERGROWN_DISCARD, 'P0', ovScore, reasons);
        }
        if (currentConfluency != null && currentConfluency > 95 && currentConfluency >= v.targetConfluencyPct) {
            reasons.push('OVERGROWN_PAST_TARGET');
            var ovScore2 = _clamp(70 * mult, 0, 100);
            return _finalize(v, currentConfluency, viability, hoursToTarget, projectedISO, VERDICTS.OVERGROWN_DISCARD, 'P0', ovScore2, reasons);
        }

        // PASSAGE_LIMIT_REACHED
        if (v.passageNumber != null && v.maxPassage != null && v.passageNumber >= v.maxPassage) {
            reasons.push('PASSAGE_LIMIT_REACHED');
            var plScore = _clamp(65 * mult, 0, 100);
            return _finalize(v, currentConfluency, viability, hoursToTarget, projectedISO, VERDICTS.PASSAGE_LIMIT_REACHED, 'P1', plScore, reasons);
        }

        // HARVEST_NOW — at/above target, viability OK
        if (currentConfluency != null && currentConfluency >= v.targetConfluencyPct
            && (viability == null || viability >= 80)) {
            reasons.push('AT_OR_ABOVE_TARGET');
            var pull = 0;
            if (v.experimentTarget === 'print' || v.experimentTarget === 'assay') {
                pull += 15;
                reasons.push('IMMINENT_DOWNSTREAM_USE');
            }
            var overshoot = currentConfluency - v.targetConfluencyPct;
            var s = 75 + Math.min(15, overshoot * 0.5) + pull;
            if (v.passageNumber != null && v.maxPassage != null) {
                var ratio = v.passageNumber / v.maxPassage;
                if (ratio >= 0.8) { s += 5; reasons.push('PASSAGE_NEAR_LIMIT'); }
            }
            s = _clamp(s * mult, 0, 100);
            return _finalize(v, currentConfluency, viability, 0, nowDate.toISOString(), VERDICTS.HARVEST_NOW, 'P0', s, reasons);
        }

        // HARVEST_TODAY — projected to reach target within ~12h
        if (hoursToTarget != null && hoursToTarget > 0 && hoursToTarget <= 12) {
            reasons.push('REACHES_TARGET_TODAY');
            var hts = _clamp((55 + (12 - hoursToTarget) * 1.5) * mult, 0, 100);
            return _finalize(v, currentConfluency, viability, hoursToTarget, projectedISO, VERDICTS.HARVEST_TODAY, 'P1', hts, reasons);
        }

        // HARVEST_TOMORROW — within ~36h
        if (hoursToTarget != null && hoursToTarget > 12 && hoursToTarget <= 36) {
            reasons.push('REACHES_TARGET_TOMORROW');
            var htm = _clamp(35 * mult, 0, 100);
            return _finalize(v, currentConfluency, viability, hoursToTarget, projectedISO, VERDICTS.HARVEST_TOMORROW, 'P2', htm, reasons);
        }

        // WAIT
        reasons.push('BELOW_TARGET');
        var ws = _clamp((currentConfluency != null
            ? Math.max(5, currentConfluency / v.targetConfluencyPct * 25)
            : 15) * mult, 0, 100);
        return _finalize(v, currentConfluency, viability, hoursToTarget, projectedISO, VERDICTS.WAIT, 'P3', ws, reasons);
    }

    function _finalize(v, currentConfluency, viability, hoursToTarget, projectedISO, verdict, priority, score, reasons) {
        return {
            id: v.id,
            cellLine: v.cellLine,
            experimentTarget: v.experimentTarget,
            targetConfluencyPct: v.targetConfluencyPct,
            currentConfluencyPct: currentConfluency == null ? null : Math.round(currentConfluency * 10) / 10,
            viabilityPct: viability,
            verdict: verdict,
            priority: priority,
            priorityScore: Math.round(score * 10) / 10,
            reasons: reasons,
            projectedHarvestWindowISO: projectedISO,
            hoursToTarget: hoursToTarget == null ? null : Math.round(hoursToTarget * 10) / 10,
            // internal flags reused by playbook
            _passageNumber: v.passageNumber,
            _maxPassage: v.maxPassage,
            _contamination: v.contaminationFlag,
        };
    }

    function _summarize(assessments, appetite) {
        var byVerdict = {};
        Object.keys(VERDICTS).forEach(function (k) { byVerdict[VERDICTS[k]] = 0; });
        var byPriority = { P0: 0, P1: 0, P2: 0, P3: 0 };
        var scoreSum = 0;
        assessments.forEach(function (a) {
            byVerdict[a.verdict] = (byVerdict[a.verdict] || 0) + 1;
            byPriority[a.priority]++;
            scoreSum += a.priorityScore;
        });
        var n = assessments.length;
        var portfolioScore = n ? Math.round((scoreSum / n) * 10) / 10 : 0;
        var grade = _gradeFor(byPriority, portfolioScore, assessments);
        return {
            totalVessels: n,
            byVerdict: byVerdict,
            byPriority: byPriority,
            portfolioScore: portfolioScore,
            grade: grade,
            appetite: appetite,
        };
    }

    function _gradeFor(byPriority, portfolioScore, assessments) {
        if (byPriority.P0 >= 1) return 'F';
        if (portfolioScore >= 70) return 'F';
        if (portfolioScore >= 50) return 'D';
        if (portfolioScore >= 35) return 'C';
        if (portfolioScore >= 18) return 'B';
        if (assessments.length === 0) return 'A';
        return 'A';
    }

    function _buildPlaybook(assessments, portfolio, equipment, nowDate, appetite) {
        var actions = [];
        var harvestNow = assessments.filter(function (a) { return a.verdict === VERDICTS.HARVEST_NOW; });
        var overgrown = assessments.filter(function (a) { return a.verdict === VERDICTS.OVERGROWN_DISCARD; });
        var unhealthy = assessments.filter(function (a) { return a.verdict === VERDICTS.UNHEALTHY_RESCUE; });
        var contaminated = assessments.filter(function (a) { return a._contamination; });
        var passageLimited = assessments.filter(function (a) { return a.verdict === VERDICTS.PASSAGE_LIMIT_REACHED; });
        var today = assessments.filter(function (a) { return a.verdict === VERDICTS.HARVEST_TODAY; });
        var insufficient = assessments.filter(function (a) { return a.verdict === VERDICTS.INSUFFICIENT_DATA; });
        var missingPassage = assessments.filter(function (a) { return a._passageNumber == null || a._maxPassage == null; });

        function add(id, priority, label, reason, owner, blast, reversibility, relatedIds, suggestedValue) {
            actions.push({
                id: id, priority: priority, label: label, reason: reason,
                owner: owner, blastRadius: blast, reversibility: reversibility,
                relatedVesselIds: relatedIds || [],
                suggestedValue: suggestedValue == null ? null : suggestedValue,
            });
        }

        if (harvestNow.length >= 2) {
            add('SCHEDULE_BSC_FOR_HARVEST_NOW', 'P0',
                'Schedule biosafety-cabinet time for ' + harvestNow.length + ' ready-to-harvest vessels',
                'Multiple vessels are at or above target confluency; book BSC + centrifuge windows together to batch the harvest.',
                'lab_manager', 3, 'medium',
                harvestNow.map(function (a) { return a.id; }));
        }
        if (contaminated.length) {
            add('ISOLATE_CONTAMINATED_VESSELS', 'P0',
                'Isolate and triage ' + contaminated.length + ' contaminated vessel(s)',
                'Contamination flag set; isolate from clean cultures and start Mycoplasma + visual triage.',
                'qa', 4, 'low',
                contaminated.map(function (a) { return a.id; }));
        }
        if (overgrown.length) {
            add('DISCARD_OVERGROWN_VESSELS', 'P0',
                'Discard ' + overgrown.length + ' overgrown vessel(s)',
                'Confluency past usable target / >=100%; harvest yield will collapse and viability is at risk.',
                'cell_culture', 2, 'high',
                overgrown.map(function (a) { return a.id; }));
        }
        if (unhealthy.length) {
            add('RESCUE_LOW_VIABILITY', 'P0',
                'Rescue ' + unhealthy.length + ' vessel(s) showing viability or growth decline',
                'Viability <70% or sharp confluency drop detected; consider media change, split-down, or early harvest.',
                'cell_culture_lead', 3, 'medium',
                unhealthy.map(function (a) { return a.id; }));
        }
        if (passageLimited.length) {
            add('REBANK_PASSAGE_LIMITED', 'P1',
                'Rebank or discard ' + passageLimited.length + ' passage-limited vessel(s)',
                'Passage number meets/exceeds the line\'s configured max; downstream data quality risk.',
                'cell_culture_lead', 2, 'medium',
                passageLimited.map(function (a) { return a.id; }));
        }

        // Cluster today-harvests if >=3
        if (today.length >= 3) {
            add('BATCH_HARVEST_WINDOW', 'P1',
                'Cluster ' + today.length + ' same-day harvests into a single window',
                'Multiple vessels project to hit target within today; align them to share BSC/centrifuge time.',
                'scheduler', 2, 'medium',
                today.map(function (a) { return a.id; }));
        }

        // Equipment bottleneck — need centrifuge slot
        var centrifugeIso = _parseIso(equipment.centrifuge);
        var centrifugeFarOff = !centrifugeIso ||
            (centrifugeIso.getTime() - nowDate.getTime()) / 3600000 > 4;
        if (harvestNow.length >= 2 && centrifugeFarOff) {
            add('REQUEST_CENTRIFUGE_SLOT', 'P1',
                'Request earlier centrifuge slot for ' + harvestNow.length + ' ready vessels',
                'No centrifuge availability in the next 4 hours; ' + harvestNow.length + ' vessels are ready to harvest now.',
                'scheduler', 2, 'high',
                harvestNow.map(function (a) { return a.id; }));
        }

        if (insufficient.length >= 2) {
            add('COLLECT_GROWTH_DATA', 'P2',
                'Collect growth-curve data for ' + insufficient.length + ' under-instrumented vessel(s)',
                'Too few observations to project harvest window; log confluency + viability at next check.',
                'cell_culture', 1, 'high',
                insufficient.map(function (a) { return a.id; }));
        }
        if (missingPassage.length >= 2) {
            add('TIGHTEN_PASSAGE_TRACKING', 'P2',
                'Backfill passage tracking for ' + missingPassage.length + ' vessel(s)',
                'Passage number or maxPassage missing; cannot detect passage-limit risk.',
                'data_steward', 1, 'high',
                missingPassage.map(function (a) { return a.id; }));
        }
        if (appetite === 'cautious' && (portfolio.grade === 'C' || portfolio.grade === 'D' || portfolio.grade === 'F')) {
            add('SCHEDULE_HARVEST_AUDIT', 'P2',
                'Schedule a follow-up harvest-window audit',
                'Cautious appetite + portfolio grade ' + portfolio.grade + '; revisit within the day.',
                'lab_manager', 1, 'high', []);
        }

        if (!actions.length) {
            add('MAINTAIN_CULTURE_WATCH', 'P3',
                'Maintain routine culture monitoring',
                'No urgent harvest or rescue actions; continue scheduled checks.',
                'cell_culture', 1, 'high', []);
        }

        // Aggressive trims P3 fallback when other actions present
        if (appetite === 'aggressive' && actions.length > 1) {
            actions = actions.filter(function (a) { return a.priority !== 'P3'; });
        }

        // Dedup by id then sort priority asc + id asc
        var seen = {};
        var deduped = [];
        actions.forEach(function (a) {
            if (seen[a.id]) return;
            seen[a.id] = true;
            deduped.push(a);
        });
        deduped.sort(function (a, b) {
            var pa = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
            if (pa !== 0) return pa;
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
        return deduped;
    }

    function _buildInsights(assessments, vessels) {
        var insights = [];
        var overgrown = assessments.filter(function (a) { return a.verdict === VERDICTS.OVERGROWN_DISCARD; });
        var contaminated = assessments.filter(function (a) { return a._contamination; });
        var harvestToday = assessments.filter(function (a) { return a.verdict === VERDICTS.HARVEST_NOW || a.verdict === VERDICTS.HARVEST_TODAY; });
        var lowViab = assessments.filter(function (a) { return a.viabilityPct != null && a.viabilityPct < 75; });
        var insufficient = assessments.filter(function (a) { return a.verdict === VERDICTS.INSUFFICIENT_DATA; });
        var nearMaxPassage = vessels.filter(function (v) {
            return v.passageNumber != null && v.maxPassage != null && (v.maxPassage - v.passageNumber) <= 2;
        });

        if (overgrown.length >= 2) insights.push('OVERGROWTH_CLUSTER');
        if (contaminated.length) insights.push('CONTAMINATION_DETECTED');
        if (harvestToday.length >= 3) insights.push('HARVEST_DAY_RUSH');
        if (lowViab.length >= 2) insights.push('LOW_VIABILITY_PATTERN');
        if (nearMaxPassage.length >= 2) insights.push('PASSAGE_EXHAUSTION_RISK');
        if (insufficient.length && (insufficient.length / Math.max(1, assessments.length)) >= 0.30) {
            insights.push('INSUFFICIENT_GROWTH_DATA');
        }
        if (!insights.length) insights.push('HEALTHY_CULTURE_FLEET');
        return insights;
    }

    function simulate(report, options) {
        var n = Math.max(0, Math.floor(_num((options || {}).applyTopN, 1)));
        var safe = _publicReport(report);
        if (!n || !safe.playbook.length) {
            return {
                projectedScore: safe.portfolio.portfolioScore,
                projectedGrade: safe.portfolio.grade,
                actionsApplied: [],
            };
        }
        var weights = {
            P0: 18, P1: 9, P2: 4, P3: 1,
        };
        var picked = safe.playbook.slice(0, n);
        var lift = 0;
        picked.forEach(function (a, i) {
            lift += weights[a.priority] * Math.pow(0.85, i);
        });
        var projected = _clamp(safe.portfolio.portfolioScore - lift, 0, 100);
        // Recompute grade against same gating rules (treat P0 as resolved by applied count proportionally).
        var remainingP0 = Math.max(0, safe.portfolio.byPriority.P0 - picked.filter(function (a) { return a.priority === 'P0'; }).length);
        var fakeByPriority = {
            P0: remainingP0,
            P1: safe.portfolio.byPriority.P1,
            P2: safe.portfolio.byPriority.P2,
            P3: safe.portfolio.byPriority.P3,
        };
        var grade = _gradeFor(fakeByPriority, projected, safe.vessels);
        return {
            projectedScore: Math.round(projected * 10) / 10,
            projectedGrade: grade,
            actionsApplied: picked.map(function (a) { return a.id; }),
        };
    }

    // Defensive copy of a report for simulate (never mutate caller).
    function _publicReport(r) {
        var s = JSON.stringify(r || {});
        try { return JSON.parse(s); } catch (e) { return {}; }
    }

    // ── renderers ──

    function formatText(report) {
        var r = report || {};
        var p = r.portfolio || {};
        var lines = [];
        lines.push('VERDICT: grade=' + (p.grade || '?') + ' N=' + (p.totalVessels || 0)
            + ' P0=' + ((p.byPriority || {}).P0 || 0)
            + ' P1=' + ((p.byPriority || {}).P1 || 0)
            + ' score=' + (p.portfolioScore || 0)
            + ' appetite=' + (r.risk_appetite || 'balanced'));
        (r.vessels || []).forEach(function (v) {
            lines.push('  - ' + v.id + ' [' + v.priority + '] ' + v.verdict
                + ' score=' + v.priorityScore
                + ' confluency=' + (v.currentConfluencyPct == null ? '?' : v.currentConfluencyPct + '%')
                + ' target=' + v.targetConfluencyPct + '%'
                + (v.projectedHarvestWindowISO ? ' window=' + v.projectedHarvestWindowISO : '')
                + (v.reasons && v.reasons.length ? ' reasons=' + v.reasons.join(',') : ''));
        });
        (r.playbook || []).forEach(function (a) {
            lines.push('  * ' + a.priority + ' ' + a.id + ': ' + a.label);
        });
        if ((r.insights || []).length) lines.push('Insights: ' + r.insights.join(', '));
        return lines.join('\n');
    }

    function _escapeMd(s) {
        return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    }

    function formatMarkdown(report) {
        var r = report || {};
        var p = r.portfolio || {};
        var out = [];
        out.push('## Summary');
        out.push('');
        out.push('| metric | value |');
        out.push('| --- | --- |');
        out.push('| grade | ' + (p.grade || '?') + ' |');
        out.push('| portfolio_score | ' + (p.portfolioScore || 0) + ' |');
        out.push('| vessels | ' + (p.totalVessels || 0) + ' |');
        out.push('| P0 | ' + ((p.byPriority || {}).P0 || 0) + ' |');
        out.push('| P1 | ' + ((p.byPriority || {}).P1 || 0) + ' |');
        out.push('| P2 | ' + ((p.byPriority || {}).P2 || 0) + ' |');
        out.push('| P3 | ' + ((p.byPriority || {}).P3 || 0) + ' |');
        out.push('| risk_appetite | ' + (r.risk_appetite || 'balanced') + ' |');
        out.push('');
        out.push('## Vessels');
        out.push('');
        out.push('| id | verdict | priority | score | confluency | target | window | reasons |');
        out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
        (r.vessels || []).forEach(function (v) {
            out.push('| ' + [
                _escapeMd(v.id),
                _escapeMd(v.verdict),
                _escapeMd(v.priority),
                v.priorityScore,
                v.currentConfluencyPct == null ? '—' : v.currentConfluencyPct + '%',
                v.targetConfluencyPct + '%',
                _escapeMd(v.projectedHarvestWindowISO || '—'),
                _escapeMd((v.reasons || []).join(', ')),
            ].join(' | ') + ' |');
        });
        if (!(r.vessels || []).length) out.push('| _none_ |  |  |  |  |  |  |  |');
        out.push('');
        out.push('## Playbook');
        out.push('');
        out.push('| priority | id | owner | blast | label |');
        out.push('| --- | --- | --- | --- | --- |');
        (r.playbook || []).forEach(function (a) {
            out.push('| ' + [
                _escapeMd(a.priority),
                _escapeMd(a.id),
                _escapeMd(a.owner),
                a.blastRadius,
                _escapeMd(a.label),
            ].join(' | ') + ' |');
        });
        if (!(r.playbook || []).length) out.push('| _none_ |  |  |  |  |');
        out.push('');
        out.push('## Insights');
        out.push('');
        (r.insights || []).forEach(function (i) { out.push('- ' + i); });
        if (!(r.insights || []).length) out.push('- _none_');
        return out.join('\n');
    }

    // Byte-stable JSON via recursive sorted-keys serializer.
    function formatJson(report) {
        function toSorted(v) {
            if (v === null || typeof v !== 'object') return v;
            if (v instanceof Date) return v.toISOString();
            if (Array.isArray(v)) return v.map(toSorted);
            var keys = Object.keys(v).sort();
            var out = {};
            keys.forEach(function (k) { out[k] = toSorted(v[k]); });
            return out;
        }
        return JSON.stringify(toSorted(report), null, 2);
    }

    return {
        recommend: recommend,
        simulate: simulate,
        formatText: formatText,
        formatMarkdown: formatMarkdown,
        formatJson: formatJson,
        VERDICTS: VERDICTS,
    };
}

module.exports = {
    createCellHarvestWindowAdvisor: createCellHarvestWindowAdvisor,
    VERDICTS: VERDICTS,
};
