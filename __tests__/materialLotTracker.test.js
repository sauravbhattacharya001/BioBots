'use strict';

var materialLotTracker = require('../Try/scripts/materialLotTracker');
var createMaterialLotTracker = materialLotTracker.createMaterialLotTracker;

/* -- Helpers ------------------------------------------------- */

function makeLot(overrides) {
  var base = {
    lotId: 'LOT-001',
    material: 'Sodium Alginate 2%',
    category: 'bioink',
    supplier: 'BioLife Solutions',
    receivedDate: '2026-03-01',
    expiryDate: '2026-09-01',
    quantity: 500,
    unit: 'mL',
    coa: { purity: 98.5, viscosity: 320, endotoxin: 0.12, sterility: true, pH: 7.2 }
  };
  return Object.assign({}, base, overrides || {});
}

function freshTracker(opts) {
  return createMaterialLotTracker(opts);
}

/* -- Registration -------------------------------------------- */

describe('registerLot', function () {
  test('registers a lot and returns summary', function () {
    var t = freshTracker();
    var r = t.registerLot(makeLot());
    expect(r.lotId).toBe('LOT-001');
    expect(r.state).toBe('received');
    expect(r.material).toBe('Sodium Alginate 2%');
  });

  test('rejects duplicate lotId', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    expect(function () { t.registerLot(makeLot()); }).toThrow(/already registered/);
  });

  test('rejects missing lotId', function () {
    var t = freshTracker();
    expect(function () { t.registerLot({ material: 'x' }); }).toThrow(/lotId/);
  });

  test('rejects unknown category', function () {
    var t = freshTracker();
    expect(function () {
      t.registerLot(makeLot({ category: 'plutonium' }));
    }).toThrow(/Unknown category/);
  });

  test('rejects negative quantity', function () {
    var t = freshTracker();
    expect(function () {
      t.registerLot(makeLot({ quantity: -10 }));
    }).toThrow(/non-negative/);
  });

  test('defaults to custom category', function () {
    var t = freshTracker();
    var r = t.registerLot({ lotId: 'X-1', material: 'Mystery Goo' });
    var lot = t.getLot('X-1');
    expect(lot.category).toBe('custom');
  });

  test('preserves tags', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ tags: ['urgent', 'validated'] }));
    var lot = t.getLot('LOT-001');
    expect(lot.tags).toEqual(['urgent', 'validated']);
  });
});

/* -- State Transitions --------------------------------------- */

describe('transitionLot', function () {
  test('received -> quarantine -> released -> in_use -> depleted', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.transitionLot('LOT-001', 'quarantine');
    expect(t.getLot('LOT-001').state).toBe('quarantine');
    t.transitionLot('LOT-001', 'released');
    expect(t.getLot('LOT-001').state).toBe('released');
    t.transitionLot('LOT-001', 'in_use');
    expect(t.getLot('LOT-001').state).toBe('in_use');
    t.transitionLot('LOT-001', 'depleted');
    expect(t.getLot('LOT-001').state).toBe('depleted');
  });

  test('rejects invalid transition', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    expect(function () {
      t.transitionLot('LOT-001', 'depleted');
    }).toThrow(/Cannot transition/);
  });

  test('rejects transition from terminal state', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.transitionLot('LOT-001', 'released');
    t.transitionLot('LOT-001', 'in_use');
    t.transitionLot('LOT-001', 'depleted');
    expect(function () {
      t.transitionLot('LOT-001', 'released');
    }).toThrow(/terminal state/);
  });

  test('tracks state history', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.transitionLot('LOT-001', 'quarantine', 'Pending QC');
    var lot = t.getLot('LOT-001');
    expect(lot.stateHistory.length).toBe(2);
    expect(lot.stateHistory[1].state).toBe('quarantine');
    expect(lot.stateHistory[1].reason).toBe('Pending QC');
  });

  test('any active state can go to recalled', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.transitionLot('LOT-001', 'recalled', 'contamination');
    expect(t.getLot('LOT-001').state).toBe('recalled');
  });
});

/* -- CoA Checking -------------------------------------------- */

