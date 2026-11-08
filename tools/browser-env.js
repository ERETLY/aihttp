'use strict';

const fs = require('node:fs');

let playwright = null;
try { playwright = require('playwright'); } catch (e) {}

function chromiumExecutable() {
  if (!playwright) return null;
  try { return playwright.chromium.executablePath(); } catch (e) { return null; }
}

function chromiumAvailable() {
  const executable = chromiumExecutable();
  return !!executable && fs.existsSync(executable);
}

function chromiumVersion() {
  if (!playwright) return 'unavailable';
  try { return playwright.chromium.version(); } catch (e) { return 'unknown'; }
}

async function detectChromiumVersion() {
  if (!playwright) return 'unavailable';
  let browser = null;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    return browser.version();
  } catch (e) {
    return 'unknown';
  } finally {
    if (browser) { try { await browser.close(); } catch (e) {} }
  }
}

function browserGate(available, required) {
  if (available) return { skip: false, fail: false };
  if (required) {
    return {
      skip: false,
      fail: true,
      reason: 'AIHTTP_REQUIRE_BROWSER=1 but Chromium is not installed; run `npx playwright install chromium`'
    };
  }
  return {
    skip: 'Chromium is not installed; set AIHTTP_REQUIRE_BROWSER=1 to fail instead of skip',
    fail: false
  };
}

module.exports = {
  playwright,
  chromiumAvailable,
  chromiumExecutable,
  chromiumVersion,
  detectChromiumVersion,
  browserGate
};
