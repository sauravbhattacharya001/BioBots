'use strict';

/**
 * Freeze-Thaw Cycle Tracker
 *
 * Tracks cryopreservation freeze-thaw cycles for cell samples, monitors
 * viability degradation over cycles, and recommends discard thresholds.
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var tracker = biobots.createFreezeThawTracker();
 *   tracker.addSample({ id: 'S-001', cellType: 'MSC', initialViability: 95 });
 *   tracker.recordThaw('S-001', { viability: 88, recoveryRate: 0.82 });
 *   var report = tracker.getReport('S-001');
 */

/**
 * Default degradation models per cell type (viability loss % per cycle).
 * Based on published cryobiology literature averages.
 */
var DEGRADATION_MODELS = {
    'MSC':          { lossPerCycle: 5.0, maxCycles: 5, warningThreshold: 70 },
    'iPSC':         { lossPerCycle: 8.0, maxCycles: 3, warningThreshold: 75 },
    'HEK293':       { lossPerCycle: 3.0, maxCycles: 8, warningThreshold: 60 },
    'CHO':          { lossPerCycle: 3.5, maxCycles: 7, warningThreshold: 60 },
    'fibroblast':   { lossPerCycle: 4.0, maxCycles: 6, warningThreshold: 65 },
    'hepatocyte':   { lossPerCycle: 7.0, maxCycles: 4, warningThreshold: 70 },
    'neuron':       { lossPerCycle: 9.0, maxCycles: 3, warningThreshold: 75 },
    'chondrocyte':  { lossPerCycle: 5.5, maxCycles: 5, warningThreshold: 68 },
    'default':      { lossPerCycle: 5.0, maxCycles: 5, warningThreshold: 70 }
};

/**
 * Cryoprotectant agents and their effectiveness multipliers.
 */
var _isDangerousKey = require('./sanitize').isDangerousKey;

var CRYOPROTECTANTS = {
    'DMSO':             { effectivenessMultiplier: 1.0, toxicityRisk: 'moderate' },
    'glycerol':         { effectivenessMultiplier: 0.85, toxicityRisk: 'low' },
    'trehalose':        { effectivenessMultiplier: 0.90, toxicityRisk: 'low' },
    'ethylene_glycol':  { effectivenessMultiplier: 0.95, toxicityRisk: 'moderate' },
    'methylcellulose':  { effectivenessMultiplier: 0.80, toxicityRisk: 'low' }
};

