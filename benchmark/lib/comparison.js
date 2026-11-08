'use strict';

const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { tokenCount, markdownFromHtml } = require('./real');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'ecommerce.html');
const ENGINE = path.join(__dirname, '..', '..', 'aihttp.js');

function findAction(snapshot, predicate) {
  return (snapshot.actions || []).find(predicate) || null;
}

async function runComparison(options) {
  const opts = options || {};
  const enginePath = opts.enginePath || ENGINE;
  const engineName = opts.engineName || 'aihttp.js in Chromium';
  const browser = await chromium.launch({ headless: true });
  const browserVersion = typeof browser.version === 'function' ? browser.version() : 'unknown';
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const methods = {
    raw: { name: 'Raw HTML (DOM serialization)', steps: [], latencies: [], actionable: false, guardrails: false, spa: false },
    markdown: { name: 'Readability + Turndown Markdown', steps: [], latencies: [], actionable: false, guardrails: false, spa: false },
    axtree: { name: 'Playwright ariaSnapshot (Chromium)', steps: [], latencies: [], actionable: false, guardrails: false, spa: true },
    ahttp: { name: engineName, steps: [], latencies: [], actionable: true, guardrails: true, spa: true }
  };
  let success = false;
  let finalSnapshot = '';
  try {
    await page.goto(pathToFileURL(FIXTURE).href, { waitUntil: 'domcontentloaded' });
    const engineScript = await page.addScriptTag({ path: enginePath });
    await engineScript.evaluate((element) => element.remove());

    async function sample(stepLatency) {
      const rawStarted = process.hrtime.bigint();
      const raw = await page.content();
      methods.raw.steps.push(tokenCount(raw));
      methods.raw.latencies.push(Number(process.hrtime.bigint() - rawStarted) / 1e6);

      const mdStarted = process.hrtime.bigint();
      const markdown = markdownFromHtml(raw, 'https://nimbus.test/checkout');
      methods.markdown.steps.push(tokenCount(markdown));
      methods.markdown.latencies.push(Number(process.hrtime.bigint() - mdStarted) / 1e6);

      const axStarted = process.hrtime.bigint();
      const aria = await page.ariaSnapshot();
      methods.axtree.steps.push(tokenCount(aria));
      methods.axtree.latencies.push(Number(process.hrtime.bigint() - axStarted) / 1e6);

      const ahttpText = await page.evaluate(() => window.ahttp.snapshot({ format: 'text', maxActions: 60, maxText: 900 }));
      methods.ahttp.steps.push(tokenCount(ahttpText));
      methods.ahttp.latencies.push(stepLatency || 0);
      return { raw: raw, aria: aria, ahttp: ahttpText };
    }

    async function act(id, payload) {
      const started = process.hrtime.bigint();
      const result = await page.evaluate((args) => window.ahttp.act(args[0], args[1]), [id, payload || null]);
      return { result: result, ms: Number(process.hrtime.bigint() - started) / 1e6 };
    }

    let snapshot = await page.evaluate(() => window.ahttp.snapshot({ format: 'json', maxActions: 60, maxText: 900 }));
    let choose = findAction(snapshot, (action) => action.label === 'Choose Pro');
    let step = await act(choose.id);
    await sample(step.ms);

    snapshot = await page.evaluate(() => window.ahttp.snapshot({ format: 'json', maxActions: 60, maxText: 900 }));
    const checkout = findAction(snapshot, (action) => action.label === 'Checkout');
    step = await act(checkout.id);
    await sample(step.ms);

    snapshot = await page.evaluate(() => window.ahttp.snapshot({ format: 'json', maxActions: 60, maxText: 900 }));
    const email = findAction(snapshot, (action) => action.name === 'email');
    step = await act(email.id, 'agent@example.com');
    await sample(step.ms);

    snapshot = await page.evaluate(() => window.ahttp.snapshot({ format: 'json', maxActions: 60, maxText: 900 }));
    const promo = findAction(snapshot, (action) => action.name === 'promo');
    const fillPromo = await act(promo.id, 'AGENT20');
    snapshot = await page.evaluate(() => window.ahttp.snapshot({ format: 'json', maxActions: 60, maxText: 900 }));
    const apply = findAction(snapshot, (action) => action.label === 'Apply promo');
    const applyPromo = await act(apply.id);
    await sample(fillPromo.ms + applyPromo.ms);

    snapshot = await page.evaluate(() => window.ahttp.snapshot({ format: 'json', maxActions: 60, maxText: 900 }));
    const place = findAction(snapshot, (action) => action.label === 'Place order');
    step = await act(place.id);
    const final = await sample(step.ms);
    finalSnapshot = final.ahttp;
    success = /Order confirmed/.test(final.raw) && /Order confirmed/.test(finalSnapshot);
  } finally {
    await context.close();
    await browser.close();
  }

  const result = [];
  for (const key of ['raw', 'markdown', 'axtree', 'ahttp']) {
    const method = methods[key];
    const totalTokens = method.steps.reduce((sum, value) => sum + value, 0);
    const avgLatency = method.latencies.length
      ? method.latencies.reduce((sum, value) => sum + value, 0) / method.latencies.length
      : 0;
    result.push({
      key: key,
      name: method.name,
      steps: method.steps.length,
      stepTokens: method.steps,
      totalTokens: totalTokens,
      avgStepTokens: method.steps.length ? Math.round(totalTokens / method.steps.length) : 0,
      avgLatencyMs: Math.round(avgLatency * 100) / 100,
      actionable: method.actionable,
      guardrails: method.guardrails,
      spa: method.spa
    });
  }
  const raw = result.find((method) => method.key === 'raw');
  const ahttp = result.find((method) => method.key === 'ahttp');
  const ax = result.find((method) => method.key === 'axtree');
  return {
    scenario: 'ecommerce-checkout-5-steps',
    methodology: 'Chromium drives benchmark/fixtures/ecommerce.html. aihttp.js is injected into the live page and executes the five steps. Raw HTML, Readability+Turndown Markdown, and Playwright ariaSnapshot are sampled after each step from the same live DOM state. Token counts use gpt-tokenizer 4.1.0 countTokens (o200k_base). Static methods cannot execute actions; their success rate is zero by construction.',
    browser: 'Playwright Chromium',
    browserVersion: browserVersion,
    steps: 5,
    success: success,
    totalTokenRatio: ahttp && ahttp.totalTokens ? Math.round((raw.totalTokens / ahttp.totalTokens) * 10) / 10 : 0,
    ahttpVsAx: ahttp && ahttp.totalTokens && ax ? Math.round((ax.totalTokens / ahttp.totalTokens) * 10) / 10 : null,
    methods: result
  };
}

module.exports = { runComparison };
