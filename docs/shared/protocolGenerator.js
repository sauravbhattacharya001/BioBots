'use strict';

/**
 * BioBots Protocol Generator
 *
 * Generates step-by-step bioprinting protocols based on material,
 * cell type, construct geometry, and print parameters. Outputs
 * structured protocol objects with timing, materials list, safety
 * notes, and quality checkpoints.
 *
 * @module protocolGenerator
 */

/* ── Material database ─────────────────────────────────────── */

var BIOINK_DB = {
    alginate: {
        prepTemp: 25, mixTime: 10, restTime: 5,
        crosslinker: 'CaCl2', crosslinkConc: '100 mM',
        crosslinkTime: 5, sterilization: 'autoclave',
        storageTemp: '4°C', shelfLife: '7 days',
        notes: 'Gentle mixing to avoid air bubbles.'
    },
    gelatin: {
        prepTemp: 37, mixTime: 15, restTime: 10,
        crosslinker: 'Transglutaminase', crosslinkConc: '10 U/mL',
        crosslinkTime: 30, sterilization: 'filter (0.22 µm)',
        storageTemp: '4°C', shelfLife: '3 days',
        notes: 'Keep above 30°C during printing to prevent premature gelation.'
    },
    'gelma': {
        prepTemp: 37, mixTime: 15, restTime: 10,
        crosslinker: 'UV (405 nm)', crosslinkConc: 'LAP 0.05% w/v',
        crosslinkTime: 2, sterilization: 'filter (0.22 µm)',
        storageTemp: '4°C (dark)', shelfLife: '5 days',
        notes: 'Light-sensitive — prepare under amber lighting.'
    },
    collagen: {
        prepTemp: 4, mixTime: 20, restTime: 15,
        crosslinker: 'Thermal (37°C)', crosslinkConc: 'N/A',
        crosslinkTime: 30, sterilization: 'filter (0.22 µm)',
        storageTemp: '4°C', shelfLife: '5 days',
        notes: 'Keep on ice until printing. Neutralize pH to 7.4 before use.'
    },
    'hyaluronic acid': {
        prepTemp: 25, mixTime: 20, restTime: 10,
        crosslinker: 'PEGDA + UV', crosslinkConc: '0.1% w/v Irgacure',
        crosslinkTime: 5, sterilization: 'filter (0.22 µm)',
        storageTemp: '4°C', shelfLife: '14 days',
        notes: 'High viscosity — use wide-bore tips for mixing.'
    },
    fibrin: {
        prepTemp: 25, mixTime: 5, restTime: 2,
        crosslinker: 'Thrombin', crosslinkConc: '50 U/mL',
        crosslinkTime: 10, sterilization: 'filter (0.22 µm)',
        storageTemp: '-20°C', shelfLife: '30 days (frozen)',
        notes: 'Rapid gelation — mix fibrinogen and thrombin immediately before printing.'
    }
};

var CELL_PROTOCOLS = {
    'chondrocytes': {
        density: '5-10 × 10⁶ cells/mL', medium: 'DMEM + 10% FBS',
        trypsinTime: 5, centrifugeG: 300, resuspendVol: 'minimal',
        notes: 'Passage 2-4 recommended for cartilage phenotype.'
    },
    'mscs': {
        density: '1-5 × 10⁶ cells/mL', medium: 'α-MEM + 10% FBS',
        trypsinTime: 3, centrifugeG: 200, resuspendVol: 'minimal',
        notes: 'Verify tri-lineage differentiation potential before use.'
    },
    'fibroblasts': {
        density: '2-5 × 10⁶ cells/mL', medium: 'DMEM + 10% FBS',
        trypsinTime: 3, centrifugeG: 300, resuspendVol: 'minimal',
        notes: 'Robust cell type — tolerates a range of bioinks.'
    },
    'hepatocytes': {
        density: '5-20 × 10⁶ cells/mL', medium: 'Williams E + supplements',
        trypsinTime: 0, centrifugeG: 50, resuspendVol: 'gentle',
        notes: 'Use collagenase perfusion for isolation. Very shear-sensitive.'
    },
    'ipsc': {
        density: '5-10 × 10⁶ cells/mL', medium: 'mTeSR1',
        trypsinTime: 0, centrifugeG: 200, resuspendVol: 'gentle',
        notes: 'Use Accutase. Add ROCK inhibitor (Y-27632) 1h before harvesting.'
    },
    'keratinocytes': {
        density: '2-5 × 10⁶ cells/mL', medium: 'KGM-2',
        trypsinTime: 5, centrifugeG: 200, resuspendVol: 'minimal',
        notes: 'Passage 2-3 for best stratification capacity.'
    },
    'generic': {
        density: '1-10 × 10⁶ cells/mL', medium: 'Complete growth medium',
        trypsinTime: 5, centrifugeG: 300, resuspendVol: 'minimal',
        notes: 'Adjust parameters based on specific cell type.'
    }
};

