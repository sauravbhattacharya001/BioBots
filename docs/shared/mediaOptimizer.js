'use strict';

var round = require('./validation').round;

/**
 * Tissue Culture Media Optimizer — helps researchers formulate, compare,
 * and troubleshoot cell culture media compositions.
 *
 * Features:
 *  - Built-in basal media formulations (DMEM, RPMI-1640, MEM, F-12, etc.)
 *  - Supplement calculator (FBS, antibiotics, growth factors)
 *  - Osmolarity estimator for custom formulations
 *  - Nutrient gap analysis: compare formulation to cell-type requirements
 *  - Media cost estimator per volume
 *
 * @example
 *   var opt = createMediaOptimizer();
 *
 *   // List available basal media
 *   opt.listMedia();
 *
 *   // Get DMEM formulation
 *   opt.getFormulation('dmem');
 *
 *   // Calculate supplements for 500 mL DMEM + 10% FBS + 1% Pen/Strep
 *   opt.supplementVolumes({
 *     totalMl: 500,
 *     supplements: [
 *       { name: 'FBS', percent: 10 },
 *       { name: 'Pen/Strep', percent: 1 }
 *     ]
 *   });
 *
 *   // Estimate osmolarity
 *   opt.estimateOsmolarity('dmem', [{ name: 'FBS', percent: 10 }]);
 *
 *   // Nutrient gap analysis
 *   opt.nutrientGap({ medium: 'rpmi1640', cellType: 'hybridoma' });
 */

