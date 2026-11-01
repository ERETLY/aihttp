'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWindow } = require('../lib/mini-dom');

const FIXTURES = path.join(__dirname, '..', 'benchmark', 'fixtures');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('mini-dom parses the checked-in fixtures without throwing', () => {
  for (const file of fs.readdirSync(FIXTURES).filter((name) => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(FIXTURES, file), 'utf8');
    const win = createWindow(html, 'https://fixture.test/' + file);
    assert.ok(win.document && win.document.body, file);
    assert.ok(win.document.querySelectorAll('*').length > 0, file);
  }
});

test('mini-dom handles malformed table and unclosed markup without throwing', () => {
  const inputs = [
    '<!doctype html><table><tr><td>one<td>two</table><p>after',
    '<!doctype html><div><p>one<b>two<i>three</div><button>four',
    '<div><span></div></span>',
    '<table><tbody><tr><th>A<th>B<tr><td>1<td>2</table>',
    '<svg><foreignObject><div>html</div></foreignObject></svg>',
    '<template><button>hidden</button></template>',
    '<!doctype html><p>unterminated <a href="x">link'
  ];
  for (const html of inputs) {
    const win = createWindow(html, 'https://fixture.test/');
    assert.ok(win.document.body || win.document.documentElement);
    assert.equal(typeof win.document.body.textContent, 'string');
  }
});

test('random malformed input does not throw and stays bounded', () => {
  const random = mulberry32(0xA11CE);
  const tags = ['div', 'span', 'table', 'tr', 'td', 'p', 'button', 'input', 'a', 'svg', 'template', 'script', 'style'];
  const pieces = ['<', '>', '</', '/>', '"', "'", '=', '&amp;', '&', '#', 'text', ' ', '\n', '<!--', '-->'];
  for (let i = 0; i < 300; i++) {
    const count = 1 + Math.floor(random() * 80);
    let html = '';
    for (let j = 0; j < count; j++) {
      if (random() < 0.55) {
        const tag = tags[Math.floor(random() * tags.length)];
        html += (random() < 0.5 ? '<' : '</') + tag + (random() < 0.3 ? ' data-x="1"' : '') + '>';
      } else {
        html += pieces[Math.floor(random() * pieces.length)];
      }
    }
    const win = createWindow(html, 'https://fixture.test/');
    assert.ok(win.document);
    assert.ok(win.document.querySelectorAll('*').length <= 200);
  }
});
