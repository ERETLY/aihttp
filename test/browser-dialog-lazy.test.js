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

test('a native confirm follows the dialog policy', { skip: gate.skip, timeout: 60000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const local = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><body><main>' +
      '<button id="ask">Delete</button><p id="out">idle</p></main><script>' +
      'document.getElementById("ask").addEventListener("click", function () {' +
      'document.getElementById("out").textContent = String(window.confirm("Delete it?"));' +
      '});</script></body>');
  });
  try {
    const page = await openBrowserPage(local.url, { timeout: 15000, allowPrivate: true });
    t.after(async () => { await page.close(); });
    const snapshot = await page.api.snapshot({ format: 'json', maxActions: 40 });
    const ask = snapshot.actions.find((action) => action.label === 'Delete');
    assert.ok(ask);

    const accepted = await page.api.act(ask.id, { dialog: 'accept' }, { settle: true });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.dialogs[0].accepted, true);
    assert.equal(await page.page.evaluate(() => document.getElementById('out').textContent), 'true');

    const dismissed = await page.api.act(ask.id, { dialog: 'dismiss' }, { settle: true });
    assert.equal(dismissed.ok, true);
    assert.equal(dismissed.dialogs[0].accepted, false);
    assert.equal(await page.page.evaluate(() => document.getElementById('out').textContent), 'false');
  } finally {
    await close(local.server);
    await closeBrowser();
  }
});

test('lazy scrolling reveals a section created by IntersectionObserver', { skip: gate.skip, timeout: 60000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const local = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><body><main>' +
      '<div style="height:2400px">spacer</div><div id="sentinel"></div></main><script>' +
      'var io = new IntersectionObserver(function (entries) {' +
      'if (entries.some(function (e) { return e.isIntersecting; })) {' +
      'var b = document.createElement("button"); b.textContent = "Loaded later";' +
      'document.querySelector("main").appendChild(b); io.disconnect();' +
      '}}); io.observe(document.getElementById("sentinel"));</script></body>');
  });
  try {
    const page = await openBrowserPage(local.url, { timeout: 15000, allowPrivate: true });
    t.after(async () => { await page.close(); });
    const before = await page.api.snapshot({ format: 'json', maxActions: 40 });
    assert.equal(before.actions.some((action) => action.label === 'Loaded later'), false);

    const after = await page.api.snapshot({ format: 'json', maxActions: 40, lazy: true });
    assert.equal(after.actions.some((action) => action.label === 'Loaded later'), true);
  } finally {
    await close(local.server);
    await closeBrowser();
  }
});