describe('checkCoA', function () {
  test('passes when all specs met', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    var r = t.checkCoA('LOT-001');
    expect(r.status).toBe('pass');
    expect(r.results.every(function (x) { return x.status === 'pass'; })).toBe(true);
  });

  test('fails when purity too low', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ coa: { purity: 90, viscosity: 320, endotoxin: 0.1, sterility: true, pH: 7.2 } }));
    var r = t.checkCoA('LOT-001');
    expect(r.status).toBe('fail');
    var purityResult = r.results.find(function (x) { return x.parameter === 'purity'; });
    expect(purityResult.status).toBe('fail');
  });

  test('fails when endotoxin exceeds max', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ coa: { purity: 99, viscosity: 320, endotoxin: 1.5, sterility: true, pH: 7.2 } }));
    var r = t.checkCoA('LOT-001');
    expect(r.status).toBe('fail');
  });

  test('fails when sterility is false', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ coa: { purity: 99, viscosity: 320, endotoxin: 0.1, sterility: false, pH: 7.2 } }));
    var r = t.checkCoA('LOT-001');
    expect(r.status).toBe('fail');
  });

  test('reports missing CoA fields', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ coa: { purity: 99 } }));
    var r = t.checkCoA('LOT-001');
    expect(r.status).toBe('fail');
    var missing = r.results.filter(function (x) { return x.status === 'missing'; });
    expect(missing.length).toBeGreaterThan(0);
  });

  test('returns no_specs for category without specs', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ category: 'custom', coa: {} }));
    var r = t.checkCoA('LOT-001');
    expect(r.status).toBe('no_specs');
  });

  test('custom specs override defaults', function () {
    var t = freshTracker({
      specs: { bioink: { purity: { min: 99, max: 100 } } }
    });
    t.registerLot(makeLot({ coa: { purity: 98.5, viscosity: 320, endotoxin: 0.1, sterility: true, pH: 7.2 } }));
    var r = t.checkCoA('LOT-001');
    expect(r.status).toBe('fail');
    var purityResult = r.results.find(function (x) { return x.parameter === 'purity'; });
    expect(purityResult.status).toBe('fail');
  });
});

/* -- Usage Logging ------------------------------------------- */

describe('logUsage', function () {
  test('deducts volume from remaining', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.transitionLot('LOT-001', 'released');
    var r = t.logUsage({ lotId: 'LOT-001', volume: 100, operator: 'Dr. Chen' });
    expect(r.consumed).toBe(100);
    expect(r.remaining).toBe(400);
    expect(r.state).toBe('in_use');
  });

  test('auto-transitions to depleted when fully consumed', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ quantity: 50 }));
    t.transitionLot('LOT-001', 'released');
    var r = t.logUsage({ lotId: 'LOT-001', volume: 50 });
    expect(r.remaining).toBe(0);
    expect(r.state).toBe('depleted');
  });

  test('rejects usage on received lot', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    expect(function () {
      t.logUsage({ lotId: 'LOT-001', volume: 10 });
    }).toThrow(/only "released" or "in_use"/);
  });

  test('rejects over-consumption', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ quantity: 100 }));
    t.transitionLot('LOT-001', 'released');
    expect(function () {
      t.logUsage({ lotId: 'LOT-001', volume: 200 });
    }).toThrow(/Insufficient quantity/);
  });

  test('tracks usage history', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.transitionLot('LOT-001', 'released');
    t.logUsage({ lotId: 'LOT-001', volume: 50, operator: 'Alice', batch: 'B-1' });
    t.logUsage({ lotId: 'LOT-001', volume: 30, operator: 'Bob', batch: 'B-2' });
    var history = t.getUsageHistory('LOT-001');
    expect(history.length).toBe(2);
    expect(history[0].operator).toBe('Alice');
    expect(history[1].batch).toBe('B-2');
  });

  test('getUsageHistory returns all when no lotId', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.registerLot(makeLot({ lotId: 'LOT-002', material: 'Collagen' }));
    t.transitionLot('LOT-001', 'released');
    t.transitionLot('LOT-002', 'released');
    t.logUsage({ lotId: 'LOT-001', volume: 10 });
    t.logUsage({ lotId: 'LOT-002', volume: 20 });
    expect(t.getUsageHistory().length).toBe(2);
  });
});

/* -- Recall Management --------------------------------------- */

