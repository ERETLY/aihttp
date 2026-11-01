# Roadmap

What is not done yet.

## Not verified

- No LLM task benchmark. The 20-task suite uses a scripted agent. An LLM run needs a provider key, a budget and repeated trials; `benchmark/tasks.js` can be reused.
- No full `@playwright/mcp` comparison. The benchmark uses Playwright's `ariaSnapshot` in Chromium, not the MCP tool loop. A fair comparison needs the same agent, model, prompt and budget on both sides.
- No Stagehand or Browserbase run. Stagehand needs an LLM provider key for observe and act; installing the package alone only repeats the Playwright baseline.
- Not run against the official MCP Inspector. The stdio server is covered by `test/mcp.test.js` and the benchmark's JSON-RPC suite.
- No independent security review.
- Developed on Windows. macOS and Linux are covered only by CI.
- Not published to npm. Install from git with `npx github:ERETLY/ahttp`.
- No browser extension or bookmarklet. `docs/demo/index.html` is a static preview.

## Known gaps

- `mini-dom` is not an HTML5 tree builder. Malformed tables and unclosed formatting elements can produce a different tree from Chromium. Use browser mode when this matters.
- The static backend follows `@import` up to three levels (16 sheets, 2 MB each) and evaluates `screen`, `print`, `min-width`, `max-width`, `min-height` and `max-height`. Unknown media features count as matching, so a rare conditional block can apply where a real browser would skip it.
- Closed shadow roots and cross-origin iframes are not traversed.
- Accessible-name computation is a subset: `aria-owns`, hidden referenced nodes, some SVG rules and references across shadow boundaries are missing.
- Visibility filtering is heuristic. Canvas, background images, overlapping elements and other visual hiding can be missed.
- Browser mode validates every HTTP request at the Playwright route layer, but Chromium does its own DNS resolution, so DNS rebinding is not fully solved there. The static backend uses a pinned lookup.
- Browser-mode cancellation is checked before and after navigation; an in-flight Chromium navigation is not aborted by the MCP cancellation notification. The static fetch path does abort.
- The MCP confirmation token is not proof of human approval. MCP elicitation is not implemented.
- The WebMCP adapter is experimental and follows a Community Group draft. It may need changes when the API stabilizes.
- Action labels, URLs and values come from the page, so the model has to treat all of them as untrusted, not only the text block.
- Legacy MCP clients use implicit process state. Modern clients must carry `pageId`.

## Next measurements

1. Run the 20-task suite with at least two models and three trials per task; publish success, steps, tokens and cost.
2. Run the same tasks with `@playwright/mcp` and a fixed agent prompt.
3. Add a 100-task suite with search, pagination, modals, file inputs, selects and multi-page flows.
4. Add a browser-mode task suite where the static backend fails, and report the gap.
5. Add token counts for one Anthropic tokenizer and one OpenAI tokenizer, and label the model names.
6. Run the server-auth example through the MCP server with `--browser`, not only with curl.
7. Fuzz `mini-dom` with the html5lib-tests corpus and publish the mismatch categories.
