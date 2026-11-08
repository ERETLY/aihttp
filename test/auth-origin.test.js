'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'aihttp.js'), 'utf8');

function load(attributes, url) {
  const dom = new JSDOM('<!doctype html><body><script ' + attributes + '></script></body>', {
    url: url || 'https://site.test/page',
    runScripts: 'outside-only'
  });
  dom.window.eval(ENGINE);
  const calls = [];
  dom.window.fetch = function (target, init) {
    calls.push({ target: target, init: init });
    return Promise.resolve({
      ok: true,
      status: 200,
      text: function () { return Promise.resolve('{"ok":true}'); }
    });
  };
  return { window: dom.window, calls: calls };
}

test('a page cannot point the auth endpoint at another origin', async (t) => {
  const loaded = load('data-aihttp-access="owner" data-aihttp-auth-endpoint="https://evil.test/auth"');
  t.after(function () { loaded.window.close(); });
  const result = await loaded.window.aihttp.authorize({ token: 'secret' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'auth_endpoint_origin');
  assert.equal(loaded.calls.length, 0);
});

test('same-origin auth keeps the session cookie', async (t) => {
  const loaded = load('data-aihttp-access="owner" data-aihttp-auth-endpoint="/api/aihttp/authorize"');
  t.after(function () { loaded.window.close(); });
  const result = await loaded.window.aihttp.authorize({ token: 'secret' });
  assert.equal(result.ok, true);
  assert.equal(loaded.calls.length, 1);
  assert.equal(loaded.calls[0].target, 'https://site.test/api/aihttp/authorize');
  assert.equal(loaded.calls[0].init.credentials, 'include');
  assert.equal(loaded.calls[0].init.headers.authorization, 'Bearer secret');
});

test('an explicit auth origin allowlist permits cross-origin without cookies', async (t) => {
  const loaded = load('data-aihttp-access="owner" ' +
    'data-aihttp-auth-endpoint="https://auth.test/session" ' +
    'data-aihttp-auth-origins="https://auth.test"');
  t.after(function () { loaded.window.close(); });
  const result = await loaded.window.aihttp.authorize({ token: 'secret' });
  assert.equal(result.ok, true);
  assert.equal(loaded.calls.length, 1);
  assert.equal(loaded.calls[0].target, 'https://auth.test/session');
  assert.equal(loaded.calls[0].init.credentials, 'omit');
});

test('a different origin is still rejected when only another origin is allowed', async (t) => {
  const loaded = load('data-aihttp-access="owner" ' +
    'data-aihttp-auth-endpoint="https://evil.test/session" ' +
    'data-aihttp-auth-origins="https://auth.test"');
  t.after(function () { loaded.window.close(); });
  const result = await loaded.window.aihttp.authorize({ token: 'secret' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'auth_endpoint_origin');
  assert.equal(loaded.calls.length, 0);
});
