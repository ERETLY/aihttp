'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

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

test('runtime smoke script works without dev dependencies', { timeout: 60000 }, async () => {
  const result = await run(process.execPath, [path.join(__dirname, '..', 'scripts', 'smoke-runtime.js')]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /smoke ok: aihttp \d+\.\d+\.\d+ on node /);
});
