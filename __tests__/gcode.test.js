'use strict';

var mod = require('../docs/shared/gcode');
var createGCodeAnalyzer = mod.createGCodeAnalyzer;

describe('createGCodeAnalyzer', function () {
    var analyzer;

    beforeEach(function () {
        analyzer = createGCodeAnalyzer();
    });

    // ── parseLine ─────────────────────────────────────────────────

    describe('parseLine', function () {
        test('parses simple G1 command', function () {
            var result = analyzer.parseLine('G1 X10 Y20 Z0.3 E1.5 F1200');
            expect(result.cmd).toBe('G1');
            expect(result.params.X).toBe(10);
            expect(result.params.Y).toBe(20);
            expect(result.params.Z).toBe(0.3);
            expect(result.params.E).toBe(1.5);
            expect(result.params.F).toBe(1200);
        });

        test('parses G0 travel move', function () {
            var result = analyzer.parseLine('G0 X50 Y50 F3000');
            expect(result.cmd).toBe('G0');
            expect(result.params.X).toBe(50);
            expect(result.params.Y).toBe(50);
            expect(result.params.F).toBe(3000);
            expect(result.params.E).toBeUndefined();
        });

        test('strips inline comments', function () {
            var result = analyzer.parseLine('G1 X10 ; move to 10');
            expect(result.cmd).toBe('G1');
            expect(result.params.X).toBe(10);
            expect(result.comment).toBe('move to 10');
        });

        test('returns null for empty line', function () {
            expect(analyzer.parseLine('')).toBeNull();
            expect(analyzer.parseLine('   ')).toBeNull();
        });

        test('returns comment-only object for comment lines', function () {
            var result = analyzer.parseLine('; this is a comment');
            expect(result.cmd).toBe('');
            expect(result.comment).toBe('this is a comment');
        });

        test('handles lowercase commands (case-insensitive)', function () {
            var result = analyzer.parseLine('g1 x10 y20');
            expect(result.cmd).toBe('G1');
            expect(result.params.X).toBe(10);
            expect(result.params.Y).toBe(20);
        });

        test('returns null for non-string input', function () {
            expect(analyzer.parseLine(null)).toBeNull();
            expect(analyzer.parseLine(42)).toBeNull();
            expect(analyzer.parseLine(undefined)).toBeNull();
        });

        test('parses M-codes', function () {
            var result = analyzer.parseLine('M104 S200');
            expect(result.cmd).toBe('M104');
            expect(result.params.S).toBe(200);
        });

        test('parses negative parameter values', function () {
            var result = analyzer.parseLine('G1 X-5.5 Y-3.2');
            expect(result.params.X).toBe(-5.5);
            expect(result.params.Y).toBe(-3.2);
        });

        test('handles G28 home command without params', function () {
            var result = analyzer.parseLine('G28');
            expect(result.cmd).toBe('G28');
            expect(Object.keys(result.params)).toHaveLength(0);
        });
    });

    // ── analyze — basic ───────────────────────────────────────────

    describe('analyze (basic)', function () {
        test('throws for non-string input', function () {
            expect(function () { analyzer.analyze(null); }).toThrow('non-empty string');
            expect(function () { analyzer.analyze(''); }).toThrow('non-empty string');
            expect(function () { analyzer.analyze(42); }).toThrow('non-empty string');
        });

        test('analyzes minimal GCode', function () {
            var gcode = 'G28\nG1 X10 Y10 E1 F1000\n';
            var result = analyzer.analyze(gcode);
            expect(result.summary.lineCount).toBe(3);
            expect(result.summary.commandCount).toBe(2);
        });

        test('counts lines and commands correctly', function () {
            var gcode = [
                '; header comment',
                'G28',
                'G1 Z5 F300',
                '',
                '; another comment',
                'G1 X10 Y10 F1000',
                'M104 S200'
            ].join('\n');

            var result = analyzer.analyze(gcode);
            expect(result.summary.lineCount).toBe(7);
            expect(result.summary.commandCount).toBe(4); // G28, G1, G1, M104
        });

        test('returns all top-level keys', function () {
            var result = analyzer.analyze('G28\nG1 X10 E1 F1000');
            expect(result).toHaveProperty('summary');
            expect(result).toHaveProperty('extrusion');
            expect(result).toHaveProperty('movement');
            expect(result).toHaveProperty('feedrate');
            expect(result).toHaveProperty('retraction');
            expect(result).toHaveProperty('bounds');
            expect(result).toHaveProperty('temperature');
            expect(result).toHaveProperty('fan');
            expect(result).toHaveProperty('layers');
        });
    });

    // ── analyze — extrusion ───────────────────────────────────────

    describe('analyze (extrusion)', function () {
        test('tracks filament extrusion length', function () {
            var gcode = 'G1 X10 E5 F1000\nG1 X20 E10 F1000';
            var result = analyzer.analyze(gcode);
            expect(result.extrusion.filamentLengthMm).toBe(10);
        });

        test('computes volume from filament length', function () {
            var gcode = 'G1 X10 E10 F1000';
            var result = analyzer.analyze(gcode, { filamentDiameter: 1.75 });
            var expectedArea = Math.PI * 0.875 * 0.875;
            var expectedVol = 10 * expectedArea;
            expect(result.extrusion.volumeMm3).toBeCloseTo(expectedVol, 1);
            expect(result.extrusion.volumeMl).toBeCloseTo(expectedVol / 1000, 3);
        });

        test('uses custom filament diameter', function () {
            var gcode = 'G1 X10 E10 F1000';
            var r1 = analyzer.analyze(gcode, { filamentDiameter: 1.75 });
            var r2 = analyzer.analyze(gcode, { filamentDiameter: 2.85 });
            expect(r2.extrusion.volumeMm3).toBeGreaterThan(r1.extrusion.volumeMm3);
        });

        test('records filament and nozzle diameter in result', function () {
            var result = analyzer.analyze('G1 X10 E1 F1000', {
                filamentDiameter: 2.85,
                nozzleDiameter: 0.6
            });
            expect(result.extrusion.filamentDiameter).toBe(2.85);
            expect(result.extrusion.nozzleDiameter).toBe(0.6);
        });
    });

    // ── analyze — movement ────────────────────────────────────────

    describe('analyze (movement)', function () {
        test('computes print distance for extruding moves', function () {
            // X goes 0→10, extruding
            var gcode = 'G1 X10 E1 F1000';
            var result = analyzer.analyze(gcode);
            expect(result.movement.totalPrintDistMm).toBeCloseTo(10, 1);
        });

        test('computes travel distance for non-extruding moves', function () {
            // Travel move (no E)
            var gcode = 'G0 X20 Y20 F3000';
            var result = analyzer.analyze(gcode);
            var expected = Math.sqrt(20 * 20 + 20 * 20);
            expect(result.movement.totalTravelDistMm).toBeCloseTo(expected, 1);
            expect(result.movement.totalPrintDistMm).toBe(0);
        });

        test('separates print and travel distances', function () {
            var gcode = [
                'G1 X10 E1 F1000',    // print: 10mm
                'G0 X20 F3000',        // travel: 10mm
                'G1 X30 E2 F1000'      // print: 10mm
            ].join('\n');
            var result = analyzer.analyze(gcode);
            expect(result.movement.totalPrintDistMm).toBeCloseTo(20, 1);
            expect(result.movement.totalTravelDistMm).toBeCloseTo(10, 1);
        });

        test('computes total distance', function () {
            var gcode = 'G1 X10 E1 F1000\nG0 X20 F3000';
            var result = analyzer.analyze(gcode);
            expect(result.movement.totalDistMm).toBeCloseTo(20, 1);
        });

        test('computes print-to-travel ratio', function () {
            var gcode = [
                'G1 X30 E1 F1000',  // 30mm print
                'G0 X40 F3000'       // 10mm travel
            ].join('\n');
            var result = analyzer.analyze(gcode);
            expect(result.movement.printTravelRatio).toBeCloseTo(3, 1);
        });
    });

    // ── analyze — feedrate ────────────────────────────────────────

    describe('analyze (feedrate)', function () {
        test('tracks feedrate statistics', function () {
            var gcode = [
                'G1 X10 E1 F500',
                'G1 X20 E2 F1000',
                'G1 X30 E3 F1500'
            ].join('\n');
            var result = analyzer.analyze(gcode);
            expect(result.feedrate.min).toBe(500);
            expect(result.feedrate.max).toBe(1500);
            expect(result.feedrate.avg).toBe(1000);
            expect(result.feedrate.count).toBe(3);
        });

        test('returns zeros for no feedrate data', function () {
            var gcode = '; just a comment\n';
            var result = analyzer.analyze(gcode);
            expect(result.feedrate.min).toBe(0);
            expect(result.feedrate.max).toBe(0);
            expect(result.feedrate.avg).toBe(0);
        });
    });

    // ── analyze — retraction ──────────────────────────────────────

    describe('analyze (retraction)', function () {
        test('counts retractions (negative E delta)', function () {
            var gcode = [
                'G1 X10 E5 F1000',     // extrude
                'G1 E3 F1800',          // retract (5→3 = -2mm)
                'G0 X20 F3000',         // travel
                'G1 E5 F1800',          // unretract
                'G1 X30 E8 F1000',      // extrude
                'G1 E6 F1800'           // retract (8→6 = -2mm)
            ].join('\n');
            var result = analyzer.analyze(gcode);
            expect(result.retraction.count).toBe(2);
            expect(result.retraction.totalDistMm).toBeCloseTo(4, 1);
            expect(result.retraction.avgDistMm).toBeCloseTo(2, 1);
        });

        test('reports zero retractions when none present', function () {
            var gcode = 'G1 X10 E5 F1000\nG1 X20 E10 F1000';
            var result = analyzer.analyze(gcode);
            expect(result.retraction.count).toBe(0);
            expect(result.retraction.totalDistMm).toBe(0);
            expect(result.retraction.avgDistMm).toBe(0);
        });
    });

    // ── analyze — layers ──────────────────────────────────────────

    describe('analyze (layers)', function () {
        test('detects layers from Z changes', function () {
            var gcode = [
                'G1 Z0.3 F300',
                'G1 X10 E1 F1000',
                'G1 Z0.6 F300',
                'G1 X20 E2 F1000',
                'G1 Z0.9 F300',
                'G1 X30 E3 F1000'
            ].join('\n');
            var result = analyzer.analyze(gcode);
            expect(result.summary.layerCount).toBeGreaterThanOrEqual(3);
        });

        test('layer data has expected properties', function () {
            var gcode = [
                'G1 Z0.3 F300',
                'G1 X10 Y10 E1 F1000',
                'G1 X20 Y20 E2 F1000'
            ].join('\n');
            var result = analyzer.analyze(gcode);
            expect(result.layers.length).toBeGreaterThan(0);
            var layer = result.layers[0];
            expect(layer).toHaveProperty('index');
            expect(layer).toHaveProperty('z');
            expect(layer).toHaveProperty('extrusionLength');
            expect(layer).toHaveProperty('printDist');
            expect(layer).toHaveProperty('travelDist');
            expect(layer).toHaveProperty('timeMin');
            expect(layer).toHaveProperty('moves');
        });

        test('detects layers from slicer comments', function () {
            var gcode = [
                ';LAYER:0',
                'G1 X10 E1 F1000',
                ';LAYER:1',
                'G1 Z0.6 F300',
                'G1 X20 E2 F1000'
            ].join('\n');
            var result = analyzer.analyze(gcode);
            expect(result.summary.layerCount).toBeGreaterThanOrEqual(2);
        });
    });

    // ── analyze — bounds ──────────────────────────────────────────

    describe('analyze (bounds)', function () {
        test('computes bounding box from extruding moves', function () {
            var gcode = [
                'G1 X5 Y10 E1 F1000',
                'G1 X25 Y30 E2 F1000',
                'G1 X15 Y20 E3 F1000'
            ].join('\n');
            var result = analyzer.analyze(gcode);
            expect(result.bounds.x.min).toBe(5);
            expect(result.bounds.x.max).toBe(25);
            expect(result.bounds.x.range).toBe(20);
            expect(result.bounds.y.min).toBe(10);
            expect(result.bounds.y.max).toBe(30);
            expect(result.bounds.y.range).toBe(20);
        });

        test('defaults bounds to zero when no extrusion', function () {
            var gcode = 'G0 X10 Y10 F3000';
            var result = analyzer.analyze(gcode);
            expect(result.bounds.x.min).toBe(0);
            expect(result.bounds.x.max).toBe(0);
        });
    });

    // ── analyze — temperature & fan ───────────────────────────────

    describe('analyze (temperature and fan)', function () {
        test('captures hotend temperature from M104', function () {
            var gcode = 'M104 S200\nG1 X10 E1 F1000';
            var result = analyzer.analyze(gcode);
            expect(result.temperature.hotend).toBe(200);
            expect(result.temperature.hotendAll).toContain(200);
        });

        test('captures bed temperature from M140', function () {
            var gcode = 'M140 S60\nG1 X10 E1 F1000';
            var result = analyzer.analyze(gcode);
            expect(result.temperature.bed).toBe(60);
        });

        test('returns null temperature when none set', function () {
            var result = analyzer.analyze('G1 X10 E1 F1000');
            expect(result.temperature.hotend).toBeNull();
            expect(result.temperature.bed).toBeNull();
        });

        test('captures fan speed from M106', function () {
            var gcode = 'M106 S128\nG1 X10 E1 F1000';
            var result = analyzer.analyze(gcode);
            expect(result.fan.speeds).toContain(128);
            expect(result.fan.maxSpeed).toBe(128);
        });

        test('captures fan off from M107', function () {
            var gcode = 'M106 S255\nM107';
            var result = analyzer.analyze(gcode);
            expect(result.fan.speeds).toEqual([255, 0]);
        });
    });

    // ── analyze — time estimation ─────────────────────────────────

    describe('analyze (time estimation)', function () {
        test('estimates time from distance and feedrate', function () {
            // 100mm at 6000 mm/min = 1 second
            var gcode = 'G1 X100 E10 F6000';
            var result = analyzer.analyze(gcode);
            expect(result.summary.estimatedTimeSec).toBeCloseTo(1, 0);
        });

        test('accumulates time across moves', function () {
            var gcode = [
                'G1 X60 E1 F3600',   // 60mm at 3600mm/min = 1 sec
                'G1 X120 E2 F3600'   // 60mm at 3600mm/min = 1 sec
            ].join('\n');
            var result = analyzer.analyze(gcode);
            expect(result.summary.estimatedTimeSec).toBeCloseTo(2, 0);
        });
    });

    // ── analyze — coordinate modes ────────────────────────────────

    describe('analyze (coordinate modes)', function () {
        test('handles relative extrusion (M83)', function () {
            var gcode = [
                'M83',                      // relative E
                'G1 X10 E2 F1000',          // +2mm
                'G1 X20 E3 F1000'           // +3mm (total 5mm)
            ].join('\n');
            var result = analyzer.analyze(gcode);
            expect(result.extrusion.filamentLengthMm).toBeCloseTo(5, 1);
        });

        test('handles G92 position reset', function () {
            var gcode = [
                'G1 X10 E5 F1000',   // 5mm extrusion
                'G92 E0',             // reset E to 0
                'G1 X20 E3 F1000'    // 3mm more extrusion
            ].join('\n');
            var result = analyzer.analyze(gcode);
            expect(result.extrusion.filamentLengthMm).toBeCloseTo(8, 1);
        });

        test('handles G28 home', function () {
            var gcode = [
                'G1 X50 Y50 E1 F1000',
                'G28',
                'G1 X10 Y10 E2 F1000'
            ].join('\n');
            var result = analyzer.analyze(gcode);
            // After G28, position is 0,0,0
            // Second move is from 0,0 to 10,10
            var expectedDist2 = Math.sqrt(10 * 10 + 10 * 10);
            var expectedDist1 = Math.sqrt(50 * 50 + 50 * 50);
            expect(result.movement.totalPrintDistMm).toBeCloseTo(expectedDist1 + expectedDist2, 0);
        });

        test('handles absolute/relative mode switches', function () {
            var gcode = [
                'G90',                // absolute
                'G1 X10 E2 F1000',   // abs: x=10, e=2
                'G91',                // relative
                'G1 X5 E1 F1000',    // rel: x=15, e=3
                'G90',                // back to absolute
                'G1 X20 E5 F1000'    // abs: x=20, e=5
            ].join('\n');
            var result = analyzer.analyze(gcode);
            expect(result.extrusion.filamentLengthMm).toBeCloseTo(5, 1);
        });
    });

    // ── layerSummary ──────────────────────────────────────────────

    describe('layerSummary', function () {
        test('generates summary rows for each layer', function () {
            var gcode = [
                'G1 Z0.3 F300',
                'G1 X10 E1 F1000',
                'G1 Z0.6 F300',
                'G1 X20 E2 F1000'
            ].join('\n');
            var analysis = analyzer.analyze(gcode);
            var summary = analyzer.layerSummary(analysis);
            expect(summary.length).toBeGreaterThan(0);
            expect(summary[0]).toHaveProperty('layer');
            expect(summary[0]).toHaveProperty('z');
            expect(summary[0]).toHaveProperty('moves');
            expect(summary[0]).toHaveProperty('extrusionMm');
            expect(summary[0]).toHaveProperty('timeSec');
        });

        test('returns empty array for null input', function () {
            expect(analyzer.layerSummary(null)).toEqual([]);
        });
    });

    // ── compare ───────────────────────────────────────────────────

    describe('compare', function () {
        test('computes deltas between two analyses', function () {
            var gcode1 = 'G1 X10 E5 F1000';
            var gcode2 = 'G1 X20 E10 F1000';
            var a1 = analyzer.analyze(gcode1);
            var a2 = analyzer.analyze(gcode2);
            var cmp = analyzer.compare(a1, a2);

            expect(cmp.filamentLengthMm.a).toBe(5);
            expect(cmp.filamentLengthMm.b).toBe(10);
            expect(cmp.filamentLengthMm.diff).toBe(5);
            expect(cmp.filamentLengthMm.pctChange).toBe(100);
        });

        test('throws for missing arguments', function () {
            expect(function () { analyzer.compare(null, {}); }).toThrow();
            expect(function () { analyzer.compare({}, null); }).toThrow();
        });

        test('handles identical analyses (zero delta)', function () {
            var gcode = 'G1 X10 E5 F1000';
            var a = analyzer.analyze(gcode);
            var cmp = analyzer.compare(a, a);
            expect(cmp.filamentLengthMm.diff).toBe(0);
            expect(cmp.filamentLengthMm.pctChange).toBe(0);
        });
    });

    // ── estimateCost ──────────────────────────────────────────────

    describe('estimateCost', function () {
        test('computes material cost', function () {
            var gcode = 'G1 X100 E100 F1000';
            var analysis = analyzer.analyze(gcode, { filamentDiameter: 1.75 });
            var cost = analyzer.estimateCost(analysis, 10); // $10/mL
            expect(cost.materialCost).toBeGreaterThan(0);
            expect(cost.totalCost).toBeGreaterThan(0);
        });

        test('includes waste percentage', function () {
            var gcode = 'G1 X100 E100 F1000';
            var analysis = analyzer.analyze(gcode);
            var costNoWaste = analyzer.estimateCost(analysis, 10, { wastePercent: 0 });
            var costWithWaste = analyzer.estimateCost(analysis, 10, { wastePercent: 20 });
            expect(costWithWaste.materialCost).toBeGreaterThan(costNoWaste.materialCost);
            expect(costWithWaste.materialMl).toBeCloseTo(costNoWaste.materialMl * 1.2, 2);
        });

        test('includes machine and labor costs', function () {
            var gcode = 'G1 X6000 E100 F6000'; // 6000mm at 6000mm/min = 1min = 1/60 hr
            var analysis = analyzer.analyze(gcode);
            var cost = analyzer.estimateCost(analysis, 0, {
                machineHourly: 60,  // $60/hr = $1/min
                laborHourly: 120,   // $120/hr = $2/min
                wastePercent: 0
            });
            expect(cost.machineCost).toBeGreaterThan(0);
            expect(cost.laborCost).toBeGreaterThan(0);
        });

        test('includes consumables fixed cost', function () {
            var gcode = 'G1 X10 E1 F1000';
            var analysis = analyzer.analyze(gcode);
            var cost = analyzer.estimateCost(analysis, 0, { consumables: 25 });
            expect(cost.consumablesCost).toBe(25);
            expect(cost.totalCost).toBeGreaterThanOrEqual(25);
        });

        test('provides cost breakdown percentages', function () {
            var gcode = 'G1 X100 E100 F1000';
            var analysis = analyzer.analyze(gcode);
            var cost = analyzer.estimateCost(analysis, 10, {
                machineHourly: 10,
                wastePercent: 0
            });
            expect(cost.breakdown.material).toBeGreaterThan(0);
            expect(cost.breakdown.machine).toBeGreaterThanOrEqual(0);
            var total = cost.breakdown.material + cost.breakdown.machine +
                        cost.breakdown.labor + cost.breakdown.consumables;
            expect(total).toBeCloseTo(100, 0);
        });

        test('throws for missing analysis', function () {
            expect(function () { analyzer.estimateCost(null, 10); }).toThrow();
        });

        test('throws for negative cost per mL', function () {
            var analysis = analyzer.analyze('G1 X10 E1 F1000');
            expect(function () { analyzer.estimateCost(analysis, -5); }).toThrow();
        });

        test('handles zero cost per mL', function () {
            var analysis = analyzer.analyze('G1 X10 E1 F1000');
            var cost = analyzer.estimateCost(analysis, 0);
            expect(cost.materialCost).toBe(0);
        });
    });

    // ── realistic GCode ───────────────────────────────────────────

    describe('realistic bioprinting GCode', function () {
        var bioGCode = [
            '; BioBots 1 GCode',
            '; Material: GelMA 5%',
            'M104 S37',
            'M140 S25',
            'G28',
            'G90',
            'M82',
            'G92 E0',
            '; LAYER:0',
            'G1 Z0.3 F300',
            'G1 X5 Y5 F3000',
            'G1 X45 Y5 E4.0 F800',
            'G1 X45 Y45 E8.0 F800',
            'G1 X5 Y45 E12.0 F800',
            'G1 X5 Y5 E16.0 F800',
            'G1 E15.5 F1800',  // retract
            '; LAYER:1',
            'G1 Z0.6 F300',
            'G0 X5 Y5 F3000',
            'G1 E16.0 F1800',  // unretract
            'G1 X45 Y5 E20.0 F800',
            'G1 X45 Y45 E24.0 F800',
            'G1 X5 Y45 E28.0 F800',
            'G1 X5 Y5 E32.0 F800',
            'G1 E31.5 F1800',  // retract
            '; LAYER:2',
            'G1 Z0.9 F300',
            'G0 X5 Y5 F3000',
            'G1 E32.0 F1800',  // unretract
            'G1 X45 Y5 E36.0 F800',
            'G1 X45 Y45 E40.0 F800',
            'G1 X5 Y45 E44.0 F800',
            'G1 X5 Y5 E48.0 F800',
            'M106 S128',
            'M107',
            'M84'
        ].join('\n');

        test('correctly processes realistic bioprint GCode', function () {
            var result = analyzer.analyze(bioGCode);

            // Summary
            expect(result.summary.layerCount).toBeGreaterThanOrEqual(3);
            expect(result.summary.commandCount).toBeGreaterThan(10);

            // Extrusion: 48mm from print moves + 1mm from unretracts = 49mm
            expect(result.extrusion.filamentLengthMm).toBeCloseTo(49, 0);

            // Temperature
            expect(result.temperature.hotend).toBe(37);
            expect(result.temperature.bed).toBe(25);

            // Retractions: 2 retract events
            expect(result.retraction.count).toBe(2);

            // Bounds
            expect(result.bounds.x.min).toBe(5);
            expect(result.bounds.x.max).toBe(45);
            expect(result.bounds.y.min).toBe(5);
            expect(result.bounds.y.max).toBe(45);

            // Fan
            expect(result.fan.maxSpeed).toBe(128);
        });

        test('layer summary matches analysis layers', function () {
            var analysis = analyzer.analyze(bioGCode);
            var summary = analyzer.layerSummary(analysis);
            expect(summary.length).toBe(analysis.layers.length);
        });

        test('cost estimation with GelMA pricing', function () {
            var analysis = analyzer.analyze(bioGCode);
            // GelMA ~$12.50/mL
            var cost = analyzer.estimateCost(analysis, 12.50, {
                machineHourly: 5,
                wastePercent: 15,
                consumables: 2
            });
            expect(cost.totalCost).toBeGreaterThan(0);
            expect(cost.materialCost).toBeGreaterThan(0);
            expect(cost.consumablesCost).toBe(2);
        });

        test('comparison shows zero delta for same GCode', function () {
            var a = analyzer.analyze(bioGCode);
            var cmp = analyzer.compare(a, a);
            expect(cmp.filamentLengthMm.diff).toBe(0);
            expect(cmp.estimatedTimeMin.diff).toBe(0);
        });
    });
});
