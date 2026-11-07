#!/usr/bin/env node
'use strict';

// aihttp serve: the AI HTTP format over HTTP.
//
//   GET  /?url=https://example.com            -> application/aihttp+json
//   POST /            { "url": "...", ... }   -> same, with a JSON body
//   POST /act         { "url": "...", "id": "a3", "value": "..." }
//   GET  /health
//
// The response is the same action graph the engine returns, wrapped in the
// aihttp envelope. Pages are opened per request; use the MCP server when you
// need a stateful session with cookies and multiple steps.

const http = require('node:http');
const crypto = require('node:crypto');
const pkg = require('../package.json');

const DEFAULTS = {
  port: 8787,
  host: '127.0.0.1',
  maxBody: 64 * 1024,
  maxUrl: 4096,
  concurrency: 4,
  timeout: 30000
};

function parseArgs(argv) {
  const out = {
    port: Number(process.env.AIHTTP_PORT || process.env.AIWEB_PORT || DEFAULTS.port),
    host: process.env.AIHTTP_HOST || process.env.AIWEB_HOST || DEFAULTS.host,
    browser: process.env.AIHTTP_BROWSER || process.env.AIWEB_BROWSER === '1',
    allowPrivate: process.env.AIHTTP_ALLOW_PRIVATE || process.env.AIWEB_ALLOW_PRIVATE === '1',
    token: process.env.AIHTTP_TOKEN || '',
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--browser') out.browser = true;
    else if (arg === '--allow-private') out.allowPrivate = true;
    else if (arg === '--port') out.port = Number(argv[++i]);
    else if (arg === '--host') out.host = String(argv[++i] || '');
    else if (arg === '--token') out.token = String(argv[++i] || '');
    else if (arg.indexOf('--port=') === 0) out.port = Number(arg.slice(7));
    else if (arg.indexOf('--host=') === 0) out.host = arg.slice(7);
    else if (arg.indexOf('--token=') === 0) out.token = arg.slice(8);
  }
  if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) out.port = DEFAULTS.port;
  return out;
}

const USAGE = [
  'aihttp serve ' + pkg.version + ' | AI-First Web Format over HTTP',
  '',
  'Usage:',
  '  aihttp-serve [--port 8787] [--host 127.0.0.1] [--browser] [--allow-private] [--token TOKEN]',
  '',
  'Endpoints:',
  '  GET  /?url=<url>&maxActions=60&maxText=1000&includeText=true&lazy=false',
  '  POST /        {"url":"...","maxActions":60}',
  '  POST /act     {"url":"...","id":"a3","value":"..."}',
  '  GET  /health',
  '',
  'Environment: AIHTTP_PORT, AIHTTP_HOST, AIHTTP_BROWSER=1, AIHTTP_ALLOW_PRIVATE=1, AIHTTP_TOKEN'
].join('\n');

let active = 0;
const waiting = [];

function acquire() {
  if (active < DEFAULTS.concurrency) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  active = Math.max(0, active - 1);
  const next = waiting.shift();
  if (next) {
    active++;
    next();
  }
}

function json(res, status, body, contentType) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': contentType || 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

function envelope(snapshot) {
  const out = Object.assign({}, snapshot);
  out.protocol = 'aihttp/1';
  out.format = 'aihttp';
  out.formatVersion = 1;
  return out;
}

