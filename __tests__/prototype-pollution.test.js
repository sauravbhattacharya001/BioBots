'use strict';

/**
 * Tests for prototype pollution protection across BioBots modules.
 *
 * Verifies that user-supplied objects with __proto__, constructor, or
 * prototype keys cannot pollute Object.prototype or alter constructors.
 */

const { ProtocolLibrary } = require('../Try/scripts/protocolLibrary');

describe('Prototype pollution protection', () => {
  afterEach(() => {
    // Ensure Object.prototype was never polluted
    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.prototype.isAdmin).toBeUndefined();
    delete Object.prototype.polluted;
    delete Object.prototype.isAdmin;
  });

  describe('ProtocolLibrary.clone()', () => {
    test('strips __proto__ from overrides', () => {
      const lib = new ProtocolLibrary();
      const allProtos = lib.getAll();
      const sourceId = allProtos[0].id;

      // Craft malicious overrides
      const malicious = JSON.parse('{"__proto__":{"polluted":true},"name":"hacked"}');
      const cloned = lib.clone(sourceId, malicious);

      expect(cloned.name).toBe('hacked');
      expect(({}).polluted).toBeUndefined();
      expect(cloned.__proto__).toBe(Object.prototype);
    });

    test('strips constructor from parameter overrides', () => {
      const lib = new ProtocolLibrary();
      const allProtos = lib.getAll();
      const sourceId = allProtos[0].id;

      const malicious = {
        parameters: JSON.parse('{"__proto__":{"isAdmin":true},"pressure":50}')
      };
      lib.clone(sourceId, malicious);

      expect(({}).isAdmin).toBeUndefined();
    });
  });

  describe('ProtocolLibrary.importJSON()', () => {
    test('strips __proto__ from imported JSON', () => {
      const lib = new ProtocolLibrary();

      const maliciousJson = JSON.stringify({
        id: 'evil-proto',
        name: 'Evil Protocol',
        parameters: { pressure: 50, temperature: 37, speed: 10, layerHeight: 0.3 },
        '__proto__': { polluted: true }
      });

      const imported = lib.importJSON(maliciousJson);
      expect(imported.id).toBe('evil-proto');
      expect(({}).polluted).toBeUndefined();
    });

    test('strips __proto__ from nested parameters in imported JSON', () => {
      const lib = new ProtocolLibrary();

      const maliciousJson = JSON.stringify({
        id: 'evil-params',
        name: 'Evil Params',
        parameters: {
          pressure: 50, temperature: 37, speed: 10, layerHeight: 0.3,
          '__proto__': { isAdmin: true }
        }
      });

      lib.importJSON(maliciousJson);
      expect(({}).isAdmin).toBeUndefined();
    });
  });
});
