# FusionHub Browser - Website

This folder is the static website **and** the small Node service that powers it.
It is hosted on **Railway**, which pulls this repo from GitHub
(`github.com/SonicStormGamingOffical/site`): every push to `main` redeploys.

Canonical URL: **https://site-production-e64f.up.railway.app/**

## Downloads come from GitHub Releases

The Windows installer (~117 MB) and the Linux `.deb` (~142 MB) are too big for
GitHub's 100 MB per-file repo limit, so they are published as **GitHub Release
assets** and linked directly:

- Windows: `.../releases/download/v1.0.1/FusionHubBrowser-Setup-1.0.1.exe`
- Linux: `.../releases/download/v1.0.1/FusionHub-Browser-1.0.1-linux.deb`

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
unreachable).

## Environment (`.env`)

Copy `.env.example` to `.env` for local runs:

```bash
cd site
cp .env.example .env
```

`server.js` loads `.env` automatically (dependency-free), but **real process
environment variables always win**, so on Railway set the same keys under the
service's **Variables** tab:

| Key               | Default                                          | Purpose                                   |
| ----------------- | ------------------------------------------------ | ----------------------------------------- |
| `PORT`            | `8899` (Railway injects its own)                 | HTTP port                                 |
| `SITE_URL`        | `https://site-production-e64f.up.railway.app`    | canonical URL used in `/api/latest`       |
| `SITE_REPO`       | `SonicStormGamingOffical/site`                   | repo whose releases are watched           |
| `SITE_REFRESH_MS` | `600000`                                         | release re-check interval (min 60000)     |
| `GH_TOKEN`        | *(empty)*                                        | only needed if the repo is private        |

`.env` is git-ignored; `.env.example` is committed.

Run locally:

```bash
cd site
node server.js        # http://localhost:8899
```

## Publishing a new build

1. Bump `version` in the root `package.json` (e.g. `1.0.1`). That drives the
   installer names, the GitHub tag (`v1.0.1`) and the in-app updater.
2. Build both platforms from the project root:

   ```bash
   npm run build          # Windows  -> dist\FusionHub Browser Setup 1.0.1.exe
   npm run build:linux    # Linux    -> dist\FusionHub-Browser-1.0.1-linux.deb
   ```

3. Stage the installers under the exact asset names `publish-release.js`
   expects, then upload:

   ```bash
   copy "dist\FusionHub Browser Setup 1.0.1.exe" site\download\FusionHubBrowser-Setup-1.0.1.exe
   copy "dist\FusionHub-Browser-1.0.1-linux.deb" site\download\FusionHub-Browser-1.0.1-linux.deb
   node scripts\publish-release.js
   ```

   `scripts/publish-release.js` creates/replaces the `v1.0.1` release, uploads
   both assets, and rewrites `site/version.json` with `/releases/latest/download/`
   URLs plus sha256 hashes. It reads the token from `GH_TOKEN` or `git credential fill`.

4. Commit + push `site/` so Railway redeploys and the site/version endpoint
   report the new release. Installed apps on the older version will then show
   the update arrow.

## What's inside

```
site/
  index.html      landing page with download buttons (GitHub release links)
  style.css       styling
  server.js       static server + /api/latest version endpoint (Railway)
  package.json    `npm start` -> node server.js
  version.json    latest version + download URLs/sizes
  railway.json    Railway start command + /health healthcheck
  Procfile        web: node server.js
  .env.example    documented environment variables (copy to .env)
  README.md       this file
  assets/icon.png logo / favicon
  download/       (git-ignored) staged installers before uploading to a release
```

