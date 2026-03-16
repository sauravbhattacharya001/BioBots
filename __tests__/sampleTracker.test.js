'use strict';

var st = require('../docs/shared/sampleTracker');

describe('SampleTracker', function() {
    var tracker;
    beforeEach(function() { tracker = st.createSampleTracker(); });

    describe('addSample', function() {
        it('creates a sample with defaults', function() {
            var s = tracker.addSample({ name: 'Skin Patch A' });
            expect(s.id).toBe(1);
            expect(s.name).toBe('Skin Patch A');
            expect(s.stage).toBe('Queued');
            expect(s.priority).toBe('medium');
            expect(s.material).toBe('Unknown');
        });

        it('sets custom fields', function() {
            var s = tracker.addSample({ name: 'Bone Graft', material: 'Hydroxyapatite', cellType: 'Osteoblast', priority: 'high', assignee: 'Dr. Lee' });
            expect(s.material).toBe('Hydroxyapatite');
            expect(s.cellType).toBe('Osteoblast');
            expect(s.priority).toBe('high');
            expect(s.assignee).toBe('Dr. Lee');
        });

        it('throws on empty name', function() {
            expect(function() { tracker.addSample({}); }).toThrow('Sample name is required');
            expect(function() { tracker.addSample({ name: '  ' }); }).toThrow();
        });

        it('increments ids', function() {
            var a = tracker.addSample({ name: 'A' });
            var b = tracker.addSample({ name: 'B' });
            expect(b.id).toBe(a.id + 1);
        });

        it('initializes timestamps and history', function() {
            var s = tracker.addSample({ name: 'T' });
            expect(s.timestamps.created).toBeDefined();
            expect(s.timestamps.Queued).toBeDefined();
            expect(s.history.length).toBe(1);
            expect(s.history[0].action).toBe('created');
        });
    });

    describe('advanceSample', function() {
        it('advances through stages', function() {
            var s = tracker.addSample({ name: 'X' });
            tracker.advanceSample(s.id);
            expect(s.stage).toBe('Printing');
            tracker.advanceSample(s.id);
            expect(s.stage).toBe('Crosslinking');
        });

        it('throws at final stage', function() {
            var s = tracker.addSample({ name: 'X' });
            for (var i = 0; i < 5; i++) tracker.advanceSample(s.id);
            expect(s.stage).toBe('Complete');
            expect(function() { tracker.advanceSample(s.id); }).toThrow('already at final stage');
        });

        it('throws for unknown id', function() {
            expect(function() { tracker.advanceSample(999); }).toThrow('not found');
        });

        it('records history', function() {
            var s = tracker.addSample({ name: 'X' });
            tracker.advanceSample(s.id);
            expect(s.history.length).toBe(2);
            expect(s.history[1].action).toBe('advanced');
            expect(s.history[1].from).toBe('Queued');
        });
    });

    describe('moveSample', function() {
        it('moves to arbitrary stage', function() {
            var s = tracker.addSample({ name: 'X' });
            tracker.moveSample(s.id, 'Testing');
            expect(s.stage).toBe('Testing');
        });

        it('throws for invalid stage', function() {
            var s = tracker.addSample({ name: 'X' });
            expect(function() { tracker.moveSample(s.id, 'Fake'); }).toThrow('Invalid stage');
        });
    });

    describe('addNote', function() {
        it('adds notes', function() {
            var s = tracker.addSample({ name: 'X' });
            var n = tracker.addNote(s.id, 'Viability looks good');
            expect(n.text).toBe('Viability looks good');
            expect(s.notes.length).toBe(1);
        });

        it('throws on empty note', function() {
            var s = tracker.addSample({ name: 'X' });
            expect(function() { tracker.addNote(s.id, ''); }).toThrow();
        });
    });

    describe('setPriority', function() {
        it('changes priority', function() {
            var s = tracker.addSample({ name: 'X' });
            tracker.setPriority(s.id, 'urgent');
            expect(s.priority).toBe('urgent');
        });

        it('rejects invalid priority', function() {
            var s = tracker.addSample({ name: 'X' });
            expect(function() { tracker.setPriority(s.id, 'critical'); }).toThrow('Invalid priority');
        });
    });

    describe('setAssignee', function() {
        it('sets and clears assignee', function() {
            var s = tracker.addSample({ name: 'X' });
            tracker.setAssignee(s.id, 'Dr. Kim');
            expect(s.assignee).toBe('Dr. Kim');
            tracker.setAssignee(s.id, '');
            expect(s.assignee).toBeNull();
        });
    });

    describe('removeSample', function() {
        it('removes a sample', function() {
            var s = tracker.addSample({ name: 'X' });
            tracker.removeSample(s.id);
            expect(function() { tracker.getSample(s.id); }).toThrow();
        });
    });

    describe('getBoard', function() {
        it('groups by stage and sorts by priority', function() {
            tracker.addSample({ name: 'Low', priority: 'low' });
            tracker.addSample({ name: 'Urgent', priority: 'urgent' });
            tracker.addSample({ name: 'High', priority: 'high' });
            var board = tracker.getBoard();
            expect(board.Queued.length).toBe(3);
            expect(board.Queued[0].name).toBe('Urgent');
            expect(board.Queued[1].name).toBe('High');
            expect(board.Queued[2].name).toBe('Low');
        });
    });

    describe('getStats', function() {
        it('returns statistics', function() {
            tracker.addSample({ name: 'A', material: 'Alginate' });
            tracker.addSample({ name: 'B', material: 'Gelatin' });
            var s = tracker.addSample({ name: 'C', material: 'Alginate' });
            tracker.advanceSample(s.id);
            var stats = tracker.getStats();
            expect(stats.total).toBe(3);
            expect(stats.byStage.Queued).toBe(2);
            expect(stats.byStage.Printing).toBe(1);
            expect(stats.byMaterial.Alginate).toBe(2);
            expect(stats.completionRate).toBe(0);
        });
    });

    describe('search', function() {
        it('searches by name, material, cellType', function() {
            tracker.addSample({ name: 'Skin Patch', material: 'Collagen', cellType: 'Keratinocyte' });
            tracker.addSample({ name: 'Bone Graft', material: 'Hydroxyapatite' });
            expect(tracker.search('skin').length).toBe(1);
            expect(tracker.search('collagen').length).toBe(1);
            expect(tracker.search('keratinocyte').length).toBe(1);
        });

        it('returns all for empty query', function() {
            tracker.addSample({ name: 'A' });
            expect(tracker.search('').length).toBe(1);
        });
    });

    describe('filter', function() {
        it('filters by stage and priority', function() {
            tracker.addSample({ name: 'A', priority: 'high' });
            var b = tracker.addSample({ name: 'B', priority: 'low' });
            tracker.advanceSample(b.id);
            expect(tracker.filter({ stage: 'Printing' }).length).toBe(1);
            expect(tracker.filter({ priority: 'high' }).length).toBe(1);
        });
    });

    describe('getDwellTime', function() {
        it('returns dwell times per stage', function() {
            var s = tracker.addSample({ name: 'X' });
            tracker.advanceSample(s.id);
            var times = tracker.getDwellTime(s.id);
            expect(times.Queued).toBeDefined();
            expect(times.Printing).toBeDefined();
            expect(typeof times.Queued).toBe('number');
        });
    });

    describe('export', function() {
        it('exports JSON', function() {
            tracker.addSample({ name: 'A' });
            var json = JSON.parse(tracker.exportJSON());
            expect(json.samples.length).toBe(1);
            expect(json.stats).toBeDefined();
        });

        it('exports CSV', function() {
            tracker.addSample({ name: 'Test "Quote"', material: 'Alginate' });
            var csv = tracker.exportCSV();
            expect(csv).toContain('ID,Name');
            expect(csv).toContain('Test ""Quote""');
        });
    });

    describe('onEvent', function() {
        it('fires events', function() {
            var events = [];
            tracker.onEvent(function(e, d) { events.push(e); });
            tracker.addSample({ name: 'A' });
            expect(events).toContain('added');
        });
    });

    describe('importSamples', function() {
        it('imports array of samples', function() {
            var count = tracker.importSamples([{ name: 'A' }, { name: 'B' }, {}]);
            expect(count).toBe(2);
            expect(tracker.getStats().total).toBe(2);
        });

        it('throws for non-array', function() {
            expect(function() { tracker.importSamples('bad'); }).toThrow();
        });
    });
});
