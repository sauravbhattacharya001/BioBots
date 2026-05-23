'use strict';

/**
 * CryoChainIntegrityAdvisor - agentic cold-chain integrity monitor for
 * cryogenic storage assets (-80 freezers, -150 freezers, LN2 dewars,
 * vapour-phase storage) and the sample-out-of-cryo transport events
 * that touch them.
 *
 * Distinct from sibling modules:
 *   - cellBankVialAdvisor: who owns vials, what passage, allocation
 *     plans. It does not look at the freezer hardware or LN2 supply.
 *   - cleanroomEnvironmentDriftAdvisor: ambient cleanroom temp / RH /
 *     particle counts. It does not look inside the freezers or LN2
 *     dewars.
 *   - equipmentDowntimeRiskAdvisor: generic failure-risk scoring for
 *     any lab asset. It does not understand "the -80 was opened 47
 *     times in the last hour" or "this vial was sitting on the bench
 *     for 11 minutes mid-protocol".
 *
 * This module answers the cryo manager's question:
 *
 *   "Across my freezers/dewars and the recent sample handling events,
 *    where is the cold chain breaking down, what is the projected
 *    runway, and what should I do P0-first this shift?"
 *
 * Inputs (all optional; the advisor degrades gracefully):
 *
 *   freezers        array of {
 *     id, name?, kind ('minus80'|'minus150'|'ln2_dewar'|'ln2_vapour'|'fridge'),
 *     setpointC (target temperature, e.g. -80),
 *     toleranceC (allowed deviation, default 5),
 *     readings?: [{ ts (ISO), tempC }],
 *     doorOpenEvents?: [{ ts, durationSec }],
 *     ln2LevelPct?,         // for dewars / vapour
 *     ln2BoilOffPctPerDay?, // override; otherwise inferred from level history
 *     ln2LevelHistory?: [{ ts, levelPct }],
 *     backupAvailable?, scheduledServiceWithinDays?, criticality? (1-5),
 *     contents?: { vialCount, irreplaceableCount? }
 *   }
 *
 *   sampleEvents    array of {
 *     id, sampleId, ts (ISO), kind ('thaw'|'transfer'|'bench_exposure'|'transport'),
 *     durationSec, exposedTempC, returnedTo? (freezerId),
 *     vialCount?, irreplaceable?
 *   }
 *
 *   options         { risk_appetite ('cautious'|'balanced'|'aggressive'),
 *                     now (callable returning Date),
 *                     benchExposureMaxSec (default 300),
 *                     ln2RefillThresholdPct (default 30),
 *                     ln2CriticalPct (default 15),
 *                     excursionMinSec (default 60) }
 *
 * Per-asset verdicts (worst-first):
 *   CRITICAL_EXCURSION       reading > setpoint + 2*tolerance, or
 *                            LN2 below critical floor
 *   TEMP_DRIFT               sustained reading outside tolerance for
 *                            >= excursionMinSec
 *   LN2_REFILL_NEEDED        level <= refill threshold and projected
 *                            depletion <= 7 days
 *   LN2_RUNWAY_LOW           projected depletion <= 14 days
 *   EXCESS_DOOR_TIME         total door-open seconds in last hour
 *                            exceeds doorBudgetSecPerHour
 *   FREQUENT_DOOR_OPEN       door-open events >= 12/hour
 *   STALE_SENSOR             no readings for >= 24h, or no ln2 history
 *                            for >= 7d (with hardware in scope)
 *   STABLE                   none of the above
 *   INSUFFICIENT_DATA        no readings AND no level history
 *
 * Per-sample-event verdicts:
 *   SAMPLE_LOST_TO_THAW      exposedTempC > sample-class allow-max
 *                            (>= 0C for cryo material) for any duration
 *   SAMPLE_OVER_EXPOSED      durationSec > benchExposureMaxSec
 *   SAMPLE_REPEAT_HANDLING   same sampleId appears in >= 3 events in 24h
 *   SAMPLE_OK                under all thresholds
 *
 * 0-100 risk_score = clamp(top_severity + 0.4 * min(rest_sum, 60))
 * modulated by risk_appetite (cautious 1.15x, balanced 1.0x,
 * aggressive 0.85x). A-F grade. P0-first deduped playbook with
 * structured owners and blast/reversibility. Always-on insights.
 *
 * Pure CommonJS, zero deps, deterministic given an injectable now(),
 * never mutates inputs (deep-copy via JSON.parse / JSON.stringify
 * where structured passthrough is needed).
 */

var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

var ASSET_VERDICTS = {
    CRITICAL_EXCURSION: 'CRITICAL_EXCURSION',
    TEMP_DRIFT: 'TEMP_DRIFT',
    LN2_REFILL_NEEDED: 'LN2_REFILL_NEEDED',
    LN2_RUNWAY_LOW: 'LN2_RUNWAY_LOW',
    EXCESS_DOOR_TIME: 'EXCESS_DOOR_TIME',
    FREQUENT_DOOR_OPEN: 'FREQUENT_DOOR_OPEN',
    STALE_SENSOR: 'STALE_SENSOR',
    STABLE: 'STABLE',
    INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
};

