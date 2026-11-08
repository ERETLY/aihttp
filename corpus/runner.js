#!/usr/bin/env node
'use strict';

// Regression corpus for ahttp. Every case is a local HTML fixture plus a list of
// snapshot/action steps. No network access: jsdom only, no resources loader.
//
// Usage:
//   node corpus/runner.js                 run every case, write bench/results.json
//   node corpus/runner.js --no-write      run without touching bench/results.json
//   node corpus/runner.js --filter=login  run cases whose id contains "login"
//   node corpus/runner.js --out=bench/results.after.json

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { countTokens } = require('gpt-tokenizer');

const ROOT = path.join(__dirname, '..');
// AHTTP_ENGINE lets the same corpus run against an older engine for a
// before/after report. It is not used by npm test.
const ENGINE_PATH = process.env.AHTTP_ENGINE
  ? path.resolve(process.env.AHTTP_ENGINE)
  : path.join(ROOT, 'aihttp.js');
const ENGINE = fs.readFileSync(ENGINE_PATH, 'utf8');
const CASES_DIR = path.join(__dirname, 'cases');
const DEFAULT_RESULTS = path.join(ROOT, 'bench', 'results.json');
const SNAPSHOT_OPTIONS = { maxActions: 60, maxText: 900 };
const ACT_OPTIONS = { quiet: 0, minWait: 0, timeout: 250 };

function readCase(file) {
  const full = path.join(CASES_DIR, file);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    throw new Error('corpus: cannot read ' + file + ': ' + (err && err.message ? err.message : err));
  }
  if (!parsed.id) throw new Error('corpus: ' + file + ' has no id');
  if (!parsed.html) throw new Error('corpus: ' + parsed.id + ' has no html');
  if (!Array.isArray(parsed.steps) || !parsed.steps.length) throw new Error('corpus: ' + parsed.id + ' has no steps');
  return parsed;
}

function loadCases(filter) {
  const files = fs.readdirSync(CASES_DIR).filter(function (name) { return /\.json$/.test(name); }).sort();
  const cases = files.map(readCase);
  const seen = new Set();
  for (const item of cases) {
    if (seen.has(item.id)) throw new Error('corpus: duplicate id ' + item.id);
    seen.add(item.id);
  }
  if (!filter) return cases;
  return cases.filter(function (item) { return item.id.indexOf(filter) >= 0; });
}

function loadWindow(testCase) {
  const html = fs.readFileSync(path.join(__dirname, testCase.html), 'utf8');
  const url = testCase.url || 'https://corpus.test/' + testCase.id;
  const dom = new JSDOM(html, {
    url: url,
    runScripts: 'dangerously',
    pretendToBeVisual: false,
    resources: undefined
  });
  dom.window.eval(ENGINE);
  return { dom: dom, window: dom.window, document: dom.window.document, ahttp: dom.window.ahttp };
}

function statusOf(result) {
  if (!result) return 'error';
  if (result.status) return result.status;
  if (result.requiresConfirmation) return 'requires_confirmation';
  if (result.ok) return 'ok';
  if (result.error === 'unknown_action' || result.error === 'detached_action') return 'not_found';
  if (result.error === 'ambiguous') return 'ambiguous';
  return 'error';
}

function containsEvery(haystack, needles) {
  const text = String(haystack == null ? '' : haystack).toLowerCase();
  return needles.every(function (needle) { return text.indexOf(String(needle).toLowerCase()) >= 0; });
}

function labelsOf(list) {
  return (list || []).map(function (item) { return item && item.label ? String(item.label) : ''; }).join('\n');
}

function check(name, pass, detail) {
  return { name: name, pass: !!pass, detail: detail == null ? null : String(detail) };
}

function pageText(window, selector) {
  const node = window.document.querySelector(selector);
  return node ? String(node.textContent || '') : null;
}

