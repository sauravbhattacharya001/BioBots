'use strict';

/**
 * Lab Knowledge Distillation Engine
 *
 * Autonomous tacit knowledge extraction from experiment histories.
 * Analyzes operator techniques, identifies expertise concentrations,
 * detects knowledge gaps, codifies best practices, and recommends
 * skill transfers to reduce institutional knowledge risk.
 *
 * 7 Engines:
 *   1. Technique Fingerprinter — extracts unique operator parameter signatures
 *   2. Expert Identifier — ranks operators by domain competency
 *   3. Knowledge Gap Detector — finds undocumented institutional knowledge
 *   4. Best Practice Codifier — distills winning patterns into reusable rules
 *   5. Skill Transfer Recommender — identifies mentoring pairs and priorities
 *   6. Knowledge Decay Detector — tracks institutional knowledge degradation
 *   7. Insight Generator — autonomous pattern discovery and recommendations
 *
 * Agentic capabilities:
 *   - Autonomous technique discovery without manual labeling
 *   - Proactive bus-factor risk detection
 *   - Self-improving best practice library from outcomes
 *   - Cross-operator knowledge gap inference
 *   - Temporal decay detection for institutional memory
 *
 * @example
 *   var kd = createKnowledgeDistiller();
 *   kd.recordExperiment({
 *     id: 'exp-001', operator: 'alice', protocol: 'bioprint-cartilage',
 *     timestamp: '2025-06-15T10:00:00Z', outcome: 'success',
 *     parameters: { temperature: 37, pressure: 2.5, speed: 10, layerHeight: 0.2 },
 *     metrics: { cellViability: 0.92, printAccuracy: 0.88 },
 *     techniques: ['pre-warm-nozzle', 'gradual-pressure-ramp'],
 *     notes: 'Used slow ramp for first 3 layers'
 *   });
 *   var profile = kd.getOperatorProfile('alice');
 *   var gaps = kd.detectKnowledgeGaps();
 *   var practices = kd.codifyBestPractices();
 *   var transfers = kd.recommendTransfers();
 *   var dashboard = kd.dashboard();
 */

var _stats = require('./stats');
var mean = _stats.mean;
var stddev = _stats.stddev;
var linearRegression = _stats.linearRegression;

var _isDangerousKey = require('./sanitize').isDangerousKey;
var round = require('./validation').round;

// ── Constants ──────────────────────────────────────────────────────

var HEALTH_TIERS = [
    { min: 0,  max: 20, label: 'Critical' },
    { min: 21, max: 40, label: 'Poor' },
    { min: 41, max: 60, label: 'Fair' },
    { min: 61, max: 80, label: 'Good' },
    { min: 81, max: 100, label: 'Excellent' }
];

var EXPERTISE_TIERS = [
    { min: 0,  max: 20, label: 'Novice' },
    { min: 21, max: 40, label: 'Beginner' },
    { min: 41, max: 60, label: 'Competent' },
    { min: 61, max: 80, label: 'Proficient' },
    { min: 81, max: 100, label: 'Expert' }
];

var VALID_OUTCOMES = { success: true, partial: true, failure: true };

var GAP_CATEGORIES = {
    sole_expert:      'Only one operator knows this protocol',
    undocumented:     'Technique used successfully but never documented',
    declining:        'Knowledge quality degrading over time',
    orphaned:         'Original expert left; no successor trained',
    fragmented:       'Knowledge spread across operators without overlap',
    stale:            'No experiments in this domain for extended period'
};

var INSIGHT_TYPES = {
    bus_factor:        'Bus factor risk — single point of failure',
    expertise_cluster: 'Expertise concentrated in few operators',
    knowledge_decay:   'Institutional knowledge degrading',
    best_practice:     'Winning pattern identified',
    transfer_urgent:   'Critical skill transfer needed',
    technique_drift:   'Operator technique changing over time',
    hidden_expert:     'Operator has undiscovered expertise',
    practice_conflict: 'Conflicting best practices detected'
};

