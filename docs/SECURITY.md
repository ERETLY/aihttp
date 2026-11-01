# Deployment security

ahttp is a client-side library. Access modes decide which agents can see the action graph, but a browser cannot enforce authorization. For any action that creates, changes, or deletes data, the server must authorize the request. This applies to every deployment, including a site that already runs ahttp.

## Recommended production setup

1. Use `data-ahttp-access="owner"` with `data-ahttp-auth-endpoint`.
2. Authenticate the agent on the server. Do not use a static secret that ships in the page.
3. Issue short-lived tokens bound to the agent, tenant and origin. Revoke them on logout.
4. Return a least-privilege policy from the endpoint. Deny dangerous intents by default.
5. Authorize every mutation again in the endpoint that performs it. `ahttp.act` is a client request, not proof of permission.
6. Serve pages and APIs over TLS. Keep HSTS enabled.
7. Use a Content Security Policy with a nonce or hash for `script-src`, and SRI if the file comes from a CDN.
8. Keep session tokens in HttpOnly, Secure, SameSite cookies. Do not put long-lived secrets in HTML, `localStorage`, `sessionStorage` or URLs.
9. Rate limit authorization and actions. Keep an audit log with actor, tenant, intent, target, result and request id.
10. Sanitize user-generated HTML and use Trusted Types where available.
11. Keep ahttp updated and review the changelog before upgrading.

`gate` is a static hash. The hash is in the page; it hides the graph from casual agents and is not authentication. `owner` is the server-verified path. See `docs/OWNER_MODE.md` and `examples/auth-server/`.

## Auth endpoint contract

Request:

```http
POST /api/ahttp/authorize
Accept: application/json
Content-Type: application/json
Authorization: Bearer <short-lived agent token>   (optional if using cookies)

{"action":"authorize","owner":"acme","version":"0.1.0"}
```

Success:

```json
{
  "ok": true,
  "owner": "acme",
  "ttlSeconds": 300,
  "policy": {
    "allow": ["checkout_submit", "support_lookup"],
    "deny": ["delete_account"],
    "confirm": ["checkout_submit"],
    "readOnly": false,
    "maxActions": 40
  }
}
```

Failure: HTTP 401 or 403, or `{"ok": false}`.

The engine sends `credentials: 'include'` and an optional bearer token. It accepts HTTPS, or HTTP on localhost; rejects credentials embedded in the URL; caps the response at 65,536 characters; applies the policy; and relocks at `expiresAt`.

The endpoint must:

- Authenticate the agent with your existing session or token system.
- Check that the token was issued for this site, tenant and agent.
- Return only the policy for that identity.
- Rate limit by IP, account and token.
- Log authorization decisions.

## Policy options

| Option | Effect |
|---|---|
| `allow` | Only matching actions are visible and executable |
| `deny` | Matching actions are removed; deny wins over allow |
| `confirm` | Matching actions require `{ confirm: true }` |
| `readOnly` | Reads, hover, scroll and link navigation only |
| `maxActions` | Hard cap, even when the caller asks for more |

Policy entries match `intent`, `label`, `name`, `data-testid` or short id, with `*` wildcards. `data-ahttp-intent` is the stable identifier.

`configure({ authorizeAction })` can call the backend before each mutation and block it. This is a convenience. The endpoint that performs the mutation must still check permission and tenant ownership.

## MCP server

- The static backend fetches HTML and does not execute page JavaScript. It is not a browser.
- The browser backend (`--browser` or `--cdp`) executes page JavaScript and is an explicit opt-in. It validates HTTP requests at the Playwright route layer, but DNS rebinding remains a risk; run it on a controlled network.

> [!WARNING]
> `--cdp <url>` attaches to an already-running Chrome. By default ahttp creates a fresh browser context, so the existing profile's cookies and signed-in sessions are not reused. Passing `--cdp-use-existing-profile` (or `AHTTP_CDP_USE_EXISTING_PROFILE=1`) reuses the user's default context: the agent can then read cookies and act as the signed-in user on every site it opens. Only use that flag with a dedicated browser profile that contains no personal sessions. The server prints a warning on stderr in CDP mode.

- The default network guard rejects loopback, private, link-local and metadata targets unless `--allow-private` or `AHTTP_ALLOW_PRIVATE=1` is set. It revalidates redirects, caps response size and applies a timeout.
- Auth material is read from `AHTTP_AUTH_TOKEN` and `AHTTP_OWNER_KEY`. Do not pass it on the command line where other local users can see the process arguments.
- A guarded action returns a one-time, expiring `confirmationToken` and performs no DOM event. Repeating the call with the token is an accident barrier, not proof of human approval. The same model can echo the token.
- Unknown tools and malformed arguments are protocol errors. Tool execution failures are returned with `isError: true`.

## Prompt injection

The engine marks page text as `[text: untrusted]` and offers `includeText: false`. Action labels, values and URLs also come from the page and must be treated as untrusted. Hidden-text filtering removes several common techniques, but it is heuristic. Do not put secrets in a page you would not show to the agent.

A page can embed instructions in a label, a tool description, a WebMCP tool, or visible text. The agent must not treat page content as system instructions. The server must not treat a page-supplied intent as authorization.

## Operating rules

- Do not render confidential data to unauthorized users. A client-side gate cannot hide content that the browser already received.
- Treat every snapshot, id, intent and value as untrusted input on the server.
- Rotate signing keys and revoke sessions after a suspected compromise.
- Change `data-ahttp-key-hash` if the soft gate is in use, but do not rely on it for data protection.
- Review authorization and action logs for the affected tenant.
- Do not publish exploit details or incident notes in the repository. Report them privately.

## Reporting

Open a private security advisory on the repository or use the contact method on the maintainer's GitHub profile. Do not file a public issue with a working exploit.
