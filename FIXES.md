# Fixes: Full `ahttp` to `aihttp` Rename

- **Date:** 2026-11-08
- **Scope:** Full repository-wide rename from legacy `ahttp` to `aihttp`. Breaking rename with no compatibility aliases.

## Renamed Public Surfaces

1. **Package & Binaries:**
   - Package name: `aihttp`
   - CLI / Binaries: `aihttp`, `aihttp-mcp`, `aihttp-serve`
   - Repo link: `github.com/ERETLY/aiweb`

2. **Browser Global & Engine:**
   - Engine files: `aihttp.js`, `aihttp.min.js`, `self/aihttp.user.js`
   - Browser global: `window.aihttp` (with `e.aihttp` UMD export, old `GLOBAL.ahttp` removed)
   - Snapshot header: `aihttp | <title> | <url>` (protocol: `"aihttp/1"`)

3. **DOM Attributes & Markers:**
   - `data-ahttp-*` -> `data-aihttp-*` (`data-aihttp-confirm`, `data-aihttp-owner`, etc.)
   - Internal markers: `__aihttp`, `__AIHTTP_*`

4. **MCP Tools:**
   - `aihttp_open`, `aihttp_snapshot`, `aihttp_act`, `aihttp_trace`, `aihttp_replay`

5. **Environment Variables:**
   - `AIHTTP_REQUIRE_BROWSER`, `AIHTTP_CDP_USE_EXISTING_PROFILE`, `AIHTTP_BUMP_SKIP_BUILD`, `AIHTTP_GIANT_MS`

6. **Examples & Routes:**
   - `examples/nextjs-route/app/api/ahttp/*` -> `examples/nextjs-route/app/api/aihttp/*`

## Gate Results

- **build:** PASS (`aihttp.js` 221,375 B, `aihttp.min.js` 109,935 B, `self/aihttp.user.js` 117,443 B)
- **bench:** PASS (9/9 torture, owner 78/78, MCP 43/43, web 5/5, tasks 20/20)
- **bench:render:** PASS (updated benchmark block in `README.md`)
- **test:** PASS (185/185 pass, 0 fail, 0 skipped)
- **test:corpus:** PASS (79/79 cases pass, 0 fail)
- **lint:** PASS (0 errors, 1 pre-existing warning)
- **typecheck:** PASS (`tsc -p tsconfig.json` clean, 0 errors)
- **smoke:** PASS (`smoke ok: aihttp 1.0.0 on node v26.13.0`)
- **pack:check:** PASS (`aihttp-1.0.0.tgz`, 33 files, 225.5 kB)

## Remaining Occurrences (Allowed)

All live code files, test files, configs, scripts, and documentation have zero occurrences of `ahttp` (except the single mandated breaking changes migration note in `README.md`).

The only remaining occurrences across the entire repository are immutable historical result snapshots and historical benchmark fixtures:
- `README.md`: 1 occurrence (line 347, the explicit Breaking Changes note explaining the rename to users)
- `bench/results.before.json`: 1 occurrence (immutable baseline snapshot)
- `benchmark/pinned/wikipedia-http.html`: 72 occurrences (static HTML fixture of the Wikipedia article on HTTP citing HTTP RFCs/URLs)
- `benchmark/realworld/mcp-results.json`: 8 occurrences (immutable benchmark snapshot)
- `benchmark/realworld/results-after-fixes.json`: 13 occurrences (immutable benchmark snapshot)
- `benchmark/realworld/results-before-fixed-oracle.json`: 20 occurrences (immutable benchmark snapshot)
- `benchmark/realworld/results-latency.json`: 1 occurrence (immutable benchmark snapshot)
- `benchmark/realworld/results.json`: 20 occurrences (immutable benchmark snapshot)
- `benchmark/self-results.json`: 1 occurrence (immutable benchmark snapshot)
