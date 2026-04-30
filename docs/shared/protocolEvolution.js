'use strict';

/**
 * Protocol Evolution Engine
 *
 * Autonomous evolutionary optimization module that tracks protocol variants
 * across generations, applies natural-selection-inspired pressure based on
 * experimental outcomes, identifies beneficial mutations, and breeds
 * next-generation protocols with the highest predicted performance.
 *
 * Key capabilities:
 * - Ingest protocol variants with parameters and fitness scores
 * - Generational tracking with parent-child lineage
 * - Mutation detection — identify which parameter changes drove improvement
 * - Fitness landscape mapping — multi-dimensional outcome scoring
 * - Selection pressure — tournament, roulette, and elite strategies
 * - Crossover — combine best traits from top-performing protocols
 * - Mutation operators — intelligent perturbation of parameters
 * - Convergence detection — know when evolution has plateaued
 * - Diversity metrics — avoid premature convergence
 * - Breed next generation autonomously with configurable strategies
 * - Full lineage tree with ancestor tracking
 *
 * @example
 *   var evo = createProtocolEvolution();
 *   evo.ingest({ id: 'GEN1-001', generation: 1, parameters: { temp: 23, pressure: 100, speed: 5 }, fitness: 0.82 });
 *   evo.ingest({ id: 'GEN1-002', generation: 1, parameters: { temp: 25, pressure: 105, speed: 4 }, fitness: 0.91 });
 *   var next = evo.breed({ generation: 2, populationSize: 6 });
 *   var analysis = evo.analyze();
 */

// ── Constants ──────────────────────────────────────────────────────

var MIN_POPULATION = 3;
var DEFAULT_MUTATION_RATE = 0.15;
var DEFAULT_MUTATION_STRENGTH = 0.1;
var DEFAULT_CROSSOVER_RATE = 0.7;
var DEFAULT_ELITE_FRACTION = 0.2;
var CONVERGENCE_THRESHOLD = 0.02; // fitness stddev below this = converged

var SELECTION_STRATEGIES = ['tournament', 'roulette', 'elite', 'rank'];
var MUTATION_TYPES = ['gaussian', 'uniform', 'creep', 'reset'];

var FITNESS_TIERS = [
    { label: 'UNVIABLE',   min: 0,    max: 0.3, color: '#ef4444' },
    { label: 'POOR',       min: 0.3,  max: 0.5, color: '#f97316' },
    { label: 'ADEQUATE',   min: 0.5,  max: 0.7, color: '#eab308' },
    { label: 'GOOD',       min: 0.7,  max: 0.85, color: '#22c55e' },
    { label: 'EXCELLENT',  min: 0.85, max: 1.0, color: '#059669' }
];

// ── Statistical helpers ────────────────────────────────────────────

function mean(arr) {
    if (!arr || arr.length === 0) return 0;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
}

function stddev(arr) {
    if (!arr || arr.length < 2) return 0;
    var m = mean(arr);
    var ss = 0;
    for (var i = 0; i < arr.length; i++) {
        var d = arr[i] - m;
        ss += d * d;
    }
    return Math.sqrt(ss / (arr.length - 1));
}

function clamp(val, lo, hi) {
    return val < lo ? lo : val > hi ? hi : val;
}

function gaussianRandom() {
    // Box-Muller transform
    var u1 = Math.random();
    var u2 = Math.random();
    if (u1 < 1e-10) u1 = 1e-10;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

var DANGEROUS_KEYS = { '__proto__': true, 'constructor': true, 'prototype': true };

function _isDangerousKey(key) {
    return DANGEROUS_KEYS[key] === true;
}

function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    var copy = Array.isArray(obj) ? [] : Object.create(null);
    if (Array.isArray(obj)) copy = [];
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
        if (_isDangerousKey(keys[i])) continue;
        copy[keys[i]] = deepClone(obj[keys[i]]);
    }
    return copy;
}

function getFitnessTier(fitness) {
    for (var i = FITNESS_TIERS.length - 1; i >= 0; i--) {
        if (fitness >= FITNESS_TIERS[i].min) return FITNESS_TIERS[i];
    }
    return FITNESS_TIERS[0];
}

// ── Factory ────────────────────────────────────────────────────────

