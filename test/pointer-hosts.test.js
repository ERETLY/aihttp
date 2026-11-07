'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadHtml } = require('../benchmark/lib/harness');

function snapshot(html) {
  const { ahttp } = loadHtml('<!doctype html><html><head><title>Pointer hosts</title><style>' +
    'shreddit-card{cursor:pointer}.card{cursor:pointer}my-tab{cursor:pointer}' +
    '</style></head><body><main>' + html + '</main></body></html>', 'https://pointer.test/');
  return ahttp.snapshot({ format: 'json', maxActions: 40 }).actions;
}

test('a pointer host does not swallow the button in its light DOM', () => {
  const actions = snapshot('<shreddit-card><button aria-label="Open user actions">Menu</button></shreddit-card>');
  const labels = actions.map(function (a) { return a.label; });
  assert.ok(labels.indexOf('Open user actions') >= 0, 'button is registered: ' + JSON.stringify(labels));
  assert.equal(actions.filter(function (a) { return a.tag === 'shreddit-card'; }).length, 0, 'the host is not a second action');
});

test('an inherited pointer cursor does not make a text span a second control', () => {
  const actions = snapshot('<div class="card" data-ahttp-intent="Open card"><span class="title">Title</span></div>');
  const labels = Array.from(actions, function (a) { return a.label; });
  assert.equal(labels.join('|'), 'Open card');
});

test('an explicit role on a custom element keeps the host as the control', () => {
  const actions = snapshot('<my-tab role="tab" aria-selected="false"><button>Implementation</button></my-tab>');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tag, 'my-tab');
  assert.equal(actions[0].role, 'tab');
});
