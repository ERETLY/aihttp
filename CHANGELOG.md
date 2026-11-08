# Changelog

## 1.0.0 — 2026-11-08

### Added

- The public product and wire format are **aihttp** (AI HTTP). The package
  name is `aihttp`, the npm binaries are `aihttp`, `aihttp-mcp` and
  `aihttp-serve`, and `window.aihttp` is the browser global. The engine file is
  `aihttp.js`; MCP tool names and `ahttp` globals stay as compatibility names.
  `aiweb` was
  the working name during development and remains an alias.
- `aihttp-serve` exposes the format over HTTP: `GET /?url=...` returns
  `application/aihttp+json`, `POST /act` runs one action, `GET /health` reports
  the protocol version. Supports `--browser`, `--allow-private` and an
  `AIHTTP_TOKEN` bearer token.
- `docs/AIHTTP.md` specifies `aihttp/1`: envelope, action schema, statuses,
  trace/replay, transport, versioning and security rules. `ahttp.trace()` exports executed actions as
  portable fingerprints (`data-ahttp-intent`, test id, name, role, label,
  href) instead of scan-local ids. `ahttp.replay(trace)` resolves each step
  against the current DOM, follows navigations, and reports `not_found`,
  `ambiguous`, `needs_value`, `needs_confirmation` or `url_mismatch` instead
  of silently clicking the wrong control. Password values are redacted from
  the trace; replay takes them through `values`. Exposed over MCP as
  `ahttp_trace` and `ahttp_replay`.
- The static backend binds a guarded `fetch` into the page window, so server
  auth, `fetch`-based forms and page scripts work without a browser. Requests
  still pass through the same private-address guard as the document loader.
- `benchmark/web-matrix.js` and `benchmark/web-sites.json` measure coverage on
  385 public sites against an independent oracle of reachable controls.
  `npm run bench:web` reports weighted recall, phantom actions, blocked sites
  and network errors separately. `npm run bench:web:summary` prints the same
  weighted/mean/below-90/scan-time numbers from the last JSON. It is a finding
  tool, not a CI gate. Snapshot
  and oracle run in one synchronous evaluate, so a virtualized feed cannot
  re-render between them: Mastodon's off-screen items are mounted with inline
  `opacity:0`, and measuring a second later counted them as visible.
- The oracle now treats an ancestor clipped by `clip: rect(0,0,0,0)` or
  `clip-path: inset(50%)` as hidden, matching the engine. `sr-only` navigation
  (Hashnode, Vaadin) is no longer counted as reachable: the engine was right
  to skip it, and the denominator was wrong.

### Fixed

- A custom element with `role="group"` and `cursor:pointer` no longer
  swallows its children. ArtStation's `swiper-slide role="group"` was
  registered as a button and the 64 channel links inside it were lost.
  ArtStation 55.6% -> 100%.
- Identical links (same role, label and destination) are one action. A spec
  table repeats the same term link in every cell; html.spec.whatwg.org tables
  went from 1,046 to 213 actions and 845 to 16 phantom actions, with recall
  unchanged at 100%. Links to different destinations stay separate even when
  the label is the same.
- A text-level element (`<var>`, `<dfn>`, `<code>`) with `cursor:pointer` is
  not a control unless it has a role, tabindex or handler. WHATWG algorithms
  set `cursor:pointer` on `<var>` terms, which registered ~500 fake buttons.
- A control's label is the rendered text, so a visually hidden mobile
  duplicate no longer doubles it ("Products Products"). A label that starts
  with `<` (a CMS storing markup in `alt`, or a broken image rendering its alt)
  is rejected instead of being sent to the model.
- The coverage oracle counts one link per role + name + destination, so a
  carousel clone or a repeated header/footer link no longer inflates the
  denominator. It keeps the visible copy when a hidden clone comes first, and
  same-named buttons stay separate controls. Squarespace 73.2% -> 100%, Imgur
  80.6% -> 100%, Spiegel 82.6% -> 100%, Checkout.com 88.1% -> 100%, Klarna
  89.2% -> 100%, the MDN iframe page 81.6% -> 92.6%.
- The matcher pairs a long name truncated by the oracle even when
  normalization shortens the common prefix below the 160-character cap.
