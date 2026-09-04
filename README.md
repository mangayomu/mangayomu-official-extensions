# MangaYomu Official Extensions

MangaYomu-maintained extension packages and the GitHub Pages catalog site.

## Repository layout

- `local-source/` — the official **Local Source** extension (server source + client contribution).
- `repository.json` — release catalog (relative `dist/` URLs, pinned `sha256`, tags, versions).
- `dist/` — generated package ZIPs (ignored by Git; produced by `npm run build:zips`).
- `web/` — Vite + TinyBubble catalog site deployed to GitHub Pages (ignored build outputs).

## Local development

```bash
# Build the package ZIPs and refresh repository.json (reproducible hashes)
npm run build:zips

# Copy the catalog + packages into web/public and serve the site (Vite :18763)
npm run dev:site

# Full production build into web/dist
npm run build:site

# Preview the production build (:18764)
npm run preview:site
```

## GitHub Pages

1. Push this repository to GitHub and enable **Settings → Pages → GitHub Actions**.
2. The workflow builds `web/dist` and deploys it under:

   ```text
   https://mangayomu.github.io/mangayomu-official-extensions/
   ```

3. Catalog URL to paste into MangaYomu **Settings → Extensions → Add repository**:

   ```text
   https://mangayomu.github.io/mangayomu-official-extensions/repository.json
   ```

Every package manifest must declare an explicit `x.y.z` version; the catalog exposes `version` alongside `tags`.