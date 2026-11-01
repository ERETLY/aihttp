# Pinned benchmark pages

These files are unmodified HTML snapshots fetched on 2026-10-31 for reproducible benchmark input. They are not part of the ahttp engine and are not relicensed under the repository's MIT license. Each page remains subject to its source site's terms and content license.

`index.json` records the source URL, byte count, fetch time, and SHA-256 for each file. Refresh with:

```bash
node benchmark/fetch-pinned.js
```

The benchmark can also run against the live network with `node benchmark/run.js --live`.

Sources:

- Hacker News: https://news.ycombinator.com
- Wikipedia: https://en.wikipedia.org/wiki/HTTP
- Lobsters: https://lobste.rs
- GitHub: https://github.com/torvalds/linux
- MDN: https://developer.mozilla.org/en-US/docs/Web/HTTP