var MAX_EXPERIMENTS = 10000;
var MAX_OPERATORS = 200;
var MAX_PRACTICES = 500;
var DECAY_WINDOW_DAYS = 90;
var STALE_THRESHOLD_DAYS = 180;

// ── Helpers ────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function tierFor(score, tiers) {
    for (var i = 0; i < tiers.length; i++) {
        if (score >= tiers[i].min && score <= tiers[i].max) return tiers[i].label;
    }
    return tiers[tiers.length - 1].label;
}

function parseTs(ts) {
    if (typeof ts === 'number') return ts;
    var d = new Date(ts);
    return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

function daysBetween(a, b) {
    return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

function cosineSimilarity(a, b, keys) {
    var dotProduct = 0, magA = 0, magB = 0;
    for (var i = 0; i < keys.length; i++) {
        var va = a[keys[i]] || 0;
        var vb = b[keys[i]] || 0;
        dotProduct += va * vb;
        magA += va * va;
        magB += vb * vb;
    }
    var mag = Math.sqrt(magA) * Math.sqrt(magB);
    return mag === 0 ? 0 : dotProduct / mag;
}

function shannonEntropy(counts, total) {
    if (total === 0) return 0;
    var h = 0;
    for (var i = 0; i < counts.length; i++) {
        if (counts[i] === 0) continue;
        var p = counts[i] / total;
        h -= p * Math.log2(p);
    }
    return h;
}

function giniCoefficient(values) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    var sum = 0, cumSum = 0;
    for (var i = 0; i < n; i++) {
        sum += sorted[i];
        cumSum += (2 * (i + 1) - n - 1) * sorted[i];
    }
    return sum === 0 ? 0 : cumSum / (n * sum);
}

function safePush(arr, item, max) {
    if (arr.length < max) arr.push(item);
    return arr;
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create a new Lab Knowledge Distillation Engine instance.
 * @returns {Object} Knowledge distiller API
 */
function createKnowledgeDistiller() {
    var experiments = [];
    var operators = Object.create(null);     // operatorId → { experiments: [], protocols: Set-like }
    var protocols = Object.create(null);     // protocolId → { experiments: [], operators: Set-like }
    var techniques = Object.create(null);    // technique → { count, operators: {}, successRate }
    var bestPractices = [];
    var transferLog = [];

    // ── Engine 1: Technique Fingerprinter ──────────────────────────

    function buildFingerprint(operatorId) {
        var ops = operators[operatorId];
        if (!ops) return null;
        var exps = ops.experiments;
        if (!exps.length) return null;

        // Build parameter signature: average values per parameter
        var paramSums = Object.create(null);
        var paramCounts = Object.create(null);
        var techFreq = Object.create(null);
        var protocolFreq = Object.create(null);
        var outcomeCount = { success: 0, partial: 0, failure: 0 };

        for (var i = 0; i < exps.length; i++) {
            var exp = exps[i];
            // Parameters
            if (exp.parameters) {
                var pkeys = Object.keys(exp.parameters);
                for (var j = 0; j < pkeys.length; j++) {
                    if (_isDangerousKey(pkeys[j])) continue;
                    var v = exp.parameters[pkeys[j]];
                    if (typeof v === 'number' && isFinite(v)) {
                        paramSums[pkeys[j]] = (paramSums[pkeys[j]] || 0) + v;
                        paramCounts[pkeys[j]] = (paramCounts[pkeys[j]] || 0) + 1;
                    }
                }
            }
            // Techniques
            if (Array.isArray(exp.techniques)) {
                for (var t = 0; t < exp.techniques.length; t++) {
                    var tech = String(exp.techniques[t]);
                    techFreq[tech] = (techFreq[tech] || 0) + 1;
                }
            }
            // Protocols
            if (exp.protocol) {
                protocolFreq[exp.protocol] = (protocolFreq[exp.protocol] || 0) + 1;
            }
            // Outcomes
            if (VALID_OUTCOMES[exp.outcome]) {
                outcomeCount[exp.outcome]++;
            }
        }

        // Compute averages
        var paramAvg = Object.create(null);
        var avgKeys = Object.keys(paramSums);
        for (var k = 0; k < avgKeys.length; k++) {
            paramAvg[avgKeys[k]] = round(paramSums[avgKeys[k]] / paramCounts[avgKeys[k]], 4);
        }

        // Compute parameter variance (consistency measure)
        var paramVariance = Object.create(null);
        for (var pk = 0; pk < avgKeys.length; pk++) {
            var key = avgKeys[pk];
            var vals = [];
            for (var vi = 0; vi < exps.length; vi++) {
                if (exps[vi].parameters && typeof exps[vi].parameters[key] === 'number') {
                    vals.push(exps[vi].parameters[key]);
                }
            }
            paramVariance[key] = vals.length > 1 ? round(stddev(vals) / (Math.abs(mean(vals)) || 1) * 100, 2) : 0;
        }

        return {
            operator: operatorId,
            experimentCount: exps.length,
            parameterSignature: paramAvg,
            parameterConsistency: paramVariance,
            techniquePreferences: techFreq,
            protocolExperience: protocolFreq,
            outcomeDistribution: outcomeCount,
            successRate: exps.length > 0 ? round(outcomeCount.success / exps.length * 100, 2) : 0
        };
    }

    // ── Engine 2: Expert Identifier ────────────────────────────────

    function computeExpertiseScore(operatorId, protocolId) {
        var ops = operators[operatorId];
        if (!ops) return 0;

        var relevantExps = protocolId
            ? ops.experiments.filter(function (e) { return e.protocol === protocolId; })
            : ops.experiments;

        if (!relevantExps.length) return 0;

        // Factors: success rate (40%), volume (20%), consistency (20%), recency (20%)
        var successCount = 0;
        var now = Date.now();
        var recencyScores = [];
        var metricValues = [];

        for (var i = 0; i < relevantExps.length; i++) {
            var exp = relevantExps[i];
            if (exp.outcome === 'success') successCount++;

            // Recency: exponential decay
            var ageDays = daysBetween(parseTs(exp.timestamp), now);
            recencyScores.push(Math.exp(-ageDays / 365));

            // Metric quality
            if (exp.metrics) {
                var mkeys = Object.keys(exp.metrics);
                var msum = 0;
                for (var m = 0; m < mkeys.length; m++) {
                    if (typeof exp.metrics[mkeys[m]] === 'number') msum += exp.metrics[mkeys[m]];
                }
                if (mkeys.length > 0) metricValues.push(msum / mkeys.length);
            }
        }

        var successRate = successCount / relevantExps.length;
        var volumeScore = Math.min(relevantExps.length / 20, 1); // cap at 20 experiments
        var recencyScore = recencyScores.length > 0 ? mean(recencyScores) : 0;
        var metricScore = metricValues.length > 0 ? clamp(mean(metricValues), 0, 1) : 0.5;

        var score = (successRate * 0.4 + volumeScore * 0.2 + recencyScore * 0.2 + metricScore * 0.2) * 100;
        return round(clamp(score, 0, 100), 2);
    }

    function identifyExperts(protocolId) {
        var opIds = Object.keys(operators);
        var results = [];

        for (var i = 0; i < opIds.length; i++) {
            var score = computeExpertiseScore(opIds[i], protocolId);
            if (score > 0) {
                results.push({
                    operator: opIds[i],
                    score: score,
                    tier: tierFor(score, EXPERTISE_TIERS),
                    protocols: Object.keys(operators[opIds[i]].protocols || {})
                });
            }
        }

        results.sort(function (a, b) { return b.score - a.score; });
        return results;
    }

    // ── Engine 3: Knowledge Gap Detector ───────────────────────────

    function detectKnowledgeGaps() {
        var gaps = [];
        var now = Date.now();
        var protoIds = Object.keys(protocols);

        for (var i = 0; i < protoIds.length; i++) {
            var pid = protoIds[i];
            var proto = protocols[pid];
            var opIds = Object.keys(proto.operators || {});
            var exps = proto.experiments || [];

            // Sole expert gap
            if (opIds.length === 1 && exps.length >= 3) {
                gaps.push({
                    category: 'sole_expert',
                    protocol: pid,
                    description: GAP_CATEGORIES.sole_expert,
                    severity: 'high',
                    details: { operator: opIds[0], experimentCount: exps.length }
                });
            }

            // Stale knowledge gap
            if (exps.length > 0) {
                var latestTs = 0;
                for (var j = 0; j < exps.length; j++) {
                    var ts = parseTs(exps[j].timestamp);
                    if (ts > latestTs) latestTs = ts;
                }
                var staleDays = daysBetween(latestTs, now);
                if (staleDays > STALE_THRESHOLD_DAYS) {
                    gaps.push({
                        category: 'stale',
                        protocol: pid,
                        description: GAP_CATEGORIES.stale,
                        severity: staleDays > 365 ? 'critical' : 'medium',
                        details: { daysSinceLastExperiment: round(staleDays, 0), operators: opIds }
                    });
                }
            }

            // Fragmented knowledge
            if (opIds.length >= 3) {
                // Check if any single operator has done < 20% of experiments
                var opCounts = [];
                for (var oi = 0; oi < opIds.length; oi++) {
                    var count = 0;
                    for (var ei = 0; ei < exps.length; ei++) {
                        if (exps[ei].operator === opIds[oi]) count++;
                    }
                    opCounts.push(count);
                }
                var maxCount = Math.max.apply(null, opCounts);
                if (maxCount < exps.length * 0.3 && exps.length >= 5) {
                    gaps.push({
                        category: 'fragmented',
                        protocol: pid,
                        description: GAP_CATEGORIES.fragmented,
                        severity: 'medium',
                        details: { operators: opIds, experimentCounts: opCounts }
                    });
                }
            }
        }

        // Undocumented technique gaps
        var techIds = Object.keys(techniques);
        for (var ti = 0; ti < techIds.length; ti++) {
            var tech = techniques[techIds[ti]];
            var techOpIds = Object.keys(tech.operators || {});
            if (techOpIds.length === 1 && tech.count >= 3) {
                gaps.push({
                    category: 'undocumented',
                    protocol: null,
                    description: GAP_CATEGORIES.undocumented + ': ' + techIds[ti],
                    severity: 'medium',
                    details: { technique: techIds[ti], operator: techOpIds[0], uses: tech.count }
                });
            }
        }

        // Sort by severity
        var severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        gaps.sort(function (a, b) {
            return (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3);
        });

        return gaps;
    }

    // ── Engine 4: Best Practice Codifier ───────────────────────────

    function codifyBestPractices() {
        var practices = [];
        var protoIds = Object.keys(protocols);

        for (var i = 0; i < protoIds.length; i++) {
            var pid = protoIds[i];
            var exps = protocols[pid].experiments || [];
            if (exps.length < 3) continue;

            // Separate successful and failed experiments
            var successes = [];
            var failures = [];
            for (var j = 0; j < exps.length; j++) {
                if (exps[j].outcome === 'success') successes.push(exps[j]);
                else if (exps[j].outcome === 'failure') failures.push(exps[j]);
            }

            if (successes.length < 2) continue;

            // Find parameter ranges that distinguish success from failure
            var allParams = Object.create(null);
            for (var si = 0; si < successes.length; si++) {
                if (successes[si].parameters) {
                    var pk = Object.keys(successes[si].parameters);
                    for (var pi = 0; pi < pk.length; pi++) {
                        if (_isDangerousKey(pk[pi])) continue;
                        if (typeof successes[si].parameters[pk[pi]] === 'number') {
                            allParams[pk[pi]] = true;
                        }
                    }
                }
            }

            var paramKeys = Object.keys(allParams);
            var paramRules = [];

            for (var pk2 = 0; pk2 < paramKeys.length; pk2++) {
                var key = paramKeys[pk2];
                var successVals = [];
                var failureVals = [];

                for (var s = 0; s < successes.length; s++) {
                    if (successes[s].parameters && typeof successes[s].parameters[key] === 'number') {
                        successVals.push(successes[s].parameters[key]);
                    }
                }
                for (var f = 0; f < failures.length; f++) {
                    if (failures[f].parameters && typeof failures[f].parameters[key] === 'number') {
                        failureVals.push(failures[f].parameters[key]);
                    }
                }

                if (successVals.length < 2) continue;

                var sMean = mean(successVals);
                var sStd = stddev(successVals);
                var goldenMin = round(sMean - 2 * sStd, 4);
                var goldenMax = round(sMean + 2 * sStd, 4);

                var confidence = 50;
                if (sStd > 0 && successVals.length >= 5) confidence += 20;
                if (failureVals.length > 0) {
                    var fMean = mean(failureVals);
                    var separation = Math.abs(sMean - fMean) / (sStd || 1);
                    if (separation > 1) confidence += 20;
                    if (separation > 2) confidence += 10;
                }
                confidence = clamp(confidence, 0, 100);

                paramRules.push({
                    parameter: key,
                    goldenRange: { min: goldenMin, max: goldenMax },
                    mean: round(sMean, 4),
                    cv: sStd > 0 ? round(sStd / Math.abs(sMean) * 100, 2) : 0,
                    confidence: confidence,
                    sampleSize: successVals.length
                });
            }

            // Technique best practices
            var techCounts = Object.create(null);
            for (var ts = 0; ts < successes.length; ts++) {
                if (Array.isArray(successes[ts].techniques)) {
                    for (var ti = 0; ti < successes[ts].techniques.length; ti++) {
                        var tech = String(successes[ts].techniques[ti]);
                        techCounts[tech] = (techCounts[tech] || 0) + 1;
                    }
                }
            }

            var techRules = [];
            var techKeys = Object.keys(techCounts);
            for (var tk = 0; tk < techKeys.length; tk++) {
                var prevalence = techCounts[techKeys[tk]] / successes.length;
                if (prevalence >= 0.5) { // used in >=50% of successes
                    techRules.push({
                        technique: techKeys[tk],
                        prevalence: round(prevalence * 100, 1),
                        successCorrelation: round(prevalence, 4)
                    });
                }
            }

            if (paramRules.length > 0 || techRules.length > 0) {
                practices.push({
                    protocol: pid,
                    parameterRules: paramRules,
                    techniqueRules: techRules,
                    basedOn: successes.length,
                    successRate: round(successes.length / exps.length * 100, 1)
                });
            }
        }

        bestPractices = practices;
        return practices;
    }

    // ── Engine 5: Skill Transfer Recommender ───────────────────────

    function recommendTransfers() {
        var recommendations = [];
        var opIds = Object.keys(operators);
        var protoIds = Object.keys(protocols);

        for (var i = 0; i < protoIds.length; i++) {
            var pid = protoIds[i];
            var proto = protocols[pid];
            var protoOps = Object.keys(proto.operators || {});

            if (protoOps.length < 1) continue;

            // Find the best operator for this protocol
            var bestOp = null;
            var bestScore = 0;
            var scores = [];

            for (var oi = 0; oi < protoOps.length; oi++) {
                var score = computeExpertiseScore(protoOps[oi], pid);
                scores.push({ operator: protoOps[oi], score: score });
                if (score > bestScore) {
                    bestScore = score;
                    bestOp = protoOps[oi];
                }
            }

            // Find operators who should learn this protocol
            // (operators who work on related protocols but not this one)
            for (var ai = 0; ai < opIds.length; ai++) {
                if (proto.operators[opIds[ai]]) continue; // already knows it

                // Check if this operator works on related protocols
                var opProtos = Object.keys(operators[opIds[ai]].protocols || {});
                var hasRelated = false;
                for (var rp = 0; rp < opProtos.length; rp++) {
                    // Simple relatedness heuristic: shared word in protocol name
                    if (opProtos[rp].split('-').some(function (w) { return pid.indexOf(w) >= 0 && w.length > 3; })) {
                        hasRelated = true;
                        break;
                    }
                }

                if (protoOps.length === 1 || hasRelated) {
                    var urgency = protoOps.length === 1 ? 'critical' : 'recommended';
                    recommendations.push({
                        protocol: pid,
                        mentor: bestOp,
                        mentorScore: bestScore,
                        learner: opIds[ai],
                        urgency: urgency,
                        reason: protoOps.length === 1
                            ? 'Bus factor = 1; only ' + bestOp + ' knows this protocol'
                            : 'Related experience found; cross-training opportunity'
                    });
                }
            }
        }

        // Sort: critical first, then by mentor score
        var urgencyOrder = { critical: 0, recommended: 1, optional: 2 };
        recommendations.sort(function (a, b) {
            var diff = (urgencyOrder[a.urgency] || 2) - (urgencyOrder[b.urgency] || 2);
            return diff !== 0 ? diff : b.mentorScore - a.mentorScore;
        });

        transferLog = recommendations;
        return recommendations;
    }

    // ── Engine 6: Knowledge Decay Detector ─────────────────────────

    function detectKnowledgeDecay() {
        var decayReports = [];
        var protoIds = Object.keys(protocols);
        var now = Date.now();

        for (var i = 0; i < protoIds.length; i++) {
            var pid = protoIds[i];
            var exps = protocols[pid].experiments || [];
            if (exps.length < 4) continue;

            // Sort by time
            var sorted = exps.slice().sort(function (a, b) { return parseTs(a.timestamp) - parseTs(b.timestamp); });

            // Compute rolling success rate
            var windowSize = Math.max(3, Math.floor(sorted.length / 3));
            var windows = [];
            for (var w = 0; w <= sorted.length - windowSize; w++) {
                var windowExps = sorted.slice(w, w + windowSize);
                var successCount = 0;
                for (var we = 0; we < windowExps.length; we++) {
                    if (windowExps[we].outcome === 'success') successCount++;
                }
                windows.push({
                    startTime: parseTs(windowExps[0].timestamp),
                    endTime: parseTs(windowExps[windowExps.length - 1].timestamp),
                    successRate: successCount / windowSize
                });
            }

            if (windows.length < 2) continue;

            // Linear regression on success rate over time
            var xs = [];
            var ys = [];
            for (var wi = 0; wi < windows.length; wi++) {
                xs.push(wi);
                ys.push(windows[wi].successRate);
            }
            var reg = linearRegression(xs, ys);

            // Detect decay: negative slope with reasonable R²
            if (reg.slope < -0.02 && reg.r2 > 0.2) {
                var decayRate = round(Math.abs(reg.slope) * 100, 2);
                decayReports.push({
                    protocol: pid,
                    decayRate: decayRate,
                    trend: 'declining',
                    r2: round(reg.r2, 4),
                    windowCount: windows.length,
                    currentSuccessRate: round(windows[windows.length - 1].successRate * 100, 1),
                    peakSuccessRate: round(Math.max.apply(null, ys) * 100, 1),
                    severity: decayRate > 10 ? 'critical' : decayRate > 5 ? 'high' : 'medium'
                });
            }
        }

        decayReports.sort(function (a, b) {
            var so = { critical: 0, high: 1, medium: 2 };
            return (so[a.severity] || 2) - (so[b.severity] || 2);
        });

        return decayReports;
    }

    // ── Engine 7: Insight Generator ────────────────────────────────

    function generateInsights() {
        var insights = [];
        var opIds = Object.keys(operators);
        var protoIds = Object.keys(protocols);

        // Bus factor analysis
        for (var i = 0; i < protoIds.length; i++) {
            var pid = protoIds[i];
            var protoOps = Object.keys(protocols[pid].operators || {});
            if (protoOps.length === 1 && (protocols[pid].experiments || []).length >= 3) {
                insights.push({
                    type: 'bus_factor',
                    severity: 'high',
                    message: 'Protocol "' + pid + '" has bus factor = 1 (only ' + protoOps[0] + ')',
                    protocol: pid,
                    actionable: true
                });
            }
        }

        // Expertise concentration (Gini coefficient)
        if (opIds.length >= 2) {
            var expCounts = opIds.map(function (id) { return operators[id].experiments.length; });
            var gini = giniCoefficient(expCounts);
            if (gini > 0.5) {
                insights.push({
                    type: 'expertise_cluster',
                    severity: gini > 0.7 ? 'high' : 'medium',
                    message: 'Experience highly concentrated (Gini = ' + round(gini, 3) + '). ' +
                             'Consider distributing experiments more evenly.',
                    actionable: true
                });
            }
        }

        // Hidden experts: operators with high success rate but low volume
        for (var oi = 0; oi < opIds.length; oi++) {
            var op = operators[opIds[oi]];
            if (op.experiments.length >= 3 && op.experiments.length <= 8) {
                var successes = 0;
                for (var ei = 0; ei < op.experiments.length; ei++) {
                    if (op.experiments[ei].outcome === 'success') successes++;
                }
                var rate = successes / op.experiments.length;
                if (rate >= 0.9) {
                    insights.push({
                        type: 'hidden_expert',
                        severity: 'low',
                        message: 'Operator "' + opIds[oi] + '" has ' + round(rate * 100, 0) +
                                 '% success rate across ' + op.experiments.length +
                                 ' experiments — potential hidden expert',
                        actionable: true
                    });
                }
            }
        }

        // Knowledge decay insights
        var decay = detectKnowledgeDecay();
        for (var di = 0; di < decay.length; di++) {
            insights.push({
                type: 'knowledge_decay',
                severity: decay[di].severity,
                message: 'Protocol "' + decay[di].protocol + '" success rate declining at ' +
                         decay[di].decayRate + '% per window (R²=' + decay[di].r2 + ')',
                protocol: decay[di].protocol,
                actionable: true
            });
        }

        return insights;
    }

    // ── Dashboard ──────────────────────────────────────────────────

    function computeHealthScore() {
        var opIds = Object.keys(operators);
        var protoIds = Object.keys(protocols);
        if (experiments.length === 0) return { score: 50, tier: 'Fair' };

        // Factor 1: Knowledge distribution (30%) — low Gini is good
        var expCounts = opIds.map(function (id) { return operators[id].experiments.length; });
        var gini = opIds.length >= 2 ? giniCoefficient(expCounts) : 0;
        var distributionScore = (1 - gini) * 100;

        // Factor 2: Bus factor coverage (30%) — % protocols with >1 operator
        var multiOpCount = 0;
        for (var i = 0; i < protoIds.length; i++) {
            if (Object.keys(protocols[protoIds[i]].operators || {}).length > 1) multiOpCount++;
        }
        var busFactorScore = protoIds.length > 0 ? (multiOpCount / protoIds.length) * 100 : 50;

        // Factor 3: Overall success rate (20%)
        var totalSuccess = 0;
        for (var j = 0; j < experiments.length; j++) {
            if (experiments[j].outcome === 'success') totalSuccess++;
        }
        var successScore = (totalSuccess / experiments.length) * 100;

        // Factor 4: Freshness (20%) — recent activity
        var now = Date.now();
        var recentCount = 0;
        for (var k = 0; k < experiments.length; k++) {
            if (daysBetween(parseTs(experiments[k].timestamp), now) < DECAY_WINDOW_DAYS) {
                recentCount++;
            }
        }
        var freshnessScore = Math.min(recentCount / Math.max(protoIds.length, 1), 1) * 100;

        var score = round(clamp(
            distributionScore * 0.30 + busFactorScore * 0.30 + successScore * 0.20 + freshnessScore * 0.20,
            0, 100
        ), 1);

        return {
            score: score,
            tier: tierFor(score, HEALTH_TIERS),
            factors: {
                distribution: round(distributionScore, 1),
                busFactor: round(busFactorScore, 1),
                successRate: round(successScore, 1),
                freshness: round(freshnessScore, 1)
            }
        };
    }

    function dashboard() {
        var opIds = Object.keys(operators);
        var protoIds = Object.keys(protocols);
        var health = computeHealthScore();

        return {
            health: health,
            summary: {
                totalExperiments: experiments.length,
                totalOperators: opIds.length,
                totalProtocols: protoIds.length,
                totalTechniques: Object.keys(techniques).length,
                bestPracticeCount: bestPractices.length,
                pendingTransfers: transferLog.filter(function (t) { return t.urgency === 'critical'; }).length
            },
            topExperts: identifyExperts().slice(0, 5),
            knowledgeGaps: detectKnowledgeGaps().slice(0, 10),
            decayAlerts: detectKnowledgeDecay().slice(0, 5),
            insights: generateInsights().slice(0, 10)
        };
    }

    // ── Record API ─────────────────────────────────────────────────

    function recordExperiment(exp) {
        if (!exp || typeof exp !== 'object') throw new Error('Experiment must be an object');
        if (!exp.id || typeof exp.id !== 'string') throw new Error('Experiment id is required');
        if (!exp.operator || typeof exp.operator !== 'string') throw new Error('Operator is required');
        if (!exp.protocol || typeof exp.protocol !== 'string') throw new Error('Protocol is required');
        if (_isDangerousKey(exp.id) || _isDangerousKey(exp.operator) || _isDangerousKey(exp.protocol)) {
            throw new Error('Dangerous key detected');
        }
        if (!VALID_OUTCOMES[exp.outcome]) throw new Error('Outcome must be success, partial, or failure');
        if (experiments.length >= MAX_EXPERIMENTS) throw new Error('Experiment limit reached (' + MAX_EXPERIMENTS + ')');

        var record = {
            id: exp.id,
            operator: exp.operator,
            protocol: exp.protocol,
            timestamp: exp.timestamp || new Date().toISOString(),
            outcome: exp.outcome,
            parameters: exp.parameters && typeof exp.parameters === 'object' ? exp.parameters : {},
            metrics: exp.metrics && typeof exp.metrics === 'object' ? exp.metrics : {},
            techniques: Array.isArray(exp.techniques) ? exp.techniques.map(String) : [],
            notes: typeof exp.notes === 'string' ? exp.notes : ''
        };

        experiments.push(record);

        // Index by operator
        if (!operators[record.operator]) {
            if (Object.keys(operators).length >= MAX_OPERATORS) throw new Error('Operator limit reached');
            operators[record.operator] = { experiments: [], protocols: Object.create(null) };
        }
        operators[record.operator].experiments.push(record);
        operators[record.operator].protocols[record.protocol] = true;

        // Index by protocol
        if (!protocols[record.protocol]) {
            protocols[record.protocol] = { experiments: [], operators: Object.create(null) };
        }
        protocols[record.protocol].experiments.push(record);
        protocols[record.protocol].operators[record.operator] = true;

        // Index techniques
        for (var t = 0; t < record.techniques.length; t++) {
            var tech = record.techniques[t];
            if (_isDangerousKey(tech)) continue;
            if (!techniques[tech]) {
                techniques[tech] = { count: 0, operators: Object.create(null), successCount: 0 };
            }
            techniques[tech].count++;
            techniques[tech].operators[record.operator] = true;
            if (record.outcome === 'success') techniques[tech].successCount++;
        }

        return record;
    }

    // ── Public API ─────────────────────────────────────────────────

    return {
        recordExperiment: recordExperiment,
        getOperatorProfile: buildFingerprint,
        identifyExperts: identifyExperts,
        detectKnowledgeGaps: detectKnowledgeGaps,
        codifyBestPractices: codifyBestPractices,
        recommendTransfers: recommendTransfers,
        detectKnowledgeDecay: detectKnowledgeDecay,
        generateInsights: generateInsights,
        computeExpertiseScore: computeExpertiseScore,
        dashboard: dashboard,
        experimentCount: function () { return experiments.length; },
        operatorCount: function () { return Object.keys(operators).length; },
        protocolCount: function () { return Object.keys(protocols).length; }
    };
}

module.exports = { createKnowledgeDistiller: createKnowledgeDistiller };
