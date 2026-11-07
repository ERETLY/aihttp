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

  const timed = await page.evaluate(function (cap) {
    var t0 = performance.now();
    var result = window.ahttp.snapshot({ format: 'json', maxActions: cap, force: true });
    return { result: result, inPageMs: performance.now() - t0 };
  }, maxActions);
  const json = timed.result;
  const wallMs = Date.now() - started;

  const text = await page.evaluate(function (cap) {
    return window.ahttp.snapshot({ format: 'text', maxActions: cap, force: true });
  }, maxActions).catch(function () { return ''; });

  let rawHtml = '';
  try { rawHtml = await page.content(); } catch (e) { rawHtml = ''; }

  let oracleData = { items: [] };
  let oracleError = null;
  try {
    oracleData = await page.evaluate(oracle);
  } catch (e) {
    oracleError = String((e && e.message) || e);
  }

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
