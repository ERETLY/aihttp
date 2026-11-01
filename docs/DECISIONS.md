# Decisions

## Version

The API, MCP schema and access modes are still moving. The package is marked `0.1.0`, not `1.x`, while the API has no external users.

## Parser: keep `mini-dom` for the zero-dependency path

The browser file must stay dependency-free. The static Node backend also uses a parser that does not require a native module or a browser. `mini-dom` is small, fast on the checked-in fixtures, and handles the malformed inputs in `test/parser.test.js` without throwing.

Comparison with `linkedom` (parse5-based) on 2026-10-31:

| Case | mini-dom elements | linkedom elements | mini-dom median | linkedom median |
|---|---:|---:|---:|---:|
| 01 React store | 5 | 6 | 0.07 ms | 0.19 ms |
| 02 div UI | 20 | 21 | 0.15 ms | 0.26 ms |
| 03 shadow DOM | 7 | 8 | 0.04 ms | 0.10 ms |
| 04 async modal | 13 | 14 | 0.05 ms | 0.13 ms |
| 05 security | 19 | 20 | 0.07 ms | 0.15 ms |
| 06 data grid | 19 | 20 | 0.05 ms | 0.13 ms |
| 07 icon-only | 24 | 25 | 0.07 ms | 0.18 ms |
| 08 contenteditable | 12 | 13 | 0.04 ms | 0.09 ms |
| 09 giant DOM | 12 | 13 | 0.05 ms | 0.10 ms |
| ecommerce | 11 | 12 | 0.06 ms | 0.09 ms |
| malformed table | 7 | 5 | 0.01 ms | 0.04 ms |
| unclosed markup | 7 | 5 | 0.02 ms | 0.03 ms |

The one-element difference on well-formed fixtures is the document element. The malformed table and unclosed markup produce different trees, which is the expected HTML5 tree-construction difference. The parser is a fallback, not a conformance claim. The browser backend is the answer for pages whose behavior depends on exact HTML parsing or JavaScript.

Decision: keep `mini-dom` as the default zero-dependency parser, fuzz it, and use Playwright when correctness matters. Do not add linkedom/parse5 to the default runtime.

Reproduce: `node benchmark/parser-compare.js`.

## Browser backend

The static MCP server does not execute JavaScript. That was the main functional gap for SPAs. `--browser` uses Playwright and Chromium; `--cdp` attaches to a running Chrome. Playwright is an optional peer dependency, so the static backend and the browser file remain dependency-free.

The browser mode is not the default because it costs a browser download, a process, and a larger trust surface. `--browser` is explicit.

## MCP protocol

The server is dual-era:

- Legacy clients use `initialize` through `2025-11-25` and may rely on an implicit open page.
- Modern `2026-07-28` clients use `server/discover` and per-request `_meta`. They must carry the returned `pageId`; the server does not infer state from the connection.

The modern path adds `resultType: "complete"` and returns `structuredContent` for the page handle and confirmation token. The legacy path keeps the older result shape.

This is a small hand-written JSON-RPC server, not the official SDK. The protocol tests cover discovery, listing, calls, invalid tools, page handles, token replay and cancellation. It has not been run against the official MCP Inspector yet.

## Confirmation

The old `confirm: true` argument was controlled by the same model that requested the action. The new MCP flow returns a one-time, expiring token bound to the page and action; the first call performs no DOM event. This is an accident barrier, not a human-approval proof. Elicitation is not implemented because it depends on client capabilities and a request/response channel that the simple stdio loop does not currently expose.

## Owner mode

`gate` is the static-hash mode. The hash is in the page, so the mode is named for what it is. `owner` means the server-verified endpoint flow. The legacy `data-ahttp-private` alias maps to `gate` when a key/hash is present and to `owner` when an endpoint is present.

The reference backends in `examples/auth-server/` and `examples/nextjs-route/` show both the authorize response and per-action enforcement. The client-side `authorizeAction` hook is not the authorization boundary.

## Accessible names

The engine uses a subset of the accessible-name algorithm: `data-ahttp-intent`, `aria-labelledby`, `aria-label`, native labels and alt text, name from content, then title and placeholder. It does not implement CSS generated content, hidden referenced nodes, or every SVG rule. `dom-accessibility-api` is installed as a development reference for tests, not as a browser runtime dependency. `test/accname.test.js` checks the common cases and records one deliberate difference: ahttp uses `placeholder` as a practical fallback label, while the reference algorithm leaves the name empty. The alternative would add a dependency to the zero-dependency browser file, which is not justified for the current label set.

## Token counts

The README used `ceil(bytes / 4)`. The benchmark now uses `gpt-tokenizer` 4.1.0 `countTokens` with `o200k_base`. It is a real tokenizer, but not the tokenizer for every model. The engine's JSON `meta.tokens` remains an estimate and is labeled as such.

## Benchmark competitors

The earlier table called local imitations "Jina Reader style", "Firecrawl style" and "Playwright MCP style". That was not a real comparison. The new table uses:

- Raw HTML from the same live DOM.
- Readability + Turndown for Markdown.
- Playwright `ariaSnapshot` from Chromium.
- Jina Reader and Firecrawl over their hosted APIs, for the pinned pages only.
- ahttp driven in Chromium.

Stagehand and the full `@playwright/mcp` loop were not run. Stagehand needs an LLM provider key for observe and act; the MCP loop needs a client harness. Jina and Firecrawl fetch the live page, not the pinned fixture, so their columns are marked as such. On the checkout, ahttp is larger than the accessibility snapshot and Markdown.

## Package name

`npm view ahttp` returns 404 with an "unpublished" notice. The name is not currently available as a published package. Do not rename without checking the namespace again. If npm rejects the name, `ahttp-agent`, `dom-action-bridge`, or `ahttp-mcp` are reasonable alternatives; the repository name should stay `ahttp`.
