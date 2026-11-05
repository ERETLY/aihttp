#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RESULTS = path.join(ROOT, 'benchmark', 'results.json');
const SELF_RESULTS = path.join(ROOT, 'benchmark', 'self-results.json');
const TIME_RESULTS = path.join(ROOT, 'benchmark', 'time-results.json');
const README = path.join(ROOT, 'README.md');
const START = '<!-- BENCH:START -->';
const END = '<!-- BENCH:END -->';

function load() {
  return JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
}

function loadSelf() {
  if (!fs.existsSync(SELF_RESULTS)) return null;
  return JSON.parse(fs.readFileSync(SELF_RESULTS, 'utf8'));
}

function loadTime() {
  if (!fs.existsSync(TIME_RESULTS)) return null;
  return JSON.parse(fs.readFileSync(TIME_RESULTS, 'utf8'));
}

// Headers that start with ':' are right-aligned (the colon is dropped).
function table(headers, rows) {
  const lines = [];
  lines.push('| ' + headers.map((header) => header.replace(/^:/, '')).join(' | ') + ' |');
  lines.push('|' + headers.map((header) => header.indexOf(':') === 0 ? '---:' : '---').join('|') + '|');
  for (const row of rows) lines.push('| ' + row.join(' | ') + ' |');
  return lines.join('\n');
}

function num(value) {
  return Number(value).toLocaleString('en-US');
}

function ms(value) {
  return num(Math.round(value)) + ' ms';
}

function ms1(value) {
  return Number(value).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' ms';
}

function shortSite(name) {
  if (/^Hacker News/.test(name)) return 'Hacker News';
  if (/^Wikipedia/.test(name)) return 'Wikipedia';
  if (/^Lobsters/.test(name)) return 'Lobsters';
  if (/^GitHub/.test(name)) return 'GitHub';
  if (/^MDN/.test(name)) return 'MDN';
  return name;
}

function selfPage(self, site) {
  if (!self || !self.pages) return null;
  return self.pages.find((page) => shortSite(page.name) === shortSite(site.name)) || null;
}

function tokenTable(web, byKey, tasks, self) {
  const headers = ['Method', 'What you get', 'Can act', 'Checkout (5 steps)'];
  for (const site of web) headers.push(shortSite(site.name));
  headers.push('Total');
  if (tasks) headers.push('20 tasks');
  const defs = [
    ['Raw HTML', 'raw', 'serialized DOM', false],
    ['Markdown', 'markdown', 'Readability + Turndown', false],
    ['Jina Reader', 'jina', 'hosted Markdown', false],
    ['Firecrawl', 'firecrawl', 'hosted Markdown', false],
    ['Accessibility tree', 'axtree', 'roles and names', false],
    ['ahttp', 'ahttp', 'actions, text, ids', true]
  ];
  const rows = [];
  for (const def of defs) {
    const method = byKey[def[1]];
    if (def[1] === 'jina' || def[1] === 'firecrawl') {
      if (!web.some((site) => site[def[1] + 'Tokens'] != null)) continue;
    } else if (!method) {
      continue;
    }
    const row = [def[0], def[2], def[3] ? 'yes' : 'no', method ? num(method.totalTokens) : 'n/a'];
    let total = method ? method.totalTokens : 0;
    for (const site of web) {
      const value = def[1] === 'raw' ? site.rawTokens
        : def[1] === 'markdown' ? site.markdownTokens
        : def[1] === 'jina' ? site.jinaTokens
        : def[1] === 'firecrawl' ? site.firecrawlTokens
        : def[1] === 'axtree' ? site.axTokens
        : site.snapshotTokens;
      row.push(value == null ? 'n/a' : num(value));
      if (value != null) total += value;
    }
    row.push(num(total));
    if (tasks) {
      const value = def[1] === 'raw' ? tasks.rawTokens
        : def[1] === 'axtree' ? tasks.axTokens
        : def[1] === 'ahttp' ? tasks.ahttpTokens
        : null;
      row.push(value == null ? 'n/a' : num(value));
    }
    rows.push(row);
  }
  if (self && self.pages && self.checkout) {
    const checkoutTokens = self.checkout.tokens || 0;
    const row = ['ahttp self', 'actions, text, ids', 'yes', num(checkoutTokens)];
    let total = checkoutTokens;
    for (const site of web) {
      const match = selfPage(self, site);
      row.push(match && match.tokens != null ? num(match.tokens) : 'n/a');
      if (match && match.tokens != null) total += match.tokens;
    }
    row.push(num(total));
    if (tasks) row.push(self.tasks && self.tasks.tokens != null ? num(self.tasks.tokens) : 'n/a');
    rows.push(row);
  }
  return table(headers, rows);
}

