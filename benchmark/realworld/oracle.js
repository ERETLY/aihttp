'use strict';

// Independent oracle for the real-world harness. It runs inside Chromium and
// answers one question: which interactive elements can a user actually reach?
// It deliberately does not import anything from ahttp.js.

function oracle() {
  var SELECTOR = 'a[href], button, input, select, textarea, summary, [role], [contenteditable]';
  var ROLES = ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'textbox', 'combobox', 'slider'];
  var out = [];
  var seen = new Set();

  // parentElement stops at a shadow root. A control slotted into a component
  // is still inside the component's box, so walk through the host.
  function parentOf(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    var root = null;
    try { root = node.getRootNode ? node.getRootNode() : null; } catch (e) { root = null; }
    return root && root !== node && root.host ? root.host : null;
  }

  function norm(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function roleOf(el) {
    var explicit = norm(el.getAttribute('role')).toLowerCase();
    if (explicit) return explicit.split(/\s+/)[0];
    var tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : '';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'summary') return 'button';
    if (tag === 'input') {
      var type = (el.type || 'text').toLowerCase();
      if (type === 'hidden') return '';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'image' || type === 'file') return 'button';
      if (type === 'range') return 'slider';
      return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return '';
  }

  function labelsOf(el) {
    var list = [];
    if (el.labels && el.labels.length) {
      for (var i = 0; i < el.labels.length; i++) list.push(el.labels[i]);
    }
    return list;
  }

  function nameOf(el) {
    var aria = norm(el.getAttribute('aria-label'));
    if (aria) return aria;
    var by = norm(el.getAttribute('aria-labelledby'));
    if (by) {
      var parts = [];
      var ids = by.split(/\s+/);
      for (var i = 0; i < ids.length; i++) {
        var node = el.ownerDocument.getElementById(ids[i]);
        if (node) parts.push(norm(node.innerText || node.textContent));
      }
      if (parts.join(' ').trim()) return norm(parts.join(' '));
    }
    var labels = labelsOf(el);
    if (labels.length) {
      var text = norm(labels.map(function (l) { return l.innerText || l.textContent; }).join(' '));
      if (text) return text;
    }
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' && /^(submit|button|reset)$/i.test(el.type || '')) return norm(el.value);
    if (tag === 'input' || tag === 'textarea') {
      if (el.placeholder) return norm(el.placeholder);
      var inputType = tag === 'input' ? String(el.type || 'text').toLowerCase() : 'text';
      if (el.value && inputType !== 'password' && inputType !== 'checkbox' && inputType !== 'radio' && inputType !== 'file') return norm(el.value);
    }
    if (tag === 'img') return norm(el.getAttribute('alt'));
    var inner = norm(el.innerText || el.textContent);
    if (inner) return inner.slice(0, 160);
    var img = el.querySelector ? el.querySelector('img[alt]') : null;
    if (img) return norm(img.getAttribute('alt'));
    if (el.title) return norm(el.title);
    return '';
  }

  function ownReasons(el) {
    var reasons = [];
    var cs = null;
    try { cs = getComputedStyle(el); } catch (e) { cs = null; }
    if (!cs) return reasons;
    if (cs.display === 'none') reasons.push('display:none');
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') reasons.push('visibility:' + cs.visibility);
    var op = parseFloat(cs.opacity);
    if (!isNaN(op) && op <= 0.05) reasons.push('opacity:' + op);
    if (cs.clip && cs.clip !== 'auto') reasons.push('clip');
    if (cs.clipPath && cs.clipPath !== 'none') reasons.push('clip-path');
    if (parseFloat(cs.fontSize) === 0) reasons.push('font-size:0');
    var ti = parseFloat(cs.textIndent);
    if (!isNaN(ti) && ti <= -999) reasons.push('text-indent');
    if (cs.contentVisibility === 'hidden') reasons.push('content-visibility:hidden');
    return reasons;
  }

  // getComputedStyle is expensive and the same shell elements are checked for
  // every candidate. display:none, opacity:0 and content-visibility:hidden are
  // definitive for the whole subtree; visibility is not, because a descendant
  // can override it.
  var styleCache = new Map();
  function ancestorStyle(node) {
    var hit = styleCache.get(node);
    if (hit) return hit;
    var cs = null;
    try { cs = getComputedStyle(node); } catch (e) { cs = null; }
    var out = cs ? {
      display: cs.display,
      opacity: cs.opacity,
      contentVisibility: cs.contentVisibility,
      clip: cs.clip,
      clipPath: cs.clipPath || cs.webkitClipPath
    } : { display: '', opacity: '', contentVisibility: '', clip: '', clipPath: '' };
    styleCache.set(node, out);
    return out;
  }

  function isClosedDetails(node) {
    return !!node.tagName && node.tagName.toLowerCase() === 'details' && !node.hasAttribute('open');
  }

  // Only the first <summary> child is the disclosure widget; everything else
  // inside a closed <details> is not rendered.
  function inFirstSummary(details, el) {
    var summary = null;
    for (var i = 0; i < details.children.length; i++) {
      if (details.children[i].tagName.toLowerCase() === 'summary') { summary = details.children[i]; break; }
    }
    return !!(summary && (summary === el || summary.contains(el)));
  }

  function ancestorReasons(el) {
    var reasons = [];
    var node = el;
    var guard = 0;
    while (node && node.nodeType === 1 && guard++ < 60) {
      if (node.hidden) reasons.push('hidden-attr');
      if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') reasons.push('aria-hidden');
      if (node.hasAttribute && node.hasAttribute('inert')) reasons.push('inert');
      if (isClosedDetails(node) && !inFirstSummary(node, el)) reasons.push('closed-details');
      var st = ancestorStyle(node);
      if (st.display === 'none') reasons.push('ancestor-display:none');
      var op = parseFloat(st.opacity);
      if (!isNaN(op) && op <= 0.05) reasons.push('ancestor-opacity:' + op);
      if (st.contentVisibility === 'hidden') reasons.push('ancestor-content-visibility:hidden');
      // Tailwind's sr-only and every "visually hidden" utility clip a 1x1 box
      // with clip: rect(0,0,0,0) or clip-path: inset(50%). The clip belongs to
      // an ancestor, and a clipped ancestor clips its whole subtree.
      var clip = String(st.clip || '');
      if (clip && clip !== 'auto' && !/rect\(\s*auto/i.test(clip)) reasons.push('ancestor-clip');
      var clipPath = String(st.clipPath || '');
      if (clipPath && /inset\(\s*50%/.test(clipPath)) reasons.push('ancestor-clip-path');
      node = parentOf(node);
    }
    return reasons;
  }

  function labelVisible(el) {
    var labels = labelsOf(el);
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i];
      if (!norm(label.innerText)) continue;
      // A visible label with a real box is the escape hatch for a styled
      // checkbox (opacity:0 or a 1x1 input). A label inside a closed popover
      // has no box and must not make its input reachable.
      var box = null;
      try { box = label.getBoundingClientRect(); } catch (e) { box = null; }
      if (!box || !box.width || !box.height) continue;
      var bad = ownReasons(label).concat(ancestorReasons(label));
      if (!bad.length) return true;
    }
    return false;
  }

  function describe(el, role) {
    var tag = el.tagName.toLowerCase();
    var type = tag === 'input' ? String(el.type || 'text').toLowerCase() : '';
    var name = nameOf(el);
    var href = tag === 'a' && el.href ? el.href : '';
    var reasons = ancestorReasons(el);
    var toggle = tag === 'input' && (type === 'checkbox' || type === 'radio' || type === 'file');
    var viaLabel = false;
    if (toggle && labelVisible(el)) {
      viaLabel = true;
    } else {
      reasons = reasons.concat(ownReasons(el));
      var rect = null;
      try { rect = el.getBoundingClientRect(); } catch (e) { rect = null; }
      if (!rect || !rect.width || !rect.height) {
        reasons.push('zero-size');
      } else {
        var sx = window.scrollX || 0;
        var sy = window.scrollY || 0;
        if ((rect.right + sx) <= 0 || (rect.bottom + sy) <= 0) reasons.push('offscreen');
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var inViewport = cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight;
        // The hit test only makes sense in the viewport. Shadow content and
        // elements below the fold keep the geometric verdict.
        var root = el.getRootNode ? el.getRootNode() : null;
        if (inViewport && root === el.ownerDocument) {
          var stack = el.ownerDocument.elementsFromPoint(cx, cy) || [];
          var reachable = false;
          for (var i = 0; i < stack.length; i++) {
            var node = stack[i];
            if (node === el || el.contains(node) || node.contains(el)) { reachable = true; break; }
          }
          if (!reachable) reasons.push('covered');
        }
      }
    }
    return {
      tag: tag,
      type: type,
      role: role,
      name: name,
      href: href,
      id: el.id || '',
      viaLabel: viaLabel,
      reasons: reasons,
      visible: reasons.length === 0,
      html: String(el.outerHTML || '').slice(0, 500)
    };
  }

  // <button><div role="button" aria-label="Save">Save</div></button> is one
  // control, not two: the inner div is not focusable and a click on either
  // runs the same handler. The accessibility tree flattens nested interactive
  // content, so the oracle must too. A hidden native ancestor does not count:
  // a descendant can override visibility:hidden and become visible alone.
  function nestedInNativeControl(el) {
    var node = parentOf(el);
    var guard = 0;
    while (node && node.nodeType === 1 && guard++ < 60) {
      var tag = node.tagName.toLowerCase();
      var native = tag === 'button' || tag === 'summary' || tag === 'select' || tag === 'textarea' || tag === 'input' || (tag === 'a' && node.hasAttribute('href'));
      if (native && ancestorReasons(node).length === 0) return true;
      node = parentOf(node);
    }
    return false;
  }

  // <li role="menuitem"><a href="/x">Development</a></li> exposes the same
  // destination twice: the menuitem wrapper and the link inside it. The engine
  // registers the link, and a click on the wrapper runs the link, so the
  // wrapper is a duplicate for coverage. A role on a native control is not a
  // wrapper; a wrapper with its own handler is a real second control.
  function wrapsNativeControl(el) {
    var role = norm(el.getAttribute('role')).toLowerCase();
    if (!role) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'summary') return false;
    if (el.hasAttribute('onclick') || el.hasAttribute('onmousedown') || el.hasAttribute('onkeydown') || el.hasAttribute('onkeyup')) return false;
    if (el.hasAttribute('href')) return false;
    var native = null;
    try { native = el.querySelector('a[href], button, input, select, textarea, summary'); } catch (e) { native = null; }
    return !!native;
  }

  function add(el) {
    if (!el || el.nodeType !== 1 || seen.has(el)) return;
    seen.add(el);
    var role = roleOf(el);
    if (!role || ROLES.indexOf(role) < 0) return;
    if (nestedInNativeControl(el)) return;
    if (wrapsNativeControl(el)) return;
    out.push(describe(el, role));
  }

  function collect(root) {
    var nodes = [];
    try { nodes = root.querySelectorAll(SELECTOR); } catch (e) { nodes = []; }
    for (var i = 0; i < nodes.length; i++) add(nodes[i]);
    var all = [];
    try { all = root.querySelectorAll('*'); } catch (e) { all = []; }
    for (var j = 0; j < all.length; j++) {
      if (all[j].shadowRoot) collect(all[j].shadowRoot);
    }
  }

  collect(document);
  return {
    url: location.href,
    title: document.title,
    items: out
  };
}

