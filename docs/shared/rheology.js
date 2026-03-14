'use strict';

/**
 * Bioink Rheology Modeler for BioBots
 *
 * Models bioink flow behavior using standard rheological models:
 *   - Power Law (Ostwald-de Waele): η = K · γ̇^(n-1)
 *   - Cross model: η = η∞ + (η0 - η∞) / (1 + (λγ̇)^m)
 *   - Herschel-Bulkley: τ = τ_y + K · γ̇^n
 *
 * Provides printability window analysis, temperature-viscosity modeling
 * (Arrhenius), and shear rate estimation from nozzle geometry.
 */
function createRheologyModeler() {

    // ── Power Law Model ─────────────────────────────────────────

    /**
     * Compute viscosity using the Power Law (Ostwald-de Waele) model.
     *   η = K · γ̇^(n-1)
     *
     * @param {number} K  - Consistency index (Pa·s^n), must be > 0
     * @param {number} n  - Flow behavior index (dimensionless)
     *                      n < 1: shear-thinning, n = 1: Newtonian, n > 1: shear-thickening
     * @param {number} shearRate - Shear rate γ̇ (1/s), must be > 0
     * @returns {number} Apparent viscosity η (Pa·s)
     */
    function powerLawViscosity(K, n, shearRate) {
        if (typeof K !== 'number' || typeof n !== 'number' || typeof shearRate !== 'number') {
            throw new Error('All parameters must be numbers');
        }
        if (K <= 0) throw new Error('Consistency index K must be positive');
        if (shearRate <= 0) throw new Error('Shear rate must be positive');
        return K * Math.pow(shearRate, n - 1);
    }

    /**
     * Generate a viscosity-vs-shear-rate curve using the Power Law model.
     *
     * @param {number} K - Consistency index (Pa·s^n)
     * @param {number} n - Flow behavior index
     * @param {number} [minRate=0.1]  - Minimum shear rate (1/s)
     * @param {number} [maxRate=1000] - Maximum shear rate (1/s)
     * @param {number} [points=50]    - Number of data points (log-spaced)
     * @returns {{ shearRate: number, viscosity: number }[]}
     */
    function powerLawCurve(K, n, minRate, maxRate, points) {
        minRate = minRate || 0.1;
        maxRate = maxRate || 1000;
        points = points || 50;
        if (minRate <= 0 || maxRate <= 0) throw new Error('Rate bounds must be positive');
        if (minRate >= maxRate) throw new Error('minRate must be less than maxRate');
        if (points < 2) throw new Error('Need at least 2 points');

        var curve = [];
        var logMin = Math.log10(minRate);
        var logMax = Math.log10(maxRate);
        for (var i = 0; i < points; i++) {
            var logRate = logMin + (logMax - logMin) * i / (points - 1);
            var rate = Math.pow(10, logRate);
            curve.push({ shearRate: rate, viscosity: powerLawViscosity(K, n, rate) });
        }
        return curve;
    }

    /**
     * Fit Power Law parameters (K, n) from experimental viscosity data
     * using log-log linear regression.
     *   log(η) = log(K) + (n-1) · log(γ̇)
     *
     * @param {{ shearRate: number, viscosity: number }[]} data - Measured data points
     * @returns {{ K: number, n: number, rSquared: number }}
     */
    function fitPowerLaw(data) {
        if (!Array.isArray(data) || data.length < 2) {
            throw new Error('Need at least 2 data points for fitting');
        }

        // Filter valid positive values
        var valid = data.filter(function (d) {
            return d && d.shearRate > 0 && d.viscosity > 0;
        });
        if (valid.length < 2) throw new Error('Need at least 2 valid positive data points');

        // Log-log linear regression: log(η) = log(K) + (n-1) · log(γ̇)
        var N = valid.length;
        var sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
        for (var i = 0; i < N; i++) {
            var x = Math.log(valid[i].shearRate);
            var y = Math.log(valid[i].viscosity);
            sumX += x;
            sumY += y;
            sumXX += x * x;
            sumXY += x * y;
        }

        var slope = (N * sumXY - sumX * sumY) / (N * sumXX - sumX * sumX);
        var intercept = (sumY - slope * sumX) / N;

        var K = Math.exp(intercept);
        var n = slope + 1;

        // R² calculation
        var meanY = sumY / N;
        var ssTotal = 0, ssResidual = 0;
        for (var j = 0; j < N; j++) {
            var xj = Math.log(valid[j].shearRate);
            var yj = Math.log(valid[j].viscosity);
            var predicted = intercept + slope * xj;
            ssTotal += (yj - meanY) * (yj - meanY);
            ssResidual += (yj - predicted) * (yj - predicted);
        }
        var rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

        return { K: K, n: n, rSquared: rSquared };
    }

    // ── Cross Model ─────────────────────────────────────────────

    /**
     * Compute viscosity using the Cross model.
     *   η = η∞ + (η0 - η∞) / (1 + (λγ̇)^m)
     *
     * @param {number} eta0     - Zero-shear viscosity (Pa·s), must be > 0
     * @param {number} etaInf   - Infinite-shear viscosity (Pa·s), must be >= 0
     * @param {number} lambda   - Relaxation time constant (s), must be > 0
     * @param {number} m        - Cross rate constant (dimensionless), must be > 0
     * @param {number} shearRate - Shear rate γ̇ (1/s), must be >= 0
     * @returns {number} Apparent viscosity η (Pa·s)
     */
    function crossViscosity(eta0, etaInf, lambda, m, shearRate) {
        if (eta0 <= 0) throw new Error('Zero-shear viscosity must be positive');
        if (etaInf < 0) throw new Error('Infinite-shear viscosity must be non-negative');
        if (lambda <= 0) throw new Error('Relaxation time must be positive');
        if (m <= 0) throw new Error('Cross rate constant must be positive');
        if (shearRate < 0) throw new Error('Shear rate must be non-negative');
        if (eta0 < etaInf) throw new Error('Zero-shear viscosity must be >= infinite-shear viscosity');

        if (shearRate === 0) return eta0;
        return etaInf + (eta0 - etaInf) / (1 + Math.pow(lambda * shearRate, m));
    }

    /**
     * Generate a viscosity curve using the Cross model.
     *
     * @param {number} eta0   - Zero-shear viscosity (Pa·s)
     * @param {number} etaInf - Infinite-shear viscosity (Pa·s)
     * @param {number} lambda - Relaxation time (s)
     * @param {number} m      - Cross rate constant
     * @param {number} [minRate=0.01]  - Minimum shear rate
     * @param {number} [maxRate=10000] - Maximum shear rate
     * @param {number} [points=50]     - Number of points
     * @returns {{ shearRate: number, viscosity: number }[]}
     */
    function crossCurve(eta0, etaInf, lambda, m, minRate, maxRate, points) {
        minRate = minRate || 0.01;
        maxRate = maxRate || 10000;
        points = points || 50;

        var curve = [];
        var logMin = Math.log10(minRate);
        var logMax = Math.log10(maxRate);
        for (var i = 0; i < points; i++) {
            var logRate = logMin + (logMax - logMin) * i / (points - 1);
            var rate = Math.pow(10, logRate);
            curve.push({ shearRate: rate, viscosity: crossViscosity(eta0, etaInf, lambda, m, rate) });
        }
        return curve;
    }

    // ── Herschel-Bulkley Model ──────────────────────────────────

    /**
     * Compute shear stress using the Herschel-Bulkley model.
     *   τ = τ_y + K · γ̇^n
     *
     * @param {number} yieldStress - Yield stress τ_y (Pa), must be >= 0
     * @param {number} K          - Consistency index (Pa·s^n), must be > 0
     * @param {number} n          - Flow index, must be > 0
     * @param {number} shearRate  - Shear rate γ̇ (1/s), must be >= 0
     * @returns {number} Shear stress τ (Pa)
     */
    function herschelBulkleyStress(yieldStress, K, n, shearRate) {
        if (yieldStress < 0) throw new Error('Yield stress must be non-negative');
        if (K <= 0) throw new Error('Consistency index must be positive');
        if (n <= 0) throw new Error('Flow index must be positive');
        if (shearRate < 0) throw new Error('Shear rate must be non-negative');

        return yieldStress + K * Math.pow(shearRate, n);
    }

    /**
     * Compute apparent viscosity from Herschel-Bulkley.
     *   η_app = τ / γ̇ = τ_y/γ̇ + K · γ̇^(n-1)
     *
     * @param {number} yieldStress - Yield stress (Pa)
     * @param {number} K - Consistency index
     * @param {number} n - Flow index
     * @param {number} shearRate - Shear rate (1/s), must be > 0
     * @returns {number} Apparent viscosity (Pa·s)
     */
    function herschelBulkleyViscosity(yieldStress, K, n, shearRate) {
        if (shearRate <= 0) throw new Error('Shear rate must be positive for viscosity calculation');
        var stress = herschelBulkleyStress(yieldStress, K, n, shearRate);
        return stress / shearRate;
    }

    // ── Nozzle Shear Rate ───────────────────────────────────────

    /**
     * Estimate wall shear rate in a cylindrical nozzle for a power-law fluid.
     *   γ̇_w = ((3n+1)/(4n)) · (32Q / (π·D³))
     *
     * Weissenberg-Rabinowitsch correction for non-Newtonian fluids.
     *
     * @param {number} flowRate      - Volumetric flow rate Q (mL/min)
     * @param {number} nozzleDiameter - Nozzle inner diameter D (mm)
     * @param {number} [n=1]         - Flow behavior index (1 = Newtonian)
     * @returns {number} Wall shear rate (1/s)
     */
    function nozzleShearRate(flowRate, nozzleDiameter, n) {
        if (flowRate <= 0) throw new Error('Flow rate must be positive');
        if (nozzleDiameter <= 0) throw new Error('Nozzle diameter must be positive');
        n = (typeof n === 'number' && n > 0) ? n : 1;

        // Convert: mL/min → m³/s, mm → m
        var Q = flowRate * 1e-6 / 60; // mL/min → m³/s
        var D = nozzleDiameter * 1e-3; // mm → m

        var newtonian = 32 * Q / (Math.PI * Math.pow(D, 3));
        var correction = (3 * n + 1) / (4 * n);

        return correction * newtonian;
    }

    /**
     * Estimate volumetric flow rate from print speed and nozzle diameter.
     * Uses rectangular cross-section approximation (track width × layer height),
     * standard for extrusion bioprinting where the deposited track width
     * approximately equals the nozzle diameter.
     *   Q = v · D · h
     *
     * @param {number} printSpeed - Linear print speed (mm/s)
     * @param {number} nozzleDiameter - Nozzle diameter (mm), used as track width
     * @param {number} layerHeight - Layer height (mm)
     * @returns {number} Estimated flow rate (mL/min)
     */
    function estimateFlowRate(printSpeed, nozzleDiameter, layerHeight) {
        if (printSpeed <= 0) throw new Error('Print speed must be positive');
        if (nozzleDiameter <= 0) throw new Error('Nozzle diameter must be positive');
        if (layerHeight <= 0) throw new Error('Layer height must be positive');

        // Cross-section = nozzle width × layer height (rectangular approximation)
        var area = nozzleDiameter * layerHeight; // mm²
        var volumeRate = printSpeed * area; // mm³/s
        return volumeRate * 60 / 1000; // → mL/min
    }

    // ── Temperature-Viscosity (Arrhenius) ───────────────────────

    /**
     * Model viscosity vs temperature using the Arrhenius equation.
     *   η(T) = A · exp(Ea / (R · T))
     *
     * @param {number} refViscosity - Viscosity at reference temperature (Pa·s)
     * @param {number} refTemp      - Reference temperature (°C)
     * @param {number} activationEnergy - Activation energy Ea (kJ/mol)
     * @param {number} targetTemp   - Target temperature (°C)
     * @returns {number} Predicted viscosity at target temperature (Pa·s)
     */
    function arrheniusViscosity(refViscosity, refTemp, activationEnergy, targetTemp) {
        if (refViscosity <= 0) throw new Error('Reference viscosity must be positive');
        if (activationEnergy <= 0) throw new Error('Activation energy must be positive');

        var R = 8.314e-3; // Gas constant in kJ/(mol·K)
        var T_ref = refTemp + 273.15; // °C → K
        var T_target = targetTemp + 273.15;

        if (T_ref <= 0 || T_target <= 0) throw new Error('Temperature must be above absolute zero');

        // η(T) = η_ref · exp(Ea/R · (1/T - 1/T_ref))
        var exponent = (activationEnergy / R) * (1 / T_target - 1 / T_ref);
        return refViscosity * Math.exp(exponent);
    }

    /**
     * Generate a viscosity-vs-temperature curve.
     *
     * @param {number} refViscosity - Viscosity at reference temperature (Pa·s)
     * @param {number} refTemp - Reference temperature (°C)
     * @param {number} activationEnergy - Activation energy (kJ/mol)
     * @param {number} minTemp - Minimum temperature (°C)
     * @param {number} maxTemp - Maximum temperature (°C)
     * @param {number} [step=1] - Temperature step (°C)
     * @returns {{ temperature: number, viscosity: number }[]}
     */
    function temperatureCurve(refViscosity, refTemp, activationEnergy, minTemp, maxTemp, step) {
        step = step || 1;
        if (minTemp >= maxTemp) throw new Error('minTemp must be less than maxTemp');
        if (step <= 0) throw new Error('Step must be positive');

        var curve = [];
        for (var T = minTemp; T <= maxTemp; T += step) {
            curve.push({
                temperature: T,
                viscosity: arrheniusViscosity(refViscosity, refTemp, activationEnergy, T)
            });
        }
        return curve;
    }

    // ── Printability Analysis ───────────────────────────────────

    /**
     * Analyze printability based on rheological parameters.
     *
     * Evaluates whether a bioink formulation is suitable for extrusion
     * bioprinting based on industry-standard criteria:
     *   - Shear-thinning behavior (n < 1)
     *   - Viscosity at printing shear rate (1-1000 Pa·s typical)
     *   - Yield stress (needed for shape retention)
     *   - Recovery behavior (thixotropy indicator)
     *
     * @param {Object} params
     * @param {number} params.K - Consistency index (Pa·s^n)
     * @param {number} params.n - Flow behavior index
     * @param {number} [params.yieldStress] - Yield stress (Pa)
     * @param {number} [params.printShearRate=100] - Expected printing shear rate (1/s)
     * @param {number} [params.minViscosity=1]  - Minimum acceptable viscosity (Pa·s)
     * @param {number} [params.maxViscosity=1000] - Maximum acceptable viscosity (Pa·s)
     * @returns {{ printable: boolean, score: number, factors: Object[], viscosityAtPrint: number }}
     */
    function analyzePrintability(params) {
        if (!params || typeof params !== 'object') throw new Error('Parameters required');
        if (!params.K || params.K <= 0) throw new Error('Consistency index K required and must be positive');
        if (typeof params.n !== 'number') throw new Error('Flow behavior index n required');

        var printRate = params.printShearRate || 100;
        var minVisc = params.minViscosity || 1;
        var maxVisc = params.maxViscosity || 1000;

        var viscAtPrint = powerLawViscosity(params.K, params.n, printRate);
        var factors = [];
        var totalScore = 0;
        var maxScore = 0;

        // Factor 1: Shear-thinning behavior (weight: 25)
        maxScore += 25;
        if (params.n < 0.5) {
            factors.push({ name: 'Shear Thinning', score: 25, max: 25, status: 'excellent',
                detail: 'Strong shear-thinning (n=' + params.n.toFixed(2) + ') — excellent for extrusion' });
            totalScore += 25;
        } else if (params.n < 0.8) {
            factors.push({ name: 'Shear Thinning', score: 20, max: 25, status: 'good',
                detail: 'Moderate shear-thinning (n=' + params.n.toFixed(2) + ') — good for extrusion' });
            totalScore += 20;
        } else if (params.n < 1.0) {
            factors.push({ name: 'Shear Thinning', score: 10, max: 25, status: 'marginal',
                detail: 'Mild shear-thinning (n=' + params.n.toFixed(2) + ') — may need higher pressure' });
            totalScore += 10;
        } else {
            factors.push({ name: 'Shear Thinning', score: 0, max: 25, status: 'poor',
                detail: 'Newtonian or shear-thickening (n=' + params.n.toFixed(2) + ') — not ideal for extrusion' });
        }

        // Factor 2: Viscosity at print shear rate (weight: 30)
        maxScore += 30;
        if (viscAtPrint >= minVisc && viscAtPrint <= maxVisc) {
            var optRange = maxVisc - minVisc;
            var optCenter = (minVisc + maxVisc) / 2;
            var dist = Math.abs(viscAtPrint - optCenter) / (optRange / 2);
            var viscScore = Math.round(30 * Math.max(0, 1 - dist * 0.5));
            factors.push({ name: 'Print Viscosity', score: viscScore, max: 30, status: viscScore >= 20 ? 'excellent' : 'good',
                detail: 'Viscosity at print rate: ' + viscAtPrint.toFixed(1) + ' Pa·s (target: ' + minVisc + '-' + maxVisc + ')' });
            totalScore += viscScore;
        } else if (viscAtPrint < minVisc) {
            factors.push({ name: 'Print Viscosity', score: 5, max: 30, status: 'poor',
                detail: 'Too low (' + viscAtPrint.toFixed(1) + ' Pa·s) — filament won\'t hold shape' });
            totalScore += 5;
        } else {
            factors.push({ name: 'Print Viscosity', score: 5, max: 30, status: 'poor',
                detail: 'Too high (' + viscAtPrint.toFixed(1) + ' Pa·s) — may clog nozzle or require excessive pressure' });
            totalScore += 5;
        }

        // Factor 3: Viscosity ratio (low vs high shear) — indicator of recoverability (weight: 25)
        maxScore += 25;
        var viscLow = powerLawViscosity(params.K, params.n, 1);
        var viscHigh = powerLawViscosity(params.K, params.n, 1000);
        var ratio = viscLow / viscHigh;
        if (ratio >= 100) {
            factors.push({ name: 'Viscosity Ratio', score: 25, max: 25, status: 'excellent',
                detail: 'High ratio (' + ratio.toFixed(0) + 'x) — strong recovery expected' });
            totalScore += 25;
        } else if (ratio >= 10) {
            var ratioScore = Math.round(15 + 10 * (Math.log10(ratio) - 1));
            factors.push({ name: 'Viscosity Ratio', score: ratioScore, max: 25, status: 'good',
                detail: 'Moderate ratio (' + ratio.toFixed(0) + 'x) — adequate recovery' });
            totalScore += ratioScore;
        } else {
            factors.push({ name: 'Viscosity Ratio', score: 5, max: 25, status: 'marginal',
                detail: 'Low ratio (' + ratio.toFixed(1) + 'x) — poor structural recovery after extrusion' });
            totalScore += 5;
        }

        // Factor 4: Yield stress (weight: 20)
        maxScore += 20;
        if (typeof params.yieldStress === 'number') {
            if (params.yieldStress >= 10 && params.yieldStress <= 500) {
                factors.push({ name: 'Yield Stress', score: 20, max: 20, status: 'excellent',
                    detail: 'Yield stress ' + params.yieldStress.toFixed(1) + ' Pa — good shape retention' });
                totalScore += 20;
            } else if (params.yieldStress > 0 && params.yieldStress < 10) {
                factors.push({ name: 'Yield Stress', score: 10, max: 20, status: 'marginal',
                    detail: 'Low yield stress (' + params.yieldStress.toFixed(1) + ' Pa) — may sag between layers' });
                totalScore += 10;
            } else if (params.yieldStress > 500) {
                factors.push({ name: 'Yield Stress', score: 12, max: 20, status: 'good',
                    detail: 'High yield stress (' + params.yieldStress.toFixed(0) + ' Pa) — stiff but printable' });
                totalScore += 12;
            } else {
                factors.push({ name: 'Yield Stress', score: 5, max: 20, status: 'poor',
                    detail: 'No yield stress — structure will collapse' });
                totalScore += 5;
            }
        } else {
            factors.push({ name: 'Yield Stress', score: 0, max: 20, status: 'unknown',
                detail: 'Yield stress not provided — cannot assess shape retention' });
        }

        var score = Math.round(100 * totalScore / maxScore);

        return {
            printable: score >= 50,
            score: score,
            factors: factors,
            viscosityAtPrint: viscAtPrint,
            shearThinning: params.n < 1,
            flowBehavior: params.n < 0.5 ? 'strongly shear-thinning'
                : params.n < 1.0 ? 'shear-thinning'
                : params.n === 1.0 ? 'Newtonian'
                : 'shear-thickening'
        };
    }

    // ── Bioink Presets ──────────────────────────────────────────

    /**
     * Common bioink rheological parameters from published literature.
     * @returns {Object[]} Array of preset bioink profiles
     */
    function getBioinkPresets() {
        return [
            {
                id: 'gelma-5pct',
                name: 'GelMA 5%',
                K: 2.5, n: 0.62,
                yieldStress: 15,
                tempRange: [20, 37],
                description: 'Gelatin methacrylate 5% w/v, photocrosslinkable',
                citation: 'Loessner et al., Nat. Protoc. 2016'
            },
            {
                id: 'alginate-3pct',
                name: 'Alginate 3%',
                K: 8.1, n: 0.71,
                yieldStress: 5,
                tempRange: [20, 40],
                description: 'Sodium alginate 3% w/v, CaCl₂ crosslinked',
                citation: 'Axpe & Oyen, Int. J. Mol. Sci. 2016'
            },
            {
                id: 'collagen-6mg',
                name: 'Collagen 6mg/mL',
                K: 0.8, n: 0.45,
                yieldStress: 3,
                tempRange: [4, 25],
                description: 'Type I collagen 6 mg/mL, thermally gelled',
                citation: 'Lee et al., Biomaterials 2019'
            },
            {
                id: 'pluronic-25pct',
                name: 'Pluronic F-127 25%',
                K: 45, n: 0.35,
                yieldStress: 120,
                tempRange: [25, 40],
                description: 'Pluronic F-127 25% w/v, thermoreversible',
                citation: 'Müller et al., J. Vis. Exp. 2013'
            },
            {
                id: 'ha-bioink',
                name: 'Hyaluronic Acid 2%',
                K: 15, n: 0.55,
                yieldStress: 25,
                tempRange: [20, 37],
                description: 'Hyaluronic acid 2% w/v, methacrylated',
                citation: 'Highley et al., Adv. Mater. 2015'
            },
            {
                id: 'silk-5pct',
                name: 'Silk Fibroin 5%',
                K: 3.2, n: 0.58,
                yieldStress: 8,
                tempRange: [20, 37],
                description: 'Silk fibroin 5% w/v, enzymatically crosslinked',
                citation: 'Das et al., Acta Biomater. 2015'
            }
        ];
    }

    // ── Public API ──────────────────────────────────────────────

    return {
        powerLawViscosity: powerLawViscosity,
        powerLawCurve: powerLawCurve,
        fitPowerLaw: fitPowerLaw,
        crossViscosity: crossViscosity,
        crossCurve: crossCurve,
        herschelBulkleyStress: herschelBulkleyStress,
        herschelBulkleyViscosity: herschelBulkleyViscosity,
        nozzleShearRate: nozzleShearRate,
        estimateFlowRate: estimateFlowRate,
        arrheniusViscosity: arrheniusViscosity,
        temperatureCurve: temperatureCurve,
        analyzePrintability: analyzePrintability,
        getBioinkPresets: getBioinkPresets
    };
}

// UMD export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createRheologyModeler: createRheologyModeler };
}
