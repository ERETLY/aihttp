# aihttp

[![status: stable](https://img.shields.io/badge/status-stable-brightgreen)](#)
[![version](https://img.shields.io/github/package-json/v/ERETLY/aiweb)](https://github.com/ERETLY/aiweb/blob/main/package.json)
[![CI](https://github.com/ERETLY/aiweb/actions/workflows/ci.yml/badge.svg)](https://github.com/ERETLY/aiweb/actions/workflows/ci.yml)

**aihttp is the AI-First Web Format.** It turns a page into a compact, executable graph: the controls an agent can use, the text it can read, and the effect of each action. No screenshots, no raw DOM, no token bonfire.

One engine with no runtime dependencies. It ships as a browser file, a CLI, an HTTP server (`aihttp-serve`) and an MCP server. The package, the engine file, the browser global (`window.aihttp`) and the MCP tool names are all `aihttp`.

**1.0.0, stable.** The first stable release. The wire format is versioned (`aihttp/1`): additive changes are documented before any breaking one, and every release keeps the previous wire version readable. One maintainer, no third-party security audit yet; the repository's own suites pass. The spec is in [docs/AIHTTP.md](docs/AIHTTP.md).

## Should you use it?

Use it when the agent has to do something on the page: click, type, choose, follow a link. It keeps working after a rerender without new selectors, sends a few thousand tokens per page instead of the full HTML, and needs no browser grid.

Skip it when the agent only needs to read. A static article: fetch it and use Readability. Clean Markdown for an LLM: Jina Reader or Firecrawl. Screenshots: aihttp does not take them.

Jina, Firecrawl, and Readability turn a page into text. aihttp turns it into things an agent can operate. If you do not need the second part, use the first group. The benchmark is a tradeoff, not a winner.

## Quick start

### Userscript: 30 seconds

1. Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey.
2. Open [`self/aihttp.user.js`](https://raw.githubusercontent.com/ERETLY/aiweb/main/self/aihttp.user.js) and confirm the install.
3. Open any `http(s)` page, press **Alt+Shift+A**, type an id in the panel, press **Act**. No clone, no server, no upload.

### MCP: 5 minutes

```bash
git clone https://github.com/ERETLY/aiweb.git
cd aiweb
npm ci
npx playwright install chromium
```

Paste this into Claude Desktop or Cursor, replacing `/absolute/path/to/aiweb`:

```json
{
  "mcpServers": {
    "aihttp": {
      "command": "node",
      "args": ["/absolute/path/to/aiweb/bin/aihttp-mcp.js", "--browser"]
    }
  }
}
```

Restart the client, call `aihttp_open` with a URL, then `aihttp_snapshot` or `aihttp_act`. The MCP tool names are `aihttp_open`, `aihttp_snapshot`, `aihttp_act`, `aihttp_trace` and `aihttp_replay`. `--browser` runs a real Chromium and page JavaScript; without it the server parses static HTML only. Node 18 or newer; the Playwright step is only needed for `--browser`.

### CLI and local loop

```bash
node bin/aihttp-cli.js https://example.com --query "Buy"
node examples/agent-loop.js
```

The CLI reads static HTML and never clicks. The local loop uses Chromium, clicks a control with an `expect` rule, and prints the diff. [docs/DEMO.md](docs/DEMO.md) is a terminal transcript; `node scripts/demo.js` regenerates it.

### HTTP: the format as a service

```bash
npx aihttp-serve --port 8787
curl 'http://127.0.0.1:8787/?url=https%3A%2F%2Fexample.com'
```

`GET /?url=...` returns `application/aihttp+json` with the same action graph as the engine. `POST /act` runs one action by id. `GET /health` reports the format version. Use `--browser` for JavaScript pages, `--allow-private` for local targets, and `AIHTTP_TOKEN` to require a bearer token. The wire format is in [docs/AIHTTP.md](docs/AIHTTP.md).

## What it looks like

```text
aihttp | Widget shop | https://shop.test/cart
a1 input "Email" ph="you@example.com"
a2 button "Add to cart"
a3 a "Shipping help" -> /help
[text: untrusted]
Cart (1 item)
$49.00
```

Each action has an id, a tag, a label, and optional state or target. Page text is marked untrusted because it comes from the page.

`const step = await aihttp.act('a2')` returns `{ ok: true, action, diff }` plus a fresh snapshot. `act` waits for the page to settle; errors come back as values, not exceptions.

## Record once, replay deterministically

This is the part you will not find in other DOM-to-LLM bridges. Every action is
recorded as a portable fingerprint, not as `a12`. Export the trace, reload the
page, redeploy the site, then replay it:

```js
const trace = aihttp.trace();                 // { steps: [...] }
const check = await aihttp.replay(trace, { dryRun: true });
// check.steps[0] => { status: 'would_run', signals: ['intent'], score: 100 }

const run = await aihttp.replay(trace);       // follows navigations
// run.steps[1] => { status: 'ambiguous', candidates: [...] }
```

Replay resolves intent, test ids, names, labels and hrefs with the same
scoring and margin rules as `act`, so a renamed button still matches while two
identical twins stop the run. The result says exactly what happened:

| Status | Meaning |
|---|---|
| `ok` | Step executed |
| `would_run` | `dryRun` resolved it without executing |
| `not_found` | The anchor disappeared |
| `ambiguous` | Several controls match; nothing was clicked |
| `needs_value` | The step used a password and needs `values[index]` |
| `requires_confirmation` | The action is guarded; pass `confirm: true` |
| `url_mismatch` | `requireSameUrl` saw a different page |

Over MCP the same feature is `aihttp_trace` and `aihttp_replay`. Password values
never enter a trace: only their length is recorded, and replay takes the value
from `values`.

## Using it well

- Put `data-aihttp-intent` on controls that matter. Text labels change with copy; the intent attribute does not.
- Narrow the snapshot with `query` or `scope` instead of raising `maxActions`.
- Pass an `expect` rule so a missing effect returns `no_effect` instead of a silent success.
- Keep the `pageId` and re-snapshot after each action instead of reusing old ids.
- For a SPA or any page that needs JavaScript, run the MCP server with `--browser`.

## How it works

1. **Scan.** Keep visible interactive elements, assign ids like `a12`, record labels, roles, state, links, and page text.
2. **Act.** Resolve the id, check policy and confirmation, dispatch the event, wait for the page to settle.
3. **Diff.** Rescan and return only changed text and actions, so the next step starts from the diff.

Identity does not depend on one CSS selector. The engine scores intent attributes, test ids, DOM ids, names, accessible names, text, titles, placeholders, alt text, and hrefs; position and DOM order are weak tie-breakers. If two candidates are too close, `act` returns `status: 'ambiguous'` and clicks nothing.

Loading the file does nothing. `snapshot()` is synchronous; `act()` returns a promise.

## What it understands

The scanner is written against the web platform, not against a list of sites. There is no per-domain code.

| Layer | Covered |
|---|---|
| HTML controls | `input` (all text, date/time, number, range, color, file), `select` (single and multiple), `textarea`, `button`, `a[href]`, `summary`, `contenteditable` |
| Forms | labels, `for`, wrapping labels, fieldsets, disabled state, `form.hidden` vs `<input type="hidden">`, submit/reset |
| ARIA | roles and their kinds, `aria-label`, `aria-labelledby` (through shadow hosts), `aria-expanded` / `pressed` / `selected` / `checked`, tab/tree/grid/menu patterns |
| Shadow DOM | open roots, `<slot>` and assigned text, custom elements with an ElementInternals role, host-level click roles |
| CSS visibility | `display`, `visibility`, `opacity`, `clip` / `clip-path`, `text-indent`, zero font size, off-screen positioning, `content-visibility`, white-on-white, `inert`, `aria-hidden`, closed `<details>` |
| Frames | same-origin iframes two levels deep; cross-origin frames are skipped and counted |
| SVG | shapes are paint, not controls; `<title>` names the icon button around them |
| Virtualized lists | the mounted viewport is measured; off-screen items kept at inline `opacity:0` are not invented |
| Overlays | native `<dialog>`, backdrop, centered overlay; `aria-modal` alone is not enough; consent walls are reported as the page |
| Text | main vs chrome regions, hidden-text sanitization, a token budget with a hard character cap |

## For site owners

You do not have to change your markup. These attributes declare intent and limits:

| Attribute | Effect |
|---|---|
| `data-aihttp-intent` | Stable name for policy and agent code |
| `data-aihttp-confirm="reason"` | Requires confirmation |
| `data-aihttp-readonly` | Readable, not writable |
| `data-aihttp-ignore` | Removes the subtree from actions and text |
| `data-aihttp-access` | `public`, `dev`, `gate`, or `owner` |
| `data-aihttp-auth-endpoint` | Server-verified authorization endpoint |
| `data-aihttp-allow` / `data-aihttp-deny` | Policy filters |
| `data-aihttp-max-actions` | Hard action cap |

The `data-aihttp-*` namespace is part of the 1.0 contract. `public` is open. `dev` only works on localhost or `file:`. `gate` hides the graph behind a SHA-256 in the page; it is a hint, not authentication. `owner` is the production path: the agent authenticates with your backend, gets a short-lived token and policy, and the engine relocks when it expires.

Client-side JavaScript cannot enforce authorization. The server that performs the mutation must check agent, tenant, object, and intent. See [docs/OWNER_MODE.md](docs/OWNER_MODE.md), [docs/SECURITY.md](docs/SECURITY.md), and [`examples/auth-server/`](examples/auth-server/).

## Adopt it

Three levels, each useful on its own:

1. **Proxy.** Run `aihttp-serve` in front of any site. The agent gets the graph; the site stays untouched.
2. **Declare.** Add `data-aihttp-*` attributes to name actions, require confirmation, mark read-only controls and set a policy. This is the smallest change that makes an agent's actions auditable.
3. **Emit.** Return `application/aihttp+json` from your own app. The envelope is `{ protocol: "aihttp/1", format: "aihttp", formatVersion: 1, ... }`; the action schema and statuses are in [docs/AIHTTP.md](docs/AIHTTP.md). You can also embed the engine: it is one dependency-free file and `window.aihttp.snapshot()` returns the same graph.

A site that emits the format natively does not need a browser or a proxy: it is the data the agent would have scraped, shaped for the context window.

## Security

- Locks, hidden actions, and `data-aihttp-confirm` are not authorization; `gate` is a hint and the hash is in the page source.
- Treat labels, URLs, values, and text from the page as untrusted. `includeText: false` drops the text block.
- The static backend does not run JavaScript. Use `--browser` when scripts matter.
- `confirmationToken` is one-time and expiring. It is not proof of human approval.
- No third-party audit. Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

> [!WARNING]
> CDP mode attaches to a real browser. `--cdp-use-existing-profile` lets the agent act inside your signed-in profile and read its cookies. Use a dedicated profile.

## Benchmarks

If you only need text, Jina or Firecrawl are faster and cheaper. If you need to click, only the aihttp rows can. Jina and Firecrawl were called as real services; the accessibility row is Playwright's `ariaSnapshot`, not Playwright MCP.

Across the full token matrix, aihttp uses **6,128 tokens** where raw HTML needs **390,346**, the Chromium accessibility tree **102,552**, Readability Markdown **42,720**, and Jina Reader **45,454**. On a five-step checkout aihttp uses **289 tokens** against **3,983** for raw HTML. On 20 scripted tasks it uses **5,104** against **25,896** raw and **5,360** accessibility tree. Live time is 1.1–2.5 s per page; Jina and Firecrawl are 0.4–1.6 s, but they only return text. Scan time is 6–25 ms, Wikipedia 92 ms.

<details>
<summary>Full benchmark tables and method</summary>

<!-- BENCH:START -->

Token run: `2026-11-08T12:51:18.108Z`. aihttp 1.0.0 on win32 x64, Node v26.13.0, Chromium 156.0.8078.4, gpt-tokenizer 4.1.0/o200k_base.

### Tokens

Tokens an agent reads, lower is better. Checkout is five snapshots of one purchase flow, each page column is one snapshot of a pinned page, 20 tasks is every step of the scripted suite. Total adds the non-empty cells in a row.

| Method | What you get | Can act | Checkout (5 steps) | Hacker News | Wikipedia | Lobsters | GitHub | MDN | Total | 20 tasks |
|---|---|---|---|---|---|---|---|---|---|---|
| Raw HTML | serialized DOM | no | 3,983 | 11,771 | 191,129 | 17,909 | 105,767 | 59,787 | 390,346 | 25,896 |
| Markdown | Readability + Turndown | no | 68 | 5,136 | 26,579 | 6,542 | 1,387 | 3,008 | 42,720 | n/a |
| Jina Reader | hosted Markdown | no | n/a | 5,274 | 27,977 | 7,700 | 1,342 | 3,106 | 45,399 | n/a |
| Accessibility tree | roles and names | no | 346 | 10,099 | 73,404 | 5,918 | 5,404 | 7,381 | 102,552 | 5,360 |
| aihttp | actions, text, ids | yes | 289 | 1,162 | 1,130 | 1,105 | 1,286 | 1,156 | 6,128 | 5,104 |
| aihttp self | actions, text, ids | yes | 289 | 1,170 | 1,148 | 1,116 | 4,208 | 1,242 | 9,173 | 5,104 |

Only the two aihttp rows can click; the baselines score 0/20 on the task suite because they only read. `aihttp self` is the same engine loaded as `self/aihttp.user.js` in Chromium.

### Time

Wall-clock numbers from one machine, relative at best. Scan from `2026-11-05T07:40:42.457Z`, live from `2026-11-05T07:40:42.457Z`; Jina and Firecrawl from `2026-11-01T05:58:12.040Z`.

**Checkout.** Average per step over five local snapshots. The hosted readers cannot run it.

| Method | Time per step |
|---|---:|
| Accessibility tree | 4.6 ms |
| Raw HTML | 4.6 ms |
| Markdown | 13.6 ms |
| aihttp | 86.8 ms |
| aihttp self | 84.9 ms |

**Live.** URL to content, one request per page, 2026-11-05:

| Method | Hacker News | Wikipedia | Lobsters | GitHub | MDN |
|---|---:|---:|---:|---:|---:|
| aihttp | 1,871 ms | 1,137 ms | 2,130 ms | 2,513 ms | 1,376 ms |
| aihttp self | 1,462 ms | 1,465 ms | 1,409 ms | 2,687 ms | 1,051 ms |
| Jina Reader | 1,179 ms | 1,506 ms | 748 ms | 756 ms | 427 ms |
| Firecrawl | 1,320 ms | 1,576 ms | 1,169 ms | 1,589 ms | 468 ms |

Single runs, not medians. `aihttp` fetches the page and its linked stylesheets in Node and scans it. `aihttp self` loads the page in Chromium with the userscript injected and takes a snapshot. The hosted readers return Markdown only.

**Scan.** One snapshot per pinned page. Raw HTML, the accessibility tree and `aihttp self` run in Chromium on the page served from localhost; Markdown and `aihttp` run in Node.

| Method | Hacker News | Wikipedia | Lobsters | GitHub | MDN |
|---|---:|---:|---:|---:|---:|
| Raw HTML | 29 ms | 249 ms | 48 ms | 45 ms | 16 ms |
| Markdown | 331 ms | 1,032 ms | 484 ms | 262 ms | 309 ms |
| Accessibility tree | 95 ms | 310 ms | 77 ms | 85 ms | 97 ms |
| aihttp | 16 ms | 92 ms | 6 ms | 20 ms | 25 ms |
| aihttp self | 34 ms | 163 ms | 32 ms | 53 ms | 30 ms |

Hosted readers have no separate scan step; their time is in Live time.

### Caveats

- No LLM in the loop. The task runner is a script.
- One win32 x64 machine. Scan time is the least portable number.
- Accessibility token counts depend on the Chromium build.
- Jina Reader (`r.jina.ai`) and Firecrawl (v2 scrape) fetch the live page, not the pinned HTML. Without `JINA_API_KEY`, Jina can return 403 on GitHub.
- Jina and Firecrawl live timings are from `2026-11-01T05:58:12.040Z`; local methods were re-measured.

<!-- BENCH:END -->

</details>

Reproduce with Chromium: `npm run bench` (tokens, checkout, tasks), `npm run bench:self` (userscript), `npm run bench:time` (timings). `npm run bench:render` rewrites the block above.

## Coverage matrix

`npm run bench:web` measures the engine against an independent oracle of
reachable controls on 385 public sites (`benchmark/web-sites.json`). It is not
part of CI: it needs the public network and sites change without notice. The
report is written to `benchmark/web-matrix-results.json`.

```bash
npm run bench:web
node benchmark/web-matrix.js --category=forms
node benchmark/web-matrix.js --ids=mdn-input,wikipedia-en
```

`npm run bench:web:summary` prints the weighted recall, mean, phantom count,
below-90 list and scan-time distribution from the last JSON, so the numbers
below can be reproduced from one run.

Each site is measured once after a scroll pass, so lazy sections exist. The
matrix reports weighted recall (matched / oracle-visible controls), phantom
actions, and separates blocked sites (bot wall, consent modal) from network
errors. Snapshot and oracle run in the same synchronous frame: a virtualized
feed (Mastodon) keeps off-screen items mounted at `opacity:0` and re-renders
between two evaluates, which used to count them as visible. One clean run on
the final engine: 385 configured, 324 loaded, 46 blocked, 14 network errors from
the environment, 1 navigation error, 312 measured, **99.7% weighted recall**
(99.8% mean), **1 site below 90%** (Upwork at 89.7%, a job board that virtualizes
most of its listing chrome) and 5,269 phantom actions. Every category is above
98%: forms 98.3%, frames 98.3% (cross-origin iframe content is unreadable by
design), tables 99.5%, docs 99.5%, payments 100%, social 100%, forums 100%,
ecommerce 100%. The sites that were below 90% before the last fixes now measure
100% (Ant Design, Open Library, Plaid, Reddit, Wayfair), 99.1–100% (the three
W3Schools pages), 100% (Archive.org) and 98.3% (MDN's iframe page). The matrix
is a finding tool, not a scoreboard. Engine scan time across the measured pages:
median 37 ms, p95 188 ms, max 722 ms. The wall time is page load, not the scan.

A blocked site is not a coverage failure. A consent dialog with Accept/Reject
controls is the page until a decision is made, so the matrix reports it
separately instead of counting the page behind it as missed.

## Known limitations

### Matching and rerenders

- Matching is heuristic. Stable anchors are tried first; the old fingerprint is a low-weight fallback.
- Two close candidates return `status: 'ambiguous'` with no event. Re-snapshot, or add `data-aihttp-intent`/`data-testid`.
- A disabled replacement is not an active target. With an `expect` rule, a missing change returns `status: 'no_effect'` after `timeout` (1200 ms by default).

### Shadow DOM and iframes

- Open shadow roots and slots are scanned. Closed roots are unreachable.
- Same-origin iframes are scanned two levels deep. Cross-origin frames are skipped; the userscript skips all iframes.
- SVG shapes (`rect`, `path`, `circle`) are paint, not controls; the button or link around the icon is the action.

### Modals and consent

- A dialog becomes the scan root only when it is actually blocking: a native open dialog, a backdrop, or a centered box covering a quarter of the viewport. `aria-modal="true"` on a bottom cookie sheet is not enough.
- A modal that exposes no controls falls back to the document (`meta.modalFallback`), so an empty consent shell cannot hide the page.
- A consent dialog with Accept/Reject controls is returned as the page, because the page behind it is not reachable until a decision. Dismiss it, then snapshot again.

### Virtualized lists

- Only mounted rows exist. An id from an unmounted row cannot be matched.
- aihttp does not scroll the container to revive a row. Scroll it, then re-snapshot.

### Other

- Hover-only controls become `hover` actions when an inline handler or a CSS `:hover` rule reveals a hidden descendant. `act(id, { hover: true })` applies the reveal; color-only rules are ignored.
- Hidden-text filtering is heuristic. Canvas text, background images, and stylesheets the page does not expose can be missed.
- `act` latency is the settle wait, not the scan: about 40 ms with no network, and at least 220 ms of network quiet after a request, so roughly 240 ms or more. A request that stays open can hold the action for most of `timeout`.
- The static backend is a small HTML parser, not a full HTML5 tree builder. Use `--browser` when exact parsing matters.

## Breaking changes

`1.0.0` renamed everything from `ahttp` to `aihttp` with no aliases. The npm package is `aihttp`, the engine file is `aihttp.js`, the browser global is `window.aihttp`, the binaries are `aihttp`/`aihttp-mcp`/`aihttp-serve`, the attributes are `data-aihttp-*`, and the MCP tool names are `aihttp_*`. The text snapshot header is now `aihttp | title | url`; JSON consumers should read `protocol: "aihttp/1"`.

`0.2.0` made ambiguity explicit. `act` no longer clicks a near-tie: it returns `status: 'ambiguous'`. Results also carry `status`, and `expect` can return `status: 'no_effect'`. Existing fields and error codes are unchanged.

Every PR that changes `aihttp.js`, `aihttp.d.ts`, `bin/`, or `lib/` must include `npm run bump -- patch` (or `minor`/`major`). The maintainer tags after merge. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```bash
npm ci
npm test
npm run typecheck && npm run lint
npm run test:bench
npm run build
```

`npm test` skips Playwright tests when Chromium is missing; `AIHTTP_REQUIRE_BROWSER=1` makes that a failure. The corpus runs in jsdom against local HTML: `npm run test:corpus` writes `bench/results.json` and exits non-zero on a failure. Release with `npm run bump -- patch|minor|major|X.Y.Z`.

## License

MIT, see [LICENSE](LICENSE).
