# Launch checklist

## GitHub Pages demo

The browser demo is a single static page at `docs/demo/index.html`. It loads `ahttp.js` from the repository root with a relative path, runs it inside a sandboxed iframe, and makes no external requests. Keep it that way: no CDN scripts, fonts, images, analytics or remote styles.

1. Confirm the page and engine are committed:
   - `docs/demo/index.html`
   - `ahttp.js`
2. Push `main`.
3. Open the repository on GitHub: **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
5. Choose branch **main** and folder **/docs**, then **Save**.
6. Wait for the Pages deployment to finish (the Actions run is named `pages build and deployment`).
7. Open `https://<owner>.github.io/ahttp/demo/` and check that the preview renders and the snapshot panel fills after **Run**.
8. In the browser DevTools **Network** panel, confirm the page requests only `index.html` and `ahttp.js` from the same origin.
9. If the site uses a custom domain, add it under **Settings → Pages → Custom domain** and enable **Enforce HTTPS**.

Local check without a build step:

```bash
python3 -m http.server 8000 --directory .
# open http://127.0.0.1:8000/docs/demo/
```

Any static file server works; the page has no server-side dependency.

## Release

1. Update `package.json`, `CHANGELOG.md` and `ahttp.min.js` (`npm run build`).
2. Run `npm test`, `npm run lint`, `npm run typecheck`, `npm audit` and `npm pack --dry-run`.
3. Commit and tag the version:
   ```bash
   git tag 0.1.0
   git push origin main --tags
   ```
4. Create a GitHub release for the tag. Attach `self/ahttp.user.js` and `ahttp.min.js`.
5. The package is not published to npm. Install from git:
   ```bash
   npx github:ERETLY/ahttp
   ```