var CONSTRUCT_PRESETS = {
    'disk': { layers: 10, infill: 60, pattern: 'rectilinear', desc: 'Flat disk construct' },
    'tube': { layers: 20, infill: 30, pattern: 'concentric', desc: 'Tubular/vascular construct' },
    'cube': { layers: 15, infill: 80, pattern: 'grid', desc: 'Solid cubic block' },
    'sheet': { layers: 3, infill: 100, pattern: 'rectilinear', desc: 'Thin planar sheet' },
    'scaffold': { layers: 25, infill: 40, pattern: 'honeycomb', desc: 'Porous scaffold' },
    'custom': { layers: 10, infill: 50, pattern: 'rectilinear', desc: 'Custom construct' }
};

/* ── Helpers ────────────────────────────────────────────────── */

function lookup(key, db) {
    if (!key) return null;
    var k = String(key).toLowerCase().trim();
    return db[k] || null;
}

function minutesToHuman(min) {
    if (min < 1) return 'seconds';
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60);
    var m = min % 60;
    return m ? h + 'h ' + m + 'min' : h + 'h';
}

function estimatePrintTime(layers, infill) {
    // rough: 2 min per layer base, scaled by infill %
    return Math.round(layers * 2 * (infill / 100) + layers * 0.5);
}

/* ── Protocol Generator ────────────────────────────────────── */

/**
 * Generate a complete bioprinting protocol.
 *
 * @param {Object} params
 * @param {string} params.material - Bioink material name.
 * @param {string} [params.cellType='generic'] - Cell type.
 * @param {string} [params.construct='disk'] - Construct geometry preset.
 * @param {number} [params.nozzleDiameter=0.41] - Nozzle inner diameter (mm).
 * @param {number} [params.pressure=20] - Extrusion pressure (kPa).
 * @param {number} [params.temperature=25] - Print temperature (°C).
 * @param {number} [params.speed=5] - Print speed (mm/s).
 * @param {number} [params.layerHeight=0.2] - Layer height (mm).
 * @param {string} [params.wellplate='6-well'] - Culture vessel.
 * @param {string} [params.projectName='Untitled'] - Protocol title.
 * @returns {Object} Protocol object with steps, materials, timing, safety.
 */