// ── Basal Media Database ───────────────────────────────────────────
// Concentrations in mg/L unless noted
var MEDIA_DB = {
    dmem: {
        name: 'DMEM (Dulbecco\'s Modified Eagle Medium)',
        category: 'high-glucose',
        osmolarity: 320, // mOsm/kg
        ph: 7.4,
        components: {
            'Glucose':          4500,
            'L-Glutamine':      584,
            'Sodium Pyruvate':   110,
            'NaCl':             6400,
            'KCl':               400,
            'CaCl2':             200,
            'MgSO4':              98,
            'NaH2PO4':           109,
            'NaHCO3':           3700,
            'Fe(NO3)3':          0.1,
            'Phenol Red':         15
        },
        aminoAcids: {
            'L-Arginine':        84,
            'L-Cystine':         63,
            'Glycine':           30,
            'L-Histidine':       42,
            'L-Isoleucine':     105,
            'L-Leucine':        105,
            'L-Lysine':         146,
            'L-Methionine':      30,
            'L-Phenylalanine':   66,
            'L-Serine':          42,
            'L-Threonine':       95,
            'L-Tryptophan':      16,
            'L-Tyrosine':       104,
            'L-Valine':          94
        },
        vitamins: {
            'Choline Chloride':    4,
            'Folic Acid':          4,
            'myo-Inositol':        7.2,
            'Niacinamide':         4,
            'D-Pantothenate':      4,
            'Pyridoxine HCl':      4,
            'Riboflavin':         0.4,
            'Thiamine HCl':        4
        }
    },
    rpmi1640: {
        name: 'RPMI-1640',
        category: 'low-glucose',
        osmolarity: 280,
        ph: 7.4,
        components: {
            'Glucose':          2000,
            'L-Glutamine':      300,
            'NaCl':             6000,
            'KCl':               400,
            'CaCl2':             100,
            'MgSO4':              49,
            'Na2HPO4':           800,
            'NaHCO3':           2000,
            'Glutathione':         1,
            'Phenol Red':          5
        },
        aminoAcids: {
            'L-Arginine':       200,
            'L-Asparagine':      50,
            'L-Aspartic Acid':   20,
            'L-Cystine':         65,
            'L-Glutamic Acid':   20,
            'Glycine':           10,
            'L-Histidine':       15,
            'L-Hydroxyproline':  20,
            'L-Isoleucine':      50,
            'L-Leucine':         50,
            'L-Lysine':          40,
            'L-Methionine':      15,
            'L-Phenylalanine':   15,
            'L-Proline':         20,
            'L-Serine':          30,
            'L-Threonine':       20,
            'L-Tryptophan':       5,
            'L-Tyrosine':        29,
            'L-Valine':          20
        },
        vitamins: {
            'Biotin':           0.2,
            'Choline Chloride':   3,
            'Folic Acid':         1,
            'myo-Inositol':      35,
            'Niacinamide':        1,
            'D-Pantothenate':   0.25,
            'PABA':               1,
            'Pyridoxine HCl':     1,
            'Riboflavin':       0.2,
            'Thiamine HCl':       1,
            'Vitamin B12':     0.005
        }
    },
    mem: {
        name: 'MEM (Minimum Essential Medium)',
        category: 'basic',
        osmolarity: 290,
        ph: 7.4,
        components: {
            'Glucose':          1000,
            'L-Glutamine':      292,
            'NaCl':             6800,
            'KCl':               400,
            'CaCl2':             200,
            'MgSO4':              98,
            'NaH2PO4':           140,
            'NaHCO3':           2200,
            'Phenol Red':         10
        },
        aminoAcids: {
            'L-Arginine':       126,
            'L-Cystine':         24,
            'L-Histidine':       42,
            'L-Isoleucine':      52,
            'L-Leucine':         52,
            'L-Lysine':          73,
            'L-Methionine':      15,
            'L-Phenylalanine':   32,
            'L-Threonine':       48,
            'L-Tryptophan':      10,
            'L-Tyrosine':        52,
            'L-Valine':          46
        },
        vitamins: {
            'Choline Chloride':    1,
            'Folic Acid':          1,
            'myo-Inositol':        2,
            'Niacinamide':         1,
            'D-Pantothenate':      1,
            'Pyridoxal HCl':      1,
            'Riboflavin':        0.1,
            'Thiamine HCl':        1
        }
    },
    f12: {
        name: 'Ham\'s F-12',
        category: 'serum-free-capable',
        osmolarity: 300,
        ph: 7.4,
        components: {
            'Glucose':          1802,
            'L-Glutamine':      146,
            'NaCl':             7599,
            'KCl':               224,
            'CaCl2':              33,
            'MgCl2':              57,
            'Na2HPO4':           142,
            'NaHCO3':           1176,
            'Hypoxanthine':      4.1,
            'Thymidine':        0.73,
            'Phenol Red':        1.2
        },
        aminoAcids: {
            'L-Alanine':        8.9,
            'L-Arginine':       211,
            'L-Asparagine':     15.0,
            'L-Aspartic Acid':  13.3,
            'L-Cysteine':      35.1,
            'L-Glutamic Acid':  14.7,
            'Glycine':           7.5,
            'L-Histidine':      21.0,
            'L-Isoleucine':      3.9,
            'L-Leucine':        13.1,
            'L-Lysine':         36.5,
            'L-Methionine':      4.5,
            'L-Phenylalanine':   5.0,
            'L-Proline':        34.5,
            'L-Serine':         10.5,
            'L-Threonine':      11.9,
            'L-Tryptophan':      2.0,
            'L-Tyrosine':        5.4,
            'L-Valine':         11.7
        },
        vitamins: {
            'Biotin':         0.0073,
            'Choline Chloride': 14.0,
            'Folic Acid':       1.3,
            'myo-Inositol':    18.0,
            'Niacinamide':    0.037,
            'D-Pantothenate':  0.48,
            'Pyridoxine HCl': 0.062,
            'Riboflavin':    0.038,
            'Thiamine HCl':  0.34,
            'Vitamin B12':   1.36,
            'Lipoic Acid':   0.21
        }
    }
};

// ── Common supplements ─────────────────────────────────────────────
var SUPPLEMENT_DB = {
    'fbs':        { name: 'Fetal Bovine Serum',     typicalPercent: 10, osmContrib: 5  },
    'pen/strep':  { name: 'Penicillin/Streptomycin', typicalPercent: 1,  osmContrib: 0.5 },
    'l-glutamine':{ name: 'L-Glutamine (200 mM)',    typicalPercent: 1,  osmContrib: 2  },
    'glutamax':   { name: 'GlutaMAX',               typicalPercent: 1,  osmContrib: 1.5 },
    'hepes':      { name: 'HEPES Buffer (1 M)',      typicalPercent: 1,  osmContrib: 3  },
    'neaa':       { name: 'Non-Essential Amino Acids', typicalPercent: 1, osmContrib: 1 },
    'sodium pyruvate': { name: 'Sodium Pyruvate (100 mM)', typicalPercent: 1, osmContrib: 0.5 },
    'bme':        { name: 'β-Mercaptoethanol',       typicalPercent: 0.1, osmContrib: 0 },
    'fungizone':  { name: 'Amphotericin B',          typicalPercent: 0.5, osmContrib: 0 },
    'gentamicin': { name: 'Gentamicin (50 mg/mL)',   typicalPercent: 0.1, osmContrib: 0 }
};