describe('recallLots', function () {
  test('recalls by lotIds', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.registerLot(makeLot({ lotId: 'LOT-002', material: 'Collagen' }));
    var r = t.recallLots({ lotIds: ['LOT-001'], reason: 'Contamination found' });
    expect(r.recalled).toBe(1);
    expect(r.lotIds).toEqual(['LOT-001']);
    expect(t.getLot('LOT-001').state).toBe('recalled');
    expect(t.getLot('LOT-002').state).toBe('received');
  });

  test('recalls by supplier', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.registerLot(makeLot({ lotId: 'LOT-002', supplier: 'BioLife Solutions' }));
    t.registerLot(makeLot({ lotId: 'LOT-003', supplier: 'Other Co' }));
    var r = t.recallLots({ supplier: 'BioLife', reason: 'Supplier issue' });
    expect(r.recalled).toBe(2);
    expect(t.getLot('LOT-003').state).toBe('received');
  });

  test('identifies affected batches', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.transitionLot('LOT-001', 'released');
    t.logUsage({ lotId: 'LOT-001', volume: 10, batch: 'BATCH-A' });
    t.logUsage({ lotId: 'LOT-001', volume: 10, batch: 'BATCH-B' });
    var r = t.recallLots({ lotIds: ['LOT-001'], reason: 'CoA data falsified' });
    expect(r.affectedBatches).toEqual(expect.arrayContaining(['BATCH-A', 'BATCH-B']));
  });

  test('skips already recalled lots', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.transitionLot('LOT-001', 'recalled', 'first recall');
    var r = t.recallLots({ lotIds: ['LOT-001'], reason: 'second recall' });
    expect(r.recalled).toBe(0);
    expect(r.skipped.length).toBe(1);
  });

  test('getRecalls returns recall history', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.recallLots({ lotIds: ['LOT-001'], reason: 'test' });
    var recalls = t.getRecalls();
    expect(recalls.length).toBe(1);
    expect(recalls[0].reason).toBe('test');
  });
});

/* -- Lot-to-Lot Consistency ---------------------------------- */

describe('analyzeConsistency', function () {
  test('analyzes numeric CoA fields across lots', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ lotId: 'A-1', coa: { purity: 98, viscosity: 310 } }));
    t.registerLot(makeLot({ lotId: 'A-2', coa: { purity: 99, viscosity: 330 } }));
    t.registerLot(makeLot({ lotId: 'A-3', coa: { purity: 98.5, viscosity: 320 } }));
    var r = t.analyzeConsistency('Sodium Alginate 2%');
    expect(r.lotCount).toBe(3);
    expect(r.parameters.length).toBe(2);
    var purity = r.parameters.find(function (p) { return p.parameter === 'purity'; });
    expect(purity.cv).toBeLessThan(2);
    expect(purity.consistency).toBe('excellent');
  });

  test('returns message for single lot', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    var r = t.analyzeConsistency('Sodium Alginate 2%');
    expect(r.lotCount).toBe(1);
    expect(r.message).toMatch(/at least 2/);
  });

  test('case-insensitive material matching', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ lotId: 'A-1', coa: { purity: 98 } }));
    t.registerLot(makeLot({ lotId: 'A-2', coa: { purity: 99 } }));
    var r = t.analyzeConsistency('sodium alginate 2%');
    expect(r.lotCount).toBe(2);
  });

  test('detects poor consistency (high CV)', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ lotId: 'A-1', coa: { viscosity: 100 } }));
    t.registerLot(makeLot({ lotId: 'A-2', coa: { viscosity: 500 } }));
    var r = t.analyzeConsistency('Sodium Alginate 2%');
    var visc = r.parameters.find(function (p) { return p.parameter === 'viscosity'; });
    expect(['poor', 'critical']).toContain(visc.consistency);
  });
});

/* -- Expiry Tracking ----------------------------------------- */

describe('checkExpiry', function () {
  test('identifies expired lots', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ expiryDate: '2025-01-01' }));
    var r = t.checkExpiry('2026-03-14');
    expect(r.expired.length).toBe(1);
    expect(r.expired[0].daysRemaining).toBeLessThan(0);
  });

  test('identifies expiring-soon lots', function () {
    var t = freshTracker({ expiryWarningDays: 30 });
    t.registerLot(makeLot({ expiryDate: '2026-04-01' }));
    var r = t.checkExpiry('2026-03-14');
    expect(r.expiringSoon.length).toBe(1);
  });

  test('ok lots have plenty of time', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ expiryDate: '2027-01-01' }));
    var r = t.checkExpiry('2026-03-14');
    expect(r.ok.length).toBe(1);
  });

  test('skips depleted and recalled lots', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ expiryDate: '2025-01-01' }));
    t.transitionLot('LOT-001', 'recalled', 'test');
    var r = t.checkExpiry('2026-03-14');
    expect(r.summary.totalTracked).toBe(0);
  });
});

/* -- listLots ------------------------------------------------ */

