# Security policy

## Reporting

Open a private security advisory:

https://github.com/ERETLY/aiweb/security/advisories/new

If the advisory form is unavailable, use the contact method on the maintainer's GitHub profile. Do not file a public issue with a working exploit, a token, or a private URL.

Include the affected version, the environment, a minimal reproduction, and the impact. Do not include secrets or third-party data.

## Scope

The browser engine, the static MCP server, the CLI, the browser backend, and the example authorization servers are in scope. The benchmark fixtures and documentation are not production code.

Client-side JavaScript cannot enforce authorization. A static hash gate, hidden actions, and `data-aihttp-confirm` are coordination features. Server-side authorization of every mutation is required. A report that says "the client gate can be bypassed" is a known limitation, not a vulnerability, unless it also bypasses a documented server check.

## Deployment requirements

- Use HTTPS.
- Use server-verified owner access for sensitive actions.
- Authenticate the agent on the server; issue short-lived, scoped tokens.
- Enforce the action policy again in the endpoint that performs the mutation.
- Keep tokens out of HTML, URLs, localStorage, and logs.
- Run the MCP server with a restricted account and a controlled network.
- Use `--allow-private` only for trusted targets.
- Treat every page string as untrusted.
- Do not enable `--cdp-use-existing-profile` against your personal browser profile. It lets the agent act inside your signed-in sessions.

> [!WARNING]
> CDP mode attaches to a real browser. aihttp uses a fresh context by default; `--cdp-use-existing-profile` opts into the existing profile and its cookies. Use a dedicated profile for agent work.

See `docs/SECURITY.md` for the full contract.
