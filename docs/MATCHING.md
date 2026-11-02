# Matching and relocation

ahttp prints ids (`a1`, `a2`, ...). An id stays valid while its node is connected.
When a framework replaces the node, `act(id)` rescans and tries to find the
replacement. This document defines that search. The implementation is the
`MATCH` object at the top of `ahttp.js` and `scoreMatch()` / `relocate()`.

## Hard gates

A candidate is rejected before scoring when:

- it is the same entry as the target;
- its node is disconnected;
- its `kind` differs (`click` vs `fill`, `select`, `toggle`, ...);
- it is disabled (`disabled` or `aria-disabled="true"`).

A disabled control is visible in a snapshot with the `disabled` suffix, but it
is never used as an active relocation target. A positional-only candidate is
also rejected: at least one content anchor must agree.

## Signals and weights

Stable, author-controlled anchors dominate. Two anchors derived from the same
attribute are not double-counted (for example, an icon button whose `label` is
its `title` scores `title`, not `title` plus `name`).

| Signal | Weight | Why |
|---|---:|---|
| `data-ahttp-intent` | 100 | author-declared stable identity |
| `data-testid` / `data-test` / `data-qa` | 90 | explicit test anchor |
| DOM `id` | 80 | survives many rerenders |
| `name` | 70 | authored form identity, not copy |
| accessible name | 55 | label, `aria-labelledby`, `aria-label`, visible name |
| separate visible text | 45 | when an aria name and visible text differ |
| `placeholder` | 40 | authored hint, weaker than a name |
| `title` | 35 | icon-only controls often have only this |
| `alt` | 35 | image controls |
| `href` | 30 | same link text, different destination |
| `role` | 8 | compatibility only |
| tag | 6 | compatibility only |
| input `type` | 4 | survives copy changes |
| path similarity | ≤ 10 | tie-breaker only |
| DOM order distance | ≤ 4 | tie-breaker only |
| structural fingerprint | 6 | the old fingerprint, low weight |

Case-insensitive matches score 5–8 points less than exact matches. A prefix
match on the accessible name scores 22; a prefix on separate visible text scores
18. These are enough to accept a clearly unique control, but not enough to beat
a real anchor.

## Thresholds

| Constant | Value | Meaning |
|---|---:|---|
| `accept` | 50 | best candidate may run |
| `ambiguous` | 24 | below this, return `not_found` |
| `margin` | 12 | winner must be this far ahead of the runner-up |

A candidate runs only when `best >= accept` **and**
`best - second >= margin` (or there is no second candidate). If
`best >= ambiguous` but either condition fails, the action is not dispatched and
the reply is `ambiguous`. Otherwise the reply is `not_found`.

Because position and order are capped at 14 combined, they cannot carry a match
on their own. A virtualized list that recycles a row produces `not_found`, not a
click on the wrong row.

## Ambiguous reply

```json
{
  "ok": false,
  "status": "ambiguous",
  "error": "ambiguous",
  "id": "a3",
  "action": { "id": "a3", "method": "click", "kind": "click", "label": "OK" },
  "targetHint": "first OK button",
  "candidates": [
    { "id": "a7", "role": "button", "name": "OK", "tag": "button", "score": 89, "signals": ["name", "role", "tag", "path", "order", "fingerprint"] },
    { "id": "a8", "role": "button", "name": "OK", "tag": "button", "score": 89, "signals": ["name", "role", "tag", "path", "order", "fingerprint"] }
  ],
  "thresholds": { "accept": 50, "ambiguous": 24, "margin": 12 },
  "warning": "Multiple controls match this target; no action was taken."
}
```

`targetHint` is echoed from `payload.targetHint` / `options.targetHint` when
provided, otherwise it is the old accessible name. It is diagnostic text, never
a selector. `candidates` is capped at five and sorted by score, then DOM order.

`confirm: true` does not override `ambiguous`: confirmation is for a known
action, not for choosing between two actions. The engine dispatches no event and
does not mutate the registry.

## Status values

Every `act()` result now carries `status`:

`ok`, `ambiguous`, `not_found`, `requires_confirmation`, `blocked`, `locked`,
`error`, and later `no_effect` (see the post-check section in the README).

Existing `ok`, `error`, `blocked`, `requiresConfirmation`, `id` and `action`
fields are unchanged. `status`, `candidates`, `targetHint` and `thresholds` are
additive, so this stays inside the 0.1.x line.

## Tests

`test/matching.test.js` covers stable anchors, ambiguity, confirm, disabled
replacements, deterministic candidate order and status values. The corpus in
`corpus/` covers the same behavior through the real snapshot/action surface.
