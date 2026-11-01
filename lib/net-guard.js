'use strict';

const dns = require('dns');
const net = require('net');

function ipv4Parts(address) {
  const parts = String(address).split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateIPv4(address) {
  const p = ipv4Parts(address);
  if (!p) return false;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) return true;
  if (a === 198 && b === 51 && p[2] === 100) return true;
  if (a === 203 && b === 0 && p[2] === 113) return true;
  if (a >= 224) return true;
  return false;
}

function ipv6Groups(address) {
  let value = String(address).toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  if (value.includes('%')) value = value.slice(0, value.indexOf('%'));
  if (!net.isIPv6(value)) return null;
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const expand = (parts) => {
    const out = [];
    for (const part of parts) {
      if (part.includes('.')) {
        const v4 = ipv4Parts(part);
        if (!v4) return null;
        out.push(((v4[0] << 8) | v4[1]).toString(16));
        out.push(((v4[2] << 8) | v4[3]).toString(16));
      } else {
        out.push(part);
      }
    }
    return out;
  };
  const l = expand(left);
  const r = expand(right);
  if (!l || !r) return null;
  const missing = 8 - l.length - r.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  return l.concat(new Array(missing).fill('0'), r).map((part) => parseInt(part, 16));
}

function isPrivateIPv6(address) {
  const g = ipv6Groups(address);
  if (!g) return false;
  const zeroTo = (n) => g.slice(0, n).every((v) => v === 0);
  if (zeroTo(7) && (g[7] === 0 || g[7] === 1)) return true;
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  if ((g[0] & 0xff00) === 0xff00) return true;
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;
  if (g[0] === 0x2001 && g[1] === 0x0000) return true;
  if (g[0] === 0x2002) return true;
  if (g[0] === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((v) => v === 0)) {
    const embedded = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    return isPrivateIPv4(embedded);
  }
  if (g.slice(0, 5).every((v) => v === 0) && g[5] === 0xffff) {
    const embedded = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    return isPrivateIPv4(embedded);
  }
  if (g.slice(0, 6).every((v) => v === 0)) {
    const embedded = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
    return isPrivateIPv4(embedded);
  }
  return false;
}

function isPrivateAddress(address) {
  const value = String(address || '').trim();
  if (net.isIPv4(value)) return isPrivateIPv4(value);
  if (net.isIPv6(value)) return isPrivateIPv6(value);
  return false;
}

function isPrivateHostname(hostname) {
  const name = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!name) return true;
  if (name === 'localhost' || name.endsWith('.localhost')) return true;
  if (name.endsWith('.local') || name.endsWith('.internal')) return true;
  if (name === 'metadata' || name === 'instance-data' || name === 'metadata.google.internal') return true;
  return false;
}

function redactUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch (e) { return String(value).replace(/\/\/[^/@\s]+@/, '//[redacted]@'); }
  const auth = url.username || url.password ? '[redacted]@' : '';
  return url.protocol + '//' + auth + url.host + url.pathname + (url.search ? '?[redacted]' : '');
}

function normalizeHost(hostname) {
  let host = String(hostname || '');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return host;
}

async function lookupSafe(hostname, allowPrivate) {
  const host = normalizeHost(hostname);
  if (!host) throw new Error('empty hostname');
  if (net.isIP(host)) {
    if (!allowPrivate && isPrivateAddress(host)) throw new Error('private address blocked: ' + host);
    return [{ address: host, family: net.isIPv6(host) ? 6 : 4 }];
  }
  if (!allowPrivate && isPrivateHostname(host)) throw new Error('private hostname blocked: ' + host);
  let records;
  try {
    records = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    throw new Error('dns lookup failed for ' + host);
  }
  if (!records || !records.length) throw new Error('dns lookup returned no records for ' + host);
  if (!allowPrivate) {
    for (const record of records) {
      if (isPrivateAddress(record.address)) throw new Error('private address blocked: ' + record.address);
    }
  }
  return records;
}

async function prepareRequest(url, options) {
  const opts = options || {};
  let target;
  try { target = new URL(String(url)); } catch (e) { throw new Error('invalid url: ' + redactUrl(url)); }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('unsupported protocol: ' + target.protocol);
  }
  if (target.username || target.password) throw new Error('url credentials are not allowed');
  const records = await lookupSafe(target.hostname, opts.allowPrivate === true);
  const first = records[0];
  const lookup = (hostname, lookupOptions, callback) => {
    const callbackFn = typeof lookupOptions === 'function' ? lookupOptions : callback;
    const all = lookupOptions && typeof lookupOptions === 'object' && lookupOptions.all;
    if (all) callbackFn(null, records);
    else callbackFn(null, first.address, first.family);
  };
  return { url: target, lookup };
}

module.exports = {
  isPrivateAddress,
  isPrivateHostname,
  isPrivateIPv4,
  isPrivateIPv6,
  lookupSafe,
  prepareRequest,
  redactUrl
};
