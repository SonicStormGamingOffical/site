'use strict';
/* FusionHub Browser - website server
 * ---------------------------------------------------------------------------
 * Serves the static marketing site AND gives the apps a single URL to talk to.
 *
 *   GET  /                    the landing page (index.html)
 *   GET  /api/latest          latest version + download URLs (JSON)
 *   GET  /version.json        same version file, served for convenience
 *   GET  /download/windows    redirects to the Windows .exe release asset
 *   GET  /download/linux      redirects to the Linux .deb release asset
 *   GET  /releases            redirects to the GitHub releases page
 *   GET  /health              liveness probe
 *
 * The server watches the GitHub releases of the repo and refreshes the version
 * it reports, falling back to the checked-in version.json when GitHub is
 * unreachable. No dependencies.
 *
 * Environment (also read from a local `.env` file when present):
 *   PORT        port to listen on (Railway sets this automatically)
 *   SITE_URL    canonical site URL (defaults to the Railway deployment)
 *   SITE_REPO   owner/repo to watch (defaults to SonicStormGamingOffical/site)
 *   GH_TOKEN    optional; only needed when SITE_REPO is private
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Tiny dependency-free .env loader. Real process env vars always win, so
// Railway's dashboard variables override anything in the file.
(function loadDotEnv() {
  try {
    const file = path.join(__dirname, '.env');
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  } catch (err) { /* a broken .env must never stop the server */ }
})();

const PORT = Number(process.env.PORT || 8899);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const SITE_URL = String(process.env.SITE_URL || 'https://site-production-e64f.up.railway.app').replace(/\/+$/, '');
const SITE_REPO = process.env.SITE_REPO || 'SonicStormGamingOffical/site';
const REFRESH_MS = Math.max(60000, Number(process.env.SITE_REFRESH_MS) || 10 * 60 * 1000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.exe': 'application/octet-stream',
  '.deb': 'application/vnd.debian.binary-package'
};

// ---------------------------------------------------------------------------
// version state (local version.json, optionally refreshed from GitHub releases)
// ---------------------------------------------------------------------------
function localVersion() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
    v.site = SITE_URL + '/';
    v.repo = SITE_REPO;
    v.source = 'local';
    return v;
  } catch (err) {
    return {
      version: '0.0.0', site: SITE_URL + '/', repo: SITE_REPO,
      downloads: {}, source: 'local', error: 'version.json missing'
    };
  }
}

let latest = localVersion();
let lastCheckedAt = null;

function getJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'FusionHub-Site', Accept: 'application/vnd.github+json' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(getJson(res.headers.location, timeoutMs));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' from ' + url));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(new Error('Bad JSON from ' + url)); }
      });
    });
    req.on('error', reject);
    if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(new Error('Timeout fetching ' + url)));
  });
}

async function refreshFromGitHub() {
  const api = 'https://api.github.com/repos/' + SITE_REPO + '/releases/latest';
  const rel = await getJson(api, 15000);
  const tag = String(rel.tag_name || '').replace(/^v/i, '');
  if (!tag) throw new Error('release has no tag');
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const pick = (re) => assets.find((a) => a && a.name && re.test(a.name));

  const win = pick(/\.exe$/i);
  const deb = pick(/\.deb$/i);
  const downloads = Object.assign({}, latest.downloads || {});
  if (win) downloads.windows = { url: win.browser_download_url, size: Number(win.size) || 0, name: win.name };
  if (deb) downloads.linux = { url: deb.browser_download_url, size: Number(deb.size) || 0, name: deb.name };

  latest = {
    version: tag,
    releasedAt: rel.published_at || latest.releasedAt,
    site: SITE_URL + '/',
    repo: SITE_REPO,
    releaseNotes: rel.body || latest.releaseNotes || '',
    downloads,
    source: 'github',
    checkedAt: new Date().toISOString()
  };
  lastCheckedAt = latest.checkedAt;
  console.log('[site] version refreshed from GitHub: v' + tag);
}