function effectChecks(effect, result, window) {
  const match = [];
  const diff = [];
  if (!effect) return { match: match, diff: diff };
  if (effect.status != null) {
    const actual = statusOf(result);
    match.push(check('status=' + effect.status, actual === effect.status, actual));
  }
  if (effect.error != null) {
    match.push(check('error=' + effect.error, result && result.error === effect.error, result && result.error));
  }
  if (effect.candidates != null) {
    const count = result && Array.isArray(result.candidates) ? result.candidates.length : 0;
    match.push(check('candidates>=' + effect.candidates, count >= effect.candidates, count));
  }
  if (effect.requiresConfirmation != null) {
    match.push(check('requiresConfirmation', !!result.requiresConfirmation === !!effect.requiresConfirmation, result.requiresConfirmation));
  }
  if (effect.noMutation != null) {
    const mutations = result && result.meta ? result.meta.mutations : null;
    match.push(check('noMutation', (mutations || 0) === 0, mutations));
  }
  if (effect.textAdded) {
    diff.push(check('textAdded', containsEvery((result.diff && result.diff.textAdded || []).join('\n'), effect.textAdded), (result.diff && result.diff.textAdded || []).join(' | ')));
  }
  if (effect.textRemoved) {
    diff.push(check('textRemoved', containsEvery((result.diff && result.diff.textRemoved || []).join('\n'), effect.textRemoved), (result.diff && result.diff.textRemoved || []).join(' | ')));
  }
  if (effect.added) {
    diff.push(check('added', containsEvery(labelsOf(result.diff && result.diff.added), effect.added), labelsOf(result.diff && result.diff.added)));
  }
  if (effect.removed) {
    diff.push(check('removed', containsEvery(labelsOf(result.diff && result.diff.removed), effect.removed), labelsOf(result.diff && result.diff.removed)));
  }
  if (effect.diffContains) {
    diff.push(check('diffContains', containsEvery(result.diff && result.diff.text || '', effect.diffContains), result.diff && result.diff.text));
  }
  if (effect.urlChanged != null) {
    const changed = !!(result.diff && result.diff.url);
    diff.push(check('urlChanged', changed === !!effect.urlChanged, changed));
  }
  if (effect.empty != null) {
    const empty = !!(result.diff && result.diff.empty);
    diff.push(check('empty', empty === !!effect.empty, empty));
  }
  if (effect.snapshotContains) {
    diff.push(check('snapshotContains', containsEvery(result.snapshot || '', effect.snapshotContains), effect.snapshotContains.join(' | ')));
  }
  if (effect.pageText) {
    const actual = pageText(window, effect.pageText.selector);
    const ok = effect.pageText.equals != null
      ? actual === effect.pageText.equals
      : containsEvery(actual || '', effect.pageText.includes || []);
    diff.push(check('pageText ' + effect.pageText.selector, ok, actual));
  }
  return { match: match, diff: diff };
}

function snapshotChecks(step, text, json) {
  const match = [];
  const diff = [];
  const ids = (json.actions || []).map(function (action) { return action.id; });
  if (step.expectIds) {
    match.push(check('ids', JSON.stringify(ids) === JSON.stringify(step.expectIds), JSON.stringify(ids)));
  }
  if (step.expectNotIds) {
    const leaked = step.expectNotIds.filter(function (id) { return ids.indexOf(id) >= 0; });
    match.push(check('notIds', leaked.length === 0, leaked.join(',')));
  }
  if (step.expectText) {
    diff.push(check('text', containsEvery(text, step.expectText), step.expectText.join(' | ')));
  }
  if (step.expectNotText) {
    const found = step.expectNotText.filter(function (needle) { return text.toLowerCase().indexOf(String(needle).toLowerCase()) >= 0; });
    diff.push(check('notText', found.length === 0, found.join(',')));
  }
  if (step.expectTextOrder) {
    let from = -1;
    let ok = true;
    for (const needle of step.expectTextOrder) {
      const at = text.toLowerCase().indexOf(String(needle).toLowerCase(), from + 1);
      if (at < 0) { ok = false; break; }
      from = at;
    }
    diff.push(check('textOrder', ok, step.expectTextOrder.join(' -> ')));
  }
  if (step.expectSanitized != null) {
    const actual = json.meta ? json.meta.sanitized : null;
    match.push(check('sanitized=' + step.expectSanitized, actual === step.expectSanitized, actual));
  }
  if (step.expectDiff && step.expectDiff.contains) {
    diff.push(check('snapshotContains', containsEvery(text, step.expectDiff.contains), step.expectDiff.contains.join(' | ')));
  }
  return { match: match, diff: diff };
}