var SAMPLE_VERDICTS = {
    SAMPLE_LOST_TO_THAW: 'SAMPLE_LOST_TO_THAW',
    SAMPLE_OVER_EXPOSED: 'SAMPLE_OVER_EXPOSED',
    SAMPLE_REPEAT_HANDLING: 'SAMPLE_REPEAT_HANDLING',
    SAMPLE_OK: 'SAMPLE_OK',
};

var APPETITE_MULT = { cautious: 1.15, balanced: 1.0, aggressive: 0.85 };

// Severities by code (single source of truth so playbook math is stable)
var SEVERITY = {
    CRITICAL_EXCURSION: 95,
    TEMP_DRIFT: 60,
    LN2_REFILL_NEEDED: 70,
    LN2_RUNWAY_LOW: 45,
    EXCESS_DOOR_TIME: 35,
    FREQUENT_DOOR_OPEN: 25,
    STALE_SENSOR: 40,
    STABLE: 0,
    INSUFFICIENT_DATA: 10,
    SAMPLE_LOST_TO_THAW: 90,
    SAMPLE_OVER_EXPOSED: 55,
    SAMPLE_REPEAT_HANDLING: 35,
    SAMPLE_OK: 0,
};

var VERDICT_PRIORITY = {
    CRITICAL_EXCURSION: 'P0',
    TEMP_DRIFT: 'P1',
    LN2_REFILL_NEEDED: 'P0',
    LN2_RUNWAY_LOW: 'P1',
    EXCESS_DOOR_TIME: 'P2',
    FREQUENT_DOOR_OPEN: 'P2',
    STALE_SENSOR: 'P2',
    STABLE: 'P3',
    INSUFFICIENT_DATA: 'P3',
    SAMPLE_LOST_TO_THAW: 'P0',
    SAMPLE_OVER_EXPOSED: 'P1',
    SAMPLE_REPEAT_HANDLING: 'P2',
    SAMPLE_OK: 'P3',
};

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function _normalizeAppetite(a) {
    if (a === 'cautious' || a === 'balanced' || a === 'aggressive') return a;
    return 'balanced';
}

function _toDate(v) {
    if (v == null) return null;
    var d = (v instanceof Date) ? v : new Date(v);
    return isNaN(d.getTime()) ? null : d;
}

function _hoursBetween(a, b) {
    return Math.abs((a.getTime() - b.getTime()) / 3600000);
}

function _daysBetween(a, b) {
    return Math.abs((a.getTime() - b.getTime()) / 86400000);
}

