'use strict';

/**
 * Reagent Substitution Advisor - Agentic substitute recommender.
 *
 * When a reagent is out-of-stock, expired, low, recalled, or fails QC, this
 * advisor scans the Lab Inventory Manager + a built-in substitution knowledge
 * base and ranks substitute candidates with risk-scored verdicts and
 * concrete protocol adjustments.
 *
 * Complements (does NOT duplicate):
 *   - smartReorder.js              (orders more of the same reagent)
 *   - perishableWasteForecaster.js (avoids future waste)
 *
 * This module answers the different question: "I can't use what the
 * protocol calls for RIGHT NOW. What in my fridge can I use instead, and
 * how should I adjust?"
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var inv = biobots.createLabInventoryManager();
 *   inv.addItem({ name: 'Alginate 1%', category: 'bioink', quantity: 30, unit: 'mL' });
 *   var advisor = biobots.createReagentSubstitutionAdvisor({ inventory: inv });
 *   var report = advisor.recommend({
 *       reagent: 'Alginate 2%',
 *       needAmount: 5,
 *       unit: 'mL',
 *       reason: 'out_of_stock'
 *   });
 *   console.log(report.topPick && report.topPick.name);
 *   console.log(advisor.formatMarkdown(report));
 */

// === Built-in substitution knowledge base ============================
// Each entry: reagent name -> array of candidate substitutes.
// Compatibility 0..1 = "how chemically/functionally equivalent".
// concentrationFactor: multiplier on the needAmount to match equivalence.

