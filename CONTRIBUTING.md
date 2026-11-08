# Contributing

ahttp is a small project. Keep changes focused and include a test or a reproducible command.

## Before opening a pull request

```bash
npm ci
npm test
npm run lint
npm run build
npm audit --omit=dev
```

If the change affects the browser engine, run the Playwright tests. If it affects the benchmark, run `npm run test:bench` and attach the output.

## Versioning

Every pull request that changes `aihttp.js`, `aihttp.d.ts`, `bin/` or `lib/` ends with `npm run bump -- patch`. Use `minor` for visible behaviour or API additions, and `major` only after 1.0.

Describe the change under `## Unreleased` in `CHANGELOG.md` while you work. The bump moves that section to `## X.Y.Z, YYYY-MM-DD`, adds a fresh empty `## Unreleased`, updates every version file, and runs the build and smoke test. It does not commit, tag, push, or publish. The maintainer creates and pushes the tag after the merge.

Do not add a runtime dependency to `aihttp.js` or the static MCP backend without a measurement and a decision entry in `docs/DECISIONS.md`. Optional browser support belongs behind a feature flag or a peer dependency.

## What to include

- The problem and the smallest change that fixes it.
- Tests for new behavior and for the failure mode.
- A note in `CHANGELOG.md` for user-visible changes.
- Benchmark output as it came out, including regressions.

## What not to include

- Secrets, tokens, private URLs, or personal data.
- Generated `node_modules`, browser profiles, or local logs.
- A claim that a check passed without the command output.
- Marketing language or a fixed-vulnerability list in public docs.

## Security

Do not open a public issue for a security problem. Use the process in `SECURITY.md`.

## License

By contributing, you agree that your contribution is licensed under the MIT license.
