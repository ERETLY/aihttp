'use strict';

// Chromium-only repro: saucedemo.com hides the real <select> with
// opacity:0.001 and paints a sibling span. The engine drops the select and
// reports the span as a button that does nothing.
//
// Run from the repo root: node benchmark/realworld/repro/select-opacity/repro.js

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const ENGINE = fs.readFileSync(path.join(ROOT, 'aihttp.js'), 'utf8');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript({ content: ENGINE });
  await page.goto('file:///' + path.join(__dirname, 'fixture.html').replace(/\\/g, '/'));
  await page.waitForTimeout(300);
  const json = await page.evaluate(() => window.aihttp.snapshot({ format: 'json', maxActions: 200 }));
  const text = await page.evaluate(() => window.aihttp.snapshot({ format: 'text' }));
  const select = json.actions.find(function (action) { return action.tag === 'select'; });
  const proxy = json.actions.find(function (action) { return action.tag === 'span'; });
  console.log('actions: ' + JSON.stringify(json.actions.map(function (action) {
    return action.id + ' ' + action.tag + ' ' + action.role + ' ' + JSON.stringify(action.label);
  })));
  console.log('select action: ' + (select ? 'present' : 'MISSING'));
  console.log('proxy action: ' + (proxy ? 'present (' + proxy.label + ')' : 'absent'));
  if (proxy) {
    const before = await page.evaluate(() => document.querySelector('select').value);
    const acted = await page.evaluate(function (id) { return window.aihttp.act(id, null, { timeout: 2000 }); }, proxy.id);
    const after = await page.evaluate(() => document.querySelector('select').value);
    console.log('proxy click: status=' + acted.status + ' value ' + before + ' -> ' + after);
  }
  console.log('expected: select action present with name "Sort products"; proxy is not a dead button');
  console.log('--- text ---');
  console.log(text);
  await browser.close();
  if (!select) process.exit(1);
})().catch(function (err) { console.error(err); process.exit(1); });
