# Real-world engine report

Status: **in progress** (checkpoint after the first two groups). The final
version of this file is written after every planned site has run.

- Date: 2026-11-03
- Branch: `test/realworld` from `main` (`ec1f988`, after PR #3)
- Engine under test: `ahttp.js` at `ec1f988`, unmodified
- Runtime: Node v26.13.0, Playwright 1.64.1, Chromium 156.0.8078.4
- Harness: `benchmark/realworld/` (`sites.json`, `oracle.js`, `run.js`, `mcp.js`)
- Command: `npm run test:realworld -- --site=...`; raw data in
  `benchmark/realworld/results.json`

## Method

Each page is opened in a fresh Chromium context with User-Agent
`ahttp-realworld-test (+https://github.com/ERETLY/ahttp)`, one site at a time,
with a 1.2 s pause between sites. The engine is injected with
`page.addInitScript`, so it survives navigation. The harness does not log in to
real accounts, submit payments or posts, and stops at any 403/429/captcha/bot
wall.

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

`phantom` in the tables means "an action without a visible oracle counterpart".
It is a lead, not proof: the oracle can miss a control whose accessible name it
computes differently. Every phantom that became a finding was reproduced
separately.

## Results (group 1: example.com and the-internet)

| Site | Actions | Scan ms | Text tokens | Raw tokens | Aria tokens | Recall | Scenarios |
|---|---:|---:|---:|---:|---:|---:|---:|
| example | 1 | 5 | 170 | 641 | 245 | 100% | 1/1 |
| the-internet-checkboxes | 5 | 31 | 125 | 594 | 121 | 100% | 1/1 |
| the-internet-dropdown | 4 | 34 | 108 | 632 | 138 | 100% | 1/1 |
| the-internet-add-remove | 4 | 24 | 94 | 596 | 114 | 100% | 1/1 |
| the-internet-dynamic-loading | 4 | 31 | 108 | 624 | 132 | 100% | 1/1 |
| the-internet-dynamic-controls | 7 | 26 | 147 | 1214 | 170 | 100% | 1/1 |
| the-internet-login | 8 | 27 | 163 | 697 | 235 | 100% | 1/1 |
| the-internet-hovers | 3 | 24 | 92 | 735 | 132 | 100% | 0/1 |
| the-internet-key-presses | 4 | 23 | 125 | 1274 | 146 | 100% | 1/1 |
| the-internet-challenging-dom | 26 | 29 | 598 | 1977 | 1552 | 100% | 1/1 |
| the-internet-large | 3 | 101 | 1354 | 48699 | 31451 | 100% | 1/1 |
| the-internet-shadowdom | 3 | 27 | 116 | 690 | 139 | 100% | 1/1 |
| the-internet-iframe | 22 | 39 | 273 | 6634 | 395 | 100% | 1/1 |
| the-internet-nested-frames | 0 | 2 | 22 | 78 | 0 | 100% | 1/1 |
| the-internet-alerts | 6 | 19 | 146 | 730 | 181 | 100% | 1/1 |
| the-internet-upload | 5 | 18 | 124 | 808 | 141 | 100% | 1/1 |
| the-internet-infinite-scroll | 3 | 26 | 167 | 1374 | 882 | 100% | 1/1 |

17 scenarios, 16 passed, 1 failed. Determinism was identical on every page
(text and ids). Scroll stability showed no lost header/nav action in this
group.

## Results (group 2: TodoMVC, saucedemo, books.toscrape)

| Site | Actions | Scan ms | Text tokens | Raw tokens | Aria tokens | Recall | Scenarios |
|---|---:|---:|---:|---:|---:|---:|---:|
| todomvc-react | 12 | 7 | 363 | 942 | 535 | 100% | 1/2 |
| saucedemo (login page) | 3 | 9 | 86 | 719 | 88 | 100% | 0/2 |
| books.toscrape | 114 | 48 | 2728 | 9832 | 4657 | 100% | 2/2 |

6 scenarios, 3 passed, 3 failed. Recall 100% on all three. TodoMVC's
stale-id scenario passed: after a filter rerender, the id from the previous
snapshot was relocated and clicked. books.toscrape: 114 actions, stable ids
across top/middle/bottom, `next` on the Nonfiction category is `a115`.
saucedemo: login, two "Add to cart" clicks and the `2` cart badge all passed;
the cart link and the sort control did not.

## Results (group 3: httpbin, Wikipedia, Hacker News)

| Site | Actions (default) | Full actions | Scan ms | Text tokens | Raw tokens | Aria tokens | Recall | Scenarios |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| httpbin-form | 13 | 13 | 2 | 198 | 432 | 248 | 100% | 1/1 |
| wikipedia-http | 60 (935 omitted) | 995 | 272 | 1026 | 271558 | 45721 | 95.5% | 0/1 |
| hacker-news | 60 (169 omitted) | 229 | 27 | 1194 | 11682 | 10065 | 100% | 2/2 |

4 scenarios, 3 passed, 1 failed. httpbin's form round-trip passes: all fills,
the radio, a topping checkbox and submit land on the response page with the
entered values. Hacker News: the first story comment link (`760 comments`) and
`More` (`?p=2`) both navigate. Wikipedia: the search input is missing, and the
full-scan recall is 95.5% (46 of 1020 visible controls lost), all in the same
header/ToC subtree. The default 60-action snapshot is a cap, not a scan
failure: Wikipedia has 995 actions and Hacker News 229; `More` on HN is only
inside the list when the cap is raised above 200.

## What is broken

### P1

1. **A visible control is dropped when a stylesheet first hides it and a later
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
   toggles). Reproduced in jsdom and Chromium.
   Pending case: `corpus/cases/rw-css-hidden-then-shown.json`
   (`corpus/fixtures/rw-css-hidden-then-shown.html`).

