'use strict';

var validatePositive = require('./validation').validatePositive;

/**
 * Centrifuge Protocol Calculator
 *
 * Converts between RPM and RCF (g-force), recommends centrifuge settings
 * for common cell types, and calculates pelleting efficiency.
 *
 * @example
 *   var calc = createCentrifugeCalculator();
 *   calc.rpmToRcf(1500, 10.5);        // => { rcf: 264.5, ... }
 *   calc.rcfToRpm(300, 10.5);          // => { rpm: 1600, ... }
 *   calc.recommend('HeLa');            // => { rpm: 1200, rcf: 300, duration: 5, ... }
 *   calc.pelletTime({ rcf: 300, cellDiameter: 15, medium: 'DMEM' });
 */

var CELL_PROTOCOLS = {
    'HeLa':         { rpm: 1200, rcf: 300,  durationMin: 5,  temp: 4,  notes: 'Standard adherent line; gentle spin preserves viability' },
    'HEK293':       { rpm: 1000, rcf: 200,  durationMin: 5,  temp: 4,  notes: 'Semi-adherent; low g-force to avoid clumping' },
    'Jurkat':       { rpm: 1200, rcf: 300,  durationMin: 5,  temp: 4,  notes: 'Suspension T-cells; standard protocol' },
    'CHO':          { rpm: 1000, rcf: 200,  durationMin: 5,  temp: 4,  notes: 'Hamster ovary; gentle handling for recombinant work' },
    'MSC':          { rpm: 800,  rcf: 150,  durationMin: 7,  temp: 20, notes: 'Mesenchymal stem cells; very gentle to preserve potency' },
    'iPSC':         { rpm: 800,  rcf: 150,  durationMin: 5,  temp: 20, notes: 'Induced pluripotent; minimal shear stress' },
    'PBMC':         { rpm: 1500, rcf: 400,  durationMin: 10, temp: 20, notes: 'Peripheral blood; Ficoll gradient standard' },
    'E.coli':       { rpm: 4000, rcf: 3000, durationMin: 10, temp: 4,  notes: 'Bacterial pellet; high g-force needed' },
    'yeast':        { rpm: 3000, rcf: 1500, durationMin: 5,  temp: 4,  notes: 'S. cerevisiae; moderate g-force' },
    'RBC':          { rpm: 2000, rcf: 500,  durationMin: 5,  temp: 4,  notes: 'Red blood cells; avoid hemolysis' },
    'platelet':     { rpm: 800,  rcf: 100,  durationMin: 15, temp: 20, notes: 'Platelet-rich plasma; very low g-force' },
    'exosome':      { rpm: 100000, rcf: 100000, durationMin: 70, temp: 4, notes: 'Ultracentrifugation required; multi-step protocol' },
    'primary_neuron': { rpm: 700, rcf: 100, durationMin: 5,  temp: 20, notes: 'Extremely fragile; minimal centrifugal force' }
};

var MEDIUM_VISCOSITY = {
    'DMEM':    0.00094,
    'RPMI':    0.00091,
    'PBS':     0.00089,
    'water':   0.00089,
    'Ficoll':  0.01,
    'sucrose_20': 0.002
};

