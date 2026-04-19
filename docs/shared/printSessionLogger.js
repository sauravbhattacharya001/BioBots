'use strict';

/**
 * Print Session Logger — track bioprint job history with search, analytics, and export.
 *
 * Records each print session with material, parameters, outcomes, and notes.
 * Provides filtering, statistics, success-rate analysis, and duration tracking.
 *
 * @example
 *   var logger = biobots.createPrintSessionLogger();
 *   logger.logSession({
 *     material: 'alginate', nozzle: '27G', pressure: 12,
 *     temperature: 25, speed: 8, duration: 45,
 *     outcome: 'success', viability: 92, notes: 'Clean extrusion'
 *   });
 *   var stats = logger.getStats();
 *   var recent = logger.query({ material: 'alginate', outcome: 'success' });
 */

/* ── helpers ─────────────────────────────────────────────────────── */

var _sanitize = require('./sanitize');
var _stripDangerousKeys = _sanitize.stripDangerousKeys;

function generateId() {
    return 'ps-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** Allowed sort keys — prevents prototype pollution via sortBy parameter. */
var VALID_SORT_KEYS = {
    timestamp: 1, material: 1, nozzle: 1, pressure: 1, temperature: 1,
    speed: 1, duration: 1, outcome: 1, viability: 1, operator: 1, id: 1
};

function matchesFilter(session, filters) {
    var keys = Object.keys(filters);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        // Reject prototype-pollution keys in filter objects
        if (_sanitize.isDangerousKey(k)) continue;
        var v = filters[k];
        if (k === 'fromDate') {
            if (new Date(session.timestamp) < new Date(v)) return false;
        } else if (k === 'toDate') {
            if (new Date(session.timestamp) > new Date(v)) return false;
        } else if (k === 'minViability') {
            if (session.viability == null || session.viability < v) return false;
        } else if (k === 'maxDuration') {
            if (session.duration == null || session.duration > v) return false;
        } else if (k === 'tags') {
            if (!session.tags || !v.every(function(t) { return session.tags.indexOf(t) >= 0; })) return false;
        } else if (session[k] !== v) {
            return false;
        }
    }
    return true;
}

var median = require('./stats').median;

