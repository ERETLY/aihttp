'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { openPage, openHtml } = require('../lib/page');

const FIXTURES = path.join(__dirname, '..', 'corpus', 'fixtures');

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: 'http://127.0.0.1:' + address.port });
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

const PAGE = '<!doctype html><html><head><title>Hidden</title>' +
  '<style>.ghost{opacity:0.0}.ghost-pct{opacity:0%}</style></head><body><main>' +
  '<button style="opacity:0">HIDE_ZERO</button>' +
  '<button style="opacity:0.0">HIDE_ZERO_DECIMAL</button>' +
  '<button style="opacity:0%">HIDE_ZERO_PERCENT</button>' +
  '<button style="opacity:.0">HIDE_DOT_ZERO</button>' +
  '<button class="ghost">HIDE_RULE_DECIMAL</button>' +
  '<button class="ghost-pct">HIDE_RULE_PERCENT</button>' +
  '<div inert><button>HIDE_INERT_CHILD</button></div>' +
  '<button inert>HIDE_INERT_SELF</button>' +
  '<fieldset disabled><legend><button>LEGEND_OK</button></legend><button>FIELDSET_INNER</button></fieldset>' +
  '<button style="opacity:0.5">HALF_VISIBLE</button><button>PLAIN</button>' +
  '</main></body></html>';

test('the static backend hides zero-opacity variants and inert subtrees', async () => {
  const { server, url } = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  });
  try {
    const page = await openPage(url, { allowPrivate: true });
    const text = page.api.snapshot({ format: 'text' });
    for (const hidden of ['HIDE_ZERO', 'HIDE_ZERO_DECIMAL', 'HIDE_ZERO_PERCENT', 'HIDE_DOT_ZERO',
      'HIDE_RULE_DECIMAL', 'HIDE_RULE_PERCENT', 'HIDE_INERT_CHILD', 'HIDE_INERT_SELF']) {
      assert.doesNotMatch(text, new RegExp(hidden), hidden + ' must not be in the snapshot');
    }
    assert.match(text, /HALF_VISIBLE/);
    assert.match(text, /PLAIN/);
    assert.match(text, /LEGEND_OK/);
    assert.match(text, /"FIELDSET_INNER" disabled/);
    assert.doesNotMatch(text, /"LEGEND_OK" disabled/);
  } finally {
    await close(server);
  }
});

test('the static backend evaluates media ranges, nested media and the cascade', () => {
  const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  const snapshot = (html) => openHtml(html, 'https://fixture.test/').api.snapshot({ format: 'text', force: true });

  const media = snapshot(read('rw-media-query-range.html'));
  assert.match(media, /button "Nav"/);
  assert.match(media, /button "Side"/);

  const shown = snapshot(read('rw-css-hidden-then-shown.html'));
  assert.match(shown, /input\[search\] "Search Wikipedia"/);
  assert.match(shown, /button "Save"/);

  const utility = snapshot(read('rw-utility-class-show.html'));
  assert.match(utility, /button "Open"/);

  const nested = snapshot('<!doctype html><html><head><title>Nested</title><style>' +
    '@media screen and (min-width: 900px){.hidden-a{display:none}}' +
    '@media (width <= 900px){.hidden-b{display:none}}' +
    '@media screen{@media (min-width: 900px){.hidden-c{display:none}}}' +
    '</style></head><body><main>' +
    '<button class="hidden-a">HIDDEN_A</button>' +
    '<button class="hidden-b">VISIBLE_B</button>' +
    '<button class="hidden-c">HIDDEN_C</button>' +
    '</main></body></html>');
  assert.doesNotMatch(nested, /HIDDEN_A/);
  assert.match(nested, /VISIBLE_B/);
  assert.doesNotMatch(nested, /HIDDEN_C/);

  const cascade = snapshot('<!doctype html><html><head><title>Cascade</title><style>' +
    '.imp{display:none !important}.early{display:none}.early{display:block}' +
    '</style></head><body><main>' +
    '<button class="imp" style="display:block">INLINE_VS_IMPORTANT</button>' +
    '<button class="early">LATER_WINS</button>' +
    '</main></body></html>');
  assert.doesNotMatch(cascade, /INLINE_VS_IMPORTANT/);
  assert.match(cascade, /LATER_WINS/);
});
