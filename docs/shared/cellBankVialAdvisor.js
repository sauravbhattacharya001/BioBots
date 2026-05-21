'use strict';

/**
 * Cell Bank Vial Allocation Advisor - agentic cryogenic cell-line vial
 * inventory + allocation planner.
 *
 * Sibling to (and distinct from):
 *   - labInventory.js          generic reagent stock (mL, g, items) - has no
 *                              concept of passage number, master vs working
 *                              bank, frozen cell aging, viability decay.
 *   - freezeThaw.js            per-vial F/T cycle counter for already-thawed
 *                              vials. Does not plan future allocation, does
 *                              not understand bank tiers, does not handle
 *                              "we need 6 vials of HEK293 next Tuesday".
 *   - reagentSubstitutionAdvisor.js  picks alternates for an OOS reagent.
 *                              Cell lines are not interchangeable, so a
 *                              different question entirely.
 *
 * This module answers the cryostore manager's question:
 *
 *     "I have N vials of cell line X across master/working/distribution
 *      banks at various passages, viabilities, and QC ages. Which vials
 *      should I thaw for the requested experiments, which lines need
 *      expansion before the master bank runs out, and what should I do
 *      next?"
 *
 * Inputs
 * ------
 *   cellLines  array of { name, maxPassage, qcIntervalDays,
 *                          minViabilityPct, masterFloor, workingFloor,
 *                          warningRunway }
 *   vials      array of { id, cellLine, bankType (master|working|distribution),
 *                          passageNumber, vialCount, frozenAt (ISO),
 *                          viabilityAtFreezePct, freezeThawCycles,
 *                          lastQCDate (ISO), location, owner, reserved }
 *   requests   array of { id, cellLine, vialsNeeded, intendedUse
 *                          (experiment|expansion|rebanking|distribution),
 *                          neededByDate (ISO), notes }
 *
 * Per-vial verdicts (worst-first):
 *   EXPIRED_VIABILITY     viabilityAtFreezePct < line.minViabilityPct
 *   AGED_OUT_PASSAGE      passageNumber > line.maxPassage
 *   QC_OVERDUE            lastQCDate older than line.qcIntervalDays
 *   HIGH_THAW_CYCLES      freezeThawCycles >= 2 (refreezing is risky)
 *   APPROACHING_MAX_PASSAGE  >= 80% of maxPassage
 *   RESERVED              reserved flag set (cannot allocate)
 *   PRIME_MASTER          master bank, low passage, fresh QC, good viability
 *   READY_TO_THAW         working/distribution, all checks pass
 *
 * Per-line verdicts:
 *   MASTER_BANK_ENDANGERED  master usable vials <= masterFloor
 *   CRITICAL_DEPLETION      working usable < min(2, workingFloor) AND no
 *                           pending expansion request can fill it
 *   EXPANSION_NEEDED        working usable < workingFloor
 *   RUNWAY_LOW              working usable < warningRunway
 *   ADEQUATE                working usable >= warningRunway
 *   WELL_STOCKED            both banks comfortably above floors
 *   UNKNOWN_LINE            line referenced by vial but no registry entry
 *
 * Allocation planner
 * ------------------
 *   For each request, pick vialsNeeded vials from eligible vials of the
 *   line, honoring bankType -> intendedUse routing:
 *
 *     intendedUse=rebanking      master only (preserve working/distribution)
 *     intendedUse=expansion      master only (working would self-deplete)
 *     intendedUse=distribution   working preferred, then distribution
 *     intendedUse=experiment     distribution preferred, then working,
 *                                 NEVER master
 *
 *   Within the eligible pool, FIFO by highest passage first (so old stock
 *   gets used while still within maxPassage), tie-broken by highest
 *   freeze date (oldest stored first). RESERVED vials and any vials with a
 *   blocking verdict (EXPIRED_VIABILITY / AGED_OUT_PASSAGE) are skipped.
 *
 *   Each allocation: { requestId, cellLine, vialsNeeded, vialsAllocated,
 *                       picks: [vialId,...], shortfall, fulfilled,
 *                       reasons: [structured codes],
 *                       warnings: [structured codes] }
 *
 * Portfolio summary, A-F grade, P0-first deduped playbook
 * (EXPAND_WORKING_BANK_FROM_MASTER, REPLENISH_MASTER_BANK,
 *  RUN_QC_ON_OVERDUE_VIALS, RETIRE_AGED_PASSAGE_VIALS,
 *  CONSOLIDATE_HIGH_THAW_VIALS, ESTABLISH_DISTRIBUTION_BANK,
 *  REROUTE_REQUEST_TO_DIFFERENT_BANK, REQUEST_EXTERNAL_VIAL_SOURCE,
 *  SCHEDULE_BANK_AUDIT, HEALTHY_BANK_PORTFOLIO).
 *
 * Text / Markdown / JSON renderers; JSON is byte-stable (sorted keys,
 * 2-space indent). Pure JS, zero deps, deterministic given an injected
 * now(), never mutates inputs.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var advisor = biobots.createCellBankVialAdvisor({
 *       now: function () { return new Date('2026-06-01T00:00:00Z'); }
 *   });
 *   var report = advisor.evaluate({
 *       cellLines: [{ name: 'HEK293', maxPassage: 30, qcIntervalDays: 180,
 *                     minViabilityPct: 80, masterFloor: 5, workingFloor: 4,
 *                     warningRunway: 8 }],
 *       vials: [
 *           { id: 'V1', cellLine: 'HEK293', bankType: 'master',
 *             passageNumber: 5, vialCount: 6, frozenAt: '2024-01-15',
 *             viabilityAtFreezePct: 95, lastQCDate: '2025-12-01' },
 *           { id: 'V2', cellLine: 'HEK293', bankType: 'working',
 *             passageNumber: 12, vialCount: 3, frozenAt: '2025-06-01',
 *             viabilityAtFreezePct: 90, lastQCDate: '2026-04-01' }
 *       ],
 *       requests: [{ id: 'R1', cellLine: 'HEK293', vialsNeeded: 2,
 *                    intendedUse: 'experiment', neededByDate: '2026-06-15' }]
 *   });
 *   console.log(advisor.formatMarkdown(report));
 */

