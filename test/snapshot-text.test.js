'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'aihttp.js'), 'utf8');

function load(html, url) {
  const dom = new JSDOM(html, { url: url || 'https://format.test/', runScripts: 'outside-only' });
  dom.window.eval(ENGINE);
  return dom.window.aihttp;
}

function page(body, title) {
  return '<!doctype html><html><head><title>' + title + '</title></head><body>' + body + '</body></html>';
}

test('text snapshots stay lean when the page is clean', () => {
  const aihttp = load(page(
    '<main><h1>Shop</h1><label for="q">Search</label><input id="q" name="q">' +
    '<button>Buy</button><p>In stock</p></main>',
    'Shop'
  ));
  const text = aihttp.snapshot({});
  const lines = text.split('\n');
  assert.equal(lines[0], 'aihttp | Shop | https://format.test/');
  assert.match(text, /\na1 input "Search"/);
  assert.match(text, /\na2 button "Buy"/);
  assert.match(text, /\n\[text: untrusted\]\nSearch\nIn stock/);
  assert.doesNotMatch(text, /\[a\d+\]/);
  assert.doesNotMatch(text, /^state: /m);
  assert.doesNotMatch(text, /^\[META\]/m);
  assert.doesNotMatch(text, /^\[meta\]/m);
  assert.doesNotMatch(text, /\[main\]/);
});

test('region headers appear only when the snapshot spans regions', () => {
  const aihttp = load(page(
    '<nav><a href="/help">Help</a></nav><main><button>Pay</button></main>',
    'Checkout'
  ));
  const text = aihttp.snapshot({});
  assert.match(text, /\n\[main\]\na\d+ button "Pay"/);
  assert.match(text, /\n\[nav\]\na\d+ a "Help" -> \/help/);
});

test('verbose adds diagnostics without changing default output', () => {
  const aihttp = load(page('<main><button>Pay</button></main>', 'Pay'));
  const plain = aihttp.snapshot({});
  const verbose = aihttp.snapshot({ verbose: true });
  assert.doesNotMatch(plain, /\[meta\]/);
  assert.match(verbose, /^\[meta\] .*nodes .*layout on .*v\d+\.\d+\.\d+$/m);
});

test('long URLs are shortened in the text header and restored in verbose meta', () => {
  const url = 'https://format.test/a/very/long/path/that/keeps/going/deep/article-title?utm_source=test';
  const aihttp = load(page('<main><button>Pay</button></main>', 'Long URL'), url);
  const first = aihttp.snapshot({}).split('\n')[0];
  assert.equal(first, 'aihttp | Long URL | https://format.test/…/deep/article-title?utm_source=test');
  assert.ok(aihttp.snapshot({ verbose: true }).includes('url ' + url));
});

test('the meta line reports capped actions', () => {
  const aihttp = load(page(
    '<main><button>One</button><button>Two</button><button>Three</button></main>',
    'Actions'
  ));
  const text = aihttp.snapshot({ maxActions: 2 });
  assert.match(text, /^\[meta\] 2\/3 actions$/m);
});
