# Owner mode

ahttp has four access modes. `public` exposes the action graph to any agent. `dev` exposes it only on localhost. `gate` hides it behind a static hash. `owner` keeps it closed until the site owner's agent receives a server-verified session.

The static hash is a soft gate, not authentication. The server-verified flow is the only one intended for sensitive production actions.

A client-side gate cannot stop a determined visitor. The browser already has the page, and the backend must authorize every sensitive mutation. `docs/SECURITY.md` covers the full threat model.

## Access modes

```html
<script src="ahttp.min.js" data-ahttp-access="public"></script>
<script src="ahttp.min.js" data-ahttp-access="dev"></script>
<script src="ahttp.min.js" data-ahttp-access="gate"
        data-ahttp-key-hash="<sha256>"></script>
<script src="ahttp.min.js" data-ahttp-access="owner"
        data-ahttp-auth-endpoint="/api/ahttp/authorize"></script>
```

| Mode | Behavior |
|---|---|
| `public` | Any agent can use the graph, subject to the optional policy |
| `dev` | Open only on localhost, 127.0.0.1, ::1, or `file:`; otherwise `dev_only` |
| `gate` | Locked until the static key hash is accepted; not authentication |
| `owner` | Locked until the server-verified session is accepted |

`data-ahttp-private="true"` is the legacy alias. With a key or key hash it maps to `gate`; with an auth endpoint it maps to `owner`.

## Server-verified access

This is the production flow. The page contains no secret, only the endpoint.

```html
<script src="ahttp.min.js"
        data-ahttp-access="owner"
        data-ahttp-auth-endpoint="https://example.com/api/ahttp/authorize"></script>
```

```js
await page.evaluate(() => window.ahttp.authorize({ token: process.env.AHTTP_AUTH_TOKEN }));
// { ok: true, locked: false, mode: 'server', owner: 'acme', expiresAt: 1760000000000 }
```

```bash
AHTTP_AUTH_TOKEN='short-lived-token' node bin/ahttp-mcp.js
node bin/ahttp-cli.js https://example.com --auth-token 'short-lived-token'
```

The endpoint receives a POST with `credentials: 'include'` and an optional bearer token. It must authenticate the agent and return a short-lived policy. The engine accepts only HTTPS, or HTTP on localhost, rejects URL credentials, caps the response at 65,536 characters, applies the policy, and relocks at `expiresAt`.

The endpoint contract and server checklist are in `docs/SECURITY.md`.

## Static hash gate

This flow is for local tooling, internal documentation, or cases where the goal is to keep casual agents away. It is not a security boundary.

```html
<script src="ahttp.min.js"
        data-ahttp-access="gate"
        data-ahttp-key-hash="03f99ad2bb8f470ab4a6b65dd51dca8f63c4a36d52a66b22d706c14dbfec5983"
        data-ahttp-allow="checkout_submit,support_lookup"
        data-ahttp-deny="delete_account"
        data-ahttp-confirm="checkout_submit"></script>
```

The page loads locked. No observer is installed, no DOM is walked, and no actions or page text are returned by `ahttp.snapshot()` or `ahttp.tools()` until the key is verified.

Generate the hash instead of writing it by hand:

```bash
node bin/ahttp-cli.js --hash-key 'owner-secret'
# 03f99ad2bb8f470ab4a6b65dd51dca8f63c4a36d52a66b22d706c14dbfec5983
```

`ahttp.hashKey('owner-secret')` returns the same value in the browser.

## Unlock from the agent

MCP server:

```bash
AHTTP_OWNER_KEY='owner-secret' node bin/ahttp-mcp.js
```

CLI:

```bash
node bin/ahttp-cli.js https://example.com --unlock 'owner-secret'
# or
AHTTP_OWNER_KEY='owner-secret' node bin/ahttp-cli.js https://example.com
```

Playwright or Puppeteer:

```js
await page.addScriptTag({ content: engine });
await page.evaluate((key) => window.ahttp.unlock(key), process.env.AHTTP_OWNER_KEY);
const snapshot = await page.evaluate(() => window.ahttp.snapshot({ maxActions: 60 }));
```

Programmatic:

```js
ahttp.unlock('owner-secret');
// { ok: true, locked: false, mode: 'key', owner: 'acme' }
```

Wrong key:

```js
ahttp.unlock('nope');
// { ok: false, locked: true, error: 'invalid_key', owner: 'acme' }
```

The page can be locked again with `ahttp.lock()`. `ahttp.sleep()` also drops the runtime and forgets the configuration; the next call re-reads the page configuration and locks again.

## Configuration sources

Owner mode can be configured in three ways, in priority order:

1. `ahttp.configure(options)` at runtime.
2. `window.__AHTTP_CONFIG__` set before the ahttp script loads.
3. `data-ahttp-*` attributes on the ahttp `<script>` element.

`ensureConfig()` reads the script attributes once, on the first ahttp API call, if `document.currentScript` was not available at load. It does not run during page load.

### Script attributes

