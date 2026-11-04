# Chromium-only repros

Cases here cannot be expressed as a layout-less jsdom corpus case, because the
engine needs real layout to prove that a hidden control is a real target.

## select-opacity

`saucedemo.com` hides the native `<select>` with `opacity:0.001` and paints a
sibling `<span class="active_option">`. The engine drops the select (soft-hidden
heuristic) and lists the span as `button "Name (A to Z) Name (Z to A) Price ..."`.
Clicking that button reports `status: ok` and changes nothing.

Run: `node benchmark/realworld/repro/select-opacity/repro.js`

Expected after a fix: the select is an action named `Sort products` and can be
used to change the order; the span is not a dead button.

## display-contents

`developer.mozilla.org` wraps the article in `<main id="content">` with
`display: contents`. The element has text but its own box is 0x0, so
`hiddenAncestorChain()` treats it as a zero-size hidden target and drops the
whole subtree (493 of 510 visible controls on the MDN HTTP article).

Run: `node benchmark/realworld/repro/display-contents/repro.js`

Expected after a fix: `display: contents` is transparent for visibility, the
`Save` button is an action, and the article text is included.

Status: closed by test. `test/realworld-layout.test.js` covers this fixture and
the zero-size wrapper variants in Chromium; the script is kept for manual
checks. `display: contents` elements skip the zero-box check, and a zero-size
box only counts as hidden when it clips its content (`overflow` not `visible`).
