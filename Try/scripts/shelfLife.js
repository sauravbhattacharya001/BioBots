'use strict';

/**
 * Bioink Shelf Life Tracker for BioBots
 *
 * Models bioink material degradation over time based on storage
 * conditions. Bioinks are perishable — proteins denature, polymers
 * hydrolyze, and cells lose viability. This module tracks batch
 * inventory, predicts remaining shelf life, and alerts when materials
 * approach expiration.
 *
 * Material categories modeled:
 *   - Protein-based (collagen, gelatin, fibrin, silk fibroin)
 *   - Polysaccharide (alginate, hyaluronic acid, chitosan, cellulose)
 *   - Synthetic (Pluronic F-127, PEG, PCL, PLGA)
 *   - Composite (protein + polysaccharide blends)
 *
 * Degradation factors:
 *   - Temperature (Arrhenius model: rate doubles per 10°C above optimal)
 *   - Humidity (hydrolysis acceleration for moisture-sensitive materials)
 *   - Light exposure (photo-degradation for light-sensitive crosslinkers)
 *   - Freeze-thaw cycles (structural damage per cycle)
 *   - Container type (sealed vs open affects oxidation rate)
 *
 * Features:
 *   - Batch registration with material, quantity, storage conditions
 *   - Remaining shelf life prediction with confidence intervals
 *   - Quality score degradation curves (100% → 0% over shelf life)
 *   - Expiration alerts (urgent/warning/ok status)
 *   - Storage optimization recommendations
 *   - Batch inventory summary with usage tracking
 *   - First-expired-first-out (FEFO) ordering
 *
 * References:
 *   - Arrhenius equation: k = A * exp(-Ea / (R * T))
 *   - Q10 rule: rate increases Q10-fold per 10°C rise
 *   - ISO 11137 / ICH Q1A stability testing guidelines
 */