var DEFAULT_SUBSTITUTIONS = {
    'Alginate 2%': [
        { name: 'Alginate 1%',  category: 'bioink',      compatibility: 0.85, concentrationFactor: 2.0,
          requiresProtocolChange: true,
          notes: 'Double volume to match polymer mass; viscosity drops, expect lower print fidelity.' },
        { name: 'Alginate 3%',  category: 'bioink',      compatibility: 0.80, concentrationFactor: 0.67,
          requiresProtocolChange: true,
          notes: 'Use ~2/3 volume; higher viscosity, may clog small nozzles.' },
        { name: 'GelMA',        category: 'bioink',      compatibility: 0.55, concentrationFactor: 1.0,
          requiresProtocolChange: true,
          notes: 'Switch from ionic (CaCl2) to UV photocrosslinking; protocol diverges significantly.' }
    ],
    'Alginate 1%': [
        { name: 'Alginate 2%',  category: 'bioink',      compatibility: 0.85, concentrationFactor: 0.5,
          requiresProtocolChange: true,
          notes: 'Use half volume; expect stiffer construct.' }
    ],
    'CaCl2 100mM': [
        { name: 'CaCl2 50mM',   category: 'crosslinker', compatibility: 0.95, concentrationFactor: 2.0,
          requiresProtocolChange: true,
          notes: 'Use double volume or double exposure time.' },
        { name: 'CaCl2 200mM',  category: 'crosslinker', compatibility: 0.92, concentrationFactor: 0.5,
          requiresProtocolChange: true,
          notes: 'Half volume; faster crosslinking, risk of brittle gels.' },
        { name: 'BaCl2 100mM',  category: 'crosslinker', compatibility: 0.60, concentrationFactor: 1.0,
          requiresProtocolChange: true,
          notes: 'Stronger ionic crosslinker; reduce exposure time ~30%. Cytotoxicity concern - validate viability.' }
    ],
    'DMEM': [
        { name: 'DMEM/F-12',    category: 'media',       compatibility: 0.95, concentrationFactor: 1.0,
          requiresProtocolChange: false,
          notes: 'Drop-in replacement for most adherent lines; slightly richer formulation.' },
        { name: 'RPMI 1640',    category: 'media',       compatibility: 0.70, concentrationFactor: 1.0,
          requiresProtocolChange: false,
          notes: 'Acceptable for suspension lines; not ideal for adherent fibroblasts/MSCs.' },
        { name: 'MEM',          category: 'media',       compatibility: 0.65, concentrationFactor: 1.0,
          requiresProtocolChange: false,
          notes: 'Lower glucose; may need supplementation.' }
    ],
    'FBS': [
        { name: 'KnockOut Serum Replacement', category: 'reagent', compatibility: 0.70, concentrationFactor: 1.0,
          requiresProtocolChange: false,
          notes: 'Defined alternative; may need bFGF supplementation for some lines.' },
        { name: 'Human Platelet Lysate',      category: 'reagent', compatibility: 0.65, concentrationFactor: 1.0,
          requiresProtocolChange: false,
          notes: 'Xeno-free; preferred for clinical-grade MSC work.' }
    ],
    'PBS 1x': [
        { name: 'HBSS',          category: 'reagent',     compatibility: 0.90, concentrationFactor: 1.0,
          requiresProtocolChange: false,
          notes: 'Equivalent for short-term wash; contains glucose.' },
        { name: 'Saline 0.9%',   category: 'reagent',     compatibility: 0.70, concentrationFactor: 1.0,
          requiresProtocolChange: false,
          notes: 'Lacks phosphate buffering; pH will drift. OK for brief rinses only.' }
    ],
    'Trypsin-EDTA 0.25%': [
        { name: 'Trypsin-EDTA 0.05%', category: 'reagent', compatibility: 0.95, concentrationFactor: 5.0,
          requiresProtocolChange: true,
          notes: 'Use 5x volume OR extend incubation 2-3x.' },
        { name: 'TrypLE Express',     category: 'reagent', compatibility: 0.85, concentrationFactor: 1.0,
          requiresProtocolChange: false,
          notes: 'Recombinant, animal-free; gentler on cells.' },
        { name: 'Accutase',           category: 'reagent', compatibility: 0.80, concentrationFactor: 1.0,
          requiresProtocolChange: true,
          notes: 'Self-inactivating; no neutralization step needed.' }
    ],
    'Penicillin-Streptomycin': [
        { name: 'Gentamicin',     category: 'reagent', compatibility: 0.70, concentrationFactor: 1.0,
          requiresProtocolChange: false,
          notes: 'Broad-spectrum; some cytotoxicity at high doses.' },
        { name: 'Amphotericin B', category: 'reagent', compatibility: 0.40, concentrationFactor: 1.0,
          requiresProtocolChange: true,
          notes: 'Antifungal only; pair with another antibacterial.' }
    ],
    'GelMA': [
        { name: 'Alginate 2%',  category: 'bioink',  compatibility: 0.55, concentrationFactor: 1.0,
          requiresProtocolChange: true,
          notes: 'Switch from UV to ionic (CaCl2) crosslinking.' },
        { name: 'Collagen I',   category: 'scaffold', compatibility: 0.70, concentrationFactor: 1.0,
          requiresProtocolChange: true,
          notes: 'Thermal gelation at 37C; no UV exposure required.' }
    ],
    'Collagen I': [
        { name: 'Collagen IV',  category: 'scaffold', compatibility: 0.60, concentrationFactor: 1.0,
          requiresProtocolChange: true,
          notes: 'Basement-membrane collagen; different gelation kinetics.' },
        { name: 'Fibrin',       category: 'scaffold', compatibility: 0.55, concentrationFactor: 1.0,
          requiresProtocolChange: true,
          notes: 'Requires thrombin trigger; faster gelation.' },
        { name: 'GelMA',        category: 'bioink',   compatibility: 0.70, concentrationFactor: 1.0,
          requiresProtocolChange: true,
          notes: 'Photocrosslinkable; needs UV + LAP/Irgacure photoinitiator.' }
    ],
    'Pluronic F-127': [
        { name: 'Pluronic F-68', category: 'reagent', compatibility: 0.70, concentrationFactor: 1.0,
          requiresProtocolChange: true,
          notes: 'Lower MW; weaker gel; use as shear-protectant only.' },
        { name: 'Carbopol',      category: 'reagent', compatibility: 0.50, concentrationFactor: 1.0,
          requiresProtocolChange: true,
          notes: 'Carbomer gel; very different rheology, pH-sensitive.' }
    ],
    'L-Glutamine': [
        { name: 'GlutaMAX',      category: 'reagent', compatibility: 0.95, concentrationFactor: 1.0,
          requiresProtocolChange: false,
          notes: 'Stable dipeptide form; drop-in replacement.' }
    ],
    'HEPES Buffer': [
        { name: 'Tris-HCl',      category: 'reagent', compatibility: 0.70, concentrationFactor: 1.0,
          requiresProtocolChange: false,
          notes: 'Different pKa; OK near pH 8, not for CO2-buffered systems.' },
        { name: 'MOPS',          category: 'reagent', compatibility: 0.80, concentrationFactor: 1.0,
          requiresProtocolChange: false,
          notes: 'Similar buffering range; biologically inert.' }
    ]
};

