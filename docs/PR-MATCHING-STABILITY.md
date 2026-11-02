# PR: matching stability, regression corpus and onboarding

Branch: `feat/matching-stability`  
Base: `main` (`4d397c8`)  
Scope: ahttp `0.1.0`, additive API only.

## Problem

Relocation after a framework rerender used one weighted fingerprint and a single
threshold. Two near-identical controls could be confused and a click could land
on the wrong one. The repository had unit tests but no page-level regression
corpus, and the README did not get a new user to a first snapshot or an MCP setup
without reading code.

## Module map

| Area | File | Role |
|---|---|---|
| Engine | `ahttp.js` | scan, ids, snapshot, act, diff, policy, auth |
| Builds | `ahttp.min.js`, `self/ahttp.user.js` | generated engine / userscript |
| Matching | `MATCH`, `scoreMatch()`, `relocate()` in `ahttp.js` | anchors, score, thresholds, ambiguity |
| Post-check | `evaluateExpectation()` in `ahttp.js` | `expect` rules and `no_effect` |
| CLI | `bin/ahttp-cli.js` | fetch, parse, print a snapshot |
| MCP | `bin/ahttp-mcp.js` | `ahttp_open`, `ahttp_snapshot`, `ahttp_act` |
| Backends | `lib/page.js`, `lib/mini-dom.js`, `lib/browser.js` | static fetch/DOM and Playwright |
| Corpus | `corpus/` | 27 local jsdom scenarios and the runner |
| Docs | `README.md`, `docs/API.md`, `docs/MATCHING.md`, `docs/ARCHITECTURE.md` | user and maintainer docs |

The full map, snapshot shape and diff shape are in
[docs/ARCHITECTURE.md](ARCHITECTURE.md).

## Plan delivered

1. **Corpus first.** 27 cases, local fixtures, no network, table runner, token
   metric, `bench/results.json`.
2. **Matching.** Independent content anchors, weighted score, hard gates,
   `accept` / `ambiguous` / `margin`, structured ambiguity, deterministic order.
3. **Post-check.** `expect` rules; a missing expected change returns
   `status: 'no_effect'`.
4. **Onboarding.** 30-second userscript path, one MCP block, local agent loop,
   experimental badge, expanded known limitations, breaking-changes policy.
5. **Report.** Before/after run on the same 27-case corpus.

## Metrics: before/after

Both columns run the current 27-case corpus. `before` is `main:ahttp.js` via
`AHTTP_ENGINE`; `after` is this branch. Tokens are `gpt-tokenizer` counts over
the snapshot text.

| Metric | Before | After |
|---|---:|---:|
| Cases | 27 | 27 |
| Passed | 22 | 27 |
| Failed | 5 | 0 |
| `match_ok` | 22/27 | 27/27 |
| `diff_ok` | 24/27 | 27/27 |
| Tokens | 961 | 961 |

Token count is unchanged: ids and snapshot lines are byte-identical on these
fixtures. The gains are correctness, not compression.

### Per case

| Case | Before match | Before diff | After match | After diff | Tokens | Before | After |
|---|---|---|---|---|---|---:|---|---|
| `checkbox-toggle` | ok | ok | ok | ok | 34 | PASS | PASS |
| `click-no-effect` | FAIL | ok | ok | ok | 26 | FAIL | PASS |
| `contenteditable-fill` | ok | ok | ok | ok | 27 | PASS | PASS |
| `disabled-blocked` | FAIL | ok | ok | ok | 27 | FAIL | PASS |
| `disabled-not-matched-after-rerender` | FAIL | FAIL | ok | ok | 28 | FAIL | PASS |
| `guarded-action-confirm` | ok | ok | ok | ok | 30 | PASS | PASS |
| `hidden-aria-hidden` | ok | ok | ok | ok | 27 | PASS | PASS |
| `hidden-display-none` | ok | ok | ok | ok | 26 | PASS | PASS |
| `identical-delete-buttons-ambiguous` | FAIL | FAIL | ok | ok | 39 | FAIL | PASS |
| `identical-ok-buttons-ambiguous` | FAIL | FAIL | ok | ok | 31 | FAIL | PASS |
| `links-same-label-different-href` | ok | ok | ok | ok | 39 | PASS | PASS |
| `login-form-fill-submit` | ok | ok | ok | ok | 53 | PASS | PASS |
| `placeholder-stable-after-label-change` | ok | ok | ok | ok | 30 | PASS | PASS |
| `react-rerender-id` | ok | ok | ok | ok | 36 | PASS | PASS |
| `react-rerender-name-fill` | ok | ok | ok | ok | 25 | PASS | PASS |
| `react-rerender-testid-label-change` | ok | ok | ok | ok | 24 | PASS | PASS |
| `row-appears-and-disappears` | ok | ok | ok | ok | 58 | PASS | PASS |
| `shadow-dom-basic` | ok | ok | ok | ok | 26 | PASS | PASS |
| `shadow-dom-host-slot` | ok | ok | ok | ok | 28 | PASS | PASS |
| `snapshot-text-untrusted` | ok | ok | ok | ok | 34 | PASS | PASS |
| `stable-ids` | ok | ok | ok | ok | 62 | PASS | PASS |
| `table-repeated-delete-rerender` | ok | ok | ok | ok | 49 | PASS | PASS |
| `table-repeated-delete` | ok | ok | ok | ok | 48 | PASS | PASS |
| `toolbar-aria-label` | ok | ok | ok | ok | 36 | PASS | PASS |
| `toolbar-title` | ok | ok | ok | ok | 32 | PASS | PASS |
| `url-change` | ok | ok | ok | ok | 25 | PASS | PASS |
| `virtualized-list-gap` | ok | ok | ok | ok | 61 | PASS | PASS |

