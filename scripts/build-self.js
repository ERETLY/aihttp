#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENGINE = path.join(ROOT, 'aihttp.min.js');
const PANEL = path.join(ROOT, 'self', 'panel.js');
const OUTPUT = path.join(ROOT, 'self', 'aihttp.user.js');
const pkg = require(path.join(ROOT, 'package.json'));

function header() {
  return [
    '// ==UserScript==',
    '// @name         ahttp self-use',
    '// @namespace    https://github.com/ERETLY/aiweb',
    '// @version      ' + pkg.version,
    '// @description  Snapshot and act on any page without a server.',
    '// @author       ERETLY',
    '// @license      MIT',
    '// @match        http://*/*',
    '// @match        https://*/*',
    '// @run-at       document-idle',
    '// @grant        none',
    '// @noframes',
    '// ==/UserScript==',
    '/*! ahttp self-use | MIT | generated from aihttp.min.js and self/panel.js */',
    ''
  ].join('\n');
}

function render() {
  const engine = fs.readFileSync(ENGINE, 'utf8');
  const panel = fs.readFileSync(PANEL, 'utf8');
  return header() + '\n' + engine.trim() + '\n\n' + panel.trim() + '\n';
}

function main() {
  const output = render();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
    if (current !== output) {
      process.stderr.write('self/aihttp.user.js is stale; run npm run build:self\n');
      process.exit(1);
    }
    process.stdout.write('self/aihttp.user.js is current\n');
    return;
  }
  fs.writeFileSync(OUTPUT, output, 'utf8');
  process.stdout.write('wrote ' + OUTPUT + ' (' + Buffer.byteLength(output) + ' bytes)\n');
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('build-self: ' + (e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  }
}

module.exports = { render };
