'use strict';

// Chromium-only repro: developer.mozilla.org wraps the whole article in
// <main id="content" class="layout__content"> with `display: contents`.
// The element has text but its own box is 0x0, so hiddenAncestorChain()
// classifies it as a zero-size hidden target and drops the entire subtree.
// jsdom cannot reproduce this because the check only runs with real layout.
//
// Run from the repo root: node benchmark/realworld/repro/display-contents/repro.js

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const ENGINE = fs.readFileSync(path.join(ROOT, 'ahttp.js'), 'utf8');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript({ content: ENGINE });
  await page.goto('file:///' + path.join(__dirname, 'fixture.html').replace(/\\/g, '/'));
  await page.waitForTimeout(300);
  const json = await page.evaluate(() => window.ahttp.snapshot({ format: 'json', maxActions: 200 }));
  const text = await page.evaluate(() => window.ahttp.snapshot({ format: 'text' }));
  const save = json.actions.find(function (action) { return action.label === 'Save'; });
  console.log('actions: ' + JSON.stringify(json.actions.map(function (action) {
    return action.id + ' ' + action.tag + ' ' + action.role + ' ' + JSON.stringify(action.label);
  })));
  console.log('Save action: ' + (save ? 'present' : 'MISSING'));
  console.log('main computed display: ' + await page.evaluate(() => getComputedStyle(document.querySelector('main')).display));
  console.log('main children visible: ' + await page.evaluate(() => document.querySelector('main button').getBoundingClientRect().width > 0));
  console.log('expected: Save is an action, because its rendered children are visible even though <main> has no box');
  console.log('--- text ---');
  console.log(text);
  await browser.close();
  if (!save) process.exit(1);
})().catch(function (err) { console.error(err); process.exit(1); });
