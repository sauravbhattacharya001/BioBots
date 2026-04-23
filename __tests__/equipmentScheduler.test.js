'use strict';

const { createLabEquipmentScheduler } = require('../docs/shared/equipmentScheduler');

// Fixed timestamps for deterministic tests
const BASE = new Date('2026-04-20T08:00:00Z').getTime();
const HOUR = 3600000;
const DAY = 86400000;

function makeScheduler() {
    const s = createLabEquipmentScheduler();
    s.registerEquipment({ id: 'bp1', name: 'BioBot-1', type: 'bioprinter', location: 'Lab A' });
    s.registerEquipment({ id: 'cent1', name: 'Centrifuge-1', type: 'centrifuge', location: 'Lab B' });
    return s;
}

// ── Registration ────────────────────────────────────────────────

describe('registerEquipment', () => {
    test('registers valid equipment', () => {
        const s = createLabEquipmentScheduler();
        const r = s.registerEquipment({ id: 'bp1', name: 'BioBot-1', type: 'bioprinter' });
        expect(r.success).toBe(true);
        expect(r.equipment.id).toBe('bp1');
        expect(r.equipment.type).toBe('bioprinter');
    });

    test('rejects missing fields', () => {
        const s = createLabEquipmentScheduler();
        expect(s.registerEquipment({}).success).toBe(false);
        expect(s.registerEquipment({ id: 'x' }).success).toBe(false);
        expect(s.registerEquipment(null).success).toBe(false);
    });

    test('rejects unknown equipment type', () => {
        const s = createLabEquipmentScheduler();
        const r = s.registerEquipment({ id: 'x', name: 'X', type: 'teleporter' });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/Unknown type/);
    });

    test('rejects duplicate id', () => {
        const s = createLabEquipmentScheduler();
        s.registerEquipment({ id: 'bp1', name: 'BioBot-1', type: 'bioprinter' });
        const r = s.registerEquipment({ id: 'bp1', name: 'BioBot-2', type: 'bioprinter' });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/already registered/);
    });

    test('listEquipment returns registered items', () => {
        const s = makeScheduler();
        const list = s.listEquipment();
        expect(list).toHaveLength(2);
        expect(list.map(e => e.id).sort()).toEqual(['bp1', 'cent1']);
    });
});

// ── Booking ─────────────────────────────────────────────────────

describe('book', () => {
    test('books a valid slot', () => {
        const s = makeScheduler();
        const r = s.book({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 2 * HOUR).toISOString(),
            user: 'Alice',
            project: 'Cartilage'
        });
        expect(r.success).toBe(true);
        expect(r.booking.user).toBe('Alice');
        expect(r.booking.durationHours).toBe(2);
        expect(r.booking.priority).toBe('normal');
    });

    test('rejects missing fields', () => {
        const s = makeScheduler();
        expect(s.book({}).success).toBe(false);
        expect(s.book(null).success).toBe(false);
    });

    test('rejects invalid time range', () => {
        const s = makeScheduler();
        const r = s.book({
            equipmentId: 'bp1',
            start: new Date(BASE + HOUR).toISOString(),
            end: new Date(BASE).toISOString(),  // end before start
            user: 'Alice'
        });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/Invalid time range/);
    });

    test('rejects booking on unknown equipment', () => {
        const s = makeScheduler();
        const r = s.book({
            equipmentId: 'nonexistent',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + HOUR).toISOString(),
            user: 'Alice'
        });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/not found/);
    });

    test('detects overlapping bookings', () => {
        const s = makeScheduler();
        s.book({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 2 * HOUR).toISOString(),
            user: 'Alice'
        });
        // Overlapping booking (includes buffer time for bioprinter: 30 min)
        const r = s.book({
            equipmentId: 'bp1',
            start: new Date(BASE + 2 * HOUR).toISOString(), // starts right when Alice ends — but within 30min buffer
            end: new Date(BASE + 4 * HOUR).toISOString(),
            user: 'Bob'
        });
        expect(r.success).toBe(false);
        expect(r.conflicts.length).toBeGreaterThan(0);
        expect(r.suggestedSlots).toBeDefined();
    });

    test('allows non-overlapping bookings beyond buffer', () => {
        const s = makeScheduler();
        s.book({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 2 * HOUR).toISOString(),
            user: 'Alice'
        });
        // Book well after the 30-min cleaning buffer
        const r = s.book({
            equipmentId: 'bp1',
            start: new Date(BASE + 3 * HOUR).toISOString(),
            end: new Date(BASE + 5 * HOUR).toISOString(),
            user: 'Bob'
        });
        expect(r.success).toBe(true);
    });

    test('enforces daily usage limit', () => {
        const s = makeScheduler();
        // Bioprinter max is 16h/day — book 15h first
        s.book({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 15 * HOUR).toISOString(),
            user: 'Alice'
        });
        // Try to add 2 more hours (would exceed 16h)
        const r = s.book({
            equipmentId: 'bp1',
            start: new Date(BASE + 16 * HOUR).toISOString(),
            end: new Date(BASE + 18 * HOUR).toISOString(),
            user: 'Bob'
        });
        expect(r.success).toBe(false);
        expect(r.error).toMatch(/daily limit/i);
    });

    test('books with priority levels', () => {
        const s = makeScheduler();
        const r = s.book({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + HOUR).toISOString(),
            user: 'Alice',
            priority: 'critical'
        });
        expect(r.success).toBe(true);
        expect(r.booking.priority).toBe('critical');
    });
});