function generateProtocol(params) {
    if (!params || !params.material) {
        throw new Error('material is required');
    }

    var mat = lookup(params.material, BIOINK_DB);
    if (!mat) {
        throw new Error('Unknown material: ' + params.material +
            '. Available: ' + Object.keys(BIOINK_DB).join(', '));
    }

    var cellKey = (params.cellType || 'generic').toLowerCase().trim();
    var cell = CELL_PROTOCOLS[cellKey] || CELL_PROTOCOLS['generic'];

    var constructKey = (params.construct || 'disk').toLowerCase().trim();
    var construct = CONSTRUCT_PRESETS[constructKey] || CONSTRUCT_PRESETS['custom'];

    var nozzle = params.nozzleDiameter || 0.41;
    var pressure = params.pressure || 20;
    var temp = params.temperature || mat.prepTemp || 25;
    var speed = params.speed || 5;
    var layerH = params.layerHeight || 0.2;
    var well = params.wellplate || '6-well';
    var project = params.projectName || 'Untitled';

    var printTime = estimatePrintTime(construct.layers, construct.infill);
    var totalTime = mat.mixTime + mat.restTime + 15 + cell.trypsinTime +
        10 + 5 + printTime + mat.crosslinkTime + 10;

    var steps = [];
    var stepNum = 0;

    function addStep(phase, title, details, duration, checkpoint) {
        stepNum++;
        var s = {
            step: stepNum, phase: phase, title: title,
            details: details, duration: duration
        };
        if (checkpoint) s.checkpoint = checkpoint;
        steps.push(s);
    }

    /* Phase 1: Preparation */
    addStep('Preparation', 'Workspace Setup',
        'Clean biosafety cabinet with 70% ethanol. UV sterilize for 15 min. ' +
        'Lay out sterile supplies: pipettes, tips, ' + well + ' plates, ' +
        nozzle + ' mm nozzle cartridges.',
        '15 min',
        'BSC airflow indicator green, UV cycle complete');

    addStep('Preparation', 'Bioink Preparation',
        'Prepare ' + params.material + ' bioink. Sterilize via ' + mat.sterilization + '. ' +
        'Warm/cool to ' + mat.prepTemp + '°C. Mix for ' + mat.mixTime + ' min. ' +
        'Rest for ' + mat.restTime + ' min to remove bubbles. ' + mat.notes,
        minutesToHuman(mat.mixTime + mat.restTime),
        'No visible air bubbles, homogeneous consistency');

    /* Phase 2: Cell Preparation */
    if (cellKey !== 'generic' || params.cellType) {
        addStep('Cell Preparation', 'Cell Harvesting',
            'Aspirate medium from culture flask. Wash 2× with PBS. ' +
            (cell.trypsinTime > 0
                ? 'Add trypsin-EDTA, incubate ' + cell.trypsinTime + ' min at 37°C. Neutralize with medium.'
                : 'Detach using enzyme-free dissociation reagent per cell-type protocol.') +
            ' Collect suspension.',
            minutesToHuman(cell.trypsinTime + 5));

        addStep('Cell Preparation', 'Cell Counting & Resuspension',
            'Centrifuge at ' + cell.centrifugeG + ' × g for 5 min. ' +
            'Aspirate supernatant. Resuspend in ' + cell.resuspendVol + ' volume of ' +
            cell.medium + '. Count cells — target density: ' + cell.density + '. ' +
            'Adjust volume. ' + cell.notes,
            '10 min',
            'Viability ≥ 90% by trypan blue exclusion');
    }

    /* Phase 3: Bioink-Cell Mixing */
    addStep('Mixing', 'Combine Cells + Bioink',
        'Gently fold cell suspension into prepared bioink using a spatula or wide-bore pipette. ' +
        'Mix until homogeneous (avoid vortexing — shear kills cells). ' +
        'Load into ' + nozzle + ' mm print cartridge. Cap and keep at ' + temp + '°C.',
        '5 min',
        'Uniform cell distribution, no clumps visible');

    /* Phase 4: Printer Setup */
    addStep('Printer Setup', 'Calibrate Printer',
        'Power on bioprinter. Load ' + nozzle + ' mm nozzle cartridge. ' +
        'Set bed temperature if needed. Calibrate Z-height. ' +
        'Set extrusion pressure to ' + pressure + ' kPa, speed to ' + speed + ' mm/s. ' +
        'Set layer height to ' + layerH + ' mm.',
        '5 min',
        'Test extrusion — continuous filament with no dripping');

    addStep('Printer Setup', 'Load Print File',
        'Load ' + construct.desc + ' G-code/design file. ' +
        'Parameters: ' + construct.layers + ' layers, ' + construct.infill + '% infill, ' +
        construct.pattern + ' pattern. ' +
        'Place sterile ' + well + ' plate on print bed.',
        '2 min');

    /* Phase 5: Printing */
    addStep('Printing', 'Execute Print',
        'Start print. Monitor first 3 layers for adhesion and filament quality. ' +
        'Maintain ' + temp + '°C environment. Estimated print time: ' + minutesToHuman(printTime) + '.',
        minutesToHuman(printTime),
        'Consistent strand width, no skipping or pooling');

    /* Phase 6: Post-Processing */
    addStep('Post-Processing', 'Crosslinking',
        'Apply crosslinker: ' + mat.crosslinker + ' (' + mat.crosslinkConc + '). ' +
        'Incubate for ' + mat.crosslinkTime + ' min at room temperature (or per protocol). ' +
        'Remove excess crosslinker by washing 2× with PBS.',
        minutesToHuman(mat.crosslinkTime + 5),
        'Construct maintains shape after crosslinker removal');

    addStep('Post-Processing', 'Culture Setup',
        'Add pre-warmed ' + cell.medium + ' to ' + well + ' plate wells. ' +
        'Transfer to incubator at 37°C, 5% CO₂. ' +
        'First medium change at 24h, then every 48h.',
        '5 min');

    addStep('Post-Processing', 'Documentation',
        'Record: material lot #, cell passage #, print parameters, ' +
        'crosslink duration, construct dimensions, any observations. ' +
        'Photograph constructs. Label plates with date and project: ' + project + '.',
        '5 min');

    /* Materials list */
    var materials = [
        { item: params.material + ' bioink', spec: 'Sterile, ' + mat.storageTemp },
        { item: mat.crosslinker, spec: mat.crosslinkConc },
        { item: cell.medium, spec: 'Pre-warmed to 37°C' },
        { item: 'PBS', spec: 'Sterile, Ca²⁺/Mg²⁺ free' },
        { item: well + ' plate', spec: 'Sterile, tissue-culture treated' },
        { item: 'Print cartridge', spec: nozzle + ' mm ID' },
        { item: '70% Ethanol', spec: 'For surface decontamination' },
        { item: 'Pipettes & tips', spec: 'Sterile, various sizes' }
    ];

    if (cell.trypsinTime > 0) {
        materials.push({ item: 'Trypsin-EDTA (0.25%)', spec: 'Pre-warmed' });
    }

    /* Safety */
    var safety = [
        'Wear lab coat, gloves, and safety glasses at all times.',
        'Work in certified BSC (Class II, Type A2) for cell handling.',
        'Dispose of sharps in designated containers.',
        'Decontaminate spills with 10% bleach, 30 min contact time.',
        'Follow institutional biosafety committee (IBC) protocols.'
    ];

    if (mat.crosslinker.indexOf('UV') >= 0) {
        safety.push('UV crosslinking: wear UV-blocking eyewear. Minimize skin exposure.');
    }

    return {
        title: project + ' — Bioprinting Protocol',
        material: params.material,
        cellType: cellKey,
        construct: constructKey,
        parameters: {
            nozzleDiameter: nozzle,
            pressure: pressure,
            temperature: temp,
            speed: speed,
            layerHeight: layerH,
            wellplate: well,
            layers: construct.layers,
            infill: construct.infill,
            pattern: construct.pattern
        },
        estimatedTime: minutesToHuman(totalTime),
        totalMinutes: totalTime,
        steps: steps,
        materials: materials,
        safety: safety,
        generatedAt: new Date().toISOString()
    };
}

