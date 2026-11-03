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