| Attribute | Meaning |
|---|---|
| `data-ahttp-owner` | Owner identifier shown in snapshots and status |
| `data-ahttp-access` | `public`, `dev`, `gate`, or `owner` |
| `data-ahttp-private` | Legacy alias; with a key it maps to `gate`, with an endpoint to `owner` |
| `data-ahttp-key-hash` | SHA-256 hex of the static gate key |
| `data-ahttp-key` | Plaintext key for localhost only; rejected elsewhere |
| `data-ahttp-auth-endpoint` | Server authorization endpoint; preferred |
| `data-ahttp-auth-origins` | Comma-separated origins allowed for a cross-origin auth endpoint; same-origin is always allowed. Cross-origin requests omit cookies |
| `data-ahttp-auth-timeout` | Authorization request timeout, 1000 to 60000 ms |
| `data-ahttp-allow` | Comma-separated allow list |
| `data-ahttp-deny` | Comma-separated deny list; wins over allow |
| `data-ahttp-confirm` | Comma-separated actions that require `{ confirm: true }` |
| `data-ahttp-readonly` | Presence enables read-only policy |
| `data-ahttp-max-actions` | Hard cap on snapshot actions |

### Options object

```js
ahttp.configure({
  access: 'owner',
  owner: 'acme',
  authEndpoint: '/api/ahttp/authorize',
  authOrigins: ['https://auth.example.com'],
  authTimeoutMs: 10000,
  allow: ['checkout_submit', 'support_lookup'],
  deny: ['delete_account'],
  confirm: ['checkout_submit'],
  readOnly: false,
  maxActions: 25,
  authorizeAction: async (action) => checkWithBackend(action)
});
```

`configure` merges into the current configuration, resets the runtime, and re-evaluates the lock. Call `authorize` or `unlock` again after changing the policy.

## Policy matching

Policy entries are matched against an action's `intent`, `label`, `name`, `data-testid`, and short id. Matching is case-insensitive. `*` is a wildcard.

```html
<button data-ahttp-intent="checkout_submit">Pay</button>
<button data-ahttp-intent="delete_account">Delete</button>
```

- `allow` non-empty: only matching actions appear in snapshots, tools, and `act`.
- `deny`: matching actions are removed even if they are also in `allow`.
- `confirm`: matching actions return `requiresConfirmation: true` in snapshots and block `act` until `{ confirm: true }`.
- `readOnly`: reads, hover, scroll, and link navigation are allowed; every other action returns `policy_readonly`.
- `maxActions`: the policy cap is applied even when a caller asks for more actions.

Use `data-ahttp-intent` for the policy. Labels and names are convenient, but visible text changes more often.

`policy_denied` example:

```js
await ahttp.act('delete_account');
// { ok: false, blocked: true, error: 'policy_denied', ... }
```

## Locked responses

Text snapshot:

```
ahttp 0.1.0 | gate-locked | owner=acme
[LOCKED] gate_key_required
This page exposes no actions until authorization succeeds.
```

JSON snapshot:

```json
{
  "version": "0.1.0",
  "locked": true,
  "access": "owner",
  "owner": "acme",
  "error": "server_auth_required",
  "actions": [],
  "text": [],
  "meta": { "locked": true, "access": "owner", "owner": "acme", "actions": 0 }
}
```

`ahttp.status()` while locked:

```json
{
  "state": "dormant",
  "locked": true,
  "lockedReason": "server_auth_required",
  "owner": "acme",
  "mode": "owner",
  "access": "owner",
  "authMode": "server",
  "authExpiresAt": null,
  "serverVerified": false,
  "warnings": [],
  "engine": "idle",
  "actions": 0,
  "nodes": 0,
  "policy": { "access": "owner", "serverAuth": true, "allow": ["checkout_submit"] }
}
```

The key, the token, the hash, and derived values are never included in snapshots or status.

## Read-only policy

`readOnly` is intended for inspection agents. It allows:

- `ahttp.act(id, { read: true })`
- `hover` and `scroll`
- clicks on `role="link"` actions

It blocks fills, selects, toggles, keyboard events, and button clicks:

```js
await ahttp.act(noteId, 'new value');
// { ok: false, blocked: true, error: 'policy_readonly' }
```

## Trust boundary

A client-side gate coordinates agents. It does not authorize data changes. The static hash flow is for non-sensitive pages; the server-verified flow keeps secrets off the page, but the backend still owns every authorization decision.

For production:

1. Use `data-ahttp-auth-endpoint` and authenticate the agent on the server.
2. Keep signing keys and session secrets on the server. The page contains only the endpoint URL.
3. Issue short-lived tokens bound to the agent, tenant, and origin. Revoke on logout.
4. Build the policy server-side per user or per tenant. Deny dangerous intents by default.
5. Authorize every mutation again in the endpoint that performs it. `ahttp.act` is a client request, not proof of permission.
6. Treat `data-ahttp-confirm`, `readOnly`, and `authorizeAction` as coordination with the agent, not as a server authorization check.
7. Apply your existing web security program to the page and APIs.
8. Read `docs/SECURITY.md` for the deployment requirements.

## Rotation

For the static gate, change `data-ahttp-key-hash` and redeploy. For server auth, rotate the signing key and revoke sessions. Already unlocked tabs keep their in-memory state until reload, expiry, or `ahttp.lock()`. Call `ahttp.lock()` from your app after logout if the same page is reused.