function _classifyAsset(freezer, now, opts) {
    var verdicts = [];
    var reasons = [];
    var details = {
        latestTempC: null,
        latestReadingISO: null,
        excursionSeconds: 0,
        worstReadingC: null,
        ln2LevelPct: null,
        projectedDaysToCritical: null,
        doorOpenSecLastHour: 0,
        doorOpensLastHour: 0,
    };

    var setpoint = (typeof freezer.setpointC === 'number') ? freezer.setpointC : null;
    var tol = (typeof freezer.toleranceC === 'number' && freezer.toleranceC > 0)
        ? freezer.toleranceC : 5;
    var critTol = 2 * tol;

    // ---- temperature readings ----
    var readings = Array.isArray(freezer.readings) ? freezer.readings.slice() : [];
    readings.sort(function (a, b) {
        var ta = _toDate(a && a.ts); var tb = _toDate(b && b.ts);
        return (ta ? ta.getTime() : 0) - (tb ? tb.getTime() : 0);
    });

    if (readings.length > 0) {
        var last = readings[readings.length - 1];
        var lastTs = _toDate(last && last.ts);
        if (lastTs) {
            details.latestTempC = (typeof last.tempC === 'number') ? last.tempC : null;
            details.latestReadingISO = lastTs.toISOString();
            // stale sensor: no reading for 24h
            if (_hoursBetween(lastTs, now) >= 24) {
                verdicts.push(ASSET_VERDICTS.STALE_SENSOR);
                reasons.push('NO_TEMP_READING_24H');
            }
        }

        // excursion window: any contiguous run outside tolerance
        var inExcursion = false;
        var excursionStart = null;
        var totalExcursionSec = 0;
        var worst = null;
        var critFlag = false;
        for (var i = 0; i < readings.length; i++) {
            var r = readings[i];
            var rt = _toDate(r && r.ts);
            var t = (r && typeof r.tempC === 'number') ? r.tempC : null;
            if (rt == null || t == null || setpoint == null) continue;
            var delta = t - setpoint; // positive = warmer than setpoint
            if (worst == null || Math.abs(t - setpoint) > Math.abs(worst - setpoint)) {
                worst = t;
            }
            if (delta > critTol) critFlag = true;
            if (Math.abs(delta) > tol) {
                if (!inExcursion) { inExcursion = true; excursionStart = rt; }
            } else {
                if (inExcursion) {
                    totalExcursionSec += Math.max(0, (rt.getTime() - excursionStart.getTime()) / 1000);
                    inExcursion = false;
                    excursionStart = null;
                }
            }
        }
        if (inExcursion && excursionStart) {
            var endTs = _toDate(readings[readings.length - 1].ts);
            totalExcursionSec += Math.max(0, (endTs.getTime() - excursionStart.getTime()) / 1000);
        }
        details.worstReadingC = worst;
        details.excursionSeconds = Math.round(totalExcursionSec);

        if (critFlag) {
            verdicts.push(ASSET_VERDICTS.CRITICAL_EXCURSION);
            reasons.push('READING_BEYOND_2X_TOLERANCE');
        } else if (totalExcursionSec >= (opts.excursionMinSec || 60)) {
            verdicts.push(ASSET_VERDICTS.TEMP_DRIFT);
            reasons.push('SUSTAINED_OUT_OF_TOLERANCE_' + Math.round(totalExcursionSec) + 's');
        }
    }

    // ---- door-open events (last hour) ----
    var doors = Array.isArray(freezer.doorOpenEvents) ? freezer.doorOpenEvents : [];
    var hourCutoff = new Date(now.getTime() - 3600000);
    var doorSec = 0, doorCount = 0;
    for (var d = 0; d < doors.length; d++) {
        var dt = _toDate(doors[d] && doors[d].ts);
        if (dt && dt >= hourCutoff) {
            doorCount += 1;
            doorSec += Math.max(0, doors[d].durationSec || 0);
        }
    }
    details.doorOpenSecLastHour = doorSec;
    details.doorOpensLastHour = doorCount;
    var doorBudget = (freezer.kind === 'minus150' || freezer.kind === 'ln2_dewar') ? 60 : 180;
    if (doorSec > doorBudget) {
        verdicts.push(ASSET_VERDICTS.EXCESS_DOOR_TIME);
        reasons.push('DOOR_OPEN_' + doorSec + 's_LAST_HOUR_BUDGET_' + doorBudget);
    }
    if (doorCount >= 12) {
        verdicts.push(ASSET_VERDICTS.FREQUENT_DOOR_OPEN);
        reasons.push('DOOR_OPENED_' + doorCount + '_TIMES_LAST_HOUR');
    }

    // ---- LN2 levels ----
    if (freezer.kind === 'ln2_dewar' || freezer.kind === 'ln2_vapour') {
        var level = (typeof freezer.ln2LevelPct === 'number') ? freezer.ln2LevelPct : null;
        details.ln2LevelPct = level;
        var boilOff = (typeof freezer.ln2BoilOffPctPerDay === 'number')
            ? freezer.ln2BoilOffPctPerDay : null;

        // infer boil-off from history if not supplied
        var hist = Array.isArray(freezer.ln2LevelHistory) ? freezer.ln2LevelHistory.slice() : [];
        hist.sort(function (a, b) {
            var ta = _toDate(a && a.ts); var tb = _toDate(b && b.ts);
            return (ta ? ta.getTime() : 0) - (tb ? tb.getTime() : 0);
        });
        if (boilOff == null && hist.length >= 2) {
            var firstH = hist[0]; var lastH = hist[hist.length - 1];
            var t1 = _toDate(firstH && firstH.ts); var t2 = _toDate(lastH && lastH.ts);
            if (t1 && t2 && t2 > t1 && typeof firstH.levelPct === 'number'
                    && typeof lastH.levelPct === 'number') {
                var deltaPct = firstH.levelPct - lastH.levelPct;
                var days = _daysBetween(t2, t1);
                if (days > 0 && deltaPct > 0) {
                    boilOff = deltaPct / days;
                }
            }
        }
        if (boilOff == null) boilOff = 2.5; // sane default for vapour shipper
        if (level != null) {
            var crit = (typeof opts.ln2CriticalPct === 'number') ? opts.ln2CriticalPct : 15;
            var refill = (typeof opts.ln2RefillThresholdPct === 'number')
                ? opts.ln2RefillThresholdPct : 30;
            var headroom = Math.max(0, level - crit);
            var projDays = boilOff > 0 ? (headroom / boilOff) : null;
            details.projectedDaysToCritical = projDays != null
                ? Math.round(projDays * 10) / 10 : null;
            if (level <= crit) {
                verdicts.push(ASSET_VERDICTS.CRITICAL_EXCURSION);
                reasons.push('LN2_BELOW_CRITICAL_FLOOR_' + level + 'pct');
            } else if (level <= refill && projDays != null && projDays <= 7) {
                verdicts.push(ASSET_VERDICTS.LN2_REFILL_NEEDED);
                reasons.push('LN2_AT_' + level + 'pct_PROJ_' + details.projectedDaysToCritical + 'd');
            } else if (projDays != null && projDays <= 14) {
                verdicts.push(ASSET_VERDICTS.LN2_RUNWAY_LOW);
                reasons.push('LN2_RUNWAY_' + details.projectedDaysToCritical + 'd');
            }
        } else if (readings.length === 0) {
            // dewar in scope but no level + no temp readings
            verdicts.push(ASSET_VERDICTS.STALE_SENSOR);
            reasons.push('NO_LN2_LEVEL_NO_TEMP');
        }
    }

    // ---- collapse to a single ranked verdict ----
    var hasInsufficient = (readings.length === 0
        && (freezer.kind !== 'ln2_dewar' && freezer.kind !== 'ln2_vapour'));
    var primaryVerdict;
    if (verdicts.length === 0) {
        primaryVerdict = hasInsufficient ? ASSET_VERDICTS.INSUFFICIENT_DATA : ASSET_VERDICTS.STABLE;
    } else {
        // rank by severity descending
        verdicts.sort(function (a, b) { return SEVERITY[b] - SEVERITY[a]; });
        primaryVerdict = verdicts[0];
    }

    return {
        id: freezer.id,
        name: freezer.name || freezer.id,
        kind: freezer.kind || 'unknown',
        criticality: freezer.criticality || 3,
        verdict: primaryVerdict,
        allVerdicts: verdicts.slice(),
        priority: VERDICT_PRIORITY[primaryVerdict] || 'P3',
        severity: SEVERITY[primaryVerdict] || 0,
        reasons: reasons,
        details: details,
    };
}

