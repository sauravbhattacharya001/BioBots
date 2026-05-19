'use strict';

/**
 * Contamination Propagation Advisor - agentic downstream-contamination
 * propagation tracker for bioprinting lineages.
 *
 * Sibling of:
 *   - createContaminationEarlyWarning (per-sensor leading-indicator alerts)
 *   - createContaminationRiskScorer   (per-batch scoring at point-in-time)
 *   - createBatchGenealogyTracker     (lineage graph)
 *   - createBatchReleaseAdvisor       (final disposition)
 *   - createShiftHandoffSynthesizer   (between-shift carryover)
 *   - createEquipmentDowntimeRiskAdvisor (fleet downtime planning)
 *
 * The other modules answer: *where* contamination might appear, *how bad
 * a single batch looks*, or *what to do at release time*. This one
 * answers the question that comes up the moment a contamination is
 * detected: **"Given that batch B was contaminated, which downstream
 * batches, runs, and shipments do we need to quarantine, retest,
 * destroy, or notify customers about - in what order - and how
 * confident are we?"**
 *
 * Inputs are plain records, intentionally loose so any genealogy /
 * shipment / patient-mapping store can feed it:
 *
 *   evaluate({
 *       sources: [
 *           { batchId, severity: 'confirmed'|'suspected'|'flagged',
 *             organism, detectedAt, evidence }
 *       ],
 *       lineage: [
 *           { batchId, parents: [...], childrenHint?: [...],
 *             createdAt, equipmentId, operatorId, cleanRoomId,
 *             sharedMediaLotId, sharedReagentLotIds, type,
 *             cellLine, patientId, shipped, shippedTo, status }
 *       ],
 *       shipments: [ { id, batchId, customer, shippedAt, recalled } ],
 *       options: { horizonHops, riskAppetite }
 *   })
 *
 * The advisor walks the lineage forward from each source up to
 * `horizonHops` (default 4) generations, also picking up "siblings"
 * that shared equipment / clean room / media lot / operator within a
 * configurable contact window, scores each affected batch 0-100, and
 * emits a per-batch verdict + a ranked P0-P3 cross-batch playbook with
 * owner / blast / reversibility metadata, cross-signal insights, and
 * text / markdown / json renderers.
 *
 * Pure JS, CommonJS, zero deps, deterministic given an injected
 * `now()`, never mutates inputs.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var cpa = biobots.createContaminationPropagationAdvisor({
 *       now: function () { return new Date('2026-05-19T20:00:00Z'); }
 *   });
 *   var report = cpa.evaluate({
 *       sources: [{ batchId: 'B-001', severity: 'confirmed', organism: 'mycoplasma' }],
 *       lineage: [
 *           { batchId: 'B-001', parents: [], equipmentId: 'BSC-1', shipped: true },
 *           { batchId: 'B-002', parents: ['B-001'], equipmentId: 'BSC-1' },
 *           { batchId: 'B-010', parents: [],         equipmentId: 'BSC-1', createdAt: '2026-05-19T18:00:00Z' },
 *       ],
 *   });
 *   console.log(cpa.formatMarkdown(report));
 */

var PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
var RISK_APPETITES = { cautious: 'cautious', balanced: 'balanced', aggressive: 'aggressive' };

var SEVERITY_WEIGHT = {
    confirmed: 1.00,
    suspected: 0.65,
    flagged:   0.35,
};

var ORGANISM_PRIOR = {
    // Higher = harder to remediate; used as a confidence/severity multiplier.
    mycoplasma:    1.15,
    fungal:        1.10,
    bacterial:     1.00,
    yeast:         0.95,
    endotoxin:     0.90,
    viral:         1.20,
    unknown:       1.00,
};

var VERDICTS = {
    DESTROY:        'DESTROY',          // Direct descendant of confirmed source / already shipped + confirmed
    RECALL:         'RECALL',           // Shipped batch with high risk
    QUARANTINE:     'QUARANTINE',       // Hold and forbid downstream use
    RETEST_URGENT:  'RETEST_URGENT',    // Hold and retest, fast turnaround
    RETEST_ROUTINE: 'RETEST_ROUTINE',   // Hold and retest at next scheduled run
    MONITOR:        'MONITOR',          // Keep eyes on; no action required yet
    UNAFFECTED:     'UNAFFECTED',       // Walked to but no real link
};