function createFreezeThawTracker() {
    var samples = {};

    /**
     * Add a new sample to track.
     * @param {Object} opts
     * @param {string} opts.id - Unique sample identifier
     * @param {string} opts.cellType - Cell type (e.g. 'MSC', 'iPSC')
     * @param {number} opts.initialViability - Starting viability percentage (0-100)
     * @param {string} [opts.cryoprotectant] - Cryoprotectant used (e.g. 'DMSO')
     * @param {number} [opts.cellCount] - Initial cell count
     * @param {string} [opts.freezeDate] - ISO date string of initial freeze
     * @param {string} [opts.notes] - Free-text notes
     */
    function addSample(opts) {
        if (!opts || !opts.id) {
            throw new Error('Sample id is required');
        }
        if (_isDangerousKey(opts.id)) {
            throw new Error('Invalid sample id');
        }
        if (samples[opts.id]) {
            throw new Error('Sample ' + opts.id + ' already exists');
        }
        var viability = typeof opts.initialViability === 'number' ? opts.initialViability : 100;
        if (viability < 0 || viability > 100) {
            throw new Error('initialViability must be between 0 and 100');
        }

        var model = DEGRADATION_MODELS[opts.cellType] || DEGRADATION_MODELS['default'];

        samples[opts.id] = {
            id: opts.id,
            cellType: opts.cellType || 'unknown',
            initialViability: viability,
            currentViability: viability,
            cryoprotectant: opts.cryoprotectant || null,
            cellCount: opts.cellCount || null,
            freezeDate: opts.freezeDate || new Date().toISOString(),
            notes: opts.notes || '',
            cycles: [],
            model: model,
            status: 'active'
        };

        return { id: opts.id, status: 'active', model: model };
    }

    /**
     * Record a thaw event for a sample.
     * @param {string} sampleId
     * @param {Object} data
     * @param {number} data.viability - Measured viability after thaw (0-100)
     * @param {number} [data.recoveryRate] - Cell recovery rate (0-1)
     * @param {number} [data.cellCount] - Post-thaw cell count
     * @param {string} [data.thawDate] - ISO date string
     * @param {string} [data.thawMethod] - Method used (e.g. '37C water bath')
     * @param {string} [data.notes] - Notes about this cycle
     */
    function recordThaw(sampleId, data) {
        if (_isDangerousKey(sampleId)) {
            throw new Error('Invalid sample id');
        }
        var sample = samples[sampleId];
        if (!sample) {
            throw new Error('Sample ' + sampleId + ' not found');
        }
        if (sample.status === 'discarded') {
            throw new Error('Sample ' + sampleId + ' has been discarded');
        }
        if (!data || typeof data.viability !== 'number') {
            throw new Error('Measured viability is required');
        }
        if (data.viability < 0 || data.viability > 100) {
            throw new Error('viability must be between 0 and 100');
        }

        var cycleNumber = sample.cycles.length + 1;
        var viabilityDrop = sample.currentViability - data.viability;

        var cycle = {
            cycle: cycleNumber,
            viability: data.viability,
            viabilityDrop: Math.round(viabilityDrop * 100) / 100,
            recoveryRate: data.recoveryRate || null,
            cellCount: data.cellCount || null,
            thawDate: data.thawDate || new Date().toISOString(),
            thawMethod: data.thawMethod || null,
            notes: data.notes || ''
        };

        sample.cycles.push(cycle);
        sample.currentViability = data.viability;
        if (data.cellCount) {
            sample.cellCount = data.cellCount;
        }

        // Check status
        var warnings = [];
        if (data.viability <= sample.model.warningThreshold) {
            warnings.push('Viability below warning threshold (' + sample.model.warningThreshold + '%)');
            sample.status = 'warning';
        }
        if (cycleNumber >= sample.model.maxCycles) {
            warnings.push('Maximum recommended cycles reached (' + sample.model.maxCycles + ')');
            sample.status = 'discard_recommended';
        }
        if (data.viability < 50) {
            sample.status = 'discard_recommended';
            warnings.push('Viability critically low (<50%)');
        }

        return {
            sampleId: sampleId,
            cycle: cycleNumber,
            viability: data.viability,
            viabilityDrop: cycle.viabilityDrop,
            status: sample.status,
            warnings: warnings
        };
    }

    /**
     * Get a full report for a sample.
     * @param {string} sampleId
     * @returns {Object} Complete sample report with trend analysis
     */
    function getReport(sampleId) {
        var sample = samples[sampleId];
        if (!sample) {
            throw new Error('Sample ' + sampleId + ' not found');
        }

        var totalDrop = sample.initialViability - sample.currentViability;
        var avgDropPerCycle = sample.cycles.length > 0
            ? Math.round((totalDrop / sample.cycles.length) * 100) / 100
            : 0;

        // Predict remaining useful cycles
        var remainingViability = sample.currentViability - sample.model.warningThreshold;
        var predictedCyclesLeft = avgDropPerCycle > 0
            ? Math.floor(remainingViability / avgDropPerCycle)
            : sample.model.maxCycles - sample.cycles.length;
        if (predictedCyclesLeft < 0) { predictedCyclesLeft = 0; }

        // Cryoprotectant info
        var cpaInfo = null;
        if (sample.cryoprotectant && CRYOPROTECTANTS[sample.cryoprotectant]) {
            cpaInfo = {
                agent: sample.cryoprotectant,
                effectivenessMultiplier: CRYOPROTECTANTS[sample.cryoprotectant].effectivenessMultiplier,
                toxicityRisk: CRYOPROTECTANTS[sample.cryoprotectant].toxicityRisk
            };
        }

        return {
            id: sample.id,
            cellType: sample.cellType,
            status: sample.status,
            initialViability: sample.initialViability,
            currentViability: sample.currentViability,
            totalCycles: sample.cycles.length,
            maxRecommendedCycles: sample.model.maxCycles,
            totalViabilityLoss: Math.round(totalDrop * 100) / 100,
            avgViabilityLossPerCycle: avgDropPerCycle,
            predictedCyclesRemaining: predictedCyclesLeft,
            cryoprotectant: cpaInfo,
            cycles: sample.cycles,
            freezeDate: sample.freezeDate,
            recommendation: _getRecommendation(sample, avgDropPerCycle, predictedCyclesLeft)
        };
    }

    /**
     * Mark a sample as discarded.
     * @param {string} sampleId
     * @param {string} [reason] - Reason for discard
     */
    function discardSample(sampleId, reason) {
        var sample = samples[sampleId];
        if (!sample) {
            throw new Error('Sample ' + sampleId + ' not found');
        }
        sample.status = 'discarded';
        sample.discardDate = new Date().toISOString();
        sample.discardReason = reason || 'Manual discard';
        return { id: sampleId, status: 'discarded', reason: sample.discardReason };
    }

    /**
     * List all tracked samples with optional status filter.
     * @param {Object} [opts]
     * @param {string} [opts.status] - Filter by status
     * @param {string} [opts.cellType] - Filter by cell type
     */
    function listSamples(opts) {
        opts = opts || {};
        var result = [];
        var ids = Object.keys(samples);
        for (var i = 0; i < ids.length; i++) {
            var s = samples[ids[i]];
            if (opts.status && s.status !== opts.status) { continue; }
            if (opts.cellType && s.cellType !== opts.cellType) { continue; }
            result.push({
                id: s.id,
                cellType: s.cellType,
                status: s.status,
                currentViability: s.currentViability,
                totalCycles: s.cycles.length,
                maxCycles: s.model.maxCycles
            });
        }
        return result;
    }

    /**
     * Get summary statistics across all samples.
     */
    function getSummary() {
        var ids = Object.keys(samples);
        var stats = {
            totalSamples: ids.length,
            active: 0,
            warning: 0,
            discardRecommended: 0,
            discarded: 0,
            totalThawCycles: 0,
            avgViability: 0
        };
        var viabilitySum = 0;
        var activeSamples = 0;

        for (var i = 0; i < ids.length; i++) {
            var s = samples[ids[i]];
            stats.totalThawCycles += s.cycles.length;
            if (s.status === 'active') { stats.active++; }
            else if (s.status === 'warning') { stats.warning++; }
            else if (s.status === 'discard_recommended') { stats.discardRecommended++; }
            else if (s.status === 'discarded') { stats.discarded++; }
            if (s.status !== 'discarded') {
                viabilitySum += s.currentViability;
                activeSamples++;
            }
        }

        stats.avgViability = activeSamples > 0
            ? Math.round((viabilitySum / activeSamples) * 100) / 100
            : 0;

        return stats;
    }

    /**
     * Get supported cell types and their degradation models.
     */
    function getCellTypes() {
        var result = {};
        var keys = Object.keys(DEGRADATION_MODELS);
        for (var i = 0; i < keys.length; i++) {
            result[keys[i]] = Object.assign({}, DEGRADATION_MODELS[keys[i]]);
        }
        return result;
    }

    /**
     * Get supported cryoprotectants.
     */
    function getCryoprotectants() {
        var result = {};
        var keys = Object.keys(CRYOPROTECTANTS);
        for (var i = 0; i < keys.length; i++) {
            result[keys[i]] = Object.assign({}, CRYOPROTECTANTS[keys[i]]);
        }
        return result;
    }

    function _getRecommendation(sample, avgDrop, cyclesLeft) {
        if (sample.status === 'discarded') {
            return 'Sample has been discarded.';
        }
        if (sample.currentViability < 50) {
            return 'DISCARD: Viability critically low. Sample is no longer suitable for experiments.';
        }
        if (sample.cycles.length >= sample.model.maxCycles) {
            return 'DISCARD RECOMMENDED: Maximum freeze-thaw cycles reached for ' + sample.cellType + '. Further cycling will likely compromise results.';
        }
        if (sample.status === 'warning') {
            return 'CAUTION: Viability approaching threshold. ' + cyclesLeft + ' cycle(s) estimated before discard threshold. Consider using this sample soon.';
        }
        if (avgDrop > sample.model.lossPerCycle * 1.5) {
            return 'NOTE: Viability is degrading faster than expected for ' + sample.cellType + '. Check cryopreservation protocol and storage conditions.';
        }
        return 'OK: Sample is in good condition. ~' + cyclesLeft + ' cycle(s) remaining before warning threshold.';
    }

    return {
        addSample: addSample,
        recordThaw: recordThaw,
        getReport: getReport,
        discardSample: discardSample,
        listSamples: listSamples,
        getSummary: getSummary,
        getCellTypes: getCellTypes,
        getCryoprotectants: getCryoprotectants
    };
}

module.exports = {
    createFreezeThawTracker: createFreezeThawTracker
};
