#!/usr/bin/env node
'use strict';

const { openPage, bytesOf, tokensOf, compression } = require('../lib/page');
const pkg = require('../package.json');

const USAGE = [
  'ahttp ' + pkg.version + ' - compact DOM-to-action snapshots for LLM agents',
  '',
  'Usage:',
  '  ahttp <url> [options]',
  '',
  'Options:',
  '  --json                 Print the JSON snapshot plus metrics',
  '  --query <text>         Filter actions by label, name, placeholder, href',
  '  --scope <name|sel>     Region (all, main, chrome, modal) or a CSS selector',
  '  --max-actions <n>      Maximum actions in the snapshot (default 60)',
  '  --max-text <n>         Maximum characters of visible text (default 1400)',
  '  --verbose              Add scan diagnostics to the snapshot meta line',
  '  --timeout <ms>         HTTP timeout (default 25000)',
  '  --allow-private        Allow loopback, private and link-local targets',
  '  --unlock <key>         Owner key for pages configured with data-ahttp-private',
  '  --auth-token <token>   Server auth token for data-ahttp-auth-endpoint pages',
  '  --hash-key <key>       Print the SHA-256 hash used by data-ahttp-key-hash',
  '  --no-stats             Do not print the compression summary',
  '  -h, --help             Show this help',
  '  -v, --version          Show the version',
  '',
  'Examples:',
  '  node bin/ahttp-cli.js https://news.ycombinator.com',
  '  node bin/ahttp-cli.js https://en.wikipedia.org/wiki/HTTP --max-actions 40',
  '  node bin/ahttp-cli.js https://github.com/torvalds/linux --query "issues"'
].join('\n');

function parseArgs(argv) {
  const out = { url: null, json: false, stats: true, options: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { out.help = true; continue; }
    if (arg === '-v' || arg === '--version') { out.version = true; continue; }
    if (arg === '--json') { out.json = true; continue; }
    if (arg === '--verbose') { out.options.verbose = true; continue; }
    if (arg === '--no-stats') { out.stats = false; continue; }
    if (arg === '--allow-private') { out.allowPrivate = true; continue; }
    if (arg === '--query' || arg === '--scope' || arg === '--max-actions' || arg === '--max-text' || arg === '--timeout' || arg === '--unlock' || arg === '--auth-token' || arg === '--hash-key') {
      const value = argv[++i];
      if (value == null) throw new Error('missing value for ' + arg);
      if (arg === '--query') out.options.query = value;
      if (arg === '--scope') out.options.scope = value;
      if (arg === '--max-actions') out.options.maxActions = parseInt(value, 10);
      if (arg === '--max-text') out.options.maxText = parseInt(value, 10);
      if (arg === '--timeout') out.options.timeout = parseInt(value, 10);
      if (arg === '--unlock') out.unlock = value;
      if (arg === '--auth-token') out.authToken = value;
      if (arg === '--hash-key') out.hashKey = value;
      continue;
    }
    if (arg.startsWith('--query=')) { out.options.query = arg.slice(8); continue; }
    if (arg.startsWith('--scope=')) { out.options.scope = arg.slice(8); continue; }
    if (arg.startsWith('--max-actions=')) { out.options.maxActions = parseInt(arg.slice(14), 10); continue; }
    if (arg.startsWith('--max-text=')) { out.options.maxText = parseInt(arg.slice(11), 10); continue; }
    if (arg.startsWith('--unlock=')) { out.unlock = arg.slice(9); continue; }
    if (arg.startsWith('--auth-token=')) { out.authToken = arg.slice(13); continue; }
    if (arg.startsWith('--hash-key=')) { out.hashKey = arg.slice(11); continue; }
    if (arg.startsWith('-')) throw new Error('unknown option: ' + arg);
    if (!out.url) out.url = arg;
  }
  return out;
}

