'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openBrowserPage } = require('../lib/browser');
const { DEFAULT_UA } = require('../lib/page');

function fakePage(context) {
  const page = {
    closed: false,
    closeCalls: 0,
    async route() {},
    setDefaultTimeout() {},
    async goto() {
      return {
        text: async () => '<html><body><button>ok</button></body></html>',
        status: () => 200,
        headers: () => ({ 'content-type': 'text/html' }),
        url: () => 'http://127.0.0.1/'
      };
    },
    url() { return 'http://127.0.0.1/'; },
    async addScriptTag() {},
    async evaluate(fn) {
      if (typeof fn === 'function' && String(fn).indexOf('__aihttp') >= 0) return true;
      return { locked: false };
    },
    async content() { return '<html><body><button>ok</button></body></html>'; },
    async close() {
      page.closeCalls += 1;
      page.closed = true;
      const index = context.pages.indexOf(page);
      if (index >= 0) context.pages.splice(index, 1);
    }
  };
  return page;
}

function fakeContext(options) {
  const opts = options || {};
  const context = {
    pages: [],
    closeCalls: 0,
    newPages: 0,
    async newPage() {
      context.newPages += 1;
      if (opts.failNewPage) throw new Error('newPage failed');
      const page = fakePage(context);
      context.pages.push(page);
      return page;
    },
    async close() {
      context.closeCalls += 1;
      context.pages.length = 0;
    }
  };
  return context;
}

function fakeBrowser(options) {
  const opts = options || {};
  const contexts = opts.contexts ? opts.contexts.slice() : [];
  const browser = {
    lastContextOptions: null,
    contexts() { return contexts.slice(); },
    async newContext(contextOptions) {
      if (opts.failNewContext) throw new Error('newContext failed');
      browser.lastContextOptions = contextOptions;
      const context = fakeContext(opts);
      contexts.push(context);
      return context;
    },
    allContexts() { return contexts; }
  };
  return browser;
}

const URL = 'http://127.0.0.1/';

test('closing the first page keeps sibling pages and the shared context alive', async () => {
  const browser = fakeBrowser();
  const a = await openBrowserPage(URL, { allowPrivate: true, browser });
  const b = await openBrowserPage(URL, { allowPrivate: true, browser });
  assert.equal(a.context, b.context, 'pages share aihttp-owned context');
  assert.equal(browser.allContexts().length, 1, 'one context for the launched browser');

  await a.close();
  assert.equal(a.page.closeCalls, 1);
  assert.equal(a.context.closeCalls, 0, 'closing one page must not close the shared context');
  const status = await b.api.status();
  assert.equal(status.locked, false, 'sibling page still responds');

  await b.close();
  assert.equal(a.context.closeCalls, 1, 'last page closes the context aihttp created');
});

test('page close is idempotent and closes the context only once', async () => {
  const browser = fakeBrowser();
  const page = await openBrowserPage(URL, { allowPrivate: true, browser });
  await page.close();
  await page.close();
  assert.equal(page.page.closeCalls, 1);
  assert.equal(page.context.closeCalls, 1);
});

test('browser context uses the shared package User-Agent', async () => {
  const browser = fakeBrowser();
  const page = await openBrowserPage(URL, { allowPrivate: true, browser });
  assert.equal(browser.lastContextOptions.userAgent, DEFAULT_UA);
  await page.close();
});

test('aihttp does not close a context it did not create', async () => {  const existing = fakeContext();
  const browser = fakeBrowser({ contexts: [existing] });
  const page = await openBrowserPage(URL, { allowPrivate: true, browser, reuseExistingContext: true });
  assert.equal(page.context, existing);
  await page.close();
  assert.equal(existing.closeCalls, 0, 'external context is left open');
});

test('existing browser contexts are ignored unless reuse is explicit', async () => {
  const existing = fakeContext();
  const browser = fakeBrowser({ contexts: [existing] });
  const page = await openBrowserPage(URL, { allowPrivate: true, browser });
  assert.notEqual(page.context, existing, 'a fresh context is created by default');
  assert.equal(browser.allContexts().length, 2);
  await page.close();
  assert.equal(existing.closeCalls, 0, 'the existing profile context was never touched');
  assert.equal(page.context.closeCalls, 1, 'the fresh context is closed with its last page');
});

test('navigation failure releases the page and the owned context', async () => {
  const browser = fakeBrowser();
  const context = fakeContext();
  browser.newContext = async () => context;
  const originalNewPage = context.newPage;
  context.newPage = async function () {
    const page = await originalNewPage.call(context);
    page.goto = async () => { throw new Error('navigation failed'); };
    return page;
  };
  await assert.rejects(openBrowserPage(URL, { allowPrivate: true, browser }), /navigation failed/);
  assert.equal(context.pages.length, 0);
  assert.equal(context.closeCalls, 1, 'owned context is closed when its only page fails');
});
