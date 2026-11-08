'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

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
  return { call };
}

test('a stuck tool call cannot block the MCP queue', { timeout: 30000 }, async () => {
  const local = await listen(() => {
    // Never respond: the page load stays pending until the deadline fires.
  });
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'aihttp-mcp.js'), '--allow-private'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { AHTTP_CALL_TIMEOUT_MS: '1500' })
  });
  const client = createClient(proc);
  try {
    const started = Date.now();
    const result = await client.call('tools/call', {
      name: 'ahttp_open',
      arguments: { url: local.url }
    }, 10000);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 6000, 'the deadline answered in ' + elapsed + ' ms');
    assert.match(JSON.stringify(result), /exceeded 1500 ms|timed out/i);

    const ping = await client.call('ping', {}, 3000);
    assert.ok(ping, 'the queue still answers after the deadline');
  } finally {
    try { proc.kill(); } catch (e) {}
    await close(local.server);
  }
});
