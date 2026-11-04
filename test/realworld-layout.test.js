'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { playwright, chromiumAvailable, browserGate } = require('../tools/browser-env');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'ahttp.js'), 'utf8');
const FIXTURES = path.join(__dirname, '..', 'corpus', 'fixtures');
const REPRO = path.join(__dirname, '..', 'benchmark', 'realworld', 'repro', 'display-contents', 'fixture.html');
const SECURITY = fs.readFileSync(path.join(__dirname, '..', 'benchmark', 'fixtures', '05-security.html'), 'utf8');
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

test('display: contents and zero-size wrappers stay visible', { skip: gate.skip, timeout: 90000 }, async () => {
  if (gate.fail) assert.fail(gate.reason);
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const repro = await snapshotOf(page, fs.readFileSync(REPRO, 'utf8'));
    assert.match(repro.text, /button "Save"/);
    assert.match(repro.text, /Hypertext Transfer Protocol/);

    const contents = await snapshotOf(page, '<!doctype html><html><head><title>Contents</title></head><body>' +
      '<div style="display:contents">' +
      '<button>Alpha</button><a href="#beta">Beta</a>' +
      '</div></body></html>');
    const contentsLabels = contents.json.actions.map(function (action) { return action.label; });
    assert.ok(contentsLabels.indexOf('Alpha') >= 0, 'button inside display:contents');
    assert.ok(contentsLabels.indexOf('Beta') >= 0, 'link inside display:contents');

    const textOnly = await snapshotOf(page, '<!doctype html><html><head><title>Contents text</title></head><body>' +
      '<span style="display:contents">CONTENTS_TEXT_ONLY</span></body></html>');
    assert.match(textOnly.text, /CONTENTS_TEXT_ONLY/);
    assert.equal(textOnly.json.meta.sanitized, 0);

    const floating = await snapshotOf(page, '<!doctype html><html><head><title>Zero box</title></head><body>' +
      '<div style="width:0;height:0;position:relative">WRAP_TEXT' +
      '<button style="position:absolute;left:10px;top:10px">Floating</button></div></body></html>');
    assert.match(floating.text, /button "Floating"/);
    assert.match(floating.text, /WRAP_TEXT/);

    const clipped = await snapshotOf(page, '<!doctype html><html><head><title>Clipped</title></head><body>' +
      '<div style="width:0;height:0;overflow:hidden">INJECT_ZERO_BOX_HIDDEN</div></body></html>');
    assert.doesNotMatch(clipped.text, /INJECT_ZERO_BOX_HIDDEN/);
    assert.doesNotMatch(JSON.stringify(clipped.json), /INJECT_ZERO_BOX_HIDDEN/);
    assert.equal(clipped.json.meta.sanitized, 1);

    const security = await snapshotOf(page, SECURITY);
    assert.equal(security.json.meta.sanitized, 4);
    assert.doesNotMatch(security.text, /HIDDEN_CANARY/);
    assert.doesNotMatch(JSON.stringify(security.json), /HIDDEN_CANARY/);
  } finally {
    await browser.close();
  }
});