function createShelfLifeTracker(userConfig) {

    // ── Material database ───────────────────────────────────────

    var DEFAULT_MATERIALS = {
        'collagen-type-1': {
            name: 'Collagen Type I',
            category: 'protein',
            baseShelfLifeDays: 90,
            optimalTempC: 4,
            maxTempC: 8,
            minTempC: -20,
            humiditySensitivity: 0.3,
            lightSensitivity: 0.2,
            freezeThawTolerance: 3,
            q10: 2.5,
            costPerMl: 45.00,
            storageNotes: 'Keep at 2-8\u00b0C. Avoid repeated freeze-thaw. Light-sensitive.'
        },
        'gelatin-methacrylate': {
            name: 'GelMA',
            category: 'protein',
            baseShelfLifeDays: 180,
            optimalTempC: -20,
            maxTempC: 4,
            minTempC: -80,
            humiditySensitivity: 0.4,
            lightSensitivity: 0.7,
            freezeThawTolerance: 5,
            q10: 2.0,
            costPerMl: 12.50,
            storageNotes: 'Store at -20\u00b0C. Protect from light (foil-wrap). Lyophilized preferred.'
        },
        'alginate': {
            name: 'Alginate',
            category: 'polysaccharide',
            baseShelfLifeDays: 365,
            optimalTempC: 20,
            maxTempC: 30,
            minTempC: 2,
            humiditySensitivity: 0.6,
            lightSensitivity: 0.1,
            freezeThawTolerance: 10,
            q10: 1.5,
            costPerMl: 3.80,
            storageNotes: 'Room temperature OK if dry. Keep sealed \u2014 hygroscopic.'
        },
        'hyaluronic-acid': {
            name: 'Hyaluronic Acid',
            category: 'polysaccharide',
            baseShelfLifeDays: 180,
            optimalTempC: 4,
            maxTempC: 8,
            minTempC: -20,
            humiditySensitivity: 0.5,
            lightSensitivity: 0.3,
            freezeThawTolerance: 4,
            q10: 2.2,
            costPerMl: 28.00,
            storageNotes: 'Refrigerate at 2-8\u00b0C. Sensitive to enzymatic degradation.'
        },
        'fibrin': {
            name: 'Fibrin',
            category: 'protein',
            baseShelfLifeDays: 30,
            optimalTempC: -20,
            maxTempC: 4,
            minTempC: -80,
            humiditySensitivity: 0.3,
            lightSensitivity: 0.1,
            freezeThawTolerance: 2,
            q10: 3.0,
            costPerMl: 65.00,
            storageNotes: 'Store frozen. Very short shelf life once thawed. Use within 24h at RT.'
        },
        'silk-fibroin': {
            name: 'Silk Fibroin',
            category: 'protein',
            baseShelfLifeDays: 270,
            optimalTempC: 4,
            maxTempC: 25,
            minTempC: -20,
            humiditySensitivity: 0.2,
            lightSensitivity: 0.1,
            freezeThawTolerance: 8,
            q10: 1.8,
            costPerMl: 18.00,
            storageNotes: 'Refrigerate. Relatively stable. Avoid gelation triggers.'
        },
        'chitosan': {
            name: 'Chitosan',
            category: 'polysaccharide',
            baseShelfLifeDays: 300,
            optimalTempC: 20,
            maxTempC: 30,
            minTempC: 2,
            humiditySensitivity: 0.7,
            lightSensitivity: 0.1,
            freezeThawTolerance: 6,
            q10: 1.6,
            costPerMl: 5.50,
            storageNotes: 'Room temperature. Keep dry \u2014 very hygroscopic. Acidic solution preferred.'
        },
        'pluronic-f127': {
            name: 'Pluronic F-127',
            category: 'synthetic',
            baseShelfLifeDays: 730,
            optimalTempC: 20,
            maxTempC: 30,
            minTempC: 2,
            humiditySensitivity: 0.1,
            lightSensitivity: 0.05,
            freezeThawTolerance: 20,
            q10: 1.3,
            costPerMl: 8.20,
            storageNotes: 'Room temperature. Very stable synthetic. Keep sealed.'
        },
        'peg-diacrylate': {
            name: 'PEG-DA',
            category: 'synthetic',
            baseShelfLifeDays: 365,
            optimalTempC: -20,
            maxTempC: 4,
            minTempC: -80,
            humiditySensitivity: 0.3,
            lightSensitivity: 0.8,
            freezeThawTolerance: 15,
            q10: 1.4,
            costPerMl: 15.00,
            storageNotes: 'Store frozen. Protect from light \u2014 acrylate polymerization. Add inhibitor.'
        },
        'cellulose-nanofiber': {
            name: 'Cellulose Nanofiber',
            category: 'polysaccharide',
            baseShelfLifeDays: 365,
            optimalTempC: 4,
            maxTempC: 25,
            minTempC: -20,
            humiditySensitivity: 0.4,
            lightSensitivity: 0.1,
            freezeThawTolerance: 3,
            q10: 1.5,
            costPerMl: 9.00,
            storageNotes: 'Refrigerate suspension. Do not freeze (nanostructure damage). Never dry.'
        }
    };

    // ── Configuration ───────────────────────────────────────────

    var config = {
        materials: {},
        alertThresholds: {
            urgentDays: 7,
            warningDays: 30
        },
        defaultHumidityRH: 45,
        defaultLightExposure: 'dark',
        defaultContainer: 'sealed'
    };

    var k;
    for (k in DEFAULT_MATERIALS) {
        config.materials[k] = {};
        for (var p in DEFAULT_MATERIALS[k]) {
            config.materials[k][p] = DEFAULT_MATERIALS[k][p];
        }
    }

    if (userConfig) {
        if (userConfig.alertThresholds) {
            for (k in userConfig.alertThresholds) {
                config.alertThresholds[k] = userConfig.alertThresholds[k];
            }
        }
        if (userConfig.materials) {
            for (k in userConfig.materials) {
                config.materials[k] = userConfig.materials[k];
            }
        }
    }

    // ── Batch storage ───────────────────────────────────────────

    var batches = [];
    var nextBatchId = 1;

    // ── Core degradation model ──────────────────────────────────

    function degradationMultiplier(material, conditions) {
        var tempC = conditions.tempC != null ? conditions.tempC : material.optimalTempC;
        var humidity = conditions.humidityRH != null ? conditions.humidityRH : config.defaultHumidityRH;
        var light = conditions.lightExposure || config.defaultLightExposure;
        var container = conditions.container || config.defaultContainer;

        var tempDelta = tempC - material.optimalTempC;
        var tempFactor = Math.pow(material.q10, tempDelta / 10);
        if (tempFactor < 0.1) tempFactor = 0.1;

        var humidityFactor = 1.0;
        if (humidity > 60) {
            humidityFactor = 1.0 + material.humiditySensitivity * (humidity - 60) / 40;
        }

        var lightFactor = 1.0;
        if (light === 'ambient') {
            lightFactor = 1.0 + material.lightSensitivity * 0.5;
        } else if (light === 'direct') {
            lightFactor = 1.0 + material.lightSensitivity * 2.0;
        }

        var containerFactor = container === 'open' ? 1.5 : 1.0;

        return tempFactor * humidityFactor * lightFactor * containerFactor;
    }

    function calculateShelfLife(batch, asOfDate) {
        var material = config.materials[batch.materialId];
        if (!material) {
            return { error: 'Unknown material: ' + batch.materialId };
        }

        var now = asOfDate ? new Date(asOfDate) : new Date();
        var created = new Date(batch.createdDate);
        var elapsedMs = now.getTime() - created.getTime();
        var elapsedDays = Math.max(0, elapsedMs / (1000 * 60 * 60 * 24));

        var rate = degradationMultiplier(material, batch.conditions || {});

        var freezeThawCycles = batch.freezeThawCycles || 0;
        var ftPenaltyDays = 0;
        if (freezeThawCycles > 0) {
            var tolerance = material.freezeThawTolerance;
            if (freezeThawCycles > tolerance) {
                ftPenaltyDays = (freezeThawCycles - tolerance) * material.baseShelfLifeDays * 0.10;
            } else {
                ftPenaltyDays = freezeThawCycles * material.baseShelfLifeDays * 0.02;
            }
        }

        var effectiveTotalDays = (material.baseShelfLifeDays / rate) - ftPenaltyDays;
        if (effectiveTotalDays < 1) effectiveTotalDays = 1;

        var remainingDays = effectiveTotalDays - elapsedDays;
        if (remainingDays < 0) remainingDays = 0;

        var qualityPercent = Math.max(0, Math.min(100,
            (remainingDays / effectiveTotalDays) * 100));

        var status;
        if (remainingDays <= 0) {
            status = 'expired';
        } else if (remainingDays <= config.alertThresholds.urgentDays) {
            status = 'urgent';
        } else if (remainingDays <= config.alertThresholds.warningDays) {
            status = 'warning';
        } else {
            status = 'ok';
        }

        var expirationDate = new Date(created.getTime() + effectiveTotalDays * 24 * 60 * 60 * 1000);

        return {
            batchId: batch.id,
            materialName: material.name,
            remainingDays: Math.round(remainingDays * 10) / 10,
            totalShelfLifeDays: Math.round(effectiveTotalDays * 10) / 10,
            elapsedDays: Math.round(elapsedDays * 10) / 10,
            qualityPercent: Math.round(qualityPercent * 10) / 10,
            status: status,
            effectiveRate: Math.round(rate * 1000) / 1000,
            expirationDate: expirationDate.toISOString().split('T')[0],
            freezeThawPenaltyDays: Math.round(ftPenaltyDays * 10) / 10
        };
    }

    // ── Batch management ────────────────────────────────────────

    function registerBatch(params) {
        if (!params || !params.materialId) {
            return { error: 'materialId is required' };
        }
        if (!config.materials[params.materialId]) {
            return { error: 'Unknown material: ' + params.materialId };
        }
        if (!params.volumeMl || params.volumeMl <= 0) {
            return { error: 'volumeMl must be positive' };
        }

        var batch = {
            id: nextBatchId++,
            materialId: params.materialId,
            volumeMl: params.volumeMl,
            remainingMl: params.volumeMl,
            lotNumber: params.lotNumber || null,
            supplier: params.supplier || null,
            createdDate: params.createdDate
                ? new Date(params.createdDate).toISOString()
                : new Date().toISOString(),
            conditions: params.conditions || {},
            freezeThawCycles: params.freezeThawCycles || 0,
            usageLog: [],
            notes: params.notes || null
        };

        batches.push(batch);
        return batch;
    }

    function recordUsage(batchId, volumeMl, purpose) {
        var batch = batches.find(function(b) { return b.id === batchId; });
        if (!batch) return { error: 'Batch not found: ' + batchId };
        if (volumeMl <= 0) return { error: 'Volume must be positive' };
        if (volumeMl > batch.remainingMl) {
            return { error: 'Insufficient volume. Remaining: ' + batch.remainingMl + ' mL' };
        }

        batch.remainingMl = Math.round((batch.remainingMl - volumeMl) * 100) / 100;
        batch.usageLog.push({
            date: new Date().toISOString(),
            volumeMl: volumeMl,
            purpose: purpose || null
        });

        return {
            batchId: batch.id,
            used: volumeMl,
            remaining: batch.remainingMl
        };
    }

    function recordFreezeThaw(batchId) {
        var batch = batches.find(function(b) { return b.id === batchId; });
        if (!batch) return { error: 'Batch not found: ' + batchId };

        batch.freezeThawCycles = (batch.freezeThawCycles || 0) + 1;
        var material = config.materials[batch.materialId];
        var tolerance = material ? material.freezeThawTolerance : Infinity;

        return {
            batchId: batchId,
            cycles: batch.freezeThawCycles,
            tolerance: tolerance,
            withinTolerance: batch.freezeThawCycles <= tolerance,
            warning: batch.freezeThawCycles > tolerance
                ? 'Exceeded freeze-thaw tolerance. Material integrity compromised.'
                : batch.freezeThawCycles === tolerance
                    ? 'At maximum freeze-thaw tolerance. Avoid further cycles.'
                    : null
        };
    }

    function getInventory(asOfDate) {
        var batchStatuses = batches.map(function(b) {
            var shelf = calculateShelfLife(b, asOfDate);
            return { batch: b, shelfLife: shelf };
        });

        batchStatuses.sort(function(a, b) {
            return a.shelfLife.remainingDays - b.shelfLife.remainingDays;
        });

        var expired = 0, urgent = 0, warning = 0, ok = 0;
        var totalVolumeMl = 0, totalValueUsd = 0;
        batchStatuses.forEach(function(bs) {
            if (bs.shelfLife.status === 'expired') expired++;
            else if (bs.shelfLife.status === 'urgent') urgent++;
            else if (bs.shelfLife.status === 'warning') warning++;
            else ok++;

            if (bs.shelfLife.status !== 'expired') {
                totalVolumeMl += bs.batch.remainingMl;
                var mat = config.materials[bs.batch.materialId];
                if (mat) totalValueUsd += bs.batch.remainingMl * mat.costPerMl;
            }
        });

        var alerts = batchStatuses
            .filter(function(bs) {
                return bs.shelfLife.status === 'expired' || bs.shelfLife.status === 'urgent';
            })
            .map(function(bs) {
                var mat = config.materials[bs.batch.materialId];
                return {
                    batchId: bs.batch.id,
                    materialName: mat ? mat.name : bs.batch.materialId,
                    status: bs.shelfLife.status,
                    remainingDays: bs.shelfLife.remainingDays,
                    remainingMl: bs.batch.remainingMl,
                    message: bs.shelfLife.status === 'expired'
                        ? 'EXPIRED \u2014 discard or verify quality before use'
                        : 'Expires in ' + bs.shelfLife.remainingDays + ' days \u2014 use soon'
                };
            });

        return {
            batches: batchStatuses.map(function(bs) {
                return {
                    id: bs.batch.id,
                    material: bs.shelfLife.materialName,
                    remainingMl: bs.batch.remainingMl,
                    remainingDays: bs.shelfLife.remainingDays,
                    qualityPercent: bs.shelfLife.qualityPercent,
                    status: bs.shelfLife.status,
                    expirationDate: bs.shelfLife.expirationDate,
                    lotNumber: bs.batch.lotNumber
                };
            }),
            summary: {
                totalBatches: batches.length,
                expired: expired,
                urgent: urgent,
                warning: warning,
                ok: ok,
                totalVolumeMl: Math.round(totalVolumeMl * 100) / 100,
                totalValueUsd: Math.round(totalValueUsd * 100) / 100
            },
            alerts: alerts
        };
    }

    function getStorageRecommendations(materialId) {
        var material = config.materials[materialId];
        if (!material) return { error: 'Unknown material: ' + materialId };

        var recommendations = [];

        recommendations.push({
            factor: 'Temperature',
            optimal: material.optimalTempC + '\u00b0C',
            range: material.minTempC + '\u00b0C to ' + material.maxTempC + '\u00b0C',
            impact: 'high',
            tip: 'Each 10\u00b0C above optimal increases degradation ' + material.q10 + 'x'
        });

        if (material.lightSensitivity > 0.5) {
            recommendations.push({
                factor: 'Light Protection',
                optimal: 'Dark storage (foil-wrapped)',
                impact: 'high',
                tip: 'High light sensitivity (' + (material.lightSensitivity * 100) + '%). Use amber vials or foil.'
            });
        } else if (material.lightSensitivity > 0.2) {
            recommendations.push({
                factor: 'Light Protection',
                optimal: 'Minimal light exposure',
                impact: 'medium',
                tip: 'Moderate light sensitivity. Avoid direct sunlight.'
            });
        }

        if (material.humiditySensitivity > 0.5) {
            recommendations.push({
                factor: 'Humidity Control',
                optimal: 'Below 45% RH with desiccant',
                impact: 'high',
                tip: 'Highly hygroscopic. Use desiccant packets in storage container.'
            });
        }

        if (material.freezeThawTolerance <= 3) {
            recommendations.push({
                factor: 'Freeze-Thaw',
                optimal: 'Aliquot before freezing',
                maxCycles: material.freezeThawTolerance,
                impact: 'high',
                tip: 'Very sensitive to freeze-thaw. Prepare single-use aliquots.'
            });
        }

        recommendations.push({
            factor: 'Container',
            optimal: 'Sealed, sterile container',
            impact: 'medium',
            tip: 'Open containers increase oxidation rate by ~50%'
        });

        return {
            materialName: material.name,
            category: material.category,
            baseShelfLifeDays: material.baseShelfLifeDays,
            storageNotes: material.storageNotes,
            recommendations: recommendations,
            estimatedShelfLife: {
                optimal: material.baseShelfLifeDays + ' days (under ideal conditions)',
                roomTemp: Math.round(material.baseShelfLifeDays / Math.pow(material.q10, (22 - material.optimalTempC) / 10)) + ' days (at 22\u00b0C)',
                worstCase: Math.round(material.baseShelfLifeDays / Math.pow(material.q10, (30 - material.optimalTempC) / 10) / 1.5) + ' days (30\u00b0C, open, ambient light)'
            }
        };
    }

    function getDegradationCurve(batchId, points) {
        var batch = batches.find(function(b) { return b.id === batchId; });
        if (!batch) return { error: 'Batch not found: ' + batchId };

        var material = config.materials[batch.materialId];
        if (!material) return { error: 'Unknown material' };

        points = points || 12;
        var rate = degradationMultiplier(material, batch.conditions || {});
        var totalDays = material.baseShelfLifeDays / rate;
        var interval = totalDays / (points - 1);

        var curve = [];
        for (var i = 0; i < points; i++) {
            var day = Math.round(i * interval);
            var quality = Math.max(0, 100 * (1 - day / totalDays));
            var status;
            var remaining = totalDays - day;
            if (remaining <= 0) status = 'expired';
            else if (remaining <= config.alertThresholds.urgentDays) status = 'urgent';
            else if (remaining <= config.alertThresholds.warningDays) status = 'warning';
            else status = 'ok';

            curve.push({
                day: day,
                qualityPercent: Math.round(quality * 10) / 10,
                status: status
            });
        }

        return {
            batchId: batchId,
            materialName: material.name,
            effectiveShelfLifeDays: Math.round(totalDays * 10) / 10,
            curve: curve
        };
    }

    function getMaterials() {
        var result = [];
        for (var id in config.materials) {
            var m = config.materials[id];
            result.push({
                id: id,
                name: m.name,
                category: m.category,
                baseShelfLifeDays: m.baseShelfLifeDays,
                optimalTempC: m.optimalTempC,
                costPerMl: m.costPerMl,
                storageNotes: m.storageNotes
            });
        }
        return result;
    }

    function clearBatches() {
        batches = [];
        nextBatchId = 1;
    }

    // ── Public API ──────────────────────────────────────────────

    return {
        registerBatch: registerBatch,
        recordUsage: recordUsage,
        recordFreezeThaw: recordFreezeThaw,
        calculateShelfLife: calculateShelfLife,
        getInventory: getInventory,
        getStorageRecommendations: getStorageRecommendations,
        getDegradationCurve: getDegradationCurve,
        getMaterials: getMaterials,
        clearBatches: clearBatches,
        degradationMultiplier: degradationMultiplier
    };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createShelfLifeTracker: createShelfLifeTracker };
}
