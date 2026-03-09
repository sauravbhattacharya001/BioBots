'use strict';

const { validatePositive, validateNonNegative } = require('./scriptUtils');

/**
 * Sterilization Protocol Analyzer for BioBots
 *
 * Models sterilization effectiveness and material compatibility for
 * bioprinting workflows. Sterilization is critical in bioprinting to
 * ensure aseptic conditions while preserving material properties.
 *
 * Sterilization methods modeled:
 *   - Autoclave (steam sterilization: 121°C / 134°C)
 *   - UV-C irradiation (254 nm germicidal)
 *   - Ethanol wash (70% concentration)
 *   - Gamma irradiation (Co-60)
 *   - Ethylene oxide (EtO gas)
 *   - Hydrogen peroxide plasma (H2O2)
 *
 * Features:
 *   - Log-reduction pathogen kill curves (D-value model)
 *   - Material degradation estimation per method
 *   - Protocol recommendation based on materials + target SAL
 *   - Multi-step protocol planning
 *   - Cycle optimization (minimum time for target sterility)
 *   - Validation tracking with biological indicators
 *
 * References:
 *   - D-value model: N(t) = N0 * 10^(-t/D) where D = time for 1-log reduction
 *   - SAL (Sterility Assurance Level): probability of a non-sterile unit
 *   - Material compatibility data from published bioprinting literature
 */

