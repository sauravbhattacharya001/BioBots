'use strict';

/**
 * Experiment Tracker for BioBots
 *
 * Plan, log, and compare bioprinting experiments with structured hypothesis
 * tracking, variable control (independent/dependent/controlled), result
 * recording, and cross-experiment analysis.
 *
 * Features:
 *   - Experiment lifecycle (draft → running → completed/failed/cancelled)
 *   - Hypothesis definition with testable predictions
 *   - Independent, dependent, and controlled variable management
 *   - Trial logging with parameter values and measurements
 *   - Statistical summary (mean, stdDev, min, max, CV) per dependent variable
 *   - Hypothesis evaluation (supported/refuted/inconclusive) with reasoning
 *   - Cross-experiment comparison on shared dependent variables
 *   - Tags, notes, search, and filtering
 *   - JSON and CSV export/import with validation
 *
 * Usage:
 *   const tracker = createExperimentTracker();
 *   const exp = tracker.create({
 *     title: 'Effect of nozzle diameter on cell viability',
 *     hypothesis: {
 *       statement: 'Larger nozzles reduce shear stress and improve viability',
 *       prediction: 'Viability > 90% with 0.4mm nozzle vs < 80% with 0.2mm'
 *     },
 *     variables: {
 *       independent: [{ name: 'nozzle_diameter', unit: 'mm', values: [0.2, 0.3, 0.4] }],
 *       dependent:   [{ name: 'cell_viability', unit: '%' }],
 *       controlled:  [{ name: 'print_speed', unit: 'mm/s', value: 10 },
 *                     { name: 'temperature', unit: '°C', value: 37 }]
 *     }
 *   });
 *   exp.addTrial({ nozzle_diameter: 0.2 }, { cell_viability: 72.5 });
 *   exp.addTrial({ nozzle_diameter: 0.3 }, { cell_viability: 85.1 });
 *   exp.addTrial({ nozzle_diameter: 0.4 }, { cell_viability: 93.7 });
 *   exp.complete();
 *   const stats = exp.getStatistics();
 *   const verdict = exp.evaluate('supported', 'All viability thresholds met');
 */

