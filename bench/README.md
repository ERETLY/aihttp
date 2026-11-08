# Corpus results

`results.json` is the current engine on the 27-case corpus. `results.before.json`
is the same corpus run against `main:aihttp.js` before the matching changes, used
for the PR before/after table.

Regenerate the current summary:

```bash
npm run test:corpus
```

Regenerate the baseline (any engine file works):

```bash
git show main:aihttp.js > /tmp/ahttp.before.js
AHTTP_ENGINE=/tmp/ahttp.before.js node corpus/runner.js --out=bench/results.before.json
```

Both files contain `totals` (`cases`, `passed`, `failed`, `pending`,
`match_ok`, `diff_ok`, `tokens`) and per-case steps with the exact checks. The
runner prints the same table to stdout and exits non-zero when a non-pending
case fails.