function _classifySampleEvent(ev, now) {
    var reasons = [];
    var verdicts = [];

    var exposed = (typeof ev.exposedTempC === 'number') ? ev.exposedTempC : null;
    var dur = (typeof ev.durationSec === 'number') ? ev.durationSec : null;

    if (exposed != null && exposed >= 0) {
        verdicts.push(SAMPLE_VERDICTS.SAMPLE_LOST_TO_THAW);
        reasons.push('EXPOSED_AT_' + exposed + 'C');
    }
    if (dur != null && dur > 300) {
        verdicts.push(SAMPLE_VERDICTS.SAMPLE_OVER_EXPOSED);
        reasons.push('OUT_OF_CRYO_' + dur + 's');
    }

    var verdict;
    if (verdicts.length === 0) verdict = SAMPLE_VERDICTS.SAMPLE_OK;
    else { verdicts.sort(function (a, b) { return SEVERITY[b] - SEVERITY[a]; }); verdict = verdicts[0]; }

    return {
        id: ev.id || ('evt_' + (ev.sampleId || 'x') + '_' + (ev.ts || '')),
        sampleId: ev.sampleId || null,
        kind: ev.kind || 'transfer',
        ts: ev.ts || null,
        verdict: verdict,
        allVerdicts: verdicts.slice(),
        priority: VERDICT_PRIORITY[verdict] || 'P3',
        severity: SEVERITY[verdict] || 0,
        reasons: reasons,
        durationSec: dur,
        exposedTempC: exposed,
        vialCount: ev.vialCount || null,
        irreplaceable: !!ev.irreplaceable,
    };
}

function _detectRepeatHandling(sampleClassifications, now) {
    var byId = {};
    for (var i = 0; i < sampleClassifications.length; i++) {
        var s = sampleClassifications[i];
        if (!s.sampleId) continue;
        var ts = _toDate(s.ts);
        if (!ts) continue;
        if (_hoursBetween(ts, now) > 24) continue;
        if (!byId[s.sampleId]) byId[s.sampleId] = [];
        byId[s.sampleId].push(s);
    }
    Object.keys(byId).forEach(function (sid) {
        var group = byId[sid];
        if (group.length >= 3) {
            for (var j = 0; j < group.length; j++) {
                var sc = group[j];
                if (sc.verdict === SAMPLE_VERDICTS.SAMPLE_OK) {
                    sc.verdict = SAMPLE_VERDICTS.SAMPLE_REPEAT_HANDLING;
                    sc.priority = VERDICT_PRIORITY[sc.verdict];
                    sc.severity = SEVERITY[sc.verdict];
                }
                sc.allVerdicts.push(SAMPLE_VERDICTS.SAMPLE_REPEAT_HANDLING);
                sc.reasons.push('REPEAT_HANDLING_' + group.length + 'X_24H');
            }
        }
    });
}

function _portfolioScore(assets, sampleEvts, appetite) {
    var mult = APPETITE_MULT[appetite] || 1.0;
    var sevs = [];
    for (var i = 0; i < assets.length; i++) sevs.push(assets[i].severity * (assets[i].criticality / 3));
    for (var j = 0; j < sampleEvts.length; j++) sevs.push(sampleEvts[j].severity);
    if (sevs.length === 0) return 0;
    sevs.sort(function (a, b) { return b - a; });
    var top = sevs[0];
    var rest = 0;
    for (var k = 1; k < sevs.length; k++) rest += sevs[k];
    var score = top + 0.4 * Math.min(rest, 60);
    return Math.round(_clamp(score * mult, 0, 100));
}

