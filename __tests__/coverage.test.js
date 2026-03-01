/**
 * Tests for Experiment Coverage Map (docs/coverage.html)
 *
 * Tests the core grid computation, color mapping, gap detection,
 * and gap scoring logic extracted from coverage.html.
 */

// ── Shared constants (subset from shared/constants.js) ──

var metricLabels = {
    livePercent:  'Live Cell %',
    deadPercent:  'Dead Cell %',
    elasticity:   'Elasticity (kPa)',
    cl_duration:  'CL Duration (ms)',
    cl_intensity: 'CL Intensity (%)',
    extruder1:    'Extruder 1 Pressure',
    extruder2:    'Extruder 2 Pressure',
    layerHeight:  'Layer Height (mm)',
    layerNum:     'Layer Count'
};

// ── Metric accessor ──

function getMetricValue(print, metric) {
    var paths = {
        livePercent:  function(p) { return p.print_data.livePercent; },
        deadPercent:  function(p) { return p.print_data.deadPercent; },
        elasticity:   function(p) { return p.print_data.elasticity; },
        cl_duration:  function(p) { return p.print_info.crosslinking.cl_duration; },
        cl_intensity: function(p) { return p.print_info.crosslinking.cl_intensity; },
        extruder1:    function(p) { return p.print_info.pressure.extruder1; },
        extruder2:    function(p) { return p.print_info.pressure.extruder2; },
        layerHeight:  function(p) { return p.print_info.resolution.layerHeight; },
        layerNum:     function(p) { return p.print_info.resolution.layerNum; },
    };
    return paths[metric] ? paths[metric](print) : null;
}

// ── Core functions (extracted from coverage.html) ──

function formatNum(n) {
    if (n == null) return '-';
    if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(2);
}

function buildGrid(printData, xKey, yKey, colorKey, binsX, binsY) {
    var points = [];
    for (var i = 0; i < printData.length; i++) {
        var xv = getMetricValue(printData[i], xKey);
        var yv = getMetricValue(printData[i], yKey);
        if (xv == null || yv == null || isNaN(xv) || isNaN(yv)) continue;
        var cv = null;
        if (colorKey !== 'count') {
            cv = getMetricValue(printData[i], colorKey);
        }
        points.push({ x: xv, y: yv, c: cv });
    }

    if (points.length === 0) return null;

    var xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
    for (var j = 0; j < points.length; j++) {
        if (points[j].x < xMin) xMin = points[j].x;
        if (points[j].x > xMax) xMax = points[j].x;
        if (points[j].y < yMin) yMin = points[j].y;
        if (points[j].y > yMax) yMax = points[j].y;
    }

    var xPad = (xMax - xMin) * 0.001 || 1;
    var yPad = (yMax - yMin) * 0.001 || 1;
    xMax += xPad;
    yMax += yPad;

    var xStep = (xMax - xMin) / binsX;
    var yStep = (yMax - yMin) / binsY;

    var grid = [];
    for (var r = 0; r < binsY; r++) {
        var row = [];
        for (var ci = 0; ci < binsX; ci++) {
            row.push({ count: 0, colorSum: 0, colorCount: 0 });
        }
        grid.push(row);
    }

    for (var k = 0; k < points.length; k++) {
        var xi = Math.min(Math.floor((points[k].x - xMin) / xStep), binsX - 1);
        var yi = Math.min(Math.floor((points[k].y - yMin) / yStep), binsY - 1);
        grid[yi][xi].count++;
        if (points[k].c != null && !isNaN(points[k].c)) {
            grid[yi][xi].colorSum += points[k].c;
            grid[yi][xi].colorCount++;
        }
    }

    var cMin = Infinity, cMax = -Infinity;
    var covered = 0, gaps = 0;
    var bestVal = -Infinity, bestR = 0, bestC = 0;

    for (var gy = 0; gy < binsY; gy++) {
        for (var gx = 0; gx < binsX; gx++) {
            var cell = grid[gy][gx];
            if (cell.count > 0) {
                covered++;
                var val;
                if (colorKey === 'count') {
                    val = cell.count;
                } else {
                    val = cell.colorCount > 0 ? cell.colorSum / cell.colorCount : 0;
                }
                cell.value = val;
                if (val < cMin) cMin = val;
                if (val > cMax) cMax = val;
                if (val > bestVal) { bestVal = val; bestR = gy; bestC = gx; }
            } else {
                gaps++;
                cell.value = null;
            }
        }
    }

    return {
        grid: grid,
        binsX: binsX, binsY: binsY,
        xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax,
        xStep: xStep, yStep: yStep,
        cMin: cMin, cMax: cMax,
        covered: covered, gaps: gaps, totalCells: binsX * binsY,
        bestR: bestR, bestC: bestC, bestVal: bestVal,
        xKey: xKey, yKey: yKey, colorKey: colorKey
    };
}

