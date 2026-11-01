'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const zlib = require('node:zlib');
const {
  isPrivateAddress,
  isPrivateHostname,
  prepareRequest,
  redactUrl
} = require('../lib/net-guard');
const { fetchUrl } = require('../lib/page');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port, url: 'http://127.0.0.1:' + address.port });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('private address classification covers loopback, private, link-local and metadata', () => {
  for (const address of [
    '127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'ff02::1',
    '::ffff:127.0.0.1'
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test('IPv4-compatible, mapped, NAT64 and 6to4 IPv6 forms are classified', () => {
  for (const address of [
    '::127.0.0.1', '::7f00:1', '0:0:0:0:0:0:7f00:1', '::10.0.0.1',
    '::ffff:10.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::'
  ]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of [
    '::8.8.8.8', '::192.0.3.5', '::ffff:8.8.8.8', '::ffff:192.0.3.5',
    '64:ff9b::8.8.8.8', '2606:4700:4700::1111'
  ]) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test('192.0.0.0/24 and 192.0.2.0/24 are blocked without blocking the rest of 192.0.0.0/16', () => {
  for (const address of ['192.0.0.1', '192.0.0.8', '192.0.0.170', '192.0.2.1', '192.0.2.255']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ['192.0.3.5', '192.0.4.5', '192.1.0.1', '192.0.9.9']) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test('prepareRequest blocks IPv4-compatible loopback and allows public neighbours', async () => {
  await assert.rejects(prepareRequest('http://[::127.0.0.1]/'), /private address blocked/);
  await assert.rejects(prepareRequest('http://[::7f00:1]/'), /private address blocked/);
  const compatiblePublic = await prepareRequest('http://[::8.8.8.8]/');
  assert.equal(compatiblePublic.url.hostname, '[::808:808]');
  const neighbour = await prepareRequest('http://192.0.3.5/');
  assert.equal(neighbour.url.hostname, '192.0.3.5');
});


test('prepareRequest keeps WHATWG normalization of 010.0.0.1 as public 8.0.0.1', async () => {
  assert.equal(new URL('http://010.0.0.1/').hostname, '8.0.0.1');
  const prepared = await prepareRequest('http://010.0.0.1/');
  assert.equal(prepared.url.hostname, '8.0.0.1', 'the URL parser normalizes before the guard sees it');
});

test('private hostnames are rejected', () => {
  for (const host of ['localhost', 'localhost.', 'foo.localhost', 'printer.local', 'metadata.google.internal']) {
    assert.equal(isPrivateHostname(host), true, host);
  }
  assert.equal(isPrivateHostname('example.com'), false);
});

test('prepareRequest rejects private targets unless explicitly allowed', async () => {
  await assert.rejects(prepareRequest('http://127.0.0.1:8080/'), /private address blocked/);
  await assert.rejects(prepareRequest('http://localhost:8080/'), /private hostname blocked/);
  await assert.rejects(prepareRequest('http://[::1]:8080/'), /private address blocked/);
  await assert.rejects(prepareRequest('file:///etc/passwd'), /unsupported protocol/);
  await assert.rejects(prepareRequest('http://user:pass@example.com/'), /credentials are not allowed/);
  const allowed = await prepareRequest('http://127.0.0.1:8080/', { allowPrivate: true });
  assert.equal(allowed.url.hostname, '127.0.0.1');
});

test('redactUrl removes credentials and query values', () => {
  assert.equal(
    redactUrl('https://user:secret@example.com/path?token=secret&q=hello'),
    'https://[redacted]@example.com/path?[redacted]'
  );
});

test('fetchUrl blocks loopback by default and succeeds with allowPrivate', async () => {
  const local = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body><button>ok</button></body></html>');
  });
  try {
    await assert.rejects(fetchUrl(local.url, { timeout: 2000 }), /private address blocked/);
    const result = await fetchUrl(local.url, { timeout: 2000, allowPrivate: true });
    assert.equal(result.status, 200);
    assert.match(result.text, /<button>ok<\/button>/);
  } finally {
    await close(local.server);
  }
});

test('fetchUrl revalidates redirect protocols and loops', async () => {
  const local = await listen((req, res) => {
    if (req.url === '/loop') {
      res.writeHead(302, { location: '/loop' });
      res.end();
      return;
    }
    if (req.url === '/file') {
      res.writeHead(302, { location: 'file:///etc/passwd' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('done');
  });
  try {
    await assert.rejects(
      fetchUrl(local.url + '/file', { timeout: 2000, allowPrivate: true }),
      /unsupported protocol: file:/
    );
    await assert.rejects(
      fetchUrl(local.url + '/loop', { timeout: 2000, allowPrivate: true, redirects: 2 }),
      /redirect loop/
    );
  } finally {
    await close(local.server);
  }
});

test('fetchUrl enforces compressed and decompressed size limits', async () => {
  const local = await listen((req, res) => {
    if (req.url === '/gzip') {
      const body = zlib.gzipSync(Buffer.alloc(200000, 65));
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(Buffer.alloc(2000, 66));
  });
  try {
    await assert.rejects(
      fetchUrl(local.url + '/plain', { timeout: 2000, allowPrivate: true, maxBytes: 100 }),
      /response exceeds/
    );
    await assert.rejects(
      fetchUrl(local.url + '/gzip', { timeout: 2000, allowPrivate: true, maxBytes: 1000 }),
      /decompressed response exceeds/
    );
  } finally {
    await close(local.server);
  }
});

test('fetchUrl rejects invalid encodings instead of returning compressed bytes', async () => {
  const local = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
    res.end(Buffer.from('not gzip'));
  });
  try {
    await assert.rejects(
      fetchUrl(local.url, { timeout: 2000, allowPrivate: true }),
      /invalid response encoding/
    );
  } finally {
    await close(local.server);
  }
});
