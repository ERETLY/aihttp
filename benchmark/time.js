#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { openPage, openHtml } = require('../lib/page');
const { markdownFromHtml } = require('./lib/real');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const SELF = path.join(ROOT, 'self', 'ahttp.user.js');
const PINNED = path.join(__dirname, 'pinned');
const INDEX = JSON.parse(fs.readFileSync(path.join(PINNED, 'index.json'), 'utf8'));
const OPTIONS = { format: 'text', maxActions: 60, maxText: 1200 };

function listen() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(PINNED, name);
      if (!file.startsWith(PINNED) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port }));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function ms(value) {
  return Math.round(value * 10) / 10;
}

async function scanBenchmark() {
  const local = await listen();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.route('**/*', (route) => {
    const target = new URL(route.request().url());
    if (target.hostname === '127.0.0.1') route.continue();
    else route.abort();
  });
  const out = [];
  try {
    for (const site of INDEX) {
      const file = path.join(PINNED, site.file);
      const raw = fs.readFileSync(file, 'utf8');

      await page.goto(local.url + '/' + site.file, { waitUntil: 'domcontentloaded' });
      let started = performance.now();
      await page.evaluate(() => document.documentElement.outerHTML);
      const rawMs = performance.now() - started;

      started = performance.now();
      await page.ariaSnapshot();
      const axMs = performance.now() - started;

      const engine = await page.addScriptTag({ path: SELF });
      await engine.evaluate((element) => element.remove());
      const selfMs = await page.evaluate((options) => {
        const before = performance.now();
        window.ahttp.snapshot(options);
        return performance.now() - before;
      }, OPTIONS);

      started = performance.now();
      markdownFromHtml(raw, site.url);
      const markdownMs = performance.now() - started;

      const staticPage = openHtml(raw, site.url);
      const staticData = staticPage.api.snapshot({ format: 'json', maxActions: 60, maxText: 1200 });

      out.push({
        name: site.name,
        url: site.url,
        raw: ms(rawMs),
        markdown: ms(markdownMs),
        jina: null,
        firecrawl: null,
        axtree: ms(axMs),
        ahttp: ms(staticData.meta.scanMs),
        self: ms(selfMs)
      });
      process.stdout.write('SCAN  ' + site.name.padEnd(24) +
        ('raw ' + ms(rawMs)).padEnd(14) + ('md ' + ms(markdownMs)).padEnd(14) +
        ('ax ' + ms(axMs)).padEnd(14) + ('ahttp ' + ms(staticData.meta.scanMs)).padEnd(18) +
        'self ' + ms(selfMs) + '\n');
    }
  } finally {
    await context.close();
    await browser.close();
    await close(local.server);
  }
  return out;
}

async function liveBenchmark() {
  const browser = await chromium.launch({ headless: true });
  const out = [];
  try {
    for (const site of INDEX) {
      const row = { name: site.name, url: site.url, ahttp: null, self: null, jina: null, firecrawl: null };

      let started = performance.now();
      try {
        const page = await openPage(site.url, { timeout: 30000 });
        page.api.snapshot(OPTIONS);
        row.ahttp = ms(performance.now() - started);
      } catch (error) {
        row.ahttpError = String(error && error.message ? error.message : error);
      }

      const context = await browser.newContext({ serviceWorkers: 'block' });
      await context.addInitScript({ path: SELF });
      const page = await context.newPage();
      page.setDefaultTimeout(40000);
      started = performance.now();
      try {
        await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 40000 });
        await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
        const ok = await page.evaluate((options) => {
          if (!window.ahttp) return false;
          window.ahttp.snapshot(options);
          return true;
        }, OPTIONS);
        if (!ok) throw new Error('userscript did not load');
        row.self = ms(performance.now() - started);
      } catch (error) {
        row.selfError = String(error && error.message ? error.message : error);
      }
      await context.close();

      if (process.env.JINA_API_KEY) {
        started = performance.now();
        try {
          const response = await fetch('https://r.jina.ai/' + site.url, {
            headers: { Authorization: 'Bearer ' + process.env.JINA_API_KEY },
            signal: AbortSignal.timeout(90000)
          });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          await response.text();
          row.jina = ms(performance.now() - started);
        } catch (error) {
          row.jinaError = String(error && error.message ? error.message : error);
        }
      }

      if (process.env.FIRECRAWL_API_KEY) {
        started = performance.now();
        try {
          const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.FIRECRAWL_API_KEY },
            body: JSON.stringify({ url: site.url, formats: ['markdown'] }),
            signal: AbortSignal.timeout(120000)
          });
          const body = await response.json();
          if (!response.ok || !body || body.success === false || !body.data || typeof body.data.markdown !== 'string') {
            throw new Error('HTTP ' + response.status + (body && body.error ? ': ' + body.error : ''));
          }
          row.firecrawl = ms(performance.now() - started);
        } catch (error) {
          row.firecrawlError = String(error && error.message ? error.message : error);
        }
      }

      out.push(row);
      process.stdout.write('LIVE  ' + site.name.padEnd(24) +
        ('ahttp ' + row.ahttp).padEnd(16) + ('self ' + row.self).padEnd(16) +
        ('jina ' + row.jina).padEnd(16) + 'firecrawl ' + row.firecrawl + '\n');
    }
  } finally {
    await browser.close();
  }
  return out;
}

(async () => {
  const scan = await scanBenchmark();
  const live = await liveBenchmark();
  const out = {
    generatedAt: new Date().toISOString(),
    version: pkg.version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    scan: scan,
    live: live
  };
  fs.writeFileSync(path.join(__dirname, 'time-results.json'), JSON.stringify(out, null, 2) + '\n');
  process.stdout.write('wrote benchmark/time-results.json\n');
})().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
