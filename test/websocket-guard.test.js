'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { guardWebSocketUrl } = require('../lib/browser');

test('a WebSocket to a private address is blocked by default', async () => {
  const result = await guardWebSocketUrl('ws://127.0.0.1:1234/socket', false);
  assert.equal(result.ok, false);
  assert.match(result.error, /private address blocked/);
});

test('a private WebSocket is allowed only with allowPrivate', async () => {
  const result = await guardWebSocketUrl('ws://127.0.0.1:1234/socket', true);
  assert.equal(result.ok, true);
});

test('a WebSocket to localhost is blocked by hostname', async () => {
  const result = await guardWebSocketUrl('wss://localhost/socket', false);
  assert.equal(result.ok, false);
  assert.match(result.error, /private hostname blocked/);
});

test('a non-WebSocket URL is rejected', async () => {
  const result = await guardWebSocketUrl('https://example.com/socket', true);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unsupported_protocol');
});
