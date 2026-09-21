# FusionHub Browser - Website

This folder is the static website **and** the small Node service that powers it.
It is hosted on **Railway**, which pulls this repo from GitHub
(`github.com/SonicStormGamingOffical/site`): every push to `main` redeploys.

Canonical URL: **https://site-production-e64f.up.railway.app/**

## Downloads come from GitHub Releases

The Windows installer (~117 MB) and the Linux `.deb` (~142 MB) are too big for
GitHub's 100 MB per-file repo limit, so they are published as **GitHub Release
assets** and linked directly:

- Windows: `.../releases/download/v1.0.0/FusionHubBrowser-Setup-1.0.0.exe`
- Linux: `.../releases/download/v1.0.0/FusionHub-Browser-1.0.0-linux.deb`

Copies staged in `download/` are git-ignored (`.exe` / `.deb`) and must never be
committed.

## `server.js`

`site/server.js` is a dependency-free Node server that serves the static site
and gives apps a single URL to talk to. Railway runs it via
`package.json` → `npm start`.

| Endpoint             | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `GET /`              | landing page                                             |
| `GET /api/latest`    | latest version + download URLs (JSON; used by the app)   |
| `GET /version.json`  | the version file, for convenience (same as `/api/latest`)|
| `GET /download/windows` | 302 redirect to the Windows `.exe` release asset      |
| `GET /download/linux`   | 302 redirect to the Linux `.deb` release asset        |
| `GET /releases`      | 302 redirect to the GitHub releases page                 |
| `GET /health`        | liveness probe                                           |

It also **watches the GitHub releases** of the repo and refreshes the version it
reports (falling back to the checked-in `version.json` when GitHub is
unreachable). Environment variables: `PORT` (Railway sets it), `SITE_URL`
(defaults to the canonical URL above), `SITE_REPO`, `SITE_REFRESH_MS`.

Run locally:

```bash
cd site
node server.js        # http://localhost:8899
```

## Publishing a new build

From the project root (where the browser's `package.json` lives):

```bash
npm run build                    # produces dist\FusionHub Browser Setup 1.0.0.exe
```

Then:

1. Create a GitHub release (e.g. tag `v1.0.0`) on the `site` repo and upload
   `FusionHubBrowser-Setup-1.0.0.exe` and `FusionHub-Browser-1.0.0-linux.deb`
   as release assets. (`scripts/publish-release.js` automates this.)
2. Update `site/version.json` (version + download URLs/sizes) and the download
   links in `site/index.html`.
3. Commit + push so Railway redeploys.

## What's inside

```
site/
  index.html      landing page with download buttons (GitHub release links)
  style.css       styling
  server.js       static server + /api/latest version endpoint (Railway)
  package.json    `npm start` -> node server.js
  version.json    latest version + download URLs/sizes
  README.md       this file
  assets/icon.png logo / favicon
  download/       (git-ignored) staged installers before uploading to a release
```
