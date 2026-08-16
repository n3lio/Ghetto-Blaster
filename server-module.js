const express = require('express');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { parseFile } = require('music-metadata');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const QRCode = require('qrcode');
const validation = require('./lib/validation');
const playlistLib = require('./lib/playlists');
const { ScannerPool } = require('./lib/scanner-pool');
const { setLogConfig, getLogger } = require('./lib/logger');
const { buildMockLibrary, buildMockGenres } = require('./lib/mock-library');
const migrations = require('./lib/migrations');
const backupLib = require('./lib/backup');
const m3u = require('./lib/m3u');
const lyricsLib = require('./lib/lyrics');
const multitag = require('./lib/multitag');
const radio = require('./lib/radio');
const queryLib = require('./lib/query');
let backupTimer = null;
let log = getLogger();
let scannerPool = null;
// chokidar is more reliable than fs.watch (esp. recursive on Windows)
let chokidar = null;
try { chokidar = require('chokidar'); } catch (e) { /* optional dep, falls back to fs.watch */ }
let serverInstance = null;
let wssInstance = null;
let watcherInstance = null;

// ─── Data directory (set by main.js before startServer, or fallback to __dirname)
let DATA_DIR = __dirname;

// Default smart playlists (created on first run). Sized so a typical user
// has a sensible starter set without ending up with 30 default lists. Each
// entry is `{ name, genreMatch, genreExclude? }`. The exclude list keeps
// near-misses out (e.g. Hip-Hop US doesn't sweep up Rap Français).
const DEFAULT_PLAYLISTS = [
  // English-speaking hip-hop. Excludes 'french' / 'rap français' so the
  // FR scene stays in its own list below.
  { name: 'Hip-Hop',     genreMatch: ['hip-hop', 'hiphop', 'hip hop', 'rap'],
                         genreExclude: ['rap français', 'rap francais', 'french rap', 'rap fr'] },
  { name: 'Rap Français', genreMatch: ['rap français', 'rap francais', 'french rap', 'rap fr'] },
  { name: 'Electro',      genreMatch: ['electro', 'electronic', 'edm', 'house', 'techno', 'trance', 'dubstep'] },
  { name: 'Rock',         genreMatch: ['rock', 'punk', 'metal', 'grunge', 'hard rock'] },
  { name: 'Alternative',  genreMatch: ['alternative', 'indie', 'alt'] },
  { name: 'Pop',          genreMatch: ['pop', 'synth-pop', 'synthpop'] },
  { name: 'Reggae',       genreMatch: ['reggae', 'ragga', 'dancehall', 'dub', 'ska'] },
  { name: 'Latin',        genreMatch: ['latin', 'reggaeton', 'salsa', 'bachata', 'cumbia', 'latino'] },
  { name: 'Jazz',         genreMatch: ['jazz', 'bebop', 'swing', 'bossa', 'fusion'] },
  { name: 'Soul / Funk',  genreMatch: ['soul', 'funk', 'r&b', 'rnb', 'rhythm and blues', 'motown'] },
  { name: 'Classical',    genreMatch: ['classical', 'classique', 'baroque', 'romantic', 'orchestral', 'opera', 'symphony', 'concerto', 'chamber'] },
];

function createDefaultPlaylists() {
  // First-run shortcut: no smart playlists yet → ship the whole default set.
  if (!playlists.some(p => p.type === 'smart')) {
    for (const def of DEFAULT_PLAYLISTS) {
      playlists.push({
        id: crypto.randomUUID(),
        name: def.name,
        type: 'smart',
        genreMatch: def.genreMatch,
        genreExclude: def.genreExclude || null,
        trackIds: [],
        createdAt: new Date().toISOString(),
      });
    }
    savePlaylists();
    if (typeof log !== 'undefined' && log) log.info('default playlists created', { count: DEFAULT_PLAYLISTS.length });
    return;
  }

  // Existing installs: backfill any newly-shipped default that isn't there
  // by name. We DON'T re-create one the user explicitly deleted (that
  // requires a separate hint to know they removed it on purpose), but we
  // do top up Classical / Jazz / Rap Français / Soul-Funk for the v3.15.5
  // bump. We also patch in `genreExclude` on a Hip-Hop entry that was
  // shipped before the exclude field existed.
  const existingByName = new Map();
  for (const p of playlists) {
    if (p.type === 'smart' && p.name) existingByName.set(p.name.toLowerCase(), p);
  }
  let added = 0, patched = 0;
  for (const def of DEFAULT_PLAYLISTS) {
    const found = existingByName.get(def.name.toLowerCase());
    if (!found) {
      playlists.push({
        id: crypto.randomUUID(),
        name: def.name,
        type: 'smart',
        genreMatch: def.genreMatch,
        genreExclude: def.genreExclude || null,
        trackIds: [],
        createdAt: new Date().toISOString(),
      });
      added++;
    } else if (def.genreExclude && !found.genreExclude) {
      // Existing playlist, no exclude yet — adopt the shipped one so
      // 'Hip-Hop' stops sweeping up 'Rap Français'.
      found.genreExclude = def.genreExclude;
      patched++;
    }
  }
  if (added > 0 || patched > 0) {
    savePlaylists();
    if (typeof log !== 'undefined' && log) log.info('default playlists topped up', { added, patched });
  }
}

function setDataDir(dir) {
  DATA_DIR = dir;
  // Reload config from the correct location first so the logger has its
  // settings before migrations log anything.
  config = loadConfig();
  ensureAuthToken();
  // Wire the logger up early so migration steps land in the persistent log.
  log = setLogConfig({
    dir: path.join(DATA_DIR, 'logs'),
    level: (config && config.logLevel) || 'info',
    pretty: !!(config && config.devMode),
    name: 'server',
  });
  // Apply any pending JSON schema migrations before loading the files. Each
  // migration snapshots its target into `migrations-backup/` so a botched
  // run can be reverted by hand.
  try {
    migrations.migrateAll(DATA_DIR, log);
  } catch (e) {
    log.error('migrations: aborted', { error: e.message });
  }
  libraryIds = loadLibraryIds();
  playlists = loadPlaylists();
  history = loadHistory();
  favorites = loadFavorites();
  createDefaultPlaylists();
  // Ensure covers dir exists
  const coversDir = path.join(DATA_DIR, '__covers');
  if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });
  // Schedule daily backups (best-effort, unref'd timer so it can't keep the
  // process alive on quit).
  if (backupTimer) backupTimer.stop();
  backupTimer = backupLib.startScheduledBackups(DATA_DIR, log);
  // Load the library cache so the incremental mtime-skip works from the
  // first scan at boot. Without this the library is empty and every file
  // is re-parsed despite having the same mtime.
  loadLibraryCache();
  log.info('data dir set', { dir, cachedTracks: library.filter(Boolean).length });
}

// ─── Auth Token (LAN access) ────────────────────────────────────────────────
function ensureAuthToken() {
  if (!config.authToken) {
    config.authToken = crypto.randomBytes(16).toString('hex');
    try {
      fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
      console.log('Generated new LAN auth token');
    } catch (e) { console.warn('Could not persist auth token:', e.message); }
  }
  return config.authToken;
}

function getAuthToken() { return config.authToken; }

// ─── Library IDs map (path → stable numeric id) ─────────────────────────────
// Persisted so that ids survive across rescans/restarts. Without this, a track's
// id is its index in scan order, which shifts whenever a file is added/removed —
// breaking favorites, history, and manual playlists.
function getLibraryIdsPath() { return path.join(DATA_DIR, 'library-ids.json'); }
let libraryIds = { paths: {}, nextId: 0 };

function loadLibraryIds() {
  try {
    const p = getLibraryIdsPath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      // Accept both the v1 wrapped shape and the legacy bare shape — migrations
      // run before this point but be defensive in case a user side-loads an
      // older file.
      const paths = (data && data.paths) || {};
      const nextId = (data && typeof data.nextId === 'number') ? data.nextId : 0;
      return { paths, nextId };
    }
  } catch (e) { (log || console).warn('library-ids load failed', { error: e.message }); }
  return { paths: {}, nextId: 0 };
}

function saveLibraryIds() {
  try {
    fs.writeFileSync(getLibraryIdsPath(), JSON.stringify({
      _version: migrations.LATEST['library-ids.json'],
      paths: libraryIds.paths,
      nextId: libraryIds.nextId,
    }, null, 2));
  } catch (e) { (log || console).warn('library-ids save failed', { error: e.message }); }
}

function getOrAssignTrackId(canonicalPath) {
  if (libraryIds.paths[canonicalPath] != null) return libraryIds.paths[canonicalPath];
  const id = libraryIds.nextId++;
  libraryIds.paths[canonicalPath] = id;
  return id;
}

// ─── Config (stored in userData so it survives updates) ─────────────────────
const DEFAULT_CONFIG = {
  musicFolders: [],
  excludeFolders: [],
  port: 3000,
  scanOnStartup: true,
  watchForChanges: true,
  maxConnections: 20,
  lanEnabled: true,
  // v3.15.3: turn on the worker pool by default. Sequential parseFile()
  // capped scans at ~10 tracks/sec on n3lio's 8000-track library — the
  // pool with 4 workers gets us 3-4× faster.
  scanInWorker: true,
};

function getConfigPath() { return path.join(DATA_DIR, 'config.json'); }

function loadConfig() {
  try {
    const cfgPath = getConfigPath();
    if (fs.existsSync(cfgPath)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) };
    }
  } catch (e) { /* corrupt file, use default */ }
  // First run: try shipped config as seed, then default
  try {
    const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    return { ...DEFAULT_CONFIG, ...shipped };
  } catch (e) { return DEFAULT_CONFIG; }
}

let config = loadConfig();

// ─── State ───────────────────────────────────────────────────────────────────
let library = [];
let genres = new Set();
let queue = [];
let currentIndex = 0;
let isPlaying = false;

// Playlists stored in a JSON file
function getPlaylistsPath() { return path.join(DATA_DIR, 'playlists.json'); }
let playlists = loadPlaylists();

function loadPlaylists() {
  try {
    var p = getPlaylistsPath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      return migrations.unwrap(raw, 'items');
    }
  } catch (e) { (log || console).warn('playlists load failed', { error: e.message }); }
  return [];
}