function createExperimentTracker(options) {
    options = options || {};

    var maxExperiments = options.maxExperiments || 500;
    var maxTrialsPerExperiment = options.maxTrials || 10000;

    // ── Constants ────────────────────────────────────────────────

    var STATES = Object.freeze({
        DRAFT:     'draft',
        RUNNING:   'running',
        COMPLETED: 'completed',
        FAILED:    'failed',
        CANCELLED: 'cancelled'
    });

    var VERDICTS = Object.freeze({
        SUPPORTED:    'supported',
        REFUTED:      'refuted',
        INCONCLUSIVE: 'inconclusive',
        PENDING:      'pending'
    });

    var VALID_STATES = Object.keys(STATES).map(function(k) { return STATES[k]; });
    var VALID_VERDICTS = Object.keys(VERDICTS).map(function(k) { return VERDICTS[k]; });

    var STATE_TRANSITIONS = Object.freeze({
        draft:     ['running', 'cancelled'],
        running:   ['completed', 'failed', 'cancelled'],
        completed: [],
        failed:    [],
        cancelled: []
    });

    // ── Internal state ──────────────────────────────────────────

    var experiments = {};
    var idCounter = 0;

    // ── Helpers ─────────────────────────────────────────────────

    function generateId() {
        idCounter += 1;
        return 'EXP-' + String(idCounter).padStart(4, '0');
    }

    function now() {
        return new Date().toISOString();
    }

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    /**
     * Validate variable definition array.
     * @param {Array} vars
     * @param {string} kind - 'independent' | 'dependent' | 'controlled'
     */
    function validateVariables(vars, kind) {
        if (!Array.isArray(vars)) {
            throw new Error(kind + ' variables must be an array');
        }
        var names = {};
        for (var i = 0; i < vars.length; i++) {
            var v = vars[i];
            if (!v || typeof v.name !== 'string' || !v.name.trim()) {
                throw new Error(kind + ' variable at index ' + i + ' must have a name');
            }
            var name = v.name.trim();
            if (names[name]) {
                throw new Error('Duplicate ' + kind + ' variable name: ' + name);
            }
            names[name] = true;

            if (kind === 'independent' && v.values !== undefined) {
                if (!Array.isArray(v.values) || v.values.length === 0) {
                    throw new Error('Independent variable "' + name + '" values must be a non-empty array');
                }
            }
            if (kind === 'controlled' && v.value === undefined) {
                throw new Error('Controlled variable "' + name + '" must have a value');
            }
        }
    }

    /**
     * Compute basic statistics for an array of numbers.
     * @param {number[]} values
     * @returns {{ count: number, mean: number, stdDev: number, min: number, max: number, cv: number }}
     */
    function computeStats(values) {
        if (!values || values.length === 0) {
            return { count: 0, mean: 0, stdDev: 0, min: 0, max: 0, cv: 0 };
        }
        var n = values.length;
        var sum = 0;
        var min = Infinity;
        var max = -Infinity;
        for (var i = 0; i < n; i++) {
            sum += values[i];
            if (values[i] < min) min = values[i];
            if (values[i] > max) max = values[i];
        }
        var mean = sum / n;

        var sumSqDiff = 0;
        for (var j = 0; j < n; j++) {
            var diff = values[j] - mean;
            sumSqDiff += diff * diff;
        }
        var stdDev = n > 1 ? Math.sqrt(sumSqDiff / (n - 1)) : 0;
        var cv = mean !== 0 ? (stdDev / Math.abs(mean)) * 100 : 0;

        return {
            count: n,
            mean: Math.round(mean * 10000) / 10000,
            stdDev: Math.round(stdDev * 10000) / 10000,
            min: min,
            max: max,
            cv: Math.round(cv * 100) / 100
        };
    }

    /**
     * Escape a value for CSV output.
     */
    function csvSafe(value) {
        if (value == null) return '';
        var str = String(value);
        var first = str.charAt(0);
        if (first === '=' || first === '+' || first === '-' ||
            first === '@' || first === '\t' || first === '\r') {
            str = "'" + str;
        }
        if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 ||
            str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1 ||
            str !== str.trim()) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    // ── Experiment object ───────────────────────────────────────

    /**
     * Create an experiment handle.
     * @param {Object} data - Stored experiment data
     * @returns {Object} Experiment API
     */
    function createExperimentHandle(data) {

        function assertMutable() {
            if (data.state === STATES.COMPLETED || data.state === STATES.FAILED ||
                data.state === STATES.CANCELLED) {
                throw new Error('Experiment ' + data.id + ' is ' + data.state + ' and cannot be modified');
            }
        }

        return {
            /** Experiment ID. */
            get id() { return data.id; },

            /** Current state. */
            get state() { return data.state; },

            /**
             * Transition to running state.
             */
            start: function() {
                if (data.state !== STATES.DRAFT) {
                    throw new Error('Can only start experiments in draft state (current: ' + data.state + ')');
                }
                data.state = STATES.RUNNING;
                data.startedAt = now();
                data.updatedAt = now();
                return this;
            },

            /**
             * Mark as completed.
             */
            complete: function() {
                if (data.state !== STATES.RUNNING) {
                    throw new Error('Can only complete experiments in running state (current: ' + data.state + ')');
                }
                data.state = STATES.COMPLETED;
                data.completedAt = now();
                data.updatedAt = now();
                return this;
            },

            /**
             * Mark as failed.
             * @param {string} [reason]
             */
            fail: function(reason) {
                if (data.state !== STATES.RUNNING) {
                    throw new Error('Can only fail experiments in running state (current: ' + data.state + ')');
                }
                data.state = STATES.FAILED;
                data.failedAt = now();
                data.failReason = reason || '';
                data.updatedAt = now();
                return this;
            },

            /**
             * Cancel the experiment.
             * @param {string} [reason]
             */
            cancel: function(reason) {
                if (data.state !== STATES.DRAFT && data.state !== STATES.RUNNING) {
                    throw new Error('Cannot cancel experiment in ' + data.state + ' state');
                }
                data.state = STATES.CANCELLED;
                data.cancelledAt = now();
                data.cancelReason = reason || '';
                data.updatedAt = now();
                return this;
            },

            /**
             * Add a trial (data point).
             * @param {Object} inputs  - Independent variable values { name: value }
             * @param {Object} outputs - Dependent variable values { name: value }
             * @param {Object} [meta]  - Optional metadata (notes, timestamp override)
             * @returns {{ trialNumber: number }}
             */
            addTrial: function(inputs, outputs, meta) {
                assertMutable();
                if (data.state === STATES.DRAFT) {
                    data.state = STATES.RUNNING;
                    data.startedAt = now();
                }

                if (!inputs || typeof inputs !== 'object') {
                    throw new Error('Trial inputs must be an object');
                }
                if (!outputs || typeof outputs !== 'object') {
                    throw new Error('Trial outputs must be an object');
                }

                // Validate input keys match independent variables
                var ivNames = {};
                for (var iv = 0; iv < data.variables.independent.length; iv++) {
                    ivNames[data.variables.independent[iv].name] = true;
                }
                var inputKeys = Object.keys(inputs);
                for (var ik = 0; ik < inputKeys.length; ik++) {
                    if (!ivNames[inputKeys[ik]]) {
                        throw new Error('Unknown independent variable: ' + inputKeys[ik]);
                    }
                }

                // Validate output keys match dependent variables
                var dvNames = {};
                for (var dv = 0; dv < data.variables.dependent.length; dv++) {
                    dvNames[data.variables.dependent[dv].name] = true;
                }
                var outputKeys = Object.keys(outputs);
                for (var ok = 0; ok < outputKeys.length; ok++) {
                    if (!dvNames[outputKeys[ok]]) {
                        throw new Error('Unknown dependent variable: ' + outputKeys[ok]);
                    }
                }

                if (data.trials.length >= maxTrialsPerExperiment) {
                    throw new Error('Maximum trials (' + maxTrialsPerExperiment + ') reached');
                }

                var trial = {
                    trialNumber: data.trials.length + 1,
                    timestamp: (meta && meta.timestamp) || now(),
                    inputs: deepClone(inputs),
                    outputs: deepClone(outputs),
                    notes: (meta && meta.notes) || ''
                };

                data.trials.push(trial);
                data.updatedAt = now();

                return { trialNumber: trial.trialNumber };
            },

            /**
             * Get all trials, optionally filtered.
             * @param {Object} [filter] - { inputMatch: { name: value }, limit: n }
             * @returns {Array}
             */
            getTrials: function(filter) {
                var result = deepClone(data.trials);

                if (filter && filter.inputMatch) {
                    var match = filter.inputMatch;
                    var matchKeys = Object.keys(match);
                    result = result.filter(function(t) {
                        for (var mk = 0; mk < matchKeys.length; mk++) {
                            if (t.inputs[matchKeys[mk]] !== match[matchKeys[mk]]) return false;
                        }
                        return true;
                    });
                }

                if (filter && typeof filter.limit === 'number') {
                    result = result.slice(0, filter.limit);
                }

                return result;
            },

            /**
             * Compute statistics per dependent variable, optionally grouped by
             * an independent variable.
             * @param {Object} [opts] - { groupBy: 'variable_name' }
             * @returns {Object}
             */
            getStatistics: function(opts) {
                opts = opts || {};
                var dvNames = data.variables.dependent.map(function(v) { return v.name; });

                if (opts.groupBy) {
                    // Grouped statistics
                    var groups = {};
                    for (var t = 0; t < data.trials.length; t++) {
                        var groupVal = String(data.trials[t].inputs[opts.groupBy]);
                        if (groupVal === 'undefined') groupVal = 'unknown';
                        if (!groups[groupVal]) groups[groupVal] = [];
                        groups[groupVal].push(data.trials[t]);
                    }

                    var result = {};
                    var groupKeys = Object.keys(groups);
                    for (var g = 0; g < groupKeys.length; g++) {
                        var gk = groupKeys[g];
                        result[gk] = {};
                        for (var d = 0; d < dvNames.length; d++) {
                            var vals = groups[gk]
                                .map(function(tr) { return tr.outputs[dvNames[d]]; })
                                .filter(function(v) { return typeof v === 'number'; });
                            result[gk][dvNames[d]] = computeStats(vals);
                        }
                    }
                    return result;
                }

                // Ungrouped statistics
                var stats = {};
                for (var di = 0; di < dvNames.length; di++) {
                    var values = data.trials
                        .map(function(tr) { return tr.outputs[dvNames[di]]; })
                        .filter(function(v) { return typeof v === 'number'; });
                    stats[dvNames[di]] = computeStats(values);
                }
                return stats;
            },

            /**
             * Evaluate the hypothesis.
             * @param {string} verdict - 'supported' | 'refuted' | 'inconclusive'
             * @param {string} reasoning - Explanation for the verdict
             * @returns {Object} The evaluation record
             */
            evaluate: function(verdict, reasoning) {
                if (VALID_VERDICTS.indexOf(verdict) === -1 || verdict === VERDICTS.PENDING) {
                    throw new Error('Verdict must be one of: supported, refuted, inconclusive');
                }
                if (!reasoning || typeof reasoning !== 'string' || !reasoning.trim()) {
                    throw new Error('Reasoning is required for evaluation');
                }

                data.hypothesis.verdict = verdict;
                data.hypothesis.reasoning = reasoning.trim();
                data.hypothesis.evaluatedAt = now();
                data.updatedAt = now();

                return {
                    verdict: verdict,
                    reasoning: reasoning.trim(),
                    evaluatedAt: data.hypothesis.evaluatedAt
                };
            },

            /**
             * Add a note to the experiment.
             * @param {string} text
             */
            addNote: function(text) {
                if (!text || typeof text !== 'string' || !text.trim()) {
                    throw new Error('Note text is required');
                }
                data.notes.push({
                    timestamp: now(),
                    text: text.trim()
                });
                data.updatedAt = now();
            },

            /**
             * Add tags to the experiment.
             * @param {string[]} tags
             */
            addTags: function(tags) {
                if (!Array.isArray(tags)) {
                    throw new Error('Tags must be an array');
                }
                for (var i = 0; i < tags.length; i++) {
                    var tag = String(tags[i]).trim().toLowerCase();
                    if (tag && data.tags.indexOf(tag) === -1) {
                        data.tags.push(tag);
                    }
                }
                data.updatedAt = now();
            },

            /**
             * Remove a tag.
             * @param {string} tag
             */
            removeTag: function(tag) {
                var normalized = String(tag).trim().toLowerCase();
                var idx = data.tags.indexOf(normalized);
                if (idx !== -1) {
                    data.tags.splice(idx, 1);
                    data.updatedAt = now();
                }
            },

            /**
             * Get the full experiment summary.
             * @returns {Object}
             */
            getSummary: function() {
                var trialCount = data.trials.length;
                var stats = this.getStatistics();
                return {
                    id: data.id,
                    title: data.title,
                    state: data.state,
                    hypothesis: deepClone(data.hypothesis),
                    variables: deepClone(data.variables),
                    trialCount: trialCount,
                    statistics: stats,
                    tags: data.tags.slice(),
                    notes: deepClone(data.notes),
                    createdAt: data.createdAt,
                    startedAt: data.startedAt,
                    completedAt: data.completedAt,
                    updatedAt: data.updatedAt
                };
            },

            /**
             * Export experiment data.
             * @param {string} format - 'json' | 'csv'
             * @returns {string}
             */
            export: function(format) {
                if (format === 'csv') {
                    return exportTrialsCsv(data);
                }
                // Default to JSON
                return JSON.stringify(deepClone(data), null, 2);
            }
        };
    }

    /**
     * Export trials as CSV.
     */
    function exportTrialsCsv(data) {
        var ivNames = data.variables.independent.map(function(v) { return v.name; });
        var dvNames = data.variables.dependent.map(function(v) { return v.name; });

        var headers = ['trial', 'timestamp'];
        headers = headers.concat(ivNames.map(function(n) { return 'input:' + n; }));
        headers = headers.concat(dvNames.map(function(n) { return 'output:' + n; }));
        headers.push('notes');

        var rows = [headers.map(csvSafe).join(',')];

        for (var i = 0; i < data.trials.length; i++) {
            var t = data.trials[i];
            var row = [t.trialNumber, t.timestamp];
            for (var iv = 0; iv < ivNames.length; iv++) {
                row.push(t.inputs[ivNames[iv]] !== undefined ? t.inputs[ivNames[iv]] : '');
            }
            for (var dv = 0; dv < dvNames.length; dv++) {
                row.push(t.outputs[dvNames[dv]] !== undefined ? t.outputs[dvNames[dv]] : '');
            }
            row.push(t.notes || '');
            rows.push(row.map(csvSafe).join(','));
        }

        return rows.join('\n');
    }

    // ── Tracker API ─────────────────────────────────────────────

    return {
        STATES: STATES,
        VERDICTS: VERDICTS,

        /**
         * Create a new experiment.
         * @param {Object} config
         * @param {string} config.title
         * @param {Object} config.hypothesis - { statement, prediction }
         * @param {Object} config.variables  - { independent, dependent, controlled }
         * @param {string[]} [config.tags]
         * @returns {Object} Experiment handle
         */
        create: function(config) {
            if (!config || typeof config.title !== 'string' || !config.title.trim()) {
                throw new Error('Experiment title is required');
            }

            if (!config.hypothesis || typeof config.hypothesis.statement !== 'string' ||
                !config.hypothesis.statement.trim()) {
                throw new Error('Hypothesis statement is required');
            }

            if (!config.variables) {
                throw new Error('Variables definition is required');
            }

            var vars = config.variables;
            validateVariables(vars.independent || [], 'independent');
            validateVariables(vars.dependent || [], 'dependent');
            validateVariables(vars.controlled || [], 'controlled');

            if ((!vars.independent || vars.independent.length === 0) &&
                (!vars.dependent || vars.dependent.length === 0)) {
                throw new Error('At least one independent or dependent variable is required');
            }

            if (Object.keys(experiments).length >= maxExperiments) {
                throw new Error('Maximum experiments (' + maxExperiments + ') reached');
            }

            var id = generateId();
            var data = {
                id: id,
                title: config.title.trim(),
                state: STATES.DRAFT,
                hypothesis: {
                    statement: config.hypothesis.statement.trim(),
                    prediction: (config.hypothesis.prediction || '').trim(),
                    verdict: VERDICTS.PENDING,
                    reasoning: '',
                    evaluatedAt: null
                },
                variables: {
                    independent: deepClone(vars.independent || []),
                    dependent: deepClone(vars.dependent || []),
                    controlled: deepClone(vars.controlled || [])
                },
                trials: [],
                notes: [],
                tags: [],
                createdAt: now(),
                startedAt: null,
                completedAt: null,
                updatedAt: now()
            };

            if (config.tags) {
                var handle = createExperimentHandle(data);
                handle.addTags(config.tags);
            }

            experiments[id] = data;
            return createExperimentHandle(data);
        },

        /**
         * Get an experiment by ID.
         * @param {string} id
         * @returns {Object|null}
         */
        get: function(id) {
            var data = experiments[id];
            if (!data) return null;
            return createExperimentHandle(data);
        },

        /**
         * Delete an experiment.
         * @param {string} id
         * @returns {boolean}
         */
        delete: function(id) {
            if (!experiments[id]) return false;
            delete experiments[id];
            return true;
        },

        /**
         * List all experiments with optional filtering.
         * @param {Object} [filter]
         * @param {string} [filter.state]
         * @param {string} [filter.tag]
         * @param {string} [filter.search]  - Title/hypothesis search
         * @param {string} [filter.verdict]
         * @param {string} [filter.sortBy]  - 'created' | 'updated' | 'title' | 'trials'
         * @param {boolean} [filter.descending]
         * @returns {Array}
         */
        list: function(filter) {
            filter = filter || {};
            var ids = Object.keys(experiments);
            var result = [];

            for (var i = 0; i < ids.length; i++) {
                var d = experiments[ids[i]];

                if (filter.state && d.state !== filter.state) continue;

                if (filter.tag) {
                    var searchTag = filter.tag.toLowerCase();
                    if (d.tags.indexOf(searchTag) === -1) continue;
                }

                if (filter.verdict && d.hypothesis.verdict !== filter.verdict) continue;

                if (filter.search) {
                    var q = filter.search.toLowerCase();
                    var inTitle = d.title.toLowerCase().indexOf(q) !== -1;
                    var inHypothesis = d.hypothesis.statement.toLowerCase().indexOf(q) !== -1;
                    if (!inTitle && !inHypothesis) continue;
                }

                result.push({
                    id: d.id,
                    title: d.title,
                    state: d.state,
                    verdict: d.hypothesis.verdict,
                    trialCount: d.trials.length,
                    tags: d.tags.slice(),
                    createdAt: d.createdAt,
                    updatedAt: d.updatedAt
                });
            }

            // Sort
            var sortBy = filter.sortBy || 'created';
            result.sort(function(a, b) {
                var va, vb;
                if (sortBy === 'title') {
                    va = a.title.toLowerCase();
                    vb = b.title.toLowerCase();
                    return va < vb ? -1 : va > vb ? 1 : 0;
                }
                if (sortBy === 'trials') {
                    va = a.trialCount;
                    vb = b.trialCount;
                } else if (sortBy === 'updated') {
                    va = a.updatedAt;
                    vb = b.updatedAt;
                } else {
                    va = a.createdAt;
                    vb = b.createdAt;
                }
                return va < vb ? -1 : va > vb ? 1 : 0;
            });

            if (filter.descending) result.reverse();

            return result;
        },

        /**
         * Compare experiments on shared dependent variables.
         * @param {string[]} ids - Experiment IDs to compare
         * @returns {Object} Comparison report
         */
        compare: function(ids) {
            if (!Array.isArray(ids) || ids.length < 2) {
                throw new Error('At least 2 experiment IDs are required for comparison');
            }

            var exps = [];
            for (var i = 0; i < ids.length; i++) {
                var d = experiments[ids[i]];
                if (!d) throw new Error('Experiment not found: ' + ids[i]);
                exps.push(d);
            }

            // Find shared dependent variables
            var allDvSets = exps.map(function(e) {
                var names = {};
                e.variables.dependent.forEach(function(v) { names[v.name] = true; });
                return names;
            });

            var sharedDvs = [];
            var firstDvs = Object.keys(allDvSets[0]);
            for (var s = 0; s < firstDvs.length; s++) {
                var dvName = firstDvs[s];
                var shared = true;
                for (var j = 1; j < allDvSets.length; j++) {
                    if (!allDvSets[j][dvName]) { shared = false; break; }
                }
                if (shared) sharedDvs.push(dvName);
            }

            // Compute per-experiment stats for shared DVs
            var comparison = {
                experimentCount: exps.length,
                sharedVariables: sharedDvs,
                experiments: []
            };

            for (var e = 0; e < exps.length; e++) {
                var exp = exps[e];
                var handle = createExperimentHandle(exp);
                var stats = handle.getStatistics();

                var expEntry = {
                    id: exp.id,
                    title: exp.title,
                    trialCount: exp.trials.length,
                    verdict: exp.hypothesis.verdict,
                    stats: {}
                };

                for (var sv = 0; sv < sharedDvs.length; sv++) {
                    expEntry.stats[sharedDvs[sv]] = stats[sharedDvs[sv]] || computeStats([]);
                }

                comparison.experiments.push(expEntry);
            }

            // Rank experiments per shared DV (by mean, descending)
            comparison.rankings = {};
            for (var rv = 0; rv < sharedDvs.length; rv++) {
                var vName = sharedDvs[rv];
                var ranked = comparison.experiments.slice().sort(function(a, b) {
                    return (b.stats[vName] ? b.stats[vName].mean : 0) -
                           (a.stats[vName] ? a.stats[vName].mean : 0);
                });
                comparison.rankings[vName] = ranked.map(function(r) {
                    return { id: r.id, title: r.title, mean: r.stats[vName].mean };
                });
            }

            return comparison;
        },

        /**
         * Export all experiments as JSON.
         * @returns {string}
         */
        exportAll: function() {
            return JSON.stringify({
                format: 'biobots-experiments',
                version: 1,
                exportedAt: now(),
                experiments: deepClone(experiments)
            }, null, 2);
        },

        /**
         * Import experiments from JSON.
         * @param {string} json
         * @returns {{ imported: number, skipped: number }}
         */
        importAll: function(json) {
            var parsed;
            try {
                parsed = JSON.parse(json);
            } catch (e) {
                throw new Error('Invalid JSON: ' + e.message);
            }

            if (!parsed || parsed.format !== 'biobots-experiments' || !parsed.experiments) {
                throw new Error('Invalid export format');
            }

            var imported = 0;
            var skipped = 0;
            var ids = Object.keys(parsed.experiments);

            for (var i = 0; i < ids.length; i++) {
                var id = ids[i];
                if (experiments[id]) {
                    skipped++;
                    continue;
                }
                var d = parsed.experiments[id];
                // Basic validation
                if (!d.id || !d.title || !d.hypothesis || !d.variables) {
                    skipped++;
                    continue;
                }
                experiments[id] = deepClone(d);
                imported++;
                // Update counter to avoid ID collision
                var num = parseInt(id.replace('EXP-', ''), 10);
                if (!isNaN(num) && num >= idCounter) {
                    idCounter = num;
                }
            }

            return { imported: imported, skipped: skipped };
        },

        /**
         * Get counts by state.
         * @returns {Object}
         */
        getCounts: function() {
            var counts = {};
            VALID_STATES.forEach(function(s) { counts[s] = 0; });
            var ids = Object.keys(experiments);
            for (var i = 0; i < ids.length; i++) {
                counts[experiments[ids[i]].state]++;
            }
            counts.total = ids.length;
            return counts;
        },

        /**
         * Clear all experiments.
         */
        clear: function() {
            experiments = {};
            idCounter = 0;
        }
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createExperimentTracker };
}
