#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { tokenCount } = require('./lib/real');
const { runComparison } = require('./lib/comparison');
const { runTaskBenchmark } = require('./tasks');
const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const SELF = path.join(ROOT, 'self', 'aihttp.user.js');
const PINNED = path.join(__dirname, 'pinned');
const INDEX = JSON.parse(fs.readFileSync(path.join(PINNED, 'index.json'), 'utf8'));

function listen() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(PINNED, name);
      if (!file.startsWith(PINNED) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end('not found'); return;
      }
      const ext = path.extname(file);
      const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port }));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function pages() {
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
      const started = process.hrtime.bigint();
      await page.goto(local.url + '/' + site.file, { waitUntil: 'domcontentloaded' });
      const loadMs = Number(process.hrtime.bigint() - started) / 1e6;
      const engineScript = await page.addScriptTag({ path: SELF });
      await engineScript.evaluate((element) => element.remove());
      const data = await page.evaluate(() => window.aihttp.snapshot({ format: 'json', maxActions: 60, maxText: 1200 }));
      const text = await page.evaluate(() => window.aihttp.snapshot({ format: 'text', maxActions: 60, maxText: 1200 }));
      out.push({
        name: site.name,
        url: site.url,
        tokens: tokenCount(text),
        actions: data.meta.actions,
        scanMs: Math.round(data.meta.scanMs),
        loadMs: Math.round(loadMs),
        status: 200
      });
      process.stdout.write('PASS  ' + site.name.padEnd(26) + String(out[out.length - 1].tokens).padStart(7) +
        ' tokens  ' + String(data.meta.actions).padStart(4) + ' actions  ' +
        String(Math.round(data.meta.scanMs)).padStart(6) + 'ms scan\n');
    }
  } finally {
    await context.close();
    await browser.close();
    await close(local.server);
  }
  return out;
}

(async () => {
  const pageRows = await pages();
  const checkout = await runComparison({ enginePath: SELF, engineName: 'self/aihttp.user.js in Chromium' });
  const methods = checkout.methods || [];
  const aihttp = methods.find((method) => method.key === 'aihttp') || {};
  const tasks = await runTaskBenchmark({ enginePath: SELF });
  const out = {
    generatedAt: new Date().toISOString(),
    version: pkg.version,
    engine: 'self/aihttp.user.js in Chromium',
    pages: pageRows,
    checkout: {
      tokens: aihttp.totalTokens || 0,
      stepTokens: aihttp.stepTokens || [],
      avgLatencyMs: aihttp.avgLatencyMs || 0,
      success: !!checkout.success
    },
    tasks: {
      tokens: tasks.aihttpTokens || 0,
      success: tasks.aihttpSuccess || 0,
      tasks: tasks.tasks || 0
    }
  };
  fs.writeFileSync(path.join(__dirname, 'self-results.json'), JSON.stringify(out, null, 2) + '\n');
  process.stdout.write('PASS  checkout ' + out.checkout.tokens + ' tokens, ' + out.checkout.avgLatencyMs + ' ms/step, success ' + out.checkout.success + '\n');
  process.stdout.write('PASS  tasks ' + out.tasks.success + '/' + out.tasks.tasks + ', ' + out.tasks.tokens + ' tokens\n');
  process.stdout.write('wrote benchmark/self-results.json\n');
})().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
