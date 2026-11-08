'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { openHtml } = require('../lib/page');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'aihttp.js'), 'utf8');

function load(html) {
  const dom = new JSDOM(html, { url: 'https://universal.test/', runScripts: 'outside-only' });
  dom.window.eval(ENGINE);
  return dom.window;
}

function actOptions() {
  return { quiet: 0, minWait: 0, timeout: 250 };
}

test('a white-on-white container does not hide colored children', () => {
  const window = load('<!doctype html><body style="color:#fff;background:#fff">' +
    '<main><button style="color:#000;background:#fff">Save</button></main></body>');
  const snapshot = window.aihttp.snapshot({ format: 'json' });
  assert.ok(snapshot.actions.some(function (action) { return action.label === 'Save'; }));
});

test('a small aria-modal=false dialog does not become the scan root', () => {
  const window = load('<!doctype html><body>' +
    '<div role="dialog" aria-modal="false">Cookie notice</div>' +
    '<button>Save</button></body>');
  const snapshot = window.aihttp.snapshot({ format: 'json' });
  assert.ok(snapshot.actions.some(function (action) { return action.label === 'Save'; }));
});

test('an aria-modal=true dialog still scopes the scan', () => {
  const window = load('<!doctype html><body>' +
    '<div role="dialog" aria-modal="true"><button>OK</button></div>' +
    '<button>Outside</button></body>');
  const snapshot = window.aihttp.snapshot({ format: 'json' });
  assert.ok(snapshot.actions.some(function (action) { return action.label === 'OK'; }));
  assert.ok(!snapshot.actions.some(function (action) { return action.label === 'Outside'; }));
});

test('a custom combobox chooses an option rendered after the click', async () => {
  const window = load('<!doctype html><body>' +
    '<button id="trigger" role="combobox" aria-controls="list" aria-expanded="false">Pick</button>' +
    '<ul id="list" role="listbox" hidden></ul></body>');
  const document = window.document;
  const trigger = document.getElementById('trigger');
  const list = document.getElementById('list');
  trigger.addEventListener('click', function () {
    trigger.setAttribute('aria-expanded', 'true');
    window.setTimeout(function () {
      list.hidden = false;
      list.innerHTML = '<li role="option" data-value="one">One</li>' +
        '<li role="option" data-value="two">Two</li>';
    }, 60);
  });
  const snapshot = window.aihttp.snapshot({ format: 'json' });
  const target = snapshot.actions.find(function (action) { return action.label === 'Pick'; });
  assert.ok(target);

  const result = await window.aihttp.act(target.id, { value: 'Two', wait: 500 }, actOptions());
  assert.equal(result.status, 'ok');
  assert.equal(result.selected, 'Two');
});

test('settle ignores a request that was already in flight', async () => {
  const window = load('<!doctype html><body>' +
    '<button id="slow">Slow</button><button id="fast">Fast</button></body>');
  const document = window.document;
  window.fetch = function () { return new Promise(function () {}); };
  document.getElementById('slow').addEventListener('click', function () { window.fetch('/slow'); });
  const snapshot = window.aihttp.snapshot({ format: 'json' });
  const slow = snapshot.actions.find(function (action) { return action.label === 'Slow'; });
  const fast = snapshot.actions.find(function (action) { return action.label === 'Fast'; });
  assert.ok(slow && fast);

  await window.aihttp.act(slow.id, {}, { quiet: 0, minWait: 0, timeout: 120 });
  const started = Date.now();
  const result = await window.aihttp.act(fast.id, {}, { quiet: 0, minWait: 0, timeout: 120 });
  const elapsed = Date.now() - started;
  assert.equal(result.status, 'ok');
  assert.ok(elapsed < 100, 'second action waited ' + elapsed + ' ms for the first request');
});

test('a custom combobox reads aria-activedescendant as its value', async () => {
  const window = load('<!doctype html><body>' +
    '<div role="combobox" aria-activedescendant="opt2"><span id="opt2">Two</span></div></body>');
  const snapshot = window.aihttp.snapshot({ format: 'json' });
  const target = snapshot.actions.find(function (action) { return action.role === 'combobox'; });
  assert.ok(target);

  const result = await window.aihttp.act(target.id, { read: true }, actOptions());
  assert.equal(result.status, 'ok');
  assert.equal(result.value, 'Two');
});

test('aria-owns pulls an owned subtree into a modal scan', () => {
  const window = load('<!doctype html><body>' +
    '<div role="dialog" aria-modal="true">' +
    '<button aria-owns="menu" aria-haspopup="menu">Open</button></div>' +
    '<ul id="menu" role="menu"><li role="menuitem">Owned item</li></ul></body>');
  const snapshot = window.aihttp.snapshot({ format: 'json' });
  assert.equal(snapshot.actions.some(function (action) { return action.label === 'Owned item'; }), true);
});

test('maxNodes truncates a huge DOM without silently dropping the page', () => {
  let html = '<!doctype html><body><main>';
  for (let i = 0; i < 300; i++) html += '<button>Action ' + i + '</button>';
  html += '</main></body>';
  const window = load(html);
  const small = window.aihttp.snapshot({ format: 'json', maxNodes: 120, force: true });
  assert.equal(small.meta.truncated, true);
  assert.ok(small.meta.nodes <= 130, 'nodes stopped near the cap, got ' + small.meta.nodes);
  const large = window.aihttp.snapshot({ format: 'json', maxNodes: 5000, maxActions: 500, force: true });
  assert.equal(large.meta.truncated, false);
  assert.equal(large.actions.length, 300);
});

test('an unmatched @supports block does not hide controls', () => {
  const window = load('<!doctype html><body><style>' +
    '@supports (display: grid) { .grid-only { display: none } }' +
    '@supports (aihttp-unknown-prop: 1) { .never { display: none } }' +
    '</style><main><button class="grid-only">Grid hidden</button>' +
    '<button class="never">Never hidden</button></main></body>');
  const labels = window.aihttp.snapshot({ format: 'json' }).actions.map(function (a) { return a.label; });
  assert.equal(labels.indexOf('Grid hidden'), -1);
  assert.ok(labels.indexOf('Never hidden') >= 0);
});

test('a container query block is skipped without layout', () => {
  const page = openHtml('<style>@container (max-width: 1px) { .c { display: none } }</style>' +
    '<main><button class="c">Container action</button></main>');
  assert.match(page.api.snapshot({ format: 'text' }), /Container action/);
});

test('@layer rules still apply', () => {
  const page = openHtml('<style>@layer base { .layered { display: none } }</style>' +
    '<main><button class="layered">Layered hidden</button><button>Plain action</button></main>');
  const text = page.api.snapshot({ format: 'text' });
  assert.doesNotMatch(text, /Layered hidden/);
  assert.match(text, /Plain action/);
});

test('content-visibility hidden removes the subtree', () => {
  const page = openHtml('<main><div style="content-visibility:hidden"><button>CV action</button></div>' +
    '<button>Visible action</button></main>');
  const text = page.api.snapshot({ format: 'text' });
  assert.doesNotMatch(text, /CV action/);
  assert.match(text, /Visible action/);
});

test('a closed popover is not exposed', () => {
  const page = openHtml('<main><button popovertarget="p">Open popover</button>' +
    '<div id="p" popover><button>Inside popover</button></div></main>');
  const text = page.api.snapshot({ format: 'text' });
  assert.match(text, /Open popover/);
  assert.doesNotMatch(text, /Inside popover/);
});
