# Architecture

This file is the map used for the matching-stability work (branch
`feat/matching-stability`). It describes the shipped code, not a future design.

## Runtime shape

`ahttp` is a UMD file with no runtime dependencies. Node `require('ahttp')` and
`<script src="ahttp.min.js">` load the same engine. The engine scans the current
document, assigns short ids, renders a compact snapshot, and executes an action
by id.

```text
ahttp.js                    engine: scan, snapshot, act, diff, policy, auth
ahttp.min.js                terser build of ahttp.js (generated)
self/panel.js               userscript panel UI
self/ahttp.user.js          generated: userscript header + ahttp.min.js + panel
bin/ahttp-cli.js            fetch a page, parse it, print a snapshot
bin/ahttp-mcp.js            JSON-RPC 2.0 stdio server, 3 tools
lib/page.js                 fetch + stylesheet inlining + mini-dom attach
lib/mini-dom.js             small DOM implementation for the static backend
lib/browser.js              Playwright/CDP page wrapper (async mirror of API)
lib/page-registry.js        pageId registry for MCP
lib/net-guard.js            SSRF/private-address guard for the static fetch
lib/user-agent.js           package version in the User-Agent
benchmark/                  token/time/task benchmarks and pinned pages
test/                       node:test suites (jsdom plus one Playwright suite)
docs/                       API, security, decisions, research, roadmap
```

## Engine pipeline

1. `wake()` resolves the page window/document and installs the observer.
2. `ensureScan(force)` returns a fresh scan (250 ms cache while observing).
3. `scanDOM()` walks from the modal root, or `body`:
   - `hiddenReason()` drops `display:none`, `visibility:hidden`, zero-size,
     off-screen, `aria-hidden` and closed `<dialog>` subtrees. A native
     checkbox/radio hidden only by soft heuristics is kept when a visible label
     names it (`recoverableToggle()`), so custom switches remain operable. An
     `aria-label`-only control is kept only with real layout, a box of at least
     12x12 px inside the page, and opacity as the only hide mechanism.
   - `classify()` maps native controls and ARIA roles to `kind`
     (`click`, `fill`, `select`, `toggle`, `file`).
   - `register()` stores the id and internal fields on an entry, including
     `label` (accessible-name subset), `name`, `domId`, `intent`, `testid`,
     `href`, `placeholder`, `role`, `path` and `fingerprint`.
4. `buildSnapshot()` filters by scope/query/policy, caps actions, folds large
   link families, renders text or JSON, and prefixes page text with
   `[text: untrusted]`.
5. `act(id, payload, options)` resolves the id, applies policy and confirmation,
   dispatches the event, waits for the DOM/network to settle, rescans, and
   returns a diff plus a fresh snapshot.

## Ids and relocation

Ids are assigned in DOM order (`a1`, `a2`, ...) by `S.seq`. While the DOM is
unchanged, `S.byNode` reuses the same entry, so repeated snapshots return the
same ids.

When the stored node is disconnected (React and similar re-renders),
`resolveEntry(id)` calls `relocate(entry)`:

- the engine rescans and scores every connected registered candidate against
  the old entry;
- a candidate above `MATCH.accept` and clearly ahead of the second candidate is
  bound to the old id;
- ids already printed to an agent stay usable;
- disabled candidates and candidates with a different `kind` are rejected;
- a near-tie returns a structured `ambiguous` reply instead of guessing.

Weights and thresholds are in `MATCH` at the top of `ahttp.js` and explained in
[docs/MATCHING.md](MATCHING.md).

## Snapshot format

Text: first line `ahttp | title | url`, then one action per line
(`a2 button "Add to cart"`), then `[text: untrusted]` and text lines. Optional
suffixes: `val=`, `ph=`, `opts=`, `checked`/`unchecked`, `disabled`, `readonly`,
`required`, `-> href`, `confirm=`. Region headers appear only when actions span
regions. `[meta]` appears only when capped/sanitized/locked/verbose.

JSON: `{ version, url, title, locked, owner, modal, layout, regions, actions,
text, textTrust: 'untrusted', meta }`. An action is `{ id, tag, role, kind,
label, region }` plus optional `type`, `name`, `href`, `placeholder`, `value`,
`checked`, `options`, `optionCount`, `required`, `disabled`, `readonly`,
`editable`, `intent`, `requiresConfirmation`, `warning`.

Page text and all page-derived strings are untrusted data, not instructions.

## Action result and diff

```js
{
  ok: true,
  action: { id: 'a4', method: 'click', kind: 'click', label: 'Place order' },
  method: 'click',
  url: '...',
  latencyMs: 231,
  diff: {
    added: [], removed: [], changed: [],
    textAdded: [], textRemoved: [], modal: null, url: null,
    empty: false, summary: '...', text: '...'
  },
  snapshot: '...',
  snapshotMeta: { chars: 214, tokens: 54 },
  meta: { mutations: 2, requests: 1, settleMs: 231 }
}
```

`diffStates()` compares actions by family/kind/label/name/type and text lines by
exact value; URL and modal changes are separate fields. Errors are returned, not
thrown (`unknown_action`, `detached_action`, `policy_denied`, `disabled`,
`readonly`, `requiresConfirmation`, ...).

The compatibility rule for this branch: existing fields and error codes stay.
`status`, `candidates` and `effect` are additive fields. If a change cannot stay
additive, it needs a version bump and a README "Breaking changes" section.

## Public API

Browser/Node engine: `snapshot(options)`, `act(id, payload, options)`,
`tools()`, `status()`, `configure(options)`, `authorize(options)`, `unlock(key)`,
`lock()`, `installWebMCP(options)`, `hashKey(value)`, `sleep()`, `wake()`,
`version`.

`snapshot` is synchronous in the browser engine; `act` and `authorize` return
promises. `lib/browser.js` wraps every call as async because it crosses the
Playwright boundary. `bin/ahttp-mcp.js` exposes `ahttp_open`, `ahttp_snapshot`
and `ahttp_act`.

## Test contour

`npm test` runs `node --test` over `test/*.test.js`. The browser suite skips when
Chromium is missing (`AHTTP_REQUIRE_BROWSER=1` makes that a failure).

The regression corpus lives in `corpus/`: one JSON scenario per file, local HTML
fixtures, no network. `corpus/runner.js` loads a fresh jsdom per case, runs
snapshot/action steps, checks ids, matches and diffs, and reports
`match_ok | diff_ok | tokens | status`. `test/corpus.test.js` fails on any
mismatch and writes `bench/results.json`.

A case may carry a `pending` marker while a later phase is still being built;
the runner reports it without failing. No case is pending on this branch.