- `font-size:0` and `text-indent:-9999px` on a wrapper no longer hide its
  subtree when a descendant has a real box. The descendant search now follows
  shadow roots. Archive.org sets `font-size:0` on the top-nav wrappers and
  renders the links inside the shadow root of `<ia-topnav-media-button>`; the
  whole media menu was pruned. W3Schools sets `font-size:0` on
  the top nav to remove whitespace between inline-block links; the whole nav
  was pruned. W3Schools forms measured 78.7% before and 98.7% after, tables
  82.1% to 100%.
- A custom element with `cursor:pointer` no longer swallows the real controls
  in its light DOM. Reddit's `<shreddit-post-overflow-menu>` is a pointer
  container with a native `<button>` inside; the host was registered and the
  button was lost. Reddit measured 18.7% before and 99.7% after.
- `cursor:pointer` is inherited, so a text span inside a clickable card is no
  longer registered as a second button. The outermost pointer container (or an
  element with its own handler or explicit role) is the control. Reddit's
  phantom actions dropped from 485 to 88.
- An offscreen carousel track no longer prunes counter-transformed slides.
  Plaid translates the track to -9000px and each slide back into view; the
  track's negative edge hid every slide. Plaid measured 64.6% before and 100%
  after.
- An image-only control takes its name from the image `alt` before the
  `title` attribute, matching the accessible name. Open Library's footer
  icons and logo measured 73.8% before and 100% after.
- The oracle follows the shadow boundary when it checks ancestor opacity, so a
  button inside an `opacity:0` hover overlay is hidden, not missed.
- The oracle counts nested interactive content once (a `role=button` inside a
  `<button>`) and does not count a `role=menuitem` wrapper and its inner link
  as two controls. Wayfair and the Ant Design docs measured 100% after.
- A visible label with no box no longer rescues a checkbox inside a closed
  popover. Open Library's language filter is not part of the page until the
  search dialog opens.

### Security

- `aihttp-serve` compares the bearer token in constant time and refuses to
  bind a non-loopback interface without a token. A public bind without a token
  would be an open SSRF proxy.
- `aihttp-serve` rejects the `files` argument. File paths are a local trust
  boundary: over HTTP they would let a caller read any file the server process
  can read and upload it to a page. Use the MCP server for uploads.
- The server authorization endpoint must share the page origin unless
  `data-ahttp-auth-origins` explicitly allows it. A page can no longer point
  `data-ahttp-auth-endpoint` at an attacker's origin and receive the Bearer
  token. Cross-origin authorization requests omit cookies.
- The browser backend runs the engine in a CDP isolated world. Page scripts
  cannot read, replace or shadow `window.ahttp`, and the auth token never
  enters the page world.
- Cross-origin frames get their own isolated world per frame target. The main
  engine still handles same-origin frames through `contentDocument`.
- WebSocket connections go through the same private-address guard as HTTP.
  `ws://127.0.0.1`, `wss://localhost` and link-local targets are blocked
  unless `allowPrivate` is set.
- The static backend creates one engine per page instead of sharing a
  module-level singleton and a single `globalThis.__AHTTP_ENV__`.
- An MCP tool call now has a deadline (`AHTTP_CALL_TIMEOUT_MS`, 90 s by
  default). A stuck page load can no longer block the single request queue
  forever.

### Performance

- `waitSettled` ignores requests that were already in flight when the action
  started. A long-lived request from an earlier action no longer delays every
  subsequent click.

### Encoding

- The static backend detects the response charset from a BOM, the
  `Content-Type` header or `<meta charset>` instead of assuming UTF-8.
  windows-1251, Shift_JIS and similar pages no longer turn into replacement
  characters.

### MCP

- A link click that already navigated no longer reopens its `href`, so
  one-time links are not consumed twice.
- `ahttp_act` accepts `files` (real uploads through the browser backend) and
  `dialog` / `promptText` for native alert, confirm and prompt.
- `ahttp_snapshot` accepts `lazy` to scroll the page once and reveal sections
  built by IntersectionObserver.

### Parsing

- A white-on-white container no longer hides its colored children. Pages
  whose `<body>` inherits `color: white` and `background: white` while every
  child overrides both used to scan as zero actions.