function checkoutTimeTable(comparison, self) {
  const labels = { raw: 'Raw HTML', markdown: 'Markdown', axtree: 'Accessibility tree' };
  const rows = [];
  const baselines = comparison.methods
    .filter((method) => labels[method.key] && method.avgLatencyMs != null)
    .sort((a, b) => a.avgLatencyMs - b.avgLatencyMs);
  for (const method of baselines) rows.push([labels[method.key], ms1(method.avgLatencyMs)]);
  const ahttp = comparison.methods.find((method) => method.key === 'ahttp');
  if (ahttp && ahttp.avgLatencyMs != null) rows.push(['ahttp', ms1(ahttp.avgLatencyMs)]);
  if (self && self.checkout && self.checkout.avgLatencyMs != null) rows.push(['ahttp self', ms1(self.checkout.avgLatencyMs)]);
  if (!rows.length) return null;
  return table(['Method', ':Time per step'], rows);
}

// One row per method, one column per site. Methods with no value anywhere are left out.
function timingTable(web, entries, defs) {
  const rows = [];
  for (const def of defs) {
    const values = web.map((site) => {
      const entry = entries.find((item) => shortSite(item.name) === shortSite(site.name));
      return entry && entry[def[1]] != null ? entry[def[1]] : null;
    });
    if (values.every((value) => value == null)) continue;
    rows.push([def[0]].concat(values.map((value) => value == null ? 'n/a' : ms(value))));
  }
  if (!rows.length) return null;
  const headers = ['Method'];
  for (const site of web) headers.push(':' + shortSite(site.name));
  return table(headers, rows);
}

function liveTimeTable(web, time) {
  return timingTable(web, time.live || [], [
    ['ahttp', 'ahttp'],
    ['ahttp self', 'self'],
    ['Jina Reader', 'jina'],
    ['Firecrawl', 'firecrawl']
  ]);
}

function scanTimeTable(web, time) {
  return timingTable(web, time.scan || [], [
    ['Raw HTML', 'raw'],
    ['Markdown', 'markdown'],
    ['Jina Reader', 'jina'],
    ['Firecrawl', 'firecrawl'],
    ['Accessibility tree', 'axtree'],
    ['ahttp', 'ahttp'],
    ['ahttp self', 'self']
  ]);
}