function refreshQuietly() {
  refreshFromGitHub().catch((err) => {
    console.warn('[site] GitHub refresh failed (using local version.json): ' + (err && err.message || err));
  });
}

// ---------------------------------------------------------------------------
// Extension store
//
//   GET  /api/extensions                      catalogue (JSON)
//   GET  /api/extensions/<id>/download        the .crx / .zip package
//   POST /api/extensions?name=&version=&...   publish a package (raw body)
//
// Packages live in data/extensions/ (git-ignored). Anyone can publish so the
// store grows by itself; set STORE_UPLOAD_TOKEN to require a shared secret, and
// STORE_MAX_MB to change the size cap.
// ---------------------------------------------------------------------------
const STORE_DIR = path.join(ROOT, 'data', 'extensions');
const STORE_INDEX = path.join(STORE_DIR, 'index.json');
const STORE_MAX_BYTES = Math.max(1024 * 1024, (Number(process.env.STORE_MAX_MB) || 25) * 1024 * 1024);
const STORE_UPLOAD_TOKEN = process.env.STORE_UPLOAD_TOKEN || '';

function storeLoad() {
  try {
    const arr = JSON.parse(fs.readFileSync(STORE_INDEX, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch (err) { return []; }
}

function storeSave(list) {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(STORE_INDEX, JSON.stringify(list, null, 2));
  } catch (err) {
    console.error('[store] save failed:', err && err.message || err);
  }
}

function storePublicUrl(id) {
  return SITE_URL + '/api/extensions/' + encodeURIComponent(id) + '/download';
}

function storeListPublic() {
  return storeLoad().map((e) => ({
    id: e.id,
    name: e.name,
    version: e.version,
    author: e.author || '',
    description: e.description || '',
    size: e.size || 0,
    publishedAt: e.publishedAt || null,
    downloads: e.downloads || 0,
    url: storePublicUrl(e.id)
  }));
}

function storeSlug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'extension';
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Upload too large (limit ' + Math.round(limit / 1048576) + ' MB).'));
        try { req.destroy(); } catch (e) { /* ignore */ }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleStoreUpload(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (STORE_UPLOAD_TOKEN) {
      const token = req.headers['x-upload-token'] || url.searchParams.get('token') || '';
      if (token !== STORE_UPLOAD_TOKEN) return sendJson(res, 401, { ok: false, error: 'upload token required' });
    }
    const name = String(url.searchParams.get('name') || '').trim().slice(0, 80);
    const version = String(url.searchParams.get('version') || '').trim().slice(0, 24);
    const author = String(url.searchParams.get('author') || '').trim().slice(0, 80);
    const description = String(url.searchParams.get('description') || '').trim().slice(0, 600);
    if (!name) return sendJson(res, 400, { ok: false, error: 'A name is required.' });
    if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,23}$/.test(version)) {
      return sendJson(res, 400, { ok: false, error: 'A version like 1.0.0 is required.' });
    }
    const body = await readBody(req, STORE_MAX_BYTES);
    if (!body.length) return sendJson(res, 400, { ok: false, error: 'The upload was empty.' });
    const isZip = body[0] === 0x50 && body[1] === 0x4b;
    const isCrx = body.toString('ascii', 0, 4) === 'Cr24';
    if (!isZip && !isCrx) {
      return sendJson(res, 400, { ok: false, error: 'The upload must be a .crx or .zip extension package.' });
    }

    const id = storeSlug(name) + '-' + Date.now().toString(36);
    const fileName = id + (isCrx ? '.crx' : '.zip');
    fs.mkdirSync(STORE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STORE_DIR, fileName), body);

    const list = storeLoad();
    const entry = {
      id, file: fileName, name, version, author, description,
      size: body.length, publishedAt: new Date().toISOString(), downloads: 0
    };
    const dup = list.findIndex((e) => e.name === name && e.version === version);
    if (dup >= 0) {
      const old = list[dup];
      if (old.file && old.file !== fileName) {
        try { fs.rmSync(path.join(STORE_DIR, old.file), { force: true }); } catch (e) { /* ignore */ }
      }
      entry.downloads = old.downloads || 0;
      list[dup] = entry;
    } else {
      list.unshift(entry);
    }
    storeSave(list);
    console.log('[store] published ' + name + ' ' + version + ' (' + body.length + ' bytes) as ' + id);
    return sendJson(res, 201, { ok: true, id, url: storePublicUrl(id) });
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: (err && err.message) || String(err) });
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(body);
}