/**
 * Format a protocol object as plain text.
 *
 * @param {Object} protocol - Protocol from generateProtocol().
 * @returns {string} Formatted text protocol.
 */
function formatProtocolText(protocol) {
    var lines = [];
    lines.push('═══════════════════════════════════════════════════');
    lines.push('  ' + protocol.title);
    lines.push('═══════════════════════════════════════════════════');
    lines.push('');
    lines.push('Material: ' + protocol.material + '  |  Cells: ' + protocol.cellType +
        '  |  Construct: ' + protocol.construct);
    lines.push('Estimated Total Time: ' + protocol.estimatedTime);
    lines.push('Generated: ' + protocol.generatedAt);
    lines.push('');

    lines.push('─── PARAMETERS ────────────────────────────────────');
    var p = protocol.parameters;
    lines.push('  Nozzle: ' + p.nozzleDiameter + ' mm  |  Pressure: ' + p.pressure + ' kPa');
    lines.push('  Speed: ' + p.speed + ' mm/s  |  Layer Height: ' + p.layerHeight + ' mm');
    lines.push('  Layers: ' + p.layers + '  |  Infill: ' + p.infill + '%  |  Pattern: ' + p.pattern);
    lines.push('  Vessel: ' + p.wellplate);
    lines.push('');

    lines.push('─── MATERIALS CHECKLIST ────────────────────────────');
    for (var m = 0; m < protocol.materials.length; m++) {
        lines.push('  ☐ ' + protocol.materials[m].item + ' — ' + protocol.materials[m].spec);
    }
    lines.push('');

    lines.push('─── SAFETY NOTES ──────────────────────────────────');
    for (var s = 0; s < protocol.safety.length; s++) {
        lines.push('  ⚠ ' + protocol.safety[s]);
    }
    lines.push('');

    lines.push('─── PROTOCOL STEPS ────────────────────────────────');
    var currentPhase = '';
    for (var i = 0; i < protocol.steps.length; i++) {
        var step = protocol.steps[i];
        if (step.phase !== currentPhase) {
            currentPhase = step.phase;
            lines.push('');
            lines.push('  ┌─ ' + currentPhase.toUpperCase() + ' ─┐');
        }
        lines.push('  Step ' + step.step + ': ' + step.title + ' (' + step.duration + ')');
        lines.push('    ' + step.details);
        if (step.checkpoint) {
            lines.push('    ✓ Checkpoint: ' + step.checkpoint);
        }
    }

    lines.push('');
    lines.push('═══════════════════════════════════════════════════');
    return lines.join('\n');
}

