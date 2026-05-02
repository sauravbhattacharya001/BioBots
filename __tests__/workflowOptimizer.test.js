'use strict';

var _mod = require('../docs/shared/workflowOptimizer');
var createWorkflowOptimizer = _mod.createWorkflowOptimizer;

describe('WorkflowOptimizer', function () {
    var opt;

    beforeEach(function () {
        opt = createWorkflowOptimizer();
    });

    // ── Workflow Definition ─────────────────────────────────────

    describe('defineWorkflow', function () {
        test('creates a workflow', function () {
            var r = opt.defineWorkflow({ id: 'wf1', name: 'Test Workflow' });
            expect(r.success).toBe(true);
            expect(r.workflowId).toBe('wf1');
        });

        test('rejects missing fields', function () {
            expect(opt.defineWorkflow({}).success).toBe(false);
            expect(opt.defineWorkflow({ id: 'x' }).success).toBe(false);
        });

        test('rejects duplicate workflow', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'A' });
            var r = opt.defineWorkflow({ id: 'wf1', name: 'B' });
            expect(r.success).toBe(false);
            expect(r.error).toContain('already exists');
        });

        test('rejects prototype pollution keys', function () {
            var r = opt.defineWorkflow({ id: '__proto__', name: 'Evil' });
            expect(r.success).toBe(false);
        });
    });

    // ── Task Management ─────────────────────────────────────────

    describe('addTask', function () {
        beforeEach(function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Test' });
        });

        test('adds a task with defaults', function () {
            var r = opt.addTask({ workflowId: 'wf1', id: 't1', name: 'Task 1' });
            expect(r.success).toBe(true);
        });

        test('adds a task with dependencies', function () {
            opt.addTask({ workflowId: 'wf1', id: 't1', name: 'Task 1', durationMin: 30 });
            var r = opt.addTask({ workflowId: 'wf1', id: 't2', name: 'Task 2', dependencies: ['t1'] });
            expect(r.success).toBe(true);
        });

        test('rejects task for unknown workflow', function () {
            var r = opt.addTask({ workflowId: 'nope', id: 't1', name: 'T' });
            expect(r.success).toBe(false);
        });

        test('rejects duplicate task id', function () {
            opt.addTask({ workflowId: 'wf1', id: 't1', name: 'T1' });
            var r = opt.addTask({ workflowId: 'wf1', id: 't1', name: 'T1b' });
            expect(r.success).toBe(false);
        });

        test('rejects missing dependency', function () {
            var r = opt.addTask({ workflowId: 'wf1', id: 't2', name: 'T2', dependencies: ['ghost'] });
            expect(r.success).toBe(false);
            expect(r.error).toContain('ghost');
        });

        test('rejects prototype pollution task id', function () {
            var r = opt.addTask({ workflowId: 'wf1', id: 'constructor', name: 'Evil' });
            expect(r.success).toBe(false);
        });
    });

    // ── Workflow Analysis ───────────────────────────────────────

    describe('analyzeWorkflow', function () {
        test('analyzes a simple linear workflow', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Linear' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 30 });
            opt.addTask({ workflowId: 'wf1', id: 'b', name: 'B', durationMin: 60, dependencies: ['a'] });
            opt.addTask({ workflowId: 'wf1', id: 'c', name: 'C', durationMin: 20, dependencies: ['b'] });

            var r = opt.analyzeWorkflow('wf1');
            expect(r.success).toBe(true);
            expect(r.criticalPath).toEqual(['a', 'b', 'c']);
            expect(r.criticalPathMinutes).toBe(110);
            expect(r.sequentialMinutes).toBe(110);
            expect(r.parallelismRatio).toBe(1);
        });

        test('detects parallel opportunities', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Parallel' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 60 });
            opt.addTask({ workflowId: 'wf1', id: 'b', name: 'B', durationMin: 40 });
            opt.addTask({ workflowId: 'wf1', id: 'c', name: 'C', durationMin: 30, dependencies: ['a', 'b'] });

            var r = opt.analyzeWorkflow('wf1');
            expect(r.success).toBe(true);
            expect(r.criticalPathMinutes).toBe(90); // a(60) + c(30)
            expect(r.sequentialMinutes).toBe(130); // 60+40+30
            expect(r.parallelismRatio).toBeGreaterThan(1);
            expect(r.parallelGroups.length).toBe(2); // [a,b] then [c]
        });

        test('computes slack correctly', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Slack Test' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 60 });
            opt.addTask({ workflowId: 'wf1', id: 'b', name: 'B', durationMin: 20 });
            opt.addTask({ workflowId: 'wf1', id: 'c', name: 'C', durationMin: 30, dependencies: ['a', 'b'] });

            var r = opt.analyzeWorkflow('wf1');
            var bDetail = r.taskDetails.find(function (t) { return t.id === 'b'; });
            expect(bDetail.slack).toBe(40); // b can start 40 min late
            expect(bDetail.onCriticalPath).toBe(false);
        });

        test('detects bottlenecks', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Bottleneck' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 10 });
            opt.addTask({ workflowId: 'wf1', id: 'b', name: 'Long Task', durationMin: 200, dependencies: ['a'] });
            opt.addTask({ workflowId: 'wf1', id: 'c', name: 'C', durationMin: 10, dependencies: ['b'] });

            var r = opt.analyzeWorkflow('wf1');
            expect(r.bottlenecks.length).toBeGreaterThan(0);
            expect(r.bottlenecks[0].taskId).toBe('b');
            expect(r.bottlenecks[0].severity).toBe('critical');
        });

        test('detects resource contentions', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Contention' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 60, resources: ['bioprinter'] });
            opt.addTask({ workflowId: 'wf1', id: 'b', name: 'B', durationMin: 60, resources: ['bioprinter'] });

            var r = opt.analyzeWorkflow('wf1');
            // Both start at 0, only 1 bioprinter available
            expect(r.resourceContentions.length).toBeGreaterThan(0);
            expect(r.resourceContentions[0].resource).toBe('bioprinter');
        });

        test('returns error for unknown workflow', function () {
            expect(opt.analyzeWorkflow('nope').success).toBe(false);
        });

        test('returns error for empty workflow', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Empty' });
            expect(opt.analyzeWorkflow('wf1').success).toBe(false);
        });

        test('computes idle time metrics', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Idle' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 60 });
            opt.addTask({ workflowId: 'wf1', id: 'b', name: 'B', durationMin: 30 });

            var r = opt.analyzeWorkflow('wf1');
            expect(r.idleTime.busyMinutes).toBe(90);
            expect(r.idleTime.efficiency).toBeGreaterThan(0);
        });
    });

    // ── Schedule Optimization ───────────────────────────────────

    describe('optimizeSchedule', function () {
        test('generates optimized schedule for parallel workflow', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Opt' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'Prep', durationMin: 60 });
            opt.addTask({ workflowId: 'wf1', id: 'b', name: 'Mix', durationMin: 30 });
            opt.addTask({ workflowId: 'wf1', id: 'c', name: 'Print', durationMin: 120, dependencies: ['a', 'b'] });

            var r = opt.optimizeSchedule('wf1');
            expect(r.success).toBe(true);
            expect(r.totalMinutes).toBe(180); // 60 + 120
            expect(r.schedule.length).toBe(3);
            // a and b should start at 0
            var aTask = r.schedule.find(function (s) { return s.taskId === 'a'; });
            var bTask = r.schedule.find(function (s) { return s.taskId === 'b'; });
            expect(aTask.start).toBe(0);
            expect(bTask.start).toBe(0);
        });

        test('handles resource contention in scheduling', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Resource' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'Print A', durationMin: 60, resources: ['bioprinter'] });
            opt.addTask({ workflowId: 'wf1', id: 'b', name: 'Print B', durationMin: 60, resources: ['bioprinter'] });

            var r = opt.optimizeSchedule('wf1');
            expect(r.success).toBe(true);
            // bioprinter maxConcurrent=1, so b must wait for a + cleanup + setup
            var bTask = r.schedule.find(function (s) { return s.taskId === 'b'; });
            expect(bTask.start).toBeGreaterThanOrEqual(60);
        });

        test('generates recommendations', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Recs' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 30 });
            opt.addTask({ workflowId: 'wf1', id: 'b', name: 'B', durationMin: 30, dependencies: ['a'] });
            opt.addTask({ workflowId: 'wf1', id: 'c', name: 'C', durationMin: 30, dependencies: ['b'] });

            var r = opt.optimizeSchedule('wf1');
            expect(r.success).toBe(true);
            expect(r.recommendations).toBeDefined();
        });

        test('returns error for unknown workflow', function () {
            expect(opt.optimizeSchedule('nope').success).toBe(false);
        });

        test('accepts custom resource availability', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Custom Resources' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 60, resources: ['bioprinter'] });
            opt.addTask({ workflowId: 'wf1', id: 'b', name: 'B', durationMin: 60, resources: ['bioprinter'] });

            var r = opt.optimizeSchedule('wf1', { resources: { bioprinter: 2 } });
            expect(r.success).toBe(true);
            // With 2 bioprinters, both can start at 0
            var bTask = r.schedule.find(function (s) { return s.taskId === 'b'; });
            expect(bTask.start).toBe(0);
        });

        test('scheduling efficiency metric', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Eff' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 60 });
            opt.addTask({ workflowId: 'wf1', id: 'b', name: 'B', durationMin: 30, dependencies: ['a'] });

            var r = opt.optimizeSchedule('wf1');
            expect(r.schedulingEfficiency).toBe(100); // no resource overhead
        });
    });

    // ── Execution Recording ─────────────────────────────────────

    describe('recordExecution', function () {
        test('records an execution', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Test' });
            var r = opt.recordExecution({
                workflowId: 'wf1',
                totalActualMin: 95,
                success: true
            });
            expect(r.success).toBe(true);
            expect(r.executionCount).toBe(1);
        });

        test('rejects unknown workflow', function () {
            var r = opt.recordExecution({ workflowId: 'nope' });
            expect(r.success).toBe(false);
        });

        test('rejects missing workflowId', function () {
            expect(opt.recordExecution({}).success).toBe(false);
        });
    });

    // ── Throughput Forecasting ───────────────────────────────────

    describe('forecastThroughput', function () {
        test('forecasts with historical data', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Test' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 60 });
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 65 });
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 70 });
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 60 });

            var r = opt.forecastThroughput('wf1', { windowHours: 8 });
            expect(r.success).toBe(true);
            expect(r.forecast.expected).toBeGreaterThan(0);
            expect(r.historicalExecutions).toBe(3);
        });

        test('uses schedule estimate when no history', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Test' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 60 });

            var r = opt.forecastThroughput('wf1');
            expect(r.success).toBe(true);
            expect(r.historicalExecutions).toBe(1); // falls back to schedule estimate
        });

        test('returns error for unknown workflow', function () {
            expect(opt.forecastThroughput('nope').success).toBe(false);
        });
    });

    // ── Insights ────────────────────────────────────────────────

    describe('getInsights', function () {
        test('generates duration trend insight', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Test' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 60 });
            // Old executions: fast
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 60 });
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 62 });
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 58 });
            // Recent: much slower
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 90 });
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 95 });
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 88 });

            var insights = opt.getInsights('wf1');
            var trend = insights.find(function (i) { return i.type === 'duration_increase'; });
            expect(trend).toBeDefined();
            expect(trend.changePercent).toBeGreaterThan(0);
        });

        test('generates failure rate insight', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Test' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 60 });
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 60, success: true });
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 0, success: false });
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 0, success: false });

            var insights = opt.getInsights('wf1');
            var fail = insights.find(function (i) { return i.type === 'high_failure_rate'; });
            expect(fail).toBeDefined();
        });

        test('returns all insights when no filter', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'A' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 60 });
            opt.recordExecution({ workflowId: 'wf1', totalActualMin: 60 });

            var all = opt.getInsights();
            expect(Array.isArray(all)).toBe(true);
        });
    });

    // ── Workflow Comparison ──────────────────────────────────────

    describe('compareWorkflows', function () {
        test('compares two workflows', function () {
            opt.defineWorkflow({ id: 'fast', name: 'Fast' });
            opt.addTask({ workflowId: 'fast', id: 'a', name: 'A', durationMin: 30 });

            opt.defineWorkflow({ id: 'slow', name: 'Slow' });
            opt.addTask({ workflowId: 'slow', id: 'a', name: 'A', durationMin: 120 });

            var r = opt.compareWorkflows('fast', 'slow');
            expect(r.success).toBe(true);
            expect(r.comparison.faster).toBe('fast');
            expect(r.comparison.healthier).toBeDefined();
        });

        test('returns error for unknown workflow', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'A' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 30 });
            expect(opt.compareWorkflows('wf1', 'nope').success).toBe(false);
        });
    });

    // ── Dashboard ───────────────────────────────────────────────

    describe('getDashboard', function () {
        test('returns empty dashboard', function () {
            var d = opt.getDashboard();
            expect(d.workflowCount).toBe(0);
            expect(d.healthScore).toBe(50);
        });

        test('returns dashboard with workflows', function () {
            opt.defineWorkflow({ id: 'wf1', name: 'Test' });
            opt.addTask({ workflowId: 'wf1', id: 'a', name: 'A', durationMin: 30 });
            opt.addTask({ workflowId: 'wf1', id: 'b', name: 'B', durationMin: 30 });

            var d = opt.getDashboard();
            expect(d.workflowCount).toBe(1);
            expect(d.healthScore).toBeGreaterThan(0);
            expect(d.healthLabel).toBeDefined();
            expect(d.workflows.length).toBe(1);
        });

        test('includes recent insights', function () {
            var d = opt.getDashboard();
            expect(Array.isArray(d.recentInsights)).toBe(true);
        });
    });

    // ── List Workflows ──────────────────────────────────────────

    describe('listWorkflows', function () {
        test('lists all workflows', function () {
            opt.defineWorkflow({ id: 'a', name: 'A' });
            opt.defineWorkflow({ id: 'b', name: 'B' });

            var list = opt.listWorkflows();
            expect(list.length).toBe(2);
            expect(list[0].id).toBeDefined();
            expect(list[0].name).toBeDefined();
        });
    });

    // ── Complex Bioprinting Workflow ────────────────────────────

    describe('realistic bioprinting workflow', function () {
        test('full bioprinting pipeline analysis', function () {
            opt.defineWorkflow({ id: 'bioprint', name: 'Standard Bioprint Pipeline' });
            opt.addTask({ workflowId: 'bioprint', id: 'cellPrep', name: 'Cell Preparation',
                durationMin: 60, resources: ['laminarFlowHood'] });
            opt.addTask({ workflowId: 'bioprint', id: 'bioinkMix', name: 'Bioink Mixing',
                durationMin: 30, resources: ['mixer'] });
            opt.addTask({ workflowId: 'bioprint', id: 'qualCheck', name: 'Quality Check',
                durationMin: 15, resources: ['microscope'], dependencies: ['cellPrep'] });
            opt.addTask({ workflowId: 'bioprint', id: 'printing', name: 'Bioprinting',
                durationMin: 120, resources: ['bioprinter'], dependencies: ['qualCheck', 'bioinkMix'] });
            opt.addTask({ workflowId: 'bioprint', id: 'crosslink', name: 'Crosslinking',
                durationMin: 30, dependencies: ['printing'] });
            opt.addTask({ workflowId: 'bioprint', id: 'incubate', name: 'Incubation',
                durationMin: 240, resources: ['incubator'], dependencies: ['crosslink'] });

            var analysis = opt.analyzeWorkflow('bioprint');
            expect(analysis.success).toBe(true);
            expect(analysis.taskCount).toBe(6);
            expect(analysis.criticalPath).toContain('printing');
            expect(analysis.criticalPath).toContain('incubate');
            expect(analysis.parallelGroups.length).toBeGreaterThan(1);

            var schedule = opt.optimizeSchedule('bioprint');
            expect(schedule.success).toBe(true);
            expect(schedule.totalMinutes).toBeGreaterThanOrEqual(analysis.criticalPathMinutes);

            var dashboard = opt.getDashboard();
            expect(dashboard.healthScore).toBeGreaterThan(0);
        });
    });
});
