'use strict';

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'noscript']);
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',
  mdash: '\u2014', ndash: '\u2013', laquo: '\u00ab', raquo: '\u00bb',
  euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2',
  middot: '\u00b7', bull: '\u2022', deg: '\u00b0', times: '\u00d7'
};

function decodeEntities(input) {
  return String(input).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch (e) { return m; }
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : m;
  });
}

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function findTagEnd(html, from) {
  let quote = null;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '>') return i;
  }
  return -1;
}

class MiniEvent {
  constructor(type) {
    this.type = type;
    this.bubbles = false;
    this.cancelable = false;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this._stop = false;
    this._immediate = false;
  }
  initEvent(type, bubbles, cancelable) {
    this.type = type;
    this.bubbles = !!bubbles;
    this.cancelable = !!cancelable;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._immediate = true; }
  composedPath() { return []; }
}

class ClassList {
  constructor(el) { this._el = el; }
  _list() { return String(this._el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  _write(list) { this._el.setAttribute('class', list.join(' ')); }
  contains(name) { return this._list().indexOf(String(name)) >= 0; }
  add(...names) { const l = this._list(); for (const n of names) if (l.indexOf(n) < 0) l.push(n); this._write(l); }
  remove(...names) { this._write(this._list().filter((n) => names.indexOf(n) < 0)); }
  toggle(name, force) {
    const has = this.contains(name);
    const next = force === undefined ? !has : !!force;
    if (next && !has) this.add(name);
    if (!next && has) this.remove(name);
    return next;
  }
  get length() { return this._list().length; }
  item(i) { return this._list()[i] || null; }
}

class Node {
  constructor(nodeType, ownerDocument) {
    this.nodeType = nodeType;
    this.ownerDocument = ownerDocument || null;
    this.parentNode = null;
    this.childNodes = [];
    this._listeners = Object.create(null);
  }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const list = this.parentNode.childNodes;
    return list[list.indexOf(this) + 1] || null;
  }
  get previousSibling() {
    if (!this.parentNode) return null;
    const list = this.parentNode.childNodes;
    const i = list.indexOf(this);
    return i > 0 ? list[i - 1] : null;
  }
  get isConnected() {
    let node = this;
    let guard = 0;
    while (node && guard++ < 500) {
      if (node.nodeType === 9) return true;
      node = node.parentNode;
    }
    return false;
  }
  appendChild(child) {
    if (!child) return child;
    if (child.parentNode) child.parentNode.removeChild(child);
    this.childNodes.push(child);
    child.parentNode = this;
    return child;
  }
  insertBefore(child, ref) {
    if (!ref) return this.appendChild(child);
    if (child.parentNode) child.parentNode.removeChild(child);
    const idx = this.childNodes.indexOf(ref);
    if (idx < 0) return this.appendChild(child);
    this.childNodes.splice(idx, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child) {
    const idx = this.childNodes.indexOf(child);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }
  replaceChild(next, prev) {
    const idx = this.childNodes.indexOf(prev);
    if (idx < 0) return prev;
    this.childNodes[idx] = next;
    if (next) next.parentNode = this;
    if (prev) prev.parentNode = null;
    return prev;
  }
  get textContent() {
    let out = '';
    for (const child of this.childNodes) {
      if (child.nodeType === 3) out += child.nodeValue;
      else if (child.nodeType === 1) out += child.textContent;
    }
    return out;
  }
  set textContent(value) {
    this.childNodes = [];
    if (value !== '') {
      const doc = this.nodeType === 9 ? this : this.ownerDocument;
      const node = new TextNode(String(value), doc);
      this.appendChild(node);
    }
  }
  getRootNode() { return this.ownerDocument || this; }
  addEventListener(type, fn) {
    if (typeof fn !== 'function') return;
    const key = String(type);
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners[String(type)];
    if (!list) return;
    const idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
  }
  dispatchEvent(event) {
    if (!event) return true;
    if (!event.target) event.target = this;
    const path = [];
    let node = this;
    let guard = 0;
    while (node && guard++ < 200) {
      path.push(node);
      node = node.parentNode;
    }
    for (const current of path) {
      event.currentTarget = current;
      const listeners = current._listeners && current._listeners[event.type];
      if (listeners) {
        for (const fn of listeners.slice()) {
          try { fn.call(current, event); } catch (e) { /* page listeners are unavailable in the HTTP backend */ }
          if (event._immediate) break;
        }
      }
      const handler = current['on' + event.type];
      if (typeof handler === 'function') {
        try { handler.call(current, event); } catch (e) {}
      }
      if (event._stop || event._immediate) break;
    }
    event.currentTarget = null;
    return !event.defaultPrevented;
  }
}

class TextNode extends Node {
  constructor(value, ownerDocument) {
    super(3, ownerDocument);
    this.nodeValue = String(value);
  }
  get nodeName() { return '#text'; }
  get textContent() { return this.nodeValue; }
  set textContent(value) { this.nodeValue = String(value); }
  get wholeText() { return this.nodeValue; }
}

class CommentNode extends Node {
  constructor(value, ownerDocument) {
    super(8, ownerDocument);
    this.nodeValue = String(value);
  }
  get nodeName() { return '#comment'; }
  get textContent() { return ''; }
}

class Element extends Node {
  constructor(tagName, ownerDocument) {
    super(1, ownerDocument);
    this.localName = String(tagName).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.attributes = [];
    this.shadowRoot = null;
    this._value = null;
    this._checked = null;
    this._selected = null;
    this._styleCache = null;
    this.classList = new ClassList(this);
  }
  get nodeName() { return this.tagName; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() {
    const kids = this.childNodes;
    for (let i = 0; i < kids.length; i++) if (kids[i].nodeType === 1) return kids[i];
    return null;
  }
  get lastElementChild() {
    const kids = this.childNodes;
    for (let i = kids.length - 1; i >= 0; i--) if (kids[i].nodeType === 1) return kids[i];
    return null;
  }
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const list = this.parentNode.childNodes;
    const start = list.indexOf(this);
    for (let i = start + 1; i < list.length; i++) if (list[i].nodeType === 1) return list[i];
    return null;
  }
  get previousElementSibling() {
    if (!this.parentNode) return null;
    const list = this.parentNode.childNodes;
    const start = list.indexOf(this);
    for (let i = start - 1; i >= 0; i--) if (list[i].nodeType === 1) return list[i];
    return null;
  }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) {
    if (v) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }
  get isContentEditable() {
    const v = this.getAttribute('contenteditable');
    return v === '' || v === 'true' || v === 'plaintext-only';
  }
  getAttribute(name) {
    const key = String(name).toLowerCase();
    for (const attr of this.attributes) if (attr.name === key) return attr.value;
    return null;
  }
  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    const str = String(value);
    for (const attr of this.attributes) {
      if (attr.name === key) { attr.value = str; return; }
    }
    this.attributes.push({ name: key, value: str });
  }
  removeAttribute(name) {
    const key = String(name).toLowerCase();
    this.attributes = this.attributes.filter((a) => a.name !== key);
  }
  hasAttribute(name) {
    const key = String(name).toLowerCase();
    return this.attributes.some((a) => a.name === key);
  }
  hasAttributes() { return this.attributes.length > 0; }
  get style() {
    const el = this;
    return {
      getPropertyValue(name) {
        const text = el.getAttribute('style') || '';
        for (const part of text.split(';')) {
          const idx = part.indexOf(':');
          if (idx < 0) continue;
          if (part.slice(0, idx).trim().toLowerCase() === String(name).toLowerCase()) {
            return part.slice(idx + 1).trim();
          }
        }
        return '';
      },
      setProperty(name, value) {
        const text = el.getAttribute('style') || '';
        el.setAttribute('style', text + (text && !text.trim().endsWith(';') ? ';' : '') + name + ':' + value);
      }
    };
  }
  get type() {
    if (this.localName === 'input') return String(this.getAttribute('type') || 'text').toLowerCase();
    if (this.localName === 'button') return String(this.getAttribute('type') || 'submit').toLowerCase();
    return String(this.getAttribute('type') || '').toLowerCase();
  }
  get value() {
    if (this.localName === 'select') {
      const opts = this.options;
      const chosen = opts.find((o) => o.selected);
      return chosen ? chosen.value : (opts[0] ? opts[0].value : '');
    }
    if (this.localName === 'textarea') {
      return this._value != null ? this._value : this.textContent;
    }
    return this._value != null ? this._value : (this.getAttribute('value') || '');
  }
  set value(v) {
    this._value = String(v == null ? '' : v);
    if (this.localName === 'select') {
      for (const opt of this.options) opt._selected = opt.value === this._value;
    }
  }
  get checked() { return this._checked != null ? this._checked : this.hasAttribute('checked'); }
  set checked(v) {
    this._checked = !!v;
    if (v) this.setAttribute('checked', '');
    else this.removeAttribute('checked');
  }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get readOnly() { return this.hasAttribute('readonly'); }
  set readOnly(v) { if (v) this.setAttribute('readonly', ''); else this.removeAttribute('readonly'); }
  get required() { return this.hasAttribute('required'); }
  get multiple() { return this.hasAttribute('multiple'); }
  get options() { return this.children.filter((c) => c.localName === 'option'); }
  get selectedIndex() {
    const opts = this.options;
    for (let i = 0; i < opts.length; i++) if (opts[i].selected) return i;
    return opts.length ? 0 : -1;
  }
  set selectedIndex(idx) {
    const opts = this.options;
    for (let i = 0; i < opts.length; i++) opts[i]._selected = i === idx;
  }
  get selected() {
    if (this._selected != null) return this._selected;
    if (this.hasAttribute('selected')) return true;
    if (!this.parentNode || this.parentNode.localName !== 'select') return false;
    return this.parentNode.options.indexOf(this) === 0;
  }
  set selected(v) {
    this._selected = !!v;
    if (v) this.setAttribute('selected', '');
    else this.removeAttribute('selected');
  }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getClientRects() { return []; }
  scrollIntoView() {}
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  click() { const ev = new MiniEvent('click'); ev.bubbles = true; this.dispatchEvent(ev); }
  getRootNode() { return this.ownerDocument || this; }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    let node = this;
    let guard = 0;
    while (node && node.nodeType === 1 && guard++ < 200) {
      if (matchesSelector(node, selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  querySelector(selector) {
    return queryAll(this, selector, true)[0] || null;
  }
  querySelectorAll(selector) {
    return queryAll(this, selector, false);
  }
  contains(node) {
    let cur = node;
    let guard = 0;
    while (cur && guard++ < 500) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }
  get innerHTML() {
    return this.childNodes.map((child) => serializeNode(child)).join('');
  }
  set innerHTML(html) {
    this.childNodes = [];
    const nodes = parseFragment(this.ownerDocument, String(html));
    for (const node of nodes) this.appendChild(node);
  }
  get outerHTML() { return serializeNode(this); }
  get contentDocument() { return null; }
}

class Document extends Node {
  constructor(url) {
    super(9, null);
    this.ownerDocument = null;
    this.defaultView = null;
    this.URL = url;
    try { this.location = new URL(url); } catch (e) { this.location = { href: url }; }
    this.activeElement = null;
    this._styleSheets = null;
    this.readyState = 'complete';
  }
  get nodeName() { return '#document'; }
  get documentElement() {
    for (const child of this.childNodes) if (child.nodeType === 1 && child.localName === 'html') return child;
    return null;
  }
  get head() {
    const html = this.documentElement;
    if (!html) return null;
    for (const child of html.children) if (child.localName === 'head') return child;
    return null;
  }
  get body() {
    const html = this.documentElement;
    if (!html) return null;
    for (const child of html.children) if (child.localName === 'body') return child;
    return null;
  }
  get title() {
    const el = this.querySelector('title');
    return el ? el.textContent.trim() : '';
  }
  createElement(tag) { return new Element(tag, this); }
  createTextNode(value) { return new TextNode(value, this); }
  createComment(value) { return new CommentNode(value, this); }
  createEvent() { return new MiniEvent(''); }
  createDocumentFragment() { const frag = new DocumentFragment(this); return frag; }
  getElementById(id) {
    const key = String(id);
    const stack = [this.documentElement || this];
    let guard = 0;
    while (stack.length && guard++ < 200000) {
      const node = stack.pop();
      if (!node || node.nodeType !== 1) continue;
      if (node.id === key) return node;
      const kids = node.children;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return null;
  }
  querySelector(selector) { return queryAll(this.documentElement || this, selector, true)[0] || null; }
  querySelectorAll(selector) { return queryAll(this.documentElement || this, selector, false); }
  get styleSheets() {
    if (this._styleSheets) return this._styleSheets;
    const sheets = [];
    for (const el of this.querySelectorAll('style')) {
      sheets.push({ cssRules: parseCss(el.textContent) });
    }
    this._styleSheets = sheets;
    return sheets;
  }
  getElementsByTagName(tag) { return this.querySelectorAll(String(tag)); }
  getElementsByClassName(name) { return this.querySelectorAll('.' + String(name)); }
  elementFromPoint() { return null; }
}

class DocumentFragment extends Node {
  constructor(doc) { super(11, doc); }
}

function parseFragment(doc, html) {
  const temp = parseHTML('<html><head></head><body>' + html + '</body></html>', 'https://fragment.local/');
  const body = temp.body;
  const nodes = body ? body.childNodes.slice() : [];
  const out = [];
  for (const node of nodes) {
    node.parentNode = null;
    node.ownerDocument = doc;
    out.push(node);
  }
  return out;
}

function serializeNode(node) {
  if (!node) return '';
  if (node.nodeType === 3) return escapeText(node.nodeValue);
  if (node.nodeType === 8) return '<!--' + node.nodeValue + '-->';
  if (node.nodeType !== 1) return '';
  const tag = node.localName;
  let out = '<' + tag;
  for (const attr of node.attributes) out += ' ' + attr.name + '="' + escapeAttr(attr.value) + '"';
  out += '>';
  if (VOID_TAGS.has(tag)) return out;
  if (tag === 'script' || tag === 'style') {
    out += node.textContent;
  } else {
    for (const child of node.childNodes) out += serializeNode(child);
  }
  return out + '</' + tag + '>';
}

function parseAttributes(raw, el) {
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m;
  while ((m = re.exec(raw))) {
    const name = m[1];
    if (!name || name === '/') continue;
    let value = m[2] != null ? m[2] : (m[3] != null ? m[3] : (m[4] != null ? m[4] : ''));
    el.setAttribute(name, decodeEntities(value));
  }
}

function parseHTML(html, url) {
  const doc = new Document(url || 'https://localhost/');
  const stack = [doc];
  let i = 0;
  const pushText = (text) => {
    if (!text) return;
    const parent = stack[stack.length - 1];
    parent.appendChild(new TextNode(decodeEntities(text), doc));
  };
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { pushText(html.slice(i)); break; }
    if (lt > i) pushText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const text = html.slice(lt + 4, end < 0 ? html.length : end);
      stack[stack.length - 1].appendChild(new CommentNode(text, doc));
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const end = findTagEnd(html, lt + 1);
    if (end < 0) { pushText(html.slice(lt)); break; }
    const raw = html.slice(lt + 1, end);
    i = end + 1;
    if (raw[0] === '/') {
      const name = raw.slice(1).trim().toLowerCase().split(/\s+/)[0];
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s].localName === name) {
          stack.length = s;
          break;
        }
      }
      continue;
    }
    const nameMatch = raw.match(/^([A-Za-z][^\s/>]*)/);
    if (!nameMatch) continue;
    const tag = nameMatch[1];
    const el = doc.createElement(tag);
    parseAttributes(raw.slice(nameMatch[0].length), el);
    stack[stack.length - 1].appendChild(el);
    const lower = tag.toLowerCase();
    const selfClose = /\/\s*$/.test(raw);
    if (selfClose || VOID_TAGS.has(lower)) continue;
    if (RAW_TEXT.has(lower)) {
      const closeIdx = html.toLowerCase().indexOf('</' + lower, i);
      if (closeIdx < 0) {
        el.appendChild(new TextNode(html.slice(i), doc));
        i = html.length;
        break;
      }
      const content = html.slice(i, closeIdx);
      el.appendChild(new TextNode(lower === 'script' || lower === 'style' ? content : decodeEntities(content), doc));
      const gt = html.indexOf('>', closeIdx);
      i = gt < 0 ? html.length : gt + 1;
      continue;
    }
    stack.push(el);
  }
  return normalizeDocument(doc);
}

