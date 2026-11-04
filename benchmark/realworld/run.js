'use strict';

// Real-world harness. It is intentionally outside `npm test` and CI: it needs
// the public network and sites change without notice. Engine: ahttp.js is
// injected unmodified into every page.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const tokenizer = require('gpt-tokenizer');
const { oracle, matchActions } = require('./oracle');

const ROOT = path.join(__dirname, '..', '..');
const ENGINE = fs.readFileSync(path.join(ROOT, 'ahttp.js'), 'utf8');
const CONFIG = require('./sites.json');
const pkg = require(path.join(ROOT, 'package.json'));
const OUT = path.join(__dirname, arg('out', 'results.json'));

const NODE_VERSION = process.version;
let PLAYWRIGHT_VERSION = 'unknown';
try { PLAYWRIGHT_VERSION = require('playwright/package.json').version; } catch (e) {}
let GIT_SHA = 'unknown';
try { GIT_SHA = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (e) {}

function tokens(text) {
  try { return tokenizer.encode(String(text || '')).length; } catch (e) { return null; }
}

function arg(name, fallback) {
  const hit = process.argv.find(function (value) { return value.indexOf('--' + name + '=') === 0; });
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

function nowMs() { return Date.now(); }

function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function snapshot(page, options) {
  return page.evaluate(function (opts) {
    return window.ahttp.snapshot(opts);
  }, options || { format: 'json' });
}

// Wall time through page.evaluate includes CDP transport and serialization of
// the whole snapshot. inPageMs is the engine call only. Keeping both apart is
// how a harness artifact is told from a slow scan.
async function snapshotTimed(page, options) {
  const started = nowMs();
  const data = await page.evaluate(function (opts) {
    var t0 = performance.now();
    var result = window.ahttp.snapshot(opts);
    return { result: result, inPageMs: performance.now() - t0 };
  }, options || { format: 'json' });
  return { result: data.result, inPageMs: data.inPageMs, wallMs: nowMs() - started };
}

async function snapshotJson(page, options) {
  return snapshot(page, Object.assign({ format: 'json' }, options || {}));
}

function actionKeys(actions) {
  return actions.map(function (action) {
    return action.id + '|' + action.tag + '|' + action.role + '|' + (action.label || '') + '|' + (action.href || '');
  });
}

async function collectMetrics(page, json, text) {
  let rawHtml = '';
  try { rawHtml = await page.content(); } catch (e) { rawHtml = ''; }
  let aria = '';
  try { aria = await page.locator('body').ariaSnapshot(); } catch (e) { aria = ''; }
  return {
    actions: json.actions.length,
    actionCap: json.meta && json.meta.omitted ? json.meta.omitted : 0,
    scanMs: json.meta && json.meta.ms != null ? json.meta.ms : null,
    sanitized: json.meta && json.meta.sanitized != null ? json.meta.sanitized : null,
    modal: !!(json.meta && json.meta.modal),
    textChars: text.length,
    textTokens: tokens(text),
    rawChars: rawHtml.length,
    rawTokens: tokens(rawHtml),
    ariaChars: aria.length,
    ariaTokens: tokens(aria),
    compressionVsRaw: rawHtml.length ? text.length / rawHtml.length : null,
    compressionVsAria: aria.length ? text.length / aria.length : null
  };
}

async function visibilityCheck(page) {
  const data = await page.evaluate(oracle);
  return data;
}

function compactItem(item) {
  return {
    tag: item.tag,
    role: item.role,
    name: item.name.slice(0, 120),
    href: item.href,
    reasons: item.reasons,
    html: item.html.slice(0, 200)
  };
}

async function runPageChecks(page, out) {
  const full = await snapshotJson(page, { maxActions: 5000, force: true });
  const text = await snapshot(page, { format: 'text', maxActions: 5000, force: true });
  const defaultTimed = await snapshotTimed(page, { format: 'json', force: true });
  const defaultTextTimed = await snapshotTimed(page, { format: 'text', force: true });
  const defaultJson = defaultTimed.result;
  const defaultText = defaultTextTimed.result;
  out.metrics = await collectMetrics(page, defaultJson, defaultText);
  out.metrics.timing = {
    jsonWallMs: defaultTimed.wallMs,
    jsonInPageMs: defaultTimed.inPageMs,
    textWallMs: defaultTextTimed.wallMs,
    textInPageMs: defaultTextTimed.inPageMs
  };
  out.metrics.fullActions = full.actions.length;

  let oracleData = { items: [] };
  try { oracleData = await visibilityCheck(page); } catch (e) { out.checks.oracleError = String(e.message || e); }
  const match = matchActions(full.actions, oracleData.items || []);
  out.checks.recall = {
    visible: match.visible,
    matched: match.matchedVisible,
    ratio: match.recall,
    missed: match.missed.slice(0, 15).map(compactItem),
    missedTotal: match.missed.length,
    phantom: match.phantom.slice(0, 15).map(function (action) {
      return { id: action.id, tag: action.tag, role: action.role, label: action.label, href: action.href };
    }),
    phantomTotal: match.phantom.length,
    hiddenMatched: match.hiddenMatched.slice(0, 10).map(function (pair) {
      return { action: pair.action.id, name: pair.item.name, reasons: pair.item.reasons };
    })
  };

  const base = { text: text, keys: actionKeys(full.actions), count: full.actions.length };
  const scrolls = [];
  for (const step of [{ at: 'top', y: 0 }, { at: 'middle', y: null }, { at: 'bottom', y: 999999 }]) {
    const y = step.y == null ? await page.evaluate(function () { return Math.floor((document.documentElement.scrollHeight - window.innerHeight) / 2); }) : step.y;
    await page.evaluate(function (value) { window.scrollTo(0, value); }, y);
    await page.waitForTimeout(450);
    const snap = await snapshotJson(page, { maxActions: 5000, force: true });
    scrolls.push({ at: step.at, y: await page.evaluate(function () { return window.scrollY; }), keys: actionKeys(snap.actions), count: snap.actions.length });
  }
  await page.evaluate(function () { window.scrollTo(0, 0); });
  out.checks.scroll = {
    counts: scrolls.map(function (item) { return { at: item.at, y: item.y, actions: item.count }; }),
    missingAtMiddle: base.keys.filter(function (key) { return scrolls[1].keys.indexOf(key) < 0; }).slice(0, 20),
    missingAtBottom: base.keys.filter(function (key) { return scrolls[2].keys.indexOf(key) < 0; }).slice(0, 20),
    addedAtBottom: scrolls[2].keys.filter(function (key) { return base.keys.indexOf(key) < 0; }).slice(0, 20)
  };

  const first = await snapshotJson(page, { maxActions: 400, force: true });
  const firstText = await snapshot(page, { format: 'text', maxActions: 400, force: true });
  const second = await snapshotJson(page, { maxActions: 400, force: true });
  const secondText = await snapshot(page, { format: 'text', maxActions: 400, force: true });
  out.checks.determinism = {
    identicalText: firstText === secondText,
    identicalIds: actionKeys(first.actions).join('\n') === actionKeys(second.actions).join('\n'),
    firstActions: first.actions.length,
    secondActions: second.actions.length
  };
  out.snapshotText = text;
}

async function resolveBySelector(page, selector) {
  return page.evaluate(function (sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    function norm(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }
    var name = norm(el.getAttribute('aria-label'));
    if (!name && el.labels && el.labels.length) name = norm(Array.prototype.map.call(el.labels, function (l) { return l.innerText; }).join(' '));
    if (!name && el.placeholder) name = norm(el.placeholder);
    if (!name && el.tagName.toLowerCase() === 'input' && /submit|button/i.test(el.type || '')) name = norm(el.value);
    if (!name) name = norm(el.innerText || el.textContent).slice(0, 120);
    return { tag: el.tagName.toLowerCase(), type: (el.type || '').toLowerCase(), name: name };
  }, selector);
}

async function resolveTarget(page, json, target) {
  if (!target) return { id: null, action: null, error: 'no target' };
  if (target.raw) return { id: target.raw, action: null };
  let wanted = target;
  if (target.selector) {
    const found = await resolveBySelector(page, target.selector);
    if (!found) return { id: null, action: null, error: 'selector not found: ' + target.selector };
    wanted = { tag: found.tag, type: found.type || undefined, name: found.name };
  }
  const norm = function (value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase(); };
  const matches = json.actions.filter(function (action) {
    if (wanted.tag && action.tag !== wanted.tag) return false;
    if (wanted.type && String(action.type || '').toLowerCase() !== wanted.type) return false;
    if (wanted.role && action.role !== wanted.role) return false;
    if (wanted.hrefContains && String(action.href || '').indexOf(wanted.hrefContains) < 0) return false;
    if (wanted.name != null && norm(action.label) !== norm(wanted.name)) return false;
    if (wanted.nameContains && norm(action.label).indexOf(norm(wanted.nameContains)) < 0) return false;
    return true;
  });
  const index = target.index || 0;
  if (!matches[index]) {
    return {
      id: null,
      action: null,
      error: 'target not in last snapshot: ' + JSON.stringify(target),
      candidates: matches.slice(0, 5).map(function (action) { return { id: action.id, tag: action.tag, role: action.role, label: action.label }; })
    };
  }
  return { id: matches[index].id, action: matches[index] };
}

async function checkExpectations(page, result, expect, context) {
  const failures = [];
  const status = result && result.status ? result.status : (result && result.ok ? 'ok' : 'error');
  if (expect.status && status !== expect.status) failures.push('status ' + status + ' != ' + expect.status);
  if (expect.resultText) {
    const dump = JSON.stringify(result || {});
    for (const needle of expect.resultText) if (dump.indexOf(needle) < 0) failures.push('result missing ' + needle);
  }
  if (expect.urlContains && String(page.url()).indexOf(expect.urlContains) < 0) failures.push('url missing ' + expect.urlContains);
  if (expect.candidatesAtLeast) {
    const count = result && result.candidates ? result.candidates.length : 0;
    if (count < expect.candidatesAtLeast) failures.push('candidates ' + count + ' < ' + expect.candidatesAtLeast);
  }
  if (expect.dialog) {
    const hit = (context.dialogs || []).some(function (item) { return item.type === expect.dialog; });
    if (!hit) failures.push('dialog ' + expect.dialog + ' not observed');
  }
  if (expect.text || expect.dom || expect.count) {
    const verdict = await page.evaluate(function (rules) {
      var out = [];
      var body = document.body ? document.body.innerText : '';
      if (rules.text) {
        for (var i = 0; i < rules.text.length; i++) {
          if (body.indexOf(rules.text[i]) < 0) out.push('text missing: ' + rules.text[i]);
        }
      }
      if (rules.dom) {
        for (var j = 0; j < rules.dom.length; j++) {
          var rule = rules.dom[j];
          var nodes = document.querySelectorAll(rule.selector);
          var el = rule.index != null ? nodes[rule.index] : nodes[0];
          if (!el) { out.push('dom missing: ' + rule.selector + '[' + (rule.index || 0) + ']'); continue; }
          var actual;
          if (rule.prop === 'exists') actual = true;
          else if (rule.prop === 'text') actual = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          else actual = el[rule.prop];
          if (actual !== rule.equals) out.push('dom ' + rule.selector + ' ' + rule.prop + '=' + JSON.stringify(actual) + ' != ' + JSON.stringify(rule.equals));
        }
      }
      if (rules.count) {
        for (var k = 0; k < rules.count.length; k++) {
          var item = rules.count[k];
          var list = Array.prototype.slice.call(document.querySelectorAll(item.selector));
          if (item.contains) list = list.filter(function (node) { return ((node.innerText || node.value || '') + '').indexOf(item.contains) >= 0; });
          if (list.length !== item.equals) out.push('count ' + item.selector + (item.contains ? '~' + item.contains : '') + '=' + list.length + ' != ' + item.equals);
        }
      }
      return out;
    }, { text: expect.text, dom: expect.dom, count: expect.count });
    for (const item of verdict) failures.push(item);
  }
  return failures;
}

async function runScenarios(page, site, out) {
  const defaults = CONFIG.defaults || {};
  let last = null;
  let lastCount = null;
  for (const scenario of site.scenarios || []) {
    const entry = { name: scenario.name, ok: false, steps: [], latencyMs: 0, status: null };
    const started = nowMs();
    try {
      for (const step of scenario.steps) {
        const stepStarted = nowMs();
        if (step.op === 'snapshot') {
          const timed = await snapshotTimed(page, { format: 'json', maxActions: 500, force: true });
          const json = timed.result;
          last = json;
          const failures = await checkExpectations(page, { status: 'ok' }, step.expect || {}, out);
          if (step.expect && step.expect.actionDelta) {
            const count = json.actions.length;
            if (lastCount != null && count <= lastCount) failures.push('no new actions after scroll: ' + lastCount + ' -> ' + count);
          }
          lastCount = json.actions.length;
          entry.steps.push({
            op: 'snapshot', ok: !failures.length, failures, actions: json.actions.length,
            wallMs: timed.wallMs, inPageMs: timed.inPageMs,
            metaMs: json.meta && json.meta.ms != null ? json.meta.ms : null,
            ms: nowMs() - stepStarted
          });
          if (failures.length) break;
        } else if (step.op === 'scroll') {
          await page.evaluate(function (to) {
            var y = to === 'bottom' ? document.documentElement.scrollHeight : to === 'middle' ? Math.floor(document.documentElement.scrollHeight / 2) : 0;
            window.scrollTo(0, y);
          }, step.to || 'bottom');
          await page.waitForTimeout(600);
          entry.steps.push({ op: 'scroll', ok: true, y: await page.evaluate(function () { return window.scrollY; }) });
        } else if (step.op === 'wait') {
          await page.waitForTimeout(step.ms || 500);
          entry.steps.push({ op: 'wait', ok: true, ms: step.ms || 500 });
        } else if (step.op === 'goto') {
          await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForTimeout(1200);
          last = null;
          lastCount = null;
          entry.steps.push({ op: 'goto', ok: true, url: page.url() });
        } else if (step.op === 'act') {
          let json = last;
          if (!step.stale || !last) {
            json = await snapshotJson(page, { maxActions: 500, force: true });
            last = json;
          }
          const resolved = await resolveTarget(page, json, step.target);
          if (!resolved.id) {
            entry.steps.push({ op: 'act', ok: false, failures: [resolved.error], candidates: resolved.candidates || [], ms: nowMs() - stepStarted });
            break;
          }
          const payload = Object.assign({}, step.payload || {});
          const timeout = payload.timeout || defaults.timeoutMs || 20000;
          delete payload.timeout;
          const dialogsBefore = (out.dialogs || []).length;
          const actStarted = nowMs();
          let result;
          let navigationLost = null;
          try {
            result = await page.evaluate(function (args) {
              return window.ahttp.act(args.id, args.payload, { timeout: args.timeout, quiet: 120, minWait: 60 });
            }, { id: resolved.id, payload: payload, timeout: timeout });
          } catch (e) {
            const message = String(e.message || e);
            if (/Execution context was destroyed|navigat/i.test(message)) {
              // A form submit or a link navigation tears down the JS context
              // before act can resolve. The action itself did run; the
              // embedding (page.evaluate) loses the reply. Wait and verify.
              navigationLost = message.split('\n')[0];
              await page.waitForTimeout(1500);
              await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(function () {});
              result = { status: 'ok', navigationLost: true };
            } else {
              entry.steps.push({
                op: 'act', id: resolved.id, ok: false, failures: ['act threw: ' + message], ms: nowMs() - actStarted
              });
              break;
            }
          }
          const evaluatedMs = nowMs() - actStarted;
          await page.waitForTimeout(350);
          await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(function () {});
          const context = { dialogs: (out.dialogs || []).slice(dialogsBefore) };
          const failures = await checkExpectations(page, result, step.expect || {}, context);
          entry.status = result && result.status ? result.status : null;
          entry.steps.push({
            op: 'act',
            id: resolved.id,
            action: resolved.action,
            status: entry.status,
            ok: !failures.length,
            failures: failures,
            actMs: evaluatedMs,
            engineMs: result && result.latencyMs != null ? result.latencyMs : null,
            navigationLost: navigationLost,
            latencyMs: nowMs() - actStarted,
            ms: nowMs() - stepStarted
          });
          lastCount = json.actions.length;
          if (failures.length) break;
        } else {
          entry.steps.push({ op: step.op, ok: false, failures: ['unknown op'] });
          break;
        }
      }
    } catch (e) {
      entry.error = String(e && e.stack ? e.stack : (e && e.message ? e.message : e));
    }
    entry.latencyMs = nowMs() - started;
    entry.ok = !entry.error && entry.steps.length > 0 && entry.steps.every(function (step) { return step.ok; });
    if (!entry.status) {
      const withStatus = entry.steps.filter(function (step) { return step.status; });
      if (withStatus.length) entry.status = withStatus[withStatus.length - 1].status;
    }
    out.scenarios.push(entry);
  }
}

function isBlocked(status, title, bodyStart) {
  if (status === 403 || status === 429 || status === 451 || status === 503) return 'http ' + status;
  const probe = (title + ' ' + bodyStart).toLowerCase();
  if (/captcha|are you a robot|access denied|just a moment|checking your browser/.test(probe)) return 'bot wall';
  return null;
}

// A full-viewport consent overlay is not something the harness may dismiss.
// The selector is declared per site so this cannot silently swallow a page
// that merely has a small cookie bar (which stays testable).
async function consentWall(page, site) {
  if (!site.blockedSelector) return null;
  // Sourcepoint injects the container before the iframe and the iframe before
  // it has a box. Poll for a full-viewport overlay instead of assuming the
  // first DOM match is ready.
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const wall = await page.evaluate(function (selector) {
      const el = document.querySelector(selector);
      if (!el) return null;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return null;
      const rect = el.getBoundingClientRect();
      return {
        area: rect.width * rect.height,
        viewport: window.innerWidth * window.innerHeight,
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    }, site.blockedSelector).catch(function () { return null; });
    if (wall && wall.viewport && wall.area >= wall.viewport * 0.5) return site.blockedReason || 'consent wall';
    await new Promise(function (resolve) { setTimeout(resolve, 250); });
  }
  return null;
}

async function runSite(browser, site) {
  const defaults = CONFIG.defaults || {};
  const result = {
    id: site.id,
    url: site.url,
    status: 'ok',
    httpStatus: null,
    title: null,
    blocked: null,
    error: null,
    metrics: null,
    checks: {},
    scenarios: [],
    dialogs: []
  };
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: defaults.userAgent,
    locale: 'en-US'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('dialog', function (dialog) {
    result.dialogs.push({ type: dialog.type(), message: dialog.message() });
    dialog.dismiss().catch(function () {});
  });
  try {
    await page.addInitScript({ content: ENGINE });
    const loadStarted = nowMs();
    let response = null;
    try {
      response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      result.status = 'error';
      result.error = 'goto: ' + String(e.message || e);
      return result;
    }
    result.httpStatus = response ? response.status() : null;
    await page.waitForTimeout(defaults.pauseMs || 1200);
    result.title = await page.title().catch(function () { return ''; });
    result.loadMs = nowMs() - loadStarted;
    const bodyStart = await page.evaluate(function () { return (document.body ? document.body.innerText : '').slice(0, 800); }).catch(function () { return ''; });
    const blocked = isBlocked(result.httpStatus, result.title || '', bodyStart) || await consentWall(page, site);
    if (blocked) {
      result.status = 'blocked';
      result.blocked = blocked;
      return result;
    }
    try {
      await runPageChecks(page, result);
    } catch (e) {
      result.checks.error = String(e.message || e);
    }
    if (result.checks && result.snapshotText) delete result.snapshotText;
    await runScenarios(page, site, result);
    const failed = result.scenarios.filter(function (scenario) { return !scenario.ok; }).length;
    result.status = failed ? 'scenario_failures' : 'ok';
  } catch (e) {
    result.status = 'error';
    result.error = String(e.message || e);
  } finally {
    await context.close().catch(function () {});
  }
  return result;
}

async function main() {
  const only = arg('site', '');
  const wanted = only ? only.split(',').map(function (value) { return value.trim(); }).filter(Boolean) : null;
  const sites = CONFIG.sites.filter(function (site) { return !wanted || wanted.indexOf(site.id) >= 0; });
  if (!sites.length) {
    console.error('no sites matched --site=' + only);
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: true });
  let previous = [];
  try { previous = JSON.parse(fs.readFileSync(OUT, 'utf8')).sites || []; } catch (e) { previous = []; }
  const output = {
    generatedAt: new Date().toISOString(),
    engine: { version: pkg.version, sha: GIT_SHA },
    runtime: { node: NODE_VERSION, playwright: PLAYWRIGHT_VERSION, chromium: browser.version() },
    defaults: CONFIG.defaults,
    sites: []
  };
  try {
    for (const site of sites) {
      const started = nowMs();
      process.stdout.write('[' + site.id + '] ... ');
      const result = await runSite(browser, site);
      result.totalMs = nowMs() - started;
      output.sites.push(result);
      fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
      const recall = result.checks && result.checks.recall ? Math.round(result.checks.recall.ratio * 1000) / 10 : 'n/a';
      const actions = result.metrics ? result.metrics.actions : 'n/a';
      const scanMs = result.metrics && result.metrics.scanMs != null ? result.metrics.scanMs : 'n/a';
      console.log(result.status + ' actions=' + actions + ' recall=' + recall + '% scan=' + scanMs + 'ms scenarios=' +
        result.scenarios.filter(function (scenario) { return scenario.ok; }).length + '/' + result.scenarios.length);
      await sleep((CONFIG.defaults && CONFIG.defaults.pauseMs) || 1200);
    }
    const seen = new Set(output.sites.map(function (site) { return site.id; }));
    for (const site of previous) {
      if (!seen.has(site.id)) output.sites.push(site);
    }
    const order = CONFIG.sites.map(function (site) { return site.id; });
    output.sites.sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
    fs.writeFileSync(OUT, JSON.stringify(output, null, 2) + '\n');
  } finally {
    await browser.close().catch(function () {});
  }
  console.log('wrote ' + OUT);
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
