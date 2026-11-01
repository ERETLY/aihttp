#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fetchUrl, bytesOf } = require('../lib/page');
const { SITES } = require('./lib/sites');

const OUT_DIR = path.join(__dirname, 'pinned');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const index = [];
  for (const site of SITES) {
    process.stdout.write('fetching ' + site.name + ' ... ');
    const started = Date.now();
    try {
      const result = await fetchUrl(site.url, { timeout: 30000 });
      if (result.status >= 400) throw new Error('HTTP ' + result.status);
      const file = site.slug + '.html';
      const target = path.join(OUT_DIR, file);
      fs.writeFileSync(target, result.text, 'utf8');
      const entry = {
        name: site.name,
        url: site.url,
        file: file,
        bytes: bytesOf(result.text),
        sha256: crypto.createHash('sha256').update(result.text).digest('hex'),
        httpStatus: result.status,
        fetchedAt: new Date().toISOString(),
        fetchMs: Date.now() - started
      };
      index.push(entry);
      process.stdout.write(entry.bytes + ' bytes, ' + entry.fetchMs + ' ms\n');
    } catch (e) {
      process.stdout.write('FAILED: ' + (e && e.message ? e.message : String(e)) + '\n');
      index.push({ name: site.name, url: site.url, error: e && e.message ? e.message : String(e) });
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
  process.stdout.write('wrote ' + path.join(OUT_DIR, 'index.json') + '\n');
  if (index.some((entry) => entry.error)) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write('fetch-pinned failed: ' + (e && e.stack ? e.stack : String(e)) + '\n');
  process.exit(1);
});
