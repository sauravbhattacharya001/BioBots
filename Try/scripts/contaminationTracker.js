'use strict';

var _utils = require('./scriptUtils');
var clamp = _utils.clamp;
var round = _utils.round;
var mean = _utils.mean;

/**
 * Contamination Tracker for BioBots
 *
 * Tracks contamination events in bioprinting labs, identifies probable
 * sources, recommends prevention protocols, and analyses trends.
 *
 * Contamination is a critical concern in bioprinting: bacterial,
 * fungal, or cross-material contamination can ruin entire batches,
 * waste expensive bioinks, and compromise cell viability.  This module
 * provides structured contamination event logging, root-cause analysis
 * heuristics, prevention protocol recommendations, and trend analytics
 * so labs can reduce contamination rates over time.
 *
 * Features:
 *   - Log contamination events with type, severity, source, samples
 *   - 8 contamination types (bacterial, fungal, mycoplasma, viral,
 *     cross-material, particulate, chemical, endotoxin)
 *   - Root-cause analysis with probability scoring
 *   - Prevention protocol recommendations per contamination type
 *   - Trend analysis: rate tracking, hotspot identification,
 *     recurring pattern detection, seasonality signals
 *   - Risk scoring per equipment, material, and environment zone
 *   - Quarantine management for affected batches/equipment
 *   - Environmental correlation (temperature, humidity, air quality)
 *
 * Usage:
 *   var tracker = createContaminationTracker();
 *   tracker.logEvent({
 *     type: 'bacterial',
 *     severity: 'high',
 *     source: 'nozzle_assembly',
 *     affectedBatches: ['BATCH-001'],
 *     detectionMethod: 'visual',
 *     organism: 'Staphylococcus',
 *     environment: { tempC: 25, humidityPct: 65, airQualityIndex: 42 }
 *   });
 *
 *   var analysis = tracker.analyseEvent(eventId);
 *   var trends = tracker.trendReport({ windowDays: 30 });
 *   var protocols = tracker.preventionProtocols('bacterial');
 */

// ── Constants ───────────────────────────────────────────────────

var CONTAMINATION_TYPES = [
  'bacterial', 'fungal', 'mycoplasma', 'viral',
  'cross_material', 'particulate', 'chemical', 'endotoxin'
];

var SEVERITY_LEVELS = ['low', 'medium', 'high', 'critical'];
var SEVERITY_WEIGHTS = { low: 1, medium: 3, high: 7, critical: 15 };

var DETECTION_METHODS = [
  'visual', 'microscopy', 'culture', 'pcr', 'elisa',
  'turbidity', 'ph_shift', 'lal_assay', 'automated_sensor'
];

var SOURCE_CATEGORIES = {
  equipment: [
    'nozzle_assembly', 'print_bed', 'tubing', 'reservoir',
    'syringe', 'mixing_chamber', 'uv_lamp', 'cooling_system'
  ],
  material: [
    'bioink', 'crosslinker', 'media', 'cell_suspension',
    'support_material', 'wash_buffer'
  ],
  environment: [
    'laminar_flow_hood', 'incubator', 'room_air',
    'water_supply', 'work_surface'
  ],
  human: [
    'operator_contact', 'improper_ppe', 'protocol_deviation',
    'insufficient_training'
  ]
};

var ALL_SOURCES = [];
Object.keys(SOURCE_CATEGORIES).forEach(function (cat) {
  SOURCE_CATEGORIES[cat].forEach(function (s) { ALL_SOURCES.push(s); });
});

var QUARANTINE_STATES = ['active', 'cleared', 'disposed'];

// ── Prevention protocols ────────────────────────────────────────

