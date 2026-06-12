// Lyrics resolution. Tries three sources in order:
//   1. <track>.lrc sitting next to the audio file (synced lyrics, preferred)
//   2. local cache in userData/lyrics-cache/<id>.{lrc,txt}
//   3. lyrics.ovh public API (no key required, plain text only)
//
// Results are cached even when they come from disk: the in-memory layer is
// just a Map keyed by track id with an LRU-ish eviction (cap 500).
//
// LRC parsing is light — we keep both the raw text (for line-only display)
// and a parsed array of {time, text} entries when timestamps are present.

const fs = require('node:fs');
const path = require('node:path');

const CACHE_NAME = 'lyrics-cache';
const MEMO = new Map();
const MEMO_MAX = 500;

function memoGet(key) {
  if (!MEMO.has(key)) return null;
  const v = MEMO.get(key);
  // touch (cheap LRU)
  MEMO.delete(key);
  MEMO.set(key, v);
  return v;
}
function memoSet(key, val) {
  if (MEMO.has(key)) MEMO.delete(key);
  MEMO.set(key, val);
  if (MEMO.size > MEMO_MAX) {
    const first = MEMO.keys().next().value;
    if (first !== undefined) MEMO.delete(first);
  }
}

function isLikelyLrc(text) {
  return /\[\d+:\d+(?:\.\d+)?\]/.test(text);
}

// Parse an LRC into { lines: [{time, text}], raw }. If no timestamps are
// found, returns { lines: [], raw } so the caller can still surface the
// text as plain.
function parseLrc(text) {
  if (typeof text !== 'string') return { lines: [], raw: '' };
  const out = [];
  for (const rawLine of text.split(/\r?\n/)) {
    // Match leading timestamps; an LRC line can have multiple, sharing one body.
    const matches = [...rawLine.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (matches.length === 0) continue;
    const body = rawLine.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim();
    for (const m of matches) {
      const min = parseInt(m[1], 10);
      const sec = parseFloat(m[2]);
      if (!Number.isFinite(min) || !Number.isFinite(sec)) continue;
      out.push({ time: min * 60 + sec, text: body });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return { lines: out, raw: text };
}

function lrcSidecarPath(trackPath) {
  if (!trackPath) return null;
  const ext = path.extname(trackPath);
  if (!ext) return null;
  return trackPath.slice(0, -ext.length) + '.lrc';
}

function cacheDir(dataDir) { return path.join(dataDir, CACHE_NAME); }
function cacheLrcPath(dataDir, id) { return path.join(cacheDir(dataDir), `${id}.lrc`); }
function cacheTxtPath(dataDir, id) { return path.join(cacheDir(dataDir), `${id}.txt`); }

function tryLocal(track) {
  const sidecar = lrcSidecarPath(track && track.path);
  if (sidecar && fs.existsSync(sidecar)) {
    try {
      const text = fs.readFileSync(sidecar, 'utf8');
      return { source: 'sidecar', text, parsed: isLikelyLrc(text) ? parseLrc(text) : { lines: [], raw: text } };
    } catch (e) { /* ignore */ }
  }
  return null;
}

function tryCache(dataDir, id) {
  for (const fn of [cacheLrcPath, cacheTxtPath]) {
    const p = fn(dataDir, id);
    if (fs.existsSync(p)) {
      try {
        const text = fs.readFileSync(p, 'utf8');
        return { source: 'cache', text, parsed: isLikelyLrc(text) ? parseLrc(text) : { lines: [], raw: text } };
      } catch (e) { /* ignore */ }
    }
  }
  return null;
}

function writeCache(dataDir, id, text) {
  try {
    fs.mkdirSync(cacheDir(dataDir), { recursive: true });
    const p = isLikelyLrc(text) ? cacheLrcPath(dataDir, id) : cacheTxtPath(dataDir, id);
    fs.writeFileSync(p, text);
  } catch (e) { /* ignore */ }
}

// lyrics.ovh returns { lyrics: "..." } on hit, 404 on miss. Uses node:https
// with a 5s timeout — never blocks the caller for long.
function fetchOnline(artist, title, timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (!artist || !title) return resolve(null);
    let mod;
    try { mod = require('node:https'); } catch (e) { return resolve(null); }
    const url = 'https://api.lyrics.ovh/v1/'
      + encodeURIComponent(artist) + '/' + encodeURIComponent(title);
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(null);
      }
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks);
          if (parsed && typeof parsed.lyrics === 'string' && parsed.lyrics.trim()) {
            return resolve(parsed.lyrics);
          }
        } catch (e) { /* ignore */ }
        resolve(null);
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// Top-level resolver. Returns { source, text, parsed: {lines, raw} } or null.
async function resolveLyrics(track, dataDir, { forceFetch = false, log } = {}) {
  if (!track) return null;
  const id = track.id;
  if (!forceFetch) {
    const memoed = memoGet(id);
    if (memoed) return memoed;
    const local = tryLocal(track);
    if (local) { memoSet(id, local); return local; }
    const cached = tryCache(dataDir, id);
    if (cached) { memoSet(id, cached); return cached; }
  }
  const online = await fetchOnline(track.artist, track.title);
  if (online) {
    const result = { source: 'online', text: online, parsed: { lines: [], raw: online } };
    writeCache(dataDir, id, online);
    memoSet(id, result);
    if (log) log.info('lyrics fetched online', { trackId: id });
    return result;
  }
  return null;
}

function clearMemo() { MEMO.clear(); }

module.exports = {
  parseLrc,
  isLikelyLrc,
  lrcSidecarPath,
  resolveLyrics,
  fetchOnline,
  clearMemo,
};