function wire(window) {
  if (typeof window.__corpusWire === 'function') window.__corpusWire();
}

async function runCase(testCase) {
  const loaded = loadWindow(testCase);
  const ahttp = loaded.ahttp;
  const window = loaded.window;
  const steps = [];
  const failures = [];
  let tokens = 0;
  let matchOk = true;
  let diffOk = true;

  for (let index = 0; index < testCase.steps.length; index++) {
    const step = testCase.steps[index];
    const label = (index + 1) + ':' + step.action;
    try {
      if (step.action === 'snapshot') {
        const options = Object.assign({}, SNAPSHOT_OPTIONS, step.options || {});
        const json = ahttp.snapshot(Object.assign({ format: 'json' }, options));
        const text = ahttp.snapshot(Object.assign({ format: 'text' }, options));
        tokens += countTokens(text);
        const checks = snapshotChecks(step, text, json);
        const stepMatch = checks.match.every(function (item) { return item.pass; });
        const stepDiff = checks.diff.every(function (item) { return item.pass; });
        matchOk = matchOk && stepMatch;
        diffOk = diffOk && stepDiff;
        steps.push({ step: label, match_ok: stepMatch, diff_ok: stepDiff, checks: checks.match.concat(checks.diff) });
        continue;
      }
      if (step.action === 'rerender') {
        const target = window.document.querySelector(step.selector);
        if (!target) throw new Error('selector not found: ' + step.selector);
        target.innerHTML = step.html;
        wire(window);
        steps.push({ step: label, match_ok: true, diff_ok: true, checks: [] });
        continue;
      }
      if (step.action === 'click' || step.action === 'fill') {
        if (!step.expectedId) throw new Error('expectedId is required for ' + step.action);
        const payload = step.action === 'fill'
          ? { value: String(step.value == null ? '' : step.value) }
          : (step.payload || null);
        const actOptions = Object.assign({}, ACT_OPTIONS, step.options || {});
        if (step.actExpect) actOptions.expect = step.actExpect;
        const result = await ahttp.act(step.expectedId, payload, actOptions);
        const expectedStatus = step.expectStatus || (step.action === 'fill' ? 'ok' : 'ok');
        const actualStatus = statusOf(result);
        const status = check('status=' + expectedStatus, actualStatus === expectedStatus, actualStatus);
        const checks = effectChecks(step.expectEffect, result, window);
        const stepMatch = status.pass && checks.match.every(function (item) { return item.pass; });
        const stepDiff = checks.diff.every(function (item) { return item.pass; });
        matchOk = matchOk && stepMatch;
        diffOk = diffOk && stepDiff;
        steps.push({
          step: label,
          match_ok: stepMatch,
          diff_ok: stepDiff,
          status: actualStatus,
          result_status: result.status || null,
          checks: [status].concat(checks.match, checks.diff)
        });
        continue;
      }
      throw new Error('unknown action: ' + step.action);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      failures.push(label + ': ' + message);
      matchOk = false;
      diffOk = false;
      steps.push({ step: label, match_ok: false, diff_ok: false, checks: [check('no throw', false, message)] });
    }
  }

  const pending = !!testCase.pending;
  return {
    id: testCase.id,
    html: testCase.html,
    notes: testCase.notes || '',
    pending: pending,
    pending_reason: pending ? String(testCase.pending) : null,
    status: pending ? 'PENDING' : (matchOk && diffOk ? 'PASS' : 'FAIL'),
    match_ok: matchOk,
    diff_ok: diffOk,
    tokens: tokens,
    failures: failures,
    steps: steps
  };
}

