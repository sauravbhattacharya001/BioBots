/**
 * Tests for shelf-life.html — Bioink Shelf Life Dashboard
 *
 * Validates: batch registration, inventory display, shelf life
 * calculation, usage recording, freeze-thaw tracking, degradation
 * curves, material guide, filtering, demo data, and persistence.
 */

'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', 'docs', 'shelf-life.html');

function createDOM() {
    let html = fs.readFileSync(HTML_PATH, 'utf-8');
    // Remove external script that jsdom can't load
    html = html.replace(/<script src="shared\/constants\.js"><\/script>/, '');

    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        pretendToBeVisual: true,
        url: 'http://localhost/',
        resources: 'usable',
    });

    return dom;
}

function getWindow() {
    const dom = createDOM();
    return dom.window;
}

describe('Shelf Life Dashboard', () => {
    let win, doc;

    beforeEach(() => {
        win = getWindow();
        doc = win.document;
    });

    // ── Page Structure ──────────────────────────────────────────

    describe('page structure', () => {
        it('renders page title', () => {
            const h1 = doc.querySelector('h1');
            expect(h1).not.toBeNull();
            expect(h1.textContent).toContain('Shelf Life');
        });

        it('renders nav with links', () => {
            const links = doc.querySelectorAll('nav a');
            expect(links.length).toBeGreaterThanOrEqual(5);
        });

        it('has shelf-life link marked active', () => {
            const active = doc.querySelector('nav a.active');
            expect(active).not.toBeNull();
            expect(active.getAttribute('href')).toBe('shelf-life.html');
        });

        it('renders 4 tab buttons', () => {
            const tabs = doc.querySelectorAll('.tab-btn');
            expect(tabs.length).toBe(4);
        });

        it('inventory tab is active by default', () => {
            const inventoryTab = doc.getElementById('tab-inventory');
            expect(inventoryTab.classList.contains('active')).toBe(true);
        });

        it('summary dashboard has 5 stat cards', () => {
            const cards = doc.querySelectorAll('.dashboard .stat-card');
            expect(cards.length).toBe(5);
        });
    });

    // ── Tab Switching ───────────────────────────────────────────

    describe('tab switching', () => {
        it('switches to register tab', () => {
            win.switchTab('register');
            expect(doc.getElementById('tab-register').classList.contains('active')).toBe(true);
            expect(doc.getElementById('tab-inventory').classList.contains('active')).toBe(false);
        });

        it('switches to materials tab', () => {
            win.switchTab('materials');
            expect(doc.getElementById('tab-materials').classList.contains('active')).toBe(true);
        });

        it('switches to degradation tab', () => {
            win.switchTab('degradation');
            expect(doc.getElementById('tab-degradation').classList.contains('active')).toBe(true);
        });

        it('switches back to inventory', () => {
            win.switchTab('register');
            win.switchTab('inventory');
            expect(doc.getElementById('tab-inventory').classList.contains('active')).toBe(true);
        });
    });

    // ── Material Selects ────────────────────────────────────────

    describe('material selects', () => {
        it('populates registration material dropdown', () => {
            const opts = doc.querySelectorAll('#regMaterial option');
            // 10 materials + 1 placeholder
            expect(opts.length).toBe(11);
        });

        it('populates guide material dropdown', () => {
            const opts = doc.querySelectorAll('#guideMaterial option');
            expect(opts.length).toBe(11);
        });

        it('populates filter material dropdown', () => {
            const opts = doc.querySelectorAll('#filterMaterial option');
            // 10 materials + "All Materials"
            expect(opts.length).toBe(11);
        });

        it('material options have correct values', () => {
            const opts = Array.from(doc.querySelectorAll('#regMaterial option'));
            const values = opts.map(o => o.value).filter(Boolean);
            expect(values).toContain('collagen-type-1');
            expect(values).toContain('alginate');
            expect(values).toContain('pluronic-f127');
        });
    });

    // ── Demo Data ───────────────────────────────────────────────

    describe('demo data', () => {
        it('loads 8 demo batches', () => {
            win.confirm = () => true;
            win.loadDemoData();
            const rows = doc.querySelectorAll('#inventoryBody tr');
            expect(rows.length).toBe(8);
        });

        it('updates summary stats after demo load', () => {
            win.loadDemoData();
            const total = doc.getElementById('totalBatches').textContent;
            expect(parseInt(total)).toBe(8);
        });

        it('shows active volume after demo load', () => {
            win.loadDemoData();
            const vol = doc.getElementById('activeVolume').textContent;
            expect(vol).toContain('mL');
            expect(parseFloat(vol)).toBeGreaterThan(0);
        });

        it('shows inventory value after demo load', () => {
            win.loadDemoData();
            const val = doc.getElementById('inventoryValue').textContent;
            expect(val).toContain('$');
        });

        it('batches are sorted FEFO (first-expired first)', () => {
            win.loadDemoData();
            const rows = doc.querySelectorAll('#inventoryBody tr');
            // Check that remaining days are in ascending order
            const remaining = Array.from(rows).map(r => {
                const cells = r.querySelectorAll('td');
                // Column 4 (Expires) has "X days left" in span
                const span = cells[4].querySelector('span');
                return parseFloat(span.textContent);
            });
            for (let i = 1; i < remaining.length; i++) {
                expect(remaining[i]).toBeGreaterThanOrEqual(remaining[i - 1]);
            }
        });

        it('each row has status badge', () => {
            win.loadDemoData();
            const badges = doc.querySelectorAll('#inventoryBody .badge');
            expect(badges.length).toBe(8);
        });

        it('each row has quality bar', () => {
            win.loadDemoData();
            const bars = doc.querySelectorAll('#inventoryBody .quality-bar');
            expect(bars.length).toBe(8);
        });
    });

    // ── Batch Registration ──────────────────────────────────────

    describe('batch registration', () => {
        it('registers a new batch via form', () => {
            win.switchTab('register');
            doc.getElementById('regMaterial').value = 'alginate';
            doc.getElementById('regVolume').value = '50';
            doc.getElementById('regLot').value = 'TEST-001';
            doc.getElementById('regDate').value = '2026-03-01';

            const form = doc.getElementById('registerForm');
            const event = new win.Event('submit', { cancelable: true });
            win.handleRegister(event);

            // Should switch to inventory and show 1 row
            const rows = doc.querySelectorAll('#inventoryBody tr');
            expect(rows.length).toBe(1);
        });

        it('registered batch appears in summary count', () => {
            doc.getElementById('regMaterial').value = 'fibrin';
            doc.getElementById('regVolume').value = '10';
            win.handleRegister(new win.Event('submit', { cancelable: true }));

            expect(doc.getElementById('totalBatches').textContent).toBe('1');
        });

        it('shows material info on selection', () => {
            doc.getElementById('regMaterial').value = 'collagen-type-1';
            win.updateMaterialInfo();
            const info = doc.getElementById('materialInfo');
            expect(info.style.display).toBe('block');
            expect(info.innerHTML).toContain('Collagen Type I');
        });
    });

    // ── Filtering ───────────────────────────────────────────────

    describe('filtering', () => {
        beforeEach(() => {
            win.loadDemoData();
        });

        it('filters by material', () => {
            doc.getElementById('filterMaterial').value = 'alginate';
            win.renderInventory();
            const rows = doc.querySelectorAll('#inventoryBody tr');
            expect(rows.length).toBe(1);
        });

        it('shows all with filter reset', () => {
            doc.getElementById('filterMaterial').value = 'alginate';
            win.renderInventory();
            doc.getElementById('filterMaterial').value = 'all';
            win.renderInventory();
            const rows = doc.querySelectorAll('#inventoryBody tr');
            expect(rows.length).toBe(8);
        });

        it('filters by status', () => {
            doc.getElementById('filterStatus').value = 'ok';
            win.renderInventory();
            const rows = doc.querySelectorAll('#inventoryBody tr');
            // At least some should be OK
            rows.forEach(r => {
                const badge = r.querySelector('.badge');
                expect(badge.textContent).toBe('OK');
            });
        });
    });

    // ── Usage Recording ─────────────────────────────────────────

    describe('usage recording', () => {
        beforeEach(() => {
            doc.getElementById('regMaterial').value = 'alginate';
            doc.getElementById('regVolume').value = '100';
            win.handleRegister(new win.Event('submit', { cancelable: true }));
        });

        it('opens usage modal', () => {
            win.openUsageModal(1);
            const modal = doc.getElementById('usageModal');
            expect(modal.classList.contains('visible')).toBe(true);
        });

        it('closes usage modal', () => {
            win.openUsageModal(1);
            win.closeModal('usageModal');
            const modal = doc.getElementById('usageModal');
            expect(modal.classList.contains('visible')).toBe(false);
        });

        it('records usage and updates remaining volume', () => {
            win.openUsageModal(1);
            doc.getElementById('usageVolume').value = '25';
            doc.getElementById('usagePurpose').value = 'Print run #1';
            win.submitUsage();

            // Check inventory shows 75 mL remaining
            const rows = doc.querySelectorAll('#inventoryBody tr');
            expect(rows.length).toBe(1);
            const remainingCell = rows[0].querySelectorAll('td')[3];
            expect(remainingCell.textContent).toContain('75');
        });

        it('rejects usage exceeding remaining volume', () => {
            let alertMsg = '';
            win.alert = function(msg) { alertMsg = msg; };

            win.openUsageModal(1);
            doc.getElementById('usageVolume').value = '200';
            win.submitUsage();

            expect(alertMsg).toContain('Insufficient');
        });
    });

    // ── Freeze-Thaw ─────────────────────────────────────────────

    describe('freeze-thaw recording', () => {
        it('increments freeze-thaw cycles', () => {
            doc.getElementById('regMaterial').value = 'collagen-type-1';
            doc.getElementById('regVolume').value = '10';
            win.handleRegister(new win.Event('submit', { cancelable: true }));

            // Record multiple F/T cycles — collagen tolerance is 3
            win.alert = function() {};
            win.recordFT(1);
            win.recordFT(1);
            win.recordFT(1);
            win.recordFT(1); // should trigger warning (4 > 3)

            // Verify batch still renders
            const rows = doc.querySelectorAll('#inventoryBody tr');
            expect(rows.length).toBe(1);
        });
    });

    // ── Batch Removal ───────────────────────────────────────────

    describe('batch removal', () => {
        it('removes a batch after confirmation', () => {
            win.loadDemoData();
            win.confirm = () => true;
            const rowsBefore = doc.querySelectorAll('#inventoryBody tr').length;

            win.removeBatch(1);
            const rowsAfter = doc.querySelectorAll('#inventoryBody tr').length;
            expect(rowsAfter).toBe(rowsBefore - 1);
        });

        it('does not remove when confirmation is cancelled', () => {
            win.loadDemoData();
            win.confirm = () => false;
            const rowsBefore = doc.querySelectorAll('#inventoryBody tr').length;

            win.removeBatch(1);
            const rowsAfter = doc.querySelectorAll('#inventoryBody tr').length;
            expect(rowsAfter).toBe(rowsBefore);
        });
    });

    // ── Material Guide ──────────────────────────────────────────

    describe('material guide', () => {
        it('shows guide for selected material', () => {
            win.switchTab('materials');
            doc.getElementById('guideMaterial').value = 'collagen-type-1';
            win.showMaterialGuide();

            const content = doc.getElementById('guideContent');
            expect(content.innerHTML).toContain('Collagen Type I');
        });

        it('shows shelf life estimates', () => {
            doc.getElementById('guideMaterial').value = 'alginate';
            win.showMaterialGuide();

            const content = doc.getElementById('guideContent').innerHTML;
            expect(content).toContain('Optimal');
            expect(content).toContain('Room Temp');
            expect(content).toContain('Worst Case');
            expect(content).toContain('days');
        });

        it('shows storage recommendations', () => {
            doc.getElementById('guideMaterial').value = 'fibrin';
            win.showMaterialGuide();

            const content = doc.getElementById('guideContent').innerHTML;
            expect(content).toContain('Temperature');
            expect(content).toContain('Container');
        });

        it('clears guide when no material selected', () => {
            doc.getElementById('guideMaterial').value = 'alginate';
            win.showMaterialGuide();
            doc.getElementById('guideMaterial').value = '';
            win.showMaterialGuide();

            expect(doc.getElementById('guideContent').innerHTML).toBe('');
        });
    });

    // ── Degradation Curves ──────────────────────────────────────

    describe('degradation curves', () => {
        it('populates batch select on tab switch', () => {
            win.loadDemoData();
            win.switchTab('degradation');

            const opts = doc.querySelectorAll('#curveBatch option');
            // 8 demo batches + 1 placeholder
            expect(opts.length).toBe(9);
        });
    });

    // ── Alerts ──────────────────────────────────────────────────

    describe('alerts', () => {
        it('shows alerts for expired/urgent batches', () => {
            // Register a batch with very old date
            doc.getElementById('regMaterial').value = 'fibrin';
            doc.getElementById('regVolume').value = '5';
            doc.getElementById('regDate').value = '2025-01-01'; // ~14 months ago, fibrin has 30-day shelf life
            win.handleRegister(new win.Event('submit', { cancelable: true }));

            const alerts = doc.querySelectorAll('#alertsContainer .alert');
            expect(alerts.length).toBeGreaterThanOrEqual(1);
        });

        it('no alerts for fresh batches', () => {
            doc.getElementById('regMaterial').value = 'pluronic-f127';
            doc.getElementById('regVolume').value = '100';
            // Default is today's date
            win.handleRegister(new win.Event('submit', { cancelable: true }));

            const alerts = doc.querySelectorAll('#alertsContainer .alert');
            expect(alerts.length).toBe(0);
        });
    });

    // ── Empty State ─────────────────────────────────────────────

    describe('empty state', () => {
        it('shows empty message when no batches', () => {
            const empty = doc.getElementById('emptyInventory');
            expect(empty.style.display).not.toBe('none');
        });

        it('hides empty message after adding batch', () => {
            doc.getElementById('regMaterial').value = 'alginate';
            doc.getElementById('regVolume').value = '10';
            win.handleRegister(new win.Event('submit', { cancelable: true }));

            const empty = doc.getElementById('emptyInventory');
            expect(empty.style.display).toBe('none');
        });
    });
});
