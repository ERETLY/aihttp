'use strict';

const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { tokenCount } = require('./lib/real');

const ENGINE = path.join(__dirname, '..', 'aihttp.js');

function taskPlans() {
  const plans = [];
  for (let n = 1; n <= 4; n++) {
    plans.push({ name: 'click-chain-' + n, steps: Array.from({ length: n }, () => ({ action: 'next' })) });
  }
  for (let n = 1; n <= 4; n++) {
    plans.push({ name: 'search-' + n, steps: [{ action: 'fill', value: 'query-' + n }, { action: 'search' }] });
  }
  for (let n = 1; n <= 4; n++) {
    const steps = [{ action: 'open_modal' }, { action: 'confirm' }];
    for (let i = 1; i < n; i++) steps.push({ action: 'next' });
    plans.push({ name: 'modal-' + n, steps: steps });
  }
  for (let n = 1; n <= 4; n++) {
    plans.push({ name: 'select-' + n, steps: [{ action: 'select', value: n % 2 ? 'pro' : 'basic' }, { action: 'buy' }] });
  }
  for (let n = 1; n <= 4; n++) {
    const steps = [{ action: 'page2' }];
    for (let i = 0; i < n; i++) steps.push({ action: 'item' });
    plans.push({ name: 'pagination-' + n, steps: steps });
  }
  return plans;
}

const TASKS = taskPlans();

function pageHtml(taskId, plan) {
  return '<!doctype html><html><head><title>Task ' + taskId + '</title></head><body>' +
    '<main><h1>Task ' + taskId + '</h1>' +
    '<button data-aihttp-intent="next">Next</button>' +
    '<label for="q">Search</label><input id="q" name="q">' +
    '<button data-aihttp-intent="search">Search</button>' +
    '<button data-aihttp-intent="open_modal">Open modal</button>' +
    '<div id="modal" hidden><p>Confirm?</p><button data-aihttp-intent="confirm">Confirm</button></div>' +
    '<label for="plan">Plan</label><select id="plan" name="plan"><option value="basic">Basic</option><option value="pro">Pro</option></select>' +
    '<button data-aihttp-intent="buy">Buy</button>' +
    '<button data-aihttp-intent="page2">Page 2</button>' +
    '<div id="page2" hidden><button data-aihttp-intent="item">Item</button></div>' +
    '<p id="status">idle</p>' +
    '</main><script>window.__taskPlan=' + JSON.stringify(plan.steps) + ';' +
    'window.__taskIndex=0;window.__taskDone=false;' +
    'function advance(action,value){if(window.__taskDone)return;var s=window.__taskPlan[window.__taskIndex];' +
    'if(!s||s.action!==action||(s.value!=null&&String(value)!==String(s.value)))return;' +
    'window.__taskIndex++;if(window.__taskIndex>=window.__taskPlan.length){window.__taskDone=true;' +
    'document.getElementById("status").textContent="done";}}' +
    'document.addEventListener("click",function(e){var el=e.target.closest("[data-aihttp-intent]");if(!el)return;' +
    'var i=el.getAttribute("data-aihttp-intent");if(i==="open_modal")document.getElementById("modal").hidden=false;' +
    'if(i==="page2")document.getElementById("page2").hidden=false;advance(i);});' +
    'document.addEventListener("input",function(e){if(e.target.name==="q")advance("fill",e.target.value);});' +
    'document.addEventListener("change",function(e){if(e.target.name==="plan")advance("select",e.target.value);});' +
    '</script></body></html>';
}

