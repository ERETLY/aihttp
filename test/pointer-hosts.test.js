'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadHtml } = require('../benchmark/lib/harness');

function snapshot(html) {
  const { aihttp } = loadHtml('<!doctype html><html><head><title>Pointer hosts</title><style>' +
    'shreddit-card{cursor:pointer}.card{cursor:pointer}my-tab{cursor:pointer}.term{cursor:pointer}' +
    '</style></head><body><main>' + html + '</main></body></html>', 'https://pointer.test/');
  return aihttp.snapshot({ format: 'json', maxActions: 40 }).actions;
}

test('a pointer host does not swallow the button in its light DOM', () => {
  const actions = snapshot('<shreddit-card><button aria-label="Open user actions">Menu</button></shreddit-card>');
  const labels = actions.map(function (a) { return a.label; });
  assert.ok(labels.indexOf('Open user actions') >= 0, 'button is registered: ' + JSON.stringify(labels));
  assert.equal(actions.filter(function (a) { return a.tag === 'shreddit-card'; }).length, 0, 'the host is not a second action');
});

test('an inherited pointer cursor does not make a text span a second control', () => {
  const actions = snapshot('<div class="card" data-aihttp-intent="Open card"><span class="title">Title</span></div>');
  const labels = Array.from(actions, function (a) { return a.label; });
  assert.equal(labels.join('|'), 'Open card');
});

test('an explicit role on a custom element keeps the host as the control', () => {
  const actions = snapshot('<my-tab role="tab" aria-selected="false"><button>Implementation</button></my-tab>');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].tag, 'my-tab');
  assert.equal(actions[0].role, 'tab');
});

test('a text-level element with cursor:pointer is not a control', () => {
  const actions = snapshot('<var class="term">table</var><dfn class="term">table</dfn><code class="term">createCaption()</code>');
  assert.equal(actions.length, 0, 'no text terms as actions: ' + JSON.stringify(actions.map(function (a) { return a.label; })));
});

test('an explicit role keeps a text element actionable', () => {
  const actions = snapshot('<var class="term" role="button" tabindex="0">table</var>');
  assert.equal(actions.length, 1, JSON.stringify(actions));
  assert.equal(actions[0].role, 'button');
});

test('identical in-page links are one action, different fragments stay separate', () => {
  const actions = snapshot('<a href="#same">Same</a><a href="#same">Same</a><a href="#other">Same</a>');
  const hrefs = actions.map(function (a) { return String(a.href || ''); });
  assert.equal(actions.length, 2, 'two destinations: ' + JSON.stringify(hrefs));
  assert.ok(hrefs.some(function (h) { return /#same$/.test(h); }), 'same fragment kept: ' + JSON.stringify(hrefs));
  assert.ok(hrefs.some(function (h) { return /#other$/.test(h); }), 'other fragment kept: ' + JSON.stringify(hrefs));
});

test('identical server links stay separate for row-specific handlers', () => {
  const actions = snapshot('<a href="/delete">Delete</a><a href="/delete">Delete</a>');
  assert.equal(actions.length, 2, 'server destinations are not folded: ' + JSON.stringify(actions.map(function (a) { return a.href; })));
});

test('the same destination with different labels stays separate', () => {
  const actions = snapshot('<a href="/x">One</a><a href="/x">Two</a>');
  assert.equal(actions.length, 2, JSON.stringify(actions.map(function (a) { return a.label; })));
});

test('a role=group pointer container does not swallow its links', () => {
  const actions = snapshot('<my-tab role="group" aria-label="1 / 3"><a href="/channel">Channel</a></my-tab>');
  const labels = actions.map(function (a) { return a.label; });
  assert.ok(labels.indexOf('Channel') >= 0, 'the link is registered: ' + JSON.stringify(labels));
  assert.equal(actions.filter(function (a) { return a.tag === 'my-tab'; }).length, 0, 'the group container is not an action');
});