var PREVENTION_PROTOCOLS = {
  bacterial: {
    immediate: [
      'Discard all affected batches and media',
      'Autoclave all reusable equipment at 121\u00b0C for 20 min',
      'Wipe surfaces with 70% ethanol followed by UV exposure (30 min)',
      'Replace all single-use tubing and nozzle tips'
    ],
    ongoing: [
      'Perform daily sterility checks on bioink stock',
      'Implement aseptic technique refresher training monthly',
      'Use 0.22\u00b5m filters on all liquid media transfers',
      'Maintain HEPA-filtered laminar flow during print operations',
      'Log operator hand hygiene compliance before each session'
    ],
    monitoring: [
      'Culture test samples every 24h for 7 days post-incident',
      'Swab equipment contact surfaces weekly',
      'Monitor incubator temperature logs for deviations >0.5\u00b0C'
    ]
  },
  fungal: {
    immediate: [
      'Isolate affected samples in sealed containers',
      'Clean work area with antifungal agent (chlorhexidine)',
      'Check HVAC filters for mold growth',
      'Dispose of opened media bottles >7 days old'
    ],
    ongoing: [
      'Maintain humidity below 60% in print environment',
      'Use antifungal-supplemented media (amphotericin B)',
      'Inspect incubator water pans weekly',
      'Replace HEPA filters per manufacturer schedule'
    ],
    monitoring: [
      'Air sampling with settle plates (48h exposure)',
      'Inspect stored bioinks under microscopy biweekly',
      'Log humidity readings twice daily'
    ]
  },
  mycoplasma: {
    immediate: [
      'Quarantine all cell cultures from the same passage',
      'Test remaining stocks via PCR-based mycoplasma kit',
      'Do NOT autoclave \u2014 mycoplasma fragments can generate false negatives'
    ],
    ongoing: [
      'Test all incoming cell lines before use (PCR or DAPI staining)',
      'Never share media bottles between cell lines',
      'Maintain separate incubator shelves per cell line',
      'Use prophylactic Plasmocin during cell expansion'
    ],
    monitoring: [
      'Monthly PCR testing of all active cell lines',
      'DAPI staining for extranuclear fluorescence quarterly',
      'Track cell growth rates \u2014 unexplained slowdown may indicate mycoplasma'
    ]
  },
  viral: {
    immediate: [
      'Halt all operations involving affected cell source',
      'Notify biosafety officer immediately',
      'Move samples to BSL-2 containment if not already there',
      'Decontaminate with bleach (1:10 dilution, 30 min contact)'
    ],
    ongoing: [
      'Source cells only from certified virus-tested repositories',
      'Test for common adventitious agents (retrovirus, parvovirus)',
      'Maintain BSL-2 practices for all primary human cell work'
    ],
    monitoring: [
      'Test aliquots for virus markers before large-scale expansion',
      'Report to institutional biosafety committee per protocol'
    ]
  },
  cross_material: {
    immediate: [
      'Purge all print lines with cleaning solution',
      'Discard current print batch',
      'Verify nozzle assignment matches print plan'
    ],
    ongoing: [
      'Implement barcode scanning for material loading verification',
      'Use dedicated nozzles per material type',
      'Run purge sequence between material switches (>5 mL)',
      'Colour-code material containers and tubing'
    ],
    monitoring: [
      'Spectrophotometric analysis of output vs reference',
      'Visual inspection at 10x magnification between layers',
      'Track nozzle switch count per session'
    ]
  },
  particulate: {
    immediate: [
      'Stop print and inspect nozzle for clogging',
      'Filter current bioink stock through 100\u00b5m mesh',
      'Clean print bed with lint-free wipes'
    ],
    ongoing: [
      'Pre-filter all bioinks before loading (40-100\u00b5m)',
      'Maintain positive-pressure clean room (ISO 7 or better)',
      'Wear lint-free gowns and powder-free gloves',
      'Cover samples during transport between stations'
    ],
    monitoring: [
      'Particle counter readings before each session',
      'Microscopy spot-check on first 3 layers of each print',
      'HVAC particle counts logged automatically'
    ]
  },
  chemical: {
    immediate: [
      'Identify contaminant source (residual cleaning agent, wrong buffer)',
      'Neutralise if possible, otherwise discard affected materials',
      'Flush equipment with sterile water (3x volume)',
      'Test pH and osmolality of remaining stocks'
    ],
    ongoing: [
      'Use dedicated cleaning and bioink preparation areas',
      'Triple-rinse all autoclaved containers before use',
      'Label all reagent bottles with preparation date and expiry',
      'Maintain material safety data sheets for all chemicals'
    ],
    monitoring: [
      'pH and osmolality checks on media before use',
      'Cell viability assay on sentinel cultures',
      'Log cleaning agent lot numbers per session'
    ]
  },
  endotoxin: {
    immediate: [
      'Test suspect materials with LAL (Limulus Amebocyte Lysate) assay',
      'Discard materials exceeding 0.5 EU/mL',
      'Depyrogenate glassware at 250\u00b0C for 30 min'
    ],
    ongoing: [
      'Use endotoxin-free water for all preparations',
      'Purchase certified endotoxin-tested reagents',
      'Avoid gram-negative bacterial contamination (primary source)',
      'Use depyrogenated or single-use plasticware'
    ],
    monitoring: [
      'LAL test each new lot of bioink components',
      'Quarterly endotoxin audit of water supply',
      'Track lot numbers to correlate with any cell response issues'
    ]
  }
};

