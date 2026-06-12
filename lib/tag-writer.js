// Write-back of ID3 tags. Currently MP3-only (via node-id3, an optional dep).
// FLAC/M4A/Vorbis would each need their own writer; we'll add them as users
// hit the limit. Out of scope for the writer:
//   - cover art (would need a separate /api/tracks/:id/cover endpoint)
//   - replay-gain tags (computed, not user-edited)
//
// node-id3 is loaded lazily so the rest of the server doesn't choke if the
// user's npm install ran before this dep was added.

const path = require('node:path');
const fs = require('node:fs');

let NodeID3 = null;
function getNodeID3() {
  if (NodeID3 !== null) return NodeID3;
  try { NodeID3 = require('node-id3'); }
  catch (e) { NodeID3 = false; }
  return NodeID3;
}

const SUPPORTED_FIELDS = new Set(['title', 'artist', 'album', 'albumArtist', 'year', 'genre', 'trackNumber']);

const ID3_FIELD_MAP = {
  title: 'title',
  artist: 'artist',
  album: 'album',
  albumArtist: 'performerInfo',
  year: 'year',
  genre: 'genre',
  trackNumber: 'trackNumber',
};

function pickValidFields(input) {
  const out = {};
  for (const k of Object.keys(input || {})) {
    if (!SUPPORTED_FIELDS.has(k)) continue;
    const v = input[k];
    if (v == null) continue;
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const s = String(v).trim();
    if (s.length === 0) continue;
    if (s.length > 500) continue; // sanity cap; ID3 has no hard limit but huge fields are silly
    out[k] = s;
  }
  return out;
}

function fileFormat(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.mp3') return 'mp3';
  if (ext === '.flac') return 'flac';
  if (ext === '.m4a' || ext === '.mp4') return 'm4a';
  if (ext === '.ogg' || ext === '.oga') return 'vorbis';
  return 'unknown';
}

// Returns { ok, written, format, error? }.
// Never modifies files on disk if the validation fails — node-id3 is the
// only writer; for non-mp3 we return { ok: false, format } and let the caller
// surface a 501.
function writeTags(filePath, newTags) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: 'file not found' };
  }
  const fmt = fileFormat(filePath);
  if (fmt !== 'mp3') {
    return { ok: false, format: fmt, error: 'tag editing not yet supported for ' + fmt };
  }

  const id3 = getNodeID3();
  if (!id3) {
    return { ok: false, error: 'node-id3 not installed' };
  }

  const valid = pickValidFields(newTags);
  if (Object.keys(valid).length === 0) {
    return { ok: false, error: 'no valid fields provided' };
  }

  const id3Tags = {};
  for (const k of Object.keys(valid)) {
    const target = ID3_FIELD_MAP[k];
    if (target) id3Tags[target] = valid[k];
  }

  // node-id3 has both a sync `update` and a callback API. We use update to
  // merge with existing tags rather than overwriting unspecified fields.
  let result;
  try {
    result = id3.update(id3Tags, filePath);
  } catch (e) {
    return { ok: false, error: 'write failed: ' + e.message };
  }
  if (result === false || (result && result.error)) {
    return { ok: false, error: (result && result.error && result.error.message) || 'write returned false' };
  }
  return { ok: true, written: valid, format: fmt };
}

function isAvailable() { return !!getNodeID3(); }

module.exports = { writeTags, pickValidFields, fileFormat, isAvailable, SUPPORTED_FIELDS };
