'use strict';

var round = require('./validation').round;

/**
 * GCode Analyzer for BioBots bioprinter.
 *
 * Parses GCode text and extracts print metrics: extrusion volume,
 * travel distance, estimated print time, layer breakdown, speed
 * profiles, and retraction statistics.
 *
 * Supports G0/G1 (linear moves), G28 (home), G92 (set position),
 * and M-codes for temperature/fan. Ignores unknown commands gracefully.
 */
function createGCodeAnalyzer() {

    /**
     * Parse a single GCode line into a command object.
     * Strips comments (everything after ';') and whitespace.
     *
     * @param {string} raw - Raw GCode line.
     * @returns {{ cmd: string, params: object, comment: string }|null}
     *   null if line is empty or comment-only.
     */
    function parseLine(raw) {
        if (typeof raw !== 'string') return null;
        var commentIdx = raw.indexOf(';');
        var comment = '';
        var code = raw;
        if (commentIdx >= 0) {
            comment = raw.substring(commentIdx + 1).trim();
            code = raw.substring(0, commentIdx);
        }
        code = code.trim();
        if (!code) return comment ? { cmd: '', params: {}, comment: comment } : null;

        // Manual token extraction avoids regex split overhead on hot path.
        // GCode lines are short (< 80 chars) so simple char scanning is fast.
        var params = {};
        var cmd = '';
        var len = code.length;
        var pos = 0;

        // Skip leading whitespace (already trimmed, but defensive)
        while (pos < len && code.charCodeAt(pos) <= 32) pos++;

        // Extract command token
        var tokStart = pos;
        while (pos < len && code.charCodeAt(pos) > 32) pos++;
        cmd = code.substring(tokStart, pos).toUpperCase();

        // Extract parameter tokens
        while (pos < len) {
            while (pos < len && code.charCodeAt(pos) <= 32) pos++;
            if (pos >= len) break;
            tokStart = pos;
            while (pos < len && code.charCodeAt(pos) > 32) pos++;
            var tok = code.substring(tokStart, pos);
            if (tok.length < 2) continue;
            var key = tok.charCodeAt(0);
            // Normalize lowercase a-z to uppercase A-Z
            if (key >= 97 && key <= 122) key -= 32;
            var val = +tok.substring(1); // faster than parseFloat for numeric strings
            if (val === val) { // NaN check (NaN !== NaN)
                params[String.fromCharCode(key)] = val;
            }
        }
        return { cmd: cmd, params: params, comment: comment };
    }

    /**
     * Euclidean distance between two 3D points.
     * @private
     */
    function dist3d(x1, y1, z1, x2, y2, z2) {
        var dx = x2 - x1;
        var dy = y2 - y1;
        var dz = z2 - z1;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /**
     * Euclidean distance in XY plane.
     * @private
     */
    function dist2d(x1, y1, x2, y2) {
        var dx = x2 - x1;
        var dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    }

    /**
     * Analyze a full GCode string and return comprehensive metrics.
     *
     * @param {string} gcode - Full GCode text (newline-separated).
     * @param {object} [options] - Analysis options.
     * @param {number} [options.filamentDiameter=1.75] - Filament diameter in mm.
     * @param {number} [options.nozzleDiameter=0.4] - Nozzle diameter in mm.
     * @param {number} [options.defaultFeedrate=1500] - Default feedrate in mm/min if none specified.
     * @returns {object} Analysis result with metrics.
     */
    function analyze(gcode, options) {
        if (!gcode || typeof gcode !== 'string') {
            throw new Error('GCode must be a non-empty string');
        }

        var opts = options || {};
        var filamentDiameter = opts.filamentDiameter || 1.75;
        var nozzleDiameter = opts.nozzleDiameter || 0.4;
        var defaultFeedrate = opts.defaultFeedrate || 1500;

        var filamentArea = Math.PI * (filamentDiameter / 2) * (filamentDiameter / 2);

        // State tracking
        var pos = { x: 0, y: 0, z: 0, e: 0 };
        var feedrate = defaultFeedrate;
        var isAbsoluteE = true;
        var isAbsoluteXYZ = true;

        // Accumulators
        var totalExtrusionLength = 0;  // filament length extruded (mm)
        var totalTravelDist = 0;       // non-extruding move distance (mm)
        var totalPrintDist = 0;        // extruding move distance (mm)
        var totalTimeMin = 0;          // estimated time in minutes
        var retractionCount = 0;
        var totalRetractionDist = 0;
        var lineCount = 0;
        var commandCount = 0;
        var currentLayer = 0;
        var lastLayerZ = 0;

        // Feedrate tracking — use O(1) running accumulators instead of
        // collecting every feedrate into an array. For large GCode files
        // (500K+ lines), the old approach allocated two unbounded arrays
        // that grew with every G0/G1 command, wasting significant memory
        // and forcing a full O(n) scan in computeFeedrateStats().
        var feedrateAcc = { min: Infinity, max: -Infinity, sum: 0, count: 0 };
        var printFeedrateAcc = { min: Infinity, max: -Infinity, sum: 0, count: 0 };

        // Track whether a comment set the layer to avoid double-counting
        var layerSetByComment = false;

        // Layer tracking: layerIdx → { z, extrusionLength, printDist, travelDist, timeMin, moves }
        var layers = {};

        // Temperature/fan commands
        var temperatures = [];
        var bedTemps = [];
        var fanSpeeds = [];

        // Bounding box
        var bounds = {
            minX: Infinity, maxX: -Infinity,
            minY: Infinity, maxY: -Infinity,
            minZ: Infinity, maxZ: -Infinity
        };

        function updateBounds(x, y, z) {
            if (x < bounds.minX) bounds.minX = x;
            if (x > bounds.maxX) bounds.maxX = x;
            if (y < bounds.minY) bounds.minY = y;
            if (y > bounds.maxY) bounds.maxY = y;
            if (z < bounds.minZ) bounds.minZ = z;
            if (z > bounds.maxZ) bounds.maxZ = z;
        }

        function getOrCreateLayer(idx) {
            if (!layers[idx]) {
                layers[idx] = {
                    index: idx,
                    z: pos.z,
                    extrusionLength: 0,
                    printDist: 0,
                    travelDist: 0,
                    timeMin: 0,
                    moves: 0
                };
            }
            return layers[idx];
        }

        // Iterate lines without allocating a full split array.
        // For large GCode files (500K+ lines) this avoids creating
        // an intermediate string array that doubles peak memory usage.
        lineCount = 0;
        var gcodeLen = gcode.length;
        var lineStart = 0;

        while (lineStart < gcodeLen) {
            var lineEnd = lineStart;
            while (lineEnd < gcodeLen && gcode.charCodeAt(lineEnd) !== 10 && gcode.charCodeAt(lineEnd) !== 13) {
                lineEnd++;
            }
            lineCount++;
            var line = gcode.substring(lineStart, lineEnd);
            // Skip \r\n or \r or \n
            if (lineEnd < gcodeLen && gcode.charCodeAt(lineEnd) === 13) lineEnd++;
            if (lineEnd < gcodeLen && gcode.charCodeAt(lineEnd) === 10) lineEnd++;
            lineStart = lineEnd;

            var parsed = parseLine(line);
            if (!parsed || !parsed.cmd) continue;
            commandCount++;

            var cmd = parsed.cmd;
            var p = parsed.params;

            // Check for layer change comments (common slicer patterns)
            layerSetByComment = false; // Reset per-line

            if (parsed.comment) {
                var lcComment = parsed.comment.toLowerCase();
                if (lcComment.indexOf('layer') >= 0) {
                    var layerMatch = parsed.comment.match(/layer\s*[:=]?\s*(\d+)/i);
                    if (layerMatch) {
                        currentLayer = parseInt(layerMatch[1], 10);
                        layerSetByComment = true;
                    }
                }
            }

            if (cmd === 'G0' || cmd === 'G1') {
                var newX = pos.x;
                var newY = pos.y;
                var newZ = pos.z;
                var newE = pos.e;

                if (isAbsoluteXYZ) {
                    if ('X' in p) newX = p.X;
                    if ('Y' in p) newY = p.Y;
                    if ('Z' in p) newZ = p.Z;
                } else {
                    if ('X' in p) newX = pos.x + p.X;
                    if ('Y' in p) newY = pos.y + p.Y;
                    if ('Z' in p) newZ = pos.z + p.Z;
                }

                if ('E' in p) {
                    newE = isAbsoluteE ? p.E : pos.e + p.E;
                }

                if ('F' in p) {
                    feedrate = p.F;
                    updateAcc(feedrateAcc, feedrate);
                }

                // Detect layer change by Z movement.
                // Skip if a comment already set the layer for this line
                // to avoid double-counting (fixes #23).
                if (newZ !== pos.z && newZ > lastLayerZ) {
                    if (!layerSetByComment) {
                        currentLayer++;
                    }
                    lastLayerZ = newZ;
                    layerSetByComment = false;
                }

                var moveDist = dist3d(pos.x, pos.y, pos.z, newX, newY, newZ);
                var xyDist = dist2d(pos.x, pos.y, newX, newY);
                var eDelta = newE - pos.e;

                // Compute time for this move
                var moveTime = 0;
                if (moveDist > 0 && feedrate > 0) {
                    moveTime = moveDist / feedrate; // minutes
                    totalTimeMin += moveTime;
                }

                var layer = getOrCreateLayer(currentLayer);

                if (eDelta > 0) {
                    // Extruding move
                    totalExtrusionLength += eDelta;
                    totalPrintDist += moveDist;
                    updateAcc(printFeedrateAcc, feedrate);
                    layer.extrusionLength += eDelta;
                    layer.printDist += moveDist;
                    updateBounds(newX, newY, newZ);
                } else if (eDelta < 0) {
                    // Retraction
                    retractionCount++;
                    totalRetractionDist += Math.abs(eDelta);
                    totalTravelDist += moveDist;
                    layer.travelDist += moveDist;
                } else {
                    // Travel move (no extrusion)
                    totalTravelDist += moveDist;
                    layer.travelDist += moveDist;
                }

                layer.timeMin += moveTime;
                layer.moves++;
                layer.z = newZ;

                pos.x = newX;
                pos.y = newY;
                pos.z = newZ;
                pos.e = newE;

            } else if (cmd === 'G28') {
                // Home
                pos.x = 0;
                pos.y = 0;
                pos.z = 0;

            } else if (cmd === 'G90') {
                isAbsoluteXYZ = true;
                // Note: G90 only affects XYZ axes. The extruder (E axis)
                // mode is controlled independently by M82/M83. Setting
                // isAbsoluteE here would break the common G90+M83 combo
                // (absolute positioning with relative extrusion).

            } else if (cmd === 'G91') {
                isAbsoluteXYZ = false;
                // Same as above: G91 does not affect E axis mode.

            } else if (cmd === 'M82') {
                isAbsoluteE = true;

            } else if (cmd === 'M83') {
                isAbsoluteE = false;

            } else if (cmd === 'G92') {
                // Set position
                if ('X' in p) pos.x = p.X;
                if ('Y' in p) pos.y = p.Y;
                if ('Z' in p) pos.z = p.Z;
                if ('E' in p) pos.e = p.E;

            } else if (cmd === 'M104' || cmd === 'M109') {
                // Set/wait hotend temperature
                if ('S' in p) temperatures.push(p.S);

            } else if (cmd === 'M140' || cmd === 'M190') {
                // Set/wait bed temperature
                if ('S' in p) bedTemps.push(p.S);

            } else if (cmd === 'M106') {
                // Fan speed
                if ('S' in p) fanSpeeds.push(p.S);

            } else if (cmd === 'M107') {
                fanSpeeds.push(0);
            }
        }

        // Compute feedrate stats from running accumulators (O(1) instead of O(n))
        var feedrateStats = accToStats(printFeedrateAcc.count > 0 ? printFeedrateAcc : feedrateAcc);

        // Compute extrusion volume (mm³) from filament length
        var extrusionVolumeMm3 = totalExtrusionLength * filamentArea;
        var extrusionVolumeMl = extrusionVolumeMm3 / 1000;

        // Build layer array sorted by index
        var layerKeys = Object.keys(layers).map(Number).sort(function (a, b) { return a - b; });
        var layerArray = layerKeys.map(function (k) { return layers[k]; });

        // Fix bounds if no extrusion occurred
        if (bounds.minX === Infinity) {
            bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
        }

        return {
            summary: {
                lineCount: lineCount,
                commandCount: commandCount,
                layerCount: layerArray.length,
                estimatedTimeMin: round(totalTimeMin),
                estimatedTimeSec: round(totalTimeMin * 60)
            },
            extrusion: {
                filamentLengthMm: round(totalExtrusionLength),
                volumeMm3: round(extrusionVolumeMm3),
                volumeMl: round(extrusionVolumeMl, 4),
                filamentDiameter: filamentDiameter,
                nozzleDiameter: nozzleDiameter
            },
            movement: {
                totalPrintDistMm: round(totalPrintDist),
                totalTravelDistMm: round(totalTravelDist),
                totalDistMm: round(totalPrintDist + totalTravelDist),
                printTravelRatio: totalTravelDist > 0
                    ? round(totalPrintDist / totalTravelDist, 4)
                    : totalPrintDist > 0 ? Infinity : 0
            },
            feedrate: feedrateStats,
            retraction: {
                count: retractionCount,
                totalDistMm: round(totalRetractionDist),
                avgDistMm: retractionCount > 0 ? round(totalRetractionDist / retractionCount, 4) : 0
            },
            bounds: {
                x: { min: round(bounds.minX), max: round(bounds.maxX), range: round(bounds.maxX - bounds.minX) },
                y: { min: round(bounds.minY), max: round(bounds.maxY), range: round(bounds.maxY - bounds.minY) },
                z: { min: round(bounds.minZ), max: round(bounds.maxZ), range: round(bounds.maxZ - bounds.minZ) }
            },
            temperature: {
                hotend: temperatures.length > 0 ? temperatures[temperatures.length - 1] : null,
                bed: bedTemps.length > 0 ? bedTemps[bedTemps.length - 1] : null,
                hotendAll: temperatures,
                bedAll: bedTemps
            },
            fan: {
                speeds: fanSpeeds,
                maxSpeed: fanSpeeds.length > 0 ? Math.max.apply(null, fanSpeeds) : 0
            },
            layers: layerArray
        };
    }

    /**
     * Update a running feedrate accumulator with a new value.
     * Maintains min, max, sum, and count in O(1) per call.
     * @private
     */
    function updateAcc(acc, value) {
        if (value < acc.min) acc.min = value;
        if (value > acc.max) acc.max = value;
        acc.sum += value;
        acc.count++;
    }

    /**
     * Convert a running accumulator to a stats object.
     * @private
     */
    function accToStats(acc) {
        if (acc.count === 0) {
            return { min: 0, max: 0, avg: 0, count: 0 };
        }
        return {
            min: round(acc.min),
            max: round(acc.max),
            avg: round(acc.sum / acc.count),
            count: acc.count
        };
    }

    /**
     * Generate a per-layer summary table.
     *
     * @param {object} analysis - Result from analyze().
     * @returns {Array<object>} Array of layer summary rows.
     */
    function layerSummary(analysis) {
        if (!analysis || !analysis.layers) return [];
        return analysis.layers.map(function (layer) {
            return {
                layer: layer.index,
                z: round(layer.z),
                moves: layer.moves,
                extrusionMm: round(layer.extrusionLength),
                printDistMm: round(layer.printDist),
                travelDistMm: round(layer.travelDist),
                timeSec: round(layer.timeMin * 60)
            };
        });
    }

    /**
     * Compare two GCode analysis results and highlight differences.
     *
     * @param {object} a - First analysis result.
     * @param {object} b - Second analysis result.
     * @returns {object} Comparison with deltas for key metrics.
     */
    function compare(a, b) {
        if (!a || !b) throw new Error('Both analysis results are required');

        function delta(va, vb) {
            var diff = vb - va;
            var pct = va !== 0 ? (diff / va) * 100 : (vb !== 0 ? 100 : 0);
            return { a: va, b: vb, diff: round(diff), pctChange: round(pct) };
        }

        return {
            estimatedTimeMin: delta(a.summary.estimatedTimeMin, b.summary.estimatedTimeMin),
            layerCount: delta(a.summary.layerCount, b.summary.layerCount),
            filamentLengthMm: delta(a.extrusion.filamentLengthMm, b.extrusion.filamentLengthMm),
            volumeMl: delta(a.extrusion.volumeMl, b.extrusion.volumeMl),
            totalPrintDistMm: delta(a.movement.totalPrintDistMm, b.movement.totalPrintDistMm),
            totalTravelDistMm: delta(a.movement.totalTravelDistMm, b.movement.totalTravelDistMm),
            retractionCount: delta(a.retraction.count, b.retraction.count)
        };
    }

    /**
     * Estimate material cost for a print based on analysis.
     *
     * @param {object} analysis - Result from analyze().
     * @param {number} costPerMl - Material cost per mL.
     * @param {object} [overheads] - Optional overhead costs.
     * @param {number} [overheads.machineHourly=0] - Machine cost per hour.
     * @param {number} [overheads.laborHourly=0] - Labor cost per hour.
     * @param {number} [overheads.consumables=0] - Fixed consumables cost.
     * @param {number} [overheads.wastePercent=15] - Waste percentage.
     * @returns {object} Cost breakdown.
     */
    function estimateCost(analysis, costPerMl, overheads) {
        if (!analysis) throw new Error('Analysis result is required');
        if (typeof costPerMl !== 'number' || costPerMl < 0) {
            throw new Error('Cost per mL must be a non-negative number');
        }

        var oh = overheads || {};
        var machineHourly = oh.machineHourly || 0;
        var laborHourly = oh.laborHourly || 0;
        var consumables = oh.consumables || 0;
        var wastePercent = oh.wastePercent != null ? oh.wastePercent : 15;

        var volumeMl = analysis.extrusion.volumeMl;
        var wasteMultiplier = 1 + (wastePercent / 100);
        var materialCost = volumeMl * wasteMultiplier * costPerMl;

        var timeHours = analysis.summary.estimatedTimeMin / 60;
        var machineCost = timeHours * machineHourly;
        var laborCost = timeHours * laborHourly;

        var totalCost = materialCost + machineCost + laborCost + consumables;

        return {
            materialMl: round(volumeMl * wasteMultiplier, 4),
            materialCost: round(materialCost),
            machineCost: round(machineCost),
            laborCost: round(laborCost),
            consumablesCost: round(consumables),
            totalCost: round(totalCost),
            breakdown: {
                material: totalCost > 0 ? round((materialCost / totalCost) * 100) : 0,
                machine: totalCost > 0 ? round((machineCost / totalCost) * 100) : 0,
                labor: totalCost > 0 ? round((laborCost / totalCost) * 100) : 0,
                consumables: totalCost > 0 ? round((consumables / totalCost) * 100) : 0
            }
        };
    }

    return {
        parseLine: parseLine,
        analyze: analyze,
        layerSummary: layerSummary,
        compare: compare,
        estimateCost: estimateCost
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createGCodeAnalyzer: createGCodeAnalyzer };
}
