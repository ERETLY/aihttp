#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const pkg = require('../package.json');
const engine = require('../aihttp.js');
const { openHtml } = require('../lib/page');

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

async function main() {
  assert.equal(engine.__aihttp, true, 'aihttp.js loads without dev dependencies');
  assert.equal(engine.version, pkg.version, 'engine version matches package.json');

  const page = openHtml('<!doctype html><html><body><main><h1>Smoke</h1><button>Smoke action</button></main></body></html>', 'https://smoke.test/');
  const snapshot = page.api.snapshot({ format: 'json' });
  assert.ok(snapshot.actions.some((action) => action.label === 'Smoke action'), 'static engine finds the button');

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><body><main><h1>Smoke</h1><button>Smoke action</button></main></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/';
    const cli = await run(process.execPath, [path.join(__dirname, '..', 'bin', 'aihttp-cli.js'), url, '--allow-private', '--no-stats']);
    assert.equal(cli.code, 0, 'CLI exit code is zero: ' + (cli.stderr || ''));
    assert.match(cli.stdout, /Smoke action/, 'CLI prints the action');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  process.stdout.write('smoke ok: aihttp ' + pkg.version + ' on node ' + process.version + '\n');
}

main().catch((err) => {
  process.stderr.write('smoke failed: ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(1);
});
