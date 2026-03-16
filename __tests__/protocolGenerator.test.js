'use strict';

var pg = require('../docs/shared/protocolGenerator');

describe('Protocol Generator', function () {
    describe('generateProtocol', function () {
        it('should throw if no params', function () {
            expect(function () { pg.generateProtocol(); }).toThrow('material is required');
        });

        it('should throw if material missing', function () {
            expect(function () { pg.generateProtocol({}); }).toThrow('material is required');
        });

        it('should throw for unknown material', function () {
            expect(function () { pg.generateProtocol({ material: 'unobtainium' }); })
                .toThrow(/Unknown material/);
        });

        it('should generate a protocol for alginate', function () {
            var p = pg.generateProtocol({ material: 'alginate' });
            expect(p.material).toBe('alginate');
            expect(p.cellType).toBe('generic');
            expect(p.construct).toBe('disk');
            expect(p.steps.length).toBeGreaterThan(5);
            expect(p.materials.length).toBeGreaterThan(3);
            expect(p.safety.length).toBeGreaterThan(0);
            expect(p.totalMinutes).toBeGreaterThan(0);
            expect(p.estimatedTime).toBeTruthy();
            expect(p.generatedAt).toBeTruthy();
        });

        it('should accept all parameters', function () {
            var p = pg.generateProtocol({
                material: 'gelma',
                cellType: 'chondrocytes',
                construct: 'scaffold',
                nozzleDiameter: 0.25,
                pressure: 30,
                temperature: 37,
                speed: 3,
                layerHeight: 0.15,
                wellplate: '24-well',
                projectName: 'Cartilage Study'
            });
            expect(p.title).toContain('Cartilage Study');
            expect(p.parameters.nozzleDiameter).toBe(0.25);
            expect(p.parameters.pressure).toBe(30);
            expect(p.parameters.layers).toBe(25);
            expect(p.parameters.pattern).toBe('honeycomb');
        });

        it('should include UV safety for GelMA', function () {
            var p = pg.generateProtocol({ material: 'gelma' });
            var uvNote = p.safety.find(function (s) { return s.indexOf('UV') >= 0; });
            expect(uvNote).toBeTruthy();
        });

        it('should not include UV safety for alginate', function () {
            var p = pg.generateProtocol({ material: 'alginate' });
            var uvNote = p.safety.find(function (s) { return s.indexOf('UV-blocking') >= 0; });
            expect(uvNote).toBeFalsy();
        });

        it('should handle all materials', function () {
            var mats = pg.listMaterials();
            mats.forEach(function (m) {
                var p = pg.generateProtocol({ material: m });
                expect(p.steps.length).toBeGreaterThan(5);
            });
        });

        it('should handle all cell types', function () {
            var cells = pg.listCellTypes();
            cells.forEach(function (c) {
                var p = pg.generateProtocol({ material: 'alginate', cellType: c });
                expect(p.cellType).toBe(c);
            });
        });

        it('should handle all constructs', function () {
            var constructs = pg.listConstructs();
            constructs.forEach(function (c) {
                var p = pg.generateProtocol({ material: 'alginate', construct: c });
                expect(p.construct).toBe(c);
            });
        });

        it('should fall back to generic cell protocol for unknown cell type', function () {
            var p = pg.generateProtocol({ material: 'alginate', cellType: 'alien_cells' });
            expect(p.steps.length).toBeGreaterThan(5);
        });

        it('should fall back to custom construct for unknown preset', function () {
            var p = pg.generateProtocol({ material: 'alginate', construct: 'pyramid' });
            expect(p.construct).toBe('pyramid');
        });

        it('should include trypsin step for fibroblasts', function () {
            var p = pg.generateProtocol({ material: 'collagen', cellType: 'fibroblasts' });
            var harvest = p.steps.find(function (s) { return s.title === 'Cell Harvesting'; });
            expect(harvest.details).toContain('trypsin');
        });

        it('should use enzyme-free for hepatocytes', function () {
            var p = pg.generateProtocol({ material: 'collagen', cellType: 'hepatocytes' });
            var harvest = p.steps.find(function (s) { return s.title === 'Cell Harvesting'; });
            expect(harvest.details).toContain('enzyme-free');
        });

        it('should include checkpoints', function () {
            var p = pg.generateProtocol({ material: 'alginate', cellType: 'mscs' });
            var withCheckpoints = p.steps.filter(function (s) { return s.checkpoint; });
            expect(withCheckpoints.length).toBeGreaterThanOrEqual(3);
        });

        it('should include trypsin in materials for applicable cells', function () {
            var p = pg.generateProtocol({ material: 'alginate', cellType: 'fibroblasts' });
            var trypsin = p.materials.find(function (m) { return m.item.indexOf('Trypsin') >= 0; });
            expect(trypsin).toBeTruthy();
        });

        it('should not include trypsin for iPSCs', function () {
            var p = pg.generateProtocol({ material: 'alginate', cellType: 'ipsc' });
            var trypsin = p.materials.find(function (m) { return m.item.indexOf('Trypsin') >= 0; });
            expect(trypsin).toBeFalsy();
        });
    });

    describe('formatProtocolText', function () {
        it('should produce formatted text output', function () {
            var p = pg.generateProtocol({ material: 'fibrin', cellType: 'mscs', projectName: 'Bone Graft' });
            var text = pg.formatProtocolText(p);
            expect(text).toContain('Bone Graft');
            expect(text).toContain('PARAMETERS');
            expect(text).toContain('MATERIALS CHECKLIST');
            expect(text).toContain('SAFETY NOTES');
            expect(text).toContain('PROTOCOL STEPS');
            expect(text).toContain('Step 1');
        });

        it('should include phase headers', function () {
            var p = pg.generateProtocol({ material: 'alginate' });
            var text = pg.formatProtocolText(p);
            expect(text).toContain('PREPARATION');
            expect(text).toContain('PRINTING');
            expect(text).toContain('POST-PROCESSING');
        });
    });

    describe('list functions', function () {
        it('listMaterials returns all materials', function () {
            var m = pg.listMaterials();
            expect(m).toContain('alginate');
            expect(m).toContain('gelma');
            expect(m).toContain('collagen');
            expect(m.length).toBe(6);
        });

        it('listCellTypes returns all cell types', function () {
            var c = pg.listCellTypes();
            expect(c).toContain('chondrocytes');
            expect(c).toContain('generic');
            expect(c.length).toBe(7);
        });

        it('listConstructs returns all presets', function () {
            var c = pg.listConstructs();
            expect(c).toContain('disk');
            expect(c).toContain('scaffold');
            expect(c.length).toBe(6);
        });
    });
});
