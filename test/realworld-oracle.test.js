'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { playwright, chromiumAvailable, browserGate } = require('../tools/browser-env');
const { oracle, matchActions } = require('../benchmark/realworld/oracle');

const gate = browserGate(chromiumAvailable(), process.env.AHTTP_REQUIRE_BROWSER === '1');

function item(name, href) {
  return { tag: 'a', type: '', role: 'link', name: name, href: href || '', reasons: [], visible: true };
}

function action(label, href) {
  return { id: 'a1', tag: 'a', type: '', role: 'link', label: label, href: href || '', kind: 'click' };
}

test('the matcher pairs a name the oracle truncated at 160 with the engine full name', () => {
  const long = 'A'.repeat(200);
  const result = matchActions([action(long)], [item(long.slice(0, 160))]);
  assert.equal(result.matchedVisible, 1);
  assert.equal(result.missed.length, 0);
  assert.equal(result.phantom.length, 0);
});

test('the matcher ignores whitespace before punctuation in names', () => {
  const result = matchActions([action('Live. updates')], [item('LIVE . updates')]);
  assert.equal(result.matchedVisible, 1);
  assert.equal(result.missed.length, 0);
});

test('the matcher does not pair short names that only share a prefix', () => {
  const result = matchActions([action('Save changes')], [item('Save')]);
  assert.equal(result.matchedVisible, 0);
  assert.equal(result.missed.length, 1);
  assert.equal(result.phantom.length, 1);
});

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

test('the oracle hides a link inside a clipped sr-only container', { skip: gate.skip, timeout: 90000 }, async () => {
  if (gate.fail) assert.fail(gate.reason);
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent('<!doctype html><html><body>' +
      '<nav style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">' +
      '<a href="/sr">Screen reader link</a></nav>' +
      '<a href="/plain">Plain link</a>' +
      '</body></html>', { waitUntil: 'load' });

    const result = await page.evaluate(oracle);
    const byName = new Map(result.items.map(function (item) { return [item.name, item]; }));
    const sr = byName.get('Screen reader link');
    assert.ok(sr, 'oracle collects the sr-only link');
    assert.equal(sr.visible, false);
    assert.ok(sr.reasons.indexOf('ancestor-clip') >= 0, 'reason is ancestor-clip: ' + sr.reasons.join(','));
    assert.equal(byName.get('Plain link').visible, true);
  } finally {
    await browser.close();
  }
});
