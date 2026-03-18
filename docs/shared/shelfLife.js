'use strict';

/**
 * Bioink Shelf Life Manager — track bioink storage, expiration, and stability.
 *
 * Manages bioink inventory with storage conditions, expiration tracking,
 * stability scoring based on age/temperature/light exposure, and usage
 * recommendations. Helps labs avoid using degraded materials.
 *
 * @example
 *   var mgr = createShelfLifeManager();
 *   mgr.addBioink({ id: 'ALG-001', material: 'alginate', volume: 50,
 *     storageTemp: 4, shelfLifeDays: 90 });
 *   var status = mgr.getStatus('ALG-001');
 *   var alerts = mgr.getExpiringAlerts(7); // expiring within 7 days
 */

var STORAGE_CONDITIONS = {
    frozen: { minTemp: -80, maxTemp: -15, label: 'Frozen', degradationRate: 0.1 },
    refrigerated: { minTemp: 2, maxTemp: 8, label: 'Refrigerated', degradationRate: 0.5 },
    roomTemp: { minTemp: 15, maxTemp: 30, label: 'Room Temperature', degradationRate: 1.0 },
    warm: { minTemp: 30, maxTemp: 60, label: 'Warm (Elevated)', degradationRate: 2.5 }
};

var MATERIAL_DEFAULTS = {
    alginate: { shelfLifeDays: 180, idealTemp: 4, lightSensitive: false },
    gelatin: { shelfLifeDays: 90, idealTemp: 4, lightSensitive: false },
    collagen: { shelfLifeDays: 60, idealTemp: 4, lightSensitive: true },
    fibrin: { shelfLifeDays: 30, idealTemp: -20, lightSensitive: false },
    hyaluronic_acid: { shelfLifeDays: 120, idealTemp: 4, lightSensitive: true },
    matrigel: { shelfLifeDays: 365, idealTemp: -20, lightSensitive: true },
    peg: { shelfLifeDays: 365, idealTemp: 20, lightSensitive: false },
    silk: { shelfLifeDays: 180, idealTemp: 4, lightSensitive: false },
    cellulose: { shelfLifeDays: 365, idealTemp: 20, lightSensitive: false },
    chitosan: { shelfLifeDays: 180, idealTemp: 4, lightSensitive: false }
};

function classifyStorage(temp) {
    if (temp <= -15) return 'frozen';
    if (temp <= 8) return 'refrigerated';
    if (temp <= 30) return 'roomTemp';
    return 'warm';
}

