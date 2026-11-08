'use strict';

const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { createWindow } = require('./mini-dom');
const { prepareRequest, redactUrl } = require('./net-guard');
const { DEFAULT_UA } = require('./user-agent');
const ENGINE_PATH = path.join(__dirname, '..', 'aihttp.js');
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_CSS_BYTES = 2 * 1024 * 1024;
const MAX_STYLESHEET_LINKS = 8;
const MAX_CSS_SHEETS = 16;

function stylesheetUrls(doc, baseUrl) {
  const urls = [];
  for (const el of doc.querySelectorAll('link')) {
    const rel = String(el.getAttribute('rel') || '').toLowerCase().split(/\s+/);
    if (rel.indexOf('stylesheet') < 0) continue;
    const href = el.getAttribute('href');
    if (!href || href.startsWith('data:')) continue;
    let target;
    try { target = new URL(href, baseUrl); } catch (e) { continue; }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;
    if (urls.indexOf(target.href) >= 0) continue;
    urls.push(target.href);
    if (urls.length >= MAX_STYLESHEET_LINKS) break;
  }
  return urls;
}

function cssImportUrls(css, baseUrl) {
  const urls = [];
  const pattern = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*([^;]*);/gi;
  let match;
  while ((match = pattern.exec(String(css)))) {
    const media = String(match[2] || '').trim().toLowerCase();
    if (media && /\b(print|speech)\b/.test(media) && !/\b(screen|all)\b/.test(media)) continue;
    let target;
    try { target = new URL(match[1], baseUrl); } catch (e) { continue; }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;
    if (urls.indexOf(target.href) < 0) urls.push(target.href);
  }
  return urls;
}

async function inlineCssSheet(href, state, options, head, depth) {
  if (depth > 3 || state.seen.has(href) || state.count >= MAX_CSS_SHEETS) return 0;
  if (options.signal && options.signal.aborted) return 0;
  state.seen.add(href);
  let res;
  try {
    res = await fetchUrl(href, {
      allowPrivate: options.allowPrivate,
      maxBytes: MAX_CSS_BYTES,
      timeout: Math.min(options.timeout || 10000, 10000),
      signal: options.signal
    });
  } catch (e) {
    return 0;
  }
  if (res.status >= 400) return 0;
  let loaded = 0;
  for (const imported of cssImportUrls(res.text, href)) {
    loaded += await inlineCssSheet(imported, state, options, head, depth + 1);
  }
  const style = state.doc.createElement('style');
  style.setAttribute('data-aihttp-href', href);
  style.textContent = res.text;
  head.appendChild(style);
  state.count++;
  return loaded + 1;
}

async function inlineStylesheets(win, baseUrl, options) {
  const opts = options || {};
  if (opts.fetchStyles === false) return 0;
  const doc = win.document;
  const head = doc.head || doc.documentElement;
  if (!head) return 0;
  const state = { doc: doc, seen: new Set(), count: 0 };
  let loaded = 0;
  for (const href of stylesheetUrls(doc, baseUrl)) {
    loaded += await inlineCssSheet(href, state, opts, head, 0);
  }
  return loaded;
}

function decodeBody(buffer, encoding, maxBytes) {
  const enc = String(encoding || '').toLowerCase();
  const limit = maxBytes > 0 ? { maxOutputLength: maxBytes } : {};
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(buffer, limit);
    if (enc === 'deflate') return zlib.inflateSync(buffer, limit);
    if (enc === 'br') return zlib.brotliDecompressSync(buffer, limit);
  } catch (e) {
    if (e && (e.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError)) {
      throw new Error('decompressed response exceeds ' + maxBytes + ' bytes');
    }
    throw new Error('invalid response encoding: ' + (enc || 'unknown'));
  }
  return buffer;
}

function charsetFromContentType(value) {
  const match = String(value || '').match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  return match ? match[1] : '';
}

