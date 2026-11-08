'use strict';

// Item 9: is the ~8 s act latency on the-internet a slow scan or the settle
// loop? Loads the live page in Chromium, injects the engine, and measures:
//   - snapshot in-page time
//   - act with settle:false (dispatch only)
//   - act with the harness options (quiet 120, minWait 60, timeout 20000)
//   - mutations seen in 1 s after the click
// Run: node benchmark/realworld/repro/latency/repro.js

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const ENGINE = fs.readFileSync(path.join(ROOT, 'aihttp.js'), 'utf8');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript({ content: ENGINE });
  const t0 = Date.now();
  await page.goto('https://the-internet.herokuapp.com/checkboxes', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1200);
  const loadMs = Date.now() - t0;

  const snap = await page.evaluate(function () {
    var t = performance.now();
    var json = window.aihttp.snapshot({ format: 'json', force: true });
    var box = json.actions.filter(function (action) { return action.tag === 'input' && action.type === 'checkbox'; })[0];
    return { ms: performance.now() - t, id: box ? box.id : null, labels: json.actions.map(function (action) { return action.id + ':' + action.tag + ':' + action.label; }) };
  });
  if (!snap.id) throw new Error('no checkbox in snapshot: ' + JSON.stringify(snap.labels));

  const dispatchOnly = await page.evaluate(async function (id) {
    var t = performance.now();
    var result = await window.aihttp.act(id, { checked: true }, { settle: false, snapshot: false, diff: false });
    return { ms: performance.now() - t, status: result.status, checked: document.querySelectorAll('#checkboxes input')[0].checked };
  }, snap.id);

  const settled = await page.evaluate(async function (id) {
    var t = performance.now();
    var result = await window.aihttp.act(id, { checked: false }, { quiet: 120, minWait: 60, timeout: 20000, snapshot: false, diff: false });
    return {
      ms: performance.now() - t,
      status: result.status,
      engineMs: result.latencyMs,
      mutations: result.meta && result.meta.mutations,
      network: window.aihttp.status().network
    };
  }, snap.id);

  const capped = await page.evaluate(async function (id) {
    var t = performance.now();
    var result = await window.aihttp.act(id, { checked: true }, { quiet: 120, minWait: 60, timeout: 1500, snapshot: false, diff: false });
    return { ms: performance.now() - t, status: result.status, engineMs: result.latencyMs, network: window.aihttp.status().network };
  }, snap.id);

  const mutations = await page.evaluate(function () {
    return new Promise(function (resolve) {
      var count = 0;
      var observer = new MutationObserver(function (list) { count += list.length; });
      observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      setTimeout(function () { observer.disconnect(); resolve(count); }, 1000);
    });
  });

  console.log(JSON.stringify({ loadMs: loadMs, snapshotInPageMs: Math.round(snap.ms * 100) / 100, dispatchOnly: dispatchOnly, settled: settled, capped: capped, mutationsIn1s: mutations }, null, 2));
  await browser.close();
})().catch(function (err) { console.error(err); process.exit(1); });
