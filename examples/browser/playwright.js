'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const url = process.argv[2] || 'https://example.com';
  const engine = fs.readFileSync(path.join(__dirname, '..', '..', 'aihttp.js'), 'utf8');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: engine });
    const snapshot = await page.evaluate(() => window.ahttp.snapshot({ maxActions: 60, maxText: 800 }));
    process.stdout.write(snapshot + '\n');
    const first = await page.evaluate(() => {
      const data = window.ahttp.snapshot({ format: 'json', maxActions: 1 });
      return data.actions[0] || null;
    });
    if (!first) return;
    const result = await page.evaluate((id) => window.ahttp.act(id, null, { confirm: false }), first.id);
    process.stdout.write('\n' + (result.diff ? result.diff.text : JSON.stringify(result)) + '\n');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
