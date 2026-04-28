'use strict';

/**
 * Lab Situation Awareness Engine (LSAE)
 *
 * Autonomous unified operational picture for bioprinting labs.
 * Aggregates events from 8 domains into a single real-time situational
 * awareness view with composite readiness scoring, cascade failure
 * detection, forecast projection, and autonomous SITREP generation.
 *
 * Key capabilities:
 * - Ingests events from 8 lab domains with severity-weighted impact
 * - Composite Lab Readiness Score (0-100) with GREEN/YELLOW/ORANGE/RED
 * - Cascade failure detection with multi-hop chain tracking
 * - Exponential-decay forecast with time-to-threshold estimation
 * - Autonomous SITREP generation with narrative summaries
 * - Operational tempo monitoring (surge/calm/oscillation)
 * - Proactive advisories with deadlines and recommended actions
 * - Full incident timeline with domain filtering
 *
 * @example
 *   var sa = createSituationAwareness();
 *   sa.ingest({ domain: 'environment', type: 'temperature_excursion', severity: 'warning', value: 28.5 });
 *   sa.ingest({ domain: 'equipment', type: 'nozzle_clog', severity: 'critical' });
 *   var picture = sa.getOperationalPicture();
 *   console.log(picture.readinessScore, picture.operationalState);
 *   var sitrep = sa.generateSITREP();
 *   console.log(sitrep.narrative);
 *
 * @module situationAwareness
 */

// ── Valid domains ──────────────────────────────────────────────────
var VALID_DOMAINS = [
    'environment', 'contamination', 'equipment', 'print_quality',
    'cell_health', 'inventory', 'protocol_compliance', 'personnel'
];

var DOMAIN_SET = {};
for (var _d = 0; _d < VALID_DOMAINS.length; _d++) {
    DOMAIN_SET[VALID_DOMAINS[_d]] = true;
}

// ── Default weights (sum to 1.0) ──────────────────────────────────
var DEFAULT_WEIGHTS = {
    environment: 0.15,
    contamination: 0.20,
    equipment: 0.15,
    print_quality: 0.15,
    cell_health: 0.15,
    inventory: 0.05,
    protocol_compliance: 0.10,
    personnel: 0.05
};

// ── Severity impact multipliers ───────────────────────────────────
var SEVERITY_IMPACT = {
    info: 0.05,
    notice: 0.15,
    warning: 0.35,
    alert: 0.60,
    critical: 0.85,
    emergency: 1.00
};

var VALID_SEVERITIES = {};
var sKeys = Object.keys(SEVERITY_IMPACT);
for (var _s = 0; _s < sKeys.length; _s++) {
    VALID_SEVERITIES[sKeys[_s]] = true;
}

// ── Operational state thresholds ──────────────────────────────────
var STATE_THRESHOLDS = [
    { min: 80, state: 'GREEN' },
    { min: 60, state: 'YELLOW' },
    { min: 40, state: 'ORANGE' },
    { min: 0,  state: 'RED' }
];

// ── Cascade rules ─────────────────────────────────────────────────
var CASCADE_RULES = [
    { source: 'equipment',           target: 'environment',          likelihood: 0.80, mechanism: 'HVAC/incubator failure causes temperature and humidity drift' },
    { source: 'environment',         target: 'contamination',        likelihood: 0.75, mechanism: 'Temperature/humidity excursions promote microbial growth' },
    { source: 'contamination',       target: 'cell_health',          likelihood: 0.85, mechanism: 'Contamination directly reduces cell viability' },
    { source: 'equipment',           target: 'print_quality',        likelihood: 0.90, mechanism: 'Equipment malfunction degrades print fidelity' },
    { source: 'personnel',           target: 'protocol_compliance',  likelihood: 0.70, mechanism: 'Staff shortage leads to protocol deviations' },
    { source: 'inventory',           target: 'protocol_compliance',  likelihood: 0.65, mechanism: 'Material shortages force protocol substitutions' },
    { source: 'cell_health',         target: 'print_quality',        likelihood: 0.60, mechanism: 'Unhealthy cells produce poor bioprinted constructs' },
    { source: 'environment',         target: 'cell_health',          likelihood: 0.70, mechanism: 'Environmental instability stresses cell cultures' },
    { source: 'protocol_compliance', target: 'contamination',        likelihood: 0.75, mechanism: 'Protocol deviations increase contamination risk' },
    { source: 'equipment',           target: 'inventory',            likelihood: 0.50, mechanism: 'Failed prints waste materials and consumables' },
    { source: 'contamination',       target: 'inventory',            likelihood: 0.55, mechanism: 'Contaminated batches require disposal and re-supply' },
    { source: 'personnel',           target: 'cell_health',          likelihood: 0.45, mechanism: 'Understaffed labs delay critical cell maintenance' }
];

