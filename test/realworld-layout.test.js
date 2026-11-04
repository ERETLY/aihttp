'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { playwright, chromiumAvailable, browserGate } = require('../tools/browser-env');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'ahttp.js'), 'utf8');
const FIXTURES = path.join(__dirname, '..', 'corpus', 'fixtures');
const gate = browserGate(chromiumAvailable(), process.env.AHTTP_REQUIRE_BROWSER === '1');

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

async function snapshotOf(page, html) {
  await page.setContent(html, { waitUntil: 'load' });
  await page.addScriptTag({ content: ENGINE });
  return page.evaluate(function () {
    return {
      json: window.ahttp.snapshot({ format: 'json', force: true }),
      text: window.ahttp.snapshot({ format: 'text', force: true })
    };
  });
}

test('layout mode follows computed style instead of the CSS index', { skip: gate.skip, timeout: 90000 }, async () => {
  if (gate.fail) assert.fail(gate.reason);
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const media = await snapshotOf(page, fixture('rw-media-query-range.html'));
    assert.equal(media.json.meta.layout, 'layout');
    assert.match(media.text, /button "Nav"/);
    assert.match(media.text, /button "Side"/);

    await page.setViewportSize({ width: 600, height: 800 });
    const narrow = await page.evaluate(function () {
      return window.ahttp.snapshot({ format: 'text', force: true });
    });
    assert.doesNotMatch(narrow, /button "Nav"/);
    await page.setViewportSize({ width: 1280, height: 800 });
    const wide = await page.evaluate(function () {
      return window.ahttp.snapshot({ format: 'text', force: true });
    });
    assert.match(wide, /button "Nav"/);

    const hiddenThenShown = await snapshotOf(page, fixture('rw-css-hidden-then-shown.html'));
    assert.match(hiddenThenShown.text, /input(?:\[[^\]]*\])? "Search Wikipedia"/);
    assert.match(hiddenThenShown.text, /button "Save"/);

    const utility = await snapshotOf(page, fixture('rw-utility-class-show.html'));
    assert.match(utility.text, /button "Open"/);
  } finally {
    await browser.close();
  }
});