var VALID_REASONS = ['out_of_stock', 'expired', 'low_stock', 'failed_qc', 'recalled', 'unspecified'];

function _isPosNumber(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0;
}

function _round2(n) {
    if (!isFinite(n)) return n;
    return Math.round(n * 100) / 100;
}

function _sortedJsonStringify(value, indent) {
    function rec(v) {
        if (v === null || typeof v !== 'object') return v;
        if (Array.isArray(v)) return v.map(rec);
        var keys = Object.keys(v).sort();
        var out = {};
        for (var i = 0; i < keys.length; i++) out[keys[i]] = rec(v[keys[i]]);
        return out;
    }
    return JSON.stringify(rec(value), null, indent || 2);
}

function _cloneCandidates(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        var c = arr[i];
        out.push({
            name: c.name,
            category: c.category || null,
            compatibility: typeof c.compatibility === 'number' ? c.compatibility : 0.5,
            concentrationFactor: typeof c.concentrationFactor === 'number' ? c.concentrationFactor : 1.0,
            requiresProtocolChange: !!c.requiresProtocolChange,
            notes: c.notes || ''
        });
    }
    return out;
}

function createReagentSubstitutionAdvisor(opts) {
    opts = opts || {};
    if (!opts.inventory || typeof opts.inventory.listItems !== 'function') {
        throw new Error('createReagentSubstitutionAdvisor requires { inventory } with a listItems() method');
    }

    var inventory = opts.inventory;
    var riskAppetite = opts.riskAppetite || 'balanced';
    if (['cautious', 'balanced', 'aggressive'].indexOf(riskAppetite) === -1) {
        throw new Error('riskAppetite must be cautious|balanced|aggressive');
    }
    var minStockUnitsBuffer = _isPosNumber(opts.minStockUnitsBuffer) ? opts.minStockUnitsBuffer : 0;
    var preferSameCategory = opts.preferSameCategory !== false;
    var now = typeof opts.now === 'function' ? opts.now : function () { return new Date(); };

    // Merge built-in + custom kb (custom takes precedence).
    var kb = {};
    var defKeys = Object.keys(DEFAULT_SUBSTITUTIONS);
    for (var i = 0; i < defKeys.length; i++) {
        kb[defKeys[i]] = _cloneCandidates(DEFAULT_SUBSTITUTIONS[defKeys[i]]);
    }
    if (opts.substitutionMap && typeof opts.substitutionMap === 'object') {
        var customKeys = Object.keys(opts.substitutionMap);
        for (var k = 0; k < customKeys.length; k++) {
            kb[customKeys[k]] = _cloneCandidates(opts.substitutionMap[customKeys[k]]);
        }
    }

    function setSubstitution(reagent, candidatesArray) {
        if (!reagent || typeof reagent !== 'string') {
            throw new Error('setSubstitution requires a reagent name');
        }
        if (!Array.isArray(candidatesArray)) {
            throw new Error('setSubstitution requires a candidates array');
        }
        kb[reagent] = _cloneCandidates(candidatesArray);
    }

    function _findInventoryItem(name) {
        if (typeof inventory.getItem === 'function') {
            try { return inventory.getItem(name); } catch (e) { /* fall through */ }
        }
        var list = inventory.listItems();
        for (var i = 0; i < list.length; i++) {
            if (list[i].name === name) return list[i];
        }
        return null;
    }

    function _expiryFlags(item) {
        if (!item || !item.expiryDate) return { expired: false, expiringSoon: false };
        var nowTs = now().getTime();
        var exp = new Date(item.expiryDate).getTime();
        if (isNaN(exp)) return { expired: false, expiringSoon: false };
        var daysLeft = (exp - nowTs) / 86400000;
        return {
            expired: daysLeft < 0,
            expiringSoon: daysLeft >= 0 && daysLeft <= 7
        };
    }

    function _scoreCandidate(cand, req, reqCategory) {
        var item = _findInventoryItem(cand.name);
        var availableStock = item && typeof item.quantity === 'number' ? item.quantity : 0;
        var suggestedAmount = _round2(req.needAmount * cand.concentrationFactor);
        var required = suggestedAmount + minStockUnitsBuffer;
        var stockSufficient = availableStock >= required && required > 0;
        var flags = _expiryFlags(item);

        var reasons = [];
        var score = cand.compatibility * 100;

        if (preferSameCategory && reqCategory && cand.category === reqCategory) {
            score += 5;
            reasons.push('SAME_CATEGORY');
        }
        if (cand.requiresProtocolChange) {
            score -= 25;
            reasons.push('REQUIRES_PROTOCOL_CHANGE');
        }
        if (!stockSufficient) {
            score -= 40;
            reasons.push(item ? 'INSUFFICIENT_STOCK' : 'OUT_OF_STOCK_IN_INVENTORY');
        } else {
            reasons.push('STOCK_SUFFICIENT');
        }
        if (flags.expired) {
            score -= 15;
            reasons.push('EXPIRED');
        } else if (flags.expiringSoon) {
            score -= 8;
            reasons.push('EXPIRY_SOON');
        }
        if (cand.compatibility < 0.5) reasons.push('LOW_COMPATIBILITY');

        // Risk modulation
        if (riskAppetite === 'cautious' && cand.compatibility < 0.7) score -= 10;
        if (riskAppetite === 'aggressive' && cand.compatibility >= 0.6) score += 5;

        score = Math.max(0, Math.min(100, Math.round(score)));

        // Verdict
        var verdict;
        if (!stockSufficient) {
            verdict = 'UNAVAILABLE';
        } else if (score >= 75 && cand.compatibility >= 0.75) {
            verdict = 'RECOMMENDED';
        } else if (score >= 55) {
            verdict = 'ACCEPTABLE';
        } else if (score >= 35 && cand.compatibility >= 0.5) {
            verdict = 'RISKY';
        } else {
            verdict = 'LAST_RESORT';
        }

        // Protocol adjustments
        var protocolAdjustments = [];
        if (cand.concentrationFactor !== 1.0) {
            var unit = req.unit || (item && item.unit) || 'units';
            protocolAdjustments.push(
                'Use ' + suggestedAmount + ' ' + unit + ' instead of ' + req.needAmount + ' ' + unit +
                ' (concentrationFactor ' + cand.concentrationFactor + ')'
            );
        }
        if (cand.requiresProtocolChange) {
            protocolAdjustments.push('Review protocol: ' + cand.notes);
        }
        if (flags.expired) {
            protocolAdjustments.push('DO NOT USE expired lot - source fresh stock or different substitute');
        } else if (flags.expiringSoon) {
            protocolAdjustments.push('Expires within 7 days - use immediately');
        }

        return {
            name: cand.name,
            category: cand.category,
            compatibility: cand.compatibility,
            concentrationFactor: cand.concentrationFactor,
            requiresProtocolChange: cand.requiresProtocolChange,
            notes: cand.notes,
            availableStock: _round2(availableStock),
            unit: item ? item.unit : (req.unit || null),
            stockSufficient: stockSufficient,
            expired: flags.expired,
            expiringSoon: flags.expiringSoon,
            suggestedAmount: suggestedAmount,
            score: score,
            verdict: verdict,
            reasons: reasons,
            protocolAdjustments: protocolAdjustments
        };
    }

    function recommend(req) {
        if (!req || typeof req !== 'object') throw new Error('recommend requires a request object');
        if (!req.reagent || typeof req.reagent !== 'string') {
            throw new Error('recommend requires a reagent name');
        }
        var needAmount = _isPosNumber(req.needAmount) && req.needAmount > 0 ? req.needAmount : 1;
        var reason = req.reason || 'unspecified';
        if (VALID_REASONS.indexOf(reason) === -1) reason = 'unspecified';
        var priority = (reason === 'expired' || reason === 'failed_qc' || reason === 'recalled') ? 'P0'
                       : (reason === 'out_of_stock' ? 'P1' : 'P2');

        var normalizedReq = { reagent: req.reagent, needAmount: needAmount, unit: req.unit || null };

        // Determine requested reagent's "category" by looking in inventory (if it exists there).
        var reqItem = _findInventoryItem(req.reagent);
        var reqCategory = reqItem ? reqItem.category : null;

        var rawCandidates = kb[req.reagent];
        var candidates = [];
        if (rawCandidates && rawCandidates.length) {
            for (var i = 0; i < rawCandidates.length; i++) {
                candidates.push(_scoreCandidate(rawCandidates[i], normalizedReq, reqCategory));
            }
        }

        // Sort: UNAVAILABLE last, then by score desc, compatibility desc, name asc (stable).
        candidates.sort(function (a, b) {
            var aUn = a.verdict === 'UNAVAILABLE' ? 1 : 0;
            var bUn = b.verdict === 'UNAVAILABLE' ? 1 : 0;
            if (aUn !== bUn) return aUn - bUn;
            if (b.score !== a.score) return b.score - a.score;
            if (b.compatibility !== a.compatibility) return b.compatibility - a.compatibility;
            if (a.name < b.name) return -1;
            if (a.name > b.name) return 1;
            return 0;
        });

        // Top pick / fallback
        var topPick = null;
        var fallback = null;
        for (var j = 0; j < candidates.length; j++) {
            var c = candidates[j];
            if (c.verdict === 'RECOMMENDED' || c.verdict === 'ACCEPTABLE') { topPick = c; break; }
        }
        if (!topPick) {
            for (var k = 0; k < candidates.length; k++) {
                var c2 = candidates[k];
                if (c2.verdict === 'RISKY' || c2.verdict === 'LAST_RESORT') { fallback = c2; break; }
            }
        }

        // Insights
        var insights = [];
        if (!candidates.length) {
            insights.push('No substitutes known for "' + req.reagent + '" in catalogue. Consider extending the knowledge base.');
        } else {
            var stockedCount = 0;
            var protocolChangeAll = true;
            for (var m = 0; m < candidates.length; m++) {
                if (candidates[m].stockSufficient) stockedCount++;
                if (!candidates[m].requiresProtocolChange) protocolChangeAll = false;
            }
            if (stockedCount === 0) {
                insights.push('No in-stock substitute meets demand - escalate to reorder.');
            } else if (!topPick && fallback) {
                insights.push('Only risky substitutes are stocked - validate before use.');
            }
            if (protocolChangeAll && candidates.length > 1) {
                insights.push('All candidates require protocol change - allocate validation time.');
            }
            if (reason === 'recalled') {
                insights.push('Source lot is recalled - quarantine immediately even if visually fine.');
            }
        }

        // Grade
        var grade;
        if (!candidates.length) grade = 'F';
        else if (topPick && topPick.verdict === 'RECOMMENDED' && topPick.compatibility >= 0.85) grade = 'A';
        else if (topPick) grade = 'B';
        else if (fallback && fallback.verdict === 'RISKY') grade = 'C';
        else grade = 'D';

        // Playbook
        var playbook = [];
        if (reason === 'failed_qc' || reason === 'recalled') {
            playbook.push({ priority: 'P0', action: 'QUARANTINE_LOT',
                            reason: 'Reagent flagged ' + reason + ' - isolate physically and tag in inventory.' });
        }
        if (!candidates.length || (candidates.length && !topPick && !fallback) || reason === 'recalled') {
            playbook.push({ priority: 'P0', action: 'ESCALATE_REORDER',
                            reason: 'No usable substitute on hand for "' + req.reagent + '".' });
        }
        if (topPick && topPick.requiresProtocolChange) {
            playbook.push({ priority: 'P1', action: 'ADJUST_PROTOCOL',
                            candidate: topPick.name,
                            reason: 'Substitute requires protocol change: ' + topPick.notes });
        }
        if (topPick && topPick.compatibility < 0.85) {
            playbook.push({ priority: 'P1', action: 'VALIDATE_SUBSTITUTE',
                            candidate: topPick.name,
                            reason: 'Compatibility ' + topPick.compatibility + ' < 0.85 - run small-scale pilot first.' });
        }
        if (grade === 'D' || grade === 'F') {
            playbook.push({ priority: 'P2', action: 'NOTIFY_PI',
                            reason: 'Substitution grade ' + grade + ' - escalate decision to principal investigator.' });
        }
        if (playbook.length > 5) playbook = playbook.slice(0, 5);

        return {
            reagent: req.reagent,
            needAmount: needAmount,
            unit: req.unit || null,
            reason: reason,
            priority: priority,
            riskAppetite: riskAppetite,
            candidates: candidates,
            topPick: topPick,
            fallback: fallback,
            insights: insights,
            playbook: playbook,
            grade: grade,
            generatedAt: now().toISOString()
        };
    }

    function recommendBatch(requests) {
        if (!Array.isArray(requests)) throw new Error('recommendBatch requires an array');
        var items = [];
        var gradeCounts = { A: 0, B: 0, C: 0, D: 0, F: 0 };
        var withTopPick = 0;
        var needsEscalation = 0;
        for (var i = 0; i < requests.length; i++) {
            var r = recommend(requests[i]);
            items.push(r);
            gradeCounts[r.grade] = (gradeCounts[r.grade] || 0) + 1;
            if (r.topPick) withTopPick++;
            for (var p = 0; p < r.playbook.length; p++) {
                if (r.playbook[p].action === 'ESCALATE_REORDER') { needsEscalation++; break; }
            }
        }
        return {
            items: items,
            summary: {
                total: items.length,
                withTopPick: withTopPick,
                needsEscalation: needsEscalation,
                gradeCounts: gradeCounts
            },
            generatedAt: now().toISOString()
        };
    }

    function simulate(report, simOpts) {
        if (!report || !Array.isArray(report.candidates)) {
            throw new Error('simulate requires a report from recommend()');
        }
        simOpts = simOpts || {};
        var n = typeof simOpts.applyTopN === 'number' ? simOpts.applyTopN : 1;
        var applied = [];
        var delta = {};
        var remaining = report.needAmount;
        var usable = [];
        for (var i = 0; i < report.candidates.length; i++) {
            if (report.candidates[i].stockSufficient) usable.push(report.candidates[i]);
        }
        for (var j = 0; j < Math.min(n, usable.length); j++) {
            var c = usable[j];
            applied.push(c.name);
            delta[c.name] = -c.suggestedAmount;
            remaining = 0;
        }
        if (!applied.length) remaining = report.needAmount;
        return {
            applied: applied,
            remainingDemand: remaining,
            projectedInventoryDelta: delta
        };
    }

    // === Formatters =====================================================

    function _priorityTag(p) { return '[' + p + ']'; }

    function formatText(report) {
        var lines = [];
        lines.push('Reagent Substitution Advisor - ' + report.reagent +
                   ' (need ' + report.needAmount + (report.unit ? ' ' + report.unit : '') +
                   ', reason=' + report.reason + ', grade=' + report.grade + ')');
        if (!report.candidates.length) {
            lines.push('  (no candidates in catalogue)');
        } else {
            for (var i = 0; i < report.candidates.length; i++) {
                var c = report.candidates[i];
                lines.push('  - ' + c.name + ' [' + c.verdict + ' score=' + c.score +
                           ' compat=' + c.compatibility +
                           ' stock=' + c.availableStock + (c.unit ? ' ' + c.unit : '') +
                           (c.expired ? ' EXPIRED' : (c.expiringSoon ? ' EXPIRES<=7d' : '')) + ']');
                if (c.protocolAdjustments.length) {
                    for (var a = 0; a < c.protocolAdjustments.length; a++) {
                        lines.push('      * ' + c.protocolAdjustments[a]);
                    }
                }
            }
        }
        if (report.insights.length) {
            lines.push('Insights:');
            for (var k = 0; k < report.insights.length; k++) lines.push('  - ' + report.insights[k]);
        }
        if (report.playbook.length) {
            lines.push('Playbook:');
            for (var m = 0; m < report.playbook.length; m++) {
                var p = report.playbook[m];
                lines.push('  ' + _priorityTag(p.priority) + ' ' + p.action +
                           (p.candidate ? ' (' + p.candidate + ')' : '') +
                           ' - ' + p.reason);
            }
        }
        return lines.join('\n');
    }

    function formatMarkdown(report) {
        var lines = [];
        lines.push('## Reagent Substitution: ' + report.reagent);
        lines.push('');
        lines.push('- **Need:** ' + report.needAmount + (report.unit ? ' ' + report.unit : ''));
        lines.push('- **Reason:** `' + report.reason + '` (priority ' + report.priority + ')');
        lines.push('- **Risk appetite:** ' + report.riskAppetite);
        lines.push('- **Grade:** **' + report.grade + '**');
        lines.push('');
        lines.push('### Candidates');
        if (!report.candidates.length) {
            lines.push('- _No substitutes known in catalogue._');
        } else {
            for (var i = 0; i < report.candidates.length; i++) {
                var c = report.candidates[i];
                var tag = c.expired ? ' _expired_' : (c.expiringSoon ? ' _expires<=7d_' : '');
                lines.push('- **' + c.name + '** - ' + c.verdict +
                           ' (score ' + c.score + ', compat ' + c.compatibility +
                           ', stock ' + c.availableStock + (c.unit ? ' ' + c.unit : '') + ')' + tag);
                if (c.protocolAdjustments.length) {
                    for (var a = 0; a < c.protocolAdjustments.length; a++) {
                        lines.push('  - ' + c.protocolAdjustments[a]);
                    }
                }
            }
        }
        if (report.insights.length) {
            lines.push('');
            lines.push('### Insights');
            for (var k = 0; k < report.insights.length; k++) lines.push('- ' + report.insights[k]);
        }
        if (report.playbook.length) {
            lines.push('');
            lines.push('### Playbook');
            for (var m = 0; m < report.playbook.length; m++) {
                var p = report.playbook[m];
                lines.push('- `' + _priorityTag(p.priority) + '` **' + p.action + '**' +
                           (p.candidate ? ' (' + p.candidate + ')' : '') +
                           ' - ' + p.reason);
            }
        }
        return lines.join('\n');
    }

    function formatJson(report) {
        return _sortedJsonStringify(report, 2);
    }

    return {
        recommend: recommend,
        recommendBatch: recommendBatch,
        simulate: simulate,
        setSubstitution: setSubstitution,
        formatText: formatText,
        formatMarkdown: formatMarkdown,
        formatJson: formatJson,
        DEFAULT_SUBSTITUTIONS: DEFAULT_SUBSTITUTIONS,
        VALID_REASONS: VALID_REASONS.slice()
    };
}

module.exports = {
    createReagentSubstitutionAdvisor: createReagentSubstitutionAdvisor,
    DEFAULT_SUBSTITUTIONS: DEFAULT_SUBSTITUTIONS
};
