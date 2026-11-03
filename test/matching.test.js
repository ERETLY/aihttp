'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'ahttp.js'), 'utf8');

function load(html) {
  const dom = new JSDOM(html, { url: 'https://match.test/', runScripts: 'outside-only' });
  dom.window.eval(ENGINE);
  return dom.window;
}

function actOptions() {
  return { quiet: 0, minWait: 0, timeout: 250 };
}

test('stable testid beats a changed fingerprint after a rerender', async () => {
  const window = load('<!doctype html><body><main id="app">' +
    '<button data-testid="keep" id="keep">Save</button>' +
    '<button data-testid="other" id="other">Save</button>' +
    '<p id="out">idle</p></main></body>');
  const document = window.document;
  document.getElementById('keep').addEventListener('click', function () { document.getElementById('out').textContent = 'keep'; });
  document.getElementById('other').addEventListener('click', function () { document.getElementById('out').textContent = 'other'; });
  const snapshot = window.ahttp.snapshot({ format: 'json' });
  const target = snapshot.actions.find(function (action) { return action.label === 'Save' && action.id === 'a1'; });
  assert.ok(target);

  document.getElementById('app').innerHTML =
    '<button data-testid="keep">Save</button>' +
    '<button data-testid="other">Save</button>' +
    '<p id="out">idle</p>';
  const replacement = document.querySelector('[data-testid="keep"]');
  replacement.addEventListener('click', function () { document.getElementById('out').textContent = 'keep'; });
  document.querySelector('[data-testid="other"]').addEventListener('click', function () { document.getElementById('out').textContent = 'other'; });

  const result = await window.ahttp.act(target.id, null, actOptions());
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ok');
  assert.equal(document.getElementById('out').textContent, 'keep');
});

test('two identical controls return structured ambiguous and do not click', async () => {
  const window = load('<!doctype html><body><main id="app">' +
    '<button>OK</button><button>OK</button><p id="out">idle</p></main></body>');
  const document = window.document;
  const snapshot = window.ahttp.snapshot({ format: 'json' });
  assert.equal(snapshot.actions.length, 2);
  document.getElementById('app').innerHTML =
    '<button onclick="document.getElementById(\'out\').textContent=\'clicked\'">OK</button>' +
    '<button onclick="document.getElementById(\'out\').textContent=\'clicked\'">OK</button>' +
    '<p id="out">idle</p>';

  const result = await window.ahttp.act('a1', { targetHint: 'first OK' }, actOptions());
  assert.equal(result.ok, false);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.error, 'ambiguous');
  assert.equal(result.targetHint, 'first OK');
  assert.equal(result.candidates.length, 2);
  for (const candidate of result.candidates) {
    assert.match(candidate.id, /^a\d+$/);
    assert.equal(candidate.role, 'button');
    assert.equal(candidate.name, 'OK');
    assert.equal(typeof candidate.score, 'number');
    assert.ok(candidate.score > 0);
  }
  assert.equal(result.thresholds.ambiguous < result.thresholds.accept, true);
  assert.equal(document.getElementById('out').textContent, 'idle', 'ambiguous must not dispatch a click');
});

test('confirm does not override ambiguous', async () => {
  const window = load('<!doctype html><body><main id="app">' +
    '<button>Delete</button><button>Delete</button><p id="out">idle</p></main></body>');
  const document = window.document;
  window.ahttp.snapshot({ format: 'json' });
  document.getElementById('app').innerHTML =
    '<button onclick="document.getElementById(\'out\').textContent=\'clicked\'">Delete</button>' +
    '<button onclick="document.getElementById(\'out\').textContent=\'clicked\'">Delete</button>' +
    '<p id="out">idle</p>';
  const result = await window.ahttp.act('a1', { confirm: true }, actOptions());
  assert.equal(result.status, 'ambiguous');
  assert.equal(document.getElementById('out').textContent, 'idle');
});

test('no content anchor means not_found, not a positional guess', async () => {
  const window = load('<!doctype html><body><main><div id="list">' +
    '<a href="#2">Item 2</a></div><p id="out">idle</p></main></body>');
  const document = window.document;
  window.ahttp.snapshot({ format: 'json' });
  document.getElementById('list').innerHTML = '<a href="#4">Item 4</a><a href="#5">Item 5</a>';
  const result = await window.ahttp.act('a1', null, actOptions());
  assert.equal(result.ok, false);
  assert.equal(result.status, 'not_found');
  assert.equal(result.error, 'detached_action');
  assert.equal(document.getElementById('out').textContent, 'idle');
});

