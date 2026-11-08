'use strict';

// MCP product-path smoke test on real sites. Runs the real stdio server in
// browser mode; writes benchmark/realworld/mcp-results.json.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, 'mcp-results.json');
const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'aihttp-realworld', version: '0.1.0' },
  'io.modelcontextprotocol/clientCapabilities': {}
};

function createClient(proc) {
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  proc.stdout.on('data', function (chunk) {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (e) { continue; }
      if (message.id == null || !pending.has(message.id)) continue;
      const handler = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(handler.timer);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result);
    }
  });
  function call(method, params, timeout) {
    return new Promise(function (resolve, reject) {
      const id = nextId++;
      const timer = setTimeout(function () {
        if (pending.has(id)) { pending.delete(id); reject(new Error('timeout waiting for ' + method)); }
      }, timeout || 30000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params }) + '\n');
    });
  }
  return { call: call };
}

function textOf(result) {
  return result && result.content && result.content[0] ? result.content[0].text : '';
}

function firstId(text, regex) {
  const hit = regex.exec(text);
  return hit ? hit[1] : null;
}

async function main() {
  const proc = spawn(process.execPath, [path.join(ROOT, 'bin', 'aihttp-mcp.js'), '--browser'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const client = createClient(proc);
  const checks = [];
  function record(site, name, ok, detail) {
    checks.push({ site: site, check: name, ok: !!ok, detail: detail || '' });
    console.log((ok ? 'PASS ' : 'FAIL ') + site + ' :: ' + name + (detail ? ' :: ' + String(detail).slice(0, 200) : ''));
  }
  try {
    const opened = await client.call('tools/call', {
      name: 'aihttp_open',
      arguments: { url: 'https://the-internet.herokuapp.com/checkboxes' },
      _meta: META
    });
    const pageId = opened.structuredContent && opened.structuredContent.pageId;
    record('the-internet/checkboxes', 'aihttp_open returns a page handle', !opened.isError && !!pageId, pageId);
    const snapText = textOf(opened);
    record('the-internet/checkboxes', 'snapshot text has the checkbox', /input\[checkbox\]/.test(snapText));
    const checkboxId = firstId(snapText, /^(a\d+) input\[checkbox\]/m);
    const acted = checkboxId ? await client.call('tools/call', {
      name: 'aihttp_act', arguments: { pageId: pageId, id: checkboxId, value: 'true' }, _meta: META
    }) : { isError: true };
    record('the-internet/checkboxes', 'aihttp_act toggles the checkbox', !acted.isError, acted.structuredContent && acted.structuredContent.status);
    const after = await client.call('tools/call', { name: 'aihttp_snapshot', arguments: { pageId: pageId }, _meta: META });
    record('the-internet/checkboxes', 'aihttp_snapshot reads the same page', !after.isError && /checked/.test(textOf(after)));

    const mcpTodo = await client.call('tools/call', {
      name: 'aihttp_open', arguments: { url: 'https://todomvc.com/examples/react/dist/' }, _meta: META
    });
    const todoPage = mcpTodo.structuredContent && mcpTodo.structuredContent.pageId;
    const todoText = textOf(mcpTodo);
    record('todomvc', 'aihttp_open works', !mcpTodo.isError, todoPage);
    const inputId = firstId(todoText, /^(a\d+) input(?:\[[^\]]*\])? "What needs to be done\?"/m) ||
      firstId(todoText, /^(a\d+) input(?:\[[^\]]*\])?/m);
    let filled = { isError: true };
    if (inputId) {
      filled = await client.call('tools/call', {
        name: 'aihttp_act', arguments: { pageId: todoPage, id: inputId, value: 'MCP task' }, _meta: META
      });
    }
    record('todomvc', 'aihttp_act fill', !filled.isError, filled.structuredContent && filled.structuredContent.status);
    const typed = inputId ? await client.call('tools/call', {
      name: 'aihttp_act', arguments: { pageId: todoPage, id: inputId, key: 'Enter' }, _meta: META
    }) : { isError: true };
    record('todomvc', 'aihttp_act Enter adds the todo', !typed.isError && /MCP task/.test(textOf(typed)));

    const books = await client.call('tools/call', {
      name: 'aihttp_open', arguments: { url: 'https://books.toscrape.com/', maxActions: 500 }, _meta: META
    });
    const booksText = textOf(books);
    const booksPage = books.structuredContent && books.structuredContent.pageId;
    record('books.toscrape', 'aihttp_open works', !books.isError, booksPage);
    const nextId = firstId(booksText, /^(a\d+) a "next"/m);
    const nexted = nextId ? await client.call('tools/call', {
      name: 'aihttp_act', arguments: { pageId: booksPage, id: nextId }, _meta: META
    }) : { isError: true };
    const booksAfter = nextId ? await client.call('tools/call', {
      name: 'aihttp_snapshot', arguments: { pageId: booksPage }, _meta: META
    }) : { isError: true };
    record('books.toscrape', 'aihttp_act navigates to page 2',
      !nexted.isError && /Page 2 of/.test(textOf(booksAfter) + JSON.stringify(nexted.structuredContent || {})));

    const addRemove = await client.call('tools/call', {
      name: 'aihttp_open', arguments: { url: 'https://the-internet.herokuapp.com/add_remove_elements/' }, _meta: META
    });
    const arPage = addRemove.structuredContent && addRemove.structuredContent.pageId;
    let arText = textOf(addRemove);
    for (let i = 0; i < 2; i++) {
      const addId = firstId(arText, /^(a\d+) button "Add Element"/m);
      if (!addId) break;
      const added = await client.call('tools/call', {
        name: 'aihttp_act', arguments: { pageId: arPage, id: addId }, _meta: META
      });
      arText = textOf(added);
    }
    const arSnap = await client.call('tools/call', {
      name: 'aihttp_snapshot', arguments: { pageId: arPage }, _meta: META
    });
    const arSnapText = textOf(arSnap);
    record('the-internet/add_remove_elements', 'two Delete buttons exist', (arSnapText.match(/button "Delete"/g) || []).length === 2);
    const ambiguous = await client.call('tools/call', {
      name: 'aihttp_act', arguments: { pageId: arPage, id: 'Delete' }, _meta: META
    });
    record('the-internet/add_remove_elements', 'ambiguous Delete label is refused with candidates',
      ambiguous.isError === true && ambiguous.structuredContent &&
      ambiguous.structuredContent.status === 'ambiguous' &&
      (ambiguous.structuredContent.candidates || []).length === 2,
      ambiguous.structuredContent && ambiguous.structuredContent.status);
  } catch (err) {
    record('mcp', 'run completed without exceptions', false, err && err.message);
  } finally {
    proc.kill();
  }
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    checks: checks,
    passed: checks.filter(function (item) { return item.ok; }).length,
    total: checks.length
  }, null, 2) + '\n');
  console.log('wrote ' + OUT);
  process.exit(checks.every(function (item) { return item.ok; }) ? 0 : 1);
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
