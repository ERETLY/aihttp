'use strict';

// Summarize one benchmark/web-matrix.js run. The matrix is a finding tool, not
// a scoreboard; this script prints the same numbers the README quotes so a
// reader can reproduce them from the JSON.

const fs = require('fs');
const path = require('path');

const file = process.argv[2] || path.join(__dirname, 'web-matrix-results.json');
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const sites = report.sites || [];

const counts = { sites: sites.length, ok: 0, blocked: 0, network: 0, errors: 0, measured: 0 };
let visible = 0;
let matched = 0;
let phantom = 0;
let ratioSum = 0;
const below = [];
const scanTimes = [];

for (const site of sites) {
  if (site.status === 'ok') counts.ok += 1;
  else if (site.status === 'blocked') counts.blocked += 1;
  else if (site.status === 'network') counts.network += 1;
  else counts.errors += 1;

  const metrics = site.metrics || {};
  const recall = metrics.recall;
  if (site.status === 'ok' && recall && recall.visible > 0) {
    counts.measured += 1;
    visible += recall.visible;
    matched += recall.matched;
    phantom += recall.phantomTotal || 0;
    ratioSum += recall.ratio;
    if (recall.ratio < 0.9) {
      below.push(site.id + '=' + (Math.round(recall.ratio * 1000) / 10) + '%');
    }
  }
  if (metrics.scanMs != null) scanTimes.push(metrics.scanMs);
}

scanTimes.sort(function (a, b) { return a - b; });
const percentile = function (p) {
  if (!scanTimes.length) return 0;
  return scanTimes[Math.min(scanTimes.length - 1, Math.floor(scanTimes.length * p))];
};

const weighted = visible ? (matched / visible) * 100 : 0;
const mean = counts.measured ? (ratioSum / counts.measured) * 100 : 0;
const pct = function (value) { return (Math.round(value * 10) / 10).toFixed(1); };

console.log('file: ' + file);
if (report.generatedAt) console.log('generated: ' + report.generatedAt);
console.log('sites=' + counts.sites + ' ok=' + counts.ok + ' blocked=' + counts.blocked +
  ' network=' + counts.network + ' errors=' + counts.errors + ' measured=' + counts.measured);
console.log('controls: ' + matched + '/' + visible + ' weighted=' + pct(weighted) + '% mean=' + pct(mean) + '%');
console.log('phantom: ' + phantom);
console.log('below90 (' + below.length + '): ' + (below.length ? below.join(', ') : 'none'));
if (scanTimes.length) {
  console.log('scan ms: median=' + percentile(0.5) + ' p95=' + percentile(0.95) +
    ' max=' + scanTimes[scanTimes.length - 1] + ' n=' + scanTimes.length);
}

if (counts.errors) {
  console.log('errors:');
  for (const site of sites) {
    if (site.status !== 'ok' && site.status !== 'blocked' && site.status !== 'network') {
      console.log('  ' + site.id + ': ' + site.status + ' ' + String(site.error || '').slice(0, 120));
    }
  }
}
