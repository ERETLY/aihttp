'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openHtml } = require('../lib/page');

const URL = 'https://trace.test/';

const FORM = '<!doctype html><body><main>' +
  '<label for="email">Email</label>' +
  '<input id="email" name="email" data-aihttp-intent="email">' +
  '<label for="pw">Password</label>' +
  '<input id="pw" name="pw" type="password" data-aihttp-intent="password">' +
  '<button data-aihttp-intent="subscribe">Subscribe</button>' +
  '</main></body>';

function load(html) {
  return openHtml(html || FORM, URL);
}

test('a trace records portable fingerprints instead of scan ids', async () => {
  const page = load();
  const snapshot = page.api.snapshot({ format: 'json' });
  const email = snapshot.actions.find((action) => action.intent === 'email');
  const subscribe = snapshot.actions.find((action) => action.intent === 'subscribe');

  await page.api.act(email.id, { value: 'agent@example.com' }, { settle: false, snapshot: false });
  await page.api.act(subscribe.id, {}, { settle: false, snapshot: false });

  const trace = page.api.trace();
  assert.equal(trace.steps.length, 2);
  assert.equal(trace.steps[0].action.intent, 'email');
  assert.equal(trace.steps[0].payload.value, 'agent@example.com');
  assert.equal(trace.steps[1].action.intent, 'subscribe');
  assert.equal(trace.steps[1].kind, 'click');
  assert.equal(typeof trace.steps[0].action.order, 'number');
  assert.equal(trace.steps[0].action.node, undefined, 'the DOM node is never serialized');

  const json = JSON.parse(JSON.stringify(trace));
  assert.equal(json.steps.length, 2, 'the trace survives JSON round-trip');
  page.api.clearTrace();
  assert.equal(page.api.trace().steps.length, 0);
});

test('a replay resolves a renamed label by intent', async () => {
  const first = load();
  const snapshot = first.api.snapshot({ format: 'json' });
  const email = snapshot.actions.find((action) => action.intent === 'email');
  await first.api.act(email.id, { value: 'agent@example.com' }, { settle: false, snapshot: false });
  const trace = first.api.trace();

  // The visible label changes between deploys; the author intent does not.
  const second = load(FORM.replace('Subscribe', 'Sign up'));
  const dry = await second.api.replay(trace, { dryRun: true });
  assert.equal(dry.ok, true);
  assert.equal(dry.steps[0].status, 'would_run');
  assert.ok(dry.steps[0].signals.indexOf('intent') >= 0);

  const run = await second.api.replay(trace);
  assert.equal(run.ok, true);
  assert.equal(run.completed, 1);
  const replayed = second.api.snapshot({ format: 'json' }).actions.find((action) => action.intent === 'email');
  assert.equal(replayed.value, 'agent@example.com');
});

test('a replay reports ambiguity instead of clicking the wrong twin', async () => {
  const first = load('<!doctype html><body><main><button data-aihttp-intent="buy">Buy</button></main></body>');
  const buy = first.api.snapshot({ format: 'json' }).actions.find((action) => action.intent === 'buy');
  await first.api.act(buy.id, {}, { settle: false, snapshot: false });
  const trace = first.api.trace();

  const twins = load('<!doctype html><body><main>' +
    '<button>Buy</button><button>Buy</button></main></body>');
  const dry = await twins.api.replay(trace, { dryRun: true });
  assert.equal(dry.ok, false);
  assert.equal(dry.steps[0].status, 'ambiguous');
  assert.ok(dry.steps[0].candidates.length >= 2);
});

test('a password value is redacted and needs an explicit replay value', async () => {
  const page = load();
  const pw = page.api.snapshot({ format: 'json' }).actions.find((action) => action.intent === 'password');
  await page.api.act(pw.id, { value: 'hunter2-secret' }, { settle: false, snapshot: false });

  const trace = page.api.trace();
  assert.equal(trace.steps[0].payload.redacted, true);
  assert.equal(trace.steps[0].payload.value, undefined);
  assert.equal(trace.steps[0].payload.valueLength, 14);
  assert.equal(JSON.stringify(trace).indexOf('hunter2-secret'), -1, 'the secret never enters the trace');

  const reloaded = load();
  const missing = await reloaded.api.replay(trace, { dryRun: true });
  assert.equal(missing.ok, false);
  assert.equal(missing.steps[0].status, 'needs_value');

  const supplied = await reloaded.api.replay(trace, { values: ['hunter2-secret'] });
  assert.equal(supplied.ok, true);
  assert.equal(reloaded.api.element(supplied.steps[0].id).value, 'hunter2-secret');
});

test('a replay flags URL drift without losing the match', async () => {
  const first = load();
  const button = first.api.snapshot({ format: 'json' }).actions.find((action) => action.intent === 'subscribe');
  await first.api.act(button.id, {}, { settle: false, snapshot: false });
  const trace = first.api.trace();

  const other = openHtml(FORM, 'https://trace.test/checkout');
  const strict = await other.api.replay(trace, { dryRun: true, requireSameUrl: true });
  assert.equal(strict.ok, false);
  assert.equal(strict.steps[0].status, 'url_mismatch');

  const relaxed = await other.api.replay(trace, { dryRun: true });
  assert.equal(relaxed.ok, true);
  assert.equal(relaxed.steps[0].urlDrift, true);
});