// ── Cancel Booking ──────────────────────────────────────────────

describe('cancelBooking', () => {
    test('cancels an existing booking', () => {
        const s = makeScheduler();
        const b = s.book({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 2 * HOUR).toISOString(),
            user: 'Alice'
        });
        const r = s.cancelBooking(b.booking.id);
        expect(r.success).toBe(true);
        expect(r.booking.cancelled).toBe(true);
    });

    test('cancelled slots become available', () => {
        const s = makeScheduler();
        const b = s.book({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 2 * HOUR).toISOString(),
            user: 'Alice'
        });
        s.cancelBooking(b.booking.id);
        // Should now be able to book the same slot
        const r = s.book({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 2 * HOUR).toISOString(),
            user: 'Bob'
        });
        expect(r.success).toBe(true);
    });

    test('returns error for nonexistent booking', () => {
        const s = makeScheduler();
        expect(s.cancelBooking(9999).success).toBe(false);
    });
});

// ── Maintenance ─────────────────────────────────────────────────

describe('scheduleMaintenance', () => {
    test('schedules maintenance and reports affected bookings', () => {
        const s = makeScheduler();
        s.book({
            equipmentId: 'bp1',
            start: new Date(BASE + 2 * HOUR).toISOString(),
            end: new Date(BASE + 4 * HOUR).toISOString(),
            user: 'Alice'
        });
        const r = s.scheduleMaintenance({
            equipmentId: 'bp1',
            start: new Date(BASE + HOUR).toISOString(),
            end: new Date(BASE + 3 * HOUR).toISOString(),
            reason: 'Nozzle replacement'
        });
        expect(r.success).toBe(true);
        expect(r.affectedBookings).toHaveLength(1);
        expect(r.maintenanceWindow.reason).toBe('Nozzle replacement');
    });

    test('blocks bookings during maintenance windows', () => {
        const s = makeScheduler();
        s.scheduleMaintenance({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 4 * HOUR).toISOString(),
            reason: 'Calibration'
        });
        const r = s.book({
            equipmentId: 'bp1',
            start: new Date(BASE + HOUR).toISOString(),
            end: new Date(BASE + 2 * HOUR).toISOString(),
            user: 'Bob'
        });
        expect(r.success).toBe(false);
        expect(r.conflicts.some(c => c.type === 'maintenance')).toBe(true);
    });

    test('rejects missing fields', () => {
        const s = makeScheduler();
        expect(s.scheduleMaintenance({}).success).toBe(false);
    });
});

// ── Utilization ─────────────────────────────────────────────────

describe('getUtilization', () => {
    test('computes utilization for a period', () => {
        const s = makeScheduler();
        // Book 8h out of 24h → ~33%
        s.book({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 8 * HOUR).toISOString(),
            user: 'Alice',
            project: 'Scaffold'
        });
        const r = s.getUtilization({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + DAY).toISOString()
        });
        expect(r.utilizationPercent).toBeCloseTo(33.3, 0);
        expect(r.usedHours).toBe(8);
        expect(r.totalHours).toBe(24);
        expect(r.topUsers[0].user).toBe('Alice');
        expect(r.topProjects[0].project).toBe('Scaffold');
    });

    test('returns 0% for empty schedule', () => {
        const s = makeScheduler();
        const r = s.getUtilization({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + DAY).toISOString()
        });
        expect(r.utilizationPercent).toBe(0);
        expect(r.bookingCount).toBe(0);
    });

    test('generates recommendations for high utilization', () => {
        const s = makeScheduler();
        // Centrifuge max 20h/day — book 15h first
        s.book({
            equipmentId: 'cent1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 15 * HOUR).toISOString(),
            user: 'Alice'
        });
        // Check a 16-hour window
        const r = s.getUtilization({
            equipmentId: 'cent1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 16 * HOUR).toISOString()
        });
        expect(r.utilizationPercent).toBeGreaterThan(90);
        expect(r.recommendations.length).toBeGreaterThan(0);
        expect(r.recommendations[0]).toMatch(/capacity/i);
    });

    test('errors on missing equipmentId', () => {
        const s = makeScheduler();
        expect(s.getUtilization({}).error).toBeDefined();
    });
});