// ── Cell type nutrient requirements ────────────────────────────────
var CELL_REQUIREMENTS = {
    'hela':       { preferredMedia: ['dmem'], glucoseNeed: 'high', glutamineNeed: 'high', serumPercent: 10, notes: 'Adherent, fast-growing cervical carcinoma', extras: [] },
    'hek293':     { preferredMedia: ['dmem'], glucoseNeed: 'high', glutamineNeed: 'high', serumPercent: 10, notes: 'Adherent, easy to transfect', extras: [] },
    'cho':        { preferredMedia: ['f12', 'dmem'], glucoseNeed: 'medium', glutamineNeed: 'high', serumPercent: 10, notes: 'Can adapt to serum-free; common for recombinant proteins', extras: ['CHO cells can be adapted to serum-free media for protein production'] },
    'jurkat':     { preferredMedia: ['rpmi1640'], glucoseNeed: 'medium', glutamineNeed: 'high', serumPercent: 10, notes: 'Suspension T-cell lymphoma', extras: [] },
    'hybridoma':  { preferredMedia: ['rpmi1640'], glucoseNeed: 'medium', glutamineNeed: 'high', serumPercent: 10, notes: 'Suspension, antibody-producing', extras: [] },
    'nih3t3':     { preferredMedia: ['dmem'], glucoseNeed: 'high', glutamineNeed: 'medium', serumPercent: 10, notes: 'Adherent mouse fibroblast', extras: [] },
    'mcf7':       { preferredMedia: ['dmem', 'mem'], glucoseNeed: 'high', glutamineNeed: 'medium', serumPercent: 10, notes: 'Adherent breast cancer; may need insulin', extras: ['Consider adding 10 \u00b5g/mL insulin for optimal growth'] },
    'vero':       { preferredMedia: ['dmem', 'mem'], glucoseNeed: 'medium', glutamineNeed: 'medium', serumPercent: 5, notes: 'Adherent kidney epithelial; virus production', extras: [] },
    'primary':    { preferredMedia: ['dmem', 'f12'], glucoseNeed: 'medium', glutamineNeed: 'medium', serumPercent: 15, notes: 'Primary cells often need higher serum + growth factors', extras: [] },
    'stem':       { preferredMedia: ['dmem'], glucoseNeed: 'high', glutamineNeed: 'high', serumPercent: 15, notes: 'May need LIF, bFGF, or other stemness factors', extras: ['Add LIF (mouse ESCs) or bFGF (human ESCs) to maintain stemness', 'Consider feeder cells or Matrigel coating'] }
};

function resolveMedia(key) {
    var k = key.toLowerCase().replace(/[\s\-\']/g, '');
    if (MEDIA_DB[k]) return { key: k, data: MEDIA_DB[k] };
    // Try partial match
    var keys = Object.keys(MEDIA_DB);
    for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf(k) !== -1 || MEDIA_DB[keys[i]].name.toLowerCase().indexOf(k) !== -1) {
            return { key: keys[i], data: MEDIA_DB[keys[i]] };
        }
    }
    throw new Error('Unknown medium "' + key + '". Use listMedia() to see available options.');
}