var VERDICT_PRIORITY = {
    DESTROY:        'P0',
    RECALL:         'P0',
    QUARANTINE:     'P0',
    RETEST_URGENT:  'P1',
    RETEST_ROUTINE: 'P2',
    MONITOR:        'P3',
    UNAFFECTED:     'P3',
};

var APPETITE_SHIFT = { cautious: 12, balanced: 0, aggressive: -10 };
var APPETITE_THRESHOLD_MULT = { cautious: 0.85, balanced: 1.00, aggressive: 1.18 };

// �� helpers �����������������������������������������������������

function _isFiniteNum(n) { return typeof n === 'number' && isFinite(n); }
function _str(s) { return typeof s === 'string' ? s : ''; }
function _arr(a) { return Array.isArray(a) ? a : []; }
function _bool(b) { return b === true; }
function _round(n, p) { var f = Math.pow(10, p || 0); return Math.round(n * f) / f; }
function _clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function _coerceDate(d, fallback) {
    if (!d) return fallback;
    if (d instanceof Date) return isNaN(d.getTime()) ? fallback : d;
    var t = Date.parse(String(d));
    return isNaN(t) ? fallback : new Date(t);
}

function _hoursBetween(a, b) {
    if (!a || !b) return Infinity;
    return Math.abs(a.getTime() - b.getTime()) / 3600000;
}

function _deepCloneRecord(r) {
    // Shallow-deep enough for our plain JSON-y records; never mutates input.
    var out = {};
    for (var k in r) {
        if (Object.prototype.hasOwnProperty.call(r, k)) {
            var v = r[k];
            if (Array.isArray(v)) out[k] = v.slice();
            else out[k] = v;
        }
    }
    return out;
}

function _byId(records, idKey) {
    var m = Object.create(null);
    for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (!r) continue;
        var id = _str(r[idKey]);
        if (id && !m[id]) m[id] = r;
    }
    return m;
}

// �� factory �����������������������������������������������������

