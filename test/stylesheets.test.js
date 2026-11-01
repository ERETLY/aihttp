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

const PAGE = '<!doctype html><html><head><title>Styles</title>' +
  '<link rel="stylesheet" href="/page.css"></head><body><main>' +
  '<button>Visible</button><button id="secret">CSS_HIDDEN_CANARY</button>' +
  '<button id="deep">CSS_IMPORT_CANARY</button><button id="printed">PRINT_ONLY</button>' +
  '</main></body></html>';

function handler(req, res) {
  if (req.url === '/page.css') {
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end('@import url("/deep.css");\n#secret { display: none; }\n@media print { #printed { display: none; } }');
    return;
  }
  if (req.url === '/deep.css') {
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end('#deep { display: none; }');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
}

test('the static backend inlines external stylesheets before scanning', async () => {
  const { server, url } = await listen(handler);
  try {
    const withCss = await openPage(url, { allowPrivate: true });
    assert.equal(withCss.styles, 2);
    const hidden = withCss.api.snapshot({ format: 'text' });
    assert.doesNotMatch(hidden, /CSS_HIDDEN_CANARY/);
    assert.doesNotMatch(hidden, /CSS_IMPORT_CANARY/);
    assert.match(hidden, /PRINT_ONLY/);
    assert.equal(withCss.api.snapshot({ format: 'json' }).meta.actions, 2);

    const withoutCss = await openPage(url, { allowPrivate: true, fetchStyles: false });
    assert.equal(withoutCss.styles, 0);
    assert.match(withoutCss.api.snapshot({ format: 'text' }), /CSS_HIDDEN_CANARY/);
  } finally {
    await close(server);
  }
});
