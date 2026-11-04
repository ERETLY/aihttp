'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const pkg = require('../package.json');

test('minified build exposes the same public version and a working snapshot', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ahttp.min.js'), 'utf8');
  const dom = new JSDOM('<!doctype html><body><main><button>Place order</button></main></body>', {
    url: 'https://min.test/',
    runScripts: 'outside-only'
  });
  dom.window.eval(source);
  assert.equal(dom.window.ahttp.version, pkg.version);
  const snapshot = dom.window.ahttp.snapshot({ format: 'json' });
  assert.equal(snapshot.actions.length, 1);
  assert.equal(snapshot.actions[0].label, 'Place order');
});