function savePlaylists() {
  fs.writeFileSync(getPlaylistsPath(), JSON.stringify({
    _version: migrations.LATEST['playlists.json'],
    items: playlists,
  }, null, 2));
}

// ─── History ────────────────────────────────────────────────────────────────
function getHistoryPath() { return path.join(DATA_DIR, 'history.json'); }
let history = loadHistory();

function loadHistory() {
  try {
    var p = getHistoryPath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      return migrations.unwrap(raw, 'entries');
    }
  } catch (e) {}
  return [];
}

function saveHistory() {
  fs.writeFileSync(getHistoryPath(), JSON.stringify({
    _version: migrations.LATEST['history.json'],
    entries: history.slice(0, 5000),
  }, null, 2));
}

// ─── Favorites ──────────────────────────────────────────────────────────────
function getFavoritesPath() { return path.join(DATA_DIR, 'favorites.json'); }
let favorites = loadFavorites();

function loadFavorites() {
  try {
    var p = getFavoritesPath();
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const ids = migrations.unwrap(raw, 'ids');
      return new Set(Array.isArray(ids) ? ids : []);
    }
  } catch(e) {}
  return new Set();
}

function saveFavorites() {
  fs.writeFileSync(getFavoritesPath(), JSON.stringify({
    _version: migrations.LATEST['favorites.json'],
    ids: [...favorites],
  }));
}

function logPlay(trackId) {
  var track = library[trackId];
  if (!track) return;
  history.unshift({
    id: trackId,
    title: track.title,
    artist: track.artist,
    genre: track.genre,
    hasCover: track.hasCover,
    playedAt: new Date().toISOString(),
  });
  if (history.length > 5000) history = history.slice(0, 5000);
  saveHistory();
}

// ─── Cover Cache ────────────────────────────────────────────────────────────
function getCoversDir() { return path.join(DATA_DIR, '__covers'); }
// Ensure covers dir exists at startup
(function() { var d = getCoversDir(); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); })();

// ─── Library cache (persisted between sessions) ──────────────────────────────
// Without a cache the library is rebuilt from scratch every time the server
// boots — each file parsed again regardless of mtime. With this cache the
// incremental skip works on the very first scan after a reboot.
function getLibraryCachePath() { return path.join(DATA_DIR, 'library-cache.json'); }

function loadLibraryCache() {
  try {
    const p = getLibraryCachePath();
    if (!fs.existsSync(p)) return;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!data || !Array.isArray(data.entries)) return;
    data.entries.forEach(function(entry) {
      if (!entry || typeof entry.id !== 'number') return;
      library[entry.id] = entry;
      if (entry.genre) genres.add(entry.genre);
    });
    if (typeof log !== 'undefined' && log) {
      log.info('library cache loaded', { tracks: library.filter(Boolean).length });
    }
  } catch (e) {
    if (typeof log !== 'undefined' && log) log.warn('library cache load failed', { error: e.message });
  }
}

function saveLibraryCache() {
  try {
    const entries = library.filter(Boolean);
    fs.writeFileSync(getLibraryCachePath(), JSON.stringify({ entries: entries }));
  } catch (e) {
    if (typeof log !== 'undefined' && log) log.warn('library cache save failed', { error: e.message });
  }
}

// ─── Infer music folders from library track paths ─────────────────────────
// Used by /api/config/public when config.musicFolders is empty but the
// library cache holds tracks (recovery case after a bad config save).
// Returns the longest common path prefixes per drive, deduplicated.
function inferFoldersFromLibrary() {
  const paths = library.filter(Boolean).map(t => t.path).filter(Boolean);
  if (paths.length === 0) return [];
  // Group by top-level drive (Windows) or filesystem root (Unix).
  const byRoot = new Map();
  for (const p of paths) {
    const root = path.parse(p).root || '/';
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(p);
  }
  const folders = new Set();
  for (const [, group] of byRoot) {
    // Find the deepest common directory.
    if (group.length === 0) continue;
    const parts = group[0].split(/[\\/]/);
    let commonDepth = parts.length - 1; // exclude filename
    for (let i = 1; i < group.length; i++) {
      const otherParts = group[i].split(/[\\/]/);
      let d = 0;
      while (d < commonDepth && d < otherParts.length - 1 && otherParts[d] === parts[d]) d++;
      commonDepth = d;
    }
    if (commonDepth > 0) {
      const common = parts.slice(0, commonDepth).join(path.sep);
      if (common) folders.add(path.resolve(common));
    }
  }
  return Array.from(folders);
}

// ─── Library Scanner ─────────────────────────────────────────────────────────
const AUDIO_EXTENSIONS = validation.AUDIO_EXTENSIONS;
let scanning = false;

// Resolves to a normalized metadata shape regardless of whether parsing happens
// inline (default) or in a worker (opt-in via config.scanInWorker).
async function parseTrackMetadata(filePath) {
  if (scannerPool && scannerPool.available()) {
    try {
      const r = await scannerPool.parseFile(filePath);
      return {
        common: {
          title: r.title || undefined,
          artist: r.artist || undefined,
          albumartist: r.albumArtist || undefined,
          album: r.album || undefined,
          year: r.year || undefined,
          genre: r.genre ? [r.genre] : undefined,
          picture: r.picture ? [{ data: Buffer.from(r.picture.data), format: r.picture.format }] : undefined,
        },
        format: { duration: r.duration || 0 },
      };
    } catch (e) {
      // Worker failed for this file — fall back to inline parse so we don't
      // lose the track entirely.
    }
  }
  return parseFile(filePath);
}

async function scanFolders() {
  if (scanning) { log.info('scan skipped — already in progress'); return library; }
  scanning = true;
  const scanStartedAt = Date.now();

  // Reload config (may have been updated via settings)
  config = loadConfig();

  // Lazily start the worker pool when explicitly enabled. Off by default —
  // the cost is small at scan time and the failure mode is well-tested inline.
  if (config.scanInWorker && !scannerPool) {
    const pool = new ScannerPool();
    if (pool.start()) {
      scannerPool = pool;
      log.info('scanner pool started', { workers: pool.size });
    }
  }

  const excludeFolders = new Set((config.excludeFolders || []).map(f => f.toLowerCase()));

  log.info('scan starting', {
    folders: config.musicFolders,
    workerPoolActive: !!(scannerPool && scannerPool.available()),
    workerCount: scannerPool ? scannerPool.size : 0,
    existingTracks: trackCount(),
  });
  broadcast({ type: 'scan:start' });
  // v3.15.14: don't wipe the library at the start of a scan. With the
  // previous behaviour, the user could not 'Shuffle All' or play any
  // track while a rescan was in flight — every track id 404'd until the
  // scanner caught up. Instead, keep the existing library and refresh
  // entries as we go; we still prune deleted paths at the end via the
  // seenPaths set.
  // Genres are rebuilt incrementally — start with whatever we already
  // know so the UI doesn't lose its dropdown options during the scan.
  // (At end-of-scan we recompute the set from the live library to drop
  // genres that came from now-deleted tracks.)

  // Track which paths are seen this scan (to prune deleted entries from the id map)
  const seenPaths = new Set();

  // Cover cache strategy: keep what we have, regenerate only when missing or
  // when the source file's mtime changed since the cache was written. After
  // the scan we delete cover files whose track id no longer exists.
  // (Old behaviour was to wipe everything on every rescan — slow on large
  // libraries.)
  for (const folder of config.musicFolders) {
    const resolved = path.resolve(folder);
    if (!fs.existsSync(resolved)) {
      console.warn(`Folder not found: ${resolved}`);
      continue;
    }
    await scanDirectory(resolved, excludeFolders, seenPaths);
  }

  // Prune deleted paths from the id map so it doesn't grow forever, AND
  // drop the corresponding library entries (we kept the old library
  // around during the scan so playback worked, now sweep stale rows).
  for (const p of Object.keys(libraryIds.paths)) {
    if (!seenPaths.has(p)) {
      const staleId = libraryIds.paths[p];
      delete libraryIds.paths[p];
      if (Number.isInteger(staleId) && library[staleId]) {
        delete library[staleId];
      }
    }
  }
  saveLibraryIds();

  // Rebuild the genres set from what's actually in the library now,
  // so deleted tracks' genres drop off.
  genres = new Set();
  for (let i = 0; i < library.length; i++) {
    const t = library[i];
    if (t && t.genre) genres.add(t.genre);
  }

  // Sweep cover cache: remove files whose track id is no longer in the library.
  try {
    const validIds = new Set();
    for (let i = 0; i < library.length; i++) if (library[i] != null) validIds.add(String(library[i].id));
    const existing = fs.readdirSync(getCoversDir());
    for (const file of existing) {
      const dot = file.lastIndexOf('.');
      const idStr = dot === -1 ? file : file.slice(0, dot);
      if (!validIds.has(idStr)) {
        try { fs.unlinkSync(path.join(getCoversDir(), file)); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }

  scanning = false;
  const count = library.filter(Boolean).length;
  log.info('scan done', {
    tracks: count,
    genres: genres.size,
    durationMs: Date.now() - scanStartedAt,
  });
  // Persist the library so the next boot starts with it and the
  // incremental mtime-skip can short-circuit 99% of the work.
  saveLibraryCache();
  broadcast({ type: 'scan:done', data: { count, genres: genres.size } });
  return library;
}

// Returns the cover file path for a given track id if one is already cached
// and matches the source file's mtime. The cache stores `<id>.<ext>` next to
// `<id>.<ext>.mtime` (a tiny sidecar holding the source mtime as ms since epoch).
function findCachedCover(trackId, sourceMtimeMs) {
  const dir = getCoversDir();
  for (const ext of ['.jpg', '.png', '.webp', '.gif']) {
    const coverPath = path.join(dir, `${trackId}${ext}`);
    if (!fs.existsSync(coverPath)) continue;
    const sidecar = coverPath + '.mtime';
    try {
      if (fs.existsSync(sidecar)) {
        const stored = parseInt(fs.readFileSync(sidecar, 'utf8'), 10);
        if (stored === Math.floor(sourceMtimeMs)) return coverPath;
      }
    } catch (e) { /* ignore */ }
  }
  return null;
}

function writeCachedCover(trackId, ext, data, sourceMtimeMs) {
  const coverPath = path.join(getCoversDir(), `${trackId}${ext}`);
  try {
    fs.writeFileSync(coverPath, data);
    fs.writeFileSync(coverPath + '.mtime', String(Math.floor(sourceMtimeMs)));
  } catch (e) {
    console.warn(`Could not cache cover for track ${trackId}:`, e.message);
  }
}

// Parses one audio file and stores it in library[trackId]. Extracted from
// the inner loop so we can run a batch of these concurrently — each call
// does its own try/catch, so one bad file doesn't take down the batch.
async function ingestAudioFile(fullPath, entryName) {
  const trackId = getOrAssignTrackId(fullPath);
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(fullPath).mtimeMs; } catch (e) { /* ignore */ }

  // ─── Incremental skip ──────────────────────────────────────────────────
  // If the track already exists in the library (previous scan or boot) AND
  // its mtime is unchanged since we last parsed it, there's zero point in
  // re-reading the metadata — it hasn't changed. This turns subsequent
  // rescans from O(n * parse_cost) into O(n * stat_cost) for unchanged
  // files, which is a ~20-50× speedup after the first scan.
  const existing = library[trackId];
  if (existing && existing._mtimeMs === Math.floor(mtimeMs)) {
    // File unchanged — keep the existing entry and just update the genre
    // set (genres is rebuilt from scratch at end-of-scan, but we add here
    // too so the mid-scan state is consistent).
    if (existing.genre) genres.add(existing.genre);
    return;
  }

  try {
    // Re-use cached cover if the source mtime matches.
    const cachedCoverPath = findCachedCover(trackId, mtimeMs);
    const metadata = await parseTrackMetadata(fullPath);
    const genre = metadata.common.genre ? metadata.common.genre[0] : null;
    if (genre) genres.add(genre);

    const picture = metadata.common.picture && metadata.common.picture[0];
    const hasCover = !!picture || !!cachedCoverPath;

    if (picture && !cachedCoverPath) {
      let ext = '.jpg';
      if (picture.format) {
        if (picture.format.includes('png')) ext = '.png';
        else if (picture.format.includes('webp')) ext = '.webp';
        else if (picture.format.includes('gif')) ext = '.gif';
      }
      writeCachedCover(trackId, ext, picture.data, mtimeMs);
    }

    // ReplayGain track gain in dB, if tagged.
    let replayGain = null;
    const rg = metadata.common && metadata.common.replayGainTrackGain;
    if (rg && typeof rg.dB === 'number' && Number.isFinite(rg.dB)) {
      replayGain = rg.dB;
    }

    const rawArtist = metadata.common.artist || 'Unknown';
    const rawGenre = genre;

    library[trackId] = {
      id: trackId,
      path: fullPath,
      filename: entryName,
      title: metadata.common.title || entryName.replace(/\.[^/.]+$/, ''),
      artist: rawArtist,
      artists: multitag.splitArtistTag(rawArtist),
      albumArtist: metadata.common.albumartist || '',
      album: metadata.common.album || '',
      year: metadata.common.year || null,
      duration: metadata.format.duration || 0,
      genre: rawGenre,
      genres: multitag.splitGenreTag(rawGenre),
      hasCover,
      replayGain,
      _mtimeMs: Math.floor(mtimeMs),
    };
  } catch (e) {
    library[trackId] = {
      id: trackId,
      path: fullPath,
      filename: entryName,
      title: entryName.replace(/\.[^/.]+$/, ''),
      artist: 'Unknown',
      albumArtist: '',
      album: '',
      year: null,
      duration: 0,
      genre: null,
      hasCover: false,
    };
  }
}

async function scanDirectory(dir, excludeFolders, seenPaths) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    log.warn('cannot read directory', { dir });
    return;
  }

  // Split into subdirectories and audio files so we can parallelize the
  // audio parses (the slow part) and recurse into folders separately.
  const subdirs = [];
  const audioFiles = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (excludeFolders.has(entry.name.toLowerCase())) continue;
      subdirs.push(fullPath);
    } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      audioFiles.push({ fullPath, entryName: entry.name });
      if (seenPaths) seenPaths.add(fullPath);
    }
  }

  // Parallel batch of audio file parses — concurrency tuned to the worker
  // pool size when available, otherwise a higher-than-sequential number
  // that lets I/O and CPU overlap on the main thread. v3.15.14 bumps the
  // inline fallback from 8 to 16 to squeeze more throughput when workers
  // aren't available (common on first run before the pool stabilizes).
  const concurrency = (scannerPool && scannerPool.available()) ? scannerPool.size * 3 : 16;
  for (let i = 0; i < audioFiles.length; i += concurrency) {
    const slice = audioFiles.slice(i, i + concurrency);
    await Promise.all(slice.map(f => ingestAudioFile(f.fullPath, f.entryName)));
    // Yield back to the event loop between batches so the WS / viz keep
    // breathing while a big folder is being parsed.
    await new Promise(r => setImmediate(r));
  }

  // Recurse into subdirectories sequentially (parallelizing here would
  // multiply the parallel parse workload by the depth of the tree).
  for (const sub of subdirs) {
    await scanDirectory(sub, excludeFolders, seenPaths);
  }
}

