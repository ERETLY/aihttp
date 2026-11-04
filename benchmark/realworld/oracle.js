'use strict';

// Independent oracle for the real-world harness. It runs inside Chromium and
// answers one question: which interactive elements can a user actually reach?
// It deliberately does not import anything from ahttp.js.

function oracle() {
  var SELECTOR = 'a[href], button, input, select, textarea, summary, [role], [contenteditable]';
  var ROLES = ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'textbox', 'combobox', 'slider'];
  var out = [];
  var seen = new Set();

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
    return reasons;
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
      node = node.parentElement;
    }
    return reasons;
  }

  function labelVisible(el) {
    var labels = labelsOf(el);
    for (var i = 0; i < labels.length; i++) {
      var label = labels[i];
      if (!norm(label.innerText)) continue;
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

  function add(el) {
    if (!el || el.nodeType !== 1 || seen.has(el)) return;
    seen.add(el);
    var role = roleOf(el);
    if (!role || ROLES.indexOf(role) < 0) return;
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
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+([,.;:!?)\]])/g, '$1');
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

function normalizeHref(value) {
  return String(value || '').replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
}

function matchActions(actions, items) {
  const used = new Set();
  const pairs = [];
  const visibleItems = items.filter(function (item) { return item.visible; });

  function find(item, requireHref) {
    for (let i = 0; i < actions.length; i++) {
      if (used.has(i)) continue;
      const action = actions[i];
      if (action.tag !== item.tag && action.role !== item.role) continue;
      if (!namesMatch(action.label, item.name)) continue;
      if (requireHref && item.href && normalizeHref(action.href) !== normalizeHref(item.href)) continue;
      return i;
    }
    return -1;
  }

  for (const item of visibleItems) {
    let index = find(item, true);
    if (index < 0) index = find(item, false);
    if (index < 0 && !item.name) {
      // Unnamed controls (the-internet checkboxes): pair by tag/type order.
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (used.has(i)) continue;
        if (action.tag !== item.tag) continue;
        if (item.type && String(action.type || '').toLowerCase() !== item.type) continue;
        index = i;
        break;
      }
    }
    if (index < 0 && (item.tag === 'select' || item.tag === 'input' || item.tag === 'textarea')) {
      // The oracle cannot see heading-derived names. Pair a lone control of the
      // same tag/type when exactly one remains.
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
      if (count === 1) index = only;
    }
    if (index >= 0) {
      used.add(index);
      pairs.push({ item: item, action: actions[index] });
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
