# API reference

The browser file exposes one global, `ahttp`. It is a UMD build; `require('ahttp')` also works in Node. The API is pre-1.0.

## `ahttp.snapshot(options)`

Returns a text action graph by default, or a JSON object with `format: 'json'`.

| Option | Default | Meaning |
|---|---|---|
| `format` | `text` | `text` or `json` |
| `scope` | all | `main`, `chrome`, `modal`, `all`, or a CSS selector |
| `query` | none | Case-insensitive filter over label, name, placeholder, href, value |
| `maxActions` | 60 | Action cap; policy caps still apply |
| `maxText` | 1400 | Visible text character cap |
| `includeText` | true | `false` removes all page text |
| `interactiveOnly` | false | Keep actions only |
| `force` | false | Ignore the fresh scan cache |
| `group` | true | Fold repeated link families |
| `compact` | false | Drop placeholder, value and state suffixes |
| `verbose` | false | Add scan diagnostics to the text meta line |

Text output starts with `ahttp | title | URL`. URLs longer than 72 characters are shortened to the origin (or `file:`) plus the last two path segments; `verbose` restores the full URL in the meta line. Actions are printed as `a1 button "Label"` with no brackets, one per line; the default text input prints as `a1 input "Label"`, while other types keep `input[email]`, `input[password]` and so on. `[modal]`, `[main]` and `[nav]` headers appear only when more than one region has actions, or when the only region is not `main`. Page text follows `[text: untrusted]`, one entry per line, with a line identical to the page title dropped. A `[meta]` line is emitted only when actions were capped, nodes were sanitized, the page is owned or locked, or `verbose` is set; `verbose` also adds forms, controls, nodes, layout, scan time and the version.

```js
ahttp.snapshot({ maxActions: 40, maxText: 600 });
ahttp.snapshot({ format: 'json', includeText: false });
```

The JSON shape contains `version`, `url`, `title`, `locked`, `owner`, `modal`, `layout`, `regions`, `actions`, `text`, `textTrust: 'untrusted'`, and `meta`. The `meta.tokens` field is the engine's `ceil(chars / 4)` estimate, not a model tokenizer.

## `ahttp.act(id, payload, options)`

Returns a promise. `payload` can be a string for a fill, or an object:

| Payload | Meaning |
|---|---|
| `value` | Fill text or select option value/label |
| `checked` | Toggle target state |
| `read` | Read the value without mutation |
| `key` | Dispatch a keyboard key (Enter, Escape, Tab, arrows, space) |
| `hover` | Dispatch pointer/mouse hover |
| `scroll` | Scroll the target into view |
| `confirm` | Accept a guarded action |
| `targetHint` | Diagnostic text echoed in an `ambiguous` reply; never a selector |
| `expect` | Post-action expectation; unmet rules return `status: 'no_effect'` |
| `settle` | Override the settle flag |
| `timeout` | Settle timeout in ms |
| `quiet` | Quiet window in ms (default 40, or `networkQuiet` when a request was observed) |
| `minWait` | Minimum settle time in ms (default 40) |
| `networkQuiet` | Quiet window after a request was observed (default 220) |
| `diff` | `false` disables the diff |
| `snapshot` | `false` disables the fresh snapshot |
| `maxActions` | Snapshot action cap |

```js
await ahttp.act('a4');
await ahttp.act('a1', 'agent@example.com');
await ahttp.act('a1', { value: 'US' });
await ahttp.act('a2', { checked: true });
await ahttp.act('a5', { key: 'Enter' });
await ahttp.act('a2', null, { confirm: true });
await ahttp.act('a3', { read: true });
```

Result shape:

```js
{
  ok: true,
  status: 'ok',
  action: { id: 'a4', method: 'click', kind: 'click', label: 'Place order' },
  method: 'click',
  url: 'https://shop.test/checkout',
  latencyMs: 231,
  diff: {
    added: [], removed: [], changed: [],
    textAdded: [], textRemoved: [], modal: null, url: null,
    summary: '...', text: '...'
  },
  snapshot: '...',
  snapshotMeta: { chars: 1200, tokens: 300 },
  meta: { mutations: 2, requests: 1, settleMs: 231 }
}
```

`status` is additive: `ok`, `ambiguous`, `not_found`,
`requires_confirmation`, `blocked`, `locked`, `error`, and `no_effect` when an
`expect` rule is supplied and the expected change did not happen.

When a framework replaced the node, `act` relocates it by stable anchors. If the
old id now matches two controls within the ambiguity margin, no event is
dispatched and the reply is structured. When the id itself is not in the
registry, `act` also accepts an intent or a visible label; a lookup that matches
more than one action returns the same `ambiguous` shape instead of clicking the
first one:

