/**
 * Autoclave Cycle Logger
 *
 * Tracks autoclave sterilization cycles for lab compliance in bioprinting
 * workflows. Logs cycle parameters (temperature, pressure, duration),
 * validates against standard protocols, checks biological/chemical
 * indicator results, and flags items overdue for re-sterilization.
 *
 * Proper sterilization is critical for bioprinting — contaminated
 * equipment or media can ruin expensive print runs and compromise
 * cell viability.
 *
 * @example
 *   var autoclave = require('./autoclave');
 *   var logger = autoclave.createAutoclaveLogger();
 *   var logged = logger.logCycle({
 *     autoclaveId: 'AC-001',
 *     cycleType: 'gravity',
 *     temperature: 121,
 *     pressure: 15,
 *     duration: 30,
 *     items: ['media bottles', 'pipette tips'],
 *     operator: 'J. Smith'
 *   });
 */

'use strict';

/* ------------------------------------------------------------------ */
/*  Standard Protocols                                                 */
/* ------------------------------------------------------------------ */

var PROTOCOLS = {
    gravity: {
        name: 'Gravity Displacement',
        minTemp: 121,       // °C
        minPressure: 15,    // psi
        minDuration: 30,    // minutes for wrapped goods
        maxDuration: 60,
        description: 'Standard cycle for liquids, media, and wrapped instruments'
    },
    prevacuum: {
        name: 'Pre-Vacuum (Dynamic Air Removal)',
        minTemp: 132,
        minPressure: 27,
        minDuration: 4,
        maxDuration: 18,
        description: 'Fast cycle for porous loads, wrapped packs, and lumens'
    },
    liquid: {
        name: 'Liquid / Slow Exhaust',
        minTemp: 121,
        minPressure: 15,
        minDuration: 20,
        maxDuration: 60,
        description: 'For liquid media with slow exhaust to prevent boil-over'
    },
    flash: {
        name: 'Flash / Immediate-Use',
        minTemp: 132,
        minPressure: 27,
        minDuration: 3,
        maxDuration: 10,
        description: 'Unwrapped instruments for immediate use only'
    },
    waste: {
        name: 'Biohazard Waste',
        minTemp: 121,
        minPressure: 15,
        minDuration: 45,
        maxDuration: 90,
        description: 'Decontamination of biohazardous waste before disposal'
    }
};

/* ------------------------------------------------------------------ */
/*  Indicator Types                                                    */
/* ------------------------------------------------------------------ */

var INDICATOR_TYPES = {
    chemical_class1: { name: 'Process Indicator (Class 1)', purpose: 'Distinguishes processed from unprocessed' },
    chemical_class4: { name: 'Multi-Variable Indicator (Class 4)', purpose: 'Reacts to 2+ critical variables' },
    chemical_class5: { name: 'Integrating Indicator (Class 5)', purpose: 'Correlates with BI kill performance' },
    chemical_class6: { name: 'Emulating Indicator (Class 6)', purpose: 'Cycle-specific verification' },
    biological: { name: 'Biological Indicator (Geobacillus stearothermophilus)', purpose: 'Gold standard spore kill verification' }
};

/* ------------------------------------------------------------------ */
/*  Re-sterilization Shelf Life (hours)                                */
/* ------------------------------------------------------------------ */

