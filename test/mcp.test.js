'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const pkg = require('../package.json');

const { chromiumAvailable, detectChromiumVersion, browserGate } = require('../tools/browser-env');

const gate = browserGate(chromiumAvailable(), process.env.AHTTP_REQUIRE_BROWSER === '1');

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'ahttp-test', version: pkg.version },
  'io.modelcontextprotocol/clientCapabilities': {}
};

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

function createClient(proc) {
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (e) { continue; }
      if (message.id == null || !pending.has(message.id)) continue;
      const handler = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(handler.timer);
      if (message.error) handler.reject(Object.assign(new Error(message.error.message), message.error));
      else handler.resolve(message.result);
    }
  });
  function call(method, params, timeout) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('timeout waiting for ' + method));
        }
      }, timeout || 10000);
      pending.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  function notify(method, params) {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  return { call, notify, pending };
}

test('MCP supports modern discovery, page handles, confirmation tokens and cancellation', { timeout: 30000 }, async () => {
  const local = await listen((req, res) => {
    if (req.url === '/slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body>slow</body></html>');
      }, 3000);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><head><title>MCP modern</title></head><body>' +
      '<main><h1>Modern</h1><button data-ahttp-confirm="Delete everything">Delete account</button></main>' +
      '</body></html>');
  });
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'ahttp-mcp.js'), '--allow-private'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const client = createClient(proc);
  try {
    const discovered = await client.call('server/discover', { _meta: MODERN_META });
    assert.equal(discovered.resultType, 'complete');
    assert.ok(discovered.supportedVersions.includes('2026-07-28'));
    assert.equal(discovered._meta['io.modelcontextprotocol/serverInfo'].name, 'ahttp-mcp');

    const listed = await client.call('tools/list', { _meta: MODERN_META });
    assert.equal(listed.resultType, 'complete');
    assert.equal(listed.tools.length, 3);
    assert.equal(listed.tools[2].annotations.destructiveHint, true);
    assert.ok(listed.tools[2].inputSchema.properties.confirmationToken);

    await assert.rejects(
      client.call('tools/call', { name: 'not_a_tool', arguments: {}, _meta: MODERN_META }),
      (err) => err.code === -32602
    );

    const opened = await client.call('tools/call', {
      name: 'ahttp_open',
      arguments: { url: local.url },
      _meta: MODERN_META
    });
    assert.equal(opened.isError, false);
    const pageId = opened.structuredContent && opened.structuredContent.pageId;
    assert.match(pageId, /^page_/);
    assert.match(opened.content[0].text, /pageId: page_/);

    await assert.rejects(
      client.call('tools/call', { name: 'ahttp_snapshot', arguments: {}, _meta: MODERN_META }),
      (err) => err.code === -32602 && /pageId/.test(err.message)
    );

    const snapshot = await client.call('tools/call', {
      name: 'ahttp_snapshot',
      arguments: { pageId, includeText: false },
      _meta: MODERN_META
    });
    assert.equal(snapshot.isError, false);
    assert.match(snapshot.content[0].text, /Delete account/);

    const actionId = (/^(a\d+) button "Delete account"/m.exec(snapshot.content[0].text) || [])[1];
    const guarded = await client.call('tools/call', {
      name: 'ahttp_act',
      arguments: { pageId, id: actionId },
      _meta: MODERN_META
    });
    assert.equal(guarded.isError, true);
    assert.equal(guarded.structuredContent.requiresConfirmation, true);
    const token = guarded.structuredContent.confirmationToken;
    assert.match(token, /^ct_/);

    const confirmed = await client.call('tools/call', {
      name: 'ahttp_act',
      arguments: { pageId, id: actionId, confirmationToken: token },
      _meta: MODERN_META
    });
    assert.equal(confirmed.isError, false);

    const replay = await client.call('tools/call', {
      name: 'ahttp_act',
      arguments: { pageId, id: actionId, confirmationToken: token },
      _meta: MODERN_META
    });
    assert.equal(replay.isError, true);
    assert.match(replay.content[0].text, /INVALID/);

    const cancelledCall = client.call('tools/call', {
      name: 'ahttp_open',
      arguments: { url: local.url + '/slow' },
      _meta: MODERN_META
    }).catch((err) => err);
    const cancelledId = [...client.pending.keys()][0];
    client.notify('notifications/cancelled', { requestId: cancelledId });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(client.pending.has(cancelledId), true);
    clearTimeout(client.pending.get(cancelledId).timer);
    client.pending.delete(cancelledId);
    const ping = await client.call('ping', { _meta: MODERN_META });
    assert.equal(ping.resultType, 'complete');
    cancelledCall.catch(() => {});
  } finally {
    proc.kill();
    await close(local.server);
  }
});

test('MCP browser mode executes page JavaScript', { skip: gate.skip, timeout: 60000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const local = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>MCP browser</title></head><body>' +
      '<div id="app"></div><script>document.getElementById("app").innerHTML=' +
      '"<main><h1>Rendered</h1><button>JS Button</button></main>";</script></body></html>');
  });
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'ahttp-mcp.js'), '--browser', '--allow-private'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const client = createClient(proc);
  try {
    const opened = await client.call('tools/call', {
      name: 'ahttp_open',
      arguments: { url: local.url },
      _meta: MODERN_META
    });
    assert.equal(opened.isError, false);
    assert.match(opened.content[0].text, /JS Button/);
    assert.match(opened.content[0].text, /Rendered/);
    t.diagnostic('Chromium ' + await detectChromiumVersion());
  } finally {
    proc.kill();
    await close(local.server);
  }
});

test('MCP reports ambiguous when a label matches several actions', { timeout: 30000 }, async () => {
  const local = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>MCP label</title></head><body>' +
      '<main><button>OK</button><button>OK</button><p id="out">idle</p></main></body></html>');
  });
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'ahttp-mcp.js'), '--allow-private'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const client = createClient(proc);
  try {
    const opened = await client.call('tools/call', {
      name: 'ahttp_open',
      arguments: { url: local.url },
      _meta: MODERN_META
    });
    assert.equal(opened.isError, false);
    const pageId = opened.structuredContent.pageId;
    const result = await client.call('tools/call', {
      name: 'ahttp_act',
      arguments: { pageId, id: 'OK' },
      _meta: MODERN_META
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.status, 'ambiguous');
    assert.equal(result.structuredContent.candidates.length, 2);
    assert.match(result.content[0].text, /AMBIGUOUS/);
  } finally {
    proc.kill();
    await close(local.server);
  }
});
