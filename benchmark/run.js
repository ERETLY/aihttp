#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { SUITE } = require('./lib/torture');
const { runOwnerTest } = require('./lib/owner-suite');
const { runMcpTest } = require('./lib/mcp-suite');
const { runComparison } = require('./lib/comparison');
const { runTaskBenchmark } = require('./tasks');
const { openPage, openHtml } = require('../lib/page');
const { SITES } = require('./lib/sites');
const { tokenCount, markdownFromHtml, createAriaRunner } = require('./lib/real');
const pkg = require('../package.json');

const RESULTS_PATH = path.join(__dirname, 'results.json');
const PINNED_DIR = path.join(__dirname, 'pinned');
const LIVE = process.argv.includes('--live');

function bytes(value) {
  return Buffer.byteLength(String(value == null ? '' : value), 'utf8');
}

function pad(value, width) {
  const str = String(value);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

function lpad(value, width) {
  const str = String(value);
  return str.length >= width ? str : ' '.repeat(width - str.length) + str;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

// URL to snapshot with the real engine: fetch, linked stylesheets, scan.
// One request, no retries. Returns null if the request fails or AHTTP_LIVE=0.
async function timeLiveAhttp(url) {
  if (process.env.AHTTP_LIVE === '0') return null;
  const started = performance.now();
  try {
    const page = await openPage(url, { timeout: 30000 });
    page.api.snapshot({ format: 'text', maxActions: 60, maxText: 1200 });
    return Math.round(performance.now() - started);
  } catch (e) {
    return null;
  }
}

async function runTorture() {
  const out = [];
  for (let i = 0; i < SUITE.length; i++) {
    const test = SUITE[i];
    const started = performance.now();
    let checks = [];
    try {
      checks = await test.run();
    } catch (err) {
      checks = [{ name: 'suite completed without throwing', pass: false, actual: err && err.stack ? err.stack.split('\n')[0] : String(err) }];
    }
    const passed = checks.filter(function (c) { return c.pass; }).length;
    const entry = {
      index: i + 1,
      id: test.id,
      name: test.name,
      pass: passed === checks.length && checks.length > 0,
      passed: passed,
      total: checks.length,
      ms: Math.round(performance.now() - started),
      checks: checks
    };
    out.push(entry);
    process.stdout.write((entry.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2, '0') + '  ' + pad(test.name, 52) + ' ' + passed + '/' + checks.length + '  ' + entry.ms + 'ms\n');
    if (!entry.pass) {
      for (const check of checks) {
        if (!check.pass) process.stdout.write('      x ' + check.name + (check.actual ? ' [' + check.actual + ']' : '') + '\n');
      }
    }
  }
  return out;
}

function readPinned() {
  const indexPath = path.join(PINNED_DIR, 'index.json');
  if (!fs.existsSync(indexPath)) return {};
  const entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const map = {};
  for (const entry of entries) map[entry.name] = entry;
  return map;
}

async function runWebBenchmark() {
  const out = [];
  const pinned = readPinned();
  let aria = null;
  try {
    aria = await createAriaRunner({ javaScriptEnabled: LIVE, timeout: 30000 });
  } catch (e) {
    aria = null;
    process.stdout.write('note: browser accessibility snapshots unavailable: ' + (e && e.message ? e.message : String(e)) + '\n');
  }
  try {
    for (const site of SITES) {
      const started = performance.now();
      const entry = pinned[site.name];
      if (!LIVE && (!entry || entry.error || !entry.file)) {
        out.push({ name: site.name, url: site.url, status: 'error', error: 'pinned fixture missing; run node benchmark/fetch-pinned.js' });
        process.stdout.write('FAIL  ' + pad(site.name, 26) + ' pinned fixture missing\n');
        continue;
      }
      try {
        let page;
        let raw;
        let source;
        if (LIVE) {
          page = await openPage(site.url, { timeout: 30000 });
          raw = page.raw;
          source = 'live';
        } else {
          raw = fs.readFileSync(path.join(PINNED_DIR, entry.file), 'utf8');
          page = openHtml(raw, site.url);
          source = 'pinned';
        }
        const totalMs = Math.round(performance.now() - started);
        const data = page.api.snapshot({ format: 'json', maxActions: 60, maxText: 1200 });
        const snapshotText = page.api.snapshot({ format: 'text', maxActions: 60, maxText: 1200 });
        const rawTokens = tokenCount(raw);
        const snapshotTokens = tokenCount(snapshotText);
        let ariaTokens = null;
        let ariaStatus = 'unavailable';
        if (aria) {
          try {
            const ariaText = LIVE ? await aria.fromUrl(site.url) : await aria.fromHtml(raw);
            ariaTokens = tokenCount(ariaText);
            ariaStatus = 'ok';
          } catch (e) {
            ariaStatus = 'error: ' + (e && e.message ? e.message : String(e));
          }
        }
        const markdownTokens = tokenCount(markdownFromHtml(raw, site.url));
        let jinaTokens = null;
        let jinaMs = null;
        let jinaStatus = process.env.AHTTP_JINA === '0' ? 'skipped' : 'unavailable';
        if (process.env.AHTTP_JINA !== '0') {
          const jinaStarted = performance.now();
          try {
            const headers = process.env.JINA_API_KEY ? { Authorization: 'Bearer ' + process.env.JINA_API_KEY } : {};
            const response = await fetch('https://r.jina.ai/' + site.url, { headers: headers, signal: AbortSignal.timeout(25000) });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const text = await response.text();
            jinaMs = Math.round(performance.now() - jinaStarted);
            jinaTokens = tokenCount(text);
            jinaStatus = 'ok';
          } catch (e) {
            jinaStatus = 'error: ' + (e && e.message ? e.message : String(e));
          }
        }
        let firecrawlTokens = null;
        let firecrawlMs = null;
        let firecrawlStatus = process.env.AHTTP_FIRECRAWL === '0' ? 'skipped' : (!process.env.FIRECRAWL_API_KEY ? 'no key' : 'unavailable');
        if (process.env.AHTTP_FIRECRAWL !== '0' && process.env.FIRECRAWL_API_KEY) {
          const firecrawlStarted = performance.now();
          try {
            const response = await fetch('https://api.firecrawl.dev/v2/scrape', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.FIRECRAWL_API_KEY },
              body: JSON.stringify({ url: site.url, formats: ['markdown'] }),
              signal: AbortSignal.timeout(40000)
            });
            const body = await response.json();
            firecrawlMs = Math.round(performance.now() - firecrawlStarted);
            if (!response.ok || !body || body.success === false || !body.data || typeof body.data.markdown !== 'string') {
              firecrawlMs = null;
              throw new Error('HTTP ' + response.status + (body && body.error ? ': ' + body.error : ''));
            }
            firecrawlTokens = tokenCount(body.data.markdown);
            firecrawlStatus = 'ok';
          } catch (e) {
            firecrawlStatus = 'error: ' + (e && e.message ? e.message : String(e));
          }
        }
        const ahttpLiveMs = await timeLiveAhttp(site.url);
        const result = {
          name: site.name,
          url: site.url,
          source: source,
          status: 'ok',
          pinnedSha256: !LIVE && entry ? entry.sha256 : null,
          pinnedFetchedAt: !LIVE && entry ? entry.fetchedAt : null,
          httpStatus: page.status,
          rawBytes: page.rawBytes,
          rawTokens: rawTokens,
          snapshotBytes: bytes(snapshotText),
          snapshotTokens: snapshotTokens,
          ratio: snapshotTokens ? Math.round((rawTokens / snapshotTokens) * 10) / 10 : 0,
          markdownTokens: markdownTokens,
          markdownRatio: markdownTokens && snapshotTokens ? Math.round((markdownTokens / snapshotTokens) * 10) / 10 : 0,
          jinaTokens: jinaTokens,
          jinaStatus: jinaStatus,
          firecrawlTokens: firecrawlTokens,
          firecrawlStatus: firecrawlStatus,
          axTokens: ariaTokens,
          axStatus: ariaStatus,
          axRatio: ariaTokens && snapshotTokens ? Math.round((ariaTokens / snapshotTokens) * 10) / 10 : null,
          actions: data.meta.actions,
          shown: data.meta.shown,
          omitted: data.meta.omitted,
          groups: data.meta.groups,
          controls: data.meta.controls,
          nodes: data.meta.nodes,
          sanitized: data.meta.sanitized,
          shadowRoots: data.meta.shadowRoots,
          scanMs: round(data.meta.scanMs),
          fetchMs: page.fetchMs,
          parseMs: Math.max(0, totalMs - page.fetchMs - Math.round(data.meta.scanMs)),
          totalMs: totalMs,
          liveMs: { ahttp: ahttpLiveMs, jina: jinaMs, firecrawl: firecrawlMs },
          layout: data.meta.layout
        };
        out.push(result);
        process.stdout.write('PASS  ' + pad(site.name, 26) + lpad(rawTokens, 9) + ' raw  ' + lpad(snapshotTokens, 7) + ' ahttp  ' +
          lpad(ariaTokens == null ? 'n/a' : ariaTokens, 7) + ' AX  ' + lpad(markdownTokens, 7) + ' md  ' +
          lpad(jinaTokens == null ? 'n/a' : jinaTokens, 7) + ' jina  ' + lpad(firecrawlTokens == null ? 'n/a' : firecrawlTokens, 7) + ' fc  ' +
          lpad(result.ratio + 'x', 7) + '  ' + lpad(result.actions, 4) + ' actions  ' + lpad(result.scanMs + 'ms', 8) + '\n');
      } catch (err) {
        out.push({ name: site.name, url: site.url, status: 'error', error: err && err.message ? err.message : String(err), ms: Math.round(performance.now() - started) });
        process.stdout.write('FAIL  ' + pad(site.name, 26) + ' ' + (err && err.message ? err.message : String(err)) + '\n');
      }
    }
  } finally {
    if (aria) await aria.close();
  }
  return out;
}

