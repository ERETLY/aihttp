'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromiumAvailable, browserGate } = require('../tools/browser-env');

const gate = browserGate(chromiumAvailable(), process.env.AHTTP_REQUIRE_BROWSER === '1');
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

test('a link click navigates once and act reports the new URL', { skip: gate.skip, timeout: 60000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const hits = [];
  const local = await listen((req, res) => {
    hits.push(req.url);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (req.url === '/next') {
      res.end('<!doctype html><body><h1>Next page</h1><button>Done</button></body>');
      return;
    }
    res.end('<!doctype html><body><a href="/next">Go</a></body>');
  });
  try {
    const page = await openBrowserPage(local.url, { timeout: 15000, allowPrivate: true });
    t.after(async () => { await page.close(); });
    const snapshot = await page.api.snapshot({ format: 'json', maxActions: 40 });
    const go = snapshot.actions.find((action) => action.label === 'Go');
    assert.ok(go);

    const result = await page.api.act(go.id, {}, { settle: true });
    assert.equal(result.ok, true);
    assert.equal(result.navigated, true);
    await page.page.waitForTimeout(300);

    assert.equal(hits.filter((url) => url === '/next').length, 1, '/next is requested exactly once');
    assert.equal(page.page.url(), local.url + 'next');
    const next = await page.api.snapshot({ format: 'json', maxActions: 40 });
    assert.ok(next.actions.some((action) => action.label === 'Done'));
  } finally {
    await close(local.server);
    await closeBrowser();
  }
});
