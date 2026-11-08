'use strict';

// A minimal agent loop: snapshot -> choose by label -> act with an expectation.
// Local fixture in Chromium, no network. Run: node examples/agent-loop.js

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const engine = fs.readFileSync(path.join(__dirname, '..', 'aihttp.js'), 'utf8');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent('<main><button id="add">Add to cart</button><p id="cart">Cart: 0</p></main>');
    await page.evaluate(() => {
      document.getElementById('add').addEventListener('click', () => {
        document.getElementById('cart').textContent = 'Item added';
      });
    });
    await page.addScriptTag({ content: engine });

    const snapshot = await page.evaluate(() => window.ahttp.snapshot({ format: 'json' }));
    process.stdout.write(snapshot.actions.map((a) => a.id + ' ' + a.role + ' "' + a.label + '"').join('\n') + '\n');

    const target = snapshot.actions.find((action) => /add to cart/i.test(action.label));
    if (!target) throw new Error('target control not found');
    const step = await page.evaluate((id) => window.ahttp.act(id, null, {
      expect: { diff: true, textAdded: ['Item added'] }
    }), target.id);
    process.stdout.write(step.status + ': ' + (step.diff ? step.diff.text : JSON.stringify(step)) + '\n');
    if (step.status !== 'ok') process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