- `role="dialog"` is only a scan root when it is actually modal:
  `aria-modal="true"`, an open `<dialog>`, a backdrop, or a large overlay.
  A small cookie banner with `aria-modal="false"` no longer replaces the page.
  A bottom sheet with `aria-modal="true"` is not enough either: without a
  backdrop it must be centered and cover a quarter of the viewport. A modal
  that exposes no controls falls back to the document (`meta.modalFallback`),
  so an empty consent shell cannot hide the page.
- `<slot>` is a placeholder, not a control, and SVG shapes (`rect`, `path`,
  `circle`) inherit `cursor:pointer` from the icon around them but are not
  buttons. `tabindex="0"` on an element with an explicit role (`tabpanel`,
  `region`) no longer turns it into a click target.
- A custom element with a click role (`button`, `link`, `tab`, `menuitem`,
  `option`, `treeitem`, `gridcell`) is the control; its unlabeled shadow
  button is not registered instead. Native `<button>` and `<a>` keep an
  explicit ARIA role, so `role="tab"` stays a tab.
- `aria-labelledby` resolves ids through every shadow-host level, and text
  assigned to a `<slot>` is read for labels. Icon buttons inside web
  components get their real name instead of a URL or a tag name. Visible text
  is preferred over `name` / `id` / `href` as the label.
- Custom comboboxes wait for options rendered after the click, search the
  popup referenced by `aria-controls` / `aria-owns` before the whole page, and
  `act(id, {})` opens the popup instead of returning `option_not_found`.
  `act(id, { value })`, `{ label }`, `{ index }` and `{ choose }` select an
  option; a button with `aria-haspopup` / `aria-expanded` works the same way.
- `aria-activedescendant` and `aria-valuetext` are read as the value of a
  custom combobox. `ElementInternals` `ariaLabel` and `role` are used for
  custom elements. ID references resolve across a shadow boundary into the
  light DOM.
- MCP `ahttp_act` now waits for settle by default and accepts `expect`,
  `checked`, `hover`, `read`, `choose`, `wait` and `timeout`.
- A form with `<input name="hidden">` no longer hides itself: the engine reads
  the `hidden` attribute instead of the form's named property.
- A collapsed wrapper with height 0 and visible children (payment iframes)
  is no longer treated as offscreen.
- `aria-owns` subtrees are walked in the owner's region, including owned
  popups outside a modal.
- `snapshot({ maxNodes, maxDepth })` and `data-ahttp-max-nodes` /
  `data-ahttp-max-depth` make the scan budget explicit; `meta.truncated`
  reports a cut scan.
- Native `alert` / `confirm` / `prompt` follow an accept or dismiss policy
  per action.
- `@supports` blocks are evaluated instead of applied blindly. The engine uses
  `CSS.supports` when present, otherwise probes the declaration against a real
  style object or a known-property table. `@container` blocks are skipped when
  there is no layout, so an unmatched query cannot hide a page. `@layer` rules
  still apply.
- `content-visibility: hidden` removes its subtree from the scan.
- A closed `popover` is not exposed; an open popover is scanned normally.
- A `<slot>` walks its assigned nodes instead of the fallback content.
- `<frameset><frame>` documents are scanned through `contentDocument`, the
  same way as same-origin iframes.

## 0.2.1, 2026-11-05

### Performance

- Label lookup is indexed once per scan instead of a document-wide
  `label[for]` query per control. The pinned Wikipedia page scans in
  about 100 ms instead of 3.2 s; the other pinned pages stay in single
  digits or low tens of milliseconds.

## 0.2.0, 2026-11-04

### Matching

- Relocation scores independent anchors: intent, test id, DOM id, name,
  accessible name, visible text, placeholder, title, alt and href. Role, tag,
  path, DOM order and the old fingerprint are tie-breakers only.
- Two thresholds (`accept`, `ambiguous`) and a margin. A near-tie returns
  `status: 'ambiguous'` with candidates and dispatches no event; `confirm` does
  not override it.
- Disabled replacements and kind-mismatched candidates are not active matches.

### Actions

- `act` accepts `expect` and returns `status: 'no_effect'` with failed rules when
  the expected change does not happen.