function normalizeDocument(doc) {
  let html = doc.documentElement;
  if (!html) {
    html = doc.createElement('html');
    const existing = doc.childNodes.slice();
    for (const node of existing) doc.removeChild(node);
    doc.appendChild(html);
    const head = doc.createElement('head');
    const body = doc.createElement('body');
    html.appendChild(head);
    html.appendChild(body);
    for (const node of existing) body.appendChild(node);
  }
  let head = null;
  let body = null;
  for (const child of html.children) {
    if (child.localName === 'head') head = child;
    if (child.localName === 'body') body = child;
  }
  if (!head) { head = doc.createElement('head'); html.insertBefore(head, html.firstChild); }
  if (!body) { body = doc.createElement('body'); html.appendChild(body); }
  for (const child of html.children.slice()) {
    if (child === head || child === body) continue;
    if (['title', 'meta', 'link', 'base', 'style'].indexOf(child.localName) >= 0) {
      head.appendChild(child);
    } else {
      body.appendChild(child);
    }
  }
  return doc;
}

function matchBrace(text, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

function parseDeclarations(body) {
  const map = Object.create(null);
  const important = Object.create(null);
  for (const part of String(body).split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim().toLowerCase();
    if (!name) continue;
    const raw = part.slice(idx + 1);
    important[name] = /!\s*important/i.test(raw);
    map[name] = raw.replace(/!\s*important/gi, '').trim();
  }
  const style = {
    getPropertyValue(name) { return map[String(name).toLowerCase()] || ''; },
    getPropertyPriority(name) { return important[String(name).toLowerCase()] ? 'important' : ''; }
  };
  for (const key of Object.keys(map)) {
    style[key] = map[key];
  }
  style.cssText = body;
  return style;
}

function parseCss(text) {
  const rules = [];
  const clean = String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@charset[^;]*;/gi, '')
    .replace(/@import[^;]*;/gi, '');
  function walkBlock(src, start, end, media, supports, container) {
    let i = start;
    while (i < end) {
      let open = src.indexOf('{', i);
      if (open < 0 || open >= end) break;
      const selector = src.slice(i, open).trim();
      const close = matchBrace(src, open);
      const body = src.slice(open + 1, close);
      if (selector.startsWith('@')) {
        if (!/^@(?:-\w+-)?keyframes/i.test(selector)) {
          let nextMedia = media || '';
          let nextSupports = supports || '';
          let nextContainer = container || false;
          if (/^@media\s/i.test(selector)) {
            const condition = selector.replace(/^@media\s+/i, '').trim();
            nextMedia = nextMedia ? nextMedia + ' and ' + condition : condition;
          } else if (/^@supports\s/i.test(selector)) {
            const condition = selector.replace(/^@supports\s+/i, '').trim();
            nextSupports = nextSupports ? nextSupports + ' and ' + condition : condition;
          } else if (/^@container\s/i.test(selector)) {
            // Container queries need layout the static backend does not have.
            // Mark the block so the engine can skip it instead of applying a
            // rule that may not match.
            nextContainer = true;
          }
          walkBlock(body, 0, body.length, nextMedia, nextSupports, nextContainer);
        }
      } else if (selector) {
        const rule = { selectorText: selector, style: parseDeclarations(body), media: media || '' };
        if (supports) rule.supports = supports;
        if (container) rule.container = true;
        rules.push(rule);
      }
      i = close + 1;
    }
  }
  walkBlock(clean, 0, clean.length, '', '', false);
  return rules;
}

