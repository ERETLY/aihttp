'use strict';

const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');
const { countTokens } = require('gpt-tokenizer');

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-'
});

function tokenCount(value) {
  return countTokens(String(value == null ? '' : value));
}

function readable(html, url) {
  const dom = new JSDOM(String(html || ''), { url: url || 'https://fixture.test/' });
  const document = dom.window.document;
  let article = null;
  try {
    article = new Readability(document.cloneNode(true), { charThreshold: 0 }).parse();
  } catch (e) {
    article = null;
  }
  return {
    document: document,
    article: article,
    source: article && article.content ? article.content : (document.body ? document.body.innerHTML : '')
  };
}

function markdownFromHtml(html, url) {
  const parsed = readable(html, url);
  try {
    return turndown.turndown(parsed.source);
  } catch (e) {
    return parsed.article && parsed.article.textContent ? parsed.article.textContent : '';
  }
}

function articleTextFromHtml(html, url) {
  const parsed = readable(html, url);
  if (parsed.article && parsed.article.textContent) return parsed.article.textContent;
  return parsed.document.body ? parsed.document.body.textContent : '';
}

function loadPlaywright() {
  try { return require('playwright'); } catch (e) {}
  try { return require('playwright-core'); } catch (e) {}
  throw new Error('Playwright is not installed');
}

async function createAriaRunner(options) {
  const opts = options || {};
  const playwright = loadPlaywright();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    javaScriptEnabled: opts.javaScriptEnabled === true,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(opts.timeout || 30000);
  return {
    page: page,
    async fromHtml(html) {
      await page.setContent(String(html || ''), { waitUntil: 'domcontentloaded', timeout: opts.timeout || 30000 });
      return page.ariaSnapshot();
    },
    async fromUrl(url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeout || 30000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(function () {});
      return page.ariaSnapshot();
    },
    async close() {
      try { await context.close(); } catch (e) {}
      try { await browser.close(); } catch (e) {}
    }
  };
}

module.exports = {
  tokenCount,
  markdownFromHtml,
  articleTextFromHtml,
  createAriaRunner
};
