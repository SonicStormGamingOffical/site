# FusionHub Browser - Website

This folder is the static website **and** the small Node service that powers it.
It is hosted on **Railway**, which pulls this repo from GitHub
(`github.com/SonicStormGamingOffical/site`): every push to `main` redeploys.

Canonical URL: **https://site-production-e64f.up.railway.app/**

## Downloads come from GitHub Releases

The Windows installer (~117 MB), the Linux `.deb` (~142 MB) and the macOS `.dmg`
are too big for GitHub's 100 MB per-file repo limit, so they are published as
**GitHub Release assets** and linked directly:

- Windows: `.../releases/download/v1.0.4/FusionHubBrowser-Setup-1.0.4.exe`
- Linux: `.../releases/download/v1.0.4/FusionHub-Browser-1.0.4-linux.deb`
- macOS: `.../releases/download/v1.0.4/FusionHub-Browser-1.0.4-mac.dmg`
  (universal: Apple Silicon + Intel)

Copies staged in `download/` are git-ignored (`.exe` / `.deb` / `.dmg`) and must
never be committed.

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
| `GET /download/mac`     | 302 redirect to the macOS `.dmg` release asset        |
| `GET /releases`      | 302 redirect to the GitHub releases page                 |
| `GET /store.html`    | extension store: browse + publish extensions             |
| `GET /api/extensions` | extension catalogue (JSON; used by the in-app store)    |
| `GET /api/extensions/<id>/download` | the `.crx` / `.zip` extension package      |
| `POST /api/extensions` | publish an extension (raw body; metadata in query)     |
| `POST /api/telemetry` | store/replace one computer's telemetry (auth)            |
| `GET /api/telemetry` | list every computer the server has seen (auth)           |
| `POST /api/forget`   | forget a single computer (auth)                          |
| `GET /health`        | liveness probe                                           |

It also **watches the GitHub releases** of the repo and refreshes the version it
reports (falling back to the checked-in `version.json` when GitHub is
unreachable).

### Extension store

The store is user-driven: anyone can publish a `.crx` file or a `.zip` of an
unpacked extension (it must contain `manifest.json` at its root). Packages are
written to `data/extensions/` (git-ignored) with an `index.json` catalogue, and
they are served back at `/api/extensions/<id>/download`. Inside the browser,
**Extensions → Extension store** lists the catalogue and installs a package with
one click.

**Static fallback catalogue:** `extensions.json` (committed in this repo) is the
browser's offline fallback. When the live site is unreachable the in-app store
reads `extensions.json` from `raw.githubusercontent.com` instead, so the store
keeps working even while the site host is down. Each entry needs `id`, `name`,
`version`, `description`, `size` and a direct `url` to the package (GitHub
release assets work great).

Set `STORE_UPLOAD_TOKEN` to require a shared secret before publishing (send it as
an `x-upload-token` header or a `?token=` query parameter); leave it empty to let
anyone publish. Set `STORE_MAX_MB` to change the size cap (default 25 MB).

> Publishing an extension means other users can run that code in their browser.
> The store does not review or sandbox uploads, so only run it on a host you
> trust, and treat the upload endpoint as a public write surface.

### Telemetry (the owner's Admin Panel)

Every installed build of FusionHub Browser carries a hidden `build/telemetry.json`
(`src/lib/telemetry.js` reads it) with this server's URL and a shared token. Each
copy silently posts a snapshot of its tabs/stats to `POST /api/telemetry` every
15 s, so the owner's **Admin Panel** can show computers that are **not** on the
same Wi-Fi.

Only the **SHA-256** of the default token is compiled into this (public) repo;
the raw token ships inside the app. The Admin Panel shows `public` when the
server answers and `local only` when it does not. Machines are kept in
`data/machines.json` (git-ignored) and capped at 500; `POST /api/forget` removes
one. Set `FH_TELEMETRY_TOKEN` to rotate to a plaintext secret (must match
`build/telemetry.json`).

> Telemetry is deliberately silent (no UI toggle), and the token is extractable
> from any distributed build. Do not post anything you would not treat as public.

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
| `SITE_URL`        | `https://replaceme-with-your-site-url.com`    | canonical URL used in `/api/latest`       |
| `SITE_REPO`       | `replaceme-with-your-github-username/replaceme-with-your-github-repo`                   | repo whose releases are watched           |
| `SITE_REFRESH_MS` | `600000`                                         | release re-check interval (min 60000)     |
| `GH_TOKEN`        | *(empty)*                                        | GitHub token; only needed if the repo is private or for publish-release.js |
| `STORE_MAX_MB`    | `25`                                             | max uploaded extension size (MB)          |
| `STORE_UPLOAD_TOKEN` | *(empty = open publishing)*                   | shared secret required to publish         |
| `FH_TELEMETRY_TOKEN` | *(empty; uses the compiled-in hash)*          | override the telemetry shared secret      |
| `FH_TELEMETRY_TOKEN_SHA256` | *(default compiled in)*                | accept a different token hash             |

`.env` is git-ignored; `.env.example` is committed.

## What's inside

```
site/
  index.html      landing page with download buttons (GitHub release links)
  store.html      extension store (browse + publish)
  style.css       styling
  server.js       static server + /api/latest + extension-store endpoints (Railway)
  data/           (git-ignored) published extension packages + catalogue
  package.json    `npm start` -> node server.js
  version.json    latest version + download URLs/sizes
  railway.json    Railway start command + /health healthcheck
  Procfile        web: node server.js
  .env.example    documented environment variables (copy to .env)
  README.md       this file
  assets/icon.png logo / favicon
  download/       (git-ignored) staged installers before uploading to a release
```

