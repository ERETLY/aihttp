#!/usr/bin/env node
'use strict';

// Bump the single source of truth (package.json) and keep the generated files
// in sync. The script never commits, tags, pushes or publishes.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = process.cwd();
const USAGE = 'usage: npm run bump -- patch|minor|major|X.Y.Z';
const FILES = {
  pkg: 'package.json',
  lock: 'package-lock.json',
  engine: 'ahttp.js',
  changelog: 'CHANGELOG.md'
};

function fail(message) {
  process.stderr.write('bump-version: ' + message + '\n');
  process.exit(1);
}

function read(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
  } catch (e) {
    fail('cannot read ' + file + ': ' + (e && e.message ? e.message : String(e)));
  }
}

function parseVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(String(value == null ? '' : value).trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function formatVersion(parts) {
  return parts.join('.');
}

function compareVersions(left, right) {
  for (let i = 0; i < 3; i++) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

function nextVersion(current, input) {
  const arg = String(input == null ? '' : input).trim();
  let next;
  if (arg === 'patch') {
    next = [current[0], current[1], current[2] + 1];
  } else if (arg === 'minor') {
    next = [current[0], current[1] + 1, 0];
  } else if (arg === 'major') {
    next = [current[0] + 1, 0, 0];
  } else {
    next = parseVersion(arg);
    if (!next) fail('invalid version "' + arg + '"; expected patch, minor, major or X.Y.Z');
  }
  if (compareVersions(next, current) <= 0) {
    fail('next version ' + formatVersion(next) + ' must be greater than current ' + formatVersion(current));
  }
  return formatVersion(next);
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function updateChangelog(text, next) {
  const heading = /^## Unreleased[ \t]*\r?$/m.exec(text);
  if (!heading) fail('CHANGELOG.md has no "## Unreleased" heading');
  const rest = text.slice(heading.index + heading[0].length);
  const nextHeading = /\r?\n##[ \t]/.exec(rest);
  const body = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  if (!body.trim()) fail('CHANGELOG.md has an empty "## Unreleased" section; add a note before bumping');
  const eol = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const replacement = '## Unreleased' + eol + eol + '## ' + next + ', ' + todayUtc();
  return text.slice(0, heading.index) + replacement + rest;
}

function updatePackageJson(text, next) {
  let replaced = false;
  const out = text.replace(/^([ \t]*"version"[ \t]*:[ \t]*")[^"]*(")/m, function (all, before, after) {
    replaced = true;
    return before + next + after;
  });
  if (!replaced) fail('package.json has no top-level "version" field');
  return out;
}

function detectIndent(text) {
  const match = /^[ \t]+(?=")/m.exec(text);
  return match ? match[0] : '  ';
}

function stringifyJson(original, value) {
  const eol = original.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  let out = JSON.stringify(value, null, detectIndent(original));
  if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  if (/\r?\n$/.test(original)) out += eol;
  return out;
}

function updatePackageLock(text, next) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    fail('package-lock.json is not valid JSON: ' + (e && e.message ? e.message : String(e)));
  }
  if (!data || typeof data !== 'object') fail('package-lock.json is not an object');
  if (!data.packages || typeof data.packages !== 'object' || !data.packages['']) {
    fail('package-lock.json has no packages[""] entry');
  }
  data.version = next;
  data.packages[''].version = next;
  return stringifyJson(text, data);
}

function updateEngine(text, next) {
  let seen = 0;
  let out = text.replace(/(\bvar VERSION = ['"])[^'"]+(['"])/, function (all, before, after) {
    seen++;
    return before + next + after;
  });
  out = out.replace(/(^\/\*! ahttp\.js v)[^\s|]+/m, function (all, before) {
    seen++;
    return before + next;
  });
  if (seen !== 2) fail('ahttp.js must contain the version banner and var VERSION');
  return out;
}

function runStep(label, command, args, shell) {
  process.stdout.write('bump-version: ' + label + '\n');
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env: process.env, shell: !!shell });
  if (result.error) fail(label + ' failed: ' + result.error.message);
  if (result.status !== 0) fail(label + ' failed with exit code ' + result.status);
}

function main() {
  const input = process.argv[2];
  if (!input || input === '--help' || input === '-h') {
    if (!input) fail('missing version argument; ' + USAGE);
    process.stdout.write(USAGE + '\n');
    return;
  }
  if (process.argv.length > 3) fail('too many arguments; ' + USAGE);

  const pkgText = read(FILES.pkg);
  let pkg;
  try {
    pkg = JSON.parse(pkgText);
  } catch (e) {
    fail('package.json is not valid JSON: ' + (e && e.message ? e.message : String(e)));
  }
  const currentText = String(pkg.version || '');
  const current = parseVersion(currentText);
  if (!current) fail('package.json version "' + currentText + '" is not X.Y.Z');

  const next = nextVersion(current, input);
  const lockText = read(FILES.lock);
  const engineText = read(FILES.engine);
  const changelogText = read(FILES.changelog);

  // Compute every file before writing, so a refused bump changes nothing.
  const nextPkg = updatePackageJson(pkgText, next);
  const nextLock = updatePackageLock(lockText, next);
  const nextEngine = updateEngine(engineText, next);
  const nextChangelog = updateChangelog(changelogText, next);

  fs.writeFileSync(path.join(ROOT, FILES.pkg), nextPkg, 'utf8');
  fs.writeFileSync(path.join(ROOT, FILES.lock), nextLock, 'utf8');
  fs.writeFileSync(path.join(ROOT, FILES.engine), nextEngine, 'utf8');
  fs.writeFileSync(path.join(ROOT, FILES.changelog), nextChangelog, 'utf8');
  process.stdout.write('bump-version: ' + currentText + ' -> ' + next + '\n');

  if (process.env.AHTTP_BUMP_SKIP_BUILD !== '1') {
    runStep('npm run build', 'npm run build', [], true);
    runStep('scripts/smoke-runtime.js', process.execPath, [path.join(__dirname, 'smoke-runtime.js')], false);
  }

  process.stdout.write([
    '',
    'Next steps:',
    '  git add -A',
    '  git commit -m "chore: release ' + next + '"',
    '  git tag ' + next,
    '  git push --follow-tags',
    ''
  ].join('\n'));
}

if (require.main === module) main();

module.exports = {
  parseVersion: parseVersion,
  compareVersions: compareVersions,
  nextVersion: nextVersion,
  updateChangelog: updateChangelog,
  updatePackageJson: updatePackageJson,
  updatePackageLock: updatePackageLock,
  updateEngine: updateEngine
};