// ─── Security: validate track ID ─────────────────────────────────────────────
function getTrackById(id) {
  const numId = parseInt(id);
  if (isNaN(numId) || numId < 0) return null;
  return library[numId] || null;
}

// True iff `id` references an existing track in the (sparse) library.
function isValidTrackId(id) {
  return typeof id === 'number' && id >= 0 && library[id] != null;
}

// Count of actual tracks (library is sparse — library.length is misleading).
function trackCount() {
  let n = 0;
  for (let i = 0; i < library.length; i++) if (library[i] != null) n++;
  return n;
}

// ─── WebSocket ───────────────────────────────────────────────────────────────
const clients = new Set();

// Debounced broadcasts: collapse bursts of the same `type` (e.g. state updates
// during a big scan) into one delivery per ~80ms. Without this, heavy scans
// can overwhelm mobile clients with hundreds of WS frames per second.
// Note: 'preferences:changed' is intentionally NOT debounced so settings sync
// is immediate even during slider drags; the client-side throttle (200ms)
// prevents server-side spam.
const DEBOUNCED_TYPES = new Set(['state', 'desktop:state', 'users:changed']);
const _pendingBroadcasts = new Map(); // type → { timer, lastMessage }

function _flushBroadcast(type) {
  const entry = _pendingBroadcasts.get(type);
  if (!entry) return;
  _pendingBroadcasts.delete(type);
  const payload = JSON.stringify(entry.lastMessage);
  clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(payload);
  });
}

function broadcast(message) {
  if (message && DEBOUNCED_TYPES.has(message.type)) {
    let entry = _pendingBroadcasts.get(message.type);
    if (entry) {
      // Replace the queued message with the latest snapshot — clients only
      // need the most recent state, not every intermediate one.
      entry.lastMessage = message;
      return;
    }
    entry = { lastMessage: message, timer: null };
    entry.timer = setTimeout(() => _flushBroadcast(message.type), 80);
    _pendingBroadcasts.set(message.type, entry);
    return;
  }
  // Non-debounced events (scan:start, scan:done, library-updated, etc.) go
  // out immediately — they're rare and clients react synchronously.
  const payload = JSON.stringify(message);
  clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(payload);
  });
}

// Desktop player state (broadcast by the Electron app)
let desktopState = { trackId: null, title: '', artist: '', isPlaying: false, progress: 0, duration: 0 };

function getState() {
  return {
    queue: queue.map(id => library[id]).filter(Boolean),
    currentIndex,
    isPlaying,
    currentTrack: queue[currentIndex] != null ? library[queue[currentIndex]] : null,
    desktop: desktopState,
  };
}


// ─── Get LAN IP ─────────────────────────────────────────────────────────────
function getLanIp() {
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '0.0.0.0';
}

