'use strict';

var _utils = require('./scriptUtils');
var clamp = _utils.clamp;
var round = _utils.round;
var mean = _utils.mean;

/**
 * Material Lot Tracker for BioBots
 *
 * Tracks bioink and reagent lots through their full lifecycle:
 * receiving, storage, usage, and disposal.  Each lot carries
 * Certificate of Analysis (CoA) data so labs can verify incoming
 * materials meet specifications before use and maintain full
 * traceability for GLP/GMP compliance.
 *
 * Features:
 *   - Register material lots with CoA data (purity, viscosity,
 *     endotoxin, sterility, pH, cell count, viability)
 *   - 10 material categories (bioink, crosslinker, media, scaffold,
 *     growth_factor, enzyme, buffer, stain, reagent, custom)
 *   - Lot lifecycle management (received > quarantine > released >
 *     in_use > depleted | expired | recalled)
 *   - CoA specification checking against configurable acceptance
 *     criteria per material type
 *   - Lot-to-lot consistency analysis (CV% across numeric CoA fields)
 *   - Expiry tracking with configurable warning windows
 *   - Recall management: recall lots by ID or supplier, cascade to
 *     dependent batches
 *   - Usage logging: track consumption per lot with operator, batch,
 *     and volume data
 *   - Supplier performance: on-time delivery, CoA pass rate, reject
 *     rate per supplier
 *   - Inventory summary: stock levels, approaching expiry, quarantine
 *     counts
 *   - JSON export/import with merge support
 *
 * Usage:
 *   var tracker = createMaterialLotTracker();
 *   tracker.registerLot({
 *     lotId: 'ALG-2026-001',
 *     material: 'Sodium Alginate 2%',
 *     category: 'bioink',
 *     supplier: 'BioLife Solutions',
 *     receivedDate: '2026-03-01',
 *     expiryDate: '2026-09-01',
 *     quantity: 500,
 *     unit: 'mL',
 *     coa: {
 *       purity: 98.5,
 *       viscosity: 320,
 *       endotoxin: 0.12,
 *       sterility: true,
 *       pH: 7.2
 *     }
 *   });
 *   var result = tracker.checkCoA('ALG-2026-001');
 */

/* -- Constants ------------------------------------------------ */

var CATEGORIES = {
  bioink:        { label: 'Bioink',          defaultUnit: 'mL' },
  crosslinker:   { label: 'Crosslinker',     defaultUnit: 'mL' },
  media:         { label: 'Culture Media',   defaultUnit: 'mL' },
  scaffold:      { label: 'Scaffold Material', defaultUnit: 'g' },
  growth_factor: { label: 'Growth Factor',   defaultUnit: 'ug' },
  enzyme:        { label: 'Enzyme',          defaultUnit: 'mL' },
  buffer:        { label: 'Buffer Solution', defaultUnit: 'mL' },
  stain:         { label: 'Stain/Dye',       defaultUnit: 'mL' },
  reagent:       { label: 'Reagent',         defaultUnit: 'mL' },
  custom:        { label: 'Custom',          defaultUnit: 'units' }
};

var LOT_STATES = ['received', 'quarantine', 'released', 'in_use', 'depleted', 'expired', 'recalled'];

var VALID_TRANSITIONS = {
  received:   ['quarantine', 'released', 'recalled'],
  quarantine: ['released', 'recalled'],
  released:   ['in_use', 'expired', 'recalled'],
  in_use:     ['depleted', 'expired', 'recalled'],
  depleted:   [],
  expired:    ['recalled'],
  recalled:   []
};

var DEFAULT_SPECS = {
  bioink: {
    purity:    { min: 95,   max: 100, unit: '%' },
    viscosity: { min: 50,   max: 2000, unit: 'mPa.s' },
    endotoxin: { min: 0,    max: 0.5, unit: 'EU/mL' },
    pH:        { min: 6.8,  max: 7.6, unit: '' },
    sterility: { equals: true }
  },
  crosslinker: {
    purity:    { min: 98,   max: 100, unit: '%' },
    pH:        { min: 6.5,  max: 8.0, unit: '' }
  },
  media: {
    pH:        { min: 7.0,  max: 7.6, unit: '' },
    sterility: { equals: true }
  },
  growth_factor: {
    purity:    { min: 95,   max: 100, unit: '%' }
  }
};

/* -- Helpers -------------------------------------------------- */

function _now() { return new Date().toISOString(); }

function _validateString(val, name) {
  if (typeof val !== 'string' || !val.trim()) {
    throw new Error(name + ' must be a non-empty string');
  }
}

