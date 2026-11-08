'use strict';

const fs = require('fs');
const path = require('path');

async function main() {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    process.stderr.write('Puppeteer is not installed. Run: npm install puppeteer\n');
    process.exit(1);
  }
  const url = process.argv[2] || 'https://example.com';
  const engine = fs.readFileSync(path.join(__dirname, '..', '..', 'aihttp.js'), 'utf8');
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(engine);
    const snapshot = await page.evaluate(() => window.ahttp.snapshot({ maxActions: 60 }));
    process.stdout.write(snapshot + '\n');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
