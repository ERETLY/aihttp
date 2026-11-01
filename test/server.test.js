'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { openPage } = require('../lib/page');

const PAGE = '<!doctype html><html><head><title>Server flow</title></head><body>' +
  '<main><form><label>Email <input name="email" placeholder="you@example.com"></label>' +
  '<button type="submit">Send</button></form>' +
  '<a href="/next">Next page</a></main></body></html>';

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

function handler(req, res) {
  if (req.url === '/redirect') {
    res.writeHead(302, { location: '/' });
    res.end();
    return;
  }
  if (req.url === '/gzip') {
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
    res.end(zlib.gzipSync(PAGE));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('the static backend follows a redirect, accepts gzip and fills a field', async () => {
  const local = await listen(handler);
  try {
    const page = await openPage(local.url + '/redirect', { allowPrivate: true });
    assert.equal(page.status, 200);
    assert.equal(page.url, local.url + '/');

    const gzip = await openPage(local.url + '/gzip', { allowPrivate: true });
    assert.match(gzip.api.snapshot({ format: 'text' }), /Server flow/);

    const snapshot = page.api.snapshot({ format: 'json' });
    const input = snapshot.actions.find((action) => action.tag === 'input');
    assert.ok(input, 'email input is in the snapshot');
    const result = await page.api.act(input.id, { value: 'a@b.c' }, { quiet: 0, minWait: 0 });
    assert.equal(result.ok, true);
    assert.match(JSON.stringify(result.diff), /a@b\.c/);
  } finally {
    await close(local.server);
  }
});

test('the CLI reads a page from a local server', { timeout: 30000 }, async () => {
  const local = await listen(handler);
  try {
    const cli = path.join(__dirname, '..', 'bin', 'ahttp-cli.js');
    const result = await run(process.execPath, [cli, local.url + '/', '--allow-private', '--json', '--no-stats']);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const data = JSON.parse(result.stdout);
    assert.equal(data.metrics.status, 200);
    assert.ok(Array.isArray(data.snapshot.actions));
    assert.ok(data.snapshot.actions.some((action) => action.tag === 'input'));
  } finally {
    await close(local.server);
  }
});