function heatColor(value, min, max, isEmpty) {
    if (isEmpty) return '#1a1a2e';
    if (max === min) return 'rgb(56, 189, 248)';
    var t = (value - min) / (max - min);
    var r, g, b;
    if (t < 0.25) {
        r = 15; g = Math.round(40 + t * 4 * 160); b = Math.round(100 + t * 4 * 155);
    } else if (t < 0.5) {
        var u = (t - 0.25) * 4;
        r = Math.round(u * 100); g = 200; b = Math.round(255 - u * 200);
    } else if (t < 0.75) {
        var v = (t - 0.5) * 4;
        r = Math.round(100 + v * 155); g = Math.round(200 - v * 50); b = Math.round(55 - v * 55);
    } else {
        var w = (t - 0.75) * 4;
        r = 255; g = Math.round(150 - w * 150); b = 0;
    }
    return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function findGapScores(gridData) {
    var d = gridData;
    var gapScores = [];
    for (var r = 0; r < d.binsY; r++) {
        for (var c = 0; c < d.binsX; c++) {
            if (d.grid[r][c].count > 0) continue;
            var nSum = 0, nCount = 0;
            var neighbors = [[-1,0],[1,0],[0,-1],[0,1]];
            for (var n = 0; n < neighbors.length; n++) {
                var nr = r + neighbors[n][0], nc = c + neighbors[n][1];
                if (nr >= 0 && nr < d.binsY && nc >= 0 && nc < d.binsX && d.grid[nr][nc].count > 0) {
                    nSum += d.grid[nr][nc].value;
                    nCount++;
                }
            }
            if (nCount > 0) {
                gapScores.push({ r: r, c: c, score: nSum / nCount, neighbors: nCount });
            }
        }
    }
    gapScores.sort(function (a, b) { return b.score - a.score; });
    return gapScores;
}

// ── Test data factory ──

function makePrint(ext1, clDur, live, dead, elast) {
    return {
        print_data: { livePercent: live || 50, deadPercent: dead || 50, elasticity: elast || 30 },
        print_info: {
            crosslinking: { cl_duration: clDur, cl_enabled: true, cl_intensity: 50 },
            pressure: { extruder1: ext1, extruder2: 50 },
            resolution: { layerHeight: 0.5, layerNum: 10 },
            wellplate: 6
        },
        user_info: { email: 'test@test.com', serial: 0 }
    };
}

// ── Tests ──

describe('Coverage Map — buildGrid', function () {
    test('returns null for empty data', function () {
        var result = buildGrid([], 'extruder1', 'cl_duration', 'count', 5, 5);
        expect(result).toBeNull();
    });

    test('single point produces one covered cell', function () {
        var data = [makePrint(50, 1000, 80, 20, 40)];
        var result = buildGrid(data, 'extruder1', 'cl_duration', 'count', 3, 3);
        expect(result.covered).toBe(1);
        expect(result.gaps).toBe(8);
        expect(result.totalCells).toBe(9);
    });

    test('totalCells equals binsX * binsY', function () {
        var data = [makePrint(50, 1000)];
        var result = buildGrid(data, 'extruder1', 'cl_duration', 'count', 10, 8);
        expect(result.totalCells).toBe(80);
    });

    test('all points in same bin counted correctly', function () {
        var data = [
            makePrint(50, 1000),
            makePrint(50, 1000),
            makePrint(50, 1000),
        ];
        var result = buildGrid(data, 'extruder1', 'cl_duration', 'count', 3, 3);
        expect(result.covered).toBe(1);
        // Find the non-empty cell
        var found = false;
        for (var r = 0; r < 3; r++) {
            for (var c = 0; c < 3; c++) {
                if (result.grid[r][c].count === 3) found = true;
            }
        }
        expect(found).toBe(true);
    });

    test('spread data covers multiple cells', function () {
        var data = [
            makePrint(10, 100),
            makePrint(50, 500),
            makePrint(90, 900),
        ];
        var result = buildGrid(data, 'extruder1', 'cl_duration', 'count', 3, 3);
        expect(result.covered).toBeGreaterThanOrEqual(2);
    });

    test('color by livePercent computes average', function () {
        var data = [
            makePrint(50, 1000, 80),
            makePrint(50, 1000, 60),
        ];
        var result = buildGrid(data, 'extruder1', 'cl_duration', 'livePercent', 3, 3);
        // Find the non-empty cell
        var cell = null;
        for (var r = 0; r < 3; r++) {
            for (var c = 0; c < 3; c++) {
                if (result.grid[r][c].count > 0) cell = result.grid[r][c];
            }
        }
        expect(cell).not.toBeNull();
        expect(cell.value).toBeCloseTo(70, 1); // (80+60)/2
    });

    test('color by count uses raw count', function () {
        var data = [
            makePrint(50, 1000),
            makePrint(50, 1000),
            makePrint(50, 1000),
            makePrint(50, 1000),
            makePrint(50, 1000),
        ];
        var result = buildGrid(data, 'extruder1', 'cl_duration', 'count', 3, 3);
        expect(result.bestVal).toBe(5);
    });

    test('bestVal tracks the maximum cell value', function () {
        var data = [
            makePrint(10, 100, 90), // high live %
            makePrint(90, 900, 30), // low live %
        ];
        var result = buildGrid(data, 'extruder1', 'cl_duration', 'livePercent', 5, 5);
        expect(result.bestVal).toBe(90);
    });

    test('coverage percentage computed correctly', function () {
        var data = [
            makePrint(10, 100),
            makePrint(90, 900),
        ];
        var result = buildGrid(data, 'extruder1', 'cl_duration', 'count', 4, 4);
        var pct = result.covered / result.totalCells * 100;
        expect(pct).toBeGreaterThan(0);
        expect(pct).toBeLessThan(100);
    });

    test('handles identical values without crashing', function () {
        var data = [
            makePrint(50, 500),
            makePrint(50, 500),
        ];
        var result = buildGrid(data, 'extruder1', 'cl_duration', 'count', 3, 3);
        expect(result.covered).toBe(1);
        expect(result.totalCells).toBe(9);
    });

    test('skips records with null metric values', function () {
        var data = [
            makePrint(50, 1000),
            { print_data: { livePercent: null }, print_info: { crosslinking: {}, pressure: {}, resolution: {} }, user_info: {} },
        ];
        var result = buildGrid(data, 'extruder1', 'cl_duration', 'count', 3, 3);
        expect(result.covered).toBe(1);
    });

    test('grid dimensions match bins', function () {
        var data = [makePrint(50, 500)];
        var result = buildGrid(data, 'extruder1', 'cl_duration', 'count', 7, 4);
        expect(result.grid.length).toBe(4); // binsY rows
        expect(result.grid[0].length).toBe(7); // binsX cols
    });
});

describe('Coverage Map — heatColor', function () {
    test('empty cells return dark color', function () {
        expect(heatColor(null, 0, 100, true)).toBe('#1a1a2e');
    });

    test('equal min/max returns accent color', function () {
        expect(heatColor(50, 50, 50, false)).toBe('rgb(56, 189, 248)');
    });

    test('returns valid rgb strings for different intensities', function () {
        var colors = [
            heatColor(0, 0, 100, false),
            heatColor(25, 0, 100, false),
            heatColor(50, 0, 100, false),
            heatColor(75, 0, 100, false),
            heatColor(100, 0, 100, false),
        ];
        for (var i = 0; i < colors.length; i++) {
            expect(colors[i]).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
        }
    });

    test('lowest value is cool (high blue component)', function () {
        var color = heatColor(0, 0, 100, false);
        var parts = color.match(/\d+/g).map(Number);
        // Blue should be dominant at low end
        expect(parts[2]).toBeGreaterThan(parts[0]);
    });

    test('highest value is warm (high red component)', function () {
        var color = heatColor(100, 0, 100, false);
        var parts = color.match(/\d+/g).map(Number);
        // Red should be 255 at high end
        expect(parts[0]).toBe(255);
    });

    test('mid values have green component', function () {
        var color = heatColor(50, 0, 100, false);
        var parts = color.match(/\d+/g).map(Number);
        expect(parts[1]).toBeGreaterThan(100); // green should be significant
    });
});

describe('Coverage Map — findGapScores', function () {
    test('no gaps returns empty array', function () {
        // 2x2 grid fully covered
        var data = [
            makePrint(10, 100, 50),
            makePrint(90, 100, 60),
            makePrint(10, 900, 70),
            makePrint(90, 900, 80),
        ];
        var gd = buildGrid(data, 'extruder1', 'cl_duration', 'livePercent', 2, 2);
        if (gd.gaps === 0) {
            var scores = findGapScores(gd);
            expect(scores.length).toBe(0);
        }
    });

    test('gaps are scored by neighbor average', function () {
        // Create sparse data with known gaps
        var data = [
            makePrint(10, 100, 90),
            makePrint(90, 900, 30),
        ];
        var gd = buildGrid(data, 'extruder1', 'cl_duration', 'livePercent', 4, 4);
        var scores = findGapScores(gd);
        // Should have gaps with scores
        if (scores.length > 0) {
            // Scores should be sorted descending
            for (var i = 1; i < scores.length; i++) {
                expect(scores[i].score).toBeLessThanOrEqual(scores[i - 1].score);
            }
        }
    });

    test('isolated gaps (no neighbors) are excluded', function () {
        // Single point in corner of large grid — interior gaps have no neighbors
        var data = [makePrint(10, 100)];
        var gd = buildGrid(data, 'extruder1', 'cl_duration', 'count', 10, 10);
        var scores = findGapScores(gd);
        // Only gaps adjacent to the one occupied cell should appear
        expect(scores.length).toBeLessThan(gd.gaps);
    });

    test('gap scores have required properties', function () {
        var data = [makePrint(50, 500, 75)];
        var gd = buildGrid(data, 'extruder1', 'cl_duration', 'livePercent', 5, 5);
        var scores = findGapScores(gd);
        if (scores.length > 0) {
            expect(scores[0]).toHaveProperty('r');
            expect(scores[0]).toHaveProperty('c');
            expect(scores[0]).toHaveProperty('score');
            expect(scores[0]).toHaveProperty('neighbors');
            expect(scores[0].neighbors).toBeGreaterThan(0);
        }
    });
});

describe('Coverage Map — formatNum', function () {
    test('null returns dash', function () {
        expect(formatNum(null)).toBe('-');
    });

    test('undefined returns dash', function () {
        expect(formatNum(undefined)).toBe('-');
    });

    test('integer formatted without decimals', function () {
        expect(formatNum(42)).toBe('42');
    });

    test('float formatted to 2 decimals', function () {
        expect(formatNum(3.14159)).toBe('3.14');
    });

    test('large number uses locale formatting', function () {
        var result = formatNum(10000);
        expect(result).toMatch(/10/); // at least contains 10
    });
});
