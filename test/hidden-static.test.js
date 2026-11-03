'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openPage } = require('../lib/page');

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