// ── Pre-compute cascade lookup: source → [rules] ─────────────────
var CASCADE_BY_SOURCE = {};
for (var _c = 0; _c < CASCADE_RULES.length; _c++) {
    var rule = CASCADE_RULES[_c];
    if (!CASCADE_BY_SOURCE[rule.source]) {
        CASCADE_BY_SOURCE[rule.source] = [];
    }
    CASCADE_BY_SOURCE[rule.source].push(rule);
}

// ── Domain labels for narrative ───────────────────────────────────
var DOMAIN_LABELS = {
    environment: 'Environment',
    contamination: 'Contamination',
    equipment: 'Equipment',
    print_quality: 'Print Quality',
    cell_health: 'Cell Health',
    inventory: 'Inventory',
    protocol_compliance: 'Protocol Compliance',
    personnel: 'Personnel'
};

// ── Helpers ───────────────────────────────────────────────────────

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function classifyState(score) {
    for (var i = 0; i < STATE_THRESHOLDS.length; i++) {
        if (score >= STATE_THRESHOLDS[i].min) return STATE_THRESHOLDS[i].state;
    }
    return 'RED';
}

function severityRank(sev) {
    var ranks = { info: 0, notice: 1, warning: 2, alert: 3, critical: 4, emergency: 5 };
    return ranks[sev] !== undefined ? ranks[sev] : -1;
}

function worstSeverity(events) {
    var worst = 'info';
    var worstRank = 0;
    for (var i = 0; i < events.length; i++) {
        var r = severityRank(events[i].severity);
        if (r > worstRank) { worstRank = r; worst = events[i].severity; }
    }
    return worst;
}

// ── Factory ───────────────────────────────────────────────────────

