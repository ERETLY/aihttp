'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'ahttp.js'), 'utf8');
const OPTIONS = { quiet: 0, minWait: 0, timeout: 250 };

function load(html) {
  const dom = new JSDOM(html, { url: 'https://effect.test/', runScripts: 'outside-only' });
  dom.window.eval(ENGINE);
  return dom.window;
}

test('an expected change that never happens returns no_effect', async () => {
  const window = load('<!doctype html><body><main><button>Save</button><p id="out">idle</p></main></body>');
  window.ahttp.snapshot({ format: 'json' });
  const result = await window.ahttp.act('a1', { expect: { diff: true } }, OPTIONS);
  assert.equal(result.ok, true, 'the click itself ran');
  assert.equal(result.status, 'no_effect');
  assert.equal(result.effect.ok, false);
  assert.equal(result.effect.observed.diffEmpty, true);
  assert.match(result.effect.failures.join(' '), /expected a visible change/);
  assert.match(result.warning, /match may be wrong/);
  assert.equal(result.diff.empty, true);
});

test('a satisfied expectation keeps status ok', async () => {
  const window = load('<!doctype html><body><main><button>Save</button><p id="out">idle</p></main></body>');
  const document = window.document;
  document.querySelector('button').addEventListener('click', function () { document.getElementById('out').textContent = 'Saved'; });
  window.ahttp.snapshot({ format: 'json' });
  const result = await window.ahttp.act('a1', { expect: { textAdded: ['Saved'], pageText: { selector: '#out', equals: 'Saved' } } }, OPTIONS);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ok');
  assert.equal(result.effect.ok, true);
  assert.equal(result.effect.failures.length, 0);
});

test('expectations cover added and removed actions', async () => {
  const window = load('<!doctype html><body><main id="app"><button id="add">Add</button><p id="out">idle</p></main></body>');
  const document = window.document;
  document.getElementById('add').addEventListener('click', function () {
    const extra = document.createElement('button');
    extra.textContent = 'Dismiss';
    extra.addEventListener('click', function () { extra.remove(); });
    document.getElementById('app').appendChild(extra);
  });
  window.ahttp.snapshot({ format: 'json' });
  const added = await window.ahttp.act('a1', { expect: { added: ['Dismiss'] } }, OPTIONS);
  assert.equal(added.status, 'ok');
  assert.equal(added.effect.ok, true);

  const snapshot = window.ahttp.snapshot({ format: 'json' });
  const dismiss = snapshot.actions.find(function (action) { return action.label === 'Dismiss'; });
  assert.ok(dismiss);
  const removed = await window.ahttp.act(dismiss.id, { expect: { removed: ['Dismiss'] } }, OPTIONS);
  assert.equal(removed.status, 'ok');
  assert.equal(removed.effect.ok, true);
});

test('urlChanged is checked against the diff URL', async () => {
  const window = load('<!doctype html><body><main><button>Finish</button></main></body>');
  const document = window.document;
  document.querySelector('button').addEventListener('click', function () {
    window.history.pushState({}, '', '/done');
  });
  window.ahttp.snapshot({ format: 'json' });
  const result = await window.ahttp.act('a1', { expect: { urlChanged: true } }, OPTIONS);
  assert.equal(result.status, 'ok');
  assert.equal(result.effect.ok, true);
  assert.equal(result.diff.url.to, 'https://effect.test/done');
});

test('a failed expectation does not hide the action error', async () => {
  const window = load('<!doctype html><body><main><button disabled>Delete</button></main></body>');
  window.ahttp.snapshot({ format: 'json' });
  const result = await window.ahttp.act('a1', { expect: { diff: true } }, OPTIONS);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.effect, undefined);
});

test('an expected change that arrives after the quiet window is still ok', async () => {
  const window = load('<!doctype html><body><main><button id="b">Save</button><p id="out">idle</p></main></body>');
  const document = window.document;
  document.getElementById('b').addEventListener('click', function () {
    window.setTimeout(function () { document.getElementById('out').textContent = 'Saved'; }, 150);
  });
  window.ahttp.snapshot({ format: 'json' });
  // Default settle options: 40 ms quiet window, 1200 ms timeout.
  const result = await window.ahttp.act('a1', { expect: { textAdded: ['Saved'], pageText: { selector: '#out', equals: 'Saved' } } });
  assert.equal(result.status, 'ok');
  assert.equal(result.effect.ok, true);
  assert.match(result.diff.text, /Saved/);
  assert.match(result.snapshot, /Saved/);
});

test('a change that arrives after the timeout is no_effect', async () => {
  const window = load('<!doctype html><body><main><button id="b">Save</button><p id="out">idle</p></main></body>');
  const document = window.document;
  document.getElementById('b').addEventListener('click', function () {
    window.setTimeout(function () { document.getElementById('out').textContent = 'Saved'; }, 400);
  });
  window.ahttp.snapshot({ format: 'json' });
  const result = await window.ahttp.act('a1', { expect: { textAdded: ['Saved'] }, timeout: 150 });
  assert.equal(result.ok, true, 'the click ran');
  assert.equal(result.status, 'no_effect');
});

test('a satisfied expectation does not wait for the timeout', async () => {
  const window = load('<!doctype html><body><main><button id="b">Save</button><p id="out">idle</p></main></body>');
  const document = window.document;
  document.getElementById('b').addEventListener('click', function () { document.getElementById('out').textContent = 'Saved'; });
  window.ahttp.snapshot({ format: 'json' });
  const started = Date.now();
  const result = await window.ahttp.act('a1', { expect: { textAdded: ['Saved'] } });
  assert.equal(result.status, 'ok');
  assert.ok(Date.now() - started < 400, 'took ' + (Date.now() - started) + 'ms');
});
