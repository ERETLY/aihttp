'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromiumAvailable, browserGate } = require('../tools/browser-env');

const gate = browserGate(chromiumAvailable(), process.env.AIHTTP_REQUIRE_BROWSER === '1');
const { openBrowserPage, closeBrowser } = require('../lib/browser');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('a strict CSP does not stop the browser backend', { skip: gate.skip, timeout: 60000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const local = await listen((req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; script-src 'none'; style-src 'none'"
    });
    res.end('<!doctype html><body><main><h1>CSP page</h1><button>Continue</button></main></body>');
  });
  try {
    const page = await openBrowserPage(local.url, { timeout: 15000, allowPrivate: true });
    t.after(async () => { await page.close(); });
    const snapshot = await page.api.snapshot({ format: 'json', maxActions: 40 });
    const button = snapshot.actions.find((action) => action.label === 'Continue');
    assert.ok(button, 'the engine runs despite script-src none');
    const result = await page.api.act(button.id, {}, { settle: true });
    assert.equal(result.ok, true);
  } finally {
    await close(local.server);
    await closeBrowser();
  }
});
