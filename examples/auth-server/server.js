'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

const PORT = parseInt(process.env.PORT || '8787', 10);
const HOST = process.env.HOST || '127.0.0.1';
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const POLICY = {
  allow: ['checkout_submit', 'support_lookup'],
  deny: ['delete_account'],
  confirm: ['checkout_submit'],
  readOnly: false,
  maxActions: 40
};

if (!AGENT_TOKEN) {
  process.stderr.write('AGENT_TOKEN is required. Example: AGENT_TOKEN=dev-token node examples/auth-server/server.js\n');
  process.exit(1);
}

const attempts = new Map();

function sameToken(value, expected) {
  const a = Buffer.from(String(value || ''));
  const b = Buffer.from(String(expected || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function bearer(req) {
  const header = String(req.headers.authorization || '');
  return header.indexOf('Bearer ') === 0 ? header.slice(7) : '';
}

function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || 'unknown';
  const recent = (attempts.get(key) || []).filter((time) => time > now - 60000);
  if (recent.length >= 30) {
    res.status(429).json({ ok: false, error: 'rate_limited' });
    return;
  }
  recent.push(now);
  attempts.set(key, recent);
  next();
}

function authorized(req, res, next) {
  if (!sameToken(bearer(req), AGENT_TOKEN)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  next();
}

app.post('/api/ahttp/authorize', rateLimit, authorized, (req, res) => {
  res.json({
    ok: true,
    owner: 'demo',
    ttlSeconds: 60,
    policy: POLICY
  });
});

app.post('/api/ahttp/action', rateLimit, authorized, (req, res) => {
  const intent = String((req.body && req.body.intent) || '');
  const id = String((req.body && req.body.id) || '');
  if (!intent && !id) {
    res.status(400).json({ ok: false, error: 'missing_action' });
    return;
  }
  if (POLICY.deny.indexOf(intent) >= 0) {
    res.status(403).json({ ok: false, error: 'policy_denied' });
    return;
  }
  if (POLICY.allow.indexOf(intent) < 0) {
    res.status(403).json({ ok: false, error: 'not_allowed' });
    return;
  }
  res.json({ ok: true, intent: intent });
});

app.get('/ahttp.js', (req, res) => {
  res.type('application/javascript').sendFile(path.join(__dirname, '..', '..', 'ahttp.js'));
});

app.get('/', (req, res) => {
  res.type('html').send('<!doctype html><html><head><title>ahttp auth example</title></head><body>' +
    '<main><h1>Server-verified example</h1>' +
    '<button data-ahttp-intent="checkout_submit">Charge card</button>' +
    '<button data-ahttp-intent="support_lookup">Lookup order</button>' +
    '<button data-ahttp-intent="delete_account">Delete account</button>' +
    '<p id="out">idle</p></main>' +
    '<script src="/ahttp.js" data-ahttp-owner="demo" data-ahttp-access="owner" ' +
    'data-ahttp-auth-endpoint="/api/ahttp/authorize"></script></body></html>');
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    process.stdout.write('auth example listening on http://' + HOST + ':' + PORT + '\n');
  });
}

module.exports = { app, sameToken, POLICY };