`disabled-blocked` is a status change, not a wrong click: the old engine blocked
it with `error: 'disabled'` but had no `status` field. `click-no-effect` is the
same: the old engine ran the click and reported `ok`, because `expect` did not
exist.

The three genuine behavioral failures before the change:

- both `identical-*-ambiguous` cases clicked a guess instead of refusing;
- `disabled-not-matched-after-rerender` dispatched into a disabled replacement
  and fired its handler.

## What changed

### Matching

- Signals: intent, test id, DOM id, name, accessible name, separate visible text,
  placeholder, title, alt, href. Position, DOM order and the old fingerprint are
  capped tie-breakers.
- `accept = 50`, `ambiguous = 24`, `margin = 12`. The winner must clear `accept`
  and be at least `margin` ahead.
- Hard gates: different `kind`, disabled candidate, disconnected node, and
  positional-only evidence.
- Ambiguous result is structured (`status`, `error`, `candidates`, `targetHint`,
  `thresholds`) and dispatches no event. `confirm` cannot override it.
- Candidate order is score, then DOM order, for deterministic replies.

Weights and rationale: [docs/MATCHING.md](MATCHING.md).

### Post-check

- `act` accepts `expect`: `diff`, `empty`, text/action additions and removals,
  `diffContains`, `urlChanged`, `snapshotContains`, `pageText`.
- A failed rule returns `ok: true` (the action ran) with `status: 'no_effect'`,
  `effect.failures` and a warning. MCP surfaces it as an error with the same
  data.
- Added corpus cases for a satisfied expectation, a no-op click, an action that
  appears, an action that disappears, and a URL change.

### Compatibility

Existing fields, error codes and snapshot/diff lines are unchanged. New fields
(`status`, `candidates`, `targetHint`, `thresholds`, `effect`) and new payload
keys (`expect`, `targetHint`) are additive. No version bump; README has a
"Breaking changes: none in 0.1.x" policy.

MIT header and copyright notice untouched. The userscript and browser engine
still have no runtime dependencies.

## Verification

```text
npm test                 # 80 tests, 80 pass
npm run test:corpus      # 27 cases, 27 pass, 0 fail, 0 pending
npm run typecheck        # clean
npm run lint             # clean
npm run build            # generated min + userscript
npm run smoke            # runtime + CLI local fixture
node examples/agent-loop.js
```

`agent-loop.js` output:

```text
a1 button "Add to cart"
ok: + text "Item added"
- text "Cart: 0"
```

No test or fixture loads a network resource; a test scans the fixtures for
external `src`/`href`. `stable-ids` snapshots twice, including a forced rescan,
and gets the same ids.

## Remaining known failures

None in the corpus. The following are deliberately unsupported and documented in
README "Known limitations":

- closed shadow roots and cross-origin iframes;
- virtualized rows that are unmounted (returns `not_found`; no auto-scroll);
- accessible-name edge cases (`aria-owns`, some SVG and cross-shadow references);
- hidden-text heuristics (canvas, background images, stylesheets the page hides);
- `mini-dom` not being an HTML5 tree parser.

## Reviewer checklist

- [x] `npm test` green; corpus has 27 cases and prints metrics.
- [x] Stable anchors outrank the fingerprint; weights and thresholds live in
  `MATCH` with comments.
- [x] `ambiguous` is structured, never runs the action, survives `confirm`.
- [x] `no_effect` is returned and covered by unit and corpus tests.
- [x] Ids are deterministic; tests are local.
- [x] README: Quick start, one MCP block, known limitations, agent-loop example.
- [x] MIT headers preserved; additive API, no breaking change.
- [x] Before/after table above; both JSON summaries are in `bench/`.
