# Real-world engine report

Status: **final** (all planned sites have run; the engine is unchanged).

- Date: 2026-11-03
- Branch: `test/realworld` from `main` (`ec1f988`, after PR #3)
- Engine under test: `ahttp.js` at `ec1f988`, unmodified
- Runtime: Node v26.13.0, Playwright 1.64.1, Chromium 156.0.8078.4
- Harness: `benchmark/realworld/` (`sites.json`, `oracle.js`, `run.js`, `mcp.js`)
- Command: `npm run test:realworld`; raw data in
  `benchmark/realworld/results.json`, MCP smoke in
  `benchmark/realworld/mcp-results.json`
- This harness is opt-in. It is not part of `npm test` and not part of CI.

## Method

Each page is opened in a fresh Chromium context with User-Agent
`ahttp-realworld-test (+https://github.com/ERETLY/ahttp)`, one site at a time,
with a 1.2 s pause between sites. The engine is injected with
`page.addInitScript`, so it survives navigation. The harness does not log in to
real accounts, submit payments or posts, or vote. It stops at any
403/429/captcha/bot wall and at a full-viewport consent wall, and records the
site as blocked instead of dismissing the wall.

Per page the harness records:

1. snapshot actions, scan time, text tokens (`gpt-tokenizer`), raw HTML tokens,
   Playwright `ariaSnapshot` tokens;
2. recall/precision against an independent in-page oracle that enumerates
   interactive elements, filters hidden/zero-size/covered ones, and treats a
   checkbox/radio/file as visible when its label is visible; matching is by
   role/tag + normalized name + href, with a structural fallback for unnamed
   controls (the oracle cannot see heading-derived names);
3. scroll stability at top/middle/bottom;
4. determinism of two consecutive forced snapshots.

Recall is computed against a full 5000-action scan, because the default
60-action snapshot is a product cap and the point of the metric is what the
engine can see, not what it chooses to print. Scroll checks also use the full
list so a re-ranked capped list cannot look like lost content.

`phantom` in the tables means "an action without a visible oracle counterpart".
It is a lead, not proof: the oracle can miss a control whose accessible name it
computes differently. Every phantom that became a finding was reproduced
separately.

## Results

| Site | Actions | Full | Scan ms | Text tokens | Raw tokens | Aria tokens | Recall | Scenarios |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| example | 1 | 1 | 0 | 170 | 641 | 245 | 100% | 1/1 |
| the-internet-checkboxes | 5 | 5 | 8 | 125 | 594 | 121 | 100% | 1/1 |
| the-internet-dropdown | 4 | 4 | 9 | 108 | 632 | 138 | 100% | 1/1 |
| the-internet-add-remove | 4 | 4 | 8 | 94 | 596 | 114 | 100% | 1/1 |
| the-internet-dynamic-loading | 4 | 4 | 11 | 108 | 624 | 132 | 100% | 1/1 |
| the-internet-dynamic-controls | 7 | 7 | 8 | 147 | 1214 | 170 | 100% | 1/1 |
| the-internet-login | 8 | 8 | 9 | 163 | 697 | 235 | 100% | 1/1 |
| the-internet-hovers | 3 | 3 | 10 | 92 | 735 | 132 | 100% | 0/1 |
| the-internet-key-presses | 4 | 4 | 8 | 125 | 1274 | 146 | 100% | 1/1 |
| the-internet-challenging-dom | 26 | 26 | 12 | 598 | 1980 | 1552 | 100% | 1/1 |
| the-internet-large | 3 | 3 | 92 | 1354 | 48699 | 31451 | 100% | 1/1 |
| the-internet-shadowdom | 3 | 3 | 7 | 116 | 690 | 139 | 100% | 1/1 |
| the-internet-iframe | 22 | 22 | 14 | 273 | 6634 | 395 | 100% | 1/1 |
| the-internet-nested-frames | 0 | 0 | 0 | 22 | 78 | 0 | 100% | 1/1 |
| the-internet-alerts | 6 | 6 | 8 | 146 | 730 | 181 | 100% | 1/1 |
| the-internet-upload | 5 | 5 | 8 | 124 | 808 | 141 | 100% | 1/1 |
| the-internet-infinite-scroll | 3 | 3 | 8 | 171 | 1387 | 895 | 100% | 1/1 |
| todomvc-react | 12 | 12 | 3 | 363 | 942 | 535 | 100% | 1/2 |
| saucedemo | 3 | 3 | 4 | 86 | 719 | 88 | 100% | 0/2 |
| books.toscrape | 60 (54 omitted) | 114 | 24 | 1283 | 9832 | 4657 | 100% | 2/2 |
| httpbin-form | 13 | 13 | 1 | 198 | 432 | 248 | 100% | 1/1 |
| wikipedia-http | 60 (935 omitted) | 995 | 224 | 1026 | 271558 | 45721 | 95.5% | 0/1 |
| hacker-news | 60 (166 omitted) | 226 | 30 | 1225 | 11556 | 9963 | 100% | 2/2 |
| github-ahttp | 60 (18 omitted) | 78 | 151 | 13282 | 192313 | 19336 | 41.1% | 1/1 |
| mdn-http | 17 | 17 | 5 | 437 | 39029 | 8247 | 3.3% | 0/1 |
| bbc-news | blocked | - | - | - | - | - | - | 0/0 |

26 sites: 25 were scanned and 1 (BBC) was blocked by a consent wall.
29 scenarios were defined; 23 passed and 6 failed. Determinism was identical
on every scanned page (text and ids). Scroll stability lost no action after the
full-list fix, including Wikipedia (995 actions at top, middle and bottom).

The six failed scenarios:

- `the-internet-hovers`: the hover target is an `<img>`/`<figure>` and is not
  an action, so there is nothing to hover.
- `todomvc-react`: the task checkbox is missing from the snapshot, so the task
  cannot be completed (`toggle`).
- `saucedemo` (cart): `.shopping_cart_link` is an anchor without `href`, so
  the cart is not an action.
- `saucedemo` (sort): the `opacity:0.001` native select is dropped, and the
  visible proxy span is a dead button.
- `wikipedia-http`: the header search input is dropped by the CSS override
  false positive.
- `mdn-http`: the whole `<main>` article is dropped by `display:contents`
  handling, so the search target is not in the snapshot.

## What is broken

### P1

1. **Modern media-query range syntax is treated as true.**
   `mediaMatches()` only understands `(min-width: …)` / `(max-width: …)`.
   Every other feature term is skipped and the query counts as matching.
   GitHub uses `@media (width <= 768px)`, `(width <= 544px)` and
   `(width <= 1011.98px)`; MDN uses `(width <= 1044px)`,
   `(width < calc(67rem))` and `or`. At the test viewport (1280 px) those
   queries are false in Chromium, but the engine applies their `display:none`
   / `visibility:hidden` rules. On GitHub this removes the marketing header
   (Products, Developers, Businesses, Resources, Pricing, Sign in, Sign up),
   the file table (29 file names and their commit links), `Branches`,
   `Go to file` and the sidebar tags: 106 of 180 visible controls are missing
   (recall 41.1%). On MDN the same bug removes the navigation popup and the
   left sidebar. Pending case: `corpus/cases/rw-media-query-range.json`
   (`corpus/fixtures/rw-media-query-range.html`).

2. **A `display:contents` wrapper is dropped as a zero-size hidden target.**
   MDN renders the article inside `<main id="content" class="layout__content">`
   with `display:contents`. The element has text but its own box is 0x0, so
   `hiddenAncestorChain()` returns `{hidden:true}` from the zero-size text
   check and the whole subtree is skipped. 493 of 510 visible controls are
   lost; recall is 3.3%. jsdom has no layout and cannot reproduce this check,
   so the repro is Chromium-only:
   `benchmark/realworld/repro/display-contents/` (`repro.js` prints
   `Save action: MISSING`; after a fix the button must be an action).

3. **A visible control is dropped when a stylesheet first hides it and a later
   rule shows it again.** Wikipedia's search container matches
   `@media screen { .mw-header .vector-typeahead-search-container { display:none } }`
   and then
   `@media screen and (min-width:1120px) { ... { display:block } }`.
   `buildCssIndex()` stores only the hide rule and ignores the later `display`
   override, so the whole search subtree is skipped even though
   `getComputedStyle()` is `display:block` and the input is a 404x32 px visible
   box. The search field is absent from the snapshot, so the Wikipedia search
   scenario cannot start; the same false positive removes 46 of 1020 visible
   controls on the article (search, Donate, Create account, Log in, ToC
   toggles). GitHub has the same bug in utility-class form:
   `<a class="d-none d-lg-flex">` matches `.d-none { display:none }` and the
   later `.d-lg-flex { display:flex }` under `(width >= 1012px)`; the engine
   indexes only the hide rule, so the control is dropped. Reproduced in jsdom
   and Chromium. Pending cases:
   `corpus/cases/rw-css-hidden-then-shown.json` (Wikipedia) and
   `corpus/cases/rw-utility-class-show.json` (GitHub).

4. **The todo toggle is missing on TodoMVC.**
   TodoMVC React renders
   `<input class="toggle" type="checkbox" data-testid="todo-item-toggle">`
   with `opacity:0`, a real 40x40 box and a sibling `<label>Task one</label>`
   (no `label[for]`, no `aria-label`, no `aria-labelledby`). The snapshot has
   no checkbox, so a task cannot be completed — the primary action of the app.
   Pending case: `corpus/cases/rw-sibling-label-toggle.json`
   (`corpus/fixtures/rw-sibling-label-toggle.html`).

5. **The cart cannot be opened on saucedemo.**
   The cart is `<a class="shopping_cart_link" role="button"
   aria-label="Cart, empty">` (the label becomes "Cart, 2 items" after adding
   products). `classify()` returns `null` for every anchor without `href`
   before it reads the explicit role, so the cart never appears in the snapshot
   and the primary path to checkout is unreachable.
   Pending case: `corpus/cases/rw-anchor-role-button.json`.

### P2

1. **A `<label>` with `cursor:pointer` is exposed as a `button` action.**
   On `the-internet /login` the snapshot contains
   `a2 label role=button "Username"` next to `a3 input "Username"` (and the
   same for Password). Two actions share one name, so `act("Username")` returns
   `ambiguous` with the label and the input as candidates instead of filling the
   field. Reproduced in jsdom and in Chromium.
   Pending case: `corpus/cases/rw-label-as-button.json`
   (`corpus/fixtures/rw-label-as-button.html`).

2. **Hover-only content has no action to hover.**
   `the-internet /hovers` shows `name: user1` only after hovering the avatar.
   The snapshot has three links and no image/figure action, so `act(id,
   { hover: true })` has no target and the caption can never appear. A
   `figure` with `onmouseover` is not classified, unlike `onclick`.
   Pending case: `corpus/cases/rw-hover-only.json`
   (`corpus/fixtures/rw-hover-only.html`).

3. **A native `<select>` hidden with `opacity:0.001` disappears, leaving a
   dead proxy button.** saucedemo renders
   `<span class="select_container"><span class="active_option">Name (A to Z)</span>
   <select aria-label="Sort products" style="opacity:0.001">...</select></span>`.
   The select is soft-hidden and dropped; the span is listed as
   `button "Name (A to Z) Name (A to Z) Name (Z to A) Price (low to high) Price (high to low)"`.
   Clicking it returns `status: ok` and leaves `select.value` at `az`, so the
   sort order cannot be changed. Chromium-only repro:
   `benchmark/realworld/repro/select-opacity/` (jsdom cannot prove the real
   box, so this is not a corpus case).

### P3

1. **First action on a page with pending subresources can take 7-11 s.**
   Measured `act()` evaluate time in the first group: 7.9 s (`/checkboxes`),
   11.1 s (`/dynamic_controls`), 8.1 s (`/dynamic_loading`), 7.7 s
   (`/alerts`), 7.1 s (`/challenging_dom`). The same actions later on the same
   page take 0.17-0.5 s. The pages load third-party images/scripts; this looks
   like the settle loop waiting for requests that started before the action.
   It is a latency risk, not a wrong result; no standalone minimal repro yet.

2. **Unlabelled native checkboxes get the whole form text as their name.**
   On `/checkboxes` both inputs are `checkbox "checkbox 1 checkbox 2"` instead
   of `checkbox 1` and `checkbox 2`; ids still work, but label lookup is
   ambiguous. This is the documented "accessible names are a subset" gap
   (`LIMITATION`), not counted as a separate pending bug.

### Observations, not classified as engine bugs

- `/login` submit: the engine fills and submits, and the browser lands on
  `/secure`. Direct `page.evaluate` loses the act reply because the navigation
  destroys the JS context; the MCP path passes the equivalent fill/submit
  checks. The action itself works.
- `/nested_frames` is a `<frameset>` page: 0 actions. README promises iframe
  scanning, not frameset scanning (`LIMITATION`; README note recommended).
- `/shadowdom`: shadow text is visible in the snapshot
  (`Let's have some different text!`, `My default text`, `In a list!`); the
  fixture has no interactive element. GitHub exercises real shadow actions:
  `clipboard-copy` controls appear as `clipboard-copy button "Copy code to
  clipboard"`, and shadow roots do not break the walk.
- saucedemo lists two `View details for <product>` links per product (image and
  title). They are real anchors, but identical names make label lookup
  ambiguous; ids still work. Not a bug.
- `/iframe`: 22 actions, including the editor inside the same-origin iframe.
- `/large`: 3 actions (the 50x50 table has no controls). Text compression is
  strong: 1 354 text tokens vs 48 699 raw and 31 451 ariaSnapshot tokens.
- `/upload`: the file input is listed; no file was uploaded (out of scope).
- Infinite scroll loads new paragraphs after `scroll` + re-snapshot; the new
  content carries no actions, so the action list stays at 3.
- GitHub's snapshot has `Star 0 (0)`/`1 tag` while the oracle's text is
  `Star0 (0)`/`1tag`; those two unmatched items are name-normalisation noise,
  not missing controls.

## Blocked / not tested yet

- **bbc.com** serves a full-viewport Sourcepoint consent wall
  (`[id^="sp_message_container"][aria-modal="true"]`, 1280x800, cross-origin
  iframe). The harness records `blocked` and does not dismiss it. With the wall
  open the engine scans only the modal container and returns 0 actions; that is
  the site block, not a separate engine bug.
- Not tested: real accounts, checkout/payment, posting/voting, captcha or bot
  walls, framesets, cross-origin iframe contents.

## MCP smoke

`node benchmark/realworld/mcp.js` runs the real `bin/ahttp-mcp.js --browser`
over stdio and passes 11/11 checks:

- `ahttp_open` returns a `pageId`; `ahttp_snapshot` reads the same page;
- `ahttp_act` toggles a checkbox with `value: "true"` and the follow-up
  snapshot shows the checked state;
- TodoMVC fill + `Enter` adds a todo;
- books.toscrape `next` navigates to page 2;
- after two "Add Element" clicks there are two Delete buttons, and asking for
  `Delete` by name returns `status: "ambiguous"` with both candidates.

## Honest summary

- **Scenarios:** 23 of 29 passed (79.3%). 6 failed; BBC was blocked before its
  scenario. The failures are 4 P1 blocks (TodoMVC toggle, saucedemo cart,
  Wikipedia search, MDN search) and 2 P2 failures (saucedemo sort,
  the-internet hover).
- **Recall:** average 93.6%, median 100%. 22 of 25 scanned pages are at 100%;
  Wikipedia is 95.5%, GitHub 41.1%, MDN 3.3%. The low three are explained by
  the three P1 bugs that affect scanning, not by 645 separate defects: one CSS
  override, one media-query parser gap and one `display:contents` check account
  for almost all of the loss.
- **Compression:** at the median, text is 6.5x smaller than raw HTML (15.4% of
  raw tokens; range 2.2x-265x) and 1.4x smaller than Playwright ariaSnapshot
  (69.7% of aria tokens; range 0.97x-44x, excluding the frameset page with 0
  aria tokens). The engine is not always smaller than ariaSnapshot, and the
  report does not claim it is.
- **Stability:** determinism identical on all 25 scanned pages; scroll lost no
  action when compared against the full list.
- **No engine changes** were made. Every finding is a pending corpus case or a
  Chromium-only repro; the pending cases fail on the current engine by design.

## README recommendations (not applied)

1. State that a `display:contents` wrapper is transparent for visibility; its
   children are the targets, not the wrapper.
2. State which media-query syntax the CSS index understands, or fix range,
   `or` and `calc()` parsing. Today an unknown feature is treated as true,
   which is the unsafe default.
3. Explain that an anchor without `href` is only an action when it has an
   explicit role (today it is dropped before the role is read).
4. Keep the iframe claim precise: same-origin iframes are scanned; `<frameset>`
   pages are not.
5. State that hover-only content is reachable only when the hover target is
   itself an action.
6. Do not claim that a hidden-then-shown control is found until the CSS index
   tracks show rules and source order (the Wikipedia and GitHub cases).