function _gradeFromScore(score, assets, sampleEvts) {
    var forcedF = false;
    for (var i = 0; i < assets.length; i++) {
        if (assets[i].verdict === ASSET_VERDICTS.CRITICAL_EXCURSION
                && assets[i].criticality >= 4) {
            forcedF = true; break;
        }
    }
    if (!forcedF) {
        for (var j = 0; j < sampleEvts.length; j++) {
            if (sampleEvts[j].verdict === SAMPLE_VERDICTS.SAMPLE_LOST_TO_THAW
                    && sampleEvts[j].irreplaceable) {
                forcedF = true; break;
            }
        }
    }
    if (forcedF) return 'F';
    if (score >= 75) return 'F';
    if (score >= 55) return 'D';
    if (score >= 35) return 'C';
    if (score >= 18) return 'B';
    return 'A';
}

function _buildPlaybook(assets, sampleEvts, appetite, grade) {
    var actions = [];
    var critAssets = assets.filter(function (a) { return a.verdict === ASSET_VERDICTS.CRITICAL_EXCURSION; });
    var driftAssets = assets.filter(function (a) { return a.verdict === ASSET_VERDICTS.TEMP_DRIFT; });
    var refillAssets = assets.filter(function (a) { return a.verdict === ASSET_VERDICTS.LN2_REFILL_NEEDED; });
    var runwayAssets = assets.filter(function (a) { return a.verdict === ASSET_VERDICTS.LN2_RUNWAY_LOW; });
    var doorAssets = assets.filter(function (a) {
        return a.verdict === ASSET_VERDICTS.EXCESS_DOOR_TIME
            || a.verdict === ASSET_VERDICTS.FREQUENT_DOOR_OPEN;
    });
    var staleAssets = assets.filter(function (a) { return a.verdict === ASSET_VERDICTS.STALE_SENSOR; });
    var lostSamples = sampleEvts.filter(function (s) { return s.verdict === SAMPLE_VERDICTS.SAMPLE_LOST_TO_THAW; });
    var overSamples = sampleEvts.filter(function (s) { return s.verdict === SAMPLE_VERDICTS.SAMPLE_OVER_EXPOSED; });
    var repeatSamples = sampleEvts.filter(function (s) { return s.verdict === SAMPLE_VERDICTS.SAMPLE_REPEAT_HANDLING; });

    function ids(arr) { return arr.map(function (x) { return x.id; }); }

    if (critAssets.length > 0) {
        actions.push({
            id: 'EVACUATE_ASSETS_TO_BACKUP',
            priority: 'P0',
            label: 'Evacuate samples from failing freezers to backup units',
            reason: critAssets.length + ' freezer(s) reading beyond 2x tolerance or LN2 below floor.',
            owner: 'on_call_facilities',
            blastRadius: 5,
            reversibility: 'low',
            relatedAssetIds: ids(critAssets),
        });
        actions.push({
            id: 'PAGE_FACILITIES_ON_CALL',
            priority: 'P0',
            label: 'Page facilities on-call for emergency cold-chain failure',
            reason: 'Critical-excursion freezers require immediate intervention.',
            owner: 'on_call_facilities',
            blastRadius: 3,
            reversibility: 'high',
            relatedAssetIds: ids(critAssets),
        });
    }
    if (refillAssets.length > 0) {
        actions.push({
            id: 'REFILL_LN2_DEWARS_NOW',
            priority: 'P0',
            label: 'Refill LN2 dewars within 24h',
            reason: refillAssets.length + ' dewar(s) below refill threshold with <=7d projected runway.',
            owner: 'facilities',
            blastRadius: 2,
            reversibility: 'high',
            relatedAssetIds: ids(refillAssets),
        });
    }
    if (lostSamples.length > 0) {
        actions.push({
            id: 'QUARANTINE_THAWED_SAMPLES',
            priority: 'P0',
            label: 'Quarantine samples exposed at >= 0C',
            reason: lostSamples.length + ' sample event(s) reached non-cryogenic temperatures.',
            owner: 'lab_manager',
            blastRadius: 3,
            reversibility: 'low',
            relatedSampleIds: ids(lostSamples),
        });
    }
    if (driftAssets.length > 0) {
        actions.push({
            id: 'INVESTIGATE_TEMP_DRIFT',
            priority: 'P1',
            label: 'Investigate sustained temperature drift',
            reason: driftAssets.length + ' freezer(s) outside tolerance for >= ' + 60 + 's.',
            owner: 'maintenance',
            blastRadius: 2,
            reversibility: 'high',
            relatedAssetIds: ids(driftAssets),
        });
    }
    if (runwayAssets.length > 0) {
        actions.push({
            id: 'SCHEDULE_LN2_REFILL',
            priority: 'P1',
            label: 'Schedule LN2 refill within 14d window',
            reason: runwayAssets.length + ' dewar(s) projected to hit critical in 14d.',
            owner: 'facilities',
            blastRadius: 1,
            reversibility: 'high',
            relatedAssetIds: ids(runwayAssets),
        });
    }
    if (overSamples.length > 0) {
        actions.push({
            id: 'REVIEW_HANDLING_PROTOCOL',
            priority: 'P1',
            label: 'Review handling protocol for over-exposed samples',
            reason: overSamples.length + ' sample event(s) exceeded bench-exposure budget.',
            owner: 'lab_manager',
            blastRadius: 2,
            reversibility: 'high',
            relatedSampleIds: ids(overSamples),
        });
    }
    if (doorAssets.length > 0) {
        actions.push({
            id: 'CURB_DOOR_ACTIVITY',
            priority: 'P2',
            label: 'Curb door-open activity on stressed freezers',
            reason: doorAssets.length + ' freezer(s) over door budget or door-open count.',
            owner: 'lab_manager',
            blastRadius: 1,
            reversibility: 'high',
            relatedAssetIds: ids(doorAssets),
        });
    }
    if (repeatSamples.length > 0) {
        actions.push({
            id: 'BATCH_REPEAT_HANDLING',
            priority: 'P2',
            label: 'Batch repeat-handled samples into a single workflow',
            reason: 'Same sample handled >=3 times in 24h - batch to reduce cumulative thaw exposure.',
            owner: 'lab_manager',
            blastRadius: 1,
            reversibility: 'high',
            relatedSampleIds: ids(repeatSamples),
        });
    }
    if (staleAssets.length > 0) {
        actions.push({
            id: 'RESTORE_SENSOR_TELEMETRY',
            priority: 'P2',
            label: 'Restore stale freezer telemetry',
            reason: staleAssets.length + ' asset(s) missing recent readings.',
            owner: 'data_steward',
            blastRadius: 1,
            reversibility: 'high',
            relatedAssetIds: ids(staleAssets),
        });
    }

    // Cautious appends; Aggressive trims P3/lone-P2
    if (appetite === 'cautious' && (grade === 'C' || grade === 'D' || grade === 'F')) {
        actions.push({
            id: 'SCHEDULE_COLD_CHAIN_AUDIT',
            priority: 'P2',
            label: 'Schedule full cold-chain audit',
            reason: 'Cautious posture + degraded grade.',
            owner: 'qa',
            blastRadius: 1,
            reversibility: 'high',
            relatedAssetIds: [],
        });
    }
    if (actions.length === 0) {
        actions.push({
            id: 'MAINTAIN_COLD_CHAIN_WATCH',
            priority: 'P3',
            label: 'Maintain routine cold-chain monitoring',
            reason: 'No cold-chain risks above threshold detected.',
            owner: 'lab_manager',
            blastRadius: 1,
            reversibility: 'high',
            relatedAssetIds: [],
        });
    }

    // Dedup by id (keep first), sort priority asc, id asc
    var seen = {};
    var deduped = [];
    for (var i = 0; i < actions.length; i++) {
        if (!seen[actions[i].id]) { seen[actions[i].id] = true; deduped.push(actions[i]); }
    }
    deduped.sort(function (a, b) {
        var pa = PRIORITY_RANK[a.priority], pb = PRIORITY_RANK[b.priority];
        if (pa !== pb) return pa - pb;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });

    if (appetite === 'aggressive') {
        var hasP01 = deduped.some(function (a) { return a.priority === 'P0' || a.priority === 'P1'; });
        if (hasP01) {
            deduped = deduped.filter(function (a) {
                if (a.priority === 'P3') return false;
                return true;
            });
            var p2Count = deduped.filter(function (a) { return a.priority === 'P2'; }).length;
            if (p2Count === 1) {
                deduped = deduped.filter(function (a) { return a.priority !== 'P2'; });
            }
        }
    }

    return deduped;
}

