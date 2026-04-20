'use strict';

/**
 * Lab Anomaly Correlator — Cross-module root cause analysis engine.
 *
 * Ingests events from contamination, viability, equipment, environment,
 * and printQuality modules, detects temporal correlations, identifies
 * root causes, and generates proactive recommendations.
 *
 * @module anomalyCorrelator
 */

var VALID_MODULES = ['contamination', 'viability', 'equipment', 'environment', 'printQuality'];

// Known causal relationships: source → target
var CAUSAL_RULES = [
  { source: 'environment', target: 'contamination', weight: 0.8, explanation: 'Environmental changes (humidity/temp) can promote contamination' },
  { source: 'equipment', target: 'printQuality', weight: 0.9, explanation: 'Equipment malfunction directly affects print quality' },
  { source: 'contamination', target: 'viability', weight: 0.85, explanation: 'Contamination reduces cell viability' },
  { source: 'environment', target: 'viability', weight: 0.7, explanation: 'Environmental instability stresses cells' },
  { source: 'equipment', target: 'environment', weight: 0.6, explanation: 'Equipment failure (HVAC) causes environmental drift' },
  { source: 'environment', target: 'printQuality', weight: 0.5, explanation: 'Temperature/humidity affect material properties' },
  { source: 'contamination', target: 'printQuality', weight: 0.4, explanation: 'Contaminated bioink degrades print fidelity' }
];

// Pre-built causal rule lookup: "source->target" → weight
// Eliminates repeated O(CAUSAL_RULES.length) linear scans inside the
// O(n²) event-pair loop in analyze() and computeCorrelationStrength().
var CAUSAL_WEIGHT_MAP = {};
for (var _r = 0; _r < CAUSAL_RULES.length; _r++) {
  CAUSAL_WEIGHT_MAP[CAUSAL_RULES[_r].source + '->' + CAUSAL_RULES[_r].target] = CAUSAL_RULES[_r].weight;
}

var RECOMMENDATIONS = {
  'environment->contamination': 'Check HVAC filters and room pressurization in affected area',
  'equipment->printQuality': 'Schedule equipment maintenance and recalibration',
  'contamination->viability': 'Initiate decontamination protocol for affected area',
  'environment->viability': 'Stabilize incubator/room environmental controls',
  'equipment->environment': 'Inspect and repair environmental control equipment (HVAC, humidifier)',
  'environment->printQuality': 'Allow environment to stabilize before resuming prints',
  'contamination->printQuality': 'Replace contaminated bioink stocks and sterilize print heads'
};

function validateEvent(evt) {
  if (!evt || typeof evt !== 'object') throw new Error('Event must be a non-null object');
  if (!evt.id || typeof evt.id !== 'string') throw new Error('Event.id must be a non-empty string');
  if (VALID_MODULES.indexOf(evt.module) === -1) {
    throw new Error('Event.module must be one of: ' + VALID_MODULES.join(', ') + ' (got "' + evt.module + '")');
  }
  if (typeof evt.type !== 'string' || !evt.type) throw new Error('Event.type must be a non-empty string');
  if (typeof evt.severity !== 'number' || evt.severity < 0 || evt.severity > 1) {
    throw new Error('Event.severity must be a number between 0 and 1');
  }
  if (typeof evt.timestamp !== 'number' || isNaN(evt.timestamp)) {
    throw new Error('Event.timestamp must be a valid number (ms since epoch)');
  }
}

/**
 * Create an anomaly correlator instance.
 * @param {Object} [options]
 * @param {number} [options.timeWindowMs=3600000] - Max time gap for correlation (default 1h)
 * @param {number} [options.minCorrelation=0.3] - Minimum correlation strength to report
 * @returns {Object} Correlator instance
 */
