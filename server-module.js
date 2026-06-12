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
let scannerPool = null;
// chokidar is more reliable than fs.watch (esp. recursive on Windows)
let chokidar = null;
try { chokidar = require('chokidar'); } catch (e) { /* optional dep, falls back to fs.watch */ }
let serverInstance = null;
let wssInstance = null;
let watcherInstance = null;

// ─── Data directory (set by main.js before startServer, or fallback to __dirname)
let DATA_DIR = __dirname;

// Default smart playlists (created on first run)
const DEFAULT_PLAYLISTS = [
  { name: 'Hip-Hop', genreMatch: ['hip-hop','hiphop','rap','hip hop'] },
  { name: 'Electro', genreMatch: ['electro','electronic','edm','house','techno','trance','dubstep'] },
  { name: 'Reggae', genreMatch: ['reggae','ragga','dancehall','dub','ska'] },
  { name: 'Rock', genreMatch: ['rock','punk','metal','grunge','hard rock'] },
  { name: 'Alternative', genreMatch: ['alternative','indie','alt'] },
  { name: 'Pop', genreMatch: ['pop','synth-pop','synthpop'] },
  { name: 'Latino', genreMatch: ['latin','reggaeton','salsa','bachata','cumbia','latino'] },
];

function createDefaultPlaylists() {
  // Only create if no smart playlists exist yet
  if (playlists.some(p => p.type === 'smart')) return;
  for (const def of DEFAULT_PLAYLISTS) {
    playlists.push({
      id: crypto.randomUUID(),
      name: def.name,
      type: 'smart',
      genreMatch: def.genreMatch,
      trackIds: [], // Will be resolved at play time from current library
      createdAt: new Date().toISOString(),
    });
  }
  savePlaylists();
  console.log('Created default smart playlists');
}

function setDataDir(dir) {
  DATA_DIR = dir;
  // Reload config + playlists + history from the correct location
  config = loadConfig();
  ensureAuthToken();
  libraryIds = loadLibraryIds();
  playlists = loadPlaylists();
  history = loadHistory();
  favorites = loadFavorites();
  createDefaultPlaylists();
  // Ensure covers dir exists
  const coversDir = path.join(DATA_DIR, '__covers');
  if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });
  console.log('Data dir set to:', dir);
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
      if (data && typeof data === 'object' && data.paths && typeof data.nextId === 'number') {
        return data;
      }
    }
  } catch (e) { console.warn('Could not load library-ids:', e.message); }
  return { paths: {}, nextId: 0 };
}

function saveLibraryIds() {
  try {
    fs.writeFileSync(getLibraryIdsPath(), JSON.stringify(libraryIds, null, 2));
  } catch (e) { console.warn('Could not save library-ids:', e.message); }
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
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) { console.warn('Could not load playlists:', e.message); }
  return [];
}

function savePlaylists() {
  fs.writeFileSync(getPlaylistsPath(), JSON.stringify(playlists, null, 2));
}

// ─── History ────────────────────────────────────────────────────────────────
function getHistoryPath() { return path.join(DATA_DIR, 'history.json'); }
let history = loadHistory();

