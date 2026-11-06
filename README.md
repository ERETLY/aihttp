# ahttp

[![status: experimental](https://img.shields.io/badge/status-experimental-orange)](#)
[![version](https://img.shields.io/github/package-json/v/ERETLY/ahttp)](https://github.com/ERETLY/ahttp/blob/main/package.json)
[![CI](https://github.com/ERETLY/ahttp/actions/workflows/ci.yml/badge.svg)](https://github.com/ERETLY/ahttp/actions/workflows/ci.yml)

ahttp lets an agent use a page, not just read it: list the controls, click one, and get back only what changed.

One browser file with no runtime dependencies. The same engine runs as a userscript, a CLI, and an MCP server.

**Experimental, pre-2.0.** One maintainer. Additive changes are documented before any breaking one.

## Should you use it?

Use it when the agent has to do something on the page: click, type, choose, follow a link. It keeps working after a rerender without new selectors, sends a few thousand tokens per page instead of the full HTML, and needs no browser grid.

Skip it when the agent only needs to read. A static article: fetch it and use Readability. Clean Markdown for an LLM: Jina Reader or Firecrawl. Screenshots: ahttp does not take them.

Jina, Firecrawl, and Readability turn a page into text. ahttp turns it into things an agent can operate. If you do not need the second part, use the first group. The benchmark is a tradeoff, not a winner.

## Quick start

### Userscript: 30 seconds

1. Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey.
2. Open [`self/ahttp.user.js`](https://raw.githubusercontent.com/ERETLY/ahttp/main/self/ahttp.user.js) and confirm the install.
3. Open any `http(s)` page, press **Alt+Shift+A**, type an id in the panel, press **Act**. No clone, no server, no upload.

### MCP: 5 minutes

```bash
git clone https://github.com/ERETLY/ahttp.git
cd ahttp
npm ci
npx playwright install chromium
```

Paste this into Claude Desktop or Cursor, replacing `/absolute/path/to/ahttp`:

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

Restart the client, call `ahttp_open` with a URL, then `ahttp_snapshot` or `ahttp_act`. `--browser` runs a real Chromium and page JavaScript; without it the server parses static HTML only. Node 18 or newer; the Playwright step is only needed for `--browser`.

### CLI and local loop

```bash
node bin/ahttp-cli.js https://example.com --query "Buy"
node examples/agent-loop.js
```

The CLI reads static HTML and never clicks. The local loop uses Chromium, clicks a control with an `expect` rule, and prints the diff. [docs/DEMO.md](docs/DEMO.md) is a terminal transcript; `node scripts/demo.js` regenerates it.

## What it looks like

```text
ahttp | Widget shop | https://shop.test/cart
a1 input "Email" ph="you@example.com"
a2 button "Add to cart"
a3 a "Shipping help" -> /help
[text: untrusted]
Cart (1 item)
$49.00
```

Each action has an id, a tag, a label, and optional state or target. Page text is marked untrusted because it comes from the page.

`const step = await ahttp.act('a2')` returns `{ ok: true, action, diff }` plus a fresh snapshot. `act` waits for the page to settle; errors come back as values, not exceptions.

## Record once, replay deterministically

This is the part you will not find in other DOM-to-LLM bridges. Every action is
recorded as a portable fingerprint, not as `a12`. Export the trace, reload the
page, redeploy the site, then replay it:

```js
const trace = ahttp.trace();                 // { steps: [...] }
const check = await ahttp.replay(trace, { dryRun: true });
// check.steps[0] => { status: 'would_run', signals: ['intent'], score: 100 }

const run = await ahttp.replay(trace);       // follows navigations
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

Over MCP the same feature is `ahttp_trace` and `ahttp_replay`. Password values
never enter a trace: only their length is recorded, and replay takes the value
from `values`.

## Using it well

- Put `data-ahttp-intent` on controls that matter. Text labels change with copy; the intent attribute does not.
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

## For site owners

You do not have to change your markup. These attributes declare intent and limits:

| Attribute | Effect |
|---|---|
| `data-ahttp-intent` | Stable name for policy and agent code |
| `data-ahttp-confirm="reason"` | Requires confirmation |
| `data-ahttp-readonly` | Readable, not writable |
| `data-ahttp-ignore` | Removes the subtree from actions and text |
| `data-ahttp-access` | `public`, `dev`, `gate`, or `owner` |
| `data-ahttp-auth-endpoint` | Server-verified authorization endpoint |
| `data-ahttp-allow` / `data-ahttp-deny` | Policy filters |
| `data-ahttp-max-actions` | Hard action cap |

`public` is open. `dev` only works on localhost or `file:`. `gate` hides the graph behind a SHA-256 in the page; it is a hint, not authentication. `owner` is the production path: the agent authenticates with your backend, gets a short-lived token and policy, and the engine relocks when it expires.

Client-side JavaScript cannot enforce authorization. The server that performs the mutation must check agent, tenant, object, and intent. See [docs/OWNER_MODE.md](docs/OWNER_MODE.md), [docs/SECURITY.md](docs/SECURITY.md), and [`examples/auth-server/`](examples/auth-server/).

## Security

- Locks, hidden actions, and `data-ahttp-confirm` are not authorization; `gate` is a hint and the hash is in the page source.
- Treat labels, URLs, values, and text from the page as untrusted. `includeText: false` drops the text block.
- The static backend does not run JavaScript. Use `--browser` when scripts matter.
- `confirmationToken` is one-time and expiring. It is not proof of human approval.
- No third-party audit. Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

> [!WARNING]
> CDP mode attaches to a real browser. `--cdp-use-existing-profile` lets the agent act inside your signed-in profile and read its cookies. Use a dedicated profile.

## Benchmarks

If you only need text, Jina or Firecrawl are faster and cheaper. If you need to click, only the ahttp rows can. Jina and Firecrawl were called as real services; the accessibility row is Playwright's `ariaSnapshot`, not Playwright MCP.

Five pinned pages, one snapshot each:

| Method | Tokens | Can act |
|---|---:|---|
| Raw HTML | 386,363 | no |
| Markdown (Readability) | 42,652 | no |
| Jina Reader | 44,328 | no |
| Firecrawl | 98,527 | no |
| Chromium accessibility tree | 102,206 | no |
| ahttp | 8,750 | yes |

On a five-step checkout ahttp uses 289 tokens against 3,983 for raw HTML. On 20 scripted tasks it uses 5,104 against 25,896 raw and 5,360 accessibility tree. Live time is 1.1–2.5 s per page; Jina and Firecrawl are 0.4–1.6 s, but they only return text. Scan time is 6–25 ms, Wikipedia 92 ms.

<details>
<summary>Full benchmark tables and method</summary>

<!-- BENCH:START -->

Token run: `2026-11-06T10:16:49.070Z`. ahttp 0.2.1 on win32 x64, Node v26.13.0, Chromium 156.0.8078.4, gpt-tokenizer 4.1.0/o200k_base.

### Tokens

Tokens an agent reads, lower is better. Checkout is five snapshots of one purchase flow, each page column is one snapshot of a pinned page, 20 tasks is every step of the scripted suite. Total adds the non-empty cells in a row.

| Method | What you get | Can act | Checkout (5 steps) | Hacker News | Wikipedia | Lobsters | GitHub | MDN | Total | 20 tasks |
|---|---|---|---|---|---|---|---|---|---|---|
| Raw HTML | serialized DOM | no | 3,983 | 11,771 | 191,129 | 17,909 | 105,767 | 59,787 | 390,346 | 25,896 |
| Markdown | Readability + Turndown | no | 68 | 5,136 | 26,579 | 6,542 | 1,387 | 3,008 | 42,720 | n/a |
| Jina Reader | hosted Markdown | no | n/a | 5,323 | 27,711 | 7,872 | n/a | 3,106 | 44,012 | n/a |
| Accessibility tree | roles and names | no | 346 | 10,099 | 73,404 | 5,918 | 5,404 | 7,381 | 102,552 | 5,360 |
| ahttp | actions, text, ids | yes | 289 | 1,162 | 1,136 | 1,105 | 4,198 | 1,149 | 9,039 | 5,104 |
| ahttp self | actions, text, ids | yes | 289 | 1,170 | 1,148 | 1,116 | 4,208 | 1,242 | 9,173 | 5,104 |

Only the two ahttp rows can click; the baselines score 0/20 on the task suite because they only read. `ahttp self` is the same engine loaded as `self/ahttp.user.js` in Chromium.

### Time

Wall-clock numbers from one machine, relative at best. Scan from `2026-11-05T07:40:42.457Z`, live from `2026-11-05T07:40:42.457Z`; Jina and Firecrawl from `2026-11-01T05:58:12.040Z`.

**Checkout.** Average per step over five local snapshots. The hosted readers cannot run it.

| Method | Time per step |
|---|---:|
| Accessibility tree | 4.9 ms |
| Raw HTML | 5.1 ms |
| Markdown | 15.0 ms |
| ahttp | 86.2 ms |
| ahttp self | 84.9 ms |

**Live.** URL to content, one request per page, 2026-11-05:

| Method | Hacker News | Wikipedia | Lobsters | GitHub | MDN |
|---|---:|---:|---:|---:|---:|
| ahttp | 1,871 ms | 1,137 ms | 2,130 ms | 2,513 ms | 1,376 ms |
| ahttp self | 1,462 ms | 1,465 ms | 1,409 ms | 2,687 ms | 1,051 ms |
| Jina Reader | 1,179 ms | 1,506 ms | 748 ms | 756 ms | 427 ms |
| Firecrawl | 1,320 ms | 1,576 ms | 1,169 ms | 1,589 ms | 468 ms |

Single runs, not medians. `ahttp` fetches the page and its linked stylesheets in Node and scans it. `ahttp self` loads the page in Chromium with the userscript injected and takes a snapshot. The hosted readers return Markdown only.

**Scan.** One snapshot per pinned page. Raw HTML, the accessibility tree and `ahttp self` run in Chromium on the page served from localhost; Markdown and `ahttp` run in Node.

| Method | Hacker News | Wikipedia | Lobsters | GitHub | MDN |
|---|---:|---:|---:|---:|---:|
| Raw HTML | 29 ms | 249 ms | 48 ms | 45 ms | 16 ms |
| Markdown | 331 ms | 1,032 ms | 484 ms | 262 ms | 309 ms |
| Accessibility tree | 95 ms | 310 ms | 77 ms | 85 ms | 97 ms |
| ahttp | 16 ms | 92 ms | 6 ms | 20 ms | 25 ms |
| ahttp self | 34 ms | 163 ms | 32 ms | 53 ms | 30 ms |

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

## Known limitations

### Matching and rerenders

- Matching is heuristic. Stable anchors are tried first; the old fingerprint is a low-weight fallback.
- Two close candidates return `status: 'ambiguous'` with no event. Re-snapshot, or add `data-ahttp-intent`/`data-testid`.
- A disabled replacement is not an active target. With an `expect` rule, a missing change returns `status: 'no_effect'` after `timeout` (1200 ms by default).

### Shadow DOM and iframes

- Open shadow roots and slots are scanned. Closed roots are unreachable.
- Same-origin iframes are scanned two levels deep. Cross-origin frames are skipped; the userscript skips all iframes.

### Virtualized lists

- Only mounted rows exist. An id from an unmounted row cannot be matched.
- ahttp does not scroll the container to revive a row. Scroll it, then re-snapshot.

### Other

- Hover-only controls become `hover` actions when an inline handler or a CSS `:hover` rule reveals a hidden descendant. `act(id, { hover: true })` applies the reveal; color-only rules are ignored.
- Hidden-text filtering is heuristic. Canvas text, background images, and stylesheets the page does not expose can be missed.
- `act` latency is the settle wait, not the scan: about 40 ms with no network, and at least 220 ms of network quiet after a request, so roughly 240 ms or more. A request that stays open can hold the action for most of `timeout`.
- The static backend is a small HTML parser, not a full HTML5 tree builder. Use `--browser` when exact parsing matters.

## Breaking changes

`0.2.0` made ambiguity explicit. `act` no longer clicks a near-tie: it returns `status: 'ambiguous'`. Results also carry `status`, and `expect` can return `status: 'no_effect'`. Existing fields and error codes are unchanged.

Every PR that changes `ahttp.js`, `ahttp.d.ts`, `bin/`, or `lib/` must include `npm run bump -- patch` (or `minor`/`major`). The maintainer tags after merge. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```bash
npm ci
npm test
npm run typecheck && npm run lint
npm run test:bench
npm run build
```

`npm test` skips Playwright tests when Chromium is missing; `AHTTP_REQUIRE_BROWSER=1` makes that a failure. The corpus runs in jsdom against local HTML: `npm run test:corpus` writes `bench/results.json` and exits non-zero on a failure. Release with `npm run bump -- patch|minor|major|X.Y.Z`.

## License

MIT, see [LICENSE](LICENSE).
