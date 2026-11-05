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
{ "mcpServers": { "ahttp": { "command": "node", "args": ["/absolute/path/to/ahttp/bin/ahttp-mcp.js", "--browser"] } } }
```

Restart the client, call `ahttp_open` with a URL, then `ahttp_snapshot` or `ahttp_act`. Drop `--browser` for static HTML.

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

If you only need text, Jina or Firecrawl are faster and cheaper. If you need to click, only the ahttp rows can.

Five pinned pages, one snapshot each:

| Method | Tokens | Can act |
|---|---:|---|
| Raw HTML | 390,346 | no |
| Markdown (Readability) | 42,720 | no |
| Jina Reader | 44,328 | no |
| Firecrawl | 98,527 | no |
| Chromium accessibility tree | 102,552 | no |
| ahttp | 9,039 | yes |

On a five-step checkout ahttp uses 289 tokens against 3,983 for raw HTML. On 20 scripted tasks it uses 5,104 against 25,896 raw and 5,360 accessibility tree. Live time is 1.4–4.4 s per page; Jina and Firecrawl are 0.4–1.6 s, but they only return text. Scan time is 4–39 ms except Wikipedia at 3.2 s.

<details>
<summary>Full benchmark tables and method</summary>

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
- `act` latency is the settle wait, not the scan. A request that stays open can hold the action for most of `timeout`.
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