// ── Suggest Slots ───────────────────────────────────────────────

describe('suggestSlots', () => {
    test('suggests available slots', () => {
        const s = makeScheduler();
        const slots = s.suggestSlots({
            equipmentId: 'bp1',
            durationMinutes: 60,
            nearTime: new Date(BASE).toISOString(),
            count: 3
        });
        expect(slots.length).toBeGreaterThan(0);
        expect(slots.length).toBeLessThanOrEqual(3);
        slots.forEach(slot => {
            expect(slot.start).toBeDefined();
            expect(slot.end).toBeDefined();
            expect(typeof slot.score).toBe('number');
        });
    });

    test('avoids booked slots', () => {
        const s = makeScheduler();
        s.book({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 4 * HOUR).toISOString(),
            user: 'Alice'
        });
        const slots = s.suggestSlots({
            equipmentId: 'bp1',
            durationMinutes: 60,
            nearTime: new Date(BASE).toISOString(),
            count: 3
        });
        // None of the suggested slots should overlap with Alice's booking + buffer
        const bookedEnd = BASE + 4 * HOUR + 30 * 60000; // +30min buffer
        slots.forEach(slot => {
            const slotStart = new Date(slot.start).getTime();
            expect(slotStart).toBeGreaterThanOrEqual(bookedEnd);
        });
    });

    test('errors on missing fields', () => {
        const s = makeScheduler();
        expect(s.suggestSlots({}).error).toBeDefined();
    });
});

// ── Fleet Status ────────────────────────────────────────────────

describe('getFleetStatus', () => {
    test('returns status for all equipment', () => {
        const s = makeScheduler();
        const fleet = s.getFleetStatus(
            new Date(BASE).toISOString(),
            new Date(BASE + DAY).toISOString()
        );
        expect(fleet.totalEquipment).toBe(2);
        expect(fleet.fleet).toHaveLength(2);
        fleet.fleet.forEach(e => {
            expect(e.utilization).toBeDefined();
            expect(['available', 'in_use', 'overloaded']).toContain(e.status);
        });
    });

    test('reports overloaded equipment', () => {
        const s = makeScheduler();
        // Centrifuge: 20h max, book 19h
        s.book({
            equipmentId: 'cent1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 19 * HOUR).toISOString(),
            user: 'Alice'
        });
        const fleet = s.getFleetStatus(
            new Date(BASE).toISOString(),
            new Date(BASE + 20 * HOUR).toISOString()
        );
        const cent = fleet.fleet.find(e => e.id === 'cent1');
        expect(cent.utilization).toBeGreaterThan(90);
        expect(cent.status).toBe('overloaded');
    });
});

// ── Schedule View ───────────────────────────────────────────────

describe('getSchedule', () => {
    test('returns bookings and maintenance for equipment', () => {
        const s = makeScheduler();
        s.book({
            equipmentId: 'bp1',
            start: new Date(BASE).toISOString(),
            end: new Date(BASE + 2 * HOUR).toISOString(),
            user: 'Alice'
        });
        s.scheduleMaintenance({
            equipmentId: 'bp1',
            start: new Date(BASE + 6 * HOUR).toISOString(),
            end: new Date(BASE + 8 * HOUR).toISOString(),
            reason: 'Cleaning'
        });
        const sched = s.getSchedule('bp1');
        expect(sched.bookings).toHaveLength(1);
        expect(sched.maintenanceWindows).toHaveLength(1);
        expect(sched.equipment.name).toBe('BioBot-1');
    });

    test('errors on unknown equipment', () => {
        const s = makeScheduler();
        expect(s.getSchedule('nope').error).toBeDefined();
    });
});

// ── Alerts ──────────────────────────────────────────────────────

describe('getAlerts', () => {
    test('returns empty when no alerts', () => {
        const s = makeScheduler();
        expect(s.getAlerts()).toEqual([]);
    });
});
