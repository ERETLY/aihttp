'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'bump-version.js');
const FILES = ['package.json', 'package-lock.json', 'aihttp.js', 'CHANGELOG.md'];

function currentVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function parts(version) {
  return version.split('.').map(Number);
}

function tempCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ahttp-bump-'));
  for (const file of FILES) fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  return dir;
}

function seedChangelog(dir) {
  const changelog = '# Changelog\n\n## Unreleased\n\n### Test\n\n- Bump test note.\n\n## ' +
    currentVersion() + ', 2026-11-01\n\n- Old note.\n';
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog, 'utf8');
}

function run(dir, input) {
  return spawnSync(process.execPath, [SCRIPT, input], {
    cwd: dir,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { AHTTP_BUMP_SKIP_BUILD: '1' })
  });
}

function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

function versions(dir) {
  const pkg = JSON.parse(read(dir, 'package.json'));
  const lock = JSON.parse(read(dir, 'package-lock.json'));
  const engine = read(dir, 'aihttp.js');
  return {
    package: pkg.version,
    lock: lock.version,
    lockPackage: lock.packages[''].version,
    engine: (engine.match(/var VERSION = '([^']+)'/) || [])[1],
    banner: (engine.match(/\/\*! aihttp\.js v([^\s|]+)/) || [])[1]
  };
}

function assertConsistent(dir, expected) {
  assert.deepEqual(versions(dir), {
    package: expected,
    lock: expected,
    lockPackage: expected,
    engine: expected,
    banner: expected
  });
}

function assertChangelog(dir, expected) {
  const changelog = read(dir, 'CHANGELOG.md');
  const escaped = expected.replace(/\./g, '\\.');
  assert.match(changelog, new RegExp('^# Changelog\\r?\\n\\r?\\n## Unreleased\\r?\\n\\r?\\n## ' + escaped + ', \\d{4}-\\d{2}-\\d{2}'));
  assert.match(changelog, /### Test/);
  return changelog;
}

test('bump patch updates every version file and the changelog', () => {
  const dir = tempCopy();
  try {
    seedChangelog(dir);
    const before = parts(currentVersion());
    const expected = before[0] + '.' + before[1] + '.' + (before[2] + 1);
    const result = run(dir, 'patch');
    assert.equal(result.status, 0, result.stderr);
    assertConsistent(dir, expected);
    assertChangelog(dir, expected);
    for (const file of FILES) assert.ok(read(dir, file).endsWith('\n'), file + ' keeps its trailing newline');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bump minor resets patch and keeps the old notes under the release heading', () => {
  const dir = tempCopy();
  try {
    seedChangelog(dir);
    const before = parts(currentVersion());
    const expected = before[0] + '.' + (before[1] + 1) + '.0';
    const result = run(dir, 'minor');
    assert.equal(result.status, 0, result.stderr);
    assertConsistent(dir, expected);
    const changelog = assertChangelog(dir, expected);
    assert.match(changelog, /## Unreleased\r?\n\r?\n## [0-9]+\.[0-9]+\.[0-9]+, \d{4}-\d{2}-\d{2}\r?\n\r?\n### Test/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bump major resets minor and patch', () => {
  const dir = tempCopy();
  try {
    seedChangelog(dir);
    const before = parts(currentVersion());
    const expected = (before[0] + 1) + '.0.0';
    const result = run(dir, 'major');
    assert.equal(result.status, 0, result.stderr);
    assertConsistent(dir, expected);
    assertChangelog(dir, expected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bump accepts an explicit X.Y.Z version', () => {
  const dir = tempCopy();
  try {
    seedChangelog(dir);
    const before = parts(currentVersion());
    const expected = (before[0] + 10) + '.0.0';
    const result = run(dir, expected);
    assert.equal(result.status, 0, result.stderr);
    assertConsistent(dir, expected);
    assertChangelog(dir, expected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bump refuses an empty Unreleased section and leaves the files alone', () => {
  const dir = tempCopy();
  try {
    const before = versions(dir);
    const changelog = '# Changelog\n\n## Unreleased\n\n## ' + currentVersion() + ', 2026-11-01\n\n- Old note.\n';
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog, 'utf8');
    const result = run(dir, 'patch');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /empty "## Unreleased" section/);
    assert.deepEqual(versions(dir), before);
    assert.equal(read(dir, 'CHANGELOG.md'), changelog);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bump refuses an invalid version and leaves the files alone', () => {
  const dir = tempCopy();
  try {
    const before = versions(dir);
    const changelog = read(dir, 'CHANGELOG.md');
    for (const input of ['1.2', 'v1.2.3', 'banana', '1.2.3.4', '01.2.3']) {
      const result = run(dir, input);
      assert.equal(result.status, 1, input + ' must be refused');
      assert.match(result.stderr, /invalid version/);
    }
    assert.deepEqual(versions(dir), before);
    assert.equal(read(dir, 'CHANGELOG.md'), changelog);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bump refuses a version that is not greater than the current one', () => {
  const dir = tempCopy();
  try {
    const before = versions(dir);
    for (const input of [currentVersion(), '0.0.0']) {
      const result = run(dir, input);
      assert.equal(result.status, 1, input + ' must be refused');
      assert.match(result.stderr, /must be greater than current/);
    }
    assert.deepEqual(versions(dir), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
