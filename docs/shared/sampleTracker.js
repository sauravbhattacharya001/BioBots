'use strict';

/**
 * SampleTracker — Track bioprint samples through workflow stages.
 *
 * Stages: Queued → Printing → Crosslinking → Incubation → Testing → Complete
 *
 * Each sample has: id, name, material, cellType, stage, notes[], timestamps,
 * priority (low/medium/high/urgent), assignee, metadata.
 */

var _sanitizeMetadata = require('./sanitize').stripDangerousKeys;

var STAGES = ['Queued', 'Printing', 'Crosslinking', 'Incubation', 'Testing', 'Complete'];
var PRIORITIES = ['low', 'medium', 'high', 'urgent'];
var ERR_SAMPLE_NOT_FOUND = 'Sample not found: ';

function createSampleTracker() {
    var samples = [];
    var sampleIndex = {};  // id → sample object for O(1) lookups
    var nextId = 1;
    var listeners = [];

    function _emit(event, data) {
        listeners.forEach(function(fn) { try { fn(event, data); } catch(e) {} });
    }

    function _findSample(id) {
        return sampleIndex[id] || null;
    }

    function _now() { return new Date().toISOString(); }

    function addSample(opts) {
        if (!opts || !opts.name || typeof opts.name !== 'string' || !opts.name.trim()) {
            throw new Error('Sample name is required');
        }
        var sample = {
            id: nextId++,
            name: opts.name.trim(),
            material: (opts.material || '').trim() || 'Unknown',
            cellType: (opts.cellType || '').trim() || 'Unspecified',
            stage: STAGES[0],
            priority: PRIORITIES.indexOf(opts.priority) >= 0 ? opts.priority : 'medium',
            assignee: (opts.assignee || '').trim() || null,
            notes: [],
            metadata: _sanitizeMetadata(opts.metadata || {}),
            timestamps: { created: _now(), Queued: _now() },
            history: [{ stage: STAGES[0], timestamp: _now(), action: 'created' }]
        };
        samples.push(sample);
        sampleIndex[sample.id] = sample;
        _emit('added', sample);
        return sample;
    }

    function advanceSample(id) {
        var s = _findSample(id);
        if (!s) throw new Error(ERR_SAMPLE_NOT_FOUND + id);
        var idx = STAGES.indexOf(s.stage);
        if (idx >= STAGES.length - 1) throw new Error('Sample already at final stage');
        var prev = s.stage;
        s.stage = STAGES[idx + 1];
        s.timestamps[s.stage] = _now();
        s.history.push({ stage: s.stage, from: prev, timestamp: _now(), action: 'advanced' });
        _emit('advanced', { sample: s, from: prev, to: s.stage });
        return s;
    }

    function moveSample(id, targetStage) {
        var s = _findSample(id);
        if (!s) throw new Error(ERR_SAMPLE_NOT_FOUND + id);
        if (STAGES.indexOf(targetStage) < 0) throw new Error('Invalid stage: ' + targetStage);
        var prev = s.stage;
        s.stage = targetStage;
        s.timestamps[targetStage] = _now();
        s.history.push({ stage: targetStage, from: prev, timestamp: _now(), action: 'moved' });
        _emit('moved', { sample: s, from: prev, to: targetStage });
        return s;
    }

    function addNote(id, text) {
        var s = _findSample(id);
        if (!s) throw new Error(ERR_SAMPLE_NOT_FOUND + id);
        if (!text || typeof text !== 'string' || !text.trim()) throw new Error('Note text is required');
        var note = { text: text.trim(), timestamp: _now() };
        s.notes.push(note);
        _emit('note', { sample: s, note: note });
        return note;
    }

    function setPriority(id, priority) {
        var s = _findSample(id);
        if (!s) throw new Error(ERR_SAMPLE_NOT_FOUND + id);
        if (PRIORITIES.indexOf(priority) < 0) throw new Error('Invalid priority: ' + priority);
        s.priority = priority;
        _emit('priority', { sample: s, priority: priority });
        return s;
    }

    function setAssignee(id, assignee) {
        var s = _findSample(id);
        if (!s) throw new Error(ERR_SAMPLE_NOT_FOUND + id);
        s.assignee = assignee ? assignee.trim() : null;
        return s;
    }

    function removeSample(id) {
        var s = _findSample(id);
        if (!s) throw new Error(ERR_SAMPLE_NOT_FOUND + id);
        var idx = samples.indexOf(s);
        if (idx >= 0) samples.splice(idx, 1);
        delete sampleIndex[id];
        _emit('removed', s);
        return s;
    }

    function getSample(id) {
        var s = _findSample(id);
        if (!s) throw new Error(ERR_SAMPLE_NOT_FOUND + id);
        return s;
    }

    function getBoard() {
        var board = {};
        STAGES.forEach(function(st) { board[st] = []; });
        samples.forEach(function(s) { board[s.stage].push(s); });
        // Sort by priority within each stage
        var pOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
        STAGES.forEach(function(st) {
            board[st].sort(function(a, b) {
                var diff = (pOrder[a.priority] !== undefined ? pOrder[a.priority] : 2) - (pOrder[b.priority] !== undefined ? pOrder[b.priority] : 2);
                if (diff !== 0) return diff;
                return a.id - b.id;
            });
        });
        return board;
    }

    function getStats() {
        // Single-pass aggregation — no longer calls getBoard() which
        // would copy + sort every stage just to count entries.
        var stats = { total: samples.length, byStage: {}, byPriority: {}, byMaterial: {} };
        STAGES.forEach(function(st) { stats.byStage[st] = 0; });
        PRIORITIES.forEach(function(p) { stats.byPriority[p] = 0; });
        var completeCount = 0;
        for (var i = 0; i < samples.length; i++) {
            var s = samples[i];
            stats.byStage[s.stage] = (stats.byStage[s.stage] || 0) + 1;
            stats.byPriority[s.priority] = (stats.byPriority[s.priority] || 0) + 1;
            stats.byMaterial[s.material] = (stats.byMaterial[s.material] || 0) + 1;
            if (s.stage === 'Complete') completeCount++;
        }
        stats.completionRate = samples.length > 0
            ? Math.round((completeCount / samples.length) * 100) : 0;
        return stats;
    }

    function search(query) {
        var q = (query || '').toLowerCase().trim();
        if (!q) return samples.slice();
        return samples.filter(function(s) {
            return s.name.toLowerCase().indexOf(q) >= 0
                || s.material.toLowerCase().indexOf(q) >= 0
                || s.cellType.toLowerCase().indexOf(q) >= 0
                || (s.assignee && s.assignee.toLowerCase().indexOf(q) >= 0);
        });
    }

    function filter(opts) {
        // Single-pass filter instead of chaining up to 4 separate
        // .filter() calls (each creating a new intermediate array).
        var wantStage = opts.stage || null;
        var wantPriority = opts.priority || null;
        var wantMaterial = opts.material || null;
        var wantAssignee = opts.assignee || null;
        var result = [];
        for (var i = 0; i < samples.length; i++) {
            var s = samples[i];
            if (wantStage && s.stage !== wantStage) continue;
            if (wantPriority && s.priority !== wantPriority) continue;
            if (wantMaterial && s.material !== wantMaterial) continue;
            if (wantAssignee && s.assignee !== wantAssignee) continue;
            result.push(s);
        }
        return result;
    }

    function getDwellTime(id) {
        var s = _findSample(id);
        if (!s) throw new Error(ERR_SAMPLE_NOT_FOUND + id);
        var times = {};
        for (var i = 0; i < s.history.length - 1; i++) {
            var curr = s.history[i];
            var next = s.history[i + 1];
            var dur = new Date(next.timestamp) - new Date(curr.timestamp);
            times[curr.stage] = (times[curr.stage] || 0) + dur;
        }
        // Current stage dwell
        var last = s.history[s.history.length - 1];
        times[last.stage] = (times[last.stage] || 0) + (Date.now() - new Date(last.timestamp));
        return times;
    }

    function exportJSON() {
        return JSON.stringify({ samples: samples, exportedAt: _now(), stats: getStats() }, null, 2);
    }

    /**
     * Escape a value for safe CSV embedding.
     * Wraps in quotes when the value contains comma, quote, or newline.
     * Prefixes formula-triggering characters (= + - @ \t \r) with a
     * single-quote to prevent spreadsheet formula injection (OWASP).
     * Numeric strings starting with +/- are left as-is.
     * @private
     */
    function _escapeCSV(value) {
        if (value == null) return '';
        var str = String(value);
        var ch = str.charAt(0);
        if (ch === '=' || ch === '+' || ch === '-' ||
            ch === '@' || ch === '\t' || ch === '\r') {
            if (!((ch === '-' || ch === '+') && str.length > 1 && isFinite(Number(str)))) {
                str = "'" + str;
            }
        }
        if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 ||
            str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1 ||
            str !== str.trim()) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    function exportCSV() {
        var header = 'ID,Name,Material,Cell Type,Stage,Priority,Assignee,Created';
        var rows = samples.map(function(s) {
            return [
                s.id,
                _escapeCSV(s.name),
                _escapeCSV(s.material),
                _escapeCSV(s.cellType),
                _escapeCSV(s.stage),
                _escapeCSV(s.priority),
                _escapeCSV(s.assignee),
                _escapeCSV(s.timestamps.created)
            ].join(',');
        });
        return header + '\n' + rows.join('\n');
    }

    function onEvent(fn) {
        if (typeof fn === 'function') listeners.push(fn);
    }

    function importSamples(data) {
        if (!Array.isArray(data)) throw new Error('Expected array of samples');
        var imported = 0;
        data.forEach(function(d) {
            try { addSample(d); imported++; } catch(e) { /* skip invalid entries */ }
        });
        return imported;
    }

    return {
        STAGES: STAGES,
        PRIORITIES: PRIORITIES,
        addSample: addSample,
        advanceSample: advanceSample,
        moveSample: moveSample,
        addNote: addNote,
        setPriority: setPriority,
        setAssignee: setAssignee,
        removeSample: removeSample,
        getSample: getSample,
        getBoard: getBoard,
        getStats: getStats,
        search: search,
        filter: filter,
        getDwellTime: getDwellTime,
        exportJSON: exportJSON,
        exportCSV: exportCSV,
        onEvent: onEvent,
        importSamples: importSamples
    };
}

module.exports = { createSampleTracker: createSampleTracker, STAGES: STAGES, PRIORITIES: PRIORITIES };
