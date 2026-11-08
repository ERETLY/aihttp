'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { render } = require('../scripts/build-self');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'self', 'aihttp.user.js');

test('the self-use userscript is generated and current', () => {
  const current = fs.readFileSync(FILE, 'utf8');
  assert.equal(current, render(), 'run npm run build:self');
  assert.match(current, /@name\s+ahttp self-use/);
  assert.match(current, /@match\s+https:\/\/\*\/\*/);
  assert.match(current, /@grant\s+none/);
  assert.match(current, /@noframes/);
});

test('the userscript exposes a panel on a normal page', () => {
  const dom = new JSDOM('<!doctype html><html><head><title>Self</title></head><body>' +
    '<main><button id="go">Run</button></main></body></html>',
  { url: 'https://self.test/', runScripts: 'outside-only' });
  const window = dom.window;
  window.eval(fs.readFileSync(FILE, 'utf8'));
  assert.equal(typeof window.ahttp.snapshot, 'function');
  const host = window.document.querySelector('[data-ahttp-self]');
  assert.ok(host, 'panel host is attached');
  const toggle = host.shadowRoot.querySelector('button.toggle');
  assert.equal(toggle.textContent, 'ahttp');
  toggle.click();
  assert.match(host.shadowRoot.querySelector('textarea').value, /a1 button "Run"/);
  assert.doesNotMatch(host.shadowRoot.querySelector('textarea').value, /button "Scan"/, 'the panel does not scan itself');
});
