'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { giantBudget, giantScanVerdict, DEFAULT_GIANT_MS, REFERENCE_GIANT_MS } = require('../benchmark/lib/torture');

test('giant DOM latency uses a generous default and a configurable warning budget', () => {
  assert.equal(DEFAULT_GIANT_MS, 150);
  assert.equal(REFERENCE_GIANT_MS, 25);
  assert.equal(giantBudget({}), 150);
  assert.equal(giantBudget({ AIHTTP_GIANT_MS: '25' }), 25);
  assert.equal(giantBudget({ AIHTTP_GIANT_MS: '400.5' }), 400.5);
  assert.equal(giantBudget({ AIHTTP_GIANT_MS: '0' }), 150, 'zero falls back to the default');
  assert.equal(giantBudget({ AIHTTP_GIANT_MS: '-5' }), 150, 'negative values fall back to the default');
  assert.equal(giantBudget({ AIHTTP_GIANT_MS: 'nope' }), 150, 'invalid values fall back to the default');
});

test('a slow scan warns but never fails the correctness run', () => {
  const slow = giantScanVerdict(500, 150);
  assert.equal(slow.pass, true, 'latency is advisory, not a correctness failure');
  assert.equal(slow.warning, true);
  assert.equal(slow.budget, 150);
  const reference = giantScanVerdict(35, 150);
  assert.equal(reference.pass, true);
  assert.equal(reference.warning, false, 'the old 25 ms reference is not a gate');
  const fast = giantScanVerdict(12, 150);
  assert.equal(fast.warning, false);
});
