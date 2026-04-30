'use strict';

var _mod = require('../docs/shared/experimentRiskAssessor');
var createExperimentRiskAssessor = _mod.createExperimentRiskAssessor;

describe('ExperimentRiskAssessor', function () {
    var assessor;

    beforeEach(function () {
        assessor = createExperimentRiskAssessor();
    });

    describe('Factory', function () {
        it('creates an assessor with expected API', function () {
            expect(typeof assessor.assess).toBe('function');
            expect(typeof assessor.whatIf).toBe('function');
            expect(typeof assessor.trends).toBe('function');
            expect(typeof assessor.history).toBe('function');
            expect(typeof assessor.getDimensions).toBe('function');
            expect(typeof assessor.getVerdictScale).toBe('function');
            expect(typeof assessor.getMaterialDatabase).toBe('function');
            expect(typeof assessor.getEquipmentDatabase).toBe('function');
        });

        it('throws on null experiment', function () {
            expect(function () { assessor.assess(null); }).toThrow();
        });

        it('throws on non-object experiment', function () {
            expect(function () { assessor.assess('hello'); }).toThrow();
        });
    });

    describe('Basic Assessment', function () {
        it('returns GO verdict for simple low-risk experiment', function () {
            var result = assessor.assess({
                title: 'Simple alginate test',
                materials: ['alginate'],
                duration_hours: 2,
                equipment: ['bioprinter_1'],
                personnel: [{ name: 'Alice', certifications: ['lab_safety', 'bioprinter'] }],
                biosafety_level: 1
            });
            expect(result.verdict).toBe('GO');
            expect(result.compositeScore).toBeLessThan(26);
            expect(result.confidence).toBeGreaterThan(0);
        });

        it('returns higher risk for BSL mismatch', function () {
            var result = assessor.assess({
                title: 'Stem cell work at wrong BSL',
                materials: ['mscs', 'gelma'],
                biosafety_level: 1,
                equipment: ['bioprinter_1', 'uv_crosslinker'],
                personnel: [{ name: 'Bob', certifications: ['lab_safety'] }]
            });
            expect(result.compositeScore).toBeGreaterThan(10);
            expect(result.dimensions.biosafety.score).toBeGreaterThan(30);
        });

        it('returns NO_GO for extreme risk experiment', function () {
            var result = assessor.assess({
                title: 'Everything wrong',
                materials: ['ecoli', 'mscs', 'unknown_material_x'],
                biosafety_level: 1,
                duration_hours: 72,
                deadline_hours: 24,
                equipment: ['bioprinter_1'],
                personnel: [],
                protocol_approved: false,
                ethics_approved: false,
                parallel_experiments: 5,
                parallel_bio_experiments: 5,
                novelty: 'pioneering'
            });
            expect(['CONDITIONAL', 'DEFER', 'NO_GO']).toContain(result.verdict);
            expect(result.compositeScore).toBeGreaterThan(50);
        });
    });

    describe('Biosafety Dimension', function () {
        it('flags UV-curable material without crosslinker', function () {
            var result = assessor.assess({
                materials: ['gelma'],
                equipment: ['bioprinter_1'],
                biosafety_level: 1
            });
            expect(result.dimensions.biosafety.findings.some(function (f) {
                return f.indexOf('UV') >= 0;
            })).toBe(true);
        });

        it('flags ecoli + mammalian cell mix', function () {
            var result = assessor.assess({
                materials: ['ecoli', 'mscs'],
                biosafety_level: 2
            });
            expect(result.dimensions.cross_contamination.findings.some(function (f) {
                return f.indexOf('strictly separated') >= 0;
            })).toBe(true);
        });
    });

    describe('Resource Dimension', function () {
        it('flags out-of-stock materials', function () {
            var result = assessor.assess({
                materials: ['alginate', 'collagen'],
                inventory: { alginate: 5, collagen: 0 }
            });
            expect(result.dimensions.resource.score).toBeGreaterThan(15);
            expect(result.dimensions.resource.findings.some(function (f) {
                return f.indexOf('not in stock') >= 0;
            })).toBe(true);
        });

        it('flags budget overrun', function () {
            var result = assessor.assess({
                materials: ['alginate'],
                estimated_cost: 5000,
                budget_remaining: 3000
            });
            expect(result.dimensions.resource.findings.some(function (f) {
                return f.indexOf('exceeds') >= 0;
            })).toBe(true);
        });
    });

    describe('Timeline Dimension', function () {
        it('flags long experiments', function () {
            var result = assessor.assess({
                materials: ['alginate'],
                duration_hours: 60
            });
            expect(result.dimensions.timeline.score).toBeGreaterThan(20);
        });

        it('flags deadline pressure', function () {
            var result = assessor.assess({
                materials: ['alginate'],
                duration_hours: 10,
                deadline_hours: 8
            });
            expect(result.dimensions.timeline.findings.some(function (f) {
                return f.indexOf('exceeds') >= 0;
            })).toBe(true);
        });
    });

    describe('Equipment Dimension', function () {
        it('flags overdue calibration', function () {
            var result = assessor.assess({
                materials: ['alginate'],
                equipment: ['bioprinter_1'],
                calibration_status: { bioprinter_1: 'overdue' }
            });
            expect(result.dimensions.equipment.findings.some(function (f) {
                return f.indexOf('calibration overdue') >= 0;
            })).toBe(true);
        });

        it('calculates failure probability for long runs', function () {
            var result = assessor.assess({
                materials: ['alginate'],
                equipment: ['bioprinter_1'],
                duration_hours: 100
            });
            expect(result.dimensions.equipment.score).toBeGreaterThan(10);
        });
    });

    describe('Personnel Dimension', function () {
        it('flags missing certifications', function () {
            var result = assessor.assess({
                materials: ['mscs'],
                biosafety_level: 2,
                personnel: [{ name: 'Intern', certifications: [] }]
            });
            expect(result.dimensions.personnel.score).toBeGreaterThan(10);
        });

        it('flags no personnel', function () {
            var result = assessor.assess({
                materials: ['alginate'],
                personnel: []
            });
            expect(result.dimensions.personnel.score).toBeGreaterThan(25);
        });
    });

    describe('Mitigations', function () {
        it('generates sorted mitigations', function () {
            var result = assessor.assess({
                materials: ['mscs', 'gelma'],
                biosafety_level: 1,
                protocol_approved: false,
                equipment: ['bioprinter_1'],
                calibration_status: { bioprinter_1: 'overdue' },
                personnel: [{ name: 'Alice', certifications: [] }]
            });
            expect(result.mitigations.length).toBeGreaterThan(0);
            // Sorted by impact descending
            for (var i = 1; i < result.mitigations.length; i++) {
                expect(result.mitigations[i].riskReduction).toBeLessThanOrEqual(result.mitigations[i - 1].riskReduction);
            }
        });
    });

    describe('What-If Analysis', function () {
        it('shows improvement when fixing BSL', function () {
            var experiment = {
                materials: ['mscs'],
                biosafety_level: 1,
                personnel: [{ name: 'A', certifications: ['lab_safety', 'BSL2'] }]
            };
            var result = assessor.whatIf(experiment, { biosafety_level: 2 });
            expect(result.improved).toBe(true);
            expect(result.scoreDelta).toBeLessThan(0);
        });

        it('shows degradation when adding deadline pressure', function () {
            var experiment = {
                materials: ['alginate'],
                duration_hours: 10
            };
            var result = assessor.whatIf(experiment, { deadline_hours: 8 });
            expect(result.improved).toBe(false);
            expect(result.scoreDelta).toBeGreaterThan(0);
        });
    });

    describe('Trend Detection', function () {
        it('returns insufficient message with < 3 assessments', function () {
            assessor.assess({ materials: ['alginate'] });
            var trends = assessor.trends();
            expect(trends.hasTrend).toBe(false);
        });

        it('detects increasing trend', function () {
            // Low risk
            assessor.assess({ materials: ['alginate'], duration_hours: 2, novelty: 'routine' });
            // Medium risk
            assessor.assess({ materials: ['mscs'], biosafety_level: 1, duration_hours: 24, novelty: 'moderate' });
            // High risk
            assessor.assess({ materials: ['ecoli', 'mscs'], biosafety_level: 1, duration_hours: 60, novelty: 'pioneering', personnel: [] });
            var trends = assessor.trends();
            expect(trends.direction).toBe('increasing');
        });
    });

    describe('Metadata', function () {
        it('lists known materials', function () {
            var mats = assessor.getMaterialDatabase();
            expect(mats).toContain('alginate');
            expect(mats).toContain('gelma');
            expect(mats.length).toBeGreaterThan(10);
        });

        it('lists known equipment', function () {
            var eq = assessor.getEquipmentDatabase();
            expect(eq).toContain('bioprinter_1');
            expect(eq).toContain('incubator');
        });

        it('provides dimension definitions', function () {
            var dims = assessor.getDimensions();
            expect(dims.BIOSAFETY).toBeDefined();
            expect(dims.BIOSAFETY.weight).toBe(0.20);
        });

        it('provides verdict scale', function () {
            var scale = assessor.getVerdictScale();
            expect(scale.length).toBe(5);
            expect(scale[0].verdict).toBe('GO');
        });
    });

    describe('History', function () {
        it('records assessments', function () {
            assessor.assess({ materials: ['alginate'] });
            assessor.assess({ materials: ['gelma'] });
            expect(assessor.history().length).toBe(2);
        });

        it('clearHistory resets', function () {
            assessor.assess({ materials: ['alginate'] });
            assessor.clearHistory();
            expect(assessor.history().length).toBe(0);
        });
    });

    describe('Success Probability', function () {
        it('scores low for routine work', function () {
            var result = assessor.assess({ materials: ['alginate'], novelty: 'routine', replicates: 5 });
            expect(result.dimensions.success_probability.score).toBeLessThan(15);
        });

        it('scores high for pioneering work', function () {
            var result = assessor.assess({ materials: ['alginate'], novelty: 'pioneering', replicates: 1 });
            expect(result.dimensions.success_probability.score).toBeGreaterThan(50);
        });

        it('flags low prior success rate', function () {
            var result = assessor.assess({ materials: ['alginate'], prior_success_rate: 0.3 });
            expect(result.dimensions.success_probability.findings.some(function (f) {
                return f.indexOf('Low historical') >= 0;
            })).toBe(true);
        });
    });

    describe('Regulatory Dimension', function () {
        it('flags missing IBC for BSL2', function () {
            var result = assessor.assess({
                materials: ['mscs'],
                biosafety_level: 2,
                approvals: []
            });
            expect(result.dimensions.regulatory.findings.some(function (f) {
                return f.indexOf('IBC') >= 0;
            })).toBe(true);
        });

        it('flags missing SOP', function () {
            var result = assessor.assess({
                materials: ['alginate'],
                sop_available: false
            });
            expect(result.dimensions.regulatory.findings.some(function (f) {
                return f.indexOf('SOP') >= 0;
            })).toBe(true);
        });
    });
});