var SHELF_LIFE = {
    'single_wrap':   30 * 24,   // 30 days
    'double_wrap':   60 * 24,   // 60 days
    'peel_pouch':    180 * 24,  // 6 months
    'rigid_container': 180 * 24,
    'unwrapped':     0          // immediate use only
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function generateCycleId() {
    var ts = Date.now().toString(36);
    var rand = Math.random().toString(36).substring(2, 6);
    return 'CYC-' + ts + '-' + rand;
}

function nowISO() {
    return new Date().toISOString();
}

function hoursAgo(isoString) {
    return (Date.now() - new Date(isoString).getTime()) / 3600000;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

function createAutoclaveLogger() {
    var cycles = [];
    var autoclaves = {};

    /* ── Register an autoclave ── */
    function registerAutoclave(opts) {
        if (!opts || !opts.id) { throw new Error('Autoclave id is required'); }
        autoclaves[opts.id] = {
            id: opts.id,
            model: opts.model || 'Unknown',
            location: opts.location || 'Unknown',
            lastMaintenance: opts.lastMaintenance || null,
            maintenanceIntervalDays: opts.maintenanceIntervalDays || 90,
            registeredAt: nowISO()
        };
        return { success: true, autoclave: autoclaves[opts.id] };
    }

    /* ── Log a sterilization cycle ── */
    function logCycle(opts) {
        if (!opts) { throw new Error('Cycle options are required'); }
        var cycleType = (opts.cycleType || 'gravity').toLowerCase();
        var protocol = PROTOCOLS[cycleType];
        if (!protocol) {
            throw new Error('Unknown cycle type: ' + cycleType + '. Valid: ' + Object.keys(PROTOCOLS).join(', '));
        }

        var temp = opts.temperature;
        var pressure = opts.pressure;
        var duration = opts.duration;
        var items = opts.items || [];
        var warnings = [];
        var pass = true;

        // Validate parameters against protocol
        if (typeof temp !== 'number' || temp < protocol.minTemp) {
            warnings.push('Temperature ' + temp + '°C below minimum ' + protocol.minTemp + '°C');
            pass = false;
        }
        if (typeof pressure !== 'number' || pressure < protocol.minPressure) {
            warnings.push('Pressure ' + pressure + ' psi below minimum ' + protocol.minPressure + ' psi');
            pass = false;
        }
        if (typeof duration !== 'number' || duration < protocol.minDuration) {
            warnings.push('Duration ' + duration + ' min below minimum ' + protocol.minDuration + ' min');
            pass = false;
        }
        if (typeof duration === 'number' && duration > protocol.maxDuration) {
            warnings.push('Duration ' + duration + ' min exceeds maximum ' + protocol.maxDuration + ' min — may damage materials');
        }

        var cycle = {
            cycleId: generateCycleId(),
            autoclaveId: opts.autoclaveId || 'UNSPECIFIED',
            cycleType: cycleType,
            protocol: protocol.name,
            temperature: temp,
            pressure: pressure,
            duration: duration,
            items: items,
            wrapping: opts.wrapping || 'single_wrap',
            operator: opts.operator || 'Unknown',
            indicators: [],
            timestamp: opts.timestamp || nowISO(),
            pass: pass,
            warnings: warnings,
            notes: opts.notes || ''
        };

        cycles.push(cycle);

        return {
            cycleId: cycle.cycleId,
            pass: pass,
            protocol: protocol.name,
            warnings: warnings,
            sterilizedItems: items.length,
            shelfLifeHours: SHELF_LIFE[cycle.wrapping] || 0
        };
    }

    /* ── Record indicator result for a cycle ── */
    function recordIndicator(opts) {
        if (!opts || !opts.cycleId || !opts.type) {
            throw new Error('cycleId and indicator type are required');
        }
        var indicatorInfo = INDICATOR_TYPES[opts.type];
        if (!indicatorInfo) {
            throw new Error('Unknown indicator type: ' + opts.type + '. Valid: ' + Object.keys(INDICATOR_TYPES).join(', '));
        }

        var cycle = null;
        for (var i = 0; i < cycles.length; i++) {
            if (cycles[i].cycleId === opts.cycleId) { cycle = cycles[i]; break; }
        }
        if (!cycle) { throw new Error('Cycle not found: ' + opts.cycleId); }

        var result = {
            type: opts.type,
            name: indicatorInfo.name,
            result: opts.result === 'pass' ? 'pass' : 'fail',
            readAt: opts.readAt || nowISO(),
            lot: opts.lot || '',
            notes: opts.notes || ''
        };

        cycle.indicators.push(result);

        if (result.result === 'fail') {
            cycle.pass = false;
            cycle.warnings.push(indicatorInfo.name + ' FAILED — load considered non-sterile');
        }

        return {
            cycleId: opts.cycleId,
            indicator: result,
            cyclePass: cycle.pass
        };
    }

    /* ── Check items overdue for re-sterilization ── */
    function checkOverdue() {
        var overdue = [];
        for (var i = 0; i < cycles.length; i++) {
            var c = cycles[i];
            if (!c.pass) { continue; }
            var shelfHours = SHELF_LIFE[c.wrapping] || 0;
            if (shelfHours === 0 && c.wrapping === 'unwrapped') {
                overdue.push({
                    cycleId: c.cycleId,
                    items: c.items,
                    reason: 'Unwrapped items — immediate use only',
                    sterilizedAt: c.timestamp
                });
                continue;
            }
            var elapsed = hoursAgo(c.timestamp);
            if (elapsed > shelfHours) {
                overdue.push({
                    cycleId: c.cycleId,
                    items: c.items,
                    reason: 'Shelf life expired (' + Math.round(elapsed) + 'h elapsed, limit ' + shelfHours + 'h)',
                    sterilizedAt: c.timestamp,
                    expiredHoursAgo: Math.round(elapsed - shelfHours)
                });
            }
        }
        return { overdueCount: overdue.length, overdue: overdue };
    }

    /* ── Check autoclave maintenance status ── */
    function checkMaintenance() {
        var results = [];
        var ids = Object.keys(autoclaves);
        for (var i = 0; i < ids.length; i++) {
            var ac = autoclaves[ids[i]];
            var status = 'unknown';
            var daysSince = null;
            if (ac.lastMaintenance) {
                daysSince = Math.round(hoursAgo(ac.lastMaintenance) / 24);
                if (daysSince > ac.maintenanceIntervalDays) {
                    status = 'overdue';
                } else if (daysSince > ac.maintenanceIntervalDays * 0.8) {
                    status = 'due_soon';
                } else {
                    status = 'ok';
                }
            }
            results.push({
                id: ac.id,
                model: ac.model,
                location: ac.location,
                status: status,
                daysSinceLastMaintenance: daysSince,
                intervalDays: ac.maintenanceIntervalDays
            });
        }
        return { autoclaves: results };
    }

    /* ── Compliance report ── */
    function complianceReport(opts) {
        var since = (opts && opts.since) ? new Date(opts.since).getTime() : 0;
        var filtered = [];
        for (var i = 0; i < cycles.length; i++) {
            if (new Date(cycles[i].timestamp).getTime() >= since) {
                filtered.push(cycles[i]);
            }
        }

        var totalCycles = filtered.length;
        var passedCycles = 0;
        var failedCycles = 0;
        var biIndicators = 0;
        var biPassed = 0;
        var byType = {};

        for (var j = 0; j < filtered.length; j++) {
            var c = filtered[j];
            if (c.pass) { passedCycles++; } else { failedCycles++; }
            if (!byType[c.cycleType]) { byType[c.cycleType] = { total: 0, passed: 0 }; }
            byType[c.cycleType].total++;
            if (c.pass) { byType[c.cycleType].passed++; }
            for (var k = 0; k < c.indicators.length; k++) {
                if (c.indicators[k].type === 'biological') {
                    biIndicators++;
                    if (c.indicators[k].result === 'pass') { biPassed++; }
                }
            }
        }

        return {
            period: { since: since ? new Date(since).toISOString() : 'all time' },
            totalCycles: totalCycles,
            passedCycles: passedCycles,
            failedCycles: failedCycles,
            passRate: totalCycles > 0 ? Math.round((passedCycles / totalCycles) * 10000) / 100 : 0,
            biologicalIndicators: { tested: biIndicators, passed: biPassed },
            byType: byType
        };
    }

    /* ── Get cycle history ── */
    function getCycles(opts) {
        var limit = (opts && opts.limit) || 50;
        var autoclaveId = (opts && opts.autoclaveId) || null;
        var result = [];
        for (var i = cycles.length - 1; i >= 0 && result.length < limit; i--) {
            if (autoclaveId && cycles[i].autoclaveId !== autoclaveId) { continue; }
            result.push(cycles[i]);
        }
        return { count: result.length, cycles: result };
    }

    /* ── Protocols reference ── */
    function getProtocols() {
        var result = {};
        var keys = Object.keys(PROTOCOLS);
        for (var i = 0; i < keys.length; i++) {
            result[keys[i]] = Object.assign({}, PROTOCOLS[keys[i]]);
        }
        return result;
    }

    /* ── Indicator types reference ── */
    function getIndicatorTypes() {
        var result = {};
        var keys = Object.keys(INDICATOR_TYPES);
        for (var i = 0; i < keys.length; i++) {
            result[keys[i]] = Object.assign({}, INDICATOR_TYPES[keys[i]]);
        }
        return result;
    }

    return {
        registerAutoclave: registerAutoclave,
        logCycle: logCycle,
        recordIndicator: recordIndicator,
        checkOverdue: checkOverdue,
        checkMaintenance: checkMaintenance,
        complianceReport: complianceReport,
        getCycles: getCycles,
        getProtocols: getProtocols,
        getIndicatorTypes: getIndicatorTypes
    };
}

module.exports = {
    createAutoclaveLogger: createAutoclaveLogger
};