function createAnomalyCorrelator(options) {
  var opts = options || {};
  var timeWindowMs = typeof opts.timeWindowMs === 'number' ? opts.timeWindowMs : 3600000;
  var minCorrelation = typeof opts.minCorrelation === 'number' ? opts.minCorrelation : 0.3;

  var events = [];
  var pairCounts = {}; // "modA->modB" => count of co-occurrences

  function addEvent(evt) {
    validateEvent(evt);
    events.push({
      id: evt.id,
      module: evt.module,
      type: evt.type,
      severity: evt.severity,
      timestamp: evt.timestamp,
      metadata: evt.metadata || {}
    });
  }

  function getEvents(module) {
    if (module && VALID_MODULES.indexOf(module) === -1) {
      throw new Error('Invalid module: ' + module);
    }
    if (!module) return events.slice();
    return events.filter(function (e) { return e.module === module; });
  }

  function clear() {
    events = [];
    pairCounts = {};
  }

  function computeCorrelationStrength(evtA, evtB, timeGap) {
    // Base: temporal closeness (1 at 0 gap, decays to 0 at timeWindowMs)
    var temporal = 1 - (timeGap / timeWindowMs);

    // Causal bonus — O(1) lookup instead of linear scan over CAUSAL_RULES
    var pairKey = evtA.module + '->' + evtB.module;
    var causalWeight = CAUSAL_WEIGHT_MAP[pairKey] || 0;

    // Recurrence bonus from historical co-occurrences
    var recurrence = Math.min((pairCounts[pairKey] || 0) * 0.1, 0.3);

    // Combined: weighted average
    var strength = temporal * 0.4 + causalWeight * 0.4 + recurrence * 0.2;
    // Severity amplifier
    strength *= (0.5 + (evtA.severity + evtB.severity) / 4);

    return Math.min(Math.max(strength, 0), 1);
  }

  function analyze() {
    var correlations = [];
    var sorted = events.slice().sort(function (a, b) { return a.timestamp - b.timestamp; });

    // Find all correlations within time window
    for (var i = 0; i < sorted.length; i++) {
      for (var j = i + 1; j < sorted.length; j++) {
        var gap = sorted[j].timestamp - sorted[i].timestamp;
        if (gap > timeWindowMs) break;
        if (sorted[i].module === sorted[j].module) continue; // skip same-module

        var strength = computeCorrelationStrength(sorted[i], sorted[j], gap);
        if (strength >= minCorrelation) {
          // Determine pattern — O(1) lookup instead of linear scan
          var pairKey = sorted[i].module + '->' + sorted[j].module;
          var pattern = CAUSAL_WEIGHT_MAP[pairKey] ? 'causal' : 'temporal';

          correlations.push({
            eventA: sorted[i].id,
            eventB: sorted[j].id,
            strength: Math.round(strength * 1000) / 1000,
            timeGap: gap,
            pattern: pattern
          });

          // Track co-occurrence
          pairCounts[pairKey] = (pairCounts[pairKey] || 0) + 1;
        }
      }
    }

    // Build adjacency for root cause detection
    var outgoing = {}; // eventId → [{target, strength}]
    var incoming = {}; // eventId → [{source, strength}]
    correlations.forEach(function (c) {
      if (!outgoing[c.eventA]) outgoing[c.eventA] = [];
      if (!incoming[c.eventB]) incoming[c.eventB] = [];
      outgoing[c.eventA].push({ target: c.eventB, strength: c.strength });
      incoming[c.eventB].push({ source: c.eventA, strength: c.strength });
    });

    // Root causes: high outgoing, low incoming
    var evtMap = {};
    for (var _e = 0; _e < events.length; _e++) evtMap[events[_e].id] = events[_e];

    var rootCauses = [];
    Object.keys(outgoing).forEach(function (id) {
      var outCount = outgoing[id].length;
      var inCount = (incoming[id] || []).length;
      if (outCount > 0 && outCount > inCount) {
        var totalStrength = 0;
        var affected = outgoing[id].map(function (o) { totalStrength += o.strength; return o.target; });
        var confidence = Math.min(totalStrength / outCount, 1);
        var evt = evtMap[id];
        rootCauses.push({
          event: evt,
          confidence: Math.round(confidence * 1000) / 1000,
          affectedEvents: affected,
          explanation: evt.module + ' event "' + evt.type + '" likely caused ' + affected.length + ' downstream anomalies'
        });
      }
    });
    rootCauses.sort(function (a, b) { return b.confidence - a.confidence; });

    // Cluster detection (connected components via correlations)
    var visited = {};
    var clusters = [];

    function bfs(startId) {
      var queue = [startId];
      var cluster = [];
      visited[startId] = true;
      while (queue.length > 0) {
        var cur = queue.shift();
        cluster.push(cur);
        (outgoing[cur] || []).forEach(function (o) {
          if (!visited[o.target]) { visited[o.target] = true; queue.push(o.target); }
        });
        (incoming[cur] || []).forEach(function (o) {
          if (!visited[o.source]) { visited[o.source] = true; queue.push(o.source); }
        });
      }
      return cluster;
    }

    var allCorrelatedIds = {};
    correlations.forEach(function (c) { allCorrelatedIds[c.eventA] = true; allCorrelatedIds[c.eventB] = true; });

    Object.keys(allCorrelatedIds).forEach(function (id) {
      if (!visited[id]) {
        var clusterIds = bfs(id);
        if (clusterIds.length >= 2) {
          var clusterEvents = clusterIds.map(function (cid) { return evtMap[cid]; }).filter(Boolean);
          // Compound severity
          var compoundSeverity = 1;
          clusterEvents.forEach(function (e) { compoundSeverity *= (1 - e.severity); });
          compoundSeverity = Math.round((1 - compoundSeverity) * 1000) / 1000;

          // Determine dominant pattern
          var modules = {};
          clusterEvents.forEach(function (e) { modules[e.module] = true; });
          var pattern = Object.keys(modules).length > 2 ? 'cascade' : 'paired';

          clusters.push({
            id: 'cluster-' + (clusters.length + 1),
            events: clusterIds,
            compoundSeverity: compoundSeverity,
            pattern: pattern
          });
        }
      }
    });

    // Recommendations
    var recommendations = [];
    var recSeen = {};
    correlations.forEach(function (c) {
      if (c.pattern !== 'causal') return;
      var evtA = evtMap[c.eventA];
      var evtB = evtMap[c.eventB];
      if (!evtA || !evtB) return;
      var key = evtA.module + '->' + evtB.module;
      if (recSeen[key]) return;
      recSeen[key] = true;
      var action = RECOMMENDATIONS[key];
      if (action) {
        recommendations.push({
          priority: c.strength > 0.7 ? 'high' : c.strength > 0.5 ? 'medium' : 'low',
          action: action,
          reasoning: 'Detected ' + key + ' correlation (strength ' + c.strength + ')',
          relatedCluster: null
        });
      }
    });

    // Cascade recommendation
    clusters.forEach(function (cl) {
      if (cl.pattern === 'cascade') {
        recommendations.push({
          priority: 'high',
          action: 'Multi-module cascade detected — address root cause to prevent downstream propagation',
          reasoning: cl.events.length + ' events linked in cascade (compound severity ' + cl.compoundSeverity + ')',
          relatedCluster: cl.id
        });
      }
    });

    // Recurring pattern recommendation
    Object.keys(pairCounts).forEach(function (pair) {
      if (pairCounts[pair] >= 3 && !recSeen['recurring-' + pair]) {
        recSeen['recurring-' + pair] = true;
        var parts = pair.split('->');
        recommendations.push({
          priority: 'medium',
          action: 'Implement preventive monitoring for ' + parts[0] + ' anomalies — recurring pattern detected (' + pairCounts[pair] + ' occurrences)',
          reasoning: 'Repeated ' + pair + ' co-occurrences suggest systemic issue',
          relatedCluster: null
        });
      }
    });

    recommendations.sort(function (a, b) {
      var pri = { high: 0, medium: 1, low: 2 };
      return (pri[a.priority] || 2) - (pri[b.priority] || 2);
    });

    return {
      correlations: correlations,
      rootCauses: rootCauses,
      clusters: clusters,
      recommendations: recommendations,
      summary: {
        totalEvents: events.length,
        totalCorrelations: correlations.length,
        clustersFound: clusters.length,
        highestSeverity: events.reduce(function (max, e) { return e.severity > max ? e.severity : max; }, 0)
      }
    };
  }

  function getCorrelation(idA, idB) {
    var evtA = null, evtB = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].id === idA) evtA = events[i];
      if (events[i].id === idB) evtB = events[i];
    }
    if (!evtA || !evtB) return null;
    var gap = Math.abs(evtA.timestamp - evtB.timestamp);
    if (gap > timeWindowMs) return { strength: 0, pattern: 'none' };
    var first = evtA.timestamp <= evtB.timestamp ? evtA : evtB;
    var second = evtA.timestamp <= evtB.timestamp ? evtB : evtA;
    var strength = computeCorrelationStrength(first, second, gap);
    return { strength: Math.round(strength * 1000) / 1000, timeGap: gap };
  }

  return {
    addEvent: addEvent,
    getEvents: getEvents,
    clear: clear,
    analyze: analyze,
    getCorrelation: getCorrelation
  };
}

module.exports = { createAnomalyCorrelator: createAnomalyCorrelator };
