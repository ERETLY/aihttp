'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const pkg = require('../../package.json');

const OWNER_KEY = 'owner-secret';
const OWNER_HASH = crypto.createHash('sha256').update(OWNER_KEY).digest('hex');

const PAGES = {
  '/': `<!doctype html><html><head><title>MCP Fixture</title></head><body>
    <main>
      <h1>Checkout</h1>
      <nav><a href="/next">Next page</a></nav>
      <form>
        <label for="email">Email</label>
        <input id="email" name="email" placeholder="you@example.com">
        <button type="button">Submit</button>
      </form>
      <button data-ahttp-confirm="Deletes everything">Delete account</button>
      <div style="font-size:0">HIDDEN_CANARY_MCP</div>
    </main>
  </body></html>`,
  '/next': `<!doctype html><html><head><title>Second</title></head><body>
    <main><h1>Second page</h1><button>Continue</button></main>
  </body></html>`,
  '/private': `<!doctype html><html><head><title>Owner Console</title></head><body>
    <main>
      <h1>Owner Console</h1>
      <button data-ahttp-intent="checkout_submit" onclick="document.getElementById('out').textContent='charged'">Charge card</button>
      <button data-ahttp-intent="delete_account" onclick="document.getElementById('out').textContent='deleted'">Delete account</button>
      <p id="out">idle</p>
    </main>
    <script src="ahttp.js" data-ahttp-owner="acme" data-ahttp-private="true"
      data-ahttp-key-hash="${OWNER_HASH}"
      data-ahttp-allow="checkout_submit,delete_account"
      data-ahttp-deny="delete_account"
      data-ahttp-confirm="checkout_submit"></script>
  </body></html>`
};

function createServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/authorize') {
        if (req.headers.authorization !== 'Bearer owner-token') {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          owner: 'acme',
          ttlSeconds: 60,
          policy: {
            allow: ['checkout_submit'],
            deny: ['delete_account'],
            confirm: ['checkout_submit']
          }
        }));
        return;
      }
      if (req.url === '/server-private') {
        const origin = 'http://127.0.0.1:' + server.address().port;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html><head><title>Server Console</title></head><body>
          <main>
            <h1>Server Console</h1>
            <button data-ahttp-intent="checkout_submit" onclick="document.getElementById('out').textContent='charged'">Charge card</button>
            <button data-ahttp-intent="delete_account" onclick="document.getElementById('out').textContent='deleted'">Delete account</button>
            <p id="out">idle</p>
          </main>
          <script src="ahttp.js" data-ahttp-owner="acme" data-ahttp-access="owner"
            data-ahttp-auth-endpoint="${origin}/authorize"></script>
        </body></html>`);
        return;
      }
      const body = PAGES[req.url] || PAGES['/'];
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: 'http://127.0.0.1:' + server.address().port + '/',
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function createClient(proc) {
  let buffer = '';
  const pending = new Map();
  let nextId = 1;
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (msg.id != null && pending.has(msg.id)) {
        const handlers = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) handlers.reject(new Error(JSON.stringify(msg.error)));
        else handlers.resolve(msg.result);
      }
    }
  });
  function call(method, params, timeout) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id, method: method, params: params }) + '\n');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error('timeout waiting for ' + method));
        }
      }, timeout || 20000);
    });
  }
  return { call };
}

async function runMcpTest(options) {
  const startedAt = Date.now();
  const server = await createServer();
  const proc = spawn(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'ahttp-mcp.js'), '--allow-private'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '';
  proc.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  let ownerProc = null;
  let authProc = null;
  const client = createClient(proc);
  const checks = [];
  function ok(condition, name, actual) {
    checks.push({ name: name, pass: !!condition, actual: actual === undefined ? undefined : String(actual).slice(0, 200) });
    return !!condition;
  }
  try {
    const init = await client.call('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'ahttp-benchmark', version: pkg.version }
    });
    ok(init && init.serverInfo && init.serverInfo.name === 'ahttp-mcp', 'initialize handshake', init && init.serverInfo && init.serverInfo.name);
    ok(init && init.protocolVersion === '2025-11-25', 'protocol version negotiated', init && init.protocolVersion);
    ok(init && init.capabilities && !!init.capabilities.tools, 'tools capability advertised');

    const listed = await client.call('tools/list', {});
    const names = (listed.tools || []).map(function (t) { return t.name; });
    ok(names.length === 3, 'three tools listed', names.join(','));
    ok(names.indexOf('ahttp_open') >= 0 && names.indexOf('ahttp_snapshot') >= 0 && names.indexOf('ahttp_act') >= 0, 'tool names are correct', names.join(','));

    const opened = await client.call('tools/call', { name: 'ahttp_open', arguments: { url: server.url } });
    const openText = opened.content && opened.content[0] ? opened.content[0].text : '';
    ok(!opened.isError, 'ahttp_open succeeded');
    ok(/Checkout/.test(openText), 'snapshot contains page heading');
    ok(/^a\d+ input(?:\[[^\]]*\])? "Email"/m.test(openText), 'snapshot exposes the email input');
    ok(/\d+ sanitized/.test(openText), 'hidden prompt injection filtered in the MCP result');

    const emailId = (/^(a\d+) input(?:\[[^\]]*\])? "Email"/m.exec(openText) || [])[1];
    const filled = await client.call('tools/call', { name: 'ahttp_act', arguments: { id: emailId, value: 'agent@example.com' } });
    const fillText = filled.content && filled.content[0] ? filled.content[0].text : '';
    ok(!filled.isError, 'ahttp_act fill succeeded');
    ok(/agent@example\.com/.test(fillText), 'diff reports the new value', fillText.split('\n')[0]);

    const guardedId = (/^(a\d+) button "Delete account"/m.exec(openText) || [])[1];
    const blocked = await client.call('tools/call', { name: 'ahttp_act', arguments: { id: guardedId } });
    ok(blocked.isError === true, 'guarded action blocked over MCP');
    ok(/CONFIRMATION REQUIRED/.test(blocked.content[0].text), 'block response explains confirmation');

    const linkId = (/^(a\d+) a "Next page"/m.exec(openText) || [])[1];
    const navigated = await client.call('tools/call', { name: 'ahttp_act', arguments: { id: linkId } });
    const navText = navigated.content && navigated.content[0] ? navigated.content[0].text : '';
    ok(!navigated.isError, 'navigation action succeeded');
    ok(/Second page/.test(navText), 'new page snapshot returned after navigation');
    ok(/navigated to http/.test(navText), 'navigation recorded in the result');

    const afterNav = await client.call('tools/call', { name: 'ahttp_snapshot', arguments: {} });
    ok(!afterNav.isError && /Second page/.test(afterNav.content[0].text), 'ahttp_snapshot reads the current page');
    ok(!/ahttp-mcp .* ready/.test(openText), 'stdio stdout carries JSON-RPC only');

    const privateNoKey = await client.call('tools/call', { name: 'ahttp_open', arguments: { url: server.url + 'private' } });
    ok(privateNoKey.isError === true, 'private page requires an owner key over MCP');
    ok(/AUTHORIZATION REQUIRED/.test(privateNoKey.content[0].text), 'missing owner key error explains the gate');

    ownerProc = spawn(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'ahttp-mcp.js'), '--allow-private'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { AHTTP_OWNER_KEY: OWNER_KEY })
    });
    const ownerClient = createClient(ownerProc);
    const ownerInit = await ownerClient.call('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'ahttp-owner-benchmark', version: pkg.version }
    });
    ok(ownerInit && ownerInit.serverInfo && ownerInit.serverInfo.name === 'ahttp-mcp', 'owner-key MCP process initialized');
    const ownerOpen = await ownerClient.call('tools/call', { name: 'ahttp_open', arguments: { url: server.url + 'private' } });
    const ownerText = ownerOpen.content && ownerOpen.content[0] ? ownerOpen.content[0].text : '';
    ok(!ownerOpen.isError, 'owner key opens the private page');
    ok(/Owner Console/.test(ownerText), 'private snapshot contains allowed content');
    ok(!/Delete account/.test(ownerText), 'denied action is absent from the private snapshot');
    ok(/checkout_submit/.test(ownerText), 'allowed action is present in the private snapshot');
    const checkoutId = (/^(a\d+) button "checkout_submit"/m.exec(ownerText) || [])[1];
    const needConfirm = await ownerClient.call('tools/call', { name: 'ahttp_act', arguments: { id: checkoutId } });
    ok(needConfirm.isError === true && /CONFIRMATION REQUIRED/.test(needConfirm.content[0].text), 'policy confirmation enforced over MCP');
    const ownerToken = (/confirmationToken="([^"]+)"/.exec(needConfirm.content[0].text) || [])[1];
    ok(!!ownerToken, 'owner confirmation token issued');
    const confirmed = await ownerClient.call('tools/call', { name: 'ahttp_act', arguments: { id: checkoutId, confirmationToken: ownerToken } });
    ok(!confirmed.isError, 'confirmed owner action executed over MCP');
    const denied = await ownerClient.call('tools/call', { name: 'ahttp_act', arguments: { id: 'delete_account' } });
    ok(denied.isError === true && /policy_denied/.test(denied.content[0].text), 'denied intent rejected by name over MCP');

    const serverNoAuth = await client.call('tools/call', { name: 'ahttp_open', arguments: { url: server.url + 'server-private' } });
    ok(serverNoAuth.isError === true, 'server-auth page requires a token over MCP');
    ok(/AUTHORIZATION REQUIRED/.test(serverNoAuth.content[0].text), 'missing server token error explains the gate');

    authProc = spawn(process.execPath, [path.join(__dirname, '..', '..', 'bin', 'ahttp-mcp.js'), '--allow-private'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { AHTTP_AUTH_TOKEN: 'owner-token' })
    });
    const authClient = createClient(authProc);
    const authInit = await authClient.call('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'ahttp-server-auth-benchmark', version: pkg.version }
    });
    ok(authInit && authInit.serverInfo && authInit.serverInfo.name === 'ahttp-mcp', 'server-auth MCP process initialized');
    const authOpen = await authClient.call('tools/call', { name: 'ahttp_open', arguments: { url: server.url + 'server-private' } });
    const authText = authOpen.content && authOpen.content[0] ? authOpen.content[0].text : '';
    ok(!authOpen.isError, 'server token authorizes the page over MCP');
    ok(/Server Console/.test(authText), 'server-auth snapshot contains allowed content');
    ok(!/Delete account/.test(authText), 'server deny policy hides the dangerous action');
    const authCheckout = (/^(a\d+) button "checkout_submit"/m.exec(authText) || [])[1];
    const authConfirm = await authClient.call('tools/call', { name: 'ahttp_act', arguments: { id: authCheckout } });
    ok(authConfirm.isError === true && /CONFIRMATION REQUIRED/.test(authConfirm.content[0].text), 'server policy confirmation enforced over MCP');
    const authToken = (/confirmationToken="([^"]+)"/.exec(authConfirm.content[0].text) || [])[1];
    ok(!!authToken, 'server confirmation token issued');
    const authConfirmed = await authClient.call('tools/call', { name: 'ahttp_act', arguments: { id: authCheckout, confirmationToken: authToken } });
    ok(!authConfirmed.isError, 'confirmed server-authorized action executed over MCP');
  } catch (err) {
    ok(false, 'mcp test completed without exceptions', err && err.message);
  } finally {
    proc.kill();
    if (ownerProc) ownerProc.kill();
    if (authProc) authProc.kill();
    await server.close();
  }
  const passed = checks.filter(function (c) { return c.pass; }).length;
  return {
    pass: passed === checks.length,
    checks: checks,
    passed: passed,
    total: checks.length,
    ms: Date.now() - startedAt,
    stderr: stderr.trim().split('\n').filter(Boolean).slice(0, 3)
  };
}

module.exports = { runMcpTest };