function printStats(m) {
  const lines = [
    '',
    '[STATS]',
    'raw         ' + String(m.rawBytes).padStart(9) + ' bytes ' + String(m.rawTokens).padStart(9) + ' tokens',
    'snapshot    ' + String(m.snapshotBytes).padStart(9) + ' bytes ' + String(m.snapshotTokens).padStart(9) + ' tokens',
    'compression ' + String(m.ratio).padStart(9) + 'x',
    'actions     ' + String(m.actions).padStart(9) + ' (controls ' + m.controls + ', forms ' + m.forms + ')',
    'nodes       ' + String(m.nodes).padStart(9) + ' (sanitized ' + m.sanitized + ', ignored ' + m.ignored + ')',
    'scan        ' + String(m.scanMs).padStart(9) + ' ms',
    'fetch       ' + String(m.fetchMs).padStart(9) + ' ms',
    'http        ' + String(m.status).padStart(9)
  ];
  return lines.join('\n');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write('ahttp: ' + e.message + '\n\n' + USAGE + '\n');
    process.exit(2);
  }
  if (args.help) { process.stdout.write(USAGE + '\n'); return; }
  if (args.version) { process.stdout.write(pkg.version + '\n'); return; }
  if (args.hashKey != null) {
    process.stdout.write(require('../ahttp.js').hashKey(args.hashKey) + '\n');
    return;
  }
  if (!args.url) {
    process.stderr.write('ahttp: missing url\n\n' + USAGE + '\n');
    process.exit(2);
  }
  const started = Date.now();
  const page = await openPage(args.url, { timeout: args.options.timeout, allowPrivate: args.allowPrivate === true });
  const pageStatus = page.api.status();
  if (pageStatus.policy && pageStatus.policy.serverAuth) {
    const token = args.authToken != null ? args.authToken : (process.env.AHTTP_AUTH_TOKEN || '');
    if (token) {
      const authorized = await page.api.authorize({ token: token });
      if (!authorized.ok) throw new Error('server authorization failed: ' + (authorized.error || 'unknown_error'));
    }
  } else {
    const ownerKey = args.unlock != null ? args.unlock : (process.env.AHTTP_OWNER_KEY || '');
    if (ownerKey) {
      const unlocked = page.api.unlock(ownerKey);
      if (!unlocked.ok) throw new Error('owner unlock failed: ' + (unlocked.error || 'invalid_key'));
    }
  }
  if (page.api.status().locked) {
    throw new Error('authorization required: pass --auth-token <token> for server auth, or --unlock <key> / AHTTP_OWNER_KEY for key auth');
  }
  const snapshotOptions = {
    query: args.options.query,
    scope: args.options.scope,
    maxActions: args.options.maxActions,
    maxText: args.options.maxText,
    verbose: args.options.verbose
  };
  const data = page.api.snapshot(Object.assign({ format: 'json' }, snapshotOptions));
  const text = args.json ? JSON.stringify(data, null, 2) : page.api.snapshot(Object.assign({ format: 'text' }, snapshotOptions));
  const metrics = {
    url: page.url,
    status: page.status,
    fetchMs: page.fetchMs,
    rawBytes: page.rawBytes,
    rawTokens: Math.ceil(page.rawBytes / 4),
    snapshotBytes: bytesOf(text),
    snapshotTokens: tokensOf(text),
    ratio: compression({ rawBytes: page.rawBytes, snapshotBytes: bytesOf(text) }),
    actions: data.meta.actions,
    controls: data.meta.controls,
    forms: data.meta.forms,
    nodes: data.meta.nodes,
    sanitized: data.meta.sanitized,
    ignored: data.meta.ignored,
    scanMs: Math.round(data.meta.scanMs * 100) / 100,
    elapsedMs: Date.now() - started
  };
  if (args.json) {
    process.stdout.write(JSON.stringify({ snapshot: data, metrics }, null, 2) + '\n');
    return;
  }
  process.stdout.write(text + '\n');
  if (args.stats) process.stdout.write(printStats(metrics) + '\n');
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write('ahttp: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exit(1);
  });
}

module.exports = { parseArgs, main, printStats, USAGE };
