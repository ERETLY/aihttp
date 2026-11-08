'use strict';

const fs = require('fs');
const path = require('path');
const { prepareRequest, redactUrl } = require('./net-guard');
const { DEFAULT_UA } = require('./user-agent');

const ENGINE_PATH = path.join(__dirname, '..', 'aihttp.js');
const ENGINE_SRC = fs.readFileSync(ENGINE_PATH, 'utf8');

let sharedBrowser = null;
let sharedOwned = false;
const contextStates = new Map();

function loadPlaywright() {
  try { return require('playwright'); } catch (e) {}
  try { return require('playwright-core'); } catch (e) {}
  throw new Error('browser backend requires Playwright; install it with: npm install --save-dev playwright && npx playwright install chromium');
}

async function getBrowser(options) {
  const opts = options || {};
  if (sharedBrowser) return sharedBrowser;
  const playwright = loadPlaywright();
  if (opts.cdp) {
    sharedBrowser = await playwright.chromium.connectOverCDP(opts.cdp);
    sharedOwned = false;
    return sharedBrowser;
  }
  sharedBrowser = await playwright.chromium.launch({ headless: opts.headless !== false });
  sharedOwned = true;
  return sharedBrowser;
}

function stateFor(context) {
  let state = contextStates.get(context);
  if (!state) {
    state = { owned: false, openPages: 0, closed: false };
    contextStates.set(context, state);
  }
  return state;
}

async function acquireContext(browser, opts) {
  const existing = typeof browser.contexts === 'function' ? browser.contexts() : [];
  for (const context of existing) {
    const state = contextStates.get(context);
    if (state && state.owned && !state.closed) return { context: context, state: state };
  }
  if (opts.reuseExistingContext === true && existing.length) {
    const context = existing[0];
    const state = stateFor(context);
    return { context: context, state: state };
  }
  const context = await browser.newContext({
    serviceWorkers: 'block',
    userAgent: DEFAULT_UA
  });
  const state = { owned: true, openPages: 0, closed: false };
  contextStates.set(context, state);
  return { context: context, state: state };
}

async function releasePage(context, state, page) {
  if (page) { try { await page.close(); } catch (e) {} }
  state.openPages = Math.max(0, state.openPages - 1);
  if (!state.owned || state.openPages > 0 || state.closed) return;
  state.closed = true;
  try { await context.close(); } catch (e) {}
  if (contextStates.get(context) === state) contextStates.delete(context);
}

