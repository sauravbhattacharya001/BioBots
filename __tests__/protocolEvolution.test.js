'use strict';

var { createProtocolEvolution } = require('../docs/shared/protocolEvolution');

describe('Protocol Evolution Engine', function () {
    var evo;

    beforeEach(function () {
        evo = createProtocolEvolution();
    });

    describe('ingest', function () {
        it('accepts a valid protocol record', function () {
            var result = evo.ingest({
                id: 'P1', generation: 1,
                parameters: { temp: 23, pressure: 100 },
                fitness: 0.85
            });
            expect(result.accepted).toBe(true);
            expect(result.generation).toBe(1);
        });

        it('throws on missing id', function () {
            expect(function () {
                evo.ingest({ parameters: { x: 1 }, fitness: 0.5 });
            }).toThrow(/id/);
        });

        it('throws on missing fitness', function () {
            expect(function () {
                evo.ingest({ id: 'X', parameters: { x: 1 } });
            }).toThrow(/fitness/);
        });

        it('throws on missing parameters', function () {
            expect(function () {
                evo.ingest({ id: 'X', fitness: 0.5 });
            }).toThrow(/parameters/);
        });

        it('defaults generation to 1', function () {
            var result = evo.ingest({ id: 'P1', parameters: { a: 1 }, fitness: 0.5 });
            expect(result.generation).toBe(1);
        });

        it('detects mutations from parent', function () {
            evo.ingest({ id: 'P1', generation: 1, parameters: { temp: 23, speed: 5 }, fitness: 0.7 });
            evo.ingest({ id: 'P2', generation: 2, parameters: { temp: 25, speed: 5 }, fitness: 0.8, parentIds: ['P1'] });
            var analysis = evo.analyze();
            expect(analysis.mutations.total).toBeGreaterThan(0);
            expect(analysis.mutations.beneficial).toBeGreaterThan(0);
        });
    });

    describe('breed', function () {
        beforeEach(function () {
            // Seed a generation of 5 protocols
            for (var i = 1; i <= 5; i++) {
                evo.ingest({
                    id: 'G1-' + i, generation: 1,
                    parameters: { temp: 20 + i, pressure: 100 + i * 2, speed: 3 + i * 0.5 },
                    fitness: 0.5 + i * 0.08
                });
            }
        });

        it('produces offspring of requested size', function () {
            var result = evo.breed({ populationSize: 8 });
            expect(result.offspring.length).toBe(8);
            expect(result.generation).toBe(2);
        });

        it('includes elite carry-over', function () {
            var result = evo.breed({ populationSize: 10 });
            expect(result.eliteCount).toBeGreaterThanOrEqual(1);
            var elites = result.offspring.filter(function (o) { return o.origin === 'elite'; });
            expect(elites.length).toBe(result.eliteCount);
        });

        it('offspring have parentIds', function () {
            var result = evo.breed({ populationSize: 6 });
            result.offspring.forEach(function (o) {
                expect(o.parentIds.length).toBeGreaterThanOrEqual(1);
            });
        });

        it('applies parameter bounds', function () {
            evo.configure({ parameterBounds: { temp: { min: 18, max: 30 } } });
            var result = evo.breed({ populationSize: 20, mutationRate: 1.0, mutationStrength: 5.0 });
            result.offspring.forEach(function (o) {
                expect(o.parameters.temp).toBeGreaterThanOrEqual(18);
                expect(o.parameters.temp).toBeLessThanOrEqual(30);
            });
        });

        it('throws with insufficient population', function () {
            var evo2 = createProtocolEvolution();
            evo2.ingest({ id: 'A', generation: 1, parameters: { x: 1 }, fitness: 0.5 });
            expect(function () { evo2.breed(); }).toThrow(/at least/);
        });

        it('throws with no protocols', function () {
            var evo2 = createProtocolEvolution();
            expect(function () { evo2.breed(); }).toThrow(/No protocols/);
        });

        it('increments generation automatically', function () {
            var r = evo.breed();
            expect(r.generation).toBe(2);
            expect(r.sourceGeneration).toBe(1);
        });
    });

    describe('analyze', function () {
        it('returns NO_DATA when empty', function () {
            var result = evo.analyze();
            expect(result.status).toBe('NO_DATA');
        });

        it('provides generation stats', function () {
            for (var i = 1; i <= 4; i++) {
                evo.ingest({ id: 'G1-' + i, generation: 1, parameters: { x: i }, fitness: 0.5 + i * 0.1 });
            }
            var result = evo.analyze();
            expect(result.generationStats.length).toBe(1);
            expect(result.generationStats[0].best).toBe(0.9);
            expect(result.generationStats[0].worst).toBeCloseTo(0.6, 5);
        });

        it('detects convergence', function () {
            // All same fitness = converged
            for (var i = 1; i <= 5; i++) {
                evo.ingest({ id: 'G1-' + i, generation: 1, parameters: { x: i }, fitness: 0.80 });
            }
            var result = evo.analyze();
            expect(result.converged).toBe(true);
            expect(result.status).toBe('CONVERGED');
        });

        it('detects evolving state', function () {
            evo.ingest({ id: 'A', generation: 1, parameters: { x: 1 }, fitness: 0.3 });
            evo.ingest({ id: 'B', generation: 1, parameters: { x: 5 }, fitness: 0.9 });
            var result = evo.analyze();
            expect(result.converged).toBe(false);
            expect(result.status).toBe('EVOLVING');
        });

        it('tracks improvement across generations', function () {
            for (var i = 1; i <= 3; i++) {
                evo.ingest({ id: 'G1-' + i, generation: 1, parameters: { x: i }, fitness: 0.5 + i * 0.05 });
            }
            for (var j = 1; j <= 3; j++) {
                evo.ingest({ id: 'G2-' + j, generation: 2, parameters: { x: j + 3 }, fitness: 0.7 + j * 0.05, parentIds: ['G1-' + j] });
            }
            var result = evo.analyze();
            expect(result.improvement.length).toBe(1);
            expect(result.improvement[0].bestDelta).toBeGreaterThan(0);
        });

        it('identifies best protocol', function () {
            evo.ingest({ id: 'LOW', generation: 1, parameters: { x: 1 }, fitness: 0.3 });
            evo.ingest({ id: 'HIGH', generation: 1, parameters: { x: 10 }, fitness: 0.95 });
            var result = evo.analyze();
            expect(result.bestProtocol.id).toBe('HIGH');
            expect(result.bestProtocol.tier).toBe('EXCELLENT');
        });

        it('ranks parameter importance', function () {
            evo.ingest({ id: 'P1', generation: 1, parameters: { temp: 20, speed: 5 }, fitness: 0.5 });
            evo.ingest({ id: 'P2', generation: 2, parameters: { temp: 25, speed: 5 }, fitness: 0.8, parentIds: ['P1'] });
            evo.ingest({ id: 'P3', generation: 2, parameters: { temp: 20, speed: 8 }, fitness: 0.4, parentIds: ['P1'] });
            var result = evo.analyze();
            expect(result.parameterImportance.length).toBeGreaterThan(0);
            // temp mutation was beneficial, speed mutation was not
            var tempEntry = result.parameterImportance.find(function (p) { return p.parameter === 'temp'; });
            expect(tempEntry.benefitRate).toBe(1.0);
        });

        it('generates recommendations on convergence', function () {
            for (var i = 1; i <= 5; i++) {
                evo.ingest({ id: 'G1-' + i, generation: 1, parameters: { x: i }, fitness: 0.80 });
            }
            var result = evo.analyze();
            var convRec = result.recommendations.find(function (r) { return r.type === 'CONVERGENCE_WARNING'; });
            expect(convRec).toBeDefined();
        });
    });

    describe('getLineage', function () {
        it('returns null for unknown id', function () {
            expect(evo.getLineage('nonexist')).toBeNull();
        });

        it('tracks parent-child relationships', function () {
            evo.ingest({ id: 'P1', generation: 1, parameters: { x: 1 }, fitness: 0.5 });
            evo.ingest({ id: 'C1', generation: 2, parameters: { x: 2 }, fitness: 0.7, parentIds: ['P1'] });
            var lin = evo.getLineage('C1');
            expect(lin.parents).toContain('P1');
            expect(lin.ancestors).toContain('P1');
        });

        it('tracks children', function () {
            evo.ingest({ id: 'P1', generation: 1, parameters: { x: 1 }, fitness: 0.5 });
            evo.ingest({ id: 'C1', generation: 2, parameters: { x: 2 }, fitness: 0.7, parentIds: ['P1'] });
            var lin = evo.getLineage('P1');
            expect(lin.children).toContain('C1');
        });

        it('traces multi-generation ancestry', function () {
            evo.ingest({ id: 'A', generation: 1, parameters: { x: 1 }, fitness: 0.5 });
            evo.ingest({ id: 'B', generation: 2, parameters: { x: 2 }, fitness: 0.6, parentIds: ['A'] });
            evo.ingest({ id: 'C', generation: 3, parameters: { x: 3 }, fitness: 0.7, parentIds: ['B'] });
            var lin = evo.getLineage('C');
            expect(lin.ancestors).toContain('B');
            expect(lin.ancestors).toContain('A');
            expect(lin.depth).toBe(2);
        });
    });

    describe('getGeneration', function () {
        it('returns null for unknown generation', function () {
            expect(evo.getGeneration(99)).toBeNull();
        });

        it('returns sorted protocols for a generation', function () {
            evo.ingest({ id: 'A', generation: 1, parameters: { x: 1 }, fitness: 0.3 });
            evo.ingest({ id: 'B', generation: 1, parameters: { x: 2 }, fitness: 0.9 });
            evo.ingest({ id: 'C', generation: 1, parameters: { x: 3 }, fitness: 0.6 });
            var gen = evo.getGeneration(1);
            expect(gen.length).toBe(3);
            expect(gen[0].id).toBe('B'); // highest fitness first
        });
    });

    describe('configure', function () {
        it('updates mutation rate', function () {
            evo.configure({ mutationRate: 0.5 });
            var summary = evo.getSummary();
            expect(summary.configuration.mutationRate).toBe(0.5);
        });

        it('updates selection strategy', function () {
            evo.configure({ selectionStrategy: 'roulette' });
            var summary = evo.getSummary();
            expect(summary.configuration.selectionStrategy).toBe('roulette');
        });
    });

    describe('getSummary', function () {
        it('reports correct totals', function () {
            evo.ingest({ id: 'A', generation: 1, parameters: { x: 1 }, fitness: 0.5 });
            evo.ingest({ id: 'B', generation: 2, parameters: { x: 2 }, fitness: 0.6, parentIds: ['A'] });
            var summary = evo.getSummary();
            expect(summary.totalProtocols).toBe(2);
            expect(summary.totalGenerations).toBe(2);
            expect(summary.totalMutationsTracked).toBeGreaterThan(0);
        });
    });

    describe('reset', function () {
        it('clears all data', function () {
            evo.ingest({ id: 'A', generation: 1, parameters: { x: 1 }, fitness: 0.5 });
            evo.reset();
            var summary = evo.getSummary();
            expect(summary.totalProtocols).toBe(0);
            expect(summary.totalGenerations).toBe(0);
        });
    });

    describe('selection strategies', function () {
        beforeEach(function () {
            for (var i = 1; i <= 6; i++) {
                evo.ingest({
                    id: 'G1-' + i, generation: 1,
                    parameters: { temp: 20 + i, pressure: 95 + i * 3 },
                    fitness: 0.4 + i * 0.1
                });
            }
        });

        it('breeds with roulette selection', function () {
            var result = evo.breed({ selectionStrategy: 'roulette', populationSize: 6 });
            expect(result.offspring.length).toBe(6);
            expect(result.strategy).toBe('roulette');
        });

        it('breeds with rank selection', function () {
            var result = evo.breed({ selectionStrategy: 'rank', populationSize: 6 });
            expect(result.offspring.length).toBe(6);
        });

        it('breeds with elite selection', function () {
            var result = evo.breed({ selectionStrategy: 'elite', populationSize: 4 });
            expect(result.offspring.length).toBe(4);
        });
    });

    describe('multi-generation evolution', function () {
        it('runs 3 generations of evolution', function () {
            // Gen 1
            for (var i = 1; i <= 5; i++) {
                evo.ingest({
                    id: 'G1-' + i, generation: 1,
                    parameters: { temp: 18 + i * 2, pressure: 90 + i * 5, speed: 2 + i },
                    fitness: 0.3 + i * 0.12
                });
            }

            // Breed gen 2
            var gen2 = evo.breed({ generation: 2, populationSize: 5 });
            // Simulate: ingest gen2 with slightly improved fitness
            for (var j = 0; j < gen2.offspring.length; j++) {
                var o = gen2.offspring[j];
                evo.ingest({
                    id: o.id, generation: 2,
                    parameters: o.parameters,
                    fitness: Math.min(1, (o.predictedFitness || 0.6) + Math.random() * 0.1),
                    parentIds: o.parentIds
                });
            }

            // Breed gen 3
            var gen3 = evo.breed({ generation: 3, populationSize: 5 });
            expect(gen3.generation).toBe(3);
            expect(gen3.sourceGeneration).toBe(2);

            var analysis = evo.analyze();
            expect(analysis.totalGenerations).toBe(2); // Only ingested gens 1&2
            expect(analysis.totalProtocols).toBe(10);
        });
    });
});
