/**
 * Protocol Template Library
 *
 * Provides pre-built, customizable protocol templates for common
 * bioprinting workflows: cell culture, bioink preparation, printing,
 * post-processing, and quality control. Each template includes
 * step-by-step instructions, timing, materials, and safety notes.
 *
 * Users can list available templates, retrieve them, customize
 * parameters, and export as structured JSON or Markdown.
 *
 * @example
 *   var lib = require('./protocolTemplates');
 *   var mgr = lib.createProtocolTemplateLibrary();
 *   var names = mgr.listTemplates();
 *   var proto = mgr.getTemplate('cell-thawing');
 *   var custom = mgr.customize('bioink-prep-alginate', { concentration: 3.0 });
 *   var md = mgr.exportMarkdown('cell-thawing');
 */

'use strict';

/* ------------------------------------------------------------------ */
/*  Built-in Protocol Templates                                        */
/* ------------------------------------------------------------------ */

var _sanitize = require('./sanitize');
var _deepClone = _sanitize.deepClone;
var _isDangerousKey = _sanitize.isDangerousKey;

var TEMPLATES = {
    'cell-thawing': {
        name: 'Cell Thawing Protocol',
        category: 'cell-culture',
        description: 'Standard rapid-thaw protocol for cryopreserved cells.',
        estimatedTime: 45,  // minutes
        materials: [
            'Cryovial of frozen cells',
            'Pre-warmed complete growth medium (37°C)',
            'Water bath or bead bath (37°C)',
            '70% ethanol spray',
            '15 mL centrifuge tube',
            'Hemocytometer or cell counter',
            'Trypan blue (0.4%)'
        ],
        steps: [
            { step: 1, action: 'Pre-warm growth medium to 37°C in water bath.', duration: 15, unit: 'min', critical: false },
            { step: 2, action: 'Remove cryovial from liquid nitrogen storage. Note passage number and date.', duration: 1, unit: 'min', critical: true },
            { step: 3, action: 'Thaw vial rapidly in 37°C water bath with gentle agitation until small ice crystal remains.', duration: 2, unit: 'min', critical: true },
            { step: 4, action: 'Spray vial with 70% ethanol and transfer to biosafety cabinet.', duration: 1, unit: 'min', critical: false },
            { step: 5, action: 'Transfer cell suspension to 15 mL tube with 9 mL pre-warmed medium (dropwise).', duration: 2, unit: 'min', critical: false },
            { step: 6, action: 'Centrifuge at 200×g for 5 minutes at room temperature.', duration: 5, unit: 'min', critical: false },
            { step: 7, action: 'Aspirate supernatant carefully without disturbing pellet.', duration: 1, unit: 'min', critical: true },
            { step: 8, action: 'Resuspend pellet gently in fresh medium. Perform viability count with Trypan blue.', duration: 5, unit: 'min', critical: false },
            { step: 9, action: 'Seed cells at recommended density. Record viability, count, and passage number.', duration: 3, unit: 'min', critical: false },
            { step: 10, action: 'Place in incubator (37°C, 5% CO₂). Check attachment after 24h.', duration: 1, unit: 'min', critical: false }
        ],
        safetyNotes: [
            'Wear cryogloves and face shield when handling liquid nitrogen.',
            'Work in certified biosafety cabinet for all open-vial steps.',
            'Dispose of Trypan blue waste in designated hazardous containers.'
        ],
        references: ['Freshney, R.I. Culture of Animal Cells, 7th Ed.']
    },

    'bioink-prep-alginate': {
        name: 'Alginate Bioink Preparation',
        category: 'bioink',
        description: 'Prepare sodium alginate bioink at specified concentration for extrusion bioprinting.',
        estimatedTime: 120,
        parameters: {
            concentration: { value: 2.0, unit: '% w/v', range: [0.5, 5.0] },
            volume: { value: 10, unit: 'mL', range: [1, 100] },
            crosslinker: { value: 'CaCl₂', options: ['CaCl₂', 'BaCl₂', 'SrCl₂'] },
            crosslinkerConc: { value: 100, unit: 'mM', range: [50, 200] }
        },
        materials: [
            'Sodium alginate powder (pharmaceutical grade)',
            'Sterile PBS or cell culture medium',
            'Magnetic stir plate and bar',
            'Sterile syringe and Luer-lock nozzle',
            'Crosslinking solution (CaCl₂)',
            '0.22 µm syringe filter (optional for cell-free inks)'
        ],
        steps: [
            { step: 1, action: 'Weigh sodium alginate powder for target concentration.', duration: 5, unit: 'min', critical: true },
            { step: 2, action: 'Add powder slowly to warm (~50°C) sterile PBS while stirring.', duration: 10, unit: 'min', critical: true },
            { step: 3, action: 'Stir continuously at moderate speed until fully dissolved (no lumps).', duration: 60, unit: 'min', critical: false },
            { step: 4, action: 'Allow solution to cool to room temperature. Degas under vacuum if bubbles present.', duration: 20, unit: 'min', critical: false },
            { step: 5, action: 'If cell-free: filter through 0.22 µm. If cell-laden: autoclave alginate separately before mixing.', duration: 10, unit: 'min', critical: true },
            { step: 6, action: 'Transfer bioink to sterile syringe. Cap with Luer-lock. Store at 4°C or proceed to printing.', duration: 5, unit: 'min', critical: false },
            { step: 7, action: 'Prepare crosslinking bath: dissolve CaCl₂ at target concentration in sterile water.', duration: 5, unit: 'min', critical: false }
        ],
        safetyNotes: [
            'Alginate powder is an inhalation irritant — weigh in fume hood or wear mask.',
            'CaCl₂ is an irritant — wear gloves and eye protection.'
        ],
        references: ['Lee, K.Y. & Mooney, D.J. Alginate: properties and biomedical applications. Prog Polym Sci (2012).']
    },

    'bioprint-extrusion': {
        name: 'Extrusion Bioprinting Run',
        category: 'printing',
        description: 'Standard operating procedure for pneumatic extrusion bioprinting.',
        estimatedTime: 90,
        materials: [
            'Loaded bioink syringe',
            'Sterile nozzle (gauge per bioink viscosity)',
            'Bioprinter (calibrated)',
            'Sterile print substrate (well plate or petri dish)',
            'Crosslinking solution',
            'Temperature-controlled print head (if required)'
        ],
        steps: [
            { step: 1, action: 'Power on bioprinter. Run self-check and calibrate print bed.', duration: 10, unit: 'min', critical: true },
            { step: 2, action: 'Attach nozzle to syringe. Mount in print head. Set temperature if needed.', duration: 5, unit: 'min', critical: false },
            { step: 3, action: 'Prime nozzle: extrude small amount until consistent flow.', duration: 3, unit: 'min', critical: true },
            { step: 4, action: 'Load G-code / design file. Verify layer height and infill match bioink properties.', duration: 5, unit: 'min', critical: true },
            { step: 5, action: 'Place sterile substrate on print bed. Set Z-offset.', duration: 3, unit: 'min', critical: false },
            { step: 6, action: 'Start print. Monitor first 2-3 layers for adhesion and strand quality.', duration: 5, unit: 'min', critical: true },
            { step: 7, action: 'Allow print to complete. Do not open enclosure during printing.', duration: 30, unit: 'min', critical: false },
            { step: 8, action: 'Apply crosslinking solution per protocol. Incubate for specified time.', duration: 15, unit: 'min', critical: true },
            { step: 9, action: 'Gently wash construct to remove excess crosslinker. Transfer to culture medium.', duration: 5, unit: 'min', critical: false },
            { step: 10, action: 'Document print parameters, observations, and initial construct quality.', duration: 5, unit: 'min', critical: false }
        ],
        safetyNotes: [
            'Never reach into printer during operation.',
            'Ensure UV shields are in place if using photo-crosslinking.',
            'All substrate handling in biosafety cabinet.'
        ],
        references: []
    },

    'gelma-photoink': {
        name: 'GelMA Photo-Crosslinkable Bioink Prep',
        category: 'bioink',
        description: 'Prepare gelatin methacrylate (GelMA) bioink with photoinitiator for UV/visible-light crosslinking.',
        estimatedTime: 90,
        parameters: {
            gelmaConc: { value: 5.0, unit: '% w/v', range: [3.0, 15.0] },
            photoinitiator: { value: 'LAP', options: ['LAP', 'Irgacure 2959', 'Eosin Y'] },
            piConc: { value: 0.05, unit: '% w/v', range: [0.01, 0.5] },
            volume: { value: 5, unit: 'mL', range: [1, 50] }
        },
        materials: [
            'GelMA lyophilized powder',
            'Photoinitiator (LAP or Irgacure 2959)',
            'Sterile PBS',
            'Light-shielded tubes (amber or foil-wrapped)',
            '37°C water bath',
            'UV/visible light source (405 nm for LAP)'
        ],
        steps: [
            { step: 1, action: 'Dissolve GelMA powder in warm (40°C) sterile PBS at target concentration. Protect from light.', duration: 30, unit: 'min', critical: true },
            { step: 2, action: 'Add photoinitiator at target concentration. Mix gently — avoid foaming.', duration: 5, unit: 'min', critical: true },
            { step: 3, action: 'Keep solution at 37°C until ready to print (gels below ~25°C).', duration: 5, unit: 'min', critical: true },
            { step: 4, action: 'If cell-laden: mix cell pellet into warm GelMA solution gently.', duration: 5, unit: 'min', critical: true },
            { step: 5, action: 'Load into syringe. Maintain at print temperature (25-37°C depending on setup).', duration: 5, unit: 'min', critical: false },
            { step: 6, action: 'After printing, crosslink by UV/vis exposure per photoinitiator specs.', duration: 2, unit: 'min', critical: true }
        ],
        safetyNotes: [
            'Photoinitiators are light-sensitive — work under amber light or minimal exposure.',
            'Wear UV-blocking eyewear during crosslinking.',
            'Irgacure 2959 requires UV (365 nm) — confirm source compatibility.'
        ],
        references: ['Loessner, D. et al. Functionalization, preparation and use of cell-laden gelatin methacryloyl-based hydrogels. Nat Protoc (2016).']
    },

    'post-print-viability': {
        name: 'Post-Print Cell Viability Assessment',
        category: 'quality-control',
        description: 'Live/Dead assay to assess cell viability in printed constructs.',
        estimatedTime: 60,
        materials: [
            'Printed construct in culture medium',
            'Live/Dead staining kit (Calcein AM / Ethidium homodimer-1)',
            'Sterile PBS',
            'Fluorescence microscope',
            'Image analysis software (ImageJ/FIJI)'
        ],
        steps: [
            { step: 1, action: 'Prepare staining solution: 2 µM Calcein AM + 4 µM EthD-1 in PBS.', duration: 5, unit: 'min', critical: true },
            { step: 2, action: 'Rinse construct gently with warm PBS (×2).', duration: 5, unit: 'min', critical: false },
            { step: 3, action: 'Add staining solution to cover construct. Incubate at 37°C for 30 min, protected from light.', duration: 30, unit: 'min', critical: true },
            { step: 4, action: 'Rinse gently with PBS to remove excess dye.', duration: 3, unit: 'min', critical: false },
            { step: 5, action: 'Image under fluorescence microscope: green (494/517 nm) = live, red (528/617 nm) = dead.', duration: 10, unit: 'min', critical: false },
            { step: 6, action: 'Analyze images: count live/dead cells, calculate viability percentage. Report ≥85% as passing.', duration: 10, unit: 'min', critical: false }
        ],
        safetyNotes: [
            'EthD-1 is a nucleic acid stain — handle with gloves, avoid skin contact.',
            'Dispose of staining waste per institutional chemical waste protocols.'
        ],
        references: ['Molecular Probes LIVE/DEAD Viability/Cytotoxicity Kit manual.']
    },

    'scaffold-decell': {
        name: 'Tissue Decellularization Protocol',
        category: 'scaffold',
        description: 'Detergent-based decellularization to produce ECM scaffold for recellularization or bioprinting.',
        estimatedTime: 2880, // 48 hours
        materials: [
            'Native tissue sample',
            'SDS (0.1-1% w/v) or Triton X-100 (1%)',
            'DNase I solution',
            'Sterile PBS (large volume)',
            'Orbital shaker (4°C)',
            'Peristaltic pump (for perfusion, optional)'
        ],
        steps: [
            { step: 1, action: 'Trim tissue to appropriate size. Rinse in cold PBS.', duration: 15, unit: 'min', critical: false },
            { step: 2, action: 'Immerse in 1% Triton X-100 + 0.1% ammonium hydroxide. Agitate at 4°C.', duration: 1440, unit: 'min', critical: true },
            { step: 3, action: 'Wash extensively in PBS (5× changes over 6 hours) at 4°C.', duration: 360, unit: 'min', critical: true },
            { step: 4, action: 'Treat with DNase I (50 U/mL) at 37°C for 2 hours to remove residual DNA.', duration: 120, unit: 'min', critical: true },
            { step: 5, action: 'Wash in PBS (3× changes over 4 hours).', duration: 240, unit: 'min', critical: false },
            { step: 6, action: 'Verify decellularization: DAPI stain and DNA quantification (<50 ng/mg dry weight).', duration: 60, unit: 'min', critical: true },
            { step: 7, action: 'Store scaffold in sterile PBS + antibiotics at 4°C, or lyophilize for long-term storage.', duration: 5, unit: 'min', critical: false }
        ],
        safetyNotes: [
            'SDS and Triton X-100 are irritants — use in fume hood with gloves.',
            'Handle tissue samples per biosafety level of source organism.',
            'Dispose of detergent waste per institutional chemical waste protocols.'
        ],
        references: ['Crapo, P.M. et al. An overview of tissue and whole organ decellularization processes. Biomaterials (2011).']
    }
};

