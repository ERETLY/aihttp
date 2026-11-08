'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createServer } = require('../bin/aihttp-serve');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve('http://127.0.0.1:' + server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function target(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' });
    });
  });
}

test('aihttp serve returns the format envelope and a snapshot', { timeout: 30000 }, async (t) => {
  const page = await target((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><body><main><h1>Format</h1>' +
      '<button data-aihttp-intent="save">Save</button></main></body>');
  });
  const server = createServer({ allowPrivate: true, browser: false, token: '' });
  const base = await listen(server);
  t.after(async () => { await close(server); await close(page.server); });

  const health = await fetch(base + '/health').then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.protocol, 'aihttp/1');
  assert.equal(health.name, 'aihttp');

  const res = await fetch(base + '/?url=' + encodeURIComponent(page.url));
  assert.match(res.headers.get('content-type'), /application\/aihttp\+json/);
  const body = await res.json();
  assert.equal(body.protocol, 'aihttp/1');
  assert.equal(body.format, 'aihttp');
  assert.equal(body.formatVersion, 1);
  assert.ok(body.actions.some((action) => action.label === 'save'));

  const acted = await fetch(base + '/act', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: page.url, id: body.actions[0].id })
  }).then((r) => r.json());
  assert.equal(acted.ok, true);
  assert.equal(acted.protocol, 'aihttp/1');
});

test('aihttp serve enforces its bearer token', { timeout: 30000 }, async (t) => {
  const page = await target((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><body><button>Ping</button></body>');
  });
  const server = createServer({ allowPrivate: true, browser: false, token: 's3cret' });
  const base = await listen(server);
  t.after(async () => { await close(server); await close(page.server); });

  const denied = await fetch(base + '/?url=' + encodeURIComponent(page.url));
  assert.equal(denied.status, 401);

  const allowed = await fetch(base + '/?url=' + encodeURIComponent(page.url), {
    headers: { authorization: 'Bearer s3cret' }
  });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.ok(body.actions.some((action) => action.label === 'Ping'));
});

test('aihttp serve rejects a non-http target', { timeout: 30000 }, async (t) => {
  const server = createServer({ allowPrivate: true, browser: false, token: '' });
  const base = await listen(server);
  t.after(async () => { await close(server); });

  const res = await fetch(base + '/?url=' + encodeURIComponent('file:///etc/passwd'));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /http or https/);
});

test('aihttp serve refuses a public bind without a token', () => {
  const { assertBindSafe } = require('../bin/aihttp-serve');
  assert.doesNotThrow(() => assertBindSafe('127.0.0.1', ''));
  assert.doesNotThrow(() => assertBindSafe('localhost', ''));
  assert.doesNotThrow(() => assertBindSafe('::1', ''));
  assert.doesNotThrow(() => assertBindSafe('0.0.0.0', 'secret'));
  assert.throws(() => assertBindSafe('0.0.0.0', ''), /without a token/);
  assert.throws(() => assertBindSafe('192.168.1.10', ''), /without a token/);
});

test('aihttp serve rejects local file paths over HTTP', { timeout: 30000 }, async (t) => {
  const server = createServer({ allowPrivate: true, browser: false, token: '' });
  const base = await listen(server);
  t.after(async () => { await close(server); });

  const res = await fetch(base + '/act', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1:1/', id: 'a1', files: ['C:/Windows/win.ini'] })
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /files are not accepted over HTTP/);
});
