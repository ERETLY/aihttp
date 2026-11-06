/*! ahttp.js v0.2.1 | MIT | DOM-to-action bridge for LLM agents */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    var shared = factory(root);
    // Every static page gets its own state. The default export stays a
    // singleton for backwards compatibility; create(env) binds a fresh engine
    // to one window instead of sharing S across every page in the process.
    if (shared && typeof shared === 'object' && typeof shared.create !== 'function') {
      shared.create = function (env) {
        return factory(env && env.document ? env : root);
      };
    }
    module.exports = shared;
  } else if (typeof define === 'function' && define.amd) {
    define([], function () { return factory(root); });
  } else {
    root.ahttp = factory(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function (GLOBAL) {
  'use strict';

  var VERSION = '0.2.1';
  if (GLOBAL.ahttp && GLOBAL.ahttp.__ahttp === true) return GLOBAL.ahttp;

  var SKIP_TAGS = { script: 1, style: 1, noscript: 1, template: 1, meta: 1, link: 1, head: 1, base: 1, title: 1 };
  var REGION_NAMES = { modal: 1, main: 1, chrome: 1 };
  var ROLE_KINDS = {
    button: 'click', link: 'click', menuitem: 'click', menuitemcheckbox: 'toggle',
    menuitemradio: 'toggle', option: 'click', tab: 'click', switch: 'toggle',
    checkbox: 'toggle', radio: 'toggle', combobox: 'select', textbox: 'fill',
    searchbox: 'fill', spinbutton: 'fill', slider: 'fill', treeitem: 'click',
    gridcell: 'click'
  };
  var FORM_KINDS = { fill: 1, select: 1, toggle: 1, file: 1 };
  // Relocation scoring. Stable, author-controlled anchors dominate; position,
  // order and the old structural fingerprint can only break ties. A candidate
  // must clear `accept` to run. Between `ambiguous` and `accept`, or when the
  // second candidate is within `margin`, the engine returns candidates instead
  // of guessing. `ambiguous` must stay below `accept`.
  var MATCH = {
    weights: {
      intent: 100,        // data-ahttp-intent: the page author's stable name
      testid: 90,         // data-testid / data-test / data-qa
      domId: 80,          // DOM id survives many framework rerenders
      name: 70,           // form name is authored, not copy
      accessibleName: 55, // label / aria-labelledby / aria-label / visible name
      visibleText: 45,    // separate from an aria name when both are present
      placeholder: 40,    // authored hint; weaker than a name
      title: 35,          // icon-only controls often carry only a title
      alt: 35,            // image controls
      href: 30,           // same link text, different destination
      role: 8,            // compatibility support, not an identity anchor
      tag: 6,             // compatibility support, not an identity anchor
      type: 4,            // input type survives copy changes
      path: 10,           // capped position tie-breaker
      order: 4,           // capped DOM-order tie-breaker
      structural: 6       // former fingerprint, structural part only
    },
    accept: 50,   // stable anchor, or a strong text anchor plus role/tag support
    ambiguous: 24, // below this there is nothing worth showing the agent
    margin: 12,   // the winner must be clearly ahead of the runner-up
    // Position, DOM order and the fingerprint can add up to 14 points, which is
    // more than `margin`. So the winner must also lead every other candidate on
    // content evidence alone. 5 is the smallest real gap: an exact name beats a
    // case-insensitive one by 5.
    contentMargin: 5,
    maxCandidates: 5
  };
  var TEXT_BLOCKS = {
    p: 1, li: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, blockquote: 1,
    pre: 1, td: 1, th: 1, dd: 1, dt: 1, figcaption: 1, caption: 1, summary: 1,
    address: 1, time: 1, legend: 1
  };
  var EMPTY_STYLE = {
    display: '', visibility: '', opacity: '', fontSize: '', position: '',
    left: '', top: '', color: '', background: '', clip: '', clipPath: '',
    textIndent: '', cursor: '', overflow: '', inline: null, empty: true
  };
  var EMPTY_CSS = { hidden: false, pointer: false, hard: false };
  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  var S = {
    state: 'dormant',
    win: null,
    doc: null,
    layout: false,
    canObserve: false,
    observer: null,
    dirty: true,
    scan: null,
    scanAt: 0,
    modalCache: null,
    lastScanMs: 0,
    nodeCount: 0,
    sanitized: 0,
    ignored: 0,
    seq: 0,
    registry: new Map(),
    byNode: new WeakMap(),
    startedAt: 0,
    wakeMs: 0,
    wakeCount: 0,
    lastLatencyMs: 0,
    net: { patched: false, count: 0, inflight: 0, pending: new Set(), restore: null, log: [], saved: null },
    trace: [],
    traceDropped: 0,
    autoTimer: null,
    config: null,
    configLoaded: false,
    locked: false,
    unlocked: true,
    policyHidden: 0,
    authMode: 'none',
    authExpiresAt: 0,
    authTimer: null,
    authFailures: 0,
    authBlockedUntil: 0
  };

  function now() { return Date.now(); }

  function utf8Bytes(value) {
    var out = [];
    var str = String(value == null ? '' : value);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          i++;
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        } else {
          out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function rotr(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
  }

  function sha256Hex(value) {
    var bytes = utf8Bytes(value);
    var bitLength = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var hi = Math.floor(bitLength / 0x100000000);
    var lo = bitLength >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
    bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (var i = 0; i < 16; i++) {
        w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      }
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + SHA256_K[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0;
      h[1] = (h[1] + b) | 0;
      h[2] = (h[2] + c) | 0;
      h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0;
      h[5] = (h[5] + f) | 0;
      h[6] = (h[6] + g) | 0;
      h[7] = (h[7] + hh) | 0;
    }
    var out = '';
    for (var j = 0; j < 8; j++) out += ('00000000' + ((h[j] >>> 0).toString(16))).slice(-8);
    return out;
  }

  function safeEqual(a, b) {
    a = String(a == null ? '' : a);
    b = String(b == null ? '' : b);
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function parsePolicyList(value) {
    if (Array.isArray(value)) return value.map(function (item) { return String(item).trim(); }).filter(Boolean);
    if (value == null || value === '') return [];
    return String(value).split(',').map(function (item) { return item.trim(); }).filter(Boolean);
  }

  function normalizeConfig(input) {
    input = input || {};
    var authEndpoint = input.authEndpoint ? String(input.authEndpoint) : '';
    var access = input.access != null ? String(input.access).toLowerCase() : (input.mode != null ? String(input.mode).toLowerCase() : '');
    if (['public', 'dev', 'owner', 'gate'].indexOf(access) < 0) {
      var wantsServer = !!authEndpoint;
      var wantsGate = !!input.key || !!input.keyHash;
      var wantsPrivate = input.private === true || input.private === 'true' || input.private === '' || input.private === 1;
      access = wantsServer ? 'owner' : (wantsGate ? 'gate' : (wantsPrivate ? 'owner' : 'public'));
    }
    var maxActions = input.maxActions != null && input.maxActions !== '' ? parseInt(input.maxActions, 10) : null;
    if (!isFinite(maxActions) || maxActions <= 0) maxActions = null;
    var authTimeoutMs = parseInt(input.authTimeoutMs, 10);
    if (!isFinite(authTimeoutMs) || authTimeoutMs < 1000 || authTimeoutMs > 60000) authTimeoutMs = 10000;
    var maxNodes = parseInt(input.maxNodes, 10);
    if (!isFinite(maxNodes) || maxNodes < 100 || maxNodes > 500000) maxNodes = null;
    var maxDepth = parseInt(input.maxDepth, 10);
    if (!isFinite(maxDepth) || maxDepth < 5 || maxDepth > 500) maxDepth = null;
    return {
      owner: String(input.owner == null ? '' : input.owner).trim(),
      access: access,
      private: access === 'owner' || access === 'gate',
      key: input.key ? String(input.key) : '',
      keyHash: input.keyHash ? String(input.keyHash).toLowerCase().replace(/^sha256:/, '').trim() : '',
      authEndpoint: authEndpoint,
      authOrigins: parsePolicyList(input.authOrigins),
      authTimeoutMs: authTimeoutMs,
      authorizeAction: typeof input.authorizeAction === 'function' ? input.authorizeAction : null,
      allow: parsePolicyList(input.allow),
      deny: parsePolicyList(input.deny),
      confirm: parsePolicyList(input.confirm),
      readOnly: input.readOnly === true || input.readOnly === 'true' || input.readOnly === '',
      maxActions: maxActions,
      maxNodes: maxNodes,
      maxDepth: maxDepth
    };
  }

  function readConfigElement(el) {
    if (!el || !el.getAttribute) return null;
    function get(name) { return el.getAttribute(name); }
    function has(name) { return el.hasAttribute ? el.hasAttribute(name) : get(name) != null; }
    var names = ['data-ahttp-owner', 'data-ahttp-private', 'data-ahttp-key', 'data-ahttp-key-hash',
      'data-ahttp-access', 'data-ahttp-auth-endpoint', 'data-ahttp-auth-origins', 'data-ahttp-auth-timeout',
      'data-ahttp-allow', 'data-ahttp-deny', 'data-ahttp-confirm', 'data-ahttp-readonly', 'data-ahttp-max-actions',
      'data-ahttp-max-nodes', 'data-ahttp-max-depth'];
    var present = false;
    for (var i = 0; i < names.length; i++) if (has(names[i])) present = true;
    if (!present) return null;
    return {
      owner: get('data-ahttp-owner') || '',
      private: has('data-ahttp-private') ? (get('data-ahttp-private') || 'true') : false,
      key: get('data-ahttp-key') || '',
      keyHash: get('data-ahttp-key-hash') || '',
      access: get('data-ahttp-access') || '',
      authEndpoint: get('data-ahttp-auth-endpoint') || '',
      authOrigins: get('data-ahttp-auth-origins') || '',
      authTimeoutMs: get('data-ahttp-auth-timeout') || null,
      allow: get('data-ahttp-allow') || '',
      deny: get('data-ahttp-deny') || '',
      confirm: get('data-ahttp-confirm') || '',
      readOnly: has('data-ahttp-readonly'),
      maxActions: get('data-ahttp-max-actions') || null,
      maxNodes: get('data-ahttp-max-nodes') || null,
      maxDepth: get('data-ahttp-max-depth') || null
    };
  }

  function readBootConfigQuick() {
    var cfg = GLOBAL.__AHTTP_CONFIG__;
    if (cfg && typeof cfg === 'object') return cfg;
    var env = ENV();
    var doc = env ? env.document : null;
    if (!doc) return null;
    var script = null;
    try { script = doc.currentScript || null; } catch (e) { script = null; }
    return script ? readConfigElement(script) : null;
  }

  function applyConfig(input) {
    var cfg = normalizeConfig(input);
    clearAuthTimer();
    S.config = cfg;
    S.locked = isLockedByAccess(cfg);
    S.unlocked = !S.locked;
    S.authMode = authModeFromConfig(cfg);
    S.authExpiresAt = 0;
    S.authFailures = 0;
    S.authBlockedUntil = 0;
    S.policyHidden = 0;
    S.dirty = true;
    S.scan = null;
    return cfg;
  }

  function ensureConfig() {
    if (S.configLoaded) return;
    S.configLoaded = true;
    if (S.config) return;
    var env = ENV();
    var doc = env ? env.document : null;
    if (!doc || !doc.querySelector) return;
    var el = null;
    try {
      el = doc.querySelector('script[data-ahttp-owner],script[data-ahttp-private],script[data-ahttp-key-hash],script[data-ahttp-access],script[data-ahttp-auth-endpoint],script[data-ahttp-auth-origins]');
    } catch (e) { el = null; }
    var cfg = el ? readConfigElement(el) : null;
    if (cfg) applyConfig(cfg);
  }

  function policySummary() {
    var c = S.config;
    if (!c) return null;
    return {
      owner: c.owner || null,
      access: c.access,
      private: !!c.private,
      readOnly: !!c.readOnly,
      maxActions: c.maxActions || null,
      maxNodes: c.maxNodes || null,
      maxDepth: c.maxDepth || null,
      allow: c.allow.slice(),
      deny: c.deny.slice(),
      confirm: c.confirm.slice(),
      serverAuth: !!c.authEndpoint,
      authOrigins: (c.authOrigins || []).slice(),
      authTimeoutMs: c.authEndpoint ? c.authTimeoutMs : null,
      keyConfigured: !!(c.key || c.keyHash),
      keyHashConfigured: !!c.keyHash,
      insecurePlaintextKey: !!c.key,
      clientSideGateOnly: !!(c.access === 'gate' || (c.access === 'owner' && !c.authEndpoint && (c.key || c.keyHash))),
      softGateOnly: !!(c.access === 'gate' || (c.access === 'owner' && !c.authEndpoint && (c.key || c.keyHash)))
    };
  }

  function wildcardMatch(value, pattern) {
    value = String(value == null ? '' : value).toLowerCase();
    pattern = String(pattern == null ? '' : pattern).toLowerCase();
    if (!pattern) return false;
    if (pattern === '*') return true;
    if (pattern.indexOf('*') < 0) return value === pattern;
    var source = '^' + pattern.split('*').map(function (part) {
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('.*') + '$';
    try { return new RegExp(source).test(value); } catch (e) { return false; }
  }

  function policyMatches(entry, patterns) {
    if (!patterns || !patterns.length) return false;
    var tokens = [entry.intent, entry.label, entry.name, entry.testid, entry.id];
    for (var i = 0; i < patterns.length; i++) {
      for (var j = 0; j < tokens.length; j++) {
        if (tokens[j] && wildcardMatch(tokens[j], patterns[i])) return true;
      }
    }
    return false;
  }

  function policyAllows(entry) {
    var c = S.config;
    if (!c) return true;
    if (c.deny.length && policyMatches(entry, c.deny)) return false;
    if (c.allow.length && !policyMatches(entry, c.allow)) return false;
    return true;
  }

  function policyConfirmWarning(entry) {
    var c = S.config;
    if (!c || !c.confirm.length) return null;
    return policyMatches(entry, c.confirm) ? 'Owner policy requires explicit confirmation for this action' : null;
  }

  function authModeFromConfig(cfg) {
    if (!cfg) return 'none';
    if (cfg.authEndpoint) return 'server';
    if (cfg.key || cfg.keyHash) return 'key';
    return 'none';
  }

  function isLocalHostname(hostname) {
    hostname = String(hostname || '').toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  }

  function isLocalEnv() {
    var env = ENV();
    try {
      if (env && env.location && env.location.protocol === 'file:') return true;
      return isLocalHostname(currentHostname());
    } catch (e) {
      return false;
    }
  }

  function isLockedByAccess(cfg) {
    if (!cfg) return false;
    if (cfg.access === 'dev') return !isLocalEnv();
    if (cfg.access === 'owner' || cfg.access === 'gate') return true;
    return false;
  }

  function lockReason() {
    var c = S.config;
    if (c && c.access === 'dev' && !isLocalEnv()) return 'dev_only';
    if (c && c.authEndpoint) return 'server_auth_required';
    if (c && c.access === 'gate') return 'gate_key_required';
    return 'owner_key_required';
  }

  function currentHostname() {
    var env = ENV();
    try {
      return env && env.location && env.location.hostname ? String(env.location.hostname) : '';
    } catch (e) {
      return '';
    }
  }

  function clearAuthTimer() {
    if (S.authTimer) {
      try { clearTimeout(S.authTimer); } catch (e) {}
      S.authTimer = null;
    }
  }

  function expireAuth() {
    clearAuthTimer();
    S.authExpiresAt = 0;
    resetRuntime();
    if (S.config) {
      S.locked = isLockedByAccess(S.config);
      S.unlocked = !S.locked;
      S.authMode = authModeFromConfig(S.config);
    } else {
      S.locked = false;
      S.unlocked = true;
      S.authMode = 'none';
    }
  }

  function ensureAuthFresh() {
    if (S.authMode === 'server' && !S.locked && S.authExpiresAt && now() >= S.authExpiresAt) {
      expireAuth();
    }
  }

  function scheduleAuthExpiry(expiresAt) {
    clearAuthTimer();
    if (!expiresAt) return;
    var delay = expiresAt - now();
    if (delay <= 0) {
      expireAuth();
      return;
    }
    S.authTimer = setTimeout(function () {
      S.authTimer = null;
      expireAuth();
    }, delay);
    if (S.authTimer && typeof S.authTimer.unref === 'function') S.authTimer.unref();
  }

  function normalizeExpiry(data) {
    var nowMs = now();
    var expiresAt = Number(data && data.expiresAt);
    if (!isFinite(expiresAt) || expiresAt <= 0) {
      var ttl = Number(data && data.ttlSeconds);
      expiresAt = nowMs + (isFinite(ttl) && ttl > 0 ? ttl * 1000 : 15 * 60 * 1000);
    } else if (expiresAt < 1000000000000) {
      expiresAt = expiresAt * 1000;
    }
    var max = nowMs + 24 * 60 * 60 * 1000;
    if (expiresAt > max) expiresAt = max;
    if (expiresAt <= nowMs) expiresAt = nowMs + 100;
    return Math.floor(expiresAt);
  }

  function mergeServerPolicy(server) {
    var base = S.config || {};
    var allow = (base.allow || []).slice();
    var deny = (base.deny || []).slice();
    var confirm = (base.confirm || []).slice();
    var readOnly = !!base.readOnly;
    var maxActions = base.maxActions || null;
    if (server && typeof server === 'object') {
      var serverAllow = parsePolicyList(server.allow);
      var serverDeny = parsePolicyList(server.deny);
      var serverConfirm = parsePolicyList(server.confirm);
      if (server.allow != null) {
        if (!serverAllow.length) {
          deny = deny.concat(['*']);
          allow = [];
        } else if (allow.length) {
          allow = allow.filter(function (rule) { return serverAllow.indexOf(rule) >= 0; });
        } else {
          allow = serverAllow.slice(0, 50);
        }
      }
      deny = deny.concat(serverDeny).slice(0, 50);
      confirm = confirm.concat(serverConfirm).slice(0, 50);
      if (server.readOnly === true) readOnly = true;
      var cap = parseInt(server.maxActions, 10);
      if (isFinite(cap) && cap > 0) {
        cap = Math.min(cap, 500);
        maxActions = maxActions ? Math.min(maxActions, cap) : cap;
      }
    }
    return { allow: allow, deny: deny, confirm: confirm, readOnly: readOnly, maxActions: maxActions };
  }

  async function authorize(options) {
    ensureConfig();
    options = options || {};
    var cfg = S.config;
    if (!cfg || cfg.access === 'public') {
      S.locked = false;
      S.unlocked = true;
      S.authMode = 'none';
      return { ok: true, locked: false, mode: 'public' };
    }
    if (cfg.access === 'dev') {
      return unlock();
    }
    if (!cfg.authEndpoint) {
      return unlock(options.key);
    }
    var env = ENV();
    var endpoint;
    try {
      var baseUrl = currentUrl() || (env && env.location && env.location.href) || 'https://localhost/';
      endpoint = new URL(cfg.authEndpoint, baseUrl);
    } catch (e) {
      return { ok: false, locked: true, error: 'invalid_auth_endpoint' };
    }
    if (endpoint.username || endpoint.password) {
      return { ok: false, locked: true, error: 'invalid_auth_endpoint' };
    }
    if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && isLocalHostname(endpoint.hostname))) {
      return { ok: false, locked: true, error: 'insecure_auth_endpoint' };
    }
    var pageOrigin = '';
    try { pageOrigin = new URL(baseUrl).origin; } catch (e) { pageOrigin = ''; }
    var sameOrigin = !!pageOrigin && endpoint.origin === pageOrigin;
    var allowedOrigins = [];
    var listedOrigins = cfg.authOrigins || [];
    for (var oi = 0; oi < listedOrigins.length; oi++) {
      var rawOrigin = String(listedOrigins[oi] || '').trim();
      if (!rawOrigin) continue;
      try {
        var normalizedOrigin = new URL(rawOrigin, baseUrl).origin;
        if (normalizedOrigin) allowedOrigins.push(normalizedOrigin);
      } catch (e2) {}
    }
    if (!sameOrigin && allowedOrigins.indexOf(endpoint.origin) < 0) {
      return { ok: false, locked: true, error: 'auth_endpoint_origin' };
    }
    var fetchFn = env && typeof env.fetch === 'function'
      ? env.fetch
      : (GLOBAL && typeof GLOBAL.fetch === 'function' ? GLOBAL.fetch : null);
    if (!fetchFn) {
      return { ok: false, locked: true, error: 'fetch_unavailable' };
    }
    var token = options.token != null ? String(options.token) : '';
    var headers = { 'accept': 'application/json', 'content-type': 'application/json' };
    if (token) headers['authorization'] = 'Bearer ' + token;
    var controller = null;
    var timer = null;
    if (typeof AbortController === 'function') {
      controller = new AbortController();
      timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, cfg.authTimeoutMs || 10000);
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
    try {
      var response = await fetchFn.call(env, endpoint.href, {
        method: 'POST',
        credentials: sameOrigin ? 'include' : 'omit',
        mode: 'cors',
        headers: headers,
        body: JSON.stringify({ action: 'authorize', owner: cfg.owner || null, version: VERSION }),
        signal: controller ? controller.signal : undefined
      });
      if (!response || !response.ok) {
        return { ok: false, locked: true, error: 'server_denied', status: response ? response.status : 0 };
      }
      var text;
      if (typeof response.text === 'function') {
        text = await response.text();
      } else if (typeof response.json === 'function') {
        text = JSON.stringify(await response.json());
      } else {
        return { ok: false, locked: true, error: 'invalid_server_response' };
      }
      if (!text || text.length > 65536) {
        return { ok: false, locked: true, error: 'server_response_too_large' };
      }
      var data;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (!data || data.ok !== true) {
        return { ok: false, locked: true, error: 'server_denied' };
      }
      var merged = mergeServerPolicy(data.policy);
      S.config.owner = data.owner != null ? String(data.owner).slice(0, 120) : cfg.owner;
      S.config.allow = merged.allow;
      S.config.deny = merged.deny;
      S.config.confirm = merged.confirm;
      S.config.readOnly = merged.readOnly;
      S.config.maxActions = merged.maxActions;
      S.config.access = 'owner';
      S.config.private = true;
      S.locked = false;
      S.unlocked = true;
      S.authMode = 'server';
      S.authExpiresAt = normalizeExpiry(data);
      S.authFailures = 0;
      S.authBlockedUntil = 0;
      S.dirty = true;
      S.scan = null;
      scheduleAuthExpiry(S.authExpiresAt);
      return {
        ok: true,
        locked: false,
        mode: 'server',
        owner: S.config.owner || null,
        expiresAt: S.authExpiresAt
      };
    } catch (e) {
      return {
        ok: false,
        locked: true,
        error: 'auth_request_failed',
        message: String(e && e.message ? e.message : e)
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function lockedActionResult() {
    var reason = lockReason();
    var message = reason === 'dev_only'
      ? 'This page is available only on localhost. Use public or server-verified owner access for deployed pages.'
      : (reason === 'server_auth_required'
        ? 'Call ahttp.authorize({ token }) to obtain a server-verified session.'
        : (reason === 'gate_key_required'
          ? 'This page uses a static soft gate. Call ahttp.unlock(key). The gate is not server authorization.'
          : 'Call ahttp.unlock(key) or ahttp.authorize({ token }) first.'));
    return {
      ok: false,
      blocked: true,
      locked: true,
      error: reason,
      access: S.config ? S.config.access : null,
      owner: S.config ? S.config.owner || null : null,
      message: message
    };
  }

  function lockedSnapshot(opts) {
    var owner = S.config && S.config.owner ? S.config.owner : null;
    var access = S.config ? S.config.access : 'public';
    var reason = lockReason();
    if (opts && opts.format === 'json') {
      return {
        version: VERSION,
        locked: true,
        access: access,
        owner: owner,
        error: reason,
        actions: [],
        text: [],
        meta: { locked: true, access: access, owner: owner, actions: 0, shown: 0, chars: 0, tokens: 0 }
      };
    }
    return 'ahttp ' + VERSION + ' | ' + access + '-locked' + (owner ? ' | owner=' + owner : '') + '\n' +
      '[LOCKED] ' + reason + '\nThis page exposes no actions until authorization succeeds.';
  }

  function ENV() {
    if (GLOBAL.__AHTTP_ENV__ && GLOBAL.__AHTTP_ENV__.document) return GLOBAL.__AHTTP_ENV__;
    return GLOBAL;
  }

  function tagOf(el) {
    var t = el.localName || el.tagName || '';
    return String(t).toLowerCase();
  }

  function attr(el, name) {
    if (!el || !el.getAttribute) return null;
    var v = el.getAttribute(name);
    return v == null ? null : v;
  }

  function hasAttr(el, name) {
    if (!el) return false;
    if (el.hasAttribute) return el.hasAttribute(name);
    return attr(el, name) != null;
  }

  function normText(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  function trim(s, n) {
    s = String(s == null ? '' : s);
    if (s.length <= n) return s;
    return s.slice(0, Math.max(0, n - 1)) + '\u2026';
  }

  function quote(s) {
    return '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function cssString(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function parentOf(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    var p = node.parentNode;
    if (p && p.host) return p.host;
    return null;
  }

  function connected(node) {
    if (!node) return false;
    if (typeof node.isConnected === 'boolean') return node.isConnected;
    var n = node;
    while (n) {
      if (n.nodeType === 9) return true;
      if (n.host) return true;
      n = n.parentNode;
    }
    return false;
  }

  function byId(el, id) {
    if (!id) return null;
    var root = null;
    try { root = el.getRootNode ? el.getRootNode() : el.ownerDocument; } catch (e) { root = el.ownerDocument; }
    if (root && root.getElementById) {
      var found = root.getElementById(id);
      if (found) return found;
    }
    if (root && root.querySelector) {
      try {
        var local = root.querySelector('[id="' + cssString(id) + '"]');
        if (local) return local;
      } catch (e) {}
    }
    // A shadow root can reference an id in the light DOM (aria-controls,
    // aria-labelledby, aria-owns). Fall back to the document once.
    var doc = el.ownerDocument;
    if (doc && doc !== root && doc.getElementById) {
      var inDoc = doc.getElementById(id);
      if (inDoc) return inDoc;
    }
    return null;
  }

  // labelFrom runs for every registered element. A document-wide
  // querySelector('label[for=...]') per element is quadratic on pages with
  // thousands of links, so build one map per root per scan instead.
  function labelForId(root, id) {
    if (!root || !id) return null;
    if (!root.querySelectorAll) {
      if (!root.querySelector) return null;
      try { return root.querySelector('label[for="' + escapeSel(id) + '"]'); } catch (e) { return null; }
    }
    var maps = S.labelMaps;
    if (!maps) maps = S.labelMaps = new Map();
    var map = maps.get(root);
    if (!map) {
      map = new Map();
      var labels = [];
      try { labels = root.querySelectorAll('label[for]'); } catch (e) { labels = []; }
      for (var i = 0; i < labels.length; i++) {
        var key = attr(labels[i], 'for');
        if (key && !map.has(key)) map.set(key, labels[i]);
      }
      maps.set(root, map);
    }
    return map.get(id) || null;
  }

  function escapeSel(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function matches(el, sel) {
    var fn = el.matches || el.msMatchesSelector || el.webkitMatchesSelector;
    if (!fn) return false;
    try { return fn.call(el, sel); } catch (e) { return false; }
  }

  function textOf(el) {
    if (!el) return '';
    var it = el.innerText;
    if (typeof it === 'string' && it.replace(/\s+/g, ' ').trim()) return it;
    return el.textContent || '';
  }

  function joinedText(el) {
    var out = '';
    (function visit(node) {
      var kids = node.childNodes || [];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.nodeType === 3) {
          out += k.nodeValue;
        } else if (k.nodeType === 1) {
          var t = tagOf(k);
          if (t === 'script' || t === 'style') continue;
          if (t === 'br') { out += ' '; continue; }
          out += ' ';
          visit(k);
          out += ' ';
        }
      }
    })(el);
    return normText(out).replace(/\s+([,.;:!?)\]])/g, '$1').replace(/([(\[])\s+/g, '$1');
  }

  function hasBlockDescendant(el, depth) {
    if (depth > 5) return false;
    var child = el.firstElementChild;
    var guard = 0;
    while (child && guard++ < 2000) {
      if (TEXT_BLOCKS[tagOf(child)]) return true;
      if (hasBlockDescendant(child, depth + 1)) return true;
      child = child.nextElementSibling;
    }
    return false;
  }

  function styleDecl(el) {
    var s = attr(el, 'style');
    if (!s) return null;
    var out = {};
    var parts = s.split(';');
    for (var i = 0; i < parts.length; i++) {
      var k = parts[i].indexOf(':');
      if (k < 0) continue;
      var name = parts[i].slice(0, k).trim().toLowerCase();
      var val = parts[i].slice(k + 1).replace(/!important/i, '').trim();
      if (name) out[name] = val;
    }
    return out;
  }

  function cssRulesOf(node) {
    try { return node.cssRules || null; } catch (e) { return null; }
  }

  function selectorKey(sel) {
    var parts = String(sel).split(/[\s>+~]+/).filter(function (x) { return x; });
    var last = parts.length ? parts[parts.length - 1] : String(sel);
    var cls = last.match(/\.([A-Za-z0-9_-]+)/);
    if (cls) return '.' + cls[1];
    var idm = last.match(/#([A-Za-z0-9_-]+)/);
    if (idm) return '#' + idm[1];
    var attrm = last.match(/\[\s*([A-Za-z0-9_-]+)/);
    if (attrm) return '[' + attrm[1].toLowerCase();
    var tag = last.match(/^([A-Za-z][A-Za-z0-9-]*)/);
    if (tag) return tag[1].toLowerCase();
    return '*';
  }

  function tokensOf(el) {
    var out = [tagOf(el)];
    var cls = el.className;
    if (cls && typeof cls === 'object' && cls.baseVal != null) cls = cls.baseVal;
    if (typeof cls === 'string' && cls) {
      var parts = cls.split(/\s+/);
      for (var i = 0; i < parts.length; i++) if (parts[i]) out.push('.' + parts[i]);
    }
    var id = attr(el, 'id');
    if (id) out.push('#' + id);
    if (el.attributes) {
      for (var j = 0; j < el.attributes.length; j++) {
        var name = el.attributes[j] && el.attributes[j].name;
        if (name) out.push('[' + String(name).toLowerCase());
      }
    }
    out.push('*');
    return out;
  }

  // Media Queries 4 subset, evaluated without a browser. The window used here
  // is the static one (jsdom or mini-dom); in layout mode the index is not
  // built at all. An unknown feature, an unparsable query or an over-long
  // query is false, never true: a wrong "true" hides visible content.
  var MQ_MAX_LENGTH = 500;

  function mqTrim(value) {
    return String(value == null ? '' : value).trim();
  }

  function mqSplitTop(text, sep) {
    var out = [];
    var buf = '';
    var depth = 0;
    var quote = '';
    var s = String(text == null ? '' : text);
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (quote) {
        buf += c;
        if (c === quote && s.charAt(i - 1) !== '\\') quote = '';
        continue;
      }
      if (c === '"' || c === "'") { quote = c; buf += c; continue; }
      if (c === '(' || c === '[') { depth++; buf += c; continue; }
      if (c === ')' || c === ']') { if (depth > 0) depth--; buf += c; continue; }
      if (c === sep && depth === 0) { out.push(buf); buf = ''; continue; }
      buf += c;
    }
    out.push(buf);
    return out;
  }

  function mqSplitWord(text, word) {
    var out = [];
    var buf = '';
    var depth = 0;
    var quote = '';
    var s = String(text == null ? '' : text);
    var lower = s.toLowerCase();
    var i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (quote) {
        buf += c;
        if (c === quote && s.charAt(i - 1) !== '\\') quote = '';
        i++;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; buf += c; i++; continue; }
      if (c === '(' || c === '[') { depth++; buf += c; i++; continue; }
      if (c === ')' || c === ']') { if (depth > 0) depth--; buf += c; i++; continue; }
      if (depth === 0 && lower.substr(i, word.length) === word) {
        var before = i === 0 ? '' : s.charAt(i - 1);
        var after = s.charAt(i + word.length);
        if ((!before || !mqIdentChar(before)) && (!after || !mqIdentChar(after))) {
          out.push(buf);
          buf = '';
          i += word.length;
          continue;
        }
      }
      buf += c;
      i++;
    }
    out.push(buf);
    return out;
  }

  function mqIdentChar(c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
      (c >= '0' && c <= '9') || c === '_' || c === '-';
  }

  function mqCloseAt(text, open) {
    var depth = 0;
    var quote = '';
    var s = String(text == null ? '' : text);
    for (var i = open; i < s.length; i++) {
      var c = s.charAt(i);
      if (quote) {
        if (c === quote && s.charAt(i - 1) !== '\\') quote = '';
        continue;
      }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function mqSplitOps(text) {
    var parts = [];
    var ops = [];
    var buf = '';
    var depth = 0;
    var s = String(text == null ? '' : text);
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '(') { depth++; buf += c; continue; }
      if (c === ')') { if (depth > 0) depth--; buf += c; continue; }
      if (depth === 0 && (c === '<' || c === '>' || c === '=')) {
        var op = c;
        if (c !== '=' && s.charAt(i + 1) === '=') { op += '='; i++; }
        parts.push(buf);
        ops.push(op);
        buf = '';
        continue;
      }
      buf += c;
    }
    parts.push(buf);
    return { parts: parts, ops: ops };
  }

  function mqTopColon(text) {
    var depth = 0;
    var s = String(text == null ? '' : text);
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '(') depth++;
      else if (c === ')') { if (depth > 0) depth--; }
      else if (c === ':' && depth === 0) return i;
    }
    return -1;
  }

  function mqWindow(win) {
    var w = 1280;
    var h = 720;
    if (win) {
      if (win.innerWidth) w = Number(win.innerWidth) || w;
      if (win.innerHeight) h = Number(win.innerHeight) || h;
    }
    return { w: w, h: h };
  }

  function mqUnit(number, unit, win) {
    var dims = mqWindow(win);
    var u = String(unit || '').toLowerCase();
    if (!u || u === 'px') return number;
    if (u === 'em' || u === 'rem') return number * 16;
    if (u === 'vw') return number * dims.w / 100;
    if (u === 'vh') return number * dims.h / 100;
    return null;
  }

  function mqLength(value, win) {
    var v = mqTrim(value).toLowerCase();
    if (!v) return null;
    if (v.indexOf('calc(') === 0 && mqCloseAt(v, 4) === v.length - 1) {
      return mqCalc(v.slice(5, v.length - 1), win);
    }
    var m = v.match(/^([+-]?[0-9]*\.?[0-9]+)\s*(px|em|rem|vw|vh)?$/);
    if (!m) return null;
    return mqUnit(parseFloat(m[1]), m[2], win);
  }

  function mqCalc(expr, win) {
    var toks = [];
    var s = String(expr == null ? '' : expr);
    var i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      if (c === '+' || c === '-' || c === '*' || c === '/' || c === '(' || c === ')') {
        toks.push({ op: c });
        i++;
        continue;
      }
      if ((c >= '0' && c <= '9') || c === '.') {
        var start = i;
        i++;
        while (i < s.length) {
          var d = s.charAt(i);
          if ((d >= '0' && d <= '9') || d === '.') i++;
          else break;
        }
        var number = parseFloat(s.slice(start, i));
        var ustart = i;
        while (i < s.length) {
          var u = s.charAt(i).toLowerCase();
          if ((u >= 'a' && u <= 'z') || u === '%') i++;
          else break;
        }
        var px = mqUnit(number, s.slice(ustart, i), win);
        if (px == null) return null;
        toks.push({ num: px });
        continue;
      }
      return null;
    }
    var pos = 0;
    function peek() { return pos < toks.length ? toks[pos] : null; }
    function primary() {
      var t = peek();
      if (!t) return null;
      if (t.op === '(') {
        pos++;
        var value = sum();
        if (value == null) return null;
        var close = peek();
        if (!close || close.op !== ')') return null;
        pos++;
        return value;
      }
      if (t.num != null) { pos++; return t.num; }
      return null;
    }
    function unary() {
      var t = peek();
      if (!t) return null;
      if (t.op === '+') { pos++; return unary(); }
      if (t.op === '-') { pos++; var neg = unary(); return neg == null ? null : -neg; }
      return primary();
    }
    function term() {
      var value = unary();
      if (value == null) return null;
      var t = peek();
      while (t && (t.op === '*' || t.op === '/')) {
        pos++;
        var right = unary();
        if (right == null) return null;
        if (t.op === '*') value = value * right;
        else {
          if (!right) return null;
          value = value / right;
        }
        t = peek();
      }
      return value;
    }
    function sum() {
      var value = term();
      if (value == null) return null;
      var t = peek();
      while (t && (t.op === '+' || t.op === '-')) {
        pos++;
        var right = term();
        if (right == null) return null;
        value = t.op === '+' ? value + right : value - right;
        t = peek();
      }
      return value;
    }
    var result = sum();
    if (result == null || pos !== toks.length) return null;
    return result;
  }

  function mqRatio(value) {
    var v = mqTrim(value).toLowerCase();
    var m = v.match(/^([0-9]*\.?[0-9]+)\s*\/\s*([0-9]*\.?[0-9]+)$/);
    if (m) {
      var den = parseFloat(m[2]);
      return den ? parseFloat(m[1]) / den : null;
    }
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function mqResolution(value) {
    var v = mqTrim(value).toLowerCase();
    var m = v.match(/^([0-9]*\.?[0-9]+)\s*(dppx|x)$/);
    if (m) return parseFloat(m[1]);
    m = v.match(/^([0-9]*\.?[0-9]+)\s*dpi$/);
    if (m) return parseFloat(m[1]) / 96;
    return null;
  }

  function mqActualOf(name, win) {
    var n = mqTrim(name).toLowerCase();
    var dims = mqWindow(win);
    if (n === 'width') return dims.w;
    if (n === 'height') return dims.h;
    if (n === 'aspect-ratio') return dims.h > 0 ? dims.w / dims.h : null;
    if (n === 'resolution') return 1;
    return null;
  }

  function mqValueOf(name, raw, win) {
    var n = mqTrim(name).toLowerCase();
    if (n === 'aspect-ratio') return mqRatio(raw);
    if (n === 'resolution') return mqResolution(raw);
    return mqLength(raw, win);
  }

  function mqFlipOp(op) {
    if (op === '<') return '>';
    if (op === '<=') return '>=';
    if (op === '>') return '<';
    if (op === '>=') return '<=';
    return op;
  }

  function mqCompare(x, op, y) {
    if (op === '<') return x < y;
    if (op === '<=') return x <= y;
    if (op === '>') return x > y;
    if (op === '>=') return x >= y;
    if (op === '=') return Math.abs(x - y) < 0.5;
    return false;
  }

  function mqComparePair(a, op, b, win) {
    var fa = mqActualOf(a, win);
    var fb = mqActualOf(b, win);
    var actual;
    var value;
    var oper;
    if (fa != null && fb == null) {
      actual = fa;
      value = mqValueOf(a, b, win);
      oper = op;
    } else if (fb != null && fa == null) {
      actual = fb;
      value = mqValueOf(b, a, win);
      oper = mqFlipOp(op);
    } else {
      return false;
    }
    if (actual == null || value == null) return false;
    return mqCompare(actual, oper, value);
  }

  function mqNamedFeature(name, value, win) {
    var n = mqTrim(name).toLowerCase();
    var v = mqTrim(value).toLowerCase();
    var dims = mqWindow(win);
    if (n === 'hover' || n === 'any-hover') {
      if (!v) return true;
      return v === 'hover';
    }
    if (n === 'pointer' || n === 'any-pointer') {
      if (!v) return true;
      return v === 'fine';
    }
    if (n === 'prefers-color-scheme') return v === 'light';
    if (n === 'prefers-reduced-motion') return v === 'no-preference';
    if (n === 'prefers-contrast') return v === 'no-preference';
    if (n === 'forced-colors') return v === 'none';
    if (n === 'display-mode') return v === 'browser';
    if (n === 'scripting') return v === 'enabled';
    if (n === 'orientation') return (dims.w >= dims.h ? 'landscape' : 'portrait') === v;
    if (n === 'color') {
      if (!v) return true;
      var colors = parseInt(v, 10);
      return !isNaN(colors) && 24 >= colors;
    }
    var minmax = n.match(/^(min-|max-)?(width|height|aspect-ratio|resolution)$/);
    if (minmax) {
      var actual = mqActualOf(minmax[2], win);
      var target = mqValueOf(minmax[2], v, win);
      if (actual == null || target == null) return false;
      if (minmax[1] === 'min-') return actual >= target;
      if (minmax[1] === 'max-') return actual <= target;
      return Math.abs(actual - target) < 0.5;
    }
    if (n === '-webkit-min-device-pixel-ratio') {
      var minRatio = parseFloat(v);
      return !isNaN(minRatio) && 1 >= minRatio;
    }
    if (n === '-webkit-max-device-pixel-ratio') {
      var maxRatio = parseFloat(v);
      return !isNaN(maxRatio) && 1 <= maxRatio;
    }
    if (n === '-webkit-device-pixel-ratio') {
      var ratio = parseFloat(v);
      return !isNaN(ratio) && Math.abs(ratio - 1) < 0.5;
    }
    return false;
  }

  function mqFeatureExpr(src, win) {
    var s = mqTrim(src).toLowerCase();
    if (!s) return false;
    var range = mqSplitOps(s);
    if (range.ops.length) {
      if (range.ops.length === 1) return mqComparePair(range.parts[0], range.ops[0], range.parts[1], win);
      if (range.parts.length === 3 && range.ops.length === 2) {
        return mqComparePair(range.parts[0], range.ops[0], range.parts[1], win) &&
          mqComparePair(range.parts[1], range.ops[1], range.parts[2], win);
      }
      return false;
    }
    var colon = mqTopColon(s);
    if (colon >= 0) return mqNamedFeature(s.slice(0, colon), s.slice(colon + 1), win);
    return mqNamedFeature(s, '', win);
  }

  function mqFeature(src, win) {
    var s = mqTrim(src).toLowerCase();
    if (!s) return false;
    if (s.charAt(0) === '(' && mqCloseAt(s, 0) === s.length - 1) {
      var inner = mqTrim(s.slice(1, s.length - 1));
      if (!inner) return false;
      if (inner.indexOf('(') >= 0 || inner.indexOf('not ') === 0 ||
          mqSplitWord(inner, 'and').length > 1 || mqSplitWord(inner, 'or').length > 1) {
        return mqCondition(inner, win);
      }
      return mqFeatureExpr(inner, win);
    }
    return mqFeatureExpr(s, win);
  }

  function mqCondition(src, win) {
    var s = mqTrim(src).toLowerCase();
    if (!s) return true;
    var parts = mqSplitWord(s, 'or');
    if (parts.length > 1) {
      for (var i = 0; i < parts.length; i++) {
        if (mqCondition(parts[i], win)) return true;
      }
      return false;
    }
    parts = mqSplitWord(s, 'and');
    if (parts.length > 1) {
      for (var j = 0; j < parts.length; j++) {
        if (!mqCondition(parts[j], win)) return false;
      }
      return true;
    }
    if (s.indexOf('not ') === 0) return !mqCondition(s.slice(4), win);
    if (s.indexOf('not(') === 0) return !mqCondition(s.slice(3), win);
    return mqFeature(s, win);
  }

  function mqQuery(query, win) {
    var s = mqTrim(query);
    if (!s) return false;
    var negate = false;
    if (s.indexOf('not ') === 0) {
      negate = true;
      s = mqTrim(s.slice(4));
    } else if (s.indexOf('only ') === 0) {
      s = mqTrim(s.slice(5));
    } else if (s.indexOf('not(') === 0) {
      negate = true;
      s = mqTrim(s.slice(3));
    }
    var type = '';
    var m = s.match(/^([a-z][a-z0-9-]*)/);
    if (m) {
      var word = m[1];
      if (word !== 'and' && word !== 'or' && word !== 'not') {
        type = word;
        s = mqTrim(s.slice(word.length));
      }
    }
    if (type && type !== 'all' && type !== 'screen' && type !== 'print' && type !== 'speech' &&
        type !== 'tty' && type !== 'tv' && type !== 'projection' && type !== 'handheld' &&
        type !== 'braille' && type !== 'embossed' && type !== 'aural') {
      return false;
    }
    var ok;
    if (type) {
      var typeOk = type === 'all' || type === 'screen';
      if (!typeOk) {
        ok = false;
      } else {
        if (s.indexOf('and ') === 0) s = mqTrim(s.slice(4));
        ok = !s || mqCondition(s, win);
      }
    } else {
      ok = mqCondition(s, win);
    }
    return negate ? !ok : ok;
  }

  function mediaMatches(text, win) {
    var value = mqTrim(text).toLowerCase();
    if (!value) return true;
    if (value.length > MQ_MAX_LENGTH) return false;
    var list = mqSplitTop(value, ',');
    for (var i = 0; i < list.length; i++) {
      var item = mqTrim(list[i]);
      if (!item) continue;
      if (mqQuery(item, win)) return true;
    }
    return false;
  }

  // CSS.supports is authoritative when the runtime has it. Without it the
  // static backends validate the declaration against a real style object
  // (jsdom) or a known-property table (mini-dom). An unknown condition is
  // treated as unsupported so a block that never matched cannot hide a page.
  var KNOWN_CSS_PROPS = {
    'display': 1, 'position': 1, 'top': 1, 'right': 1, 'bottom': 1, 'left': 1, 'inset': 1,
    'float': 1, 'clear': 1, 'visibility': 1, 'opacity': 1, 'color': 1,
    'background': 1, 'background-color': 1, 'background-image': 1, 'background-size': 1,
    'border': 1, 'border-color': 1, 'border-radius': 1, 'border-width': 1, 'border-style': 1,
    'margin': 1, 'margin-top': 1, 'margin-right': 1, 'margin-bottom': 1, 'margin-left': 1,
    'padding': 1, 'padding-top': 1, 'padding-right': 1, 'padding-bottom': 1, 'padding-left': 1,
    'width': 1, 'height': 1, 'min-width': 1, 'min-height': 1, 'max-width': 1, 'max-height': 1,
    'overflow': 1, 'overflow-x': 1, 'overflow-y': 1, 'box-sizing': 1, 'box-shadow': 1,
    'flex': 1, 'flex-direction': 1, 'flex-wrap': 1, 'flex-grow': 1, 'flex-shrink': 1,
    'justify-content': 1, 'align-items': 1, 'align-content': 1, 'align-self': 1, 'gap': 1,
    'grid': 1, 'grid-template-columns': 1, 'grid-template-rows': 1, 'grid-column': 1, 'grid-row': 1,
    'font': 1, 'font-size': 1, 'font-family': 1, 'font-weight': 1, 'line-height': 1,
    'text-align': 1, 'text-decoration': 1, 'text-transform': 1, 'white-space': 1,
    'letter-spacing': 1, 'word-break': 1, 'word-wrap': 1, 'vertical-align': 1,
    'transform': 1, 'transform-origin': 1, 'transition': 1, 'animation': 1,
    'cursor': 1, 'pointer-events': 1, 'z-index': 1, 'content-visibility': 1,
    'aspect-ratio': 1, 'object-fit': 1, 'clip-path': 1, 'filter': 1, 'backdrop-filter': 1,
    'user-select': 1, 'scroll-behavior': 1, 'scroll-snap-type': 1, 'contain': 1,
    'writing-mode': 1, 'direction': 1, 'list-style': 1, 'outline': 1, 'resize': 1
  };

  function supportsOne(cond, win) {
    var value = mqTrim(cond);
    if (!value) return true;
    if (/^not\s+/i.test(value)) {
      var inner = supportsOne(value.replace(/^not\s+/i, ''), win);
      return inner == null ? null : !inner;
    }
    var andParts = value.split(/\s+and\s+/i);
    if (andParts.length > 1) {
      var all = true;
      for (var i = 0; i < andParts.length; i++) {
        var r = supportsOne(andParts[i], win);
        if (r === false) return false;
        if (r == null) all = null;
      }
      return all;
    }
    var orParts = value.split(/\s+or\s+/i);
    if (orParts.length > 1) {
      var any = false;
      for (var j = 0; j < orParts.length; j++) {
        var o = supportsOne(orParts[j], win);
        if (o === true) return true;
        if (o == null) any = null;
      }
      return any;
    }
    var m = value.match(/^\(\s*([-\w]+)\s*:\s*([\s\S]+)\)$/);
    if (!m) return null;
    var prop = m[1].toLowerCase();
    var val = m[2].trim();
    if (prop.indexOf('--') === 0) return true;
    if (/^-(?:webkit|moz|ms|o)-/.test(prop)) return true;
    try {
      var doc = win && win.document;
      var probe = doc && doc.createElement ? doc.createElement('div') : null;
      var style = probe && probe.style;
      if (style && typeof style.setProperty === 'function') {
        style.setProperty('ahttp-probe-unknown', '1');
        var validates = style.getPropertyValue('ahttp-probe-unknown') === '';
        if (validates) {
          style.setProperty(prop, val);
          return !!style.getPropertyValue(prop);
        }
      }
    } catch (e) {}
    return !!KNOWN_CSS_PROPS[prop];
  }

  function supportsMatches(text, win) {
    var value = mqTrim(text);
    if (!value) return true;
    var ref = null;
    try {
      ref = win && win.CSS ? win.CSS : (GLOBAL && GLOBAL.CSS ? GLOBAL.CSS : null);
    } catch (e) { ref = null; }
    if (ref && typeof ref.supports === 'function') {
      try { return ref.supports(value); } catch (e) { return null; }
    }
    return supportsOne(value, win);
  }

  // Fast path for the simple selectors that make up most utility CSS. Falls
  // back to element.matches(): the static backends parse selectors per call.
  function cssFastKind(sel) {
    if (/^\.[A-Za-z0-9_-]+$/.test(sel)) return 'class';
    if (/^#[A-Za-z0-9_-]+$/.test(sel)) return 'id';
    if (/^[A-Za-z][A-Za-z0-9-]*$/.test(sel)) return 'tag';
    if (/^\[\s*[A-Za-z0-9_-]+\s*\]$/.test(sel)) return 'attr';
    return '';
  }

  function cssRuleMatches(el, rule) {
    var kind = rule.fastKind;
    if (!kind) return matches(el, rule.sel);
    var name = rule.fastName;
    if (kind === 'class') {
      if (el.classList && typeof el.classList.contains === 'function') return el.classList.contains(name);
      var cls = el.className;
      if (cls && typeof cls === 'object' && cls.baseVal != null) cls = cls.baseVal;
      return typeof cls === 'string' && cls.split(/\s+/).indexOf(name) >= 0;
    }
    if (kind === 'id') return attr(el, 'id') === name;
    if (kind === 'tag') return tagOf(el) === name;
    if (kind === 'attr') return attr(el, name) != null;
    return false;
  }

  function cssHasPseudoElement(sel) {
    var s = String(sel || '');
    if (s.indexOf('::') >= 0) return true;
    return /:(before|after|first-line|first-letter)([^a-z0-9_-]|$)/i.test(s);
  }

  function cssDynamicPseudo(sel) {
    return /:(hover|focus|focus-within|focus-visible|active|visited|target)([^a-z0-9_-]|$)/i.test(String(sel || ''));
  }

  function cssSkipIdent(s, i) {
    var j = i;
    while (j < s.length && mqIdentChar(s.charAt(j))) j++;
    return j;
  }

  function cssSkipBracket(s, i) {
    var quote = '';
    for (var j = i + 1; j < s.length; j++) {
      var c = s.charAt(j);
      if (quote) {
        if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === ']') return j;
    }
    return s.length - 1;
  }

  function cssSkipParen(s, i) {
    var close = mqCloseAt(s, i);
    return close < 0 ? s.length - 1 : close;
  }

  function cssSpecCmp(a, b) {
    if (!a || !b) return 0;
    if (a.a !== b.a) return a.a > b.a ? 1 : -1;
    if (a.b !== b.b) return a.b > b.b ? 1 : -1;
    if (a.c !== b.c) return a.c > b.c ? 1 : -1;
    return 0;
  }

  // Specificity approximation: :where() is zero; :is()/:not()/:has() use the
  // most specific argument; pseudo-elements count as tags. Selectors with
  // pseudo-elements or interaction pseudo-classes are dropped before this runs.
  function cssSpecificity(sel) {
    var a = 0;
    var b = 0;
    var c = 0;
    var s = String(sel || '');
    var i = 0;
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === '#') {
        a++;
        i = cssSkipIdent(s, i + 1);
        continue;
      }
      if (ch === '.') {
        b++;
        i = cssSkipIdent(s, i + 1);
        continue;
      }
      if (ch === '[') {
        b++;
        i = cssSkipBracket(s, i) + 1;
        continue;
      }
      if (ch === ':') {
        var dbl = s.charAt(i + 1) === ':';
        var j = i + (dbl ? 2 : 1);
        var start = j;
        while (j < s.length && mqIdentChar(s.charAt(j))) j++;
        var name = s.slice(start, j).toLowerCase();
        if (!dbl && (name === 'is' || name === 'not' || name === 'has' || name === 'matches')) {
          var open = j < s.length && s.charAt(j) === '(' ? j : -1;
          var close = open >= 0 ? cssSkipParen(s, open) : j - 1;
          var args = open >= 0 ? s.slice(open + 1, close) : '';
          var best = null;
          var list = mqSplitTop(args, ',');
          for (var k = 0; k < list.length; k++) {
            var spec = cssSpecificity(list[k]);
            if (!best || cssSpecCmp(spec, best) > 0) best = spec;
          }
          if (best) {
            a += best.a;
            b += best.b;
            c += best.c;
          }
          i = close + 1;
          continue;
        }
        if (!dbl && name === 'where') {
          var wopen = j < s.length && s.charAt(j) === '(' ? j : -1;
          i = wopen >= 0 ? cssSkipParen(s, wopen) + 1 : j;
          continue;
        }
        if (dbl) c++;
        else b++;
        i = j;
        if (i < s.length && s.charAt(i) === '(') i = cssSkipParen(s, i) + 1;
        continue;
      }
      if (ch === '*' || ch === '>' || ch === '+' || ch === '~' || ch === ',' || ch === ' ' ||
          ch === '\t' || ch === '\n' || ch === '\r' || ch === '|') {
        i++;
        continue;
      }
      if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '-') {
        var prev = i > 0 ? s.charAt(i - 1) : '';
        if (!prev || prev === ' ' || prev === '\t' || prev === '\n' || prev === '\r' ||
            prev === '>' || prev === '+' || prev === '~' || prev === ',' || prev === '(' || prev === '|') {
          c++;
        }
        i = cssSkipIdent(s, i + 1);
        continue;
      }
      i++;
    }
    return { a: a, b: b, c: c };
  }

  function cssPropValue(style, name) {
    if (!style) return '';
    var value = style[name];
    if (value == null && style.getPropertyValue) {
      try { value = style.getPropertyValue(name); } catch (e) { value = ''; }
    }
    return mqTrim(value).toLowerCase();
  }

  // inherit/initial/unset/revert and var() depend on the cascade we cannot see
  // in css mode; ignore the declaration instead of guessing a value.
  function cssPropUsable(value) {
    if (!value) return false;
    if (value.indexOf('var(') >= 0) return false;
    if (value === 'inherit' || value === 'initial' || value === 'unset' ||
        value === 'revert' || value === 'revert-layer') return false;
    return true;
  }

  function cssPropImportant(style, name) {
    if (!style) return false;
    try {
      if (typeof style.getPropertyPriority === 'function' &&
          style.getPropertyPriority(name) === 'important') return true;
    } catch (e) {}
    var text = '';
    try { text = String(style.cssText || ''); } catch (e) { text = ''; }
    if (!text) return false;
    var parts = text.split(';');
    for (var i = 0; i < parts.length; i++) {
      var at = parts[i].indexOf(':');
      if (at < 0) continue;
      if (mqTrim(parts[i].slice(0, at)).toLowerCase() !== name) continue;
      return /![\s]*important/i.test(parts[i].slice(at + 1));
    }
    return false;
  }

  var CSS_NO_IMPORTANT = { display: false, visibility: false, opacity: false, cursor: false };

  function buildCssIndex(doc) {
    var idx = { buckets: new Map(), rules: 0 };
    var sheets = [];
    var win = doc.defaultView || S.win || null;
    try { sheets = doc.styleSheets || []; } catch (e) { sheets = []; }
    var order = 0;
    var mediaCache = new Map();
    function addRule(rawSel, decls) {
      var sel = mqTrim(rawSel);
      if (!sel) return;
      if (sel.indexOf(':') >= 0 && (cssHasPseudoElement(sel) || cssDynamicPseudo(sel))) return;
      order++;
      idx.rules++;
      var fastKind = cssFastKind(sel);
      var fastName = '';
      if (fastKind === 'class' || fastKind === 'id') fastName = sel.slice(1);
      else if (fastKind === 'tag') fastName = sel.toLowerCase();
      else if (fastKind === 'attr') fastName = sel.slice(1, sel.length - 1).trim().toLowerCase();
      var rule = {
        sel: sel,
        order: order,
        spec: null,
        fastKind: fastKind,
        fastName: fastName,
        display: decls.display,
        visibility: decls.visibility,
        opacity: decls.opacity,
        cursor: decls.cursor,
        imp: decls.imp
      };
      var key = selectorKey(sel);
      var arr = idx.buckets.get(key);
      if (!arr) { arr = []; idx.buckets.set(key, arr); }
      arr.push(rule);
    }
    function visit(rule, media) {
      if (!rule) return;
      if (rule.type === 7 || (rule.name && !rule.selectorText) ||
          (rule.cssText && /@(?:-\w+-)?keyframes/i.test(rule.cssText))) return;
      // A container query cannot be evaluated without layout; skipping the
      // block is safer than applying a display:none that may not match.
      var kindName = '';
      try { kindName = rule.constructor && rule.constructor.name ? rule.constructor.name : ''; } catch (e) { kindName = ''; }
      if (rule.container === true || kindName === 'CSSContainerRule' ||
          (rule.conditionText && /@container/i.test(rule.cssText || ''))) return;
      if (rule.supports || kindName === 'CSSSupportsRule' ||
          (rule.conditionText && /@supports/i.test(rule.cssText || ''))) {
        var supported = supportsMatches(rule.supports || rule.conditionText || '', win);
        if (supported === false) return;
      }
      var own = '';
      try {
        if (rule.media && typeof rule.media.mediaText === 'string') own = rule.media.mediaText;
        else if (typeof rule.media === 'string') own = rule.media;
      } catch (e) { own = ''; }
      var scopeMedia = own ? (media ? media + ' and ' + own : own) : media;
      if (scopeMedia) {
        var mediaOk = mediaCache.get(scopeMedia);
        if (mediaOk === undefined) {
          mediaOk = mediaMatches(scopeMedia, win);
          mediaCache.set(scopeMedia, mediaOk);
        }
        if (!mediaOk) return;
      }
      if (typeof rule.selectorText === 'string' && rule.style) {
        var display = cssPropValue(rule.style, 'display');
        var visibility = cssPropValue(rule.style, 'visibility');
        var opacity = cssPropValue(rule.style, 'opacity');
        var cursor = cssPropValue(rule.style, 'cursor');
        var decls = {
          display: cssPropUsable(display) ? display : null,
          visibility: cssPropUsable(visibility) ? visibility : null,
          opacity: cssPropUsable(opacity) ? opacity : null,
          cursor: cssPropUsable(cursor) ? cursor : null,
          imp: null
        };
        if (decls.display || decls.visibility || decls.opacity || decls.cursor) {
          var importantText = '';
          try { importantText = String(rule.style.cssText || ''); } catch (e) { importantText = ''; }
          var mayImportant = !importantText || /![\s]*important/i.test(importantText);
          decls.imp = mayImportant ? {
            display: decls.display ? cssPropImportant(rule.style, 'display') : false,
            visibility: decls.visibility ? cssPropImportant(rule.style, 'visibility') : false,
            opacity: decls.opacity ? cssPropImportant(rule.style, 'opacity') : false,
            cursor: decls.cursor ? cssPropImportant(rule.style, 'cursor') : false
          } : CSS_NO_IMPORTANT;
          if (rule.selectorText.indexOf(',') < 0) {
            addRule(rule.selectorText, decls);
          } else {
            var list = mqSplitTop(rule.selectorText, ',');
            for (var s = 0; s < list.length; s++) addRule(list[s], decls);
          }
        }
      }
      var nested = cssRulesOf(rule);
      if (nested) {
        for (var j = 0; j < nested.length; j++) visit(nested[j], scopeMedia);
      }
    }
    for (var i = 0; i < sheets.length; i++) {
      var rules = cssRulesOf(sheets[i]);
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) visit(rules[j], '');
    }
    return idx;
  }

  function cssPick(current, rule, prop) {
    if (!rule[prop]) return current;
    var spec = rule.spec || (rule.spec = cssSpecificity(rule.sel));
    if (!current) return rule;
    if (rule.imp[prop] !== current.imp[prop]) return rule.imp[prop] ? rule : current;
    var currentSpec = current.spec || (current.spec = cssSpecificity(current.sel));
    var cmp = cssSpecCmp(spec, currentSpec);
    if (cmp !== 0) return cmp > 0 ? rule : current;
    return rule.order > current.order ? rule : current;
  }

  function cssInline(value) {
    if (value == null) return '';
    var v = mqTrim(value).toLowerCase();
    return cssPropUsable(v) ? v : '';
  }

  function cssState(el, ctx) {
    if (!ctx.css || !ctx.css.buckets.size) return EMPTY_CSS;
    var cached = ctx.cssCache.get(el);
    if (cached) return cached;
    var css = ctx.css;
    var tokens = tokensOf(el);
    var seen = ctx.cssSeen || (ctx.cssSeen = new Set());
    seen.clear();
    var winners = { display: null, visibility: null, opacity: null, cursor: null };
    for (var i = 0; i < tokens.length; i++) {
      var arr = css.buckets.get(tokens[i]);
      if (!arr) continue;
      for (var j = 0; j < arr.length; j++) {
        var rule = arr[j];
        if (seen.has(rule)) continue;
        seen.add(rule);
        if (!cssRuleMatches(el, rule)) continue;
        winners.display = cssPick(winners.display, rule, 'display');
        winners.visibility = cssPick(winners.visibility, rule, 'visibility');
        winners.opacity = cssPick(winners.opacity, rule, 'opacity');
        winners.cursor = cssPick(winners.cursor, rule, 'cursor');
      }
    }
    var inline = styleOf(el, ctx).inline || {};
    var display = cssEffective(winners.display, cssInline(inline.display), 'display');
    var visibility = cssEffective(winners.visibility, cssInline(inline.visibility), 'visibility');
    var opacity = cssEffective(winners.opacity, cssInline(inline.opacity), 'opacity');
    var cursor = cssEffective(winners.cursor, cssInline(inline.cursor), 'cursor');
    var result = {
      hidden: display === 'none' || visibility === 'hidden' || visibility === 'collapse' ||
        isZeroOpacity(opacity),
      pointer: cursor === 'pointer',
      hard: display === 'none' || visibility === 'hidden' || visibility === 'collapse'
    };
    ctx.cssCache.set(el, result);
    return result;
  }

  // Inline style beats normal declarations but loses to !important ones.
  function cssEffective(winner, inlineValue, prop) {
    if (winner && winner.imp[prop]) return winner[prop];
    if (inlineValue) return inlineValue;
    return winner ? winner[prop] : '';
  }

  function detectLayout(doc) {
    if (!doc || !doc.defaultView) return false;
    var win = doc.defaultView;
    if (typeof win.getComputedStyle !== 'function') return false;
    var body = doc.body;
    if (!body || typeof body.getBoundingClientRect !== 'function') return false;
    try {
      var r = body.getBoundingClientRect();
      if (r && (r.width > 0 || r.height > 0)) return true;
    } catch (e) {}
    return false;
  }

  function pxNum(v) {
    if (v == null) return null;
    var m = String(v).trim().match(/^(-?[\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  }

  // getBoundingClientRect is viewport-relative. The off-screen check below is
  // about document coordinates, otherwise a scrolled page loses everything
  // above the fold. Fixed elements keep viewport coordinates by definition.
  function scrollOffset(win) {
    var x = 0;
    var y = 0;
    try {
      if (win) {
        x = win.scrollX != null ? win.scrollX : (win.pageXOffset || 0);
        y = win.scrollY != null ? win.scrollY : (win.pageYOffset || 0);
      }
    } catch (e) {
      x = 0;
      y = 0;
    }
    return {
      x: isFinite(x) ? Number(x) : 0,
      y: isFinite(y) ? Number(y) : 0
    };
  }

  // Opacity can be authored as 0, 0.0, .0 or 0%. A browser normalizes computed
  // values, but the static backend and jsdom only see the authored string.
  function opacityNum(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    if (!s) return NaN;
    var n = parseFloat(s);
    if (isNaN(n)) return NaN;
    return /^[^%]*%/.test(s) ? n / 100 : n;
  }

  function isZeroOpacity(v) {
    return opacityNum(v) <= 0;
  }

  var FORM_CONTROLS = { button: 1, input: 1, select: 1, textarea: 1 };

  function firstLegendOf(fieldset) {
    var kids = fieldset.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] && kids[i].nodeType === 1 && tagOf(kids[i]) === 'legend') return kids[i];
    }
    return null;
  }

  // A form control inside <fieldset disabled> is disabled, except inside the
  // fieldset's first <legend>. The `disabled` property does not reflect this.
  function inDisabledFieldset(el) {
    if (!el || !FORM_CONTROLS[tagOf(el)]) return false;
    var child = el;
    var parent = parentOf(child);
    var guard = 0;
    while (parent && guard++ < 100) {
      if (tagOf(parent) === 'fieldset' && hasAttr(parent, 'disabled') && firstLegendOf(parent) !== child) return true;
      child = parent;
      parent = parentOf(parent);
    }
    return false;
  }

  function normColor(v) {
    v = String(v || '').trim().toLowerCase();
    if (!v) return '';
    if (v === 'transparent') return 'transparent';
    var m = v.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      var p = m[1].split(',').map(function (x) { return x.trim(); });
      if (p.length >= 4) {
        var alpha = parseFloat(p[3]);
        if (alpha === 0) return 'transparent';
        if (!isNaN(alpha) && alpha < 1) return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + alpha + ')';
      }
      if (p.length >= 3) return 'rgb(' + p[0] + ',' + p[1] + ',' + p[2] + ')';
    }
    if (v.charAt(0) === '#') {
      var h = v.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length >= 6) {
        return 'rgb(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ')';
      }
    }
    var named = { white: 'rgb(255,255,255)', black: 'rgb(0,0,0)', red: 'rgb(255,0,0)', blue: 'rgb(0,0,255)', green: 'rgb(0,128,0)' };
    return named[v] || v;
  }

  function styleOf(el, ctx) {
    var cached = ctx.styleCache.get(el);
    if (cached) return cached;
    var decl = styleDecl(el);
    if (!decl && !ctx.layout) {
      ctx.styleCache.set(el, EMPTY_STYLE);
      return EMPTY_STYLE;
    }
    var out = {
      display: (decl && decl.display || '').toLowerCase(),
      visibility: (decl && decl.visibility || '').toLowerCase(),
      opacity: decl && decl.opacity != null ? decl.opacity : '',
      fontSize: decl && decl['font-size'] != null ? decl['font-size'] : '',
      position: (decl && decl.position || '').toLowerCase(),
      left: decl && decl.left != null ? decl.left : '',
      top: decl && decl.top != null ? decl.top : '',
      color: decl && decl.color || '',
      background: decl && (decl['background-color'] || decl.background) || '',
      clip: decl && decl.clip || '',
      clipPath: decl && decl['clip-path'] || '',
      textIndent: decl && decl['text-indent'] || '',
      contentVisibility: (decl && decl['content-visibility'] || '').toLowerCase(),
      cursor: (decl && decl.cursor || '').toLowerCase(),
      overflow: (decl && decl.overflow || '').toLowerCase(),
      inline: decl,
      empty: false
    };
    if (ctx.layout && ctx.win && typeof ctx.win.getComputedStyle === 'function') {
      try {
        var cs = ctx.win.getComputedStyle(el);
        if (cs) {
          out.display = (cs.display || out.display || '').toLowerCase();
          out.visibility = (cs.visibility || out.visibility || '').toLowerCase();
          out.opacity = cs.opacity != null ? cs.opacity : out.opacity;
          out.fontSize = cs.fontSize != null ? cs.fontSize : out.fontSize;
          out.position = (cs.position || out.position || '').toLowerCase();
          out.left = cs.left != null ? cs.left : out.left;
          out.top = cs.top != null ? cs.top : out.top;
          out.color = cs.color || out.color;
          out.background = cs.backgroundColor || out.background;
          out.clip = cs.clip || out.clip;
          out.clipPath = cs.clipPath || cs.webkitClipPath || out.clipPath;
          out.textIndent = cs.textIndent != null ? cs.textIndent : out.textIndent;
          out.cursor = (cs.cursor || out.cursor || '').toLowerCase();
          out.contentVisibility = (cs.contentVisibility || out.contentVisibility || '').toLowerCase();
          out.overflow = (cs.overflow || out.overflow || '').toLowerCase();
        }
      } catch (e) {}
    }
    ctx.styleCache.set(el, out);
    return out;
  }

  function countTextNodes(el, limit) {
    var n = 0;
    (function visit(node) {
      if (n >= limit) return;
      var kids = node.childNodes || [];
      for (var i = 0; i < kids.length; i++) {
        var k = kids[i];
        if (k.nodeType === 3) {
          if (normText(k.nodeValue)) n++;
        } else if (k.nodeType === 1) {
          visit(k);
        }
      }
    })(el);
    return n;
  }

  function hiddenAncestorChain(el, ctx, isTarget) {
    var st = styleOf(el, ctx);
    var hasCss = ctx.css && ctx.css.buckets.size;
    if (st.empty && !ctx.layout && !hasCss) return null;
    var check = function (s) {
      if (s.display === 'none') return { hidden: true, suspicious: false };
      if (s.contentVisibility === 'hidden') return { hidden: true, suspicious: false };
      if (s.visibility === 'hidden' || s.visibility === 'collapse') return { hidden: true, suspicious: false };
      if (isZeroOpacity(s.opacity)) return { hidden: true, suspicious: false };
      var fs = pxNum(s.fontSize);
      if (fs === 0) return { hidden: true, suspicious: true };
      if (s.clip && /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/i.test(s.clip)) return { hidden: true, suspicious: true };
      if (s.clipPath && /inset\(\s*50%/.test(s.clipPath)) return { hidden: true, suspicious: true };
      var ti = pxNum(s.textIndent);
      if (ti != null && ti <= -999) return { hidden: true, suspicious: true };
      var op = opacityNum(s.opacity);
      if (!isNaN(op) && op > 0 && op <= 0.05) return { hidden: true, suspicious: true };
      var left = pxNum(s.left);
      var top = pxNum(s.top);
      if ((s.position === 'absolute' || s.position === 'fixed') && ((left != null && left <= -999) || (top != null && top <= -999))) {
        return { hidden: true, suspicious: true };
      }
      var c = normColor(s.color);
      var bg = normColor(s.background);
      // White-on-white is only evidence when this element renders the text.
      // A container (body, main, app shell) often inherits white while every
      // child overrides it; dropping the container hides the whole page.
      if (c && bg && c === bg && c !== 'transparent' && !el.firstElementChild) {
        return { hidden: true, suspicious: true };
      }
      return null;
    };
    var own = check(st);
    if (own) return own;
    if (ctx.css && !ctx.layout) {
      var css = cssState(el, ctx);
      if (css.hidden) return { hidden: true, suspicious: false };
    }
    if (ctx.layout && isTarget) {
      try {
        var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (rect && el.nodeType === 1) {
          var hasText = countTextNodes(el, 1) > 0;
          var offset = st.position === 'fixed' ? { x: 0, y: 0 } : scrollOffset(ctx.win);
          var boxless = st.display === 'contents';
          var clips = !st.overflow || st.overflow !== 'visible';
          // A collapsed wrapper (height 0 with absolutely positioned or
          // inline children) is common in payment iframes. Its box ends at
          // y=0 while every child is visible, so only a strictly negative
          // edge proves that the content is offscreen.
          if (!boxless && hasText && ((!rect.width && !rect.height && clips) ||
              (rect.right + offset.x) < 0 ||
              (rect.bottom + offset.y) < 0)) {
            return { hidden: true, suspicious: true };
          }
        }
      } catch (e) {}
    }
    return null;
  }

  function popoverHidden(el) {
    if (!hasAttr(el, 'popover')) return false;
    var opened = false;
    try {
      opened = typeof el.matches === 'function' && el.matches(':popover-open');
    } catch (e) {
      opened = false;
    }
    return !opened;
  }

  function hiddenReason(el, ctx) {
    var tag = tagOf(el);
    // HTMLFormElement exposes a named control as a property, so a form with
    // <input name="hidden"> makes form.hidden truthy. Read the attribute.
    if (hasAttr(el, 'hidden')) return { hidden: true, suspicious: false };
    if (tag === 'input' && String(el.type || '').toLowerCase() === 'hidden') return { hidden: true, suspicious: false };
    if (tag === 'dialog' && !hasAttr(el, 'open')) return { hidden: true, suspicious: false };
    if (popoverHidden(el)) return { hidden: true, suspicious: false };
    if (attr(el, 'aria-hidden') === 'true') return { hidden: true, suspicious: false };
    if (hasAttr(el, 'inert')) return { hidden: true, suspicious: false };
    var parent = parentOf(el);
    if (parent && tagOf(parent) === 'details' && !parent.open) {
      var first = parent.firstElementChild;
      if (!(first === el && tag === 'summary')) return { hidden: true, suspicious: false };
    }
    return hiddenAncestorChain(el, ctx, true);
  }

  function deepHiddenReason(el, ctx) {
    var node = el;
    var child = null;
    var guard = 0;
    while (node && guard++ < 60) {
      var tag = tagOf(node);
      if (hasAttr(node, 'hidden')) return true;
      if (tag === 'dialog' && !hasAttr(node, 'open')) return true;
      if (popoverHidden(node)) return true;
      if (attr(node, 'aria-hidden') === 'true') return true;
      if (hasAttr(node, 'inert')) return true;
      if (tag === 'details' && !node.open && child && tagOf(child) !== 'summary') return true;
      if (hiddenAncestorChain(node, ctx, node === el)) return true;
      child = node;
      node = parentOf(node);
    }
    return false;
  }

  // Native checkboxes and radios are commonly hidden with clip/opacity/size
  // tricks and operated through a visible label (Bootstrap, Material, Ant,
  // Tailwind sr-only). Such a control is real if only soft heuristics hide it
  // and a visible label names it. Hard hiding and a hidden/missing label keep
  // it out of the snapshot.
  function toggleType(el) {
    if (tagOf(el) !== 'input') return '';
    var type = String(el.type || attr(el, 'type') || '').toLowerCase();
    return type === 'checkbox' || type === 'radio' ? type : '';
  }

  // Native fields whose value the agent fills or picks. Used by the soft-hidden
  // recovery: a real box at partial opacity is a styled control, not a beacon.
  function nativeTextField(el) {
    var tag = tagOf(el);
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag !== 'input') return false;
    var type = String(el.type || attr(el, 'type') || 'text').toLowerCase();
    return type !== 'hidden' && type !== 'checkbox' && type !== 'radio' &&
      type !== 'file' && type !== 'submit' && type !== 'button' &&
      type !== 'reset' && type !== 'image' && type !== 'range' && type !== 'color';
  }

  function hasControlName(el) {
    if (normText(attr(el, 'aria-label'))) return true;
    if (normText(attr(el, 'placeholder'))) return true;
    if (normText(attr(el, 'title'))) return true;
    var targets = labelTargets(el);
    for (var i = 0; i < targets.length; i++) {
      if (normText(textOf(targets[i]))) return true;
    }
    return false;
  }

  function labelIsVisible(node, ctx) {
    if (!node || node.nodeType !== 1) return false;
    if (!normText(textOf(node))) return false;
    return !deepHiddenReason(node, ctx);
  }

  // TodoMVC-style rows put the checkbox and its <label> side by side without
  // for/id. A sibling <label> with no for and no control of its own is that
  // checkbox's name; one that owns a control belongs to a different field.
  function siblingLabelOf(el) {
    if (!toggleType(el)) return null;
    var sides = [el.nextElementSibling, el.previousElementSibling];
    for (var i = 0; i < sides.length; i++) {
      var side = sides[i];
      if (!side || tagOf(side) !== 'label') continue;
      if (hasAttr(side, 'for')) continue;
      var owns = null;
      try { owns = side.querySelector ? side.querySelector('input,textarea,select,button') : null; } catch (e) { owns = null; }
      if (owns) continue;
      if (!normText(textOf(side))) continue;
      return side;
    }
    return null;
  }

  // A checkbox with no label element can still be named by the text right next
  // to it: <input type=checkbox> Accept the terms. Only a direct text node
  // counts, so a following element is not mistaken for its name.
  function adjacentTextName(el) {
    if (!toggleType(el)) return '';
    var next = el.nextSibling;
    if (next && next.nodeType === 3) {
      var after = normText(next.nodeValue);
      if (after) return after;
    }
    var prev = el.previousSibling;
    if (prev && prev.nodeType === 3) {
      var before = normText(prev.nodeValue);
      if (before) return before;
    }
    return '';
  }

  function labelTargets(el) {
    var out = [];
    var node = parentOf(el);
    var guard = 0;
    while (node && guard++ < 8) {
      if (tagOf(node) === 'label') { out.push(node); break; }
      node = parentOf(node);
    }
    var id = attr(el, 'id');
    if (id) {
      var root = null;
      try { root = el.getRootNode ? el.getRootNode() : null; } catch (e) { root = null; }
      var doc = el.ownerDocument || root;
      var selector = 'label[for="' + escapeSel(id) + '"]';
      var list = [];
      if (root && root.querySelectorAll) {
        try { list = root.querySelectorAll(selector); } catch (e) { list = []; }
      }
      if (!list.length && doc && doc.querySelectorAll) {
        try { list = doc.querySelectorAll(selector); } catch (e) { list = []; }
      }
      for (var i = 0; i < list.length; i++) if (out.indexOf(list[i]) < 0) out.push(list[i]);
    }
    var labelledBy = attr(el, 'aria-labelledby');
    if (labelledBy) {
      var ids = labelledBy.split(/\s+/);
      for (var j = 0; j < ids.length; j++) {
        var target = byId(el, ids[j]);
        if (target && out.indexOf(target) < 0) out.push(target);
      }
    }
    if (!out.length) {
      var sibling = siblingLabelOf(el);
      if (sibling) out.push(sibling);
    }
    return out;
  }

  // A native control whose only name is aria-label (or a styled field with no
  // label element) has nothing to prove visibility with. It may stay only when
  // the page really has layout, the control is a real box inside the page, and
  // only soft hiding applies. A 1x1 or off-screen input is an invisible
  // prompt-injection channel, not a control; a MUI overlay is the real case.
  // `partialOnly` is for non-toggle fields: opacity must be greater than zero,
  // so a fully transparent field is never recovered.
  function realBoxSoftHidden(el, ctx, partialOnly) {
    if (!ctx.layout) return false;
    var doc = el.ownerDocument || S.doc;
    if (!doc || !detectLayout(doc)) return false;
    var st = styleOf(el, ctx);
    if (partialOnly) {
      var op = opacityNum(st.opacity);
      if (!(op > 0 && op <= 0.05)) return false;
    }
    if (pxNum(st.fontSize) === 0) return false;
    var clip = String(st.clip || '').toLowerCase();
    if (clip && clip !== 'auto' && clip !== 'none') return false;
    var clipPath = String(st.clipPath || '').toLowerCase();
    if (clipPath && clipPath !== 'none') return false;
    var indent = pxNum(st.textIndent);
    if (indent != null && indent <= -999) return false;
    var left = pxNum(st.left);
    var top = pxNum(st.top);
    if ((st.position === 'absolute' || st.position === 'fixed') &&
        ((left != null && left <= -999) || (top != null && top <= -999))) return false;
    var rect = null;
    try { rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null; } catch (e) { rect = null; }
    if (!rect || !(rect.width >= 12) || !(rect.height >= 12)) return false;
    var offset = st.position === 'fixed' ? { x: 0, y: 0 } : scrollOffset(ctx.win || doc.defaultView || null);
    var x1 = rect.left + offset.x;
    var y1 = rect.top + offset.y;
    var x2 = rect.right + offset.x;
    var y2 = rect.bottom + offset.y;
    if (x2 <= 0 || y2 <= 0) return false;
    var docEl = doc.documentElement || null;
    var body = doc.body || null;
    var win = doc.defaultView || null;
    var width = Math.max((docEl && docEl.scrollWidth) || 0, (body && body.scrollWidth) || 0, (win && win.innerWidth) || 0);
    var height = Math.max((docEl && docEl.scrollHeight) || 0, (body && body.scrollHeight) || 0, (win && win.innerHeight) || 0);
    if (width > 0 && x1 >= width) return false;
    if (height > 0 && y1 >= height) return false;
    return true;
  }

  function hasVisibleToggleLabel(el, ctx) {
    var targets = labelTargets(el);
    for (var i = 0; i < targets.length; i++) {
      if (labelIsVisible(targets[i], ctx)) return true;
    }
    if (targets.length) return false;
    if (normText(attr(el, 'aria-label'))) return realBoxSoftHidden(el, ctx, false);
    return false;
  }

  // Hard hiding wins over the soft-toggle escape. This covers the element, every
  // ancestor, and stylesheet rules, but not the clip/opacity/size heuristics.
  function hardHidden(el, ctx) {
    var node = el;
    var child = null;
    var guard = 0;
    while (node && node.nodeType === 1 && guard++ < 60) {
      var tag = tagOf(node);
      if (hasAttr(node, 'hidden')) return true;
      if (tag === 'dialog' && !hasAttr(node, 'open')) return true;
      if (popoverHidden(node)) return true;
      if (attr(node, 'aria-hidden') === 'true') return true;
      if (hasAttr(node, 'inert')) return true;
      if (tag === 'details' && !node.open && child && tagOf(child) !== 'summary') return true;
      var st = styleOf(node, ctx);
      if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return true;
      if (ctx.css && !ctx.layout) {
        var css = cssState(node, ctx);
        if (css.hidden && css.hard) return true;
      }
      child = node;
      node = parentOf(node);
    }
    return false;
  }

  function recoverableToggle(el, ctx, reason) {
    if (!reason || !toggleType(el)) return false;
    if (hardHidden(el, ctx)) return false;
    return hasVisibleToggleLabel(el, ctx);
  }

  // A styled native field can be hidden only by partial opacity: saucedemo
  // paints a span and covers it with a real <select> at opacity:0.001. The box
  // must exist, carry a name and stay on the page. display:none, opacity:0 and
  // 1x1 beacons never come back.
  function recoverableControl(el, ctx, reason) {
    if (!reason) return false;
    if (toggleType(el)) return recoverableToggle(el, ctx, reason);
    if (!nativeTextField(el)) return false;
    if (hardHidden(el, ctx)) return false;
    if (!hasControlName(el)) return false;
    return realBoxSoftHidden(el, ctx, true);
  }

  function regionOf(el, current) {
    var tag = tagOf(el);
    var role = String(attr(el, 'role') || '').toLowerCase();
    if (role === 'dialog' || role === 'alertdialog' || attr(el, 'aria-modal') === 'true' || tag === 'dialog') return 'modal';
    if (tag === 'main' || role === 'main' || tag === 'article') return 'main';
    if (tag === 'nav' || tag === 'header' || tag === 'footer' || tag === 'aside' || role === 'navigation' || role === 'banner' || role === 'contentinfo' || role === 'complementary') return 'chrome';
    return current;
  }

  function hasBackdrop(el) {
    var parent = el.parentElement;
    if (!parent) return false;
    var kids = parent.children || [];
    for (var i = 0; i < kids.length; i++) {
      var s = kids[i];
      if (s === el) continue;
      var sig = (String(s.id || '') + ' ' + String(s.className || '')).toLowerCase();
      if (/backdrop|scrim|overlay|modal-mask|mask/.test(sig)) return true;
    }
    return false;
  }

  // A cookie banner is often role=dialog aria-modal=false and only 100x40 px.
  // Scanning it as a modal hides the real page. A dialog becomes the scan root
  // only when it is actually modal: aria-modal=true, an open <dialog>, a
  // backdrop, or (with layout) a box covering a meaningful part of the viewport.
  function isModalCandidate(el, ctx) {
    if (!el || isIgnored(el)) return false;
    if (deepHiddenReason(el, ctx)) return false;
    var ariaModal = String(attr(el, 'aria-modal') || '').toLowerCase();
    if (ariaModal === 'false') return false;
    if (ariaModal === 'true') return true;
    if (tagOf(el) === 'dialog' && hasAttr(el, 'open')) return true;
    if (hasBackdrop(el)) return true;
    if (ctx.layout) {
      try {
        var rect = el.getBoundingClientRect();
        var win = el.ownerDocument.defaultView || ctx.win;
        var vw = win && win.innerWidth ? win.innerWidth : 0;
        var vh = win && win.innerHeight ? win.innerHeight : 0;
        if (vw && vh && rect.width * rect.height >= vw * vh * 0.25) return true;
      } catch (e) {}
      return false;
    }
    return true;
  }

  function findModal(doc, ctx) {
    var list;
    try {
      list = doc.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open]');
    } catch (e) {
      return null;
    }
    var best = null;
    for (var i = 0; i < list.length; i++) {
      if (isModalCandidate(list[i], ctx)) best = list[i];
    }
    return best;
  }

  function isEditable(el) {
    if (el.isContentEditable === true) return true;
    var v = attr(el, 'contenteditable');
    return v === '' || v === 'true' || v === 'plaintext-only';
  }

  function roleOf(el) {
    var r = String(attr(el, 'role') || '').toLowerCase().trim();
    if (!r) {
      // ElementInternals exposes the computed role on custom elements. Read it
      // only there so native elements keep their tag-based classification.
      var local = String(el.localName || '').toLowerCase();
      if (local.indexOf('-') >= 0 && typeof el.role === 'string') r = el.role.toLowerCase().trim();
    }
    if (!r) return '';
    return r.split(/\s+/)[0];
  }

  // <label style="cursor:pointer"> next to its own field is not a second
  // button: clicking it only focuses the field. The label stays clickable only
  // when its control will not be in the snapshot anyway (display:none, inert or
  // missing), which is how Bootstrap btn-check-style markup delegates the click.
  function labelProxyControl(el, ctx) {
    var control = null;
    var forId = attr(el, 'for');
    if (forId) {
      control = byId(el, forId);
    } else {
      try { control = el.querySelector ? el.querySelector('input,textarea,select') : null; } catch (e) { control = null; }
    }
    if (!control) return null;
    var reason = deepHiddenReason(control, ctx);
    if (!reason) return control;
    if (recoverableToggle(control, ctx, reason)) return control;
    return null;
  }

  // A cursor:pointer element that only looks clickable is a dead proxy when a
  // real native control is painted over it (saucedemo paints a span and covers
  // it with the true <select>). elementFromPoint sees the topmost box, so a hit
  // on the element itself or on its own subtree is not covered.
  function coveredByNativeControl(el, ctx) {
    var doc = el.ownerDocument || S.doc;
    if (!doc || typeof doc.elementFromPoint !== 'function') return false;
    var rect = null;
    try { rect = el.getBoundingClientRect ? el.getBoundingClientRect() : null; } catch (e) { rect = null; }
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return false;
    var hit = null;
    try { hit = doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); } catch (e) { hit = null; }
    if (!hit) return false;
    var node = hit;
    var guard = 0;
    while (node && guard++ < 8) {
      if (node === el) return false;
      if (nativeTextField(node) || toggleType(node) || tagOf(node) === 'button') return true;
      node = parentOf(node);
    }
    return false;
  }

  // A CSS rule that reveals a hidden descendant on hover is the common hover
  // card (`.figure:hover .figcaption { display:block }`). Only rules that set a
  // visible display/visibility/opacity and reference a descendant after
  // `:hover` are kept, so `a:hover { color: ... }` never becomes an action.
  function hoverRulesFor(ctx) {
    if (ctx.hoverRules) return ctx.hoverRules;
    var rules = [];
    ctx.hoverRules = rules;
    if (!ctx.layout || !ctx.doc || !ctx.doc.styleSheets) return rules;
    var win = ctx.win || ctx.doc.defaultView || null;
    function styleValue(style, name) {
      if (!style) return '';
      if (style.getPropertyValue) {
        var value = style.getPropertyValue(name);
        if (value) return String(value);
      }
      return String(style[name] || '');
    }
    function reveals(style) {
      var display = styleValue(style, 'display');
      if (display && display !== 'none') return true;
      if (styleValue(style, 'visibility') === 'visible') return true;
      var opacity = parseFloat(styleValue(style, 'opacity'));
      return !isNaN(opacity) && opacity > 0.05;
    }
    function addRule(rule, mediaOk) {
      if (!mediaOk) return;
      var selector = rule.selectorText || '';
      if (selector.indexOf(':hover') < 0 || !reveals(rule.style)) return;
      var props = [];
      var names = ['display', 'visibility', 'opacity'];
      for (var n = 0; n < names.length; n++) {
        var value = styleValue(rule.style, names[n]);
        if (!value) continue;
        props.push({
          name: names[n],
          value: value,
          priority: rule.style && rule.style.getPropertyPriority ? rule.style.getPropertyPriority(names[n]) : ''
        });
      }
      if (!props.length) return;
      var parts = selector.split(',');
      for (var i = 0; i < parts.length; i++) {
        var part = normText(parts[i]);
        var at = part.indexOf(':hover');
        if (at < 0) continue;
        var before = part.slice(0, at).replace(/[\s>+~]+$/, '');
        var compound = before.split(/[\s>+~]+/).pop();
        var after = part.slice(at + 6);
        if (!compound || !after || !/^[\s>+~]/.test(after)) continue;
        rules.push({ base: compound, full: part.replace(':hover', ''), props: props });
      }
    }
    function walk(list, mediaOk) {
      for (var i = 0; i < list.length; i++) {
        var rule = list[i];
        if (rule.selectorText) {
          addRule(rule, mediaOk);
          continue;
        }
        if (!rule.cssRules) continue;
        var ok = mediaOk;
        if (rule.media && win && typeof win.matchMedia === 'function') {
          try { ok = ok && win.matchMedia(rule.media.mediaText).matches; } catch (e) {}
        }
        walk(rule.cssRules, ok);
      }
    }
    for (var s = 0; s < ctx.doc.styleSheets.length; s++) {
      var list = null;
      try { list = ctx.doc.styleSheets[s].cssRules; } catch (e) { list = null; }
      if (list) walk(list, true);
    }
    return rules;
  }

  function hoverReveal(el, ctx) {
    if (hasAttr(el, 'onmouseover') || hasAttr(el, 'onmouseenter')) return true;
    if (!ctx.layout) return false;
    var rules = hoverRulesFor(ctx);
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      var match = false;
      try { match = typeof el.matches === 'function' && el.matches(rule.base); } catch (e) { match = false; }
      if (!match) continue;
      var target = null;
      try { target = el.querySelector(rule.full); } catch (e) { target = null; }
      if (!target) continue;
      var st = styleOf(target, ctx);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) <= 0.05) return true;
    }
    return false;
  }

  // Synthetic mouse events cannot activate a CSS :hover rule, so a hover
  // action applies the declarations of the matching reveal rule to the hidden
  // target. Inline handlers still receive the events.
  function hoverEffectsFor(el, ctx) {
    var out = [];
    if (!ctx.layout) return out;
    var rules = hoverRulesFor(ctx);
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      var match = false;
      try { match = typeof el.matches === 'function' && el.matches(rule.base); } catch (e) { match = false; }
      if (!match) continue;
      var target = null;
      try { target = el.querySelector(rule.full); } catch (e) { target = null; }
      if (!target) continue;
      var st = styleOf(target, ctx);
      if (!(st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) <= 0.05)) continue;
      out.push({ node: target, props: rule.props });
    }
    return out;
  }

  function applyHoverEffects(entry) {
    var list = entry.hoverEffects || [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      var style = item.node && item.node.style;
      if (!style || typeof style.setProperty !== 'function') continue;
      for (var j = 0; j < item.props.length; j++) {
        var prop = item.props[j];
        try { style.setProperty(prop.name, prop.value, prop.priority || ''); } catch (e) {}
      }
    }
  }

  function classify(el, st, ctx) {
    var tag = tagOf(el);
    var role = roleOf(el);
    var type = String(el.type || attr(el, 'type') || '').toLowerCase();
    if (tag === 'input') {
      if (type === 'hidden') return null;
      if (type === 'checkbox' || type === 'radio') return { kind: 'toggle', role: type, native: true };
      if (type === 'file') return { kind: 'file', role: 'file', native: true };
      if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') return { kind: 'click', role: 'button', native: true };
      return { kind: 'fill', role: role || 'textbox', native: true };
    }
    if (tag === 'textarea') return { kind: 'fill', role: role || 'textbox', native: true };
    if (tag === 'select') return { kind: 'select', role: 'combobox', native: true };
    if (tag === 'button') return { kind: 'click', role: 'button', native: true };
    if (tag === 'summary') return { kind: 'click', role: 'button', native: true };
    if (tag === 'a' && hasAttr(el, 'href')) return { kind: 'click', role: 'link', native: true };
    if (isEditable(el)) return { kind: 'fill', role: 'textbox', native: true, editable: true };
    if (role && ROLE_KINDS[role]) return { kind: ROLE_KINDS[role], role: role, native: false, custom: true };
    var pointer = st.cursor === 'pointer' || (!ctx.layout && cssState(el, ctx).pointer);
    var handler = hasAttr(el, 'onclick') || hasAttr(el, 'onmousedown') || hasAttr(el, 'onkeydown') || hasAttr(el, 'onkeyup');
    if (tag === 'label' && !handler && labelProxyControl(el, ctx)) return null;
    if (pointer || handler) {
      return { kind: 'click', role: 'button', native: false, custom: true, pointerOnly: !!pointer && !handler };
    }
    if (hoverReveal(el, ctx)) {
      return { kind: 'hover', role: 'hover', native: false, custom: true };
    }
    var ti = attr(el, 'tabindex');
    if (ti != null && parseInt(ti, 10) >= 0) return { kind: 'click', role: 'button', native: false, custom: true };
    return null;
  }

  function closestAttr(el, name) {
    var node = el;
    var guard = 0;
    while (node && guard++ < 40) {
      if (hasAttr(node, name)) return attr(node, name);
      node = parentOf(node);
    }
    return null;
  }

  function isIgnored(el) {
    return closestAttr(el, 'data-ahttp-ignore') != null;
  }

  function generatedText(el) {
    if (!S.layout || !S.win || typeof S.win.getComputedStyle !== 'function') return '';
    var out = '';
    var pseudos = ['::before', '::after'];
    for (var i = 0; i < pseudos.length; i++) {
      var content = '';
      try { content = S.win.getComputedStyle(el, pseudos[i]).content; } catch (e) { content = ''; }
      if (!content || content === 'none' || content === 'normal') continue;
      var m = String(content).match(/^["']([\s\S]*)["']$/);
      if (!m) continue;
      var text = m[1].replace(/\\A/g, ' ').replace(/\\([0-9a-f]{1,6})\s?/gi, function (all, hex) {
        try { return String.fromCodePoint(parseInt(hex, 16)); } catch (e) { return ''; }
      });
      text = normText(text);
      if (text && /[0-9A-Za-z\u00c0-\u024f\u0400-\u04ff]/.test(text)) out += (out ? ' ' : '') + text;
    }
    return out;
  }

  function labelFrom(el, info) {
    var intent = normText(attr(el, 'data-ahttp-intent'));
    if (intent) return intent;
    var tag = tagOf(el);
    var isField = tag === 'input' || tag === 'textarea' || tag === 'select';
    var labelledBy = attr(el, 'aria-labelledby');
    if (labelledBy) {
      var ids = labelledBy.split(/\s+/);
      var buf = [];
      for (var i = 0; i < ids.length; i++) {
        var target = byId(el, ids[i]);
        if (target) {
          var labelledText = normText(textOf(target));
          if (labelledText) buf.push(labelledText);
        }
      }
      if (buf.length) return buf.join(' ');
    }
    var aria = normText(attr(el, 'aria-label'));
    if (aria) return aria;
    // ElementInternals.ariaLabel is the computed ARIA name for a custom
    // element; it also covers frameworks that set it through the AOM.
    var aom = normText(el.ariaLabel);
    if (aom) return aom;
    var id = attr(el, 'id');
    if (id) {
      var lab = null;
      var root = null;
      try { root = el.getRootNode ? el.getRootNode() : el.ownerDocument; } catch (e) { root = null; }
      lab = labelForId(root, id);
      if (!lab && el.ownerDocument && el.ownerDocument !== root) lab = labelForId(el.ownerDocument, id);
      if (lab) {
        var labelText = normText(textOf(lab));
        if (labelText) return labelText;
      }
    }
    var node = el;
    var guard = 0;
    while (node && guard++ < 8) {
      if (tagOf(node) === 'label') {
        var ancestorLabel = normText(textOf(node));
        if (ancestorLabel) return ancestorLabel;
      }
      node = parentOf(node);
    }
    var siblingLabel = siblingLabelOf(el);
    if (siblingLabel) {
      var siblingLabelText = normText(textOf(siblingLabel));
      if (siblingLabelText) return siblingLabelText;
    }
    var adjacent = adjacentTextName(el);
    if (adjacent) return adjacent;
    var alt = normText(attr(el, 'alt'));
    if (alt && (tag === 'img' || tag === 'area' || (tag === 'input' && String(attr(el, 'type')).toLowerCase() === 'image'))) return alt;
    var inputType = tag === 'input' ? String(attr(el, 'type')).toLowerCase() : '';
    if (tag === 'input' && (inputType === 'submit' || inputType === 'button' || inputType === 'reset')) {
      var inputValue = normText(attr(el, 'value'));
      if (inputValue) return inputValue;
    }
    if (!isField && !info.editable) {
      var content = el.firstElementChild ? normText(joinedText(el)) : normText(el.textContent);
      if (content) return content;
    }
    var generated = generatedText(el);
    if (generated) return generated;
    var title = normText(attr(el, 'title'));
    if (title) return title;
    var ph = normText(attr(el, 'placeholder'));
    if (ph) return ph;
    var svg = el.querySelector ? el.querySelector('svg title, svg > title') : null;
    if (svg) {
      var svgText = normText(textOf(svg));
      if (svgText) return svgText;
    }
    var titled = el.querySelector ? el.querySelector('[title]') : null;
    if (titled) {
      var titledText = normText(attr(titled, 'title'));
      if (titledText) return titledText;
    }
    var img = el.querySelector ? el.querySelector('img[alt]') : null;
    if (img) {
      var imgText = normText(attr(img, 'alt'));
      if (imgText) return imgText;
    }
    var prev = el.previousElementSibling;
    if (prev) {
      var prevText = normText(textOf(prev));
      if (prevText && prevText.length <= 80) return prevText;
    }
    var parent = el.parentElement;
    if (parent) {
      var kids = parent.childNodes || [];
      var texts = [];
      for (var k = 0; k < kids.length; k++) {
        var child = kids[k];
        if (child.nodeType === 3) {
          var direct = normText(child.nodeValue);
          if (direct && texts.indexOf(direct) < 0) texts.push(direct);
        }
      }
      if (texts.length) return texts.join(' ');
    }
    var name = normText(attr(el, 'name'));
    if (name) return name;
    var testid = normText(attr(el, 'data-testid'));
    if (testid) return testid;
    if (id) return id;
    var hrefRaw = normText(attr(el, 'href'));
    if (hrefRaw) return hrefRaw;
    return tag;
  }

  // Hover-only actions must not take their name from hidden text: a hover card
  // usually contains the very content it reveals. Use only the visible name
  // sources and the alt of a visible image.
  function visibleInnerText(el) {
    var inner = '';
    try { inner = el.innerText; } catch (e) { inner = ''; }
    return typeof inner === 'string' ? normText(inner) : '';
  }

  function hoverName(el) {
    var intent = normText(attr(el, 'data-ahttp-intent'));
    if (intent) return intent;
    var aria = normText(attr(el, 'aria-label'));
    if (aria) return aria;
    var by = attr(el, 'aria-labelledby');
    if (by) {
      var ids = by.split(/\s+/);
      var parts = [];
      for (var i = 0; i < ids.length; i++) {
        var target = byId(el, ids[i]);
        if (target) {
          var partText = visibleInnerText(target);
          if (partText) parts.push(partText);
        }
      }
      if (parts.length) return parts.join(' ');
    }
    var title = normText(attr(el, 'title'));
    if (title) return title;
    var alt = normText(attr(el, 'alt'));
    if (alt) return alt;
    var img = el.querySelector ? el.querySelector('img[alt]') : null;
    if (img) {
      var imgAlt = normText(attr(img, 'alt'));
      if (imgAlt) return imgAlt;
    }
    var visible = visibleInnerText(el);
    if (visible) return visible;
    var testid = normText(attr(el, 'data-testid'));
    if (testid) return testid;
    var id = attr(el, 'id');
    if (id) return id;
    return tagOf(el);
  }

  function optionInfo(el) {
    var opts = el.options || null;
    var count = 0;
    var labels = [];
    if (opts && opts.length != null) {
      count = opts.length;
      var max = Math.min(count, 6);
      for (var i = 0; i < max; i++) {
        var o = opts[i];
        labels.push(normText(textOf(o)) || String(o.value || ''));
      }
    } else if (el.querySelectorAll) {
      var list = el.querySelectorAll('option');
      count = list.length;
      for (var j = 0; j < Math.min(count, 6); j++) labels.push(normText(textOf(list[j])));
    }
    return { count: count, labels: labels };
  }

  function readValue(el, info) {
    var tag = tagOf(el);
    if (info.kind === 'toggle') return el.checked === true;
    if (tag === 'input' || tag === 'textarea') {
      var type = String(el.type || '').toLowerCase();
      if (type === 'password') return el.value ? '***' : '';
      return el.value == null ? '' : String(el.value);
    }
    if (tag === 'select') {
      if (el.selectedIndex >= 0 && el.options && el.options[el.selectedIndex]) {
        return String(el.options[el.selectedIndex].value == null ? '' : el.options[el.selectedIndex].value);
      }
      return el.value == null ? '' : String(el.value);
    }
    if (info.role === 'combobox' || info.role === 'listbox' || info.role === 'menu') {
      var activeId = attr(el, 'aria-activedescendant');
      if (activeId) {
        var active = byId(el, activeId);
        if (active) {
          var activeText = normText(textOf(active));
          if (activeText) return activeText;
        }
      }
      var valueText = normText(attr(el, 'aria-valuetext'));
      if (valueText) return valueText;
      var ownText = normText(textOf(el));
      if (ownText) return ownText;
    }
    if (info.editable) return normText(el.textContent || '');
    return '';
  }

  function classSig(el) {
    var cls = String(el.className == null ? '' : el.className).trim();
    if (!cls) return '';
    var parts = cls.split(/\s+/).filter(function (x) { return x && x.indexOf('ahttp') !== 0; }).sort();
    return parts.slice(0, 2).join('.');
  }

  function pathOf(el, ctx) {
    var parts = [];
    var node = el;
    var guard = 0;
    while (node && guard++ < 10) {
      var parent = parentOf(node);
      if (!parent) break;
      var idx = ctx && ctx.indexMap ? (ctx.indexMap.get(node) || 0) : 0;
      parts.unshift(String(idx));
      node = parent;
    }
    return parts.join('/');
  }

  function pathSim(a, b) {
    if (!a || !b) return 0;
    var pa = a.split('/');
    var pb = b.split('/');
    var n = Math.min(pa.length, pb.length);
    var same = 0;
    for (var i = 0; i < n; i++) {
      if (pa[pa.length - 1 - i] === pb[pb.length - 1 - i]) same++;
      else break;
    }
    return n ? same / Math.max(pa.length, pb.length) : 0;
  }

  function familyOf(el, info, label) {
    var sig = classSig(el) + '/' + classSig(el.parentElement || { className: '' });
    var pattern = String(label || '').toLowerCase().replace(/[0-9]+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 40);
    return info.role + ':' + tagOf(el) + ':' + sig + ':' + pattern;
  }

  function entryFor(el) {
    var existing = S.byNode.get(el);
    if (existing) return existing;
    var id = 'a' + (++S.seq);
    var entry = { id: id, node: el };
    S.byNode.set(el, entry);
    return entry;
  }

  function register(el, info, region, ctx, form, confirmWarn, readonlyGuard) {
    var entry = entryFor(el);
    var label = info.kind === 'hover' ? hoverName(el) : labelFrom(el, info);
    var type = String(el.type || '').toLowerCase();
    var href = null;
    if (tagOf(el) === 'a') {
      var raw = attr(el, 'href') || '';
      if (raw) href = raw;
    }
    var opts = info.kind === 'select' ? optionInfo(el) : null;
    entry.tag = tagOf(el);
    entry.role = info.role || entry.tag;
    entry.kind = info.kind;
    entry.hoverEffects = info.kind === 'hover' ? hoverEffectsFor(el, ctx) : null;
    entry.native = !!info.native;
    entry.editable = !!info.editable;
    entry.label = label;
    entry.domId = attr(el, 'id') || '';
    entry.intent = attr(el, 'data-ahttp-intent') || '';
    entry.name = attr(el, 'name') || '';
    entry.testid = attr(el, 'data-testid') || '';
    entry.test = attr(el, 'data-test') || '';
    entry.qa = attr(el, 'data-qa') || '';
    entry.type = type;
    entry.href = href;
    entry.placeholder = attr(el, 'placeholder') || '';
    entry.title = normText(attr(el, 'title'));
    entry.alt = normText(attr(el, 'alt'));
    entry.ariaLabel = normText(attr(el, 'aria-label'));
    entry.visibleText = info.kind === 'hover' ? visibleInnerText(el) : normText(textOf(el));
    entry.value = readValue(el, info);
    entry.checked = info.kind === 'toggle' ? el.checked === true : undefined;
    entry.required = el.required === true || hasAttr(el, 'required');
    entry.disabled = el.disabled === true || hasAttr(el, 'disabled') || attr(el, 'aria-disabled') === 'true' || inDisabledFieldset(el);
    entry.readonly = el.readOnly === true || hasAttr(el, 'readonly') || attr(el, 'aria-readonly') === 'true' || !!readonlyGuard;
    entry.readonlyGuard = !!readonlyGuard;
    entry.confirm = confirmWarn || null;
    entry.options = opts ? opts.labels : null;
    entry.optionCount = opts ? opts.count : 0;
    entry.region = region;
    entry.form = form;
    entry.family = familyOf(el, info, label);
    entry.path = pathOf(el, ctx);
    entry.order = ctx.actions.length;
    entry.fingerprint = {
      tag: entry.tag, role: entry.role, type: type, kind: entry.kind,
      name: entry.name, testid: entry.testid, test: entry.test, qa: entry.qa,
      id: entry.domId, intent: entry.intent, label: label, href: href,
      placeholder: entry.placeholder, title: entry.title, alt: entry.alt,
      visibleText: entry.visibleText, path: entry.path, order: entry.order
    };
    S.registry.set(entry.id, entry);
    ctx.actions.push(entry);
    if (form) ctx.forms.indexOf(form) < 0 && ctx.forms.push(form);
    return entry;
  }

  function addText(ctx, value, node, region) {
    var t = normText(value);
    if (!t || t.length < 2) return;
    if (!/[0-9A-Za-z\u00c0-\u024f\u0400-\u04ff]/.test(t)) return;
    if (t.length > 200) t = t.slice(0, 200);
    if (ctx.textChars > 6000) return;
    if (ctx.lastText === t) return;
    ctx.lastText = t;
    ctx.textChars += t.length;
    ctx.text.push({ text: t, node: node, region: region });
  }

  function walkChildren(el, region, depth, ctx, textOff, form, confirmWarn, readonlyGuard) {
    var registered = 0;
    var kids = el.childNodes || [];
    // A slot renders its assigned light-DOM nodes, not its fallback children.
    // Walking both is safe because ctx.visited dedupes, but the fallback is
    // not rendered when an assignment exists.
    if (tagOf(el) === 'slot' && typeof el.assignedNodes === 'function') {
      var assigned = [];
      try { assigned = el.assignedNodes({ flatten: true }) || []; } catch (e) { assigned = []; }
      if (assigned.length) kids = assigned;
    }
    var elemIdx = 0;
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      if (node.nodeType === 3) {
        if (!textOff) addText(ctx, node.nodeValue, el, region);
      } else if (node.nodeType === 1) {
        if (ctx.nodes > ctx.nodeLimit) { ctx.truncated = true; break; }
        ctx.indexMap.set(node, elemIdx++);
        registered += walk(node, region, depth + 1, ctx, textOff, form, confirmWarn, readonlyGuard);
      }
    }
    var sr = el.shadowRoot;
    if (sr) {
      ctx.shadow++;
      var shadowIdx = 0;
      var skids = sr.childNodes || [];
      for (var j = 0; j < skids.length; j++) {
        var sk = skids[j];
        if (sk.nodeType === 3) {
          if (!textOff) addText(ctx, sk.nodeValue, el, region);
        } else if (sk.nodeType === 1) {
          ctx.indexMap.set(sk, shadowIdx++);
          registered += walk(sk, region, depth + 1, ctx, textOff, form, confirmWarn, readonlyGuard);
        }
      }
    }
    var subTag = tagOf(el);
    if ((subTag === 'iframe' || subTag === 'frame') && ctx.iframeDepth < 2) {
      var subDoc = null;
      try { subDoc = el.contentDocument || null; } catch (e) { subDoc = null; }
      if (subDoc && (subDoc.body || subDoc.documentElement)) {
        var subLayout = detectLayout(subDoc);
        var sub = {
          doc: subDoc,
          win: subDoc.defaultView || ctx.win,
          layout: subLayout,
          css: subLayout ? { buckets: new Map(), rules: 0 } : buildCssIndex(subDoc),
          styleCache: new Map(),
          actions: ctx.actions,
          text: ctx.text,
          forms: ctx.forms,
          nodeLimit: ctx.nodeLimit,
          nodes: ctx.nodes,
          sanitized: ctx.sanitized,
          ignored: ctx.ignored,
          textChars: ctx.textChars,
          lastText: ctx.lastText,
          shadow: ctx.shadow,
          iframeDepth: ctx.iframeDepth + 1,
          truncated: ctx.truncated,
          cssCache: new Map(),
          cssSeen: new Set(),
          indexMap: new Map()
        };
        var subRoot = subDoc.body || subDoc.documentElement;
        registered += walk(subRoot, region, depth + 1, sub, textOff, null, confirmWarn, readonlyGuard);
        ctx.nodes = sub.nodes;
        ctx.sanitized = sub.sanitized;
        ctx.ignored = sub.ignored;
        ctx.textChars = sub.textChars;
        ctx.lastText = sub.lastText;
        ctx.shadow = sub.shadow;
        ctx.truncated = sub.truncated;
      }
    }
    return registered;
  }

  // aria-owns moves a subtree under the owner for assistive technology even
  // when the DOM keeps it elsewhere. Walk those nodes once, in the owner's
  // region, and let the visited set prevent a second registration.
  function walkOwned(el, region, depth, ctx, textOff, form, confirmWarn, readonlyGuard) {
    var owns = attr(el, 'aria-owns');
    if (!owns) return 0;
    var ids = String(owns).split(/\s+/);
    var count = 0;
    var ownRegion = regionOf(el, region);
    for (var i = 0; i < ids.length; i++) {
      if (!ids[i]) continue;
      var node = byId(el, ids[i]);
      if (!node || node.nodeType !== 1) continue;
      count += walk(node, ownRegion, depth + 1, ctx, textOff, form, confirmWarn, readonlyGuard);
    }
    return count;
  }

  function walk(el, region, depth, ctx, textOff, form, confirmWarn, readonlyGuard) {
    if (!el || el.nodeType !== 1) return 0;
    if (!ctx.visited) ctx.visited = new Set();
    if (ctx.visited.has(el)) return 0;
    ctx.visited.add(el);
    if (depth > (ctx.maxDepth || 60)) return 0;
    if (ctx.nodes > ctx.nodeLimit) { ctx.truncated = true; return 0; }
    ctx.nodes++;
    var tag = tagOf(el);
    if (SKIP_TAGS[tag]) return 0;
    if (hasAttr(el, 'data-ahttp-ignore')) { ctx.ignored++; return 0; }
    var reason = hiddenReason(el, ctx);
    if (reason) {
      if (!recoverableControl(el, ctx, reason)) {
        if (reason.suspicious) {
          var hiddenTexts = countTextNodes(el, 50);
          if (hiddenTexts > 0) ctx.sanitized += hiddenTexts;
        }
        return 0;
      }
    }
    var ownConfirm = confirmWarn;
    if (hasAttr(el, 'data-ahttp-confirm')) {
      ownConfirm = normText(attr(el, 'data-ahttp-confirm')) || 'This action requires explicit confirmation';
    }
    var ownReadonly = readonlyGuard || hasAttr(el, 'data-ahttp-readonly');
    var ownForm = tag === 'form' ? el : form;
    region = regionOf(el, region);
    var st = styleOf(el, ctx);
    var info = classify(el, st, ctx);
    if (info && info.pointerOnly && ctx.layout && coveredByNativeControl(el, ctx)) info = null;
    var childTextOff = textOff;
    if (!info && !textOff) {
      var blockLike = TEXT_BLOCKS[tag] || !el.firstElementChild;
      if (blockLike && !(TEXT_BLOCKS[tag] && hasBlockDescendant(el, 0))) {
        var blockText = el.firstElementChild ? joinedText(el) : normText(el.textContent);
        if (blockText) {
          addText(ctx, blockText, el, region);
          childTextOff = true;
        }
      }
    }
    if (info) {
      if (info.native) {
        register(el, info, region, ctx, ownForm, ownConfirm, ownReadonly);
        walkOwned(el, region, depth, ctx, childTextOff, ownForm, ownConfirm, ownReadonly);
        return 1;
      }
      var below = walkChildren(el, region, depth, ctx, childTextOff, ownForm, ownConfirm, ownReadonly);
      below += walkOwned(el, region, depth, ctx, childTextOff, ownForm, ownConfirm, ownReadonly);
      if (below > 0) return below;
      register(el, info, region, ctx, ownForm, ownConfirm, ownReadonly);
      return 1;
    }
    if (tag === 'form') {
      if (ctx.forms.indexOf(el) < 0) ctx.forms.push(el);
    }
    walkChildren(el, region, depth, ctx, childTextOff, ownForm, ownConfirm, ownReadonly);
    walkOwned(el, region, depth, ctx, childTextOff, ownForm, ownConfirm, ownReadonly);
    return 0;
  }

  function emptyScan(doc) {
    return { actions: [], text: [], modal: null, at: now(), ms: 0, doc: doc, meta: { nodes: 0, sanitized: 0, ignored: 0, forms: 0, truncated: false } };
  }

  function scanDOM(limits) {
    var wanted = limits || {};
    var nodeLimit = wanted.nodeLimit ? Math.max(100, Math.min(500000, parseInt(wanted.nodeLimit, 10) || 0)) : 25000;
    var maxDepth = wanted.maxDepth ? Math.max(5, Math.min(500, parseInt(wanted.maxDepth, 10) || 0)) : 60;
    S.scanLimits = { nodeLimit: nodeLimit, maxDepth: maxDepth };
    var env = ENV();
    var doc = env.document;
    if (!doc || !doc.documentElement) return emptyScan(doc);
    var t0 = now();
    S.labelMaps = null;
    S.layout = detectLayout(doc);
    S.canObserve = typeof env.MutationObserver === 'function';
    var ctx = {
      doc: doc,
      win: env,
      layout: S.layout,
      css: S.layout ? { buckets: new Map(), rules: 0 } : buildCssIndex(doc),
      styleCache: new Map(),
      actions: [],
      text: [],
      forms: [],
      nodeLimit: nodeLimit,
      maxDepth: maxDepth,
      nodes: 0,
      sanitized: 0,
      ignored: 0,
      textChars: 0,
      lastText: '',
      shadow: 0,
      iframeDepth: 0,
      truncated: false,
      cssCache: new Map(),
      cssSeen: new Set(),
      indexMap: new Map(),
      visited: new Set()
    };
    var modal = S.modalCache && S.modalCache.doc === doc && !S.dirty
      ? S.modalCache.value
      : findModal(doc, ctx);
    S.modalCache = { doc: doc, value: modal };
    var root = modal || doc.body || doc.documentElement;
    if (root) walk(root, modal ? 'modal' : 'main', 0, ctx, false, null, null, false);
    var ms = now() - t0;
    var formControls = 0;
    for (var ai = 0; ai < ctx.actions.length; ai++) {
      if (FORM_KINDS[ctx.actions[ai].kind]) formControls++;
    }
    var scan = {
      actions: ctx.actions,
      text: ctx.text,
      modal: modal,
      at: now(),
      ms: ms,
      doc: doc,
      meta: {
        nodes: ctx.nodes,
        sanitized: ctx.sanitized,
        ignored: ctx.ignored,
        forms: ctx.forms.length,
        controls: formControls,
        shadowRoots: ctx.shadow,
        truncated: ctx.truncated,
        layout: S.layout ? 'layout' : 'css',
        cssRules: ctx.css.rules,
        backgroundCollapsed: !!modal
      }
    };
    S.scan = scan;
    S.scanAt = now();
    S.lastScanMs = ms;
    S.nodeCount = ctx.nodes;
    S.sanitized = ctx.sanitized;
    S.dirty = false;
    pruneRegistry();
    return scan;
  }

  function pruneRegistry() {
    if (S.registry.size <= 4000) return;
    var drop = S.registry.size - 3000;
    var it = S.registry.values();
    var ids = [];
    var guard = 0;
    while (guard++ < 10000) {
      var cur = it.next();
      if (cur.done) break;
      if (!connected(cur.value.node)) ids.push(cur.value.id);
      if (ids.length >= drop) break;
    }
    for (var i = 0; i < ids.length; i++) S.registry.delete(ids[i]);
  }

  function ensureScan(force, limits) {
    wake();
    var wanted = limits || S.scanLimits || null;
    if (wanted && S.scanLimits && (wanted.nodeLimit !== S.scanLimits.nodeLimit || wanted.maxDepth !== S.scanLimits.maxDepth)) {
      S.scan = null;
      S.dirty = true;
    }
    var maxAge = S.canObserve ? 250 : 0;
    if (!force && S.scan && !S.dirty && now() - S.scanAt < maxAge) return S.scan;
    return scanDOM(wanted);
  }

  function currentUrl() {
    var doc = S.doc || (ENV() && ENV().document);
    if (!doc) return '';
    try {
      if (doc.location && doc.location.href) return doc.location.href;
      if (doc.defaultView && doc.defaultView.location && doc.defaultView.location.href) return doc.defaultView.location.href;
      return doc.URL || '';
    } catch (e) {
      return doc.URL || '';
    }
  }

  function docTitle() {
    var doc = S.doc;
    if (!doc) return '';
    return normText(doc.title || '');
  }

  function resolveScope(scan, scope) {
    if (!scope || scope === 'all') return null;
    if (typeof scope === 'string' && REGION_NAMES[scope]) return { region: scope };
    if (typeof scope === 'string') {
      var el = null;
      try { el = (S.doc || (ENV() && ENV().document)).querySelector(scope); } catch (e) { el = null; }
      return el ? { el: el } : { missing: true };
    }
    if (scope && scope.nodeType === 1) return { el: scope };
    return null;
  }

  function inScope(entry, sel) {
    if (!sel) return true;
    if (sel.region) return entry.region === sel.region;
    if (sel.el) return entry.node === sel.el || (sel.el.contains && sel.el.contains(entry.node));
    return true;
  }

  function matchQuery(entry, q) {
    if (!q) return true;
    var hay = [entry.label, entry.name, entry.placeholder, entry.href, entry.role, entry.id, entry.value].join(' ').toLowerCase();
    q = String(q).toLowerCase().trim();
    if (!q) return true;
    if (hay.indexOf(q) >= 0) return true;
    var tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return false;
    for (var i = 0; i < tokens.length; i++) {
      if (hay.indexOf(tokens[i]) < 0) return false;
    }
    return true;
  }

  function priorityOf(entry) {
    if (entry.region === 'modal') return 0;
    if (FORM_KINDS[entry.kind]) return 1;
    if (entry.confirm) return 2;
    if (entry.tag === 'button' || entry.role === 'button') return 3;
    if (entry.role === 'link') return 5;
    return 4;
  }

  function capActions(list, max, modalActive) {
    if (!max || list.length <= max) return { kept: list, omitted: 0 };
    var byRegion = { modal: [], main: [], chrome: [] };
    for (var i = 0; i < list.length; i++) {
      var region = list[i].region || 'main';
      if (!byRegion[region]) byRegion[region] = [];
      byRegion[region].push(list[i]);
    }
    function byPriority(a, b) {
      var pa = priorityOf(a), pb = priorityOf(b);
      if (pa !== pb) return pa - pb;
      return a.order - b.order;
    }
    var quotas = modalActive
      ? { modal: max, main: 0, chrome: 0 }
      : { main: Math.ceil(max * 0.6), chrome: max - Math.ceil(max * 0.6), modal: 0 };
    var regionOrder = modalActive ? ['modal', 'main', 'chrome'] : ['main', 'chrome', 'modal'];
    var kept = [];
    var used = {};
    for (var r = 0; r < regionOrder.length; r++) {
      var name = regionOrder[r];
      var arr = byRegion[name];
      if (!arr || !arr.length) continue;
      var quota = quotas[name] || 0;
      if (!quota) continue;
      var links = [];
      var others = [];
      for (var a = 0; a < arr.length; a++) {
        if (arr[a].role === 'link') links.push(arr[a]);
        else others.push(arr[a]);
      }
      var linkReserve = links.length ? Math.min(Math.max(2, Math.floor(quota * 0.2)), links.length) : 0;
      var picked = others.slice().sort(byPriority).slice(0, quota - linkReserve);
      if (linkReserve) picked = picked.concat(links.slice().sort(byPriority).slice(0, linkReserve));
      used[name] = picked.length;
      kept = kept.concat(picked);
    }
    var remaining = max - kept.length;
    if (remaining > 0) {
      var leftovers = [];
      for (var name2 in byRegion) {
        if (!Object.prototype.hasOwnProperty.call(byRegion, name2)) continue;
        leftovers = leftovers.concat(byRegion[name2].slice(used[name2] || 0));
      }
      leftovers.sort(byPriority);
      kept = kept.concat(leftovers.slice(0, remaining));
    }
    return { kept: kept, omitted: list.length - kept.length };
  }

  function groupInfo(list, allowGroups) {
    var groups = new Map();
    if (!allowGroups) return groups;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.role !== 'link' || e.confirm) continue;
      var key = e.region + '|' + e.family;
      var arr = groups.get(key);
      if (!arr) { arr = []; groups.set(key, arr); }
      arr.push(e);
    }
    groups.forEach(function (arr, key) {
      if (arr.length < 4) groups.delete(key);
    });
    return groups;
  }

  function fmtAction(entry, compact) {
    var s = entry.id + ' ';
    var desc = entry.tag;
    if (entry.tag === 'input' && entry.type && entry.type !== 'text') desc += '[' + entry.type + ']';
    if (!entry.native && entry.role && entry.role !== desc) desc += ' role=' + entry.role;
    s += desc + ' ' + quote(entry.label || entry.name || entry.tag);
    if (entry.href) s += ' -> ' + trim(entry.href, 70);
    if (!compact) {
      if (entry.placeholder) s += ' ph=' + quote(trim(entry.placeholder, 40));
      if (entry.value !== '' && entry.value != null && entry.kind !== 'toggle' && entry.kind !== 'click') {
        s += ' val=' + quote(trim(String(entry.value), 60));
      }
      if (entry.kind === 'toggle') s += entry.checked ? ' checked' : ' unchecked';
      if (entry.kind === 'select' && entry.optionCount) {
        s += ' opts=' + entry.optionCount;
        if (entry.options && entry.options.length && entry.options.length <= 6) {
          s += '(' + entry.options.map(function (o) { return trim(o, 24); }).join('|') + ')';
        }
      }
      if (entry.editable) s += ' editable';
      if (entry.required) s += ' required';
      if (entry.disabled) s += ' disabled';
      if (entry.readonly) s += ' readonly';
      var confirmWarning = entry.confirm || policyConfirmWarning(entry);
      if (confirmWarning) s += ' confirm=' + quote(trim(confirmWarning, 60));
    }
    return s;
  }

  function buildSnapshot(opts) {
    opts = opts || {};
    ensureConfig();
    ensureAuthFresh();
    if (S.locked) return lockedSnapshot(opts);
    var limits = {
      nodeLimit: opts.maxNodes != null ? opts.maxNodes : (S.config && S.config.maxNodes ? S.config.maxNodes : 25000),
      maxDepth: opts.maxDepth != null ? opts.maxDepth : (S.config && S.config.maxDepth ? S.config.maxDepth : 60)
    };
    var scan = ensureScan(!!opts.force, limits);
    var configCap = S.config && S.config.maxActions ? S.config.maxActions : 0;
    var requested = opts.maxActions == null ? 0 : Math.max(0, parseInt(opts.maxActions, 10) || 0);
    var maxActions = requested > 0
      ? (configCap ? Math.min(requested, configCap) : requested)
      : (configCap || 60);
    var maxText = opts.includeText === false ? 0 : (opts.maxText == null ? 1400 : Math.max(0, parseInt(opts.maxText, 10) || 0));
    var sel = resolveScope(scan, opts.scope);
    if (sel && sel.missing) {
      var miss = emptyScan(scan.doc);
      miss.meta.missingScope = String(opts.scope);
      scan = miss;
    }
    var source = scan.actions;
    var filtered = [];
    var policyHidden = 0;
    if (!sel || !sel.missing) {
      for (var i = 0; i < source.length; i++) {
        var e = source[i];
        if (!inScope(e, sel)) continue;
        if (!policyAllows(e)) { policyHidden++; continue; }
        if (opts.interactiveOnly && !FORM_KINDS[e.kind] && e.kind !== 'click') continue;
        if (!matchQuery(e, opts.query)) continue;
        filtered.push(e);
      }
    }
    S.policyHidden = policyHidden;
    var cap = capActions(filtered, maxActions, !!scan.modal);
    var kept = cap.kept;
    var groups = groupInfo(kept, !opts.query && opts.group !== false);
    var textRaw = scan.text || [];
    var textPool = [];
    if (sel) {
      for (var t0 = 0; t0 < textRaw.length; t0++) {
        var ln = textRaw[t0];
        if (sel.region && ln.region !== sel.region) continue;
        if (sel.el) {
          var n0 = ln.node;
          if (!(n0 === sel.el || (sel.el.contains && sel.el.contains(n0)))) continue;
        }
        textPool.push(ln);
      }
    } else {
      var regionPriority = ['modal', 'main', 'chrome'];
      for (var rp = 0; rp < regionPriority.length; rp++) {
        for (var t1 = 0; t1 < textRaw.length; t1++) {
          if (textRaw[t1].region === regionPriority[rp]) textPool.push(textRaw[t1]);
        }
      }
    }
    var textOut = [];
    var textChars = 0;
    var titleText = trim(docTitle(), 200);
    for (var t = 0; t < textPool.length; t++) {
      var line = textPool[t];
      if (titleText && line.text === titleText) continue;
      if (opts.query && !matchQueryText(line.text, opts.query)) continue;
      if (textChars + line.text.length > maxText) break;
      textChars += line.text.length;
      textOut.push(line.text);
    }
    var regions = { modal: 0, main: 0, chrome: 0 };
    for (var r = 0; r < kept.length; r++) regions[kept[r].region] = (regions[kept[r].region] || 0) + 1;
    var body = renderBody(kept, groups, textOut, regions, opts);
    var meta = {
      version: VERSION,
      actions: filtered.length,
      shown: kept.length,
      omitted: cap.omitted,
      groups: groups.size,
      textLines: textOut.length,
      forms: scan.meta.forms,
      controls: scan.meta.controls,
      nodes: scan.meta.nodes,
      sanitized: scan.meta.sanitized,
      ignored: scan.meta.ignored,
      shadowRoots: scan.meta.shadowRoots,
      truncated: scan.meta.truncated || cap.omitted > 0,
      layout: scan.meta.layout,
      ms: scan.ms,
      scanMs: scan.ms,
      query: opts.query || null,
      scope: typeof opts.scope === 'string' ? opts.scope : (opts.scope ? 'element' : null),
      textTrust: 'untrusted',
      includeText: opts.includeText !== false
    };
    if (S.config) {
      meta.owner = S.config.owner || null;
      meta.policyHidden = policyHidden;
      if (S.config.readOnly) meta.policyReadOnly = true;
    }
    if (opts.format === 'json') {
      var actions = [];
      for (var j = 0; j < kept.length; j++) {
        var a = kept[j];
        var o = {
          id: a.id, tag: a.tag, role: a.role, kind: a.kind, label: a.label,
          region: a.region
        };
        if (a.type) o.type = a.type;
        if (a.name) o.name = a.name;
        if (a.href) o.href = a.href;
        if (a.placeholder) o.placeholder = a.placeholder;
        if (a.value !== '' && a.value != null) o.value = a.value;
        if (a.kind === 'toggle') o.checked = !!a.checked;
        if (a.optionCount) { o.options = a.options; o.optionCount = a.optionCount; }
        if (a.required) o.required = true;
        if (a.disabled) o.disabled = true;
        if (a.readonly) o.readonly = true;
        if (a.editable) o.editable = true;
        if (a.intent) o.intent = a.intent;
        var confirmWarning = a.confirm || policyConfirmWarning(a);
        if (confirmWarning) {
          o.requiresConfirmation = true;
          o.warning = confirmWarning;
        }
        actions.push(o);
      }
      var json = {
        version: VERSION,
        url: currentUrl(),
        title: docTitle(),
        locked: false,
        owner: S.config ? S.config.owner || null : null,
        modal: !!scan.modal,
        layout: meta.layout,
        regions: regions,
        actions: actions,
        text: textOut,
        textTrust: 'untrusted',
        meta: meta
      };
      json.meta.chars = JSON.stringify(json).length;
      json.meta.tokens = Math.ceil(json.meta.chars / 4);
      return json;
    }
    var url = currentUrl();
    var head = 'ahttp | ' + trim(docTitle() || '(untitled)', 80) + ' | ' + shortUrl(url);
    var text = head + '\n' + body;
    var metaLine = textMetaLine(meta, opts || {}, text, url);
    return metaLine ? text + '\n' + metaLine : text;
  }

  function shortUrl(value) {
    var s = String(value == null ? '' : value);
    if (s.length <= 72) return s;
    var hash = '';
    var h = s.indexOf('#');
    if (h >= 0) { hash = s.slice(h); s = s.slice(0, h); }
    var q = s.indexOf('?');
    var query = q >= 0 ? s.slice(q) : '';
    var path = q >= 0 ? s.slice(0, q) : s;
    var schemeAt = path.indexOf('://');
    var scheme = schemeAt >= 0 ? path.slice(0, schemeAt).toLowerCase() : '';
    var rest = schemeAt >= 0 ? path.slice(schemeAt + 3) : path;
    var segs = rest.split('/').filter(Boolean);
    var out;
    if (scheme === 'http' || scheme === 'https') {
      var host = segs.shift() || '';
      out = scheme + '://' + host + '/…/' + segs.slice(-2).join('/');
    } else if (scheme === 'file') {
      out = 'file:…/' + segs.slice(-2).join('/');
    } else {
      out = s.slice(0, 70) + '…';
    }
    if (query) out += query.length > 32 ? query.slice(0, 31) + '…' : query;
    return out + hash;
  }

  function textMetaLine(meta, opts, text, url) {
    var bits = [];
    if (meta.shown !== meta.actions) bits.push(meta.shown + '/' + meta.actions + ' actions');
    if (meta.sanitized) bits.push(meta.sanitized + ' sanitized');
    if (meta.ignored) bits.push(meta.ignored + ' ignored');
    if (meta.policyHidden) bits.push(meta.policyHidden + ' policy-hidden');
    if (meta.owner) bits.push('owner ' + meta.owner);
    if (meta.policyReadOnly) bits.push('read-only');
    if (opts.verbose) {
      bits.push(meta.forms + ' forms', meta.controls + ' controls', meta.nodes + ' nodes');
      bits.push('layout ' + (meta.layout ? 'on' : 'off'));
      bits.push('text ' + (meta.includeText ? 'untrusted' : 'omitted'));
      bits.push(meta.scanMs + ' ms');
      bits.push(Math.ceil(text.length / 4) + ' est. tokens');
      bits.push('v' + meta.version);
      if (url && shortUrl(url) !== url) bits.push('url ' + url);
    }
    return bits.length ? '[meta] ' + bits.join(' · ') : '';
  }

  function matchQueryText(text, q) {
    if (!q) return true;
    q = String(q).toLowerCase();
    if (text.toLowerCase().indexOf(q) >= 0) return true;
    var tokens = q.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return false;
    var low = text.toLowerCase();
    for (var i = 0; i < tokens.length; i++) if (low.indexOf(tokens[i]) < 0) return false;
    return true;
  }

  function renderBody(kept, groups, textOut, regions, opts) {
    var out = [];
    var groupShown = new Map();
    var groupSkipped = new Map();
    var regionOrder = ['modal', 'main', 'chrome'];
    var titles = { modal: '[modal]', main: '[main]', chrome: '[nav]' };
    var present = [];
    for (var p = 0; p < regionOrder.length; p++) {
      if (kept.some(function (entry) { return entry.region === regionOrder[p]; })) present.push(regionOrder[p]);
    }
    var showHeaders = present.length > 1 || (present.length === 1 && present[0] !== 'main');
    for (var ri = 0; ri < regionOrder.length; ri++) {
      var region = regionOrder[ri];
      var rows = [];
      for (var i = 0; i < kept.length; i++) if (kept[i].region === region) rows.push(kept[i]);
      if (!rows.length) continue;
      rows.sort(function (a, b) { return a.order - b.order; });
      if (showHeaders) out.push(titles[region]);
      for (var j = 0; j < rows.length; j++) {
        var e = rows[j];
        var groupKey = e.region + '|' + e.family;
        var group = groups.get(groupKey);
        if (group && group.length >= 4) {
          var count = groupShown.get(groupKey) || 0;
          if (count >= 2) {
            groupSkipped.set(groupKey, (groupSkipped.get(groupKey) || 0) + 1);
            continue;
          }
          groupShown.set(groupKey, count + 1);
        }
        out.push(fmtAction(e, !!opts.compact));
      }
      var summaries = [];
      groups.forEach(function (arr, key) {
        if (arr[0].region !== region) return;
        var skipped = groupSkipped.get(key) || 0;
        if (skipped > 0) {
          summaries.push('... +' + skipped + ' similar ' + arr[0].role + ' "' + trim(arr[0].label, 40) + '" (group ' + hashFamily(arr[0].family) + ', use query/scope)');
        }
      });
      for (var s = 0; s < summaries.length; s++) out.push(summaries[s]);
    }
    if (!kept.length) out.push('(no actions)');
    if (textOut.length) {
      out.push('[text: untrusted]');
      for (var k = 0; k < textOut.length; k++) out.push(trim(textOut[k], 200));
    }
    return out.join('\n');
  }

  function hashFamily(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36).slice(0, 5);
  }

  function ciEqual(a, b) {
    return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
  }

  // Role/tag/path/order can only support a match. At least one content anchor
  // must agree, otherwise a virtualized list would turn every recycled row into
  // a fake "ambiguous" candidate.
  var CONTENT_SIGNALS = {
    intent: 1, testid: 1, id: 1, name: 1, href: 1,
    placeholder: 1, 'placeholder~': 1,
    title: 1, 'title~': 1, alt: 1, 'alt~': 1,
    'name~': 1, 'name^': 1, text: 1, 'text~': 1, 'text^': 1
  };

  function hasContentSignal(signals) {
    for (var i = 0; i < signals.length; i++) {
      if (CONTENT_SIGNALS[signals[i]]) return true;
    }
    return false;
  }

  function prefixEither(a, b) {
    if (!a || !b) return false;
    a = String(a);
    b = String(b);
    return a.indexOf(b) === 0 || b.indexOf(a) === 0;
  }

  // The accessible label is often derived from a stronger anchor (title,
  // placeholder, name, id). Do not score the same string twice.
  function labelIsDerived(fp) {
    if (!fp.label) return true;
    return fp.label === fp.intent || fp.label === fp.domId || fp.label === fp.name ||
      fp.label === fp.testid || fp.label === fp.test || fp.label === fp.qa ||
      fp.label === fp.placeholder || fp.label === fp.title || fp.label === fp.alt ||
      fp.label === fp.href;
  }

  function scoreMatch(fp, cand) {
    var weights = MATCH.weights;
    var score = 0;
    var content = 0;
    var signals = [];
    function hit(name, points) {
      if (points > 0) {
        score += points;
        if (CONTENT_SIGNALS[name]) content += points;
        signals.push(name);
      }
    }
    if (!fp || !cand) return { score: -1, content: 0, signals: [] };
    // A different action kind is not the same control. Disabled candidates are
    // scored so they can make a near-tie ambiguous, but relocate() never
    // chooses one as the winner.
    if (fp.kind && cand.kind !== fp.kind) return { score: -1, content: 0, signals: [] };

    if (fp.intent && cand.intent === fp.intent) hit('intent', weights.intent);
    if ((fp.testid && cand.testid === fp.testid) ||
        (fp.test && cand.test === fp.test) ||
        (fp.qa && cand.qa === fp.qa)) hit('testid', weights.testid);
    if (fp.id && cand.domId === fp.id) hit('id', weights.domId);
    if (fp.name && cand.name === fp.name) hit('name', weights.name);
    if (fp.href && cand.href === fp.href) hit('href', weights.href);

    if (fp.placeholder && cand.placeholder) {
      if (fp.placeholder === cand.placeholder) hit('placeholder', weights.placeholder);
      else if (ciEqual(fp.placeholder, cand.placeholder)) hit('placeholder~', weights.placeholder - 8);
    }
    if (fp.title && cand.title) {
      if (fp.title === cand.title) hit('title', weights.title);
      else if (ciEqual(fp.title, cand.title)) hit('title~', weights.title - 7);
    }
    if (fp.alt && cand.alt) {
      if (fp.alt === cand.alt) hit('alt', weights.alt);
      else if (ciEqual(fp.alt, cand.alt)) hit('alt~', weights.alt - 7);
    }

    if (!labelIsDerived(fp) && fp.label && cand.label) {
      if (fp.label === cand.label) hit('name', weights.accessibleName);
      else if (ciEqual(fp.label, cand.label)) hit('name~', weights.accessibleName - 5);
      else if (prefixEither(fp.label, cand.label)) hit('name^', 22);
    }
    if (fp.visibleText && fp.visibleText !== fp.label && cand.visibleText) {
      if (fp.visibleText === cand.visibleText) hit('text', weights.visibleText);
      else if (ciEqual(fp.visibleText, cand.visibleText)) hit('text~', weights.visibleText - 5);
      else if (prefixEither(fp.visibleText, cand.visibleText)) hit('text^', 18);
    }

    if (fp.role && cand.role === fp.role) hit('role', weights.role);
    if (fp.tag && cand.tag === fp.tag) hit('tag', weights.tag);
    if (fp.type && cand.type === fp.type) hit('type', weights.type);

    if (fp.path && cand.path) {
      var sim = pathSim(fp.path, cand.path);
      if (sim > 0.5) hit('path', Math.round(weights.path * sim));
    }
    if (fp.order != null && cand.order != null) {
      var dist = Math.abs(fp.order - cand.order);
      if (dist === 0) hit('order', weights.order);
      else if (dist === 1) hit('order', weights.order - 1);
      else if (dist <= 3) hit('order', 1);
    }
    // The old fingerprint is kept as a low-weight structural signal only.
    if (fp.tag === cand.tag && fp.role === cand.role && (fp.type || '') === (cand.type || '')) {
      hit('fingerprint', weights.structural);
    }
    return { score: score, content: content, signals: signals };
  }

  function adoptEntry(entry, cand) {
    var keepId = entry.id;
    for (var key in cand) {
      if (!Object.prototype.hasOwnProperty.call(cand, key)) continue;
      if (key === 'id' || key === 'node') continue;
      entry[key] = cand[key];
    }
    entry.id = keepId;
    entry.staleResolved = true;
  }

  function bindEntry(entry, node) {
    if (!node || !node.nodeType) return false;
    var previous = S.byNode.get(node);
    if (previous && previous !== entry) {
      if (previous.id !== entry.id) S.registry.delete(previous.id);
    }
    if (entry.node && entry.node !== node) S.byNode.delete(entry.node);
    entry.node = node;
    S.byNode.set(node, entry);
    entry.staleResolved = true;
    return true;
  }

  function publicCandidate(item) {
    return {
      id: item.entry.id,
      role: item.entry.role,
      name: item.entry.label,
      tag: item.entry.tag,
      score: item.score,
      signals: item.signals,
      disabled: !!item.entry.disabled
    };
  }

  function inCurrentScan(entry) {
    return !S.scan || !S.scan.actions || S.scan.actions.indexOf(entry) >= 0;
  }

  function relocate(entry) {
    ensureScan(true);
    var fp = entry.fingerprint || {};
    var scored = [];
    S.registry.forEach(function (cand) {
      if (!cand || cand === entry || !cand.node) return;
      if (!connected(cand.node)) return;
      if (!inCurrentScan(cand)) return;
      var match = scoreMatch(fp, cand);
      if (match.score <= 0) return;
      if (!hasContentSignal(match.signals)) return;
      scored.push({
        entry: cand,
        score: match.score,
        content: match.content,
        signals: match.signals,
        disabled: !!cand.disabled
      });
    });
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (a.entry.order || 0) - (b.entry.order || 0);
    });
    // A disabled candidate participates in the score so a disabled twin makes
    // the choice ambiguous, but it is never the winner. With no active
    // candidate there is nothing safe to dispatch into.
    var best = null;
    var i;
    for (i = 0; i < scored.length; i++) {
      if (!scored[i].disabled) { best = scored[i]; break; }
    }
    var strongest = scored[0] || null;
    if (!best || best.score < MATCH.ambiguous) {
      return {
        status: 'not_found',
        candidates: [],
        bestScore: best ? best.score : 0,
        secondScore: strongest && strongest !== best ? strongest.score : 0
      };
    }
    // The winner must clearly lead every other candidate, active or disabled,
    // on both total score and content evidence. Position can only break a tie.
    var ahead = true;
    for (i = 0; i < scored.length; i++) {
      if (scored[i] === best) continue;
      if ((best.score - scored[i].score) < MATCH.margin) ahead = false;
      if ((best.content - scored[i].content) < MATCH.contentMargin) ahead = false;
    }
    if (best.score >= MATCH.accept && ahead) {
      var cand = best.entry;
      var node = cand.node;
      S.registry.delete(cand.id);
      adoptEntry(entry, cand);
      bindEntry(entry, node);
      return { status: 'ok', score: best.score, signals: best.signals };
    }
    return {
      status: 'ambiguous',
      candidates: scored.slice(0, MATCH.maxCandidates).map(publicCandidate),
      bestScore: best.score,
      secondScore: strongest && strongest !== best ? strongest.score : 0
    };
  }

  function lookupCandidate(entry, score, signal) {
    return {
      id: entry.id,
      role: entry.role,
      name: entry.label,
      tag: entry.tag,
      score: score,
      signals: [signal]
    };
  }

  function labelLookup(key) {
    var lower = key.toLowerCase();
    var intents = [];
    var exact = [];
    var loose = [];
    S.registry.forEach(function (cand) {
      if (cand.intent && String(cand.intent).toLowerCase() === lower) intents.push(cand);
      if (cand.label) {
        if (cand.label === key) exact.push(cand);
        if (String(cand.label).toLowerCase() === lower) loose.push(cand);
      }
    });
    if (intents.length) return { matches: intents, score: MATCH.weights.intent, signal: 'intent' };
    if (exact.length) return { matches: exact, score: MATCH.weights.accessibleName, signal: 'name' };
    if (loose.length) return { matches: loose, score: MATCH.weights.accessibleName - 5, signal: 'name~' };
    return null;
  }

  function resolveEntry(id) {
    if (!id) return { status: 'not_found', reason: 'unknown_action' };
    var key = String(id).replace(/^\[|\]$/g, '');
    var entry = S.registry.get(key);
    if (!entry) {
      var lookup = labelLookup(key);
      if (lookup && lookup.matches.length > 1) {
        return {
          status: 'ambiguous',
          id: String(id),
          candidates: lookup.matches.slice(0, MATCH.maxCandidates).map(function (cand) {
            return lookupCandidate(cand, lookup.score, lookup.signal);
          })
        };
      }
      if (lookup) entry = lookup.matches[0];
    }
    if (!entry) return { status: 'not_found', reason: 'unknown_action' };
    if (entry.node && connected(entry.node) && inCurrentScan(entry)) {
      return { status: 'ok', entry: entry };
    }
    var match = relocate(entry);
    match.entry = entry;
    return match;
  }

  function normalizePayload(payload) {
    if (payload == null) return {};
    if (typeof payload === 'string' || typeof payload === 'number') return { value: String(payload) };
    if (typeof payload === 'boolean') return { checked: payload };
    if (typeof payload === 'object') return payload;
    return {};
  }

  function fire(el, type, init, doc) {
    var win = (doc && doc.defaultView) || S.win || GLOBAL;
    var ev = null;
    var base = { bubbles: true, cancelable: true, composed: true };
    var data = {};
    if (init) for (var k in init) if (Object.prototype.hasOwnProperty.call(init, k)) data[k] = init[k];
    for (var b in base) data[b] = base[b];
    var Ctor = win.Event;
    if (/^key/.test(type) && win.KeyboardEvent) Ctor = win.KeyboardEvent;
    else if (type === 'input' && win.InputEvent) Ctor = win.InputEvent;
    else if (/^mouse|^click|^pointer/.test(type) && win.MouseEvent) Ctor = win.MouseEvent;
    try { ev = new Ctor(type, data); } catch (e) { ev = null; }
    if (!ev) {
      try {
        ev = doc.createEvent('Event');
        ev.initEvent(type, true, true);
      } catch (e2) { return false; }
      for (var p in data) { try { ev[p] = data[p]; } catch (e3) {} }
    }
    try { return el.dispatchEvent(ev); } catch (e4) { return false; }
  }

  function setNativeValue(el, value) {
    var tag = tagOf(el);
    var proto = null;
    try {
      if (tag === 'textarea' && el.ownerDocument.defaultView.HTMLTextAreaElement) proto = el.ownerDocument.defaultView.HTMLTextAreaElement.prototype;
      else if (tag === 'select' && el.ownerDocument.defaultView.HTMLSelectElement) proto = el.ownerDocument.defaultView.HTMLSelectElement.prototype;
      else if (el.ownerDocument.defaultView.HTMLInputElement) proto = el.ownerDocument.defaultView.HTMLInputElement.prototype;
    } catch (e) { proto = null; }
    var desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
    var before = el.value;
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    var tracker = el._valueTracker;
    if (tracker && typeof tracker.setValue === 'function') tracker.setValue(before);
  }

  function clickSequence(el, opts) {
    var doc = el.ownerDocument;
    var rect = null;
    try { rect = el.getBoundingClientRect(); } catch (e) { rect = null; }
    var cx = rect && rect.width ? rect.left + rect.width / 2 : 0;
    var cy = rect && rect.height ? rect.top + rect.height / 2 : 0;
    var init = { clientX: cx, clientY: cy, button: 0, buttons: 1, view: doc.defaultView };
    fire(el, 'pointerover', init, doc);
    fire(el, 'mouseover', init, doc);
    fire(el, 'pointerenter', init, doc);
    fire(el, 'mouseenter', init, doc);
    fire(el, 'pointerdown', init, doc);
    fire(el, 'mousedown', init, doc);
    try { if (el.focus) el.focus(); } catch (e) {}
    fire(el, 'pointerup', init, doc);
    fire(el, 'mouseup', init, doc);
    fire(el, 'click', init, doc);
    return true;
  }

  function keySequence(el, key, opts) {
    var doc = el.ownerDocument;
    var codes = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Backspace: 8, Delete: 46, ' ': 32 };
    var init = {
      key: key, code: key, keyCode: codes[key] || 0, which: codes[key] || 0,
      charCode: key.length === 1 ? key.charCodeAt(0) : 0,
      bubbles: true, cancelable: true, composed: true
    };
    fire(el, 'keydown', init, doc);
    fire(el, 'keypress', init, doc);
    fire(el, 'keyup', init, doc);
    return true;
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function patchNetwork() {
    if (S.net.patched) return;
    var win = S.win || ENV();
    if (!win) return;
    var saved = { fetch: null, fetchWrapper: null, xhr: null, open: null, send: null };
    if (typeof win.fetch === 'function' && !win.fetch.__ahttp) {
      saved.fetch = win.fetch;
      var wrapper = function (input, init) {
        var rec = { id: ++S.net.count, method: 'GET', url: '', status: null, at: now() };
        try {
          rec.url = String(typeof input === 'string' ? input : (input && input.url) || '').slice(0, 160);
          rec.method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        } catch (e) {}
        S.net.log.push(rec);
        if (S.net.log.length > 60) S.net.log.shift();
        S.net.pending.add(rec.id);
        S.net.inflight++;
        var promise = saved.fetch.apply(this, arguments);
        var done = function (status) {
          rec.status = status;
          S.net.pending.delete(rec.id);
          S.net.inflight = Math.max(0, S.net.inflight - 1);
          S.dirty = true;
        };
        return promise.then(function (res) {
          done(res && res.status != null ? res.status : 0);
          return res;
        }, function (err) {
          done(-1);
          throw err;
        });
      };
      wrapper.__ahttp = true;
      saved.fetchWrapper = wrapper;
      try { win.fetch = wrapper; } catch (e) {}
    }
    var proto = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
    if (proto && !proto.__ahttpPatched) {
      saved.xhr = proto;
      saved.open = proto.open;
      saved.send = proto.send;
      var origOpen = proto.open;
      var origSend = proto.send;
      proto.open = function (method, url) {
        this.__ahttpMethod = String(method || 'GET').toUpperCase();
        this.__ahttpUrl = String(url || '').slice(0, 160);
        return origOpen.apply(this, arguments);
      };
      proto.send = function () {
        var xhr = this;
        if (xhr.__ahttpState !== 2) {
          xhr.__ahttpState = 1;
          var rec = { id: ++S.net.count, method: xhr.__ahttpMethod || 'GET', url: xhr.__ahttpUrl || '', status: null, at: now() };
          S.net.log.push(rec);
          if (S.net.log.length > 60) S.net.log.shift();
          S.net.pending.add(rec.id);
          S.net.inflight++;
          var done = function () {
            if (xhr.__ahttpState === 2) return;
            xhr.__ahttpState = 2;
            rec.status = xhr.status || 0;
            S.net.pending.delete(rec.id);
            S.net.inflight = Math.max(0, S.net.inflight - 1);
            S.dirty = true;
          };
          try {
            if (xhr.addEventListener) xhr.addEventListener('loadend', done);
            else {
              var prev = xhr.onreadystatechange;
              xhr.onreadystatechange = function () {
                if (xhr.readyState === 4) done();
                if (prev) prev.apply(xhr, arguments);
              };
            }
          } catch (e) {}
        }
        return origSend.apply(this, arguments);
      };
      proto.__ahttpPatched = true;
    }
    S.net.saved = saved;
    S.net.patched = true;
    S.net.networkPatched = !!(saved.fetchWrapper || saved.xhr);
  }

  function unpatchNetwork() {
    if (!S.net.patched) return;
    var saved = S.net.saved || {};
    if (saved.xhr) {
      try {
        saved.xhr.open = saved.open;
        saved.xhr.send = saved.send;
        delete saved.xhr.__ahttpPatched;
      } catch (e) {}
    }
    if (saved.fetchWrapper) {
      var win = S.win || ENV();
      try { if (win && win.fetch === saved.fetchWrapper) win.fetch = saved.fetch; } catch (e) {}
    }
    S.net.saved = null;
    S.net.patched = false;
    S.net.networkPatched = false;
  }

  function startMutationCounter() {
    var counter = { count: 0, observer: null };
    if (!S.win || !S.doc || typeof S.win.MutationObserver !== 'function') return counter;
    try {
      counter.observer = new S.win.MutationObserver(function (records) { counter.count += records.length; });
      counter.observer.observe(S.doc, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch (e) {
      counter.observer = null;
    }
    return counter;
  }

  // In an isolated world the engine cannot patch the page's own fetch/XHR.
  // The browser backend mirrors its request count into this DOM attribute so
  // settle still waits for page-initiated requests.
  function externalPending(doc) {
    if (!doc || !doc.documentElement || !doc.documentElement.getAttribute) return 0;
    var raw = doc.documentElement.getAttribute('data-ahttp-net');
    if (!raw) return 0;
    var n = parseInt(raw, 10);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function waitSettled(o, counter, requestsBefore, ignorePending) {
    if (o && o.settle === false) return Promise.resolve();
    var timeout = o && o.timeout != null ? o.timeout : 1200;
    var networkQuiet = o && o.networkQuiet != null ? o.networkQuiet : 220;
    var usedNetwork = S.net.count > (requestsBefore || 0);
    var quiet = o && o.quiet != null ? o.quiet : (usedNetwork ? networkQuiet : 40);
    var minWait = o && o.minWait != null ? o.minWait : 40;
    var t0 = now();
    var lastSignal = counter.count + S.net.count;
    var quietSince = null;
    return new Promise(function (resolve) {
      function tick() {
        var elapsed = now() - t0;
        var signal = counter.count + S.net.count;
        if (signal !== lastSignal) {
          lastSignal = signal;
          quietSince = null;
        } else if (quietSince === null) {
          quietSince = now();
        }
        var busy = 0;
        if (S.net.pending && typeof S.net.pending.forEach === 'function') {
          S.net.pending.forEach(function (id) {
            if (!ignorePending || !ignorePending.has(id)) busy++;
          });
        } else {
          busy = S.net.inflight;
        }
        busy += externalPending(S.doc);
        var settled = quietSince !== null && now() - quietSince >= quiet && elapsed >= minWait && busy === 0;
        if (settled || elapsed >= timeout) return resolve();
        setTimeout(tick, 16);
      }
      setTimeout(tick, 16);
    });
  }

  function actionKey(e, counts) {
    var base = (e.family || 'x') + '|' + e.kind + '|' + (e.label || '') + '|' + (e.name || '') + '|' + (e.type || '');
    var n = counts[base] || 0;
    counts[base] = n + 1;
    return base + '#' + n;
  }

  function captureState() {
    var scan = S.scan;
    var map = new Map();
    var counts = {};
    if (scan) {
      for (var i = 0; i < scan.actions.length; i++) {
        var e = scan.actions[i];
        var key = actionKey(e, counts);
        map.set(key, {
          id: e.id, label: e.label, role: e.role, tag: e.tag, kind: e.kind,
          value: e.value, checked: e.checked, disabled: e.disabled, readonly: e.readonly
        });
      }
    }
    var texts = [];
    if (scan) for (var t = 0; t < scan.text.length; t++) texts.push(scan.text[t].text);
    var modalLabel = null;
    if (scan && scan.modal) {
      modalLabel = normText(attr(scan.modal, 'aria-label')) || trim(normText(textOf(scan.modal)), 60) || 'dialog';
    }
    return { actions: map, texts: texts, url: currentUrl(), modal: modalLabel };
  }

  function diffStates(before, after) {
    var added = [];
    var removed = [];
    var changed = [];
    after.actions.forEach(function (v, k) {
      var b = before.actions.get(k);
      if (!b) {
        if (added.length < 15) added.push({ id: v.id, label: v.label, role: v.role, kind: v.kind });
        return;
      }
      var valueChanged = v.value !== b.value;
      var checkedChanged = v.checked !== b.checked;
      if ((valueChanged || checkedChanged || v.disabled !== b.disabled) && changed.length < 15) {
        var from = b.checked !== undefined && b.kind === 'toggle' ? b.checked : b.value;
        var to = v.checked !== undefined && v.kind === 'toggle' ? v.checked : v.value;
        changed.push({ id: v.id, label: v.label, kind: v.kind, from: from, to: to });
      }
    });
    before.actions.forEach(function (v, k) {
      if (!after.actions.has(k) && removed.length < 15) {
        removed.push({ id: v.id, label: v.label, role: v.role, kind: v.kind });
      }
    });
    var beforeText = new Set(before.texts);
    var afterText = new Set(after.texts);
    var textAdded = [];
    var textRemoved = [];
    for (var i = 0; i < after.texts.length; i++) {
      if (!beforeText.has(after.texts[i]) && textAdded.length < 12) textAdded.push(after.texts[i]);
    }
    for (var j = 0; j < before.texts.length; j++) {
      if (!afterText.has(before.texts[j]) && textRemoved.length < 8) textRemoved.push(before.texts[j]);
    }
    var modal = null;
    if (!before.modal && after.modal) modal = { opened: after.modal };
    else if (before.modal && !after.modal) modal = { closed: before.modal };
    else if (before.modal && after.modal && before.modal !== after.modal) modal = { opened: after.modal, closed: before.modal };
    var url = before.url !== after.url ? { from: before.url, to: after.url } : null;
    var lines = [];
    for (var a = 0; a < added.length; a++) lines.push('+ ' + added[a].id + ' ' + added[a].role + ' ' + quote(trim(added[a].label, 60)));
    for (var r = 0; r < removed.length; r++) lines.push('- ' + removed[r].id + ' ' + removed[r].role + ' ' + quote(trim(removed[r].label, 60)));
    for (var c = 0; c < changed.length; c++) {
      lines.push('~ ' + changed[c].id + ' ' + quote(trim(changed[c].label, 50)) + ' ' + JSON.stringify(changed[c].from) + ' -> ' + JSON.stringify(changed[c].to));
    }
    if (modal && modal.opened) lines.push('+ modal ' + quote(trim(modal.opened, 60)));
    if (modal && modal.closed) lines.push('- modal ' + quote(trim(modal.closed, 60)));
    for (var ta = 0; ta < textAdded.length; ta++) lines.push('+ text ' + quote(trim(textAdded[ta], 90)));
    for (var tr = 0; tr < textRemoved.length; tr++) lines.push('- text ' + quote(trim(textRemoved[tr], 90)));
    if (url) lines.push('url ' + url.from + ' -> ' + url.to);
    var parts = [];
    if (added.length) parts.push('+' + added.length + ' actions');
    if (removed.length) parts.push('-' + removed.length + ' actions');
    if (changed.length) parts.push(changed.length + ' changed');
    if (modal && modal.opened) parts.push('modal opened');
    if (modal && modal.closed) parts.push('modal closed');
    if (textAdded.length) parts.push('+' + textAdded.length + ' text');
    if (textRemoved.length) parts.push('-' + textRemoved.length + ' text');
    if (url) parts.push('url changed');
    return {
      added: added,
      removed: removed,
      changed: changed,
      textAdded: textAdded,
      textRemoved: textRemoved,
      modal: modal,
      url: url,
      empty: lines.length === 0,
      summary: parts.length ? parts.join(', ') : 'no visible changes',
      text: lines.length ? lines.join('\n') : 'no visible changes'
    };
  }

  function docText(selector) {
    var doc = S.doc || (ENV() && ENV().document);
    if (!doc || !doc.querySelector || !selector) return null;
    var node = null;
    try { node = doc.querySelector(selector); } catch (e) { return null; }
    return node ? String(node.textContent || '') : null;
  }

  function containsEvery(haystack, needles) {
    var text = String(haystack == null ? '' : haystack).toLowerCase();
    for (var i = 0; i < needles.length; i++) {
      if (text.indexOf(String(needles[i]).toLowerCase()) < 0) return false;
    }
    return true;
  }

  // A post-action expectation turns a silent no-op into an explicit
  // status: no_effect. The action still ran; the caller must re-snapshot rather
  // than retry the same click.
  // The settle window ends after a short quiet period, but an expected change can
  // arrive later (a 100-400 ms timer, a debounced handler). While an `expect`
  // rule is unmet, keep re-checking until it holds or `timeout` since the click
  // runs out, so a correct match is not reported as no_effect too early.
  function expectationHolds(expect, before, o) {
    ensureScan(true);
    var diff = before ? diffStates(before, captureState()) : null;
    var snapshot = buildSnapshot({ format: 'text', maxActions: o.maxActions || 60, maxText: 900 });
    return evaluateExpectation(expect, diff, snapshot).ok;
  }

  function waitForExpectation(expect, before, o, t0) {
    if (!expect || (o && o.settle === false)) return Promise.resolve();
    var timeout = o && o.timeout != null ? o.timeout : 1200;
    var deadline = t0 + timeout;
    return new Promise(function (resolve) {
      function check() {
        var holds = false;
        try { holds = expectationHolds(expect, before, o || {}); } catch (e) { holds = true; }
        if (holds || now() >= deadline) return resolve();
        setTimeout(check, 30);
      }
      check();
    });
  }

  function evaluateExpectation(expect, diff, snapshot) {
    var failures = [];
    var d = diff || {
      added: [], removed: [], changed: [], textAdded: [], textRemoved: [],
      url: null, empty: true, summary: 'no visible changes', text: 'no visible changes'
    };
    if (expect.diff === true && d.empty) failures.push('diff: expected a visible change');
    if (expect.diff === false && !d.empty) failures.push('diff: expected no visible change');
    if (expect.empty != null && !!d.empty !== !!expect.empty) {
      failures.push('empty: expected ' + (expect.empty ? 'no change' : 'a change'));
    }
    if (expect.urlChanged != null && !!d.url !== !!expect.urlChanged) {
      failures.push('urlChanged: expected ' + !!expect.urlChanged);
    }
    if (expect.textAdded && !containsEvery((d.textAdded || []).join('\n'), expect.textAdded)) {
      failures.push('textAdded: missing ' + expect.textAdded.join(' | '));
    }
    if (expect.textRemoved && !containsEvery((d.textRemoved || []).join('\n'), expect.textRemoved)) {
      failures.push('textRemoved: missing ' + expect.textRemoved.join(' | '));
    }
    if (expect.added && !containsEvery((d.added || []).map(function (x) { return x.label || ''; }).join('\n'), expect.added)) {
      failures.push('added: missing ' + expect.added.join(' | '));
    }
    if (expect.removed && !containsEvery((d.removed || []).map(function (x) { return x.label || ''; }).join('\n'), expect.removed)) {
      failures.push('removed: missing ' + expect.removed.join(' | '));
    }
    if (expect.diffContains && !containsEvery(d.text || '', expect.diffContains)) {
      failures.push('diffContains: missing ' + expect.diffContains.join(' | '));
    }
    if (expect.snapshotContains && !containsEvery(snapshot || '', expect.snapshotContains)) {
      failures.push('snapshotContains: missing ' + expect.snapshotContains.join(' | '));
    }
    var observedText = null;
    if (expect.pageText && expect.pageText.selector) {
      observedText = docText(expect.pageText.selector);
      if (observedText == null) {
        failures.push('pageText: selector not found ' + expect.pageText.selector);
      } else if (expect.pageText.equals != null && observedText !== expect.pageText.equals) {
        failures.push('pageText: expected "' + expect.pageText.equals + '"');
      } else if (expect.pageText.includes && !containsEvery(observedText, expect.pageText.includes)) {
        failures.push('pageText: missing ' + expect.pageText.includes.join(' | '));
      }
    }
    return {
      ok: failures.length === 0,
      expected: expect,
      observed: {
        diffEmpty: !!d.empty,
        diffSummary: d.summary,
        textAdded: d.textAdded,
        textRemoved: d.textRemoved,
        added: (d.added || []).map(function (x) { return x.label || ''; }),
        removed: (d.removed || []).map(function (x) { return x.label || ''; }),
        url: d.url,
        pageText: observedText
      },
      failures: failures
    };
  }

  // A custom trigger points at its popup with aria-controls / aria-owns.
  // Prefer that subtree: pages with several comboboxes otherwise match an
  // option from a different widget.
  function popupRoots(entry) {
    var el = entry.node;
    var roots = [];
    var seen = new Set();
    var refs = [];
    var controls = attr(el, 'aria-controls');
    var owns = attr(el, 'aria-owns');
    if (controls) refs = refs.concat(controls.split(/\s+/));
    if (owns) refs = refs.concat(owns.split(/\s+/));
    for (var i = 0; i < refs.length; i++) {
      var id = refs[i];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      var node = byId(el, id);
      if (node) roots.push(node);
    }
    return roots;
  }

  function optionFromNode(node) {
    return {
      node: node,
      label: normText(textOf(node)),
      value: attr(node, 'data-value') || attr(node, 'value') || '',
      intent: attr(node, 'data-ahttp-intent') || ''
    };
  }

  function optionCandidates(entry) {
    var out = [];
    var roots = popupRoots(entry);
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      if (!root || !root.querySelectorAll) continue;
      var role = String(attr(root, 'role') || '').toLowerCase();
      var sel = '[role="option"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="treeitem"],option';
      if (role === 'listbox' || role === 'menu' || role === 'tree' || role === 'grid') sel += ',li';
      var list = [];
      try { list = root.querySelectorAll(sel); } catch (e) { list = []; }
      for (var j = 0; j < list.length; j++) out.push(optionFromNode(list[j]));
    }
    if (!out.length && S.scan) {
      for (var k = 0; k < S.scan.actions.length; k++) {
        var e = S.scan.actions[k];
        if (e === entry) continue;
        if (e.role === 'option' || e.role === 'menuitem' || e.role === 'menuitemradio' ||
            e.role === 'menuitemcheckbox' || e.role === 'treeitem' || e.tag === 'option' || e.tag === 'li') {
          out.push(e);
        }
      }
    }
    return out;
  }

  function pickOption(options, p) {
    var idx = p.index != null ? parseInt(p.index, 10) : null;
    if (idx != null && options[idx]) return options[idx];
    var wanted = p.value != null ? String(p.value)
      : (p.label != null ? String(p.label) : (p.choose != null ? String(p.choose) : ''));
    if (!wanted) return null;
    var lower = wanted.toLowerCase();
    for (var i = 0; i < options.length; i++) {
      var o = options[i];
      var hay = [o.label, o.value, o.intent].filter(Boolean).join(' ').toLowerCase();
      if (hay === lower) return o;
    }
    for (var j = 0; j < options.length; j++) {
      var o2 = options[j];
      var hay2 = [o2.label, o2.value, o2.intent].filter(Boolean).join(' ').toLowerCase();
      if (hay2.indexOf(lower) >= 0) return o2;
    }
    return null;
  }

  function findCustomOption(entry, p, allowScan) {
    var options = optionCandidates(entry);
    var hit = pickOption(options, p);
    if (hit) return hit;
    if (options.length) return null;
    if (allowScan === false) return null;
    ensureScan(true);
    return pickOption(optionCandidates(entry), p);
  }

  function waitForCustomOption(entry, p, timeout) {
    var deadline = now() + (timeout == null ? 800 : timeout);
    var attempt = 0;
    function tick() {
      var hit = findCustomOption(entry, p, attempt % 4 === 0);
      attempt++;
      if (hit) return Promise.resolve(hit);
      if (now() >= deadline) return Promise.resolve(null);
      return delay(40).then(tick);
    }
    return tick();
  }

  function execute(entry, payload, opts) {
    var el = entry.node;
    var doc = el.ownerDocument;
    var p = payload || {};
    var kind = entry.kind;
    if (p.key) {
      try { if (el.focus) el.focus(); } catch (e) {}
      keySequence(el, p.key, opts);
      return { ok: true, action: actionInfo(entry, 'key'), method: 'key' };
    }
    if (p.hover) {
      applyHoverEffects(entry);
      fire(el, 'pointerover', { bubbles: true }, doc);
      fire(el, 'mouseover', { bubbles: true }, doc);
      fire(el, 'mousemove', { bubbles: true }, doc);
      return { ok: true, action: actionInfo(entry, 'hover'), method: 'hover' };
    }
    if (p.scroll) {
      try { if (el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch (e) {}
      fire(el, 'scroll', { bubbles: true }, doc);
      return { ok: true, action: actionInfo(entry, 'scroll'), method: 'scroll' };
    }
    if (kind === 'fill') {
      var value = p.value != null ? String(p.value) : (p.text != null ? String(p.text) : '');
      try { if (el.focus) el.focus(); } catch (e) {}
      fire(el, 'beforeinput', { data: value, inputType: 'insertText' }, doc);
      if (entry.editable) {
        el.textContent = value;
      } else {
        setNativeValue(el, value);
      }
      fire(el, 'input', { bubbles: true, data: value, inputType: 'insertText' }, doc);
      fire(el, 'change', { bubbles: true }, doc);
      fire(el, 'keyup', { bubbles: true, key: 'Unidentified' }, doc);
      if (p.blur === true) {
        try { if (el.blur) el.blur(); } catch (e) {}
        fire(el, 'blur', {}, doc);
      }
      entry.value = value;
      return { ok: true, action: actionInfo(entry, 'fill'), method: 'fill' };
    }
    var wanted = p.value != null || p.label != null || p.index != null || p.choose != null;
    var popupTrigger = kind === 'click' && (hasAttr(el, 'aria-haspopup') || hasAttr(el, 'aria-expanded') || hasAttr(el, 'aria-controls'));
    if ((kind === 'select' && tagOf(el) !== 'select') || (popupTrigger && wanted)) {
      clickSequence(el, opts);
      var waitMs = p.wait != null ? parseInt(p.wait, 10) : 800;
      if (!isFinite(waitMs) || waitMs < 0) waitMs = 800;
      return waitForCustomOption(entry, p, waitMs).then(function (option) {
        if (!option) {
          var available = optionCandidates(entry).map(function (cand) { return cand.label; }).filter(Boolean).slice(0, 12);
          if (!wanted) {
            return { ok: true, action: actionInfo(entry, 'select'), method: 'custom-select', opened: true, available: available };
          }
          return { ok: false, action: actionInfo(entry, 'select'), method: 'custom-select', error: 'option_not_found', available: available };
        }
        clickSequence(option.node, opts);
        entry.value = option.label;
        return { ok: true, action: actionInfo(entry, 'select'), method: 'custom-select', selected: option.label };
      });
    }
    if (kind === 'select') {
      var target = p.value != null ? String(p.value) : (p.label != null ? String(p.label) : '');
      var changed = false;
      var targetIndex = p.index != null ? parseInt(p.index, 10) : null;
      if (el.options && el.options.length) {
        for (var oi = 0; oi < el.options.length; oi++) {
          var o = el.options[oi];
          var otext = normText(textOf(o));
          var match = targetIndex != null ? oi === targetIndex : (String(o.value) === target || otext === target);
          if (!match) continue;
          var before = el.value;
          try {
            var proto = el.ownerDocument.defaultView.HTMLSelectElement.prototype;
            var desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.set) desc.set.call(el, String(o.value)); else el.value = String(o.value);
            o.selected = true;
          } catch (e) { el.value = String(o.value); }
          var tracker = el._valueTracker;
          if (tracker && typeof tracker.setValue === 'function') tracker.setValue(before);
          fire(el, 'input', { bubbles: true }, doc);
          fire(el, 'change', { bubbles: true }, doc);
          changed = true;
          break;
        }
      }
      return { ok: changed, action: actionInfo(entry, 'select'), method: 'select', error: changed ? null : 'option_not_found' };
    }
    if (kind === 'toggle') {
      var want = p.checked != null ? !!p.checked : (p.value != null ? String(p.value) === 'true' : !el.checked);
      if (!!el.checked !== want) clickSequence(el, opts);
      return { ok: true, action: actionInfo(entry, 'toggle'), method: 'toggle' };
    }
    if (kind === 'hover') {
      applyHoverEffects(entry);
      fire(el, 'pointerover', { bubbles: true }, doc);
      fire(el, 'mouseover', { bubbles: true }, doc);
      fire(el, 'mousemove', { bubbles: true }, doc);
      return { ok: true, action: actionInfo(entry, 'hover'), method: 'hover' };
    }
    clickSequence(el, opts);
    var href = entry.href || null;
    return { ok: true, action: actionInfo(entry, 'click'), method: 'click', href: href };
  }

  function actionInfo(entry, method) {
    return { id: entry.id, method: method, kind: entry.kind, label: entry.label, tag: entry.tag, role: entry.role };
  }

  function withStatus(result) {
    if (!result || result.status) return result;
    if (result.requiresConfirmation) result.status = 'requires_confirmation';
    else if (result.locked) result.status = 'locked';
    else if (result.ok) result.status = 'ok';
    else if (result.error === 'unknown_action' || result.error === 'detached_action') result.status = 'not_found';
    else if (result.blocked) result.status = 'blocked';
    else result.status = 'error';
    return result;
  }

  function act(id, payload, opts) {
    return Promise.resolve().then(function () {
      ensureConfig();
      ensureAuthFresh();
      if (S.locked) return lockedActionResult();
      wake();
      var p = normalizePayload(payload);
      var o = opts || {};
      if (p && typeof p === 'object') {
        if (p.confirm === true) o.confirm = true;
        if (p.settle != null) o.settle = p.settle;
        if (p.timeout != null) o.timeout = p.timeout;
        if (p.quiet != null) o.quiet = p.quiet;
        if (p.minWait != null) o.minWait = p.minWait;
        if (p.networkQuiet != null) o.networkQuiet = p.networkQuiet;
        if (p.diff != null) o.diff = p.diff;
        if (p.snapshot != null) o.snapshot = p.snapshot;
        if (p.maxActions != null) o.maxActions = p.maxActions;
      }
      var expect = null;
      if (p.expect && typeof p.expect === 'object') expect = p.expect;
      else if (o.expect && typeof o.expect === 'object') expect = o.expect;
      ensureScan(true);
      var resolved = resolveEntry(id);
      if (resolved.status === 'not_found') {
        return {
          ok: false,
          error: resolved.reason || 'detached_action',
          status: 'not_found',
          id: resolved.entry ? resolved.entry.id : String(id)
        };
      }
      if (resolved.status === 'ambiguous') {
        var stale = resolved.entry || null;
        return {
          ok: false,
          error: 'ambiguous',
          status: 'ambiguous',
          id: resolved.id || (stale ? stale.id : String(id)),
          action: stale ? actionInfo(stale, stale.kind) : undefined,
          targetHint: p.targetHint != null ? String(p.targetHint) : (o.targetHint != null ? String(o.targetHint) : (stale && stale.label ? stale.label : null)),
          candidates: resolved.candidates,
          thresholds: { accept: MATCH.accept, ambiguous: MATCH.ambiguous, margin: MATCH.margin, contentMargin: MATCH.contentMargin },
          warning: 'Multiple controls match this target; no action was taken.'
        };
      }
      var entry = resolved.entry;
      if (!entry.node) return { ok: false, error: 'detached_action', status: 'not_found', id: entry.id };
      if (!policyAllows(entry)) {
        return {
          ok: false,
          blocked: true,
          error: 'policy_denied',
          id: entry.id,
          action: actionInfo(entry, entry.kind)
        };
      }
      if (p.read === true) {
        return {
          ok: true,
          id: entry.id,
          action: actionInfo(entry, 'read'),
          value: entry.value,
          checked: entry.checked,
          readonly: !!entry.readonly
        };
      }
      var confirmGiven = o.confirm === true || p.confirm === true;
      var confirmWarning = entry.confirm || policyConfirmWarning(entry);
      if (confirmWarning && !confirmGiven) {
        return {
          ok: false,
          blocked: true,
          requiresConfirmation: true,
          warning: confirmWarning,
          id: entry.id,
          action: actionInfo(entry, entry.kind)
        };
      }
      if (S.config && S.config.readOnly) {
        var passive = p.hover === true || p.scroll === true || entry.role === 'link';
        if (!passive) {
          return {
            ok: false,
            blocked: true,
            error: 'policy_readonly',
            id: entry.id,
            action: actionInfo(entry, entry.kind)
          };
        }
      }
      if (entry.readonly && (entry.kind === 'fill' || entry.kind === 'select' || entry.kind === 'toggle')) {
        return {
          ok: false,
          blocked: true,
          error: 'readonly',
          readOnly: true,
          value: entry.value,
          id: entry.id,
          action: actionInfo(entry, entry.kind)
        };
      }
      if (entry.native && entry.disabled) {
        return { ok: false, blocked: true, error: 'disabled', id: entry.id, action: actionInfo(entry, entry.kind) };
      }
      var proceed = function () {
        var t0 = now();
        var requestsBefore = S.net.count;
        var pendingBefore = new Set(S.net.pending);
        var before = (o.diff === false && !expect) ? null : captureState();
        var counter = startMutationCounter();
        patchNetwork();
        return Promise.resolve(execute(entry, p, o)).then(function (res) {
          var traceStep = res.ok !== false ? recordTrace(entry, p, res, o) : null;
          S.dirty = true;
          return waitSettled(o, counter, requestsBefore, pendingBefore).then(function () {
            return waitForExpectation(expect, before, o, t0);
          }).then(function () {
            if (counter.observer) { try { counter.observer.disconnect(); } catch (e) {} }
            unpatchNetwork();
            ensureScan(true);
            var latency = now() - t0;
            S.lastLatencyMs = latency;
            var out = {
              ok: res.ok !== false,
              action: res.action || actionInfo(entry, entry.kind),
              method: res.method,
              url: currentUrl(),
              latencyMs: latency,
              meta: {
                mutations: counter.count,
                requests: S.net.count - requestsBefore,
                settleMs: latency
              }
            };
            if (res.error) out.error = res.error;
            if (traceStep) out.traceStep = traceStep;
            if (res.href) out.href = res.href;
            if (res.available) out.available = res.available;
            if (res.selected) out.selected = res.selected;
            var internalDiff = before ? diffStates(before, captureState()) : null;
            if (internalDiff && o.diff !== false) out.diff = internalDiff;
            if (o.snapshot !== false) {
              var snap = buildSnapshot({ format: 'text', maxActions: o.maxActions || 60, maxText: 900 });
              out.snapshot = snap;
              out.snapshotMeta = { chars: snap.length, tokens: Math.ceil(snap.length / 4) };
            }
            if (expect && out.ok) {
              var expectSnapshot = out.snapshot || buildSnapshot({ format: 'text', maxActions: o.maxActions || 60, maxText: 900 });
              var verdict = evaluateExpectation(expect, internalDiff, expectSnapshot);
              out.effect = {
                ok: verdict.ok,
                expected: verdict.expected,
                observed: verdict.observed,
                failures: verdict.failures
              };
              if (!verdict.ok) {
                out.status = 'no_effect';
                out.warning = 'The action ran but the expected change was not observed; the match may be wrong.';
              }
            }
            return out;
          });
        }, function (err) {
          if (counter.observer) { try { counter.observer.disconnect(); } catch (e) {} }
          unpatchNetwork();
          return {
            ok: false,
            error: 'execution_failed',
            message: String(err && err.message ? err.message : err),
            action: actionInfo(entry, entry.kind)
          };
        });
      };
      var hook = S.config && typeof S.config.authorizeAction === 'function' ? S.config.authorizeAction : null;
      if (!hook || p.hover === true || p.scroll === true) {
        return proceed();
      }
      return Promise.resolve().then(function () {
        return hook({
          id: entry.id,
          intent: entry.intent || null,
          label: entry.label,
          kind: entry.kind,
          value: p.value != null ? p.value : undefined,
          checked: p.checked != null ? p.checked : undefined,
          key: p.key || undefined
        });
      }).then(function (decision) {
        if (decision === false || (decision && decision.ok === false)) {
          return {
            ok: false,
            blocked: true,
            error: 'unauthorized',
            reason: decision && (decision.reason || decision.error) ? String(decision.reason || decision.error) : null,
            id: entry.id,
            action: actionInfo(entry, entry.kind)
          };
        }
        return proceed();
      }, function (err) {
        return {
          ok: false,
          blocked: true,
          error: 'authorization_failed',
          message: String(err && err.message ? err.message : err),
          id: entry.id,
          action: actionInfo(entry, entry.kind)
        };
      });
    }).then(withStatus);
  }

  function status() {
    ensureConfig();
    ensureAuthFresh();
    var warnings = [];
    if (S.config && S.config.key) warnings.push('plaintext_key_development_only');
    if (S.config && (S.config.access === 'gate' || (S.config.access === 'owner' && !S.config.authEndpoint))) warnings.push('client_side_gate_only');
    if (S.config && S.config.access === 'gate') warnings.push('soft_gate_only');
    var base = {
      state: S.state,
      version: VERSION,
      dormant: S.state === 'dormant',
      wakeCount: S.wakeCount || 0,
      wakeMs: S.wakeMs || 0,
      mode: S.config ? S.config.access : 'public',
      access: S.config ? S.config.access : 'public',
      locked: !!S.locked,
      lockedReason: S.locked ? lockReason() : null,
      owner: S.config ? S.config.owner || null : null,
      authMode: S.authMode,
      authExpiresAt: S.authExpiresAt || null,
      serverVerified: S.authMode === 'server' && !S.locked,
      warnings: warnings,
      policy: policySummary()
    };
    if (S.state === 'dormant') {
      base.engine = 'idle';
      base.overhead = 'not measured';
      base.actions = 0;
      base.nodes = 0;
      base.sanitized = 0;
      return base;
    }
    var scan = S.scan;
    base.engine = 'active';
    base.layout = S.layout ? 'layout' : 'css';
    base.actions = scan ? scan.actions.length : 0;
    base.nodes = S.nodeCount;
    base.forms = scan ? scan.meta.forms : 0;
    base.sanitized = S.sanitized;
    base.ignored = scan ? scan.meta.ignored : 0;
    base.policyHidden = S.policyHidden || 0;
    base.observers = S.observer ? 1 : 0;
    base.network = { patched: !!S.net.networkPatched, requests: S.net.count, inflight: S.net.inflight };
    base.scanMs = S.lastScanMs;
    base.lastLatencyMs = S.lastLatencyMs;
    base.uptimeMs = S.startedAt ? now() - S.startedAt : 0;
    return base;
  }

  function wake() {
    ensureConfig();
    if (S.locked) return S;
    if (S.state === 'active') return S;
    var env = ENV();
    var doc = env.document;
    if (!doc) throw new Error('ahttp: no document available in this environment');
    var t0 = now();
    S.win = env;
    S.doc = doc;
    S.layout = detectLayout(doc);
    S.canObserve = typeof env.MutationObserver === 'function';
    S.startedAt = t0;
    S.wakeMs = 0;
    S.state = 'active';
    S.wakeCount++;
    S.dirty = true;
    installObserver();
    S.wakeMs = now() - t0;
    return S;
  }

  function installObserver() {
    if (S.observer) return;
    if (!S.win || typeof S.win.MutationObserver !== 'function' || !S.doc) return;
    try {
      S.observer = new S.win.MutationObserver(function () { S.dirty = true; });
      S.observer.observe(S.doc, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'inert', 'open', 'disabled', 'value', 'checked', 'readonly']
      });
    } catch (e) {
      S.observer = null;
    }
  }

  function resetRuntime() {
    unpatchNetwork();
    if (S.observer) {
      try { S.observer.disconnect(); } catch (e) {}
      S.observer = null;
    }
    if (S.autoTimer) {
      try { clearTimeout(S.autoTimer); } catch (e) {}
      S.autoTimer = null;
    }
    S.registry = new Map();
    S.byNode = new WeakMap();
    S.scan = null;
    S.modalCache = null;
    S.seq = 0;
    S.dirty = true;
    S.doc = null;
    S.win = null;
    S.state = 'dormant';
    S.startedAt = 0;
    S.nodeCount = 0;
    S.sanitized = 0;
    S.lastScanMs = 0;
    S.policyHidden = 0;
    clearAuthTimer();
    S.authExpiresAt = 0;
    S.authMode = S.config ? authModeFromConfig(S.config) : 'none';
  }

  function sleep() {
    resetRuntime();
    S.config = null;
    S.configLoaded = false;
    S.locked = false;
    S.unlocked = true;
    S.authMode = 'none';
    S.authFailures = 0;
    S.authBlockedUntil = 0;
    return { state: 'dormant', restored: true, observers: 0, locked: false };
  }

  function unlock(key) {
    ensureConfig();
    if (!S.config || S.config.access === 'public') {
      S.locked = false;
      S.unlocked = true;
      S.authMode = 'none';
      return { ok: true, locked: false, mode: 'public' };
    }
    var c = S.config;
    if (c.access === 'dev') {
      if (!isLocalEnv()) {
        return { ok: false, locked: true, error: 'dev_only', owner: c.owner || null };
      }
      S.locked = false;
      S.unlocked = true;
      S.authMode = 'none';
      return { ok: true, locked: false, mode: 'dev', owner: c.owner || null };
    }
    if (c.authEndpoint) {
      return { ok: false, locked: true, error: 'server_auth_required', owner: c.owner || null };
    }
    if (now() < S.authBlockedUntil) {
      return {
        ok: false,
        locked: true,
        error: 'rate_limited',
        retryAfterMs: Math.max(0, S.authBlockedUntil - now()),
        owner: c.owner || null
      };
    }
    var provided = key == null ? '' : String(key);
    var valid = false;
    if (c.key) {
      if (!isLocalHostname(currentHostname())) {
        return { ok: false, locked: true, error: 'insecure_key_rejected', owner: c.owner || null };
      }
      valid = safeEqual(provided, c.key);
    } else if (c.keyHash) {
      valid = safeEqual(sha256Hex(provided), c.keyHash);
    } else {
      return { ok: false, locked: true, error: 'owner_key_not_configured', owner: c.owner || null };
    }
    if (!valid) {
      S.authFailures++;
      if (S.authFailures >= 5) {
        var delay = Math.min(30000, 1000 * Math.pow(2, S.authFailures - 5));
        S.authBlockedUntil = now() + delay;
      }
      return { ok: false, locked: true, error: 'invalid_key', owner: c.owner || null };
    }
    S.authFailures = 0;
    S.authBlockedUntil = 0;
    S.locked = false;
    S.unlocked = true;
    S.authMode = 'key';
    S.authExpiresAt = 0;
    S.dirty = true;
    return { ok: true, locked: false, mode: 'key', owner: c.owner || null };
  }

  function lockEngine() {
    resetRuntime();
    if (S.config) {
      S.locked = isLockedByAccess(S.config);
      S.unlocked = !S.locked;
      S.authMode = authModeFromConfig(S.config);
    }
    return status();
  }

  function configure(input) {
    input = input || {};
    var base = S.config || {};
    var access = input.access != null ? input.access : (input.mode != null ? input.mode : null);
    if (access == null && input.private != null) {
      var hasEndpoint = !!(input.authEndpoint != null ? input.authEndpoint : base.authEndpoint);
      var hasKey = !!(input.key != null ? input.key : base.key) || !!(input.keyHash != null ? input.keyHash : base.keyHash);
      access = input.private ? (hasEndpoint ? 'owner' : (hasKey ? 'gate' : 'owner')) : 'public';
    }
    if (access == null) access = base.access;
    var merged = {
      owner: input.owner != null ? input.owner : base.owner,
      access: access,
      private: base.private,
      key: input.key != null ? input.key : base.key,
      keyHash: input.keyHash != null ? input.keyHash : base.keyHash,
      authEndpoint: input.authEndpoint != null ? input.authEndpoint : base.authEndpoint,
      authOrigins: input.authOrigins != null ? input.authOrigins : base.authOrigins,
      authTimeoutMs: input.authTimeoutMs != null ? input.authTimeoutMs : base.authTimeoutMs,
      authorizeAction: input.authorizeAction != null ? input.authorizeAction : base.authorizeAction,
      allow: input.allow != null ? input.allow : base.allow,
      deny: input.deny != null ? input.deny : base.deny,
      confirm: input.confirm != null ? input.confirm : base.confirm,
      readOnly: input.readOnly != null ? input.readOnly : base.readOnly,
      maxActions: input.maxActions != null ? input.maxActions : base.maxActions,
      maxNodes: input.maxNodes != null ? input.maxNodes : base.maxNodes,
      maxDepth: input.maxDepth != null ? input.maxDepth : base.maxDepth
    };
    resetRuntime();
    S.configLoaded = true;
    applyConfig(merged);
    return policySummary();
  }

  function tools() {
    ensureConfig();
    ensureAuthFresh();
    if (S.locked) {
      return {
        version: VERSION,
        locked: true,
        access: S.config ? S.config.access : null,
        owner: S.config ? S.config.owner || null : null,
        error: lockReason(),
        tools: [],
        actions: []
      };
    }
    var snap = buildSnapshot({ format: 'json', maxActions: 120 });
    var actions = (snap.actions || []).map(function (a) {
      var row = {
        id: a.id,
        label: a.label,
        kind: a.kind,
        role: a.role,
        region: a.region
      };
      if (a.kind === 'fill') row.value = 'string';
      else if (a.kind === 'select') row.value = 'string (option value or visible option label)';
      else if (a.kind === 'toggle') row.value = 'boolean';
      else row.value = 'none';
      if (a.requiresConfirmation) {
        row.requiresConfirmation = true;
        row.warning = a.warning;
      }
      return row;
    });
    var protectedAction = actions.some(function (a) { return a.requiresConfirmation; });
    var props = {
      id: {
        type: 'string',
        enum: actions.map(function (a) { return a.id; }),
        description: 'Action id from the current ahttp snapshot.'
      },
      value: { type: 'string', description: 'Text for fill/select actions. For toggles use "true" or "false". Omit for click actions.' },
      key: { type: 'string', enum: ['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp', ' '], description: 'Optional keyboard event to dispatch on the target.' }
    };
    if (protectedAction) {
      props.confirm = { type: 'boolean', description: 'Explicit confirmation for actions marked requiresConfirmation in the snapshot.' };
    }
    var schema = {
      name: 'ahttp_act',
      description: 'Execute one action against the live page. Returns ok, diff, and a fresh snapshot. Get ids from ahttp_snapshot first.',
      parameters: {
        type: 'object',
        properties: props,
        required: ['id'],
        additionalProperties: false
      }
    };
    return {
      version: VERSION,
      url: snap.url,
      generatedAt: new Date().toISOString(),
      tools: [schema],
      actions: actions,
      snapshotMeta: snap.meta
    };
  }

  var TRACE_LIMIT = 200;

  // A trace step stores the fingerprint, not the DOM id. Ids are scan-local;
  // intent/testid/name/label survive a reload, a framework rerender or a
  // deploy, which is what makes a recorded run replayable later.
  function tracePayload(entry, p) {
    var out = {};
    var type = String(entry.type || '').toLowerCase();
    var secret = p.secret === true || type === 'password';
    if (p.key) out.key = String(p.key);
    else if (p.checked != null) out.checked = p.checked === true;
    else if (p.value != null || p.text != null) {
      var value = p.value != null ? String(p.value) : String(p.text);
      if (secret) {
        out.redacted = true;
        out.valueLength = value.length;
      } else {
        out.value = value;
      }
    } else if (p.hover === true) out.hover = true;
    else if (p.scroll === true) out.scroll = true;
    if (p.dialog === 'accept' || p.dialog === 'dismiss') {
      out.dialog = p.dialog;
      if (p.promptText != null) out.promptText = String(p.promptText);
    }
    return out;
  }

  function recordTrace(entry, p, res, o) {
    if (o && o.record === false) return null;
    if (!entry.fingerprint) return null;
    var step = {
      seq: S.trace.length + 1,
      at: new Date().toISOString(),
      url: currentUrl(),
      title: docTitle(),
      kind: res.method || entry.kind,
      action: JSON.parse(JSON.stringify(entry.fingerprint)),
      payload: tracePayload(entry, p),
      ok: res.ok !== false
    };
    S.trace.push(step);
    if (S.trace.length > TRACE_LIMIT) {
      S.trace.shift();
      S.traceDropped++;
    }
    return step;
  }

  // Capture what an action would record before it runs. A navigating click
  // destroys the isolated world, so the browser backend uses this descriptor
  // to keep the step in its own cross-navigation trace.
  function describeAction(id, payload) {
    ensureConfig();
    ensureAuthFresh();
    if (S.locked) return null;
    wake();
    ensureScan(false);
    var resolved = resolveEntry(id);
    if (resolved.status !== 'ok' || !resolved.entry || !resolved.entry.fingerprint) return null;
    var entry = resolved.entry;
    return {
      seq: 0,
      at: new Date().toISOString(),
      url: currentUrl(),
      title: docTitle(),
      kind: entry.kind,
      action: JSON.parse(JSON.stringify(entry.fingerprint)),
      payload: tracePayload(entry, normalizePayload(payload)),
      ok: true
    };
  }

  function exportTrace() {
    return {
      version: VERSION,
      url: currentUrl(),
      title: docTitle(),
      steps: JSON.parse(JSON.stringify(S.trace)),
      dropped: S.traceDropped,
      limit: TRACE_LIMIT
    };
  }

  function importTrace(steps) {
    if (!Array.isArray(steps)) return { ok: false, error: 'invalid_trace' };
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      if (!step || !step.action) continue;
      S.trace.push(JSON.parse(JSON.stringify(step)));
      if (S.trace.length > TRACE_LIMIT) {
        S.trace.shift();
        S.traceDropped++;
      }
    }
    for (var j = 0; j < S.trace.length; j++) S.trace[j].seq = j + 1;
    return { ok: true, steps: S.trace.length };
  }

  // Same accept/margin policy as relocate(), but scored against a portable
  // fingerprint instead of a stale registry entry.
  function matchFingerprint(fp) {
    ensureScan(true);
    var scored = [];
    for (var i = 0; i < S.scan.actions.length; i++) {
      var cand = S.scan.actions[i];
      if (!cand || !cand.node || !connected(cand.node)) continue;
      var match = scoreMatch(fp, cand);
      if (match.score <= 0) continue;
      if (!hasContentSignal(match.signals)) continue;
      scored.push({
        entry: cand,
        score: match.score,
        content: match.content,
        signals: match.signals,
        disabled: !!cand.disabled
      });
    }
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return (a.entry.order || 0) - (b.entry.order || 0);
    });
    var best = null;
    for (var j = 0; j < scored.length; j++) {
      if (!scored[j].disabled) { best = scored[j]; break; }
    }
    var strongest = scored[0] || null;
    if (!best || best.score < MATCH.ambiguous) {
      return {
        status: 'not_found',
        bestScore: best ? best.score : 0,
        secondScore: strongest && strongest !== best ? strongest.score : 0,
        candidates: []
      };
    }
    var ahead = true;
    for (var k = 0; k < scored.length; k++) {
      if (scored[k] === best) continue;
      if ((best.score - scored[k].score) < MATCH.margin) ahead = false;
      if ((best.content - scored[k].content) < MATCH.contentMargin) ahead = false;
    }
    if (best.score >= MATCH.accept && ahead) {
      return {
        status: 'ok',
        entry: best.entry,
        score: best.score,
        signals: best.signals,
        bestScore: best.score,
        secondScore: strongest && strongest !== best ? strongest.score : 0
      };
    }
    return {
      status: 'ambiguous',
      bestScore: best.score,
      secondScore: strongest && strongest !== best ? strongest.score : 0,
      candidates: scored.slice(0, MATCH.maxCandidates).map(function (row) {
        return {
          id: row.entry.id,
          role: row.entry.role,
          name: row.entry.label,
          tag: row.entry.tag,
          score: row.score,
          signals: row.signals
        };
      })
    };
  }

  function replayPayload(step, index, options) {
    var src = (step && step.payload) || {};
    var out = {};
    if (src.redacted === true) {
      var supplied = null;
      if (options && options.values && options.values[index] != null) supplied = options.values[index];
      else if (step && step.value != null) supplied = step.value;
      if (supplied == null) return { needsValue: true, payload: out };
      out.value = String(supplied);
    } else if (src.value != null) out.value = String(src.value);
    if (src.checked != null) out.checked = src.checked === true;
    if (src.key) out.key = String(src.key);
    if (src.hover === true) out.hover = true;
    if (src.scroll === true) out.scroll = true;
    if (src.dialog === 'accept' || src.dialog === 'dismiss') out.dialog = src.dialog;
    if (src.promptText != null) out.promptText = String(src.promptText);
    return { needsValue: false, payload: out };
  }

  // Public, DOM-free match result. The browser backend orchestrates replay
  // across navigations because the page world dies on every navigation.
  function publicMatch(fp) {
    var m = matchFingerprint(fp);
    var out = {
      status: m.status,
      bestScore: m.bestScore || 0,
      secondScore: m.secondScore || 0,
      candidates: m.candidates || []
    };
    if (m.status === 'ok') {
      out.id = m.entry.id;
      out.label = m.entry.label;
      out.kind = m.entry.kind;
      out.score = m.score;
      out.signals = m.signals;
    }
    return out;
  }

  function replay(steps, options) {
    var o = options || {};
    var list = Array.isArray(steps) ? steps : (steps && Array.isArray(steps.steps) ? steps.steps : []);
    var rows = [];
    var index = 0;
    function finish() {
      var okCount = rows.filter(function (r) { return r.ok; }).length;
      return {
        ok: rows.length === list.length && okCount === rows.length,
        dryRun: o.dryRun === true,
        total: list.length,
        completed: okCount,
        failed: rows.length - okCount,
        skipped: Math.max(0, list.length - rows.length),
        steps: rows
      };
    }
    function runOne() {
      if (index >= list.length) return Promise.resolve(finish());
      var i = index++;
      var step = list[i] || {};
      var fp = step.action || step.fingerprint || step;
      var built = replayPayload(step, i, o);
      if (built.needsValue) {
        rows.push({ index: i, ok: false, status: 'needs_value', label: fp.label || null });
        return o.continueOnError === true ? runOne() : Promise.resolve(finish());
      }
      if (o.requireSameUrl === true && step.url && currentUrl() && step.url !== currentUrl()) {
        rows.push({ index: i, ok: false, status: 'url_mismatch', expected: step.url, actual: currentUrl() });
        return o.continueOnError === true ? runOne() : Promise.resolve(finish());
      }
      var match = matchFingerprint(fp);
      if (match.status !== 'ok') {
        rows.push({
          index: i,
          ok: false,
          status: match.status,
          label: fp.label || null,
          score: match.bestScore || 0,
          candidates: match.candidates || []
        });
        return o.continueOnError === true ? runOne() : Promise.resolve(finish());
      }
      var base = {
        index: i,
        id: match.entry.id,
        label: match.entry.label,
        kind: match.entry.kind,
        score: match.score,
        signals: match.signals,
        urlDrift: !!(step.url && currentUrl() && step.url !== currentUrl())
      };
      if (o.dryRun === true) {
        base.ok = true;
        base.status = 'would_run';
        rows.push(base);
        return runOne();
      }
      var actOpts = {
        settle: o.settle,
        timeout: o.timeout,
        snapshot: false,
        diff: o.diff === true,
        record: false,
        confirm: o.confirm === true || step.confirmed === true
      };
      return act(match.entry.id, built.payload, actOpts).then(function (res) {
        base.ok = !!(res && res.ok);
        base.status = base.ok ? 'ok' : (res && res.status ? res.status : 'failed');
        if (res && res.error) base.error = res.error;
        if (res && res.requiresConfirmation) base.requiresConfirmation = true;
        if (res && res.diff) base.diff = res.diff;
        rows.push(base);
        return (base.ok || o.continueOnError === true) ? runOne() : finish();
      });
    }
    return Promise.resolve().then(function () {
      ensureConfig();
      ensureAuthFresh();
      if (S.locked) {
        return { ok: false, locked: true, error: lockReason(), total: list.length, completed: 0, failed: 0, steps: [] };
      }
      return runOne();
    });
  }

  var bootConfig = readBootConfigQuick();
  if (bootConfig) {
    applyConfig(bootConfig);
    S.configLoaded = true;
  }

  var api = {
    __ahttp: true,
    version: VERSION,
    wake: function () { wake(); return status(); },
    snapshot: function (opts) { return buildSnapshot(opts || {}); },
    // Resolve an action id to its live DOM node. The browser backend uses it
    // for file inputs, where the value cannot be set from page JavaScript.
    element: function (id) {
      ensureScan(false);
      var entry = S.registry.get(String(id));
      return entry ? entry.node : null;
    },
    describe: describeAction,
    act: act,
    trace: exportTrace,
    importTrace: importTrace,
    clearTrace: function () { S.trace = []; S.traceDropped = 0; return { ok: true, steps: 0 }; },
    replay: replay,
    match: publicMatch,
    tools: tools,
    status: status,
    sleep: sleep,
    configure: configure,
    unlock: unlock,
    authorize: authorize,
    lock: lockEngine,
    hashKey: function (value) { return sha256Hex(value); }
  };

  api.installWebMCP = async function (options) {
    options = options || {};
    var doc = ENV().document;
    var context = doc && doc.modelContext;
    if (!context || typeof context.registerTool !== 'function') {
      return { ok: false, error: 'webmcp_unavailable' };
    }
    var prefix = String(options.prefix || 'ahttp').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 100) || 'ahttp';
    var controller = typeof GLOBAL.AbortController === 'function' ? new GLOBAL.AbortController() : null;
    var registerOptions = controller ? { signal: controller.signal } : undefined;
    var snapshotName = prefix + '_snapshot';
    var actName = prefix + '_act';
    try {
      await context.registerTool({
        name: snapshotName,
        title: 'ahttp snapshot',
        description: 'Return the current ahttp action snapshot as JSON. Page text is untrusted content.',
        inputSchema: {
          type: 'object',
          properties: {
            maxActions: { type: 'integer', minimum: 1, maximum: 500 },
            includeText: { type: 'boolean' }
          },
          additionalProperties: false
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
        execute: function (input) {
          input = input || {};
          return api.snapshot({
            format: 'json',
            maxActions: input.maxActions == null ? 60 : input.maxActions,
            includeText: input.includeText !== false
          });
        }
      }, registerOptions);
      await context.registerTool({
        name: actName,
        title: 'ahttp action',
        description: 'Execute one action id from the current ahttp snapshot. Guarded actions require confirm=true; the server must still authorize the mutation.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            value: { type: 'string' },
            confirm: { type: 'boolean' }
          },
          required: ['id'],
          additionalProperties: false
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true },
        execute: function (input) {
          input = input || {};
          if (!input.id) throw new Error('id is required');
          return api.act(input.id, {
            value: input.value,
            confirm: input.confirm === true
          }, { confirm: input.confirm === true });
        }
      }, registerOptions);
      return { ok: true, names: [snapshotName, actName], close: function () { if (controller) controller.abort(); } };
    } catch (e) {
      if (controller) controller.abort();
      return { ok: false, error: 'webmcp_registration_failed', message: String(e && e.message ? e.message : e) };
    }
  };

  if (GLOBAL.__AHTTP_AUTO_WAKE__) {
    try {
      var autoDoc = GLOBAL.document;
      if (autoDoc) {
        if (autoDoc.readyState === 'complete' || autoDoc.readyState === 'interactive') {
          S.autoTimer = setTimeout(function () { try { wake(); } catch (e) {} }, 0);
        } else if (autoDoc.addEventListener) {
          autoDoc.addEventListener('DOMContentLoaded', function () { try { wake(); } catch (e) {} }, { once: true });
        }
      }
    } catch (e) {}
  }

  return api;
});
