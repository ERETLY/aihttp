'use strict';

const fs = require('fs');
const path = require('path');
const { prepareRequest, redactUrl } = require('./net-guard');
const { DEFAULT_UA } = require('./user-agent');

const ENGINE_PATH = path.join(__dirname, '..', 'ahttp.js');
const ENGINE_SRC = fs.readFileSync(ENGINE_PATH, 'utf8');

let sharedBrowser = null;
let sharedOwned = false;
const contextStates = new Map();

function loadPlaywright() {
  try { return require('playwright'); } catch (e) {}
  try { return require('playwright-core'); } catch (e) {}
  throw new Error('browser backend requires Playwright; install it with: npm install --save-dev playwright && npx playwright install chromium');
}

async function getBrowser(options) {
  const opts = options || {};
  if (sharedBrowser) return sharedBrowser;
  const playwright = loadPlaywright();
  if (opts.cdp) {
    sharedBrowser = await playwright.chromium.connectOverCDP(opts.cdp);
    sharedOwned = false;
    return sharedBrowser;
  }
  sharedBrowser = await playwright.chromium.launch({ headless: opts.headless !== false });
  sharedOwned = true;
  return sharedBrowser;
}

function stateFor(context) {
  let state = contextStates.get(context);
  if (!state) {
    state = { owned: false, openPages: 0, closed: false };
    contextStates.set(context, state);
  }
  return state;
}

async function acquireContext(browser, opts) {
  const existing = typeof browser.contexts === 'function' ? browser.contexts() : [];
  for (const context of existing) {
    const state = contextStates.get(context);
    if (state && state.owned && !state.closed) return { context: context, state: state };
  }
  if (opts.reuseExistingContext === true && existing.length) {
    const context = existing[0];
    const state = stateFor(context);
    return { context: context, state: state };
  }
  const context = await browser.newContext({
    serviceWorkers: 'block',
    userAgent: DEFAULT_UA
  });
  const state = { owned: true, openPages: 0, closed: false };
  contextStates.set(context, state);
  return { context: context, state: state };
}

async function releasePage(context, state, page) {
  if (page) { try { await page.close(); } catch (e) {} }
  state.openPages = Math.max(0, state.openPages - 1);
  if (!state.owned || state.openPages > 0 || state.closed) return;
  state.closed = true;
  try { await context.close(); } catch (e) {}
  if (contextStates.get(context) === state) contextStates.delete(context);
}

async function routeGuard(route, allowPrivate) {
  const request = route.request();
  let target;
  try { target = new URL(request.url()); } catch (e) {
    await route.abort('blockedbyclient');
    return;
  }
  if (target.protocol === 'data:' || target.protocol === 'blob:' || target.protocol === 'about:') {
    await route.continue();
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    await route.abort('blockedbyclient');
    return;
  }
  try {
    await prepareRequest(target.href, { allowPrivate: allowPrivate === true });
  } catch (e) {
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
}

function createApi(page) {
  async function ensureInjected() {
    const present = await page.evaluate(() => !!(window.ahttp && window.ahttp.__ahttp));
    if (!present) await page.addScriptTag({ content: ENGINE_SRC });
  }
  async function inPage(fn, arg) {
    await ensureInjected();
    return page.evaluate(fn, arg);
  }
  return {
    async wake() { return inPage(() => window.ahttp.wake()); },
    async sleep() { return inPage(() => window.ahttp.sleep()); },
    async status() { return inPage(() => window.ahttp.status()); },
    async snapshot(options) { return inPage((opts) => window.ahttp.snapshot(opts), options); },
    async act(id, payload, options) {
      return inPage((args) => window.ahttp.act(args[0], args[1], args[2]), [id, payload, options]);
    },
    async unlock(key) { return inPage((value) => window.ahttp.unlock(value), key); },
    async authorize(options) { return inPage((opts) => window.ahttp.authorize(opts), options); },
    async hashKey(key) { return inPage((value) => window.ahttp.hashKey(value), key); }
  };
}

async function openBrowserPage(url, options) {
  const opts = options || {};
  const allowPrivate = opts.allowPrivate === true || process.env.AHTTP_ALLOW_PRIVATE === '1';
  let prepared;
  try {
    prepared = await prepareRequest(url, { allowPrivate: allowPrivate });
  } catch (e) {
    throw new Error(redactUrl(url) + ': ' + (e && e.message ? e.message : String(e)));
  }
  if (opts.signal && opts.signal.aborted) throw new Error('cancelled');
  const browser = opts.browser || await getBrowser(opts);
  const acquired = await acquireContext(browser, opts);
  const context = acquired.context;
  const state = acquired.state;
  state.openPages += 1;
  let page;
  try {
    page = await context.newPage();
  } catch (e) {
    await releasePage(context, state, null);
    throw e;
  }
  let released = false;
  const release = async function () {
    if (released) return;
    released = true;
    await releasePage(context, state, page);
  };
  await page.route('**/*', (route) => routeGuard(route, allowPrivate));
  page.setDefaultTimeout(opts.timeout || 30000);
  const startedAt = Date.now();
  let response;
  try {
    response = await page.goto(prepared.url.href, { waitUntil: 'domcontentloaded', timeout: opts.timeout || 30000 });
  } catch (e) {
    await release();
    throw new Error('browser navigation failed: ' + (e && e.message ? e.message : String(e)));
  }
  if (opts.signal && opts.signal.aborted) {
    await release();
    throw new Error('cancelled');
  }
  await page.addScriptTag({ content: ENGINE_SRC });
  let raw = '';
  try { raw = response ? await response.text() : await page.content(); } catch (e) { raw = await page.content(); }
  const result = {
    api: createApi(page),
    win: null,
    page: page,
    context: context,
    browser: browser,
    url: page.url(),
    status: response ? response.status() : 0,
    raw: raw,
    rawBytes: Buffer.byteLength(raw, 'utf8'),
    headers: response ? response.headers() : {},
    fetchMs: Date.now() - startedAt,
    close: release
  };
  return result;
}

async function closeBrowser() {
  if (!sharedBrowser) return;
  if (sharedOwned) {
    try { await sharedBrowser.close(); } catch (e) {}
  }
  sharedBrowser = null;
  sharedOwned = false;
  contextStates.clear();
}

module.exports = {
  ENGINE_SRC,
  DEFAULT_UA,
  openBrowserPage,
  closeBrowser
};
