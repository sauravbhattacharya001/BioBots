'use strict';

/**
 * Lab Equipment Scheduler
 *
 * Autonomous scheduling for shared bioprinting lab equipment.
 * Detects booking conflicts, suggests optimal time slots based on
 * utilization patterns, tracks equipment availability, and proactively
 * alerts when equipment is overbooked or underutilized.
 *
 * Agentic features:
 * - Proactive conflict detection and resolution suggestions
 * - Smart slot recommendation based on historical utilization
 * - Equipment health scoring based on usage intensity
 * - Automatic buffer time insertion between high-contamination-risk tasks
 * - Utilization analytics with optimization recommendations
 */

var EQUIPMENT_TYPES = {
    bioprinter: { cleaningMinutes: 30, maxDailyHours: 16, contamRisk: 'high' },
    centrifuge: { cleaningMinutes: 15, maxDailyHours: 20, contamRisk: 'low' },
    incubator: { cleaningMinutes: 20, maxDailyHours: 24, contamRisk: 'medium' },
    microscope: { cleaningMinutes: 10, maxDailyHours: 18, contamRisk: 'low' },
    laminarFlowHood: { cleaningMinutes: 20, maxDailyHours: 20, contamRisk: 'high' },
    autoclave: { cleaningMinutes: 0, maxDailyHours: 16, contamRisk: 'low' },
    spectrophotometer: { cleaningMinutes: 5, maxDailyHours: 20, contamRisk: 'low' },
    flowCytometer: { cleaningMinutes: 30, maxDailyHours: 14, contamRisk: 'medium' },
    pcrMachine: { cleaningMinutes: 10, maxDailyHours: 22, contamRisk: 'low' },
    cryoStorage: { cleaningMinutes: 15, maxDailyHours: 24, contamRisk: 'medium' }
};

var PRIORITY_LEVELS = { critical: 4, high: 3, normal: 2, low: 1 };

// ── Prototype Pollution Guard (CWE-1321) ────────────────────
var _isDangerousKey = require('./sanitize').isDangerousKey;

