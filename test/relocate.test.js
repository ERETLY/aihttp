'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'aihttp.js'), 'utf8');

test('relocation prefers a matching DOM id over an ambiguous label', async () => {
  const dom = new JSDOM('<!doctype html><html><head><title>Relocate</title></head><body>' +
    '<main><button id="a">Go</button><button id="b">Go</button><p id="out">idle</p></main>' +
    '</body></html>', { url: 'https://relocate.test/', runScripts: 'outside-only' });
  const window = dom.window;
  window.eval(ENGINE);
  const document = window.document;
  function listen(node) {
    node.addEventListener('click', function () { document.getElementById('out').textContent = node.id; });
  }
  listen(document.getElementById('a'));
  listen(document.getElementById('b'));

  const snapshot = window.aihttp.snapshot({ format: 'json' });
  const old = snapshot.actions.find((action) => action.name === 'a') ||
    snapshot.actions.find((action) => action.id === 'a1');
  assert.ok(old, 'first Go button is in the snapshot');

  const replacement = document.createElement('button');
  replacement.id = 'a';
  replacement.textContent = 'Go';
  const main = document.querySelector('main');
  document.getElementById('a').remove();
  main.appendChild(replacement);
  listen(replacement);

  const result = await window.aihttp.act(old.id, null, { quiet: 0, minWait: 0 });
  assert.equal(result.ok, true);
  assert.equal(document.getElementById('out').textContent, 'a');
});
