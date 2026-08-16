// Pure validation helpers. Kept free of side effects so they can be unit-tested
// without spinning up the server.

const MAX_QUEUE_LEN = 10000;
const MAX_PLAYLIST_NAME_LEN = 100;

// Whitelist of remote commands that the desktop player will react to. Anything
// not in here is rejected by the API to keep a malicious LAN client from
// triggering unexpected ops.
//
// IMPORTANT: these strings MUST match exactly what the renderer sends
// (`sendRemoteCommand('<cmd>', …)` in public/js/) AND what the desktop WS
// handler reacts to (`cmd === '<cmd>'` in runtime.js). The old list used a
// theoretical vocabulary (`volume`, `queue-add`, `seek`, …) that the front end
// never emitted, so remote volume/queue control was silently rejected with
// "unknown command". Keep this list in sync with the actual front-end verbs.
const REMOTE_COMMANDS = new Set([
  'play', 'pause', 'next', 'prev', 'shuffle',
  'play-track', 'play-playlist', 'play-index',
  'set-volume', 'set-output',
  'add-to-queue', 'add-tracks', 'shuffle-play', 'queue-set-all', 'clear',
]);

// Subset of REMOTE_COMMANDS that a "guest" device is allowed to send. Picked
// so a guest can suggest tracks (queue them) and tweak volume on the room
// speakers, but can't blow up the host's queue or skip past the current
// song. The host can promote any device back to full powers from the
// Devices tab.
const GUEST_COMMANDS = new Set([
  'set-volume', 'add-to-queue', 'add-tracks',
]);

const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.flac', '.ogg', '.wav', '.aac']);

function isIntegerArray(arr) {
  return Array.isArray(arr) && arr.every(x => Number.isInteger(x));
}

function isStringArray(arr) {
  return Array.isArray(arr) && arr.every(x => typeof x === 'string');
}

function isValidPort(p) {
  return Number.isInteger(p) && p > 0 && p < 65536;
}

function isValidTrackId(id, library) {
  return typeof id === 'number'
    && Number.isInteger(id)
    && id >= 0
    && Array.isArray(library)
    && library[id] != null;
}

function parseTrackId(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function isAudioFile(filename) {
  if (typeof filename !== 'string') return false;
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return false;
  return AUDIO_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

// Splits a filesystem path on either separator (so the same check works on
// Windows-style and POSIX-style paths regardless of where it runs).
function pathParts(p) {
  if (typeof p !== 'string') return [];
  return p.split(/[\\/]/).filter(Boolean);
}

function isExcludedPath(p, excludeFolders) {
  if (!Array.isArray(excludeFolders) || excludeFolders.length === 0) return false;
  const excl = new Set(excludeFolders.map(f => String(f).toLowerCase()));
  return pathParts(p).some(part => excl.has(part.toLowerCase()));
}

module.exports = {
  MAX_QUEUE_LEN,
  MAX_PLAYLIST_NAME_LEN,
  REMOTE_COMMANDS,
  GUEST_COMMANDS,
  AUDIO_EXTENSIONS,
  isIntegerArray,
  isStringArray,
  isValidPort,
  isValidTrackId,
  parseTrackId,
  isAudioFile,
  isExcludedPath,
  pathParts,
};