function _buildInsights(assets, sampleEvts) {
    var insights = [];
    // Single-pass tally over assets — was 6 separate .filter().length scans (O(6N) → O(N)).
    var critCount = 0, refillCount = 0, driftCount = 0, doorCount = 0, ln2RunwayShort = 0, stale = 0;
    for (var i = 0; i < assets.length; i++) {
        var a = assets[i];
        var v = a.verdict;
        if (v === ASSET_VERDICTS.CRITICAL_EXCURSION) critCount++;
        else if (v === ASSET_VERDICTS.LN2_REFILL_NEEDED) refillCount++;
        else if (v === ASSET_VERDICTS.TEMP_DRIFT) driftCount++;
        else if (v === ASSET_VERDICTS.STALE_SENSOR) stale++;
        var vs = a.allVerdicts || [];
        if (vs.indexOf(ASSET_VERDICTS.EXCESS_DOOR_TIME) >= 0
            || vs.indexOf(ASSET_VERDICTS.FREQUENT_DOOR_OPEN) >= 0) {
            doorCount++;
        }
        if (a.kind === 'ln2_dewar' && a.details.projectedDaysToCritical != null
            && a.details.projectedDaysToCritical <= 7) {
            ln2RunwayShort++;
        }
    }
    // Single-pass tally over sample events — was 2 separate .filter().length scans.
    var lostCount = 0, irreplaceableLost = 0;
    for (var j = 0; j < sampleEvts.length; j++) {
        var s = sampleEvts[j];
        if (s.verdict === SAMPLE_VERDICTS.SAMPLE_LOST_TO_THAW) {
            lostCount++;
            if (s.irreplaceable) irreplaceableLost++;
        }
    }

    if (critCount > 0) insights.push('CRITICAL_COLD_CHAIN_FAILURE');
    if (irreplaceableLost > 0) insights.push('IRREPLACEABLE_SAMPLE_LOSS');
    if (lostCount > 0 && irreplaceableLost === 0) insights.push('SAMPLE_THAW_EVENTS_DETECTED');
    if (refillCount >= 2) insights.push('LN2_FLEET_REFILL_NEEDED');
    if (ln2RunwayShort > 0 && refillCount === 0) insights.push('LN2_RUNWAY_LESS_THAN_WEEK');
    if (driftCount >= 2) insights.push('CLUSTERED_TEMP_DRIFT');
    if (doorCount >= 2) insights.push('HEAVY_FREEZER_TRAFFIC');
    if (stale >= 2) insights.push('TELEMETRY_GAPS_FLEET_WIDE');
    if (insights.length === 0) {
        if (assets.length === 0 && sampleEvts.length === 0) insights.push('NO_DATA_PROVIDED');
        else insights.push('COLD_CHAIN_INTACT');
    }
    return insights;
}