// ─── Start Server ───────────────────────────────────────────────────────────
function startServer(port) {
  return new Promise((resolve, reject) => {
    if (serverInstance) {
      resolve({ ip: getLanIp(), port });
      return;
    }

    const app = express();

    // ─── Security: minimal CSP ──────────────────────────────────────────────
    // The renderer is fully self-hosted (no external CDNs). All JS/CSS is
    // currently inline in public/index.html, so we allow 'unsafe-inline' until
    // Phase 4 splits them out. Audio/cover assets come from the same origin.
    // WebSocket explicit because helmet would otherwise block ws:// in CSP.
    app.use(helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          // Google Fonts stylesheet is pulled from fonts.googleapis.com and the
          // actual woff2 files from fonts.gstatic.com (see index.html <link>).
          // Without these two, the CSP blocks the font on mobile browsers and
          // the UI falls back to an unstyled system font (looked like a broken
          // page). Everything else stays same-origin.
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }));

    const apiLimiter = rateLimit({
      windowMs: 1 * 60 * 1000,
      max: 600,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, slow down.' },
      skip: (req) => req.path.startsWith('/api/cover/') || req.path.startsWith('/api/stream/'),
    });
    app.use('/api/', apiLimiter);

    const rescanLimiter = rateLimit({
      windowMs: 5 * 60 * 1000,
      max: 3,
      message: { error: 'Rescan limited to 3 per 5 minutes.' },
    });

    // Tighter limit on the remote command endpoint to make spam from a
    // misbehaving (or malicious) LAN client harder.
    const remoteLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many remote commands.' },
    });

    app.use(express.json({ limit: '10mb' }));

    // Request logger — concise, only the path + status + duration. Skips
    // /api/stream/ and /api/cover/ so we don't drown in media noise.
    app.use((req, res, next) => {
      if (req.path.startsWith('/api/stream/') || req.path.startsWith('/api/cover/')) {
        return next();
      }
      const startedAt = Date.now();
      res.on('finish', () => {
        log.debug('http', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - startedAt,
        });
      });
      next();
    });

    app.use(express.static(path.join(__dirname, 'public')));

    // ─── Auth ────────────────────────────────────────────────────────────────
    // The desktop app loads http://localhost:3000 (bypassed). LAN clients must
    // present the token from the QR code, either as Authorization header or
    // ?t=TOKEN query param (needed for <audio>/<img> URLs that can't set headers).
    function isLocalRequest(req) {
      const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
      return ip === '127.0.0.1' || ip === '::1';
    }

    function authMiddleware(req, res, next) {
      // /api/health is deliberately unauthenticated — mobile clients need
      // to verify the server is reachable BEFORE they present a token.
      // Returns only version/uptime/library-count, no secrets.
      if (req.path === '/health') return next();
      if (isLocalRequest(req)) return next();
      const expected = getAuthToken();
      const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const queryToken = req.query.t;
      const token = headerToken || queryToken;
      if (token && expected && token === expected) return next();
      return res.status(401).json({ error: 'Unauthorized' });
    }
    app.use('/api/', authMiddleware);

    // ─── API Routes ──────────────────────────────────────────────────────────
    app.get('/api/tracks', (req, res) => {
      const q = req.query.q || '';
      const genre = (req.query.genre || '').trim().toLowerCase();
      // library is sparse (gaps from deleted files) — filter compacts it.
      let results = library.filter(Boolean);
      if (genre) {
        // Genre query param is a separate top-level filter (preserved for
        // older clients that drive the dropdown). Substring match.
        results = results.filter(t => t.genre && t.genre.toLowerCase().includes(genre));
      }
      if (q) {
        // The query string supports operator syntax: `artist:NTM genre:rap
        // year:2010..2015 word`. Plain words (no `key:` prefix) AND across
        // title/artist/album/genre.
        const parsed = queryLib.parseQuery(q);
        results = queryLib.applyQuery(parsed, results);
      }
      // Optional pagination — clients that want everything in one shot can
      // skip both params (legacy behavior). Lazy-loaders pass `offset` and
      // `limit` and read `X-Total-Count` from the response headers.
      const total = results.length;
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const limit = Math.max(0, parseInt(req.query.limit, 10) || 0);
      if (limit > 0) {
        results = results.slice(offset, offset + limit);
      }
      res.set('X-Total-Count', String(total));
      res.json(results.map(({ path: _, ...rest }) => ({ ...rest, favorited: favorites.has(rest.id) })));
    });

    // Cheap counter for clients that want to decide between eager and lazy
    // load without first downloading the whole library.
    app.get('/api/tracks/count', (req, res) => {
      res.json({ count: trackCount() });
    });

    app.get('/api/genres', (req, res) => {
      res.json([...genres].sort());
    });

    app.get('/api/state', (req, res) => {
      res.json(getState());
    });

    // Inline placeholder SVG — used when a track has no cover art. Picks a
    // hue derived from the track id so different placeholders look distinct
    // on a grid view. Returned with a long Cache-Control because it's
    // synthesized from a deterministic id.
    function placeholderSvg(id) {
      const hue = ((parseInt(id, 10) || 0) * 47) % 360;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">`
        + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
        + `<stop offset="0" stop-color="hsl(${hue},35%,22%)"/>`
        + `<stop offset="1" stop-color="hsl(${(hue + 40) % 360},45%,12%)"/>`
        + `</linearGradient></defs>`
        + `<rect width="200" height="200" fill="url(#g)"/>`
        + `<g fill="none" stroke="hsl(${hue},55%,72%)" stroke-width="3" stroke-linecap="round" opacity="0.7">`
        + `<path d="M76 64v54"/><path d="M132 50v54"/>`
        + `<circle cx="68" cy="120" r="9" fill="hsl(${hue},55%,72%)" stroke="none"/>`
        + `<circle cx="124" cy="106" r="9" fill="hsl(${hue},55%,72%)" stroke="none"/>`
        + `<path d="M76 64l56-12"/></g></svg>`;
    }

    app.get('/api/cover/:id', (req, res) => {
      const track = getTrackById(req.params.id);
      if (!track || !track.hasCover) {
        // v3.15: respond with a deterministic placeholder SVG instead of
        // 404, so every <img src="/api/cover/:id"> in the UI gets something
        // to render. The track still flagged hasCover=false elsewhere if
        // any code wants to special-case "no real cover".
        res.set({
          'Content-Type': 'image/svg+xml; charset=utf-8',
          'Cache-Control': 'public, max-age=2592000', // 30 days, safe — id-derived
        });
        return res.send(placeholderSvg(req.params.id));
      }
      const extensions = ['.jpg', '.png', '.webp', '.gif'];
      for (const ext of extensions) {
        const coverPath = path.join(getCoversDir(), `${track.id}${ext}`);
        if (fs.existsSync(coverPath)) {
          const mimeTypes = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
          res.set({
            'Content-Type': mimeTypes[ext] || 'image/jpeg',
            'Cache-Control': 'public, max-age=604800',
          });
          return res.sendFile(coverPath);
        }
      }
      // Cover file missing on disk despite hasCover=true → still render a
      // placeholder so the UI doesn't break.
      res.set('Content-Type', 'image/svg+xml; charset=utf-8');
      res.send(placeholderSvg(req.params.id));
    });

    const MIME_TYPES = {
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.wav': 'audio/wav',
      '.aac': 'audio/aac',
    };

    app.get('/api/stream/:id', (req, res) => {
      const track = getTrackById(req.params.id);
      if (!track) return res.status(404).json({ error: 'Track not found' });
      const filePath = track.path;
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch (e) {
        return res.status(404).json({ error: 'File not found on disk' });
      }
      // Caching: include the file size + mtime in a weak ETag so clients can
      // skip re-downloading unchanged tracks. Cache-Control 1h is short enough
      // that file edits propagate quickly but long enough that mobile clients
      // don't re-stream the same track in a session.
      const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
      res.set('ETag', etag);
      res.set('Cache-Control', 'private, max-age=3600');
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'audio/mpeg';
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        if (start >= stat.size || end >= stat.size || start > end) {
          return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
        }
        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': contentType,
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(filePath).pipe(res);
      }
    });

    // ─── Body validation helpers ────────────────────────────────────────────
    const MAX_QUEUE_LEN = 10000;
    function isIntegerArray(arr) {
      return Array.isArray(arr) && arr.every(x => Number.isInteger(x));
    }

    // Queue Management
    app.post('/api/queue', (req, res) => {
      const { trackIds } = req.body || {};
      if (!isIntegerArray(trackIds)) return res.status(400).json({ error: 'trackIds must be an array of integers' });
      if (trackIds.length > MAX_QUEUE_LEN) return res.status(400).json({ error: 'queue too large' });
      queue = trackIds.filter(isValidTrackId);
      currentIndex = 0;
      isPlaying = false;
      broadcast({ type: 'state', data: getState() });
      res.json({ ok: true });
    });

    app.post('/api/queue/add', (req, res) => {
      const { trackIds } = req.body || {};
      if (!isIntegerArray(trackIds)) return res.status(400).json({ error: 'trackIds must be an array of integers' });
      const valid = trackIds.filter(isValidTrackId);
      if (queue.length + valid.length > MAX_QUEUE_LEN) {
        return res.status(400).json({ error: 'queue would exceed max size' });
      }
      queue.push(...valid);
      broadcast({ type: 'state', data: getState() });
      res.json({ ok: true, queueLength: queue.length });
    });

    app.post('/api/play', (req, res) => {
      const { index } = req.body;
      if (index != null) {
        const idx = parseInt(index);
        if (isNaN(idx) || idx < 0 || idx >= queue.length) {
          return res.status(400).json({ error: 'Invalid index' });
        }
        currentIndex = idx;
      }
      isPlaying = true;
      broadcast({ type: 'state', data: getState() });
      res.json({ ok: true });
    });

    app.post('/api/pause', (req, res) => {
      isPlaying = false;
      broadcast({ type: 'state', data: getState() });
      res.json({ ok: true });
    });

    app.post('/api/next', (req, res) => {
      if (currentIndex < queue.length - 1) {
        currentIndex++;
        broadcast({ type: 'state', data: getState() });
      } else {
        isPlaying = false;
        broadcast({ type: 'state', data: getState() });
      }
      res.json({ ok: true });
    });

    app.post('/api/prev', (req, res) => {
      if (currentIndex > 0) currentIndex--;
      broadcast({ type: 'state', data: getState() });
      res.json({ ok: true });
    });

    app.post('/api/shuffle', (req, res) => {
      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
      currentIndex = 0;
      broadcast({ type: 'state', data: getState() });
      res.json({ ok: true });
    });

    app.post('/api/rescan', rescanLimiter, async (req, res) => {
      await scanFolders();
      const count = trackCount();
      broadcast({ type: 'library-updated', data: { count } });
      res.json({ ok: true, count });
    });

    // ─── History ─────────────────────────────────────────────────────────────
    app.post('/api/history/log', (req, res) => {
      const { trackId } = req.body;
      if (trackId != null) logPlay(trackId);
      res.json({ ok: true });
    });

    app.get('/api/history/recent', (req, res) => {
      const limit = Math.min(parseInt(req.query.limit) || 50, 500);
      const offset = Math.max(0, parseInt(req.query.offset) || 0);
      res.set('X-Total-Count', String(history.length));
      res.json(history.slice(offset, offset + limit));
    });

    app.get('/api/history/top', (req, res) => {
      // Most played tracks (by play count)
      const counts = {};
      for (const h of history) {
        counts[h.id] = (counts[h.id] || 0) + 1;
      }
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([id, count]) => {
          const t = library[parseInt(id)];
          return t ? { id: t.id, title: t.title, artist: t.artist, genre: t.genre, hasCover: t.hasCover, count } : null;
        })
        .filter(Boolean);
      res.json(sorted);
    });

    // ─── Desktop State (Electron pushes its player state here) ───────────────
    app.post('/api/desktop/state', (req, res) => {
      // Merge — preserve .queue (posted separately via /api/desktop/queue)
      const savedQueue = desktopState.queue;
      desktopState = req.body || {};
      desktopState.queue = savedQueue;
      broadcast({ type: 'desktop:state', data: desktopState });
      res.json({ ok: true });
    });

    app.get('/api/desktop/state', (req, res) => {
      res.json(desktopState);
    });

    // Scan status (mobile checks on connect)
    app.get('/api/scan/status', (req, res) => {
      res.json({ scanning });
    });

    // Full queue (fetched once by mobile, not every second)
    app.get('/api/desktop/queue', (req, res) => {
      res.json(desktopState.queue || []);
    });

    // Endpoint to update queue (desktop posts full queue here on change)
    app.post('/api/desktop/queue', (req, res) => {
      desktopState.queue = req.body || [];
      broadcast({ type: 'desktop:queue-changed', data: { length: desktopState.queue.length } });
      res.json({ ok: true });
    });

    // Remote commands (mobile → desktop via WS broadcast)
    // Whitelist of accepted commands — drops anything unexpected so a
    // misbehaving client can't trick the desktop into running random ops.
    // Guests get a stricter subset (queue suggestions only).
    app.post('/api/remote/command', remoteLimiter, (req, res) => {
      const body = req.body || {};
      const { command } = body;
      if (!command || typeof command !== 'string') {
        return res.status(400).json({ error: 'command required' });
      }
      if (!validation.REMOTE_COMMANDS.has(command)) {
        return res.status(400).json({ error: 'unknown command' });
      }
      // Optional clientId in the body lets us check the sender's role.
      // No clientId → treated as full (backward compat with localhost
      // renderer + old mobile clients that don't send one).
      const clientId = body.clientId || null;
      const sender = clientId ? findUserById(clientId) : null;
      if (sender && sender.role === 'guest' && !validation.GUEST_COMMANDS.has(command)) {
        return res.status(403).json({ error: 'guest cannot run this command', command });
      }
      broadcast({ type: 'remote:command', data: body });
      res.json({ ok: true });
    });

    // QR code for mobile access — embeds the auth token so the phone is
    // immediately authorized after scanning.
    app.get('/api/qrcode', async (req, res) => {
      const ip = getLanIp();
      const port = config.port || 3000;
      const token = getAuthToken();
      const url = token
        ? `http://${ip}:${port}/?t=${encodeURIComponent(token)}`
        : `http://${ip}:${port}`;
      try {
        const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 180 });
        // Return a display URL (without token) so settings UI doesn't leak it.
        res.json({ url: `http://${ip}:${port}`, svg });
      } catch (e) {
        res.status(500).json({ error: 'QR generation failed' });
      }
    });

    // Playlists
    app.get('/api/playlists', (req, res) => {
      res.json(playlists.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type || 'manual',
        genreMatch: p.genreMatch || null,
        trackCount: p.type === 'smart' ? resolvePlaylistTracks(p).length : (p.trackIds || []).length,
        createdAt: p.createdAt,
      })));
    });

    // Resolve smart playlist track IDs from current library
    function resolvePlaylistTracks(pl) {
      if (pl.type === 'smart' && pl.genreMatch) {
        return library
          .filter(t => t.genre && pl.genreMatch.some(m => t.genre.toLowerCase().includes(m)))
          .map(t => t.id);
      }
      // For manual playlists, filter out IDs that no longer exist in library
      return (pl.trackIds || []).filter(isValidTrackId);
    }

    app.get('/api/playlists/:id', (req, res) => {
      const pl = playlists.find(p => p.id === req.params.id);
      if (!pl) return res.status(404).json({ error: 'Playlist not found' });
      const ids = resolvePlaylistTracks(pl);
      res.json({
        ...pl,
        trackCount: ids.length,
        tracks: ids.map(id => library[id]).filter(Boolean).map(({ path: _, ...rest }) => rest),
      });
    });

    app.post('/api/playlists', (req, res) => {
      const { name, trackIds, genres: genreFilter, keywords } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Name required' });
      }

      let resolvedIds = [];
      if (Array.isArray(trackIds) && trackIds.length > 0) {
        resolvedIds = trackIds.filter(isValidTrackId);
      } else if (Array.isArray(genreFilter) && genreFilter.length > 0) {
        const lowerGenres = genreFilter.map(g => g.toLowerCase());
        resolvedIds = library
          .filter(t => t.genre && lowerGenres.includes(t.genre.toLowerCase()))
          .map(t => t.id);
      } else if (keywords && typeof keywords === 'string' && keywords.trim().length > 0) {
        const terms = keywords.toLowerCase().split(/\s+/);
        resolvedIds = library
          .filter(t => terms.some(term =>
            t.title.toLowerCase().includes(term) ||
            t.artist.toLowerCase().includes(term) ||
            t.album.toLowerCase().includes(term) ||
            (t.genre && t.genre.toLowerCase().includes(term))
          ))
          .map(t => t.id);
      }

      if (resolvedIds.length === 0) {
        return res.status(400).json({ error: 'No tracks matched. Provide trackIds, genres, or keywords.' });
      }

      const playlist = {
        id: crypto.randomUUID(),
        name: name.trim(),
        trackIds: resolvedIds,
        createdAt: new Date().toISOString(),
      };

      playlists.push(playlist);
      savePlaylists();
      res.json({ ok: true, playlist: { id: playlist.id, name: playlist.name, trackCount: resolvedIds.length } });
    });

    app.put('/api/playlists/:id', (req, res) => {
      const pl = playlists.find(p => p.id === req.params.id);
      if (!pl) return res.status(404).json({ error: 'Playlist not found' });
      const body = req.body || {};
      if (body.name !== undefined) {
        if (typeof body.name !== 'string' || !body.name.trim()) {
          return res.status(400).json({ error: 'name must be a non-empty string' });
        }
        pl.name = body.name.trim().slice(0, 100);
      }
      if (body.genreMatch !== undefined) {
        if (!Array.isArray(body.genreMatch) || !body.genreMatch.every(g => typeof g === 'string')) {
          return res.status(400).json({ error: 'genreMatch must be an array of strings' });
        }
        pl.genreMatch = body.genreMatch;
      }
      if (body.genreExclude !== undefined) {
        if (!Array.isArray(body.genreExclude) || !body.genreExclude.every(g => typeof g === 'string')) {
          return res.status(400).json({ error: 'genreExclude must be an array of strings' });
        }
        // [] clears the field (UI semantics: empty input = no exclusions).
        pl.genreExclude = body.genreExclude.length ? body.genreExclude : null;
      }
      if (body.trackIds !== undefined) {
        if (!isIntegerArray(body.trackIds)) {
          return res.status(400).json({ error: 'trackIds must be an array of integers' });
        }
        pl.trackIds = body.trackIds.filter(isValidTrackId);
      }
      savePlaylists();
      res.json({ ok: true });
    });

    app.delete('/api/playlists/:id', (req, res) => {
      const idx = playlists.findIndex(p => p.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Playlist not found' });
      playlists.splice(idx, 1);
      savePlaylists();
      res.json({ ok: true });
    });

    app.post('/api/playlists/reorder', (req, res) => {
      const { order } = req.body;
      if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of IDs' });
      const reordered = [];
      for (const id of order) {
        const pl = playlists.find(p => p.id === id);
        if (pl) reordered.push(pl);
      }
      // Keep any playlists not in the order array (safety)
      for (const pl of playlists) {
        if (!reordered.find(p => p.id === pl.id)) reordered.push(pl);
      }
      playlists = reordered;
      savePlaylists();
      res.json({ ok: true });
    });

    app.post('/api/playlists/:id/play', (req, res) => {
      const pl = playlists.find(p => p.id === req.params.id);
      if (!pl) return res.status(404).json({ error: 'Playlist not found' });
      queue = resolvePlaylistTracks(pl);
      currentIndex = 0;
      isPlaying = true;
      broadcast({ type: 'state', data: getState() });
      res.json({ ok: true });
    });

    // ─── Favorites ─────────────────────────────────────────────────────────
    app.get('/api/favorites', (req, res) => {
      res.json([...favorites]);
    });

    app.post('/api/favorites/toggle', (req, res) => {
      const { trackId } = req.body || {};
      if (!Number.isInteger(trackId) || !isValidTrackId(trackId)) {
        return res.status(400).json({ error: 'valid trackId required' });
      }
      if (favorites.has(trackId)) favorites.delete(trackId);
      else favorites.add(trackId);
      saveFavorites();
      res.json({ ok: true, favorited: favorites.has(trackId) });
    });

    // ─── Stats ──────────────────────────────────────────────────────────────
    app.get('/api/stats', (req, res) => {
      const now = new Date();
      const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

      const weekPlays = history.filter(h => new Date(h.playedAt) > weekAgo);
      const monthPlays = history.filter(h => new Date(h.playedAt) > monthAgo);

      // Top artists
      const artistCounts = {};
      monthPlays.forEach(h => { artistCounts[h.artist] = (artistCounts[h.artist] || 0) + 1; });
      const topArtists = Object.entries(artistCounts).sort((a,b) => b[1]-a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));

      // Top genres
      const genreCounts = {};
      monthPlays.forEach(h => { if (h.genre) genreCounts[h.genre] = (genreCounts[h.genre] || 0) + 1; });
      const topGenres = Object.entries(genreCounts).sort((a,b) => b[1]-a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));

      // Listening time estimate (average track ~3.5min)
      const weekMinutes = Math.round(weekPlays.length * 3.5);
      const monthMinutes = Math.round(monthPlays.length * 3.5);

      // Daily plays for last 30 days
      const dailyMap = new Map();
      for (let i = 0; i < 30; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        dailyMap.set(dateStr, 0);
      }
      monthPlays.forEach(h => {
        const dateStr = new Date(h.playedAt).toISOString().split('T')[0];
        if (dailyMap.has(dateStr)) {
          dailyMap.set(dateStr, dailyMap.get(dateStr) + 1);
        }
      });
      const dailyPlays = Array.from(dailyMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, count]) => ({ date, count }));

      // Hourly pattern by day of week (0=Sun, 1=Mon, ..., 6=Sat)
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const hourlyPattern = {};
      dayNames.forEach(d => { hourlyPattern[d] = Array(24).fill(0); });
      monthPlays.forEach(h => {
        const d = new Date(h.playedAt);
        const dayOfWeek = dayNames[d.getDay()];
        const hour = d.getHours();
        hourlyPattern[dayOfWeek][hour]++;
      });

      res.json({
        week: { plays: weekPlays.length, minutes: weekMinutes },
        month: { plays: monthPlays.length, minutes: monthMinutes },
        topArtists,
        topGenres,
        totalTracks: trackCount(),
        favorites: favorites.size,
        dailyPlays,
        hourlyPattern,
      });
    });

    // ─── Duplicates (titre + artiste + durée arrondie) ─────────────────────
    app.get('/api/duplicates', (req, res) => {
      const buckets = new Map();
      for (let i = 0; i < library.length; i++) {
        const t = library[i];
        if (!t) continue;
        const key = [
          (t.title || '').trim().toLowerCase(),
          (t.artist || '').trim().toLowerCase(),
          Math.round(t.duration || 0),
        ].join('|');
        if (!key.startsWith('||')) {
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push({
            id: t.id, title: t.title, artist: t.artist, album: t.album,
            duration: t.duration, hasCover: t.hasCover, filename: t.filename,
          });
        }
      }
      const dupes = [];
      for (const arr of buckets.values()) {
        if (arr.length > 1) dupes.push(arr);
      }
      res.json({ groups: dupes, totalGroups: dupes.length });
    });

    // ─── Playlist export (M3U) ─────────────────────────────────────────────
    app.get('/api/playlists/:id/export.m3u', (req, res) => {
      const pl = playlists.find(p => p.id === req.params.id);
      if (!pl) return res.status(404).json({ error: 'Playlist not found' });
      const ids = playlistLib.resolvePlaylistTracks(pl, library);
      const lines = ['#EXTM3U', `#PLAYLIST:${pl.name || 'Playlist'}`];
      for (const id of ids) {
        const t = library[id];
        if (!t) continue;
        const dur = Math.round(t.duration || 0);
        lines.push(`#EXTINF:${dur},${t.artist || 'Unknown'} - ${t.title || t.filename || 'Track'}`);
        // Stream URL relative to the server — so that other LAN clients can
        // play through the M3U without needing the original file paths.
        lines.push(`/api/stream/${id}`);
      }
      const safe = (pl.name || 'playlist').replace(/[^\w\d-]+/g, '_');
      res.set('Content-Type', 'audio/x-mpegurl');
      res.set('Content-Disposition', `attachment; filename="${safe}.m3u"`);
      res.send(lines.join('\n') + '\n');
    });

    // (Tag editing endpoint removed in v3.14.0 — n3lio uses Mp3tag for
    // metadata edits, no point shipping node-id3 + an unused UI surface.)

    // ─── Duplicate cleanup helper (preview only — never deletes files) ─────
    // Returns which files we'd remove to dedupe, but the actual unlink is
    // done by the user after confirmation in the UI.
    app.get('/api/duplicates/preview', (req, res) => {
      // Same logic as /api/duplicates but flagged with a "keeper" — by
      // default the smallest id wins (stable across rescans).
      const buckets = new Map();
      for (let i = 0; i < library.length; i++) {
        const t = library[i];
        if (!t) continue;
        const key = [
          (t.title || '').trim().toLowerCase(),
          (t.artist || '').trim().toLowerCase(),
          Math.round(t.duration || 0),
        ].join('|');
        if (key.startsWith('||')) continue;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(t);
      }
      const groups = [];
      for (const arr of buckets.values()) {
        if (arr.length <= 1) continue;
        const sorted = [...arr].sort((a, b) => a.id - b.id);
        groups.push({
          keep: { id: sorted[0].id, title: sorted[0].title, artist: sorted[0].artist },
          remove: sorted.slice(1).map(t => ({
            id: t.id, title: t.title, artist: t.artist, filename: t.filename,
          })),
        });
      }
      res.json({ groups });
    });

    // ─── Dev-only endpoints ────────────────────────────────────────────────
    // Gated behind `config.devMode` so they're invisible in normal builds.
    // Surface enough info to debug a flaky scan / weird state without firing
    // up devtools on the renderer.
    function devOnly(req, res, next) {
      if (!config || !config.devMode) {
        return res.status(404).json({ error: 'Not found' });
      }
      next();
    }

    app.get('/api/_dev/health', (req, res) => {
      res.json({
        ok: true,
        version: require('./package.json').version,
        uptime: Math.floor((Date.now() - serverStartTime) / 1000),
        scanning,
        library: trackCount(),
        queue: queue.length,
        clients: clients.size,
        memory: process.memoryUsage(),
        node: process.version,
        platform: process.platform,
        devMode: !!(config && config.devMode),
      });
    });

    app.get('/api/_dev/log-tail', devOnly, (req, res) => {
      const n = Math.min(parseInt(req.query.n) || 100, 500);
      res.json({ entries: log.tail(n), level: log.getLevel() });
    });

    app.post('/api/_dev/log-level', devOnly, (req, res) => {
      const { level } = req.body || {};
      if (!level || typeof level !== 'string') {
        return res.status(400).json({ error: 'level required' });
      }
      log.setLevel(level);
      log.info('log level changed', { level });
      res.json({ ok: true, level: log.getLevel() });
    });

    app.get('/api/_dev/state-dump', devOnly, (req, res) => {
      res.json({
        config,
        libraryCount: trackCount(),
        genres: [...genres],
        playlists: playlists.map(p => ({ id: p.id, name: p.name, type: p.type, count: (p.trackIds || []).length })),
        queue: queue.slice(0, 20),
        currentIndex,
        isPlaying,
        scanning,
        clientsConnected: clients.size,
      });
    });

    app.post('/api/_dev/library/seed', devOnly, (req, res) => {
      const count = Math.min(parseInt((req.body && req.body.count)) || 200, 5000);
      const seed = parseInt((req.body && req.body.seed)) || 1;
      library = buildMockLibrary({ count, seed });
      genres = buildMockGenres(library);
      log.info('mock library seeded', { count, seed });
      broadcast({ type: 'library-updated', data: { count: trackCount() } });
      res.json({ ok: true, count: trackCount(), genres: genres.size });
    });

    app.post('/api/_dev/library/clear', devOnly, (req, res) => {
      library = [];
      genres = new Set();
      queue = [];
      currentIndex = 0;
      log.info('library cleared (dev)');
      broadcast({ type: 'library-updated', data: { count: 0 } });
      res.json({ ok: true });
    });

    // ─── Library export ────────────────────────────────────────────────────
    function buildLibrarySnapshot() {
      const out = [];
      for (let i = 0; i < library.length; i++) {
        const t = library[i];
        if (!t) continue;
        out.push({
          id: t.id,
          title: t.title,
          artist: t.artist,
          albumArtist: t.albumArtist,
          album: t.album,
          year: t.year,
          duration: t.duration,
          genre: t.genre,
          filename: t.filename,
          favorited: favorites.has(t.id),
        });
      }
      return out;
    }

    app.get('/api/library/export.json', (req, res) => {
      res.set('Content-Disposition', 'attachment; filename="ghetto-blaster-library.json"');
      res.json({
        exportedAt: new Date().toISOString(),
        count: trackCount(),
        tracks: buildLibrarySnapshot(),
      });
    });

    app.get('/api/library/export.csv', (req, res) => {
      const rows = buildLibrarySnapshot();
      const cols = ['id', 'title', 'artist', 'albumArtist', 'album', 'year', 'duration', 'genre', 'filename', 'favorited'];
      const escape = (v) => {
        if (v == null) return '';
        const s = String(v);
        // RFC 4180: quote if it contains ", , or newline; escape " by doubling.
        if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      };
      const lines = [cols.join(',')];
      for (const r of rows) lines.push(cols.map((c) => escape(r[c])).join(','));
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="ghetto-blaster-library.csv"');
      res.send(lines.join('\n') + '\n');
    });

    // ─── Playlist import (M3U/M3U8) ────────────────────────────────────────
    app.post('/api/playlists/import-m3u', (req, res) => {
      const body = req.body || {};
      const { name, m3u: text } = body;
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'm3u (string content) required' });
      }
      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'name required' });
      }
      const entries = m3u.parseM3U(text);
      const { matched, unresolved } = m3u.resolveAgainstLibrary(entries, library);
      if (matched.length === 0) {
        return res.status(400).json({
          error: 'No tracks from the playlist matched the current library',
          parsed: entries.length,
          unresolved: unresolved.length,
        });
      }
      const playlist = {
        id: crypto.randomUUID(),
        name: name.trim().slice(0, 100),
        type: 'manual',
        trackIds: matched.map(m => m.trackId),
        createdAt: new Date().toISOString(),
        importedFrom: 'm3u',
      };
      playlists.push(playlist);
      savePlaylists();
      log.info('playlist imported from m3u', {
        name: playlist.name,
        matched: matched.length,
        unresolved: unresolved.length,
      });
      res.json({
        ok: true,
        playlist: { id: playlist.id, name: playlist.name, trackCount: matched.length },
        unresolved: unresolved.slice(0, 50),
        unresolvedTotal: unresolved.length,
      });
    });

    // ─── Radio mode ────────────────────────────────────────────────────────
    // Build a "radio" queue around a seed track. Cheap heuristic in
    // lib/radio.js — same genre/artist/year-bucket score; no external API.
    app.get('/api/radio/seed', (req, res) => {
      const seedId = parseInt(req.query.trackId, 10);
      if (!Number.isInteger(seedId)) return res.status(400).json({ error: 'trackId required' });
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const ids = radio.buildRadioQueue(seedId, library, { limit });
      if (ids.length === 0) return res.status(404).json({ error: 'Seed track not in library' });
      res.json({
        seed: ids[0],
        ids,
        tracks: ids.map(id => library[id]).filter(Boolean).map(({ path: _, ...rest }) => rest),
      });
    });

    app.post('/api/radio/play', (req, res) => {
      const body = req.body || {};
      const seedId = parseInt(body.trackId, 10);
      if (!Number.isInteger(seedId)) return res.status(400).json({ error: 'trackId required' });
      const limit = Math.min(parseInt(body.limit, 10) || 50, 200);
      const ids = radio.buildRadioQueue(seedId, library, { limit });
      if (ids.length === 0) return res.status(404).json({ error: 'Seed track not in library' });
      queue = ids;
      currentIndex = 0;
      isPlaying = true;
      log.info('radio queue built', { seed: seedId, length: queue.length });
      broadcast({ type: 'state', data: getState() });
      res.json({ ok: true, length: queue.length });
    });

    // ─── Sleep timer ───────────────────────────────────────────────────────
    // Server-side timer that fires a `pause` remote command after N minutes.
    // The desktop renderer listens on the WS for remote:command, just like
    // mobile-triggered actions. Cancellation is idempotent.
    let sleepTimerId = null;
    let sleepTimerEndsAt = 0;

    function clearSleepTimer() {
      if (sleepTimerId) clearTimeout(sleepTimerId);
      sleepTimerId = null;
      sleepTimerEndsAt = 0;
    }

    app.post('/api/sleep-timer', (req, res) => {
      const body = req.body || {};
      const minutes = parseFloat(body.minutes);
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
        return res.status(400).json({ error: 'minutes must be a positive number ≤ 1440' });
      }
      clearSleepTimer();
      const ms = minutes * 60 * 1000;
      sleepTimerEndsAt = Date.now() + ms;
      sleepTimerId = setTimeout(() => {
        log.info('sleep timer fired — pausing');
        broadcast({ type: 'remote:command', data: { command: 'pause' } });
        sleepTimerId = null;
        sleepTimerEndsAt = 0;
        broadcast({ type: 'sleep-timer', data: { active: false, endsAt: 0 } });
      }, ms);
      // Don't keep the process alive on quit.
      if (sleepTimerId && typeof sleepTimerId.unref === 'function') sleepTimerId.unref();
      log.info('sleep timer set', { minutes });
      broadcast({ type: 'sleep-timer', data: { active: true, endsAt: sleepTimerEndsAt } });
      res.json({ ok: true, endsAt: sleepTimerEndsAt });
    });

    app.delete('/api/sleep-timer', (req, res) => {
      clearSleepTimer();
      log.info('sleep timer cancelled');
      broadcast({ type: 'sleep-timer', data: { active: false, endsAt: 0 } });
      res.json({ ok: true });
    });

    app.get('/api/sleep-timer', (req, res) => {
      res.json({
        active: sleepTimerId != null,
        endsAt: sleepTimerEndsAt,
        msRemaining: sleepTimerEndsAt > 0 ? Math.max(0, sleepTimerEndsAt - Date.now()) : 0,
      });
    });

    // ─── Lyrics ────────────────────────────────────────────────────────────
    // Resolves in this order: <track>.lrc next to the audio file → cached
    // copy in userData/lyrics-cache/ → lyrics.ovh public API. Online hits
    // are written to the cache so subsequent calls are instant + offline.
    app.get('/api/tracks/:id/lyrics', async (req, res) => {
      const track = getTrackById(req.params.id);
      if (!track) return res.status(404).json({ error: 'Track not found' });
      try {
        const result = await lyricsLib.resolveLyrics(track, DATA_DIR, {
          forceFetch: req.query.refresh === '1',
          log,
        });
        if (!result) return res.status(404).json({ error: 'Lyrics not found' });
        res.json({
          trackId: track.id,
          source: result.source,
          synced: result.parsed.lines.length > 0,
          lines: result.parsed.lines,
          text: result.text,
        });
      } catch (e) {
        log.warn('lyrics resolve failed', { trackId: track.id, error: e.message });
        res.status(500).json({ error: 'lyrics fetch failed' });
      }
    });

    // ─── Backups ───────────────────────────────────────────────────────────
    app.get('/api/backups', (req, res) => {
      res.json({ backups: backupLib.listBackups(DATA_DIR) });
    });

    app.post('/api/backups', (req, res) => {
      const result = backupLib.backupNow(DATA_DIR, log);
      if (!result.ok) return res.status(500).json(result);
      res.json(result);
    });

    app.post('/api/backups/restore', (req, res) => {
      const { date } = req.body || {};
      if (!date) return res.status(400).json({ error: 'date required' });
      const result = backupLib.restoreFrom(DATA_DIR, date, log);
      if (!result.ok) return res.status(400).json(result);
      // Reload everything from disk now that the files have been replaced.
      libraryIds = loadLibraryIds();
      playlists = loadPlaylists();
      history = loadHistory();
      favorites = loadFavorites();
      config = loadConfig();
      broadcast({ type: 'library-updated', data: { count: trackCount() } });
      res.json(result);
    });

    // ─── Folder stats ──────────────────────────────────────────────────────
    // For each configured musicFolder, count the tracks whose path falls
    // under it. Useful in Settings to confirm a scan picked up what the user
    // expects from each root.
    app.get('/api/stats/folders', (req, res) => {
      const folders = (config.musicFolders || []).map(f => path.resolve(f));
      const counts = folders.map(() => 0);
      for (let i = 0; i < library.length; i++) {
        const t = library[i];
        if (!t || !t.path) continue;
        for (let j = 0; j < folders.length; j++) {
          // Use path.relative to handle trailing slashes consistently across
          // platforms.
          const rel = path.relative(folders[j], t.path);
          if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
            counts[j]++;
            break;
          }
        }
      }
      res.json({
        folders: folders.map((f, i) => ({ path: f, tracks: counts[i] })),
        unrooted: trackCount() - counts.reduce((a, b) => a + b, 0),
      });
    });

    // Theme (for mobile to sync accent color)
    // ─── /api/health — always-open lightweight ping ────────────────────
    // Bypasses auth (like /api/state on localhost, this is fine on LAN
    // because it returns no secrets). Used by the mobile client at boot
    // to detect a working server before making authenticated calls.
    app.get('/api/health', (req, res) => {
      res.json({
        ok: true,
        version: (function() { try { return require('./package.json').version; } catch(e) { return 'unknown'; } })(),
        uptime: Math.round(process.uptime()),
        library: trackCount(),
      });
    });

    // Safe public config snapshot for the renderer settings modal.
    // Exposes user-mutable fields, NEVER the auth token or secrets.
    app.get('/api/config/public', (req, res) => {
      // If musicFolders is empty but the library cache has tracks, infer
      // the folders from track paths. This recovers from the case where
      // a previous version's config didn't persist the folder list
      // properly but the library cache survived. Also write them back
      // to config so subsequent boots have a proper folder list.
      let folders = config.musicFolders || [];
      if ((!folders || folders.length === 0) && library.filter(Boolean).length > 0) {
        folders = inferFoldersFromLibrary();
        if (folders.length > 0) {
          config.musicFolders = folders;
          try {
            fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
            log.info('inferred musicFolders from library cache', { folders });
          } catch (e) { /* ignore */ }
        }
      }
      res.json({
        musicFolders: folders,
        excludeFolders: config.excludeFolders || [],
        port: config.port || 3000,
        hue: config.hue,
        theme: config.theme,
        lanEnabled: config.lanEnabled !== false,
        crossfade: !!config.crossfade,
        crossfadeDuration: config.crossfadeDuration,
        gapless: !!config.gapless,
        normalize: !!config.normalize,
        npCollapsed: !!config.npCollapsed,
        vizMode: config.vizMode,
        vizColorMode: config.vizColorMode,
        vizEnabled: config.vizEnabled !== false,
        audioOutput: config.audioOutput || '',
      });
    });

    app.get('/api/config/theme', (req, res) => {
      res.json({ hue: config.hue != null ? config.hue : 0 });
    });

    // ─── Preferences sync (cross-device) ────────────────────────────────────
    // GET: return the 6 synced preference fields only
    app.get('/api/config/preferences', (req, res) => {
      res.json({
        theme: config.theme || 'auto',
        hue: config.hue != null ? config.hue : 0,
        normalize: !!config.normalize,
        gapless: !!config.gapless,
        vizMode: config.vizMode || 'glow',
        vizColorMode: config.vizColorMode || 'cover',
      });
    });

    // PUT: accept partial updates to synced preferences, validate, merge, save, broadcast
    app.put('/api/config/preferences', (req, res) => {
      const body = req.body || {};
      const updates = {};
      let hasChanges = false;

      // Validate and extract each synced field
      if (body.theme !== undefined) {
        if (!['auto', 'dark', 'light'].includes(body.theme)) {
          return res.status(400).json({ error: 'theme must be one of: auto, dark, light' });
        }
        updates.theme = body.theme;
        hasChanges = true;
      }

      if (body.hue !== undefined) {
        const hueNum = parseInt(body.hue, 10);
        if (!Number.isInteger(hueNum) || hueNum < 0 || hueNum > 360) {
          return res.status(400).json({ error: 'hue must be an integer between 0 and 360' });
        }
        updates.hue = hueNum;
        hasChanges = true;
      }

      if (body.normalize !== undefined) {
        if (typeof body.normalize !== 'boolean') {
          return res.status(400).json({ error: 'normalize must be a boolean' });
        }
        updates.normalize = body.normalize;
        hasChanges = true;
      }

      if (body.gapless !== undefined) {
        if (typeof body.gapless !== 'boolean') {
          return res.status(400).json({ error: 'gapless must be a boolean' });
        }
        updates.gapless = body.gapless;
        hasChanges = true;
      }

      if (body.vizMode !== undefined) {
        if (typeof body.vizMode !== 'string' || !body.vizMode.trim()) {
          return res.status(400).json({ error: 'vizMode must be a non-empty string' });
        }
        updates.vizMode = body.vizMode.trim();
        hasChanges = true;
      }

      if (body.vizColorMode !== undefined) {
        if (typeof body.vizColorMode !== 'string' || !body.vizColorMode.trim()) {
          return res.status(400).json({ error: 'vizColorMode must be a non-empty string' });
        }
        updates.vizColorMode = body.vizColorMode.trim();
        hasChanges = true;
      }

      // Merge into config and save
      if (hasChanges) {
        config = { ...config, ...updates };
        saveConfig(config);
        // Broadcast the change to all connected clients
        broadcast({ type: 'preferences:changed', data: updates });
      }

      res.json({ ok: true });
    });

    // Desktop audio outputs (exposed for mobile remote control)
    // The actual device list comes from the Electron renderer via POST
    let desktopOutputs = [];
    app.get('/api/desktop/outputs', (req, res) => {
      res.json(desktopOutputs);
    });
    app.post('/api/desktop/outputs', (req, res) => {
      desktopOutputs = req.body || [];
      res.json({ ok: true });
    });

    // Users endpoint (must be before catch-all)
    var connectedUsers = new Map();
    var userCounter = 0;
    // uniqueIps tracks distinct devices for stats. Capped to avoid unbounded
    // growth on long uptimes (rare but possible on always-on servers).
    var MAX_UNIQUE_IPS = 1000;
    var uniqueIps = new Set();
    function trackUniqueIp(ip) {
      if (!ip) return;
      if (uniqueIps.size >= MAX_UNIQUE_IPS) {
        // FIFO drop: remove the oldest entry (Sets preserve insertion order)
        const first = uniqueIps.values().next().value;
        if (first !== undefined) uniqueIps.delete(first);
      }
      uniqueIps.add(ip);
    }
    var serverStartTime = Date.now();

    function findUserById(id) {
      for (const u of connectedUsers.values()) {
        if (u.id === id) return u;
      }
      return null;
    }

    // Best-effort extraction of a friendly device label from a User-Agent.
    // Matches the most common platforms — falls back to 'Browser' so we
    // never show a raw UA string in the UI.
    function describeUserAgent(ua) {
      if (!ua || typeof ua !== 'string') return { kind: 'unknown', label: 'Browser' };
      const u = ua.toLowerCase();
      if (u.indexOf('electron') !== -1) return { kind: 'desktop', label: 'Desktop' };
      if (u.indexOf('iphone') !== -1) return { kind: 'mobile', label: 'iPhone' };
      if (u.indexOf('ipad') !== -1) return { kind: 'tablet', label: 'iPad' };
      if (u.indexOf('android') !== -1) {
        return u.indexOf('mobile') !== -1
          ? { kind: 'mobile', label: 'Android phone' }
          : { kind: 'tablet', label: 'Android tablet' };
      }
      if (u.indexOf('mac os') !== -1) return { kind: 'desktop', label: 'Mac' };
      if (u.indexOf('windows') !== -1) return { kind: 'desktop', label: 'Windows' };
      if (u.indexOf('linux') !== -1) return { kind: 'desktop', label: 'Linux' };
      return { kind: 'unknown', label: 'Browser' };
    }

    app.get('/api/users', (req, res) => {
      const users = [];
      connectedUsers.forEach((u) => {
        const desc = describeUserAgent(u.ua);
        users.push({
          id: u.id,
          name: u.name,
          ip: u.ip,
          // The renderer running inside Electron loads from 127.0.0.1 — flag
          // it so the host UI can hide its own session from the device list.
          isLocal: u.ip === '127.0.0.1' || u.ip === '::1',
          connectedAt: u.connectedAt,
          role: u.role || 'full',
          deviceKind: desc.kind,
          deviceLabel: desc.label,
        });
      });
      res.json(users);
    });

    // Promote/demote a connected device. Role persists for the lifetime of
    // the WS session — if the device reconnects, it comes back as 'full'
    // and the host can re-downgrade.
    app.post('/api/users/:userId/role', (req, res) => {
      const { role } = req.body || {};
      if (role !== 'guest' && role !== 'full') {
        return res.status(400).json({ error: 'role must be "guest" or "full"' });
      }
      const user = findUserById(req.params.userId);
      if (!user) return res.status(404).json({ error: 'user not connected' });
      user.role = role;
      log.info('user role changed', { id: user.id, name: user.name, role });
      // Tell every client (so the host UI updates instantly) and the
      // affected device (so it can show a "Guest mode" badge).
      broadcast({ type: 'users:changed', data: { count: connectedUsers.size } });
      res.json({ ok: true, id: user.id, role });
    });

    app.get('/api/server/stats', (req, res) => {
      res.json({
        uptime: Math.floor((Date.now() - serverStartTime) / 1000),
        uniqueDevices: uniqueIps.size,
        currentConnections: connectedUsers.size,
        totalConnections: userCounter,
      });
    });

    // Catch-all: serve SPA
    // Express 5 / path-to-regexp v6 dropped the bare '*' pattern, so we use
    // a path-less middleware here. It runs only when no earlier route handled
    // the request, keeping the same SPA fallback semantics.
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
      }
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Start listening — bind to LAN or localhost based on config.
    // port === 0 means "let the OS pick" (used in tests).
    const usePort = (port === 0) ? 0 : (port || config.port || 3000);
    const bindAddr = config.lanEnabled === false ? '127.0.0.1' : '0.0.0.0';
    serverInstance = app.listen(usePort, bindAddr, () => {
      const lanIp = getLanIp();
      const actualPort = serverInstance.address().port;
      log.info('server started', {
        bind: bindAddr,
        port: actualPort,
        lan: bindAddr === '0.0.0.0',
        lanIp,
      });

      // WebSocket + connected users tracking
      wssInstance = new WebSocketServer({ server: serverInstance, maxPayload: 2048 });
      wssInstance.on('connection', (ws, req) => {
        const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
        const isLocal = ip === '127.0.0.1' || ip === '::1';
        if (!isLocal) {
          // Validate token from ?t= query param
          let token = null;
          try {
            const u = new URL(req.url, 'http://localhost');
            token = u.searchParams.get('t');
          } catch(e) { /* ignore */ }
          const expected = getAuthToken();
          if (!token || !expected || token !== expected) {
            ws.close(1008, 'Unauthorized');
            return;
          }
        }
        const maxConns = (config && config.maxConnections) || 20;
        if (clients.size >= maxConns) {
          ws.close(1013, 'Too many connections');
          return;
        }
        clients.add(ws);
        userCounter++;
        const userId = 'user-' + userCounter;
        trackUniqueIp(ip);
        connectedUsers.set(ws, {
          id: userId,
          name: 'Device ' + userCounter,
          ip: ip,
          ua: req.headers['user-agent'] || '',
          connectedAt: new Date().toISOString(),
          role: 'full', // every new device starts with full powers
        });

        // Tell the device its own id so it can stamp /api/remote/command
        // with `clientId` and the server can check its role.
        ws.send(JSON.stringify({ type: 'whoami', data: { id: userId } }));
        ws.send(JSON.stringify({ type: 'state', data: getState() }));
        broadcast({ type: 'users:changed', data: { count: connectedUsers.size } });

        ws.on('message', (msg) => {
          try {
            const data = JSON.parse(msg);
            if (data.type === 'set-name' && data.name) {
              const user = connectedUsers.get(ws);
              if (user) { user.name = data.name.slice(0, 20); broadcast({ type: 'users:changed', data: { count: connectedUsers.size } }); }
            }
          } catch(e) {}
        });

        ws.on('close', () => { clients.delete(ws); connectedUsers.delete(ws); broadcast({ type: 'users:changed', data: { count: connectedUsers.size } }); });
        ws.on('error', () => { clients.delete(ws); connectedUsers.delete(ws); });
      });

      // Scan library on start
      if (config.scanOnStartup) {
        scanFolders().catch(console.error);
      }

      // File watcher — react to actual file additions/deletions only.
      // Chokidar is preferred: fs.watch's recursive mode misses events on
      // Windows in deep trees and can spam during big copy operations.
      if (config.watchForChanges) {
        let rescanTimeout = null;
        let lastScanTime = Date.now();
        const excl = new Set((config.excludeFolders || []).map(f => f.toLowerCase()));

        // Burst protection: if a flood of events comes in (user dropped a
        // huge folder, mass move, etc.), stop scheduling rescans for an
        // extended window so we don't thrash the disk and the renderer.
        const BURST_WINDOW_MS = 5000;
        const BURST_MAX_EVENTS = 5000;
        const BURST_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
        let burstCount = 0;
        let burstWindowStart = 0;
        let burstCooldownUntil = 0;

        function bumpBurst() {
          const now = Date.now();
          if (now - burstWindowStart > BURST_WINDOW_MS) {
            burstWindowStart = now;
            burstCount = 0;
          }
          burstCount++;
          if (burstCount > BURST_MAX_EVENTS && now > burstCooldownUntil) {
            burstCooldownUntil = now + BURST_COOLDOWN_MS;
            log.warn('watcher: event burst — entering cooldown', {
              events: burstCount,
              cooldownMs: BURST_COOLDOWN_MS,
            });
          }
        }

        function isAudioPath(p) {
          return AUDIO_EXTENSIONS.has(path.extname(p).toLowerCase());
        }
        function isExcluded(p) {
          const parts = p.split(/[\\/]/);
          return parts.some(part => excl.has(part.toLowerCase()));
        }
        function scheduleRescan(reason) {
          bumpBurst();
          if (Date.now() < burstCooldownUntil) return;
          if (Date.now() - lastScanTime < 30000) return;
          clearTimeout(rescanTimeout);
          rescanTimeout = setTimeout(async () => {
            log.info('watcher rescan', { reason });
            lastScanTime = Date.now();
            await scanFolders();
            broadcast({ type: 'library-updated', data: { count: trackCount() } });
          }, 5000);
        }

        const folders = (config.musicFolders || [])
          .map(f => path.resolve(f))
          .filter(p => fs.existsSync(p));

        if (chokidar && folders.length > 0) {
          try {
            watcherInstance = chokidar.watch(folders, {
              ignoreInitial: true,
              persistent: true,
              awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
              ignored: (p) => {
                if (!p) return false;
                const parts = p.split(/[\\/]/);
                return parts.some(part => excl.has(part.toLowerCase()));
              },
              depth: 99,
            });
            watcherInstance.on('add', (p) => { if (isAudioPath(p)) scheduleRescan('added'); });
            watcherInstance.on('unlink', (p) => { if (isAudioPath(p)) scheduleRescan('removed'); });
            watcherInstance.on('error', (err) => console.warn('Watcher error:', err.message));
          } catch (e) {
            console.warn('Chokidar failed, falling back to fs.watch:', e.message);
            watcherInstance = null;
          }
        }

        if (!watcherInstance) {
          // Fallback: native fs.watch (works fine on macOS/Linux, flaky on Windows)
          for (const resolved of folders) {
            try {
              fs.watch(resolved, { recursive: true }, (eventType, filename) => {
                if (eventType !== 'rename' || !filename) return;
                if (!isAudioPath(filename)) return;
                if (isExcluded(filename)) return;
                scheduleRescan(eventType);
              });
            } catch (e) {
              console.warn(`Could not watch: ${resolved}`, e.message);
            }
          }
        }
      }

      resolve({ ip: lanIp, port: actualPort });
    });

    serverInstance.on('error', (err) => {
      serverInstance = null;
      reject(err);
    });
  });
}

// ─── Stop Server ────────────────────────────────────────────────────────────
function stopServer() {
  return new Promise((resolve) => {
    // Close all WebSocket connections
    clients.forEach(ws => {
      try { ws.close(); } catch (e) { /* ignore */ }
    });
    clients.clear();

    if (wssInstance) {
      wssInstance.close();
      wssInstance = null;
    }

    if (watcherInstance) {
      try { watcherInstance.close(); } catch (e) { /* ignore */ }
      watcherInstance = null;
    }

    if (scannerPool) {
      scannerPool.stop().catch(() => {});
      scannerPool = null;
    }

    if (serverInstance) {
      serverInstance.close(() => {
        serverInstance = null;
        log.info('server stopped');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

function isRunning() {
  return !!serverInstance;
}

function getConfig() {
  return config;
}

function saveConfig(newConfig) {
  config = { ...config, ...newConfig };
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

module.exports = { startServer, stopServer, isRunning, getLanIp, getConfig, saveConfig, setDataDir };
