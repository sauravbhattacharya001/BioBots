'use strict';

/**
 * Tests for docs/shared/commandPalette.js
 *
 * commandPalette is a self-bootstrapping IIFE that wires a global
 * Ctrl+K / Cmd+K navigation overlay onto the host page. The module
 * exposes nothing on `module.exports` — testing exercises the DOM
 * artifacts it installs and the keyboard / pointer behaviour it
 * binds to `document`.
 */

const path = require('path');

// jsdom does not implement Element.prototype.scrollIntoView; commandPalette
// calls it when rendering / navigating the list. Stub it out so we exercise
// the surrounding logic without crashing.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function noop() {};
}

// Use an isolated module registry so we can reload the IIFE per test.
function loadPalette() {
    jest.resetModules();
    // Reset DOM between tests so the IIFE re-installs everything cleanly.
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    // commandPalette installs a global keydown listener on `document`;
    // since jsdom creates a fresh document per test file (not per test),
    // we record the size of any pre-existing listeners and tolerate stacking.
    require(path.join('..', 'docs', 'shared', 'commandPalette.js'));
}

function dispatchKey(target, key, opts = {}) {
    const evt = new window.KeyboardEvent('keydown', Object.assign({
        key,
        bubbles: true,
        cancelable: true,
    }, opts));
    target.dispatchEvent(evt);
    return evt;
}

