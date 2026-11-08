'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runCorpus, loadCases } = require('../corpus/runner');

const CASES = loadCases();

test('the matching corpus is green and has at least 20 cases', { timeout: 120000 }, async () => {
  assert.ok(CASES.length >= 20, 'corpus has ' + CASES.length + ' cases');
  const result = await runCorpus({ write: process.env.AIHTTP_CORPUS_WRITE !== '0' });
  assert.equal(result.totals.failed, 0, 'failed cases: ' + result.cases
    .filter(function (item) { return item.status === 'FAIL'; })
    .map(function (item) { return item.id + ' [' + item.failures.join('; ') + ']'; })
    .join(', '));
  assert.equal(result.totals.cases, CASES.length);
});

test('corpus fixtures do not load network resources', () => {
  const dir = path.join(__dirname, '..', 'corpus', 'fixtures');
  const files = fs.readdirSync(dir).filter(function (name) { return /\.html$/.test(name); });
  assert.ok(files.length > 0);
  for (const file of files) {
    const html = fs.readFileSync(path.join(dir, file), 'utf8');
    const external = html.match(/(?:src|href)\s*=\s*["'](?:https?:)?\/\//gi) || [];
    assert.deepEqual(external, [], file + ' must not reference a network resource');
  }
});