// ---- JSON byte-stable serializer ----
function _sortedJson(value) {
    function walk(v) {
        if (v == null) return v;
        if (Array.isArray(v)) return v.map(walk);
        if (typeof v === 'object') {
            if (v instanceof Date) return v.toISOString();
            var keys = Object.keys(v).sort();
            var out = {};
            for (var i = 0; i < keys.length; i++) out[keys[i]] = walk(v[keys[i]]);
            return out;
        }
        return v;
    }
    return JSON.stringify(walk(value), null, 2);
}

function _formatText(report) {
    var lines = [];
    lines.push('CryoChainIntegrityAdvisor :: grade=' + report.grade
        + ' risk=' + report.riskScore + ' appetite=' + report.riskAppetite);
    lines.push(report.headline);
    lines.push('');
    lines.push('Assets (' + report.assets.length + '):');
    for (var i = 0; i < report.assets.length; i++) {
        var a = report.assets[i];
        lines.push('  - [' + a.priority + '] ' + a.name + ' (' + a.kind + ') :: ' + a.verdict
            + (a.reasons.length ? ' :: ' + a.reasons.join('; ') : ''));
    }
    lines.push('Sample events (' + report.sampleEvents.length + '):');
    for (var j = 0; j < report.sampleEvents.length; j++) {
        var s = report.sampleEvents[j];
        lines.push('  - [' + s.priority + '] ' + (s.sampleId || s.id) + ' :: ' + s.verdict
            + (s.reasons.length ? ' :: ' + s.reasons.join('; ') : ''));
    }
    lines.push('Playbook:');
    for (var k = 0; k < report.playbook.length; k++) {
        var p = report.playbook[k];
        lines.push('  - [' + p.priority + '] ' + p.label + ' (' + p.owner + ', blast='
            + p.blastRadius + ', rev=' + p.reversibility + ')');
    }
    lines.push('Insights: ' + report.insights.join(', '));
    return lines.join('\n');
}

function _md(table) {
    return table.map(function (row) { return '| ' + row.join(' | ') + ' |'; }).join('\n');
}

