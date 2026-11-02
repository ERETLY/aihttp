# Examples

These examples use the local `ahttp.js` in this repository. They are not published packages.

## Browser

```bash
npm install
npx playwright install chromium
node examples/agent-loop.js                          # local fixture, no network
node examples/browser/playwright.js https://example.com
node examples/browser/puppeteer.js https://example.com   # needs: npm install puppeteer
```

`agent-loop.js` is the short version of the loop: snapshot, choose a control by
label, act with an `expect` rule, print the diff. It loads a local fixture in
Chromium and never touches the network. The Playwright example is run in this
repository's test environment. The Puppeteer example needs Puppeteer and is not
part of the default test run.

## MCP

Copy the relevant JSON into your client's MCP configuration and replace `/absolute/path/to/ahttp`.

- `mcp/claude-desktop-browser.json`: Claude Desktop, browser backend.
- `mcp/cursor-static.json`: Cursor, static HTML backend.
- `mcp/vscode-browser.json`: VS Code, browser backend with an auth token placeholder.

Static mode does not execute page JavaScript. Use `--browser` for SPAs.

## LLM tool loops

- `openai/tool-loop.js`: needs `openai`, `playwright`, and `OPENAI_API_KEY`.
- `anthropic/tool-loop.js`: needs `@anthropic-ai/sdk`, `playwright`, and `ANTHROPIC_API_KEY`.

Both loops treat page text as untrusted and call `ahttp.act`. A guarded action still requires `confirm: true` in the direct browser API; the MCP server's one-time token is the stronger flow. A production backend must authorize every mutation.

## Server-verified owner access

```bash
cd examples/auth-server
npm install
AGENT_TOKEN=dev-token node server.js
```

In another terminal:

```bash
curl -s http://127.0.0.1:8787/api/ahttp/authorize \
  -H 'Authorization: Bearer dev-token' -H 'content-type: application/json' \
  -d '{"action":"authorize","owner":"demo"}'

curl -s http://127.0.0.1:8787/api/ahttp/action \
  -H 'Authorization: Bearer dev-token' -H 'content-type: application/json' \
  -d '{"id":"a1","intent":"checkout_submit"}'
```

The action endpoint rejects `delete_account` and unknown intents. The Next.js route example shows the same checks in `nextjs-route/`; it is illustrative and is not run by the root test suite.

## Site-owner page

Open `site-owner/index.html` from a local server or directly as a file. It loads `../../ahttp.js`, declares `data-ahttp-*` attributes, and prints the snapshot.

## Static preview

`docs/demo/index.html` is a GitHub Pages-friendly page. It renders pasted HTML in an iframe, injects `ahttp.js`, and compares an estimated raw token count with the snapshot. It does not fetch remote URLs. The token estimate is UTF-8 bytes / 4, not a model tokenizer.
