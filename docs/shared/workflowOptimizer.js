'use strict';

var round = require('./validation').round;
var _isDangerousKey = require('./sanitize').isDangerousKey;

/**
 * Lab Workflow Optimizer Engine
 *
 * Autonomous workflow analysis and optimization for bioprinting labs.
 * Models experiment workflows as directed acyclic graphs (DAGs),
 * detects bottlenecks, identifies parallelizable tasks, computes
 * critical paths, and generates optimized schedules with resource
 * awareness.
 *
 * Agentic capabilities:
 * - Autonomous bottleneck detection via critical path analysis
 * - Parallel task identification with dependency-safe scheduling
 * - Resource contention detection and resolution suggestions
 * - Workflow health scoring 0-100 with improvement recommendations
 * - Throughput forecasting based on historical execution data
 * - Idle time minimization through task reordering
 * - Autonomous insights generation from workflow patterns
 *
 * @example
 *   var opt = createWorkflowOptimizer();
 *   opt.defineWorkflow({ id: 'bioprint-01', name: 'Standard Bioprint' });
 *   opt.addTask({ workflowId: 'bioprint-01', id: 'prep', name: 'Cell Preparation',
 *     durationMin: 60, resources: ['laminarFlowHood'] });
 *   opt.addTask({ workflowId: 'bioprint-01', id: 'mix', name: 'Bioink Mixing',
 *     durationMin: 30, resources: ['mixer'], dependencies: [] });
 *   opt.addTask({ workflowId: 'bioprint-01', id: 'print', name: 'Bioprinting',
 *     durationMin: 120, resources: ['bioprinter'], dependencies: ['prep', 'mix'] });
 *   var analysis = opt.analyzeWorkflow('bioprint-01');
 *   // analysis.criticalPath => ['prep', 'print']
 *   // analysis.parallelGroups => [['prep', 'mix'], ['print']]
 *   var schedule = opt.optimizeSchedule('bioprint-01');
 *   // schedule.totalMinutes => 180 (prep+print on critical path)
 *   var dashboard = opt.getDashboard();
 *   // dashboard.healthScore => 72
 */

// ── Constants ──────────────────────────────────────────────────────

var RESOURCE_TYPES = {
    bioprinter:       { maxConcurrent: 1, setupMin: 15, cleanupMin: 30 },
    laminarFlowHood:  { maxConcurrent: 2, setupMin: 5,  cleanupMin: 20 },
    incubator:        { maxConcurrent: 8, setupMin: 2,  cleanupMin: 5  },
    centrifuge:       { maxConcurrent: 2, setupMin: 3,  cleanupMin: 10 },
    microscope:       { maxConcurrent: 3, setupMin: 2,  cleanupMin: 5  },
    mixer:            { maxConcurrent: 2, setupMin: 5,  cleanupMin: 15 },
    autoclave:        { maxConcurrent: 1, setupMin: 5,  cleanupMin: 10 },
    pcrMachine:       { maxConcurrent: 4, setupMin: 3,  cleanupMin: 5  },
    flowCytometer:    { maxConcurrent: 1, setupMin: 10, cleanupMin: 20 },
    cryoStorage:      { maxConcurrent: 1, setupMin: 5,  cleanupMin: 5  }
};

var HEALTH_THRESHOLDS = [
    { min: 90, label: 'excellent', color: '#22c55e' },
    { min: 75, label: 'good',     color: '#84cc16' },
    { min: 60, label: 'fair',     color: '#eab308' },
    { min: 40, label: 'poor',     color: '#f97316' },
    { min: 0,  label: 'critical', color: '#ef4444' }
];

var BOTTLENECK_SEVERITY = {
    critical: { threshold: 0.8, color: '#ef4444' },
    high:     { threshold: 0.6, color: '#f97316' },
    moderate: { threshold: 0.4, color: '#eab308' },
    low:      { threshold: 0.2, color: '#84cc16' },
    none:     { threshold: 0.0, color: '#22c55e' }
};

// ── Helpers ────────────────────────────────────────────────────────

function _now() { return Date.now(); }

function _mean(arr) {
    if (!arr || arr.length === 0) return 0;
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
}

