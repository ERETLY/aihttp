'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PageRegistry } = require('../lib/page-registry');

function fakePage(name) {
  return {
    name: name,
    closeCalls: 0,
    async close() { this.closeCalls += 1; }
  };
}

test('replacing a handle closes the previous page exactly once', () => {
  const registry = new PageRegistry(8);
  const first = fakePage('first');
  const second = fakePage('second');
  const handle = registry.setLegacy(first);
  assert.equal(registry.get(handle), first, 'legacy page is stored under its handle');

  registry.replace(handle, second);
  assert.equal(first.closeCalls, 1, 'old page is closed after the new page is stored');
  assert.equal(registry.get(handle), second, 'handle points at the new page');
  assert.equal(registry.legacyPage, second, 'legacy pointer follows its navigated page');
  assert.equal(second.__aihttpHandle, handle, 'new page inherits the handle');
});

test('navigating a non-legacy page does not hijack the legacy pointer', () => {
  const registry = new PageRegistry(8);
  const legacy = fakePage('legacy');
  const background = fakePage('background');
  const next = fakePage('next');
  const legacyHandle = registry.setLegacy(legacy);
  const backgroundHandle = registry.store(background);

  registry.replace(backgroundHandle, next);
  assert.equal(background.closeCalls, 1);
  assert.equal(registry.legacyPage, legacy, 'legacy pointer stays on the legacy page');
  assert.equal(registry.get(legacyHandle), legacy);
  assert.equal(registry.get(backgroundHandle), next);
});

test('trim evicts the oldest evictable page and closes it', () => {
  const registry = new PageRegistry(2);
  const a = fakePage('a');
  const b = fakePage('b');
  const c = fakePage('c');
  registry.setLegacy(a);
  registry.store(b);
  registry.store(c);
  assert.equal(registry.get(a.__aihttpHandle), a, 'legacy page is retained');
  assert.equal(registry.get(b.__aihttpHandle), null, 'oldest non-legacy page is evicted');
  assert.equal(b.closeCalls, 1);
  assert.equal(registry.get(c.__aihttpHandle), c);
});

test('closeAll closes every stored page and clears the legacy pointer', () => {
  const registry = new PageRegistry(8);
  const a = fakePage('a');
  const b = fakePage('b');
  registry.setLegacy(a);
  registry.store(b);
  registry.closeAll();
  assert.equal(a.closeCalls, 1);
  assert.equal(b.closeCalls, 1);
  assert.equal(registry.legacyPage, null);
});
