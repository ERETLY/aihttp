'use strict';

// One page, one measurement. This is the cheap half of the real-world
// harness: a full snapshot, an independent oracle of reachable controls, and
// the recall/phantom verdict. Scenarios, scrolling and determinism stay in
// benchmark/realworld/run.js; the coverage matrix only needs to answer "did
// the engine see what a user can reach, and did it invent anything".

const tokenizer = require('gpt-tokenizer');
const { oracle, matchActions } = require('../realworld/oracle');

function tokens(text) {
  try { return tokenizer.encode(String(text || '')).length; } catch (e) { return null; }
}

function compactItem(item) {
  return {
    tag: item.tag,
    role: item.role,
    name: String(item.name || '').slice(0, 120),
    href: item.href,
    reasons: item.reasons,
    html: String(item.html || '').slice(0, 200)
  };
}

function compactAction(action) {
  return {
    id: action.id,
    tag: action.tag,
    role: action.role,
    label: String(action.label || '').slice(0, 120),
    href: action.href
  };
}

// `page` is a Playwright page with the engine already installed. The caller
// owns navigation and blocking checks; this function only measures.
async function measurePage(page, options) {
  const opts = options || {};
  const maxActions = opts.maxActions == null ? 5000 : opts.maxActions;
  const started = Date.now();

  // Snapshot and oracle run in one synchronous evaluate. A virtualized list
  // (Mastodon's feed) keeps off-screen items mounted with inline opacity:0 and
  // re-renders between two evaluates; measuring them a second apart lets the
  // oracle see items the snapshot was right to skip.
  let timed = { result: { actions: [] }, inPageMs: 0 };
  let oracleData = { items: [] };
  let oracleError = null;
  try {
    const both = await page.evaluate(function (input) {
      var cap = input.cap;
      var oracleSrc = input.oracleSrc;
      var t0 = performance.now();
      var result = window.ahttp.snapshot({ format: 'json', maxActions: cap, force: true });
      var inPageMs = performance.now() - t0;
      var items = { items: [] };
      var error = null;
      try { items = eval('(' + oracleSrc + ')')(); }
      catch (e) { error = String((e && e.message) || e); }
      return { result: result, inPageMs: inPageMs, items: items, oracleError: error };
    }, { cap: maxActions, oracleSrc: oracle.toString() });
    timed = { result: both.result, inPageMs: both.inPageMs };
    oracleData = both.items;
    oracleError = both.oracleError;
  } catch (e) {
    oracleError = String((e && e.message) || e);
  }
  const json = timed.result;
  const wallMs = Date.now() - started;

  const text = await page.evaluate(function (cap) {
    return window.ahttp.snapshot({ format: 'text', maxActions: cap, force: true });
  }, maxActions).catch(function () { return ''; });

  let rawHtml = '';
  try { rawHtml = await page.content(); } catch (e) { rawHtml = ''; }

  const match = matchActions(json.actions || [], oracleData.items || []);
  const visible = match.visible;
  const matched = match.matchedVisible;
  const textJoined = (json.text || []).join(' ') + ' ' + (json.actions || []).map(function (action) {
    return action.label || '';
  }).join(' ');
  const consentModal = !!(json.modal &&
    /cookie|consent|privacy|accept all|reject all|manage preferences|personal data|legitimate interest/i.test(textJoined));

  return {
    url: json.url || page.url(),
    title: json.title || '',
    actions: (json.actions || []).length,
    textChars: String(text || '').length,
    textTokens: tokens(text),
    rawChars: rawHtml.length,
    rawTokens: tokens(rawHtml),
    scanMs: json.meta && json.meta.ms != null ? json.meta.ms : null,
    wallMs: wallMs,
    inPageMs: Math.round(timed.inPageMs * 10) / 10,
    truncated: !!(json.meta && json.meta.truncated),
    omitted: json.meta && json.meta.omitted != null ? json.meta.omitted : 0,
    frames: json.meta && json.meta.frames != null ? json.meta.frames : null,
    modal: !!json.modal,
    modalFallback: !!(json.meta && json.meta.modalFallback),
    modalSkipped: (json.meta && json.meta.modalSkipped) || null,
    consentModal: consentModal,
    recall: {
      visible: visible,
      matched: matched,
      ratio: visible ? matched / visible : null,
      missedTotal: match.missed.length,
      missed: match.missed.slice(0, 12).map(compactItem),
      phantomTotal: match.phantom.length,
      phantom: match.phantom.slice(0, 12).map(compactAction),
      hiddenMatchedTotal: match.hiddenMatched.length,
      oracleError: oracleError
    }
  };
}

module.exports = { measurePage, compactItem, compactAction };
