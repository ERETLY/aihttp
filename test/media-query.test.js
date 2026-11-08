'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'aihttp.js'), 'utf8');

const HTML = '<!doctype html><html><head><title>Media bounds</title><style>' +
  '@media (width <= 768px){.le{display:none}}' +
  '@media (width < 768px){.lt{display:none}}' +
  '@media (width >= 768px){.ge{display:none}}' +
  '@media (width > 768px){.gt{display:none}}' +
  '@media (min-width: calc(50rem - 32px)){.calc{display:none}}' +
  '@media print, (min-width: 700px){.list{display:none}}' +
  '@media not screen{.not-screen{display:none}}' +
  '@media not print{.not-print{display:none}}' +
  '</style></head><body><main>' +
  '<button class="le">LE</button>' +
  '<button class="lt">LT</button>' +
  '<button class="ge">GE</button>' +
  '<button class="gt">GT</button>' +
  '<button class="calc">CALC</button>' +
  '<button class="list">LIST</button>' +
  '<button class="not-screen">NOT_SCREEN</button>' +
  '<button class="not-print">NOT_PRINT</button>' +
  '</main></body></html>';

function snapshotAt(width, height) {
  const dom = new JSDOM(HTML, {
    url: 'https://fixture.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    resources: undefined
  });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: height || 800 });
  dom.window.eval(ENGINE);
  const text = dom.window.aihttp.snapshot({ format: 'text', force: true });
  dom.window.close();
  return text;
}

function visible(text, label) {
  return text.indexOf('button "' + label + '"') >= 0;
}

test('media query boundaries use the actual viewport', () => {
  const exact = snapshotAt(768, 800);
  assert.ok(!visible(exact, 'LE'), '<= 768 includes 768');
  assert.ok(visible(exact, 'LT'), '< 768 excludes 768');
  assert.ok(!visible(exact, 'GE'), '>= 768 includes 768');
  assert.ok(visible(exact, 'GT'), '> 768 excludes 768');
  assert.ok(!visible(exact, 'CALC'), 'calc(50rem - 32px) is 768px');
  assert.ok(!visible(exact, 'LIST'), 'a comma list matches on width 768');
  assert.ok(visible(exact, 'NOT_SCREEN'), 'not screen does not match a screen');
  assert.ok(!visible(exact, 'NOT_PRINT'), 'not print matches a screen');

  const below = snapshotAt(767, 800);
  assert.ok(!visible(below, 'LE'));
  assert.ok(!visible(below, 'LT'), '< 768 includes 767');
  assert.ok(visible(below, 'GE'));
  assert.ok(visible(below, 'GT'));
  assert.ok(visible(below, 'CALC'), 'calc(50rem - 32px) excludes 767');
  assert.ok(!visible(below, 'LIST'), 'min-width 700px still matches at 767');

  const above = snapshotAt(769, 800);
  assert.ok(visible(above, 'LE'));
  assert.ok(visible(above, 'LT'));
  assert.ok(!visible(above, 'GE'));
  assert.ok(!visible(above, 'GT'));

  const narrow = snapshotAt(600, 800);
  assert.ok(visible(narrow, 'LIST'), 'min-width 700px is false at 600');
  assert.ok(!visible(narrow, 'LE'));
  assert.ok(!visible(narrow, 'LT'));
  assert.ok(visible(narrow, 'GE'));
  assert.ok(visible(narrow, 'GT'));
});
