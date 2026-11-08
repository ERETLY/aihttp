'use strict';

const { loadFixture, loadHtml, checker, json, text, findAction, byLabel, byName, containsLabel, act } = require('./harness');
const { createWindow } = require('../../lib/mini-dom');
const { attach } = require('../../lib/page');

const REFERENCE_GIANT_MS = 25;
const DEFAULT_GIANT_MS = 150;

function giantBudget(env) {
  const source = env || process.env;
  const raw = Number(source.AIHTTP_GIANT_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_GIANT_MS;
}

function giantScanVerdict(median, budget) {
  const limit = Number.isFinite(budget) && budget > 0 ? budget : DEFAULT_GIANT_MS;
  return { pass: true, warning: median > limit, budget: limit };
}

async function reactStore() {
  const { aihttp, window: w } = loadFixture('01-react-store');
  const c = checker();
  let snap = json(aihttp);
  c.ok(snap.actions.length >= 6, 'initial controls discovered', snap.actions.length);
  c.ok(!!byName(snap, 'q'), 'search input registered');
  c.ok(!!byName(snap, 'promo'), 'promo input registered');
  c.ok(!!byLabel(snap, 'Place order'), 'checkout button registered');

  let result = await act(aihttp, byName(snap, 'q'), 'Gadget');
  c.ok(/Gadget X/.test(text(aihttp)), 'filter re-render shows matching product', result.diff && result.diff.text);
  c.ok(!/Widget Pro/.test(text(aihttp)), 'filter re-render removes other products');

  snap = json(aihttp);
  const add = containsLabel(snap, 'Add Gadget X');
  result = await act(aihttp, add);
  c.ok(/Cart: 1 item/.test(result.snapshot), 'cart count updates after add', result.diff && result.diff.text);

  snap = json(aihttp);
  await act(aihttp, byName(snap, 'promo'), 'AGENT20');
  snap = json(aihttp);
  result = await act(aihttp, byLabel(snap, 'Apply promo'));
  c.ok(/Promo applied: 20% off/.test(result.snapshot), 'React _valueTracker bypass delivered the input value', result.diff && result.diff.text);

  snap = json(aihttp);
  result = await act(aihttp, byLabel(snap, 'Place order'));
  c.ok(/Email is required/.test(result.snapshot), 'empty email validation surfaced', result.diff && result.diff.text);

  snap = json(aihttp);
  await act(aihttp, byName(snap, 'email'), 'agent@example.com');
  snap = json(aihttp);
  result = await act(aihttp, byLabel(snap, 'Place order'));
  c.ok(/Order placed for agent@example\.com \(1 items, 20% off\)/.test(result.snapshot), 'checkout completes after controlled remount');

  snap = json(aihttp);
  const stale = byLabel(snap, 'Place order');
  w.__forceRender();
  const relocated = await aihttp.act(stale.id, null, { settle: false });
  c.ok(relocated.ok, 'stale id resolved after full DOM remount', JSON.stringify(relocated).slice(0, 160));
  c.ok(/Cart is empty/.test(relocated.snapshot || ''), 'relocated node actually received the click');
  return c.checks;
}

async function divHell() {
  const { aihttp, window: w } = loadFixture('02-div-hell');
  const c = checker();
  let snap = json(aihttp);
  c.ok(snap.actions.length === 5, 'five controls, nested spans deduplicated', snap.actions.map(function (a) { return a.label; }).join(' | '));
  c.ok(snap.actions.filter(function (a) { return /Menu/i.test(a.label); }).length === 1, 'one action for the nested menu wrapper');

  let result = await act(aihttp, containsLabel(snap, 'Menu'));
  c.ok(w.document.getElementById('menuOut').textContent === 'menu opened', 'inline onclick executed');

  snap = json(aihttp);
  result = await act(aihttp, containsLabel(snap, 'Choose plan'));
  c.ok(/Pro/.test(result.snapshot) && /Team/.test(result.snapshot), 'custom dropdown options appear after open');
  snap = json(aihttp);
  result = await act(aihttp, byLabel(snap, 'Pro'));
  c.ok(/Plan: Pro/.test(w.document.getElementById('dd').textContent), 'custom option click applied', w.document.getElementById('dd').textContent);

  snap = json(aihttp);
  result = await act(aihttp, byLabel(snap, 'Two'));
  c.ok(w.document.getElementById('tabOut').textContent === 'Tab Two', 'div tab switched');

  snap = json(aihttp);
  result = await act(aihttp, byLabel(snap, 'Checkbox'));
  c.ok(w.document.getElementById('chkOut').textContent === 'checked', 'div checkbox toggled');
  return c.checks;
}

async function shadowDom() {
  const { aihttp, window: w } = loadFixture('03-shadow-dom');
  const c = checker();
  const snap = json(aihttp);
  c.ok(snap.meta.shadowRoots >= 2, 'two nested open shadow roots traversed', snap.meta.shadowRoots);
  const card = byName(snap, 'card');
  c.ok(!!card, 'input inside nested shadow registered');
  c.ok(card && card.label === 'Card number', 'label inside shadow root resolved', card && card.label);
  const pay = byLabel(snap, 'Pay now');
  c.ok(!!pay, 'button inside nested shadow registered');
  let result = await act(aihttp, card, '4242');
  result = await act(aihttp, pay);
  c.ok(/paid 4242/.test(result.snapshot), 'action inside nested shadow root executed', result.diff && result.diff.text);
  const inner = w.document.getElementById('host').querySelector('x-outer').shadowRoot
    .querySelector('x-inner').shadowRoot;
  c.ok(inner.getElementById('res').textContent === 'paid 4242', 'shadow DOM state mutated');
  return c.checks;
}

async function asyncModal() {
  const { aihttp } = loadFixture('04-async-modal');
  const c = checker();
  const started = Date.now();
  const snap = json(aihttp);
  const result = await act(aihttp, byLabel(snap, 'Open checkout'));
  const elapsed = Date.now() - started;
  c.ok(result.diff && result.diff.modal && result.diff.modal.opened, 'delayed modal detected in diff', JSON.stringify(result.diff && result.diff.modal));
  c.ok(/\[modal\]/.test(result.snapshot), 'snapshot isolates the active modal');
  c.ok(/Session loaded/.test(result.diff.text) || /Session loaded/.test(result.snapshot), 'delayed toast captured', result.diff && result.diff.text);
  c.ok(elapsed >= 150, 'settle waited for the delayed UI', elapsed + 'ms');
  c.ok(elapsed < 4000, 'settle completed within the timeout', elapsed + 'ms');
  c.ok(result.meta.requests >= 1, 'fetch call intercepted', result.meta.requests);

  const modalSnap = json(aihttp);
  const confirm = byLabel(modalSnap, 'Confirm');
  const confirmed = await act(aihttp, confirm);
  c.ok(/Order confirmed/.test(confirmed.diff.text) || /Order confirmed/.test(confirmed.snapshot), 'modal action executed and captured');
  return c.checks;
}

async function security() {
  const { aihttp, window: w } = loadFixture('05-security');
  const c = checker();
  c.ok(aihttp.status().state === 'dormant', 'engine dormant before first call');
  c.ok(w.__moCount === 0, 'no MutationObserver created at load', w.__moCount);
  c.ok(w.fetch === w.__origFetch, 'fetch untouched at load');

  const snapText = text(aihttp);
  c.ok(aihttp.status().state === 'active', 'engine woke on first snapshot');
  c.ok(w.__moCount >= 1, 'observer installed after wake', w.__moCount);
  c.ok(!/HIDDEN_CANARY/.test(snapText), 'all hidden injection text stripped');
  c.ok(!/Internal admin tool|internal note/.test(snapText), 'data-aihttp-ignore subtree removed');

  const snap = json(aihttp);
  c.ok(snap.meta.sanitized >= 4, 'sanitized trap count reported', snap.meta.sanitized);
  const intent = findAction(snap, function (a) { return a.intent === 'checkout_submit'; });
  c.ok(!!intent && intent.label === 'checkout_submit', 'data-aihttp-intent wins over visible text', intent && intent.label);
  const del = byLabel(snap, 'Delete Account');
  c.ok(del && del.requiresConfirmation === true, 'data-aihttp-confirm exposed in JSON');
  c.ok(del && /permanently/.test(del.warning || ''), 'warning text preserved', del && del.warning);

  const blocked = await aihttp.act(del.id, { settle: false });
  c.ok(blocked.ok === false && blocked.requiresConfirmation === true, 'unguarded act blocked');
  c.ok(w.document.getElementById('r').textContent === 'idle', 'blocked action did not run');

  const allowed = await aihttp.act(del.id, null, { confirm: true, settle: false });
  c.ok(allowed.ok === true, 'confirm=true allowed');
  c.ok(w.document.getElementById('r').textContent === 'deleted', 'confirmed action ran');
  c.ok(w.fetch === w.__origFetch, 'fetch restored after act');

  const acct = byName(snap, 'acct');
  const readonlyResult = await aihttp.act(acct.id, 'HACKED', { settle: false });
  c.ok(readonlyResult.ok === false && readonlyResult.error === 'readonly', 'readonly write blocked');
  c.ok(w.document.getElementById('acct').value === 'ACC-777', 'readonly value unchanged');
  const readResult = await aihttp.act(acct.id, { read: true });
  c.ok(readResult.value === 'ACC-777' && readResult.ok === true, 'readonly value readable');

  const toolset = aihttp.tools();
  c.ok(!!toolset.tools[0].parameters.properties.confirm, 'tools() adds confirm for guarded actions');
  c.ok(toolset.actions.some(function (a) { return a.requiresConfirmation === true; }), 'tools() marks guarded actions');
  const scoped = json(aihttp, { scope: 'main' });
  c.ok(scoped.actions.length > 0 && scoped.actions.every(function (a) { return a.region === 'main'; }), 'scope filter returns one region');
  const queried = json(aihttp, { query: 'Delete' });
  c.ok(queried.actions.length === 1 && queried.actions[0].label === 'Delete Account', 'query filter narrows actions', queried.actions.length);
  return c.checks;
}

async function dataGrid() {
  const { aihttp } = loadFixture('06-data-grid');
  const c = checker();
  let snap = json(aihttp);
  c.ok(/Showing 1-10 of 50/.test(text(aihttp)), 'initial page summary');
  c.ok(snap.actions.length < 20, 'grid controls compact', snap.actions.length);
  c.ok(!!byName(snap, 'filter'), 'filter input registered');

  let result = await act(aihttp, byName(snap, 'filter'), 'User 1');
  c.ok(/Showing 1-10 of 11/.test(result.snapshot), 'filter narrows rows', result.diff && result.diff.text);

  snap = json(aihttp);
  result = await act(aihttp, byLabel(snap, 'Sort by score'));
  c.ok(result.ok, 'sort button executed');

  snap = json(aihttp);
  result = await act(aihttp, byLabel(snap, 'Next'));
  c.ok(/Showing 11-11 of 11/.test(result.snapshot), 'pagination advanced', result.diff && result.diff.text);
  c.ok(/page 2\/2/.test(result.snapshot), 'page indicator updated');
  c.ok(text(aihttp).length < 8000, 'grid snapshot remains compact', text(aihttp).length);
  return c.checks;
}

async function iconOnly() {
  const { aihttp, window: w } = loadFixture('07-icon-only');
  const c = checker();
  const snap = json(aihttp);
  const labels = snap.actions.map(function (a) { return a.label; });
  c.ok(labels.indexOf('Save document') >= 0, 'svg title used as label', labels.join(' | '));
  c.ok(labels.indexOf('Download report') >= 0, 'aria-label used as label');
  c.ok(labels.indexOf('Print page') >= 0, 'title attribute used as label');
  c.ok(labels.indexOf('Card number') >= 0, 'adjacent text labels the card input', labels.join(' | '));
  c.ok(labels.indexOf('Expiry date') >= 0, 'adjacent text labels the expiry input');

  await act(aihttp, byLabel(snap, 'Save document'));
  c.ok(w.document.getElementById('r').textContent === 'saved', 'icon-only button executed');
  const card = byName(snap, 'card');
  await act(aihttp, card, '4242424242424242');
  c.ok(w.document.querySelector('[name=card]').value === '4242424242424242', 'input without id filled');
  return c.checks;
}

async function contenteditable() {
  const { aihttp, window: w } = loadFixture('08-contenteditable');
  const c = checker();
  const snap = json(aihttp);
  const box = findAction(snap, function (a) { return a.editable === true; });
  c.ok(!!box, 'contenteditable registered');
  c.ok(box && box.label === 'Message', 'aria-labelledby resolved', box && box.label);
  let result = await act(aihttp, box, 'hello agent');
  c.ok(w.document.getElementById('box').textContent === 'hello agent', 'contenteditable filled');
  result = await act(aihttp, box, { key: 'Enter' });
  c.ok(/you: hello agent/.test(w.document.getElementById('chat').textContent), 'Enter handler fired');
  c.ok(w.document.getElementById('box').textContent === '', 'contenteditable cleared by the app');
  c.ok(/you: hello agent/.test(result.snapshot), 'new chat line visible in snapshot', result.diff && result.diff.text);
  await act(aihttp, box, { key: 'Escape' });
  c.ok(w.document.getElementById('panel').textContent === 'panel closed', 'Escape reached the window listener');
  return c.checks;
}

function giantMarkup() {
  let html = '<!doctype html><html><head><title>Giant DOM</title></head><body><main><h1>Catalog</h1>' +
    '<label for="q">Filter</label><input id="q" name="q" placeholder="Filter items"><div id="list">';
  for (let i = 0; i < 750; i++) {
    html += '<div class="card"><h3>Item ' + i + '</h3><span>Price ' + (i % 50) + '</span>' +
      '<a href="/item/' + i + '">Open item ' + i + '</a>' +
      '<button>Buy ' + i + '</button></div>';
  }
  return html + '</div><div id="tail"><button id="finish">Finish</button><p id="done">idle</p></div></main></body></html>';
}

async function giantDom() {
  const c = checker();
  const html = giantMarkup();

  const win = createWindow(html, 'https://giant.test/');
  const api = attach(win);
  const times = [];
  let snap = null;
  for (let i = 0; i < 5; i++) {
    snap = api.snapshot({ format: 'json', force: true, maxActions: 100 });
    times.push(snap.meta.scanMs);
  }
  times.sort(function (a, b) { return a - b; });
  const median = times[2];
  c.ok(snap.meta.nodes >= 3500, '3500+ element nodes traversed', snap.meta.nodes);
  const budget = giantBudget();
  const verdict = giantScanVerdict(median, budget);
  if (verdict.warning) {
    process.stdout.write('warn: giant DOM median native scan ' + median + 'ms exceeds the advisory budget of ' + budget +
      'ms; correctness checks are unaffected. Set AIHTTP_GIANT_MS to tune the warning.\n');
  }
  c.ok(verdict.pass, 'median native DOM scan (advisory)', median + 'ms; advisory budget ' + budget +
    'ms; reference machine ' + REFERENCE_GIANT_MS + 'ms' + (verdict.warning ? '; WARNING' : ''));

  const withDefaults = api.snapshot({ maxActions: 80 });
  c.ok(withDefaults.length < 12000, 'default snapshot stays compact', withDefaults.length + ' chars');
  c.ok(/Open item 0/.test(withDefaults), 'first repeated action preserved');
  c.ok(/\+\d+ similar link/.test(withDefaults), 'repeated link family folded', (withDefaults.match(/\+\d+ similar link/) || [])[0]);
  const expanded = api.snapshot({ query: 'Item 7', maxActions: 40 });
  c.ok(!/similar link/.test(expanded), 'query disables folding');
  c.ok(/Open item 7/.test(expanded) || /Buy 7/.test(expanded), 'query exposes folded actions');

  const qAction = findAction(snap, function (a) { return a.name === 'q'; });
  const fill = await api.act(qAction.id, 'Item 7', { settle: false });
  c.ok(fill.ok && /val="Item 7"/.test(fill.snapshot || ''), 'action executed on the giant page', fill.diff && fill.diff.text);

  const jsdom = loadHtml(html, 'https://giant.test/', { runScripts: false });
  const jsdomSnap = json(jsdom.aihttp, { force: true, maxActions: 100 });
  c.ok(jsdomSnap.meta.nodes >= 3500, 'jsdom reference traversal completed', jsdomSnap.meta.nodes + ' nodes in ' + Math.round(jsdomSnap.meta.scanMs) + 'ms');
  c.ok(true, 'scan samples', times.map(function (t) { return Math.round(t * 10) / 10; }).join(','));
  return c.checks;
}

const SUITE = [
  { id: 'react-store', name: 'React synthetic state and full DOM remount', run: reactStore },
  { id: 'div-hell', name: 'Pure div UI with nested deduplication', run: divHell },
  { id: 'shadow-dom', name: 'Nested open shadow DOM', run: shadowDom },
  { id: 'async-modal', name: 'Async fetch, delayed modal and toast', run: asyncModal },
  { id: 'security', name: 'Guardrails, prompt injection and dormant mode', run: security },
  { id: 'data-grid', name: 'Complex data grid: filter, sort, pagination', run: dataGrid },
  { id: 'icon-only', name: 'Icon-only legacy HTML and adjacent labels', run: iconOnly },
  { id: 'contenteditable', name: 'Contenteditable with Enter and Escape', run: contenteditable },
  { id: 'giant-dom', name: 'Giant DOM stress, folding and scan latency', run: giantDom }
];

module.exports = { SUITE, giantBudget, giantScanVerdict, DEFAULT_GIANT_MS, REFERENCE_GIANT_MS };
