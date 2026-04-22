/**
 * BioBots Print Queue Manager
 *
 * Job scheduling, prioritization, time estimation, resource conflict detection,
 * and status tracking for bioprint runs.
 */

const _stripDangerousKeys = require('../../docs/shared/sanitize').stripDangerousKeys;

// ── Priority Levels ──
const PRIORITIES = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const PRIORITY_LABELS = ['Urgent', 'High', 'Normal', 'Low'];
const PRIORITY_COLORS = ['#f87171', '#fb923c', '#38bdf8', '#94a3b8'];

// ── Job Statuses ──
const STATUS = { QUEUED: 'queued', PRINTING: 'printing', PAUSED: 'paused', COMPLETED: 'completed', FAILED: 'failed', CANCELLED: 'cancelled' };
const STATUS_LABELS = { queued: 'Queued', printing: 'Printing', paused: 'Paused', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' };
const STATUS_COLORS = { queued: '#94a3b8', printing: '#38bdf8', paused: '#fbbf24', completed: '#4ade80', failed: '#f87171', cancelled: '#64748b' };

// ── Resource Types ──
const RESOURCES = ['extruder1', 'extruder2', 'wellplate', 'crosslinker', 'stage'];

/**
 * Estimate print time in minutes based on parameters.
 * Formula: base_time_per_layer × layerNum × pressure_factor × crosslink_factor
 */
function estimatePrintTime(params) {
    const layers = params.layerNum != null ? params.layerNum : 10;
    const layerHeight = params.layerHeight || 0.3;
    const pressure1 = params.extruder1 || 50;
    const pressure2 = params.extruder2 || 0;
    const clEnabled = params.clEnabled !== false;
    const clDuration = params.clDuration || 10000;

    // Base: ~2 min/layer, adjusted by layer height (thinner = slower)
    const basePerLayer = 2.0 * (0.3 / Math.max(layerHeight, 0.05));

    // Pressure factor: higher pressure = slightly faster extrusion
    const avgPressure = pressure2 > 0 ? (pressure1 + pressure2) / 2 : pressure1;
    const pressureFactor = 1.0 - (avgPressure - 50) * 0.002; // ±20% around 50 psi

    // Crosslink adds time per layer
    const clMinPerLayer = clEnabled ? (clDuration / 60000) : 0;

    const totalMin = layers * (basePerLayer * Math.max(pressureFactor, 0.5) + clMinPerLayer);
    return Math.round(totalMin * 10) / 10;
}

/**
 * Create a new print job.
 */
function createJob(id, name, params, options = {}) {
    if (!id || !name) throw new Error('Job requires id and name');
    const now = Date.now();
    return {
        id,
        name,
        params: { ...params },
        priority: options.priority ?? PRIORITIES.NORMAL,
        status: STATUS.QUEUED,
        resources: options.resources || inferResources(params),
        estimatedMinutes: estimatePrintTime(params || {}),
        createdAt: now,
        startedAt: null,
        completedAt: null,
        notes: options.notes || '',
        assignee: options.assignee || '',
        tags: options.tags || [],
    };
}

/**
 * Infer required resources from print parameters.
 */
function inferResources(params) {
    const res = ['stage'];
    if (!params) return res;
    if (params.extruder1 > 0) res.push('extruder1');
    if (params.extruder2 > 0) res.push('extruder2');
    if (params.clEnabled !== false) res.push('crosslinker');
    if (params.wellplate) res.push('wellplate');
    return res;
}

/**
 * Print Queue class -- manages a queue of bioprint jobs.
 */
class PrintQueue {
    constructor() {
        this.jobs = [];
        this.history = [];
        this.maxConcurrent = 1;
        /** @private O(1) job lookup by id — maps id → job object */
        this._idIndex = new Map();
    }

    /** Add a job to the queue. */
    addJob(job) {
        if (this._idIndex.has(job.id)) {
            throw new Error(`Duplicate job id: ${job.id}`);
        }
        const copy = { ...job };
        this.jobs.push(copy);
        this._idIndex.set(copy.id, copy);
        this._sortQueue();
        return this;
    }

    /** Remove a queued job. */
    removeJob(id) {
        const idx = this.jobs.findIndex(j => j.id === id);
        if (idx === -1) throw new Error(`Job not found: ${id}`);
        if (this.jobs[idx].status === STATUS.PRINTING) {
            throw new Error('Cannot remove a printing job; cancel it first');
        }
        const removed = this.jobs.splice(idx, 1)[0];
        this._idIndex.delete(id);
        return removed;
    }

    /** Get a job by id (from queue or history). O(1) via index. */
    getJob(id) {
        return this._idIndex.get(id) || null;
    }

    /** Update job priority and re-sort. */
    setPriority(id, priority) {
        const job = this._idIndex.get(id);
        if (!job || this.history.indexOf(job) !== -1) throw new Error(`Job not found in queue: ${id}`);
        if (job.status === STATUS.PRINTING) throw new Error('Cannot re-prioritize a printing job');
        job.priority = priority;
        this._sortQueue();
        return job;
    }

    /** Start the next eligible job. */
    startNext() {
        // Single pass to count active and collect resource holders
        const resourceHolders = [];
        let activeCount = 0;
        for (const j of this.jobs) {
            if (j.status === STATUS.PRINTING) { activeCount++; resourceHolders.push(j); }
            else if (j.status === STATUS.PAUSED) { resourceHolders.push(j); }
        }
        if (activeCount >= this.maxConcurrent) return null;

        const next = this.jobs.find(j => j.status === STATUS.QUEUED && !this._hasConflict(j, resourceHolders));
        if (!next) return null;

        next.status = STATUS.PRINTING;
        next.startedAt = Date.now();
        return next;
    }

    /** Mark a job as completed. */
    completeJob(id) {
        const job = this._idIndex.get(id);
        if (!job || this.history.indexOf(job) !== -1) throw new Error(`Job not found: ${id}`);
        job.status = STATUS.COMPLETED;
        job.completedAt = Date.now();
        this._moveToHistory(id);
        return job;
    }

    /** Mark a job as failed. */
    failJob(id, reason) {
        const job = this._idIndex.get(id);
        if (!job || this.history.indexOf(job) !== -1) throw new Error(`Job not found: ${id}`);
        job.status = STATUS.FAILED;
        job.completedAt = Date.now();
        job.notes = reason ? `${job.notes} [FAIL] ${reason}`.trim() : job.notes;
        this._moveToHistory(id);
        return job;
    }

    /** Cancel a job. */
    cancelJob(id) {
        const job = this._idIndex.get(id);
        if (!job || this.history.indexOf(job) !== -1) throw new Error(`Job not found: ${id}`);
        job.status = STATUS.CANCELLED;
        job.completedAt = Date.now();
        this._moveToHistory(id);
        return job;
    }

    /** Pause a printing job. */
    pauseJob(id) {
        const job = this._idIndex.get(id);
        if (!job || job.status !== STATUS.PRINTING) throw new Error('Can only pause a printing job');
        job.status = STATUS.PAUSED;
        return job;
    }

    /** Resume a paused job. */
    resumeJob(id) {
        const job = this._idIndex.get(id);
        if (!job || job.status !== STATUS.PAUSED) throw new Error('Can only resume a paused job');
        job.status = STATUS.PRINTING;
        return job;
    }

    /** Detect resource conflicts between a job and active jobs. */
    _hasConflict(job, activeJobs) {
        for (const active of activeJobs) {
            const shared = job.resources.filter(r => active.resources.includes(r));
            if (shared.length > 0) return true;
        }
        return false;
    }

    /** Get all resource conflicts for a job against currently active/paused jobs. */
    getConflicts(id) {
        const job = this.getJob(id);
        if (!job) return [];
        const active = this.jobs.filter(j => j.status === STATUS.PRINTING || j.status === STATUS.PAUSED);
        const conflicts = [];
        for (const a of active) {
            const shared = job.resources.filter(r => a.resources.includes(r));
            if (shared.length > 0) {
                conflicts.push({ jobId: a.id, jobName: a.name, resources: shared });
            }
        }
        return conflicts;
    }

    /** Get queue statistics. Single pass over jobs + history. */
    getStats() {
        const byStatus = { queued: 0, printing: 0, completed: 0, failed: 0, cancelled: 0, paused: 0 };
        let totalEstimated = 0;
        let durationSum = 0;
        let completedCount = 0;
        let earliestStart = Infinity;

        // Single pass over jobs
        for (const j of this.jobs) {
            byStatus[j.status] = (byStatus[j.status] || 0) + 1;
            if (j.status === STATUS.QUEUED) totalEstimated += j.estimatedMinutes;
        }

        // Single pass over history
        for (const j of this.history) {
            byStatus[j.status] = (byStatus[j.status] || 0) + 1;
            if (j.status === STATUS.COMPLETED && j.startedAt && j.completedAt) {
                durationSum += j.completedAt - j.startedAt;
                completedCount++;
                if (j.startedAt < earliestStart) earliestStart = j.startedAt;
            }
        }

        const total = this.jobs.length + this.history.length;
        const avgDuration = completedCount > 0 ? durationSum / completedCount / 60000 : 0;

        return {
            total,
            queued: byStatus.queued,
            printing: byStatus.printing,
            completed: byStatus.completed,
            failed: byStatus.failed,
            cancelled: byStatus.cancelled,
            paused: byStatus.paused,
            avgDurationMin: Math.round(avgDuration * 10) / 10,
            estimatedRemainingMin: Math.round(totalEstimated * 10) / 10,
            throughputPerHour: completedCount > 0
                ? Math.round(completedCount / ((Date.now() - earliestStart) / 3600000) * 10) / 10
                : 0,
        };
    }

    /** Get timeline data for Gantt-like visualization. */
    getTimeline() {
        const all = [...this.jobs, ...this.history];
        return all
            .filter(j => j.startedAt)
            .map(j => ({
                id: j.id,
                name: j.name,
                start: j.startedAt,
                end: j.completedAt || (j.startedAt + j.estimatedMinutes * 60000),
                status: j.status,
                priority: j.priority,
            }))
            .sort((a, b) => a.start - b.start);
    }

    /** Sort queue: priority first, then creation time. */
    _sortQueue() {
        this.jobs.sort((a, b) => {
            if (a.status === STATUS.PRINTING && b.status !== STATUS.PRINTING) return -1;
            if (b.status === STATUS.PRINTING && a.status !== STATUS.PRINTING) return 1;
            if (a.status === STATUS.PAUSED && b.status !== STATUS.PAUSED) return -1;
            if (b.status === STATUS.PAUSED && a.status !== STATUS.PAUSED) return 1;
            if (a.priority !== b.priority) return a.priority - b.priority;
            return a.createdAt - b.createdAt;
        });
    }

    /** Move a job from active queue to history. */
    _moveToHistory(id) {
        const idx = this.jobs.findIndex(j => j.id === id);
        if (idx !== -1) {
            this.history.push(this.jobs.splice(idx, 1)[0]);
        }
    }

    /** Export queue state as JSON. */
    toJSON() {
        return { jobs: this.jobs, history: this.history, maxConcurrent: this.maxConcurrent };
    }

    /** Import queue state from JSON. */
    static fromJSON(data) {
        const q = new PrintQueue();
        // Sanitize imported data to prevent prototype pollution
        const safe = _stripDangerousKeys(data || {});
        q.jobs = Array.isArray(safe.jobs) ? safe.jobs : [];
        q.history = Array.isArray(safe.history) ? safe.history : [];
        q.maxConcurrent = typeof safe.maxConcurrent === 'number' ? safe.maxConcurrent : 1;
        // Rebuild id index from imported data
        for (const j of q.jobs) q._idIndex.set(j.id, j);
        for (const j of q.history) q._idIndex.set(j.id, j);
        return q;
    }
}

// ── Exports ──
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PRIORITIES, PRIORITY_LABELS, PRIORITY_COLORS, STATUS, STATUS_LABELS, STATUS_COLORS, RESOURCES, estimatePrintTime, createJob, inferResources, PrintQueue };
}
