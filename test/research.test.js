'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RESEARCH = path.join(__dirname, '..', 'docs', 'RESEARCH.md');

test('WebMCP research note cites the current primary sources', () => {
  const doc = fs.readFileSync(RESEARCH, 'utf8');
  assert.match(doc, /Draft Community Group Report/);
  assert.match(doc, /27 October 2026/);
  assert.match(doc, /not a W3C Standard/);
  assert.match(doc, /document\.modelContext/);
  assert.match(doc, /registerTool/);
  assert.match(doc, /getTools/);
  assert.match(doc, /executeTool/);
  for (const hint of ['readOnlyHint', 'untrustedContentHint', 'consequentialHint']) {
    assert.match(doc, new RegExp(hint));
  }
  assert.match(doc, /https:\/\/webmachinelearning\.github\.io\/webmcp\//);
  assert.match(doc, /developer\.chrome\.com\/docs\/ai\/webmcp\/imperative-api/);
  assert.match(doc, /webmachinelearning\/webmcp\/pull\/184/);
  assert.match(doc, /removed the old `navigator\.modelContext` API/);
});