function render(results, selfResults, timeResults) {
  const self = selfResults === undefined ? loadSelf() : selfResults;
  const time = timeResults === undefined ? loadTime() : timeResults;
  const lines = [];
  const comparison = results.comparison && !results.comparison.error ? results.comparison : null;
  const web = (results.web || []).filter((site) => site.status === 'ok');
  const tasks = results.tasks && !results.tasks.error ? results.tasks : null;
  const byKey = {};
  if (comparison) for (const method of comparison.methods) byKey[method.key] = method;
  const chromium = comparison && comparison.browserVersion;
  const scanAt = time ? (time.scanGeneratedAt || time.generatedAt) : null;
  const liveAt = time ? (time.liveGeneratedAt || time.generatedAt) : null;
  const hostedAt = time ? time.hostedGeneratedAt : null;

  lines.push('Token run: `' + results.generatedAt + '`. ahttp ' + results.version + ' on ' + results.platform + ' ' + results.arch + ', Node ' + results.node + (chromium ? ', Chromium ' + chromium : '') + ', gpt-tokenizer 4.1.0/o200k_base.');
  lines.push('');

  if (comparison && web.length) {
    lines.push('### Tokens');
    lines.push('');
    lines.push('Tokens an agent reads, lower is better. Checkout is five snapshots of one purchase flow, each page column is one snapshot of a pinned page, 20 tasks is every step of the scripted suite. Total adds the non-empty cells in a row.');
    lines.push('');
    lines.push(tokenTable(web, byKey, tasks, self));
    lines.push('');
    lines.push('Only the two ahttp rows can click; the baselines score 0/' + (tasks ? tasks.tasks : 20) + ' on the task suite because they only read. `ahttp self` is the same engine loaded as `self/ahttp.user.js` in Chromium.');
    lines.push('');

    lines.push('### Time');
    lines.push('');
    lines.push('Wall-clock numbers from one machine, relative at best.' + (time ? ' Scan from `' + scanAt + '`, live from `' + liveAt + '`' + (hostedAt && hostedAt !== liveAt ? '; Jina and Firecrawl from `' + hostedAt + '`' : '') + '.' : ''));
    lines.push('');

    const checkout = checkoutTimeTable(comparison, self);
    if (checkout) {
      lines.push('**Checkout.** Average per step over five local snapshots. The hosted readers cannot run it.');
      lines.push('');
      lines.push(checkout);
      lines.push('');
    }

    const live = time ? liveTimeTable(web, time) : null;
    if (live) {
      lines.push('**Live.** URL to content, one request per page, ' + (time.liveGeneratedAt || time.generatedAt).slice(0, 10) + ':');
      lines.push('');
      lines.push(live);
      lines.push('');
      lines.push('Single runs, not medians. `ahttp` fetches the page and its linked stylesheets in Node and scans it. `ahttp self` loads the page in Chromium with the userscript injected and takes a snapshot. The hosted readers return Markdown only.');
      lines.push('');
    }

    const scan = time ? scanTimeTable(web, time) : null;
    if (scan) {
      lines.push('**Scan.** One snapshot per pinned page. Raw HTML, the accessibility tree and `ahttp self` run in Chromium on the page served from localhost; Markdown and `ahttp` run in Node.');
      lines.push('');
      lines.push(scan);
      lines.push('');
      lines.push('Hosted readers have no separate scan step; their time is in Live time.');
      lines.push('');
    }
  }

  lines.push('### Caveats');
  lines.push('');
  lines.push('- No LLM in the loop. The task runner is a script.');
  lines.push('- One ' + results.platform + ' ' + results.arch + ' machine. Scan time is the least portable number.');
  lines.push('- Accessibility token counts depend on the Chromium build.');
  if (web.some((site) => site.jinaTokens != null || site.firecrawlTokens != null)) {
    lines.push('- Jina Reader (`r.jina.ai`) and Firecrawl (v2 scrape) fetch the live page, not the pinned HTML. Without `JINA_API_KEY`, Jina can return 403 on GitHub.');
    if (time && hostedAt && hostedAt !== liveAt) {
      lines.push('- Jina and Firecrawl live timings are from `' + hostedAt + '`; local methods were re-measured.');
    }
    if (results.jinaFallback) {
      lines.push('- The latest rerun got HTTP 451 from Jina for every page, so the Jina cells above are from the run at `' + results.jinaFallback.from + '`.');
    }
  }
  return lines.join('\n').trim() + '\n';
}

function main() {
  const results = load();
  const rendered = render(results);
  if (process.argv.includes('--write')) {
    const readme = fs.readFileSync(README, 'utf8');
    const start = readme.indexOf(START);
    const end = readme.indexOf(END);
    if (start < 0 || end < 0 || end < start) throw new Error('README benchmark markers not found');
    const next = readme.slice(0, start + START.length) + '\n\n' + rendered + '\n' + readme.slice(end);
    fs.writeFileSync(README, next, 'utf8');
    process.stdout.write('updated ' + README + '\n');
    return;
  }
  process.stdout.write(rendered);
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('render-bench: ' + (e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  }
}

module.exports = { render };
