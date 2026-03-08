/**
 * Print Queue Manager — Tests
 */
const {
    PRIORITIES, STATUS, estimatePrintTime, createJob, inferResources, PrintQueue
} = require('../Try/scripts/printQueue');

describe('estimatePrintTime', () => {
    test('returns positive time for default params', () => {
        expect(estimatePrintTime({})).toBeGreaterThan(0);
    });

    test('more layers = more time', () => {
        const t10 = estimatePrintTime({ layerNum: 10 });
        const t50 = estimatePrintTime({ layerNum: 50 });
        expect(t50).toBeGreaterThan(t10);
    });

    test('crosslink enabled adds time', () => {
        const without = estimatePrintTime({ layerNum: 20, clEnabled: false });
        const with_ = estimatePrintTime({ layerNum: 20, clEnabled: true, clDuration: 30000 });
        expect(with_).toBeGreaterThan(without);
    });

    test('thinner layers take longer', () => {
        const thick = estimatePrintTime({ layerNum: 20, layerHeight: 0.5 });
        const thin = estimatePrintTime({ layerNum: 20, layerHeight: 0.1 });
        expect(thin).toBeGreaterThan(thick);
    });

    test('handles edge case: zero layers', () => {
        expect(estimatePrintTime({ layerNum: 0 })).toBe(0);
    });
});

describe('inferResources', () => {
    test('includes stage always', () => {
        expect(inferResources({})).toContain('stage');
    });

    test('includes extruder1 when pressure > 0', () => {
        expect(inferResources({ extruder1: 50 })).toContain('extruder1');
    });

    test('includes crosslinker by default', () => {
        expect(inferResources({})).toContain('crosslinker');
    });

    test('excludes crosslinker when disabled', () => {
        expect(inferResources({ clEnabled: false })).not.toContain('crosslinker');
    });

    test('includes wellplate when specified', () => {
        expect(inferResources({ wellplate: 6 })).toContain('wellplate');
    });
});

describe('createJob', () => {
    test('creates job with defaults', () => {
        const job = createJob('j1', 'Test Print', { layerNum: 10 });
        expect(job.id).toBe('j1');
        expect(job.name).toBe('Test Print');
        expect(job.status).toBe(STATUS.QUEUED);
        expect(job.priority).toBe(PRIORITIES.NORMAL);
        expect(job.estimatedMinutes).toBeGreaterThan(0);
        expect(job.createdAt).toBeGreaterThan(0);
    });

    test('throws on missing id', () => {
        expect(() => createJob('', 'x', {})).toThrow();
    });

    test('accepts custom priority', () => {
        const job = createJob('j2', 'Urgent', {}, { priority: PRIORITIES.URGENT });
        expect(job.priority).toBe(PRIORITIES.URGENT);
    });

    test('accepts tags and assignee', () => {
        const job = createJob('j3', 'Tagged', {}, { tags: ['bone', 'scaffold'], assignee: 'Alice' });
        expect(job.tags).toEqual(['bone', 'scaffold']);
        expect(job.assignee).toBe('Alice');
    });
});

