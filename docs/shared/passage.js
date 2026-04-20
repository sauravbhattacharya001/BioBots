'use strict';

var round = require('./validation').round;
var _isDangerousKey = require('./sanitize').isDangerousKey;

/**
 * Cell Passage Tracker — tracks cell line passages for bioprinting workflows.
 *
 * Monitors passage history, viability trends, confluence levels, optimal passage
 * windows, and alerts for senescence risk. Essential for maintaining cell quality
 * in bioink preparation.
 *
 * @example
 *   var tracker = createPassageTracker();
 *   tracker.addCellLine({ id: 'HEK293', name: 'HEK-293T', maxPassage: 30 });
 *   tracker.recordPassage('HEK293', { passage: 5, viability: 95, confluence: 85 });
 *   var report = tracker.getCellLineReport('HEK293');
 */

function createPassageTracker() {
    var cellLines = {};
    var passages = {};
    var alerts = [];

    // --- Cell Line Management ---

    function addCellLine(opts) {
        if (!opts || !opts.id) throw new Error('Cell line id is required');
        if (_isDangerousKey(opts.id)) throw new Error('Invalid cell line id');
        if (cellLines[opts.id]) throw new Error('Cell line already exists: ' + opts.id);
        cellLines[opts.id] = {
            id: opts.id,
            name: opts.name || opts.id,
            species: opts.species || 'unknown',
            tissue: opts.tissue || 'unknown',
            maxPassage: opts.maxPassage || 50,
            optimalConfluence: opts.optimalConfluence || { min: 70, max: 90 },
            doublingTime: opts.doublingTime || null, // hours
            medium: opts.medium || 'unknown',
            createdAt: opts.createdAt || new Date().toISOString(),
            notes: opts.notes || ''
        };
        passages[opts.id] = [];
        return cellLines[opts.id];
    }

    function getCellLine(id) {
        if (!cellLines[id]) throw new Error('Cell line not found: ' + id);
        return Object.assign({}, cellLines[id]);
    }

    function listCellLines() {
        return Object.keys(cellLines).map(function (id) {
            var cl = cellLines[id];
            var ps = passages[id] || [];
            var latest = ps.length > 0 ? ps[ps.length - 1] : null;
            return {
                id: cl.id,
                name: cl.name,
                species: cl.species,
                totalPassages: ps.length,
                currentPassage: latest ? latest.passage : 0,
                latestViability: latest ? latest.viability : null,
                status: getCellLineStatus(id)
            };
        });
    }

    function removeCellLine(id) {
        if (!cellLines[id]) throw new Error('Cell line not found: ' + id);
        delete cellLines[id];
        delete passages[id];
        return true;
    }

    // --- Passage Recording ---

    function recordPassage(cellLineId, data) {
        if (!cellLines[cellLineId]) throw new Error('Cell line not found: ' + cellLineId);
        if (!data || typeof data.passage !== 'number') throw new Error('Passage number is required');
        if (data.passage < 1) throw new Error('Passage must be >= 1');
        if (data.viability !== undefined && (data.viability < 0 || data.viability > 100))
            throw new Error('Viability must be 0-100');
        if (data.confluence !== undefined && (data.confluence < 0 || data.confluence > 100))
            throw new Error('Confluence must be 0-100');

        var record = {
            passage: data.passage,
            viability: data.viability !== undefined ? data.viability : null,
            confluence: data.confluence !== undefined ? data.confluence : null,
            cellCount: data.cellCount || null,
            splitRatio: data.splitRatio || null,
            date: data.date || new Date().toISOString(),
            operator: data.operator || 'unknown',
            medium: data.medium || cellLines[cellLineId].medium,
            notes: data.notes || ''
        };

        passages[cellLineId].push(record);
        passages[cellLineId].sort(function (a, b) { return a.passage - b.passage; });

        // Check for alerts
        var newAlerts = checkAlerts(cellLineId, record);
        alerts = alerts.concat(newAlerts);

        return { record: record, alerts: newAlerts };
    }

    function getPassageHistory(cellLineId, opts) {
        if (!cellLines[cellLineId]) throw new Error('Cell line not found: ' + cellLineId);
        var ps = passages[cellLineId].slice();
        if (opts && opts.fromPassage) ps = ps.filter(function (p) { return p.passage >= opts.fromPassage; });
        if (opts && opts.toPassage) ps = ps.filter(function (p) { return p.passage <= opts.toPassage; });
        if (opts && opts.limit) ps = ps.slice(-opts.limit);
        return ps;
    }

    // --- Analysis ---

    function getViabilityTrend(cellLineId) {
        if (!cellLines[cellLineId]) throw new Error('Cell line not found: ' + cellLineId);
        var ps = passages[cellLineId].filter(function (p) { return p.viability !== null; });
        if (ps.length < 2) return { trend: 'insufficient_data', points: ps.length, slope: 0 };

        // Simple linear regression
        var n = ps.length;
        var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        ps.forEach(function (p) {
            sumX += p.passage;
            sumY += p.viability;
            sumXY += p.passage * p.viability;
            sumXX += p.passage * p.passage;
        });
        var denominator = n * sumXX - sumX * sumX;
        if (denominator === 0) {
            return {
                trend: 'insufficient_data',
                points: n,
                slope: 0,
                intercept: 0,
                currentViability: ps[ps.length - 1].viability,
                projectedLimitPassage: null,
                reason: 'all_same_passage',
                recommendation: 'Record passages at different passage numbers for trend analysis'
            };
        }
        var slope = (n * sumXY - sumX * sumY) / denominator;
        var intercept = (sumY - slope * sumX) / n;

        var trend = 'stable';
        if (slope < -0.5) trend = 'declining';
        if (slope < -1.5) trend = 'critical_decline';
        if (slope > 0.5) trend = 'improving';

        // Projected passage where viability hits 70%
        var viabilityThreshold = 70;
        var projectedLimit = null;
        if (slope < 0) {
            projectedLimit = Math.round((viabilityThreshold - intercept) / slope);
        }

        return {
            trend: trend,
            slope: round(slope),
            intercept: round(intercept),
            points: n,
            currentViability: ps[ps.length - 1].viability,
            projectedLimitPassage: projectedLimit,
            recommendation: getViabilityRecommendation(trend, ps[ps.length - 1].viability)
        };
    }

    function getConfluenceProfile(cellLineId) {
        if (!cellLines[cellLineId]) throw new Error('Cell line not found: ' + cellLineId);
        var ps = passages[cellLineId].filter(function (p) { return p.confluence !== null; });
        if (ps.length === 0) return { profile: 'no_data', points: 0 };

        var cl = cellLines[cellLineId];
        var optimal = cl.optimalConfluence;
        // Single pass: accumulate confluence sum alongside range
        // classification, eliminating the redundant .reduce() traversal.
        var inRange = 0, overConfluent = 0, underConfluent = 0, sumConf = 0;

        for (var ci = 0; ci < ps.length; ci++) {
            var conf = ps[ci].confluence;
            sumConf += conf;
            if (conf >= optimal.min && conf <= optimal.max) inRange++;
            else if (conf > optimal.max) overConfluent++;
            else underConfluent++;
        }

        var avg = sumConf / ps.length;

        return {
            profile: inRange / ps.length >= 0.7 ? 'well_managed' : 'needs_attention',
            points: ps.length,
            averageConfluence: round(avg, 1),
            optimalRange: optimal,
            inRangePercent: round(inRange / ps.length * 100, 0),
            overConfluentCount: overConfluent,
            underConfluentCount: underConfluent,
            lastConfluence: ps[ps.length - 1].confluence
        };
    }

    function getOptimalPassageWindow(cellLineId) {
        if (!cellLines[cellLineId]) throw new Error('Cell line not found: ' + cellLineId);
        var cl = cellLines[cellLineId];
        var ps = passages[cellLineId].filter(function (p) {
            return p.viability !== null;
        });

        if (ps.length < 3) return { window: null, reason: 'insufficient_data' };

        // Find passage range where viability stays above 85%
        var highViability = ps.filter(function (p) { return p.viability >= 85; });
        if (highViability.length === 0) return { window: null, reason: 'no_high_viability_passages' };

        // Find the longest contiguous run of high-viability passages.
        // The old approach took first-to-last which could span gaps
        // containing low-viability passages.
        var bestStart = highViability[0].passage;
        var bestEnd = highViability[0].passage;
        var curStart = highViability[0].passage;
        var curEnd = highViability[0].passage;
        for (var hi = 1; hi < highViability.length; hi++) {
            if (highViability[hi].passage === highViability[hi - 1].passage + 1) {
                curEnd = highViability[hi].passage;
            } else {
                if (curEnd - curStart > bestEnd - bestStart) {
                    bestStart = curStart;
                    bestEnd = curEnd;
                }
                curStart = highViability[hi].passage;
                curEnd = highViability[hi].passage;
            }
        }
        if (curEnd - curStart > bestEnd - bestStart) {
            bestStart = curStart;
            bestEnd = curEnd;
        }

        // Also consider max passage limit
        var safeMax = Math.min(bestEnd, Math.floor(cl.maxPassage * 0.8));
        // Ensure window is not inverted (safeMax < bestStart)
        if (safeMax < bestStart) {
            return { window: null, reason: 'safe_limit_below_viable_range' };
        }

        return {
            window: { from: bestStart, to: safeMax },
            maxPassageLimit: cl.maxPassage,
            senescenceBuffer: cl.maxPassage - safeMax,
            highViabilityPassages: highViability.length,
            recommendation: 'Use cells between passages ' + bestStart + '-' + safeMax + ' for best results'
        };
    }

    /**
     * Assess senescence risk for a cell line.
     *
     * @param {string} cellLineId - Cell line identifier
     * @param {Object} [precomputedTrend] - Optional pre-computed viability
     *   trend (from getViabilityTrend) to avoid redundant recomputation
     *   when the caller already has it.
     * @returns {Object} Risk assessment with action recommendation
     */
    function getSenescenceRisk(cellLineId, precomputedTrend) {
        if (!cellLines[cellLineId]) throw new Error('Cell line not found: ' + cellLineId);
        var cl = cellLines[cellLineId];
        var ps = passages[cellLineId];
        if (ps.length === 0) return { risk: 'unknown', currentPassage: 0, maxPassage: cl.maxPassage };

        var current = ps[ps.length - 1].passage;
        var ratio = current / cl.maxPassage;
        var risk = 'low';
        if (ratio > 0.9) risk = 'critical';
        else if (ratio > 0.75) risk = 'high';
        else if (ratio > 0.5) risk = 'moderate';

        var viabilityTrend = precomputedTrend || getViabilityTrend(cellLineId);

        return {
            risk: risk,
            currentPassage: current,
            maxPassage: cl.maxPassage,
            passageRatio: round(ratio * 100, 0),
            remainingPassages: cl.maxPassage - current,
            viabilityTrend: viabilityTrend.trend,
            action: getSenescenceAction(risk, viabilityTrend.trend)
        };
    }

    // --- Reporting ---

    function getCellLineReport(cellLineId) {
        if (!cellLines[cellLineId]) throw new Error('Cell line not found: ' + cellLineId);
        // Compute viability trend once and share with getSenescenceRisk
        // to avoid the redundant linear regression (was computed twice).
        var viabilityTrend = getViabilityTrend(cellLineId);
        return {
            cellLine: getCellLine(cellLineId),
            passageCount: passages[cellLineId].length,
            viabilityTrend: viabilityTrend,
            confluenceProfile: getConfluenceProfile(cellLineId),
            optimalWindow: getOptimalPassageWindow(cellLineId),
            senescenceRisk: getSenescenceRisk(cellLineId, viabilityTrend),
            recentPassages: getPassageHistory(cellLineId, { limit: 5 }),
            alerts: alerts.filter(function (a) { return a.cellLineId === cellLineId; })
        };
    }

    function getFleetReport() {
        var ids = Object.keys(cellLines);
        if (ids.length === 0) return { cellLines: 0, summary: 'No cell lines registered' };

        var riskCounts = { low: 0, moderate: 0, high: 0, critical: 0, unknown: 0 };
        // Pre-compute viability trends once per cell line and share with
        // getSenescenceRisk, avoiding redundant linear regressions.
        // Also inline getCellLineStatus to reuse passages[id] lookup
        // instead of re-fetching it in a separate function call.
        var reports = new Array(ids.length);
        for (var ri = 0; ri < ids.length; ri++) {
            var id = ids[ri];
            var trend = getViabilityTrend(id);
            var risk = getSenescenceRisk(id, trend);
            riskCounts[risk.risk]++;
            reports[ri] = {
                id: id,
                name: cellLines[id].name,
                currentPassage: risk.currentPassage,
                maxPassage: risk.maxPassage,
                risk: risk.risk,
                status: getCellLineStatus(id)
            };
        }

        return {
            cellLines: ids.length,
            riskDistribution: riskCounts,
            needsAttention: reports.filter(function (r) {
                return r.risk === 'high' || r.risk === 'critical';
            }),
            allLines: reports,
            pendingAlerts: alerts.filter(function (a) { return !a.acknowledged; }).length
        };
    }

    // --- Export ---

    function exportPassageData(cellLineId, format) {
        if (!cellLines[cellLineId]) throw new Error('Cell line not found: ' + cellLineId);
        var ps = passages[cellLineId];
        format = format || 'json';

        if (format === 'json') {
            return JSON.stringify({
                cellLine: cellLines[cellLineId],
                passages: ps,
                exportedAt: new Date().toISOString()
            }, null, 2);
        }

        if (format === 'csv') {
            var header = 'passage,viability,confluence,cellCount,splitRatio,date,operator,medium,notes';
            var rows = ps.map(function (p) {
                return [
                    p.passage, p.viability, p.confluence, p.cellCount,
                    p.splitRatio, escapeCSVField(p.date), escapeCSVField(p.operator),
                    escapeCSVField(p.medium), escapeCSVField(p.notes)
                ].join(',');
            });
            return header + '\n' + rows.join('\n');
        }

        throw new Error('Unsupported format: ' + format + '. Use json or csv.');
    }

    // --- Alerts ---

    function getAlerts(opts) {
        // Single-pass filter instead of up to 3 sequential .filter()
        // calls that each copy the array. For 1000 alerts with all 3
        // filters active, this reduces from ~3000 to ~1000 iterations
        // and avoids 2 intermediate array allocations.
        if (!opts) return alerts.slice();
        var wantCellLine = opts.cellLineId || null;
        var wantUnack = !!opts.unacknowledged;
        var wantSeverity = opts.severity || null;
        if (!wantCellLine && !wantUnack && !wantSeverity) return alerts.slice();
        var result = [];
        for (var i = 0; i < alerts.length; i++) {
            var a = alerts[i];
            if (wantCellLine && a.cellLineId !== wantCellLine) continue;
            if (wantUnack && a.acknowledged) continue;
            if (wantSeverity && a.severity !== wantSeverity) continue;
            result.push(a);
        }
        return result;
    }

    function acknowledgeAlert(index) {
        if (index < 0 || index >= alerts.length) throw new Error('Invalid alert index');
        alerts[index].acknowledged = true;
        alerts[index].acknowledgedAt = new Date().toISOString();
        return alerts[index];
    }

    // --- Internal Helpers ---

    /**
     * Escape a value for safe CSV inclusion.
     * Defends against CSV formula injection (OWASP) and handles
     * commas, quotes, and newlines per RFC 4180.
     */
    function escapeCSVField(value) {
        if (value == null) return '';
        var str = String(value);

        // CSV formula injection defense (OWASP): prefix dangerous
        // leading characters with a single-quote to force text mode.
        var firstChar = str.charAt(0);
        if (firstChar === '=' || firstChar === '+' || firstChar === '-' ||
            firstChar === '@' || firstChar === '\t' || firstChar === '\r') {
            str = "'" + str;
        }

        // Quote if contains comma, double-quote, newline, or
        // leading/trailing whitespace
        if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 ||
            str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1 ||
            str !== str.trim()) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    function getCellLineStatus(id) {
        var ps = passages[id] || [];
        if (ps.length === 0) return 'new';
        var cl = cellLines[id];
        var current = ps[ps.length - 1].passage;
        if (current >= cl.maxPassage) return 'exhausted';
        if (current >= cl.maxPassage * 0.9) return 'near_limit';
        var latestViability = ps[ps.length - 1].viability;
        if (latestViability !== null && latestViability < 70) return 'low_viability';
        return 'active';
    }

    function checkAlerts(cellLineId, record) {
        var cl = cellLines[cellLineId];
        var newAlerts = [];

        // High passage alert
        if (record.passage >= cl.maxPassage * 0.8) {
            newAlerts.push({
                cellLineId: cellLineId,
                type: 'high_passage',
                severity: record.passage >= cl.maxPassage * 0.9 ? 'critical' : 'warning',
                message: cl.name + ' at passage ' + record.passage + '/' + cl.maxPassage,
                date: record.date,
                acknowledged: false
            });
        }

        // Low viability alert
        if (record.viability !== null && record.viability < 80) {
            newAlerts.push({
                cellLineId: cellLineId,
                type: 'low_viability',
                severity: record.viability < 70 ? 'critical' : 'warning',
                message: cl.name + ' viability dropped to ' + record.viability + '%',
                date: record.date,
                acknowledged: false
            });
        }

        // Over-confluence alert
        if (record.confluence !== null && record.confluence > cl.optimalConfluence.max) {
            newAlerts.push({
                cellLineId: cellLineId,
                type: 'over_confluence',
                severity: record.confluence > 95 ? 'critical' : 'warning',
                message: cl.name + ' confluence at ' + record.confluence + '% (optimal: ' + cl.optimalConfluence.min + '-' + cl.optimalConfluence.max + '%)',
                date: record.date,
                acknowledged: false
            });
        }

        return newAlerts;
    }

    function getViabilityRecommendation(trend, currentViability) {
        if (trend === 'critical_decline') return 'URGENT: Thaw fresh stock. Viability declining rapidly.';
        if (trend === 'declining') return 'Monitor closely. Consider thawing backup stock soon.';
        if (currentViability < 80) return 'Viability below threshold. Check culture conditions.';
        if (trend === 'stable') return 'Cell line performing well. Continue current protocol.';
        return 'Viability trending upward. Current protocol is effective.';
    }

    function getSenescenceAction(risk, viabilityTrend) {
        if (risk === 'critical') return 'STOP: Thaw new vial immediately. Do not use for experiments.';
        if (risk === 'high' && viabilityTrend === 'declining') return 'Thaw new vial within 1-2 passages.';
        if (risk === 'high') return 'Plan thaw of fresh stock. Current cells nearing limit.';
        if (risk === 'moderate') return 'Monitor passage count. Prepare backup vials.';
        return 'No action needed. Cells within safe passage range.';
    }

    return {
        addCellLine: addCellLine,
        getCellLine: getCellLine,
        listCellLines: listCellLines,
        removeCellLine: removeCellLine,
        recordPassage: recordPassage,
        getPassageHistory: getPassageHistory,
        getViabilityTrend: getViabilityTrend,
        getConfluenceProfile: getConfluenceProfile,
        getOptimalPassageWindow: getOptimalPassageWindow,
        getSenescenceRisk: getSenescenceRisk,
        getCellLineReport: getCellLineReport,
        getFleetReport: getFleetReport,
        exportPassageData: exportPassageData,
        getAlerts: getAlerts,
        acknowledgeAlert: acknowledgeAlert
    };
}

module.exports = { createPassageTracker: createPassageTracker };
