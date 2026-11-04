# Changelog

## Unreleased

### Matching

- Relocation scores independent anchors: intent, test id, DOM id, name,
  accessible name, visible text, placeholder, title, alt and href. Role, tag,
  path, DOM order and the old fingerprint are tie-breakers only.
- Two thresholds (`accept`, `ambiguous`) and a margin. A near-tie returns
  `status: 'ambiguous'` with candidates and dispatches no event; `confirm` does
  not override it.
- Disabled replacements and kind-mismatched candidates are not active matches.

### Actions

- `act` accepts `expect` and returns `status: 'no_effect'` with failed rules when
  the expected change does not happen.
- Every result now carries `status` (`ok`, `ambiguous`, `not_found`,
  `requires_confirmation`, `blocked`, `locked`, `error`, `no_effect`).
  Existing fields and error codes are unchanged; this is additive.

### Fixes

- Scrolled pages: the off-screen text filter compared viewport-relative
  `getBoundingClientRect()` values with zero, so content scrolled above the
  viewport vanished from the snapshot and showed up as removed in the next
  diff. It now uses document coordinates (`fixed` elements keep viewport
  coordinates).
- Opacity: only the literal `0` hid a control. `0.0`, `.0` and `0%` (inline or
  from a stylesheet) now hide it too, so the static backend no longer shows
  controls a browser would not paint.
- `inert` on an element or an ancestor removes it from the snapshot, like
  `aria-hidden`. Form controls inside `<fieldset disabled>` (outside its first
  `<legend>`) are reported as `disabled` and `act` returns `blocked`.

- Hidden toggles: a native `input[type=checkbox|radio]` hidden only by soft
  heuristics (opacity <= 0.05, clip, clip-path, font-size 0, off-screen
  absolute, text-indent, zero/tiny size) stays in the snapshot when a visible
  label element (wrapped `<label>`, `label[for]`, `aria-labelledby`) names it;
  when `aria-label` is the only name it needs real layout, its own box of at
  least 12x12 px inside the page, and opacity as the only hide mechanism, so a
  1x1 or off-screen input can no longer carry instructions into the snapshot.
  `display:none`, `visibility:hidden`, `hidden`, `aria-hidden`, `inert`, hidden
  ancestors and closed `<details>` still hide it. The label is the real hit
  target in the page; `act(id, { checked: true })` still dispatches a click on
  the input, which toggles it in Chromium and jsdom.

- Disabled twins: relocation used to filter disabled candidates before scoring,
  so `[disabled "Run"][active "Run"]` clicked the active twin even though the
  original could be either. Disabled candidates are now scored and returned in
  `candidates` with `disabled: true`, but they can never win. With no active
  candidate the reply is `not_found`; an active candidate must lead every other
  candidate by `margin` and `contentMargin` or the reply is `ambiguous`. A
  clearly better active candidate (for example, the one that kept the original
  `data-testid`) still runs.

- Label lookup: when the id is not in the registry, `act("Delete")` used to
  take the first action with that label. It now tries `data-ahttp-intent`
  (case-insensitive), then the label with exact case, then the label
  case-insensitive. A step with more than one match returns `status: 'ambiguous'`
  with candidates and dispatches nothing; a duplicate `data-ahttp-intent` does
  the same. Unique labels still run, and `confirm: true` does not bypass it.

- Matching: position, DOM order and the fingerprint add up to 14 points, more
  than `margin` (12), so two controls with the same label could be separated by
  position alone and the nearer one was clicked. The winner must now also lead
  every other candidate by `contentMargin` (5) on content signals alone;
  otherwise the reply is `ambiguous`. `thresholds.contentMargin` is added to the
  ambiguous reply.

- `expect`: the check ran once right after the quiet window (about 40 ms), so a
  correct click whose effect arrived 100-400 ms later came back as `no_effect`
  with "the match may be wrong". `act` now re-checks every 30 ms until the rule
  holds or `timeout` runs out. A met rule returns as fast as before; an unmet
  one returns `no_effect` after the full timeout (1200 ms by default).