describe('PrintQueue', () => {
    let q;
    const mkJob = (id, pri = PRIORITIES.NORMAL) => createJob(id, `Job ${id}`, { layerNum: 10, extruder1: 50 }, { priority: pri });

    beforeEach(() => { q = new PrintQueue(); });

    test('addJob and getJob', () => {
        q.addJob(mkJob('a'));
        expect(q.getJob('a')).toBeTruthy();
        expect(q.getJob('a').name).toBe('Job a');
    });

    test('rejects duplicate ids', () => {
        q.addJob(mkJob('a'));
        expect(() => q.addJob(mkJob('a'))).toThrow(/Duplicate/);
    });

    test('sorts by priority', () => {
        q.addJob(mkJob('low', PRIORITIES.LOW));
        q.addJob(mkJob('urgent', PRIORITIES.URGENT));
        q.addJob(mkJob('normal', PRIORITIES.NORMAL));
        expect(q.jobs[0].id).toBe('urgent');
        expect(q.jobs[2].id).toBe('low');
    });

    test('startNext starts highest priority job', () => {
        q.addJob(mkJob('a', PRIORITIES.LOW));
        q.addJob(mkJob('b', PRIORITIES.URGENT));
        const started = q.startNext();
        expect(started.id).toBe('b');
        expect(started.status).toBe(STATUS.PRINTING);
        expect(started.startedAt).toBeGreaterThan(0);
    });

    test('startNext respects maxConcurrent', () => {
        q.maxConcurrent = 1;
        q.addJob(mkJob('a'));
        q.addJob(mkJob('b'));
        q.startNext();
        expect(q.startNext()).toBeNull(); // conflict on shared resources
    });

    test('completeJob moves to history', () => {
        q.addJob(mkJob('a'));
        q.startNext();
        q.completeJob('a');
        expect(q.jobs.length).toBe(0);
        expect(q.history.length).toBe(1);
        expect(q.history[0].status).toBe(STATUS.COMPLETED);
    });

    test('failJob records reason', () => {
        q.addJob(mkJob('a'));
        q.startNext();
        q.failJob('a', 'Nozzle clog');
        expect(q.history[0].notes).toContain('Nozzle clog');
    });

    test('cancelJob', () => {
        q.addJob(mkJob('a'));
        q.cancelJob('a');
        expect(q.history[0].status).toBe(STATUS.CANCELLED);
    });

    test('removeJob', () => {
        q.addJob(mkJob('a'));
        const removed = q.removeJob('a');
        expect(removed.id).toBe('a');
        expect(q.jobs.length).toBe(0);
    });

    test('cannot remove printing job', () => {
        q.addJob(mkJob('a'));
        q.startNext();
        expect(() => q.removeJob('a')).toThrow(/cancel/);
    });

    test('pauseJob and resumeJob', () => {
        q.addJob(mkJob('a'));
        q.startNext();
        q.pauseJob('a');
        expect(q.getJob('a').status).toBe(STATUS.PAUSED);
        q.resumeJob('a');
        expect(q.getJob('a').status).toBe(STATUS.PRINTING);
    });

    test('setPriority re-sorts queue', () => {
        q.addJob(mkJob('a', PRIORITIES.LOW));
        q.addJob(mkJob('b', PRIORITIES.LOW));
        q.setPriority('b', PRIORITIES.URGENT);
        expect(q.jobs[0].id).toBe('b');
    });

    test('getConflicts detects resource overlap', () => {
        q.maxConcurrent = 3;
        const j1 = mkJob('a');
        const j2 = mkJob('b');
        q.addJob(j1);
        q.addJob(j2);
        q.startNext(); // starts 'a'
        const conflicts = q.getConflicts('b');
        expect(conflicts.length).toBeGreaterThan(0);
        expect(conflicts[0].resources.length).toBeGreaterThan(0);
    });

    test('getStats returns correct counts', () => {
        q.addJob(mkJob('a'));
        q.addJob(mkJob('b'));
        q.addJob(mkJob('c'));
        q.startNext();
        q.completeJob(q.jobs.find(j => j.status === STATUS.PRINTING).id);
        const stats = q.getStats();
        expect(stats.total).toBe(3);
        expect(stats.completed).toBe(1);
        expect(stats.queued).toBe(2);
    });

    test('getTimeline returns started jobs', () => {
        q.addJob(mkJob('a'));
        q.addJob(mkJob('b'));
        q.startNext();
        const tl = q.getTimeline();
        expect(tl.length).toBe(1);
        expect(tl[0].start).toBeGreaterThan(0);
    });

    test('toJSON / fromJSON roundtrip', () => {
        q.addJob(mkJob('a'));
        q.addJob(mkJob('b'));
        q.startNext();
        q.completeJob('a');
        const json = q.toJSON();
        const q2 = PrintQueue.fromJSON(json);
        expect(q2.jobs.length).toBe(1);
        expect(q2.history.length).toBe(1);
    });

    test('no conflict when resources differ', () => {
        q.maxConcurrent = 3;
        const j1 = createJob('a', 'Job A', { extruder1: 50, extruder2: 0, clEnabled: false }, { resources: ['extruder1', 'stage'] });
        const j2 = createJob('b', 'Job B', { extruder1: 0, extruder2: 50, clEnabled: false }, { resources: ['extruder2'] });
        q.addJob(j1);
        q.addJob(j2);
        q.startNext(); // starts a
        const next = q.startNext(); // should start b (no conflict)
        expect(next).not.toBeNull();
        expect(next.id).toBe('b');
    });
});
