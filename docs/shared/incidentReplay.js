'use strict';

var round = require('./validation').round;
var _isDangerousKey = require('./sanitize').isDangerousKey;

/**
 * Lab Incident Replay Engine
 *
 * Autonomous forensic investigation module for bioprinting lab incidents.
 * Reconstructs incident timelines from disparate data sources, correlates
 * evidence across temporal and causal dimensions, identifies root causes,
 * and generates preventive recommendations.
 *
 * Agentic capabilities:
 * - Evidence ingestion from 6+ source types (print logs, environmental,
 *   quality metrics, equipment, operator actions, contamination reports)
 * - Autonomous timeline reconstruction with cluster detection and gap analysis
 * - 6 investigation engines: temporal proximity, causal chain detection,
 *   pattern matching, contributing factor ranking, anomaly spotting, gap analysis
 * - Root-cause verdict generation with confidence scoring
 * - Preventive recommendation engine with prioritized action plans
 * - Severity classification (LOW / MEDIUM / HIGH / CRITICAL)
 *
 * @example
 *   var engine = createIncidentReplay();
 *   engine.addEvidence({ source: 'print_log', timestamp: '2026-04-28T14:00:00Z',
 *       type: 'parameter_change', data: { parameter: 'temperature', value: 42, unit: 'C' } });
 *   engine.addEvidence({ source: 'quality', timestamp: '2026-04-28T14:30:00Z',
 *       type: 'excursion', data: { metric: 'cell_viability', value: 62, expected: 95, unit: '%' } });
 *   var report = engine.investigate({ incidentType: 'viability_drop', incidentTime: '2026-04-28T14:30:00Z' });
 *   // report.verdict.rootCause, report.severity, report.recommendations
 */

// ── Severity levels ────────────────────────────────────────────────

var SEVERITY = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' };

// ── Valid source types ─────────────────────────────────────────────

var VALID_SOURCES = [
    'print_log', 'environmental', 'quality', 'equipment',
    'operator', 'contamination', 'material', 'protocol'
];

// ── Known incident patterns ────────────────────────────────────────

