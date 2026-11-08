'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'aihttp.js'), 'utf8');
const OPTIONS = { quiet: 0, minWait: 0, timeout: 250 };

function load(html, url) {
  const dom = new JSDOM(html, { url: url || 'https://toggles.test/', runScripts: 'dangerously' });
  dom.window.eval(ENGINE);
  return dom.window;
}

test('a visually hidden checkbox with a visible label is a normal toggle', async () => {
  const window = load('<!doctype html><body><main>' +
    '<label><input type="checkbox" id="agree" style="position:absolute;opacity:0">' +
    '<span class="box"></span> I agree to the terms</label>' +
    '<button>Continue</button></main></body>');
  const document = window.document;
  const snapshot = window.aihttp.snapshot({ format: 'json' });
  assert.equal(snapshot.actions.length, 2);
  const toggle = snapshot.actions[0];
  assert.equal(toggle.role, 'checkbox');
  assert.equal(toggle.kind, 'toggle');
  assert.equal(toggle.label, 'I agree to the terms');
  assert.equal(toggle.checked, false);
  assert.match(window.aihttp.snapshot({ format: 'text' }),
    /a1 input\[checkbox\] "I agree to the terms" unchecked/);

  const result = await window.aihttp.act(toggle.id, { checked: true }, OPTIONS);
  assert.equal(result.status, 'ok');
  assert.equal(document.getElementById('agree').checked, true);
  assert.match(result.snapshot, /a1 input\[checkbox\] "I agree to the terms" checked/);
});

test('a clip-hidden switch named by label[for] is a normal toggle', async () => {
  const window = load('<!doctype html><body><main>' +
    '<input type="checkbox" id="notify" style="position:absolute;width:1px;height:1px;margin:-1px;' +
    'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%)">' +
    '<label for="notify">Email notifications</label></main></body>');
  const document = window.document;
  const snapshot = window.aihttp.snapshot({ format: 'json' });
  assert.equal(snapshot.actions.length, 1);
  assert.equal(snapshot.actions[0].label, 'Email notifications');
  const result = await window.aihttp.act('a1', { checked: true }, OPTIONS);
  assert.equal(result.status, 'ok');
  assert.equal(document.getElementById('notify').checked, true);
});

test('a soft-hidden checkbox with a hidden label stays out of the snapshot', () => {
  const window = load('<!doctype html><body><main>' +
    '<input type="checkbox" id="secret" style="position:absolute;opacity:0">' +
    '<label for="secret" style="font-size:0">I agree to the terms</label>' +
    '<button>Continue</button></main></body>');
  const snapshot = window.aihttp.snapshot({ format: 'json' });
  assert.equal(snapshot.actions.length, 1);
  assert.equal(snapshot.meta.sanitized, 1);
  assert.doesNotMatch(window.aihttp.snapshot({ format: 'text' }), /I agree to the terms/);
});

test('hard-hidden checkboxes stay hidden even with a visible label', () => {
  const window = load('<!doctype html><body><main>' +
    '<input type="checkbox" id="terms" style="display:none"><label for="terms">I accept the terms</label>' +
    '<button>Continue</button></main></body>');
  const snapshot = window.aihttp.snapshot({ format: 'json' });
  assert.equal(snapshot.actions.length, 1);
  assert.equal(snapshot.actions[0].tag, 'button');
});

test('the security fixture keeps its sanitized count and every canary', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'benchmark', 'fixtures', '05-security.html'), 'utf8');
  const window = load(html, 'https://security.test/');
  const json = window.aihttp.snapshot({ format: 'json' });
  const text = window.aihttp.snapshot({ format: 'text' });
  assert.equal(json.meta.sanitized, 4);
  assert.doesNotMatch(text, /HIDDEN_CANARY/);
  assert.match(text, /checkout_submit/);
});