async function runCorpus(options) {
  const opts = options || {};
  const cases = loadCases(opts.filter);
  if (!cases.length) throw new Error('corpus: no cases' + (opts.filter ? ' matching ' + opts.filter : ''));
  const results = [];
  for (const testCase of cases) results.push(await runCase(testCase));

  const totals = {
    cases: results.length,
    passed: results.filter(function (item) { return item.status === 'PASS'; }).length,
    failed: results.filter(function (item) { return item.status === 'FAIL'; }).length,
    pending: results.filter(function (item) { return item.status === 'PENDING'; }).length,
    match_ok: results.filter(function (item) { return item.match_ok; }).length,
    diff_ok: results.filter(function (item) { return item.diff_ok; }).length,
    tokens: results.reduce(function (sum, item) { return sum + item.tokens; }, 0)
  };
  const result = {
    engine: require(path.join(ROOT, 'package.json')).version,
    engine_file: ENGINE_PATH === path.join(ROOT, 'aihttp.js') ? 'aihttp.js' : 'override',
    totals: totals,
    cases: results
  };

  if (opts.print !== false) printTable(result);
  if (opts.write !== false) {
    const out = opts.out ? path.resolve(opts.out) : DEFAULT_RESULTS;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n', 'utf8');
    if (opts.print !== false) process.stdout.write('wrote ' + out + '\n');
  }
  return result;
}

function pad(value, width) {
  const str = String(value);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

function printTable(result) {
  const widths = { id: 44, match: 5, diff: 4, tokens: 6 };
  process.stdout.write('\n' + pad('case', widths.id) + ' ' + pad('match', widths.match) + ' ' + pad('diff', widths.diff) + ' ' + pad('tokens', widths.tokens) + ' status\n');
  process.stdout.write('-'.repeat(widths.id + widths.match + widths.diff + widths.tokens + 20) + '\n');
  for (const item of result.cases) {
    process.stdout.write(
      pad(item.id, widths.id) + ' ' +
      pad(item.match_ok ? 'ok' : 'FAIL', widths.match) + ' ' +
      pad(item.diff_ok ? 'ok' : 'FAIL', widths.diff) + ' ' +
      pad(item.tokens, widths.tokens) + ' ' +
      item.status + (item.pending_reason ? ' (' + item.pending_reason + ')' : '') + '\n'
    );
  }
  process.stdout.write('-'.repeat(widths.id + widths.match + widths.diff + widths.tokens + 20) + '\n');
  process.stdout.write(
    'total: ' + result.totals.cases + ' cases, ' +
    result.totals.passed + ' pass, ' +
    result.totals.failed + ' fail, ' +
    result.totals.pending + ' pending | ' +
    'match ' + result.totals.match_ok + '/' + result.totals.cases + ', ' +
    'diff ' + result.totals.diff_ok + '/' + result.totals.cases + ', ' +
    'tokens ' + result.totals.tokens + '\n\n'
  );
}

module.exports = {
  runCorpus: runCorpus,
  loadCases: loadCases,
  statusOf: statusOf,
  printTable: printTable,
  DEFAULT_RESULTS: DEFAULT_RESULTS
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const filterArg = args.filter(function (arg) { return arg.indexOf('--filter=') === 0; })[0];
  const outArg = args.filter(function (arg) { return arg.indexOf('--out=') === 0; })[0];
  runCorpus({
    filter: filterArg ? filterArg.slice('--filter='.length) : null,
    write: args.indexOf('--no-write') < 0,
    out: outArg ? outArg.slice('--out='.length) : null
  }).then(function (result) {
    process.exit(result.totals.failed ? 1 : 0);
  }, function (err) {
    process.stderr.write('corpus failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
    process.exit(1);
  });
}