var BUILT_IN_PATTERNS = [
    {
        name: 'contamination_event',
        label: 'Contamination Event',
        signature: {
            sources: ['environmental', 'contamination', 'quality'],
            keywords: ['humidity', 'temperature', 'viability', 'contamination', 'colony'],
            typicalSequence: ['environmental_change', 'contamination_detected', 'quality_drop']
        },
        recommendations: [
            { action: 'Review HEPA filter status and cleanroom classification', priority: 'HIGH', rationale: 'Environmental breach is the most common contamination vector' },
            { action: 'Audit aseptic technique for last 48 hours', priority: 'HIGH', rationale: 'Operator actions during the incident window may reveal protocol breaks' },
            { action: 'Quarantine affected samples and run mycoplasma testing', priority: 'CRITICAL', rationale: 'Prevent spread to uncontaminated batches' },
            { action: 'Calibrate environmental sensors', priority: 'MEDIUM', rationale: 'Ensure monitoring accuracy for future detection' }
        ]
    },
    {
        name: 'equipment_failure',
        label: 'Equipment Failure',
        signature: {
            sources: ['equipment', 'print_log', 'quality'],
            keywords: ['error', 'fault', 'drift', 'failure', 'malfunction', 'timeout'],
            typicalSequence: ['parameter_drift', 'error_code', 'quality_drop']
        },
        recommendations: [
            { action: 'Run full equipment diagnostic and calibration cycle', priority: 'HIGH', rationale: 'Equipment drift preceded the quality excursion' },
            { action: 'Review maintenance logs for overdue service items', priority: 'MEDIUM', rationale: 'Preventive maintenance gaps correlate with failure events' },
            { action: 'Implement real-time equipment health monitoring alerts', priority: 'MEDIUM', rationale: 'Earlier detection would reduce impact severity' }
        ]
    },
    {
        name: 'operator_error',
        label: 'Operator Error',
        signature: {
            sources: ['operator', 'print_log', 'quality'],
            keywords: ['manual', 'override', 'out_of_range', 'skip', 'incorrect', 'wrong'],
            typicalSequence: ['manual_action', 'parameter_excursion', 'quality_drop']
        },
        recommendations: [
            { action: 'Conduct retraining session on affected protocol steps', priority: 'HIGH', rationale: 'Operator actions directly caused parameter excursion' },
            { action: 'Add confirmation prompts for critical parameter overrides', priority: 'MEDIUM', rationale: 'Prevent inadvertent manual overrides' },
            { action: 'Review SOP clarity for the affected procedure', priority: 'MEDIUM', rationale: 'Ambiguous instructions may have contributed' }
        ]
    },
    {
        name: 'environmental_excursion',
        label: 'Environmental Excursion',
        signature: {
            sources: ['environmental'],
            keywords: ['temperature', 'humidity', 'co2', 'pressure', 'out_of_range'],
            typicalSequence: ['environmental_change', 'threshold_breach']
        },
        recommendations: [
            { action: 'Inspect HVAC system and environmental controls', priority: 'HIGH', rationale: 'Environmental parameters exceeded acceptable range' },
            { action: 'Verify backup environmental systems are operational', priority: 'MEDIUM', rationale: 'Redundancy prevents future excursions' },
            { action: 'Tighten alert thresholds for earlier warning', priority: 'LOW', rationale: 'Earlier alerts reduce exposure duration' }
        ]
    },
    {
        name: 'material_defect',
        label: 'Material Defect',
        signature: {
            sources: ['material', 'print_log', 'quality'],
            keywords: ['viscosity', 'lot', 'batch', 'consistency', 'degraded', 'expired'],
            typicalSequence: ['material_anomaly', 'print_quality_issue']
        },
        recommendations: [
            { action: 'Quarantine affected material lot and run QC testing', priority: 'HIGH', rationale: 'Material properties deviated from specifications' },
            { action: 'Contact supplier with lot number and defect details', priority: 'MEDIUM', rationale: 'Supplier corrective action may prevent future defects' },
            { action: 'Implement incoming material QC testing protocol', priority: 'MEDIUM', rationale: 'Catch defects before they enter production' }
        ]
    },
    {
        name: 'protocol_deviation',
        label: 'Protocol Deviation',
        signature: {
            sources: ['protocol', 'operator', 'print_log'],
            keywords: ['deviation', 'sequence', 'skip', 'order', 'missing_step', 'unauthorized'],
            typicalSequence: ['step_deviation', 'unexpected_outcome']
        },
        recommendations: [
            { action: 'Document deviation and assess impact on product quality', priority: 'HIGH', rationale: 'Protocol deviations require formal assessment per GMP' },
            { action: 'Review protocol for ambiguous or error-prone steps', priority: 'MEDIUM', rationale: 'Improve protocol design to reduce deviation risk' },
            { action: 'Implement electronic protocol enforcement with step verification', priority: 'LOW', rationale: 'Automated enforcement prevents sequence errors' }
        ]
    },
    {
        name: 'nozzle_clog',
        label: 'Nozzle Clog',
        signature: {
            sources: ['equipment', 'print_log'],
            keywords: ['pressure', 'flow_rate', 'clog', 'under_extrusion', 'blockage', 'nozzle'],
            typicalSequence: ['pressure_increase', 'flow_decrease', 'extrusion_failure']
        },
        recommendations: [
            { action: 'Perform nozzle cleaning or replacement', priority: 'HIGH', rationale: 'Pressure/flow data indicates partial or full blockage' },
            { action: 'Review bioink preparation for particulate or clump formation', priority: 'MEDIUM', rationale: 'Material preparation issues are common clog causes' },
            { action: 'Reduce pre-print idle time to prevent material gelation in nozzle', priority: 'LOW', rationale: 'Extended idle periods allow crosslinking in the nozzle' }
        ]
    },
    {
        name: 'cross_contamination',
        label: 'Cross-Contamination',
        signature: {
            sources: ['contamination', 'operator', 'quality'],
            keywords: ['cross', 'proximity', 'transfer', 'shared', 'multi_sample', 'marker'],
            typicalSequence: ['sample_proximity', 'contamination_marker', 'identity_mismatch']
        },
        recommendations: [
            { action: 'Implement physical separation between active sample processing areas', priority: 'HIGH', rationale: 'Proximity between samples increases cross-contamination risk' },
            { action: 'Enforce single-sample-at-a-time protocols for critical steps', priority: 'HIGH', rationale: 'Reduce opportunity for sample mix-up' },
            { action: 'Add unique barcode verification at each transfer step', priority: 'MEDIUM', rationale: 'Automated identity checks catch errors at point of transfer' }
        ]
    }
];

