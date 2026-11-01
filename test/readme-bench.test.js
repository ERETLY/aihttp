'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('../scripts/render-bench');

const ROOT = path.join(__dirname, '..');
const START = '<!-- BENCH:START -->';
const END = '<!-- BENCH:END -->';

test('README benchmark block matches benchmark/results.json', () => {
  const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'benchmark', 'results.json'), 'utf8').replace(/^\uFEFF/, ''));
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  assert.ok(start >= 0 && end > start, 'README has BENCH markers');
  const actual = readme.slice(start + START.length, end).trim();
  const expected = render(results).trim();
  assert.equal(actual, expected,
    'README benchmark block is stale; run `node benchmark/run.js` then `node scripts/render-bench.js --write`');
  assert.match(actual, /Chromium \d+\.\d+/, 'caption names the Chromium build');
});
