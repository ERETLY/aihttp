'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const USERSCRIPT = fs.readFileSync(path.join(__dirname, '..', 'self', 'aihttp.user.js'), 'utf8');

function mount(html) {
  const dom = new JSDOM(html, { url: 'https://self-flow.test/', runScripts: 'outside-only' });
  dom.window.eval(USERSCRIPT);
  const host = dom.window.document.querySelector('[data-aihttp-self]');
  assert.ok(host, 'panel host is attached');
  host.shadowRoot.querySelector('button.toggle').click();
  return { window: dom.window, document: dom.window.document, shadow: host.shadowRoot };
}

function button(shadow, label) {
  return Array.from(shadow.querySelectorAll('button')).find((node) => node.textContent === label);
}

function actionId(shadow, label) {
  const line = shadow.querySelector('textarea').value.split('\n')
    .find((item) => item.indexOf('button "' + label + '"') >= 0);
  const match = line && line.match(/^(a\d+)/);
  assert.ok(match, 'action id for ' + label + ' is in the snapshot');
  return match[1];
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('the self-use panel runs an action and shows the result', async () => {
  const page = mount('<!doctype html><html><head><title>Self flow</title></head><body>' +
    '<main><button id="go">Run</button><p id="out">idle</p></main></body></html>');
  const id = actionId(page.shadow, 'Run');
  page.document.getElementById('go').addEventListener('click', function () {
    page.document.getElementById('out').textContent = 'clicked';
  });

  page.shadow.querySelector('input').value = id;
  button(page.shadow, 'Act').click();
  await wait(150);
  assert.equal(page.document.getElementById('out').textContent, 'clicked');
  assert.match(page.shadow.querySelector('.status').textContent, /ok/i);
});

test('the self-use panel asks for confirmation before a guarded action', async () => {
  const page = mount('<!doctype html><html><head><title>Self guard</title></head><body>' +
    '<main><button id="del" data-aihttp-confirm="delete">Delete account</button>' +
    '<p id="out">idle</p></main></body></html>');
  const id = actionId(page.shadow, 'Delete account');
  page.document.getElementById('del').addEventListener('click', function () {
    page.document.getElementById('out').textContent = 'deleted';
  });

  page.shadow.querySelector('input').value = id;
  button(page.shadow, 'Act').click();
  await wait(120);
  assert.equal(page.document.getElementById('out').textContent, 'idle');
  const confirm = button(page.shadow, 'Confirm');
  assert.notEqual(confirm.style.display, 'none');

  confirm.click();
  await wait(150);
  assert.equal(page.document.getElementById('out').textContent, 'deleted');
});
