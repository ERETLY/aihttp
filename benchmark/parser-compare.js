#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createWindow } = require('../lib/mini-dom');
const { parseHTML } = require('linkedom');

const FIXTURES = path.join(__dirname, 'fixtures');
const CASES = [
  ['01-react-store.html', 'fixture'],
  ['02-div-hell.html', 'fixture'],
  ['03-shadow-dom.html', 'fixture'],
  ['04-async-modal.html', 'fixture'],
  ['05-security.html', 'fixture'],
  ['06-data-grid.html', 'fixture'],
  ['07-icon-only.html', 'fixture'],
  ['08-contenteditable.html', 'fixture'],
  ['09-giant-dom.html', 'fixture'],
  ['ecommerce.html', 'fixture'],
  ['table-malformed.html', 'inline'],
  ['unclosed.html', 'inline']
];

const INLINE = {
  'table-malformed.html': '<!doctype html><table><tr><td>one<td>two</table><p>after',
  'unclosed.html': '<!doctype html><div><p>one<b>two<i>three</div><button>four'
};

function countMini(html) {
  const win = createWindow(html, 'https://fixture.test/');
  const doc = win.document;
  return {
    elements: doc.querySelectorAll('*').length,
    buttons: doc.querySelectorAll('button').length,
    inputs: doc.querySelectorAll('input').length,
    text: String(doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ').trim().length
  };
}

function countLinkedom(html) {
  const parsed = parseHTML(html);
  const doc = parsed.document;
  return {
    elements: doc.querySelectorAll('*').length,
    buttons: doc.querySelectorAll('button').length,
    inputs: doc.querySelectorAll('input').length,
    text: String(doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ').trim().length
  };
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function time(fn, html, iterations) {
  const values = [];
  for (let i = 0; i < iterations; i++) {
    const started = process.hrtime.bigint();
    fn(html);
    values.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  return Math.round(median(values) * 100) / 100;
}

const results = [];
for (const item of CASES) {
  const name = item[0];
  const html = item[1] === 'inline' ? INLINE[name] : fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  let mini;
  let linked;
  let miniError = null;
  let linkedError = null;
  try { mini = countMini(html); } catch (e) { miniError = e && e.message ? e.message : String(e); }
  try { linked = countLinkedom(html); } catch (e) { linkedError = e && e.message ? e.message : String(e); }
  results.push({
    case: name,
    bytes: Buffer.byteLength(html),
    mini: mini || null,
    linkedom: linked || null,
    miniError: miniError,
    linkedomError: linkedError,
    miniMs: time(countMini, html, 20),
    linkedomMs: time(countLinkedom, html, 20)
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  parser: 'mini-dom vs linkedom (parse5-based)',
  cases: results
};
fs.writeFileSync(path.join(__dirname, 'parser-results.json'), JSON.stringify(output, null, 2) + '\n', 'utf8');
for (const row of results) {
  process.stdout.write(row.case.padEnd(25) + ' mini ' + String(row.mini ? row.mini.elements : 'ERR').padStart(5) +
    ' els ' + String(row.miniMs).padStart(8) + ' ms  linkedom ' + String(row.linkedom ? row.linkedom.elements : 'ERR').padStart(5) +
    ' els ' + String(row.linkedomMs).padStart(8) + ' ms\n');
}
process.stdout.write('wrote ' + path.join(__dirname, 'parser-results.json') + '\n');