```js
{
  ok: false,
  status: 'ambiguous',
  error: 'ambiguous',
  id: 'a3',
  action: { id: 'a3', method: 'click', kind: 'click', label: 'OK' },
  targetHint: 'first OK button',
  candidates: [
    { id: 'a7', role: 'button', name: 'OK', tag: 'button', score: 89, signals: ['name', 'role', 'tag'], disabled: false },
    { id: 'a8', role: 'button', name: 'OK', tag: 'button', score: 89, signals: ['name', 'role', 'tag'], disabled: false }
  ],
  thresholds: { accept: 50, ambiguous: 24, margin: 12 },
  warning: 'Multiple controls match this target; no action was taken.'
}
```

`confirm: true` does not override `ambiguous`. See
[docs/MATCHING.md](MATCHING.md) for the signal weights and thresholds.

### Post-action expectation

An optional `expect` object checks that the action had the intended effect. The
action still runs; if the check fails, the result keeps `ok: true` but reports
`status: 'no_effect'` and `effect.failures`:

```js
const result = await ahttp.act('a2', {
  expect: { diff: true, textAdded: ['Added to cart'], pageText: { selector: '#cart', includes: ['1 item'] } }
});
// { ok: true, status: 'no_effect', warning: '...', effect: { ok: false, failures: [...] } }
```

| Expect key | Meaning |
|---|---|
| `diff` | `true` requires a non-empty diff; `false` requires an empty one |
| `empty` | Same as `diff`, explicit form |
| `textAdded` / `textRemoved` | Substrings in the diff text arrays |
| `added` / `removed` | Substrings in the labels of added/removed actions |
| `diffContains` | Substrings in `diff.text` |
| `urlChanged` | Require a URL change (or its absence) |
| `snapshotContains` | Substrings in the returned snapshot |
| `pageText` | `{ selector, equals }` or `{ selector, includes }` on the live DOM |

`no_effect` means "the match was executed but the page did not react as the
caller expected". Re-snapshot before retrying; do not replay the same click.

While an `expect` rule is unmet, `act` keeps re-checking (every 30 ms) until it
holds or `timeout` (default 1200 ms, counted from the click) runs out. A change
that arrives 100-400 ms after the quiet window, such as a timer or a debounced
handler, is reported as `ok`. The cost is on the failure path only: a change
that never comes returns `no_effect` after the full timeout instead of after the
short settle. Pass a smaller `timeout` to fail faster; `settle: false` skips the
wait entirely.

Errors are returned, not thrown:

```js
{ ok: false, error: 'unknown_action', id: 'a99', status: 'not_found' }
{ ok: false, error: 'detached_action', status: 'not_found' }
{ ok: false, error: 'ambiguous', status: 'ambiguous', candidates: [ ... ] }
{ ok: false, blocked: true, error: 'policy_denied', status: 'blocked' }
{ ok: false, blocked: true, requiresConfirmation: true, warning: '...', status: 'requires_confirmation' }
{ ok: false, blocked: true, error: 'policy_readonly', status: 'blocked' }
{ ok: false, blocked: true, error: 'readonly', value: 'ACC-777', status: 'blocked' }
{ ok: false, blocked: true, error: 'disabled', status: 'blocked' }
{ ok: false, blocked: true, error: 'unauthorized', status: 'blocked' }
```

## `ahttp.tools()`

Returns a schema for OpenAI/Anthropic-style function calling:

```js
{
  version: '0.1.0',
  url: '...',
  generatedAt: '...',
  tools: [{ name: 'ahttp_act', description: '...', parameters: { ... } }],
  actions: [{ id: 'a1', label: 'Pay', kind: 'click', role: 'button', region: 'main' }],
  snapshotMeta: { ... }
}
```

The `id` enum is the current screen. `confirm` is added only when at least one visible action requires confirmation. The schema is a snapshot; re-read it after a mutation.

## `ahttp.status()`

Does not wake the engine.

```js
{
  state: 'dormant',
  dormant: true,
  version: '0.1.0',
  mode: 'public',
  access: 'public',
  locked: false,
  lockedReason: null,
  owner: null,
  authMode: 'none',
  authExpiresAt: null,
  serverVerified: false,
  warnings: [],
  policy: null,
  engine: 'idle',
  overhead: 'not measured',
  actions: 0,
  nodes: 0,
  sanitized: 0
}
```

When active, it also reports `layout`, `forms`, `ignored`, `policyHidden`, `observers`, `network`, `scanMs`, `lastLatencyMs`, and `uptimeMs`.