function createCentrifugeCalculator() {

    /**
     * Convert RPM to RCF (relative centrifugal force in × g).
     * @param {number} rpm - Revolutions per minute
     * @param {number} radiusCm - Rotor radius in centimeters
     * @returns {object} { rpm, radiusCm, rcf }
     */
    function rpmToRcf(rpm, radiusCm) {
        validatePositive(rpm, 'rpm');
        validatePositive(radiusCm, 'radiusCm');
        var rcf = 1.118e-5 * radiusCm * Math.pow(rpm, 2);
        return { rpm: rpm, radiusCm: radiusCm, rcf: Math.round(rcf * 10) / 10 };
    }

    /**
     * Convert RCF (× g) to RPM.
     * @param {number} rcf - Relative centrifugal force
     * @param {number} radiusCm - Rotor radius in centimeters
     * @returns {object} { rcf, radiusCm, rpm }
     */
    function rcfToRpm(rcf, radiusCm) {
        validatePositive(rcf, 'rcf');
        validatePositive(radiusCm, 'radiusCm');
        var rpm = Math.sqrt(rcf / (1.118e-5 * radiusCm));
        return { rcf: rcf, radiusCm: radiusCm, rpm: Math.round(rpm) };
    }

    /**
     * Get recommended centrifuge protocol for a cell type.
     * @param {string} cellType - Cell type name (case-insensitive)
     * @returns {object|null} Protocol or null if unknown
     */
    function recommend(cellType) {
        if (typeof cellType !== 'string') {
            throw new Error('cellType must be a string');
        }
        var key = cellType.trim();
        // Try exact match first, then case-insensitive
        if (CELL_PROTOCOLS[key]) {
            return Object.assign({ cellType: key }, CELL_PROTOCOLS[key]);
        }
        var lower = key.toLowerCase();
        var keys = Object.keys(CELL_PROTOCOLS);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].toLowerCase() === lower) {
                return Object.assign({ cellType: keys[i] }, CELL_PROTOCOLS[keys[i]]);
            }
        }
        return null;
    }

    /**
     * List all known cell type protocols.
     * @returns {string[]} Cell type names
     */
    function listCellTypes() {
        return Object.keys(CELL_PROTOCOLS);
    }

    /**
     * Estimate theoretical sedimentation time using Stokes' law.
     * @param {object} opts
     * @param {number} opts.rcf - Applied g-force (× g)
     * @param {number} opts.cellDiameter - Cell diameter in micrometers
     * @param {number} [opts.cellDensity=1.05] - Cell density in g/cm³
     * @param {string} [opts.medium='DMEM'] - Medium name for viscosity lookup
     * @param {number} [opts.pathLengthCm=5] - Sedimentation path length in cm
     * @returns {object} { timeSeconds, timeMinutes, velocity_cm_s, ... }
     */
    function pelletTime(opts) {
        if (!opts || typeof opts.rcf !== 'number' || typeof opts.cellDiameter !== 'number') {
            throw new Error('rcf and cellDiameter are required');
        }
        var rcf = opts.rcf;
        var d = opts.cellDiameter * 1e-4;  // µm → cm
        var rhoCell = opts.cellDensity || 1.05;
        var rhoMedium = 1.005;
        var medium = opts.medium || 'DMEM';
        var eta = MEDIUM_VISCOSITY[medium] || MEDIUM_VISCOSITY['DMEM'];
        var pathCm = opts.pathLengthCm || 5;
        var g = rcf * 980.665;  // × g to cm/s²

        // Stokes velocity: v = (d² × (ρ_cell - ρ_medium) × g) / (18 × η)
        var v = (Math.pow(d, 2) * (rhoCell - rhoMedium) * g) / (18 * eta);
        var timeSec = pathCm / v;

        return {
            rcf: rcf,
            cellDiameter_um: opts.cellDiameter,
            cellDensity: rhoCell,
            medium: medium,
            viscosity: eta,
            pathLengthCm: pathCm,
            velocity_cm_s: parseFloat(v.toFixed(6)),
            timeSeconds: Math.round(timeSec),
            timeMinutes: parseFloat((timeSec / 60).toFixed(1)),
            note: timeSec > 3600 ? 'Very slow — consider higher g-force or longer spin' : 'Achievable with standard centrifuge'
        };
    }

    /**
     * Compare two protocols side by side.
     * @param {string} cellTypeA
     * @param {string} cellTypeB
     * @returns {object} { a, b, comparison }
     */
    function compare(cellTypeA, cellTypeB) {
        var a = recommend(cellTypeA);
        var b = recommend(cellTypeB);
        if (!a || !b) {
            throw new Error('Unknown cell type: ' + (!a ? cellTypeA : cellTypeB));
        }
        return {
            a: a,
            b: b,
            comparison: {
                rcfDiff: a.rcf - b.rcf,
                durationDiff: a.durationMin - b.durationMin,
                tempDiff: a.temp - b.temp,
                gentler: a.rcf <= b.rcf ? a.cellType : b.cellType
            }
        };
    }

    return {
        rpmToRcf: rpmToRcf,
        rcfToRpm: rcfToRpm,
        recommend: recommend,
        listCellTypes: listCellTypes,
        pelletTime: pelletTime,
        compare: compare
    };
}

module.exports = {
    createCentrifugeCalculator: createCentrifugeCalculator
};