function createMediaOptimizer() {
    return {
        /**
         * List all available basal media formulations.
         */
        listMedia: function () {
            var result = [];
            var keys = Object.keys(MEDIA_DB);
            for (var i = 0; i < keys.length; i++) {
                var m = MEDIA_DB[keys[i]];
                result.push({
                    key: keys[i],
                    name: m.name,
                    category: m.category,
                    osmolarity: m.osmolarity,
                    ph: m.ph,
                    componentCount: Object.keys(m.components).length +
                                   Object.keys(m.aminoAcids).length +
                                   Object.keys(m.vitamins).length
                });
            }
            return result;
        },

        /**
         * Get the full formulation of a medium (components, amino acids, vitamins).
         */
        getFormulation: function (medium) {
            var resolved = resolveMedia(medium);
            return {
                key: resolved.key,
                name: resolved.data.name,
                category: resolved.data.category,
                osmolarity: resolved.data.osmolarity,
                ph: resolved.data.ph,
                components: resolved.data.components,
                aminoAcids: resolved.data.aminoAcids,
                vitamins: resolved.data.vitamins
            };
        },

        /**
         * Calculate supplement volumes for a given total preparation volume.
         *
         * @param {Object} opts
         * @param {number} opts.totalMl - Total volume to prepare
         * @param {Array}  opts.supplements - [{name, percent}]
         * @returns {Object} Volumes of each supplement and basal medium
         */
        supplementVolumes: function (opts) {
            var totalMl = opts.totalMl;
            if (!totalMl || totalMl <= 0) throw new Error('totalMl must be positive.');
            var supplements = opts.supplements || [];

            var totalSupplementPercent = 0;
            var items = [];

            for (var i = 0; i < supplements.length; i++) {
                var s = supplements[i];
                var pct = s.percent;
                var volMl = round(totalMl * pct / 100);
                totalSupplementPercent += pct;
                items.push({
                    name: s.name,
                    percent: pct,
                    volumeMl: volMl
                });
            }

            if (totalSupplementPercent >= 100) {
                throw new Error('Total supplement percentage (' + totalSupplementPercent + '%) must be < 100%.');
            }

            var basalMl = round(totalMl * (100 - totalSupplementPercent) / 100);

            return {
                totalMl: totalMl,
                basalMediumMl: basalMl,
                supplements: items,
                totalSupplementPercent: round(totalSupplementPercent),
                notes: 'Add supplements to basal medium under sterile conditions. Mix gently.'
            };
        },

        /**
         * Estimate final osmolarity after adding supplements to a basal medium.
         */
        estimateOsmolarity: function (medium, supplements) {
            var resolved = resolveMedia(medium);
            var baseOsm = resolved.data.osmolarity;
            var totalContrib = 0;

            if (supplements) {
                for (var i = 0; i < supplements.length; i++) {
                    var s = supplements[i];
                    var key = s.name.toLowerCase().replace(/[\s\-]/g, '');
                    var entry = SUPPLEMENT_DB[key];
                    var pct = s.percent || (entry ? entry.typicalPercent : 0);
                    var contrib = entry ? entry.osmContrib * pct : 0;
                    totalContrib += contrib;
                }
            }

            var finalOsm = round(baseOsm + totalContrib);
            var status = finalOsm >= 260 && finalOsm <= 340 ? 'OK' : 'WARNING';

            return {
                medium: resolved.data.name,
                baseOsmolarity: baseOsm,
                supplementContribution: round(totalContrib),
                estimatedOsmolarity: finalOsm,
                unit: 'mOsm/kg',
                idealRange: '260-340 mOsm/kg',
                status: status,
                warning: status === 'WARNING' ?
                    'Osmolarity outside ideal range. May cause cell stress or lysis.' : null
            };
        },

        /**
         * Nutrient gap analysis: compare a medium to cell-type requirements.
         */
        nutrientGap: function (opts) {
            var resolved = resolveMedia(opts.medium);
            var cellKey = (opts.cellType || '').toLowerCase().replace(/[\s\-]/g, '');
            var cellReq = CELL_REQUIREMENTS[cellKey];

            if (!cellReq) {
                var available = Object.keys(CELL_REQUIREMENTS).sort();
                throw new Error('Unknown cell type "' + opts.cellType +
                    '". Available: ' + available.join(', '));
            }

            var warnings = [];
            var recommendations = [];

            // Check medium compatibility
            if (cellReq.preferredMedia.indexOf(resolved.key) === -1) {
                warnings.push('Medium "' + resolved.data.name + '" is not typically used for ' +
                    opts.cellType + '. Preferred: ' + cellReq.preferredMedia.join(', '));
            }

            // Glucose check
            var glucose = resolved.data.components['Glucose'] || 0;
            if (cellReq.glucoseNeed === 'high' && glucose < 4000) {
                warnings.push('Low glucose (' + glucose + ' mg/L) for high-glucose-demand cells. Consider DMEM high-glucose (4500 mg/L).');
            }

            // Glutamine check
            var glut = resolved.data.components['L-Glutamine'] || 0;
            if (cellReq.glutamineNeed === 'high' && glut < 400) {
                recommendations.push('Supplement with additional L-Glutamine or GlutaMAX (more stable). Current: ' + glut + ' mg/L.');
            }

            // Serum recommendation
            recommendations.push('Recommended FBS: ' + cellReq.serumPercent + '%');

            // Standard supplement suggestions
            recommendations.push('Add 1% Pen/Strep for contamination prevention');

            // Cell-type-specific extras from the requirements database
            var extras = cellReq.extras || [];
            for (var j = 0; j < extras.length; j++) {
                recommendations.push(extras[j]);
            }

            return {
                medium: resolved.data.name,
                cellType: opts.cellType,
                cellNotes: cellReq.notes,
                compatible: cellReq.preferredMedia.indexOf(resolved.key) !== -1,
                warnings: warnings,
                recommendations: recommendations
            };
        },

        /**
         * Compare two media formulations side by side.
         */
        compareMedia: function (medium1, medium2) {
            var m1 = resolveMedia(medium1);
            var m2 = resolveMedia(medium2);

            var allComponents = {};
            var addComponents = function (src, label) {
                var keys = Object.keys(src);
                for (var i = 0; i < keys.length; i++) {
                    if (!allComponents[keys[i]]) allComponents[keys[i]] = {};
                    allComponents[keys[i]][label] = src[keys[i]];
                }
            };

            addComponents(m1.data.components, m1.key);
            addComponents(m1.data.aminoAcids, m1.key);
            addComponents(m1.data.vitamins, m1.key);
            addComponents(m2.data.components, m2.key);
            addComponents(m2.data.aminoAcids, m2.key);
            addComponents(m2.data.vitamins, m2.key);

            var comparison = [];
            var componentNames = Object.keys(allComponents).sort();
            for (var i = 0; i < componentNames.length; i++) {
                var name = componentNames[i];
                var v1 = allComponents[name][m1.key] || 0;
                var v2 = allComponents[name][m2.key] || 0;
                var diff = v1 - v2;
                comparison.push({
                    component: name,
                    inFirst: v1,
                    inSecond: v2,
                    difference: round(diff),
                    unit: 'mg/L'
                });
            }

            return {
                first: { key: m1.key, name: m1.data.name },
                second: { key: m2.key, name: m2.data.name },
                osmolarityDiff: m1.data.osmolarity - m2.data.osmolarity,
                components: comparison,
                onlyInFirst: comparison.filter(function (c) { return c.inFirst > 0 && c.inSecond === 0; })
                    .map(function (c) { return c.component; }),
                onlyInSecond: comparison.filter(function (c) { return c.inFirst === 0 && c.inSecond > 0; })
                    .map(function (c) { return c.component; })
            };
        },

        /**
         * List available supplements with typical usage.
         */
        listSupplements: function () {
            var result = [];
            var keys = Object.keys(SUPPLEMENT_DB).sort();
            for (var i = 0; i < keys.length; i++) {
                var s = SUPPLEMENT_DB[keys[i]];
                result.push({
                    key: keys[i],
                    name: s.name,
                    typicalPercent: s.typicalPercent
                });
            }
            return result;
        },

        /**
         * List supported cell types for nutrient gap analysis.
         */
        listCellTypes: function () {
            var result = [];
            var keys = Object.keys(CELL_REQUIREMENTS).sort();
            for (var i = 0; i < keys.length; i++) {
                var c = CELL_REQUIREMENTS[keys[i]];
                result.push({
                    key: keys[i],
                    preferredMedia: c.preferredMedia,
                    serumPercent: c.serumPercent,
                    notes: c.notes
                });
            }
            return result;
        }
    };
}

exports.createMediaOptimizer = createMediaOptimizer;
