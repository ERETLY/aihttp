# Claude Code

From the repository clone:

```bash
claude mcp add ahttp -- node /absolute/path/to/ahttp/bin/aihttp-mcp.js --browser
```

Static backend:

```bash
claude mcp add ahttp -- node /absolute/path/to/ahttp/bin/aihttp-mcp.js
```

The browser backend needs Playwright and Chromium:

```bash
npm install
npx playwright install chromium
```

`claude mcp list` should show `ahttp`. The server writes only JSON-RPC to stdout; its startup line goes to stderr.
