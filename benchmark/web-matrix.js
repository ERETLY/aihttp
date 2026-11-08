'use strict';

// Coverage matrix: N public sites, one snapshot each, measured against an
// independent oracle of reachable controls. This is deliberately not part of
// `npm test` or CI: it needs the public network and sites change without
// notice. Use it to find engine gaps, not to gate a release.
//
//   node benchmark/web-matrix.js                     all sites
//   node benchmark/web-matrix.js --limit=20          first 20
//   node benchmark/web-matrix.js --filter=wikipedia  id/url substring
//   node benchmark/web-matrix.js --category=docs     one category
//   node benchmark/web-matrix.js --concurrency=4 --timeout=45000
//
// The report is written to benchmark/web-matrix-results.json.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { measurePage } = require('./lib/coverage');

const ROOT = path.join(__dirname, '..');
const ENGINE = fs.readFileSync(path.join(ROOT, 'aihttp.js'), 'utf8');
const SITES_JSON = require('./web-sites.json');
const SITES = Array.isArray(SITES_JSON) ? SITES_JSON : (SITES_JSON.sites || []);
const pkg = require(path.join(ROOT, 'package.json'));

function arg(name, fallback) {
  const hit = process.argv.find(function (value) { return value.indexOf('--' + name + '=') === 0; });
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

function flag(name) {
  return process.argv.indexOf('--' + name) >= 0;
}

const CONCURRENCY = Math.max(1, Math.min(8, Number(arg('concurrency', 3)) || 3));
const TIMEOUT = Math.max(5000, Number(arg('timeout', 45000)) || 45000);
const PAUSE = Math.max(0, Number(arg('pause', 800)) || 0);
const OUT = path.join(__dirname, arg('out', 'web-matrix-results.json'));
const LIMIT = Number(arg('limit', 0)) || 0;
const FILTER = String(arg('filter', '') || '').toLowerCase();
const IDS = String(arg('ids', '') || '').split(',').map(function (value) { return value.trim(); }).filter(Boolean);
const CATEGORY = String(arg('category', '') || '').toLowerCase();
const HEADFUL = flag('headful');
const SCROLL = !flag('no-scroll');

let GIT_SHA = 'unknown';
try {
  GIT_SHA = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch (e) {}

function nowMs() { return Date.now(); }
function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

function isBlocked(status, title, bodyStart) {
  if (status === 401 || status === 403 || status === 429 || status === 451 || status === 503) {
    return 'http ' + status;
  }
  const probe = (title + ' ' + bodyStart).toLowerCase();
  if (/captcha|are you a robot|access denied|just a moment|checking your browser|enable javascript and cookies/.test(probe)) {
    return 'bot wall';
  }
  // Reddit and a few other sites answer a headless request with a security
  // interstitial that is HTTP 200. It is a bot wall, not a 60% page.
  if (/you've been blocked|you have been blocked|blocked by network security|whoa there|unusual traffic|verify you are human|request blocked/.test(probe)) {
    return 'bot wall';
  }
  return null;
}

// A full-viewport consent layer is not a page the engine can read. The list is
// vendor containers, not per-site selectors, and the 50% viewport rule keeps a
// small cookie bar from being mistaken for a wall.
const CONSENT_SELECTORS = [
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk',
  '#sp_message_container',
  '#sp_privacy_manager_container',
  '[id^="cmp"]',
  '[class*="cookie-consent"]',
  '[class*="consent-banner"]',
  '[aria-label*="consent" i]'
];

// Lazy sections (MDN's compat table, infinite lists, below-the-fold cards) do
// not exist until they approach the viewport. Walk the page once so the
// snapshot measures what a user can reach, not what happened to be mounted.
async function lazyScroll(page) {
  try {
    await page.evaluate(async function () {
      var step = Math.max(240, Math.floor(window.innerHeight * 0.8));
      var height = Math.min(document.documentElement ? document.documentElement.scrollHeight : 0, 30000);
      for (var y = 0; y < height; y += step) {
        window.scrollTo(0, y);
        await new Promise(function (resolve) { setTimeout(resolve, 50); });
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(400);
  } catch (e) {}
}

async function consentWall(page) {  return page.evaluate(function (selectors) {
    var viewport = window.innerWidth * window.innerHeight;
    if (!viewport) return null;
    for (var i = 0; i < selectors.length; i++) {
      var nodes = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        var cs = null;
        try { cs = getComputedStyle(el); } catch (e) { cs = null; }
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
        var rect = el.getBoundingClientRect();
        if (rect.width * rect.height >= viewport * 0.5) return selectors[i];
      }
    }
    return null;
  }, CONSENT_SELECTORS).catch(function () { return null; });
}

function networkError(message) {
  return /ERR_NETWORK_ACCESS_DENIED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED|ERR_TIMED_OUT|ERR_HTTP2_PROTOCOL_ERROR|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|net::ERR_|Timeout \d+ms exceeded/i.test(String(message || ''));
}

async function runSite(browser, site) {
  const started = nowMs();
  const result = {
    id: site.id,
    url: site.url,
    category: site.category || 'other',
    note: site.note || '',
    status: 'ok',
    httpStatus: null,
    blocked: null,
    error: null,
    title: null,
    loadMs: 0,
    totalMs: 0,
    metrics: null
  };
  const context = await browser.newContext({
    viewport: site.viewport || { width: 1280, height: 800 },
    userAgent: 'aihttp-coverage-matrix (+https://github.com/ERETLY/aiweb)',
    locale: site.locale || 'en-US'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  page.on('dialog', function (dialog) { dialog.dismiss().catch(function () {}); });
  try {
    await page.addInitScript({ content: ENGINE });
    let response = null;
    const loadStarted = nowMs();
    try {
      response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      // Ad-heavy pages finish their own hydration after DOMContentLoaded.
      // Waiting for load (bounded) keeps a slow ad from blocking the matrix
      // while giving the page a real chance to render its controls.
      try { await page.waitForLoadState('load', { timeout: 8000 }); } catch (e) {}
    } catch (e) {
      const message = String((e && e.message) || e);
      result.status = networkError(message) ? 'network' : 'error';
      result.error = 'goto: ' + message;
      return result;
    }
    result.httpStatus = response ? response.status() : null;
    await page.waitForTimeout(PAUSE || 2200);
    result.title = await page.title().catch(function () { return ''; });
    result.loadMs = nowMs() - loadStarted;

    const bodyStart = await page.evaluate(function () {
      return (document.body ? document.body.innerText : '').slice(0, 800);
    }).catch(function () { return ''; });
    const blocked = isBlocked(result.httpStatus, result.title || '', bodyStart) || await consentWall(page);
    if (blocked) {
      result.status = 'blocked';
      result.blocked = blocked;
      return result;
    }

    if (SCROLL) await lazyScroll(page);

    try {
      result.metrics = await measurePage(page);
    } catch (e) {
      result.status = 'error';
      result.error = 'measure: ' + String((e && e.message) || e);
      return result;
    }
    // A consent dialog with a few Accept/Reject controls is a barrier, not a
    // coverage failure: the page behind it is not reachable until a decision.
    if (result.metrics && result.metrics.consentModal) {
      result.status = 'blocked';
      result.blocked = 'consent modal';
      return result;
    }
    if (result.metrics && result.metrics.recall && result.metrics.recall.oracleError) {
      result.status = 'oracle_error';
      result.error = result.metrics.recall.oracleError;
    }
  } catch (e) {
    result.status = 'error';
    result.error = String((e && e.message) || e);
  } finally {
    await context.close().catch(function () {});
    result.totalMs = nowMs() - started;
  }
  return result;
}

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

function aggregate(sites) {
  const measured = sites.filter(function (site) {
    return site.status === 'ok' && site.metrics && site.metrics.recall && site.metrics.recall.visible > 0;
  });
  const visible = measured.reduce(function (sum, site) { return sum + site.metrics.recall.visible; }, 0);
  const matched = measured.reduce(function (sum, site) { return sum + site.metrics.recall.matched; }, 0);
  const phantom = measured.reduce(function (sum, site) { return sum + site.metrics.recall.phantomTotal; }, 0);
  const below = measured.filter(function (site) { return site.metrics.recall.ratio < 0.9; });
  const byCategory = {};
  for (const site of measured) {
    const key = site.category || 'other';
    if (!byCategory[key]) byCategory[key] = { sites: 0, visible: 0, matched: 0, phantom: 0 };
    byCategory[key].sites++;
    byCategory[key].visible += site.metrics.recall.visible;
    byCategory[key].matched += site.metrics.recall.matched;
    byCategory[key].phantom += site.metrics.recall.phantomTotal;
  }
  for (const key of Object.keys(byCategory)) {
    const row = byCategory[key];
    row.recall = row.visible ? Math.round((row.matched / row.visible) * 1000) / 10 : null;
  }
  return {
    sites: sites.length,
    ok: sites.filter(function (site) { return site.status === 'ok'; }).length,
    blocked: sites.filter(function (site) { return site.status === 'blocked'; }).length,
    network: sites.filter(function (site) { return site.status === 'network'; }).length,
    errors: sites.filter(function (site) { return site.status === 'error' || site.status === 'oracle_error'; }).length,
    measured: measured.length,
    visibleControls: visible,
    matchedControls: matched,
    weightedRecall: visible ? Math.round((matched / visible) * 1000) / 10 : null,
    meanRecall: measured.length
      ? Math.round((measured.reduce(function (sum, site) { return sum + site.metrics.recall.ratio; }, 0) / measured.length) * 1000) / 10
      : null,
    sitesBelow90: below.length,
    phantom: phantom,
    byCategory: byCategory
  };
}

async function main() {
  let sites = SITES.slice();
  if (IDS.length) sites = sites.filter(function (site) { return IDS.indexOf(site.id) >= 0; });
  if (CATEGORY) sites = sites.filter(function (site) { return String(site.category || '').toLowerCase() === CATEGORY; });
  if (FILTER) {
    sites = sites.filter(function (site) {
      return site.id.toLowerCase().indexOf(FILTER) >= 0 || site.url.toLowerCase().indexOf(FILTER) >= 0;
    });
  }
  if (LIMIT) sites = sites.slice(0, LIMIT);
  if (!sites.length) {
    console.error('no sites matched');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: !HEADFUL });
  const output = {
    generatedAt: new Date().toISOString(),
    engine: { version: pkg.version, sha: GIT_SHA },
    runtime: { node: process.version, chromium: browser.version(), concurrency: CONCURRENCY },
    sites: []
  };
  const started = nowMs();
  let done = 0;
  try {
    const results = await pool(sites, CONCURRENCY, async function (site) {
      const result = await runSite(browser, site);
      done++;
      const recall = result.metrics && result.metrics.recall && result.metrics.recall.ratio != null
        ? Math.round(result.metrics.recall.ratio * 1000) / 10 + '%'
        : 'n/a';
      const actions = result.metrics ? result.metrics.actions : 'n/a';
      process.stdout.write('[' + done + '/' + sites.length + '] ' + site.id + ' ' + result.status +
        ' actions=' + actions + ' recall=' + recall +
        (result.blocked ? ' (' + result.blocked + ')' : '') +
        (result.error ? ' ' + result.error.slice(0, 120) : '') + '\n');
      return result;
    });
    output.sites = results;
    output.summary = aggregate(results);
    output.durationMs = nowMs() - started;
    fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
    await sleep(0);
  } finally {
    await browser.close().catch(function () {});
  }

  const s = output.summary;
  console.log('');
  console.log('sites=' + s.sites + ' ok=' + s.ok + ' blocked=' + s.blocked + ' network=' + s.network +
    ' errors=' + s.errors + ' measured=' + s.measured);
  console.log('controls: ' + s.matchedControls + '/' + s.visibleControls +
    ' weighted recall=' + s.weightedRecall + '% mean=' + s.meanRecall + '%');
  console.log('sites below 90%: ' + s.sitesBelow90 + ' | phantom actions: ' + s.phantom);
  console.log('wrote ' + OUT);
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
