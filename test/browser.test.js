'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromiumAvailable, browserGate } = require('../tools/browser-env');

const gate = browserGate(chromiumAvailable(), process.env.AIHTTP_REQUIRE_BROWSER === '1');

const { openBrowserPage, closeBrowser } = require('../lib/browser');

const MAX_PAGES = 8;

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

test('browser backend executes page JavaScript and guards private targets', { skip: gate.skip, timeout: 60000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const local = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Browser fixture</title></head><body>' +
      '<main><h1>Browser fixture</h1><button id="buy">Buy</button><p id="out">idle</p></main>' +
      '<script>document.getElementById("buy").addEventListener("click", function () {' +
      'document.getElementById("out").textContent = "bought";' +
      'document.body.setAttribute("data-after-click", "yes");' +
      '});</script></body></html>');
  });
  try {
    await assert.rejects(openBrowserPage(local.url, { timeout: 15000 }), /private address blocked/);
    const page = await openBrowserPage(local.url, { timeout: 15000, allowPrivate: true });
    t.diagnostic('Chromium ' + page.browser.version());
    try {
      const status = await page.api.status();
      assert.equal(status.locked, false);
      const snapshot = await page.api.snapshot({ format: 'json', maxActions: 60 });
      const buy = snapshot.actions.find((action) => action.label === 'Buy');
      assert.ok(buy, 'browser-rendered button appears in the snapshot');
      const result = await page.api.act(buy.id, null, { settle: true, snapshot: false, diff: true });
      assert.equal(result.ok, true);
      const output = await page.page.evaluate(() => document.getElementById('out').textContent);
      assert.equal(output, 'bought');
      assert.equal(await page.page.evaluate(() => document.body.getAttribute('data-after-click')), 'yes');
    } finally {
      await page.close();
    }
  } finally {
    await closeBrowser();
    await close(local.server);
  }
});

test('evicting the oldest of more than MAX_PAGES pages keeps the newest pages alive', { skip: gate.skip, timeout: 120000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const local = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Eviction fixture</title></head><body><main><h1>Eviction</h1><button>Alive</button></main></body></html>');
  });
  const opened = [];
  try {
    for (let i = 0; i < MAX_PAGES + 1; i++) {
      opened.push(await openBrowserPage(local.url, { timeout: 15000, allowPrivate: true }));
    }
    t.diagnostic('Chromium ' + opened[0].browser.version());
    assert.equal(opened.length, MAX_PAGES + 1);
    await opened[0].close();
    const newest = opened[opened.length - 1];
    const middle = opened[Math.floor(opened.length / 2)];
    assert.equal((await newest.api.status()).locked, false, 'newest page still responds');
    assert.equal((await middle.api.status()).locked, false, 'middle page still responds');
    assert.equal(await newest.page.evaluate(() => document.querySelector('h1').textContent), 'Eviction');
    const contexts = new Set(opened.map((page) => page.context));
    assert.equal(contexts.size, 1, 'aihttp-owned pages share one context');
  } finally {
    for (const page of opened) await page.close();
    await closeBrowser();
    await close(local.server);
  }
});
