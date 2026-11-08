# Matching corpus

One JSON file per scenario in `cases/`, one local HTML fixture per page in
`fixtures/`. The runner loads every case in a fresh jsdom, runs the steps against
the real engine, and writes `bench/results.json`.

Run it:

```bash
npm run test:corpus
node corpus/runner.js --filter=login
node corpus/runner.js --no-write
AIHTTP_ENGINE=C:/tmp/aihttp.before.js node corpus/runner.js --out=bench/results.before.json
```

`AIHTTP_ENGINE` points the runner at an older engine file for a before/after
report. `npm test` never sets it.

`npm test` also runs the corpus and fails on a non-pending mismatch. No test may
load a network resource.

## Case shape

```json
{
  "id": "login-form-fill-submit",
  "html": "fixtures/login.html",
  "url": "https://corpus.test/login",
  "notes": "label + input + submit",
  "steps": [
    { "action": "snapshot", "expectIds": ["a1", "a2", "a3"] },
    { "action": "fill", "expectedId": "a1", "value": "agent@example.com" },
    { "action": "click", "expectedId": "a3", "targetHint": "submit button",
      "expectEffect": { "textAdded": ["Welcome back"] } }
  ]
}
```

`pending` (string) marks a case that documents behavior added by a later phase.
A pending case is reported but does not fail the run. Remove the marker when the
phase lands.

### Steps

| Step | Fields |
|---|---|
| `snapshot` | `expectIds`, `expectNotIds`, `expectText`, `expectNotText`, `expectTextOrder`, `expectDiff.contains`, `options` |
| `click` | `expectedId`, `targetHint`, `payload`, `actExpect`, `expectStatus`, `expectEffect`, `options` |
| `fill` | `expectedId`, `value`, `targetHint`, `actExpect`, `expectStatus`, `expectEffect`, `options` |
| `rerender` | `selector`, `html` — replaces the container content, like a framework rerender |

`expectedId` is the id printed by the previous snapshot. After a rerender, the
runner passes that old id to `act()`; matching is what has to find the node
again.

`targetHint` is a human-readable description for the table and for the
`ambiguous` reply. It is never used as a selector.

### Expectations

`expectStatus` is `ok` by default. Other values: `ambiguous`, `not_found`,
`no_effect`, `requires_confirmation`, `blocked`, `error`.

`actExpect` is passed to `act` as its `expect` option, so the engine itself
returns `no_effect` when the rule fails. `expectEffect` is the runner's
independent assertion on the returned result and the live page.

`expectEffect` keys:

| Key | Meaning |
|---|---|
| `status` | Same as `expectStatus`, usable inside the effect block |
| `error` | Exact `result.error` |
| `candidates` | Minimum number of structured `ambiguous` candidates |
| `requiresConfirmation` | Guarded action did not run |
| `noMutation` | `result.meta.mutations === 0` |
| `textAdded` / `textRemoved` | Substrings in the diff text arrays |
| `added` / `removed` | Substrings in the labels of added/removed actions |
| `diffContains` | Substrings in `diff.text` |
| `urlChanged` | `diff.url` is set |
| `empty` | `diff.empty` |
| `snapshotContains` | Substrings in the returned snapshot |
| `pageText` | `{ selector, equals }` or `{ selector, includes: [] }` on the live DOM |

`match_ok` covers ids, status, error, candidates, confirmation and mutation
safety. `diff_ok` covers text, action, URL, snapshot and page-text effects.

## Fixtures

Fixtures may contain inline scripts, but no external `src` or `href`. Use
`window.__mark(value)` to write `#out`; a test asserts that no fixture references
a network resource.
