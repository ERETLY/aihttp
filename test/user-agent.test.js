'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const pkg = require('../package.json');
const page = require('../lib/page');
const browser = require('../lib/browser');

test('User-Agent version is derived from package.json', () => {
  assert.equal(page.DEFAULT_UA, browser.DEFAULT_UA);
  assert.match(page.DEFAULT_UA, new RegExp('aihttp/' + pkg.version.replace(/\./g, '\\.') + ';'));
});

test('fetchUrl sends the package version in the User-Agent header', async () => {
  let seen = '';
  const server = http.createServer((req, res) => {
    seen = req.headers['user-agent'] || '';
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body>ok</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.fetchUrl('http://127.0.0.1:' + server.address().port + '/', { allowPrivate: true });
    assert.equal(seen, page.DEFAULT_UA);
    assert.ok(seen.indexOf('aihttp/' + pkg.version) >= 0, 'request carries the package version');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
