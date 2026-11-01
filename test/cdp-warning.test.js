'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MCP = path.join(__dirname, '..', 'bin', 'ahttp-mcp.js');

function start(args) {
  const proc = spawn(process.execPath, [MCP].concat(args), { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => { stderr += chunk; });
  return {
    proc: proc,
    stderr: () => stderr,
    async waitFor(pattern, timeoutMs) {
      const deadline = Date.now() + (timeoutMs || 5000);
      while (Date.now() < deadline) {
        if (pattern.test(stderr)) return stderr;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('timed out waiting for ' + pattern + '; stderr was: ' + stderr);
    }
  };
}

test('CDP mode warns and defaults to a fresh context', async () => {
  const running = start(['--cdp', 'http://127.0.0.1:9']);
  try {
    const stderr = await running.waitFor(/CDP mode attaches/);
    assert.match(stderr, /fresh browser context/);
    assert.doesNotMatch(stderr, /--cdp-use-existing-profile is enabled/);
  } finally {
    running.proc.kill();
  }
});

test('CDP profile reuse requires the explicit flag and warns about signed-in sessions', async () => {
  const running = start(['--cdp', 'http://127.0.0.1:9', '--cdp-use-existing-profile']);
  try {
    const stderr = await running.waitFor(/--cdp-use-existing-profile is enabled/);
    assert.match(stderr, /cookies and signed-in sessions/);
    assert.match(stderr, /dedicated browser profile/);
  } finally {
    running.proc.kill();
  }
});
