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

test('an open popover is scanned and a closed one is not', { skip: gate.skip, timeout: 60000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const local = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><body><main>' +
      '<button popovertarget="menu">Open menu</button>' +
      '<div id="menu" popover><button>Menu action</button></div></main></body>');
  });
  try {
    const page = await openBrowserPage(local.url, { timeout: 15000, allowPrivate: true });
    t.after(async () => { await page.close(); });
    const closed = await page.api.snapshot({ format: 'json', maxActions: 40, force: true });
    assert.equal(closed.actions.some((action) => action.label === 'Menu action'), false);

    await page.page.evaluate(() => document.getElementById('menu').showPopover());
    const opened = await page.api.snapshot({ format: 'json', maxActions: 40, force: true });
    assert.equal(opened.actions.some((action) => action.label === 'Menu action'), true);
  } finally {
    await close(local.server);
    await closeBrowser();
  }
});

test('a shadow slot renders assigned nodes instead of fallback', { skip: gate.skip, timeout: 60000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const local = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><body><main>' +
      '<x-card><button slot="body">Slotted action</button></x-card>' +
      '</main><script>' +
      'customElements.define("x-card", class extends HTMLElement {' +
      'constructor() { super(); const root = this.attachShadow({ mode: "open" });' +
      'root.innerHTML = "<section><slot name=\\"body\\"><button>Fallback action</button></slot></section>"; }' +
      '});</script></body>');
  });
  try {
    const page = await openBrowserPage(local.url, { timeout: 15000, allowPrivate: true });
    t.after(async () => { await page.close(); });
    const snapshot = await page.api.snapshot({ format: 'json', maxActions: 40 });
    const labels = snapshot.actions.map((action) => action.label);
    assert.equal(labels.filter((label) => label === 'Slotted action').length, 1);
    assert.equal(labels.includes('Fallback action'), false);
  } finally {
    await close(local.server);
    await closeBrowser();
  }
});

test('a frameset frame is scanned through contentDocument', { skip: gate.skip, timeout: 60000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const local = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (req.url === '/inner') {
      res.end('<!doctype html><body><button>Frame action</button></body>');
      return;
    }
    res.end('<!doctype html><html><frameset cols="100%">' +
      '<frame src="/inner" title="inner"></frameset></html>');
  });
  try {
    const page = await openBrowserPage(local.url, { timeout: 15000, allowPrivate: true });
    t.after(async () => { await page.close(); });
    await page.page.waitForTimeout(300);
    const snapshot = await page.api.snapshot({ format: 'json', maxActions: 40 });
    assert.equal(snapshot.actions.some((action) => action.label === 'Frame action'), true);
  } finally {
    await close(local.server);
    await closeBrowser();
  }
});