2. **The todo toggle is missing on TodoMVC.**
   TodoMVC React renders
   `<input class="toggle" type="checkbox" data-testid="todo-item-toggle">`
   with `opacity:0`, a real 40x40 box and a sibling `<label>Task one</label>`
   (no `label[for]`, no `aria-label`, no `aria-labelledby`). The snapshot has
   no checkbox, so a task cannot be completed — the primary action of the app.
   Pending case: `corpus/cases/rw-sibling-label-toggle.json`
   (`corpus/fixtures/rw-sibling-label-toggle.html`).

3. **The cart cannot be opened on saucedemo.**
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
   Measured `act()` evaluate time: 7.9 s (`/checkboxes`), 11.1 s
   (`/dynamic_controls`), 8.1 s (`/dynamic_loading`), 7.7 s (`/alerts`),
   7.1 s (`/challenging_dom`). The same actions later on the same page take
   0.17-0.5 s. The pages load third-party images/scripts; this looks like the
   settle loop waiting for requests that started before the action. It is a
   latency risk, not a wrong result; no standalone minimal repro yet.
2. **Unlabelled native checkboxes get the whole form text as their name.**
   On `/checkboxes` both inputs are `checkbox "checkbox 1 checkbox 2"` instead
   of `checkbox 1` and `checkbox 2`; ids still work, but label lookup is
   ambiguous. This is the documented "accessible names are a subset" gap
   (`LIMITATION`), not counted as a separate pending bug.

### Observations, not classified as engine bugs

- `/login` submit: the engine fills and submits, and the browser lands on
  `/secure`. Direct `page.evaluate` loses the act reply because the navigation
  destroys the JS context; the MCP path is checked separately in this report.
  The action itself works.
- `/nested_frames` is a `<frameset>` page: 0 actions. README promises iframe
  scanning, not frameset scanning (`LIMITATION`; README note recommended).
- `/shadowdom`: shadow text is visible in the snapshot
  (`Let's have some different text!`, `My default text`, `In a list!`); the
  fixture has no interactive element, so shadow actions are exercised on GitHub
  later.
- saucedemo lists two `View details for <product>` links per product (image and
  title). They are real anchors, but identical names make label lookup
  ambiguous; ids still work. Not a bug.
- `/iframe`: 22 actions, including the editor inside the same-origin iframe.
- `/large`: 3 actions (the 50x50 table has no controls). Text compression is
  strong: 1 354 text tokens vs 48 699 raw and 31 451 ariaSnapshot tokens.
- `/upload`: the file input is listed; no file was uploaded (out of scope).
- Infinite scroll loads new paragraphs after `scroll` + re-snapshot; the new
  content carries no actions, so the action list stays at 3.

## Blocked / not tested yet

Nothing blocked in these groups. Still to run: GitHub, MDN, a news site with a
cookie banner, and the MCP smoke path.

## Honest summary (so far)

- Scenarios: 22/27 passed (81%).
- Recall: 100% on 22 pages, 95.5% on the Wikipedia article. The only recall
  loss found is the CSS override bug above; it is one bug, not 46.
- Compression: text is 5-265x smaller than raw HTML and 1-45x smaller than
  Playwright ariaSnapshot. The extremes are `/large` (the-internet) and the
  Wikipedia article (1 026 text tokens vs 271 558 raw / 45 721 aria).
- No README claims need changing yet. Recommendation for later: state that
  framesets are not scanned, that hover-only content is reachable only when
  the hover target is itself an action, that an anchor without `href` needs an
  explicit role, and that a CSS hide rule overridden by a later rule can hide a
  visible control (the Wikipedia bug).