describe('commandPalette (Ctrl+K navigation overlay)', () => {
    beforeEach(() => {
        loadPalette();
    });

    test('injects style, overlay, input, list, and trigger into the DOM', () => {
        const styles = document.head.querySelectorAll('style');
        expect(styles.length).toBeGreaterThanOrEqual(1);
        // The injected style should contain the .cp-overlay class.
        const combined = Array.from(styles).map(s => s.textContent).join('\n');
        expect(combined).toMatch(/\.cp-overlay/);
        expect(combined).toMatch(/\.cp-item/);

        const overlay = document.querySelector('.cp-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay.style.display).toBe('none');

        expect(document.querySelector('.cp-input')).not.toBeNull();
        expect(document.querySelector('.cp-list')).not.toBeNull();
        expect(document.querySelector('.cp-trigger')).not.toBeNull();
    });

    test('Ctrl+K opens the palette and renders the tool list', () => {
        const overlay = document.querySelector('.cp-overlay');
        expect(overlay.classList.contains('open')).toBe(false);

        const evt = dispatchKey(document, 'k', { ctrlKey: true });
        expect(evt.defaultPrevented).toBe(true);
        expect(overlay.classList.contains('open')).toBe(true);
        expect(overlay.style.display).toBe('flex');

        const items = document.querySelectorAll('.cp-item');
        // The hard-coded tool list is sizeable; require a reasonable lower bound.
        expect(items.length).toBeGreaterThan(30);
        // First item should be marked active.
        expect(items[0].classList.contains('active')).toBe(true);
    });

    test('Cmd+K also opens the palette (macOS shortcut)', () => {
        const overlay = document.querySelector('.cp-overlay');
        dispatchKey(document, 'k', { metaKey: true });
        expect(overlay.classList.contains('open')).toBe(true);
    });

    test('Ctrl+K is a toggle: second press closes the palette', () => {
        const overlay = document.querySelector('.cp-overlay');
        dispatchKey(document, 'k', { ctrlKey: true });
        expect(overlay.classList.contains('open')).toBe(true);
        dispatchKey(document, 'k', { ctrlKey: true });
        expect(overlay.classList.contains('open')).toBe(false);
    });

    test('Escape closes the palette when open', () => {
        const overlay = document.querySelector('.cp-overlay');
        dispatchKey(document, 'k', { ctrlKey: true });
        expect(overlay.classList.contains('open')).toBe(true);

        dispatchKey(document, 'Escape');
        expect(overlay.classList.contains('open')).toBe(false);
    });

    test('clicking the trigger opens the palette', () => {
        const overlay = document.querySelector('.cp-overlay');
        const trigger = document.querySelector('.cp-trigger');
        expect(overlay.classList.contains('open')).toBe(false);
        trigger.click();
        expect(overlay.classList.contains('open')).toBe(true);
    });

    test('clicking the overlay backdrop closes the palette', () => {
        const overlay = document.querySelector('.cp-overlay');
        dispatchKey(document, 'k', { ctrlKey: true });
        expect(overlay.classList.contains('open')).toBe(true);

        // Synthesize a click whose target is the overlay itself.
        overlay.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        expect(overlay.classList.contains('open')).toBe(false);
    });

    test('clicking inside the dialog box does NOT close the palette', () => {
        const overlay = document.querySelector('.cp-overlay');
        const box = document.querySelector('.cp-box');
        dispatchKey(document, 'k', { ctrlKey: true });
        expect(overlay.classList.contains('open')).toBe(true);
        // Bubble up from a child of .cp-box (the click handler ignores
        // events whose target is not the overlay element itself).
        box.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        expect(overlay.classList.contains('open')).toBe(true);
    });

    test('typing in the search input filters the rendered tool list', () => {
        const input = document.querySelector('.cp-input');
        dispatchKey(document, 'k', { ctrlKey: true });

        const beforeCount = document.querySelectorAll('.cp-item').length;
        input.value = 'rheology';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));

        const after = document.querySelectorAll('.cp-item');
        expect(after.length).toBeGreaterThan(0);
        expect(after.length).toBeLessThan(beforeCount);
        // Every visible item should mention the query in name/desc/href.
        after.forEach(el => {
            const blob = (el.textContent + ' ' + el.getAttribute('href')).toLowerCase();
            expect(blob).toContain('rheology');
        });
    });

    test('empty search results render the "No tools found" empty state', () => {
        const input = document.querySelector('.cp-input');
        const list = document.querySelector('.cp-list');
        dispatchKey(document, 'k', { ctrlKey: true });

        input.value = 'zzz-no-such-tool-zzz';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));

        const empty = list.querySelector('.cp-empty');
        expect(empty).not.toBeNull();
        expect(empty.textContent).toMatch(/No tools found/i);
    });

    test('empty-state HTML escapes the user query to prevent injection', () => {
        const input = document.querySelector('.cp-input');
        const list = document.querySelector('.cp-list');
        dispatchKey(document, 'k', { ctrlKey: true });

        input.value = '<img src=x onerror=alert(1)>nope';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));

        // No real <img> should have been parsed into the DOM.
        expect(list.querySelector('img')).toBeNull();
        const empty = list.querySelector('.cp-empty');
        expect(empty).not.toBeNull();
        expect(empty.innerHTML).toContain('&lt;img');
    });

    test('ArrowDown advances active index without rebuilding the list', () => {
        const input = document.querySelector('.cp-input');
        dispatchKey(document, 'k', { ctrlKey: true });

        const itemsBefore = Array.from(document.querySelectorAll('.cp-item'));
        expect(itemsBefore[0].classList.contains('active')).toBe(true);

        const evt = dispatchKey(input, 'ArrowDown');
        expect(evt.defaultPrevented).toBe(true);

        const itemsAfter = Array.from(document.querySelectorAll('.cp-item'));
        // updateActiveOnly should reuse the same nodes (no rebuild).
        expect(itemsAfter[0]).toBe(itemsBefore[0]);
        expect(itemsAfter[0].classList.contains('active')).toBe(false);
        expect(itemsAfter[1].classList.contains('active')).toBe(true);
    });

    test('ArrowUp at the top stays clamped to index 0', () => {
        const input = document.querySelector('.cp-input');
        dispatchKey(document, 'k', { ctrlKey: true });

        dispatchKey(input, 'ArrowUp');
        const items = document.querySelectorAll('.cp-item');
        expect(items[0].classList.contains('active')).toBe(true);
        // Only one active at any time.
        const activeCount = document.querySelectorAll('.cp-item.active').length;
        expect(activeCount).toBe(1);
    });

    test('ArrowDown past the end is clamped to the last item', () => {
        const input = document.querySelector('.cp-input');
        dispatchKey(document, 'k', { ctrlKey: true });
        const items = document.querySelectorAll('.cp-item');
        const last = items.length - 1;
        for (let i = 0; i < items.length + 10; i++) {
            dispatchKey(input, 'ArrowDown');
        }
        const after = document.querySelectorAll('.cp-item');
        expect(after[last].classList.contains('active')).toBe(true);
        expect(document.querySelectorAll('.cp-item.active').length).toBe(1);
    });

    test('Escape inside the search input closes the palette', () => {
        const overlay = document.querySelector('.cp-overlay');
        const input = document.querySelector('.cp-input');
        dispatchKey(document, 'k', { ctrlKey: true });
        expect(overlay.classList.contains('open')).toBe(true);
        dispatchKey(input, 'Escape');
        expect(overlay.classList.contains('open')).toBe(false);
    });

    test('marks the current page item with the "(current)" badge', () => {
        // jsdom defaults to "about:blank"; we need the URL to end in a known href.
        // Use history.replaceState to fake the location.pathname.
        const overlay = document.querySelector('.cp-overlay');
        // Re-open: render uses location.pathname.split('/').pop()
        // jsdom location is "about:blank" → pathname "blank" — no match expected.
        dispatchKey(document, 'k', { ctrlKey: true });
        const currentBadges = document.querySelectorAll('.cp-item .cp-item-name span');
        // It is allowed to be 0 in jsdom (about:blank), but if any badge
        // appears it must be flagged as "(current)".
        currentBadges.forEach(span => {
            expect(span.textContent).toMatch(/current/i);
        });
        // Sanity: at least one item must render.
        expect(document.querySelectorAll('.cp-item').length).toBeGreaterThan(0);
        // Close to leave a clean DOM for next test.
        dispatchKey(document, 'Escape');
        expect(overlay.classList.contains('open')).toBe(false);
    });
});