async function guardWebSocketUrl(rawUrl, allowPrivate) {
  let target;
  try { target = new URL(String(rawUrl)); } catch (e) { return { ok: false, error: 'invalid_url' }; }
  if (target.protocol !== 'ws:' && target.protocol !== 'wss:') {
    return { ok: false, error: 'unsupported_protocol' };
  }
  const probe = (target.protocol === 'wss:' ? 'https:' : 'http:') + '//' +
    target.host + target.pathname + target.search;
  try {
    await prepareRequest(probe, { allowPrivate: allowPrivate === true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

async function routeGuard(route, allowPrivate) {
  const request = route.request();
  let target;
  try { target = new URL(request.url()); } catch (e) {
    await route.abort('blockedbyclient');
    return;
  }
  if (target.protocol === 'data:' || target.protocol === 'blob:' || target.protocol === 'about:') {
    await route.continue();
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    await route.abort('blockedbyclient');
    return;
  }
  try {
    await prepareRequest(target.href, { allowPrivate: allowPrivate === true });
  } catch (e) {
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
}

const ISOLATED_WORLD = 'ahttp';

// In an isolated world the engine cannot patch the page's fetch/XHR. This
// main-world probe only mirrors the number of live requests into a DOM
// attribute so settle keeps waiting for page-initiated work. It holds no
// secrets and cannot be used to read the engine.
const NET_PROBE_SRC = [
  '(function () {',
  '  if (window.__ahttpNetProbe) return;',
  '  window.__ahttpNetProbe = true;',
  '  var pending = 0;',
  '  function publish() {',
  '    try {',
  '      var root = document.documentElement;',
  '      if (!root) return;',
  '      if (pending > 0) root.setAttribute("data-ahttp-net", String(pending));',
  '      else root.removeAttribute("data-ahttp-net");',
  '    } catch (e) {}',
  '  }',
  '  function start() { pending++; publish(); }',
  '  function done() { pending = Math.max(0, pending - 1); publish(); }',
  '  try {',
  '    var originalFetch = window.fetch;',
  '    if (typeof originalFetch === "function") {',
  '      window.fetch = function () {',
  '        start();',
  '        var promise;',
  '        try { promise = originalFetch.apply(this, arguments); }',
  '        catch (e) { done(); throw e; }',
  '        if (promise && typeof promise.then === "function") promise.then(done, done);',
  '        else done();',
  '        return promise;',
  '      };',
  '    }',
  '  } catch (e) {}',
  '  try {',
  '    var proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;',
  '    if (proto && proto.send && !proto.__ahttpNetProbe) {',
  '      proto.__ahttpNetProbe = true;',
  '      var originalSend = proto.send;',
  '      proto.send = function () {',
  '        start();',
  '        var xhr = this;',
  '        var settled = false;',
  '        function finish() { if (settled) return; settled = true; done(); }',
  '        try { xhr.addEventListener("loadend", finish, { once: true }); } catch (e) {}',
  '        try { return originalSend.apply(this, arguments); }',
  '        catch (e) { finish(); throw e; }',
  '      };',
  '    }',
  '  } catch (e) {}',
  '})();'
].join('\n');

function errorText(details) {
  if (!details) return 'evaluation failed';
  const exception = details.exception;
  if (exception && exception.description) return String(exception.description).split('\n')[0];
  if (exception && exception.value != null) return String(exception.value);
  return String(details.text || 'evaluation failed');
}

function isContextLost(message) {
  return /Execution context was destroyed|Cannot find context|Inspected target navigated|Target closed|Session closed|Protocol error/i.test(String(message || ''));
}

function mergeSnapshots(main, extras, options) {
  const opts = options || {};
  const requested = opts.maxActions == null ? 0 : Math.max(0, parseInt(opts.maxActions, 10) || 0);
  const maxActions = requested > 0 ? requested : 60;
  const maxText = opts.includeText === false ? 0 : (opts.maxText == null ? 1400 : Math.max(0, parseInt(opts.maxText, 10) || 0));
  const frameActions = [];
  const regions = Object.assign({ modal: 0, main: 0, chrome: 0 }, main.regions || {});
  let forms = main.meta.forms || 0;
  let controls = main.meta.controls || 0;
  let nodes = main.meta.nodes || 0;
  let sanitized = main.meta.sanitized || 0;
  let ignored = main.meta.ignored || 0;
  let shadowRoots = main.meta.shadowRoots || 0;
  const text = (main.text || []).slice();
  let textChars = text.reduce(function (sum, line) { return sum + String(line).length; }, 0);

  for (const entry of extras) {
    const snap = entry.snap;
    for (const action of snap.actions) {
      const copy = Object.assign({}, action, {
        id: 'f' + entry.st.seq + ':' + action.id,
        frame: entry.st.seq
      });
      frameActions.push(copy);
      regions[copy.region] = (regions[copy.region] || 0) + 1;
    }
    forms += snap.meta.forms || 0;
    controls += snap.meta.controls || 0;
    nodes += snap.meta.nodes || 0;
    sanitized += snap.meta.sanitized || 0;
    ignored += snap.meta.ignored || 0;
    shadowRoots += snap.meta.shadowRoots || 0;
    for (const line of snap.text || []) {
      if (textChars + String(line).length > maxText) break;
      text.push(line);
      textChars += String(line).length;
    }
  }

  // Keep the page chrome and the payment/consent controls both visible: the
  // main document may fill the whole cap, so reserve up to half for frames.
  const frameBudget = Math.min(frameActions.length, Math.floor(maxActions * 0.5));
  const mainBudget = Math.max(0, maxActions - frameBudget);
  const actions = (main.actions || []).slice(0, mainBudget).concat(frameActions.slice(0, frameBudget));
  const total = (main.meta.actions || 0) + frameActions.length;
  const meta = Object.assign({}, main.meta, {
    actions: total,
    shown: actions.length,
    omitted: Math.max(0, total - actions.length),
    forms: forms,
    controls: controls,
    nodes: nodes,
    sanitized: sanitized,
    ignored: ignored,
    shadowRoots: shadowRoots,
    textLines: text.length,
    frames: extras.length,
    frameActions: frameActions.length,
    truncated: !!main.meta.truncated || total > actions.length
  });
  const json = Object.assign({}, main, { actions: actions, text: text, regions: regions, meta: meta });
  json.meta.chars = JSON.stringify(json).length;
  json.meta.tokens = Math.ceil(json.meta.chars / 4);
  return json;
}

function formatFrameActions(extras) {
  const lines = [];
  for (const entry of extras) {
    for (const action of entry.snap.actions) {
      const role = action.role ? action.role + ' ' : '';
      const label = action.label ? '"' + action.label + '"' : '';
      lines.push('f' + entry.st.seq + ':' + action.id + ' ' + action.kind + ' ' + role + label);
    }
  }
  return lines.join('\n');
}

async function createApi(page, context) {
  let session = null;
  let contextId = null;
  let isolated = false;
  let closed = false;
  let generation = 0;
  let probeGeneration = -1;

  if (context && typeof context.newCDPSession === 'function') {
    try {
      session = await context.newCDPSession(page);
      await session.send('Page.enable');
      await session.send('Runtime.enable');
      isolated = true;
    } catch (e) {
      session = null;
      isolated = false;
    }
  }

  const frameStates = new Map();
  const frameBySeq = new Map();
  let frameSeq = 0;
  let dialogPolicy = { action: 'dismiss', promptText: '' };
  let dialogLog = [];

  if (typeof page.on === 'function') {
    page.on('dialog', async function (dialog) {
      const entry = { type: 'dialog', message: '', accepted: false };
      try { entry.type = dialog.type(); } catch (e) {}
      try { entry.message = dialog.message(); } catch (e) {}
      try { entry.defaultValue = dialog.defaultValue ? dialog.defaultValue() : ''; } catch (e) {}
      try {
        if (dialogPolicy.action === 'accept') {
          await dialog.accept(dialogPolicy.promptText || undefined);
          entry.accepted = true;
        } else {
          await dialog.dismiss();
        }
      } catch (e) {
        entry.error = e && e.message ? e.message : String(e);
      }
      dialogLog.push(entry);
    });
  }

  function setDialogPolicy(payload) {
    const previous = dialogPolicy;
    if (payload && (payload.dialog === 'accept' || payload.dialog === 'dismiss')) {
      dialogPolicy = {
        action: payload.dialog,
        promptText: payload.promptText == null ? '' : String(payload.promptText)
      };
    }
    dialogLog = [];
    return function () { dialogPolicy = previous; };
  }

  if (typeof page.on === 'function') {
    page.on('framenavigated', function (frame) {
      try {
        if (frame === page.mainFrame()) {
          contextId = null;
          generation++;
          return;
        }
        const st = frameStates.get(frame);
        if (st) {
          st.contextId = null;
          st.probeReady = false;
        }
      } catch (e) {
        contextId = null;
        generation++;
      }
    });
    if (typeof page.on === 'function') {
      page.on('framedetached', function (frame) {
        const st = frameStates.get(frame);
        if (!st) return;
        st.detached = true;
        st.contextId = null;
        if (st.session) {
          try { st.session.detach(); } catch (e) {}
          st.session = null;
        }
      });
    }
  }

  function frameUrl(frame) {
    try { return frame.url() || ''; } catch (e) { return ''; }
  }

  function sameOrigin(a, b) {
    try { return new URL(a).origin === new URL(b).origin; } catch (e) { return false; }
  }

  // The main engine already reads same-origin iframes through contentDocument.
  // Only a frame whose origin differs from its parent is a separate document
  // that needs its own engine.
  function shouldScanFrame(frame) {
    const url = frameUrl(frame);
    if (!/^https?:/i.test(url)) return false;
    let parent = null;
    try { parent = frame.parentFrame(); } catch (e) { parent = null; }
    if (!parent) return false;
    return !sameOrigin(url, frameUrl(parent));
  }

  function frameState(frame) {
    let st = frameStates.get(frame);
    if (!st) {
      st = {
        frame: frame,
        seq: ++frameSeq,
        session: null,
        contextId: null,
        isolated: false,
        probeReady: false,
        detached: false
      };
      frameStates.set(frame, st);
      frameBySeq.set(st.seq, st);
    }
    return st;
  }

  async function ensureFrameWorld(st) {
    if (st.detached) throw new Error('frame detached');
    if (st.session == null) {
      try {
        st.session = await context.newCDPSession(st.frame);
        await st.session.send('Page.enable');
        await st.session.send('Runtime.enable');
      } catch (e) {
        st.session = null;
        st.isolated = false;
      }
    }
    if (st.session) {
      if (st.contextId == null) {
        const tree = await st.session.send('Page.getFrameTree');
        const root = tree.frameTree.frame;
        // An out-of-process frame has its own target, so the tree root is the
        // frame itself. A same-process child shares the page target and needs
        // a frame-id lookup, so fall back to the main-world path instead.
        if (root.url === frameUrl(st.frame)) {
          const world = await st.session.send('Page.createIsolatedWorld', {
            frameId: root.id,
            worldName: ISOLATED_WORLD,
            grantUniveralAccess: true
          });
          st.contextId = world.executionContextId;
          st.isolated = true;
          const res = await st.session.send('Runtime.evaluate', {
            expression: ENGINE_SRC,
            contextId: st.contextId,
            returnByValue: true,
            awaitPromise: true
          });
          if (res.exceptionDetails) throw new Error('frame engine injection failed: ' + errorText(res.exceptionDetails));
        } else {
          st.isolated = false;
        }
      } else {
        try {
          await st.session.send('Runtime.evaluate', { expression: '1', contextId: st.contextId, returnByValue: true });
        } catch (e) {
          st.contextId = null;
          return ensureFrameWorld(st);
        }
      }
    }
    if (!st.isolated) {
      const present = await st.frame.evaluate(() => !!(window.ahttp && window.ahttp.__ahttp === true)).catch(() => false);
      if (!present) {
        await st.frame.evaluate(() => { try { delete window.ahttp; } catch (e) { window.ahttp = undefined; } });
        await st.frame.evaluate('(function(){' + ENGINE_SRC + '\n})()');
      }
    }
    if (!st.probeReady) {
      try {
        await st.frame.evaluate(NET_PROBE_SRC);
        st.probeReady = true;
      } catch (e) {}
    }
  }

  async function evaluateMain(expression) {
    const res = await session.send('Runtime.evaluate', {
      expression: expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) throw new Error(errorText(res.exceptionDetails));
    return res.result ? res.result.value : undefined;
  }

  async function installProbe() {
    if (probeGeneration === generation) return;
    try {
      if (isolated) await evaluateMain(NET_PROBE_SRC);
      else await page.evaluate(NET_PROBE_SRC);
      probeGeneration = generation;
    } catch (e) {}
  }

  async function createWorld() {
    const tree = await session.send('Page.getFrameTree');
    const frameId = tree.frameTree.frame.id;
    const world = await session.send('Page.createIsolatedWorld', {
      frameId: frameId,
      worldName: ISOLATED_WORLD,
      grantUniveralAccess: true
    });
    contextId = world.executionContextId;
    let prelude = '';
    try {
      const raw = await evaluateMain('(function(){try{return JSON.stringify(globalThis.__AHTTP_CONFIG__||null);}catch(e){return "null";}})()');
      if (raw && raw !== 'null') prelude = 'globalThis.__AHTTP_CONFIG__=' + raw + ';\n';
    } catch (e) {}
    const res = await session.send('Runtime.evaluate', {
      expression: prelude + ENGINE_SRC,
      contextId: contextId,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) throw new Error('engine injection failed: ' + errorText(res.exceptionDetails));
  }

  async function ensureInjected() {
    if (closed) throw new Error('page is closed');
    await installProbe();
    if (isolated) {
      if (contextId == null) return createWorld();
      try {
        await session.send('Runtime.evaluate', { expression: '1', contextId: contextId, returnByValue: true });
      } catch (e) {
        contextId = null;
        return createWorld();
      }
      return;
    }
    const present = await page.evaluate(() => !!(window.ahttp && window.ahttp.__ahttp === true));
    if (!present) {
      await page.evaluate(() => { try { delete window.ahttp; } catch (e) { window.ahttp = undefined; } });
      // page.evaluate goes through CDP Runtime.evaluate, so a strict CSP that
      // blocks an injected <script> tag no longer stops the engine.
      await page.evaluate('(function(){' + ENGINE_SRC + '\n})()');
    }
  }

  function callExpression(fn, args) {
    return '(function(){var a=' + JSON.stringify(args === undefined ? [] : args) + ';' +
      'return Promise.resolve((' + fn.toString() + ')(a)).then(function(r){return JSON.stringify(r===undefined?null:r);});})()';
  }

  async function evaluateIn(sessionRef, contextRef, fn, args, userGesture) {
    let res;
    try {
      res = await sessionRef.send('Runtime.evaluate', {
        expression: callExpression(fn, args),
        contextId: contextRef,
        returnByValue: true,
        awaitPromise: true,
        userGesture: userGesture === true
      });
    } catch (e) {
      const err = new Error(e && e.message ? e.message : String(e));
      err.ahttpContextLost = isContextLost(err.message);
      throw err;
    }
    if (res.exceptionDetails) {
      const err = new Error(errorText(res.exceptionDetails));
      err.ahttpContextLost = isContextLost(err.message);
      throw err;
    }
    const value = res.result ? res.result.value : undefined;
    if (value == null) return null;
    try { return JSON.parse(value); } catch (e) { return value; }
  }

  async function call(fn, args, options) {
    const opts = options || {};
    if (!isolated && opts.secret === true) {
      return { ok: false, locked: true, error: 'isolated_world_unavailable' };
    }
    await ensureInjected();
    if (!isolated) return page.evaluate(fn, args);
    return evaluateIn(session, contextId, fn, args, opts.userGesture);
  }

  async function frameCall(st, fn, args, options) {
    await ensureFrameWorld(st);
    if (!st.isolated) return st.frame.evaluate(fn, args);
    return evaluateIn(st.session, st.contextId, fn, args, options && options.userGesture);
  }

  async function lazyScroll() {
    try {
      await page.evaluate(async function () {
        var step = Math.max(240, Math.floor(window.innerHeight * 0.8));
        var height = Math.min(document.documentElement ? document.documentElement.scrollHeight : 0, 30000);
        for (var y = 0; y < height; y += step) {
          window.scrollTo(0, y);
          await new Promise(function (resolve) { setTimeout(resolve, 50); });
        }
        window.scrollTo(0, 0);
      });
    } catch (e) {}
  }

  async function frameSnapshots(options) {
    const opts = options || {};
    const out = [];
    let frames = [];
    try { frames = page.frames(); } catch (e) { frames = []; }
    const perFrame = Math.max(10, Math.min(40, opts.maxActions == null ? 40 : opts.maxActions));
    for (const frame of frames) {
      if (frame === page.mainFrame()) continue;
      if (!shouldScanFrame(frame)) continue;
      const st = frameState(frame);
      if (st.detached) continue;
      const frameOpts = {
        format: 'json',
        maxActions: perFrame,
        maxText: 300,
        includeText: opts.includeText !== false,
        force: true
      };
      if (opts.query) frameOpts.query = opts.query;
      if (opts.interactiveOnly) frameOpts.interactiveOnly = true;
      try {
        const snap = await frameCall(st, (a) => window.ahttp.snapshot(a[0]), [frameOpts]);
        if (snap && Array.isArray(snap.actions) && snap.actions.length) out.push({ st: st, snap: snap });
      } catch (e) {
        // A frame can navigate or detach between the scan and the call.
      }
    }
    return out;
  }

  async function setFilesOn(st, rawId, files, options) {
    const opts = options || {};
    const useFrame = !!st;
    if (useFrame) await ensureFrameWorld(st);
    else await ensureInjected();
    const sessionRef = useFrame ? st.session : session;
    const contextRef = useFrame
      ? (st.isolated ? st.contextId : null)
      : (isolated ? contextId : null);
    if (sessionRef && contextRef) {
      let res;
      try {
        res = await sessionRef.send('Runtime.evaluate', {
          expression: 'window.ahttp.element(' + JSON.stringify(String(rawId)) + ')',
          contextId: contextRef,
          returnByValue: false
        });
      } catch (e) {
        const err = new Error(e && e.message ? e.message : String(e));
        err.ahttpContextLost = isContextLost(err.message);
        throw err;
      }
      if (res.exceptionDetails) throw new Error(errorText(res.exceptionDetails));
      const objectId = res.result && res.result.objectId;
      if (!objectId) return { ok: false, status: 'error', error: 'file_input_not_found' };
      try { await sessionRef.send('DOM.enable'); } catch (e) {}
      const described = await sessionRef.send('DOM.describeNode', { objectId: objectId });
      const backendNodeId = described.node && described.node.backendNodeId;
      if (!backendNodeId) return { ok: false, status: 'error', error: 'file_input_not_found' };
      await sessionRef.send('DOM.setFileInputFiles', { files: files, backendNodeId: backendNodeId });
      if (opts.settle !== false) {
        try { await page.waitForTimeout(120); } catch (e) {}
      }
      return { ok: true, status: 'ok', method: 'setInputFiles', action: { id: rawId } };
    }
    const frame = useFrame ? st.frame : page.mainFrame();
    const handle = await frame.evaluateHandle((a) => window.ahttp.element(a[0]), [String(rawId)]);
    const element = handle && handle.asElement ? handle.asElement() : null;
    if (!element) return { ok: false, status: 'error', error: 'file_input_not_found' };
    await element.setInputFiles(files);
    if (opts.settle !== false) {
      try { await page.waitForTimeout(120); } catch (e) {}
    }
    return { ok: true, status: 'ok', method: 'setInputFiles', action: { id: rawId } };
  }

  // A navigation destroys the isolated world, so the engine trace alone
  // cannot span pages. The backend keeps the portable steps it has seen.
  const traceSteps = [];
  const TRACE_LIMIT = 200;
  function pushTraceStep(step) {
    if (!step || !step.action) return;
    const copy = Object.assign({}, step, { seq: traceSteps.length + 1 });
    traceSteps.push(copy);
    if (traceSteps.length > TRACE_LIMIT) traceSteps.shift();
  }

  function replayPayload(step, index, options) {
    const src = (step && step.payload) || {};
    const out = {};
    if (src.redacted === true) {
      let supplied = null;
      if (options && options.values && options.values[index] != null) supplied = options.values[index];
      else if (step && step.value != null) supplied = step.value;
      if (supplied == null) return { needsValue: true, payload: out };
      out.value = String(supplied);
    } else if (src.value != null) {
      out.value = String(src.value);
    }
    if (src.checked != null) out.checked = src.checked === true;
    if (src.key) out.key = String(src.key);
    if (src.hover === true) out.hover = true;
    if (src.scroll === true) out.scroll = true;
    if (src.dialog === 'accept' || src.dialog === 'dismiss') out.dialog = src.dialog;
    if (src.promptText != null) out.promptText = String(src.promptText);
    return { needsValue: false, payload: out };
  }

  // Replay is orchestrated here, not inside the page, because a navigating
  // step destroys the isolated world that holds the loop.
  async function replayTrace(steps, options) {
    const o = options || {};
    const list = Array.isArray(steps) ? steps : (steps && Array.isArray(steps.steps) ? steps.steps : []);
    const rows = [];
    for (let i = 0; i < list.length; i++) {
      const step = list[i] || {};
      const fp = step.action || step.fingerprint || step;
      const built = replayPayload(step, i, o);
      if (built.needsValue) {
        rows.push({ index: i, ok: false, status: 'needs_value', label: fp.label || null });
        if (o.continueOnError !== true) break;
        continue;
      }
      if (o.requireSameUrl === true && step.url && page.url() && step.url !== page.url()) {
        rows.push({ index: i, ok: false, status: 'url_mismatch', expected: step.url, actual: page.url() });
        if (o.continueOnError !== true) break;
        continue;
      }
      let match = null;
      try {
        match = await call((a) => window.ahttp.match(a[0]), [fp]);
      } catch (e) {
        // A previous step may have navigated while the world was being rebuilt.
        match = await call((a) => window.ahttp.match(a[0]), [fp]).catch(() => null);
      }
      if (!match || match.status !== 'ok') {
        rows.push({
          index: i,
          ok: false,
          status: match ? match.status : 'error',
          label: fp.label || null,
          score: match ? match.bestScore : 0,
          candidates: match ? match.candidates : []
        });
        if (o.continueOnError !== true) break;
        continue;
      }
      const row = {
        index: i,
        id: match.id,
        label: match.label,
        kind: match.kind,
        score: match.score,
        signals: match.signals,
        urlDrift: !!(step.url && page.url() && step.url !== page.url())
      };
      if (o.dryRun === true) {
        row.ok = true;
        row.status = 'would_run';
        rows.push(row);
        continue;
      }
      try {
        const res = await api.act(match.id, built.payload, {
          settle: o.settle,
          timeout: o.timeout,
          snapshot: false,
          diff: o.diff === true,
          record: false,
          confirm: o.confirm === true || step.confirmed === true
        });
        row.ok = !!(res && res.ok);
        row.status = row.ok ? 'ok' : (res && res.status ? res.status : 'failed');
        if (res && res.error) row.error = res.error;
        if (res && res.requiresConfirmation) row.requiresConfirmation = true;
        if (res && res.diff) row.diff = res.diff;
      } catch (e) {
        row.ok = false;
        row.status = 'error';
        row.error = String(e && e.message ? e.message : e);
      }
      rows.push(row);
      if (!row.ok && o.continueOnError !== true) break;
    }
    const okCount = rows.filter(function (r) { return r.ok; }).length;
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

  const api = {
    isolated: isolated,
    async wake() { return call(() => window.ahttp.wake()); },
    async sleep() { return call(() => window.ahttp.sleep()); },
    async status() { return call(() => window.ahttp.status()); },
    async snapshot(options) {
      const opts = options || {};
      if (opts.lazy === true) await lazyScroll();
      const textMode = opts.format === 'text';
      const main = await call((a) => window.ahttp.snapshot(a[0]), [opts]);
      if (textMode) {
        if (typeof main !== 'string') return main;
        let extras = [];
        try { extras = await frameSnapshots(opts); } catch (e) { extras = []; }
        if (!extras.length) return main;
        return main + '\n\n[frame actions]\n' + formatFrameActions(extras);
      }
      if (!main || main.locked) return main;
      let extras = [];
      try { extras = await frameSnapshots(opts); } catch (e) { extras = []; }
      if (!extras.length) return main;
      return mergeSnapshots(main, extras, opts);
    },
    async act(id, payload, options) {
      const restore = setDialogPolicy(payload);
      const isFrame = /^f\d+:/.test(String(id == null ? '' : id));
      let descriptor = null;
      if (!isFrame && !(payload && payload.read === true)) {
        try {
          descriptor = await call((a) => window.ahttp.describe(a[0], a[1]), [id, payload]);
        } catch (e) {
          descriptor = null;
        }
      }
      try {
        const result = await this.actInner(id, payload, options);
        const record = !(options && options.record === false);
        if (record && result && result.traceStep) pushTraceStep(result.traceStep);
        else if (record && descriptor && result && (result.ok || result.navigated)) pushTraceStep(descriptor);
        if (dialogLog.length && result && typeof result === 'object') result.dialogs = dialogLog.slice();
        return result;
      } finally {
        restore();
      }
    },
    async actInner(id, payload, options) {
      const frameMatch = /^f(\d+):(.+)$/.exec(String(id == null ? '' : id));
      if (frameMatch) {
        const st = frameBySeq.get(Number(frameMatch[1]));
        if (!st || st.detached) return { ok: false, status: 'error', error: 'frame_not_found' };
        if (payload && Array.isArray(payload.files) && payload.files.length) {
          return setFilesOn(st, frameMatch[2], payload.files, options);
        }
        const before = frameUrl(st.frame);
        try {
          const res = await frameCall(st, (a) => window.ahttp.act(a[0], a[1], a[2]), [frameMatch[2], payload, options], { userGesture: true });
          if (res && res.action && res.action.id) res.action.id = id;
          return res;
        } catch (e) {
          if (e && e.ahttpContextLost) {
            const deadline = Date.now() + 3000;
            let now = frameUrl(st.frame);
            while (now === before && Date.now() < deadline) {
              try { await page.waitForTimeout(50); } catch (err) { break; }
              now = frameUrl(st.frame);
            }
            if (now !== before) {
              return { ok: true, status: 'ok', navigated: true, method: 'navigation', href: now };
            }
          }
          throw e;
        }
      }
      if (payload && Array.isArray(payload.files) && payload.files.length) {
        return setFilesOn(null, id, payload.files, options);
      }
      const before = page.url();
      try {
        return await call((a) => window.ahttp.act(a[0], a[1], a[2]), [id, payload, options], { userGesture: true });
      } catch (e) {
        if (e && e.ahttpContextLost) {
          // The click navigated and destroyed the isolated world before the
          // result came back. The action itself succeeded; report the new URL
          // instead of a fake failure.
          const deadline = Date.now() + 3000;
          let now = page.url();
          while (now === before && Date.now() < deadline) {
            try { await page.waitForTimeout(50); } catch (err) { break; }
            now = page.url();
          }
          if (now !== before) {
            return { ok: true, status: 'ok', navigated: true, method: 'navigation', href: now };
          }
        }
        throw e;
      }
    },
    async unlock(key) { return call((a) => window.ahttp.unlock(a[0]), [key]); },
    async trace() {
      let title = '';
      try { title = await page.title(); } catch (e) {}
      return {
        version: require('../package.json').version,
        url: page.url(),
        title: title,
        steps: traceSteps.slice(),
        dropped: 0,
        limit: TRACE_LIMIT
      };
    },
    async clearTrace() {
      traceSteps.length = 0;
      try { return await call(() => window.ahttp.clearTrace()); } catch (e) { return { ok: true, steps: 0 }; }
    },
    async importTrace(steps) {
      (Array.isArray(steps) ? steps : []).forEach(pushTraceStep);
      return { ok: true, steps: traceSteps.length };
    },
    async replay(steps, options) { return replayTrace(steps, options); },
    async authorize(options) {
      return call((a) => window.ahttp.authorize(a[0]), [options], { secret: true });
    },
    async hashKey(key) { return call((a) => window.ahttp.hashKey(a[0]), [key]); },
    async detach() {
      closed = true;
      if (session) {
        try { await session.detach(); } catch (e) {}
        session = null;
      }
    }
  };
  return api;
}

async function openBrowserPage(url, options) {
  const opts = options || {};
  const allowPrivate = opts.allowPrivate === true || process.env.AHTTP_ALLOW_PRIVATE === '1';
  let prepared;
  try {
    prepared = await prepareRequest(url, { allowPrivate: allowPrivate });
  } catch (e) {
    throw new Error(redactUrl(url) + ': ' + (e && e.message ? e.message : String(e)));
  }
  if (opts.signal && opts.signal.aborted) throw new Error('cancelled');
  const browser = opts.browser || await getBrowser(opts);
  const acquired = await acquireContext(browser, opts);
  const context = acquired.context;
  const state = acquired.state;
  state.openPages += 1;
  let page;
  try {
    page = await context.newPage();
  } catch (e) {
    await releasePage(context, state, null);
    throw e;
  }
  let api = null;
  let released = false;
  const release = async function () {
    if (released) return;
    released = true;
    if (api) await api.detach();
    await releasePage(context, state, page);
  };
  await page.route('**/*', (route) => routeGuard(route, allowPrivate));
  if (typeof page.routeWebSocket === 'function') {
    try {
      await page.routeWebSocket(/.*/, async (ws) => {
        let raw = '';
        try { raw = ws.url(); } catch (e) { raw = ''; }
        const verdict = await guardWebSocketUrl(raw, allowPrivate);
        if (!verdict.ok) {
          try { await ws.close({ code: 1008, reason: 'blocked' }); } catch (e) {}
          return;
        }
        try { ws.connectToServer(); } catch (e) {
          try { await ws.close({ code: 1011, reason: 'connect failed' }); } catch (err) {}
        }
      });
    } catch (e) {}
  }
  page.setDefaultTimeout(opts.timeout || 30000);
  const startedAt = Date.now();
  let response;
  try {
    response = await page.goto(prepared.url.href, { waitUntil: 'domcontentloaded', timeout: opts.timeout || 30000 });
  } catch (e) {
    await release();
    throw new Error('browser navigation failed: ' + (e && e.message ? e.message : String(e)));
  }
  if (opts.signal && opts.signal.aborted) {
    await release();
    throw new Error('cancelled');
  }
  api = await createApi(page, context);
  let raw = '';
  try { raw = response ? await response.text() : await page.content(); } catch (e) { raw = await page.content(); }
  const result = {
    api: api,
    win: null,
    page: page,
    context: context,
    browser: browser,
    url: page.url(),
    status: response ? response.status() : 0,
    raw: raw,
    rawBytes: Buffer.byteLength(raw, 'utf8'),
    headers: response ? response.headers() : {},
    fetchMs: Date.now() - startedAt,
    close: release
  };
  return result;
}

async function closeBrowser() {
  if (!sharedBrowser) return;
  if (sharedOwned) {
    try { await sharedBrowser.close(); } catch (e) {}
  }
  sharedBrowser = null;
  sharedOwned = false;
  contextStates.clear();
}

module.exports = {
  ENGINE_SRC,
  DEFAULT_UA,
  guardWebSocketUrl,
  openBrowserPage,
  closeBrowser
};
