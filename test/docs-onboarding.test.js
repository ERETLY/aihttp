'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

test('README keeps the required badges', () => {
  assert.match(readme, /status: stable/);
  assert.match(readme, /img\.shields\.io\/github\/package-json\/v\/ERETLY\/ahttp/);
  assert.match(readme, /actions\/workflows\/ci\.yml\/badge\.svg/);
});

test('README keeps the 30-second userscript path', () => {
  assert.match(readme, /## Quick start/);
  assert.match(readme, /Alt\+Shift\+A/);
  assert.match(readme, /aihttp\.user\.js/);
});

test('README keeps a copy-paste MCP block', () => {
  assert.match(readme, /"mcpServers"/);
  assert.match(readme, /bin\/aihttp-mcp\.js/);
  assert.match(readme, /Claude Desktop or Cursor/);
});

test('README documents the matching limitations and the local loop', () => {
  assert.match(readme, /## Known limitations/);
  assert.match(readme, /ambiguous/);
  assert.match(readme, /no_effect/);
  assert.match(readme, /Virtualized lists/);
  assert.match(readme, /shadow/i);
  assert.match(readme, /examples\/agent-loop\.js/);
  assert.match(readme, /## Breaking changes/);
});