var _stripDangerous = require('./sanitize').stripDangerousKeys;

// ====================================================================
// Constants
// ====================================================================

var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

var BANK_TYPES = { master: true, working: true, distribution: true };

var INTENDED_USE_RULES = {
    rebanking:    { allowedBanks: ['master'],                       fallback: [] },
    expansion:    { allowedBanks: ['master'],                       fallback: [] },
    distribution: { allowedBanks: ['working', 'distribution'],      fallback: [] },
    experiment:   { allowedBanks: ['distribution', 'working'],      fallback: [] },
};

var VIAL_VERDICTS = {
    EXPIRED_VIABILITY:        { severity: 100, blocking: true,  priority: 'P0' },
    AGED_OUT_PASSAGE:         { severity:  95, blocking: true,  priority: 'P0' },
    QC_OVERDUE:               { severity:  60, blocking: false, priority: 'P1' },
    HIGH_THAW_CYCLES:         { severity:  55, blocking: false, priority: 'P1' },
    APPROACHING_MAX_PASSAGE:  { severity:  40, blocking: false, priority: 'P2' },
    RESERVED:                 { severity:  20, blocking: true,  priority: 'P3' },
    PRIME_MASTER:             { severity:   0, blocking: false, priority: 'P3' },
    READY_TO_THAW:            { severity:   0, blocking: false, priority: 'P3' },
};

var LINE_VERDICTS = {
    MASTER_BANK_ENDANGERED:   { priority: 'P0', score:  35 },
    CRITICAL_DEPLETION:       { priority: 'P0', score:  30 },
    EXPANSION_NEEDED:         { priority: 'P1', score:  20 },
    RUNWAY_LOW:               { priority: 'P2', score:  10 },
    ADEQUATE:                 { priority: 'P3', score:   0 },
    WELL_STOCKED:             { priority: 'P3', score:   0 },
    UNKNOWN_LINE:             { priority: 'P1', score:  15 },
};

var RISK_APPETITES = { cautious: true, balanced: true, aggressive: true };

// ====================================================================
// Helpers
// ====================================================================

