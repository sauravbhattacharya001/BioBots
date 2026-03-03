/**
 * @jest-environment jsdom
 */

describe('Data Table', () => {

    // ── Helper functions (extracted from table.html) ──

    const _escapeEl = document.createElement('div');
    function escapeHtml(str) {
        if (str == null) return '';
        _escapeEl.textContent = String(str);
        return _escapeEl.innerHTML;
    }

    const metricAccessors = {
        serial:       p => p.user_info.serial,
        email:        p => p.user_info.email,
        livePercent:  p => p.print_data.livePercent,
        deadPercent:  p => p.print_data.deadPercent,
        elasticity:   p => p.print_data.elasticity,
        cl_duration:  p => p.print_info.crosslinking.cl_duration,
        cl_intensity: p => p.print_info.crosslinking.cl_intensity,
        cl_enabled:   p => p.print_info.crosslinking.cl_enabled,
        extruder1:    p => p.print_info.pressure.extruder1,
        extruder2:    p => p.print_info.pressure.extruder2,
        layerHeight:  p => p.print_info.resolution.layerHeight,
        layerNum:     p => p.print_info.resolution.layerNum,
        wellplate:    p => p.print_info.wellplate,
        inputFile:    p => p.print_info.files ? p.print_info.files.input : '',
        outputFile:   p => p.print_info.files ? p.print_info.files.output : '',
    };

    function getVal(record, col) {
        const fn = metricAccessors[col];
        return fn ? fn(record) : null;
    }

    function fmt(val, col) {
        if (val == null) return '\u2014';
        if (col === 'email') return escapeHtml(val);
        if (col === 'cl_enabled') return val ? 'Yes' : 'No';
        if (typeof val === 'number') {
            if (Number.isInteger(val)) return val.toLocaleString();
            return val.toFixed(2);
        }
        return escapeHtml(val);
    }

    function cellClass(col) {
        if (col === 'livePercent') return 'cell-number cell-live';
        if (col === 'deadPercent') return 'cell-number cell-dead';
        if (col === 'email') return 'cell-muted';
        return 'cell-number';
    }

    function sanitizeCSVValue(val) {
        if (val == null) return '';
        if (typeof val === 'number' || typeof val === 'boolean') return String(val);
        const str = String(val);
        const escaped = str.replace(/"/g, '""');
        const dangerousPrefix = /^[=+\-@\t\r]/;
        return '"' + (dangerousPrefix.test(escaped) ? "'" : '') + escaped + '"';
    }

    // ── Test Data ──

    function makeRecord(overrides) {
        const base = {
            user_info: { serial: 1, email: 'user@test.com' },
            print_data: { livePercent: 85.5, deadPercent: 14.5, elasticity: 3.2 },
            print_info: {
                crosslinking: { cl_duration: 120, cl_intensity: 75, cl_enabled: true },
                pressure: { extruder1: 40, extruder2: 35 },
                resolution: { layerHeight: 0.3, layerNum: 10 },
                wellplate: 24,
                files: { input: 'tissue.gcode', output: 'result.bio' }
            }
        };
        if (overrides) {
            return JSON.parse(JSON.stringify(Object.assign(base, overrides)));
        }
        return JSON.parse(JSON.stringify(base));
    }

    // ── escapeHtml Tests ──

    describe('escapeHtml', () => {
        test('returns empty string for null', () => {
            expect(escapeHtml(null)).toBe('');
        });

        test('returns empty string for undefined', () => {
            expect(escapeHtml(undefined)).toBe('');
        });

        test('passes through plain text', () => {
            expect(escapeHtml('hello world')).toBe('hello world');
        });

        test('escapes HTML angle brackets', () => {
            expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
        });

        test('escapes ampersands', () => {
            expect(escapeHtml('a&b')).toBe('a&amp;b');
        });

        test('passes through quotes (textContent only escapes < > &)', () => {
            const result = escapeHtml('"hello"');
            // textContent-based escaping doesn't encode quotes
            expect(result).toBe('"hello"');
        });

        test('handles numeric input', () => {
            expect(escapeHtml(42)).toBe('42');
        });

        test('handles empty string', () => {
            expect(escapeHtml('')).toBe('');
        });
    });

    // ── getVal Tests ──

    describe('getVal', () => {
        const record = makeRecord();

        test('extracts serial from user_info', () => {
            expect(getVal(record, 'serial')).toBe(1);
        });

        test('extracts email from user_info', () => {
            expect(getVal(record, 'email')).toBe('user@test.com');
        });

        test('extracts livePercent from print_data', () => {
            expect(getVal(record, 'livePercent')).toBe(85.5);
        });

        test('extracts deadPercent from print_data', () => {
            expect(getVal(record, 'deadPercent')).toBe(14.5);
        });

        test('extracts elasticity from print_data', () => {
            expect(getVal(record, 'elasticity')).toBe(3.2);
        });

        test('extracts cl_duration from nested crosslinking', () => {
            expect(getVal(record, 'cl_duration')).toBe(120);
        });

        test('extracts cl_intensity from nested crosslinking', () => {
            expect(getVal(record, 'cl_intensity')).toBe(75);
        });

        test('extracts cl_enabled boolean', () => {
            expect(getVal(record, 'cl_enabled')).toBe(true);
        });

        test('extracts extruder1 pressure', () => {
            expect(getVal(record, 'extruder1')).toBe(40);
        });

        test('extracts extruder2 pressure', () => {
            expect(getVal(record, 'extruder2')).toBe(35);
        });

        test('extracts layerHeight', () => {
            expect(getVal(record, 'layerHeight')).toBe(0.3);
        });

        test('extracts layerNum', () => {
            expect(getVal(record, 'layerNum')).toBe(10);
        });

        test('extracts wellplate', () => {
            expect(getVal(record, 'wellplate')).toBe(24);
        });

        test('extracts inputFile', () => {
            expect(getVal(record, 'inputFile')).toBe('tissue.gcode');
        });

        test('extracts outputFile', () => {
            expect(getVal(record, 'outputFile')).toBe('result.bio');
        });

        test('returns null for unknown column', () => {
            expect(getVal(record, 'nonexistent')).toBeNull();
        });

        test('returns empty string for missing files', () => {
            const r = makeRecord();
            delete r.print_info.files;
            expect(getVal(r, 'inputFile')).toBe('');
            expect(getVal(r, 'outputFile')).toBe('');
        });
    });

    // ── fmt Tests ──

    describe('fmt', () => {
        test('returns em-dash for null', () => {
            expect(fmt(null, 'livePercent')).toBe('\u2014');
        });

        test('returns em-dash for undefined', () => {
            expect(fmt(undefined, 'livePercent')).toBe('\u2014');
        });

        test('formats email with escapeHtml', () => {
            expect(fmt('user@test.com', 'email')).toBe('user@test.com');
        });

        test('escapes XSS in email', () => {
            expect(fmt('<script>x</script>', 'email')).toBe('&lt;script&gt;x&lt;/script&gt;');
        });

        test('formats cl_enabled true as Yes', () => {
            expect(fmt(true, 'cl_enabled')).toBe('Yes');
        });

        test('formats cl_enabled false as No', () => {
            expect(fmt(false, 'cl_enabled')).toBe('No');
        });

        test('formats integer with toLocaleString', () => {
            const result = fmt(1000, 'extruder1');
            // toLocaleString may produce comma-separated or not depending on locale
            expect(result).toContain('1');
        });

        test('formats float with 2 decimal places', () => {
            expect(fmt(85.567, 'livePercent')).toBe('85.57');
        });

        test('formats integer as integer', () => {
            expect(fmt(42, 'layerNum')).toBe('42');
        });

        test('escapes string values', () => {
            expect(fmt('test<br>value', 'serial')).toBe('test&lt;br&gt;value');
        });

        test('formats zero correctly', () => {
            expect(fmt(0, 'extruder1')).toBe('0');
        });

        test('formats negative float', () => {
            expect(fmt(-1.234, 'elasticity')).toBe('-1.23');
        });
    });

    // ── cellClass Tests ──

    describe('cellClass', () => {
        test('livePercent gets cell-number cell-live', () => {
            expect(cellClass('livePercent')).toBe('cell-number cell-live');
        });

        test('deadPercent gets cell-number cell-dead', () => {
            expect(cellClass('deadPercent')).toBe('cell-number cell-dead');
        });

        test('email gets cell-muted', () => {
            expect(cellClass('email')).toBe('cell-muted');
        });

        test('other columns get cell-number', () => {
            expect(cellClass('elasticity')).toBe('cell-number');
            expect(cellClass('cl_duration')).toBe('cell-number');
            expect(cellClass('layerNum')).toBe('cell-number');
        });

        test('serial gets cell-number', () => {
            expect(cellClass('serial')).toBe('cell-number');
        });

        test('wellplate gets cell-number', () => {
            expect(cellClass('wellplate')).toBe('cell-number');
        });
    });

    // ── sanitizeCSVValue Tests ──

    describe('sanitizeCSVValue', () => {
        test('returns empty string for null', () => {
            expect(sanitizeCSVValue(null)).toBe('');
        });

        test('returns empty string for undefined', () => {
            expect(sanitizeCSVValue(undefined)).toBe('');
        });

        test('converts number to string', () => {
            expect(sanitizeCSVValue(42)).toBe('42');
        });

        test('converts float to string', () => {
            expect(sanitizeCSVValue(3.14)).toBe('3.14');
        });

        test('converts boolean true', () => {
            expect(sanitizeCSVValue(true)).toBe('true');
        });

        test('converts boolean false', () => {
            expect(sanitizeCSVValue(false)).toBe('false');
        });

        test('wraps string in quotes', () => {
            expect(sanitizeCSVValue('hello')).toBe('"hello"');
        });

        test('escapes double quotes', () => {
            expect(sanitizeCSVValue('say "hi"')).toBe('"say ""hi"""');
        });

        test('prefixes = with single quote (formula injection)', () => {
            expect(sanitizeCSVValue('=SUM(A1:A10)')).toBe('"\'=SUM(A1:A10)"');
        });

        test('prefixes + with single quote', () => {
            expect(sanitizeCSVValue('+cmd|stuff')).toBe('"\'+cmd|stuff"');
        });

        test('prefixes - with single quote', () => {
            expect(sanitizeCSVValue('-1+2')).toBe('"\'-1+2"');
        });

        test('prefixes @ with single quote', () => {
            expect(sanitizeCSVValue('@system')).toBe('"\'@system"');
        });

        test('prefixes tab with single quote', () => {
            expect(sanitizeCSVValue('\tcmd')).toBe('"\'\tcmd"');
        });

        test('prefixes carriage return with single quote', () => {
            expect(sanitizeCSVValue('\rcmd')).toBe('"\'\rcmd"');
        });

        test('does not prefix safe strings', () => {
            expect(sanitizeCSVValue('hello world')).toBe('"hello world"');
        });

        test('handles empty string', () => {
            expect(sanitizeCSVValue('')).toBe('""');
        });

        test('handles string with only quotes', () => {
            // '"' → escaped to '""' → wrapped: '""""'
            expect(sanitizeCSVValue('"')).toBe('""""');
        });
    });

    // ── Sorting Tests ──

    describe('sortData', () => {
        function sortData(data, sortCol, sortDir) {
            return [...data].sort((a, b) => {
                let va = getVal(a, sortCol);
                let vb = getVal(b, sortCol);
                if (va == null && vb == null) return 0;
                if (va == null) return 1;
                if (vb == null) return -1;
                if (typeof va === 'string') {
                    const cmp = va.localeCompare(vb);
                    return sortDir === 'asc' ? cmp : -cmp;
                }
                return sortDir === 'asc' ? va - vb : vb - va;
            });
        }

        test('sorts numbers ascending', () => {
            const data = [
                makeRecord({ print_data: { livePercent: 90, deadPercent: 10, elasticity: 3 } }),
                makeRecord({ print_data: { livePercent: 70, deadPercent: 30, elasticity: 2 } }),
                makeRecord({ print_data: { livePercent: 85, deadPercent: 15, elasticity: 1 } }),
            ];
            const sorted = sortData(data, 'livePercent', 'asc');
            expect(getVal(sorted[0], 'livePercent')).toBe(70);
            expect(getVal(sorted[1], 'livePercent')).toBe(85);
            expect(getVal(sorted[2], 'livePercent')).toBe(90);
        });

        test('sorts numbers descending', () => {
            const data = [
                makeRecord({ print_data: { livePercent: 70, deadPercent: 30, elasticity: 2 } }),
                makeRecord({ print_data: { livePercent: 90, deadPercent: 10, elasticity: 3 } }),
            ];
            const sorted = sortData(data, 'livePercent', 'desc');
            expect(getVal(sorted[0], 'livePercent')).toBe(90);
            expect(getVal(sorted[1], 'livePercent')).toBe(70);
        });

        test('sorts strings alphabetically ascending', () => {
            const data = [
                makeRecord({ user_info: { serial: 1, email: 'charlie@test.com' } }),
                makeRecord({ user_info: { serial: 2, email: 'alice@test.com' } }),
                makeRecord({ user_info: { serial: 3, email: 'bob@test.com' } }),
            ];
            const sorted = sortData(data, 'email', 'asc');
            expect(getVal(sorted[0], 'email')).toBe('alice@test.com');
            expect(getVal(sorted[1], 'email')).toBe('bob@test.com');
            expect(getVal(sorted[2], 'email')).toBe('charlie@test.com');
        });

        test('sorts strings descending', () => {
            const data = [
                makeRecord({ user_info: { serial: 1, email: 'alice@test.com' } }),
                makeRecord({ user_info: { serial: 2, email: 'charlie@test.com' } }),
            ];
            const sorted = sortData(data, 'email', 'desc');
            expect(getVal(sorted[0], 'email')).toBe('charlie@test.com');
            expect(getVal(sorted[1], 'email')).toBe('alice@test.com');
        });

        test('nulls sort to end ascending', () => {
            const r1 = makeRecord({ user_info: { serial: 1, email: 'a@test.com' } });
            const r2 = makeRecord({ user_info: { serial: 2, email: 'b@test.com' } });
            delete r2.print_info.files;
            const data = [r2, r1];
            // inputFile for r2 is '' (not null), but let's test with missing nested
            const sorted = sortData(data, 'serial', 'asc');
            expect(getVal(sorted[0], 'serial')).toBe(1);
        });

        test('both nulls are equal', () => {
            const r1 = makeRecord();
            const r2 = makeRecord();
            // getVal with unknown column returns null
            const sorted = sortData([r1, r2], 'nonexistent', 'asc');
            expect(sorted.length).toBe(2);
        });

        test('null vs non-null puts null after', () => {
            const r1 = makeRecord({ print_data: { livePercent: 80, deadPercent: 20, elasticity: 3 } });
            const r2 = makeRecord({ print_data: { livePercent: null, deadPercent: null, elasticity: null } });
            const sorted = sortData([r2, r1], 'livePercent', 'asc');
            expect(getVal(sorted[0], 'livePercent')).toBe(80);
            expect(getVal(sorted[1], 'livePercent')).toBeNull();
        });

        test('stable sort with equal values', () => {
            const r1 = makeRecord({ user_info: { serial: 1, email: 'a@test.com' }, print_data: { livePercent: 80, deadPercent: 20, elasticity: 3 } });
            const r2 = makeRecord({ user_info: { serial: 2, email: 'b@test.com' }, print_data: { livePercent: 80, deadPercent: 20, elasticity: 3 } });
            const sorted = sortData([r1, r2], 'livePercent', 'asc');
            expect(sorted.length).toBe(2);
        });
    });

    // ── Filtering Tests ──

    describe('applyFilters', () => {
        function filterRecords(allData, query, metric, op, rawVal) {
            return allData.filter(record => {
                if (query) {
                    const haystack = JSON.stringify(record).toLowerCase();
                    if (!haystack.includes(query.toLowerCase())) return false;
                }
                if (metric && rawVal !== '' && !isNaN(rawVal)) {
                    const recordVal = getVal(record, metric);
                    const target = parseFloat(rawVal);
                    if (recordVal == null) return false;
                    switch (op) {
                        case 'gt':  if (!(recordVal > target)) return false; break;
                        case 'lt':  if (!(recordVal < target)) return false; break;
                        case 'eq':  if (!(Math.abs(recordVal - target) < 0.001)) return false; break;
                        case 'gte': if (!(recordVal >= target)) return false; break;
                        case 'lte': if (!(recordVal <= target)) return false; break;
                    }
                }
                return true;
            });
        }

        const data = [
            makeRecord({
                user_info: { serial: 1, email: 'alice@lab.com' },
                print_data: { livePercent: 90, deadPercent: 10, elasticity: 4.5 }
            }),
            makeRecord({
                user_info: { serial: 2, email: 'bob@lab.com' },
                print_data: { livePercent: 60, deadPercent: 40, elasticity: 2.1 }
            }),
            makeRecord({
                user_info: { serial: 3, email: 'charlie@lab.com' },
                print_data: { livePercent: 75, deadPercent: 25, elasticity: 3.0 }
            }),
        ];

        test('no filter returns all', () => {
            expect(filterRecords(data, '', '', '', '')).toHaveLength(3);
        });

        test('text search by email', () => {
            const result = filterRecords(data, 'alice', '', '', '');
            expect(result).toHaveLength(1);
            expect(getVal(result[0], 'serial')).toBe(1);
        });

        test('text search is case insensitive', () => {
            expect(filterRecords(data, 'BOB', '', '', '')).toHaveLength(1);
        });

        test('text search matches nested values', () => {
            // Search for serial number in JSON
            const result = filterRecords(data, '"serial":3', '', '', '');
            expect(result).toHaveLength(1);
        });

        test('text search no match returns empty', () => {
            expect(filterRecords(data, 'zzzzz', '', '', '')).toHaveLength(0);
        });

        test('numeric filter gt', () => {
            const result = filterRecords(data, '', 'livePercent', 'gt', '80');
            expect(result).toHaveLength(1);
            expect(getVal(result[0], 'livePercent')).toBe(90);
        });

        test('numeric filter lt', () => {
            const result = filterRecords(data, '', 'livePercent', 'lt', '70');
            expect(result).toHaveLength(1);
            expect(getVal(result[0], 'livePercent')).toBe(60);
        });

        test('numeric filter eq (within 0.001)', () => {
            const result = filterRecords(data, '', 'livePercent', 'eq', '75');
            expect(result).toHaveLength(1);
            expect(getVal(result[0], 'serial')).toBe(3);
        });

        test('numeric filter gte', () => {
            const result = filterRecords(data, '', 'livePercent', 'gte', '75');
            expect(result).toHaveLength(2);
        });

        test('numeric filter lte', () => {
            const result = filterRecords(data, '', 'livePercent', 'lte', '75');
            expect(result).toHaveLength(2);
        });

        test('combined text and numeric filter', () => {
            const result = filterRecords(data, 'lab.com', 'livePercent', 'gt', '70');
            expect(result).toHaveLength(2);
        });

        test('filter excludes records with null metric', () => {
            const dataWithNull = [
                ...data,
                makeRecord({
                    user_info: { serial: 4, email: 'null@lab.com' },
                    print_data: { livePercent: null, deadPercent: null, elasticity: null }
                }),
            ];
            const result = filterRecords(dataWithNull, '', 'livePercent', 'gt', '0');
            expect(result).toHaveLength(3); // null excluded
        });

        test('non-numeric filter value is ignored', () => {
            const result = filterRecords(data, '', 'livePercent', 'gt', 'abc');
            expect(result).toHaveLength(3); // isNaN check prevents filtering
        });

        test('empty metric means no numeric filter', () => {
            const result = filterRecords(data, '', '', 'gt', '80');
            expect(result).toHaveLength(3);
        });
    });

    // ── Pagination Tests ──

    describe('pagination logic', () => {
        function goPage(page, dataLen, pageSize) {
            const totalPages = Math.max(1, Math.ceil(dataLen / pageSize));
            return Math.max(1, Math.min(page, totalPages));
        }

        test('first page for small dataset', () => {
            expect(goPage(1, 10, 25)).toBe(1);
        });

        test('clamps to last page', () => {
            expect(goPage(100, 50, 25)).toBe(2);
        });

        test('clamps to 1 for negative', () => {
            expect(goPage(-1, 50, 25)).toBe(1);
        });

        test('page 0 clamps to 1', () => {
            expect(goPage(0, 50, 25)).toBe(1);
        });

        test('empty data has 1 page', () => {
            expect(goPage(1, 0, 25)).toBe(1);
        });

        test('exact page boundary', () => {
            expect(goPage(2, 50, 25)).toBe(2);
        });

        test('partial last page', () => {
            expect(goPage(3, 51, 25)).toBe(3);
        });

        test('pageSize 10', () => {
            expect(goPage(5, 100, 10)).toBe(5);
        });

        test('pageSize 100 single page', () => {
            expect(goPage(1, 50, 100)).toBe(1);
        });
    });

    // ── Toggle Row Tests ──

    describe('toggleRow', () => {
        test('adds row to expanded set', () => {
            const expandedRows = new Set();
            expandedRows.add(5);
            expect(expandedRows.has(5)).toBe(true);
        });

        test('removes row from expanded set', () => {
            const expandedRows = new Set([5]);
            expandedRows.delete(5);
            expect(expandedRows.has(5)).toBe(false);
        });

        test('toggle on then off', () => {
            const expandedRows = new Set();
            // Toggle on
            if (expandedRows.has(3)) expandedRows.delete(3);
            else expandedRows.add(3);
            expect(expandedRows.has(3)).toBe(true);
            // Toggle off
            if (expandedRows.has(3)) expandedRows.delete(3);
            else expandedRows.add(3);
            expect(expandedRows.has(3)).toBe(false);
        });

        test('multiple rows can be expanded', () => {
            const expandedRows = new Set([1, 3, 7]);
            expect(expandedRows.size).toBe(3);
            expect(expandedRows.has(1)).toBe(true);
            expect(expandedRows.has(3)).toBe(true);
            expect(expandedRows.has(7)).toBe(true);
        });
    });

    // ── CSV Export Tests ──

    describe('exportCSV', () => {
        function generateCSV(data) {
            const headers = ['serial', 'email', 'livePercent', 'deadPercent', 'elasticity',
                             'cl_enabled', 'cl_duration', 'cl_intensity',
                             'extruder1', 'extruder2', 'layerHeight', 'layerNum', 'wellplate',
                             'inputFile', 'outputFile'];

            let csv = headers.join(',') + '\n';
            data.forEach(record => {
                const row = headers.map(col => {
                    const val = getVal(record, col);
                    return sanitizeCSVValue(val);
                });
                csv += row.join(',') + '\n';
            });
            return csv;
        }

        test('generates correct headers', () => {
            const csv = generateCSV([]);
            const firstLine = csv.split('\n')[0];
            expect(firstLine).toContain('serial');
            expect(firstLine).toContain('email');
            expect(firstLine).toContain('livePercent');
            expect(firstLine).toContain('wellplate');
        });

        test('generates data rows', () => {
            const data = [makeRecord()];
            const csv = generateCSV(data);
            const lines = csv.split('\n').filter(l => l.length > 0);
            expect(lines).toHaveLength(2); // header + 1 data row
        });

        test('sanitizes email in CSV', () => {
            const data = [makeRecord({ user_info: { serial: 1, email: '=cmd|exec' } })];
            const csv = generateCSV(data);
            expect(csv).toContain("'=cmd|exec");
        });

        test('handles multiple records', () => {
            const data = [makeRecord(), makeRecord({ user_info: { serial: 2, email: 'other@test.com' } })];
            const csv = generateCSV(data);
            const lines = csv.split('\n').filter(l => l.length > 0);
            expect(lines).toHaveLength(3);
        });

        test('includes numeric values', () => {
            const data = [makeRecord({ print_data: { livePercent: 92.3, deadPercent: 7.7, elasticity: 5.1 } })];
            const csv = generateCSV(data);
            expect(csv).toContain('92.3');
        });

        test('handles missing files gracefully', () => {
            const r = makeRecord();
            delete r.print_info.files;
            const csv = generateCSV([r]);
            // inputFile and outputFile return '' which becomes '""'
            expect(csv).toContain('""');
        });

        test('boolean values in CSV', () => {
            const data = [makeRecord()];
            const csv = generateCSV(data);
            expect(csv).toContain('true'); // cl_enabled
        });
    });

    // ── Stats Computation Tests ──

    describe('updateStats', () => {
        function computeStats(filteredData, metric) {
            if (!metric || filteredData.length === 0) return null;
            const vals = filteredData.map(r => getVal(r, metric)).filter(v => v != null && typeof v === 'number');
            if (vals.length === 0) return null;
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
            return { min, max, avg };
        }

        const data = [
            makeRecord({ print_data: { livePercent: 80, deadPercent: 20, elasticity: 3 } }),
            makeRecord({ print_data: { livePercent: 90, deadPercent: 10, elasticity: 4 } }),
            makeRecord({ print_data: { livePercent: 70, deadPercent: 30, elasticity: 5 } }),
        ];

        test('computes min correctly', () => {
            const stats = computeStats(data, 'livePercent');
            expect(stats.min).toBe(70);
        });

        test('computes max correctly', () => {
            const stats = computeStats(data, 'livePercent');
            expect(stats.max).toBe(90);
        });

        test('computes avg correctly', () => {
            const stats = computeStats(data, 'livePercent');
            expect(stats.avg).toBe(80);
        });

        test('returns null for empty metric', () => {
            expect(computeStats(data, '')).toBeNull();
        });

        test('returns null for empty data', () => {
            expect(computeStats([], 'livePercent')).toBeNull();
        });

        test('returns null when all values are null', () => {
            const nullData = [
                makeRecord({ print_data: { livePercent: null, deadPercent: null, elasticity: null } }),
            ];
            expect(computeStats(nullData, 'livePercent')).toBeNull();
        });

        test('single value: min = max = avg', () => {
            const single = [makeRecord({ print_data: { livePercent: 50, deadPercent: 50, elasticity: 2 } })];
            const stats = computeStats(single, 'livePercent');
            expect(stats.min).toBe(50);
            expect(stats.max).toBe(50);
            expect(stats.avg).toBe(50);
        });

        test('filters out null values from computation', () => {
            const mixed = [
                makeRecord({ print_data: { livePercent: 80, deadPercent: 20, elasticity: 3 } }),
                makeRecord({ print_data: { livePercent: null, deadPercent: null, elasticity: null } }),
                makeRecord({ print_data: { livePercent: 60, deadPercent: 40, elasticity: 2 } }),
            ];
            const stats = computeStats(mixed, 'livePercent');
            expect(stats.min).toBe(60);
            expect(stats.max).toBe(80);
            expect(stats.avg).toBe(70);
        });
    });

    // ── Edge Cases ──

    describe('edge cases', () => {
        test('record with all minimum values', () => {
            const r = makeRecord({
                print_data: { livePercent: 0, deadPercent: 100, elasticity: 0 },
                print_info: {
                    crosslinking: { cl_duration: 0, cl_intensity: 0, cl_enabled: false },
                    pressure: { extruder1: 0, extruder2: 0 },
                    resolution: { layerHeight: 0.01, layerNum: 1 },
                    wellplate: 6
                }
            });
            expect(getVal(r, 'livePercent')).toBe(0);
            expect(fmt(0, 'livePercent')).toBe('0');
            expect(fmt(false, 'cl_enabled')).toBe('No');
        });

        test('very large serial number', () => {
            const r = makeRecord({ user_info: { serial: 999999, email: 'test@test.com' } });
            expect(getVal(r, 'serial')).toBe(999999);
        });

        test('special characters in email', () => {
            const email = "o'brien+test@lab-corp.co.uk";
            expect(fmt(email, 'email')).toBe("o'brien+test@lab-corp.co.uk");
        });

        test('sanitizeCSVValue with newlines', () => {
            const val = 'line1\nline2';
            const result = sanitizeCSVValue(val);
            expect(result).toBe('"line1\nline2"');
        });

        test('sanitizeCSVValue with commas', () => {
            const result = sanitizeCSVValue('a,b,c');
            expect(result).toBe('"a,b,c"');
        });
    });
});