function _stddev(arr) {
    if (!arr || arr.length < 2) return 0;
    var m = _mean(arr);
    var ss = 0;
    for (var i = 0; i < arr.length; i++) ss += (arr[i] - m) * (arr[i] - m);
    return Math.sqrt(ss / (arr.length - 1));
}

function _classifyHealth(score) {
    for (var i = 0; i < HEALTH_THRESHOLDS.length; i++) {
        if (score >= HEALTH_THRESHOLDS[i].min) return HEALTH_THRESHOLDS[i];
    }
    return HEALTH_THRESHOLDS[HEALTH_THRESHOLDS.length - 1];
}

function _classifyBottleneck(ratio) {
    if (ratio >= BOTTLENECK_SEVERITY.critical.threshold) return 'critical';
    if (ratio >= BOTTLENECK_SEVERITY.high.threshold) return 'high';
    if (ratio >= BOTTLENECK_SEVERITY.moderate.threshold) return 'moderate';
    if (ratio >= BOTTLENECK_SEVERITY.low.threshold) return 'low';
    return 'none';
}

// ── Factory ────────────────────────────────────────────────────────

function createWorkflowOptimizer() {
    var workflows = Object.create(null);  // id → workflow definition
    var executions = [];                  // historical execution records
    var insights = [];

    // ── Workflow Definition ─────────────────────────────────────

    function defineWorkflow(opts) {
        if (!opts || !opts.id || !opts.name) {
            return { success: false, error: 'id and name are required' };
        }
        if (_isDangerousKey(opts.id)) {
            return { success: false, error: 'Invalid workflow id' };
        }
        if (workflows[opts.id]) {
            return { success: false, error: 'Workflow ' + opts.id + ' already exists' };
        }
        workflows[opts.id] = {
            id: opts.id,
            name: opts.name,
            description: opts.description || '',
            tasks: Object.create(null),
            taskOrder: [],
            createdAt: _now()
        };
        return { success: true, workflowId: opts.id };
    }

    function addTask(opts) {
        if (!opts || !opts.workflowId || !opts.id || !opts.name) {
            return { success: false, error: 'workflowId, id, and name are required' };
        }
        if (_isDangerousKey(opts.id)) {
            return { success: false, error: 'Invalid task id' };
        }
        var wf = workflows[opts.workflowId];
        if (!wf) {
            return { success: false, error: 'Workflow ' + opts.workflowId + ' not found' };
        }
        if (wf.tasks[opts.id]) {
            return { success: false, error: 'Task ' + opts.id + ' already exists in workflow' };
        }
        var duration = typeof opts.durationMin === 'number' && opts.durationMin > 0
            ? opts.durationMin : 30;
        var deps = Array.isArray(opts.dependencies) ? opts.dependencies : [];
        // Validate dependencies exist
        for (var i = 0; i < deps.length; i++) {
            if (!wf.tasks[deps[i]]) {
                return { success: false, error: 'Dependency ' + deps[i] + ' not found in workflow' };
            }
        }
        var resources = Array.isArray(opts.resources) ? opts.resources : [];
        wf.tasks[opts.id] = {
            id: opts.id,
            name: opts.name,
            durationMin: duration,
            dependencies: deps.slice(),
            resources: resources.slice(),
            priority: opts.priority || 'normal',
            canParallelize: opts.canParallelize !== false
        };
        wf.taskOrder.push(opts.id);
        return { success: true, taskId: opts.id };
    }

    // ── Topological Sort ────────────────────────────────────────

    function _topoSort(wf) {
        var tasks = wf.tasks;
        var order = wf.taskOrder;
        var inDeg = Object.create(null);
        var adj = Object.create(null);
        var i, j, tid;

        for (i = 0; i < order.length; i++) {
            tid = order[i];
            inDeg[tid] = 0;
            adj[tid] = [];
        }
        for (i = 0; i < order.length; i++) {
            tid = order[i];
            var deps = tasks[tid].dependencies;
            for (j = 0; j < deps.length; j++) {
                adj[deps[j]].push(tid);
                inDeg[tid]++;
            }
        }
        var queue = [];
        for (i = 0; i < order.length; i++) {
            if (inDeg[order[i]] === 0) queue.push(order[i]);
        }
        var sorted = [];
        while (queue.length > 0) {
            var node = queue.shift();
            sorted.push(node);
            var neighbors = adj[node];
            for (j = 0; j < neighbors.length; j++) {
                inDeg[neighbors[j]]--;
                if (inDeg[neighbors[j]] === 0) queue.push(neighbors[j]);
            }
        }
        if (sorted.length !== order.length) {
            return { success: false, error: 'Cycle detected in workflow dependencies' };
        }
        return { success: true, order: sorted };
    }

    // ── Critical Path Analysis ──────────────────────────────────

    function _computeCriticalPath(wf) {
        var sortResult = _topoSort(wf);
        if (!sortResult.success) return sortResult;

        var order = sortResult.order;
        var tasks = wf.tasks;
        var earliest = Object.create(null); // earliest start
        var i, j, tid;

        // Forward pass: compute earliest start times
        for (i = 0; i < order.length; i++) {
            tid = order[i];
            earliest[tid] = 0;
            var deps = tasks[tid].dependencies;
            for (j = 0; j < deps.length; j++) {
                var depEnd = earliest[deps[j]] + tasks[deps[j]].durationMin;
                if (depEnd > earliest[tid]) earliest[tid] = depEnd;
            }
        }

        // Find total duration
        var totalMin = 0;
        for (i = 0; i < order.length; i++) {
            tid = order[i];
            var endTime = earliest[tid] + tasks[tid].durationMin;
            if (endTime > totalMin) totalMin = endTime;
        }

        // Backward pass: compute latest start times
        var latest = Object.create(null);
        for (i = order.length - 1; i >= 0; i--) {
            tid = order[i];
            latest[tid] = totalMin - tasks[tid].durationMin;
        }
        // Recompute latest with successors
        for (i = order.length - 1; i >= 0; i--) {
            tid = order[i];
            // Find successors
            for (j = 0; j < order.length; j++) {
                var otherDeps = tasks[order[j]].dependencies;
                for (var k = 0; k < otherDeps.length; k++) {
                    if (otherDeps[k] === tid) {
                        var latestForThis = latest[order[j]] - tasks[tid].durationMin;
                        if (latestForThis < latest[tid]) latest[tid] = latestForThis;
                    }
                }
            }
        }

        // Slack and critical path
        var slack = Object.create(null);
        var criticalPath = [];
        for (i = 0; i < order.length; i++) {
            tid = order[i];
            slack[tid] = round(latest[tid] - earliest[tid], 2);
            if (slack[tid] === 0) criticalPath.push(tid);
        }

        return {
            success: true,
            criticalPath: criticalPath,
            earliest: earliest,
            latest: latest,
            slack: slack,
            totalMinutes: totalMin
        };
    }

    // ── Parallel Group Detection ────────────────────────────────

    function _findParallelGroups(wf, earliest) {
        var tasks = wf.tasks;
        var order = wf.taskOrder;
        var groups = Object.create(null); // startTime → [taskIds]
        var i, tid;

        for (i = 0; i < order.length; i++) {
            tid = order[i];
            var start = earliest[tid];
            if (!groups[start]) groups[start] = [];
            groups[start].push(tid);
        }

        var times = Object.keys(groups).sort(function (a, b) { return +a - +b; });
        var result = [];
        for (i = 0; i < times.length; i++) {
            result.push(groups[times[i]].sort());
        }
        return result;
    }

    // ── Bottleneck Detection ────────────────────────────────────

    function _detectBottlenecks(wf, cpResult) {
        var tasks = wf.tasks;
        var bottlenecks = [];
        var totalMin = cpResult.totalMinutes;
        if (totalMin === 0) return bottlenecks;

        var order = wf.taskOrder;
        for (var i = 0; i < order.length; i++) {
            var tid = order[i];
            var task = tasks[tid];
            var ratio = task.durationMin / totalMin;
            var severity = _classifyBottleneck(ratio);

            if (severity !== 'none') {
                var suggestions = [];
                if (task.durationMin > 60) {
                    suggestions.push('Consider splitting "' + task.name + '" into smaller parallel sub-tasks');
                }
                if (task.resources.length > 1) {
                    suggestions.push('Reduce resource requirements to avoid contention');
                }
                if (cpResult.slack[tid] === 0) {
                    suggestions.push('This task is on the critical path — any delay impacts total workflow time');
                }
                bottlenecks.push({
                    taskId: tid,
                    taskName: task.name,
                    durationMin: task.durationMin,
                    ratio: round(ratio, 3),
                    severity: severity,
                    onCriticalPath: cpResult.slack[tid] === 0,
                    suggestions: suggestions
                });
            }
        }
        bottlenecks.sort(function (a, b) { return b.ratio - a.ratio; });
        return bottlenecks;
    }

    // ── Resource Contention Analysis ────────────────────────────

    function _analyzeResourceContention(wf, earliest) {
        var tasks = wf.tasks;
        var order = wf.taskOrder;
        var resourceTimelines = Object.create(null); // resource → [{start, end, taskId}]
        var i, j, tid;

        for (i = 0; i < order.length; i++) {
            tid = order[i];
            var task = tasks[tid];
            var start = earliest[tid];
            var end = start + task.durationMin;
            for (j = 0; j < task.resources.length; j++) {
                var res = task.resources[j];
                if (!resourceTimelines[res]) resourceTimelines[res] = [];
                resourceTimelines[res].push({ start: start, end: end, taskId: tid });
            }
        }

        var contentions = [];
        var resNames = Object.keys(resourceTimelines);
        for (i = 0; i < resNames.length; i++) {
            var resName = resNames[i];
            var timeline = resourceTimelines[resName];
            var maxConcurrent = (RESOURCE_TYPES[resName] || { maxConcurrent: 1 }).maxConcurrent;

            // Check for overlapping usage
            timeline.sort(function (a, b) { return a.start - b.start; });
            for (j = 0; j < timeline.length; j++) {
                var concurrent = 0;
                var overlapping = [];
                for (var k = 0; k < timeline.length; k++) {
                    if (timeline[k].start < timeline[j].end && timeline[k].end > timeline[j].start) {
                        concurrent++;
                        overlapping.push(timeline[k].taskId);
                    }
                }
                if (concurrent > maxConcurrent) {
                    contentions.push({
                        resource: resName,
                        maxConcurrent: maxConcurrent,
                        actualConcurrent: concurrent,
                        overlappingTasks: overlapping,
                        severity: concurrent > maxConcurrent * 2 ? 'critical' : 'high',
                        suggestion: 'Stagger tasks or add another ' + resName + ' unit'
                    });
                    break; // one contention per resource
                }
            }
        }
        return contentions;
    }

    // ── Idle Time Analysis ──────────────────────────────────────

    function _computeIdleTime(wf, earliest, totalMinutes) {
        var tasks = wf.tasks;
        var order = wf.taskOrder;
        var busyMinutes = 0;
        var totalCapacity = totalMinutes * order.length;

        for (var i = 0; i < order.length; i++) {
            busyMinutes += tasks[order[i]].durationMin;
        }

        var idleMinutes = totalCapacity > 0 ? totalCapacity - busyMinutes : 0;
        var efficiency = totalCapacity > 0 ? round((busyMinutes / totalCapacity) * 100, 1) : 0;

        return {
            busyMinutes: busyMinutes,
            idleMinutes: idleMinutes,
            totalCapacityMinutes: totalCapacity,
            efficiency: efficiency
        };
    }

    // ── Workflow Analysis (main) ────────────────────────────────

    function analyzeWorkflow(workflowId) {
        var wf = workflows[workflowId];
        if (!wf) {
            return { success: false, error: 'Workflow ' + workflowId + ' not found' };
        }
        if (wf.taskOrder.length === 0) {
            return { success: false, error: 'Workflow has no tasks' };
        }

        var cpResult = _computeCriticalPath(wf);
        if (!cpResult.success) return cpResult;

        var parallelGroups = _findParallelGroups(wf, cpResult.earliest);
        var bottlenecks = _detectBottlenecks(wf, cpResult);
        var contentions = _analyzeResourceContention(wf, cpResult.earliest);
        var idleTime = _computeIdleTime(wf, cpResult.earliest, cpResult.totalMinutes);

        // Compute parallelism ratio
        var totalSequentialMin = 0;
        for (var i = 0; i < wf.taskOrder.length; i++) {
            totalSequentialMin += wf.tasks[wf.taskOrder[i]].durationMin;
        }
        var parallelismRatio = cpResult.totalMinutes > 0
            ? round(totalSequentialMin / cpResult.totalMinutes, 2) : 1;

        return {
            success: true,
            workflowId: workflowId,
            workflowName: wf.name,
            taskCount: wf.taskOrder.length,
            criticalPath: cpResult.criticalPath,
            criticalPathMinutes: cpResult.totalMinutes,
            sequentialMinutes: totalSequentialMin,
            parallelismRatio: parallelismRatio,
            parallelGroups: parallelGroups,
            bottlenecks: bottlenecks,
            resourceContentions: contentions,
            idleTime: idleTime,
            taskDetails: _buildTaskDetails(wf, cpResult)
        };
    }

    function _buildTaskDetails(wf, cpResult) {
        var details = [];
        for (var i = 0; i < wf.taskOrder.length; i++) {
            var tid = wf.taskOrder[i];
            var task = wf.tasks[tid];
            details.push({
                id: tid,
                name: task.name,
                durationMin: task.durationMin,
                dependencies: task.dependencies.slice(),
                resources: task.resources.slice(),
                earliestStart: cpResult.earliest[tid],
                latestStart: cpResult.latest[tid],
                slack: cpResult.slack[tid],
                onCriticalPath: cpResult.slack[tid] === 0
            });
        }
        return details;
    }

    // ── Schedule Optimization ───────────────────────────────────

    function optimizeSchedule(workflowId, opts) {
        var wf = workflows[workflowId];
        if (!wf) {
            return { success: false, error: 'Workflow ' + workflowId + ' not found' };
        }
        if (wf.taskOrder.length === 0) {
            return { success: false, error: 'Workflow has no tasks' };
        }

        opts = opts || {};
        var availableResources = opts.resources || Object.create(null);

        var cpResult = _computeCriticalPath(wf);
        if (!cpResult.success) return cpResult;

        var sortResult = _topoSort(wf);
        var order = sortResult.order;
        var tasks = wf.tasks;

        // Greedy list scheduling: assign tasks to earliest feasible time
        var scheduled = Object.create(null);    // taskId → { start, end }
        var resourceBusy = Object.create(null); // resource → [endTimes]
        var i, j, tid;

        for (i = 0; i < order.length; i++) {
            tid = order[i];
            var task = tasks[tid];
            var earliestStart = 0;

            // Respect dependencies
            for (j = 0; j < task.dependencies.length; j++) {
                var depEnd = scheduled[task.dependencies[j]].end;
                if (depEnd > earliestStart) earliestStart = depEnd;
            }

            // Respect resource availability
            for (j = 0; j < task.resources.length; j++) {
                var res = task.resources[j];
                var maxC = availableResources[res]
                    || (RESOURCE_TYPES[res] || { maxConcurrent: 1 }).maxConcurrent;

                if (!resourceBusy[res]) resourceBusy[res] = [];

                // If at capacity, wait for earliest resource to free up
                if (resourceBusy[res].length >= maxC) {
                    resourceBusy[res].sort(function (a, b) { return a - b; });
                    var freedAt = resourceBusy[res][0]; // earliest end
                    // Add setup/cleanup buffer
                    var resType = RESOURCE_TYPES[res] || {};
                    var buffer = (resType.cleanupMin || 0) + (resType.setupMin || 0);
                    var availableAt = freedAt + buffer;
                    if (availableAt > earliestStart) earliestStart = availableAt;
                }
            }

            scheduled[tid] = {
                taskId: tid,
                taskName: task.name,
                start: earliestStart,
                end: earliestStart + task.durationMin,
                durationMin: task.durationMin,
                resources: task.resources.slice()
            };

            // Update resource busy times
            for (j = 0; j < task.resources.length; j++) {
                var r = task.resources[j];
                if (!resourceBusy[r]) resourceBusy[r] = [];
                var mC = availableResources[r]
                    || (RESOURCE_TYPES[r] || { maxConcurrent: 1 }).maxConcurrent;
                if (resourceBusy[r].length >= mC) {
                    // Replace the earliest freed
                    resourceBusy[r].sort(function (a, b) { return a - b; });
                    resourceBusy[r][0] = scheduled[tid].end;
                } else {
                    resourceBusy[r].push(scheduled[tid].end);
                }
            }
        }

        // Build schedule
        var schedule = [];
        var totalMin = 0;
        for (i = 0; i < order.length; i++) {
            schedule.push(scheduled[order[i]]);
            if (scheduled[order[i]].end > totalMin) totalMin = scheduled[order[i]].end;
        }

        // Compare with critical path (ideal)
        var cpMin = cpResult.totalMinutes;
        var overhead = totalMin > cpMin ? totalMin - cpMin : 0;
        var efficiency = totalMin > 0 ? round((cpMin / totalMin) * 100, 1) : 100;

        return {
            success: true,
            workflowId: workflowId,
            schedule: schedule,
            totalMinutes: totalMin,
            criticalPathMinutes: cpMin,
            resourceOverheadMinutes: overhead,
            schedulingEfficiency: efficiency,
            recommendations: _generateScheduleRecommendations(wf, schedule, totalMin, cpMin, overhead)
        };
    }

    function _generateScheduleRecommendations(wf, schedule, totalMin, cpMin, overhead) {
        var recs = [];
        if (overhead > 15) {
            recs.push({
                type: 'resource_contention',
                message: 'Resource contention adds ' + overhead + ' minutes. Consider adding equipment or staggering start times.',
                impact: 'high'
            });
        }
        // Find longest tasks
        var sorted = schedule.slice().sort(function (a, b) { return b.durationMin - a.durationMin; });
        if (sorted.length > 0 && sorted[0].durationMin > totalMin * 0.4) {
            recs.push({
                type: 'task_splitting',
                message: '"' + sorted[0].taskName + '" takes ' + sorted[0].durationMin + ' min (' +
                    round((sorted[0].durationMin / totalMin) * 100, 0) + '% of total). Split into parallel sub-tasks to reduce overall time.',
                impact: 'high'
            });
        }
        // Check parallelism
        var maxParallel = 0;
        for (var i = 0; i < schedule.length; i++) {
            var count = 0;
            for (var j = 0; j < schedule.length; j++) {
                if (schedule[j].start < schedule[i].end && schedule[j].end > schedule[i].start) count++;
            }
            if (count > maxParallel) maxParallel = count;
        }
        if (maxParallel === 1 && wf.taskOrder.length > 2) {
            recs.push({
                type: 'parallelism',
                message: 'Workflow is fully sequential. Identify independent tasks that can run in parallel.',
                impact: 'medium'
            });
        }
        return recs;
    }

    // ── Execution Recording ─────────────────────────────────────

    function recordExecution(opts) {
        if (!opts || !opts.workflowId) {
            return { success: false, error: 'workflowId is required' };
        }
        if (!workflows[opts.workflowId]) {
            return { success: false, error: 'Workflow ' + opts.workflowId + ' not found' };
        }
        var taskTimings = opts.taskTimings || Object.create(null); // taskId → { actualMin }
        var exec = {
            workflowId: opts.workflowId,
            timestamp: _now(),
            totalActualMin: typeof opts.totalActualMin === 'number' ? opts.totalActualMin : 0,
            taskTimings: taskTimings,
            success: opts.success !== false,
            notes: opts.notes || ''
        };
        executions.push(exec);

        // Generate insights from patterns
        _generateInsights(opts.workflowId);

        return { success: true, executionCount: executions.length };
    }

    // ── Throughput Forecasting ───────────────────────────────────

    function forecastThroughput(workflowId, opts) {
        var wf = workflows[workflowId];
        if (!wf) {
            return { success: false, error: 'Workflow ' + workflowId + ' not found' };
        }
        opts = opts || {};
        var windowHours = typeof opts.windowHours === 'number' && opts.windowHours > 0
            ? opts.windowHours : 8;

        // Gather historical durations
        var durations = [];
        for (var i = 0; i < executions.length; i++) {
            if (executions[i].workflowId === workflowId && executions[i].totalActualMin > 0) {
                durations.push(executions[i].totalActualMin);
            }
        }

        // If no history, use optimized schedule estimate
        if (durations.length === 0) {
            var sched = optimizeSchedule(workflowId);
            if (!sched.success) return sched;
            durations = [sched.totalMinutes];
        }

        var avgMin = _mean(durations);
        var stdMin = _stddev(durations);
        var windowMin = windowHours * 60;
        var runsOptimistic = avgMin - stdMin > 0 ? Math.floor(windowMin / (avgMin - stdMin)) : Math.floor(windowMin / avgMin);
        var runsExpected = Math.floor(windowMin / avgMin);
        var runsPessimistic = Math.floor(windowMin / (avgMin + stdMin));
        if (runsPessimistic < 0) runsPessimistic = 0;

        return {
            success: true,
            workflowId: workflowId,
            windowHours: windowHours,
            historicalExecutions: durations.length,
            averageMinutes: round(avgMin, 1),
            stddevMinutes: round(stdMin, 1),
            forecast: {
                optimistic: runsOptimistic,
                expected: runsExpected,
                pessimistic: runsPessimistic
            }
        };
    }

    // ── Insight Generation ──────────────────────────────────────

    function _generateInsights(workflowId) {
        var wfExecs = [];
        for (var i = 0; i < executions.length; i++) {
            if (executions[i].workflowId === workflowId) wfExecs.push(executions[i]);
        }
        if (wfExecs.length < 3) return;

        // Trend detection on total duration
        var durations = [];
        for (var j = 0; j < wfExecs.length; j++) {
            if (wfExecs[j].totalActualMin > 0) durations.push(wfExecs[j].totalActualMin);
        }
        if (durations.length >= 3) {
            var recent = durations.slice(-3);
            var older = durations.slice(0, -3);
            if (older.length > 0) {
                var recentAvg = _mean(recent);
                var olderAvg = _mean(older);
                var change = ((recentAvg - olderAvg) / olderAvg) * 100;
                if (Math.abs(change) > 10) {
                    insights.push({
                        workflowId: workflowId,
                        type: change > 0 ? 'duration_increase' : 'duration_decrease',
                        message: 'Workflow "' + workflowId + '" duration ' +
                            (change > 0 ? 'increased' : 'decreased') +
                            ' by ' + round(Math.abs(change), 1) + '% in recent executions.',
                        changePercent: round(change, 1),
                        timestamp: _now()
                    });
                }
            }
        }

        // Failure rate
        var failures = 0;
        for (var k = 0; k < wfExecs.length; k++) {
            if (!wfExecs[k].success) failures++;
        }
        var failRate = failures / wfExecs.length;
        if (failRate > 0.3) {
            insights.push({
                workflowId: workflowId,
                type: 'high_failure_rate',
                message: 'Workflow "' + workflowId + '" has a ' + round(failRate * 100, 0) +
                    '% failure rate. Investigate common failure points.',
                failureRate: round(failRate, 3),
                timestamp: _now()
            });
        }
    }

    // ── Health Score ────────────────────────────────────────────

    function _computeHealthScore(workflowId) {
        var wf = workflows[workflowId];
        if (!wf || wf.taskOrder.length === 0) return 50;

        var analysis = analyzeWorkflow(workflowId);
        if (!analysis.success) return 50;

        var score = 100;

        // Penalize low parallelism
        if (analysis.parallelismRatio < 1.5 && analysis.taskCount > 2) {
            score -= 15;
        }

        // Penalize bottlenecks
        var criticalBN = 0;
        for (var i = 0; i < analysis.bottlenecks.length; i++) {
            if (analysis.bottlenecks[i].severity === 'critical') criticalBN++;
            else if (analysis.bottlenecks[i].severity === 'high') score -= 5;
        }
        score -= criticalBN * 10;

        // Penalize resource contentions
        score -= analysis.resourceContentions.length * 8;

        // Penalize low efficiency
        if (analysis.idleTime.efficiency < 50) score -= 10;

        // Reward high parallelism
        if (analysis.parallelismRatio > 2) score += 5;

        // Clamp
        if (score < 0) score = 0;
        if (score > 100) score = 100;

        return round(score, 0);
    }

    // ── Dashboard ───────────────────────────────────────────────

    function getDashboard() {
        var wfIds = Object.keys(workflows);
        var workflowSummaries = [];
        var totalScore = 0;

        for (var i = 0; i < wfIds.length; i++) {
            var wfId = wfIds[i];
            var wf = workflows[wfId];
            var score = _computeHealthScore(wfId);
            totalScore += score;
            var cls = _classifyHealth(score);

            workflowSummaries.push({
                id: wfId,
                name: wf.name,
                taskCount: wf.taskOrder.length,
                healthScore: score,
                healthLabel: cls.label,
                healthColor: cls.color
            });
        }

        var overallScore = wfIds.length > 0 ? round(totalScore / wfIds.length, 0) : 50;
        var overallCls = _classifyHealth(overallScore);

        return {
            workflowCount: wfIds.length,
            healthScore: overallScore,
            healthLabel: overallCls.label,
            healthColor: overallCls.color,
            workflows: workflowSummaries,
            executionCount: executions.length,
            recentInsights: insights.slice(-10),
            generatedAt: new Date().toISOString()
        };
    }

    // ── Compare Workflows ───────────────────────────────────────

    function compareWorkflows(workflowIdA, workflowIdB) {
        var a = analyzeWorkflow(workflowIdA);
        var b = analyzeWorkflow(workflowIdB);
        if (!a.success) return { success: false, error: 'Workflow A: ' + a.error };
        if (!b.success) return { success: false, error: 'Workflow B: ' + b.error };

        var scoreA = _computeHealthScore(workflowIdA);
        var scoreB = _computeHealthScore(workflowIdB);

        return {
            success: true,
            comparison: {
                a: {
                    id: workflowIdA, name: a.workflowName,
                    taskCount: a.taskCount, totalMinutes: a.criticalPathMinutes,
                    parallelismRatio: a.parallelismRatio, healthScore: scoreA,
                    bottleneckCount: a.bottlenecks.length
                },
                b: {
                    id: workflowIdB, name: b.workflowName,
                    taskCount: b.taskCount, totalMinutes: b.criticalPathMinutes,
                    parallelismRatio: b.parallelismRatio, healthScore: scoreB,
                    bottleneckCount: b.bottlenecks.length
                },
                faster: a.criticalPathMinutes <= b.criticalPathMinutes ? workflowIdA : workflowIdB,
                moreParallel: a.parallelismRatio >= b.parallelismRatio ? workflowIdA : workflowIdB,
                healthier: scoreA >= scoreB ? workflowIdA : workflowIdB
            }
        };
    }

    // ── Get Insights ────────────────────────────────────────────

    function getInsights(workflowId) {
        if (workflowId) {
            var filtered = [];
            for (var i = 0; i < insights.length; i++) {
                if (insights[i].workflowId === workflowId) filtered.push(insights[i]);
            }
            return filtered;
        }
        return insights.slice();
    }

    // ── List Workflows ──────────────────────────────────────────

    function listWorkflows() {
        var result = [];
        var ids = Object.keys(workflows);
        for (var i = 0; i < ids.length; i++) {
            var wf = workflows[ids[i]];
            result.push({
                id: wf.id,
                name: wf.name,
                taskCount: wf.taskOrder.length
            });
        }
        return result;
    }

    // ── Public API ──────────────────────────────────────────────

    return {
        defineWorkflow: defineWorkflow,
        addTask: addTask,
        analyzeWorkflow: analyzeWorkflow,
        optimizeSchedule: optimizeSchedule,
        recordExecution: recordExecution,
        forecastThroughput: forecastThroughput,
        compareWorkflows: compareWorkflows,
        getDashboard: getDashboard,
        getInsights: getInsights,
        listWorkflows: listWorkflows
    };
}

module.exports = { createWorkflowOptimizer: createWorkflowOptimizer };