function _isFiniteNum(n) { return typeof n === 'number' && isFinite(n); }

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _toDate(v, now) {
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

function _daysBetween(a, b) {
    if (!a || !b) return null;
    return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function _safeStr(v, fallback) {
    if (typeof v === 'string' && v.length > 0) return v;
    return fallback;
}

function _safePosInt(v, fallback) {
    if (typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v) return v;
    return fallback;
}

function _safeNum(v, fallback) {
    if (_isFiniteNum(v)) return v;
    return fallback;
}

function _appetiteMult(appetite) {
    if (appetite === 'cautious')   return 1.15;
    if (appetite === 'aggressive') return 0.85;
    return 1.0;
}

function _appetiteFloorBump(appetite) {
    // cautious raises effective floors (treat 'low' more aggressively);
    // aggressive lowers them. Floors are integer vial counts.
    if (appetite === 'cautious')   return 1;
    if (appetite === 'aggressive') return -1;
    return 0;
}

// ====================================================================
// Normalization
// ====================================================================

function _normalizeLine(raw) {
    var r = _stripDangerous(raw || {}, true);
    var name = _safeStr(r.name, null);
    if (!name) return null;
    return {
        name: name,
        maxPassage:        _safePosInt(r.maxPassage, 30),
        qcIntervalDays:    _safePosInt(r.qcIntervalDays, 180),
        minViabilityPct:   _clamp(_safeNum(r.minViabilityPct, 80), 0, 100),
        masterFloor:       _safePosInt(r.masterFloor, 5),
        workingFloor:      _safePosInt(r.workingFloor, 4),
        warningRunway:     _safePosInt(r.warningRunway, 8),
    };
}

function _normalizeVial(raw, now) {
    var r = _stripDangerous(raw || {}, true);
    var id = _safeStr(r.id, null);
    var cellLine = _safeStr(r.cellLine, null);
    if (!id || !cellLine) return null;
    var bankType = _safeStr(r.bankType, 'working').toLowerCase();
    if (!BANK_TYPES[bankType]) bankType = 'working';
    var frozenAt = _toDate(r.frozenAt, now);
    var lastQCDate = _toDate(r.lastQCDate, now);
    return {
        id: id,
        cellLine: cellLine,
        bankType: bankType,
        passageNumber:         _safePosInt(r.passageNumber, 0),
        vialCount:             Math.max(0, _safePosInt(r.vialCount, 1)),
        frozenAt:              frozenAt,
        viabilityAtFreezePct:  _clamp(_safeNum(r.viabilityAtFreezePct, 90), 0, 100),
        freezeThawCycles:      _safePosInt(r.freezeThawCycles, 0),
        lastQCDate:            lastQCDate,
        location:              _safeStr(r.location, ''),
        owner:                 _safeStr(r.owner, ''),
        reserved:              r.reserved === true,
    };
}

function _normalizeRequest(raw) {
    var r = _stripDangerous(raw || {}, true);
    var id = _safeStr(r.id, null);
    var cellLine = _safeStr(r.cellLine, null);
    if (!id || !cellLine) return null;
    var intendedUse = _safeStr(r.intendedUse, 'experiment').toLowerCase();
    if (!INTENDED_USE_RULES[intendedUse]) intendedUse = 'experiment';
    return {
        id: id,
        cellLine: cellLine,
        vialsNeeded: Math.max(0, _safePosInt(r.vialsNeeded, 1)),
        intendedUse: intendedUse,
        neededByDate: _toDate(r.neededByDate, null),
        notes: _safeStr(r.notes, ''),
    };
}

// ====================================================================
// Per-vial classification
// ====================================================================

function _classifyVial(vial, line, now) {
    var verdicts = [];
    var reasons = [];

    if (line) {
        if (vial.viabilityAtFreezePct < line.minViabilityPct) {
            verdicts.push('EXPIRED_VIABILITY');
            reasons.push({
                code: 'VIABILITY_BELOW_LINE_FLOOR',
                detail: 'frozen viability ' + vial.viabilityAtFreezePct.toFixed(1) +
                        '% < line floor ' + line.minViabilityPct + '%'
            });
        }
        if (vial.passageNumber > line.maxPassage) {
            verdicts.push('AGED_OUT_PASSAGE');
            reasons.push({
                code: 'PASSAGE_EXCEEDS_MAX',
                detail: 'P' + vial.passageNumber + ' > max P' + line.maxPassage
            });
        } else if (vial.passageNumber >= Math.ceil(line.maxPassage * 0.8)) {
            verdicts.push('APPROACHING_MAX_PASSAGE');
            reasons.push({
                code: 'PASSAGE_NEAR_MAX',
                detail: 'P' + vial.passageNumber + ' >= 80% of max P' + line.maxPassage
            });
        }
        if (vial.lastQCDate) {
            var age = _daysBetween(vial.lastQCDate, now);
            if (age != null && age > line.qcIntervalDays) {
                verdicts.push('QC_OVERDUE');
                reasons.push({
                    code: 'QC_AGE_EXCEEDS_INTERVAL',
                    detail: 'last QC ' + age + 'd ago > interval ' +
                            line.qcIntervalDays + 'd'
                });
            }
        } else {
            verdicts.push('QC_OVERDUE');
            reasons.push({ code: 'NO_QC_ON_RECORD', detail: 'no lastQCDate recorded' });
        }
    }

    if (vial.freezeThawCycles >= 2) {
        verdicts.push('HIGH_THAW_CYCLES');
        reasons.push({
            code: 'EXCESS_FREEZE_THAW',
            detail: vial.freezeThawCycles + ' cycles (>=2 indicates refreeze)'
        });
    }

    if (vial.reserved) {
        verdicts.push('RESERVED');
        reasons.push({ code: 'EXPLICITLY_RESERVED', detail: 'reserved=true flag set' });
    }

    if (verdicts.length === 0) {
        if (vial.bankType === 'master' &&
            line &&
            vial.passageNumber <= Math.ceil(line.maxPassage * 0.3) &&
            vial.viabilityAtFreezePct >= 90) {
            verdicts.push('PRIME_MASTER');
            reasons.push({
                code: 'LOW_PASSAGE_HIGH_VIABILITY_MASTER',
                detail: 'P' + vial.passageNumber + ', viability ' +
                        vial.viabilityAtFreezePct.toFixed(1) + '%'
            });
        } else {
            verdicts.push('READY_TO_THAW');
            reasons.push({ code: 'ALL_CHECKS_PASS', detail: 'no blocking conditions detected' });
        }
    }

    // Worst-first ordering
    verdicts.sort(function (a, b) {
        return VIAL_VERDICTS[b].severity - VIAL_VERDICTS[a].severity;
    });
    var primary = verdicts[0];
    var blocking = verdicts.some(function (v) { return VIAL_VERDICTS[v].blocking; });

    return {
        id: vial.id,
        cellLine: vial.cellLine,
        bankType: vial.bankType,
        passageNumber: vial.passageNumber,
        vialCount: vial.vialCount,
        viabilityAtFreezePct: vial.viabilityAtFreezePct,
        freezeThawCycles: vial.freezeThawCycles,
        location: vial.location,
        verdicts: verdicts,
        primaryVerdict: primary,
        blocking: blocking,
        reasons: reasons,
        priority: VIAL_VERDICTS[primary].priority,
    };
}

// ====================================================================
// Per-line classification
// ====================================================================

function _classifyLine(line, vialClassifications, appetite) {
    var byBank = { master: 0, working: 0, distribution: 0 };
    var usableByBank = { master: 0, working: 0, distribution: 0 };
    var blockedCount = 0;
    var qcOverdueCount = 0;
    var highThawCount = 0;
    var agingCount = 0;
    for (var i = 0; i < vialClassifications.length; i++) {
        var vc = vialClassifications[i];
        if (vc.cellLine !== line.name) continue;
        byBank[vc.bankType] = (byBank[vc.bankType] || 0) + vc.vialCount;
        if (!vc.blocking) {
            usableByBank[vc.bankType] = (usableByBank[vc.bankType] || 0) + vc.vialCount;
        } else {
            blockedCount += vc.vialCount;
        }
        if (vc.verdicts.indexOf('QC_OVERDUE') !== -1) qcOverdueCount += vc.vialCount;
        if (vc.verdicts.indexOf('HIGH_THAW_CYCLES') !== -1) highThawCount += vc.vialCount;
        if (vc.verdicts.indexOf('APPROACHING_MAX_PASSAGE') !== -1) agingCount += vc.vialCount;
    }

    var floorBump = _appetiteFloorBump(appetite);
    var effMasterFloor = Math.max(0, line.masterFloor + floorBump);
    var effWorkingFloor = Math.max(0, line.workingFloor + floorBump);
    var effWarningRunway = Math.max(0, line.warningRunway + floorBump);

    var workingPlusDist = usableByBank.working + usableByBank.distribution;
    var verdicts = [];
    var reasons = [];

    if (usableByBank.master <= effMasterFloor) {
        verdicts.push('MASTER_BANK_ENDANGERED');
        reasons.push({
            code: 'MASTER_BELOW_FLOOR',
            detail: 'usable master ' + usableByBank.master + ' <= floor ' + effMasterFloor
        });
    }
    if (workingPlusDist < Math.min(2, effWorkingFloor)) {
        verdicts.push('CRITICAL_DEPLETION');
        reasons.push({
            code: 'WORKING_NEAR_ZERO',
            detail: 'usable working+distribution ' + workingPlusDist +
                    ' below critical threshold'
        });
    } else if (workingPlusDist < effWorkingFloor) {
        verdicts.push('EXPANSION_NEEDED');
        reasons.push({
            code: 'WORKING_BELOW_FLOOR',
            detail: 'usable working+distribution ' + workingPlusDist +
                    ' < floor ' + effWorkingFloor
        });
    } else if (workingPlusDist < effWarningRunway) {
        verdicts.push('RUNWAY_LOW');
        reasons.push({
            code: 'WORKING_BELOW_RUNWAY',
            detail: 'usable working+distribution ' + workingPlusDist +
                    ' < runway ' + effWarningRunway
        });
    } else if (usableByBank.master > effMasterFloor &&
               workingPlusDist >= effWarningRunway * 1.5) {
        verdicts.push('WELL_STOCKED');
        reasons.push({
            code: 'COMFORTABLE_RESERVES',
            detail: 'master ' + usableByBank.master + ' / working+dist ' + workingPlusDist
        });
    } else {
        verdicts.push('ADEQUATE');
        reasons.push({
            code: 'WITHIN_NORMAL_BAND',
            detail: 'master ' + usableByBank.master + ' / working+dist ' + workingPlusDist
        });
    }

    // Primary = highest-priority verdict
    verdicts.sort(function (a, b) {
        return PRIORITY_RANK[LINE_VERDICTS[a].priority] -
               PRIORITY_RANK[LINE_VERDICTS[b].priority];
    });

    return {
        name: line.name,
        verdicts: verdicts,
        primaryVerdict: verdicts[0],
        priority: LINE_VERDICTS[verdicts[0]].priority,
        totalsByBank: byBank,
        usableByBank: usableByBank,
        blockedCount: blockedCount,
        qcOverdueCount: qcOverdueCount,
        highThawCount: highThawCount,
        agingCount: agingCount,
        reasons: reasons,
        effectiveFloors: {
            master: effMasterFloor,
            working: effWorkingFloor,
            warningRunway: effWarningRunway,
        },
    };
}

// ====================================================================
// Allocation planner
// ====================================================================

function _eligiblePool(line, vials, vialClassifications, bankTypes) {
    var byId = Object.create(null);
    for (var i = 0; i < vialClassifications.length; i++) byId[vialClassifications[i].id] = vialClassifications[i];

    var pool = [];
    for (var j = 0; j < vials.length; j++) {
        var v = vials[j];
        if (v.cellLine !== line) continue;
        if (bankTypes.indexOf(v.bankType) === -1) continue;
        var vc = byId[v.id];
        if (!vc || vc.blocking) continue;
        if (v.vialCount <= 0) continue;
        pool.push(v);
    }

    // FIFO by highest passage first (use up older stock while still in-spec),
    // tie-broken by earliest frozenAt (oldest stored first), then by id for
    // deterministic order.
    pool.sort(function (a, b) {
        if (b.passageNumber !== a.passageNumber) return b.passageNumber - a.passageNumber;
        var ta = a.frozenAt ? a.frozenAt.getTime() : Infinity;
        var tb = b.frozenAt ? b.frozenAt.getTime() : Infinity;
        if (ta !== tb) return ta - tb;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return pool;
}

function _planAllocation(request, line, vials, vialClassifications, now) {
    var rule = INTENDED_USE_RULES[request.intendedUse];
    var reasons = [];
    var warnings = [];

    if (!line) {
        return {
            requestId: request.id,
            cellLine: request.cellLine,
            intendedUse: request.intendedUse,
            vialsNeeded: request.vialsNeeded,
            vialsAllocated: 0,
            picks: [],
            shortfall: request.vialsNeeded,
            fulfilled: false,
            reasons: [{ code: 'UNKNOWN_CELL_LINE',
                        detail: 'no registry entry for ' + request.cellLine }],
            warnings: warnings,
        };
    }

    var pool = _eligiblePool(request.cellLine, vials, vialClassifications, rule.allowedBanks);
    var picks = [];
    var remaining = request.vialsNeeded;
    for (var i = 0; i < pool.length && remaining > 0; i++) {
        var v = pool[i];
        var take = Math.min(v.vialCount, remaining);
        picks.push({ vialId: v.id, bankType: v.bankType, passage: v.passageNumber,
                     vialsTaken: take });
        remaining -= take;
    }

    if (request.intendedUse === 'experiment' && picks.length > 0) {
        var fromMaster = picks.some(function (p) { return p.bankType === 'master'; });
        if (fromMaster) {
            warnings.push({ code: 'EXPERIMENT_PULLED_FROM_MASTER',
                            detail: 'experiment fulfilled from master bank - reroute next time' });
        }
    }
    if (remaining > 0) {
        // Was the gap caused by exhausted allowed banks while other banks have stock?
        var altBanks = ['master', 'working', 'distribution'].filter(function (b) {
            return rule.allowedBanks.indexOf(b) === -1;
        });
        var altPool = _eligiblePool(request.cellLine, vials, vialClassifications, altBanks);
        if (altPool.length > 0) {
            reasons.push({ code: 'ALTERNATE_BANK_HAS_STOCK',
                           detail: altBanks.join('+') + ' has usable vials but is not allowed for ' +
                                   request.intendedUse });
        } else {
            reasons.push({ code: 'INSUFFICIENT_ELIGIBLE_VIALS',
                           detail: 'short by ' + remaining + ' vial(s) across ' +
                                   rule.allowedBanks.join('+') });
        }
    } else {
        reasons.push({ code: 'REQUEST_FULFILLED',
                       detail: 'allocated ' + request.vialsNeeded + ' vial(s) via ' +
                               rule.allowedBanks.join('+') });
    }

    if (request.neededByDate) {
        var daysOut = _daysBetween(now, request.neededByDate);
        if (daysOut != null && daysOut < 3) {
            warnings.push({ code: 'SHORT_LEAD_TIME',
                            detail: daysOut + 'd lead time may not cover thaw + recovery' });
        }
    }

    return {
        requestId: request.id,
        cellLine: request.cellLine,
        intendedUse: request.intendedUse,
        vialsNeeded: request.vialsNeeded,
        vialsAllocated: request.vialsNeeded - remaining,
        picks: picks,
        shortfall: remaining,
        fulfilled: remaining === 0,
        reasons: reasons,
        warnings: warnings,
    };
}

// ====================================================================
// Playbook
// ====================================================================

function _buildPlaybook(lineClassifications, vialClassifications, allocations, appetite) {
    var actions = [];

    // Per-line P0/P1 actions
    for (var i = 0; i < lineClassifications.length; i++) {
        var lc = lineClassifications[i];
        if (lc.verdicts.indexOf('MASTER_BANK_ENDANGERED') !== -1) {
            actions.push({
                id: 'REPLENISH_MASTER_BANK',
                priority: 'P0',
                label: 'Replenish master bank for ' + lc.name,
                reason: 'usable master ' + lc.usableByBank.master + ' <= floor ' +
                        lc.effectiveFloors.master,
                owner: 'cell_culture_lead',
                blastRadius: 4,
                reversibility: 'low',
                relatedLines: [lc.name],
            });
        }
        if (lc.verdicts.indexOf('CRITICAL_DEPLETION') !== -1) {
            actions.push({
                id: 'EXPAND_WORKING_BANK_FROM_MASTER',
                priority: 'P0',
                label: 'Expand working bank for ' + lc.name + ' (critical)',
                reason: 'usable working+dist ' +
                        (lc.usableByBank.working + lc.usableByBank.distribution) +
                        ' near zero',
                owner: 'cell_culture',
                blastRadius: 3,
                reversibility: 'medium',
                relatedLines: [lc.name],
            });
        } else if (lc.verdicts.indexOf('EXPANSION_NEEDED') !== -1) {
            actions.push({
                id: 'EXPAND_WORKING_BANK_FROM_MASTER',
                priority: 'P1',
                label: 'Expand working bank for ' + lc.name,
                reason: 'usable working+dist ' +
                        (lc.usableByBank.working + lc.usableByBank.distribution) +
                        ' < floor ' + lc.effectiveFloors.working,
                owner: 'cell_culture',
                blastRadius: 2,
                reversibility: 'medium',
                relatedLines: [lc.name],
            });
        }
        if (lc.verdicts.indexOf('UNKNOWN_LINE') !== -1) {
            actions.push({
                id: 'REGISTER_UNKNOWN_LINE',
                priority: 'P1',
                label: 'Register cell line ' + lc.name + ' in registry',
                reason: 'vials reference line with no registry entry; cannot enforce maxPassage/QC',
                owner: 'qa',
                blastRadius: 1,
                reversibility: 'high',
                relatedLines: [lc.name],
            });
        }
    }

    // Aggregate vial-level signals
    var qcLines = {};
    var agedLines = {};
    var thawLines = {};
    for (var v = 0; v < vialClassifications.length; v++) {
        var vc = vialClassifications[v];
        if (vc.verdicts.indexOf('QC_OVERDUE') !== -1) qcLines[vc.cellLine] = true;
        if (vc.verdicts.indexOf('AGED_OUT_PASSAGE') !== -1) agedLines[vc.cellLine] = true;
        if (vc.verdicts.indexOf('HIGH_THAW_CYCLES') !== -1) thawLines[vc.cellLine] = true;
    }
    var qcArr = Object.keys(qcLines).sort();
    var agedArr = Object.keys(agedLines).sort();
    var thawArr = Object.keys(thawLines).sort();

    if (qcArr.length > 0) {
        actions.push({
            id: 'RUN_QC_ON_OVERDUE_VIALS',
            priority: 'P1',
            label: 'Run QC panel on ' + qcArr.length + ' line(s) with overdue vials',
            reason: 'QC age exceeds interval (or never recorded) for ' + qcArr.join(', '),
            owner: 'qa',
            blastRadius: 2,
            reversibility: 'high',
            relatedLines: qcArr,
        });
    }
    if (agedArr.length > 0) {
        actions.push({
            id: 'RETIRE_AGED_PASSAGE_VIALS',
            priority: 'P0',
            label: 'Retire ' + agedArr.length + ' line(s) of over-passage vials',
            reason: 'passage exceeds maxPassage; cannot be used for experiments',
            owner: 'cell_culture_lead',
            blastRadius: 2,
            reversibility: 'low',
            relatedLines: agedArr,
        });
    }
    if (thawArr.length > 0) {
        actions.push({
            id: 'CONSOLIDATE_HIGH_THAW_VIALS',
            priority: 'P2',
            label: 'Consolidate or retire high-thaw vials for ' + thawArr.length + ' line(s)',
            reason: '>=2 freeze/thaw cycles risks viability + genomic drift',
            owner: 'cell_culture',
            blastRadius: 1,
            reversibility: 'high',
            relatedLines: thawArr,
        });
    }

    // Allocation-driven actions
    var unfulfilled = allocations.filter(function (a) { return !a.fulfilled; });
    var reroutable = unfulfilled.filter(function (a) {
        return a.reasons.some(function (r) { return r.code === 'ALTERNATE_BANK_HAS_STOCK'; });
    });
    var truly_short = unfulfilled.filter(function (a) {
        return a.reasons.some(function (r) { return r.code === 'INSUFFICIENT_ELIGIBLE_VIALS'; });
    });
    if (reroutable.length > 0) {
        actions.push({
            id: 'REROUTE_REQUEST_TO_DIFFERENT_BANK',
            priority: 'P1',
            label: 'Reroute ' + reroutable.length + ' request(s) to an allowed bank',
            reason: 'allowed bank exhausted but alternate bank has usable vials',
            owner: 'cell_culture_lead',
            blastRadius: 2,
            reversibility: 'high',
            relatedRequests: reroutable.map(function (a) { return a.requestId; }),
        });
    }
    if (truly_short.length > 0) {
        actions.push({
            id: 'REQUEST_EXTERNAL_VIAL_SOURCE',
            priority: 'P0',
            label: 'Source ' + truly_short.length + ' line(s) externally',
            reason: 'no eligible vials in any bank for fulfilled-zero requests',
            owner: 'procurement',
            blastRadius: 4,
            reversibility: 'low',
            relatedRequests: truly_short.map(function (a) { return a.requestId; }),
        });
    }

    // Distribution-bank gap
    var distGap = lineClassifications.filter(function (lc) {
        return lc.totalsByBank.distribution === 0 &&
               (lc.usableByBank.working + lc.usableByBank.master) >= lc.effectiveFloors.working + 4;
    });
    if (distGap.length > 0) {
        actions.push({
            id: 'ESTABLISH_DISTRIBUTION_BANK',
            priority: 'P2',
            label: 'Establish distribution bank for ' + distGap.length + ' line(s)',
            reason: 'no distribution-tier vials but working/master have headroom',
            owner: 'cell_culture',
            blastRadius: 2,
            reversibility: 'high',
            relatedLines: distGap.map(function (lc) { return lc.name; }).sort(),
        });
    }

    // Cautious-only audit
    if (appetite === 'cautious') {
        var anyConcern = actions.some(function (a) { return a.priority === 'P0' || a.priority === 'P1'; });
        if (anyConcern) {
            actions.push({
                id: 'SCHEDULE_BANK_AUDIT',
                priority: 'P2',
                label: 'Schedule full cell-bank audit',
                reason: 'cautious risk appetite + open P0/P1 actions warrant a documented audit',
                owner: 'qa',
                blastRadius: 1,
                reversibility: 'high',
                relatedLines: [],
            });
        }
    }

    if (actions.length === 0) {
        actions.push({
            id: 'HEALTHY_BANK_PORTFOLIO',
            priority: 'P3',
            label: 'Cell bank portfolio is healthy',
            reason: 'no blocking conditions across vials, lines, or allocations',
            owner: 'cell_culture',
            blastRadius: 0,
            reversibility: 'high',
            relatedLines: [],
        });
    }

    // Aggressive trims P3 + lone P2 when P0/P1 present
    if (appetite === 'aggressive') {
        var hasUrgent = actions.some(function (a) { return a.priority === 'P0' || a.priority === 'P1'; });
        if (hasUrgent) {
            actions = actions.filter(function (a) {
                if (a.priority === 'P3') return false;
                if (a.priority === 'P2') {
                    // keep only if there are multiple P2s
                    var p2s = actions.filter(function (x) { return x.priority === 'P2'; });
                    return p2s.length > 1;
                }
                return true;
            });
        }
    }

    // Dedupe by id + relatedLines join key (preserve first occurrence)
    var seen = Object.create(null);
    var deduped = [];
    for (var k = 0; k < actions.length; k++) {
        var a = actions[k];
        var key = a.id + '|' + (a.relatedLines || []).join(',') + '|' +
                  (a.relatedRequests || []).join(',');
        if (seen[key]) continue;
        seen[key] = true;
        deduped.push(a);
    }

    // P0-first ordering, then id asc
    deduped.sort(function (a, b) {
        if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return deduped;
}

// ====================================================================
// Insights, score, grade
// ====================================================================

function _buildInsights(lineClassifications, vialClassifications, allocations) {
    var insights = [];
    var endangered = lineClassifications.filter(function (lc) {
        return lc.verdicts.indexOf('MASTER_BANK_ENDANGERED') !== -1;
    });
    if (endangered.length > 0) {
        insights.push({
            code: 'MASTER_BANK_ENDANGERED',
            detail: endangered.length + ' line(s) below master floor',
            related: endangered.map(function (l) { return l.name; }).sort(),
        });
    }
    var critical = lineClassifications.filter(function (lc) {
        return lc.verdicts.indexOf('CRITICAL_DEPLETION') !== -1;
    });
    if (critical.length > 0) {
        insights.push({
            code: 'CRITICAL_DEPLETION_PRESENT',
            detail: critical.length + ' line(s) at critical working-bank depletion',
            related: critical.map(function (l) { return l.name; }).sort(),
        });
    }
    var qcCount = vialClassifications.filter(function (v) {
        return v.verdicts.indexOf('QC_OVERDUE') !== -1;
    }).length;
    if (qcCount > 0) {
        insights.push({
            code: 'QC_AUDIT_NEEDED',
            detail: qcCount + ' vial group(s) with overdue QC',
            related: [],
        });
    }
    var unfulfilled = allocations.filter(function (a) { return !a.fulfilled; });
    if (unfulfilled.length > 0) {
        insights.push({
            code: 'UNFULFILLED_REQUESTS',
            detail: unfulfilled.length + ' request(s) not fully satisfied',
            related: unfulfilled.map(function (a) { return a.requestId; }).sort(),
        });
    }
    var wellStocked = lineClassifications.filter(function (lc) {
        return lc.verdicts.indexOf('WELL_STOCKED') !== -1;
    });
    if (wellStocked.length > 0 && endangered.length === 0 && critical.length === 0) {
        insights.push({
            code: 'WELL_STOCKED_PORTFOLIO',
            detail: wellStocked.length + ' line(s) comfortably above reserves',
            related: wellStocked.map(function (l) { return l.name; }).sort(),
        });
    }
    if (insights.length === 0) {
        insights.push({
            code: 'NO_NOTABLE_SIGNALS',
            detail: 'no urgent or notable patterns detected',
            related: [],
        });
    }
    return insights;
}

function _portfolioScore(lineClassifications, allocations, appetite) {
    var raw = 0;
    for (var i = 0; i < lineClassifications.length; i++) {
        raw += LINE_VERDICTS[lineClassifications[i].primaryVerdict].score;
    }
    var unfulfilled = allocations.filter(function (a) { return !a.fulfilled; }).length;
    raw += unfulfilled * 10;
    raw *= _appetiteMult(appetite);
    return _clamp(Math.round(raw), 0, 100);
}

function _gradeFromScore(score, lineClassifications) {
    var hasP0Line = lineClassifications.some(function (lc) {
        return lc.priority === 'P0';
    });
    if (hasP0Line) return 'F';
    if (score >= 60) return 'D';
    if (score >= 40) return 'C';
    if (score >= 20) return 'B';
    return 'A';
}

// ====================================================================
// Renderers
// ====================================================================

function _pipeEscape(s) {
    return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function _sortedJson(value) {
    if (Array.isArray(value)) {
        return value.map(_sortedJson);
    }
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        var out = {};
        var keys = Object.keys(value).sort();
        for (var i = 0; i < keys.length; i++) out[keys[i]] = _sortedJson(value[keys[i]]);
        return out;
    }
    if (value instanceof Date) return value.toISOString();
    return value;
}

function _formatText(report) {
    var lines = [];
    lines.push('CELL BANK VIAL ADVISOR');
    lines.push('Headline: ' + report.headline);
    lines.push('Grade: ' + report.grade + ' | Risk score: ' + report.riskScore +
               ' | Appetite: ' + report.riskAppetite);
    lines.push('Lines: ' + report.summary.totalLines +
               ' | Vial groups: ' + report.summary.totalVialGroups +
               ' | Vials: ' + report.summary.totalVials +
               ' | Usable: ' + report.summary.usableVials);
    lines.push('');
    lines.push('LINES');
    for (var i = 0; i < report.lines.length; i++) {
        var l = report.lines[i];
        lines.push('  - ' + l.name + ' [' + l.primaryVerdict + '] ' +
                   'master=' + l.usableByBank.master +
                   ' working=' + l.usableByBank.working +
                   ' dist=' + l.usableByBank.distribution +
                   ' (priority ' + l.priority + ')');
    }
    lines.push('');
    lines.push('ALLOCATIONS');
    for (var j = 0; j < report.allocations.length; j++) {
        var a = report.allocations[j];
        lines.push('  - ' + a.requestId + ' (' + a.cellLine + ', ' + a.intendedUse + '): ' +
                   a.vialsAllocated + '/' + a.vialsNeeded +
                   (a.fulfilled ? ' OK' : ' SHORTFALL=' + a.shortfall));
    }
    lines.push('');
    lines.push('PLAYBOOK');
    for (var k = 0; k < report.playbook.length; k++) {
        var p = report.playbook[k];
        lines.push('  [' + p.priority + '] ' + p.id + ' - ' + p.label);
    }
    lines.push('');
    lines.push('INSIGHTS');
    for (var m = 0; m < report.insights.length; m++) {
        lines.push('  - ' + report.insights[m].code + ': ' + report.insights[m].detail);
    }
    return lines.join('\n');
}

function _formatMarkdown(report) {
    var out = [];
    out.push('# Cell Bank Vial Advisor');
    out.push('');
    out.push('## Summary');
    out.push('');
    out.push('| Metric | Value |');
    out.push('| --- | --- |');
    out.push('| Headline | ' + _pipeEscape(report.headline) + ' |');
    out.push('| Grade | ' + _pipeEscape(report.grade) + ' |');
    out.push('| Risk score | ' + _pipeEscape(report.riskScore) + ' |');
    out.push('| Risk appetite | ' + _pipeEscape(report.riskAppetite) + ' |');
    out.push('| Total lines | ' + _pipeEscape(report.summary.totalLines) + ' |');
    out.push('| Total vial groups | ' + _pipeEscape(report.summary.totalVialGroups) + ' |');
    out.push('| Total vials | ' + _pipeEscape(report.summary.totalVials) + ' |');
    out.push('| Usable vials | ' + _pipeEscape(report.summary.usableVials) + ' |');
    out.push('');
    out.push('## Lines');
    out.push('');
    out.push('| Line | Verdict | Priority | Master | Working | Distribution |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    for (var i = 0; i < report.lines.length; i++) {
        var l = report.lines[i];
        out.push('| ' + _pipeEscape(l.name) + ' | ' + _pipeEscape(l.primaryVerdict) +
                 ' | ' + _pipeEscape(l.priority) + ' | ' + _pipeEscape(l.usableByBank.master) +
                 ' | ' + _pipeEscape(l.usableByBank.working) +
                 ' | ' + _pipeEscape(l.usableByBank.distribution) + ' |');
    }
    out.push('');
    out.push('## Vials');
    out.push('');
    out.push('| Vial | Line | Bank | Passage | Verdict | Priority |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    for (var v = 0; v < report.vials.length; v++) {
        var vc = report.vials[v];
        out.push('| ' + _pipeEscape(vc.id) + ' | ' + _pipeEscape(vc.cellLine) +
                 ' | ' + _pipeEscape(vc.bankType) + ' | P' + _pipeEscape(vc.passageNumber) +
                 ' | ' + _pipeEscape(vc.primaryVerdict) + ' | ' + _pipeEscape(vc.priority) + ' |');
    }
    out.push('');
    out.push('## Allocations');
    out.push('');
    out.push('| Request | Line | Use | Needed | Allocated | Fulfilled | Picks |');
    out.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (var a = 0; a < report.allocations.length; a++) {
        var al = report.allocations[a];
        var pickStr = al.picks.map(function (p) {
            return p.vialId + '(' + p.bankType + ',P' + p.passage + ',x' + p.vialsTaken + ')';
        }).join(' ');
        out.push('| ' + _pipeEscape(al.requestId) + ' | ' + _pipeEscape(al.cellLine) +
                 ' | ' + _pipeEscape(al.intendedUse) + ' | ' + _pipeEscape(al.vialsNeeded) +
                 ' | ' + _pipeEscape(al.vialsAllocated) + ' | ' + _pipeEscape(al.fulfilled) +
                 ' | ' + _pipeEscape(pickStr) + ' |');
    }
    out.push('');
    out.push('## Playbook');
    out.push('');
    out.push('| Priority | Action | Owner | Blast | Reversibility |');
    out.push('| --- | --- | --- | --- | --- |');
    for (var p = 0; p < report.playbook.length; p++) {
        var pa = report.playbook[p];
        out.push('| ' + _pipeEscape(pa.priority) + ' | ' + _pipeEscape(pa.label) +
                 ' | ' + _pipeEscape(pa.owner) + ' | ' + _pipeEscape(pa.blastRadius) +
                 ' | ' + _pipeEscape(pa.reversibility) + ' |');
    }
    out.push('');
    out.push('## Insights');
    out.push('');
    for (var m = 0; m < report.insights.length; m++) {
        out.push('- **' + report.insights[m].code + '**: ' + report.insights[m].detail);
    }
    return out.join('\n');
}

function _formatJson(report) {
    return JSON.stringify(_sortedJson(report), null, 2);
}

// ====================================================================
// Public factory
// ====================================================================

/**
 * Create a Cell Bank Vial Advisor.
 *
 * @param {object} [options]
 * @param {function():Date} [options.now] Inject a clock for deterministic tests.
 * @returns {object} Advisor instance with .evaluate() and format helpers.
 */
function createCellBankVialAdvisor(options) {
    options = options || {};
    var now = typeof options.now === 'function' ? options.now : function () { return new Date(); };

    function evaluate(input) {
        var raw = _stripDangerous(input || {}, true);
        var appetite = String(raw.riskAppetite || 'balanced').toLowerCase();
        if (!RISK_APPETITES[appetite]) appetite = 'balanced';
        var nowVal = now();
        if (!(nowVal instanceof Date) || isNaN(nowVal.getTime())) {
            throw new Error('cellBankVialAdvisor: now() must return a valid Date');
        }

        // Normalize inputs
        var lines = [];
        var lineIdx = Object.create(null);
        var rawLines = Array.isArray(raw.cellLines) ? raw.cellLines : [];
        for (var i = 0; i < rawLines.length; i++) {
            var l = _normalizeLine(rawLines[i]);
            if (l) {
                lines.push(l);
                lineIdx[l.name] = l;
            }
        }
        var vials = [];
        var rawVials = Array.isArray(raw.vials) ? raw.vials : [];
        for (var j = 0; j < rawVials.length; j++) {
            var vv = _normalizeVial(rawVials[j], nowVal);
            if (vv) vials.push(vv);
        }
        var requests = [];
        var rawRequests = Array.isArray(raw.requests) ? raw.requests : [];
        for (var k = 0; k < rawRequests.length; k++) {
            var rr = _normalizeRequest(rawRequests[k]);
            if (rr) requests.push(rr);
        }

        // Add UNKNOWN_LINE shims for any cell line referenced but not registered
        var unknownLineNames = {};
        for (var u = 0; u < vials.length; u++) {
            if (!lineIdx[vials[u].cellLine]) unknownLineNames[vials[u].cellLine] = true;
        }
        for (var ur = 0; ur < requests.length; ur++) {
            if (!lineIdx[requests[ur].cellLine]) unknownLineNames[requests[ur].cellLine] = true;
        }

        // Per-vial classification
        var vialClassifications = vials.map(function (v) {
            return _classifyVial(v, lineIdx[v.cellLine] || null, nowVal);
        });

        // Per-line classification
        var lineClassifications = lines.map(function (l) {
            return _classifyLine(l, vialClassifications, appetite);
        });
        // Append synthetic UNKNOWN_LINE entries
        var unknownArr = Object.keys(unknownLineNames).sort();
        for (var w = 0; w < unknownArr.length; w++) {
            var name = unknownArr[w];
            var counts = { master: 0, working: 0, distribution: 0 };
            var usable = { master: 0, working: 0, distribution: 0 };
            for (var x = 0; x < vialClassifications.length; x++) {
                if (vialClassifications[x].cellLine !== name) continue;
                counts[vialClassifications[x].bankType] += vialClassifications[x].vialCount;
                if (!vialClassifications[x].blocking) {
                    usable[vialClassifications[x].bankType] += vialClassifications[x].vialCount;
                }
            }
            lineClassifications.push({
                name: name,
                verdicts: ['UNKNOWN_LINE'],
                primaryVerdict: 'UNKNOWN_LINE',
                priority: LINE_VERDICTS.UNKNOWN_LINE.priority,
                totalsByBank: counts,
                usableByBank: usable,
                blockedCount: 0,
                qcOverdueCount: 0,
                highThawCount: 0,
                agingCount: 0,
                reasons: [{ code: 'NO_REGISTRY_ENTRY',
                            detail: 'line referenced by vial or request but missing from registry' }],
                effectiveFloors: { master: 0, working: 0, warningRunway: 0 },
            });
        }

        // Allocations
        var allocations = requests.map(function (r) {
            return _planAllocation(r, lineIdx[r.cellLine] || null, vials, vialClassifications, nowVal);
        });

        // Playbook, insights, score, grade
        var playbook = _buildPlaybook(lineClassifications, vialClassifications, allocations, appetite);
        var insights = _buildInsights(lineClassifications, vialClassifications, allocations);
        var riskScore = _portfolioScore(lineClassifications, allocations, appetite);
        var grade = _gradeFromScore(riskScore, lineClassifications);

        // Summary
        var totalVials = 0;
        var usableVials = 0;
        for (var s = 0; s < vialClassifications.length; s++) {
            totalVials += vialClassifications[s].vialCount;
            if (!vialClassifications[s].blocking) usableVials += vialClassifications[s].vialCount;
        }

        var unfulfilled = allocations.filter(function (a) { return !a.fulfilled; }).length;
        var headline = 'Cell-bank ' + lines.length + ' line(s), ' + totalVials +
                       ' vial(s) (' + usableVials + ' usable), ' +
                       requests.length + ' request(s), ' + unfulfilled + ' unfulfilled - grade ' + grade;

        return {
            generatedAt: nowVal.toISOString(),
            riskAppetite: appetite,
            riskScore: riskScore,
            grade: grade,
            headline: headline,
            summary: {
                totalLines: lines.length,
                unknownLines: unknownArr.length,
                totalVialGroups: vialClassifications.length,
                totalVials: totalVials,
                usableVials: usableVials,
                totalRequests: requests.length,
                fulfilledRequests: allocations.length - unfulfilled,
                unfulfilledRequests: unfulfilled,
            },
            lines: lineClassifications,
            vials: vialClassifications,
            allocations: allocations,
            playbook: playbook,
            insights: insights,
        };
    }

    return {
        evaluate: evaluate,
        formatText: _formatText,
        formatMarkdown: _formatMarkdown,
        formatJson: _formatJson,
    };
}

module.exports = { createCellBankVialAdvisor: createCellBankVialAdvisor };
