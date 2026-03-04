'use strict';

/**
 * Multi-Nozzle Coordination Planner for BioBots
 *
 * Plans multi-material bioprinting sessions using multiple nozzles.
 * In multi-material bioprinting, different bioinks (e.g., structural
 * hydrogel + cell-laden bioink + sacrificial support) are deposited
 * through separate nozzles. Coordinating nozzle switches, purge
 * sequences, temperature equilibration, and print ordering is
 * critical for print quality and cell viability.
 *
 * Features:
 *   - Nozzle configuration with material assignment and temperature
 *   - Layer-by-layer print plan generation with nozzle scheduling
 *   - Purge/prime sequence planning between material switches
 *   - Temperature transition timing (pre-heat, dwell, cool-down)
 *   - Material switch minimization via region grouping
 *   - Time estimation (print + transitions + purge)
 *   - Collision zone detection between nozzle offsets
 *   - Print plan validation and optimization suggestions
 *
 * References:
 *   - Multi-material bioprinting: Skylar-Scott et al., Science Advances (2019)
 *   - Nozzle offset calibration: Kang et al., Nature Biotechnology (2016)
 *   - Purge volume models: Lewis lab, Harvard (PDMS-based fugitive inks)
 */

function createNozzlePlanner(userConfig) {
    // ── Default nozzle profiles ─────────────────────────────────

    var DEFAULT_NOZZLES = {
        'pneumatic-200': {
            type: 'pneumatic',
            innerDiameter: 0.200,
            outerDiameter: 0.420,
            maxPressure: 150,
            tempRange: [4, 40],
            primeVolume: 0.8,
            purgeVolume: 1.2,
            description: 'Standard 200\u00b5m pneumatic nozzle'
        },
        'pneumatic-400': {
            type: 'pneumatic',
            innerDiameter: 0.400,
            outerDiameter: 0.720,
            maxPressure: 100,
            tempRange: [4, 40],
            primeVolume: 1.5,
            purgeVolume: 2.0,
            description: 'Large 400\u00b5m pneumatic nozzle'
        },
        'piezoelectric-100': {
            type: 'piezoelectric',
            innerDiameter: 0.100,
            outerDiameter: 0.250,
            maxPressure: 0,
            tempRange: [15, 37],
            primeVolume: 0.3,
            purgeVolume: 0.5,
            description: '100\u00b5m piezoelectric nozzle for precise deposition'
        },
        'heated-300': {
            type: 'heated',
            innerDiameter: 0.300,
            outerDiameter: 0.550,
            maxPressure: 200,
            tempRange: [20, 80],
            primeVolume: 1.0,
            purgeVolume: 1.8,
            description: '300\u00b5m heated nozzle for thermoplastic bioinks'
        },
        'uv-250': {
            type: 'uv-curing',
            innerDiameter: 0.250,
            outerDiameter: 0.450,
            maxPressure: 120,
            tempRange: [4, 37],
            primeVolume: 0.6,
            purgeVolume: 1.0,
            description: '250\u00b5m nozzle with integrated UV-LED for in-situ curing'
        }
    };

    // ── Material profiles for multi-nozzle planning ────────────

    var DEFAULT_MATERIALS = {
        'gelma-5': {
            name: 'GelMA 5%',
            type: 'photocrosslinkable',
            printTemp: 22,
            storageTemp: 4,
            viscosity: 'low',
            gelationTime: 15,
            cellCompatible: true,
            supportMaterial: false,
            purgeMultiplier: 1.0
        },
        'alginate-3': {
            name: 'Alginate 3%',
            type: 'ionic-crosslink',
            printTemp: 25,
            storageTemp: 20,
            viscosity: 'low',
            gelationTime: 30,
            cellCompatible: true,
            supportMaterial: false,
            purgeMultiplier: 0.8
        },
        'pluronic-f127': {
            name: 'Pluronic F-127 40%',
            type: 'thermoreversible',
            printTemp: 37,
            storageTemp: 4,
            viscosity: 'high',
            gelationTime: 0,
            cellCompatible: false,
            supportMaterial: true,
            purgeMultiplier: 1.5
        },
        'collagen-i': {
            name: 'Collagen Type I',
            type: 'thermal-crosslink',
            printTemp: 10,
            storageTemp: 4,
            viscosity: 'medium',
            gelationTime: 300,
            cellCompatible: true,
            supportMaterial: false,
            purgeMultiplier: 1.2
        },
        'pcl': {
            name: 'PCL (Polycaprolactone)',
            type: 'thermoplastic',
            printTemp: 65,
            storageTemp: 20,
            viscosity: 'high',
            gelationTime: 0,
            cellCompatible: false,
            supportMaterial: false,
            purgeMultiplier: 2.0
        },
        'hyaluronic-acid': {
            name: 'HA-Tyramine',
            type: 'enzymatic-crosslink',
            printTemp: 25,
            storageTemp: 4,
            viscosity: 'medium',
            gelationTime: 60,
            cellCompatible: true,
            supportMaterial: false,
            purgeMultiplier: 1.0
        }
    };

    var config = {
        nozzleSpacing: 15.0,
        maxNozzles: 4,
        tempTransitionRate: 2.0,
        purgeStationX: -20,
        purgeStationY: 0,
        travelSpeed: 50,
        printSpeed: 10,
        switchPenalty: 5.0,
        maxTempDelta: 60,
        collisionClearance: 2.0
    };

    if (userConfig) {
        var keys = Object.keys(userConfig);
        for (var i = 0; i < keys.length; i++) {
            if (config.hasOwnProperty(keys[i])) {
                config[keys[i]] = userConfig[keys[i]];
            }
        }
    }

    // ── Helpers ─────────────────────────────────────────────────

    function _distance(x1, y1, x2, y2) {
        var dx = x2 - x1;
        var dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ── Nozzle configuration ───────────────────────────────────

    /**
     * Creates a nozzle assignment: which nozzle holds which material,
     * at what position offset from the reference nozzle.
     */
    function configureNozzles(assignments) {
        if (!Array.isArray(assignments) || assignments.length === 0) {
            throw new Error('At least one nozzle assignment is required');
        }
        if (assignments.length > config.maxNozzles) {
            throw new Error('Cannot exceed ' + config.maxNozzles + ' nozzles');
        }

        var nozzles = [];
        var usedIds = {};

        for (var i = 0; i < assignments.length; i++) {
            var a = assignments[i];
            var id = a.id || ('nozzle-' + (i + 1));
            if (usedIds[id]) {
                throw new Error('Duplicate nozzle ID: ' + id);
            }
            usedIds[id] = true;

            var profile = null;
            if (typeof a.nozzleProfile === 'string') {
                profile = DEFAULT_NOZZLES[a.nozzleProfile];
                if (!profile) {
                    throw new Error('Unknown nozzle profile: ' + a.nozzleProfile);
                }
            } else if (a.nozzleProfile && typeof a.nozzleProfile === 'object') {
                profile = a.nozzleProfile;
            } else {
                profile = DEFAULT_NOZZLES['pneumatic-200'];
            }

            var material = null;
            if (a.materialId) {
                material = DEFAULT_MATERIALS[a.materialId];
                if (!material) {
                    material = { name: a.materialId, printTemp: 25, purgeMultiplier: 1.0 };
                }
            }

            if (material && profile.tempRange) {
                if (material.printTemp < profile.tempRange[0] ||
                    material.printTemp > profile.tempRange[1]) {
                    throw new Error(
                        'Material ' + (material.name || a.materialId) +
                        ' print temp (' + material.printTemp +
                        '\u00b0C) outside nozzle range [' +
                        profile.tempRange[0] + '-' + profile.tempRange[1] + '\u00b0C]'
                    );
                }
            }

            nozzles.push({
                id: id,
                index: i,
                profile: profile,
                material: material,
                materialId: a.materialId || null,
                offsetX: typeof a.offsetX === 'number' ? a.offsetX : i * config.nozzleSpacing,
                offsetY: typeof a.offsetY === 'number' ? a.offsetY : 0,
                currentTemp: material ? material.storageTemp : 25
            });
        }

        return { nozzles: nozzles, count: nozzles.length, valid: true };
    }

    // ── Collision detection ─────────────────────────────────────

    /**
     * Checks for potential collision zones between nozzles based on
     * their physical offsets and outer diameters.
     */
    function checkCollisions(nozzleConfig) {
        var nozzles = nozzleConfig.nozzles;
        var pairs = [];
        var hasCollision = false;
        var minClearance = Infinity;

        for (var i = 0; i < nozzles.length; i++) {
            for (var j = i + 1; j < nozzles.length; j++) {
                var ni = nozzles[i];
                var nj = nozzles[j];
                var dist = _distance(ni.offsetX, ni.offsetY, nj.offsetX, nj.offsetY);
                var minRequired = (ni.profile.outerDiameter + nj.profile.outerDiameter) / 2
                                  + config.collisionClearance;
                var clearance = dist - minRequired;

                if (clearance < minClearance) minClearance = clearance;

                var pair = {
                    nozzle1: ni.id,
                    nozzle2: nj.id,
                    distance: Math.round(dist * 1000) / 1000,
                    minRequired: Math.round(minRequired * 1000) / 1000,
                    clearance: Math.round(clearance * 1000) / 1000,
                    safe: clearance >= 0
                };

                if (!pair.safe) hasCollision = true;
                pairs.push(pair);
            }
        }

        return {
            pairs: pairs,
            hasCollision: hasCollision,
            minClearance: minClearance === Infinity ? 0 : Math.round(minClearance * 1000) / 1000,
            nozzleCount: nozzles.length
        };
    }

    // ── Temperature transition planning ────────────────────────

    /**
     * Calculates temperature transition time and sequence when switching
     * between nozzles with different target temperatures.
     */
    function planTempTransition(fromTemp, toTemp) {
        if (typeof fromTemp !== 'number' || typeof toTemp !== 'number') {
            throw new Error('Temperatures must be numbers');
        }

        var delta = Math.abs(toTemp - fromTemp);
        if (delta > config.maxTempDelta) {
            throw new Error(
                'Temperature delta ' + delta + '\u00b0C exceeds max ' +
                config.maxTempDelta + '\u00b0C'
            );
        }

        var transitionTime = delta / config.tempTransitionRate;
        var dwellTime = Math.max(2, transitionTime * 0.1);

        return {
            fromTemp: fromTemp,
            toTemp: toTemp,
            delta: delta,
            direction: toTemp > fromTemp ? 'heating' : (toTemp < fromTemp ? 'cooling' : 'none'),
            transitionTime: Math.round(transitionTime * 10) / 10,
            dwellTime: Math.round(dwellTime * 10) / 10,
            totalTime: Math.round((transitionTime + dwellTime) * 10) / 10,
            riskLevel: delta > 30 ? 'high' : (delta > 15 ? 'medium' : 'low')
        };
    }

    // ── Purge sequence planning ────────────────────────────────

    /**
     * Plans the purge and prime sequence when switching from one nozzle
     * to another.
     */
    function planPurgeSequence(fromNozzle, toNozzle) {
        if (!fromNozzle || !toNozzle) {
            throw new Error('Both fromNozzle and toNozzle are required');
        }

        var fromMaterial = fromNozzle.material || {};
        var toMaterial = toNozzle.material || {};

        var purgeVol = fromNozzle.profile.purgeVolume *
                       (fromMaterial.purgeMultiplier || 1.0);
        var primeVol = toNozzle.profile.primeVolume *
                       (toMaterial.purgeMultiplier || 1.0);

        var crossContamRisk = 'low';
        if (fromMaterial.type !== toMaterial.type) {
            crossContamRisk = 'medium';
        }
        if ((fromMaterial.cellCompatible && !toMaterial.cellCompatible) ||
            (!fromMaterial.cellCompatible && toMaterial.cellCompatible)) {
            crossContamRisk = 'high';
        }

        if (crossContamRisk === 'high') {
            purgeVol *= 1.5;
            primeVol *= 1.3;
        }

        var travelTime = 2 * _distance(0, 0, config.purgeStationX, config.purgeStationY)
                         / config.travelSpeed;

        var purgeFlowRate = Math.PI * Math.pow(fromNozzle.profile.innerDiameter / 2, 2) * 10;
        var purgeTime = purgeVol / Math.max(0.01, purgeFlowRate);
        var primeFlowRate = Math.PI * Math.pow(toNozzle.profile.innerDiameter / 2, 2) * 10;
        var primeTime = primeVol / Math.max(0.01, primeFlowRate);

        return {
            purgeVolume: Math.round(purgeVol * 100) / 100,
            primeVolume: Math.round(primeVol * 100) / 100,
            totalWasteVolume: Math.round((purgeVol + primeVol) * 100) / 100,
            purgeTime: Math.round(purgeTime * 10) / 10,
            primeTime: Math.round(primeTime * 10) / 10,
            travelTime: Math.round(travelTime * 10) / 10,
            totalTime: Math.round((purgeTime + primeTime + travelTime + config.switchPenalty) * 10) / 10,
            crossContamRisk: crossContamRisk,
            steps: [
                { action: 'retract', nozzle: fromNozzle.id, detail: 'Retract ' + (fromMaterial.name || 'material') },
                { action: 'travel-to-purge', detail: 'Move to purge station' },
                { action: 'purge', nozzle: fromNozzle.id, volume: Math.round(purgeVol * 100) / 100 },
                { action: 'activate', nozzle: toNozzle.id, detail: 'Engage ' + (toMaterial.name || 'material') },
                { action: 'prime', nozzle: toNozzle.id, volume: Math.round(primeVol * 100) / 100 },
                { action: 'travel-to-print', detail: 'Return to print position' }
            ]
        };
    }

    // ── Layer plan generation ──────────────────────────────────

    /**
     * Generates a layer-by-layer print plan that minimizes nozzle switches.
     * Each layer can have regions assigned to different materials.
     */
    function generateLayerPlan(nozzleConfig, layers) {
        if (!nozzleConfig || !nozzleConfig.nozzles) {
            throw new Error('Valid nozzle configuration required');
        }
        if (!Array.isArray(layers) || layers.length === 0) {
            throw new Error('At least one layer definition is required');
        }

        var nozzles = nozzleConfig.nozzles;

        var materialNozzleMap = {};
        for (var n = 0; n < nozzles.length; n++) {
            if (nozzles[n].materialId) {
                materialNozzleMap[nozzles[n].materialId] = nozzles[n];
            }
        }

        var layerPlans = [];
        var totalPrintTime = 0;
        var totalSwitchTime = 0;
        var totalPurgeWaste = 0;
        var totalSwitches = 0;
        var prevNozzle = null;

        for (var li = 0; li < layers.length; li++) {
            var layer = layers[li];
            var layerHeight = layer.height || 0.2;
            var regions = layer.regions || [];

            // Sort regions to minimize switches: keep current nozzle's material first
            var currentNozzle = prevNozzle;
            var sorted = regions.slice().sort(function(a, b) {
                if (currentNozzle && a.materialId === currentNozzle.materialId) return -1;
                if (currentNozzle && b.materialId === currentNozzle.materialId) return 1;
                return (a.materialId || '').localeCompare(b.materialId || '');
            });

            var layerSteps = [];
            var layerPrintTime = 0;
            var layerSwitchTime = 0;
            var layerPurgeWaste = 0;
            var layerSwitches = 0;

            for (var ri = 0; ri < sorted.length; ri++) {
                var region = sorted[ri];
                var nozzle = materialNozzleMap[region.materialId];

                if (!nozzle) {
                    throw new Error(
                        'No nozzle assigned for material: ' + region.materialId +
                        ' in layer ' + (li + 1)
                    );
                }

                if (prevNozzle && prevNozzle.id !== nozzle.id) {
                    var purge = planPurgeSequence(prevNozzle, nozzle);
                    var tempTrans = planTempTransition(
                        prevNozzle.material ? prevNozzle.material.printTemp : 25,
                        nozzle.material ? nozzle.material.printTemp : 25
                    );

                    var switchTime = purge.totalTime + tempTrans.totalTime;
                    layerSwitchTime += switchTime;
                    layerPurgeWaste += purge.totalWasteVolume;
                    layerSwitches++;

                    layerSteps.push({
                        type: 'switch',
                        from: prevNozzle.id,
                        to: nozzle.id,
                        purge: purge,
                        tempTransition: tempTrans,
                        time: Math.round(switchTime * 10) / 10
                    });
                }

                var regionPerimeter = region.perimeter || 0;
                var regionArea = region.area || 0;
                var infillLength = regionArea > 0
                    ? regionArea / (nozzle.profile.innerDiameter * 1.2)
                    : 0;
                var totalPath = regionPerimeter + infillLength;
                var regionPrintTime = totalPath / config.printSpeed;

                layerPrintTime += regionPrintTime;

                layerSteps.push({
                    type: 'print',
                    nozzle: nozzle.id,
                    material: nozzle.materialId,
                    area: regionArea,
                    perimeter: regionPerimeter,
                    toolpathLength: Math.round(totalPath * 10) / 10,
                    time: Math.round(regionPrintTime * 10) / 10
                });

                prevNozzle = nozzle;
            }

            var layerTotalTime = layerPrintTime + layerSwitchTime;
            totalPrintTime += layerPrintTime;
            totalSwitchTime += layerSwitchTime;
            totalPurgeWaste += layerPurgeWaste;
            totalSwitches += layerSwitches;

            layerPlans.push({
                layerIndex: li,
                height: layerHeight,
                regionCount: regions.length,
                steps: layerSteps,
                nozzleSwitches: layerSwitches,
                printTime: Math.round(layerPrintTime * 10) / 10,
                switchTime: Math.round(layerSwitchTime * 10) / 10,
                totalTime: Math.round(layerTotalTime * 10) / 10,
                purgeWaste: Math.round(layerPurgeWaste * 100) / 100
            });
        }

        var grandTotal = totalPrintTime + totalSwitchTime;

        return {
            layers: layerPlans,
            layerCount: layers.length,
            summary: {
                totalPrintTime: Math.round(totalPrintTime * 10) / 10,
                totalSwitchTime: Math.round(totalSwitchTime * 10) / 10,
                totalTime: Math.round(grandTotal * 10) / 10,
                totalTimeFormatted: _formatTime(grandTotal),
                totalNozzleSwitches: totalSwitches,
                totalPurgeWaste: Math.round(totalPurgeWaste * 100) / 100,
                switchOverhead: grandTotal > 0
                    ? Math.round(totalSwitchTime / grandTotal * 100 * 10) / 10
                    : 0,
                efficiency: grandTotal > 0
                    ? Math.round(totalPrintTime / grandTotal * 100 * 10) / 10
                    : 100
            }
        };
    }

    function _formatTime(seconds) {
        var h = Math.floor(seconds / 3600);
        var m = Math.floor((seconds % 3600) / 60);
        var s = Math.round(seconds % 60);
        if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
        if (m > 0) return m + 'm ' + s + 's';
        return s + 's';
    }

    // ── Switch optimization ────────────────────────────────────

    /**
     * Analyzes a print plan and suggests optimizations to reduce
     * nozzle switches and improve efficiency.
     */
    function optimizePlan(plan) {
        if (!plan || !plan.layers) {
            throw new Error('Valid print plan required');
        }

        var suggestions = [];
        var totalSwitches = plan.summary.totalNozzleSwitches;
        var switchOverhead = plan.summary.switchOverhead;

        var switchSequence = [];
        for (var i = 0; i < plan.layers.length; i++) {
            var steps = plan.layers[i].steps;
            for (var j = 0; j < steps.length; j++) {
                if (steps[j].type === 'switch') {
                    switchSequence.push({ from: steps[j].from, to: steps[j].to, layer: i });
                }
            }
        }

        var pingPongs = 0;
        for (var k = 1; k < switchSequence.length; k++) {
            if (switchSequence[k].to === switchSequence[k - 1].from &&
                switchSequence[k].from === switchSequence[k - 1].to) {
                pingPongs++;
            }
        }

        if (pingPongs > 0) {
            suggestions.push({
                type: 'reorder',
                severity: 'high',
                message: pingPongs + ' ping-pong switch pattern(s) detected. ' +
                         'Consider grouping regions by material within each layer.'
            });
        }

        if (switchOverhead > 30) {
            suggestions.push({
                type: 'overhead',
                severity: 'high',
                message: 'Switch overhead is ' + switchOverhead + '% of total time. ' +
                         'Consider redesigning layer regions to reduce material interleaving.'
            });
        } else if (switchOverhead > 15) {
            suggestions.push({
                type: 'overhead',
                severity: 'medium',
                message: 'Switch overhead is ' + switchOverhead + '% of total time. ' +
                         'This is acceptable but could be improved.'
            });
        }

        var heavySwitchLayers = [];
        for (var m = 0; m < plan.layers.length; m++) {
            if (plan.layers[m].nozzleSwitches > 3) {
                heavySwitchLayers.push(m + 1);
            }
        }
        if (heavySwitchLayers.length > 0) {
            suggestions.push({
                type: 'layer-complexity',
                severity: 'medium',
                message: 'Layer(s) ' + heavySwitchLayers.join(', ') +
                         ' have >3 nozzle switches. Consider simplifying region layout.'
            });
        }

        var switchTimes = [];
        for (var p = 0; p < plan.layers.length; p++) {
            var lsteps = plan.layers[p].steps;
            for (var q = 0; q < lsteps.length; q++) {
                if (lsteps[q].type === 'switch') {
                    switchTimes.push({
                        layer: p + 1,
                        from: lsteps[q].from,
                        to: lsteps[q].to,
                        time: lsteps[q].time
                    });
                }
            }
        }
        switchTimes.sort(function(a, b) { return b.time - a.time; });

        return {
            totalSwitches: totalSwitches,
            switchOverhead: switchOverhead,
            pingPongPatterns: pingPongs,
            heavySwitchLayers: heavySwitchLayers,
            suggestions: suggestions,
            costliestSwitches: switchTimes.slice(0, 5),
            optimizationScore: _calcOptScore(switchOverhead, pingPongs, heavySwitchLayers.length)
        };
    }

    function _calcOptScore(overhead, pingPongs, heavyLayers) {
        var score = 100;
        score -= overhead * 0.8;
        score -= pingPongs * 5;
        score -= heavyLayers * 3;
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    // ── Material compatibility check ───────────────────────────

    /**
     * Checks material compatibility for multi-nozzle printing.
     */
    function checkMaterialCompatibility(nozzleConfig) {
        var nozzles = nozzleConfig.nozzles;
        var warnings = [];
        var compatible = true;

        var temps = [];
        for (var i = 0; i < nozzles.length; i++) {
            if (nozzles[i].material) {
                temps.push({
                    nozzle: nozzles[i].id,
                    temp: nozzles[i].material.printTemp,
                    material: nozzles[i].material.name
                });
            }
        }

        if (temps.length >= 2) {
            var minT = temps[0].temp;
            var maxT = temps[0].temp;
            for (var t = 1; t < temps.length; t++) {
                if (temps[t].temp < minT) minT = temps[t].temp;
                if (temps[t].temp > maxT) maxT = temps[t].temp;
            }
            var spread = maxT - minT;

            if (spread > 40) {
                warnings.push({
                    type: 'temperature-spread',
                    severity: 'high',
                    message: 'Temperature spread of ' + spread +
                             '\u00b0C between materials. ' +
                             'Large temperature differences increase transition time and may affect adjacent materials.'
                });
                compatible = false;
            } else if (spread > 20) {
                warnings.push({
                    type: 'temperature-spread',
                    severity: 'medium',
                    message: 'Temperature spread of ' + spread +
                             '\u00b0C between materials. ' +
                             'Moderate transition times expected.'
                });
            }
        }

        var hasCellMat = false;
        var hasNonCellMat = false;
        for (var c = 0; c < nozzles.length; c++) {
            if (nozzles[c].material) {
                if (nozzles[c].material.cellCompatible) hasCellMat = true;
                else hasNonCellMat = true;
            }
        }

        if (hasCellMat && hasNonCellMat) {
            warnings.push({
                type: 'cross-contamination',
                severity: 'medium',
                message: 'Mix of cell-compatible and non-compatible materials. ' +
                         'Ensure thorough purging between switches to prevent cytotoxicity.'
            });
        }

        var crosslinkTypes = {};
        for (var x = 0; x < nozzles.length; x++) {
            if (nozzles[x].material && nozzles[x].material.type) {
                crosslinkTypes[nozzles[x].material.type] = true;
            }
        }

        if (crosslinkTypes['photocrosslinkable'] && crosslinkTypes['thermal-crosslink']) {
            warnings.push({
                type: 'crosslink-conflict',
                severity: 'low',
                message: 'Photo-crosslinkable and thermal-crosslink materials together. ' +
                         'Ensure UV exposure does not prematurely affect thermal-crosslinking regions.'
            });
        }

        return {
            compatible: compatible,
            warnings: warnings,
            materialCount: temps.length,
            temperatureSpread: temps.length >= 2
                ? (function() {
                    var mn = temps[0].temp, mx = temps[0].temp;
                    for (var ii = 1; ii < temps.length; ii++) {
                        if (temps[ii].temp < mn) mn = temps[ii].temp;
                        if (temps[ii].temp > mx) mx = temps[ii].temp;
                    }
                    return mx - mn;
                })()
                : 0,
            materials: temps
        };
    }

    // ── Print time estimation ──────────────────────────────────

    /**
     * Estimates total print time for a multi-nozzle job including
     * all transitions, purges, and temperature changes.
     */
    function estimatePrintTime(nozzleConfig, totalVolume, layerCount, switchesPerLayer) {
        if (totalVolume <= 0) throw new Error('Total volume must be positive');
        if (layerCount <= 0) throw new Error('Layer count must be positive');
        if (switchesPerLayer < 0) throw new Error('Switches per layer cannot be negative');

        var nozzles = nozzleConfig.nozzles;

        var avgArea = 0;
        for (var i = 0; i < nozzles.length; i++) {
            avgArea += Math.PI * Math.pow(nozzles[i].profile.innerDiameter / 2, 2);
        }
        avgArea /= nozzles.length;

        var flowRate = avgArea * config.printSpeed;
        var purePrintTime = totalVolume / flowRate;

        var avgSwitchTime = config.switchPenalty;
        if (nozzles.length >= 2) {
            var avgTempDelta = 0;
            var pairs = 0;
            for (var a = 0; a < nozzles.length; a++) {
                for (var b = a + 1; b < nozzles.length; b++) {
                    var tA = nozzles[a].material ? nozzles[a].material.printTemp : 25;
                    var tB = nozzles[b].material ? nozzles[b].material.printTemp : 25;
                    avgTempDelta += Math.abs(tA - tB);
                    pairs++;
                }
            }
            avgTempDelta = pairs > 0 ? avgTempDelta / pairs : 0;
            avgSwitchTime += avgTempDelta / config.tempTransitionRate + 2;
        }

        var totalSwitches = Math.round(layerCount * switchesPerLayer);
        var totalSwitchTimeSec = totalSwitches * avgSwitchTime;

        var avgPurgeVol = 0;
        for (var p = 0; p < nozzles.length; p++) {
            var mult = nozzles[p].material ? nozzles[p].material.purgeMultiplier : 1.0;
            avgPurgeVol += (nozzles[p].profile.purgeVolume + nozzles[p].profile.primeVolume) * mult;
        }
        avgPurgeVol /= nozzles.length;
        var totalPurgeWaste = totalSwitches * avgPurgeVol;

        var grandTotal = purePrintTime + totalSwitchTimeSec;

        return {
            purePrintTime: Math.round(purePrintTime * 10) / 10,
            totalSwitchTime: Math.round(totalSwitchTimeSec * 10) / 10,
            totalTime: Math.round(grandTotal * 10) / 10,
            totalTimeFormatted: _formatTime(grandTotal),
            totalSwitches: totalSwitches,
            totalPurgeWaste: Math.round(totalPurgeWaste * 100) / 100,
            efficiency: grandTotal > 0
                ? Math.round(purePrintTime / grandTotal * 100 * 10) / 10
                : 100,
            breakdown: {
                printPercent: grandTotal > 0
                    ? Math.round(purePrintTime / grandTotal * 100 * 10) / 10 : 100,
                switchPercent: grandTotal > 0
                    ? Math.round(totalSwitchTimeSec / grandTotal * 100 * 10) / 10 : 0
            }
        };
    }

    // ── Comprehensive report ───────────────────────────────────

    /**
     * Generates a comprehensive multi-nozzle print planning report.
     */
    function generateReport(nozzleConfig, layers) {
        var collisions = checkCollisions(nozzleConfig);
        var compatibility = checkMaterialCompatibility(nozzleConfig);
        var plan = generateLayerPlan(nozzleConfig, layers);
        var optimization = optimizePlan(plan);

        var issues = [];
        if (collisions.hasCollision) {
            issues.push('CRITICAL: Nozzle collision detected \u2014 adjust nozzle spacing');
        }
        if (!compatibility.compatible) {
            issues.push('WARNING: Material compatibility issues \u2014 review temperature spread');
        }
        if (optimization.optimizationScore < 50) {
            issues.push('WARNING: Low optimization score (' + optimization.optimizationScore +
                        '/100) \u2014 consider reordering regions');
        }

        return {
            configuration: {
                nozzleCount: nozzleConfig.count,
                nozzles: nozzleConfig.nozzles.map(function(n) {
                    return {
                        id: n.id,
                        type: n.profile.type,
                        diameter: n.profile.innerDiameter,
                        material: n.materialId,
                        materialName: n.material ? n.material.name : null,
                        printTemp: n.material ? n.material.printTemp : null
                    };
                })
            },
            collisionCheck: collisions,
            materialCompatibility: compatibility,
            printPlan: plan,
            optimization: optimization,
            issues: issues,
            viable: !collisions.hasCollision && issues.filter(function(i) {
                return i.indexOf('CRITICAL') === 0;
            }).length === 0,
            generatedAt: new Date().toISOString()
        };
    }

    // ── Text summary ───────────────────────────────────────────

    /**
     * Generates a human-readable text summary of a multi-nozzle report.
     */
    function textSummary(report) {
        var lines = [];
        lines.push('=== MULTI-NOZZLE PRINT PLAN ===');
        lines.push('');

        lines.push('Nozzles (' + report.configuration.nozzleCount + '):');
        for (var i = 0; i < report.configuration.nozzles.length; i++) {
            var n = report.configuration.nozzles[i];
            lines.push('  ' + n.id + ': ' + (n.materialName || 'unassigned') +
                        ' (' + n.type + ' ' + n.diameter + 'mm' +
                        (n.printTemp !== null ? ', ' + n.printTemp + '\u00b0C' : '') + ')');
        }
        lines.push('');

        lines.push('Collision Check: ' +
                    (report.collisionCheck.hasCollision ? 'FAIL' : 'PASS') +
                    ' (min clearance: ' + report.collisionCheck.minClearance + 'mm)');
        lines.push('Material Compatibility: ' +
                    (report.materialCompatibility.compatible ? 'OK' : 'ISSUES') +
                    ' (temp spread: ' + report.materialCompatibility.temperatureSpread + '\u00b0C)');
        lines.push('');

        var s = report.printPlan.summary;
        lines.push('Print Plan (' + report.printPlan.layerCount + ' layers):');
        lines.push('  Print time:    ' + s.totalTimeFormatted);
        lines.push('  Pure printing: ' + Math.round(s.totalPrintTime) + 's (' + s.efficiency + '%)');
        lines.push('  Switch time:   ' + Math.round(s.totalSwitchTime) + 's (' + s.switchOverhead + '%)');
        lines.push('  Switches:      ' + s.totalNozzleSwitches);
        lines.push('  Purge waste:   ' + s.totalPurgeWaste + ' \u00b5L');
        lines.push('');

        lines.push('Optimization Score: ' + report.optimization.optimizationScore + '/100');
        if (report.optimization.suggestions.length > 0) {
            lines.push('Suggestions:');
            for (var j = 0; j < report.optimization.suggestions.length; j++) {
                var sug = report.optimization.suggestions[j];
                lines.push('  [' + sug.severity.toUpperCase() + '] ' + sug.message);
            }
        }

        if (report.issues.length > 0) {
            lines.push('');
            lines.push('Issues:');
            for (var k = 0; k < report.issues.length; k++) {
                lines.push('  ! ' + report.issues[k]);
            }
        }

        lines.push('');
        lines.push('Viable: ' + (report.viable ? 'YES' : 'NO'));

        return lines.join('\n');
    }

    // ── Public API ─────────────────────────────────────────────

    return {
        configureNozzles: configureNozzles,
        checkCollisions: checkCollisions,
        planTempTransition: planTempTransition,
        planPurgeSequence: planPurgeSequence,
        generateLayerPlan: generateLayerPlan,
        optimizePlan: optimizePlan,
        checkMaterialCompatibility: checkMaterialCompatibility,
        estimatePrintTime: estimatePrintTime,
        generateReport: generateReport,
        textSummary: textSummary,
        DEFAULT_NOZZLES: DEFAULT_NOZZLES,
        DEFAULT_MATERIALS: DEFAULT_MATERIALS
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createNozzlePlanner: createNozzlePlanner };
}
