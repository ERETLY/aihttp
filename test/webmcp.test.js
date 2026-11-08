'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'aihttp.js'), 'utf8');

function loadWithWebMCP(html) {
  const dom = new JSDOM(html, { url: 'https://webmcp.test/', runScripts: 'outside-only' });
  const tools = new Map();
  dom.window.document.modelContext = {
    async registerTool(tool, options) {
      if (tools.has(tool.name)) throw new Error('duplicate tool');
      tools.set(tool.name, { tool, options });
    }
  };
  dom.window.eval(ENGINE);
  return { dom, tools };
}

test('installWebMCP registers snapshot and action tools when document.modelContext exists', async () => {
  const { dom, tools } = loadWithWebMCP('<!doctype html><body><main><button id="b">Go</button><p id="out">idle</p></main></body>');
  const button = dom.window.document.getElementById('b');
  button.addEventListener('click', () => { dom.window.document.getElementById('out').textContent = 'clicked'; });
  const installed = await dom.window.ahttp.installWebMCP();
  assert.equal(installed.ok, true);
  assert.equal(installed.names.join(','), 'ahttp_snapshot,ahttp_act');
  assert.equal(tools.size, 2);
  assert.equal(tools.get('ahttp_snapshot').tool.annotations.readOnlyHint, true);
  assert.equal(tools.get('ahttp_act').tool.annotations.consequentialHint, true);

  const snapshot = await tools.get('ahttp_snapshot').tool.execute({});
  assert.equal(snapshot.format, undefined);
  assert.equal(snapshot.actions.length, 1);
  assert.match(snapshot.actions[0].label, /Go/);

  const action = await tools.get('ahttp_act').tool.execute({ id: snapshot.actions[0].id });
  assert.equal(action.ok, true);
  assert.equal(dom.window.document.getElementById('out').textContent, 'clicked');
  installed.close();
});

test('installWebMCP reports unavailable without document.modelContext', async () => {
  const dom = new JSDOM('<!doctype html><body><button>Go</button></body>', { url: 'https://webmcp.test/', runScripts: 'outside-only' });
  dom.window.eval(ENGINE);
  const result = await dom.window.ahttp.installWebMCP();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'webmcp_unavailable');
});