// Pre-compiled regex for CSV quoting — avoids re-compilation per cell.
var _csvQuoteRe = /[,"\n\r]/;

/* ── valid values ────────────────────────────────────────────────── */

var OUTCOMES = ['success', 'partial', 'failure', 'aborted'];
var MATERIALS = [
    'alginate', 'gelatin', 'collagen', 'fibrin', 'hyaluronic_acid',
    'pcl', 'pla', 'gelma', 'matrigel', 'chitosan', 'silk', 'custom'
];

/* ── factory ─────────────────────────────────────────────────────── */

function createPrintSessionLogger() {
    var sessions = [];
    var sessionIndex = {};  // id → array index for O(1) lookups

    /**
     * Log a new print session.
     * @param {Object} opts
     * @param {string} opts.material - Bioink material used
     * @param {string} [opts.nozzle] - Nozzle gauge (e.g. '27G')
     * @param {number} [opts.pressure] - Extrusion pressure (kPa)
     * @param {number} [opts.temperature] - Print temperature (°C)
     * @param {number} [opts.speed] - Print speed (mm/s)
     * @param {number} [opts.duration] - Session duration (minutes)
     * @param {string} opts.outcome - 'success'|'partial'|'failure'|'aborted'
     * @param {number} [opts.viability] - Cell viability % (0-100)
     * @param {string} [opts.notes] - Free-text notes
     * @param {string[]} [opts.tags] - Tags for categorization
     * @param {string} [opts.operator] - Operator name
     * @param {string} [opts.scaffold] - Scaffold geometry description
     * @returns {Object} The logged session record
     */
    function logSession(opts) {
        if (!opts || typeof opts !== 'object') {
            throw new Error('logSession requires an options object');
        }
        // Sanitize user input to prevent prototype pollution
        opts = _stripDangerousKeys(opts);
        if (!opts.material) {
            throw new Error('material is required');
        }
        if (!opts.outcome || OUTCOMES.indexOf(opts.outcome) < 0) {
            throw new Error('outcome must be one of: ' + OUTCOMES.join(', '));
        }
        if (opts.viability != null && (opts.viability < 0 || opts.viability > 100)) {
            throw new Error('viability must be 0-100');
        }
        if (opts.duration != null && opts.duration < 0) {
            throw new Error('duration must be non-negative');
        }

        var record = {
            id: generateId(),
            timestamp: new Date().toISOString(),
            material: opts.material,
            nozzle: opts.nozzle || null,
            pressure: opts.pressure != null ? opts.pressure : null,
            temperature: opts.temperature != null ? opts.temperature : null,
            speed: opts.speed != null ? opts.speed : null,
            duration: opts.duration != null ? opts.duration : null,
            outcome: opts.outcome,
            viability: opts.viability != null ? opts.viability : null,
            notes: opts.notes || '',
            tags: opts.tags || [],
            operator: opts.operator || null,
            scaffold: opts.scaffold || null
        };

        sessionIndex[record.id] = sessions.length;
        sessions.push(record);
        return record;
    }

    /**
     * Query sessions matching filters.
     * @param {Object} [filters] - material, outcome, operator, fromDate, toDate, minViability, maxDuration, tags
     * @param {Object} [options] - sortBy, order ('asc'|'desc'), limit
     * @returns {Object[]} Matching sessions
     */
    function query(filters, options) {
        filters = _stripDangerousKeys(filters || {});
        options = _stripDangerousKeys(options || {});

        var results = sessions.filter(function(s) {
            return matchesFilter(s, filters);
        });

        // sort
        var sortBy = options.sortBy || 'timestamp';
        // Validate sortBy against whitelist to prevent prototype key access
        if (!VALID_SORT_KEYS[sortBy]) sortBy = 'timestamp';
        var order = options.order === 'asc' ? 1 : -1;
        results.sort(function(a, b) {
            var va = a[sortBy], vb = b[sortBy];
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            if (va < vb) return -order;
            if (va > vb) return order;
            return 0;
        });

        if (options.limit && options.limit > 0) {
            results = results.slice(0, options.limit);
        }

        return results;
    }

    /**
     * Filter sessions without sorting — O(n) instead of O(n log n).
     * Used by getStats and other aggregation methods that don't need
     * ordered results.
     */
    function _filter(filters) {
        filters = _stripDangerousKeys(filters || {});
        var results = [];
        for (var i = 0; i < sessions.length; i++) {
            if (matchesFilter(sessions[i], filters)) results.push(sessions[i]);
        }
        return results;
    }

    /**
     * Get aggregate statistics, optionally filtered.
     * Uses _filter() instead of query() to skip the O(n log n) sort
     * that getStats doesn't need.
     * @param {Object} [filters] - Same as query filters
     * @returns {Object} Stats: total, successRate, avgViability, avgDuration, materialBreakdown, outcomeBreakdown
     */
    function getStats(filters) {
        var data = _filter(filters);
        var total = data.length;
        if (total === 0) {
            return {
                total: 0, successRate: 0, avgViability: 0, medianViability: 0,
                avgDuration: 0, medianDuration: 0,
                materialBreakdown: {}, outcomeBreakdown: {},
                operatorBreakdown: {}
            };
        }

        var successes = 0;
        var viabilities = [];
        var durations = [];
        var materials = {};
        var outcomes = {};
        var operators = {};

        for (var i = 0; i < data.length; i++) {
            var s = data[i];
            if (s.outcome === 'success') successes++;
            if (s.viability != null) viabilities.push(s.viability);
            if (s.duration != null) durations.push(s.duration);
            materials[s.material] = (materials[s.material] || 0) + 1;
            outcomes[s.outcome] = (outcomes[s.outcome] || 0) + 1;
            if (s.operator) operators[s.operator] = (operators[s.operator] || 0) + 1;
        }

        var avgViab = viabilities.length ? viabilities.reduce(function(a, b) { return a + b; }, 0) / viabilities.length : 0;
        var avgDur = durations.length ? durations.reduce(function(a, b) { return a + b; }, 0) / durations.length : 0;

        return {
            total: total,
            successRate: Math.round((successes / total) * 10000) / 100,
            avgViability: Math.round(avgViab * 100) / 100,
            medianViability: median(viabilities),
            avgDuration: Math.round(avgDur * 100) / 100,
            medianDuration: median(durations),
            materialBreakdown: materials,
            outcomeBreakdown: outcomes,
            operatorBreakdown: operators
        };
    }

    /**
     * Get success rate trend over time (daily buckets).
     * Uses _filter() + Object.keys().sort() instead of query() with
     * full record sort — bucket keys are sorted in O(b log b) where
     * b is the number of distinct days, much smaller than n records.
     * @param {Object} [filters]
     * @returns {Object[]} Array of {date, total, successes, rate}
     */
    function getSuccessTrend(filters) {
        var data = _filter(filters);
        var buckets = {};

        for (var i = 0; i < data.length; i++) {
            var day = data[i].timestamp.slice(0, 10);
            if (!buckets[day]) buckets[day] = { date: day, total: 0, successes: 0 };
            buckets[day].total++;
            if (data[i].outcome === 'success') buckets[day].successes++;
        }

        var days = Object.keys(buckets).sort();
        return days.map(function(d) {
            var b = buckets[d];
            return {
                date: b.date,
                total: b.total,
                successes: b.successes,
                rate: Math.round((b.successes / b.total) * 10000) / 100
            };
        });
    }

    /**
     * Compare two parameter sets by success rate.
     * @param {Object} filtersA
     * @param {Object} filtersB
     * @returns {Object} { a: stats, b: stats, recommendation: string }
     */
    function compare(filtersA, filtersB) {
        var statsA = getStats(filtersA);
        var statsB = getStats(filtersB);

        var rec;
        if (statsA.total < 3 || statsB.total < 3) {
            rec = 'Insufficient data — need at least 3 sessions per group for meaningful comparison';
        } else if (statsA.successRate > statsB.successRate + 5) {
            rec = 'Group A parameters perform better (success rate +' +
                Math.round(statsA.successRate - statsB.successRate) + '%)';
        } else if (statsB.successRate > statsA.successRate + 5) {
            rec = 'Group B parameters perform better (success rate +' +
                Math.round(statsB.successRate - statsA.successRate) + '%)';
        } else {
            rec = 'Both parameter sets perform similarly';
        }

        return { a: statsA, b: statsB, recommendation: rec };
    }

    /**
     * Delete a session by ID.
     * @param {string} id
     * @returns {boolean}
     */
    function deleteSession(id) {
        var idx = sessionIndex[id];
        if (idx === undefined) return false;
        sessions.splice(idx, 1);
        delete sessionIndex[id];
        // Rebuild index for shifted elements
        for (var i = idx; i < sessions.length; i++) {
            sessionIndex[sessions[i].id] = i;
        }
        return true;
    }

    /**
     * Update notes/tags on an existing session.
     * @param {string} id
     * @param {Object} updates - { notes, tags, outcome, viability }
     * @returns {Object|null}
     */
    function updateSession(id, updates) {
        var idx = sessionIndex[id];
        if (idx === undefined) return null;
        var s = sessions[idx];
        if (updates.notes !== undefined) s.notes = updates.notes;
        if (updates.tags !== undefined) s.tags = updates.tags;
        if (updates.outcome !== undefined) {
            if (OUTCOMES.indexOf(updates.outcome) < 0) {
                throw new Error('outcome must be one of: ' + OUTCOMES.join(', '));
            }
            s.outcome = updates.outcome;
        }
        if (updates.viability !== undefined) {
            if (updates.viability !== null && (updates.viability < 0 || updates.viability > 100)) {
                throw new Error('viability must be 0-100');
            }
            s.viability = updates.viability;
        }
        return s;
    }

    /**
     * Export session data as CSV string.
     * @param {Object} [filters]
     * @returns {string}
     */
    function exportCSV(filters) {
        var data = query(filters, { sortBy: 'timestamp', order: 'asc' });
        var headers = ['id', 'timestamp', 'material', 'nozzle', 'pressure', 'temperature',
            'speed', 'duration', 'outcome', 'viability', 'operator', 'scaffold', 'tags', 'notes'];
        var lines = [headers.join(',')];

        for (var i = 0; i < data.length; i++) {
            var s = data[i];
            var row = headers.map(function(h) {
                var v = s[h];
                if (v == null) return '';
                if (Array.isArray(v)) v = v.join(';');
                v = String(v);
                // Formula injection guard (CWE-1236): prefix dangerous
                // leaders with a single-quote to force text mode in
                // spreadsheets. Skip legitimate negative/positive numbers
                // (e.g. -3.14, +1.5) to avoid corrupting numeric data.
                var ch = v.charAt(0);
                if (ch === '=' || ch === '+' || ch === '-' ||
                    ch === '@' || ch === '\t' || ch === '\r' ||
                    ch === '|') {
                    if (!((ch === '-' || ch === '+') && v.length > 1 && isFinite(Number(v)))) {
                        v = "'" + v;
                    }
                }
                // CSV-safe: quote if contains comma, newline, or quote
                if (_csvQuoteRe.test(v)) {
                    v = '"' + v.replace(/"/g, '""') + '"';
                }
                return v;
            });
            lines.push(row.join(','));
        }

        return lines.join('\n');
    }

    /**
     * Get best-performing parameter combination for a material.
     * @param {string} material
     * @returns {Object|null} Best session by viability among successes
     */
    function bestParams(material) {
        var data = query({ material: material, outcome: 'success' });
        if (!data.length) return null;

        var best = null;
        for (var i = 0; i < data.length; i++) {
            if (data[i].viability != null) {
                if (!best || data[i].viability > best.viability) {
                    best = data[i];
                }
            }
        }
        return best || data[0];
    }

    return {
        logSession: logSession,
        query: query,
        getStats: getStats,
        getSuccessTrend: getSuccessTrend,
        compare: compare,
        deleteSession: deleteSession,
        updateSession: updateSession,
        exportCSV: exportCSV,
        bestParams: bestParams,
        OUTCOMES: OUTCOMES,
        MATERIALS: MATERIALS
    };
}

module.exports = { createPrintSessionLogger: createPrintSessionLogger };