function createContaminationPropagationAdvisor(options) {
    options = options || {};
    var now = typeof options.now === 'function' ? options.now : function () { return new Date(); };
    var defaultAppetite = options.riskAppetite || 'balanced';
    if (!RISK_APPETITES[defaultAppetite]) {
        throw new Error('createContaminationPropagationAdvisor: unknown riskAppetite "' + defaultAppetite + '"');
    }

    function evaluate(input) {
        input = input || {};
        var appetite = input.riskAppetite || defaultAppetite;
        if (!RISK_APPETITES[appetite]) {
            throw new Error('evaluate: unknown riskAppetite "' + appetite + '"');
        }
        var horizonHops = _isFiniteNum(input.horizonHops) && input.horizonHops > 0
            ? Math.floor(input.horizonHops) : 4;
        var contactWindowHours = _isFiniteNum(input.contactWindowHours) && input.contactWindowHours > 0
            ? input.contactWindowHours : 24;

        var rightNow = now() || new Date();

        var sources = _arr(input.sources).map(_deepCloneRecord).filter(function (s) { return _str(s.batchId); });
        var lineage = _arr(input.lineage).map(_deepCloneRecord).filter(function (b) { return _str(b.batchId); });
        var shipments = _arr(input.shipments).map(_deepCloneRecord).filter(function (s) { return _str(s.batchId); });

        // Index lineage by id and build forward / sibling adjacency.
        var lineageById = _byId(lineage, 'batchId');
        var childrenOf = Object.create(null);
        for (var i = 0; i < lineage.length; i++) {
            var b = lineage[i];
            var parents = _arr(b.parents);
            for (var p = 0; p < parents.length; p++) {
                var pid = _str(parents[p]);
                if (!pid) continue;
                (childrenOf[pid] = childrenOf[pid] || []).push(b.batchId);
            }
            // Optional hint when parents weren't recorded explicitly.
            var hints = _arr(b.childrenHint);
            for (var h = 0; h < hints.length; h++) {
                var hid = _str(hints[h]);
                if (!hid) continue;
                (childrenOf[b.batchId] = childrenOf[b.batchId] || []).push(hid);
            }
        }

        // Pre-index shipments by batchId.
        var shipmentsByBatch = Object.create(null);
        for (var s = 0; s < shipments.length; s++) {
            var sh = shipments[s];
            (shipmentsByBatch[sh.batchId] = shipmentsByBatch[sh.batchId] || []).push(sh);
        }

        // Per-batch propagation analysis - keyed by batchId.
        var byBatch = Object.create(null);
        var visitOrder = [];

        function _ensure(batchId, depth, viaCode, sourceId) {
            if (!byBatch[batchId]) {
                byBatch[batchId] = {
                    batchId: batchId,
                    depth: depth,
                    viaCodes: [],
                    sources: [],
                    riskScore: 0,
                    verdict: VERDICTS.MONITOR,
                    priority: 'P3',
                    confidence: 0.5,
                    estimatedHopsFromSource: depth,
                };
                visitOrder.push(batchId);
            } else if (depth < byBatch[batchId].depth) {
                byBatch[batchId].depth = depth;
                byBatch[batchId].estimatedHopsFromSource = depth;
            }
            if (viaCode && byBatch[batchId].viaCodes.indexOf(viaCode) === -1) {
                byBatch[batchId].viaCodes.push(viaCode);
            }
            if (sourceId && byBatch[batchId].sources.indexOf(sourceId) === -1) {
                byBatch[batchId].sources.push(sourceId);
            }
            return byBatch[batchId];
        }

        // Walk forward from each source through `childrenOf`.
        for (var ss = 0; ss < sources.length; ss++) {
            var src = sources[ss];
            var queue = [{ id: src.batchId, depth: 0 }];
            var seen = Object.create(null);
            while (queue.length) {
                var cur = queue.shift();
                if (seen[cur.id]) continue;
                seen[cur.id] = true;
                var via = cur.depth === 0 ? 'SOURCE' : 'LINEAGE_DESCENDANT';
                _ensure(cur.id, cur.depth, via, src.batchId);
                if (cur.depth >= horizonHops) continue;
                var kids = _arr(childrenOf[cur.id]);
                for (var k = 0; k < kids.length; k++) {
                    queue.push({ id: kids[k], depth: cur.depth + 1 });
                }
            }
        }

        // Sibling sweep: any lineage batch that shared equipmentId / cleanRoomId /
        // sharedMediaLotId / operatorId with a source within contactWindowHours.
        for (var ss2 = 0; ss2 < sources.length; ss2++) {
            var src2 = sources[ss2];
            var srcRec = lineageById[src2.batchId];
            if (!srcRec) continue;
            var srcAt = _coerceDate(src2.detectedAt || srcRec.createdAt, rightNow);
            for (var li = 0; li < lineage.length; li++) {
                var cand = lineage[li];
                if (cand.batchId === src2.batchId) continue;
                if (byBatch[cand.batchId] && byBatch[cand.batchId].depth === 0) continue;
                var candAt = _coerceDate(cand.createdAt, rightNow);
                if (_hoursBetween(srcAt, candAt) > contactWindowHours) continue;
                var viaCode = null;
                if (_str(srcRec.equipmentId) && srcRec.equipmentId === cand.equipmentId) viaCode = 'SHARED_EQUIPMENT';
                else if (_str(srcRec.cleanRoomId) && srcRec.cleanRoomId === cand.cleanRoomId) viaCode = 'SHARED_CLEANROOM';
                else if (_str(srcRec.sharedMediaLotId) && srcRec.sharedMediaLotId === cand.sharedMediaLotId) viaCode = 'SHARED_MEDIA_LOT';
                else if (_str(srcRec.operatorId) && srcRec.operatorId === cand.operatorId) viaCode = 'SHARED_OPERATOR';
                else {
                    var srcReagents = _arr(srcRec.sharedReagentLotIds);
                    var candReagents = _arr(cand.sharedReagentLotIds);
                    for (var r = 0; r < srcReagents.length && !viaCode; r++) {
                        if (candReagents.indexOf(srcReagents[r]) !== -1) viaCode = 'SHARED_REAGENT_LOT';
                    }
                }
                if (viaCode) _ensure(cand.batchId, 1, viaCode, src2.batchId);
            }
        }

        // Score each affected batch.
        var sourcesById = _byId(sources, 'batchId');
        for (var v = 0; v < visitOrder.length; v++) {
            var id = visitOrder[v];
            var node = byBatch[id];
            var batchRec = lineageById[id] || {};
            var shipsHere = _arr(shipmentsByBatch[id]);

            // Base by hop depth.
            var base;
            if (node.depth === 0) base = 100;
            else if (node.depth === 1) base = 72;
            else if (node.depth === 2) base = 50;
            else if (node.depth === 3) base = 32;
            else base = 18;

            // Severity / organism weighting against the *worst* contributing source.
            var sevMul = 0;
            var orgMul = 1.0;
            for (var sx = 0; sx < node.sources.length; sx++) {
                var srcRec2 = sourcesById[node.sources[sx]] || {};
                var sw = SEVERITY_WEIGHT[_str(srcRec2.severity).toLowerCase()];
                if (typeof sw !== 'number') sw = SEVERITY_WEIGHT.suspected;
                if (sw > sevMul) sevMul = sw;
                var om = ORGANISM_PRIOR[_str(srcRec2.organism).toLowerCase()];
                if (typeof om === 'number' && om > orgMul) orgMul = om;
            }
            if (sevMul === 0) sevMul = SEVERITY_WEIGHT.suspected;

            var score = base * sevMul * orgMul;

            // Path bonuses (lineage vs sibling).
            var hasLineage = node.viaCodes.indexOf('LINEAGE_DESCENDANT') !== -1 || node.viaCodes.indexOf('SOURCE') !== -1;
            var hasReagent = node.viaCodes.indexOf('SHARED_REAGENT_LOT') !== -1;
            var hasMedia   = node.viaCodes.indexOf('SHARED_MEDIA_LOT') !== -1;
            var hasEquip   = node.viaCodes.indexOf('SHARED_EQUIPMENT') !== -1;
            var hasRoom    = node.viaCodes.indexOf('SHARED_CLEANROOM') !== -1;
            var hasOp      = node.viaCodes.indexOf('SHARED_OPERATOR') !== -1;

            if (!hasLineage) {
                // Sibling-only nodes start lower than direct descendants.
                if (hasMedia || hasReagent) score = Math.max(score, 55);
                else if (hasEquip) score = Math.max(score, 42);
                else if (hasRoom) score = Math.max(score, 32);
                else if (hasOp) score = Math.max(score, 26);
            }

            // Already shipped or in a patient pipeline cranks priority.
            if (_bool(batchRec.shipped) || shipsHere.length > 0) score += 12;
            if (_str(batchRec.patientId)) score += 10;

            // Already-recalled / already-destroyed batches don't need re-action.
            var existingStatus = _str(batchRec.status).toLowerCase();
            var existingShipRecalled = shipsHere.length > 0 && shipsHere.every(function (sh) { return _bool(sh.recalled); });
            if (existingStatus === 'destroyed' || existingStatus === 'discarded') {
                score = Math.min(score, 10);
            }

            // Risk-appetite shift (clamped 0-100).
            score = _clamp(score + APPETITE_SHIFT[appetite], 0, 100);

            node.riskScore = _round(score, 1);

            // Verdict ladder.
            var verdict;
            var thr = APPETITE_THRESHOLD_MULT[appetite];
            if (node.depth === 0) {
                verdict = VERDICTS.DESTROY;
            } else if (score >= 85 * thr) {
                if (_bool(batchRec.shipped) || shipsHere.length > 0) verdict = existingShipRecalled ? VERDICTS.QUARANTINE : VERDICTS.RECALL;
                else verdict = VERDICTS.QUARANTINE;
            } else if (score >= 65 * thr) {
                verdict = VERDICTS.RETEST_URGENT;
            } else if (score >= 40 * thr) {
                verdict = VERDICTS.RETEST_ROUTINE;
            } else if (score >= 18 * thr) {
                verdict = VERDICTS.MONITOR;
            } else {
                verdict = VERDICTS.UNAFFECTED;
            }
            node.verdict = verdict;
            node.priority = VERDICT_PRIORITY[verdict];

            // Confidence: 0.5 base, +0.1 per non-sibling lineage link, +0.05 per
            // additional via-code (cap 0.95). Lower for sibling-only.
            var conf = 0.5;
            if (hasLineage) conf += 0.20;
            conf += 0.05 * Math.max(0, node.viaCodes.length - 1);
            if (sevMul >= 1.0) conf += 0.10;
            conf = _clamp(_round(conf, 2), 0.05, 0.95);
            node.confidence = conf;
        }

        // Build batch list - sort by priority then risk score then id.
        var batches = visitOrder.map(function (id) {
            var n = byBatch[id];
            var batchRec = lineageById[id] || {};
            return {
                batchId: id,
                depth: n.depth,
                via: n.viaCodes.slice(),
                sources: n.sources.slice(),
                riskScore: n.riskScore,
                verdict: n.verdict,
                priority: n.priority,
                confidence: n.confidence,
                estimatedHopsFromSource: n.estimatedHopsFromSource,
                shipped: _bool(batchRec.shipped) || _arr(shipmentsByBatch[id]).length > 0,
                patientLinked: !!_str(batchRec.patientId),
                status: _str(batchRec.status),
            };
        });
        batches.sort(function (a, b) {
            var pa = PRIORITY_RANK[a.priority], pb = PRIORITY_RANK[b.priority];
            if (pa !== pb) return pa - pb;
            if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
            return a.batchId < b.batchId ? -1 : a.batchId > b.batchId ? 1 : 0;
        });

        // Cross-batch playbook (P0-first, deduped by action id).
        var actions = [];
        var pushed = Object.create(null);
        function _addAction(a) {
            if (pushed[a.id]) return;
            pushed[a.id] = true;
            actions.push(a);
        }

        var destroyIds = batches.filter(function (b) { return b.verdict === VERDICTS.DESTROY; }).map(function (b) { return b.batchId; });
        var recallIds  = batches.filter(function (b) { return b.verdict === VERDICTS.RECALL;  }).map(function (b) { return b.batchId; });
        var quarIds    = batches.filter(function (b) { return b.verdict === VERDICTS.QUARANTINE; }).map(function (b) { return b.batchId; });
        var retestU    = batches.filter(function (b) { return b.verdict === VERDICTS.RETEST_URGENT; }).map(function (b) { return b.batchId; });
        var retestR    = batches.filter(function (b) { return b.verdict === VERDICTS.RETEST_ROUTINE; }).map(function (b) { return b.batchId; });
        var monitor    = batches.filter(function (b) { return b.verdict === VERDICTS.MONITOR; }).map(function (b) { return b.batchId; });
        var patientHits = batches.filter(function (b) { return b.patientLinked && ['DESTROY','RECALL','QUARANTINE','RETEST_URGENT'].indexOf(b.verdict) !== -1; }).map(function (b) { return b.batchId; });

        if (destroyIds.length) _addAction({
            id: 'DESTROY_CONTAMINATED_SOURCES', priority: 'P0',
            headline: 'Destroy ' + destroyIds.length + ' confirmed source batch(es)',
            detail: 'Sources: ' + destroyIds.slice(0, 8).join(', ') + (destroyIds.length > 8 ? '  +' + (destroyIds.length - 8) + ' more' : ''),
            owner: 'qa', blastRadius: 4, reversibility: 'low',
            relatedBatchIds: destroyIds,
        });
        if (recallIds.length) _addAction({
            id: 'INITIATE_RECALL', priority: 'P0',
            headline: 'Initiate recall for ' + recallIds.length + ' shipped batch(es)',
            detail: 'Notify customers / regulators per SOP. Batches: ' + recallIds.slice(0, 8).join(', '),
            owner: 'qa', blastRadius: 5, reversibility: 'low',
            relatedBatchIds: recallIds,
        });
        if (quarIds.length) _addAction({
            id: 'QUARANTINE_DOWNSTREAM', priority: 'P0',
            headline: 'Quarantine ' + quarIds.length + ' downstream batch(es)',
            detail: 'Place on hold and block release until cleared. Batches: ' + quarIds.slice(0, 10).join(', '),
            owner: 'lab_lead', blastRadius: 3, reversibility: 'medium',
            relatedBatchIds: quarIds,
        });
        if (patientHits.length) _addAction({
            id: 'NOTIFY_CLINICAL_TEAM', priority: 'P0',
            headline: 'Notify clinical team about ' + patientHits.length + ' patient-linked batch(es)',
            detail: 'Patient-linked batches require regulatory + clinical escalation: ' + patientHits.slice(0, 6).join(', '),
            owner: 'clinical', blastRadius: 5, reversibility: 'low',
            relatedBatchIds: patientHits,
        });
        if (retestU.length) _addAction({
            id: 'URGENT_RETEST', priority: 'P1',
            headline: 'Run urgent retest panel on ' + retestU.length + ' batch(es)',
            detail: 'Prioritise fast-turnaround sterility + mycoplasma panels. Batches: ' + retestU.slice(0, 8).join(', '),
            owner: 'lab', blastRadius: 2, reversibility: 'high',
            relatedBatchIds: retestU,
        });
        if (quarIds.length + recallIds.length + destroyIds.length > 0) _addAction({
            id: 'DEEP_CLEAN_SHARED_RESOURCES', priority: 'P1',
            headline: 'Deep-clean shared equipment / clean rooms / media lots',
            detail: 'Quarantine implicated equipment, decontaminate clean rooms, and freeze shared lot use until cleared.',
            owner: 'facilities', blastRadius: 4, reversibility: 'medium',
            relatedBatchIds: destroyIds.concat(recallIds, quarIds),
        });
        if (retestR.length) _addAction({
            id: 'ROUTINE_RETEST', priority: 'P2',
            headline: 'Add ' + retestR.length + ' batch(es) to next scheduled retest run',
            detail: 'Lower-risk neighbours; retest at next routine sterility cycle.',
            owner: 'lab', blastRadius: 1, reversibility: 'high',
            relatedBatchIds: retestR,
        });
        if (monitor.length) _addAction({
            id: 'MONITOR_NEIGHBOURS', priority: 'P3',
            headline: 'Monitor ' + monitor.length + ' low-risk neighbour(s)',
            detail: 'Continue routine monitoring; no immediate action required.',
            owner: 'lab', blastRadius: 1, reversibility: 'high',
            relatedBatchIds: monitor,
        });
        if (!actions.length) _addAction({
            id: 'NO_PROPAGATION_DETECTED', priority: 'P3',
            headline: 'No downstream propagation detected',
            detail: 'No lineage or sibling neighbours met the propagation threshold.',
            owner: 'lab', blastRadius: 1, reversibility: 'high',
            relatedBatchIds: [],
        });

        // Appetite-driven playbook trimming.
        if (appetite === 'aggressive') {
            actions = actions.filter(function (a) {
                if (a.priority === 'P3' && actions.some(function (x) { return x.priority === 'P0' || x.priority === 'P1'; })) return false;
                return true;
            });
        }
        if (appetite === 'cautious') {
            // Always add an audit step when something serious is happening.
            if (destroyIds.length + recallIds.length + quarIds.length > 0) {
                _addAction({
                    id: 'SCHEDULE_ROOT_CAUSE_AUDIT', priority: 'P1',
                    headline: 'Schedule root-cause investigation',
                    detail: 'Open a CAPA / RCA ticket within 24h to identify the contamination vector.',
                    owner: 'qa', blastRadius: 2, reversibility: 'high',
                    relatedBatchIds: destroyIds.concat(recallIds, quarIds),
                });
            }
        }

        // Sort actions: P0-first then by insertion order (stable).
        actions.sort(function (a, b) {
            return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        });

        // Cross-signal insights.
        var insights = [];
        function _addInsight(code, message) {
            for (var idx = 0; idx < insights.length; idx++) if (insights[idx].code === code) return;
            insights.push({ code: code, message: message });
        }
        var pathCounts = { LINEAGE_DESCENDANT: 0, SHARED_EQUIPMENT: 0, SHARED_CLEANROOM: 0, SHARED_MEDIA_LOT: 0, SHARED_REAGENT_LOT: 0, SHARED_OPERATOR: 0 };
        for (var bi = 0; bi < batches.length; bi++) {
            for (var vi = 0; vi < batches[bi].via.length; vi++) {
                if (pathCounts.hasOwnProperty(batches[bi].via[vi])) pathCounts[batches[bi].via[vi]]++;
            }
        }
        if (destroyIds.length + recallIds.length + quarIds.length >= 5) _addInsight('LARGE_BLAST_RADIUS', 'Contamination affects 5+ batches - treat as a facility-level incident.');
        if (patientHits.length) _addInsight('PATIENT_IMPACT', patientHits.length + ' affected batch(es) are linked to patients; clinical & regulatory notification required.');
        if (pathCounts.SHARED_MEDIA_LOT >= 2) _addInsight('SHARED_MEDIA_LOT_AT_FAULT', 'Two or more batches share a media lot - quarantine the lot and trace its supplier.');
        if (pathCounts.SHARED_REAGENT_LOT >= 2) _addInsight('SHARED_REAGENT_LOT_AT_FAULT', 'Two or more batches share a reagent lot - quarantine that lot and notify the supplier.');
        if (pathCounts.SHARED_EQUIPMENT >= 3) _addInsight('EQUIPMENT_CONTAMINATION_PATTERN', 'Three or more downstream batches share the same equipment - deep-clean before reuse.');
        if (pathCounts.SHARED_CLEANROOM >= 3) _addInsight('CLEANROOM_CONTAMINATION_PATTERN', 'Multiple batches share a clean room - run an environmental audit.');
        if (pathCounts.SHARED_OPERATOR >= 3) _addInsight('OPERATOR_TECHNIQUE_PATTERN', 'Multiple batches share an operator - review aseptic technique training.');
        var shippedHits = batches.filter(function (b) { return b.shipped && ['DESTROY','RECALL','QUARANTINE'].indexOf(b.verdict) !== -1; });
        if (shippedHits.length) _addInsight('SHIPPED_BATCHES_AFFECTED', shippedHits.length + ' affected batch(es) have already shipped - recall workflow required.');
        if (!sources.length) _addInsight('NO_SOURCES_PROVIDED', 'No contamination sources provided - nothing to propagate from.');
        if (sources.length && !visitOrder.length) _addInsight('NO_LINEAGE_AVAILABLE', 'Sources provided but no matching lineage records were supplied.');
        if (sources.length && visitOrder.length === sources.length) _addInsight('ISOLATED_SOURCES', 'Sources have no recorded downstream lineage - contamination appears contained to the source batches.');
        if (!insights.length) _addInsight('HEALTHY_NETWORK', 'No notable cross-batch propagation patterns detected.');

        // Portfolio grade.
        var p0count = actions.filter(function (a) { return a.priority === 'P0'; }).length;
        var p1count = actions.filter(function (a) { return a.priority === 'P1'; }).length;
        var maxRisk = batches.reduce(function (m, b) { return Math.max(m, b.riskScore); }, 0);
        var grade;
        if (recallIds.length || patientHits.length || maxRisk >= 90) grade = 'F';
        else if (p0count > 0) grade = 'D';
        else if (p1count > 0 || maxRisk >= 60) grade = 'C';
        else if (maxRisk >= 30) grade = 'B';
        else grade = 'A';

        var counts = {
            sources: sources.length,
            affected: batches.length,
            destroy: destroyIds.length,
            recall: recallIds.length,
            quarantine: quarIds.length,
            retestUrgent: retestU.length,
            retestRoutine: retestR.length,
            monitor: monitor.length,
            patientLinked: patientHits.length,
            actionsP0: p0count,
            actionsP1: p1count,
            actionsP2: actions.filter(function (a) { return a.priority === 'P2'; }).length,
            actionsP3: actions.filter(function (a) { return a.priority === 'P3'; }).length,
        };

        var headline;
        if (!sources.length) headline = 'No contamination sources to evaluate.';
        else if (!visitOrder.length) headline = sources.length + ' source(s); no downstream lineage on record.';
        else headline = sources.length + ' source(s); ' + batches.length + ' affected batch(es); ' + p0count + ' P0 / ' + p1count + ' P1 actions; grade ' + grade + '.';

        return {
            generatedAt: rightNow.toISOString(),
            riskAppetite: appetite,
            horizonHops: horizonHops,
            contactWindowHours: contactWindowHours,
            headline: headline,
            grade: grade,
            maxRiskScore: _round(maxRisk, 1),
            counts: counts,
            batches: batches,
            playbook: actions,
            insights: insights,
        };
    }

    // �� renderers ��������������������������������������������������

    function formatText(report) {
        var lines = [];
        lines.push('CONTAMINATION PROPAGATION ADVISOR');
        lines.push('==================================');
        lines.push(report.headline);
        lines.push('Grade: ' + report.grade + ' | Max risk: ' + report.maxRiskScore + ' | Appetite: ' + report.riskAppetite + ' | Horizon: ' + report.horizonHops + ' hops / ' + report.contactWindowHours + 'h');
        lines.push('');
        lines.push('AFFECTED BATCHES (' + report.batches.length + ')');
        lines.push('----------------');
        for (var i = 0; i < report.batches.length; i++) {
            var b = report.batches[i];
            lines.push('  [' + b.priority + '] ' + b.batchId + '  verdict=' + b.verdict + '  risk=' + b.riskScore + '  hops=' + b.depth + '  via=' + b.via.join('|') + (b.shipped ? '  SHIPPED' : '') + (b.patientLinked ? '  PATIENT' : ''));
        }
        lines.push('');
        lines.push('PLAYBOOK (' + report.playbook.length + ')');
        lines.push('--------');
        for (var j = 0; j < report.playbook.length; j++) {
            var a = report.playbook[j];
            lines.push('  [' + a.priority + '] ' + a.id + '  owner=' + a.owner + '  blast=' + a.blastRadius + '  rev=' + a.reversibility);
            lines.push('       ' + a.headline);
            if (a.detail) lines.push('       ' + a.detail);
        }
        lines.push('');
        lines.push('INSIGHTS');
        lines.push('--------');
        for (var k = 0; k < report.insights.length; k++) {
            lines.push('  - ' + report.insights[k].code + ': ' + report.insights[k].message);
        }
        return lines.join('\n');
    }

    function formatMarkdown(report) {
        var lines = [];
        lines.push('# Contamination Propagation Advisor');
        lines.push('');
        lines.push('**' + report.headline + '**');
        lines.push('');
        lines.push('- Grade: **' + report.grade + '**');
        lines.push('- Max risk score: **' + report.maxRiskScore + '**');
        lines.push('- Risk appetite: `' + report.riskAppetite + '`');
        lines.push('- Horizon: ' + report.horizonHops + ' hops / ' + report.contactWindowHours + 'h contact window');
        lines.push('- Generated: ' + report.generatedAt);
        lines.push('');
        lines.push('## Affected batches (' + report.batches.length + ')');
        lines.push('');
        lines.push('| Priority | Batch | Verdict | Risk | Hops | Via | Flags |');
        lines.push('|---|---|---|---|---|---|---|');
        if (!report.batches.length) {
            lines.push('| - | _none_ | - | - | - | - | - |');
        } else {
            for (var i = 0; i < report.batches.length; i++) {
                var b = report.batches[i];
                var flags = [];
                if (b.shipped) flags.push('shipped');
                if (b.patientLinked) flags.push('patient');
                if (b.status) flags.push('status=' + b.status);
                lines.push('| ' + b.priority + ' | `' + b.batchId + '` | ' + b.verdict + ' | ' + b.riskScore + ' | ' + b.depth + ' | ' + (b.via.join(', ') || '-') + ' | ' + (flags.join(', ') || '-') + ' |');
            }
        }
        lines.push('');
        lines.push('## Playbook (' + report.playbook.length + ')');
        lines.push('');
        lines.push('| Priority | Action | Owner | Blast | Reversibility |');
        lines.push('|---|---|---|---|---|');
        for (var j = 0; j < report.playbook.length; j++) {
            var a = report.playbook[j];
            lines.push('| ' + a.priority + ' | **' + a.id + '** - ' + a.headline + ' | ' + a.owner + ' | ' + a.blastRadius + ' | ' + a.reversibility + ' |');
        }
        lines.push('');
        lines.push('## Insights');
        lines.push('');
        for (var k = 0; k < report.insights.length; k++) {
            lines.push('- **' + report.insights[k].code + '**: ' + report.insights[k].message);
        }
        return lines.join('\n');
    }

    function formatJson(report, indent) {
        return JSON.stringify(report, _stableReplacer, _isFiniteNum(indent) ? indent : 2);
    }
    function _stableReplacer(_key, value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            var sorted = {};
            var keys = Object.keys(value).sort();
            for (var i = 0; i < keys.length; i++) sorted[keys[i]] = value[keys[i]];
            return sorted;
        }
        return value;
    }

    return {
        evaluate: evaluate,
        formatText: formatText,
        formatMarkdown: formatMarkdown,
        formatJson: formatJson,
    };
}

module.exports = { createContaminationPropagationAdvisor: createContaminationPropagationAdvisor };