function createProtocolEvolution(options) {
    var opts = options || {};
    var mutationRate = opts.mutationRate || DEFAULT_MUTATION_RATE;
    var mutationStrength = opts.mutationStrength || DEFAULT_MUTATION_STRENGTH;
    var crossoverRate = opts.crossoverRate || DEFAULT_CROSSOVER_RATE;
    var eliteFraction = opts.eliteFraction || DEFAULT_ELITE_FRACTION;
    var selectionStrategy = opts.selectionStrategy || 'tournament';
    var parameterBounds = opts.parameterBounds || {}; // { paramName: { min, max } }

    // Storage — use null-prototype objects to prevent prototype pollution
    var protocols = [];        // all ingested protocols
    var generations = Object.create(null); // generation number → array of protocol indices
    var lineage = Object.create(null);     // id → { parentIds: [], childIds: [] }
    var mutations = [];        // detected mutations log

    // ── Ingest ─────────────────────────────────────────────────────

    function ingest(record) {
        if (!record || typeof record !== 'object') {
            throw new Error('Protocol record must be an object');
        }
        if (!record.id) throw new Error('Protocol record must have an id');
        if (_isDangerousKey(record.id)) {
            throw new Error('Protocol id is not allowed: ' + record.id);
        }
        if (record.fitness === undefined || record.fitness === null) {
            throw new Error('Protocol record must have a fitness score');
        }
        if (!record.parameters || typeof record.parameters !== 'object') {
            throw new Error('Protocol record must have parameters object');
        }

        var gen = record.generation || 1;
        var entry = {
            id: record.id,
            generation: gen,
            parameters: deepClone(record.parameters),
            fitness: Number(record.fitness),
            parentIds: record.parentIds || [],
            tags: record.tags || [],
            timestamp: record.timestamp || Date.now(),
            metadata: record.metadata || {}
        };

        protocols.push(entry);
        var idx = protocols.length - 1;

        if (!generations[gen]) generations[gen] = [];
        generations[gen].push(idx);

        // Track lineage — reject dangerous IDs to prevent prototype pollution
        lineage[entry.id] = { parentIds: entry.parentIds, childIds: [] };
        for (var p = 0; p < entry.parentIds.length; p++) {
            var pid = entry.parentIds[p];
            if (_isDangerousKey(pid)) continue;
            if (lineage[pid]) {
                lineage[pid].childIds.push(entry.id);
            }
        }

        // Detect mutations from parents
        if (entry.parentIds.length > 0) {
            _detectMutations(entry);
        }

        return { accepted: true, index: idx, generation: gen };
    }

    function _detectMutations(entry) {
        for (var p = 0; p < entry.parentIds.length; p++) {
            var parent = _findById(entry.parentIds[p]);
            if (!parent) continue;

            var paramKeys = Object.keys(entry.parameters);
            for (var k = 0; k < paramKeys.length; k++) {
                var key = paramKeys[k];
                var childVal = entry.parameters[key];
                var parentVal = parent.parameters[key];
                if (parentVal === undefined) continue;
                if (typeof childVal === 'number' && typeof parentVal === 'number') {
                    var delta = childVal - parentVal;
                    if (Math.abs(delta) > 1e-9) {
                        var fitnessDelta = entry.fitness - parent.fitness;
                        mutations.push({
                            childId: entry.id,
                            parentId: parent.id,
                            parameter: key,
                            parentValue: parentVal,
                            childValue: childVal,
                            delta: delta,
                            relativeDelta: parentVal !== 0 ? delta / Math.abs(parentVal) : delta,
                            fitnessDelta: fitnessDelta,
                            beneficial: fitnessDelta > 0,
                            generation: entry.generation
                        });
                    }
                }
            }
        }
    }

    function _findById(id) {
        for (var i = 0; i < protocols.length; i++) {
            if (protocols[i].id === id) return protocols[i];
        }
        return null;
    }

    // ── Selection operators ────────────────────────────────────────

    function _tournamentSelect(pool, tournamentSize) {
        var tSize = tournamentSize || 3;
        var best = null;
        for (var i = 0; i < tSize; i++) {
            var idx = Math.floor(Math.random() * pool.length);
            if (!best || pool[idx].fitness > best.fitness) {
                best = pool[idx];
            }
        }
        return best;
    }

    function _rouletteSelect(pool) {
        var totalFitness = 0;
        for (var i = 0; i < pool.length; i++) totalFitness += Math.max(pool[i].fitness, 0.01);
        var spin = Math.random() * totalFitness;
        var cumulative = 0;
        for (var j = 0; j < pool.length; j++) {
            cumulative += Math.max(pool[j].fitness, 0.01);
            if (cumulative >= spin) return pool[j];
        }
        return pool[pool.length - 1];
    }

    function _rankSelect(pool) {
        // Sort by fitness ascending, assign rank weights
        var sorted = pool.slice().sort(function (a, b) { return a.fitness - b.fitness; });
        var totalRank = (sorted.length * (sorted.length + 1)) / 2;
        var spin = Math.random() * totalRank;
        var cumulative = 0;
        for (var i = 0; i < sorted.length; i++) {
            cumulative += (i + 1);
            if (cumulative >= spin) return sorted[i];
        }
        return sorted[sorted.length - 1];
    }

    function _select(pool, strategy) {
        switch (strategy || selectionStrategy) {
            case 'tournament': return _tournamentSelect(pool);
            case 'roulette':   return _rouletteSelect(pool);
            case 'rank':       return _rankSelect(pool);
            case 'elite':      return pool[0]; // assumes sorted desc
            default:           return _tournamentSelect(pool);
        }
    }

    // ── Crossover ──────────────────────────────────────────────────

    function _crossover(parent1, parent2) {
        var childParams = {};
        var keys = Object.keys(parent1.parameters);
        // Also include keys from parent2 not in parent1
        var keys2 = Object.keys(parent2.parameters);
        for (var k = 0; k < keys2.length; k++) {
            if (keys.indexOf(keys2[k]) === -1) keys.push(keys2[k]);
        }

        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var v1 = parent1.parameters[key];
            var v2 = parent2.parameters[key];

            if (v1 === undefined) { childParams[key] = v2; continue; }
            if (v2 === undefined) { childParams[key] = v1; continue; }

            if (typeof v1 === 'number' && typeof v2 === 'number') {
                // Blend crossover with fitness-weighted interpolation
                var w1 = parent1.fitness / (parent1.fitness + parent2.fitness + 1e-9);
                childParams[key] = v1 * w1 + v2 * (1 - w1);
            } else {
                // Discrete: pick from fitter parent
                childParams[key] = parent1.fitness >= parent2.fitness ? v1 : v2;
            }
        }
        return childParams;
    }

    // ── Mutation ───────────────────────────────────────────────────

    function _mutate(params, rate, strength) {
        var mutated = deepClone(params);
        var keys = Object.keys(mutated);
        var anyMutated = false;

        for (var i = 0; i < keys.length; i++) {
            if (Math.random() > rate) continue;
            var key = keys[i];
            if (typeof mutated[key] !== 'number') continue;

            anyMutated = true;
            var val = mutated[key];
            var perturbation = gaussianRandom() * strength * Math.abs(val || 1);
            val += perturbation;

            // Apply bounds if defined
            if (parameterBounds[key]) {
                val = clamp(val, parameterBounds[key].min, parameterBounds[key].max);
            }
            mutated[key] = val;
        }

        // Ensure at least one mutation if we were supposed to mutate
        if (!anyMutated && keys.length > 0) {
            var rk = keys[Math.floor(Math.random() * keys.length)];
            if (typeof mutated[rk] === 'number') {
                mutated[rk] += gaussianRandom() * strength * Math.abs(mutated[rk] || 1);
                if (parameterBounds[rk]) {
                    mutated[rk] = clamp(mutated[rk], parameterBounds[rk].min, parameterBounds[rk].max);
                }
            }
        }

        return mutated;
    }

    // ── Breed next generation ──────────────────────────────────────

    function breed(config) {
        config = config || {};
        var targetGen = config.generation;
        var popSize = config.populationSize || 10;
        var mRate = config.mutationRate !== undefined ? config.mutationRate : mutationRate;
        var mStrength = config.mutationStrength !== undefined ? config.mutationStrength : mutationStrength;
        var cRate = config.crossoverRate !== undefined ? config.crossoverRate : crossoverRate;
        var strategy = config.selectionStrategy || selectionStrategy;

        // Determine source generation
        var genKeys = Object.keys(generations).map(Number).sort(function (a, b) { return a - b; });
        if (genKeys.length === 0) {
            throw new Error('No protocols ingested — cannot breed');
        }
        var sourceGen = genKeys[genKeys.length - 1];
        if (!targetGen) targetGen = sourceGen + 1;

        var sourceIndices = generations[sourceGen] || [];
        if (sourceIndices.length < MIN_POPULATION) {
            throw new Error('Need at least ' + MIN_POPULATION + ' protocols in generation ' + sourceGen + ' to breed');
        }

        // Build pool sorted by fitness descending
        var pool = [];
        for (var s = 0; s < sourceIndices.length; s++) {
            pool.push(protocols[sourceIndices[s]]);
        }
        pool.sort(function (a, b) { return b.fitness - a.fitness; });

        var offspring = [];
        var eliteCount = Math.max(1, Math.floor(popSize * eliteFraction));

        // Elite carry-over (best survive unchanged)
        for (var e = 0; e < eliteCount && e < pool.length; e++) {
            var eliteChild = {
                id: 'GEN' + targetGen + '-' + String(offspring.length + 1).padStart(3, '0'),
                generation: targetGen,
                parameters: deepClone(pool[e].parameters),
                parentIds: [pool[e].id],
                origin: 'elite',
                predictedFitness: pool[e].fitness
            };
            offspring.push(eliteChild);
        }

        // Fill rest with crossover + mutation
        while (offspring.length < popSize) {
            var child;
            if (Math.random() < cRate && pool.length >= 2) {
                var p1 = _select(pool, strategy);
                var p2 = _select(pool, strategy);
                var attempts = 0;
                while (p2.id === p1.id && attempts < 10) {
                    p2 = _select(pool, strategy);
                    attempts++;
                }
                var childParams = _crossover(p1, p2);
                childParams = _mutate(childParams, mRate, mStrength);
                child = {
                    id: 'GEN' + targetGen + '-' + String(offspring.length + 1).padStart(3, '0'),
                    generation: targetGen,
                    parameters: childParams,
                    parentIds: [p1.id, p2.id],
                    origin: 'crossover+mutation',
                    predictedFitness: (p1.fitness + p2.fitness) / 2
                };
            } else {
                var parent = _select(pool, strategy);
                var mutParams = _mutate(deepClone(parent.parameters), mRate * 2, mStrength * 1.5);
                child = {
                    id: 'GEN' + targetGen + '-' + String(offspring.length + 1).padStart(3, '0'),
                    generation: targetGen,
                    parameters: mutParams,
                    parentIds: [parent.id],
                    origin: 'mutation',
                    predictedFitness: parent.fitness * 0.95
                };
            }
            offspring.push(child);
        }

        return {
            generation: targetGen,
            sourceGeneration: sourceGen,
            populationSize: offspring.length,
            eliteCount: eliteCount,
            strategy: strategy,
            offspring: offspring
        };
    }

    // ── Analysis ───────────────────────────────────────────────────

    function analyze() {
        if (protocols.length === 0) {
            return { status: 'NO_DATA', message: 'No protocols ingested yet' };
        }

        var genKeys = Object.keys(generations).map(Number).sort(function (a, b) { return a - b; });

        // Per-generation stats
        var generationStats = [];
        for (var g = 0; g < genKeys.length; g++) {
            var gen = genKeys[g];
            var indices = generations[gen];
            var fitnesses = [];
            for (var i = 0; i < indices.length; i++) {
                fitnesses.push(protocols[indices[i]].fitness);
            }
            fitnesses.sort(function (a, b) { return a - b; });
            generationStats.push({
                generation: gen,
                count: fitnesses.length,
                best: fitnesses[fitnesses.length - 1],
                worst: fitnesses[0],
                mean: mean(fitnesses),
                stddev: stddev(fitnesses),
                median: fitnesses[Math.floor(fitnesses.length / 2)]
            });
        }

        // Improvement trajectory
        var improvement = [];
        for (var t = 1; t < generationStats.length; t++) {
            improvement.push({
                fromGen: generationStats[t - 1].generation,
                toGen: generationStats[t].generation,
                bestDelta: generationStats[t].best - generationStats[t - 1].best,
                meanDelta: generationStats[t].mean - generationStats[t - 1].mean
            });
        }

        // Convergence check
        var latestStats = generationStats[generationStats.length - 1];
        var converged = latestStats.stddev < CONVERGENCE_THRESHOLD;

        // Beneficial mutations summary
        var beneficialMutations = [];
        var harmfulMutations = [];
        for (var m = 0; m < mutations.length; m++) {
            if (mutations[m].beneficial) {
                beneficialMutations.push(mutations[m]);
            } else {
                harmfulMutations.push(mutations[m]);
            }
        }

        // Parameter importance (which params mutate beneficially most often)
        var paramBenefitCount = {};
        var paramTotalCount = {};
        for (var b = 0; b < mutations.length; b++) {
            var param = mutations[b].parameter;
            if (!paramTotalCount[param]) paramTotalCount[param] = 0;
            if (!paramBenefitCount[param]) paramBenefitCount[param] = 0;
            paramTotalCount[param]++;
            if (mutations[b].beneficial) paramBenefitCount[param]++;
        }

        var paramImportance = [];
        var piKeys = Object.keys(paramTotalCount);
        for (var pi = 0; pi < piKeys.length; pi++) {
            var pk = piKeys[pi];
            paramImportance.push({
                parameter: pk,
                totalMutations: paramTotalCount[pk],
                beneficialMutations: paramBenefitCount[pk],
                benefitRate: paramBenefitCount[pk] / paramTotalCount[pk],
                avgFitnessGain: _avgFitnessGainForParam(pk)
            });
        }
        paramImportance.sort(function (a, b) { return b.benefitRate - a.benefitRate; });

        // Diversity metric (parameter space spread in latest generation)
        var diversity = _computeDiversity(genKeys[genKeys.length - 1]);

        // Best protocol ever
        var bestProtocol = null;
        var bestFitness = -Infinity;
        for (var bp = 0; bp < protocols.length; bp++) {
            if (protocols[bp].fitness > bestFitness) {
                bestFitness = protocols[bp].fitness;
                bestProtocol = protocols[bp];
            }
        }

        return {
            status: converged ? 'CONVERGED' : 'EVOLVING',
            totalProtocols: protocols.length,
            totalGenerations: genKeys.length,
            generationStats: generationStats,
            improvement: improvement,
            converged: converged,
            convergenceMetric: latestStats.stddev,
            diversity: diversity,
            bestProtocol: bestProtocol ? {
                id: bestProtocol.id,
                generation: bestProtocol.generation,
                fitness: bestProtocol.fitness,
                tier: getFitnessTier(bestProtocol.fitness).label,
                parameters: bestProtocol.parameters
            } : null,
            mutations: {
                total: mutations.length,
                beneficial: beneficialMutations.length,
                harmful: harmfulMutations.length,
                benefitRate: mutations.length > 0 ? beneficialMutations.length / mutations.length : 0
            },
            parameterImportance: paramImportance,
            recommendations: _generateRecommendations(generationStats, converged, diversity, paramImportance)
        };
    }

    function _avgFitnessGainForParam(param) {
        var gains = [];
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].parameter === param && mutations[i].beneficial) {
                gains.push(mutations[i].fitnessDelta);
            }
        }
        return gains.length > 0 ? mean(gains) : 0;
    }

    function _computeDiversity(gen) {
        var indices = generations[gen];
        if (!indices || indices.length < 2) return { score: 0, dimensions: {} };

        // Get all parameter keys
        var allKeys = {};
        for (var i = 0; i < indices.length; i++) {
            var keys = Object.keys(protocols[indices[i]].parameters);
            for (var k = 0; k < keys.length; k++) allKeys[keys[k]] = true;
        }

        var dimensions = {};
        var paramKeys = Object.keys(allKeys);
        var diversityScores = [];

        for (var p = 0; p < paramKeys.length; p++) {
            var pk = paramKeys[p];
            var values = [];
            for (var j = 0; j < indices.length; j++) {
                var v = protocols[indices[j]].parameters[pk];
                if (typeof v === 'number') values.push(v);
            }
            if (values.length < 2) continue;
            var cv = mean(values) !== 0 ? stddev(values) / Math.abs(mean(values)) : 0;
            dimensions[pk] = { cv: cv, min: Math.min.apply(null, values), max: Math.max.apply(null, values) };
            diversityScores.push(cv);
        }

        return {
            score: diversityScores.length > 0 ? mean(diversityScores) : 0,
            dimensions: dimensions
        };
    }

    function _generateRecommendations(genStats, converged, diversity, paramImportance) {
        var recs = [];

        if (converged) {
            recs.push({
                type: 'CONVERGENCE_WARNING',
                message: 'Population has converged — increase mutation rate or inject random immigrants to explore new regions',
                priority: 'HIGH'
            });
        }

        if (diversity.score < 0.05) {
            recs.push({
                type: 'LOW_DIVERSITY',
                message: 'Parameter diversity is very low — consider widening mutation strength or using rank selection',
                priority: 'MEDIUM'
            });
        }

        if (genStats.length >= 3) {
            var recent = genStats.slice(-3);
            var improving = recent[2].best > recent[0].best;
            if (!improving) {
                recs.push({
                    type: 'PLATEAU',
                    message: 'Best fitness has not improved in 3 generations — consider changing selection strategy or expanding parameter bounds',
                    priority: 'HIGH'
                });
            }
        }

        // Highlight most important parameters
        if (paramImportance.length > 0 && paramImportance[0].benefitRate > 0.6) {
            recs.push({
                type: 'KEY_PARAMETER',
                message: 'Parameter "' + paramImportance[0].parameter + '" has ' +
                    Math.round(paramImportance[0].benefitRate * 100) + '% beneficial mutation rate — focus exploration here',
                priority: 'MEDIUM'
            });
        }

        return recs;
    }

    // ── Lineage ────────────────────────────────────────────────────

    function getLineage(id) {
        if (!lineage[id]) return null;
        var ancestors = [];
        var queue = [id];
        var visited = Object.create(null);
        visited[id] = true;

        while (queue.length > 0) {
            var current = queue.shift();
            var node = lineage[current];
            if (!node) continue;
            for (var p = 0; p < node.parentIds.length; p++) {
                var pid = node.parentIds[p];
                if (!visited[pid]) {
                    visited[pid] = true;
                    ancestors.push(pid);
                    queue.push(pid);
                }
            }
        }

        return {
            id: id,
            parents: lineage[id].parentIds,
            children: lineage[id].childIds,
            ancestors: ancestors,
            depth: ancestors.length
        };
    }

    // ── Configuration ──────────────────────────────────────────────

    function configure(config) {
        if (config.mutationRate !== undefined) mutationRate = config.mutationRate;
        if (config.mutationStrength !== undefined) mutationStrength = config.mutationStrength;
        if (config.crossoverRate !== undefined) crossoverRate = config.crossoverRate;
        if (config.eliteFraction !== undefined) eliteFraction = config.eliteFraction;
        if (config.selectionStrategy !== undefined) selectionStrategy = config.selectionStrategy;
        if (config.parameterBounds !== undefined) {
            var keys = Object.keys(config.parameterBounds);
            for (var i = 0; i < keys.length; i++) {
                if (_isDangerousKey(keys[i])) continue;
                parameterBounds[keys[i]] = config.parameterBounds[keys[i]];
            }
        }
    }

    // ── Summary / Export ───────────────────────────────────────────

    function getSummary() {
        var genKeys = Object.keys(generations).map(Number).sort(function (a, b) { return a - b; });
        return {
            totalProtocols: protocols.length,
            totalGenerations: genKeys.length,
            generations: genKeys,
            totalMutationsTracked: mutations.length,
            configuration: {
                mutationRate: mutationRate,
                mutationStrength: mutationStrength,
                crossoverRate: crossoverRate,
                eliteFraction: eliteFraction,
                selectionStrategy: selectionStrategy
            }
        };
    }

    function getGeneration(gen) {
        var indices = generations[gen];
        if (!indices) return null;
        var result = [];
        for (var i = 0; i < indices.length; i++) {
            result.push(deepClone(protocols[indices[i]]));
        }
        result.sort(function (a, b) { return b.fitness - a.fitness; });
        return result;
    }

    function reset() {
        protocols = [];
        generations = {};
        lineage = {};
        mutations = [];
    }

    // ── Public API ─────────────────────────────────────────────────

    return {
        ingest: ingest,
        breed: breed,
        analyze: analyze,
        getLineage: getLineage,
        getGeneration: getGeneration,
        getSummary: getSummary,
        configure: configure,
        reset: reset
    };
}

module.exports = { createProtocolEvolution: createProtocolEvolution };
