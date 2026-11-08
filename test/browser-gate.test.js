'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { browserGate } = require('../tools/browser-env');

test('browser gate skips when Chromium is optional and missing', () => {
  const gate = browserGate(false, false);
  assert.equal(gate.skip === false, false);
  assert.match(gate.skip, /AIHTTP_REQUIRE_BROWSER=1/);
  assert.equal(gate.fail, false);
});

test('browser gate fails when Chromium is required and missing', () => {
  const gate = browserGate(false, true);
  assert.equal(gate.skip, false);
  assert.equal(gate.fail, true);
  assert.match(gate.reason, /AIHTTP_REQUIRE_BROWSER=1/);
});

test('browser gate runs the test when Chromium is available', () => {
  assert.deepEqual(browserGate(true, false), { skip: false, fail: false });
  assert.deepEqual(browserGate(true, true), { skip: false, fail: false });
});
