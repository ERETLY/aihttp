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

### Tests and docs

- Local jsdom corpus with 27 scenarios, `bench/results.json` metrics and no
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
