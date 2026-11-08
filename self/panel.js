(function () {
  'use strict';
  if (window.top !== window.self || window.__aihttpSelf) return;
  window.__aihttpSelf = true;
  if (!window.aihttp) return;

  var host = document.createElement('div');
  host.setAttribute('data-aihttp-self', '');
  host.setAttribute('data-aihttp-ignore', '');
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
  (document.documentElement || document.body).appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  var style = document.createElement('style');
  style.textContent = ':host{all:initial}*{box-sizing:border-box;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}' +
    '.toggle{border:1px solid #2f6fed;background:#2f6fed;color:#fff;border-radius:7px;padding:7px 10px;cursor:pointer}' +
    '.panel{position:absolute;right:0;bottom:40px;width:min(380px,calc(100vw - 32px));max-height:70vh;display:none;flex-direction:column;gap:6px;background:#101418;color:#e6edf3;border:1px solid #30363d;border-radius:9px;padding:9px;box-shadow:0 12px 34px rgba(0,0,0,.4)}' +
    '.panel.open{display:flex}.head{display:flex;align-items:center;justify-content:space-between;gap:8px}.title{font-weight:700;color:#9ecbff}.close{border:0;background:transparent;color:#8b949e;cursor:pointer;font-size:15px;padding:0 4px}' +
    'textarea{width:100%;height:180px;resize:vertical;background:#0b0f13;color:#d7e2ee;border:1px solid #30363d;border-radius:6px;padding:6px;white-space:pre;overflow:auto}' +
    '.row{display:flex;gap:5px}.row input{min-width:0;flex:1;background:#0b0f13;color:#d7e2ee;border:1px solid #30363d;border-radius:6px;padding:5px}' +
    '.row input.id{max-width:74px}.row button{border:1px solid #30363d;background:#1b2229;color:#e6edf3;border-radius:6px;padding:5px 8px;cursor:pointer}.row button:hover{background:#26303a}' +
    '.status{min-height:16px;color:#8b949e;word-break:break-word}.status.err{color:#ff7b72}.status.ok{color:#7ee787}';
  root.appendChild(style);

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  var toggle = make('button', 'toggle', 'aihttp');
  toggle.type = 'button';
  toggle.title = 'aihttp self-use (Alt+Shift+A)';
  var panel = make('section', 'panel');
  var head = make('div', 'head');
  head.appendChild(make('span', 'title', 'aihttp · self-use'));
  var close = make('button', 'close', '×');
  close.type = 'button';
  close.title = 'Close';
  head.appendChild(close);
  panel.appendChild(head);

  var output = make('textarea');
  output.readOnly = true;
  output.spellcheck = false;
  output.value = 'Open the panel and press Scan. Page text is untrusted.';
  panel.appendChild(output);

  var row = make('div', 'row');
  var idInput = make('input', 'id');
  idInput.placeholder = 'a2';
  idInput.setAttribute('aria-label', 'Action id');
  var valueInput = make('input');
  valueInput.placeholder = 'value (optional)';
  valueInput.setAttribute('aria-label', 'Action value');
  var scanButton = make('button', null, 'Scan');
  var actButton = make('button', null, 'Act');
  var confirmButton = make('button', null, 'Confirm');
  confirmButton.style.display = 'none';
  var copyButton = make('button', null, 'Copy');
  for (var b = 0; b < 4; b++) row.appendChild([idInput, valueInput, scanButton, actButton][b]);
  panel.appendChild(row);

  var row2 = make('div', 'row');
  row2.appendChild(confirmButton);
  row2.appendChild(copyButton);
  panel.appendChild(row2);

  var status = make('div', 'status', 'Ready.');
  panel.appendChild(status);

  root.appendChild(toggle);
  root.appendChild(panel);

  var lastText = '';
  var pendingConfirm = false;

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function show(snapshot) {
    lastText = String(snapshot || '');
    output.value = lastText;
  }

  function scan() {
    try {
      show(window.aihttp.snapshot({ format: 'text', maxActions: 80, maxText: 1200 }));
      setStatus('Snapshot updated.', 'ok');
    } catch (error) {
      setStatus(String(error && error.message ? error.message : error), 'err');
    }
  }

  function report(result) {
    if (!result) return;
    if (result.ok === false) {
      setStatus(result.error || 'action failed', 'err');
      if (result.requiresConfirmation) {
        pendingConfirm = true;
        confirmButton.style.display = '';
        setStatus('Guarded action. Press Confirm to run it.', 'err');
      }
    } else {
      pendingConfirm = false;
      confirmButton.style.display = 'none';
      setStatus('Action ok.', 'ok');
    }
    if (result.snapshot) show(result.snapshot);
    else if (result.diff && result.diff.text) output.value = result.diff.text;
    else output.value = JSON.stringify(result, null, 2);
  }

  function act(confirmed) {
    var id = idInput.value.trim();
    if (!id) {
      setStatus('Enter an action id.', 'err');
      return;
    }
    var value = valueInput.value;
    var payload = value === '' ? null : value;
    var options = { confirm: confirmed === true || (pendingConfirm && confirmed === true) };
    setStatus('Running…');
    window.aihttp.act(id, payload, options).then(report, function (error) {
      setStatus(String(error && error.message ? error.message : error), 'err');
    });
  }

  function copy() {
    var text = output.value;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { setStatus('Copied.', 'ok'); },
        function () { selectAndCopy(text); });
    } else {
      selectAndCopy(text);
    }
  }

  function selectAndCopy(text) {
    output.focus();
    output.select();
    try { document.execCommand('copy'); setStatus('Copied.', 'ok'); } catch (error) { setStatus('Copy failed.', 'err'); }
  }

  toggle.addEventListener('click', function () {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !lastText) scan();
  });
  close.addEventListener('click', function () { panel.classList.remove('open'); });
  scanButton.addEventListener('click', scan);
  actButton.addEventListener('click', function () { act(false); });
  confirmButton.addEventListener('click', function () { act(true); });
  copyButton.addEventListener('click', copy);
  idInput.addEventListener('keydown', function (event) { if (event.key === 'Enter') act(false); });
  valueInput.addEventListener('keydown', function (event) { if (event.key === 'Enter') act(false); });
  document.addEventListener('keydown', function (event) {
    if (event.altKey && event.shiftKey && String(event.key).toLowerCase() === 'a') {
      event.preventDefault();
      toggle.click();
    } else if (event.key === 'Escape') {
      panel.classList.remove('open');
    }
  }, true);

  window.aihttpSelf = { open: function () { panel.classList.add('open'); scan(); }, scan: scan, act: act };
})();