- Every result now carries `status` (`ok`, `ambiguous`, `not_found`,
  `requires_confirmation`, `blocked`, `locked`, `error`, `no_effect`).
  Existing fields and error codes are unchanged; this is additive.
- Hover-only targets are actions (`kind: 'hover'`, `role: 'hover'`) when the
  element owns an inline `onmouseover`/`onmouseenter` handler or matches a CSS
  `:hover` rule that reveals a hidden descendant. `act` applies the rule's
  `display`/`visibility`/`opacity` declarations and fires pointer/mouse events,
  because synthetic events do not activate CSS `:hover`. Names come from
  visible text, `aria-label`, `title` or an image alt only.

### Fixes

- Scrolled pages: the off-screen text filter compared viewport-relative
  `getBoundingClientRect()` values with zero, so content scrolled above the
  viewport vanished from the snapshot and showed up as removed in the next
  diff. It now uses document coordinates (`fixed` elements keep viewport
  coordinates).
- Opacity: only the literal `0` hid a control. `0.0`, `.0` and `0%` (inline or
  from a stylesheet) now hide it too, so the static backend no longer shows
  controls a browser would not paint.
- `inert` on an element or an ancestor removes it from the snapshot, like
  `aria-hidden`. Form controls inside `<fieldset disabled>` (outside its first
  `<legend>`) are reported as `disabled` and `act` returns `blocked`.

- Hidden toggles: a native `input[type=checkbox|radio]` hidden only by soft
  heuristics (opacity <= 0.05, clip, clip-path, font-size 0, off-screen
  absolute, text-indent, zero/tiny size) stays in the snapshot when a visible
  label element (wrapped `<label>`, `label[for]`, `aria-labelledby`) names it;
  when `aria-label` is the only name it needs real layout, its own box of at
  least 12x12 px inside the page, and opacity as the only hide mechanism, so a
  1x1 or off-screen input can no longer carry instructions into the snapshot.
  `display:none`, `visibility:hidden`, `hidden`, `aria-hidden`, `inert`, hidden
  ancestors and closed `<details>` still hide it. The label is the real hit
  target in the page; `act(id, { checked: true })` still dispatches a click on
  the input, which toggles it in Chromium and jsdom.

- Disabled twins: relocation used to filter disabled candidates before scoring,
  so `[disabled "Run"][active "Run"]` clicked the active twin even though the
  original could be either. Disabled candidates are now scored and returned in
  `candidates` with `disabled: true`, but they can never win. With no active
  candidate the reply is `not_found`; an active candidate must lead every other
  candidate by `margin` and `contentMargin` or the reply is `ambiguous`. A
  clearly better active candidate (for example, the one that kept the original
  `data-testid`) still runs.

- Label lookup: when the id is not in the registry, `act("Delete")` used to
  take the first action with that label. It now tries `data-ahttp-intent`
  (case-insensitive), then the label with exact case, then the label
  case-insensitive. A step with more than one match returns `status: 'ambiguous'`
  with candidates and dispatches nothing; a duplicate `data-ahttp-intent` does
  the same. Unique labels still run, and `confirm: true` does not bypass it.

- Matching: position, DOM order and the fingerprint add up to 14 points, more
  than `margin` (12), so two controls with the same label could be separated by
  position alone and the nearer one was clicked. The winner must now also lead
  every other candidate by `contentMargin` (5) on content signals alone;
  otherwise the reply is `ambiguous`. `thresholds.contentMargin` is added to the
  ambiguous reply.

- `expect`: the check ran once right after the quiet window (about 40 ms), so a
  correct click whose effect arrived 100-400 ms later came back as `no_effect`
  with "the match may be wrong". `act` now re-checks every 30 ms until the rule
  holds or `timeout` runs out. A met rule returns as fast as before; an unmet
  one returns `no_effect` after the full timeout (1200 ms by default).

### Real-world fixes

- Layout mode reads visibility and cursor from `getComputedStyle` only. The
  browser already resolved media queries, specificity and inheritance, so the
  CSS index is not consulted and cannot override the page. GitHub recall went
  from 41.1% to 98.9%.