function createLabEquipmentScheduler() {
    var equipment = Object.create(null);    // id → { name, type, location, bookings[] }
    var bookings = [];     // all bookings across equipment
    var nextBookingId = 1;
    var alerts = [];

    // ── Equipment Registration ──────────────────────────────────

    function registerEquipment(opts) {
        if (!opts || !opts.id || !opts.name || !opts.type) {
            return { success: false, error: 'id, name, and type are required' };
        }
        if (_isDangerousKey(opts.id)) {
            return { success: false, error: 'Invalid equipment id' };
        }
        if (!EQUIPMENT_TYPES[opts.type]) {
            return { success: false, error: 'Unknown type: ' + opts.type + '. Valid: ' + Object.keys(EQUIPMENT_TYPES).join(', ') };
        }
        if (equipment[opts.id]) {
            return { success: false, error: 'Equipment ' + opts.id + ' already registered' };
        }
        equipment[opts.id] = {
            id: opts.id,
            name: opts.name,
            type: opts.type,
            location: opts.location || 'unspecified',
            bookings: [],
            maintenanceWindows: [],
            registeredAt: Date.now()
        };
        return { success: true, equipment: equipment[opts.id] };
    }

    // ── Booking ─────────────────────────────────────────────────

    function book(opts) {
        if (!opts || !opts.equipmentId || !opts.start || !opts.end || !opts.user) {
            return { success: false, error: 'equipmentId, start, end, and user are required' };
        }
        var eq = equipment[opts.equipmentId];
        if (!eq) return { success: false, error: 'Equipment not found: ' + opts.equipmentId };

        var start = new Date(opts.start).getTime();
        var end = new Date(opts.end).getTime();
        if (isNaN(start) || isNaN(end) || end <= start) {
            return { success: false, error: 'Invalid time range' };
        }

        var eqConfig = EQUIPMENT_TYPES[eq.type];
        var durationHours = (end - start) / 3600000;

        // Check daily usage limit
        var dayStart = new Date(start);
        dayStart.setHours(0, 0, 0, 0);
        var dayEnd = dayStart.getTime() + 86400000;
        var dailyUsed = 0;
        for (var i = 0; i < eq.bookings.length; i++) {
            var b = eq.bookings[i];
            if (b.cancelled) continue;
            var overlapStart = Math.max(b.start, dayStart.getTime());
            var overlapEnd = Math.min(b.end, dayEnd);
            if (overlapEnd > overlapStart) dailyUsed += (overlapEnd - overlapStart) / 3600000;
        }
        if (dailyUsed + durationHours > eqConfig.maxDailyHours) {
            return {
                success: false,
                error: 'Exceeds daily limit (' + eqConfig.maxDailyHours + 'h). Already booked: ' + dailyUsed.toFixed(1) + 'h',
                suggestion: 'Try scheduling on a different day or splitting the session'
            };
        }

        // Conflict detection with buffer time
        var bufferMs = eqConfig.cleaningMinutes * 60000;
        var conflicts = [];
        for (var j = 0; j < eq.bookings.length; j++) {
            var existing = eq.bookings[j];
            if (existing.cancelled) continue;
            var bufferedStart = existing.start - bufferMs;
            var bufferedEnd = existing.end + bufferMs;
            if (start < bufferedEnd && end > bufferedStart) {
                conflicts.push({
                    bookingId: existing.id,
                    user: existing.user,
                    start: new Date(existing.start).toISOString(),
                    end: new Date(existing.end).toISOString(),
                    overlap: 'direct'
                });
            }
        }

        // Maintenance window conflicts
        for (var k = 0; k < eq.maintenanceWindows.length; k++) {
            var mw = eq.maintenanceWindows[k];
            if (start < mw.end && end > mw.start) {
                conflicts.push({
                    type: 'maintenance',
                    reason: mw.reason,
                    start: new Date(mw.start).toISOString(),
                    end: new Date(mw.end).toISOString()
                });
            }
        }

        if (conflicts.length > 0) {
            var suggestion = suggestAlternativeSlots(opts.equipmentId, end - start, start, 3);
            return {
                success: false,
                error: 'Booking conflicts detected (' + conflicts.length + ')',
                conflicts: conflicts,
                suggestedSlots: suggestion
            };
        }

        var priority = PRIORITY_LEVELS[opts.priority] || PRIORITY_LEVELS.normal;
        var booking = {
            id: nextBookingId++,
            equipmentId: opts.equipmentId,
            user: opts.user,
            project: opts.project || null,
            start: start,
            end: end,
            priority: priority,
            priorityLabel: opts.priority || 'normal',
            notes: opts.notes || '',
            cancelled: false,
            createdAt: Date.now()
        };

        eq.bookings.push(booking);
        bookings.push(booking);

        // Proactive alert: check if equipment is heavily booked
        var utilization = computeUtilization(opts.equipmentId, start, start + 86400000);
        if (utilization.utilizationPercent > 85) {
            var alert = {
                type: 'high_utilization',
                equipmentId: opts.equipmentId,
                message: eq.name + ' is at ' + utilization.utilizationPercent.toFixed(0) + '% utilization today. Consider distributing load.',
                timestamp: Date.now()
            };
            alerts.push(alert);
            booking.alert = alert;
        }

        return { success: true, booking: formatBooking(booking), alert: booking.alert || null };
    }

    // ── Smart Slot Suggestion ───────────────────────────────────

    function suggestAlternativeSlots(equipmentId, durationMs, nearTime, count) {
        var eq = equipment[equipmentId];
        if (!eq) return [];
        var eqConfig = EQUIPMENT_TYPES[eq.type];
        var bufferMs = eqConfig.cleaningMinutes * 60000;
        var maxSlots = count || 5;
        var slots = [];

        // Scan the next 7 days in 30-min increments
        var scanStart = nearTime || Date.now();
        var scanEnd = scanStart + 7 * 86400000;
        var step = 1800000; // 30 min
        var durationHours = durationMs / 3600000;

        // Pre-filter active bookings once (avoids re-checking .cancelled
        // on every slot × booking iteration — up to 336 × N checks).
        var activeBookings = [];
        for (var ab = 0; ab < eq.bookings.length; ab++) {
            if (!eq.bookings[ab].cancelled) activeBookings.push(eq.bookings[ab]);
        }

        // Cache daily usage per day-key to avoid redundant O(bookings)
        // scans.  Many of the 336 candidate slots fall on the same day;
        // without caching, daily-limit checks cost O(slots × bookings)
        // instead of O(days × bookings + slots).
        var dailyUsageCache = {};
        function getDailyUsage(dayStartMs, dayEndMs) {
            if (dailyUsageCache[dayStartMs] !== undefined) return dailyUsageCache[dayStartMs];
            var used = 0;
            for (var du = 0; du < activeBookings.length; du++) {
                var bk = activeBookings[du];
                var os = bk.start > dayStartMs ? bk.start : dayStartMs;
                var oe = bk.end < dayEndMs ? bk.end : dayEndMs;
                if (oe > os) used += (oe - os) / 3600000;
            }
            dailyUsageCache[dayStartMs] = used;
            return used;
        }

        for (var t = scanStart; t < scanEnd && slots.length < maxSlots; t += step) {
            var slotEnd = t + durationMs;
            var conflict = false;

            for (var i = 0; i < activeBookings.length; i++) {
                var b = activeBookings[i];
                if (t < (b.end + bufferMs) && slotEnd > (b.start - bufferMs)) {
                    conflict = true;
                    break;
                }
            }

            // Check maintenance windows
            if (!conflict) {
                for (var m = 0; m < eq.maintenanceWindows.length; m++) {
                    var mw = eq.maintenanceWindows[m];
                    if (t < mw.end && slotEnd > mw.start) {
                        conflict = true;
                        break;
                    }
                }
            }

            // Check daily limit (cached per day)
            if (!conflict) {
                var dayStart = new Date(t);
                dayStart.setHours(0, 0, 0, 0);
                var dayStartMs = dayStart.getTime();
                var dayEndMs = dayStartMs + 86400000;
                if (getDailyUsage(dayStartMs, dayEndMs) + durationHours > eqConfig.maxDailyHours) {
                    conflict = true;
                }
            }

            if (!conflict) {
                slots.push({
                    start: new Date(t).toISOString(),
                    end: new Date(slotEnd).toISOString(),
                    score: scoreSlot(t, nearTime)
                });
            }
        }

        slots.sort(function (a, b) { return b.score - a.score; });
        return slots.slice(0, maxSlots);
    }

    function scoreSlot(slotTime, preferredTime) {
        // Prefer slots closer to preferred time, during work hours (8-18)
        var dist = Math.abs(slotTime - preferredTime) / 3600000;
        var hour = new Date(slotTime).getHours();
        var workHourBonus = (hour >= 8 && hour <= 18) ? 20 : 0;
        var weekdayBonus = new Date(slotTime).getDay() > 0 && new Date(slotTime).getDay() < 6 ? 10 : 0;
        return Math.max(0, 100 - dist * 2) + workHourBonus + weekdayBonus;
    }

    // ── Utilization Analytics ───────────────────────────────────

    function computeUtilization(equipmentId, periodStart, periodEnd) {
        var eq = equipment[equipmentId];
        if (!eq) return { error: 'Equipment not found' };

        var totalMs = periodEnd - periodStart;
        var usedMs = 0;
        var userMap = Object.create(null);
        var projectMap = Object.create(null);
        // Count overlapping bookings inline instead of a separate
        // .filter() pass that re-scans all bookings.
        var bookingCount = 0;

        for (var i = 0; i < eq.bookings.length; i++) {
            var b = eq.bookings[i];
            if (b.cancelled) continue;
            if (b.start >= periodEnd || b.end <= periodStart) continue;
            bookingCount++;
            var os = b.start > periodStart ? b.start : periodStart;
            var oe = b.end < periodEnd ? b.end : periodEnd;
            if (oe > os) {
                var overlap = oe - os;
                usedMs += overlap;
                userMap[b.user] = (userMap[b.user] || 0) + overlap;
                if (b.project) projectMap[b.project] = (projectMap[b.project] || 0) + overlap;
            }
        }

        var topUsers = Object.keys(userMap).map(function (u) {
            return { user: u, hours: +(userMap[u] / 3600000).toFixed(1) };
        }).sort(function (a, b) { return b.hours - a.hours; });

        var topProjects = Object.keys(projectMap).map(function (p) {
            return { project: p, hours: +(projectMap[p] / 3600000).toFixed(1) };
        }).sort(function (a, b) { return b.hours - a.hours; });

        var utilizationPct = totalMs > 0 ? (usedMs / totalMs) * 100 : 0;
        var recommendations = [];

        if (utilizationPct > 90)
            recommendations.push('Equipment is near capacity. Consider adding a second unit or extending operating hours.');
        else if (utilizationPct > 75)
            recommendations.push('Good utilization. Monitor for peak-time bottlenecks.');
        else if (utilizationPct < 20)
            recommendations.push('Equipment is underutilized. Consider consolidating schedules or repurposing.');

        return {
            equipmentId: equipmentId,
            periodStart: new Date(periodStart).toISOString(),
            periodEnd: new Date(periodEnd).toISOString(),
            totalHours: +(totalMs / 3600000).toFixed(1),
            usedHours: +(usedMs / 3600000).toFixed(1),
            utilizationPercent: +utilizationPct.toFixed(1),
            bookingCount: bookingCount,
            topUsers: topUsers,
            topProjects: topProjects,
            recommendations: recommendations
        };
    }

    // ── Schedule Maintenance ────────────────────────────────────

    function scheduleMaintenance(opts) {
        if (!opts || !opts.equipmentId || !opts.start || !opts.end) {
            return { success: false, error: 'equipmentId, start, and end are required' };
        }
        var eq = equipment[opts.equipmentId];
        if (!eq) return { success: false, error: 'Equipment not found' };

        var start = new Date(opts.start).getTime();
        var end = new Date(opts.end).getTime();

        // Check for affected bookings
        var affected = [];
        for (var i = 0; i < eq.bookings.length; i++) {
            var b = eq.bookings[i];
            if (b.cancelled) continue;
            if (b.start < end && b.end > start) {
                affected.push(formatBooking(b));
            }
        }

        eq.maintenanceWindows.push({
            start: start,
            end: end,
            reason: opts.reason || 'Scheduled maintenance'
        });

        return {
            success: true,
            maintenanceWindow: {
                start: new Date(start).toISOString(),
                end: new Date(end).toISOString(),
                reason: opts.reason || 'Scheduled maintenance'
            },
            affectedBookings: affected,
            message: affected.length > 0
                ? affected.length + ' booking(s) conflict with maintenance. Consider rescheduling them.'
                : 'No booking conflicts.'
        };
    }

    // ── Cancel Booking ──────────────────────────────────────────

    function cancelBooking(bookingId) {
        for (var i = 0; i < bookings.length; i++) {
            if (bookings[i].id === bookingId && !bookings[i].cancelled) {
                bookings[i].cancelled = true;
                bookings[i].cancelledAt = Date.now();
                return { success: true, booking: formatBooking(bookings[i]) };
            }
        }
        return { success: false, error: 'Booking not found or already cancelled' };
    }

    // ── Fleet Overview ──────────────────────────────────────────

    function getFleetStatus(periodStart, periodEnd) {
        var start = periodStart ? new Date(periodStart).getTime() : Date.now();
        var end = periodEnd ? new Date(periodEnd).getTime() : start + 86400000;

        var fleet = [];
        var ids = Object.keys(equipment);
        for (var i = 0; i < ids.length; i++) {
            var eq = equipment[ids[i]];
            var util = computeUtilization(eq.id, start, end);
            var upcomingCount = eq.bookings.filter(function (b) {
                return !b.cancelled && b.start >= start && b.start < end;
            }).length;
            fleet.push({
                id: eq.id,
                name: eq.name,
                type: eq.type,
                location: eq.location,
                utilization: util.utilizationPercent,
                upcomingBookings: upcomingCount,
                status: util.utilizationPercent > 90 ? 'overloaded'
                    : util.utilizationPercent > 0 ? 'in_use' : 'available'
            });
        }

        fleet.sort(function (a, b) { return b.utilization - a.utilization; });

        var overloaded = fleet.filter(function (e) { return e.status === 'overloaded'; }).length;
        var recommendations = [];
        if (overloaded > 0)
            recommendations.push(overloaded + ' equipment item(s) overloaded. Redistribute bookings.');
        if (fleet.length > 0) {
            var avgUtil = fleet.reduce(function (s, e) { return s + e.utilization; }, 0) / fleet.length;
            if (avgUtil < 30) recommendations.push('Overall utilization is low (' + avgUtil.toFixed(0) + '%). Consider consolidating equipment.');
        }

        return {
            periodStart: new Date(start).toISOString(),
            periodEnd: new Date(end).toISOString(),
            totalEquipment: ids.length,
            fleet: fleet,
            recommendations: recommendations
        };
    }

    // ── Get Alerts ──────────────────────────────────────────────

    function getAlerts(since) {
        var cutoff = since ? new Date(since).getTime() : 0;
        return alerts.filter(function (a) { return a.timestamp >= cutoff; });
    }

    // ── Helpers ─────────────────────────────────────────────────

    function formatBooking(b) {
        return {
            id: b.id,
            equipmentId: b.equipmentId,
            user: b.user,
            project: b.project,
            start: new Date(b.start).toISOString(),
            end: new Date(b.end).toISOString(),
            durationHours: +((b.end - b.start) / 3600000).toFixed(1),
            priority: b.priorityLabel,
            notes: b.notes,
            cancelled: b.cancelled
        };
    }

    return {
        registerEquipment: registerEquipment,
        book: book,
        cancelBooking: cancelBooking,
        suggestSlots: function (opts) {
            if (!opts || !opts.equipmentId || !opts.durationMinutes) {
                return { error: 'equipmentId and durationMinutes required' };
            }
            return suggestAlternativeSlots(
                opts.equipmentId,
                opts.durationMinutes * 60000,
                opts.nearTime ? new Date(opts.nearTime).getTime() : Date.now(),
                opts.count || 5
            );
        },
        getUtilization: function (opts) {
            if (!opts || !opts.equipmentId) return { error: 'equipmentId required' };
            var start = opts.start ? new Date(opts.start).getTime() : Date.now() - 86400000;
            var end = opts.end ? new Date(opts.end).getTime() : Date.now();
            return computeUtilization(opts.equipmentId, start, end);
        },
        scheduleMaintenance: scheduleMaintenance,
        getFleetStatus: getFleetStatus,
        getAlerts: getAlerts,
        getSchedule: function (equipmentId) {
            var eq = equipment[equipmentId];
            if (!eq) return { error: 'Equipment not found' };
            return {
                equipment: { id: eq.id, name: eq.name, type: eq.type, location: eq.location },
                bookings: eq.bookings.filter(function (b) { return !b.cancelled; }).map(formatBooking),
                maintenanceWindows: eq.maintenanceWindows.map(function (mw) {
                    return {
                        start: new Date(mw.start).toISOString(),
                        end: new Date(mw.end).toISOString(),
                        reason: mw.reason
                    };
                })
            };
        },
        listEquipment: function () {
            return Object.keys(equipment).map(function (id) {
                var eq = equipment[id];
                return { id: eq.id, name: eq.name, type: eq.type, location: eq.location };
            });
        }
    };
}

module.exports = { createLabEquipmentScheduler: createLabEquipmentScheduler };
