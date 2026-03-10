/**
 * @jest-environment jsdom
 */
'use strict';

describe('Toolpath Visualizer page', function () {
    var fs = require('fs');
    var path = require('path');
    var html;

    beforeAll(function () {
        html = fs.readFileSync(path.join(__dirname, '..', 'docs', 'toolpath.html'), 'utf8');
    });

    test('page loads without errors', function () {
        expect(html).toContain('GCode Toolpath Visualizer');
        expect(html).toContain('toolpath-canvas');
    });

    test('includes required UI elements', function () {
        expect(html).toContain('id="layer-slider"');
        expect(html).toContain('id="show-all"');
        expect(html).toContain('id="show-travel"');
        expect(html).toContain('id="color-mode"');
        expect(html).toContain('id="gcode-input"');
        expect(html).toContain('id="btn-render"');
        expect(html).toContain('id="btn-sample"');
        expect(html).toContain('id="drop-zone"');
    });

    test('loads gcode.js dependency', function () {
        expect(html).toContain('src="shared/gcode.js"');
    });

    test('has nav with toolpath active', function () {
        expect(html).toContain('href="toolpath.html" class="active"');
    });

    test('has color mode options', function () {
        expect(html).toContain('value="type"');
        expect(html).toContain('value="speed"');
        expect(html).toContain('value="layer"');
    });

    test('has stats grid and layer details sections', function () {
        expect(html).toContain('id="stats-grid"');
        expect(html).toContain('id="layer-details"');
    });

    test('supports file input with gcode extensions', function () {
        expect(html).toContain('.gcode,.gco,.g,.nc,.txt');
    });

    test('has legend with move types', function () {
        expect(html).toContain('Extrusion');
        expect(html).toContain('Travel');
        expect(html).toContain('Retraction');
    });

    test('includes pan and zoom handlers', function () {
        expect(html).toContain('mousedown');
        expect(html).toContain('wheel');
        expect(html).toContain('view.scale');
    });

    test('has sample GCode generator', function () {
        expect(html).toContain('sampleGCode');
        expect(html).toContain('3-layer grid scaffold');
    });

    // Integration test: verify the gcode.js module parses correctly
    test('gcode.js createGCodeAnalyzer works', function () {
        var gcode = require('../docs/shared/gcode');
        var analyzer = gcode.createGCodeAnalyzer();
        var result = analyzer.analyze('G28\nG1 X10 Y10 E1 F1500\nG1 X20 Y20 E2 F1500');
        expect(result.summary.commandCount).toBeGreaterThan(0);
        expect(result.extrusion.filamentLengthMm).toBeGreaterThan(0);
    });
});