function charsetFromMeta(buffer) {
  const head = buffer.slice(0, 4096).toString('latin1');
  let match = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([^"'\s/>]+)/i);
  if (match) return match[1];
  match = head.match(/<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([^"'\s;]+)/i);
  return match ? match[1] : '';
}

// The static backend used to assume UTF-8. That turns windows-1251, Shift_JIS
// and similar pages into replacement characters. Prefer the BOM, then the
// Content-Type header, then <meta charset>, then UTF-8.
function decodeText(buffer, headers) {
  if (!buffer || !buffer.length) return '';
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString('utf8');
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    try { return new TextDecoder('utf-16le').decode(buffer.slice(2)); } catch (e) {}
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    try { return new TextDecoder('utf-16be').decode(buffer.slice(2)); } catch (e) {}
  }
  const label = charsetFromContentType(headers && headers['content-type']) ||
    charsetFromMeta(buffer) || 'utf-8';
  try {
    return new TextDecoder(label).decode(buffer);
  } catch (e) {
    return buffer.toString('utf8');
  }
}

async function fetchUrl(url, options) {
  const opts = options || {};
  const timeout = opts.timeout || 25000;
  const maxBytes = opts.maxBytes || MAX_BYTES;
  const redirects = opts.redirects == null ? 5 : opts.redirects;
  const startedAt = opts.startedAt || Date.now();
  const allowPrivate = opts.allowPrivate === true || process.env.AIHTTP_ALLOW_PRIVATE === '1';
  const visited = opts.visited || new Set();
  if (opts.signal && opts.signal.aborted) throw new Error('cancelled');
  let prepared;
  try {
    prepared = await prepareRequest(url, { allowPrivate: allowPrivate });
  } catch (e) {
    throw new Error(redactUrl(url) + ': ' + (e && e.message ? e.message : String(e)));
  }
  const target = prepared.url;
  if (visited.has(target.href)) throw new Error('redirect loop at ' + redactUrl(target.href));
  visited.add(target.href);
  const lib = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(target, {
      method: opts.method || 'GET',
      lookup: prepared.lookup,
      headers: Object.assign({
        'user-agent': opts.userAgent || DEFAULT_UA,
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'accept-encoding': 'gzip, deflate, br'
      }, opts.headers || {})
    }, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        if (redirects <= 0) {
          reject(new Error('too many redirects at ' + redactUrl(target.href)));
          return;
        }
        let next;
        try { next = new URL(location, target).href; } catch (e) { reject(new Error('bad redirect: ' + redactUrl(location))); return; }
        fetchUrl(next, Object.assign({}, opts, {
          redirects: redirects - 1,
          allowPrivate: allowPrivate,
          startedAt: startedAt,
          visited: visited
        })).then(resolve, reject);
        return;
      }
      const chunks = [];
      let size = 0;
      let aborted = false;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          aborted = true;
          reject(new Error('response exceeds ' + maxBytes + ' bytes'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (aborted) return;
        try {
          const raw = Buffer.concat(chunks);
          const body = decodeBody(raw, res.headers['content-encoding'], maxBytes);
          if (body.length > maxBytes) throw new Error('response exceeds ' + maxBytes + ' bytes');
          resolve({
            url: target.href,
            finalUrl: target.href,
            status,
            headers: res.headers,
            body,
            text: decodeText(body, res.headers),
            bytes: body.length,
            fetchMs: Date.now() - startedAt
          });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.setTimeout(timeout, () => {
      req.destroy(new Error('request timed out after ' + timeout + ' ms'));
    });
    if (opts.signal) {
      const onAbort = () => req.destroy(new Error('cancelled'));
      opts.signal.addEventListener('abort', onAbort, { once: true });
      req.on('close', () => opts.signal.removeEventListener('abort', onAbort));
    }
    req.on('error', reject);
    if (opts.body != null) req.write(opts.body);
    req.end();
  });
}

const engine = (() => {
  try { return require(ENGINE_PATH); } catch (e) { return null; }
})();

// The static backend has no browser fetch. Server auth, forms that post via
// fetch and page scripts all expect one, so bind a guarded Node fetch into the
// window. It keeps the same SSRF policy as the document loader.
function installFetch(win) {
  if (!win || typeof win.fetch === 'function') return;
  win.fetch = async function (input, init) {
    const opts = init || {};
    const target = typeof input === 'string' ? input : (input && input.url ? String(input.url) : String(input));
    const headers = {};
    const rawHeaders = opts.headers || {};
    if (typeof rawHeaders.forEach === 'function' && !Array.isArray(rawHeaders)) {
      rawHeaders.forEach((value, name) => { headers[String(name).toLowerCase()] = String(value); });
    } else {
      for (const name of Object.keys(rawHeaders)) headers[String(name).toLowerCase()] = String(rawHeaders[name]);
    }
    let body = opts.body;
    if (body != null && typeof body !== 'string' && !Buffer.isBuffer(body)) {
      body = String(body);
    }
    const res = await fetchUrl(target, {
      method: String(opts.method || 'GET').toUpperCase(),
      headers: headers,
      body: body == null ? undefined : body,
      signal: opts.signal,
      allowPrivate: win.__aihttpAllowPrivate === true
    });
    const text = res.text;
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: '',
      url: res.finalUrl || res.url,
      headers: {
        get: function (name) { return res.headers[String(name).toLowerCase()] || null; },
        has: function (name) { return res.headers[String(name).toLowerCase()] != null; }
      },
      text: async function () { return text; },
      json: async function () { return JSON.parse(text); }
    };
  };
}

// One engine instance per static page. The old attach() shared the module
// singleton and overwrote globalThis.__AIHTTP_ENV__, so opening page B reset
// page A's state and A's next snapshot read B's DOM.
function attach(win) {
  if (win.__aihttp_engine__) return win.__aihttp_engine__;
  installFetch(win);
  const base = engine || require(ENGINE_PATH);
  let api;
  if (typeof base.create === 'function') {
    api = base.create(win);
  } else {
    globalThis.__AIHTTP_ENV__ = win;
    api = base;
  }
  try { win.__aihttp_engine__ = api; } catch (e) {}
  api.sleep();
  api.wake();
  return api;
}

async function openPage(url, options) {
  if (options && options.signal && options.signal.aborted) throw new Error('cancelled');
  const res = await fetchUrl(url, options);
  if (options && options.signal && options.signal.aborted) throw new Error('cancelled');
  const contentType = String(res.headers['content-type'] || '');
  if (res.status >= 400) {
    throw new Error('HTTP ' + res.status + ' for ' + redactUrl(res.finalUrl || res.url));
  }
  if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
    throw new Error('unsupported content-type: ' + contentType.split(';')[0]);
  }
  const win = createWindow(res.text, res.finalUrl || res.url);
  const allowPrivate = options && options.allowPrivate === true || process.env.AIHTTP_ALLOW_PRIVATE === '1';
  try { win.__aihttpAllowPrivate = allowPrivate === true; } catch (e) {}
  const styles = await inlineStylesheets(win, res.finalUrl || res.url, options);
  const api = attach(win);
  return {
    api,
    win,
    url: res.finalUrl || res.url,
    status: res.status,
    raw: res.text,
    rawBytes: res.bytes,
    headers: res.headers,
    styles: styles,
    fetchMs: res.fetchMs
  };
}

function openHtml(html, url) {
  const win = createWindow(String(html || ''), url || 'https://fixture.test/');
  const api = attach(win);
  return {
    api,
    win,
    url: url || 'https://fixture.test/',
    status: 200,
    raw: String(html || ''),
    rawBytes: bytesOf(html),
    headers: {},
    fetchMs: 0
  };
}

function bytesOf(value) {
  return Buffer.byteLength(String(value == null ? '' : value), 'utf8');
}

function tokensOf(value) {
  return Math.ceil(bytesOf(value) / 4);
}

function compression(metrics) {
  const ratio = metrics.snapshotBytes > 0 ? metrics.rawBytes / metrics.snapshotBytes : 0;
  return Math.round(ratio * 10) / 10;
}

module.exports = {
  ENGINE_PATH,
  DEFAULT_UA,
  fetchUrl,
  decodeText,
  openPage,
  openHtml,
  attach,
  bytesOf,
  tokensOf,
  compression
};
