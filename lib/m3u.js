// Tiny M3U/M3U8 parser. Handles the subset that matters for music players:
// one entry per track, optional `#EXTINF:<duration>,<artist> - <title>` line,
// blank lines and comments ignored, BOM stripped. URI-style entries (http://)
// are passed through unchanged so an imported playlist can reference remote
// streams the same way our /api/stream/<id> URLs do.
//
// Returned shape:
//   [{ uri, title, artist, duration }, ...]
//
// Matching to the live library is left to the caller — see resolveAgainstLibrary.

function parseM3U(text) {
  if (typeof text !== 'string') return [];
  // Strip BOM and normalize line endings.
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = t.split('\n');
  const out = [];
  let pending = null;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      // #EXTINF:duration,Artist - Title
      // duration may be -1 or a number (possibly fractional).
      const rest = line.slice(8);
      const comma = rest.indexOf(',');
      const dur = parseFloat(comma === -1 ? rest : rest.slice(0, comma));
      const meta = comma === -1 ? '' : rest.slice(comma + 1);
      const dash = meta.indexOf(' - ');
      pending = {
        duration: Number.isFinite(dur) ? dur : 0,
        artist: dash === -1 ? '' : meta.slice(0, dash).trim(),
        title: dash === -1 ? meta.trim() : meta.slice(dash + 3).trim(),
      };
      continue;
    }
    if (line.startsWith('#')) continue; // other comments (#PLAYLIST, #EXTM3U, #EXTGRP)
    out.push({
      uri: line,
      title: pending ? pending.title : '',
      artist: pending ? pending.artist : '',
      duration: pending ? pending.duration : 0,
    });
    pending = null;
  }
  return out;
}

// Given parsed entries and the current library (sparse array of track
// objects), find which entries match a real track id. Strategy:
//   1. If the URI looks like /api/stream/<id>, take the id.
//   2. Otherwise, exact match on (artist, title), case-insensitive.
//   3. Otherwise, basename match against track.path / track.filename.
// Returns { matched: [{entry, trackId}], unresolved: [entry] }.
function resolveAgainstLibrary(entries, library) {
  const byArtistTitle = new Map();
  const byBasename = new Map();
  if (Array.isArray(library)) {
    for (let i = 0; i < library.length; i++) {
      const t = library[i];
      if (!t) continue;
      const k1 = ((t.artist || '') + '|' + (t.title || '')).toLowerCase();
      if (!byArtistTitle.has(k1)) byArtistTitle.set(k1, t.id);
      const base = (t.filename || '').toLowerCase();
      if (base && !byBasename.has(base)) byBasename.set(base, t.id);
    }
  }
  const matched = [];
  const unresolved = [];
  for (const entry of entries) {
    let id = null;
    const m = /^\/api\/stream\/(\d+)/.exec(entry.uri || '');
    if (m) {
      const candidate = parseInt(m[1], 10);
      if (Number.isInteger(candidate) && Array.isArray(library) && library[candidate]) id = candidate;
    }
    if (id == null) {
      const k = ((entry.artist || '') + '|' + (entry.title || '')).toLowerCase();
      if (k !== '|' && byArtistTitle.has(k)) id = byArtistTitle.get(k);
    }
    if (id == null) {
      // Basename of URI (file name without folder), case-insensitive.
      const uri = entry.uri || '';
      const slash = Math.max(uri.lastIndexOf('/'), uri.lastIndexOf('\\'));
      const base = slash === -1 ? uri : uri.slice(slash + 1);
      const baseLower = base.toLowerCase();
      if (baseLower && byBasename.has(baseLower)) id = byBasename.get(baseLower);
    }
    if (id != null) matched.push({ entry, trackId: id });
    else unresolved.push(entry);
  }
  return { matched, unresolved };
}

module.exports = { parseM3U, resolveAgainstLibrary };
