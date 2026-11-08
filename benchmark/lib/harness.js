'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const ENGINE_SRC = fs.readFileSync(path.join(ROOT, 'aihttp.js'), 'utf8');
const FIXTURES = path.join(__dirname, '..', 'fixtures');

function loadFixture(name) {
  if (!/\.html$/.test(name)) name += '.html';
  const file = path.join(FIXTURES, name);
  const html = fs.readFileSync(file, 'utf8');
  const slug = name.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return loadHtml(html, 'https://' + slug + '.test/');
}

function loadHtml(html, url, options) {
  const opts = options || {};
  const dom = new JSDOM(html, {
    url: url || 'https://fixture.test/',
    runScripts: opts.runScripts === false ? 'outside-only' : 'dangerously',
    pretendToBeVisual: false,
    resources: undefined
  });
  const window = dom.window;
  window.eval(ENGINE_SRC);
  return {
    dom: dom,
    window: window,
    document: window.document,
    aihttp: window.aihttp,
    html: html,
    url: url || 'https://fixture.test/'
  };
}

function checker() {
  const checks = [];
  function ok(condition, name, actual) {
    checks.push({
      name: name,
      pass: !!condition,
      actual: actual === undefined ? undefined : String(actual).slice(0, 240)
    });
    return !!condition;
  }
  return { ok: ok, checks: checks };
}

function json(aihttp, options) {
  const opts = Object.assign({ format: 'json' }, options || {});
  return aihttp.snapshot(opts);
}

function text(aihttp, options) {
  return aihttp.snapshot(Object.assign({ format: 'text' }, options || {}));
}

function findAction(snapshot, predicate) {
  return (snapshot.actions || []).find(predicate) || null;
}

function byLabel(snapshot, label) {
  return findAction(snapshot, function (a) { return a.label === label; });
}

function byName(snapshot, name) {
  return findAction(snapshot, function (a) { return a.name === name; });
}

function containsLabel(snapshot, fragment) {
  return findAction(snapshot, function (a) {
    return String(a.label || '').toLowerCase().indexOf(String(fragment).toLowerCase()) >= 0;
  });
}

async function act(aihttp, action, payload, options) {
  if (!action) throw new Error('action not found');
  return aihttp.act(action.id, payload, options);
}

module.exports = {
  ROOT,
  ENGINE_SRC,
  FIXTURES,
  loadFixture,
  loadHtml,
  checker,
  json,
  text,
  findAction,
  byLabel,
  byName,
  containsLabel,
  act
};
