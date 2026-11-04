'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { playwright, chromiumAvailable, browserGate } = require('../tools/browser-env');
const { oracle } = require('../benchmark/realworld/oracle');

const gate = browserGate(chromiumAvailable(), process.env.AHTTP_REQUIRE_BROWSER === '1');

test('the oracle hides a closed details subtree and keeps its first summary', { skip: gate.skip, timeout: 90000 }, async () => {
  if (gate.fail) assert.fail(gate.reason);
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent('<!doctype html><html><body>' +
      '<details>' +
      '<summary>Closed summary</summary>' +
      '<a href="/closed">Closed link</a>' +
      '<summary>Second summary</summary>' +
      '<details open><summary>Nested open</summary><a href="/nested">Nested link</a></details>' +
      '</details>' +
      '<details open><summary>Open summary</summary><a href="/open">Open link</a></details>' +
      '<a href="/plain">Plain link</a>' +
      '</body></html>', { waitUntil: 'load' });

    const result = await page.evaluate(oracle);
    const byName = new Map(result.items.map(function (item) { return [item.name, item]; }));
    const need = function (name) {
      const item = byName.get(name);
      assert.ok(item, 'oracle collects ' + name);
      return item;
    };

    const closed = need('Closed link');
    assert.equal(closed.visible, false);
    assert.ok(closed.reasons.indexOf('closed-details') >= 0, 'reason is closed-details: ' + closed.reasons.join(','));

    assert.equal(need('Second summary').visible, false);
    assert.equal(need('Nested open').visible, false);
    assert.equal(need('Nested link').visible, false);
    assert.equal(need('Closed summary').visible, true);
    assert.equal(need('Open summary').visible, true);
    assert.equal(need('Open link').visible, true);
    assert.equal(need('Plain link').visible, true);
  } finally {
    await browser.close();
  }
});
