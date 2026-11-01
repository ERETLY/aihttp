# Changelog

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