// ── Root cause probability heuristics ───────────────────────────

var ROOT_CAUSE_HEURISTICS = {
  bacterial: {
    nozzle_assembly: 0.25, tubing: 0.20, operator_contact: 0.15,
    bioink: 0.12, media: 0.10, work_surface: 0.08, room_air: 0.05,
    _other: 0.05
  },
  fungal: {
    room_air: 0.25, incubator: 0.20, media: 0.15, water_supply: 0.12,
    work_surface: 0.10, laminar_flow_hood: 0.08, operator_contact: 0.05,
    _other: 0.05
  },
  mycoplasma: {
    cell_suspension: 0.35, media: 0.20, operator_contact: 0.15,
    incubator: 0.10, bioink: 0.10, _other: 0.10
  },
  viral: {
    cell_suspension: 0.45, media: 0.20, bioink: 0.15,
    operator_contact: 0.10, _other: 0.10
  },
  cross_material: {
    nozzle_assembly: 0.30, tubing: 0.25, mixing_chamber: 0.15,
    syringe: 0.10, reservoir: 0.10, protocol_deviation: 0.05,
    _other: 0.05
  },
  particulate: {
    room_air: 0.25, nozzle_assembly: 0.20, bioink: 0.15,
    operator_contact: 0.10, work_surface: 0.10, print_bed: 0.10,
    _other: 0.10
  },
  chemical: {
    wash_buffer: 0.25, crosslinker: 0.20, work_surface: 0.15,
    media: 0.15, protocol_deviation: 0.10, operator_contact: 0.05,
    _other: 0.10
  },
  endotoxin: {
    water_supply: 0.30, media: 0.20, bioink: 0.15,
    cell_suspension: 0.10, work_surface: 0.10, operator_contact: 0.05,
    _other: 0.10
  }
};

// ── Factory ─────────────────────────────────────────────────────