function latestPayload() {
  const win = latest.downloads && latest.downloads.windows;
  return Object.assign({}, latest, {
    url: (win && win.url) || '',
    size: (win && win.size) || 0,
    checkedAt: lastCheckedAt || latest.checkedAt || null
  });
}

function redirect(res, url) {
  res.writeHead(302, { Location: url, 'cache-control': 'no-store' });
  res.end();
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  // Never expose internals: the store database, dotfiles or dependencies.
  if (/^\/(?:data|node_modules)\//i.test(rel) || /^\/\./.test(rel)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  // Block path traversal.
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600'
  });
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------
function route(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;

  if (pathname === '/health') {
    return sendJson(res, 200, { ok: true, service: 'fusionhub-site', version: latest.version, site: SITE_URL });
  }
  if (pathname === '/api/latest' || pathname === '/api/version' || pathname === '/version') {
    return sendJson(res, 200, latestPayload());
  }
  if (pathname === '/download/windows') {
    const win = latest.downloads && latest.downloads.windows;
    if (!win || !win.url) return sendJson(res, 404, { ok: false, error: 'windows download not configured' });
    return redirect(res, win.url);
  }
  if (pathname === '/download/linux') {
    const deb = latest.downloads && latest.downloads.linux;
    if (!deb || !deb.url) return sendJson(res, 404, { ok: false, error: 'linux download not configured' });
    return redirect(res, deb.url);
  }
  if (pathname === '/api/extensions') {
    if (req.method === 'POST') return handleStoreUpload(req, res);
    return sendJson(res, 200, { ok: true, extensions: storeListPublic() });
  }
  const extDl = /^\/api\/extensions\/([^/]+)\/download$/.exec(pathname);
  if (extDl && req.method === 'GET') {
    const id = decodeURIComponent(extDl[1]);
    const list = storeLoad();
    const entry = list.find((e) => e.id === id);
    if (!entry || !entry.file) return sendJson(res, 404, { ok: false, error: 'not found' });
    const file = path.normalize(path.join(STORE_DIR, entry.file));
    if (!file.startsWith(STORE_DIR) || !fs.existsSync(file)) return sendJson(res, 404, { ok: false, error: 'file missing' });
    entry.downloads = (entry.downloads || 0) + 1;
    storeSave(list);
    const st = fs.statSync(file);
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': st.size,
      'content-disposition': 'attachment; filename="' + entry.file + '"',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    });
    return fs.createReadStream(file).pipe(res);
  }
  if (pathname === '/releases') {
    return redirect(res, 'https://github.com/' + SITE_REPO + '/releases');
  }
  if (pathname === '/refresh' && req.method === 'POST') {
    refreshQuietly();
    return sendJson(res, 202, { ok: true, message: 'refresh started' });
  }

  return serveStatic(req, res, pathname);
}

refreshQuietly();
setInterval(refreshQuietly, REFRESH_MS).unref();

http.createServer((req, res) => {
  try { route(req, res); } catch (err) {
    console.error('[site] request error:', err && err.message || err);
    try { sendJson(res, 500, { ok: false, error: 'internal error' }); } catch (e) { /* ignore */ }
  }
}).listen(PORT, HOST, () => {
  console.log('[site] listening on http://' + HOST + ':' + PORT + ' (canonical: ' + SITE_URL + ')');
  console.log('[site] serving v' + latest.version + ' from ' + latest.source);
});