function normalizeName(value) {
  return String(value == null ? '' : value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// nameOf() stores at most 160 characters, while the engine keeps the full
// label. A truncated name and its full form are the same control, so compare
// the common prefix once the shorter key is at the cap.
var NAME_CAP = 160;

function namesMatch(left, right) {
  var a = normalizeName(left);
  var b = normalizeName(right);
  if (a === b) return true;
  var shorter = Math.min(a.length, b.length);
  if (shorter < NAME_CAP - 1) return false;
  return a.slice(0, shorter) === b.slice(0, shorter);
}

// The engine labels an icon+text control with the icon title and the visible
// text ("Edge - Full support Edge 12"), while the oracle only sees "12". A
// short generic word ("Save") must not pair with "Save changes", so
// containment is allowed only for numeric, multi-word or long specific names.
function containmentAllowed(value) {
  var n = normalizeName(value);
  if (!n) return false;
  if (/\d/.test(n)) return true;
  if (n.split(' ').length >= 2) return true;
  return n.length >= 12;
}

function namesContain(longer, shorter) {
  var a = normalizeName(longer);
  var b = normalizeName(shorter);
  if (b.length < 2 || a === b) return false;
  return (' ' + a + ' ').indexOf(' ' + b + ' ') >= 0;
}

function sameType(action, item) {
  if (!item.type) return true;
  return String(action.type || '').toLowerCase() === String(item.type || '').toLowerCase();
}

function compatible(action, item) {
  if (action.tag === item.tag) return true;
  if (action.role && action.role === item.role) return true;
  // A custom element host and the implementation button inside its shadow
  // root are the same control to a user.
  if (item.tag.indexOf('-') >= 0 || String(action.tag || '').indexOf('-') >= 0) return true;
  return false;
}

function normalizeHref(value) {
  return String(value || '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
}

function matchActions(actions, items) {
  const used = new Set();
  const pairs = [];
  const visibleItems = items.filter(function (item) { return item.visible; });

  function take(item, predicate) {
    for (let i = 0; i < actions.length; i++) {
      if (used.has(i)) continue;
      const action = actions[i];
      if (!predicate(action, item)) continue;
      used.add(i);
      pairs.push({ item: item, action: action });
      return true;
    }
    return false;
  }

  for (const item of visibleItems) {
    // Exact name first, strongest identity (tag + type) before role-only.
    if (take(item, function (action) {
      return namesMatch(action.label, item.name) && action.tag === item.tag && sameType(action, item) &&
        (!item.href || !action.href || normalizeHref(action.href) === normalizeHref(item.href));
    })) continue;
    if (take(item, function (action) {
      return namesMatch(action.label, item.name) && action.tag === item.tag && sameType(action, item);
    })) continue;
    if (take(item, function (action) {
      return namesMatch(action.label, item.name) && action.role === item.role;
    })) continue;
    if (take(item, function (action) {
      return namesMatch(action.label, item.name);
    })) continue;
    // Inline markup can join or separate the same words: "SearchCtrlK" and
    // "Search Ctrl K" are one control. Compare without spaces once exact
    // equality has failed.
    if (take(item, function (action) {
      var a = normalizeName(action.label).replace(/ /g, '');
      var b = normalizeName(item.name).replace(/ /g, '');
      return a.length > 0 && a === b;
    })) continue;
    // Rich engine labels: the oracle name is a token subsequence of the label.
    if (take(item, function (action) {
      return compatible(action, item) && containmentAllowed(item.name) && namesContain(action.label, item.name);
    })) continue;
    if (take(item, function (action) {
      return compatible(action, item) && containmentAllowed(action.label) && namesContain(item.name, action.label);
    })) continue;
    // A numeric-only oracle name is a version cell. The engine enriches the
    // label with the browser name ("Edge - Full support Edge 12"), so digits
    // are not comparable by value across cells; pair by tag/type order.
    if (/^\d+$/.test(normalizeName(item.name))) {
      if (take(item, function (action) {
        return action.tag === item.tag && sameType(action, item) && /\d/.test(String(action.label || ''));
      })) continue;
    }
    // Unnamed controls (the-internet checkboxes): pair by tag/type order.
    if (!item.name && take(item, function (action) {
      if (action.tag !== item.tag) return false;
      if (item.type && String(action.type || '').toLowerCase() !== item.type) return false;
      return true;
    })) continue;
    // The oracle cannot see heading-derived names. Pair a lone control of the
    // same tag/type when exactly one remains.
    if (item.tag === 'select' || item.tag === 'input' || item.tag === 'textarea') {
      let only = -1;
      let count = 0;
      for (let i = 0; i < actions.length; i++) {
        if (used.has(i)) continue;
        const action = actions[i];
        if (action.tag !== item.tag) continue;
        if (item.type && String(action.type || '').toLowerCase() !== String(item.type || '').toLowerCase()) continue;
        only = i;
        count++;
      }
      if (count === 1) {
        used.add(only);
        pairs.push({ item: item, action: actions[only] });
      }
    }
  }

  const hiddenPairs = [];
  for (const item of items) {
    if (item.visible) continue;
    for (let i = 0; i < actions.length; i++) {
      if (used.has(i)) continue;
      const action = actions[i];
      if (!item.name || !namesMatch(action.label, item.name)) continue;
      if (action.tag !== item.tag && action.role !== item.role) continue;
      used.add(i);
      hiddenPairs.push({ item: item, action: action });
      break;
    }
  }

  const unmatched = actions.filter(function (action, index) { return !used.has(index); });
  const missed = visibleItems.filter(function (item) {
    return !pairs.some(function (pair) { return pair.item === item; });
  });

  return {
    visible: visibleItems.length,
    matchedVisible: pairs.length,
    recall: visibleItems.length ? pairs.length / visibleItems.length : 1,
    missed: missed,
    hiddenMatched: hiddenPairs,
    phantom: unmatched
  };
}

module.exports = { oracle: oracle, matchActions: matchActions };
