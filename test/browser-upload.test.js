'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

test('a file action uploads a real local file', { skip: gate.skip, timeout: 60000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ahttp-upload-'));
  const file = path.join(dir, 'receipt.txt');
  fs.writeFileSync(file, 'ahttp upload fixture');
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} });

  const local = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><body><main>' +
      '<input id="f" type="file" aria-label="Receipt">' +
      '<p id="out">idle</p></main><script>' +
      'document.getElementById("f").addEventListener("change", function (event) {' +
      'var file = event.target.files && event.target.files[0];' +
      'document.getElementById("out").textContent = file ? file.name + ":" + file.size : "none";' +
      '});</script></body>');
  });
  try {
    const page = await openBrowserPage(local.url, { timeout: 15000, allowPrivate: true });
    t.after(async () => { await page.close(); });
    const snapshot = await page.api.snapshot({ format: 'json', maxActions: 40 });
    const input = snapshot.actions.find((action) => action.kind === 'file');
    assert.ok(input, 'the file input is an action');

    const result = await page.api.act(input.id, { files: [file] }, { settle: true });
    assert.equal(result.ok, true);
    assert.equal(result.method, 'setInputFiles');
    assert.equal(await page.page.evaluate(() => document.getElementById('out').textContent), 'receipt.txt:20');
    assert.equal(await page.page.evaluate(() => document.getElementById('f').files.length), 1);
  } finally {
    await close(local.server);
    await closeBrowser();
  }
});