function createSituationAwareness(opts) {
    opts = opts || {};
    var windowMs = (opts.windowMinutes || 60) * 60000;
    var decayHalfLife = (opts.decayHalfLifeMinutes || 30) * 60000;
    var correlationWindow = (opts.correlationWindowMinutes || 30) * 60000;
    var weights = {};
    var wKeys = Object.keys(DEFAULT_WEIGHTS);
    for (var w = 0; w < wKeys.length; w++) {
        weights[wKeys[w]] = (opts.weights && opts.weights[wKeys[w]] !== undefined)
            ? opts.weights[wKeys[w]]
            : DEFAULT_WEIGHTS[wKeys[w]];
    }

    // ── Internal state ────────────────────────────────────────────
    var events = [];        // all ingested events in window
    var eventIdCounter = 0;

    // ── Prune old events ──────────────────────────────────────────
    function prune(now) {
        var cutoff = now - windowMs;
        var fresh = [];
        for (var i = 0; i < events.length; i++) {
            if (events[i].timestamp >= cutoff) fresh.push(events[i]);
        }
        events = fresh;
    }

    // ── Decay factor for an event ─────────────────────────────────
    function decayFactor(eventTs, now) {
        var age = now - eventTs;
        if (age <= 0) return 1;
        return Math.pow(0.5, age / decayHalfLife);
    }

    // ── Compute domain score (100 = perfect, 0 = worst) ──────────
    function computeDomainScore(domain, now) {
        var domainEvents = [];
        for (var i = 0; i < events.length; i++) {
            if (events[i].domain === domain) domainEvents.push(events[i]);
        }
        if (domainEvents.length === 0) return 100;

        var totalImpact = 0;
        for (var j = 0; j < domainEvents.length; j++) {
            var e = domainEvents[j];
            var impact = SEVERITY_IMPACT[e.severity] || 0.05;
            var decay = decayFactor(e.timestamp, now);
            totalImpact += impact * decay;
        }
        // Each unit of impact reduces score; cap total damage at 100
        var score = 100 - clamp(totalImpact * 100, 0, 100);
        return Math.round(score * 100) / 100;
    }

    // ── Compute composite readiness score ─────────────────────────
    function computeReadiness(now) {
        var score = 0;
        for (var d = 0; d < VALID_DOMAINS.length; d++) {
            var dom = VALID_DOMAINS[d];
            var ds = computeDomainScore(dom, now);
            score += ds * (weights[dom] || 0);
        }
        return Math.round(score * 100) / 100;
    }

    // ── Compute domain trend (positive = improving) ───────────────
    function computeTrend(domain, now) {
        var domainEvents = [];
        for (var i = 0; i < events.length; i++) {
            if (events[i].domain === domain) domainEvents.push(events[i]);
        }
        if (domainEvents.length < 2) return 0;

        // Compare impact in first half vs second half of window
        var mid = now - windowMs / 2;
        var earlyImpact = 0;
        var lateImpact = 0;
        for (var j = 0; j < domainEvents.length; j++) {
            var impact = SEVERITY_IMPACT[domainEvents[j].severity] || 0.05;
            if (domainEvents[j].timestamp < mid) {
                earlyImpact += impact;
            } else {
                lateImpact += impact;
            }
        }
        // Positive = improving (less impact recently), negative = degrading
        return Math.round((earlyImpact - lateImpact) * 1000) / 1000;
    }

    // ── Domain health ─────────────────────────────────────────────
    function getDomainHealth(domain) {
        if (!DOMAIN_SET[domain]) {
            throw new Error('Invalid domain: ' + domain);
        }
        var now = Date.now();
        prune(now);
        var domainEvents = [];
        for (var i = 0; i < events.length; i++) {
            if (events[i].domain === domain) domainEvents.push(events[i]);
        }
        var lastEvent = domainEvents.length > 0 ? domainEvents[domainEvents.length - 1] : null;
        var score = computeDomainScore(domain, now);
        var trend = computeTrend(domain, now);

        // degradation rate: impact per minute over last 15 minutes
        var last15 = now - 15 * 60000;
        var recentImpact = 0;
        for (var j = 0; j < domainEvents.length; j++) {
            if (domainEvents[j].timestamp >= last15) {
                recentImpact += SEVERITY_IMPACT[domainEvents[j].severity] || 0.05;
            }
        }
        var degradationRate = Math.round(recentImpact / 15 * 1000) / 1000;

        return {
            score: score,
            events: domainEvents.length,
            trend: trend,
            lastEvent: lastEvent,
            degradationRate: degradationRate
        };
    }

    // ── Cascade detection ─────────────────────────────────────────
    function detectCascades() {
        var now = Date.now();
        prune(now);

        // Find active domains (domains with recent events)
        var activeDomains = {};
        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (now - e.timestamp <= correlationWindow) {
                if (!activeDomains[e.domain]) {
                    activeDomains[e.domain] = { worstSeverity: e.severity, worstType: e.type };
                } else if (severityRank(e.severity) > severityRank(activeDomains[e.domain].worstSeverity)) {
                    activeDomains[e.domain].worstSeverity = e.severity;
                    activeDomains[e.domain].worstType = e.type;
                }
            }
        }

        var cascades = [];
        var visited = {};

        function traceCascade(sourceDomain, chain, depth) {
            if (depth > 4) return; // prevent infinite chains
            var rules = CASCADE_BY_SOURCE[sourceDomain];
            if (!rules) return;

            for (var r = 0; r < rules.length; r++) {
                var target = rules[r].target;
                var chainKey = chain.join('→') + '→' + target;
                if (visited[chainKey]) continue;
                visited[chainKey] = true;

                // Target must also show activity or source is actively degraded
                var targetActive = !!activeDomains[target];
                var affected = {
                    domain: target,
                    likelihood: rules[r].likelihood,
                    mechanism: rules[r].mechanism,
                    confirmed: targetActive
                };

                // Only report if target is active (confirmed cascade) or source severity is alert+
                if (targetActive || severityRank(activeDomains[sourceDomain].worstSeverity) >= severityRank('alert')) {
                    cascades.push({
                        trigger: { domain: sourceDomain, type: activeDomains[sourceDomain].worstType },
                        affected: [affected],
                        severity: targetActive ? 'confirmed' : 'potential',
                        chain: chain.concat([target]),
                        recommendation: 'Address ' + DOMAIN_LABELS[sourceDomain] + ' issues to prevent downstream ' + DOMAIN_LABELS[target] + ' impact'
                    });

                    // Continue tracing if target is active
                    if (targetActive && chain.indexOf(target) === -1) {
                        traceCascade(target, chain.concat([target]), depth + 1);
                    }
                }
            }
        }

        var activeKeys = Object.keys(activeDomains);
        for (var a = 0; a < activeKeys.length; a++) {
            traceCascade(activeKeys[a], [activeKeys[a]], 0);
        }

        return cascades;
    }

    // ── Operational tempo ─────────────────────────────────────────
    function computeTempo(now) {
        prune(now);

        function countInWindow(ms) {
            var cutoff = now - ms;
            var count = 0;
            for (var i = 0; i < events.length; i++) {
                if (events[i].timestamp >= cutoff) count++;
            }
            return count;
        }

        var count5 = countInWindow(5 * 60000);
        var count15 = countInWindow(15 * 60000);
        var count60 = countInWindow(60 * 60000);

        var rate5 = count5 / 5 * 60;   // events per hour (5 min window)
        var rate15 = count15 / 15 * 60;
        var rate60 = count60;           // already per hour

        // Determine trend
        var trend = 'stable';
        var baseline = rate60 || 1;
        if (rate5 > baseline * 3) {
            trend = 'surge';
        } else if (rate5 < baseline * 0.3 && count60 > 2) {
            trend = 'calm';
        } else if (count60 >= 4) {
            // Check for oscillation: alternating severity in recent events
            var recent = [];
            var cutoff15 = now - 15 * 60000;
            for (var i = 0; i < events.length; i++) {
                if (events[i].timestamp >= cutoff15) recent.push(events[i]);
            }
            if (recent.length >= 4) {
                var flips = 0;
                for (var j = 1; j < recent.length; j++) {
                    var prevRank = severityRank(recent[j - 1].severity);
                    var curRank = severityRank(recent[j].severity);
                    if ((curRank - prevRank) * (j > 1 ? (severityRank(recent[j - 1].severity) - severityRank(recent[j - 2].severity)) : 1) < 0) {
                        flips++;
                    }
                }
                if (flips >= recent.length * 0.5) {
                    trend = 'oscillating';
                }
            }
        }

        return {
            eventsPerHour: Math.round(rate60 * 100) / 100,
            rate5min: Math.round(rate5 * 100) / 100,
            rate15min: Math.round(rate15 * 100) / 100,
            trend: trend
        };
    }

    // ── Forecast ──────────────────────────────────────────────────
    function computeForecast(now) {
        var currentScore = computeReadiness(now);
        var currentState = classifyState(currentScore);

        // Find domains with negative trends
        var degradingDomains = [];
        for (var d = 0; d < VALID_DOMAINS.length; d++) {
            var trend = computeTrend(VALID_DOMAINS[d], now);
            if (trend < 0) {
                degradingDomains.push({
                    domain: VALID_DOMAINS[d],
                    trend: trend,
                    score: computeDomainScore(VALID_DOMAINS[d], now)
                });
            }
        }

        // Estimate score decay: project impact accumulation rate forward
        var totalDegradationRate = 0;
        for (var i = 0; i < degradingDomains.length; i++) {
            var dd = degradingDomains[i];
            totalDegradationRate += Math.abs(dd.trend) * (weights[dd.domain] || 0) * 100;
        }

        // Also account for natural decay of existing events (improving)
        var decayRecoveryRate = 0;
        if (events.length > 0) {
            // Approximate: each event loses half its impact per half-life
            decayRecoveryRate = (100 - currentScore) * 0.693 / (decayHalfLife / 60000); // per minute
        }

        var netRate = totalDegradationRate - decayRecoveryRate; // positive = degrading
        var predictedScore = currentScore;
        var timeToThreshold = null;

        // Find next threshold below current score
        var nextThreshold = null;
        for (var t = 0; t < STATE_THRESHOLDS.length; t++) {
            if (STATE_THRESHOLDS[t].min < currentScore && STATE_THRESHOLDS[t].min > 0) {
                nextThreshold = STATE_THRESHOLDS[t].min;
                break;
            }
        }

        if (netRate > 0 && nextThreshold !== null) {
            var gap = currentScore - nextThreshold;
            timeToThreshold = Math.round(gap / netRate); // minutes
            predictedScore = Math.max(0, currentScore - netRate * 60); // 1 hour projection
        } else if (netRate < 0) {
            // Recovering
            predictedScore = Math.min(100, currentScore - netRate * 60);
        }

        predictedScore = Math.round(clamp(predictedScore, 0, 100) * 100) / 100;

        return {
            currentScore: currentScore,
            predictedScore: predictedScore,
            predictedState: classifyState(predictedScore),
            timeToThresholdMinutes: timeToThreshold,
            nextThreshold: nextThreshold,
            degradingDomains: degradingDomains.length,
            netRatePerMinute: Math.round(netRate * 1000) / 1000
        };
    }

    // ── Advisories ────────────────────────────────────────────────
    function getAdvisories() {
        var now = Date.now();
        prune(now);
        var advisories = [];
        var forecast = computeForecast(now);
        var cascades = detectCascades();
        var tempo = computeTempo(now);

        // Threshold crossing advisory
        if (forecast.timeToThresholdMinutes !== null && forecast.timeToThresholdMinutes <= 120) {
            advisories.push({
                priority: forecast.timeToThresholdMinutes <= 30 ? 'critical' : 'high',
                type: 'threshold_warning',
                message: 'Lab readiness projected to drop below ' + forecast.nextThreshold + ' within ' + forecast.timeToThresholdMinutes + ' minutes',
                domain: null,
                action: 'Investigate degrading domains immediately',
                deadline: new Date(now + forecast.timeToThresholdMinutes * 60000).toISOString()
            });
        }

        // Cascade advisories
        for (var c = 0; c < cascades.length; c++) {
            if (cascades[c].severity === 'confirmed') {
                advisories.push({
                    priority: 'high',
                    type: 'cascade_active',
                    message: 'Active cascade: ' + DOMAIN_LABELS[cascades[c].trigger.domain] + ' → ' + DOMAIN_LABELS[cascades[c].affected[0].domain],
                    domain: cascades[c].trigger.domain,
                    action: cascades[c].recommendation,
                    deadline: null
                });
            }
        }

        // Tempo advisory
        if (tempo.trend === 'surge') {
            advisories.push({
                priority: 'high',
                type: 'tempo_surge',
                message: 'Event rate surging (' + tempo.rate5min + ' events/hour in last 5 min vs ' + tempo.eventsPerHour + ' baseline)',
                domain: null,
                action: 'Situation escalating rapidly — assess all domains',
                deadline: null
            });
        }

        // Domain-specific advisories for critical domains
        for (var d = 0; d < VALID_DOMAINS.length; d++) {
            var domScore = computeDomainScore(VALID_DOMAINS[d], now);
            if (domScore < 40) {
                advisories.push({
                    priority: 'critical',
                    type: 'domain_critical',
                    message: DOMAIN_LABELS[VALID_DOMAINS[d]] + ' domain score critically low (' + domScore + '/100)',
                    domain: VALID_DOMAINS[d],
                    action: 'Immediate intervention required for ' + DOMAIN_LABELS[VALID_DOMAINS[d]].toLowerCase(),
                    deadline: null
                });
            } else if (domScore < 60) {
                advisories.push({
                    priority: 'medium',
                    type: 'domain_degraded',
                    message: DOMAIN_LABELS[VALID_DOMAINS[d]] + ' domain degraded (' + domScore + '/100)',
                    domain: VALID_DOMAINS[d],
                    action: 'Monitor ' + DOMAIN_LABELS[VALID_DOMAINS[d]].toLowerCase() + ' closely',
                    deadline: null
                });
            }
        }

        // Sort by priority
        var priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        advisories.sort(function (a, b) {
            var pa = priorityOrder[a.priority] !== undefined ? priorityOrder[a.priority] : 3;
            var pb = priorityOrder[b.priority] !== undefined ? priorityOrder[b.priority] : 3;
            return pa - pb;
        });

        return advisories;
    }

    // ── Timeline ──────────────────────────────────────────────────
    function getTimeline(filter) {
        var now = Date.now();
        prune(now);
        filter = filter || {};
        var result = [];
        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            if (filter.domain && e.domain !== filter.domain) continue;
            if (filter.since && e.timestamp < filter.since) continue;
            if (filter.severity && severityRank(e.severity) < severityRank(filter.severity)) continue;
            result.push({
                id: e.id,
                timestamp: e.timestamp,
                domain: e.domain,
                type: e.type,
                severity: e.severity,
                message: e.message || '',
                value: e.value !== undefined ? e.value : null
            });
        }
        return result;
    }

    // ── SITREP generation ─────────────────────────────────────────
    function generateSITREP() {
        var now = Date.now();
        prune(now);
        var score = computeReadiness(now);
        var state = classifyState(score);
        var forecast = computeForecast(now);
        var cascades = detectCascades();
        var tempo = computeTempo(now);
        var advisories = getAdvisories();

        // Domain summaries
        var domainSummaries = {};
        for (var d = 0; d < VALID_DOMAINS.length; d++) {
            var dom = VALID_DOMAINS[d];
            var domEvents = [];
            for (var i = 0; i < events.length; i++) {
                if (events[i].domain === dom) domEvents.push(events[i]);
            }
            domainSummaries[dom] = {
                score: computeDomainScore(dom, now),
                eventCount: domEvents.length,
                worstSeverity: domEvents.length > 0 ? worstSeverity(domEvents) : 'none',
                trend: computeTrend(dom, now)
            };
        }

        // Build narrative
        var narrative = 'Lab readiness is ' + state + ' (score: ' + Math.round(score) + '/100). ';

        // Find primary concern (lowest scoring domain with events)
        var worstDomain = null;
        var worstScore = 101;
        var domKeys = Object.keys(domainSummaries);
        for (var k = 0; k < domKeys.length; k++) {
            var ds = domainSummaries[domKeys[k]];
            if (ds.eventCount > 0 && ds.score < worstScore) {
                worstScore = ds.score;
                worstDomain = domKeys[k];
            }
        }

        if (worstDomain) {
            var ws = domainSummaries[worstDomain];
            narrative += 'Primary concern: ' + DOMAIN_LABELS[worstDomain] + ' domain';
            // Find the most severe recent event for context
            var domEvts = [];
            for (var m = 0; m < events.length; m++) {
                if (events[m].domain === worstDomain) domEvts.push(events[m]);
            }
            if (domEvts.length > 0) {
                var latestEvt = domEvts[domEvts.length - 1];
                narrative += ' (' + (latestEvt.type || 'issue').replace(/_/g, ' ');
                if (latestEvt.value !== undefined) {
                    narrative += ': ' + latestEvt.value;
                    if (latestEvt.threshold !== undefined) {
                        narrative += ', threshold ' + latestEvt.threshold;
                    }
                }
                narrative += ')';
            }
            narrative += ' with score ' + Math.round(ws.score) + '/100. ';
        } else {
            narrative += 'All domains stable with no active events. ';
        }

        // Cascade info
        var confirmedCascades = [];
        for (var cc = 0; cc < cascades.length; cc++) {
            if (cascades[cc].severity === 'confirmed') confirmedCascades.push(cascades[cc]);
        }
        if (confirmedCascades.length > 0) {
            narrative += confirmedCascades.length + ' active cascade(s) detected. ';
        }

        // Tempo
        if (tempo.trend === 'surge') {
            narrative += 'Event rate is surging — situation escalating rapidly. ';
        } else if (tempo.trend === 'oscillating') {
            narrative += 'Conditions are oscillating — intermittent instability. ';
        }

        // Forecast
        if (forecast.timeToThresholdMinutes !== null) {
            narrative += 'Forecast: Without intervention, readiness will drop to ' +
                classifyState(forecast.nextThreshold - 1) + ' within approximately ' +
                forecast.timeToThresholdMinutes + ' minutes. ';
        }

        // Recommendations from advisories
        if (advisories.length > 0) {
            narrative += 'Top recommendation: ' + advisories[0].action + '.';
        }

        return {
            timestamp: now,
            readinessScore: score,
            operationalState: state,
            narrative: narrative,
            domainSummaries: domainSummaries,
            activeIncidents: events.length,
            activeCascades: confirmedCascades.length,
            advisories: advisories,
            recommendations: advisories.map(function (a) { return a.action; }),
            tempo: tempo,
            forecast: forecast
        };
    }

    // ── Operational picture ───────────────────────────────────────
    function getOperationalPicture() {
        var now = Date.now();
        prune(now);
        var score = computeReadiness(now);
        var state = classifyState(score);
        var domains = {};
        for (var d = 0; d < VALID_DOMAINS.length; d++) {
            var dom = VALID_DOMAINS[d];
            var domEvents = [];
            for (var i = 0; i < events.length; i++) {
                if (events[i].domain === dom) domEvents.push(events[i]);
            }
            domains[dom] = {
                score: computeDomainScore(dom, now),
                eventCount: domEvents.length,
                worstSeverity: domEvents.length > 0 ? worstSeverity(domEvents) : 'none',
                trend: computeTrend(dom, now)
            };
        }

        return {
            readinessScore: score,
            operationalState: state,
            domains: domains,
            cascades: detectCascades(),
            tempo: computeTempo(now),
            forecast: computeForecast(now),
            timeline: getTimeline()
        };
    }

    // ── Export ─────────────────────────────────────────────────────
    function exportData() {
        var now = Date.now();
        prune(now);
        return {
            config: {
                windowMinutes: windowMs / 60000,
                decayHalfLifeMinutes: decayHalfLife / 60000,
                correlationWindowMinutes: correlationWindow / 60000,
                weights: JSON.parse(JSON.stringify(weights))
            },
            events: events.map(function (e) {
                return {
                    id: e.id,
                    timestamp: e.timestamp,
                    domain: e.domain,
                    type: e.type,
                    severity: e.severity,
                    message: e.message,
                    value: e.value,
                    threshold: e.threshold
                };
            }),
            operationalPicture: getOperationalPicture()
        };
    }

    // ── Public API ────────────────────────────────────────────────
    return {
        /**
         * Ingest a lab event.
         * @param {Object} event - { domain, type, severity, message?, value?, threshold?, timestamp? }
         */
        ingest: function ingest(event) {
            if (!event || typeof event !== 'object') {
                throw new Error('Event must be a non-null object');
            }
            if (!event.domain || !DOMAIN_SET[event.domain]) {
                throw new Error('Invalid or missing domain. Valid: ' + VALID_DOMAINS.join(', '));
            }
            if (!event.type || typeof event.type !== 'string') {
                throw new Error('Event type is required and must be a string');
            }
            var sev = event.severity || 'info';
            if (!VALID_SEVERITIES[sev]) {
                throw new Error('Invalid severity: ' + sev + '. Valid: ' + sKeys.join(', '));
            }

            var now = Date.now();
            events.push({
                id: ++eventIdCounter,
                timestamp: event.timestamp || now,
                domain: event.domain,
                type: event.type,
                severity: sev,
                message: event.message || '',
                value: event.value !== undefined ? event.value : undefined,
                threshold: event.threshold !== undefined ? event.threshold : undefined
            });

            prune(now);
        },

        getOperationalPicture: getOperationalPicture,
        generateSITREP: generateSITREP,
        detectCascades: detectCascades,
        getAdvisories: getAdvisories,
        getTimeline: getTimeline,
        getDomainHealth: getDomainHealth,
        exportData: exportData,

        /**
         * Reset all state.
         */
        reset: function reset() {
            events = [];
            eventIdCounter = 0;
        }
    };
}

module.exports = { createSituationAwareness: createSituationAwareness };
