'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { playwright, chromiumAvailable, browserGate } = require('../tools/browser-env');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'ahttp.js'), 'utf8');
const FIXTURES = path.join(__dirname, '..', 'corpus', 'fixtures');
const REPRO = path.join(__dirname, '..', 'benchmark', 'realworld', 'repro', 'display-contents', 'fixture.html');
const REPRO_SELECT = path.join(__dirname, '..', 'benchmark', 'realworld', 'repro', 'select-opacity', 'fixture.html');
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

test('anchors without href stay actions when role, handler or tabindex says so', { skip: gate.skip, timeout: 90000 }, async () => {
  if (gate.fail) assert.fail(gate.reason);
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const snap = await snapshotOf(page, '<!doctype html><html><head><title>Anchors</title></head><body><main>' +
      '<a role="button" aria-label="Cart, empty">cart</a>' +
      '<a onclick="document.getElementById(\'out\').textContent=\'ran\'">Run task</a>' +
      '<a tabindex="0">Focus target</a>' +
      '<a>Plain text only</a>' +
      '<p id="out">idle</p></main></body></html>');
    assert.match(snap.text, /a role=button "Cart, empty"/);
    assert.match(snap.text, /button "Run task"/);
    assert.match(snap.text, /button "Focus target"/);
    assert.doesNotMatch(snap.text, /button "Plain text only"/);

    const cart = await page.evaluate(function () {
      return window.ahttp.act('Cart, empty', null, { quiet: 0, minWait: 0, timeout: 250, snapshot: false });
    });
    assert.equal(cart.status, 'ok');

    const run = await page.evaluate(function () {
      return window.ahttp.act('Run task', null, { quiet: 0, minWait: 0, timeout: 250, snapshot: false });
    });
    assert.equal(run.status, 'ok');
    assert.equal(await page.evaluate(function () { return document.getElementById('out').textContent; }), 'ran');
  } finally {
    await browser.close();
  }
});

test('a label is an action only when its control is not in the snapshot', { skip: gate.skip, timeout: 90000 }, async () => {
  if (gate.fail) assert.fail(gate.reason);
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const field = await snapshotOf(page, '<!doctype html><html><head><title>Label cursor</title>' +
      '<style>label{cursor:pointer}</style></head><body><main>' +
      '<label for="user">Username</label><input id="user" type="text"><button>Save</button>' +
      '</main></body></html>');
    assert.doesNotMatch(field.text, /label role=button/);
    assert.match(field.text, /input "Username"/);

    const check = await snapshotOf(page, '<!doctype html><html><head><title>Btn check</title>' +
      '<style>.btn-check{display:none}.btn{cursor:pointer;display:inline-block}</style></head><body><main>' +
      '<input class="btn-check" type="checkbox" id="dark"><label class="btn" for="dark">Dark mode</label>' +
      '</main></body></html>');
    assert.match(check.text, /label role=button "Dark mode"/);

    const clicked = await page.evaluate(function () {
      return window.ahttp.act('Dark mode', null, { quiet: 0, minWait: 0, timeout: 250, snapshot: false });
    });
    assert.equal(clicked.status, 'ok');
    assert.equal(await page.evaluate(function () { return document.getElementById('dark').checked; }), true);
  } finally {
    await browser.close();
  }
});

test('a partially transparent native field is real, a fully transparent one is not', { skip: gate.skip, timeout: 90000 }, async () => {
  if (gate.fail) assert.fail(gate.reason);
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const repro = await snapshotOf(page, fs.readFileSync(REPRO_SELECT, 'utf8'));
    const select = repro.json.actions.filter(function (action) { return action.tag === 'select'; });
    assert.equal(select.length, 1);
    assert.equal(select[0].label, 'Sort products');
    assert.equal(select[0].kind, 'select');
    assert.equal(repro.json.actions.filter(function (action) { return action.tag === 'span'; }).length, 0);

    const picked = await page.evaluate(function () {
      return window.ahttp.act('Sort products', { value: 'za' }, { quiet: 0, minWait: 0, timeout: 250, snapshot: false });
    });
    assert.equal(picked.status, 'ok');
    assert.equal(await page.evaluate(function () { return document.getElementById('out').textContent; }), 'za');

    const fields = await snapshotOf(page, '<!doctype html><html><head><title>Fields</title></head><body><main>' +
      '<input type="text" aria-label="Search" style="width:200px;height:24px;opacity:.02">' +
      '<textarea aria-label="Notes" style="width:200px;height:40px;opacity:.02"></textarea>' +
      '<input type="text" aria-label="Zero field" style="width:200px;height:24px;opacity:0">' +
      '</main></body></html>');
    assert.match(fields.text, /input "Search"/);
    assert.match(fields.text, /textarea "Notes"/);
    assert.doesNotMatch(fields.text, /Zero field/);
    assert.doesNotMatch(JSON.stringify(fields.json), /Zero field/);
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

test('a CSS hover card is a hover action and its hidden text stays out until hovered', { skip: gate.skip, timeout: 90000 }, async () => {
  if (gate.fail) assert.fail(gate.reason);
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const before = await snapshotOf(page, '<!doctype html><html><head><title>Hover card</title><style>' +
      '.card{width:120px;height:80px}.card:hover .cap{display:block}.cap{display:none}' +
      '</style></head><body><main><div class="card"><img alt="User avatar" src="' + gif + '">' +
      '<div class="cap">name: user1</div></div></main></body></html>');

    const hover = before.json.actions.filter(function (action) { return action.kind === 'hover'; });
    assert.equal(hover.length, 1);
    assert.equal(hover[0].role, 'hover');
    assert.equal(hover[0].label, 'User avatar');
    assert.doesNotMatch(before.text, /name: user1/);
    assert.doesNotMatch(JSON.stringify(before.json), /name: user1/);

    const acted = await page.evaluate(function (id) {
      return window.ahttp.act(id, { hover: true }, { quiet: 0, minWait: 0, timeout: 250, snapshot: false });
    }, hover[0].id);
    assert.equal(acted.status, 'ok');
    assert.equal(acted.action.kind, 'hover');

    const after = await page.evaluate(function () {
      return window.ahttp.snapshot({ format: 'text', force: true });
    });
    assert.match(after, /name: user1/);
  } finally {
    await browser.close();
  }
});

test('font-size:0 on a wrapper does not hide its visible links', { skip: gate.skip, timeout: 90000 }, async () => {
  if (gate.fail) assert.fail(gate.reason);
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const out = await snapshotOf(page, '<!doctype html><html><head><title>fs0 nav</title>' +
      '<style>#nav{font-size:0}#nav a{font-size:16px;display:inline-block;padding:8px}</style>' +
      '</head><body><main><h1>Page</h1></main>' +
      '<div id="nav"><a href="/sql">SQL</a><a href="/css">CSS</a></div></body></html>');
    const labels = Array.from(out.json.actions, function (action) { return action.label; });
    assert.ok(labels.indexOf('SQL') >= 0, 'SQL link survives font-size:0: ' + JSON.stringify(labels));
    assert.ok(labels.indexOf('CSS') >= 0, 'CSS link survives font-size:0: ' + JSON.stringify(labels));
  } finally {
    await browser.close();
  }
});
