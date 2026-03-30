'use strict';

var round = require('./validation').round;

/**
 * PCR Master Mix Calculator for BioBots bioprinting & molecular biology workflows.
 *
 * Provides:
 *   - Master mix volume calculations for N reactions + overage
 *   - Common polymerase presets (Taq, Phusion, Q5, KAPA)
 *   - Primer concentration adjustments
 *   - Gradient PCR temperature planning
 *   - Reaction summary reports
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var pcr = biobots.createPcrMasterMixCalculator();
 *   var mix = pcr.calculate({ reactions: 8, polymerase: 'taq' });
 */

function createPcrMasterMixCalculator() {

    /* ── Polymerase presets ── */
    var POLYMERASE_PRESETS = {
        'taq': {
            name: 'Taq DNA Polymerase',
            bufferConc: 10,          // 10× buffer
            mgCl2: 1.5,             // mM final
            dNTPs: 0.2,             // mM each final
            primerConc: 0.4,        // µM each final
            polymeraseUnits: 1.25,  // units per 50 µL
            polymeraseConc: 5,      // units/µL stock
            extensionRate: 1,       // min/kb
            hotStart: false,
            proofReading: false,
            notes: 'Standard Taq. No proofreading. ~1 error per 1×10⁴ bases.'
        },
        'phusion': {
            name: 'Phusion High-Fidelity',
            bufferConc: 5,
            mgCl2: 1.5,
            dNTPs: 0.2,
            primerConc: 0.5,
            polymeraseUnits: 1.0,
            polymeraseConc: 2,
            extensionRate: 0.25,    // 15-30 sec/kb
            hotStart: true,
            proofReading: true,
            notes: 'High fidelity. ~50× more accurate than Taq. Use 72°C extension.'
        },
        'q5': {
            name: 'Q5 High-Fidelity',
            bufferConc: 5,
            mgCl2: 2.0,
            dNTPs: 0.2,
            primerConc: 0.5,
            polymeraseUnits: 1.0,
            polymeraseConc: 2,
            extensionRate: 0.33,    // 20-30 sec/kb
            hotStart: true,
            proofReading: true,
            notes: 'Ultra high fidelity. ~280× more accurate than Taq.'
        },
        'kapa': {
            name: 'KAPA HiFi',
            bufferConc: 5,
            mgCl2: 2.5,
            dNTPs: 0.3,
            primerConc: 0.3,
            polymeraseUnits: 1.0,
            polymeraseConc: 1,
            extensionRate: 0.25,
            hotStart: true,
            proofReading: true,
            notes: 'High fidelity, good for GC-rich templates. ~100× more accurate than Taq.'
        }
    };

    /* ── Default reaction volume ── */
    var DEFAULT_VOLUME = 25; // µL
    var DEFAULT_OVERAGE = 0.10; // 10%

    /**
     * Calculate master mix volumes.
     * @param {Object} opts
     * @param {number} opts.reactions - Number of reactions
     * @param {string} [opts.polymerase='taq'] - Polymerase preset key
     * @param {number} [opts.reactionVolume=25] - Volume per reaction in µL
     * @param {number} [opts.overage=0.10] - Overage fraction (0.10 = 10%)
     * @param {number} [opts.templateVolume=1] - Template DNA volume per reaction (µL)
     * @param {number} [opts.primerConc] - Override primer concentration (µM final)
     * @param {number} [opts.dntpConc] - Override dNTP concentration (mM each final)
     * @returns {Object} Master mix recipe
     */
    function calculate(opts) {
        if (!opts || typeof opts.reactions !== 'number' || opts.reactions < 1) {
            throw new Error('reactions must be a positive number');
        }

        var preset = POLYMERASE_PRESETS[opts.polymerase || 'taq'];
        if (!preset) {
            throw new Error('Unknown polymerase: ' + opts.polymerase +
                '. Available: ' + Object.keys(POLYMERASE_PRESETS).join(', '));
        }

        var rxnVol = opts.reactionVolume || DEFAULT_VOLUME;
        var overage = typeof opts.overage === 'number' ? opts.overage : DEFAULT_OVERAGE;
        var templateVol = typeof opts.templateVolume === 'number' ? opts.templateVolume : 1;
        var primerConc = opts.primerConc || preset.primerConc;
        var dntpConc = opts.dntpConc || preset.dNTPs;

        var nWithOverage = opts.reactions * (1 + overage);

        // Per-reaction volumes (µL)
        var bufferVol = rxnVol / preset.bufferConc;
        // dNTPs from 10 mM stock each
        var dntpVol = (dntpConc * rxnVol) / 10;
        // Primers from 10 µM stock
        var fwdPrimerVol = (primerConc * rxnVol) / 10;
        var revPrimerVol = fwdPrimerVol;
        // MgCl2 from 25 mM stock (if separate)
        var mgcl2Vol = (preset.mgCl2 * rxnVol) / 25;
        // Polymerase
        var polyVol = preset.polymeraseUnits / preset.polymeraseConc;
        // Water
        var waterVol = rxnVol - bufferVol - dntpVol - fwdPrimerVol -
            revPrimerVol - mgcl2Vol - polyVol - templateVol;

        if (waterVol < 0) {
            throw new Error('Component volumes exceed reaction volume (' + rxnVol +
                ' µL). Reduce concentrations or increase reaction volume.');
        }

        var components = [
            { name: preset.bufferConc + '× Buffer', perRxn: round(bufferVol), masterMix: round(bufferVol * nWithOverage), stockConc: preset.bufferConc + '×' },
            { name: 'dNTPs (each)', perRxn: round(dntpVol), masterMix: round(dntpVol * nWithOverage), stockConc: '10 mM' },
            { name: 'Forward Primer', perRxn: round(fwdPrimerVol), masterMix: round(fwdPrimerVol * nWithOverage), stockConc: '10 µM' },
            { name: 'Reverse Primer', perRxn: round(revPrimerVol), masterMix: round(revPrimerVol * nWithOverage), stockConc: '10 µM' },
            { name: 'MgCl₂', perRxn: round(mgcl2Vol), masterMix: round(mgcl2Vol * nWithOverage), stockConc: '25 mM' },
            { name: preset.name, perRxn: round(polyVol), masterMix: round(polyVol * nWithOverage), stockConc: preset.polymeraseConc + ' U/µL' },
            { name: 'Nuclease-free H₂O', perRxn: round(waterVol), masterMix: round(waterVol * nWithOverage), stockConc: '—' },
            { name: 'Template DNA', perRxn: round(templateVol), masterMix: null, stockConc: 'variable', note: 'Add individually to each tube' }
        ];

        return {
            polymerase: preset.name,
            reactions: opts.reactions,
            reactionsWithOverage: round(nWithOverage),
            reactionVolume: rxnVol,
            overage: (overage * 100) + '%',
            components: components,
            totalMasterMixVolume: round((rxnVol - templateVol) * nWithOverage),
            notes: preset.notes
        };
    }

    /**
     * Plan a gradient PCR across annealing temperatures.
     * @param {Object} opts
     * @param {number} opts.tmForward - Tm of forward primer (°C)
     * @param {number} opts.tmReverse - Tm of reverse primer (°C)
     * @param {number} [opts.steps=8] - Number of gradient steps
     * @param {number} [opts.range=10] - Temperature range around midpoint (°C)
     * @returns {Object} Gradient plan
     */
    function gradientPlan(opts) {
        if (!opts || typeof opts.tmForward !== 'number' || typeof opts.tmReverse !== 'number') {
            throw new Error('tmForward and tmReverse are required');
        }

        var steps = opts.steps || 8;
        var lowerTm = Math.min(opts.tmForward, opts.tmReverse);
        var midpoint = (opts.tmForward + opts.tmReverse) / 2;
        var range = opts.range || 10;
        var low = Math.max(midpoint - range / 2, lowerTm - 5);
        var high = low + range;

        var temperatures = [];
        for (var i = 0; i < steps; i++) {
            temperatures.push(round(low + (i * range / (steps - 1))));
        }

        return {
            tmForward: opts.tmForward,
            tmReverse: opts.tmReverse,
            recommendedTa: round(lowerTm - 5),
            gradientRange: { low: round(low), high: round(high) },
            steps: steps,
            temperatures: temperatures,
            tip: 'Start with Ta = Tm(lower) - 5°C. For high-fidelity polymerases, use Ta = Tm(lower) + 3°C.'
        };
    }

    /**
     * Suggest thermocycling protocol.
     * @param {Object} opts
     * @param {string} [opts.polymerase='taq']
     * @param {number} opts.annealingTemp - Annealing temperature (°C)
     * @param {number} opts.ampliconSize - Expected product size in bp
     * @param {number} [opts.cycles=30]
     * @returns {Object} Cycling protocol
     */
    function cyclingProtocol(opts) {
        if (!opts || typeof opts.annealingTemp !== 'number' || typeof opts.ampliconSize !== 'number') {
            throw new Error('annealingTemp and ampliconSize are required');
        }

        var preset = POLYMERASE_PRESETS[opts.polymerase || 'taq'];
        if (!preset) {
            throw new Error('Unknown polymerase: ' + opts.polymerase);
        }

        var cycles = opts.cycles || 30;
        var extensionSec = Math.max(15, Math.ceil(opts.ampliconSize / 1000 * preset.extensionRate * 60));
        var extensionTemp = preset.proofReading ? 72 : 72;

        var steps = [
            { step: 'Initial Denaturation', temp: preset.hotStart ? 98 : 95, duration: preset.hotStart ? '30 s' : '3 min', cycles: 1 },
            { step: 'Denaturation', temp: preset.hotStart ? 98 : 95, duration: preset.hotStart ? '10 s' : '30 s', cycles: cycles },
            { step: 'Annealing', temp: opts.annealingTemp, duration: '30 s', cycles: cycles },
            { step: 'Extension', temp: extensionTemp, duration: extensionSec + ' s', cycles: cycles },
            { step: 'Final Extension', temp: extensionTemp, duration: '5 min', cycles: 1 },
            { step: 'Hold', temp: 4, duration: '∞', cycles: 1 }
        ];

        var totalTime = (preset.hotStart ? 0.5 : 3) +
            cycles * ((preset.hotStart ? 10 : 30) + 30 + extensionSec) / 60 +
            5;

        return {
            polymerase: preset.name,
            ampliconSize: opts.ampliconSize + ' bp',
            steps: steps,
            estimatedTime: round(totalTime) + ' min',
            notes: preset.notes
        };
    }

    /**
     * List available polymerase presets.
     */
    function listPolymerases() {
        return Object.keys(POLYMERASE_PRESETS).map(function (key) {
            var p = POLYMERASE_PRESETS[key];
            return {
                key: key,
                name: p.name,
                hotStart: p.hotStart,
                proofReading: p.proofReading,
                extensionRate: p.extensionRate + ' min/kb',
                notes: p.notes
            };
        });
    }

    return {
        calculate: calculate,
        gradientPlan: gradientPlan,
        cyclingProtocol: cyclingProtocol,
        listPolymerases: listPolymerases
    };
}

module.exports = { createPcrMasterMixCalculator: createPcrMasterMixCalculator };