function splitSelectorList(selector) {
  const out = [];
  let buf = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function parseComplexSelector(selector) {
  const parts = [];
  let buf = '';
  let depth = 0;
  let quote = null;
  let pendingComb = null;
  const flush = () => {
    if (!buf.trim()) { buf = ''; return; }
    parts.push({ comb: parts.length ? (pendingComb || ' ') : null, compound: buf.trim() });
    buf = '';
    pendingComb = null;
  };
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && (ch === '>' || ch === '+' || ch === '~')) {
      flush();
      pendingComb = ch;
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      if (buf.trim()) { flush(); pendingComb = ' '; }
      continue;
    }
    buf += ch;
  }
  flush();
  return parts;
}

function attrMatches(el, expr) {
  const m = expr.match(/^([^\s~^$*|=]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*)))?$/);
  if (!m) return false;
  const name = m[1].toLowerCase();
  const op = m[2];
  const value = m[3] != null ? m[3] : (m[4] != null ? m[4] : (m[5] != null ? m[5] : ''));
  const actual = el.getAttribute(name);
  if (actual == null) return false;
  if (!op) return true;
  if (op === '=') return actual === value;
  if (op === '~=') return actual.split(/\s+/).indexOf(value) >= 0;
  if (op === '^=') return actual.indexOf(value) === 0;
  if (op === '$=') return value === '' || actual.slice(-value.length) === value;
  if (op === '*=') return actual.indexOf(value) >= 0;
  if (op === '|=') return actual === value || actual.indexOf(value + '-') === 0;
  return false;
}