function loadHistory() {
  try {
    var p = getHistoryPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {}
  return [];
}

function saveHistory() {
  fs.writeFileSync(getHistoryPath(), JSON.stringify(history.slice(0, 5000), null, 2));
}

// ─── Favorites ──────────────────────────────────────────────────────────────
function getFavoritesPath() { return path.join(DATA_DIR, 'favorites.json'); }
let favorites = loadFavorites();

function loadFavorites() {
  try { var p = getFavoritesPath(); if (fs.existsSync(p)) return new Set(JSON.parse(fs.readFileSync(p, 'utf8'))); }
  catch(e) {}
  return new Set();
}

function saveFavorites() {
  fs.writeFileSync(getFavoritesPath(), JSON.stringify([...favorites]));
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
  if (scanning) { console.log('Scan already in progress, skipping'); return library; }
  scanning = true;

  // Reload config (may have been updated via settings)
  config = loadConfig();

  // Lazily start the worker pool when explicitly enabled. Off by default —
  // the cost is small at scan time and the failure mode is well-tested inline.
  if (config.scanInWorker && !scannerPool) {
    const pool = new ScannerPool();
    if (pool.start()) {
      scannerPool = pool;
      console.log(`Scanner pool started (${pool.size} workers)`);
    }
  }

  const excludeFolders = new Set((config.excludeFolders || []).map(f => f.toLowerCase()));

  console.log('Scanning music folders...');
  broadcast({ type: 'scan:start' });
  library = [];
  genres = new Set();

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

  // Prune deleted paths from the id map so it doesn't grow forever
  for (const p of Object.keys(libraryIds.paths)) {
    if (!seenPaths.has(p)) delete libraryIds.paths[p];
  }
  saveLibraryIds();

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
  console.log(`Found ${count} tracks, ${genres.size} genres`);
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

async function scanDirectory(dir, excludeFolders, seenPaths) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.warn(`Cannot read directory: ${dir}`);
    return;
  }

  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei];
    const fullPath = path.join(dir, entry.name);

    // Yield every 50 files to keep event loop responsive (visualizer, WS)
    if (ei % 50 === 0) await new Promise(r => setImmediate(r));

    if (entry.isDirectory()) {
      if (excludeFolders.has(entry.name.toLowerCase())) continue;
      await scanDirectory(fullPath, excludeFolders, seenPaths);
    } else if (AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const trackId = getOrAssignTrackId(fullPath);
      if (seenPaths) seenPaths.add(fullPath);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(fullPath).mtimeMs; } catch (e) { /* ignore */ }
      try {
        // Skip metadata re-parse when the file mtime matches a cached cover —
        // we still parse for tags (cheap), but we avoid re-decoding/writing the
        // picture buffer when nothing changed.
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

        library[trackId] = {
          id: trackId,
          path: fullPath,
          filename: entry.name,
          title: metadata.common.title || entry.name.replace(/\.[^/.]+$/, ''),
          artist: metadata.common.artist || 'Unknown',
          albumArtist: metadata.common.albumartist || '',
          album: metadata.common.album || '',
          year: metadata.common.year || null,
          duration: metadata.format.duration || 0,
          genre: genre,
          hasCover,
        };
      } catch (e) {
        library[trackId] = {
          id: trackId,
          path: fullPath,
          filename: entry.name,
          title: entry.name.replace(/\.[^/.]+$/, ''),
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
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          fontSrc: ["'self'", 'data:'],
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
      const q = (req.query.q || '').toLowerCase().trim();
      const genre = (req.query.genre || '').trim().toLowerCase();
      // library is sparse (gaps from deleted files) — filter compacts it.
      let results = library.filter(Boolean);
      if (genre) {
        // Substring match: "Hip-Hop" matches "Hip-Hop", "Hip-Hop, R&B", etc.
        results = results.filter(t => t.genre && t.genre.toLowerCase().includes(genre));
      }
      if (q) {
        results = results.filter(t =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.album.toLowerCase().includes(q) ||
          (t.genre && t.genre.toLowerCase().includes(q))
        );
      }
      res.json(results.map(({ path: _, ...rest }) => ({ ...rest, favorited: favorites.has(rest.id) })));
    });

    app.get('/api/genres', (req, res) => {
      res.json([...genres].sort());
    });

    app.get('/api/state', (req, res) => {
      res.json(getState());
    });

    app.get('/api/cover/:id', (req, res) => {
      const track = getTrackById(req.params.id);
      if (!track || !track.hasCover) return res.status(404).json({ error: 'No cover art' });
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
      res.status(404).json({ error: 'No cover art' });
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
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      res.json(history.slice(0, limit));
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
    const REMOTE_COMMANDS = new Set([
      'play', 'pause', 'next', 'prev', 'shuffle', 'seek', 'volume', 'mute',
      'play-track', 'play-playlist', 'queue-add', 'queue-set', 'queue-remove',
      'queue-clear', 'queue-reorder', 'set-output', 'rescan', 'set-eq',
      'set-crossfade', 'toggle-favorite', 'set-viz',
    ]);
    app.post('/api/remote/command', remoteLimiter, (req, res) => {
      const body = req.body || {};
      const { command } = body;
      if (!command || typeof command !== 'string') {
        return res.status(400).json({ error: 'command required' });
      }
      if (!REMOTE_COMMANDS.has(command)) {
        return res.status(400).json({ error: 'unknown command' });
      }
      // Broadcast entire payload (command + trackId/playlistId/etc.)
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

      res.json({
        week: { plays: weekPlays.length, minutes: weekMinutes },
        month: { plays: monthPlays.length, minutes: monthMinutes },
        topArtists,
        topGenres,
        totalTracks: trackCount(),
        favorites: favorites.size,
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
      const safe = (pl.name || 'playlist').replace(/[^\w\d\-]+/g, '_');
      res.set('Content-Type', 'audio/x-mpegurl');
      res.set('Content-Disposition', `attachment; filename="${safe}.m3u"`);
      res.send(lines.join('\n') + '\n');
    });

    // ─── Tag editing (stub) ─────────────────────────────────────────────────
    // Writing back ID3/Vorbis comments needs a write-capable tag library
    // (e.g. node-id3 for MP3, others for FLAC). Not yet wired — endpoint is
    // here so the UI can detect support and mark the field read-only meanwhile.
    app.put('/api/tracks/:id/tags', (req, res) => {
      res.status(501).json({
        error: 'Tag editing not yet implemented',
        hint: 'requires a write-capable tag library; see Phase 6 in TODO.md',
      });
    });

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

    // Theme (for mobile to sync accent color)
    app.get('/api/config/theme', (req, res) => {
      res.json({ hue: config.hue || 38 });
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

    app.get('/api/users', (req, res) => {
      const users = [];
      connectedUsers.forEach((u) => users.push({ id: u.id, name: u.name, connectedAt: u.connectedAt }));
      res.json(users);
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
      console.log(`Ghetto Blaster server started on ${bindAddr}:${actualPort} (LAN: ${bindAddr === '0.0.0.0' ? 'ON' : 'OFF'})`);

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
        connectedUsers.set(ws, { id: userId, name: 'Device ' + userCounter, ip: ip, connectedAt: new Date().toISOString() });

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

        function isAudioPath(p) {
          return AUDIO_EXTENSIONS.has(path.extname(p).toLowerCase());
        }
        function isExcluded(p) {
          const parts = p.split(/[\\/]/);
          return parts.some(part => excl.has(part.toLowerCase()));
        }
        function scheduleRescan(reason) {
          if (Date.now() - lastScanTime < 30000) return;
          clearTimeout(rescanTimeout);
          rescanTimeout = setTimeout(async () => {
            console.log(`File ${reason}, rescanning...`);
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
        console.log('Ghetto Blaster server stopped');
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
