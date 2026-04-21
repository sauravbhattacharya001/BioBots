'use strict';

/**
 * Lab Notebook Entry Generator — creates structured, formatted lab notebook
 * entries from experimental parameters.  Supports multiple output formats
 * (plain text, Markdown, HTML) and auto-generates fields like timestamps,
 * entry IDs, and checklists.
 *
 * @example
 *   var gen = createLabNotebookGenerator();
 *   var entry = gen.generate({
 *     title: 'Alginate bioink printing trial #4',
 *     researcher: 'Dr. Chen',
 *     objective: 'Test 3% alginate at 25°C nozzle temp',
 *     materials: [
 *       { name: 'Sodium alginate', lot: 'SA-2026-041', quantity: '3 g' },
 *       { name: 'CaCl2', lot: 'CC-2026-008', quantity: '100 mM, 50 mL' }
 *     ],
 *     protocol: [
 *       'Dissolve alginate in sterile PBS at 37°C for 2 h',
 *       'Load bioink into cartridge',
 *       'Print 10x10 mm grid at 5 mm/s'
 *     ],
 *     observations: 'Filament consistency improved vs trial #3',
 *     results: { viability: '92%', resolution: '210 µm' },
 *     notes: 'Consider increasing CaCl2 to 150 mM next trial',
 *     tags: ['bioink', 'alginate', 'printing']
 *   });
 *   console.log(entry.markdown);
 */

var _sanitize = require('./sanitize');
var _isDangerousKey = _sanitize.isDangerousKey;

