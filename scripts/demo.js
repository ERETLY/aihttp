#!/usr/bin/env node
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DISPLAY_ORIGIN = 'http://127.0.0.1:3000';
const PAGE = `<!doctype html>
<html><head><title>Widget shop</title></head>
<body>
  <main>
    <h1>Widget shop</h1>
    <label for="email">Email</label>
    <input id="email" name="email" placeholder="agent@example.com">
    <label for="size">Size</label>
    <select id="size" name="size"><option>Small</option><option>Large</option></select>
    <button>Add to cart</button>
    <button>Buy now</button>
    <a href="/help">Shipping help</a>
    <p>Widgets are in stock. Orders ship in two days.</p>
  </main>
</body></html>`;

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code: code, stdout: stdout, stderr: stderr }));
  });
}

function stable(output) {
  return output
    .split(/\r?\n/)
    .filter((line) => !/^\[META\]/.test(line))
    .join('\n')
    .trimEnd();
}

async function main() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const cli = path.join(__dirname, '..', 'bin', 'ahttp-cli.js');
  try {
    const full = await run(process.execPath, [cli, origin + '/', '--allow-private', '--no-stats']);
    const filtered = await run(process.execPath, [cli, origin + '/', '--allow-private', '--no-stats', '--query', 'Buy']);
    if (full.code !== 0 || filtered.code !== 0) {
      throw new Error('CLI failed: ' + (full.stderr || filtered.stderr));
    }
    const lines = [
      '# ahttp terminal demo',
      '',
      'Runs against a local page; no network access is required. Regenerate with `node scripts/demo.js`.',
      '',
      '```console',
      '$ node bin/ahttp-cli.js ' + DISPLAY_ORIGIN + '/ --allow-private --no-stats',
      stable(full.stdout).split(origin).join(DISPLAY_ORIGIN),
      '',
      '$ node bin/ahttp-cli.js ' + DISPLAY_ORIGIN + '/ --allow-private --no-stats --query "Buy"',
      stable(filtered.stdout).split(origin).join(DISPLAY_ORIGIN),
      '```',
      ''
    ];
    const text = lines.join('\n');
    if (process.argv.includes('--write')) {
      fs.writeFileSync(path.join(__dirname, '..', 'docs', 'DEMO.md'), text, 'utf8');
      process.stdout.write('updated docs/DEMO.md\n');
    } else {
      process.stdout.write(text);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  process.stderr.write('demo failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});
