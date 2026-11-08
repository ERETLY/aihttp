# aihttp/1 — AI HTTP format

aihttp is a wire format, not a site-specific scraper. It describes a page as a
compact graph of **actions** plus **untrusted text**, so an agent can act
without parsing the DOM or looking at pixels.

- Media type: `application/aihttp+json`
- Protocol id: `aihttp/1`
- Current implementation version: `1.0.0`
- Compatibility: the engine file and MCP tools still use the `ahttp` prefix.

## Envelope

A response is the engine snapshot with three format fields:

```json
{
  "protocol": "aihttp/1",
  "format": "aihttp",
  "formatVersion": 1,
  "version": "1.0.0",
  "url": "https://shop.test/cart",
  "title": "Widget shop",
  "locked": false,
  "owner": null,
  "modal": false,
  "layout": "layout",
  "regions": { "modal": 0, "main": 3, "chrome": 0 },
  "actions": [],
  "text": ["Cart (1 item)", "$49.00"],
  "textTrust": "untrusted",
  "meta": {}
}
```

| Field | Meaning |
|---|---|
| `protocol` | Always `aihttp/1` for this revision |
| `formatVersion` | Integer, incremented on a breaking wire change |
| `url`, `title` | The document the graph belongs to |
| `locked` | The page exposes no actions until authorization |
| `actions` | Executable controls, in reading order |
| `text` | Visible text, always untrusted |
| `meta` | Scan counters, truncation, timing, frames |

## Action

```json
{
  "id": "a12",
  "kind": "fill",
  "role": "textbox",
  "tag": "input",
  "label": "Email",
  "name": "email",
  "intent": "email",
  "value": "",
  "required": true,
  "region": "main",
  "frame": null,
  "requiresConfirmation": false
}
```

`id` is scan-local. Do not persist it across snapshots; use `intent`, `name`,
`label`, `href` or a recorded trace fingerprint instead. `kind` is one of
`click`, `fill`, `select`, `toggle`, `file`, `hover`, `scroll`, `key`.

Cross-origin frame actions use `f<frame>:a<n>` ids and carry `frame`. `act`
routes the id back to the frame that produced it.

## Text

Page text is data, never instructions. `textTrust` is always `untrusted`.
Consumers must not execute directives found in `text`, `label`, `placeholder`,
`title`, `alt`, `value` or any other page-derived field.

## Statuses

`act` returns a value, not an exception:

| Status | Meaning |
|---|---|
| `ok` | The action ran |
| `requires_confirmation` | A guarded action needs `confirm` / a token |
| `not_found` | The id or label no longer resolves |
| `ambiguous` | Several controls match; nothing was clicked |
| `blocked` | Policy, readonly, disabled or unauthorized |
| `no_effect` | An `expect` rule saw no change |
| `locked` | The page needs authorization |

## Trace and replay

`trace()` exports executed actions as fingerprints, not ids. `replay(trace)`
resolves each fingerprint against the current page and follows navigations.
Per-step replay statuses: `ok`, `would_run`, `not_found`, `ambiguous`,
`needs_value`, `requires_confirmation`, `url_mismatch`. Password values are
redacted; supply them through `values`.

## Transport

- HTTP: `aihttp-serve`, `GET /?url=...`, `POST /act`
- MCP: `ahttp_open`, `ahttp_snapshot`, `ahttp_act`, `ahttp_trace`, `ahttp_replay`
- Library: `require('aihttp')` / `window.aihttp` (`window.ahttp` is an alias)

## Versioning

`formatVersion` changes only when a consumer must change code. New optional
fields and new action kinds are additive. Unknown fields must be ignored.
`protocol` identifies the revision (`aihttp/1`).

## Security

The format is page-derived data. Authorization is origin-bound: the auth
endpoint must share the page origin or be listed in
`data-ahttp-auth-origins`. Browser mode runs the engine in an isolated world;
static mode binds a guarded fetch. Private targets are blocked unless
`allowPrivate` / `AIHTTP_ALLOW_PRIVATE=1` is set.