function authorized(req, token) {
  if (!token) return true;
  const expected = Buffer.from('Bearer ' + token);
  const actual = Buffer.from(String(req.headers.authorization || ''));
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function isLoopbackHost(host) {
  const name = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}

// Binding a public interface without a token turns the server into an open
// SSRF proxy for anyone who can reach it. A token is the only thing that
// separates a local tool from a public one, so require it.
function assertBindSafe(host, token) {
  if (isLoopbackHost(host) || token) return;
  throw new Error('refusing to bind ' + host + ' without a token; use --token or --host 127.0.0.1');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > DEFAULTS.maxBody) {
        reject(new Error('request body exceeds ' + DEFAULTS.maxBody + ' bytes'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function snapshotOptions(args) {
  const out = { format: 'json' };
  if (args.maxActions != null) out.maxActions = Math.max(1, Math.min(500, parseInt(args.maxActions, 10) || 60));
  if (args.maxText != null) out.maxText = Math.max(0, Math.min(20000, parseInt(args.maxText, 10) || 0));
  if (args.includeText === false || args.includeText === 'false') out.includeText = false;
  if (args.lazy === true || args.lazy === 'true') out.lazy = true;
  if (args.query) out.query = String(args.query).slice(0, 1000);
  if (args.scope) out.scope = String(args.scope).slice(0, 1000);
  return out;
}

function targetUrl(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw.length > DEFAULTS.maxUrl) throw new Error('url is required');
  let parsed;
  try { parsed = new URL(raw); } catch (e) { throw new Error('invalid url'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must be http or https');
  }
  return parsed.href;
}

async function openTarget(url, opts) {
  const options = {
    timeout: DEFAULTS.timeout,
    allowPrivate: opts.allowPrivate,
    signal: opts.signal
  };
  if (opts.browser) {
    const { openBrowserPage } = require('../lib/browser');
    return openBrowserPage(url, options);
  }
  const { openPage } = require('../lib/page');
  return openPage(url, options);
}

async function closeTarget(page) {
  if (!page) return;
  try {
    if (typeof page.close === 'function') await page.close();
  } catch (e) {}
}

async function withPage(url, opts, fn) {
  await acquire();
  let page = null;
  try {
    page = await openTarget(url, opts);
    return await fn(page);
  } finally {
    await closeTarget(page);
    release();
  }
}

function createServer(opts) {
  return http.createServer(async (req, res) => {
    try {
      const parsed = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
      if (parsed.pathname === '/health') {
        return json(res, 200, {
          ok: true,
          name: 'aihttp',
          protocol: 'aihttp/1',
          version: pkg.version,
          browser: opts.browser === true
        });
      }
      if (!authorized(req, opts.token)) {
        return json(res, 401, { ok: false, error: 'unauthorized' });
      }
      if (parsed.pathname !== '/' && parsed.pathname !== '/act') {
        return json(res, 404, { ok: false, error: 'not_found' });
      }
      if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('allow', 'GET, POST');
        return json(res, 405, { ok: false, error: 'method_not_allowed' });
      }
      const body = req.method === 'POST' ? await readBody(req) : {};
      const args = Object.assign({}, Object.fromEntries(parsed.searchParams.entries()), body || {});
      // File paths are a local trust boundary. Over HTTP they would let a
      // caller read any file the server process can read and upload it.
      if (args.files !== undefined) {
        throw new Error('files are not accepted over HTTP; use the MCP server');
      }
      const url = targetUrl(args.url);
      const result = await withPage(url, opts, async (page) => {
        if (parsed.pathname === '/act') {
          if (!args.id) throw new Error('id is required');
          const payload = {};
          for (const key of ['value', 'checked', 'hover', 'read', 'choose', 'key', 'dialog', 'promptText']) {
            if (args[key] !== undefined) payload[key] = args[key];
          }
          if (Array.isArray(args.files)) payload.files = args.files.slice(0, 10);
          return page.api.act(String(args.id), payload, {
            settle: args.settle !== false,
            timeout: DEFAULTS.timeout,
            snapshot: false,
            diff: true
          });
        }
        return page.api.snapshot(snapshotOptions(args));
      });
      const status = result && result.ok === false && parsed.pathname === '/act' ? 422 : 200;
      return json(res, status, envelope(result), 'application/aihttp+json; charset=utf-8');
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const status = /required|invalid|exceeds|not accepted|http or https|private|blocked/i.test(message) ? 400 : 502;
      return json(res, status, { ok: false, protocol: 'aihttp/1', error: message });
    }
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE + '\n');
    return;
  }
  try {
    assertBindSafe(opts.host, opts.token);
  } catch (err) {
    process.stderr.write('aihttp serve: ' + err.message + '\n');
    process.exitCode = 1;
    return;
  }
  const server = createServer(opts);
  server.listen(opts.port, opts.host, () => {
    const address = server.address();
    process.stdout.write('aihttp serve ' + pkg.version + ' on http://' + address.address + ':' + address.port +
      ' | browser=' + (opts.browser ? 'on' : 'off') + ' | private=' + (opts.allowPrivate ? 'on' : 'off') + '\n');
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) main();

module.exports = { createServer, assertBindSafe, parseArgs, snapshotOptions, targetUrl, USAGE };
