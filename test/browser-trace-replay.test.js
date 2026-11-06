'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromiumAvailable, browserGate } = require('../tools/browser-env');

const gate = browserGate(chromiumAvailable(), process.env.AHTTP_REQUIRE_BROWSER === '1');
const { openBrowserPage, closeBrowser } = require('../lib/browser');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

const START = '<!doctype html><body><main><h1>Start</h1>' +
  '<label for="email">Email</label>' +
  '<input id="email" name="email" data-ahttp-intent="email">' +
  '<a href="/review" data-ahttp-intent="continue">Continue</a></main></body>';

const REVIEW = '<!doctype html><body><main><h1>Review</h1>' +
  '<label for="note">Note</label>' +
  '<input id="note" name="note" data-ahttp-intent="note">' +
  '<button data-ahttp-intent="submit" onclick="document.getElementById(\'out\').textContent=\'submitted\'">Submit</button>' +
  '<p id="out">idle</p></main></body>';

test('a trace replays across a navigation and a reload', { skip: gate.skip, timeout: 90000 }, async (t) => {
  if (gate.fail) assert.fail(gate.reason);
  const hits = [];
  const local = await listen((req, res) => {
    hits.push(req.url);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url === '/review' ? REVIEW : START);
  });
  try {
    const page = await openBrowserPage(local.url, { timeout: 15000, allowPrivate: true });
    t.after(async () => { await page.close(); });

    let snapshot = await page.api.snapshot({ format: 'json', maxActions: 40 });
    const email = snapshot.actions.find((action) => action.intent === 'email');
    const next = snapshot.actions.find((action) => action.intent === 'continue');
    assert.ok(email && next);

    await page.api.act(email.id, { value: 'agent@example.com' }, { settle: true, snapshot: false });
    await page.api.act(next.id, {}, { settle: true, snapshot: false });
    await page.page.waitForTimeout(300);
    assert.equal(page.page.url(), local.url + 'review');

    snapshot = await page.api.snapshot({ format: 'json', maxActions: 40 });
    const note = snapshot.actions.find((action) => action.intent === 'note');
    const submit = snapshot.actions.find((action) => action.intent === 'submit');
    await page.api.act(note.id, { value: 'looks good' }, { settle: true, snapshot: false });
    await page.api.act(submit.id, {}, { settle: true, snapshot: false });
    assert.equal(await page.page.evaluate(() => document.getElementById('out').textContent), 'submitted');

    const trace = await page.api.trace();
    assert.equal(trace.steps.length, 4);
    assert.equal(trace.steps[0].action.intent, 'email');
    assert.equal(trace.steps[2].action.intent, 'note');
    assert.equal(trace.steps[3].action.intent, 'submit');

    // Start from a clean load of the first page. The replay has to navigate,
    // rebuild the engine in the new document and keep resolving by intent.
    await page.page.goto(local.url, { waitUntil: 'domcontentloaded' });
    await page.page.waitForTimeout(200);
    const dry = await page.api.replay(trace, { dryRun: true });
    assert.equal(dry.ok, false, 'dry run stops at the first step after the page boundary');
    assert.equal(dry.steps[0].status, 'would_run');

    const replay = await page.api.replay(trace);
    assert.equal(replay.ok, true, JSON.stringify(replay.steps));
    assert.equal(replay.completed, 4);
    assert.equal(page.page.url(), local.url + 'review');
    assert.equal(await page.page.evaluate(() => document.getElementById('out').textContent), 'submitted');
    assert.equal(hits.filter((url) => url === '/review').length, 2, 'one recorded visit, one replayed visit');
  } finally {
    await close(local.server);
    await closeBrowser();
  }
});