function _stddev(arr) {
  if (arr.length < 2) return 0;
  var m = mean(arr);
  var ss = arr.reduce(function (s, v) { return s + (v - m) * (v - m); }, 0);
  return Math.sqrt(ss / (arr.length - 1));
}

function _cv(arr) {
  var m = mean(arr);
  if (m === 0) return 0;
  return (_stddev(arr) / Math.abs(m)) * 100;
}

/* -- Factory -------------------------------------------------- */

function createMaterialLotTracker(opts) {
  opts = opts || {};

  var lots = {};
  var usageLog = [];
  var recalls = [];
  var customSpecs = {};

  if (opts.specs && typeof opts.specs === 'object') {
    Object.keys(opts.specs).forEach(function (cat) {
      customSpecs[cat] = opts.specs[cat];
    });
  }

  var expiryWarningDays = typeof opts.expiryWarningDays === 'number'
    ? opts.expiryWarningDays : 30;

  /* -- Lot Registration --------------------------------------- */

  function registerLot(lot) {
    if (!lot || typeof lot !== 'object') {
      throw new Error('lot must be an object');
    }
    _validateString(lot.lotId, 'lotId');
    _validateString(lot.material, 'material');
    if (lots[lot.lotId]) {
      throw new Error('Lot ' + lot.lotId + ' already registered');
    }
    var cat = lot.category || 'custom';
    if (!CATEGORIES[cat]) {
      throw new Error('Unknown category: ' + cat + '. Valid: ' + Object.keys(CATEGORIES).join(', '));
    }
    if (lot.quantity !== undefined) {
      if (typeof lot.quantity !== 'number' || !isFinite(lot.quantity) || lot.quantity < 0) {
        throw new Error('quantity must be a non-negative finite number');
      }
    }

    var record = {
      lotId: lot.lotId,
      material: lot.material.trim(),
      category: cat,
      supplier: (lot.supplier || 'Unknown').trim(),
      receivedDate: lot.receivedDate || _now(),
      expiryDate: lot.expiryDate || null,
      quantity: typeof lot.quantity === 'number' ? lot.quantity : 0,
      remainingQuantity: typeof lot.quantity === 'number' ? lot.quantity : 0,
      unit: lot.unit || CATEGORIES[cat].defaultUnit,
      coa: lot.coa || {},
      state: 'received',
      stateHistory: [{ state: 'received', timestamp: _now() }],
      notes: lot.notes || '',
      tags: Array.isArray(lot.tags) ? lot.tags.slice() : []
    };

    lots[record.lotId] = record;
    return { lotId: record.lotId, state: record.state, material: record.material };
  }

  /* -- State Transitions -------------------------------------- */

  function transitionLot(lotId, newState, reason) {
    _validateString(lotId, 'lotId');
    var lot = lots[lotId];
    if (!lot) throw new Error('Lot not found: ' + lotId);
    if (LOT_STATES.indexOf(newState) === -1) {
      throw new Error('Invalid state: ' + newState + '. Valid: ' + LOT_STATES.join(', '));
    }
    var allowed = VALID_TRANSITIONS[lot.state];
    if (allowed.indexOf(newState) === -1) {
      throw new Error('Cannot transition from ' + lot.state + ' to ' + newState +
        '. Allowed: ' + (allowed.length ? allowed.join(', ') : 'none (terminal state)'));
    }
    lot.state = newState;
    lot.stateHistory.push({
      state: newState,
      timestamp: _now(),
      reason: reason || ''
    });
    return { lotId: lotId, state: newState };
  }

  function getLot(lotId) {
    _validateString(lotId, 'lotId');
    var lot = lots[lotId];
    if (!lot) throw new Error('Lot not found: ' + lotId);
    return JSON.parse(JSON.stringify(lot));
  }

  function listLots(filter) {
    filter = filter || {};
    var result = Object.keys(lots).map(function (id) { return lots[id]; });

    if (filter.state) {
      result = result.filter(function (l) { return l.state === filter.state; });
    }
    if (filter.category) {
      result = result.filter(function (l) { return l.category === filter.category; });
    }
    if (filter.supplier) {
      var sup = filter.supplier.toLowerCase();
      result = result.filter(function (l) { return l.supplier.toLowerCase().indexOf(sup) !== -1; });
    }
    if (filter.material) {
      var mat = filter.material.toLowerCase();
      result = result.filter(function (l) { return l.material.toLowerCase().indexOf(mat) !== -1; });
    }
    if (filter.tag) {
      result = result.filter(function (l) { return l.tags.indexOf(filter.tag) !== -1; });
    }

    return result.map(function (l) {
      return {
        lotId: l.lotId,
        material: l.material,
        category: l.category,
        supplier: l.supplier,
        state: l.state,
        remainingQuantity: l.remainingQuantity,
        unit: l.unit,
        expiryDate: l.expiryDate
      };
    });
  }

  /* -- CoA Checking ------------------------------------------- */

  function _getSpecsFor(category) {
    var base = DEFAULT_SPECS[category] || {};
    var custom = customSpecs[category] || {};
    var merged = {};
    Object.keys(base).forEach(function (k) { merged[k] = base[k]; });
    Object.keys(custom).forEach(function (k) { merged[k] = custom[k]; });
    return merged;
  }

  function checkCoA(lotId) {
    _validateString(lotId, 'lotId');
    var lot = lots[lotId];
    if (!lot) throw new Error('Lot not found: ' + lotId);

    var specs = _getSpecsFor(lot.category);
    var results = [];
    var allPass = true;

    Object.keys(specs).forEach(function (param) {
      var spec = specs[param];
      var actual = lot.coa[param];
      var entry = {
        parameter: param,
        specification: spec,
        actual: actual,
        status: 'skip'
      };

      if (actual === undefined || actual === null) {
        entry.status = 'missing';
        allPass = false;
      } else if (spec.equals !== undefined) {
        entry.status = actual === spec.equals ? 'pass' : 'fail';
        if (entry.status === 'fail') allPass = false;
      } else {
        var ok = true;
        if (spec.min !== undefined && actual < spec.min) ok = false;
        if (spec.max !== undefined && actual > spec.max) ok = false;
        entry.status = ok ? 'pass' : 'fail';
        if (!ok) allPass = false;
      }
      results.push(entry);
    });

    return {
      lotId: lotId,
      material: lot.material,
      category: lot.category,
      status: results.length === 0 ? 'no_specs' : (allPass ? 'pass' : 'fail'),
      results: results,
      checkedAt: _now()
    };
  }

  /* -- Usage Logging ------------------------------------------ */

  function logUsage(entry) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('usage entry must be an object');
    }
    _validateString(entry.lotId, 'lotId');
    var lot = lots[entry.lotId];
    if (!lot) throw new Error('Lot not found: ' + entry.lotId);

    if (lot.state !== 'released' && lot.state !== 'in_use') {
      throw new Error('Lot ' + entry.lotId + ' is in state "' + lot.state +
        '" -- only "released" or "in_use" lots can be consumed');
    }

    var vol = entry.volume;
    if (typeof vol !== 'number' || !isFinite(vol) || vol <= 0) {
      throw new Error('volume must be a positive finite number');
    }
    if (vol > lot.remainingQuantity) {
      throw new Error('Insufficient quantity: requested ' + vol +
        ' ' + lot.unit + ' but only ' + round(lot.remainingQuantity, 2) +
        ' ' + lot.unit + ' remaining');
    }

    lot.remainingQuantity = round(lot.remainingQuantity - vol, 4);
    if (lot.state === 'released') {
      transitionLot(entry.lotId, 'in_use', 'First usage recorded');
    }
    if (lot.remainingQuantity <= 0) {
      lot.remainingQuantity = 0;
      transitionLot(entry.lotId, 'depleted', 'Fully consumed');
    }

    var record = {
      lotId: entry.lotId,
      volume: vol,
      operator: entry.operator || 'Unknown',
      batch: entry.batch || '',
      purpose: entry.purpose || '',
      timestamp: _now()
    };
    usageLog.push(record);
    return {
      lotId: entry.lotId,
      consumed: vol,
      remaining: lot.remainingQuantity,
      unit: lot.unit,
      state: lot.state
    };
  }

  function getUsageHistory(lotId) {
    if (lotId) {
      _validateString(lotId, 'lotId');
      if (!lots[lotId]) throw new Error('Lot not found: ' + lotId);
      return usageLog.filter(function (u) { return u.lotId === lotId; });
    }
    return usageLog.slice();
  }

  /* -- Recall Management -------------------------------------- */

  function recallLots(recallDef) {
    if (!recallDef || typeof recallDef !== 'object') {
      throw new Error('recall definition must be an object');
    }
    _validateString(recallDef.reason, 'reason');

    var targetIds = [];
    if (Array.isArray(recallDef.lotIds)) {
      targetIds = recallDef.lotIds.slice();
    }
    if (recallDef.supplier) {
      var sup = recallDef.supplier.toLowerCase();
      Object.keys(lots).forEach(function (id) {
        if (lots[id].supplier.toLowerCase().indexOf(sup) !== -1 &&
            targetIds.indexOf(id) === -1) {
          targetIds.push(id);
        }
      });
    }
    if (recallDef.material) {
      var mat = recallDef.material.toLowerCase();
      Object.keys(lots).forEach(function (id) {
        if (lots[id].material.toLowerCase().indexOf(mat) !== -1 &&
            targetIds.indexOf(id) === -1) {
          targetIds.push(id);
        }
      });
    }

    if (targetIds.length === 0) {
      return { recalled: 0, lotIds: [], skipped: [] };
    }

    var recalled = [];
    var skipped = [];

    targetIds.forEach(function (id) {
      var lot = lots[id];
      if (!lot) { skipped.push({ lotId: id, reason: 'not found' }); return; }
      if (lot.state === 'recalled' || lot.state === 'depleted') {
        skipped.push({ lotId: id, reason: 'already ' + lot.state });
        return;
      }
      try {
        transitionLot(id, 'recalled', 'Recall: ' + recallDef.reason);
        recalled.push(id);
      } catch (e) {
        skipped.push({ lotId: id, reason: e.message });
      }
    });

    var recallRecord = {
      recallId: 'RCL-' + Date.now(),
      lotIds: recalled,
      reason: recallDef.reason,
      timestamp: _now()
    };
    recalls.push(recallRecord);

    var affectedBatches = [];
    recalled.forEach(function (id) {
      usageLog.forEach(function (u) {
        if (u.lotId === id && u.batch && affectedBatches.indexOf(u.batch) === -1) {
          affectedBatches.push(u.batch);
        }
      });
    });

    return {
      recallId: recallRecord.recallId,
      recalled: recalled.length,
      lotIds: recalled,
      skipped: skipped,
      affectedBatches: affectedBatches
    };
  }

  function getRecalls() {
    return recalls.slice();
  }

  /* -- Lot-to-Lot Consistency --------------------------------- */

  function analyzeConsistency(materialName) {
    _validateString(materialName, 'materialName');
    var matLower = materialName.toLowerCase();

    var matchingLots = Object.keys(lots)
      .map(function (id) { return lots[id]; })
      .filter(function (l) { return l.material.toLowerCase() === matLower; });

    if (matchingLots.length < 2) {
      return {
        material: materialName,
        lotCount: matchingLots.length,
        message: 'Need at least 2 lots for consistency analysis',
        parameters: []
      };
    }

    var paramSets = {};
    matchingLots.forEach(function (lot) {
      Object.keys(lot.coa).forEach(function (param) {
        if (typeof lot.coa[param] === 'number') {
          if (!paramSets[param]) paramSets[param] = [];
          paramSets[param].push({ lotId: lot.lotId, value: lot.coa[param] });
        }
      });
    });

    var parameters = Object.keys(paramSets).map(function (param) {
      var entries = paramSets[param];
      var vals = entries.map(function (e) { return e.value; });
      var cv = _cv(vals);
      var consistency;
      if (cv <= 2) consistency = 'excellent';
      else if (cv <= 5) consistency = 'good';
      else if (cv <= 10) consistency = 'acceptable';
      else if (cv <= 20) consistency = 'poor';
      else consistency = 'critical';

      return {
        parameter: param,
        lotCount: vals.length,
        mean: round(mean(vals), 4),
        stddev: round(_stddev(vals), 4),
        cv: round(cv, 2),
        min: round(Math.min.apply(null, vals), 4),
        max: round(Math.max.apply(null, vals), 4),
        consistency: consistency,
        entries: entries
      };
    });

    var levels = ['excellent', 'good', 'acceptable', 'poor', 'critical'];
    var worstIdx = 0;
    parameters.forEach(function (p) {
      var idx = levels.indexOf(p.consistency);
      if (idx > worstIdx) worstIdx = idx;
    });

    return {
      material: materialName,
      lotCount: matchingLots.length,
      overallConsistency: parameters.length > 0 ? levels[worstIdx] : 'unknown',
      parameters: parameters
    };
  }

  /* -- Expiry Tracking ---------------------------------------- */

  function checkExpiry(asOfDate) {
    var now = asOfDate ? new Date(asOfDate).getTime() : Date.now();
    var expired = [];
    var expiringSoon = [];
    var ok = [];

    Object.keys(lots).forEach(function (id) {
      var lot = lots[id];
      if (!lot.expiryDate || lot.state === 'depleted' || lot.state === 'recalled') return;

      var expiryMs = new Date(lot.expiryDate).getTime();
      var daysLeft = (expiryMs - now) / (1000 * 60 * 60 * 24);
      var entry = {
        lotId: id,
        material: lot.material,
        expiryDate: lot.expiryDate,
        daysRemaining: round(daysLeft, 1),
        state: lot.state,
        remainingQuantity: lot.remainingQuantity,
        unit: lot.unit
      };

      if (daysLeft <= 0) {
        entry.classification = 'expired';
        expired.push(entry);
        if (lot.state !== 'expired') {
          try { transitionLot(id, 'expired', 'Expiry check'); } catch (_e) { /* ignore */ }
        }
      } else if (daysLeft <= expiryWarningDays) {
        entry.classification = 'expiring_soon';
        expiringSoon.push(entry);
      } else {
        entry.classification = 'ok';
        ok.push(entry);
      }
    });

    return {
      checkedAt: new Date(now).toISOString(),
      warningWindowDays: expiryWarningDays,
      expired: expired,
      expiringSoon: expiringSoon,
      ok: ok,
      summary: {
        totalTracked: expired.length + expiringSoon.length + ok.length,
        expired: expired.length,
        expiringSoon: expiringSoon.length,
        ok: ok.length
      }
    };
  }

  /* -- Supplier Performance ----------------------------------- */

  function supplierReport() {
    var suppliers = {};

    Object.keys(lots).forEach(function (id) {
      var lot = lots[id];
      var sup = lot.supplier;
      if (!suppliers[sup]) {
        suppliers[sup] = { lots: 0, coaPass: 0, coaFail: 0, coaNoSpecs: 0,
                           recalled: 0, categories: {} };
      }
      var s = suppliers[sup];
      s.lots++;
      if (!s.categories[lot.category]) s.categories[lot.category] = 0;
      s.categories[lot.category]++;

      if (lot.state === 'recalled') s.recalled++;

      var coaResult = checkCoA(id);
      if (coaResult.status === 'pass') s.coaPass++;
      else if (coaResult.status === 'fail') s.coaFail++;
      else s.coaNoSpecs++;
    });

    return Object.keys(suppliers).map(function (name) {
      var s = suppliers[name];
      var tested = s.coaPass + s.coaFail;
      return {
        supplier: name,
        totalLots: s.lots,
        coaPassRate: tested > 0 ? round((s.coaPass / tested) * 100, 1) : null,
        coaPassed: s.coaPass,
        coaFailed: s.coaFail,
        coaUntested: s.coaNoSpecs,
        recalledLots: s.recalled,
        categories: s.categories
      };
    }).sort(function (a, b) { return b.totalLots - a.totalLots; });
  }

  /* -- Inventory Summary -------------------------------------- */

  function inventorySummary() {
    var byCategory = {};
    var byState = {};
    var totalLots = 0;

    Object.keys(lots).forEach(function (id) {
      var lot = lots[id];
      totalLots++;

      if (!byCategory[lot.category]) {
        byCategory[lot.category] = {
          label: CATEGORIES[lot.category].label,
          lots: 0,
          totalQuantity: 0,
          remainingQuantity: 0,
          unit: lot.unit
        };
      }
      var cat = byCategory[lot.category];
      cat.lots++;
      cat.totalQuantity = round(cat.totalQuantity + lot.quantity, 4);
      cat.remainingQuantity = round(cat.remainingQuantity + lot.remainingQuantity, 4);

      if (!byState[lot.state]) byState[lot.state] = 0;
      byState[lot.state]++;
    });

    var expiry = checkExpiry();

    return {
      totalLots: totalLots,
      byCategory: byCategory,
      byState: byState,
      expiringWithin30Days: expiry.summary.expiringSoon,
      expired: expiry.summary.expired,
      generatedAt: _now()
    };
  }

  /* -- Text Report -------------------------------------------- */

  function textReport() {
    var lines = [];
    lines.push('================================================================');
    lines.push('              MATERIAL LOT TRACKER -- REPORT                    ');
    lines.push('================================================================');
    lines.push('');

    var inv = inventorySummary();
    lines.push('-- Inventory Summary -------------------------------------------');
    lines.push('Total lots: ' + inv.totalLots);
    lines.push('');
    lines.push('By state:');
    LOT_STATES.forEach(function (s) {
      var count = inv.byState[s] || 0;
      if (count > 0) lines.push('  ' + s + ': ' + count);
    });
    lines.push('');
    lines.push('By category:');
    Object.keys(inv.byCategory).forEach(function (cat) {
      var c = inv.byCategory[cat];
      lines.push('  ' + c.label + ': ' + c.lots + ' lots, ' +
        round(c.remainingQuantity, 1) + '/' + round(c.totalQuantity, 1) + ' ' + c.unit + ' remaining');
    });
    lines.push('');

    var exp = checkExpiry();
    if (exp.expired.length > 0 || exp.expiringSoon.length > 0) {
      lines.push('-- Expiry Alerts -----------------------------------------------');
      exp.expired.forEach(function (e) {
        lines.push('  EXPIRED: ' + e.lotId + ' (' + e.material + ') -- expired ' +
          Math.abs(e.daysRemaining) + ' days ago');
      });
      exp.expiringSoon.forEach(function (e) {
        lines.push('  EXPIRING: ' + e.lotId + ' (' + e.material + ') -- ' +
          e.daysRemaining + ' days remaining');
      });
      lines.push('');
    }

    if (recalls.length > 0) {
      lines.push('-- Active Recalls ----------------------------------------------');
      recalls.forEach(function (r) {
        lines.push('  ' + r.recallId + ': ' + r.lotIds.length + ' lots -- ' + r.reason);
      });
      lines.push('');
    }

    var suppliers = supplierReport();
    if (suppliers.length > 0) {
      lines.push('-- Supplier Performance ----------------------------------------');
      suppliers.forEach(function (s) {
        var passStr = s.coaPassRate !== null ? (s.coaPassRate + '% CoA pass') : 'no CoA specs';
        lines.push('  ' + s.supplier + ': ' + s.totalLots + ' lots, ' + passStr +
          (s.recalledLots > 0 ? ', ' + s.recalledLots + ' recalled' : ''));
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  /* -- Export / Import ----------------------------------------- */

  function exportData() {
    return JSON.parse(JSON.stringify({
      lots: lots,
      usageLog: usageLog,
      recalls: recalls,
      customSpecs: customSpecs,
      expiryWarningDays: expiryWarningDays,
      exportedAt: _now()
    }));
  }

  function importData(data, opts) {
    if (!data || typeof data !== 'object') {
      throw new Error('import data must be an object');
    }
    var mode = (opts && opts.mode) || 'merge';

    if (mode === 'replace') {
      lots = {};
      usageLog = [];
      recalls = [];
      customSpecs = {};
    }

    if (data.lots && typeof data.lots === 'object') {
      Object.keys(data.lots).forEach(function (id) {
        if (mode === 'merge' && lots[id]) return;
        lots[id] = data.lots[id];
      });
    }
    if (Array.isArray(data.usageLog)) {
      data.usageLog.forEach(function (u) {
        if (mode === 'merge') {
          var isDup = usageLog.some(function (existing) {
            return existing.lotId === u.lotId &&
                   existing.timestamp === u.timestamp &&
                   existing.volume === u.volume;
          });
          if (isDup) return;
        }
        usageLog.push(u);
      });
    }
    if (Array.isArray(data.recalls)) {
      data.recalls.forEach(function (r) {
        if (mode === 'merge') {
          var exists = recalls.some(function (e) { return e.recallId === r.recallId; });
          if (exists) return;
        }
        recalls.push(r);
      });
    }
    if (data.customSpecs && typeof data.customSpecs === 'object') {
      Object.keys(data.customSpecs).forEach(function (cat) {
        customSpecs[cat] = data.customSpecs[cat];
      });
    }

    return { imported: true, mode: mode, lotCount: Object.keys(lots).length };
  }

  /* -- Public API --------------------------------------------- */

  return {
    registerLot:         registerLot,
    getLot:              getLot,
    listLots:            listLots,
    transitionLot:       transitionLot,
    checkCoA:            checkCoA,
    logUsage:            logUsage,
    getUsageHistory:     getUsageHistory,
    recallLots:          recallLots,
    getRecalls:          getRecalls,
    analyzeConsistency:  analyzeConsistency,
    checkExpiry:         checkExpiry,
    supplierReport:      supplierReport,
    inventorySummary:    inventorySummary,
    textReport:          textReport,
    exportData:          exportData,
    importData:          importData,
    CATEGORIES:          CATEGORIES,
    LOT_STATES:          LOT_STATES
  };
}

module.exports = { createMaterialLotTracker: createMaterialLotTracker };
