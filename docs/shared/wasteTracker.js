'use strict';

/**
 * Waste Tracker — Track, analyze, and reduce bioprinting material waste.
 *
 * Records waste events per print job, categorizes waste by type
 * (purge, failed print, leftover, expired, contaminated), calculates
 * waste rates, identifies patterns, and suggests reduction strategies.
 *
 * @example
 *   var wt = require('./wasteTracker').createWasteTracker();
 *   wt.logWaste({ jobId: 'J-001', material: 'alginate', wasteType: 'purge', volumeMl: 0.3, costPerMl: 2.50 });
 *   wt.logWaste({ jobId: 'J-001', material: 'alginate', wasteType: 'leftover', volumeMl: 1.2, costPerMl: 2.50 });
 *   var summary = wt.getSummary();
 *   var tips = wt.getReductionTips();
 */

var WASTE_TYPES = ['purge', 'failed_print', 'leftover', 'expired', 'contaminated', 'calibration', 'other'];

var REDUCTION_TIPS = {
    purge: [
        'Reduce nozzle priming volume by calibrating minimum purge distance',
        'Use a purge bucket with material recovery to reclaim purge waste',
        'Pre-warm bioink to reduce initial extrusion inconsistency'
    ],
    failed_print: [
        'Run a test extrusion line before starting full prints',
        'Check scaffold adhesion parameters — poor bed adhesion causes early failures',
        'Validate GCode with dry-run mode before committing material'
    ],
    leftover: [
        'Prepare smaller bioink batches matched to job volume estimates',
        'Use a job estimator to calculate exact material needs before mixing',
        'Store leftover bioink properly for reuse within shelf-life window'
    ],
    expired: [
        'Implement FIFO inventory rotation for bioink stock',
        'Set up expiry alerts using the shelf-life manager module',
        'Order smaller quantities more frequently to reduce expiry risk'
    ],
    contaminated: [
        'Review aseptic technique and laminar flow hood protocols',
        'Increase sterility assurance level (SAL) testing frequency',
        'Use single-use cartridges for contamination-prone materials'
    ],
    calibration: [
        'Reduce calibration frequency by improving printer repeatability',
        'Use smaller calibration volumes with micro-extrusion tests',
        'Save calibration profiles to skip re-calibration between similar jobs'
    ],
    other: [
        'Categorize waste more specifically to enable targeted reduction',
        'Track waste trends over time to identify systemic issues'
    ]
};