### Real-world fixes

- Layout mode reads visibility and cursor from `getComputedStyle` only. The
  browser already resolved media queries, specificity and inheritance, so the
  CSS index is not consulted and cannot override the page. GitHub recall went
  from 41.1% to 98.9%.
- The static backend evaluates a Media Queries 4 subset (width, height,
  aspect-ratio, resolution, ranges, `and`/`or`/`not`, `calc`, `em`/`rem`/`vw`/`vh`
  and common preferences) and cascades `display`, `visibility`, `opacity` and
  `cursor` by `!important`, specificity and source order. An unknown feature or
  an unparsable query is false, never true.
- `display: contents` no longer hides a subtree, and a zero-size clipped wrapper
  does not hide content a browser still paints.
- Anchors without `href` stay actions when a role, a handler, a pointer cursor or
  `tabindex` makes them interactive.
- A sibling `<label>` without `for`, and the direct text next to an unlabelled
  checkbox, now name the control; two checkboxes in one paragraph get distinct
  names.
- A `<label>` is not a separate action when its control is in the snapshot.
  Bootstrap `btn-check` labels stay clickable when the radio is hard-hidden or
  missing.
- A native `select`, `textarea` or text input hidden only by partial opacity
  (`0 < opacity <= 0.05`) is recovered when it has a real box and a name;
  `opacity: 0` is not. A `cursor: pointer` element covered by a native control
  is dropped instead of becoming a dead button.

### Tests and docs

- Local jsdom corpus with 71 scenarios (the original 27, the gap fixes and the
  real-world regressions: media queries and cascade, CSS-hidden-then-shown,
  anchors without `href`, sibling labels and adjacent text, label proxies,
  Bootstrap `btn-check`, partial-opacity fields, iframe depth, cross-origin
  iframes, closed shadow roots, empty pages, aria-label and href drift, other
  hiding mechanisms, a disabled twin, `pointer-events: none`, label lookup), `bench/results.json` metrics and no
  network access.
- `test/realworld-layout.test.js`: five Chromium tests behind
  `AHTTP_REQUIRE_BROWSER=1` (layout mode, anchors without `href`, label proxy,
  partial opacity, `display: contents` and the security fixture).
- `docs/REALWORLD.md` keeps the before/after run: 23/29 to 29/30 scenarios and
  mean recall 93.6% to 96.6% over the scanned pages (bbc-news is new).
- Two real-world steps were corrected against live evidence: Wikipedia clicks a
  search suggestion, TodoMVC expects the Active filter to hide the completed
  todo. The harness retries a text/dom read while a form-submit navigation
  commits, and can reject a declared cross-origin consent wall, so bbc-news is
  scanned instead of blocked.
- `docs/MATCHING.md`, `docs/ARCHITECTURE.md`, a 30-second quick start, an MCP
  config block and a runnable `examples/agent-loop.js`.

## 0.1.0, 2026-11-01

First public snapshot.

### Engine

- Compact text and JSON snapshots with stable action ids.
- Media-aware CSS index, including common `@media` width and height conditions.
- CSS `::before` and `::after` text in accessible names when the browser exposes it.
- Relocation prefers a matching DOM id when a framework replaces a node.
- DOM-only actions settle on a short quiet window; requests keep the longer wait.

### Static backend

- Fetch linked stylesheets before scanning, with a size cap and an opt-out.
- Follow `@import` to three levels.

### Self-use

- `self/ahttp.user.js`: the engine and a panel in one file for Tampermonkey or Violentmonkey.
- Scan, act, confirm and copy from the panel. `Alt+Shift+A` opens it.
- No server and no upload.

### Benchmarks

- Compared with raw HTML, Readability Markdown, the Chromium accessibility tree, Jina Reader and Firecrawl.
- `npm run bench:time` measures scan and live time for every method; the README timing tables are generated from `benchmark/time-results.json`.
