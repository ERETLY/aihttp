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
      resolve({ server, url: 'http://127.0.0.1:' + server.address().port });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('a cross-origin iframe is scanned and its actions run in that frame', { skip: gate.skip, timeout: 60000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const inner = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><body><main>' +
      '<button id="pay">Pay now</button><p id="out">idle</p>' +
      '</main><script>' +
      'document.getElementById("pay").addEventListener("click", function () {' +
      'document.getElementById("out").textContent = "paid";' +
      '});</script></body>');
  });
  const outer = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (req.url === '/same') {
      res.end('<!doctype html><body><button>Same origin</button></body>');
      return;
    }
    res.end('<!doctype html><body><h1>Checkout</h1>' +
      '<iframe id="pay-frame" src="' + inner.url + '/inner" width="400" height="120"></iframe>' +
      '<iframe id="same" src="/same" width="400" height="80"></iframe></body>');
  });
  try {
    const page = await openBrowserPage(outer.url + '/', { timeout: 15000, allowPrivate: true });
    t.after(async () => { await page.close(); });
    await page.page.waitForTimeout(600);

    const snapshot = await page.api.snapshot({ format: 'json', maxActions: 60 });
    const pay = snapshot.actions.filter((action) => action.label === 'Pay now');
    assert.equal(pay.length, 1, 'the cross-origin button appears exactly once');
    assert.match(pay[0].id, /^f\d+:a\d+$/, 'the id names its frame');
    assert.equal(pay[0].frame, Number(pay[0].id.slice(1, pay[0].id.indexOf(':'))));

    const same = snapshot.actions.filter((action) => action.label === 'Same origin');
    assert.equal(same.length, 1, 'a same-origin iframe is not scanned twice');
    assert.match(same[0].id, /^a\d+$/, 'a same-origin iframe action keeps the main id space');

    const result = await page.api.act(pay[0].id, {}, { settle: true, snapshot: false, diff: true });
    assert.equal(result.ok, true);

    const frame = page.page.frames().find((item) => item.url() === inner.url + '/inner');
    assert.ok(frame, 'the payment frame is present');
    assert.equal(await frame.evaluate(() => document.getElementById('out').textContent), 'paid');
  } finally {
    await close(outer.server);
    await close(inner.server);
    await closeBrowser();
  }
});
