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
  absolute, text-indent, zero/tiny size) stays in the snapshot when it has a
  visible label (wrapped `<label>`, `label[for]`, `aria-labelledby` or
  `aria-label`). `display:none`, `visibility:hidden`, `hidden`, `aria-hidden`,
  `inert`, hidden ancestors and closed `<details>` still hide it. The label is
  the real hit target in the page; `act(id, { checked: true })` still dispatches
  a click on the input, which toggles it in Chromium and jsdom.

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

### Tests and docs

- Local jsdom corpus with 46 scenarios (the original 27, the five gap fixes, and
  cases that pin current limits and behavior: iframe depth, cross-origin
  iframes, closed shadow roots, empty pages, aria-label and href drift, other
  hiding mechanisms, a disabled twin, `pointer-events: none`, label lookup), `bench/results.json` metrics and no
  network access.
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