// ── Helper: parse timestamp ────────────────────────────────────────

function parseTs(ts) {
    if (typeof ts === 'number') return ts;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return NaN;
    return d.getTime();
}

// ── Helper: z-score ────────────────────────────────────────────────

function zScore(value, mean, stddev) {
    if (stddev === 0) return 0;
    return (value - mean) / stddev;
}

// ── Helper: mean & stddev ──────────────────────────────────────────

function computeStats(values) {
    if (!values || values.length === 0) return { mean: 0, stddev: 0 };
    var sum = 0;
    for (var i = 0; i < values.length; i++) sum += values[i];
    var mean = sum / values.length;
    var sqSum = 0;
    for (var j = 0; j < values.length; j++) sqSum += (values[j] - mean) * (values[j] - mean);
    var stddev = Math.sqrt(sqSum / values.length);
    return { mean: round(mean, 4), stddev: round(stddev, 4) };
}

// ── Helper: keyword match score ────────────────────────────────────

function keywordMatchScore(text, keywords) {
    if (!text || !keywords || keywords.length === 0) return 0;
    var lower = text.toLowerCase();
    var hits = 0;
    for (var i = 0; i < keywords.length; i++) {
        if (lower.indexOf(keywords[i].toLowerCase()) !== -1) hits++;
    }
    return hits / keywords.length;
}

// ── Helper: flatten evidence text ──────────────────────────────────

function evidenceText(ev) {
    var parts = [ev.source || '', ev.type || ''];
    if (ev.data) {
        var keys = Object.keys(ev.data);
        for (var i = 0; i < keys.length; i++) {
            parts.push(keys[i]);
            parts.push(String(ev.data[keys[i]]));
        }
    }
    if (ev.description) parts.push(ev.description);
    return parts.join(' ');
}

// ── Helper: safe deep clone for data ───────────────────────────────

function safeClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        var arr = [];
        for (var i = 0; i < obj.length; i++) arr.push(safeClone(obj[i]));
        return arr;
    }
    var copy = {};
    var keys = Object.keys(obj);
    for (var j = 0; j < keys.length; j++) {
        if (!_isDangerousKey(keys[j])) {
            copy[keys[j]] = safeClone(obj[keys[j]]);
        }
    }
    return copy;
}

// ── Factory ────────────────────────────────────────────────────────