function createContaminationTracker() {
  var events = [];
  var quarantines = [];
  var nextId = 1;
  var nextQId = 1;

  function validateType(type) {
    if (CONTAMINATION_TYPES.indexOf(type) === -1) {
      throw new Error(
        'Invalid contamination type: ' + type +
        '. Must be one of: ' + CONTAMINATION_TYPES.join(', ')
      );
    }
  }

  function validateSeverity(sev) {
    if (SEVERITY_LEVELS.indexOf(sev) === -1) {
      throw new Error(
        'Invalid severity: ' + sev +
        '. Must be one of: ' + SEVERITY_LEVELS.join(', ')
      );
    }
  }

  // ── Event logging ───────────────────────────────────────────

  function logEvent(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Event data must be a non-null object');
    }
    validateType(data.type);
    validateSeverity(data.severity);

    if (data.detectionMethod && DETECTION_METHODS.indexOf(data.detectionMethod) === -1) {
      throw new Error('Invalid detection method: ' + data.detectionMethod);
    }

    var evt = {
      id: 'CONTAM-' + String(nextId++).padStart(4, '0'),
      type: data.type,
      severity: data.severity,
      source: data.source || null,
      affectedBatches: Array.isArray(data.affectedBatches) ? data.affectedBatches.slice() : [],
      detectionMethod: data.detectionMethod || null,
      organism: data.organism || null,
      operator: data.operator || null,
      equipment: data.equipment || null,
      notes: data.notes || null,
      environment: null,
      timestamp: data.timestamp || new Date().toISOString(),
      resolved: false,
      resolutionNotes: null,
      resolvedAt: null
    };

    if (data.environment && typeof data.environment === 'object') {
      evt.environment = {
        tempC: typeof data.environment.tempC === 'number' ? data.environment.tempC : null,
        humidityPct: typeof data.environment.humidityPct === 'number'
          ? clamp(data.environment.humidityPct, 0, 100) : null,
        airQualityIndex: typeof data.environment.airQualityIndex === 'number'
          ? data.environment.airQualityIndex : null
      };
    }

    events.push(evt);
    return evt;
  }

  function resolveEvent(eventId, notes) {
    var evt = events.find(function (e) { return e.id === eventId; });
    if (!evt) throw new Error('Event not found: ' + eventId);
    if (evt.resolved) throw new Error('Event already resolved: ' + eventId);
    evt.resolved = true;
    evt.resolutionNotes = notes || null;
    evt.resolvedAt = new Date().toISOString();
    return evt;
  }

  function getEvent(eventId) {
    return events.find(function (e) { return e.id === eventId; }) || null;
  }

  function listEvents(filters) {
    var f = filters || {};
    return events.filter(function (e) {
      if (f.type && e.type !== f.type) return false;
      if (f.severity && e.severity !== f.severity) return false;
      if (typeof f.resolved === 'boolean' && e.resolved !== f.resolved) return false;
      if (f.source && e.source !== f.source) return false;
      if (f.since && e.timestamp < f.since) return false;
      if (f.until && e.timestamp > f.until) return false;
      return true;
    });
  }

  // ── Root cause analysis ─────────────────────────────────────

  function analyseEvent(eventId) {
    var evt = events.find(function (e) { return e.id === eventId; });
    if (!evt) throw new Error('Event not found: ' + eventId);

    var heuristics = ROOT_CAUSE_HEURISTICS[evt.type] || {};
    var causes = [];

    Object.keys(heuristics).forEach(function (source) {
      if (source === '_other') return;
      var base = heuristics[source];

      if (evt.source === source) {
        base = Math.min(base * 2.0, 0.95);
      }

      var historicalCount = events.filter(function (e) {
        return e.type === evt.type && e.source === source && e.id !== evt.id;
      }).length;
      if (historicalCount > 0) {
        base = Math.min(base + historicalCount * 0.03, 0.95);
      }

      if (evt.environment) {
        if (evt.type === 'bacterial' && evt.environment.tempC !== null) {
          if (evt.environment.tempC > 30) base = Math.min(base * 1.2, 0.95);
        }
        if (evt.type === 'fungal' && evt.environment.humidityPct !== null) {
          if (evt.environment.humidityPct > 65) base = Math.min(base * 1.4, 0.95);
        }
        if (evt.type === 'particulate' && evt.environment.airQualityIndex !== null) {
          if (evt.environment.airQualityIndex > 50) base = Math.min(base * 1.3, 0.95);
        }
      }

      causes.push({
        source: source,
        probability: round(base, 3),
        category: _sourceCategory(source),
        historicalOccurrences: historicalCount
      });
    });

    causes.sort(function (a, b) { return b.probability - a.probability; });

    var totalP = causes.reduce(function (s, c) { return s + c.probability; }, 0);
    if (totalP > 0) {
      causes.forEach(function (c) {
        c.probability = round(c.probability / totalP, 3);
      });
    }

    return {
      eventId: evt.id,
      type: evt.type,
      severity: evt.severity,
      probableCauses: causes,
      topCause: causes.length > 0 ? causes[0] : null,
      confidence: causes.length > 0 ? (causes[0].probability > 0.25 ? 'high' : 'moderate') : 'low',
      recommendedActions: (PREVENTION_PROTOCOLS[evt.type] || {}).immediate || []
    };
  }

  // ── Quarantine management ───────────────────────────────────

  function quarantine(data) {
    if (!data || !data.itemId || !data.itemType || !data.reason) {
      throw new Error('itemId, itemType, and reason are required');
    }
    if (['batch', 'equipment'].indexOf(data.itemType) === -1) {
      throw new Error('itemType must be batch or equipment');
    }

    var record = {
      id: 'QUAR-' + String(nextQId++).padStart(4, '0'),
      itemId: data.itemId,
      itemType: data.itemType,
      reason: data.reason,
      linkedEventId: data.linkedEventId || null,
      state: 'active',
      quarantinedAt: new Date().toISOString(),
      clearedAt: null,
      disposedAt: null,
      notes: null
    };

    quarantines.push(record);
    return record;
  }

  function updateQuarantine(quarantineId, newState, notes) {
    var rec = quarantines.find(function (q) { return q.id === quarantineId; });
    if (!rec) throw new Error('Quarantine record not found: ' + quarantineId);
    if (QUARANTINE_STATES.indexOf(newState) === -1) {
      throw new Error('Invalid state: ' + newState);
    }
    if (rec.state !== 'active') {
      throw new Error('Can only update active quarantines');
    }
    rec.state = newState;
    rec.notes = notes || null;
    if (newState === 'cleared') rec.clearedAt = new Date().toISOString();
    if (newState === 'disposed') rec.disposedAt = new Date().toISOString();
    return rec;
  }

  function listQuarantines(filters) {
    var f = filters || {};
    return quarantines.filter(function (q) {
      if (f.state && q.state !== f.state) return false;
      if (f.itemType && q.itemType !== f.itemType) return false;
      return true;
    });
  }

  // ── Prevention protocols ────────────────────────────────────

  function preventionProtocols(type) {
    validateType(type);
    return PREVENTION_PROTOCOLS[type] || { immediate: [], ongoing: [], monitoring: [] };
  }

  // ── Trend analysis ──────────────────────────────────────────

  function trendReport(options) {
    var opts2 = options || {};
    var windowDays = opts2.windowDays || 30;
    var cutoff = new Date(Date.now() - windowDays * 86400000).toISOString();

    var recent = events.filter(function (e) { return e.timestamp >= cutoff; });
    var older = events.filter(function (e) { return e.timestamp < cutoff; });

    var byType = Object.create(null);
    CONTAMINATION_TYPES.forEach(function (t) { byType[t] = 0; });
    recent.forEach(function (e) { byType[e.type] = (byType[e.type] || 0) + 1; });

    var bySeverity = Object.create(null);
    SEVERITY_LEVELS.forEach(function (s) { bySeverity[s] = 0; });
    recent.forEach(function (e) { bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1; });

    var bySource = Object.create(null);
    recent.forEach(function (e) {
      if (e.source) {
        bySource[e.source] = (bySource[e.source] || 0) + 1;
      }
    });
    var hotspots = Object.keys(bySource)
      .map(function (s) { return { source: s, count: bySource[s], category: _sourceCategory(s) }; })
      .sort(function (a, b) { return b.count - a.count; });

    var recentRate = windowDays > 0 ? round(recent.length / windowDays, 2) : 0;
    var olderDays = Math.max(1, Math.ceil(
      (events.length > 0
        ? (new Date(cutoff).getTime() - new Date(events[0].timestamp).getTime()) / 86400000
        : 1)
    ));
    var olderRate = olderDays > 0 ? round(older.length / olderDays, 2) : 0;

    var combos = Object.create(null);
    recent.forEach(function (e) {
      if (e.source) {
        var key = e.type + '|' + e.source;
        combos[key] = (combos[key] || 0) + 1;
      }
    });
    var recurring = [];
    Object.keys(combos).forEach(function (key) {
      if (combos[key] >= 2) {
        var parts = key.split('|');
        recurring.push({
          type: parts[0],
          source: parts[1],
          occurrences: combos[key]
        });
      }
    });
    recurring.sort(function (a, b) { return b.occurrences - a.occurrences; });

    var riskPoints = recent.reduce(function (s, e) {
      return s + (SEVERITY_WEIGHTS[e.severity] || 1);
    }, 0);
    var maxPoints = recent.length * SEVERITY_WEIGHTS.critical;
    var riskScore = maxPoints > 0 ? round(riskPoints / maxPoints * 100, 1) : 0;

    var unresolved = recent.filter(function (e) { return !e.resolved; }).length;

    var envCorrelation = _environmentCorrelation(recent);

    return {
      windowDays: windowDays,
      totalEvents: recent.length,
      previousPeriodEvents: older.length,
      ratePerDay: recentRate,
      previousRatePerDay: olderRate,
      rateTrend: recentRate > olderRate ? 'increasing' :
        recentRate < olderRate ? 'decreasing' : 'stable',
      byType: byType,
      bySeverity: bySeverity,
      hotspots: hotspots,
      recurringPatterns: recurring,
      riskScore: riskScore,
      riskLevel: riskScore >= 60 ? 'critical' :
        riskScore >= 40 ? 'high' :
          riskScore >= 20 ? 'medium' : 'low',
      unresolvedCount: unresolved,
      environmentCorrelation: envCorrelation
    };
  }

  function sourceRiskScores() {
    var scores = Object.create(null);
    var counts = Object.create(null);

    events.forEach(function (e) {
      if (!e.source) return;
      var w = SEVERITY_WEIGHTS[e.severity] || 1;
      var ageMs = Date.now() - new Date(e.timestamp).getTime();
      var recency = ageMs < 30 * 86400000 ? 2.0 : 1.0;
      scores[e.source] = (scores[e.source] || 0) + w * recency;
      counts[e.source] = (counts[e.source] || 0) + 1;
    });

    return Object.keys(scores)
      .map(function (s) {
        return {
          source: s,
          riskScore: round(scores[s], 1),
          eventCount: counts[s],
          category: _sourceCategory(s)
        };
      })
      .sort(function (a, b) { return b.riskScore - a.riskScore; });
  }

  function summary() {
    var resolved = events.filter(function (e) { return e.resolved; });
    var unresolved = events.filter(function (e) { return !e.resolved; });

    var resolutionTimes = resolved
      .filter(function (e) { return e.resolvedAt; })
      .map(function (e) {
        return new Date(e.resolvedAt).getTime() - new Date(e.timestamp).getTime();
      });
    var mttr = resolutionTimes.length > 0
      ? round(mean(resolutionTimes) / 3600000, 1)
      : null;

    return {
      totalEvents: events.length,
      resolvedEvents: resolved.length,
      unresolvedEvents: unresolved.length,
      activeQuarantines: quarantines.filter(function (q) { return q.state === 'active'; }).length,
      meanTimeToResolutionHours: mttr,
      mostCommonType: _mostCommon(events, 'type'),
      mostCommonSource: _mostCommon(events, 'source'),
      mostCommonSeverity: _mostCommon(events, 'severity')
    };
  }

  // ── Export / Import ─────────────────────────────────────────

  function exportData() {
    return {
      events: events.map(function (e) { return Object.assign({}, e); }),
      quarantines: quarantines.map(function (q) { return Object.assign({}, q); }),
      exportedAt: new Date().toISOString()
    };
  }

  function importData(data) {
    if (!data || !Array.isArray(data.events)) {
      throw new Error('Invalid import data: events array required');
    }
    data.events.forEach(function (e) {
      events.push(Object.assign({}, e));
      var num = parseInt((e.id || '').replace('CONTAM-', ''), 10);
      if (!isNaN(num) && num >= nextId) nextId = num + 1;
    });
    if (Array.isArray(data.quarantines)) {
      data.quarantines.forEach(function (q) {
        quarantines.push(Object.assign({}, q));
        var num = parseInt((q.id || '').replace('QUAR-', ''), 10);
        if (!isNaN(num) && num >= nextQId) nextQId = num + 1;
      });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  function _sourceCategory(source) {
    var cats = Object.keys(SOURCE_CATEGORIES);
    for (var i = 0; i < cats.length; i++) {
      if (SOURCE_CATEGORIES[cats[i]].indexOf(source) !== -1) {
        return cats[i];
      }
    }
    return 'unknown';
  }

  function _mostCommon(arr, field) {
    var counts = Object.create(null);
    arr.forEach(function (item) {
      var val = item[field];
      if (val) counts[val] = (counts[val] || 0) + 1;
    });
    var best = null;
    var bestCount = 0;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > bestCount) { best = k; bestCount = counts[k]; }
    });
    return best;
  }

  function _environmentCorrelation(eventList) {
    var withEnv = eventList.filter(function (e) { return e.environment !== null; });
    if (withEnv.length < 2) return null;

    var temps = [];
    var humids = [];
    var aqis = [];
    withEnv.forEach(function (e) {
      if (e.environment.tempC !== null) temps.push(e.environment.tempC);
      if (e.environment.humidityPct !== null) humids.push(e.environment.humidityPct);
      if (e.environment.airQualityIndex !== null) aqis.push(e.environment.airQualityIndex);
    });

    var result = {};
    if (temps.length >= 2) {
      result.temperature = {
        mean: round(mean(temps), 1),
        min: Math.min.apply(null, temps),
        max: Math.max.apply(null, temps),
        aboveThreshold: temps.filter(function (t) { return t > 28; }).length
      };
    }
    if (humids.length >= 2) {
      result.humidity = {
        mean: round(mean(humids), 1),
        min: Math.min.apply(null, humids),
        max: Math.max.apply(null, humids),
        aboveThreshold: humids.filter(function (h) { return h > 65; }).length
      };
    }
    if (aqis.length >= 2) {
      result.airQuality = {
        mean: round(mean(aqis), 1),
        min: Math.min.apply(null, aqis),
        max: Math.max.apply(null, aqis),
        aboveThreshold: aqis.filter(function (a) { return a > 50; }).length
      };
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  return {
    logEvent: logEvent,
    resolveEvent: resolveEvent,
    getEvent: getEvent,
    listEvents: listEvents,
    analyseEvent: analyseEvent,
    quarantine: quarantine,
    updateQuarantine: updateQuarantine,
    listQuarantines: listQuarantines,
    preventionProtocols: preventionProtocols,
    trendReport: trendReport,
    sourceRiskScores: sourceRiskScores,
    summary: summary,
    exportData: exportData,
    importData: importData,
    CONTAMINATION_TYPES: CONTAMINATION_TYPES,
    SEVERITY_LEVELS: SEVERITY_LEVELS,
    DETECTION_METHODS: DETECTION_METHODS,
    SOURCE_CATEGORIES: SOURCE_CATEGORIES
  };
}

module.exports = { createContaminationTracker: createContaminationTracker };