test('a disabled replacement is not an active match', async () => {
  const window = load('<!doctype html><body><main id="app">' +
    '<button id="go">Run</button><p id="out">idle</p></main></body>');
  const document = window.document;
  document.getElementById('go').addEventListener('click', function () { document.getElementById('out').textContent = 'old'; });
  window.ahttp.snapshot({ format: 'json' });
  document.getElementById('app').innerHTML = '<button id="go" disabled>Run</button><p id="out">idle</p>';
  document.getElementById('go').addEventListener('click', function () { document.getElementById('out').textContent = 'new'; });
  const result = await window.ahttp.act('a1', null, actOptions());
  assert.equal(result.status, 'not_found');
  assert.equal(document.getElementById('out').textContent, 'idle');
});

test('candidate order is stable across repeated ambiguous calls', async () => {
  const window = load('<!doctype html><body><main id="app">' +
    '<button>OK</button><button>OK</button><p id="out">idle</p></main></body>');
  const document = window.document;
  window.ahttp.snapshot({ format: 'json' });
  document.getElementById('app').innerHTML =
    '<button>OK</button><button>OK</button><p id="out">idle</p>';
  const first = await window.ahttp.act('a1', null, actOptions());
  const second = await window.ahttp.act('a1', null, actOptions());
  assert.equal(first.status, 'ambiguous');
  assert.equal(second.status, 'ambiguous');
  assert.deepEqual(first.candidates, second.candidates);
});

test('a connected but now-hidden target is not actionable', async () => {
  const window = load('<!doctype html><body><main><button id="go">Run</button><p id="out">idle</p></main></body>');
  const document = window.document;
  document.getElementById('go').addEventListener('click', function () { document.getElementById('out').textContent = 'clicked'; });
  window.ahttp.snapshot({ format: 'json' });
  document.getElementById('go').style.display = 'none';
  const result = await window.ahttp.act('a1', null, actOptions());
  assert.equal(result.status, 'not_found');
  assert.equal(document.getElementById('out').textContent, 'idle');
});

test('a disabled twin is scored and reported but cannot win', async () => {
  const window = load('<!doctype html><body><main id="app">' +
    '<button>Run</button><p id="out">idle</p></main></body>');
  const document = window.document;
  window.ahttp.snapshot({ format: 'json' });
  document.getElementById('app').innerHTML =
    '<button disabled onclick="document.getElementById(\'out\').textContent=\'disabled\'">Run</button>' +
    '<button onclick="document.getElementById(\'out\').textContent=\'active\'">Run</button>' +
    '<p id="out">idle</p>';
  const result = await window.ahttp.act('a1', null, actOptions());
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.some(function (c) { return c.disabled === true; }));
  assert.equal(document.getElementById('out').textContent, 'idle');
});

test('unknown ids and successful actions carry a status', async () => {
  const window = load('<!doctype html><body><main><button>Go</button></main></body>');
  const document = window.document;
  window.ahttp.snapshot({ format: 'json' });
  const missing = await window.ahttp.act('a99', null, actOptions());
  assert.equal(missing.status, 'not_found');
  assert.equal(missing.error, 'unknown_action');
  document.querySelector('button').addEventListener('click', function () {});
  const done = await window.ahttp.act('a1', null, actOptions());
  assert.equal(done.status, 'ok');
});

test('position cannot pick between label-identical twins', async () => {
  const window = load('<!doctype html><body><main id="app"><div><button>OK</button></div></main><footer id="f"></footer></body>');
  const document = window.document;
  window.ahttp.snapshot({ format: 'json' });
  // The second OK is far from the original in DOM order, so it earns almost no
  // positional points. Before the content margin this clicked the first one.
  document.getElementById('app').innerHTML = '<div><button>OK</button></div>' +
    '<button>F1</button><button>F2</button><button>F3</button><button>F4</button><button>F5</button><button>F6</button>';
  document.getElementById('f').innerHTML = '<button>OK</button>';
  document.querySelectorAll('button').forEach(function (button) {
    button.addEventListener('click', function () { document.body.setAttribute('data-clicked', 'yes'); });
  });
  const result = await window.ahttp.act('a1', null, actOptions());
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.candidates.length, 2);
  assert.equal(result.thresholds.contentMargin, 5);
  assert.equal(document.body.getAttribute('data-clicked'), null, 'ambiguous must not dispatch a click');
});

test('a real content advantage still wins over a close positional score', async () => {
  const window = load('<!doctype html><body><main id="app"><button>OK</button></main></body>');
  const document = window.document;
  window.ahttp.snapshot({ format: 'json' });
  document.getElementById('app').innerHTML = '<button id="exact">OK</button><button id="lower">ok</button>';
  document.getElementById('exact').addEventListener('click', function () { document.body.setAttribute('data-clicked', 'exact'); });
  document.getElementById('lower').addEventListener('click', function () { document.body.setAttribute('data-clicked', 'lower'); });
  const result = await window.ahttp.act('a1', null, actOptions());
  assert.equal(result.status, 'ok');
  assert.equal(document.body.getAttribute('data-clicked'), 'exact');
});