Locked examples:

```js
// gate
{ mode: 'gate', access: 'gate', locked: true, lockedReason: 'gate_key_required',
  warnings: ['client_side_gate_only', 'soft_gate_only'] }

// owner with an endpoint
{ mode: 'owner', access: 'owner', locked: true, lockedReason: 'server_auth_required',
  authMode: 'server', serverVerified: false, policy: { serverAuth: true } }

// dev outside localhost
{ mode: 'dev', access: 'dev', locked: true, lockedReason: 'dev_only' }
```

## `ahttp.configure(options)`

Merges a configuration, resets the runtime, and re-evaluates the lock. Options: `owner`, `access` (`public`, `dev`, `gate`, `owner`), `private`, `key`, `keyHash`, `authEndpoint`, `authTimeoutMs`, `authorizeAction`, `allow`, `deny`, `confirm`, `readOnly`, `maxActions`.

```js
ahttp.configure({
  access: 'owner',
  owner: 'acme',
  authEndpoint: '/api/ahttp/authorize',
  allow: ['checkout_submit'],
  confirm: ['checkout_submit']
});
await ahttp.authorize({ token: process.env.AHTTP_AUTH_TOKEN });
```

The returned policy summary never includes keys, tokens, or hashes. `authorizeAction` is called before each mutation and can return `false`, `{ ok: false }`, or throw to block the action. The server that performs the mutation must still authorize it.

## `ahttp.authorize(options)`

Uses the configured `authEndpoint`. Sends a POST with `credentials: 'include'` and an optional `Authorization: Bearer <token>` header. Accepts HTTPS, or HTTP on localhost. Rejects URL credentials. Caps the response at 65,536 characters. Applies the returned policy and relocks at `expiresAt`.

```js
await ahttp.authorize({ token: 'short-lived-token' });
// { ok: true, locked: false, mode: 'server', owner: 'acme', expiresAt: 1760000000000 }
```

Errors: `invalid_auth_endpoint`, `insecure_auth_endpoint`, `fetch_unavailable`, `server_denied`, `server_response_too_large`, `auth_request_failed`.

## `ahttp.unlock(key)` and `ahttp.lock()`

`unlock` compares the key with `keyHash` using SHA-256 and a constant-time comparison. Plaintext keys are accepted only on localhost or `file:`. Five failures trigger a client-side delay.

```js
ahttp.unlock('owner-secret');
// { ok: true, locked: false, mode: 'key', owner: 'acme' }
ahttp.lock();
```

`lock()` drops the scan and observer and returns to a locked dormant state. It is not a server-side logout; call your backend logout as well.

## `ahttp.installWebMCP(options)`

Opt-in adapter for the draft WebMCP API. It feature-detects `document.modelContext`, registers `ahttp_snapshot` and `ahttp_act`, and returns a `close()` function that aborts the registration signal. It does not auto-register and does not claim the draft is stable.

```js
const installed = await ahttp.installWebMCP();
// { ok: true, names: ['ahttp_snapshot', 'ahttp_act'], close: [Function] }
// or { ok: false, error: 'webmcp_unavailable' }
```

Tools get `readOnlyHint` for snapshots, `untrustedContentHint` for page content, and `consequentialHint` for actions. The guarded-action `confirm` argument is still a model-controlled flag in this adapter; the MCP server's one-time token flow is stronger.

## `ahttp.hashKey(value)`

Returns the SHA-256 hex for `data-ahttp-key-hash`. Also available through `node bin/ahttp-cli.js --hash-key <value>`.

## `ahttp.sleep()`

Disconnects the observer, restores patched `fetch` and `XMLHttpRequest`, clears the registry, and forgets the runtime. The next API call reads the page configuration again.

## `ahttp.wake()`

Wakes the engine and returns `status()`. It does not scan the DOM; the first snapshot does.

## Promise and browser injection

`act` and `authorize` return promises. `snapshot`, `status`, `tools`, `unlock`, `lock`, `hashKey`, `sleep`, and `wake` are synchronous in the browser engine. The Node browser wrapper (`lib/browser.js`) exposes async versions of all of them because each call crosses the Playwright page boundary.

## MCP result notes

- Static backend: `ahttp_open` returns a snapshot and a `pageId`. SPAs need `--browser`.
- Legacy clients may omit `pageId`; modern `2026-07-28` clients must include it.
- `ahttp_act` returns a `confirmationToken` for guarded actions and does not execute them. Repeat with the token.
- Tool results use standard MCP `content`/`isError`; invalid arguments and unknown tools use JSON-RPC errors.
