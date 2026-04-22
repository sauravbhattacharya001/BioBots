'use strict';

/**
 * Print Yield Analyzer — tracks and analyzes bioprint success/failure rates
 * across batches, materials, and time periods.
 *
 * Capabilities:
 *   1. Yield Rate Calculation — success/failure/partial counts and percentages
 *   2. Material Breakdown — per-material yield statistics
 *   3. Trend Analysis — rolling averages, direction detection, streak tracking
 *   4. Root Cause Aggregation — failure reason frequency analysis
 *   5. Recommendations — data-driven suggestions to improve yield
 *   6. Export — JSON/CSV summary output
 *
 * Print record format:
 *   { id, material, date (ISO string), outcome: 'success'|'failure'|'partial',
 *     failureReason?, notes?, operator?, parameters?: { pressure, temperature, speed } }
 *
 * Usage:
 *   var analyzer = createYieldAnalyzer();
 *   var report = analyzer.analyze(printRecords);
 *   console.log(report.overall.yieldRate);
 *
 *   var trends = analyzer.trends(printRecords, { windowSize: 5 });
 *   var csv = analyzer.exportCSV(report);
 *
 * @module yieldAnalyzer
 */

function createYieldAnalyzer(options) {
    options = options || {};
    var windowSize = options.windowSize || 5;

    // ── Outcome classification ──────────────────────────────────
    var OUTCOMES = { SUCCESS: 'success', FAILURE: 'failure', PARTIAL: 'partial' };

    function _validateRecords(records) {
        if (!Array.isArray(records)) throw new Error('records must be an array');
        if (records.length === 0) throw new Error('records array is empty');
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (!r || typeof r !== 'object') throw new Error('record at index ' + i + ' is invalid');
            if (!r.outcome) throw new Error('record at index ' + i + ' missing outcome');
            var o = r.outcome.toLowerCase();
            if (o !== OUTCOMES.SUCCESS && o !== OUTCOMES.FAILURE && o !== OUTCOMES.PARTIAL) {
                throw new Error('record at index ' + i + ' has invalid outcome: ' + r.outcome);
            }
        }
        return records;
    }

    function _classifyOutcome(record) {
        return (record.outcome || '').toLowerCase();
    }

    // ── Core Analysis ───────────────────────────────────────────

    function analyze(records) {
        _validateRecords(records);

        var overall = _computeYield(records);
        var byMaterial = _groupBy(records, function (r) { return r.material || 'unknown'; });
        var byOperator = _groupBy(records, function (r) { return r.operator || 'unknown'; });
        var failureReasons = _aggregateFailureReasons(records);
        var streaks = _computeStreaks(records);
        var recommendations = _generateRecommendations(overall, byMaterial, failureReasons, streaks);

        return {
            overall: overall,
            byMaterial: byMaterial,
            byOperator: byOperator,
            failureReasons: failureReasons,
            streaks: streaks,
            recommendations: recommendations,
            recordCount: records.length
        };
    }

    function _computeYield(records) {
        var success = 0, failure = 0, partial = 0;
        for (var i = 0; i < records.length; i++) {
            var o = _classifyOutcome(records[i]);
            if (o === OUTCOMES.SUCCESS) success++;
            else if (o === OUTCOMES.FAILURE) failure++;
            else partial++;
        }
        var total = records.length;
        return {
            total: total,
            success: success,
            failure: failure,
            partial: partial,
            yieldRate: _pct(success, total),
            failureRate: _pct(failure, total),
            partialRate: _pct(partial, total),
            effectiveYield: _pct(success + partial * 0.5, total)
        };
    }

    function _groupBy(records, keyFn) {
        var groups = {};
        for (var i = 0; i < records.length; i++) {
            var key = keyFn(records[i]);
            if (!groups[key]) groups[key] = [];
            groups[key].push(records[i]);
        }
        var result = {};
        var keys = Object.keys(groups);
        for (var j = 0; j < keys.length; j++) {
            result[keys[j]] = _computeYield(groups[keys[j]]);
        }
        return result;
    }

    function _aggregateFailureReasons(records) {
        var reasons = {};
        var failureCount = 0;
        for (var i = 0; i < records.length; i++) {
            var o = _classifyOutcome(records[i]);
            if (o === OUTCOMES.FAILURE || o === OUTCOMES.PARTIAL) {
                failureCount++;
                var reason = records[i].failureReason || 'unspecified';
                reasons[reason] = (reasons[reason] || 0) + 1;
            }
        }
        // Sort by frequency
        var sorted = Object.keys(reasons).map(function (r) {
            return { reason: r, count: reasons[r], percentage: _pct(reasons[r], failureCount) };
        }).sort(function (a, b) { return b.count - a.count; });
        return { total: failureCount, reasons: sorted };
    }

    function _computeStreaks(records) {
        var currentStreak = { type: null, count: 0 };
        var bestSuccess = 0, bestFailure = 0;
        var currentSuccess = 0, currentFailure = 0;

        for (var i = 0; i < records.length; i++) {
            var o = _classifyOutcome(records[i]);
            if (o === OUTCOMES.SUCCESS) {
                currentSuccess++;
                currentFailure = 0;
                if (currentSuccess > bestSuccess) bestSuccess = currentSuccess;
            } else {
                currentFailure++;
                currentSuccess = 0;
                if (currentFailure > bestFailure) bestFailure = currentFailure;
            }
        }

        return {
            currentType: currentSuccess > 0 ? 'success' : (currentFailure > 0 ? 'failure' : 'none'),
            currentLength: Math.max(currentSuccess, currentFailure),
            bestSuccessStreak: bestSuccess,
            worstFailureStreak: bestFailure
        };
    }

    // ── Trend Analysis ──────────────────────────────────────────

    function trends(records, trendOptions) {
        _validateRecords(records);
        trendOptions = trendOptions || {};
        var ws = trendOptions.windowSize || windowSize;

        // Sort by date
        var sorted = records.slice().sort(function (a, b) {
            return new Date(a.date || 0) - new Date(b.date || 0);
        });

        // Sliding-window rolling yield: O(n) instead of O(n × ws).
        // The previous implementation allocated a slice and re-counted
        // successes for every window position, making it O(n × ws).
        // Now we seed the count from the first window, then add/remove
        // one element per step.
        var rollingYield = [];
        if (sorted.length >= ws) {
            var successCount = 0;
            // Seed the first window
            for (var si = 0; si < ws; si++) {
                if (_classifyOutcome(sorted[si]) === OUTCOMES.SUCCESS) successCount++;
            }
            rollingYield.push({
                windowStart: 0,
                windowEnd: ws - 1,
                yieldRate: _pct(successCount, ws),
                startDate: sorted[0].date || null,
                endDate: sorted[ws - 1].date || null
            });
            // Slide: drop the element leaving the window, add the one entering
            for (var i = 1; i <= sorted.length - ws; i++) {
                if (_classifyOutcome(sorted[i - 1]) === OUTCOMES.SUCCESS) successCount--;
                if (_classifyOutcome(sorted[i + ws - 1]) === OUTCOMES.SUCCESS) successCount++;
                rollingYield.push({
                    windowStart: i,
                    windowEnd: i + ws - 1,
                    yieldRate: _pct(successCount, ws),
                    startDate: sorted[i].date || null,
                    endDate: sorted[i + ws - 1].date || null
                });
            }
        }

        // Direction
        var direction = 'stable';
        if (rollingYield.length >= 2) {
            var first = rollingYield[0].yieldRate;
            var last = rollingYield[rollingYield.length - 1].yieldRate;
            if (last - first > 5) direction = 'improving';
            else if (first - last > 5) direction = 'declining';
        }

        // Daily aggregation
        var daily = _aggregateByPeriod(sorted, function (r) {
            return (r.date || '').substring(0, 10);
        });

        return {
            rollingYield: rollingYield,
            direction: direction,
            daily: daily,
            windowSize: ws
        };
    }

    function _aggregateByPeriod(sortedRecords, keyFn) {
        var groups = {};
        for (var i = 0; i < sortedRecords.length; i++) {
            var key = keyFn(sortedRecords[i]);
            if (!key) continue;
            if (!groups[key]) groups[key] = [];
            groups[key].push(sortedRecords[i]);
        }
        return Object.keys(groups).sort().map(function (k) {
            var y = _computeYield(groups[k]);
            y.period = k;
            return y;
        });
    }

    // ── Recommendations ─────────────────────────────────────────

    function _generateRecommendations(overall, byMaterial, failureReasons, streaks) {
        var recs = [];

        if (overall.yieldRate < 50) {
            recs.push({ priority: 'critical', message: 'Yield rate is below 50% — review print parameters and material quality urgently.' });
        } else if (overall.yieldRate < 75) {
            recs.push({ priority: 'high', message: 'Yield rate is below 75% — consider systematic parameter optimization.' });
        } else if (overall.yieldRate < 90) {
            recs.push({ priority: 'medium', message: 'Yield rate is below 90% — fine-tune parameters for remaining failure modes.' });
        }

        // Worst material
        var materials = Object.keys(byMaterial);
        var worstMat = null, worstRate = 100;
        for (var i = 0; i < materials.length; i++) {
            if (byMaterial[materials[i]].total >= 3 && byMaterial[materials[i]].yieldRate < worstRate) {
                worstRate = byMaterial[materials[i]].yieldRate;
                worstMat = materials[i];
            }
        }
        if (worstMat && worstRate < 70) {
            recs.push({ priority: 'high', message: 'Material "' + worstMat + '" has a low yield rate (' + worstRate.toFixed(1) + '%). Consider recalibrating parameters for this bioink.' });
        }

        // Top failure reason
        if (failureReasons.reasons.length > 0) {
            var top = failureReasons.reasons[0];
            if (top.count >= 3) {
                recs.push({ priority: 'high', message: 'Top failure reason: "' + top.reason + '" (' + top.count + ' occurrences, ' + top.percentage.toFixed(1) + '% of failures). Address this first.' });
            }
        }

        // Bad streak
        if (streaks.worstFailureStreak >= 5) {
            recs.push({ priority: 'medium', message: 'Worst failure streak was ' + streaks.worstFailureStreak + ' consecutive prints. Implement mid-batch checkpoints.' });
        }

        if (recs.length === 0) {
            recs.push({ priority: 'low', message: 'Yield rates are healthy. Continue monitoring for regressions.' });
        }

        return recs;
    }

    // ── Comparison ──────────────────────────────────────────────

    function compare(recordsA, recordsB, labelA, labelB) {
        var a = analyze(recordsA);
        var b = analyze(recordsB);
        return {
            labels: [labelA || 'A', labelB || 'B'],
            yieldDelta: b.overall.yieldRate - a.overall.yieldRate,
            failureDelta: b.overall.failureRate - a.overall.failureRate,
            a: a.overall,
            b: b.overall,
            improved: b.overall.yieldRate > a.overall.yieldRate
        };
    }

    // ── Export ───────────────────────────────────────────────────

    function exportJSON(report) {
        return JSON.stringify(report, null, 2);
    }

    function exportCSV(report) {
        var lines = ['Category,Total,Success,Failure,Partial,YieldRate,FailureRate,EffectiveYield'];
        lines.push(_csvRow('Overall', report.overall));
        var materials = Object.keys(report.byMaterial);
        for (var i = 0; i < materials.length; i++) {
            lines.push(_csvRow('Material:' + materials[i], report.byMaterial[materials[i]]));
        }
        var operators = Object.keys(report.byOperator);
        for (var j = 0; j < operators.length; j++) {
            lines.push(_csvRow('Operator:' + operators[j], report.byOperator[operators[j]]));
        }
        return lines.join('\n');
    }

    function _csvRow(label, stats) {
        return [label, stats.total, stats.success, stats.failure, stats.partial,
            stats.yieldRate.toFixed(1), stats.failureRate.toFixed(1),
            stats.effectiveYield.toFixed(1)].join(',');
    }

    // ── Helpers ──────────────────────────────────────────────────

    function _pct(n, total) {
        if (total === 0) return 0;
        return (n / total) * 100;
    }

    return {
        analyze: analyze,
        trends: trends,
        compare: compare,
        exportJSON: exportJSON,
        exportCSV: exportCSV,
        OUTCOMES: OUTCOMES
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createYieldAnalyzer: createYieldAnalyzer };
}
