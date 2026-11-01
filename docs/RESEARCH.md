# Research and positioning

Checked 2026-10-31. This file records what was verified and what remains a claim that needs testing.

## WebMCP

The WebMCP specification is a Draft Community Group Report from the W3C Web Machine Learning Community Group, dated 27 October 2026 (checked again on 31 October 2026). It is not a W3C Standard and is not on the Standards Track. The report defines `document.modelContext` (not `navigator.modelContext`, which appears in older previews and blog posts). It registers tools with `registerTool(tool, options)`, exposes `getTools()`, executes with `executeTool(tool, input, options)`, and carries annotations including `readOnlyHint`, `untrustedContentHint`, `consequentialHint` and `debugging`. `registerTool()` resolves to `undefined`; aborting the registration signal removes the tool.

What this means for ahttp:

- ahttp's `data-ahttp-*` contract is independent of WebMCP and works today.
- `ahttp.installWebMCP()` is an opt-in adapter. It feature-detects `document.modelContext`, registers `ahttp_snapshot` and `ahttp_act`, and returns `webmcp_unavailable` when the API is absent. It does not auto-register.
- The adapter returns a `close()` function that aborts the registration signal.
- Treat the adapter as draft compatibility, not a stable API promise. The context moved from `navigator` to `document` in [webmachinelearning/webmcp#184](https://github.com/webmachinelearning/webmcp/pull/184), and Chromium removed the old `navigator.modelContext` API.

Sources: [WebMCP Draft Community Group Report](https://webmachinelearning.github.io/webmcp/), [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api), [Chrome WebMCP overview](https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/webmcp).

## Playwright MCP

Playwright MCP is a real, widely used MCP server. It drives a browser and returns accessibility snapshots with refs such as `[ref=e5]`; action tools take the ref. Refs are invalidated when the page changes. It has a large tool surface (navigation, forms, tabs, storage, network, PDF, vision options) and is not a security boundary. Its current README also says it collects WebMCP tools by default and can disable them with `--no-webmcp`.

The benchmark in this repository uses Playwright's `ariaSnapshot` in Chromium. It does not run the full Playwright MCP tool loop. The checkout result therefore says something about the snapshot payload, not about Playwright MCP's end-to-end behavior. That distinction is in the README.

Sources: [Playwright MCP snapshots](https://playwright.dev/mcp/snapshots), [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp), [Playwright 1.64 release notes](https://playwright.dev/docs/release-notes).

## Stagehand

Stagehand is an SDK with AI primitives (`act`, `extract`, `observe`) plus Playwright-style page methods, built by Browserbase. It is a browser automation framework, not a site-owner contract. It does not define `data-ahttp-*` attributes and it does not return a per-action diff from a page-declared graph.

Source: [Stagehand introduction](https://docs.stagehand.dev/).

## Browser Use

Browser Use provides an open-source agent library and a cloud browser/run API. Its quickstart focuses on giving an agent a task and getting a result, or connecting Playwright/its SDK to a cloud browser over CDP. It is complementary to ahttp: ahttp could be one observation/action layer inside an agent that uses Browser Use for the browser.

Source: [Browser Use quickstart](https://docs.browser-use.com/cloud/quickstart).

## llms.txt

`llms.txt` is a proposal for a Markdown file at the site root or a subpath, with links to LLM-friendly content. Version 2 was modified in August 2026 and recommends Markdown versions of pages and `rel="alternate" type="text/markdown"` links. It is static content guidance; it cannot describe a logged-in cart, a modal that appeared after a fetch, or execute an action.

ahttp complements it: an owner can publish `llms.txt` for documentation and use `data-ahttp-*` for interactive controls. The repository's own `llms.txt` is a manifest for coding agents, not a runtime feature.

Source: [The /llms.txt file, v2](https://llmstxt.org/).

## MCP

The MCP specification has a legacy handshake era through `2025-11-25` and a modern per-request era starting with `2026-07-28`. Modern requests carry version, client info and capabilities in `_meta`; `server/discover` is mandatory; tool results use `resultType`. The ahttp server implements both eras and explicit `pageId` handles for the modern path.

Source: [MCP versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning), [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

## Positioning

In one sentence: ahttp is a small, site-declarable action layer for agents, with stable ids, guardrails and diffs; it is not a general browser agent and it is not always the smallest context.

The strongest differentiators are:

1. The site owner can declare intent, confirmation, read-only and ignore rules directly on controls.
2. The agent gets an executable action graph and a semantic diff, not just a page description.
3. The browser file stays dormant until called and has no runtime dependencies.
4. A static HTML mode exists for lightweight pages, with an explicit browser mode for SPAs.

The weakest differentiators are:

1. Token size. A compact accessibility snapshot or Markdown can be smaller, especially on small forms.
2. Browser coverage. Playwright MCP is far more capable as a general browser tool.
3. Ecosystem. WebMCP may become the browser-native path; ahttp's adapter is draft compatibility.
4. Evidence. There is no independent user study or LLM task benchmark yet.
