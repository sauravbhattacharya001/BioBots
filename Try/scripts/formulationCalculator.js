'use strict';

const { round } = require('./scriptUtils');

/**
 * Bioink Formulation Calculator for BioBots
 *
 * Helps researchers design custom bioink formulations by calculating
 * component volumes, concentrations, and mixing ratios for multi-material
 * bioink preparation.
 *
 * Features:
 *   - Stock solution dilution (C1V1 = C2V2)
 *   - Multi-component formulation with target concentrations
 *   - Cell suspension calculations (cells/mL → volume needed)
 *   - Crosslinker concentration planning
 *   - Growth factor dosing from stock solutions
 *   - Volume scaling (scale up/down recipes)
 *   - 8 built-in bioink base recipes
 *   - Viscosity estimation for blends
 *   - Formulation comparison and cost estimation
 *   - Mixing order recommendations
 *   - Formulation persistence (JSON export/import)
 *
 * Usage:
 *   const calc = createFormulationCalculator();
 *   const dilution = calc.dilution({ stockConc: 10, targetConc: 2, targetVolume: 5 });
 *   const formulation = calc.createFormulation({ name: 'My Ink', targetVolume: 10, components: [...] });
 *   const scaled = calc.scaleFormulation(formulation, 2.0);
 */

function createFormulationCalculator() {

    // ── Built-in Base Materials ─────────────────────────────────

    const BASE_MATERIALS = {
        'gelatin-methacrylate': {
            name: 'Gelatin Methacrylate (GelMA)',
            category: 'hydrogel',
            typicalConcentration: { min: 3, max: 15, unit: '% w/v', recommended: 7 },
            viscosityAt37C: 0.8,   // Pa·s at recommended conc
            crosslinkMethod: 'UV',
            storageTemp: 4,
            costPerGram: 2.50,
            notes: 'Photocrosslinkable, good cell compatibility'
        },
        'alginate': {
            name: 'Sodium Alginate',
            category: 'hydrogel',
            typicalConcentration: { min: 1, max: 4, unit: '% w/v', recommended: 2 },
            viscosityAt37C: 0.5,
            crosslinkMethod: 'ionic (CaCl2)',
            storageTemp: 20,
            costPerGram: 0.15,
            notes: 'Ionic crosslinking, rapid gelation'
        },
        'collagen-type-i': {
            name: 'Collagen Type I',
            category: 'protein',
            typicalConcentration: { min: 2, max: 8, unit: 'mg/mL', recommended: 4 },
            viscosityAt37C: 0.3,
            crosslinkMethod: 'thermal (37°C)',
            storageTemp: 4,
            costPerGram: 45.00,
            notes: 'Physiological crosslinking, excellent biocompatibility'
        },
        'hyaluronic-acid': {
            name: 'Hyaluronic Acid (HA)',
            category: 'hydrogel',
            typicalConcentration: { min: 1, max: 5, unit: '% w/v', recommended: 2 },
            viscosityAt37C: 1.2,
            crosslinkMethod: 'UV (methacrylated) or enzymatic',
            storageTemp: 4,
            costPerGram: 8.00,
            notes: 'High viscosity, excellent moisture retention'
        },
        'fibrinogen': {
            name: 'Fibrinogen',
            category: 'protein',
            typicalConcentration: { min: 5, max: 40, unit: 'mg/mL', recommended: 20 },
            viscosityAt37C: 0.15,
            crosslinkMethod: 'enzymatic (thrombin)',
            storageTemp: -20,
            costPerGram: 35.00,
            notes: 'Enzymatic crosslinking, natural wound healing matrix'
        },
        'pluronic-f127': {
            name: 'Pluronic F-127',
            category: 'thermogel',
            typicalConcentration: { min: 15, max: 40, unit: '% w/v', recommended: 25 },
            viscosityAt37C: 15.0,
            crosslinkMethod: 'thermal (reverse gelation)',
            storageTemp: 4,
            costPerGram: 0.80,
            notes: 'Sacrificial support material, reverse thermal gelation'
        },
        'silk-fibroin': {
            name: 'Silk Fibroin',
            category: 'protein',
            typicalConcentration: { min: 3, max: 10, unit: '% w/v', recommended: 6 },
            viscosityAt37C: 0.6,
            crosslinkMethod: 'enzymatic (HRP/H2O2) or sonication',
            storageTemp: 4,
            costPerGram: 12.00,
            notes: 'Excellent mechanical properties, slow degradation'
        },
        'pectin': {
            name: 'Pectin',
            category: 'hydrogel',
            typicalConcentration: { min: 1, max: 5, unit: '% w/v', recommended: 3 },
            viscosityAt37C: 0.4,
            crosslinkMethod: 'ionic (CaCl2)',
            storageTemp: 20,
            costPerGram: 0.20,
            notes: 'Plant-derived, good for drug delivery'
        }
    };

    // ── Common Additives ────────────────────────────────────────

    const COMMON_ADDITIVES = {
        'lap': {
            name: 'Lithium Phenyl-2,4,6-trimethylbenzoylphosphinate (LAP)',
            role: 'photoinitiator',
            typicalConcentration: { min: 0.05, max: 0.5, unit: '% w/v', recommended: 0.1 },
            costPerGram: 85.00,
            notes: 'UV photoinitiator, 365-405nm, less cytotoxic than Irgacure'
        },
        'irgacure-2959': {
            name: 'Irgacure 2959',
            role: 'photoinitiator',
            typicalConcentration: { min: 0.01, max: 0.1, unit: '% w/v', recommended: 0.05 },
            costPerGram: 45.00,
            notes: 'UV photoinitiator, 365nm, widely used but some cytotoxicity'
        },
        'cacl2': {
            name: 'Calcium Chloride (CaCl2)',
            role: 'crosslinker',
            typicalConcentration: { min: 50, max: 200, unit: 'mM', recommended: 100 },
            costPerGram: 0.05,
            notes: 'Ionic crosslinker for alginate/pectin'
        },
        'thrombin': {
            name: 'Thrombin',
            role: 'crosslinker',
            typicalConcentration: { min: 1, max: 10, unit: 'U/mL', recommended: 5 },
            costPerGram: 120.00,
            notes: 'Enzymatic crosslinker for fibrinogen'
        },
        'vegf': {
            name: 'VEGF (Vascular Endothelial Growth Factor)',
            role: 'growth-factor',
            typicalConcentration: { min: 10, max: 100, unit: 'ng/mL', recommended: 50 },
            costPerGram: 25000.00,
            notes: 'Promotes angiogenesis'
        },
        'bmp2': {
            name: 'BMP-2 (Bone Morphogenetic Protein 2)',
            role: 'growth-factor',
            typicalConcentration: { min: 50, max: 500, unit: 'ng/mL', recommended: 200 },
            costPerGram: 18000.00,
            notes: 'Promotes osteogenesis'
        },
        'tgfb1': {
            name: 'TGF-β1',
            role: 'growth-factor',
            typicalConcentration: { min: 1, max: 20, unit: 'ng/mL', recommended: 10 },
            costPerGram: 30000.00,
            notes: 'Promotes chondrogenesis'
        },
        'rgd-peptide': {
            name: 'RGD Peptide',
            role: 'cell-adhesion',
            typicalConcentration: { min: 0.5, max: 5, unit: 'mM', recommended: 2 },
            costPerGram: 350.00,
            notes: 'Enhances cell attachment and spreading'
        }
    };

    // ── Mixing Order Rules ──────────────────────────────────────

    const MIXING_ORDER_PRIORITY = {
        'hydrogel': 1,
        'protein': 2,
        'cell-adhesion': 3,
        'crosslinker': 8,
        'photoinitiator': 7,
        'growth-factor': 6,
        'cells': 9,
        'other': 5
    };

    const MIXING_NOTES = {
        'hydrogel': 'Dissolve polymer fully before adding other components. Use warm media if needed.',
        'protein': 'Add gently, avoid vigorous mixing to prevent denaturation.',
        'photoinitiator': 'Add in low-light conditions. Mix until fully dissolved.',
        'crosslinker': 'Add immediately before printing or in a separate syringe.',
        'growth-factor': 'Add last before cells. Keep on ice.',
        'cell-adhesion': 'Allow conjugation time (30-60 min) before adding cells.',
        'cells': 'Add last. Mix gently by folding, not vortexing. Use immediately.',
        'other': 'Follow manufacturer instructions.'
    };

    // ── Core Dilution Calculator ────────────────────────────────

    /**
     * C1V1 = C2V2 dilution calculator
     * @param {object} params - { stockConc, targetConc, targetVolume }
     * @returns {object} dilution result
     */
    function dilution({ stockConc, targetConc, targetVolume }) {
        if (stockConc == null || targetConc == null || targetVolume == null) {
            throw new Error('dilution requires stockConc, targetConc, and targetVolume');
        }
        if (stockConc <= 0 || targetConc <= 0 || targetVolume <= 0) {
            throw new Error('All values must be positive');
        }
        if (targetConc > stockConc) {
            throw new Error('Target concentration cannot exceed stock concentration');
        }

        const stockVolume = (targetConc * targetVolume) / stockConc;
        const diluent = targetVolume - stockVolume;
        const dilutionFactor = stockConc / targetConc;

        return {
            stockVolume: round(stockVolume, 4),
            diluentVolume: round(diluent, 4),
            totalVolume: round(targetVolume, 4),
            dilutionFactor: round(dilutionFactor, 2),
            stockConc,
            targetConc,
            percentStock: round((stockVolume / targetVolume) * 100, 2)
        };
    }

    /**
     * Serial dilution calculator
     * @param {object} params - { stockConc, dilutionFactor, steps, volumePerStep }
     * @returns {object[]} array of dilution steps
     */
    function serialDilution({ stockConc, dilutionFactor, steps, volumePerStep }) {
        if (!stockConc || !dilutionFactor || !steps || !volumePerStep) {
            throw new Error('serialDilution requires stockConc, dilutionFactor, steps, volumePerStep');
        }
        if (dilutionFactor <= 1) {
            throw new Error('Dilution factor must be greater than 1');
        }
        if (steps < 1 || steps > 20) {
            throw new Error('Steps must be between 1 and 20');
        }

        const result = [];
        let currentConc = stockConc;
        const transferVolume = volumePerStep / dilutionFactor;
        const diluentPerStep = volumePerStep - transferVolume;

        for (let i = 0; i < steps; i++) {
            const nextConc = currentConc / dilutionFactor;
            result.push({
                step: i + 1,
                concentration: round(nextConc, 6),
                transferVolume: round(transferVolume, 4),
                diluentVolume: round(diluentPerStep, 4),
                totalVolume: round(volumePerStep, 4),
                fromConcentration: round(currentConc, 6)
            });
            currentConc = nextConc;
        }

        return result;
    }

    /**
     * Cell suspension volume calculator
     * @param {object} params - { stockDensity, targetDensity, targetVolume }
     *   stockDensity and targetDensity in cells/mL
     */
    function cellSuspension({ stockDensity, targetDensity, targetVolume }) {
        if (!stockDensity || !targetDensity || !targetVolume) {
            throw new Error('cellSuspension requires stockDensity, targetDensity, and targetVolume');
        }
        if (targetDensity > stockDensity) {
            throw new Error('Target density cannot exceed stock density (concentrate cells first)');
        }

        const cellVolume = (targetDensity * targetVolume) / stockDensity;
        const mediaVolume = targetVolume - cellVolume;
        const totalCells = targetDensity * targetVolume;

        return {
            cellSuspensionVolume: round(cellVolume, 4),
            mediaVolume: round(mediaVolume, 4),
            totalVolume: round(targetVolume, 4),
            totalCells: Math.round(totalCells),
            stockDensity,
            targetDensity,
            dilutionFactor: round(stockDensity / targetDensity, 2)
        };
    }

    // ── Formulation Builder ─────────────────────────────────────

    /**
     * Create a multi-component formulation
     * @param {object} params
     *   - name: string
     *   - targetVolume: number (mL)
     *   - components: Array<{ name, role, stockConc, targetConc, unit? }>
     *   - cells?: { name, stockDensity, targetDensity }
     */
    function createFormulation({ name, targetVolume, components, cells }) {
        if (!name || !targetVolume || !components || components.length === 0) {
            throw new Error('createFormulation requires name, targetVolume, and at least one component');
        }
        if (targetVolume <= 0) {
            throw new Error('targetVolume must be positive');
        }

        const resolvedComponents = [];
        let totalComponentVolume = 0;

        for (const comp of components) {
            if (!comp.name || comp.stockConc == null || comp.targetConc == null) {
                throw new Error(`Component "${comp.name || 'unnamed'}" requires name, stockConc, and targetConc`);
            }
            if (comp.targetConc > comp.stockConc) {
                throw new Error(`Component "${comp.name}": target concentration (${comp.targetConc}) exceeds stock (${comp.stockConc})`);
            }

            const volume = (comp.targetConc * targetVolume) / comp.stockConc;
            totalComponentVolume += volume;

            // Look up material info
            const materialInfo = findMaterial(comp.name);

            resolvedComponents.push({
                name: comp.name,
                displayName: materialInfo ? materialInfo.name : comp.name,
                role: comp.role || (materialInfo ? (materialInfo.role || materialInfo.category) : 'other'),
                stockConcentration: comp.stockConc,
                targetConcentration: comp.targetConc,
                unit: comp.unit || (materialInfo ? materialInfo.typicalConcentration.unit : 'units'),
                volumeNeeded: round(volume, 4),
                percentOfTotal: round((volume / targetVolume) * 100, 2),
                costPerGram: materialInfo ? materialInfo.costPerGram : null
            });
        }

        // Cell component
        let cellComponent = null;
        if (cells) {
            const cellVol = (cells.targetDensity * targetVolume) / cells.stockDensity;
            totalComponentVolume += cellVol;
            cellComponent = {
                name: cells.name || 'Cell Suspension',
                stockDensity: cells.stockDensity,
                targetDensity: cells.targetDensity,
                volumeNeeded: round(cellVol, 4),
                totalCells: Math.round(cells.targetDensity * targetVolume),
                percentOfTotal: round((cellVol / targetVolume) * 100, 2)
            };
        }

        const solventVolume = targetVolume - totalComponentVolume;

        if (solventVolume < -0.001) {
            throw new Error(
                `Component volumes (${round(totalComponentVolume, 4)} mL) exceed target volume (${targetVolume} mL). ` +
                `Reduce concentrations or increase target volume.`
            );
        }

        const formulation = {
            name,
            targetVolume,
            components: resolvedComponents,
            cells: cellComponent,
            solventVolume: round(Math.max(0, solventVolume), 4),
            totalComponentVolume: round(totalComponentVolume, 4),
            createdAt: new Date().toISOString(),
            mixingOrder: getMixingOrder(resolvedComponents, cellComponent),
            warnings: getFormulationWarnings(resolvedComponents, cellComponent, targetVolume, solventVolume)
        };

        return formulation;
    }

    /**
     * Scale a formulation up or down
     */
    function scaleFormulation(formulation, scaleFactor) {
        if (!formulation || scaleFactor == null) {
            throw new Error('scaleFormulation requires a formulation and scaleFactor');
        }
        if (scaleFactor <= 0) {
            throw new Error('Scale factor must be positive');
        }

        const scaled = {
            ...formulation,
            name: `${formulation.name} (${scaleFactor}x)`,
            targetVolume: round(formulation.targetVolume * scaleFactor, 4),
            components: formulation.components.map(c => ({
                ...c,
                volumeNeeded: round(c.volumeNeeded * scaleFactor, 4)
            })),
            solventVolume: round(formulation.solventVolume * scaleFactor, 4),
            totalComponentVolume: round(formulation.totalComponentVolume * scaleFactor, 4),
            scaledFrom: formulation.name,
            scaleFactor
        };

        if (formulation.cells) {
            scaled.cells = {
                ...formulation.cells,
                volumeNeeded: round(formulation.cells.volumeNeeded * scaleFactor, 4),
                totalCells: Math.round(formulation.cells.totalCells * scaleFactor)
            };
        }

        return scaled;
    }

    /**
     * Compare two formulations
     */
    function compareFormulations(f1, f2) {
        const allNames = new Set([
            ...f1.components.map(c => c.name),
            ...f2.components.map(c => c.name)
        ]);

        const componentComparison = [];
        for (const name of allNames) {
            const c1 = f1.components.find(c => c.name === name);
            const c2 = f2.components.find(c => c.name === name);
            componentComparison.push({
                name,
                inFirst: !!c1,
                inSecond: !!c2,
                firstConc: c1 ? c1.targetConcentration : null,
                secondConc: c2 ? c2.targetConcentration : null,
                concDiff: (c1 && c2) ? round(c2.targetConcentration - c1.targetConcentration, 4) : null,
                firstVolume: c1 ? c1.volumeNeeded : null,
                secondVolume: c2 ? c2.volumeNeeded : null
            });
        }

        const cost1 = estimateCost(f1);
        const cost2 = estimateCost(f2);

        return {
            formulation1: f1.name,
            formulation2: f2.name,
            volumeRatio: round(f2.targetVolume / f1.targetVolume, 2),
            componentComparison,
            sharedComponents: componentComparison.filter(c => c.inFirst && c.inSecond).length,
            uniqueToFirst: componentComparison.filter(c => c.inFirst && !c.inSecond).map(c => c.name),
            uniqueToSecond: componentComparison.filter(c => !c.inFirst && c.inSecond).map(c => c.name),
            costComparison: {
                first: cost1,
                second: cost2,
                difference: cost1.totalCost != null && cost2.totalCost != null
                    ? round(cost2.totalCost - cost1.totalCost, 2)
                    : null
            }
        };
    }

    /**
     * Estimate cost of a formulation
     * Assumes concentration in % w/v → grams = (conc/100) * volume
     */
    function estimateCost(formulation) {
        let totalCost = 0;
        let hasUnknown = false;
        const breakdown = [];

        for (const comp of formulation.components) {
            if (comp.costPerGram != null) {
                // Estimate grams: for % w/v, grams = (conc/100)*vol; for mg/mL, grams = (conc/1000)*vol
                let grams;
                const unit = (comp.unit || '').toLowerCase();
                if (unit.includes('mg/ml')) {
                    grams = (comp.targetConcentration / 1000) * formulation.targetVolume;
                } else if (unit.includes('ng/ml')) {
                    grams = (comp.targetConcentration / 1e9) * formulation.targetVolume;
                } else if (unit.includes('mm') || unit.includes('u/ml')) {
                    // mM or U/mL — can't easily convert without MW, skip
                    hasUnknown = true;
                    breakdown.push({ name: comp.name, cost: null, note: 'Cannot estimate without molecular weight' });
                    continue;
                } else {
                    // Default: % w/v
                    grams = (comp.targetConcentration / 100) * formulation.targetVolume;
                }
                const cost = round(grams * comp.costPerGram, 6);
                totalCost += cost;
                breakdown.push({ name: comp.name, grams: round(grams, 10), cost, costPerGram: comp.costPerGram });
            } else {
                hasUnknown = true;
                breakdown.push({ name: comp.name, cost: null, note: 'No cost data available' });
            }
        }

        return {
            totalCost: hasUnknown ? null : round(totalCost, 2),
            estimatedCost: round(totalCost, 2),
            isComplete: !hasUnknown,
            breakdown,
            currency: 'USD'
        };
    }

    /**
     * Estimate blend viscosity using log mixing rule
     */
    function estimateBlendViscosity(formulation) {
        let logViscSum = 0;
        let totalFraction = 0;
        const contributions = [];

        for (const comp of formulation.components) {
            const material = BASE_MATERIALS[comp.name];
            if (material && material.viscosityAt37C) {
                const fraction = comp.volumeNeeded / formulation.targetVolume;
                logViscSum += fraction * Math.log(material.viscosityAt37C);
                totalFraction += fraction;
                contributions.push({
                    name: comp.displayName || comp.name,
                    viscosity: material.viscosityAt37C,
                    volumeFraction: round(fraction, 4)
                });
            }
        }

        if (totalFraction === 0) {
            return { estimatedViscosity: null, note: 'No viscosity data for components' };
        }

        // Normalize
        const estimatedVisc = Math.exp(logViscSum / totalFraction);

        return {
            estimatedViscosity: round(estimatedVisc, 4),
            unit: 'Pa·s',
            temperature: 37,
            contributions,
            note: 'Estimated via log mixing rule — actual viscosity depends on interactions'
        };
    }

    /**
     * Get built-in recipe templates
     */
    function getRecipeTemplates() {
        return [
            {
                id: 'gelma-basic',
                name: 'Basic GelMA Bioink',
                description: 'Standard photocrosslinkable bioink for general use',
                components: [
                    { name: 'gelatin-methacrylate', stockConc: 20, targetConc: 7 },
                    { name: 'lap', stockConc: 2, targetConc: 0.1 }
                ],
                targetVolume: 5,
                tissue: 'general'
            },
            {
                id: 'alginate-cacl2',
                name: 'Alginate-CaCl2 Bioink',
                description: 'Ionically crosslinked alginate for rapid gelation',
                components: [
                    { name: 'alginate', stockConc: 4, targetConc: 2 }
                ],
                crosslinkerNote: 'Use 100mM CaCl2 bath post-print',
                targetVolume: 5,
                tissue: 'soft-tissue'
            },
            {
                id: 'gelma-ha',
                name: 'GelMA-HA Composite',
                description: 'Enhanced mechanical properties with HA addition',
                components: [
                    { name: 'gelatin-methacrylate', stockConc: 20, targetConc: 5 },
                    { name: 'hyaluronic-acid', stockConc: 5, targetConc: 1 },
                    { name: 'lap', stockConc: 2, targetConc: 0.1 }
                ],
                targetVolume: 5,
                tissue: 'cartilage'
            },
            {
                id: 'fibrin',
                name: 'Fibrin Bioink',
                description: 'Enzymatically crosslinked fibrin gel',
                components: [
                    { name: 'fibrinogen', stockConc: 50, targetConc: 20 }
                ],
                crosslinkerNote: 'Mix with thrombin (5 U/mL) immediately before printing',
                targetVolume: 2,
                tissue: 'vascular'
            },
            {
                id: 'bone-gelma',
                name: 'Bone Tissue GelMA',
                description: 'GelMA with BMP-2 for osteogenic differentiation',
                components: [
                    { name: 'gelatin-methacrylate', stockConc: 20, targetConc: 10 },
                    { name: 'lap', stockConc: 2, targetConc: 0.15 }
                ],
                targetVolume: 3,
                tissue: 'bone'
            },
            {
                id: 'pluronic-support',
                name: 'Pluronic Support Bath',
                description: 'Sacrificial support material for embedded printing',
                components: [
                    { name: 'pluronic-f127', stockConc: 40, targetConc: 25 }
                ],
                targetVolume: 50,
                tissue: 'support'
            }
        ];
    }

    /**
     * Create formulation from a template
     */
    function fromTemplate(templateId, overrides) {
        const templates = getRecipeTemplates();
        const template = templates.find(t => t.id === templateId);
        if (!template) {
            throw new Error(`Template "${templateId}" not found. Available: ${templates.map(t => t.id).join(', ')}`);
        }

        const params = {
            name: overrides?.name || template.name,
            targetVolume: overrides?.targetVolume || template.targetVolume,
            components: overrides?.components || template.components,
            cells: overrides?.cells || null
        };

        const formulation = createFormulation(params);
        formulation.templateId = templateId;
        formulation.tissue = template.tissue;
        if (template.crosslinkerNote) {
            formulation.crosslinkerNote = template.crosslinkerNote;
        }
        return formulation;
    }

    /**
     * Get concentration recommendations for a target tissue
     */
    function getRecommendations(tissueType) {
        const recommendations = {
            'bone': {
                tissue: 'Bone',
                stiffness: 'high (10-50 kPa)',
                suggestedBase: 'gelatin-methacrylate',
                suggestedConc: '8-15% w/v',
                crosslinking: 'High UV dose (20-40 mW/cm², 30-60s)',
                growthFactors: ['bmp2', 'tgfb1'],
                cells: 'Mesenchymal stem cells or osteoblasts, 5-10 × 10⁶ cells/mL',
                notes: 'Consider adding hydroxyapatite nanoparticles for mineralization'
            },
            'cartilage': {
                tissue: 'Cartilage',
                stiffness: 'medium (5-20 kPa)',
                suggestedBase: 'gelatin-methacrylate + hyaluronic-acid',
                suggestedConc: 'GelMA 5-7% + HA 1-2%',
                crosslinking: 'Moderate UV (10-20 mW/cm², 15-30s)',
                growthFactors: ['tgfb1'],
                cells: 'Chondrocytes or MSCs, 10-20 × 10⁶ cells/mL',
                notes: 'HA improves chondrogenesis and water retention'
            },
            'skin': {
                tissue: 'Skin',
                stiffness: 'low-medium (1-10 kPa)',
                suggestedBase: 'collagen-type-i or fibrinogen',
                suggestedConc: 'Collagen 3-6 mg/mL or Fibrinogen 10-20 mg/mL',
                crosslinking: 'Thermal (37°C) or enzymatic',
                growthFactors: ['vegf'],
                cells: 'Keratinocytes + fibroblasts, 2-5 × 10⁶ cells/mL',
                notes: 'Layer keratinocytes on top of fibroblast-laden dermis'
            },
            'vascular': {
                tissue: 'Vascular',
                stiffness: 'medium (5-15 kPa)',
                suggestedBase: 'fibrinogen or gelatin-methacrylate',
                suggestedConc: 'Fibrinogen 15-25 mg/mL',
                crosslinking: 'Enzymatic (thrombin) or UV',
                growthFactors: ['vegf'],
                cells: 'HUVECs + smooth muscle cells, 5-10 × 10⁶ cells/mL',
                notes: 'Consider coaxial printing for tubular structures'
            },
            'neural': {
                tissue: 'Neural',
                stiffness: 'very low (0.1-1 kPa)',
                suggestedBase: 'hyaluronic-acid or collagen-type-i',
                suggestedConc: 'HA 0.5-2% or Collagen 2-4 mg/mL',
                crosslinking: 'Gentle UV or enzymatic',
                growthFactors: [],
                cells: 'Neural stem cells, 1-5 × 10⁶ cells/mL',
                notes: 'Very soft matrix critical for neural differentiation'
            },
            'liver': {
                tissue: 'Liver',
                stiffness: 'low (1-5 kPa)',
                suggestedBase: 'gelatin-methacrylate or alginate',
                suggestedConc: 'GelMA 3-5% or Alginate 1-2%',
                crosslinking: 'UV or ionic',
                growthFactors: [],
                cells: 'Hepatocytes + stellate cells, 10-20 × 10⁶ cells/mL',
                notes: 'Consider spheroid encapsulation for better function'
            }
        };

        if (tissueType) {
            const rec = recommendations[tissueType.toLowerCase()];
            if (!rec) {
                return {
                    error: `Unknown tissue type "${tissueType}". Available: ${Object.keys(recommendations).join(', ')}`
                };
            }
            return rec;
        }

        return recommendations;
    }

    /**
     * Export formulation to JSON
     */
    function exportFormulation(formulation) {
        return JSON.stringify(formulation, null, 2);
    }

    /**
     * Import formulation from JSON
     */
    function importFormulation(json) {
        try {
            const parsed = typeof json === 'string' ? JSON.parse(json) : json;
            if (!parsed.name || !parsed.targetVolume || !parsed.components) {
                throw new Error('Invalid formulation: missing required fields');
            }
            return parsed;
        } catch (e) {
            throw new Error(`Failed to import formulation: ${e.message}`);
        }
    }

    /**
     * Generate a text report for a formulation
     */
    function generateReport(formulation) {
        const lines = [];
        lines.push(`═══ Bioink Formulation Report ═══`);
        lines.push(`Name: ${formulation.name}`);
        lines.push(`Target Volume: ${formulation.targetVolume} mL`);
        lines.push(`Created: ${formulation.createdAt || 'N/A'}`);
        if (formulation.tissue) lines.push(`Target Tissue: ${formulation.tissue}`);
        lines.push('');

        lines.push('─── Components ───');
        for (const comp of formulation.components) {
            lines.push(`  ${comp.displayName || comp.name}`);
            lines.push(`    Role: ${comp.role}`);
            lines.push(`    Stock: ${comp.stockConcentration} ${comp.unit} → Target: ${comp.targetConcentration} ${comp.unit}`);
            lines.push(`    Volume: ${comp.volumeNeeded} mL (${comp.percentOfTotal}%)`);
        }

        if (formulation.cells) {
            lines.push('');
            lines.push('─── Cell Component ───');
            lines.push(`  ${formulation.cells.name}`);
            lines.push(`    Stock: ${formatCellDensity(formulation.cells.stockDensity)} → Target: ${formatCellDensity(formulation.cells.targetDensity)}`);
            lines.push(`    Volume: ${formulation.cells.volumeNeeded} mL (${formulation.cells.percentOfTotal}%)`);
            lines.push(`    Total Cells: ${formulation.cells.totalCells.toLocaleString()}`);
        }

        lines.push('');
        lines.push(`Solvent/Media Volume: ${formulation.solventVolume} mL`);

        if (formulation.mixingOrder && formulation.mixingOrder.length > 0) {
            lines.push('');
            lines.push('─── Mixing Order ───');
            formulation.mixingOrder.forEach((step, i) => {
                lines.push(`  ${i + 1}. ${step.name} — ${step.note}`);
            });
        }

        if (formulation.warnings && formulation.warnings.length > 0) {
            lines.push('');
            lines.push('─── Warnings ───');
            formulation.warnings.forEach(w => lines.push(`  ⚠ ${w}`));
        }

        if (formulation.crosslinkerNote) {
            lines.push('');
            lines.push(`─── Crosslinking Note ───`);
            lines.push(`  ${formulation.crosslinkerNote}`);
        }

        const cost = estimateCost(formulation);
        if (cost.estimatedCost > 0) {
            lines.push('');
            lines.push('─── Cost Estimate ───');
            cost.breakdown.forEach(b => {
                if (b.cost != null) {
                    lines.push(`  ${b.name}: $${b.cost.toFixed(4)} (${b.grams}g × $${b.costPerGram}/g)`);
                } else {
                    lines.push(`  ${b.name}: ${b.note}`);
                }
            });
            lines.push(`  Total: ${cost.isComplete ? '' : '≥ '}$${cost.estimatedCost.toFixed(2)}`);
        }

        return lines.join('\n');
    }

    // ── Helpers ─────────────────────────────────────────────────

    function findMaterial(nameOrKey) {
        if (BASE_MATERIALS[nameOrKey]) return BASE_MATERIALS[nameOrKey];
        if (COMMON_ADDITIVES[nameOrKey]) return COMMON_ADDITIVES[nameOrKey];
        return null;
    }

    function getMixingOrder(components, cellComponent) {
        const steps = components.map(c => ({
            name: c.displayName || c.name,
            role: c.role || 'other',
            priority: MIXING_ORDER_PRIORITY[c.role] || MIXING_ORDER_PRIORITY['other'],
            note: MIXING_NOTES[c.role] || MIXING_NOTES['other']
        }));

        if (cellComponent) {
            steps.push({
                name: cellComponent.name,
                role: 'cells',
                priority: MIXING_ORDER_PRIORITY['cells'],
                note: MIXING_NOTES['cells']
            });
        }

        steps.sort((a, b) => a.priority - b.priority);
        return steps;
    }

    function getFormulationWarnings(components, cells, targetVolume, solventVolume) {
        const warnings = [];

        if (solventVolume < targetVolume * 0.05) {
            warnings.push('Very low solvent volume — may be difficult to mix homogeneously');
        }

        const photoinitiators = components.filter(c => c.role === 'photoinitiator');
        if (photoinitiators.length > 1) {
            warnings.push('Multiple photoinitiators — may cause competing reactions');
        }

        const crosslinkers = components.filter(c => c.role === 'crosslinker');
        if (crosslinkers.length > 1) {
            warnings.push('Multiple crosslinkers — ensure compatibility');
        }

        if (cells && cells.targetDensity > 20e6) {
            warnings.push('High cell density (>20M/mL) — may increase viscosity and affect printability');
        }

        for (const comp of components) {
            const material = findMaterial(comp.name);
            if (material && material.typicalConcentration) {
                const tc = material.typicalConcentration;
                if (comp.targetConcentration > tc.max) {
                    warnings.push(`${comp.displayName || comp.name}: concentration (${comp.targetConcentration}) exceeds typical max (${tc.max} ${tc.unit})`);
                }
                if (comp.targetConcentration < tc.min) {
                    warnings.push(`${comp.displayName || comp.name}: concentration (${comp.targetConcentration}) below typical min (${tc.min} ${tc.unit})`);
                }
            }
        }

        return warnings;
    }

    function formatCellDensity(density) {
        if (density >= 1e6) return `${round(density / 1e6, 1)} × 10⁶ cells/mL`;
        if (density >= 1e3) return `${round(density / 1e3, 1)} × 10³ cells/mL`;
        return `${density} cells/mL`;
    }

    // ── List Materials ──────────────────────────────────────────

    function listBaseMaterials() {
        return Object.entries(BASE_MATERIALS).map(([key, m]) => ({
            key,
            ...m
        }));
    }

    function listAdditives() {
        return Object.entries(COMMON_ADDITIVES).map(([key, a]) => ({
            key,
            ...a
        }));
    }

    // ── Public API ──────────────────────────────────────────────

    return {
        dilution,
        serialDilution,
        cellSuspension,
        createFormulation,
        scaleFormulation,
        compareFormulations,
        estimateCost,
        estimateBlendViscosity,
        getRecipeTemplates,
        fromTemplate,
        getRecommendations,
        exportFormulation,
        importFormulation,
        generateReport,
        listBaseMaterials,
        listAdditives
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createFormulationCalculator };
}
