'use strict';

var pg = require('../docs/shared/protocolGenerator');

/**
 * Extended tests for protocolGenerator — covers parameter defaults,
 * print time estimation, step structure, material-specific behaviors,
 * cross-product coverage, and text formatting edge cases.
 */

describe('Protocol Generator — Extended', function () {

    /* ── Default parameter values ─────────────────────────── */

    describe('default parameters', function () {
        var p;
        beforeEach(function () {
            p = pg.generateProtocol({ material: 'alginate' });
        });

        it('defaults nozzleDiameter to 0.41', function () {
            expect(p.parameters.nozzleDiameter).toBe(0.41);
        });

        it('defaults pressure to 20 kPa', function () {
            expect(p.parameters.pressure).toBe(20);
        });

        it('defaults speed to 5 mm/s', function () {
            expect(p.parameters.speed).toBe(5);
        });

        it('defaults layerHeight to 0.2 mm', function () {
            expect(p.parameters.layerHeight).toBe(0.2);
        });

        it('defaults wellplate to 6-well', function () {
            expect(p.parameters.wellplate).toBe('6-well');
        });

        it('defaults construct to disk', function () {
            expect(p.construct).toBe('disk');
        });

        it('defaults cellType to generic', function () {
            expect(p.cellType).toBe('generic');
        });

        it('defaults project title to Untitled', function () {
            expect(p.title).toContain('Untitled');
        });

        it('uses material prepTemp as default temperature', function () {
            // alginate prepTemp = 25
            expect(p.parameters.temperature).toBe(25);
        });

        it('uses collagen prepTemp (4°C) as default', function () {
            var cp = pg.generateProtocol({ material: 'collagen' });
            expect(cp.parameters.temperature).toBe(4);
        });
    });

    /* ── Step ordering and phase structure ─────────────────── */

    describe('step structure', function () {
        it('steps are numbered sequentially from 1', function () {
            var p = pg.generateProtocol({ material: 'alginate', cellType: 'mscs' });
            for (var i = 0; i < p.steps.length; i++) {
                expect(p.steps[i].step).toBe(i + 1);
            }
        });

        it('phases appear in correct order', function () {
            var p = pg.generateProtocol({ material: 'gelatin', cellType: 'fibroblasts' });
            var phases = [];
            p.steps.forEach(function (s) {
                if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
            });
            expect(phases[0]).toBe('Preparation');
            expect(phases).toContain('Cell Preparation');
            expect(phases).toContain('Mixing');
            expect(phases).toContain('Printer Setup');
            expect(phases).toContain('Printing');
            expect(phases).toContain('Post-Processing');
            // Preparation should come before Printing
            expect(phases.indexOf('Preparation')).toBeLessThan(phases.indexOf('Printing'));
        });

        it('every step has required fields', function () {
            var p = pg.generateProtocol({ material: 'fibrin', cellType: 'ipsc', construct: 'tube' });
            p.steps.forEach(function (s) {
                expect(s).toHaveProperty('step');
                expect(s).toHaveProperty('phase');
                expect(s).toHaveProperty('title');
                expect(s).toHaveProperty('details');
                expect(s).toHaveProperty('duration');
                expect(typeof s.step).toBe('number');
                expect(typeof s.details).toBe('string');
                expect(s.details.length).toBeGreaterThan(0);
            });
        });

        it('without explicit cellType, still includes cell prep steps', function () {
            var p = pg.generateProtocol({ material: 'alginate', cellType: 'fibroblasts' });
            var cellSteps = p.steps.filter(function (s) { return s.phase === 'Cell Preparation'; });
            expect(cellSteps.length).toBe(2);
        });
    });

    /* ── Total time estimation ────────────────────────────── */

    describe('timing', function () {
        it('totalMinutes is a positive number', function () {
            var p = pg.generateProtocol({ material: 'alginate' });
            expect(p.totalMinutes).toBeGreaterThan(0);
            expect(Number.isFinite(p.totalMinutes)).toBe(true);
        });

        it('estimated time uses human-friendly format', function () {
            var p = pg.generateProtocol({ material: 'gelma', construct: 'scaffold' });
            // scaffold has 25 layers → print time > 10 min → should show min or h
            expect(p.estimatedTime).toMatch(/\d+(h|min)/);
        });

        it('tube construct takes more time than sheet', function () {
            var tube = pg.generateProtocol({ material: 'alginate', construct: 'tube' });
            var sheet = pg.generateProtocol({ material: 'alginate', construct: 'sheet' });
            expect(tube.totalMinutes).toBeGreaterThan(sheet.totalMinutes);
        });
    });

    /* ── Material-specific crosslinker behaviors ──────────── */

    describe('material-specific behaviors', function () {
        it('alginate uses CaCl2 crosslinker', function () {
            var p = pg.generateProtocol({ material: 'alginate' });
            var crossStep = p.steps.find(function (s) { return s.title === 'Crosslinking'; });
            expect(crossStep.details).toContain('CaCl2');
        });

        it('gelma uses UV crosslinker', function () {
            var p = pg.generateProtocol({ material: 'gelma' });
            var crossStep = p.steps.find(function (s) { return s.title === 'Crosslinking'; });
            expect(crossStep.details).toContain('UV');
        });

        it('collagen uses thermal crosslinking', function () {
            var p = pg.generateProtocol({ material: 'collagen' });
            var crossStep = p.steps.find(function (s) { return s.title === 'Crosslinking'; });
            expect(crossStep.details).toContain('Thermal');
        });

        it('fibrin uses thrombin crosslinker', function () {
            var p = pg.generateProtocol({ material: 'fibrin' });
            var crossStep = p.steps.find(function (s) { return s.title === 'Crosslinking'; });
            expect(crossStep.details).toContain('Thrombin');
        });

        it('hyaluronic acid includes UV safety note', function () {
            var p = pg.generateProtocol({ material: 'hyaluronic acid' });
            var uvSafety = p.safety.find(function (s) { return s.indexOf('UV') >= 0; });
            expect(uvSafety).toBeTruthy();
        });
    });

    /* ── Material × Cell × Construct cross-product ────────── */

    describe('cross-product: every material with select cells and constructs', function () {
        var materials = pg.listMaterials();
        var cells = ['mscs', 'hepatocytes', 'ipsc'];
        var constructs = ['tube', 'sheet', 'scaffold'];

        materials.forEach(function (mat) {
            cells.forEach(function (cell) {
                constructs.forEach(function (con) {
                    it(mat + ' + ' + cell + ' + ' + con + ' generates valid protocol', function () {
                        var p = pg.generateProtocol({
                            material: mat, cellType: cell, construct: con
                        });
                        expect(p.steps.length).toBeGreaterThan(5);
                        expect(p.totalMinutes).toBeGreaterThan(0);
                        expect(p.materials.length).toBeGreaterThan(3);
                    });
                });
            });
        });
    });

    /* ── Custom parameters propagate into steps ──────────── */

    describe('custom parameters appear in step details', function () {
        it('nozzle diameter appears in workspace setup', function () {
            var p = pg.generateProtocol({ material: 'alginate', nozzleDiameter: 0.84 });
            var setup = p.steps.find(function (s) { return s.title === 'Workspace Setup'; });
            expect(setup.details).toContain('0.84');
        });

        it('pressure appears in calibrate step', function () {
            var p = pg.generateProtocol({ material: 'alginate', pressure: 45 });
            var cal = p.steps.find(function (s) { return s.title === 'Calibrate Printer'; });
            expect(cal.details).toContain('45');
        });

        it('speed appears in calibrate step', function () {
            var p = pg.generateProtocol({ material: 'alginate', speed: 12 });
            var cal = p.steps.find(function (s) { return s.title === 'Calibrate Printer'; });
            expect(cal.details).toContain('12');
        });

        it('wellplate appears in materials list', function () {
            var p = pg.generateProtocol({ material: 'alginate', wellplate: '96-well' });
            var plate = p.materials.find(function (m) { return m.item.indexOf('96-well') >= 0; });
            expect(plate).toBeTruthy();
        });

        it('project name in title', function () {
            var p = pg.generateProtocol({ material: 'alginate', projectName: 'Kidney Organoid' });
            expect(p.title).toBe('Kidney Organoid — Bioprinting Protocol');
        });
    });

    /* ── formatProtocolText edge cases ────────────────────── */

    describe('formatProtocolText', function () {
        it('includes checkpoint lines prefixed with ✓', function () {
            var p = pg.generateProtocol({ material: 'alginate', cellType: 'mscs' });
            var text = pg.formatProtocolText(p);
            expect(text).toContain('✓ Checkpoint:');
        });

        it('material checklist items start with ☐', function () {
            var p = pg.generateProtocol({ material: 'gelma' });
            var text = pg.formatProtocolText(p);
            var checklistLines = text.split('\n').filter(function (l) { return l.trim().startsWith('☐'); });
            expect(checklistLines.length).toBe(p.materials.length);
        });

        it('safety items start with ⚠', function () {
            var p = pg.generateProtocol({ material: 'gelma' });
            var text = pg.formatProtocolText(p);
            var safetyLines = text.split('\n').filter(function (l) { return l.trim().startsWith('⚠'); });
            expect(safetyLines.length).toBe(p.safety.length);
        });

        it('handles long project names without error', function () {
            var longName = 'A'.repeat(200);
            var p = pg.generateProtocol({ material: 'alginate', projectName: longName });
            var text = pg.formatProtocolText(p);
            expect(text).toContain(longName);
        });
    });

    /* ── Case insensitivity ──────────────────────────────── */

    describe('case insensitivity', function () {
        it('accepts uppercase material name', function () {
            var p = pg.generateProtocol({ material: 'ALGINATE' });
            expect(p.material).toBe('ALGINATE');
            expect(p.steps.length).toBeGreaterThan(5);
        });

        it('accepts mixed-case cell type', function () {
            var p = pg.generateProtocol({ material: 'alginate', cellType: 'MSCs' });
            expect(p.cellType).toBe('mscs');
        });

        it('accepts mixed-case construct', function () {
            var p = pg.generateProtocol({ material: 'alginate', construct: 'Scaffold' });
            expect(p.construct).toBe('scaffold');
        });
    });

    /* ── Database exports ────────────────────────────────── */

    describe('exported databases', function () {
        it('BIOINK_DB has required fields for every material', function () {
            Object.keys(pg.BIOINK_DB).forEach(function (key) {
                var m = pg.BIOINK_DB[key];
                expect(m).toHaveProperty('prepTemp');
                expect(m).toHaveProperty('mixTime');
                expect(m).toHaveProperty('crosslinker');
                expect(m).toHaveProperty('sterilization');
                expect(m).toHaveProperty('storageTemp');
            });
        });

        it('CELL_PROTOCOLS has required fields for every cell type', function () {
            Object.keys(pg.CELL_PROTOCOLS).forEach(function (key) {
                var c = pg.CELL_PROTOCOLS[key];
                expect(c).toHaveProperty('density');
                expect(c).toHaveProperty('medium');
                expect(c).toHaveProperty('centrifugeG');
            });
        });

        it('CONSTRUCT_PRESETS has required fields for every preset', function () {
            Object.keys(pg.CONSTRUCT_PRESETS).forEach(function (key) {
                var c = pg.CONSTRUCT_PRESETS[key];
                expect(c).toHaveProperty('layers');
                expect(c).toHaveProperty('infill');
                expect(c).toHaveProperty('pattern');
            });
        });
    });
});
