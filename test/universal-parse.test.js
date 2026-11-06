'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'ahttp.js'), 'utf8');

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
  const snapshot = window.ahttp.snapshot({ format: 'json' });
  assert.ok(snapshot.actions.some(function (action) { return action.label === 'Save'; }));
});

test('a small aria-modal=false dialog does not become the scan root', () => {
  const window = load('<!doctype html><body>' +
    '<div role="dialog" aria-modal="false">Cookie notice</div>' +
    '<button>Save</button></body>');
  const snapshot = window.ahttp.snapshot({ format: 'json' });
  assert.ok(snapshot.actions.some(function (action) { return action.label === 'Save'; }));
});

test('an aria-modal=true dialog still scopes the scan', () => {
  const window = load('<!doctype html><body>' +
    '<div role="dialog" aria-modal="true"><button>OK</button></div>' +
    '<button>Outside</button></body>');
  const snapshot = window.ahttp.snapshot({ format: 'json' });
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
  const snapshot = window.ahttp.snapshot({ format: 'json' });
  const target = snapshot.actions.find(function (action) { return action.label === 'Pick'; });
  assert.ok(target);

  const result = await window.ahttp.act(target.id, { value: 'Two', wait: 500 }, actOptions());
  assert.equal(result.status, 'ok');
  assert.equal(result.selected, 'Two');
});

test('settle ignores a request that was already in flight', async () => {
  const window = load('<!doctype html><body>' +
    '<button id="slow">Slow</button><button id="fast">Fast</button></body>');
  const document = window.document;
  window.fetch = function () { return new Promise(function () {}); };
  document.getElementById('slow').addEventListener('click', function () { window.fetch('/slow'); });
  const snapshot = window.ahttp.snapshot({ format: 'json' });
  const slow = snapshot.actions.find(function (action) { return action.label === 'Slow'; });
  const fast = snapshot.actions.find(function (action) { return action.label === 'Fast'; });
  assert.ok(slow && fast);

  await window.ahttp.act(slow.id, {}, { quiet: 0, minWait: 0, timeout: 120 });
  const started = Date.now();
  const result = await window.ahttp.act(fast.id, {}, { quiet: 0, minWait: 0, timeout: 120 });
  const elapsed = Date.now() - started;
  assert.equal(result.status, 'ok');
  assert.ok(elapsed < 100, 'second action waited ' + elapsed + ' ms for the first request');
});

test('a custom combobox reads aria-activedescendant as its value', async () => {
  const window = load('<!doctype html><body>' +
    '<div role="combobox" aria-activedescendant="opt2"><span id="opt2">Two</span></div></body>');
  const snapshot = window.ahttp.snapshot({ format: 'json' });
  const target = snapshot.actions.find(function (action) { return action.role === 'combobox'; });
  assert.ok(target);

  const result = await window.ahttp.act(target.id, { read: true }, actOptions());
  assert.equal(result.status, 'ok');
  assert.equal(result.value, 'Two');
});

test('aria-owns pulls an owned subtree into a modal scan', () => {
  const window = load('<!doctype html><body>' +
    '<div role="dialog" aria-modal="true">' +
    '<button aria-owns="menu" aria-haspopup="menu">Open</button></div>' +
    '<ul id="menu" role="menu"><li role="menuitem">Owned item</li></ul></body>');
  const snapshot = window.ahttp.snapshot({ format: 'json' });
  assert.equal(snapshot.actions.some(function (action) { return action.label === 'Owned item'; }), true);
});

test('maxNodes truncates a huge DOM without silently dropping the page', () => {
  let html = '<!doctype html><body><main>';
  for (let i = 0; i < 300; i++) html += '<button>Action ' + i + '</button>';
  html += '</main></body>';
  const window = load(html);
  const small = window.ahttp.snapshot({ format: 'json', maxNodes: 120, force: true });
  assert.equal(small.meta.truncated, true);
  assert.ok(small.meta.nodes <= 130, 'nodes stopped near the cap, got ' + small.meta.nodes);
  const large = window.ahttp.snapshot({ format: 'json', maxNodes: 5000, maxActions: 500, force: true });
  assert.equal(large.meta.truncated, false);
  assert.equal(large.actions.length, 300);
});