- The static backend evaluates a Media Queries 4 subset (width, height,
  aspect-ratio, resolution, ranges, `and`/`or`/`not`, `calc`, `em`/`rem`/`vw`/`vh`
  and common preferences) and cascades `display`, `visibility`, `opacity` and
  `cursor` by `!important`, specificity and source order. An unknown feature or
  an unparsable query is false, never true.
- `display: contents` no longer hides a subtree, and a zero-size clipped wrapper
  does not hide content a browser still paints.
- Anchors without `href` stay actions when a role, a handler, a pointer cursor or
  `tabindex` makes them interactive.
- A sibling `<label>` without `for`, and the direct text next to an unlabelled
  checkbox, now name the control; two checkboxes in one paragraph get distinct
  names.
- A `<label>` is not a separate action when its control is in the snapshot.
  Bootstrap `btn-check` labels stay clickable when the radio is hard-hidden or
  missing.
- A native `select`, `textarea` or text input hidden only by partial opacity
  (`0 < opacity <= 0.05`) is recovered when it has a real box and a name;
  `opacity: 0` is not. A `cursor: pointer` element covered by a native control
  is dropped instead of becoming a dead button.

### Tests and docs

- Local jsdom corpus with 71 scenarios (the original 27, the gap fixes and the
  real-world regressions: media queries and cascade, CSS-hidden-then-shown,
  anchors without `href`, sibling labels and adjacent text, label proxies,
  Bootstrap `btn-check`, partial-opacity fields, iframe depth, cross-origin
  iframes, closed shadow roots, empty pages, aria-label and href drift, other
  hiding mechanisms, a disabled twin, `pointer-events: none`, label lookup), `bench/results.json` metrics and no
  network access.
- `test/realworld-layout.test.js`: five Chromium tests behind
  `AHTTP_REQUIRE_BROWSER=1` (layout mode, anchors without `href`, label proxy,
  partial opacity, `display: contents` and the security fixture).
- `test/realworld-oracle.test.js`: a Chromium test pins that the oracle hides a
  closed `<details>` subtree, keeps its first `<summary>`, and still shows open
  details.
- The real-world oracle now treats content under a closed `<details>` as hidden
  (its first summary stays visible). MDN recall moved from 10.4% to 96.3%; both
  sides were re-measured with the same oracle.
- The real-world matcher compares the oracle's 160-character name cap
  consistently with the engine's full label and ignores whitespace before
  punctuation. bbc-news moved from 84.2% to 99.2% and its 36 phantom duplicates
  disappeared; the remaining two misses are nested `<button>`/`<a>` controls the
  oracle counts twice.
- `docs/REALWORLD.md` keeps the before/after run with the corrected oracle and
  matcher: 30/30 scenarios, mean recall 93.5% to 99.7% over 26 scanned pages.
- Two real-world steps were corrected against live evidence: Wikipedia clicks a
  search suggestion, TodoMVC expects the Active filter to hide the completed
  todo. The harness retries a text/dom read while a form-submit navigation
  commits, and can reject a declared cross-origin consent wall, so bbc-news is
  scanned instead of blocked.
- `docs/MATCHING.md`, `docs/ARCHITECTURE.md`, a 30-second quick start, an MCP
  config block and a runnable `examples/agent-loop.js`.

## 0.1.0, 2026-11-01

First public snapshot.

### Engine

- Compact text and JSON snapshots with stable action ids.
- Media-aware CSS index, including common `@media` width and height conditions.
- CSS `::before` and `::after` text in accessible names when the browser exposes it.
- Relocation prefers a matching DOM id when a framework replaces a node.
- DOM-only actions settle on a short quiet window; requests keep the longer wait.

### Static backend

- Fetch linked stylesheets before scanning, with a size cap and an opt-out.
- Follow `@import` to three levels.

### Self-use

- `self/aihttp.user.js`: the engine and a panel in one file for Tampermonkey or Violentmonkey.
- Scan, act, confirm and copy from the panel. `Alt+Shift+A` opens it.
- No server and no upload.

### Benchmarks

- Compared with raw HTML, Readability Markdown, the Chromium accessibility tree, Jina Reader and Firecrawl.
- `npm run bench:time` measures scan and live time for every method; the README timing tables are generated from `benchmark/time-results.json`.