function pseudoMatches(el, name, arg) {
  if (name === 'first-child') return el.parentNode ? el.parentNode.children[0] === el : false;
  if (name === 'last-child') {
    if (!el.parentNode) return false;
    const list = el.parentNode.children;
    return list[list.length - 1] === el;
  }
  if (name === 'only-child') return el.parentNode ? el.parentNode.children.length === 1 : false;
  if (name === 'nth-child') {
    if (!el.parentNode) return false;
    const idx = el.parentNode.children.indexOf(el) + 1;
    const n = String(arg || '').trim();
    if (n === 'odd') return idx % 2 === 1;
    if (n === 'even') return idx % 2 === 0;
    const m = n.match(/^([+-]?\d*)n(?:([+-]\d+))?$/);
    if (m) {
      const a = m[1] === '' || m[1] === '+' ? 1 : (m[1] === '-' ? -1 : parseInt(m[1], 10));
      const b = m[2] ? parseInt(m[2], 10) : 0;
      if (a === 0) return idx === b;
      return (idx - b) / a >= 0 && (idx - b) % a === 0;
    }
    return idx === parseInt(n, 10);
  }
  if (name === 'not') return !compoundMatches(el, String(arg || ''));
  if (name === 'checked') return !!(el.checked || el.selected);
  if (name === 'disabled') return !!el.disabled;
  if (name === 'enabled') return !el.disabled;
  if (name === 'empty') return el.childNodes.length === 0;
  if (name === 'root') return el.parentNode && el.parentNode.nodeType === 9;
  if (name === 'is' || name === 'where') {
    for (const part of splitSelectorList(String(arg || ''))) {
      if (compoundMatches(el, part)) return true;
    }
    return false;
  }
  if (name === 'has') {
    const inner = String(arg || '').trim();
    return queryAll(el, inner, false).length > 0;
  }
  return false;
}