function createWasteTracker() {
    var entries = [];
    var nextId = 1;

    function logWaste(opts) {
        if (!opts || !opts.material) {
            throw new Error('material is required');
        }
        if (typeof opts.volumeMl !== 'number' || opts.volumeMl < 0) {
            throw new Error('volumeMl must be a non-negative number');
        }
        var wasteType = opts.wasteType || 'other';
        if (WASTE_TYPES.indexOf(wasteType) === -1) {
            throw new Error('Invalid wasteType: ' + wasteType + '. Valid types: ' + WASTE_TYPES.join(', '));
        }
        var entry = {
            id: nextId++,
            jobId: opts.jobId || null,
            material: opts.material,
            wasteType: wasteType,
            volumeMl: opts.volumeMl,
            costPerMl: typeof opts.costPerMl === 'number' ? opts.costPerMl : 0,
            cost: opts.volumeMl * (typeof opts.costPerMl === 'number' ? opts.costPerMl : 0),
            note: opts.note || '',
            timestamp: opts.timestamp || new Date().toISOString()
        };
        entries.push(entry);
        return entry;
    }

    function getEntries(filter) {
        var result = entries.slice();
        if (filter) {
            if (filter.jobId) {
                result = result.filter(function(e) { return e.jobId === filter.jobId; });
            }
            if (filter.material) {
                result = result.filter(function(e) { return e.material === filter.material; });
            }
            if (filter.wasteType) {
                result = result.filter(function(e) { return e.wasteType === filter.wasteType; });
            }
            if (filter.since) {
                var since = new Date(filter.since).getTime();
                result = result.filter(function(e) { return new Date(e.timestamp).getTime() >= since; });
            }
        }
        return result;
    }

    function getSummary(filter) {
        var data = getEntries(filter);
        if (data.length === 0) {
            return { totalEntries: 0, totalVolumeMl: 0, totalCost: 0, byType: {}, byMaterial: {} };
        }
        var totalVolumeMl = 0;
        var totalCost = 0;
        var byType = {};
        var byMaterial = {};

        for (var i = 0; i < data.length; i++) {
            var e = data[i];
            totalVolumeMl += e.volumeMl;
            totalCost += e.cost;

            if (!byType[e.wasteType]) {
                byType[e.wasteType] = { count: 0, volumeMl: 0, cost: 0 };
            }
            byType[e.wasteType].count++;
            byType[e.wasteType].volumeMl += e.volumeMl;
            byType[e.wasteType].cost += e.cost;

            if (!byMaterial[e.material]) {
                byMaterial[e.material] = { count: 0, volumeMl: 0, cost: 0 };
            }
            byMaterial[e.material].count++;
            byMaterial[e.material].volumeMl += e.volumeMl;
            byMaterial[e.material].cost += e.cost;
        }

        // Round values
        totalVolumeMl = Math.round(totalVolumeMl * 1000) / 1000;
        totalCost = Math.round(totalCost * 100) / 100;

        var typeKeys = Object.keys(byType);
        for (var t = 0; t < typeKeys.length; t++) {
            byType[typeKeys[t]].volumeMl = Math.round(byType[typeKeys[t]].volumeMl * 1000) / 1000;
            byType[typeKeys[t]].cost = Math.round(byType[typeKeys[t]].cost * 100) / 100;
            byType[typeKeys[t]].pct = Math.round((byType[typeKeys[t]].volumeMl / totalVolumeMl) * 10000) / 100;
        }
        var matKeys = Object.keys(byMaterial);
        for (var m = 0; m < matKeys.length; m++) {
            byMaterial[matKeys[m]].volumeMl = Math.round(byMaterial[matKeys[m]].volumeMl * 1000) / 1000;
            byMaterial[matKeys[m]].cost = Math.round(byMaterial[matKeys[m]].cost * 100) / 100;
        }

        return {
            totalEntries: data.length,
            totalVolumeMl: totalVolumeMl,
            totalCost: totalCost,
            byType: byType,
            byMaterial: byMaterial
        };
    }

    function getWasteRate(totalUsedMl, filter) {
        if (typeof totalUsedMl !== 'number' || totalUsedMl <= 0) {
            throw new Error('totalUsedMl must be a positive number');
        }
        var summary = getSummary(filter);
        var rate = summary.totalVolumeMl / (totalUsedMl + summary.totalVolumeMl);
        return {
            wasteVolumeMl: summary.totalVolumeMl,
            usedVolumeMl: totalUsedMl,
            totalVolumeMl: Math.round((totalUsedMl + summary.totalVolumeMl) * 1000) / 1000,
            wasteRatePct: Math.round(rate * 10000) / 100,
            rating: rate < 0.05 ? 'excellent' : rate < 0.10 ? 'good' : rate < 0.20 ? 'fair' : 'poor'
        };
    }

    function getTopWasteSources(limit) {
        var n = limit || 5;
        var summary = getSummary();
        var typeArr = Object.keys(summary.byType).map(function(k) {
            return { type: k, volumeMl: summary.byType[k].volumeMl, cost: summary.byType[k].cost, count: summary.byType[k].count };
        });
        typeArr.sort(function(a, b) { return b.volumeMl - a.volumeMl; });
        return typeArr.slice(0, n);
    }

    function getReductionTips(filter) {
        var summary = getSummary(filter);
        var tips = [];
        var types = Object.keys(summary.byType);
        // Sort by volume descending to prioritize biggest waste sources
        types.sort(function(a, b) { return summary.byType[b].volumeMl - summary.byType[a].volumeMl; });
        for (var i = 0; i < types.length; i++) {
            var t = types[i];
            if (REDUCTION_TIPS[t]) {
                tips.push({
                    wasteType: t,
                    volumeMl: summary.byType[t].volumeMl,
                    cost: summary.byType[t].cost,
                    suggestions: REDUCTION_TIPS[t]
                });
            }
        }
        return tips;
    }

    function getJobWaste(jobId) {
        if (!jobId) throw new Error('jobId is required');
        return getEntries({ jobId: jobId });
    }

    function clearEntries() {
        entries = [];
        nextId = 1;
    }

    function exportData(format) {
        var fmt = format || 'json';
        var data = entries.slice();
        if (fmt === 'json') {
            return JSON.stringify(data, null, 2);
        }
        if (fmt === 'csv') {
            if (data.length === 0) return '';
            var headers = ['id', 'jobId', 'material', 'wasteType', 'volumeMl', 'costPerMl', 'cost', 'note', 'timestamp'];
            var lines = [headers.join(',')];
            for (var i = 0; i < data.length; i++) {
                var row = headers.map(function(h) {
                    var v = data[i][h];
                    if (v === null || v === undefined) return '';
                    var s = String(v);
                    if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1) {
                        return '"' + s.replace(/"/g, '""') + '"';
                    }
                    return s;
                });
                lines.push(row.join(','));
            }
            return lines.join('\n');
        }
        throw new Error('Unsupported format: ' + fmt + '. Use json or csv.');
    }

    return {
        logWaste: logWaste,
        getEntries: getEntries,
        getSummary: getSummary,
        getWasteRate: getWasteRate,
        getTopWasteSources: getTopWasteSources,
        getReductionTips: getReductionTips,
        getJobWaste: getJobWaste,
        clearEntries: clearEntries,
        exportData: exportData,
        WASTE_TYPES: WASTE_TYPES
    };
}

module.exports = {
    createWasteTracker: createWasteTracker
};
