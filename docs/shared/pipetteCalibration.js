'use strict';

/**
 * Pipette Calibration Checker
 *
 * Helps lab users verify pipette accuracy by comparing gravimetric
 * measurements against expected volumes.  Follows ISO 8655 tolerances
 * for single-channel air-displacement pipettes.
 *
 * Usage:
 *   var checker = createPipetteCalibrationChecker();
 *
 *   // Record measurements (weights in mg of distilled water at ~22 °C)
 *   var result = checker.check({
 *     nominalVolume: 100,          // µL — the pipette's set volume
 *     measurements: [99.8, 100.1, 99.5, 100.3, 99.9, 100.0, 99.7, 100.2, 99.6, 100.1],
 *     waterTemperature: 22,        // °C  (optional, default 22)
 *     units: 'uL'                  // 'uL' | 'mL' (optional, default 'uL')
 *   });
 *
 *   // result => {
 *   //   nominalVolume: 100,
 *   //   n: 10,
 *   //   mean: 99.92,
 *   //   systematicError: -0.08,       // µL  (mean − nominal)
 *   //   systematicErrorPct: -0.08,    // %
 *   //   stdDev: 0.264,
 *   //   cv: 0.26,                     // coefficient of variation %
 *   //   randomErrorPct: 0.26,
 *   //   iso8655: { maxSystematicPct: 0.8, maxRandomPct: 0.3 },
 *   //   passSystematic: true,
 *   //   passRandom: true,
 *   //   pass: true,
 *   //   grade: 'PASS',
 *   //   recommendation: 'Pipette is within ISO 8655 tolerances.'
 *   // }
 */

// Z-factor: µL per mg of water at given temperature (simplified table)
var Z_FACTORS = {
    15: 1.00154,
    16: 1.00160,
    17: 1.00169,
    18: 1.00180,
    19: 1.00194,
    20: 1.00211,
    21: 1.00230,
    22: 1.00252,
    23: 1.00277,
    24: 1.00304,
    25: 1.00334,
    26: 1.00367,
    27: 1.00402,
    28: 1.00440,
    29: 1.00480,
    30: 1.00524
};

// ISO 8655-2 tolerances for air-displacement pipettes (nominal volume ranges)
// { maxVol, systematicPct, randomPct }
var ISO_TOLERANCES = [
    { maxVol: 1,    systematicPct: 5.0,  randomPct: 5.0  },
    { maxVol: 2,    systematicPct: 4.0,  randomPct: 2.0  },
    { maxVol: 5,    systematicPct: 2.5,  randomPct: 1.5  },
    { maxVol: 10,   systematicPct: 1.2,  randomPct: 0.8  },
    { maxVol: 20,   systematicPct: 1.0,  randomPct: 0.5  },
    { maxVol: 50,   systematicPct: 1.0,  randomPct: 0.4  },
    { maxVol: 100,  systematicPct: 0.8,  randomPct: 0.3  },
    { maxVol: 200,  systematicPct: 0.8,  randomPct: 0.3  },
    { maxVol: 500,  systematicPct: 0.8,  randomPct: 0.3  },
    { maxVol: 1000, systematicPct: 0.8,  randomPct: 0.3  },
    { maxVol: 5000, systematicPct: 0.8,  randomPct: 0.3  },
    { maxVol: 10000,systematicPct: 0.6,  randomPct: 0.3  }
];

function getZFactor(temp) {
    if (typeof temp !== 'number' || temp < 15 || temp > 30) {
        return Z_FACTORS[22];
    }
    var lower = Math.floor(temp);
    var upper = Math.ceil(temp);
    if (lower === upper) return Z_FACTORS[lower];
    var frac = temp - lower;
    return Z_FACTORS[lower] * (1 - frac) + Z_FACTORS[upper] * frac;
}

function getISOTolerance(nominalVolume) {
    for (var i = 0; i < ISO_TOLERANCES.length; i++) {
        if (nominalVolume <= ISO_TOLERANCES[i].maxVol) {
            return ISO_TOLERANCES[i];
        }
    }
    return ISO_TOLERANCES[ISO_TOLERANCES.length - 1];
}

var _round = require('./validation').round;
function round(val, decimals) {
    return _round(val, decimals || 3);
}

function createPipetteCalibrationChecker() {
    function check(opts) {
        if (!opts || typeof opts.nominalVolume !== 'number' || opts.nominalVolume <= 0) {
            throw new Error('nominalVolume must be a positive number (µL)');
        }
        if (!Array.isArray(opts.measurements) || opts.measurements.length < 2) {
            throw new Error('measurements must be an array of at least 2 gravimetric readings (mg)');
        }

        var nominal = opts.nominalVolume;
        var temp = typeof opts.waterTemperature === 'number' ? opts.waterTemperature : 22;
        var unitsMl = opts.units === 'mL';
        var z = getZFactor(temp);

        // Convert mg weights → µL volumes
        var volumes = opts.measurements.map(function (m) {
            if (typeof m !== 'number') throw new Error('Each measurement must be a number');
            return m * z; // mg × Z = µL
        });

        var n = volumes.length;
        var sum = volumes.reduce(function (a, b) { return a + b; }, 0);
        var mean = sum / n;

        var sqDiffSum = volumes.reduce(function (a, v) { return a + Math.pow(v - mean, 2); }, 0);
        var stdDev = Math.sqrt(sqDiffSum / (n - 1));
        var cv = (stdDev / mean) * 100;

        var sysError = mean - nominal;
        var sysErrorPct = (sysError / nominal) * 100;

        var tol = getISOTolerance(nominal);
        var passSystematic = Math.abs(sysErrorPct) <= tol.systematicPct;
        var passRandom = cv <= tol.randomPct;
        var pass = passSystematic && passRandom;

        var recommendation;
        if (pass) {
            recommendation = 'Pipette is within ISO 8655 tolerances.';
        } else if (!passSystematic && !passRandom) {
            recommendation = 'Pipette FAILS both systematic and random error limits. Service or replace immediately.';
        } else if (!passSystematic) {
            recommendation = 'Pipette FAILS systematic error limit (inaccurate). Recalibrate.';
        } else {
            recommendation = 'Pipette FAILS random error limit (imprecise). Check tip fit and technique, then service if needed.';
        }

        var divisor = unitsMl ? 1000 : 1;

        return {
            nominalVolume: nominal,
            n: n,
            mean: round(mean / divisor),
            systematicError: round(sysError / divisor),
            systematicErrorPct: round(sysErrorPct, 2),
            stdDev: round(stdDev / divisor),
            cv: round(cv, 2),
            randomErrorPct: round(cv, 2),
            iso8655: {
                maxSystematicPct: tol.systematicPct,
                maxRandomPct: tol.randomPct
            },
            passSystematic: passSystematic,
            passRandom: passRandom,
            pass: pass,
            grade: pass ? 'PASS' : 'FAIL',
            recommendation: recommendation
        };
    }

    return { check: check };
}

module.exports = { createPipetteCalibrationChecker: createPipetteCalibrationChecker };
