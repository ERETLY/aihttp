'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'aihttp.js'), 'utf8');

function load(html) {
  const dom = new JSDOM(html, { url: 'https://settle.test/', runScripts: 'outside-only' });
  dom.window.eval(ENGINE);
  return { aihttp: dom.window.aihttp, window: dom.window };
}

const PAGE = '<!doctype html><html><head><title>Counter</title></head><body><main>' +
  '<p id="out">idle</p><button id="go">Run</button>' +
  '</main></body></html>';

test('a DOM-only action settles without waiting for the old fixed floor', async () => {
  const { aihttp, window } = load(PAGE);
  window.document.getElementById('go').addEventListener('click', function () {
    window.document.getElementById('out').textContent = 'finished';
  });
  const started = Date.now();
  const result = await aihttp.act('a1');
  const elapsed = Date.now() - started;
  assert.equal(result.ok, true);
  assert.match(result.snapshot, /finished/);
  assert.ok(elapsed < 250, 'settle took ' + elapsed + 'ms');
});

test('settle options can shorten the wait explicitly', async () => {
  const { aihttp } = load(PAGE);
  const started = Date.now();
  const result = await aihttp.act('a1', null, { quiet: 0, minWait: 0 });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, true);
  assert.ok(elapsed < 120, 'explicit settle took ' + elapsed + 'ms');
});