/* ------------------------------------------------------------------ */
/*  Helper Utilities                                                   */
/* ------------------------------------------------------------------ */

function deepClone(obj) {
    return _deepClone(obj);
}

function totalTime(steps) {
    var sum = 0;
    for (var i = 0; i < steps.length; i++) {
        sum += (steps[i].duration || 0);
    }
    return sum;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

/**
 * Create a Protocol Template Library instance.
 * @returns {object} Library manager with list, get, customize, export methods.
 */
function createProtocolTemplateLibrary() {
    // User-added custom templates stored here
    var customTemplates = {};

    function allTemplates() {
        var merged = {};
        var key;
        for (key in TEMPLATES) { merged[key] = TEMPLATES[key]; }
        for (key in customTemplates) { merged[key] = customTemplates[key]; }
        return merged;
    }

    return {
        /**
         * List all available template IDs with names and categories.
         * @param {string} [category] Optional filter by category.
         * @returns {Array<{id: string, name: string, category: string, estimatedTime: number}>}
         */
        listTemplates: function listTemplates(category) {
            var all = allTemplates();
            var result = [];
            for (var key in all) {
                var t = all[key];
                if (!category || t.category === category) {
                    result.push({
                        id: key,
                        name: t.name,
                        category: t.category,
                        estimatedTime: t.estimatedTime
                    });
                }
            }
            return result.sort(function (a, b) { return a.category < b.category ? -1 : a.category > b.category ? 1 : 0; });
        },

        /**
         * Get a full template by ID.
         * @param {string} id Template identifier.
         * @returns {object|null} Deep clone of the template, or null if not found.
         */
        getTemplate: function getTemplate(id) {
            var all = allTemplates();
            if (!all[id]) { return null; }
            return deepClone(all[id]);
        },

        /**
         * Customize a template's parameters.
         * @param {string} id Template identifier.
         * @param {object} overrides Key/value pairs matching parameter names.
         * @returns {object} Customized deep clone of the template.
         */
        customize: function customize(id, overrides) {
            var tpl = this.getTemplate(id);
            if (!tpl) {
                return { error: 'Template not found: ' + id };
            }
            if (!tpl.parameters) {
                return { error: 'Template ' + id + ' has no customizable parameters.' };
            }
            overrides = overrides || {};
            for (var key in overrides) {
                if (_isDangerousKey(key)) continue;
                if (tpl.parameters[key]) {
                    var param = tpl.parameters[key];
                    var val = overrides[key];
                    if (param.range && (val < param.range[0] || val > param.range[1])) {
                        return { error: key + ' value ' + val + ' out of range [' + param.range[0] + ', ' + param.range[1] + ']' };
                    }
                    if (param.options && param.options.indexOf(val) === -1) {
                        return { error: key + ' value "' + val + '" not in options: ' + param.options.join(', ') };
                    }
                    tpl.parameters[key].value = val;
                }
            }
            return tpl;
        },

        /**
         * Export a template as formatted Markdown.
         * @param {string} id Template identifier.
         * @param {object} [overrides] Optional parameter overrides.
         * @returns {string} Markdown string.
         */
        exportMarkdown: function exportMarkdown(id, overrides) {
            var tpl = overrides ? this.customize(id, overrides) : this.getTemplate(id);
            if (!tpl) { return 'Error: Template not found: ' + id; }
            if (tpl.error) { return 'Error: ' + tpl.error; }

            var lines = [];
            lines.push('# ' + tpl.name);
            lines.push('');
            lines.push('**Category:** ' + tpl.category + '  ');
            lines.push('**Estimated Time:** ' + tpl.estimatedTime + ' minutes  ');
            lines.push('');
            lines.push(tpl.description);
            lines.push('');

            if (tpl.parameters) {
                lines.push('## Parameters');
                lines.push('');
                for (var p in tpl.parameters) {
                    var param = tpl.parameters[p];
                    lines.push('- **' + p + ':** ' + param.value + ' ' + (param.unit || ''));
                }
                lines.push('');
            }

            lines.push('## Materials');
            lines.push('');
            for (var m = 0; m < tpl.materials.length; m++) {
                lines.push('- ' + tpl.materials[m]);
            }
            lines.push('');

            lines.push('## Procedure');
            lines.push('');
            for (var s = 0; s < tpl.steps.length; s++) {
                var step = tpl.steps[s];
                var crit = step.critical ? ' ⚠️ **CRITICAL**' : '';
                lines.push(step.step + '. ' + step.action + ' *(' + step.duration + ' ' + step.unit + ')*' + crit);
            }
            lines.push('');

            var calcTime = totalTime(tpl.steps);
            lines.push('**Total procedure time:** ' + calcTime + ' minutes');
            lines.push('');

            if (tpl.safetyNotes && tpl.safetyNotes.length > 0) {
                lines.push('## ⚠️ Safety Notes');
                lines.push('');
                for (var n = 0; n < tpl.safetyNotes.length; n++) {
                    lines.push('- ' + tpl.safetyNotes[n]);
                }
                lines.push('');
            }

            if (tpl.references && tpl.references.length > 0) {
                lines.push('## References');
                lines.push('');
                for (var r = 0; r < tpl.references.length; r++) {
                    lines.push((r + 1) + '. ' + tpl.references[r]);
                }
                lines.push('');
            }

            return lines.join('\n');
        },

        /**
         * Export a template as structured JSON string.
         * @param {string} id Template identifier.
         * @param {object} [overrides] Optional parameter overrides.
         * @returns {string} JSON string.
         */
        exportJSON: function exportJSON(id, overrides) {
            var tpl = overrides ? this.customize(id, overrides) : this.getTemplate(id);
            if (!tpl) { return JSON.stringify({ error: 'Template not found: ' + id }); }
            if (tpl.error) { return JSON.stringify({ error: tpl.error }); }
            return JSON.stringify(tpl, null, 2);
        },

        /**
         * Add a custom template to the library.
         * @param {string} id Unique identifier.
         * @param {object} template Template object (must have name, category, steps).
         * @returns {object} Result with success boolean.
         */
        addTemplate: function addTemplate(id, template) {
            if (!id || !template) {
                return { success: false, error: 'id and template are required.' };
            }
            if (!template.name || !template.category || !template.steps) {
                return { success: false, error: 'Template must have name, category, and steps.' };
            }
            if (TEMPLATES[id]) {
                return { success: false, error: 'Cannot overwrite built-in template: ' + id };
            }
            customTemplates[id] = deepClone(template);
            return { success: true, id: id };
        },

        /**
         * Get available categories.
         * @returns {string[]} Unique sorted category names.
         */
        listCategories: function listCategories() {
            var all = allTemplates();
            var cats = {};
            for (var key in all) { cats[all[key].category] = true; }
            return Object.keys(cats).sort();
        },

        /**
         * Search templates by keyword in name, description, or materials.
         * @param {string} query Search term (case-insensitive).
         * @returns {Array<{id: string, name: string, category: string, match: string}>}
         */
        search: function search(query) {
            if (!query) { return []; }
            var q = query.toLowerCase();
            var all = allTemplates();
            var results = [];
            for (var key in all) {
                var t = all[key];
                var match = null;
                if (t.name.toLowerCase().indexOf(q) !== -1) { match = 'name'; }
                else if (t.description.toLowerCase().indexOf(q) !== -1) { match = 'description'; }
                else {
                    for (var m = 0; m < t.materials.length; m++) {
                        if (t.materials[m].toLowerCase().indexOf(q) !== -1) { match = 'materials'; break; }
                    }
                }
                if (match) {
                    results.push({ id: key, name: t.name, category: t.category, match: match });
                }
            }
            return results;
        }
    };
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

exports.createProtocolTemplateLibrary = createProtocolTemplateLibrary;
