'use strict';

/**
 * Bioink Batch Genealogy Tracker
 *
 * Tracks lineage/provenance of bioink batches through mixing, splitting,
 * pooling, and passage events. Provides autonomous drift detection,
 * at-risk flagging, chain auditing, and proactive action suggestions.
 *
 * @example
 *   var tracker = createBatchGenealogyTracker();
 *   tracker.registerBatch({ id: 'B1', material: 'alginate', volume: 10, viability: 95, date: '2026-01-01' });
 *   tracker.recordSplit('B1', [{ id: 'B1a', volume: 5 }, { id: 'B1b', volume: 5 }]);
 *   var drift = tracker.detectDrift('B1a');
 */

function createBatchGenealogyTracker() {
    var batches = new Map();

    // ── Helpers ─────────────────────────────────────────────────────

    function requireString(val, name) {
        if (typeof val !== 'string' || val.trim() === '') {
            throw new Error(name + ' must be a non-empty string');
        }
    }

    function requireBatch(id) {
        if (!batches.has(id)) {
            throw new Error('Batch "' + id + '" not found');
        }
        return batches.get(id);
    }

    function now() { return new Date().toISOString(); }

    // ── Registration ────────────────────────────────────────────────

    function registerBatch(batch) {
        if (!batch || typeof batch !== 'object') throw new Error('batch must be an object');
        requireString(batch.id, 'batch.id');
        if (batches.has(batch.id)) throw new Error('Batch "' + batch.id + '" already exists');
        if (typeof batch.volume !== 'number' || batch.volume <= 0) throw new Error('volume must be a positive number');
        if (typeof batch.viability !== 'number' || batch.viability < 0 || batch.viability > 100) throw new Error('viability must be 0-100');
        requireString(batch.material, 'material');

        var record = {
            id: batch.id,
            material: batch.material,
            volume: batch.volume,
            viability: batch.viability,
            passageNumber: 0,
            parentIds: [],
            childIds: [],
            event: 'registered',
            date: batch.date || now(),
            qualityHistory: [{ viability: batch.viability, date: batch.date || now() }],
            metadata: batch.metadata || {},
            generation: 0
        };
        batches.set(batch.id, record);
        return record;
    }

    // ── Lineage Events ──────────────────────────────────────────────

    function recordSplit(parentId, children) {
        requireString(parentId, 'parentId');
        var parent = requireBatch(parentId);
        if (!Array.isArray(children) || children.length === 0) throw new Error('children must be a non-empty array');

        var results = [];
        for (var i = 0; i < children.length; i++) {
            var c = children[i];
            requireString(c.id, 'child.id');
            if (batches.has(c.id)) throw new Error('Batch "' + c.id + '" already exists');
            if (typeof c.volume !== 'number' || c.volume <= 0) throw new Error('child volume must be positive');

            var child = {
                id: c.id,
                material: parent.material,
                volume: c.volume,
                viability: parent.viability,
                passageNumber: parent.passageNumber,
                parentIds: [parentId],
                childIds: [],
                event: 'split',
                date: now(),
                qualityHistory: [{ viability: parent.viability, date: now() }],
                metadata: c.metadata || {},
                generation: parent.generation + 1
            };
            batches.set(c.id, child);
            parent.childIds.push(c.id);
            results.push(child);
        }
        return results;
    }

    function recordPool(sourceIds, result) {
        if (!Array.isArray(sourceIds) || sourceIds.length < 2) throw new Error('sourceIds must have at least 2 entries');
        if (!result || typeof result !== 'object') throw new Error('result must be an object');
        requireString(result.id, 'result.id');
        if (batches.has(result.id)) throw new Error('Batch "' + result.id + '" already exists');

        var totalVolume = 0;
        var weightedViability = 0;
        var maxGen = 0;
        var sources = [];
        for (var i = 0; i < sourceIds.length; i++) {
            var s = requireBatch(sourceIds[i]);
            sources.push(s);
            totalVolume += s.volume;
            weightedViability += s.viability * s.volume;
            if (s.generation > maxGen) maxGen = s.generation;
        }
        var avgViability = totalVolume > 0 ? Math.round((weightedViability / totalVolume) * 100) / 100 : 0;

        var pooled = {
            id: result.id,
            material: sources[0].material,
            volume: Math.round(totalVolume * 1000) / 1000,
            viability: avgViability,
            passageNumber: Math.max.apply(null, sources.map(function (s) { return s.passageNumber; })),
            parentIds: sourceIds.slice(),
            childIds: [],
            event: 'pooled',
            date: now(),
            qualityHistory: [{ viability: avgViability, date: now() }],
            metadata: result.metadata || {},
            generation: maxGen + 1
        };
        batches.set(result.id, pooled);
        for (var j = 0; j < sources.length; j++) {
            sources[j].childIds.push(result.id);
        }
        return pooled;
    }

    function recordPassage(parentId, child) {
        requireString(parentId, 'parentId');
        var parent = requireBatch(parentId);
        if (!child || typeof child !== 'object') throw new Error('child must be an object');
        requireString(child.id, 'child.id');
        if (batches.has(child.id)) throw new Error('Batch "' + child.id + '" already exists');
        if (typeof child.viability !== 'number' || child.viability < 0 || child.viability > 100) throw new Error('viability must be 0-100');

        var rec = {
            id: child.id,
            material: parent.material,
            volume: parent.volume,
            viability: child.viability,
            passageNumber: parent.passageNumber + 1,
            parentIds: [parentId],
            childIds: [],
            event: 'passaged',
            date: now(),
            qualityHistory: [{ viability: child.viability, date: now() }],
            metadata: child.metadata || {},
            generation: parent.generation + 1
        };
        batches.set(child.id, rec);
        parent.childIds.push(child.id);
        return rec;
    }

    function recordQualityUpdate(batchId, metrics) {
        requireString(batchId, 'batchId');
        var batch = requireBatch(batchId);
        if (!metrics || typeof metrics !== 'object') throw new Error('metrics must be an object');

        var entry = { date: now() };
        if (typeof metrics.viability === 'number') {
            batch.viability = metrics.viability;
            entry.viability = metrics.viability;
        }
        if (metrics.contamination !== undefined) entry.contamination = metrics.contamination;
        if (typeof metrics.ph === 'number') entry.ph = metrics.ph;
        if (typeof metrics.temperature === 'number') entry.temperature = metrics.temperature;
        if (metrics.notes) entry.notes = metrics.notes;
        batch.qualityHistory.push(entry);
        return batch;
    }

    // ── Querying ────────────────────────────────────────────────────

    function getLineage(batchId) {
        requireString(batchId, 'batchId');
        var current = requireBatch(batchId);
        var chain = [current];
        var visited = {};
        visited[batchId] = true;
        while (current.parentIds.length > 0) {
            var pid = current.parentIds[0];
            if (visited[pid]) break;
            visited[pid] = true;
            current = requireBatch(pid);
            chain.unshift(current);
        }
        return chain;
    }

    function getDescendants(batchId) {
        requireString(batchId, 'batchId');
        requireBatch(batchId);
        var result = [];
        var queue = [batchId];
        var visited = {};
        visited[batchId] = true;
        while (queue.length > 0) {
            var id = queue.shift();
            var b = batches.get(id);
            if (id !== batchId) result.push(b);
            for (var i = 0; i < b.childIds.length; i++) {
                if (!visited[b.childIds[i]]) {
                    visited[b.childIds[i]] = true;
                    queue.push(b.childIds[i]);
                }
            }
        }
        return result;
    }

    function getTree(batchId) {
        requireString(batchId, 'batchId');
        var batch = requireBatch(batchId);
        var children = [];
        for (var i = 0; i < batch.childIds.length; i++) {
            children.push(getTree(batch.childIds[i]));
        }
        return { batch: batch, children: children };
    }

    function getBatch(batchId) {
        requireString(batchId, 'batchId');
        return requireBatch(batchId);
    }

    function listBatches(filter) {
        var result = [];
        batches.forEach(function (b) {
            if (filter) {
                if (filter.material && b.material !== filter.material) return;
                if (typeof filter.minViability === 'number' && b.viability < filter.minViability) return;
                if (typeof filter.maxPassage === 'number' && b.passageNumber > filter.maxPassage) return;
                if (filter.since && b.date < filter.since) return;
            }
            result.push(b);
        });
        return result;
    }

    // ── Agentic / Autonomous Features ───────────────────────────────

    function detectDrift(batchId) {
        requireString(batchId, 'batchId');
        var lineage = getLineage(batchId);
        var metrics = [];
        var hasDrift = false;

        // Viability drift
        if (lineage.length >= 2) {
            var first = lineage[0].viability;
            var last = lineage[lineage.length - 1].viability;
            var delta = last - first;
            var severity = 'low';
            if (Math.abs(delta) > 20) severity = 'critical';
            else if (Math.abs(delta) > 10) severity = 'high';
            else if (Math.abs(delta) > 5) severity = 'medium';
            if (Math.abs(delta) > 2) hasDrift = true;
            metrics.push({ name: 'viability', trend: delta > 0 ? 'improving' : delta < 0 ? 'declining' : 'stable', delta: Math.round(delta * 100) / 100, severity: severity });
        }

        // Passage accumulation
        var currentBatch = requireBatch(batchId);
        if (currentBatch.passageNumber > 10) {
            hasDrift = true;
            metrics.push({ name: 'passage_count', trend: 'high', delta: currentBatch.passageNumber, severity: currentBatch.passageNumber > 20 ? 'critical' : 'high' });
        }

        // Generation depth
        if (currentBatch.generation > 8) {
            metrics.push({ name: 'generation_depth', trend: 'deep', delta: currentBatch.generation, severity: currentBatch.generation > 15 ? 'high' : 'medium' });
        }

        var recommendations = [];
        if (hasDrift) {
            recommendations.push('Review quality control records for this lineage');
            if (currentBatch.viability < 80) recommendations.push('Consider starting a new batch from frozen stock');
            if (currentBatch.passageNumber > 15) recommendations.push('High passage number — validate cell identity');
        }

        return { hasDrift: hasDrift, metrics: metrics, recommendations: recommendations };
    }

    function flagAtRiskDescendants(batchId, threshold) {
        requireString(batchId, 'batchId');
        var thresh = typeof threshold === 'number' ? threshold : 70;
        var descendants = getDescendants(batchId);
        var atRisk = [];
        for (var i = 0; i < descendants.length; i++) {
            if (descendants[i].viability < thresh) {
                atRisk.push(descendants[i]);
            }
        }
        var recommendations = [];
        if (atRisk.length > 0) {
            recommendations.push(atRisk.length + ' descendant(s) below ' + thresh + '% viability threshold');
            recommendations.push('Quarantine affected batches and run contamination checks');
            if (atRisk.length > descendants.length * 0.5) {
                recommendations.push('Majority of descendants at risk — investigate root batch quality');
            }
        }
        return { atRisk: atRisk, summary: atRisk.length + ' of ' + descendants.length + ' descendants at risk', recommendations: recommendations };
    }

    function auditChain(batchId) {
        requireString(batchId, 'batchId');
        var lineage = getLineage(batchId);
        var issues = [];
        var score = 100;

        for (var i = 1; i < lineage.length; i++) {
            var curr = lineage[i];
            var prev = lineage[i - 1];

            // Check parent reference exists
            if (curr.parentIds.indexOf(prev.id) === -1) {
                issues.push({ type: 'orphan_reference', batch: curr.id, detail: 'Parent ' + prev.id + ' not in parentIds' });
                score -= 20;
            }

            // Check passage number sequentiality
            if (curr.event === 'passaged' && curr.passageNumber !== prev.passageNumber + 1) {
                issues.push({ type: 'passage_gap', batch: curr.id, detail: 'Expected passage ' + (prev.passageNumber + 1) + ', got ' + curr.passageNumber });
                score -= 10;
            }

            // Check material consistency
            if (curr.material !== prev.material) {
                issues.push({ type: 'material_mismatch', batch: curr.id, detail: 'Material changed from ' + prev.material + ' to ' + curr.material });
                score -= 15;
            }
        }

        // Check splits volume balance
        var root = requireBatch(batchId);
        if (root.event === 'registered' || root.event === 'split') {
            var childVol = 0;
            for (var j = 0; j < root.childIds.length; j++) {
                var ch = batches.get(root.childIds[j]);
                if (ch && ch.event === 'split') childVol += ch.volume;
            }
            if (root.childIds.length > 0 && childVol > 0 && Math.abs(childVol - root.volume) > 0.01) {
                issues.push({ type: 'volume_imbalance', batch: root.id, detail: 'Split volumes (' + childVol + ') != parent volume (' + root.volume + ')' });
                score -= 10;
            }
        }

        if (score < 0) score = 0;
        return { valid: issues.length === 0, issues: issues, score: score };
    }

    function suggestAction(batchId) {
        requireString(batchId, 'batchId');
        var batch = requireBatch(batchId);
        var drift = detectDrift(batchId);

        if (batch.viability < 50) {
            return { action: 'discard', reason: 'Viability critically low at ' + batch.viability + '%', urgency: 'high', details: 'Batch is no longer viable for use. Dispose according to lab protocol.' };
        }
        if (batch.viability < 70) {
            return { action: 'quality-check', reason: 'Viability below threshold at ' + batch.viability + '%', urgency: 'medium', details: 'Run contamination panel and mycoplasma test before further use.' };
        }
        if (batch.passageNumber > 15) {
            return { action: 'discard', reason: 'Passage number (' + batch.passageNumber + ') exceeds safe limit', urgency: 'high', details: 'High passage cells may have drifted from original phenotype. Start fresh from frozen stock.' };
        }
        if (batch.passageNumber >= 8 && batch.passageNumber <= 15) {
            return { action: 'passage-now', reason: 'Passage ' + batch.passageNumber + ' — approaching limit, passage while quality is good', urgency: 'medium', details: 'Passage soon and cryopreserve a portion as backup.' };
        }
        if (drift.hasDrift && drift.metrics.some(function (m) { return m.severity === 'high' || m.severity === 'critical'; })) {
            return { action: 'quality-check', reason: 'Significant quality drift detected in lineage', urgency: 'medium', details: drift.metrics.map(function (m) { return m.name + ': ' + m.trend; }).join(', ') };
        }
        // Check if there are sibling batches to pool with
        if (batch.volume < 2 && batch.parentIds.length > 0) {
            var parent = batches.get(batch.parentIds[0]);
            if (parent) {
                var siblings = parent.childIds.filter(function (id) { return id !== batchId; });
                if (siblings.length > 0) {
                    return { action: 'pool-with', reason: 'Low volume (' + batch.volume + 'mL) — consider pooling with siblings', urgency: 'low', details: 'Sibling batches: ' + siblings.join(', ') };
                }
            }
        }
        return { action: 'continue', reason: 'Batch is in good condition', urgency: 'low', details: 'Viability: ' + batch.viability + '%, Passage: ' + batch.passageNumber + ', Generation: ' + batch.generation };
    }

    // ── Export ───────────────────────────────────────────────────────

    function exportGenealogy(batchId, format) {
        requireString(batchId, 'batchId');
        var tree = getTree(batchId);

        if (format === 'json') {
            return JSON.stringify(tree, null, 2);
        }

        // Default: markdown
        var lines = [];
        function walk(node, indent) {
            var b = node.batch;
            var prefix = '';
            for (var i = 0; i < indent; i++) prefix += '  ';
            lines.push(prefix + '- **' + b.id + '** (' + b.event + ') — ' + b.material + ', ' + b.volume + 'mL, viability: ' + b.viability + '%, passage: ' + b.passageNumber + ', gen: ' + b.generation);
            for (var j = 0; j < node.children.length; j++) {
                walk(node.children[j], indent + 1);
            }
        }
        walk(tree, 0);
        return '# Batch Genealogy: ' + batchId + '\n\n' + lines.join('\n') + '\n';
    }

    function getSummary() {
        var total = batches.size;
        var viabilities = [];
        var materials = {};
        var generations = {};
        var active = 0;
        var retired = 0;

        batches.forEach(function (b) {
            viabilities.push(b.viability);
            materials[b.material] = (materials[b.material] || 0) + 1;
            var gen = String(b.generation);
            generations[gen] = (generations[gen] || 0) + 1;
            if (b.viability >= 50 && b.childIds.length === 0) active++;
            else if (b.viability < 50) retired++;
        });

        var avgViability = 0;
        if (viabilities.length > 0) {
            var sum = 0;
            for (var i = 0; i < viabilities.length; i++) sum += viabilities[i];
            avgViability = Math.round((sum / viabilities.length) * 100) / 100;
        }

        return {
            totalBatches: total,
            avgViability: avgViability,
            generationDistribution: generations,
            materialBreakdown: materials,
            active: active,
            retired: retired
        };
    }

    // ── Public API ──────────────────────────────────────────────────

    return {
        registerBatch: registerBatch,
        recordSplit: recordSplit,
        recordPool: recordPool,
        recordPassage: recordPassage,
        recordQualityUpdate: recordQualityUpdate,
        getLineage: getLineage,
        getDescendants: getDescendants,
        getTree: getTree,
        getBatch: getBatch,
        listBatches: listBatches,
        detectDrift: detectDrift,
        flagAtRiskDescendants: flagAtRiskDescendants,
        auditChain: auditChain,
        suggestAction: suggestAction,
        exportGenealogy: exportGenealogy,
        getSummary: getSummary
    };
}

module.exports = { createBatchGenealogyTracker: createBatchGenealogyTracker };