async function main() {
  process.stdout.write('\nahttp benchmark ' + pkg.version + ' | node ' + process.version + ' ' + process.platform + '\n\n');
  const results = {
    generatedAt: new Date().toISOString(),
    version: pkg.version,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    tokenEstimate: 'gpt-tokenizer 4.1.0 countTokens (o200k_base)',
    tokenizer: 'gpt-tokenizer@4.1.0/o200k_base',
    torture: [],
    web: [],
    comparison: null,
    tasks: null,
    owner: null,
    mcp: null,
    summary: {}
  };

  process.stdout.write('[TORTURE SUITE]\n');
  results.torture = await runTorture();

  process.stdout.write('\n[OWNER MODE]\n');
  try {
    results.owner = await runOwnerTest();
    const ownerPassed = results.owner.filter(function (check) { return check.pass; }).length;
    process.stdout.write((ownerPassed === results.owner.length ? 'PASS' : 'FAIL') + '  gate/owner policy and unlock ' + ownerPassed + '/' + results.owner.length + '\n');
    if (ownerPassed !== results.owner.length) {
      for (const check of results.owner) {
        if (!check.pass) process.stdout.write('      x ' + check.name + (check.actual ? ' [' + check.actual + ']' : '') + '\n');
      }
    }
  } catch (err) {
    results.owner = [{ name: 'owner suite completed without throwing', pass: false, actual: err && err.message ? err.message : String(err) }];
    process.stdout.write('FAIL  gate/owner mode: ' + results.owner[0].actual + '\n');
  }
  const ownerPassed = results.owner.filter(function (check) { return check.pass; }).length;
  const ownerPass = ownerPassed === results.owner.length && results.owner.length > 0;

  process.stdout.write('\n[WEB ' + (LIVE ? 'LIVE' : 'PINNED') + ']\n');
  results.web = await runWebBenchmark();
  const webPassed = results.web.filter(function (site) { return site.status === 'ok'; }).length;

  process.stdout.write('\n[COMPARISON]\n');
  try {
    results.comparison = await runComparison();
    for (const method of results.comparison.methods) {
      process.stdout.write(pad(method.name, 48) + lpad(method.totalTokens, 9) + ' tokens  ' + lpad(method.stepTokens.join('/'), 30) + '  ' + lpad(method.avgLatencyMs + 'ms', 9) + '\n');
    }
    process.stdout.write(pad('total token ratio (raw / ahttp)', 48) + lpad(results.comparison.totalTokenRatio + 'x', 9) + '\n');
  } catch (err) {
    results.comparison = { error: err && err.message ? err.message : String(err) };
    process.stdout.write('FAIL  comparison: ' + results.comparison.error + '\n');
  }

  process.stdout.write('\n[TASK BENCHMARK]\n');
  try {
    results.tasks = await runTaskBenchmark();
    process.stdout.write((results.tasks.ahttpSuccess === results.tasks.tasks ? 'PASS' : 'FAIL') +
      '  scripted agent ' + results.tasks.ahttpSuccess + '/' + results.tasks.tasks +
      '  ahttp tokens ' + results.tasks.ahttpTokens +
      '  raw/AX ' + results.tasks.rawTokens + '/' + results.tasks.axTokens + '\n');
    if (results.tasks.ahttpSuccess !== results.tasks.tasks) {
      for (const task of results.tasks.results) {
        if (!task.success) process.stdout.write('      x ' + task.name + ' [' + task.error + ']\n');
      }
    }
  } catch (err) {
    results.tasks = { error: err && err.message ? err.message : String(err) };
    process.stdout.write('FAIL  task benchmark: ' + results.tasks.error + '\n');
  }

  process.stdout.write('\n[MCP]\n');
  results.mcp = await runMcpTest();
  process.stdout.write((results.mcp.pass ? 'PASS' : 'FAIL') + '  JSON-RPC initialize/list/call ' + results.mcp.passed + '/' + results.mcp.total + ' in ' + results.mcp.ms + 'ms\n');
  if (!results.mcp.pass) {
    for (const check of results.mcp.checks) {
      if (!check.pass) process.stdout.write('      x ' + check.name + (check.actual ? ' [' + check.actual + ']' : '') + '\n');
    }
  }

  const torturePassed = results.torture.filter(function (test) { return test.pass; }).length;
  const tasksPass = !!results.tasks && !results.tasks.error && results.tasks.ahttpSuccess === results.tasks.tasks;
  const allPass = torturePassed === SUITE.length && ownerPass && results.mcp.pass && webPassed === results.web.length && results.web.length > 0 && !!results.comparison && !results.comparison.error && tasksPass;
  results.summary = {
    torturePassed: torturePassed,
    tortureTotal: SUITE.length,
    ownerPassed: ownerPassed,
    ownerTotal: results.owner.length,
    ownerPass: ownerPass,
    mcpPassed: results.mcp.passed,
    mcpTotal: results.mcp.total,
    mcpPass: results.mcp.pass,
    webPassed: webPassed,
    webTotal: results.web.length,
    tasksPassed: results.tasks ? results.tasks.ahttpSuccess : 0,
    tasksTotal: results.tasks ? results.tasks.tasks : 0,
    tasksPass: tasksPass,
    allPass: allPass
  };

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + '\n', 'utf8');
  process.stdout.write('\n' + (allPass ? 'RESULT: PASS' : 'RESULT: FAIL') +
    ' (' + torturePassed + '/' + SUITE.length + ' torture, owner ' + ownerPassed + '/' + results.owner.length +
    ', MCP ' + results.mcp.passed + '/' + results.mcp.total +
    ', web ' + webPassed + '/' + results.web.length + ')\n');
  process.stdout.write('results: ' + RESULTS_PATH + '\n');
  if (!allPass) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write('benchmark failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});
