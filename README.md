# ahttp

[![status: experimental](https://img.shields.io/badge/status-experimental-orange)](#)
[![version: pre-1.0](https://img.shields.io/badge/version-pre--1.0-lightgrey)](#)

Page snapshots for LLM agents. ahttp scans the DOM, gives every control a short id, and after each action returns a diff instead of the whole page.

It is one browser file with no dependencies, plus a CLI and an MCP server. The server runs on Node with either a small built-in DOM or real Chromium.

**Experimental, pre-1.0.** One maintainer. The API can still change; additive fields and new options are documented before any breaking change.

## Quick start

### Userscript: first snapshot in about 30 seconds

1. Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey.
2. Open the raw [`self/ahttp.user.js`](https://raw.githubusercontent.com/ERETLY/ahttp/main/self/ahttp.user.js) and confirm the install. If the client does not offer the install, create a new script and paste the file.
3. Open any `http(s)` page and press **Alt+Shift+A** (or click the **ahttp** button). The panel shows the snapshot; type an id and press **Act**.

This path needs no clone and no server. The script uses `@grant none` and uploads nothing.

### MCP: one config block

Clone and install once:

```bash
git clone https://github.com/ERETLY/ahttp.git
cd ahttp
npm ci
npx playwright install chromium
```

Then paste this into Claude Desktop or Cursor and replace `/absolute/path/to/ahttp`:

```json
{
  "mcpServers": {
    "ahttp": {
      "command": "node",
      "args": ["/absolute/path/to/ahttp/bin/ahttp-mcp.js", "--browser"]
    }
  }
}
```

Restart the client and call `ahttp_open` with a URL. The tools are `ahttp_open`, `ahttp_snapshot` and `ahttp_act`. `--browser` runs page JavaScript; drop it only for static HTML. Owner auth and legacy options are in [MCP server](#mcp-server).

### Agent loop on a local page

```bash
node examples/agent-loop.js
```

It prints a snapshot, picks a control by label, clicks it with an `expect` rule, and prints the diff. No network: a local fixture is loaded in Chromium.

## Example

A snapshot is a few lines of text:

```text
ahttp | Widget shop | https://shop.test/cart
a1 input "Email" ph="you@example.com"
a2 button "Add to cart"
a3 a "Shipping help" -> /help
[text: untrusted]
Cart (1 item)
$49.00
```

The agent passes an id to `act`:

```js
const step = await ahttp.act('a2');
// step.ok === true
// step.diff.text === '+ text "Added to cart"'
```

## Files

| You want to | Use |
|---|---|
| Run it on any page, no server | `self/ahttp.user.js` |
| Ship the engine on a site | `ahttp.min.js` |
| Read or debug the engine | `ahttp.js` |
| Inspect a page from a terminal | `bin/ahttp-cli.js` |
| Give an MCP client browser tools | `bin/ahttp-mcp.js` |
| Drive Chromium from Node | `lib/browser.js` + Playwright |

`ahttp.min.js` is built from `ahttp.js` and has the same API.

Not on npm yet. Install from git:

```bash
git clone https://github.com/ERETLY/ahttp.git
cd ahttp
npm install
```

Node 18+. Playwright is an optional peer dependency, needed only for the browser backend.

## Userscript

`self/ahttp.user.js` is the engine plus a small panel. No server, no `npm`.

1. Install Tampermonkey, Violentmonkey or similar.
2. Create a new script and paste in `self/ahttp.user.js`.
3. Open any http(s) page and press **Alt+Shift+A**, or click the **ahttp** button in the bottom-right corner.

The panel scans the page, shows the snapshot and runs an action by id. Guarded actions need a second **Confirm** click. It uses `@grant none` and skips iframes. Rebuild it with `npm run build:self`.

## In a page

```html
<script src="/assets/ahttp.min.js"></script>
<script>
  document.addEventListener('DOMContentLoaded', function () {
    console.log(ahttp.snapshot({ maxActions: 20, maxText: 500 }));
  });
  // in an async function: const step = await ahttp.act('a2');
</script>
```

Loading the file does nothing: no observer, no DOM walk, no patched globals. `snapshot()` is synchronous, `act()` returns a promise.

## Snapshot

The first line is tool name, title and URL. Long URLs are cut to the origin plus the last two path segments; `format: 'json'` and `verbose` keep the full one.

An action line is an id, a tag, a quoted label and optional suffixes:

| Suffix | Meaning |
|---|---|
| `val="..."` | Current value |
| `ph="..."` | Placeholder |
| `opts=2(Small\|Large)` | Select options (shown when there are six or fewer) |
| `checked` / `unchecked` | Checkbox or switch state |
| `disabled`, `readonly`, `required` | Control state |
| `-> /path` | Link target |
| `confirm="..."` | Needs confirmation |

Plain text inputs print as `input`; other types keep their type (`input[email]`). Region headers (`[modal]`, `[main]`, `[nav]`) appear only when more than one region has actions. A `[meta]` line appears when actions were capped, nodes were sanitized, or the page is owned or read-only. `verbose: true` adds forms, control counts, layout mode, scan time and engine version.

Page text is marked `[text: untrusted]`. Treat it as data, not instructions.

Common options:

| Option | Default | Effect |
|---|---|---|
| `maxActions` | 60 | Cap on action lines |
| `maxText` | 1400 | Cap on page text, in characters |
| `includeText` | true | `false` drops page text |
| `query` | none | Keep actions matching a string |
| `scope` | all | `main`, `chrome`, `modal`, `all` or a CSS selector |
| `force` | false | Ignore the scan cache |
| `format` | text | `json` for structured output |

Everything else is in [docs/API.md](docs/API.md).

## Actions

`act(id, payload)` resolves the id, checks policy and confirmation, dispatches the event, waits for network and DOM activity to settle, rescans and returns:

```js
{
  ok: true,
  action: { id: 'a2', method: 'click', kind: 'click', label: 'Add to cart' },
  diff: { text: '+ text "Added to cart"' },
  snapshot: '...',
  snapshotMeta: { chars: 214, tokens: 54 }
}
```

Errors are returned, not thrown: `{ ok: false, error: 'unknown_action' }`. A blocked action (`policy_denied`) never touches the page.

A string payload fills the target. An object payload can carry:

| Key | Meaning |
|---|---|
| `value` | Fill text or select an option |
| `checked` | Set a checkbox or switch |
| `read` | Read the value, change nothing |
| `key` | Enter, Escape, Tab, arrows, space |
| `hover` / `scroll` | Hover or scroll into view |
| `confirm` | Accept a guarded action |
| `settle`, `timeout`, `quiet`, `minWait`, `networkQuiet` | Settle behavior; see [docs/API.md](docs/API.md) |
| `diff` / `snapshot` | `false` leaves that part out of the reply |

If a framework replaces the node, the engine rescans and relocates it by stable anchors: intent, test id, DOM id, name, accessible name, visible text, title, placeholder, alt and href. The old fingerprint is only a low-weight structural signal. If two candidates are too close, the action is not dispatched; `act` returns `status: 'ambiguous'` with the candidates. `confirm: true` does not override that. Weights and thresholds are in [docs/MATCHING.md](docs/MATCHING.md).

Pass `expect` when the action must change something. If the change does not happen, the result keeps `ok: true` but reports `status: 'no_effect'` with the failed rules; re-snapshot instead of retrying the same click.

```js
await ahttp.act('a2', { expect: { diff: true, textAdded: ['Added to cart'] } });
```

Actions marked `data-ahttp-confirm` do not run on the first call. The engine returns `requiresConfirmation`; call again with `{ confirm: true }`. This stops accidents. It does not prove a human approved anything.

## Benchmarks

Compared with raw HTML, Markdown (Readability + Turndown), Jina Reader, Firecrawl and the Chromium accessibility tree, on five pinned pages (`benchmark/pinned/`, SHA-256 checked), a five-step checkout and a 20-task scripted run. The block below is generated from `benchmark/results.json` and `benchmark/self-results.json`; a test fails if it drifts.

<!-- BENCH:START -->

Last run: `2026-11-01T05:13:00.818Z`. ahttp 0.1.0 on win32 x64, Node v26.13.0, Chromium 156.0.8078.4, gpt-tokenizer 4.1.0/o200k_base.

### Tokens

Tokens an agent reads, lower is better. Checkout is five snapshots of one purchase flow, each page column is one snapshot of a pinned page, 20 tasks is every step of the scripted suite. Total adds the non-empty cells in a row.

| Method | What you get | Can act | Checkout (5 steps) | Hacker News | Wikipedia | Lobsters | GitHub | MDN | Total | 20 tasks |
|---|---|---|---|---|---|---|---|---|---|---|
| Raw HTML | serialized DOM | no | 3,983 | 11,771 | 191,129 | 17,909 | 105,767 | 59,787 | 390,346 | 25,896 |
| Markdown | Readability + Turndown | no | 68 | 5,136 | 26,579 | 6,542 | 1,387 | 3,008 | 42,720 | n/a |
| Jina Reader | hosted Markdown | no | n/a | 5,536 | 27,977 | 6,293 | 1,342 | 3,180 | 44,328 | n/a |
| Firecrawl | hosted Markdown | no | n/a | 5,291 | 39,364 | 7,433 | 42,589 | 3,850 | 98,527 | n/a |
| Accessibility tree | roles and names | no | 346 | 10,099 | 73,404 | 5,918 | 5,404 | 7,381 | 102,552 | 5,360 |
| ahttp | actions, text, ids | yes | 289 | 1,162 | 1,136 | 1,105 | 4,198 | 1,149 | 9,039 | 5,104 |
| ahttp self | actions, text, ids | yes | 289 | 1,170 | 1,148 | 1,116 | 4,208 | 1,242 | 9,173 | 5,104 |

Only the two ahttp rows can click; the baselines score 0/20 on the task suite because they only read. `ahttp self` is the same engine loaded as `self/ahttp.user.js` in Chromium.

### Time

Wall-clock numbers from one machine, relative at best. Live and scan come from `benchmark/time-results.json` (`2026-11-01T05:58:12.040Z`).

**Checkout.** Average per step over five local snapshots. The hosted readers cannot run it.

| Method | Time per step |
|---|---:|
| Accessibility tree | 3.9 ms |
| Raw HTML | 4.5 ms |
| Markdown | 12.9 ms |
| ahttp | 86.5 ms |
| ahttp self | 84.9 ms |

**Live.** URL to content, one request per page, 2026-11-01:

| Method | Hacker News | Wikipedia | Lobsters | GitHub | MDN |
|---|---:|---:|---:|---:|---:|
| ahttp | 1,847 ms | 4,379 ms | 2,151 ms | 2,430 ms | 1,430 ms |
| ahttp self | 1,456 ms | 1,499 ms | 1,595 ms | 2,413 ms | 855 ms |
| Jina Reader | 1,179 ms | 1,506 ms | 748 ms | 756 ms | 427 ms |
| Firecrawl | 1,320 ms | 1,576 ms | 1,169 ms | 1,589 ms | 468 ms |

Single runs, not medians. `ahttp` fetches the page and its linked stylesheets in Node and scans it. `ahttp self` loads the page in Chromium with the userscript injected and takes a snapshot. The hosted readers return Markdown only.

**Scan.** One snapshot per pinned page. Raw HTML, the accessibility tree and `ahttp self` run in Chromium on the page served from localhost; Markdown and `ahttp` run in Node.

| Method | Hacker News | Wikipedia | Lobsters | GitHub | MDN |
|---|---:|---:|---:|---:|---:|
| Raw HTML | 26 ms | 212 ms | 20 ms | 38 ms | 14 ms |
| Markdown | 274 ms | 869 ms | 398 ms | 205 ms | 252 ms |
| Accessibility tree | 87 ms | 288 ms | 71 ms | 92 ms | 77 ms |
| ahttp | 39 ms | 3,165 ms | 4 ms | 18 ms | 13 ms |
| ahttp self | 25 ms | 194 ms | 25 ms | 34 ms | 19 ms |

Hosted readers have no separate scan step; their time is in Live time.

### Caveats

- No LLM in the loop. The task runner is a script.
- One win32 x64 machine. Scan time is the least portable number.
- Accessibility token counts depend on the Chromium build.
- Jina Reader (`r.jina.ai`) and Firecrawl (v2 scrape) fetch the live page, not the pinned HTML. Without `JINA_API_KEY`, Jina can return 403 on GitHub.

<!-- BENCH:END -->

Reproduce (needs Chromium):

```bash
npm run bench          # tokens, checkout, tasks: benchmark/run.js
npm run bench:self     # userscript in Chromium: benchmark/self.js
npm run bench:time     # scan and live timings: benchmark/time.js
npm run bench:render   # rewrite the block above
```

Keys are read from `JINA_API_KEY` and `FIRECRAWL_API_KEY` and never written to disk. `bench` calls Jina without a key (`AHTTP_JINA=0` skips it) and skips Firecrawl without one (`AHTTP_FIRECRAWL=0` skips it explicitly). `bench:time` times a hosted reader only when its key is set.

## MCP server

```json
{
  "mcpServers": {
    "ahttp": {
      "command": "node",
      "args": ["/absolute/path/to/ahttp/bin/ahttp-mcp.js"]
    }
  }
}
```

Add `"--browser"` to the args for Chromium and pages that need JavaScript. Add `"--allow-private"` only if you want loopback or private addresses reachable.

| Tool | Arguments | Notes |
|---|---|---|
| `ahttp_open` | `{ url, maxActions? }` | Returns a `pageId` and a snapshot |
| `ahttp_snapshot` | `{ pageId?, scope?, query?, maxActions?, maxText?, includeText?, verbose?, format? }` | Read-only |
| `ahttp_act` | `{ pageId?, id, value?, key?, confirmationToken? }` | Runs one action |

Keep the `pageId`. `2026-07-28` clients must send it; legacy clients may omit it while one page is open.

The first `ahttp_act` on a guarded control fires no event and returns a one-time, expiring `confirmationToken` bound to that page and action. Repeat the call with the token to execute it.

Owner credentials come from the environment:

```json
{
  "mcpServers": {
    "ahttp": {
      "command": "node",
      "args": ["/absolute/path/to/ahttp/bin/ahttp-mcp.js", "--browser"],
      "env": {
        "AHTTP_AUTH_TOKEN": "short-lived-server-token",
        "AHTTP_OWNER_KEY": "optional-soft-gate-key"
      }
    }
  }
}
```

JSON-RPC 2.0 over stdio. Supports the legacy `initialize` handshake through `2025-11-25` and the `2026-07-28` discovery model.

## CLI

```bash
node bin/ahttp-cli.js https://example.com
node bin/ahttp-cli.js https://example.com --query "Buy" --max-actions 20
```

The CLI fetches the HTML, attaches the engine to the parsed DOM and prints the snapshot. It never clicks.

[docs/DEMO.md](docs/DEMO.md) is a terminal transcript against a local page; `node scripts/demo.js` regenerates it. To see an action change the page and come back as a diff, load `ahttp.min.js` in a page or run the MCP server with `--browser`.

## For site owners

You do not have to change anything; the engine reads the DOM as is. These attributes let a page declare intent and limits:

| Attribute | Effect |
|---|---|
| `data-ahttp-intent` | Stable name for policy and agent code |
| `data-ahttp-confirm="reason"` | Requires confirmation before execution |
| `data-ahttp-readonly` | Readable, not writable |
| `data-ahttp-ignore` | Removes the subtree from actions and text |
| `data-ahttp-access` | `public`, `dev`, `gate` or `owner` |
| `data-ahttp-auth-endpoint` | Server-verified authorization endpoint |
| `data-ahttp-allow` / `data-ahttp-deny` | Policy filters |
| `data-ahttp-max-actions` | Hard action cap |

`data-ahttp-intent` is the one to set. Without it the engine identifies a control by its visible text or accessible name, which changes when the copy does.

| Access mode | Meaning |
|---|---|
| `public` | Any agent that loads the page can read and act |
| `dev` | Open only on localhost, `127.0.0.1`, `::1` or `file:` |
| `gate` | A SHA-256 in the page hides the graph from casual agents. Soft gate, not authentication |
| `owner` | Server-verified session with a short-lived policy |

`owner` is the production path. The page ships no secret: the agent authenticates against your backend, receives a short-lived token and policy, and the engine relocks when the token expires. `gate` is fine for pages that are not sensitive:

```html
<script src="ahttp.min.js"
        data-ahttp-access="gate"
        data-ahttp-key-hash="<sha256>"></script>
```

```bash
node bin/ahttp-cli.js --hash-key 'owner-secret'
AHTTP_OWNER_KEY='owner-secret' node bin/ahttp-mcp.js
```

Client-side JavaScript cannot enforce authorization. Whatever performs the mutation must re-check agent, tenant, object and intent on the server. See [docs/OWNER_MODE.md](docs/OWNER_MODE.md), [docs/SECURITY.md](docs/SECURITY.md) and the reference backend in [`examples/auth-server/`](examples/auth-server/).

For the draft WebMCP API, `ahttp.installWebMCP()` registers `ahttp_snapshot` and `ahttp_act` when `document.modelContext` exists. It is opt-in; see [docs/RESEARCH.md](docs/RESEARCH.md).

## Security

- Locks, hidden actions and `data-ahttp-confirm` are not authorization. The server must authorize every sensitive mutation.
- `gate` is a hint. The hash is in the page source.
- Action labels, URLs and values come from the page too, not only the text block. Treat every page-derived string as untrusted. `includeText: false` or `maxText: 0` drops the text block.
- Hidden-text filtering is heuristic. Don't put secrets in a page you wouldn't show the agent.
- The static MCP backend does not run JavaScript. Use `--browser` for script-dependent pages.
- The browser backend blocks private targets and non-HTTP schemes at the route layer. DNS rebinding is still possible; run it on a network you control.
- `confirmationToken` is one-time and expiring. It is not proof of human approval.
- No third-party audit. Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).

> [!WARNING]
> CDP mode attaches to a real browser. ahttp creates a fresh context by default; `--cdp-use-existing-profile` lets the agent act inside your signed-in profile and read its cookies. Use a dedicated profile.

## Known limitations

### Matching and rerenders

- Matching is heuristic, not a proof of identity. Stable anchors (intent, test id, DOM id, name, accessible name, text, title, placeholder, alt, href) are tried first; the fingerprint is a low-weight fallback.
- Two near-identical controls can land in the ambiguity band. The engine then returns `status: 'ambiguous'` with candidates and dispatches nothing. It does not guess.
- `confirm: true` does not resolve ambiguity. Re-snapshot, disambiguate with `data-ahttp-intent` or `data-testid`, or use `query`/`scope`.
- A disabled replacement is not an active target. An action whose expected effect is missing returns `status: 'no_effect'` when an `expect` rule is supplied; re-snapshot instead of retrying.
- Position and DOM order are tie-breakers only. A virtualized list that unmounts a row produces `not_found`, not a click on a recycled row.
- If the original control is replaced by a disabled twin and an active twin with the same label, the active twin is clicked: disabled candidates are filtered before scoring. A lone disabled replacement gives `not_found`.
- Looking an action up by label instead of by id (`act('OK')`) takes the first control with that label, even when several share it. Use ids or `data-ahttp-intent`.
- `pointer-events: none` does not hide a control; it is still listed.
- With an `expect` rule, a change that never comes returns `no_effect` only after `timeout` (1200 ms by default); pass a smaller `timeout` to fail faster.

### Shadow DOM and iframes

- Open shadow roots and `<slot>` content are scanned when the page exposes them. Closed shadow roots are unreachable.
- Same-origin iframe documents are scanned up to two levels deep. Cross-origin iframes are skipped, and the userscript skips all iframes (`@noframes`).
- Accessible names are a subset of the spec: `aria-owns`, some SVG name rules and references across shadow boundaries are missing. Browser mode includes CSS `::before`/`::after` text and SVG titles.
- The userscript panel shows one page and does not cross iframe boundaries.

### Virtualized lists

- Only mounted rows exist in the snapshot. An id from a row that was unmounted cannot be matched; the engine returns `not_found`.
- The engine does not scroll a virtualized container to revive a row. Do that with `scroll` on the container or a page-specific control, then re-snapshot.

### Other

- The hidden-text filter misses text drawn on canvas, set as a background image, or hidden by a stylesheet the page doesn't expose.
- `mini-dom` (static backend) is a hand-written parser, not an HTML5 tree builder: no foster parenting, no full table algorithm. Use `--browser` when exact parsing matters.
- The static backend follows `@import` three levels deep (16 sheets) and evaluates `screen`, `print`, `min-width`, `max-width`, `min-height` and `max-height`. Unknown media features count as matching.
- Legacy MCP clients get implicit page state. Modern clients carry `pageId`.
- The task benchmark is scripted, not an LLM evaluation.

## Breaking changes

None in 0.1.x. The matching work adds `status`, `candidates`, `targetHint`, `thresholds`, `effect` and `expect`; existing fields, error codes and snapshot lines are unchanged. A change that cannot stay additive bumps the version and is listed here before release.

## Development

```bash
npm ci
npm test                 # unit, network, MCP and browser tests
npm run typecheck
npm run lint
npm run test:bench       # benchmark and regression suites, needs Chromium
npm run smoke            # runtime and CLI against a local fixture, no dev dependencies
npm run build            # regenerate ahttp.min.js and self/ahttp.user.js
```

`npm test` skips the Playwright test when Chromium is missing. `AHTTP_REQUIRE_BROWSER=1` turns that skip into a failure; CI sets it. The giant-DOM scan time warns above `AHTTP_GIANT_MS` (default 150 ms) and never fails the run.

### Matching corpus

`npm test` runs the local regression corpus. To run or filter it directly:

```bash
npm run test:corpus
node corpus/runner.js --filter=login
```

The runner prints `case | match | diff | tokens | status`, writes
`bench/results.json`, and exits non-zero on a failure. Cases and fixtures live in
`corpus/`; the format is in [corpus/README.md](corpus/README.md). Everything runs
in jsdom against local HTML: no network, no live site, no browser required.

```text
ahttp.js                  browser engine, no runtime dependencies
ahttp.min.js              generated minified build
self/ahttp.user.js        generated userscript: engine plus panel
self/panel.js             panel source
bin/ahttp-cli.js          CLI inspector
bin/ahttp-mcp.js          MCP stdio server
lib/                      page fetch, SSRF guard, mini-dom, Playwright/CDP backend
benchmark/                torture, owner, pinned pages, checkout, tasks, MCP
scripts/                  build, demo, benchmark rendering
test/                     node:test suites
docs/                     API, security, decisions, research, roadmap
examples/                 Playwright, browser, MCP and server-auth examples
```

## License

MIT, see [LICENSE](LICENSE).