/**
 * List available materials.
 * @returns {string[]}
 */
function listMaterials() {
    return Object.keys(BIOINK_DB);
}

/**
 * List available cell types.
 * @returns {string[]}
 */
function listCellTypes() {
    return Object.keys(CELL_PROTOCOLS);
}

/**
 * List available construct presets.
 * @returns {string[]}
 */
function listConstructs() {
    return Object.keys(CONSTRUCT_PRESETS);
}

/**
 * Factory function that returns a new ProtocolGenerator instance.
 * Follows the same pattern as other BioBots modules (createMaterialCalculator, etc.).
 *
 * @returns {Object} ProtocolGenerator with generateProtocol, formatProtocolText, listMaterials, listCellTypes, listConstructs.
 */
function createProtocolGenerator() {
    return {
        generateProtocol: generateProtocol,
        formatProtocolText: formatProtocolText,
        listMaterials: listMaterials,
        listCellTypes: listCellTypes,
        listConstructs: listConstructs,
        BIOINK_DB: BIOINK_DB,
        CELL_PROTOCOLS: CELL_PROTOCOLS,
        CONSTRUCT_PRESETS: CONSTRUCT_PRESETS
    };
}

module.exports = {
    createProtocolGenerator: createProtocolGenerator,
    generateProtocol: generateProtocol,
    formatProtocolText: formatProtocolText,
    listMaterials: listMaterials,
    listCellTypes: listCellTypes,
    listConstructs: listConstructs,
    BIOINK_DB: BIOINK_DB,
    CELL_PROTOCOLS: CELL_PROTOCOLS,
    CONSTRUCT_PRESETS: CONSTRUCT_PRESETS
};