function createIncidentReplay() {
    var evidence = [];
    var customPatterns = [];

    // ── Evidence validation ────────────────────────────────────────

    function validateEvidence(ev) {
        if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
            return { valid: false, reason: 'Evidence must be a non-null object' };
        }
        if (_isDangerousKey(ev.source) || _isDangerousKey(ev.type)) {
            return { valid: false, reason: 'Dangerous key detected in evidence' };
        }
        if (!ev.timestamp) {
            return { valid: false, reason: 'Evidence must have a timestamp' };
        }
        if (isNaN(parseTs(ev.timestamp))) {
            return { valid: false, reason: 'Invalid timestamp: ' + ev.timestamp };
        }
        if (!ev.source || typeof ev.source !== 'string') {
            return { valid: false, reason: 'Evidence must have a string source' };
        }
        if (ev.data && typeof ev.data === 'object') {
            var dk = Object.keys(ev.data);
            for (var i = 0; i < dk.length; i++) {
                if (_isDangerousKey(dk[i])) {
                    return { valid: false, reason: 'Dangerous key in evidence data: ' + dk[i] };
                }
            }
        }
        return { valid: true };
    }

    // ── Add evidence ───────────────────────────────────────────────

    function addEvidence(ev) {
        var check = validateEvidence(ev);
        if (!check.valid) {
            return { added: false, reason: check.reason };
        }
        var entry = {
            id: evidence.length + 1,
            source: ev.source,
            timestamp: ev.timestamp,
            ts: parseTs(ev.timestamp),
            type: ev.type || 'unknown',
            data: ev.data ? safeClone(ev.data) : {},
            description: ev.description || ''
        };
        evidence.push(entry);
        return { added: true, id: entry.id };
    }

    // ── Load bulk evidence ─────────────────────────────────────────

    function loadEvidence(items) {
        if (!Array.isArray(items)) return { loaded: 0, errors: ['Input must be an array'] };
        var loaded = 0;
        var errors = [];
        for (var i = 0; i < items.length; i++) {
            var result = addEvidence(items[i]);
            if (result.added) {
                loaded++;
            } else {
                errors.push('Item ' + i + ': ' + result.reason);
            }
        }
        return { loaded: loaded, errors: errors };
    }

    // ── Get sorted timeline ────────────────────────────────────────

    function getTimeline() {
        var sorted = evidence.slice().sort(function (a, b) { return a.ts - b.ts; });
        return sorted.map(function (ev) {
            return {
                id: ev.id,
                timestamp: ev.timestamp,
                source: ev.source,
                type: ev.type,
                data: safeClone(ev.data),
                description: ev.description
            };
        });
    }

    // ── Engine 1: Temporal Proximity Analyzer ──────────────────────

    function analyzeTemporalProximity(sorted, windowMs) {
        if (sorted.length < 2) return [];
        var clusters = [];
        var current = [sorted[0]];

        for (var i = 1; i < sorted.length; i++) {
            if (sorted[i].ts - current[current.length - 1].ts <= windowMs) {
                current.push(sorted[i]);
            } else {
                if (current.length >= 2) {
                    clusters.push({
                        startTime: current[0].timestamp,
                        endTime: current[current.length - 1].timestamp,
                        durationMs: current[current.length - 1].ts - current[0].ts,
                        eventCount: current.length,
                        events: current.map(function (e) { return e.id; }),
                        sources: uniqueValues(current, 'source')
                    });
                }
                current = [sorted[i]];
            }
        }
        if (current.length >= 2) {
            clusters.push({
                startTime: current[0].timestamp,
                endTime: current[current.length - 1].timestamp,
                durationMs: current[current.length - 1].ts - current[0].ts,
                eventCount: current.length,
                events: current.map(function (e) { return e.id; }),
                sources: uniqueValues(current, 'source')
            });
        }
        return clusters;
    }

    function uniqueValues(arr, key) {
        var seen = {};
        var result = [];
        for (var i = 0; i < arr.length; i++) {
            var v = arr[i][key];
            if (!seen[v]) { seen[v] = true; result.push(v); }
        }
        return result;
    }

    // ── Engine 2: Causal Chain Detector ────────────────────────────

    function detectCausalChains(sorted) {
        if (sorted.length < 2) return [];
        var chains = [];
        // Look for known causal pairs
        var causalPairs = [
            { cause: 'temperature', effect: 'viability', label: 'Temperature change → Viability impact' },
            { cause: 'humidity', effect: 'contamination', label: 'Humidity change → Contamination risk' },
            { cause: 'pressure', effect: 'flow_rate', label: 'Pressure change → Flow rate impact' },
            { cause: 'viscosity', effect: 'extrusion', label: 'Viscosity change → Extrusion issue' },
            { cause: 'error', effect: 'quality', label: 'Equipment error → Quality impact' },
            { cause: 'override', effect: 'excursion', label: 'Manual override → Parameter excursion' },
            { cause: 'drift', effect: 'quality', label: 'Parameter drift → Quality degradation' },
            { cause: 'clog', effect: 'under_extrusion', label: 'Nozzle clog → Under-extrusion' }
        ];

        for (var p = 0; p < causalPairs.length; p++) {
            var pair = causalPairs[p];
            var causeEvents = [];
            var effectEvents = [];

            for (var i = 0; i < sorted.length; i++) {
                var text = evidenceText(sorted[i]);
                if (text.toLowerCase().indexOf(pair.cause) !== -1) causeEvents.push(sorted[i]);
                if (text.toLowerCase().indexOf(pair.effect) !== -1) effectEvents.push(sorted[i]);
            }

            for (var c = 0; c < causeEvents.length; c++) {
                for (var e = 0; e < effectEvents.length; e++) {
                    if (effectEvents[e].ts > causeEvents[c].ts) {
                        var delayMs = effectEvents[e].ts - causeEvents[c].ts;
                        chains.push({
                            label: pair.label,
                            causeEvent: causeEvents[c].id,
                            effectEvent: effectEvents[e].id,
                            delayMs: delayMs,
                            delayMinutes: round(delayMs / 60000, 1),
                            strength: round(Math.max(0, 1 - delayMs / 3600000), 2) // decays over 1hr
                        });
                    }
                }
            }
        }

        // Sort by strength desc
        chains.sort(function (a, b) { return b.strength - a.strength; });
        return chains;
    }

    // ── Engine 3: Pattern Matcher ──────────────────────────────────

    function matchPatterns(sorted) {
        var allPatterns = BUILT_IN_PATTERNS.concat(customPatterns);
        if (allPatterns.length === 0 || sorted.length === 0) return [];

        var evidenceSources = {};
        var allText = '';
        for (var i = 0; i < sorted.length; i++) {
            evidenceSources[sorted[i].source] = true;
            allText += ' ' + evidenceText(sorted[i]);
        }

        var matches = [];
        for (var p = 0; p < allPatterns.length; p++) {
            var pattern = allPatterns[p];
            var sig = pattern.signature;

            // Source overlap score
            var sourceHits = 0;
            if (sig.sources) {
                for (var s = 0; s < sig.sources.length; s++) {
                    if (evidenceSources[sig.sources[s]]) sourceHits++;
                }
            }
            var sourceScore = sig.sources && sig.sources.length > 0 ? sourceHits / sig.sources.length : 0;

            // Keyword match score
            var kwScore = sig.keywords ? keywordMatchScore(allText, sig.keywords) : 0;

            // Combined similarity
            var similarity = round((sourceScore * 0.4 + kwScore * 0.6), 2);

            if (similarity > 0.1) {
                matches.push({
                    pattern: pattern.name,
                    label: pattern.label,
                    similarity: similarity,
                    sourceOverlap: round(sourceScore, 2),
                    keywordMatch: round(kwScore, 2),
                    recommendations: pattern.recommendations || []
                });
            }
        }

        matches.sort(function (a, b) { return b.similarity - a.similarity; });
        return matches;
    }

    // ── Engine 4: Contributing Factor Ranker ───────────────────────

    function rankContributingFactors(sorted, incidentTs) {
        if (sorted.length === 0) return [];

        var factors = [];
        for (var i = 0; i < sorted.length; i++) {
            var ev = sorted[i];
            var timeDelta = Math.abs(ev.ts - incidentTs);
            var temporalScore = round(Math.max(0, 1 - timeDelta / 7200000), 2); // decays over 2hr

            // Causal relevance: events before incident score higher
            var causalBonus = ev.ts < incidentTs ? 0.2 : 0;

            // Source weight: quality and equipment sources get slight boost
            var sourceWeight = 0;
            if (ev.source === 'quality' || ev.source === 'equipment') sourceWeight = 0.1;
            if (ev.source === 'contamination') sourceWeight = 0.15;

            // Excursion events get a boost
            var typeBonus = 0;
            if (ev.type === 'excursion' || ev.type === 'error' || ev.type === 'fault') typeBonus = 0.15;

            var score = round(Math.min(1, temporalScore + causalBonus + sourceWeight + typeBonus), 2);

            factors.push({
                evidenceId: ev.id,
                timestamp: ev.timestamp,
                source: ev.source,
                type: ev.type,
                score: score,
                temporalScore: temporalScore,
                description: ev.description || evidenceText(ev).substring(0, 100)
            });
        }

        factors.sort(function (a, b) { return b.score - a.score; });
        return factors;
    }

    // ── Engine 5: Anomaly Spotter ──────────────────────────────────

    function spotAnomalies(sorted, threshold) {
        threshold = threshold || 2.0; // z-score threshold
        var anomalies = [];

        // Group numeric values by parameter/metric name
        var groups = {};
        for (var i = 0; i < sorted.length; i++) {
            var ev = sorted[i];
            if (!ev.data) continue;
            var keys = Object.keys(ev.data);
            for (var k = 0; k < keys.length; k++) {
                var key = keys[k];
                if (key === 'unit' || key === 'units') continue;
                var val = ev.data[key];
                if (typeof val === 'number') {
                    if (!groups[key]) groups[key] = [];
                    groups[key].push({ value: val, event: ev });
                }
            }
        }

        var groupKeys = Object.keys(groups);
        for (var g = 0; g < groupKeys.length; g++) {
            var gk = groupKeys[g];
            var items = groups[gk];
            if (items.length < 3) continue; // need enough data for stats

            var vals = items.map(function (it) { return it.value; });
            var stats = computeStats(vals);

            for (var j = 0; j < items.length; j++) {
                var z = zScore(items[j].value, stats.mean, stats.stddev);
                if (Math.abs(z) >= threshold) {
                    anomalies.push({
                        parameter: gk,
                        value: items[j].value,
                        mean: stats.mean,
                        stddev: stats.stddev,
                        zScore: round(z, 2),
                        evidenceId: items[j].event.id,
                        timestamp: items[j].event.timestamp,
                        severity: Math.abs(z) >= 3 ? 'HIGH' : 'MEDIUM'
                    });
                }
            }
        }

        anomalies.sort(function (a, b) { return Math.abs(b.zScore) - Math.abs(a.zScore); });
        return anomalies;
    }

    // ── Engine 6: Gap Analyzer ─────────────────────────────────────

    function analyzeGaps(sorted, expectedIntervalMs) {
        expectedIntervalMs = expectedIntervalMs || 300000; // default 5 min
        if (sorted.length < 2) return [];

        var gaps = [];
        for (var i = 1; i < sorted.length; i++) {
            var delta = sorted[i].ts - sorted[i - 1].ts;
            if (delta > expectedIntervalMs * 3) { // gap = 3x expected interval
                gaps.push({
                    startTime: sorted[i - 1].timestamp,
                    endTime: sorted[i].timestamp,
                    durationMs: delta,
                    durationMinutes: round(delta / 60000, 1),
                    beforeEvent: sorted[i - 1].id,
                    afterEvent: sorted[i].id,
                    ratio: round(delta / expectedIntervalMs, 1),
                    possibleCause: delta > expectedIntervalMs * 10
                        ? 'Possible sensor failure or system outage'
                        : 'Data collection interruption'
                });
            }
        }
        return gaps;
    }

    // ── Severity classifier ────────────────────────────────────────

    function classifySeverity(factors, anomalies, patternMatches) {
        var score = 0;

        // High-scoring contributing factors
        if (factors.length > 0 && factors[0].score > 0.8) score += 2;
        else if (factors.length > 0 && factors[0].score > 0.5) score += 1;

        // Number of anomalies
        if (anomalies.length >= 5) score += 3;
        else if (anomalies.length >= 3) score += 2;
        else if (anomalies.length >= 1) score += 1;

        // High anomaly severity
        for (var i = 0; i < anomalies.length; i++) {
            if (anomalies[i].severity === 'HIGH') { score += 1; break; }
        }

        // Strong pattern match
        if (patternMatches.length > 0 && patternMatches[0].similarity > 0.7) score += 2;
        else if (patternMatches.length > 0 && patternMatches[0].similarity > 0.4) score += 1;

        // Multi-source evidence
        var sources = {};
        for (var j = 0; j < evidence.length; j++) sources[evidence[j].source] = true;
        var sourceCount = Object.keys(sources).length;
        if (sourceCount >= 4) score += 1;

        if (score >= 7) return SEVERITY.CRITICAL;
        if (score >= 5) return SEVERITY.HIGH;
        if (score >= 3) return SEVERITY.MEDIUM;
        return SEVERITY.LOW;
    }

    // ── Verdict generator ──────────────────────────────────────────

    function generateVerdict(factors, causalChains, patternMatches, anomalies) {
        var rootCause = 'Undetermined';
        var category = 'unknown';
        var confidence = 0;
        var evidenceChain = [];

        // Use top pattern match for category
        if (patternMatches.length > 0) {
            category = patternMatches[0].pattern;
            confidence += patternMatches[0].similarity * 0.4;
        }

        // Use top causal chain for root cause description
        if (causalChains.length > 0) {
            rootCause = causalChains[0].label;
            confidence += causalChains[0].strength * 0.3;
            evidenceChain.push(causalChains[0].causeEvent);
            evidenceChain.push(causalChains[0].effectEvent);
        } else if (factors.length > 0) {
            rootCause = 'Primary contributing factor: ' + factors[0].source + ' ' + factors[0].type;
            confidence += factors[0].score * 0.2;
        }

        // Anomalies boost confidence
        if (anomalies.length > 0) {
            confidence += Math.min(0.2, anomalies.length * 0.05);
        }

        // More evidence = more confidence
        if (evidence.length >= 5) confidence += 0.1;

        confidence = round(Math.min(1, confidence), 2);

        // Add top contributing factors to evidence chain
        for (var i = 0; i < Math.min(3, factors.length); i++) {
            if (evidenceChain.indexOf(factors[i].evidenceId) === -1) {
                evidenceChain.push(factors[i].evidenceId);
            }
        }

        return {
            rootCause: rootCause,
            category: category,
            confidence: confidence,
            evidenceChain: evidenceChain
        };
    }

    // ── Recommendation generator ───────────────────────────────────

    function generateRecommendations(patternMatches, anomalies, gaps) {
        var recs = [];
        var seen = {};

        // Pull from top pattern match
        if (patternMatches.length > 0) {
            var topRecs = patternMatches[0].recommendations || [];
            for (var i = 0; i < topRecs.length; i++) {
                if (!seen[topRecs[i].action]) {
                    recs.push({
                        action: topRecs[i].action,
                        priority: topRecs[i].priority,
                        rationale: topRecs[i].rationale
                    });
                    seen[topRecs[i].action] = true;
                }
            }
        }

        // Add anomaly-specific recommendations
        if (anomalies.length > 0) {
            var anomalyRec = 'Investigate anomalous readings in: ' +
                anomalies.slice(0, 3).map(function (a) { return a.parameter; }).join(', ');
            if (!seen[anomalyRec]) {
                recs.push({ action: anomalyRec, priority: 'HIGH', rationale: 'Z-score analysis detected significant deviations from baseline' });
                seen[anomalyRec] = true;
            }
        }

        // Add gap-specific recommendations
        if (gaps.length > 0) {
            var gapRec = 'Address ' + gaps.length + ' data gap(s) — longest: ' +
                round(Math.max.apply(null, gaps.map(function (g) { return g.durationMinutes; })), 1) + ' minutes';
            if (!seen[gapRec]) {
                recs.push({ action: gapRec, priority: 'MEDIUM', rationale: 'Data gaps may conceal additional contributing factors' });
                seen[gapRec] = true;
            }
        }

        // Generic recommendation if nothing matched
        if (recs.length === 0) {
            recs.push({
                action: 'Collect additional evidence and re-run investigation',
                priority: 'MEDIUM',
                rationale: 'Insufficient evidence to determine specific root cause'
            });
        }

        // Sort by priority
        var priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        recs.sort(function (a, b) {
            return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
        });

        return recs;
    }

    // ── Summary generator ──────────────────────────────────────────

    function generateSummary(verdict, severity, factors, anomalies, gaps, timeline) {
        var lines = [];
        lines.push('Incident Investigation Report');
        lines.push('Severity: ' + severity);
        lines.push('Root Cause: ' + verdict.rootCause + ' (confidence: ' + round(verdict.confidence * 100, 0) + '%)');
        lines.push('Category: ' + verdict.category);
        lines.push('Evidence analyzed: ' + timeline.length + ' events');
        if (factors.length > 0) {
            lines.push('Top contributing factor: ' + factors[0].source + ' ' + factors[0].type +
                        ' (score: ' + factors[0].score + ')');
        }
        if (anomalies.length > 0) {
            lines.push('Anomalies detected: ' + anomalies.length);
        }
        if (gaps.length > 0) {
            lines.push('Data gaps found: ' + gaps.length);
        }
        return lines.join('\n');
    }

    // ── Main investigate function ──────────────────────────────────

    function investigate(options) {
        options = options || {};
        var incidentTime = options.incidentTime ? parseTs(options.incidentTime) : Date.now();
        var windowMs = options.windowMs || 600000; // 10 min default cluster window
        var anomalyThreshold = options.anomalyThreshold || 2.0;
        var expectedIntervalMs = options.expectedIntervalMs || 300000;

        var sorted = evidence.slice().sort(function (a, b) { return a.ts - b.ts; });
        var timeline = getTimeline();

        var temporalClusters = analyzeTemporalProximity(sorted, windowMs);
        var causalChains = detectCausalChains(sorted);
        var patternMatches = matchPatterns(sorted);
        var contributingFactors = rankContributingFactors(sorted, incidentTime);
        var anomalies = spotAnomalies(sorted, anomalyThreshold);
        var gaps = analyzeGaps(sorted, expectedIntervalMs);

        var severity = classifySeverity(contributingFactors, anomalies, patternMatches);
        var verdict = generateVerdict(contributingFactors, causalChains, patternMatches, anomalies);
        var recommendations = generateRecommendations(patternMatches, anomalies, gaps);
        var summary = generateSummary(verdict, severity, contributingFactors, anomalies, gaps, timeline);

        return {
            timeline: timeline,
            temporalClusters: temporalClusters,
            causalChains: causalChains,
            patternMatches: patternMatches,
            contributingFactors: contributingFactors,
            anomalies: anomalies,
            gaps: gaps,
            verdict: verdict,
            severity: severity,
            recommendations: recommendations,
            summary: summary,
            evidenceCount: evidence.length,
            enginesRun: 6
        };
    }

    // ── Register custom pattern ────────────────────────────────────

    function registerPattern(pattern) {
        if (!pattern || typeof pattern !== 'object') {
            return { registered: false, reason: 'Pattern must be an object' };
        }
        if (!pattern.name || typeof pattern.name !== 'string') {
            return { registered: false, reason: 'Pattern must have a string name' };
        }
        if (_isDangerousKey(pattern.name)) {
            return { registered: false, reason: 'Dangerous pattern name' };
        }
        if (!pattern.signature || typeof pattern.signature !== 'object') {
            return { registered: false, reason: 'Pattern must have a signature object' };
        }
        customPatterns.push({
            name: pattern.name,
            label: pattern.label || pattern.name,
            signature: safeClone(pattern.signature),
            recommendations: pattern.recommendations ? safeClone(pattern.recommendations) : []
        });
        return { registered: true, name: pattern.name };
    }

    // ── Reset ──────────────────────────────────────────────────────

    function reset() {
        evidence = [];
        customPatterns = [];
    }

    // ── Public API ─────────────────────────────────────────────────

    return {
        addEvidence: addEvidence,
        loadEvidence: loadEvidence,
        getTimeline: getTimeline,
        investigate: investigate,
        registerPattern: registerPattern,
        reset: reset
    };
}

module.exports = { createIncidentReplay: createIncidentReplay };