function compoundMatches(el, compound) {
  if (!el || el.nodeType !== 1) return false;
  if (!compound) return true;
  var first = compound[0];
  if (!/[A-Za-z*.#[:]/.test(first)) return false;
  let i = 0;
  const tagMatch = compound.match(/^([A-Za-z][A-Za-z0-9-]*|\*)/);
  if (tagMatch) {
    if (tagMatch[1] !== '*' && el.localName !== tagMatch[1].toLowerCase()) return false;
    i = tagMatch[0].length;
  }
  while (i < compound.length) {
    const ch = compound[i];
    if (ch === '.') {
      const m = /^\.([A-Za-z0-9_-]+)/.exec(compound.slice(i));
      if (!m) return false;
      if (!el.classList.contains(m[1])) return false;
      i += m[0].length;
    } else if (ch === '#') {
      const m = /^#([A-Za-z0-9_-]+)/.exec(compound.slice(i));
      if (!m) return false;
      if (el.id !== m[1]) return false;
      i += m[0].length;
    } else if (ch === '[') {
      let close = i + 1;
      let quote = null;
      for (; close < compound.length; close++) {
        const c = compound[close];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; continue; }
        if (c === ']') break;
      }
      if (close >= compound.length) return false;
      if (!attrMatches(el, compound.slice(i + 1, close))) return false;
      i = close + 1;
    } else if (ch === ':') {
      const m = /^::?([A-Za-z-]+)(?:\(((?:[^()]|\([^()]*\))*)\))?/.exec(compound.slice(i));
      if (!m) return false;
      const pseudo = m[1].toLowerCase();
      if (!pseudoMatches(el, pseudo, m[2])) return false;
      i += m[0].length;
    } else {
      i++;
    }
  }
  return true;
}

function matchesComplex(el, parts) {
  function matchAt(node, idx) {
    if (!node || node.nodeType !== 1) return false;
    if (!compoundMatches(node, parts[idx].compound)) return false;
    if (idx === 0) return true;
    const comb = parts[idx].comb;
    if (comb === '>') return matchAt(node.parentElement, idx - 1);
    if (comb === '+') {
      let prev = node.previousElementSibling;
      return prev ? matchAt(prev, idx - 1) : false;
    }
    if (comb === '~') {
      let prev = node.previousElementSibling;
      while (prev) {
        if (matchAt(prev, idx - 1)) return true;
        prev = prev.previousElementSibling;
      }
      return false;
    }
    let parent = node.parentElement;
    while (parent) {
      if (matchAt(parent, idx - 1)) return true;
      parent = parent.parentElement;
    }
    return false;
  }
  return parts.length ? matchAt(el, parts.length - 1) : false;
}

const selectorCache = new Map();

function compileSelector(selector) {
  const key = String(selector);
  let compiled = selectorCache.get(key);
  if (!compiled) {
    compiled = splitSelectorList(key).filter(Boolean).map((item) => parseComplexSelector(item));
    if (selectorCache.size >= 5000) selectorCache.clear();
    selectorCache.set(key, compiled);
  }
  return compiled;
}

function matchesSelector(el, selector) {
  if (!el || el.nodeType !== 1) return false;
  const compiled = compileSelector(selector);
  for (const parts of compiled) {
    if (matchesComplex(el, parts)) return true;
  }
  return false;
}

function queryAll(root, selector, firstOnly) {
  const out = [];
  if (!root) return out;
  const compiled = compileSelector(selector);
  const stack = [];
  const kids = root.childNodes || [];
  for (let i = kids.length - 1; i >= 0; i--) if (kids[i].nodeType === 1) stack.push(kids[i]);
  let guard = 0;
  while (stack.length && guard++ < 300000) {
    const el = stack.pop();
    if (!el || el.nodeType !== 1) continue;
    for (const parts of compiled) {
      if (matchesComplex(el, parts)) {
        out.push(el);
        if (firstOnly) return out;
        break;
      }
    }
    const childNodes = el.childNodes;
    for (let i = childNodes.length - 1; i >= 0; i--) {
      if (childNodes[i].nodeType === 1) stack.push(childNodes[i]);
    }
  }
  return out;
}

class NoopMutationObserver {
  constructor(callback) { this._callback = callback; }
  observe() {}
  disconnect() {}
  takeRecords() { return []; }
}

function getComputedStyle(el) {
  const map = Object.create(null);
  const decl = String((el && el.getAttribute && el.getAttribute('style')) || '');
  for (const part of decl.split(';')) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    map[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }
  const defaults = { display: el && el.localName === 'input' && el.type === 'hidden' ? 'none' : 'block', visibility: 'visible', opacity: '1' };
  return {
    display: map.display || defaults.display,
    visibility: map.visibility || defaults.visibility,
    opacity: map.opacity || defaults.opacity,
    fontSize: map['font-size'] || '16px',
    position: map.position || 'static',
    color: map.color || 'rgb(0,0,0)',
    backgroundColor: map['background-color'] || 'rgba(0, 0, 0, 0)',
    cursor: map.cursor || 'auto',
    getPropertyValue(name) { return map[String(name).toLowerCase()] || ''; }
  };
}

function createWindow(html, url) {
  const finalUrl = url || 'https://localhost/';
  const doc = parseHTML(String(html || ''), finalUrl);
  const win = {
    document: doc,
    location: doc.location,
    innerWidth: 1280,
    innerHeight: 800,
    MutationObserver: NoopMutationObserver,
    getComputedStyle,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    navigator: { userAgent: 'ahttp-mini-dom/1.0' },
    URL
  };
  doc.defaultView = win;
  return win;
}

module.exports = {
  parseHTML,
  createWindow,
  getComputedStyle,
  MiniEvent,
  Element,
  Document,
  TextNode,
  NoopMutationObserver
};