describe('listLots', function () {
  test('filters by state', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.registerLot(makeLot({ lotId: 'LOT-002' }));
    t.transitionLot('LOT-002', 'quarantine');
    var r = t.listLots({ state: 'quarantine' });
    expect(r.length).toBe(1);
    expect(r[0].lotId).toBe('LOT-002');
  });

  test('filters by category', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.registerLot(makeLot({ lotId: 'LOT-002', category: 'media' }));
    expect(t.listLots({ category: 'bioink' }).length).toBe(1);
  });

  test('filters by supplier substring', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.registerLot(makeLot({ lotId: 'LOT-002', supplier: 'Sigma-Aldrich' }));
    expect(t.listLots({ supplier: 'biolife' }).length).toBe(1);
  });

  test('filters by tag', function () {
    var t = freshTracker();
    t.registerLot(makeLot({ tags: ['validated'] }));
    t.registerLot(makeLot({ lotId: 'LOT-002' }));
    expect(t.listLots({ tag: 'validated' }).length).toBe(1);
  });
});

/* -- Supplier Report ----------------------------------------- */

describe('supplierReport', function () {
  test('aggregates per supplier', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.registerLot(makeLot({ lotId: 'LOT-002', supplier: 'BioLife Solutions' }));
    t.registerLot(makeLot({ lotId: 'LOT-003', supplier: 'Sigma-Aldrich', category: 'media',
      coa: { pH: 7.3, sterility: true } }));
    var r = t.supplierReport();
    expect(r.length).toBe(2);
    var biolife = r.find(function (s) { return s.supplier === 'BioLife Solutions'; });
    expect(biolife.totalLots).toBe(2);
    expect(biolife.coaPassRate).toBe(100);
  });
});

/* -- Inventory Summary --------------------------------------- */

describe('inventorySummary', function () {
  test('summarizes by category and state', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.registerLot(makeLot({ lotId: 'LOT-002', category: 'media', quantity: 200 }));
    t.transitionLot('LOT-002', 'quarantine');
    var inv = t.inventorySummary();
    expect(inv.totalLots).toBe(2);
    expect(inv.byState.received).toBe(1);
    expect(inv.byState.quarantine).toBe(1);
    expect(inv.byCategory.bioink.lots).toBe(1);
  });
});

/* -- Text Report --------------------------------------------- */

describe('textReport', function () {
  test('produces readable output', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.registerLot(makeLot({ lotId: 'LOT-002', expiryDate: '2025-01-01' }));
    var report = t.textReport();
    expect(report).toContain('MATERIAL LOT TRACKER');
    expect(report).toContain('Total lots: 2');
    expect(report).toContain('Bioink');
  });
});

/* -- Export / Import ----------------------------------------- */

describe('export/import', function () {
  test('round-trips data', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.transitionLot('LOT-001', 'released');
    t.logUsage({ lotId: 'LOT-001', volume: 50 });
    var exported = t.exportData();

    var t2 = freshTracker();
    var result = t2.importData(exported);
    expect(result.lotCount).toBe(1);
    var lot = t2.getLot('LOT-001');
    expect(lot.remainingQuantity).toBe(450);
  });

  test('merge does not overwrite existing lots', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    var t2 = freshTracker();
    t2.registerLot(makeLot({ lotId: 'LOT-001', material: 'Different' }));
    t2.importData(t.exportData(), { mode: 'merge' });
    expect(t2.getLot('LOT-001').material).toBe('Different');
  });

  test('replace mode clears existing data', function () {
    var t = freshTracker();
    t.registerLot(makeLot());
    t.registerLot(makeLot({ lotId: 'LOT-002' }));
    var exported = t.exportData();

    var t2 = freshTracker();
    t2.registerLot(makeLot({ lotId: 'LOT-003', material: 'Local' }));
    t2.importData(exported, { mode: 'replace' });
    expect(t2.listLots().length).toBe(2);
    expect(function () { t2.getLot('LOT-003'); }).toThrow(/not found/);
  });
});

/* -- Constants ----------------------------------------------- */

describe('constants', function () {
  test('exposes CATEGORIES', function () {
    var t = freshTracker();
    expect(Object.keys(t.CATEGORIES).length).toBe(10);
    expect(t.CATEGORIES.bioink.label).toBe('Bioink');
  });

  test('exposes LOT_STATES', function () {
    var t = freshTracker();
    expect(t.LOT_STATES).toEqual(['received', 'quarantine', 'released', 'in_use', 'depleted', 'expired', 'recalled']);
  });
});