function createSterilizationAnalyzer(userConfig) {
    // ── Pathogen database with D-values ─────────────────────────

    /** D-values (minutes for 1-log kill) by method and organism. */
    var DEFAULT_PATHOGENS = {
        'B. stearothermophilus': {
            type: 'spore',
            autoclave121: 1.5,    // D-value at 121°C in minutes
            autoclave134: 0.4,
            uvC: 12.0,            // D-value for UV-C (mJ/cm² equivalent minutes)
            ethanol: null,        // Not effective against spores
            gamma: 2.8,           // D-value in kGy
            eto: 5.0,
            h2o2Plasma: 6.0,
            description: 'Thermophilic spore-former; standard autoclave BI'
        },
        'B. atrophaeus': {
            type: 'spore',
            autoclave121: 0.5,
            autoclave134: 0.15,
            uvC: 15.0,
            ethanol: null,
            gamma: 2.2,
            eto: 3.0,
            h2o2Plasma: 4.5,
            description: 'Spore-former; standard EtO biological indicator'
        },
        'S. aureus': {
            type: 'vegetative',
            autoclave121: 0.12,
            autoclave134: 0.03,
            uvC: 1.6,
            ethanol: 0.5,
            gamma: 0.2,
            eto: 0.8,
            h2o2Plasma: 0.4,
            description: 'Gram-positive coccus; common contaminant'
        },
        'E. coli': {
            type: 'vegetative',
            autoclave121: 0.1,
            autoclave134: 0.025,
            uvC: 1.3,
            ethanol: 0.3,
            gamma: 0.18,
            eto: 0.6,
            h2o2Plasma: 0.3,
            description: 'Gram-negative rod; indicator organism'
        },
        'P. aeruginosa': {
            type: 'vegetative',
            autoclave121: 0.08,
            autoclave134: 0.02,
            uvC: 2.2,
            ethanol: 0.4,
            gamma: 0.15,
            eto: 0.7,
            h2o2Plasma: 0.35,
            description: 'Gram-negative opportunistic pathogen'
        },
        'A. niger': {
            type: 'fungal',
            autoclave121: 0.8,
            autoclave134: 0.2,
            uvC: 8.0,
            ethanol: 2.0,
            gamma: 1.8,
            eto: 3.5,
            h2o2Plasma: 3.0,
            description: 'Fungal spore; environmental contaminant'
        },
        'C. sporogenes': {
            type: 'spore',
            autoclave121: 1.2,
            autoclave134: 0.35,
            uvC: 14.0,
            ethanol: null,
            gamma: 2.5,
            eto: 4.5,
            h2o2Plasma: 5.5,
            description: 'Anaerobic spore-former; gamma irradiation BI surrogate'
        },
        'M. tuberculosis': {
            type: 'mycobacterium',
            autoclave121: 0.2,
            autoclave134: 0.06,
            uvC: 3.0,
            ethanol: 1.0,
            gamma: 0.4,
            eto: 1.5,
            h2o2Plasma: 1.2,
            description: 'Acid-fast bacillus; high environmental resistance'
        }
    };

    // ── Sterilization method specifications ──────────────────────

    var METHODS = {
        autoclave121: {
            name: 'Autoclave 121°C',
            description: 'Saturated steam at 121°C, 15 psi',
            temperatureC: 121,
            defaultDurationMin: 20,
            minDurationMin: 15,
            maxDurationMin: 60,
            category: 'heat',
            advantages: ['Effective against all organisms', 'No toxic residuals', 'Well validated'],
            limitations: ['High temperature damages thermolabile materials', 'Moisture exposure', 'Cannot sterilize sealed electronics']
        },
        autoclave134: {
            name: 'Autoclave 134°C',
            description: 'Flash sterilization at 134°C, 30 psi',
            temperatureC: 134,
            defaultDurationMin: 4,
            minDurationMin: 3,
            maxDurationMin: 20,
            category: 'heat',
            advantages: ['Very fast cycle', 'Prion inactivation at extended times', 'High kill rate'],
            limitations: ['Higher temperature damage', 'More material stress', 'Not for all loads']
        },
        uvC: {
            name: 'UV-C Irradiation (254nm)',
            description: 'Germicidal ultraviolet at 254nm wavelength',
            temperatureC: 25,
            defaultDurationMin: 30,
            minDurationMin: 5,
            maxDurationMin: 120,
            category: 'radiation',
            advantages: ['Low temperature', 'No chemical residuals', 'Surface-compatible'],
            limitations: ['Surface-only (no penetration)', 'Shadowing effects', 'Less effective on spores']
        },
        ethanol: {
            name: 'Ethanol 70%',
            description: '70% ethanol immersion/wipe',
            temperatureC: 25,
            defaultDurationMin: 10,
            minDurationMin: 5,
            maxDurationMin: 30,
            category: 'chemical',
            advantages: ['Easy to apply', 'Fast acting on vegetative cells', 'Low cost'],
            limitations: ['Ineffective against spores', 'Protein fixation', 'Fire hazard', 'Residual removal needed']
        },
        gamma: {
            name: 'Gamma Irradiation',
            description: 'Co-60 gamma radiation (typical 25 kGy)',
            temperatureC: 25,
            defaultDurationMin: 0,  // dose-based, not time-based
            defaultDoseKGy: 25,
            minDoseKGy: 5,
            maxDoseKGy: 50,
            category: 'radiation',
            advantages: ['Deep penetration', 'Works through packaging', 'No heat', 'No residuals'],
            limitations: ['Degrades polymers', 'Requires specialized facility', 'Dose-dependent material damage']
        },
        eto: {
            name: 'Ethylene Oxide (EtO)',
            description: 'Gas sterilization at 37-63°C',
            temperatureC: 55,
            defaultDurationMin: 180,
            minDurationMin: 60,
            maxDurationMin: 720,
            category: 'chemical',
            advantages: ['Low temperature', 'Good penetration', 'Compatible with many polymers'],
            limitations: ['Toxic residuals (aeration needed)', 'Long cycle time', 'Carcinogenic gas', 'Environmental concerns']
        },
        h2o2Plasma: {
            name: 'H₂O₂ Plasma',
            description: 'Hydrogen peroxide gas plasma (Sterrad-type)',
            temperatureC: 50,
            defaultDurationMin: 45,
            minDurationMin: 28,
            maxDurationMin: 75,
            category: 'chemical',
            advantages: ['Low temperature', 'No toxic residuals', 'Fast cycle', 'Material-friendly'],
            limitations: ['Cannot process cellulose/linens', 'Limited lumen penetration', 'Higher cost']
        }
    };

    // ── Material compatibility database ─────────────────────────

    /**
     * Material compatibility ratings: 0.0 (destroyed) to 1.0 (fully compatible).
     * Values represent fraction of original properties retained after standard cycle.
     */
    var MATERIAL_COMPAT = {
        'GelMA': {
            autoclave121: 0.0,    // Protein denatures
            autoclave134: 0.0,
            uvC: 0.85,            // Mild photo-crosslinking side effects
            ethanol: 0.7,         // Partial dehydration
            gamma: 0.5,           // Chain scission
            eto: 0.6,             // Some chemical modification
            h2o2Plasma: 0.8,
            description: 'Gelatin methacrylate hydrogel; thermolabile'
        },
        'Alginate': {
            autoclave121: 0.3,    // Significant viscosity loss
            autoclave134: 0.1,
            uvC: 0.95,            // UV-transparent
            ethanol: 0.85,
            gamma: 0.6,           // Molecular weight reduction
            eto: 0.9,
            h2o2Plasma: 0.9,
            description: 'Sodium alginate polysaccharide'
        },
        'Collagen': {
            autoclave121: 0.0,    // Complete denaturation
            autoclave134: 0.0,
            uvC: 0.75,            // Photo-oxidation at high doses
            ethanol: 0.6,         // Structural changes
            gamma: 0.4,           // Significant chain scission
            eto: 0.55,
            h2o2Plasma: 0.7,
            description: 'Type I collagen; highly heat-sensitive'
        },
        'PCL': {
            autoclave121: 0.65,   // Near melting point (60°C, but crystalline regions)
            autoclave134: 0.3,
            uvC: 0.9,
            ethanol: 0.95,
            gamma: 0.7,           // Some chain scission and crosslinking
            eto: 0.95,
            h2o2Plasma: 0.95,
            description: 'Polycaprolactone thermoplastic; Tm ~60°C'
        },
        'PLA': {
            autoclave121: 0.1,    // Near Tg, severe deformation
            autoclave134: 0.0,
            uvC: 0.9,
            ethanol: 0.85,
            gamma: 0.6,
            eto: 0.9,
            h2o2Plasma: 0.9,
            description: 'Polylactic acid; Tg ~55-60°C'
        },
        'PLGA': {
            autoclave121: 0.05,
            autoclave134: 0.0,
            uvC: 0.85,
            ethanol: 0.8,
            gamma: 0.55,          // Accelerated degradation
            eto: 0.85,
            h2o2Plasma: 0.85,
            description: 'Poly(lactic-co-glycolic acid); hydrolysis-sensitive'
        },
        'Hyaluronic Acid': {
            autoclave121: 0.4,    // MW reduction but usable
            autoclave134: 0.15,
            uvC: 0.9,
            ethanol: 0.85,
            gamma: 0.45,
            eto: 0.8,
            h2o2Plasma: 0.85,
            description: 'HA hydrogel; heat causes chain scission'
        },
        'Silk Fibroin': {
            autoclave121: 0.5,    // Conformational changes
            autoclave134: 0.2,
            uvC: 0.8,
            ethanol: 0.9,         // Actually used in processing
            gamma: 0.65,
            eto: 0.75,
            h2o2Plasma: 0.8,
            description: 'Silk protein; somewhat heat-resistant'
        },
        'Titanium': {
            autoclave121: 1.0,
            autoclave134: 1.0,
            uvC: 1.0,
            ethanol: 1.0,
            gamma: 1.0,
            eto: 1.0,
            h2o2Plasma: 1.0,
            description: 'Ti-6Al-4V; fully compatible with all methods'
        },
        'Stainless Steel': {
            autoclave121: 1.0,
            autoclave134: 1.0,
            uvC: 1.0,
            ethanol: 0.95,        // Minor surface effects over many cycles
            gamma: 1.0,
            eto: 1.0,
            h2o2Plasma: 1.0,
            description: '316L stainless; standard autoclavable material'
        },
        'Glass': {
            autoclave121: 1.0,
            autoclave134: 1.0,
            uvC: 0.95,            // Solarization at very high doses
            ethanol: 1.0,
            gamma: 0.9,           // Slight discoloration
            eto: 1.0,
            h2o2Plasma: 1.0,
            description: 'Borosilicate glass; heat-resistant'
        },
        'PEEK': {
            autoclave121: 0.95,
            autoclave134: 0.9,
            uvC: 0.95,
            ethanol: 0.95,
            gamma: 0.8,
            eto: 0.95,
            h2o2Plasma: 0.95,
            description: 'Polyether ether ketone; high-performance polymer'
        }
    };

    var config = _merge({
        defaultSAL: 1e-6,           // FDA standard: 10^-6
        defaultBioburden: 1000,     // Typical bioburden (CFU)
        defaultPathogen: 'B. stearothermophilus',
        safetyFactor: 1.5,          // Overkill multiplier
        materialThreshold: 0.6,     // Min compatibility to recommend
        maxProtocolSteps: 5
    }, userConfig || {});

    var pathogens = _deepCopy(DEFAULT_PATHOGENS);
    var materials = _deepCopy(MATERIAL_COMPAT);
    var validationRecords = [];

    // ── D-value kill model ──────────────────────────────────────

    /**
     * Calculate log reduction for a given method, duration, and pathogen.
     *
     * Uses the D-value model: log_reduction = duration / D_value
     * Survivors: N = N0 * 10^(-log_reduction)
     *
     * @param {string} method - Sterilization method key.
     * @param {number} duration - Exposure duration (minutes or kGy for gamma).
     * @param {string} [pathogenName] - Pathogen to model (default: config).
     * @returns {object} Kill kinetics result.
     */
    function calculateKillKinetics(method, duration, pathogenName) {
        _validateMethod(method);
        validateNonNegative(duration, 'Duration');
        var lookup = _lookupPathogen(pathogenName);
        var dValue = lookup.data[method];
        if (dValue == null) {
            return {
                method: method,
                methodName: METHODS[method].name,
                pathogen: lookup.name,
                duration: duration,
                dValue: null,
                logReduction: 0,
                survivors: config.defaultBioburden,
                initialBioburden: config.defaultBioburden,
                sal: 1.0,
                effective: false,
                reason: METHODS[method].name + ' is not effective against ' + lookup.name
            };
        }

        var logRed = _logReduction(duration, dValue);
        var surv = _survivors(config.defaultBioburden, logRed);

        return {
            method: method,
            methodName: METHODS[method].name,
            pathogen: lookup.name,
            duration: duration,
            dValue: dValue,
            logReduction: _round(logRed, 2),
            survivors: _round(surv, 6),
            initialBioburden: config.defaultBioburden,
            sal: _round(surv, 10),
            effective: logRed >= 6,  // 6-log minimum for sterilization
            sterile: surv < config.defaultSAL,
            durationUnit: _durationUnit(method)
        };
    }

    /**
     * Generate a kill curve showing survivors over time/dose.
     *
     * @param {string} method - Sterilization method.
     * @param {number} maxDuration - Maximum duration/dose to plot.
     * @param {number} [steps=20] - Number of data points.
     * @param {string} [pathogenName] - Target pathogen.
     * @returns {object} Kill curve data with points and annotations.
     */
    function generateKillCurve(method, maxDuration, steps, pathogenName) {
        _validateMethod(method);
        validatePositive(maxDuration, 'maxDuration');
        var nSteps = (typeof steps === 'number' && steps >= 2) ? steps : 20;
        var lookup = _lookupPathogen(pathogenName);

        var dValue = lookup.data[method];
        if (dValue == null) {
            return {
                method: method,
                pathogen: lookup.name,
                effective: false,
                reason: 'Method not effective against this pathogen',
                points: []
            };
        }

        var points = [];
        var salReachedAt = null;
        var sixLogAt = null;

        for (var i = 0; i <= nSteps; i++) {
            var t = (maxDuration / nSteps) * i;
            var logRed = _logReduction(t, dValue);
            var surv = _survivors(config.defaultBioburden, logRed);
            points.push({
                duration: _round(t, 2),
                logReduction: _round(logRed, 2),
                survivors: _round(surv, 6),
                logSurvivors: _round(Math.log10(Math.max(surv, 1e-20)), 4)
            });
            if (salReachedAt === null && surv <= config.defaultSAL) {
                salReachedAt = _round(t, 2);
            }
            if (sixLogAt === null && logRed >= 6) {
                sixLogAt = _round(t, 2);
            }
        }

        return {
            method: method,
            methodName: METHODS[method].name,
            pathogen: lookup.name,
            dValue: dValue,
            initialBioburden: config.defaultBioburden,
            targetSAL: config.defaultSAL,
            points: points,
            salReachedAt: salReachedAt,
            sixLogReductionAt: sixLogAt,
            durationUnit: _durationUnit(method)
        };
    }

    // ── Material compatibility analysis ─────────────────────────

    /**
     * Assess material compatibility with a sterilization method.
     *
     * @param {string} materialName - Material to evaluate.
     * @param {string} method - Sterilization method.
     * @param {number} [cycles=1] - Number of sterilization cycles.
     * @returns {object} Compatibility assessment.
     */
    function assessMaterialCompat(materialName, method, cycles) {
        _validateMethod(method);
        var mat = _lookupMaterial(materialName);
        var nCycles = (typeof cycles === 'number' && cycles >= 1) ? Math.floor(cycles) : 1;

        var baseCompat = mat[method];
        if (baseCompat == null) {
            return {
                material: materialName,
                method: method,
                methodName: METHODS[method].name,
                compatible: false,
                rating: 0,
                propertyRetention: 0,
                recommendation: 'No compatibility data available'
            };
        }

        // Multi-cycle degradation: exponential decay of retention
        var retention = Math.pow(baseCompat, nCycles);
        var rating = _classifyCompat(retention);

        var recommendation;
        if (retention >= 0.9) {
            recommendation = 'Excellent — minimal property change expected';
        } else if (retention >= 0.7) {
            recommendation = 'Acceptable — minor property changes, monitor quality';
        } else if (retention >= config.materialThreshold) {
            recommendation = 'Marginal — noticeable degradation, limit cycles or consider alternatives';
        } else {
            recommendation = 'Not recommended — significant material damage expected';
        }

        return {
            material: materialName,
            materialDescription: mat.description,
            method: method,
            methodName: METHODS[method].name,
            cycles: nCycles,
            singleCycleRetention: _round(baseCompat, 3),
            propertyRetention: _round(retention, 3),
            retentionPercent: _round(retention * 100, 1),
            rating: rating,
            compatible: retention >= config.materialThreshold,
            recommendation: recommendation
        };
    }

    /**
     * Find best sterilization methods for a given material.
     *
     * @param {string} materialName - Material to evaluate.
     * @param {number} [cycles=1] - Number of planned cycles.
     * @returns {object} Ranked methods by compatibility.
     */
    function bestMethodsForMaterial(materialName) {
        var mat = _lookupMaterial(materialName);

        var results = [];
        var methodKeys = Object.keys(METHODS);
        for (var i = 0; i < methodKeys.length; i++) {
            var m = methodKeys[i];
            var retention = mat[m];
            if (retention == null) continue;
            results.push({
                method: m,
                methodName: METHODS[m].name,
                category: METHODS[m].category,
                retention: _round(retention, 3),
                retentionPercent: _round(retention * 100, 1),
                rating: _classifyCompat(retention),
                compatible: retention >= config.materialThreshold,
                advantages: METHODS[m].advantages,
                limitations: METHODS[m].limitations
            });
        }

        results.sort(function(a, b) { return b.retention - a.retention; });
        return {
            material: materialName,
            description: mat.description,
            methods: results,
            bestMethod: results.length > 0 ? results[0] : null,
            compatibleMethods: results.filter(function(r) { return r.compatible; })
        };
    }

    // ── Protocol recommendation ─────────────────────────────────

    /**
     * Recommend a sterilization protocol given materials and target SAL.
     *
     * Evaluates all methods, filters by material compatibility, and
     * calculates required duration for the target SAL against the
     * most resistant relevant pathogen.
     *
     * @param {object} opts - Protocol requirements.
     * @param {string[]} opts.materials - List of material names present.
     * @param {string} [opts.targetSAL] - Target SAL (default: 10^-6).
     * @param {number} [opts.bioburden] - Initial bioburden CFU.
     * @param {string[]} [opts.pathogens] - Specific pathogens of concern.
     * @param {boolean} [opts.includeSpores=true] - Consider spore-formers.
     * @returns {object} Recommended protocol(s).
     */
    function recommendProtocol(opts) {
        if (!opts || !Array.isArray(opts.materials) || opts.materials.length === 0) {
            throw new Error('At least one material must be specified');
        }
        var targetSAL = opts.targetSAL || config.defaultSAL;
        var bioburden = opts.bioburden || config.defaultBioburden;
        var includeSpores = opts.includeSpores !== false;

        // Determine pathogens to consider
        var targetPathogens = [];
        if (opts.pathogens && opts.pathogens.length > 0) {
            for (var pi = 0; pi < opts.pathogens.length; pi++) {
                _lookupPathogen(opts.pathogens[pi]);  // validate existence
                targetPathogens.push(opts.pathogens[pi]);
            }
        } else {
            var pKeys = Object.keys(pathogens);
            for (var pk = 0; pk < pKeys.length; pk++) {
                if (!includeSpores && pathogens[pKeys[pk]].type === 'spore') continue;
                targetPathogens.push(pKeys[pk]);
            }
        }

        // For each method, check material compatibility and compute required time
        var methodKeys = Object.keys(METHODS);
        var candidates = [];

        for (var mi = 0; mi < methodKeys.length; mi++) {
            var method = methodKeys[mi];
            var methodInfo = METHODS[method];

            // Check all materials are compatible
            var minRetention = 1.0;
            var allCompatible = true;
            var incompatMaterials = [];

            for (var mati = 0; mati < opts.materials.length; mati++) {
                var matName = opts.materials[mati];
                var mat = _lookupMaterial(matName);
                var ret = mat[method];
                if (ret == null || ret < config.materialThreshold) {
                    allCompatible = false;
                    incompatMaterials.push(matName);
                }
                if (ret != null && ret < minRetention) {
                    minRetention = ret;
                }
            }

            // Find worst-case pathogen (highest D-value → hardest to kill)
            var worstPathogen = null;
            var worstDValue = 0;
            var anyEffective = false;

            for (var pti = 0; pti < targetPathogens.length; pti++) {
                var pn = targetPathogens[pti];
                var dv = pathogens[pn][method];
                if (dv != null) {
                    anyEffective = true;
                    if (dv > worstDValue) {
                        worstDValue = dv;
                        worstPathogen = pn;
                    }
                }
            }

            if (!anyEffective) continue;

            // Required log reduction: log10(bioburden / SAL)
            var requiredLogRed = _requiredLogReduction(bioburden, targetSAL);
            // Required duration = D-value * required_log_reduction * safety_factor
            var requiredDuration = worstDValue * requiredLogRed * config.safetyFactor;

            // Check duration is within method limits
            var withinLimits = true;
            if (method === 'gamma') {
                withinLimits = requiredDuration <= METHODS[method].maxDoseKGy;
            } else {
                withinLimits = requiredDuration <= METHODS[method].maxDurationMin;
            }

            candidates.push({
                method: method,
                methodName: methodInfo.name,
                category: methodInfo.category,
                materialCompatible: allCompatible,
                incompatibleMaterials: incompatMaterials,
                minMaterialRetention: _round(minRetention, 3),
                worstCasePathogen: worstPathogen,
                worstCaseDValue: worstDValue,
                requiredLogReduction: _round(requiredLogRed, 2),
                requiredDuration: _round(requiredDuration, 1),
                durationUnit: _durationUnit(method),
                withinLimits: withinLimits,
                feasible: allCompatible && withinLimits,
                score: _scoreCandidate(allCompatible, minRetention, requiredDuration,
                    methodInfo, withinLimits)
            });
        }

        candidates.sort(function(a, b) { return b.score - a.score; });

        var feasible = candidates.filter(function(c) { return c.feasible; });
        var infeasible = candidates.filter(function(c) { return !c.feasible; });

        return {
            materials: opts.materials,
            targetSAL: targetSAL,
            bioburden: bioburden,
            pathogens: targetPathogens,
            recommended: feasible.length > 0 ? feasible[0] : null,
            alternatives: feasible.slice(1),
            infeasible: infeasible,
            summary: feasible.length > 0
                ? 'Recommended: ' + feasible[0].methodName + ' for ' +
                  _round(feasible[0].requiredDuration, 1) + ' ' + feasible[0].durationUnit
                : 'No single-step method is feasible for all specified materials'
        };
    }

    // ── Multi-step protocol planning ────────────────────────────

    /**
     * Plan a multi-step sterilization protocol for complex assemblies
     * where different components need different methods.
     *
     * @param {object[]} components - Array of {name, materials, critical}.
     * @param {object} [opts] - Planning options.
     * @returns {object} Multi-step protocol plan.
     */
    function planMultiStepProtocol(components, opts) {
        if (!Array.isArray(components) || components.length === 0) {
            throw new Error('At least one component is required');
        }
        if (components.length > config.maxProtocolSteps) {
            throw new Error('Maximum ' + config.maxProtocolSteps + ' components supported');
        }

        var options = opts || {};
        var targetSAL = options.targetSAL || config.defaultSAL;
        var bioburden = options.bioburden || config.defaultBioburden;

        var steps = [];
        var totalTimeMin = 0;
        var allFeasible = true;

        for (var ci = 0; ci < components.length; ci++) {
            var comp = components[ci];
            if (!comp.name || !Array.isArray(comp.materials) || comp.materials.length === 0) {
                throw new Error('Each component must have name and materials array');
            }

            var rec = recommendProtocol({
                materials: comp.materials,
                targetSAL: targetSAL,
                bioburden: bioburden,
                includeSpores: comp.critical !== false
            });

            var step = {
                stepNumber: ci + 1,
                component: comp.name,
                materials: comp.materials,
                critical: comp.critical !== false,
                recommendation: rec.recommended,
                alternatives: rec.alternatives.slice(0, 2),
                feasible: rec.recommended !== null
            };

            if (rec.recommended) {
                totalTimeMin += rec.recommended.durationUnit === 'minutes'
                    ? rec.recommended.requiredDuration : 0;
            } else {
                allFeasible = false;
            }

            steps.push(step);
        }

        return {
            components: components.length,
            steps: steps,
            totalTimeMin: _round(totalTimeMin, 1),
            allFeasible: allFeasible,
            summary: allFeasible
                ? 'All components can be sterilized. Total time: ~' + _round(totalTimeMin, 0) + ' min'
                : 'WARNING: Some components have no feasible single-method sterilization'
        };
    }

    // ── Validation record management ────────────────────────────

    /**
     * Record a sterilization validation run with biological indicator results.
     *
     * @param {object} record - Validation record.
     * @returns {object} Stored validation record with analysis.
     */
    function recordValidation(record) {
        if (!record || !record.method || !record.date) {
            throw new Error('Validation record requires method and date');
        }
        _validateMethod(record.method);

        var entry = {
            id: 'VAL-' + String(validationRecords.length + 1).padStart(4, '0'),
            method: record.method,
            methodName: METHODS[record.method].name,
            date: record.date,
            operator: record.operator || 'unknown',
            biIndicator: record.biIndicator || config.defaultPathogen,
            biResult: record.biResult,  // 'pass' or 'fail'
            duration: record.duration,
            temperature: record.temperature,
            loadDescription: record.loadDescription || '',
            notes: record.notes || '',
            passed: record.biResult === 'pass',
            timestamp: Date.now()
        };

        validationRecords.push(entry);

        return entry;
    }

    /**
     * Get validation history with summary statistics.
     *
     * @param {object} [filters] - Optional filters.
     * @param {string} [filters.method] - Filter by method.
     * @param {number} [filters.lastN] - Last N records.
     * @returns {object} Validation history and statistics.
     */
    function getValidationHistory(filters) {
        var records = validationRecords.slice();

        if (filters) {
            if (filters.method) {
                records = records.filter(function(r) {
                    return r.method === filters.method;
                });
            }
            if (typeof filters.lastN === 'number' && filters.lastN > 0) {
                records = records.slice(-filters.lastN);
            }
        }

        var passCount = records.filter(function(r) { return r.passed; }).length;
        var failCount = records.length - passCount;

        return {
            records: records,
            total: records.length,
            passed: passCount,
            failed: failCount,
            passRate: records.length > 0 ? _round(passCount / records.length, 3) : 0,
            lastResult: records.length > 0 ? records[records.length - 1] : null
        };
    }

    // ── Cycle optimization ──────────────────────────────────────

    /**
     * Calculate minimum sterilization duration for target SAL.
     *
     * @param {string} method - Sterilization method.
     * @param {object} [opts] - Options.
     * @param {number} [opts.bioburden] - Initial bioburden.
     * @param {string} [opts.pathogen] - Target pathogen.
     * @param {number} [opts.targetSAL] - Target SAL.
     * @param {boolean} [opts.applyOverkill=true] - Apply safety factor.
     * @returns {object} Minimum cycle parameters.
     */
    function optimizeCycle(method, opts) {
        _validateMethod(method);
        var options = opts || {};
        var bioburden = options.bioburden || config.defaultBioburden;
        var targetSAL = options.targetSAL || config.defaultSAL;
        var applyOverkill = options.applyOverkill !== false;

        var lookup = _lookupPathogen(options.pathogen);

        var dValue = lookup.data[method];
        if (dValue == null) {
            return {
                method: method,
                feasible: false,
                reason: METHODS[method].name + ' is not effective against ' + lookup.name
            };
        }

        var requiredLogRed = _requiredLogReduction(bioburden, targetSAL);
        var minDuration = dValue * requiredLogRed;
        var overkillDuration = minDuration * config.safetyFactor;
        var recommendedDuration = applyOverkill ? overkillDuration : minDuration;

        return {
            method: method,
            methodName: METHODS[method].name,
            pathogen: lookup.name,
            bioburden: bioburden,
            targetSAL: targetSAL,
            dValue: dValue,
            requiredLogReduction: _round(requiredLogRed, 2),
            minimumDuration: _round(minDuration, 2),
            overkillDuration: _round(overkillDuration, 2),
            recommendedDuration: _round(recommendedDuration, 2),
            durationUnit: _durationUnit(method),
            safetyFactor: config.safetyFactor,
            feasible: true
        };
    }

    // ── Compare methods ─────────────────────────────────────────

    /**
     * Compare all sterilization methods against a specific pathogen.
     *
     * @param {string} [pathogenName] - Pathogen to compare against.
     * @param {string[]} [materialNames] - Materials to check compatibility.
     * @returns {object} Comparison matrix.
     */
    function compareMethods(pathogenName, materialNames) {
        var lookup = _lookupPathogen(pathogenName);

        var methodKeys = Object.keys(METHODS);
        var comparison = [];

        for (var i = 0; i < methodKeys.length; i++) {
            var m = methodKeys[i];
            var dv = lookup.data[m];
            var entry = {
                method: m,
                methodName: METHODS[m].name,
                category: METHODS[m].category,
                dValue: dv,
                effective: dv != null,
                temperatureC: METHODS[m].temperatureC
            };

            if (dv != null) {
                // Time to achieve SAL 10^-6 from default bioburden
                var logRed = _requiredLogReduction(config.defaultBioburden, config.defaultSAL);
                entry.timeToSAL = _round(dv * logRed * config.safetyFactor, 1);
                entry.timeUnit = _durationUnit(m);
            }

            // Material compatibility
            if (materialNames && materialNames.length > 0) {
                var matCompat = [];
                for (var mi2 = 0; mi2 < materialNames.length; mi2++) {
                    var mat = materials[materialNames[mi2]];
                    if (mat) {
                        matCompat.push({
                            material: materialNames[mi2],
                            retention: mat[m] != null ? _round(mat[m], 3) : null,
                            compatible: mat[m] != null && mat[m] >= config.materialThreshold
                        });
                    }
                }
                entry.materialCompatibility = matCompat;
            }

            comparison.push(entry);
        }

        // Sort by effectiveness (lowest time to SAL first)
        comparison.sort(function(a, b) {
            if (a.timeToSAL == null) return 1;
            if (b.timeToSAL == null) return -1;
            return a.timeToSAL - b.timeToSAL;
        });

        return {
            pathogen: lookup.name,
            pathogenType: lookup.data.type,
            description: lookup.data.description,
            methods: comparison,
            fastest: comparison.length > 0 && comparison[0].effective ? comparison[0] : null
        };
    }

    // ── Comprehensive report ────────────────────────────────────

    /**
     * Generate a full sterilization report for a bioprinting setup.
     *
     * @param {object} setup - Printer/lab configuration.
     * @param {string[]} setup.materials - Materials in use.
     * @param {string[]} [setup.pathogens] - Pathogens of concern.
     * @param {number} [setup.bioburden] - Expected bioburden.
     * @param {string} [setup.environment] - 'cleanroom' or 'lab'.
     * @returns {object} Comprehensive sterilization report.
     */
    function generateReport(setup) {
        if (!setup || !Array.isArray(setup.materials) || setup.materials.length === 0) {
            throw new Error('Setup must include materials array');
        }

        var env = setup.environment || 'lab';
        var bioburden = setup.bioburden || (env === 'cleanroom' ? 100 : 1000);

        // Analyze each material
        var materialAnalysis = [];
        for (var i = 0; i < setup.materials.length; i++) {
            var matName = setup.materials[i];
            var best = bestMethodsForMaterial(matName);
            materialAnalysis.push(best);
        }

        // Get protocol recommendation
        var protocol = recommendProtocol({
            materials: setup.materials,
            bioburden: bioburden,
            pathogens: setup.pathogens,
            includeSpores: true
        });

        // Validation status
        var validation = getValidationHistory();

        // Risk assessment
        var riskLevel = 'low';
        if (!protocol.recommended) {
            riskLevel = 'high';
        } else if (protocol.recommended.minMaterialRetention < 0.7) {
            riskLevel = 'medium';
        }

        return {
            environment: env,
            bioburden: bioburden,
            materialCount: setup.materials.length,
            materialAnalysis: materialAnalysis,
            recommendedProtocol: protocol,
            validationStatus: {
                totalRuns: validation.total,
                passRate: validation.passRate,
                lastResult: validation.lastResult,
                compliant: validation.passRate >= 0.95 || validation.total === 0
            },
            riskLevel: riskLevel,
            recommendations: _buildRecommendations(protocol, validation, riskLevel),
            generatedAt: new Date().toISOString()
        };
    }

    // ── Custom pathogen/material management ─────────────────────

    function addPathogen(name, data) {
        if (!name || typeof name !== 'string') {
            throw new Error('Pathogen name must be a non-empty string');
        }
        if (!data || typeof data !== 'object') {
            throw new Error('Pathogen data must be an object');
        }
        pathogens[name] = _merge({ type: 'unknown', description: '' }, data);
        return { added: name, pathogen: pathogens[name] };
    }

    function addMaterial(name, data) {
        if (!name || typeof name !== 'string') {
            throw new Error('Material name must be a non-empty string');
        }
        if (!data || typeof data !== 'object') {
            throw new Error('Material data must be an object');
        }
        materials[name] = _merge({ description: '' }, data);
        return { added: name, material: materials[name] };
    }

    function listPathogens() {
        var result = [];
        var keys = Object.keys(pathogens);
        for (var i = 0; i < keys.length; i++) {
            result.push({
                name: keys[i],
                type: pathogens[keys[i]].type,
                description: pathogens[keys[i]].description
            });
        }
        return result;
    }

    function listMaterials() {
        var result = [];
        var keys = Object.keys(materials);
        for (var i = 0; i < keys.length; i++) {
            result.push({
                name: keys[i],
                description: materials[keys[i]].description
            });
        }
        return result;
    }

    function listMethods() {
        var result = [];
        var keys = Object.keys(METHODS);
        for (var i = 0; i < keys.length; i++) {
            var m = METHODS[keys[i]];
            result.push({
                key: keys[i],
                name: m.name,
                category: m.category,
                description: m.description,
                temperatureC: m.temperatureC,
                advantages: m.advantages,
                limitations: m.limitations
            });
        }
        return result;
    }

    // ── Private helpers ─────────────────────────────────────────

    function _validateMethod(method) {
        if (!METHODS[method]) {
            throw new Error('Unknown method: ' + method + '. Available: ' +
                Object.keys(METHODS).join(', '));
        }
    }

    /** Look up a pathogen by name, throwing if unknown. */
    function _lookupPathogen(name) {
        var pName = name || config.defaultPathogen;
        var p = pathogens[pName];
        if (!p) throw new Error('Unknown pathogen: ' + pName);
        return { name: pName, data: p };
    }

    /** Look up a material by name, throwing if unknown. */
    function _lookupMaterial(name) {
        var m = materials[name];
        if (!m) {
            throw new Error('Unknown material: ' + name + '. Available: ' +
                Object.keys(materials).join(', '));
        }
        return m;
    }

    /** Required log reduction to reach target SAL from bioburden. */
    function _requiredLogReduction(bioburden, targetSAL) {
        return Math.log10(bioburden / targetSAL);
    }

    /** Compute log reduction from exposure and D-value. */
    function _logReduction(duration, dValue) {
        return duration / dValue;
    }

    /** Compute survivors from bioburden and log reduction. */
    function _survivors(bioburden, logReduction) {
        return bioburden * Math.pow(10, -logReduction);
    }

    /** Return the duration unit string for a method. */
    function _durationUnit(method) {
        return method === 'gamma' ? 'kGy' : 'minutes';
    }

    function _classifyCompat(retention) {
        if (retention >= 0.9) return 'excellent';
        if (retention >= 0.7) return 'good';
        if (retention >= 0.5) return 'marginal';
        if (retention >= 0.3) return 'poor';
        return 'incompatible';
    }

    function _scoreCandidate(compatible, retention, duration, methodInfo, withinLimits) {
        var score = 0;
        if (!compatible) return score;
        if (!withinLimits) return score + 5;

        // Material preservation (40% weight)
        score += retention * 40;
        // Speed (30% weight) — normalize by max duration
        var maxDur = methodInfo.maxDurationMin || methodInfo.maxDoseKGy || 60;
        var speedScore = Math.max(0, 1 - (duration / maxDur));
        score += speedScore * 30;
        // No toxic residuals bonus (15%)
        if (methodInfo.category !== 'chemical') score += 15;
        // Low temperature bonus (15%)
        if (methodInfo.temperatureC <= 50) score += 15;

        return _round(score, 1);
    }

    function _buildRecommendations(protocol, validation, riskLevel) {
        var recs = [];
        if (protocol.recommended) {
            recs.push('Use ' + protocol.recommended.methodName + ' as primary sterilization method');
            if (protocol.recommended.minMaterialRetention < 0.8) {
                recs.push('Monitor material properties — some degradation expected (' +
                    _round(protocol.recommended.minMaterialRetention * 100, 0) + '% retention)');
            }
        } else {
            recs.push('Consider multi-step sterilization — no single method suits all materials');
        }
        if (validation.total === 0) {
            recs.push('Perform initial sterilization validation with biological indicators');
        } else if (validation.passRate < 1.0) {
            recs.push('Review failed validation runs — ' + validation.failed + ' failures recorded');
        }
        if (riskLevel === 'high') {
            recs.push('HIGH RISK: Consult sterilization specialist before proceeding');
        }
        recs.push('Maintain sterilization validation records per ISO 11137 / ISO 17665');
        return recs;
    }

    function _round(n, decimals) {
        var factor = Math.pow(10, decimals);
        return Math.round(n * factor) / factor;
    }

    function _merge(target, source) {
        var result = {};
        var keys = Object.keys(target);
        for (var i = 0; i < keys.length; i++) result[keys[i]] = target[keys[i]];
        keys = Object.keys(source);
        for (var j = 0; j < keys.length; j++) result[keys[j]] = source[keys[j]];
        return result;
    }

    function _deepCopy(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    // ── Public API ──────────────────────────────────────────────

    return {
        calculateKillKinetics: calculateKillKinetics,
        generateKillCurve: generateKillCurve,
        assessMaterialCompat: assessMaterialCompat,
        bestMethodsForMaterial: bestMethodsForMaterial,
        recommendProtocol: recommendProtocol,
        planMultiStepProtocol: planMultiStepProtocol,
        recordValidation: recordValidation,
        getValidationHistory: getValidationHistory,
        optimizeCycle: optimizeCycle,
        compareMethods: compareMethods,
        generateReport: generateReport,
        addPathogen: addPathogen,
        addMaterial: addMaterial,
        listPathogens: listPathogens,
        listMaterials: listMaterials,
        listMethods: listMethods
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createSterilizationAnalyzer: createSterilizationAnalyzer };
}
