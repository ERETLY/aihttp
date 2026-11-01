'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

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

test('checked-in terminal transcript matches the demo script', { timeout: 60000 }, async () => {
  const demo = path.join(ROOT, 'scripts', 'demo.js');
  const result = await run(process.execPath, [demo]);
  assert.equal(result.code, 0, result.stderr);
  const documented = fs.readFileSync(path.join(ROOT, 'docs', 'DEMO.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(documented.trim(), result.stdout.trim(), 'run `node scripts/demo.js --write` to refresh docs/DEMO.md');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /docs\/DEMO\.md/);
  assert.match(readme, /node scripts\/demo\.js/);
});

test('demo page loads no external resources', () => {
  const html = fs.readFileSync(path.join(ROOT, 'docs', 'demo', 'index.html'), 'utf8');
  const values = [];
  const attribute = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = attribute.exec(html))) values.push(match[1]);
  for (const value of values) {
    assert.doesNotMatch(value, /^(?:https?:)?\/\//i, 'external resource: ' + value);
    assert.doesNotMatch(value, /^data:/i, 'inline data resource: ' + value);
  }
  assert.doesNotMatch(html, /url\(\s*["']?https?:/i);
  assert.doesNotMatch(html, /@import\s+["']?https?:/i);
});

test('launch notes document GitHub Pages for /docs/demo', () => {
  const launch = fs.readFileSync(path.join(ROOT, 'docs', 'LAUNCH.md'), 'utf8');
  assert.match(launch, /docs\/demo/);
  assert.match(launch, /Settings .* Pages/);
  assert.match(launch, /Deploy from a branch/);
  assert.match(launch, /\/docs/);
  assert.match(launch, /no external requests/);
});
