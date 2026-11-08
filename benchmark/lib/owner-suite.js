'use strict';

const crypto = require('crypto');
const { loadFixture, loadHtml, checker, json, text, findAction, byName } = require('./harness');

const OWNER_KEY = 'owner-secret';
const OWNER_HASH = crypto.createHash('sha256').update(OWNER_KEY).digest('hex');

function byIntent(snapshot, intent) {
  return findAction(snapshot, function (a) { return a.intent === intent; });
}

async function runOwnerTest() {
  const c = checker();
  const { aihttp, window: w } = loadFixture('10-owner-mode');

  c.ok(aihttp.hashKey(OWNER_KEY) === OWNER_HASH, 'hashKey matches Node SHA-256', aihttp.hashKey(OWNER_KEY));
  c.ok(w.__moCount === 0, 'no observer before any owner API call', w.__moCount);

  const lockedStatus = aihttp.status();
  c.ok(lockedStatus.mode === 'gate', 'static hash is detected as a soft gate, not owner auth', lockedStatus.mode);
  c.ok(lockedStatus.locked === true, 'page starts locked', lockedStatus.locked);
  c.ok(lockedStatus.state === 'dormant', 'locked page stays dormant', lockedStatus.state);
  c.ok(lockedStatus.owner === 'acme', 'owner id exposed without secrets', lockedStatus.owner);
  c.ok(!JSON.stringify(lockedStatus).includes(OWNER_HASH), 'status does not leak the key hash');
  c.ok(w.__moCount === 0, 'status did not wake the engine', w.__moCount);

  const lockedText = text(aihttp);
  c.ok(/gate_key_required/.test(lockedText), 'text snapshot reports gate_key_required');
  const gateAction = await aihttp.act('missing');
  c.ok(gateAction.locked === true && /static soft gate/.test(gateAction.message), 'gate action error labels the soft gate');
  c.ok(!/Charge card|Lookup order|Delete account|Acme Console/.test(lockedText), 'locked snapshot exposes no actions or content', lockedText.slice(0, 80));
  const lockedJson = json(aihttp);
  c.ok(lockedJson.locked === true && lockedJson.actions.length === 0, 'locked JSON has no actions');
  c.ok(w.__moCount === 0, 'locked snapshot did not wake the engine', w.__moCount);
  const lockedTools = aihttp.tools();
  c.ok(lockedTools.locked === true && lockedTools.tools.length === 0, 'locked tools() returns no schema');

  const wrong = aihttp.unlock('wrong-key');
  c.ok(wrong.ok === false && wrong.error === 'invalid_key', 'wrong owner key rejected');
  c.ok(w.__moCount === 0, 'failed unlock did not wake the engine', w.__moCount);

  const unlocked = aihttp.unlock(OWNER_KEY);
  c.ok(unlocked.ok === true && unlocked.locked === false, 'correct owner key unlocks');

  const snap = json(aihttp);
  c.ok(snap.locked === false, 'unlocked snapshot is readable');
  c.ok(w.__moCount >= 1, 'observer installed after unlock and first scan', w.__moCount);
  c.ok(snap.actions.length === 4, 'allow list limits the action surface', snap.actions.map(function (a) { return a.intent || a.label; }).join(' | '));
  c.ok(!!byIntent(snap, 'checkout_submit') && !!byIntent(snap, 'support_lookup'), 'allowed intents visible');
  c.ok(!byIntent(snap, 'delete_account'), 'deny wins even when the intent is also allowed');
  c.ok(!byIntent(snap, 'export_data'), 'actions outside the allow list are hidden');
  c.ok(snap.meta.policyHidden === 2, 'policy hidden count reported', snap.meta.policyHidden);
  c.ok(snap.meta.owner === 'acme', 'snapshot meta names the owner');
  const checkout = byIntent(snap, 'checkout_submit');
  c.ok(checkout.requiresConfirmation === true, 'policy confirm is exposed in JSON');
  c.ok(/Owner policy/.test(checkout.warning || ''), 'policy warning text present', checkout.warning);

  const tools = aihttp.tools();
  const toolIds = tools.tools[0].parameters.properties.id.enum;
  c.ok(toolIds.length === 4, 'tools schema contains only allowed ids', toolIds.length);
  c.ok(!!tools.tools[0].parameters.properties.confirm, 'tools schema adds confirm for policy-protected actions');

  const denied = await aihttp.act('delete_account', null, { settle: false });
  c.ok(denied.ok === false && denied.error === 'policy_denied', 'denied intent cannot be executed by name');
  c.ok(w.document.getElementById('r').textContent === 'idle', 'denied action did not run');

  const blocked = await aihttp.act(checkout.id, null, { settle: false });
  c.ok(blocked.ok === false && blocked.requiresConfirmation === true, 'policy confirm blocks without confirm flag');
  const allowed = await aihttp.act(checkout.id, null, { confirm: true, settle: false });
  c.ok(allowed.ok === true && w.document.getElementById('r').textContent === 'charged', 'confirmed policy action executes');

  const lookup = byIntent(json(aihttp), 'support_lookup');
  const lookedUp = await aihttp.act(lookup.id, null, { settle: false });
  c.ok(lookedUp.ok === true && w.document.getElementById('r').textContent === 'lookup', 'second allowed action executes');

  const note = byName(json(aihttp), 'note');
  c.ok(!!note, 'allow list can match a field by name');
  const filled = await aihttp.act(note.id, 'updated', { settle: false });
  c.ok(filled.ok === true && w.document.getElementById('note').value === 'updated', 'allowed field is writable');

  const policy = aihttp.configure({ readOnly: true });
  c.ok(policy.readOnly === true, 'configure switches the policy to read-only');
  c.ok(aihttp.status().locked === true, 'reconfiguring a private page relocks it');
  aihttp.unlock(OWNER_KEY);
  const roSnap = json(aihttp);
  c.ok(/read-only/.test(text(aihttp)), 'read-only policy is reported in the snapshot');
  const roNote = byName(roSnap, 'note');
  const writeBlocked = await aihttp.act(roNote.id, 'nope', { settle: false });
  c.ok(writeBlocked.ok === false && writeBlocked.error === 'policy_readonly', 'read-only policy blocks writes');
  const readAllowed = await aihttp.act(roNote.id, { read: true });
  c.ok(readAllowed.ok === true && readAllowed.value === 'updated', 'read-only policy allows reads');
  const link = byIntent(roSnap, 'docs_link');
  const linkAllowed = await aihttp.act(link.id, null, { settle: false });
  c.ok(linkAllowed.ok === true, 'read-only policy permits link navigation');

  const lockedAgain = aihttp.lock();
  c.ok(lockedAgain.locked === true && lockedAgain.state === 'dormant', 'lock() drops the runtime and relocks');
  c.ok(/gate_key_required/.test(text(aihttp)), 'snapshot is locked after lock()');
  c.ok(aihttp.unlock(OWNER_KEY).ok === true, 'unlock works again after lock()');

  const globalHtml = '<!doctype html><body><main><button data-aihttp-intent="ping" onclick="this.textContent=\'pong\'">Ping</button></main>' +
    '<script>window.__AIHTTP_CONFIG__ = { owner: "plain", private: true, key: "plain-key", allow: "ping" };</script></body>';
  const plain = loadHtml(globalHtml, 'http://127.0.0.1/');
  c.ok(plain.aihttp.status().locked === true, 'global config supports private mode');
  c.ok(plain.aihttp.unlock('plain-key').ok === true, 'plaintext key mode unlocks on localhost');
  c.ok(/[Pp]ing/.test(plain.aihttp.snapshot()), 'plaintext-key owner page serves actions');

  const prodPlain = loadHtml(globalHtml, 'https://plain-owner.test/');
  c.ok(prodPlain.aihttp.unlock('plain-key').error === 'insecure_key_rejected', 'plaintext keys are rejected outside localhost');

  const publicHtml = '<!doctype html><body><main><button data-aihttp-intent="ping">Ping</button></main>' +
    '<script src="aihttp.js" data-aihttp-access="public"></script></body>';
  const publicMode = loadHtml(publicHtml, 'https://public.test/');
  c.ok(publicMode.aihttp.status().mode === 'public' && publicMode.aihttp.status().locked === false, 'public access mode is open');
  c.ok(/ping/i.test(publicMode.aihttp.snapshot()), 'public access serves actions');

  const devHtml = '<!doctype html><body><main><button data-aihttp-intent="ping">Ping</button></main>' +
    '<script src="aihttp.js" data-aihttp-access="dev"></script></body>';
  const devProd = loadHtml(devHtml, 'https://dev-prod.test/');
  c.ok(devProd.aihttp.status().mode === 'dev' && devProd.aihttp.status().locked === true, 'dev access is locked outside localhost');
  c.ok(devProd.aihttp.snapshot({ format: 'json' }).error === 'dev_only', 'dev-only lock reports the reason');
  const devLocal = loadHtml(devHtml, 'http://127.0.0.1/');
  c.ok(devLocal.aihttp.status().locked === false, 'dev access is open on localhost');
  c.ok(/ping/i.test(devLocal.aihttp.snapshot()), 'dev access serves actions locally');

  const server = loadFixture('12-server-auth');
  const shttp = server.aihttp;
  const sw = server.window;
  c.ok(shttp.status().mode === 'owner' && shttp.status().policy.serverAuth === true, 'server auth mode detected');
  c.ok(shttp.status().serverVerified === false, 'server session is not verified before authorize');
  c.ok(shttp.unlock('anything').error === 'server_auth_required', 'unlock refuses when server auth is configured');

  let lastAuth = null;
  sw.fetch = async function (url, init) {
    lastAuth = { url: String(url), init: init };
    if (!init || !init.headers || init.headers.authorization !== 'Bearer owner-token') {
      return { ok: false, status: 401, text: async function () { return ''; } };
    }
    return {
      ok: true,
      status: 200,
      text: async function () {
        return JSON.stringify({
          ok: true,
          owner: 'acme',
          ttlSeconds: 1,
          policy: {
            allow: ['checkout_submit'],
            deny: ['delete_account'],
            confirm: ['checkout_submit'],
            maxActions: 5
          }
        });
      }
    };
  };

  const serverDenied = await shttp.authorize({ token: 'wrong' });
  c.ok(serverDenied.ok === false && serverDenied.error === 'server_denied', 'server rejects an invalid token');
  c.ok(shttp.status().locked === true, 'failed server auth stays locked');

  const sAuth = await shttp.authorize({ token: 'owner-token' });
  c.ok(sAuth.ok === true && sAuth.mode === 'server', 'server token authorizes the page');
  c.ok(lastAuth && lastAuth.init.credentials === 'omit', 'a cross-origin auth endpoint does not receive cookies');
  c.ok(lastAuth && lastAuth.init.headers.authorization === 'Bearer owner-token', 'bearer token sent only to the auth endpoint');

  // Same-origin auth keeps cookie sessions working: the origin check only
  // strips cookies when the endpoint lives somewhere else.
  const sameOrigin = loadHtml('<!doctype html><body><main><button data-aihttp-intent="checkout_submit">Pay</button></main>' +
    '<script data-aihttp-access="owner" data-aihttp-auth-endpoint="/api/aihttp/authorize"></script></body>',
  'https://same-origin.test/');
  let sameInit = null;
  sameOrigin.window.fetch = async function (url, init) {
    sameInit = init;
    return { ok: true, status: 200, text: async function () { return JSON.stringify({ ok: true, policy: { allow: ['checkout_submit'] } }); } };
  };
  const sameAuth = await sameOrigin.aihttp.authorize({ token: 'owner-token' });
  c.ok(sameAuth.ok === true, 'a same-origin auth endpoint authorizes');
  c.ok(sameInit && sameInit.credentials === 'include', 'a same-origin auth endpoint receives cookies');
  try { sameOrigin.window.close(); } catch (e) {}
  const sStatus = shttp.status();
  c.ok(sStatus.serverVerified === true && sStatus.authMode === 'server', 'status reports a verified server session');
  c.ok(sStatus.authExpiresAt > Date.now(), 'short-lived session expiry recorded');
  c.ok(!JSON.stringify(sStatus).includes('owner-token'), 'status does not leak the auth token');

  const sSnap = json(shttp);
  c.ok(sSnap.actions.length === 1 && sSnap.actions[0].intent === 'checkout_submit', 'server policy limits the action surface', sSnap.actions.map(function (a) { return a.intent; }).join(','));
  c.ok(sSnap.actions[0].requiresConfirmation === true, 'server policy confirmation applied');
  c.ok(!JSON.stringify(sSnap).includes('owner-token'), 'snapshot does not leak the auth token');

  shttp.configure({
    authorizeAction: async function (action) {
      if (action.intent === 'checkout_submit') return { ok: false, reason: 'backend denies this action' };
      return true;
    }
  });
  c.ok(shttp.status().locked === true, 'configure relocks the page');
  await shttp.authorize({ token: 'owner-token' });
  const hookSnap = json(shttp);
  const hookAction = findAction(hookSnap, function (a) { return a.intent === 'checkout_submit'; });
  const blockedByHook = await shttp.act(hookAction.id, null, { confirm: true, settle: false });
  c.ok(blockedByHook.ok === false && blockedByHook.error === 'unauthorized', 'authorizeAction hook blocks the mutation', blockedByHook.reason);

  const expiryPage = loadFixture('12-server-auth');
  expiryPage.window.fetch = async function () {
    return {
      ok: true,
      status: 200,
      text: async function () {
        return JSON.stringify({ ok: true, ttlSeconds: 0.25, policy: { allow: ['checkout_submit'] } });
      }
    };
  };
  const expiryAuth = await expiryPage.aihttp.authorize({ token: 'owner-token' });
  c.ok(expiryAuth.ok === true, 'short ttl session authorized');
  await new Promise(function (resolve) { setTimeout(resolve, 400); });
  c.ok(expiryPage.aihttp.status().locked === true, 'expired server session relocks the page');
  c.ok(expiryPage.aihttp.snapshot({ format: 'json' }).error === 'server_auth_required', 'expired session reports server_auth_required');

  const insecureHtml = '<!doctype html><body><main><button>Ping</button></main>' +
    '<script src="aihttp.js" data-aihttp-access="owner" data-aihttp-auth-endpoint="http://evil.test/authorize"></script></body>';
  const insecure = loadHtml(insecureHtml, 'https://insecure.test/');
  const insecureResult = await insecure.aihttp.authorize({ token: 'x' });
  c.ok(insecureResult.error === 'insecure_auth_endpoint', 'non-TLS auth endpoints are rejected', JSON.stringify(insecureResult));

  const publicPage = loadFixture('01-react-store');
  c.ok(publicPage.aihttp.status().mode === 'public' && publicPage.aihttp.status().locked === false, 'pages without config stay public');

  return c.checks;
}

module.exports = { runOwnerTest, OWNER_KEY, OWNER_HASH };