// ── helpers ────────────────────────────────────────────────────────

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function isoNow() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function generateEntryId() {
    var ts = Date.now().toString(36).toUpperCase();
    var rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return 'LNB-' + ts + '-' + rand;
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── formatters ─────────────────────────────────────────────────────

function formatPlainText(entry) {
    var lines = [];
    lines.push('═══════════════════════════════════════════════════');
    lines.push('LAB NOTEBOOK ENTRY: ' + entry.id);
    lines.push('═══════════════════════════════════════════════════');
    lines.push('Title:      ' + entry.title);
    lines.push('Date:       ' + entry.timestamp);
    lines.push('Researcher: ' + entry.researcher);
    if (entry.project) lines.push('Project:    ' + entry.project);
    lines.push('');

    if (entry.objective) {
        lines.push('OBJECTIVE');
        lines.push('─────────');
        lines.push(entry.objective);
        lines.push('');
    }

    if (entry.materials && entry.materials.length) {
        lines.push('MATERIALS');
        lines.push('─────────');
        entry.materials.forEach(function (m, i) {
            var line = (i + 1) + '. ' + m.name;
            if (m.lot) line += '  (Lot: ' + m.lot + ')';
            if (m.quantity) line += '  — ' + m.quantity;
            if (m.expiry) line += '  [Exp: ' + m.expiry + ']';
            lines.push(line);
        });
        lines.push('');
    }

    if (entry.protocol && entry.protocol.length) {
        lines.push('PROTOCOL');
        lines.push('────────');
        entry.protocol.forEach(function (step, i) {
            lines.push((i + 1) + '. ' + step);
        });
        lines.push('');
    }

    if (entry.observations) {
        lines.push('OBSERVATIONS');
        lines.push('────────────');
        lines.push(entry.observations);
        lines.push('');
    }

    if (entry.results) {
        lines.push('RESULTS');
        lines.push('───────');
        Object.keys(entry.results).forEach(function (k) {
            if (_isDangerousKey(k)) return;
            lines.push('  ' + k + ': ' + entry.results[k]);
        });
        lines.push('');
    }

    if (entry.notes) {
        lines.push('NOTES');
        lines.push('─────');
        lines.push(entry.notes);
        lines.push('');
    }

    if (entry.tags && entry.tags.length) {
        lines.push('Tags: ' + entry.tags.join(', '));
    }

    lines.push('═══════════════════════════════════════════════════');
    return lines.join('\n');
}

function formatMarkdown(entry) {
    var lines = [];
    lines.push('# ' + entry.title);
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    lines.push('| **Entry ID** | `' + entry.id + '` |');
    lines.push('| **Date** | ' + entry.timestamp + ' |');
    lines.push('| **Researcher** | ' + entry.researcher + ' |');
    if (entry.project) lines.push('| **Project** | ' + entry.project + ' |');
    lines.push('');

    if (entry.objective) {
        lines.push('## Objective');
        lines.push(entry.objective);
        lines.push('');
    }

    if (entry.materials && entry.materials.length) {
        lines.push('## Materials');
        lines.push('| # | Name | Lot | Quantity | Expiry |');
        lines.push('|---|------|-----|----------|--------|');
        entry.materials.forEach(function (m, i) {
            lines.push('| ' + (i + 1) + ' | ' + m.name + ' | ' +
                (m.lot || '—') + ' | ' + (m.quantity || '—') + ' | ' +
                (m.expiry || '—') + ' |');
        });
        lines.push('');
    }

    if (entry.protocol && entry.protocol.length) {
        lines.push('## Protocol');
        entry.protocol.forEach(function (step, i) {
            lines.push((i + 1) + '. ' + step);
        });
        lines.push('');
    }

    if (entry.observations) {
        lines.push('## Observations');
        lines.push(entry.observations);
        lines.push('');
    }

    if (entry.results) {
        lines.push('## Results');
        lines.push('| Metric | Value |');
        lines.push('|--------|-------|');
        Object.keys(entry.results).forEach(function (k) {
            if (_isDangerousKey(k)) return;
            lines.push('| ' + k + ' | ' + entry.results[k] + ' |');
        });
        lines.push('');
    }

    if (entry.notes) {
        lines.push('## Notes');
        lines.push(entry.notes);
        lines.push('');
    }

    if (entry.tags && entry.tags.length) {
        lines.push('---');
        lines.push('**Tags:** ' + entry.tags.map(function (t) { return '`' + t + '`'; }).join(' '));
    }

    return lines.join('\n');
}

function formatHtml(entry) {
    var h = [];
    h.push('<!DOCTYPE html><html><head><meta charset="utf-8">');
    h.push('<title>' + escapeHtml(entry.title) + '</title>');
    h.push('<style>');
    h.push('body{font-family:Georgia,serif;max-width:800px;margin:2em auto;padding:0 1em;color:#222}');
    h.push('h1{border-bottom:2px solid #333}h2{color:#444;margin-top:1.5em}');
    h.push('table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}');
    h.push('th{background:#f5f5f5}.meta{color:#666;font-size:0.9em}.tag{background:#e0e7ff;padding:2px 8px;border-radius:3px;margin-right:4px;font-size:0.85em}');
    h.push('</style></head><body>');
    h.push('<h1>' + escapeHtml(entry.title) + '</h1>');
    h.push('<p class="meta"><strong>ID:</strong> ' + entry.id +
        ' &nbsp;|&nbsp; <strong>Date:</strong> ' + entry.timestamp +
        ' &nbsp;|&nbsp; <strong>Researcher:</strong> ' + escapeHtml(entry.researcher) + '</p>');

    if (entry.objective) {
        h.push('<h2>Objective</h2><p>' + escapeHtml(entry.objective) + '</p>');
    }

    if (entry.materials && entry.materials.length) {
        h.push('<h2>Materials</h2><table><tr><th>#</th><th>Name</th><th>Lot</th><th>Quantity</th><th>Expiry</th></tr>');
        entry.materials.forEach(function (m, i) {
            h.push('<tr><td>' + (i + 1) + '</td><td>' + escapeHtml(m.name) +
                '</td><td>' + escapeHtml(m.lot || '—') +
                '</td><td>' + escapeHtml(m.quantity || '—') +
                '</td><td>' + escapeHtml(m.expiry || '—') + '</td></tr>');
        });
        h.push('</table>');
    }

    if (entry.protocol && entry.protocol.length) {
        h.push('<h2>Protocol</h2><ol>');
        entry.protocol.forEach(function (step) {
            h.push('<li>' + escapeHtml(step) + '</li>');
        });
        h.push('</ol>');
    }

    if (entry.observations) {
        h.push('<h2>Observations</h2><p>' + escapeHtml(entry.observations) + '</p>');
    }

    if (entry.results) {
        h.push('<h2>Results</h2><table><tr><th>Metric</th><th>Value</th></tr>');
        Object.keys(entry.results).forEach(function (k) {
            if (_isDangerousKey(k)) return;
            h.push('<tr><td>' + escapeHtml(k) + '</td><td>' + escapeHtml(entry.results[k]) + '</td></tr>');
        });
        h.push('</table>');
    }

    if (entry.notes) {
        h.push('<h2>Notes</h2><p>' + escapeHtml(entry.notes) + '</p>');
    }

    if (entry.tags && entry.tags.length) {
        h.push('<p>');
        entry.tags.forEach(function (t) {
            h.push('<span class="tag">' + escapeHtml(t) + '</span>');
        });
        h.push('</p>');
    }

    h.push('</body></html>');
    return h.join('\n');
}

// ── checklist generator ────────────────────────────────────────────

function generateChecklist(entry) {
    var items = [];
    items.push({ task: 'Verify all materials and lot numbers', done: false });
    if (entry.materials) {
        entry.materials.forEach(function (m) {
            if (m.expiry) items.push({ task: 'Check expiry for ' + m.name + ' (' + m.expiry + ')', done: false });
        });
    }
    items.push({ task: 'Review protocol steps before starting', done: false });
    items.push({ task: 'Record observations during experiment', done: false });
    items.push({ task: 'Enter results and measurements', done: false });
    items.push({ task: 'Sign and date notebook entry', done: false });
    items.push({ task: 'Have witness countersign (if GLP)', done: false });
    return items;
}

// ── factory ────────────────────────────────────────────────────────

function createLabNotebookGenerator(opts) {
    opts = opts || {};
    var defaultResearcher = opts.defaultResearcher || 'Unknown';
    var defaultProject = opts.defaultProject || null;
    var entries = [];

    return {
        /**
         * Generate a lab notebook entry.
         * @param {Object} params - Entry parameters.
         * @param {string} params.title - Experiment title (required).
         * @param {string} [params.researcher] - Researcher name.
         * @param {string} [params.project] - Project name.
         * @param {string} [params.objective] - Experiment objective.
         * @param {Array<{name:string,lot?:string,quantity?:string,expiry?:string}>} [params.materials] - Materials list.
         * @param {string[]} [params.protocol] - Ordered protocol steps.
         * @param {string} [params.observations] - Free-text observations.
         * @param {Object} [params.results] - Key-value result metrics.
         * @param {string} [params.notes] - Additional notes.
         * @param {string[]} [params.tags] - Categorization tags.
         * @returns {{ id:string, entry:Object, plainText:string, markdown:string, html:string, checklist:Array }}
         */
        generate: function generate(params) {
            if (!params || !params.title) {
                throw new Error('Lab notebook entry requires at least a title');
            }

            var entry = {
                id: generateEntryId(),
                timestamp: params.timestamp || isoNow(),
                title: params.title,
                researcher: params.researcher || defaultResearcher,
                project: params.project || defaultProject,
                objective: params.objective || null,
                materials: params.materials || [],
                protocol: params.protocol || [],
                observations: params.observations || null,
                results: params.results ? _sanitize.stripDangerousKeys(params.results) : null,
                notes: params.notes || null,
                tags: params.tags || []
            };

            var result = {
                id: entry.id,
                entry: entry,
                plainText: formatPlainText(entry),
                markdown: formatMarkdown(entry),
                html: formatHtml(entry),
                checklist: generateChecklist(entry)
            };

            entries.push(result);
            return result;
        },

        /**
         * List all generated entries.
         * @returns {Array} All entries generated in this session.
         */
        listEntries: function listEntries() {
            return entries.map(function (e) {
                return { id: e.id, title: e.entry.title, timestamp: e.entry.timestamp };
            });
        },

        /**
         * Get entry count.
         * @returns {number}
         */
        entryCount: function entryCount() {
            return entries.length;
        },

        /**
         * Generate a blank template with placeholder text.
         * @param {string} [title] - Optional title.
         * @returns {Object} Template entry object (not stored).
         */
        template: function template(title) {
            return {
                title: title || '[Experiment Title]',
                researcher: defaultResearcher,
                project: defaultProject,
                objective: '[State the objective]',
                materials: [
                    { name: '[Material 1]', lot: '[Lot #]', quantity: '[Amount]' }
                ],
                protocol: ['[Step 1]', '[Step 2]', '[Step 3]'],
                observations: '[Record observations here]',
                results: { '[Metric]': '[Value]' },
                notes: '[Additional notes]',
                tags: []
            };
        }
    };
}

module.exports = { createLabNotebookGenerator: createLabNotebookGenerator };