function _formatMarkdown(report) {
    var out = [];
    out.push('# CryoChainIntegrityAdvisor report');
    out.push('');
    out.push('## Summary');
    var sumRows = [
        ['Metric', 'Value'],
        ['---', '---'],
        ['Grade', report.grade],
        ['Risk score', String(report.riskScore)],
        ['Risk appetite', report.riskAppetite],
        ['Assets monitored', String(report.assets.length)],
        ['Sample events analyzed', String(report.sampleEvents.length)],
        ['Generated at', report.generatedAt],
    ];
    out.push(_md(sumRows));
    out.push('');
    out.push('## Assets');
    if (report.assets.length === 0) {
        out.push('_No assets provided._');
    } else {
        var aRows = [
            ['Asset', 'Kind', 'Verdict', 'Priority', 'Reasons'],
            ['---', '---', '---', '---', '---']
        ];
        for (var i = 0; i < report.assets.length; i++) {
            var a = report.assets[i];
            aRows.push([a.name, a.kind, a.verdict, a.priority,
                (a.reasons || []).join('; ') || '-']);
        }
        out.push(_md(aRows));
    }
    out.push('');
    out.push('## Sample events');
    if (report.sampleEvents.length === 0) {
        out.push('_No sample events provided._');
    } else {
        var sRows = [
            ['Sample/event id', 'Kind', 'Verdict', 'Priority', 'Reasons'],
            ['---', '---', '---', '---', '---']
        ];
        for (var j = 0; j < report.sampleEvents.length; j++) {
            var s = report.sampleEvents[j];
            sRows.push([(s.sampleId || s.id), s.kind, s.verdict, s.priority,
                (s.reasons || []).join('; ') || '-']);
        }
        out.push(_md(sRows));
    }
    out.push('');
    out.push('## Playbook');
    var pRows = [
        ['Priority', 'Action', 'Owner', 'Blast', 'Reversibility', 'Reason'],
        ['---', '---', '---', '---', '---', '---']
    ];
    for (var k = 0; k < report.playbook.length; k++) {
        var p = report.playbook[k];
        pRows.push([p.priority, p.label, p.owner, String(p.blastRadius),
            p.reversibility, p.reason]);
    }
    out.push(_md(pRows));
    out.push('');
    out.push('## Insights');
    for (var m = 0; m < report.insights.length; m++) out.push('- ' + report.insights[m]);
    return out.join('\n');
}

function _formatJson(report) { return _sortedJson(report); }

function createCryoChainIntegrityAdvisor(opts) {
    opts = opts || {};
    var nowFn = (typeof opts.now === 'function') ? opts.now : function () { return new Date(); };

    function evaluate(input) {
        input = input || {};
        var appetite = _normalizeAppetite(input.risk_appetite || opts.risk_appetite);
        var nowVal = _toDate(nowFn());
        if (!nowVal) throw new Error('CryoChainIntegrityAdvisor: now() must return a valid Date');

        var optBag = {
            excursionMinSec: (typeof opts.excursionMinSec === 'number') ? opts.excursionMinSec : 60,
            ln2RefillThresholdPct: (typeof opts.ln2RefillThresholdPct === 'number')
                ? opts.ln2RefillThresholdPct : 30,
            ln2CriticalPct: (typeof opts.ln2CriticalPct === 'number') ? opts.ln2CriticalPct : 15,
            benchExposureMaxSec: (typeof opts.benchExposureMaxSec === 'number')
                ? opts.benchExposureMaxSec : 300,
        };

        var freezersIn = Array.isArray(input.freezers) ? input.freezers : [];
        var samplesIn = Array.isArray(input.sampleEvents) ? input.sampleEvents : [];

        // deep-copy inputs so we never mutate caller-owned objects
        var freezers = JSON.parse(JSON.stringify(freezersIn));
        var samples = JSON.parse(JSON.stringify(samplesIn));

        var assetClassifications = freezers.map(function (f) { return _classifyAsset(f, nowVal, optBag); });
        var sampleClassifications = samples.map(function (e) { return _classifySampleEvent(e, nowVal); });
        _detectRepeatHandling(sampleClassifications, nowVal);

        var riskScore = _portfolioScore(assetClassifications, sampleClassifications, appetite);
        var grade = _gradeFromScore(riskScore, assetClassifications, sampleClassifications);
        var playbook = _buildPlaybook(assetClassifications, sampleClassifications, appetite, grade);
        var insights = _buildInsights(assetClassifications, sampleClassifications);

        // Single-pass priority tally — was 2 .filter().length scans over playbook.
        var p0 = 0, p1 = 0;
        for (var pi = 0; pi < playbook.length; pi++) {
            var pr = playbook[pi].priority;
            if (pr === 'P0') p0++;
            else if (pr === 'P1') p1++;
        }
        var headline = 'Cold-chain ' + assetClassifications.length + ' asset(s), '
            + sampleClassifications.length + ' event(s) - grade ' + grade
            + ', risk ' + riskScore + ', P0=' + p0 + ' P1=' + p1;

        return {
            generatedAt: nowVal.toISOString(),
            riskAppetite: appetite,
            riskScore: riskScore,
            grade: grade,
            headline: headline,
            summary: {
                totalAssets: assetClassifications.length,
                totalSampleEvents: sampleClassifications.length,
                p0Count: p0,
                p1Count: p1,
            },
            assets: assetClassifications,
            sampleEvents: sampleClassifications,
            playbook: playbook,
            insights: insights,
        };
    }

    return {
        evaluate: evaluate,
        formatText: _formatText,
        formatMarkdown: _formatMarkdown,
        formatJson: _formatJson,
        VERDICTS: ASSET_VERDICTS,
        SAMPLE_VERDICTS: SAMPLE_VERDICTS,
    };
}

module.exports = {
    createCryoChainIntegrityAdvisor: createCryoChainIntegrityAdvisor,
    ASSET_VERDICTS: ASSET_VERDICTS,
    SAMPLE_VERDICTS: SAMPLE_VERDICTS,
};
