'use strict';

var _vRound = require('./validation').round;

/**
 * Reagent Dilution Calculator for BioBots bioprinting workflows.
 *
 * Provides:
 *   - C1V1 = C2V2 dilution calculations
 *   - Serial dilution planning
 *   - Molarity ↔ mass conversions
 *   - Buffer preparation recipes
 *   - Working solution preparation from stock
 *
 * @example
 *   var biobots = require('@sauravbhattacharya001/biobots');
 *   var diluter = biobots.createDilutionCalculator();
 *   var result = diluter.c1v1({ c1: 10, v1: null, c2: 2, v2: 50 });
 *   // => { v1: 10, diluentVolume: 40, dilutionFactor: 5 }
 */

function createDilutionCalculator() {

    /* ── Molecular weight database (common bioprinting reagents) ── */
    var MW_DATABASE = {
        'calcium-chloride': { name: 'Calcium Chloride (CaCl₂)', mw: 110.98, unit: 'g/mol' },
        'sodium-alginate': { name: 'Sodium Alginate', mw: 216.12, unit: 'g/mol (monomer)' },
        'gelatin': { name: 'Gelatin', mw: 87000, unit: 'g/mol (avg)' },
        'collagenase': { name: 'Collagenase', mw: 68000, unit: 'g/mol' },
        'trypsin': { name: 'Trypsin', mw: 23300, unit: 'g/mol' },
        'edta': { name: 'EDTA', mw: 292.24, unit: 'g/mol' },
        'pbs-nacl': { name: 'NaCl (for PBS)', mw: 58.44, unit: 'g/mol' },
        'pbs-kcl': { name: 'KCl (for PBS)', mw: 74.55, unit: 'g/mol' },
        'pbs-na2hpo4': { name: 'Na₂HPO₄ (for PBS)', mw: 141.96, unit: 'g/mol' },
        'pbs-kh2po4': { name: 'KH₂PO₄ (for PBS)', mw: 136.09, unit: 'g/mol' },
        'tris': { name: 'Tris Base', mw: 121.14, unit: 'g/mol' },
        'hepes': { name: 'HEPES', mw: 238.30, unit: 'g/mol' },
        'dmso': { name: 'DMSO', mw: 78.13, unit: 'g/mol' },
        'glutaraldehyde': { name: 'Glutaraldehyde', mw: 100.12, unit: 'g/mol' },
        'penicillin': { name: 'Penicillin G', mw: 334.39, unit: 'g/mol' },
        'streptomycin': { name: 'Streptomycin', mw: 581.57, unit: 'g/mol' }
    };

    /* ── Buffer recipes (1x concentrations, amounts per liter) ── */
    var BUFFER_RECIPES = {
        'pbs-1x': {
            name: '1× PBS (Phosphate Buffered Saline)',
            ph: 7.4,
            components: [
                { reagent: 'pbs-nacl', gPerLiter: 8.0 },
                { reagent: 'pbs-kcl', gPerLiter: 0.2 },
                { reagent: 'pbs-na2hpo4', gPerLiter: 1.44 },
                { reagent: 'pbs-kh2po4', gPerLiter: 0.24 }
            ],
            notes: 'Adjust pH to 7.4 with HCl. Autoclave or filter-sterilize.'
        },
        'tris-hcl': {
            name: 'Tris-HCl Buffer',
            ph: 7.5,
            components: [
                { reagent: 'tris', gPerLiter: 12.11 }
            ],
            notes: 'Dissolve Tris, adjust pH to desired value with HCl. Common: pH 7.5 or 8.0.'
        },
        'hepes-buffer': {
            name: 'HEPES Buffer (25 mM)',
            ph: 7.4,
            components: [
                { reagent: 'hepes', gPerLiter: 5.96 }
            ],
            notes: 'Adjust pH with NaOH. Good for cell culture (CO₂-independent buffering).'
        },
        'cacl2-crosslink': {
            name: 'CaCl₂ Crosslinking Solution (100 mM)',
            ph: null,
            components: [
                { reagent: 'calcium-chloride', gPerLiter: 11.10 }
            ],
            notes: 'Common crosslinker for alginate bioinks. Filter-sterilize before use.'
        }
    };

    /* ── C1V1 = C2V2 ── */
    function c1v1(opts) {
        if (!opts || typeof opts !== 'object') {
            return { error: 'Provide an object with c1, v1, c2, v2 (one may be null to solve).' };
        }
        var c1 = opts.c1, v1 = opts.v1, c2 = opts.c2, v2 = opts.v2;
        var nullCount = (c1 === null ? 1 : 0) + (v1 === null ? 1 : 0) +
                        (c2 === null ? 1 : 0) + (v2 === null ? 1 : 0);
        if (nullCount !== 1) {
            return { error: 'Exactly one of c1, v1, c2, v2 must be null (the unknown).' };
        }

        var solved;
        if (c1 === null) { solved = { variable: 'c1', value: _round(c2 * v2 / v1) }; }
        else if (v1 === null) { solved = { variable: 'v1', value: _round(c2 * v2 / c1) }; }
        else if (c2 === null) { solved = { variable: 'c2', value: _round(c1 * v1 / v2) }; }
        else { solved = { variable: 'v2', value: _round(c1 * v1 / c2) }; }

        if (!isFinite(solved.value) || solved.value <= 0) {
            return { error: 'Invalid result — check that non-null values are positive.' };
        }

        var result = {
            c1: c1 !== null ? c1 : solved.value,
            v1: v1 !== null ? v1 : solved.value,
            c2: c2 !== null ? c2 : solved.value,
            v2: v2 !== null ? v2 : solved.value,
            solved: solved.variable,
            solvedValue: solved.value
        };
        result.dilutionFactor = _round(result.c1 / result.c2);
        result.diluentVolume = _round(result.v2 - result.v1);

        return result;
    }

    /* ── Serial dilution planner ── */
    function serialDilution(opts) {
        if (!opts || typeof opts !== 'object') {
            return { error: 'Provide { stockConcentration, dilutionFactor, steps, transferVolume, finalVolume }.' };
        }
        var stock = opts.stockConcentration;
        var factor = opts.dilutionFactor || 10;
        var steps = opts.steps || 6;
        var transferVol = opts.transferVolume || 100; // µL
        var finalVol = opts.finalVolume || 1000; // µL

        if (stock <= 0 || factor <= 1 || steps < 1 || transferVol <= 0 || finalVol <= 0) {
            return { error: 'All values must be positive; dilutionFactor must be > 1.' };
        }
        if (transferVol >= finalVol) {
            return { error: 'transferVolume must be less than finalVolume.' };
        }

        var diluentPerTube = _round(finalVol - transferVol);
        var tubes = [];
        // The first tube receives transferVol of stock into finalVol total,
        // so its concentration is stock * (transferVol / finalVol) = stock / factor.
        // Each subsequent tube transfers from the previous tube, diluting by
        // the same factor again.
        var conc = stock;

        for (var i = 0; i < steps; i++) {
            conc = _round(conc / factor);
            tubes.push({
                tube: i + 1,
                concentration: conc,
                transferIn: transferVol,
                diluentAdded: diluentPerTube,
                totalVolume: finalVol,
                cumulativeDilution: Math.pow(factor, i + 1)
            });
        }

        return {
            stockConcentration: stock,
            dilutionFactor: factor,
            steps: steps,
            transferVolume: transferVol,
            diluentPerTube: diluentPerTube,
            finalVolumePerTube: finalVol,
            tubes: tubes,
            lowestConcentration: tubes[tubes.length - 1].concentration,
            totalDiluentNeeded: _round(diluentPerTube * steps),
            totalStockNeeded: transferVol
        };
    }

    /* ── Molarity ↔ mass conversions ── */
    function molarityToMass(opts) {
        if (!opts) return { error: 'Provide { molarity, volumeL, reagent|mw }.' };
        var M = opts.molarity;
        var V = opts.volumeL;
        var mw = opts.mw || _getMW(opts.reagent);

        if (!mw) return { error: 'Unknown reagent. Provide mw (molecular weight) directly.' };
        if (M <= 0 || V <= 0 || mw <= 0) return { error: 'All values must be positive.' };

        var grams = _round(M * V * mw);
        var mg = _round(grams * 1000);

        return {
            molarity: M,
            volumeL: V,
            molecularWeight: mw,
            gramsNeeded: grams,
            mgNeeded: mg,
            reagent: opts.reagent || null,
            reagentName: opts.reagent ? (MW_DATABASE[opts.reagent] || {}).name : null
        };
    }

    function massToMolarity(opts) {
        if (!opts) return { error: 'Provide { massG, volumeL, reagent|mw }.' };
        var g = opts.massG;
        var V = opts.volumeL;
        var mw = opts.mw || _getMW(opts.reagent);

        if (!mw) return { error: 'Unknown reagent. Provide mw (molecular weight) directly.' };
        if (g <= 0 || V <= 0 || mw <= 0) return { error: 'All values must be positive.' };

        var M = _round(g / (V * mw));

        return {
            molarity: M,
            molarityMM: _round(M * 1000),
            massG: g,
            volumeL: V,
            molecularWeight: mw,
            reagent: opts.reagent || null,
            reagentName: opts.reagent ? (MW_DATABASE[opts.reagent] || {}).name : null
        };
    }

    /* ── Percent solution helpers ── */
    function percentSolution(opts) {
        if (!opts) return { error: 'Provide { percent, volumeMl, type } where type is "w/v" or "v/v".' };
        var pct = opts.percent;
        var vol = opts.volumeMl;
        var type = (opts.type || 'w/v').toLowerCase();

        if (pct <= 0 || pct > 100 || vol <= 0) return { error: 'percent must be 0-100, volumeMl > 0.' };

        if (type === 'w/v') {
            var grams = _round(pct / 100 * vol);
            return {
                type: 'w/v',
                percent: pct,
                volumeMl: vol,
                soluteGrams: grams,
                solventMl: vol,
                instruction: 'Dissolve ' + grams + ' g solute in solvent, bring to ' + vol + ' mL total volume.'
            };
        } else if (type === 'v/v') {
            var soluteMl = _round(pct / 100 * vol);
            var solventMl = _round(vol - soluteMl);
            return {
                type: 'v/v',
                percent: pct,
                volumeMl: vol,
                soluteMl: soluteMl,
                solventMl: solventMl,
                instruction: 'Add ' + soluteMl + ' mL solute to ' + solventMl + ' mL solvent.'
            };
        }
        return { error: 'type must be "w/v" or "v/v".' };
    }

    /* ── Buffer preparation ── */
    function prepareBuffer(opts) {
        if (!opts) return { error: 'Provide { buffer, volumeMl, concentration? }.' };
        var bufferKey = opts.buffer;
        var recipe = BUFFER_RECIPES[bufferKey];
        if (!recipe) {
            return {
                error: 'Unknown buffer "' + bufferKey + '".',
                available: Object.keys(BUFFER_RECIPES)
            };
        }

        var volMl = opts.volumeMl || 1000;
        var concMultiplier = opts.concentration || 1;
        if (volMl <= 0) return { error: 'volumeMl must be positive.' };

        var scaleFactor = (volMl / 1000) * concMultiplier;
        var components = recipe.components.map(function(c) {
            var info = MW_DATABASE[c.reagent] || {};
            var gNeeded = _round(c.gPerLiter * scaleFactor);
            return {
                reagent: c.reagent,
                name: info.name || c.reagent,
                gramsNeeded: gNeeded,
                mgNeeded: _round(gNeeded * 1000),
                molarConcentration: info.mw ? _round((c.gPerLiter * concMultiplier) / info.mw) : null
            };
        });

        return {
            buffer: recipe.name,
            targetPh: recipe.ph,
            volumeMl: volMl,
            concentration: concMultiplier + 'x',
            components: components,
            notes: recipe.notes,
            waterToAdd: volMl + ' mL (bring to final volume)'
        };
    }

    /* ── Working solution from stock ── */
    function workingSolution(opts) {
        if (!opts) return { error: 'Provide { stockConcentration, workingConcentration, volumeNeeded }.' };
        var sc = opts.stockConcentration;
        var wc = opts.workingConcentration;
        var vol = opts.volumeNeeded;

        if (sc <= 0 || wc <= 0 || vol <= 0) return { error: 'All values must be positive.' };
        if (wc >= sc) return { error: 'workingConcentration must be less than stockConcentration.' };

        var stockVol = _round(wc * vol / sc);
        var diluentVol = _round(vol - stockVol);

        return {
            stockConcentration: sc,
            workingConcentration: wc,
            totalVolume: vol,
            stockVolumeNeeded: stockVol,
            diluentVolumeNeeded: diluentVol,
            dilutionFactor: _round(sc / wc),
            instruction: 'Add ' + stockVol + ' of stock to ' + diluentVol + ' of diluent for ' + vol + ' total.'
        };
    }

    /* ── List available reagents ── */
    function listReagents() {
        return Object.keys(MW_DATABASE).map(function(key) {
            var r = MW_DATABASE[key];
            return { id: key, name: r.name, molecularWeight: r.mw, unit: r.unit };
        });
    }

    /* ── List available buffers ── */
    function listBuffers() {
        return Object.keys(BUFFER_RECIPES).map(function(key) {
            var b = BUFFER_RECIPES[key];
            return { id: key, name: b.name, ph: b.ph, componentCount: b.components.length };
        });
    }

    /* ── Helpers ── */
    function _getMW(reagent) {
        if (!reagent) return null;
        var entry = MW_DATABASE[reagent];
        return entry ? entry.mw : null;
    }

    function _round(n) {
        return _vRound(n, 4);
    }

    return {
        c1v1: c1v1,
        serialDilution: serialDilution,
        molarityToMass: molarityToMass,
        massToMolarity: massToMolarity,
        percentSolution: percentSolution,
        prepareBuffer: prepareBuffer,
        workingSolution: workingSolution,
        listReagents: listReagents,
        listBuffers: listBuffers
    };
}

module.exports = { createDilutionCalculator: createDilutionCalculator };