function listen() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      const id = Math.max(1, Math.min(TASKS.length, parseInt(parsed.searchParams.get('task') || '1', 10) || 1));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageHtml(id, TASKS[id - 1]));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' }));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function runTaskBenchmark(options) {
  const opts = options || {};
  const enginePath = opts.enginePath || ENGINE;
  const local = await listen();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const results = [];
  try {
    for (let taskIndex = 0; taskIndex < TASKS.length; taskIndex++) {
      const task = TASKS[taskIndex];
      await page.goto(local.url + '?task=' + (taskIndex + 1), { waitUntil: 'domcontentloaded' });
      const engineScript = await page.addScriptTag({ path: enginePath });
      await engineScript.evaluate((element) => element.remove());
      const aihttpSteps = [];
      const rawSteps = [];
      const axSteps = [];
      const latencies = [];
      let failed = null;
      for (let stepIndex = 0; stepIndex < task.steps.length; stepIndex++) {
        const step = task.steps[stepIndex];
        const snapshot = await page.evaluate(() => window.aihttp.snapshot({ format: 'json', maxActions: 60, maxText: 900 }));
        let action = null;
        if (step.action === 'fill') action = snapshot.actions.find((entry) => entry.name === 'q');
        else if (step.action === 'select') action = snapshot.actions.find((entry) => entry.name === 'plan');
        else action = snapshot.actions.find((entry) => entry.intent === step.action);
        if (!action) {
          failed = 'action not found: ' + step.action;
          break;
        }
        const started = process.hrtime.bigint();
        const outcome = await page.evaluate((args) => window.aihttp.act(args[0], args[1], { settle: false, snapshot: false }), [
          action.id,
          step.action === 'fill' || step.action === 'select' ? { value: step.value } : null
        ]);
        latencies.push(Number(process.hrtime.bigint() - started) / 1e6);
        if (!outcome || outcome.ok !== true) {
          failed = 'action failed: ' + step.action + ' (' + (outcome && outcome.error ? outcome.error : 'unknown') + ')';
          break;
        }
        const text = await page.evaluate(() => window.aihttp.snapshot({ format: 'text', maxActions: 60, maxText: 900 }));
        aihttpSteps.push(tokenCount(text));
        rawSteps.push(tokenCount(await page.content()));
        axSteps.push(tokenCount(await page.ariaSnapshot()));
      }
      const done = await page.evaluate(() => !!window.__taskDone);
      const success = done && !failed;
      results.push({
        id: taskIndex + 1,
        name: task.name,
        steps: task.steps.length,
        completedSteps: aihttpSteps.length,
        success: success,
        error: failed,
        aihttpTokens: aihttpSteps.reduce((sum, value) => sum + value, 0),
        rawTokens: rawSteps.reduce((sum, value) => sum + value, 0),
        axTokens: axSteps.reduce((sum, value) => sum + value, 0),
        aihttpStepTokens: aihttpSteps,
        rawStepTokens: rawSteps,
        axStepTokens: axSteps,
        avgLatencyMs: latencies.length ? Math.round((latencies.reduce((sum, value) => sum + value, 0) / latencies.length) * 100) / 100 : 0
      });
    }
  } finally {
    await context.close();
    await browser.close();
    await close(local.server);
  }
  const passed = results.filter((task) => task.success).length;
  const aihttpTokens = results.reduce((sum, task) => sum + task.aihttpTokens, 0);
  const rawTokens = results.reduce((sum, task) => sum + task.rawTokens, 0);
  const axTokens = results.reduce((sum, task) => sum + task.axTokens, 0);
  return {
    methodology: 'Scripted agent, not an LLM. Twenty local tasks are driven in Chromium with aihttp action ids. Raw HTML and Playwright ariaSnapshot are sampled after each step as observation-only baselines. Token counts use gpt-tokenizer 4.1.0 countTokens (o200k_base).',
    tasks: results.length,
    aihttpSuccess: passed,
    aihttpSuccessRate: results.length ? Math.round((passed / results.length) * 1000) / 10 : 0,
    staticSuccess: 0,
    aihttpTokens: aihttpTokens,
    rawTokens: rawTokens,
    axTokens: axTokens,
    rawToAihttp: aihttpTokens ? Math.round((rawTokens / aihttpTokens) * 10) / 10 : 0,
    axToAihttp: aihttpTokens ? Math.round((axTokens / aihttpTokens) * 10) / 10 : 0,
    results: results
  };
}

module.exports = { runTaskBenchmark, TASKS };