function daysBetween(d1, d2) {
    var ms = new Date(d2).getTime() - new Date(d1).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function createShelfLifeManager() {
    var bioinks = {};
    var usageLog = [];
    var storageEvents = [];

    // --- Expiration Enforcement ---

    /**
     * Transition an active bioink to 'expired' status if its shelf life
     * has elapsed.  Called at the start of read/write operations to ensure
     * stale entries are never silently returned as 'active'.
     */
    function _enforceExpiration(entry) {
        if (entry.status === 'active' && getDaysRemaining(entry) < 0) {
            entry.status = 'expired';
        }
    }

    // --- Bioink Management ---

    function addBioink(opts) {
        if (!opts || !opts.id) throw new Error('Bioink id is required');
        if (bioinks[opts.id]) throw new Error('Bioink already exists: ' + opts.id);
        if (!opts.material) throw new Error('Material type is required');

        var matKey = opts.material.toLowerCase().replace(/[\s-]/g, '_');
        var defaults = MATERIAL_DEFAULTS[matKey] || {};

        var entry = {
            id: opts.id,
            material: opts.material,
            lotNumber: opts.lotNumber || null,
            supplier: opts.supplier || null,
            volume: opts.volume || 0,        // mL
            concentration: opts.concentration || null, // mg/mL
            storageTemp: opts.storageTemp != null ? opts.storageTemp : (defaults.idealTemp != null ? defaults.idealTemp : 4),
            shelfLifeDays: opts.shelfLifeDays || defaults.shelfLifeDays || 90,
            lightSensitive: opts.lightSensitive != null ? opts.lightSensitive : (defaults.lightSensitive || false),
            lightExposed: opts.lightExposed || false,
            manufacturedDate: opts.manufacturedDate || new Date().toISOString().slice(0, 10),
            receivedDate: opts.receivedDate || new Date().toISOString().slice(0, 10),
            openedDate: opts.openedDate || null,
            status: 'active',  // active, depleted, expired, discarded
            notes: opts.notes || '',
            createdAt: new Date().toISOString()
        };

        bioinks[entry.id] = entry;
        return clone(entry);
    }

    function removeBioink(id) {
        if (!bioinks[id]) throw new Error('Bioink not found: ' + id);
        bioinks[id].status = 'discarded';
        return clone(bioinks[id]);
    }

    function updateBioink(id, updates) {
        if (!bioinks[id]) throw new Error('Bioink not found: ' + id);
        var entry = bioinks[id];
        var allowed = ['storageTemp', 'lightExposed', 'openedDate', 'volume', 'notes', 'status'];
        for (var i = 0; i < allowed.length; i++) {
            var key = allowed[i];
            if (updates[key] !== undefined) {
                if (key === 'storageTemp') {
                    var oldTemp = entry.storageTemp;
                    entry.storageTemp = updates[key];
                    storageEvents.push({
                        bioinkId: id,
                        oldTemp: oldTemp,
                        newTemp: updates[key],
                        timestamp: new Date().toISOString()
                    });
                } else {
                    entry[key] = updates[key];
                }
            }
        }
        return clone(entry);
    }

    function getBioink(id) {
        if (!bioinks[id]) throw new Error('Bioink not found: ' + id);
        _enforceExpiration(bioinks[id]);
        return clone(bioinks[id]);
    }

    function listBioinks(filter) {
        var results = [];
        var keys = Object.keys(bioinks);
        for (var i = 0; i < keys.length; i++) {
            var b = bioinks[keys[i]];
            _enforceExpiration(b);
            if (filter) {
                if (filter.status && b.status !== filter.status) continue;
                if (filter.material && b.material.toLowerCase() !== filter.material.toLowerCase()) continue;
                if (filter.expiringSoon) {
                    var daysLeft = getDaysRemaining(b);
                    if (daysLeft > filter.expiringSoon || daysLeft < 0) continue;
                }
            }
            results.push(clone(b));
        }
        return results;
    }

    // --- Shelf Life & Stability ---

    function getDaysRemaining(entry) {
        var mfgDate = new Date(entry.manufacturedDate);
        var expDate = new Date(mfgDate.getTime() + entry.shelfLifeDays * 24 * 60 * 60 * 1000);
        var now = new Date();
        return Math.floor((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    function getExpirationDate(entry) {
        var mfgDate = new Date(entry.manufacturedDate);
        return new Date(mfgDate.getTime() + entry.shelfLifeDays * 24 * 60 * 60 * 1000)
            .toISOString().slice(0, 10);
    }

    function calculateStabilityScore(id, referenceDate) {
        var entry = bioinks[id];
        if (!entry) throw new Error('Bioink not found: ' + id);
        _enforceExpiration(entry);

        var now = referenceDate ? new Date(referenceDate) : new Date();
        var ageDays = daysBetween(entry.manufacturedDate, now);
        var maxDays = entry.shelfLifeDays;
        var ageFraction = Math.min(ageDays / maxDays, 1.5);

        // Age penalty (0-40 points)
        var ageScore = Math.max(0, 40 * (1 - ageFraction));

        // Temperature suitability (0-30 points)
        var storageClass = classifyStorage(entry.storageTemp);
        var condition = STORAGE_CONDITIONS[storageClass];
        var matKey = entry.material.toLowerCase().replace(/[\s-]/g, '_');
        var defaults = MATERIAL_DEFAULTS[matKey] || {};
        var idealTemp = defaults.idealTemp != null ? defaults.idealTemp : 4;
        var tempDiff = Math.abs(entry.storageTemp - idealTemp);
        var tempScore = Math.max(0, 30 * (1 - tempDiff / 40));

        // Light exposure penalty (0-15 points)
        var lightScore = 15;
        if (entry.lightSensitive && entry.lightExposed) {
            lightScore = 0;
        }

        // Opened penalty (0-15 points)
        var openScore = 15;
        if (entry.openedDate) {
            var openDays = daysBetween(entry.openedDate, now);
            openScore = Math.max(0, 15 * (1 - openDays / (maxDays * 0.5)));
        }

        var total = Math.round(ageScore + tempScore + lightScore + openScore);
        total = Math.max(0, Math.min(100, total));

        var grade;
        if (total >= 80) grade = 'A';
        else if (total >= 60) grade = 'B';
        else if (total >= 40) grade = 'C';
        else if (total >= 20) grade = 'D';
        else grade = 'F';

        return {
            bioinkId: id,
            score: total,
            grade: grade,
            breakdown: {
                age: Math.round(ageScore),
                temperature: Math.round(tempScore),
                lightProtection: Math.round(lightScore),
                sealIntegrity: Math.round(openScore)
            },
            recommendation: getRecommendation(total, entry),
            daysRemaining: getDaysRemaining(entry),
            expirationDate: getExpirationDate(entry)
        };
    }

    function getRecommendation(score, entry) {
        if (entry.status === 'expired' || entry.status === 'discarded') {
            return 'Do not use — material is ' + entry.status + '.';
        }
        var daysLeft = getDaysRemaining(entry);
        if (daysLeft < 0) return 'Expired — discard immediately.';
        if (score >= 80) return 'Excellent condition — safe for critical prints.';
        if (score >= 60) return 'Good condition — suitable for routine prints.';
        if (score >= 40) return 'Fair condition — use for non-critical prints only. Consider ordering replacement.';
        if (score >= 20) return 'Poor condition — test before use. Order replacement immediately.';
        return 'Degraded — discard and replace.';
    }

    // --- Usage Tracking ---

    function recordUsage(bioinkId, amount, opts) {
        if (!bioinks[bioinkId]) throw new Error('Bioink not found: ' + bioinkId);
        if (!amount || amount <= 0) throw new Error('Amount must be positive');

        var entry = bioinks[bioinkId];
        _enforceExpiration(entry);

        if (entry.status === 'expired') {
            if (!(opts && opts.forceUse)) {
                throw new Error('Cannot use expired bioink: ' + bioinkId + '. Pass { forceUse: true } to override after re-validation.');
            }
        }
        if (entry.status === 'discarded') {
            throw new Error('Cannot use discarded bioink: ' + bioinkId);
        }
        if (entry.status === 'depleted') {
            throw new Error('Cannot use depleted bioink: ' + bioinkId);
        }

        if (amount > entry.volume) throw new Error('Insufficient volume: ' + entry.volume + ' mL remaining');

        entry.volume -= amount;

        var record = {
            bioinkId: bioinkId,
            amount: amount,
            remainingVolume: entry.volume,
            purpose: (opts && opts.purpose) || '',
            operator: (opts && opts.operator) || '',
            printJobId: (opts && opts.printJobId) || null,
            timestamp: new Date().toISOString()
        };

        usageLog.push(record);

        if (entry.volume <= 0) {
            entry.status = 'depleted';
        }

        if (!entry.openedDate) {
            entry.openedDate = new Date().toISOString().slice(0, 10);
        }

        return clone(record);
    }

    function getUsageHistory(bioinkId) {
        if (bioinkId) {
            return usageLog.filter(function(r) { return r.bioinkId === bioinkId; }).map(clone);
        }
        return usageLog.map(clone);
    }

    // --- Alerts ---

    function getExpiringAlerts(withinDays) {
        withinDays = withinDays || 14;
        var alerts = [];
        var keys = Object.keys(bioinks);
        for (var i = 0; i < keys.length; i++) {
            var entry = bioinks[keys[i]];
            _enforceExpiration(entry);
            if (entry.status !== 'active' && entry.status !== 'expired') continue;
            var daysLeft = getDaysRemaining(entry);
            if (daysLeft < 0) {
                if (entry.status !== 'expired') continue; // should not happen after enforcement
                alerts.push({
                    bioinkId: entry.id,
                    severity: 'critical',
                    type: 'expired',
                    message: entry.material + ' (' + entry.id + ') has expired ' + Math.abs(daysLeft) + ' days ago.',
                    daysRemaining: daysLeft
                });
            } else if (daysLeft <= withinDays) {
                var severity = daysLeft <= 3 ? 'high' : (daysLeft <= 7 ? 'medium' : 'low');
                alerts.push({
                    bioinkId: entry.id,
                    severity: severity,
                    type: 'expiring',
                    message: entry.material + ' (' + entry.id + ') expires in ' + daysLeft + ' days.',
                    daysRemaining: daysLeft
                });
            }
        }
        // Temperature warnings
        for (var j = 0; j < keys.length; j++) {
            var e = bioinks[keys[j]];
            _enforceExpiration(e);
            if (e.status !== 'active') continue;
            var mk = e.material.toLowerCase().replace(/[\s-]/g, '_');
            var defs = MATERIAL_DEFAULTS[mk];
            if (defs && defs.idealTemp != null) {
                var diff = Math.abs(e.storageTemp - defs.idealTemp);
                if (diff > 15) {
                    alerts.push({
                        bioinkId: e.id,
                        severity: 'high',
                        type: 'temperature',
                        message: e.material + ' (' + e.id + ') stored at ' + e.storageTemp + '°C, ideal is ' + defs.idealTemp + '°C.',
                        daysRemaining: getDaysRemaining(e)
                    });
                }
            }
            if (e.lightSensitive && e.lightExposed) {
                alerts.push({
                    bioinkId: e.id,
                    severity: 'medium',
                    type: 'light_exposure',
                    message: e.material + ' (' + e.id + ') is light-sensitive and currently exposed.',
                    daysRemaining: getDaysRemaining(e)
                });
            }
        }
        alerts.sort(function(a, b) {
            var sev = { critical: 0, high: 1, medium: 2, low: 3 };
            return (sev[a.severity] || 4) - (sev[b.severity] || 4);
        });
        return alerts;
    }

    // --- Inventory Summary ---

    function getInventorySummary() {
        var keys = Object.keys(bioinks);
        var summary = {
            total: keys.length,
            active: 0,
            expired: 0,
            depleted: 0,
            discarded: 0,
            totalVolume: 0,
            byMaterial: {},
            avgStabilityScore: 0,
            criticalAlerts: 0
        };

        var scoreSum = 0;
        var scoreCount = 0;

        for (var i = 0; i < keys.length; i++) {
            var entry = bioinks[keys[i]];
            summary[entry.status] = (summary[entry.status] || 0) + 1;
            if (entry.status === 'active') {
                summary.totalVolume += entry.volume;
                var mat = entry.material;
                if (!summary.byMaterial[mat]) {
                    summary.byMaterial[mat] = { count: 0, volume: 0 };
                }
                summary.byMaterial[mat].count++;
                summary.byMaterial[mat].volume += entry.volume;

                var stability = calculateStabilityScore(entry.id);
                scoreSum += stability.score;
                scoreCount++;
            }
        }

        summary.avgStabilityScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;
        summary.criticalAlerts = getExpiringAlerts(3).filter(function(a) {
            return a.severity === 'critical' || a.severity === 'high';
        }).length;

        return summary;
    }

    // --- Storage Recommendation ---

    function getStorageRecommendation(material) {
        var mk = material.toLowerCase().replace(/[\s-]/g, '_');
        var defaults = MATERIAL_DEFAULTS[mk];
        if (!defaults) {
            return {
                material: material,
                known: false,
                recommendation: 'Unknown material. Store at 4°C (refrigerated) as a general precaution.',
                idealTemp: 4,
                shelfLifeDays: 90,
                lightSensitive: false
            };
        }
        var storageClass = classifyStorage(defaults.idealTemp);
        return {
            material: material,
            known: true,
            recommendation: 'Store at ' + defaults.idealTemp + '°C (' + STORAGE_CONDITIONS[storageClass].label + '). ' +
                (defaults.lightSensitive ? 'Protect from light. ' : '') +
                'Expected shelf life: ' + defaults.shelfLifeDays + ' days.',
            idealTemp: defaults.idealTemp,
            shelfLifeDays: defaults.shelfLifeDays,
            lightSensitive: defaults.lightSensitive
        };
    }

    function getStorageEvents(bioinkId) {
        if (bioinkId) {
            return storageEvents.filter(function(e) { return e.bioinkId === bioinkId; }).map(clone);
        }
        return storageEvents.map(clone);
    }

    // --- Helpers ---

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    return {
        addBioink: addBioink,
        removeBioink: removeBioink,
        updateBioink: updateBioink,
        getBioink: getBioink,
        listBioinks: listBioinks,
        calculateStabilityScore: calculateStabilityScore,
        recordUsage: recordUsage,
        getUsageHistory: getUsageHistory,
        getExpiringAlerts: getExpiringAlerts,
        getInventorySummary: getInventorySummary,
        getStorageRecommendation: getStorageRecommendation,
        getStorageEvents: getStorageEvents,
        MATERIAL_DEFAULTS: MATERIAL_DEFAULTS,
        STORAGE_CONDITIONS: STORAGE_CONDITIONS
    };
}

module.exports = { createShelfLifeManager: createShelfLifeManager };
